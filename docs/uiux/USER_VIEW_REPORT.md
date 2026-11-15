# Fruispect: User-only view

This is the proposed presentation of existing capabilities for an everyday user. It separates the primary input/loading/output journey from technical operator information. It does not imply an account or role system already exists. See the [system report](SYSTEM_INPUT_OUTPUT_REPORT.md) for exact contracts and the [Admin report](ADMIN_VIEW_REPORT.md) for operational details.

## 1. Input screen: Add a fruit photo

**Purpose:** Let a person submit a usable photograph with minimal setup.

Required elements:

- Fruispect identity and a short explanation: check fruit type and visible quality.
- Primary modes: **Photo**, **Batch**, **Camera**.
- File picker and drag/drop; clipboard image paste as a convenience.
- Batch multi-select and browser-supported folder input; preserve per-file selection and admission states.
- Camera start, permission state, camera selection, take photo, review/retake, stop, and native phone camera fallback.
- Photo preview, filename, selected-file count, and remove/clear before submission.
- Primary action: **Check fruit** or **Check N photos**. Disable duplicate submissions while uploading.
- Supported-file help: JPEG/PNG/WebP; default 12 MiB/file and 24 million pixels, with limits supplied through configuration.
- Short guidance: one principal fruit per image; supported fruits are Apple, Banana, Guava, Lime, Orange, Pomegranate.
- Scope note: **Visual quality, not food safety.**

Do not ask for fruit type, quality, ground-truth labels, a model choice, name, email, or account registration. Classification only requires the image. Unsupported fruits are not reliably detected as unknown.

Put optional auto-capture under advanced camera controls. The existing behavior is one still every 5 seconds with busy/unavailable safeguards; it is not a live video classifier. Stop camera tracks when leaving the view or hiding the page.

For phone access, a remote visitor can enter the pairing code from the computer or use its automatic pairing link. Phone uploads belong to the phone's own browser collection. Showing the pairing code/link and retrying the tunnel are local-operator capabilities; put them on the Admin/operator side of the proposed design.

## 2. Loading screen: Check in progress

**Purpose:** Explain what is happening while preserving any results already available.

Distinguish local selection, upload/admission, image preparation, waiting, and checking. A successful HTTP 202 admission is not a finished analysis. For a batch, show per-file accepted/rejected states and a count of files processed by the uploader. Do not convert a file-count indicator into a byte-upload percentage.

After acceptance, use a persistent panel or inline state transition showing:

- Selected photo preview and filename.
- Friendly stage label, for example **Preparing photo**, **Waiting for a check**, or **Checking your fruit**.
- Three model rows/cards, each with its own status.
- Count such as **1 of 3 model results available**, based on successful jobs.
- Real results as soon as each model completes. Keep pending or failed cards visible beside them.
- **Cancel unfinished checks** when appropriate; show **Cancellation requested** for a running pass until it ends.
- A reconnection message when live updates fail. Retain existing results; accepted work continues on the server.

Use an indeterminate indicator for inference, not a fabricated 0-100% progress bar or promised completion time. Do not block all results behind a full-screen loader until the slowest model finishes.

Handle errors with a specific next step: choose another format, reduce file size, enable camera permission, retry unaccepted files when capacity returns, reconnect the phone, or start a new collection after expiration. An accepted image whose preprocessing later fails remains an accepted record with failure states.

## 3. Output screen: Your results

**Purpose:** Make the three predictions understandable without suggesting a single verdict the backend does not provide.

For each model, show:

| Visible output | Backend source |
| --- | --- |
| Model name | Stable model-key/name mapping |
| Fruit type | `result.predicted_fruit` |
| Fruit confidence | `result.fruit_confidence`, displayed from 0-100% |
| Visual quality: Good/Bad | `result.predicted_quality` |
| Quality confidence | `result.quality_confidence`, displayed from 0-100% |
| Current status / failure | `job.status`, nullable error details |

Use **Not available** when no result exists, with a clear status rather than an empty card. A confidence of zero is a valid value and must not be treated as missing. If displayed, processing speed must be labeled **inference time**, not total waiting time.

Above or below the cards, show comparison text:

- **All 3 models agree** only when all three succeeded and fruit and quality predictions match.
- **Fruit predictions differ**, **Quality predictions differ**, or both, when applicable.
- **Provisional comparison** while more checks are active.
- **Comparison incomplete** when checks have ended but some models did not return results.
- **Waiting for more results** when fewer than two successful results exist and work is active.

Two matching results with a third failed do not become full three-model agreement. Do not average confidence values into an unsupported overall confidence. Place the note **Confidence is a model score, not a guarantee** near the results.

Keep hashes, worker PIDs, model metadata, queue throughput, research benchmark tables, and debug errors off the primary User view. Simple failure explanations remain visible; technical diagnostics belong to the Admin view.

## 4. Collection and secondary actions

- Recent collections and paged photos, scoped to the current browser session.
- Search filenames, sort newest/oldest, and optional fruit/quality/status/comparison filters.
- Stable photo selection: late results update their own record without jumping to another photo. A newly accepted photo can become the selected photo.
- New collection, cancel unfinished work, CSV/JSON export, and deletion of own collection(s), with clear confirmation.
- Intentional rescan only while original files remain selected or after the user selects them again. Thumbnails are not a substitute for the original submitted bytes.
- Clear empty, no-match, partial-success, all-failed, cancelled, disconnected, and expired/deleted states.

Do not label saved history as permanent account storage. Explain the default 24-hour retention and browser-session ownership where relevant. Avoid a universal numerical success count derived from `fully_complete`: that field includes failures and cancellations.

## 5. Layout and accessibility

Use a calm, welcoming fruit/produce visual identity and clear action hierarchy. Keep the upload/camera action easy to reach on mobile. Arrange three result cards side by side on wide screens and stack them on narrow screens. User navigation can be **Scan**, **My collections**, and **My data**; it should not expose the operator dashboard.

Support keyboard operation, visible focus, labeled inputs, live status announcements, readable contrast, text labels alongside color, reduced-motion preferences, and camera fallback. Avoid a layout that requires a large collection table to be readable on a phone.
