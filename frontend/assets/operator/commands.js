// Execute authorized exports, cancellation, deletion, and phone commands.
import { array, number, count, upper, errorStatus, errorText, connectionURL } from './format.js';
import { resource } from './resources.js';

// Connect commands behavior to shared state and actions.
export function installCommands(context) {
  const { root, service, confirmAction, notify, state: store, actions, outlet } = context;

  // Describe deleted collection totals and any pending file cleanup.
  function deletionResult(data, verb) {
    const deleted = data?.deleted;
    if (!deleted) return verb + '.';
    const collections = number(deleted.collections);
    const photos = number(deleted.photos);
    const details = [
      collections === null ? '' : count(collections) + (collections === 1 ? ' collection' : ' collections'),
      photos === null ? '' : count(photos) + (photos === 1 ? ' photo' : ' photos'),
    ].filter(Boolean).join(' and ');
    return (details ? verb + ' · ' + details + '.' : verb + '.')
    + (deleted.cleanup_pending ? ' File cleanup is pending on the host.' : '');
  }

  // Confirm and execute an authorized operator command.
  async function perform(action, id) {
    if (store.busy || store.disposed) return;
    const current = store.request;
    const imageId = current?.imageId;
    const batchId = current?.id;
    const privileged = action === 'retry' || action === 'reset';
    if (privileged && !actions.canOperate()) return;
    const confirmation = {
      'cancel-image': ['Cancel unfinished checks?', 'Queued checks will end. A running check can finish its current pass before discarding the result.', 'Cancel checks'],
      'cancel-batch': ['Cancel this collection?', 'Unfinished checks in this collection will be cancelled. Completed results will stay available.', 'Cancel collection'],
      'delete-batch': ['Delete this collection?', 'This removes the collection and its saved scan data from your browser session.', 'Delete collection'],
      'delete-collections': ['Delete your browser collections?', 'This removes all scan collections owned by this browser session.', 'Delete browser collections'],
      reset: ['Reset all scan data?', 'This removes every browser’s scan collections and results. Research, models, and connection configuration are preserved.', 'Reset all scan data', 'RESET'],
    }[action];
    if (['export', 'cancel-batch', 'delete-batch'].includes(action) && !batchId) return;
    if (action === 'cancel-image' && !imageId) return;
    store.busy = action;
    actions.scheduleRender();
    try {
      if (confirmation) {
        const [title, body, label, requireText] = confirmation;
        if (!await confirmAction({ title, body, label, requireText }) || store.disposed) return;
      }
      if (privileged) {
        await actions.refreshHost();
        if (store.disposed) return;
        if (!actions.canOperate()) {
          notify('Direct localhost access is required for this control.', 'error');
          return;
        }
      }
      if (action === 'retry') {
        await service.retryConnection();
        if (store.disposed) return;
        notify('Phone connection retry requested.');
        actions.refreshHost();
      } else if (action === 'export') {
        const file = await service.exportFile(batchId, id);
        if (store.disposed) return;
        const href = URL.createObjectURL(file.blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = file.filename;
        root.append(link);
        link.click();
        link.remove();
        store.downloads.set(href, setTimeout(() => { URL.revokeObjectURL(href); store.downloads.delete(href); }, 30000));
      } else if (action === 'cancel-image' || action === 'cancel-batch') {
        const result = action === 'cancel-image' ? await service.cancelImage(imageId) : await service.cancelBatch(batchId);
        if (store.disposed) return;
        notify(result?.cancelled_or_requested === 0 ? 'No unfinished checks required cancellation.' : 'Cancellation requested.');
        actions.refreshRequest(current, { latest: true });
        actions.refreshBatches();
      } else if (action === 'delete-batch') {
        const result = await service.deleteBatch(batchId);
        if (store.disposed) return;
        if (store.request?.id === batchId) actions.clearRequest(actions.deletionResult(result, 'Collection deleted'));
        store.batches = resource(array(store.batches.data).filter((batch) => batch.batch_id !== batchId));
        if (actions.allowedRequest()) actions.refreshBatches();
        notify(actions.deletionResult(result, 'Collection deleted'), 'success');
      } else {
        const reset = action === 'reset';
        const result = reset ? await service.reset('RESET') : await service.deleteCollections();
        if (store.disposed) return;
        store.cleanupMessage = actions.deletionResult(result, reset ? 'Scan data reset' : 'Browser collections deleted');
        actions.clearRequest('');
        store.batches = resource([]);
        store.settings = resource();
        actions.read(store.settings, () => service.settings());
        if (actions.allowedRequest()) actions.refreshBatches();
        notify(store.cleanupMessage, 'success');
      }
    } catch (error) {
      if (store.disposed) return;
      if (privileged && [401, 403].includes(errorStatus(error))) {
        store.host.error = error;
        actions.refreshHost();
      }
      if (errorStatus(error) === 404 && current && ['delete-batch', 'cancel-batch', 'export'].includes(action)) actions.batchGone(current);
      const prefix = errorStatus(error) === 409 ? 'The operation is currently blocked. ' : '';
      notify(prefix + errorText(error), 'error');
    } finally {
      store.busy = '';
      actions.scheduleRender();
    }
  }

  // Open an active queue photo within its browser-owned collection.
  async function openQueuePhoto(id) {
    try {
      const image = await service.image(id);
      if (store.disposed) return;
      if (!image?.batch_id) {
        notify('No collection details were returned for this photo.', 'error');
        return;
      }

      actions.chooseTab('requests');
      actions.chooseBatch(image.batch_id, image);
    } catch (error) {
      if (store.disposed) return;
      notify([401, 403, 404].includes(errorStatus(error)) ? 'This photo is unavailable in this browser session.' : errorText(error), 'error');
    }
  }

  // Copy the authorized pairing link or public connection URL.
  async function copyLink() {
    const value = store.host.data;
    const pairingLink = actions.canOperate() && upper(value?.status) === 'READY' ? connectionURL(value.connect_url) : '';
    const link = pairingLink || connectionURL(value?.public_url);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      if (!store.disposed) notify(pairingLink ? 'Pairing link copied.' : 'Public link copied.', 'success');
    } catch {
      if (store.disposed) return;
      const input = outlet.querySelector('[data-pair-link]');
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      notify('Clipboard access is unavailable. Copy the link from the connection panel.');
    }
  }

  Object.assign(actions, { deletionResult, perform, openQueuePhoto, copyLink });
}
