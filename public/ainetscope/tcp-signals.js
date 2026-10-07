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
const TCP_RTT_SEGMENT_LIMIT = 50000;
const TCP_PERSIST_KEY_LIMIT = 128;
const TCP_WINDOW_SAMPLE_LIMIT = 50000;

function tcpSignalRangeCovers(intervals, start, end) {
  if (end <= start) return true;
  return intervals.some(([rangeStart, rangeEnd]) => rangeStart <= start && rangeEnd >= end);
}

function analyzeTcpSequence(packets) {
  const flows = new Map();
  const tcpPackets = packets.filter(packet => packet.transport === 'TCP' && Number.isInteger(packet.seq));
  const analyzedPackets = tcpPackets.slice(0, TCP_SEQUENCE_PACKET_LIMIT);
  let storedWindowSamples = 0;

  for (const packet of analyzedPackets) {
    const key = tcpSignalFlowKey(packet);
    if (!flows.has(key)) {
      const endpoints = [tcpSignalEndpoint(packet, true), tcpSignalEndpoint(packet, false)].sort();
      flows.set(key, { key, a: endpoints[0], b: endpoints[1], packets: 0, payloadSegments: 0,
        payloadBytes: 0, uniquePayloadBytes: 0, overlapBytes: 0, repeatedSegments: 0,
        exactRepeatedSegments: 0, partialOverlapSegments: 0, acknowledgedRepeatSegments: 0,
        forwardGapSegments: 0, forwardGapBytes: 0, largestForwardGap: 0,
        lateNovelSegments: 0, lateNovelBytes: 0, ackRttSamples: [], ambiguousAckAdvances: 0,
        retransmittedRttSegments: 0, zeroWindowEpisodes: [], zeroWindowCount: 0, zeroWindowPackets: 0,
        windowSamples: 0, windowOccupancySampleCount: 0, windowOccupancySamples: [], zeroWindowDurationMs: 0,
        longestZeroWindowMs: 0, openZeroWindows: 0, persistProbeCandidates: [], directions: new Map() });
    }
    const flow = flows.get(key);
    flow.packets++;
    const source = tcpSignalEndpoint(packet, true);
    const destination = tcpSignalEndpoint(packet, false);
    if (!flow.directions.has(source)) flow.directions.set(source, {
      anchor: packet.seq >>> 0, intervals: [], highWater: null, acknowledgedThrough: null, exactRanges: new Map(), anchoredBySyn: false,
      lastAcked: null, outstanding: [], rttTrackingStopped: false, windowScale: null, windowScaleOfferKnown: false,
      zeroWindow: null, smallPayloadBySequence: new Map(), lastAdvertisedWindow: null, lastAck: null, packetCount: 0
    });
    const sender = flow.directions.get(source);
    const receiver = flow.directions.get(destination);
    sender.packetCount++;
    const sequence = tcpSignalUnwrap(packet.seq >>> 0, sender.anchor);
    const syn = tcpSignalFlag(packet, 'SYN', 0x02);
    const fin = tcpSignalFlag(packet, 'FIN', 0x01);
    const ack = tcpSignalFlag(packet, 'ACK', 0x10);
    if (syn) {
      sender.anchoredBySyn = true;
      if (sender.lastAcked === null) sender.lastAcked = sequence + 1;
      if (packet.tcpOptions?.complete) {
        sender.windowScaleOfferKnown = true;
        sender.windowScale = Number.isInteger(packet.tcpOptions.windowScale) ? packet.tcpOptions.windowScale : null;
      }
    }
    const payloadLength = Math.max(0, Number(packet.payloadLength) || 0);
    const payloadStart = sequence + (syn ? 1 : 0);

    if (ack && receiver && Number.isInteger(packet.ack)) {
      const acknowledged = tcpSignalUnwrap(packet.ack >>> 0, receiver.anchor);
      const previousAcknowledged = receiver.acknowledgedThrough;
      receiver.acknowledgedThrough = receiver.acknowledgedThrough === null
        ? acknowledged : Math.max(receiver.acknowledgedThrough, acknowledged);
      if (previousAcknowledged === null || acknowledged >= previousAcknowledged) {
        receiver.lastAck = { packet: packet.number, timestamp: packet.timestamp };
      }
      if (receiver.lastAcked === null) receiver.lastAcked = acknowledged;
      else if (acknowledged > receiver.lastAcked) {
        const newlyAcknowledged = receiver.outstanding.filter(segment => segment.end > receiver.lastAcked && segment.end <= acknowledged);
        if (newlyAcknowledged.length === 1 && !newlyAcknowledged[0].retransmitted && !receiver.rttTrackingStopped) {
          const sample = newlyAcknowledged[0];
          const value = (packet.timestamp - sample.timestamp) * 1000;
          if (Number.isFinite(value) && value >= 0 && value < 60000) {
            flow.ackRttSamples.push({ value, packet: packet.number, requestPacket: sample.packet, timestamp: packet.timestamp, direction: source });
          }
        } else if (newlyAcknowledged.length > 1) flow.ambiguousAckAdvances++;
        receiver.outstanding = receiver.outstanding.filter(segment => segment.end > acknowledged);
        receiver.lastAcked = acknowledged;
      }
    }

    if (Number.isFinite(packet.tcpWindow) && !syn && !tcpSignalFlag(packet, 'RST', 0x04)) {
      flow.windowSamples++;
      const priorWindow = sender.lastAdvertisedWindow;
      sender.lastAdvertisedWindow = { rawWindow: packet.tcpWindow, packet: packet.number, timestamp: packet.timestamp,
        change: priorWindow === null ? 'initial' : packet.tcpWindow < priorWindow.rawWindow ? 'decreased'
          : packet.tcpWindow > priorWindow.rawWindow ? 'increased' : 'unchanged' };
      if (packet.tcpWindow === 0) {
        flow.zeroWindowPackets++;
        if (!sender.zeroWindow) {
          sender.zeroWindow = { start: packet.timestamp, startPacket: packet.number, updates: 1 };
          flow.zeroWindowCount++;
        } else sender.zeroWindow.updates++;
      } else if (sender.zeroWindow) {
        const durationMs = Math.max(0, (packet.timestamp - sender.zeroWindow.start) * 1000);
        flow.zeroWindowEpisodes.push({ direction: source, startPacket: sender.zeroWindow.startPacket,
          endPacket: packet.number, durationMs, updates: sender.zeroWindow.updates, open: false });
        flow.zeroWindowDurationMs += durationMs;
        flow.longestZeroWindowMs = Math.max(flow.longestZeroWindowMs, durationMs);
        sender.zeroWindow = null;
      }
    }

    if (tcpSignalFlag(packet, 'RST', 0x04) && sender.zeroWindow) {
      const durationMs = Math.max(0, (packet.timestamp - sender.zeroWindow.start) * 1000);
      flow.zeroWindowEpisodes.push({ direction: source, startPacket: sender.zeroWindow.startPacket,
        endPacket: packet.number, durationMs, updates: sender.zeroWindow.updates, open: false, endedByReset: true });
      flow.zeroWindowDurationMs += durationMs;
      flow.longestZeroWindowMs = Math.max(flow.longestZeroWindowMs, durationMs);
      sender.zeroWindow = null;
    }

    if (payloadLengthCandidate(packet) && receiver?.zeroWindow && Number.isInteger(packet.seq)) {
      const probeKey = packet.seq >>> 0;
      const previousProbe = sender.smallPayloadBySequence.get(probeKey);
      if (previousProbe?.zeroWindowPacket === receiver.zeroWindow.startPacket) {
        flow.persistProbeCandidates.push({ direction: source, packet: packet.number, previousPacket: previousProbe.packet,
          zeroWindowPacket: receiver.zeroWindow.startPacket,
          zeroWindowDurationMs: Math.max(0, (packet.timestamp - receiver.zeroWindow.start) * 1000),
          intervalMs: Math.max(0, (packet.timestamp - previousProbe.timestamp) * 1000),
          ackUnchanged: Number.isInteger(packet.ack) && Number.isInteger(previousProbe.ack) ? packet.ack === previousProbe.ack : null,
          windowScaleNegotiated: sender.windowScaleOfferKnown && receiver.windowScaleOfferKnown
            ? Number.isInteger(sender.windowScale) && Number.isInteger(receiver.windowScale) : null, seq: probeKey });
      }
      if (sender.smallPayloadBySequence.size < TCP_PERSIST_KEY_LIMIT || previousProbe) {
        sender.smallPayloadBySequence.set(probeKey, { packet: packet.number, timestamp: packet.timestamp,
          ack: Number.isInteger(packet.ack) ? packet.ack >>> 0 : null, zeroWindowPacket: receiver.zeroWindow.startPacket });
      }
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
        for (const sample of sender.outstanding) {
          if (payloadStart < sample.end && payloadEnd > sample.start && !sample.retransmitted) {
            sample.retransmitted = true;
            flow.retransmittedRttSegments++;
          }
        }
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
      if (overlapBytes === 0 && !sender.rttTrackingStopped) {
        if (sender.outstanding.length < TCP_RTT_SEGMENT_LIMIT) sender.outstanding.push({ start: payloadStart, end: payloadEnd, timestamp: packet.timestamp, packet: packet.number, retransmitted: false });
        else sender.rttTrackingStopped = true;
      }
    }
    if (payloadLength > 0 && receiver?.lastAdvertisedWindow && sender.anchoredBySyn && receiver.anchoredBySyn
        && sender.windowScaleOfferKnown && receiver.windowScaleOfferKnown
        && sender.acknowledgedThrough >= 1 && sender.acknowledgedThrough <= sender.highWater
        && !sender.rangeTrackingStopped && Number.isFinite(sender.highWater)) {
      const bytesInFlight = sender.highWater - sender.acknowledgedThrough;
      const contiguous = tcpSignalRangeCovers(sender.intervals, sender.acknowledgedThrough, sender.highWater);
      const scalingNegotiated = Number.isInteger(sender.windowScale) && Number.isInteger(receiver.windowScale);
      const scale = scalingNegotiated ? receiver.windowScale : 0;
      const effectiveWindowBytes = receiver.lastAdvertisedWindow.rawWindow * (2 ** scale);
      if (contiguous && effectiveWindowBytes > 0) {
        flow.windowOccupancySampleCount++;
        if (storedWindowSamples < TCP_WINDOW_SAMPLE_LIMIT) {
          flow.windowOccupancySamples.push({ packet: packet.number, windowPacket: receiver.lastAdvertisedWindow.packet,
            direction: source, bytesInFlight, effectiveWindowBytes,
            occupancyPct: bytesInFlight / effectiveWindowBytes * 100, scale, scalingNegotiated,
            windowAgeMs: Number.isFinite(packet.timestamp) && Number.isFinite(receiver.lastAdvertisedWindow.timestamp)
              && packet.timestamp >= receiver.lastAdvertisedWindow.timestamp
              ? (packet.timestamp - receiver.lastAdvertisedWindow.timestamp) * 1000 : null,
            ackAgeMs: Number.isFinite(packet.timestamp) && Number.isFinite(sender.lastAck?.timestamp)
              && packet.timestamp >= sender.lastAck.timestamp ? (packet.timestamp - sender.lastAck.timestamp) * 1000 : null,
            windowChange: receiver.lastAdvertisedWindow.change,
            senderPacketsObserved: sender.packetCount, peerPacketsObserved: receiver.packetCount });
          storedWindowSamples++;
        }
      }
    }
    if (syn || fin) {
      const controlEnd = sequence + (syn ? 1 : 0) + (fin ? 1 : 0);
      sender.highWater = sender.highWater === null ? controlEnd : Math.max(sender.highWater, controlEnd);
    }
  }

  const summaries = [...flows.values()].map(flow => {
    const directions = [...flow.directions.values()];
    const openEpisodes = directions.filter(direction => direction.zeroWindow).map(direction => ({ direction: [...flow.directions.entries()].find(([, value]) => value === direction)?.[0] || "",
      startPacket: direction.zeroWindow.startPacket, endPacket: null, durationMs: null, updates: direction.zeroWindow.updates, open: true }));
    const zeroWindowEpisodes = [...flow.zeroWindowEpisodes, ...openEpisodes];
    const { directions: _directions, ...summary } = flow;
    return { ...summary, handshakeAnchoredDirections: directions.filter(direction => direction.anchoredBySyn).length,
      midstreamDirections: directions.filter(direction => !direction.anchoredBySyn).length,
      rangeTrackingStoppedDirections: directions.filter(direction => direction.rangeTrackingStopped).length,
      rttTrackingStoppedDirections: directions.filter(direction => direction.rttTrackingStopped).length,
      zeroWindowEpisodes, openZeroWindows: openEpisodes.length };
  });
  const rangeTrackingStoppedFlows = summaries.filter(flow => flow.rangeTrackingStoppedDirections > 0).length;
  const rttTrackingStoppedFlows = summaries.filter(flow => flow.rttTrackingStoppedDirections > 0).length;
  const rttSamples = summaries.flatMap(flow => flow.ackRttSamples.map(sample => ({ ...sample, flow: flow.key })));
  const windowOccupancySamples = summaries.flatMap(flow => flow.windowOccupancySamples.map(sample => ({ ...sample, flow: flow.key })));
  const windowOccupancySampleCount = summaries.reduce((total, flow) => total + flow.windowOccupancySampleCount, 0);
  return {
    flows: summaries,
    rttSamples,
    windowOccupancySamples,
    windowOccupancySamplesTruncated: windowOccupancySampleCount > windowOccupancySamples.length,
    rttTrackingStoppedFlows,
    analyzedPackets: analyzedPackets.length,
    totalTcpPackets: tcpPackets.length,
    rangeTrackingStoppedFlows,
    truncated: tcpPackets.length > TCP_SEQUENCE_PACKET_LIMIT || rangeTrackingStoppedFlows > 0,
    totals: summaries.reduce((total, flow) => {
      for (const key of ['packets', 'payloadSegments', 'payloadBytes', 'uniquePayloadBytes', 'overlapBytes',
        'repeatedSegments', 'exactRepeatedSegments', 'partialOverlapSegments', 'acknowledgedRepeatSegments',
        'forwardGapSegments', 'forwardGapBytes', 'lateNovelSegments', 'lateNovelBytes', 'handshakeAnchoredDirections', 'midstreamDirections',
        'ambiguousAckAdvances', 'retransmittedRttSegments', 'zeroWindowCount', 'zeroWindowPackets', 'windowSamples',
        'windowOccupancySampleCount', 'zeroWindowDurationMs', 'openZeroWindows']) total[key] += flow[key];
      total.largestForwardGap = Math.max(total.largestForwardGap, flow.largestForwardGap);
      total.longestZeroWindowMs = Math.max(total.longestZeroWindowMs, flow.longestZeroWindowMs);
      total.persistProbeCandidates += flow.persistProbeCandidates.length;
      return total;
    }, { packets: 0, payloadSegments: 0, payloadBytes: 0, uniquePayloadBytes: 0, overlapBytes: 0,
      repeatedSegments: 0, exactRepeatedSegments: 0, partialOverlapSegments: 0, acknowledgedRepeatSegments: 0,
      forwardGapSegments: 0, forwardGapBytes: 0, largestForwardGap: 0, lateNovelSegments: 0, lateNovelBytes: 0,
      handshakeAnchoredDirections: 0, midstreamDirections: 0, ambiguousAckAdvances: 0, retransmittedRttSegments: 0,
      zeroWindowCount: 0, zeroWindowPackets: 0, windowSamples: 0, zeroWindowDurationMs: 0,
      windowOccupancySampleCount: 0, longestZeroWindowMs: 0, openZeroWindows: 0, persistProbeCandidates: 0 })
  };
}

function payloadLengthCandidate(packet) {
  return packet.transport === 'TCP' && Number(packet.payloadLength) === 1;
}

if (typeof module !== 'undefined' && module.exports) module.exports = { tcpSignalClass, analyzeTcpSequence };