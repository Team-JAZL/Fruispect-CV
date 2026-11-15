// Read and validate server-provided limits for the connected workspace.
const DEFAULTS = Object.freeze({
    maxFileBytes: 12 * 1024 * 1024,
    maxDecodedPixels: 24_000_000,
    maxBatchImages: 1_000,
    autoCaptureIntervalMs: 5_000,
    autoCaptureQueueDepth: 20,
    retentionHours: 24,
    allowedTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
  });

const LIMIT_META = {
  maxFileBytes: "max-file-bytes",
  maxDecodedPixels: "max-decoded-pixels",
  maxBatchImages: "max-batch-images",
  autoCaptureIntervalMs: "auto-capture-interval-ms",
  autoCaptureQueueDepth: "auto-capture-max-queue-depth",
  retentionHours: "retention-hours",
};

// Read validated numeric limits from the server-rendered page.
export function readConfig(document = globalThis.document) {
  // Read one trimmed application meta value from the rendered page.
  const meta = (name) => document?.querySelector(`meta[name="fruispect-${name}"]`)
  ?.getAttribute("content")?.trim().toLowerCase();

  const config = {
    ...DEFAULTS,
  };

  for (const [key, name] of Object.entries(LIMIT_META)) {
    const value = Number(meta(name) || NaN);
    const minimum = ["autoCaptureQueueDepth", "retentionHours"].includes(key) ? 0 : 1;
    const valid = key === "retentionHours" ? Number.isFinite(value) : Number.isSafeInteger(value);
    if (valid && value >= minimum) config[key] = value;
  }
  return Object.freeze(config);
}
