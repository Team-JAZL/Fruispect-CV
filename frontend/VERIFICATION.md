# HTML conversion verification

Checked the generated outputs in headless Microsoft Edge using a temporary Playwright QA environment. The delivered frontend needs no Playwright, Node, or dependency installation to open.

| Check | Observed result |
| --- | --- |
| Standalone JavaScript syntax | Bundled script passed Node syntax validation. |
| Direct file opening | Root `index.html` opened through `file://` with embedded CSS, logo, photo, and application script. |
| Scenario coverage | All 36 supplied preview scenarios rendered at both 1440 px and 390 px widths: 72 combinations. No page-wide horizontal overflow or uncaught JavaScript errors. |
| Navigation | Scan workspace, Collections, all five Operator tabs, and the mobile navigation drawer worked. |
| Preview upload | Selected the bundled sample photo, submitted it, and observed three independently completed model cards. Uploaded thumbnails displayed correctly. |
| CSV export | A preview collection produced a browser CSV download. |
| Cancellation | Cancelled unfinished checks in a preview with an existing completed result. The completed result remained, and unfinished checks ended. |
| Reset confirmation | Preview reset stayed disabled until the exact word `RESET` was entered. The confirmation then completed. |
| Modular edition and CSP | Served the modular HTML under the current Flask CSP, with scripts/styles restricted to self. It rendered and completed a preview submission without CSP violations. |
| Live-mode isolation | With no backend, explicitly selected live mode displayed a host error, no sample-photo action, and no fixture predictions. |
| Visual inspection | Reviewed desktop Scan, mobile Scan/results, and Operator queue screenshots. |

All submission/cancellation/reset actions in the table above used isolated preview fixtures. Live integration was subsequently installed and verified as follows.

## Connected Flask verification

- The Flask root serves the new User/Operator UI in enforced live mode. Preview query parameters do not activate fixtures. External assets and API requests share port 5000 and work under the existing CSP.
- All three real CPU workers reported READY. A photo uploaded through the browser UI returned three completed predictions whose hashes matched the saved checkpoints. Full fruit/quality probability distributions were present.
- Live SSE returned HTTP 200 and the event log contained three `model.completed` records. Reload restored the same browser collection and results.
- Another browser session received 404 when requesting the verification image, confirming session ownership.
- CSV and JSON downloads from the UI each contained three completed model observations.
- The Operator console displayed real request/event details, the three model queues, saved research metrics/figures, local capabilities, and storage/connection settings.
- Live result screens rendered at 390 px with no page-wide overflow. Browser verification reported no uncaught JavaScript errors or CSP violations.
- Deletion through the UI removed the verification browser's collection and made its image unavailable. Global reset was not executed against the live instance.
- The complete backend suite passed: **54 tests**, including the new template/asset/configuration/traversal checks, strict reference parity, and the real supervisor pipeline.

Verification runtime: Windows, Python 3.12.10, PyTorch 2.13.0+cpu, TorchVision 0.28.0+cpu, and the existing locked dependencies. Local evidence is saved under ignored `test-results/frontend-live-integration.json` and `test-results/frontend-live-*.png`.

A physical camera and actual phone/ngrok pairing were not exercised. ngrok is absent on this host, so the running application currently provides localhost access. Cross-browser Admin request APIs remain unimplemented; the UI reports their unavailability.
