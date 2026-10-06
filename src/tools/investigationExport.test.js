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

test('metric provenance survives export without raw details', () => {
  const result = buildInvestigationExport({ evidence: [{ events: [{ summary: 'CPU saturated',
    evidence: { counter: 'Processor Time', observed: 99, threshold: 95, raw: 'excluded' } }] }] });
  assert.deepEqual(result.evidence[0].events[0].evidence, { counter: 'Processor Time', threshold: 95, observed: 99 });
});

test('Two-Sided saved analytics retain paired sources and correction context', () => {
  const result = buildInvestigationExport({ evidence: [{ source_schema: 'datasnare-ainetscope/two-sided-findings-v1',
    analytics: { scope: { bOffsetMs: -100 }, caveats: ['Capture intervals only'] },
    events: [{ summary: 'Path timing', evidence: { sourceA: 'a.pcap', sourceB: 'b.pcap', frameA: 1001, frameB: 3405, bOffsetMs: -100 } }] }] });
  assert.equal(result.evidence[0].analytics.scope.bOffsetMs, -100);
  assert.equal(result.evidence[0].events[0].evidence.frameB, 3405);
});