// Render owned collections, image filters, request summaries, and event history.
import { FRUITS, QUALITIES } from '../api/contracts.js';
import { PAGE_SIZE, STATUS_LABELS, JOB_STATES, html, array, number, display, count, date, words, upper, modelName, seq, shortId, errorText, jobLabel } from './format.js';
import { badge, btn, empty, notice, stateNotice, sectionHead, fields, metric, progress } from './components.js';
import { imageThumb, imageDetail } from './image.js';

// Render observed collection completion counts and progress.
export function batchSummary(batch) {
  const summary = batch?.summary ?? {};
  return `<div class="fo-batch-progress"><div><strong>${count(summary.fully_complete)} / ${count(summary.accepted)}</strong><span>photos with all checks ended</span></div>${progress(summary.fully_complete, summary.accepted, 'Photos with all checks ended')}</div>`;
}

// Render browser-owned collection choices and selection state.
export function batchList(resource, chosen) {
  const batches = array(resource.data);
  return `${stateNotice(resource, 'collections')}${batches.length ? `<ul class="fo-selection-list">${batches.map((batch) => `<li><button type="button" data-action="batch" data-id="${html(batch.batch_id)}" aria-pressed="${batch.batch_id === chosen}">
    <span class="fo-selection-title"><strong>Collection <span class="fo-mono">${html(shortId(batch.batch_id))}</span></strong>${badge(batch.status)}</span>
    <span class="fo-selection-meta"><span>${html(date(batch.created_at, true))}</span><span>${count(batch.summary?.accepted)} photos</span></span>
  </button></li>`).join('')}</ul>` : resource.loading ? empty('Loading collections…') : !resource.error ? empty('No collections yet', 'Scans from this browser will appear here.') : ''}`;
}

// Render recent events associated with the selected image or collection.
export function eventTimeline(request) {
  const { events, history, streamStatus } = request;
  const streamLabel = { connecting: 'Connecting', reconnecting: 'Reconnecting', live: 'Live updates', polling: 'Polling for updates', unavailable: 'Updates unavailable' }[streamStatus];
  const visibleEvents = request.imageId ? events.filter((event) => !event.image_id || event.image_id === request.imageId) : events;
  return `<section data-reveal class="fo-card fo-timeline">
    ${sectionHead('Event timeline', request.imageId ? 'Recent events for this photo and its collection.' : 'Recent events for this collection.', streamLabel ? badge(streamStatus === 'live' ? 'READY' : '', streamLabel) : '')}
    ${stateNotice(history, 'event history', events.length > 0)}
    ${request.streamError ? notice(errorText(request.streamError), 'warn') : ''}
    ${visibleEvents.length ? `<ol>${visibleEvents.slice(-18).reverse().map((event) => `<li><div><strong>${html(words(event.event_type) || 'Update')}</strong>${event.model_key ? `<span>${html(modelName(event.model_key))}</span>` : ''}${event.payload?.status ? badge(event.payload.status, jobLabel(event.payload.status)) : ''}</div><time>${html(date(event.created_at, true))}</time></li>`).join('')}</ol>` : !history.error ? empty(history.loading ? 'Reading event history…' : 'No recent events for this selection') : ''}
  </section>`;
}

// Render collection status, recorded totals, and available commands.
export function requestDetails(request, busy) {
  const batch = request.batch.data;
  if (!batch) return stateNotice(request.batch, 'collection') + (request.batch.loading ? empty('Opening collection…') : '');
  const summary = batch.summary ?? {};
  const canCancel = batch.status === 'ACTIVE' && ((number(summary.accepted) ?? 0) > (number(summary.fully_complete) ?? 0) || number(summary.accepted) === null);
  return `<section data-reveal class="fo-card fo-request-summary">
    ${stateNotice(request.batch, 'collection')}
    <div class="fo-card-head"><div><h2>Collection detail</h2><p class="fo-mono">${html(shortId(batch.batch_id))}</p></div>${badge(batch.status)}</div>
    ${batchSummary(batch)}
    <div class="fo-summary-metrics">${metric('Accepted photos', count(summary.accepted))}${metric('Rejected submissions', count(summary.rejected))}${metric('Queued model jobs', count(summary.queued))}${metric('Running model jobs', count(summary.running))}</div>
    <details class="fo-disclosure" data-disclosure="batch-summary"><summary>Collection counts and timestamps</summary>
      ${fields([
        ['Collection ID', batch.batch_id, true], ['Created', date(batch.created_at)], ['Cancelled', date(batch.cancelled_at)], ['Total submissions', summary.total_submitted],
        ['Photos preparing', summary.preprocessing], ['Photos with partial results', summary.partial], ['Photos with a failed or unavailable check', summary.failed], ['Photos with a cancelled check', summary.cancelled],
      ])}
      <p class="fo-card-note">A photo can appear in more than one count.</p>
    </details>
    <div class="fo-actions">
      ${btn('Export CSV', 'export', { id: 'csv', disabled: busy, shortLabel: 'CSV' })}${btn('Export JSON', 'export', { id: 'json', disabled: busy, shortLabel: 'JSON' })}
      ${canCancel ? btn('Cancel collection', 'cancel-batch', { disabled: busy }) : ''}
      ${btn('Delete collection', 'delete-batch', { disabled: busy, variant: 'danger' })}
    </div>
  </section>`;
}

// Render paginated accepted photos and their current processing state.
export function requestPhotos(request) {
  const resource = request.images;
  const rows = array(resource.data?.images);
  const total = number(resource.data?.total);
  const pages = total === null ? null : Math.max(1, Math.ceil(total / (number(resource.data?.limit) || PAGE_SIZE)));
  return `${stateNotice(resource, 'photos')}${rows.length ? `<ul class="fo-selection-list fo-photo-list">${rows.map((image) => `<li><button type="button" data-action="photo" data-id="${html(image.image_id)}" aria-pressed="${image.image_id === request.imageId}">
    ${imageThumb(image, false)}<span><strong>${html(image.original_filename ?? 'Accepted photo')}</strong><small>${html(seq(image.admission_seq))} · ${image.terminal ? 'Checks ended' : html(STATUS_LABELS[upper(image.input_status)] ?? 'In progress')}</small></span>
  </button></li>`).join('')}</ul>` : resource.loading ? empty('Loading photos…') : !resource.error ? empty('No matching photos', 'Accepted photos matching these filters will appear here.') : ''}
  ${pages !== null && (pages > 1 || request.query.page > 1) ? `<div class="fo-pagination">${btn('Previous', 'page', { id: -1, disabled: request.query.page <= 1 })}<span>Page ${request.query.page} of ${pages}</span>${btn('Next', 'page', { id: 1, disabled: request.query.page >= pages })}</div>` : ''}`;
}

// Render a labeled request filter with its current option.
export function selectFilter(label, name, values, current) {
  return `<label><span>${html(label)}</span><select name="${html(name)}" data-filter>${values.map(([value, title]) => `<option value="${html(value)}"${current === value ? ' selected' : ''}>${html(title)}</option>`).join('')}</select></label>`;
}

// Render search, sorting, and model-result filters for collection images.
export function photoFilters(query) {
  return `<form class="fo-filters" data-photo-filters>
    <div class="fo-filter-main"><label><span>Filename</span><input type="search" name="search" placeholder="Search filename" value="${html(query.search)}" data-filter></label>${selectFilter('Sort', 'sort', [['newest', 'Newest first'], ['oldest', 'Oldest first']], query.sort)}</div>
    <details class="fo-disclosure" data-disclosure="photo-filters"><summary>Filters</summary><div class="fo-filter-options">
      ${selectFilter('Status', 'status', [['', 'Any status'], ['TERMINAL', 'All checks ended'], ...JOB_STATES.map((value) => [value, value === 'COMPLETED' ? 'Any successful check' : jobLabel(value)])], query.status)}
      ${selectFilter('Fruit', 'fruit', [['', 'Any fruit'], ...FRUITS.map((value) => [value, value])], query.fruit)}
      ${selectFilter('Quality', 'quality', [['', 'Any quality'], ...QUALITIES.map((value) => [value, value])], query.quality)}
      ${selectFilter('Comparison', 'agreement', [['', 'Any comparison'], ['agreement', 'Agreement'], ['disagreement', 'Disagreement']], query.agreement)}
    </div></details>
  </form>`;
}

// Render owned collections, selected photos, and their event history.
export function requestsView(request, batches, busy, cleared) {

  const intro = sectionHead('Requests', 'Choose a collection, then a photo.');

  return `${intro}${cleared ? notice(cleared) : ''}
    <div class="fo-requests-grid">
      <aside class="fo-requests-aside">
        <section data-reveal class="fo-card fo-collection-list">
          ${sectionHead('Collections', 'Owned by this browser session.')}
          <div data-slot="collections">${batchList(batches, request?.id)}</div>
        </section>
        ${request ? `<section data-reveal class="fo-card fo-photos">
          ${sectionHead('Photos', 'Search and filter accepted inputs.')}
          <div data-slot="filters">${photoFilters(request.query)}</div>
          <div data-slot="photos">${requestPhotos(request)}</div>
        </section>` : ''}
      </aside>
      <div class="fo-request-main">
        ${request ? `<div data-slot="summary">${requestDetails(request, busy)}</div>
          <section data-reveal class="fo-card fo-photo-panel" aria-label="Photo details"><div data-slot="image">${imageDetail(request.image, busy)}</div></section>
          <div data-slot="timeline">${eventTimeline(request)}</div>`
          : `<section data-reveal class="fo-card">${empty('No collection selected', 'Select a collection to see its progress, photos, and model results.')}</section>`}
      </div>
    </div>`;
}
