// Refresh collection snapshots from replayable live events.
// Connect watch behavior to shared state and actions.
export function installWatch(context) {
  const { service, onPairing, state: store, actions } = context;

  // Close the collection watcher and clear pending refresh work.
  function stopWatch() {
    store.watchStop?.();
    store.watchStop = null;
    clearTimeout(store.refreshTimer);
    store.eventImages.clear();
  }

  // Subscribe to replayable collection updates with recovery and removal handling.
  function watchBatch(id, cursor) {
    actions.stopWatch();
    if (!id || !store.ready || store.page === 'operator') return;
    store.watchStop = service.watch(id, {
        cursor: Math.max(store.cursors.get(id) ?? 0, Number(cursor) || 0),
        onEvents: (events, nextCursor) => {
          if (id !== store.batchId) return;
          if (Number.isSafeInteger(nextCursor)) store.cursors.set(id, nextCursor);
          for (const event of Array.isArray(events) ? events : [events]) {
            if (event?.image_id) store.eventImages.add(event.image_id);
          }
          clearTimeout(store.refreshTimer);
          store.refreshTimer = setTimeout(() => {
              const ids = [...store.eventImages];
              store.eventImages.clear();
              if (!ids.length && store.selectedId) actions.refreshImage(store.selectedId);
              else for (const imageId of ids) {
                if (imageId === store.selectedId || store.cache.has(imageId)) actions.refreshImage(imageId);
              }
              if (store.page === 'collections') actions.refreshList({ quiet: true });
              actions.refreshBatchSummary(id);
            }, 250);
        },
        onRemoved: () => actions.forgetCollection(id),
        onStatus: (status, detail) => {
          if (id !== store.batchId) return;
          const code = typeof status === 'string' ? status : status?.status;
          store.streamStatus = {
            connecting: 'Connecting to live updates…',
            reconnecting: 'Reconnecting. Available results are still shown.',
            polling: 'Updating by polling.',
            offline: 'Connection interrupted. Available results are still shown.',
            capacity: 'The host is busy. Updates will resume when capacity is available.',
            unavailable: 'Live updates are temporarily unavailable.',
          }[code] ?? '';
          if (code === 'pairing-required' || detail?.status === 401 || status?.error?.status === 401) {
            onPairing(detail?.message ?? status?.error?.message);
          }
          actions.renderResults();
        },
        onRecover: ({ cursor: nextCursor } = {}) => {
          if (id !== store.batchId) return;
          if (Number.isSafeInteger(nextCursor)) store.cursors.set(id, nextCursor);
          actions.refreshBatchSummary(id);
          if (store.selectedId) actions.refreshImage(store.selectedId);
          if (store.page === 'collections') actions.refreshList({ quiet: true });
        },
      });
  }

  Object.assign(actions, { stopWatch, watchBatch });
}
