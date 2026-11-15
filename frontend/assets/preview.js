import { ApiError } from './api/client.js';
import { FRUITS as FRUIT_CLASSES, JOB_LABELS, MODELS, isTerminal } from './api/contracts.js';

const SCAN = 'Scan and admission';
const RESULTS = 'Model results';
const RECOVERY = 'Recovery';
const OPERATOR = 'Operator';

export const SCENARIOS = [
  { id: 'empty', label: 'Empty workspace', group: SCAN },
  { id: 'selected', label: 'Selected photo', group: SCAN },
  { id: 'camera-denied', label: 'Camera permission denied', group: SCAN },
  { id: 'camera-unsupported', label: 'Camera unavailable in this context', group: SCAN },
  { id: 'uploading', label: 'Submitting a photo', group: SCAN },
  { id: 'mixed-upload', label: 'Some files accepted', group: SCAN },
  { id: 'preparing', label: 'Preparing a photo', group: RESULTS },
  { id: 'queued', label: 'Checks queued', group: RESULTS },
  { id: 'partial', label: 'One result available', group: RESULTS },
  { id: 'provisional', label: 'Two results available', group: RESULTS },
  { id: 'agreement', label: 'Three models agree', group: RESULTS },
  { id: 'fruit-disagreement', label: 'Fruit disagreement', group: RESULTS },
  { id: 'quality-disagreement', label: 'Quality disagreement', group: RESULTS },
  { id: 'incomplete', label: 'Two results and one failure', group: RESULTS },
  { id: 'model-unavailable', label: 'One model unavailable', group: RESULTS },
  { id: 'all-failed', label: 'All checks failed', group: RESULTS },
  { id: 'preprocess-failed', label: 'Preparation failed after acceptance', group: RESULTS },
  { id: 'cancelling', label: 'Cancellation requested', group: RESULTS },
  { id: 'cancelled', label: 'Checks cancelled', group: RESULTS },
  { id: 'reconnecting', label: 'Reconnecting to results', group: RECOVERY },
  { id: 'backpressure', label: 'Queues at capacity', group: RECOVERY },
  { id: 'storage-busy', label: 'Storage busy', group: RECOVERY },
  { id: 'service-unavailable', label: 'Service unavailable', group: RECOVERY },
  { id: 'expired', label: 'Collection expired', group: RECOVERY },
  { id: 'deleted', label: 'Collection removed while open', group: RECOVERY },
  { id: 'active-queues', label: 'Active queues with waiting jobs', group: OPERATOR },
  { id: 'degraded', label: 'Loading, offline and unavailable workers', group: OPERATOR },
  { id: 'idle-queues', label: 'Idle workers with retained statistics', group: OPERATOR },
  { id: 'missing-research', label: 'Research artifacts missing', group: OPERATOR },
  { id: 'pairing', label: 'Phone pairing required', group: OPERATOR },
  { id: 'phone-failed', label: 'Phone link failed', group: OPERATOR },
  { id: 'phone-starting', label: 'Phone link starting', group: OPERATOR },
  { id: 'phone-disabled', label: 'Phone link disabled', group: OPERATOR },
  { id: 'reset', label: 'Global reset confirmation', group: OPERATOR },
  { id: 'cleanup-pending', label: 'Deletion with cleanup pending', group: OPERATOR },
  { id: 'all-requests', label: 'Illustrative all-browser requests', group: OPERATOR },
];

const MODEL_KEYS = MODELS.map(model => model.key);
const MODEL_NAMES = MODELS.map(model => model.name);
const JOB_STATES = Object.keys(JOB_LABELS);
const EMPTY_SCENARIOS = new Set(['empty', 'selected', 'camera-denied', 'camera-unsupported', 'uploading']);
const SAMPLE_PHOTO = new URL('./apple.jpg', import.meta.url).href;
const SAMPLE_BATCH = 'batch-preview-001';
const SAMPLE_PAIR_CODE = '482731';
const PREVIEW_ORIGIN = 'https://fruispect-preview.example';
const localPhoneLink = () => {
  const link = new URL(globalThis.location?.href ?? PREVIEW_ORIGIN);
  link.search = '';
  link.searchParams.set('mode', 'design-preview');
  link.searchParams.set('scenario', 'pairing');
  link.hash = '';
  return link;
};
const EPOCH = Date.UTC(2026, 5, 18, 9, 42, 0);
const RETENTION_MS = 24 * 60 * 60 * 1000;
const MAX_BYTES = 12 * 1024 * 1024;
const MAX_PIXELS = 24_000_000;
const MAX_IMAGES = 1000;
const MODEL_PARAMETERS = [11_180_232, 1_527_944, 4_017_796];
const INFERENCE_MS = [93, 46, 108];
const WORK_MS = [420, 790, 1160];
const PREVIEW_PROVENANCE = 'Design preview fixture';
const PREPROCESSING_HASH = 'bd5e1463'.repeat(8);
const CHECKPOINT_HASHES = ['a03b44c1', '109cdafe', 'be422f0c'].map(prefix => prefix.repeat(8));

const ALL_COMPLETE = ['COMPLETED', 'COMPLETED', 'COMPLETED'];
const PREPARING = ['WAITING_FOR_INPUT', 'WAITING_FOR_INPUT', 'WAITING_FOR_INPUT'];
const QUEUED = ['QUEUED', 'QUEUED', 'QUEUED'];
const PARTIAL = ['COMPLETED', 'RUNNING', 'QUEUED'];

const SCENARIO_JOBS = {
  'mixed-upload': PARTIAL,
  preparing: PREPARING,
  queued: QUEUED,
  partial: PARTIAL,
  provisional: ['COMPLETED', 'COMPLETED', 'RUNNING'],
  incomplete: ['COMPLETED', 'COMPLETED', 'FAILED'],
  'model-unavailable': ['COMPLETED', 'COMPLETED', 'UNAVAILABLE'],
  'all-failed': ['FAILED', 'FAILED', 'FAILED'],
  'preprocess-failed': ['FAILED', 'FAILED', 'FAILED'],
  cancelling: ['COMPLETED', 'RUNNING', 'CANCELLED'],
  cancelled: ['COMPLETED', 'CANCELLED', 'CANCELLED'],
  reconnecting: PARTIAL,
  backpressure: PARTIAL,
  'storage-busy': PARTIAL,
  'service-unavailable': PARTIAL,
  'active-queues': ['RUNNING', 'RUNNING', 'RUNNING'],
  degraded: ['QUEUED', 'FAILED', 'UNAVAILABLE'],
};

const iso = ms => new Date(ms).toISOString();
const seconds = ms => ms / 1000;
const copy = value => structuredClone(value);
const padId = number => String(number).padStart(3, '0');
const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
const scheduled = (callback, ms) => {
  const timer = setTimeout(callback, ms);
  timer.unref?.();
  return timer;
};

function previewError(status, code, message) {
  return new ApiError(message, { status, code, payload: { error: { code, message } } });
}

function admissionEnvelope(accepted, rejected) {
  return {
    accepted,
    rejected,
    ...(rejected.some(item => [429, 503].includes(item.http_status)) && { retryAfterMs: 1_000 }),
  };
}

function probabilities(labels, winner, confidence, hasZero = false) {
  const alternatives = labels.filter(label => label !== winner);
  const divisor = alternatives.length - Number(hasZero && alternatives.length > 1);
  return Object.fromEntries(labels.map(label => {
    if (label === winner) return [label, confidence];
    if (hasZero && alternatives.length > 1 && label === alternatives.at(-1)) return [label, 0];
    return [label, (1 - confidence) / divisor];
  }));
}

function makeResult(image, job, index, profile, elapsedMs) {
  const fruit = profile === 'fruit-disagreement' && index === 2 ? 'Pomegranate' : 'Apple';
  const quality = profile === 'quality-disagreement' && index === 1 ? 'Bad' : 'Good';
  const fruitConfidence = fruit === 'Apple' ? [0.982, 0.941, 0.973][index] : 0.731;
  const qualityConfidence = quality === 'Good' ? [0.956, 0.894, 0.928][index] : 0.642;

  return {
    model_key: job.model_key,
    architecture: MODEL_NAMES[index],
    predicted_fruit: fruit,
    fruit_class_index: FRUIT_CLASSES.indexOf(fruit),
    fruit_confidence: fruitConfidence,
    predicted_quality: quality,
    quality_class_index: quality === 'Good' ? 0 : 1,
    quality_confidence: qualityConfidence,
    fruit_probabilities: probabilities(FRUIT_CLASSES, fruit, fruitConfidence, index === 0),
    quality_probabilities: probabilities(['Good', 'Bad'], quality, qualityConfidence),
    inference_ms: job.inference_ms,
    queue_wait_ms: job.queue_wait_ms,
    preprocess_ms: image.preprocess_ms,
    end_to_end_ms: elapsedMs,
    checkpoint_sha256: job.model_checkpoint_sha256,
    preprocessing_sha256: image.preprocessing_sha256,
    device: 'cpu',
    framework_versions: { python: '3.12.3', torch: '2.5.1', torchvision: '0.20.1' },
    seed: 42,
    best_epoch: [24, 28, 26][index],
    state_dict_tensors: [122, 244, 360][index],
    parameters: MODEL_PARAMETERS[index],
    smoke_shapes: { fruit: [1, 6], quality: [1, 2] },
  };
}

function imageJobs(image) {
  return MODEL_KEYS.map(key => image.jobs[key]);
}

function updateConsensus(image) {
  const jobs = imageJobs(image);
  const results = jobs.filter(job => job.status === 'COMPLETED' && job.result).map(job => job.result);
  image.terminal = jobs.every(job => isTerminal(job.status));
  image.consensus = {
    successful_models: results.length,
    fruit_disagreement: results.length >= 2 && new Set(results.map(result => result.predicted_fruit)).size > 1,
    quality_disagreement: results.length >= 2 && new Set(results.map(result => result.predicted_quality)).size > 1,
    scope: results.length === MODEL_KEYS.length ? 'complete' : image.terminal ? 'incomplete' : 'provisional',
  };
}

function batchSnapshot(batch) {
  const photos = batch.photos;
  const jobs = photos.flatMap(imageJobs);
  const summary = {
    accepted: photos.length,
    rejected: batch.rejections.size,
    total_submitted: photos.length + batch.rejections.size,
    preprocessing: photos.filter(image => image.input_status === 'PROCESSING').length,
    fully_complete: photos.filter(image => image.terminal).length,
    partial: photos.filter(image => image.consensus.successful_models > 0 && image.consensus.successful_models < MODEL_KEYS.length).length,
    failed: photos.filter(image => imageJobs(image).some(job => ['FAILED', 'UNAVAILABLE'].includes(job.status))).length,
    cancelled: photos.filter(image => imageJobs(image).some(job => job.status === 'CANCELLED')).length,
    queued: jobs.filter(job => job.status === 'QUEUED').length,
    running: jobs.filter(job => job.status === 'RUNNING').length,
  };
  return {
    batch_id: batch.batch_id,
    created_at: batch.created_at,
    cancelled_at: batch.cancelled_at,
    status: batch.cancelled_at ? 'CANCELLED' : photos.length > 0 && summary.fully_complete === photos.length ? 'COMPLETED' : 'ACTIVE',
    event_cursor: batch.events.at(-1)?.event_id ?? 0,
    summary,
  };
}

function matchesImage(image, query) {
  const { search, status, fruit, quality, agreement } = query;
  const jobs = imageJobs(image);
  const results = jobs.filter(job => job.status === 'COMPLETED' && job.result).map(job => job.result);
  if (search && !image.original_filename.toLowerCase().includes(String(search).trim().toLowerCase())) return false;
  if (status && status !== 'all' && !(status === 'TERMINAL' ? image.terminal : jobs.some(job => job.status === status))) return false;
  if (fruit && fruit !== 'all' && !results.some(result => result.predicted_fruit.toLowerCase() === String(fruit).toLowerCase())) return false;
  if (quality && quality !== 'all' && !results.some(result => result.predicted_quality.toLowerCase() === String(quality).toLowerCase())) return false;
  const differs = image.consensus.fruit_disagreement || image.consensus.quality_disagreement;
  if (agreement === 'disagreement' && !differs) return false;
  if (agreement === 'agreement' && (differs || image.consensus.successful_models < 2)) return false;
  return true;
}

function formatFromHeader(bytes) {
  if (bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return 'jpeg';
  if ([137, 80, 78, 71, 13, 10, 26, 10].every((byte, i) => bytes[i] === byte)) return 'png';
  const tag = (start, end) => String.fromCharCode(...bytes.subarray(start, end));
  if (tag(0, 4) === 'RIFF' && tag(8, 12) === 'WEBP') return 'webp';
  return null;
}

async function animatedPng(file) {
  // PNG animation control must precede the first image data chunk.
  for (let offset = 8; offset + 8 <= file.size;) {
    const chunk = new DataView(await file.slice(offset, offset + 8).arrayBuffer());
    const type = chunk.getUint32(4);
    if (type === 0x6163544c) return true; // acTL
    if (type === 0x49444154 || type === 0x49454e44) return false; // IDAT or IEND
    offset += chunk.getUint32(0) + 12;
  }
  return false;
}

async function withDecodedImage(file, callback) {
  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(file);
    try {
      return callback(bitmap);
    } finally {
      bitmap.close();
    }
  }
  if (typeof Image === 'undefined') return { width: null, height: null, thumbnail_url: null };
  const source = URL.createObjectURL(file);
  try {
    const image = new Image();
    image.src = source;
    await image.decode();
    return callback(image);
  } finally {
    URL.revokeObjectURL(source);
  }
}

async function inspectPhoto(file) {
  if (!file || typeof file.slice !== 'function' || !file.size) {
    throw previewError(422, 'INVALID_IMAGE', 'Choose a readable JPEG, PNG or WebP photo.');
  }
  if (file.size > MAX_BYTES) throw previewError(413, 'FILE_TOO_LARGE', 'The photo exceeds 12 MiB.');
  const bytes = new Uint8Array(await file.slice(0, 32).arrayBuffer());
  const format = formatFromHeader(bytes);
  if (!format) throw previewError(422, 'UNSUPPORTED_FORMAT', 'Choose a JPEG, PNG or WebP still photo.');
  const animatedWebp = format === 'webp' && String.fromCharCode(...bytes.subarray(12, 16)) === 'VP8X' && (bytes[20] & 2);
  if (animatedWebp || (format === 'png' && await animatedPng(file))) {
    throw previewError(422, 'ANIMATED_IMAGE', 'Choose a still photo. Animated images are unsupported.');
  }

  try {
    return await withDecodedImage(file, image => {
      const width = image.naturalWidth ?? image.width;
      const height = image.naturalHeight ?? image.height;
      if (width * height > MAX_PIXELS) throw previewError(413, 'TOO_MANY_PIXELS', 'The photo exceeds 24 million decoded pixels.');
      const canvas = globalThis.document?.createElement('canvas');
      if (!canvas) return { width, height, thumbnail_url: null };
      const scale = Math.min(1, 384 / Math.max(width, height));
      canvas.width = Math.max(1, Math.round(width * scale));
      canvas.height = Math.max(1, Math.round(height * scale));
      const context = canvas.getContext('2d', { alpha: false });
      if (!context) return { width, height, thumbnail_url: null };
      context.fillStyle = '#fff';
      context.fillRect(0, 0, canvas.width, canvas.height);
      context.drawImage(image, 0, 0, canvas.width, canvas.height);
      return { width, height, thumbnail_url: canvas.toDataURL('image/jpeg', 0.78) };
    });
  } catch (error) {
    if (error.status) throw error;
    throw previewError(422, 'INVALID_IMAGE', 'The photo could not be decoded.');
  }
}

function csvCell(value) {
  if (value === null || value === undefined) return '';
  const string = typeof value === 'object' ? JSON.stringify(value) : String(value);
  // A filename can be user-supplied. Keep spreadsheet readers from evaluating formulas.
  const safe = typeof value === 'string' && /^[=+\-@\t\r\n]/.test(string) ? "'" + string : string;
  return /[",\r\n]/.test(safe) ? '"' + safe.replaceAll('"', '""') + '"' : safe;
}

function makeExport(batch, format) {
  if (format !== 'csv' && format !== 'json') throw previewError(422, 'INVALID_FORMAT', 'Choose CSV or JSON.');
  const rows = batch.photos.flatMap(image => imageJobs(image).map(job => ({
    batch_id: image.batch_id,
    image_id: image.image_id,
    admission_seq: image.admission_seq,
    original_filename: image.original_filename,
    received_at: image.received_at,
    input_status: image.input_status,
    model_key: job.model_key,
    status: job.status,
    cancel_requested: job.cancel_requested,
    predicted_fruit: job.result?.predicted_fruit ?? null,
    fruit_confidence: job.result?.fruit_confidence ?? null,
    predicted_quality: job.result?.predicted_quality ?? null,
    quality_confidence: job.result?.quality_confidence ?? null,
    fruit_probabilities: job.result?.fruit_probabilities ?? null,
    quality_probabilities: job.result?.quality_probabilities ?? null,
    queue_wait_ms: job.queue_wait_ms,
    preprocess_ms: image.preprocess_ms,
    inference_ms: job.inference_ms,
    end_to_end_ms: job.result?.end_to_end_ms ?? null,
    error_code: job.error_code,
    error_message: job.error_message,
  })));
  const columns = [
    'batch_id', 'image_id', 'admission_seq', 'original_filename', 'received_at', 'input_status', 'model_key', 'status',
    'cancel_requested', 'predicted_fruit', 'fruit_confidence', 'predicted_quality', 'quality_confidence',
    'fruit_probabilities', 'quality_probabilities', 'queue_wait_ms', 'preprocess_ms', 'inference_ms', 'end_to_end_ms',
    'error_code', 'error_message',
  ];
  const contents = format === 'json'
    ? JSON.stringify(rows, null, 2)
    : [columns.join(','), ...rows.map(row => columns.map(column => csvCell(row[column])).join(','))].join('\r\n') + '\r\n';
  const type = format === 'json' ? 'application/json' : 'text/csv;charset=utf-8';
  return { blob: new Blob([contents], { type }), filename: `fruispect-${batch.batch_id}.${format}` };
}

function researchSummary(missing) {
  const provenance = 'Saved Research Artifact · Design preview';
  const base = { provenance, metrics_source: missing ? null : 'Preview held-out evaluation', manifest: null, training_versions: null };
  if (missing) return {
    ...base, models: [], stress: [], quality_by_fruit: [],
    unavailable: ['Held-out metrics, stress tests and saved timing artifacts are missing.'],
  };

  const models = MODEL_KEYS.map((model_key, i) => ({
    model_key,
    display_name: MODEL_NAMES[i],
    fruit_accuracy: ['0.982', '0.956', '0.977'][i],
    quality_accuracy: ['0.923', '0.901', '0.937'][i],
    joint_accuracy: ['0.908', '0.874', '0.921'][i],
    macro_precision: ['0.911', '0.877', '0.923'][i],
    macro_recall: ['0.905', '0.872', '0.920'][i],
    macro_f1: ['0.908', '0.874', '0.921'][i],
    benchmark_ms: [93.4, 46.2, 108.1][i],
    model_size_mb: [42.8, 5.9, 15.6][i],
    parameters: MODEL_PARAMETERS[i],
    seed: 42,
    best_epoch: [24, 28, 26][i],
  }));

  return {
    ...base, models,
    stress: models.flatMap((model, i) => [
      { model_key: model.model_key, condition: 'Low light', fruit_accuracy: [0.912, 0.896, 0.927][i], quality_accuracy: [0.849, 0.824, 0.872][i], joint_accuracy: [0.811, 0.794, 0.838][i], samples: 96 },
      { model_key: model.model_key, condition: 'Defocus blur', fruit_accuracy: [0.905, 0.872, 0.913][i], quality_accuracy: [0.831, 0.805, 0.855][i], joint_accuracy: [0.791, 0.765, 0.816][i], samples: 96 },
    ]),
    quality_by_fruit: models.flatMap((model, i) => FRUIT_CLASSES.map((fruit, j) => ({
      model_key: model.model_key, fruit, quality_accuracy: (0.956 - j * 0.011 + [0, -0.024, 0.012][i]).toFixed(3), samples: 120,
    }))),
    manifest: { experiment: 'Fruispect evaluation preview', dataset_split: 'Held-out Test', test_samples: 720, seed: 42 },
    training_versions: { python: '3.12.3', torch: '2.5.1', torchvision: '0.20.1' },
    unavailable: [],
  };
}

async function sampleFigureUrls() {
  const title = 'Held-out Test - joint accuracy';
  const note = 'Illustrative saved research fixture';
  const values = [90.8, 87.4, 92.1];
  const canvas = globalThis.document?.createElement('canvas');
  let png_url = null;
  if (canvas) {
    canvas.width = 720;
    canvas.height = 320;
    const context = canvas.getContext('2d');
    if (context) {
      context.fillStyle = '#fff';
      context.fillRect(0, 0, 720, 320);
      context.fillStyle = '#152e23';
      context.font = 'bold 25px sans-serif';
      context.fillText(title, 34, 42);
      context.font = '16px sans-serif';
      context.fillText(note, 34, 70);
      MODEL_NAMES.forEach((name, i) => {
        const top = 114 + i * 57;
        context.fillStyle = '#152e23';
        context.fillText(name, 34, top + 17);
        context.fillStyle = '#e9f1eb';
        context.fillRect(230, top, 370, 22);
        context.fillStyle = '#326b4c';
        context.fillRect(230, top, 3.7 * values[i], 22);
        context.fillText(`${values[i]}%`, 620, top + 17);
      });
      const png = await new Promise(resolve => canvas.toBlob(resolve, 'image/png'));
      if (png) png_url = URL.createObjectURL(png);
    }
  }

  // A single-page, dependency-free PDF using the same data as the PNG.
  const text = (size, x, y, value) => `BT /F1 ${size} Tf ${x} ${y} Td (${value}) Tj ET\n`;
  let commands = '0.08 0.18 0.14 rg\n' + text(24, 34, 278, title) + text(14, 34, 252, note);
  MODEL_NAMES.forEach((name, i) => {
    const y = 182 - i * 50;
    commands += '0.08 0.18 0.14 rg\n' + text(15, 34, y + 4, name) + text(15, 620, y + 4, `${values[i]}%`);
    commands += `0.91 0.95 0.92 rg 230 ${y} 370 20 re f\n0.20 0.42 0.30 rg 230 ${y} ${(3.7 * values[i]).toFixed(2)} 20 re f\n`;
  });
  const objects = [
    '<< /Type /Catalog /Pages 2 0 R >>',
    '<< /Type /Pages /Kids [3 0 R] /Count 1 >>',
    '<< /Type /Page /Parent 2 0 R /MediaBox [0 0 720 320] /Resources << /Font << /F1 4 0 R >> >> /Contents 5 0 R >>',
    '<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>',
    `<< /Length ${commands.length} >>\nstream\n${commands}endstream`,
  ];
  let pdf = '%PDF-1.4\n';
  const offsets = objects.map((object, i) => {
    const offset = pdf.length;
    pdf += `${i + 1} 0 obj\n${object}\nendobj\n`;
    return offset;
  });
  const xref = pdf.length;
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  pdf += offsets.map(offset => `${String(offset).padStart(10, '0')} 00000 n \n`).join('');
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xref}\n%%EOF\n`;
  return { png_url, pdf_url: URL.createObjectURL(new Blob([pdf], { type: 'application/pdf' })) };
}

let figureUrls;
async function researchFigures(missing) {
  if (!missing) figureUrls ??= sampleFigureUrls();
  const urls = missing ? null : await figureUrls;
  return {
    figures: [
      {
        title: 'Held-out joint accuracy',
        note: 'The percentage of held-out photos where both labels match the reference.',
        provenance: 'Saved Research Artifact · Design preview',
        png_url: urls?.png_url ?? null,
        pdf_url: urls?.pdf_url ?? null,
      },
      {
        title: 'Controlled stress test summary',
        note: 'The original saved figure is unavailable in this fixture.',
        provenance: 'Saved Research Artifact · Design preview',
        png_url: null, pdf_url: null,
      },
    ],
    unavailable: missing ? ['No saved research figure files are available.'] : ['Controlled stress test summary figure'],
  };
}

export function createPreviewService(scenario = 'partial') {
  if (!SCENARIOS.some(item => item.id === scenario)) scenario = 'partial';

  const batches = new Map();
  const images = new Map();
  const observers = new Map();
  const preparation = new Map();
  const running = new Map();
  const creationKeys = new Map();
  const foreignBatches = [];
  const localOperator = scenario !== 'pairing';
  const registry = ['READY', 'READY', 'READY'];
  if (scenario === 'degraded') registry.splice(0, 3, 'LOADING', 'OFFLINE', 'UNAVAILABLE');
  if (scenario === 'model-unavailable') registry[2] = 'UNAVAILABLE';

  let tick = EPOCH;
  let batchSequence = 0;
  let admissionSequence = 40;
  let eventSequence = 0;
  let paired = localOperator;
  let initialSeedHeld = true;
  let busy = scenario === 'backpressure' || scenario === 'storage-busy';
  let expiredAdvertised = false;
  let reconnectStarted = false;
  let removalTimer = null;
  let connectionTimer = null;
  let removingCollections = false;
  let connectionStatus = ({
    'phone-failed': 'failed',
    'phone-starting': 'starting',
    'phone-disabled': 'disabled',
  })[scenario] ?? 'ready';
  const storageReady = scenario !== 'service-unavailable';
  const now = () => (tick += 110);
  const imageMissing = () => previewError(404, 'NOT_FOUND', 'This photo is no longer available in this browser session.');
  const batchMissing = () => previewError(404, 'NOT_FOUND', 'This collection was deleted or expired.');

  function authorize() {
    if (!paired) throw previewError(401, 'PAIRING_REQUIRED', 'Enter the pairing code shown on the host.');
  }

  function operatorOnly() {
    authorize();
    if (!localOperator) throw previewError(403, 'FORBIDDEN', 'This control is only available on the host.');
  }

  function getBatch(id) {
    authorize();
    const batch = batches.get(id);
    if (!batch) throw batchMissing();
    if (scenario === 'expired' && id === SAMPLE_BATCH) {
      remove([batch], false);
      throw batchMissing();
    }
    return batch;
  }

  function getImage(id) {
    authorize();
    const image = images.get(id);
    if (!image) throw imageMissing();
    getBatch(image.batch_id);
    return image;
  }

  function emit(batch, eventType, image = null, job = null, payload = {}) {
    if (!batch) return;
    const event = {
      event_id: ++eventSequence,
      batch_id: batch.batch_id,
      ...(image && { image_id: image.image_id }),
      ...(job && { model_key: job.model_key }),
      event_type: eventType,
      version: job?.version ?? 1,
      created_at: iso(now()),
      payload,
    };
    batch.events.push(event);
    for (const watcher of observers.get(batch.batch_id) ?? []) watcher.update();
  }

  function newBatch(createdAt = now()) {
    const batch = {
      batch_id: `batch-preview-${padId(++batchSequence)}`,
      created_at: iso(createdAt),
      cancelled_at: null,
      photos: [],
      rejections: new Set(),
      admissions: new Map(),
      uploading: 0,
      deleting: false,
      events: [],
    };
    batches.set(batch.batch_id, batch);
    emit(batch, 'batch_created');
    return batch;
  }

  function newImage(batch, filename, meta, received = now()) {
    const seq = ++admissionSequence;
    const imageId = `image-preview-${padId(seq - 40)}`;
    const image = {
      image_id: imageId,
      batch_id: batch.batch_id,
      admission_seq: seq,
      original_filename: filename,
      width: null,
      height: null,
      received_at: iso(received),
      retention_expires_at: iso(received + RETENTION_MS),
      input_status: 'PROCESSING',
      input_error: null,
      preprocess_ms: null,
      content_sha256: null,
      preprocessing_sha256: PREPROCESSING_HASH,
      thumbnail_url: null,
      terminal: false,
      consensus: null,
      jobs: Object.fromEntries(MODEL_KEYS.map((model_key, index) => [model_key, {
        job_id: `job-preview-${padId(seq - 40)}-${index + 1}`,
        image_id: imageId,
        model_key,
        admission_seq: seq,
        status: 'WAITING_FOR_INPUT',
        version: 1,
        attempt_count: 0,
        cancel_requested: false,
        queued_at: null,
        started_at: null,
        completed_at: null,
        available_at: null,
        queue_wait_ms: null,
        inference_ms: null,
        model_checkpoint_sha256: CHECKPOINT_HASHES[index],
        error_code: null,
        error_message: null,
        result: null,
      }])),
      ...meta,
    };
    updateConsensus(image);
    batch.photos.push(image);
    images.set(imageId, image);
    emit(batch, 'image_admitted', image, null, { input_status: image.input_status, admission_seq: seq });
    return image;
  }

  function setInput(image, status, message = null) {
    image.input_status = status;
    image.input_error = message;
    image.preprocess_ms = status === 'READY' ? 35 + (image.admission_seq % 5) * 4 : null;
    emit(batches.get(image.batch_id), 'input_updated', image, null, { input_status: status, input_error: message });
  }

  function setJob(image, index, status, at = now()) {
    const job = image.jobs[MODEL_KEYS[index]];
    const received = Date.parse(image.received_at);
    job.status = status;
    job.version += 1;
    if (status === 'QUEUED') {
      job.queued_at = iso(at);
      job.available_at = seconds(at);
    }
    if (status === 'RUNNING') {
      job.started_at = iso(at);
      job.queue_wait_ms = Math.max(0, at - Date.parse(job.queued_at ?? image.received_at));
      job.attempt_count += 1;
    }
    if (isTerminal(status)) {
      job.completed_at = iso(at);
      job.cancel_requested = false;
    }
    if (status === 'COMPLETED') {
      job.inference_ms = INFERENCE_MS[index] + image.admission_seq % 7;
      job.result = makeResult(image, job, index, scenario, at - received);
    }
    if (status === 'FAILED') {
      job.error_code = image.input_status === 'FAILED' ? 'PREPROCESSING_FAILED' : 'INFERENCE_FAILED';
      job.error_message = image.input_error ?? 'The worker could not finish this check.';
    }
    if (status === 'UNAVAILABLE') {
      job.error_code = 'MODEL_UNAVAILABLE';
      job.error_message = 'The model worker is unavailable.';
    }
    updateConsensus(image);
    emit(batches.get(image.batch_id), 'job_updated', image, job, {
      status: job.status,
      cancel_requested: job.cancel_requested,
    });
  }

  function requestRunningCancellation(image, job) {
    if (job.cancel_requested) return false;
    job.cancel_requested = true;
    job.version += 1;
    emit(batches.get(image.batch_id), 'job_updated', image, job, { status: job.status, cancel_requested: true });
    const index = MODEL_KEYS.indexOf(job.model_key);
    if (!running.has(index)) finishRunning(index, image, WORK_MS[index]);
    return true;
  }

  function clearPreparation(id) {
    clearTimeout(preparation.get(id));
    preparation.delete(id);
  }

  function prepare(image) {
    if (image.input_status !== 'PROCESSING' || preparation.has(image.image_id) || image.terminal) return;
    const timer = scheduled(() => {
      preparation.delete(image.image_id);
      if (!images.has(image.image_id) || image.terminal) return;
      const failed = scenario === 'preprocess-failed';
      setInput(image, failed ? 'FAILED' : 'READY', failed ? 'The accepted photo could not be prepared for the models.' : null);
      MODEL_KEYS.forEach((key, index) => {
        if (image.jobs[key].status !== 'WAITING_FOR_INPUT') return;
        const state = failed ? 'FAILED' : ['OFFLINE', 'UNAVAILABLE'].includes(registry[index]) ? 'UNAVAILABLE' : 'QUEUED';
        setJob(image, index, state);
      });
      // Leave a brief admission-to-dispatch interval for the queued snapshot.
      scheduled(() => MODEL_KEYS.forEach((_, index) => startLane(index)), 340);
    }, 260);
    preparation.set(image.image_id, timer);
  }

  function laneImages(index, state) {
    return [...images.values()].filter(image => image.jobs[MODEL_KEYS[index]].status === state);
  }

  function finishRunning(index, image, ms) {
    const job = image.jobs[MODEL_KEYS[index]];
    const timer = scheduled(() => {
      running.delete(index);
      if (images.has(image.image_id) && job.status === 'RUNNING') {
        const finishedAt = Math.max(tick, Date.parse(job.started_at) + INFERENCE_MS[index] + image.admission_seq % 7);
        tick = finishedAt;
        setJob(image, index, job.cancel_requested ? 'CANCELLED' : 'COMPLETED', finishedAt);
      }
      if (!initialSeedHeld) startLane(index);
    }, ms);
    running.set(index, { timer, imageId: image.image_id });
  }

  function startLane(index) {
    if (initialSeedHeld || registry[index] !== 'READY' || running.has(index)) return;
    const active = laneImages(index, 'RUNNING')[0];
    if (active) {
      finishRunning(index, active, WORK_MS[index]);
      return;
    }
    const key = MODEL_KEYS[index];
    const next = [...images.values()].find(image => ['WAITING_FOR_INPUT', 'QUEUED'].includes(image.jobs[key].status));
    if (!next || next.jobs[key].status !== 'QUEUED') return;
    setJob(next, index, 'RUNNING');
    finishRunning(index, next, WORK_MS[index]);
  }

  function releaseSeed() {
    if (!initialSeedHeld) return;
    initialSeedHeld = false;
    for (const image of images.values()) prepare(image);
    MODEL_KEYS.forEach((_, index) => startLane(index));
  }

  function seedPhoto(batch, filename, statuses, received = EPOCH - 8_200) {
    const image = newImage(batch, filename, {
      width: 820,
      height: 820,
      thumbnail_url: SAMPLE_PHOTO,
      content_sha256: '8a8893ce3391d0a869fa3753d32171da64ca4e1129c6fe3ae686b7398b6396d6',
    }, received);
    if (statuses === PREPARING) return image;
    const failed = scenario === 'preprocess-failed';
    setInput(image, failed ? 'FAILED' : 'READY', failed ? 'The accepted photo could not be prepared for the models.' : null);
    statuses.forEach((status, index) => {
      if (!failed && status !== 'UNAVAILABLE') setJob(image, index, 'QUEUED', received + 25);
      if (['COMPLETED', 'FAILED', 'RUNNING'].includes(status) && !failed) {
        const delay = status === 'RUNNING' ? 4350 + index * 110 : 260 + index * 200;
        setJob(image, index, 'RUNNING', received + delay);
      }
      if (isTerminal(status)) {
        const started = Date.parse(image.jobs[MODEL_KEYS[index]].started_at ?? image.received_at);
        setJob(image, index, status, started + INFERENCE_MS[index] + image.admission_seq % 7);
      }
    });
    if (scenario === 'cancelling') {
      const job = image.jobs[MODEL_KEYS[1]];
      job.cancel_requested = true;
      job.version += 1;
      emit(batch, 'job_updated', image, job, { status: job.status, cancel_requested: true });
    }
    return image;
  }

  function eventPage(batch, after = 0) {
    const cursor = Math.max(0, Number(after) || 0);
    const start = batch.events.findIndex(event => event.event_id > cursor);
    const events = start < 0 ? [] : batch.events.slice(start, start + 200);
    return { events: copy(events), cursor: events.at(-1)?.event_id ?? cursor };
  }

  function remove(targets, includeForeign = false) {
    const photos = targets.flatMap(batch => batch.photos);
    for (const batch of targets) batches.delete(batch.batch_id);
    for (const image of photos) {
      clearPreparation(image.image_id);
      images.delete(image.image_id);
    }
    for (const [index, active] of running) {
      if (images.has(active.imageId)) continue;
      clearTimeout(active.timer);
      running.delete(index);
    }
    for (const batch of targets) {
      for (const watcher of observers.get(batch.batch_id) ?? []) watcher.remove();
    }
    if (!initialSeedHeld) MODEL_KEYS.forEach((_, index) => startLane(index));
    const foreignPhotos = includeForeign ? foreignBatches.reduce((sum, row) => sum + row.summary.accepted, 0) : 0;
    const foreignCount = includeForeign ? foreignBatches.length : 0;
    if (includeForeign) foreignBatches.length = 0;
    return {
      deleted: {
        collections: targets.length + foreignCount,
        photos: photos.length + foreignPhotos,
        cleanup_pending: scenario === 'cleanup-pending' && photos.length > 0,
      },
    };
  }

  async function deleteTargets(targets, includeForeign = false) {
    if (targets.some(batch => batch.uploading || batch.deleting)) {
      throw previewError(409, 'COLLECTION_BUSY', 'Wait for the upload or deletion to finish, then try again.');
    }
    targets.forEach(batch => { batch.deleting = true; });
    await wait(180);
    return remove(targets.filter(batch => batches.has(batch.batch_id)), includeForeign);
  }

  async function deleteAll(includeForeign = false) {
    if (removingCollections) throw previewError(409, 'COLLECTION_BUSY', 'Collections are already being deleted.');
    removingCollections = true;
    try {
      return await deleteTargets([...batches.values()], includeForeign);
    } finally {
      removingCollections = false;
    }
  }

  function cancel(image) {
    let affected = 0;
    imageJobs(image).forEach((job, index) => {
      if (job.status === 'RUNNING') {
        affected += Number(requestRunningCancellation(image, job));
      } else if (!isTerminal(job.status)) {
        setJob(image, index, 'CANCELLED');
        affected += 1;
      }
    });
    if (image.terminal) clearPreparation(image.image_id);
    if (!initialSeedHeld) MODEL_KEYS.forEach((_, index) => startLane(index));
    return affected;
  }

  if (!EMPTY_SCENARIOS.has(scenario)) {
    const batch = newBatch(EPOCH - 9_000);
    if (['active-queues', 'idle-queues'].includes(scenario)) {
      seedPhoto(batch, 'orchard-apple-north.jpg', ALL_COMPLETE, EPOCH - 83_000);
      seedPhoto(batch, 'orchard-apple-south.jpg', ALL_COMPLETE, EPOCH - 46_000);
    }
    seedPhoto(batch, 'orchard-apple.jpg', SCENARIO_JOBS[scenario] ?? ALL_COMPLETE);
    if (scenario === 'active-queues') {
      seedPhoto(batch, 'orchard-apple-closeup.jpg', QUEUED, EPOCH - 3_000);
      seedPhoto(batch, 'orchard-apple-side.jpg', QUEUED, EPOCH - 2_000);
    }
    if (scenario === 'mixed-upload') batch.rejections.add('seed:1');
    if (scenario === 'backpressure') {
      batch.rejections.add('seed:busy');
      for (let i = 0; i < 22; i += 1) {
        seedPhoto(batch, `orchard-apple-${padId(i + 2)}.jpg`, QUEUED, EPOCH - 3_000 + i * 110);
      }
    }
    if (scenario === 'all-requests') {
      for (const [i, accepted] of [3, 2].entries()) {
        foreignBatches.push({
          batch_id: `batch-preview-remote-${i + 1}`,
          browser_session: `Preview browser ${i + 2}`,
          created_at: iso(EPOCH - (i + 1) * 62_000),
          cancelled_at: null,
          status: i ? 'ACTIVE' : 'COMPLETED',
          event_cursor: 0,
          summary: { accepted, rejected: 0, total_submitted: accepted, preprocessing: 0, fully_complete: i ? 1 : accepted, partial: i ? 1 : 0, failed: 0, cancelled: 0, queued: i ? 1 : 0, running: i ? 1 : 0 },
        });
      }
    }
  }

  function laneSnapshot(index) {
    const modelKey = MODEL_KEYS[index];
    const counts = Object.fromEntries(JOB_STATES.map(state => [state, 0]));
    const jobs = [...images.values()].map(image => image.jobs[modelKey]);
    for (const job of jobs) counts[job.status] += 1;
    const active = jobs.find(job => job.status === 'RUNNING');
    const next = jobs.filter(job => job.status === 'QUEUED');
    const recent = jobs.filter(job => job.status === 'COMPLETED' && job.inference_ms !== null)
      .sort((a, b) => Date.parse(b.completed_at) - Date.parse(a.completed_at)).slice(0, 100);
    const times = recent.map(job => job.inference_ms).sort((a, b) => a - b);
    const span = recent.length ? Date.parse(recent[0].completed_at) - Math.min(...recent.map(job => Date.parse(job.started_at))) : 0;
    const state = registry[index];
    return {
      model_key: modelKey,
      display_name: MODEL_NAMES[index],
      state,
      device: state === 'OFFLINE' ? null : 'cpu',
      checkpoint_sha256: state === 'UNAVAILABLE' ? null : CHECKPOINT_HASHES[index],
      preprocessing_sha256: PREPROCESSING_HASH,
      validated_at: state === 'READY' ? seconds(EPOCH - 46_000) : null,
      last_error: state === 'OFFLINE' ? 'Worker process is offline.' : state === 'UNAVAILABLE' ? 'The model checkpoint could not be loaded.' : null,
      metadata: { architecture: MODEL_NAMES[index], parameters: MODEL_PARAMETERS[index] },
      counts,
      queue_depth: next.length,
      active: active ? { image_id: active.image_id, admission_seq: active.admission_seq, started_at: seconds(Date.parse(active.started_at)) } : null,
      active_duration_ms: active ? tick - Date.parse(active.started_at) : null,
      up_next: next.slice(0, 8).map(({ image_id, admission_seq, status }) => ({ image_id, admission_seq, status })),
      statistics_window: times.length,
      mean_inference_ms: times.length ? times.reduce((sum, value) => sum + value, 0) / times.length : null,
      p95_inference_ms: times.length ? times[Math.ceil(times.length * 0.95) - 1] : null,
      throughput_model_jobs_s: recent.length > 1 && span > 0 ? recent.length * 1000 / span : null,
    };
  }

  function connectionSnapshot() {
    const link = connectionStatus === 'ready' ? localPhoneLink() : null;
    const publicUrl = link?.href ?? null;
    if (link) link.hash = 'connect=' + SAMPLE_PAIR_CODE;
    const messages = {
      ready: paired ? 'The preview phone link is ready.' : 'Pair this browser to the host to continue.',
      starting: 'The phone link is starting. Local scans are available.',
      disabled: 'Phone access is disabled. Local scans are available.',
      failed: 'The phone link failed to start. Local scans are available.',
    };
    return {
      status: connectionStatus,
      message: messages[connectionStatus],
      public_url: publicUrl,
      error_code: connectionStatus === 'failed' ? 'TUNNEL_START_FAILED' : null,
      requires_pairing: !paired,
      local_operator: localOperator,
      ...(localOperator && publicUrl && {
        pair_code: SAMPLE_PAIR_CODE,
        connect_url: link.href,
      }),
    };
  }

  function connectionReadyLater() {
    clearTimeout(connectionTimer);
    connectionTimer = scheduled(() => { connectionStatus = 'ready'; }, 1_100);
  }

  if (scenario === 'phone-starting') connectionReadyLater();

  function validKey(key, required = false) {
    if (key == null && !required) return;
    if (typeof key !== 'string' || !key.trim() || key.length > 180) {
      throw new ApiError('An idempotency key must contain between 1 and 180 characters.', { code: 'INVALID_IDEMPOTENCY_KEY' });
    }
  }

  async function admit(batch, files, offset, identity) {
    await wait(scenario === 'uploading' ? 1_350 : 360);
    const accepted = [];
    const rejected = [];
    const reject = (index, file, status, code, message) => {
      batch.rejections.add(`${identity}:${index}`);
      rejected.push({ file_index: index, filename: file?.name ?? 'Unknown file', code, message, http_status: status });
    };

    const overloaded = busy;
    if (busy) busy = false;
    const mixedRejectionIndex = batch.batch_id === SAMPLE_BATCH ? 3 : 1;
    for (const [index, file] of files.entries()) {
      const fileIndex = offset + index;
      if (batch.cancelled_at) reject(fileIndex, file, 409, 'BATCH_CANCELLED', 'This collection was cancelled. Start a new collection to add photos.');
      else if (!storageReady) reject(fileIndex, file, 503, 'SERVICE_UNAVAILABLE', 'The storage service is temporarily unavailable.');
      else if (overloaded && scenario === 'backpressure') reject(fileIndex, file, 429, 'QUEUE_FULL', 'The model queues are full. Try this file again shortly.');
      else if (overloaded) reject(fileIndex, file, 503, 'STORAGE_BUSY', 'Scan storage is busy. Try this file again shortly.');
      else if (batch.photos.length >= MAX_IMAGES) reject(fileIndex, file, 409, 'BATCH_FULL', 'This collection already has 1,000 accepted photos.');
      else if (scenario === 'mixed-upload' && fileIndex === mixedRejectionIndex) reject(fileIndex, file, 422, 'INVALID_IMAGE', 'This file could not be decoded as a still photo.');
      else {
        let meta;
        try {
          meta = await inspectPhoto(file);
        } catch (error) {
          reject(fileIndex, file, error.status ?? 422, error.code ?? 'INVALID_IMAGE', error.message);
          continue;
        }
        if (batch.cancelled_at || batch.deleting || !batches.has(batch.batch_id)) {
          reject(fileIndex, file, 409, 'COLLECTION_BUSY', 'The collection changed during upload. Refresh before trying again.');
          continue;
        }
        if (batch.photos.length >= MAX_IMAGES) {
          reject(fileIndex, file, 409, 'BATCH_FULL', 'This collection already has 1,000 accepted photos.');
          continue;
        }
        const image = newImage(batch, file.name || 'untitled-photo', meta);
        accepted.push({ file_index: fileIndex, image_id: image.image_id, admission_seq: image.admission_seq });
        releaseSeed();
        prepare(image);
      }
    }

    if (rejected.length) emit(batch, 'admission_rejected', null, null, { rejected: rejected.length });
    return admissionEnvelope(accepted, rejected);
  }

  function watch(id, { cursor = 0, onEvents, onRemoved, onStatus, onRecover } = {}) {
    const controller = new AbortController();
    const { signal } = controller;
    const watchers = observers.get(id) ?? new Set();
    observers.set(id, watchers);
    let after = Math.max(0, Number(cursor) || 0);
    let queued = false;
    let canDeliver = true;
    const timers = new Set();

    const later = (callback, delay) => {
      const timer = scheduled(() => {
        timers.delete(timer);
        if (!signal.aborted) callback();
      }, delay);
      timers.add(timer);
    };

    function cleanup() {
      if (signal.aborted) return;
      controller.abort();
      for (const timer of timers) clearTimeout(timer);
      timers.clear();
      watchers.delete(observer);
      if (watchers.size === 0) observers.delete(id);
    }

    function removed() {
      if (signal.aborted) return;
      cleanup();
      onStatus?.('removed');
      onRemoved?.(id);
    }

    function update() {
      if (signal.aborted || queued || !canDeliver) return;
      queued = true;
      queueMicrotask(() => {
        queued = false;
        if (signal.aborted) return;
        const batch = batches.get(id);
        if (!batch) return removed();
        const page = eventPage(batch, after);
        if (page.cursor > after) {
          after = page.cursor;
          onEvents?.(page.events, after);
          if (page.events.length === 200) update();
        }
      });
    }

    const recover = async status => {
      try {
        await onRecover?.({ cursor: after, signal });
      } catch (error) {
        if (!signal.aborted) onStatus?.(status, error);
      }
    };

    const observer = { update, remove: removed };
    watchers.add(observer);
    queueMicrotask(() => {
      if (signal.aborted) return;
      if (!paired) {
        onStatus?.('unavailable', previewError(401, 'PAIRING_REQUIRED', 'Enter the pairing code shown on the host.'));
        return;
      }
      if (!batches.has(id) || (scenario === 'expired' && id === SAMPLE_BATCH)) return removed();
      if (scenario === 'reconnecting' && !reconnectStarted) {
        reconnectStarted = true;
        canDeliver = false;
        onStatus?.('reconnecting');
        later(() => {
          canDeliver = true;
          onStatus?.('polling');
          update();
          void recover('polling');
        }, 1_200);
        later(() => {
          onStatus?.('live');
          void recover('live');
        }, 2_800);
      } else if (scenario === 'service-unavailable') {
        onStatus?.('unavailable', previewError(503, 'SERVICE_UNAVAILABLE', 'Scan storage is temporarily unavailable.'));
        update();
      } else {
        onStatus?.('live');
        update();
      }
      if (scenario === 'cancelling' && id === SAMPLE_BATCH) {
        const index = 1;
        const active = laneImages(index, 'RUNNING').find(image => image.batch_id === id && image.jobs[MODEL_KEYS[index]].cancel_requested);
        if (active && !running.has(index)) finishRunning(index, active, 2_500);
      }
      if (scenario === 'deleted' && id === SAMPLE_BATCH && removalTimer === null) {
        removalTimer = scheduled(() => {
          const batch = batches.get(id);
          if (batch) remove([batch]);
        }, 2_300);
      }
    });
    return cleanup;
  }

  return {
    async connection() {
      return connectionSnapshot();
    },
    async connect(code) {
      if (!localOperator && String(code).trim() !== SAMPLE_PAIR_CODE) {
        throw previewError(403, 'INVALID_PAIR_CODE', `Enter ${SAMPLE_PAIR_CODE} to pair in design preview.`);
      }
      paired = true;
      return { paired: true };
    },
    async health() {
      return { status: 'ok', time: iso(tick) };
    },
    async readiness() {
      authorize();
      return {
        ready: storageReady && registry.every(state => state === 'READY'),
        storage_ready: storageReady,
        device: 'cpu',
        models: MODEL_KEYS.map((model_key, index) => ({ model_key, state: registry[index], device: registry[index] === 'OFFLINE' ? null : 'cpu' })),
      };
    },
    async queues() {
      authorize();
      return { lanes: MODEL_KEYS.map((_, index) => laneSnapshot(index)), provenance: PREVIEW_PROVENANCE };
    },
    async createBatch(key) {
      authorize();
      validKey(key);
      if (removingCollections) throw previewError(409, 'COLLECTION_BUSY', 'Wait for deletion to finish before creating a collection.');
      if (key != null && creationKeys.has(key)) return batchSnapshot(getBatch(creationKeys.get(key)));
      const batch = newBatch();
      if (key != null) creationKeys.set(key, batch.batch_id);
      return batchSnapshot(batch);
    },
    async batches() {
      authorize();
      if (scenario === 'expired' && expiredAdvertised && batches.has(SAMPLE_BATCH)) remove([batches.get(SAMPLE_BATCH)]);
      expiredAdvertised = true;
      return [...batches.values()].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)).slice(0, 30).map(batchSnapshot);
    },
    async batch(id) {
      return batchSnapshot(getBatch(id));
    },
    async addImages(id, files, offset = 0, key) {
      const batch = getBatch(id);
      const chunk = Array.from(files ?? []);
      validKey(key, true);
      if (chunk.length < 1 || chunk.length > 4) throw new ApiError('Upload between one and four files per request.', { code: 'INVALID_CHUNK_SIZE' });
      if (!Number.isSafeInteger(offset) || offset < 0) throw previewError(422, 'INVALID_OFFSET', 'Use a nonnegative file offset.');
      const identity = `${key}\0${offset}`;
      const previous = batch.admissions.get(identity);
      if (previous) {
        const admission = copy(await previous);
        admission.accepted.forEach(file => { file.duplicate = true; });
        return admission;
      }
      if (batch.cancelled_at) throw previewError(409, 'BATCH_CANCELLED', 'This collection was cancelled. Start a new collection to add photos.');
      if (batch.deleting) throw previewError(409, 'COLLECTION_BUSY', 'This collection is being deleted.');
      batch.uploading += 1;
      const pending = admit(batch, chunk, offset, identity);
      batch.admissions.set(identity, pending);
      try {
        const admission = await pending;
        if (!admission.accepted.length && admission.retryAfterMs) batch.admissions.delete(identity);
        return copy(admission);
      } catch (error) {
        batch.admissions.delete(identity);
        throw error;
      } finally {
        batch.uploading -= 1;
      }
    },
    async images(id, query = {}) {
      const batch = getBatch(id);
      const page = Math.max(1, Math.trunc(Number(query.page)) || 1);
      const limit = Math.min(50, Math.max(1, Math.trunc(Number(query.limit)) || 20));
      const direction = query.sort === 'oldest' ? 1 : -1;
      const matches = batch.photos.filter(image => matchesImage(image, query))
        .sort((a, b) => direction * (a.admission_seq - b.admission_seq));
      return { images: copy(matches.slice((page - 1) * limit, page * limit)), page, limit, total: matches.length };
    },
    async image(id) {
      return copy(getImage(id));
    },
    async events(id, cursor = 0) {
      return eventPage(getBatch(id), cursor);
    },
    async cancelImage(id) {
      return { cancelled_or_requested: cancel(getImage(id)) };
    },
    async cancelBatch(id) {
      const batch = getBatch(id);
      if (!batch.cancelled_at) {
        batch.cancelled_at = iso(now());
        emit(batch, 'batch_cancelled');
      }
      return { cancelled_or_requested: batch.photos.reduce((total, image) => total + cancel(image), 0) };
    },
    async deleteBatch(id) {
      return deleteTargets([getBatch(id)]);
    },
    async deleteCollections() {
      authorize();
      return deleteAll();
    },
    async settings() {
      authorize();
      return {
        collections: batches.size,
        photos: images.size,
        local_operator: localOperator,
        all_collections: localOperator ? batches.size + foreignBatches.length : null,
        all_photos: localOperator ? images.size + foreignBatches.reduce((sum, row) => sum + row.summary.accepted, 0) : null,
      };
    },
    async reset(confirmation) {
      operatorOnly();
      if (confirmation !== 'RESET') throw previewError(422, 'INVALID_CONFIRMATION', 'Type RESET to clear scan data.');
      return deleteAll(true);
    },
    async retryConnection() {
      operatorOnly();
      if (connectionStatus !== 'disabled') {
        connectionStatus = 'starting';
        connectionReadyLater();
      }
      return { retry_requested: true };
    },
    async research() {
      authorize();
      return researchSummary(scenario === 'missing-research');
    },
    async figures() {
      authorize();
      return researchFigures(scenario === 'missing-research');
    },
    async exportFile(id, format = 'csv') {
      return makeExport(getBatch(id), format);
    },
    async allRequests() {
      authorize();
      if (scenario !== 'all-requests') {
        return {
          available: false,
          code: 'NOT_IMPLEMENTED',
          message: 'All requests needs a protected backend API for cross-browser collections.',
        };
      }
      const requests = [
        ...[...batches.values()].map(batch => ({ ...batchSnapshot(batch), browser_session: 'Preview browser 1' })),
        ...copy(foreignBatches),
      ].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at));
      return { available: true, implemented: false, preview: true, requests };
    },
    watch,
  };
}
