# Verification evidence

Verified on Windows 11 / Python 3.14.5 / CPU, 7 November 2026 (Asia/Singapore). Models and original research artifacts were preserved. This is measured local evidence, not a hardware-independent performance promise.

## Automated checks

- **37 Python tests passed** (81.93 s with the concurrent phone-link service running), including actual strict checkpoint loading and reference parity, dual-head finite shapes, deterministic preprocessing and hash compatibility, EXIF/alpha/no-upscale handling, independent FIFO advancement, waiting-input head blocking, retry-at-head/backoff/budget, stale-owner fencing, heartbeat/restart recovery, duplicate completion suppression, running cancellation/result discard, terminal state protection, concurrent sessions, concurrent duplicate admission, partial acceptance, decompression/pixel/byte/animation/decode validation, session/origin/host checks, capacity limits and replay under saturation, event replay/SSE, export, cleanup, missing-artifact states, the real multiprocess supervisor pipeline with graceful shutdown, portable ngrok discovery/fallback/timeout/cleanup, and HTTPS phone pairing/expiry/origin/rate-limit protection.
- Batch integrity tests cover 1, 10, 50, and 100 accepted inputs with exact three-job fan-out and idempotent retries.
- Node reconciliation test passed: a late image #2 event leaves image #50 selected; duplicate and stale job versions are ignored. JavaScript syntax checks passed.
- After adding the bound-socket startup guard, all 12 focused ngrok/supervisor checks passed. The suite now contains 38 tests. A subsequent real `main.py` launch also passed automatic HTTPS, pairing, nine real inference results, SSE, export, and graceful tunnel/worker shutdown.
- Actual HTTP server returned 200 for the workspace and all local JS/CSS/SVG assets. Flask API integration verifies authentic evaluation endpoints and all 31 cataloged figures.
- The refreshed frontend's 69 literal JavaScript element bindings resolve to unique template IDs; all four local script/stylesheet/illustration/icon assets return HTTP 200. Layout uses a cream/green agricultural palette, collapsed filters/metrics, 44-pixel primary controls, stacked phone result cards, and a mobile card layout for the collection. Layout appearance remains unverified visually.
- [Artifact audit](artifact-audit.json): all three CPU smoke tests pass; maximum logit/probability discrepancy against original helper is **0.0** across RGB/RGBA/grayscale fixtures for every model. All 133 original artifact SHA-256 values remained unchanged.

## Real-service batch evidence

[Recorded load results](load-test.json) use synthetic image pixels through HTTP ingestion, durable queues, and the **actual saved checkpoints**. These fixtures test infrastructure and timing, not fruit recognition accuracy. No artificial delays or synthetic classifier outputs exist in production.

| Images | Actual completed model jobs | Wall time | Fully processed images/s | Summary HTTP p95 |
| ---: | ---: | ---: | ---: | ---: |
| 1 | 3 | 0.63 s | 1.58 | 24.0 ms |
| 10 | 30 | 2.40 s | 4.17 | 51.4 ms |
| 50 | 150 | 8.67 s | 5.77 | 61.8 ms |
| 100 | 300 | 16.17 s | 6.18 | 51.1 ms |

For 100 images: per-model mean forward times were ResNet 81.7 ms, MobileNet 45.2 ms, EfficientNet 90.1 ms. End-to-end p95 across model jobs was 4.96 s. Observed peak summed worker RSS was approximately 941 MiB (shared pages may be counted more than once). Spool use across the retained synthetic test runs remained below 1 MiB because these fixtures compress strongly; real photographic storage is larger and admission reservations enforce the configured limit. Upload duration, API queries, disk activity, idle polling, and hardware contention affect these measurements.

[Restart load evidence](restart-load-test.json): 100 more images, one explicitly owned EfficientNet worker terminated and replaced, all 300 results completed exactly once in per-model admission order. The run took 93.27 s while model tests also ran on the host; this includes lease expiry, Python/model startup, and CPU contention. Faster-lane advancement was observed before a slower model completed the previous image; event IDs proving this overlap are saved in the report. A recovered forward may execute again, but no committed result was duplicated or lost.

## HTTPS phone access

[Phone access evidence](phone-access-check.json) records a real `main.py` launch with the installed ngrok 3.39.0. Automatic HTTPS endpoint discovery, anonymous API denial, pairing, three uploaded synthetic photos through all three actual checkpoints (nine results), independent FIFO overlap, SSE replay over HTTPS, and JSON export all passed. ngrok was launched with local inspection disabled, and its existing account configuration was reused without modification. Its public tunnel is temporary and closes with the application. Network restrictions in the sandbox required an approved network-enabled execution for this live check; the same launcher code was used.

The connection link/pairing code are visible only on the local desktop interface and console. Public visitors must pair before any model/batch/image/evaluation API access. Tests also prove missing-executable fallback, timeout fallback, rejection of arbitrary hosts and rewritten HTTPS localhost, secure cookies, wrong-code limiting, and grant invalidation on expiry/restart. No QR-code service or external frontend dependency is required.

## Verification boundaries

- The computer/browser access host was unavailable. Browser visual screenshots, interactive mobile/responsive layout, keyboard/screen-reader behavior, actual EventSource reconnection in a browser, and physical camera permission/capture remain **unverified interactively**. Template/asset HTTP checks, backend SSE/replay tests, reconciliation tests, and CSS reduced-motion/responsive rules are present.
- This host has CPU PyTorch. CUDA correctness, VRAM capacity, three-process GPU contention, and GPU benchmarks were not exercised. CPU is the supported verified default.
- The repository has no original dataset photos or independent camera dataset. No new real-photo accuracy claim is made. Research numbers retain their held-out/stress provenance.
- A 300-image optional stress run was not performed. The required 100-image admission and actual-inference runs passed. Timing is specific to this host and workload.
- Cross-machine/public hosting, multi-host queues, calibrated confidence, reliable unsupported-fruit rejection, food safety, and multi-object detection are outside the model/application contract.

## Traceability

| Requirement | Implementation / evidence |
| --- | --- |
| FR-01 / FR-18 Camera and throttled sampling | Browser module; 5 s interval, skip before acceptance above backlog 20; hardware UI verification outstanding |
| FR-02 / FR-03 Upload and large batches | Bounded per-file frontend requests; ingestion validation/reservations; 100-image service evidence |
| FR-04 / FR-05 / FR-06 Real models and transform | ModelAdapter, preserved helper, compatibility audit, parity tests |
| FR-07 / FR-08 Independent queues/partial results | Coordinator, dedicated workers, transactional events, delay harness and actual overlap evidence |
| FR-09 Timing/confidence | Separate head softmax, synchronized CUDA timer path, queue/preprocess/forward/end-to-end fields |
| FR-10 / FR-11 Collection/export/disagreement | Server pagination/filters, versioned state, qualified comparison, streaming export |
| FR-12 Queue monitor | Independent lane status/current/upcoming work, retained-window mean/p95/model-jobs throughput |
| FR-13 Evaluation | Authentic manifest/CSV/catalog with missing states and provenance |
| FR-14 Recovery/cancel/idempotency | Lease fences, supervisor restart, cancellation discard, stable keys, SSE replay and snapshots |
| FR-15 Offline | Local modules/assets/checkpoints/SQLite; no runtime external service |
| FR-16 Retention | Terminal-only whole-batch cleanup, active-input preservation, controlled orphan sweep |
| FR-17 Unavailability | Separate registry health and per-job terminal unavailable states; healthy lanes independent |

Timing definitions: `preprocess_ms` measures intake/validation/canonical preparation; `inference_ms` measures the final real forward only; `queue_wait_ms` is admission-to-final-start wall time (including input preparation and any prior retries); `end_to_end_ms` is admission-to-result wall time. These overlapping durations should not be summed. UI responsiveness here is supported by HTTP latency and bounded state, not an unperformed browser interaction benchmark.
