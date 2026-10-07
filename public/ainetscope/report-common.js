"use strict";

const REPORT_MODEL_SCHEMA = "datasnare-ainetscope/report-model-v1";
const CAPTURE_SET_REPORT_DEFAULTS = Object.freeze({
  fileLimit: 100,
  findingLimit: 100,
  hostLimit: 30,
  edgeLimit: 50,
  protocolLimit: 12,
  orientation: "landscape"
});
const CAPTURE_SET_REPORT_MAXIMA = Object.freeze({ fileLimit: 1000, findingLimit: 1000, hostLimit: 500, edgeLimit: 1000, protocolLimit: 100 });
const REPORT_STATES = Object.freeze({
  issue: "Issue signal",
  review: "Review",
  observed: "Observed",
  clear: "No issue detected",
  "not-observed": "Not observed",
  "not-assessed": "Not assessed"
});

function escapeReportHtml(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  })[character]);
}

function normalizeReportCheck(check = {}) {
  const state = Object.hasOwn(REPORT_STATES, check.state) ? check.state : "not-assessed";
  return {
    group: String(check.group || "General"),
    name: String(check.name || "Unnamed check"),
    severity: String(check.severity || "low"),
    state,
    statusLabel: REPORT_STATES[state],
    evidence: String(check.evidence || ""),
    limitation: String(check.limitation || "")
  };
}

function normalizeCaptureSetReportOptions(options = {}) {
  const normalized = {};
  for (const key of Object.keys(CAPTURE_SET_REPORT_MAXIMA)) {
    if ((key === "hostLimit" || key === "edgeLimit") && options[key] === "all") {
      normalized[key] = "all";
      continue;
    }
    const parsed = Number(options[key]);
    normalized[key] = Number.isFinite(parsed)
      ? Math.max(1, Math.min(CAPTURE_SET_REPORT_MAXIMA[key], Math.floor(parsed)))
      : CAPTURE_SET_REPORT_DEFAULTS[key];
  }
  normalized.orientation = options.orientation === "portrait" ? "portrait" : "landscape";
  return normalized;
}

function createReportModel(model = {}) {
  const checks = (model.checks || model.triageChecks || []).map(normalizeReportCheck);
  return {
    ...model,
    schema: REPORT_MODEL_SCHEMA,
    mode: String(model.mode || "unspecified"),
    generatedAt: String(model.generatedAt || new Date().toISOString()),
    sources: Array.isArray(model.sources) ? model.sources : [],
    scope: model.scope ?? {},
    metrics: model.metrics ?? [],
    findings: Array.isArray(model.findings) ? model.findings : [],
    checks,
    triageChecks: checks,
    caveats: Array.isArray(model.caveats) ? model.caveats : []
  };
}

const dataSnareReportCommonApi = { REPORT_MODEL_SCHEMA, REPORT_STATES, CAPTURE_SET_REPORT_DEFAULTS,
  CAPTURE_SET_REPORT_MAXIMA, escapeReportHtml, normalizeReportCheck, normalizeCaptureSetReportOptions, createReportModel };
if (typeof module !== "undefined" && module.exports) module.exports = dataSnareReportCommonApi;
if (typeof globalThis !== "undefined") globalThis.DataSnareReportCommon = dataSnareReportCommonApi;
