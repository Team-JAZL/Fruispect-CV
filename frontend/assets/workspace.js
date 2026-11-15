import { FRUITS, JOB_LABELS, MODELS, isTerminal } from './api/contracts.js';
import { mergeImage } from './state/requests.js';
import { icon, escapeHtml as e, photoUrl, formatDate, formatScore, saveDownload, preserveFocus } from './ui.js';

const sampleUrl = new URL('./apple.jpg', import.meta.url).href;
const makeKey = () => globalThis.crypto?.randomUUID?.() ?? `fruispect-${Date.now()}-${Math.random().toString(36).slice(2)}`;
const FILES_PER_PAGE = 25;
const idOf = image => image?.image_id;
const jobTone = status => ({ COMPLETED: 'good', FAILED: 'bad', UNAVAILABLE: 'bad', CANCELLED: 'neutral', RUNNING: 'active', QUEUED: 'warn' })[status] ?? 'neutral';
const option = (value, label, selected) => `<option value="${e(value)}"${value === selected ? ' selected' : ''}>${e(label)}</option>`;
const badge = (label, tone = 'neutral') => `<span class="badge ${tone}"><i></i>${e(label)}</span>`;
const callout = (message, tone = 'warn') => `<div class="callout ${tone}" role="status">${icon(tone === 'good' ? 'check' : 'info', 18)}<p>${e(message)}</p></div>`;

function thumbnail(image, cls = '') {
  const url = photoUrl(image?.thumbnail_url);
  return `<div class="thumb ${cls}">${url
    ? `<img src="${e(url)}" alt="${e(image.original_filename || 'Fruit photo')}" loading="lazy">`
    : icon('photo', 26)}</div>`;
}

function resultCard(model, job, imageId) {
  const status = job?.status;
  const pending = status && !isTerminal(status);
  const label = job?.cancel_requested && pending ? 'Cancellation requested' : JOB_LABELS[status] ?? 'Awaiting photo';
  const result = status === 'COMPLETED' ? job.result : null;
  return `<article class="model-card ${jobTone(status)}">
    <header class="model-head"><span class="tile-icon ${model.key}">${icon('chip', 18)}</span>
    <h3>${e(model.name)}</h3>${badge(label, jobTone(status))}</header>
    ${result ? `<div class="predictions">
      <div><span>Fruit prediction</span><strong>${e(result.predicted_fruit || 'Not available')}</strong><small>${formatScore(result.fruit_confidence)}${result.fruit_confidence == null ? '' : ' confidence'}</small></div>
      <div><span>Visual quality</span><strong class="${result.predicted_quality === 'Good' ? 'quality-good' : result.predicted_quality === 'Bad' ? 'quality-bad' : ''}">${e(result.predicted_quality || 'Not available')}</strong><small>${formatScore(result.quality_confidence)}${result.quality_confidence == null ? '' : ' confidence'}</small></div>
      </div>
      <details class="probabilities" data-detail="${e(imageId)}-${model.key}">
        <summary data-focus="${e(imageId)}-${model.key}">Class scores</summary>
        ${[['Fruit', result.fruit_probabilities, FRUITS], ['Visual quality', result.quality_probabilities, ['Good','Bad']]].map(([title, values, classes]) => `<div><b>${title}</b><dl>${classes.map(name => `<div><dt>${e(name)}</dt><dd>${formatScore(values?.[name])}</dd></div>`).join('')}</dl></div>`).join('')}
      </details>` : `<div class="pending-result">${pending ? '<span class="pulse" aria-hidden="true"></span>' : icon(status ? 'info' : 'activity', 18)}
      <p>${e(job?.error_message || (job?.cancel_requested && pending ? 'Waiting for this check to end.' : pending ? 'The result will appear when this model finishes.' : status ? 'This model ended without a result.' : 'Add a fruit photo to start this model.'))}</p></div>`}
  </article>`;
}

function agreement(image) {
  const value = image?.consensus;
  const count = value?.successful_models;
  if (!image || !value || !Number.isFinite(count)) return 'Agreement will appear as model results arrive.';
  if (count < 2) return 'At least two model results are needed to compare predictions.';
  const disagreements = [
    value.fruit_disagreement ? 'fruit' : '',
    value.quality_disagreement ? 'visual quality' : '',
  ].filter(Boolean);
  const scope = value.scope;
  if (scope === 'complete' && count === 3 && disagreements.length === 0) return 'All three models agree on fruit and visual quality.';
  const label = disagreements.length
    ? `Models disagree on ${disagreements.join(' and ')}.`
    : 'Available models agree on fruit and visual quality.';
  if (scope === 'provisional') return `Provisional. ${label}`;
  if (scope === 'incomplete') return `Incomplete. ${label}`;
  return label;
}

export function createWorkspace(root, {
  service, config, mode, scenario, confirmAction, notify, onPairing, onNavigate,
}) {
  const demo = mode === 'design-preview';
  const limits = config.limits ?? config;
  const maxBytes = limits.maxFileBytes ?? 12 * 1024 ** 2;
  const maxFiles = limits.maxBatchImages ?? 1000;
  const maxPixels = limits.maxDecodedPixels ?? 24000000;
  const retentionHours = limits.retentionHours ?? 24;
  const allowedTypes = limits.allowedTypes ?? ['image/jpeg', 'image/png', 'image/webp'];
  const mime = [...allowedTypes, '.jpg', '.jpeg', '.png', '.webp'].join(',');
  let page = 'scan';
  let inputMode = demo && scenario.startsWith('camera-') ? 'camera' : demo && scenario === 'mixed-upload' ? 'batch' : 'photo';
  let ready = false;
  let started = false;
  let selected = [];
  let selectionPage = 1;
  let batchId = null;
  let selectedId = null;
  let activeBatch = null;
  let batches = [];
  let list = { images: [], page: 1, limit: 20, total: 0 };
  let listQuery = { page: 1, limit: 20, sort: 'newest' };
  let loadSequence = 0;
  let collectionLoading = false;
  let collectionNotice = '';
  let listSequence = 0;
  let userNotice = '';
  let uploadStatus = '';
  let completedAdmission = null;
  let uploadBusy = false;
  let newBatchKey = makeKey();
  let uploadGroup = null;
  let retryAt = 0;
  const cursors = new Map();
  let streamStatus = '';
  let watchStop;
  let refreshTimer;
  const eventImages = new Set();
  const cache = new Map();
  let cameraStream = null;
  let cameraSequence = 0;
  let cameraError = demo && scenario === 'camera-denied' ? 'Camera permission is blocked. Choose a file or use your device camera below.'
    : demo && scenario === 'camera-unsupported' ? 'This page cannot open the camera. Use HTTPS or localhost, or choose a file.' : '';
  let cameraId = '';
  let cameras = [];
  let autoTimer;
  let lastDeviceError = '';
  let lastLiveAnnouncement = '';

  root.innerHTML = `
    <section id="scan-screen">
      <section class="hero">
        <div class="hero-copy"><span class="hero-tag">${icon('leaf', 16)} Visual fruit inspection</span>
          <h1>Check your fruit</h1><p>See the Fruit. Know its Quality.</p>
        </div>
        <div class="hero-art" aria-hidden="true"><span class="hero-frame"></span></div>
      </section>
      <div class="scan-grid">
        <section class="card input-panel" aria-labelledby="input-title">
          <header class="panel-header"><span class="tile-icon green">${icon('upload', 19)}</span>
            <div><h2 id="input-title">Add a photo</h2><p>Choose how to submit a fruit image.</p></div>
          </header>
          <div id="intake-tabs" class="intake-tabs" role="group" aria-label="Photo input modes">
            <button type="button" data-mode="photo">${icon('photo', 17)} Photo</button>
            <button type="button" data-mode="batch">${icon('layers', 17)} Batch</button>
            <button type="button" data-mode="camera">${icon('camera', 17)} Camera</button>
          </div>
          <input id="photo-input" type="file" accept="${mime}" hidden>
          <input id="batch-input" type="file" accept="${mime}" multiple hidden>
          <input id="folder-input" type="file" webkitdirectory multiple hidden>
          <input id="device-input" type="file" accept="image/*" capture="environment" hidden>
          <div id="input-body"></div>
          <div id="selected-files"></div>
          <div id="input-message"></div>
          <div class="input-foot"><p>${icon('info', 15)} One fruit per photo. Visual quality, not food safety.</p>
          <button type="button" class="button primary" id="submit-photos">${icon('scan', 17)} <span>Check fruit</span></button></div>
        </section>
        <section id="inspection-panel" class="card inspection-panel" aria-label="Current check"></section>
      </div>
      <section class="results-section" aria-labelledby="results-title">
        <div class="section-head"><div><h2 id="results-title">Model results</h2><p>Independent predictions from three models.</p></div><div id="results-count"></div></div>
        <div id="result-cards" class="model-grid"></div>
        <p class="confidence-note">${icon('info', 16)} Confidence is a model score, not a guarantee.</p>
      </section>
    </section>
    <section id="collections-screen" hidden aria-labelledby="collections-title">
      <header class="page-heading"><div><h1 id="collections-title">Collections</h1><p>Review photos and results in this browser session.</p></div><button class="button primary" type="button" data-action="new-batch">${icon('plus', 18)} New collection</button></header>
      <div class="collections-grid">
        <section class="card collection-sidebar"><div class="panel-header"><span class="tile-icon green">${icon('folder', 18)}</span><div><h2>Recent collections</h2><p>Up to 30 from this browser</p></div></div><div id="batch-list"></div><p class="retention-note">Photos are typically retained for ${retentionHours} hours. Active work may remain longer. Clearing cookies removes access to this history.</p><div id="collection-delete"></div></section>
        <section class="card collection-content"><div id="collection-heading"></div>
          <form id="collection-filter" hidden aria-label="Photo filters">
            <label class="filter-search">${icon('search', 16)}<span class="sr-only">Search filename</span><input name="search" type="search" placeholder="Search filename"></label>
            <label><span class="sr-only">Sort by</span><select name="sort"><option value="newest">Newest first</option><option value="oldest">Oldest first</option></select></label>
            <details class="filters"><summary>Filters</summary><div>
              <label>Fruit<select name="fruit"><option value="">Any fruit</option>${FRUITS.map(fruit => option(fruit, fruit)).join('')}</select></label>
              <label>Quality<select name="quality"><option value="">Any quality</option><option>Good</option><option>Bad</option></select></label>
              <label>Check status<select name="status"><option value="">Any status</option><option value="COMPLETED">Has a result</option><option value="TERMINAL">All checks ended</option><option value="QUEUED">Queued</option><option value="RUNNING">Running</option><option value="FAILED">Failed</option><option value="UNAVAILABLE">Unavailable</option><option value="CANCELLED">Cancelled</option></select></label>
              <label>Comparison<select name="agreement"><option value="">Any comparison</option><option value="agreement">Agreement</option><option value="disagreement">Disagreement</option></select></label>
            </div></details>
          </form>
          <div id="collection-notice"></div><div id="collection-list"></div>
        </section>
      </div>
    </section>
    <p class="sr-only" id="scan-announcement" aria-live="polite" aria-atomic="true"></p>`;
  const $ = id => root.querySelector(`#${id}`);
  const intake = $('input-body');
  const form = $('collection-filter');

  function showError(error, target = 'user') {
    if (error?.status === 401) onPairing(error.message);
    const message = error?.message || 'The request could not be completed.';
    if (target === 'collection') {
      collectionNotice = message;
      renderCollections();
    } else {
      userNotice = message;
      renderIntakeState();
    }
  }

  function renderInputMode() {
    const camera = inputMode === 'camera';
    for (const tab of root.querySelectorAll('[data-mode]')) {
      tab.setAttribute('aria-pressed', String(tab.dataset.mode === inputMode));
      tab.disabled = uploadBusy;
    }
    if (camera) {
      intake.innerHTML = `<div class="camera-box">
        <video id="camera-video" playsinline autoplay muted hidden aria-label="Live camera preview"></video>
        <div id="camera-placeholder"><span class="upload-icon">${icon('camera', 23)}</span><strong>Use your camera</strong><p>Frame one fruit, then capture a still photo.</p></div>
      </div>
      <div class="camera-actions"><button class="button small" type="button" data-action="start-camera">Start camera</button>
      <button class="button small" type="button" data-action="stop-camera" hidden>Stop</button>
      <button class="button primary small" type="button" data-action="capture" hidden>Take photo</button>
      <button class="button small" type="button" data-action="device-camera">Device camera</button>
      <button class="button small" type="button" data-action="browse-photo">Choose file</button></div>
      <div class="camera-options"><label id="camera-picker" hidden>Camera <select id="camera-select"></select></label>
      <label id="auto-option" hidden><input type="checkbox" id="auto-capture"> Auto-capture every ${(limits.autoCaptureIntervalMs ?? 5000) / 1000} seconds</label></div>`;
      refreshCamera();
    } else {
      const batch = inputMode === 'batch';
      intake.innerHTML = `<div class="drop-zone" id="drop-zone">
        <span class="upload-icon">${icon(batch ? 'layers' : 'upload', 24)}</span>
        <strong>${batch ? 'Drop multiple fruit photos here' : 'Drop a fruit photo here'}</strong>
        <p>JPEG, PNG or WebP · Up to ${Math.round(maxBytes / 1024 ** 2)} MiB per file</p>
        <div class="drop-actions"><button class="button browse small" type="button" data-action="${batch ? 'browse-batch' : 'browse-photo'}">${icon('folder', 16)} ${batch ? 'Browse files' : 'Browse photo'}</button>
        ${demo ? '<button class="button small" type="button" data-action="sample-photo">Use sample photo</button>' : ''}
        ${batch && 'webkitdirectory' in $('folder-input') ? `<button class="button small" type="button" data-action="browse-folder">Choose folder</button>` : ''}</div>
        <small>${batch ? `Up to ${maxFiles.toLocaleString()} accepted photos per collection` : 'You can also paste an image from your clipboard.'}</small>
      </div>`;
      const drop = $('drop-zone');
      drop.ondragover = event => { event.preventDefault(); drop.classList.toggle('dragging', !uploadBusy); };
      drop.ondragleave = () => drop.classList.remove('dragging');
      drop.ondrop = event => {
        event.preventDefault();
        drop.classList.remove('dragging');
        addFiles(event.dataTransfer.files, batch);
      };
    }
    renderIntakeState();
  }

  function discardSelection() {
    for (const item of selected) {
      if (item.url) URL.revokeObjectURL(item.url);
    }
    selected = [];
    selectionPage = 1;
  }

  function validationMessage(file) {
    if (file.size > maxBytes) return `File exceeds the ${Math.round(maxBytes / 1024 ** 2)} MiB limit.`;
    if (!file.size) return 'The file is empty.';
    if (file.type ? !allowedTypes.includes(file.type.toLowerCase())
      : !/\.(jpe?g|png|webp)$/i.test(file.name)) return 'Choose a JPEG, PNG or WebP still image.';
    return '';
  }

  function addFiles(files, many = inputMode === 'batch', render = true) {
    if (uploadBusy && render) return;
    if (!files.length) return;
    if (!many) discardSelection();
    const base = selected.filter(item => item.status === 'selected' || item.status === 'retry').length;
    let candidates = base;
    const entries = Array.from(files).slice(0, many ? maxFiles + 50 : 1).map(file => {
      const validation = validationMessage(file);
      const invalid = validation || (candidates >= maxFiles ? 'Selection exceeds the collection limit.' : '');
      if (!invalid) candidates++;
      return {
        file, key: makeKey(), status: invalid ? 'rejected' : 'selected', message: invalid,
        url: !invalid && !many ? URL.createObjectURL(file) : null,
      };
    });
    selected.push(...entries);
    userNotice = files.length > entries.length ? `${files.length - entries.length} extra file selections were skipped.` : '';
    uploadStatus = '';
    completedAdmission = null;
    if (render) renderIntakeState();
  }

  function renderIntakeState() {
    const selectedList = $('selected-files');
    const pending = selected.filter(item => item.status === 'selected' || item.status === 'retry').length;
    const pages = Math.max(1, Math.ceil(selected.length / FILES_PER_PAGE));
    selectionPage = Math.min(pages, selectionPage);
    const first = (selectionPage - 1) * FILES_PER_PAGE;
    const fileRows = selected.slice(first, first + FILES_PER_PAGE).map(item => {
      const label = {
        selected: 'Selected', uploading: 'Submitting', accepted: 'Accepted',
        retry: 'Retry available', rejected: 'Rejected',
      }[item.status];
      return `<li class="file-row">${item.url ? `<img src="${e(item.url)}" alt="" width="40" height="40">` : `<span class="tile-icon mini">${icon('photo', 16)}</span>`}
        <div><strong>${e(item.file.name || 'Captured photo')}</strong><small>${e(item.message || `${(item.file.size / 1024).toLocaleString(undefined, { maximumFractionDigits: 1 })} KiB`)}</small></div>
        ${badge(label, item.status === 'accepted' ? 'good' : item.status === 'rejected' ? 'bad' : item.status === 'retry' ? 'warn' : 'neutral')}
        <button class="icon-button" type="button" aria-label="Remove ${e(item.file.name)}" data-action="remove-file" data-key="${e(item.key)}" data-focus="remove-${e(item.key)}"${uploadBusy ? ' disabled' : ''}>${icon('close', 17)}</button></li>`;
    }).join('');
    const preview = inputMode !== 'batch' && selected.length === 1 ? selected[0] : null;
    const previewMarkup = preview?.url ? `<figure class="selection-preview"><img src="${e(preview.url)}" alt="Selected photo ${e(preview.file.name)}"><figcaption>${e(preview.file.name)}</figcaption></figure>` : '';
    preserveFocus(selectedList, selected.length ? `${previewMarkup}<div class="file-heading"><strong>${selected.length.toLocaleString()} ${selected.length === 1 ? 'file' : 'files'} added</strong><button type="button" class="text-button" data-action="clear-files" data-focus="clear-files"${uploadBusy ? ' disabled' : ''}>Clear files</button></div><ul class="files">${fileRows}</ul>${pages > 1 ? `<div class="pagination"><button class="button small" type="button" data-action="files-prev" data-focus="files-prev"${selectionPage <= 1 ? ' disabled' : ''}>Previous files</button><span>${selectionPage} of ${pages}</span><button class="button small" type="button" data-action="files-next" data-focus="files-next"${selectionPage >= pages ? ' disabled' : ''}>Next files</button></div>` : ''}` : '');
    const message = [
      cameraError && inputMode === 'camera' ? callout(cameraError) : '',
      userNotice ? callout(userNotice) : '',
      uploadStatus ? `<div class="admission-status" role="status">${uploadBusy ? '<span class="pulse" aria-hidden="true"></span>' : icon('info', 16)}<span>${e(uploadStatus)}</span></div>` : '',
      completedAdmission ? callout(completedAdmission, 'good') : '',
    ].join('');
    if ($('input-message').innerHTML !== message) $('input-message').innerHTML = message;
    const cameraStart = intake.querySelector('[data-action="start-camera"]');
    if (cameraStart) cameraStart.textContent = preview?.file.name.startsWith('fruit-') ? 'Retake photo' : 'Start camera';
    const submit = $('submit-photos');
    submit.disabled = !ready || !pending || uploadBusy;
    submit.querySelector('span').textContent = uploadBusy ? 'Submitting…'
      : selected.some(item => item.status === 'retry') ? 'Submit or retry'
      : pending > 1 ? `Check ${pending.toLocaleString()} photos` : 'Check fruit';
    for (const tab of root.querySelectorAll('[data-mode]')) tab.disabled = uploadBusy;
    for (const button of root.querySelectorAll('.drop-actions button,.camera-actions [data-action^="browse"],.camera-actions [data-action="device-camera"]')) button.disabled = uploadBusy;
  }

  function refreshCamera() {
    const video = $('camera-video');
    if (!video) return;
    video.hidden = !cameraStream;
    $('camera-placeholder').hidden = Boolean(cameraStream);
    video.srcObject = cameraStream;
    if (cameraStream) video.play().catch(() => {});
    intake.querySelector('[data-action="start-camera"]').hidden = Boolean(cameraStream);
    intake.querySelector('[data-action="stop-camera"]').hidden = !cameraStream;
    intake.querySelector('[data-action="capture"]').hidden = !cameraStream;
    $('auto-option').hidden = !cameraStream;
    $('camera-picker').hidden = !cameraStream || cameras.length < 2;
    $('camera-select').innerHTML = cameras.map((device, index) => option(device.deviceId, device.label || `Camera ${index + 1}`, cameraId)).join('');
    $('camera-select').onchange = event => startCamera(event.target.value);
    $('auto-capture').onchange = event => {
      clearInterval(autoTimer);
      if (event.target.checked) autoTimer = setInterval(autoCapture, limits.autoCaptureIntervalMs ?? 5000);
    };
  }

  function stopCamera(render = true) {
    cameraSequence++;
    clearInterval(autoTimer);
    cameraStream?.getTracks().forEach(track => track.stop());
    cameraStream = null;
    if (render) {
      const auto = $('auto-capture');
      if (auto) auto.checked = false;
      refreshCamera();
    }
  }

  async function startCamera(device = cameraId) {
    stopCamera();
    cameraError = '';
    lastDeviceError = '';
    if (demo && scenario === 'camera-denied') {
      cameraError = 'Preview scenario: camera permission is blocked. You can still choose a file.';
      renderIntakeState();
      return;
    }
    if (demo && scenario === 'camera-unsupported' || !navigator.mediaDevices?.getUserMedia || !window.isSecureContext) {
      cameraError = 'This page cannot open the camera. Use HTTPS or localhost, or choose a file.';
      renderIntakeState();
      return;
    }
    const sequence = cameraSequence;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: false, video: device ? { deviceId: { exact: device } } : { facingMode: { ideal: 'environment' } },
      });
      if (sequence !== cameraSequence || document.hidden || page !== 'scan') {
        stream.getTracks().forEach(track => track.stop());
        return;
      }
      cameraStream = stream;
      cameraId = stream.getVideoTracks()[0]?.getSettings().deviceId || device;
      try { cameras = (await navigator.mediaDevices.enumerateDevices()).filter(entry => entry.kind === 'videoinput'); }
      catch { cameras = []; }
      if (sequence === cameraSequence) refreshCamera();
    } catch (error) {
      if (sequence !== cameraSequence) return;
      cameraError = error.name === 'NotAllowedError' ? 'Camera access was denied. You can still choose a file.' : 'Camera is unavailable. Try another camera or choose a file.';
    }
    renderIntakeState();
  }

  async function capture(auto = false) {
    const video = $('camera-video');
    if (uploadBusy || !cameraStream || !video?.videoWidth || !video?.videoHeight) return;
    const canvas = document.createElement('canvas');
    const scale = Math.min(1, Math.sqrt(maxPixels / (video.videoWidth * video.videoHeight)));
    canvas.width = Math.max(1, Math.floor(video.videoWidth * scale));
    canvas.height = Math.max(1, Math.floor(video.videoHeight * scale));
    canvas.getContext('2d').drawImage(video, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise(resolve => canvas.toBlob(resolve, 'image/jpeg', .9));
    if (!blob || page !== 'scan' || document.hidden || uploadBusy) return;
    if (auto && selected.some(item => ['selected', 'retry'].includes(item.status))) return;
    addFiles([new File([blob], `fruit-${new Date().toISOString().replace(/[:.]/g, '-')}.jpg`, { type: 'image/jpeg' })]);
    if (auto) submit();
    else {
      stopCamera();
      $('submit-photos').focus();
    }
  }

  async function autoCapture() {
    if (document.hidden || page !== 'scan' || uploadBusy || !ready || !cameraStream
      || selected.some(item => ['selected', 'retry'].includes(item.status))) return;
    try {
      const { lanes } = await service.queues();
      const values = Array.isArray(lanes) ? lanes : Object.values(lanes ?? {});
      if (values.length !== MODELS.length || values.some(lane => lane.state !== 'READY' || lane.queue_depth > (limits.autoCaptureQueueDepth ?? 20))) return;
      await capture(true);
    } catch (error) {
      if (error.status === 401) onPairing(error.message);
      else if (error.message !== lastDeviceError) {
        lastDeviceError = error.message;
        notify('Auto-capture is waiting for the host.', 'info');
      }
    }
  }

  function remember(image) {
    const id = idOf(image);
    if (!id) return;
    const merged = mergeImage(cache.get(id), image);
    cache.delete(id);
    cache.set(id, merged);
    if (cache.size > 70) {
      const oldest = [...cache.keys()].find(candidate => candidate !== selectedId);
      if (oldest) cache.delete(oldest);
    }
  }

  async function refreshImage(id, report = false) {
    if (!id) return;
    const requestBatch = batchId;
    try {
      const image = await service.image(id);
      if (requestBatch !== batchId || !image) return;
      remember(image);
      if (id === selectedId) renderResults();
    } catch (error) {
      if (requestBatch !== batchId) return;
      if (error.status === 401) onPairing(error.message);
      else if (report) showError(error);
    }
  }

  async function refreshBatches({ quiet = false } = {}) {
    if (!ready) return;
    try {
      batches = await service.batches();
      renderCollections();
    } catch (error) {
      if (!quiet) showError(error, 'collection');
      else if (error.status === 401) onPairing(error.message);
    }
  }

  function forgetCollection(id, message = 'This collection has expired or was deleted.') {
    if (id !== batchId) return;
    loadSequence++;
    stopWatch();
    batchId = null;
    selectedId = null;
    activeBatch = null;
    cache.clear();
    cursors.delete(id);
    if (uploadGroup?.id === id) uploadGroup = null;
    list = { images: [], page: 1, limit: 20, total: 0 };
    batches = batches.filter(item => item.batch_id !== id);
    streamStatus = '';
    collectionNotice = message;
    if (message) userNotice = message;
    renderCollections();
    renderResults();
    renderIntakeState();
  }

  function stopWatch() {
    watchStop?.();
    watchStop = null;
    clearTimeout(refreshTimer);
    eventImages.clear();
  }

  function watchBatch(id, cursor) {
    stopWatch();
    if (!id || !ready || page === 'operator') return;
    watchStop = service.watch(id, {
      cursor: Math.max(cursors.get(id) ?? 0, Number(cursor) || 0),
      onEvents: (events, nextCursor) => {
        if (id !== batchId) return;
        if (Number.isSafeInteger(nextCursor)) cursors.set(id, nextCursor);
        for (const event of Array.isArray(events) ? events : [events]) {
          if (event?.image_id) eventImages.add(event.image_id);
        }
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => {
          const ids = [...eventImages];
          eventImages.clear();
          if (!ids.length && selectedId) refreshImage(selectedId);
          else for (const imageId of ids) {
            if (imageId === selectedId || cache.has(imageId)) refreshImage(imageId);
          }
          if (page === 'collections') refreshList({ quiet: true });
          refreshBatchSummary(id);
        }, 250);
      },
      onRemoved: () => forgetCollection(id),
      onStatus: (status, detail) => {
        if (id !== batchId) return;
        const code = typeof status === 'string' ? status : status?.status;
        streamStatus = {
          connecting: 'Connecting to live updates…',
          reconnecting: 'Reconnecting. Available results are still shown.',
          polling: 'Updating by polling.',
          offline: 'Connection interrupted. Available results are still shown.',
          capacity: 'The host is busy. Updates will resume when capacity is available.',
          unavailable: 'Live updates are temporarily unavailable.',
        }[code] ?? '';
        if (code === 'pairing-required' || detail?.status === 401 || status?.error?.status === 401) {
          onPairing(detail?.message ?? status?.error?.message);
        }
        renderResults();
      },
      onRecover: ({ cursor: nextCursor } = {}) => {
        if (id !== batchId) return;
        if (Number.isSafeInteger(nextCursor)) cursors.set(id, nextCursor);
        refreshBatchSummary(id);
        if (selectedId) refreshImage(selectedId);
        if (page === 'collections') refreshList({ quiet: true });
      },
    });
  }

  async function refreshBatchSummary(id) {
    try {
      const batch = await service.batch(id);
      if (id !== batchId) return;
      activeBatch = batch;
      renderCollections();
    } catch (error) {
      if (id === batchId && error.status === 404) forgetCollection(id);
      else if (id === batchId && error.status === 401) onPairing(error.message);
    }
  }

  async function refreshList({ quiet = false } = {}) {
    if (!batchId) return;
    const id = batchId;
    const sequence = ++listSequence;
    try {
      const next = await service.images(id, listQuery);
      if (id !== batchId || sequence !== listSequence) return;
      const maxPage = Math.max(1, Math.ceil(next.total / (next.limit || listQuery.limit)));
      if (listQuery.page > maxPage) {
        listQuery.page = maxPage;
        return refreshList({ quiet });
      }
      list = next;
      renderCollections();
    } catch (error) {
      if (id !== batchId || sequence !== listSequence) return;
      if (error.status === 404) forgetCollection(id);
      else if (!quiet || error.status === 401) showError(error, 'collection');
    }
  }

  async function chooseBatch(id, preferredImage = null) {
    const sequence = ++loadSequence;
    if (batchId !== id) {
      stopWatch();
      streamStatus = '';
      cache.clear();
      listQuery.page = 1;
      list = { images: [], page: 1, limit: 20, total: 0 };
      selectedId = null;
    }
    batchId = id;
    activeBatch = batches.find(item => item.batch_id === id) ?? null;
    collectionNotice = '';
    collectionLoading = true;
    renderCollections();
    try {
      const [batch, initial] = await Promise.all([
        service.batch(id), service.images(id, listQuery),
      ]);
      if (sequence !== loadSequence || batchId !== id) return;
      activeBatch = batch;
      list = initial;
      selectedId = preferredImage || selectedId || idOf(initial.images?.[0]) || null;
      if (selectedId) await refreshImage(selectedId);
      if (sequence === loadSequence && batchId === id) watchBatch(id, batch.event_cursor ?? 0);
    } catch (error) {
      if (sequence !== loadSequence || batchId !== id) return;
      if (error.status === 404) forgetCollection(id);
      else showError(error, 'collection');
    } finally {
      if (sequence === loadSequence) {
        collectionLoading = false;
        renderCollections();
        renderResults();
      }
    }
  }

  async function initializeCollections() {
    if (started || !ready) return;
    started = true;
    collectionLoading = true;
    renderCollections();
    await refreshBatches();
    collectionLoading = false;
    if (batches[0] && !batchId) await chooseBatch(batches[0].batch_id);
    if (demo && ['selected', 'mixed-upload'].includes(scenario)) {
      try {
        const response = await fetch(sampleUrl);
        if (!response.ok) throw new Error('Sample photo unavailable.');
        const sample = new File([await response.blob()], 'garden-apple.jpg', { type: 'image/jpeg' });
        if (scenario === 'selected') addFiles([sample]);
        else {
          selected = [
            { file: sample, key: makeKey(), status: 'accepted', message: 'Preview admission' },
            { file: new File(['invalid image'], 'damaged-photo.jpg', { type: 'image/jpeg' }), key: makeKey(), status: 'rejected', message: 'The photo could not be decoded.' },
          ];
          completedAdmission = '1 accepted · 1 rejected';
          renderIntakeState();
        }
      } catch (error) { showError(error); }
    }
    if (demo && scenario === 'uploading' && selected.length === 0) {
      await selectSample();
      if (selected.length) void submit();
    }
    if (demo && /expired|removed/i.test(scenario)) {
      userNotice = 'This collection has expired or was deleted.';
      collectionNotice = userNotice;
      renderIntakeState();
    }
    renderCollections();
    renderResults();
  }

  function previewImage(image) {
    if (!image) return `<div class="empty compact"><span class="tile-icon green">${icon('scan', 22)}</span><h3>No photo checked yet</h3><p>Add a fruit photo to see its status here.</p></div>`;
    const count = MODELS.filter(({ key }) => image.jobs?.[key]?.status === 'COMPLETED' && image.jobs[key].result).length;
    const pending = MODELS.some(({ key }) => {
      const status = image.jobs?.[key]?.status;
      return status && !isTerminal(status);
    });
    const title = image.input_status === 'FAILED' ? 'Photo could not be prepared' : image.terminal
      ? 'Checks ended' : image.input_status === 'PROCESSING' ? 'Preparing photo' : count ? 'Partial results available' : 'Checks in progress';
    return `<div class="inspection-image">${thumbnail(image, 'inspection-thumb')}
      <div class="photo-meta"><span><strong>${e(image.original_filename || 'Fruit photo')}</strong><small>${e(title)}</small></span>
      ${badge(image.terminal ? 'Ended' : 'In progress', image.terminal ? 'neutral' : 'active')}</div></div>
      ${image.input_error ? callout(typeof image.input_error === 'string' ? image.input_error : image.input_error.message ?? 'The photo could not be prepared.') : ''}
      <div class="agreement"><span class="tile-icon mini green">${icon(count > 1 ? 'layers' : 'activity', 17)}</span><p>${e(agreement(image))}</p></div>
      ${pending ? `<button type="button" class="text-button cancellation" data-action="cancel-image" data-focus="cancel-image">${icon('close', 15)} Cancel unfinished checks</button>` : ''}`;
  }

  function renderResults() {
    const image = cache.get(selectedId);
    const count = image ? MODELS.filter(({ key }) => image.jobs?.[key]?.status === 'COMPLETED' && image.jobs[key].result).length : 0;
    preserveFocus($('inspection-panel'), `<header class="panel-header"><span class="tile-icon green">${icon('activity', 19)}</span>
      <div><h2>Current check</h2><p>${demo && image ? 'Preview photo' : 'Selected fruit photo'}</p></div></header>
      ${streamStatus ? callout(streamStatus, 'neutral') : ''}
      ${previewImage(image)}`);
    $('results-count').innerHTML = `<span class="badge neutral result-count">${icon('layers', 15)} ${count} of 3 model results available</span>`;
    preserveFocus($('result-cards'), MODELS.map(model => resultCard(model, image?.jobs?.[model.key], selectedId)).join(''));
    const state = image ? `${image.original_filename || 'Fruit photo'}: ${count} of 3 model results available.${image.terminal ? ' Checks ended.' : ''}` : '';
    if (state !== lastLiveAnnouncement) {
      lastLiveAnnouncement = state;
      $('scan-announcement').textContent = state;
    }
  }

  function renderCollections() {
    const recent = batches.map(batch => `<button type="button" class="batch-choice${batch.batch_id === batchId ? ' chosen' : ''}"
      data-action="select-batch" data-id="${e(batch.batch_id)}" data-focus="batch-${e(batch.batch_id)}"${batch.batch_id === batchId ? ' aria-current="true"' : ''}>
      <span class="tile-icon mini">${icon('folder', 17)}</span><span><strong>${e(formatDate(batch.created_at))}</strong><small>${Number(batch.summary?.accepted ?? 0)} photos · ${e((batch.status ?? '').toLowerCase())}</small></span>${icon('chevron', 15)}</button>`).join('');
    preserveFocus($('batch-list'), recent || `<p class="retention-note">${collectionLoading ? 'Loading collections…' : 'No collections yet.'}</p>`);
    $('collection-delete').innerHTML = batches.length ? `<button type="button" class="text-button text-danger" data-action="delete-all">${icon('trash', 16)} Delete my collections</button>` : '';
    form.hidden = !batchId;
    const summary = activeBatch?.summary;
    const accepted = Number(summary?.accepted ?? 0);
    const ended = Number(summary?.fully_complete ?? 0);
    const batchButtons = batchId ? `<div class="collection-actions">
      <button type="button" class="button small" data-action="export-csv" data-focus="export-csv">${icon('download', 15)} CSV</button>
      <button type="button" class="button small" data-action="export-json" data-focus="export-json">JSON</button>
      ${accepted > ended ? '<button type="button" class="button small" data-action="cancel-batch" data-focus="cancel-batch">Cancel unfinished</button>' : ''}
      <button type="button" class="icon-button text-danger" aria-label="Delete this collection" data-action="delete-batch" data-focus="delete-batch">${icon('trash', 17)}</button>
      </div>` : '';
    preserveFocus($('collection-heading'), `<header class="panel-header collection-header"><div><h2>Collection photos</h2>
      <p>${batchId ? `${accepted.toLocaleString()} accepted · ${ended.toLocaleString()} checks ended` : 'Select a collection to view its photos.'}</p></div>${batchButtons}</header>
      ${accepted ? `<div class="collection-progress"><progress max="${accepted}" value="${Math.min(accepted, ended)}" aria-label="Photos whose checks ended"></progress></div>` : ''}`);
    $('collection-notice').innerHTML = collectionNotice ? callout(collectionNotice) + (ready ? '<button type="button" class="text-button" data-action="refresh-collections">Refresh history</button>' : '') : '';
    const rows = (list.images ?? []).map(image => {
      const id = idOf(image);
      const imageStatus = image.terminal ? 'Checks ended' : image.input_status === 'PROCESSING' ? 'Preparing photo' : 'Checks in progress';
      return `<li class="collection-row">${thumbnail(image, 'collection-thumb')}<div><strong>${e(image.original_filename || 'Fruit photo')}</strong><small>${e(formatDate(image.received_at))}</small></div>
        ${badge(imageStatus, image.terminal ? 'neutral' : 'active')}<button class="button small" type="button" data-action="open-image" data-id="${e(id)}" data-focus="image-${e(id)}">View results ${icon('chevron', 14)}</button></li>`;
    }).join('');
    const maxPage = Math.max(1, Math.ceil((list.total ?? 0) / (list.limit || listQuery.limit)));
    preserveFocus($('collection-list'), rows ? `<ul class="collection-rows">${rows}</ul>
      <div class="pagination"><button class="button small" type="button" data-action="prev" data-focus="prev"${listQuery.page <= 1 ? ' disabled' : ''}>Previous</button>
      <span>Page ${listQuery.page} of ${maxPage}</span><button class="button small" type="button" data-action="next" data-focus="next"${listQuery.page >= maxPage ? ' disabled' : ''}>Next</button></div>`
      : `<div class="empty"><span class="tile-icon green">${icon('photo', 22)}</span><h3>${collectionLoading ? 'Loading collection…' : batchId ? 'No matching photos' : 'No collection selected'}</h3><p>${batchId ? 'Upload photos or adjust the filters.' : 'Your next scan will create a collection.'}</p></div>`);
  }

  async function submit() {
    if (uploadBusy || !ready) return;
    const todo = selected.filter(item => item.status === 'selected' || item.status === 'retry');
    if (!todo.length) return;
    if (retryAt > Date.now()) {
      userNotice = `The host asked for a pause. Retry in ${Math.ceil((retryAt - Date.now()) / 1000)} seconds.`;
      renderIntakeState();
      return;
    }
    if (todo.some(item => item.uploadBatchId && item.uploadBatchId !== batchId)) {
      userNotice = 'Return to the original collection to retry its files, or remove those files to start a new check.';
      renderIntakeState();
      return;
    }
    uploadBusy = true;
    userNotice = '';
    completedAdmission = null;
    const fileLabel = todo.length === 1 ? 'file' : 'files';
    uploadStatus = `0 of ${todo.length} ${fileLabel} submitted`;
    renderIntakeState();
    let lastImage = null;
    let processed = 0;
    let admitted = 0;
    let rejected = 0;
    let deferred = 0;
    let group = uploadGroup;
    try {
      if (!group || group.id !== batchId || activeBatch?.status === 'CANCELLED') {
        if (activeBatch?.status === 'CANCELLED' && todo.some(item => item.uploadBatchId)) {
          throw new Error('This collection was cancelled. Remove the old retry files and select the originals for a new check.');
        }
        if (!batchId || activeBatch?.status === 'CANCELLED') {
          const created = await service.createBatch(newBatchKey);
          if (batchId !== created.batch_id) {
            stopWatch();
            selectedId = null;
            cache.clear();
          }
          activeBatch = created;
          batchId = created.batch_id;
          newBatchKey = makeKey();
        }
        group = { id: batchId, offset: Number(activeBatch?.summary?.total_submitted ?? activeBatch?.summary?.accepted ?? 0) };
        uploadGroup = group;
      }
      for (const item of todo) {
        if (!ready) break;
        if (item.uploadBatchId && item.uploadBatchId !== group.id) break;
        if (item.offset == null) {
          item.offset = group.offset++;
          item.uploadBatchId = group.id;
        }
        item.status = 'uploading';
        renderIntakeState();
        try {
          const result = await service.addImages(item.uploadBatchId, [item.file], item.offset, item.key);
          const accepted = result.accepted?.[0];
          const failed = result.rejected?.[0];
          if (accepted) {
            item.status = 'accepted';
            item.message = accepted.input_error?.message || accepted.input_error || (accepted.duplicate ? 'Already submitted' : '');
            if (typeof item.message !== 'string') item.message = 'Photo preparation failed.';
            lastImage = accepted.image_id;
            admitted++;
            if (batchId === item.uploadBatchId && lastImage) {
              selectedId = lastImage;
              await refreshImage(lastImage);
            }
          } else if (failed) {
            const status = Number(failed.http_status);
            item.status = status === 429 || status === 503 || status >= 500 ? 'retry' : 'rejected';
            item.message = failed.message || failed.code || 'This file was rejected.';
            if (item.status === 'retry') deferred++;
            else rejected++;
            if (result.retryAfterMs && item.status === 'retry') {
              retryAt = Date.now() + result.retryAfterMs;
              userNotice = `The host asked for a pause. Retry in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`;
              break;
            }
          } else {
            item.status = 'retry';
            item.message = 'The host did not confirm admission. Retry to recover the same upload.';
            deferred++;
          }
        } catch (error) {
          const recoverable = !error.status || [401, 429, 503].includes(error.status) || error.status >= 500;
          item.status = recoverable ? 'retry' : 'rejected';
          item.message = error.message;
          if (recoverable) deferred++;
          else rejected++;
          if (error.retryAfterMs) retryAt = Date.now() + error.retryAfterMs;
          showError(error);
          if ([401, 404, 409, 429, 503].includes(error.status) || !error.status || error.status >= 500) {
            if (error.status === 404 || error.status === 409) {
              uploadGroup = null;
              if (error.status === 404) forgetCollection(group.id);
            }
            break;
          }
        } finally {
          processed++;
          uploadStatus = `${processed} of ${todo.length} ${fileLabel} submitted`;
          renderIntakeState();
        }
      }
    } catch (error) {
      showError(error);
    } finally {
      uploadBusy = false;
      uploadStatus = '';
      if (admitted || rejected || deferred) {
        const parts = [`${admitted} accepted`, `${rejected} rejected`];
        if (deferred) parts.push(`${deferred} can be retried`);
        if (processed < todo.length) parts.push(`${todo.length - processed} not sent`);
        completedAdmission = parts.join(' · ');
      }
      if (group?.id === batchId && group?.id) {
        await chooseBatch(group.id, lastImage || selectedId);
        refreshBatches({ quiet: true });
      }
      renderIntakeState();
      renderResults();
    }
  }

  async function selectSample() {
    if (!demo || uploadBusy) return;
    try {
      const response = await fetch(sampleUrl);
      if (!response.ok) throw new Error('Sample photo unavailable.');
      addFiles([new File([await response.blob()], 'garden-apple.jpg', { type: 'image/jpeg' })]);
    } catch (error) { showError(error); }
  }

  function describeDeletion(result) {
    const deleted = result?.deleted ?? result;
    const pending = deleted?.cleanup_pending;
    return pending ? 'Collection access was removed. File cleanup is still pending.' : 'Collection data deleted.';
  }

  async function createCollection() {
    if (!ready || uploadBusy) return;
    try {
      const created = await service.createBatch(newBatchKey);
      newBatchKey = makeKey();
      uploadGroup = null;
      await chooseBatch(created.batch_id);
      refreshBatches({ quiet: true });
      notify('New collection created.');
      onNavigate('scan');
    } catch (error) { showError(error, 'collection'); }
  }

  async function collectionAction(action) {
    if (!ready || uploadBusy && ['delete-all', 'delete-batch', 'cancel-batch'].includes(action)) return;
    const id = batchId;
    if (action !== 'delete-all' && !id) return;
    try {
      if (action === 'export-csv' || action === 'export-json') {
        saveDownload(await service.exportFile(id, action.slice(7)));
      } else if (action === 'cancel-batch') {
        if (!await confirmAction({ title: 'Cancel unfinished checks?', body: 'Completed results will remain in this collection.', label: 'Cancel unfinished' })) return;
        await service.cancelBatch(id);
        notify('Cancellation requested for unfinished checks.');
        refreshBatchSummary(id);
        refreshImage(selectedId);
      } else {
        const all = action === 'delete-all';
        if (!await confirmAction({ title: all ? 'Delete your collections?' : 'Delete this collection?',
          body: 'This removes photos and results from the selected browser-session history.', label: 'Delete' })) return;
        const result = all ? await service.deleteCollections() : await service.deleteBatch(id);
        if (all || batchId === id) {
          if (batchId) forgetCollection(batchId, '');
          uploadGroup = null;
          if (all) batches = [];
        }
        notify(describeDeletion(result));
        refreshBatches();
      }
    } catch (error) {
      if (error.status === 404 && id) forgetCollection(id);
      else showError(error, 'collection');
    }
  }

  async function cancelImage() {
    const id = selectedId;
    if (!ready || !id) return;
    if (!await confirmAction({ title: 'Cancel unfinished checks?', body: 'Completed model results will remain available.', label: 'Cancel unfinished' })) return;
    try {
      await service.cancelImage(id);
      notify('Cancellation requested for unfinished checks.');
      refreshImage(id, true);
    } catch (error) { showError(error); }
  }

  for (const [id, many] of [['photo-input', false], ['device-input', false], ['batch-input', true], ['folder-input', true]]) {
    $(id).onchange = event => {
      addFiles(event.target.files, many);
      event.target.value = '';
    };
  }

  $('submit-photos').onclick = submit;

  root.addEventListener('click', event => {
    const modeButton = event.target.closest('[data-mode]');
    if (modeButton && inputMode !== modeButton.dataset.mode) {
      stopCamera(false);
      inputMode = modeButton.dataset.mode;
      renderInputMode();
      return;
    }
    const actionButton = event.target.closest('[data-action]');
    if (!actionButton) return;
    const { action, key, id } = actionButton.dataset;
    if (action === 'browse-photo') $('photo-input').click();
    else if (action === 'sample-photo') selectSample();
    else if (action === 'browse-batch') $('batch-input').click();
    else if (action === 'browse-folder') $('folder-input').click();
    else if (action === 'device-camera') $('device-input').click();
    else if (action === 'start-camera') startCamera();
    else if (action === 'stop-camera') stopCamera();
    else if (action === 'capture') capture();
    else if (action === 'clear-files') {
      discardSelection();
      completedAdmission = null;
      userNotice = '';
      renderIntakeState();
    } else if (action === 'remove-file') {
      const index = selected.findIndex(item => item.key === key);
      if (index < 0) return;
      const [item] = selected.splice(index, 1);
      if (item.url) URL.revokeObjectURL(item.url);
      renderIntakeState();
    } else if (action === 'files-prev' || action === 'files-next') {
      selectionPage += action === 'files-prev' ? -1 : 1;
      renderIntakeState();
    } else if (action === 'select-batch') {
      if (!uploadBusy) chooseBatch(id);
    }
    else if (action === 'new-batch') createCollection();
    else if (action === 'open-image') {
      selectedId = id;
      renderResults();
      refreshImage(id, true);
      onNavigate('scan');
      requestAnimationFrame(() => $('results-title').scrollIntoView({ block: 'nearest' }));
    } else if (action === 'prev' || action === 'next') {
      listQuery.page += action === 'prev' ? -1 : 1;
      refreshList();
    } else if (action === 'cancel-image') cancelImage();
    else collectionAction(action);
  });

  let searchTimer;
  function filtersChanged() {
    const fields = Object.fromEntries(new FormData(form));
    listQuery = { ...listQuery, ...fields, page: 1 };
    refreshList();
  }
  form.onchange = event => { if (event.target.name !== 'search') filtersChanged(); };
  form.onsubmit = event => { event.preventDefault(); filtersChanged(); };
  form.querySelector('[name="search"]').oninput = () => {
    clearTimeout(searchTimer);
    searchTimer = setTimeout(filtersChanged, 250);
  };

  document.addEventListener('paste', event => {
    if (page !== 'scan' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
    const images = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'));
    if (images.length) {
      event.preventDefault();
      addFiles(images, inputMode === 'batch');
    }
  });
  document.addEventListener('visibilitychange', () => {
    if (document.hidden) stopCamera();
  });
  window.addEventListener('pagehide', () => {
    stopCamera(false);
    stopWatch();
  });
  window.addEventListener('pageshow', event => {
    if (event.persisted && batchId) watchBatch(batchId, activeBatch?.event_cursor ?? 0);
  });
  renderInputMode();
  renderCollections();
  renderResults();

  return {
    setReady(value) {
      ready = value;
      if (!value) {
        started = false;
        stopWatch();
      }
      renderIntakeState();
      if (value) {
        initializeCollections();
        if (batchId && !watchStop) watchBatch(batchId, activeBatch?.event_cursor ?? 0);
      }
    },
    setPage(next) {
      const previous = page;
      page = next;
      $('scan-screen').hidden = next !== 'scan';
      $('collections-screen').hidden = next !== 'collections';
      if (next !== 'scan') stopCamera();
      if (next === 'operator') stopWatch();
      else if (previous === 'operator' && batchId && ready) watchBatch(batchId, activeBatch?.event_cursor ?? 0);
      if (next === 'collections' && ready) {
        refreshBatches({ quiet: true });
        refreshList({ quiet: true });
      }
    },
  };
}
