// Verify transport behavior.
import assert from 'node:assert/strict';
import test from 'node:test';
import { ApiError, parseRetryAfter, downloadName } from '../../frontend/assets/api/client.js';
import { createLiveService } from '../../frontend/assets/api/live.js';
import { readConfig } from '../../frontend/assets/api/config.js';

test('configuration validates numeric server limits', () => {
    const values = { 'max-file-bytes': '12345', 'max-decoded-pixels': '-5', 'max-chunk-files': '20', 'retention-hours': '0.5' };
    const config = readConfig({ querySelector: selector => ({
            getAttribute: () => values[selector.match(/fruispect-([^"\]]+)/)[1]],
          }) });
    assert.equal(config.maxFileBytes, 12345);
    assert.equal(config.maxDecodedPixels, 24000000);
  assert.equal(config.maxChunkFiles, undefined);
    assert.equal(config.retentionHours, 0.5);
  });

test('uploads preserve idempotency and expose per-file backpressure', async () => {
    let request;
    const service = createLiveService({ fetch: async (path, options) => {
          request = { path, ...options };
          return Response.json({ accepted: [], rejected: [{ http_status: 429, code: 'QUEUE_FULL' }] }, {
              status: 429, headers: { 'Retry-After': '2' },
            });
        } });
    const response = await service.addImages('batch/a', [new File(['image'], 'fruit.png')], 3, 'stable-key');
    assert.equal(request.path, '/api/batches/batch%2Fa/images');
    assert.equal(request.credentials, 'same-origin');
    assert.equal(request.headers.get('X-Fruispect'), '1');
    assert.equal(request.headers.get('Idempotency-Key'), 'stable-key');
    assert.equal(request.body.get('offset'), '3');
    assert.equal(response.retryAfterMs, 2000);
    await assert.rejects(service.addImages('batch', [], 0, 'key'), ApiError);
  });

test('degraded readiness is data and authentication denial remains an error', async () => {
    const degraded = createLiveService({ fetch: async () => Response.json({ ready: false }, { status: 503 }) });
    assert.equal((await degraded.readiness()).ready, false);
    const denied = createLiveService({ fetch: async () => Response.json({ error: { code: 'PAIRING_REQUIRED', message: 'Pair first' } }, { status: 401 }) });
    await assert.rejects(denied.batches(), error => error.status === 401 && error.code === 'PAIRING_REQUIRED');
  });

test('downloads sanitize filenames and parse retry headers', () => {
    assert.equal(downloadName('attachment; filename="../../scan.csv"', 'fallback'), 'scan.csv');
    assert.equal(downloadName("attachment; filename*=UTF-8''scan%20results.json", 'fallback'), 'scan results.json');
    assert.equal(parseRetryAfter('3'), 3000);
    assert.equal(parseRetryAfter('invalid'), undefined);
  });
