"use strict";

const $ = selector => document.querySelector(selector);
const COLORS = ["#17654b", "#df6849", "#d9a438", "#397c9f", "#80658c", "#6d7870"];
const state = { sources: [], series: [], findings: [], selectedSeriesId: null, hoverTargets: [] };

const COUNTERS = [
  { kind: "cpu", label: "CPU total", suffix: /\\processor\(_total\)\\% processor time$/i, unit: "%", high: 80, critical: 95, direction: "high" },
  { kind: "cpu", label: "CPU total", suffix: /\\processor information\(_total\)\\% processor utility$/i, unit: "%", high: 80, critical: 95, direction: "high" },
  { kind: "queue", label: "Processor queue", suffix: /\\system\\processor queue length$/i, unit: "", high: 2, critical: 4, direction: "high" },
  { kind: "processorCount", label: "Logical processors", suffix: /\\system\\processor count$/i, unit: "", high: null, critical: null, direction: "high" },
  { kind: "memory", label: "Memory committed", suffix: /\\memory\\% committed bytes in use$/i, unit: "%", high: 80, critical: 90, direction: "high" },
  { kind: "available", label: "Available memory", suffix: /\\memory\\available mbytes$/i, unit: "MB", high: 500, critical: 200, direction: "low" },
  { kind: "pages", label: "Paging activity", suffix: /\\memory\\pages\/sec$/i, unit: "/s", high: 20, critical: 100, direction: "high" },
  { kind: "diskRead", label: "Disk read latency", suffix: /\\physicaldisk\(_total\)\\avg\. disk sec\/read$/i, unit: "s", high: .02, critical: .05, direction: "high" },
  { kind: "diskWrite", label: "Disk write latency", suffix: /\\physicaldisk\(_total\)\\avg\. disk sec\/write$/i, unit: "s", high: .02, critical: .05, direction: "high" },
  { kind: "diskQueue", label: "Disk queue", suffix: /\\physicaldisk\(_total\)\\(?:current|avg\.) disk queue length$/i, unit: "", high: 2, critical: 4, direction: "high" },
  { kind: "netBytes", label: "Network throughput", suffix: /\\network interface\([^)]*\)\\bytes total\/sec$/i, unit: "B/s", high: null, critical: null, direction: "high" },
  { kind: "netBandwidth", label: "Interface bandwidth", suffix: /\\network interface\([^)]*\)\\current bandwidth$/i, unit: "bit/s", high: null, critical: null, direction: "high" },
  { kind: "netErrors", label: "Network errors", suffix: /\\network interface\([^)]*\)\\packets (?:received|outbound) errors$/i, unit: "/s", high: 0, critical: null, direction: "high" },
  { kind: "tcpResets", label: "TCP reset rate", suffix: /\\tcpv[46]\\connections reset$/i, unit: "/s", high: 0, critical: null, direction: "high" }
];

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", "\"": "&quot;" })[character]);
}

function showToast(message) {
  const toast = $("#toast");
  toast.textContent = message;
  toast.classList.add("visible");
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3500);
}

function parseCsv(text) {
  const rows = [];
  let row = [], field = "", quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (quoted) {
      if (character === '"' && text[index + 1] === '"') { field += '"'; index++; }
      else if (character === '"') quoted = false;
      else field += character;
    } else if (character === '"') quoted = true;
    else if (character === ",") { row.push(field); field = ""; }
    else if (character === "\n" || character === "\r") {
      if (character === "\r" && text[index + 1] === "\n") index++;
      row.push(field); field = "";
      if (row.some(value => value.length)) rows.push(row);
      row = [];
    } else field += character;
  }
  if (field.length || row.length) { row.push(field); rows.push(row); }
  if (quoted) throw new Error("CSV contains an unterminated quoted field.");
  return rows;
}

function parsePdhHeader(value) {
  const text = String(value || "").replace(/^\ufeff/, "");
  const match = text.match(/^\(PDH-CSV[^)]*\)\s*(?:\(([^)]*(?:Time|UTC)[^)]*)\))?\s*(?:\((-?\d+)\))?/i);
  return { isPdh: Boolean(match), timezoneName: match?.[1] || "Local time", biasMinutes: match?.[2] === undefined ? null : Number(match[2]) };
}

function parseLocalTimestamp(value, biasMinutes) {
  const text = String(value || "").trim().replace(/^"|"$/g, "");
  const match = text.match(/^(\d{1,4})[\/-](\d{1,2})[\/-](\d{1,4})[ T](\d{1,2}):(\d{2}):(\d{2})(?:[.,](\d+))?(?:\s*(AM|PM))?$/i);
  if (!match) {
    const parsed = Date.parse(text);
    return Number.isFinite(parsed) ? parsed / 1000 : NaN;
  }
  let first = Number(match[1]), month = Number(match[2]), third = Number(match[3]);
  let year, day;
  if (match[1].length === 4) { year = first; day = third; }
  else { month = first; day = Number(match[2]); year = third; }
  if (year < 100) year += year >= 70 ? 1900 : 2000;
  let hour = Number(match[4]);
  if (match[8]) { hour %= 12; if (match[8].toUpperCase() === "PM") hour += 12; }
  const milliseconds = Number(`0.${match[7] || 0}`) * 1000;
  if (Number.isFinite(biasMinutes)) return (Date.UTC(year, month - 1, day, hour, Number(match[5]), Number(match[6]), milliseconds) + biasMinutes * 60000) / 1000;
  return new Date(year, month - 1, day, hour, Number(match[5]), Number(match[6]), milliseconds).getTime() / 1000;
}

function counterDefinition(header) {
  const normalized = String(header).trim().replace(/\x00/g, "");
  return COUNTERS.find(definition => definition.suffix.test(normalized)) || null;
}

function hostFromCounter(header) {
  return String(header).match(/^\\\\([^\\]+)\\/)?.[1] || "";
}

function parseNumber(value) {
  const normalized = String(value ?? "").trim().replace(/^"|"$/g, "");
  if (!normalized || /^-?1\.#[A-Z]+$/i.test(normalized)) return NaN;
  const number = Number(normalized);
  return Number.isFinite(number) ? number : NaN;
}

async function readLocalText(file) {
  const bytes = new Uint8Array(await file.arrayBuffer());
  const utf16le = bytes[0] === 0xff && bytes[1] === 0xfe;
  const utf16be = bytes[0] === 0xfe && bytes[1] === 0xff;
  if (utf16le || (!utf16be && bytes[1] === 0 && bytes[3] === 0)) return new TextDecoder("utf-16le").decode(bytes.subarray(utf16le ? 2 : 0));
  if (utf16be || (bytes[0] === 0 && bytes[2] === 0)) {
    const swapped = bytes.slice(utf16be ? 2 : 0);
    for (let index = 0; index + 1 < swapped.length; index += 2) [swapped[index], swapped[index + 1]] = [swapped[index + 1], swapped[index]];
    return new TextDecoder("utf-16le").decode(swapped);
  }
  return new TextDecoder("utf-8").decode(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf ? bytes.subarray(3) : bytes);
}

function seriesId(sourceId, column) { return `${sourceId}:counter:${column}`; }

function parsePdhCsv(text, file) {
  const rows = parseCsv(text);
  if (rows.length < 2) throw new Error("CSV does not contain a header and data rows.");
  const pdh = parsePdhHeader(rows[0][0]);
  const headerRowIndex = pdh.isPdh && rows[0].length === 1 ? 1 : 0;
  const headers = rows[headerRowIndex].map(value => value.replace(/^\ufeff/, "").trim());
  const timeIndex = pdh.isPdh && rows[0].length > 1 ? 0 : Math.max(0, headers.findIndex(header => /^(timestamp|date|time|\(PDH-CSV)/i.test(header)));
  const columns = headers.map((header, index) => ({ header, index, definition: index === timeIndex ? null : counterDefinition(header) })).filter(item => item.definition);
  if (!columns.length) throw new Error("No supported performance counters were found. See README.md for selected suffixes.");
  const sourceId = crypto.randomUUID();
  const parsedSeries = columns.map((column, index) => ({
    id: seriesId(sourceId, column.index), sourceId, path: column.header, host: hostFromCounter(column.header), kind: column.definition.kind,
    label: column.definition.label, unit: column.definition.unit, color: COLORS[index % COLORS.length], points: []
  }));
  const dataStart = pdh.isPdh && rows[0].length === 1 ? 2 : 1;
  let invalidTimes = 0;
  for (let rowIndex = dataStart; rowIndex < rows.length; rowIndex++) {
    const row = rows[rowIndex];
    const timestamp = parseLocalTimestamp(row[timeIndex], pdh.biasMinutes);
    if (!Number.isFinite(timestamp)) { invalidTimes++; continue; }
    columns.forEach((column, index) => {
      const value = parseNumber(row[column.index]);
      if (Number.isFinite(value)) parsedSeries[index].points.push({ timestamp, value });
    });
  }
  parsedSeries.forEach(series => series.points.sort((a, b) => a.timestamp - b.timestamp));
  parsedSeries.filter(series => series.kind === "tcpResets").forEach(series => {
    series.points = series.points.map((point, index, points) => {
      if (!index) return { timestamp: point.timestamp, value: 0, delta: 0 };
      const elapsedSeconds = point.timestamp - points[index - 1].timestamp;
      const delta = point.value >= points[index - 1].value ? point.value - points[index - 1].value : 0;
      return { timestamp: point.timestamp, value: elapsedSeconds > 0 ? delta / elapsedSeconds : 0, delta };
    });
  });
  const populated = parsedSeries.filter(series => series.points.length);
  if (!populated.length) throw new Error("Supported counters were present, but no numeric samples could be parsed.");
  const timestamps = populated.flatMap(series => [series.points[0].timestamp, series.points.at(-1).timestamp]);
  const host = populated.find(series => series.host)?.host || "";
  return {
    source: { id: sourceId, name: file.name, type: "Performance Monitor CSV", host, importedAt: new Date().toISOString(), timezone: pdh.timezoneName, biasMinutes: pdh.biasMinutes, start: Math.min(...timestamps), end: Math.max(...timestamps), records: Math.max(...populated.map(series => series.points.length)), selectedCount: populated.length, detail: `${pdh.timezoneName}${pdh.biasMinutes === null ? "" : ` · UTC bias ${pdh.biasMinutes} min`}${invalidTimes ? ` · ${invalidTimes} invalid timestamps skipped` : ""}`, status: "Parsed" },
    series: populated,
    findings: []
  };
}

function firstElementText(documentNode, names) {
  for (const name of names) {
    const element = documentNode.getElementsByTagName(name)[0];
    if (element?.textContent.trim()) return element.textContent.trim();
  }
  return "";
}

function parseXmlTimestamp(documentNode, fallback = 0) {
  const value = firstElementText(documentNode, ["ReportTime", "GeneratedTime", "CollectionTime", "StartTime", "TimeCreated"]);
  const timestamp = Date.parse(value);
  return Number.isFinite(timestamp) ? timestamp / 1000 : fallback;
}

function severityFromText(text, fallback = "info") {
  if (/critical|fatal/i.test(text)) return "critical";
  if (/error|failed|failure/i.test(text)) return "error";
  if (/warn|degraded|problem/i.test(text)) return "warning";
  return fallback;
}

function parseDiagnosticsXml(text, file) {
  const documentNode = new DOMParser().parseFromString(text, "application/xml");
  const parseError = documentNode.querySelector("parsererror");
  if (parseError) throw new Error("XML is not well formed.");
  const report = [...documentNode.getElementsByTagName("Report")].find(element => element.getAttribute("name") === "systemDiagnostics");
  if (!report) throw new Error("XML does not contain a systemDiagnostics report.");
  const sourceId = crypto.randomUUID();
  const host = firstElementText(documentNode, ["ComputerName", "MachineName", "HostName"]);
  const timestamp = parseXmlTimestamp(documentNode, Number(file.lastModified) / 1000 || 0);
  const findings = [];
  const seen = new Set();
  const localName = element => element.localName || element.tagName.split(":").at(-1);
  const advice = [...report.getElementsByTagName("*")].find(element => localName(element) === "Section" && element.getAttribute("name") === "advice");
  const candidates = advice ? [...advice.children].filter(element => /^(warning|info)$/i.test(element.getAttribute("name") || localName(element))).flatMap(table => [...table.getElementsByTagName("*")].filter(element => localName(element) === "Item").map(element => ({ element, table }))) : [];
  candidates.forEach(({ element, table }, index) => {
    const fields = Object.fromEntries([...element.children].map(child => [child.getAttribute("name") || localName(child), child.textContent.replace(/\s+/g, " ").trim()]));
    const title = fields.symptom || fields.title || "System diagnostics advice";
    const detail = fields.details || element.textContent.replace(/\s+/g, " ").trim();
    if (detail.length < 12 || detail.length > 4000) return;
    const key = `${title}\n${detail}`.toLowerCase();
    if (seen.has(key)) return;
    seen.add(key);
    const declaredSeverity = String(fields.severity || "").toLowerCase();
    const severity = ["critical", "error", "warning", "info"].includes(declaredSeverity) ? declaredSeverity : severityFromText(table.getAttribute("name") || localName(table));
    findings.push(makeFinding({ sourceId, timestamp, source: "System Diagnostics", category: "diagnostics", severity, host, summary: title, detail, evidence: { file: file.name, xmlElement: "Section/advice/Item", table: table.getAttribute("name") || localName(table), ordinal: index + 1 } }));
  });
  candidates.forEach(({ element }) => {
    const itemText = element.textContent.replace(/\s+/g, " ");
    if (!/(?:ETW|Event Tracing for Windows)/i.test(itemText) || !/(?:lost|loss)/i.test(itemText)) return;
    const lossMatch = itemText.match(/(\d+(?:\.\d+)?)\s*%[^%]{0,200}?(?:lost|loss)/i) || itemText.match(/(?:lost|loss)[^%]{0,200}?(\d+(?:\.\d+)?)\s*%/i);
    const percent = Number(lossMatch?.[1]);
    if (!Number.isFinite(percent)) return;
    const severity = percent > 20 ? "critical" : percent > 5 ? "error" : percent > 0 ? "warning" : "info";
    const key = `etw-loss-${percent}`;
    if (seen.has(key)) return;
    seen.add(key);
    findings.push(makeFinding({ sourceId, timestamp, source: "System Diagnostics", category: "data-quality", severity, host, summary: `ETW event loss measured at ${percent}%`, detail: "Trace event loss reduces diagnostic completeness and can hide causal activity.", evidence: { file: file.name, metric: "etwLossPercent", value: percent, thresholds: { warning: "> 0%", error: "> 5%", critical: "> 20%" } } }));
  });
  const source = { id: sourceId, name: file.name, type: "System Diagnostics XML", host, importedAt: new Date().toISOString(), timezone: "Timestamp from report", biasMinutes: null, start: timestamp, end: timestamp, records: findings.length, selectedCount: findings.length, detail: `${findings.length} advice or diagnostic items`, status: findings.length ? "Parsed" : "No advice found" };
  return { source, series: [], findings };
}

function makeFinding(fields) {
  return { id: crypto.randomUUID(), timestamp: fields.timestamp, sourceId: fields.sourceId, source: fields.source || "DataSnare-AIPerf", category: fields.category || "performance", severity: fields.severity || "info", host: fields.host || "", process: fields.process || "", summary: fields.summary, detail: fields.detail || "", evidence: fields.evidence || {} };
}

function percentile(values, fraction) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.max(0, Math.min(sorted.length - 1, Math.ceil(sorted.length * fraction) - 1))];
}

function sustainedRanges(points, predicate) {
  const ranges = [];
  let active = [];
  const flush = () => {
    if (active.length >= 3) {
      const duration = active.at(-1).timestamp - active[0].timestamp;
      if (duration >= 30 || (points.length >= 3 && points.at(-1).timestamp - points[0].timestamp < 30)) ranges.push([...active]);
    }
    active = [];
  };
  points.forEach(point => { if (predicate(point.value)) active.push(point); else flush(); });
  flush();
  return ranges;
}

function thresholdFinding(series, definition, threshold, severity) {
  const predicate = definition.direction === "low" ? value => value < threshold : threshold === 0 ? value => value > 0 : value => value >= threshold;
  const ranges = sustainedRanges(series.points, predicate);
  if (!ranges.length) return null;
  const range = ranges.reduce((longest, candidate) => candidate.length > longest.length ? candidate : longest, ranges[0]);
  const values = range.map(point => point.value);
  const observed = definition.direction === "low" ? Math.min(...values) : Math.max(...values);
  const relation = definition.direction === "low" ? "below" : "above";
  return makeFinding({
    sourceId: series.sourceId, timestamp: range[0].timestamp, source: "Performance Monitor", category: series.kind, severity, host: series.host,
    summary: `${series.label} sustained ${relation} ${formatValue(threshold, series.unit)}`,
    detail: `${range.length} consecutive samples over ${formatDuration(range.at(-1).timestamp - range[0].timestamp)}; observed ${formatValue(observed, series.unit)}.`,
    evidence: { counter: series.path, threshold, direction: definition.direction, observed, sampleCount: range.length, start: range[0].timestamp, end: range.at(-1).timestamp }
  });
}

function analyzeSeries() {
  const findings = [];
  state.series.forEach(series => {
    let definition = COUNTERS.find(item => item.kind === series.kind && item.suffix.test(series.path));
    if (!definition || definition.high === null) return;
    if (series.kind === "queue") {
      const processorCount = state.series.find(item => item.sourceId === series.sourceId && item.kind === "processorCount")?.points.find(point => point.value > 0)?.value;
      if (processorCount) definition = { ...definition, high: processorCount * 2, critical: processorCount * 4 };
    }
    const critical = definition.critical === null ? null : thresholdFinding(series, definition, definition.critical, "critical");
    const warning = thresholdFinding(series, definition, definition.high, "warning");
    findings.push(critical || warning);
  });
  const bandwidth = state.series.filter(series => series.kind === "netBandwidth");
  state.series.filter(series => series.kind === "netBytes").forEach(bytesSeries => {
    const interfaceName = bytesSeries.path.match(/\\network interface\(([^)]*)\)/i)?.[1];
    const capacitySeries = bandwidth.find(series => series.sourceId === bytesSeries.sourceId && series.path.includes(`Network Interface(${interfaceName})`));
    if (!capacitySeries) return;
    const capacityByTime = new Map(capacitySeries.points.map(point => [point.timestamp, point.value]));
    const utilization = bytesSeries.points.map(point => ({ timestamp: point.timestamp, value: capacityByTime.get(point.timestamp) ? point.value * 8 / capacityByTime.get(point.timestamp) * 100 : NaN })).filter(point => Number.isFinite(point.value));
    const finding = thresholdFinding({ ...bytesSeries, points: utilization, unit: "%", label: `${interfaceName || "Interface"} utilization`, kind: "network" }, { direction: "high" }, 80, "warning");
    if (finding) findings.push(finding);
  });
  return findings.filter(Boolean);
}

function formatValue(value, unit) {
  if (!Number.isFinite(value)) return "—";
  if (unit === "%") return `${value.toFixed(value < 10 ? 1 : 0)}%`;
  if (unit === "s") return `${(value * 1000).toFixed(value < .01 ? 1 : 0)} ms`;
  if (unit === "B/s") return `${formatBytes(value)}/s`;
  if (unit === "bit/s") return formatBits(value);
  return `${value.toFixed(Math.abs(value) < 10 ? 2 : 0)}${unit ? ` ${unit}` : ""}`;
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value <= 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatBits(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} Gbit/s`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} Mbit/s`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kbit/s`;
  return `${Math.round(value)} bit/s`;
}

function formatDuration(seconds) {
  if (!Number.isFinite(seconds)) return "—";
  if (seconds < 60) return `${Math.round(seconds)}s`;
  if (seconds < 3600) return `${(seconds / 60).toFixed(1)}m`;
  return `${(seconds / 3600).toFixed(1)}h`;
}

function formatTime(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toLocaleString(undefined, { hour12: false, year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—";
}

function metricSummary(kind, statistic = "max") {
  const values = state.series.filter(series => series.kind === kind).flatMap(series => series.points.map(point => point.value));
  if (!values.length) return NaN;
  return statistic === "p95" ? percentile(values, .95) : Math.max(...values);
}

function renderKpis() {
  const cpu = metricSummary("cpu");
  const memory = metricSummary("memory");
  const diskValues = [metricSummary("diskRead", "p95"), metricSummary("diskWrite", "p95")].filter(Number.isFinite);
  const disk = diskValues.length ? Math.max(...diskValues) : NaN;
  $("#kpiCpu").textContent = formatValue(cpu, "%");
  $("#kpiCpuDetail").textContent = Number.isFinite(cpu) ? "Maximum selected sample" : "CPU total not found";
  $("#kpiMemory").textContent = formatValue(memory, "%");
  $("#kpiMemoryDetail").textContent = Number.isFinite(memory) ? "Maximum committed bytes" : "Committed memory not found";
  $("#kpiDisk").textContent = formatValue(disk, "s");
  $("#kpiDiskDetail").textContent = Number.isFinite(disk) ? "Read/write sample p95" : "Disk latency not found";
  $("#kpiFindings").textContent = state.findings.length;
  const severe = state.findings.filter(item => ["critical", "error"].includes(item.severity)).length;
  $("#kpiFindingDetail").textContent = severe ? `${severe} critical or error` : `${state.findings.filter(item => item.severity === "warning").length} warnings`;
}

function renderFindings() {
  const rank = { critical: 0, error: 1, warning: 2, info: 3 };
  const findings = [...state.findings].sort((a, b) => (rank[a.severity] ?? 4) - (rank[b.severity] ?? 4) || a.timestamp - b.timestamp);
  $("#findingList").innerHTML = findings.map(finding => `<article class="finding"><span class="severity ${finding.severity}">${finding.severity}</span><div><strong>${escapeHtml(finding.summary)}</strong><small>${escapeHtml(finding.detail)}<br>${escapeHtml(formatTime(finding.timestamp))} · ${escapeHtml(finding.host || finding.source)}</small></div></article>`).join("") || `<article class="finding"><span class="severity info">info</span><div><strong>No deterministic threshold breaches</strong><small>Review the chart and source coverage before concluding the system was healthy.</small></div></article>`;
  $("#findingCount").textContent = `${findings.length} findings`;
}

function renderSources() {
  $("#sourceRows").innerHTML = state.sources.map(source => `<tr><td>${escapeHtml(source.name)}</td><td>${escapeHtml(source.type)}</td><td>${escapeHtml(source.host || "—")}</td><td>${escapeHtml(formatTime(source.start))}${source.end !== source.start ? `<br><span class="source-detail">${escapeHtml(formatDuration(source.end - source.start))}</span>` : ""}</td><td>${source.records.toLocaleString()}</td><td class="source-detail">${source.selectedCount.toLocaleString()} · ${escapeHtml(source.detail)}</td><td><span class="badge ${source.status === "Parsed" ? "" : "warn"}">${escapeHtml(source.status)}</span></td></tr>`).join("");
  $("#sourceCount").textContent = `${state.sources.length} sources`;
}

function renderCounters() {
  $("#counterGrid").innerHTML = state.series.map(series => {
    const values = series.points.map(point => point.value);
    return `<article class="counter-card" title="${escapeHtml(series.path)}"><strong>${escapeHtml(series.label)}</strong><span>${escapeHtml(formatValue(percentile(values, .95), series.unit))}</span><small>p95 · ${series.points.length.toLocaleString()} samples<br>${escapeHtml(series.host || "Unknown host")}</small></article>`;
  }).join("") || `<article class="counter-card"><strong>No counters</strong><span>—</span><small>XML advice can still produce findings.</small></article>`;
  $("#counterCount").textContent = `${state.series.length} series`;
}

function populateMetricSelect() {
  const select = $("#metricSelect");
  const prior = state.selectedSeriesId;
  select.innerHTML = state.series.map(series => `<option value="${escapeHtml(series.id)}">${escapeHtml(series.label)} · ${escapeHtml(series.host || "host")} · ${escapeHtml(series.path.split("\\").at(-1))}</option>`).join("");
  state.selectedSeriesId = state.series.some(series => series.id === prior) ? prior : state.series[0]?.id || null;
  select.value = state.selectedSeriesId || "";
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  const width = rect.width || canvas.parentElement?.clientWidth || 0;
  const height = rect.height || canvas.clientHeight || Number.parseFloat(getComputedStyle(canvas).height) || 0;
  if (width <= 0 || height <= 0) return { context: null, width, height };
  canvas.width = Math.floor(width * ratio);
  canvas.height = Math.floor(height * ratio);
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  return { context, width, height };
}

function scheduleTimelineDraw() {
  cancelAnimationFrame(scheduleTimelineDraw.frame);
  scheduleTimelineDraw.frame = requestAnimationFrame(() => { scheduleTimelineDraw.frame = requestAnimationFrame(drawTimeline); });
}

function drawTimeline() {
  const canvas = $("#timelineCanvas");
  const { context, width, height } = setupCanvas(canvas);
  if (!context) return;
  const series = state.series.find(item => item.id === state.selectedSeriesId);
  context.fillStyle = "#fbfaf6";
  context.fillRect(0, 0, width, height);
  state.hoverTargets = [];
  if (!series?.points.length) {
    context.fillStyle = "#69716b"; context.font = "10px DM Mono"; context.textAlign = "center";
    context.fillText("No time-series counter selected", width / 2, height / 2); context.textAlign = "left";
    return;
  }
  const points = series.points;
  const left = 64, right = 22, top = 24, bottom = 43;
  const minTime = points[0].timestamp, maxTime = points.at(-1).timestamp;
  let minValue = Math.min(...points.map(point => point.value)), maxValue = Math.max(...points.map(point => point.value));
  if (minValue === maxValue) { minValue -= Math.abs(minValue || 1) * .1; maxValue += Math.abs(maxValue || 1) * .1; }
  const chartWidth = Math.max(1, width - left - right), chartHeight = Math.max(1, height - top - bottom);
  context.font = "9px DM Mono"; context.lineWidth = 1;
  for (let index = 0; index <= 4; index++) {
    const y = top + chartHeight * index / 4;
    const value = maxValue - (maxValue - minValue) * index / 4;
    context.strokeStyle = "#d7dad3"; context.beginPath(); context.moveTo(left, y); context.lineTo(width - right, y); context.stroke();
    context.fillStyle = "#69716b"; context.textAlign = "right"; context.fillText(formatValue(value, series.unit), left - 8, y + 3);
  }
  const xFor = timestamp => left + (timestamp - minTime) / Math.max(1, maxTime - minTime) * chartWidth;
  const yFor = value => top + (maxValue - value) / Math.max(Number.EPSILON, maxValue - minValue) * chartHeight;
  const step = Math.max(1, Math.ceil(points.length / Math.max(2000, width * 2)));
  const drawn = points.filter((_, index) => index % step === 0 || index === points.length - 1);
  context.beginPath();
  drawn.forEach((point, index) => { const x = xFor(point.timestamp), y = yFor(point.value); if (index) context.lineTo(x, y); else context.moveTo(x, y); });
  context.strokeStyle = series.color; context.lineWidth = 2; context.stroke();
  context.lineTo(xFor(drawn.at(-1).timestamp), top + chartHeight); context.lineTo(xFor(drawn[0].timestamp), top + chartHeight); context.closePath();
  context.fillStyle = `${series.color}18`; context.fill();
  state.hoverTargets = drawn.map(point => ({ point, x: xFor(point.timestamp), y: yFor(point.value), series }));
  context.fillStyle = "#69716b"; context.textAlign = "left"; context.fillText(formatTime(minTime), left, height - 14);
  const end = formatTime(maxTime); context.textAlign = "right"; context.fillText(end, width - right, height - 14); context.textAlign = "left";
}

function showChartTooltip(mouseEvent) {
  const rect = $("#timelineCanvas").getBoundingClientRect();
  const x = mouseEvent.clientX - rect.left;
  let target = null, distance = Infinity;
  state.hoverTargets.forEach(candidate => { const candidateDistance = Math.abs(candidate.x - x); if (candidateDistance < distance) { target = candidate; distance = candidateDistance; } });
  const tooltip = $("#chartTooltip");
  if (!target || distance > 18) { tooltip.hidden = true; return; }
  tooltip.innerHTML = `<strong>${escapeHtml(formatValue(target.point.value, target.series.unit))}</strong><span>${escapeHtml(formatTime(target.point.timestamp))}</span><span>${escapeHtml(target.series.path)}</span>`;
  tooltip.hidden = false;
  const tip = tooltip.getBoundingClientRect();
  tooltip.style.left = `${Math.max(8, Math.min(rect.width - tip.width - 8, target.x + 10))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(rect.height - tip.height - 8, target.y - tip.height / 2))}px`;
}

function renderAll() {
  state.findings = [...state.findings.filter(finding => finding.source !== "Performance Monitor"), ...analyzeSeries()];
  $("#emptyState").hidden = state.sources.length > 0;
  $("#dashboard").hidden = state.sources.length === 0;
  $("#statusDot").classList.toggle("live", state.sources.length > 0);
  $("#statusTitle").textContent = state.sources.length ? `${state.sources.length} source${state.sources.length === 1 ? "" : "s"} loaded` : "No evidence loaded";
  $("#statusDetail").textContent = state.sources.length ? `${state.series.length} selected counter series · ${state.findings.length} findings · all processing local` : "Files remain local to this browser tab.";
  $("#exportButton").disabled = state.sources.length === 0;
  populateMetricSelect(); renderKpis(); renderFindings(); renderSources(); renderCounters();
  scheduleTimelineDraw();
}

async function importFiles(files) {
  let imported = 0;
  for (const file of files) {
    try {
      const text = await readLocalText(file);
      const result = file.name.toLowerCase().endsWith(".xml") ? parseDiagnosticsXml(text, file) : parsePdhCsv(text, file);
      state.sources.push(result.source); state.series.push(...result.series); state.findings.push(...result.findings); imported++;
    } catch (error) { showToast(`${file.name}: ${error.message}`); }
  }
  if (imported) { renderAll(); showToast(`${imported} source${imported === 1 ? "" : "s"} imported locally.`); }
}

function loadDemo() {
  clearData(false);
  const sourceId = crypto.randomUUID();
  const start = Date.now() / 1000 - 15 * 60;
  const make = (kind, label, path, unit, valueAt, color) => ({ id: `${sourceId}:${kind}`, sourceId, path, host: "DEMO-SQL01", kind, label, unit, color, points: Array.from({ length: 61 }, (_, index) => ({ timestamp: start + index * 15, value: valueAt(index) })) });
  state.series = [
    make("cpu", "CPU total", "\\\\DEMO-SQL01\\Processor(_Total)\\% Processor Time", "%", index => 43 + Math.sin(index / 4) * 10 + (index > 20 && index < 42 ? 45 : 0), COLORS[0]),
    make("queue", "Processor queue", "\\\\DEMO-SQL01\\System\\Processor Queue Length", "", index => index > 23 && index < 40 ? 6 + Math.sin(index) : 1, COLORS[2]),
    make("memory", "Memory committed", "\\\\DEMO-SQL01\\Memory\\% Committed Bytes In Use", "%", index => 62 + index * .47, COLORS[4]),
    make("available", "Available memory", "\\\\DEMO-SQL01\\Memory\\Available MBytes", "MB", index => 2600 - index * 38, COLORS[3]),
    make("diskRead", "Disk read latency", "\\\\DEMO-SQL01\\PhysicalDisk(_Total)\\Avg. Disk sec/Read", "s", index => .008 + (index > 27 && index < 45 ? .055 : Math.sin(index) * .002), COLORS[1]),
    make("diskWrite", "Disk write latency", "\\\\DEMO-SQL01\\PhysicalDisk(_Total)\\Avg. Disk sec/Write", "s", index => .012 + (index > 30 && index < 44 ? .035 : 0), COLORS[5]),
    make("tcpResets", "TCP resets", "\\\\DEMO-SQL01\\TCPv4\\Connections Reset", "/s", index => index > 32 && index < 38 ? 3 : 0, COLORS[1])
  ];
  state.sources = [{ id: sourceId, name: "demo-perfmon.csv", type: "Performance Monitor CSV", host: "DEMO-SQL01", importedAt: new Date().toISOString(), timezone: "Central Daylight Time", biasMinutes: 300, start, end: start + 900, records: 61, selectedCount: state.series.length, detail: "Synthetic 15-second samples · UTC bias 300 min", status: "Parsed" }];
  state.findings = [makeFinding({ sourceId, timestamp: start + 34 * 15, source: "System Diagnostics", category: "data-quality", severity: "error", host: "DEMO-SQL01", summary: "ETW event loss measured at 8.4%", detail: "Trace event loss reduces diagnostic completeness and can hide causal activity.", evidence: { file: "demo-report.xml", metric: "etwLossPercent", value: 8.4 } })];
  renderAll(); showToast("Demo performance incident loaded.");
}

function clearData(render = true) {
  state.sources = []; state.series = []; state.findings = []; state.selectedSeriesId = null;
  if (render) renderAll();
}

function coreExportContext() {
  return window.DataSnareCoreContext?.exportMetadata?.("aiperf") || null;
}

function buildExportDocument() {
  return {
    schema: "datasnare-aiperf/events-v1",
    generatedAt: new Date().toISOString(),
    tool: { name: "DataSnare-AIPerf", version: "1.0.0" },
    coreContext: coreExportContext(),
    sources: state.sources.map(source => ({ id: source.id, name: source.name, type: source.type, host: source.host, importedAt: source.importedAt, timezone: source.timezone, biasMinutes: source.biasMinutes, start: source.start, end: source.end, records: source.records })),
    events: state.findings.map(finding => ({ id: finding.id, timestamp: finding.timestamp, source: finding.source, category: finding.category, severity: finding.severity, host: finding.host, process: finding.process, summary: finding.summary, detail: finding.detail, evidence: finding.evidence }))
  };
}

function exportEvents() {
  const documentData = buildExportDocument();
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(documentData, null, 2)], { type: "application/json" }));
  link.download = `datasnare-aiperf-${new Date().toISOString().replace(/[:.]/g, "-")}.json`;
  link.click(); URL.revokeObjectURL(link.href);
}

$("#fileInput").addEventListener("change", event => { const files = [...event.target.files]; event.target.value = ""; importFiles(files); });
const dropZone = $("#dropZone");
["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add("dragging"); }));
["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
dropZone.addEventListener("drop", event => importFiles(event.dataTransfer.files));
$("#demoButton").addEventListener("click", loadDemo);
$("#clearButton").addEventListener("click", () => clearData());
$("#exportButton").addEventListener("click", exportEvents);
$("#metricSelect").addEventListener("change", event => { state.selectedSeriesId = event.target.value; scheduleTimelineDraw(); });
$("#timelineCanvas").addEventListener("mousemove", showChartTooltip);
$("#timelineCanvas").addEventListener("mouseleave", () => $("#chartTooltip").hidden = true);
window.addEventListener("resize", () => { if (!$("#dashboard").hidden) scheduleTimelineDraw(); });

renderAll();
window.DataSnareAIPerf = Object.freeze({ schema: "datasnare-aiperf/events-v1", parseCsv, parsePdhCsv, parseDiagnosticsXml, buildExportDocument, export: buildExportDocument, get coreContext() { return coreExportContext(); } });
