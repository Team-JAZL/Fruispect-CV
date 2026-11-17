// Render model readiness, active jobs, FIFO queues, and measured timings.
import { MODELS } from '../api/contracts.js';
import { EMPTY, clock, html, array, record, present, number, display, count, duration, elapsed, date, words, upper, seq, message, jobLabel, jobCount } from './format.js';
import { badge, btn, empty, notice, stateNotice, sectionHead, fields, metric } from './components.js';

// Select the requested model lane from the current queue response.
export function laneFor(envelope, key) {
  const lanes = envelope?.lanes;
  return lanes?.find(lane => lane.model_key === key);
}

// Select the requested model readiness record from the host response.
export function readinessFor(readiness, key) {
  const models = readiness?.models;
  return models?.find(model => model.model_key === key);
}

// Render retained completion, failure, unavailability, and cancellation counts.
export function laneCounts(lane) {
  return [
    ['Successful', lane?.counts?.COMPLETED],
    ['Failed', lane?.counts?.FAILED],
    ['Unavailable', lane?.counts?.UNAVAILABLE],
    ['Cancelled', lane?.counts?.CANCELLED],
  ].map(([label, value]) => metric(label, count(lane?.counts ? value ?? 0 : null))).join('');
}

// Render measured inference statistics and observed job throughput.
export function timings(lane) {
  const throughput = number(lane?.throughput_model_jobs_s);
  return [
    ['Mean inference', duration(lane?.mean_inference_ms)],
    ['P95 inference', duration(lane?.p95_inference_ms)],
    ['Jobs / second', throughput === null ? EMPTY : throughput.toLocaleString(undefined, { maximumFractionDigits: 4 })],
  ].map(([label, value]) => metric(label, value)).join('');
}

// Render worker readiness, current work, and diagnostic details.
export function modelHealth(model, lane, readiness) {
  const state = lane?.state ?? readiness?.state ?? readiness?.status;
  const modelError = message(lane?.last_error ?? readiness?.last_error);
  return `<article data-reveal class="fo-card fo-health-card">
    <div class="fo-card-head"><h3>${html(model.name)}</h3>${badge(state, state ? undefined : 'Unknown')}</div>
    <div class="fo-health-main"><div><span class="fo-caption">Current job</span><strong>${lane ? lane.active ? html(seq(lane.active.admission_seq)) : 'Idle' : '—'}</strong></div>${metric('Waiting jobs', count(lane?.queue_depth))}</div>
    <div class="fo-health-footer"><span>${html(display(lane?.device ?? readiness?.device))}</span><span>Mean inference <b>${html(duration(lane?.mean_inference_ms))}</b></span></div>
    ${modelError ? `<p class="fo-inline-error">${html(modelError)}</p>` : ''}
  </article>`;
}

// Render an accessible admission link for a queue image.
export function jobLink(job) {
  if (!present(job?.admission_seq)) return '—';
  const label = seq(job.admission_seq);
  return job.image_id ? btn(label, 'queue-photo', { id: job.image_id, variant: 'text' }) : html(label);
}

// Render host readiness, model health, and retained work summaries.
export function overview({ queues, readiness, health, connection, updated }) {
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
    <section class="fo-host" data-reveal aria-label="Host status">
      <div class="fo-host-copy"><div class="fo-host-kicker"><i aria-hidden="true" class="${serviceState === 'READY' ? 'fo-is-ready' : ''}"></i> Host status</div><h2>${serviceTitle}</h2><p>${html(healthStatus ? 'API health: ' + words(healthStatus) : health.error ? 'Health check unavailable' : 'Waiting for host health check')}${readiness.data?.device ? ' · Device: ' + html(readiness.data.device) : ''}</p></div>
      <div class="fo-host-metrics">
        ${metric('Workers ready', readyCount === null ? '—' : readyCount + ' / ' + MODELS.length)}
        ${metric('Waiting jobs', count(waitingCount))}
        ${metric('Storage', storage === true ? 'Ready' : storage === false ? 'Unavailable' : '—')}
      </div>
    </section>
    ${stateNotice(readiness, 'host readiness')}${stateNotice(health, 'API health')}${stateNotice(queues, 'queue telemetry')}
    <section class="fo-section">
      ${sectionHead('Model health', 'Three independent workers.', btn('View queues', 'tab', { id: 'queues', shortLabel: 'Queues' }))}
      <div class="fo-model-grid">${MODELS.map((model, index) => modelHealth(model, lanes[index], modelReadiness[index])).join('')}</div>
    </section>
    <section data-reveal class="fo-card fo-table-card">
      ${sectionHead('Work on the host', 'Retained jobs by model.', updated ? `<span class="fo-update">Updated ${html(clock.format(updated))}</span>` : '')}
      <div class="fo-table-wrap" role="region" aria-label="Model work summary" tabindex="0"><table class="fo-table"><thead><tr><th scope="col">Model</th><th scope="col">Active job</th><th scope="col">Up next</th><th scope="col">Successful</th><th scope="col">Failed</th><th scope="col">Unavailable</th><th scope="col">Cancelled</th><th scope="col">P95 inference</th></tr></thead>
      <tbody>${MODELS.map((model, index) => {
        const lane = lanes[index];
        const next = array(lane?.up_next)[0];
        return `<tr><th scope="row">${html(model.name)}</th><td>${lane?.active ? jobLink(lane.active) : lane ? 'Idle' : '—'}</td><td>${next ? jobLink(next) : '—'}</td><td>${count(jobCount(lane, 'COMPLETED'))}</td><td>${count(jobCount(lane, 'FAILED'))}</td><td>${count(jobCount(lane, 'UNAVAILABLE'))}</td><td>${count(jobCount(lane, 'CANCELLED'))}</td><td>${html(duration(lane?.p95_inference_ms))}</td></tr>`;
      }).join('')}</tbody></table></div>
      <p class="fo-card-note">Rolling timing uses up to 100 retained completed jobs per model.</p>
    </section>
    <div class="fo-overview-bottom" data-reveal><span>${html((connection?.local_operator === true ? 'Direct localhost access' : 'Browser-session access'))}</span>${btn('Connection settings', 'tab', { id: 'settings', variant: 'text', shortLabel: 'Connection' })}</div>
  </div>`;
}

// Render one independent FIFO lane with active and upcoming jobs.
export function queueLane(model, lane) {
  if (!lane) return `<article data-reveal class="fo-card fo-lane"><div class="fo-card-head"><h3>${html(model.name)}</h3>${badge(null)}</div>${empty('Lane data unavailable', 'The host has not returned telemetry for this worker.')}</article>`;
  const upcoming = array(lane.up_next).slice(0, 8);
  return `<article data-reveal class="fo-card fo-lane">
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

// Render every model lane with telemetry availability and refresh controls.
export function queuesView(queues) {
  return `<div class="fo-stack">
    ${sectionHead('Model queues', 'Photos run in arrival order, one queue per model.')}
    ${stateNotice(queues, 'queue telemetry')}
    ${queues.loading && !queues.data ? empty('Reading queue telemetry…') : ''}
    <div class="fo-model-grid">${MODELS.map((model) => queueLane(model, laneFor(queues.data, model.key))).join('')}</div>
    ${notice('Counts reflect retained model jobs. Timing uses up to 100 retained completed jobs per model. Jobs per second includes idle time.')}
  </div>`;
}
