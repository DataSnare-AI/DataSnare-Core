"use strict";

let twoSidedAnalyticsSnapshot = null;
const TWO_SIDED_FINDINGS_SCHEMA = 'datasnare-ainetscope/two-sided-findings-v1';
const TWO_SIDED_ANALYTICS_CAVEATS = [
  'Corrected capture intervals depend on clock offset/drift, capture location and offload; they are not independently validated wire latency.',
  'Missing counterparts do not prove network loss or identify a dropping device. Capture loss, filters, NAT, segmentation and coverage can prevent matching.',
  'Differing matched SYN options suggest rewriting, not identification of a specific middlebox. Missing or incomplete handshakes mean unavailable evidence.',
  'Flight estimates require a captured SYN and represent sequence-space high-water minus cumulative ACK, including SYN/FIN. Gaps and reordering can inflate estimates; spans beyond half the sequence space are excluded.',
  'Window scaling is applied only when both captured SYNs advertise it; otherwise raw windows are reported. Filtered-out handshakes/ACKs limit flow-control analysis.',
];
const twoSidedReportCommon = globalThis.DataSnareReportCommon;

function analyticsValue(value, unit = '') {
  return Number.isFinite(value) ? `${value.toLocaleString(undefined, { maximumFractionDigits: 3 })}${unit ? ` ${unit}` : ''}` : 'Unavailable';
}

function buildTwoSidedFindingsExport() {
  const records = twoSidedVisibleRecords().map(item => item.record);
  const metrics = DataSnareTwoSidedAnalytics.summarize(records, twoSidedState.packetsA, twoSidedState.packetsB, twoSidedState.offsetMs, twoSidedState.analysisContext || {});
  const reduced = twoSidedState.sessionCoverage === 'matched_pairs_only';
  if (reduced) {
    metrics.loss = { overlap: false, overlapMs: null, onlyA: null, onlyB: null, withinA: null, withinB: null, senderOnlyAtoB: null, senderOnlyBtoA: null };
    metrics.ambiguous = null;
    for (const side of ['A', 'B']) metrics[`flow${side}`] = { zeroWindows: null, windowSamples: 0, flight: DataSnareTwoSidedAnalytics.stats([]), advertisedWindow: DataSnareTwoSidedAnalytics.stats([]), windowBasis: 'Unavailable: matched-only session' };
  }
  const sources = twoSidedState.analysisContext?.sources || ['A', 'B'].map(side => {
    const file = $(`#twoSidedFile${side}`).files[0];
    return { side, name: file?.name || `System ${side}`, size: file?.size ?? null, lastModified: file?.lastModified ?? null };
  });
  const scope = { connection: $('#twoSidedConnection').value, includeOtherConnections: $('#twoSidedContext').checked,
    observationStatus: $('#twoSidedObservationFilter').value, matchedOnly: $('#twoSidedMatchedOnly').getAttribute('aria-pressed') === 'true',
    search: $('#twoSidedSearch').value.trim(), observations: records.length, pagination: 'all_filtered_observations',
    bOffsetMs: twoSidedState.offsetMs, hostA: twoSidedState.analysisContext?.hostA || '', hostB: twoSidedState.analysisContext?.hostB || '',
    toleranceMs: twoSidedState.analysisContext?.toleranceMs ?? null,
    sessionCoverage: reduced ? 'matched_pairs_only' : 'full_metadata',
    jitterDefinition: 'population standard deviation of corrected matched intervals', percentileMethod: 'linear interpolation at (n-1)*p' };
  const evidenceFor = record => ({ sourceFile: sources[record?.packetA ? 0 : 1].name,
    packetNumber: (record?.packetA || record?.packetB)?.number ?? null,
    sourceA: sources[0].name, sourceB: sources[1].name, frameA: record?.packetA?.number ?? null,
    frameB: record?.packetB?.number ?? null, bOffsetMs: scope.bOffsetMs });
  const findings = [];
  const add = (category, title, detail, severity = 'info', record = null, values = {}) => {
    const packet = record?.packetA || record?.packetB;
    const timestamp = packet && Number.isFinite(packet.timestamp)
      ? new Date((packet.timestamp + (!record.packetA ? scope.bOffsetMs / 1000 : 0)) * 1000).toISOString() : null;
    findings.push({ id: `two-sided-${findings.length + 1}`, category, title, summary: title, detail, severity,
      timestamp, evidence: evidenceFor(record), metrics: values });
  };
  for (const group of [...metrics.directions, { direction: 'Unknown direction / B minus A', ...metrics.unknown }]) {
    if (!group.count) continue;
    const sample = records.find(record => record.status === 'matched' && (group.direction.startsWith('Unknown') ? !record.direction : record.direction === group.direction));
    add('network.path-performance', `${group.direction}: ${group.count} matched intervals`,
      `p95 ${analyticsValue(group.p95, 'ms')}; p99 ${analyticsValue(group.p99, 'ms')}; jitter ${analyticsValue(group.jitter, 'ms')}; negative samples ${group.negative}. Capture intervals, not verified wire latency.`,
      group.negative ? 'warning' : 'info', sample, group);
  }
  add('network.loss-diagnostics', 'Cross-capture visibility gaps',
    `A-only ${analyticsValue(metrics.loss.onlyA)}; B-only ${analyticsValue(metrics.loss.onlyB)}; ambiguous ${analyticsValue(metrics.ambiguous)}. Confirmed drop location unavailable; missing counterparts are not proof of network loss.`, 'info', null, metrics.loss);
  add('network.middlebox', 'Handshake option comparison',
    `${metrics.middlebox.handshakesA.length} A and ${metrics.middlebox.handshakesB.length} B SYN observations; ${metrics.middlebox.optionDifferences.length} differing matched handshake options.`, 'info');
  for (const difference of metrics.middlebox.optionDifferences.slice(0, 100)) {
    add('network.middlebox', 'TCP option change between captures', difference.changes.join(', '), 'warning', difference.record);
  }
  for (const side of ['A', 'B']) {
    const values = metrics[`flow${side}`];
    const sample = records.find(record => record[`packet${side}`]?.tcpWindow === 0 && !['syn', 'syn-ack', 'rst'].includes(tcpSignalClass(record[`packet${side}`])));
    add('network.flow-control', `System ${side} flow-control observations`,
      `${analyticsValue(values.zeroWindows)} zero-window advertisements; estimated peak outstanding sequence space ${analyticsValue(values.flight.max, 'bytes')}; window basis ${values.windowBasis}.`,
      values.zeroWindows ? 'warning' : 'info', sample, { zeroWindows: values.zeroWindows, peakFlightBytes: values.flight.max });
  }
  const generatedAt = new Date().toISOString();
  const caveats = reduced ? [...TWO_SIDED_ANALYTICS_CAVEATS, 'Matched-only session: unmatched and ambiguous traffic was omitted. Visibility/loss and flow-control metrics cannot be established from this reduced dataset.'] : TWO_SIDED_ANALYTICS_CAVEATS;
  const matchedCompleteHandshakes = records.filter(record => record.status === 'matched'
    && tcpSignalClass(record.packetA || {}) === 'syn'
    && record.packetA?.tcpOptions?.complete && record.packetB?.tcpOptions?.complete).length;
  const exportedMetrics = { ...metrics, middlebox: { handshakesA: metrics.middlebox.handshakesA.slice(0, 100), handshakesB: metrics.middlebox.handshakesB.slice(0, 100),
      handshakesTotalA: metrics.middlebox.handshakesA.length, handshakesTotalB: metrics.middlebox.handshakesB.length,
      differencesTotal: metrics.middlebox.optionDifferences.length, matchedCompleteHandshakes,
      optionDifferences: metrics.middlebox.optionDifferences.slice(0, 100).map(item => ({ changes: item.changes, evidence: evidenceFor(item.record) })) } };
  const reportModel = twoSidedReportCommon.createReportModel({ mode: 'two-sided', generatedAt, sources, scope,
    metrics: exportedMetrics, findings, caveats,
    checks: findings.map(finding => ({ group: finding.category, name: finding.title,
      severity: finding.severity === 'warning' ? 'medium' : 'low',
      state: twoSidedReportCommon.twoSidedReportCheckState(finding.category, exportedMetrics, reduced, finding.severity), evidence: finding.detail,
      limitation: caveats[0] || '' })) });
  return { schema: TWO_SIDED_FINDINGS_SCHEMA, generatedAt,
    tool: { name: 'AINetScope Two-Sided', version: '1.0.0' }, sources, scope, caveats,
    findings, metrics: exportedMetrics, reportModel };
}

function metricList(entries) {
  return `<dl class="two-analytics-metrics">${entries.map(([label, value]) => `<div><dt>${twoSidedReportCommon.escapeReportHtml(label)}</dt><dd>${twoSidedReportCommon.escapeReportHtml(value === null || value === undefined ? 'Unavailable' : String(value))}</dd></div>`).join('')}</dl>`;
}

function showTwoSidedAnalytics() {
  twoSidedAnalyticsSnapshot = buildTwoSidedFindingsExport();
  const report = twoSidedAnalyticsSnapshot;
  const metrics = report.metrics;
  const groups = [...metrics.directions, { direction: 'Unknown direction / B minus A', ...metrics.unknown }];
  const timing = groups.map(group => `<tr><th>${twoSidedReportCommon.escapeReportHtml(group.direction)}</th>${['count', 'mean', 'p95', 'p99', 'jitter', 'negative'].map(key => `<td>${analyticsValue(group[key])}</td>`).join('')}</tr>`).join('');
  const statusFor = category => report.reportModel.checks.find(check => check.group === category);
  const statusBadge = (category, fallbackState = 'not-assessed') => {
    const check = statusFor(category) || { group: category, name: category, state: fallbackState };
    return twoSidedReportCommon.renderReportStatusBadge(check, 'two-analytics-status');
  };
  const options = (rows, side) => rows.slice(0, 30).map(item => `<tr><td>${side}</td><td>${item.frame}</td><td>${analyticsValue(item.options?.mss)}</td><td>${analyticsValue(item.options?.windowScale)}</td><td>${item.options?.complete ? item.options.sackPermitted ? 'Yes' : 'No' : 'Unavailable'}</td><td>${item.options?.complete ? item.options.timestamps ? 'Yes' : 'No' : 'Unavailable'}</td></tr>`).join('');
  const flow = side => {
    const values = metrics[`flow${side}`];
    return `<h4>System ${side}</h4>${metricList([['Zero-window advertisements', values.zeroWindows], ['Peak outstanding sequence bytes', analyticsValue(values.flight.max, 'bytes')],
      ['p95 outstanding sequence bytes', analyticsValue(values.flight.p95, 'bytes')], ['Flight sample count', values.flight.count], ['Maximum observed window', analyticsValue(values.advertisedWindow.max, 'bytes')], ['Window basis', values.windowBasis]])}`;
  };
  $('#twoSidedAnalyticsBody').innerHTML = `<p class="two-analytics-scope">${metrics.total.toLocaleString()} filtered observations / ${metrics.matched.toLocaleString()} matched pairs / B offset ${report.scope.bOffsetMs} ms / all pages. Snapshot ${twoSidedReportCommon.escapeReportHtml(report.generatedAt)}.</p>
    ${report.scope.sessionCoverage === 'matched_pairs_only' ? '<p class="two-analytics-scope">Reduced session: only matched pairs were retained. Visibility/loss and flow-control metrics are unavailable; omitted handshakes cannot establish absent options. Relink originals for full analysis.</p>' : ''}
    <section class="two-analytics-section"><h3>Path Performance ${statusBadge('network.path-performance', metrics.matched ? 'observed' : 'not-assessed')}</h3><div class="two-analytics-table"><table><thead><tr><th>Direction</th><th>Samples</th><th>Mean ms</th><th>p95 ms</th><th>p99 ms</th><th>Jitter ms</th><th>Negative</th></tr></thead><tbody>${timing}</tbody></table></div><p>${twoSidedReportCommon.escapeReportHtml(report.caveats[0])} Jitter is population standard deviation. Negative samples remain included; small-sample percentiles are descriptive.</p></section>
    <section class="two-analytics-section"><h3>Loss Diagnostics ${statusBadge('network.loss-diagnostics')}</h3>${metricList([['A-only observations', metrics.loss.onlyA], ['B-only observations', metrics.loss.onlyB], ['A-only in aligned overlap', metrics.loss.withinA], ['B-only in aligned overlap', metrics.loss.withinB], ['Sender seen / receiver missing: A to B', analyticsValue(metrics.loss.senderOnlyAtoB)], ['Sender seen / receiver missing: B to A', analyticsValue(metrics.loss.senderOnlyBtoA)], ['Ambiguous observations', metrics.ambiguous], ['Aligned overlap', analyticsValue(metrics.loss.overlapMs, 'ms')], ['Confirmed drop location', 'Unavailable']])}<p>${twoSidedReportCommon.escapeReportHtml(report.caveats[1])} Sender-only counts identify possible path-or-capture visibility gaps between observation points, not confirmed drops. Matched-only filters hide visibility gaps.</p></section>
    <section class="two-analytics-section"><h3>Middlebox Impact ${statusBadge('network.middlebox')}</h3><p>${metrics.middlebox.differencesTotal} option differences across uniquely matched, complete SYN observations. At most 30 handshake rows per side shown.</p><div class="two-analytics-table"><table><thead><tr><th>Side</th><th>Frame</th><th>MSS</th><th>WScale shift</th><th>SACK</th><th>TCP timestamps</th></tr></thead><tbody>${options(metrics.middlebox.handshakesA, 'A')}${options(metrics.middlebox.handshakesB, 'B') || '<tr><td colspan="6">No B handshake options available</td></tr>'}</tbody></table></div><p>${twoSidedReportCommon.escapeReportHtml(report.caveats[2])}</p></section>
    <section class="two-analytics-section"><h3>Flow Control ${statusBadge('network.flow-control')}</h3>${flow('A')}${flow('B')}<p>${twoSidedReportCommon.escapeReportHtml(report.caveats[3])} ${twoSidedReportCommon.escapeReportHtml(report.caveats[4])}</p></section>
    <section class="two-analytics-section"><h3>Supporting Findings</h3>${report.findings.map((finding, index) => `<button type="button" class="two-analytics-finding" data-analytics-finding="${index}" ${finding.evidence.frameA === null && finding.evidence.frameB === null ? 'disabled' : ''}>${twoSidedReportCommon.renderReportStatusBadge(report.reportModel.checks[index], 'two-analytics-status')}<b>${twoSidedReportCommon.escapeReportHtml(finding.title)}</b><span>${twoSidedReportCommon.escapeReportHtml(finding.detail)}</span></button>`).join('')}</section>`;
  $('#twoSidedAnalyticsDialog').showModal();
}

$('#twoSidedAnalyticsButton').addEventListener('click', showTwoSidedAnalytics);
$('#twoSidedAnalyticsClose').addEventListener('click', () => $('#twoSidedAnalyticsDialog').close());
$('#twoSidedAnalyticsPrint').addEventListener('click', () => {
  if (!twoSidedAnalyticsSnapshot) return;
  if (!DataSnareTwoSidedReport.openTwoSidedReport(twoSidedAnalyticsSnapshot)) showToast('Pop-up blocked. Allow pop-ups to open the Two-Sided PDF report.');
});
$('#twoSidedAnalyticsExport').addEventListener('click', () => {
  if (!twoSidedAnalyticsSnapshot) return;
  const url = URL.createObjectURL(new Blob([JSON.stringify(twoSidedAnalyticsSnapshot, null, 2)], { type: 'application/json' }));
  const link = document.createElement('a');
  link.href = url; link.download = 'ainetscope-two-sided-findings.json'; link.click(); URL.revokeObjectURL(url);
});
$('#twoSidedAnalyticsBody').addEventListener('click', event => {
  const button = event.target.closest('[data-analytics-finding]');
  if (!button || !twoSidedAnalyticsSnapshot) return;
  const evidence = twoSidedAnalyticsSnapshot.findings[Number(button.dataset.analyticsFinding)].evidence;
  const visible = twoSidedVisibleRecords();
  const position = visible.findIndex(({ record }) => (evidence.frameA === null || record.packetA?.number === evidence.frameA)
    && (evidence.frameB === null || record.packetB?.number === evidence.frameB));
  if (position < 0) { showToast('Supporting observation is outside the current filters.'); return; }
  $('#twoSidedAnalyticsDialog').close();
  twoSidedState.page = Math.floor(position / twoSidedPageSize()); twoSidedState.selected = visible[position].index;
  renderTwoSided(); $('#twoSidedRows .two-sided-row--selected')?.scrollIntoView({ block: 'center', inline: 'nearest' });
});