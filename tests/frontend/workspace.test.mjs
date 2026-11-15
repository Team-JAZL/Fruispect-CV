// Verify workspace behavior.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createWorkspaceState } from '../../frontend/assets/workspace/state.js';
import { installCollections } from '../../frontend/assets/workspace/collections.js';
import { installUpload } from '../../frontend/assets/workspace/upload.js';
import { installCamera } from '../../frontend/assets/workspace/camera.js';

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
