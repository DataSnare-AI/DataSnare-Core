(function (root) {
  "use strict";

  function connection(packet) {
    return [`${packet.src}:${packet.srcPort}`, `${packet.dst}:${packet.dstPort}`].sort().join(" <-> ");
  }

  function signature(packet) {
    if (packet.transport !== "TCP" || !Number.isFinite(packet.seq) || !Number.isFinite(packet.ack)
      || !Number.isFinite(packet.timestamp) || !Number.isFinite(packet.payloadLength)) return null;
    return JSON.stringify([packet.src, packet.srcPort, packet.dst, packet.dstPort,
      packet.seq, packet.ack, packet.tcpFlagsValue, packet.payloadLength]);
  }

  function indexPackets(packets) {
    const index = new Map();
    for (const packet of packets) {
      const key = signature(packet);
      if (!key) continue;
      const group = index.get(key) || [];
      group.push(packet);
      index.set(key, group);
    }
    return index;
  }

  function correlate(packetsA, packetsB, options = {}) {
    const offsetMs = Number(options.offsetMs ?? 0);
    const toleranceMs = Number(options.toleranceMs ?? 1000);
    if (!Number.isFinite(offsetMs) || !Number.isFinite(toleranceMs) || toleranceMs < 0) {
      throw new Error("Offset must be finite and matching tolerance must be non-negative.");
    }
    const indexA = indexPackets(packetsA);
    const indexB = indexPackets(packetsB);
    const usedB = new Set();
    const records = [];
    const statusB = new Map();
    for (const packetA of packetsA) {
      const key = signature(packetA);
      const candidates = key ? indexB.get(key) || [] : [];
      const duplicate = candidates.length > 0 && ((indexA.get(key) || []).length > 1 || candidates.length > 1);
      const packetB = !duplicate && candidates.length === 1 ? candidates[0] : null;
      const deltaMs = packetB ? (packetB.timestamp - packetA.timestamp) * 1000 + offsetMs : null;
      const matched = packetB && Math.abs(deltaMs) <= toleranceMs;
      if (duplicate) candidates.forEach(candidate => statusB.set(candidate, "ambiguous"));
      if (matched) usedB.add(packetB);
      const direction = matched && options.hostA && options.hostB
        ? packetA.src === options.hostA && packetA.dst === options.hostB ? "A to B"
          : packetA.src === options.hostB && packetA.dst === options.hostA ? "B to A" : null
        : null;
      records.push({
        packetA, packetB: matched ? packetB : null,
        status: duplicate ? "ambiguous" : matched ? "matched" : "unmatched",
        reason: duplicate ? "Repeated TCP signature; retransmission or duplicate ACK cannot be distinguished"
          : packetB && !matched ? "Signature found outside the corrected-time tolerance"
            : matched ? "Unique TCP header signature (payload content not verified)" : "No counterpart TCP signature",
        deltaMs: matched ? deltaMs : null,
        transitMs: direction ? direction === "A to B" ? deltaMs : -deltaMs : null,
        direction,
        connection: packetA.transport === "TCP" ? connection(packetA) : "Other traffic",
        time: matched ? Math.min(packetA.timestamp, packetB.timestamp + offsetMs / 1000) : packetA.timestamp,
      });
    }
    for (const packetB of packetsB) {
      if (usedB.has(packetB)) continue;
      records.push({ packetA: null, packetB, status: statusB.get(packetB) || "unmatched",
        reason: statusB.has(packetB) ? "Repeated TCP signature; no unique counterpart" : "No counterpart within signature/time constraints",
        deltaMs: null, transitMs: null, direction: null,
        connection: packetB.transport === "TCP" ? connection(packetB) : "Other traffic",
        time: packetB.timestamp + offsetMs / 1000 });
    }
    records.sort((left, right) => left.time - right.time);
    return records;
  }

  const api = Object.freeze({ correlate, signature, connection });
  if (typeof module !== "undefined" && module.exports) module.exports = api;
  else root.DataSnareTwoSidedMatch = api;
})(typeof globalThis !== "undefined" ? globalThis : this);