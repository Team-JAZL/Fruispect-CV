// Switch operator tabs and schedule reads for the visible view.
import { TABS } from './format.js';

// Connect navigation behavior to shared state and actions.
export function installNavigation(context) {
  const { service, state: store, actions } = context;

  // Refresh view from the current service snapshots.
  function refreshView() {
    if (store.tab === 'overview' || store.tab === 'queues') actions.refreshTelemetry();
    if (store.tab === 'requests') {
      {
        actions.refreshBatches();
        actions.refreshRequest(store.request);
        actions.openStream(store.request);
      }
    }
    if (store.tab === 'research') {
      actions.read(store.research, () => service.research());
      actions.read(store.figures, () => service.figures());
    }
    if (store.tab === 'settings') {
      actions.refreshHost();
      actions.read(store.settings, () => service.settings());
    }
  }

  // Switch the active operator tab and release obsolete live subscriptions.
  function chooseTab(next) {
    if (store.tab === next || !TABS.some(([key]) => key === next)) return;
    if (store.tab === 'requests') actions.closeStream();
    store.tab = next;
    actions.refreshView();
    actions.scheduleRender();
  }

  // Read retained events while respecting visibility and retry backoff.
  function poll() {
    if (store.disposed || document.hidden) return;
    if (store.tab === 'overview' || store.tab === 'queues') actions.refreshTelemetry();
    const now = Date.now();
    if (store.tab === 'settings' && now - store.lastHostRead > 4500) {
      actions.refreshHost();
      actions.read(store.settings, () => service.settings());
    }
    if (actions.allowedRequest()) {
      if (now - store.lastRequestList > 10000) actions.refreshBatches();
      if (store.request && ((now - store.lastSnapshot > 10000 || store.request.streamStatus === 'polling'))) {
        store.lastSnapshot = now;
        actions.refreshRequest(store.request);
      }
      actions.openStream(store.request);
    }
  }

  Object.assign(actions, { refreshView, chooseTab, poll });
}
