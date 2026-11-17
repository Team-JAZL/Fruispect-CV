// Verify workspace behavior.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceState } from '../../frontend/assets/workspace/state.js';
import { installCollections } from '../../frontend/assets/workspace/collections.js';
import { installUpload } from '../../frontend/assets/workspace/upload.js';
import { installCamera } from '../../frontend/assets/workspace/camera.js';
import { installReview } from '../../frontend/assets/workspace/review.js';
import { confidenceBar } from '../../frontend/assets/workspace/components.js';

// Workspace.
function workspace(service = {}) {
  const state = createWorkspaceState();
  const actions = {
    // Render results from the current application state.
    renderResults() {}, renderCollections() {}, renderIntakeState() {}, stopWatch() {},
    // Show error.
    showError(error) { throw error; }, watchBatch() {},
  };
  const context = { state, actions, service, onPairing() {} };
  installCollections(context);
  return context;
}

test('new uploads select their results and late snapshots preserve selection', async () => {
    let sequence = 0;
    const context = workspace({
        createBatch: async () => ({ batch_id: 'batch', status: 'ACTIVE', summary: { total_submitted: 0 } }),
        addImages: async () => ({ accepted: [{ image_id: String(++sequence) }], rejected: [] }),
        image: async id => ({ image_id: id, batch_id: 'batch', jobs: {} }),
      });
    const { state, actions } = context;
    actions.chooseBatch = async () => {};
    actions.refreshBatches = async () => {};
    state.ready = true;
    installUpload(context);
    for (const name of ['first.png', 'second.png']) {
      state.selected = [{ file: new File(['image'], name), key: name, status: 'selected' }];
      await actions.submit();
    }
    assert.equal(state.selectedId, '2');
    await actions.refreshImage('1');
    assert.equal(state.selectedId, '2');
    actions.forgetCollection('batch');
    assert.equal(state.batchId, null);
    assert.equal(state.selectedId, null);
    assert.equal(state.cache.size, 0);
  });

test('collection review preserves the scan selection and closing discards a late display', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = { activeElement: {} };
    let resolveImage;
    let focusRestored = false;
    const dialog = { open: false, addEventListener() {}, showModal() { this.open = true; }, close() { this.open = false; } };
    const content = { innerHTML: '', contains: () => false, querySelectorAll: () => [] };
    try {
      const context = workspace({ image: () => new Promise(resolve => { resolveImage = resolve; }) });
      context.$ = id => id === 'result-dialog' ? dialog : content;
      context.state.batchId = 'batch';
      context.state.selectedId = 'scan-photo';
      installReview(context);
      const pending = context.actions.openReview('review-photo', { isConnected: true, focus() { focusRestored = true; } });
      assert.equal(dialog.open, true);
      assert.equal(context.state.selectedId, 'scan-photo');
      assert.match(content.innerHTML, /Loading your results/);
      context.actions.closeReview();
      resolveImage({ image_id: 'review-photo', jobs: {}, original_filename: 'Review photo' });
      await pending;
      assert.equal(dialog.open, false);
      assert.equal(context.state.reviewId, null);
      assert.equal(context.state.selectedId, 'scan-photo');
      assert.equal(focusRestored, true);
      assert.doesNotMatch(content.innerHTML, /Review photo/);
    } finally { globalThis.document = previousDocument; }
  });

test('review failures stay in the dialog with a retry control', async () => {
    const previousDocument = globalThis.document;
    globalThis.document = { activeElement: {} };
    const dialog = { open: false, addEventListener() {}, showModal() { this.open = true; } };
    const content = { innerHTML: '', contains: () => false, querySelectorAll: () => [] };
    try {
      const context = workspace({ image: async () => { throw new Error('Photo unavailable'); } });
      context.$ = id => id === 'result-dialog' ? dialog : content;
      installReview(context);
      await context.actions.openReview('missing');
      assert.equal(dialog.open, true);
      assert.match(content.innerHTML, /Photo unavailable/);
      assert.match(content.innerHTML, /data-action="retry-review"/);
      assert.equal(context.state.reviewLoading, false);
    } finally { globalThis.document = previousDocument; }
  });

test('confidence bars keep zero scores and omit unavailable or invalid measurements', () => {
    assert.match(confidenceBar(0, 'Apple'), /value="0"/);
    assert.match(confidenceBar(.73, 'Apple'), /value="0.73"/);
    for (const score of [null, undefined, NaN, Infinity, -.1, 1.1, '0.5']) assert.equal(confidenceBar(score, 'Apple'), '');
  });

test('a camera capture completing after stop does not add a stale photo', async () => {
    const previousDocument = globalThis.document;
    let resolveBlob;
    let added = 0;
    globalThis.document = { hidden: false, createElement: () => ({
        getContext: () => ({ drawImage() {} }), toBlob(resolve) { resolveBlob = resolve; },
      }) };
    try {
      const context = workspace();
      const video = { videoWidth: 640, videoHeight: 480 };
      Object.assign(context, { $: id => id === 'camera-video' ? video : null, intake: { querySelector: () => ({}) }, limits: {}, maxPixels: 24000000 });
      context.state.cameraStream = { getTracks: () => [{ stop() {} }] };
      context.actions.addFiles = () => { added++; };
      installCamera(context);
      const pending = context.actions.capture();
      assert.equal(context.state.captureBusy, true);
      context.actions.stopCamera(false);
      resolveBlob(new Blob(['photo']));
      await pending;
      assert.equal(added, 0);
      assert.equal(context.state.captureBusy, false);
    } finally { globalThis.document = previousDocument; }
  });

test('a result from a previous collection is discarded', async () => {
    let resolve;
    const context = workspace({ image: () => new Promise(done => { resolve = done; }) });
    context.state.batchId = 'old';
    const pending = context.actions.refreshImage('old-image');
    context.state.batchId = 'new';
    resolve({ image_id: 'old-image', batch_id: 'old', jobs: {} });
    await pending;
    assert.equal(context.state.cache.size, 0);
  });

test('a camera stream arriving after stop releases every track', async () => {
    const previous = { window: globalThis.window, document: globalThis.document };
    let resolve;
    let stopped = 0;
    const media = Object.getOwnPropertyDescriptor(navigator, 'mediaDevices');
    Object.defineProperty(navigator, 'mediaDevices', { configurable: true, value: {
          getUserMedia: () => new Promise(done => { resolve = done; }),
        } });
    globalThis.window = { isSecureContext: true };
    globalThis.document = { hidden: false };
    try {
      const context = workspace();
      Object.assign(context, { $: () => null, intake: {}, limits: {}, maxPixels: 24000000 });
      installCamera(context);
      const pending = context.actions.startCamera();
      context.actions.stopCamera(false);
      resolve({ getTracks: () => [{ stop() { stopped++; } }] });
      await pending;
      assert.equal(stopped, 1);
      assert.equal(context.state.cameraStream, null);
    } finally {
      globalThis.window = previous.window;
      globalThis.document = previous.document;
      if (media) Object.defineProperty(navigator, 'mediaDevices', media);
      else delete navigator.mediaDevices;
    }
  });
