// Deduplicate operator reads and load current host and queue snapshots.
import { array } from './format.js';
import { retryDelay } from './resources.js';

// Connect reads behavior to shared state and actions.
export function installReads(context) {
  const { service, state: store, actions } = context;

  // Share an in-flight resource read and ignore obsolete responses.
  function read(target, load, { apply, fail, active = () => true, latest = false } = {}) {
    if (store.disposed || target.retryAt > Date.now()) return Promise.resolve();
    if (target.inFlight) {
      if (latest && !target.trailingRead) {
        target.trailingRead = true;
        void target.inFlight.then(() => {
            target.trailingRead = false;
            if (active()) read(target, load, { apply, fail, active });
          });
      }
      return target.inFlight;
    }
    target.loading = true;
    actions.scheduleRender();
    target.inFlight = Promise.resolve().then(load).then((value) => {
        if (store.disposed || !active()) return;
        target.error = null;
        target.retryAt = 0;
        if (apply) apply(value);
        else target.data = value;
      }).catch((error) => {
        if (store.disposed || !active()) return;
        target.error = error;
        target.retryAt = Date.now() + retryDelay(error);
        fail?.(error);
      }).finally(() => {
        target.loading = false;
        target.inFlight = null;
        actions.scheduleRender();
      });
    return target.inFlight;
  }

  // Refresh host from the current service snapshots.
  function refreshHost() {
    store.lastHostRead = Date.now();
    return actions.read(store.host, () => service.connection(), {
        apply: (value) => { store.host.data = value; },
        fail: () => {
          if (!store.host.data) return;
          const { pair_code, connect_url, ...stale } = store.host.data;
          store.host.data = stale;
        },
      });
  }

  // Refresh telemetry from the current service snapshots.
  function refreshTelemetry() {
    actions.read(store.queues, () => service.queues(), { apply: (value) => { store.queues.data = value; store.updated = new Date(); } });
    if (store.tab !== 'overview') return;
    actions.read(store.readiness, () => service.readiness());
    actions.read(store.health, () => service.health());
  }

  // Refresh batches from the current service snapshots.
  function refreshBatches() {
    store.lastRequestList = Date.now();
    const target = store.batches;
    actions.read(target, () => service.batches(), {
        active: () => target === store.batches,
        apply: (data) => {
          target.data = array(data);
          if (!actions.allowedRequest()) return;
          if (!store.request && !store.cleared && target.data[0]?.batch_id) actions.chooseBatch(target.data[0].batch_id);
        },
      });
  }

  Object.assign(actions, { read, refreshHost, refreshTelemetry, refreshBatches });
}
