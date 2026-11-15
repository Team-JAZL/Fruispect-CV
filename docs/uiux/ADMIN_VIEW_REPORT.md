# Fruispect: Admin / operator view

This describes the requested operational experience and identifies which parts the current backend can supply. **The application has localhost operator capabilities, not an implemented Admin account or role system.** See the [system report](SYSTEM_INPUT_OUTPUT_REPORT.md) for API details and the [User report](USER_VIEW_REPORT.md) for the public-facing journey.

## 1. Access and scope

For the first integration, an **Operator console** can use server-provided `local_operator` to identify the localhost operator. Do not implement a client-side toggle that grants privileges. Existing collection/image endpoints remain browser-session scoped even when called from localhost.

A future authenticated Admin who can inspect every browser's requests requires backend authorization and new global request APIs. Moving a panel into an Admin layout does not make its endpoint private: `/api/queues` currently exposes global lane telemetry to callers who pass existing access/pairing checks.

Use explicit screen/data scope:

- **Global model activity** for queue telemetry, which spans browser sessions.
- **This browser's requests** for currently accessible batch/image detail.
- **All requests** only after a protected cross-session API is implemented.

Avoid invented user names/emails. Current ownership uses an opaque browser session and the existing batch response does not expose that session ID.

## 2. Admin input and controls

| Control | Current support |
| --- | --- |
| Select an owned collection or image | Existing snapshot APIs |
| Filename/status/fruit/quality/agreement filters; pagination/sort | Existing owned-collection image API |
| Inspect model health and current/upcoming work | Existing global queue API |
| Cancel own image/collection's unfinished work | Existing POST commands |
| Export own collection as CSV/JSON | Existing export API |
| Delete own collection(s) | Existing deletion APIs |
| Reset every browser's scan data | Localhost-only endpoint; type `RESET` |
| Inspect phone connection, copy link/code, retry phone connection | Link/code and retry are localhost operator capabilities |
| Search/list/cancel/export another browser's requests | Requires new protected Admin APIs |
| Log in as Admin / manage users or roles | Requires authentication/authorization work |
| Pause a lane, reorder/prioritize jobs, switch checkpoints, retrain, restart workers from UI | No current HTTP controls; exclude from the initial design |
| Change runtime limits or retention in a settings form | Environment configuration exists; no settings-update API |

## 3. Overview dashboard

Show three model health cards. Registry states are **LOADING, READY, UNAVAILABLE, OFFLINE**; READY can still have an active RUNNING job. Worker availability and job activity are different concepts.

For each lane, the existing response provides:

- Model key/display name, device, checkpoint/preprocessing hashes, validation timestamp, last error, metadata including model/framework information and process PID when registered successfully.
- Counts grouped by job status across retained data.
- `queue_depth`, which counts WAITING_FOR_INPUT and QUEUED jobs, excluding the active job.
- `active`: current image ID, global admission sequence, start time, and `active_duration_ms` alongside it.
- `up_next`: at most the next eight waiting/queued jobs, ordered by admission sequence.
- Mean inference time, p95 inference time, throughput in model jobs/second, and the explicitly named statistics window.

Performance uses the **last 100 retained completed jobs per model**. Throughput includes observed idle time. These are not live accuracy measurements or the same benchmark as research throughput. Use unavailable states when no completed sample exists.

`GET /api/readiness` supplies storage readiness and model states, with HTTP 503 until fully ready. A degraded model does not imply all healthy models stopped. `GET /api/settings` provides global collection/photo counts only for the local operator. There are no current disk-usage, CPU-utilization, RAM, GPU-utilization, request-rate, or historical time-series endpoints; do not invent monitoring charts or usage gauges.

## 4. Request list and request detail

Define a **request/collection** as a batch containing photos. Define a **model job** as one model checking one photo. One accepted photo creates three model jobs. Keep these units explicit in cards, tables, and exports.

For current-session batches, show creation time, batch ID, status, accepted count, terminal-photo count, partial results, failed/unavailable-photo count, cancelled-photo count, rejected submissions, waiting jobs, and running jobs. Some categories overlap. Call `fully_complete` **Finished photos**, not **Successful photos**.

Inside an image detail panel, show:

- Image ID, collection ID, global admission sequence, filename, dimensions, thumbnail, received time, retention timestamp, input status/error.
- Three independent model rows: status, version, attempt count, queued/started/completed timestamps, cancellation requested, and error code/message.
- Completed model predictions, both confidences, all six fruit probabilities and two quality probabilities.
- Queue wait, preprocessing, inference, and end-to-end timings with units and definitions. Do not sum these timings as independent segments: queue wait includes time measured from admission, and preprocessing overlaps that interval.
- Checkpoint/preprocessing hashes, device, framework versions, seed/best epoch, parameters, and smoke-test shapes where available.
- Fruit/quality comparison and complete/provisional/incomplete scope.
- A chronological event list for this owned batch. Event records are a retained activity feed, not a permanent security audit log.

An **All requests** list is a planned integration surface. Its cross-session rows, detail access, activity stream, owner labels, search, and admin commands must remain explicitly unavailable or clearly marked as design fixtures until protected server endpoints exist. Do not call session-owned routes with another browser's IDs and assume they will work.

## 5. Live progress display

Use a three-lane queue visualization and per-photo model-state matrix. Surface real stage transitions and results, not an animated inference percentage.

Possible labels:

- **Preparing input** for WAITING_FOR_INPUT.
- **Queued** for a waiting job; **Retry pending** when status/attempt/error data indicate a retry.
- **Running - elapsed 4.2 s** using active-lane telemetry, rather than predicting remaining time.
- **2 successful / 3 checks ended** when one ended in failure.
- **Cancellation requested** while a running pass is still active.

The queue API does not supply a complete per-image queue-position field. It exposes an active job and the next eight jobs; identify a photo as upcoming when observed, otherwise show its queued state. Admission sequence is an ordering identifier, not the number of jobs ahead.

A collection progress bar may use `fully_complete / accepted`, labeled **accepted photos with all checks ended**. Failed/unavailable/cancelled checks count toward ended work. Do not divide by `total_submitted` for model completion because rejected submissions do not create jobs. A cancelled batch can still have a running pass finishing.

Use batch SSE for event-driven image refresh and separate queue polling. Show reconnecting/stale states, last refreshed time, and retained results. A server restart may requeue a job; do not treat that as a new user request.

## 6. Research, data management, and phone connection

**Research:** Show saved held-out fruit/quality/joint accuracy and macro precision/recall/F1, per-fruit quality, controlled photographic stress results, original benchmark timings, parameter counts, checkpoint sizes, manifest/version information, and figure PNG/PDF links. Label provenance such as **Held-out Test**, **Controlled Stress Test**, and **Saved Research Artifact**. Missing artifacts are reported by the API and should have an unavailable state.

**Data management:** Own collection deletion and a distinct localhost-only global-reset area. Reset requires typing `RESET`; explain scope and show conflicts when uploads are active. The delete response includes `deleted.collections`, `deleted.photos`, and `deleted.cleanup_pending`; files held open by workers may be removed later. Reset preserves research/models and connection configuration. Do not make the UI claim immediate file deletion when cleanup is pending.

**Phone connection:** Display server status/message/error code and the current public URL. Only the local operator receives pairing code/automatic connect link when ready and may retry the tunnel. Remote visitors enter the code; they must not receive it through an unrestricted fixture or client constant. Phone-link failure must leave local scanning usable.

## 7. Backend additions needed for a full Admin experience

1. Decide whether Admin remains a localhost operator or becomes an authenticated role. Enforce the chosen boundary on the server, including telemetry endpoints assigned to Admin-only use.
2. Add protected paginated cross-session request listing and scoped request/image/event access, with defined global aggregates and allowed filters.
3. Add protected cross-session commands and exports only for the Admin actions actually approved for implementation.
4. Supply a capability/configuration response for permissions, available controls, input limits, and retention, rather than hard-coding them in UI components.

The frontend design can prepare an adapter/interface for these additions now. Proposed endpoints must be documented as **not implemented**; design preview fixtures must never be presented as real server data.
