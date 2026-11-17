// Render shared operator controls, status notices, and metric fields.
import { STATUS_LABELS, TAB_ICONS, html, number, display, words, upper, errorText } from './format.js';
import { icon } from '../ui.js';

const ACTION_ICONS = { refresh: 'refresh', copy: 'copy', retry: 'refresh', export: 'download', 'cancel-image': 'close', 'cancel-batch': 'close', 'delete-batch': 'trash', 'delete-collections': 'trash', reset: 'refresh', 'queue-photo': 'eye' };
const ICON_ACTIONS = new Set(['refresh', 'copy', 'retry', 'cancel-image', 'cancel-batch', 'delete-batch', 'page']);

// Render a labeled status badge with its matching visual tone.
export function badge(value, label) {
  const status = upper(value);
  let tone = 'neutral';
  if (['READY', 'OK', 'HEALTHY', 'UP', 'COMPLETED', 'CONNECTED', 'GOOD'].includes(status)) tone = 'good';
  if (['RUNNING', 'ACTIVE', 'PROCESSING', 'QUEUED', 'WAITING_FOR_INPUT', 'STARTING', 'LOADING'].includes(status)) tone = 'work';
  if (['FAILED', 'ERROR', 'UNAVAILABLE', 'OFFLINE', 'DEGRADED', 'BAD'].includes(status)) tone = 'warn';
  return `<span class="fo-badge fo-badge--${tone}"><i aria-hidden="true"></i>${html(label ?? STATUS_LABELS[status] ?? (status ? words(status) : 'Unknown'))}</span>`;
}

// Render an operator action button with optional identity and disabled state.
export function btn(label, action, options = {}) {
  const { id, variant = '', disabled = false, shortLabel = label, iconOnly = ICON_ACTIONS.has(action) } = options;
  const glyph = options.icon ?? (action === 'tab' ? TAB_ICONS[id] : action === 'page' ? Number(id) < 0 ? 'back' : 'chevron' : ACTION_ICONS[action]);
  return `<button type="button" class="fo-btn${variant ? ' fo-btn--' + variant : ''}${glyph && iconOnly ? ' fo-btn--icon' : ''}" data-action="${html(action)}"${id == null ? '' : ` data-id="${html(id)}"`} aria-label="${html(label)}" title="${html(label)}"${disabled ? ' disabled' : ''}>${glyph ? icon(glyph, 17) : ''}<span${glyph && iconOnly ? ' class="sr-only"' : ''}>${html(shortLabel)}</span></button>`;
}

// Render an accessible empty state with an optional next action.
export function empty(title, body, extra = '') {
  return `<div class="fo-empty"><strong>${html(title)}</strong>${body ? `<p>${html(body)}</p>` : ''}${extra}</div>`;
}

// Render a status notice and optional recovery controls.
export function notice(body, tone = '', extra = '') {
  return `<div class="fo-notice${tone ? ' fo-notice--' + tone : ''}"${tone === 'warn' ? ' role="status"' : ''}><span>${html(body)}</span>${extra}</div>`;
}

// Describe a failed resource read while retaining any last available data.
export function stateNotice(resource, label, hasData = resource.data != null) {
  if (!resource.error) return '';
  return notice(
    (hasData ? 'Showing the last available ' + label + '. ' : 'Could not load ' + label + '. ') + errorText(resource.error),
    'warn', btn('Retry', 'refresh', { variant: 'quiet' }),
  );
}

// Render a section title, description, and optional action.
export function sectionHead(title, subtitle, action = '') {
  return `<div class="fo-section-head" data-reveal><div><h2>${html(title)}</h2>${subtitle ? `<p>${html(subtitle)}</p>` : ''}</div>${action}</div>`;
}

// Render labeled values as an accessible definition list.
export function fields(items) {
  return `<dl class="fo-fields">${items.map(([label, value, mono]) => `<div><dt>${html(label)}</dt><dd${mono ? ' class="fo-mono"' : ''}>${html(display(value))}</dd></div>`).join('')}</dl>`;
}

// Render a measured value and its label.
export function metric(label, value) {
  return `<div class="fo-metric"><strong>${html(value)}</strong><span>${html(label)}</span></div>`;
}

// Render bounded progress only when both measured values are available.
export function progress(value, max, label) {
  const current = number(value);
  const total = number(max);
  return current !== null && total > 0
  ? `<progress aria-label="${html(label)}" value="${Math.min(total, Math.max(0, current))}" max="${total}"></progress>` : '';
}
