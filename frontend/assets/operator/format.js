// Format operator labels, metrics, dates, errors, and safe local URLs.
import { MODELS, JOB_LABELS } from '../api/contracts.js';

export const TABS = [
  ['overview', 'Overview'], ['requests', 'Requests'], ['queues', 'Queues'],
  ['research', 'Research'], ['settings', 'Settings'],
];

export const TAB_ICONS = { overview: 'overview', requests: 'folder', queues: 'queue', research: 'chart', settings: 'tune' };

export const PAGE_SIZE = 20;

export const TIMELINE_SIZE = 60;

export const EMPTY = 'Not available';

export const STATUS_LABELS = {
  READY: 'Ready', LOADING: 'Loading', OFFLINE: 'Offline', UNAVAILABLE: 'Unavailable',
  ACTIVE: 'Active', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled',
  DISABLED: 'Disabled', STARTING: 'Starting', ABSENT: 'Unavailable',
  PROCESSING: 'Preparing photo', DEGRADED: 'Degraded',
};

export const JOB_STATES = Object.keys(JOB_LABELS);

export const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });

export const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });

export const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });

export const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

// Escape user-visible values before inserting HTML markup.
export const html = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
      '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
    })[character]);

// Return an array resource or an empty list for unavailable data.
export const array = (value) => Array.isArray(value) ? value : [];

// Recognize plain record-like values while excluding arrays.
export const record = (value) => value && typeof value === 'object' && !Array.isArray(value);

// Recognize nonempty values without treating measured zero as missing.
export const present = (value) => value != null && (typeof value !== 'string' || value.trim() !== '');

// Parse a finite numeric measurement while preserving missing values.
export const number = (value) => (
  (typeof value === 'number' || typeof value === 'string') && present(value) && Number.isFinite(Number(value))
  ? Number(value) : null
);

// Return a known display value or an explicit unavailable label.
export const display = (value) => present(value) ? value : EMPTY;

// Format a known count while keeping missing totals distinct from zero.
export const count = (value) => number(value) === null ? '—' : nf.format(Number(value));

// Format a measured duration in milliseconds.
export const duration = (value) => number(value) === null ? EMPTY : nf.format(Number(value)) + ' ms';

// Format observed active time in milliseconds, seconds, or minutes.
export const elapsed = (value) => {
  const ms = number(value);
  if (ms === null) return EMPTY;
  if (ms < 1000) return duration(ms);
  if (ms < 60000) return nf.format(ms / 1000) + ' s';
  return Math.floor(ms / 60000) + 'm ' + Math.floor(ms % 60000 / 1000) + 's';
};

// Format a known probability without converting missing values to zero.
export const score = (value) => number(value) === null ? EMPTY : nf.format(Number(value) * 100) + '%';

// Format an ISO or Unix timestamp using the requested detail level.
export const date = (value, compact = false) => {
  if (!present(value)) return EMPTY;
  const timestamp = number(value);
  const parsed = timestamp === null ? new Date(value) : new Date(timestamp * 1000);
  return Number.isNaN(parsed.getTime()) ? EMPTY : (compact ? shortDate : dateFormat).format(parsed);
};

// Convert machine field names into readable labels.
export const words = (value) => String(value ?? '').replace(/[_-]+/g, ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());

// Normalize a status value for consistent label matching.
export const upper = (value) => String(value ?? '').toUpperCase();

// Resolve a stable model key to its display name.
export const modelName = (key) => MODELS.find((model) => model.key === key)?.name ?? key;

// Format a known admission sequence for queue and image labels.
export const seq = (value) => present(value) ? '#' + String(value) : '—';

// Shorten a collection identifier for compact display.
export const shortId = (id) => String(id ?? '').slice(0, 10);

// Read the current API error HTTP status.
export const errorStatus = (error) => Number(error?.status);

// Describe an API failure using the server message when available.
export const errorText = (error) => error?.body?.error?.message ?? error?.message ?? 'The host did not respond.';

// Read a diagnostic message from a structured error or text value.
export const message = (value) => record(value) ? value.message ?? value.error_message ?? value.code : value;

// Resolve a model job state to its user-visible label.
export const jobLabel = (status) => JOB_LABELS[status] ?? STATUS_LABELS[status] ?? (status ? words(status) : 'Status unavailable');

// Allow only same-origin HTTP links to application resources.
export function localURL(value = false) {
  if (typeof value !== 'string' || !value.trim()) return '';

  try {
    const url = new URL(value, location.href);

    return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol)
    ? url.href : '';
  } catch {
    return '';
  }
}

// Allow credential-free HTTP or HTTPS connection links.
export function connectionURL(value) {
  if (!present(value)) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

// Read a retained job count while preserving unavailable lane data.
export const jobCount = (lane, status) => lane?.counts ? lane.counts[status] ?? 0 : null;
