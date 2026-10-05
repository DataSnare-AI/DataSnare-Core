"use strict";

const $ = selector => document.querySelector(selector);
const COLORS = ["#1d6b4f", "#e86d4c", "#4182a4", "#e2ac45", "#779245", "#865b70"];
const MAX_RETAINED_EVENTS = 2000;
const MAX_RENDERED_ROWS = 500;
const FAILURE_RESULTS = new Set(["ACCESS DENIED", "SHARING VIOLATION", "NAME NOT FOUND", "PATH NOT FOUND"]);
const MUTATION_OPERATIONS = /^(WriteFile|SetEndOfFileInformationFile|SetRenameInformationFile|SetDispositionInformationFile|CreateFileMapping|RegSetValue|RegCreateKey|RegDeleteKey|RegDeleteValue)/i;
const NETWORK_OPERATIONS = /^(TCP|UDP)\s+(Connect|Send|Receive|Reconnect|Accept|Disconnect)/i;

let importSession = null;
let toastTimer = 0;
let state = createEmptyState();

function createEmptyState() {
  return {
    source: null,
    captureDate: "",
    timezoneOffset: "",
    fingerprint: "",
    total: 0,
    failures: 0,
    firstMs: Infinity,
    lastMs: -Infinity,
    firstTimestamp: null,
    lastTimestamp: null,
    processes: new Map(),
    operations: new Map(),
    results: new Map(),
    timeline: new Map(),
    retained: [],
    findings: [],
    resultEvidence: new Map(),
    missingBursts: new Map(),
    slowEvents: [],
    mutations: { file: 0, registry: 0 },
    lifecycle: { starts: 0, exits: 0 },
    network: [],
    durationAvailable: false
  };
}

function setDefaultContext() {
  const now = new Date();
  const localDate = new Date(now.getTime() - now.getTimezoneOffset() * 60000).toISOString().slice(0, 10);
  const offsetMinutes = -now.getTimezoneOffset();
  const sign = offsetMinutes >= 0 ? "+" : "-";
  const absolute = Math.abs(offsetMinutes);
  $("#captureDate").value = localDate;
  $("#timezoneOffset").value = `${sign}${String(Math.floor(absolute / 60)).padStart(2, "0")}:${String(absolute % 60).padStart(2, "0")}`;
}

function parseOffset(value) {
  const match = String(value).trim().match(/^([+-])(\d{2}):(\d{2})$/);
  if (!match || Number(match[2]) > 14 || Number(match[3]) > 59) throw new Error("UTC offset must use +HH:MM or -HH:MM format.");
  return (match[1] === "+" ? 1 : -1) * (Number(match[2]) * 60 + Number(match[3]));
}

function validateContext() {
  const date = $("#captureDate").value;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error("Choose the actual ProcMon capture date before importing.");
  const offsetMinutes = parseOffset($("#timezoneOffset").value);
  return { date, offset: $("#timezoneOffset").value.trim(), offsetMinutes };
}

function parseProcMonTime(value, context) {
  const match = String(value).trim().match(/^(\d{1,2}):(\d{2}):(\d{2})(?:\.(\d{1,9}))?\s*(AM|PM)?$/i);
  if (!match) throw new Error(`Unrecognized Time of Day: ${value}`);
  let hour = Number(match[1]);
  if (match[5]) { hour %= 12; if (match[5].toUpperCase() === "PM") hour += 12; }
  if (hour > 23 || Number(match[2]) > 59 || Number(match[3]) > 59) throw new Error(`Invalid Time of Day: ${value}`);
  const [year, month, day] = context.date.split("-").map(Number);
  const wholeSecondMs = Date.UTC(year, month - 1, day, hour, Number(match[2]), Number(match[3])) - context.offsetMinutes * 60000;
  const fraction9 = (match[4] || "").padEnd(9, "0").slice(0, 9);
  const timestampNs = BigInt(wholeSecondMs) * 1000000n + BigInt(fraction9 || "0");
  const timestampMs = wholeSecondMs + Number(fraction9) / 1000000;
  const isoBase = new Date(wholeSecondMs).toISOString().replace(".000Z", "");
  return { timestampMs, timestampNs: timestampNs.toString(), timestamp: `${isoBase}.${fraction9 || "000000000"}Z` };
}

function parseCsvRecord(record) {
  const fields = [];
  let value = "";
  let quoted = false;
  for (let index = 0; index < record.length; index++) {
    const character = record[index];
    if (character === '"') {
      if (quoted && record[index + 1] === '"') { value += '"'; index++; }
      else quoted = !quoted;
    } else if (character === "," && !quoted) {
      fields.push(value);
      value = "";
    } else {
      value += character;
    }
  }
  if (quoted) throw new Error("CSV record ended inside a quoted field.");
  fields.push(value);
  return fields;
}

function findCompleteRecord(buffer) {
  let quoted = false;
  for (let index = 0; index < buffer.length; index++) {
    if (buffer[index] === '"') {
      if (quoted && buffer[index + 1] === '"') index++;
      else quoted = !quoted;
    } else if (!quoted && (buffer[index] === "\n" || buffer[index] === "\r")) {
      const length = buffer[index] === "\r" && buffer[index + 1] === "\n" ? 2 : 1;
      return { record: buffer.slice(0, index), rest: buffer.slice(index + length) };
    }
  }
  return null;
}

function normalizeHeaders(values) {
  return values.map((value, index) => (index === 0 ? value.replace(/^\uFEFF/, "") : value).trim());
}

function makeRow(headers, values) {
  const row = {};
  headers.forEach((header, index) => { row[header] = values[index] ?? ""; });
  return row;
}

function parseDuration(row) {
  const explicit = row.Duration || row["Duration (seconds)"];
  const detailMatch = String(row.Detail || "").match(/(?:^|,\s*)Duration:\s*([\d.]+)/i);
  const value = Number(explicit || detailMatch?.[1]);
  return Number.isFinite(value) && value >= 0 ? value : null;
}

function isFailure(result) {
  const normalized = String(result || "").trim().toUpperCase();
  return normalized !== "SUCCESS" && normalized !== "";
}

function increment(map, key, amount = 1) {
  map.set(key, (map.get(key) || 0) + amount);
}

function stableId(prefix, rowNumber) {
  return `${prefix}-${state.fingerprint.slice(0, 16)}-${rowNumber}`;
}

function retainEvent(event) {
  const salient = event.failure || event.durationSeconds >= .05 || MUTATION_OPERATIONS.test(event.operation) || /Process (Create|Start|Exit)/i.test(event.operation) || NETWORK_OPERATIONS.test(event.operation);
  if (state.retained.length < MAX_RETAINED_EVENTS) {
    state.retained.push(event);
  } else if (salient) {
    const replaceIndex = state.retained.findIndex(item => !item.salient);
    if (replaceIndex >= 0) state.retained[replaceIndex] = event;
  }
  event.salient = salient;
}

function parseNetworkObservation(event) {
  if (!NETWORK_OPERATIONS.test(event.operation) || state.network.length >= 5000) return;
  const endpointPattern = /(\[[^\]]+\]|[\w.:%-]+):(\d+)/g;
  const endpoints = [...`${event.path} ${event.detail}`.matchAll(endpointPattern)].map(match => ({ address: match[1].replace(/^\[|\]$/g, ""), port: Number(match[2]) }));
  const transport = event.operation.toUpperCase().startsWith("UDP") ? "UDP" : "TCP";
  state.network.push({
    timestamp: event.timestamp,
    timestampNanoseconds: event.timestampNanoseconds,
    protocol: transport,
    localAddress: endpoints[0]?.address || "*",
    localPort: endpoints[0]?.port || null,
    remoteAddress: endpoints[1]?.address || "*",
    remotePort: endpoints[1]?.port || null,
    state: event.operation.replace(/^(TCP|UDP)\s+/i, ""),
    pid: event.pid,
    process: event.process,
    executable: "",
    user: "",
    source: "ProcMon"
  });
}

function ingestRow(row, rowNumber, context) {
  const required = ["Time of Day", "Process Name", "PID", "Operation", "Path", "Result", "Detail"];
  if (rowNumber === 1) {
    const missing = required.filter(header => !(header in row));
    if (missing.length) throw new Error(`Missing required ProcMon columns: ${missing.join(", ")}`);
  }
  const parsedTime = parseProcMonTime(row["Time of Day"], context);
  const process = String(row["Process Name"] || "Unknown").trim();
  const pid = Number.parseInt(row.PID, 10) || null;
  const operation = String(row.Operation || "Unknown").trim();
  const path = String(row.Path || "").trim();
  const result = String(row.Result || "").trim() || "UNKNOWN";
  const detail = String(row.Detail || "").trim();
  const durationSeconds = parseDuration(row);
  const failure = isFailure(result);
  const event = {
    id: stableId("evt", rowNumber),
    row: rowNumber,
    timestamp: parsedTime.timestamp,
    timestampNanoseconds: parsedTime.timestampNs,
    timestampMs: parsedTime.timestampMs,
    process,
    pid,
    operation,
    path,
    result,
    detail,
    durationSeconds,
    failure,
    salient: false
  };

  if (event.timestampMs < state.firstMs) state.firstTimestamp = event.timestamp;
  if (event.timestampMs > state.lastMs) state.lastTimestamp = event.timestamp;
  state.total++;
  if (failure) state.failures++;
  state.firstMs = Math.min(state.firstMs, event.timestampMs);
  state.lastMs = Math.max(state.lastMs, event.timestampMs);
  increment(state.processes, `${process}\u001f${pid ?? ""}`);
  increment(state.operations, operation);
  increment(state.results, result);
  increment(state.timeline, Math.floor(event.timestampMs / 1000));
  if (FAILURE_RESULTS.has(result.toUpperCase())) {
    if (!state.resultEvidence.has(result.toUpperCase())) state.resultEvidence.set(result.toUpperCase(), []);
    const evidence = state.resultEvidence.get(result.toUpperCase());
    if (evidence.length < 12) evidence.push(event.id);
  }
  if (/^(NAME NOT FOUND|PATH NOT FOUND)$/i.test(result)) {
    const second = Math.floor(event.timestampMs / 1000);
    const key = `${result.toUpperCase()}\u001f${process}\u001f${second}`;
    const burst = state.missingBursts.get(key) || { result: result.toUpperCase(), process, second, count: 0, evidence: [] };
    burst.count++;
    if (burst.evidence.length < 8) burst.evidence.push(event.id);
    state.missingBursts.set(key, burst);
  }
  if (durationSeconds !== null) {
    state.durationAvailable = true;
    if (durationSeconds >= .05) {
      state.slowEvents.push(event);
      state.slowEvents.sort((left, right) => right.durationSeconds - left.durationSeconds);
      state.slowEvents.length = Math.min(state.slowEvents.length, 20);
    }
  }
  if (/^Reg(Set|Create|Delete)/i.test(operation)) state.mutations.registry++;
  else if (MUTATION_OPERATIONS.test(operation)) state.mutations.file++;
  if (/Process (Create|Start)/i.test(operation)) state.lifecycle.starts++;
  if (/Process Exit/i.test(operation)) state.lifecycle.exits++;
  parseNetworkObservation(event);
  retainEvent(event);
}

async function sourceFingerprint(file) {
  const sampleSize = 65536;
  const first = new Uint8Array(await file.slice(0, sampleSize).arrayBuffer());
  const last = new Uint8Array(await file.slice(Math.max(0, file.size - sampleSize)).arrayBuffer());
  const metadata = new TextEncoder().encode(String(file.size));
  const bytes = new Uint8Array(metadata.length + first.length + last.length);
  bytes.set(metadata); bytes.set(first, metadata.length); bytes.set(last, metadata.length + first.length);
  const digest = await crypto.subtle.digest("SHA-256", bytes);
  return [...new Uint8Array(digest)].map(value => value.toString(16).padStart(2, "0")).join("");
}

function updateProgress(file, bytesRead, rows) {
  const percent = file.size ? Math.min(100, bytesRead / file.size * 100) : 0;
  $("#progressBar").style.width = `${percent.toFixed(1)}%`;
  $("#progressDetail").textContent = `${percent.toFixed(1)}% · ${formatBytes(bytesRead)} of ${formatBytes(file.size)} · ${rows.toLocaleString()} rows`;
}

async function importCsv(file, context, session) {
  const reader = file.stream().getReader();
  session.reader = reader;
  const decoder = new TextDecoder("utf-8");
  let buffer = "";
  let headers = null;
  let rowNumber = 0;
  let bytesRead = 0;
  while (true) {
    if (session.cancelled) throw new DOMException("Import cancelled", "AbortError");
    const { value, done } = await reader.read();
    if (done) break;
    bytesRead += value.byteLength;
    buffer += decoder.decode(value, { stream: true });
    let complete;
    while ((complete = findCompleteRecord(buffer))) {
      buffer = complete.rest;
      if (!complete.record.trim()) continue;
      const fields = parseCsvRecord(complete.record);
      if (!headers) headers = normalizeHeaders(fields);
      else { rowNumber++; ingestRow(makeRow(headers, fields), rowNumber, context); }
      if (rowNumber % 5000 === 0) {
        updateProgress(file, bytesRead, rowNumber);
        await new Promise(resolve => setTimeout(resolve, 0));
      }
    }
  }
  buffer += decoder.decode();
  if (buffer.trim()) {
    const fields = parseCsvRecord(buffer);
    if (!headers) headers = normalizeHeaders(fields);
    else { rowNumber++; ingestRow(makeRow(headers, fields), rowNumber, context); }
  }
  updateProgress(file, file.size, rowNumber);
  if (!rowNumber) throw new Error("No ProcMon event rows were found.");
}

function xmlField(eventElement, names) {
  for (const name of names) {
    const element = [...eventElement.children].find(child => child.tagName.replace(/[_\s]/g, "").toLowerCase() === name.replace(/[_\s]/g, "").toLowerCase());
    if (element) return element.textContent || "";
  }
  return "";
}

async function importXml(file, context, session) {
  if (file.size > 50 * 1024 * 1024) throw new Error("XML imports are limited to 50 MB. Convert large PML/XML captures to CSV with the included PowerShell helper.");
  $("#progressDetail").textContent = `Reading ${formatBytes(file.size)} XML export into memory...`;
  const text = await file.text();
  if (session.cancelled) throw new DOMException("Import cancelled", "AbortError");
  const documentNode = new DOMParser().parseFromString(text, "application/xml");
  if (documentNode.querySelector("parsererror")) throw new Error("The XML export is not well formed.");
  const events = [...documentNode.querySelectorAll("event, Event")];
  events.forEach((element, index) => {
    const row = {
      "Time of Day": xmlField(element, ["Time_of_Day", "Time of Day", "Time"]),
      "Process Name": xmlField(element, ["Process_Name", "Process Name", "ProcessName"]),
      PID: xmlField(element, ["PID"]),
      Operation: xmlField(element, ["Operation"]),
      Path: xmlField(element, ["Path"]),
      Result: xmlField(element, ["Result"]),
      Detail: xmlField(element, ["Detail"]),
      Duration: xmlField(element, ["Duration"])
    };
    ingestRow(row, index + 1, context);
  });
  updateProgress(file, file.size, events.length);
  if (!events.length) throw new Error("No event elements were found in the ProcMon XML export.");
}

async function importFile(file) {
  if (!file) return;
  try {
    const context = validateContext();
    if (/\.pml$/i.test(file.name)) throw new Error("Native PML cannot be decoded in a browser. Run tools/Convert-ProcMon.ps1 first.");
    if (!/\.(csv|xml)$/i.test(file.name)) throw new Error("Choose a ProcMon CSV or XML export.");
    if (importSession) importSession.cancelled = true;
    const session = { cancelled: false, reader: null };
    importSession = session;
    state = createEmptyState();
    state.source = { name: file.name, size: file.size, lastModified: file.lastModified, type: /\.xml$/i.test(file.name) ? "xml" : "csv" };
    state.captureDate = context.date;
    state.timezoneOffset = context.offset;
    $("#importStatus").hidden = false;
    $("#progressTitle").textContent = `Analyzing ${file.name}`;
    $("#progressBar").style.width = "0%";
    state.fingerprint = await sourceFingerprint(file);
    if (state.source.type === "csv") await importCsv(file, context, session);
    else await importXml(file, context, session);
    if (session.cancelled) throw new DOMException("Import cancelled", "AbortError");
    finalizeAnalysis();
    render();
    $("#workspace").hidden = false;
    $("#workspace").scrollIntoView({ behavior: "smooth", block: "start" });
    showToast(`${state.total.toLocaleString()} events analyzed locally.`);
  } catch (error) {
    if (error.name === "AbortError") showToast("Import cancelled.");
    else { console.error(error); showToast(error.message || "Capture import failed."); }
  } finally {
    if (importSession?.reader) { try { importSession.reader.releaseLock(); } catch (_) { /* Reader already released. */ } }
    importSession = null;
    $("#importStatus").hidden = true;
    $("#fileInput").value = "";
  }
}

function findingId(kind, suffix = "") {
  return `finding-${state.fingerprint.slice(0, 16)}-${kind}${suffix ? `-${suffix}` : ""}`;
}

function finalizeAnalysis() {
  const findings = [];
  const addResultFinding = (result, severity, title) => {
    const count = state.results.get(result) || 0;
    if (count) findings.push({ id: findingId(result.toLowerCase().replace(/\s/g, "-")), severity, kind: result, title, detail: `${count.toLocaleString()} operations returned ${result}.`, count, evidence: state.resultEvidence.get(result) || [] });
  };
  addResultFinding("ACCESS DENIED", "high", "Access controls blocked activity");
  addResultFinding("SHARING VIOLATION", "high", "File sharing contention detected");
  const bursts = [...state.missingBursts.values()].filter(item => item.count >= 10).sort((a, b) => b.count - a.count);
  bursts.slice(0, 8).forEach((burst, index) => findings.push({ id: findingId("missing-burst", index), severity: burst.count >= 50 ? "medium" : "info", kind: burst.result, title: `${burst.result} burst`, detail: `${burst.process} generated ${burst.count.toLocaleString()} misses within one second.`, count: burst.count, evidence: burst.evidence }));
  if (state.slowEvents.length) {
    const slow = state.slowEvents;
    findings.push({ id: findingId("slow-operations"), severity: slow[0].durationSeconds >= 1 ? "high" : "medium", kind: "SLOW_OPERATION", title: "Slow operations observed", detail: `${slow.length} retained operations took at least 50 ms; maximum ${(slow[0].durationSeconds * 1000).toFixed(1)} ms.`, count: slow.length, evidence: slow.slice(0, 10).map(event => event.id) });
  }
  if (state.mutations.file || state.mutations.registry) findings.push({ id: findingId("mutations"), severity: "info", kind: "MUTATION_SUMMARY", title: "System mutation activity", detail: `${state.mutations.file.toLocaleString()} file and ${state.mutations.registry.toLocaleString()} registry mutation operations.`, count: state.mutations.file + state.mutations.registry, evidence: state.retained.filter(event => MUTATION_OPERATIONS.test(event.operation)).slice(0, 10).map(event => event.id) });
  if (state.lifecycle.starts || state.lifecycle.exits) findings.push({ id: findingId("process-lifecycle"), severity: "info", kind: "PROCESS_LIFECYCLE", title: "Process lifecycle activity", detail: `${state.lifecycle.starts.toLocaleString()} starts and ${state.lifecycle.exits.toLocaleString()} exits observed.`, count: state.lifecycle.starts + state.lifecycle.exits, evidence: state.retained.filter(event => /Process (Create|Start|Exit)/i.test(event.operation)).slice(0, 10).map(event => event.id) });
  if (!state.durationAvailable) findings.push({ id: findingId("duration-unavailable"), severity: "info", kind: "DATA_QUALITY", title: "Duration analysis unavailable", detail: "No Duration column or Duration value in Detail was found; slow-operation detection was skipped.", count: 0, evidence: [] });
  if (!findings.some(finding => finding.severity !== "info")) findings.unshift({ id: findingId("no-critical-signals"), severity: "info", kind: "SUMMARY", title: "No high-confidence failure pattern", detail: "No access-denied, sharing-violation, missing-path burst, or slow-operation threshold was triggered.", count: 0, evidence: [] });
  state.findings = findings;
  state.retained.sort((left, right) => left.timestampMs - right.timestampMs || left.row - right.row);
}

function topEntries(map, count = 6) {
  return [...map.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).slice(0, count);
}

function formatBytes(value) {
  if (value < 1024) return `${value} B`;
  const units = ["KB", "MB", "GB"];
  let amount = value / 1024;
  let index = 0;
  while (amount >= 1024 && index < units.length - 1) { amount /= 1024; index++; }
  return `${amount.toFixed(amount >= 100 ? 0 : 1)} ${units[index]}`;
}

function formatWindow(milliseconds) {
  if (!Number.isFinite(milliseconds)) return "No time range";
  if (milliseconds < 1000) return `${milliseconds.toFixed(3)} ms`;
  if (milliseconds < 60000) return `${(milliseconds / 1000).toFixed(3)} s`;
  return `${(milliseconds / 60000).toFixed(2)} min`;
}

function formatDuration(seconds) {
  if (seconds === null) return "—";
  return seconds < .001 ? `${(seconds * 1000000).toFixed(0)} µs` : seconds < 1 ? `${(seconds * 1000).toFixed(2)} ms` : `${seconds.toFixed(3)} s`;
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, character => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rectangle = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, Math.round(rectangle.width * ratio));
  canvas.height = Math.max(1, Math.round(rectangle.height * ratio));
  const context = canvas.getContext("2d");
  context.scale(ratio, ratio);
  return { context, width: rectangle.width, height: rectangle.height };
}

function drawTimeline() {
  const canvas = $("#timelineCanvas");
  const { context, width, height } = setupCanvas(canvas);
  const entries = [...state.timeline.entries()].sort((a, b) => a[0] - b[0]);
  if (!entries.length) return;
  const first = entries[0][0];
  const last = entries.at(-1)[0];
  const bucketCount = Math.min(120, Math.max(24, Math.ceil(width / 7)));
  const buckets = Array.from({ length: bucketCount }, () => 0);
  entries.forEach(([second, count]) => { const index = Math.min(bucketCount - 1, Math.floor((second - first) / Math.max(1, last - first + 1) * bucketCount)); buckets[index] += count; });
  const maximum = Math.max(1, ...buckets);
  const padding = { left: 48, right: 18, top: 28, bottom: 30 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  context.font = "9px DM Mono";
  context.fillStyle = "#6f756f";
  context.strokeStyle = "#dedbd2";
  context.lineWidth = 1;
  for (let row = 0; row <= 4; row++) {
    const y = padding.top + chartHeight * row / 4;
    context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
    context.fillText(Math.round(maximum * (1 - row / 4)).toLocaleString(), 3, y + 3);
  }
  const gradient = context.createLinearGradient(0, padding.top, 0, padding.top + chartHeight);
  gradient.addColorStop(0, "rgba(29,107,79,.28)"); gradient.addColorStop(1, "rgba(29,107,79,.02)");
  context.beginPath();
  buckets.forEach((value, index) => { const x = padding.left + index / Math.max(1, buckets.length - 1) * chartWidth; const y = padding.top + chartHeight * (1 - value / maximum); index ? context.lineTo(x, y) : context.moveTo(x, y); });
  context.lineTo(padding.left + chartWidth, padding.top + chartHeight); context.lineTo(padding.left, padding.top + chartHeight); context.closePath(); context.fillStyle = gradient; context.fill();
  context.beginPath();
  buckets.forEach((value, index) => { const x = padding.left + index / Math.max(1, buckets.length - 1) * chartWidth; const y = padding.top + chartHeight * (1 - value / maximum); index ? context.lineTo(x, y) : context.moveTo(x, y); });
  context.strokeStyle = COLORS[0]; context.lineWidth = 2; context.stroke();
  context.fillStyle = "#6f756f"; context.fillText("start", padding.left, height - 9); context.fillText(formatWindow(state.lastMs - state.firstMs), Math.max(padding.left, width - 90), height - 9);
  $("#peakRate").textContent = `Peak ${maximum.toLocaleString()}/bucket`;
}

function drawOperationMix(entries) {
  const canvas = $("#operationCanvas");
  const { context, width, height } = setupCanvas(canvas);
  const shown = entries.slice(0, 5);
  const shownTotal = shown.reduce((sum, entry) => sum + entry[1], 0);
  const other = state.total - shownTotal;
  if (other > 0) shown.push(["Other", other]);
  let angle = -Math.PI / 2;
  const radius = Math.min(width, height) * .36;
  shown.forEach(([, value], index) => { const next = angle + value / state.total * Math.PI * 2; context.beginPath(); context.arc(width / 2, height / 2, radius, angle, next); context.strokeStyle = COLORS[index % COLORS.length]; context.lineWidth = 22; context.stroke(); angle = next; });
  $("#operationLegend").innerHTML = shown.map(([name, count], index) => `<div class="legend-item"><i style="background:${COLORS[index % COLORS.length]}"></i><span title="${escapeHtml(name)}">${escapeHtml(name)}</span><b>${Math.round(count / state.total * 100)}%</b></div>`).join("");
}

function renderRankList(target, entries, warning = false) {
  const maximum = Math.max(1, ...entries.map(entry => entry[1]));
  target.innerHTML = entries.map(([name, count]) => `<div class="rank-row${warning && name.toUpperCase() !== "SUCCESS" ? " warn" : ""}"><strong title="${escapeHtml(name)}">${escapeHtml(name.replace("\u001f", " · PID "))}</strong><div class="rank-track"><i style="width:${(count / maximum * 100).toFixed(1)}%"></i></div><span>${count.toLocaleString()}</span></div>`).join("") || `<div class="empty-row">No data</div>`;
}

function renderFindings() {
  $("#findingList").innerHTML = state.findings.map(finding => `<div class="finding"><span class="severity ${finding.severity}">${finding.severity}</span><div><strong>${escapeHtml(finding.title)}</strong><small>${escapeHtml(finding.detail)}${finding.evidence.length ? ` Evidence: ${finding.evidence.slice(0, 3).map(escapeHtml).join(", ")}.` : ""}</small></div></div>`).join("");
}

function renderEvents() {
  const query = $("#searchInput").value.trim().toLowerCase();
  const resultMode = $("#resultFilter").value || "all";
  const operation = $("#operationFilter").value || "all";
  const filtered = state.retained.filter(event => {
    if (resultMode === "failures" && !event.failure) return false;
    if (resultMode === "success" && event.failure) return false;
    if (operation !== "all" && event.operation !== operation) return false;
    return !query || `${event.process} ${event.pid} ${event.operation} ${event.path} ${event.result} ${event.detail}`.toLowerCase().includes(query);
  });
  const visible = filtered.slice(0, MAX_RENDERED_ROWS);
  $("#eventRows").innerHTML = visible.map(event => `<tr title="${escapeHtml(event.detail)}"><td>${escapeHtml(event.timestamp.slice(11, 28))}</td><td>${escapeHtml(event.process)} · ${event.pid ?? "—"}</td><td>${escapeHtml(event.operation)}</td><td class="path" title="${escapeHtml(event.path)}">${escapeHtml(event.path || "—")}</td><td><span class="result${event.failure ? " fail" : ""}">${escapeHtml(event.result)}</span></td><td>${formatDuration(event.durationSeconds)}</td></tr>`).join("") || `<tr><td class="empty-row" colspan="6">No retained events match these filters.</td></tr>`;
  $("#tableStatus").textContent = `Showing ${visible.length.toLocaleString()} of ${filtered.length.toLocaleString()} matching retained events`;
}

function render() {
  const processEntries = topEntries(state.processes, 7);
  const operationEntries = topEntries(state.operations, 12);
  const resultEntries = topEntries(state.results, 7);
  $("#captureName").textContent = state.source.name;
  $("#captureMeta").textContent = `${formatBytes(state.source.size)} · ${state.fingerprint.slice(0, 16)} · ${state.captureDate} ${state.timezoneOffset}`;
  $("#eventCount").textContent = state.total.toLocaleString();
  $("#captureWindow").textContent = `${formatWindow(state.lastMs - state.firstMs)} capture window`;
  $("#processCount").textContent = state.processes.size.toLocaleString();
  $("#processMeta").textContent = "Unique process / PID pairs";
  $("#failureCount").textContent = state.failures.toLocaleString();
  $("#failureRate").textContent = `${(state.failures / Math.max(1, state.total) * 100).toFixed(2)}% of operations`;
  $("#findingCount").textContent = state.findings.length.toLocaleString();
  $("#findingMeta").textContent = `${state.findings.filter(finding => finding.severity === "high").length} high · ${state.findings.filter(finding => finding.severity === "medium").length} medium`;
  $("#operationCount").textContent = `${state.operations.size.toLocaleString()} types`;
  $("#donutTotal").textContent = state.total.toLocaleString();
  const operationSelect = $("#operationFilter");
  operationSelect.innerHTML = `<option value="all">All operations</option>${[...state.operations.keys()].sort().map(name => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
  renderRankList($("#processList"), processEntries);
  renderRankList($("#resultList"), resultEntries, true);
  renderFindings();
  renderEvents();
  requestAnimationFrame(() => { drawTimeline(); drawOperationMix(operationEntries); });
}

function exportEvent(event) {
  const { timestampMs, failure, salient, ...normalized } = event;
  return normalized;
}

function coreExportContext() {
  return window.DataSnareCoreContext?.exportMetadata?.("aiprocmon") || null;
}

function buildAnalysisReport() {
  return {
    schema: "datasnare-aiprocmon/events-v1",
    format: "AIRootCause",
    id: `aiprocmon-${state.fingerprint.slice(0, 24)}`,
    generatedAt: new Date().toISOString(),
    coreContext: coreExportContext(),
    source: { ...state.source, fingerprint: state.fingerprint },
    captureContext: { date: state.captureDate, timezoneOffset: state.timezoneOffset, caveat: "ProcMon CSV supplies time of day only; date and offset were operator-provided." },
    summary: {
      eventCount: state.total,
      processCount: state.processes.size,
      failureCount: state.failures,
      firstTimestamp: state.firstTimestamp,
      lastTimestamp: state.lastTimestamp,
      windowMilliseconds: Number.isFinite(state.lastMs - state.firstMs) ? state.lastMs - state.firstMs : 0,
      mutations: state.mutations,
      processLifecycle: state.lifecycle,
      operationCounts: Object.fromEntries([...state.operations.entries()].sort()),
      resultCounts: Object.fromEntries([...state.results.entries()].sort())
    },
    findings: state.findings,
    salientEvents: state.retained.filter(event => event.salient || event.failure).map(exportEvent),
    retention: { strategy: "bounded-salient-reservoir", maximumRows: MAX_RETAINED_EVENTS, retainedRows: state.retained.length }
  };
}

function analysisExport() {
  const report = buildAnalysisReport();
  downloadJson(report, `${baseName(state.source.name)}-aiprocmon.json`);
}

function buildProcessMapReport() {
  return {
    schema: "datasnare-ainetscope/process-map-v1",
    coreContext: coreExportContext(),
    source: { type: "ProcMon", name: state.source.name, fingerprint: state.fingerprint },
    observations: state.network
  };
}

function processMapExport() {
  if (!state.network.length) { showToast("No ProcMon TCP/UDP connect or transfer operations were available."); return; }
  const report = buildProcessMapReport();
  downloadJson(report, `${baseName(state.source.name)}-process-map.json`);
}

function baseName(name) {
  return String(name || "capture").replace(/\.[^.]+$/, "").replace(/[^a-z0-9._-]+/gi, "-");
}

function downloadJson(value, fileName) {
  const link = document.createElement("a");
  link.href = URL.createObjectURL(new Blob([JSON.stringify(value, null, 2)], { type: "application/json" }));
  link.download = fileName;
  link.click();
  setTimeout(() => URL.revokeObjectURL(link.href), 0);
}

function hashText(value) {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index++) { hash ^= value.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

function loadDemo() {
  const context = validateContext();
  const demoRows = [
    ["09:14:22.1000000", "orders.exe", "4812", "Process Start", "C:\\Apps\\orders.exe", "SUCCESS", "Parent PID: 920"],
    ["09:14:22.1012000", "orders.exe", "4812", "RegOpenKey", "HKLM\\Software\\DataSnare", "ACCESS DENIED", "Desired Access: Read/Write, Duration: 0.0004120"],
    ["09:14:22.1045000", "orders.exe", "4812", "CreateFile", "C:\\ProgramData\\DataSnare\\orders.db", "SHARING VIOLATION", "Desired Access: Read/Write, Duration: 0.0821000"],
    ["09:14:22.2000000", "orders.exe", "4812", "TCP Connect", "10.14.2.18:52114 -> 10.14.2.55:1433", "SUCCESS", "Length: 0, Duration: 0.0312000"],
    ["09:14:22.2350000", "orders.exe", "4812", "TCP Send", "10.14.2.18:52114 -> 10.14.2.55:1433", "SUCCESS", "Length: 512, Duration: 0.0011000"],
    ["09:14:23.0000001", "updater.exe", "7720", "WriteFile", "C:\\Program Files\\DataSnare\\agent.tmp", "SUCCESS", "Offset: 0, Length: 4096, Duration: 0.0032000"],
    ["09:14:23.1000000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001200"],
    ["09:14:23.1100000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001100"],
    ["09:14:23.1200000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001000"],
    ["09:14:23.1300000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001300"],
    ["09:14:23.1400000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001400"],
    ["09:14:23.1500000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001500"],
    ["09:14:23.1600000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001600"],
    ["09:14:23.1700000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001700"],
    ["09:14:23.1800000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001800"],
    ["09:14:23.1900000", "orders.exe", "4812", "ReadFile", "C:\\Config\\missing.json", "NAME NOT FOUND", "Offset: 0, Length: 4096, Duration: 0.0001900"],
    ["09:14:24.4000000", "backup.exe", "3360", "ReadFile", "D:\\Archive\\orders.bak", "SUCCESS", "Offset: 0, Length: 1048576, Duration: 1.2400000"],
    ["09:14:25.0000000", "orders.exe", "4812", "Process Exit", "orders.exe", "SUCCESS", "Exit Status: 0"]
  ];
  state = createEmptyState();
  state.captureDate = context.date; state.timezoneOffset = context.offset;
  state.fingerprint = `demo${hashText(JSON.stringify(demoRows)).repeat(8)}`.slice(0, 64);
  state.source = { name: "datasnare-procmon-demo.csv", size: 4096, lastModified: 0, type: "demo" };
  demoRows.forEach((values, index) => ingestRow(makeRow(["Time of Day", "Process Name", "PID", "Operation", "Path", "Result", "Detail"], values), index + 1, context));
  finalizeAnalysis(); render(); $("#workspace").hidden = false; $("#workspace").scrollIntoView({ behavior: "smooth" });
}

function showToast(message) {
  clearTimeout(toastTimer);
  $("#toast").textContent = message;
  $("#toast").hidden = false;
  toastTimer = setTimeout(() => { $("#toast").hidden = true; }, 4200);
}

$("#fileInput").addEventListener("change", event => importFile(event.target.files[0]));
$("#dropZone").addEventListener("click", () => $("#fileInput").click());
$("#dropZone").addEventListener("keydown", event => { if (["Enter", " "].includes(event.key)) { event.preventDefault(); $("#fileInput").click(); } });
["dragenter", "dragover"].forEach(type => $("#dropZone").addEventListener(type, event => { event.preventDefault(); $("#dropZone").classList.add("dragging"); }));
["dragleave", "drop"].forEach(type => $("#dropZone").addEventListener(type, event => { event.preventDefault(); $("#dropZone").classList.remove("dragging"); }));
$("#dropZone").addEventListener("drop", event => importFile(event.dataTransfer.files[0]));
$("#cancelButton").addEventListener("click", async () => { if (!importSession) return; importSession.cancelled = true; if (importSession.reader) await importSession.reader.cancel(); });
$("#demoButton").addEventListener("click", () => { try { loadDemo(); } catch (error) { showToast(error.message); } });
$("#analysisButton").addEventListener("click", analysisExport);
$("#processMapButton").addEventListener("click", processMapExport);
[$("#searchInput"), $("#resultFilter"), $("#operationFilter")].forEach(element => element.addEventListener("input", renderEvents));
window.addEventListener("resize", () => { if (!$("#workspace").hidden) { drawTimeline(); drawOperationMix(topEntries(state.operations, 12)); } });

setDefaultContext();
window.DataSnareAIProcMon = Object.freeze({
  schema: "datasnare-aiprocmon/events-v1",
  parseCsvRecord,
  parseProcMonTime,
  buildAnalysisReport,
  buildProcessMapReport,
  get coreContext() { return coreExportContext(); },
  get summary() { return { events: state.total, failures: state.failures, findings: state.findings.length }; }
});
