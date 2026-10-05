"use strict";

const workbenchState = { selectedNumber: null, noteFrame: null, notesCaptureId: "", frameStateCaptureId: "", frameState: null, summaryDraftFrames: [], packets: [], highlight: { start: 0, length: 0 }, fieldFilters: [], columns: [], contextField: null, maxFrameLength: 1, maxRows: 300, rowHeight: 31, maxBytes: 16384 };
const workbenchBaseColumns = [
  { label: "Notes", html: packet => packetNote(packet.number) ? `<button class="note-indicator" type="button" data-note-frame="${packet.number}" aria-label="Edit note for frame ${packet.number}" title="${escapeHtml(notePreview(packetNote(packet.number)))}">▤</button>` : "" },
  { label: "Mark", html: packet => frameIndicator(packet) },
  { label: "No.", value: packet => packet.number },
  { label: "Time", value: (packet, displayedIndex) => formatWorkbenchTime(packet, displayedIndex) },
  { label: "Source", value: packet => packet.src },
  { label: "Destination", value: packet => packet.dst },
  { label: "Protocol", value: packet => packet.protocol },
  { label: "Length", value: packet => packet.length },
  { label: "Size profile", html: packet => frameSizeBar(packet) },
  { label: "Info", value: packet => packet.info }
];

function frameSizeBar(packet) {
  const percentage = Math.max(2, packet.length / workbenchState.maxFrameLength * 100);
  return `<span class="packet-size-spark" title="${packet.length.toLocaleString()} bytes · ${percentage.toFixed(1)}% of largest frame"><i style="width:${percentage}%"></i></span>`;
}

function frameStateStorageKey() {
  return `datasnare-frame-state:${state.captureId || captureFingerprint(state.packets, state.fileName)}`;
}

function currentFrameState() {
  if (workbenchState.frameStateCaptureId === state.captureId && workbenchState.frameState) return workbenchState.frameState;
  workbenchState.frameStateCaptureId = state.captureId;
  try { workbenchState.frameState = JSON.parse(localStorage.getItem(frameStateStorageKey())) || {}; } catch (_) { workbenchState.frameState = {}; }
  const validModes = ["capture", "timeofday", "datetime", "previous-captured", "previous-displayed", "previous-marked", "reference", "epoch"];
  workbenchState.frameState = { marks: [...new Set((workbenchState.frameState.marks || []).map(Number).filter(Number.isFinite))], referenceNumber: Number(workbenchState.frameState.referenceNumber) || null, timeMode: validModes.includes(workbenchState.frameState.timeMode) ? workbenchState.frameState.timeMode : "capture" };
  return workbenchState.frameState;
}

function persistFrameState() {
  try { localStorage.setItem(frameStateStorageKey(), JSON.stringify(currentFrameState())); } catch (_) { showToast("Frame marks could not be saved locally."); }
}

function frameIndicator(packet) {
  const frameState = currentFrameState(); const reference = frameState.referenceNumber === packet.number; const marked = frameState.marks.includes(packet.number);
  const label = reference ? "Time reference" : marked ? "Marked frame" : "Mark frame";
  return `<button class="mark-indicator ${reference ? "reference" : marked ? "marked" : ""}" type="button" data-mark-toggle="${packet.number}" aria-label="${label} ${packet.number}" title="${label}${reference ? " (T0)" : ""}">${reference ? "T0" : marked ? "◆" : ""}</button>`;
}

function localPacketTime(timestamp, includeDate) {
  const date = new Date(timestamp * 1000); const pad = value => String(value).padStart(2, "0");
  const micros = String(Math.floor((timestamp - Math.floor(timestamp)) * 1e6)).padStart(6, "0");
  const time = `${pad(date.getHours())}:${pad(date.getMinutes())}:${pad(date.getSeconds())}.${micros}`;
  return includeDate ? `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${time}` : time;
}

function formatWorkbenchTime(packet, displayedIndex) {
  const frameState = currentFrameState(); const mode = frameState.timeMode;
  if (mode === "timeofday") return localPacketTime(packet.timestamp, false);
  if (mode === "datetime") return localPacketTime(packet.timestamp, true);
  if (mode === "epoch") return packet.timestamp.toFixed(6);
  if (mode === "previous-captured") { const previous = state.packets[packet.number - 2]; return (previous ? packet.timestamp - previous.timestamp : 0).toFixed(6); }
  if (mode === "previous-displayed") { const previous = workbenchState.packets[displayedIndex - 1]; return (previous ? packet.timestamp - previous.timestamp : 0).toFixed(6); }
  if (mode === "reference") { const reference = state.packets.find(item => item.number === frameState.referenceNumber); return reference ? (packet.timestamp - reference.timestamp).toFixed(6) : "—"; }
  if (mode === "previous-marked") {
    const marks = state.packets.filter(item => frameState.marks.includes(item.number) && item.number < packet.number);
    const previous = marks.at(-1); if (previous) return (packet.timestamp - previous.timestamp).toFixed(6);
    return frameState.marks.includes(packet.number) ? "0.000000" : "—";
  }
  return (packet.timestamp - state.baseTime).toFixed(6);
}

function toggleFrameMark(frameNumber) {
  const frameState = currentFrameState(); const index = frameState.marks.indexOf(frameNumber);
  if (index >= 0) { frameState.marks.splice(index, 1); if (frameState.referenceNumber === frameNumber) frameState.referenceNumber = null; }
  else frameState.marks.push(frameNumber);
  frameState.marks.sort((left, right) => left - right); persistFrameState(); renderWorkbenchList(frameNumber);
}

function toggleTimeReference(frameNumber) {
  const frameState = currentFrameState();
  if (frameState.referenceNumber === frameNumber) frameState.referenceNumber = null;
  else { frameState.referenceNumber = frameNumber; if (!frameState.marks.includes(frameNumber)) frameState.marks.push(frameNumber); frameState.marks.sort((left, right) => left - right); frameState.timeMode = "reference"; }
  persistFrameState(); renderWorkbenchList(frameNumber); showToast(frameState.referenceNumber ? `Frame ${frameNumber} set as time reference (T0).` : "Time reference cleared.");
}

function navigateMarked(direction) {
  const marked = workbenchState.packets.filter(packet => currentFrameState().marks.includes(packet.number)); if (!marked.length) return;
  const current = marked.findIndex(packet => packet.number === workbenchState.selectedNumber);
  const target = direction > 0 ? marked[current >= 0 && current < marked.length - 1 ? current + 1 : 0] : marked[current > 0 ? current - 1 : marked.length - 1];
  selectWorkbenchPacket(target.number);
}

function noteStorageKey() {
  return `datasnare-packet-notes:${state.captureId || captureFingerprint(state.packets, state.fileName)}`;
}

function summaryStorageKey() {
  return `datasnare-capture-summary:${state.captureId || captureFingerprint(state.packets, state.fileName)}`;
}

function captureSummary() {
  try {
    const summary = JSON.parse(localStorage.getItem(summaryStorageKey()));
    return summary && typeof summary === "object" ? { problemStatement: summary.problemStatement || "", narrative: summary.narrative || "", relevantFrames: Array.isArray(summary.relevantFrames) ? summary.relevantFrames : [], updatedAt: summary.updatedAt || null } : { problemStatement: "", narrative: "", relevantFrames: [], updatedAt: null };
  } catch (_) { return { problemStatement: "", narrative: "", relevantFrames: [], updatedAt: null }; }
}

function captureSummaryExists() {
  const summary = captureSummary();
  return Boolean(summary.problemStatement.trim() || notePreview(summary.narrative) || summary.relevantFrames.length);
}

function captureNotes() {
  if (workbenchState.notesCaptureId === state.captureId) return workbenchState.notes;
  workbenchState.notesCaptureId = state.captureId;
  try { workbenchState.notes = JSON.parse(localStorage.getItem(noteStorageKey())) || {}; } catch (_) { workbenchState.notes = {}; }
  return workbenchState.notes;
}

function packetNote(frameNumber) {
  return captureNotes()[frameNumber]?.html || "";
}

function notePreview(html) {
  const container = document.createElement("div"); container.innerHTML = html;
  return container.textContent.trim().replace(/\s+/g, " ").slice(0, 160) || "Packet note";
}

function sanitizeNoteHtml(html) {
  const documentNode = new DOMParser().parseFromString(`<div>${html}</div>`, "text/html");
  const allowed = new Set(["DIV", "P", "BR", "STRONG", "B", "EM", "I", "U", "UL", "OL", "LI", "BLOCKQUOTE", "CODE", "A"]);
  const dangerous = new Set(["SCRIPT", "STYLE", "IFRAME", "OBJECT", "EMBED", "FORM", "INPUT", "BUTTON"]);
  [...documentNode.body.querySelectorAll("*")].forEach(element => {
    if (dangerous.has(element.tagName)) { element.remove(); return; }
    if (!allowed.has(element.tagName)) { element.replaceWith(...element.childNodes); return; }
    const href = element.tagName === "A" ? element.getAttribute("href") || "" : "";
    [...element.attributes].forEach(attribute => element.removeAttribute(attribute.name));
    if (element.tagName === "A") {
      if (/^(https?:|mailto:)/i.test(href)) { element.setAttribute("href", href); element.setAttribute("target", "_blank"); element.setAttribute("rel", "noopener noreferrer"); }
    }
  });
  return documentNode.body.firstElementChild?.innerHTML.trim() || "";
}

function openNoteEditor(frameNumber) {
  const packet = state.packets.find(item => item.number === frameNumber); if (!packet) return;
  workbenchState.noteFrame = frameNumber;
  const note = captureNotes()[frameNumber];
  $("#noteDialogTitle").textContent = `Frame ${frameNumber} note`;
  $("#noteEditor").innerHTML = note?.html || "";
  $("#noteSavedStatus").textContent = note ? `Saved ${new Date(note.updatedAt).toLocaleString()}` : "Not saved";
  $("#deleteNoteButton").hidden = !note;
  $("#noteAddToSummary").checked = captureSummary().relevantFrames.some(frame => frame.number === frameNumber);
  updateNoteCharacterCount();
  $("#noteDialog").showModal();
  $("#noteEditor").focus();
}

function updateNoteCharacterCount() {
  $("#noteCharacterCount").textContent = `${$("#noteEditor").textContent.length.toLocaleString()} characters`;
}

function savePacketNote() {
  if (workbenchState.noteFrame === null) return;
  const html = sanitizeNoteHtml($("#noteEditor").innerHTML); const text = notePreview(html);
  const notes = captureNotes();
  if (text) notes[workbenchState.noteFrame] = { html, updatedAt: new Date().toISOString() }; else delete notes[workbenchState.noteFrame];
  try { localStorage.setItem(noteStorageKey(), JSON.stringify(notes)); workbenchState.notes = notes; } catch (_) { showToast("Could not save note: local storage is unavailable."); return; }
  if ($("#noteAddToSummary").checked) addFrameToCaptureSummary(workbenchState.noteFrame, false);
  $("#noteDialog").close(); renderWorkbenchList(workbenchState.selectedNumber); showToast(text ? `Note saved for frame ${workbenchState.noteFrame}.` : `Note cleared for frame ${workbenchState.noteFrame}.`);
}

function deletePacketNote() {
  if (workbenchState.noteFrame === null) return;
  const notes = captureNotes(); delete notes[workbenchState.noteFrame];
  try { localStorage.setItem(noteStorageKey(), JSON.stringify(notes)); workbenchState.notes = notes; } catch (_) { showToast("Could not delete note: local storage is unavailable."); return; }
  $("#noteDialog").close(); renderWorkbenchList(workbenchState.selectedNumber); showToast(`Note deleted from frame ${workbenchState.noteFrame}.`);
}

function updateSummaryTrigger() {
  const summary = captureSummary(); const count = summary.relevantFrames.length;
  $("#captureSummaryButton").classList.toggle("has-summary", captureSummaryExists());
  $("#captureSummaryButton").textContent = captureSummaryExists() ? `Analysis Summary · ${count}` : "Analysis Summary";
}

function openCaptureSummaryEditor() {
  if (!state.packets.length) { showToast("Open a capture before creating an analysis summary."); return; }
  const summary = captureSummary(); workbenchState.summaryDraftFrames = summary.relevantFrames.map(frame => ({ ...frame }));
  $("#summaryCaptureName").textContent = `${state.fileName} · ${state.packets.length.toLocaleString()} packets`;
  $("#summaryProblemStatement").value = summary.problemStatement;
  $("#summaryNarrativeEditor").innerHTML = summary.narrative;
  $("#summarySavedStatus").textContent = summary.updatedAt ? `Saved ${new Date(summary.updatedAt).toLocaleString()}` : "Not saved";
  $("#deleteCaptureSummaryButton").hidden = !captureSummaryExists();
  renderSummaryFrames(); updateSummaryCharacterCount();
  $("#captureSummaryDialog").showModal();
  $("#summaryProblemStatement").focus();
}

function renderSummaryFrames() {
  const frames = workbenchState.summaryDraftFrames;
  $("#summaryFrameCount").textContent = `${frames.length} frame${frames.length === 1 ? "" : "s"}`;
  $("#summaryFrames").innerHTML = frames.map(reference => {
    const packet = state.packets.find(item => item.number === reference.number); if (!packet) return "";
    const note = packetNote(packet.number);
    const process = packet.processCorrelation ? ` · ${packet.processCorrelation.process || `PID ${packet.processCorrelation.pid}`} (${packet.processCorrelation.confidence})` : "";
    return `<article class="summary-frame"><button class="summary-frame-open" type="button" data-summary-frame-open="${packet.number}"><span>Frame ${packet.number}</span><strong>${escapeHtml(packet.protocol)} · ${(packet.timestamp - state.baseTime).toFixed(6)}s</strong><small>${escapeHtml(packet.src)} → ${escapeHtml(packet.dst)} · ${packet.length} B${escapeHtml(process)}</small><p>${escapeHtml(note ? notePreview(note) : packet.info)}</p></button><button class="summary-frame-remove" type="button" data-summary-frame-remove="${packet.number}" aria-label="Remove frame ${packet.number} from summary">×</button></article>`;
  }).join("") || `<div class="summary-frames-empty">Right-click packets and choose <strong>Add to Capture Summary</strong> to build the evidence trail.</div>`;
}

function updateSummaryCharacterCount() {
  const count = $("#summaryProblemStatement").value.length + $("#summaryNarrativeEditor").textContent.length;
  $("#summaryCharacterCount").textContent = `${count.toLocaleString()} characters`;
}

function addFrameToCaptureSummary(frameNumber, notify = true) {
  const summary = captureSummary();
  if (!summary.relevantFrames.some(frame => frame.number === frameNumber)) summary.relevantFrames.push({ number: frameNumber, addedAt: new Date().toISOString() });
  summary.updatedAt = new Date().toISOString();
  try { localStorage.setItem(summaryStorageKey(), JSON.stringify(summary)); } catch (_) { showToast("Could not update capture summary: local storage is unavailable."); return; }
  updateSummaryTrigger();
  if (notify) showToast(`Frame ${frameNumber} added to Capture Summary.`);
}

function saveCaptureSummary() {
  const problemStatement = $("#summaryProblemStatement").value.trim();
  const narrative = sanitizeNoteHtml($("#summaryNarrativeEditor").innerHTML);
  const summary = { schema: "datasnare-ainetscope/capture-summary-v1", captureId: state.captureId, captureName: state.fileName, problemStatement, narrative, relevantFrames: workbenchState.summaryDraftFrames, updatedAt: new Date().toISOString() };
  try { localStorage.setItem(summaryStorageKey(), JSON.stringify(summary)); } catch (_) { showToast("Could not save summary: local storage is unavailable."); return; }
  $("#captureSummaryDialog").close(); updateSummaryTrigger(); showToast("Capture Analysis Summary saved locally.");
}

function deleteCaptureSummary() {
  try { localStorage.removeItem(summaryStorageKey()); } catch (_) { showToast("Could not delete summary: local storage is unavailable."); return; }
  $("#captureSummaryDialog").close(); updateSummaryTrigger(); showToast("Capture Analysis Summary deleted.");
}

function exportCaptureSummary() {
  const current = { schema: "datasnare-ainetscope/capture-summary-v1", captureId: state.captureId, captureName: state.fileName, problemStatement: $("#summaryProblemStatement").value.trim(), narrative: sanitizeNoteHtml($("#summaryNarrativeEditor").innerHTML), frameTiming: currentFrameState(), relevantFrames: workbenchState.summaryDraftFrames.map(reference => { const packet = state.packets.find(item => item.number === reference.number); return { ...reference, packet: packet ? { timestamp: packet.timestamp, source: packet.src, destination: packet.dst, protocol: packet.protocol, length: packet.length, info: packet.info, processCorrelation: packet.processCorrelation || null } : null, note: packetNote(reference.number) || null }; }), exportedAt: new Date().toISOString() };
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(current, null, 2)], { type: "application/json" })); link.download = `${state.fileName.replace(/\.[^.]+$/, "") || "capture"}-analysis-summary.json`; link.click(); URL.revokeObjectURL(link.href);
}

function showPacketWorkbench(number = null) {
  if (typeof hideTwoSided === "function") hideTwoSided();
  $("#dropZone").hidden = true;
  $("#workspace").hidden = true;
  $("#setWorkspace").hidden = true;
  $("#workbench").hidden = false;
  refreshPacketWorkbench(number);
  window.scrollTo({ top: 0, behavior: "smooth" });
}

function packetBytes(packet) {
  const captured = typeof packetCaptureBytes === "function" ? packetCaptureBytes(packet) : new Uint8Array();
  if (captured.length) return captured;
  if (packet?.rawBytes instanceof Uint8Array) return packet.rawBytes;
  if (Array.isArray(packet?.rawBytes)) return Uint8Array.from(packet.rawBytes);
  if (/^(?:[0-9a-f]{2}\s*)+$/i.test(packet?.raw || "")) return Uint8Array.from(packet.raw.trim().split(/\s+/).map(value => parseInt(value, 16)));
  return new Uint8Array();
}

function packetLayers(packet, bytes) {
  let layers = packet.layers?.length ? [...packet.layers] : null;
  if (!layers && bytes.length && typeof parseFrame === "function") layers = parseFrame(bytes, packet.number, packet.timestamp, packet.linkType || 1).layers;
  if (!layers) layers = [
    { name: "Frame", summary: `${packet.length} bytes captured; raw bytes unavailable`, start: 0, length: 0, fields: [{ name: "Arrival time", value: new Date(packet.timestamp * 1000).toISOString(), start: 0, length: 0 }] },
    { name: packet.protocol, summary: packet.info, start: 0, length: 0, fields: Object.entries(packet.details || {}).map(([name, value]) => ({ name, value, start: 0, length: 0 })) }
  ];
  const processLayer = typeof processCorrelationLayer === "function" ? processCorrelationLayer(packet) : null;
  if (processLayer) layers.push(processLayer);
  return layers;
}

function fieldKey(layerName, fieldName) {
  return `${layerName}\u001f${fieldName}`;
}

function fieldLabel(layerName, fieldName) {
  const layerLabels = { "User Datagram Protocol": "UDP", "Transmission Control Protocol": "TCP", "Internet Protocol Version 4": "IPv4", "Internet Protocol Version 6": "IPv6", "Ethernet II": "Ethernet" };
  return `${layerLabels[layerName] || layerName} ${fieldName}`;
}

function packetField(packet, key) {
  const [layerName, fieldName] = key.split("\u001f");
  const layer = packetLayers(packet, packetBytes(packet)).find(item => item.name === layerName);
  const field = layer?.fields?.find(item => item.name === fieldName);
  return field ? field.value : undefined;
}

function compareFieldValue(actual, filter) {
  if (actual === undefined || actual === null) return false;
  const numericActual = Number(actual); const numericExpected = Number(filter.value);
  const numeric = String(actual).trim() !== "" && String(filter.value).trim() !== "" && Number.isFinite(numericActual) && Number.isFinite(numericExpected);
  const left = numeric ? numericActual : String(actual).toLowerCase(); const right = numeric ? numericExpected : String(filter.value).toLowerCase();
  if (filter.operator === "!=") return left !== right;
  if (filter.operator === ">") return left > right;
  if (filter.operator === "<") return left < right;
  if (filter.operator === ">=") return left >= right;
  if (filter.operator === "<=") return left <= right;
  return left === right;
}

function workbenchFilteredPackets() {
  const query = $("#workbenchSearch").value.trim().toLowerCase(); const protocol = $("#workbenchProtocolFilter").value;
  return state.packets.filter(packet => (protocol === "all" || packet.protocol === protocol) && (!query || `${packet.number} ${packet.src} ${packet.dst} ${packet.protocol} ${packet.info} ${packet.processCorrelation?.pid || ""} ${packet.processCorrelation?.process || ""} ${packet.processCorrelation?.executable || ""} ${packet.processCorrelation?.user || ""}`.toLowerCase().includes(query)) && workbenchState.fieldFilters.every(filter => compareFieldValue(packetField(packet, filter.key), filter)));
}

function refreshPacketWorkbench(preferredNumber = null) {
  const hasPackets = state.packets.length > 0;
  $("#workbenchEmpty").hidden = hasPackets; $("#workbenchGrid").hidden = !hasPackets;
  $("#workbenchCaptureName").textContent = hasPackets ? state.fileName : "No capture loaded";
  $("#workbenchCaptureMeta").textContent = hasPackets ? `${state.packets.length.toLocaleString()} packets · packet workbench` : "Open a capture in the core view";
  updateSummaryTrigger();
  if (!hasPackets) return;
  if (state.packets.length > 25000 && !state.backgroundWorkbenchQueued) {
    state.backgroundWorkbenchQueued = true;
    $("#workbenchCaptureMeta").textContent = `${state.packets.length.toLocaleString()} packets · packet workbench loading in background`;
    setTimeout(() => {
      state.backgroundWorkbenchQueued = false;
      $("#workbenchCaptureMeta").textContent = `${state.packets.length.toLocaleString()} packets · packet workbench ready`;
      $("#timeDisplayMode").value = currentFrameState().timeMode;
      const protocols = [...new Set(state.packets.map(packet => packet.protocol))].sort(); const current = $("#workbenchProtocolFilter").value;
      $("#workbenchProtocolFilter").innerHTML = `<option value="all">All protocols</option>${protocols.map(protocol => `<option value="${escapeHtml(protocol)}">${escapeHtml(protocol)}</option>`).join("")}`;
      $("#workbenchProtocolFilter").value = protocols.includes(current) ? current : "all";
      renderWorkbenchList(preferredNumber);
    }, 0);
    return;
  }
  $("#timeDisplayMode").value = currentFrameState().timeMode;
  const protocols = [...new Set(state.packets.map(packet => packet.protocol))].sort(); const current = $("#workbenchProtocolFilter").value;
  $("#workbenchProtocolFilter").innerHTML = `<option value="all">All protocols</option>${protocols.map(protocol => `<option value="${escapeHtml(protocol)}">${escapeHtml(protocol)}</option>`).join("")}`;
  $("#workbenchProtocolFilter").value = protocols.includes(current) ? current : "all";
  renderWorkbenchList(preferredNumber);
}

function renderWorkbenchList(preferredNumber = null, renderFilterControls = true) {
  workbenchState.packets = workbenchFilteredPackets();
  workbenchState.maxFrameLength = state.packets.reduce((maximum, packet) => Math.max(maximum, packet.length), 1);
  if (preferredNumber && workbenchState.packets.some(packet => packet.number === preferredNumber)) workbenchState.selectedNumber = preferredNumber;
  if (!workbenchState.packets.some(packet => packet.number === workbenchState.selectedNumber)) workbenchState.selectedNumber = workbenchState.packets[0]?.number || null;
  const listPane = $("#workbenchListPane");
  if (preferredNumber) {
    const preferredIndex = workbenchState.packets.findIndex(packet => packet.number === preferredNumber);
    if (preferredIndex >= 0) listPane.scrollTop = Math.max(0, preferredIndex * workbenchState.rowHeight - (listPane.clientHeight - workbenchState.rowHeight) / 2);
  }
  const renderScrollTop = listPane.scrollTop;
  const totalRows = workbenchState.packets.length;
  const firstVisible = Math.max(0, Math.floor(listPane.scrollTop / workbenchState.rowHeight) - 20);
  const visible = workbenchState.packets.slice(firstVisible, firstVisible + workbenchState.maxRows);
  const processColumns = typeof processWorkbenchColumns === "function" ? processWorkbenchColumns() : [];
  const columns = [...workbenchBaseColumns, ...processColumns];
  $("#workbenchHeadRow").innerHTML = columns.map(column => `<th>${column.label}</th>`).join("") + workbenchState.columns.map(column => `<th class="custom-column" title="Right-click the matching tree field to remove">${escapeHtml(column.label)}</th>`).join("");
  $(".workbench-table").style.minWidth = `${1380 + processColumns.length * 145 + workbenchState.columns.length * 145}px`;
  const frameState = currentFrameState();
  const spacer = `<td colspan="${columns.length + workbenchState.columns.length}" aria-hidden="true"></td>`;
  const topSpacer = firstVisible ? `<tr class="workbench-virtual-spacer" style="height:${firstVisible * workbenchState.rowHeight}px">${spacer}</tr>` : "";
  const rows = visible.map((packet, displayedIndex) => `<tr data-workbench-packet="${packet.number}" class="${packet.number === workbenchState.selectedNumber ? "selected" : ""} ${frameState.marks.includes(packet.number) ? "marked" : ""} ${frameState.referenceNumber === packet.number ? "time-reference" : ""} ${packet.flags?.includes("RST") || packet.tdsError || packet.dnsRcode ? "flagged" : ""}">${columns.map(column => `<td title="${column.label === "Time" ? escapeHtml(new Date(packet.timestamp * 1000).toISOString()) : ""}">${column.html ? column.html(packet) : escapeHtml(column.value(packet, firstVisible + displayedIndex))}</td>`).join("")}${workbenchState.columns.map(column => { const value = packetField(packet, column.key); return `<td title="${escapeHtml(value ?? "Not present")}">${escapeHtml(value ?? "—")}</td>`; }).join("")}</tr>`).join("");
  const bottomHeight = Math.max(0, (totalRows - firstVisible - visible.length) * workbenchState.rowHeight);
  $("#workbenchRows").innerHTML = `${topSpacer}${rows || `<tr><td colspan="${columns.length + workbenchState.columns.length}">No matching packets</td></tr>`}${bottomHeight ? `<tr class="workbench-virtual-spacer" style="height:${bottomHeight}px">${spacer}</tr>` : ""}`;
  listPane.scrollTop = renderScrollTop;
  const fieldFilterStatus = workbenchState.fieldFilters.length ? ` · ${workbenchState.fieldFilters.length} field filter${workbenchState.fieldFilters.length === 1 ? "" : "s"}` : "";
  const markStatus = frameState.marks.length ? ` · ${frameState.marks.length} marked${frameState.referenceNumber ? ` · T0 frame ${frameState.referenceNumber}` : ""}` : "";
  $("#workbenchStatus").innerHTML = `<span>${totalRows ? `${firstVisible + 1}-${Math.min(firstVisible + visible.length, totalRows)} of ` : ""}${totalRows.toLocaleString()} matching packets${fieldFilterStatus}${markStatus}</span>`;
  if (renderFilterControls) renderFieldFilters();
  selectWorkbenchPacket(workbenchState.selectedNumber, Boolean(preferredNumber));
}

function renderFieldFilters() {
  const container = $("#workbenchFieldFilters"); container.hidden = !workbenchState.fieldFilters.length;
  container.innerHTML = workbenchState.fieldFilters.map((filter, index) => `<span class="field-filter-chip"><label>${escapeHtml(filter.label)}</label><select data-field-filter-operator="${index}" aria-label="${escapeHtml(filter.label)} comparison"><option value="=" ${filter.operator === "=" ? "selected" : ""}>=</option><option value="!=" ${filter.operator === "!=" ? "selected" : ""}>!=</option><option value=">" ${filter.operator === ">" ? "selected" : ""}>&gt;</option><option value="<" ${filter.operator === "<" ? "selected" : ""}>&lt;</option><option value=">=" ${filter.operator === ">=" ? "selected" : ""}>&gt;=</option><option value="<=" ${filter.operator === "<=" ? "selected" : ""}>&lt;=</option></select><input data-field-filter-value="${index}" value="${escapeHtml(filter.value)}" aria-label="${escapeHtml(filter.label)} filter value"><button type="button" data-remove-field-filter="${index}" aria-label="Remove ${escapeHtml(filter.label)} filter">×</button></span>`).join("");
}

function selectWorkbenchPacket(number, scroll = true) {
  const packet = state.packets.find(item => item.number === number); if (!packet) { $("#protocolTree").innerHTML = ""; $("#byteView").innerHTML = ""; $("#streamInspector").innerHTML = ""; return; }
  workbenchState.selectedNumber = number;
  if (scroll && !$(`#workbenchRows tr[data-workbench-packet="${number}"]`)) renderWorkbenchList(number, false);
  $("#workbenchRows tr.selected")?.classList.remove("selected");
  const row = $(`#workbenchRows tr[data-workbench-packet="${number}"]`); if (row) {
    row.classList.add("selected");
    if (scroll) {
      const listPane = $("#workbenchListPane");
      listPane.scrollTop = Math.max(0, row.offsetTop - (listPane.clientHeight - row.offsetHeight) / 2);
    }
  }
  const bytes = packetBytes(packet); const layers = packetLayers(packet, bytes);
  const byteStatus = bytes.length < packet.length ? ` · ${bytes.length.toLocaleString()}-byte preview (truncated)` : "";
  $("#workbenchDetailMeta").textContent = `Frame ${packet.number} · ${packet.length} bytes${byteStatus}`;
  $("#protocolTree").innerHTML = layers.map((layer, layerIndex) => `<details class="tree-layer" data-range-start="${layer.start}" data-range-length="${layer.length}" ${layerIndex < 3 ? "open" : ""}><summary><strong>${escapeHtml(layer.name)}</strong><span class="tree-summary">${escapeHtml(layer.summary || "")}</span></summary><div class="tree-fields">${(layer.fields || []).map((field, fieldIndex) => `<div class="tree-field" data-range-start="${field.start}" data-range-length="${field.length}" data-layer-index="${layerIndex}" data-field-index="${fieldIndex}" title="Right-click for filter and column actions"><span>${escapeHtml(field.name)}</span><span>${field.linkFrame ? `<button class="tree-frame-link" type="button" data-workbench-packet="${field.linkFrame}">${escapeHtml(field.value)}</button>` : escapeHtml(field.value)}</span></div>`).join("")}</div></details>`).join("");
  renderPacketBytes(bytes, 0, Math.min(bytes.length, 1), packet.length);
  renderStreamInspector(packet);
}

function streamKey(packet) {
  const transport = packet?.transport || (["TCP", "UDP"].includes(packet?.protocol) ? packet.protocol : "");
  if (!transport || !["TCP", "UDP"].includes(transport) || !Number.isFinite(Number(packet.srcPort)) || !Number.isFinite(Number(packet.dstPort))) return "";
  const endpoints = [`${packet.src}:${packet.srcPort}`, `${packet.dst}:${packet.dstPort}`].sort();
  return `${transport}|${endpoints[0]}|${endpoints[1]}`;
}

function streamPacketsFor(packet) {
  const key = streamKey(packet);
  return key ? state.packets.filter(item => streamKey(item) === key).sort((left, right) => left.timestamp - right.timestamp || left.number - right.number) : [];
}

function streamDirection(packet, streamPackets) {
  const endpoints = [...new Set(streamPackets.flatMap(item => [`${item.src}:${item.srcPort}`, `${item.dst}:${item.dstPort}`]))].sort();
  return `${packet.src}:${packet.srcPort}` === endpoints[0] ? "A → B" : "B → A";
}

function streamExpert(packet, streamPackets, index) {
  const protocol = String(packet.protocol || packet.transport || "Packet");
  const info = String(packet.info || "");
  const flags = Array.isArray(packet.flags) ? packet.flags : [];
  const applicationLabel = protocol === "HTTP" && packet.httpMethod ? `HTTP ${packet.httpMethod}` : protocol === "TDS" && packet.tdsType ? `TDS ${packet.tdsType}` : protocol === "DNS" ? `DNS ${packet.dnsResponse ? "Response" : "Query"}` : protocol.startsWith("SMB") && packet.smbCommand ? `SMB ${packet.smbCommand}` : protocol === "DCE/RPC" ? `DCE/RPC ${info.split(" ")[0] || "Packet"}` : protocol === "HTTP/2" ? `HTTP/2 ${packet.http2FrameType || "Frame"}` : "";
  const transport = packet.transport || protocol;
  if (transport !== "TCP") return applicationLabel || (flags.length ? flags.join(", ") : "UDP datagram");
  const prior = streamPackets.slice(0, index);
  const hasSyn = prior.some(item => item.flags?.includes("SYN") && !item.flags?.includes("ACK"));
  const hasSynAck = prior.some(item => item.flags?.includes("SYN") && item.flags?.includes("ACK"));
  const firstFin = flags.includes("FIN") && !prior.some(item => item.flags?.includes("FIN"));
  const secondFin = flags.includes("FIN") && prior.some(item => item.flags?.includes("FIN"));
  const retransmission = packet.payloadLength > 0 && packet.seq !== undefined && prior.some(item => item.src === packet.src && item.srcPort === packet.srcPort && item.seq === packet.seq && item.payloadLength > 0);
  if (flags.includes("RST")) return `${applicationLabel ? `[${applicationLabel}] ` : ""}Reset connection - state is CLOSED`;
  if (flags.includes("SYN") && !flags.includes("ACK")) return "Step 1/3 in 3-way connection - state is SYN-SENT";
  if (flags.includes("SYN") && flags.includes("ACK")) return "Step 2/3 in 3-way connection - state is SYN-RECEIVED";
  if (firstFin) return "Step 1/3 in 3-way disconnect - state is FIN-WAIT-1";
  if (secondFin) return "Step 2/3 in 3-way disconnect - state is FIN-WAIT-2";
  if (flags.includes("ACK") && hasSynAck && !prior.some(item => item.flags?.includes("ACK") && hasSynAck)) return "Step 3/3 in 3-way connection - state is ESTABLISHED";
  if (flags.includes("ACK") && prior.some(item => item.flags?.includes("FIN"))) return "Step 3/3 in 3-way disconnect - state is TIME-WAIT";
  if (retransmission) return `Retransmission - same sequence number as an earlier frame (${packet.seq})`;
  if (flags.includes("PSH")) return `${applicationLabel ? `[${applicationLabel}] ` : ""}Application data pushed to the receiver`;
  if (hasSyn && hasSynAck) return `${applicationLabel ? `[${applicationLabel}] ` : ""}State is ESTABLISHED`;
  return `${applicationLabel ? `[${applicationLabel}] ` : ""}${flags.length ? flags.join(", ") : "TCP segment"}`;
}

function renderStreamInspector(packet) {
  const packets = streamPacketsFor(packet);
  if (!packets.length) {
    $("#streamInspectorTitle").textContent = "Selected stream";
    $("#streamInspectorMeta").textContent = "No TCP/UDP conversation";
    $("#streamInspector").innerHTML = `<div class="stream-empty">Select a TCP or UDP packet to inspect its conversation.</div>`;
    return;
  }
  const streamNumber = [...new Set(state.packets.map(item => streamKey(item)).filter(Boolean))].indexOf(streamKey(packet)) + 1;
  $("#streamInspectorTitle").textContent = `Stream Index #${streamNumber}`;
  $("#streamInspectorMeta").textContent = `${packet.transport} · ${packets.length} packets`;
  const rows = packets.map((streamPacket, index) => {
    try {
      const direction = streamDirection(streamPacket, packets);
      const expert = streamExpert(streamPacket, packets, index);
      const packetFlags = Array.isArray(streamPacket.flags) ? streamPacket.flags : [];
      const packetLabel = packetFlags.length ? `[${packetFlags.join(", ")}]` : String(streamPacket.protocol || streamPacket.transport || "Packet");
      return `<button class="stream-packet-row ${streamPacket.number === packet.number ? "selected" : ""}" type="button" data-stream-packet="${streamPacket.number}"><span>${streamPacket.number}</span><span>${escapeHtml(packetLabel)}</span><span>${escapeHtml(direction)}</span><small>${escapeHtml(String(expert || ""))}</small></button>`;
    } catch (_) {
      return `<button class="stream-packet-row ${streamPacket.number === packet.number ? "selected" : ""}" type="button" data-stream-packet="${streamPacket.number}"><span>${streamPacket.number}</span><span>[${escapeHtml(String(streamPacket.protocol || streamPacket.transport || "Packet"))}]</span><span>—</span><small>Packet fields unavailable in this model</small></button>`;
    }
  }).join("");
  const references = settings.referenceLinks || [];
  $("#streamInspector").innerHTML = `<div class="stream-endpoints">${escapeHtml(packet.src)}:${packet.srcPort} ↔ ${escapeHtml(packet.dst)}:${packet.dstPort}</div><div class="stream-state-list">${rows}</div><nav class="stream-reference-links" aria-label="Protocol references">${references.map(reference => `<a href="${escapeHtml(reference.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(reference.label)} ↗</a>`).join("")}</nav>`;
}

function renderPacketBytes(bytes, highlightStart, highlightLength, rawLength = bytes.length) {
  workbenchState.highlight = { start: highlightStart, length: highlightLength };
  const shown = bytes.subarray(0, workbenchState.maxBytes); const rows = [];
  for (let offset = 0; offset < shown.length; offset += 16) {
    const line = shown.subarray(offset, offset + 16); let hex = ""; let ascii = "";
    for (let index = 0; index < 16; index++) {
      if (index < line.length) {
        const absolute = offset + index; const selected = absolute >= highlightStart && absolute < highlightStart + highlightLength; const title = `Offset 0x${absolute.toString(16).padStart(4, "0")} (${absolute}) · 0x${line[index].toString(16).padStart(2, "0")}`;
        hex += `<span class="byte-cell ${selected ? "byte-highlight" : ""}" data-byte-offset="${absolute}" title="${title}">${line[index].toString(16).padStart(2, "0")}</span>`;
        const character = line[index] >= 32 && line[index] <= 126 ? String.fromCharCode(line[index]) : ".";
        ascii += `<span class="ascii-cell ${selected ? "byte-highlight" : ""}" data-byte-offset="${absolute}" title="${title}">${escapeHtml(character)}</span>`;
      } else { hex += `<span class="byte-cell">  </span>`; ascii += " "; }
    }
    rows.push(`<div class="byte-row"><span class="byte-offset">${offset.toString(16).padStart(4, "0")}</span><span class="byte-hex">${hex}</span><span class="byte-ascii">${ascii}</span></div>`);
  }
  if (bytes.length > shown.length) rows.push(`<div class="byte-row"><span class="byte-offset">…</span><span>${(bytes.length - shown.length).toLocaleString()} additional available bytes not rendered</span></div>`);
  if (rawLength > bytes.length) rows.push(`<div class="byte-row byte-truncated"><span class="byte-offset">…</span><span>Preview truncated: ${(rawLength - bytes.length).toLocaleString()} capture bytes are not stored in this cached model</span></div>`);
  if (!bytes.length) rows.push(`<div class="byte-row byte-truncated"><span>Packet bytes are unavailable in this compact cached model.</span></div>`);
  $("#byteView").innerHTML = rows.join("");
  $("#workbenchByteMeta").textContent = `${bytes.length.toLocaleString()} of ${rawLength.toLocaleString()} bytes available · selected ${highlightStart}–${Math.max(highlightStart, highlightStart + highlightLength - 1)}`;
  const selected = $("#byteView .byte-highlight"); if (selected) selected.scrollIntoView({ block: "nearest" });
}

function selectByteRange(start, length, sourceElement = null) {
  const packet = state.packets.find(item => item.number === workbenchState.selectedNumber); if (!packet) return;
  $("#protocolTree .tree-selected")?.classList.remove("tree-selected"); if (sourceElement) sourceElement.classList.add("tree-selected");
  renderPacketBytes(packetBytes(packet), Number(start), Math.max(1, Number(length)), packet.length);
}

function selectLayerForByte(offset) {
  const packet = state.packets.find(item => item.number === workbenchState.selectedNumber); if (!packet) return;
  const bytes = packetBytes(packet); const layers = packetLayers(packet, bytes).filter(layer => offset >= layer.start && offset < layer.start + layer.length).sort((a, b) => a.length - b.length);
  const layer = layers[0]; if (!layer) return;
  const element = [...document.querySelectorAll("#protocolTree .tree-layer")].find(item => Number(item.dataset.rangeStart) === layer.start && Number(item.dataset.rangeLength) === layer.length);
  if (element) { element.open = true; element.scrollIntoView({ block: "nearest" }); }
  selectByteRange(layer.start, layer.length, element?.querySelector("summary"));
}

function moveWorkbenchSelection(delta) {
  const index = workbenchState.packets.findIndex(packet => packet.number === workbenchState.selectedNumber); const next = workbenchState.packets[Math.max(0, Math.min(workbenchState.packets.length - 1, index + delta))]; if (next) selectWorkbenchPacket(next.number);
}

function openFieldContextMenu(event, element) {
  event.preventDefault();
  const packet = state.packets.find(item => item.number === workbenchState.selectedNumber); if (!packet) return;
  const layer = packetLayers(packet, packetBytes(packet))[Number(element.dataset.layerIndex)]; const field = layer?.fields?.[Number(element.dataset.fieldIndex)]; if (!field) return;
  const key = fieldKey(layer.name, field.name); const label = fieldLabel(layer.name, field.name);
  workbenchState.contextField = { key, label, value: field.value };
  const menu = $("#fieldContextMenu"); $("#fieldContextTitle").textContent = `${label}: ${field.value}`;
  $("#fieldFilterAction").textContent = workbenchState.fieldFilters.some(filter => filter.key === key && filter.operator === "=" && compareFieldValue(field.value, filter)) ? "Remove This Filter" : "Apply as Filter";
  $("#fieldColumnAction").textContent = workbenchState.columns.some(column => column.key === key) ? "Remove Column" : "Apply as Column";
  menu.hidden = false;
  const width = 210; const estimatedHeight = 106;
  menu.style.left = `${Math.max(6, Math.min(innerWidth - width - 6, event.clientX))}px`; menu.style.top = `${Math.max(6, Math.min(innerHeight - estimatedHeight - 6, event.clientY))}px`;
  $("#fieldFilterAction").focus();
}

function hideFieldContextMenu() {
  $("#fieldContextMenu").hidden = true;
}

function openPacketContextMenu(event, row) {
  event.preventDefault(); selectWorkbenchPacket(Number(row.dataset.workbenchPacket), false);
  const frame = Number(row.dataset.workbenchPacket); workbenchState.noteFrame = frame;
  $("#packetContextTitle").textContent = `Frame ${frame}`;
  $("#packetNoteAction").textContent = packetNote(frame) ? "Edit Note" : "Add Note";
  $("#packetSummaryAction").textContent = captureSummary().relevantFrames.some(item => item.number === frame) ? "Open Capture Summary" : "Add to Capture Summary";
  const frameState = currentFrameState();
  $("#packetMarkAction").textContent = frameState.marks.includes(frame) ? "Unmark Frame" : "Mark Frame";
  $("#packetReferenceAction").textContent = frameState.referenceNumber === frame ? "Clear Time Reference" : "Set as Time Reference";
  const markedVisible = workbenchState.packets.filter(packet => frameState.marks.includes(packet.number));
  $("#previousMarkedAction").disabled = !markedVisible.length; $("#nextMarkedAction").disabled = !markedVisible.length;
  const menu = $("#packetContextMenu"); menu.hidden = false;
  menu.style.left = `${Math.max(6, Math.min(innerWidth - 190 - 6, event.clientX))}px`; menu.style.top = `${Math.max(6, Math.min(innerHeight - 230 - 6, event.clientY))}px`;
  $("#packetNoteAction").focus();
}

function hidePacketContextMenu() {
  $("#packetContextMenu").hidden = true;
}

function toggleContextFilter() {
  const field = workbenchState.contextField; if (!field) return;
  const index = workbenchState.fieldFilters.findIndex(filter => filter.key === field.key && filter.operator === "=" && compareFieldValue(field.value, filter));
  if (index >= 0) workbenchState.fieldFilters.splice(index, 1); else workbenchState.fieldFilters.push({ ...field, operator: "=" });
  hideFieldContextMenu(); renderWorkbenchList();
}

function toggleContextColumn() {
  const field = workbenchState.contextField; if (!field) return;
  const index = workbenchState.columns.findIndex(column => column.key === field.key);
  if (index >= 0) workbenchState.columns.splice(index, 1); else workbenchState.columns.push({ key: field.key, label: field.label });
  hideFieldContextMenu(); renderWorkbenchList(workbenchState.selectedNumber);
}

$("#workbenchModeButton").addEventListener("click", () => showPacketWorkbench());
$("#workbenchCoreButton").addEventListener("click", showCoreMode);
$("#workbenchOpenCoreButton").addEventListener("click", showCoreMode);
$("#workbenchSearch").addEventListener("input", () => renderWorkbenchList());
$("#workbenchProtocolFilter").addEventListener("change", () => renderWorkbenchList());
$("#timeDisplayMode").addEventListener("change", event => { currentFrameState().timeMode = event.target.value; persistFrameState(); renderWorkbenchList(workbenchState.selectedNumber); });
$("#workbenchRows").addEventListener("click", event => { const note = event.target.closest("[data-note-frame]"); if (note) { openNoteEditor(Number(note.dataset.noteFrame)); return; } const mark = event.target.closest("[data-mark-toggle]"); if (mark) { toggleFrameMark(Number(mark.dataset.markToggle)); return; } const row = event.target.closest("tr[data-workbench-packet]"); if (row) selectWorkbenchPacket(Number(row.dataset.workbenchPacket), false); });
$("#workbenchJumpForm").addEventListener("submit", event => {
  event.preventDefault();
  const number = Number($("#workbenchJumpNumber").value);
  const status = $("#workbenchJumpStatus");
  if (!Number.isSafeInteger(number) || number < 1) { status.textContent = "Enter a positive whole packet number."; return; }
  if (!state.packets.some(packet => packet.number === number)) { status.textContent = `Packet ${number} is not in this capture.`; return; }
  if (!workbenchFilteredPackets().some(packet => packet.number === number)) { status.textContent = `Packet ${number} is hidden by active filters. Clear filters to view it.`; return; }
  selectWorkbenchPacket(number, true);
  status.textContent = `Packet ${number} selected.`;
});
$("#workbenchRows").addEventListener("contextmenu", event => { const row = event.target.closest("tr[data-workbench-packet]"); if (row) openPacketContextMenu(event, row); });
$("#workbenchListPane").addEventListener("scroll", () => { if (workbenchState._scrollFrame) return; workbenchState._scrollFrame = requestAnimationFrame(() => { workbenchState._scrollFrame = 0; renderWorkbenchList(null, false); }); });
$("#workbenchStatus").addEventListener("click", event => { const control = event.target.closest("[data-workbench-page]"); if (!control) return; workbenchState.page += control.dataset.workbenchPage === "next" ? 1 : -1; renderWorkbenchList(workbenchState.selectedNumber, false); });
$("#protocolTree").addEventListener("click", event => { const frameLink = event.target.closest("[data-workbench-packet]"); if (frameLink) { event.preventDefault(); selectWorkbenchPacket(Number(frameLink.dataset.workbenchPacket)); return; } const target = event.target.closest(".tree-field, summary"); if (!target) return; const ranged = target.matches("summary") ? target.parentElement : target; selectByteRange(ranged.dataset.rangeStart, ranged.dataset.rangeLength, target); });
$("#protocolTree").addEventListener("contextmenu", event => { const field = event.target.closest(".tree-field"); if (field) openFieldContextMenu(event, field); });
$("#streamInspector").addEventListener("click", event => { const row = event.target.closest("[data-stream-packet]"); if (row) selectWorkbenchPacket(Number(row.dataset.streamPacket)); });
$("#streamResizer").addEventListener("pointerdown", event => {
  const grid = $("#workbenchGrid");
  const startWidth = $(".workbench-stream-pane").getBoundingClientRect().width;
  const startX = event.clientX;
  const move = moveEvent => {
    const width = Math.max(280, Math.min(700, startWidth - (moveEvent.clientX - startX)));
    grid.style.setProperty("--stream-width", `${width}px`);
  };
  const stop = () => { document.removeEventListener("pointermove", move); document.removeEventListener("pointerup", stop); };
  document.addEventListener("pointermove", move);
  document.addEventListener("pointerup", stop, { once: true });
  event.preventDefault();
});
$("#fieldFilterAction").addEventListener("click", toggleContextFilter);
$("#fieldColumnAction").addEventListener("click", toggleContextColumn);
$("#workbenchFieldFilters").addEventListener("click", event => { const button = event.target.closest("[data-remove-field-filter]"); if (!button) return; workbenchState.fieldFilters.splice(Number(button.dataset.removeFieldFilter), 1); renderWorkbenchList(); });
$("#workbenchFieldFilters").addEventListener("change", event => {
  if (!event.target.matches("[data-field-filter-operator]")) return;
  workbenchState.fieldFilters[Number(event.target.dataset.fieldFilterOperator)].operator = event.target.value;
  renderWorkbenchList();
});
$("#workbenchFieldFilters").addEventListener("input", event => {
  if (!event.target.matches("[data-field-filter-value]")) return;
  workbenchState.fieldFilters[Number(event.target.dataset.fieldFilterValue)].value = event.target.value;
  renderWorkbenchList(null, false);
});
$("#packetNoteAction").addEventListener("click", () => { hidePacketContextMenu(); openNoteEditor(workbenchState.noteFrame); });
$("#packetSummaryAction").addEventListener("click", () => { const frame = workbenchState.noteFrame; const exists = captureSummary().relevantFrames.some(item => item.number === frame); hidePacketContextMenu(); if (exists) openCaptureSummaryEditor(); else addFrameToCaptureSummary(frame); });
$("#packetMarkAction").addEventListener("click", () => { const frame = workbenchState.noteFrame; hidePacketContextMenu(); toggleFrameMark(frame); });
$("#packetReferenceAction").addEventListener("click", () => { const frame = workbenchState.noteFrame; hidePacketContextMenu(); toggleTimeReference(frame); });
$("#previousMarkedAction").addEventListener("click", () => { hidePacketContextMenu(); navigateMarked(-1); });
$("#nextMarkedAction").addEventListener("click", () => { hidePacketContextMenu(); navigateMarked(1); });
$("#closeNoteDialog").addEventListener("click", () => $("#noteDialog").close());
$("#cancelNoteButton").addEventListener("click", () => $("#noteDialog").close());
$("#saveNoteButton").addEventListener("click", savePacketNote);
$("#deleteNoteButton").addEventListener("click", deletePacketNote);
$("#noteEditor").addEventListener("input", () => { $("#noteSavedStatus").textContent = "Unsaved changes"; updateNoteCharacterCount(); });
$("#noteEditor").addEventListener("keydown", event => { if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); savePacketNote(); } });
$(".note-toolbar").addEventListener("mousedown", event => { if (event.target.closest("button")) event.preventDefault(); });
$(".note-toolbar").addEventListener("click", event => { const button = event.target.closest("[data-note-command]"); if (!button) return; $("#noteEditor").focus(); document.execCommand(button.dataset.noteCommand, false); updateNoteCharacterCount(); });
$("#noteLinkButton").addEventListener("click", () => { const url = prompt("Link URL (https:// or mailto:)", "https://"); if (url && /^(https?:|mailto:)/i.test(url)) { $("#noteEditor").focus(); document.execCommand("createLink", false, url); } });
$("#captureSummaryButton").addEventListener("click", openCaptureSummaryEditor);
$("#closeCaptureSummaryDialog").addEventListener("click", () => $("#captureSummaryDialog").close());
$("#cancelCaptureSummaryButton").addEventListener("click", () => $("#captureSummaryDialog").close());
$("#saveCaptureSummaryButton").addEventListener("click", saveCaptureSummary);
$("#deleteCaptureSummaryButton").addEventListener("click", deleteCaptureSummary);
$("#exportCaptureSummaryButton").addEventListener("click", exportCaptureSummary);
$("#summaryProblemStatement").addEventListener("input", () => { $("#summarySavedStatus").textContent = "Unsaved changes"; updateSummaryCharacterCount(); });
$("#summaryNarrativeEditor").addEventListener("input", () => { $("#summarySavedStatus").textContent = "Unsaved changes"; updateSummaryCharacterCount(); });
$("#summaryNarrativeEditor").addEventListener("keydown", event => { if (event.ctrlKey && event.key.toLowerCase() === "s") { event.preventDefault(); saveCaptureSummary(); } });
$(".summary-toolbar").addEventListener("mousedown", event => { if (event.target.closest("button")) event.preventDefault(); });
$(".summary-toolbar").addEventListener("click", event => { const button = event.target.closest("[data-summary-command]"); if (!button) return; $("#summaryNarrativeEditor").focus(); document.execCommand(button.dataset.summaryCommand, false); updateSummaryCharacterCount(); });
$("#summaryLinkButton").addEventListener("click", () => { const url = prompt("Link URL (https:// or mailto:)", "https://"); if (url && /^(https?:|mailto:)/i.test(url)) { $("#summaryNarrativeEditor").focus(); document.execCommand("createLink", false, url); } });
$("#summaryFrames").addEventListener("click", event => { const remove = event.target.closest("[data-summary-frame-remove]"); if (remove) { workbenchState.summaryDraftFrames = workbenchState.summaryDraftFrames.filter(frame => frame.number !== Number(remove.dataset.summaryFrameRemove)); renderSummaryFrames(); $("#summarySavedStatus").textContent = "Unsaved changes"; return; } const open = event.target.closest("[data-summary-frame-open]"); if (open) { $("#captureSummaryDialog").close(); showPacketWorkbench(Number(open.dataset.summaryFrameOpen)); } });
document.addEventListener("pointerdown", event => { if (!event.target.closest("#fieldContextMenu")) hideFieldContextMenu(); if (!event.target.closest("#packetContextMenu")) hidePacketContextMenu(); });
document.addEventListener("keydown", event => { if (event.key === "Escape") { hideFieldContextMenu(); hidePacketContextMenu(); } });
$("#byteView").addEventListener("click", event => { const cell = event.target.closest("[data-byte-offset]"); if (cell) selectLayerForByte(Number(cell.dataset.byteOffset)); });
$("#workbenchListPane").addEventListener("keydown", event => { if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); event.stopPropagation(); moveWorkbenchSelection(event.key === "ArrowDown" ? 1 : -1); } });
document.addEventListener("keydown", event => {
  if ($("#workbench").hidden || ["INPUT", "SELECT", "TEXTAREA"].includes(document.activeElement.tagName) || document.activeElement.isContentEditable || document.querySelector("dialog[open]")) return;
  if (event.key === "ArrowDown" || event.key === "ArrowUp") { event.preventDefault(); moveWorkbenchSelection(event.key === "ArrowDown" ? 1 : -1); }
  else if (event.key.toLowerCase() === "m" && !event.ctrlKey && workbenchState.selectedNumber) { event.preventDefault(); toggleFrameMark(workbenchState.selectedNumber); }
  else if (event.ctrlKey && event.key.toLowerCase() === "t" && workbenchState.selectedNumber) { event.preventDefault(); toggleTimeReference(workbenchState.selectedNumber); }
});

window.DataSnarePacketWorkbench = Object.freeze({ show: showPacketWorkbench, selectPacket: selectWorkbenchPacket });
