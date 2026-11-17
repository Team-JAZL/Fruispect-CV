// Validate file selection and render photo, batch, and camera intake controls.
import { icon, escapeHtml as e, preserveFocus } from '../ui.js';
import { makeKey, FILES_PER_PAGE, badge, callout } from './components.js';
import { animatePage } from '../motion.js';

// Connect intake behavior to shared state and actions.
export function installIntake(context) {
  const { root, onPairing, state: store, actions, $, intake, limits, maxBytes, maxFiles, allowedTypes } = context;

  // Show a recoverable connection error with a retry control.
  function showError(error, target = 'user') {
    if (error?.status === 401) onPairing(error.message);
    const message = error?.message || 'The request could not be completed.';
    if (target === 'collection') {
      store.collectionNotice = message;
      actions.renderCollections();
    } else {
      store.userNotice = message;
      actions.renderIntakeState();
    }
  }

  // Render input mode from the current application state.
  function renderInputMode() {
    const camera = store.inputMode === 'camera';
    for (const tab of root.querySelectorAll('[data-mode]')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.mode === store.inputMode));
      tab.disabled = store.uploadBusy;
    }
    if (camera) {
      intake.innerHTML = `<div class="camera-box">
        <div id="camera-placeholder"><span class="upload-icon">${icon('camera', 23)}</span><strong>Use your camera</strong><p>Frame one fruit, then capture a still photo.</p></div>
      </div>
      <div class="camera-actions"><button class="button primary" type="button" data-action="start-camera">${icon('camera', 18)}<span>Open camera</span></button>
      <button class="icon-button" type="button" data-action="device-camera" aria-label="Use device camera" title="Use device camera">${icon('phone', 19)}</button>
      <button class="icon-button" type="button" data-action="browse-photo" aria-label="Choose a photo" title="Choose a photo">${icon('folder', 19)}</button></div>
      <dialog id="camera-view" class="camera-view" aria-labelledby="camera-title">
      <header class="camera-header" data-reveal><h2 id="camera-title">Frame one fruit</h2><button class="icon-button" type="button" data-action="stop-camera" aria-label="Close camera">${icon('close', 21)}</button></header>
      <div class="camera-stage" data-reveal><video id="camera-video" playsinline autoplay muted aria-label="Live camera preview"></video><span class="camera-guide" aria-hidden="true"></span></div>
      <div class="camera-shutter-row" data-reveal><span class="camera-hint">Keep it steady</span><button class="shutter-button" type="button" data-action="capture" aria-label="Take photo" title="Take photo"><span></span></button><span class="camera-hint">Tap to capture</span></div>
      <div class="camera-options" data-reveal><label id="camera-picker" hidden>Camera <select id="camera-select"></select></label>
      <details><summary>Auto-capture</summary><label id="auto-option" hidden><input type="checkbox" id="auto-capture"> Every ${(limits.autoCaptureIntervalMs ?? 5000) / 1000} seconds when ready</label></details></div></dialog>`;
      $('camera-view').addEventListener('cancel', event => { event.preventDefault(); actions.stopCamera(); });
      actions.refreshCamera();
    } else {
      const batch = store.inputMode === 'batch';
      intake.innerHTML = `<div class="drop-zone" id="drop-zone">
        <span class="upload-icon">${icon(batch ? 'layers' : 'upload', 24)}</span>
        <strong>${batch ? 'Add your fruit photos' : 'A fresh look at your fruit'}</strong>
        <p>JPEG, PNG or WebP · Up to ${Math.round(maxBytes / 1024 ** 2)} MiB per file</p>
        <div class="drop-actions"><button class="button browse" type="button" data-action="${batch ? 'browse-batch' : 'browse-photo'}">${icon('plus', 18)} ${batch ? 'Photos' : 'Photo'}</button>
        
        ${batch && 'webkitdirectory' in $('folder-input') ? `<button class="button" type="button" data-action="browse-folder">${icon('folder', 17)} Folder</button>` : ''}</div>
        <small>${batch ? `Drop photos here · Up to ${maxFiles.toLocaleString()} per collection` : 'Or drop or paste a photo here.'}</small>
      </div>`;
      const drop = $('drop-zone');
      drop.ondragover = event => { event.preventDefault(); drop.classList.toggle('dragging', !store.uploadBusy); };
      drop.ondragleave = () => drop.classList.remove('dragging');
      drop.ondrop = event => {
        event.preventDefault();
        drop.classList.remove('dragging');
        actions.addFiles(event.dataTransfer.files, batch);
      };
    }
    actions.renderIntakeState();
    animatePage(intake);
  }

  // Release selected photo previews and reset file selection pagination.
  function discardSelection() {
    for (const item of store.selected) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
    store.selected = [];
    store.selectionPage = 1;
  }

  // Explain why a selected file violates the configured intake limits.
  function validationMessage(file) {
    if (file.size > maxBytes) return `File exceeds the ${Math.round(maxBytes / 1024 ** 2)} MiB limit.`;
    if (!file.size) return 'The file is empty.';
    if (file.type ? !allowedTypes.includes(file.type.toLowerCase())
      : !/\.(jpe?g|png|webp)$/i.test(file.name)) return 'Choose a JPEG, PNG or WebP still image.';
    return '';
  }

  // Validate selected files and retain stable keys for admission retries.
  function addFiles(files, many = store.inputMode === 'batch', render = true) {
    if (store.uploadBusy && render) return;
    if (!files.length) return;
    if (!many) actions.discardSelection();
    const base = store.selected.filter(item => item.status === 'selected' || item.status === 'retry').length;
    let candidates = base;
    const entries = Array.from(files).slice(0, many ? maxFiles + 50 : 1).map(file => {
        const validation = actions.validationMessage(file);
        const invalid = validation || (candidates >= maxFiles ? 'Selection exceeds the collection limit.' : '');
        if (!invalid) candidates++;
        return {
          file, key: makeKey(), status: invalid ? 'rejected' : 'selected', message: invalid,
          url: !invalid && !many ? URL.createObjectURL(file) : null,
        };
      });
    store.selected.push(...entries);
    store.userNotice = files.length > entries.length ? `${files.length - entries.length} extra file selections were skipped.` : '';
    store.uploadStatus = '';
    store.completedAdmission = null;
    if (render) actions.renderIntakeState();
  }

  // Render intake state from the current application state.
  function renderIntakeState() {
    const selectedList = $('selected-files');
    const pending = store.selected.filter(item => item.status === 'selected' || item.status === 'retry').length;
    const pages = Math.max(1, Math.ceil(store.selected.length / FILES_PER_PAGE));
    store.selectionPage = Math.min(pages, store.selectionPage);
    const first = (store.selectionPage - 1) * FILES_PER_PAGE;
    const fileRows = store.selected.slice(first, first + FILES_PER_PAGE).map(item => {
        const label = {
          selected: 'Selected', uploading: 'Submitting', accepted: 'Accepted',
          retry: 'Retry available', rejected: 'Rejected',
        }[item.status];
      return `<li class="file-row">${item.url ? `<img src="${e(item.url)}" alt="" width="40" height="40">` : `<span class="tile-icon mini">${icon('photo', 16)}</span>`}
        <div><strong>${e(item.file.name || 'Captured photo')}</strong><small>${e(item.message || `${(item.file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`)}</small></div>
        ${badge(label, item.status === 'accepted' ? 'good' : item.status === 'rejected' ? 'bad' : item.status === 'retry' ? 'warn' : 'neutral')}
        <button class="icon-button" type="button" aria-label="Remove ${e(item.file.name)}" data-action="remove-file" data-key="${e(item.key)}" data-focus="remove-${e(item.key)}"${store.uploadBusy ? ' disabled' : ''}>${icon('close', 17)}</button></li>`;
      }).join('');
    const preview = store.inputMode !== 'batch' && store.selected.length === 1 ? store.selected[0] : null;
    preserveFocus(selectedList, store.selected.length ? `<div class="file-heading"><strong>${store.selected.length.toLocaleString()} ${store.selected.length === 1 ? 'file' : 'files'} added</strong><button type="button" class="text-button" data-action="clear-files" data-focus="clear-files"${store.uploadBusy ? ' disabled' : ''}>Clear files</button></div><ul class="files">${fileRows}</ul>${pages > 1 ? `<div class="pagination"><button class="button small" type="button" data-action="files-prev" data-focus="files-prev"${store.selectionPage <= 1 ? ' disabled' : ''}>Previous files</button><span>${store.selectionPage} of ${pages}</span><button class="button small" type="button" data-action="files-next" data-focus="files-next"${store.selectionPage >= pages ? ' disabled' : ''}>Next files</button></div>` : ''}` : '');
    const message = [
      store.cameraError && store.inputMode === 'camera' ? callout(store.cameraError) : '',
      store.userNotice ? callout(store.userNotice) : '',
      store.uploadStatus ? `<div class="admission-status" role="status">${store.uploadBusy ? '<span class="pulse" aria-hidden="true"></span>' : icon('info', 16)}<span>${e(store.uploadStatus)}</span></div>` : '',
      store.completedAdmission ? callout(store.completedAdmission, 'good') : '',
    ].join('');
    if ($('input-message').innerHTML !== message) $('input-message').innerHTML = message;
    const cameraStart = intake.querySelector('[data-action="start-camera"]');
    if (cameraStart) cameraStart.querySelector('span').textContent = preview?.file.name.startsWith('fruit-') ? 'Retake' : 'Open camera';
    const submit = $('submit-photos');
    submit.disabled = !store.ready || !pending || store.uploadBusy;
    submit.querySelector('span').textContent = store.uploadBusy ? 'Submitting…'
    : store.selected.some(item => item.status === 'retry') ? 'Submit or retry'
    : pending > 1 ? `Check ${pending.toLocaleString()} photos` : 'Check fruit';
    for (const tab of root.querySelectorAll('[data-mode]')) tab.disabled = store.uploadBusy;
    for (const button of root.querySelectorAll('.drop-actions button,.camera-actions [data-action^="browse"],.camera-actions [data-action="device-camera"]')) button.disabled = store.uploadBusy;
  }

  Object.assign(actions, { showError, renderInputMode, discardSelection, validationMessage, addFiles, renderIntakeState });
}
