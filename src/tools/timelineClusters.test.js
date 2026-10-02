import test from 'node:test';
import assert from 'node:assert/strict';
import { clusterTimelineEvents } from './timelineClusters.js';

test('crowded groups preserve events and separate at finer scales', () => {
  const events = [{ epoch: 0 }, { epoch: 1 }, { epoch: 2 }, { epoch: 200 }];
  const compact = clusterTimelineEvents(events, value => value);
  assert.deepEqual(compact.map(group => group.events.length), [3, 1]);
  assert.equal(compact[0].x, 1);
  assert.equal(clusterTimelineEvents(events, value => value * 200).length, 4);
  assert.deepEqual(compact.flatMap(group => group.events), events);
});

test('empty and simultaneous timestamps are supported', () => {
  assert.deepEqual(clusterTimelineEvents([], value => value), []);
  assert.equal(clusterTimelineEvents([{ epoch: 3 }, { epoch: 3 }], value => value)[0].events.length, 2);
});