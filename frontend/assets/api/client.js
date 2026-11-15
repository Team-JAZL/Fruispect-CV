// Send same-origin requests and normalize errors, retry delays, and downloads.
const STATUS_CODES = {
  401: "PAIRING_REQUIRED",
  403: "FORBIDDEN",
  404: "NOT_FOUND",
  409: "CONFLICT",
  413: "PAYLOAD_TOO_LARGE",
  422: "INVALID_IMAGE",
  429: "CAPACITY",
  503: "SERVICE_UNAVAILABLE",
};

export class ApiError extends Error {
  // Initialize the API error with response details and retry information.
  constructor(message, { status = 0, code, payload, retryAfterMs, cause } = {}) {
    super(message, { cause });
    this.name = "ApiError";
    this.status = status;
    this.code = code ?? STATUS_CODES[status] ?? "HTTP_ERROR";
    this.body = payload;
    this.retryAfterMs = retryAfterMs;
  }
}

// Parse a retry header into a bounded delay in milliseconds.
export function parseRetryAfter(value, now = Date.now()) {
  const header = value?.trim();
  if (!header) return undefined;
  if (/^\d+$/.test(header)) {
    const milliseconds = Number(header) * 1000;
    return Number.isSafeInteger(milliseconds) ? milliseconds : undefined;
  }
  const date = Date.parse(header);
  return Number.isFinite(date) ? Math.max(0, date - now) : undefined;
}

// Create a same-origin HTTP transport with consistent API errors.
export function createHttpClient(fetch = globalThis.fetch?.bind(globalThis)) {
  // Send a browser request and decode its payload or structured failure.
  return async function request(path, {
      method = "GET", signal, json, form, key, asFile, acceptError,
    } = {}) {
    const headers = new Headers();
    if (!asFile) headers.set("Accept", "application/json");
    if (method === "POST") headers.set("X-Fruispect", "1");
    if (key !== undefined) headers.set("Idempotency-Key", key);
    if (json !== undefined) headers.set("Content-Type", "application/json");
    const body = json === undefined ? form : JSON.stringify(json);

    let response;
    try {
      response = await fetch(path, { method, credentials: "same-origin", headers, body, signal });
    } catch (cause) {
      if (signal?.aborted || cause?.name === "AbortError") throw cause;
      throw new ApiError("The Fruispect service could not be reached.", {
          code: "NETWORK_ERROR", cause,
        });
    }

    if (asFile && response.ok) {
      return { blob: await response.blob(), disposition: response.headers.get("Content-Disposition") };
    }

    const status = response.status;
    const retryAfterMs = parseRetryAfter(response.headers.get("Retry-After"));
    let payload;
    try {
      payload = await response.json();
    } catch (cause) {
      if (signal?.aborted || cause?.name === "AbortError") throw cause;
      if (response.ok) {
        throw new ApiError("The Fruispect service returned an invalid JSON response.", {
            status, code: "INVALID_RESPONSE", cause,
          });
      }
    }

    if (response.ok || acceptError?.(status, payload)) {
      return { payload, status, retryAfterMs };
    }

    throw new ApiError(payload?.error?.message || ("Fruispect request failed (HTTP " + status + ")."), {
        status, code: payload?.error?.code, payload, retryAfterMs,
      });
  };
}

// Extract a safe filename from the response download headers.
export function downloadName(disposition, fallback) {
  const extended = disposition?.match(/(?:^|;)\s*filename\*=(?:"([^"]*)"|([^;]*))/i);
  const encoded = (extended?.[1] ?? extended?.[2])?.trim().match(/^utf-8'[^']*'(.*)$/i);
  if (encoded) {
    try {
      const name = safeName(decodeURIComponent(encoded[1]));
      if (name) return name;
    } catch (error) {
      if (!(error instanceof URIError)) throw error;
    }
  }
  const plain = disposition?.match(/(?:^|;)\s*filename=(?:"((?:[^"\\]|\\.)*)"|([^;]*))/i);
  return safeName(plain?.[1]?.replace(/\\(["\\])/g, "$1") ?? plain?.[2]) || fallback;
}

// Strip path components and control characters from a download filename.
function safeName(value) {
  const name = value?.split(/[/\\]/).pop()?.replace(/[\u0000-\u001f\u007f]/g, "").trim();
  return name === "." || name === ".." ? undefined : name;
}
