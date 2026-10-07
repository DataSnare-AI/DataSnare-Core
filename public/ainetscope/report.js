"use strict";

function reportEscape(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[character]);
}

function reportNumber(value, digits = 0) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";
}

function buildSingleCaptureReportHtml(report) {
  const findingRows = report.findings.length
    ? report.findings.map(finding => `<article class="finding finding--${reportEscape(finding.severity)}"><div class="finding-rank">${reportEscape(finding.severity)}</div><div><h3>${reportEscape(finding.title)}</h3><p>${reportEscape(finding.detail)}</p>${finding.packet ? `<small>Evidence frame ${reportEscape(finding.packet)}</small>` : ""}</div></article>`).join("")
    : `<p class="empty">No expert findings were generated for this analysis scope.</p>`;
  const charts = report.charts.map(chart => `<figure class="chart"><figcaption>${reportEscape(chart.title)}</figcaption>${chart.image ? `<img src="${reportEscape(chart.image)}" alt="${reportEscape(chart.title)} chart">` : `<div class="chart-unavailable">Chart not available for this capture mode.</div>`}</figure>`).join("");
  const services = report.services.length
    ? report.services.slice(0, 12).map(service => `<tr><td>${reportEscape(service.name)}</td><td>${reportNumber(service.requests)}</td><td>${reportNumber(service.errors)}</td><td>${reportEscape(service.latency)}</td><td>${reportEscape(service.details)}</td></tr>`).join("")
    : `<tr><td colspan="5">No application services decoded.</td></tr>`;
  const flows = report.flows.length
    ? report.flows.slice(0, 10).map(flow => `<tr><td>${reportEscape(flow.a)} ↔ ${reportEscape(flow.b)}</td><td>${reportEscape(flow.protocol)}</td><td>${reportNumber(flow.packets)}</td><td>${reportEscape(flow.traffic)}</td><td>${reportEscape(flow.latency)}</td><td>${reportEscape(flow.state)}</td></tr>`).join("")
    : `<tr><td colspan="6">No conversations in this analysis scope.</td></tr>`;
  const hasInvestigationNotes = Boolean(report.problemStatement || report.narrative || report.relevantFrames.length);
  const narrative = hasInvestigationNotes ? `<section class="report-section"><p class="eyebrow">INVESTIGATION NOTES</p><h2>${report.problemStatement ? "Problem statement and narrative" : "Analysis narrative"}</h2>${report.problemStatement ? `<p class="problem">${reportEscape(report.problemStatement)}</p>` : ""}${report.narrative ? `<p class="narrative">${reportEscape(report.narrative)}</p>` : ""}${report.relevantFrames.length ? `<h3>Relevant frames</h3><ol class="evidence-list">${report.relevantFrames.map(frame => `<li><strong>Frame ${reportEscape(frame.number)} · ${reportEscape(frame.protocol || "Packet")}</strong><span>${reportEscape(frame.time)} · ${reportEscape(frame.source)} → ${reportEscape(frame.destination)} · ${reportEscape(frame.length)} B</span><p>${reportEscape(frame.note || frame.info)}</p></li>`).join("")}</ol>` : ""}</section>` : "";

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${reportEscape(report.name)} - AINetScope Analysis Report</title>
<style>
:root{color-scheme:light;--ink:#182720;--muted:#52645b;--line:#cbd5ce;--green:#176b4d;--coral:#b94f35;--gold:#a57513;--blue:#23678a}*{box-sizing:border-box}body{margin:0;background:#edf1ed;color:var(--ink);font:14px/1.5 Arial,Helvetica,sans-serif}.report{max-width:1050px;margin:28px auto;padding:38px 44px;background:#fff;box-shadow:0 10px 34px #1d322522}.masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid var(--green);padding-bottom:18px}.brand{font-size:11px;font-weight:bold;letter-spacing:.12em;color:var(--green);text-transform:uppercase}.date{font-size:11px;color:var(--muted);text-align:right}.kicker,.eyebrow{margin:22px 0 5px;color:var(--green);font-size:10px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase}h1{margin:6px 0 4px;font-size:30px;line-height:1.15}h2{font-size:19px;margin:0 0 12px}h3{font-size:14px;margin:0 0 4px}.subhead{color:var(--muted);margin:0}.scope{font-size:11px;color:var(--muted);margin-top:12px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);margin:22px 0}.metric{padding:13px;border-right:1px solid var(--line);min-width:0}.metric:last-child{border:0}.metric span,.metric strong{display:block}.metric span{font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:bold}.metric strong{font-size:20px;margin-top:6px;color:var(--green);overflow-wrap:anywhere}.report-section{margin-top:26px}.chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.chart{margin:0;border:1px solid var(--line);padding:10px;break-inside:avoid}.chart figcaption{font-weight:bold;font-size:11px;margin-bottom:8px}.chart img{display:block;width:100%;height:205px;object-fit:contain}.chart-unavailable{height:205px;display:grid;place-items:center;color:var(--muted);background:#f3f6f3;font-size:11px}.finding{display:grid;grid-template-columns:70px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);break-inside:avoid}.finding-rank{align-self:start;text-align:center;padding:3px 5px;border:1px solid var(--line);font-weight:bold;font-size:10px;text-transform:uppercase}.finding--high .finding-rank{color:#a3271d;border-color:#e1aaa4;background:#fff1ef}.finding--medium .finding-rank{color:#815500;border-color:#dfc581;background:#fff8e7}.finding--info .finding-rank{color:var(--blue);border-color:#a9c9d8;background:#edf7fb}.finding p,.problem,.narrative{margin:4px 0;color:#394b42}.finding small{color:var(--muted);font-size:10px}.narrative{white-space:pre-wrap}.problem{padding:12px;border-left:3px solid var(--coral);background:#fff5f1;font-weight:bold}.evidence-list{padding-left:20px}.evidence-list li{margin:10px 0;break-inside:avoid}.evidence-list span,.evidence-list p{display:block;color:var(--muted);font-size:11px;margin:2px 0}table{width:100%;border-collapse:collapse;font-size:10px}th,td{text-align:left;vertical-align:top;padding:7px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{background:#eff4ef;color:#30463b}.empty{color:var(--muted);padding:12px 0}.footer{margin-top:28px;border-top:1px solid var(--line);padding-top:10px;color:var(--muted);font-size:9px}.toolbar{max-width:1050px;margin:16px auto;display:flex;justify-content:flex-end;gap:8px}.toolbar button{padding:9px 14px;border:1px solid var(--green);background:var(--green);color:white;font-weight:bold;cursor:pointer}.toolbar button.secondary{background:#fff;color:var(--ink);border-color:var(--line)}
@media(max-width:720px){.report{margin:0;padding:24px 18px}.chart-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid var(--line)}.toolbar{padding:0 12px}.masthead{flex-direction:column}.date{text-align:left}}
@media print{@page{size:A4;margin:12mm}body{background:#fff;font-size:10pt}.report{max-width:none;margin:0;padding:0;box-shadow:none}.toolbar{display:none}.masthead{break-after:avoid}.report-section{break-inside:auto}.chart-grid{grid-template-columns:1fr 1fr}.chart img,.chart-unavailable{height:175px}.metrics,.chart,.finding,.evidence-list li{break-inside:avoid}h2,h3{break-after:avoid}table{font-size:8pt}th,td{padding:5px}.footer{break-before:avoid}}
</style></head><body><div class="toolbar"><button class="secondary" onclick="window.close()">Close report</button><button onclick="window.print()">Print / Save as PDF</button></div><main class="report"><header class="masthead"><div><div class="brand">DataSnare · AINetScope</div><p class="kicker">Packet capture analysis report</p><h1>${reportEscape(report.name)}</h1><p class="subhead">Expert summary of network behavior in the analyzed trace.</p><p class="scope">${reportEscape(report.scope)} · Profile: ${reportEscape(report.profile)}</p></div><div class="date">Generated<br><strong>${reportEscape(report.generatedAt)}</strong></div></header>
<section class="metrics">${report.metrics.map(metric => `<div class="metric"><span>${reportEscape(metric.label)}</span><strong>${reportEscape(metric.value)}</strong></div>`).join("")}</section>
<section class="report-section"><p class="eyebrow">VISUAL ANALYSIS</p><h2>Charts and traffic shape</h2><div class="chart-grid">${charts}</div></section>
<section class="report-section"><p class="eyebrow">EXPERT ANALYSIS</p><h2>Ranked observations</h2>${findingRows}</section>
${narrative}
<section class="report-section"><p class="eyebrow">APPLICATION BEHAVIOR</p><h2>Decoded services</h2><table><thead><tr><th>Service</th><th>Requests</th><th>Errors</th><th>Median latency</th><th>Observed detail</th></tr></thead><tbody>${services}</tbody></table></section>
<section class="report-section"><p class="eyebrow">CONVERSATIONS</p><h2>Top network flows</h2><table><thead><tr><th>Endpoints</th><th>Protocol</th><th>Packets</th><th>Traffic</th><th>Latency</th><th>State</th></tr></thead><tbody>${flows}</tbody></table></section>
<footer class="footer">Analysis was performed locally in the browser from the selected capture view. Expert findings are heuristic observations and should be verified against packet evidence and the operating environment.</footer></main></body></html>`;
}

function reportSummaryText(html) {
  if (typeof DOMParser === "undefined") return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent.replace(/\s+/g, " ").trim();
}

function buildSingleCaptureReportData() {
  const packets = state.filtered;
  const aggregation = aggregate(packets);
  const services = analyzeServices(packets);
  const summary = analysisSummary(packets, aggregation);
  const profile = getActiveAnalysisProfile();
  const captureNarrative = typeof captureSummary === "function" ? captureSummary() : { problemStatement: "", narrative: "", relevantFrames: [] };
  const charts = [
    ["Traffic throughput", "#timelineCanvas"],
    ["Protocol distribution", "#protocolCanvas"],
    ["Frame-size profile", "#frameSizeCanvas"],
    ["Response-time distribution", "#latencyCanvas"],
    ["Endpoint topology", "#topologyCanvas"],
    ["Selected flow timeline", "#flowCanvas"]
  ].map(([title, selector]) => {
    const canvas = $(selector);
    let image = "";
    try { if (canvas?.width && canvas?.height) image = canvas.toDataURL("image/png"); } catch (_) { image = ""; }
    return { title, image };
  });
  const relevantFrames = (captureNarrative.relevantFrames || []).map(reference => {
    const packet = state.packets.find(item => item.number === Number(reference.number));
    return packet ? {
      number: packet.number,
      protocol: packet.protocol,
      time: `${(packet.timestamp - state.baseTime).toFixed(6)}s`,
      source: packet.src,
      destination: packet.dst,
      length: packet.length,
      info: packet.info,
      note: typeof packetNote === "function" ? reportSummaryText(packetNote(packet.number)) : ""
    } : null;
  }).filter(Boolean);
  return {
    name: state.fileName || "Network capture",
    generatedAt: new Date().toLocaleString(),
    scope: packets.length === state.packets.length ? `${reportNumber(packets.length)} packets analyzed` : `${reportNumber(packets.length)} of ${reportNumber(state.packets.length)} packets analyzed (current dashboard filters)`,
    profile: profile.name,
    metrics: [
      { label: "Packets", value: reportNumber(summary.packets) },
      { label: "Captured traffic", value: formatBytes(summary.bytes) },
      { label: "Conversations", value: reportNumber(summary.flows) },
      { label: "Duration", value: `${reportNumber(summary.duration, 3)} s` },
      { label: "Throughput", value: formatRate(summary.throughput) },
      { label: "Median response", value: formatLatency(summary.latencyP50) },
      { label: "p95 response", value: formatLatency(summary.latencyP95) },
      { label: "Retransmissions", value: reportNumber(summary.retransmissions) }
    ],
    charts,
    findings: buildFindings(packets, aggregation, services, profile),
    services: services.map(service => ({ ...service, latency: formatLatency(median(service.latencies)), details: [...service.details].slice(0, 3).join(", ") || `${service.packets} packets` })),
    flows: aggregation.flows.slice(0, 10).map(flow => ({ ...flow, traffic: formatBytes(flow.bytes), latency: formatLatency(flow.latencyValue) })),
    problemStatement: captureNarrative.problemStatement || "",
    narrative: reportSummaryText(captureNarrative.narrative),
    relevantFrames
  };
}

function openSingleCaptureReport() {
  if (!state.filtered.length) { showToast("Open a capture before creating a PDF report."); return; }
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) { showToast("Allow pop-ups for AINetScope to open the report for printing."); return; }
  const report = buildSingleCaptureReportHtml(buildSingleCaptureReportData());
  reportWindow.document.open();
  reportWindow.document.write(report);
  reportWindow.document.close();
  showToast("Report opened in a new tab. Choose Print / Save as PDF there.");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildSingleCaptureReportHtml, reportEscape, reportNumber };
}

if (typeof document !== "undefined") {
  $("#pdfReportButton")?.addEventListener("click", openSingleCaptureReport);
}