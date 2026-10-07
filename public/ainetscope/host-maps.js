"use strict";

(function (root) {
  const SCHEMA = "datasnare-ainetscope/hostname-map-v1";
  const MAX_PROFILES = 100;
  const MAX_ENTRIES = 100000;

  function validIp(value) {
    const ipv4 = value.split(".");
    if (ipv4.length === 4 && ipv4.every(part => /^\d{1,3}$/.test(part) && Number(part) <= 255)) return true;
    if (!value.includes(":")) return false;
    try { return new URL(`http://[${value}]/`).hostname.length > 0; } catch (_) { return false; }
  }

  function normalizeProfile(profile) {
    if (!profile || profile.schema !== SCHEMA) throw new Error("Unsupported IP-to-hostname map format.");
    if (!Array.isArray(profile.mappings) || profile.mappings.length > MAX_ENTRIES) throw new Error(`Hostname map must contain no more than ${MAX_ENTRIES.toLocaleString()} mappings.`);
    const byIp = new Map();
    for (const item of profile.mappings) {
      const ip = String(item?.ip || "").trim();
      const hostname = String(item?.hostname || "").trim();
      const source = item?.source === "captured-dns" ? "captured-dns" : "manual";
      if (!validIp(ip)) throw new Error(`Invalid IP address in hostname map: ${ip}`);
      if (!hostname || hostname.length > 253 || /[\u0000-\u001f\u007f]/.test(hostname)) throw new Error(`Invalid hostname for ${ip}`);
      const current = byIp.get(ip);
      if (current && current.hostname !== hostname) {
        if (current.source === "manual" && source === "captured-dns") continue;
        if (current.source === "captured-dns" && source === "manual") { byIp.set(ip, { ip, hostname, source }); continue; }
        throw new Error(`Conflicting duplicate mapping for ${ip}`);
      }
      byIp.set(ip, { ip, hostname, source });
    }
    return { schema: SCHEMA, profileName: String(profile.profileName || "Imported hostname map").trim().slice(0, 100) || "Imported hostname map",
      mappings: [...byIp.values()].sort((left, right) => left.ip.localeCompare(right.ip)) };
  }

  function normalizeProfiles(value) {
    if (!Array.isArray(value)) return [];
    const profiles = [];
    for (const item of value.slice(0, MAX_PROFILES)) {
      try {
        const profile = normalizeProfile(item);
        const existing = profiles.findIndex(candidate => candidate.profileName === profile.profileName);
        if (existing < 0) profiles.push(profile);
        else profiles[existing] = profile;
      } catch (_) { }
    }
    return profiles;
  }

  function parseMappingText(text) {
    const mappings = [];
    for (const [index, line] of String(text || "").split(/\r?\n/).entries()) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith("#")) continue;
      const separator = trimmed.indexOf("=");
      if (separator < 0) throw new Error(`Line ${index + 1} must use IP address = hostname.`);
      mappings.push({ ip: trimmed.slice(0, separator).trim(), hostname: trimmed.slice(separator + 1).trim(), source: "manual" });
    }
    return mappings;
  }

  function displayName(address, profile) {
    const matches = (profile?.mappings || []).filter(item => item.ip === address);
    const match = matches.find(item => item.source === "manual") || matches[0];
    return match?.hostname || address;
  }

  function dnsSuggestions(packets) {
    const counts = new Map();
    for (const packet of packets || []) {
      for (const answer of packet.dnsAnswers || []) {
        if (!answer?.address || !answer?.name || !["A", "AAAA"].includes(answer.type)) continue;
        const key = `${answer.address}\u0000${answer.name}`;
        const entry = counts.get(key) || { ip: answer.address, hostname: answer.name, source: "captured-dns", observations: 0, minTtl: answer.ttl, firstTimestamp: packet.timestamp, lastTimestamp: packet.timestamp };
        entry.observations++;
        entry.minTtl = Number.isFinite(answer.ttl) ? Math.min(entry.minTtl ?? answer.ttl, answer.ttl) : entry.minTtl;
        entry.firstTimestamp = Math.min(entry.firstTimestamp ?? packet.timestamp, packet.timestamp);
        entry.lastTimestamp = Math.max(entry.lastTimestamp ?? packet.timestamp, packet.timestamp);
        counts.set(key, entry);
      }
    }
    const byIp = new Map();
    for (const candidate of counts.values()) {
      const current = byIp.get(candidate.ip);
      if (!current || candidate.observations > current.observations) byIp.set(candidate.ip, candidate);
    }
    return [...byIp.values()].sort((left, right) => left.ip.localeCompare(right.ip));
  }

  const api = Object.freeze({ SCHEMA, MAX_PROFILES, MAX_ENTRIES, normalizeProfile, normalizeProfiles, parseMappingText, displayName, dnsSuggestions });
  root.DataSnareHostMaps = api;

  if (typeof document === "undefined") return;

  function persist() {
    try { localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings)); }
    catch (_) { setStatus("Could not save profiles locally. Browser storage may be full."); return false; }
    return true;
  }

  function setStatus(message) {
    const status = document.querySelector("#hostMapStatus");
    if (status) status.textContent = message;
  }

  function selectedProfile() {
    return settings.hostMapProfiles.find(profile => profile.profileName === settings.activeHostMapProfile)
      || settings.hostMapProfiles[0] || null;
  }

  function loadProfile(profile) {
    document.querySelector("#hostMapProfileName").value = profile?.profileName || "";
    document.querySelector("#hostMapEntries").value = (profile?.mappings || [])
      .map(item => `${item.ip} = ${item.hostname}`).join("\n");
    if (profile) settings.activeHostMapProfile = profile.profileName;
    setStatus(profile ? `${profile.mappings.length.toLocaleString()} mappings · local profile` : "Create a profile or import a JSON map.");
  }

  function refreshSelector(preferredName) {
    const select = document.querySelector("#hostMapProfileSelect");
    const profiles = settings.hostMapProfiles;
    select.innerHTML = profiles.length
      ? profiles.map(profile => `<option value="${escapeHtml(profile.profileName)}">${escapeHtml(profile.profileName)}</option>`).join("")
      : '<option value="">No saved profiles</option>';
    const name = profiles.some(profile => profile.profileName === preferredName) ? preferredName
      : profiles.some(profile => profile.profileName === settings.activeHostMapProfile) ? settings.activeHostMapProfile : profiles[0]?.profileName || "";
    select.value = name;
    settings.activeHostMapProfile = name;
    loadProfile(profiles.find(profile => profile.profileName === name) || null);
  }

  function openManager() {
    refreshSelector(settings.activeHostMapProfile);
    document.querySelector("#hostMapDialog").showModal();
  }

  function refreshViews() {
    if (typeof state !== "undefined" && state.packets.length && !document.querySelector("#workspace").hidden) render();
    if (typeof twoSidedState !== "undefined" && twoSidedState.records.length) renderTwoSided();
  }

  function mapDownload(profile) {
    const blob = new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" });
    const link = document.createElement("a");
    link.href = URL.createObjectURL(blob);
    link.download = `${profile.profileName.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "hostname-map")}.json`;
    link.click();
    URL.revokeObjectURL(link.href);
  }

  document.querySelector("#singleHostMapButton")?.addEventListener("click", openManager);
  document.querySelector("#twoSidedHostMapButton")?.addEventListener("click", openManager);
  document.querySelector("#twoSidedToolbarHostMapButton")?.addEventListener("click", openManager);
  document.querySelector("#hostMapClose").addEventListener("click", () => document.querySelector("#hostMapDialog").close());
  document.querySelector("#hostMapProfileSelect").addEventListener("change", event => {
    const profile = settings.hostMapProfiles.find(item => item.profileName === event.target.value);
    if (profile) { settings.activeHostMapProfile = profile.profileName; loadProfile(profile); persist(); refreshViews(); }
  });
  document.querySelector("#hostMapNew").addEventListener("click", () => {
    document.querySelector("#hostMapProfileSelect").value = "";
    document.querySelector("#hostMapProfileName").value = "";
    document.querySelector("#hostMapEntries").value = "";
    setStatus("New profile. Enter mappings, then save and apply.");
    document.querySelector("#hostMapProfileName").focus();
  });
  document.querySelector("#hostMapApply").addEventListener("click", () => {
    const profileName = document.querySelector("#hostMapProfileName").value.trim();
    try {
      if (!profileName || profileName.length > 100) throw new Error("Enter a profile name (1–100 characters).");
      const profile = normalizeProfile({ schema: SCHEMA, profileName, mappings: parseMappingText(document.querySelector("#hostMapEntries").value) });
      const profiles = settings.hostMapProfiles.filter(item => item.profileName !== profile.profileName);
      if (profiles.length >= MAX_PROFILES) throw new Error(`No more than ${MAX_PROFILES} profiles can be saved.`);
      profiles.push(profile);
      settings.hostMapProfiles = profiles;
      settings.activeHostMapProfile = profile.profileName;
      if (!persist()) return;
      refreshSelector(profile.profileName);
      refreshViews();
      setStatus(`${profile.mappings.length.toLocaleString()} mappings saved and applied to visible endpoint labels. IP-based matching is unchanged.`);
    } catch (error) { setStatus(error.message); }
  });
  document.querySelector("#hostMapDelete").addEventListener("click", () => {
    const profile = selectedProfile();
    if (!profile) return;
    settings.hostMapProfiles = settings.hostMapProfiles.filter(item => item.profileName !== profile.profileName);
    settings.activeHostMapProfile = settings.hostMapProfiles[0]?.profileName || "";
    persist();
    refreshSelector(settings.activeHostMapProfile);
    refreshViews();
  });
  document.querySelector("#hostMapExport").addEventListener("click", () => {
    const profile = selectedProfile();
    if (profile) mapDownload(profile);
  });
  document.querySelector("#hostMapImportButton").addEventListener("click", () => document.querySelector("#hostMapImportInput").click());
  document.querySelector("#hostMapImportInput").addEventListener("change", event => {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file) return;
    if (file.size > 5 * 1024 * 1024) { setStatus("Map files are limited to 5 MiB."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const imported = normalizeProfile(JSON.parse(String(reader.result || "{}")));
        if (settings.hostMapProfiles.some(item => item.profileName === imported.profileName)
          && !confirm(`Replace the saved profile "${imported.profileName}"?`)) return;
        const profiles = settings.hostMapProfiles.filter(item => item.profileName !== imported.profileName);
        if (profiles.length >= MAX_PROFILES) throw new Error(`No more than ${MAX_PROFILES} profiles can be saved.`);
        profiles.push(imported);
        settings.hostMapProfiles = profiles;
        settings.activeHostMapProfile = imported.profileName;
        if (!persist()) return;
        refreshSelector(imported.profileName);
        refreshViews();
        setStatus(`Imported and applied ${imported.profileName} (${imported.mappings.length.toLocaleString()} mappings).`);
      } catch (error) { setStatus(`Could not import map: ${error.message}`); }
    };
    reader.readAsText(file);
  });
  document.querySelector("#hostMapSuggestDns").addEventListener("click", () => {
    const packets = !document.querySelector("#twoSidedWorkspace").hidden && typeof twoSidedState !== "undefined"
      ? [...twoSidedState.packetsA, ...twoSidedState.packetsB]
      : (typeof state !== "undefined" ? state.packets : []);
    const suggestions = dnsSuggestions(packets);
    const text = document.querySelector("#hostMapEntries");
    const existing = new Set();
    try { parseMappingText(text.value).forEach(item => existing.add(item.ip)); }
    catch (error) { setStatus(`Fix the current mappings before adding suggestions: ${error.message}`); return; }
    const additions = suggestions.filter(item => !existing.has(item.ip));
    if (additions.length) {
      const prefix = text.value.trim() ? `${text.value.trim()}\n` : "";
      const observedTime = value => Number.isFinite(value) ? new Date(value * 1000).toISOString() : "unknown time";
      text.value = `${prefix}${additions.flatMap(item => [
        `# Captured DNS suggestion · ${item.observations} answer(s) · min TTL ${item.minTtl ?? "unknown"}s · ${observedTime(item.firstTimestamp)} to ${observedTime(item.lastTimestamp)}`,
        `${item.ip} = ${item.hostname}`
      ]).join("\n")}`;
    }
    const conflicts = suggestions.length - additions.length;
    setStatus(`${suggestions.length} captured A/AAAA candidates; added ${additions.length}, left ${conflicts} existing IP mapping(s) unchanged. Suggestions are trace observations, not verified current DNS.`);
  });
  document.addEventListener("DOMContentLoaded", () => refreshSelector(settings.activeHostMapProfile), { once: true });
})(typeof globalThis !== "undefined" ? globalThis : this);
