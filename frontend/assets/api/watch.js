// Reconcile collection events through server-sent updates and polling recovery.
import { collectUpdates, eventCursor } from "../state/requests.js";
import { ApiError } from "./client.js";

const POLL_INTERVAL = 3_000;
const STREAM_RETRY_INTERVAL = 15_000;
const RECOVERY_INTERVAL = 30_000;
const PAGE_SIZE = 200;
const STREAM_FLUSH_DELAY = 40;
const MAX_TIMER_DELAY = 2_147_483_647;

// Subscribe to replayable collection updates with recovery and removal handling.
export function watchBatch(id, { cursor: initialCursor, onEvents, onRemoved, onStatus, onRecover } = {},
  { EventSource, streamUrl, events }) {
  const controller = new AbortController();
  const { signal } = controller;
  let cursor = eventCursor(initialCursor) ?? 0;
  let stream;
  let timeout;
  let streamFlush;
  let pendingUpdates = [];
  let status;
  let recovering = false;
  let recoveryPending = false;
  let nextStreamAttempt = 0;
  let pollFailures = 0;
  let openedBefore = false;

  // Notify the caller when the event connection status changes.
  function publish(next, error) {
    if (signal.aborted || (status === next && !error)) return;
    status = next;
    onStatus?.(next, error);
  }

  // Accept only a newer valid replay cursor.
  function advance(items, pageCursor) {
    const previous = cursor;
    const update = collectUpdates(items, cursor, id);
    cursor = Math.max(update.cursor, pageCursor ?? 0);
    if (cursor > previous) void notifyEvents(update.events, cursor);
  }

  // Deliver ordered events and advance the confirmed replay cursor.
  async function notifyEvents(updates, nextCursor) {
    try {
      await onEvents?.(updates, nextCursor);
    } catch (error) {
      if (!signal.aborted && error?.name !== "AbortError") publish(status, error);
    }
  }

  // Deliver buffered stream events without overlapping event callbacks.
  function flushUpdates() {
    clearTimeout(streamFlush);
    streamFlush = undefined;
    const updates = pendingUpdates;
    pendingUpdates = [];
    if (updates.length && !signal.aborted) advance(updates);
  }

  // Refresh snapshots after reconnecting or detecting an event gap.
  async function recover() {
    if (signal.aborted || !onRecover) return;
    if (recovering) {
      recoveryPending = true;
      return;
    }
    recovering = true;
    try {
      await onRecover({ cursor, signal });
    } catch (error) {
      if (!signal.aborted && error?.name !== "AbortError") publish(status, error);
    } finally {
      recovering = false;
      if (recoveryPending) {
        recoveryPending = false;
        void recover();
      }
    }
  }

  // Close the current collection event stream and its pending callbacks.
  function closeStream() {
    const current = stream;
    stream = undefined;
    current?.close();
  }

  // Release the stream, polling timers, and recovery resources.
  function cleanup() {
    if (signal.aborted) return;
    controller.abort();
    closeStream();
    clearTimeout(timeout);
    clearTimeout(streamFlush);
    pendingUpdates = [];
    clearInterval(recoveryTimer);
  }

  // Notify collection removal once and release its subscriptions.
  function removed() {
    if (signal.aborted) return;
    cleanup();
    onStatus?.("removed");
    onRemoved?.(id);
  }

  // Schedule a bounded retry for the next collection event page.
  function schedulePoll(delay) {
    if (!signal.aborted) timeout = setTimeout(poll, Math.min(delay, MAX_TIMER_DELAY));
  }

  // Switch unavailable streaming to cursor-based polling.
  function fallback() {
    if (signal.aborted) return;
    closeStream();
    flushUpdates();
    publish("reconnecting");
    nextStreamAttempt = Date.now() + STREAM_RETRY_INTERVAL;
    schedulePoll(0);
  }

  // Read retained events while respecting visibility and retry backoff.
  async function poll() {
    if (signal.aborted) return;
    const wasPolling = status === "polling";
    let page;
    let pageCursor;
    try {
      page = await events(id, cursor, { signal });
      pageCursor = eventCursor(page?.cursor);
      if (!Array.isArray(page?.events) || pageCursor === undefined) {
        throw new ApiError("The Fruispect service returned an invalid event page.", {
            code: "INVALID_RESPONSE",
          });
      }
    } catch (error) {
      if (signal.aborted) return;
      if (error.status === 404) {
        removed();
        return;
      }
      pollFailures += 1;
      publish(error.status === 429 ? "capacity" : "unavailable", error);
      const backoff = Math.min(30_000, POLL_INTERVAL * 2 ** Math.min(pollFailures, 4));
      schedulePoll(Math.max(backoff, error.retryAfterMs ?? 0));
      return;
    }
    if (signal.aborted) return;

    pollFailures = 0;
    publish("polling");
    if (signal.aborted) return;
    const previous = cursor;
    advance(page.events, pageCursor);
    if (!wasPolling) void recover();
    if (signal.aborted) return;

    if (page.events.length >= PAGE_SIZE && cursor > previous) schedulePoll(0);
    else if (EventSource && Date.now() >= nextStreamAttempt) openStream();
    else schedulePoll(POLL_INTERVAL);
  }

  // Open a live subscription for the selected collection and replay cursor.
  function openStream() {
    if (signal.aborted) return;
    publish(openedBefore || status === "polling" ? "reconnecting" : "connecting");
    if (signal.aborted) return;
    let current;
    try {
      current = new EventSource(streamUrl(id, cursor), { withCredentials: true });
    } catch {
      fallback();
      return;
    }
    stream = current;
    current.addEventListener("open", () => {
        if (stream !== current || signal.aborted) return;
        const shouldRecover = openedBefore || status === "reconnecting";
        openedBefore = true;
        publish("live");
        if (shouldRecover) void recover();
      });
    current.addEventListener("update", (message) => {
        if (stream !== current || signal.aborted) return;
        let event;
        try {
          event = JSON.parse(message.data);
        } catch {
          fallback();
          return;
        }
        const eventId = eventCursor(event?.event_id) ?? eventCursor(message.lastEventId);
        if (!event || typeof event !== "object" || Array.isArray(event) || eventId === undefined) {
          fallback();
          return;
        }
        pendingUpdates.push({ ...event, event_id: eventId });
        if (pendingUpdates.length >= PAGE_SIZE) flushUpdates();
        else streamFlush ??= setTimeout(flushUpdates, STREAM_FLUSH_DELAY);
      });
    current.addEventListener("removed", () => {
        if (stream === current) removed();
      });
    current.addEventListener("error", () => {
        if (stream === current) fallback();
      });
  }

  const recoveryTimer = setInterval(() => { void recover(); }, RECOVERY_INTERVAL);
  if (EventSource) openStream();
  else {
    publish("connecting");
    schedulePoll(0);
  }
  return cleanup;
}
