"use strict";

const fs = require("fs");
const vm = require("vm");

const context = { console, Uint8Array, DataView, ArrayBuffer, TextDecoder, TextEncoder, Map, Set, Date, Math, Number, String, Object, Array, Error, Infinity };
vm.createContext(context);
vm.runInContext(fs.readFileSync("app.js", "utf8"), context);

const packetCount = 1001;
const buffer = new ArrayBuffer(24 + packetCount * 30);
const bytes = new Uint8Array(buffer);
const view = new DataView(buffer);
bytes.set([0xd4, 0xc3, 0xb2, 0xa1]);
view.setUint32(20, 1, true);
for (let index = 0, offset = 24; index < packetCount; index++, offset += 30) {
  view.setUint32(offset, index, true);
  view.setUint32(offset + 8, 14, true);
  view.setUint32(offset + 12, 14, true);
}

const started = Date.now();
const packets = context.parseCapture(buffer, { maxPackets: 1500000, compactThreshold: 1000 });
if (packets.length !== packetCount || packets.compact !== true) throw new Error("Compact mode did not activate.");
if (!Number.isFinite(packets[0].captureOffset) || packets[0].capturedLength !== 14) throw new Error("Capture offsets are invalid.");
if ("raw" in packets[0] || "rawBytes" in packets[0] || "layers" in packets[0] || "details" in packets[0]) throw new Error("Compact packet retained expanded fields.");

const expandedPackets = context.parseCapture(buffer, { maxPackets: 1500000, compactThreshold: Infinity });
if (expandedPackets.length !== packetCount || expandedPackets.compact === true) throw new Error("Explicitly disabled compact mode still compacted the capture.");
if (!Array.isArray(expandedPackets[0].layers) || !expandedPackets[0].details) throw new Error("Expanded packet details were not retained.");

let limitError = "";
try { context.parseCapture(buffer, { maxPackets: 1000 }); } catch (error) { limitError = error.message; }
if (!limitError.includes("Packet limit exceeded")) throw new Error(`Unexpected packet limit result: ${limitError}`);

console.log(JSON.stringify({ packets: packets.length, compact: packets.compact, expandedCompact: expandedPackets.compact, expandedLayers: expandedPackets[0].layers.length, firstOffset: packets[0].captureOffset, firstLength: packets[0].capturedLength, limitError, elapsedMs: Date.now() - started }));