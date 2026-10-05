"use strict";

const watchState = { results: [], filtered: [], seen: new Set(), running: false, name: "watch-directory", targets: [] };

function showWatchMode() {
  if (typeof hideTwoSided === "function") hideTwoSided();
  $("#dropZone").hidden = true;
  $("#workspace").hidden = true;
  $("#workbench").hidden = true;
  $("#setWorkspace").hidden = true;
  $("#watchWorkspace").hidden = false;
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function watchFileKey(file) {
  return `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`;
}

function watchProgress(message, mode = "running") {
  const progress = $("#watchProgress");
  progress.className = `set-progress ${mode}`;
  progress.querySelector("span").textContent = message;
}

function watchItemsFromFiles(files) {
  return validCaptureFiles(files).map(file => ({ name: file.name, path: file.webkitRelativePath || file.name, file, key: watchFileKey(file) })).filter(item => !watchState.seen.has(item.key));
}

function watchSummarize(result) {
  const hosts = new Set();
  (result.hostTraffic || []).forEach(item => hosts.add(item.host));
  return { ...result, hosts: [...hosts] };
}

async function analyzeWatchFiles(files, name = "watch-directory") {
  const items = watchItemsFromFiles(files);
  showWatchMode();
  if (!items.length) { watchProgress("No new completed capture files in this snapshot.", "complete"); return; }
  watchState.running = true;
  watchState.name = $("#watchName").value.trim() || name;
  $("#watchName").value = watchState.name;
  $("#watchEmptyState").hidden = true;
  $("#watchDashboard").hidden = false;
  for (const item of items) {
    watchProgress(`Summarizing ${item.path}`);
    await new Promise(resolve => setTimeout(resolve, 0));
    try {
      const packets = await parseFile(item.file, false);
      if (!packets.length) throw new Error("No packet records");
      const summary = watchSummarize(summarizeSetFile(packets, item, watchState.results.length));
      watchState.results.push(summary);
      watchState.seen.add(item.key);
    } catch (error) {
      watchState.results.push({ index: watchState.results.length, name: item.name, path: item.path, source: item.file, status: "Failed", error: error.message, start: 0, end: 0, summary: { packets: 0, bytes: 0, flows: 0, streams: 0, connections: 0, syns: 0, fins: 0, resets: 0, retransmissions: 0 }, protocols: {}, protocolNames: [], services: [], hosts: [], findings: [] });
      watchState.seen.add(item.key);
    }
    renderWatch();
  }
  watchState.running = false;
  const failed = watchState.results.filter(result => result.status === "Failed").length;
  watchProgress(`${watchState.results.length} files summarized · ${failed} failed`, failed ? "failed" : "complete");
  renderWatch();
}

function watchTotals(results = watchState.results) {
  const valid = results.filter(result => result.status === "Analyzed");
  const hosts = new Set();
  valid.forEach(result => (result.hosts || []).forEach(host => hosts.add(host)));
  return {
    files: valid.length,
    failed: results.length - valid.length,
    packets: valid.reduce((sum, result) => sum + result.summary.packets, 0),
    bytes: valid.reduce((sum, result) => sum + result.summary.bytes, 0),
    flows: valid.reduce((sum, result) => sum + result.summary.flows, 0),
    syns: valid.reduce((sum, result) => sum + (result.summary.syns || 0), 0),
    fins: valid.reduce((sum, result) => sum + (result.summary.fins || 0), 0),
    resets: valid.reduce((sum, result) => sum + (result.summary.resets || 0), 0),
    hosts: [...hosts]
  };
}

function renderWatch() {
  const totals = watchTotals();
  $("#watchKpiFiles").textContent = totals.files.toLocaleString();
  $("#watchKpiFailed").textContent = `${totals.failed} failed`;
  $("#watchKpiBytes").textContent = formatBytes(totals.bytes);
  $("#watchKpiPackets").textContent = `${totals.packets.toLocaleString()} packets`;
  $("#watchKpiFlows").textContent = totals.flows.toLocaleString();
  $("#watchKpiHosts").textContent = `${totals.hosts.length.toLocaleString()} hosts`;
  $("#watchKpiTcp").textContent = `${totals.syns} / ${totals.fins} / ${totals.resets}`;
  renderWatchHosts(totals.hosts);
  renderWatchRows();
  drawWatchTrend();
}

function renderWatchHosts(hosts) {
  $("#watchHostCount").textContent = `${hosts.length.toLocaleString()} hosts`;
  $("#watchHostList").innerHTML = hosts.slice(0, 80).map(host => `<span>${escapeHtml(host)}</span>`).join("") || `<p class="comparison-empty">No hosts summarized yet.</p>`;
}

function renderWatchRows() {
  const query = $("#watchSearchInput").value.trim().toLowerCase();
  watchState.filtered = watchState.results.filter(result => !query || `${result.path} ${(result.hosts || []).join(" ")} ${(result.protocolNames || []).join(" ")} ${result.status}`.toLowerCase().includes(query));
  $("#watchRows").innerHTML = watchState.filtered.map(result => `<tr data-watch-index="${result.index}"><td>${traceLabel(result)}</td><td>${(result.summary.packets || 0).toLocaleString()}</td><td>${formatBytes(result.summary.bytes || 0)}</td><td>${(result.summary.flows || 0).toLocaleString()}</td><td>${(result.hosts?.length || 0).toLocaleString()}</td><td>${(result.summary.syns || 0).toLocaleString()}</td><td>${(result.summary.fins || 0).toLocaleString()}</td><td>${(result.summary.resets || 0).toLocaleString()}</td><td><span class="badge ${result.status === "Analyzed" ? "good" : "warn"}">${escapeHtml(result.status)}</span></td></tr>`).join("") || `<tr><td colspan="9">No completed captures summarized.</td></tr>`;
}

function drawWatchTrend() {
  const canvas = $("#watchTrendCanvas"); const { context, width, height } = setupCanvas(canvas);
  watchState.targets = [];
  $("#watchTrendTooltip").hidden = true;
  const valid = watchState.results.filter(result => result.status === "Analyzed");
  $("#watchTrendMeta").textContent = `${valid.length} completed`;
  if (!valid.length) { drawEmptyChart(context, width, height, "No completed captures summarized"); return; }
  const padding = { left: 48, right: 24, top: 26, bottom: 32 }; const chartWidth = width - padding.left - padding.right; const chartHeight = height - padding.top - padding.bottom;
  const maxBytes = Math.max(1, ...valid.map(result => result.summary.bytes));
  const barWidth = Math.max(8, chartWidth / valid.length * .56);
  context.font = "9px DM Mono"; context.fillStyle = "#6f756f"; context.strokeStyle = "#dedbd2";
  for (let row = 0; row <= 4; row++) { const y = padding.top + chartHeight * row / 4; context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke(); context.fillText(formatBytes(maxBytes * (1 - row / 4)), 2, y + 3); }
  valid.forEach((result, index) => {
    const x = padding.left + chartWidth * (index + .5) / valid.length;
    const barHeight = chartHeight * result.summary.bytes / maxBytes;
    const y = padding.top + chartHeight - barHeight;
    context.fillStyle = result.summary.resets ? COLORS[1] : COLORS[index % COLORS.length];
    context.fillRect(x - barWidth / 2, y, barWidth, barHeight);
    context.fillStyle = "#6f756f"; context.textAlign = "center"; context.fillText(String(index + 1), x, height - 10);
    watchState.targets.push({ result, x, y: y + barHeight / 2, width: barWidth, height: barHeight });
  });
  context.textAlign = "left";
}

function watchTargetAt(event) {
  const canvas = $("#watchTrendCanvas"); const rectangle = canvas.getBoundingClientRect(); const x = event.clientX - rectangle.left; const y = event.clientY - rectangle.top;
  return watchState.targets.find(target => x >= target.x - target.width / 2 && x <= target.x + target.width / 2 && y >= target.y - target.height / 2 && y <= target.y + target.height / 2) || null;
}

function showWatchTooltip(event, target) {
  const tooltip = $("#watchTrendTooltip"); const wrapper = tooltip.parentElement; const result = target.result;
  tooltip.innerHTML = `<div class="flow-tooltip-title"><strong>${escapeHtml(result.name)}</strong><span>${escapeHtml(result.status)}</span></div><dl><dt>Path</dt><dd>${escapeHtml(result.path)}</dd><dt>Packets</dt><dd>${result.summary.packets.toLocaleString()}</dd><dt>Bytes</dt><dd>${formatBytes(result.summary.bytes)}</dd><dt>Flows</dt><dd>${result.summary.flows.toLocaleString()}</dd><dt>SYN / FIN / RST</dt><dd>${result.summary.syns || 0} / ${result.summary.fins || 0} / ${result.summary.resets || 0}</dd><dt>Hosts</dt><dd>${(result.hosts || []).slice(0, 8).map(escapeHtml).join(", ")}</dd></dl><small>Click to open this capture</small>`;
  tooltip.hidden = false;
  const wrapperRect = wrapper.getBoundingClientRect(); const tooltipRect = tooltip.getBoundingClientRect(); const pointerX = event.clientX - wrapperRect.left; const pointerY = event.clientY - wrapperRect.top;
  tooltip.style.left = `${Math.max(8, Math.min(wrapperRect.width - tooltipRect.width - 8, pointerX + 14))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(wrapperRect.height - tooltipRect.height - 8, pointerY - tooltipRect.height / 2))}px`;
}

async function openWatchCapture(index) {
  const result = watchState.results.find(item => item.index === index); if (!result || result.status !== "Analyzed") return;
  try { const packets = await parseFile(result.source, true); showCoreMode(); loadPackets(packets, result.path, watchFileKey(result.source)); showToast(`Opened ${result.name} from watch summaries.`); } catch (error) { showToast(`Could not open ${result.name}: ${error.message}`); }
}

function createWatchDemo() {
  return createSetDemo().slice(0, 5).map((item, index) => ({ ...item, index }));
}

async function loadWatchDemo() {
  showWatchMode();
  watchState.results = [];
  watchState.seen.clear();
  $("#watchName").value = "demo-watch-folder";
  watchState.name = "demo-watch-folder";
  $("#watchEmptyState").hidden = true;
  $("#watchDashboard").hidden = false;
  createWatchDemo().forEach(item => {
    const result = watchSummarize(summarizeSetFile(item.packets, item, watchState.results.length));
    watchState.results.push(result);
  });
  watchProgress(`${watchState.results.length} demo captures summarized`, "complete");
  renderWatch();
}

function downloadWatch(format) {
  const valid = watchState.results.filter(result => result.status === "Analyzed");
  let content; let type;
  if (format === "json") { content = JSON.stringify({ schema: "datasnare-ainetscope/watch-summary-v1", generatedAt: new Date().toISOString(), name: watchState.name, totals: watchTotals(), captures: valid.map(({ source, demoPackets, ...result }) => result) }, null, 2); type = "application/json"; }
  else { const rows = [["Capture", "Packets", "Bytes", "Flows", "Hosts", "SYNs", "FINs", "RSTs", "Status"], ...watchState.results.map(result => [result.path, result.summary.packets || 0, result.summary.bytes || 0, result.summary.flows || 0, result.hosts?.length || 0, result.summary.syns || 0, result.summary.fins || 0, result.summary.resets || 0, result.status])]; content = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n"); type = "text/csv"; }
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type })); link.download = `${watchState.name || "watch"}.${format}`; link.click(); URL.revokeObjectURL(link.href);
}

$("#watchModeButton").addEventListener("click", showWatchMode);
$("#watchCoreButton").addEventListener("click", showCoreMode);
$("#watchDirectoryInput").addEventListener("change", event => { const files = [...event.target.files]; const folder = files.find(file => file.webkitRelativePath)?.webkitRelativePath.split("/")[0] || "watch-directory"; analyzeWatchFiles(files, folder); event.target.value = ""; });
$("#watchFileInput").addEventListener("change", event => { analyzeWatchFiles([...event.target.files], $("#watchName").value.trim() || "watch-files"); event.target.value = ""; });
$("#watchDemoButton").addEventListener("click", loadWatchDemo);
$("#watchClearButton").addEventListener("click", () => { watchState.results = []; watchState.filtered = []; watchState.seen.clear(); $("#watchDashboard").hidden = true; $("#watchEmptyState").hidden = false; watchProgress("Watch summaries cleared. Select a directory snapshot to begin.", "complete"); });
$("#watchSearchInput").addEventListener("input", renderWatchRows);
$("#watchRows").addEventListener("click", event => { const row = event.target.closest("tr[data-watch-index]"); if (row) openWatchCapture(Number(row.dataset.watchIndex)); });
$("#watchTrendCanvas").addEventListener("mousemove", event => { const target = watchTargetAt(event); event.currentTarget.style.cursor = target ? "pointer" : "default"; if (target) showWatchTooltip(event, target); else $("#watchTrendTooltip").hidden = true; });
$("#watchTrendCanvas").addEventListener("mouseleave", () => { $("#watchTrendTooltip").hidden = true; $("#watchTrendCanvas").style.cursor = "default"; });
$("#watchTrendCanvas").addEventListener("click", event => { const target = watchTargetAt(event); if (target) openWatchCapture(target.result.index); });
$("#watchJsonButton").addEventListener("click", () => downloadWatch("json"));
$("#watchCsvButton").addEventListener("click", () => downloadWatch("csv"));
window.addEventListener("resize", () => { if (!$("#watchWorkspace").hidden && watchState.results.length) drawWatchTrend(); });

window.DataSnareAINetScopeWatch = Object.freeze({ analyzeWatchFiles, watchTotals, schema: "datasnare-ainetscope/watch-summary-v1" });
