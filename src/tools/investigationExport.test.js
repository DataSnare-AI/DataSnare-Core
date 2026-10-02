import test from 'node:test';
import assert from 'node:assert/strict';
import { buildInvestigationExport } from './investigationExport.js';

test('export preserves saved provenance and identifies sampled coverage', () => {
  const result = buildInvestigationExport({ investigation_id: 'case-1', tenant_id: 7, title: 'Crash',
    metadata: { incident_at: '2026-10-02T13:00:00.123Z', secret: 'excluded' },
    evidence: [{ job_id: 'job-1', artifact_name: 'service.log', event_count: 281,
      events: [{ summary: 'Failure', detail: 'raw-secret', evidence: { sourceLine: 4, secret: 'excluded' } }] }] }, '2026-10-02T14:00:00Z');
  assert.equal(result.coverage, 'bounded_stored_event_samples');
  assert.equal(result.investigation.tenant_id, 7);
  assert.equal(result.evidence[0].event_count, 281);
  assert.equal(result.evidence[0].events.length, 1);
  assert.equal(result.evidence[0].events[0].evidence.sourceLine, 4);
  assert.equal(JSON.stringify(result).includes('secret'), false);
  assert.equal(result.exported_at, '2026-10-02T14:00:00Z');
});

test('older cases without metadata export safely', () => {
  const result = buildInvestigationExport({ title: 'Old case' });
  assert.deepEqual(result.investigation.metadata, {});
  assert.deepEqual(result.evidence, []);
});