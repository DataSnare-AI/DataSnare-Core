"use strict";

const PROCESS_MAP_SCHEMA = "datasnare-ainetscope/process-map-v1";
const processMapState = { observations: [], source: "", toleranceSeconds: 120, hostAddress: "", matchedPackets: 0 };

function processMapStorageKey() {
  return `datasnare-process-map:${state.captureId}`;
}

function normalizeAddress(value) {
  return String(value || "").trim().replace(/^\[|\]$/g, "").replace(/%[^:]+$/, "").toLowerCase();
}

function parseSocketEndpoint(value) {
  const text = String(value || "").trim();
  if (!text || text === "*:*" || text === "*") return { address: "*", port: null };
  const bracketed = text.match(/^\[([^\]]+)\]:(\*|\d+)$/);
  if (bracketed) return { address: normalizeAddress(bracketed[1]), port: bracketed[2] === "*" ? null : Number(bracketed[2]) };
  const separator = text.lastIndexOf(":");
  if (separator < 0) return { address: normalizeAddress(text), port: null };
  const portText = text.slice(separator + 1); const address = text.slice(0, separator);
  return { address: normalizeAddress(address), port: portText === "*" ? null : Number(portText) };
}

function parseObservationTime(value, fallback = null) {
  if (value === undefined || value === null || value === "") return fallback;
  if (typeof value === "number") return value > 1e12 ? value / 1000 : value;
  const numeric = Number(value); if (Number.isFinite(numeric) && String(value).trim() !== "") return numeric > 1e12 ? numeric / 1000 : numeric;
  const parsed = Date.parse(value); return Number.isFinite(parsed) ? parsed / 1000 : fallback;
}

function normalizeObservation(row, fallbackTime = null, source = "import") {
  const get = (...keys) => { const key = keys.find(candidate => row[candidate] !== undefined && row[candidate] !== ""); return key ? row[key] : undefined; };
  const localCombined = get("localEndpoint", "local_endpoint", "Local Endpoint", "LocalEndpoint");
  const remoteCombined = get("remoteEndpoint", "remote_endpoint", "Remote Endpoint", "RemoteEndpoint");
  const local = localCombined ? parseSocketEndpoint(localCombined) : { address: normalizeAddress(get("localAddress", "local_address", "Local Address", "LocalAddress", "Local Address ")), port: Number(get("localPort", "local_port", "Local Port", "LocalPort")) || null };
  const remote = remoteCombined ? parseSocketEndpoint(remoteCombined) : { address: normalizeAddress(get("remoteAddress", "remote_address", "Remote Address", "RemoteAddress", "Remote Address ")), port: Number(get("remotePort", "remote_port", "Remote Port", "RemotePort")) || null };
  return {
    timestamp: parseObservationTime(get("timestamp", "Timestamp", "observedAt", "observed_at"), fallbackTime),
    endTimestamp: parseObservationTime(get("endTimestamp", "end_timestamp", "EndTimestamp"), null),
    host: String(get("host", "Host", "hostname", "ComputerName") || ""), protocol: String(get("protocol", "Protocol", "Proto") || "TCP").toUpperCase().replace(/\d+$/, ""),
    localAddress: local.address || "*", localPort: local.port, remoteAddress: remote.address || "*", remotePort: remote.port,
    state: String(get("state", "State") || ""), pid: Number(get("pid", "PID", "OwningProcess", "Process ID")) || null,
    process: String(get("process", "Process", "ProcessName", "Process Name", "Command") || ""), executable: String(get("executable", "Executable", "Path", "Image Path") || ""), user: String(get("user", "User", "Username") || ""), source: String(get("source", "Source") || source)
  };
}

function parseCsvRows(text) {
  const rows = []; let row = []; let value = ""; let quoted = false;
  for (let index = 0; index < text.length; index++) {
    const character = text[index];
    if (character === '"') { if (quoted && text[index + 1] === '"') { value += '"'; index++; } else quoted = !quoted; }
    else if (character === "," && !quoted) { row.push(value.trim()); value = ""; }
    else if ((character === "\n" || character === "\r") && !quoted) { if (character === "\r" && text[index + 1] === "\n") index++; row.push(value.trim()); if (row.some(Boolean)) rows.push(row); row = []; value = ""; }
    else value += character;
  }
  row.push(value.trim()); if (row.some(Boolean)) rows.push(row);
  if (rows.length < 2) return [];
  const headers = rows.shift().map(header => header.replace(/^"|"$/g, "").trim());
  return rows.map(values => Object.fromEntries(headers.map((header, index) => [header, values[index] ?? ""])));
}

function parseCsvProcessMap(text, fallbackTime) {
  return parseCsvRows(text).map(row => normalizeObservation(row, fallbackTime, "CSV")).filter(row => row.localPort);
}

function parseNetstat(text, fallbackTime) {
  const observations = [];
  text.split(/\r?\n/).forEach(line => {
    const match = line.trim().match(/^(TCP|UDP)\s+(\S+)\s+(\S+)(?:\s+(\S+))?\s+(\d+)$/i); if (!match) return;
    const protocol = match[1].toUpperCase(); const local = parseSocketEndpoint(match[2]); const remote = parseSocketEndpoint(match[3]);
    observations.push(normalizeObservation({ protocol, localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port, state: protocol === "TCP" ? match[4] : "", pid: match[5], process: `PID ${match[5]}` }, fallbackTime, "netstat -ano"));
  });
  return observations;
}

function parseSs(text, fallbackTime) {
  const observations = [];
  text.split(/\r?\n/).forEach(line => {
    const match = line.trim().match(/^(tcp|udp)\S*\s+(\S+)\s+\d+\s+\d+\s+(\S+)\s+(\S+)(.*)$/i); if (!match) return;
    const local = parseSocketEndpoint(match[3]); const remote = parseSocketEndpoint(match[4]); const process = match[5].match(/\(\("([^"]+)"/)?.[1] || ""; const pid = match[5].match(/pid=(\d+)/)?.[1];
    observations.push(normalizeObservation({ protocol: match[1], state: match[2], localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port, process, pid }, fallbackTime, "ss -tunap"));
  });
  return observations;
}

function parseLsof(text, fallbackTime) {
  const observations = [];
  text.split(/\r?\n/).slice(1).forEach(line => {
    const columns = line.trim().split(/\s+/); if (columns.length < 9) return;
    const protocolIndex = columns.findIndex(value => /^(TCP|UDP)$/i.test(value)); if (protocolIndex < 0) return;
    const socket = columns[protocolIndex + 1] || ""; const [localText, remoteText] = socket.split("->"); const local = parseSocketEndpoint(localText); const remote = parseSocketEndpoint(remoteText || "*");
    observations.push(normalizeObservation({ protocol: columns[protocolIndex], localAddress: local.address, localPort: local.port, remoteAddress: remote.address, remotePort: remote.port, process: columns[0], pid: columns[1], user: columns[2], state: columns.at(-1).replace(/[()]/g, "") }, fallbackTime, "lsof -i"));
  });
  return observations;
}

function parseProcessMap(text, format, fallbackTime) {
  const trimmed = text.trim(); if (!trimmed) throw new Error("No process-map data was provided.");
  let detected = format;
  if (format === "auto") {
    if (trimmed.startsWith("{") || trimmed.startsWith("[")) detected = "normalized-json";
    else if (/^\s*(TCP|UDP)\s+\S+:\S+\s+/im.test(trimmed)) detected = "netstat";
    else if (/^(tcp|udp)\S*\s+\S+\s+\d+\s+\d+\s+/im.test(trimmed)) detected = "ss";
    else if (/^COMMAND\s+PID\s+USER/im.test(trimmed)) detected = "lsof";
    else detected = "csv";
  }
  let observations;
  if (detected === "normalized-json") { const parsed = JSON.parse(trimmed); const rows = Array.isArray(parsed) ? parsed : parsed.observations; if (!Array.isArray(rows)) throw new Error("JSON must contain an observations array."); observations = rows.map(row => normalizeObservation(row, fallbackTime, row.source || "DataSnare JSON")); }
  else if (detected === "netstat") observations = parseNetstat(trimmed, fallbackTime);
  else if (detected === "ss") observations = parseSs(trimmed, fallbackTime);
  else if (detected === "lsof") observations = parseLsof(trimmed, fallbackTime);
  else observations = parseCsvProcessMap(trimmed, fallbackTime);
  observations = observations.filter(row => ["TCP", "UDP"].includes(row.protocol) && Number.isFinite(row.localPort));
  if (!observations.length) throw new Error("No usable TCP or UDP socket rows were recognized.");
  return { format: detected, observations };
}

function addressMatches(expected, actual) {
  const value = normalizeAddress(expected); return !value || ["*", "0.0.0.0", "::", "::0"].includes(value) || value === normalizeAddress(actual);
}

function scoreProcessCandidate(packet, observation, sourceSide, config) {
  if (packet.transport !== observation.protocol) return null;
  const localAddress = sourceSide ? packet.src : packet.dst; const localPort = sourceSide ? packet.srcPort : packet.dstPort;
  const remoteAddress = sourceSide ? packet.dst : packet.src; const remotePort = sourceSide ? packet.dstPort : packet.srcPort;
  if (localPort !== observation.localPort) return null;
  if (config.hostAddress && normalizeAddress(localAddress) !== normalizeAddress(config.hostAddress)) return null;
  if (!addressMatches(observation.localAddress, localAddress)) return null;
  if (observation.remotePort && observation.remotePort !== remotePort) return null;
  if (observation.remoteAddress && observation.remoteAddress !== "*" && !addressMatches(observation.remoteAddress, remoteAddress)) return null;
  let temporal = false;
  if (observation.timestamp && config.toleranceSeconds > 0) {
    const end = observation.endTimestamp || observation.timestamp;
    if (packet.timestamp < observation.timestamp - config.toleranceSeconds || packet.timestamp > end + config.toleranceSeconds) return null;
    temporal = true;
  }
  const fullTuple = !["", "*", "0.0.0.0", "::", "::0"].includes(observation.localAddress) && Boolean(observation.remotePort) && !["", "*"].includes(observation.remoteAddress);
  let score = 35 + (observation.localAddress && observation.localAddress !== "*" ? 20 : 0) + (observation.remotePort ? 15 : 0) + (observation.remoteAddress && observation.remoteAddress !== "*" ? 20 : 0) + (temporal ? 10 : 0);
  if (config.hostAddress) score += 5;
  return { observation, sourceSide, score, fullTuple, temporal };
}

function correlateProcessMap(packets, observations = processMapState.observations, config = processMapState) {
  let matched = 0;
  packets.forEach(packet => {
    delete packet.processCorrelation;
    const candidates = [];
    observations.forEach(observation => { const source = scoreProcessCandidate(packet, observation, true, config); const destination = scoreProcessCandidate(packet, observation, false, config); if (source) candidates.push(source); if (destination) candidates.push(destination); });
    candidates.sort((left, right) => right.score - left.score);
    if (!candidates.length) return;
    const best = candidates[0]; const tied = candidates.filter(candidate => candidate.score === best.score); const identities = new Set(tied.map(candidate => `${candidate.observation.pid}|${candidate.observation.process}|${candidate.observation.executable}`));
    const confidence = identities.size > 1 ? "ambiguous" : best.fullTuple && best.temporal ? "exact" : best.fullTuple || best.score >= 70 ? "strong" : "possible";
    packet.processCorrelation = { ...best.observation, side: best.sourceSide ? "source" : "destination", score: best.score, confidence, candidates: identities.size };
    matched++;
  });
  processMapState.matchedPackets = matched;
  return matched;
}

function processWorkbenchColumns() {
  if (!processMapState.observations.length) return [];
  return [
    { label: "Process", value: packet => packet.processCorrelation?.process || "—" },
    { label: "PID", value: packet => packet.processCorrelation?.pid ?? "—" },
    { label: "Executable", value: packet => packet.processCorrelation?.executable || "—" },
    { label: "Confidence", html: packet => packet.processCorrelation ? `<span class="process-confidence ${packet.processCorrelation.confidence}">${packet.processCorrelation.confidence}</span>` : "—" }
  ];
}

function processCorrelationLayer(packet) {
  const match = packet.processCorrelation; if (!match) return null;
  return { name: "Process Correlation", summary: `${match.process || `PID ${match.pid || "unknown"}`} · ${match.confidence}`, start: 0, length: 0, fields: [{ name: "Process", value: match.process || "Unknown", start: 0, length: 0 }, { name: "PID", value: match.pid ?? "Unknown", start: 0, length: 0 }, { name: "Executable", value: match.executable || "Unknown", start: 0, length: 0 }, { name: "User", value: match.user || "Unknown", start: 0, length: 0 }, { name: "Attributed endpoint", value: match.side, start: 0, length: 0 }, { name: "Confidence", value: match.confidence, start: 0, length: 0 }, { name: "Source", value: match.source, start: 0, length: 0 }] };
}

function persistProcessMap() {
  try { localStorage.setItem(processMapStorageKey(), JSON.stringify({ schema: PROCESS_MAP_SCHEMA, source: processMapState.source, toleranceSeconds: processMapState.toleranceSeconds, hostAddress: processMapState.hostAddress, observations: processMapState.observations })); } catch (_) { showToast("Process mappings could not be saved locally."); }
}

function restoreProcessMapForCapture() {
  let saved = null; try { saved = JSON.parse(localStorage.getItem(processMapStorageKey())); } catch (_) { saved = null; }
  processMapState.observations = saved?.schema === PROCESS_MAP_SCHEMA && Array.isArray(saved.observations) ? saved.observations : [];
  processMapState.source = saved?.source || ""; processMapState.toleranceSeconds = Number(saved?.toleranceSeconds) || 120; processMapState.hostAddress = saved?.hostAddress || "";
  if (processMapState.observations.length) correlateProcessMap(state.packets);
  updateProcessMapButton();
}

function updateProcessMapButton() {
  const count = processMapState.observations.length; const button = $("#processMapButton");
  button.classList.toggle("has-mappings", count > 0); button.textContent = count ? `Process Map · ${processMapState.matchedPackets}/${count}` : "Process Map";
}

function openProcessMapDialog() {
  if (!state.packets.length) { showToast("Open a capture before importing process mappings."); return; }
  $("#processMapCaptureName").textContent = state.fileName;
  $("#processMapTolerance").value = processMapState.toleranceSeconds;
  $("#processMapHost").value = processMapState.hostAddress;
  $("#processMapPreview").textContent = processMapState.observations.length ? `${processMapState.observations.length} saved observations · ${processMapState.matchedPackets} packets correlated · ${processMapState.source}` : "No process observations loaded.";
  $("#clearProcessMapButton").disabled = !processMapState.observations.length;
  $("#processMapDialog").showModal();
}

function fallbackProcessMapTime() {
  const value = $("#processMapTimestamp").value;
  return value ? new Date(value).getTime() / 1000 : null;
}

function applyImportedProcessMap() {
  try {
    const parsed = parseProcessMap($("#processMapText").value, $("#processMapFormat").value, fallbackProcessMapTime());
    processMapState.observations = parsed.observations; processMapState.source = parsed.format; processMapState.toleranceSeconds = Math.max(0, Number($("#processMapTolerance").value) || 0); processMapState.hostAddress = normalizeAddress($("#processMapHost").value);
    const matched = correlateProcessMap(state.packets); persistProcessMap(); updateProcessMapButton();
    $("#processMapDialog").close(); if (typeof renderWorkbenchList === "function") renderWorkbenchList(workbenchState.selectedNumber);
    showToast(`${parsed.observations.length} socket observations imported · ${matched} packets correlated.`);
  } catch (error) { $("#processMapPreview").textContent = error.message; }
}

function clearProcessMap() {
  processMapState.observations = []; processMapState.matchedPackets = 0; state.packets.forEach(packet => delete packet.processCorrelation);
  try { localStorage.removeItem(processMapStorageKey()); } catch (_) { /* No-op. */ }
  updateProcessMapButton(); $("#processMapDialog").close(); if (typeof renderWorkbenchList === "function") renderWorkbenchList(workbenchState.selectedNumber); showToast("Process mappings cleared.");
}

function downloadProcessMapTemplate() {
  const content = "timestamp,host,protocol,local_address,local_port,remote_address,remote_port,state,pid,process,executable,user,source\r\n2026-09-18T14:22:10Z,APP01,TCP,10.0.0.8,52114,10.0.0.20,1433,ESTABLISHED,4812,orders.exe,C:\\\\Apps\\\\orders.exe,svc-orders,tcpview";
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([content], { type: "text/csv" })); link.download = "datasnare-process-map-template.csv"; link.click(); URL.revokeObjectURL(link.href);
}

$("#processMapButton").addEventListener("click", openProcessMapDialog);
$("#closeProcessMapDialog").addEventListener("click", () => $("#processMapDialog").close());
$("#cancelProcessMapButton").addEventListener("click", () => $("#processMapDialog").close());
$("#applyProcessMapButton").addEventListener("click", applyImportedProcessMap);
$("#clearProcessMapButton").addEventListener("click", clearProcessMap);
$("#processMapTemplateButton").addEventListener("click", downloadProcessMapTemplate);
$("#processMapInput").addEventListener("change", async event => { const file = event.target.files[0]; if (!file) return; $("#processMapText").value = await file.text(); $("#processMapFileName").textContent = file.name; });

window.DataSnareProcessMap = Object.freeze({ schema: PROCESS_MAP_SCHEMA, parse: parseProcessMap, correlate: correlateProcessMap, get observations() { return [...processMapState.observations]; } });
