// Render selected predictions and paginated browser collections.
import { MODELS, isTerminal } from '../api/contracts.js';
import { icon, escapeHtml as e, formatDate, preserveFocus } from '../ui.js';
import { idOf, badge, callout, thumbnail, resultCard, agreement } from './components.js';

// Connect render behavior to shared state and actions.
export function installRender(context) {
  const { state: store, actions, $, form } = context;

  // Render the selected photo, its preparation state, and available commands.
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

  // Render results from the current application state.
  function renderResults() {
    const image = store.cache.get(store.selectedId);
    const count = image ? MODELS.filter(({ key }) => image.jobs?.[key]?.status === 'COMPLETED' && image.jobs[key].result).length : 0;
    preserveFocus($('inspection-panel'), `<header class="panel-header"><span class="tile-icon green">${icon('activity', 19)}</span>
      <div><h2>Current check</h2><p>Selected fruit photo</p></div></header>
      ${store.streamStatus ? callout(store.streamStatus, 'neutral') : ''}
      ${actions.previewImage(image)}`);
    $('results-count').innerHTML = `<span class="badge neutral result-count">${icon('layers', 15)} ${count} of 3 model results available</span>`;
    preserveFocus($('result-cards'), MODELS.map(model => resultCard(model, image?.jobs?.[model.key], store.selectedId)).join(''));
    const state = image ? `${image.original_filename || 'Fruit photo'}: ${count} of 3 model results available.${image.terminal ? ' Checks ended.' : ''}` : '';
    if (state !== store.lastLiveAnnouncement) {
      store.lastLiveAnnouncement = state;
      $('scan-announcement').textContent = state;
    }
  }

  // Render collections from the current application state.
  function renderCollections() {
    const recent = store.batches.map(batch => `<button type="button" class="batch-choice${batch.batch_id === store.batchId ? ' chosen' : ''}"
      data-action="select-batch" data-id="${e(batch.batch_id)}" data-focus="batch-${e(batch.batch_id)}"${batch.batch_id === store.batchId ? ' aria-current="true"' : ''}>
      <span class="tile-icon mini">${icon('folder', 17)}</span><span><strong>${e(formatDate(batch.created_at))}</strong><small>${Number(batch.summary?.accepted ?? 0)} photos · ${e((batch.status ?? '').toLowerCase())}</small></span>${icon('chevron', 15)}</button>`).join('');
    preserveFocus($('batch-list'), recent || `<p class="retention-note">${store.collectionLoading ? 'Loading collections…' : 'No collections yet.'}</p>`);
    $('collection-delete').innerHTML = store.batches.length ? `<button type="button" class="text-button text-danger" data-action="delete-all">${icon('trash', 16)} Delete my collections</button>` : '';
    form.hidden = !store.batchId;
    const summary = store.activeBatch?.summary;
    const accepted = Number(summary?.accepted ?? 0);
    const ended = Number(summary?.fully_complete ?? 0);
    const batchButtons = store.batchId ? `<div class="collection-actions">
      <button type="button" class="button small" data-action="export-csv" data-focus="export-csv">${icon('download', 15)} CSV</button>
      <button type="button" class="button small" data-action="export-json" data-focus="export-json">JSON</button>
      ${accepted > ended ? '<button type="button" class="button small" data-action="cancel-batch" data-focus="cancel-batch">Cancel unfinished</button>' : ''}
      <button type="button" class="icon-button text-danger" aria-label="Delete this collection" data-action="delete-batch" data-focus="delete-batch">${icon('trash', 17)}</button>
      </div>` : '';
    preserveFocus($('collection-heading'), `<header class="panel-header collection-header"><div><h2>Collection photos</h2>
      <p>${store.batchId ? `${accepted.toLocaleString()} accepted · ${ended.toLocaleString()} checks ended` : 'Select a collection to view its photos.'}</p></div>${batchButtons}</header>
      ${accepted ? `<div class="collection-progress"><progress max="${accepted}" value="${Math.min(accepted, ended)}" aria-label="Photos whose checks ended"></progress></div>` : ''}`);
    $('collection-notice').innerHTML = store.collectionNotice ? callout(store.collectionNotice) + (store.ready ? '<button type="button" class="text-button" data-action="refresh-collections">Refresh history</button>' : '') : '';
    const rows = (store.list.images ?? []).map(image => {
        const id = idOf(image);
        const imageStatus = image.terminal ? 'Checks ended' : image.input_status === 'PROCESSING' ? 'Preparing photo' : 'Checks in progress';
      return `<li class="collection-row">${thumbnail(image, 'collection-thumb')}<div><strong>${e(image.original_filename || 'Fruit photo')}</strong><small>${e(formatDate(image.received_at))}</small></div>
        ${badge(imageStatus, image.terminal ? 'neutral' : 'active')}<button class="button small" type="button" data-action="open-image" data-id="${e(id)}" data-focus="image-${e(id)}">View results ${icon('chevron', 14)}</button></li>`;
      }).join('');
    const maxPage = Math.max(1, Math.ceil((store.list.total ?? 0) / (store.list.limit || store.listQuery.limit)));
    preserveFocus($('collection-list'), rows ? `<ul class="collection-rows">${rows}</ul>
      <div class="pagination"><button class="button small" type="button" data-action="prev" data-focus="prev"${store.listQuery.page <= 1 ? ' disabled' : ''}>Previous</button>
      <span>Page ${store.listQuery.page} of ${maxPage}</span><button class="button small" type="button" data-action="next" data-focus="next"${store.listQuery.page >= maxPage ? ' disabled' : ''}>Next</button></div>`
      : `<div class="empty"><span class="tile-icon green">${icon('photo', 22)}</span><h3>${store.collectionLoading ? 'Loading collection…' : store.batchId ? 'No matching photos' : 'No collection selected'}</h3><p>${store.batchId ? 'Upload photos or adjust the filters.' : 'Your next scan will create a collection.'}</p></div>`);
  }

  Object.assign(actions, { previewImage, renderResults, renderCollections });
}
