# Fruispect

**See the Fruit. Know its Quality.** A local fruit recognition and visual quality research app. ResNet-18, MobileNetV3-Small, and EfficientNet-B0 independently predict six fruit classes and Good/Bad appearance.

Upload, paste, drop, or capture photos; compare live model results; review collections; export CSV/JSON; and inspect model queues and saved research in the Operator console. Inference runs locally using the included checkpoints.

## Quick start

Use Python 3.12 or 3.14. From the repository root in PowerShell:

```powershell
python -m venv .venv
.venv/Scripts/python.exe -m pip install torch==2.13.0+cpu torchvision==0.28.0+cpu --index-url https://download.pytorch.org/whl/cpu
.venv/Scripts/python.exe -m pip install -r requirements-lock.txt
.venv/Scripts/python.exe main.py
```

Open **http://127.0.0.1:5000** and wait for the three workers to report **Ready**. After setup, `./start.ps1` launches the same application. On Linux/macOS, use `.venv/bin/python`.

Stop with **Ctrl+C**, or run `.venv/Scripts/python.exe -m scripts.stop` from another shell. Accepted work survives restart. Launch through `main.py` so the supervisor starts and monitors the web server and all three workers.

## Using Fruispect

1. Choose Photo, Batch, or Camera, review your inputs, then select **Check fruit**.
2. Compare each model's results as they arrive. Selecting another photo preserves that selection while earlier jobs finish.
3. Open **Collections** to filter, cancel, export, or delete this browser's scans.
4. Open **Operator console** for readiness, FIFO queues, owned request details, research, connection settings, and localhost reset controls.

Collections belong to browser sessions and are normally retained for 24 hours. Clearing cookies removes access to that session's history. Export anything needed before deleting or resetting scans.

For a phone camera, install and configure ngrok, then use the pairing link shown by the desktop application. Set `$env:FRUISPECT_NGROK = '0'` before launch for local-only operation. See [configuration and phone access](docs/CONFIGURATION.md).

## Repository layout

| Path | Responsibility |
| --- | --- |
| `main.py`, `start.ps1` | Application launchers |
| `app/api/` | Routes grouped by collections, images, events, research, and settings |
| `app/runtime/` | Supervisor, web process, instance lock, and child process ownership |
| `app/inference/` | Checkpoint adapter and recorded preprocessing |
| `app/queue/` | Durable FIFO coordination and model workers |
| `app/connection/` | Portable ngrok discovery, lifecycle, and connection state |
| `app/services/` | Image admission, retention, research data, and API snapshots |
| `app/storage/` | SQLite connections, schema, events, and job transitions |
| `frontend/assets/` | Browser shell, API transport, workspace/operator modules, and styles |
| `scripts/`, `tests/` | Diagnostics, real inference checks, and regression tests |
| `trained-outputs/` | Checkpoints, reference helper, experiment metadata, tables, and figures |
| `instance/`, `test-results/` | Ignored runtime data and local verification outputs |

Flask serves the maintained frontend directly; no frontend build is required. See the [frontend guide](frontend/README.md) and [architecture/API reference](docs/ARCHITECTURE.md).

## Development checks

```powershell
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m pytest -q
node tests/test_frontend.mjs
.venv/Scripts/python.exe -m scripts.audit_artifacts --output test-results/artifact-audit.json
```

Node 22+ is used for frontend tests. Python tests include real checkpoint parity and a complete supervisor startup, upload, inference, and shutdown cycle. Additional diagnostics:

```powershell
.venv/Scripts/python.exe -m scripts.predict path/to/fruit.jpg
.venv/Scripts/python.exe -m scripts.stress_test_queues --sizes 1 10 50 100
```

The stress command requires a running application and measures queue behavior using synthetic images. See [verification](docs/VERIFICATION.md) and [checkpoint/preprocessing details](docs/COMPATIBILITY.md).

Source files start with a one-line purpose comment. Named functions have one concise comment above their declaration; explanatory comments and docstrings do not clutter their bodies. Keep new code in the module responsible for its behavior.

## Research scope

Classes: **Apple, Banana, Guava, Lime, Orange, Pomegranate**; appearance: **Good, Bad**. The app assumes one principal fruit per photo. Scores are uncalibrated, and unsupported objects can receive confident predictions. Visual appearance does not establish food safety or internal freshness.

Keep the research bundle together and restart after intentional checkpoint or preprocessing changes. CPU operation is verified; CUDA is opt-in and requires validation on the target hardware. Local operation needs no internet after installation; the optional phone tunnel uses ngrok.
