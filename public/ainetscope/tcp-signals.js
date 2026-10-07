"use strict";

function tcpSignalClass(packet) {
  const flags = Array.isArray(packet.flags) ? packet.flags : [];
  const value = Number(packet.tcpFlagsValue) || 0;
  const has = (name, mask) => flags.includes(name) || Boolean(value & mask);
  if (has('RST', 4)) return 'rst';
  if (has('SYN', 2)) return has('ACK', 16) ? 'syn-ack' : 'syn';
  if (has('FIN', 1)) return has('ACK', 16) ? 'fin-ack' : 'fin';
  return 'other';
}

function tcpSignalFlag(packet, name, mask) {
  return (packet.flags || []).includes(name) || Boolean((packet.tcpFlagsValue || 0) & mask);
}

function tcpSignalEndpoint(packet, source) {
  return `${source ? packet.src : packet.dst}:${source ? packet.srcPort : packet.dstPort}`;
}

function tcpSignalFlowKey(packet) {
  return [tcpSignalEndpoint(packet, true), tcpSignalEndpoint(packet, false)].sort().join('|');
}

function tcpSignalUnwrap(sequence, anchor) {
  const modulus = 0x100000000;
  const delta = ((sequence - anchor + 0x80000000) % modulus + modulus) % modulus - 0x80000000;
  return delta;
}

const TCP_SEQUENCE_INTERVAL_LIMIT = 2048;

function tcpSignalInsertRange(intervals, start, end) {
  let overlap = 0;
  let index = 0;
  while (index < intervals.length && intervals[index][1] < start) index++;
  let mergeStart = start;
  let mergeEnd = end;
  let mergeIndex = index;
  while (mergeIndex < intervals.length && intervals[mergeIndex][0] <= end) {
    const interval = intervals[mergeIndex];
    overlap += Math.max(0, Math.min(end, interval[1]) - Math.max(start, interval[0]));
    mergeStart = Math.min(mergeStart, interval[0]);
    mergeEnd = Math.max(mergeEnd, interval[1]);
    mergeIndex++;
  }
  if (mergeIndex === index && intervals.length >= TCP_SEQUENCE_INTERVAL_LIMIT) return null;
  intervals.splice(index, mergeIndex - index, [mergeStart, mergeEnd]);
  return overlap;
}

const TCP_SEQUENCE_PACKET_LIMIT = 200000;

function analyzeTcpSequence(packets) {
  const flows = new Map();
  const tcpPackets = packets.filter(packet => packet.transport === 'TCP' && Number.isInteger(packet.seq));
  const analyzedPackets = tcpPackets.slice(0, TCP_SEQUENCE_PACKET_LIMIT);

  for (const packet of analyzedPackets) {
    const key = tcpSignalFlowKey(packet);
    if (!flows.has(key)) {
      const endpoints = [tcpSignalEndpoint(packet, true), tcpSignalEndpoint(packet, false)].sort();
      flows.set(key, { key, a: endpoints[0], b: endpoints[1], packets: 0, payloadSegments: 0,
        payloadBytes: 0, uniquePayloadBytes: 0, overlapBytes: 0, repeatedSegments: 0,
        exactRepeatedSegments: 0, partialOverlapSegments: 0, acknowledgedRepeatSegments: 0,
        forwardGapSegments: 0, forwardGapBytes: 0, largestForwardGap: 0,
        lateNovelSegments: 0, lateNovelBytes: 0, directions: new Map() });
    }
    const flow = flows.get(key);
    flow.packets++;
    const source = tcpSignalEndpoint(packet, true);
    const destination = tcpSignalEndpoint(packet, false);
    if (!flow.directions.has(source)) flow.directions.set(source, {
      anchor: packet.seq >>> 0, intervals: [], highWater: null, acknowledgedThrough: null, exactRanges: new Map(), anchoredBySyn: false
    });
    const sender = flow.directions.get(source);
    const receiver = flow.directions.get(destination);
    const sequence = tcpSignalUnwrap(packet.seq >>> 0, sender.anchor);
    const syn = tcpSignalFlag(packet, 'SYN', 0x02);
    const fin = tcpSignalFlag(packet, 'FIN', 0x01);
    const ack = tcpSignalFlag(packet, 'ACK', 0x10);
    if (syn) sender.anchoredBySyn = true;
    const payloadLength = Math.max(0, Number(packet.payloadLength) || 0);
    const payloadStart = sequence + (syn ? 1 : 0);

    if (ack && receiver && Number.isInteger(packet.ack)) {
      const acknowledged = tcpSignalUnwrap(packet.ack >>> 0, receiver.anchor);
      receiver.acknowledgedThrough = receiver.acknowledgedThrough === null
        ? acknowledged : Math.max(receiver.acknowledgedThrough, acknowledged);
    }

    if (payloadLength > 0) {
      const payloadEnd = payloadStart + payloadLength;
      const rangeKey = `${payloadStart}:${payloadEnd}`;
      const exactRepeat = sender.exactRanges.has(rangeKey);
      const previousHighWater = sender.highWater;
      const overlapBytes = sender.rangeTrackingStopped ? null : tcpSignalInsertRange(sender.intervals, payloadStart, payloadEnd);
      if (overlapBytes === null) sender.rangeTrackingStopped = true;
      const novelBytes = overlapBytes === null ? 0 : payloadLength - overlapBytes;
      flow.payloadSegments++;
      flow.payloadBytes += payloadLength;
      flow.uniquePayloadBytes += novelBytes;
      if (overlapBytes !== null) flow.overlapBytes += overlapBytes;
      if (overlapBytes > 0) {
        flow.repeatedSegments++;
        if (exactRepeat) flow.exactRepeatedSegments++;
        else flow.partialOverlapSegments++;
        if (sender.acknowledgedThrough !== null && payloadEnd <= sender.acknowledgedThrough) flow.acknowledgedRepeatSegments++;
      }
      if (novelBytes > 0 && previousHighWater !== null && payloadStart < previousHighWater) {
        flow.lateNovelSegments++;
        flow.lateNovelBytes += novelBytes;
      }
      if (previousHighWater !== null && payloadStart > previousHighWater) {
        const gap = payloadStart - previousHighWater;
        flow.forwardGapSegments++;
        flow.forwardGapBytes += gap;
        flow.largestForwardGap = Math.max(flow.largestForwardGap, gap);
      }
      sender.highWater = previousHighWater === null ? payloadEnd : Math.max(previousHighWater, payloadEnd);
      if (overlapBytes !== null) sender.exactRanges.set(rangeKey, (sender.exactRanges.get(rangeKey) || 0) + 1);
    }
    if (syn || fin) {
      const controlEnd = sequence + (syn ? 1 : 0) + (fin ? 1 : 0);
      sender.highWater = sender.highWater === null ? controlEnd : Math.max(sender.highWater, controlEnd);
    }
  }

  const summaries = [...flows.values()].map(flow => {
    const directions = [...flow.directions.values()];
    const { directions: _directions, ...summary } = flow;
    return { ...summary, handshakeAnchoredDirections: directions.filter(direction => direction.anchoredBySyn).length,
      midstreamDirections: directions.filter(direction => !direction.anchoredBySyn).length,
      rangeTrackingStoppedDirections: directions.filter(direction => direction.rangeTrackingStopped).length };
  });
  const rangeTrackingStoppedFlows = summaries.filter(flow => flow.rangeTrackingStoppedDirections > 0).length;
  return {
    flows: summaries,
    analyzedPackets: analyzedPackets.length,
    totalTcpPackets: tcpPackets.length,
    rangeTrackingStoppedFlows,
    truncated: tcpPackets.length > TCP_SEQUENCE_PACKET_LIMIT || rangeTrackingStoppedFlows > 0,
    totals: summaries.reduce((total, flow) => {
      for (const key of ['packets', 'payloadSegments', 'payloadBytes', 'uniquePayloadBytes', 'overlapBytes',
        'repeatedSegments', 'exactRepeatedSegments', 'partialOverlapSegments', 'acknowledgedRepeatSegments',
        'forwardGapSegments', 'forwardGapBytes', 'lateNovelSegments', 'lateNovelBytes', 'handshakeAnchoredDirections', 'midstreamDirections']) total[key] += flow[key];
      total.largestForwardGap = Math.max(total.largestForwardGap, flow.largestForwardGap);
      return total;
    }, { packets: 0, payloadSegments: 0, payloadBytes: 0, uniquePayloadBytes: 0, overlapBytes: 0,
      repeatedSegments: 0, exactRepeatedSegments: 0, partialOverlapSegments: 0, acknowledgedRepeatSegments: 0,
      forwardGapSegments: 0, forwardGapBytes: 0, largestForwardGap: 0, lateNovelSegments: 0, lateNovelBytes: 0,
      handshakeAnchoredDirections: 0, midstreamDirections: 0 })
  };
}

if (typeof module !== 'undefined' && module.exports) module.exports = { tcpSignalClass, analyzeTcpSequence };