# Fruispect: code-based inputs, outputs, and integration report

Reviewed: 11 November 2026. This report describes the current source code, rather than assuming every feature in an earlier implementation prompt exists. No runtime predictions or performance measurements were generated for this review.

Related deliverables:

- [User-only view report](USER_VIEW_REPORT.md): input, loading, output, and collection management.
- [Admin view report](ADMIN_VIEW_REPORT.md): request progress, model activity, diagnostics, and implementation gaps.
- [Copy-ready ChatGPT UI/UX prompt](../../references/FRUISPECT_UIUX_DESIGN_PROMPT.md): self-contained instructions for creating the frontend that will later be returned to this repository.

## 1. What the application actually does

Fruispect accepts still photographs and classifies one principal fruit and its visible quality. Each accepted image creates three independent model jobs:

| API model key | Display name | Outputs per image |
| --- | --- | --- |
| `resnet18` | ResNet-18 | Fruit prediction, quality prediction, and associated scores |
| `mobilenet_v3_small` | MobileNetV3-Small | Fruit prediction, quality prediction, and associated scores |
| `efficientnet_b0` | EfficientNet-B0 | Fruit prediction, quality prediction, and associated scores |

Fruit labels, in class-index order: **Apple, Banana, Guava, Lime, Orange, Pomegranate**. Quality labels: **Good, Bad**.

The three workers have independent FIFO queues. One worker can finish and start another image while the other workers are still checking an earlier image. There is no combined final classifier, preferred-model selection, or implemented majority-vote verdict. The interface must preserve the three independent predictions.

## 2. Inputs

### End-user inputs

| Input | Current behavior |
| --- | --- |
| Single image | File picker, drag/drop, or clipboard image paste |
| Multiple images | Batch selection, drag/drop, or folder selection where the browser supports it |
| Camera still | Browser camera selection, preview, take photo, review/retake, then submit |
| Optional camera sampling | Current frontend captures/submits a still every 5 seconds; skips while uploading, the page is hidden, a lane is not ready, or a lane queue depth exceeds 20 |
| Native phone camera | File input with camera capture as a fallback; the returned file still undergoes server format validation |
| Phone pairing | Eight-character pairing code, or a desktop-generated link containing that code |
| Collection controls | New collection, restore a recent collection, select photo, search filename, sort, filters, cancel unfinished work, export, delete |

The accepted decoded file formats are **JPEG, PNG, and WebP**. Defaults are **12 MiB per file**, **24,000,000 decoded pixels**, and **1,000 accepted images per batch**. Animated images, empty files, corrupt images, and other decoded formats are rejected. For example, a phone returning HEIC does not make HEIC a supported backend format.

These limits are environment-configurable. The current HTML receives file/batch limits from Flask; there is no general capabilities endpoint returning all runtime limits. A new frontend should use an injectable configuration adapter until that information is provided through an agreed backend contract.

Image URLs, text descriptions, video-file analysis, continuous video inference, user-supplied labels, and choosing just one model are not implemented inputs.

### HTTP submission inputs

1. `POST /api/batches` creates a collection and returns `202 {batch}`. An optional `Idempotency-Key` makes creation replayable.
2. `POST /api/batches/{batch_id}/images` submits multipart form data. Field `images` contains **1-4 image files per request**, and optional `offset` is a nonnegative integer, defaulting to zero. The existing frontend sends one file per request.
3. Each image submission requires `Idempotency-Key` of at most 180 characters. Preserve the key, batch, file index, and content for retries; use a new key for an intentional new analysis.
4. All POSTs require `X-Fruispect: 1`, same-origin requests, and the appropriate browser session. Do not manually set the multipart `Content-Type` boundary.

Example response structure, with illustrative IDs:

```json
{
  "accepted": [
    {"file_index": 0, "image_id": "example-image", "admission_seq": 42, "duplicate": false}
  ],
  "rejected": [
    {"file_index": 1, "filename": "invalid.jpg", "code": "INVALID_IMAGE", "message": "Only decoded JPEG, PNG, or WebP images are accepted.", "http_status": 422}
  ]
}
```

A mixed response can be HTTP 202. It means accepted for processing, not successful inference. An accepted item can also contain `input_error` if preprocessing failed after admission; retain it as an accepted image with failed jobs. A repeated accepted submission returns its original image ID with `duplicate: true` when content matches. Changed content under the same accepted identity returns 409.

## 3. Processing and loading states

The backend validates and decodes images, corrects EXIF orientation, converts to RGB, prepares a 224 x 224 image with gray letterboxing, and applies the saved normalization. Each model uses a shared backbone with parallel fruit and quality heads. This preprocessing belongs to the backend.

| Model job status | Display meaning |
| --- | --- |
| `WAITING_FOR_INPUT` | Preparing the image |
| `QUEUED` | Waiting in this model's queue; may also be waiting for an automatic retry |
| `RUNNING` | This model is checking the image |
| `COMPLETED` | This model produced a result |
| `FAILED` | This model's check failed |
| `UNAVAILABLE` | This model cannot currently provide a check |
| `CANCELLED` | This check ended through cancellation |

Terminal statuses are `COMPLETED`, `FAILED`, `UNAVAILABLE`, and `CANCELLED`. `image.terminal` means all three jobs ended. It does **not** mean all three succeeded. Input status is independently `PROCESSING`, `READY`, or `FAILED`.

There is no inference percentage or reliable ETA. Use stage labels, elapsed time where available, and counts such as **2 of 3 models returned results**. A calculated collection completion percentage must be labeled as accepted photos whose checks have ended, including failures/cancellations; it is not model computation progress. An empty collection has no progress denominator.

Cancellation flags a running job with `cancel_requested`; the current computation finishes and its late result is discarded. Already completed results remain. Failed inference jobs may automatically requeue, with at most three attempts by default. Terminal jobs are not restarted by a retry endpoint; an intentional rescan requires resubmitting the original image bytes with a new key.

## 4. Outputs

### Image and per-model result data

`GET /api/images/{image_id}` returns `{image}`. Image fields include IDs, global admission sequence, original filename, original oriented dimensions, received/retention timestamps, input status/error, preprocessing time/hash, `thumbnail_url`, `jobs`, `terminal`, and `consensus`.

`jobs` is keyed by the exact three model keys. Each job exposes its ID, status, version, attempt count, cancellation flag, queued/started/completed timestamps, timing values, error code/message, model checkpoint hash, and nullable `result`. Lease-owner/lease-expiry internals are omitted from this view.

| Completed `result` field | Meaning / presentation |
| --- | --- |
| `model_key`, `architecture` | Stable key and model name |
| `predicted_fruit`, `fruit_class_index` | Highest-scoring fruit class and its zero-based index |
| `fruit_confidence` | Score from 0 to 1; format as a percentage in the UI |
| `predicted_quality`, `quality_class_index` | Good/Bad prediction and its zero-based index |
| `quality_confidence` | Score from 0 to 1; format as a percentage |
| `fruit_probabilities` | All six fruit labels mapped to scores |
| `quality_probabilities` | Both quality labels mapped to scores |
| `inference_ms` | Timed model forward pass |
| `queue_wait_ms`, `preprocess_ms`, `end_to_end_ms` | Queue delay, input preparation, and receipt-to-result elapsed time; these are not additive independent stages |
| `device`, `framework_versions` | Execution device and Python/PyTorch/TorchVision versions |
| `checkpoint_sha256`, `preprocessing_sha256` | Result provenance |
| `seed`, `best_epoch`, `state_dict_tensors`, `parameters`, `smoke_shapes` | Saved-model metadata and validation details |

Null or missing values must show as unavailable, not zero. A failed/unavailable/cancelled job ordinarily has no result. Full per-class scores are available in the image API, but are not included in the current export columns.

`consensus` exposes `successful_models`, `fruit_disagreement`, `quality_disagreement`, and `scope`:

- `complete`: all three models succeeded.
- `provisional`: some jobs are still active.
- `incomplete`: all jobs ended, but fewer than three succeeded.

With fewer than two successful models, there is insufficient evidence to claim agreement. With two matching successes, agreement is still provisional or incomplete. Fruit and quality can disagree independently.

There are no bounding boxes, fruit counts within a photo, heatmaps, disease names, ripeness percentages, shelf-life predictions, safety certifications, or reliable unsupported-object detection.

### Collection and export outputs

The batch view returns `batch_id`, creation/cancellation timestamps, `status`, `event_cursor`, and `summary`.

| Summary field | Unit and semantics |
| --- | --- |
| `accepted`, `rejected`, `total_submitted` | Accepted images, recorded rejected submission identities, and their sum |
| `preprocessing` | Images whose input is being prepared |
| `fully_complete` | Images for which all three jobs are terminal, including failure/cancellation |
| `partial` | Images with at least one success and at least one active job |
| `failed` | Images with at least one FAILED or UNAVAILABLE job |
| `cancelled` | Images with at least one CANCELLED job |
| `queued` | WAITING_FOR_INPUT plus QUEUED **jobs**, across all three models |
| `running` | RUNNING **jobs**, across all three models |

Do not add these categories into a single total: several image counts overlap, and some fields count jobs. Rejected submission identities may reflect retries and are not guaranteed to represent unique physical files across an entire browsing session. Batch status `COMPLETED` means all accepted images ended; `CANCELLED` records collection cancellation and can coexist with a still-finishing running check. An empty batch is `ACTIVE`.

Collection pages expose `images`, `page`, `limit`, and `total`; default page size is 20, maximum 50. Filename search, status, fruit, quality, agreement/disagreement, and oldest/newest sorting are supported. Fruit/quality filters match any successful model. `COMPLETED` filtering means at least one completed model job; `TERMINAL` means every job ended. View sorting does not change processing FIFO order. Recent history returns at most 30 owned batches.

CSV/JSON export produces **one observation per image per model**, including pending/failed jobs, rather than one consolidated verdict. Columns: `image_id`, `admission_seq`, `filename`, `model_key`, `status`, `predicted_fruit`, `fruit_confidence`, `predicted_quality`, `quality_confidence`, `inference_ms`, `queue_wait_ms`, `preprocess_ms`, `end_to_end_ms`, `checkpoint_sha256`, `preprocessing_sha256`, `device`, `started_at`, `completed_at`, `error_code`, `error_message`.

## 5. Live updates and API integration map

| API | Output / purpose |
| --- | --- |
| `GET /api/health` | Liveness `{status, time}` |
| `GET /api/readiness` | `{ready, storage_ready, device, models}`; 503 while not fully ready |
| `GET /api/models` or `/api/queues` | `{lanes, provenance}`: global lane health, current/upcoming work, retained counts, rolling performance |
| `POST /api/batches`; `GET /api/batches` | Create collection; list this session's latest 30 collections |
| `GET /api/batches/{id}` | Collection summary and event cursor |
| `POST /api/batches/{id}/images` | Image admission; see multipart contract above |
| `GET /api/batches/{id}/images` | Paged image snapshots with filters |
| `GET /api/images/{id}`; `GET /api/images/{id}/thumbnail` | Image snapshot; metadata-stripped JPEG preview |
| `GET /api/events?batch_id={id}&after={cursor}` | Server-Sent Events, named `update` and `removed` events |
| `GET /api/batches/{id}/events?after={cursor}` | Polling fallback `{events, cursor}`; at most 200 events per response |
| `POST /api/images/{id}/cancel`; `POST /api/batches/{id}/cancel` | `{cancelled_or_requested}` counts targeted unfinished jobs |
| `GET /api/export/{id}?format=csv` or `json` | Download observation records |
| `GET /api/settings` | Own collection/photo totals; `local_operator`; global totals only for local operator |
| `POST /api/batches/{id}/delete` | Delete one owned collection |
| `POST /api/settings/collections/delete` | Delete this browser session's collections |
| `POST /api/settings/reset` | Localhost-only global reset; JSON `{"confirmation":"RESET"}` |
| `GET /api/connection` | Connection status/message/public URL, pairing requirement, local-operator capability; pairing code/link only for local operator when ready |
| `POST /api/connect` | JSON `{"code":"..."}`; returns `{paired:true}` on success |
| `POST /api/connection/retry` | Localhost-only phone-link retry request; returns 202 |
| `GET /api/evaluation/summary` | Saved held-out metrics, stress results, per-fruit quality, manifest/versions, unavailable artifacts |
| `GET /api/evaluation/figures` | Figure catalog with PNG/PDF URLs or null values |
| `GET /api/evaluation/artifact/{relative}` | Controlled research figure download |

Image-list query fields: `page`, `limit`, `search`, `status`, `fruit`, `quality`, `agreement` (`agreement` or `disagreement`), `sort` (`oldest` or `newest`).

Events include `event_id`, `batch_id`, optional image/model identifiers, `event_type`, `version`, ISO UTC `created_at`, and a small `payload`. Event payloads are not guaranteed to include predictions: fetch the affected image snapshot. Types include image admission/preparation/completion, model queue/start/completion/failure/unavailability/cancellation, and batch progress/cancellation. Use `event_id` and job `version` to reject stale updates; preserve selected-image identity. Reconnect with a cursor/Last-Event-ID and reconcile snapshots. Streams reconnect after a bounded lifetime and have an eight-listener limit. Poll queue telemetry separately. ISO times can be localized for display; some lane timestamps, such as `validated_at` and `active.started_at`, are Unix seconds.

Errors generally use `{error:{code,message}}`; per-file rejection objects have their own contract. Handle 401 pairing required, 403 access/origin/command-header rejection, 404 expired/deleted/not-owned collection, 409 conflicts or deletion during upload, 413 size limits, 422 invalid input, 429 capacity limits, 503 unavailable resources, and network/server errors. Observe `Retry-After` when supplied. Accepted jobs continue when the browser disconnects.

## 6. Persistence and access boundaries

Flask serves an existing HTML/CSS/ES-module frontend. Inference uses local PyTorch workers; SQLite stores metadata/results/events and local disk stores image derivatives. Basic scanning can work offline after installation. Camera capture requires localhost or HTTPS. Optional phone traffic passes through ngrok; inference/storage remain on the host.

There are no application accounts, named users, Admin role records, or role-login endpoints. Collections are owned by a browser cookie session, not by email or account. A phone has a separate session and collection history. Clearing cookies loses access to that browser's prior collections. `local_operator` is a server-derived localhost capability, not a general Admin role. Existing queue telemetry is global and is not currently limited to an Admin role.

Raw uploads are removed after intake. Only metadata-stripped thumbnails/canonical pixels and records remain under configurable retention (default 24 hours). Cleanup removes expired whole collections after every job ends; active work can retain images beyond nominal expiry. Deleted/expired resources return 404. Thumbnail previews are up to 384 x 384; no original-resolution photo-download endpoint exists.

Saved research metrics must be labeled by provenance. They do not measure accuracy of a newly uploaded unlabeled photo or guarantee present-host speed. Confidence is an uncalibrated model score. Good/Bad describes visible appearance, not food safety or internal freshness.

## 7. Source references

- [Routes and request/response contracts](../../app/api/routes.py)
- [Phone access routes](../../app/api/routes_connection.py)
- [Image, collection, and queue response construction](../../app/core/views.py)
- [Image admission and constraints](../../app/core/ingestion.py)
- [Preprocessing](../../app/core/preprocessing.py) and [saved preprocessing metadata](../../trained-outputs/preprocessing.json)
- [Model output construction](../../app/core/model_adapter.py)
- [Queue transitions, cancellation, and retries](../../app/core/queue_coordinator.py)
- [Database schema and event emission](../../app/storage/database.py)
- [Session/access checks and CSP](../../app/__init__.py)
- [Configuration defaults](../../app/config.py) and [retention/deletion](../../app/core/cleanup.py)
- [Current frontend](../../app/templates/index.html), [frontend orchestration](../../app/static/js/app.js), and [state reconciliation](../../app/static/js/state.js)
- [Research responses](../../app/core/evaluation.py)
