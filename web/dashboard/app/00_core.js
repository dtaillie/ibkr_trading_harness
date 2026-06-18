import { helpModeBoundaryText, helpPerformanceGuideText } from "./10_help.js";
import { latestArtifactPerformance, latestTelemetryRun, workbenchEvidenceText } from "./20_workbench_foundation.js";
import { finiteNumber, firstPresent, latestAccountRow, normalizedRunMetrics, shortTimestampAgeLabel, symbolInventoryModel, timestampAgeLabel, timestampMillis } from "./30_runtime_core.js";
import { performanceRollupContinuityText } from "./33_performance_views.js";
import { dataInventoryEvidenceText } from "./41_data_explorer.js";
import { symbolBatchDiagnosticReportText } from "./42_data_symbols.js";
import { fetchEvidenceText } from "./50_fetch.js";
import { activityChanges, runsEvidenceText } from "./70_runs.js";
import { operationsEvidenceText, remoteNodeHealthReportText } from "./80_operations.js";
import { refresh, refreshDataLibrary } from "./90_bootstrap.js";

export const AUTO_REFRESH_INTERVAL_MS = 60000;

export const state = {
  status: null,
  history: [],
  dataCatalog: { datasets: [], errors: [] },
  dataSymbolIndex: { symbols: [], files: [], errors: [] },
  dataSymbolIndexDetail: null,
  dataSymbolDirectory: { symbols: [], symbol_summaries: [], errors: [] },
  dataHistoryMatrix: { rows: [], groups: [], errors: [] },
  dataDetail: null,
  dataDetailPath: "",
  dataCoverage: { symbols: [], date_bins: [], errors: [] },
  dataGapSummary: { gap_rows: [], calendar_rows: [] },
  dataMinuteHeatmap: { rows: [], errors: [] },
  dataStorageAudit: { configured_roots: [], suggested_roots: [], warnings: [] },
  dataEndpointContracts: [],
  dataLibrary: {
    catalogLoading: false,
    diagnosticsLoading: false,
    catalogLoaded: false,
    diagnosticsLoaded: false,
    catalogError: "",
    diagnosticsError: "",
    diagnosticsRequested: false,
    catalogLimitTouched: false,
    catalogOffset: 0,
    requestId: 0,
  },
  dataCompare: null,
  dataCompareSelectedPaths: [],
  dataCompareSelectionCleared: false,
  symbolDiagnostic: null,
  symbolBatchDiagnostic: null,
  symbolBatchDiagnosticReportText: "",
  symbolTypeaheadActiveIndex: 0,
  fetchManifests: { manifests: [], roots: [], errors: [] },
  runtimeSessions: { sessions: [], errors: [] },
  runtimeSessionDetail: null,
  fetchManifestDetail: null,
  manifestPathFilter: null,
  workbenchStatus: {},
  cleanupPlan: {},
  diagnostics: {},
  endpointMap: { endpoints: [] },
  configOptions: { plugins: [], modes: [], defaults: {} },
  workbenchExtraDatasets: {},
  configDraft: null,
  configDraftErrors: [],
  alignmentPreview: null,
  configDrafts: { drafts: [], errors: [] },
  draftValidations: { validations: [] },
  configRuns: { runs: [] },
  runComparison: { runs: [], leaders: {} },
  performanceRollups: { rollups: [], errors: [] },
  statusEquityRollups: { rollups: [], period_rollups: {} },
  runDetail: null,
  runEvidence: null,
  configArtifacts: null,
  refreshInFlight: false,
  statusFetchError: "",
  telemetryAccount: { run_id: "", account: [] },
  performanceTelemetryRunId: "",
  performanceSourceMode: "current",
  performanceBenchmarkPath: "",
  performanceBenchmarkDetail: null,
  workbenchEvidenceText: "",
  fetchEvidenceText: "",
  dataInventoryEvidenceText: "",
  operationsEvidenceText: "",
  runsEvidenceText: "",
  helpPerformanceGuideText: "",
  helpModeBoundaryText: "",
  performanceRollupContinuityText: "",
  remoteNodeHealthReportText: "",
  commands: [],
  results: [],
  commandAudit: { events: [] },
  remoteNodes: { nodes: [] },
  remoteNodeDetail: null,
  refreshContracts: [],
  refreshErrors: [],
  refreshLoaded: false,
  activityChanges: { items: [], initial: true },
};

export const commandFields = {
  flatten_simulated_positions: ["config"],
  pause_runner: [],
  request_status: [],
  restart_child_process: ["supervisor", "job"],
  resume_runner: [],
  run_supervisor_once: ["supervisor"],
  summarize_run: ["run"],
  supervisor_status: ["supervisor"],
  validate_config: ["config"],
  validate_supervisor_config: ["supervisor"],
};

export const commandParamNames = {
  config: "config_id",
  job: "job_id",
  run: "run_id",
  supervisor: "supervisor_id",
};

export const commandBoundaries = {
  flatten_simulated_positions: {
    klass: "control",
    title: "Flatten simulated file-broker positions",
    note: "Submits offsetting orders only against configured file-backed local broker state. It refuses IBKR and other broker adapters.",
    confirm: true,
  },
  pause_runner: {
    klass: "control",
    title: "Pause runner",
    note: "Writes the configured local pause marker. A runner or supervisor must be configured to honor that marker.",
    confirm: true,
  },
  request_status: {
    klass: "read-only",
    title: "Request fresh status",
    note: "Collects and posts a fresh public-safe status snapshot from the configured local status publisher.",
    confirm: false,
  },
  restart_child_process: {
    klass: "launcher",
    title: "Restart managed child process",
    note: "Writes a configured supervisor job restart marker. The local supervisor owns the process stop/start and applies its restart limits.",
    confirm: true,
  },
  resume_runner: {
    klass: "control",
    title: "Resume runner",
    note: "Removes the configured local pause marker if it exists.",
    confirm: true,
  },
  run_supervisor_once: {
    klass: "launcher",
    title: "Run supervisor once",
    note: "Runs the configured local supervisor evaluation once and may launch due configured jobs.",
    confirm: true,
  },
  summarize_run: {
    klass: "read-only",
    title: "Summarize saved run",
    note: "Reads a configured local run directory and returns a bounded public-safe summary.",
    confirm: false,
  },
  supervisor_status: {
    klass: "read-only",
    title: "Read supervisor status",
    note: "Reads the configured supervisor state file without launching jobs.",
    confirm: false,
  },
  validate_config: {
    klass: "read-only",
    title: "Validate runner config",
    note: "Validates a configured plugin-runner config without running it.",
    confirm: false,
  },
  validate_supervisor_config: {
    klass: "read-only",
    title: "Validate supervisor config",
    note: "Validates a configured supervisor config without running jobs.",
    confirm: false,
  },
};

export const $ = (id) => document.getElementById(id);
export const MAX_DATA_COMPARE_DATASETS = 8;

export function onOptional(id, eventName, handler) {
  const element = $(id);
  if (element) element.addEventListener(eventName, handler);
}

export function token() {
  return sessionStorage.getItem("statusToken") || "";
}

export function headers() {
  const out = { "Content-Type": "application/json" };
  const value = token();
  if (value) out.Authorization = `Bearer ${value}`;
  return out;
}

export async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    let detail = "";
    try {
      const body = await response.clone().json();
      detail = body && body.error ? String(body.error) : "";
    } catch {
      detail = "";
    }
    throw new Error(detail ? `${response.status} ${response.statusText}: ${detail}` : `${response.status} ${response.statusText}`);
  }
  return response.json();
}

export async function fetchOptionalJson(label, url, fallback) {
  try {
    return { label, payload: await fetchJson(url), error: "" };
  } catch (err) {
    return {
      label,
      payload: typeof fallback === "function" ? fallback() : fallback,
      error: err && err.message ? err.message : String(err),
    };
  }
}

export function dataEndpointPayloadSummary(payload = {}) {
  if (!payload || typeof payload !== "object") return "no payload";
  const pieces = [];
  if (Array.isArray(payload.datasets)) pieces.push(`${numberText(payload.datasets.length, 0)} dataset${payload.datasets.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.symbols)) pieces.push(`${numberText(payload.symbols.length, 0)} symbol${payload.symbols.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.symbol_summaries)) pieces.push(`${numberText(payload.symbol_summaries.length, 0)} symbol summar${payload.symbol_summaries.length === 1 ? "y" : "ies"}`);
  if (Array.isArray(payload.rows)) pieces.push(`${numberText(payload.rows.length, 0)} row${payload.rows.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.groups)) pieces.push(`${numberText(payload.groups.length, 0)} group${payload.groups.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.files)) pieces.push(`${numberText(payload.files.length, 0)} file${payload.files.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.date_bins)) pieces.push(`${numberText(payload.date_bins.length, 0)} date bin${payload.date_bins.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.gap_rows)) pieces.push(`${numberText(payload.gap_rows.length, 0)} gap row${payload.gap_rows.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.calendar_rows)) pieces.push(`${numberText(payload.calendar_rows.length, 0)} calendar row${payload.calendar_rows.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.configured_roots)) pieces.push(`${numberText(payload.configured_roots.length, 0)} configured root${payload.configured_roots.length === 1 ? "" : "s"}`);
  if (Array.isArray(payload.suggested_roots)) pieces.push(`${numberText(payload.suggested_roots.length, 0)} suggested root${payload.suggested_roots.length === 1 ? "" : "s"}`);
  const total = Number(payload.total || payload.total_count || payload.symbol_count || payload.file_count || 0);
  if (Number.isFinite(total) && total > 0) pieces.push(`total ${numberText(total, 0)}`);
  const cache = payload.scan_cache && payload.scan_cache.status ? `cache ${text(payload.scan_cache.status)}` : "";
  if (cache) pieces.push(cache);
  const errors = Array.isArray(payload.errors) ? payload.errors.length : 0;
  if (errors) pieces.push(`${numberText(errors, 0)} payload warning${errors === 1 ? "" : "s"}`);
  const warnings = Array.isArray(payload.warnings) ? payload.warnings.length : 0;
  if (warnings) pieces.push(`${numberText(warnings, 0)} warning${warnings === 1 ? "" : "s"}`);
  return pieces.length ? pieces.join("; ") : "loaded payload";
}

export function dataEndpointContract(label, url, payload, { durationMs = null, error = "", fallback = "" } = {}) {
  const warningCount = payload && Array.isArray(payload.errors) ? payload.errors.length : 0;
  const payloadWarningCount = payload && Array.isArray(payload.warnings) ? payload.warnings.length : 0;
  const status = error ? "warn" : warningCount || payloadWarningCount ? "warn" : "ok";
  const parts = [
    url,
    error ? `failed: ${error}` : dataEndpointPayloadSummary(payload),
    Number.isFinite(Number(durationMs)) ? `client ${durationMsText(durationMs)}` : "",
    fallback ? `fallback: ${fallback}` : "",
  ].filter(Boolean);
  return {
    label: `data ${label}`,
    status,
    detail: parts.join(" / "),
  };
}

export async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

export function text(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  return String(value);
}

export function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

export function money(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(number);
}

export function numberText(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

export function pctText(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number.toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
}

export function signedValueClass(value) {
  if (value === null || value === undefined || value === "") return "value-neutral";
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "value-neutral";
  return number > 0 ? "value-gain" : "value-loss";
}

export function drawdownValueClass(value) {
  if (value === null || value === undefined || value === "") return "value-neutral";
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "value-neutral";
  return "value-loss";
}

export function valueHtml(value, formatter, className) {
  return `<span class="${escapeHtml(className)}">${escapeHtml(formatter(value))}</span>`;
}

export function signedValueHtml(value, formatter = numberText) {
  return valueHtml(value, formatter, signedValueClass(value));
}

export function cashValueHtml(value) {
  return valueHtml(value, money, "value-cash");
}

export function equityValueHtml(value) {
  return valueHtml(value, money, "value-equity");
}

export function bytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  if (number < 1024 * 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)} MB`;
  return `${(number / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

export function age(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 120) return `${Math.round(number)}s`;
  if (number < 7200) return `${Math.round(number / 60)}m`;
  if (number < 172800) return `${Math.round(number / 3600)}h`;
  return `${Math.round(number / 86400)}d`;
}

export function interval(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 120) return `${Math.round(number)}s`;
  if (number < 7200) return `${Math.round(number / 60)}m`;
  if (number < 172800) return `${Math.round(number / 3600)}h`;
  return `${Math.round(number / 86400)}d`;
}

export function durationMsText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 1000) return `${numberText(number, 1)}ms`;
  return interval(number / 1000);
}

export function statusClass(value) {
  if (value === "ok" || value === true || value === "completed" || value === "running" || value === "waiting") return "status-ok";
  if (value === "warn" || value === "pending" || value === "paused" || value === "canceled") return "status-warn";
  if (value === "bad" || value === "failed" || value === "rejected" || value === "timeout" || value === "unknown" || value === false) return "status-bad";
  if (value === "idle") return "status-idle";
  return "";
}

export function statusBadge(value, label = null) {
  const raw = label === null ? text(value) : text(label);
  const classes = ["status-badge", statusClass(value)].filter(Boolean).join(" ");
  return `<span class="${escapeHtml(classes)}">${escapeHtml(raw)}</span>`;
}

export function row(cells) {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}

export function kvRows(pairs, { mono = false } = {}) {
  return pairs.map(([key, value, isHtml]) => {
    const body = isHtml
      ? value
      : mono
        ? `<span class="mono">${escapeHtml(value)}</span>`
        : escapeHtml(value);
    return `<dt>${escapeHtml(key)}</dt><dd>${body}</dd>`;
  }).join("");
}

export function statusText(value) {
  return statusBadge(value);
}

export function objectSummary(value) {
  if (value === null || value === undefined || value === "") return "none";
  if (typeof value === "string") return value.length > 80 ? `${value.slice(0, 77)}...` : value;
  if (Array.isArray(value)) return value.length ? `${numberText(value.length, 0)} item${value.length === 1 ? "" : "s"}` : "none";
  if (typeof value === "object") {
    const entries = Object.entries(value);
    if (!entries.length) return "none";
    return entries.slice(0, 4).map(([key, item]) => `${key}:${text(item)}`).join(" ");
  }
  return text(value);
}

export function jsonDrilldown(value, summary = null) {
  const payload = value === undefined ? null : value;
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload ?? {}, null, 2);
  const label = summary || objectSummary(payload);
  if (!serialized || serialized === "{}" || serialized === "[]" || serialized === "null") {
    return `<span class="muted">${escapeHtml(label || "none")}</span>`;
  }
  return `<details class="json-drilldown"><summary>${escapeHtml(label || "details")}</summary><pre class="mono">${escapeHtml(serialized)}</pre></details>`;
}

export function qualityBadge(status, warnings = []) {
  const warningList = Array.isArray(warnings) ? warnings : [];
  const suffix = warningList.length ? ` (${warningList.length})` : "";
  const title = warningList.length ? ` title="${escapeHtml(warningList.join("; "))}"` : "";
  return `<span class="status-badge ${escapeHtml(statusClass(status))}"${title}>${escapeHtml(text(status))}${escapeHtml(suffix)}</span>`;
}

export function dataCatalogSettings() {
  const diagnostics = state.diagnostics || {};
  const catalog = state.dataCatalog || {};
  const settings = diagnostics.data_catalog || catalog || {};
  const defaultLimit = Number(settings.default_limit || catalog.default_limit || catalog.limit || 200);
  const maxLimit = Number(settings.max_limit || catalog.max_limit || 1000);
  return {
    defaultLimit: Number.isFinite(defaultLimit) && defaultLimit > 0 ? Math.floor(defaultLimit) : 200,
    maxLimit: Number.isFinite(maxLimit) && maxLimit > 0 ? Math.floor(maxLimit) : 1000,
  };
}

export function syncDataCatalogLimitControl() {
  const select = $("data-catalog-limit");
  if (!select) return;
  const settings = dataCatalogSettings();
  const maxLimit = Math.max(settings.defaultLimit, settings.maxLimit);
  const current = Number(select.value || 0);
  const loadState = dataLibraryLoadState();
  const selected = loadState.catalogLimitTouched && current > 0 && current <= maxLimit
    ? current
    : settings.defaultLimit;
  const candidates = [50, 100, 200, 500, 1000, settings.defaultLimit, maxLimit]
    .filter((value) => value > 0 && value <= maxLimit);
  const unique = Array.from(new Set(candidates)).sort((a, b) => a - b);
  select.innerHTML = unique.map((value) => (
    `<option value="${value}"${value === selected ? " selected" : ""}>${numberText(value, 0)}</option>`
  )).join("");
  select.value = String(selected);
  $("data-catalog-limit-note").textContent = `Configured default ${numberText(settings.defaultLimit, 0)}, max ${numberText(maxLimit, 0)}`;
}

export function selectedDataCatalogLimit() {
  syncDataCatalogLimitControl();
  return $("data-catalog-limit").value || String(dataCatalogSettings().defaultLimit);
}

export function selectedDataCatalogOffset() {
  const offset = Number(dataLibraryLoadState().catalogOffset || 0);
  return Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

export function setDataCatalogOffset(value) {
  const offset = Number(value || 0);
  dataLibraryLoadState().catalogOffset = Number.isFinite(offset) && offset > 0 ? Math.floor(offset) : 0;
}

export function dataCatalogPreviewPoints() {
  return 8;
}

export function dataLibraryLoadState() {
  if (!state.dataLibrary) {
    state.dataLibrary = {
      catalogLoading: false,
      diagnosticsLoading: false,
      catalogLoaded: false,
      diagnosticsLoaded: false,
      catalogError: "",
      diagnosticsError: "",
      diagnosticsRequested: false,
      catalogLimitTouched: false,
      catalogOffset: 0,
      lastCatalogFetchMs: null,
      lastSymbolDirectoryFetchMs: null,
      lastHistoryMatrixFetchMs: null,
      lastSymbolIndexFetchMs: null,
      lastDataLibraryFetchMs: null,
      lastSymbolIndexLimit: null,
      requestId: 0,
    };
  }
  if (!Number.isFinite(Number(state.dataLibrary.catalogOffset))) state.dataLibrary.catalogOffset = 0;
  return state.dataLibrary;
}

export function setDataDiagnosticsLoadingNote(message, status = "warn") {
  const formatted = `<span class="${statusClass(status)}">${escapeHtml(message)}</span>`;
  for (const id of [
    "data-storage-audit-note",
    "data-coverage-note",
    "data-gap-summary-note",
    "data-minute-heatmap-note",
  ]) {
    if ($(id)) $(id).innerHTML = formatted;
  }
}

export function availableViews() {
  return Array.from(document.querySelectorAll(".dashboard-section"))
    .map((section) => section.dataset.view)
    .filter(Boolean);
}

export function dashboardHashParts(value) {
  const cleaned = String(value || "")
    .replace(/^#/, "")
    .replace(/^\//, "")
    .trim();
  const path = cleaned.split(/[?&]/)[0] || "";
  const parts = path.split("/").filter(Boolean);
  return {
    view: parts[0] || "overview",
    lens: parts[1] || "",
    hasExplicitLens: parts.length > 1,
    raw: cleaned,
  };
}

export function normalizeView(view) {
  const cleaned = dashboardHashParts(view).view;
  const views = new Set(availableViews());
  return views.has(cleaned) ? cleaned : "overview";
}

export function normalizeOverviewLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "activity", "diagnostics"]).has(cleaned) ? cleaned : "home";
}

export function normalizePerformanceLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "trades", "rollups", "diagnostics"]).has(cleaned) ? cleaned : "home";
}

export function normalizeDataLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "browse", "inspect", "compare", "diagnostics"]).has(cleaned) ? cleaned : "home";
}

export function normalizeFetchLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "jobs", "detail"]).has(cleaned) ? cleaned : "home";
}

export function normalizeWorkbenchLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "builder", "run", "artifacts"]).has(cleaned) ? cleaned : "home";
}

export function normalizeRunsLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "state", "runs", "events"]).has(cleaned) ? cleaned : "home";
}

export function normalizeOperationsLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "paper", "remote", "control", "diagnostics"]).has(cleaned) ? cleaned : "home";
}

export function normalizeHelpLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "pages", "workflows", "data", "boundary", "docs"]).has(cleaned) ? cleaned : "home";
}

export function overviewLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "overview") return "";
  return parts.hasExplicitLens ? normalizeOverviewLens(parts.lens) : "";
}

export function performanceLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "performance") return "";
  return parts.hasExplicitLens ? normalizePerformanceLens(parts.lens) : "";
}

export function dataLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "data") return "";
  return parts.hasExplicitLens ? normalizeDataLens(parts.lens) : "";
}

export function fetchLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "fetch") return "";
  return parts.hasExplicitLens ? normalizeFetchLens(parts.lens) : "";
}

export function workbenchLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "workbench") return "";
  return parts.hasExplicitLens ? normalizeWorkbenchLens(parts.lens) : "";
}

export function runsLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "runs") return "";
  return parts.hasExplicitLens ? normalizeRunsLens(parts.lens) : "";
}

export function operationsLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "operations") return "";
  return parts.hasExplicitLens ? normalizeOperationsLens(parts.lens) : "";
}

export function helpLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "help") return "";
  return parts.hasExplicitLens ? normalizeHelpLens(parts.lens) : "";
}

export function selectedOverviewLens() {
  const hashLens = overviewLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "overview" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeOverviewLens(sessionStorage.getItem("dashboardOverviewLens") || "home");
}

export function selectedPerformanceLens() {
  const hashLens = performanceLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "performance" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizePerformanceLens(sessionStorage.getItem("dashboardPerformanceLens") || "home");
}

export function selectedDataLens() {
  const hashLens = dataLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "data" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeDataLens(sessionStorage.getItem("dashboardDataLens") || "home");
}

export function selectedFetchLens() {
  const hashLens = fetchLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "fetch" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeFetchLens(sessionStorage.getItem("dashboardFetchLens") || "home");
}

export function selectedWorkbenchLens() {
  const hashLens = workbenchLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "workbench" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeWorkbenchLens(sessionStorage.getItem("dashboardWorkbenchLens") || "home");
}

export function selectedRunsLens() {
  const hashLens = runsLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "runs" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeRunsLens(sessionStorage.getItem("dashboardRunsLens") || "home");
}

export function selectedOperationsLens() {
  const hashLens = operationsLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "operations" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeOperationsLens(sessionStorage.getItem("dashboardOperationsLens") || "home");
}

export function selectedHelpLens() {
  const hashLens = helpLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "help" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeHelpLens(sessionStorage.getItem("dashboardHelpLens") || "home");
}

export function viewFromHash() {
  return normalizeView(decodeURIComponent(window.location.hash || ""));
}

export function setActiveView(view) {
  const targetView = normalizeView(view || "overview");
  for (const section of document.querySelectorAll(".dashboard-section")) {
    section.hidden = section.dataset.view !== targetView;
  }
  for (const button of document.querySelectorAll("[data-view-target]")) {
    const active = button.dataset.viewTarget === targetView;
    button.classList.toggle("active", active);
    if (button.classList.contains("nav-link")) {
      if (active) {
        button.setAttribute("aria-current", "page");
        button.scrollIntoView({ behavior: "auto", inline: "center", block: "nearest" });
      } else {
        button.removeAttribute("aria-current");
      }
    }
  }
  sessionStorage.setItem("dashboardView", targetView);
  renderPageIntro(targetView);
  if (targetView === "overview") {
    applyOverviewLens(selectedOverviewLens());
  }
  if (targetView === "performance") {
    applyPerformanceLens(selectedPerformanceLens());
  }
  if (targetView === "data") {
    applyDataLens(selectedDataLens());
  }
  if (targetView === "fetch") {
    applyFetchLens(selectedFetchLens());
  }
  if (targetView === "workbench") {
    applyWorkbenchLens(selectedWorkbenchLens());
  }
  if (targetView === "runs") {
    applyRunsLens(selectedRunsLens());
  }
  if (targetView === "operations") {
    applyOperationsLens(selectedOperationsLens());
  }
  if (targetView === "help") {
    applyHelpLens(selectedHelpLens());
  }
}

export function navigateToView(view) {
  const targetView = normalizeView(view);
  const nextHash = `#${targetView}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView(targetView);
}

export function activeView() {
  return normalizeView(sessionStorage.getItem("dashboardView") || window.location.hash || "overview");
}

export function overviewLensContent(lens) {
  const content = {
    home: {
      title: "Home",
      note: "Portfolio value, today's state, performance, and positions.",
    },
    activity: {
      title: "Activity",
      note: "Signals, changed state, open orders, and current-session timeline.",
    },
    diagnostics: {
      title: "Diagnostics",
      note: "Runtime health, alerts, data visibility, setup checks, and workflow guidance.",
    },
  };
  return content[normalizeOverviewLens(lens)] || content.home;
}

export function applyOverviewLens(lens) {
  const selected = normalizeOverviewLens(lens);
  sessionStorage.setItem("dashboardOverviewLens", selected);
  for (const section of document.querySelectorAll('.dashboard-section[data-view="overview"]')) {
    if (section.dataset.overviewLensFixed === "true") {
      section.hidden = false;
      continue;
    }
    const lenses = new Set(String(section.dataset.overviewLens || "home").split(/\s+/).filter(Boolean));
    section.hidden = !lenses.has(selected);
  }
  for (const button of document.querySelectorAll("[data-overview-lens-target]")) {
    const active = normalizeOverviewLens(button.dataset.overviewLensTarget) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const content = overviewLensContent(selected);
  if ($("overview-lens-title")) $("overview-lens-title").textContent = content.title;
  if ($("overview-lens-note")) $("overview-lens-note").textContent = content.note;
  if (activeView() === "overview") renderRouteBreadcrumb("overview");
}

export function navigateToOverviewLens(lens) {
  const selected = normalizeOverviewLens(lens);
  const nextHash = selected === "home" ? "#overview" : `#overview/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("overview");
}

export function performanceLensContent(lens) {
  const content = {
    home: {
      title: "Home",
      note: "Current result, evidence quality, risk, and the main charts.",
    },
    trades: {
      title: "Trades",
      note: "Open/closed trades, trade filters, and recent saved runs.",
    },
    rollups: {
      title: "Rollups",
      note: "Daily, monthly, and yearly live/paper and archived run summaries.",
    },
    diagnostics: {
      title: "Diagnostics",
      note: "Source quality, metric context, execution caveats, and next action.",
    },
  };
  return content[normalizePerformanceLens(lens)] || content.home;
}

export function applyPerformanceLens(lens) {
  const selected = normalizePerformanceLens(lens);
  sessionStorage.setItem("dashboardPerformanceLens", selected);
  for (const section of document.querySelectorAll('.dashboard-section[data-view="performance"]')) {
    const configured = String(section.dataset.performanceLens || "").trim();
    if (!configured) {
      section.hidden = false;
      continue;
    }
    const lenses = new Set(configured.split(/\s+/).filter(Boolean));
    section.hidden = !lenses.has(selected);
  }
  for (const button of document.querySelectorAll("[data-performance-lens-target]")) {
    const active = normalizePerformanceLens(button.dataset.performanceLensTarget) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const content = performanceLensContent(selected);
  if ($("performance-lens-title")) $("performance-lens-title").textContent = content.title;
  if ($("performance-lens-note")) $("performance-lens-note").textContent = content.note;
  if (activeView() === "performance") renderRouteBreadcrumb("performance");
}

export function navigateToPerformanceLens(lens) {
  const selected = normalizePerformanceLens(lens);
  const nextHash = selected === "home" ? "#performance" : `#performance/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("performance");
}

export function dataLensContent(lens) {
  const content = {
    home: {
      title: "Home",
      note: "Root visibility, loaded symbols, best matches, and next action.",
    },
    browse: {
      title: "Browse",
      note: "Symbol browser, symbol directory, catalog filters, and saved-file table.",
    },
    inspect: {
      title: "Inspect",
      note: "Offline saved-file viewer with chart, gaps, health, exports, and Workbench handoff.",
    },
    compare: {
      title: "Compare",
      note: "Normalized saved-data overlays across symbols, files, bars, and date ranges.",
    },
    diagnostics: {
      title: "Diagnostics",
      note: "Root visibility, scan diagnostics, storage audit, coverage, gaps, and missing-symbol clues.",
    },
  };
  return content[normalizeDataLens(lens)] || content.home;
}

export function applyDataLens(lens) {
  const selected = normalizeDataLens(lens);
  sessionStorage.setItem("dashboardDataLens", selected);
  for (const element of document.querySelectorAll('[data-view="data"], [data-data-lens]')) {
    if (element.classList && element.classList.contains("dashboard-section") && element.dataset.view !== "data") continue;
    if (element.classList && element.classList.contains("dashboard-section") && element.dataset.view === "data" && !element.dataset.dataLens) {
      element.hidden = false;
      continue;
    }
    const configured = String(element.dataset.dataLens || "").trim();
    if (!configured) continue;
    const lenses = new Set(configured.split(/\s+/).filter(Boolean));
    element.hidden = !lenses.has(selected);
  }
  for (const button of document.querySelectorAll("[data-data-lens-target]")) {
    const active = normalizeDataLens(button.dataset.dataLensTarget) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const content = dataLensContent(selected);
  if ($("data-lens-title")) $("data-lens-title").textContent = content.title;
  if ($("data-lens-note")) $("data-lens-note").textContent = content.note;
  if (activeView() === "data") renderRouteBreadcrumb("data");
  if (state.refreshLoaded && activeView() === "data") {
    refreshDataLibrary({ includeDiagnostics: selected === "diagnostics" }).catch((err) => {
      $("last-refresh").textContent = `Data Library refresh failed: ${err.message}`;
    });
  }
}

export function navigateToDataLens(lens) {
  const selected = normalizeDataLens(lens);
  const nextHash = selected === "home" ? "#data" : `#data/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("data");
}

export function fetchLensContent(lens) {
  const content = {
    home: {
      title: "Home",
      note: "Manifest roots, fetch health, recovery pressure, and next action.",
    },
    jobs: {
      title: "Jobs",
      note: "Search, filter, sort, export, and open fetch manifests.",
    },
    detail: {
      title: "Detail",
      note: "Selected job recovery, resume command, output visibility, errors, events, and output files.",
    },
  };
  return content[normalizeFetchLens(lens)] || content.home;
}

export function applyFetchLens(lens) {
  const selected = normalizeFetchLens(lens);
  sessionStorage.setItem("dashboardFetchLens", selected);
  for (const element of document.querySelectorAll('[data-view="fetch"], [data-fetch-lens]')) {
    if (element.classList && element.classList.contains("dashboard-section") && element.dataset.view !== "fetch") continue;
    if (element.classList && element.classList.contains("dashboard-section") && element.dataset.view === "fetch" && !element.dataset.fetchLens) {
      element.hidden = false;
      continue;
    }
    const configured = String(element.dataset.fetchLens || "").trim();
    if (!configured) continue;
    const lenses = new Set(configured.split(/\s+/).filter(Boolean));
    element.hidden = !lenses.has(selected);
  }
  for (const button of document.querySelectorAll("[data-fetch-lens-target]")) {
    const active = normalizeFetchLens(button.dataset.fetchLensTarget) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const content = fetchLensContent(selected);
  if ($("fetch-lens-title")) $("fetch-lens-title").textContent = content.title;
  if ($("fetch-lens-note")) $("fetch-lens-note").textContent = content.note;
  if (activeView() === "fetch") renderRouteBreadcrumb("fetch");
}

export function navigateToFetchLens(lens) {
  const selected = normalizeFetchLens(lens);
  const nextHash = selected === "home" ? "#fetch" : `#fetch/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("fetch");
}

export function workbenchLensContent(lens) {
  const content = {
    home: {
      title: "Home",
      note: "Simulation path, selected data, alignment state, and next action.",
    },
    builder: {
      title: "Builder",
      note: "Config fields, plugin/broker boundaries, data quality, generated YAML, and alignment.",
    },
    run: {
      title: "Run",
      note: "Saved draft validation, run controls, latest result, draft/run tables, and run comparison.",
    },
    artifacts: {
      title: "Artifacts",
      note: "Loaded run logs, equity chart, session timeline, decisions, orders, fills, and account snapshots.",
    },
  };
  return content[normalizeWorkbenchLens(lens)] || content.home;
}

export function applyWorkbenchLens(lens) {
  const selected = normalizeWorkbenchLens(lens);
  sessionStorage.setItem("dashboardWorkbenchLens", selected);
  for (const element of document.querySelectorAll("[data-workbench-lens]")) {
    const lenses = new Set(String(element.dataset.workbenchLens || "").split(/\s+/).filter(Boolean));
    element.hidden = !lenses.has(selected);
  }
  for (const button of document.querySelectorAll("[data-workbench-lens-target]")) {
    const active = normalizeWorkbenchLens(button.dataset.workbenchLensTarget) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const content = workbenchLensContent(selected);
  if ($("workbench-lens-title")) $("workbench-lens-title").textContent = content.title;
  if ($("workbench-lens-note")) $("workbench-lens-note").textContent = content.note;
  if (activeView() === "workbench") renderRouteBreadcrumb("workbench");
}

export function navigateToWorkbenchLens(lens) {
  const selected = normalizeWorkbenchLens(lens);
  const nextHash = selected === "home" ? "#workbench" : `#workbench/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("workbench");
}

export function runsLensContent(lens) {
  const content = {
    home: {
      title: "Home",
      note: "Run triage, latest activity, artifact readiness, and next action.",
    },
    state: {
      title: "State",
      note: "Account boundary, current open orders, managed positions, and recent status snapshots.",
    },
    runs: {
      title: "Runs",
      note: "Searchable run telemetry, mode/status filters, freshness, metrics, and artifact actions.",
    },
    events: {
      title: "Events",
      note: "Decision, order, fill, reject, and symbol timeline filters for recent run activity.",
    },
  };
  return content[normalizeRunsLens(lens)] || content.home;
}

export function applyRunsLens(lens) {
  const selected = normalizeRunsLens(lens);
  sessionStorage.setItem("dashboardRunsLens", selected);
  for (const element of document.querySelectorAll("[data-runs-lens]")) {
    const lenses = new Set(String(element.dataset.runsLens || "").split(/\s+/).filter(Boolean));
    element.hidden = !lenses.has(selected);
  }
  for (const button of document.querySelectorAll("[data-runs-lens-target]")) {
    const active = normalizeRunsLens(button.dataset.runsLensTarget) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const content = runsLensContent(selected);
  if ($("runs-lens-title")) $("runs-lens-title").textContent = content.title;
  if ($("runs-lens-note")) $("runs-lens-note").textContent = content.note;
  if (activeView() === "runs") renderRouteBreadcrumb("runs");
}

export function navigateToRunsLens(lens) {
  const selected = normalizeRunsLens(lens);
  const nextHash = selected === "home" ? "#runs" : `#runs/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("runs");
}

export function operationsLensContent(lens) {
  const content = {
    home: {
      title: "Home",
      note: "Local readiness, remote freshness, command safety, and next action.",
    },
    paper: {
      title: "Paper",
      note: "Gateway, telemetry, mode, signal freshness, and next-order readiness checks.",
    },
    remote: {
      title: "Remote",
      note: "Cloud monitoring nodes, bounded node detail, latest remote activity, and alerts.",
    },
    control: {
      title: "Control",
      note: "Supervisors, remote-control audit state, command queue, command audit, and command results.",
    },
    diagnostics: {
      title: "Diagnostics",
      note: "Workbench state, cleanup, setup diagnostics, endpoint map, alerts, and Gateway status.",
    },
  };
  return content[normalizeOperationsLens(lens)] || content.home;
}

export function applyOperationsLens(lens) {
  const selected = normalizeOperationsLens(lens);
  sessionStorage.setItem("dashboardOperationsLens", selected);
  for (const element of document.querySelectorAll("[data-operations-lens]")) {
    const lenses = new Set(String(element.dataset.operationsLens || "").split(/\s+/).filter(Boolean));
    element.hidden = !lenses.has(selected);
  }
  for (const button of document.querySelectorAll("[data-operations-lens-target]")) {
    const active = normalizeOperationsLens(button.dataset.operationsLensTarget) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const content = operationsLensContent(selected);
  if ($("operations-lens-title")) $("operations-lens-title").textContent = content.title;
  if ($("operations-lens-note")) $("operations-lens-note").textContent = content.note;
  if (activeView() === "operations") renderRouteBreadcrumb("operations");
}

export function navigateToOperationsLens(lens) {
  const selected = normalizeOperationsLens(lens);
  const nextHash = selected === "home" ? "#operations" : `#operations/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("operations");
}

export function helpLensContent(lens) {
  const content = {
    home: {
      title: "Home",
      note: "Start by question, current setup gaps, and first next action.",
    },
    pages: {
      title: "Pages",
      note: "Page map, first-run checklist, and current performance inspection path.",
    },
    workflows: {
      title: "Workflows",
      note: "Common operating paths and direct shortcuts between dashboard pages.",
    },
    data: {
      title: "Data",
      note: "Saved-data inspection, fetch-to-simulation path, missing symbols, roots, and scan limits.",
    },
    boundary: {
      title: "Boundary",
      note: "Public/private publishing rules, glossary, and core dashboard terms.",
    },
    docs: {
      title: "Docs",
      note: "Runbooks, quickstarts, publication guidance, and local documentation links.",
    },
  };
  return content[normalizeHelpLens(lens)] || content.home;
}

export function applyHelpLens(lens) {
  const selected = normalizeHelpLens(lens);
  sessionStorage.setItem("dashboardHelpLens", selected);
  for (const element of document.querySelectorAll("[data-help-lens]")) {
    const lenses = new Set(String(element.dataset.helpLens || "").split(/\s+/).filter(Boolean));
    element.hidden = !lenses.has(selected);
  }
  for (const button of document.querySelectorAll("[data-help-lens-target]")) {
    const active = normalizeHelpLens(button.dataset.helpLensTarget) === selected;
    button.classList.toggle("active", active);
    button.setAttribute("aria-selected", active ? "true" : "false");
  }
  const content = helpLensContent(selected);
  if ($("help-lens-title")) $("help-lens-title").textContent = content.title;
  if ($("help-lens-note")) $("help-lens-note").textContent = content.note;
  if (activeView() === "help") renderRouteBreadcrumb("help");
}

export function navigateToHelpLens(lens) {
  const selected = normalizeHelpLens(lens);
  const nextHash = selected === "home" ? "#help" : `#help/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("help");
}

export function navigateToViewTarget(view, lens = "") {
  const targetView = normalizeView(view);
  if (targetView === "overview" && lens) return navigateToOverviewLens(lens);
  if (targetView === "performance" && lens) return navigateToPerformanceLens(lens);
  if (targetView === "data" && lens) return navigateToDataLens(lens);
  if (targetView === "fetch" && lens) return navigateToFetchLens(lens);
  if (targetView === "workbench" && lens) return navigateToWorkbenchLens(lens);
  if (targetView === "runs" && lens) return navigateToRunsLens(lens);
  if (targetView === "operations" && lens) return navigateToOperationsLens(lens);
  if (targetView === "help" && lens) return navigateToHelpLens(lens);
  return navigateToView(targetView);
}

export function currentRouteLens(view = activeView()) {
  const targetView = normalizeView(view);
  const lensByView = {
    overview: selectedOverviewLens,
    performance: selectedPerformanceLens,
    data: selectedDataLens,
    fetch: selectedFetchLens,
    workbench: selectedWorkbenchLens,
    runs: selectedRunsLens,
    operations: selectedOperationsLens,
    help: selectedHelpLens,
  };
  const getter = lensByView[targetView];
  return getter ? getter() : "home";
}

export function routeLensContent(view, lens) {
  const targetView = normalizeView(view);
  const contentByView = {
    overview: overviewLensContent,
    performance: performanceLensContent,
    data: dataLensContent,
    fetch: fetchLensContent,
    workbench: workbenchLensContent,
    runs: runsLensContent,
    operations: operationsLensContent,
    help: helpLensContent,
  };
  const getter = contentByView[targetView];
  return getter ? getter(lens) : { title: "Home", note: "" };
}

export function routeHash(view = activeView(), lens = currentRouteLens(view)) {
  const targetView = normalizeView(view);
  const selectedLens = String(lens || "home");
  return selectedLens === "home" ? `#${targetView}` : `#${targetView}/${selectedLens}`;
}

export function routeTargetValue(view = activeView(), lens = currentRouteLens(view)) {
  return routeHash(view, lens).replace(/^#/, "");
}

export function routeUrl(view = activeView(), lens = currentRouteLens(view)) {
  const base = `${window.location.origin}${window.location.pathname}`;
  return `${base}${routeHash(view, lens)}`;
}

export function syncDashboardJump(view = activeView()) {
  const select = $("dashboard-jump");
  if (!select) return;
  const value = routeTargetValue(view, currentRouteLens(view));
  if ([...select.options].some((option) => option.value === value)) {
    select.value = value;
  } else {
    select.value = normalizeView(view);
  }
}

export function jumpToDashboardTarget(value) {
  const parts = dashboardHashParts(value);
  const targetView = normalizeView(parts.view);
  const lens = parts.hasExplicitLens ? parts.lens : "";
  navigateToViewTarget(targetView, lens);
}

export function routeTaskValue(view = activeView(), lens = currentRouteLens(view)) {
  const targetView = normalizeView(view);
  const selectedLens = String(lens || "home");
  if (targetView === "performance") return "performance";
  if (targetView === "data") return "data";
  if (targetView === "fetch") return "fetch";
  if (targetView === "workbench") return "simulate";
  if (targetView === "runs") return "runs";
  if (targetView === "operations") return "operations";
  if (targetView === "help" && ["boundary", "docs"].includes(selectedLens)) return "publish";
  return "monitor";
}

export function syncDashboardTask(view = activeView()) {
  const select = $("dashboard-task");
  if (!select) return;
  const value = routeTaskValue(view, currentRouteLens(view));
  if ([...select.options].some((option) => option.value === value)) {
    select.value = value;
  }
}

export function dashboardTaskTarget(value) {
  const payload = state.status || {};
  const runs = payload.runs || [];
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const source = latestArtifactPerformance();
  const task = String(value || "").trim();
  const targets = {
    monitor: ["overview", runs.length ? "home" : "diagnostics"],
    performance: ["performance", source.has_data || runs.length ? "home" : "diagnostics"],
    data: ["data", datasets.length ? "browse" : "diagnostics"],
    fetch: ["fetch", manifests.length ? "jobs" : "home"],
    simulate: ["workbench", datasets.length ? "builder" : "home"],
    runs: ["runs", runs.length ? "state" : "runs"],
    operations: ["operations", "paper"],
    publish: ["help", "boundary"],
  };
  return targets[task] || targets.monitor;
}

export function startDashboardTask(value) {
  const [targetView, lens] = dashboardTaskTarget(value);
  navigateToViewTarget(targetView, lens);
}

export function renderRouteBreadcrumb(view = activeView()) {
  const targetView = normalizeView(view);
  const lens = currentRouteLens(targetView);
  const page = pageIntroContent(targetView);
  const lensContent = routeLensContent(targetView, lens);
  const crumbs = $("page-route-crumbs");
  if (crumbs) {
    crumbs.innerHTML = `
      <button type="button" data-route-action="overview">Dashboard</button>
      <span class="route-separator">/</span>
      <button type="button" data-route-action="page-home">${escapeHtml(page.eyebrow || targetView)}</button>
      <span class="route-separator">/</span>
      <span class="route-current">${escapeHtml(lensContent.title || "Home")}</span>
    `;
  }
  const homeButton = $("page-route-home");
  if (homeButton) {
    homeButton.disabled = lens === "home";
    homeButton.textContent = lens === "home" ? "On Page Home" : `${page.eyebrow || "Page"} Home`;
  }
  const copyButton = $("page-route-copy");
  if (copyButton) {
    copyButton.dataset.routeLink = routeUrl(targetView, lens);
  }
  syncDashboardJump(targetView);
  syncDashboardTask(targetView);
}

export function handleRouteAction(action) {
  if (action === "overview") {
    navigateToView("overview");
    return;
  }
  if (action === "page-home") {
    navigateToView(activeView());
  }
}

export function pageIntroAction(id, action) {
  const button = $(id);
  if (!button) return;
  if (!action) {
    button.hidden = true;
    button.removeAttribute("data-view-target");
    button.removeAttribute("data-view-lens");
    return;
  }
  button.hidden = false;
  button.textContent = action.label;
  button.dataset.viewTarget = action.target;
  if (action.lens) button.dataset.viewLens = action.lens;
  else button.removeAttribute("data-view-lens");
}

export function pageIntroEvidence(view) {
  const payload = state.status || {};
  const statusGenerated = payload.generated_at || "";
  const dataCatalog = state.dataCatalog || {};
  const dataInventory = symbolInventoryModel();
  const fetchManifests = state.fetchManifests || {};
  const performanceSource = latestArtifactPerformance();
  const latestAccount = latestAccountRow(performanceSource.account || []);
  const runComparison = state.runComparison || {};
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const newestRemote = remoteNodes.slice().sort((left, right) => (
    (timestampMillis(right.received_at || right.generated_at) || 0)
    - (timestampMillis(left.received_at || left.generated_at) || 0)
  ))[0] || {};
  const generatedValue = (value) => (value ? shortTimestampAgeLabel(value) : "missing");
  const sourceValue = (label, value, status = value ? "ok" : "warn") => ({ label, value: text(value), status });
  const freshnessValue = (label, value) => ({ label, value: generatedValue(value), status: value ? "ok" : "bad" });
  const countValue = (label, value, noun) => {
    const number = Number(value || 0);
    return {
      label,
      value: `${numberText(number, 0)} ${noun}${number === 1 ? "" : "s"}`,
      status: number ? "ok" : "warn",
    };
  };
  const commonStatus = freshnessValue("Status", statusGenerated);
  const evidence = {
    overview: [
      commonStatus,
      sourceValue("Account", latestAccount.timestamp ? `snapshot ${shortTimestampAgeLabel(latestAccount.timestamp)}` : "no snapshot", latestAccount.timestamp ? "ok" : "warn"),
      countValue("Alerts", (payload.alerts || []).length, "alert"),
    ],
    performance: [
      sourceValue("Source", performanceSource.label || "none", performanceSource.has_data ? "ok" : "warn"),
      sourceValue("Account", latestAccount.timestamp ? shortTimestampAgeLabel(latestAccount.timestamp) : "missing", latestAccount.timestamp ? "ok" : "warn"),
      countValue("Rollups", ((state.statusEquityRollups || {}).rollups || []).length, "day"),
    ],
    data: [
      freshnessValue("Catalog", dataCatalog.generated_at),
      dataInventory.fileCount
        ? countValue("Indexed", dataInventory.fileCount, "file")
        : countValue("Visible", (dataCatalog.datasets || []).length, "file"),
      dataInventory.symbolCount
        ? countValue("Symbols", dataInventory.symbolCount, "symbol")
        : countValue("Roots", ((dataCatalog.root_summaries || dataCatalog.roots || [])).length, "root"),
    ],
    fetch: [
      freshnessValue("Manifests", fetchManifests.generated_at),
      countValue("Loaded", (fetchManifests.manifests || []).length, "job"),
      countValue("Roots", ((fetchManifests.root_summaries || fetchManifests.roots || [])).length, "root"),
    ],
    workbench: [
      freshnessValue("Options", (state.configOptions || {}).generated_at),
      countValue("Drafts", ((state.configDrafts || {}).drafts || []).length, "draft"),
      countValue("Runs", ((state.configRuns || {}).runs || []).length, "run"),
    ],
    runs: [
      commonStatus,
      freshnessValue("Comparison", runComparison.generated_at),
      countValue("Runs", (runComparison.runs || []).length, "row"),
    ],
    operations: [
      commonStatus,
      sourceValue("Gateway", (payload.gateway || {}).enabled ? ((payload.gateway || {}).reachable ? "reachable" : "not reachable") : "disabled", (payload.gateway || {}).enabled ? ((payload.gateway || {}).reachable ? "ok" : "bad") : "warn"),
      sourceValue("Remote", newestRemote.node_id ? `${text(newestRemote.node_id)} ${generatedValue(newestRemote.received_at || newestRemote.generated_at)}` : "no nodes", newestRemote.node_id ? "ok" : "warn"),
    ],
    help: [
      sourceValue("Docs", "allowlisted local docs", "ok"),
      sourceValue("Boundary", "public-safe examples", "ok"),
      commonStatus,
    ],
  };
  return evidence[normalizeView(view)] || evidence.overview;
}

export function renderPageIntroEvidence(view) {
  const container = $("page-intro-evidence");
  if (!container) return;
  container.innerHTML = pageIntroEvidence(view).map((item) => `
    <span class="evidence-chip status-${escapeHtml(item.status)}">
      <b>${escapeHtml(item.label)}</b>
      <em>${escapeHtml(item.value)}</em>
    </span>
  `).join("");
}

export function topbarStatusModel() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const source = latestArtifactPerformance();
  const summary = (source && source.summary) || {};
  const perf = (source && source.performance) || {};
  const latestRun = latestTelemetryRun();
  const metrics = normalizedRunMetrics(latestRun);
  const latestAccount = latestAccountRow((source && source.account) || []);
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const runs = payload.runs || [];
  const alerts = payload.alerts || [];
  const mode = firstPresent(metrics.mode, summary.mode, perf.mode, "offline");
  const equity = finiteNumber(firstPresent(
    latestAccount.equity,
    summary.final_equity,
    perf.final_equity,
    metrics.final_equity,
  ));
  const statusFresh = state.statusFetchError
    ? "unreachable"
    : payload.generated_at ? shortTimestampAgeLabel(payload.generated_at) : "missing";
  const gatewayValue = gateway.enabled ? gateway.reachable ? "reachable" : "down" : "disabled";
  return [
    {
      label: "Mode",
      value: text(mode),
      status: mode && mode !== "offline" && mode !== "unknown" ? "ok" : "warn",
    },
    {
      label: "Equity",
      value: equity === null ? "n/a" : money(equity),
      status: equity === null ? "warn" : "ok",
      valueClass: "value-equity",
    },
    {
      label: "Status",
      value: statusFresh,
      status: state.statusFetchError ? "bad" : payload.generated_at ? "ok" : "bad",
    },
    {
      label: "Gateway",
      value: gatewayValue,
      status: gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn",
    },
    {
      label: "Runs",
      value: numberText(runs.length, 0),
      status: runs.length ? "ok" : "warn",
    },
    {
      label: "Data",
      value: `${numberText(datasets.length, 0)} files`,
      status: datasets.length ? "ok" : "bad",
    },
    {
      label: "Alerts",
      value: numberText(alerts.length, 0),
      status: alerts.length ? "warn" : "ok",
    },
  ];
}

export function renderTopbarStatusStrip() {
  const container = $("topbar-status-strip");
  if (!container) return;
  container.innerHTML = topbarStatusModel().map((item) => `
    <span class="topbar-status-chip status-${escapeHtml(item.status)}">
      <b>${escapeHtml(item.label)}</b>
      <em class="${escapeHtml(item.valueClass || "")}">${escapeHtml(item.value)}</em>
    </span>
  `).join("");
}

export function pageIntroContent(view) {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const runRows = (state.runComparison && state.runComparison.runs) || [];
  const alerts = (payload.alerts || []);
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const statusRollups = (state.statusEquityRollups && state.statusEquityRollups.rollups) || [];
  const visibleRuns = ((payload.runs || []).length || runRows.length);
  const generatedLabel = payload.generated_at ? `Status ${timestampAgeLabel(payload.generated_at)}` : "No status published yet";
  const gatewayLabel = gateway.enabled ? `Gateway ${gateway.reachable ? "reachable" : "not reachable"}` : "Gateway check disabled";
  const viewMap = {
    overview: {
      eyebrow: "Overview",
      title: "Current strategy status",
      note: "Confirm telemetry, account state, Gateway reachability, current positions, and the latest strategy activity before drilling into detail.",
      status: `${generatedLabel}; ${visibleRuns} run${visibleRuns === 1 ? "" : "s"} visible; ${alerts.length} alert${alerts.length === 1 ? "" : "s"}`,
      statusState: payload.generated_at ? alerts.length ? "warn" : "ok" : "bad",
      primary: { label: "Open Performance", target: "performance", lens: "home" },
      secondary: { label: "Inspect Data", target: "data", lens: "browse" },
      next: {
        title: "Check performance context",
        note: "After current health looks reasonable, review returns, drawdown, and execution health.",
      },
      guide: [
        { label: "Answers", title: "Is anything running and healthy?", note: "Start here for telemetry freshness, alerts, positions, orders, and account snapshots." },
        { label: "Evidence", title: "Status snapshots and run artifacts", note: "Tiles use public-safe status, account, order, fill, reject, and rollup records when present." },
        { label: "Next Move", title: "Open the page tied to the issue", note: "Use Performance for results, Runs for exact events, Data for saved files, and Operations for runtime blockers." },
      ],
      steps: [
        { label: "1", title: "Check Health", note: "Start with heartbeat, Gateway/API, stale data, and alerts." },
        { label: "2", title: "Read Positions", note: "Review current exposure, open orders, and latest fill/reject." },
        { label: "3", title: "Open Results", note: "Move to Performance when equity or PnL needs context." },
        { label: "4", title: "Inspect Events", note: "Use Runs for the exact decision, order, fill, and artifact rows." },
      ],
    },
    performance: {
      eyebrow: "Performance",
      title: "Strategy results and account curves",
      note: "Use current status-history rollups first, then load archived artifacts when you need drawdown, fills, trade ledger, and benchmark comparisons.",
      status: `${statusRollups.length} status day${statusRollups.length === 1 ? "" : "s"}; ${runRows.length} saved run${runRows.length === 1 ? "" : "s"}; ${gatewayLabel}`,
      statusState: statusRollups.length || runRows.length ? "ok" : "warn",
      primary: { label: "Review Runs", target: "runs", lens: "runs" },
      secondary: { label: "Check Operations", target: "operations", lens: "paper" },
      next: {
        title: "Trace surprising metrics",
        note: "Use Runs when a return, drawdown, reject, or fill count needs exact event detail.",
      },
      guide: [
        { label: "Answers", title: "How did the strategy perform?", note: "Use this page for current status-history results, archived artifact returns, drawdown, and execution summaries." },
        { label: "Evidence", title: "Rollups, artifacts, fills, and benchmarks", note: "Source selectors distinguish live/paper status rollups from saved replay or simulated-paper artifacts." },
        { label: "Next Move", title: "Explain any outlier before trusting it", note: "Open Runs or artifact detail when a return, reject count, trade count, or benchmark gap looks surprising." },
      ],
      steps: [
        { label: "1", title: "Choose Source", note: "Use Current first; load artifacts for deeper replay or simulation detail." },
        { label: "2", title: "Set Period", note: "Compare today, week, month, three months, or all available data." },
        { label: "3", title: "Read Risk", note: "Check drawdown, exposure, rejects, and approval holds before return." },
        { label: "4", title: "Drill Down", note: "Open Runs when a metric needs its exact fills or account snapshots." },
      ],
    },
    data: {
      eyebrow: "Data Library",
      title: "Saved historical data",
      note: "Search scanned symbols, inspect saved files offline, diagnose hidden roots, and compare normalized close paths before using data in a replay.",
      status: `${datasets.length} visible dataset${datasets.length === 1 ? "" : "s"}; ${numberText((state.dataCatalog && state.dataCatalog.total) || datasets.length, 0)} catalog row${((state.dataCatalog && state.dataCatalog.total) || datasets.length) === 1 ? "" : "s"}`,
      statusState: datasets.length ? "ok" : "warn",
      primary: { label: "Open Workbench", target: "workbench", lens: "builder" },
      secondary: { label: "Review Fetches", target: "fetch", lens: "jobs" },
      next: {
        title: "Use clean data in Workbench",
        note: "Pick an inspectable dataset, confirm quality, then build a replay or simulated-paper draft.",
      },
      guide: [
        { label: "Answers", title: "What saved data can I use?", note: "Use this page to find symbols, inspect files, compare datasets, and diagnose missing or hidden roots." },
        { label: "Evidence", title: "Catalog scans and storage-contract checks", note: "Rows come from configured or suggested roots and include quality, session, timezone, source, and cap context." },
        { label: "Next Move", title: "Inspect before simulating", note: "Open Data Detail or Compare before sending files to Workbench, especially when warnings or mixed bar sizes appear." },
      ],
      steps: [
        { label: "1", title: "Confirm Roots", note: "Check configured roots, suggested roots, and catalog caps." },
        { label: "2", title: "Find Symbol", note: "Use search, facets, or Symbol Directory to locate saved files." },
        { label: "3", title: "Inspect File", note: "Open Data Detail for range, gaps, timezone, and quality." },
        { label: "4", title: "Simulate", note: "Send clean datasets to Workbench for replay or simulated paper." },
      ],
    },
    fetch: {
      eyebrow: "Fetch Jobs",
      title: "Historical-data pulls and recovery",
      note: "Review completed and failed fetch manifests, copy resume commands, inspect outputs, and connect produced files back to the Data Library.",
      status: `${manifests.length} manifest${manifests.length === 1 ? "" : "s"} loaded; ${numberText((state.fetchManifests && state.fetchManifests.total) || manifests.length, 0)} total`,
      statusState: manifests.length ? "ok" : "warn",
      primary: { label: "Show Data Library", target: "data", lens: "browse" },
      secondary: { label: "Simulate From Data", target: "workbench", lens: "builder" },
      next: {
        title: "Verify produced files",
        note: "Confirm fetch outputs are visible in Data Library before trusting them in a replay.",
      },
      guide: [
        { label: "Answers", title: "Did a data pull finish cleanly?", note: "Use this page for fetch status, symbol progress, pacing waits, errors, output paths, and resume state." },
        { label: "Evidence", title: "Fetch manifests and output visibility", note: "Manifest rows explain what was attempted, what failed, where files landed, and whether Data Library can see them." },
        { label: "Next Move", title: "Recover or verify outputs", note: "Copy a resume command for failed jobs or open visible outputs in Data Library before simulation." },
      ],
      steps: [
        { label: "1", title: "Review Jobs", note: "Filter manifests by status, kind, output visibility, or failures." },
        { label: "2", title: "Open Detail", note: "Check symbol progress, errors, retry events, and pacing waits." },
        { label: "3", title: "Recover", note: "Copy resume commands or fix permissions/contracts before retrying." },
        { label: "4", title: "Verify Output", note: "Show visible outputs in Data Library before using them." },
      ],
    },
    workbench: {
      eyebrow: "Workbench",
      title: "Build and validate example configs",
      note: "Generate public-safe replay or paper config drafts from saved data, preview alignment, validate drafts, and run local simulations.",
      status: `${drafts.length} draft${drafts.length === 1 ? "" : "s"}; ${((state.configRuns && state.configRuns.runs) || []).length} recent draft run${((state.configRuns && state.configRuns.runs) || []).length === 1 ? "" : "s"}`,
      statusState: drafts.length ? "ok" : "warn",
      primary: { label: "Inspect Data", target: "data", lens: "browse" },
      secondary: { label: "Open Runs", target: "runs", lens: "runs" },
      next: {
        title: "Validate the data/config boundary",
        note: "Review selected data quality, storage metadata, and generated config before running a draft.",
      },
      guide: [
        { label: "Answers", title: "Can I build and run a replay?", note: "Use this page to turn saved data into validated example configs and inspect the results that come back." },
        { label: "Evidence", title: "Schema metadata, selected data, and draft runs", note: "Public-safe plugin schemas define exposed fields while local/private registries remain ignored by the public export." },
        { label: "Next Move", title: "Preview, validate, then run", note: "Preview draft YAML before writing it, validate saved drafts, then open Performance when artifacts are available." },
      ],
      steps: [
        { label: "1", title: "Select Data", note: "Choose scanned files and review quality/metadata warnings first." },
        { label: "2", title: "Preview Align", note: "Confirm timestamps overlap for the selected symbols and range." },
        { label: "3", title: "Generate Draft", note: "Pick a public example or ignored private plugin boundary." },
        { label: "4", title: "Run And Inspect", note: "Validate, run replay/simulated paper, then open Performance." },
      ],
    },
    runs: {
      eyebrow: "Runs",
      title: "Decisions, orders, fills, and artifacts",
      note: "Search saved runs, inspect current managed positions, open non-terminal orders, combined timelines, logs, and archived artifact detail.",
      status: `${runRows.length} saved comparison row${runRows.length === 1 ? "" : "s"}; ${visibleRuns} current/saved run${visibleRuns === 1 ? "" : "s"}`,
      statusState: runRows.length || visibleRuns ? "ok" : "warn",
      primary: { label: "View Performance", target: "performance", lens: "home" },
      secondary: { label: "Check Operations", target: "operations", lens: "paper" },
      next: {
        title: "Connect events back to results",
        note: "Open Performance after checking run state, fills, rejects, or artifact availability.",
      },
      guide: [
        { label: "Answers", title: "What exactly happened?", note: "Use this page for current run state, saved run search, timelines, orders, fills, rejects, logs, and artifacts." },
        { label: "Evidence", title: "Sanitized events and archived artifacts", note: "The page combines public-safe telemetry, account snapshots, order state, run summaries, and bounded log evidence." },
        { label: "Next Move", title: "Load artifacts or return to metrics", note: "Use artifact actions for charts and diagnostics, then return to Performance for period-level context." },
      ],
      steps: [
        { label: "1", title: "Find Run", note: "Search by run, draft, mode, status, symbol, or event text." },
        { label: "2", title: "Check State", note: "Separate current telemetry from archived artifacts and simulations." },
        { label: "3", title: "Read Timeline", note: "Follow decision, order, fill, reject, and account snapshots together." },
        { label: "4", title: "Open Artifact", note: "Load charts, trades, previews, logs, and public-safe diagnostics." },
      ],
    },
    operations: {
      eyebrow: "Operations",
      title: "Runtime, receiver, and remote-control health",
      note: "Check Gateway, supervisors, remote nodes, command queue, command audit, cleanup, diagnostics, and public endpoint health.",
      status: `${gatewayLabel}; ${remoteNodes.length} remote node${remoteNodes.length === 1 ? "" : "s"}; ${alerts.length} alert${alerts.length === 1 ? "" : "s"}`,
      statusState: gateway.enabled && !gateway.reachable ? "bad" : alerts.length ? "warn" : "ok",
      primary: { label: "Open Help", target: "help", lens: "home" },
      secondary: { label: "Back To Overview", target: "overview" },
      next: {
        title: "Clear runtime blockers",
        note: "Start with paper readiness and Gateway/API status before using remote controls.",
      },
      guide: [
        { label: "Answers", title: "Is the machine ready to run?", note: "Use this page for Gateway/API state, paper monitor readiness, remote node health, command controls, and audit trails." },
        { label: "Evidence", title: "Status posts, receiver state, commands, and audits", note: "Operational panels show public-safe receiver snapshots and local command evidence without exposing credentials." },
        { label: "Next Move", title: "Fix blockers before controls", note: "Clear stale data, account, Gateway, or audit warnings before queuing any command-like action." },
      ],
      steps: [
        { label: "1", title: "Check Gateway", note: "Confirm local API reachability, login clues, and status freshness." },
        { label: "2", title: "Review Alerts", note: "Handle stale bars, stale accounts, rejects, and risk-limit warnings." },
        { label: "3", title: "Audit Commands", note: "Inspect queued commands, results, hash-chain, and signatures." },
        { label: "4", title: "Maintain", note: "Review diagnostics, supervisors, cleanup, and remote-node health." },
      ],
    },
    help: {
      eyebrow: "Help",
      title: "How to operate the workbench",
      note: "Use the page guide, first-run checklist, data workflows, glossary, and linked runbooks when the next local step is unclear.",
      status: "Public-safe docs are served locally from the allowlisted docs folder.",
      statusState: "ok",
      primary: { label: "Start Overview", target: "overview" },
      secondary: { label: "Open Data Library", target: "data", lens: "browse" },
      next: {
        title: "Start with the current state",
        note: "Use Overview first, then follow the focused page shortcuts for the job at hand.",
      },
      guide: [
        { label: "Answers", title: "Where should I go next?", note: "Use Help when the dashboard state is unfamiliar or a setup step needs a command, runbook, or boundary explanation." },
        { label: "Evidence", title: "Local docs and current setup gaps", note: "Help combines static runbooks with live public-safe status, catalog, fetch, Workbench, and operations checks." },
        { label: "Next Move", title: "Follow one workflow at a time", note: "Pick monitoring, performance, data inspection, simulation, troubleshooting, or publishing and use its focused shortcut." },
      ],
      steps: [
        { label: "1", title: "Pick Question", note: "Use Start Here to route by the job you are trying to do." },
        { label: "2", title: "Close Gaps", note: "Read Current Setup Gaps for missing telemetry, data, or manifests." },
        { label: "3", title: "Follow Workflow", note: "Use the guide cards for fetch, replay, performance, and publishing." },
        { label: "4", title: "Open Docs", note: "Use runbooks and public-readiness docs for commands and boundaries." },
      ],
    },
  };
  return viewMap[view] || viewMap.overview;
}

export function renderPageIntro(view = activeView()) {
  if (!$("page-intro-title")) return;
  const content = pageIntroContent(normalizeView(view));
  renderRouteBreadcrumb(normalizeView(view));
  $("page-intro-eyebrow").textContent = content.eyebrow;
  $("page-intro-title").textContent = content.title;
  $("page-intro-note").textContent = content.note;
  $("page-intro-status").innerHTML = statusBadge(content.statusState || "ok", content.status);
  renderPageIntroEvidence(normalizeView(view));
  const next = content.next || {};
  if ($("page-intro-next-title")) {
    $("page-intro-next-title").textContent = next.title || (content.primary && content.primary.label) || "Continue";
  }
  if ($("page-intro-next-note")) {
    $("page-intro-next-note").textContent = next.note || "Use the focused action below to continue from this page.";
  }
  pageIntroAction("page-intro-primary", content.primary);
  pageIntroAction("page-intro-secondary", content.secondary);
}

