// Render current scan predictions and commands.
import { MODELS, isTerminal } from '../api/contracts.js';
import { icon, escapeHtml as e, preserveFocus } from '../ui.js';
import { badge, callout, thumbnail, checkSummary, agreement } from './components.js';

// Connect render behavior to shared state and actions.
export function installRender(context) {
  const { state: store, actions, $ } = context;

  // Render the selected photo, its preparation state, and available commands.
  function previewImage(image) {
    if (!image) return `<div class="empty compact" data-reveal><span class="idle-scan">${icon('scan', 34)}</span><h3>A little clarity for your fruit</h3><p>Add a photo and tap Check fruit.</p><small>Your results will appear here.</small></div>`;
    const count = MODELS.filter(({ key }) => image.jobs?.[key]?.status === 'COMPLETED' && image.jobs[key].result).length;
    const pending = MODELS.some(({ key }) => {
        const status = image.jobs?.[key]?.status;
        return status && !isTerminal(status);
      });
    const title = image.input_status === 'FAILED' ? 'Photo could not be prepared' : image.terminal
    ? 'Checks ended' : image.input_status === 'PROCESSING' ? 'Preparing photo' : count ? 'Partial results available' : 'Checks in progress';
    return `<div data-reveal class="inspection-image${pending ? ' is-scanning' : ''}">${thumbnail(image, 'inspection-thumb')}
      <div class="photo-meta"><span><strong>${e(image.original_filename || 'Fruit photo')}</strong><small>${e(title)}</small></span>
      ${badge(image.terminal ? 'Ended' : 'In progress', image.terminal ? 'neutral' : 'active')}</div></div>
      ${image.input_error ? callout(typeof image.input_error === 'string' ? image.input_error : image.input_error.message ?? 'The photo could not be prepared.') : ''}
      <div class="check-summaries">${MODELS.map(model => checkSummary(model, image.jobs?.[model.key])).join('')}</div>
      <div class="agreement" data-reveal><span class="tile-icon mini green">${icon(count > 1 ? 'layers' : 'activity', 17)}</span><p>${e(agreement(image))}</p></div>
      <div class="check-actions" data-reveal><button type="button" class="text-button" data-page="collections">${icon('folder', 16)} Your Collections</button>${pending ? `<button type="button" class="text-button cancellation" data-action="cancel-image" data-focus="cancel-image">${icon('close', 15)} Cancel checks</button>` : ''}</div>`;
  }

  // Render results from the current application state.
  function renderResults() {
    const image = store.cache.get(store.selectedId);
    const count = image ? MODELS.filter(({ key }) => image.jobs?.[key]?.status === 'COMPLETED' && image.jobs[key].result).length : 0;
    preserveFocus($('inspection-panel'), `<header class="panel-header" data-reveal><span class="tile-icon green">${icon('activity', 19)}</span>
      <div><h2>Current check</h2><p>${image ? `${count} of 3 results ready` : 'Fruit, quality & confidence'}</p></div></header>
      ${store.streamStatus ? callout(store.streamStatus, 'neutral') : ''}
      ${actions.previewImage(image)}`);
    const state = image ? `${image.original_filename || 'Fruit photo'}: ${count} of 3 model results available.${image.terminal ? ' Checks ended.' : ''}` : '';
    if (state !== store.lastLiveAnnouncement) {
      store.lastLiveAnnouncement = state;
      $('scan-announcement').textContent = state;
    }
  }

  Object.assign(actions, { previewImage, renderResults });
}
