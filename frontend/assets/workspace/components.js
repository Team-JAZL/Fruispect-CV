// Render photo thumbnails, prediction cards, and agreement summaries.
import { FRUITS, JOB_LABELS, isTerminal } from '../api/contracts.js';
import { icon, escapeHtml as e, photoUrl, formatScore, formatDate } from '../ui.js';
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

// Render a bounded native confidence bar without inventing missing scores.
export function confidenceBar(value, label) {
  const valid = typeof value === 'number' && Number.isFinite(value) && value >= 0 && value <= 1;
  return valid ? `<progress class="confidence-bar" max="1" value="${value}" aria-label="${e(label)}">${formatScore(value)}</progress>` : '';
}

// Render one model's essential predictions directly in the current check.
export function checkSummary(model, job) {
  const result = job?.status === 'COMPLETED' ? job.result : null;
  return `<article class="check-summary" data-reveal><h3><span class="model-dot ${model.key}" aria-hidden="true"></span>${e(model.name)}</h3>
    ${result ? `<div class="summary-predictions">${[
      ['Fruit', result.predicted_fruit, result.fruit_confidence],
      ['Quality', result.predicted_quality, result.quality_confidence],
    ].map(([label, prediction, score]) => `<div><span>${label}</span><strong class="${prediction === 'Good' ? 'quality-good' : prediction === 'Bad' ? 'quality-bad' : ''}">${e(prediction || 'Not available')}</strong><small>${formatScore(score)}</small>${confidenceBar(score, `${model.name} ${label} confidence`)}</div>`).join('')}</div>`
    : `<p class="summary-status">${badge(job?.cancel_requested && !isTerminal(job.status) ? 'Cancellation requested' : JOB_LABELS[job?.status] ?? 'Waiting for photo', jobTone(job?.status))}${job?.error_message ? `<span>${e(job.error_message)}</span>` : ''}</p>`}</article>`;
}

// Render one independent model prediction or its current job state.
export function resultCard(model, job, imageId) {
  const status = job?.status;
  const pending = status && !isTerminal(status);
  const label = job?.cancel_requested && pending ? 'Cancellation requested' : JOB_LABELS[status] ?? 'Awaiting photo';
  const result = status === 'COMPLETED' ? job.result : null;
  return `<article data-reveal class="model-card ${jobTone(status)}">
    <header class="model-head"><span class="tile-icon ${model.key}">${icon('chip', 18)}</span>
    <h3>${e(model.name)}</h3>${badge(label, jobTone(status))}</header>
    ${result ? `<div class="predictions">
      <div><span>Fruit prediction</span><strong>${e(result.predicted_fruit || 'Not available')}</strong><small>${formatScore(result.fruit_confidence)}${result.fruit_confidence == null ? '' : ' confidence'}</small></div>
      <div><span>Visual quality</span><strong class="${result.predicted_quality === 'Good' ? 'quality-good' : result.predicted_quality === 'Bad' ? 'quality-bad' : ''}">${e(result.predicted_quality || 'Not available')}</strong><small>${formatScore(result.quality_confidence)}${result.quality_confidence == null ? '' : ' confidence'}</small></div>
      </div>
      <div class="probabilities">
        ${[['Fruit confidence', result.fruit_probabilities, FRUITS], ['Quality confidence', result.quality_probabilities, ['Good','Bad']]].map(([title, values, classes]) => `<div><h4>${title}</h4><dl>${classes.map(name => `<div class="class-score"><dt>${e(name)}</dt><dd>${formatScore(values?.[name])}</dd>${confidenceBar(values?.[name], `${model.name}: ${name}`)}</div>`).join('')}</dl></div>`).join('')}
      </div>` : `<div class="pending-result">${pending ? '<span class="pulse" aria-hidden="true"></span>' : icon(status ? 'info' : 'activity', 18)}
      <p>${e(job?.error_message || (job?.cancel_requested && pending ? 'Waiting for this check to end.' : pending ? 'The result will appear when this model finishes.' : status ? 'This model ended without a result.' : 'Add a fruit photo to start this model.'))}</p></div>`}
    ${job ? `<details class="model-timing" data-detail="${e(imageId)}-${model.key}-timing"><summary data-focus="${e(imageId)}-${model.key}-timing">Check details</summary><dl>
      <div><dt>Inference</dt><dd>${Number.isFinite(result?.inference_ms) ? `${e(result.inference_ms.toLocaleString(undefined, { maximumFractionDigits: 1 }))} ms` : 'Not available'}</dd></div>
      <div><dt>Queued</dt><dd>${e(formatDate(job.queued_at))}</dd></div><div><dt>Started</dt><dd>${e(formatDate(job.started_at))}</dd></div><div><dt>Finished</dt><dd>${e(formatDate(job.completed_at))}</dd></div>
    </dl></details>` : ''}
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
