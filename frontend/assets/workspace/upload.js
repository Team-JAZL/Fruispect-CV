// Submit idempotent photo admissions and preserve retry state.
import { makeKey } from './components.js';

// Connect upload behavior to shared state and actions.
export function installUpload(context) {
  const { service, state: store, actions } = context;

  // Admit selected photos with stable keys and retain recoverable upload failures.
  async function submit() {
    if (store.uploadBusy || !store.ready) return;
    const todo = store.selected.filter(item => item.status === 'selected' || item.status === 'retry');
    if (!todo.length) return;
    if (store.retryAt > Date.now()) {
      store.userNotice = `The host asked for a pause. Retry in ${Math.ceil((store.retryAt - Date.now()) / 1000)} seconds.`;
      actions.renderIntakeState();
      return;
    }
    if (todo.some(item => item.uploadBatchId && item.uploadBatchId !== store.batchId)) {
      store.userNotice = 'Return to the original collection to retry its files, or remove those files to start a new check.';
      actions.renderIntakeState();
      return;
    }
    store.uploadBusy = true;
    store.userNotice = '';
    store.completedAdmission = null;
    const fileLabel = todo.length === 1 ? 'file' : 'files';
    store.uploadStatus = `0 of ${todo.length} ${fileLabel} submitted`;
    actions.renderIntakeState();
    let lastImage = null;
    let processed = 0;
    let admitted = 0;
    let rejected = 0;
    let deferred = 0;
    let group = store.uploadGroup;
    try {
      if (!group || group.id !== store.batchId || store.activeBatch?.status === 'CANCELLED') {
        if (store.activeBatch?.status === 'CANCELLED' && todo.some(item => item.uploadBatchId)) {
          throw new Error('This collection was cancelled. Remove the old retry files and select the originals for a new check.');
        }
        if (!store.batchId || store.activeBatch?.status === 'CANCELLED') {
          const created = await service.createBatch(store.newBatchKey);
          if (store.batchId !== created.batch_id) {
            actions.stopWatch();
            store.selectedId = null;
            store.cache.clear();
          }
          store.activeBatch = created;
          store.batchId = created.batch_id;
          store.newBatchKey = makeKey();
        }
        group = { id: store.batchId, offset: Number(store.activeBatch?.summary?.total_submitted ?? store.activeBatch?.summary?.accepted ?? 0) };
        store.uploadGroup = group;
      }
      for (const item of todo) {
        if (!store.ready) break;
        if (item.uploadBatchId && item.uploadBatchId !== group.id) break;
        if (item.offset == null) {
          item.offset = group.offset++;
          item.uploadBatchId = group.id;
        }
        item.status = 'uploading';
        actions.renderIntakeState();
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
            if (store.batchId === item.uploadBatchId && lastImage) {
              store.selectedId = lastImage;
              await actions.refreshImage(lastImage);
            }
          } else if (failed) {
            const status = Number(failed.http_status);
            item.status = status === 429 || status === 503 || status >= 500 ? 'retry' : 'rejected';
            item.message = failed.message || failed.code || 'This file was rejected.';
            if (item.status === 'retry') deferred++;
            else rejected++;
            if (result.retryAfterMs && item.status === 'retry') {
              store.retryAt = Date.now() + result.retryAfterMs;
              store.userNotice = `The host asked for a pause. Retry in ${Math.ceil(result.retryAfterMs / 1000)} seconds.`;
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
          if (error.retryAfterMs) store.retryAt = Date.now() + error.retryAfterMs;
          actions.showError(error);
          if ([401, 404, 409, 429, 503].includes(error.status) || !error.status || error.status >= 500) {
            if (error.status === 404 || error.status === 409) {
              store.uploadGroup = null;
              if (error.status === 404) actions.forgetCollection(group.id);
            }
            break;
          }
        } finally {
          processed++;
          store.uploadStatus = `${processed} of ${todo.length} ${fileLabel} submitted`;
          actions.renderIntakeState();
        }
      }
    } catch (error) {
      actions.showError(error);
    } finally {
      store.uploadBusy = false;
      store.uploadStatus = '';
      if (admitted || rejected || deferred) {
        const parts = [`${admitted} accepted`, `${rejected} rejected`];
        if (deferred) parts.push(`${deferred} can be retried`);
        if (processed < todo.length) parts.push(`${todo.length - processed} not sent`);
        store.completedAdmission = parts.join(' · ');
      }
      if (group?.id === store.batchId && group?.id) {
        await actions.chooseBatch(group.id, lastImage || store.selectedId);
        actions.refreshBatches({ quiet: true });
      }
      actions.renderIntakeState();
      actions.renderResults();
    }
  }

  Object.assign(actions, { submit });
}
