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