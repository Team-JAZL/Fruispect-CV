// Render photo thumbnails, prediction cards, and agreement summaries.
import { FRUITS, JOB_LABELS, isTerminal } from '../api/contracts.js';
import { icon, escapeHtml as e, photoUrl, formatScore } from '../ui.js';
// Create a stable identifier for an upload admission or collection.
export const makeKey = () => globalThis.crypto?.randomUUID?.() ?? `fruispect-${Date.now()}-${Math.random().toString(36).slice(2)}`;

export const FILES_PER_PAGE = 25;

// Read the immutable image identifier from a snapshot.
export const idOf = image => image?.image_id;

// Map the current model status to a prediction card visual tone.
export const jobTone = status => ({ COMPLETED: 'good', FAILED: 'bad', UNAVAILABLE: 'bad', CANCELLED: 'neutral', RUNNING: 'active', QUEUED: 'warn' })[status] ?? 'neutral';

// Render an escaped select option and its selected state.
export const option = (value, label, selected) => `<option value="${e(value)}"${value === selected ? ' selected' : ''}>${e(label)}</option>`;

// Render a labeled status badge with its matching visual tone.
export const badge = (label, tone = 'neutral') => `<span class="badge ${tone}"><i></i>${e(label)}</span>`;

// Render a visible workflow message with its status tone.
export const callout = (message, tone = 'warn') => `<div class="callout ${tone}" role="status">${icon(tone === 'good' ? 'check' : 'info', 18)}<p>${e(message)}</p></div>`;

// Render a safe photo thumbnail or its missing-image placeholder.
export function thumbnail(image, cls = '') {
  const url = photoUrl(image?.thumbnail_url);
  return `<div class="thumb ${cls}">${url
    ? `<img src="${e(url)}" alt="${e(image.original_filename || 'Fruit photo')}" loading="lazy">`
    : icon('photo', 26)}</div>`;
}

// Render one independent model prediction or its current job state.
export function resultCard(model, job, imageId) {
  const status = job?.status;
  const pending = status && !isTerminal(status);
  const label = job?.cancel_requested && pending ? 'Cancellation requested' : JOB_LABELS[status] ?? 'Awaiting photo';
  const result = status === 'COMPLETED' ? job.result : null;
  return `<article class="model-card ${jobTone(status)}">
    <header class="model-head"><span class="tile-icon ${model.key}">${icon('chip', 18)}</span>
    <h3>${e(model.name)}</h3>${badge(label, jobTone(status))}</header>
    ${result ? `<div class="predictions">
      <div><span>Fruit prediction</span><strong>${e(result.predicted_fruit || 'Not available')}</strong><small>${formatScore(result.fruit_confidence)}${result.fruit_confidence == null ? '' : ' confidence'}</small></div>
      <div><span>Visual quality</span><strong class="${result.predicted_quality === 'Good' ? 'quality-good' : result.predicted_quality === 'Bad' ? 'quality-bad' : ''}">${e(result.predicted_quality || 'Not available')}</strong><small>${formatScore(result.quality_confidence)}${result.quality_confidence == null ? '' : ' confidence'}</small></div>
      </div>
      <details class="probabilities" data-detail="${e(imageId)}-${model.key}">
        <summary data-focus="${e(imageId)}-${model.key}">Class scores</summary>
        ${[['Fruit', result.fruit_probabilities, FRUITS], ['Visual quality', result.quality_probabilities, ['Good','Bad']]].map(([title, values, classes]) => `<div><b>${title}</b><dl>${classes.map(name => `<div><dt>${e(name)}</dt><dd>${formatScore(values?.[name])}</dd></div>`).join('')}</dl></div>`).join('')}
      </details>` : `<div class="pending-result">${pending ? '<span class="pulse" aria-hidden="true"></span>' : icon(status ? 'info' : 'activity', 18)}
      <p>${e(job?.error_message || (job?.cancel_requested && pending ? 'Waiting for this check to end.' : pending ? 'The result will appear when this model finishes.' : status ? 'This model ended without a result.' : 'Add a fruit photo to start this model.'))}</p></div>`}
  </article>`;
}

// Describe agreement among available model predictions without hiding missing results.
export function agreement(image) {
  const value = image?.consensus;
  const count = value?.successful_models;
  if (!image || !value || !Number.isFinite(count)) return 'Agreement will appear as model results arrive.';
  if (count < 2) return 'At least two model results are needed to compare predictions.';
  const disagreements = [
    value.fruit_disagreement ? 'fruit' : '',
    value.quality_disagreement ? 'visual quality' : '',
  ].filter(Boolean);
  const scope = value.scope;
  if (scope === 'complete' && count === 3 && disagreements.length === 0) return 'All three models agree on fruit and visual quality.';
  const label = disagreements.length
  ? `Models disagree on ${disagreements.join(' and ')}.`
  : 'Available models agree on fruit and visual quality.';
  if (scope === 'provisional') return `Provisional. ${label}`;
  if (scope === 'incomplete') return `Incomplete. ${label}`;
  return label;
}
