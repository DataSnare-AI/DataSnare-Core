(function (root) {
  "use strict";

  function flag(packet, name, mask) {
    return (packet.flags || []).includes(name) || Boolean((packet.tcpFlagsValue || 0) & mask);
  }

  function stats(values) {
    const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
    if (!sorted.length) return { count: 0, mean: null, p50: null, p95: null, p99: null, jitter: null, min: null, max: null, negative: 0 };
    const mean = sorted.reduce((sum, value) => sum + value, 0) / sorted.length;
    const percentile = fraction => {
      const position = (sorted.length - 1) * fraction;
      const lower = Math.floor(position);
      return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
    };
    return { count: sorted.length, mean, p50: percentile(.5), p95: percentile(.95), p99: percentile(.99),
      jitter: Math.sqrt(sorted.reduce((sum, value) => sum + (value - mean) ** 2, 0) / sorted.length),
      min: sorted[0], max: sorted.at(-1), negative: sorted.filter(value => value < 0).length };
  }

  function endpoint(packet, source = true) {
    return JSON.stringify([source ? packet.src : packet.dst, source ? packet.srcPort : packet.dstPort]);
  }

  function flowKey(packet) {
    return [endpoint(packet), endpoint(packet, false)].sort().join('|');
  }

  function flightEstimates(packets) {
    const flows = new Map();
    const samples = [];
    let zeroWindows = 0;
    let windowSamples = 0;
    const scales = new Set();
    const windows = [];
    for (const packet of [...packets].filter(packet => packet.transport === 'TCP').sort((left, right) => left.timestamp - right.timestamp || left.number - right.number)) {
      const key = flowKey(packet);
      let flow = flows.get(key);
      if (!flow) { flow = new Map(); flows.set(key, flow); }
      const from = endpoint(packet);
      const to = endpoint(packet, false);
      if (flag(packet, 'SYN', 2) && !flag(packet, 'ACK', 16)) flow.clear();
      let sender = flow.get(from);
      if (!sender) { sender = { base: null, high: 0, acknowledged: 0, scale: null, handshake: false }; flow.set(from, sender); }
      if (flag(packet, 'SYN', 2)) {
        sender.base = Number.isFinite(packet.seq) ? packet.seq : null;
        sender.high = 0; sender.acknowledged = 0; sender.handshake = true;
        sender.scale = packet.tcpOptions?.complete && Number.isInteger(packet.tcpOptions.windowScale) ? packet.tcpOptions.windowScale : null;
      }
      const receiver = flow.get(to);
      if (flag(packet, 'ACK', 16) && receiver?.base !== null && receiver?.base !== undefined && Number.isFinite(packet.ack)) {
        const ackOffset = (packet.ack - receiver.base) >>> 0;
        if (ackOffset < 0x80000000) receiver.acknowledged = Math.max(receiver.acknowledged, ackOffset);
      }
      if (Number.isFinite(packet.tcpWindow)) {
        windowSamples++;
        if (packet.tcpWindow === 0 && !flag(packet, 'RST', 4) && !flag(packet, 'SYN', 2)) zeroWindows++;
        const shift = !flag(packet, 'SYN', 2) && sender.scale !== null && receiver?.scale !== null && receiver?.scale !== undefined ? sender.scale : 0;
        scales.add(shift ? 'scaled' : 'raw');
        windows.push(packet.tcpWindow * 2 ** shift);
      }
      if (sender.handshake && sender.base !== null && Number.isFinite(packet.seq)) {
        const offset = (packet.seq - sender.base) >>> 0;
        const consumed = Math.max(0, packet.payloadLength || 0) + (flag(packet, 'SYN', 2) ? 1 : 0) + (flag(packet, 'FIN', 1) ? 1 : 0);
        if (offset < 0x80000000 && consumed) {
          sender.high = Math.max(sender.high, offset + consumed);
          samples.push({ bytes: Math.max(0, sender.high - sender.acknowledged), frame: packet.number });
        }
      }
      if (flag(packet, 'RST', 4)) flow.clear();
    }
    return { zeroWindows, windowSamples, flight: stats(samples.map(sample => sample.bytes)),
      advertisedWindow: stats(windows),
      peakFrame: samples.sort((left, right) => right.bytes - left.bytes)[0]?.frame ?? null,
      windowBasis: [...scales].join(' / ') || 'unavailable' };
  }

  function summarize(records, packetsA, packetsB, offsetMs, hosts = {}) {
    const matched = records.filter(record => record.status === 'matched');
    const directions = ['A to B', 'B to A'].map(direction => ({ direction,
      ...stats(matched.filter(record => record.direction === direction).map(record => record.transitMs)) }));
    const unknown = stats(matched.filter(record => !record.direction).map(record => record.deltaMs));
    const sets = { A: new Map(), B: new Map() };
    for (const record of records) {
      if (record.packetA) sets.A.set(record.packetA.number, record.packetA);
      if (record.packetB) sets.B.set(record.packetB.number, record.packetB);
    }
    const ranges = [packetsA, packetsB].map((packets, index) => {
      const times = packets.map(packet => packet.timestamp + (index ? offsetMs / 1000 : 0)).filter(Number.isFinite);
      return times.reduce((range, time) => ({ min: Math.min(range.min, time), max: Math.max(range.max, time) }), { min: Infinity, max: -Infinity });
    });
    const overlapStart = Math.max(ranges[0].min, ranges[1].min);
    const overlapEnd = Math.min(ranges[0].max, ranges[1].max);
    const overlap = Number.isFinite(overlapStart) && Number.isFinite(overlapEnd) && overlapEnd >= overlapStart;
    const onlyA = records.filter(record => record.status === 'unmatched' && record.packetA && !record.packetB);
    const onlyB = records.filter(record => record.status === 'unmatched' && record.packetB && !record.packetA);
    const inside = (record, side) => overlap && record[`packet${side}`].timestamp + (side === 'B' ? offsetMs / 1000 : 0) >= overlapStart
      && record[`packet${side}`].timestamp + (side === 'B' ? offsetMs / 1000 : 0) <= overlapEnd;
    const optionDifferences = [];
    for (const [index, record] of records.entries()) {
      if (record.status !== 'matched') continue;
      if (!flag(record.packetA, 'SYN', 2)) continue;
      const optionsA = record.packetA.tcpOptions;
      const optionsB = record.packetB.tcpOptions;
      if (!optionsA?.complete || !optionsB?.complete) continue;
      const changes = ['mss', 'windowScale', 'sackPermitted', 'timestamps'].filter(key => optionsA[key] !== optionsB[key]);
      if (changes.length) optionDifferences.push({ index, record, changes });
    }
    const handshakes = side => [...sets[side].values()].filter(packet => flag(packet, 'SYN', 2)).map(packet => ({ frame: packet.number, options: packet.tcpOptions }));
    return { total: records.length, matched: matched.length, directions, unknown,
      ambiguous: records.filter(record => record.status === 'ambiguous').length,
      loss: { overlap, overlapMs: overlap ? (overlapEnd - overlapStart) * 1000 : null,
        onlyA: onlyA.length, onlyB: onlyB.length,
        withinA: onlyA.filter(record => inside(record, 'A')).length,
        withinB: onlyB.filter(record => inside(record, 'B')).length,
        senderOnlyAtoB: hosts.hostA && hosts.hostB ? onlyA.filter(record => inside(record, 'A') && record.packetA.src === hosts.hostA && record.packetA.dst === hosts.hostB).length : null,
        senderOnlyBtoA: hosts.hostA && hosts.hostB ? onlyB.filter(record => inside(record, 'B') && record.packetB.src === hosts.hostB && record.packetB.dst === hosts.hostA).length : null },
      middlebox: { handshakesA: handshakes('A'), handshakesB: handshakes('B'), optionDifferences },
      flowA: flightEstimates([...sets.A.values()]), flowB: flightEstimates([...sets.B.values()]) };
  }

  const api = Object.freeze({ stats, summarize, flightEstimates });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DataSnareTwoSidedAnalytics = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);