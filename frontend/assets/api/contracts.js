// Define model labels, fruit classes, quality classes, and terminal job states.
export const MODELS = Object.freeze([
    Object.freeze({ key: "resnet18", name: "ResNet-18" }),
    Object.freeze({ key: "mobilenet_v3_small", name: "MobileNetV3-Small" }),
    Object.freeze({ key: "efficientnet_b0", name: "EfficientNet-B0" }),
  ]);

export const FRUITS = Object.freeze([
    "Apple", "Banana", "Guava", "Lime", "Orange", "Pomegranate",
  ]);
export const QUALITIES = Object.freeze(["Good", "Bad"]);

export const JOB_LABELS = Object.freeze({
    WAITING_FOR_INPUT: "Preparing photo",
    QUEUED: "Waiting for a check",
    RUNNING: "Checking your fruit",
    COMPLETED: "Result ready",
    FAILED: "Check failed",
    UNAVAILABLE: "Model unavailable",
    CANCELLED: "Check cancelled",
  });

const TERMINAL_STATUSES = new Set(["COMPLETED", "FAILED", "UNAVAILABLE", "CANCELLED"]);

// Report whether a model job has finished permanently.
export function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}
