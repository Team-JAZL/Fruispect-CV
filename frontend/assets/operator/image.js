// Render image metadata, model probabilities, and job details.
import { MODELS, isTerminal } from '../api/contracts.js';
import { EMPTY, html, record, present, number, display, count, duration, score, date, upper, seq, message, jobLabel, localURL } from './format.js';
import { badge, btn, empty, notice, stateNotice, fields, metric, progress } from './components.js';

// Render a same-origin thumbnail with an accessible missing-photo fallback.
export function imageThumb(image, large = false) {
  const url = localURL(image?.thumbnail_url);
  return `<span class="fo-thumb${large ? ' fo-thumb--large' : ''}"><span aria-hidden="true">PHOTO</span>${url ? `<img src="${html(url)}" alt="${large ? 'Thumbnail of ' + html(image.original_filename ?? 'accepted photo') : ''}" loading="${large ? 'eager' : 'lazy'}" decoding="async">` : ''}</span>`;
}

// Describe model agreement while retaining provisional or incomplete scope.
export function consensusText(consensus) {
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

// Render recorded class probabilities as labeled bounded progress bars.
export function probabilityList(title, probabilities) {
  if (!record(probabilities) || !Object.keys(probabilities).length) return `<div><h4>${title}</h4><p class="fo-muted">${EMPTY}</p></div>`;
  return `<div><h4>${title}</h4><ul class="fo-probabilities">${Object.entries(probabilities).map(([label, value]) => `<li><span>${html(label)}</span>${progress(value, 1, label + ' probability')}<strong>${html(score(value))}</strong></li>`).join('')}</ul></div>`;
}

// Render one model job with predictions, timing, and recorded provenance.
export function jobDetail(model, job) {
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

// Render an image snapshot with metadata and three independent model jobs.
export function imageDetail(resource, busy) {
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
      ${imageThumb(image, true)}
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
