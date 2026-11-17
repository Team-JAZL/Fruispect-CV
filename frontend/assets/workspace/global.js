// Assemble the host collection gallery using the shared collection workflow.
import { collectionLayout } from './layout.js';
import { createCollectionState } from './state.js';
import { installCollections } from './collections.js';
import { installCollectionRender } from './collection-render.js';
import { installCollectionEvents } from './collection-events.js';
import { installWatch } from './watch.js';
import { installCommands } from './commands.js';
import { installReview } from './review.js';

// Mount an isolated host gallery without changing the device's scan selection.
export function createGlobalCollections(root, { service, config, confirmAction, notify, onPairing }) {
  const store = createCollectionState();
  root.innerHTML = collectionLayout({ retentionHours: config.retentionHours ?? 24, globalScope: true });
  const $ = id => root.querySelector(`#global-${id}`);
  const actions = {
    // Keep scan-only updates outside the host gallery.
    renderResults() {}, renderIntakeState() {},
    // Surface host gallery errors in the collection panel.
    showError(error) {
      if (error.status === 401) onPairing(error.message);
      else {
        store.collectionNotice = error.message || 'Global Collections could not be loaded.';
        actions.renderCollections();
      }
    },
  };
  const context = { root, service, config, confirmAction, notify, onPairing, state: store, actions, $, form: $('collection-filter'), globalScope: true };
  installCollections(context);
  installCollectionRender(context);
  installWatch(context);
  installCommands(context);
  installReview(context);
  installCollectionEvents(context);
  let timer;
  let visible = false;
  let generation = 0;

  // Discover collections from newly connected devices while the gallery is visible.
  async function refresh() {
    const current = generation;
    try {
      if (!visible || !store.ready || document.hidden) return;
      await actions.refreshBatches();
      if (current !== generation || !visible) return;
      if (store.batchId && !store.batches.some(batch => batch.batch_id === store.batchId)) actions.forgetCollection(store.batchId);
      if (!store.batchId && store.batches[0]) await actions.chooseBatch(store.batches[0].batch_id);
      else await actions.refreshList({ quiet: true });
    } finally {
      if (current === generation && visible && store.ready) timer = setTimeout(refresh, 5000);
    }
  }

  // Release host gallery subscriptions and pending discovery work.
  function stop() {
    generation++;
    clearTimeout(timer);
    clearTimeout(store.searchTimer);
    actions.stopWatch();
    actions.closeReview();
  }

  window.addEventListener('pagehide', stop);
  actions.renderCollections();
  return {
    // Suspend host reads when connection authorization changes.
    setReady(value) {
      store.ready = value;
      if (!value) {
        stop();
        store.batchesSequence++;
        store.listSequence++;
        store.loadSequence++;
        store.batches = [];
        if (store.batchId) actions.forgetCollection(store.batchId, '');
        actions.renderCollections();
      }
    },
    // Start discovery and collection updates only while the host tab is active.
    setVisible(value) {
      visible = value;
      store.page = visible ? 'collections' : 'inactive';
      stop();
      if (visible && store.ready) {
        if (store.batchId) actions.watchBatch(store.batchId, store.activeBatch?.event_cursor ?? 0);
        void refresh();
      }
    },
  };
}
