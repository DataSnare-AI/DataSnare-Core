"use strict";

const flowDetailState = { path: [], targets: [], flows: [], expanded: new Set(), pathExpanded: false, sequenceSize: "normal" };

function flowEndpointHost(value) {
  const text = String(value || "");
  const match = text.match(/^(.*):(\d+)$/);
  return match ? match[1] : text;
}

function flowHostPairKey(left, right) {
  return [left, right].sort().join("|");
}

function flowHostOptions(flows) {
  const traffic = new Map();
  flows.forEach(flow => {
    const left = flowEndpointHost(flow.a); const right = flowEndpointHost(flow.b);
    traffic.set(left, (traffic.get(left) || 0) + flow.bytes);
    traffic.set(right, (traffic.get(right) || 0) + flow.bytes);
  });
  return [...traffic.entries()].sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0])).map(([host]) => host);
}

function inferFlowPath(flows, hosts) {
  if (!flows.length) return hosts.slice(0, 5);
  const degrees = new Map();
  const adjacency = new Map();
  flows.forEach(flow => {
    const left = flowEndpointHost(flow.a); const right = flowEndpointHost(flow.b);
    if (left === right) return;
    degrees.set(left, (degrees.get(left) || 0) + flow.bytes);
    degrees.set(right, (degrees.get(right) || 0) + flow.bytes);
    const leftEdges = adjacency.get(left) || [];
    const rightEdges = adjacency.get(right) || [];
    leftEdges.push({ host: right, bytes: flow.bytes });
    rightEdges.push({ host: left, bytes: flow.bytes });
    adjacency.set(left, leftEdges);
    adjacency.set(right, rightEdges);
  });
  const start = [...degrees.entries()].sort((left, right) => right[1] - left[1])[0]?.[0] || hosts[0];
  const path = [];
  const visited = new Set();
  let current = start;
  while (current && path.length < 5) {
    path.push(current);
    visited.add(current);
    const next = (adjacency.get(current) || []).filter(edge => !visited.has(edge.host)).sort((left, right) => right.bytes - left.bytes)[0]?.host;
    current = next;
  }
  hosts.forEach(host => { if (path.length < 5 && !visited.has(host)) path.push(host); });
  return path;
}

function parseFlowPathInput(value) {
  return String(value || "").split(/\s*(?:>|→|,|\|)\s*/).map(item => item.trim()).filter(Boolean).slice(0, 5);
}

function ensureFlowPath(flows) {
  const hosts = flowHostOptions(flows);
  const existing = flowDetailState.path.filter(host => hosts.includes(host)).slice(0, 5);
  if (existing.length >= 2) { flowDetailState.path = existing; return; }
  flowDetailState.path = inferFlowPath(flows, hosts);
}

function setFlowPath(path) {
  flowDetailState.path = path.slice(0, 5);
  $("#flowPathInput").value = flowDetailState.path.join(" > ");
}

function hopFlows(flows, left, right) {
  const key = flowHostPairKey(left, right);
  return flows.filter(flow => flowHostPairKey(flowEndpointHost(flow.a), flowEndpointHost(flow.b)) === key).sort((a, b) => b.bytes - a.bytes);
}

function pathHops(flows) {
  const hops = [];
  for (let index = 0; index < flowDetailState.path.length - 1; index += 1) {
    const left = flowDetailState.path[index]; const right = flowDetailState.path[index + 1];
    const items = hopFlows(flows, left, right);
    hops.push({ index, left, right, flows: items, bytes: items.reduce((sum, flow) => sum + flow.bytes, 0), packets: items.reduce((sum, flow) => sum + flow.packets, 0), resets: items.reduce((sum, flow) => sum + flow.resets, 0), syns: items.reduce((sum, flow) => sum + flow.syns, 0), fins: items.reduce((sum, flow) => sum + flow.fins, 0), retransmissions: items.reduce((sum, flow) => sum + flow.retransmissions, 0) });
  }
  return hops;
}

function renderFlowDetail(flows = flowDetailState.flows) {
  flowDetailState.flows = flows;
  ensureFlowPath(flows);
  $("#flowPathInput").value = flowDetailState.path.join(" > ");
  const hops = pathHops(flows);
  renderFlowDetailSummary(hops);
  renderFlowDetailRows(hops, hops.flatMap(hop => hop.flows.map(flow => ({ ...flow, hop }))));
  drawFlowDetail(hops);
}

function renderFlowDetailSummary(hops) {
  const bytes = hops.reduce((sum, hop) => sum + hop.bytes, 0);
  const packets = hops.reduce((sum, hop) => sum + hop.packets, 0);
  const missing = hops.filter(hop => !hop.flows.length).length;
  const flows = hops.reduce((sum, hop) => sum + hop.flows.length, 0);
  const items = [
    ["Path hosts", flowDetailState.path.length.toLocaleString(), flowDetailState.path.join(" > ") || "No hosts"],
    ["Hops", hops.length.toLocaleString(), missing ? `${missing} missing` : "all observed"],
    ["Flows", flows.toLocaleString(), `${packets.toLocaleString()} packets`],
    ["Traffic", formatBytes(bytes), `${hops.reduce((sum, hop) => sum + hop.syns, 0)} / ${hops.reduce((sum, hop) => sum + hop.fins, 0)} / ${hops.reduce((sum, hop) => sum + hop.resets, 0)} SYN / FIN / RST`]
  ];
  $("#flowDetailSummary").innerHTML = items.map(([label, value, detail]) => `<div class="flow-detail-metric"><span>${label}</span><strong>${escapeHtml(value)}</strong><small>${escapeHtml(detail)}</small></div>`).join("");
}

function renderFlowDetailRows(hops, items) {
  const rowLimit = 75;
  const visibleItems = items.slice(0, rowLimit);
  const pathRow = `<tr class="path-sequence-control"><td colspan="9"><button class="button button-quiet" id="flowPathExpandButton" type="button">${flowDetailState.pathExpanded ? "Collapse path sequence" : "Expand full path sequence"}</button><span>${escapeHtml(flowDetailState.path.join(" > ") || "No path selected")}</span></td></tr>`;
  const pathDetail = flowDetailState.pathExpanded ? `<tr class="flow-sequence-row"><td colspan="9">${renderPathPacketSequence(hops)}</td></tr>` : "";
  const rows = visibleItems.map(item => {
    const expanded = flowDetailState.expanded.has(item.key);
    const row = `<tr data-flow-detail="${encodeURIComponent(item.key)}"><td class="endpoint-pair"><button class="flow-expand-button" type="button" data-flow-expand="${encodeURIComponent(item.key)}" aria-label="${expanded ? "Collapse" : "Expand"} flow packet sequence">${expanded ? "−" : "+"}</button><strong>${escapeHtml(item.hop.left)} → ${escapeHtml(item.hop.right)}</strong><small>${escapeHtml(item.a)} ↔ ${escapeHtml(item.b)}</small></td><td><span class="badge">${escapeHtml(item.protocol)}</span></td><td>${item.packets.toLocaleString()}</td><td>${formatBytes(item.bytes)}</td><td>${item.syns.toLocaleString()}</td><td>${item.fins.toLocaleString()}</td><td>${item.resets.toLocaleString()}</td><td>${formatLatency(item.latencyValue)}</td><td><span class="badge ${item.resets || item.state === "Handshake failed" ? "warn" : "good"}">${escapeHtml(item.state)}</span></td></tr>`;
    const detail = expanded ? `<tr class="flow-sequence-row"><td colspan="9">${renderFlowPacketSequence(item)}</td></tr>` : "";
    return row + detail;
  }).join("") || `<tr><td colspan="9">Enter a path with at least two observed hosts.</td></tr>`;
  const omitted = items.length > visibleItems.length ? `<tr><td colspan="9" class="flow-detail-more">Showing ${visibleItems.length.toLocaleString()} of ${items.length.toLocaleString()} path flows. Use the flow table or export for the full list.</td></tr>` : "";
  $("#flowDetailRows").innerHTML = pathRow + pathDetail + rows + omitted;
}

function pathPackets(hops) {
  return hops.flatMap(hop => hop.flows.flatMap(flow => (flow.packetData || []).map(packet => ({ packet, flow, hop })))).sort((left, right) => left.packet.timestamp - right.packet.timestamp).slice(0, 800);
}

function renderPathPacketSequence(hops) {
  const entries = pathPackets(hops);
  if (!entries.length) return `<div class="flow-sequence-empty">No retained packets match adjacent hops in this path.</div>`;
  const omitted = hops.reduce((sum, hop) => sum + hop.flows.reduce((flowSum, flow) => flowSum + (flow.packetData?.length || 0), 0), 0) > entries.length ? `<div class="flow-sequence-note">Showing first ${entries.length.toLocaleString()} retained packets across the path.</div>` : "";
  return renderSequenceDiagram({ title: "Full path packet sequence", subtitle: flowDetailState.path.join(" > "), hosts: flowDetailState.path, entries, start: entries[0].packet.timestamp, omitted });
}

function renderFlowPacketSequence(flow) {
  const entries = (flow.packetData || []).slice(0, 400).map(packet => ({ packet, flow, hop: flow.hop }));
  if (!entries.length) return `<div class="flow-sequence-empty">Packet sequence is not retained for this flow in the compact model.</div>`;
  const omitted = (flow.packetData || []).length > entries.length ? `<div class="flow-sequence-note">Showing first ${entries.length.toLocaleString()} retained packets for this flow.</div>` : "";
  const hosts = flowDetailState.path.length >= 2 ? flowDetailState.path : [flowEndpointHost(flow.a), flowEndpointHost(flow.b)];
  return renderSequenceDiagram({ title: `${flow.protocol} packet sequence`, subtitle: `${flow.a} ↔ ${flow.b}`, hosts, entries, start: entries[0].packet.timestamp || flow.first, omitted });
}

function renderSequenceDiagram({ title, subtitle, hosts, entries, start, omitted }) {
  const denominator = Math.max(1, hosts.length - 1);
  return `<div class="flow-sequence sequence-size-${flowDetailState.sequenceSize}"><div class="flow-sequence-head"><div><strong>${escapeHtml(title)}</strong><span>${escapeHtml(subtitle)}</span></div><div class="sequence-size-controls" aria-label="Sequence view height"><button type="button" data-sequence-size="compact" class="${flowDetailState.sequenceSize === "compact" ? "active" : ""}">Compact</button><button type="button" data-sequence-size="normal" class="${flowDetailState.sequenceSize === "normal" ? "active" : ""}">Default</button><button type="button" data-sequence-size="tall" class="${flowDetailState.sequenceSize === "tall" ? "active" : ""}">Tall</button><button type="button" data-sequence-size="full" class="${flowDetailState.sequenceSize === "full" ? "active" : ""}">Full</button></div></div><div class="flow-sequence-scroll"><div class="sequence-diagram" style="--hosts:${hosts.length}"><div class="sequence-hosts">${hosts.map(host => `<span>${escapeHtml(host)}</span>`).join("")}</div><div class="sequence-lanes">${hosts.map(() => `<i></i>`).join("")}</div>${entries.map(({ packet, flow, hop }, index) => {
    const sourceHost = flowEndpointHost(packet.src);
    const destinationHost = flowEndpointHost(packet.dst);
    const sourceIndex = Math.max(0, hosts.indexOf(sourceHost));
    const destinationIndex = Math.max(0, hosts.indexOf(destinationHost));
    const x1 = sourceIndex / denominator * 100;
    const x2 = destinationIndex / denominator * 100;
    const left = Math.min(x1, x2);
    const width = Math.max(3, Math.abs(x2 - x1));
    const forward = x2 >= x1;
    const elapsedMs = (packet.timestamp - start) * 1000;
    const deltaMs = index ? (packet.timestamp - entries[index - 1].packet.timestamp) * 1000 : 0;
    const flags = (packet.flags || []).length ? packet.flags.join(",") : packet.protocol;
    const payload = Number.isFinite(packet.payloadLength) ? packet.payloadLength : 0;
    const hopLabel = hop ? `${hop.left} → ${hop.right}` : `${sourceHost} → ${destinationHost}`;
    return `<button class="sequence-packet ${forward ? "forward" : "reverse"}" type="button" data-flow-packet="${packet.number}"><span class="sequence-time">+${deltaMs.toFixed(3)} ms</span><span class="sequence-arrow" style="left:${left}%;width:${width}%"><i></i></span><span class="sequence-label" style="left:${Math.max(0, Math.min(86, (left + width / 2) - 7))}%">#${packet.number} · ${escapeHtml(flags)} · ${formatBytes(packet.length)} · data ${formatBytes(payload)}</span><small>${elapsedMs.toFixed(3)} ms · ${escapeHtml(hopLabel)} · ${escapeHtml(sourceHost)} → ${escapeHtml(destinationHost)} · ${escapeHtml(packet.info)}</small></button>`;
  }).join("")}</div></div>${omitted}</div>`;
}

function drawFlowDetail(hops) {
  const canvas = $("#flowDetailCanvas");
  const { context, width, height } = setupCanvas(canvas);
  flowDetailState.targets = [];
  $("#flowDetailTooltip").hidden = true;
  if (flowDetailState.path.length < 2) { drawEmptyChart(context, width, height, "Enter a path with 2 to 5 hosts"); return; }
  const top = 58; const pathY = 52; const laneTop = 104; const laneBottom = height - 48;
  const left = 58; const right = width - 58; const usableWidth = Math.max(1, right - left);
  const spacing = usableWidth / Math.max(1, flowDetailState.path.length - 1);
  const positions = flowDetailState.path.map((host, index) => ({ host, x: left + spacing * index, y: pathY }));
  context.font = "10px DM Mono";
  context.strokeStyle = "rgba(23,33,29,.2)"; context.lineWidth = 1;
  context.beginPath(); context.moveTo(left, pathY); context.lineTo(right, pathY); context.stroke();
  positions.forEach((node, index) => {
    context.beginPath(); context.arc(node.x, node.y, 13, 0, Math.PI * 2); context.fillStyle = index === 0 ? COLORS[0] : index === positions.length - 1 ? COLORS[1] : COLORS[3]; context.fill(); context.strokeStyle = "#fbfaf6"; context.lineWidth = 2; context.stroke();
    context.fillStyle = "#17211d"; context.textAlign = "center"; context.fillText(node.host, node.x, node.y - 22);
  });
  const observed = hops.filter(hop => hop.flows.length);
  const maxBytes = Math.max(...observed.map(hop => hop.bytes), 1);
  const laneHeight = (laneBottom - laneTop) / Math.max(1, hops.length);
  hops.forEach((hop, index) => {
    const from = positions[index]; const to = positions[index + 1]; const y = laneTop + laneHeight * (index + .5);
    const lineWidth = hop.flows.length ? 2 + hop.bytes / maxBytes * 12 : 2;
    context.beginPath(); context.moveTo(from.x, y); context.bezierCurveTo(from.x + spacing * .35, y - laneHeight * .28, to.x - spacing * .35, y + laneHeight * .28, to.x, y);
    context.strokeStyle = hop.resets ? COLORS[1] : hop.flows.length ? COLORS[index % COLORS.length] : "rgba(111,117,111,.35)";
    context.setLineDash(hop.flows.length ? [] : [5, 5]); context.lineWidth = lineWidth; context.globalAlpha = hop.flows.length ? .86 : .65; context.stroke(); context.globalAlpha = 1; context.setLineDash([]);
    context.fillStyle = hop.flows.length ? context.strokeStyle : "#6f756f";
    context.beginPath(); context.moveTo(to.x - 4, y); context.lineTo(to.x - 13, y - 5); context.lineTo(to.x - 13, y + 5); context.closePath(); context.fill();
    context.fillStyle = "#17211d"; context.textAlign = "center";
    context.fillText(hop.flows.length ? `${hop.flows.length} flows · ${formatBytes(hop.bytes)}` : "no direct flow", (from.x + to.x) / 2, y - Math.max(10, lineWidth));
    flowDetailState.targets.push({ hop, x: (from.x + to.x) / 2, y, radius: Math.max(16, lineWidth * 1.6) });
  });
  context.fillStyle = "#6f756f"; context.textAlign = "left"; context.fillText("Adjacent hops are aggregated independently; click a hop to select its largest flow.", 18, height - 14);
}

function flowDetailTargetAt(event) {
  const rectangle = $("#flowDetailCanvas").getBoundingClientRect();
  const x = event.clientX - rectangle.left; const y = event.clientY - rectangle.top;
  let nearest = null; let distance = Infinity;
  flowDetailState.targets.forEach(target => { const value = Math.hypot(target.x - x, target.y - y); if (value < distance) { nearest = target; distance = value; } });
  return nearest && distance <= nearest.radius ? nearest : null;
}

function showFlowDetailTooltip(event, target) {
  const tooltip = $("#flowDetailTooltip"); const wrapper = tooltip.parentElement; const hop = target.hop; const topFlow = hop.flows[0];
  tooltip.innerHTML = `<div class="flow-tooltip-title"><strong>${escapeHtml(hop.left)} → ${escapeHtml(hop.right)}</strong><span>${hop.flows.length ? `${hop.flows.length} flows` : "missing"}</span></div><dl><dt>Packets</dt><dd>${hop.packets.toLocaleString()}</dd><dt>Traffic</dt><dd>${formatBytes(hop.bytes)}</dd><dt>SYN / FIN / RST</dt><dd>${hop.syns} / ${hop.fins} / ${hop.resets}</dd><dt>Retransmits</dt><dd>${hop.retransmissions}</dd>${topFlow ? `<dt>Largest flow</dt><dd>${escapeHtml(topFlow.protocol)} · ${formatBytes(topFlow.bytes)} · ${escapeHtml(topFlow.state)}</dd>` : ""}</dl><small>${topFlow ? "Click to select the largest flow timeline" : "No direct adjacent flow in this capture"}</small>`;
  tooltip.hidden = false;
  const wrapperRect = wrapper.getBoundingClientRect(); const tooltipRect = tooltip.getBoundingClientRect(); const pointerX = event.clientX - wrapperRect.left; const pointerY = event.clientY - wrapperRect.top;
  tooltip.style.left = `${Math.max(8, Math.min(wrapperRect.width - tooltipRect.width - 8, pointerX + 14))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(wrapperRect.height - tooltipRect.height - 8, pointerY - tooltipRect.height / 2))}px`;
}

function selectFlowDetailFlow(key) {
  state.activeFlowKey = key;
  const flowSelect = $("#flowSelect");
  if ([...flowSelect.options].some(option => option.value === key)) flowSelect.value = key;
  drawFlowTimeline(flowDetailState.flows.find(flow => flow.key === key));
  document.querySelector(".flow-explorer")?.scrollIntoView({ behavior: "smooth", block: "center" });
}

function selectFlowDetailHop(hop) {
  if (hop.flows[0]) selectFlowDetailFlow(hop.flows[0].key);
}

$("#flowPathInput").addEventListener("change", event => { setFlowPath(parseFlowPathInput(event.target.value)); renderFlowDetail(); });
$("#flowPathInput").addEventListener("keydown", event => { if (event.key === "Enter") { event.preventDefault(); setFlowPath(parseFlowPathInput(event.currentTarget.value)); renderFlowDetail(); } });
$("#flowAutoPathButton").addEventListener("click", () => { setFlowPath(inferFlowPath(flowDetailState.flows, flowHostOptions(flowDetailState.flows))); renderFlowDetail(); });
$("#flowDetailCanvas").addEventListener("mousemove", event => { const target = flowDetailTargetAt(event); event.currentTarget.style.cursor = target?.hop.flows[0] ? "pointer" : "default"; if (target) showFlowDetailTooltip(event, target); else $("#flowDetailTooltip").hidden = true; });
$("#flowDetailCanvas").addEventListener("mouseleave", () => { $("#flowDetailTooltip").hidden = true; $("#flowDetailCanvas").style.cursor = "default"; });
$("#flowDetailCanvas").addEventListener("click", event => { const target = flowDetailTargetAt(event); if (target) selectFlowDetailHop(target.hop); });
$("#flowDetailRows").addEventListener("click", event => {
  const expand = event.target.closest("[data-flow-expand]");
  if (expand) {
    event.stopPropagation();
    const key = decodeURIComponent(expand.dataset.flowExpand);
    if (flowDetailState.expanded.has(key)) flowDetailState.expanded.delete(key);
    else flowDetailState.expanded.add(key);
    renderFlowDetail();
    return;
  }
  const pathExpand = event.target.closest("#flowPathExpandButton");
  if (pathExpand) {
    event.stopPropagation();
    flowDetailState.pathExpanded = !flowDetailState.pathExpanded;
    renderFlowDetail();
    return;
  }
  const packet = event.target.closest("[data-flow-packet]");
  if (packet) {
    event.stopPropagation();
    inspectPacket(Number(packet.dataset.flowPacket));
    return;
  }
  const sequenceSize = event.target.closest("[data-sequence-size]");
  if (sequenceSize) {
    event.stopPropagation();
    flowDetailState.sequenceSize = sequenceSize.dataset.sequenceSize;
    renderFlowDetail();
    return;
  }
  const row = event.target.closest("tr[data-flow-detail]");
  if (row) selectFlowDetailFlow(decodeURIComponent(row.dataset.flowDetail));
});

window.renderFlowDetail = renderFlowDetail;
