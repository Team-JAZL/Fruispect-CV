# Fruispect

**See the Fruit. Know its Quality.** A local computer-vision research application for CCS 250. Real ResNet-18, MobileNetV3-Small, and EfficientNet-B0 checkpoints independently predict six fruit classes and Good/Bad visual appearance through two parallel heads.

Includes upload, paste, drag/drop, folder and batch intake, still camera capture and optional throttled sampling, live partial results, a paginated collection, disagreement filters, queue telemetry, CSV/JSON export, and a dashboard sourced from preserved research artifacts. Core operation requires no Internet connection after installation.

## Run on Windows

From this repository in PowerShell, using Python 3.14 (tested: 3.14.5):

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install -r requirements-lock.txt
.venv/Scripts/python.exe -m scripts.audit_artifacts --output test-results/artifact-audit.json
.venv/Scripts/python.exe main.py
```

Open **http://127.0.0.1:5000**. `./start.ps1` is an alternative launcher after setup. Wait for **Ready**. `main.py` supervises the web process and exactly three dedicated model processes, restarts crashed workers, and holds an OS lock against duplicate supervisors. Do not use `flask run` to launch workers. Stop with Ctrl+C; queued work survives restart. Each current forward pass gets up to 45 seconds before a stuck process is terminated and recovered later.

From another shell, `.venv/Scripts/python.exe -m scripts.stop` requests the same graceful shutdown for the configured instance. Keep checkpoint/preprocessing files unchanged while running; restore consistent research metadata and restart after any intentional artifact update.

The provisioned `.venv` uses `--system-site-packages` to reuse installed CPU PyTorch. The commands above describe a clean setup. On Linux/macOS, use `.venv/bin/python` for equivalent commands. CPU is verified. Runtime pins are newer than training's PyTorch 2.11.0/TorchVision 0.26.0; strict load and reference parity were verified on the pinned runtime. See [compatibility](docs/COMPATIBILITY.md).

For offline installation, prepare wheels on a connected machine with matching OS/Python, then transfer locally:

```powershell
python -m pip download -r requirements-lock.txt -d wheelhouse
.venv/Scripts/python.exe -m pip install --no-index --find-links wheelhouse -r requirements-lock.txt
```

No model downloads, retraining, external inference, CDN, or cloud database are used. Keep `trained-outputs` intact. Missing/incompatible models become unavailable with diagnostic messages while healthy lanes continue.

## Use a phone camera

Running `main.py` also looks for ngrok and starts an HTTPS phone link automatically. Local scanning starts immediately while the tunnel connects. The terminal prints the phone URL and an eight-character pairing code; **Use your phone** in the desktop's Add a photo panel shows a copyable link that pairs automatically. Open that link on the phone, choose Camera, and grant camera permission. If preview capture is unsupported, use **Use phone camera instead**, or upload a photo.

Discovery checks `FRUISPECT_NGROK_PATH`, project-local `ngrok.exe`/`tools/ngrok.exe`, `PATH`, the supplied `D:/App Projects/z_ngrok-v3-stable-windows-amd64/ngrok.exe`, nearby ngrok folders, and common Desktop/Downloads locations. Other computers can put ngrok in the project or on PATH; no machine-specific edit is required. No whole-drive search, automatic download, account creation, or configuration change occurs.

ngrok must already have its account/authtoken configured and Internet access. On a fresh computer, follow the [official ngrok setup](https://ngrok.com/docs/getting-started/) once. If the executable is absent, cannot start, cannot authenticate, or times out, the app stays available on localhost. Set `$env:FRUISPECT_NGROK='0'` to skip tunnel startup entirely.

Only the current HTTPS tunnel host is accepted. Public APIs require pairing, codes rotate on each launch, failed attempts are limited, and HTTPS session cookies are Secure/HttpOnly. The app disables ngrok's local request inspection and stops only the ngrok process it started during shutdown. On Windows, an OS job also closes that child if the supervisor is force-closed. A phone has its own browser collection/session. **Phone uploads travel through ngrok; inference and storage stay on the desktop.** Localhost operation can remain fully offline.

**Settings > Phone connection** shows connection diagnostics and lets the local operator retry without restarting the app. Startup explicitly enables informational ngrok logs so saved log-level preferences cannot hide a successful connection. Account conflicts and authentication errors show the ngrok error code with the next step; unrelated ngrok processes are never stopped.

For an optional live diagnostic, `.venv/Scripts/python.exe -m scripts.check_phone_link` creates a temporary health-only server on a random loopback port, checks its public ngrok response, and closes everything automatically. It does not forward to the application or access saved scans. This diagnostic briefly exposes only a fixed health response publicly.

## Configuration

Set environment variables before launching. `.env.example` is a reference, **not automatically executed**:

```powershell
$env:FRUISPECT_THREADS = '2'
$env:FRUISPECT_RETENTION_HOURS = '24'
$env:FRUISPECT_PORT = '5000'
.venv/Scripts/python.exe main.py
```

| Variable | Default | Meaning |
| --- | --- | --- |
| `FRUISPECT_ARTIFACTS` | `trained-outputs` | Trusted research directory |
| `FRUISPECT_INSTANCE` | `instance` | Private DB, session key, spool |
| `FRUISPECT_DEVICE` | `cpu` | Device; CUDA opt-in, unverified here |
| `FRUISPECT_THREADS` | `2` | Intra-op threads per model worker |
| `FRUISPECT_MAX_FILE_MB` | `12` | File limit; max four files per API chunk |
| `FRUISPECT_MAX_PIXELS` | `24000000` | Decoded pixel limit |
| `FRUISPECT_MAX_BATCH` | `1000` | Accepted images per batch |
| `FRUISPECT_MAX_QUEUE` | `1500` | Pending + running jobs per model |
| `FRUISPECT_MAX_SPOOL_MB` | `2048` | Total spool budget, including raw-upload headroom |
| `FRUISPECT_UPLOAD_SLOTS` | `2` | Concurrent uploads; excess gets 429 |
| `FRUISPECT_RETENTION_HOURS` | `24` | Expired terminal batches are removed |
| `FRUISPECT_HOST` | `127.0.0.1` | Loopback by default |
| `FRUISPECT_ACCESS_TOKEN` | unset | LAN requires >=20 characters; Basic auth password |
| `FRUISPECT_NGROK` | `auto` | Start installed ngrok automatically; `0` disables it |
| `FRUISPECT_NGROK_PATH` | auto-discover | Optional explicit executable path |
| `FRUISPECT_NGROK_TIMEOUT` | `20` | Connection timeout in seconds, then local fallback |

Local use has browser sessions, same-origin POST checks, and `X-Fruispect: 1` command headers. LAN hosting requires HTTPS, network access controls, and the access token. Browser Basic login uses any username and the token as password. A reverse proxy must preserve Host/Origin, permit SSE, and disable buffering for `/api/events`. Camera requires localhost or HTTPS; remote LAN HTTP generally cannot access a camera.

Three CUDA processes share physical GPU resources. This build provides opt-in CUDA with synchronized timing but **does not claim verified GPU capacity or performance**. Use CPU until concurrent VRAM/contention has been tested on target hardware. Reduce worker thread counts if six inference threads oversubscribe the host.

## Workflows

1. Choose Upload, Batch, or Camera. Review files/captured still, then analyze. Stable per-file keys make network retries idempotent. Invalid files are reported individually. Accepted jobs continue after browser disconnect.
2. Results appear one model at a time. Select any collection row without affecting FIFO. Fruit/quality filters match any successful model; three-model agreement requires all three to succeed. Disagreement may be provisional.
3. Inspect each lane's current/upcoming admissions. Mean/p95 use the last 100 retained completed jobs. Throughput is per-model jobs/sec, including observed idle time.
4. Refresh or restore a recent batch in the same browser session. Snapshots/events reconcile by immutable IDs and versions. Clearing browser cookies removes access to previous session batches.
5. Check again to retry unaccepted files. `Check selected photos again` creates fresh keys for an intentional repeat. Cancellation preserves completed results; running forward passes finish and discard their late result.
6. Export CSV/JSON observations. No accuracy is calculated for unlabeled photographs. Research evidence is separately labeled with original benchmark provenance.
7. The collection sits beside Add a photo and defaults to **Newest First**. Each new accepted upload selects its own results; selecting an older row keeps that photo selected while late results arrive.
8. Open **Settings** to delete the current collection or all collections belonging to this browser. **Reset all data**, available only from localhost, requires typing `RESET` and removes every browser's saved scans, photos, results and activity. Research artifacts, models and connection settings remain available. Export anything needed first. Uploads must finish before deletion; running results are discarded, and files briefly held open by a worker are retried automatically. Open collection views clear when their collection is removed.

Images are decoded, EXIF-corrected, converted to RGB, and processed exactly like the helper. Workers share one immutable canonical PNG. Animations are rejected. Alpha is discarded to match the helper; letterbox padding is gray. Original uploads are removed after intake; metadata-stripped thumbnails/canonical pixels and results remain under retention. Active jobs retain input past nominal expiry. SQLite stores metadata/paths, not image blobs. Protect the runtime directory with operator-only filesystem access.

## Verify

```powershell
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m pytest -q
& 'C:/Program Files/nodejs/node.exe' tests/test_frontend.mjs
.venv/Scripts/python.exe -m scripts.audit_artifacts --output test-results/artifact-audit.json
# With main.py running:
.venv/Scripts/python.exe -m scripts.stress_test_queues --sizes 1 10 50 100
# Developer-facing real prediction:
.venv/Scripts/python.exe -m scripts.predict path/to/fruit.jpg
```

Use `node` directly if on PATH; it is needed only for the frontend unit test. Stress inputs are synthetic images through actual checkpoints: this proves queue/load behavior, not recognition accuracy. Restart testing can use `--restart-owned-supervisor PID`; only a worker whose parent matches that explicitly supplied supervisor PID is terminated.

See [verification and limits](docs/VERIFICATION.md), [architecture/API](docs/ARCHITECTURE.md), [artifact audit](docs/artifact-audit.json), [load results](docs/load-test.json), and [restart results](docs/restart-load-test.json).

## Research scope

Fruit order: Apple, Banana, Guava, Lime, Orange, Pomegranate. Quality order: Good, Bad. All models were trained from scratch. Each quality head receives shared backbone features, not a hard fruit prediction. Confidence is uncalibrated. Good/Bad describes visible appearance, not food safety, contamination, or internal freshness. One principal fruit is assumed. Arbitrary objects and unsupported fruits can receive confident trained-class predictions.

