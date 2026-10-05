"use strict";

const $ = (selector) => document.querySelector(selector);
const COLORS = ["#1d6b4f", "#e86d4c", "#e2ac45", "#4182a4", "#89a63e", "#946c9b", "#7a817a"];
const TCP_FLAGS = { 0x01: "FIN", 0x02: "SYN", 0x04: "RST", 0x08: "PSH", 0x10: "ACK", 0x20: "URG", 0x40: "ECE", 0x80: "CWR" };
const SETTINGS_KEY = "datasnare-ainetscope-settings-v1";
const DEFAULT_REFERENCE_LINKS = Object.freeze([{ label: "TCP reference", url: "https://www.rfc-editor.org/rfc/rfc9293" }, { label: "TCP state diagram", url: "https://commons.wikimedia.org/wiki/File:Tcp_state_diagram_fixed_new.svg" }, { label: "UDP reference", url: "https://www.rfc-editor.org/rfc/rfc768" }, { label: "DNS reference", url: "https://www.rfc-editor.org/rfc/rfc1035" }, { label: "HTTP reference", url: "https://www.rfc-editor.org/rfc/rfc9110" }, { label: "HTTP/2 reference", url: "https://www.rfc-editor.org/rfc/rfc9113" }, { label: "HTTP/3 reference", url: "https://www.rfc-editor.org/rfc/rfc9114" }, { label: "TLS reference", url: "https://www.rfc-editor.org/rfc/rfc8446" }, { label: "QUIC reference", url: "https://www.rfc-editor.org/rfc/rfc9000" }, { label: "SMB reference", url: "https://learn.microsoft.com/openspecs/windows_protocols/ms-smb" }, { label: "SMB2 reference", url: "https://learn.microsoft.com/openspecs/windows_protocols/ms-smb2" }, { label: "TDS reference", url: "https://learn.microsoft.com/openspecs/windows_protocols/ms-tds" }, { label: "DCE/RPC reference", url: "https://learn.microsoft.com/openspecs/windows_protocols/ms-rpce" }, { label: "OSI model", url: "https://www.iso.org/standard/14256.html" }, { label: "CIDR subnet map", url: "https://en.wikipedia.org/wiki/Classless_Inter-Domain_Routing" }]);
const DEFAULT_SETTINGS = Object.freeze({ maxCaptureMB: 250, maxPackets: 1500000, rawPreviewBytes: 512, cacheEnabled: false, compactMode: true, debugLogEnabled: false, sansFont: "Manrope, sans-serif", monoFont: "DM Mono, monospace", referenceLinks: DEFAULT_REFERENCE_LINKS });
const COMPACT_PACKET_THRESHOLD = 100000;
const SINGLE_CAPTURE_COMPACT_THRESHOLD = 10000;
const LARGE_CAPTURE_FAST_PATH_PACKETS = 50000;
const MAX_CACHE_BYTES = 32 * 1024 * 1024;
const state = { packets: [], flows: [], filtered: [], fileName: "", captureId: "", duration: 0, baseTime: 0, activeFlowKey: "", baseline: null, cacheKey: "", captureBuffer: null, compactMode: false, backgroundRenderQueued: false, backgroundWorkbenchQueued: false };
const DEBUG_LOG_STATE = { enabled: false, panel: null };

function loadSettings() {
  try {
    const saved = JSON.parse(localStorage.getItem(SETTINGS_KEY)) || {};
    const preview = Number(saved.rawPreviewBytes);
    const savedReferences = Array.isArray(saved.referenceLinks) ? saved.referenceLinks.filter(link => link && typeof link.label === "string" && /^(https?:|mailto:)/i.test(link.url || "")).slice(0, 50).map(link => ({ label: link.label.trim().slice(0, 80), url: link.url.trim().slice(0, 500) })).filter(link => link.label && link.url) : [];
    const referenceLinks = [...savedReferences, ...DEFAULT_REFERENCE_LINKS.filter(defaultLink => !savedReferences.some(savedLink => savedLink.url === defaultLink.url))].slice(0, 50);
    return {
      maxCaptureMB: Math.max(1, Number(saved.maxCaptureMB) || DEFAULT_SETTINGS.maxCaptureMB),
      maxPackets: Math.max(1, Math.floor(Number(saved.maxPackets) || DEFAULT_SETTINGS.maxPackets)),
      rawPreviewBytes: Number.isFinite(preview) ? Math.max(0, Math.min(65535, Math.floor(preview))) : DEFAULT_SETTINGS.rawPreviewBytes,
      cacheEnabled: saved.cacheEnabled === true,
      compactMode: saved.compactMode !== false,
      debugLogEnabled: saved.debugLogEnabled === true,
      sansFont: typeof saved.sansFont === "string" && saved.sansFont.trim() ? saved.sansFont.trim().slice(0, 160) : DEFAULT_SETTINGS.sansFont,
      monoFont: typeof saved.monoFont === "string" && saved.monoFont.trim() ? saved.monoFont.trim().slice(0, 160) : DEFAULT_SETTINGS.monoFont,
      referenceLinks: referenceLinks.length ? referenceLinks : DEFAULT_REFERENCE_LINKS
    };
  } catch (_) { return { ...DEFAULT_SETTINGS, referenceLinks: [...DEFAULT_REFERENCE_LINKS] }; }
}

let settings = typeof localStorage === "undefined" ? { ...DEFAULT_SETTINGS } : loadSettings();
if (typeof document !== "undefined") { document.documentElement.style.setProperty("--sans", settings.sansFont); document.documentElement.style.setProperty("--mono", settings.monoFont); }
if (typeof document !== "undefined") toggleDebugLogPanel(Boolean(settings.debugLogEnabled));

function ensureDebugLogPanel() {
  if (typeof document === "undefined" || !document.body || !DEBUG_LOG_STATE.enabled) return null;
  if (DEBUG_LOG_STATE.panel && document.body.contains(DEBUG_LOG_STATE.panel)) return DEBUG_LOG_STATE.panel;
  const panel = document.createElement("div");
  panel.id = "debugLogPanel";
  panel.style.cssText = "position:fixed;right:12px;bottom:12px;z-index:9999;max-width:min(560px,calc(100vw - 24px));max-height:220px;overflow:auto;padding:10px 12px;border:1px solid #17211d;background:#fbfaf6;color:#17211d;box-shadow:0 12px 30px rgba(23,33,29,.22);font:10px/1.45 'DM Mono',Consolas,monospace;white-space:pre-wrap";
  panel.innerHTML = "<strong>AINetScope diagnostics</strong>\n";
  document.body.appendChild(panel);
  DEBUG_LOG_STATE.panel = panel;
  return panel;
}

function toggleDebugLogPanel(forceState = !DEBUG_LOG_STATE.enabled) {
  DEBUG_LOG_STATE.enabled = Boolean(forceState);
  if (!DEBUG_LOG_STATE.enabled && DEBUG_LOG_STATE.panel) {
    DEBUG_LOG_STATE.panel.remove();
    DEBUG_LOG_STATE.panel = null;
  }
  if (DEBUG_LOG_STATE.enabled) ensureDebugLogPanel();
  return DEBUG_LOG_STATE.enabled;
}

function debugLog(stage, detail = {}) {
  const entry = { time: new Date().toISOString(), ...detail };
  try { console.warn(`[AINetScope] ${stage}`, entry); } catch (_) { /* console unavailable */ }
  if (!DEBUG_LOG_STATE.enabled) return;
  try {
    if (typeof document === "undefined" || !document.body) return;
    const panel = ensureDebugLogPanel();
    if (!panel) return;
    const detailText = Object.keys(detail).length ? " " + JSON.stringify(detail) : "";
    panel.textContent = (panel.textContent + `\n${new Date().toLocaleTimeString()} ${stage}${detailText}`).split("\n").slice(-18).join("\n");
  } catch (_) { /* diagnostics never block analysis */ }
}

if (typeof window !== "undefined") {
  window.DataSnareAINetScopeDiagnostics = Object.freeze({
    enable() { return toggleDebugLogPanel(true); },
    disable() { return toggleDebugLogPanel(false); },
    toggle() { return toggleDebugLogPanel(); },
    isEnabled() { return DEBUG_LOG_STATE.enabled; }
  });
  window.addEventListener("keydown", event => {
    if (event.ctrlKey && event.shiftKey && event.key && event.key.toLowerCase() === "d") {
      toggleDebugLogPanel();
      event.preventDefault();
    }
  });
  window.addEventListener("error", event => debugLog("window error", { message: event.message, source: event.filename, line: event.lineno, column: event.colno }));
  window.addEventListener("unhandledrejection", event => debugLog("unhandled rejection", { reason: String(event.reason?.message || event.reason || "unknown") }));
}

function bytesToHex(bytes, limit = bytes.length) {
  return Array.from(bytes.subarray(0, Math.min(bytes.length, limit)), byte => byte.toString(16).padStart(2, "0")).join(" ");
}

function formatBytes(value) {
  if (!Number.isFinite(value) || value === 0) return "0 B";
  const units = ["B", "KB", "MB", "GB"];
  const index = Math.min(Math.floor(Math.log(value) / Math.log(1024)), units.length - 1);
  return `${(value / 1024 ** index).toFixed(index ? 1 : 0)} ${units[index]}`;
}

function formatRate(value) {
  if (value >= 1e9) return `${(value / 1e9).toFixed(1)} Gbit/s`;
  if (value >= 1e6) return `${(value / 1e6).toFixed(1)} Mbit/s`;
  if (value >= 1e3) return `${(value / 1e3).toFixed(1)} kbit/s`;
  return `${Math.round(value)} bit/s`;
}

function formatLatency(value) {
  if (!Number.isFinite(value)) return "—";
  return value < 1 ? `${(value * 1000).toFixed(0)} µs` : `${value.toFixed(value < 10 ? 2 : 1)} ms`;
}

function median(values) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
}

function percentile(values, value) {
  if (!values.length) return NaN;
  const sorted = [...values].sort((a, b) => a - b);
  const index = Math.min(sorted.length - 1, Math.ceil(value * sorted.length) - 1);
  return sorted[Math.max(0, index)];
}

function safeText(bytes) {
  return new TextDecoder("utf-8", { fatal: false }).decode(bytes).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f]/g, ".");
}

function ipv4(bytes, offset) {
  return `${bytes[offset]}.${bytes[offset + 1]}.${bytes[offset + 2]}.${bytes[offset + 3]}`;
}

function ipv6(view, offset) {
  const parts = [];
  for (let index = 0; index < 16; index += 2) parts.push(view.getUint16(offset + index).toString(16));
  return parts.join(":").replace(/(^|:)0(?::0)+(?=:|$)/, "::");
}

function readName(bytes, offset, seen = new Set()) {
  const labels = [];
  let cursor = offset;
  let consumed = 0;
  while (cursor < bytes.length && bytes[cursor] !== 0 && labels.length < 40) {
    if ((bytes[cursor] & 0xc0) === 0xc0) {
      if (cursor + 1 >= bytes.length) break;
      const pointer = ((bytes[cursor] & 0x3f) << 8) | bytes[cursor + 1];
      if (seen.has(pointer)) break;
      seen.add(pointer);
      labels.push(readName(bytes, pointer, seen).name);
      consumed += 2;
      return { name: labels.filter(Boolean).join("."), length: consumed };
    }
    const length = bytes[cursor++];
    consumed += length + 1;
    if (length > 63 || cursor + length > bytes.length) break;
    labels.push(safeText(bytes.subarray(cursor, cursor + length)));
    cursor += length;
  }
  return { name: labels.filter(Boolean).join("."), length: consumed + 1 };
}

function parseDNS(bytes, view, offset) {
  if (offset + 12 > bytes.length) return null;
  const id = view.getUint16(offset);
  const flags = view.getUint16(offset + 2);
  const qr = Boolean(flags & 0x8000);
  const opcode = (flags >> 11) & 0x0f;
  const authoritative = Boolean(flags & 0x0400);
  const truncated = Boolean(flags & 0x0200);
  const recursionDesired = Boolean(flags & 0x0100);
  const recursionAvailable = Boolean(flags & 0x0080);
  const rcode = flags & 0x0f;
  let cursor = offset + 12;
  const questions = [];
  const qdcount = view.getUint16(offset + 4);
  for (let index = 0; index < qdcount && cursor + 4 <= bytes.length; index++) {
    const questionName = readName(bytes, cursor);
    cursor += questionName.length;
    if (cursor + 4 > bytes.length) break;
    const qtype = view.getUint16(cursor);
    const qclass = view.getUint16(cursor + 2);
    questions.push({ name: questionName.name, type: qtype, class: qclass });
    cursor += 4;
  }
  const answerCount = view.getUint16(offset + 6);
  const authorityCount = view.getUint16(offset + 8);
  const additionalCount = view.getUint16(offset + 10);
  const typeNames = { 1: "A", 2: "NS", 5: "CNAME", 6: "SOA", 12: "PTR", 15: "MX", 16: "TXT", 28: "AAAA", 33: "SRV", 65: "HTTPS" };
  const question = questions[0] || { name: "<unknown>", type: 0, class: 0 };
  const type = question.type;
  const dnsInfo = `${qr ? "Response" : "Query"} ${typeNames[type] || `TYPE${type}`} ${question.name || "<unknown>"}${rcode ? ` · RCODE ${rcode}` : ""}`;
  const details = {
    Transaction: `0x${id.toString(16).padStart(4, "0")}`,
    QR: qr ? "Response" : "Query",
    Opcode: opcode,
    "Authoritative answer": authoritative ? "Yes" : "No",
    "Truncated": truncated ? "Yes" : "No",
    "Recursion desired": recursionDesired ? "Yes" : "No",
    "Recursion available": recursionAvailable ? "Yes" : "No",
    "Question count": qdcount,
    "Answer count": answerCount,
    "Authority count": authorityCount,
    "Additional count": additionalCount,
    "Question name": question.name,
    "Question type": typeNames[type] || `TYPE${type}`,
    "Question class": question.class,
    "Response code": rcode,
    "Flags": `0x${flags.toString(16).padStart(4, "0")}`
  };
  if (qr && answerCount > 0) {
    let recordCursor = cursor;
    const answers = [];
    for (let index = 0; index < answerCount && recordCursor + 10 <= bytes.length; index++) {
      const nameInfo = readName(bytes, recordCursor);
      recordCursor += nameInfo.length;
      if (recordCursor + 10 > bytes.length) break;
      const rrType = view.getUint16(recordCursor);
      const rrClass = view.getUint16(recordCursor + 2);
      const ttl = view.getUint32(recordCursor + 4);
      const rdLength = view.getUint16(recordCursor + 8);
      recordCursor += 10;
      const rdata = bytes.subarray(recordCursor, recordCursor + rdLength);
      let value = rrType === 1 && rdata.length >= 4 ? ipv4(rdata, 0) : rrType === 28 && rdata.length >= 16 ? ipv6(new DataView(rdata.buffer, rdata.byteOffset, rdata.byteLength), 0) : safeText(rdata).replace(/\s+/g, " ");
      if (value && value.length > 64) value = value.slice(0, 64) + "…";
      answers.push(`${nameInfo.name} ${typeNames[rrType] || `TYPE${rrType}`} TTL=${ttl} ${value}`);
      recordCursor += rdLength;
    }
    if (answers.length) details.Answers = answers.join("; ");
  }
  return { protocol: "DNS", dnsId: id, dnsResponse: qr, dnsRcode: rcode, dnsName: question.name, info: dnsInfo, details };
}

function parseTLS(bytes, view, offset) {
  if (offset + 5 > bytes.length || ![20, 21, 22, 23].includes(bytes[offset]) || bytes[offset + 1] !== 3) return null;
  const recordType = bytes[offset];
  const version = `TLS ${bytes[offset + 2] === 4 ? "1.3" : bytes[offset + 2] === 3 ? "1.2" : "1.x"}`;
  const details = { "Record type": { 20: "Change Cipher Spec", 21: "Alert", 22: "Handshake", 23: "Application Data" }[recordType], Version: version };
  let info = `${details["Record type"]}, ${version}`;
  let alpn = "";
  if (recordType === 22 && offset + 9 < bytes.length) {
    const handshake = bytes[offset + 5];
    const handshakeNames = { 1: "Client Hello", 2: "Server Hello", 11: "Certificate", 20: "Finished" };
    info = `${handshakeNames[handshake] || "Handshake"}, ${version}`;
    details.Handshake = handshakeNames[handshake] || handshake;
    if (handshake === 1) {
      try {
        let cursor = offset + 5 + 4 + 2 + 32;
        cursor += 1 + bytes[cursor];
        const cipherLength = view.getUint16(cursor); cursor += 2 + cipherLength;
        cursor += 1 + bytes[cursor];
        const extensionsLength = view.getUint16(cursor); cursor += 2;
        const end = Math.min(cursor + extensionsLength, bytes.length);
        while (cursor + 4 <= end) {
          const type = view.getUint16(cursor);
          const length = view.getUint16(cursor + 2);
          const data = cursor + 4;
          if (type === 0 && data + 5 <= end) {
            const nameLength = view.getUint16(data + 3);
            details.SNI = safeText(bytes.subarray(data + 5, data + 5 + nameLength));
          }
          if (type === 16 && data + 3 <= end) {
            const nameLength = bytes[data + 2];
            alpn = safeText(bytes.subarray(data + 3, data + 3 + nameLength));
            details.ALPN = alpn;
          }
          cursor = data + length;
        }
        if (details.SNI) info += ` → ${details.SNI}`;
      } catch (_) { /* Truncated hello remains a valid TLS record. */ }
    }
  }
  return { protocol: alpn === "h2" ? "HTTP/2" : "TLS", tlsSni: details.SNI || "", tlsAlpn: alpn, info, details };
}

function parseHTTP2(bytes, view, offset) {
  const preface = "PRI * HTTP/2.0\r\n\r\nSM\r\n\r\n";
  if (safeText(bytes.subarray(offset, offset + 24)) === preface) return { protocol: "HTTP/2", info: "Connection preface", details: { Type: "Connection preface" } };
  if (offset + 9 > bytes.length) return null;
  const length = (bytes[offset] << 16) | (bytes[offset + 1] << 8) | bytes[offset + 2];
  const type = bytes[offset + 3];
  const flags = bytes[offset + 4];
  const names = { 0: "DATA", 1: "HEADERS", 2: "PRIORITY", 3: "RST_STREAM", 4: "SETTINGS", 5: "PUSH_PROMISE", 6: "PING", 7: "GOAWAY", 8: "WINDOW_UPDATE", 9: "CONTINUATION" };
  if (type > 9 || length > bytes.length - offset - 9) return null;
  const stream = view.getUint32(offset + 5) & 0x7fffffff;
  let details = { Type: names[type] || `TYPE${type}`, Stream: stream, Length: length, Flags: `0x${flags.toString(16).padStart(2, "0")}` };
  if (type === 4 && length >= 6 && offset + 9 + length <= bytes.length) {
    const settings = [];
    for (let cursor = offset + 9; cursor + 6 <= offset + 9 + length; cursor += 6) {
      const settingId = view.getUint16(cursor);
      const settingValue = view.getUint32(cursor + 2);
      settings.push(`${settingId}:${settingValue}`);
    }
    details.Settings = settings.join(", ");
  }
  return { protocol: "HTTP/2", httpStream: stream, http2FrameType: names[type] || `TYPE${type}`, info: `${names[type] || `TYPE${type}`} stream=${stream} length=${length}`, details };
}

function parseQUIC(bytes, view, offset) {
  if (offset >= bytes.length || !(bytes[offset] & 0x40)) return null;
  const longHeader = Boolean(bytes[offset] & 0x80);
  if (!longHeader) {
    const packetType = bytes[offset] & 0x0f;
    const spinBit = (bytes[offset] >> 6) & 0x01;
    const keyPhase = (bytes[offset] >> 2) & 0x01;
    const dcidLength = bytes[offset + 1] & 0x0f;
    const dcid = bytesToHex(bytes.subarray(offset + 1, offset + 1 + dcidLength)).replaceAll(" ", "");
    return {
      protocol: "QUIC",
      info: `Protected payload (short header, spin=${spinBit}, keyPhase=${keyPhase})`,
      details: {
        Header: "Short",
        "Fixed bit": "Set",
        "Spin bit": spinBit,
        "Key phase": keyPhase,
        "Packet type": packetType,
        "Destination CID length": dcidLength,
        "Destination CID": dcid
      }
    };
  }
  if (offset + 6 > bytes.length) return null;
  const version = view.getUint32(offset + 1, false);
  const type = (bytes[offset] >> 4) & 0x03;
  const names = ["Initial", "0-RTT", "Handshake", "Retry"];
  const dcidLength = bytes[offset + 5] || 0;
  const scidLength = bytes[offset + 6] || 0;
  const dcidStart = offset + 6;
  const scidStart = dcidStart + dcidLength;
  const dcid = bytesToHex(bytes.subarray(dcidStart, dcidStart + dcidLength)).replaceAll(" ", "");
  const scid = bytesToHex(bytes.subarray(scidStart, scidStart + scidLength)).replaceAll(" ", "");
  const packetType = bytes[offset] & 0x0f;
  const alg = (bytes[offset] >> 2) & 0x03;
  const payloadStart = scidStart + scidLength;
  const payloadPreview = bytes.subarray(payloadStart, Math.min(bytes.length, payloadStart + 64));
  const http3 = /h3/i.test(safeText(payloadPreview)) || /h3/i.test(bytesToHex(payloadPreview)) || dcid.length > 0;
  return {
    protocol: http3 ? "HTTP/3" : "QUIC",
    quicVersion: `0x${version.toString(16)}`,
    info: `${names[type] || `TYPE${type}`} v${version.toString(16)} DCID=${dcid.slice(0, 12)} SCID=${scid.slice(0, 12)}`,
    details: {
      Header: "Long",
      Type: names[type] || `TYPE${type}`,
      Version: `0x${version.toString(16)}`,
      "Packet type": packetType,
      "Destination CID": dcid,
      "Source CID": scid,
      Algorithm: alg,
      "DCID length": dcidLength,
      "SCID length": scidLength,
      "Payload preview": safeText(payloadPreview).replace(/\s+/g, " ").slice(0, 64)
    }
  };
}

function parseSMB(bytes, offset) {
  if (offset + 16 > bytes.length) return null;
  let cursor = offset;
  while (cursor + 4 <= bytes.length && bytes[cursor] === 0x00) cursor += 4;
  if (cursor + 4 > bytes.length) return null;
  if ((bytes[cursor] !== 0xfe && bytes[cursor] !== 0xff) || bytes[cursor + 1] !== 0x53 || bytes[cursor + 2] !== 0x4d || bytes[cursor + 3] !== 0x42) return null;
  const smb2 = bytes[cursor] === 0xfe;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const command = smb2 ? view.getUint16(cursor + 12, false) : view.getUint16(cursor + 4, false);
  const status = smb2 ? view.getUint32(cursor + 8, false) : 0;
  const flags = smb2 ? view.getUint16(cursor + 16, false) : 0;
  const names = smb2 ? ["NEGOTIATE", "SESSION_SETUP", "LOGOFF", "TREE_CONNECT", "TREE_DISCONNECT", "CREATE", "CLOSE", "FLUSH", "READ", "WRITE", "LOCK", "IOCTL", "CANCEL", "ECHO", "QUERY_DIRECTORY", "CHANGE_NOTIFY", "QUERY_INFO", "SET_INFO", "OPLOCK_BREAK", "NOTIFY", "RENAME", "READ_ANDX", "WRITE_ANDX"] : { 0x72: "NEGOTIATE", 0x73: "SESSION_SETUP", 0x75: "TREE_CONNECT", 0x2e: "READ", 0x2f: "WRITE" };
  const name = names[command] || `Command 0x${command.toString(16)}`;
  const details = {
    Dialect: smb2 ? "SMB 2/3" : "SMB 1",
    Command: name,
    "Status code": smb2 ? `0x${status.toString(16).padStart(8, "0")}` : "n/a",
    Flags: smb2 ? `0x${flags.toString(16).padStart(4, "0")}` : "n/a"
  };
  if (smb2) {
    const messageId = view.getBigUint64(cursor + 24, false).toString();
    const treeId = view.getUint32(cursor + 40, false);
    const sessionId = view.getBigUint64(cursor + 48, false).toString();
    const processId = view.getUint32(cursor + 20, false);
    const treeIdValue = view.getUint32(cursor + 44, false);
    details["Message ID"] = messageId;
    details["Tree ID"] = treeId || treeIdValue;
    details["Session ID"] = sessionId;
    details["Process ID"] = processId;
    details["Header length"] = view.getUint16(cursor + 4, false);
    const headerLength = view.getUint16(cursor + 4, false);
    if (headerLength > 64 && cursor + 64 <= bytes.length && command === 0x00) {
      const dialectCount = view.getUint16(cursor + 56, false);
      const dialects = [];
      for (let index = 0, pos = cursor + 58; index < dialectCount && pos + 2 <= bytes.length; index++) {
        const dialect = view.getUint16(pos, false);
        dialects.push(`0x${dialect.toString(16).padStart(4, "0")}`);
        pos += 2;
      }
      if (dialects.length) details.Dialects = dialects.join(", ");
    }
  }
  return { protocol: smb2 ? "SMB2" : "SMB", smbCommand: name, info: `${name}${smb2 ? ` · 0x${status.toString(16).padStart(8, "0")}` : ""}`, details };
}

function tdsUcs2(bytes, offset, characters) {
  const end = Math.min(bytes.length, offset + characters * 2);
  return new TextDecoder("utf-16le", { fatal: false }).decode(bytes.subarray(offset, end)).replace(/\0/g, "");
}

function tdsVariableString(bytes, offset, end) {
  if (offset >= end) return { value: "", next: offset };
  const length = bytes[offset]; const next = Math.min(end, offset + 1 + length * 2);
  return { value: tdsUcs2(bytes, offset + 1, Math.floor((next - offset - 1) / 2)), next };
}

function cleanTdsSql(value) {
  return value.replace(/[\u0000-\u001f\u007f\ufeff]/g, " ").replace(/\s+/g, " ").trim();
}

function tdsTokenName(token) {
  return ({ 0x79: "RETURNSTATUS", 0x81: "COLMETADATA", 0xaa: "ERROR", 0xab: "INFO", 0xac: "RETURNVALUE", 0xad: "LOGINACK", 0xae: "FEATUREEXTACK", 0xd1: "ROW", 0xd2: "NBCROW", 0xe3: "ENVCHANGE", 0xed: "SSPI", 0xfd: "DONE", 0xfe: "DONEPROC", 0xff: "DONEINPROC" })[token] || `TOKEN 0x${token.toString(16).padStart(2, "0").toUpperCase()}`;
}

function decodeTdsToken(bytes, token, start, end, view) {
  const name = tdsTokenName(token); const result = { name, next: start, detail: "" };
  if (token === 0xaa || token === 0xab) {
    if (start + 2 > end) return result;
    const tokenEnd = Math.min(end, start + 2 + view.getUint16(start)); result.next = tokenEnd;
    if (start + 8 <= tokenEnd) {
      const number = view.getUint32(start + 2); const state = bytes[start + 6]; const severity = bytes[start + 7];
      const message = tdsVariableString(bytes, start + 8, tokenEnd); let cursor = message.next;
      const server = tdsVariableString(bytes, cursor, tokenEnd); cursor = server.next;
      const procedure = tdsVariableString(bytes, cursor, tokenEnd); cursor = procedure.next;
      const line = cursor + 4 <= tokenEnd ? view.getUint32(cursor) : null;
      result.detail = `${name} ${number}: ${message.value || "(no message)"} · severity ${severity} · state ${state}${server.value ? ` · server ${server.value}` : ""}${procedure.value ? ` · procedure ${procedure.value}` : ""}${line !== null ? ` · line ${line}` : ""}`;
    }
    return result;
  }
  if (token === 0xe3) {
    if (start + 3 > end) return result;
    const tokenEnd = Math.min(end, start + 2 + view.getUint16(start)); const changeType = bytes[start + 2]; const names = { 1: "database", 2: "language", 3: "character set", 4: "packet size", 5: "collation", 6: "locale", 7: "unicode data sorting", 8: "modify database", 9: "reset connection", 10: "user instance", 11: "routing" };
    const oldValue = tdsVariableString(bytes, start + 3, tokenEnd); const newValue = tdsVariableString(bytes, oldValue.next, tokenEnd); result.next = tokenEnd; result.detail = `ENVCHANGE ${names[changeType] || `type ${changeType}`}: ${newValue.value || "(empty)"}${oldValue.value ? ` (was ${oldValue.value})` : ""}`; return result;
  }
  if (token === 0xad) {
    if (start + 2 > end) return result;
    const tokenEnd = Math.min(end, start + 2 + view.getUint16(start)); result.next = tokenEnd;
    if (start + 7 <= tokenEnd) { const version = [...bytes.slice(start + 3, start + 7)].map(value => value.toString(16).padStart(2, "0")).join("."); const program = tdsVariableString(bytes, start + 7, tokenEnd); result.detail = `LOGINACK ${program.value || "SQL Server"} · TDS version ${version}`; }
    return result;
  }
  if (token === 0xfd || token === 0xfe || token === 0xff) {
    if (start + 12 <= end) { const status = view.getUint16(start); const command = view.getUint16(start + 2); const rowCount = view.getUint32(start + 4) + view.getUint32(start + 8) * 0x100000000; result.next = start + 12; result.detail = `${name} · status 0x${status.toString(16).padStart(4, "0")} · command ${command} · row count ${rowCount}`; }
    return result;
  }
  if (token === 0x79 && start + 4 <= end) { result.next = start + 4; result.detail = `RETURNSTATUS ${view.getUint32(start)}`; return result; }
  if (token === 0xae || token === 0xac || token === 0xed) {
    if (start + 2 <= end) { result.next = Math.min(end, start + 2 + view.getUint16(start)); result.detail = `${name} · ${result.next - start - 2} bytes${token === 0xed ? " (opaque authentication payload)" : ""}`; }
    return result;
  }
  if (token === 0x81) {
    if (start + 2 <= end) { const columnCount = view.getUint16(start); result.next = end; result.detail = `COLMETADATA · ${columnCount} column${columnCount === 1 ? "" : "s"} (type metadata follows; payload preserved)`; }
    return result;
  }
  if (token === 0xd1 || token === 0xd2) { result.next = end; result.detail = `${name} · row payload decoded according to preceding COLMETADATA`; return result; }
  result.next = end; result.detail = `${name} · ${end - start} bytes (undecoded token payload)`; return result;
}

function decodeTdsTokens(bytes, offset, length, view) {
  const end = offset + length; const tokens = []; let cursor = offset;
  while (cursor < end && tokens.length < 100) {
    const token = bytes[cursor++]; const decoded = decodeTdsToken(bytes, token, cursor, end, view);
    if (decoded.next <= cursor) break;
    tokens.push(decoded); cursor = decoded.next;
  }
  return tokens;
}

function parseTDS(bytes, view, offset) {
  if (offset + 8 > bytes.length) return null;
  const type = bytes[offset];
  const packetTypes = { 0x01: "SQL batch", 0x02: "Pre-TDS7 login", 0x03: "RPC", 0x04: "Response", 0x06: "Attention", 0x07: "Bulk load", 0x0e: "Transaction manager", 0x10: "Login7", 0x11: "SSPI", 0x12: "Prelogin" };
  if (!packetTypes[type]) return null;
  const length = view.getUint16(offset + 2);
  if (length < 8 || length > bytes.length - offset) return null;
  const status = bytes[offset + 1];
  const details = {
    Type: packetTypes[type],
    "Type code": `0x${type.toString(16).padStart(2, "0")}`,
    Status: status & 0x01 ? "End of message" : `0x${status.toString(16)}`,
    "Header length": 8,
    Length: length,
    SPID: view.getUint16(offset + 4),
    "Packet ID": bytes[offset + 6],
    Window: bytes[offset + 7],
    "Packet status": `0x${status.toString(16).padStart(2, "0")}`
  };
  let info = `${packetTypes[type]} · ${length} bytes`;
  if (type === 0x12 && length > 8) {
    const tokens = [];
    let cursor = offset + 8;
    while (cursor + 2 <= offset + length && bytes[cursor] !== 0xff) {
      const token = bytes[cursor];
      const tokenLen = bytes[cursor + 1];
      if (cursor + 2 + tokenLen > offset + length) break;
      const value = bytes.subarray(cursor + 2, cursor + 2 + tokenLen);
      tokens.push(`${token.toString(16).padStart(2, "0")}:${value.length}`);
      cursor += 2 + tokenLen;
    }
    if (tokens.length) details["Prelogin options"] = tokens.join(", ");
  }
  if (type === 0x01 && length > 8) {
    const sql = cleanTdsSql(new TextDecoder("utf-16le", { fatal: false }).decode(bytes.subarray(offset + 8, Math.min(offset + length, offset + 4104))));
    if (sql) { details["SQL text"] = sql; details["SQL preview"] = sql.slice(0, 256); info += ` · ${sql.slice(0, 120)}`; }
  }
  let decodedTokens = [];
  if (type === 0x04 && length > 8) {
    decodedTokens = decodeTdsTokens(bytes, offset + 8, length - 8, view);
    decodedTokens.forEach((token, index) => { details[`Token ${index + 1} · ${token.name}`] = token.detail; });
    const errors = decodedTokens.filter(token => token.name === "ERROR");
    if (errors.length) { details["Error token"] = `${errors.length} decoded`; info += ` · ${errors.length} error token${errors.length === 1 ? "" : "s"}`; }
    if (decodedTokens.length) details["Token count"] = decodedTokens.length;
  }
  return { protocol: "TDS", tdsType: packetTypes[type], tdsError: decodedTokens.some(token => token.name === "ERROR"), info, details };
}

function parseDceRpc(bytes, view, offset) {
  if (offset + 16 > bytes.length) return null;
  const rpcVersion = bytes[offset];
  const rpcMinor = bytes[offset + 1];
  const packetType = bytes[offset + 2];
  const flags = bytes[offset + 3];
  if (rpcVersion !== 0x05 || rpcMinor !== 0x00) return null;
  const version = bytes[offset + 4];
  const names = { 0: "Bind", 1: "Bind Ack", 2: "Alter Context", 3: "Alter Context Response", 5: "Request", 6: "Response", 7: "Fault", 8: "Cancel", 9: "Cancel Ack", 10: "Shutdown", 11: "CoCancel", 12: "Orphaned" };
  const fragLength = view.getUint16(offset + 8, false);
  const authLength = view.getUint16(offset + 10, false);
  const callId = view.getUint32(offset + 12, false);
  const opnum = offset + 16 <= bytes.length ? view.getUint16(offset + 16, false) : 0;
  const contextId = offset + 20 <= bytes.length ? view.getUint16(offset + 20, false) : 0;
  return {
    protocol: "DCE/RPC",
    info: `${names[packetType] || `Type ${packetType}`} v${version} op=${opnum} call=${callId}`,
    details: {
      Version: version,
      "Packet type": names[packetType] || packetType,
      Flags: `0x${flags.toString(16).padStart(2, "0")}`,
      "Fragment length": fragLength,
      "Auth length": authLength,
      "Context ID": contextId,
      "Operation number": opnum,
      "Call ID": callId
    }
  };
}

function parseHTTP3(bytes, view, offset) {
  if (offset + 1 > bytes.length) return null;
  const firstByte = bytes[offset];
  const typeNames = { 0x00: "DATA", 0x01: "HEADERS", 0x02: "CANCEL_PUSH", 0x03: "SETTINGS", 0x04: "PUSH_PROMISE", 0x05: "GOAWAY", 0x06: "MAX_PUSH_ID" };
  const isHttp3 = firstByte === 0x00 && offset + 5 <= bytes.length && bytes[offset + 1] <= 0x03;
  if (!isHttp3) return null;
  const frameType = typeNames[firstByte] || `0x${firstByte.toString(16).padStart(2, "0")}`;
  return {
    protocol: "HTTP/3",
    info: `HTTP/3 ${frameType}`,
    details: {
      "Header type": "HTTP/3",
      "Frame type": frameType,
      "First byte": `0x${firstByte.toString(16).padStart(2, "0")}`
    }
  };
}

function parseApplication(packet, bytes, view, offset) {
  const sourcePort = packet.srcPort;
  const destinationPort = packet.dstPort;
    if ([53, 5353].includes(sourcePort) || [53, 5353].includes(destinationPort)) return parseDNS(bytes, view, offset);
    if (packet.transport === "TCP" && (sourcePort === 135 || destinationPort === 135)) return parseDceRpc(bytes, view, offset);
    if (packet.transport === "TCP" && ([445, 139].includes(sourcePort) || [445, 139].includes(destinationPort))) return parseSMB(bytes, offset);
    if (packet.transport === "TCP" && (sourcePort === 1433 || destinationPort === 1433)) return parseTDS(bytes, view, offset);
    if (packet.transport === "UDP" && ([443, 784, 8853].includes(sourcePort) || [443, 784, 8853].includes(destinationPort))) {
      const quic = parseQUIC(bytes, view, offset);
      if (quic) {
        const isHttp3 = /h3/i.test(quic.info || "") || /h3/i.test(String(quic.details?.Version || "")) || [443, 784, 8853].includes(sourcePort) || [443, 784, 8853].includes(destinationPort);
        if (isHttp3) {
          const http3 = parseHTTP3(bytes, view, offset);
          if (http3) return { ...http3, info: `${quic.info || "HTTP/3"} · ${http3.info}` };
        }
        return quic;
      }
    }
    if (packet.transport === "TCP") {
      const text = safeText(bytes.subarray(offset, Math.min(bytes.length, offset + 1024)));
      const firstLine = text.split("\r\n")[0];
      if (/^(GET|POST|PUT|DELETE|HEAD|OPTIONS|PATCH|CONNECT) /.test(firstLine) || /^HTTP\/1\.[01] \d{3}/.test(firstLine)) {
        const lines = text.split("\r\n");
        const headers = {};
        for (const line of lines.slice(1)) {
          const separator = line.indexOf(":");
          if (separator > 0) headers[line.slice(0, separator).trim().toLowerCase()] = line.slice(separator + 1).trim();
        }
        const requestMatch = firstLine.match(/^([A-Z]+)\s+(\S+)\s+HTTP\/(1\.[01])$/);
        const responseMatch = firstLine.match(/^HTTP\/(1\.[01])\s+(\d{3})(?:\s+(.*))?$/);
        const host = headers.host || "";
        const details = {
          "Request/response": requestMatch ? "Request" : "Response",
          "HTTP version": `HTTP/${requestMatch?.[3] || responseMatch?.[1] || "1.1"}`,
          ...(requestMatch ? { "Request method": requestMatch[1], "Request URI": requestMatch[2], "Full request URI": host ? `http://${host}${requestMatch[2]}` : requestMatch[2] } : { "Status code": responseMatch?.[2] || "—", "Status phrase": responseMatch?.[3] || "—" }),
          Host: host || "—",
          ...(headers.connection ? { Connection: headers.connection } : {}),
          ...(headers.accept ? { Accept: headers.accept } : {}),
          ...(headers["accept-encoding"] ? { "Accept-Encoding": headers["accept-encoding"] } : {}),
          ...(headers["accept-language"] ? { "Accept-Language": headers["accept-language"] } : {}),
          ...(headers["content-type"] ? { "Content type": headers["content-type"] } : {}),
          ...(headers["content-length"] ? { "Content length": headers["content-length"] } : {}),
          ...(headers["user-agent"] ? { "User-Agent": headers["user-agent"] } : {}),
          ...(headers["server"] ? { Server: headers.server } : {}),
          ...(headers.date ? { Date: headers.date } : {})
        };
        return { protocol: "HTTP", httpHost: host, httpUri: requestMatch?.[2] || "", httpKind: requestMatch ? "request" : "response", httpMethod: requestMatch?.[1] || "", httpStatus: responseMatch?.[2] ? Number(responseMatch[2]) : null, info: `${firstLine}${host ? ` · ${host}` : ""}`, details };
      }
      if (sourcePort === 80 || destinationPort === 80 || sourcePort === 8080 || destinationPort === 8080) {
        const h2 = parseHTTP2(bytes, view, offset);
        if (h2) return h2;
      }
      const tls = parseTLS(bytes, view, offset);
      if (tls) return tls;
    }
    return null;
}

function parseFrame(frame, number, timestamp, linkType, options = {}) {
  const bytes = frame;
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const detailed = options.detailed !== false;
  const previewLength = Math.min(bytes.length, Math.max(0, options.rawPreviewBytes || 0));
  const packet = { number, timestamp, length: bytes.length, capturedLength: bytes.length, captureOffset: options.captureOffset ?? -1, linkType, protocol: "Unknown", transport: "", src: "—", dst: "—", srcPort: null, dstPort: null, info: "Unrecognized frame" };
  if (detailed) { packet.details = {}; packet.layers = [{ name: "Frame", summary: `${bytes.length} bytes captured`, start: 0, length: bytes.length, fields: [{ name: "Frame number", value: number, start: 0, length: bytes.length }, { name: "Arrival time", value: new Date(timestamp * 1000).toISOString(), start: 0, length: bytes.length }, { name: "Captured length", value: `${bytes.length} bytes`, start: 0, length: bytes.length }] }]; }
  if (previewLength) packet.rawPreview = bytes.slice(0, previewLength);
  let offset = 0;
  let etherType;
  if (linkType === 1 && bytes.length >= 14) {
    packet.dstMac = bytesToHex(bytes.subarray(0, 6)).replaceAll(" ", ":");
    packet.srcMac = bytesToHex(bytes.subarray(6, 12)).replaceAll(" ", ":");
    etherType = view.getUint16(12); offset = 14;
    while ([0x8100, 0x88a8].includes(etherType) && offset + 4 <= bytes.length) { packet.vlan = view.getUint16(offset) & 0xfff; etherType = view.getUint16(offset + 2); offset += 4; }
    if (detailed) packet.layers.push({ name: "Ethernet II", summary: `${packet.srcMac} → ${packet.dstMac}`, start: 0, length: offset, fields: [{ name: "Destination", value: packet.dstMac, start: 0, length: 6 }, { name: "Source", value: packet.srcMac, start: 6, length: 6 }, { name: "Type", value: `0x${etherType.toString(16).padStart(4, "0")}`, start: offset - 2, length: 2 }] });
  } else if (linkType === 101) {
    etherType = (bytes[0] >> 4) === 6 ? 0x86dd : 0x0800;
  } else if ((linkType === 113 || linkType === 276) && bytes.length >= (linkType === 276 ? 20 : 16)) {
    offset = linkType === 276 ? 20 : 16;
    etherType = view.getUint16(linkType === 276 ? 0 : 14);
    if (detailed) packet.layers.push({ name: "Linux cooked capture", summary: `Protocol 0x${etherType.toString(16).padStart(4, "0")}`, start: 0, length: offset });
  } else {
    packet.info = `Unsupported link type ${linkType}`;
    return packet;
  }

  if (etherType === 0x0806 && offset + 28 <= bytes.length) {
    packet.protocol = "ARP"; packet.src = ipv4(bytes, offset + 14); packet.dst = ipv4(bytes, offset + 24);
    packet.info = `${view.getUint16(offset + 6) === 1 ? "Who has" : "Reply"} ${packet.dst}`;
    if (detailed) packet.layers.push({ name: "Address Resolution Protocol", summary: packet.info, start: offset, length: 28 });
    return packet;
  }

  let nextHeader;
  if (etherType === 0x0800 && offset + 20 <= bytes.length) {
    const networkStart = offset;
    const headerLength = (bytes[offset] & 0x0f) * 4;
    const version = (bytes[offset] >> 4) & 0x0f;
    const tos = bytes[offset + 1];
    const totalLength = view.getUint16(offset + 2);
    const identification = view.getUint16(offset + 4);
    const flagsFragment = view.getUint16(offset + 6);
    const ttl = bytes[offset + 8];
    const protocol = bytes[offset + 9];
    const headerChecksum = view.getUint16(offset + 10);
    nextHeader = protocol; packet.src = ipv4(bytes, offset + 12); packet.dst = ipv4(bytes, offset + 16);
    if (detailed) packet.details.IP = `IPv4 · TTL ${ttl}`; offset += headerLength;
    if (detailed) packet.layers.push({
      name: "Internet Protocol Version 4",
      summary: `${packet.src} → ${packet.dst}`,
      start: networkStart,
      length: headerLength,
      fields: [
        { name: "Version", value: version, start: networkStart, length: 1 },
        { name: "Header length", value: `${headerLength} bytes`, start: networkStart, length: 1 },
        { name: "Type of service", value: tos, start: networkStart + 1, length: 1 },
        { name: "Total length", value: totalLength, start: networkStart + 2, length: 2 },
        { name: "Identification", value: identification, start: networkStart + 4, length: 2 },
        { name: "Flags / fragment offset", value: flagsFragment, start: networkStart + 6, length: 2 },
        { name: "TTL", value: ttl, start: networkStart + 8, length: 1 },
        { name: "Protocol", value: protocol, start: networkStart + 9, length: 1 },
        { name: "Header checksum", value: headerChecksum, start: networkStart + 10, length: 2 },
        { name: "Source", value: packet.src, start: networkStart + 12, length: 4 },
        { name: "Destination", value: packet.dst, start: networkStart + 16, length: 4 }
      ]
    });
  } else if (etherType === 0x86dd && offset + 40 <= bytes.length) {
    const networkStart = offset;
    nextHeader = bytes[offset + 6]; packet.src = ipv6(view, offset + 8); packet.dst = ipv6(view, offset + 24);
    if (detailed) packet.details.IP = `IPv6 · Hop limit ${bytes[offset + 7]}`; offset += 40;
    while ([0, 43, 60].includes(nextHeader) && offset + 8 <= bytes.length) { const previous = nextHeader; nextHeader = bytes[offset]; offset += (bytes[offset + 1] + 1) * 8; if (detailed) packet.details.Extension = previous; }
    if (detailed) packet.layers.push({ name: "Internet Protocol Version 6", summary: `${packet.src} → ${packet.dst}`, start: networkStart, length: offset - networkStart, fields: [{ name: "Next header", value: nextHeader, start: networkStart + 6, length: 1 }, { name: "Hop limit", value: bytes[networkStart + 7], start: networkStart + 7, length: 1 }, { name: "Source", value: packet.src, start: networkStart + 8, length: 16 }, { name: "Destination", value: packet.dst, start: networkStart + 24, length: 16 }] });
  } else {
    packet.protocol = `EtherType 0x${(etherType || 0).toString(16)}`; packet.info = "Link-layer frame";
    return packet;
  }

  if (nextHeader === 6 && offset + 20 <= bytes.length) {
    const transportStart = offset;
    packet.transport = "TCP"; packet.srcPort = view.getUint16(offset); packet.dstPort = view.getUint16(offset + 2);
    packet.seq = view.getUint32(offset + 4); packet.ack = view.getUint32(offset + 8);
    const dataOffset = (bytes[offset + 12] >> 4) * 4;
    const reserved = bytes[offset + 12] & 0x0f;
    const headerLength = dataOffset;
    packet.tcpFlagsValue = bytes[offset + 13];
    packet.tcpWindow = view.getUint16(offset + 14);
    packet.tcpChecksum = view.getUint16(offset + 16);
    packet.tcpUrgent = view.getUint16(offset + 18);
    packet.payloadLength = Math.max(0, bytes.length - offset - headerLength);
    packet.flags = Object.entries(TCP_FLAGS).filter(([flag]) => packet.tcpFlagsValue & Number(flag)).map(([, name]) => name);
    packet.protocol = "TCP"; packet.info = `${packet.srcPort} → ${packet.dstPort} [${packet.flags.join(", ") || "None"}] Seq=${packet.seq} Ack=${packet.ack}`;
    if (detailed) { packet.details.TCP = `${packet.srcPort} → ${packet.dstPort}`; packet.details.Flags = packet.flags.join(", ") || "None"; }
    if (detailed) packet.layers.push({ name: "Transmission Control Protocol", summary: `${packet.srcPort} → ${packet.dstPort} [${packet.flags.join(", ") || "None"}]`, start: transportStart, length: headerLength, fields: [{ name: "Source port", value: packet.srcPort, start: transportStart, length: 2 }, { name: "Destination port", value: packet.dstPort, start: transportStart + 2, length: 2 }, { name: "Sequence number", value: packet.seq, start: transportStart + 4, length: 4 }, { name: "Acknowledgment number", value: packet.ack, start: transportStart + 8, length: 4 }, { name: "Data offset", value: dataOffset, start: transportStart + 12, length: 1 }, { name: "Reserved", value: reserved, start: transportStart + 12, length: 1 }, { name: "Flags", value: packet.flags.join(", ") || "None", start: transportStart + 13, length: 1 }, { name: "Window", value: packet.tcpWindow, start: transportStart + 14, length: 2 }, { name: "Checksum", value: packet.tcpChecksum, start: transportStart + 16, length: 2 }, { name: "Urgent pointer", value: packet.tcpUrgent, start: transportStart + 18, length: 2 }] });
    const applicationOffset = offset + headerLength;
    const application = parseApplication(packet, bytes, view, applicationOffset);
    if (application) { const baseDetails = packet.details; Object.assign(packet, application); if (detailed) packet.details = { ...baseDetails, ...application.details }; else delete packet.details; }
    if (application && applicationOffset < bytes.length && detailed) packet.layers.push({ name: application.protocol, summary: application.info, start: applicationOffset, length: bytes.length - applicationOffset, fields: Object.entries(application.details || {}).map(([name, value]) => ({ name, value, start: applicationOffset, length: bytes.length - applicationOffset })) });
  } else if (nextHeader === 17 && offset + 8 <= bytes.length) {
    const transportStart = offset;
    packet.transport = "UDP"; packet.srcPort = view.getUint16(offset); packet.dstPort = view.getUint16(offset + 2);
    packet.protocol = "UDP"; packet.info = `${packet.srcPort} → ${packet.dstPort} Length=${view.getUint16(offset + 4)}`;
    packet.payloadLength = Math.max(0, view.getUint16(offset + 4) - 8);
    if (detailed) packet.details.UDP = `${packet.srcPort} → ${packet.dstPort}`;
    if (detailed) packet.layers.push({ name: "User Datagram Protocol", summary: `${packet.srcPort} → ${packet.dstPort}`, start: transportStart, length: 8, fields: [{ name: "Source port", value: packet.srcPort, start: transportStart, length: 2 }, { name: "Destination port", value: packet.dstPort, start: transportStart + 2, length: 2 }, { name: "Length", value: view.getUint16(transportStart + 4), start: transportStart + 4, length: 2 }] });
    const applicationOffset = offset + 8;
    const application = parseApplication(packet, bytes, view, applicationOffset);
    if (application) { const baseDetails = packet.details; Object.assign(packet, application); if (detailed) packet.details = { ...baseDetails, ...application.details }; else delete packet.details; }
    if (application && applicationOffset < bytes.length && detailed) packet.layers.push({ name: application.protocol, summary: application.info, start: applicationOffset, length: bytes.length - applicationOffset, fields: Object.entries(application.details || {}).map(([name, value]) => ({ name, value, start: applicationOffset, length: bytes.length - applicationOffset })) });
  } else if ([1, 58].includes(nextHeader)) {
    packet.protocol = nextHeader === 1 ? "ICMP" : "ICMPv6"; packet.info = `Type ${bytes[offset]}, code ${bytes[offset + 1]}`;
    if (detailed) packet.layers.push({ name: packet.protocol, summary: packet.info, start: offset, length: bytes.length - offset, fields: [{ name: "Type", value: bytes[offset], start: offset, length: 1 }, { name: "Code", value: bytes[offset + 1], start: offset + 1, length: 1 }] });
  } else {
    packet.protocol = `IP protocol ${nextHeader}`; packet.info = "Network-layer payload";
  }
  return packet;
}

function compactPacket(packet) {
  delete packet.layers;
  delete packet.details;
  return packet;
}

function parsePcap(buffer, options = {}) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  if (bytes.length < 24) throw new Error("Capture is too small to contain a valid header.");
  const signature = bytesToHex(bytes.subarray(0, 4));
  let littleEndian; let nanoseconds = false;
  if (signature === "d4 c3 b2 a1") littleEndian = true;
  else if (signature === "a1 b2 c3 d4") littleEndian = false;
  else if (signature === "4d 3c b2 a1") { littleEndian = true; nanoseconds = true; }
  else if (signature === "a1 b2 3c 4d") { littleEndian = false; nanoseconds = true; }
  else throw new Error("Not a classic PCAP capture.");
  const linkType = view.getUint32(20, littleEndian);
  const packets = [];
  let offset = 24;
  while (offset + 16 <= bytes.length) {
    const seconds = view.getUint32(offset, littleEndian);
    const fraction = view.getUint32(offset + 4, littleEndian);
    const capturedLength = view.getUint32(offset + 8, littleEndian);
    if (!Number.isFinite(capturedLength) || capturedLength < 0 || capturedLength > bytes.length - offset - 16) break;
    const timestamp = seconds + fraction / (nanoseconds ? 1e9 : 1e6);
    if (packets.length >= options.maxPackets) throw new Error(`Packet limit exceeded (${options.maxPackets.toLocaleString()}). Increase it in Settings.`);
    const packet = parseFrame(bytes.subarray(offset + 16, offset + 16 + capturedLength), packets.length + 1, timestamp, linkType, { captureOffset: offset + 16, rawPreviewBytes: options.retainPreviews ? options.rawPreviewBytes : 0, detailed: !options.compact });
    packets.push(options.compact ? compactPacket(packet) : packet);
    if (options.onProgress && packets.length % 10000 === 0) options.onProgress(packets.length);
    const nextOffset = offset + 16 + capturedLength; if (nextOffset <= offset) break; offset = nextOffset;
  }
  return packets;
}

function parsePcapng(buffer, options = {}) {
  const bytes = new Uint8Array(buffer);
  const view = new DataView(buffer);
  const packets = [];
  const interfaces = [];
  let offset = 0; let littleEndian = true; let iterations = 0;
  while (offset + 12 <= bytes.length) {
    iterations += 1;
    if (iterations > 1000000) {
      debugLog("parsePcapng:loopGuard", { offset, bytes: bytes.length, pendingBlocks: bytes.length - offset });
      break;
    }
    const rawType = view.getUint32(offset, true);
    if (rawType === 0x0a0d0d0a) {
      if (offset + 12 > bytes.length) break;
      const bom = bytesToHex(bytes.subarray(offset + 8, offset + 12));
      littleEndian = bom === "4d 3c 2b 1a";
      if (!littleEndian && bom !== "1a 2b 3c 4d") throw new Error("Invalid PCAPNG byte-order marker.");
      interfaces.length = 0;
    }
    const type = view.getUint32(offset, littleEndian);
    const length = view.getUint32(offset + 4, littleEndian);
    if (!Number.isFinite(length) || length < 12 || offset + length > bytes.length) break;
    if (type === 1 && length >= 20) {
      const iface = { linkType: view.getUint16(offset + 8, littleEndian), resolution: 1e-6 };
      let option = offset + 16;
      while (option + 4 <= offset + length - 4) {
        const code = view.getUint16(option, littleEndian); const size = view.getUint16(option + 2, littleEndian);
        if (code === 0) break;
        if (code === 9 && size >= 1) iface.resolution = bytes[option + 4] & 0x80 ? 2 ** -(bytes[option + 4] & 0x7f) : 10 ** -bytes[option + 4];
        option += 4 + Math.ceil(size / 4) * 4;
      }
      interfaces.push(iface);
    } else if (type === 6 && length >= 32) {
      const interfaceId = view.getUint32(offset + 8, littleEndian);
      const iface = interfaces[interfaceId] || { linkType: 1, resolution: 1e-6 };
      const high = view.getUint32(offset + 12, littleEndian); const low = view.getUint32(offset + 16, littleEndian);
      const capturedLength = view.getUint32(offset + 20, littleEndian);
      const packetStart = offset + 28;
      if (packetStart + capturedLength <= offset + length) {
        const timestamp = (high * 4294967296 + low) * iface.resolution;
        if (packets.length >= options.maxPackets) throw new Error(`Packet limit exceeded (${options.maxPackets.toLocaleString()}). Increase it in Settings.`);
        const packet = parseFrame(bytes.subarray(packetStart, packetStart + capturedLength), packets.length + 1, timestamp, iface.linkType, { captureOffset: packetStart, rawPreviewBytes: options.retainPreviews ? options.rawPreviewBytes : 0, detailed: !options.compact });
        packets.push(options.compact ? compactPacket(packet) : packet);
        if (options.onProgress && packets.length % 10000 === 0) options.onProgress(packets.length);
      }
    } else if (type === 3 && length >= 16) {
      const capturedLength = length - 16;
      if (packets.length >= options.maxPackets) throw new Error(`Packet limit exceeded (${options.maxPackets.toLocaleString()}). Increase it in Settings.`);
      const packet = parseFrame(bytes.subarray(offset + 12, offset + 12 + capturedLength), packets.length + 1, packets.length, interfaces[0]?.linkType || 1, { captureOffset: offset + 12, rawPreviewBytes: options.retainPreviews ? options.rawPreviewBytes : 0, detailed: !options.compact });
      packets.push(options.compact ? compactPacket(packet) : packet);
      if (options.onProgress && packets.length % 10000 === 0) options.onProgress(packets.length);
    }
    const previousOffset = offset;
    const nextOffset = offset + length;
    if (nextOffset <= previousOffset) break;
    offset = nextOffset;
  }
  return packets;
}

function countCapturePackets(buffer, stopAfter = Infinity) {
  const bytes = new Uint8Array(buffer); const view = new DataView(buffer);
  if (bytes.length < 24) return 0;
  const pcapng = bytesToHex(bytes.subarray(0, 4)) === "0a 0d 0d 0a";
  let count = 0; let offset = pcapng ? 0 : 24; let littleEndian = true; let iterations = 0;
  if (!pcapng) {
    const signature = bytesToHex(bytes.subarray(0, 4));
    littleEndian = signature === "d4 c3 b2 a1" || signature === "4d 3c b2 a1";
    while (offset + 16 <= bytes.length) {
      iterations += 1;
      if (iterations > 1000000) break;
      const capturedLength = view.getUint32(offset + 8, littleEndian);
      if (!Number.isFinite(capturedLength) || capturedLength < 0 || capturedLength > bytes.length - offset - 16) break;
      count++; if (count > stopAfter) return count; const nextOffset = offset + 16 + capturedLength; if (nextOffset <= offset) break; offset = nextOffset;
    }
    return count;
  }
  while (offset + 12 <= bytes.length) {
    iterations += 1;
    if (iterations > 1000000) break;
    if (view.getUint32(offset, true) === 0x0a0d0d0a) littleEndian = bytesToHex(bytes.subarray(offset + 8, offset + 12)) === "4d 3c 2b 1a";
    const type = view.getUint32(offset, littleEndian); const length = view.getUint32(offset + 4, littleEndian);
    if (!Number.isFinite(length) || length < 12 || offset + length > bytes.length) break;
    if (type === 6 || type === 3) { count++; if (count > stopAfter) return count; }
    const nextOffset = offset + length; if (nextOffset <= offset) break; offset = nextOffset;
  }
  return count;
}

function parseCapture(buffer, options = {}) {
  const signature = bytesToHex(new Uint8Array(buffer, 0, Math.min(4, buffer.byteLength)));
  const maxPackets = options.maxPackets || DEFAULT_SETTINGS.maxPackets;
  const packetCount = countCapturePackets(buffer, maxPackets);
  if (packetCount > maxPackets) throw new Error(`Packet limit exceeded (${maxPackets.toLocaleString()}). Increase it in Settings.`);
  const compactThreshold = Number.isFinite(options.compactThreshold) ? options.compactThreshold : COMPACT_PACKET_THRESHOLD;
  const parseOptions = { ...options, maxPackets, compact: packetCount > compactThreshold };
  const packets = signature === "0a 0d 0d 0a" ? parsePcapng(buffer, parseOptions) : parsePcap(buffer, parseOptions);
  correlateHttpConversations(packets);
  packets.compact = parseOptions.compact;
  return packets;
}

function correlateHttpConversations(packets) {
  const requests = new Map();
  const http2Streams = new Map();
  for (const packet of packets) {
    if (packet.protocol === "HTTP/2" && Number.isFinite(packet.httpStream) && packet.transport === "TCP") {
      const endpoints = [endpoint(packet, true), endpoint(packet, false)].sort();
      const streamKey = `${endpoints[0]}|${endpoints[1]}|${packet.httpStream}`;
      const pending = http2Streams.get(streamKey);
      if (!pending) {
        http2Streams.set(streamKey, packet);
      } else if (endpoint(pending, true) !== endpoint(packet, true)) {
        linkHttpConversation(pending, packet);
        http2Streams.delete(streamKey);
      }
      continue;
    }
    if (packet.protocol !== "HTTP" || !packet.httpKind || packet.transport !== "TCP") continue;
    const endpoints = [endpoint(packet, true), endpoint(packet, false)].sort();
    const conversation = `${endpoints[0]}|${endpoints[1]}`;
    if (packet.httpKind === "request") {
      const queue = requests.get(conversation) || [];
      queue.push(packet);
      requests.set(conversation, queue);
      continue;
    }
    const queue = requests.get(conversation);
    const request = queue?.shift();
    if (!request) {
      addHttpCalculatedField(packet, "Request in frame", "[Request packet missing from trace]");
      continue;
    }
    linkHttpConversation(request, packet);
  }
  for (const queue of requests.values()) {
    for (const request of queue) addHttpCalculatedField(request, "Response in frame", "[Response packet missing from trace]");
  }
  for (const request of http2Streams.values()) addHttpCalculatedField(request, "Response in frame", "[Response packet missing from trace]");
  return packets;
}

function addHttpCalculatedField(packet, name, value, linkFrame = null) {
  if (packet.details) packet.details[name] = value;
  const layer = packet.layers?.find(item => item.name === "HTTP" || item.name === "HTTP/2");
  if (layer && !layer.fields.some(field => field.name === name)) layer.fields.push({ name, value, ...(linkFrame ? { linkFrame } : {}), start: layer.start, length: layer.length });
}

function linkHttpConversation(request, response) {
  request.httpResponseFrame = response.number;
  response.httpRequestFrame = request.number;
  addHttpCalculatedField(request, "Response in frame", `[Response in frame: ${response.number}]`, response.number);
  addHttpCalculatedField(response, "Request in frame", `[Request in frame: ${request.number}]`, request.number);
}

function endpoint(packet, source) {
  const address = source ? packet.src : packet.dst;
  const port = source ? packet.srcPort : packet.dstPort;
  return `${address}${port !== null ? `:${port}` : ""}`;
}

function aggregate(packets) {
  const flows = new Map();
  const syns = new Map();
  const dnsRequests = new Map();
  const latencySamples = [];
  const latencyEvents = [];
  for (const packet of packets) {
    const left = endpoint(packet, true); const right = endpoint(packet, false);
    const ordered = [left, right].sort();
    const key = `${packet.transport || packet.protocol}|${ordered[0]}|${ordered[1]}`;
    if (!flows.has(key)) flows.set(key, { key, a: ordered[0], b: ordered[1], protocol: packet.protocol, transport: packet.transport, packets: 0, bytes: 0, packetsA: 0, packetsB: 0, bytesA: 0, bytesB: 0, first: packet.timestamp, last: packet.timestamp, latency: [], resets: 0, retransmissions: 0, duplicateAcks: 0, zeroWindows: 0, syns: 0, synAcks: 0, fins: 0, maxGap: 0, packetRefs: [], packetData: [], seenSeq: new Set(), seenAcks: new Set(), lastDirectionTime: new Map(), quicVersions: new Set() });
    const flow = flows.get(key);
    flow.packets++; flow.bytes += packet.length; flow.last = packet.timestamp;
    const fromA = left === flow.a;
    flow[fromA ? "packetsA" : "packetsB"]++; flow[fromA ? "bytesA" : "bytesB"] += packet.length;
    if (flow.packetRefs.length < 50) flow.packetRefs.push(packet.number);
    packet.fromA = fromA;
    if (flow.packetData.length < 2000) flow.packetData.push(packet);
    if (!["TCP", "UDP"].includes(packet.protocol)) flow.protocol = packet.protocol;
    const flags = packet.flags || [];
    if (packet.tcpFlagsValue & 0x04) flow.resets++;
    if (flags.includes("SYN") && !flags.includes("ACK")) flow.syns++;
    if (flags.includes("SYN") && flags.includes("ACK")) flow.synAcks++;
    if (flags.includes("FIN")) flow.fins++;
    if (packet.transport === "TCP" && packet.tcpWindow === 0 && !flags.includes("RST")) flow.zeroWindows++;
    if (packet.transport === "TCP" && packet.seq !== undefined && !flags.includes("SYN")) {
      const sequenceKey = `${left}:${packet.seq}`;
      if (packet.payloadLength > 0 && flow.seenSeq.has(sequenceKey)) flow.retransmissions++;
      flow.seenSeq.add(sequenceKey);
      if (packet.payloadLength === 0 && packet.flags?.includes("ACK")) {
        const ackKey = `${left}:${packet.ack}`;
        if (flow.seenAcks.has(ackKey)) flow.duplicateAcks++;
        flow.seenAcks.add(ackKey);
      }
    }
    if (packet.transport === "UDP") { const direction = fromA ? "a" : "b"; const previous = flow.lastDirectionTime.get(direction); if (previous !== undefined) flow.maxGap = Math.max(flow.maxGap, packet.timestamp - previous); flow.lastDirectionTime.set(direction, packet.timestamp); }
    if (packet.protocol === "QUIC" && (packet.quicVersion || packet.details?.Version)) flow.quicVersions.add(packet.quicVersion || packet.details.Version);
    if (flags.includes("SYN") && !flags.includes("ACK")) syns.set(`${left}>${right}`, { timestamp: packet.timestamp, flow });
    if (flags.includes("SYN") && flags.includes("ACK")) {
      const request = syns.get(`${right}>${left}`);
      if (request) { const ms = (packet.timestamp - request.timestamp) * 1000; if (ms >= 0 && ms < 60000) { request.flow.latency.push(ms); latencySamples.push(ms); latencyEvents.push({ timestamp: packet.timestamp, value: ms, type: "TCP", packet: packet.number, flow: request.flow.key }); packet.latency = ms; } }
    }
    if (packet.protocol === "DNS") {
      const dnsKey = `${packet.dnsId}|${packet.dnsResponse ? right : left}|${packet.dnsResponse ? left : right}`;
      if (!packet.dnsResponse) dnsRequests.set(dnsKey, { timestamp: packet.timestamp, flow });
      else if (dnsRequests.has(dnsKey)) { const request = dnsRequests.get(dnsKey); const ms = (packet.timestamp - request.timestamp) * 1000; if (ms >= 0) { request.flow.latency.push(ms); latencySamples.push(ms); latencyEvents.push({ timestamp: packet.timestamp, value: ms, type: "DNS", packet: packet.number, flow: request.flow.key }); packet.latency = ms; } }
    }
  }
  for (const flow of flows.values()) {
    flow.latencyValue = median(flow.latency);
    flow.duration = Math.max(0, flow.last - flow.first);
    flow.throughput = flow.bytes * 8 / Math.max(flow.duration, .001);
    flow.state = flow.resets ? "Reset" : flow.transport === "TCP" ? flow.syns && !flow.synAcks ? "Handshake failed" : flow.fins ? "Closed" : "Observed" : "Datagram";
    flow.quicVersions = [...flow.quicVersions];
    delete flow.seenSeq; delete flow.seenAcks; delete flow.lastDirectionTime;
  }
  return { flows: [...flows.values()].sort((a, b) => b.bytes - a.bytes), latencySamples, latencyEvents };
}

function createDemo() {
  const specs = [
    [0, "10.14.2.18", "1.1.1.1", "DNS", 78, "Query A api.northstar.dev"], [0.018, "1.1.1.1", "10.14.2.18", "DNS", 126, "Response A api.northstar.dev"],
    [.04, "10.14.2.18", "104.18.32.47", "TCP", 74, "52114 → 443 [SYN]"], [.071, "104.18.32.47", "10.14.2.18", "TCP", 74, "443 → 52114 [SYN, ACK]"],
    [.08, "10.14.2.18", "104.18.32.47", "TLS", 517, "Client Hello, TLS 1.3 → api.northstar.dev"], [.113, "104.18.32.47", "10.14.2.18", "TLS", 1420, "Server Hello, TLS 1.3"],
    [.16, "10.14.2.18", "104.18.32.47", "HTTP/2", 384, "HEADERS stream=1 length=375"], [.205, "104.18.32.47", "10.14.2.18", "HTTP/2", 5900, "DATA stream=1 length=5891"],
    [.27, "10.14.2.18", "142.250.72.206", "QUIC", 1250, "Initial v1 DCID=a81f9e38d272"], [.289, "142.250.72.206", "10.14.2.18", "QUIC", 1250, "Handshake v1 DCID=45a18c94d820"],
    [.34, "10.14.2.18", "10.14.2.40", "SMB2", 182, "NEGOTIATE"], [.342, "10.14.2.40", "10.14.2.18", "SMB2", 330, "NEGOTIATE Response"],
    [.38, "10.14.2.18", "10.14.2.40", "SMB2", 271, "SESSION_SETUP"], [.401, "10.14.2.40", "10.14.2.18", "SMB2", 422, "SESSION_SETUP Response"],
    [.43, "10.14.2.18", "10.14.2.40", "DCE/RPC", 228, "Request v5 op=15 call=388"], [.448, "10.14.2.40", "10.14.2.18", "DCE/RPC", 196, "Response v5 op=15 call=388"],
    [.52, "10.14.2.18", "93.184.216.34", "HTTP", 284, "GET /status HTTP/1.1 · example.net"], [.565, "93.184.216.34", "10.14.2.18", "HTTP", 780, "HTTP/1.1 200 OK"],
    [.7, "10.14.2.18", "10.14.2.40", "SMB2", 1514, "READ Response"], [.76, "10.14.2.18", "10.14.2.55", "TDS", 244, "SQL batch · SELECT status, latency FROM telemetry"],
    [.802, "10.14.2.55", "10.14.2.18", "TDS", 932, "Response · 932 bytes"], [.92, "142.250.72.206", "10.14.2.18", "QUIC", 1372, "Protected payload (short header)"]
  ];
  const base = Date.now() / 1000 - 1;
  const packets = specs.map((item, index) => {
    const transport = ["DNS", "QUIC"].includes(item[3]) ? "UDP" : "TCP";
    const servicePort = item[3] === "DNS" ? 53 : item[3] === "SMB2" ? 445 : item[3] === "DCE/RPC" ? 135 : item[3] === "HTTP" ? 80 : item[3] === "TDS" ? 1433 : 443;
    const describedPorts = transport === "TCP" ? item[5].match(/^(\d+)\s*→\s*(\d+)/) : null;
    const sourcePort = describedPorts ? Number(describedPorts[1]) : item[1] === "10.14.2.18" ? 52000 + index : servicePort;
    const destinationPort = describedPorts ? Number(describedPorts[2]) : item[2] === "10.14.2.18" ? 52000 + index - 1 : servicePort;
    const transportLength = transport === "UDP" ? 8 : 20; const applicationStart = 34 + transportLength;
    const rawBytes = new Uint8Array(item[4]);
    rawBytes.forEach((_, byteIndex) => { rawBytes[byteIndex] = (byteIndex * 31 + index * 17) & 0xff; });
    rawBytes.set(new TextEncoder().encode(item[5]).subarray(0, Math.max(0, rawBytes.length - applicationStart)), applicationStart);
    const transportFields = [{ name: "Source port", value: sourcePort, start: 34, length: 2 }, { name: "Destination port", value: destinationPort, start: 36, length: 2 }];
    if (transport === "UDP") {
      transportFields.push({ name: "Length", value: Math.max(8, item[4] - 34), start: 38, length: 2 }, { name: "Checksum", value: 0x0000, start: 40, length: 2 });
    } else {
      transportFields.push({ name: "Sequence number", value: index * 1000, start: 38, length: 4 }, { name: "Acknowledgment number", value: index * 900, start: 42, length: 4 }, { name: "Data offset", value: 20, start: 48, length: 1 }, { name: "Flags", value: item[5].includes("SYN, ACK") ? "SYN, ACK" : item[5].includes("SYN") ? "SYN" : "ACK", start: 52, length: 1 }, { name: "Window", value: 65535, start: 48, length: 2 });
    }
    const applicationFields = item[3] === "DNS" ? [{ name: "Transaction ID", value: `0x${(index + 0x1000).toString(16).padStart(4, "0")}`, start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Flags", value: item[5].startsWith("Response") ? "0x8180" : "0x0100", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Question name", value: item[5].includes("api.northstar.dev") ? "api.northstar.dev" : "example.net", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Question type", value: "A", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Response code", value: 0, start: applicationStart, length: Math.max(0, item[4] - applicationStart) }] : item[3] === "HTTP" ? [{ name: "Request line", value: item[5].split(" · ")[0] || item[5], start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Host", value: /\b\w+\.\w+/.test(item[5]) ? item[5].match(/\b([A-Za-z0-9.-]+\.[A-Za-z]{2,})\b/)?.[1] || "example.net" : "example.net", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }] : item[3] === "HTTP/2" ? [{ name: "Type", value: "HEADERS", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Stream", value: 1, start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Length", value: 375, start: applicationStart, length: Math.max(0, item[4] - applicationStart) }] : item[3] === "QUIC" ? [{ name: "Version", value: "0x00000001", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Type", value: item[5].split(" ")[0], start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Destination CID", value: item[5].match(/DCID=([A-Za-z0-9]+)/)?.[1] || "example", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }] : item[3] === "TLS" ? [{ name: "Record type", value: "Handshake", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Version", value: "TLS 1.3", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "SNI", value: "api.northstar.dev", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }] : item[3].startsWith("SMB") ? [{ name: "Command", value: item[5].split(" ")[0], start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Status", value: item[5].includes("Response") ? "Success" : "No status", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }] : item[3] === "DCE/RPC" ? [{ name: "Packet type", value: item[5].startsWith("Response") ? "Response" : "Request", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Version", value: 5, start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Operation number", value: 15, start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Call ID", value: 388, start: applicationStart, length: Math.max(0, item[4] - applicationStart) }] : item[3] === "TDS" ? [{ name: "Type", value: item[5].startsWith("SQL") ? "SQL batch" : "Response", start: applicationStart, length: Math.max(0, item[4] - applicationStart) }, { name: "Length", value: item[4] - applicationStart, start: applicationStart, length: Math.max(0, item[4] - applicationStart) }] : [];
    if (item[3] === "HTTP") {
      const response = item[5].startsWith("HTTP/");
      const fieldLength = Math.max(0, item[4] - applicationStart);
      const addHttpField = (name, value) => applicationFields.push({ name, value, start: applicationStart, length: fieldLength });
      addHttpField("Request/response", response ? "Response" : "Request");
      addHttpField("HTTP version", "HTTP/1.1");
      if (response) {
        addHttpField("Status code", "200");
        addHttpField("Status phrase", "OK");
        addHttpField("Content type", "text/plain");
        addHttpField("Content length", "512");
        addHttpField("Server", "demo-httpd");
      } else {
        addHttpField("Request method", "GET");
        addHttpField("Request URI", "/status");
        addHttpField("Full request URI", "http://example.net/status");
        addHttpField("Host", "example.net");
        addHttpField("Connection", "Keep-Alive");
        addHttpField("Accept", "*/*");
        addHttpField("User-Agent", "Microsoft-CryptoAPI/10.0");
      }
    }
    const packetInfo = item[3] === "TCP" ? `${sourcePort} → ${destinationPort}${item[5].includes("[") ? ` ${item[5].slice(item[5].indexOf("["))}` : ""}` : item[5];
    const applicationLayer = { name: item[3], summary: packetInfo, start: applicationStart, length: Math.max(0, item[4] - applicationStart), fields: applicationFields };
    const layers = [
      { name: "Frame", summary: `${item[4]} bytes captured`, start: 0, length: item[4], fields: [{ name: "Frame number", value: index + 1, start: 0, length: item[4] }, { name: "Arrival time", value: new Date((base + item[0]) * 1000).toISOString(), start: 0, length: item[4] }] },
      { name: "Ethernet II", summary: "Synthetic demo link", start: 0, length: 14 },
      { name: "Internet Protocol Version 4", summary: `${item[1]} → ${item[2]}`, start: 14, length: 20, fields: [{ name: "Version", value: 4, start: 14, length: 1 }, { name: "Header length", value: "20 bytes", start: 14, length: 1 }, { name: "Type of service", value: 0, start: 15, length: 1 }, { name: "Total length", value: item[4], start: 16, length: 2 }, { name: "Identification", value: index * 17, start: 18, length: 2 }, { name: "Flags / fragment offset", value: 0, start: 20, length: 2 }, { name: "TTL", value: 64, start: 22, length: 1 }, { name: "Protocol", value: transport === "UDP" ? 17 : 6, start: 23, length: 1 }, { name: "Header checksum", value: 0, start: 24, length: 2 }, { name: "Source", value: item[1], start: 26, length: 4 }, { name: "Destination", value: item[2], start: 30, length: 4 }] },
      { name: transport === "UDP" ? "User Datagram Protocol" : "Transmission Control Protocol", summary: `${sourcePort} → ${destinationPort}`, start: 34, length: transportLength, fields: transportFields },
      applicationLayer
    ];
    return { number: index + 1, timestamp: base + item[0], src: item[1], dst: item[2], protocol: item[3], transport, srcPort: sourcePort, dstPort: destinationPort, length: item[4], payloadLength: Math.max(0, item[4] - applicationStart), tcpWindow: 65535, info: packetInfo, httpKind: item[3] === "HTTP" ? (item[5].startsWith("HTTP/") ? "response" : "request") : undefined, httpStream: item[3] === "HTTP/2" ? 1 : undefined, httpHost: item[3] === "HTTP" ? (item[5].match(/·\s*([^ ]+)$/)?.[1] || "") : undefined, tdsType: item[3] === "TDS" ? (item[5].startsWith("SQL") ? "SQL batch" : "Response") : undefined, flags: item[5].includes("SYN, ACK") ? ["SYN", "ACK"] : item[5].includes("SYN") ? ["SYN"] : ["ACK"], tcpFlagsValue: item[5].includes("SYN, ACK") ? 0x12 : item[5].includes("SYN") ? 0x02 : 0x10, seq: index * 1000, ack: index * 900, details: { Source: item[1], Destination: item[2], Protocol: item[3] }, rawBytes, layers, raw: bytesToHex(rawBytes, 256) };
  });
  correlateHttpConversations(packets);
  const demoRequest = packets.find(packet => packet.protocol === "HTTP" && packet.httpKind === "request");
  const demoResponse = packets.find(packet => packet.protocol === "HTTP" && packet.httpKind === "response");
  if (demoRequest && demoResponse && !demoRequest.httpResponseFrame) linkHttpConversation(demoRequest, demoResponse);
  return packets;
}

function buildTimeline(packets, buckets = 36) {
  if (!packets.length) return [];
  const start = packets[0].timestamp; const end = packets.at(-1).timestamp; const span = Math.max(end - start, .001);
  const local = packets[0].src;
  const values = Array.from({ length: buckets }, () => ({ inbound: 0, outbound: 0 }));
  for (const packet of packets) {
    const index = Math.min(buckets - 1, Math.floor(((packet.timestamp - start) / span) * buckets));
    values[index][packet.src === local ? "outbound" : "inbound"] += packet.length;
  }
  return values;
}

function setupCanvas(canvas) {
  const ratio = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = Math.max(1, rect.width * ratio); canvas.height = Math.max(1, rect.height * ratio);
  const context = canvas.getContext("2d"); context.scale(ratio, ratio);
  return { context, width: rect.width, height: rect.height };
}

function drawTimeline() {
  const canvas = $("#timelineCanvas"); const { context, width, height } = setupCanvas(canvas);
  const data = buildTimeline(state.filtered); const pad = { x: 42, top: 28, bottom: 30 }; const chartWidth = width - pad.x - 20; const chartHeight = height - pad.top - pad.bottom;
  const max = Math.max(1, ...data.flatMap(item => [item.inbound, item.outbound]));
  context.font = "9px DM Mono"; context.fillStyle = "#7a817a"; context.strokeStyle = "#dedbd2"; context.lineWidth = 1;
  for (let row = 0; row <= 4; row++) { const y = pad.top + chartHeight * row / 4; context.beginPath(); context.moveTo(pad.x, y); context.lineTo(width - 20, y); context.stroke(); context.fillText(formatBytes(max * (1 - row / 4)), 3, y + 3); }
  const draw = (field, color) => { context.beginPath(); data.forEach((item, index) => { const x = pad.x + chartWidth * index / Math.max(1, data.length - 1); const y = pad.top + chartHeight * (1 - item[field] / max); index ? context.lineTo(x, y) : context.moveTo(x, y); }); context.strokeStyle = color; context.lineWidth = 2; context.stroke(); };
  draw("inbound", COLORS[0]); draw("outbound", COLORS[1]);
  context.fillText("0s", pad.x, height - 9); context.fillText(`${state.duration.toFixed(2)}s`, width - 58, height - 9);
}

function drawDonut(protocols) {
  const canvas = $("#protocolCanvas"); const { context, width, height } = setupCanvas(canvas); const total = Object.values(protocols).reduce((sum, value) => sum + value, 0);
  let angle = -Math.PI / 2; const radius = Math.min(width, height) * .39;
  Object.entries(protocols).forEach(([, value], index) => { const next = angle + (value / total) * Math.PI * 2; context.beginPath(); context.arc(width / 2, height / 2, radius, angle, next); context.strokeStyle = COLORS[index % COLORS.length]; context.lineWidth = 24; context.stroke(); angle = next; });
}

function renderLargeCaptureMode(packets, aggregation) {
  debugLog("render:largeCaptureMode", { packets: packets.length, flows: aggregation.flows.length });
  if (typeof drawEmptyChart === "function") {
    [["#frameSizeCanvas", "Frame-size chart skipped for large compact captures"], ["#latencyCanvas", "Latency scatterplot skipped for large compact captures"]].forEach(([selector, message]) => {
      const canvas = $(selector); const { context, width, height } = setupCanvas(canvas); drawEmptyChart(context, width, height, message);
    });
  }
  if (typeof drawTopology === "function") drawTopology(aggregation.flows.slice(0, 250));
  if (typeof renderFlowExplorer === "function") renderFlowExplorer(aggregation.flows);
  if (typeof renderFlowDetail === "function") renderFlowDetail(aggregation.flows.slice(0, 250));
  ["#latencyP50", "#latencyP95", "#latencyP99", "#latencyJitter"].forEach(selector => { const element = $(selector); if (element) element.textContent = "—"; });
  const note = `Large capture mode: ${packets.length.toLocaleString()} packets loaded with compact details. Top flows, topology, packet table, filters, CSV/JSON export, and capture-set workflows remain available.`;
  if ($("#transportDiagnostics")) $("#transportDiagnostics").innerHTML = `<div class="diagnostic"><span>Mode</span><strong>Large capture</strong><small>${escapeHtml(note)}</small></div>`;
  if ($("#serviceRows")) $("#serviceRows").innerHTML = `<tr><td colspan="5">Service decoding skipped for this large compact capture.</td></tr>`;
  if ($("#findingCount")) $("#findingCount").textContent = "large capture mode";
  if ($("#findingList")) $("#findingList").innerHTML = `<div class="finding"><span class="severity info">info</span><div><strong>Large capture loaded</strong><small>${escapeHtml(note)}</small></div></div>`;
  if ($("#comparisonContent")) { $("#comparisonContent").className = "comparison-empty"; $("#comparisonContent").textContent = "Baseline comparison is skipped for large compact captures."; }
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[char]);
}

function render() {
  const packets = state.filtered;
  debugLog("render:start", { packets: packets.length, compact: state.compactMode });
  const aggregation = aggregate(packets);
  state.flows = aggregation.flows;
  const bytes = packets.reduce((sum, packet) => sum + packet.length, 0);
  const endpoints = new Set(packets.flatMap(packet => [packet.src, packet.dst])).size;
  const protocols = packets.reduce((result, packet) => { result[packet.protocol] = (result[packet.protocol] || 0) + packet.length; return result; }, {});
  $("#kpiPackets").textContent = packets.length.toLocaleString();
  $("#kpiRate").textContent = `${(packets.length / Math.max(state.duration, .001)).toFixed(1)} pkt/s`;
  $("#kpiBytes").textContent = formatBytes(bytes); $("#kpiThroughput").textContent = formatRate(bytes * 8 / Math.max(state.duration, .001));
  $("#kpiFlows").textContent = aggregation.flows.length.toLocaleString(); $("#kpiEndpoints").textContent = `${endpoints} endpoints`;
  $("#kpiLatency").textContent = formatLatency(median(aggregation.latencySamples)); $("#kpiLatencySamples").textContent = `${aggregation.latencySamples.length} RTT / DNS samples`;
  $("#donutValue").textContent = Object.keys(protocols).length;
  $("#protocolLegend").innerHTML = Object.entries(protocols).sort((a, b) => b[1] - a[1]).slice(0, 8).map(([name, value], index) => `<div class="protocol-item"><i style="background:${COLORS[index % COLORS.length]}"></i><b>${escapeHtml(name)}</b><span>${Math.round(value / Math.max(bytes, 1) * 100)}%</span></div>`).join("");
  drawTimeline(); drawDonut(protocols);
  $("#flowRows").innerHTML = aggregation.flows.slice(0, 100).map(flow => `<tr data-flow="${encodeURIComponent(flow.key)}"><td class="endpoint-pair"><strong>${escapeHtml(flow.a)}</strong><small>↔ ${escapeHtml(flow.b)}</small></td><td><span class="badge">${escapeHtml(flow.protocol)}</span></td><td>${flow.packets}</td><td>${formatBytes(flow.bytes)}</td><td>${formatBytes(flow.bytesA)} ↔ ${formatBytes(flow.bytesB)}</td><td>${formatLatency(flow.latencyValue)}</td><td><span class="badge ${flow.resets || flow.state === "Handshake failed" ? "warn" : "good"}">${escapeHtml(flow.state)}</span></td></tr>`).join("") || `<tr><td colspan="7">No matching connections</td></tr>`;
  if (typeof renderFlowDetail === "function") renderFlowDetail(aggregation.flows);
  const retransmissions = aggregation.flows.reduce((sum, flow) => sum + flow.retransmissions, 0); const resets = aggregation.flows.reduce((sum, flow) => sum + flow.resets, 0); const quic = packets.filter(packet => packet.protocol === "QUIC").length; const smb = packets.filter(packet => packet.protocol.startsWith("SMB")).length;
  const insights = [
    [resets ? "!" : "✓", resets ? "TCP resets detected" : "No TCP resets", resets ? `${resets} reset packets may indicate refused or aborted sessions.` : "Observed TCP sessions ended without reset signals."],
    [retransmissions ? "↻" : "✓", `${retransmissions} possible retransmissions`, retransmissions ? "Repeated sequence numbers were observed; verify against TCP analysis in Wireshark." : "No duplicate TCP sequence numbers observed."],
    ["Q", `${quic} QUIC packets`, quic ? "HTTP/3-capable encrypted traffic is present." : "No recognizable QUIC headers in this view."],
    ["S", `${smb} SMB packets`, smb ? "File-sharing operations are represented in the capture." : "No SMB file-sharing traffic detected."]
  ];
  $("#insightList").innerHTML = insights.map(item => `<div class="insight"><span class="insight-icon">${item[0]}</span><div><strong>${item[1]}</strong><p>${item[2]}</p></div></div>`).join("");
  $("#packetRows").innerHTML = packets.slice(0, 1500).map(packet => `<tr data-packet="${packet.number}"><td>${packet.number}</td><td>${(packet.timestamp - state.baseTime).toFixed(6)}</td><td>${escapeHtml(packet.src)}</td><td>${escapeHtml(packet.dst)}</td><td><span class="badge">${escapeHtml(packet.protocol)}</span></td><td>${packet.length}</td><td>${escapeHtml(packet.info)}</td></tr>`).join("");
  $("#rowCount").textContent = `${Math.min(packets.length, 1500).toLocaleString()} of ${packets.length.toLocaleString()}`;
  if (state.compactMode && packets.length > LARGE_CAPTURE_FAST_PATH_PACKETS) renderLargeCaptureMode(packets, aggregation);
  else renderExpert(packets, aggregation);
  debugLog("render:complete", { packets: packets.length, flows: aggregation.flows.length, largeCaptureMode: state.compactMode && packets.length > LARGE_CAPTURE_FAST_PATH_PACKETS });
}

function captureFingerprint(packets, name) {
  const source = `${name}|${packets.length}|${packets[0]?.timestamp || 0}|${packets.at(-1)?.timestamp || 0}|${packets.reduce((sum, packet) => sum + packet.length, 0)}`;
  let hash = 2166136261;
  for (let index = 0; index < source.length; index++) { hash ^= source.charCodeAt(index); hash = Math.imul(hash, 16777619); }
  return `${name}:${(hash >>> 0).toString(16)}`;
}

function packetCaptureBytes(packet, captureBuffer = state.captureBuffer) {
  if (captureBuffer && packet.captureOffset >= 0 && packet.capturedLength >= 0 && packet.captureOffset + packet.capturedLength <= captureBuffer.byteLength) return new Uint8Array(captureBuffer, packet.captureOffset, packet.capturedLength);
  if (packet.rawPreview instanceof Uint8Array) return packet.rawPreview;
  if (Array.isArray(packet.rawPreview)) return Uint8Array.from(packet.rawPreview);
  if (packet.rawBytes instanceof Uint8Array) return packet.rawBytes;
  if (Array.isArray(packet.rawBytes)) return Uint8Array.from(packet.rawBytes);
  return new Uint8Array();
}

function loadPackets(packets, name, captureId = "") {
  debugLog("loadPackets:start", { name, packets: packets.length, compact: packets.compact === true });
  if (!packets.length) throw new Error("No packet records were found in this capture.");
  packets.sort((a, b) => a.timestamp - b.timestamp);
  state.packets = packets; state.filtered = packets; state.fileName = name; state.captureId = captureId || captureFingerprint(packets, name); state.captureBuffer = packets.captureBuffer || null; state.compactMode = packets.compact === true; state.baseTime = packets[0].timestamp; state.duration = Math.max(0, packets.at(-1).timestamp - packets[0].timestamp);
  const protocols = [...new Set(packets.map(packet => packet.protocol))].sort();
  $("#protocolFilter").innerHTML = `<option value="all">All protocols</option>${protocols.map(protocol => `<option value="${escapeHtml(protocol)}">${escapeHtml(protocol)}</option>`).join("")}`;
  $("#captureName").textContent = name; $("#captureMeta").textContent = `${packets.length.toLocaleString()} packets · ${state.duration.toFixed(3)} seconds · local analysis${state.compactMode ? " · compact model" : ""}`;
  $("#statusDot").classList.add("live"); $("#emptyState").hidden = true; $("#dashboard").hidden = false;
  if (typeof restoreProcessMapForCapture === "function") restoreProcessMapForCapture();
  const shouldDeferRender = packets.length > 25000 || packets.length > LARGE_CAPTURE_FAST_PATH_PACKETS;
  if (shouldDeferRender) {
    $("#captureMeta").textContent = `${packets.length.toLocaleString()} packets · summary building in the background · packet list will load when ready`;
    showToast(`Parsed ${name}; summary is building in the background.`);
    if (!state.backgroundRenderQueued) {
      state.backgroundRenderQueued = true;
      setTimeout(() => {
        state.backgroundRenderQueued = false;
        render();
        if (typeof refreshPacketWorkbench === "function") refreshPacketWorkbench();
        debugLog("loadPackets:complete", { name, packets: packets.length, compact: state.compactMode, flows: aggregate(state.filtered).flows.length, deferred: true });
      }, 0);
    }
    return;
  }
  render();
  if (typeof refreshPacketWorkbench === "function") refreshPacketWorkbench();
  debugLog("loadPackets:complete", { name, packets: packets.length, compact: state.compactMode, flows: aggregate(state.filtered).flows.length });
}

function applyFilters() {
  const query = $("#searchInput").value.trim().toLowerCase(); const protocol = $("#protocolFilter").value;
  state.filtered = state.packets.filter(packet => (protocol === "all" || packet.protocol === protocol) && (!query || `${packet.src} ${packet.dst} ${packet.protocol} ${packet.info}`.toLowerCase().includes(query)));
  render();
}

function showToast(message) {
  const toast = $("#toast"); toast.textContent = message; toast.classList.add("visible"); clearTimeout(showToast.timer); showToast.timer = setTimeout(() => toast.classList.remove("visible"), 3600);
}

function openCaptureCache() {
  return new Promise((resolve, reject) => {
    if (!globalThis.indexedDB) { resolve(null); return; }
    const request = indexedDB.open("datasnare-ainetscope", 1);
    request.onupgradeneeded = () => request.result.createObjectStore("captures");
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}

async function readCaptureCache(key) {
  if (!settings.cacheEnabled) return null;
  try {
    const database = await openCaptureCache(); if (!database) return null;
    return await new Promise(resolve => { const request = database.transaction("captures").objectStore("captures").get(key); request.onsuccess = () => resolve(request.result || null); request.onerror = () => resolve(null); });
  } catch (_) { return null; }
}

async function writeCaptureCache(key, packets) {
  if (!settings.cacheEnabled) return;
  try {
    const estimatedBytes = packets.length * (220 + settings.rawPreviewBytes);
    if (estimatedBytes > MAX_CACHE_BYTES) return;
    const database = await openCaptureCache(); if (!database) return;
    const transaction = database.transaction("captures", "readwrite");
    const cachedPackets = packets.map(packet => {
      const { layers, details, ...compact } = packet;
      const bytes = packetCaptureBytes(packet, packets.captureBuffer);
      if (bytes.length) compact.rawPreview = bytes.slice(0, settings.rawPreviewBytes);
      return compact;
    });
    transaction.objectStore("captures").put({ packets: cachedPackets, compact: true }, key);
  } catch (_) { /* Cache availability never blocks analysis. */ }
}

async function readFileStream(file, showProgress) {
  if (showProgress) $("#captureMeta").textContent = `Reading ${formatBytes(file.size)} · traffic remains local`;
  const chunkSize = 4 * 1024 * 1024;
  if (file.size <= chunkSize) return file.arrayBuffer();
  const output = new Uint8Array(file.size);
  let offset = 0;
  while (offset < file.size) {
    const next = Math.min(file.size, offset + chunkSize);
    const chunk = new Uint8Array(await file.slice(offset, next).arrayBuffer());
    output.set(chunk, offset);
    offset = next;
    if (showProgress) $("#captureMeta").textContent = `Reading ${formatBytes(offset)} of ${formatBytes(file.size)} · traffic remains local`;
    debugLog("parseFile:readProgress", { name: file.name, bytes: offset, total: file.size });
    await new Promise(resolve => setTimeout(resolve, 0));
  }
  return output.buffer;
}

function parseInWorker(buffer, showProgress, parseOptions = {}) {
  const compactThreshold = parseOptions.compactThreshold ?? (settings.compactMode ? undefined : Infinity);
  const fallbackParse = () => parseCapture(buffer, {
    maxPackets: settings.maxPackets,
    rawPreviewBytes: settings.rawPreviewBytes,
    compactThreshold,
    onProgress: count => {
      if (showProgress) $("#captureMeta").textContent = `Parsing ${count.toLocaleString()} packets · traffic remains local`;
    }
  });

  if (!globalThis.Worker) {
    debugLog("parseInWorker:fallback", { reason: "worker unavailable", bytes: buffer.byteLength });
    return Promise.resolve(fallbackParse());
  }

  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value, error = null) => {
      if (settled) return;
      settled = true;
      if (error) reject(error); else resolve(value);
    };
    const fallback = () => {
      debugLog("parseInWorker:fallback", { reason: "worker path failed", bytes: buffer.byteLength, compactThreshold });
      try {
        const result = fallbackParse();
        finish({ packets: result, compact: result.compact === true, buffer });
      } catch (error) {
        finish(null, error);
      }
    };

    try {
      const worker = new Worker("analysis-worker.js");
      const timeout = setTimeout(() => {
        try { worker.terminate(); } catch (_) { /* terminal state already cleaned up */ }
        fallback();
      }, 30000);

      worker.onmessage = event => {
        clearTimeout(timeout);
        if (event.data.type === "progress") {
          if (showProgress) $("#captureMeta").textContent = `Parsing ${event.data.packets.toLocaleString()} packets · traffic remains local`;
          return;
        }
        try { worker.terminate(); } catch (_) { /* worker may already be torn down */ }
        if (event.data.error) finish(null, new Error(event.data.error));
        else finish(event.data);
      };

      worker.onerror = event => {
        clearTimeout(timeout);
        try { worker.terminate(); } catch (_) { /* worker may already be torn down */ }
        debugLog("parseInWorker:error", { message: event.message || "Capture worker failed.", bytes: buffer.byteLength });
        fallback();
      };

      try {
        worker.postMessage({ buffer, settings: { maxPackets: settings.maxPackets, rawPreviewBytes: settings.rawPreviewBytes, compactThreshold } }, [buffer]);
      } catch (error) {
        clearTimeout(timeout);
        try { worker.terminate(); } catch (_) { /* noop */ }
        debugLog("parseInWorker:transferFailed", { message: error.message || String(error), bytes: buffer.byteLength });
        fallback();
      }
    } catch (error) {
      debugLog("parseInWorker:creationFailed", { message: error.message || String(error), bytes: buffer.byteLength });
      fallback();
    }
  });
}

async function parseFile(file, showProgress = true, parseOptions = {}) {
  const started = performance.now();
  debugLog("parseFile:start", { name: file?.name, size: file?.size, showProgress });
  const maxBytes = settings.maxCaptureMB * 1024 * 1024;
  if (file.size > maxBytes) throw new Error(`${file.name} is ${formatBytes(file.size)}; the configured capture limit is ${settings.maxCaptureMB} MiB.`);
  const key = `packet-model-v3:${settings.rawPreviewBytes}:${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`;
  const cached = await readCaptureCache(key);
  if (settings.compactMode && cached?.packets?.length) { cached.packets.compact = true; if (showProgress) showToast("Loaded cached compact analysis."); return cached.packets; }
  const buffer = await readFileStream(file, showProgress);
  debugLog("parseFile:read", { name: file.name, bytes: buffer.byteLength, elapsedMs: Math.round(performance.now() - started) });
  await new Promise(resolve => setTimeout(resolve, 0));
  let packets;
  const canUseWorker = Boolean(globalThis.Worker);
  const compactThreshold = parseOptions.compactThreshold ?? (settings.compactMode ? undefined : Infinity);
  if (file.size >= 2 * 1024 * 1024 && canUseWorker) {
    const result = await parseInWorker(buffer, showProgress, { compactThreshold });
    packets = result.packets; packets.compact = result.compact; packets.captureBuffer = result.buffer;
  } else {
    packets = parseCapture(buffer, { maxPackets: settings.maxPackets, rawPreviewBytes: settings.rawPreviewBytes, compactThreshold });
    packets.captureBuffer = buffer;
  }
  setTimeout(() => writeCaptureCache(key, packets), 0);
  debugLog("parseFile:complete", { name: file.name, packets: packets.length, compact: packets.compact === true, elapsedMs: Math.round(performance.now() - started) });
  return packets;
}

async function openFile(file) {
  if (!file) return;
  debugLog("openFile:start", { name: file.name, size: file.size });
  showToast(`Reading ${file.name}…`);
  try {
    const packets = await parseFile(file, true, { compactThreshold: SINGLE_CAPTURE_COMPACT_THRESHOLD });
    if (typeof showCoreMode === "function") showCoreMode();
    loadPackets(packets, file.name, `${file.webkitRelativePath || file.name}:${file.size}:${file.lastModified}`);
    const slowFileMessage = packets.length > 25000 ? "Parsed locally; the summary and packet workbench are loading in the background." : `Parsed ${file.name} locally.`;
    showToast(slowFileMessage);
    debugLog("openFile:complete", { name: file.name, packets: packets.length, deferredRender: packets.length > 25000 });
  } catch (error) {
    console.error(error);
    debugLog("openFile:error", { name: file.name, message: error.message });
    showToast(`Could not parse capture: ${error.message}`);
  }
}

function inspectPacket(number) {
  const packet = state.packets.find(item => item.number === number); if (!packet) return;
  const bytes = packetCaptureBytes(packet); const shown = bytes.subarray(0, settings.rawPreviewBytes); const truncated = shown.length < packet.length;
  $("#dialogTitle").textContent = `Frame ${packet.number}`;
  $("#openPacketWorkbenchButton").dataset.packetNumber = String(packet.number);
  const sections = { Frame: { "Arrival time": new Date(packet.timestamp * 1000).toISOString(), "Captured length": `${packet.length} bytes`, Protocol: packet.protocol }, Network: { Source: packet.src, Destination: packet.dst, ...packet.details }, Transport: { "Source port": packet.srcPort ?? "—", "Destination port": packet.dstPort ?? "—", Information: packet.info } };
  const hexRows = [];
  const asciiRows = [];
  for (let offset = 0; offset < shown.length; offset += 16) {
    const line = shown.subarray(offset, offset + 16);
    const ascii = Array.from(line, value => value >= 32 && value <= 126 ? String.fromCharCode(value) : ".").join("");
    hexRows.push(`<div class="hex-row"><span class="hex-offset">${offset.toString(16).padStart(4, "0")}</span><span>${escapeHtml(bytesToHex(line))}</span></div>`);
    asciiRows.push(`<div class="decoded-byte-row"><span>${escapeHtml(ascii)}</span></div>`);
  }
  const byteDecode = `<div class="byte-decode-grid"><div class="hex">${hexRows.join("") || "Bytes unavailable in this cached model."}</div><div class="byte-decodes">${asciiRows.join("") || "Character decode unavailable."}</div></div>${truncated ? `<p class="byte-preview-note">Preview truncated: ${Math.max(0, packet.length - shown.length).toLocaleString()} bytes not shown.</p>` : ""}`;
  $("#packetDetails").innerHTML = Object.entries(sections).map(([title, fields]) => `<section class="detail-section"><h3>${title}</h3>${Object.entries(fields).map(([key, value]) => `<div class="detail-row"><span>${escapeHtml(key)}</span><span>${escapeHtml(value)}</span></div>`).join("")}</section>`).join("") + `<section class="detail-section"><h3>Raw bytes and decodes${truncated ? " · preview truncated" : ""}</h3>${byteDecode}</section>`;
  $("#packetDialog").showModal();
}

function exportCsv() {
  const rows = [["Endpoint A", "Endpoint B", "Protocol", "Packets", "Bytes", "Latency ms", "State"], ...aggregate(state.filtered).flows.map(flow => [flow.a, flow.b, flow.protocol, flow.packets, flow.bytes, Number.isFinite(flow.latencyValue) ? flow.latencyValue.toFixed(3) : "", flow.state])];
  const csv = rows.map(row => row.map(value => `"${String(value).replaceAll('"', '""')}"`).join(",")).join("\r\n");
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([csv], { type: "text/csv" })); link.download = `${state.fileName || "capture"}-flows.csv`; link.click(); URL.revokeObjectURL(link.href);
}

function buildExportReport() {
  const aggregation = aggregate(state.filtered.length ? state.filtered : state.packets);
  return {
    schema: "datasnare-ainetscope/analysis-v1",
    generatedAt: new Date().toISOString(),
    tool: { name: "DataSnare-AINetScope", version: "1.0.0" },
    capture: {
      id: state.captureId,
      name: state.fileName || "capture",
      start: state.baseTime || null,
      duration: state.duration,
      packetCount: state.packets.length,
      filteredPacketCount: state.filtered.length,
      compactModel: state.compactMode
    },
    summary: {
      flows: aggregation.flows.length,
      protocols: Object.fromEntries([...new Set(state.packets.map(packet => packet.protocol))].sort().map(protocol => [protocol, state.packets.filter(packet => packet.protocol === protocol).length])),
      latencyP95: percentile(aggregation.latencySamples, .95)
    },
    flows: aggregation.flows.map(flow => ({
      key: flow.key,
      a: flow.a,
      b: flow.b,
      protocol: flow.protocol,
      transport: flow.transport,
      packets: flow.packets,
      bytes: flow.bytes,
      first: flow.first,
      last: flow.last,
      latencyValue: flow.latencyValue,
      state: flow.state,
      resets: flow.resets,
      retransmissions: flow.retransmissions,
      duplicateAcks: flow.duplicateAcks,
      zeroWindows: flow.zeroWindows,
      packetRefs: flow.packetRefs
    })),
    findings: aggregation.flows.filter(flow => flow.resets || flow.retransmissions || flow.zeroWindows || flow.state === "Handshake failed").map(flow => ({
      severity: flow.resets || flow.state === "Handshake failed" ? "warning" : "info",
      title: `${flow.protocol} ${flow.a} to ${flow.b}: ${flow.state}`,
      detail: `${flow.packets.toLocaleString()} packets, ${flow.bytes.toLocaleString()} bytes, ${flow.resets} resets, ${flow.retransmissions} retransmissions, ${flow.zeroWindows} zero-window packets.`,
      packet: flow.packetRefs[0] || null,
      flow: flow.key
    }))
  };
}

if (typeof document !== "undefined") {
  const returnTo = new URLSearchParams(window.location.search).get("returnTo");
  if (returnTo === "/aianalysis") $("#coreReturnLink").hidden = false;
  $("#settingsButton").addEventListener("click", () => {
    $("#maxCaptureMB").value = settings.maxCaptureMB; $("#maxPackets").value = settings.maxPackets; $("#rawPreviewBytes").value = settings.rawPreviewBytes; $("#compactMode").checked = settings.compactMode; $("#cacheEnabled").checked = settings.cacheEnabled; $("#debugLogEnabled").checked = settings.debugLogEnabled; $("#sansFont").value = settings.sansFont; $("#monoFont").value = settings.monoFont; $("#referenceLinks").value = settings.referenceLinks.map(link => `${link.label} | ${link.url}`).join("\n");
    $("#settingsDialog").showModal();
  });
  $("#closeSettingsDialog").addEventListener("click", () => $("#settingsDialog").close());
  $("#cancelSettingsButton").addEventListener("click", () => $("#settingsDialog").close());
  $("#saveSettingsButton").addEventListener("click", () => {
    const referenceLinks = $("#referenceLinks").value.split(/\r?\n/).map(line => line.trim()).filter(Boolean).map(line => { const separator = line.indexOf("|"); return separator > 0 ? { label: line.slice(0, separator).trim().slice(0, 80), url: line.slice(separator + 1).trim().slice(0, 500) } : null; }).filter(link => link?.label && /^(https?:|mailto:)/i.test(link.url));
    settings = { maxCaptureMB: Math.max(1, Number($("#maxCaptureMB").value) || DEFAULT_SETTINGS.maxCaptureMB), maxPackets: Math.max(1, Math.floor(Number($("#maxPackets").value) || DEFAULT_SETTINGS.maxPackets)), rawPreviewBytes: Math.max(0, Math.min(65535, Math.floor(Number($("#rawPreviewBytes").value) || 0))), compactMode: $("#compactMode").checked, cacheEnabled: $("#cacheEnabled").checked, debugLogEnabled: $("#debugLogEnabled").checked, sansFont: $("#sansFont").value.trim().slice(0, 160) || DEFAULT_SETTINGS.sansFont, monoFont: $("#monoFont").value.trim().slice(0, 160) || DEFAULT_SETTINGS.monoFont, referenceLinks: referenceLinks.length ? referenceLinks : [...DEFAULT_REFERENCE_LINKS] };
    document.documentElement.style.setProperty("--sans", settings.sansFont); document.documentElement.style.setProperty("--mono", settings.monoFont);
    toggleDebugLogPanel(settings.debugLogEnabled);
    localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); $("#settingsDialog").close(); showToast("Capture capacity settings saved.");
  });
  const captureInput = $("#captureInput");
  const captureLabel = document.querySelector("label[for='captureInput']");
  if (captureLabel) captureLabel.addEventListener("click", () => debugLog("capture label clicked"));
  captureInput.addEventListener("click", () => debugLog("capture input clicked"));
  captureInput.addEventListener("change", event => { const file = event.target.files[0]; debugLog("capture input changed", { files: event.target.files.length, name: file?.name || "" }); event.target.value = ""; openFile(file); });
  $("#demoButton").addEventListener("click", () => { if (typeof showCoreMode === "function") showCoreMode(); loadPackets(createDemo(), "demo-office-traffic.pcapng", "builtin-demo"); showToast("Demo trace loaded."); });
  $("#searchInput").addEventListener("input", applyFilters); $("#protocolFilter").addEventListener("change", applyFilters);
  $("#packetRows").addEventListener("click", event => { const row = event.target.closest("tr[data-packet]"); if (row) inspectPacket(Number(row.dataset.packet)); });
  $("#closeDialog").addEventListener("click", () => $("#packetDialog").close()); $("#openPacketWorkbenchButton").addEventListener("click", event => { const number = Number(event.currentTarget.dataset.packetNumber); $("#packetDialog").close(); if (number) showPacketWorkbench(number); }); $("#exportButton").addEventListener("click", exportCsv);
  const dropZone = $("#dropZone");
  ["dragenter", "dragover"].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.add("dragging"); }));
  ["dragleave", "drop"].forEach(type => dropZone.addEventListener(type, event => { event.preventDefault(); dropZone.classList.remove("dragging"); }));
  dropZone.addEventListener("drop", event => openFile(event.dataTransfer.files[0]));
  window.addEventListener("resize", () => { if (state.packets.length && !$("#workspace").hidden && !$("#dashboard").hidden) { drawTimeline(); const protocols = state.filtered.reduce((result, packet) => { result[packet.protocol] = (result[packet.protocol] || 0) + packet.length; return result; }, {}); drawDonut(protocols); const aggregation = aggregate(state.filtered); drawFrameSizeChart(state.filtered); drawLatencyChart(aggregation); drawTopology(aggregation.flows); drawFlowTimeline(aggregation.flows.find(flow => flow.key === state.activeFlowKey)); } });
}

if (typeof window !== "undefined") {
  window.DataSnareAINetScope = Object.freeze({
    schema: "datasnare-ainetscope/analysis-v1",
    parseFile,
    buildExportReport,
    get summary() { return { packets: state.packets.length, filtered: state.filtered.length, flows: aggregate(state.filtered.length ? state.filtered : state.packets).flows.length, captureId: state.captureId }; }
  });
}