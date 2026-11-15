// Assemble workspace controllers, shared state, and browser event bindings.
import { renderLayout } from './layout.js';
import { createWorkspaceState } from './state.js';
import { installIntake } from './intake.js';
import { installCamera } from './camera.js';
import { installCollections } from './collections.js';
import { installWatch } from './watch.js';
import { installRender } from './render.js';
import { installUpload } from './upload.js';
import { installCommands } from './commands.js';

// Create workspace for the current browser session.
export function createWorkspace(root, { service, config, confirmAction, notify, onPairing, onNavigate }) {
  const limits = config;
  const maxBytes = limits.maxFileBytes ?? 12 * 1024 ** 2;
  const maxFiles = limits.maxBatchImages ?? 1000;
  const maxPixels = limits.maxDecodedPixels ?? 24000000;
  const retentionHours = limits.retentionHours ?? 24;
  const allowedTypes = limits.allowedTypes ?? ['image/jpeg', 'image/png', 'image/webp'];
  const mime = [...allowedTypes, '.jpg', '.jpeg', '.png', '.webp'].join(',');
  const store = createWorkspaceState();
  const actions = {};
  renderLayout(root, {mime, retentionHours});
  // Find a workspace element within its owning feature root.
  const $ = id => root.querySelector(`#${id}`);
  const intake = $('input-body');
  const form = $('collection-filter');
  const context = { root, service, config, confirmAction, notify, onPairing, onNavigate, state: store, actions, $, intake, form, limits, maxBytes, maxFiles, maxPixels, retentionHours, allowedTypes, mime };
  installIntake(context);
  installCamera(context);
  installCollections(context);
  installWatch(context);
  installRender(context);
  installUpload(context);
  installCommands(context);
  for (const [id, many] of [['photo-input', false], ['device-input', false], ['batch-input', true], ['folder-input', true]]) {
    $(id).onchange = event => {
      actions.addFiles(event.target.files, many);
      event.target.value = '';
    };
  }
  $('submit-photos').onclick = actions.submit;
  root.addEventListener('click', event => {
      const modeButton = event.target.closest('[data-mode]');
      if (modeButton && store.inputMode !== modeButton.dataset.mode) {
        actions.stopCamera(false);
        store.inputMode = modeButton.dataset.mode;
        actions.renderInputMode();
        return;
      }
      const actionButton = event.target.closest('[data-action]');
      if (!actionButton) return;
      const { action, key, id } = actionButton.dataset;
      if (action === 'browse-photo') $('photo-input').click();

      else if (action === 'browse-batch') $('batch-input').click();
      else if (action === 'browse-folder') $('folder-input').click();
      else if (action === 'device-camera') $('device-input').click();
      else if (action === 'start-camera') actions.startCamera();
      else if (action === 'stop-camera') actions.stopCamera();
      else if (action === 'capture') actions.capture();
      else if (action === 'clear-files') {
        actions.discardSelection();
        store.completedAdmission = null;
        store.userNotice = '';
        actions.renderIntakeState();
      } else if (action === 'remove-file') {
        const index = store.selected.findIndex(item => item.key === key);
        if (index < 0) return;
        const [item] = store.selected.splice(index, 1);
        if (item.url) URL.revokeObjectURL(item.url);
        actions.renderIntakeState();
      } else if (action === 'files-prev' || action === 'files-next') {
        store.selectionPage += action === 'files-prev' ? -1 : 1;
        actions.renderIntakeState();
      } else if (action === 'select-batch') {
        if (!store.uploadBusy) actions.chooseBatch(id);
      }
      else if (action === 'new-batch') actions.createCollection();
      else if (action === 'open-image') {
        store.selectedId = id;
        actions.renderResults();
        actions.refreshImage(id, true);
        onNavigate('scan');
        requestAnimationFrame(() => $('results-title').scrollIntoView({ block: 'nearest' }));
      } else if (action === 'prev' || action === 'next') {
        store.listQuery.page += action === 'prev' ? -1 : 1;
        actions.refreshList();
      } else if (action === 'cancel-image') actions.cancelImage();
      else actions.collectionAction(action);
    });
  form.onchange = event => { if (event.target.name !== 'search') actions.filtersChanged(); };
  form.onsubmit = event => { event.preventDefault(); actions.filtersChanged(); };
  form.querySelector('[name="search"]').oninput = () => {
    clearTimeout(store.searchTimer);
    store.searchTimer = setTimeout(actions.filtersChanged, 250);
  };
  document.addEventListener('paste', event => {
      if (store.page !== 'scan' || ['INPUT', 'TEXTAREA', 'SELECT'].includes(event.target?.tagName)) return;
      const images = [...(event.clipboardData?.files ?? [])].filter(file => file.type.startsWith('image/'));
      if (images.length) {
        event.preventDefault();
        actions.addFiles(images, store.inputMode === 'batch');
      }
    });
  document.addEventListener('visibilitychange', () => {
      if (document.hidden) actions.stopCamera();
    });
  window.addEventListener('pagehide', () => {
      actions.stopCamera(false);
      actions.stopWatch();
    });
  window.addEventListener('pageshow', event => {
      if (event.persisted && store.batchId) actions.watchBatch(store.batchId, store.activeBatch?.event_cursor ?? 0);
    });
  actions.renderInputMode();
  actions.renderCollections();
  actions.renderResults();
  return {
    // Set ready.
    setReady(value) {
      store.ready = value;
      if (!value) {
        store.started = false;
        actions.stopWatch();
      }
      actions.renderIntakeState();
      if (value) {
        actions.initializeCollections();
        if (store.batchId && !store.watchStop) actions.watchBatch(store.batchId, store.activeBatch?.event_cursor ?? 0);
      }
    },
    // Set page.
    setPage(next) {
      const previous = store.page;
      store.page = next;
      $('scan-screen').hidden = next !== 'scan';
      $('collections-screen').hidden = next !== 'collections';
      if (next !== 'scan') actions.stopCamera();
      if (next === 'operator') actions.stopWatch();
      else if (previous === 'operator' && store.batchId && store.ready) actions.watchBatch(store.batchId, store.activeBatch?.event_cursor ?? 0);
      if (next === 'collections' && store.ready) {
        actions.refreshBatches({ quiet: true });
        actions.refreshList({ quiet: true });
      }
    },
  };
}
