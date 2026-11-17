// Render shared personal and host collection lists, filters, and commands.
import { icon, escapeHtml as e, formatDate, preserveFocus } from '../ui.js';
import { idOf, badge, callout, thumbnail } from './components.js';
import { sourceSummary } from './device.js';

// Connect collection rendering to its isolated state and service scope.
export function installCollectionRender({ state: store, actions, $, form, globalScope = false }) {
  // Render collections from the current application state.
  function renderCollections() {
    const recent = store.batches.map(batch => `<button type="button" class="batch-choice${batch.batch_id === store.batchId ? ' chosen' : ''}"
      data-action="select-batch" data-id="${e(batch.batch_id)}" data-focus="batch-${e(batch.batch_id)}"${batch.batch_id === store.batchId ? ' aria-current="true"' : ''}>
      <span class="tile-icon mini">${icon('folder', 17)}</span><span><strong>${e(formatDate(batch.created_at))}</strong><small>${Number(batch.summary?.accepted ?? 0)} photos · ${e((batch.status ?? '').toLowerCase())}</small></span>${icon('chevron', 15)}</button>`).join('');
    preserveFocus($('batch-list'), recent || `<p class="retention-note">${store.collectionLoading ? 'Loading collections…' : 'No collections yet.'}</p>`);
    $('collection-delete').innerHTML = store.batches.length ? `<button type="button" class="text-button text-danger" data-action="delete-all">${icon('trash', 16)} ${globalScope ? 'Delete all global collections' : 'Delete my collections'}</button>` : '';
    form.hidden = !store.batchId;
    const summary = store.activeBatch?.summary;
    const accepted = Number(summary?.accepted ?? 0);
    const ended = Number(summary?.fully_complete ?? 0);
    const batchButtons = store.batchId ? `<div class="collection-actions">
      <button type="button" class="button small" data-action="export-csv" data-focus="export-csv">${icon('download', 15)} CSV</button>
      <button type="button" class="button small" data-action="export-json" data-focus="export-json">JSON</button>
      ${accepted > ended ? `<button type="button" class="icon-button" data-action="cancel-batch" data-focus="cancel-batch" aria-label="Cancel unfinished checks" title="Cancel unfinished checks">${icon('close', 17)}</button>` : ''}
      <button type="button" class="icon-button text-danger" aria-label="Delete this collection" data-action="delete-batch" data-focus="delete-batch">${icon('trash', 17)}</button>
      </div>` : '';
    preserveFocus($('collection-heading'), `<header class="panel-header collection-header"><div><h2>Collection photos</h2>
      <p>${store.batchId ? `${accepted.toLocaleString()} accepted · ${ended.toLocaleString()} checks ended` : 'Select a collection to view its photos.'}</p></div>${batchButtons}</header>
      ${accepted ? `<div class="collection-progress"><progress max="${accepted}" value="${Math.min(accepted, ended)}" aria-label="Photos whose checks ended"></progress></div>` : ''}`);
    $('collection-notice').innerHTML = store.collectionNotice ? callout(store.collectionNotice) + (store.ready ? '<button type="button" class="text-button" data-action="refresh-collections">Refresh history</button>' : '') : '';
    const rows = (store.list.images ?? []).map(image => {
        const id = idOf(image);
        const imageStatus = image.terminal ? 'Checks ended' : image.input_status === 'PROCESSING' ? 'Preparing photo' : 'Checks in progress';
      return `<li class="collection-row">${thumbnail(image, 'collection-thumb')}<div><strong>${e(image.original_filename || 'Fruit photo')}</strong><small>${e(formatDate(image.received_at))}</small>${globalScope ? `<small class="device-summary">${e(sourceSummary(image.upload_source))}</small>` : ''}</div>
        ${badge(imageStatus, image.terminal ? 'neutral' : 'active')}<button class="button small review-button" type="button" data-action="open-image" data-id="${e(id)}" data-focus="image-${e(id)}" aria-label="View results for ${e(image.original_filename || 'Fruit photo')}" aria-haspopup="dialog" title="View results">${icon('eye', 18)}<span class="button-label">Results</span></button></li>`;
      }).join('');
    const maxPage = Math.max(1, Math.ceil((store.list.total ?? 0) / (store.list.limit || store.listQuery.limit)));
    preserveFocus($('collection-list'), rows ? `<ul class="collection-rows">${rows}</ul>
      <div class="pagination"><button class="button small" type="button" data-action="prev" data-focus="prev"${store.listQuery.page <= 1 ? ' disabled' : ''}>Previous</button>
      <span>Page ${store.listQuery.page} of ${maxPage}</span><button class="button small" type="button" data-action="next" data-focus="next"${store.listQuery.page >= maxPage ? ' disabled' : ''}>Next</button></div>`
      : `<div class="empty"><span class="tile-icon green">${icon('photo', 22)}</span><h3>${store.collectionLoading ? 'Loading collection…' : store.batchId ? 'No matching photos' : 'No collection selected'}</h3><p>${store.batchId ? 'Upload photos or adjust the filters.' : 'Your next scan will create a collection.'}</p></div>`);
  }

  Object.assign(actions, { renderCollections });
}
