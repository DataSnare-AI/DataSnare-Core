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

function renderReportStatusBadge(check, className = "report-status") {
  const normalized = normalizeReportCheck(check);
  const safeClass = /^[a-z][a-z0-9-]*$/i.test(className) ? className : "report-status";
  return `<span class="${safeClass} ${safeClass}--${normalized.state}">${escapeReportHtml(normalized.statusLabel)}</span>`;
}

function twoSidedReportCheckState(category, metrics = {}, reduced = false, severity = "info") {
  if (reduced && ["network.loss-diagnostics", "network.flow-control"].includes(category)) return "not-assessed";
  if (category === "network.path-performance") return metrics.matched > 0 ? "observed" : "not-assessed";
  if (category === "network.loss-diagnostics") {
    const loss = metrics.loss;
    if (!loss || loss.onlyA === null || loss.onlyB === null || metrics.ambiguous === null) return "not-assessed";
    return loss.onlyA || loss.onlyB || metrics.ambiguous ? "review" : "clear";
  }
  if (category === "network.middlebox") {
    if (reduced || !(metrics.middlebox?.matchedCompleteHandshakes > 0)) return "not-assessed";
    return metrics.middlebox.differencesTotal > 0 ? "review" : "clear";
  }
  if (category === "network.flow-control") {
    const flows = [metrics.flowA, metrics.flowB].filter(Boolean);
    if (!flows.some(flow => flow.windowSamples > 0 || flow.flight?.count > 0)) return "not-assessed";
    return flows.some(flow => flow.zeroWindows > 0) ? "review" : "clear";
  }
  return severity === "warning" ? "review" : "observed";
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

function sharedReportCoverageHtml(scopeDescription, filter = null) {
  const escape = escapeReportHtml;
  const filterDescription = filter ? `<p style="margin:4px 0;color:var(--muted);font-size:10px;overflow-wrap:anywhere"><strong>Applied ${filter.mode === "display" ? "Display Filter" : "Text filter"}:</strong> <code>${escape(filter.expression || "All packets")}</code> · ${escape(filter.matched)} of ${escape(filter.total)} packets · Protocol: ${escape(filter.protocol === "all" ? "All protocols" : filter.protocol)}</p>` : "";
  return `<article class="method-item" style="padding:10px 0;border-bottom:1px solid var(--line);break-inside:avoid"><h3 style="margin:0 0 4px;color:var(--green);font-size:13px">Scope and coverage</h3><p style="margin:4px 0;color:var(--muted);font-size:10px">${escape(scopeDescription)} Capture boundaries, filters, packet loss, and asymmetric visibility may omit traffic; absence in this report does not establish that an event did not occur.</p>${filterDescription}</article>`;
}

function sharedReportInterpretationHtml() {
  return `<p class="method-callout" style="margin:16px 0;padding:10px;border-left:3px solid var(--gold);background:#f5f2e9;font-size:10px"><strong>Interpretation:</strong> “Not observed” means the signal was absent from decoded evidence in this scope. “No issue detected” means a supported check ran and found no matching signal. “Not assessed” means evidence or decoding was insufficient. None of these states proves the network or service is healthy; verify important findings against frames, endpoint logs, and appropriately placed captures.</p>`;
}

function addSharedPrintFrame(html, orientation = "portrait") {
  const pageOrientation = orientation === "landscape" ? "landscape" : "portrait";
  const sharedStyles = `@page{size:A4 ${pageOrientation};margin:12mm}@media print{body{background:#fff!important}.toolbar{display:none!important}.report{max-width:none!important;margin:0!important;padding:0!important;box-shadow:none!important}}`;
  const closing = "</style></head>";
  if (!String(html).includes(closing)) throw new Error("Report HTML is missing its closing style/head boundary.");
  return String(html).replace(closing, `</style><style>${sharedStyles}</style></head>`);
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
  CAPTURE_SET_REPORT_MAXIMA, escapeReportHtml, normalizeReportCheck, renderReportStatusBadge, normalizeCaptureSetReportOptions,
  twoSidedReportCheckState, sharedReportCoverageHtml, sharedReportInterpretationHtml, addSharedPrintFrame, createReportModel };
if (typeof module !== "undefined" && module.exports) module.exports = dataSnareReportCommonApi;
if (typeof globalThis !== "undefined") globalThis.DataSnareReportCommon = dataSnareReportCommonApi;
