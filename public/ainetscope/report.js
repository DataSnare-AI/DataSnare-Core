"use strict";

const reportCommon = typeof module !== "undefined" && module.exports
  ? require("./report-common.js") : globalThis.DataSnareReportCommon;

function reportEscape(value) {
  if (value && typeof value === "object" && typeof value.summary === "string") value = value.summary;
  return reportCommon.escapeReportHtml(value);
}

function reportNumber(value, digits = 0) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: digits }) : "—";
}

function reportPercentile(values, fraction) {
  const sorted = values.filter(Number.isFinite).sort((left, right) => left - right);
  if (!sorted.length) return null;
  const position = (sorted.length - 1) * fraction;
  const lower = Math.floor(position);
  return sorted[lower] + (sorted[Math.ceil(position)] - sorted[lower]) * (position - lower);
}

function reportLatency(value) {
  if (!Number.isFinite(value)) return "—";
  return value < 1 ? `${(value * 1000).toFixed(0)} µs` : `${value.toFixed(value < 10 ? 2 : 1)} ms`;
}

function largeTopologyFitsPdf(snapshot, maxWidth = 700) {
  return Boolean(snapshot && !snapshot.error && Number.isFinite(snapshot.width)
    && Number.isFinite(snapshot.viewportWidth) && Number.isFinite(snapshot.scrollWidth)
    && !snapshot.horizontalOverflow && snapshot.scrollWidth <= snapshot.viewportWidth + 1 && snapshot.width <= maxWidth);
}

function buildTriageChecks(packets, aggregation, services, profile, enabledGroups = null, sequenceAnalysis = null) {
  const checks = [];
  const add = (group, name, severity, state, evidence, limitation = "") => checks.push(reportCommon.normalizeReportCheck({ group, name, severity, state, evidence, limitation }));
  const has = protocol => packets.some(packet => packet.protocol === protocol);
  const tcpPackets = packets.filter(packet => packet.transport === "TCP");
  const udpPackets = packets.filter(packet => packet.transport === "UDP");
  const ipv4Packets = packets.filter(packet => Number.isFinite(packet.ipTtl));
  const icmpPackets = packets.filter(packet => packet.protocol === "ICMP" || packet.protocol === "ICMPv6");
  const flows = aggregation.flows;
  const tcpFlows = flows.filter(flow => flow.transport === "TCP");
  const udpFlows = flows.filter(flow => flow.transport === "UDP");
  const resetCount = tcpFlows.reduce((sum, flow) => sum + flow.resets, 0);
  add("TCP", "Connection resets (RST)", "high", !tcpPackets.length ? "not-observed" : resetCount ? "issue" : "clear",
    tcpPackets.length ? `${reportNumber(resetCount)} reset packets across ${reportNumber(tcpFlows.filter(flow => flow.resets).length)} flows.` : "No TCP packets were decoded.",
    "RST may be an intentional close or refusal; inspect the endpoints and timing before assigning cause.");

  const failedHandshakes = tcpFlows.filter(flow => flow.state === "Handshake failed").length;
  add("TCP", "Incomplete SYN handshakes", "high", !tcpPackets.length ? "not-observed" : failedHandshakes ? "issue" : "clear",
    tcpPackets.length ? `${reportNumber(failedHandshakes)} flows contain a SYN without an observed SYN-ACK.` : "No TCP packets were decoded.",
    "Capture boundaries, asymmetric capture points, and packet loss can hide the SYN-ACK.");

  const zeroWindows = tcpFlows.reduce((sum, flow) => sum + flow.zeroWindows, 0);
  add("TCP", "Receiver zero-window advertisements", "high", !tcpPackets.length ? "not-observed" : zeroWindows ? "issue" : "clear",
    tcpPackets.length ? `${reportNumber(zeroWindows)} zero-window packets.` : "No TCP packets were decoded.",
    "A zero window indicates advertised receiver backpressure, not by itself the responsible process or host resource.");
  const windowSamples = packets.filter(packet => packet.transport === "TCP" && Number.isFinite(packet.tcpWindow)
    && !(packet.flags || []).includes("SYN") && !(packet.flags || []).includes("RST"));
  const zeroWindowEpisodes = (sequenceAnalysis?.flows || []).flatMap(flow => flow.zeroWindowEpisodes || []);
  const closedZeroWindows = zeroWindowEpisodes.filter(episode => !episode.open && Number.isFinite(episode.durationMs));
  const openZeroWindows = zeroWindowEpisodes.filter(episode => episode.open);
  const zeroWindowDurations = closedZeroWindows.map(episode => episode.durationMs);
    add("TCP", "Zero-window episode duration", "medium", !tcpPackets.length ? "not-observed"
      : !windowSamples.length ? "not-assessed" : zeroWindowEpisodes.length ? "observed" : "clear",
      !tcpPackets.length ? "No TCP packets were decoded." : !windowSamples.length ? "TCP packets are present, but window samples are unavailable."
        : `${reportNumber(zeroWindowEpisodes.length)} zero-window episode(s) from ${reportNumber(sequenceAnalysis?.totals?.zeroWindowPackets || 0)} advertisements; ${reportNumber(closedZeroWindows.length)} closed, ${reportNumber(openZeroWindows.length)} still open at capture end${zeroWindowDurations.length ? `; closed duration median ${reportLatency(reportPercentile(zeroWindowDurations, .5))}, max ${reportLatency(zeroWindowDurations.reduce((maximum, value) => Math.max(maximum, value), 0))}` : ""}.${sequenceAnalysis?.truncated ? " Analysis reached a configured bound; episode totals may be partial." : ""}`,
      "Duration ends at a later non-zero window update or observed RST; an open episode has no measured end. Capture start/end may truncate either side of an episode.");
  const persistProbes = (sequenceAnalysis?.flows || []).flatMap(flow => flow.persistProbeCandidates || []);
  const persistProbeContext = persistProbes.slice(0, 5).map(item => {
    const ack = item.ackUnchanged === null ? "ACK unknown" : item.ackUnchanged ? "ACK unchanged" : "ACK advanced";
    const scaling = item.windowScaleNegotiated === null ? "window scaling unknown" : item.windowScaleNegotiated ? "window scaling negotiated" : "window scaling not negotiated";
    return `${item.previousPacket}→${item.packet} (${reportLatency(item.intervalMs)}; ${ack}; ${scaling})`;
  });
  add("TCP", "Possible persist-probe candidates", "low", !tcpPackets.length ? "not-observed"
    : !windowSamples.length ? "not-assessed" : !zeroWindowEpisodes.length ? "clear" : persistProbes.length ? "review" : "clear",
    !tcpPackets.length ? "No TCP packets were decoded." : !windowSamples.length ? "TCP window samples are unavailable."
      : `${reportNumber(persistProbes.length)} repeated one-byte payload candidate(s) observed toward a peer during a zero-window episode${persistProbeContext.length ? `; frame pairs and context: ${persistProbeContext.join(", ")}` : ""}.`,
    "This is a conservative signature, not proof of RFC persist behavior; a legitimate one-byte application payload can look similar. Repeats are scoped to the same observed zero-window episode. Timing, ACK stability, and captured scaling negotiation are context only; receiver application state is unavailable.");

  const sequenceTotals = sequenceAnalysis?.totals;
  const repeatedSegments = sequenceTotals?.repeatedSegments ?? tcpFlows.reduce((sum, flow) => sum + flow.retransmissions, 0);
  const acknowledgedRepeats = sequenceTotals?.acknowledgedRepeatSegments ?? 0;
  const sequenceSamplesAvailable = sequenceAnalysis && sequenceAnalysis.totalTcpPackets > 0;
  const sequenceScope = sequenceAnalysis?.truncated ? [
    sequenceAnalysis.totalTcpPackets > sequenceAnalysis.analyzedPackets
      ? ` Packet analysis was capped at ${reportNumber(sequenceAnalysis.analyzedPackets)} of ${reportNumber(sequenceAnalysis.totalTcpPackets)} TCP packets.` : "",
    sequenceAnalysis.rangeTrackingStoppedFlows
      ? ` Detailed range tracking stopped at its per-direction interval limit in ${reportNumber(sequenceAnalysis.rangeTrackingStoppedFlows)} flow(s); overlap/unique-byte counts are partial.` : ""
  ].filter(Boolean).join("") : "";
  add("TCP", "Possible retransmissions / repeated payload", "medium", !tcpPackets.length ? "not-observed" : !sequenceSamplesAvailable ? "not-assessed" : repeatedSegments ? "review" : "clear",
    tcpPackets.length ? (sequenceSamplesAvailable
      ? `${reportNumber(repeatedSegments)} payload segments overlapped previously observed sequence space (${reportNumber(sequenceTotals.overlapBytes)} overlapping bytes); ${reportNumber(sequenceTotals.exactRepeatedSegments)} exact repeats, ${reportNumber(acknowledgedRepeats)} repeated segments after cumulative ACK. Sequence origins: ${reportNumber(sequenceTotals.handshakeAnchoredDirections)} direction(s) observed from SYN, ${reportNumber(sequenceTotals.midstreamDirections)} midstream-relative.${sequenceScope}`
      : "TCP packets are present, but no usable sequence-number samples were available.") : "No TCP packets were decoded.",
    "Overlap may be retransmission, capture duplication, or offload artifact. A repeat after cumulative ACK is stronger evidence, but still not a definitive diagnosis.");

  const duplicateAcks = tcpFlows.reduce((sum, flow) => sum + flow.duplicateAcks, 0);
  add("TCP", "Possible duplicate ACK pattern", "medium", !tcpPackets.length ? "not-observed" : duplicateAcks ? "review" : "clear",
    tcpPackets.length ? `${reportNumber(duplicateAcks)} repeated ACK values on empty TCP segments.` : "No TCP packets were decoded.",
    "AINetScope does not yet check ACK progression, SACK blocks, or Wireshark's duplicate-ACK sequence rules.");

  const forwardGaps = sequenceTotals?.forwardGapSegments || 0;
  const lateNovel = sequenceTotals?.lateNovelSegments || 0;
  const latencyLimit = Number(profile?.thresholds?.latencyP95Ms);
  add("TCP", "Sequence gaps / late novel payload", "medium", !tcpPackets.length ? "not-observed" : !sequenceSamplesAvailable ? "not-assessed" : forwardGaps || lateNovel ? "review" : "clear",
    tcpPackets.length && sequenceSamplesAvailable
      ? `${reportNumber(forwardGaps)} segments began beyond the observed sequence high-water (${reportNumber(sequenceTotals.forwardGapBytes)} gap bytes); ${reportNumber(lateNovel)} later segments added novel bytes below that high-water (${reportNumber(sequenceTotals.lateNovelBytes)} bytes). Sequence origins: ${reportNumber(sequenceTotals.handshakeAnchoredDirections)} direction(s) observed from SYN, ${reportNumber(sequenceTotals.midstreamDirections)} midstream-relative.${sequenceScope}`
      : tcpPackets.length ? "Sequence-range analysis was unavailable." : "No TCP packets were decoded.",
    "A forward gap may reflect omitted traffic, capture boundaries, or reordering. Later novel bytes below a previous high-water are consistent with out-of-order arrival, but cannot alone prove it.");
  const windowOccupancySamples = sequenceAnalysis?.windowOccupancySamples || [];
  const windowOccupancyValues = windowOccupancySamples.map(sample => sample.occupancyPct);
  const maxWindowOccupancy = windowOccupancyValues.reduce((maximum, value) => Math.max(maximum, value), 0);
  const totalWindowOccupancySamples = sequenceAnalysis?.totals?.windowOccupancySampleCount || 0;
  const windowOccupancyContext = windowOccupancySamples.slice(0, 5).map(sample => {
    const age = value => Number.isFinite(value) ? `${reportNumber(value, 1)} ms` : "unknown";
    return `${sample.windowPacket}→${sample.packet} (window age ${age(sample.windowAgeMs)}, ACK age ${age(sample.ackAgeMs)}, ${sample.windowChange} window, observed packets ${sample.senderPacketsObserved}/${sample.peerPacketsObserved})`;
  });
  add("TCP", "Observed receive-window occupancy", "medium", !tcpPackets.length ? "not-observed" : !windowOccupancyValues.length ? "not-assessed" : "observed",
    !tcpPackets.length ? "No TCP packets were decoded." : !windowOccupancyValues.length
      ? "No occupancy samples met the complete-handshake, ACK-baseline, and contiguous-sequence requirements."
      : `${reportNumber(totalWindowOccupancySamples)} eligible sample(s), ${reportNumber(windowOccupancyValues.length)} retained; retained-sample median ${reportNumber(reportPercentile(windowOccupancyValues, .5), 1)}%, max ${reportNumber(maxWindowOccupancy, 1)}% of the peer's effective advertised window. Sample context: ${windowOccupancyContext.join(", ")}.${sequenceAnalysis?.windowOccupancySamplesTruncated ? " Detailed samples reached the 50,000-sample storage bound; retained-sample statistics may not represent later eligible samples." : ""}`,
    "Occupancy is estimated from observed sequence high-water minus cumulative ACK and the peer's latest advertised window. ACK/window age and direction packet counts provide context only; packet-count imbalance cannot establish capture asymmetry. Capture omissions, window shrink, and endpoint behavior can affect this estimate; it is not proof of application blocking or a network fault.");
  const tcpAckRttSamples = sequenceAnalysis?.rttSamples || [];
  const tcpAckRttValues = tcpAckRttSamples.map(sample => sample.value);
  const tcpAckRttP95 = tcpAckRttValues.length ? reportPercentile(tcpAckRttValues, .95) : null;
  const tcpRttScope = sequenceAnalysis?.rttTrackingStoppedFlows
    ? ` RTT tracking reached its per-direction segment cap in ${reportNumber(sequenceAnalysis.rttTrackingStoppedFlows)} flow(s); sample counts may be partial.` : "";
  add("TCP", "ACK-to-data RTT samples", "medium", !tcpPackets.length ? "not-observed" : !tcpAckRttValues.length ? "not-assessed"
    : Number.isFinite(latencyLimit) && tcpAckRttP95 > latencyLimit ? "review" : "clear",
    !tcpPackets.length ? "No TCP packets were decoded." : !tcpAckRttValues.length
      ? "No unambiguous data segment was newly covered by a cumulative ACK; midstream context, cumulative ACKs spanning multiple segments, and retransmitted data are excluded."
      : `p95 ${reportLatency(tcpAckRttP95)} from ${reportNumber(tcpAckRttValues.length)} unambiguous ACK-to-data samples${Number.isFinite(latencyLimit) ? `; profile screening threshold ${reportLatency(latencyLimit)}` : ""}. ${reportNumber(sequenceTotals?.ambiguousAckAdvances || 0)} cumulative ACK advance(s) covering multiple segments excluded; ${reportNumber(sequenceTotals?.retransmittedRttSegments || 0)} overlapping/retransmitted segment(s) excluded.${tcpAckRttSamples.length ? ` Sample frames: ${tcpAckRttSamples.slice(0, 5).map(sample => `${sample.requestPacket}→${sample.packet}`).join(", ")}.` : ""}${tcpRttScope}`,
    "Samples are conservative capture-time estimates for newly acknowledged data, not application response time. Delayed ACKs, capture placement, offload, missing packets, and retransmissions can affect them; no general TCP loss percentage is inferred.");

  const tcpLatency = aggregation.latencyEvents.filter(event => event.type === "TCP").map(event => event.value);
  const tcpP95 = tcpLatency.length ? reportPercentile(tcpLatency, .95) : null;
  add("TCP", "TCP handshake p95 latency", "medium", !tcpLatency.length ? "not-assessed" : Number.isFinite(latencyLimit) && tcpP95 > latencyLimit ? "review" : "clear",
    tcpLatency.length ? `p95 ${reportLatency(tcpP95)} from ${reportNumber(tcpLatency.length)} observed handshakes${Number.isFinite(latencyLimit) ? `; profile review threshold ${reportLatency(latencyLimit)}` : ""}.` : "No complete TCP handshakes were available for timing.",
    "A high handshake RTT is a path/setup indicator; it does not isolate which network hop or endpoint caused delay.");

  const fragmentCount = ipv4Packets.filter(packet => packet.ipv4Fragmented).length;
  add("IP", "IPv4 fragmentation", "medium", !ipv4Packets.length ? "not-assessed" : fragmentCount ? "review" : "clear",
    ipv4Packets.length ? `${reportNumber(fragmentCount)} fragmented IPv4 packets among ${reportNumber(ipv4Packets.length)} decoded IPv4 packets.` : "No decoded IPv4 packets.",
    "Fragmentation may be expected; review size, path MTU, and ICMP feedback. IPv6 extension/fragment headers are not yet classified here.");
  add("IP", "TTL / hop-count anomalies", "low", "not-assessed", "TTL values are decoded, but AINetScope does not infer expected hop counts or compare routes.", "Use a known baseline or routing context; a TTL value alone is not an anomaly.");

  const unreachable = icmpPackets.filter(packet => packet.protocol === "ICMP" ? packet.icmpType === 3 : packet.icmpType === 1);
  add("ICMP", "Destination unreachable errors", "high", !icmpPackets.length ? "not-observed" : unreachable.length ? "issue" : "clear",
    icmpPackets.length ? `${reportNumber(unreachable.length)} unreachable messages among ${reportNumber(icmpPackets.length)} decoded ICMP packets${unreachable.length ? ` (types/codes ${[...new Set(unreachable.map(packet => `${packet.icmpType}/${packet.icmpCode}`))].join(", ")})` : ""}.` : "No ICMP or ICMPv6 packets were decoded.",
    "ICMP can be filtered or absent at the capture point; absence does not prove reachability.");
  const fragmentationNeeded = icmpPackets.filter(packet => packet.protocol === "ICMP" && packet.icmpType === 3 && packet.icmpCode === 4 || packet.protocol === "ICMPv6" && packet.icmpPacketTooBig);
  add("ICMP", "Path-MTU feedback (fragmentation needed)", "high", !icmpPackets.length ? "not-observed" : fragmentationNeeded.length ? "issue" : "clear",
    icmpPackets.length ? `${reportNumber(fragmentationNeeded.length)} path-MTU feedback messages${fragmentationNeeded.length ? ` (${[...new Set(fragmentationNeeded.map(packet => packet.protocol === "ICMPv6" ? "ICMPv6 type 2" : "ICMPv4 type 3/code 4"))].join(", ")})` : ""}.` : "No ICMP packets were decoded.",
    "Only visible ICMPv4 type 3/code 4 and ICMPv6 type 2 messages are counted; ICMP may be filtered at the capture point.");

  add("UDP", "UDP / QUIC datagrams", "info", udpPackets.length ? "observed" : "not-observed",
    udpPackets.length ? `${reportNumber(udpPackets.length)} UDP-carried packets in ${reportNumber(udpFlows.length)} flows; QUIC/HTTP3 packets are included.` : "No UDP packets were decoded.",
    "UDP has no transport-level ACK or retransmission signal; interpret loss only with protocol sequence/timing context.");
  const longUdpGaps = udpFlows.filter(flow => flow.maxGap > 1).sort((left, right) => right.maxGap - left.maxGap);
  add("UDP", "Same-direction UDP gaps over 1 second", "low", !udpPackets.length ? "not-observed" : longUdpGaps.length ? "review" : "clear",
    udpPackets.length ? (longUdpGaps.length ? `${reportNumber(longUdpGaps.length)} flows exceed the 1-second screening threshold; longest ${reportNumber(longUdpGaps[0].maxGap, 3)} s.` : "No same-direction UDP gap exceeded the 1-second screening threshold.") : "No UDP packets were decoded.",
    "This is a broad screening threshold, not a protocol-aware jitter or packet-loss test; expected send cadence varies by application.");
  add("UDP", "UDP loss / jitter", "medium", "not-assessed", "Not generally measurable from arbitrary UDP packets.", "Needs protocol sequence numbers, expected cadence, or application-specific request/response semantics.");

  const dnsPackets = packets.filter(packet => packet.protocol === "DNS");
  const dnsAnalysis = aggregation.dnsAnalysis;
  const dnsErrors = dnsPackets.filter(packet => packet.dnsResponse && packet.dnsRcode > 0);
  add("DNS", "DNS response errors (non-zero RCODE)", "high", !dnsPackets.length ? "not-observed" : dnsErrors.length ? "issue" : "clear",
    dnsPackets.length ? `${reportNumber(dnsErrors.length)} error responses among ${reportNumber(dnsPackets.filter(packet => packet.dnsResponse).length)} decoded responses${dnsErrors.length ? `; RCODEs ${[...new Set(dnsErrors.map(packet => packet.dnsRcode))].join(", ")}` : ""}.` : "No decoded DNS messages.",
    "Only DNS packets that the local decoder recognizes are included.");
  const truncatedDnsResponses = dnsPackets.filter(packet => packet.dnsResponse && packet.dnsTruncated);
  add("DNS", "Truncated DNS responses (TC bit)", "low", !dnsPackets.length ? "not-observed"
    : truncatedDnsResponses.length ? "review" : dnsPackets.some(packet => packet.dnsResponse) ? "clear" : "not-assessed",
    dnsPackets.length ? `${reportNumber(truncatedDnsResponses.length)} decoded DNS responses set TC (truncation detected by resolver).` : "No decoded DNS messages.",
    "A truncated UDP response often prompts TCP retry, but this capture check does not verify that retry completed.");
  const unansweredDns = dnsAnalysis?.unmatchedQueries ?? 0;
  add("DNS", "Queries without a matched response", "medium", !dnsPackets.length ? "not-observed"
    : dnsAnalysis?.truncated ? "not-assessed" : unansweredDns ? "review" : dnsAnalysis?.queries ? "clear" : "not-assessed",
    dnsPackets.length ? `${reportNumber(unansweredDns)} unmatched queries among ${reportNumber(dnsAnalysis?.queries || 0)} decoded queries; ${reportNumber(dnsAnalysis?.matched || 0)} matched responses.${dnsAnalysis?.truncated ? " Transaction table reached its processing limit; counts are partial." : ""}` : "No decoded DNS messages.",
    "Capture start/end boundaries, loss, retransmitted queries, encrypted DNS, or missing-question responses can leave transactions unmatched; this is not proof of resolver failure.");
  const dnsRetries = dnsAnalysis?.retransmissions ?? 0;
  add("DNS", "Possible retransmitted queries", "medium", !dnsPackets.length ? "not-observed"
    : dnsAnalysis?.truncated ? "not-assessed" : dnsRetries ? "review" : dnsAnalysis?.queries ? "clear" : "not-assessed",
    dnsPackets.length ? `${reportNumber(dnsRetries)} repeated queries with the same transaction ID, opcode, question signature, and client/server endpoints while a response was pending.` : "No decoded DNS messages.",
    "Repeated identical transactions are consistent with retries but can be deliberate duplicate requests; encrypted DNS is not inspected.");
  const unmatchedDnsResponses = dnsAnalysis?.unmatchedResponses ?? 0;
  add("DNS", "Responses without a matched query", "low", !dnsPackets.length ? "not-observed"
    : dnsAnalysis?.truncated ? "not-assessed" : unmatchedDnsResponses ? "review" : dnsAnalysis?.responses ? "clear" : "not-assessed",
    dnsPackets.length ? `${reportNumber(unmatchedDnsResponses)} unmatched responses among ${reportNumber(dnsAnalysis?.responses || 0)} decoded responses; ${reportNumber(dnsAnalysis?.unmatchedResponsesByMissingQuestion || 0)} were matched only by ID/opcode/endpoints because the response omitted a question.` : "No decoded DNS messages.",
    "Capture start/end boundaries, truncated captures, and response messages without question sections can prevent confident transaction matching.");
  const dnsLatency = aggregation.latencyEvents.filter(event => event.type === "DNS").map(event => event.value);
  const dnsP95 = dnsLatency.length ? reportPercentile(dnsLatency, .95) : null;
  add("DNS", "DNS response latency", "medium", !dnsPackets.length ? "not-observed" : !dnsLatency.length ? "not-assessed" : Number.isFinite(latencyLimit) && dnsP95 > latencyLimit ? "review" : "clear",
    dnsLatency.length ? `p95 ${reportLatency(dnsP95)} from ${reportNumber(dnsLatency.length)} matched responses.` : dnsPackets.length ? "DNS is present, but no query/response pairs could be timed." : "No decoded DNS messages.",
    "The profile's p95 threshold is a general screening threshold, not a DNS-specific service objective.");
  const dnsLatencyByTarget = new Map();
  for (const transaction of dnsAnalysis?.matchedTransactions || []) {
    if (!Number.isFinite(transaction.latencyMs)) continue;
    const key = `${transaction.question || "<unknown question>"}|${transaction.server || "<unknown server>"}`;
    if (!dnsLatencyByTarget.has(key)) dnsLatencyByTarget.set(key, { question: transaction.question || "<unknown question>", server: transaction.server || "<unknown server>", values: [], frames: [] });
    const target = dnsLatencyByTarget.get(key);
    target.values.push(transaction.latencyMs);
    if (target.frames.length < 5) target.frames.push(`${transaction.queryFrame}→${transaction.responseFrame}`);
  }
  const dnsTargets = [...dnsLatencyByTarget.values()].map(target => ({ ...target, p95: reportPercentile(target.values, .95) }))
    .sort((left, right) => right.p95 - left.p95);
  const omittedDnsDetails = dnsAnalysis?.omittedMatchedTransactions || 0;
  add("DNS", "DNS latency by question and server", "info", !dnsPackets.length ? "not-observed"
    : !dnsTargets.length ? "not-assessed" : omittedDnsDetails ? "not-assessed" : "observed",
    !dnsPackets.length ? "No decoded DNS messages." : !dnsTargets.length ? "No complete matched transactions with valid timing samples."
      : `${dnsTargets.slice(0, 5).map(target => `${target.question} via ${target.server}: p95 ${reportLatency(target.p95)} (${reportNumber(target.values.length)} sample(s), frames ${target.frames.join(", ")})`).join("; ")}${omittedDnsDetails ? `; ${reportNumber(omittedDnsDetails)} additional matched transaction details omitted from this bounded breakdown` : ""}.`,
    "Per-target details include matched, visible transactions only; capture boundaries, missing questions, encrypted DNS, and omitted detail samples limit coverage.");

  const httpPackets = packets.filter(packet => packet.protocol === "HTTP");
  const httpResponses = httpPackets.filter(packet => packet.httpKind === "response" && Number.isFinite(packet.httpStatus));
  const http4xx = httpResponses.filter(packet => packet.httpStatus >= 400 && packet.httpStatus < 500);
  const http5xx = httpResponses.filter(packet => packet.httpStatus >= 500);
  add("HTTP", "HTTP 5xx server responses", "high", !httpPackets.length ? "not-observed" : http5xx.length ? "issue" : "clear",
    httpPackets.length ? `${reportNumber(http5xx.length)} decoded HTTP/1.x 5xx responses among ${reportNumber(httpResponses.length)} responses.` : "No decoded HTTP/1.x packets.",
    "HTTP/2 and HTTP/3 status codes are not decoded by this check; encrypted payloads are not inspected.");
  add("HTTP", "HTTP 4xx client responses", "low", !httpPackets.length ? "not-observed" : http4xx.length ? "review" : "clear",
    httpPackets.length ? `${reportNumber(http4xx.length)} decoded HTTP/1.x 4xx responses among ${reportNumber(httpResponses.length)} responses.` : "No decoded HTTP/1.x packets.",
    "A 4xx may be expected application behavior; correlate the URI, client action, and service logs.");
  add("HTTP", "HTTP/2 and HTTP/3 response status", "medium", has("HTTP/2") || has("HTTP/3") ? "not-assessed" : "not-observed",
    has("HTTP/2") || has("HTTP/3") ? "HTTP/2 or HTTP/3 traffic was decoded, but response status is not extracted." : "No decoded HTTP/2 or HTTP/3 traffic.",
    "HTTP/2 status requires HPACK header decoding; HTTP/3 headers are encrypted in typical captures.");

  const tlsPackets = packets.filter(packet => packet.tlsVersion || packet.protocol === "TLS");
  const tlsFatalAlerts = tlsPackets.filter(packet => packet.tlsRecordType === 21 && packet.tlsAlertLevel === 2);
  add("TLS", "Visible fatal TLS alerts", "high", !tlsPackets.length ? "not-observed" : tlsFatalAlerts.length ? "issue" : "clear",
    tlsPackets.length ? `${reportNumber(tlsFatalAlerts.length)} visible fatal alert records among ${reportNumber(tlsPackets.filter(packet => packet.tlsRecordType === 21).length)} visible alert records${tlsFatalAlerts.length ? ` (${[...new Set(tlsFatalAlerts.map(packet => packet.tlsAlertDescription))].join(", ")})` : ""}.` : "No decoded TLS records.",
    "TLS 1.3 encrypts most post-handshake alerts; this only counts alert records visible to the decoder.");
  const legacyTls = tlsPackets.filter(packet => packet.tlsVersion === "TLS 1.0" || packet.tlsVersion === "TLS 1.1");
  add("TLS", "Legacy TLS 1.0 / 1.1 records", "medium", !tlsPackets.length ? "not-observed" : legacyTls.length ? "review" : "clear",
    tlsPackets.length ? `${reportNumber(legacyTls.length)} records carry TLS 1.0/1.1 record-layer versions.` : "No decoded TLS records.",
    "Record-layer versions do not always identify the negotiated TLS version; ClientHello legacy_version is not equivalent to a negotiated downgrade.");
  add("TLS", "Certificate validity / revocation / trust", "medium", tlsPackets.length ? "not-assessed" : "not-observed",
    tlsPackets.length ? "Certificate chain validity is not verified from this capture." : "No decoded TLS records.",
    "Requires certificate-chain parsing and trust-store, validity-date, and revocation checks; encrypted handshakes limit visibility.");
  add("TLS", "Handshake duration / repeated ClientHello", "low", tlsPackets.length ? "not-assessed" : "not-observed",
    tlsPackets.length ? "Handshake attempts are visible, but end-to-end handshake success and retry state are not correlated." : "No decoded TLS records.",
    "Requires per-flow handshake state and careful handling of session resumption and capture boundaries.");

  const smbPackets = packets.filter(packet => packet.protocol === "SMB2" || packet.protocol === "SMB");
  const smb2Packets = smbPackets.filter(packet => packet.protocol === "SMB2");
  const smbErrors = smb2Packets.filter(packet => packet.smbResponse && packet.smbStatus !== 0
    && !(packet.smbCommand === "SESSION_SETUP" && packet.smbStatus === 0xc0000016));
  add("SMB", "SMB2 non-success response status", "high", !smbPackets.length ? "not-observed" : !smb2Packets.length ? "not-assessed" : smbErrors.length ? "issue" : "clear",
    smb2Packets.length ? `${reportNumber(smbErrors.length)} unexpected non-zero SMB2 statuses among ${reportNumber(smb2Packets.filter(packet => packet.smbResponse).length)} decoded responses; normal SESSION_SETUP STATUS_MORE_PROCESSING_REQUIRED challenges are excluded.` : smbPackets.length ? "SMB1 traffic is present, but this status check supports SMB2 only." : "No decoded SMB traffic.",
    "Other non-zero NTSTATUS values can also be warnings or expected control flow; inspect command and status meaning.");
  const smbSetupErrors = smbErrors.filter(packet => packet.smbCommand === "SESSION_SETUP");
  add("SMB", "SMB2 session setup failures", "high", !smbPackets.length ? "not-observed" : !smb2Packets.length ? "not-assessed" : smbSetupErrors.length ? "issue" : "clear",
    smb2Packets.length ? `${reportNumber(smbSetupErrors.length)} failed SESSION_SETUP responses.` : smbPackets.length ? "SMB1 session status is not decoded." : "No decoded SMB traffic.",
    "A non-zero SESSION_SETUP status is a candidate authentication/session failure; correlate with server policy and client identity.");
  add("SMB", "SMB credit starvation", "medium", smb2Packets.length ? "not-assessed" : smbPackets.length ? "not-assessed" : "not-observed",
    smb2Packets.length ? "Not calculated from SMB2 credit grants and outstanding requests." : smbPackets.length ? "SMB2 credit state is unavailable." : "No decoded SMB traffic.",
    "Requires correlating CreditCharge, CreditRequest, CreditResponse, message IDs, and outstanding operations.");

  const tdsPackets = packets.filter(packet => packet.protocol === "TDS");
  const tdsErrors = tdsPackets.filter(packet => packet.tdsError);
  add("TDS / SQL", "Decoded TDS ERROR tokens", "high", !tdsPackets.length ? "not-observed" : tdsErrors.length ? "issue" : "clear",
    tdsPackets.length ? `${reportNumber(tdsErrors.length)} TDS response packets contain decoded ERROR tokens.` : "No decoded TDS traffic.",
    "Only visible, decoded TDS responses are counted; encrypted SQL/TLS and truncated responses limit inspection.");
  add("TDS / SQL", "SQL login failures", "high", !tdsPackets.length ? "not-observed" : "not-assessed",
    tdsPackets.length ? `${reportNumber(tdsPackets.filter(packet => packet.tdsLoginAck).length)} LOGINACK tokens observed; login request/error correlation is not implemented.` : "No decoded TDS traffic.",
    "A TDS ERROR token is not necessarily a login failure; correlate login7/prelogin exchanges and server error codes.");
  add("TDS / SQL", "Query / response latency and attention events", "medium", !tdsPackets.length ? "not-observed" : "not-assessed",
    tdsPackets.length ? "TDS messages are decoded, but requests, responses, and Attention events are not transaction-correlated." : "No decoded TDS traffic.",
    "Requires TDS packet reassembly and transaction/request correlation; encrypted TDS is not inspectable.");

  const lengthSamples = packets.filter(packet => Number.isSafeInteger(packet.capturedLength) && Number.isSafeInteger(packet.originalLength));
  const truncatedFrames = lengthSamples.filter(packet => packet.originalLength > packet.capturedLength);
  const omittedBytes = truncatedFrames.reduce((sum, packet) => sum + packet.originalLength - packet.capturedLength, 0);
  add("Capture quality", "Snaplen-truncated frames", "medium", !packets.length ? "not-observed" : lengthSamples.length !== packets.length ? "not-assessed" : truncatedFrames.length ? "review" : "clear",
    !packets.length ? "No packets in this analysis scope." : lengthSamples.length !== packets.length
      ? `${reportNumber(lengthSamples.length)} of ${reportNumber(packets.length)} packets include captured/original length metadata; truncation cannot be fully assessed.`
      : `${reportNumber(truncatedFrames.length)} of ${reportNumber(packets.length)} frames were shorter than their recorded original length (${reportNumber(omittedBytes)} omitted bytes).`,
    "This detects per-frame capture-length truncation only. It does not measure packets dropped by the capture interface, driver, or network path.");

  const quicPackets = packets.filter(packet => packet.protocol === "QUIC" || packet.protocol === "HTTP/3");
  const quicRetries = quicPackets.filter(packet => packet.quicPacketType === "Retry");
  add("QUIC", "QUIC Retry packets", "low", !quicPackets.length ? "not-observed" : quicRetries.length ? "observed" : "clear",
    quicPackets.length ? `${reportNumber(quicRetries.length)} Retry long-header packets among ${reportNumber(quicPackets.length)} decoded QUIC/HTTP3 packets.` : "No decoded QUIC/HTTP3 packets.",
    "Retry is a normal QUIC address-validation mechanism and is not by itself evidence of failure.");
  add("QUIC", "QUIC loss recovery / migration / handshake result", "medium", quicPackets.length ? "not-assessed" : "not-observed",
    quicPackets.length ? "Only visible header metadata is available; protected QUIC frame recovery and connection migration are not correlated." : "No decoded QUIC/HTTP3 packets.",
    "QUIC encrypts transport frames; packet capture alone may not expose loss recovery or handshake outcome.");

  const totalBytes = flows.reduce((sum, flow) => sum + flow.bytes, 0);
  const dominant = flows[0];
  add("Behavior", "Conversation dominance / chatty flow", "info", dominant ? "observed" : "not-observed",
    dominant ? `Top conversation carries ${Math.round(dominant.bytes / Math.max(totalBytes, 1) * 100)}% of observed bytes: ${dominant.a} ↔ ${dominant.b}.` : "No conversations were decoded.",
    "High traffic share is descriptive, not inherently a fault; compare with the expected workload and baseline.");
  add("Behavior", "Application transaction chattiness", "low", services.some(service => service.requests) ? "not-assessed" : "not-observed",
    services.some(service => service.requests) ? "Request counts are available for some decoded services; request/response payload efficiency is not analyzed." : "No decoded service requests.",
    "Requires application-specific transaction sizes, expected behavior, and usually decrypted/reassembled streams.");

  return checks.filter(check => !enabledGroups || enabledGroups[check.group] !== false);
}

function renderReportLegend(entries = []) {
  if (!entries.length) return "";
  const validKinds = new Set(["dot", "line", "square"]);
  return `<ul class="chart-legend">${entries.map(entry => {
    const color = /^#[\da-f]{6}$/i.test(entry.color || "") ? entry.color : "#52645b";
    const kind = validKinds.has(entry.kind) ? entry.kind : "dot";
    return `<li><i class="legend-swatch legend-swatch--${kind}" style="--swatch-color:${color}"></i><span>${reportEscape(entry.label)}</span></li>`;
  }).join("")}</ul>`;
}

function renderTriageChecks(checks = []) {
  let currentGroup = "";
  return checks.map(rawCheck => {
    const check = reportCommon.normalizeReportCheck(rawCheck);
    const group = check.group !== currentGroup ? `<tr class="check-group"><th colspan="4">${reportEscape(check.group)}</th></tr>` : "";
    currentGroup = check.group;
    return `${group}<tr class="check-row"><td><strong>${reportEscape(check.name)}</strong><small>${reportEscape(check.severity)} priority</small></td><td><span class="check-status check-status--${reportEscape(check.state)}">${reportEscape(check.statusLabel)}</span></td><td>${reportEscape(check.evidence)}</td><td>${reportEscape(check.limitation)}</td></tr>`;
  }).join("") || `<tr><td colspan="4">No checks were generated for this analysis scope.</td></tr>`;
}

function buildSingleCaptureReportHtml(report) {
  const findingRows = report.findings.length
    ? report.findings.map(finding => `<article class="finding finding--${reportEscape(finding.severity)}"><div class="finding-rank">${reportEscape(finding.severity)}</div><div><h3>${reportEscape(finding.title)}</h3><p>${reportEscape(finding.detail)}</p>${finding.packet ? `<small>Evidence frame ${reportEscape(finding.packet)}</small>` : ""}</div></article>`).join("")
    : `<p class="empty">No expert findings were generated for this analysis scope.</p>`;
  const charts = report.charts.map(chart => `<figure class="chart"><figcaption>${reportEscape(chart.title)}</figcaption>${chart.image ? `<img src="${reportEscape(chart.image)}" alt="${reportEscape(chart.title)} chart">` : `<div class="chart-unavailable">Chart not available for this capture mode.</div>`}${renderReportLegend(chart.legend)}</figure>`).join("");
  const services = report.services.length
    ? report.services.slice(0, 12).map(service => `<tr><td>${reportEscape(service.name)}</td><td>${reportNumber(service.requests)}</td><td>${reportNumber(service.errors)}</td><td>${reportEscape(service.latency)}</td><td>${reportEscape(service.details)}</td></tr>`).join("")
    : `<tr><td colspan="5">No application services decoded.</td></tr>`;
  const flows = report.flows.length
    ? report.flows.slice(0, 10).map(flow => `<tr><td>${reportEscape(flow.a)} ↔ ${reportEscape(flow.b)}</td><td>${reportEscape(flow.protocol)}</td><td>${reportNumber(flow.packets)}</td><td>${reportEscape(flow.traffic)}</td><td>${reportEscape(flow.latency)}</td><td>${reportEscape(flow.state)}</td></tr>`).join("")
    : `<tr><td colspan="6">No conversations in this analysis scope.</td></tr>`;
  const hasInvestigationNotes = Boolean(report.problemStatement || report.narrative || report.relevantFrames.length);
  const narrative = hasInvestigationNotes ? `<section class="report-section"><p class="eyebrow">INVESTIGATION NOTES</p><h2>${report.problemStatement ? "Problem statement and narrative" : "Analysis narrative"}</h2>${report.problemStatement ? `<p class="problem">${reportEscape(report.problemStatement)}</p>` : ""}${report.narrative ? `<p class="narrative">${reportEscape(report.narrative)}</p>` : ""}${report.relevantFrames.length ? `<h3>Relevant frames</h3><ol class="evidence-list">${report.relevantFrames.map(frame => `<li><strong>Frame ${reportEscape(frame.number)} · ${reportEscape(frame.protocol || "Packet")}</strong><span>${reportEscape(frame.time)} · ${reportEscape(frame.source)} → ${reportEscape(frame.destination)} · ${reportEscape(frame.length)} B</span><p>${reportEscape(frame.note || frame.info)}</p></li>`).join("")}</ol>` : ""}</section>` : "";
  const triageRows = renderTriageChecks(report.triageChecks);
  const includedCheckGroups = report.includedCheckGroups?.length ? report.includedCheckGroups.join(", ") : "none selected";
  const methodology = `<section class="methodology-page"><p class="eyebrow">HOW TO READ THIS REPORT</p><h2>Expert analysis factors and limits</h2><p class="subhead">AINetScope applies bounded, local checks to decoded packet metadata. Each result describes evidence in the selected capture scope, not a root-cause verdict.</p><div class="method-grid">
<article class="method-item"><h3>Scope and coverage</h3><p>Counts and checks use the packets currently included by dashboard filters. A capture can omit traffic because of its capture point, filter, time boundaries, packet loss, or asymmetric routing.</p></article>
<article class="method-item"><h3>Capture truncation</h3><p>Snaplen truncation is counted only when a capture record reports an original frame length larger than the bytes captured. This detects incomplete individual frames, not packets lost at the interface, driver, or network path.</p></article>
<article class="method-item"><h3>Flows and traffic share</h3><p>Conversations group observed endpoint pairs and transport. A dominant flow or traffic spike is descriptive; it becomes a concern only when compared with expected workload or a baseline.</p></article>
<article class="method-item"><h3>Latency samples</h3><p>TCP handshake timing is SYN-to-SYN/ACK. The separate ACK-to-data estimate is sampled only when a cumulative ACK newly covers exactly one previously unseen payload segment; retransmitted/overlapped segments and ACK advances spanning multiple segments are excluded (Karn-style ambiguity avoidance). Midstream data without an ACK baseline cannot produce samples. DNS timing uses matched query/response pairs. Percentiles are capture-time observations, not application transaction time or validated wire latency.</p></article>
<article class="method-item"><h3>TCP transport signals</h3><p>RST, SYN-without-observed-SYN/ACK, and advertised zero windows are counted from decoded packets. Zero-window episodes end at an observed non-zero update or RST; episodes still open at capture end have unknown duration. Repeated one-byte sends are considered only when repeated within the same observed peer zero-window episode. Candidate evidence includes repeat interval, ACK stability, and whether both window-scale offers were captured; this is not proof of RFC persist behavior. Receive-window occupancy is sampled only with complete SYN option records, an ACK baseline inside observed sequence high-water, and contiguous captured sequence coverage. The receiving endpoint's captured window-scale offer is applied to its advertised window. Sample context includes ACK/window ages, whether the latest raw window increased or decreased, and observed packet counts by direction; these do not establish capture asymmetry. Midstream, partial, or gapped contexts are not assessed. A bounded sequence pass compares payload byte ranges per direction and notes overlap, repeats after cumulative ACK, forward gaps, and later novel bytes below the observed high-water. Directions with a captured SYN are handshake-anchored; others use a midstream-relative origin. These remain possible retransmission/reordering signals: capture duplication, offload, missing context, and capture boundaries can produce similar evidence. Analysis is capped at 200,000 TCP packets, with at most 2,048 disjoint ranges, 50,000 RTT segments per direction, and 50,000 retained occupancy sample details; reports disclose when bounds make counts partial.</p></article>
<article class="method-item"><h3>IP and ICMP signals</h3><p>IPv4 fragment bits, visible ICMP unreachable messages, and path-MTU feedback from ICMPv4/ICMPv6 are reported. TTL is shown as a decoded value but is not called anomalous without a route or host baseline. IPv6 extension-header fragmentation is not classified here.</p></article>
<article class="method-item"><h3>DNS and web responses</h3><p>DNS transactions match by ID, opcode, normalized question signature, and reversed client/server endpoints. Repeated identical queries while a response is pending are possible retries. Responses without a question section can match only by ID/opcode/endpoints and are called out as lower confidence. Outstanding queries and unmatched responses may reflect capture boundaries, loss, or encrypted DNS; they do not prove resolver failure. Captured A/AAAA answers are observations for optional hostname suggestions, not current DNS truth. HTTP status checks cover visible HTTP/1.x only; HTTP/2 header compression and typical HTTP/3 encryption prevent equivalent status inspection here.</p></article>
<article class="method-item"><h3>TLS and QUIC</h3><p>Visible TLS record versions and alerts are reported; TLS 1.3 encrypts most post-handshake records, and record-layer version is not necessarily the negotiated version. QUIC Retry is normal address validation, not inherently an error.</p></article>
<article class="method-item"><h3>SMB and SQL Server</h3><p>SMB2 non-zero response statuses and visible TDS ERROR tokens are surfaced. Some SMB statuses are expected control flow; TDS login success/failure and query latency need request/response transaction correlation not yet implemented.</p></article>
<article class="method-item"><h3>Profile thresholds</h3><p>Where a profile threshold is shown, it is a screening rule for that profile, not a universal service-level objective. The UDP one-second gap check is a generic cadence screen, not proof of jitter or packet loss.</p></article>
<article class="method-item"><h3>Checks not assessed</h3><p>Not assessed means the analyzer does not have enough protocol decoding or correlation to test the factor. Examples include TCP out-of-order/loss rate, persist/window-full, certificate trust/revocation, SMB credit starvation, and generic UDP loss/jitter.</p></article>
</div><p class="method-callout"><strong>Interpretation:</strong> “Not observed” means the signal was not present in decoded packets in this scope. “No issue detected” means a supported check found no matching signal. Neither result proves the network or service is healthy; verify important findings against the relevant frames, endpoint logs, and an appropriately placed capture.</p></section>`;

  return `<!doctype html>
<html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${reportEscape(report.name)} - AINetScope Analysis Report</title>
<style>
:root{color-scheme:light;--ink:#182720;--muted:#52645b;--line:#cbd5ce;--green:#176b4d;--coral:#b94f35;--gold:#a57513;--blue:#23678a}*{box-sizing:border-box}body{margin:0;background:#edf1ed;color:var(--ink);font:14px/1.5 Arial,Helvetica,sans-serif}.report{max-width:1050px;margin:28px auto;padding:38px 44px;background:#fff;box-shadow:0 10px 34px #1d322522}.masthead{display:flex;justify-content:space-between;align-items:flex-start;gap:20px;border-bottom:3px solid var(--green);padding-bottom:18px}.brand{font-size:11px;font-weight:bold;letter-spacing:.12em;color:var(--green);text-transform:uppercase}.date{font-size:11px;color:var(--muted);text-align:right}.kicker,.eyebrow{margin:22px 0 5px;color:var(--green);font-size:10px;font-weight:bold;letter-spacing:.12em;text-transform:uppercase}h1{margin:6px 0 4px;font-size:30px;line-height:1.15}h2{font-size:19px;margin:0 0 12px}h3{font-size:14px;margin:0 0 4px}.subhead{color:var(--muted);margin:0}.scope{font-size:11px;color:var(--muted);margin-top:12px}.metrics{display:grid;grid-template-columns:repeat(4,1fr);border:1px solid var(--line);margin:22px 0}.metric{padding:13px;border-right:1px solid var(--line);min-width:0}.metric:last-child{border:0}.metric span,.metric strong{display:block}.metric span{font-size:9px;text-transform:uppercase;color:var(--muted);font-weight:bold}.metric strong{font-size:20px;margin-top:6px;color:var(--green);overflow-wrap:anywhere}.report-section{margin-top:26px}.chart-grid{display:grid;grid-template-columns:1fr 1fr;gap:12px}.chart{margin:0;border:1px solid var(--line);padding:10px;break-inside:avoid}.chart figcaption{font-weight:bold;font-size:11px;margin-bottom:8px}.chart img{display:block;width:100%;height:205px;object-fit:contain}.chart-unavailable{height:205px;display:grid;place-items:center;color:var(--muted);background:#f3f6f3;font-size:11px}.finding{display:grid;grid-template-columns:70px 1fr;gap:12px;padding:12px 0;border-bottom:1px solid var(--line);break-inside:avoid}.finding-rank{align-self:start;text-align:center;padding:3px 5px;border:1px solid var(--line);font-weight:bold;font-size:10px;text-transform:uppercase}.finding--high .finding-rank{color:#a3271d;border-color:#e1aaa4;background:#fff1ef}.finding--medium .finding-rank{color:#815500;border-color:#dfc581;background:#fff8e7}.finding--info .finding-rank{color:var(--blue);border-color:#a9c9d8;background:#edf7fb}.finding p,.problem,.narrative{margin:4px 0;color:#394b42}.finding small{color:var(--muted);font-size:10px}.narrative{white-space:pre-wrap}.problem{padding:12px;border-left:3px solid var(--coral);background:#fff5f1;font-weight:bold}.evidence-list{padding-left:20px}.evidence-list li{margin:10px 0;break-inside:avoid}.evidence-list span,.evidence-list p{display:block;color:var(--muted);font-size:11px;margin:2px 0}table{width:100%;border-collapse:collapse;font-size:10px}th,td{text-align:left;vertical-align:top;padding:7px;border-bottom:1px solid var(--line);overflow-wrap:anywhere}th{background:#eff4ef;color:#30463b}.empty{color:var(--muted);padding:12px 0}.footer{margin-top:28px;border-top:1px solid var(--line);padding-top:10px;color:var(--muted);font-size:9px}.toolbar{max-width:1050px;margin:16px auto;display:flex;justify-content:flex-end;gap:8px}.toolbar button{padding:9px 14px;border:1px solid var(--green);background:var(--green);color:white;font-weight:bold;cursor:pointer}.toolbar button.secondary{background:#fff;color:var(--ink);border-color:var(--line)}
.chart-legend{display:flex;flex-wrap:wrap;gap:6px 14px;margin:8px 0 0;padding:0;list-style:none;color:var(--muted);font-size:9px}.chart-legend li{display:inline-flex;align-items:center;gap:5px}.legend-swatch{display:inline-block;flex:0 0 auto;width:8px;height:8px;background:var(--swatch-color)}.legend-swatch--dot{border-radius:50%}.legend-swatch--line{height:3px;width:12px}.legend-swatch--square{border-radius:1px}
.check-matrix{table-layout:fixed}.check-matrix th:nth-child(1){width:19%}.check-matrix th:nth-child(2){width:13%}.check-matrix th:nth-child(3){width:32%}.check-matrix th:nth-child(4){width:36%}.check-group th{text-align:left;background:#e8eee9;color:var(--green);text-transform:uppercase;font-size:9px;letter-spacing:.08em}.check-row td{vertical-align:top;overflow-wrap:anywhere}.check-row td:first-child small{display:block;color:var(--muted);text-transform:uppercase;font-size:8px}.check-status{display:inline-block;font-weight:bold;font-size:8px;text-transform:uppercase}.check-status--issue{color:var(--coral)}.check-status--review{color:var(--gold)}.check-status--observed{color:var(--blue)}.check-status--clear{color:var(--green)}.check-status--not-observed,.check-status--not-assessed{color:var(--muted)}.metric--latency{display:grid;grid-template-columns:minmax(0,1fr) auto;align-items:center;gap:8px}.metric--latency strong{font-size:24px}.metric-range{display:grid;gap:5px;color:var(--muted);font:400 8px/1.2 var(--mono)}.metric-range span{display:grid;grid-template-columns:22px auto;gap:4px}.methodology-page{break-before:page;page-break-before:always}.method-grid{display:grid;grid-template-columns:1fr 1fr;gap:0 24px}.method-item{padding:10px 0;border-bottom:1px solid var(--line);break-inside:avoid}.method-item h3{color:var(--green)}.method-item p{margin:4px 0 0;color:var(--muted);font-size:11px}.method-callout{margin:18px 0;padding:12px;border-left:3px solid var(--gold);background:#f5f2e9;font-size:11px}
.large-topology-option{display:flex;align-items:center;gap:7px;margin-left:12px;color:var(--muted);font-size:10px}.large-topology-option input{accent-color:var(--green)}.large-topology-status{font:400 9px var(--mono);color:var(--muted)}.large-topology-section{break-before:page;page-break-before:always}.large-topology-section[hidden]{display:none}.large-topology-section img{display:block;width:auto;max-width:100%;height:auto;margin-top:12px;border:1px solid var(--line)}.large-topology-tips{margin-top:12px;padding:10px;border-left:3px solid var(--gold);background:#f5f2e9;color:var(--muted);font-size:10px}.large-topology-frame{position:fixed;left:-10000px;top:0;width:700px;height:1000px;visibility:hidden;pointer-events:none;border:0}
.large-topology-rejected{margin-top:24px;padding:14px;border:1px solid var(--line);border-left:4px solid var(--gold);break-inside:avoid}.large-topology-rejected[hidden]{display:none}.large-topology-rejected h2{margin:0 0 6px;font-size:15px}.large-topology-rejected p,.large-topology-rejected li{color:var(--muted);font-size:10px}.large-topology-rejected ul{margin:6px 0;padding-left:18px}
@media(max-width:720px){.report{margin:0;padding:24px 18px}.chart-grid{grid-template-columns:1fr}.metrics{grid-template-columns:repeat(2,1fr)}.metric:nth-child(2){border-right:0}.metric:nth-child(-n+2){border-bottom:1px solid var(--line)}.toolbar{padding:0 12px}.masthead{flex-direction:column}.date{text-align:left}}
@media(max-width:720px){.method-grid{grid-template-columns:1fr}.check-matrix{min-width:760px}.check-wrap{overflow-x:auto}}
@media(max-width:720px){.large-topology-option{margin:0}.large-topology-frame{width:calc(100vw - 40px)}}
@media print{@page{size:A4;margin:12mm}body{background:#fff;font-size:10pt}.report{max-width:none;margin:0;padding:0;box-shadow:none}.toolbar{display:none}.large-topology-frame{display:none}.masthead{break-after:avoid}.report-section{break-inside:auto}.expert-analysis-page{break-before:page;page-break-before:always}.chart-grid{grid-template-columns:1fr 1fr}.chart img,.chart-unavailable{height:175px}.metrics,.chart,.finding,.evidence-list li,.method-item{break-inside:avoid}h2,h3{break-after:avoid}table{font-size:7.5pt}th,td{padding:4px}.check-matrix{min-width:0}.check-status{font-size:7pt}.metric--latency strong{font-size:20px}.metric-range{font-size:7pt}.method-grid{grid-template-columns:1fr 1fr}.large-topology-section img{width:auto;max-width:100%;max-height:none;break-inside:avoid}.footer{break-before:avoid}}
</style></head><body><div class="toolbar"><button class="secondary" onclick="window.close()">Close report</button><label class="large-topology-option"><input id="includeLargeTopology" type="checkbox" ${report.largeTopologyDocument ? "" : "disabled"}>Include large topology map</label><span class="large-topology-status" id="largeTopologyStatus">${report.largeTopologyDocument ? "Optional · unchecked by default" : "No topology available"}</span><button onclick="window.print()">Print / Save as PDF</button></div><main class="report"><header class="masthead"><div><div class="brand">DataSnare · AINetScope</div><p class="kicker">Packet capture analysis report</p><h1>${reportEscape(report.name)}</h1><p class="subhead">Expert summary of network behavior in the analyzed trace.</p><p class="scope">${reportEscape(report.scope)} · Profile: ${reportEscape(report.profile)} · IP map: ${reportEscape(report.hostMapProfile || "No IP map")}</p></div><div class="date">Generated<br><strong>${reportEscape(report.generatedAt)}</strong></div></header>
<section class="metrics">${report.metrics.map(metric => `<div class="metric${metric.secondary ? " metric--latency" : ""}"><div><span>${reportEscape(metric.label)}</span><strong>${reportEscape(metric.value)}</strong></div>${metric.secondary ? `<div class="metric-range">${metric.secondary.map(item => `<span><i>${reportEscape(item.label)}</i><b>${reportEscape(item.value)}</b></span>`).join("")}</div>` : ""}</div>`).join("")}</section>
<section class="report-section"><p class="eyebrow">VISUAL ANALYSIS</p><h2>Charts and traffic shape</h2><div class="chart-grid">${charts}</div></section>
<section class="large-topology-section" id="largeTopologySection" hidden><p class="eyebrow">OPTIONAL FULL TOPOLOGY</p><h2>Interactive topology snapshot</h2><p class="subhead" id="largeTopologyCaption"></p><img id="largeTopologyImage" alt="Full topology map for this capture"></section>
<section class="report-section expert-analysis-page"><p class="eyebrow">EXPERT ANALYSIS</p><h2>Ranked observations</h2>${findingRows}</section>
${narrative}
<section class="report-section"><p class="eyebrow">APPLICATION BEHAVIOR</p><h2>Decoded services</h2><table><thead><tr><th>Service</th><th>Requests</th><th>Errors</th><th>Median latency</th><th>Observed detail</th></tr></thead><tbody>${services}</tbody></table></section>
<section class="report-section"><p class="eyebrow">CONVERSATIONS</p><h2>Top network flows</h2><table><thead><tr><th>Endpoints</th><th>Protocol</th><th>Packets</th><th>Traffic</th><th>Latency</th><th>State</th></tr></thead><tbody>${flows}</tbody></table></section>
<section class="report-section"><p class="eyebrow">QUICK CHECKS</p><h2>Protocol and network triage</h2><p class="subhead">Included groups: ${reportEscape(includedCheckGroups)}. Results reflect decoded evidence in this capture scope; the limitations column states important interpretation boundaries.</p><div class="check-wrap"><table class="check-matrix"><thead><tr><th>Check</th><th>Result</th><th>Observed evidence</th><th>Interpretation / limits</th></tr></thead><tbody>${triageRows}</tbody></table></div></section>
<section class="large-topology-rejected" id="largeTopologyRejected" hidden><h2>Full topology was not included</h2><p>The map extends beyond the printable width. It was not scaled down, to preserve label readability. The compact endpoint topology chart remains in the report.</p><strong>To make the full map fit:</strong><ul><li>Open the interactive Topology map and split an overfull lane. For example, divide “VLAN 23 Automation” into “VLAN 23 Automation” and “VLAN 23 Automation Continued”.</li><li>Move a subset of hosts into the new lane, or shorten long lane labels.</li><li>Return to the capture and create the PDF again, then check Include large topology map.</li></ul></section>
<div id="largeTopologySource" data-profile-name="${reportEscape(report.hostMapProfile || "No IP map")}" data-srcdoc="${reportEscape(encodeURIComponent(report.largeTopologyDocument || ""))}" hidden></div><iframe class="large-topology-frame" id="largeTopologyFrame" title="Topology fit check" aria-hidden="true"></iframe>
<footer class="footer">Analysis was performed locally in the browser from the selected capture view. Expert findings are heuristic observations and should be verified against packet evidence and the operating environment.</footer>
${methodology}</main><script>${largeTopologyFitsPdf.toString()}
(function () {
  var checkbox = document.getElementById("includeLargeTopology");
  var status = document.getElementById("largeTopologyStatus");
  var source = document.getElementById("largeTopologySource");
  var frame = document.getElementById("largeTopologyFrame");
  var section = document.getElementById("largeTopologySection");
  var rejected = document.getElementById("largeTopologyRejected");
  var image = document.getElementById("largeTopologyImage");
  var caption = document.getElementById("largeTopologyCaption");
  var checkedSnapshot = false;
  if (!checkbox || !source || !source.dataset.srcdoc) return;
  checkbox.addEventListener("change", async function () {
    if (!checkbox.checked) {
      section.hidden = true;
      rejected.hidden = true;
      image.removeAttribute("src");
      status.textContent = "Optional · unchecked";
      checkedSnapshot = false;
      return;
    }
    if (checkedSnapshot && image.src) { section.hidden = false; rejected.hidden = true; status.textContent = "Large map ready"; return; }
    status.textContent = "Checking natural-size fit…";
    try {
      var loaded = new Promise(function (resolve, rejectLoad) {
        var timeout = setTimeout(function () { rejectLoad(new Error("Topology fit check timed out.")); }, 10000);
        frame.addEventListener("load", function () { clearTimeout(timeout); resolve(); }, { once: true });
      });
      frame.srcdoc = decodeURIComponent(source.dataset.srcdoc);
      await loaded;
      await new Promise(function (resolve) { setTimeout(resolve, 120); });
      var snapshotFunction = frame.contentWindow.DataSnareTopologyPdfSnapshot;
      if (typeof snapshotFunction !== "function") throw new Error("Topology PNG renderer is unavailable.");
      var snapshot = snapshotFunction();
      if (snapshot.error) throw new Error(snapshot.error);
      var maxWidth = snapshot.maxWidth || 700;
      var overflow = snapshot.horizontalOverflow || snapshot.scrollWidth > snapshot.viewportWidth + 1;
      if (overflow || !largeTopologyFitsPdf(snapshot, maxWidth)) {
        checkbox.checked = false;
        checkedSnapshot = false;
        section.hidden = true;
        rejected.hidden = false;
        status.textContent = "Too wide · not included";
        return;
      }
      image.src = snapshot.dataUrl;
      image.style.width = snapshot.width + "px";
      image.dataset.naturalWidth = snapshot.width;
      image.dataset.naturalHeight = snapshot.height;
      caption.textContent = "Natural-size topology snapshot · " + snapshot.width + " × " + snapshot.height + " px · " + (source.dataset.profileName || "active IP map");
      section.hidden = false;
      rejected.hidden = true;
      checkedSnapshot = true;
      status.textContent = "Large map ready · " + snapshot.width + " px wide";
    } catch (error) {
      checkbox.checked = false;
      section.hidden = true;
      rejected.hidden = false;
      status.textContent = "Could not check fit";
      rejected.querySelector("p").textContent = "The full topology could not be rendered for this report, so it was not included. The compact endpoint topology chart remains available. " + error.message;
    }
  });
})();
</script></body></html>`;
}

function reportSummaryText(html) {
  if (typeof DOMParser === "undefined") return String(html || "").replace(/<[^>]*>/g, " ").replace(/\s+/g, " ").trim();
  return new DOMParser().parseFromString(String(html || ""), "text/html").body.textContent.replace(/\s+/g, " ").trim();
}

function buildSingleCaptureReportData() {
  const packets = state.filtered;
  const aggregation = aggregate(packets);
  const services = analyzeServices(packets);
  const summary = analysisSummary(packets, aggregation);
  const profile = getActiveAnalysisProfile();
  const triageChecks = buildTriageChecks(packets, aggregation, services, profile,
    settings.reportCheckGroups, analyzeTcpSequence(packets));
  const captureNarrative = typeof captureSummary === "function" ? captureSummary() : { problemStatement: "", narrative: "", relevantFrames: [] };
  const largeTopologyPayload = typeof buildSingleCaptureTopologyPayload === "function"
    ? buildSingleCaptureTopologyPayload(packets, aggregation.flows, { captureId: state.captureId, name: state.fileName }, activeHostnameProfile()) : null;
  const protocolBytes = packets.reduce((totals, packet) => { totals[packet.protocol] = (totals[packet.protocol] || 0) + packet.length; return totals; }, {});
  const protocolTotal = Object.values(protocolBytes).reduce((total, bytes) => total + bytes, 0);
  const protocolLegend = Object.entries(protocolBytes).map(([name, bytes], index) => ({
    label: `${name} · ${Math.round(bytes / Math.max(protocolTotal, 1) * 100)}% of bytes`, color: COLORS[index % COLORS.length], kind: "dot"
  }));
  const charts = [
    { title: "Traffic throughput", selector: "#timelineCanvas", legend: [
      { label: "Inbound · source differs from first packet source", color: COLORS[0], kind: "line" },
      { label: "Outbound · source matches first packet source", color: COLORS[1], kind: "line" }
    ] },
    { title: "Protocol distribution", selector: "#protocolCanvas", legend: protocolLegend },
    { title: "Frame-size profile", selector: "#frameSizeCanvas", legend: [
      { label: "Frame length", color: COLORS[3], kind: "line" },
      { label: "Moving average", color: COLORS[1], kind: "line" }
    ] },
    { title: "Response-time distribution", selector: "#latencyCanvas", legend: [
      { label: "TCP handshake RTT", color: COLORS[0], kind: "dot" },
      { label: "DNS response", color: COLORS[2], kind: "dot" }
    ] },
    { title: "Endpoint topology", selector: "#topologyCanvas", legend: [
      { label: "Endpoint · node size shows total traffic", color: COLORS[0], kind: "dot" },
      { label: "Bidirectional flow · line width shows traffic", color: COLORS[0], kind: "line" }
    ] },
    { title: "Selected flow timeline", selector: "#flowCanvas", legend: [
      { label: "A → B packets", color: COLORS[0], kind: "line" },
      { label: "B → A packets", color: COLORS[3], kind: "line" },
      { label: "TCP reset", color: COLORS[1], kind: "square" }
    ] }
  ].map(chart => {
    const canvas = $(chart.selector);
    let image = "";
    try { if (canvas?.width && canvas?.height) image = canvas.toDataURL("image/png"); } catch (_) { image = ""; }
    return { title: chart.title, legend: chart.legend, image };
  });
  const relevantFrames = (captureNarrative.relevantFrames || []).map(reference => {
    const packet = state.packets.find(item => item.number === Number(reference.number));
    return packet ? {
      number: packet.number,
      protocol: packet.protocol,
      time: `${(packet.timestamp - state.baseTime).toFixed(6)}s`,
      source: packet.src,
      destination: packet.dst,
      length: packet.length,
      info: packet.info,
      note: typeof packetNote === "function" ? reportSummaryText(packetNote(packet.number)) : ""
    } : null;
  }).filter(Boolean);
  return reportCommon.createReportModel({
    mode: "single-capture",
    sources: [{ name: state.fileName || "Network capture" }],
    name: state.fileName || "Network capture",
    generatedAt: new Date().toLocaleString(),
    scope: { summary: packets.length === state.packets.length ? `${reportNumber(packets.length)} packets analyzed` : `${reportNumber(packets.length)} of ${reportNumber(state.packets.length)} packets analyzed (current dashboard filters)` },
    profile: profile.name,
    hostMapProfile: settings.activeHostMapProfile || "No IP map",
    metrics: [
      { label: "Packets", value: reportNumber(summary.packets) },
      { label: "Captured traffic", value: formatBytes(summary.bytes) },
      { label: "Conversations", value: reportNumber(summary.flows) },
      { label: "Duration", value: `${reportNumber(summary.duration, 3)} s` },
      { label: "Throughput", value: formatRate(summary.throughput) },
      { label: "Median response", value: formatLatency(summary.latencyP50), secondary: [
        { label: "Min", value: formatLatency(summary.latencyMin) },
        { label: "Max", value: formatLatency(summary.latencyMax) }
      ] },
      { label: "p95 response", value: formatLatency(summary.latencyP95) },
      { label: "Retransmissions", value: reportNumber(summary.retransmissions) }
    ],
    charts,
    findings: buildFindings(packets, aggregation, services, profile),
    triageChecks,
    caveats: [...new Set(triageChecks.map(check => check.limitation).filter(Boolean))],
    includedCheckGroups: Object.keys(settings.reportCheckGroups).filter(group => settings.reportCheckGroups[group]),
    largeTopologyDocument: largeTopologyPayload?.edges.length && typeof buildTopologyDocument === "function"
      ? buildTopologyDocument({ ...largeTopologyPayload, pdfFitCheck: true, pdfMaxWidth: 700 }) : "",
    services: services.map(service => ({ ...service, latency: formatLatency(median(service.latencies)), details: [...service.details].slice(0, 3).join(", ") || `${service.packets} packets` })),
    flows: aggregation.flows.slice(0, 10).map(flow => ({ ...flow, a: displayEndpointName(flow.a), b: displayEndpointName(flow.b), traffic: formatBytes(flow.bytes), latency: formatLatency(flow.latencyValue) })),
    problemStatement: captureNarrative.problemStatement || "",
    narrative: reportSummaryText(captureNarrative.narrative),
    relevantFrames
  });
}

function openSingleCaptureReport() {
  if (!state.filtered.length) { showToast("Open a capture before creating a PDF report."); return; }
  const reportWindow = window.open("", "_blank");
  if (!reportWindow) { showToast("Allow pop-ups for AINetScope to open the report for printing."); return; }
  const report = buildSingleCaptureReportHtml(buildSingleCaptureReportData());
  reportWindow.document.open();
  reportWindow.document.write(report);
  reportWindow.document.close();
  showToast("Report opened in a new tab. Choose Print / Save as PDF there.");
}

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildSingleCaptureReportHtml, buildTriageChecks, largeTopologyFitsPdf, reportEscape, reportNumber };
}

if (typeof document !== "undefined") {
  $("#pdfReportButton")?.addEventListener("click", openSingleCaptureReport);
}