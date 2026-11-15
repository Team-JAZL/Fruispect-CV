// Track owned requests, image selection, event history, and live subscriptions.
import { mergeImage } from '../state/requests.js';
import { PAGE_SIZE, TIMELINE_SIZE, array, number, errorStatus } from './format.js';
import { resource, createRequest } from './resources.js';

// Connect requests behavior to shared state and actions.
export function installRequests(context) {
  const { service, state: store, actions } = context;

  // Close the current collection event stream and its pending callbacks.
  function closeStream() {
    store.stopWatch?.();
    store.stopWatch = null;
    if (store.request) {
      store.request.streamStatus = '';
      store.request.streamError = null;
    }
  }

  // Release the selected request and display its removal or reset notice.
  function clearRequest(text) {
    actions.closeStream();
    clearTimeout(store.pendingSearch);
    store.request = null;
    store.cleared = text;
    actions.scheduleRender();
  }

  // Remove an unavailable selected collection and refresh browser history.
  function batchGone(current) {
    if (store.request !== current) return;
    actions.clearRequest('This collection was removed, expired, or is unavailable in this browser session.');
    store.batches = resource(array(store.batches.data).filter((batch) => batch.batch_id !== current.id));
    actions.refreshBatches();
  }

  // Deduplicate retained request events and bound the visible history window.
  function rememberEvents(current, events) {
    const known = new Map(current.events.map((event) => [Number(event.event_id), event]));
    for (const event of events) {
      const id = number(event.event_id);
      if (id === null || (event.batch_id && event.batch_id !== current.id)) continue;
      known.set(id, event);
    }
    current.events = [...known.values()].sort((a, b) => Number(a.event_id) - Number(b.event_id)).slice(-TIMELINE_SIZE);
  }

  // Refresh history from the current service snapshots.
  function refreshHistory(current) {
    if (current === null) return;
    actions.read(current.history, async () => {
        let more = true;
        for (let page = 0; more && page < 3; page += 1) {
          const data = await service.events(current.id, current.timelineCursor);
          if (store.disposed || store.request !== current) break;
          const events = array(data?.events);
          actions.rememberEvents(current, events);
          const next = Math.max(current.timelineCursor, number(data?.cursor) ?? 0, ...events.map((event) => number(event.event_id) ?? 0));
          more = events.length >= 200 && next > current.timelineCursor;
          current.timelineCursor = next;
        }
        return true;
      }, {
        active: () => store.request === current,
        fail: (error) => { if (errorStatus(error) === 404) actions.batchGone(current); },
      });
  }

  // Load an image snapshot without changing the selected image.
  function refreshImage(current, latest = false) {
    if (!current?.imageId) return;
    const target = current.image;
    const id = current.imageId;
    actions.read(target, () => service.image(id), {
        latest,
        active: () => store.request === current && target === current.image,
        apply: (value) => { target.data = mergeImage(target.data, value); },
        fail: (error) => { if (errorStatus(error) === 404) target.data = null; },
      });
  }

  // Select an owned image without changing queue execution order.
  function selectImage(current, id, value = null) {
    if (id === current.imageId) return;
    current.autoSelect = false;
    current.imageId = id;
    current.image = resource(value?.jobs ? value : null);
    actions.refreshImage(current);
    actions.scheduleRender();
  }

  // Refresh photos from the current service snapshots.
  function refreshPhotos(current, latest = false) {
    const target = current.images;
    const query = { ...current.query };
    actions.read(target, () => service.images(current.id, query), {
        latest,
        active: () => store.request === current && target === current.images,
        apply: (value) => {
          target.data = value;
          const total = number(value?.total);
          const pages = total === null ? query.page : Math.max(1, Math.ceil(total / (number(value?.limit) || PAGE_SIZE)));
          if (query.page > pages) {
            current.query.page = pages;
            current.images = resource();
            refreshPhotos(current);
            return;
          }
          const first = array(value?.images)[0];
          if (current.autoSelect && first?.image_id) actions.selectImage(current, first.image_id, first);
        },
        fail: (error) => { if (errorStatus(error) === 404) actions.batchGone(current); },
      });
  }

  // Refresh request from the current service snapshots.
  function refreshRequest(current, { image = true, history = true, latest = false } = {}) {
    if (!current || store.request !== current) return;
    actions.read(current.batch, () => service.batch(current.id), {
        latest,
        active: () => store.request === current,
        fail: (error) => { if (errorStatus(error) === 404) actions.batchGone(current); },
      });
    actions.refreshPhotos(current, latest);
    if (image) actions.refreshImage(current, latest);
    if (history) actions.refreshHistory(current);
  }

  // Open a live subscription for the selected collection and replay cursor.
  function openStream(current) {
    if (!current || !actions.allowedRequest() || document.hidden || store.stopWatch || store.disposed) return;
    if (typeof service.watch !== 'function') {
      current.streamStatus = 'polling';
      return;
    }
    // Check that callbacks still belong to the selected live request.
    const active = () => !store.disposed && store.request === current && actions.allowedRequest() && !document.hidden;
    const cleanupWatch = service.watch(current.id, {
        cursor: Math.max(current.streamCursor, current.timelineCursor),
        // Merge live request events and refresh only their affected image snapshots.
        onEvents(events, cursor) {
          if (!active()) return;
          actions.rememberEvents(current, events);
          current.streamCursor = Math.max(current.streamCursor, number(cursor) ?? 0);
          actions.refreshRequest(current, {
              image: events.some((event) => !event.image_id || event.image_id === current.imageId),
              history: false,
              latest: true,
            });
          actions.scheduleRender();
        },
        // Reload request snapshots when live event delivery recovers.
        onRecover() {
          if (active()) actions.refreshRequest(current);
        },
        // Clear the selected request when its collection is removed.
        onRemoved() {
          if (active()) actions.batchGone(current);
        },
        // Show stream availability and any recoverable delivery error.
        onStatus(status, error) {
          if (!active()) return;
          current.streamStatus = status;
          current.streamError = error;
          actions.scheduleRender();
        },
      });
    if (active()) store.stopWatch = cleanupWatch;
    else cleanupWatch();
  }

  // Select a collection and restore its snapshots and live updates.
  function chooseBatch(id, initialImage = null) {
    if (id === store.request?.id) {
      if (initialImage?.image_id) actions.selectImage(store.request, initialImage.image_id, initialImage);
      return;
    }
    actions.closeStream();
    clearTimeout(store.pendingSearch);
    store.cleared = '';
    store.request = createRequest(id, initialImage?.image_id);
    if (initialImage) store.request.image.data = initialImage;
    actions.refreshRequest(store.request);
    actions.openStream(store.request);
    actions.scheduleRender();
  }

  Object.assign(actions, { closeStream, clearRequest, batchGone, rememberEvents, refreshHistory, refreshImage, selectImage, refreshPhotos, refreshRequest, openStream, chooseBatch });
}
