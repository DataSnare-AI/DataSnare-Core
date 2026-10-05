"use strict";

importScripts("app.js", "expert.js");

function analysisRuleEnabled(profile, name) {
  return Number(profile?.thresholds?.[name]) > 0;
}

function protocolIsFocused(profile, protocol) {
  return (profile?.focusProtocols || []).includes(String(protocol).toUpperCase());
}

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

function summarizeSetFileInWorker(packets, item, index, profile) {
  packets.sort((a, b) => a.timestamp - b.timestamp);
  const aggregation = aggregate(packets);
  const services = analyzeServices(packets);
  const findings = buildFindings(packets, aggregation, services, profile);
  const protocols = packets.reduce((result, packet) => { result[packet.protocol] = (result[packet.protocol] || 0) + packet.length; return result; }, {});
  const hostTraffic = packets.reduce((result, packet) => {
    result[packet.src] = (result[packet.src] || 0) + packet.length;
    result[packet.dst] = (result[packet.dst] || 0) + packet.length;
    return result;
  }, {});
  return {
    index, name: item.name, path: item.path || item.name, source: null, demoPackets: null, status: "Analyzed",
    start: packets[0]?.timestamp || 0, end: packets.at(-1)?.timestamp || 0,
    summary: analysisSummary(packets, aggregation), protocols,
    hostTraffic: Object.entries(hostTraffic).sort((left, right) => right[1] - left[1]).map(([host, bytes]) => ({ host, bytes })),
    edges: summarizeFileEdges(aggregation), protocolNames: Object.keys(protocols), services: services.map(service => service.name),
    serviceStats: services.map(service => ({ name: service.name, errors: service.errors, latency: median(service.latencies) })),
    findings: findings.filter(finding => finding.severity !== "info"), rankedObservations: findings.filter(finding => finding.severity !== "info").length,
    highFindings: 0, mediumFindings: 0
  };
}

self.onmessage = event => {
  const { packets, item, index, profile } = event.data;
  try {
    self.postMessage({ type: "started", name: item.name });
    const result = summarizeSetFileInWorker(packets, item, index, profile);
    self.postMessage({ type: "complete", result });
  } catch (error) {
    self.postMessage({ type: "error", name: item?.name, message: error.message || "Background capture analysis failed." });
  }
};
