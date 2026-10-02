import test from 'node:test';
import assert from 'node:assert/strict';
import { matchesTimelineSearch } from './timelineSearch.js';

const event = { summary: 'TCP reset observed', host: 'APP01', process: 'acme.exe',
  pluginId: 'ainetscope', artifactName: 'capture.pcap', evidence: { packetNumber: 3457 } };

test('search combines case-insensitive terms across event and provenance fields', () => {
  assert.equal(matchesTimelineSearch(event, ' APP01 Reset '), true);
  assert.equal(matchesTimelineSearch(event, 'acme.exe capture 3457'), true);
  assert.equal(matchesTimelineSearch(event, 'reset APP02'), false);
});

test('empty searches match and absent fields are safe', () => {
  assert.equal(matchesTimelineSearch({}, '   '), true);
  assert.equal(matchesTimelineSearch({}, 'missing'), false);
  assert.equal(matchesTimelineSearch({ detail: 'not searchable' }, 'searchable'), false);
});