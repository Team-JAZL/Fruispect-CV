// Create personal collections and manage collections within their access scope.
import { saveDownload } from '../ui.js';
import { makeKey } from './components.js';

// Connect commands behavior to shared state and actions.
export function installCommands(context) {
  const { service, confirmAction, notify, onNavigate, state: store, actions, globalScope = false } = context;

  // Describe removed collections and deferred spool-file cleanup.
  function describeDeletion(result) {
    const deleted = result?.deleted ?? result;
    const pending = deleted?.cleanup_pending;
    return pending ? 'Collection access was removed. File cleanup is still pending.' : 'Collection data deleted.';
  }

  // Create collection for the current browser session.
  async function createCollection() {
    if (!store.ready || store.uploadBusy) return;
    try {
      const created = await service.createBatch(store.newBatchKey);
      store.newBatchKey = makeKey();
      store.uploadGroup = null;
      await actions.chooseBatch(created.batch_id);
      actions.refreshBatches({ quiet: true });
      notify('New collection created.');
      onNavigate('scan');
    } catch (error) { actions.showError(error, 'collection'); }
  }

  // Confirm and execute collection export, cancellation, or deletion.
  async function collectionAction(action) {
    if (!store.ready || store.uploadBusy && ['delete-all', 'delete-batch', 'cancel-batch'].includes(action)) return;
    const id = store.batchId;
    if (action !== 'delete-all' && !id) return;
    try {
      if (action === 'export-csv' || action === 'export-json') {
        saveDownload(await service.exportFile(id, action.slice(7)));
      } else if (action === 'cancel-batch') {
        if (!await confirmAction({ title: 'Cancel unfinished checks?', body: 'Completed results will remain in this collection.', label: 'Cancel unfinished' })) return;
        await service.cancelBatch(id);
        notify('Cancellation requested for unfinished checks.');
        actions.refreshBatchSummary(id);
        actions.refreshImage(store.selectedId);
      } else {
        const all = action === 'delete-all';
        if (!await confirmAction({ title: all ? (globalScope ? 'Delete all global collections?' : 'Delete your collections?') : 'Delete this collection?',
              body: globalScope ? 'This removes the selected photos and results from the host and their owners’ collections.' : 'This removes photos and results from the selected browser-session history.',
              label: 'Delete', requireText: globalScope && all ? 'RESET' : '' })) return;
        const result = all ? await service.deleteCollections() : await service.deleteBatch(id);
        if (all || store.batchId === id) {
          if (store.batchId) actions.forgetCollection(store.batchId, '');
          store.uploadGroup = null;
          if (all) store.batches = [];
        }
        notify(actions.describeDeletion(result));
        actions.refreshBatches();
      }
    } catch (error) {
      if (error.status === 404 && id) actions.forgetCollection(id);
      else actions.showError(error, 'collection');
    }
  }

  // Request cancellation of unfinished model jobs for one image.
  async function cancelImage() {
    const id = store.selectedId;
    if (!store.ready || !id) return;
    if (!await confirmAction({ title: 'Cancel unfinished checks?', body: 'Completed model results will remain available.', label: 'Cancel unfinished' })) return;
    try {
      await service.cancelImage(id);
      notify('Cancellation requested for unfinished checks.');
      actions.refreshImage(id, true);
    } catch (error) { actions.showError(error); }
  }

  Object.assign(actions, { describeDeletion, createCollection, collectionAction, cancelImage });
}
