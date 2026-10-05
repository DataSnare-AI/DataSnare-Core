"use strict";

let flowTimelineHitTargets = [];
let latencyHitTargets = [];
let frameSizeHitTargets = [];
let topologyHitTargets = [];

function standardDeviation(values) {
  if (values.length < 2) return NaN;
  const average = values.reduce((sum, value) => sum + value, 0) / values.length;
  return Math.sqrt(values.reduce((sum, value) => sum + (value - average) ** 2, 0) / values.length);
}

function drawEmptyChart(context, width, height, message) {
  context.fillStyle = "#6f756f";
  context.font = "11px DM Mono";
  context.textAlign = "center";
  context.fillText(message, width / 2, height / 2);
  context.textAlign = "left";
}

function drawLatencyChart(aggregation) {
  const canvas = $("#latencyCanvas");
  const { context, width, height } = setupCanvas(canvas);
  latencyHitTargets = [];
  $("#latencyTooltip").hidden = true;
  const events = aggregation.latencyEvents;
  if (!events.length) { drawEmptyChart(context, width, height, "No TCP handshake or DNS response samples"); return; }
  const padding = { left: 48, right: 18, top: 25, bottom: 30 };
  const chartWidth = width - padding.left - padding.right;
  const chartHeight = height - padding.top - padding.bottom;
  const maximum = Math.max(1, percentile(events.map(event => event.value), .99) * 1.15);
  const duration = Math.max(state.duration, .001);
  const flows = new Map(aggregation.flows.map(flow => [flow.key, `${flow.a} ↔ ${flow.b}`]));
  context.font = "9px DM Mono";
  context.strokeStyle = "#dedbd2";
  context.fillStyle = "#7a817a";
  for (let row = 0; row <= 4; row++) {
    const y = padding.top + chartHeight * row / 4;
    context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke();
    context.fillText(formatLatency(maximum * (1 - row / 4)), 3, y + 3);
  }
  for (const event of events) {
    const x = padding.left + ((event.timestamp - state.baseTime) / duration) * chartWidth;
    const y = padding.top + chartHeight * (1 - Math.min(event.value, maximum) / maximum);
    context.beginPath(); context.arc(x, y, 4, 0, Math.PI * 2); context.fillStyle = event.type === "DNS" ? COLORS[2] : COLORS[0]; context.fill();
    latencyHitTargets.push({ ...event, x, y, conversation: flows.get(event.flow) || event.flow });
  }
  context.fillStyle = "#7a817a"; context.fillText("0s", padding.left, height - 9); context.fillText(`${duration.toFixed(2)}s`, width - 58, height - 9);
}

function drawFrameSizeChart(packets) {
  const canvas = $("#frameSizeCanvas"); const { context, width, height } = setupCanvas(canvas);
  frameSizeHitTargets = []; $("#frameSizeTooltip").hidden = true;
  if (!packets.length) { drawEmptyChart(context, width, height, "No packets in this view"); return; }
  const lengths = packets.map(packet => packet.length); const average = lengths.reduce((sum, value) => sum + value, 0) / lengths.length;
  const largestFrame = lengths.reduce((maximum, value) => Math.max(maximum, value), 0);
  $("#frameAverage").textContent = formatBytes(average); $("#frameP95").textContent = formatBytes(percentile(lengths, .95)); $("#frameMaximum").textContent = formatBytes(largestFrame);
  const padding = { left: 48, right: 18, top: 24, bottom: 30 }; const chartWidth = width - padding.left - padding.right; const chartHeight = height - padding.top - padding.bottom;
  const bucketCount = Math.max(1, Math.min(packets.length, Math.floor(chartWidth))); const bucketSize = packets.length / bucketCount; const buckets = [];
  for (let index = 0; index < bucketCount; index++) {
    const start = Math.floor(index * bucketSize); const end = Math.max(start + 1, Math.floor((index + 1) * bucketSize)); const items = packets.slice(start, end); const maxPacket = items.reduce((largest, packet) => packet.length > largest.length ? packet : largest, items[0]);
    buckets.push({ start: items[0], end: items.at(-1), maximum: maxPacket.length, average: items.reduce((sum, packet) => sum + packet.length, 0) / items.length, maxPacket });
  }
  const maximum = Math.max(1, ...buckets.map(bucket => bucket.maximum)); context.font = "9px DM Mono"; context.fillStyle = "#6f756f"; context.strokeStyle = "#dedbd2";
  for (let row = 0; row <= 4; row++) { const y = padding.top + chartHeight * row / 4; context.beginPath(); context.moveTo(padding.left, y); context.lineTo(width - padding.right, y); context.stroke(); context.fillText(formatBytes(maximum * (1 - row / 4)), 2, y + 3); }
  buckets.forEach((bucket, index) => { const x = padding.left + index / Math.max(1, bucketCount - 1) * chartWidth; const y = padding.top + chartHeight * (1 - bucket.maximum / maximum); context.strokeStyle = "rgba(65,130,164,.5)"; context.lineWidth = Math.max(1, chartWidth / bucketCount); context.beginPath(); context.moveTo(x, padding.top + chartHeight); context.lineTo(x, y); context.stroke(); frameSizeHitTargets.push({ ...bucket, x, y }); });
  context.beginPath(); buckets.forEach((bucket, index) => { const from = Math.max(0, index - 3); const to = Math.min(buckets.length, index + 4); const moving = buckets.slice(from, to).reduce((sum, item) => sum + item.average, 0) / (to - from); const x = padding.left + index / Math.max(1, bucketCount - 1) * chartWidth; const y = padding.top + chartHeight * (1 - moving / maximum); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.strokeStyle = COLORS[1]; context.lineWidth = 2; context.stroke();
  context.fillStyle = "#6f756f"; context.fillText("0s", padding.left, height - 9); context.fillText(`${state.duration.toFixed(2)}s`, width - 58, height - 9);
}

function frameSizePointAt(event) {
  const rectangle = $("#frameSizeCanvas").getBoundingClientRect(); const x = event.clientX - rectangle.left;
  return frameSizeHitTargets.reduce((nearest, point) => !nearest || Math.abs(point.x - x) < Math.abs(nearest.x - x) ? point : nearest, null);
}

function showFrameSizeTooltip(event, point) {
  const tooltip = $("#frameSizeTooltip"); const wrapper = tooltip.parentElement;
  tooltip.innerHTML = `<div class="flow-tooltip-title"><strong>${point.start.number === point.end.number ? `Frame ${point.start.number}` : `Frames ${point.start.number}–${point.end.number}`}</strong><span>${formatBytes(point.maximum)} max</span></div><dl><dt>Average</dt><dd>${formatBytes(point.average)}</dd><dt>Largest frame</dt><dd>${point.maxPacket.number} · ${point.maxPacket.protocol}</dd><dt>Capture time</dt><dd>${(point.maxPacket.timestamp - state.baseTime).toFixed(6)}s</dd><dt>Endpoints</dt><dd>${escapeHtml(point.maxPacket.src)} → ${escapeHtml(point.maxPacket.dst)}</dd></dl><small>Click for largest frame details</small>`;
  tooltip.hidden = false; const wrapperRect = wrapper.getBoundingClientRect(); const tooltipRect = tooltip.getBoundingClientRect(); const pointerX = event.clientX - wrapperRect.left; const pointerY = event.clientY - wrapperRect.top;
  tooltip.style.left = `${Math.max(8, Math.min(wrapperRect.width - tooltipRect.width - 8, pointerX + 14))}px`; tooltip.style.top = `${Math.max(8, Math.min(wrapperRect.height - tooltipRect.height - 8, pointerY - tooltipRect.height / 2))}px`;
}

function latencyPointAt(event) {
  const rectangle = $("#latencyCanvas").getBoundingClientRect(); const x = event.clientX - rectangle.left; const y = event.clientY - rectangle.top;
  let nearest = null; let distance = Infinity;
  latencyHitTargets.forEach(point => { const candidate = Math.hypot(x - point.x, y - point.y); if (candidate < distance) { nearest = point; distance = candidate; } });
  return distance <= 10 ? nearest : null;
}

function showLatencyTooltip(event, point) {
  const tooltip = $("#latencyTooltip"); const wrapper = tooltip.parentElement;
  tooltip.innerHTML = `<div class="flow-tooltip-title"><strong>${point.type === "DNS" ? "DNS response" : "TCP handshake RTT"}</strong><span>${formatLatency(point.value)}</span></div><dl><dt>Capture time</dt><dd>${(point.timestamp - state.baseTime).toFixed(6)}s</dd><dt>Frame</dt><dd>${point.packet}</dd><dt>Conversation</dt><dd>${escapeHtml(point.conversation)}</dd></dl><small>Click for full frame details</small>`;
  tooltip.hidden = false;
  const wrapperRect = wrapper.getBoundingClientRect(); const tooltipRect = tooltip.getBoundingClientRect(); const pointerX = event.clientX - wrapperRect.left; const pointerY = event.clientY - wrapperRect.top;
  tooltip.style.left = `${Math.max(8, Math.min(wrapperRect.width - tooltipRect.width - 8, pointerX + 14))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(wrapperRect.height - tooltipRect.height - 8, pointerY - tooltipRect.height / 2))}px`;
}

function drawTopology(flows) {
  const canvas = $("#topologyCanvas");
  const { context, width, height } = setupCanvas(canvas);
  topologyHitTargets = [];
  $("#topologyTooltip").hidden = true;
  const traffic = new Map();
  const edges = new Map();
  const host = (value, transport) => transport ? value.slice(0, value.lastIndexOf(":")) : value;
  flows.forEach(flow => {
    const from = host(flow.a, flow.transport); const to = host(flow.b, flow.transport);
    traffic.set(from, (traffic.get(from) || 0) + flow.bytes); traffic.set(to, (traffic.get(to) || 0) + flow.bytes);
    const key = [from, to].sort().join("|");
    if (!edges.has(key)) edges.set(key, { from, to, bytes: 0 });
    edges.get(key).bytes += flow.bytes;
  });
  const nodes = [...traffic.entries()].sort((a, b) => b[1] - a[1]).slice(0, 12);
  if (!nodes.length) { drawEmptyChart(context, width, height, "No endpoint flows in this view"); return; }
  const nodeMap = new Map();
  const centerX = width / 2; const centerY = height / 2; const radius = Math.min(width, height) * .34;
  nodes.forEach(([name, bytes], index) => {
    const angle = -Math.PI / 2 + index / nodes.length * Math.PI * 2;
    nodeMap.set(name, { name, bytes, x: centerX + Math.cos(angle) * radius, y: centerY + Math.sin(angle) * radius });
  });
  const maximum = Math.max(...[...edges.values()].map(edge => edge.bytes), 1);
  edges.forEach(edge => {
    const from = nodeMap.get(edge.from); const to = nodeMap.get(edge.to); if (!from || !to) return;
    context.beginPath(); context.moveTo(from.x, from.y); context.lineTo(to.x, to.y); context.strokeStyle = "rgba(29,107,79,.3)"; context.lineWidth = 1 + edge.bytes / maximum * 7; context.stroke();
    topologyHitTargets.push({ type: "edge", ...edge, fromNode: from, toNode: to });
  });
  const maximumNode = Math.max(...nodes.map(node => node[1]), 1);
  nodeMap.forEach(node => {
    const size = 6 + node.bytes / maximumNode * 8;
    context.beginPath(); context.arc(node.x, node.y, size, 0, Math.PI * 2); context.fillStyle = COLORS[0]; context.fill(); context.strokeStyle = "#fbfaf6"; context.lineWidth = 2; context.stroke();
    context.fillStyle = "#17211d"; context.font = "9px DM Mono"; context.textAlign = node.x < centerX ? "right" : "left"; context.fillText(node.name, node.x + (node.x < centerX ? -size - 4 : size + 4), node.y + 3);
    topologyHitTargets.push({ type: "node", ...node, size, paths: [...edges.values()].filter(edge => edge.from === node.name || edge.to === node.name).length });
  });
  context.textAlign = "left";
  $("#topologyMeta").textContent = `${nodes.length} hosts · ${edges.size} paths`;
}

function topologyPointAt(event) {
  const rectangle = $("#topologyCanvas").getBoundingClientRect(); const x = event.clientX - rectangle.left; const y = event.clientY - rectangle.top;
  let nearest = null; let nearestDistance = Infinity;
  topologyHitTargets.forEach(target => {
    let distance;
    if (target.type === "node") distance = Math.hypot(x - target.x, y - target.y);
    else {
      const deltaX = target.toNode.x - target.fromNode.x; const deltaY = target.toNode.y - target.fromNode.y;
      const lengthSquared = deltaX ** 2 + deltaY ** 2; const ratio = Math.max(0, Math.min(1, ((x - target.fromNode.x) * deltaX + (y - target.fromNode.y) * deltaY) / lengthSquared));
      distance = Math.hypot(x - (target.fromNode.x + ratio * deltaX), y - (target.fromNode.y + ratio * deltaY));
    }
    if (distance < nearestDistance) { nearest = target; nearestDistance = distance; }
  });
  return nearestDistance <= (nearest?.type === "node" ? nearest.size + 6 : 9) ? nearest : null;
}

function showTopologyTooltip(event, target) {
  const tooltip = $("#topologyTooltip"); const wrapper = tooltip.parentElement;
  if (target.type === "node") tooltip.innerHTML = `<div class="flow-tooltip-title"><strong>${escapeHtml(target.name)}</strong><span>Endpoint</span></div><dl><dt>Traffic</dt><dd>${formatBytes(target.bytes)}</dd><dt>Connected paths</dt><dd>${target.paths}</dd></dl>`;
  else tooltip.innerHTML = `<div class="flow-tooltip-title"><strong>${escapeHtml(target.from)} ↔ ${escapeHtml(target.to)}</strong><span>Flow path</span></div><dl><dt>Traffic</dt><dd>${formatBytes(target.bytes)}</dd><dt>Direction</dt><dd>Bidirectional aggregate</dd></dl>`;
  tooltip.hidden = false;
  const wrapperRect = wrapper.getBoundingClientRect(); const tooltipRect = tooltip.getBoundingClientRect(); const pointerX = event.clientX - wrapperRect.left; const pointerY = event.clientY - wrapperRect.top;
  tooltip.style.left = `${Math.max(8, Math.min(wrapperRect.width - tooltipRect.width - 8, pointerX + 14))}px`; tooltip.style.top = `${Math.max(8, Math.min(wrapperRect.height - tooltipRect.height - 8, pointerY - tooltipRect.height / 2))}px`;
}

function drawFlowTimeline(flow) {
  const canvas = $("#flowCanvas");
  const { context, width, height } = setupCanvas(canvas);
  flowTimelineHitTargets = [];
  $("#flowTooltip").hidden = true;
  if (!flow) { drawEmptyChart(context, width, height, "Select a flow"); return; }
  const left = 52; const right = 20; const center = height / 2; const usableWidth = width - left - right; const duration = Math.max(flow.duration, .001);
  context.strokeStyle = "#d6d3c9"; context.beginPath(); context.moveTo(left, center); context.lineTo(width - right, center); context.stroke();
  context.font = "9px DM Mono"; context.fillStyle = "#6f756f"; context.fillText("A → B", 8, center - 42); context.fillText("B → A", 8, center + 48);
  flow.packetData.forEach(packet => {
    const x = left + (packet.timestamp - flow.first) / duration * usableWidth;
    const magnitude = Math.min(42, 5 + packet.length / 1500 * 37);
    const flags = packet.flags || [];
    context.strokeStyle = flags.includes("RST") ? COLORS[1] : packet.fromA ? COLORS[0] : COLORS[3];
    context.lineWidth = 2; context.beginPath(); context.moveTo(x, center); context.lineTo(x, center + (packet.fromA ? -magnitude : magnitude)); context.stroke();
    if (flags.includes("RST")) { context.fillStyle = COLORS[1]; context.fillRect(x - 3, center - 3, 6, 6); }
    flowTimelineHitTargets.push({ ...packet, flags, x, y: center + (packet.fromA ? -magnitude : magnitude), center, flowA: flow.a, flowB: flow.b, flowFirst: flow.first });
  });
  context.fillStyle = "#6f756f"; context.fillText("0s", left, height - 9); context.fillText(`${duration.toFixed(3)}s`, width - 70, height - 9);
}

function flowPacketAt(event) {
  const rectangle = $("#flowCanvas").getBoundingClientRect(); const x = event.clientX - rectangle.left; const y = event.clientY - rectangle.top;
  let nearest = null; let nearestDistance = Infinity;
  flowTimelineHitTargets.forEach(target => {
    const verticalDistance = y < Math.min(target.y, target.center) ? Math.min(target.y, target.center) - y : y > Math.max(target.y, target.center) ? y - Math.max(target.y, target.center) : 0;
    const distance = Math.hypot(x - target.x, verticalDistance);
    if (distance < nearestDistance) { nearest = target; nearestDistance = distance; }
  });
  return nearestDistance <= 9 ? nearest : null;
}

function showFlowTooltip(event, packet) {
  const tooltip = $("#flowTooltip"); const wrapper = tooltip.parentElement; const direction = packet.fromA ? `${packet.flowA} → ${packet.flowB}` : `${packet.flowB} → ${packet.flowA}`;
  const transport = packet.flags.length ? packet.flags.join(", ") : packet.protocol;
  tooltip.innerHTML = `<div class="flow-tooltip-title"><strong>Frame ${packet.number}</strong><span>${escapeHtml(packet.protocol)}</span></div><dl><dt>Flow time</dt><dd>${((packet.timestamp - packet.flowFirst) * 1000).toFixed(3)} ms</dd><dt>Direction</dt><dd>${escapeHtml(direction)}</dd><dt>Frame / payload</dt><dd>${packet.length} B / ${packet.payloadLength} B</dd><dt>Flags</dt><dd>${escapeHtml(transport)}</dd>${packet.seq !== undefined ? `<dt>Seq / Ack</dt><dd>${packet.seq} / ${packet.ack}</dd><dt>Window</dt><dd>${packet.window ?? "—"}</dd>` : ""}</dl><p>${escapeHtml(packet.info)}</p><small>Click for full frame details</small>`;
  tooltip.hidden = false;
  const wrapperRect = wrapper.getBoundingClientRect(); const tooltipRect = tooltip.getBoundingClientRect(); const pointerX = event.clientX - wrapperRect.left; const pointerY = event.clientY - wrapperRect.top;
  tooltip.style.left = `${Math.max(8, Math.min(wrapperRect.width - tooltipRect.width - 8, pointerX + 14))}px`;
  tooltip.style.top = `${Math.max(8, Math.min(wrapperRect.height - tooltipRect.height - 8, pointerY - tooltipRect.height / 2))}px`;
}

function analyzeServices(packets) {
  const serviceMap = new Map();
  const ensure = (name) => { if (!serviceMap.has(name)) serviceMap.set(name, { name, requests: 0, errors: 0, latencies: [], details: new Set(), packets: 0 }); return serviceMap.get(name); };
  packets.forEach(packet => {
    let name = packet.protocol;
    if (packet.protocol === "HTTP/2") name = "HTTP/2";
    if (["TCP", "UDP", "ARP", "ICMP", "ICMPv6", "Unknown"].includes(name) || name.startsWith("IP protocol")) return;
    const service = ensure(name); service.packets++;
    if (packet.protocol === "DNS") { if (!packet.dnsResponse) service.requests++; if (packet.dnsRcode) service.errors++; if (packet.dnsName || packet.details?.Name) service.details.add(packet.dnsName || packet.details.Name); }
    if (packet.protocol === "HTTP") { if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT)/.test(packet.info)) service.requests++; const status = packet.info.match(/HTTP\/1\.[01] (\d{3})/)?.[1]; if (status && Number(status) >= 400) service.errors++; if (packet.httpHost || packet.details?.Host && packet.details.Host !== "—") service.details.add(packet.httpHost || packet.details.Host); }
    if (packet.protocol === "HTTP/2" && packet.info.startsWith("HEADERS")) service.requests++;
    if (packet.protocol === "TLS" || packet.protocol === "HTTP/2") { if (packet.tlsSni || packet.details?.SNI) service.details.add(packet.tlsSni || packet.details.SNI); }
    if (packet.protocol === "QUIC") { service.requests += packet.info.startsWith("Initial") ? 1 : 0; if (packet.quicVersion || packet.details?.Version) service.details.add(packet.quicVersion || packet.details.Version); }
    if (packet.protocol.startsWith("SMB")) { service.requests++; if (/error|denied|failed/i.test(packet.info)) service.errors++; service.details.add(packet.smbCommand || packet.details?.Command || packet.info); }
    if (packet.protocol === "TDS") { service.requests += ["SQL batch", "RPC"].includes(packet.tdsType) ? 1 : 0; service.errors += packet.tdsError ? 1 : 0; if (packet.tdsType) service.details.add(packet.tdsType); }
    if (Number.isFinite(packet.latency)) service.latencies.push(packet.latency);
  });
  return [...serviceMap.values()].sort((a, b) => b.packets - a.packets);
}

function buildFindings(packets, aggregation, services, profile = getActiveAnalysisProfile()) {
  const findings = [];
  const add = (severity, title, detail, packet) => findings.push({ severity, title, detail, packet });
  const thresholds = profile.thresholds;
  const resetFlows = aggregation.flows.filter(flow => flow.resets);
  const failed = aggregation.flows.filter(flow => flow.state === "Handshake failed");
  const retransmissions = aggregation.flows.reduce((sum, flow) => sum + flow.retransmissions, 0);
  const duplicateAcks = aggregation.flows.reduce((sum, flow) => sum + flow.duplicateAcks, 0);
  const zeroWindows = aggregation.flows.reduce((sum, flow) => sum + flow.zeroWindows, 0);
  if (analysisRuleEnabled(profile, "tcpResets") && resetFlows.reduce((sum, flow) => sum + flow.resets, 0) >= thresholds.tcpResets) add("high", "TCP sessions reset", `${resetFlows.length} flows contain RST packets and may have been refused or aborted.`, resetFlows[0].packetRefs[0]);
  if (analysisRuleEnabled(profile, "handshakeFailures") && failed.length >= thresholds.handshakeFailures) add("high", "Incomplete TCP handshakes", `${failed.length} flows sent SYN without an observed SYN-ACK.`, failed[0].packetRefs[0]);
  if (analysisRuleEnabled(profile, "zeroWindows") && zeroWindows >= thresholds.zeroWindows) add("high", "Receiver backpressure", `${zeroWindows} TCP zero-window advertisements indicate a stalled receiver.`, aggregation.flows.find(flow => flow.zeroWindows)?.packetRefs[0]);
  if (analysisRuleEnabled(profile, "retransmissions") && retransmissions >= thresholds.retransmissions) add("medium", "Possible retransmissions", `${retransmissions} repeated payload sequence numbers were observed.`, aggregation.flows.find(flow => flow.retransmissions)?.packetRefs[0]);
  if (analysisRuleEnabled(profile, "duplicateAcks") && duplicateAcks >= thresholds.duplicateAcks) add("medium", "Duplicate ACK pattern", `${duplicateAcks} repeated ACK values may indicate loss or reordering.`, aggregation.flows.find(flow => flow.duplicateAcks)?.packetRefs[0]);
  const p95 = percentile(aggregation.latencySamples, .95);
  if (analysisRuleEnabled(profile, "latencyP95Ms") && p95 > thresholds.latencyP95Ms) add("medium", "Elevated tail latency", `The p95 response time is ${formatLatency(p95)}; ${profile.name} threshold is ${formatLatency(thresholds.latencyP95Ms)}.`, aggregation.latencyEvents.sort((a, b) => b.value - a.value)[0]?.packet);
  services.filter(service => analysisRuleEnabled(profile, "serviceErrors") && service.errors >= thresholds.serviceErrors).forEach(service => add(protocolIsFocused(profile, service.name) ? "high" : "medium", `${service.name} errors observed`, `${service.errors} error responses or tokens were decoded.`, packets.find(packet => packet.protocol === service.name && (packet.dnsRcode || packet.tdsError))?.number));
  services.filter(service => analysisRuleEnabled(profile, "serviceLatencyMs") && median(service.latencies) > thresholds.serviceLatencyMs).forEach(service => add(protocolIsFocused(profile, service.name) ? "high" : "medium", `Slow ${service.name} service`, `Median observed response time is ${formatLatency(median(service.latencies))}; ${profile.name} threshold is ${formatLatency(thresholds.serviceLatencyMs)}.`, packets.find(packet => packet.protocol === service.name && Number.isFinite(packet.latency))?.number));
  const topFlow = aggregation.flows[0]; const totalBytes = aggregation.flows.reduce((sum, flow) => sum + flow.bytes, 0);
  if (topFlow && analysisRuleEnabled(profile, "dominantFlowPercent") && topFlow.bytes / totalBytes * 100 > thresholds.dominantFlowPercent) add("info", "Dominant conversation", `${topFlow.a} ↔ ${topFlow.b} carries ${Math.round(topFlow.bytes / totalBytes * 100)}% of observed bytes.`, topFlow.packetRefs[0]);
  if (!findings.length) add("info", "No high-confidence anomalies", "No reset, handshake, window, retransmission, or decoded service-error thresholds were crossed.", null);
  const rank = { high: 0, medium: 1, info: 2 };
  return findings.sort((a, b) => rank[a.severity] - rank[b.severity]);
}

function analysisSummary(packets, aggregation = aggregate(packets)) {
  const bytes = packets.reduce((sum, packet) => sum + packet.length, 0);
  const frameLengths = packets.map(packet => packet.length);
  const duration = packets.length ? Math.max(.001, packets.at(-1).timestamp - packets[0].timestamp) : .001;
  const totalFlowBytes = aggregation.flows.reduce((sum, flow) => sum + flow.bytes, 0);
  return { packets: packets.length, bytes, duration, throughput: bytes * 8 / duration, frameAverage: frameLengths.length ? bytes / frameLengths.length : 0, frameP95: percentile(frameLengths, .95), frameMaximum: frameLengths.reduce((maximum, value) => Math.max(maximum, value), 0), flows: aggregation.flows.length, streams: aggregation.flows.length, connections: aggregation.flows.filter(flow => flow.transport === "TCP").length, syns: aggregation.flows.reduce((sum, flow) => sum + flow.syns, 0), fins: aggregation.flows.reduce((sum, flow) => sum + flow.fins, 0), latencyP50: percentile(aggregation.latencySamples, .5), latencyP95: percentile(aggregation.latencySamples, .95), retransmissions: aggregation.flows.reduce((sum, flow) => sum + flow.retransmissions, 0), duplicateAcks: aggregation.flows.reduce((sum, flow) => sum + flow.duplicateAcks, 0), resets: aggregation.flows.reduce((sum, flow) => sum + flow.resets, 0), handshakeFailures: aggregation.flows.filter(flow => flow.state === "Handshake failed").length, zeroWindows: aggregation.flows.reduce((sum, flow) => sum + flow.zeroWindows, 0), dominantFlowPercent: totalFlowBytes ? (aggregation.flows[0]?.bytes || 0) / totalFlowBytes * 100 : 0 };
}

function renderComparison(currentAggregation) {
  const content = $("#comparisonContent");
  if (!state.baseline) { content.className = "comparison-empty"; content.innerHTML = "Choose <strong>Compare baseline</strong> to measure this capture against a known-good trace."; $("#clearBaselineButton").hidden = true; return; }
  const current = analysisSummary(state.filtered, currentAggregation); const baseline = state.baseline.summary;
  const metrics = [["Packets", current.packets, baseline.packets, value => value.toLocaleString()], ["Traffic", current.bytes, baseline.bytes, formatBytes], ["Throughput", current.throughput, baseline.throughput, formatRate], ["Flows", current.flows, baseline.flows, value => value.toLocaleString()], ["p95 latency", current.latencyP95, baseline.latencyP95, formatLatency], ["Retransmissions", current.retransmissions, baseline.retransmissions, value => value.toLocaleString()]];
  content.className = "comparison-metrics";
  content.innerHTML = metrics.map(([label, value, oldValue, formatter]) => { const delta = Number.isFinite(value) && Number.isFinite(oldValue) && oldValue !== 0 ? (value - oldValue) / oldValue * 100 : NaN; return `<div class="comparison-metric"><span>${label}</span><strong>${formatter(value)}</strong><small class="${delta > 0 ? "delta-up" : "delta-down"}">${Number.isFinite(delta) ? `${delta > 0 ? "+" : ""}${delta.toFixed(1)}%` : "—"} vs ${formatter(oldValue)}</small></div>`; }).join("");
  $("#clearBaselineButton").hidden = false;
}

function renderFlowExplorer(flows) {
  const select = $("#flowSelect");
  if (!flows.some(flow => flow.key === state.activeFlowKey)) state.activeFlowKey = flows[0]?.key || "";
  const optionLimit = 75;
  const visibleFlows = flows.slice(0, optionLimit);
  const activeFlow = flows.find(flow => flow.key === state.activeFlowKey);
  if (activeFlow && !visibleFlows.some(flow => flow.key === activeFlow.key)) visibleFlows.unshift(activeFlow);
  const limitedNote = flows.length > visibleFlows.length ? `<option disabled>${(flows.length - visibleFlows.length).toLocaleString()} more flows in table/export</option>` : "";
  select.innerHTML = visibleFlows.map(flow => `<option value="${escapeHtml(flow.key)}" ${flow.key === state.activeFlowKey ? "selected" : ""}>${escapeHtml(flow.protocol)} · ${escapeHtml(flow.a)} ↔ ${escapeHtml(flow.b)}</option>`).join("") + limitedNote || `<option>No flows</option>`;
  const flow = flows.find(item => item.key === state.activeFlowKey);
  $("#flowHealth").innerHTML = flow ? [["Duration", `${flow.duration.toFixed(3)}s`], ["Throughput", formatRate(flow.throughput)], ["A → B", `${flow.packetsA} / ${formatBytes(flow.bytesA)}`], ["B → A", `${flow.packetsB} / ${formatBytes(flow.bytesB)}`], ["Retrans / dup ACK", `${flow.retransmissions} / ${flow.duplicateAcks}`], ["Max UDP gap", flow.transport === "UDP" ? `${(flow.maxGap * 1000).toFixed(1)} ms` : "n/a"]].map(item => `<div class="health-metric"><span>${item[0]}</span><strong>${item[1]}</strong></div>`).join("") : "";
  drawFlowTimeline(flow);
}

function renderExpert(packets, aggregation) {
  const samples = aggregation.latencySamples;
  $("#latencyP50").textContent = formatLatency(percentile(samples, .5));
  $("#latencyP95").textContent = formatLatency(percentile(samples, .95));
  $("#latencyP99").textContent = formatLatency(percentile(samples, .99));
  $("#latencyJitter").textContent = formatLatency(standardDeviation(samples));
  drawFrameSizeChart(packets); drawLatencyChart(aggregation); drawTopology(aggregation.flows); renderFlowExplorer(aggregation.flows);
  const diagnostics = [["TCP flows", aggregation.flows.filter(flow => flow.transport === "TCP").length, "bidirectional streams"], ["Retransmissions", aggregation.flows.reduce((sum, flow) => sum + flow.retransmissions, 0), "repeated payload sequence"], ["Duplicate ACKs", aggregation.flows.reduce((sum, flow) => sum + flow.duplicateAcks, 0), "repeated ACK values"], ["Zero windows", aggregation.flows.reduce((sum, flow) => sum + flow.zeroWindows, 0), "receiver stalls"], ["UDP / QUIC flows", aggregation.flows.filter(flow => flow.transport === "UDP").length, "datagram conversations"], ["Handshake failures", aggregation.flows.filter(flow => flow.state === "Handshake failed").length, "SYN without SYN-ACK"]];
  $("#transportDiagnostics").innerHTML = diagnostics.map(item => `<div class="diagnostic"><span>${item[0]}</span><strong>${item[1]}</strong><small>${item[2]}</small></div>`).join("");
  const services = analyzeServices(packets);
  $("#serviceRows").innerHTML = services.map(service => `<tr><td><span class="badge">${escapeHtml(service.name)}</span></td><td>${service.requests}</td><td>${service.errors}</td><td>${formatLatency(median(service.latencies))}</td><td>${escapeHtml([...service.details].slice(0, 3).join(", ") || `${service.packets} packets`)}</td></tr>`).join("") || `<tr><td colspan="5">No application services decoded</td></tr>`;
  const findings = buildFindings(packets, aggregation, services);
  $("#findingCount").textContent = `${findings.length} observations`;
  $("#findingList").innerHTML = findings.map(finding => `<div class="finding"><span class="severity ${finding.severity}">${finding.severity}</span><div><strong>${escapeHtml(finding.title)}</strong><small>${escapeHtml(finding.detail)}</small></div>${finding.packet ? `<a data-packet-ref="${finding.packet}">Frame ${finding.packet}</a>` : ""}</div>`).join("");
  renderComparison(aggregation);
}

function exportAnalysisJson() {
  const aggregation = aggregate(state.filtered); const services = analyzeServices(state.filtered);
  const processAttribution = typeof processMapState !== "undefined" ? { source: processMapState.source, observations: processMapState.observations.length, matchedPackets: processMapState.matchedPackets, processes: [...new Map(state.filtered.filter(packet => packet.processCorrelation).map(packet => [`${packet.processCorrelation.pid}|${packet.processCorrelation.process}`, { pid: packet.processCorrelation.pid, process: packet.processCorrelation.process, executable: packet.processCorrelation.executable, user: packet.processCorrelation.user, confidence: packet.processCorrelation.confidence }])).values()] } : null;
  const payload = { schema: "datasnare-ainetscope/analysis-v1", generatedAt: new Date().toISOString(), profile: getActiveAnalysisProfile(), processAttribution, capture: { name: state.fileName, ...analysisSummary(state.filtered, aggregation) }, flows: aggregation.flows.map(({ packetData, ...flow }) => flow), services: services.map(service => ({ ...service, details: [...service.details] })), findings: buildFindings(state.filtered, aggregation, services) };
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" })); link.download = `${state.fileName || "capture"}-analysis.json`; link.click(); URL.revokeObjectURL(link.href);
}

if (typeof document !== "undefined") {
$("#flowSelect").addEventListener("change", event => { state.activeFlowKey = event.target.value; renderFlowExplorer(aggregate(state.filtered).flows); });
$("#frameSizeCanvas").addEventListener("mousemove", event => { const point = frameSizePointAt(event); $("#frameSizeCanvas").style.cursor = point ? "pointer" : "default"; if (point) showFrameSizeTooltip(event, point); });
$("#frameSizeCanvas").addEventListener("mouseleave", () => { $("#frameSizeTooltip").hidden = true; $("#frameSizeCanvas").style.cursor = "default"; });
$("#frameSizeCanvas").addEventListener("click", event => { const point = frameSizePointAt(event); if (point) inspectPacket(point.maxPacket.number); });
$("#latencyCanvas").addEventListener("mousemove", event => { const point = latencyPointAt(event); $("#latencyCanvas").style.cursor = point ? "pointer" : "default"; if (point) showLatencyTooltip(event, point); else $("#latencyTooltip").hidden = true; });
$("#latencyCanvas").addEventListener("mouseleave", () => { $("#latencyTooltip").hidden = true; $("#latencyCanvas").style.cursor = "default"; });
$("#latencyCanvas").addEventListener("click", event => { const point = latencyPointAt(event); if (point) inspectPacket(point.packet); });
$("#topologyCanvas").addEventListener("mousemove", event => { const target = topologyPointAt(event); $("#topologyCanvas").style.cursor = target ? "pointer" : "default"; if (target) showTopologyTooltip(event, target); else $("#topologyTooltip").hidden = true; });
$("#topologyCanvas").addEventListener("mouseleave", () => { $("#topologyTooltip").hidden = true; $("#topologyCanvas").style.cursor = "default"; });
$("#flowCanvas").addEventListener("mousemove", event => { const packet = flowPacketAt(event); $("#flowCanvas").style.cursor = packet ? "pointer" : "default"; if (packet) showFlowTooltip(event, packet); else $("#flowTooltip").hidden = true; });
$("#flowCanvas").addEventListener("mouseleave", () => { $("#flowTooltip").hidden = true; $("#flowCanvas").style.cursor = "default"; });
$("#flowCanvas").addEventListener("click", event => { const packet = flowPacketAt(event); if (packet) inspectPacket(packet.number); });
$("#flowRows").addEventListener("click", event => { const row = event.target.closest("tr[data-flow]"); if (!row) return; state.activeFlowKey = decodeURIComponent(row.dataset.flow); renderFlowExplorer(aggregate(state.filtered).flows); $("#flowSelect").scrollIntoView({ behavior: "smooth", block: "center" }); });
$("#findingList").addEventListener("click", event => { const link = event.target.closest("[data-packet-ref]"); if (link) inspectPacket(Number(link.dataset.packetRef)); });
$("#jsonExportButton").addEventListener("click", exportAnalysisJson);
$("#baselineInput").addEventListener("change", async event => { const file = event.target.files[0]; if (!file) return; try { const packets = (await parseFile(file, false)).sort((a, b) => a.timestamp - b.timestamp); state.baseline = { name: file.name, summary: analysisSummary(packets) }; renderComparison(aggregate(state.filtered)); showToast(`Baseline ${file.name} loaded.`); } catch (error) { showToast(`Could not parse baseline: ${error.message}`); } });
$("#clearBaselineButton").addEventListener("click", () => { state.baseline = null; $("#baselineInput").value = ""; renderComparison(aggregate(state.filtered)); });
}

if (typeof window !== "undefined") window.DataSnareAINetScope = Object.freeze(Object.defineProperties({
  parseCapture,
  analyze(packets, profile = getActiveAnalysisProfile()) { const aggregation = aggregate(packets); const services = analyzeServices(packets); return { profile: normalizeAnalysisProfile(profile), summary: analysisSummary(packets, aggregation), flows: aggregation.flows, services, findings: buildFindings(packets, aggregation, services, normalizeAnalysisProfile(profile)) }; },
  schema: "datasnare-ainetscope/analysis-v1"
}, Object.getOwnPropertyDescriptors(window.DataSnareAINetScope || {})));
