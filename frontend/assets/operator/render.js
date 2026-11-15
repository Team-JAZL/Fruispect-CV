// Refresh operator panels while preserving focus, disclosure, and scroll state.
import { badge } from './components.js';
import { overview, queuesView } from './telemetry.js';
import { imageDetail } from './image.js';
import { batchList, eventTimeline, requestDetails, requestPhotos, requestsView } from './request-view.js';
import { researchView } from './research.js';
import { settingsView } from './settings.js';

// Connect render behavior to shared state and actions.
export function installRender(context) {
  const { state: store, actions, outlet, access, tabs } = context;

  // Replace a panel while preserving its focus, disclosures, and scroll positions.
  function paint(element, markup) {
    if (!element || store.renderedHTML.get(element) === markup) return;
    const active = document.activeElement;
    const preserve = active && element.contains(active);
    const action = preserve ? active.dataset.action : undefined;
    const id = preserve ? active.dataset.id : undefined;
    const name = preserve ? active.name : undefined;
    const open = new Set(Array.from(element.querySelectorAll('details[open][data-disclosure]'), (details) => details.dataset.disclosure));
    const scrollables = '.fo-table-wrap, .fo-selection-list';
    const scroll = Array.from(element.querySelectorAll(scrollables), (wrapper) => [wrapper.scrollLeft, wrapper.scrollTop]);
    element.innerHTML = markup;
    store.renderedHTML.set(element, markup);
    for (const details of element.querySelectorAll('details[data-disclosure]')) details.open = open.has(details.dataset.disclosure);
    element.querySelectorAll(scrollables).forEach((wrapper, index) => {
        [wrapper.scrollLeft, wrapper.scrollTop] = scroll[index] ?? [0, 0];
      });
    if (preserve) {
      const candidates = element.querySelectorAll('[data-action], [data-filter], [data-pair-link], summary, .fo-table-wrap');
      const replacement = Array.from(candidates).find((candidate) => (
          (action && candidate.dataset.action === action && candidate.dataset.id === id)
          || (name && candidate.name === name)
          || (active.hasAttribute('data-pair-link') && candidate.hasAttribute('data-pair-link'))
          || (active.tagName === 'SUMMARY' && candidate.tagName === 'SUMMARY' && candidate.parentElement.dataset.disclosure === active.parentElement?.dataset.disclosure)
          || (active.classList.contains('fo-table-wrap') && candidate.getAttribute('aria-label') === active.getAttribute('aria-label'))
        ));
      replacement?.focus({ preventScroll: true });
      if (replacement instanceof HTMLInputElement && active instanceof HTMLInputElement && replacement.value === active.value && active.selectionStart !== null) {
        replacement.setSelectionRange(active.selectionStart, active.selectionEnd);
      }
    }
  }

  // Render the currently selected operator view.
  function render() {
    const local = actions.canOperate();
    actions.paint(access, (badge(local ? 'READY' : '', local ? 'Local operator' : 'Browser session')));
    for (const button of tabs) {
      if (button.dataset.id === store.tab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    const viewKey = store.tab === 'requests' ? store.tab : store.tab;
    const changed = store.renderedView !== viewKey;
    store.renderedView = viewKey;
    if (store.tab === 'overview') {
      actions.paint(outlet, overview({ queues: store.queues, readiness: store.readiness, health: store.health, connection: local ? store.host.data : null, updated: store.updated }));
    } else if (store.tab === 'queues') {
      actions.paint(outlet, queuesView(store.queues));
    } else if (store.tab === 'research') {
      actions.paint(outlet, researchView(store.research, store.figures));
    } else if (store.tab === 'settings') {
      actions.paint(outlet, settingsView({ settings: store.settings, host: store.host, local, busy: store.busy, cleanupMessage: store.cleanupMessage }));
    } else if ((changed) || store.renderedRequest !== store.request || !store.request || store.cleared) {
      store.renderedRequest = store.request;
      actions.paint(outlet, requestsView(store.request, store.batches, store.busy, store.cleared));
    } else {
      actions.paint(outlet.querySelector('[data-slot="collections"]'), batchList(store.batches, store.request.id));
      actions.paint(outlet.querySelector('[data-slot="photos"]'), requestPhotos(store.request));
      actions.paint(outlet.querySelector('[data-slot="summary"]'), requestDetails(store.request, store.busy));
      actions.paint(outlet.querySelector('[data-slot="image"]'), imageDetail(store.request.image, store.busy));
      actions.paint(outlet.querySelector('[data-slot="timeline"]'), eventTimeline(store.request));
    }
  }

  // Coalesce operator panel updates into a single queued render.
  function scheduleRender() {
    if (store.disposed || store.renderQueued) return;
    store.renderQueued = true;
    queueMicrotask(() => {
        store.renderQueued = false;
        if (!store.disposed) actions.render();
      });
  }

  Object.assign(actions, { paint, render, scheduleRender });
}
