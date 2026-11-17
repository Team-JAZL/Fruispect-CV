// Show detailed collection results in an accessible responsive dialog.
import { MODELS } from '../api/contracts.js';
import { icon, escapeHtml as e, formatDate, preserveFocus } from '../ui.js';
import { thumbnail, resultCard, agreement, callout } from './components.js';
import { animatePage, openDialog } from '../motion.js';
import { sourceDetails } from './device.js';

// Connect collection review without changing the scan workspace selection.
export function installReview({ state: store, actions, $, globalScope = false }) {
  const dialog = $('result-dialog');
  let opener = null;

  // Refresh the open review as independent model results arrive.
  function renderReview() {
    if (!store.reviewId) return;
    const scrollTop = dialog.scrollTop;
    const image = store.cache.get(store.reviewId);
    const firstPhoto = image && !$('review-content').querySelector?.('.review-photo');
    preserveFocus($('review-content'), `${store.reviewError ? callout(store.reviewError) + '<button type="button" class="button small" data-action="retry-review" data-focus="retry-review">Try again</button>' : ''}
      ${image ? `<div class="review-photo" data-reveal>${thumbnail(image, 'review-thumb')}<div><h3>${e(image.original_filename || 'Fruit photo')}</h3><p>${e(formatDate(image.received_at))}${image.width && image.height ? ` · ${Number(image.width)} × ${Number(image.height)}` : ''}</p><p>${e(agreement(image))}</p></div></div>
        ${image.input_error ? callout(typeof image.input_error === 'string' ? image.input_error : image.input_error.message ?? 'Photo preparation failed.') : ''}
        ${store.streamStatus ? callout(store.streamStatus, 'neutral') : ''}
        ${globalScope ? sourceDetails(image.upload_source) : ''}
        <div class="model-grid">${MODELS.map(model => resultCard(model, image.jobs?.[model.key], store.reviewId)).join('')}</div>
        <p class="confidence-note">${icon('info', 16)} Confidence is a model score, not a guarantee. Visual quality does not establish food safety.</p>`
      : store.reviewLoading ? '<div class="empty" role="status"><span class="pulse" aria-hidden="true"></span><p>Loading your results…</p></div>' : ''}`);
    dialog.scrollTop = scrollTop;
    if (firstPhoto && dialog.open) animatePage($('review-content'));
  }

  // Close a review and restore focus to its collection photo control.
  function closeReview() {
    if (!store.reviewId && !dialog.open) return;
    const id = store.reviewId;
    store.reviewId = null;
    store.reviewLoading = false;
    store.reviewError = '';
    if (dialog.open) dialog.close();
    const trigger = opener?.isConnected ? opener : [...$('collection-list').querySelectorAll('[data-action="open-image"]')].find(button => button.dataset.id === id);
    trigger?.focus({ preventScroll: true });
    opener = null;
  }

  // Open an authorized photo for review without leaving its collection gallery.
  async function openReview(id, trigger = null) {
    if (!id) return;
    if (!dialog.open) opener = trigger;
    store.reviewId = id;
    store.reviewError = '';
    store.reviewLoading = true;
    actions.renderReview();
    if (!dialog.open) openDialog(dialog);
    await actions.refreshImage(id, true);
    if (store.reviewId !== id) return;
    store.reviewLoading = false;
    actions.renderReview();
  }

  dialog.addEventListener('cancel', event => { event.preventDefault(); actions.closeReview(); });
  dialog.addEventListener('close', () => { if (!dialog.open && store.reviewId) actions.closeReview(); });
  dialog.addEventListener('click', event => {
    if (event.target !== dialog) return;
    const rect = dialog.getBoundingClientRect();
    if (event.clientX < rect.left || event.clientX > rect.right || event.clientY < rect.top || event.clientY > rect.bottom) actions.closeReview();
  });
  Object.assign(actions, { renderReview, closeReview, openReview });
}
