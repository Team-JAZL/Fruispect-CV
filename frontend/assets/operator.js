import { FRUITS, QUALITIES, MODELS, JOB_LABELS, isTerminal } from './api/contracts.js';

const TABS = [
  ['overview', 'Overview'], ['requests', 'Requests'], ['queues', 'Queues'],
  ['research', 'Research'], ['settings', 'Settings'],
];
const PAGE_SIZE = 20;
const TIMELINE_SIZE = 60;
const EMPTY = 'Not available';
const STATUS_LABELS = {
  READY: 'Ready', LOADING: 'Loading', OFFLINE: 'Offline', UNAVAILABLE: 'Unavailable',
  ACTIVE: 'Active', COMPLETED: 'Completed', FAILED: 'Failed', CANCELLED: 'Cancelled',
  DISABLED: 'Disabled', STARTING: 'Starting', ABSENT: 'Unavailable',
  PROCESSING: 'Preparing photo', DEGRADED: 'Degraded',
};
const JOB_STATES = Object.keys(JOB_LABELS);
const PREVIEW_TABS = {
  'all-requests': 'requests', 'missing-research': 'research',
  'phone-failed': 'settings', 'phone-starting': 'settings', 'phone-disabled': 'settings',
  reset: 'settings', 'cleanup-pending': 'settings',
};
const nf = new Intl.NumberFormat(undefined, { maximumFractionDigits: 2 });
const dateFormat = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'medium' });
const shortDate = new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' });
const clock = new Intl.DateTimeFormat(undefined, { timeStyle: 'medium' });

const html = (value) => String(value ?? '').replace(/[&<>"']/g, (character) => ({
  '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;',
})[character]);
const array = (value) => Array.isArray(value) ? value : [];
const record = (value) => value && typeof value === 'object' && !Array.isArray(value);
const present = (value) => value != null && (typeof value !== 'string' || value.trim() !== '');
const number = (value) => (
  (typeof value === 'number' || typeof value === 'string') && present(value) && Number.isFinite(Number(value))
    ? Number(value) : null
);
const display = (value) => present(value) ? value : EMPTY;
const count = (value) => number(value) === null ? '—' : nf.format(Number(value));
const duration = (value) => number(value) === null ? EMPTY : nf.format(Number(value)) + ' ms';
const elapsed = (value) => {
  const ms = number(value);
  if (ms === null) return EMPTY;
  if (ms < 1000) return duration(ms);
  if (ms < 60000) return nf.format(ms / 1000) + ' s';
  return Math.floor(ms / 60000) + 'm ' + Math.floor(ms % 60000 / 1000) + 's';
};
const score = (value) => number(value) === null ? EMPTY : nf.format(Number(value) * 100) + '%';
const date = (value, compact = false) => {
  if (!present(value)) return EMPTY;
  const timestamp = number(value);
  const parsed = timestamp === null ? new Date(value) : new Date(timestamp * 1000);
  return Number.isNaN(parsed.getTime()) ? EMPTY : (compact ? shortDate : dateFormat).format(parsed);
};
const words = (value) => String(value ?? '').replace(/[_-]+/g, ' ').toLowerCase().replace(/^\w/, (letter) => letter.toUpperCase());
const upper = (value) => String(value ?? '').toUpperCase();
const modelName = (key) => MODELS.find((model) => model.key === key)?.name ?? key;
const seq = (value) => present(value) ? '#' + String(value) : '—';
const shortId = (id) => String(id ?? '').slice(0, 10);
const errorStatus = (error) => Number(error?.status ?? error?.http_status ?? error?.response?.status);
const errorText = (error) => error?.body?.error?.message ?? error?.message ?? 'The host did not respond.';
const message = (value) => record(value) ? value.message ?? value.error_message ?? value.code : value;
const jobLabel = (status) => JOB_LABELS[status] ?? STATUS_LABELS[status] ?? (status ? words(status) : 'Status unavailable');

function localURL(value, preview = false) {
  if (typeof value !== 'string' || !value.trim()) return '';
  if (preview && /^data:image\/(png|jpeg|webp);base64,/i.test(value)) return value;
  try {
    const url = new URL(value, location.href);
    if (preview && url.origin === location.origin && url.protocol === 'blob:') return url.href;
    return url.origin === location.origin && ['http:', 'https:'].includes(url.protocol)
      ? url.href : '';
  } catch {
    return '';
  }
}

function connectionURL(value) {
  if (!present(value)) return '';
  try {
    const url = new URL(value);
    return ['https:', 'http:'].includes(url.protocol) && !url.username && !url.password ? url.href : '';
  } catch {
    return '';
  }
}

function badge(value, label) {
  const status = upper(value);
  let tone = 'neutral';
  if (['READY', 'OK', 'HEALTHY', 'UP', 'COMPLETED', 'CONNECTED', 'GOOD'].includes(status)) tone = 'good';
  if (['RUNNING', 'ACTIVE', 'PROCESSING', 'QUEUED', 'WAITING_FOR_INPUT', 'STARTING', 'LOADING'].includes(status)) tone = 'work';
  if (['FAILED', 'ERROR', 'UNAVAILABLE', 'OFFLINE', 'DEGRADED', 'BAD'].includes(status)) tone = 'warn';
  return `<span class="fo-badge fo-badge--${tone}"><i aria-hidden="true"></i>${html(label ?? STATUS_LABELS[status] ?? (status ? words(status) : 'Unknown'))}</span>`;
}

function btn(label, action, options = {}) {
  const { id, variant = '', disabled = false } = options;
  return `<button type="button" class="fo-btn${variant ? ' fo-btn--' + variant : ''}" data-action="${html(action)}"${id == null ? '' : ` data-id="${html(id)}"`}${disabled ? ' disabled' : ''}>${html(label)}</button>`;
}

function empty(title, body, extra = '') {
  return `<div class="fo-empty"><strong>${html(title)}</strong>${body ? `<p>${html(body)}</p>` : ''}${extra}</div>`;
}

function notice(body, tone = '', extra = '') {
  return `<div class="fo-notice${tone ? ' fo-notice--' + tone : ''}"${tone === 'warn' ? ' role="status"' : ''}><span>${html(body)}</span>${extra}</div>`;
}

function stateNotice(resource, label, hasData = resource.data != null) {
  if (!resource.error) return '';
  return notice(
    (hasData ? 'Showing the last available ' + label + '. ' : 'Could not load ' + label + '. ') + errorText(resource.error),
    'warn', btn('Retry', 'refresh', { variant: 'quiet' }),
  );
}

function sectionHead(title, subtitle, action = '') {
  return `<div class="fo-section-head"><div><h2>${html(title)}</h2>${subtitle ? `<p>${html(subtitle)}</p>` : ''}</div>${action}</div>`;
}

function fields(items) {
  return `<dl class="fo-fields">${items.map(([label, value, mono]) => `<div><dt>${html(label)}</dt><dd${mono ? ' class="fo-mono"' : ''}>${html(display(value))}</dd></div>`).join('')}</dl>`;
}

function metric(label, value) {
  return `<div class="fo-metric"><strong>${html(value)}</strong><span>${html(label)}</span></div>`;
}

function progress(value, max, label) {
  const current = number(value);
  const total = number(max);
  return current !== null && total > 0
    ? `<progress aria-label="${html(label)}" value="${Math.min(total, Math.max(0, current))}" max="${total}"></progress>` : '';
}

function laneFor(envelope, key) {
  const lanes = envelope?.lanes;
  return Array.isArray(lanes) ? lanes.find((lane) => lane.model_key === key) : lanes?.[key];
}

function readinessFor(readiness, key) {
  const models = readiness?.models;
  const value = Array.isArray(models) ? models.find((model) => model.model_key === key) : models?.[key];
  return typeof value === 'string' ? { state: value } : value;
}

function laneCounts(lane) {
  return [
    ['Successful', lane?.counts?.COMPLETED],
    ['Failed', lane?.counts?.FAILED],
    ['Unavailable', lane?.counts?.UNAVAILABLE],
    ['Cancelled', lane?.counts?.CANCELLED],
  ].map(([label, value]) => metric(label, count(lane?.counts ? value ?? 0 : null))).join('');
}

const jobCount = (lane, status) => lane?.counts ? lane.counts[status] ?? 0 : null;

function timings(lane) {
  const throughput = number(lane?.throughput_model_jobs_s);
  return [
    ['Mean inference', duration(lane?.mean_inference_ms)],
    ['P95 inference', duration(lane?.p95_inference_ms)],
    ['Jobs / second', throughput === null ? EMPTY : throughput.toLocaleString(undefined, { maximumFractionDigits: 4 })],
  ].map(([label, value]) => metric(label, value)).join('');
}

function modelHealth(model, lane, readiness) {
  const state = lane?.state ?? readiness?.state ?? readiness?.status;
  const modelError = message(lane?.last_error ?? readiness?.last_error);
  return `<article class="fo-card fo-health-card">
    <div class="fo-card-head"><h3>${html(model.name)}</h3>${badge(state, state ? undefined : 'Unknown')}</div>
    <div class="fo-health-main"><div><span class="fo-caption">Current job</span><strong>${lane ? lane.active ? html(seq(lane.active.admission_seq)) : 'Idle' : '—'}</strong></div>${metric('Waiting jobs', count(lane?.queue_depth))}</div>
    <div class="fo-health-footer"><span>${html(display(lane?.device ?? readiness?.device))}</span><span>Mean inference <b>${html(duration(lane?.mean_inference_ms))}</b></span></div>
    ${modelError ? `<p class="fo-inline-error">${html(modelError)}</p>` : ''}
  </article>`;
}

function jobLink(job) {
  if (!present(job?.admission_seq)) return '—';
  const label = seq(job.admission_seq);
  return job.image_id ? btn(label, 'queue-photo', { id: job.image_id, variant: 'text' }) : html(label);
}

function overview({ queues, readiness, health, connection, preview, updated }) {
  const lanes = MODELS.map(({ key }) => laneFor(queues.data, key));
  const modelReadiness = MODELS.map(({ key }) => readinessFor(readiness.data, key));
  const ready = lanes.map((lane, index) => upper(lane?.state ?? modelReadiness[index]?.state ?? modelReadiness[index]?.status));
  const waiting = lanes.map((lane) => number(lane?.queue_depth));
  const readyCount = ready.every(Boolean) ? ready.filter((state) => state === 'READY').length : null;
  const waitingCount = waiting.every((value) => value !== null) ? waiting.reduce((sum, value) => sum + value, 0) : null;
  const hostReady = readiness.data?.ready;
  const healthStatus = health.data?.status;
  const serviceState = hostReady === true ? 'READY' : hostReady === false ? 'DEGRADED' : '';
  const serviceTitle = hostReady === true ? 'Host ready for scans' : hostReady === false ? 'Host readiness degraded'
    : readiness.loading ? 'Checking host readiness…' : 'Host readiness unavailable';
  const storage = readiness.data?.storage_ready;
  return `<div class="fo-stack">
    <section class="fo-host" aria-label="Host status">
      <div class="fo-host-copy"><div class="fo-host-kicker"><i aria-hidden="true" class="${serviceState === 'READY' ? 'fo-is-ready' : ''}"></i> Host status</div><h2>${serviceTitle}</h2><p>${html(healthStatus ? 'API health: ' + words(healthStatus) : health.error ? 'Health check unavailable' : 'Waiting for host health check')}${readiness.data?.device ? ' · Device: ' + html(readiness.data.device) : ''}</p></div>
      <div class="fo-host-metrics">
        ${metric('Workers ready', readyCount === null ? '—' : readyCount + ' / ' + MODELS.length)}
        ${metric('Waiting jobs', count(waitingCount))}
        ${metric('Storage', storage === true ? 'Ready' : storage === false ? 'Unavailable' : '—')}
      </div>
    </section>
    ${stateNotice(readiness, 'host readiness')}${stateNotice(health, 'API health')}${stateNotice(queues, 'queue telemetry')}
    <section class="fo-section">
      ${sectionHead('Model health', 'Worker readiness and current work across three independent model lanes.', btn('View queues', 'tab', { id: 'queues' }))}
      <div class="fo-model-grid">${MODELS.map((model, index) => modelHealth(model, lanes[index], modelReadiness[index])).join('')}</div>
    </section>
    <section class="fo-card fo-table-card">
      ${sectionHead('Work on the host', 'Job counts cover retained records. Admission sequence identifies a photo.', updated ? `<span class="fo-update">Updated ${html(clock.format(updated))}</span>` : '')}
      <div class="fo-table-wrap" role="region" aria-label="Model work summary" tabindex="0"><table class="fo-table"><thead><tr><th scope="col">Model</th><th scope="col">Active job</th><th scope="col">Up next</th><th scope="col">Successful</th><th scope="col">Failed</th><th scope="col">Unavailable</th><th scope="col">Cancelled</th><th scope="col">P95 inference</th></tr></thead>
      <tbody>${MODELS.map((model, index) => {
        const lane = lanes[index];
        const next = array(lane?.up_next)[0];
        return `<tr><th scope="row">${html(model.name)}</th><td>${lane?.active ? jobLink(lane.active) : lane ? 'Idle' : '—'}</td><td>${next ? jobLink(next) : '—'}</td><td>${count(jobCount(lane, 'COMPLETED'))}</td><td>${count(jobCount(lane, 'FAILED'))}</td><td>${count(jobCount(lane, 'UNAVAILABLE'))}</td><td>${count(jobCount(lane, 'CANCELLED'))}</td><td>${html(duration(lane?.p95_inference_ms))}</td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="fo-card-note">Rolling timing uses up to 100 retained completed jobs per model.</p>
    </section>
    <div class="fo-overview-bottom"><span>${html(preview ? 'Design preview · Sample host telemetry' : connection?.local_operator === true ? 'Direct localhost access' : 'Browser-session access')}</span>${btn('Connection settings', 'tab', { id: 'settings', variant: 'text' })}</div>
  </div>`;
}

function queueLane(model, lane) {
  if (!lane) return `<article class="fo-card fo-lane"><div class="fo-card-head"><h3>${html(model.name)}</h3>${badge(null)}</div>${empty('Lane data unavailable', 'The host has not returned telemetry for this worker.')}</article>`;
  const upcoming = array(lane.up_next).slice(0, 8);
  return `<article class="fo-card fo-lane">
    <div class="fo-card-head"><div><h3>${html(model.name)}</h3><p>${html(display(lane.device))}</p></div>${badge(lane.state)}</div>
    <div class="fo-lane-current"><div><span class="fo-caption">Active job</span><strong>${lane.active ? jobLink(lane.active) : 'Idle'}</strong><span>${lane.active ? html(number(lane.active_duration_ms) === null ? 'Duration unavailable' : elapsed(lane.active_duration_ms) + ' active') : 'No job in progress'}</span></div>${metric('Waiting jobs', count(lane.queue_depth))}</div>
    ${lane.active ? `<p class="fo-lane-start">Started ${html(date(lane.active.started_at))}</p>` : ''}
    <div class="fo-lane-counts">${laneCounts(lane)}</div>
    <div class="fo-lane-timing">${timings(lane)}</div>
    <div class="fo-lane-next"><div class="fo-card-head"><h4>Up next</h4><span class="fo-caption">First ${upcoming.length} of ${count(lane.queue_depth)}</span></div>
      ${upcoming.length ? `<ol>${upcoming.map((job) => `<li>${jobLink(job)}${badge(job.status, jobLabel(job.status))}</li>`).join('')}</ol>` : '<p class="fo-muted">No upcoming jobs reported.</p>'}
    </div>
    ${message(lane.last_error) ? notice(message(lane.last_error), 'warn') : ''}
    <details class="fo-disclosure" data-disclosure="lane-${html(model.key)}"><summary>Worker metadata</summary>
      ${fields([['Validated', date(lane.validated_at)], ['Statistics window', lane.statistics_window], ['Checkpoint SHA-256', lane.checkpoint_sha256, true], ['Preprocessing SHA-256', lane.preprocessing_sha256, true]])}
      ${record(lane.metadata) && Object.keys(lane.metadata).length ? `<pre>${html(JSON.stringify(lane.metadata, null, 2))}</pre>` : ''}
    </details>
  </article>`;
}

function queuesView(queues) {
  return `<div class="fo-stack">
    ${sectionHead('Model queues', 'Each worker takes jobs from its own first-in, first-out lane.', btn('Refresh queues', 'refresh'))}
    ${stateNotice(queues, 'queue telemetry')}
    ${queues.loading && !queues.data ? empty('Reading queue telemetry…') : ''}
    <div class="fo-model-grid">${MODELS.map((model) => queueLane(model, laneFor(queues.data, model.key))).join('')}</div>
    ${notice('Counts reflect retained model jobs. Timing uses up to 100 retained completed jobs per model. Jobs per second includes idle time.')}
  </div>`;
}

function batchSummary(batch) {
  const summary = batch?.summary ?? {};
  return `<div class="fo-batch-progress"><div><strong>${count(summary.fully_complete)} / ${count(summary.accepted)}</strong><span>photos with all checks ended</span></div>${progress(summary.fully_complete, summary.accepted, 'Photos with all checks ended')}</div>`;
}

function batchList(resource, chosen) {
  const batches = array(resource.data);
  return `${stateNotice(resource, 'collections')}${batches.length ? `<ul class="fo-selection-list">${batches.map((batch) => `<li><button type="button" data-action="batch" data-id="${html(batch.batch_id)}" aria-pressed="${batch.batch_id === chosen}">
    <span class="fo-selection-title"><strong>Collection <span class="fo-mono">${html(shortId(batch.batch_id))}</span></strong>${badge(batch.status)}</span>
    <span class="fo-selection-meta"><span>${html(date(batch.created_at, true))}</span><span>${count(batch.summary?.accepted)} photos</span></span>
  </button></li>`).join('')}</ul>` : resource.loading ? empty('Loading collections…') : !resource.error ? empty('No collections yet', 'Scans from this browser will appear here.') : ''}`;
}

function allRequestsView(resource, preview) {
  const data = resource.data;
  const rows = Array.isArray(data) ? data : array(data?.requests ?? data?.batches);
  const available = preview && (Array.isArray(data) || data?.available === true || rows.length > 0);
  return `<section class="fo-card fo-all">
    ${sectionHead('All requests', 'Collections across browser sessions.', badge(available ? 'ACTIVE' : '', available ? 'Design preview' : 'Backend integration needed'))}
    ${stateNotice(resource, 'all requests')}
    ${resource.loading && !data ? empty('Checking availability…') : available
      ? rows.length ? `<div class="fo-table-wrap" role="region" aria-label="Preview requests" tabindex="0"><table class="fo-table"><thead><tr><th scope="col">Collection ID</th><th scope="col">Received</th><th scope="col">Photos</th><th scope="col">Status</th></tr></thead><tbody>${rows.map((row) => `<tr><th scope="row" class="fo-mono">${html(display(row.batch_id ?? row.id))}</th><td>${html(date(row.created_at, true))}</td><td>${count(row.summary?.accepted ?? row.photos)}</td><td>${badge(row.status)}</td></tr>`).join('')}</tbody></table></div>` : empty('No sample collections')
      : empty('Cross-browser requests are unavailable', message(data?.reason ?? data?.message) ?? 'The backend needs a protected cross-browser requests API. You can inspect collections owned by this browser under This browser.', btn('Go to this browser', 'scope', { id: 'owned' }))}
  </section>`;
}

function imageThumb(image, large = false, preview = false) {
  const url = localURL(image?.thumbnail_url, preview);
  return `<span class="fo-thumb${large ? ' fo-thumb--large' : ''}"><span aria-hidden="true">PHOTO</span>${url ? `<img src="${html(url)}" alt="${large ? 'Thumbnail of ' + html(image.original_filename ?? 'accepted photo') : ''}" loading="${large ? 'eager' : 'lazy'}" decoding="async">` : ''}</span>`;
}

function consensusText(consensus) {
  if (!consensus) return '';
  const successes = number(consensus.successful_models);
  if (successes === null) return '';
  if (successes < 2) return 'Insufficient results for comparison';
  const disagreement = [
    consensus.fruit_disagreement === true ? 'Fruit' : '',
    consensus.quality_disagreement === true ? 'Quality' : '',
  ].filter(Boolean);
  const compared = disagreement.length ? disagreement.join(' and ').replace(' and Quality', ' and quality') + ' disagreement'
    : consensus.scope === 'complete' && successes === MODELS.length && consensus.fruit_disagreement === false && consensus.quality_disagreement === false
      ? 'All models agree' : consensus.fruit_disagreement === false && consensus.quality_disagreement === false
        ? 'Available results agree' : 'Model comparison unavailable';
  if (consensus.scope === 'provisional') return compared + ' · provisional';
  if (consensus.scope === 'incomplete') return compared + ' · incomplete';
  return compared;
}

function probabilityList(title, probabilities) {
  if (!record(probabilities) || !Object.keys(probabilities).length) return `<div><h4>${title}</h4><p class="fo-muted">${EMPTY}</p></div>`;
  return `<div><h4>${title}</h4><ul class="fo-probabilities">${Object.entries(probabilities).map(([label, value]) => `<li><span>${html(label)}</span>${progress(value, 1, label + ' probability')}<strong>${html(score(value))}</strong></li>`).join('')}</ul></div>`;
}

function jobDetail(model, job) {
  const result = job?.result;
  const timingItems = [
    ['Queue wait', duration(result?.queue_wait_ms ?? job?.queue_wait_ms)],
    ['Preprocessing', duration(result?.preprocess_ms)],
    ['Inference', duration(result?.inference_ms ?? job?.inference_ms)],
    ['End-to-end', duration(result?.end_to_end_ms)],
  ];
  return `<article class="fo-job">
    <div class="fo-card-head"><h3>${html(model.name)}</h3>${badge(job?.status, jobLabel(job?.status))}</div>
    ${job?.cancel_requested === true && !isTerminal(job.status) ? '<p class="fo-cancel">Cancellation requested</p>' : ''}
    ${result ? `<div class="fo-predictions"><div><span class="fo-caption">Fruit</span><strong>${html(display(result.predicted_fruit))}</strong><span>${html(score(result.fruit_confidence))}</span></div><div><span class="fo-caption">Visual quality</span><strong>${html(display(result.predicted_quality))}</strong><span>${html(score(result.quality_confidence))}</span></div></div>` : '<p class="fo-muted fo-job-empty">No prediction available.</p>'}
    ${job?.error_code || job?.error_message ? notice([job.error_code, job.error_message].filter(Boolean).join(' · '), 'warn') : ''}
    <details class="fo-disclosure" data-disclosure="job-${html(model.key)}"><summary>Job details${result ? ' and probabilities' : ''}</summary>
      ${result ? `<div class="fo-probability-grid">${probabilityList('Fruit probabilities', result.fruit_probabilities)}${probabilityList('Quality probabilities', result.quality_probabilities)}</div>` : ''}
      ${fields([
        ['Job ID', job?.job_id, true], ['Admission sequence', present(job?.admission_seq) ? seq(job.admission_seq) : null],
        ['Job state', job?.status], ['Job version', job?.version],
        ['Attempts', job?.attempt_count], ['Cancellation requested', job?.cancel_requested === true ? 'Yes' : job?.cancel_requested === false ? 'No' : null],
        ['Queued', date(job?.queued_at)], ['Started', date(job?.started_at)], ['Completed', date(job?.completed_at)],
        ['Available', date(job?.available_at)], ...timingItems,
        ['Architecture', result?.architecture], ['Device', result?.device],
        ['Python', result?.framework_versions?.python], ['PyTorch', result?.framework_versions?.torch], ['Torchvision', result?.framework_versions?.torchvision],
        ['Seed', result?.seed], ['Best epoch', result?.best_epoch], ['Parameters', result?.parameters], ['State dictionary tensors', result?.state_dict_tensors],
        ['Checkpoint SHA-256', result?.checkpoint_sha256 ?? job?.model_checkpoint_sha256, true],
        ['Preprocessing SHA-256', result?.preprocessing_sha256, true],
      ])}
      ${result?.smoke_shapes ? `<pre>${html(JSON.stringify(result.smoke_shapes, null, 2))}</pre>` : ''}
      <p class="fo-card-note">Timing measurements can overlap.</p>
    </details>
  </article>`;
}

function imageDetail(resource, busy, preview) {
  const image = resource.data;
  if (!image) return `${stateNotice(resource, 'photo details')}${resource.loading ? empty('Loading photo details…') : !resource.error ? empty('Select a photo', 'Choose an accepted photo to inspect its model jobs.') : ''}`;
  const jobs = MODELS.map(({ key }) => image.jobs?.[key]);
  const ended = jobs.filter((job) => job && isTerminal(job.status)).length;
  const successful = jobs.filter((job) => job?.status === 'COMPLETED' && job.result).length;
  const comparison = consensusText(image.consensus);
  const dimensions = number(image.width) !== null && number(image.height) !== null ? count(image.width) + ' × ' + count(image.height) + ' px' : EMPTY;
  return `<div class="fo-image-detail">
    ${stateNotice(resource, 'photo details')}
    <header class="fo-image-header">
      ${imageThumb(image, true, preview)}
      <div class="fo-image-title"><span class="fo-caption">Admission ${html(seq(image.admission_seq))}</span><h3>${html(image.original_filename ?? 'Accepted photo')}</h3><p>${html(dimensions)} · ${html(date(image.received_at, true))}</p>${badge(image.input_status, upper(image.input_status) === 'READY' ? 'Input ready' : undefined)}</div>
    </header>
    ${message(image.input_error) ? notice(message(image.input_error), 'warn') : ''}
    <div class="fo-image-counts">${metric('Successful results', successful + ' / ' + MODELS.length)}${metric('Checks ended', ended + ' / ' + MODELS.length)}</div>
    ${comparison ? `<p class="fo-comparison">${html(comparison)}</p>` : ''}
    ${ended < MODELS.length && image.terminal !== true ? btn('Cancel unfinished checks', 'cancel-image', { disabled: busy, variant: 'quiet' }) : ''}
    <details class="fo-disclosure" data-disclosure="image-input"><summary>Input and retention details</summary>
      ${fields([
        ['Photo ID', image.image_id, true], ['Collection ID', image.batch_id, true], ['Admission sequence', present(image.admission_seq) ? seq(image.admission_seq) : null],
        ['Input state', image.input_status], ['Dimensions', dimensions], ['Received', date(image.received_at)], ['Retention expires', date(image.retention_expires_at)],
        ['Preprocessing', duration(image.preprocess_ms)], ['Content SHA-256', image.content_sha256, true], ['Preprocessing SHA-256', image.preprocessing_sha256, true],
      ])}
    </details>
    <div class="fo-job-list">${MODELS.map((model, index) => jobDetail(model, jobs[index])).join('')}</div>
    <p class="fo-card-note">Confidence is a model score. Quality describes visible appearance.</p>
  </div>`;
}

function eventTimeline(request) {
  const { events, history, streamStatus } = request;
  const streamLabel = { connecting: 'Connecting', reconnecting: 'Reconnecting', live: 'Live updates', polling: 'Polling for updates', unavailable: 'Updates unavailable' }[streamStatus];
  const visibleEvents = request.imageId ? events.filter((event) => !event.image_id || event.image_id === request.imageId) : events;
  return `<section class="fo-card fo-timeline">
    ${sectionHead('Event timeline', request.imageId ? 'Recent events for this photo and its collection.' : 'Recent events for this collection.', streamLabel ? badge(streamStatus === 'live' ? 'READY' : '', streamLabel) : '')}
    ${stateNotice(history, 'event history', events.length > 0)}
    ${request.streamError ? notice(errorText(request.streamError), 'warn') : ''}
    ${visibleEvents.length ? `<ol>${visibleEvents.slice(-18).reverse().map((event) => `<li><div><strong>${html(words(event.event_type) || 'Update')}</strong>${event.model_key ? `<span>${html(modelName(event.model_key))}</span>` : ''}${event.payload?.status ? badge(event.payload.status, jobLabel(event.payload.status)) : ''}</div><time>${html(date(event.created_at, true))}</time></li>`).join('')}</ol>` : !history.error ? empty(history.loading ? 'Reading event history…' : 'No recent events for this selection') : ''}
  </section>`;
}

function requestDetails(request, busy) {
  const batch = request.batch.data;
  if (!batch) return stateNotice(request.batch, 'collection') + (request.batch.loading ? empty('Opening collection…') : '');
  const summary = batch.summary ?? {};
  const canCancel = batch.status === 'ACTIVE' && ((number(summary.accepted) ?? 0) > (number(summary.fully_complete) ?? 0) || number(summary.accepted) === null);
  return `<section class="fo-card fo-request-summary">
    ${stateNotice(request.batch, 'collection')}
    <div class="fo-card-head"><div><h2>Collection detail</h2><p class="fo-mono">${html(display(batch.batch_id))}</p></div>${badge(batch.status)}</div>
    ${batchSummary(batch)}
    <div class="fo-summary-metrics">${metric('Accepted photos', count(summary.accepted))}${metric('Rejected submissions', count(summary.rejected))}${metric('Queued model jobs', count(summary.queued))}${metric('Running model jobs', count(summary.running))}</div>
    <details class="fo-disclosure" data-disclosure="batch-summary"><summary>Collection counts and timestamps</summary>
      ${fields([
        ['Created', date(batch.created_at)], ['Cancelled', date(batch.cancelled_at)], ['Total submissions', summary.total_submitted],
        ['Photos preparing', summary.preprocessing], ['Photos with partial results', summary.partial], ['Photos with a failed or unavailable check', summary.failed], ['Photos with a cancelled check', summary.cancelled],
      ])}
      <p class="fo-card-note">A photo can appear in more than one count.</p>
    </details>
    <div class="fo-actions">
      ${btn('Export CSV', 'export', { id: 'csv', disabled: busy })}${btn('Export JSON', 'export', { id: 'json', disabled: busy })}
      ${canCancel ? btn('Cancel collection', 'cancel-batch', { disabled: busy }) : ''}
      ${btn('Delete collection', 'delete-batch', { disabled: busy, variant: 'danger' })}
    </div>
  </section>`;
}

function requestPhotos(request, preview) {
  const resource = request.images;
  const rows = array(resource.data?.images);
  const total = number(resource.data?.total);
  const pages = total === null ? null : Math.max(1, Math.ceil(total / (number(resource.data?.limit) || PAGE_SIZE)));
  return `${stateNotice(resource, 'photos')}${rows.length ? `<ul class="fo-selection-list fo-photo-list">${rows.map((image) => `<li><button type="button" data-action="photo" data-id="${html(image.image_id)}" aria-pressed="${image.image_id === request.imageId}">
    ${imageThumb(image, false, preview)}<span><strong>${html(image.original_filename ?? 'Accepted photo')}</strong><small>${html(seq(image.admission_seq))} · ${image.terminal ? 'Checks ended' : html(STATUS_LABELS[upper(image.input_status)] ?? 'In progress')}</small></span>
  </button></li>`).join('')}</ul>` : resource.loading ? empty('Loading photos…') : !resource.error ? empty('No matching photos', 'Accepted photos matching these filters will appear here.') : ''}
  ${pages !== null && (pages > 1 || request.query.page > 1) ? `<div class="fo-pagination">${btn('Previous', 'page', { id: -1, disabled: request.query.page <= 1 })}<span>Page ${request.query.page} of ${pages}</span>${btn('Next', 'page', { id: 1, disabled: request.query.page >= pages })}</div>` : ''}`;
}

function selectFilter(label, name, values, current) {
  return `<label><span>${html(label)}</span><select name="${html(name)}" data-filter>${values.map(([value, title]) => `<option value="${html(value)}"${current === value ? ' selected' : ''}>${html(title)}</option>`).join('')}</select></label>`;
}

function photoFilters(query) {
  return `<form class="fo-filters" data-photo-filters>
    <div class="fo-filter-main"><label><span>Filename</span><input type="search" name="search" placeholder="Search filename" value="${html(query.search)}" data-filter></label>${selectFilter('Sort', 'sort', [['newest', 'Newest first'], ['oldest', 'Oldest first']], query.sort)}</div>
    <details class="fo-disclosure" data-disclosure="photo-filters"><summary>Filters</summary><div class="fo-filter-options">
      ${selectFilter('Status', 'status', [['', 'Any status'], ['TERMINAL', 'All checks ended'], ...JOB_STATES.map((value) => [value, value === 'COMPLETED' ? 'Any successful check' : jobLabel(value)])], query.status)}
      ${selectFilter('Fruit', 'fruit', [['', 'Any fruit'], ...FRUITS.map((value) => [value, value])], query.fruit)}
      ${selectFilter('Quality', 'quality', [['', 'Any quality'], ...QUALITIES.map((value) => [value, value])], query.quality)}
      ${selectFilter('Comparison', 'agreement', [['', 'Any comparison'], ['agreement', 'Agreement'], ['disagreement', 'Disagreement']], query.agreement)}
    </div></details>
  </form>`;
}

function requestsView(scope, request, batches, all, preview, busy, cleared) {
  const scopeNav = `<nav class="fo-scope" aria-label="Request scope">${[['owned', 'This browser'], ['all', 'All requests']].map(([id, label]) => `<button type="button" data-action="scope" data-id="${id}" aria-pressed="${scope === id}">${label}</button>`).join('')}</nav>`;
  const intro = sectionHead('Requests', 'A collection groups accepted photos. Each photo creates three model jobs.', scopeNav);
  if (scope === 'all') return intro + allRequestsView(all, preview);
  return `${intro}${cleared ? notice(cleared) : ''}
    <div class="fo-requests-grid">
      <aside class="fo-requests-aside">
        <section class="fo-card fo-collection-list">
          ${sectionHead('Collections', 'Owned by this browser session.')}
          <div data-slot="collections">${batchList(batches, request?.id)}</div>
        </section>
        ${request ? `<section class="fo-card fo-photos">
          ${sectionHead('Photos', 'Search and filter accepted inputs.')}
          <div data-slot="filters">${photoFilters(request.query)}</div>
          <div data-slot="photos">${requestPhotos(request, preview)}</div>
        </section>` : ''}
      </aside>
      <div class="fo-request-main">
        ${request ? `<div data-slot="summary">${requestDetails(request, busy)}</div>
          <section class="fo-card fo-photo-panel" aria-label="Photo details"><div data-slot="image">${imageDetail(request.image, busy, preview)}</div></section>
          <div data-slot="timeline">${eventTimeline(request)}</div>`
          : `<section class="fo-card">${empty('No collection selected', 'Select a collection to see its progress, photos, and model results.')}</section>`}
      </div>
    </div>`;
}

function researchLabel(key) {
  if (key === 'model_key') return 'Model';
  const label = words(String(key).replace(/([a-z])([A-Z])/g, '$1 $2'));
  return label.replace(/\bf1\b/gi, 'F1').replace(/\bcpu\b/gi, 'CPU').replace(/\bgpu\b/gi, 'GPU');
}

function researchValue(key, value) {
  if (key === 'model_key' && present(value)) return modelName(value);
  const numeric = number(value);
  if (numeric === null) {
    if (typeof value === 'boolean') return value ? 'Yes' : 'No';
    return display(value);
  }
  if (/(percent|pct)(_|$)/i.test(key)) return nf.format(numeric) + '%';
  if (/accuracy|acc$|precision|recall|f1/i.test(key) && numeric >= 0 && numeric <= 1) return score(numeric);
  if (/(^|_)ms$/i.test(key)) return duration(numeric);
  if (/(^|_)mb$/i.test(key)) return nf.format(numeric) + ' MB';
  return nf.format(numeric);
}

function researchData(value) {
  if (Array.isArray(value)) {
    if (!value.length) return '<p class="fo-muted">No saved data available.</p>';
    if (value.every((row) => record(row) && Object.values(row).every((item) => !record(item) && !Array.isArray(item)))) {
      const columns = [...new Set(value.flatMap((row) => Object.keys(row)))];
      if (!columns.length) return '<p class="fo-muted">No saved data available.</p>';
      return `<div class="fo-table-wrap" role="region" aria-label="Saved research data" tabindex="0"><table class="fo-table"><thead><tr>${columns.map((key) => `<th scope="col">${html(researchLabel(key))}</th>`).join('')}</tr></thead><tbody>${value.map((row) => `<tr>${columns.map((key) => `<td>${html(researchValue(key, row[key]))}</td>`).join('')}</tr>`).join('')}</tbody></table></div>`;
    }
    return `<ul class="fo-research-values">${value.map((row) => `<li>${researchData(row)}</li>`).join('')}</ul>`;
  }
  if (!record(value)) return `<p>${html(display(value))}</p>`;
  const entries = Object.entries(value);
  if (!entries.length) return '<p class="fo-muted">No saved data available.</p>';
  const leaf = entries.filter(([, item]) => !record(item) && !Array.isArray(item));
  const nested = entries.filter(([, item]) => record(item) || Array.isArray(item));
  return `${leaf.length ? fields(leaf.map(([key, item]) => [researchLabel(key), researchValue(key, item)])) : ''}${nested.map(([key, item]) => `<div class="fo-research-group"><h4>${html(modelName(key) === key ? researchLabel(key) : modelName(key))}</h4>${researchData(item)}</div>`).join('')}`;
}

function researchRow(models, key) {
  const name = modelName(key);
  return Array.isArray(models)
    ? models.find((model) => (model?.model_key ?? model?.key) === key || model?.model === name)
    : models?.[key];
}

function researchModel(model, data) {
  if (!data) return `<article class="fo-card fo-research-model"><h3>${html(model.name)}</h3>${empty('No saved evaluation for this model')}</article>`;
  const primary = data.held_out_test ?? data.held_out ?? data.test ?? data.test_metrics ?? data.metrics ?? data;
  const values = [
    ['Fruit accuracy', primary.fruit_accuracy ?? primary.fruit_acc ?? primary.fruit?.accuracy],
    ['Quality accuracy', primary.quality_accuracy ?? primary.quality_acc ?? primary.quality?.accuracy],
    ['Joint accuracy', primary.joint_accuracy ?? primary.joint_acc ?? primary.joint?.accuracy],
  ];
  return `<article class="fo-card fo-research-model"><h3>${html(model.name)}</h3>
    <div class="fo-research-metrics">${values.map(([label, value]) => metric(label, researchValue('accuracy', value))).join('')}</div>
    <details class="fo-disclosure" data-disclosure="research-${html(model.key)}"><summary>Saved metrics and model metadata</summary>${researchData(data)}</details>
  </article>`;
}

function unavailableResearch(value) {
  if (!value || (Array.isArray(value) && !value.length) || (record(value) && !Object.keys(value).length)) return '';
  if (value === true) return notice('Some saved research data is unavailable.', 'warn');
  return `<div class="fo-research-unavailable">${notice('Some saved research data is unavailable.', 'warn')}${researchData(value)}</div>`;
}

function researchFigures(resource, preview) {
  const data = resource.data;
  const figures = Array.isArray(data?.figures) ? data.figures : Object.values(data?.figures ?? {});
  return `<section class="fo-section">
    ${sectionHead('Saved Research Artifact', 'Open available PNG or PDF files from the host.')}
    ${stateNotice(resource, 'research figures')}${unavailableResearch(data?.unavailable)}
    ${figures.length ? `<div class="fo-model-grid">${figures.map((figure) => {
      const png = localURL(figure.png_url ?? figure.png?.url ?? figure.png, preview);
      const pdf = localURL(figure.pdf_url ?? figure.pdf?.url ?? figure.pdf, preview);
      const title = figure.title ?? 'Research figure';
      return `<article class="fo-card fo-figure">${png ? `<a class="fo-figure-image" href="${html(png)}" ${png.startsWith('data:') ? 'download="fruispect-figure.png"' : 'target="_blank" rel="noopener noreferrer"'}><img src="${html(png)}" alt="${html(title)}" loading="lazy" decoding="async"></a>` : '<div class="fo-figure-image fo-muted">PNG preview unavailable</div>'}
        <div class="fo-figure-copy"><h3>${html(title)}</h3>${figure.note ? `<p>${html(figure.note)}</p>` : ''}
        ${typeof figure.provenance === 'string' ? `<p class="fo-caption">${html(figure.provenance)}</p>` : ''}
        <div class="fo-actions">${[[png, 'PNG'], [pdf, 'PDF']].map(([url, type]) => url ? `<a class="fo-btn" href="${html(url)}" ${url.startsWith('data:') ? 'download="fruispect-figure.png"' : 'target="_blank" rel="noopener noreferrer"'}>${url.startsWith('data:') ? 'Download' : 'Open'} ${type}</a>` : `<span class="fo-caption">${type} unavailable</span>`).join('')}</div></div></article>`;
    }).join('')}</div>` : !resource.error ? empty(resource.loading ? 'Loading saved figures…' : 'No research figures available') : ''}
  </section>`;
}

function researchView(summary, figures, preview) {
  const data = summary.data;
  return `<div class="fo-stack">
    ${sectionHead('Research', 'Saved evaluation results and experiment artifacts.', btn('Refresh research', 'refresh'))}
    ${stateNotice(summary, 'research summary')}
    ${summary.loading && !data ? empty('Loading saved research…') : ''}
    ${data ? `<section class="fo-section">${sectionHead('Held-out Test', 'Metrics from the saved test set. Uploaded photos are unlabeled.')}
      <div class="fo-model-grid">${MODELS.map((model) => researchModel(model, researchRow(data.models, model.key))).join('')}</div>
      ${unavailableResearch(data.unavailable)}
    </section>
    <div class="fo-research-pair">
      <section class="fo-card fo-research-section">${sectionHead('Quality by fruit', 'Saved per-fruit visual-quality evaluation.')}${researchData(data.quality_by_fruit)}</section>
      <section class="fo-card fo-research-section">${sectionHead('Controlled Stress Test', 'Saved results under controlled photographic conditions.')}${researchData(data.stress)}</section>
    </div>
    <section class="fo-card fo-research-section">${sectionHead('Saved benchmarks and provenance', 'Saved benchmark timing describes the evaluation run.')}
      ${researchData({ 'Metrics source': data.metrics_source, Provenance: data.provenance, Manifest: data.manifest, 'Training versions': data.training_versions, ...(data.benchmark ? { Benchmark: data.benchmark } : {}) })}
    </section>` : !summary.error && !summary.loading ? empty('No saved evaluation available') : ''}
    ${researchFigures(figures, preview)}
  </div>`;
}

function settingsView({ settings, host, local, preview, busy, cleanupMessage }) {
  const stats = settings.data;
  const value = host.data;
  const status = upper(value?.status);
  const ready = status === 'READY';
  const publicLink = connectionURL(value?.public_url);
  const connectLink = ready && local ? connectionURL(value?.connect_url) : '';
  const pairing = ready && local ? value?.pair_code : null;
  const copy = connectLink || publicLink;
  const canDelete = number(stats?.collections) > 0;
  const busyLabel = {
    retry: 'Requesting retry…', reset: 'Resetting…', 'delete-collections': 'Deleting…',
  }[busy];
  return `<div class="fo-stack">
    ${sectionHead('Settings', 'Manage phone access and retained scan data.', btn('Refresh settings', 'refresh'))}
    ${cleanupMessage ? notice(cleanupMessage, 'good') : ''}
    ${stateNotice(host, 'connection status')}${stateNotice(settings, 'data totals')}
    <section class="fo-card fo-settings-card">
      ${sectionHead('Phone connection', value?.message ?? 'Phone access uses the host’s optional HTTPS link.', badge(status))}
      ${host.loading && !value ? '<p class="fo-muted">Checking connection status…</p>' : ''}
      ${value?.error_code ? notice('Connection code: ' + value.error_code, 'warn') : ''}
      ${publicLink ? `<div class="fo-connection-value"><span class="fo-caption">Public URL</span><a href="${html(publicLink)}" target="_blank" rel="noopener noreferrer">${html(publicLink)}</a></div>` : ''}
      ${present(pairing) ? `<div class="fo-connection-value"><span class="fo-caption">Pairing code</span><code>${html(pairing)}</code></div>` : ''}
      ${connectLink ? `<div class="fo-connection-value"><span class="fo-caption">Automatic pairing link</span><input type="text" readonly aria-label="Automatic pairing link" data-pair-link value="${html(connectLink)}"></div>` : ''}
      <div class="fo-actions">
        ${copy ? btn(connectLink ? 'Copy pairing link' : 'Copy public link', 'copy', { variant: 'primary' }) : ''}
        ${local ? btn(busy === 'retry' ? busyLabel : 'Retry phone connection', 'retry', { disabled: Boolean(busy) || status === 'STARTING' }) : ''}
      </div>
      <p class="fo-card-note">${html(!ready ? 'You can still scan on the host when the phone link is unavailable.' : value?.requires_pairing === true ? 'Phones must pair before accessing protected scans.' : 'The host supplies the current connection status and link.')}</p>
      ${!local ? '<p class="fo-card-note">Pairing credentials and connection retry require direct localhost access.</p>' : ''}
    </section>
    <div class="fo-settings-grid">
      <section class="fo-card fo-settings-card">
        ${sectionHead('This browser', 'Delete collections owned by the current browser session.')}
        <div class="fo-settings-metrics">${metric('Collections', count(stats?.collections))}${metric('Photos', count(stats?.photos))}</div>
        ${btn(busy === 'delete-collections' ? busyLabel : 'Delete browser collections', 'delete-collections', { variant: 'danger', disabled: Boolean(busy) || !canDelete })}
      </section>
      <section class="fo-card fo-settings-card fo-settings-danger">
        ${sectionHead('Global scan reset', 'Clear scan data from every browser. Research, models, and connection configuration are preserved.', badge('', preview && local ? 'Preview capability' : 'Localhost only'))}
        ${local ? `<div class="fo-settings-metrics">${metric('All collections', count(stats?.all_collections))}${metric('All photos', count(stats?.all_photos))}</div>
        ${btn(busy === 'reset' ? busyLabel : 'Reset all scan data', 'reset', { variant: 'danger', disabled: Boolean(busy) })}` : '<p class="fo-card-note">Open Fruispect directly on the host to use this control.</p>'}
      </section>
    </div>
  </div>`;
}

function resource(data = null) {
  return { data, loading: false, error: null, inFlight: null, retryAt: 0 };
}

function createRequest(id, imageId = null) {
  return {
    id, imageId, autoSelect: imageId == null, batch: resource(), images: resource(), image: resource(),
    history: resource(), query: { page: 1, limit: PAGE_SIZE, search: '', sort: 'newest', status: '', fruit: '', quality: '', agreement: '' },
    timelineCursor: 0, streamCursor: 0, events: [], streamStatus: '',
  };
}

function retryDelay(error) {
  if (error?.retryAfterMs != null && number(error.retryAfterMs) !== null) return Number(error.retryAfterMs);
  const retryAfter = error?.retryAfter ?? error?.retry_after ?? error?.response?.headers?.get?.('Retry-After');
  if (number(retryAfter) !== null) return Math.max(0, Number(retryAfter) * 1000);
  if (present(retryAfter)) return Math.max(0, new Date(retryAfter).getTime() - Date.now()) || 0;
  return [429, 503].includes(errorStatus(error)) ? 5000 : 0;
}

function mergeImage(current, incoming) {
  if (current?.image_id !== incoming?.image_id || !current?.jobs || !incoming?.jobs) return incoming;
  const jobs = { ...incoming.jobs };
  for (const { key } of MODELS) {
    if (current.jobs[key] && (!jobs[key] || Number(current.jobs[key].version) > Number(jobs[key].version))) jobs[key] = current.jobs[key];
  }
  if (MODELS.some(({ key }) => jobs[key] !== incoming.jobs[key])) {
    return { ...incoming, jobs, consensus: current.consensus, terminal: MODELS.every(({ key }) => jobs[key] && isTerminal(jobs[key].status)) };
  }
  return incoming;
}

export function mountOperator(root, { service, connection, mode, confirmAction, notify, scenario }) {
  const preview = mode === 'design-preview';
  const queues = resource();
  const readiness = resource();
  const health = resource();
  const research = resource();
  const figures = resource();
  const host = resource(connection);
  let settings = resource();
  const all = resource();
  let batches = resource();
  let request = null;
  let tab = preview && Object.hasOwn(PREVIEW_TABS, scenario) ? PREVIEW_TABS[scenario] : 'overview';
  let scope = preview && scenario === 'all-requests' ? 'all' : 'owned';
  let updated = null;
  let busy = '';
  let cleanupMessage = '';
  let cleared = '';
  let disposed = false;
  let stopWatch = null;
  let pendingSearch = 0;
  let lastSnapshot = 0;
  let lastHostRead = 0;
  let lastRequestList = 0;
  let renderQueued = false;
  let renderedView = '';
  let renderedRequest = null;
  const downloads = new Map();
  const renderedHTML = new WeakMap();

  root.innerHTML = `<div class="fo-console">
    <header class="fo-header">
      <div><p class="fo-eyebrow">Fruispect operations</p><h1>Operator console</h1><p class="fo-description">Monitor inference, inspect requests, and manage the host.</p></div>
      <div class="fo-access" data-access></div>
    </header>
    <nav class="fo-tabs" aria-label="Operator console" data-tabs>${TABS.map(([id, label]) => `<button type="button" data-action="tab" data-id="${id}">${label}</button>`).join('')}</nav>
    <div class="fo-view" data-view></div>
  </div>`;
  const outlet = root.querySelector('[data-view]');
  const access = root.querySelector('[data-access]');
  const tabs = Array.from(root.querySelector('[data-tabs]').children);
  const canOperate = () => host.data?.local_operator === true && !host.error;
  const allowedRequest = () => tab === 'requests' && scope === 'owned';

  function paint(element, markup) {
    if (!element || renderedHTML.get(element) === markup) return;
    const active = document.activeElement;
    const preserve = active && element.contains(active);
    const action = preserve ? active.dataset.action : undefined;
    const id = preserve ? active.dataset.id : undefined;
    const name = preserve ? active.name : undefined;
    const open = new Set(Array.from(element.querySelectorAll('details[open][data-disclosure]'), (details) => details.dataset.disclosure));
    const scrollables = '.fo-table-wrap, .fo-selection-list';
    const scroll = Array.from(element.querySelectorAll(scrollables), (wrapper) => [wrapper.scrollLeft, wrapper.scrollTop]);
    element.innerHTML = markup;
    renderedHTML.set(element, markup);
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

  function render() {
    const local = canOperate();
    paint(access, preview
      ? badge('LOADING', 'Design preview')
      : badge(local ? 'READY' : '', local ? 'Local operator' : 'Browser session'));
    for (const button of tabs) {
      if (button.dataset.id === tab) button.setAttribute('aria-current', 'page');
      else button.removeAttribute('aria-current');
    }
    const viewKey = tab === 'requests' ? tab + '-' + scope : tab;
    const changed = renderedView !== viewKey;
    renderedView = viewKey;
    if (tab === 'overview') {
      paint(outlet, overview({ queues, readiness, health, connection: local ? host.data : null, preview, updated }));
    } else if (tab === 'queues') {
      paint(outlet, queuesView(queues));
    } else if (tab === 'research') {
      paint(outlet, researchView(research, figures, preview));
    } else if (tab === 'settings') {
      paint(outlet, settingsView({ settings, host, local, preview, busy, cleanupMessage }));
    } else if (scope === 'all' || changed || renderedRequest !== request || !request || cleared) {
      renderedRequest = request;
      paint(outlet, requestsView(scope, request, batches, all, preview, busy, cleared));
    } else {
      paint(outlet.querySelector('[data-slot="collections"]'), batchList(batches, request.id));
      paint(outlet.querySelector('[data-slot="photos"]'), requestPhotos(request, preview));
      paint(outlet.querySelector('[data-slot="summary"]'), requestDetails(request, busy));
      paint(outlet.querySelector('[data-slot="image"]'), imageDetail(request.image, busy, preview));
      paint(outlet.querySelector('[data-slot="timeline"]'), eventTimeline(request));
    }
  }

  function scheduleRender() {
    if (disposed || renderQueued) return;
    renderQueued = true;
    queueMicrotask(() => {
      renderQueued = false;
      if (!disposed) render();
    });
  }

  function read(target, load, { apply, fail, active = () => true, latest = false } = {}) {
    if (disposed || target.retryAt > Date.now()) return Promise.resolve();
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
    scheduleRender();
    target.inFlight = Promise.resolve().then(load).then((value) => {
      if (disposed || !active()) return;
      target.error = null;
      target.retryAt = 0;
      if (apply) apply(value);
      else target.data = value;
    }).catch((error) => {
      if (disposed || !active()) return;
      target.error = error;
      target.retryAt = Date.now() + retryDelay(error);
      fail?.(error);
    }).finally(() => {
      target.loading = false;
      target.inFlight = null;
      scheduleRender();
    });
    return target.inFlight;
  }

  function refreshHost() {
    lastHostRead = Date.now();
    return read(host, () => service.connection(), {
      apply: (value) => { host.data = value; },
      fail: () => {
        if (!host.data) return;
        const { pair_code, connect_url, ...stale } = host.data;
        host.data = stale;
      },
    });
  }

  function refreshTelemetry() {
    read(queues, () => service.queues(), { apply: (value) => { queues.data = value; updated = new Date(); } });
    if (tab !== 'overview') return;
    read(readiness, () => service.readiness(), {
      fail: (error) => {
        const degraded = error?.body ?? error?.data ?? error?.payload;
        if (errorStatus(error) === 503 && typeof degraded?.ready === 'boolean') {
          readiness.data = degraded;
          readiness.error = null;
        }
      },
    });
    read(health, () => service.health());
  }

  function refreshBatches() {
    lastRequestList = Date.now();
    const target = batches;
    read(target, () => service.batches(), {
      active: () => target === batches,
      apply: (data) => {
        target.data = array(data);
        if (!allowedRequest()) return;
        if (!request && !cleared && target.data[0]?.batch_id) chooseBatch(target.data[0].batch_id);
      },
    });
  }

  function closeStream() {
    stopWatch?.();
    stopWatch = null;
    if (request) {
      request.streamStatus = '';
      request.streamError = null;
    }
  }

  function clearRequest(text) {
    closeStream();
    clearTimeout(pendingSearch);
    request = null;
    cleared = text;
    scheduleRender();
  }

  function batchGone(current) {
    if (request !== current) return;
    clearRequest('This collection was removed, expired, or is unavailable in this browser session.');
    batches = resource(array(batches.data).filter((batch) => batch.batch_id !== current.id));
    refreshBatches();
  }

  function rememberEvents(current, events) {
    const known = new Map(current.events.map((event) => [Number(event.event_id), event]));
    for (const event of events) {
      const id = number(event.event_id);
      if (id === null || (event.batch_id && event.batch_id !== current.id)) continue;
      known.set(id, event);
    }
    current.events = [...known.values()].sort((a, b) => Number(a.event_id) - Number(b.event_id)).slice(-TIMELINE_SIZE);
  }

  function refreshHistory(current) {
    if (current === null) return;
    read(current.history, async () => {
      let more = true;
      for (let page = 0; more && page < 3; page += 1) {
        const data = await service.events(current.id, current.timelineCursor);
        if (disposed || request !== current) break;
        const events = array(data?.events);
        rememberEvents(current, events);
        const next = Math.max(current.timelineCursor, number(data?.cursor) ?? 0, ...events.map((event) => number(event.event_id) ?? 0));
        more = events.length >= 200 && next > current.timelineCursor;
        current.timelineCursor = next;
      }
      return true;
    }, {
      active: () => request === current,
      fail: (error) => { if (errorStatus(error) === 404) batchGone(current); },
    });
  }

  function refreshImage(current, latest = false) {
    if (!current?.imageId) return;
    const target = current.image;
    const id = current.imageId;
    read(target, () => service.image(id), {
      latest,
      active: () => request === current && target === current.image,
      apply: (value) => { target.data = mergeImage(target.data, value); },
      fail: (error) => { if (errorStatus(error) === 404) target.data = null; },
    });
  }

  function selectImage(current, id, value = null) {
    if (id === current.imageId) return;
    current.autoSelect = false;
    current.imageId = id;
    current.image = resource(value?.jobs ? value : null);
    refreshImage(current);
    scheduleRender();
  }

  function refreshPhotos(current, latest = false) {
    const target = current.images;
    const query = { ...current.query };
    read(target, () => service.images(current.id, query), {
      latest,
      active: () => request === current && target === current.images,
      apply: (value) => {
        target.data = value;
        const total = number(value?.total);
        const pages = total === null ? query.page : Math.max(1, Math.ceil(total / (number(value?.limit) || PAGE_SIZE)));
        if (query.page > pages) {
          current.query.page = pages;
          current.images = resource();
          refreshPhotos(current);
          return;
        }
        const first = array(value?.images)[0];
        if (current.autoSelect && first?.image_id) selectImage(current, first.image_id, first);
      },
      fail: (error) => { if (errorStatus(error) === 404) batchGone(current); },
    });
  }

  function refreshRequest(current, { image = true, history = true, latest = false } = {}) {
    if (!current || request !== current) return;
    read(current.batch, () => service.batch(current.id), {
      latest,
      active: () => request === current,
      fail: (error) => { if (errorStatus(error) === 404) batchGone(current); },
    });
    refreshPhotos(current, latest);
    if (image) refreshImage(current, latest);
    if (history) refreshHistory(current);
  }

  function openStream(current) {
    if (!current || !allowedRequest() || document.hidden || stopWatch || disposed) return;
    if (typeof service.watch !== 'function') {
      current.streamStatus = 'polling';
      return;
    }
    const active = () => !disposed && request === current && allowedRequest() && !document.hidden;
    const cleanupWatch = service.watch(current.id, {
      cursor: Math.max(current.streamCursor, current.timelineCursor),
      onEvents(events, cursor) {
        if (!active()) return;
        rememberEvents(current, events);
        current.streamCursor = Math.max(current.streamCursor, number(cursor) ?? 0);
        refreshRequest(current, {
          image: events.some((event) => !event.image_id || event.image_id === current.imageId),
          history: false,
          latest: true,
        });
        scheduleRender();
      },
      onRecover() {
        if (active()) refreshRequest(current);
      },
      onRemoved() {
        if (active()) batchGone(current);
      },
      onStatus(status, error) {
        if (!active()) return;
        current.streamStatus = status;
        current.streamError = error;
        scheduleRender();
      },
    });
    if (active()) stopWatch = cleanupWatch;
    else cleanupWatch();
  }

  function chooseBatch(id, initialImage = null) {
    if (id === request?.id) {
      if (initialImage?.image_id) selectImage(request, initialImage.image_id, initialImage);
      return;
    }
    closeStream();
    clearTimeout(pendingSearch);
    cleared = '';
    request = createRequest(id, initialImage?.image_id);
    if (initialImage) request.image.data = initialImage;
    refreshRequest(request);
    openStream(request);
    scheduleRender();
  }

  function refreshView() {
    if (tab === 'overview' || tab === 'queues') refreshTelemetry();
    if (tab === 'requests') {
      if (scope === 'all') read(all, () => service.allRequests());
      else {
        refreshBatches();
        refreshRequest(request);
        openStream(request);
      }
    }
    if (tab === 'research') {
      read(research, () => service.research());
      read(figures, () => service.figures());
    }
    if (tab === 'settings') {
      refreshHost();
      read(settings, () => service.settings());
    }
  }

  function chooseTab(next) {
    if (tab === next || !TABS.some(([key]) => key === next)) return;
    if (tab === 'requests') closeStream();
    tab = next;
    refreshView();
    scheduleRender();
  }

  function chooseScope(next) {
    if (scope === next || !['all', 'owned'].includes(next)) return;
    if (next === 'all') closeStream();
    scope = next;
    refreshView();
    scheduleRender();
  }

  function poll() {
    if (disposed || document.hidden) return;
    if (tab === 'overview' || tab === 'queues') refreshTelemetry();
    const now = Date.now();
    if (tab === 'settings' && now - lastHostRead > 4500) {
      refreshHost();
      read(settings, () => service.settings());
    }
    if (allowedRequest()) {
      if (now - lastRequestList > 10000) refreshBatches();
      if (request && (now - lastSnapshot > 10000 || request.streamStatus === 'polling' || preview)) {
        lastSnapshot = now;
        refreshRequest(request);
      }
      openStream(request);
    }
  }

  function deletionResult(data, verb) {
    const deleted = data?.deleted;
    if (!deleted) return verb + '.';
    const collections = number(deleted.collections);
    const photos = number(deleted.photos);
    const details = [
      collections === null ? '' : count(collections) + (collections === 1 ? ' collection' : ' collections'),
      photos === null ? '' : count(photos) + (photos === 1 ? ' photo' : ' photos'),
    ].filter(Boolean).join(' and ');
    return (details ? verb + ' · ' + details + '.' : verb + '.')
      + (deleted.cleanup_pending ? ' File cleanup is pending on the host.' : '');
  }

  async function perform(action, id) {
    if (busy || disposed) return;
    const current = request;
    const imageId = current?.imageId;
    const batchId = current?.id;
    const privileged = action === 'retry' || action === 'reset';
    if (privileged && !canOperate()) return;
    const confirmation = {
      'cancel-image': ['Cancel unfinished checks?', 'Queued checks will end. A running check can finish its current pass before discarding the result.', 'Cancel checks'],
      'cancel-batch': ['Cancel this collection?', 'Unfinished checks in this collection will be cancelled. Completed results will stay available.', 'Cancel collection'],
      'delete-batch': ['Delete this collection?', 'This removes the collection and its saved scan data from your browser session.', 'Delete collection'],
      'delete-collections': ['Delete your browser collections?', 'This removes all scan collections owned by this browser session.', 'Delete browser collections'],
      reset: ['Reset all scan data?', 'This removes every browser’s scan collections and results. Research, models, and connection configuration are preserved.', 'Reset all scan data', 'RESET'],
    }[action];
    if (['export', 'cancel-batch', 'delete-batch'].includes(action) && !batchId) return;
    if (action === 'cancel-image' && !imageId) return;
    busy = action;
    scheduleRender();
    try {
      if (confirmation) {
        const [title, body, label, requireText] = confirmation;
        if (!await confirmAction({ title, body, label, requireText }) || disposed) return;
      }
      if (privileged) {
        await refreshHost();
        if (disposed) return;
        if (!canOperate()) {
          notify('Direct localhost access is required for this control.', 'error');
          return;
        }
      }
      if (action === 'retry') {
        await service.retryConnection();
        if (disposed) return;
        notify('Phone connection retry requested.');
        refreshHost();
      } else if (action === 'export') {
        const file = await service.exportFile(batchId, id);
        if (disposed) return;
        const href = URL.createObjectURL(file.blob);
        const link = document.createElement('a');
        link.href = href;
        link.download = file.filename;
        root.append(link);
        link.click();
        link.remove();
        downloads.set(href, setTimeout(() => { URL.revokeObjectURL(href); downloads.delete(href); }, 30000));
      } else if (action === 'cancel-image' || action === 'cancel-batch') {
        const result = action === 'cancel-image' ? await service.cancelImage(imageId) : await service.cancelBatch(batchId);
        if (disposed) return;
        notify(result?.cancelled_or_requested === 0 ? 'No unfinished checks required cancellation.' : 'Cancellation requested.');
        refreshRequest(current, { latest: true });
        refreshBatches();
      } else if (action === 'delete-batch') {
        const result = await service.deleteBatch(batchId);
        if (disposed) return;
        if (request?.id === batchId) clearRequest(deletionResult(result, 'Collection deleted'));
        batches = resource(array(batches.data).filter((batch) => batch.batch_id !== batchId));
        if (allowedRequest()) refreshBatches();
        notify(deletionResult(result, 'Collection deleted'), 'success');
      } else {
        const reset = action === 'reset';
        const result = reset ? await service.reset('RESET') : await service.deleteCollections();
        if (disposed) return;
        cleanupMessage = deletionResult(result, reset ? 'Scan data reset' : 'Browser collections deleted');
        clearRequest('');
        batches = resource([]);
        settings = resource();
        read(settings, () => service.settings());
        if (allowedRequest()) refreshBatches();
        notify(cleanupMessage, 'success');
      }
    } catch (error) {
      if (disposed) return;
      if (privileged && [401, 403].includes(errorStatus(error))) {
        host.error = error;
        refreshHost();
      }
      if (errorStatus(error) === 404 && current && ['delete-batch', 'cancel-batch', 'export'].includes(action)) batchGone(current);
      const prefix = errorStatus(error) === 409 ? 'The operation is currently blocked. ' : '';
      notify(prefix + errorText(error), 'error');
    } finally {
      busy = '';
      scheduleRender();
    }
  }

  async function openQueuePhoto(id) {
    try {
      const image = await service.image(id);
      if (disposed) return;
      if (!image?.batch_id) {
        notify('No collection details were returned for this photo.', 'error');
        return;
      }
      scope = 'owned';
      chooseTab('requests');
      chooseBatch(image.batch_id, image);
    } catch (error) {
      if (disposed) return;
      notify([401, 403, 404].includes(errorStatus(error)) ? 'This photo is unavailable in this browser session.' : errorText(error), 'error');
    }
  }

  async function copyLink() {
    const value = host.data;
    const pairingLink = canOperate() && upper(value?.status) === 'READY' ? connectionURL(value.connect_url) : '';
    const link = pairingLink || connectionURL(value?.public_url);
    if (!link) return;
    try {
      await navigator.clipboard.writeText(link);
      if (!disposed) notify(pairingLink ? 'Pairing link copied.' : 'Public link copied.', 'success');
    } catch {
      if (disposed) return;
      const input = outlet.querySelector('[data-pair-link]');
      if (input instanceof HTMLInputElement) {
        input.focus();
        input.select();
      }
      notify('Clipboard access is unavailable. Copy the link from the connection panel.');
    }
  }

  function onClick(event) {
    const button = event.target.closest('[data-action]');
    if (!button || !root.contains(button) || button.disabled) return;
    const { action, id } = button.dataset;
    if (action === 'tab') {
      chooseTab(id);
      if (!tabs.includes(button)) tabs.find((item) => item.dataset.id === id)?.focus();
    }
    else if (action === 'scope') chooseScope(id);
    else if (action === 'refresh') refreshView();
    else if (action === 'batch') chooseBatch(id);
    else if (action === 'photo' && request) selectImage(request, id);
    else if (action === 'queue-photo') openQueuePhoto(id);
    else if (action === 'copy') copyLink();
    else if (action === 'page' && request) {
      request.query.page = Math.max(1, request.query.page + Number(id));
      request.images = resource();
      refreshPhotos(request);
    } else if (['retry', 'export', 'cancel-image', 'cancel-batch', 'delete-batch', 'delete-collections', 'reset'].includes(action)) {
      perform(action, id);
    }
  }

  function changeFilter(event) {
    const input = event.target;
    if (!request || !input.matches('[data-filter]')) return;
    if (input.name === 'search' && event.type !== 'input') return;
    if (input.name !== 'search' && event.type !== 'change') return;
    const current = request;
    current.query[input.name] = input.value;
    current.query.page = 1;
    clearTimeout(pendingSearch);
    if (input.name === 'search') {
      pendingSearch = setTimeout(() => {
        if (request !== current || !allowedRequest()) return;
        current.images = resource();
        refreshPhotos(current);
      }, 220);
    } else {
      current.images = resource();
      refreshPhotos(current);
    }
  }

  function preventForm(event) {
    if (event.target.matches('[data-photo-filters]')) event.preventDefault();
  }

  function onImageError(event) {
    if (event.target.matches?.('.fo-thumb img')) event.target.hidden = true;
  }

  function onVisibility() {
    if (document.hidden) closeStream();
    else poll();
  }

  root.addEventListener('click', onClick);
  root.addEventListener('input', changeFilter);
  root.addEventListener('change', changeFilter);
  root.addEventListener('submit', preventForm);
  root.addEventListener('error', onImageError, true);
  document.addEventListener('visibilitychange', onVisibility);
  const timer = setInterval(poll, 5000);
  if (!connection) refreshHost().then(() => { if (!disposed) refreshView(); });
  else refreshView();
  render();

  return () => {
    disposed = true;
    clearInterval(timer);
    clearTimeout(pendingSearch);
    closeStream();
    for (const [href, timerId] of downloads) {
      clearTimeout(timerId);
      URL.revokeObjectURL(href);
    }
    root.removeEventListener('click', onClick);
    root.removeEventListener('input', changeFilter);
    root.removeEventListener('change', changeFilter);
    root.removeEventListener('submit', preventForm);
    root.removeEventListener('error', onImageError, true);
    document.removeEventListener('visibilitychange', onVisibility);
    root.querySelector('.fo-console')?.remove();
  };
}
