# Fruispect frontend

Run `main.py` from the repository root and open **http://127.0.0.1:5000**. Flask renders `app/templates/fruispect.html` and serves `frontend/assets/` at `/static/fruispect/`. JavaScript, styles, API requests, and browser sessions share the same origin. No bundler or separate frontend server is required.

## Source map

| Path under `assets/` | Responsibility |
| --- | --- |
| `app.js` | Shell, navigation, dialogs, and connection/pairing |
| `experience.js` | Nonblocking robot welcome and encouraging helper |
| `motion.js` | Bounded top-to-bottom entrances shared by pages, console tabs, and dialogs |
| `api/` | Live HTTP service, validated limits, shared labels, SSE/polling |
| `state/requests.js` | Event cursors and version-aware snapshot reconciliation |
| `workspace/` | File intake, camera capture, uploads, collections, rendering, and commands |
| `workspace/review.js` | Responsive collection result dialog with independent selection and focus restoration |
| `operator/` | Telemetry, owned requests, research, settings, reads, and commands |
| `ui.js` | Safe markup, icons, formatting, downloads, and focus preservation |
| `css/workspace/`, `css/operator/` | Base styles, feature layouts, and responsive rules |
| `styles.css`, `operator.css` | Ordered stylesheet imports |

Each feature's `index.js` creates its own state, installs focused controllers, and binds browser events. Controllers receive shared state and an action registry explicitly; rendering modules format snapshots without changing queue order. Keep feature behavior in its controller and reusable markup in view/component modules.

Mark primary entrance groups with `data-reveal`. Navigation animates visible groups in reading order with a short, bounded stagger; ordinary telemetry refreshes keep their layout steady. Modal controllers use `openDialog` to preserve native focus and Escape behavior. Reduced motion bypasses these entrance effects.

The browser uses only the current live API. Research views read saved artifacts; inference views read actual worker results. Request inspection covers collections owned by the current browser. Host-wide scan reset and phone retry remain restricted by the server to localhost.

## Verify changes

```powershell
node tests/test_frontend.mjs
.venv/Scripts/python.exe -m pytest -q tests/test_frontend_integration.py
```

Tests cover late-result selection, version reconciliation, idempotent upload admission, backpressure, camera cleanup, resource reads, and research formatting. Flask tests traverse the entire module import graph and verify asset access restrictions and configured limits.

Use a one-line file purpose comment and one concise comment above each named function. Keep application scripts external so they work with the server's content security policy.
