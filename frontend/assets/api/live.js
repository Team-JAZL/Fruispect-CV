// Expose the current Flask API through the browser service.
import { ApiError, createHttpClient, downloadName } from "./client.js";
import { watchBatch } from "./watch.js";

const IMAGE_FILTERS = ["page", "limit", "search", "status", "fruit", "quality", "agreement", "sort"];
// Append only populated query parameters to a service path.
function withQuery(path, values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value != null && value !== "") query.set(key, value);
  }
  const search = query.toString();
  return search ? path + "?" + search : path;
}

// Validate a stable admission key before sending a command.
function idempotencyKey(key, required = false) {
  if (key == null && !required) return undefined;
  if (typeof key !== "string" || !key.trim() || key.length > 180) {
    throw new ApiError("An idempotency key must contain between 1 and 180 characters.", {
        code: "INVALID_IDEMPOTENCY_KEY",
      });
  }
  return key;
}

// Require the expected response field before exposing a service snapshot.
function singular(payload, field) {
  if (payload?.[field] == null) {
    throw new ApiError("The Fruispect response is missing its " + field + " field.", {
        code: "INVALID_RESPONSE", payload,
      });
  }
  return payload[field];
}

// Expose live collection, image, telemetry, and connection operations.
export function createLiveService({ fetch, EventSource = globalThis.EventSource, globalCollections = false } = {}) {
  const prefix = globalCollections ? '/api/global' : '/api';
  // Encode collection and image identifiers within the selected access scope.
  const batchPath = id => prefix + '/batches/' + encodeURIComponent(id);
  const imagePath = id => prefix + '/images/' + encodeURIComponent(id);
  const request = createHttpClient(fetch);
  // Return the decoded payload from a service request.
  const get = async (path, options) => (await request(path, options)).payload;
  // Send a command through the shared same-origin transport.
  const post = (path, options) => get(path, { ...options, method: "POST" });
  // Read the next event page after the supplied collection cursor.
  const events = (id, cursor = 0, options) =>
  get(withQuery(batchPath(id) + "/events", { after: cursor }), options);
  // Build the collection SSE endpoint with its replay cursor.
  const streamUrl = (id, cursor) => withQuery(prefix + "/events", { batch_id: id, after: cursor });

  return {
    // Read public connection state and authorized pairing information.
    async connection(options) {
      return singular(await get("/api/connection", options), "connection");
    },
    // Pair this browser with the current host tunnel generation.
    connect(code, options) {
      return post("/api/connect", { ...options, json: { code } });
    },
    // Read API liveness from the host.
    health(options) {
      return get("/api/health", options);
    },
    // Read model and storage readiness, including degraded responses.
    readiness(options) {
      return get("/api/readiness", {
          ...options,
          acceptError: (status, body) => status === 503 && typeof body?.ready === "boolean",
        });
    },
    // Read current worker health and independent queue snapshots.
    queues(options) {
      return get("/api/queues", options);
    },
    // Create or recover a browser-owned collection using a stable key.
    async createBatch(key, options) {
      return singular(await post("/api/batches", { ...options, key: idempotencyKey(key) }), "batch");
    },
    // Read the most recent collections belonging to this browser.
    async batches(options) {
      return singular(await get(prefix + "/batches", options), "batches");
    },
    // Read one owned collection summary and its replay cursor.
    async batch(id, options) {
      return singular(await get(batchPath(id), options), "batch");
    },
    // Submit a bounded idempotent image chunk and preserve individual rejections.
    async addImages(id, files, offset = 0, key, options) {
      const upload = Array.from(files ?? []);
      if (upload.length < 1 || upload.length > 4) {
        throw new ApiError("Upload between one and four files per request.", {
            code: "INVALID_CHUNK_SIZE",
          });
      }
      const form = new FormData();
      for (const file of upload) form.append("images", file);
      form.append("offset", String(offset));
      const { payload, retryAfterMs } = await request(batchPath(id) + "/images", {
          ...options, method: "POST", form, key: idempotencyKey(key, true),
          acceptError: (_status, body) => Array.isArray(body?.rejected) || Array.isArray(body?.accepted),
        });
      return retryAfterMs === undefined ? payload : { ...payload, retryAfterMs };
    },
    // Read a filtered page of accepted collection images.
    images(id, query = {}, options) {
      const filters = Object.fromEntries(IMAGE_FILTERS.map((key) => [key, query?.[key]]));
      return get(withQuery(batchPath(id) + "/images", filters), options);
    },
    // Read one owned image with its independent model results.
    async image(id, options) {
      return singular(await get(imagePath(id), options), "image");
    },
    events,
    // Request cancellation of unfinished model jobs for one image.
    cancelImage(id, options) {
      return post(imagePath(id) + "/cancel", options);
    },
    // Request cancellation of unfinished jobs in one collection.
    cancelBatch(id, options) {
      return post(batchPath(id) + "/cancel", options);
    },
    // Delete a browser-owned collection and its stored scans.
    deleteBatch(id, options) {
      return post(batchPath(id) + "/delete", options);
    },
    // Delete all collections belonging to this browser session.
    deleteCollections(options) {
      return globalCollections ? post("/api/settings/reset", { ...options, json: { confirmation: "RESET" } }) : post("/api/settings/collections/delete", options);
    },
    // Read browser storage counts and authorized host totals.
    settings(options) {
      return get("/api/settings", options);
    },
    // Request a host-wide scan reset with the supplied confirmation.
    reset(confirmation, options) {
      return post("/api/settings/reset", { ...options, json: { confirmation } });
    },
    // Request a localhost-only restart of the phone tunnel.
    retryConnection(options) {
      return post("/api/connection/retry", options);
    },
    // Read saved experiment metrics with their original provenance.
    research(options) {
      return get("/api/evaluation/summary", options);
    },
    // Read the validated research figure catalog.
    figures(options) {
      return get("/api/evaluation/figures", options);
    },
    // Download owned collection observations as CSV or JSON.
    async exportFile(id, format = "csv", options) {
      if (format !== "csv" && format !== "json") {
        throw new ApiError("Choose CSV or JSON to export a collection.", { code: "INVALID_FORMAT" });
      }
      const path = withQuery(prefix + "/export/" + encodeURIComponent(id), { format });
      const { blob, disposition } = await request(path, { ...options, asFile: true });
      const filename = downloadName(disposition, "fruispect-" + encodeURIComponent(id) + "." + format);
      return { blob, filename };
    },

    // Start collection event delivery through the shared stream watcher.
    watch(id, options) {
      return watchBatch(id, options, { EventSource, streamUrl, events });
    },
  };
}
