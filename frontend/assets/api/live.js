import { ApiError, createHttpClient, downloadName } from "./client.js";
import { watchBatch } from "./watch.js";

const IMAGE_FILTERS = ["page", "limit", "search", "status", "fruit", "quality", "agreement", "sort"];
const batchPath = (id) => "/api/batches/" + encodeURIComponent(id);
const imagePath = (id) => "/api/images/" + encodeURIComponent(id);

function withQuery(path, values) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) {
    if (value != null && value !== "") query.set(key, value);
  }
  const search = query.toString();
  return search ? path + "?" + search : path;
}

function idempotencyKey(key, required = false) {
  if (key == null && !required) return undefined;
  if (typeof key !== "string" || !key.trim() || key.length > 180) {
    throw new ApiError("An idempotency key must contain between 1 and 180 characters.", {
      code: "INVALID_IDEMPOTENCY_KEY",
    });
  }
  return key;
}

function singular(payload, field) {
  if (payload?.[field] == null) {
    throw new ApiError("The Fruispect response is missing its " + field + " field.", {
      code: "INVALID_RESPONSE", payload,
    });
  }
  return payload[field];
}

/** Same-origin browser service. Optional transport injection supports isolated verification. */
export function createLiveService({ fetch, EventSource = globalThis.EventSource } = {}) {
  const request = createHttpClient(fetch);
  const get = async (path, options) => (await request(path, options)).payload;
  const post = (path, options) => get(path, { ...options, method: "POST" });
  const events = (id, cursor = 0, options) =>
    get(withQuery(batchPath(id) + "/events", { after: cursor }), options);
  const streamUrl = (id, cursor) => withQuery("/api/events", { batch_id: id, after: cursor });

  return {
    async connection(options) {
      return singular(await get("/api/connection", options), "connection");
    },
    connect(code, options) {
      return post("/api/connect", { ...options, json: { code } });
    },
    health(options) {
      return get("/api/health", options);
    },
    readiness(options) {
      return get("/api/readiness", {
        ...options,
        acceptError: (status, body) => status === 503 && typeof body?.ready === "boolean",
      });
    },
    queues(options) {
      return get("/api/queues", options);
    },
    async createBatch(key, options) {
      return singular(await post("/api/batches", { ...options, key: idempotencyKey(key) }), "batch");
    },
    async batches(options) {
      return singular(await get("/api/batches", options), "batches");
    },
    async batch(id, options) {
      return singular(await get(batchPath(id), options), "batch");
    },
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
    images(id, query = {}, options) {
      const filters = Object.fromEntries(IMAGE_FILTERS.map((key) => [key, query?.[key]]));
      return get(withQuery(batchPath(id) + "/images", filters), options);
    },
    async image(id, options) {
      return singular(await get(imagePath(id), options), "image");
    },
    events,
    cancelImage(id, options) {
      return post(imagePath(id) + "/cancel", options);
    },
    cancelBatch(id, options) {
      return post(batchPath(id) + "/cancel", options);
    },
    deleteBatch(id, options) {
      return post(batchPath(id) + "/delete", options);
    },
    deleteCollections(options) {
      return post("/api/settings/collections/delete", options);
    },
    settings(options) {
      return get("/api/settings", options);
    },
    reset(confirmation, options) {
      return post("/api/settings/reset", { ...options, json: { confirmation } });
    },
    retryConnection(options) {
      return post("/api/connection/retry", options);
    },
    research(options) {
      return get("/api/evaluation/summary", options);
    },
    figures(options) {
      return get("/api/evaluation/figures", options);
    },
    async exportFile(id, format = "csv", options) {
      if (format !== "csv" && format !== "json") {
        throw new ApiError("Choose CSV or JSON to export a collection.", { code: "INVALID_FORMAT" });
      }
      const path = withQuery("/api/export/" + encodeURIComponent(id), { format });
      const { blob, disposition } = await request(path, { ...options, asFile: true });
      const filename = downloadName(disposition, "fruispect-" + encodeURIComponent(id) + "." + format);
      return { blob, filename };
    },
    async allRequests() {
      return {
        available: false,
        code: "NOT_IMPLEMENTED",
        message: "All requests needs a protected backend API for cross-browser collections.",
      };
    },
    watch(id, options) {
      return watchBatch(id, options, { EventSource, streamUrl, events });
    },
  };
}
