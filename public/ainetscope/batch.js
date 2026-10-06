"use strict";

const batchState = { items: [], results: [], filtered: [], cancelled: false, running: false, name: "capture-set", id: "" };
let setTrendHitTargets = [];
let setFrameSizeHitTargets = [];

function traceLabel(result) {
  const path = result.path && result.path !== result.name ? `<small>${escapeHtml(result.path)}</small>` : "";
  return `<strong>${escapeHtml(result.name)}</strong>${path}`;
}

function captureSetItemKey(item) {
  const file = item.file;
  return `${item.path || item.name}:${file?.size || item.packets?.length || 0}:${file?.lastModified || 0}`;
}

function captureSetFingerprint(items) {
  const source = items.map(captureSetItemKey).sort().join("|");
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `set:${(hash >>> 0).toString(16)}`;
}

function currentCaptureSetName(fallback = "capture-set") {
  return $("#captureSetName").value.trim() || batchState.name || fallback;
}

function setSummaryStorageKey() {
  return `datasnare-capture-set-summary:${batchState.id}`;
}

function captureSetSummary() {
  try {
    const summary = JSON.parse(localStorage.getItem(setSummaryStorageKey()));
    return summary && typeof summary === "object" ? { name: summary.name || batchState.name, problemStatement: summary.problemStatement || "", narrative: summary.narrative || "", updatedAt: summary.updatedAt || null } : { name: batchState.name, problemStatement: "", narrative: "", updatedAt: null };
  } catch (_) { return { name: batchState.name, problemStatement: "", narrative: "", updatedAt: null }; }
}

function captureSetSummaryExists() {
  const summary = captureSetSummary();
  return Boolean(summary.problemStatement.trim() || notePreview(summary.narrative));
}

function showSetMode() {
  if (typeof hideTwoSided === "function") hideTwoSided();
  $("#dropZone").hidden = true;
  $("#workspace").hidden = true;
  $("#workbench").hidden = true;
  $("#setWorkspace").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function showCoreMode() {
  if (typeof hideTwoSided === "function") hideTwoSided();
  $("#dropZone").hidden = false;
  $("#workspace").hidden = false;
  $("#workbench").hidden = true;
  $("#setWorkspace").hidden = true;
  if (state.packets.length) requestAnimationFrame(() => render());
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function validCaptureFiles(files) {
  return [...files].filter(file => /\.(pcap|pcapng|cap)$/i.test(file.name));
}

// Strips the port from a transport endpoint so hosts merge across ephemeral ports.
function topologyHost(value, transport) {
  const text = String(value);
  return transport ? text.slice(0, text.lastIndexOf(":")) || text : text;
}

function summarizeFileEdges(aggregation) {
  const edges = new Map();
  aggregation.flows.forEach(flow => {
    const from = topologyHost(flow.a, flow.transport); const to = topologyHost(flow.b, flow.transport);
    if (from === to) return;
    const key = [from, to].sort().join("|");
    if (!edges.has(key)) edges.set(key, { a: from, b: to, bytes: 0, packets: 0, protocols: {} });
    const edge = edges.get(key);
    edge.bytes += flow.bytes; edge.packets += flow.packets;
    edge.protocols[flow.protocol] = (edge.protocols[flow.protocol] || 0) + flow.bytes;
  });
  return [...edges.values()];
}

function summarizeSetFile(packets, item, index) {
  packets.sort((a, b) => a.timestamp - b.timestamp);
  const aggregation = aggregate(packets);
  const services = analyzeServices(packets);
  const findings = buildFindings(packets, aggregation, services);
  const protocols = packets.reduce((result, packet) => { result[packet.protocol] = (result[packet.protocol] || 0) + packet.length; return result; }, {});
  const hostTraffic = packets.reduce((result, packet) => {
    result[packet.src] = (result[packet.src] || 0) + packet.length;
    result[packet.dst] = (result[packet.dst] || 0) + packet.length;
    return result;
  }, {});
  const result = {
    index,
    name: item.name,
    path: item.path || item.file?.webkitRelativePath || item.name,
    source: item.file || null,
    demoPackets: item.packets || null,
    status: "Analyzed",
    start: packets[0]?.timestamp || 0,
    end: packets.at(-1)?.timestamp || 0,
    summary: analysisSummary(packets, aggregation),
    protocols,
    hostTraffic: Object.entries(hostTraffic).sort((left, right) => right[1] - left[1]).map(([host, bytes]) => ({ host, bytes })),
    edges: summarizeFileEdges(aggregation),
    protocolNames: Object.keys(protocols),
    services: services.map(service => service.name),
    serviceStats: services.map(service => ({ name: service.name, errors: service.errors, latency: median(service.latencies) })),
    findings: findings.filter(finding => finding.severity !== "info"),
    rankedObservations: findings.filter(finding => finding.severity !== "info").length,
    highFindings: 0,
    mediumFindings: 0
  };
  Object.assign(result, profileIssueCounts(result));
  return result;
}

function profileIssueCounts(result, profile = getActiveAnalysisProfile()) {
  if (result.status !== "Analyzed") return { highFindings: 0, mediumFindings: 0 };
  const threshold = profile.thresholds; const summary = result.summary; let highFindings = 0; let mediumFindings = 0;
  if (analysisRuleEnabled(profile, "tcpResets") && summary.resets >= threshold.tcpResets) highFindings++;
  if (analysisRuleEnabled(profile, "handshakeFailures") && summary.handshakeFailures >= threshold.handshakeFailures) highFindings++;
  if (analysisRuleEnabled(profile, "zeroWindows") && summary.zeroWindows >= threshold.zeroWindows) highFindings++;
  if (analysisRuleEnabled(profile, "retransmissions") && summary.retransmissions >= threshold.retransmissions) mediumFindings++;
  if (analysisRuleEnabled(profile, "duplicateAcks") && summary.duplicateAcks >= threshold.duplicateAcks) mediumFindings++;
  if (analysisRuleEnabled(profile, "latencyP95Ms") && summary.latencyP95 > threshold.latencyP95Ms) mediumFindings++;
  (result.serviceStats || []).forEach(service => {
    if (analysisRuleEnabled(profile, "serviceErrors") && service.errors >= threshold.serviceErrors) protocolIsFocused(profile, service.name) ? highFindings++ : mediumFindings++;
    if (analysisRuleEnabled(profile, "serviceLatencyMs") && service.latency > threshold.serviceLatencyMs) protocolIsFocused(profile, service.name) ? highFindings++ : mediumFindings++;
  });
  return { highFindings, mediumFindings };
}

function setProgress(message, mode = "running") {
  const progress = $("#setProgress");
  progress.className = `set-progress ${mode}`;
  progress.querySelector("span").textContent = message;
}

function backgroundSummarizeSetFile(packets, item, index) {
  if (!globalThis.Worker) return Promise.resolve(summarizeSetFile(packets, item, index));
  return new Promise((resolve, reject) => {
    let worker;
    try { worker = new Worker("set-analysis-worker.js"); } catch (_) { resolve(summarizeSetFile(packets, item, index)); return; }
    const timeout = setTimeout(() => { worker.terminate(); reject(new Error("Background analysis timed out.")); }, 120000);
    worker.onmessage = event => {
      if (event.data.type === "started") { setProgress(`Analyzing ${index + 1} of ${batchState.items.length} in background · ${event.data.name}`); return; }
      clearTimeout(timeout); worker.terminate();
      if (event.data.type === "error") reject(new Error(event.data.message)); else resolve(event.data.result);
    };
    worker.onerror = event => { clearTimeout(timeout); worker.terminate(); reject(new Error(event.message || "Background analysis failed.")); };
    worker.postMessage({ packets: Array.from(packets), item: { name: item.name, path: item.path || item.name }, index, profile: getActiveAnalysisProfile() });
  });
}

async function analyzeCaptureSet(items, name = "capture-set", options = {}) {
  if (!items.length || batchState.running) return;
  showSetMode();
  const append = Boolean(options.append && batchState.results.length);
  const existingKeys = new Set(batchState.items.map(captureSetItemKey));
  const additions = append ? items.filter(item => !existingKeys.has(captureSetItemKey(item))) : items;
  if (!additions.length) { showToast("Those captures are already in this set."); return; }
  if (!append) { batchState.items = additions.slice(); batchState.results = []; batchState.filtered = []; } else batchState.items.push(...additions);
  const firstIndex = append ? batchState.items.length - additions.length : 0;
  batchState.cancelled = false; batchState.running = true; batchState.id = captureSetFingerprint(batchState.items);
  const savedSummary = captureSetSummary();
  batchState.name = currentCaptureSetName(savedSummary.updatedAt ? savedSummary.name : name);
  $("#captureSetName").value = batchState.name;
  $("#setEmptyState").hidden = true; $("#setDashboard").hidden = false; $("#cancelSetButton").hidden = false;
  for (let index = 0; index < additions.length; index++) {
    if (batchState.cancelled) break;
    const item = additions[index]; const resultIndex = firstIndex + index;
    setProgress(`${append ? "Adding" : "Analyzing"} ${index + 1} of ${additions.length} · ${item.path || item.name}`);
    batchState.results.push({ index: resultIndex, name: item.name, path: item.path || item.name, source: item.file || null, status: "Queued", start: 0, end: 0, summary: { packets: 0, bytes: 0, duration: 0, throughput: 0, flows: 0, streams: 0, connections: 0, syns: 0, fins: 0, latencyP50: NaN, latencyP95: NaN, retransmissions: 0, resets: 0 }, protocols: {}, protocolNames: [], services: [], findings: [], rankedObservations: 0, highFindings: 0, mediumFindings: 0 });
    renderCaptureSet();
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      const packets = item.packets || await parseFile(item.file, false);
      if (!packets.length) throw new Error("No packet records");
      const result = await backgroundSummarizeSetFile(packets, item, resultIndex);
      result.source = item.file || null; result.demoPackets = item.packets || null;
      Object.assign(result, profileIssueCounts(result));
      const existingIndex = batchState.results.findIndex(existing => existing.index === resultIndex);
      if (existingIndex >= 0) batchState.results[existingIndex] = result; else batchState.results.push(result);
    } catch (error) {
      const failed = { index: resultIndex, name: item.name, path: item.path || item.name, source: item.file || null, status: "Failed", error: error.message, start: 0, end: 0, summary: { packets: 0, bytes: 0, duration: 0, throughput: 0, flows: 0, streams: 0, connections: 0, syns: 0, fins: 0, latencyP50: NaN, latencyP95: NaN, retransmissions: 0, resets: 0 }, protocols: {}, protocolNames: [], services: [], findings: [], rankedObservations: 0, highFindings: 0, mediumFindings: 0 };
      const existingIndex = batchState.results.findIndex(existing => existing.index === resultIndex);
      if (existingIndex >= 0) batchState.results[existingIndex] = failed; else batchState.results.push(failed);
    }
    if (index % 5 === 4 || index === additions.length - 1) renderCaptureSet();
  }
  batchState.running = false; $("#cancelSetButton").hidden = true;
  $("#setSummaryButton").hidden = false; updateSetSummaryTrigger();
  const failed = batchState.results.filter(result => result.status === "Failed").length;
  setProgress(batchState.cancelled ? `Stopped with ${batchState.results.length} files in this set.` : `${batchState.results.length} files in set · ${failed} failed`, failed ? "failed" : "complete");
  renderCaptureSet();
}

function removeSetFile(index) {
  if (batchState.running) { showToast("Wait for the current capture analysis to finish before removing files."); return; }
  const resultIndex = batchState.results.findIndex(result => result.index === index);
  if (resultIndex < 0) return;
  const removed = batchState.results[resultIndex];
  batchState.results.splice(resultIndex, 1);
  batchState.items.splice(resultIndex, 1);
  batchState.results.forEach((result, nextIndex) => { result.index = nextIndex; });
  batchState.id = captureSetFingerprint(batchState.items);
  if (!batchState.results.length) { batchState.filtered = []; $("#setDashboard").hidden = true; $("#setEmptyState").hidden = false; setProgress("Capture set is empty. Add files to continue.", "complete"); updateSetSummaryTrigger(); return; }
  setProgress(`Removed ${removed.name}. ${batchState.results.length} files remain.`, "complete");
  renderCaptureSet();
}

function updateSetSummaryTrigger() {
  const button = $("#setSummaryButton"); if (!batchState.results.length) { button.hidden = true; return; }
  button.hidden = false; button.classList.toggle("has-summary", captureSetSummaryExists());
  button.textContent = captureSetSummaryExists() ? "Set Summary · Saved" : "Set Summary";
}

function renderSetSummaryFiles() {
  $("#setSummaryFileCount").textContent = `${batchState.results.length} file${batchState.results.length === 1 ? "" : "s"}`;
  $("#setSummaryFiles").innerHTML = batchState.results.map(result => `<article class="summary-file"><div>${traceLabel(result)}</div><span>${result.summary.packets.toLocaleString()} packets</span><span>${formatBytes(result.summary.bytes)}</span><span>${formatLatency(result.summary.latencyP95)} p95</span><span class="badge ${result.status === "Analyzed" ? "good" : "warn"}">${result.status}</span></article>`).join("");
}

function updateSetSummaryCharacterCount() {
  const count = $("#setSummaryProblemStatement").value.length + $("#setSummaryNarrativeEditor").textContent.length;
  $("#setSummaryCharacterCount").textContent = `${count.toLocaleString()} characters`;
}

function openSetSummaryEditor() {
  if (!batchState.results.length) { showToast("Analyze a capture set before creating its summary."); return; }
  const summary = captureSetSummary();
  $("#setSummaryName").value = summary.name || batchState.name;
  $("#setSummaryProblemStatement").value = summary.problemStatement;
  $("#setSummaryNarrativeEditor").innerHTML = summary.narrative;
  $("#setSummaryMeta").textContent = `${batchState.results.length} files · ${captureSetTotals().packets.toLocaleString()} packets`;
  $("#setSummarySavedStatus").textContent = summary.updatedAt ? `Saved ${new Date(summary.updatedAt).toLocaleString()}` : "Not saved";
  $("#deleteSetSummaryButton").hidden = !captureSetSummaryExists();
  renderSetSummaryFiles(); updateSetSummaryCharacterCount(); $("#setSummaryDialog").showModal(); $("#setSummaryName").focus();
}

function currentSetSummary() {
  return { schema: "datasnare-ainetscope/capture-set-summary-v1", setId: batchState.id, name: $("#setSummaryName").value.trim() || batchState.name || "Capture Set", problemStatement: $("#setSummaryProblemStatement").value.trim(), narrative: sanitizeNoteHtml($("#setSummaryNarrativeEditor").innerHTML), files: batchState.results.map(result => ({ name: result.name, path: result.path, status: result.status, start: result.start, end: result.end, summary: result.summary, protocols: result.protocolNames, findings: { high: result.highFindings, medium: result.mediumFindings } })), updatedAt: new Date().toISOString() };
}

function saveSetSummary() {
  const summary = currentSetSummary();
  try { localStorage.setItem(setSummaryStorageKey(), JSON.stringify(summary)); } catch (_) { showToast("Could not save set summary: local storage is unavailable."); return; }
  batchState.name = summary.name; $("#captureSetName").value = summary.name; $("#setSummaryDialog").close(); updateSetSummaryTrigger(); showToast(`${summary.name} summary saved locally.`);
}

function deleteSetSummary() {
  try { localStorage.removeItem(setSummaryStorageKey()); } catch (_) { showToast("Could not delete set summary: local storage is unavailable."); return; }
  $("#setSummaryDialog").close(); updateSetSummaryTrigger(); showToast("Capture Set Summary deleted.");
}

function exportSetSummary() {
  const summary = currentSetSummary(); const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(summary, null, 2)], { type: "application/json" })); link.download = `${summary.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "capture-set"}-summary.json`; link.click(); URL.revokeObjectURL(link.href);
}

function captureSetTotals(results = batchState.results) {
  const valid = results.filter(result => result.status === "Analyzed");
  const start = valid.length ? Math.min(...valid.map(result => result.start)) : 0;
  const end = valid.length ? Math.max(...valid.map(result => result.end)) : 0;
  const bytes = valid.reduce((sum, result) => sum + result.summary.bytes, 0);
  const protocols = valid.reduce((totals, result) => { Object.entries(result.protocols).forEach(([name, value]) => { totals[name] = (totals[name] || 0) + value; }); return totals; }, {});
  const p95Values = valid.map(result => result.summary.latencyP95).filter(Number.isFinite);
  return { files: valid.length, failed: results.length - valid.length, packets: valid.reduce((sum, result) => sum + result.summary.packets, 0), bytes, start, end, window: Math.max(0, end - start), throughput: bytes * 8 / Math.max(end - start, .001), latencyP95: percentile(p95Values, .95), protocols };
}

function buildSetFindings(results) {
  const findings = [];
  const profile = getActiveAnalysisProfile(); const threshold = profile.thresholds;
  const valid = results.filter(result => result.status === "Analyzed").sort((a, b) => a.start - b.start);
  valid.forEach(result => Object.assign(result, profileIssueCounts(result, profile)));
  const failed = results.filter(result => result.status === "Failed");
  valid.filter(result => (result.summary.packets || 0) > 25000).forEach(result => findings.push({ severity: "medium", title: "Slow capture file", detail: `${result.path} is a large outlier and is still processing in the background; summary and packet workbench rendering may continue after the set looks responsive.`, index: result.index }));
  if (failed.length) findings.push({ severity: "high", title: "Unreadable captures", detail: `${failed.length} files could not be parsed.`, index: failed[0].index });
  valid.filter(result => result.highFindings).forEach(result => findings.push({ severity: "high", title: `${result.highFindings} high-severity findings`, detail: `${result.path} contains reset, handshake, window, or service failures.`, index: result.index }));
  const latencyValues = valid.map(result => result.summary.latencyP95).filter(Number.isFinite);
  const latencyMedian = median(latencyValues);
  valid.filter(result => Number.isFinite(result.summary.latencyP95) && result.summary.latencyP95 > Math.max(threshold.batchLatencyFloorMs, latencyMedian * threshold.batchLatencyMultiplier)).forEach(result => findings.push({ severity: "medium", title: "Latency outlier", detail: `${result.path} reached p95 ${formatLatency(result.summary.latencyP95)} versus set median ${formatLatency(latencyMedian)} under ${profile.name}.`, index: result.index }));
  const rateMedian = median(valid.map(result => result.summary.throughput));
  valid.filter(result => valid.length > 2 && result.summary.throughput > rateMedian * threshold.trafficSpikeMultiplier).forEach(result => findings.push({ severity: "medium", title: "Traffic spike", detail: `${result.path} averaged ${formatRate(result.summary.throughput)}, over ${threshold.trafficSpikeMultiplier}× the set median.`, index: result.index }));
  const durations = valid.map(result => result.summary.duration).filter(value => value > 0); const durationMedian = median(durations);
  for (let index = 1; index < valid.length; index++) {
    const gap = valid[index].start - valid[index - 1].end;
    if (gap > Math.max(threshold.captureGapSeconds, durationMedian * threshold.gapDurationFraction)) findings.push({ severity: "medium", title: "Capture coverage gap", detail: `${gap.toFixed(3)}s between ${valid[index - 1].name} and ${valid[index].name}.`, index: valid[index].index });
  }
  if (!findings.length) findings.push({ severity: "info", title: "Set is internally consistent", detail: "No parse failures, capture gaps, latency outliers, traffic spikes, or high-severity file findings were detected.", index: valid[0]?.index });
  const rank = { high: 0, medium: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function drawSetTrend(results) {
  const canvas = $("#setTrendCanvas"); const { context, width, height } = setupCanvas(canvas);
  setTrendHitTargets = [];
  $("#setTrendTooltip").hidden = true;
  const valid = results.filter(result => result.status === "Analyzed").sort((a, b) => a.start - b.start);
  if (!valid.length) { drawEmptyChart(context, width, height, "No analyzed captures"); return; }
  const padding = { left: 48, right: 25, top: 25, bottom: 32 }; const chartWidth = width - padding.left - padding.right; const chartHeight = height - padding.top - padding.bottom;
  const maxRate = Math.max(1, ...valid.map(result => result.summary.throughput)); const maxLatency = Math.max(1, ...valid.map(result => Number.isFinite(result.summary.latencyP95) ? result.summary.latencyP95 : 0));
  context.font = "9px DM Mono"; context.fillStyle = "#6f756f"; context.strokeStyle = "#dedbd2";
  for (let row = 0; row <= 4; row++) { const y = padding.top + chartHeight * row / 4; context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke(); context.fillText(formatRate(maxRate * (1 - row / 4)), 2, y + 3); }
  const draw = (getter, max, color, metric) => { context.beginPath(); valid.forEach((result, index) => { const x = padding.left + chartWidth * index / Math.max(1, valid.length - 1); const y = padding.top + chartHeight * (1 - getter(result) / max); index ? context.lineTo(x, y) : context.moveTo(x, y); setTrendHitTargets.push({ result, x, y, metric }); }); context.strokeStyle = color; context.lineWidth = 2; context.stroke(); };
  drawSetFileGuides(context, valid, padding, chartWidth, width, height);
  draw(result => result.summary.throughput, maxRate, COLORS[0], "Throughput"); 
  draw(result => Number.isFinite(result.summary.latencyP95) ? result.summary.latencyP95 : 0, maxLatency, COLORS[1], "p95 latency");
}

function drawSetProtocols(protocols) {
  const canvas = $("#setProtocolCanvas"); const { context, width, height } = setupCanvas(canvas); const entries = Object.entries(protocols).sort((a, b) => b[1] - a[1]); const total = entries.reduce((sum, entry) => sum + entry[1], 0);
  if (!total) { drawEmptyChart(context, width, height, "No protocol data"); return; }
  let angle = -Math.PI / 2; const radius = Math.min(width, height) * .39;
  entries.forEach(([, value], index) => { const next = angle + value / total * Math.PI * 2; context.beginPath(); context.arc(width / 2, height / 2, radius, angle, next); context.strokeStyle = COLORS[index % COLORS.length]; context.lineWidth = 24; context.stroke(); angle = next; });
}

function drawSetFrameSizes(results) {
  const canvas = $("#setFrameSizeCanvas"); const { context, width, height } = setupCanvas(canvas);
  setFrameSizeHitTargets = [];
  $("#setFrameSizeTooltip").hidden = true;
  const valid = results.filter(result => result.status === "Analyzed").sort((left, right) => left.start - right.start);
  if (!valid.length) { drawEmptyChart(context, width, height, "No analyzed captures"); return; }
  const padding = { left: 48, right: 20, top: 24, bottom: 30 }; const chartWidth = width - padding.left - padding.right; const chartHeight = height - padding.top - padding.bottom;
  const maximum = valid.reduce((value, result) => Math.max(value, result.summary.frameAverage || 0, result.summary.frameP95 || 0), 1);
  context.font = "9px DM Mono"; context.fillStyle = "#6f756f"; context.strokeStyle = "#dedbd2";
  for (let row = 0; row <= 4; row++) { const y = padding.top + chartHeight * row / 4; context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke(); context.fillText(formatBytes(maximum * (1 - row / 4)), 2, y + 3); }
  const draw = (field, color, metric) => { context.beginPath(); valid.forEach((result, index) => { const x = padding.left + index / Math.max(1, valid.length - 1) * chartWidth; const y = padding.top + chartHeight * (1 - (result.summary[field] || 0) / maximum); index ? context.lineTo(x, y) : context.moveTo(x, y); context.fillStyle = color; context.fillRect(x - 2, y - 2, 4, 4); setFrameSizeHitTargets.push({ result, x, y, metric, value: result.summary[field] || 0 }); }); context.strokeStyle = color; context.lineWidth = 2; context.stroke(); };
  drawSetFileGuides(context, valid, padding, chartWidth, width, height);
  draw("frameAverage", COLORS[3], "Average frame size"); 
  draw("frameP95", COLORS[1], "p95 frame size");
}

function setChartPointAt(event, canvas, targets) {
  const rectangle = canvas.getBoundingClientRect(); const x = (event.clientX - rectangle.left) * canvas.width / rectangle.width; const y = (event.clientY - rectangle.top) * canvas.height / rectangle.height;
  return targets.reduce((nearest, target) => !nearest || Math.hypot(target.x - x, target.y - y) < Math.hypot(nearest.x - x, nearest.y - y) ? target : nearest, null);
}

function showSetChartTooltip(event, target, tooltipId, valueLines) {
  const tooltip = $(tooltipId); const wrapper = tooltip.parentElement;
  tooltip.innerHTML = `<div class="flow-tooltip-title"><strong>${escapeHtml(target.result.name)}</strong><span>${escapeHtml(target.metric)}</span></div><dl><dt>Path</dt><dd>${escapeHtml(target.result.path)}</dd>${valueLines(target).map(line => `<dt>${escapeHtml(line[0])}</dt><dd>${escapeHtml(line[1])}</dd>`).join("")}</dl>`;
  tooltip.hidden = false;
  const wrapperRect = wrapper.getBoundingClientRect(); const tooltipRect = tooltip.getBoundingClientRect(); const pointerX = event.clientX - wrapperRect.left; const pointerY = event.clientY - wrapperRect.top;
  tooltip.style.left = `${Math.max(8, Math.min(wrapperRect.width - tooltipRect.width - 8, pointerX + 14))}px`; tooltip.style.top = `${Math.max(8, Math.min(wrapperRect.height - tooltipRect.height - 8, pointerY - tooltipRect.height / 2))}px`;
}

function drawSetFileGuides(context, valid, padding, chartWidth, width, height) {
  context.save(); context.strokeStyle = "rgba(111,117,111,.35)"; context.lineWidth = 1; context.setLineDash([3, 5]);
  valid.forEach((result, index) => { const x = padding.left + chartWidth * index / Math.max(1, valid.length - 1); context.beginPath(); context.moveTo(x, padding.top); context.lineTo(x, height - padding.bottom); context.stroke(); });
  context.restore();
  context.fillStyle = "#6f756f"; context.font = "9px DM Mono"; context.textAlign = "center";
  valid.forEach((result, index) => { const x = padding.left + chartWidth * index / Math.max(1, valid.length - 1); context.fillText(result.name, Math.max(padding.left, Math.min(width - padding.right, x)), height - 9); });
  context.textAlign = "left";
}

function renderContinuity(results) {
  const valid = results.filter(result => result.status === "Analyzed").sort((a, b) => a.start - b.start); const rows = [];
  let gaps = 0; let overlaps = 0; let gapSeconds = 0;
  for (let index = 1; index < valid.length; index++) { const difference = valid[index].start - valid[index - 1].end; if (difference > .001) { gaps++; gapSeconds += difference; } else if (difference < -.001) overlaps++; }
  const expected = valid.reduce((sum, result) => sum + result.summary.duration, 0); const window = valid.length ? valid.at(-1).end - valid[0].start : 0; const coverage = window > 0 ? Math.min(100, expected / window * 100) : 100;
  rows.push(["Coverage", `<div class="continuity-track"><i style="width:${coverage.toFixed(1)}%"></i></div>`, `${coverage.toFixed(1)}%`]);
  rows.push(["Gaps", `<strong>${gaps}</strong>`, `${gapSeconds.toFixed(3)}s missing`]);
  rows.push(["Overlaps", `<strong>${overlaps}</strong>`, "adjacent rotations"]);
  rows.push(["Window", `<strong>${valid.length ? new Date(valid[0].start * 1000).toLocaleString() : "—"}</strong>`, valid.length ? `${(valid.at(-1).end - valid[0].start).toFixed(1)}s` : "—"]);
  $("#setContinuity").innerHTML = rows.map(row => `<div class="continuity-row"><span>${row[0]}</span><div>${row[1]}</div><small>${row[2]}</small></div>`).join("");
}

function renderSetRows() {
  const query = $("#setSearchInput").value.trim().toLowerCase();
  batchState.filtered = batchState.results.filter(result => !query || `${result.path} ${result.protocolNames.join(" ")} ${result.services.join(" ")} ${result.status}`.toLowerCase().includes(query));
  $("#setFileRows").innerHTML = batchState.filtered.map(result => {
    const isSlowFile = (result.summary.packets || 0) > 25000;
    const statusLabel = result.status === "Analyzed" ? (isSlowFile ? "Slow file" : "Analyzed") : result.status;
    const statusClass = result.status === "Analyzed" ? (isSlowFile ? "warn" : "good") : "warn";
    return `<tr class="set-file-row" data-set-index="${result.index}"><td>${traceLabel(result)}</td><td>${result.start ? new Date(result.start * 1000).toLocaleTimeString() : "—"}</td><td>${result.summary.duration.toFixed(3)}s</td><td>${result.summary.packets.toLocaleString()}</td><td>${formatBytes(result.summary.bytes)}</td><td>${result.summary.flows}</td><td>${formatLatency(result.summary.latencyP95)}</td><td><span class="badge ${result.highFindings ? "warn" : "good"}">${result.highFindings + result.mediumFindings}</span></td><td><span class="badge ${statusClass}">${statusLabel}</span></td><td><button class="table-action" type="button" data-remove-set="${result.index}">Remove</button></td></tr>`;
  }).join("") || `<tr><td colspan="10">No matching captures</td></tr>`;
}

function renderSetComparisonTable() {
  $("#setComparisonRows").innerHTML = batchState.results.map(result => {
    const summary = result.summary;
    return `<tr class="set-comparison-row" data-set-index="${result.index}"><td>${traceLabel(result)}</td><td>${summary.packets.toLocaleString()}</td><td>${formatBytes(summary.bytes)}</td><td>${(summary.streams ?? summary.flows ?? 0).toLocaleString()}</td><td>${(summary.connections ?? 0).toLocaleString()}</td><td>${formatLatency(summary.latencyP50)}</td><td>${(summary.syns ?? 0).toLocaleString()}</td><td>${(summary.fins ?? 0).toLocaleString()}</td><td>${(summary.resets ?? 0).toLocaleString()}</td><td>${(summary.retransmissions ?? 0).toLocaleString()}</td><td>${result.start ? new Date(result.start * 1000).toLocaleString() : "—"}</td><td>${result.end ? new Date(result.end * 1000).toLocaleString() : "—"}</td><td><span class="badge ${result.rankedObservations ? "warn" : "good"}">${(result.rankedObservations ?? 0).toLocaleString()}</span></td></tr>`;
  }).join("") || `<tr><td colspan="14">No captures analyzed</td></tr>`;
}

function renderCaptureSet() {
  const totals = captureSetTotals(); const findings = buildSetFindings(batchState.results);
  $("#setKpiFiles").textContent = totals.files.toLocaleString(); $("#setKpiFailures").textContent = `${totals.failed} failed`;
  $("#setKpiPackets").textContent = totals.packets.toLocaleString(); $("#setKpiWindow").textContent = `${totals.window.toFixed(1)}s incident window`;
  $("#setKpiBytes").textContent = formatBytes(totals.bytes); $("#setKpiRate").textContent = `${formatRate(totals.throughput)} average`;
  $("#setKpiLatency").textContent = formatLatency(totals.latencyP95); $("#setKpiAnomalies").textContent = `${findings.filter(finding => finding.severity !== "info").length} anomalies`;
  $("#setProtocolCount").textContent = Object.keys(totals.protocols).length;
  const totalBytes = Math.max(1, totals.bytes); $("#setProtocolLegend").innerHTML = Object.entries(totals.protocols).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value], index) => `<div class="protocol-item"><i style="background:${COLORS[index % COLORS.length]}"></i><b>${escapeHtml(name)}</b><span>${Math.round(value / totalBytes * 100)}%</span></div>`).join("");
  drawSetTrend(batchState.results); drawSetProtocols(totals.protocols); drawSetFrameSizes(batchState.results); renderSetRows(); renderSetComparisonTable(); renderContinuity(batchState.results);
  $("#setFindingCount").textContent = `${findings.length} observations`;
  $("#setFindingList").innerHTML = findings.map(finding => `<div class="finding"><span class="severity ${finding.severity}">${finding.severity}</span><div><strong>${escapeHtml(finding.title)}</strong><small>${escapeHtml(finding.detail)}</small></div>${finding.index !== undefined ? `<a data-open-set="${finding.index}">Open</a>` : ""}</div>`).join("");
  updateSetSummaryTrigger();
}

function refreshCaptureSetProfile() {
  if (!batchState.results.length) return;
  batchState.results.forEach(result => Object.assign(result, profileIssueCounts(result)));
  renderCaptureSet();
}

async function openSetCapture(index) {
  const result = batchState.results.find(item => item.index === index); if (!result || result.status !== "Analyzed") return;
  if (!result.source && !result.demoPackets) { showToast('Relink the original capture using Relink originals before opening this restored set file.'); return; }
  const launch = reserveCaptureWindow();
  deliverCaptureWindow(launch, result.demoPackets ? { demoPackets: result.demoPackets, name: result.path } : { file: result.source, name: result.path });
}

function createSetDemo() {
  const base = Date.now() / 1000 - 15;
  const template = createDemo(); const templateStart = template[0].timestamp;
  return Array.from({ length: 12 }, (_, fileIndex) => {
    const packets = template.map(packet => ({ ...packet, details: { ...packet.details }, timestamp: base + fileIndex * 1.05 + (packet.timestamp - templateStart), length: Math.round(packet.length * (fileIndex === 8 ? 3.5 : 1 + fileIndex * .03)) }));
    if (fileIndex === 7) packets.push({ ...packets[3], number: packets.length + 1, timestamp: base + fileIndex * 1.05 + .88, tcpFlagsValue: 0x04, flags: ["RST"], info: "TCP reset in rotated capture" });
    return { name: `dumpcap_${String(fileIndex + 1).padStart(4, "0")}.pcapng`, path: `incident-2026-09-18/dumpcap_${String(fileIndex + 1).padStart(4, "0")}.pcapng`, packets };
  });
}

function downloadSet(format) {
  batchState.name = currentCaptureSetName();
  const valid = batchState.results.filter(result => result.status === "Analyzed");
  let content; let type;
  if (format === "json") { content = JSON.stringify({ schema: "datasnare-ainetscope/capture-set-v1", generatedAt: new Date().toISOString(), profile: getActiveAnalysisProfile(), totals: captureSetTotals(), findings: buildSetFindings(batchState.results), captures: valid.map(({ source, demoPackets, ...result }) => result) }, null, 2); type = "application/json"; }
  else { const rows = [["Trace", "Packets", "Traffic", "Streams", "Connections", "Median latency", "SYNs", "FINs", "RSTs", "Retransmissions", "Start time", "End time", "Ranked observations"], ...valid.map(result => [result.path, result.summary.packets, result.summary.bytes, result.summary.streams ?? result.summary.flows, result.summary.connections ?? 0, Number.isFinite(result.summary.latencyP50) ? result.summary.latencyP50 : "", result.summary.syns ?? 0, result.summary.fins ?? 0, result.summary.resets ?? 0, result.summary.retransmissions, result.start ? new Date(result.start * 1000).toISOString() : "", result.end ? new Date(result.end * 1000).toISOString() : "", result.rankedObservations ?? 0])]; content = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n"); type = "text/csv"; }
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = `${batchState.name}-summary.${format}`; link.click(); URL.revokeObjectURL(link.href);
}

$("#setModeButton").addEventListener("click", showSetMode);
$("#coreModeButton").addEventListener("click", showCoreMode);
$("#captureSetName").addEventListener("input", () => { const name = $("#captureSetName").value.trim(); if (name) batchState.name = name; });
$("#captureSetInput").addEventListener("change", event => { const files = validCaptureFiles(event.target.files); event.target.value = ""; analyzeCaptureSet(files.map(file => ({ name: file.name, path: file.name, file })), currentCaptureSetName("capture-set"), { append: batchState.results.length > 0 }); });
$("#captureDirectoryInput").addEventListener("change", event => { const files = validCaptureFiles(event.target.files); event.target.value = ""; const folder = files[0]?.webkitRelativePath.split("/")[0] || "capture-directory"; analyzeCaptureSet(files.map(file => ({ name: file.name, path: file.webkitRelativePath || file.name, file })), currentCaptureSetName(folder), { append: batchState.results.length > 0 }); });
$("#setDemoButton").addEventListener("click", () => analyzeCaptureSet(createSetDemo(), $("#captureSetName").value.trim() || "demo-rotation-set"));
$("#cancelSetButton").addEventListener("click", () => { batchState.cancelled = true; setProgress("Stopping after the current file…", "failed"); });
$("#setSearchInput").addEventListener("input", renderSetRows);
$("#setTrendCanvas").addEventListener("mousemove", event => { const target = setChartPointAt(event, event.currentTarget, setTrendHitTargets); event.currentTarget.style.cursor = target ? "pointer" : "default"; if (target) showSetChartTooltip(event, target, "#setTrendTooltip", item => [["Throughput", formatRate(item.result.summary.throughput)], ["p95 latency", formatLatency(item.result.summary.latencyP95)]]); else $("#setTrendTooltip").hidden = true; });
$("#setTrendCanvas").addEventListener("mouseleave", () => { $("#setTrendTooltip").hidden = true; $("#setTrendCanvas").style.cursor = "default"; });
$("#setFrameSizeCanvas").addEventListener("mousemove", event => { const target = setChartPointAt(event, event.currentTarget, setFrameSizeHitTargets); event.currentTarget.style.cursor = target ? "pointer" : "default"; if (target) showSetChartTooltip(event, target, "#setFrameSizeTooltip", item => [["Selected", formatBytes(item.value)], ["Average", formatBytes(item.result.summary.frameAverage)], ["p95", formatBytes(item.result.summary.frameP95)]]); else $("#setFrameSizeTooltip").hidden = true; });
$("#setFrameSizeCanvas").addEventListener("mouseleave", () => { $("#setFrameSizeTooltip").hidden = true; $("#setFrameSizeCanvas").style.cursor = "default"; });
$("#setFileRows").addEventListener("click", event => { const remove = event.target.closest("[data-remove-set]"); if (remove) { event.stopPropagation(); removeSetFile(Number(remove.dataset.removeSet)); return; } const row = event.target.closest("tr[data-set-index]"); if (row) openSetCapture(Number(row.dataset.setIndex)); });
$("#setComparisonRows").addEventListener("click", event => { const row = event.target.closest("tr[data-set-index]"); if (row) openSetCapture(Number(row.dataset.setIndex)); });
$("#setFindingList").addEventListener("click", event => { const link = event.target.closest("[data-open-set]"); if (link) openSetCapture(Number(link.dataset.openSet)); });
$("#setJsonButton").addEventListener("click", () => downloadSet("json"));
$("#setCsvButton").addEventListener("click", () => downloadSet("csv"));
$("#setSummaryButton").addEventListener("click", openSetSummaryEditor);
$("#closeSetSummaryDialog").addEventListener("click", () => $("#setSummaryDialog").close());
$("#cancelSetSummaryButton").addEventListener("click", () => $("#setSummaryDialog").close());
$("#saveSetSummaryButton").addEventListener("click", saveSetSummary);
$("#deleteSetSummaryButton").addEventListener("click", deleteSetSummary);
$("#exportSetSummaryButton").addEventListener("click", exportSetSummary);
$("#setSummaryName").addEventListener("input", () => $("#setSummarySavedStatus").textContent = "Unsaved changes");
$("#setSummaryProblemStatement").addEventListener("input", () => { $("#setSummarySavedStatus").textContent = "Unsaved changes"; updateSetSummaryCharacterCount(); });
$("#setSummaryNarrativeEditor").addEventListener("input", () => { $("#setSummarySavedStatus").textContent = "Unsaved changes"; updateSetSummaryCharacterCount(); });
$("#setSummaryNarrativeEditor").addEventListener("keydown", event => { if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); saveSetSummary(); } });
$(".set-summary-toolbar").addEventListener("mousedown", event => { if (event.target.closest("button")) event.preventDefault(); });
$(".set-summary-toolbar").addEventListener("click", event => { const button = event.target.closest("[data-set-summary-command]"); if (!button) return; $("#setSummaryNarrativeEditor").focus(); document.execCommand(button.dataset.setSummaryCommand, false); updateSetSummaryCharacterCount(); });
$("#setSummaryLinkButton").addEventListener("click", () => { const url = prompt("Link URL (https:// or mailto:)", "https://"); if (url && /^(https?:|mailto:)/i.test(url)) { $("#setSummaryNarrativeEditor").focus(); document.execCommand("createLink", false, url); } });
window.addEventListener("resize", () => { if (!$("#setWorkspace").hidden && batchState.results.length) { const totals = captureSetTotals(); drawSetTrend(batchState.results); drawSetProtocols(totals.protocols); drawSetFrameSizes(batchState.results); } });

function combinedTopology(results = batchState.results) {
  const edges = new Map(); const files = new Map();
  results.filter(result => result.status === "Analyzed").forEach(result => {
    const label = result.path || result.name;
    (result.edges || []).forEach(edge => {
      const key = [edge.a, edge.b].sort().join("|");
      if (!edges.has(key)) edges.set(key, { a: edge.a, b: edge.b, bytes: 0, packets: 0, protocols: {}, files: new Set() });
      const merged = edges.get(key);
      merged.bytes += edge.bytes; merged.packets += edge.packets; merged.files.add(label);
      Object.entries(edge.protocols).forEach(([protocol, bytes]) => { merged.protocols[protocol] = (merged.protocols[protocol] || 0) + bytes; });
    });
    (result.hostTraffic || []).forEach(item => { const existing = files.get(item.host) || 0; files.set(item.host, existing + item.bytes); });
  });
  const mergedEdges = [...edges.values()].map(edge => ({ ...edge, files: [...edge.files] }));
  const hosts = [...files.entries()].map(([host, bytes]) => ({ host, bytes }));
  return { hosts, edges: mergedEdges };
}

function openCombinedTopology() {
  const valid = batchState.results.filter(result => result.status === "Analyzed");
  if (!valid.length) { showToast("Analyze a capture set before opening the topology map."); return; }
  batchState.name = currentCaptureSetName();
  const { hosts, edges } = combinedTopology();
  if (!edges.length) { showToast("No host-to-host flows were observed across this capture set."); return; }
  const payload = { schema: "datasnare-ainetscope/topology-v1", generatedAt: new Date().toISOString(), setId: batchState.id, setName: batchState.name, fileCount: valid.length, hosts, edges };
  const win = window.open("", "_blank", "width=1440,height=920");
  if (!win) { showToast("Pop-up blocked. Allow pop-ups for this site to open the topology map."); return; }
  win.document.open(); win.document.write(buildTopologyDocument(payload)); win.document.close();
}

$("#setTopologyButton").addEventListener("click", openCombinedTopology);

window.DataSnareAINetScopeBatch = Object.freeze({ analyzeCaptureSet, summarizeSetFile, captureSetTotals, combinedTopology, schema: "datasnare-ainetscope/capture-set-v1" });
