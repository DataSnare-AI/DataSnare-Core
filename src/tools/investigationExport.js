export function buildInvestigationExport(savedCase, exportedAt = new Date().toISOString()) {
  const metadata = savedCase.metadata || {};
  return {
    schema: 'datasnare-analysis/investigation-export-v1',
    exported_at: exportedAt,
    coverage: 'bounded_stored_event_samples',
    investigation: {
      investigation_id: savedCase.investigation_id,
      tenant_id: savedCase.tenant_id,
      title: savedCase.title,
      description: savedCase.description,
      status: savedCase.status,
      created_by: savedCase.created_by,
      created_at: savedCase.created_at,
      updated_at: savedCase.updated_at,
      metadata: Object.fromEntries(['incident_at', 'incident_description', 'working_note', 'window_start', 'window_end']
        .filter(key => metadata[key] !== undefined).map(key => [key, metadata[key]])),
    },
    evidence: (savedCase.evidence || []).map(item => ({
      job_id: item.job_id,
      plugin_id: item.plugin_id,
      plugin_version: item.plugin_version,
      artifact_name: item.artifact_name,
      source_schema: item.source_schema,
      start_time: item.start_time,
      end_time: item.end_time,
      time_range_scope: item.time_range_scope || 'stored_event_sample',
      event_count: item.event_count,
      finding_count: item.finding_count,
      analytics: item.source_schema === 'datasnare-ainetscope/two-sided-findings-v1' ? item.analytics : undefined,
      events: (item.events || []).map(event => ({
        timestamp: event.timestamp,
        severity: event.severity,
        category: event.category,
        host: event.host,
        process: event.process,
        summary: event.summary,
        evidence: Object.fromEntries(['sourceFile', 'sourceLine', 'packetNumber', 'counter', 'threshold', 'direction', 'observed', 'sampleCount', 'start', 'end', 'metric', 'value', 'xmlElement', 'ordinal', 'sourceA', 'sourceB', 'frameA', 'frameB', 'bOffsetMs']
          .filter(key => event.evidence?.[key] !== undefined).map(key => [key, event.evidence[key]])),
      })),
    })),
  };
}