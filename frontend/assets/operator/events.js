// Bind operator controls, filters, visibility changes, and image fallbacks.
import { resource } from './resources.js';

// Connect events behavior to shared state and actions.
export function installEvents(context) {
  const { root, state: store, actions, tabs } = context;

  // Handle click events for the active view.
  function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    const { action, id } = button.dataset;
    if (action === 'tab') {
      actions.chooseTab(id);
      if (!tabs.includes(button)) tabs.find((item) => item.dataset.id === id)?.focus();
    }

    else if (action === 'refresh') actions.refreshView();
    else if (action === 'batch') actions.chooseBatch(id);
    else if (action === 'photo' && store.request) actions.selectImage(store.request, id);
    else if (action === 'queue-photo') actions.openQueuePhoto(id);
    else if (action === 'copy') actions.copyLink();
    else if (action === 'page' && store.request) {
      store.request.query.page = Math.max(1, store.request.query.page + Number(id));
      store.request.images = resource();
      actions.refreshPhotos(store.request);
    } else if (['retry', 'export', 'cancel-image', 'cancel-batch', 'delete-batch', 'delete-collections', 'reset'].includes(action)) {
      actions.perform(action, id);
    }
  }

  // Move between console tabs using the standard arrow, Home, and End keys.
  function onKeydown(event) {
    const button = event.target.closest('[data-action="tab"]');
    const index = tabs.indexOf(button);
    if (index < 0 || !['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 0 : event.key === 'End' ? tabs.length - 1 : (index + (event.key === 'ArrowRight' ? 1 : -1) + tabs.length) % tabs.length;
    actions.chooseTab(tabs[next].dataset.id);
    tabs[next].focus();
  }

  // Update request filters and debounce search before loading the first page.
  function changeFilter(event) {
    const input = event.target;
    if (!store.request || !input.matches('[data-filter]')) return;
    if (input.name === 'search' && event.type !== 'input') return;
    if (input.name !== 'search' && event.type !== 'change') return;
    const current = store.request;
    current.query[input.name] = input.value;
    current.query.page = 1;
    clearTimeout(store.pendingSearch);
    if (input.name === 'search') {
      store.pendingSearch = setTimeout(() => {
          if (store.request !== current || !actions.allowedRequest()) return;
          current.images = resource();
          actions.refreshPhotos(current);
        }, 220);
    } else {
      current.images = resource();
      actions.refreshPhotos(current);
    }
  }

  // Keep filter submission within the current operator view.
  function preventForm(event) {
    if (event.target.matches('[data-photo-filters]')) event.preventDefault();
  }

  // Handle image error events for the active view.
  function onImageError(event) {
    if (event.target.matches?.('.fo-thumb img')) event.target.hidden = true;
  }

  // Handle visibility events for the active view.
  function onVisibility() {
    if (document.hidden) actions.closeStream();
    else actions.poll();
  }

  Object.assign(actions, { onClick, onKeydown, changeFilter, preventForm, onImageError, onVisibility });
}
