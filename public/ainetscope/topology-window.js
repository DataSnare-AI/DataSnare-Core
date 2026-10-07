"use strict";

// Builds a fully standalone HTML document (no external deps) for the combined
// capture-set topology map, opened in a new browser window/tab.
function buildTopologyDocument(payload) {
  const json = JSON.stringify(payload).replace(/</g, "\\u003c");
  const script = TOPOLOGY_SCRIPT.replace("__PAYLOAD_JSON__", json).replace("__HOST_MAP_HELPER__", normalizeHostnameMapProfile.toString());
  const title = escapeForHtml((payload.setName || "Capture set") + " \u2014 Topology map");
  return "<!doctype html><html lang=\"en\"><head><meta charset=\"utf-8\">" +
    "<meta name=\"viewport\" content=\"width=device-width, initial-scale=1\">" +
    "<title>" + title + "</title><style>" + TOPOLOGY_STYLES + "</style></head><body>" +
    TOPOLOGY_BODY + "<script>" + script + "</" + "script></body></html>";
}

const HOSTNAME_MAP_SCHEMA = "datasnare-ainetscope/hostname-map-v1";
function normalizeHostnameMapProfile(profile) {
  if (!profile || profile.schema !== "datasnare-ainetscope/hostname-map-v1") throw new Error("Unsupported IP-to-hostname map format.");
  if (!Array.isArray(profile.mappings) || profile.mappings.length > 100000) throw new Error("Hostname map must contain no more than 100,000 mappings.");
  const ipv4 = value => {
    const parts = value.split(".");
    return parts.length === 4 && parts.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255);
  };
  const isIpAddress = value => {
    if (ipv4(value)) return true;
    if (!value.includes(":")) return false;
    try { return new URL("http://[" + value + "]/").hostname.length > 0; } catch (_) { return false; }
  };
  const mappings = Object.create(null);
  for (const item of profile.mappings) {
    const ip = String(item?.ip || "").trim();
    const hostname = String(item?.hostname || "").trim();
    if (!isIpAddress(ip)) throw new Error("Invalid IP address in hostname map: " + ip);
    if (!hostname || hostname.length > 253 || /[\u0000-\u001f\u007f]/.test(hostname)) throw new Error("Invalid hostname for " + ip);
    if (Object.prototype.hasOwnProperty.call(mappings, ip) && mappings[ip] !== hostname) throw new Error("Conflicting duplicate mapping for " + ip);
    mappings[ip] = hostname;
  }
  return { schema: "datasnare-ainetscope/hostname-map-v1",
    profileName: String(profile.profileName || "Imported hostname map").trim().slice(0, 100) || "Imported hostname map",
    mappings };
}

function topologyEndpointHost(value, transport) {
  const text = String(value ?? "");
  return transport ? text.slice(0, text.lastIndexOf(":")) || text : text;
}

function buildSingleCaptureTopologyPayload(packets, flows, metadata = {}, hostMapProfile = null) {
  const hosts = new Map();
  for (const packet of packets || []) {
    for (const address of [packet.src, packet.dst]) {
      if (!address || address === "—") continue;
      hosts.set(address, (hosts.get(address) || 0) + (Number(packet.length) || 0));
    }
  }
  const edges = [];
  for (const flow of flows || []) {
    const a = topologyEndpointHost(flow.a, flow.transport);
    const b = topologyEndpointHost(flow.b, flow.transport);
    if (!a || !b || a === b) continue;
    edges.push({ a, b, bytes: Number(flow.bytes) || 0, packets: Number(flow.packets) || 0,
      protocols: { [flow.protocol || "Unknown"]: Number(flow.bytes) || 0 }, files: [] });
  }
  return {
    schema: "datasnare-ainetscope/topology-v1",
    generatedAt: new Date().toISOString(),
    setId: `single:${metadata.captureId || metadata.name || "capture"}`,
    setName: metadata.name || "Single capture",
    fileCount: 1,
    hosts: [...hosts.entries()].map(([host, bytes]) => ({ host, bytes })),
    edges,
    hostMapProfile: hostMapProfile?.profileName ? {
      profileName: hostMapProfile.profileName,
      mappings: Object.fromEntries((hostMapProfile.mappings || []).filter(item => item.source !== "captured-dns").map(item => [item.ip, item.hostname]))
    } : null
  };
}

function openSingleCaptureTopology() {
  if (!state.filtered.length) { showToast("Open a capture before creating its topology map."); return; }
  const aggregation = aggregate(state.filtered);
  const payload = buildSingleCaptureTopologyPayload(state.filtered, aggregation.flows,
    { captureId: state.captureId, name: state.fileName }, activeHostnameProfile());
  if (!payload.edges.length) { showToast("No host-to-host flows were observed in this capture view."); return; }
  const win = window.open("", "_blank", "width=1440,height=920");
  if (!win) { showToast("Pop-up blocked. Allow pop-ups for this site to open the topology map."); return; }
  win.document.open(); win.document.write(buildTopologyDocument(payload)); win.document.close();
}

function escapeForHtml(value) {
  return String(value == null ? "" : value).replace(/[&<>"']/g, char => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;" }[char]));
}

const TOPOLOGY_STYLES = `
:root { --paper: #f3f0e8; --ink: #17211d; --muted: #6f756f; --line: #d6d3c9; --panel: #fbfaf6; --green: #1d6b4f; --coral: #e86d4c; --blue: #4182a4; --gold: #e2ac45; --mono: "DM Mono", Consolas, monospace; --sans: -apple-system, Segoe UI, Manrope, sans-serif; }
* { box-sizing: border-box; }
body { margin: 0; background: var(--paper); color: var(--ink); font-family: var(--sans); }
button, input { font: inherit; }
button { cursor: pointer; }
.topbar { display: flex; align-items: center; justify-content: space-between; gap: 18px; padding: 14px 20px; border-bottom: 1px solid var(--line); background: var(--panel); flex-wrap: wrap; }
.topbar h1 { margin: 0; font-size: 16px; font-weight: 700; }
.topbar small { display: block; margin-top: 3px; color: var(--muted); font: 400 10px var(--mono); }
.stat-strip { display: flex; gap: 16px; color: var(--muted); font: 400 10px var(--mono); }
.stat-strip b { color: var(--ink); font-weight: 600; }
.toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; padding: 10px 20px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.5); }
.toolbar input[type="search"] { min-width: 200px; height: 32px; padding: 0 10px; border: 1px solid var(--line); border-radius: 4px; background: white; }
.toolbar button, .add-lane-form button { min-height: 32px; padding: 0 12px; border: 1px solid var(--ink); border-radius: 4px; background: transparent; color: var(--ink); font-size: 11px; font-weight: 600; }
.toolbar button:hover, .add-lane-form button:hover { background: var(--ink); color: white; }
.toolbar .zoom-group { display: flex; align-items: center; gap: 4px; margin-left: auto; }
.help-tip { padding: 8px 20px; color: var(--muted); font-size: 10px; line-height: 1.5; border-bottom: 1px solid var(--line); background: rgba(226,172,69,.1); }
.layout { display: grid; grid-template-columns: 1fr 320px; height: calc(100vh - 138px); }
.lanes-wrapper { position: relative; overflow: auto; padding: 16px 30px 40px; }
.lane { position: relative; z-index: 1; margin-bottom: 0; border: 1px solid var(--line); border-radius: 6px; background: rgba(255,253,248,.7); }
.lane-gutter { position: relative; z-index: 1; min-height: 22px; }
.lane-head { display: flex; align-items: center; gap: 10px; padding: 10px 12px 14px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.lane-swatch { width: 12px; height: 12px; border-radius: 3px; flex: 0 0 auto; }
.lane-head input[type="text"] { height: 28px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: white; font-size: 11px; }
.lane-label { width: 190px; font-weight: 600; }
.lane-prefixes { width: 220px; color: var(--muted); font: 400 10px var(--mono); }
.lane-meta { margin-left: auto; color: var(--muted); font: 400 9px var(--mono); white-space: nowrap; }
.lane-actions { display: flex; gap: 4px; }
.lane-actions button { width: 24px; height: 24px; padding: 0; border: 1px solid var(--line); border-radius: 3px; background: transparent; font-size: 11px; }
.lane-content { display: flex; flex-wrap: nowrap; overflow-x: auto; gap: 8px; padding: 14px 12px; min-height: 52px; }
.lane-content.drag-over { background: rgba(29,107,79,.08); }
.node-chip { flex: 0 0 auto; display: flex; flex-direction: column; gap: 2px; min-width: 110px; padding: 6px 9px; border: 1px solid var(--line); border-left: 4px solid var(--green); border-radius: 4px; background: var(--panel); cursor: grab; }
.node-chip.dim { opacity: .22; }
.node-chip.selected { outline: 2px solid var(--ink); outline-offset: 1px; }
.node-chip.edge-endpoint { outline: 2px solid var(--gold); outline-offset: 2px; box-shadow: 0 0 0 4px rgba(226,172,69,.22); }
.node-chip strong { font: 500 11px var(--mono); overflow: hidden; text-overflow: ellipsis; white-space: nowrap; max-width: 220px; }
.node-chip em { font-style: normal; color: var(--muted); font: 400 9px var(--mono); }
.node-chip span { color: var(--muted); font: 400 9px var(--mono); }
svg.edge-layer { position: absolute; top: 0; left: 0; pointer-events: none; z-index: 3; }
svg.edge-layer path { pointer-events: stroke; cursor: pointer; }
svg.edge-layer path.dim { opacity: .08; }
svg.edge-layer path.edge-glow { pointer-events: none; opacity: .28; }
svg.edge-layer path.edge-selected { filter: drop-shadow(0 0 5px rgba(23,33,29,.42)); }
.add-lane-form { display: flex; gap: 8px; align-items: center; padding: 10px 20px; border-bottom: 1px solid var(--line); flex-wrap: wrap; }
.add-lane-form input { height: 30px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: white; }
.detail-panel { border-left: 1px solid var(--line); padding: 16px; overflow: auto; background: var(--panel); }
.detail-panel h2 { margin: 0 0 4px; font-size: 14px; }
.detail-panel p.empty { color: var(--muted); font-size: 11px; line-height: 1.6; }
.detail-row { display: flex; justify-content: space-between; gap: 10px; padding: 6px 0; border-bottom: 1px solid var(--line); font: 400 11px var(--mono); }
.detail-row span:first-child { color: var(--muted); }
.protocol-bar { margin: 3px 0; height: 6px; border-radius: 3px; background: var(--line); overflow: hidden; }
.protocol-bar i { display: block; height: 100%; background: var(--blue); }
.file-chip { display: inline-block; margin: 2px 4px 0 0; padding: 2px 6px; border: 1px solid var(--line); border-radius: 3px; font: 400 9px var(--mono); color: var(--muted); }
.edge-detail-list { list-style: none; margin: 6px 0 0; padding: 0; }
.edge-detail-list li { display: flex; justify-content: space-between; gap: 10px; padding: 5px 0; border-bottom: 1px dashed var(--line); font: 400 10px var(--mono); }
.chip-context-menu { position: fixed; z-index: 20; min-width: 200px; padding: 6px; border: 1px solid var(--ink); border-radius: 5px; background: var(--panel); box-shadow: 0 12px 30px rgba(23,33,29,.22); }
.chip-context-menu .menu-title { padding: 6px 8px; color: var(--muted); font: 500 8px var(--mono); text-transform: uppercase; }
.chip-context-menu button { display: block; width: 100%; padding: 7px 8px; border: 0; border-radius: 3px; background: transparent; color: var(--ink); text-align: left; font-size: 11px; }
.chip-context-menu button:hover { background: rgba(29,107,79,.1); }
.chip-context-menu button.current { color: var(--muted); cursor: default; }
.chip-context-menu button.current:hover { background: transparent; }
.png-download-panel { position: fixed; right: 18px; bottom: 18px; z-index: 30; display: flex; align-items: center; gap: 8px; padding: 10px; border: 1px solid var(--ink); border-radius: 5px; background: var(--panel); box-shadow: 0 12px 30px rgba(23,33,29,.22); font-size: 11px; }
.png-download-panel a, .png-download-panel button { min-height: 28px; padding: 0 10px; border: 1px solid var(--ink); border-radius: 4px; background: transparent; color: var(--ink); font-size: 11px; font-weight: 600; text-decoration: none; }
.png-download-panel a:hover, .png-download-panel button:hover { background: var(--ink); color: white; }
.host-names-panel { padding: 12px 20px; border-bottom: 1px solid var(--line); background: rgba(255,255,255,.5); }
.host-names-panel p { margin: 0 0 8px; color: var(--muted); font-size: 10px; line-height: 1.5; }
.host-names-panel textarea { width: 100%; min-height: 110px; padding: 8px; border: 1px solid var(--line); border-radius: 4px; background: white; color: var(--ink); font: 400 10px/1.6 var(--mono); resize: vertical; }
.host-names-panel input[type="text"] { width: min(360px, 100%); height: 30px; margin: 4px 0 8px; padding: 0 8px; border: 1px solid var(--line); border-radius: 3px; background: white; color: var(--ink); font-size: 11px; }
.host-names-panel .host-names-actions { display: flex; justify-content: flex-end; gap: 8px; margin-top: 8px; }
`;

const TOPOLOGY_BODY = `
<header class="topbar">
  <div><h1 id="setTitle"></h1><small id="setMeta"></small></div>
  <div class="stat-strip" id="statStrip"></div>
</header>
<div class="toolbar">
  <input type="search" id="searchInput" placeholder="Filter hosts...">
  <button type="button" id="autoArrangeButton">Auto-arrange</button>
  <button type="button" id="redrawButton">Redraw</button>
  <button type="button" id="hostNamesButton">Hostnames</button>
  <button type="button" id="exportHostMapButton">Export IP map</button>
  <button type="button" id="importHostMapButton">Import IP map</button>
  <input type="file" id="importHostMapInput" accept="application/json,.json" hidden>
  <button type="button" id="lanePresetsButton">Lane presets</button>
  <button type="button" id="resetLayoutButton">Reset layout</button>
  <button type="button" id="exportLayoutButton">Export layout JSON</button>
  <button type="button" id="importLayoutButton">Import layout JSON</button>
  <input type="file" id="importLayoutInput" accept="application/json,.json" hidden>
  <button type="button" id="exportMermaidButton">Export Mermaid</button>
  <button type="button" id="exportPngButton">Export PNG</button>
  <div class="zoom-group">
    <button type="button" id="zoomOutButton">-</button>
    <button type="button" id="zoomResetButton">Reset zoom</button>
    <button type="button" id="zoomInButton">+</button>
  </div>
</div>
<p class="help-tip">Drag hosts between lanes, or right-click a host for "Move to lane". Lane order affects Auto-arrange and Redraw priority: put more specific prefixes or ranges (e.g. "10.242.88.17-32") above broader ones (e.g. "10."). After adding or editing a lane, click Redraw to move hosts into the right lane without losing your manual placements. Click a node or a connection line for full details.</p>
<div class="host-names-panel" id="hostNamesPanel" hidden>
  <p>Offline mappings are authoritative. Import/export reusable, set-independent JSON IP maps; imports replace this set's hostname map without changing lanes or positions. Captured DNS hints and live DNS are not used automatically.</p>
  <label for="hostMapProfileName">Profile name</label><input type="text" id="hostMapProfileName" maxlength="100" placeholder="TenantA-Location1">
  <p>One mapping per line: <strong>IP address = hostname</strong>. Cards show hostname, IP, and traffic when a mapping exists.</p>
  <textarea id="hostNamesInput" spellcheck="false" placeholder="10.242.88.6 = APP-SVC-01"></textarea>
  <div class="host-names-actions"><button type="button" id="applyHostNamesButton">Apply hostnames</button></div>
</div>
<div class="host-names-panel" id="lanePresetsPanel" hidden>
  <p>One lane per line: <strong>Lane label = prefix or range, prefix or range</strong>. Applying presets replaces the lane list and keeps hostnames.</p>
  <textarea id="lanePresetsInput" spellcheck="false" placeholder="VLAN 32 Robots = 10.242.88.1-15"></textarea>
  <div class="host-names-actions"><button type="button" id="applyLanePresetsButton">Apply lane presets</button></div>
</div>
<div class="add-lane-form">
  <input type="text" id="newLaneLabel" placeholder="Lane label, e.g. Internal 10.242.88.x">
  <input type="text" id="newLanePrefixes" placeholder="Prefixes/ranges, e.g. 10.242.88., 10.242.88.17-32">
  <button type="button" id="addLaneButton">+ Add lane</button>
</div>
<div class="layout">
  <div class="lanes-wrapper" id="lanesWrapper">
    <svg class="edge-layer" id="edgeSvg"></svg>
    <div id="lanesContainer"></div>
  </div>
  <aside class="detail-panel" id="detailPanel"><p class="empty">Click a node or a connection line to see full details, including bytes and protocol breakdown.</p></aside>
</div>
<div class="chip-context-menu" id="chipContextMenu" hidden></div>
`;

const TOPOLOGY_SCRIPT = `
(function () {
  "use strict";
  var normalizeHostnameMapProfile = __HOST_MAP_HELPER__;
  var DATA = __PAYLOAD_JSON__;
  var STORAGE_KEY = "datasnare-ainetscope-topology-layout:" + (DATA.setId || "default");
  var UNCLASSIFIED_ID = "lane-unclassified";
  var PALETTE = ["#1d6b4f", "#e86d4c", "#4182a4", "#e2ac45", "#89a63e", "#946c9b", "#7a817a", "#c0554f"];
  var zoomLevel = 1;
  var selection = null;

  function escapeHtml(value) {
    return String(value == null ? "" : value).replace(/[&<>"']/g, function (ch) {
      return ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "\\"": "&quot;", "'": "&#39;" })[ch];
    });
  }

  function formatBytes(value) {
    if (!value) return "0 B";
    var units = ["B", "KB", "MB", "GB"];
    var index = Math.min(units.length - 1, Math.floor(Math.log(value) / Math.log(1024)));
    return (value / Math.pow(1024, index)).toFixed(index ? 1 : 0) + " " + units[index];
  }

  function defaultLayout() {
    return {
      lanes: [
        { id: "lane-private-10", label: "Private 10.x.x.x", prefixes: ["10."] },
        { id: "lane-private-172", label: "Private 172.x.x.x", prefixes: ["172."] },
        { id: "lane-private-192", label: "Private 192.168.x.x", prefixes: ["192.168."] }
      ],
      hostLane: {},
      hostOrder: {},
      hostNames: DATA.hostMapProfile?.mappings || {},
      hostNamesProfileName: DATA.hostMapProfile?.profileName || DATA.setName || "Current capture set"
    };
  }

  function loadLayout() {
    try {
      var saved = JSON.parse(localStorage.getItem(STORAGE_KEY));
      if (saved && Array.isArray(saved.lanes)) {
        saved.hostLane = saved.hostLane || {};
        saved.hostOrder = saved.hostOrder || {};
        saved.hostNames = { ...(DATA.hostMapProfile?.mappings || {}), ...(saved.hostNames || {}) };
        saved.hostNamesProfileName = DATA.hostMapProfile?.profileName || saved.hostNamesProfileName || DATA.setName || "Current capture set";
        return saved;
      }
    } catch (error) { /* fall through to defaults */ }
    return defaultLayout();
  }

  var layout = loadLayout();

  function saveLayout() {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(layout)); } catch (error) { /* storage unavailable */ }
  }

  function ruleSpecificity(rule, host) {
    if (!rule) return -1;
    if (host.indexOf(rule) === 0) return String(rule).length;
    var range = String(rule).match(/^(\\d+\\.\\d+\\.\\d+\\.)(\\d+)-(\\d+)$/);
    var hostIp = String(host).match(/^(\\d+\\.\\d+\\.\\d+\\.)(\\d+)$/);
    if (!range || !hostIp || range[1] !== hostIp[1]) return -1;
    var start = Number(range[2]);
    var end = Number(range[3]);
    var value = Number(hostIp[2]);
    var low = Math.min(start, end);
    var high = Math.max(start, end);
    if (value < low || value > high) return -1;
    return 1000 + range[1].length + (255 - (high - low));
  }

  function bestRuleLane(host) {
    var bestLaneId = UNCLASSIFIED_ID;
    var bestScore = -1;
    for (var index = 0; index < layout.lanes.length; index++) {
      var lane = layout.lanes[index];
      var prefixes = lane.prefixes || [];
      for (var p = 0; p < prefixes.length; p++) {
        var score = ruleSpecificity(prefixes[p], host);
        if (score > bestScore) { bestScore = score; bestLaneId = lane.id; }
      }
    }
    return bestLaneId;
  }

  function classify(host) {
    if (layout.hostLane[host]) return layout.hostLane[host];
    return bestRuleLane(host);
  }

  function laneById(laneId) {
    if (laneId === UNCLASSIFIED_ID) return { id: UNCLASSIFIED_ID, label: "Unclassified", prefixes: [] };
    for (var index = 0; index < layout.lanes.length; index++) if (layout.lanes[index].id === laneId) return layout.lanes[index];
    return null;
  }

  function laneColor(laneId, index) {
    if (laneId === UNCLASSIFIED_ID) return "#7a817a";
    return PALETTE[index % PALETTE.length];
  }

  function hostBytesMap() {
    var map = {};
    DATA.hosts.forEach(function (item) { map[item.host] = item.bytes; });
    return map;
  }

  function protocolColor(name) {
    var known = { TCP: "#4182a4", UDP: "#89a63e", DNS: "#e2ac45", TLS: "#946c9b", HTTP: "#e86d4c", "HTTP/2": "#e86d4c", QUIC: "#1d6b4f", SMB2: "#c0554f", TDS: "#4182a4" };
    if (known[name]) return known[name];
    var hash = 0;
    for (var index = 0; index < String(name).length; index++) hash = (hash * 31 + String(name).charCodeAt(index)) >>> 0;
    return PALETTE[hash % PALETTE.length];
  }

  function laneHostGroups() {
    var bytesMap = hostBytesMap();
    var groups = {};
    var order = layout.lanes.map(function (lane) { return lane.id; }).concat([UNCLASSIFIED_ID]);
    order.forEach(function (id) { groups[id] = []; });
    DATA.hosts.forEach(function (item) { var laneId = classify(item.host); if (!groups[laneId]) groups[laneId] = []; groups[laneId].push(item.host); });
    order.forEach(function (laneId) {
      var recorded = layout.hostOrder[laneId] || [];
      var known = groups[laneId] || [];
      var ordered = recorded.filter(function (host) { return known.indexOf(host) >= 0; });
      known.forEach(function (host) { if (ordered.indexOf(host) < 0) ordered.push(host); });
      ordered.sort(function (a, b) {
        var indexA = recorded.indexOf(a); var indexB = recorded.indexOf(b);
        if (indexA >= 0 && indexB >= 0) return indexA - indexB;
        if (indexA >= 0) return -1;
        if (indexB >= 0) return 1;
        return (bytesMap[b] || 0) - (bytesMap[a] || 0);
      });
      groups[laneId] = ordered;
    });
    return groups;
  }

  function renderStats() {
    document.getElementById("setTitle").textContent = DATA.setName || "Capture set";
    document.getElementById("setMeta").textContent = "Generated " + new Date(DATA.generatedAt).toLocaleString();
    var totalBytes = DATA.edges.reduce(function (sum, edge) { return sum + edge.bytes; }, 0);
    var strip = document.getElementById("statStrip");
    strip.innerHTML =
      "<span>Files <b>" + (DATA.fileCount || 0).toLocaleString() + "</b></span>" +
      "<span>Hosts <b>" + DATA.hosts.length.toLocaleString() + "</b></span>" +
      "<span>Connections <b>" + DATA.edges.length.toLocaleString() + "</b></span>" +
      "<span>Traffic <b>" + formatBytes(totalBytes) + "</b></span>";
  }

  function fileBaseName() {
    return (DATA.setName || "capture-set").toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");
  }

  function downloadBlob(blob, fileName) {
    var link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = fileName;
    link.style.display = "none";
    document.body.appendChild(link);
    link.click();
    setTimeout(function () { URL.revokeObjectURL(link.href); link.remove(); }, 2000);
  }

  function showPngDownload(dataUrl, fileName) {
    var existing = document.getElementById("pngDownloadPanel");
    if (existing) existing.remove();
    var panel = document.createElement("div");
    panel.id = "pngDownloadPanel";
    panel.className = "png-download-panel";
    var label = document.createElement("span");
    label.textContent = "PNG ready";
    var link = document.createElement("a");
    link.href = dataUrl;
    link.download = fileName;
    link.textContent = "Download PNG";
    var close = document.createElement("button");
    close.type = "button";
    close.textContent = "Dismiss";
    close.addEventListener("click", function () { panel.remove(); });
    panel.appendChild(label);
    panel.appendChild(link);
    panel.appendChild(close);
    document.body.appendChild(panel);
  }

  function mermaidText(value) {
    return String(value == null ? "" : value).split(String.fromCharCode(13)).join(" ").split(String.fromCharCode(10)).join(" ").split('"').join("'");
  }

  function mermaidNodeId(host, index) {
    return "host_" + index + "_" + String(host).replace(/[^a-z0-9]+/gi, "_");
  }

  function buildMermaid() {
    var groups = laneHostGroups();
    var bytesMap = hostBytesMap();
    var order = layout.lanes.concat([{ id: UNCLASSIFIED_ID, label: "Unclassified", prefixes: [] }]);
    var hostIds = {};
    var lines = ["flowchart LR", "  %% Generated by DataSnare AINetScope topology map"];
    DATA.hosts.forEach(function (item, index) { hostIds[item.host] = mermaidNodeId(item.host, index); });
    order.forEach(function (lane, laneIndex) {
      var hosts = groups[lane.id] || [];
      lines.push('  subgraph lane_' + laneIndex + '["' + mermaidText(lane.label) + '"]');
      if (!hosts.length) lines.push('    empty_' + laneIndex + '["(empty)"]');
      hosts.forEach(function (host) {
        var title = layout.hostNames[host] || host;
        var label = mermaidText(title + "<br/>" + host + "<br/>" + formatBytes(bytesMap[host] || 0));
        lines.push('    ' + hostIds[host] + '["' + label + '"]');
      });
      lines.push("  end");
    });
    DATA.edges.forEach(function (edge) {
      if (!hostIds[edge.a] || !hostIds[edge.b]) return;
      var protocols = Object.keys(edge.protocols || {}).sort().join(", ");
      var edgeLabel = mermaidText(formatBytes(edge.bytes) + (protocols ? " " + protocols : ""));
      lines.push('  ' + hostIds[edge.a] + ' ---|"' + edgeLabel + '"| ' + hostIds[edge.b]);
    });
    return lines.join("\\n") + "\\n";
  }

  function exportPng() {
    drawEdges();
    var wrapper = document.getElementById("lanesWrapper");
    var wrapperRect = wrapper.getBoundingClientRect();
    var maxRight = Math.max(wrapper.scrollWidth, wrapper.clientWidth);
    var maxBottom = Math.max(wrapper.scrollHeight, wrapper.clientHeight);
    var exportNodes = wrapper.querySelectorAll(".lane, .lane-gutter, .node-chip, svg.edge-layer");
    for (var n = 0; n < exportNodes.length; n++) {
      var nodeRect = exportNodes[n].getBoundingClientRect();
      maxRight = Math.max(maxRight, nodeRect.right - wrapperRect.left + wrapper.scrollLeft + 40);
      maxBottom = Math.max(maxBottom, nodeRect.bottom - wrapperRect.top + wrapper.scrollTop + 40);
    }

    var width = Math.ceil(maxRight);
    var height = Math.ceil(maxBottom);
    var scale = Math.min(2, Math.max(1, window.devicePixelRatio || 1));
    var canvas = document.createElement("canvas");
    canvas.width = Math.ceil(width * scale);
    canvas.height = Math.ceil(height * scale);
    var context = canvas.getContext("2d");
    context.scale(scale, scale);

    function color(name, fallback) {
      return getComputedStyle(document.body).getPropertyValue(name).trim() || fallback;
    }

    var paper = color("--paper", "#f3f0e8");
    var panel = color("--panel", "#fbfaf6");
    var ink = color("--ink", "#17211d");
    var muted = color("--muted", "#6f756f");
    var line = color("--line", "#d6d3c9");
    var green = color("--green", "#1d6b4f");
    var gold = color("--gold", "#e2ac45");

    function box(el) {
      var rect = el.getBoundingClientRect();
      return { x: rect.left - wrapperRect.left + wrapper.scrollLeft, y: rect.top - wrapperRect.top + wrapper.scrollTop, w: rect.width, h: rect.height };
    }

    function roundedRect(x, y, w, h, r) {
      context.beginPath();
      context.moveTo(x + r, y);
      context.lineTo(x + w - r, y);
      context.quadraticCurveTo(x + w, y, x + w, y + r);
      context.lineTo(x + w, y + h - r);
      context.quadraticCurveTo(x + w, y + h, x + w - r, y + h);
      context.lineTo(x + r, y + h);
      context.quadraticCurveTo(x, y + h, x, y + h - r);
      context.lineTo(x, y + r);
      context.quadraticCurveTo(x, y, x + r, y);
      context.closePath();
    }

    function drawText(text, x, y, font, fill, maxWidth) {
      context.font = font;
      context.fillStyle = fill;
      context.textBaseline = "top";
      context.fillText(String(text == null ? "" : text), x, y, maxWidth);
    }

    context.fillStyle = paper;
    context.fillRect(0, 0, width, height);

    var lanes = wrapper.querySelectorAll(".lane");
    for (var l = 0; l < lanes.length; l++) {
      var lane = lanes[l];
      var laneBox = box(lane);
      var content = lane.querySelector(".lane-content");
      if (content) laneBox.w = Math.max(laneBox.w, box(content).x - laneBox.x + content.scrollWidth + 24);
      context.fillStyle = "rgba(255,253,248,.72)";
      roundedRect(laneBox.x, laneBox.y, laneBox.w, laneBox.h, 6);
      context.fill();
      context.strokeStyle = line;
      context.lineWidth = 1;
      context.stroke();
      context.beginPath();
      context.moveTo(laneBox.x, laneBox.y + 49);
      context.lineTo(laneBox.x + laneBox.w, laneBox.y + 49);
      context.stroke();

      var swatch = lane.querySelector(".lane-swatch");
      if (swatch) {
        var swatchBox = box(swatch);
        context.fillStyle = swatch.style.background || green;
        roundedRect(swatchBox.x, swatchBox.y, swatchBox.w, swatchBox.h, 3);
        context.fill();
      }
      var labelInput = lane.querySelector("[data-lane-label]");
      var prefixesInput = lane.querySelector("[data-lane-prefixes]");
      var meta = lane.querySelector(".lane-meta");
      if (labelInput) drawText(labelInput.value, laneBox.x + 38, laneBox.y + 12, "600 12px -apple-system, Segoe UI, sans-serif", ink, 260);
      if (prefixesInput) drawText(prefixesInput.value || "(catch-all)", laneBox.x + 245, laneBox.y + 14, "10px Consolas, monospace", muted, 320);
      if (meta) drawText(meta.textContent, laneBox.x + laneBox.w - 145, laneBox.y + 16, "9px Consolas, monospace", muted, 130);
    }

    var svgPaths = wrapper.querySelectorAll("svg.edge-layer path");
    for (var p = 0; p < svgPaths.length; p++) {
      var path = svgPaths[p];
      var d = path.getAttribute("d");
      if (!d) continue;
      context.save();
      context.strokeStyle = path.getAttribute("stroke") || green;
      context.lineWidth = Number(path.getAttribute("stroke-width")) || 2;
      context.globalAlpha = path.classList.contains("dim") ? .08 : Number(path.getAttribute("opacity") || (path.classList.contains("edge-glow") ? .28 : .8));
      context.lineJoin = "round";
      context.lineCap = "round";
      context.stroke(new Path2D(d));
      context.restore();
    }

    var chips = wrapper.querySelectorAll(".node-chip");
    for (var c = 0; c < chips.length; c++) {
      var chip = chips[c];
      var chipBox = box(chip);
      context.save();
      context.globalAlpha = chip.classList.contains("dim") ? .24 : 1;
      context.fillStyle = panel;
      roundedRect(chipBox.x, chipBox.y, chipBox.w, chipBox.h, 4);
      context.fill();
      context.strokeStyle = chip.classList.contains("edge-endpoint") ? gold : line;
      context.lineWidth = chip.classList.contains("edge-endpoint") ? 2 : 1;
      context.stroke();
      context.fillStyle = green;
      context.fillRect(chipBox.x, chipBox.y, 4, chipBox.h);
      if (chip.classList.contains("edge-endpoint")) {
        context.strokeStyle = "rgba(226,172,69,.35)";
        context.lineWidth = 6;
        roundedRect(chipBox.x - 3, chipBox.y - 3, chipBox.w + 6, chipBox.h + 6, 6);
        context.stroke();
      }
      var strong = chip.querySelector("strong");
      var em = chip.querySelector("em");
      var span = chip.querySelector("span");
      if (strong) drawText(strong.textContent, chipBox.x + 10, chipBox.y + 6, "500 11px Consolas, monospace", ink, chipBox.w - 18);
      if (em) drawText(em.textContent, chipBox.x + 10, chipBox.y + 22, "9px Consolas, monospace", muted, chipBox.w - 18);
      if (span) drawText(span.textContent, chipBox.x + 10, chipBox.y + 36, "9px Consolas, monospace", muted, chipBox.w - 18);
      context.restore();
    }

    try {
      var fileName = fileBaseName() + "-topology.png";
      var dataUrl = canvas.toDataURL("image/png");
      var link = document.createElement("a");
      link.href = dataUrl;
      link.download = fileName;
      link.style.display = "none";
      document.body.appendChild(link);
      link.click();
      showPngDownload(dataUrl, fileName);
      setTimeout(function () { link.remove(); }, 2000);
    } catch (error) {
      alert("PNG export failed in this browser. Try Export Mermaid as a portable fallback.");
    }
  }

  function laneOrderIds() {
    return layout.lanes.map(function (lane) { return lane.id; }).concat([UNCLASSIFIED_ID]);
  }

  var TRACK_GAP = 8; var GUTTER_PADDING = 10; var MIN_GUTTER = 26; var MARGIN_X = 16;

  // Every edge routes through the gutter band after the higher lane (and, for edges spanning
  // more than one lane, a shared left-margin aisle) so lines never cross chip text.
  function computeEdgeRouting() {
    var order = laneOrderIds();
    var laneIndexOf = {};
    DATA.hosts.forEach(function (item) { laneIndexOf[item.host] = order.indexOf(classify(item.host)); });
    var gutterTrackCount = {};
    var routes = [];
    DATA.edges.forEach(function (edge, index) {
      var laneA = laneIndexOf[edge.a]; var laneB = laneIndexOf[edge.b];
      if (laneA === undefined || laneB === undefined || laneA < 0 || laneB < 0) return;
      var top = Math.min(laneA, laneB); var bottom = Math.max(laneA, laneB);
      var primaryGutter = top;
      var primaryTrack = gutterTrackCount[primaryGutter] || 0; gutterTrackCount[primaryGutter] = primaryTrack + 1;
      var route = { edge: edge, index: index, laneA: laneA, laneB: laneB, primaryGutter: primaryGutter, primaryTrack: primaryTrack };
      if (bottom - top >= 2) {
        var secondaryGutter = bottom - 1;
        var secondaryTrack = gutterTrackCount[secondaryGutter] || 0; gutterTrackCount[secondaryGutter] = secondaryTrack + 1;
        route.secondaryGutter = secondaryGutter; route.secondaryTrack = secondaryTrack;
      }
      routes.push(route);
    });
    return { order: order, gutterTrackCount: gutterTrackCount, routes: routes };
  }

  function gutterHeight(index, routing) {
    var count = routing.gutterTrackCount[index] || 0;
    return Math.max(MIN_GUTTER, GUTTER_PADDING * 2 + Math.max(1, count) * TRACK_GAP);
  }

  function renderLanes() {
    var groups = laneHostGroups();
    var bytesMap = hostBytesMap();
    var query = (document.getElementById("searchInput").value || "").trim().toLowerCase();
    var routing = computeEdgeRouting();
    var html = "";
    var order = layout.lanes.concat([{ id: UNCLASSIFIED_ID, label: "Unclassified", prefixes: [] }]);
    order.forEach(function (lane, laneIndex) {
      var hosts = groups[lane.id] || [];
      var isUnclassified = lane.id === UNCLASSIFIED_ID;
      var laneBytes = hosts.reduce(function (sum, host) { return sum + (bytesMap[host] || 0); }, 0);
      html += "<section class=\\"lane\\" data-lane=\\"" + lane.id + "\\">";
      html += "<div class=\\"lane-head\\">";
      html += "<span class=\\"lane-swatch\\" style=\\"background:" + laneColor(lane.id, laneIndex) + "\\"></span>";
      html += "<input type=\\"text\\" class=\\"lane-label\\" data-lane-label=\\"" + lane.id + "\\" value=\\"" + escapeHtml(lane.label) + "\\"" + (isUnclassified ? " disabled" : "") + ">";
      html += "<input type=\\"text\\" class=\\"lane-prefixes\\" data-lane-prefixes=\\"" + lane.id + "\\" value=\\"" + escapeHtml((lane.prefixes || []).join(", ")) + "\\"" + (isUnclassified ? " disabled placeholder=\\"(catch-all)\\"" : " placeholder=\\"prefix1, prefix2\\"") + ">";
      html += "<span class=\\"lane-meta\\">" + hosts.length + " hosts \\u00b7 " + formatBytes(laneBytes) + "</span>";
      if (!isUnclassified) {
        html += "<span class=\\"lane-actions\\">";
        html += "<button type=\\"button\\" data-lane-up=\\"" + lane.id + "\\" title=\\"Move lane up\\">\\u2191</button>";
        html += "<button type=\\"button\\" data-lane-down=\\"" + lane.id + "\\" title=\\"Move lane down\\">\\u2193</button>";
        html += "<button type=\\"button\\" data-lane-delete=\\"" + lane.id + "\\" title=\\"Delete lane\\">\\u2715</button>";
        html += "</span>";
      }
      html += "</div>";
      html += "<div class=\\"lane-content\\" data-lane-drop=\\"" + lane.id + "\\">";
      hosts.forEach(function (host) {
        var matches = !query || host.toLowerCase().indexOf(query) >= 0;
        var endpoint = selection && selection.type === "edge" && DATA.edges[selection.index] && (DATA.edges[selection.index].a === host || DATA.edges[selection.index].b === host);
        var mappedName = layout.hostNames[host];
        var titleLine = mappedName || host;
        var ipLine = mappedName ? host : "\u2014";
        html += "<div class=\\"node-chip" + (matches ? "" : " dim") + (selection && selection.type === "host" && selection.host === host ? " selected" : "") + (endpoint ? " edge-endpoint" : "") + "\\" draggable=\\"true\\" data-host=\\"" + escapeHtml(host) + "\\">";
        html += "<strong>" + escapeHtml(titleLine) + "</strong><em>" + escapeHtml(ipLine) + "</em><span>" + formatBytes(bytesMap[host] || 0) + "</span>";
        html += "</div>";
      });
      html += "</div></section>";
      html += "<div class=\\"lane-gutter\\" data-gutter-index=\\"" + laneIndex + "\\" style=\\"height:" + gutterHeight(laneIndex, routing) + "px\\"></div>";
    });
    document.getElementById("lanesContainer").innerHTML = html;
    scheduleEdgeRedraw();
  }

  var redrawScheduled = false;
  function scheduleEdgeRedraw() {
    if (redrawScheduled) return;
    redrawScheduled = true;
    requestAnimationFrame(function () { redrawScheduled = false; drawEdges(); });
  }

  function drawEdges() {
    var wrapper = document.getElementById("lanesWrapper");
    var svg = document.getElementById("edgeSvg");
    var wrapperRect = wrapper.getBoundingClientRect();
    var contentWidth = Math.max(wrapper.scrollWidth, wrapper.clientWidth);
    var contentHeight = Math.max(wrapper.scrollHeight, wrapper.clientHeight);
    svg.setAttribute("width", String(contentWidth));
    svg.setAttribute("height", String(contentHeight));
    var query = (document.getElementById("searchInput").value || "").trim().toLowerCase();

    function relRect(el) {
      var rect = el.getBoundingClientRect();
      return {
        x: rect.left - wrapperRect.left + wrapper.scrollLeft + rect.width / 2,
        top: rect.top - wrapperRect.top + wrapper.scrollTop,
        bottom: rect.top - wrapperRect.top + wrapper.scrollTop + rect.height
      };
    }

    var chipRects = {};
    var chips = wrapper.querySelectorAll(".node-chip");
    for (var i = 0; i < chips.length; i++) chipRects[chips[i].getAttribute("data-host")] = relRect(chips[i]);

    var gutterRects = {};
    var gutters = wrapper.querySelectorAll(".lane-gutter");
    for (var g = 0; g < gutters.length; g++) gutterRects[Number(gutters[g].getAttribute("data-gutter-index"))] = relRect(gutters[g]);

    function trackY(gutterIndex, trackIndex) {
      var band = gutterRects[gutterIndex];
      if (!band) return null;
      var y = band.top + GUTTER_PADDING + trackIndex * TRACK_GAP;
      return Math.min(y, band.bottom - GUTTER_PADDING);
    }

    var routing = computeEdgeRouting();
    var maxBytes = 1;
    DATA.edges.forEach(function (edge) { if (edge.bytes > maxBytes) maxBytes = edge.bytes; });
    var parts = [];
    routing.routes.forEach(function (route) {
      var edge = route.edge; var index = route.index;
      var chipA = chipRects[edge.a]; var chipB = chipRects[edge.b];
      if (!chipA || !chipB) return;
      var primaryY = trackY(route.primaryGutter, route.primaryTrack);
      if (primaryY == null) return;
      var widthPx = Math.max(1.2, Math.log2(edge.bytes + 1) / Math.log2(maxBytes + 1) * 8);
      var dominant = ""; var dominantBytes = -1;
      Object.keys(edge.protocols).forEach(function (name) { if (edge.protocols[name] > dominantBytes) { dominantBytes = edge.protocols[name]; dominant = name; } });
      var color = protocolColor(dominant);
      var matches = !query || edge.a.toLowerCase().indexOf(query) >= 0 || edge.b.toLowerCase().indexOf(query) >= 0;
      var isSelected = selection && selection.type === "edge" && selection.index === index;

      var points = [];
      if (route.laneA === route.laneB) {
        points.push([chipA.x, chipA.bottom]);
        points.push([chipA.x, primaryY]);
        points.push([chipB.x, primaryY]);
        points.push([chipB.x, chipB.bottom]);
      } else {
        var upper = route.laneA <= route.laneB ? chipA : chipB;
        var lower = route.laneA <= route.laneB ? chipB : chipA;
        if (route.secondaryGutter !== undefined) {
          var secondaryY = trackY(route.secondaryGutter, route.secondaryTrack);
          if (secondaryY == null) return;
          var marginX = MARGIN_X + (index % 3) * 6;
          points.push([upper.x, upper.bottom]);
          points.push([upper.x, primaryY]);
          points.push([marginX, primaryY]);
          points.push([marginX, secondaryY]);
          points.push([lower.x, secondaryY]);
          points.push([lower.x, lower.top]);
        } else {
          points.push([upper.x, upper.bottom]);
          points.push([upper.x, primaryY]);
          points.push([lower.x, primaryY]);
          points.push([lower.x, lower.top]);
        }
      }
      var d = "M " + points.map(function (p) { return p[0] + " " + p[1]; }).join(" L ");
      if (isSelected) parts.push("<path class=\\"edge-glow\\" d=\\"" + d + "\\" stroke=\\"" + color + "\\" stroke-width=\\"" + (widthPx + 12) + "\\" fill=\\"none\\"></path>");
      parts.push("<path data-edge-index=\\"" + index + "\\" d=\\"" + d + "\\" stroke=\\"" + color + "\\" stroke-width=\\"" + (isSelected ? widthPx + 6 : widthPx) + "\\" fill=\\"none\\" class=\\"" + (matches ? "" : "dim") + (isSelected ? " edge-selected" : "") + "\\" opacity=\\"" + (isSelected ? "1" : ".8") + "\\"></path>");
    });
    svg.innerHTML = parts.join("");
  }

  function renderDetail() {
    var panel = document.getElementById("detailPanel");
    if (!selection) { panel.innerHTML = "<p class=\\"empty\\">Click a node or a connection line to see full details, including bytes and protocol breakdown.</p>"; return; }
    if (selection.type === "host") {
      var host = selection.host;
      var bytesMap = hostBytesMap();
      var connected = DATA.edges.filter(function (edge) { return edge.a === host || edge.b === host; }).sort(function (a, b) { return b.bytes - a.bytes; });
      var mappedName = layout.hostNames[host];
      var html = "<h2>" + escapeHtml(mappedName || host) + "</h2>";
      if (mappedName) html += "<div class=\\"detail-row\\"><span>IP address</span><span>" + escapeHtml(host) + "</span></div>";
      html += "<div class=\\"detail-row\\"><span>Lane</span><span>" + escapeHtml((laneById(classify(host)) || {}).label || "Unclassified") + "</span></div>";
      html += "<div class=\\"detail-row\\"><span>Total traffic</span><span>" + formatBytes(bytesMap[host] || 0) + "</span></div>";
      html += "<div class=\\"detail-row\\"><span>Connections</span><span>" + connected.length + "</span></div>";
      html += "<ul class=\\"edge-detail-list\\">";
      connected.forEach(function (edge) {
        var other = edge.a === host ? edge.b : edge.a;
        html += "<li><span>" + escapeHtml(other) + "</span><span>" + formatBytes(edge.bytes) + "</span></li>";
      });
      html += "</ul>";
      panel.innerHTML = html;
      return;
    }
    if (selection.type === "edge") {
      var edge = DATA.edges[selection.index];
      if (!edge) { selection = null; renderDetail(); return; }
      var totalBytes = edge.bytes || 1;
      var protocolEntries = Object.keys(edge.protocols).map(function (name) { return { name: name, bytes: edge.protocols[name] }; }).sort(function (a, b) { return b.bytes - a.bytes; });
      var html2 = "<h2>" + escapeHtml(edge.a) + " \\u2194 " + escapeHtml(edge.b) + "</h2>";
      html2 += "<div class=\\"detail-row\\"><span>Bytes</span><span>" + formatBytes(edge.bytes) + "</span></div>";
      html2 += "<div class=\\"detail-row\\"><span>Packets</span><span>" + edge.packets.toLocaleString() + "</span></div>";
      html2 += "<p style=\\"margin:12px 0 4px;color:var(--muted);font:500 9px var(--mono);text-transform:uppercase\\">Protocol breakdown</p>";
      protocolEntries.forEach(function (entry) {
        html2 += "<div class=\\"detail-row\\"><span>" + escapeHtml(entry.name) + "</span><span>" + formatBytes(entry.bytes) + "</span></div>";
        html2 += "<div class=\\"protocol-bar\\"><i style=\\"width:" + Math.round(entry.bytes / totalBytes * 100) + "%\\"></i></div>";
      });
      html2 += "<p style=\\"margin:12px 0 4px;color:var(--muted);font:500 9px var(--mono);text-transform:uppercase\\">Seen in files</p>";
      (edge.files || []).forEach(function (file) { html2 += "<span class=\\"file-chip\\">" + escapeHtml(file) + "</span>"; });
      panel.innerHTML = html2;
    }
  }

  function render() { renderStats(); renderLanes(); renderDetail(); }

  function moveLane(laneId, delta) {
    var index = layout.lanes.findIndex(function (lane) { return lane.id === laneId; });
    var target = index + delta;
    if (index < 0 || target < 0 || target >= layout.lanes.length) return;
    var lane = layout.lanes.splice(index, 1)[0];
    layout.lanes.splice(target, 0, lane);
    saveLayout(); render();
  }

  function deleteLane(laneId) {
    var currentGroups = laneHostGroups();
    layout.lanes = layout.lanes.filter(function (lane) { return lane.id !== laneId; });
    Object.keys(layout.hostLane).forEach(function (host) { if (layout.hostLane[host] === laneId) delete layout.hostLane[host]; });
    Object.keys(currentGroups).forEach(function (currentLaneId) {
      if (currentLaneId === laneId || currentLaneId === UNCLASSIFIED_ID) return;
      currentGroups[currentLaneId].forEach(function (host) { layout.hostLane[host] = currentLaneId; });
    });
    DATA.hosts.forEach(function (item) {
      if (layout.hostLane[item.host]) return;
      var targetLaneId = bestRuleLane(item.host);
      if (targetLaneId !== UNCLASSIFIED_ID) layout.hostLane[item.host] = targetLaneId;
    });
    delete layout.hostOrder[laneId];
    saveLayout(); render();
  }

  function assignHost(host, targetLaneId, beforeHost) {
    layout.hostLane[host] = targetLaneId;
    Object.keys(layout.hostOrder).forEach(function (laneId) {
      layout.hostOrder[laneId] = layout.hostOrder[laneId].filter(function (item) { return item !== host; });
    });
    var order = layout.hostOrder[targetLaneId] || [];
    var insertAt = beforeHost ? order.indexOf(beforeHost) : -1;
    if (insertAt < 0) order.push(host); else order.splice(insertAt, 0, host);
    layout.hostOrder[targetLaneId] = order;
    saveLayout();
  }

  function classifyByRules(host) {
    return bestRuleLane(host);
  }

  // Re-evaluates every host against the current lane rules (e.g. after adding a more
  // specific lane) without discarding manual within-lane ordering.
  function redrawLanes() {
    DATA.hosts.forEach(function (item) { layout.hostLane[item.host] = classifyByRules(item.host); });
    Object.keys(layout.hostOrder).forEach(function (laneId) {
      layout.hostOrder[laneId] = layout.hostOrder[laneId].filter(function (host) { return layout.hostLane[host] === laneId; });
    });
    saveLayout(); render();
  }

  function closeChipMenu() {
    var menu = document.getElementById("chipContextMenu");
    menu.hidden = true; menu.innerHTML = "";
  }

  function openChipMenu(host, clientX, clientY) {
    var menu = document.getElementById("chipContextMenu");
    var currentLaneId = classify(host);
    var order = layout.lanes.concat([{ id: UNCLASSIFIED_ID, label: "Unclassified" }]);
    var html = "<div class=\\"menu-title\\">Move " + escapeHtml(host) + " to lane</div>";
    order.forEach(function (lane) {
      var isCurrent = lane.id === currentLaneId;
      html += "<button type=\\"button\\" data-move-host=\\"" + escapeHtml(host) + "\\" data-move-lane=\\"" + lane.id + "\\"" + (isCurrent ? " class=\\"current\\" disabled" : "") + ">" + escapeHtml(lane.label) + (isCurrent ? " (current)" : "") + "</button>";
    });
    menu.innerHTML = html;
    menu.hidden = false;
    var viewportWidth = window.innerWidth; var viewportHeight = window.innerHeight;
    requestAnimationFrame(function () {
      var rect = menu.getBoundingClientRect();
      menu.style.left = Math.max(4, Math.min(viewportWidth - rect.width - 4, clientX)) + "px";
      menu.style.top = Math.max(4, Math.min(viewportHeight - rect.height - 4, clientY)) + "px";
    });
  }

  document.getElementById("lanesContainer").addEventListener("dragstart", function (event) {
    var chip = event.target.closest(".node-chip");
    if (!chip) return;
    event.dataTransfer.setData("text/plain", chip.getAttribute("data-host"));
    event.dataTransfer.effectAllowed = "move";
  });

  document.getElementById("lanesContainer").addEventListener("dragover", function (event) {
    var content = event.target.closest(".lane-content");
    if (!content) return;
    event.preventDefault();
    content.classList.add("drag-over");
  });

  document.getElementById("lanesContainer").addEventListener("dragleave", function (event) {
    var content = event.target.closest(".lane-content");
    if (content) content.classList.remove("drag-over");
  });

  document.getElementById("lanesContainer").addEventListener("drop", function (event) {
    var content = event.target.closest(".lane-content");
    if (!content) return;
    event.preventDefault();
    content.classList.remove("drag-over");
    var host = event.dataTransfer.getData("text/plain");
    if (!host) return;
    var targetChip = event.target.closest(".node-chip");
    var beforeHost = targetChip && targetChip.getAttribute("data-host") !== host ? targetChip.getAttribute("data-host") : null;
    assignHost(host, content.getAttribute("data-lane-drop"), beforeHost);
    render();
  });

  document.getElementById("lanesContainer").addEventListener("click", function (event) {
    var chip = event.target.closest(".node-chip");
    if (chip) { selection = { type: "host", host: chip.getAttribute("data-host") }; renderLanes(); renderDetail(); return; }
    var laneUp = event.target.closest("[data-lane-up]"); if (laneUp) { moveLane(laneUp.getAttribute("data-lane-up"), -1); return; }
    var laneDown = event.target.closest("[data-lane-down]"); if (laneDown) { moveLane(laneDown.getAttribute("data-lane-down"), 1); return; }
    var laneDelete = event.target.closest("[data-lane-delete]"); if (laneDelete) { if (confirm("Delete this lane? Hosts in other lanes keep their current placement.")) deleteLane(laneDelete.getAttribute("data-lane-delete")); return; }
  });

  document.getElementById("lanesContainer").addEventListener("contextmenu", function (event) {
    var chip = event.target.closest(".node-chip");
    if (!chip) return;
    event.preventDefault();
    openChipMenu(chip.getAttribute("data-host"), event.clientX, event.clientY);
  });

  document.getElementById("chipContextMenu").addEventListener("click", function (event) {
    var button = event.target.closest("[data-move-host]");
    if (!button || button.disabled) return;
    assignHost(button.getAttribute("data-move-host"), button.getAttribute("data-move-lane"), null);
    closeChipMenu();
    render();
  });

  document.addEventListener("click", function (event) {
    if (!event.target.closest("#chipContextMenu") && !event.target.closest(".node-chip")) closeChipMenu();
  });
  document.addEventListener("contextmenu", function (event) {
    if (!event.target.closest(".node-chip")) closeChipMenu();
  });
  window.addEventListener("resize", closeChipMenu);

  document.getElementById("lanesContainer").addEventListener("change", function (event) {
    var labelInput = event.target.closest("[data-lane-label]");
    if (labelInput) { var lane = laneById(labelInput.getAttribute("data-lane-label")); if (lane) { lane.label = labelInput.value.trim() || lane.label; saveLayout(); renderStats(); } }
    var prefixInput = event.target.closest("[data-lane-prefixes]");
    if (prefixInput) {
      var laneRef = laneById(prefixInput.getAttribute("data-lane-prefixes"));
      if (laneRef) { laneRef.prefixes = prefixInput.value.split(",").map(function (item) { return item.trim(); }).filter(Boolean); saveLayout(); render(); }
    }
  });

  document.getElementById("edgeSvg").addEventListener("click", function (event) {
    var path = event.target.closest("[data-edge-index]");
    if (!path) return;
    selection = { type: "edge", index: Number(path.getAttribute("data-edge-index")) };
    renderLanes(); renderDetail();
  });

  document.getElementById("searchInput").addEventListener("input", function () { renderLanes(); });

  document.getElementById("addLaneButton").addEventListener("click", function () {
    var labelInput = document.getElementById("newLaneLabel");
    var prefixInput = document.getElementById("newLanePrefixes");
    var label = labelInput.value.trim();
    if (!label) { labelInput.focus(); return; }
    var prefixes = prefixInput.value.split(",").map(function (item) { return item.trim(); }).filter(Boolean);
    layout.lanes.push({ id: "lane-" + Date.now().toString(36), label: label, prefixes: prefixes });
    labelInput.value = ""; prefixInput.value = "";
    saveLayout(); render();
  });

  document.getElementById("autoArrangeButton").addEventListener("click", function () {
    layout.hostLane = {}; layout.hostOrder = {};
    saveLayout(); render();
  });

  document.getElementById("redrawButton").addEventListener("click", redrawLanes);

  function hostNamesText() {
    return Object.keys(layout.hostNames).sort().map(function (ip) { return ip + " = " + layout.hostNames[ip]; }).join("\\n");
  }

  function lanePresetsText() {
    return layout.lanes.map(function (lane) { return lane.label + " = " + (lane.prefixes || []).join(", "); }).join("\\n");
  }

  function lanePresetId(label, index) {
    var base = label.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "lane";
    return "lane-preset-" + base + "-" + index;
  }

  document.getElementById("hostNamesButton").addEventListener("click", function () {
    var panel = document.getElementById("hostNamesPanel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) {
      document.getElementById("hostNamesInput").value = hostNamesText();
      document.getElementById("hostMapProfileName").value = layout.hostNamesProfileName || DATA.setName || "Current capture set";
    }
  });

  document.getElementById("applyHostNamesButton").addEventListener("click", function () {
    var lines = document.getElementById("hostNamesInput").value.split("\\n");
    var mappings = [];
    lines.forEach(function (line) {
      var separator = line.indexOf("=");
      if (separator < 0) return;
      var ip = line.slice(0, separator).trim();
      var name = line.slice(separator + 1).trim();
      if (ip && name) mappings.push({ ip: ip, hostname: name });
    });
    try {
      var profile = normalizeHostnameMapProfile({ schema: "datasnare-ainetscope/hostname-map-v1",
        profileName: document.getElementById("hostMapProfileName").value, mappings: mappings });
      layout.hostNames = profile.mappings;
      layout.hostNamesProfileName = profile.profileName;
    } catch (error) {
      alert("Could not apply IP map: " + error.message);
      return;
    }
    layout.hostNamesProfileName = document.getElementById("hostMapProfileName").value.trim().slice(0, 100) || DATA.setName || "Current capture set";
    document.getElementById("hostNamesInput").value = hostNamesText();
    saveLayout(); render();
  });

  document.getElementById("exportHostMapButton").addEventListener("click", function () {
    var mappings = Object.keys(layout.hostNames).sort().map(function (ip) { return { ip: ip, hostname: layout.hostNames[ip] }; });
    var profile = { schema: "datasnare-ainetscope/hostname-map-v1", profileName: layout.hostNamesProfileName || DATA.setName || "Hostname map", mappings: mappings };
    downloadBlob(new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" }), fileBaseName() + "-ip-hostname-map.json");
  });

  document.getElementById("importHostMapButton").addEventListener("click", function () {
    document.getElementById("importHostMapInput").click();
  });

  document.getElementById("importHostMapInput").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { alert("IP map files are limited to 5 MiB."); return; }
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var profile = normalizeHostnameMapProfile(JSON.parse(String(reader.result || "{}")));
        layout.hostNames = profile.mappings;
        layout.hostNamesProfileName = profile.profileName;
        saveLayout();
        if (!document.getElementById("hostNamesPanel").hidden) {
          document.getElementById("hostNamesInput").value = hostNamesText();
          document.getElementById("hostMapProfileName").value = layout.hostNamesProfileName;
        }
        render();
        alert("Applied hostname map: " + profile.profileName + " (" + Object.keys(profile.mappings).length + " entries). This capture set's lanes and positions were not changed.");
      } catch (error) {
        alert("Could not import IP map: " + error.message);
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("lanePresetsButton").addEventListener("click", function () {
    var panel = document.getElementById("lanePresetsPanel");
    panel.hidden = !panel.hidden;
    if (!panel.hidden) document.getElementById("lanePresetsInput").value = lanePresetsText();
  });

  document.getElementById("applyLanePresetsButton").addEventListener("click", function () {
    var existingIds = {};
    layout.lanes.forEach(function (lane) { existingIds[lane.label] = lane.id; });
    var lanes = [];
    document.getElementById("lanePresetsInput").value.split("\\n").forEach(function (line) {
      var separator = line.indexOf("=");
      if (separator < 0) return;
      var label = line.slice(0, separator).trim();
      var prefixes = line.slice(separator + 1).split(",").map(function (item) { return item.trim(); }).filter(Boolean);
      if (!label) return;
      lanes.push({ id: existingIds[label] || lanePresetId(label, lanes.length), label: label, prefixes: prefixes });
    });
    if (!lanes.length) return;
    layout.lanes = lanes;
    layout.hostLane = {};
    layout.hostOrder = {};
    document.getElementById("lanePresetsInput").value = lanePresetsText();
    saveLayout(); render();
  });

  document.getElementById("resetLayoutButton").addEventListener("click", function () {
    if (!confirm("Reset lanes and positions for this capture set?")) return;
    try { localStorage.removeItem(STORAGE_KEY); } catch (error) { /* storage unavailable */ }
    layout = defaultLayout(); selection = null;
    saveLayout(); render();
  });

  document.getElementById("exportLayoutButton").addEventListener("click", function () {
    var blob = new Blob([JSON.stringify({ schema: "datasnare-ainetscope/topology-layout-v1", setId: DATA.setId, layout: layout }, null, 2)], { type: "application/json" });
    downloadBlob(blob, fileBaseName() + "-topology-layout.json");
  });

  document.getElementById("importLayoutButton").addEventListener("click", function () {
    document.getElementById("importLayoutInput").click();
  });

  document.getElementById("importLayoutInput").addEventListener("change", function (event) {
    var file = event.target.files && event.target.files[0];
    event.target.value = "";
    if (!file) return;
    var reader = new FileReader();
    reader.onload = function () {
      try {
        var imported = JSON.parse(String(reader.result || "{}"));
        var importedLayout = imported.layout || imported;
        if (!importedLayout || !Array.isArray(importedLayout.lanes)) throw new Error("Layout JSON must include a lanes array.");
        layout = {
          lanes: importedLayout.lanes.map(function (lane, index) {
            return {
              id: lane.id || lanePresetId(lane.label || "Lane " + (index + 1), index),
              label: lane.label || "Lane " + (index + 1),
              prefixes: Array.isArray(lane.prefixes) ? lane.prefixes : []
            };
          }),
          hostLane: importedLayout.hostLane || {},
          hostOrder: importedLayout.hostOrder || {},
          hostNames: importedLayout.hostNames || {},
          hostNamesProfileName: importedLayout.hostNamesProfileName || DATA.setName || "Current capture set"
        };
        selection = null;
        saveLayout(); render();
      } catch (error) {
        alert("Could not import layout JSON: " + error.message);
      }
    };
    reader.readAsText(file);
  });

  document.getElementById("exportMermaidButton").addEventListener("click", function () {
    downloadBlob(new Blob([buildMermaid()], { type: "text/plain;charset=utf-8" }), fileBaseName() + "-topology.mmd");
  });

  document.getElementById("exportPngButton").addEventListener("click", exportPng);

  function applyZoom(next) {
    zoomLevel = Math.max(0.6, Math.min(1.8, next));
    document.getElementById("lanesContainer").style.zoom = String(zoomLevel);
    document.getElementById("zoomResetButton").textContent = Math.round(zoomLevel * 100) + "%";
    scheduleEdgeRedraw();
  }

  document.getElementById("zoomInButton").addEventListener("click", function () { applyZoom(zoomLevel + 0.1); });
  document.getElementById("zoomOutButton").addEventListener("click", function () { applyZoom(zoomLevel - 0.1); });
  document.getElementById("zoomResetButton").addEventListener("click", function () { applyZoom(1); });
  window.addEventListener("resize", scheduleEdgeRedraw);
  document.getElementById("lanesWrapper").addEventListener("scroll", scheduleEdgeRedraw);

  render();
})();
`;

if (typeof module !== "undefined" && module.exports) {
  module.exports = { buildTopologyDocument, buildSingleCaptureTopologyPayload, normalizeHostnameMapProfile, HOSTNAME_MAP_SCHEMA };
}

if (typeof document !== "undefined") document.querySelector("#singleTopologyButton")?.addEventListener("click", openSingleCaptureTopology);
