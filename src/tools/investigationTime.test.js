import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvestigationMetadata, clipInterval, compareSampleWindow, epochOf, formatGap, metadataError, toLocalDateTime, toOffsetISOString } from './investigationTime.js';

const window = { start: '2026-10-02T10:00:00.000Z', end: '2026-10-02T11:00:00.000Z' };

test('gaps use the nearest actual sample endpoint, including milliseconds and offsets', () => {
  const before = compareSampleWindow({ start_time: '2026-10-02T08:00:00Z', end_time: '2026-10-02T11:59:59.875+02:00' }, window);
  assert.equal(before.kind, 'before');
  assert.equal(before.gap, 125);
  assert.match(before.text, /125 ms/);
  const after = compareSampleWindow({ start_time: '2026-10-02T11:00:01.250Z', end_time: '2026-10-02T12:00:00Z' }, window);
  assert.equal(after.kind, 'after');
  assert.equal(after.gap, 1250);
  assert.equal(formatGap(90_061_125), '1 d 1 h 1 min 1 s 125 ms');
});

test('unknown and inverted samples never acquire invented bounds', () => {
  assert.equal(compareSampleWindow({ start_time: window.start }, window).kind, 'unavailable');
  assert.equal(compareSampleWindow({ start_time: window.end, end_time: window.start }, window).kind, 'unavailable');
  assert.equal(compareSampleWindow({ start_time: 'invalid', end_time: window.end }, window).kind, 'unavailable');
  assert.ok(Number.isNaN(epochOf(null)));
});

test('touching endpoints overlap and samples can partially overlap', () => {
  assert.equal(compareSampleWindow({ start_time: window.start, end_time: window.end }, window).kind, 'inside');
  assert.equal(compareSampleWindow({ start_time: '2026-10-02T09:00:00Z', end_time: window.start }, window).kind, 'partial');
  assert.equal(compareSampleWindow({}, null).kind, 'none');
});

test('local datetime round trips preserve instants and milliseconds with an explicit offset', () => {
  for (const source of ['2026-01-02T12:34:56.123+05:30', '2026-07-02T12:34:56.007-04:00']) {
    const local = toLocalDateTime(source);
    assert.match(local, /\.\d{3}$/);
    const serialized = toOffsetISOString(local);
    assert.match(serialized, /[+-]\d{2}:\d{2}$/);
    assert.equal(Date.parse(serialized), Date.parse(source));
  }
  assert.equal(toOffsetISOString('2026-02-30T12:00'), null);
  assert.equal(toLocalDateTime('invalid'), '');
  assert.ok(toOffsetISOString('2026-10-02T10:00'));
});

test('metadata enforces paired ordered dates and preserves the compatibility note', () => {
  const fields = { incident_at: '', incident_description: 'Database outage', window_start: '', window_end: '' };
  assert.deepEqual(buildInvestigationMetadata(fields, 'Working hypothesis'), { working_note: 'Working hypothesis', incident_description: 'Database outage' });
  assert.ok(metadataError({ ...fields, window_start: '2026-10-02T10:00' }));
  assert.ok(metadataError({ ...fields, window_start: '2026-10-02T11:00', window_end: '2026-10-02T10:00' }));
  const metadata = buildInvestigationMetadata({ ...fields, incident_at: '2026-10-02T10:00:00.123', window_start: '2026-10-02T10:00', window_end: '2026-10-02T11:00' }, 'Note');
  assert.match(metadata.incident_at, /\.123[+-]/);
  assert.ok(Date.parse(metadata.window_start) < Date.parse(metadata.window_end));
});

test('range clipping excludes offscreen intervals without reversing or spilling bounds', () => {
  assert.equal(clipInterval(0, 5, 10, 20), null);
  assert.equal(clipInterval(25, 30, 10, 20), null);
  assert.deepEqual(clipInterval(0, 15, 10, 20), { start: 10, end: 15 });
  assert.deepEqual(clipInterval(15, 30, 10, 20), { start: 15, end: 20 });
  assert.deepEqual(clipInterval(15, 15, 10, 20), { start: 15, end: 15 });
});