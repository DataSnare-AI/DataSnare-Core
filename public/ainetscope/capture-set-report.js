"use strict";

const SET_REPORT_DETAIL_LIMIT = DataSnareReportCommon.CAPTURE_SET_REPORT_DEFAULTS.fileLimit;
const SET_REPORT_HOST_LIMIT = DataSnareReportCommon.CAPTURE_SET_REPORT_DEFAULTS.hostLimit;
const SET_REPORT_EDGE_LIMIT = DataSnareReportCommon.CAPTURE_SET_REPORT_DEFAULTS.edgeLimit;

function buildCaptureSetReportModel({ results = [], totals = {}, findings = [], topology = {}, profile = {}, narrative = {},
  reportOptions = {}, name = "Capture Set", generatedAt } = {}) {
  const options = DataSnareReportCommon.normalizeCaptureSetReportOptions(reportOptions);
  const files = results.map(result => ({
    name: String(result.name || "Unnamed capture"),
    path: String(result.path || result.name || "Unnamed capture"),
    status: String(result.status || "Not analyzed"),
    packets: Number(result.summary?.packets) || 0,
    bytes: Number(result.summary?.bytes) || 0,
    flows: Number(result.summary?.streams ?? result.summary?.flows) || 0,
    latencyP95Ms: Number.isFinite(result.summary?.latencyP95) ? result.summary.latencyP95 : null,
    highFindings: Number(result.highFindings) || 0,
    mediumFindings: Number(result.mediumFindings) || 0,
    start: Number.isFinite(result.start) && result.start ? new Date(result.start * 1000).toISOString() : null,
    end: Number.isFinite(result.end) && result.end ? new Date(result.end * 1000).toISOString() : null,
    error: result.status === "Failed" ? String(result.error || "Analysis failed") : ""
  }));
  const boundedFindings = findings.slice(0, options.findingLimit).map(finding => ({
    severity: String(finding.severity || "info"),
    title: String(finding.title || "Observation"),
    detail: String(finding.detail || ""),
    sourcePath: finding.index === undefined ? "" : String(results.find(result => result.index === finding.index)?.path || ""),
    frameNumber: Number.isSafeInteger(Number(finding.packet)) && Number(finding.packet) > 0 ? Number(finding.packet) : null
  }));
  const hosts = Array.isArray(topology.hosts) ? topology.hosts : [];
  const edges = Array.isArray(topology.edges) ? topology.edges : [];
  const analyzedFiles = files.filter(file => file.status === "Analyzed").length;
  const failedFiles = files.filter(file => file.status === "Failed").length;
  const incompleteFiles = files.length - analyzedFiles - failedFiles;
  const protocols = Object.entries(totals.protocols || {}).sort((left, right) => right[1] - left[1]);
  const sortedHosts = hosts.slice().sort((left, right) => right.bytes - left.bytes);
  const sortedEdges = edges.slice().sort((left, right) => right.bytes - left.bytes);
  const caveats = [
    "Capture Set comparisons use per-file summaries; cross-file gaps and outliers are observations, not proof of packet loss or root cause.",
    "Coverage estimates assume capture timestamps are comparable. Clock differences, filters, asymmetric capture points, and file boundaries may affect interpretation."
  ];
  if (Object.keys(DataSnareReportCommon.CAPTURE_SET_REPORT_DEFAULTS).some(key => key !== "orientation"
      && (options[key] === "all" || options[key] > DataSnareReportCommon.CAPTURE_SET_REPORT_DEFAULTS[key]))) {
    caveats.push("Expanded report detail limits were selected. Generating and printing this report may take longer and use more browser memory.");
  }
  if (options.hostLimit === "all" || options.edgeLimit === "all") {
    caveats.push("All topology hosts and/or connections are included as requested. Very large topologies can make the report slow to generate, consume substantial memory, or produce very large PDF files.");
  }
  if (failedFiles) caveats.push(`${failedFiles} file(s) failed analysis; totals and comparisons cover analyzed files only.`);
  if (results.some(result => ["Queued", "Running"].includes(result.status))) caveats.push("Some files are queued or still processing; this report reflects their current statuses and may be incomplete.");
  if (results.some(result => result.status === "Cancelled")) caveats.push("Some files were cancelled before analysis completed.");
  if (findings.length > boundedFindings.length) caveats.push(`${findings.length - boundedFindings.length} additional finding(s) omitted from the bounded detail list.`);
  return DataSnareReportCommon.createReportModel({
    mode: "capture-set",
    generatedAt,
    sources: files.map(({ name: fileName, path, status }) => ({ name: fileName, path, status })),
    scope: { summary: `${analyzedFiles} analyzed of ${results.length} files`, fileCount: results.length,
      analyzedFiles, failedFiles, incompleteFiles, packets: totals.packets || 0,
      bytes: totals.bytes || 0, windowSeconds: totals.window || 0 },
    metrics: [
      { label: "Files analyzed", value: totals.files || 0 },
      { label: "Files failed", value: failedFiles },
      { label: "Packets", value: totals.packets || 0 },
      { label: "Traffic bytes", value: totals.bytes || 0 },
      { label: "Incident window seconds", value: totals.window || 0 },
      { label: "p95 latency ms", value: Number.isFinite(totals.latencyP95) ? totals.latencyP95 : null }
    ],
    findings: boundedFindings.map(finding => ({ ...finding, state: finding.severity === "high" ? "issue" : finding.severity === "medium" ? "review" : "observed" })),
    checks: [{ group: "Capture Set", name: "File analysis coverage", severity: failedFiles ? "high" : "low",
      state: failedFiles || incompleteFiles ? "review" : "clear",
      evidence: `${analyzedFiles} analyzed, ${failedFiles} failed, ${incompleteFiles} queued or otherwise incomplete of ${results.length} total file(s).`,
      limitation: "Per-file analysis status reflects this run; an analyzed file can still have filtered or incomplete packet visibility." }],
    caveats,
    profile: { name: String(profile.name || "Default"), thresholds: profile.thresholds || {}, rules: profile.rules || {} },
    name: String(name || "Capture Set"),
    problemStatement: String(narrative.problemStatement || ""),
    narrative: String(narrative.text || ""),
    fileRows: files.slice(0, options.fileLimit),
    omittedFiles: Math.max(0, files.length - options.fileLimit),
    omittedFindings: Math.max(0, findings.length - boundedFindings.length),
    reportOptions: options,
    fileLimit: options.fileLimit,
    protocols: protocols.slice(0, options.protocolLimit).map(([protocol, bytes]) => ({ protocol, bytes, percent: totals.bytes ? bytes / totals.bytes * 100 : 0 })),
    omittedProtocols: Math.max(0, protocols.length - options.protocolLimit),
    topology: { hosts: options.hostLimit === "all" ? sortedHosts : sortedHosts.slice(0, options.hostLimit),
      edges: options.edgeLimit === "all" ? sortedEdges : sortedEdges.slice(0, options.edgeLimit),
      totalHosts: hosts.length, totalEdges: edges.length,
      omittedHosts: options.hostLimit === "all" ? 0 : Math.max(0, hosts.length - options.hostLimit),
      omittedEdges: options.edgeLimit === "all" ? 0 : Math.max(0, edges.length - options.edgeLimit) }
  });
}

function renderCaptureSetReportHtml(model) {
  const escape = DataSnareReportCommon.escapeReportHtml;
  const sharedCoverage = DataSnareReportCommon.sharedReportCoverageHtml("Capture Set totals use analyzed files; per-file details retain failed and incomplete statuses.");
  const sharedInterpretation = DataSnareReportCommon.sharedReportInterpretationHtml();
  const number = value => Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 2 }) : "Unavailable";
  const byteSize = value => {
    if (!Number.isFinite(value)) return "Unavailable";
    const units = ["B", "KB", "MB", "GB", "TB"];
    const index = Math.min(units.length - 1, Math.floor(Math.log(Math.max(1, value)) / Math.log(1024)));
    return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
  };
  const metricRows = model.metrics.map(metric => `<div><dt>${escape(metric.label)}</dt><dd>${escape(metric.label.includes("bytes") ? byteSize(metric.value) : number(metric.value))}</dd></div>`).join("");
  const fileRows = model.fileRows.slice(0, model.reportOptions.fileLimit).map(file => `<tr><td>${escape(file.path)}</td><td>${escape(file.status)}</td><td>${number(file.packets)}</td><td>${byteSize(file.bytes)}</td><td>${number(file.flows)}</td><td>${file.latencyP95Ms === null ? "Unavailable" : `${number(file.latencyP95Ms)} ms`}</td><td>${escape(file.start || "Unavailable")}</td><td>${escape(file.end || "Unavailable")}</td><td>${number(file.highFindings + file.mediumFindings)}</td><td>${escape(file.error)}</td></tr>`).join("");
  const findingRows = model.findings.map(finding => `<article class="finding finding--${escape(finding.state)}"><b>${escape(finding.state)}</b><div><h3>${escape(finding.title)}</h3><p>${escape(finding.detail)}</p>${finding.sourcePath ? `<small>${escape(finding.sourcePath)}${finding.frameNumber ? ` · Frame ${number(finding.frameNumber)}` : ""}</small>` : finding.frameNumber ? `<small>Frame ${number(finding.frameNumber)}</small>` : ""}</div></article>`).join("");
  const checkRows = model.checks.map(check => `<tr><th>${escape(check.name)}</th><td>${escape(check.statusLabel)}</td><td>${escape(check.evidence)}</td><td>${escape(check.limitation)}</td></tr>`).join("");
  const protocolRows = model.protocols.map(item => `<tr><td>${escape(item.protocol)}</td><td>${byteSize(item.bytes)}</td><td>${number(item.percent)}%</td></tr>`).join("");
  const hostRows = model.topology.hosts.map(host => `<tr><td>${escape(host.host)}</td><td>${byteSize(host.bytes)}</td></tr>`).join("");
  const edgeRows = model.topology.edges.map(edge => `<tr><td>${escape(edge.a)} ↔ ${escape(edge.b)}</td><td>${byteSize(edge.bytes)}</td><td>${number(edge.packets)}</td><td>${escape((edge.files || []).slice(0, 4).join(", "))}</td></tr>`).join("");
  const hostLimitLabel = model.reportOptions.hostLimit === "all" ? `all ${number(model.topology.totalHosts)}` : `up to ${model.reportOptions.hostLimit}`;
  const edgeLimitLabel = model.reportOptions.edgeLimit === "all" ? `all ${number(model.topology.totalEdges)}` : `up to ${model.reportOptions.edgeLimit}`;
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${escape(model.name)} - Capture Set Report</title><style>
:root{--ink:#182720;--muted:#52645b;--line:#cbd5ce;--green:#176b4d;--coral:#b94f35;--gold:#a57513;--blue:#23678a}*{box-sizing:border-box}body{margin:0;background:#edf1ed;color:var(--ink);font:14px/1.45 Arial,Helvetica,sans-serif}.report{max-width:1120px;margin:24px auto;padding:36px 42px;background:white}.toolbar{position:sticky;top:0;display:flex;justify-content:flex-end;gap:8px;padding:10px;background:#fff;border-bottom:1px solid var(--line)}button{padding:7px 12px;border:1px solid var(--ink);background:white;color:var(--ink);cursor:pointer}.masthead{border-bottom:3px solid var(--green);padding-bottom:16px}.eyebrow{margin:0;color:var(--green);font-size:10px;font-weight:bold;letter-spacing:.1em;text-transform:uppercase}h1{margin:6px 0;font-size:28px}.muted,small{color:var(--muted)}.metrics{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));margin:18px 0;border:1px solid var(--line)}.metrics div{padding:12px;border-right:1px solid var(--line);border-bottom:1px solid var(--line)}dt{color:var(--muted);font-size:10px;text-transform:uppercase}dd{margin:4px 0 0;font-size:19px;font-weight:700}.section{margin-top:24px}.section h2{font-size:18px}.table-wrap{overflow-x:auto}table{width:100%;border-collapse:collapse;font-size:10px}th,td{padding:6px;border-bottom:1px solid var(--line);text-align:left;vertical-align:top;overflow-wrap:anywhere}.findings{display:grid;gap:8px}.finding{display:grid;grid-template-columns:86px 1fr;gap:12px;padding:10px 0;border-bottom:1px solid var(--line);break-inside:avoid}.finding h3,.finding p{margin:0 0 4px}.finding--issue{color:var(--coral)}.finding--review{color:var(--gold)}.finding--observed{color:var(--blue)}.finding p,.finding small{color:var(--muted)}.methodology{break-before:page;page-break-before:always}.caveats{padding-left:20px}.narrative{white-space:pre-wrap}.omitted{color:var(--muted);font-size:10px}@media print{@page{size:A4 ${escape(model.reportOptions.orientation)};margin:12mm}body{background:white;font-size:9pt}.toolbar{display:none}.report{max-width:none;margin:0;padding:0}.metrics,.finding,tr{break-inside:avoid}.section h2{break-after:avoid}.table-wrap{overflow:visible}}@media(max-width:700px){.report{margin:0;padding:20px}.metrics{grid-template-columns:repeat(2,minmax(0,1fr))}}
</style></head><body><div class="toolbar"><button type="button" onclick="window.close()">Close</button><button type="button" onclick="window.print()">Print / Save as PDF</button></div><main class="report"><header class="masthead"><p class="eyebrow">DataSnare · AINetScope · Capture Set</p><h1>${escape(model.name)}</h1><p class="muted">${escape(model.scope.summary)} · Profile: ${escape(model.profile.name)} · Generated ${escape(model.generatedAt)}</p>${model.problemStatement ? `<p>${escape(model.problemStatement)}</p>` : ""}${model.narrative ? `<p class="narrative">${escape(model.narrative)}</p>` : ""}</header><dl class="metrics">${metricRows}</dl>
<section class="section"><h2>Cross-file observations</h2><div class="findings">${findingRows || '<p class="muted">No observations in this set.</p>'}</div>${model.omittedFindings ? `<p class="omitted">${number(model.omittedFindings)} additional observations omitted.</p>` : ""}</section>
<section class="section"><h2>Protocol distribution</h2><div class="table-wrap"><table><thead><tr><th>Protocol</th><th>Traffic</th><th>Share</th></tr></thead><tbody>${protocolRows || '<tr><td colspan="3">No protocol totals available.</td></tr>'}</tbody></table></div>${model.omittedProtocols ? `<p class="omitted">${number(model.omittedProtocols)} additional protocols omitted.</p>` : ""}</section>
<section class="section"><h2>Topology overview</h2><p class="muted">${number(model.topology.totalHosts)} observed hosts · ${number(model.topology.totalEdges)} observed connections. Showing ${hostLimitLabel} hosts and ${edgeLimitLabel} connections.</p><div class="table-wrap"><table><thead><tr><th>Host</th><th>Traffic</th></tr></thead><tbody>${hostRows || '<tr><td colspan="2">No host inventory available.</td></tr>'}</tbody></table></div>${model.topology.omittedHosts ? `<p class="omitted">${number(model.topology.omittedHosts)} hosts omitted from details.</p>` : ""}<div class="table-wrap"><table><thead><tr><th>Connection</th><th>Traffic</th><th>Packets</th><th>Observed in captures</th></tr></thead><tbody>${edgeRows || '<tr><td colspan="4">No connection inventory available.</td></tr>'}</tbody></table></div>${model.topology.omittedEdges ? `<p class="omitted">${number(model.topology.omittedEdges)} connections omitted from details.</p>` : ""}</section>
<section class="section"><h2>File inventory</h2><div class="table-wrap"><table><thead><tr><th>Capture</th><th>Status</th><th>Packets</th><th>Traffic</th><th>Flows</th><th>p95 latency</th><th>Start</th><th>End</th><th>Ranked observations</th><th>Error</th></tr></thead><tbody>${fileRows || '<tr><td colspan="10">No files in this capture set.</td></tr>'}</tbody></table></div>${model.omittedFiles ? `<p class="omitted">${number(model.omittedFiles)} additional files omitted from the detail table.</p>` : ""}</section>
<section class="section"><h2>Coverage check</h2><div class="table-wrap"><table><thead><tr><th>Check</th><th>State</th><th>Evidence</th><th>Limitation</th></tr></thead><tbody>${checkRows}</tbody></table></div></section>
<section class="section methodology"><h2>Methodology and limitations</h2>${sharedCoverage}<p>Capture Set aggregates bounded per-file summaries. Cross-file timing, coverage gaps, and outliers are descriptive and depend on comparable timestamps; they do not establish packet loss, a dropping device, or root cause.</p>${sharedInterpretation}<ul class="caveats">${model.caveats.map(caveat => `<li>${escape(caveat)}</li>`).join("")}</ul></section></main></body></html>`;
}

function openCaptureSetReport(input) {
  const model = buildCaptureSetReportModel(input);
  const html = renderCaptureSetReportHtml(model);
  const win = window.open("", "_blank", "width=1280,height=900");
  if (!win) return false;
  win.document.open(); win.document.write(html); win.document.close();
  return true;
}

const captureSetReportApi = { buildCaptureSetReportModel, renderCaptureSetReportHtml, openCaptureSetReport,
  SET_REPORT_DETAIL_LIMIT, SET_REPORT_HOST_LIMIT, SET_REPORT_EDGE_LIMIT };
if (typeof module !== "undefined" && module.exports) module.exports = captureSetReportApi;
if (typeof globalThis !== "undefined") globalThis.DataSnareCaptureSetReport = captureSetReportApi;
