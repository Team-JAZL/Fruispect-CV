import { isTerminal, MODELS } from "../api/contracts.js";

export function eventCursor(value) {
  if (typeof value === "string" && /^\d+$/.test(value)) value = Number(value);
  return Number.isSafeInteger(value) && value >= 0 ? value : undefined;
}

/** Collect new events in cursor order without assuming IDs are consecutive. */
export function collectUpdates(events, cursor, batchId) {
  const updates = [];
  const ordered = events
    .map((event) => ({ event, id: eventCursor(event?.event_id) }))
    .filter(({ event, id }) => id !== undefined && id > cursor
      && (event.batch_id == null || event.batch_id === batchId))
    .sort((a, b) => a.id - b.id);

  for (const { event, id } of ordered) {
    if (id <= cursor) continue;
    updates.push(event);
    cursor = id;
  }
  return { events: updates, cursor };
}

/** Use these IDs to refresh snapshots without changing the selected image. */
export function changedImageIds(events) {
  return [...new Set(events.map((event) => event.image_id).filter(Boolean))];
}

export function computeConsensus(jobs = {}) {
  const lanes = MODELS.map(({ key }) => jobs[key]);
  const results = lanes
    .filter((job) => job?.status === "COMPLETED" && job.result)
    .map((job) => job.result);
  const disagreement = (field) => new Set(results.map((result) => result[field])
    .filter((value) => value != null)).size > 1;

  const successful_models = results.length;
  let scope = "provisional";
  if (successful_models === MODELS.length) scope = "complete";
  else if (lanes.every((job) => isTerminal(job?.status))) scope = "incomplete";

  return {
    successful_models,
    fruit_disagreement: disagreement("predicted_fruit"),
    quality_disagreement: disagreement("predicted_quality"),
    scope,
  };
}

function fillMissing(previous, incoming) {
  let merged = previous;
  for (const [field, value] of Object.entries(incoming)) {
    if (previous[field] != null || value == null) continue;
    if (merged === previous) merged = { ...previous };
    merged[field] = value;
  }
  return merged;
}

export function mergeJob(previous, incoming) {
  if (!incoming) return previous;
  if (!previous || (previous.job_id && incoming.job_id && previous.job_id !== incoming.job_id)) {
    return incoming;
  }
  const currentVersion = eventCursor(previous.version);
  const nextVersion = eventCursor(incoming.version);
  if (currentVersion !== undefined && (nextVersion === undefined || nextVersion < currentVersion)) {
    return previous;
  }
  if (currentVersion !== undefined && nextVersion === currentVersion) {
    const job = fillMissing(previous, incoming);
    if (!previous.result || !incoming.result) return job;
    const result = fillMissing(previous.result, incoming.result);
    return result === previous.result ? job : { ...job, result };
  }
  return { ...previous, ...incoming };
}

/** Merge same-image snapshots while guarding against an out-of-order list or detail read. */
export function mergeImage(previous, incoming) {
  if (!incoming) return previous;
  if (!previous || previous.image_id !== incoming.image_id) return incoming;

  const jobs = { ...previous.jobs };
  let retainedNewerJob = false;
  for (const { key } of MODELS) {
    const previousJob = jobs[key];
    const incomingJob = incoming.jobs?.[key];
    const job = mergeJob(previousJob, incomingJob);
    if (job) jobs[key] = job;
    const previousVersion = eventCursor(previousJob?.version);
    const incomingVersion = eventCursor(incomingJob?.version);
    if (previousJob && (!incomingJob || (job === previousJob && previousVersion !== undefined
      && (incomingVersion === undefined || incomingVersion < previousVersion)))) {
      retainedNewerJob = true;
    }
  }

  const merged = { ...previous, ...incoming, jobs };
  if (["READY", "FAILED"].includes(previous.input_status) && incoming.input_status === "PROCESSING") {
    for (const field of [
      "input_status", "input_error", "width", "height", "preprocess_ms",
      "content_sha256", "preprocessing_sha256", "thumbnail_url",
    ]) {
      merged[field] = previous[field];
    }
  }

  if (retainedNewerJob && MODELS.every(({ key }) => jobs[key])) {
    merged.terminal = MODELS.every(({ key }) => isTerminal(jobs[key].status));
    const enoughResults = MODELS.every(({ key }) =>
      jobs[key].status !== "COMPLETED" || jobs[key].result);
    if (enoughResults) merged.consensus = computeConsensus(jobs);
    else if (previous.terminal) merged.consensus = previous.consensus;
  }
  if (previous.terminal) merged.terminal = true;
  return merged;
}
