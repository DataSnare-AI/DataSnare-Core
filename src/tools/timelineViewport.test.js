import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveTimelineViewport } from './timelineViewport.js';

test('adding out-of-window evidence preserves absolute viewport and millisecond scale', () => {
  const viewport = { start: 100000.123, span: 801 };
  const original = resolveTimelineViewport(viewport, 90000, 60000);
  const extended = resolveTimelineViewport(viewport, 90000, 3600000);
  const removed = resolveTimelineViewport(viewport, 100000, 60000);
  assert.deepEqual(extended, original);
  assert.deepEqual(removed, original);
  assert.equal(original.visibleStart, 100000.123);
  assert.equal(original.visibleSpan, 801);
});

test('an untouched viewport defaults to full evidence extent', () => {
  assert.deepEqual(resolveTimelineViewport(null, 1200, 60000), {
    visibleStart: 1200, visibleEnd: 61200, visibleSpan: 60000,
  });
});