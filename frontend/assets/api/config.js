const DEFAULTS = Object.freeze({
  maxFileBytes: 12 * 1024 * 1024,
  maxDecodedPixels: 24_000_000,
  maxBatchImages: 1_000,
  maxChunkFiles: 4,
  autoCaptureIntervalMs: 5_000,
  autoCaptureQueueDepth: 20,
  retentionHours: 24,
  allowedTypes: Object.freeze(["image/jpeg", "image/png", "image/webp"]),
});

const LIMIT_META = {
  maxFileBytes: "max-file-bytes",
  maxDecodedPixels: "max-decoded-pixels",
  maxBatchImages: "max-batch-images",
  maxChunkFiles: "max-chunk-files",
  autoCaptureIntervalMs: "auto-capture-interval-ms",
  autoCaptureQueueDepth: "auto-capture-max-queue-depth",
  retentionHours: "retention-hours",
};

function modeValue(value) {
  if (value === "preview" || value === "design-preview") return "design-preview";
  return value === "live" ? value : undefined;
}

export function readConfig(document = globalThis.document, search = globalThis.location?.search) {
  const meta = (name) => document?.querySelector(`meta[name="fruispect-${name}"]`)
    ?.getAttribute("content")?.trim().toLowerCase();
  const allowPreview = ["1", "true"].includes(meta("allow-preview"));
  const queryMode = allowPreview ? modeValue(new URLSearchParams(search).get("mode")) : undefined;
  const config = {
    ...DEFAULTS,
    mode: queryMode ?? modeValue(meta("mode")) ?? "live",
    allowPreview,
  };

  for (const [key, name] of Object.entries(LIMIT_META)) {
    const value = Number(meta(name) || NaN);
    const minimum = ["autoCaptureQueueDepth", "retentionHours"].includes(key) ? 0 : 1;
    const valid = key === "retentionHours" ? Number.isFinite(value) : Number.isSafeInteger(value);
    if (valid && value >= minimum) config[key] = value;
  }
  config.maxChunkFiles = Math.min(config.maxChunkFiles, DEFAULTS.maxChunkFiles);
  return Object.freeze(config);
}

/**
 * Exposes capabilities only after the server reports them.
 * Future authenticated Admin access can supply its own provider.
 */
export function readCapabilities(connection, settings) {
  const requiresPairing = connection?.requires_pairing === true && connection?.paired !== true;
  const localOperator = (connection?.local_operator ?? settings?.local_operator) === true;
  return {
    requiresPairing,
    localOperator,
    canReadSession: connection != null && !requiresPairing,
    canReset: (settings?.local_operator ?? connection?.local_operator) === true,
    canRetryConnection: connection?.local_operator === true,
    allRequests: false,
  };
}
