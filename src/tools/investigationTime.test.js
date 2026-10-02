import test from 'node:test';
import assert from 'node:assert/strict';
import { adjustInvestigationWindow, buildInvestigationMetadata, clipInterval, compareSampleWindow, epochOf, formatGap, incidentWindowOffsets, metadataError, toLocalDateTime, toOffsetISOString, windowFromIncidentOffset } from './investigationTime.js';

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

test('window movement preserves duration and never mutates the original window', () => {
  const original = { start: 100, end: 200 };
  assert.deepEqual(adjustInvestigationWindow(original, 'move', -150), { start: -50, end: 50 });
  assert.deepEqual(adjustInvestigationWindow(original, 'move', 12.6), { start: 113, end: 213 });
  assert.deepEqual(original, { start: 100, end: 200 });
  assert.deepEqual(adjustInvestigationWindow(window, 'move', 10), { start: epochOf(window.start) + 10, end: epochOf(window.end) + 10 });
});

test('edge resizing leaves the opposite edge fixed and clamps to one millisecond', () => {
  const original = { start: 100, end: 200 };
  assert.deepEqual(adjustInvestigationWindow(original, 'start', 500), { start: 199, end: 200 });
  assert.deepEqual(adjustInvestigationWindow(original, 'end', -500), { start: 100, end: 101 });
  assert.deepEqual(adjustInvestigationWindow(original, 'start', -50), { start: 50, end: 200 });
  assert.deepEqual(adjustInvestigationWindow(original, 'end', 50), { start: 100, end: 250 });
  assert.deepEqual(adjustInvestigationWindow({ start: 100, end: 100 }, 'move', 0), { start: 100, end: 101 });
  assert.equal(adjustInvestigationWindow({ start: 200, end: 100 }, 'move', 1), null);
  assert.equal(adjustInvestigationWindow(original, 'move', NaN), null);
  assert.equal(adjustInvestigationWindow(null, 'end', 1), null);
  assert.equal(adjustInvestigationWindow(original, 'invalid', 1), null);
});

test('incident sliders default missing endpoints only on interaction and keep the incident fixed', () => {
  const incident = 2_000_000;
  assert.deepEqual(incidentWindowOffsets(incident, null), { before: 900_000, after: 900_000 });
  const first = windowFromIncidentOffset(incident, null, 'before', 60_000);
  assert.deepEqual(first, { start: 1_940_000, end: 2_900_000 });
  assert.deepEqual(windowFromIncidentOffset(incident, first, 'after', 1000), { start: first.start, end: 2_001_000 });
  assert.deepEqual(windowFromIncidentOffset(incident, { start: incident, end: incident }, 'before', 0), { start: incident - 1, end: incident });
  assert.equal(incidentWindowOffsets('invalid', window), null);
  assert.equal(windowFromIncidentOffset('invalid', null, 'before', 1000), null);
  assert.equal(windowFromIncidentOffset(incident, null, 'after', -1), null);
});

test('sliders preserve the opposite endpoint even after the window moves away from the incident', () => {
  assert.deepEqual(windowFromIncidentOffset(1000, { start: 2000, end: 3000 }, 'after', 5000), { start: 2000, end: 6000 });
  assert.deepEqual(windowFromIncidentOffset(1000, { start: 0, end: 500 }, 'before', 2000), { start: -1000, end: 500 });
  assert.deepEqual(windowFromIncidentOffset(1000, { start: 2000, end: 3000 }, 'after', 0), { start: 2000, end: 2001 });
  assert.deepEqual(windowFromIncidentOffset(1000, { start: 0, end: 500 }, 'before', 0), { start: 499, end: 500 });
  assert.deepEqual(windowFromIncidentOffset(1000, { start: 0 }, 'before', 500), { start: 500, end: 901_000 });
  assert.deepEqual(windowFromIncidentOffset(1000, { end: 2000 }, 'after', 500), { start: -899_000, end: 1500 });
});