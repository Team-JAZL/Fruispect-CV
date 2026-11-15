// Initialize asynchronous resources and compute retry delays.
import { PAGE_SIZE, number, errorStatus } from './format.js';

// Create an asynchronous resource with explicit loading and error state.
export function resource(data = null) {
  return { data, loading: false, error: null, inFlight: null, retryAt: 0 };
}

// Create an owned collection view with independent reads and replay cursors.
export function createRequest(id, imageId = null) {
  return {
    id, imageId, autoSelect: imageId == null, batch: resource(), images: resource(), image: resource(),
    history: resource(), query: { page: 1, limit: PAGE_SIZE, search: '', sort: 'newest', status: '', fruit: '', quality: '', agreement: '' },
    timelineCursor: 0, streamCursor: 0, events: [], streamStatus: '',
  };
}

// Respect API retry delays or apply bounded capacity backoff.
export function retryDelay(error) {
  if (error?.retryAfterMs != null && number(error.retryAfterMs) !== null) return Number(error.retryAfterMs);
  return [429, 503].includes(errorStatus(error)) ? 5000 : 0;
}
