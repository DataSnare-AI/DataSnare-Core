"use strict";

(function (root) {
  const DEFAULT_STREAM_ROWS = 500;
  const MAX_STREAM_ROWS = 5000;

  function streamKey(packet) {
    const transport = packet?.transport || (["TCP", "UDP"].includes(packet?.protocol) ? packet.protocol : "");
    if (!transport || !["TCP", "UDP"].includes(transport)
      || !Number.isFinite(Number(packet.srcPort)) || !Number.isFinite(Number(packet.dstPort))) return "";
    const endpoints = [`${packet.src}:${packet.srcPort}`, `${packet.dst}:${packet.dstPort}`].sort();
    return `${transport}|${endpoints[0]}|${endpoints[1]}`;
  }

  function tcpFlag(packet, name, mask) {
    return (packet.flags || []).includes(name) || Boolean((packet.tcpFlagsValue || 0) & mask);
  }

  function applicationLabel(packet) {
    const protocol = String(packet.protocol || packet.transport || "Packet");
    const info = String(packet.info || "");
    return protocol === "HTTP" && packet.httpMethod ? `HTTP ${packet.httpMethod}`
      : protocol === "TDS" && packet.tdsType ? `TDS ${packet.tdsType}`
        : protocol === "DNS" ? `DNS ${packet.dnsResponse ? "Response" : "Query"}`
          : protocol.startsWith("SMB") && packet.smbCommand ? `SMB ${packet.smbCommand}`
            : protocol === "DCE/RPC" ? `DCE/RPC ${info.split(" ")[0] || "Packet"}`
              : protocol === "HTTP/2" ? `HTTP/2 ${packet.http2FrameType || "Frame"}` : "";
  }

  function analyzeStreamRows(packets, selectedNumber, maxRows = DEFAULT_STREAM_ROWS) {
    const limit = Math.max(100, Math.min(MAX_STREAM_ROWS, Math.floor(maxRows) || DEFAULT_STREAM_ROWS));
    const selectedIndex = packets.findIndex(packet => packet.number === selectedNumber);
    const start = packets.length <= limit ? 0 : Math.max(0, Math.min(selectedIndex - Math.floor(limit / 2), packets.length - limit));
    const end = Math.min(packets.length, start + limit);
    const endpointA = packets.length ? [`${packets[0].src}:${packets[0].srcPort}`, `${packets[0].dst}:${packets[0].dstPort}`].sort()[0] : "";
    const seenSequences = new Set();
    const state = { syn: false, synAck: false, fin: false, ackAfterSynAck: false };
    const rows = [];

    for (let index = 0; index < packets.length; index++) {
      const packet = packets[index];
      const flags = Array.isArray(packet.flags) ? packet.flags : [];
      const protocol = String(packet.protocol || packet.transport || "Packet");
      const label = flags.length ? `[${flags.join(", ")}]` : protocol;
      const source = `${packet.src}:${packet.srcPort}`;
      const direction = source === endpointA ? "A → B" : "B → A";
      const app = applicationLabel(packet);
      const transport = packet.transport || protocol;
      let expert;

      if (transport !== "TCP") {
        expert = app || (flags.length ? flags.join(", ") : "UDP datagram");
      } else {
        const rst = tcpFlag(packet, "RST", 0x04);
        const syn = tcpFlag(packet, "SYN", 0x02);
        const ack = tcpFlag(packet, "ACK", 0x10);
        const fin = tcpFlag(packet, "FIN", 0x01);
        const psh = tcpFlag(packet, "PSH", 0x08);
        const firstFin = fin && !state.fin;
        const secondFin = fin && state.fin;
        const sequenceKey = `${source}:${packet.seq}`;
        const retransmission = Number(packet.payloadLength) > 0 && Number.isInteger(packet.seq) && seenSequences.has(sequenceKey);

        if (rst) expert = `${app ? `[${app}] ` : ""}Reset connection - state is CLOSED`;
        else if (syn && !ack) expert = "Step 1/3 in 3-way connection - state is SYN-SENT";
        else if (syn && ack) expert = "Step 2/3 in 3-way connection - state is SYN-RECEIVED";
        else if (firstFin) expert = "Step 1/3 in 3-way disconnect - state is FIN-WAIT-1";
        else if (secondFin) expert = "Step 2/3 in 3-way disconnect - state is FIN-WAIT-2";
        else if (ack && state.synAck && !state.ackAfterSynAck) expert = "Step 3/3 in 3-way connection - state is ESTABLISHED";
        else if (ack && state.fin) expert = "Step 3/3 in 3-way disconnect - state is TIME-WAIT";
        else if (retransmission) expert = `Retransmission - same sequence number as an earlier frame (${packet.seq})`;
        else if (psh) expert = `${app ? `[${app}] ` : ""}Application data pushed to the receiver`;
        else if (state.syn && state.synAck) expert = `${app ? `[${app}] ` : ""}State is ESTABLISHED`;
        else expert = `${app ? `[${app}] ` : ""}${flags.length ? flags.join(", ") : "TCP segment"}`;

        if (Number(packet.payloadLength) > 0 && Number.isInteger(packet.seq)) seenSequences.add(sequenceKey);
        if (syn && !ack) state.syn = true;
        if (syn && ack) state.synAck = true;
        if (fin) state.fin = true;
        if (ack && state.synAck) state.ackAfterSynAck = true;
      }

      if (index >= start && index < end) rows.push({ packet, direction, label, expert, selected: packet.number === selectedNumber });
    }

    return { rows, total: packets.length, start, end, omitted: packets.length - rows.length };
  }

  const api = Object.freeze({ DEFAULT_STREAM_ROWS, MAX_STREAM_ROWS, streamKey, analyzeStreamRows });
  root.DataSnareStreamInspector = api;
  if (typeof module !== "undefined" && module.exports) module.exports = api;
})(typeof globalThis !== "undefined" ? globalThis : this);
