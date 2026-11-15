# Configuration and phone access

Set environment variables before launching `main.py`. `.env.example` documents values; the application does not automatically load it.

```powershell
$env:FRUISPECT_THREADS = '2'
$env:FRUISPECT_RETENTION_HOURS = '24'
$env:FRUISPECT_NGROK = '0'
.venv/Scripts/python.exe main.py
```

## Settings

| Variable | Default | Meaning |
| --- | --- | --- |
| `FRUISPECT_ARTIFACTS` | `trained-outputs` | Trusted checkpoint and research directory |
| `FRUISPECT_INSTANCE` | `instance` | Private database, session key, and image spool |
| `FRUISPECT_DEVICE` | `cpu` | Model device; CUDA requires target-machine validation |
| `FRUISPECT_THREADS` | `2` | Intra-op threads per model worker |
| `FRUISPECT_MAX_FILE_MB` | `12` | Per-file byte limit; at most four files per API request |
| `FRUISPECT_MAX_PIXELS` | `24000000` | Maximum decoded image pixels |
| `FRUISPECT_MAX_BATCH` | `1000` | Accepted images per collection |
| `FRUISPECT_MAX_QUEUE` | `1500` | Pending and running jobs per model |
| `FRUISPECT_MAX_SPOOL_MB` | `2048` | Image spool budget including raw-upload headroom |
| `FRUISPECT_UPLOAD_SLOTS` | `2` | Concurrent upload requests |
| `FRUISPECT_RETENTION_HOURS` | `24` | Retention for terminal collections |
| `FRUISPECT_HOST` | `127.0.0.1` | Web server bind address |
| `FRUISPECT_PORT` | `5000` | Web server port |
| `FRUISPECT_ACCESS_TOKEN` | unset | Basic authentication password; LAN requires at least 20 characters |
| `FRUISPECT_NGROK` | `auto` | Automatically start installed ngrok; `0` disables it |
| `FRUISPECT_NGROK_PATH` | discovery | Optional explicit executable path |
| `FRUISPECT_NGROK_TIMEOUT` | `20` | Tunnel startup timeout in seconds |

A supervisor lock prevents two launches from recovering the same instance. Shutdown allows current worker passes up to 45 seconds before termination. Active jobs retain their inputs past nominal expiry; terminal collections and associated files are removed together.

## Phone camera

Install ngrok and configure its account/authtoken using the [official setup guide](https://ngrok.com/docs/getting-started/). The application searches the configured path, project root and `tools/`, PATH, nearby ngrok folders, and common Desktop/Downloads locations. It does not download ngrok or change its account configuration.

Launch the app, then open the phone pairing link from the desktop interface or use the terminal URL and pairing code. Grant camera permission on the phone; upload or device-camera capture remains available if live capture is unsupported. **Settings > Phone connection** shows diagnostics and allows a localhost retry.

Only the active HTTPS tunnel host is accepted. Public API access requires a browser session paired to the current tunnel generation. Codes rotate at launch and failed attempts are rate limited. The app disables ngrok request inspection and closes only the child process it owns. Phone uploads pass through ngrok; inference and storage remain on the desktop. A missing or failed tunnel leaves localhost available.

Optional connection diagnosis:

```powershell
.venv/Scripts/python.exe -m scripts.check_phone_link
```

This exposes only a temporary fixed health response through ngrok, then closes the diagnostic server and tunnel.

## Network and storage

Local requests use browser sessions, same-origin POST checks, and an `X-Fruispect: 1` command header. LAN hosting requires the access token, HTTPS, and appropriate network access controls. Basic authentication accepts any username and uses the token as password. A reverse proxy must preserve Host/Origin, support SSE, and disable buffering for `/api/events`. Remote camera capture requires HTTPS.

Protect the private instance directory with operator-only filesystem access. SQLite stores metadata and paths; canonical PNGs and metadata-stripped thumbnails live in its spool. Original uploads are removed after intake. Resetting scan data preserves model registration and connection settings.

## Offline installation

On a connected machine with matching OS and Python, download the locked dependencies and matching CPU PyTorch/TorchVision wheels into a wheel directory. Transfer that directory with the repository, then install locally:

```powershell
.venv/Scripts/python.exe -m pip install --no-index --find-links wheelhouse -r requirements-lock.txt
```

The application performs no model download or retraining. Keep `trained-outputs/` complete, and restart after intentional artifact changes.
