// Create isolated operator resources, selection, and lifecycle state.
import { resource } from './resources.js';

// Create operator state for the current browser session.
export function createOperatorState(connection) {
  return {
    queues: resource(),
    readiness: resource(),
    health: resource(),
    research: resource(),
    figures: resource(),
    host: resource(connection),
    settings: resource(),
    batches: resource(),
    request: null,
    tab: 'overview',
    updated: null,
    busy: '',
    cleanupMessage: '',
    cleared: '',
    disposed: false,
    stopWatch: null,
    pendingSearch: 0,
    lastSnapshot: 0,
    lastHostRead: 0,
    lastRequestList: 0,
    renderQueued: false,
    renderedView: '',
    renderedRequest: null,
    renderedImageId: null,
    downloads: new Map(),
    renderedHTML: new WeakMap()
  };
}
