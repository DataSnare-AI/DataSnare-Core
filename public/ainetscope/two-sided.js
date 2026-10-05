"use strict";

const twoSidedState = { packetsA: [], packetsB: [], records: [], page: 0, offsetMs: 0, busy: false, selected: -1 };
function twoSidedPageSize() {
  return Math.max(25, Math.min(1000, Math.floor(Number(settings.twoSidedRowsPerPage) || 150)));
}

$("#settingsButton").addEventListener("click", () => {
  $("#twoSidedRowsPerPage").value = twoSidedPageSize();
});
$("#saveSettingsButton").addEventListener("click", () => {
  settings.twoSidedRowsPerPage = Math.max(25, Math.min(1000, Math.floor(Number($("#twoSidedRowsPerPage").value) || 150)));
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
  twoSidedState.page = 0;
  renderTwoSided();
  $("#twoSidedScroll").scrollTop = 0;
});

function hideTwoSided() {
  $("#twoSidedWorkspace").hidden = true;
}

function showTwoSided() {
  for (const selector of ["#dropZone", "#workspace", "#workbench", "#setWorkspace", "#watchWorkspace"]) {
    $(selector).hidden = true;
  }
  $("#twoSidedWorkspace").hidden = false;
  window.scrollTo({ top: 0 });
}

function twoSidedTime(timestamp) {
  return Number.isFinite(timestamp) ? new Date(timestamp * 1000).toISOString() : "No timestamp";
}

function twoSidedPacketHtml(packet, side, recordIndex) {
  if (!packet) return '<div class="two-sided-missing">No unique counterpart</div>';
  const corrected = packet.timestamp + (side === "B" ? twoSidedState.offsetMs / 1000 : 0);
  return `<button class="two-sided-packet" type="button" data-two-record="${recordIndex}" aria-label="Inspect System ${side} frame ${packet.number}">
    <strong>Frame ${packet.number} <span>${escapeHtml(packet.protocol || packet.transport || "Packet")}</span></strong>
    <time>${twoSidedTime(corrected)}</time>
    <span>${escapeHtml(packet.src)}:${packet.srcPort ?? ""} &gt; ${escapeHtml(packet.dst)}:${packet.dstPort ?? ""}</span>
    <small>${packet.seq === undefined ? escapeHtml(packet.info || "") : `Seq ${packet.seq} / Ack ${packet.ack} / Len ${packet.payloadLength} / ${escapeHtml((packet.flags || []).join(" "))}`}</small>
  </button>`;
}

function twoSidedVisibleRecords() {
  const connection = $("#twoSidedConnection").value;
  const includeContext = $("#twoSidedContext").checked;
  const query = $("#twoSidedSearch").value.trim().toLowerCase();
  return twoSidedState.records.map((record, index) => ({ record, index })).filter(({ record }) => {
    if ($("#twoSidedMatchedOnly").getAttribute("aria-pressed") === "true" && record.status !== "matched") return false;
    if (connection !== "all" && record.connection !== connection && !includeContext) return false;
    return !query || [record.connection, record.status, record.packetA?.number, record.packetB?.number,
      record.packetA?.seq, record.packetA?.ack, record.packetB?.seq, record.packetB?.ack].join(" ").toLowerCase().includes(query);
  });
}

function renderTwoSided() {
  const connection = $("#twoSidedConnection").value;
  const visible = twoSidedVisibleRecords();
  const pageSize = twoSidedPageSize();
  const pageCount = Math.max(1, Math.ceil(visible.length / pageSize));
  twoSidedState.page = Math.min(twoSidedState.page, pageCount - 1);
  const pageRows = visible.slice(twoSidedState.page * pageSize, (twoSidedState.page + 1) * pageSize);
  $("#twoSidedRows").innerHTML = pageRows.map(({ record, index }) => {
    const context = connection !== "all" && record.connection !== connection;
    const delta = record.deltaMs === null ? "" : `B - A ${record.deltaMs.toFixed(3)} ms`;
    const interval = record.transitMs === null ? delta : `${record.direction}: ${record.transitMs.toFixed(3)} ms`;
    const negative = record.transitMs !== null && record.transitMs < 0;
    return `<div class="two-sided-row two-sided-row--${record.status}${context ? " two-sided-row--context" : ""}${twoSidedState.selected === index ? " two-sided-row--selected" : ""}">
      ${twoSidedPacketHtml(record.packetA, "A", index)}
      <button class="two-sided-link" type="button" data-two-record="${index}" title="${escapeHtml(record.reason)}"><span>${context ? "Context / " : ""}${record.status}</span><b>${record.status === "matched" ? record.direction === "B to A" ? "&larr;" : record.direction === "A to B" ? "&rarr;" : "&harr;" : "?"}</b><small>${escapeHtml(interval)}${negative ? " / check clocks" : ""}</small></button>
      ${twoSidedPacketHtml(record.packetB, "B", index)}
    </div>`;
  }).join("") || '<p class="two-sided-missing">No packets match this view.</p>';
  $("#twoSidedPage").textContent = `${visible.length.toLocaleString()} rows / page ${twoSidedState.page + 1} of ${pageCount} / ${pageSize} rows per page`;
  $("#twoSidedPrevious").disabled = twoSidedState.page === 0;
  $("#twoSidedNext").disabled = twoSidedState.page === pageCount - 1;
  $("#twoSidedFirstMatch").disabled = !visible.some(({ record }) => record.status === "matched");
}

$("#twoSidedFirstMatch").addEventListener("click", () => {
  const visible = twoSidedVisibleRecords();
  const position = visible.findIndex(({ record }) => record.status === "matched");
  if (position < 0) return;
  twoSidedState.page = Math.floor(position / twoSidedPageSize());
  twoSidedState.selected = visible[position].index;
  renderTwoSided();
  const row = $("#twoSidedRows .two-sided-row--selected");
  row?.scrollIntoView({ block: "center", inline: "nearest" });
  row?.querySelector(".two-sided-link")?.focus({ preventScroll: true });
});

function inspectTwoSided(index) {
  const record = twoSidedState.records[index];
  if (!record) return;
  twoSidedState.selected = index;
  renderTwoSided();
  const detail = (packet, side) => packet ? `<section><h3>System ${side} / frame ${packet.number}</h3><dl>
    <dt>Original timestamp</dt><dd>${twoSidedTime(packet.timestamp)}</dd>
    <dt>Aligned timestamp</dt><dd>${twoSidedTime(packet.timestamp + (side === "B" ? twoSidedState.offsetMs / 1000 : 0))}</dd>
    <dt>Endpoints</dt><dd>${escapeHtml(packet.src)}:${packet.srcPort ?? ""} &gt; ${escapeHtml(packet.dst)}:${packet.dstPort ?? ""}</dd>
    <dt>Raw TCP sequence / acknowledgement</dt><dd>${packet.seq ?? "N/A"} / ${packet.ack ?? "N/A"}</dd>
    <dt>Flags / payload length</dt><dd>${escapeHtml((packet.flags || []).join(" "))} / ${packet.payloadLength ?? "N/A"}</dd>
  </dl></section>` : `<section><h3>System ${side}</h3><p>No unique counterpart.</p></section>`;
  $("#twoSidedDetail").innerHTML = `<p>${escapeHtml(record.status)}: ${escapeHtml(record.reason)}</p><p>${record.deltaMs === null ? "No paired interval" : `Corrected B minus A: ${record.deltaMs.toFixed(3)} ms`} / B offset: ${twoSidedState.offsetMs} ms</p><div class="two-sided-details">${detail(record.packetA, "A")}${detail(record.packetB, "B")}</div>`;
  $("#twoSidedDialog").showModal();
}

async function analyzeTwoSided(event) {
  event.preventDefault();
  if (twoSidedState.busy) return;
  const fileA = $("#twoSidedFileA").files[0];
  const fileB = $("#twoSidedFileB").files[0];
  if (!fileA || !fileB) return;
  twoSidedState.busy = true;
  $("#twoSidedAnalyze").disabled = true;
  $("#twoSidedStatus").textContent = "Parsing System A and System B locally...";
  try {
    const offsetMs = Number($("#twoSidedOffset").value);
    const toleranceMs = Number($("#twoSidedTolerance").value);
    const hostA = $("#twoSidedHostA").value.trim();
    const hostB = $("#twoSidedHostB").value.trim();
    const packetsA = await parseFile(fileA, false);
    const packetsB = await parseFile(fileB, false);
    const records = DataSnareTwoSidedMatch.correlate(packetsA, packetsB, { offsetMs, toleranceMs, hostA, hostB });
    Object.assign(twoSidedState, { packetsA, packetsB, records, offsetMs, page: 0, selected: -1 });
    $("#twoSidedNameA").textContent = `System A / ${fileA.name}`;
    $("#twoSidedNameB").textContent = `System B / ${fileB.name} / ${offsetMs >= 0 ? "+" : ""}${offsetMs} ms`;
    const connections = [...new Set(records.map(record => record.connection))];
    $("#twoSidedConnection").innerHTML = '<option value="all">All connections</option>' + connections.map(connection => `<option value="${escapeHtml(connection)}">${escapeHtml(connection)}</option>`).join("");
    const matched = records.filter(record => record.status === "matched").length;
    const ambiguous = records.filter(record => record.status === "ambiguous").length;
    $("#twoSidedStatus").textContent = `${packetsA.length.toLocaleString()} A frames / ${packetsB.length.toLocaleString()} B frames / ${matched.toLocaleString()} matched pairs / ${ambiguous.toLocaleString()} ambiguous observations / B offset ${offsetMs} ms`;
    renderTwoSided();
  } catch (error) {
    twoSidedState.records = [];
    renderTwoSided();
    $("#twoSidedStatus").textContent = `Analysis failed: ${error.message}`;
  } finally {
    twoSidedState.busy = false;
    $("#twoSidedAnalyze").disabled = false;
  }
}

$("#twoSidedMatchedOnly").addEventListener("click", () => {
  const button = $("#twoSidedMatchedOnly");
  const enabled = button.getAttribute("aria-pressed") !== "true";
  button.setAttribute("aria-pressed", String(enabled));
  button.textContent = enabled ? "Show All Observations" : "Show Matched Only";
  twoSidedState.page = 0;
  renderTwoSided();
  $("#twoSidedScroll").scrollTop = 0;
});
$("#twoSidedModeButton").addEventListener("click", showTwoSided);
$("#twoSidedBack").addEventListener("click", () => { hideTwoSided(); showCoreMode(); });
$("#twoSidedForm").addEventListener("submit", analyzeTwoSided);
$("#twoSidedRows").addEventListener("click", event => {
  const button = event.target.closest("[data-two-record]");
  if (button) inspectTwoSided(Number(button.dataset.twoRecord));
});
$("#twoSidedClose").addEventListener("click", () => $("#twoSidedDialog").close());
for (const selector of ["#twoSidedConnection", "#twoSidedContext", "#twoSidedSearch"]) {
  $(selector).addEventListener("input", () => { twoSidedState.page = 0; renderTwoSided(); });
}
$("#twoSidedPrevious").addEventListener("click", () => { twoSidedState.page--; renderTwoSided(); $("#twoSidedScroll").scrollTop = 0; });
$("#twoSidedNext").addEventListener("click", () => { twoSidedState.page++; renderTwoSided(); $("#twoSidedScroll").scrollTop = 0; });
window.DataSnareTwoSided = Object.freeze({ get records() { return twoSidedState.records; } });