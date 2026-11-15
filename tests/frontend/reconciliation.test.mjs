// Verify reconciliation behavior.
import assert from 'node:assert/strict';
import test from 'node:test';
import { MODELS } from '../../frontend/assets/api/contracts.js';
import { collectUpdates, mergeImage } from '../../frontend/assets/state/requests.js';

// Image.
function image(id, version, status = 'RUNNING') {
  return {
    image_id: id, batch_id: 'batch', input_status: 'READY',
    jobs: Object.fromEntries(MODELS.map(({ key }) => [key, {
            job_id: `${id}-${key}`, version, status,
            result: status === 'COMPLETED' ? { predicted_fruit: 'Apple', predicted_quality: 'Good' } : null,
          }])),
  };
}

test('event replay orders unique updates and excludes other collections', () => {
    const result = collectUpdates([
        { event_id: 9, batch_id: 'batch' }, { event_id: 7, batch_id: 'batch' },
        { event_id: 9, batch_id: 'batch' }, { event_id: 8, batch_id: 'other' },
        { event_id: 6, batch_id: 'batch' },
      ], 6, 'batch');
    assert.deepEqual(result.events.map(event => event.event_id), [7, 9]);
    assert.equal(result.cursor, 9);
  });

test('late snapshots retain newer results and recompute complete agreement', () => {
    const completed = { ...image('one', 3, 'COMPLETED'), terminal: true };
    const merged = mergeImage(completed, image('one', 2));
    assert.equal(merged.jobs.resnet18.version, 3);
    assert.equal(merged.terminal, true);
    assert.equal(merged.consensus.scope, 'complete');
    assert.equal(merged.consensus.fruit_disagreement, false);
    assert.equal(mergeImage(completed, image('two', 1)).image_id, 'two');
  });
