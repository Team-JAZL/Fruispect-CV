// Verify operator behavior.
import assert from 'node:assert/strict';
import test from 'node:test';
import { createOperatorState } from '../../frontend/assets/operator/state.js';
import { installReads } from '../../frontend/assets/operator/reads.js';
import { resource, createRequest } from '../../frontend/assets/operator/resources.js';
import { researchRow, researchModel } from '../../frontend/assets/operator/research.js';
import { score, number } from '../../frontend/assets/operator/format.js';
import { btn } from '../../frontend/assets/operator/components.js';
import { installEvents } from '../../frontend/assets/operator/events.js';

test('concurrent reads share a request and discard inactive responses', async () => {
    const state = createOperatorState(null);
    const actions = { scheduleRender() {} };
    installReads({ state, actions });
    let resolve;
    let requests = 0;
    let active = true;
    const target = resource();
    // Load.
    const load = () => { requests++; return new Promise(done => { resolve = done; }); };
    const first = actions.read(target, load, { active: () => active });
    const second = actions.read(target, load);
    assert.equal(first, second);
    await Promise.resolve();
    active = false;
    resolve({ result: 'obsolete' });
    await first;
    assert.equal(requests, 1);
    assert.equal(target.data, null);
    assert.equal(target.loading, false);
    assert.equal(createRequest('batch').query.sort, 'newest');
  });

test('icon-led controls retain descriptive accessible names and export formats', () => {
    const refresh = btn('Refresh queues', 'refresh');
    assert.match(refresh, /aria-label="Refresh queues"/);
    assert.match(refresh, /title="Refresh queues"/);
    assert.match(refresh, /<svg/);
    assert.match(refresh, /class="sr-only"/);
    const csv = btn('Export CSV', 'export', { id: 'csv', shortLabel: 'CSV' });
    assert.match(csv, /aria-label="Export CSV"/);
    assert.match(csv, /<span>CSV<\/span>/);
    assert.doesNotMatch(btn('Reset all scans', 'reset'), /class="sr-only"/);
  });

test('operator tab keyboard navigation wraps and supports Home and End', () => {
    let selected;
    let focused;
    let prevented = 0;
    const tabs = ['overview', 'requests', 'queues', 'research', 'settings'].map(id => ({ dataset: { id }, focus() { focused = id; } }));
    const actions = { chooseTab(id) { selected = id; } };
    installEvents({ root: {}, state: {}, actions, tabs });
    for (const [index, key, expected] of [[0, 'ArrowLeft', 'settings'], [4, 'ArrowRight', 'overview'], [2, 'Home', 'overview'], [1, 'End', 'settings']]) {
      actions.onKeydown({ target: { closest: () => tabs[index] }, key, preventDefault() { prevented++; } });
      assert.equal(selected, expected);
      assert.equal(focused, expected);
    }
    assert.equal(prevented, 4);
  });

test('research uses current CSV names and keeps measured zero visible', () => {
    const row = { model: 'ResNet-18', fruit_accuracy: '0.99', quality_accuracy: '0', joint_accuracy: '0.98' };
    assert.equal(researchRow([row], 'resnet18'), row);
    const rendered = researchModel({ key: 'resnet18', name: 'ResNet-18' }, row);
    assert.match(rendered, /99%/);
    assert.match(rendered, />0%</);
    assert.equal(score(null), 'Not available');
    assert.equal(number(''), null);
  });
