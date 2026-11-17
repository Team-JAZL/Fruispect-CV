// Load and select collections, merge results, and apply collection filters.
import { mergeImage } from '../state/requests.js';
import { idOf } from './components.js';

// Connect collections behavior to shared state and actions.
export function installCollections(context) {
  const { service, onPairing, state: store, actions, form } = context;

  // Cache a merged image while retaining the current selection.
  function remember(image) {
    const id = idOf(image);
    if (!id) return;
    const merged = mergeImage(store.cache.get(id), image);
    store.cache.delete(id);
    store.cache.set(id, merged);
    if (store.cache.size > 70) {
      const oldest = [...store.cache.keys()].find(candidate => candidate !== store.selectedId && candidate !== store.reviewId);
      if (oldest) store.cache.delete(oldest);
    }
  }

  // Load an image snapshot without changing the selected image.
  async function refreshImage(id, report = false) {
    if (!id) return;
    const requestBatch = store.batchId;
    try {
      const image = await service.image(id);
      if (!store.ready || requestBatch !== store.batchId || !image) return;
      actions.remember(image);
      if (id === store.selectedId) actions.renderResults();
      if (id === store.reviewId) actions.renderReview();
    } catch (error) {
      if (requestBatch !== store.batchId) return;
      if (error.status === 401) onPairing(error.message);
      else if (report && id === store.reviewId) {
        store.reviewError = error.message || 'The results could not be loaded.';
        actions.renderReview();
      } else if (report) actions.showError(error);
    }
  }

  // Refresh batches from the current service snapshots.
  async function refreshBatches({ quiet = false } = {}) {
    if (!store.ready) return;
    const sequence = ++store.batchesSequence;
    try {
      const batches = await service.batches();
      if (!store.ready || sequence !== store.batchesSequence) return;
      store.batches = batches;
      actions.renderCollections();
    } catch (error) {
      if (!store.ready || sequence !== store.batchesSequence) return;
      if (!quiet) actions.showError(error, 'collection');
      else if (error.status === 401) onPairing(error.message);
    }
  }

  // Clear removed collection state and discard obsolete subscriptions.
  function forgetCollection(id, message = 'This collection has expired or was deleted.') {
    if (id !== store.batchId) return;
    actions.closeReview?.();
    store.loadSequence++;
    actions.stopWatch();
    store.batchId = null;
    store.selectedId = null;
    store.activeBatch = null;
    store.cache.clear();
    store.cursors.delete(id);
    if (store.uploadGroup?.id === id) store.uploadGroup = null;
    store.list = { images: [], page: 1, limit: 20, total: 0 };
    store.batches = store.batches.filter(item => item.batch_id !== id);
    store.streamStatus = '';
    store.collectionNotice = message;
    if (message) store.userNotice = message;
    actions.renderCollections();
    actions.renderResults();
    actions.renderIntakeState();
  }

  // Refresh batch summary from the current service snapshots.
  async function refreshBatchSummary(id) {
    try {
      const batch = await service.batch(id);
      if (id !== store.batchId) return;
      store.activeBatch = batch;
      actions.renderCollections();
    } catch (error) {
      if (id === store.batchId && error.status === 404) actions.forgetCollection(id);
      else if (id === store.batchId && error.status === 401) onPairing(error.message);
    }
  }

  // Refresh list from the current service snapshots.
  async function refreshList({ quiet = false } = {}) {
    if (!store.batchId) return;
    const id = store.batchId;
    const sequence = ++store.listSequence;
    try {
      const next = await service.images(id, store.listQuery);
      if (id !== store.batchId || sequence !== store.listSequence) return;
      const maxPage = Math.max(1, Math.ceil(next.total / (next.limit || store.listQuery.limit)));
      if (store.listQuery.page > maxPage) {
        store.listQuery.page = maxPage;
        return refreshList({ quiet });
      }
      store.list = next;
      actions.renderCollections();
    } catch (error) {
      if (id !== store.batchId || sequence !== store.listSequence) return;
      if (error.status === 404) actions.forgetCollection(id);
      else if (!quiet || error.status === 401) actions.showError(error, 'collection');
    }
  }

  // Select a collection and restore its snapshots and live updates.
  async function chooseBatch(id, preferredImage = null) {
    const sequence = ++store.loadSequence;
    if (store.batchId !== id) {
      actions.closeReview?.();
      actions.stopWatch();
      store.streamStatus = '';
      store.cache.clear();
      store.listQuery.page = 1;
      store.list = { images: [], page: 1, limit: 20, total: 0 };
      store.selectedId = null;
    }
    store.batchId = id;
    store.activeBatch = store.batches.find(item => item.batch_id === id) ?? null;
    store.collectionNotice = '';
    store.collectionLoading = true;
    actions.renderCollections();
    try {
      const [batch, initial] = await Promise.all([
          service.batch(id), service.images(id, store.listQuery),
        ]);
      if (sequence !== store.loadSequence || store.batchId !== id) return;
      store.activeBatch = batch;
      store.list = initial;
      store.selectedId = preferredImage || store.selectedId || idOf(initial.images?.[0]) || null;
      if (store.selectedId) await actions.refreshImage(store.selectedId);
      if (sequence === store.loadSequence && store.batchId === id) actions.watchBatch(id, batch.event_cursor ?? 0);
    } catch (error) {
      if (sequence !== store.loadSequence || store.batchId !== id) return;
      if (error.status === 404) actions.forgetCollection(id);
      else actions.showError(error, 'collection');
    } finally {
      if (sequence === store.loadSequence) {
        store.collectionLoading = false;
        actions.renderCollections();
        actions.renderResults();
      }
    }
  }

  // Restore recent browser collections when the connection becomes available.
  async function initializeCollections() {
    if (store.started || !store.ready) return;
    store.started = true;
    store.collectionLoading = true;
    actions.renderCollections();
    await actions.refreshBatches();
    store.collectionLoading = false;
    if (store.batches[0] && !store.batchId) await actions.chooseBatch(store.batches[0].batch_id);

    actions.renderCollections();
    actions.renderResults();
  }

  // Reset pagination and reload collection images using the current filters.
  function filtersChanged() {
    const fields = Object.fromEntries(new FormData(form));
    store.listQuery = { ...store.listQuery, ...fields, page: 1 };
    actions.refreshList();
  }

  Object.assign(actions, { remember, refreshImage, refreshBatches, forgetCollection, refreshBatchSummary, refreshList, chooseBatch, initializeCollections, filtersChanged });
}
