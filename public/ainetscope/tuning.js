"use strict";

const ANALYSIS_PROFILE_SCHEMA = "datasnare-ainetscope/profile-v1";
const ANALYSIS_PROFILE_FIELDS = ["latencyP95Ms", "serviceLatencyMs", "retransmissions", "duplicateAcks", "tcpResets", "handshakeFailures", "zeroWindows", "dominantFlowPercent", "serviceErrors", "captureGapSeconds", "gapDurationFraction", "batchLatencyMultiplier", "batchLatencyFloorMs", "trafficSpikeMultiplier"];
const ANALYSIS_PROFILE_DEFAULTS = {
  latencyP95Ms: 200, serviceLatencyMs: 250, retransmissions: 1, duplicateAcks: 3, tcpResets: 1, handshakeFailures: 1, zeroWindows: 1, dominantFlowPercent: 60, serviceErrors: 1,
  captureGapSeconds: 1, gapDurationFraction: .1, batchLatencyMultiplier: 2, batchLatencyFloorMs: 100, trafficSpikeMultiplier: 3
};
const BUILTIN_ANALYSIS_PROFILES = [
  { id: "default", name: "Default", description: "Balanced thresholds for general packet triage and mixed application traffic.", focusProtocols: ["TDS"], thresholds: { ...ANALYSIS_PROFILE_DEFAULTS } },
  { id: "tds-database", name: "TDS Database", description: "Tighter response-time and transport thresholds for SQL Server sessions, with TDS errors promoted to high severity.", focusProtocols: ["TDS"], thresholds: { ...ANALYSIS_PROFILE_DEFAULTS, latencyP95Ms: 75, serviceLatencyMs: 100, duplicateAcks: 2, dominantFlowPercent: 80, batchLatencyFloorMs: 50, batchLatencyMultiplier: 1.7, trafficSpikeMultiplier: 2.5 } },
  { id: "wifi-wan", name: "Wi-Fi / WAN", description: "Allows higher latency and burst variation while emphasizing sustained retransmission, DNS, and QUIC symptoms.", focusProtocols: ["DNS", "QUIC"], thresholds: { ...ANALYSIS_PROFILE_DEFAULTS, latencyP95Ms: 150, serviceLatencyMs: 250, retransmissions: 3, duplicateAcks: 5, handshakeFailures: 2, captureGapSeconds: 2, gapDurationFraction: .2, batchLatencyFloorMs: 125, batchLatencyMultiplier: 2.5, trafficSpikeMultiplier: 4 } },
  { id: "smb-file-server", name: "SMB File Server", description: "Emphasizes SMB errors, receiver stalls, retransmissions, and latency affecting file-server workloads.", focusProtocols: ["SMB", "SMB2"], thresholds: { ...ANALYSIS_PROFILE_DEFAULTS, latencyP95Ms: 100, serviceLatencyMs: 125, retransmissions: 2, duplicateAcks: 3, dominantFlowPercent: 85, batchLatencyFloorMs: 75, batchLatencyMultiplier: 1.8, trafficSpikeMultiplier: 2.5 } }
];

function profileStorageRead(key, fallback) {
  try { return JSON.parse(localStorage.getItem(key)) ?? fallback; } catch (_) { return fallback; }
}

function profileStorageWrite(key, value) {
  try { localStorage.setItem(key, JSON.stringify(value)); } catch (_) { /* Profiles remain usable for this session. */ }
}

function normalizeAnalysisProfile(profile) {
  const thresholds = {};
  ANALYSIS_PROFILE_FIELDS.forEach(field => {
    const value = Number(profile?.thresholds?.[field]);
    thresholds[field] = Number.isFinite(value) && value >= 0 ? value : ANALYSIS_PROFILE_DEFAULTS[field];
  });
  ["batchLatencyMultiplier", "trafficSpikeMultiplier"].forEach(field => { thresholds[field] = Math.max(1, thresholds[field]); });
  thresholds.dominantFlowPercent = Math.min(100, thresholds.dominantFlowPercent);
  return {
    schema: ANALYSIS_PROFILE_SCHEMA,
    id: String(profile?.id || `custom-${Date.now()}`),
    name: String(profile?.name || "Custom profile").slice(0, 60),
    description: String(profile?.description || "User-defined expert analysis thresholds."),
    focusProtocols: [...new Set((profile?.focusProtocols || []).map(value => String(value).trim().toUpperCase()).filter(Boolean))],
    thresholds
  };
}

let customAnalysisProfiles = profileStorageRead("datasnare-analysis-profiles", []).map(normalizeAnalysisProfile);
let activeAnalysisProfile = normalizeAnalysisProfile(profileStorageRead("datasnare-active-analysis-profile", BUILTIN_ANALYSIS_PROFILES[0]));

function getActiveAnalysisProfile() {
  return activeAnalysisProfile;
}

function analysisRuleEnabled(profile, name) {
  return Number(profile.thresholds[name]) > 0;
}

function protocolIsFocused(profile, protocol) {
  return profile.focusProtocols.includes(String(protocol).toUpperCase());
}

function allAnalysisProfiles() {
  return [...BUILTIN_ANALYSIS_PROFILES.map(normalizeAnalysisProfile), ...customAnalysisProfiles];
}

function populateProfileSelect(selectedId = activeAnalysisProfile.id) {
  const select = $("#profileSelect");
  select.innerHTML = `<optgroup label="Built-in">${BUILTIN_ANALYSIS_PROFILES.map(profile => `<option value="${profile.id}">${escapeHtml(profile.name)}</option>`).join("")}</optgroup>${customAnalysisProfiles.length ? `<optgroup label="Custom">${customAnalysisProfiles.map(profile => `<option value="${escapeHtml(profile.id)}">${escapeHtml(profile.name)}</option>`).join("")}</optgroup>` : ""}`;
  select.value = allAnalysisProfiles().some(profile => profile.id === selectedId) ? selectedId : "default";
}

function writeProfileEditor(profile) {
  const normalized = normalizeAnalysisProfile(profile);
  $("#profileNameInput").value = normalized.name;
  $("#profileDescription").textContent = normalized.description;
  $("#profileProtocolsInput").value = normalized.focusProtocols.join(", ");
  ANALYSIS_PROFILE_FIELDS.forEach(field => { $(`[data-profile-field="${field}"]`).value = normalized.thresholds[field]; });
  $("#deleteProfileButton").disabled = BUILTIN_ANALYSIS_PROFILES.some(item => item.id === normalized.id);
}

function readProfileEditor(id = $("#profileSelect").value) {
  const source = allAnalysisProfiles().find(profile => profile.id === id) || activeAnalysisProfile;
  const thresholds = {};
  ANALYSIS_PROFILE_FIELDS.forEach(field => { thresholds[field] = Math.max(0, Number($(`[data-profile-field="${field}"]`).value) || 0); });
  return normalizeAnalysisProfile({ ...source, id, name: $("#profileNameInput").value.trim() || source.name, focusProtocols: $("#profileProtocolsInput").value.split(","), thresholds });
}

function openProfileEditor() {
  populateProfileSelect(activeAnalysisProfile.id);
  writeProfileEditor(activeAnalysisProfile);
  $("#profileDialog").showModal();
}

function applyAnalysisProfile(profile, notify = true) {
  activeAnalysisProfile = normalizeAnalysisProfile(profile);
  profileStorageWrite("datasnare-active-analysis-profile", activeAnalysisProfile);
  $("#activeProfileName").textContent = activeAnalysisProfile.name;
  if (state.packets.length) render();
  if (typeof refreshCaptureSetProfile === "function") refreshCaptureSetProfile();
  if (notify) showToast(`${activeAnalysisProfile.name} analysis profile applied.`);
}

function saveCustomProfile() {
  const draft = readProfileEditor();
  const existingBuiltIn = BUILTIN_ANALYSIS_PROFILES.some(profile => profile.id === draft.id);
  const id = existingBuiltIn ? `custom-${Date.now()}` : draft.id;
  const fallbackName = existingBuiltIn ? `${draft.name} Custom` : draft.name;
  const requestedName = $("#profileNameInput").value.trim();
  const customName = existingBuiltIn && requestedName === draft.name ? fallbackName : requestedName || fallbackName;
  const custom = normalizeAnalysisProfile({ ...draft, id, name: customName, description: "User-defined expert analysis thresholds." });
  const index = customAnalysisProfiles.findIndex(profile => profile.id === id);
  if (index >= 0) customAnalysisProfiles[index] = custom; else customAnalysisProfiles.push(custom);
  profileStorageWrite("datasnare-analysis-profiles", customAnalysisProfiles);
  populateProfileSelect(id); writeProfileEditor(custom); applyAnalysisProfile(custom, false);
  $("#saveProfileButton").textContent = "Update custom";
  showToast(`${custom.name} profile saved locally.`);
}

function deleteCustomProfile() {
  const id = $("#profileSelect").value;
  if (BUILTIN_ANALYSIS_PROFILES.some(profile => profile.id === id)) return;
  customAnalysisProfiles = customAnalysisProfiles.filter(profile => profile.id !== id);
  profileStorageWrite("datasnare-analysis-profiles", customAnalysisProfiles);
  populateProfileSelect("default"); writeProfileEditor(BUILTIN_ANALYSIS_PROFILES[0]); applyAnalysisProfile(BUILTIN_ANALYSIS_PROFILES[0], false);
  showToast("Custom profile deleted.");
}

function exportAnalysisProfile() {
  const profile = readProfileEditor();
  const link = document.createElement("a"); link.href = URL.createObjectURL(new Blob([JSON.stringify(profile, null, 2)], { type: "application/json" })); link.download = `${profile.name.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "") || "analysis-profile"}.json`; link.click(); URL.revokeObjectURL(link.href);
}

async function importAnalysisProfile(file) {
  try {
    const parsed = JSON.parse(await file.text());
    if (parsed.schema !== ANALYSIS_PROFILE_SCHEMA || !parsed.thresholds) throw new Error("Unsupported analysis profile schema.");
    const profile = normalizeAnalysisProfile({ ...parsed, id: `custom-${Date.now()}` });
    customAnalysisProfiles.push(profile); profileStorageWrite("datasnare-analysis-profiles", customAnalysisProfiles);
    populateProfileSelect(profile.id); writeProfileEditor(profile); applyAnalysisProfile(profile, false);
    showToast(`${profile.name} profile imported.`);
  } catch (error) { showToast(`Could not import profile: ${error.message}`); }
}

$("#activeProfileName").textContent = activeAnalysisProfile.name;
$("#profileButton").addEventListener("click", openProfileEditor);
$("#globalProfileButton").addEventListener("click", openProfileEditor);
$("#closeProfileDialog").addEventListener("click", () => $("#profileDialog").close());
$("#profileSelect").addEventListener("change", event => { const profile = allAnalysisProfiles().find(item => item.id === event.target.value); if (profile) { writeProfileEditor(profile); $("#saveProfileButton").textContent = BUILTIN_ANALYSIS_PROFILES.some(item => item.id === profile.id) ? "Save as custom" : "Update custom"; } });
$("#applyProfileButton").addEventListener("click", () => { applyAnalysisProfile(readProfileEditor()); $("#profileDialog").close(); });
$("#saveProfileButton").addEventListener("click", saveCustomProfile);
$("#deleteProfileButton").addEventListener("click", deleteCustomProfile);
$("#exportProfileButton").addEventListener("click", exportAnalysisProfile);
$("#importProfileButton").addEventListener("click", () => $("#profileImportInput").click());
$("#profileImportInput").addEventListener("change", event => { if (event.target.files[0]) importAnalysisProfile(event.target.files[0]); event.target.value = ""; });

window.DataSnareAnalysisProfiles = Object.freeze({ schema: ANALYSIS_PROFILE_SCHEMA, presets: BUILTIN_ANALYSIS_PROFILES, getActive: getActiveAnalysisProfile, apply: applyAnalysisProfile });
