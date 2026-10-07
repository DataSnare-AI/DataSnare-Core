"use strict";

const TWO_SIDED_REPORT_FINDING_LIMIT = 100;
const TWO_SIDED_REPORT_HANDSHAKE_LIMIT = 30;

function buildTwoSidedReportModel(snapshot = {}) {
  const source = snapshot.reportModel || {};
  const metrics = snapshot.metrics || {};
  const findings = Array.isArray(snapshot.findings) ? snapshot.findings : [];
  const handshakesA = metrics.middlebox?.handshakesA || [];
  const handshakesB = metrics.middlebox?.handshakesB || [];
  const model = DataSnareReportCommon.createReportModel({ ...source, mode: "two-sided", sources: snapshot.sources || source.sources,
    scope: snapshot.scope || source.scope, findings, metrics, caveats: snapshot.caveats || source.caveats });
  return { ...model,
    findings: findings.slice(0, TWO_SIDED_REPORT_FINDING_LIMIT),
    omittedFindings: Math.max(0, findings.length - TWO_SIDED_REPORT_FINDING_LIMIT),
    handshakesA: handshakesA.slice(0, TWO_SIDED_REPORT_HANDSHAKE_LIMIT),
    handshakesB: handshakesB.slice(0, TWO_SIDED_REPORT_HANDSHAKE_LIMIT),
    omittedHandshakesA: Math.max(0, (metrics.middlebox?.handshakesTotalA ?? handshakesA.length) - TWO_SIDED_REPORT_HANDSHAKE_LIMIT),
    omittedHandshakesB: Math.max(0, (metrics.middlebox?.handshakesTotalB ?? handshakesB.length) - TWO_SIDED_REPORT_HANDSHAKE_LIMIT),
    omittedOptionDifferences: Math.max(0, (metrics.middlebox?.differencesTotal ?? metrics.middlebox?.optionDifferences?.length ?? 0) - (metrics.middlebox?.optionDifferences?.length || 0))
  };
}

function renderTwoSidedReportHtml(model) {
  const escape = DataSnareReportCommon.escapeReportHtml;
  const number = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : "Unavailable";
  const value = (numberValue, unit = "") => Number.isFinite(numberValue) ? `${number(numberValue)}${unit ? ` ${unit}` : ""}` : "Unavailable";
  const checkFor = group => model.checks.find(check => check.group === group);
  const badge = group => checkFor(group) ? DataSnareReportCommon.renderReportStatusBadge(checkFor(group), "status") : DataSnareReportCommon.renderReportStatusBadge({ state: "not-assessed" }, "status");
  const directionRows = [...(model.metrics.directions || []), { direction: "Unknown direction / B minus A", ...(model.metrics.unknown || {}) }]
    .map(item => `<tr><th>${escape(item.direction)}</th><td>${number(item.count)}</td><td>${value(item.mean, "ms")}</td><td>${value(item.p50, "ms")}</td><td>${value(item.p95, "ms")}</td><td>${value(item.p99, "ms")}</td><td>${value(item.jitter, "ms")}</td><td>${number(item.negative)}</td></tr>`).join("");
  const loss = model.metrics.loss || {};
  const lossRows = [
    ["A-only observations", loss.onlyA], ["B-only observations", loss.onlyB],
    ["A-only in aligned overlap", loss.withinA], ["B-only in aligned overlap", loss.withinB],
    ["Ambiguous observations", model.metrics.ambiguous],
    ["Sender seen / receiver missing: A to B", loss.senderOnlyAtoB],
    ["Sender seen / receiver missing: B to A", loss.senderOnlyBtoA],
    ["Aligned overlap", Number.isFinite(loss.overlapMs) ? `${number(loss.overlapMs)} ms` : null],
    ["Confirmed drop location", "Unavailable from these two captures alone"]
  ].map(([label, valueText]) => `<tr><th>${escape(label)}</th><td>${escape(valueText === null || valueText === undefined ? "Unavailable" : String(valueText))}</td></tr>`).join("");
  const handshakeRows = (rows, side) => rows.map(row => `<tr><td>${side}</td><td>${number(row.frame)}</td><td>${value(row.options?.mss)}</td><td>${row.options?.complete ? number(row.options.windowScale) : "Unavailable"}</td><td>${row.options?.complete ? row.options.sackPermitted ? "Yes" : "No" : "Unavailable"}</td><td>${row.options?.complete ? row.options.timestamps ? "Yes" : "No" : "Unavailable"}</td></tr>`).join("");
  const differences = (model.metrics.middlebox?.optionDifferences || []).map(item => `<tr><td>${escape(item.evidence?.sourceA || model.sources[0]?.name || "System A")}</td><td>${number(item.evidence?.frameA)}</td><td>${escape(item.evidence?.sourceB || model.sources[1]?.name || "System B")}</td><td>${number(item.evidence?.frameB)}</td><td>${escape((item.changes || []).join(", "))}</td></tr>`).join("");
  const flowRows = ["A", "B"].map(side => {
    const flow = model.metrics[`flow${side}`] || {};
    return `<tr><th>System ${side}</th><td>${number(flow.zeroWindows)}</td><td>${value(flow.flight?.max, "bytes")}</td><td>${value(flow.flight?.p95, "bytes")}</td><td>${number(flow.flight?.count)}</td><td>${value(flow.advertisedWindow?.max, "bytes")}</td><td>${escape(flow.windowBasis || "Unavailable")}</td></tr>`;
  }).join("");
  const findings = model.findings.map(finding => `<article class="finding"><div>${DataSnareReportCommon.renderReportStatusBadge(model.checks.find(check => check.name === finding.title) || { state: finding.severity === "warning" ? "review" : "observed" }, "status")}</div><div><h3>${escape(finding.title)}</h3><p>${escape(finding.detail)}</p><small>${escape(finding.evidence?.sourceA || "System A")} · Frame A ${number(finding.evidence?.frameA)} · ${escape(finding.evidence?.sourceB || "System B")} · Frame B ${number(finding.evidence?.frameB)}</small></div></article>`).join("");
  const scope = model.scope || {};
  const sources = (model.sources || []).map(source => `<li><strong>${escape(source.side || "Capture")}</strong> ${escape(source.name || "Unknown source")}${Number.isFinite(source.size) ? ` · ${number(source.size)} bytes` : ""}</li>`).join("");
  const caveats = model.caveats.map(caveat => `<li>${escape(caveat)}</li>`).join("");
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>Two-Sided Report</title><style>
:root{--ink:#182720;--muted:#52645b;--line:#cbd5ce;--green:#176b4d;--coral:#b94f35;--gold:#a57513;--blue:#23678a}*{box-sizing:border-box}body{margin:0;background:#edf1ed;color:var(--ink);font:13px/1.45 Arial,Helvetica,sans-serif}.toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;padding:10px;background:white;border-bottom:1px solid var(--line)}button{padding:8px 12px;border:1px solid var(--ink);background:white;color:var(--ink);cursor:pointer}.report{max-width:1180px;margin:24px auto;padding:34px 40px;background:white}.masthead{border-bottom:3px solid var(--green);padding-bottom:16px}.eyebrow{margin:0;color:var(--green);font-size:10px;font-weight:bold;text-transform:uppercase}.masthead h1{margin:6px 0;font-size:26px}.muted,small{color:var(--muted)}.context{display:flex;flex-wrap:wrap;gap:8px 20px;margin-top:10px;font-size:10px;color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(4,minmax(0,1fr));margin:18px 0;border:1px solid var(--line)}.metrics div{padding:10px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}dt{font-size:9px;text-transform:uppercase;color:var(--muted)}dd{margin:4px 0 0;font-size:16px;font-weight:bold;overflow-wrap:anywhere}.section{margin-top:22px;break-inside:auto}.section h2{display:flex;align-items:center;gap:8px;font-size:17px;margin:0 0 10px}table{width:100%;border-collapse:collapse;font-size:9px}th,td{text-align:left;vertical-align:top;padding:6px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}.table-wrap{overflow-x:auto}.status{display:inline-block;padding:2px 6px;border:1px solid var(--line);border-radius:3px;color:var(--muted);font:500 8px var(--mono);text-transform:uppercase;white-space:nowrap}.status--issue{color:var(--coral)}.status--review{color:var(--gold)}.status--observed{color:var(--blue)}.status--clear{color:var(--green)}.finding{display:grid;grid-template-columns:110px 1fr;gap:10px;padding:9px 0;border-bottom:1px solid var(--line);break-inside:avoid}.finding h3,.finding p{margin:0 0 4px}.finding p{font-size:10px}.methodology{break-before:page;page-break-before:always}.methodology-callout{padding:10px;border-left:3px solid var(--gold);background:#f5f2e9;font-size:10px}@media print{@page{size:A4 landscape;margin:12mm}body{background:white;font-size:9pt}.toolbar{display:none}.report{max-width:none;margin:0;padding:0}.section h2{break-after:avoid}tr,.finding{break-inside:avoid}.table-wrap{overflow:visible}}@media(max-width:700px){.report{margin:0;padding:18px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><div class="toolbar"><button type="button" onclick="window.close()">Close</button><button type="button" onclick="window.print()">Print / Save as PDF</button></div><main class="report"><header class="masthead"><p class="eyebrow">DataSnare · AINetScope · Two-Sided</p><h1>Two-Sided capture comparison</h1><div class="context"><span>${escape(model.sources[0]?.side || "A")}: ${escape(model.sources[0]?.name || "Unavailable")}</span><span>${escape(model.sources[1]?.side || "B")}: ${escape(model.sources[1]?.name || "Unavailable")}</span><span>Generated ${escape(model.generatedAt)}</span></div><div class="context"><span>B clock offset: ${value(scope.bOffsetMs, "ms")}</span><span>Match tolerance: ${value(scope.toleranceMs, "ms")}</span><span>Host A: ${escape(scope.hostA || "Unavailable")}</span><span>Host B: ${escape(scope.hostB || "Unavailable")}</span><span>Coverage: ${escape(scope.sessionCoverage || "Unavailable")}</span><span>Connection: ${escape(scope.connection || "all")}</span></div></header>
<dl class="metrics"><div><dt>Filtered observations</dt><dd>${number(model.metrics.total)}</dd></div><div><dt>Matched pairs</dt><dd>${number(model.metrics.matched)}</dd></div><div><dt>Ambiguous</dt><dd>${number(model.metrics.ambiguous)}</dd></div><div><dt>Aligned overlap</dt><dd>${value(model.metrics.loss?.overlapMs, "ms")}</dd></div></dl>
<section class="section"><h2>Path performance ${badge('network.path-performance')}</h2><div class="table-wrap"><table><thead><tr><th>Direction</th><th>Samples</th><th>Mean ms</th><th>p50 ms</th><th>p95 ms</th><th>p99 ms</th><th>Jitter ms</th><th>Negative</th></tr></thead><tbody>${directionRows}</tbody></table></div><p class="muted">Corrected capture intervals; not independently validated wire latency. Jitter is population standard deviation; negative values are retained.</p></section>
<section class="section"><h2>Visibility / loss diagnostics ${badge('network.loss-diagnostics')}</h2><div class="table-wrap"><table><thead><tr><th>Observation</th><th>Value</th></tr></thead><tbody>${lossRows}</tbody></table></div><p class="muted">Sender-only and unmatched observations indicate possible capture/path visibility gaps. They do not establish packet loss or identify a dropping device.</p></section>
<section class="section"><h2>Handshake / middlebox comparison ${badge('network.middlebox')}</h2><p>${number(model.metrics.middlebox?.differencesTotal)} differing uniquely matched complete SYN option sets. At most ${TWO_SIDED_REPORT_HANDSHAKE_LIMIT} handshake rows per source are printed.</p><div class="table-wrap"><table><thead><tr><th>Side</th><th>Frame</th><th>MSS</th><th>Window scale</th><th>SACK</th><th>TCP timestamps</th></tr></thead><tbody>${handshakeRows(model.handshakesA, 'A')}${handshakeRows(model.handshakesB, 'B')}</tbody></table></div><div class="table-wrap"><table><thead><tr><th>Capture A</th><th>Frame A</th><th>Capture B</th><th>Frame B</th><th>Changed options</th></tr></thead><tbody>${differences || '<tr><td colspan="5">No complete matched option differences available.</td></tr>'}</tbody></table></div>${model.omittedHandshakesA || model.omittedHandshakesB || model.omittedOptionDifferences ? `<p class="muted">Omitted details: ${number(model.omittedHandshakesA)} A handshakes, ${number(model.omittedHandshakesB)} B handshakes, ${number(model.omittedOptionDifferences)} option differences.</p>` : ''}</section>
<section class="section"><h2>Per-side flow control ${badge('network.flow-control')}</h2><div class="table-wrap"><table><thead><tr><th>Source</th><th>Zero windows</th><th>Peak flight</th><th>p95 flight</th><th>Samples</th><th>Max advertised window</th><th>Window basis</th></tr></thead><tbody>${flowRows}</tbody></table></div><p class="muted">Flight estimates need captured handshake and ACK context. Gaps/reordering can inflate estimates; advertised windows are not proof of receiver application state.</p></section>
<section class="section"><h2>Supporting findings</h2>${findings || '<p class="muted">No supporting findings were generated for this scope.</p>'}${model.omittedFindings ? `<p class="muted">${number(model.omittedFindings)} additional findings omitted.</p>` : ''}</section>
<section class="section methodology"><h2>Methodology and limitations</h2>${DataSnareReportCommon.sharedReportCoverageHtml('Two-Sided metrics use the selected observations and both capture timelines after the configured B offset.')}<div class="methodology-callout">${DataSnareReportCommon.sharedReportInterpretationHtml()}</div><ul>${model.caveats.map(caveat => `<li>${escape(caveat)}</li>`).join('')}</ul><p>Matching uses observed metadata and unique TCP signatures; it does not verify payload identity. Offset correction is applied to B timestamps only. In matched-only sessions, unmatched, ambiguous, handshake, and surrounding flow-control evidence may have been discarded.</p></section></main></body></html>`;
}

function openTwoSidedReport(snapshot) {
  if (!snapshot) return false;
  const win = window.open('', '_blank', 'width=1280,height=900');
  if (!win) return false;
  win.document.open(); win.document.write(renderTwoSidedReportHtml(buildTwoSidedReportModel(snapshot))); win.document.close();
  return true;
}

const twoSidedReportApi = { buildTwoSidedReportModel, renderTwoSidedReportHtml, openTwoSidedReport,
  TWO_SIDED_REPORT_FINDING_LIMIT, TWO_SIDED_REPORT_HANDSHAKE_LIMIT };
if (typeof module !== 'undefined' && module.exports) module.exports = twoSidedReportApi;
if (typeof globalThis !== 'undefined') globalThis.DataSnareTwoSidedReport = twoSidedReportApi;
