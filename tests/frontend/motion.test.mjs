// Verify reading-order entrances, cancellation, and reduced-motion behavior.
import assert from 'node:assert/strict';
import test from 'node:test';
import { animatePage, hasEntrance, stopEntrance } from '../../frontend/assets/motion.js';

// Create a visible entrance group with observable browser animation calls.
function group(top, calls, hidden = false) {
  return {
    hidden, parentElement: null,
    getBoundingClientRect: () => ({ top, bottom: top + 40, width: 200, height: 40 }),
    animate(frames, timing) {
      const animation = { cancelled: false, cancel() { this.cancelled = true; this.oncancel?.(); } };
      calls.push({ top, frames, timing, animation });
      return animation;
    },
  };
}

test('entrances follow top-to-bottom order, skip hidden groups, and bound the delay', () => {
    const calls = [];
    const children = [group(200, calls), group(10, calls), group(80, calls, true), group(100, calls)];
    const root = { querySelectorAll: () => children, contains: () => false };
    animatePage(root);
    assert.deepEqual(calls.map(call => call.top), [10, 100, 200]);
    assert.equal(calls[0].timing.delay, 0);
    assert.ok(calls[1].timing.delay > calls[0].timing.delay);
    assert.ok(calls[2].timing.delay > calls[1].timing.delay);
    assert.ok(calls.at(-1).timing.delay <= 360);
    assert.equal(hasEntrance(root), true);
    stopEntrance(root);
    assert.ok(calls.every(call => call.animation.cancelled));
    assert.equal(hasEntrance(root), false);
  });

test('a new entrance cancels obsolete effects and reduced motion leaves content immediate', () => {
    const original = globalThis.matchMedia;
    const calls = [];
    const root = { querySelectorAll: () => [group(10, calls)], contains: () => false };
    try {
      animatePage(root);
      animatePage(root);
      assert.equal(calls[0].animation.cancelled, true);
      assert.equal(calls.length, 2);
      globalThis.matchMedia = () => ({ matches: true });
      animatePage(root);
      assert.equal(calls[1].animation.cancelled, true);
      assert.equal(calls.length, 2);
      assert.equal(hasEntrance(root), false);
    } finally { globalThis.matchMedia = original; }
  });
