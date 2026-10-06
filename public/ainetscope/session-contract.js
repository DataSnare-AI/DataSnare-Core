(function (root) {
  "use strict";
  const SCHEMA = 'datasnare-ainetscope/session-v1';
  const MAX_BYTES = 100 * 1024 * 1024;
  const PACKET_FIELDS = ['number', 'timestamp', 'length', 'capturedLength', 'linkType', 'protocol', 'transport',
    'src', 'dst', 'srcPort', 'dstPort', 'info', 'seq', 'ack', 'payloadLength', 'flags', 'tcpFlagsValue',
    'tcpWindow', 'tcpOptions', 'latency', 'dnsRcode', 'dnsResponse', 'httpKind', 'httpMethod', 'httpStatus',
    'tdsType', 'tdsError', 'smbCommand', 'processCorrelation'];
  const RESULT_FIELDS = ['index', 'name', 'path', 'status', 'start', 'end', 'summary', 'protocols', 'hostTraffic',
    'edges', 'protocolNames', 'services', 'serviceStats', 'findings', 'rankedObservations', 'highFindings', 'mediumFindings', 'error'];
  const blocked = new Set(['__proto__', 'prototype', 'constructor', 'raw', 'rawBytes', 'rawPreview', 'packetData',
    'captureBuffer', 'buffer', 'layers', 'details', 'source', 'file', 'demoPackets', 'token', 'password', 'credential']);
  function clean(value, depth = 0) {
    if (depth > 10) throw new Error('Session nesting exceeds the safety limit.');
    if (value === null || typeof value === 'boolean') return value;
    if (typeof value === 'number') return Number.isFinite(value) ? value : null;
    if (typeof value === 'string') return value.slice(0, 16000);
    if (Array.isArray(value)) {
      if (value.length > 1500000) throw new Error('Session array exceeds the safety limit.');
      return value.map(item => clean(item, depth + 1));
    }
    if (value && Object.getPrototypeOf(value) === Object.prototype) {
      return Object.fromEntries(Object.entries(value).filter(([key]) => !blocked.has(key))
        .map(([key, item]) => [key.slice(0, 160), clean(item, depth + 1)]));
    }
    return null;
  }
  function select(value, fields) {
    return Object.fromEntries(fields.filter(key => value[key] !== undefined).map(key => [key, clean(value[key])]));
  }
  function packets(rows) {
    if (!Array.isArray(rows) || rows.length > 1500000) throw new Error('Invalid session packet list.');
    const frames = new Set();
    return rows.map(row => {
      if (!row || !Number.isSafeInteger(row.number) || row.number < 1 || frames.has(row.number)
        || !Number.isFinite(row.timestamp) || Math.abs(row.timestamp) > 8640000000000
        || !Number.isFinite(row.length) || row.length < 0) throw new Error('Invalid or duplicate session packet metadata.');
      frames.add(row.number);
      const result = select(row, PACKET_FIELDS);
      if (result.flags !== undefined && (!Array.isArray(result.flags) || result.flags.some(flag => typeof flag !== 'string'))) throw new Error('Invalid TCP flags.');
      return result;
    });
  }
  function source(file, fallback = '') {
    return { name: file?.name || fallback, size: Number.isSafeInteger(file?.size) ? file.size : null,
      lastModified: Number.isSafeInteger(file?.lastModified) ? file.lastModified : null,
      path: file?.webkitRelativePath || file?.path || fallback || file?.name || '' };
  }
  function validate(document) {
    if (!document || document.schema !== SCHEMA || !['standard', 'set', 'two-sided'].includes(document.mode)) throw new Error('Unsupported AINetScope session schema or workspace.');
    const result = clean(document);
    const data = result.data;
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('Missing session workspace data.');
    const validSource = metadata => metadata && typeof metadata === 'object' && typeof metadata.name === 'string'
      && (metadata.size === null || Number.isSafeInteger(metadata.size) && metadata.size >= 0)
      && (metadata.lastModified === null || Number.isSafeInteger(metadata.lastModified) && metadata.lastModified >= 0);
    if (result.profile && (!Array.isArray(result.profile.focusProtocols) || !result.profile.thresholds || typeof result.profile.thresholds !== 'object')) throw new Error('Invalid saved analysis profile.');
    if (result.mode === 'standard') {
      if (typeof data.name !== 'string' || !validSource(data.captureSource)) throw new Error('Invalid capture session source metadata.');
      data.packets = packets(data.packets);
      if (!data.packets.length) throw new Error('Capture session has no packet metadata.');
    }
    if (result.mode === 'two-sided') {
      data.packetsA = packets(data.packetsA); data.packetsB = packets(data.packetsB);
      if (!data.packetsA.length || !data.packetsB.length) throw new Error('Two-Sided session requires both packet lists.');
      if (!data.context || !Number.isFinite(data.offsetMs) || !Number.isFinite(data.context.toleranceMs) || data.context.toleranceMs < 0
        || !Array.isArray(data.context.sources) || data.context.sources.length !== 2 || !data.context.sources.every(validSource)
        || typeof data.context.hostA !== 'string' || typeof data.context.hostB !== 'string') throw new Error('Invalid Two-Sided session context.');
    }
    if (result.mode === 'set') {
      if (!Array.isArray(data.items) || !data.items.length || !Array.isArray(data.results) || data.items.length > 10000 || data.results.length > 10000) throw new Error('Invalid capture set inventory.');
      if (!data.items.every(item => item && typeof item.name === 'string' && typeof item.path === 'string' && validSource(item.metadata))) throw new Error('Invalid capture set file metadata.');
      data.results = data.results.map(row => {
        if (!row || !Number.isSafeInteger(row.index) || row.index < 0 || row.index >= data.items.length
          || typeof row.name !== 'string' || typeof row.path !== 'string' || !['Analyzed', 'Queued', 'Failed'].includes(row.status)
          || !row.summary || !row.protocols || typeof row.protocols !== 'object' || Array.isArray(row.protocols)
          || !Array.isArray(row.protocolNames) || row.protocolNames.some(item => typeof item !== 'string')
          || !Array.isArray(row.services) || row.services.some(item => typeof item !== 'string') || !Array.isArray(row.findings)
          || row.findings.some(item => !item || typeof item !== 'object' || typeof item.title !== 'string')
          || !Number.isFinite(row.summary.packets) || !Number.isFinite(row.summary.duration)) throw new Error('Invalid capture set result.');
        return select(row, RESULT_FIELDS);
      });
      if (new Set(data.results.map(row => row.index)).size !== data.results.length) throw new Error('Duplicate capture set result index.');
    }
    return result;
  }
  function encode(mode, data, profile) {
    const document = validate({ schema: SCHEMA, version: 1, savedAt: new Date().toISOString(), mode,
      coverage: 'metadata_only_no_raw_capture_bytes', profile, data });
    const json = JSON.stringify(document);
    if (new TextEncoder().encode(json).length > MAX_BYTES) throw new Error('Session exceeds 100 MiB. Reduce the capture size or save a capture-set summary session.');
    return json;
  }
  function decode(text) {
    if (new TextEncoder().encode(text).length > MAX_BYTES) throw new Error('Session files are limited to 100 MiB.');
    try { return validate(JSON.parse(text)); }
    catch (error) { throw new Error(`Could not restore session: ${error.message}`); }
  }
  function matches(metadata, files) {
    if (!metadata || metadata.size === null || metadata.lastModified === null) return [];
    return [...files].filter(file => file.name === metadata.name && file.size === metadata.size && file.lastModified === metadata.lastModified
      && (!file.webkitRelativePath || !metadata.path.includes('/') || file.webkitRelativePath === metadata.path));
  }
  const api = Object.freeze({ SCHEMA, MAX_BYTES, PACKET_FIELDS, RESULT_FIELDS, packets, source, clean, select, encode, decode, matches });
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.DataSnareSessionContract = api;
})(typeof globalThis !== 'undefined' ? globalThis : this);