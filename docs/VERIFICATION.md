# Verification

Repository cleanup checked on **16 November 2026 (Asia/Singapore)** using Windows 11, Python 3.14.5, CPU PyTorch 2.13.0, and Node 22.17.1.

## Current checks

| Check | Result |
| --- | --- |
| Python regression suite | 56 tests; API access, ownership, admission, FIFO, leases, cancellation, retention, reset, tunnel lifecycle, real model parity, and real supervisor pipeline |
| Frontend tests | 11 passing tests for event replay, versioned snapshots, upload retries and selection, camera cleanup, operator reads, and research formatting |
| Frontend asset integration | Flask serves every imported JavaScript module, stylesheet dependency, and local image; path traversal is rejected |
| Browser smoke | Real upload produced three checkpoint results; collection navigation, all five Operator tabs, confirmed reset, and cleanup passed |
| Browser resources | No uncaught exceptions or failed resource responses in the smoke workflow |
| Artifact audit | All three checkpoints load strictly; logit and probability differences from the reference helper are 0.0 across three deterministic fixtures per model |

The browser smoke used a disposable private instance with ngrok disabled. Its reset affected only that test instance. [Browser evidence](evidence/browser-smoke.json) records the checked workflows. [Artifact evidence](evidence/artifact-audit.json) records the current inventory and model metadata.

## Reproduce

```powershell
.venv/Scripts/python.exe -m pip install -r requirements-dev.txt
.venv/Scripts/python.exe -m pytest -q
node tests/test_frontend.mjs
.venv/Scripts/python.exe -m scripts.audit_artifacts --output test-results/artifact-audit.json
```

The Python suite includes a real supervisor launch on an unused port and a temporary instance, three checkpoint workers, HTTP uploads, nine completed model jobs, and graceful shutdown. The frontend suite uses isolated transport and state fixtures to exercise browser race conditions and recovery.

## Retained measurements

These earlier reports describe the original runs and are retained as historical evidence:

- [Load report](evidence/load-test.json): 1, 10, 50, and 100 synthetic images through real checkpoints.
- [Restart report](evidence/restart-load-test.json): recovery after terminating an explicitly owned model worker, with unique committed results and FIFO preservation.
- [Phone report](evidence/phone-access-check.json): HTTPS pairing, inference, event replay, and export through the installed ngrok tunnel.

Load timings depend on the host and concurrent work. The current cleanup did not repeat the public ngrok diagnostic. Synthetic uploads verify infrastructure and reference parity; they do not establish accuracy on camera photographs. CUDA and camera-domain recognition accuracy remain unverified.
