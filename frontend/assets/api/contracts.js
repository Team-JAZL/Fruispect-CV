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

/** @param {string|null|undefined} status */
export function isTerminal(status) {
  return TERMINAL_STATUSES.has(status);
}

/**
 * @typedef {"resnet18"|"mobilenet_v3_small"|"efficientnet_b0"} ModelKey
 * @typedef {"Apple"|"Banana"|"Guava"|"Lime"|"Orange"|"Pomegranate"} Fruit
 * @typedef {"Good"|"Bad"} Quality
 * @typedef {keyof typeof JOB_LABELS} JobStatus
 * @typedef {"LOADING"|"READY"|"UNAVAILABLE"|"OFFLINE"} ModelState
 * @typedef {"PROCESSING"|"READY"|"FAILED"} InputStatus
 * @typedef {"ACTIVE"|"COMPLETED"|"CANCELLED"} BatchStatus
 * @typedef {"complete"|"provisional"|"incomplete"} ConsensusScope
 * @typedef {string} IsoUtc
 * @typedef {number} UnixSeconds
 *
 * @typedef {Object} Result
 * @property {ModelKey} model_key
 * @property {string} architecture
 * @property {Fruit} predicted_fruit
 * @property {number} fruit_class_index
 * @property {number|null} fruit_confidence
 * @property {Quality} predicted_quality
 * @property {number} quality_class_index
 * @property {number|null} quality_confidence
 * @property {Record<Fruit, number>} fruit_probabilities
 * @property {Record<Quality, number>} quality_probabilities
 * @property {number|null} inference_ms
 * @property {number|null} queue_wait_ms
 * @property {number|null} preprocess_ms
 * @property {number|null} end_to_end_ms
 * @property {string|null} checkpoint_sha256
 * @property {string|null} preprocessing_sha256
 * @property {string|null} device
 * @property {{python?: string, torch?: string, torchvision?: string}|null} framework_versions
 * @property {number|null} seed
 * @property {number|null} best_epoch
 * @property {number|null} state_dict_tensors
 * @property {number|null} parameters
 * @property {unknown} smoke_shapes
 *
 * @typedef {Object} Job
 * @property {string} job_id
 * @property {string} image_id
 * @property {ModelKey} model_key
 * @property {number} admission_seq
 * @property {JobStatus} status
 * @property {number} version
 * @property {number} attempt_count
 * @property {boolean} cancel_requested
 * @property {IsoUtc|null} queued_at
 * @property {IsoUtc|null} started_at
 * @property {IsoUtc|null} completed_at
 * @property {UnixSeconds|null} available_at
 * @property {number|null} queue_wait_ms
 * @property {number|null} inference_ms
 * @property {string|null} model_checkpoint_sha256
 * @property {string|null} error_code
 * @property {string|null} error_message
 * @property {Result|null} result
 *
 * @typedef {Object} Consensus
 * @property {number} successful_models
 * @property {boolean} fruit_disagreement
 * @property {boolean} quality_disagreement
 * @property {ConsensusScope} scope
 *
 * @typedef {Object} Image
 * @property {string} image_id
 * @property {string} batch_id
 * @property {number} admission_seq
 * @property {string} original_filename
 * @property {number|null} width
 * @property {number|null} height
 * @property {IsoUtc} received_at
 * @property {IsoUtc|null} retention_expires_at
 * @property {InputStatus} input_status
 * @property {unknown} input_error
 * @property {number|null} preprocess_ms
 * @property {string|null} content_sha256
 * @property {string|null} preprocessing_sha256
 * @property {string|null} thumbnail_url
 * @property {boolean} terminal
 * @property {Consensus} consensus
 * @property {Record<ModelKey, Job>} jobs
 *
 * @typedef {Object} BatchSummary
 * @property {number} accepted
 * @property {number} rejected
 * @property {number} total_submitted
 * @property {number} preprocessing
 * @property {number} fully_complete
 * @property {number} partial
 * @property {number} failed
 * @property {number} cancelled
 * @property {number} queued
 * @property {number} running
 *
 * @typedef {Object} Batch
 * @property {string} batch_id
 * @property {IsoUtc} created_at
 * @property {IsoUtc|null} cancelled_at
 * @property {BatchStatus} status
 * @property {number} event_cursor
 * @property {BatchSummary} summary
 *
 * @typedef {Object} Lane
 * @property {ModelKey} model_key
 * @property {string} display_name
 * @property {ModelState} state
 * @property {string|null} device
 * @property {string|null} checkpoint_sha256
 * @property {string|null} preprocessing_sha256
 * @property {UnixSeconds|null} validated_at
 * @property {unknown} last_error
 * @property {unknown} metadata
 * @property {Record<JobStatus, number>} counts
 * @property {number} queue_depth
 * @property {{image_id: string, admission_seq: number, started_at: UnixSeconds}|null} active
 * @property {number|null} active_duration_ms
 * @property {Array<{image_id: string, admission_seq: number, status: JobStatus}>} up_next
 * @property {string|null} statistics_window
 * @property {number|null} mean_inference_ms
 * @property {number|null} p95_inference_ms
 * @property {number|null} throughput_model_jobs_s
 *
 * @typedef {Object} UpdateEvent
 * @property {number} event_id
 * @property {string} batch_id
 * @property {string|null} [image_id]
 * @property {ModelKey|null} [model_key]
 * @property {string} event_type
 * @property {number|null} version
 * @property {IsoUtc} created_at
 * @property {unknown} payload
 *
 * @typedef {Object} Connection
 * @property {string} status
 * @property {string|null} message
 * @property {string|null} public_url
 * @property {string|null} error_code
 * @property {boolean} requires_pairing
 * @property {boolean} local_operator
 * @property {string} [pair_code]
 * @property {string} [connect_url]
 *
 * @typedef {{image_id: string, file_index: number, admission_seq: number, duplicate?: boolean, input_error?: unknown}} AcceptedFile
 * @typedef {{file_index: number, filename: string, code: string, message: string, http_status: number}} RejectedFile
 * @typedef {{accepted: AcceptedFile[], rejected: RejectedFile[], retryAfterMs?: number}} Admission
 * @typedef {{images: Image[], page: number, limit: number, total: number}} ImagePage
 * @typedef {{page?: number, limit?: number, search?: string, status?: JobStatus|"TERMINAL", fruit?: Fruit, quality?: Quality, agreement?: "agreement"|"disagreement", sort?: "newest"|"oldest"}} ImageQuery
 * @typedef {{events: UpdateEvent[], cursor: number}} EventPage
 * @typedef {{status: string, time: unknown}} Health
 * @typedef {{ready: boolean, storage_ready: boolean, device: string|null, models: unknown}} Readiness
 * @typedef {{lanes: Lane[]|Record<ModelKey, Lane>, provenance: unknown}} Queues
 * @typedef {{collections: number, photos: number, local_operator: boolean, all_collections: number|null, all_photos: number|null}} Settings
 * @typedef {{deleted: {collections: number, photos: number, cleanup_pending: number|boolean}}} Deletion
 * @typedef {{provenance: unknown, metrics_source: unknown, models: unknown, stress: unknown, quality_by_fruit: unknown, manifest: unknown, training_versions: unknown, unavailable: unknown}} Research
 * @typedef {{title: string, note: string, provenance: unknown, png: string|null, pdf: string|null}} Figure
 * @typedef {{figures: Figure[], unavailable: unknown}} Figures
 * @typedef {"connecting"|"live"|"reconnecting"|"polling"|"capacity"|"unavailable"|"removed"} WatchStatus
 * @typedef {Object} WatchOptions
 * @property {number} [cursor]
 * @property {(events: UpdateEvent[], cursor: number) => void|Promise<void>} [onEvents]
 * @property {(id: string) => void} [onRemoved]
 * @property {(status: WatchStatus, error?: Error) => void} [onStatus]
 * @property {(context: {cursor: number, signal: AbortSignal}) => void|Promise<void>} [onRecover]
 */
