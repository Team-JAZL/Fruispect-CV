# Verification

Global Collections checked on **18 November 2026 (Asia/Singapore)** on Windows using the repository Python environment, CPU checkpoints, Node, and an isolated headless Edge browser.

## Current checks

| Check | Result |
| --- | --- |
| Python regression suite | 75 passing tests; host-only global access, session isolation, durable device attribution, idempotency, scoped deletion, FIFO, leases, retention, reset, tunnel lifecycle, real model parity, and real supervisor pipeline |
| Frontend tests | 25 passing tests; scoped transport, gallery IDs and source escaping, stale discovery, isolated selection, event replay, uploads, camera cleanup, operator reads, motion, and research formatting |
| Frontend asset integration | Flask serves every imported JavaScript module, stylesheet dependency, and local image; path traversal is rejected |
| Global Collections browser smoke | Host-only navigation, retained device thumbnails, result/source dialogs, automatic discovery of another upload, personal isolation, remote direct-link/API denial, and desktop/390px layouts passed |
| Browser exceptions | No uncaught exceptions in the Global Collections workflow |
| Retained artifact audit (16 November) | All three checkpoints load strictly; logit and probability differences from the reference helper are 0.0 across three deterministic fixtures per model |

The [Global Collections browser evidence](evidence/global-collections-smoke.json) uses a disposable instance with ngrok disabled and separate browser sessions. Screenshots were inspected at 1440px and 390px widths. The new API tests cover paired HTTPS tunnel denial and source reporting, restart/disconnection persistence, and shared retention. The supervisor test also reads all nine real checkpoint results through a fresh host session's Global Collections API.

[Earlier browser evidence](evidence/browser-smoke.json) records the original real-upload, Operator tab, reset, and cleanup workflow. [Artifact evidence](evidence/artifact-audit.json) records the retained inventory and model metadata.

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
