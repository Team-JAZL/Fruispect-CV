// Verify gallery scopes, source reporting, and asynchronous collection isolation.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createLiveService } from '../../frontend/assets/api/live.js';
import { createCollectionState, createWorkspaceState } from '../../frontend/assets/workspace/state.js';
import { collectionLayout } from '../../frontend/assets/workspace/layout.js';
import { installCollectionRender } from '../../frontend/assets/workspace/collection-render.js';
import { installCollections } from '../../frontend/assets/workspace/collections.js';
import { installWatch } from '../../frontend/assets/workspace/watch.js';
import { sourceDetails } from '../../frontend/assets/workspace/device.js';

test('global service scopes all collection operations and preserves the personal API', async () => {
  const requests = [];
  const service = createLiveService({ globalCollections: true, fetch: async (path, options) => {
    requests.push({ path, ...options });
    return Response.json({ batches: [], batch: {}, image: {}, images: [], events: [] });
  } });
  await service.batches();
  await service.batch('a/b');
  await service.images('a/b', { page: 2, search: 'fruit' });
  await service.image('photo/a');
  await service.events('a/b', 5);
  await service.cancelImage('photo/a');
  await service.cancelBatch('a/b');
  await service.deleteBatch('a/b');
  await service.exportFile('a/b', 'json');
  assert.deepEqual(requests.map(row => row.path), [
    '/api/global/batches', '/api/global/batches/a%2Fb', '/api/global/batches/a%2Fb/images?page=2&search=fruit',
    '/api/global/images/photo%2Fa', '/api/global/batches/a%2Fb/events?after=5',
    '/api/global/images/photo%2Fa/cancel', '/api/global/batches/a%2Fb/cancel', '/api/global/batches/a%2Fb/delete',
    '/api/global/export/a%2Fb?format=json',
  ]);
  await service.deleteCollections();
  assert.equal(requests.at(-1).path, '/api/settings/reset');
  assert.deepEqual(JSON.parse(requests.at(-1).body), { confirmation: 'RESET' });
  const personal = createLiveService({ fetch: async path => { assert.equal(path, '/api/batches'); return Response.json({ batches: [] }); } });
  await personal.batches();
});

test('personal and global galleries have distinct accessible IDs and matching filters', () => {
  const personal = collectionLayout({ retentionHours: 24 });
  const global = collectionLayout({ retentionHours: 24, globalScope: true });
  const ids = [...(personal + global).matchAll(/\sid="([^"]+)"/g)].map(match => match[1]);
  assert.equal(new Set(ids).size, ids.length);
  assert.match(personal, /Your Collections/);
  assert.match(global, /Global Collections/);
  assert.doesNotMatch(global, /data-action="new-batch"/);
  for (const field of ['search', 'sort', 'fruit', 'quality', 'status', 'agreement']) {
    assert.ok(personal.includes(`name="${field}"`) && global.includes(`name="${field}"`));
  }
  for (const match of global.matchAll(/aria-(?:labelledby|describedby)="([^"]+)"/g)) assert.ok(ids.includes(match[1]));
});

test('host attribution escapes browser reports and states hardware identity limitations', () => {
  const markup = sourceDetails({ device_id: 'test', model: '<img src=x onerror=alert(1)>', user_agent: '<script>bad</script>', connection_type: 'tunnel' });
  assert.doesNotMatch(markup, /<script>|<img/);
  assert.match(markup, /&lt;img/);
  assert.match(markup, /Unavailable to web browsers/);
  assert.match(markup, /Unavailable through phone tunnel/);
  assert.match(markup, /do not verify a person or physical device/);
  assert.match(sourceDetails(null), /not recorded/);
});

test('device details render only in the host list and gallery selection stays isolated', () => {
  const previousDocument = globalThis.document;
  globalThis.document = { activeElement: {} };
  try {
    const personal = createWorkspaceState();
    const global = createCollectionState();
    personal.batchId = 'my-scan';
    personal.selectedId = 'my-photo';
    global.batchId = 'phone-scan';
    global.selectedId = 'phone-photo';
    global.cache.set('phone-photo', {});
    assert.equal(personal.cache.size, 0);
    assert.equal(personal.batchId, 'my-scan');
    assert.equal(personal.selectedId, 'my-photo');
    // Render shared rows with a minimal focus-preserving surface.
    function render(globalScope) {
      const slots = new Map();
      const $ = id => {
        if (!slots.has(id)) slots.set(id, { innerHTML: '', contains: () => false, querySelectorAll: () => [] });
        return slots.get(id);
      };
      const actions = {};
      const state = createCollectionState();
      state.list.images = [{ image_id: 'photo', original_filename: 'fruit.png', upload_source: { device_id: 'source-id', brand: 'Samsung' } }];
      installCollectionRender({ state, actions, $, form: {}, globalScope });
      actions.renderCollections();
      return $('collection-list').innerHTML;
    }
    assert.doesNotMatch(render(false), /source-id|Samsung/);
    assert.match(render(true), /Samsung.*Device source-id/);
  } finally { globalThis.document = previousDocument; }
});

test('late collection discovery cannot overwrite a newer result or resume suspended reads', async () => {
  const state = createCollectionState();
  state.ready = true;
  const pending = [];
  const actions = { renderCollections() {}, showError(error) { throw error; } };
  installCollections({ state, actions, service: { batches: () => new Promise(resolve => pending.push(resolve)) } });
  const first = actions.refreshBatches();
  const second = actions.refreshBatches();
  pending[1]([{ batch_id: 'latest' }]);
  await second;
  pending[0]([{ batch_id: 'stale' }]);
  await first;
  assert.equal(state.batches[0].batch_id, 'latest');
  const last = actions.refreshBatches();
  state.ready = false;
  pending[2]([{ batch_id: 'unauthorized' }]);
  await last;
  assert.equal(state.batches[0].batch_id, 'latest');
});

test('hidden galleries and the global tab do not start personal event subscriptions', () => {
  const state = createCollectionState();
  state.ready = true;
  let subscriptions = 0;
  const actions = {};
  installWatch({ state, actions, service: { watch() { subscriptions++; return () => {}; } } });
  for (const page of ['global', 'operator', 'inactive']) {
    state.page = page;
    actions.watchBatch('batch', 0);
  }
  assert.equal(subscriptions, 0);
  state.page = 'collections';
  actions.watchBatch('batch', 0);
  assert.equal(subscriptions, 1);
  actions.stopWatch();
});
