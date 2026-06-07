const state = {
  status: null,
  history: [],
  dataCatalog: { datasets: [], errors: [] },
  dataDetail: null,
  dataDetailPath: "",
  dataCoverage: { symbols: [], date_bins: [], errors: [] },
  dataGapSummary: { gap_rows: [], calendar_rows: [] },
  dataMinuteHeatmap: { rows: [], errors: [] },
  dataStorageAudit: { configured_roots: [], suggested_roots: [], warnings: [] },
  dataLibrary: {
    catalogLoading: false,
    diagnosticsLoading: false,
    catalogLoaded: false,
    diagnosticsLoaded: false,
    catalogError: "",
    diagnosticsError: "",
    diagnosticsRequested: false,
    catalogLimitTouched: false,
    requestId: 0,
  },
  dataCompare: null,
  dataCompareSelectedPaths: [],
  dataCompareSelectionCleared: false,
  symbolDiagnostic: null,
  symbolTypeaheadActiveIndex: 0,
  fetchManifests: { manifests: [], roots: [], errors: [] },
  fetchManifestDetail: null,
  manifestPathFilter: null,
  workbenchStatus: {},
  cleanupPlan: {},
  diagnostics: {},
  endpointMap: { endpoints: [] },
  configOptions: { plugins: [], modes: [], defaults: {} },
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
  performanceSourceMode: "current",
  performanceBenchmarkPath: "",
  performanceBenchmarkDetail: null,
  commands: [],
  results: [],
  commandAudit: { events: [] },
  remoteNodes: { nodes: [] },
  remoteNodeDetail: null,
  refreshLoaded: false,
  activityChanges: { items: [], initial: true },
};

const commandFields = {
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

const commandParamNames = {
  config: "config_id",
  job: "job_id",
  run: "run_id",
  supervisor: "supervisor_id",
};

const commandBoundaries = {
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

const $ = (id) => document.getElementById(id);
const MAX_DATA_COMPARE_DATASETS = 8;

function onOptional(id, eventName, handler) {
  const element = $(id);
  if (element) element.addEventListener(eventName, handler);
}

function token() {
  return sessionStorage.getItem("statusToken") || "";
}

function headers() {
  const out = { "Content-Type": "application/json" };
  const value = token();
  if (value) out.Authorization = `Bearer ${value}`;
  return out;
}

async function fetchJson(url, options = {}) {
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

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

function text(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  return String(value);
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function money(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(number);
}

function numberText(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function pctText(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number.toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
}

function signedValueClass(value) {
  if (value === null || value === undefined || value === "") return "value-neutral";
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "value-neutral";
  return number > 0 ? "value-gain" : "value-loss";
}

function drawdownValueClass(value) {
  if (value === null || value === undefined || value === "") return "value-neutral";
  const number = Number(value);
  if (!Number.isFinite(number) || number === 0) return "value-neutral";
  return "value-loss";
}

function valueHtml(value, formatter, className) {
  return `<span class="${escapeHtml(className)}">${escapeHtml(formatter(value))}</span>`;
}

function signedValueHtml(value, formatter = numberText) {
  return valueHtml(value, formatter, signedValueClass(value));
}

function cashValueHtml(value) {
  return valueHtml(value, money, "value-cash");
}

function equityValueHtml(value) {
  return valueHtml(value, money, "value-equity");
}

function bytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  if (number < 1024 * 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)} MB`;
  return `${(number / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function age(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 120) return `${Math.round(number)}s`;
  if (number < 7200) return `${Math.round(number / 60)}m`;
  if (number < 172800) return `${Math.round(number / 3600)}h`;
  return `${Math.round(number / 86400)}d`;
}

function interval(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 120) return `${Math.round(number)}s`;
  if (number < 7200) return `${Math.round(number / 60)}m`;
  if (number < 172800) return `${Math.round(number / 3600)}h`;
  return `${Math.round(number / 86400)}d`;
}

function statusClass(value) {
  if (value === "ok" || value === true || value === "completed" || value === "running" || value === "waiting") return "status-ok";
  if (value === "warn" || value === "pending" || value === "paused" || value === "canceled") return "status-warn";
  if (value === "bad" || value === "failed" || value === "rejected" || value === "timeout" || value === "unknown" || value === false) return "status-bad";
  return "";
}

function statusBadge(value, label = null) {
  const raw = label === null ? text(value) : text(label);
  const classes = ["status-badge", statusClass(value)].filter(Boolean).join(" ");
  return `<span class="${escapeHtml(classes)}">${escapeHtml(raw)}</span>`;
}

function row(cells) {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}

function kvRows(pairs, { mono = false } = {}) {
  return pairs.map(([key, value, isHtml]) => {
    const body = isHtml
      ? value
      : mono
        ? `<span class="mono">${escapeHtml(value)}</span>`
        : escapeHtml(value);
    return `<dt>${escapeHtml(key)}</dt><dd>${body}</dd>`;
  }).join("");
}

function statusText(value) {
  return statusBadge(value);
}

function objectSummary(value) {
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

function jsonDrilldown(value, summary = null) {
  const payload = value === undefined ? null : value;
  const serialized = typeof payload === "string" ? payload : JSON.stringify(payload ?? {}, null, 2);
  const label = summary || objectSummary(payload);
  if (!serialized || serialized === "{}" || serialized === "[]" || serialized === "null") {
    return `<span class="muted">${escapeHtml(label || "none")}</span>`;
  }
  return `<details class="json-drilldown"><summary>${escapeHtml(label || "details")}</summary><pre class="mono">${escapeHtml(serialized)}</pre></details>`;
}

function qualityBadge(status, warnings = []) {
  const warningList = Array.isArray(warnings) ? warnings : [];
  const suffix = warningList.length ? ` (${warningList.length})` : "";
  const title = warningList.length ? ` title="${escapeHtml(warningList.join("; "))}"` : "";
  return `<span class="status-badge ${escapeHtml(statusClass(status))}"${title}>${escapeHtml(text(status))}${escapeHtml(suffix)}</span>`;
}

function dataCatalogSettings() {
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

function syncDataCatalogLimitControl() {
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

function selectedDataCatalogLimit() {
  syncDataCatalogLimitControl();
  return $("data-catalog-limit").value || String(dataCatalogSettings().defaultLimit);
}

function dataCatalogPreviewPoints() {
  return 8;
}

function dataLibraryLoadState() {
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
      requestId: 0,
    };
  }
  return state.dataLibrary;
}

function setDataDiagnosticsLoadingNote(message, status = "warn") {
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

function availableViews() {
  return Array.from(document.querySelectorAll(".dashboard-section"))
    .map((section) => section.dataset.view)
    .filter(Boolean);
}

function dashboardHashParts(value) {
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

function normalizeView(view) {
  const cleaned = dashboardHashParts(view).view;
  const views = new Set(availableViews());
  return views.has(cleaned) ? cleaned : "overview";
}

function normalizeOverviewLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "activity", "diagnostics"]).has(cleaned) ? cleaned : "home";
}

function normalizePerformanceLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "trades", "rollups", "diagnostics"]).has(cleaned) ? cleaned : "home";
}

function normalizeDataLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "browse", "inspect", "compare", "diagnostics"]).has(cleaned) ? cleaned : "home";
}

function normalizeFetchLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "jobs", "detail"]).has(cleaned) ? cleaned : "home";
}

function normalizeWorkbenchLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "builder", "run", "artifacts"]).has(cleaned) ? cleaned : "home";
}

function normalizeRunsLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "state", "runs", "events"]).has(cleaned) ? cleaned : "home";
}

function normalizeOperationsLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "paper", "remote", "control", "diagnostics"]).has(cleaned) ? cleaned : "home";
}

function normalizeHelpLens(lens) {
  const cleaned = String(lens || "").replace(/^#/, "").trim().toLowerCase();
  return new Set(["home", "pages", "workflows", "data", "boundary", "docs"]).has(cleaned) ? cleaned : "home";
}

function overviewLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "overview") return "";
  return parts.hasExplicitLens ? normalizeOverviewLens(parts.lens) : "";
}

function performanceLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "performance") return "";
  return parts.hasExplicitLens ? normalizePerformanceLens(parts.lens) : "";
}

function dataLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "data") return "";
  return parts.hasExplicitLens ? normalizeDataLens(parts.lens) : "";
}

function fetchLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "fetch") return "";
  return parts.hasExplicitLens ? normalizeFetchLens(parts.lens) : "";
}

function workbenchLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "workbench") return "";
  return parts.hasExplicitLens ? normalizeWorkbenchLens(parts.lens) : "";
}

function runsLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "runs") return "";
  return parts.hasExplicitLens ? normalizeRunsLens(parts.lens) : "";
}

function operationsLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "operations") return "";
  return parts.hasExplicitLens ? normalizeOperationsLens(parts.lens) : "";
}

function helpLensFromHash(value) {
  const parts = dashboardHashParts(value);
  if (normalizeView(parts.view) !== "help") return "";
  return parts.hasExplicitLens ? normalizeHelpLens(parts.lens) : "";
}

function selectedOverviewLens() {
  const hashLens = overviewLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "overview" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeOverviewLens(sessionStorage.getItem("dashboardOverviewLens") || "home");
}

function selectedPerformanceLens() {
  const hashLens = performanceLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "performance" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizePerformanceLens(sessionStorage.getItem("dashboardPerformanceLens") || "home");
}

function selectedDataLens() {
  const hashLens = dataLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "data" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeDataLens(sessionStorage.getItem("dashboardDataLens") || "home");
}

function selectedFetchLens() {
  const hashLens = fetchLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "fetch" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeFetchLens(sessionStorage.getItem("dashboardFetchLens") || "home");
}

function selectedWorkbenchLens() {
  const hashLens = workbenchLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "workbench" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeWorkbenchLens(sessionStorage.getItem("dashboardWorkbenchLens") || "home");
}

function selectedRunsLens() {
  const hashLens = runsLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "runs" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeRunsLens(sessionStorage.getItem("dashboardRunsLens") || "home");
}

function selectedOperationsLens() {
  const hashLens = operationsLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "operations" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeOperationsLens(sessionStorage.getItem("dashboardOperationsLens") || "home");
}

function selectedHelpLens() {
  const hashLens = helpLensFromHash(window.location.hash);
  if (hashLens) return hashLens;
  const parts = dashboardHashParts(window.location.hash);
  const hashView = normalizeView(parts.view);
  if (window.location.hash && hashView === "help" && !parts.hasExplicitLens) {
    return "home";
  }
  return normalizeHelpLens(sessionStorage.getItem("dashboardHelpLens") || "home");
}

function viewFromHash() {
  return normalizeView(decodeURIComponent(window.location.hash || ""));
}

function setActiveView(view) {
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

function navigateToView(view) {
  const targetView = normalizeView(view);
  const nextHash = `#${targetView}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView(targetView);
}

function activeView() {
  return normalizeView(sessionStorage.getItem("dashboardView") || window.location.hash || "overview");
}

function overviewLensContent(lens) {
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

function applyOverviewLens(lens) {
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
}

function navigateToOverviewLens(lens) {
  const selected = normalizeOverviewLens(lens);
  const nextHash = selected === "home" ? "#overview" : `#overview/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("overview");
}

function performanceLensContent(lens) {
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

function applyPerformanceLens(lens) {
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
}

function navigateToPerformanceLens(lens) {
  const selected = normalizePerformanceLens(lens);
  const nextHash = selected === "home" ? "#performance" : `#performance/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("performance");
}

function dataLensContent(lens) {
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

function applyDataLens(lens) {
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
  if (state.refreshLoaded && activeView() === "data") {
    refreshDataLibrary({ includeDiagnostics: selected === "diagnostics" }).catch((err) => {
      $("last-refresh").textContent = `Data Library refresh failed: ${err.message}`;
    });
  }
}

function navigateToDataLens(lens) {
  const selected = normalizeDataLens(lens);
  const nextHash = selected === "home" ? "#data" : `#data/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("data");
}

function fetchLensContent(lens) {
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

function applyFetchLens(lens) {
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
}

function navigateToFetchLens(lens) {
  const selected = normalizeFetchLens(lens);
  const nextHash = selected === "home" ? "#fetch" : `#fetch/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("fetch");
}

function workbenchLensContent(lens) {
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

function applyWorkbenchLens(lens) {
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
}

function navigateToWorkbenchLens(lens) {
  const selected = normalizeWorkbenchLens(lens);
  const nextHash = selected === "home" ? "#workbench" : `#workbench/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("workbench");
}

function runsLensContent(lens) {
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

function applyRunsLens(lens) {
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
}

function navigateToRunsLens(lens) {
  const selected = normalizeRunsLens(lens);
  const nextHash = selected === "home" ? "#runs" : `#runs/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("runs");
}

function operationsLensContent(lens) {
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

function applyOperationsLens(lens) {
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
}

function navigateToOperationsLens(lens) {
  const selected = normalizeOperationsLens(lens);
  const nextHash = selected === "home" ? "#operations" : `#operations/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("operations");
}

function helpLensContent(lens) {
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

function applyHelpLens(lens) {
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
}

function navigateToHelpLens(lens) {
  const selected = normalizeHelpLens(lens);
  const nextHash = selected === "home" ? "#help" : `#help/${selected}`;
  if (window.location.hash !== nextHash) {
    window.location.hash = nextHash;
    return;
  }
  setActiveView("help");
}

function navigateToViewTarget(view, lens = "") {
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

function pageIntroAction(id, action) {
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

function pageIntroEvidence(view) {
  const payload = state.status || {};
  const statusGenerated = payload.generated_at || "";
  const dataCatalog = state.dataCatalog || {};
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
      countValue("Visible", (dataCatalog.datasets || []).length, "file"),
      countValue("Roots", ((dataCatalog.root_summaries || dataCatalog.roots || [])).length, "root"),
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

function renderPageIntroEvidence(view) {
  const container = $("page-intro-evidence");
  if (!container) return;
  container.innerHTML = pageIntroEvidence(view).map((item) => `
    <span class="evidence-chip status-${escapeHtml(item.status)}">
      <b>${escapeHtml(item.label)}</b>
      <em>${escapeHtml(item.value)}</em>
    </span>
  `).join("");
}

function pageIntroContent(view) {
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

function renderPageIntro(view = activeView()) {
  if (!$("page-intro-title")) return;
  const content = pageIntroContent(normalizeView(view));
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
  const steps = Array.isArray(content.steps) ? content.steps : [];
  const stepContainer = $("page-intro-steps");
  if (stepContainer) {
    stepContainer.innerHTML = steps.map((step) => `
      <div class="page-step">
        <span>${escapeHtml(step.label)}</span>
        <strong>${escapeHtml(step.title)}</strong>
        <small>${escapeHtml(step.note)}</small>
      </div>
    `).join("");
  }
  pageIntroAction("page-intro-primary", content.primary);
  pageIntroAction("page-intro-secondary", content.secondary);
}

function helpSetupGapItems() {
  const status = state.status || {};
  const diagnostics = state.diagnostics || {};
  const catalog = state.dataCatalog || {};
  const fetchManifests = state.fetchManifests || {};
  const drafts = state.configDrafts || {};
  const runs = status.runs || [];
  const alerts = status.alerts || [];
  const gateway = status.gateway || {};
  const dataRoots = diagnostics.data_roots || [];
  const activeRoots = dataRoots.filter((root) => root.exists && root.is_dir);
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const datasets = catalog.datasets || [];
  const cappedRoots = (catalog.root_summaries || []).filter((root) => root.scan_capped);
  const manifests = fetchManifests.manifests || [];
  const draftRows = drafts.drafts || [];
  const statusLoaded = Object.keys(status).length > 0;
  const gatewayEnabled = Boolean(gateway.enabled);
  return [
    {
      status: statusLoaded ? runs.length ? "ok" : "warn" : "bad",
      title: statusLoaded ? runs.length ? "Telemetry is publishing" : "Status loaded, no run rows" : "No status snapshot loaded",
      label: "Overview",
      note: statusLoaded
        ? runs.length
          ? `${numberText(runs.length, 0)} run${runs.length === 1 ? "" : "s"} visible; ${numberText(alerts.length, 0)} alert${alerts.length === 1 ? "" : "s"}`
          : "The receiver is reachable, but no runner telemetry is publishing recent run rows."
        : "Start the status publisher or point the dashboard at a state directory with current status.",
      href: "#overview",
    },
    {
      status: gatewayEnabled ? gateway.reachable ? "ok" : "bad" : "warn",
      title: gatewayEnabled ? gateway.reachable ? "Gateway/API check is reachable" : "Gateway/API check is not reachable" : "Gateway check is disabled",
      label: "Operations",
      note: gatewayEnabled
        ? gateway.reachable
          ? `${text(gateway.host)}:${text(gateway.port)} responded`
          : text(gateway.error || "Gateway is enabled but not reachable")
        : "This is fine for offline replay; enable Gateway checks for paper/live monitoring.",
      href: "#operations",
    },
    {
      status: activeRoots.length ? suggestedRoots.length ? "warn" : "ok" : "bad",
      title: activeRoots.length ? suggestedRoots.length ? "Data roots work, but extra roots exist" : "Configured data roots are readable" : "No readable data root configured",
      label: "Data Library",
      note: activeRoots.length
        ? `${numberText(activeRoots.length, 0)} active root${activeRoots.length === 1 ? "" : "s"}; ${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"} with data`
        : "Add a local cache/history directory under dashboard.data_roots.",
      href: "#data",
    },
    {
      status: datasets.length ? cappedRoots.length ? "warn" : "ok" : "bad",
      title: datasets.length ? cappedRoots.length ? "Saved data is visible but scan is capped" : "Saved data is visible" : "No saved datasets loaded",
      label: "Data Library",
      note: datasets.length
        ? `${numberText(datasets.length, 0)} dataset${datasets.length === 1 ? "" : "s"} loaded; catalog limit ${numberText(catalog.limit || 0, 0)}`
        : "Fetch data, add data roots, or inspect Storage Audit for roots outside the scan.",
      href: "#data",
    },
    {
      status: manifests.length ? "ok" : "warn",
      title: manifests.length ? "Fetch manifests are visible" : "No fetch manifests visible",
      label: "Fetch Jobs",
      note: manifests.length
        ? `${numberText(manifests.length, 0)} latest manifest${manifests.length === 1 ? "" : "s"} loaded`
        : "Fetch Jobs will stay empty until fetch scripts write manifests under dashboard.fetch_manifest_roots.",
      href: "#fetch",
    },
    {
      status: draftRows.length ? "ok" : datasets.length ? "warn" : "bad",
      title: draftRows.length ? "Workbench drafts exist" : datasets.length ? "Ready to create a replay draft" : "Workbench needs saved data first",
      label: "Workbench",
      note: draftRows.length
        ? `${numberText(draftRows.length, 0)} draft${draftRows.length === 1 ? "" : "s"} available for validation/run review`
        : datasets.length
          ? "Select scanned data, preview alignment, then generate a public-safe draft."
          : "Load at least one saved dataset before generating a replay or simulated-paper draft.",
      href: "#workbench",
    },
  ];
}

function renderHelpSetupGaps() {
  if (!$("help-setup-gaps") || !$("help-setup-note")) return;
  const items = helpSetupGapItems();
  const badCount = items.filter((item) => item.status === "bad").length;
  const warnCount = items.filter((item) => item.status === "warn").length;
  $("help-setup-note").textContent = badCount
    ? `${badCount} setup blocker${badCount === 1 ? "" : "s"} to address first`
    : warnCount
      ? `${warnCount} setup warning${warnCount === 1 ? "" : "s"}`
      : "Core setup surfaces look ready";
  $("help-setup-gaps").innerHTML = items.map((item) => `
    <a class="action-card status-${escapeHtml(item.status)}" href="${escapeHtml(item.href)}">
      <span>${statusText(item.status)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.label)} - ${escapeHtml(item.note)}</small>
    </a>
  `).join("");
  renderHelpWorkflowLauncher(items);
  renderHelpNextAssistant(items);
}

function helpWorkflowCards(setupItems = helpSetupGapItems()) {
  const runs = (state.status && state.status.runs) || [];
  const events = runEventRows();
  const openOrders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const accountRows = source.account || [];
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const draftRows = (state.configDrafts && state.configDrafts.drafts) || [];
  const workbenchRuns = (state.configRuns && state.configRuns.runs) || [];
  const artifactLoaded = Boolean(state.configArtifacts && (state.configArtifacts.run_id || state.configArtifacts.draft_id));
  const badSetup = setupItems.filter((item) => item.status === "bad");
  const warnSetup = setupItems.filter((item) => item.status === "warn");
  const latestDecision = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");
  const latestReject = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const runEvidence = runs.length || events.length || accountRows.length;
  const simulationReady = datasets.length && (draftRows.length || workbenchRuns.length || artifactLoaded);
  const firstSetupIssue = badSetup[0] || warnSetup[0] || null;
  return [
    {
      label: "Monitor Today",
      title: runs.length ? `${numberText(runs.length, 0)} Runs` : "No Telemetry",
      value: latestReject ? "reject visible" : latestFill ? "fill visible" : latestDecision ? "decision visible" : openOrders.length ? "open orders" : "start here",
      status: latestReject ? "bad" : openOrders.length ? "warn" : runs.length ? "ok" : "bad",
      detail: runs.length
        ? "Use Overview for current health, mode, latest signal/fill, positions, and the fastest next action."
        : "Start with Overview and Operations to determine whether a runner is publishing current telemetry.",
      href: workflowHref("overview", runs.length ? "home" : "diagnostics"),
      cta: "Overview",
    },
    {
      label: "Read Performance",
      title: accountRows.length ? "Account Path" : source.has_data ? "Limited Source" : "No Source",
      value: accountRows.length ? `${numberText(accountRows.length, 0)} snapshots` : source.source_type || "missing",
      status: accountRows.length ? "ok" : source.has_data ? "warn" : runEvidence ? "warn" : "bad",
      detail: accountRows.length
        ? "Open Performance for latest-session PnL, equity curve, drawdown, returns, trades, and rollups."
        : "Performance needs account snapshots or run artifacts before return and drawdown views become useful.",
      href: workflowHref("performance", source.has_data ? "home" : "diagnostics"),
      cta: "Performance",
    },
    {
      label: "Inspect Data",
      title: datasets.length ? `${numberText(datasets.length, 0)} Files` : "No Files",
      value: manifests.length ? `${numberText(manifests.length, 0)} fetches` : "data roots",
      status: datasets.length > 2 ? "ok" : datasets.length ? "warn" : manifests.length ? "warn" : "bad",
      detail: datasets.length
        ? "Use Data Library for symbols, saved-file charts, quality checks, comparisons, and visibility diagnostics."
        : manifests.length ? "Fetch manifests exist; use Fetch Jobs and Data Library to understand output visibility." : "Configure data roots or run a fetch before simulation workflows can start.",
      href: workflowHref("data", datasets.length ? "browse" : "diagnostics"),
      cta: "Data",
    },
    {
      label: "Build Simulation",
      title: simulationReady ? "Ready" : datasets.length ? "Needs Draft" : "Needs Data",
      value: draftRows.length ? `${numberText(draftRows.length, 0)} drafts` : workbenchRuns.length ? `${numberText(workbenchRuns.length, 0)} runs` : "workbench",
      status: simulationReady ? "ok" : datasets.length ? "warn" : "bad",
      detail: datasets.length
        ? "Use Workbench to select files, preview alignment, build a public-safe draft, validate it, and run replay."
        : "Simulation starts after Data Library can see saved historical files.",
      href: workflowHref("workbench", datasets.length ? "builder" : "home"),
      cta: "Workbench",
    },
    {
      label: "Troubleshoot",
      title: firstSetupIssue ? firstSetupIssue.title : "Setup Looks Clean",
      value: badSetup.length ? `${numberText(badSetup.length, 0)} blockers` : warnSetup.length ? `${numberText(warnSetup.length, 0)} warnings` : "no gaps",
      status: badSetup.length ? "bad" : warnSetup.length ? "warn" : "ok",
      detail: firstSetupIssue
        ? `${text(firstSetupIssue.label)}: ${text(firstSetupIssue.note)}`
        : "Current setup-gap checks have no visible blockers; use Operations for paper, Gateway, remote, and command health.",
      href: firstSetupIssue ? firstSetupIssue.href : workflowHref("operations", "paper"),
      cta: firstSetupIssue ? "Fix Gap" : "Operations",
    },
    {
      label: "Publish Safely",
      title: "Boundary Guide",
      value: "public/private",
      status: "ok",
      detail: "Use the Boundary and Docs lenses for public examples, ignored private configs, publication checks, and runbook links.",
      href: workflowHref("help", "boundary"),
      cta: "Boundary",
    },
  ];
}

function helpNextAssistantModel(setupItems = helpSetupGapItems()) {
  const workflows = helpWorkflowCards(setupItems);
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const runs = (state.status && state.status.runs) || [];
  const events = runEventRows();
  const source = latestArtifactPerformance();
  const badSetup = setupItems.filter((item) => item.status === "bad");
  const warnSetup = setupItems.filter((item) => item.status === "warn");
  let primary = workflows.find((card) => card.label === "Monitor Today") || workflows[0];
  let title = "Check Current Health";
  let note = "Start in Overview to confirm whether a runner is publishing telemetry and whether the latest state is fresh.";
  if (badSetup.length) {
    primary = workflows.find((card) => card.label === "Troubleshoot") || primary;
    title = "Fix Setup First";
    note = `${text(badSetup[0].label)} is blocking the workflow: ${text(badSetup[0].note)}`;
  } else if (!datasets.length) {
    primary = workflows.find((card) => card.label === "Inspect Data") || primary;
    title = "Make Saved Data Visible";
    note = "Data Library needs configured roots and visible CSV/parquet files before replay setup is useful.";
  } else if (!drafts.length) {
    primary = workflows.find((card) => card.label === "Build Simulation") || primary;
    title = "Build A Replay Draft";
    note = "Saved data is visible; use Workbench to select files, preview alignment, generate a draft, and validate it.";
  } else if (runs.length || events.length) {
    primary = workflows.find((card) => card.label === "Monitor Today") || primary;
    title = "Review Current Run";
    note = "Runner telemetry exists; use Overview first, then Performance or Runs when a number needs evidence.";
  } else if (source.has_data) {
    primary = workflows.find((card) => card.label === "Read Performance") || primary;
    title = "Read Saved Performance";
    note = "A saved artifact source is loaded; inspect Performance for returns, drawdown, trades, and rollups.";
  } else if (warnSetup.length) {
    primary = workflows.find((card) => card.label === "Troubleshoot") || primary;
    title = "Review Setup Warnings";
    note = `${text(warnSetup[0].label)} has a warning: ${text(warnSetup[0].note)}`;
  }
  const supportCards = [
    {
      status: badSetup.length ? "bad" : warnSetup.length ? "warn" : "ok",
      label: "Setup",
      title: badSetup.length ? `${numberText(badSetup.length, 0)} blockers` : warnSetup.length ? `${numberText(warnSetup.length, 0)} warnings` : "Ready",
      note: badSetup[0] ? text(badSetup[0].title) : warnSetup[0] ? text(warnSetup[0].title) : "No visible setup blockers.",
    },
    {
      status: runs.length || events.length ? "ok" : "warn",
      label: "Telemetry",
      title: runs.length ? `${numberText(runs.length, 0)} runs` : events.length ? `${numberText(events.length, 0)} events` : "None",
      note: runs.length || events.length ? "Current run evidence is available." : "No current run telemetry is visible.",
    },
    {
      status: datasets.length ? "ok" : "bad",
      label: "Data",
      title: numberText(datasets.length, 0),
      note: datasets.length ? "Saved data is visible to the dashboard." : "No saved data is catalog-visible.",
    },
    {
      status: drafts.length ? "ok" : datasets.length ? "warn" : "bad",
      label: "Workbench",
      title: drafts.length ? `${numberText(drafts.length, 0)} drafts` : "No drafts",
      note: drafts.length ? "Saved drafts can be validated or run." : datasets.length ? "Create a replay draft next." : "Workbench needs visible data first.",
    },
  ];
  const actions = [
    primary,
    workflows.find((card) => card.label === "Inspect Data"),
    workflows.find((card) => card.label === "Build Simulation"),
    workflows.find((card) => card.label === "Publish Safely"),
  ].filter(Boolean);
  return { title, note, primary, supportCards, actions };
}

function renderHelpNextAssistant(setupItems = helpSetupGapItems()) {
  if (!$("help-next-title") || !$("help-next-cards") || !$("help-next-actions")) return;
  const model = helpNextAssistantModel(setupItems);
  $("help-next-title").textContent = model.title;
  $("help-next-note").textContent = model.note;
  $("help-next-cards").innerHTML = model.supportCards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("help-next-actions").innerHTML = model.actions.map((action, index) => `
    <a class="help-next-action ${index === 0 ? "primary-help-action" : ""} status-${escapeHtml(action.status)}" href="${escapeHtml(action.href)}">
      <span>
        <strong>${escapeHtml(index === 0 ? `Recommended: ${action.label}` : action.label)}</strong>
        <small>${escapeHtml(action.detail)}</small>
      </span>
      <b>${escapeHtml(action.cta)}</b>
    </a>
  `).join("");
}

function renderHelpWorkflowLauncher(setupItems = helpSetupGapItems()) {
  const container = $("help-workflows");
  if (!container) return;
  const cards = helpWorkflowCards(setupItems);
  container.innerHTML = cards.map((card) => `
    <a class="action-card workflow-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <div class="workflow-card-foot">
        <em>${escapeHtml(card.value)}</em>
        <b>${escapeHtml(card.cta)}</b>
      </div>
    </a>
  `).join("");
}

function latestTelemetryRun() {
  const runs = (state.status && state.status.runs) || [];
  if (!runs.length) return null;
  return runs.slice().sort((a, b) => {
    const aTime = String((a.metrics || {}).last_decision_time || a.generated_at || "");
    const bTime = String((b.metrics || {}).last_decision_time || b.generated_at || "");
    return bTime.localeCompare(aTime);
  })[0];
}

function latestSupervisor() {
  const supervisors = (state.status && state.status.supervisors) || [];
  if (!supervisors.length) return null;
  return supervisors.slice().sort((a, b) => {
    const aTime = String(a.generated_at || "");
    const bTime = String(b.generated_at || "");
    return bTime.localeCompare(aTime);
  })[0];
}

function latestSummarizedComparisonRun() {
  const runs = (state.runComparison && state.runComparison.runs) || [];
  return runs.find((runItem) => runItem.summary_available) || null;
}

function emptyPerformanceSource(label = "No run data", sourceType = "none") {
  return {
    label,
    summary: {},
    performance: {},
    account: [],
    fills: [],
    orders: [],
    decisions: [],
    source_type: sourceType,
    has_data: false,
  };
}

function artifactPerformanceSource() {
  const artifacts = state.configArtifacts || {};
  if (artifacts.run_id || artifacts.draft_id) {
    return {
      label: artifacts.run_id
        ? `${text(artifacts.draft_id)} / ${text(artifacts.run_id)}`
        : `${text(artifacts.draft_id)} latest output`,
      summary: artifacts.summary || {},
      performance: artifacts.performance || {},
      account: artifacts.account || [],
      fills: artifacts.fills || [],
      orders: artifacts.orders || [],
      decisions: artifacts.decisions || [],
      source_type: "archived_artifact",
      has_data: true,
    };
  }
  return emptyPerformanceSource("No artifact loaded", "archived_artifact");
}

function summaryPerformanceSource() {
  const comparison = latestSummarizedComparisonRun();
  if (comparison) {
    return {
      label: `${text(comparison.draft_id)} / ${text(comparison.action)} ${text(comparison.finished_at)}`,
      summary: comparison,
      performance: comparison,
      account: [],
      fills: [],
      orders: [],
      decisions: [],
      source_type: "run_summary",
      has_data: true,
    };
  }
  return emptyPerformanceSource("No saved run summary", "run_summary");
}

function telemetryPerformanceSource() {
  const telemetryRun = latestTelemetryRun();
  if (telemetryRun) {
    const metrics = telemetryRun.metrics || {};
    return {
      label: `${text(telemetryRun.id)} telemetry`,
      summary: metrics,
      performance: metrics,
      account: [],
      fills: [],
      orders: [],
      decisions: [],
      source_type: "live_telemetry",
      has_data: true,
    };
  }
  return emptyPerformanceSource("No current telemetry", "live_telemetry");
}

function currentPerformanceSource() {
  const telemetry = telemetryPerformanceSource();
  if (telemetry.source_type === "live_telemetry" && telemetry.label !== "No current telemetry") return telemetry;
  const summary = summaryPerformanceSource();
  if (summary.source_type === "run_summary" && summary.label !== "No saved run summary") return summary;
  return emptyPerformanceSource("No current run data", "current");
}

function latestArtifactPerformance() {
  if (state.performanceSourceMode === "artifact") return artifactPerformanceSource();
  if (state.performanceSourceMode === "latest_run") return summaryPerformanceSource();
  return currentPerformanceSource();
}

function strategyIdentityModel(source = latestArtifactPerformance()) {
  const telemetryRun = latestTelemetryRun() || {};
  const metrics = telemetryRun.metrics || {};
  const summary = (source && source.summary) || {};
  const perf = (source && source.performance) || {};
  const artifacts = state.configArtifacts || {};
  const strategyName = firstPresent(
    metrics.strategy_name,
    metrics.strategy,
    metrics.plugin,
    metrics.plugin_id,
    summary.strategy_name,
    summary.strategy,
    summary.plugin,
    summary.plugin_id,
    perf.strategy_name,
    perf.strategy,
    perf.plugin,
    perf.plugin_id,
    artifacts.strategy_name,
    artifacts.plugin,
    artifacts.plugin_id,
  );
  const draftId = firstPresent(
    telemetryRun.draft_id,
    metrics.draft_id,
    summary.draft_id,
    perf.draft_id,
    artifacts.draft_id,
  );
  const runId = firstPresent(
    telemetryRun.id,
    telemetryRun.run_id,
    metrics.run_id,
    summary.run_id,
    perf.run_id,
    artifacts.run_id,
  );
  const mode = firstPresent(metrics.mode, summary.mode, perf.mode);
  const sourceType = firstPresent(source && source.source_type, "none");
  const updatedAt = firstPresent(
    metrics.last_decision_time,
    metrics.latest_data_time,
    metrics.latest_market_data_time,
    telemetryRun.generated_at,
    sourceTimestamp(source),
  );
  const status = source && source.has_data ? "ok" : telemetryRun.id ? "warn" : "bad";
  return {
    status,
    title: strategyName || (draftId ? text(draftId) : runId ? text(runId) : "No strategy identified"),
    sourceType,
    mode: mode || "unknown",
    draftId: draftId || "n/a",
    runId: runId || "n/a",
    updatedAt,
  };
}

function renderStrategyIdentity(targetId, source = latestArtifactPerformance()) {
  const container = $(targetId);
  if (!container) return;
  const identity = strategyIdentityModel(source);
  const updated = identity.updatedAt ? shortTimestampAgeLabel(identity.updatedAt) : "not published";
  container.innerHTML = [
    { label: "Strategy", value: identity.title, status: identity.status },
    { label: "Mode", value: identity.mode, status: identity.mode === "unknown" ? "warn" : "ok" },
    { label: "Source", value: identity.sourceType, status: identity.status },
    { label: "Draft", value: identity.draftId, status: identity.draftId === "n/a" ? "warn" : "ok" },
    { label: "Run", value: identity.runId, status: identity.runId === "n/a" ? "warn" : "ok" },
    { label: "Updated", value: updated, status: identity.updatedAt ? "ok" : "warn" },
  ].map((item) => `
    <span class="strategy-identity-chip status-${escapeHtml(item.status)}">
      <b>${escapeHtml(item.label)}</b>
      <em>${escapeHtml(item.value)}</em>
    </span>
  `).join("");
}

function benchmarkDatasets() {
  return (state.dataCatalog.datasets || [])
    .filter((dataset) => dataset.path)
    .sort((a, b) => {
      const left = `${text(a.symbol)} ${text(a.bar_size)} ${text(a.path)}`.toLowerCase();
      const right = `${text(b.symbol)} ${text(b.bar_size)} ${text(b.path)}`.toLowerCase();
      return left.localeCompare(right);
    });
}

function renderPerformanceBenchmarkOptions() {
  const select = $("performance-benchmark");
  if (!select) return;
  const options = [
    { value: "", label: "No benchmark" },
    ...benchmarkDatasets().map((dataset) => ({
      value: dataset.path,
      label: `${text(dataset.symbol)} ${text(dataset.bar_size)} ${text(dataset.source)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}]`,
    })),
  ];
  replaceOptions(select, options);
  if (state.performanceBenchmarkPath && options.some((option) => option.value === state.performanceBenchmarkPath)) {
    select.value = state.performanceBenchmarkPath;
  } else if (state.performanceBenchmarkPath) {
    state.performanceBenchmarkPath = "";
    state.performanceBenchmarkDetail = null;
    select.value = "";
  }
}

function selectedConfigDatasets() {
  const select = $("config-dataset");
  if (!select) return [];
  const selectedPaths = Array.from(select.selectedOptions).map((option) => option.value);
  return (state.dataCatalog.datasets || []).filter((item) => selectedPaths.includes(item.path));
}

function selectedDataReadiness(selected = selectedConfigDatasets()) {
  const qualityIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.quality_status).toLowerCase()));
  const contractIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.storage_contract_status).toLowerCase()));
  const badContract = contractIssues.some((dataset) => text(dataset.storage_contract_status).toLowerCase() === "bad");
  const issueCount = qualityIssues.length + contractIssues.length;
  return {
    qualityIssues,
    contractIssues,
    issueCount,
    status: !selected.length ? "bad" : badContract ? "bad" : issueCount ? "warn" : "ok",
    summary: `${numberText(qualityIssues.length, 0)} quality / ${numberText(contractIssues.length, 0)} contract`,
    cleanNote: "Selected files pass current quality and storage-contract checks.",
    reviewNote: `${numberText(qualityIssues.length, 0)} quality and ${numberText(contractIssues.length, 0)} contract issue${contractIssues.length === 1 ? "" : "s"} need review.`,
  };
}

function configDateRangePayload() {
  return {
    start: $("config-start-date") ? $("config-start-date").value : "",
    end: $("config-end-date") ? $("config-end-date").value : "",
  };
}

function renderConfigDataQuality() {
  const selected = selectedConfigDatasets();
  if (!$("config-data-quality-note") || !$("config-data-quality-body")) return;
  renderConfigDataActions(selected);
  renderWorkbenchSelectedDataPacket(selected);
  if (!selected.length) {
    $("config-data-quality-note").innerHTML = `<span class="muted">No datasets selected</span>`;
    $("config-data-quality-body").innerHTML = row([
      `<span class="muted">select datasets</span>`,
      "",
      "",
      "",
      "",
      "",
      "",
      "",
    ]);
    return;
  }
  const warningRows = selected.filter((dataset) => (
    dataset.quality_status === "warn" || dataset.quality_status === "bad"
  ));
  $("config-data-quality-note").innerHTML = warningRows.length
    ? `<span class="status-warn">${warningRows.length} suspicious of ${selected.length} selected</span>`
    : `<span class="status-ok">${selected.length} selected datasets ready</span>`;
  $("config-data-quality-body").innerHTML = selected.map((dataset) => row([
    escapeHtml(text(dataset.symbol)),
    qualityBadge(dataset.quality_status, dataset.quality_warnings),
    qualityBadge(dataset.storage_contract_status, dataset.storage_contract_warnings),
    escapeHtml(text(dataset.bar_size)),
    escapeHtml(numberText(dataset.rows, 0)),
    escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp)),
    escapeHtml((dataset.quality_warnings || []).join("; ") || "none"),
    `<span class="mono">${escapeHtml(dataset.path)}</span>`,
  ])).join("");
}

function selectedDataPacketStatus(selected, alignment, qualityIssues, contractIssues) {
  if (!selected.length) return { status: "bad", title: "Choose Data", note: "Select saved files from Data Library before building a draft." };
  if (qualityIssues.length && contractIssues.length) return { status: "warn", title: "Review Data", note: `${numberText(qualityIssues.length, 0)} quality and ${numberText(contractIssues.length, 0)} metadata issue${contractIssues.length === 1 ? "" : "s"} need review.` };
  if (qualityIssues.length) return { status: "warn", title: "Review Quality", note: `${numberText(qualityIssues.length, 0)} selected file${qualityIssues.length === 1 ? "" : "s"} need review before replay.` };
  if (contractIssues.length) return { status: "warn", title: "Review Metadata", note: `${numberText(contractIssues.length, 0)} selected file${contractIssues.length === 1 ? "" : "s"} have storage-contract warnings.` };
  if (!alignment.dataset_count) return { status: "warn", title: "Preview Alignment", note: "Selected files are clean enough to review; preview timestamp overlap next." };
  if (Number(alignment.common_timestamp_count || 0) <= 0) return { status: "bad", title: "No Overlap", note: "Selected files do not share timestamps in the current date range." };
  if (Number(alignment.warning_count || 0)) return { status: "warn", title: "Alignment Warnings", note: `${numberText(alignment.warning_count, 0)} alignment warning${Number(alignment.warning_count || 0) === 1 ? "" : "s"} need review.` };
  return { status: "ok", title: "Ready", note: "Selected files have quality and timestamp overlap evidence." };
}

function renderWorkbenchSelectedDataPacket(selected = selectedConfigDatasets()) {
  if (!$("workbench-selected-data-note") || !$("workbench-selected-data-cards") || !$("workbench-selected-data-list")) return;
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const range = configDateRangePayload();
  const qualityIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.quality_status).toLowerCase()));
  const contractIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.storage_contract_status).toLowerCase()));
  const symbols = Array.from(new Set(selected.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a")));
  const bars = Array.from(new Set(selected.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a")));
  const sources = Array.from(new Set(selected.map((dataset) => text(dataset.source)).filter((value) => value !== "n/a")));
  const status = selectedDataPacketStatus(selected, alignment, qualityIssues, contractIssues);
  $("workbench-selected-data-note").textContent = selected.length
    ? `${numberText(selected.length, 0)} dataset${selected.length === 1 ? "" : "s"} selected for ${text($("config-mode") && $("config-mode").value)}`
    : "No saved datasets selected";
  const cards = [
    {
      status: status.status,
      title: status.title,
      label: "Packet",
      note: status.note,
    },
    {
      status: selected.length ? "ok" : "bad",
      title: symbols.length ? `${numberText(symbols.length, 0)} symbol${symbols.length === 1 ? "" : "s"}` : "None",
      label: "Universe",
      note: symbols.length ? symbols.slice(0, 5).join(", ") : "Use Data Library to choose saved files.",
    },
    {
      status: selected.length ? "ok" : "bad",
      title: bars.length ? bars.join(", ") : "n/a",
      label: "Bars",
      note: sources.length ? `Sources: ${sources.slice(0, 4).join(", ")}` : "No source metadata loaded.",
    },
    {
      status: contractIssues.length ? "warn" : selected.length ? "ok" : "bad",
      title: selected.length ? contractIssues.length ? `${numberText(contractIssues.length, 0)} review` : "Clear" : "n/a",
      label: "Contract",
      note: contractIssues.length
        ? "Review timestamp/session/bar-size/adjustment metadata before replay."
        : selected.length ? "Selected files pass current storage-contract checks." : "No selected files.",
    },
    {
      status: range.start || range.end ? "ok" : selected.length ? "warn" : "bad",
      title: range.start || range.end ? "Date Window" : "Full Files",
      label: "Range",
      note: range.start || range.end ? `${range.start || "first bar"} to ${range.end || "last bar"}` : "No Workbench date filter set.",
    },
    {
      status: alignment.dataset_count ? Number(alignment.common_timestamp_count || 0) ? "ok" : "bad" : selected.length ? "warn" : "bad",
      title: alignment.dataset_count ? numberText(alignment.common_timestamp_count, 0) : "Not Previewed",
      label: "Overlap",
      note: alignment.dataset_count ? `${pctText(alignment.common_coverage_pct)} common coverage.` : "Click Preview Alignment before generating a draft.",
    },
  ];
  $("workbench-selected-data-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-selected-data-list").innerHTML = selected.length
    ? selected.map((dataset, index) => {
        const quality = text(dataset.quality_status).toLowerCase();
        const contract = text(dataset.storage_contract_status).toLowerCase();
        const statusClass = quality === "bad" || contract === "bad" ? "bad" : quality === "warn" || contract === "warn" ? "warn" : "ok";
        const warnings = [
          ...(dataset.quality_warnings || []),
          ...(dataset.storage_contract_warnings || []),
        ].join("; ") || "No quality or storage-contract warnings reported.";
        return `
          <article class="workbench-selected-data-item status-${escapeHtml(statusClass)}">
            <div>
              <span>${escapeHtml(text(dataset.symbol))} / ${escapeHtml(text(dataset.bar_size))} / ${escapeHtml(text(dataset.source))}</span>
              <strong>${escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp))}</strong>
              <small>${escapeHtml(numberText(dataset.rows, 0))} rows - ${escapeHtml(text(dataset.storage_session))} - contract ${escapeHtml(text(dataset.storage_contract_status))} - ${escapeHtml(warnings)}</small>
              <code>${escapeHtml(dataset.path)}</code>
            </div>
            <div>
              <button type="button" class="secondary" data-workbench-selected-data-action="inspect" data-path="${escapeHtml(dataset.path)}">Inspect</button>
              <button type="button" class="secondary" data-workbench-selected-data-action="compare" data-path="${escapeHtml(dataset.path)}">Compare</button>
              <button type="button" class="secondary" data-workbench-selected-data-action="remove" data-path="${escapeHtml(dataset.path)}">Remove</button>
              <span>${escapeHtml(`#${index + 1}`)}</span>
            </div>
          </article>
        `;
      }).join("")
    : `
      <div class="empty-card">
        <strong>No saved files selected</strong>
        <span>Open Data Library, choose one or more catalog rows, then return here to preview alignment and generate a draft.</span>
        <button type="button" class="secondary" data-workbench-selected-data-action="library">Open Data Library</button>
      </div>
    `;
}

function renderConfigDataActions(selected = selectedConfigDatasets()) {
  if (!$("config-data-actions-note") || !$("config-data-actions-cards")) return;
  const qualityIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.quality_status).toLowerCase()));
  const contractIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.storage_contract_status).toLowerCase()));
  const symbols = Array.from(new Set(selected.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a")));
  const bars = Array.from(new Set(selected.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a")));
  const sources = Array.from(new Set(selected.map((dataset) => text(dataset.source)).filter((value) => value !== "n/a")));
  const range = configDateRangePayload();
  const compareReady = selected.length >= 2;
  $("config-data-open-detail").disabled = !selected.length;
  $("config-data-compare-selected").disabled = !compareReady;
  $("config-data-actions-note").textContent = selected.length
    ? `${numberText(selected.length, 0)} selected / ${numberText(qualityIssues.length, 0)} quality issue${qualityIssues.length === 1 ? "" : "s"} / ${numberText(contractIssues.length, 0)} contract issue${contractIssues.length === 1 ? "" : "s"}`
    : "Select saved data to inspect or compare it.";
  const cards = [
    {
      status: selected.length ? "ok" : "bad",
      label: "Selected",
      title: numberText(selected.length, 0),
      note: symbols.length ? `${symbols.slice(0, 4).join(", ")}${symbols.length > 4 ? "..." : ""}` : "No saved files selected.",
    },
    {
      status: qualityIssues.length ? "warn" : selected.length ? "ok" : "bad",
      label: "Quality",
      title: qualityIssues.length ? `${numberText(qualityIssues.length, 0)} review` : selected.length ? "Clean" : "n/a",
      note: qualityIssues.length ? "Review warnings before generating a replay draft." : "No selected quality warnings reported.",
    },
    {
      status: contractIssues.length ? "warn" : selected.length ? "ok" : "bad",
      label: "Contract",
      title: contractIssues.length ? `${numberText(contractIssues.length, 0)} review` : selected.length ? "Clear" : "n/a",
      note: contractIssues.length ? "Review storage metadata before generating a replay draft." : "Selected files pass current storage-contract checks.",
    },
    {
      status: compareReady ? "ok" : selected.length ? "warn" : "bad",
      label: "Compare",
      title: compareReady ? "Ready" : "Need 2+",
      note: compareReady ? `${bars.join(", ") || "unknown bars"} from ${sources.join(", ") || "unknown sources"}.` : "Select at least two files to compare overlap.",
    },
    {
      status: range.start || range.end ? "ok" : selected.length ? "warn" : "bad",
      label: "Range",
      title: range.start || range.end ? "Set" : "All",
      note: range.start || range.end ? `${range.start || "start"} to ${range.end || "end"}` : "No Workbench date filter set.",
    },
  ];
  $("config-data-actions-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

async function openFirstConfigDatasetDetail() {
  const selected = selectedConfigDatasets();
  if (!selected.length) {
    $("config-data-actions-note").innerHTML = `<span class="status-bad">Select at least one saved dataset first</span>`;
    return;
  }
  await loadDataDetail(selected[0].path, { resetControls: true });
  navigateToDataLens("inspect");
  if ($("data-detail-form")) $("data-detail-form").scrollIntoView({ block: "start", behavior: "smooth" });
  $("last-refresh").textContent = `Opened ${text(selected[0].symbol)} from Workbench selected data`;
}

async function compareConfigDatasets() {
  const selected = selectedConfigDatasets().slice(0, MAX_DATA_COMPARE_DATASETS);
  if (selected.length < 2) {
    $("config-data-actions-note").innerHTML = `<span class="status-bad">Select at least two saved datasets to compare</span>`;
    return;
  }
  const range = configDateRangePayload();
  state.dataCompareSelectedPaths = selected.map((dataset) => dataset.path);
  state.dataCompareSelectionCleared = false;
  $("data-compare-filter").value = selected.length === 1 ? text(selected[0].symbol) : "";
  $("data-compare-start").value = range.start;
  $("data-compare-end").value = range.end;
  renderDataCompareControls();
  await loadDataCompare();
  navigateToDataLens("compare");
  if ($("data-compare-form")) $("data-compare-form").scrollIntoView({ block: "start", behavior: "smooth" });
  $("last-refresh").textContent = `Compared ${numberText(selected.length, 0)} Workbench selected dataset${selected.length === 1 ? "" : "s"}`;
}

async function inspectWorkbenchSelectedDataset(path) {
  if (!path) throw new Error("selected dataset path is missing");
  await loadDataDetail(path, { resetControls: true });
  navigateToDataLens("inspect");
  if ($("data-detail-form")) $("data-detail-form").scrollIntoView({ block: "start", behavior: "smooth" });
  $("last-refresh").textContent = "Opened Workbench selected dataset";
}

async function compareWorkbenchSelectedDataset(path) {
  const selected = selectedConfigDatasets();
  const paths = selected.map((dataset) => dataset.path);
  const comparePaths = paths.includes(path) ? paths : [path, ...paths];
  if (comparePaths.length < 2) {
    $("workbench-selected-data-note").innerHTML = `<span class="status-warn">Select at least two datasets before comparing selected data</span>`;
    return;
  }
  const range = configDateRangePayload();
  state.dataCompareSelectedPaths = comparePaths.slice(0, MAX_DATA_COMPARE_DATASETS);
  state.dataCompareSelectionCleared = false;
  $("data-compare-filter").value = "";
  $("data-compare-start").value = range.start;
  $("data-compare-end").value = range.end;
  renderDataCompareControls();
  await loadDataCompare();
  navigateToDataLens("compare");
  if ($("data-compare-form")) $("data-compare-form").scrollIntoView({ block: "start", behavior: "smooth" });
}

function removeWorkbenchSelectedDataset(path) {
  const select = $("config-dataset");
  if (!select || !path) return;
  for (const option of select.options) {
    if (option.value === path) option.selected = false;
  }
  state.configDraft = null;
  state.configDraftErrors = [];
  state.alignmentPreview = null;
  renderConfigLivePanels();
  $("workbench-selected-data-note").textContent = "Removed selected dataset; preview alignment again before generating.";
}

function handleWorkbenchSelectedDataAction(button) {
  const action = button.dataset.workbenchSelectedDataAction || "";
  const path = button.dataset.path || "";
  if (action === "library") {
    navigateToDataLens("browse");
    return;
  }
  if (action === "remove") {
    removeWorkbenchSelectedDataset(path);
    return;
  }
  if (action === "inspect") {
    inspectWorkbenchSelectedDataset(path).catch((err) => {
      $("workbench-selected-data-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
    return;
  }
  if (action === "compare") {
    compareWorkbenchSelectedDataset(path).catch((err) => {
      $("workbench-selected-data-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  }
}

function latestWorkbenchRunForDraft(draftId) {
  const runs = (state.configRuns && state.configRuns.runs) || [];
  return runs.find((run) => !draftId || run.draft_id === draftId) || null;
}

function configGuideStepMetadata() {
  const steps = (state.configOptions && state.configOptions.guide_steps) || [];
  return steps.slice().sort((left, right) => {
    const leftOrder = Number(left.order);
    const rightOrder = Number(right.order);
    const leftValue = Number.isFinite(leftOrder) ? leftOrder : 999;
    const rightValue = Number.isFinite(rightOrder) ? rightOrder : 999;
    return leftValue - rightValue || text(left.id).localeCompare(text(right.id));
  });
}

function workbenchGuideAction(step) {
  const id = String((step && step.id) || "");
  const actions = {
    data: { label: "Select Data", target: "config-dataset" },
    quality: { label: "Review Data", target: "config-data-quality-body" },
    range: { label: "Set Range", target: "config-start-date" },
    alignment: { label: "Preview Alignment", target: "config-alignment", click: "config-preview-alignment" },
    draft: { label: "Review Builder", target: "config-form" },
    run: { label: "Run Draft", target: "config-run-form" },
    results: { label: "Open Results", target: "config-runs-body" },
  };
  return actions[id] || { label: "Open Step", target: "config-form" };
}

function renderWorkbenchGuide() {
  if (!$("workbench-guide") || !$("workbench-guide-note")) return;
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const savedDraftId = draft.name || ($("config-run-draft") && $("config-run-draft").value) || "";
  const validation = savedDraftId ? draftValidationById()[savedDraftId] : null;
  const latestRun = latestWorkbenchRunForDraft(savedDraftId);
  const artifacts = state.configArtifacts || {};
  const alignmentWarnings = Number(alignment.warning_count || 0);
  const draftValid = draft.validation ? Boolean(draft.validation.valid) : Boolean(validation && validation.valid);
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id);
  const dateRange = configDateRangePayload();
  const hasDateRange = Boolean(dateRange.start || dateRange.end);
  const stepState = [
    {
      id: "data",
      status: selected.length ? "ok" : "bad",
      fallbackLabel: "Choose Data",
      detail: selected.length
        ? `${selected.length} selected: ${selected.map((item) => item.symbol).join(", ")}`
        : "Select one or more scanned datasets in the Config Builder.",
    },
    {
      id: "quality",
      status: dataReadiness.status,
      fallbackLabel: "Review Data",
      detail: !selected.length
        ? "No selected files to check yet."
        : dataReadiness.issueCount
          ? `${dataReadiness.summary} issue counts; inspect quality and metadata before draft generation.`
          : dataReadiness.cleanNote,
    },
    {
      id: "range",
      status: !selected.length ? "bad" : hasDateRange ? "ok" : "warn",
      fallbackLabel: "Choose Range",
      detail: !selected.length
        ? "Select data before narrowing the replay window."
        : hasDateRange
          ? `Replay window: ${dateRange.start || "first bar"} to ${dateRange.end || "last bar"}.`
          : "Optional; unset uses each file's full history.",
    },
    {
      id: "alignment",
      status: alignment.dataset_count ? (alignmentWarnings ? "warn" : "ok") : "bad",
      fallbackLabel: "Inspect Alignment",
      detail: alignment.dataset_count
        ? `${numberText(alignment.common_timestamp_count, 0)} common timestamps${alignmentWarnings ? `; ${alignmentWarnings} warning${alignmentWarnings === 1 ? "" : "s"}` : ""}.`
        : "Click Preview Alignment or Generate to verify timestamp overlap.",
    },
    {
      id: "draft",
      status: draft.yaml ? (draftValid ? "ok" : "warn") : "bad",
      fallbackLabel: "Generate Draft",
      detail: draft.yaml
        ? `${text(draft.name || savedDraftId)} ${draftValid ? "is valid" : "needs validation review"}.`
        : "Choose plugin, mode, and risk limits, then generate a draft.",
    },
    {
      id: "run",
      status: latestRun ? (latestRun.status === "completed" ? "ok" : "warn") : "bad",
      fallbackLabel: "Run Simulation",
      detail: latestRun
        ? `${text(latestRun.action)} ${text(latestRun.status)} at ${text(latestRun.finished_at || latestRun.started_at)}.`
        : "Save the draft, then run validate, replay, or simulated paper.",
    },
    {
      id: "results",
      status: hasArtifacts ? "ok" : "bad",
      fallbackLabel: "Inspect Results",
      detail: hasArtifacts
        ? `${text(artifacts.draft_id)} artifacts loaded; Performance and Runs now have charts/detail.`
        : "Open artifacts from a completed run to inspect equity, orders, fills, and logs.",
    },
  ];
  const stateById = Object.fromEntries(stepState.map((step) => [step.id, step]));
  const metadata = configGuideStepMetadata();
  const schemaIds = new Set(metadata.map((step) => step.id));
  const steps = [
    ...(metadata.length ? metadata : stepState).map((step) => {
      const current = stateById[step.id] || step;
      return {
        id: step.id,
        status: current.status || "bad",
        label: step.label || current.fallbackLabel || current.label || step.id,
        detail: current.detail || step.help || "",
      };
    }),
    ...stepState
      .filter((step) => metadata.length && !schemaIds.has(step.id))
      .map((step) => ({
        id: step.id,
        status: step.status,
        label: step.fallbackLabel,
        detail: step.detail,
      })),
  ];
  const complete = steps.filter((step) => step.status === "ok").length;
  $("workbench-guide-note").textContent = `${complete} of ${steps.length} steps ready`;
  renderWorkbenchStepper(steps);
  $("workbench-guide").innerHTML = steps.map((step) => {
    const action = workbenchGuideAction(step);
    return `
      <div class="check-item status-${escapeHtml(step.status)}">
        <span>${escapeHtml(step.status)}</span>
        <div>
          <strong>${escapeHtml(step.label)}</strong>
          <small>${escapeHtml(step.detail)}</small>
          <div class="guide-step-actions">
            <button
              type="button"
              class="secondary workbench-guide-action"
              data-guide-target="${escapeHtml(action.target)}"
              data-guide-click="${escapeHtml(action.click || "")}"
            >${escapeHtml(action.label)}</button>
          </div>
        </div>
      </div>
    `;
  }).join("");
}

function renderWorkbenchStepper(steps = []) {
  if (!$("workbench-stepper")) return;
  $("workbench-stepper").innerHTML = steps.length
    ? steps.map((step, index) => {
        const action = workbenchGuideAction(step);
        return `
          <button
            type="button"
            class="workbench-stepper-step workbench-guide-action status-${escapeHtml(step.status)}"
            data-guide-target="${escapeHtml(action.target)}"
            data-guide-click="${escapeHtml(action.click || "")}"
          >
            <span>${escapeHtml(numberText(index + 1, 0))} / ${statusText(step.status)}</span>
            <strong>${escapeHtml(step.label)}</strong>
            <small>${escapeHtml(step.detail)}</small>
          </button>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No workflow metadata</strong><span>Refresh config options to load the Workbench guide schema.</span></div>`;
}

function workbenchHomeState() {
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const savedDraft = selectedRunDraft();
  const savedDraftId = savedDraft ? savedDraft.draft_id : draft.name || ($("config-run-draft") && $("config-run-draft").value) || "";
  const validation = savedDraftId ? draftValidationById()[savedDraftId] : null;
  const generatedValid = draft.validation ? Boolean(draft.validation.valid) : false;
  const draftReady = Boolean(draft.yaml && generatedValid) || Boolean(savedDraft && validation && validation.valid);
  const latestRun = latestWorkbenchRunForDraft(savedDraftId);
  const artifacts = state.configArtifacts || {};
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id);
  const hasDateRange = Boolean(configDateRangePayload().start || configDateRangePayload().end);
  let result = "Select Saved Data";
  let note = "Choose one or more Data Library files before building a replay or simulated-paper draft.";
  let nextAction = "data";
  if (selected.length && dataReadiness.issueCount) {
    result = "Review Data Readiness";
    note = dataReadiness.reviewNote;
    nextAction = "quality";
  } else if (selected.length && !alignment.dataset_count) {
    result = "Preview Alignment";
    note = "Check timestamp overlap before generating a runnable config.";
    nextAction = "alignment";
  } else if (alignment.dataset_count && Number(alignment.common_timestamp_count || 0) <= 0) {
    result = "Fix Alignment";
    note = "Selected files do not share usable timestamps in the current window.";
    nextAction = "alignment";
  } else if (alignment.dataset_count && !draft.yaml && !savedDraft) {
    result = "Generate Draft";
    note = "Data and alignment are ready enough to review plugin, mode, risk, and generated YAML.";
    nextAction = "generate";
  } else if (!draftReady) {
    result = "Validate Draft";
    note = savedDraft ? `${savedDraft.draft_id} needs validation before a trustworthy run.` : "Generated draft needs validation review.";
    nextAction = "run";
  } else if (!latestRun) {
    result = "Run Simulation";
    note = `${savedDraftId || "The draft"} is ready for replay or simulated paper.`;
    nextAction = "run";
  } else if (latestRun.status !== "completed") {
    result = "Inspect Run";
    note = `${text(latestRun.action)} ended with ${text(latestRun.status)}; review run output before comparing performance.`;
    nextAction = "run";
  } else if (!hasArtifacts) {
    result = "Open Results";
    note = "Completed run exists; load artifacts to inspect Performance and Runs.";
    nextAction = "results";
  } else {
    result = "Review Performance";
    note = `${text(artifacts.draft_id)} artifacts are loaded; inspect charts, orders, fills, and logs.`;
    nextAction = "results";
  }
  const tiles = [
    {
      status: dataReadiness.status,
      label: "Data",
      title: selected.length ? `${numberText(selected.length, 0)} selected` : "None",
      note: selected.length ? `${selected.map((item) => text(item.symbol)).slice(0, 5).join(", ")}; ${dataReadiness.summary}.` : "Select datasets.",
    },
    {
      status: alignment.dataset_count ? Number(alignment.common_timestamp_count || 0) > 0 ? Number(alignment.warning_count || 0) ? "warn" : "ok" : "bad" : selected.length ? "warn" : "bad",
      label: "Alignment",
      title: alignment.dataset_count ? numberText(alignment.common_timestamp_count, 0) : "Preview",
      note: alignment.dataset_count ? `${pctText(alignment.common_coverage_pct)} common coverage.` : "Not previewed.",
    },
    {
      status: hasDateRange ? "ok" : selected.length ? "warn" : "bad",
      label: "Window",
      title: hasDateRange ? "Bounded" : "Full History",
      note: hasDateRange ? timeRangeLabel(configDateRangePayload().start, configDateRangePayload().end) : "No date range set.",
    },
    {
      status: draftReady ? "ok" : draft.yaml || savedDraft ? "warn" : "bad",
      label: "Draft",
      title: savedDraftId ? text(savedDraftId) : draft.yaml ? "Generated" : "Missing",
      note: draftReady ? "Valid." : draft.yaml || savedDraft ? "Needs validation." : "Generate a draft.",
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : draftReady ? "warn" : "bad",
      label: "Run",
      title: latestRun ? text(latestRun.status) : "Not Run",
      note: latestRun ? `${text(latestRun.action)} ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.` : "Run after validation.",
    },
    {
      status: hasArtifacts ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "bad",
      label: "Results",
      title: hasArtifacts ? "Loaded" : latestRun && latestRun.artifact_path ? "Available" : "Missing",
      note: hasArtifacts ? "Performance/Runs can inspect artifacts." : "No loaded artifact yet.",
    },
  ];
  return { result, note, nextAction, tiles };
}

function renderWorkbenchHome() {
  if (!$("workbench-home-result") || !$("workbench-home-note") || !$("workbench-home-tiles")) return;
  const stateModel = workbenchHomeState();
  $("workbench-home-result").textContent = stateModel.result;
  $("workbench-home-note").textContent = stateModel.note;
  for (const button of document.querySelectorAll("[data-workbench-home-action]")) {
    if (!(button instanceof HTMLButtonElement)) continue;
    const active = button.dataset.workbenchHomeAction === stateModel.nextAction;
    button.classList.toggle("secondary", !active);
  }
  $("workbench-home-tiles").innerHTML = stateModel.tiles.map((tile) => `
    <div class="action-card status-${escapeHtml(tile.status)}">
      <span>${escapeHtml(tile.label)}</span>
      <strong>${escapeHtml(tile.title)}</strong>
      <small>${escapeHtml(tile.note)}</small>
    </div>
  `).join("");
  renderWorkbenchWorkflowLauncher();
}

function workbenchWorkflowCards() {
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const savedDraft = selectedRunDraft();
  const savedDraftId = savedDraft ? savedDraft.draft_id : draft.name || ($("config-run-draft") && $("config-run-draft").value) || "";
  const validation = savedDraftId ? draftValidationById()[savedDraftId] : null;
  const draftValid = draft.validation ? Boolean(draft.validation.valid) : Boolean(validation && validation.valid);
  const latestRun = latestWorkbenchRunForDraft(savedDraftId);
  const artifacts = state.configArtifacts || {};
  const plugin = selectedConfigPlugin();
  const range = configDateRangePayload();
  const hasRange = Boolean(range.start || range.end);
  const hasAlignment = Boolean(alignment.dataset_count);
  const commonTimestamps = Number(alignment.common_timestamp_count || 0);
  const alignmentWarnings = Number(alignment.warning_count || 0);
  const hasDraft = Boolean(draft.yaml || savedDraft);
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id);

  return [
    {
      label: "Select Data",
      title: selected.length ? `${numberText(selected.length, 0)} selected` : "No Data",
      value: selected.length ? selected.map((item) => text(item.symbol)).slice(0, 3).join(", ") : "choose files",
      status: dataReadiness.status,
      detail: selected.length
        ? dataReadiness.issueCount ? dataReadiness.reviewNote : dataReadiness.cleanNote
        : "Choose scanned files from Data Library or the Config Builder dataset field.",
      href: workflowHref("workbench", "builder"),
      cta: "Choose Data",
    },
    {
      label: "Preview Alignment",
      title: hasAlignment ? `${numberText(commonTimestamps, 0)} common` : "Not Previewed",
      value: hasRange ? `${range.start || "first"} to ${range.end || "last"}` : "full range",
      status: hasAlignment ? commonTimestamps > 0 ? alignmentWarnings ? "warn" : "ok" : "bad" : selected.length ? "warn" : "bad",
      detail: hasAlignment
        ? `${pctText(alignment.common_coverage_pct)} common coverage; ${numberText(alignmentWarnings, 0)} warning${alignmentWarnings === 1 ? "" : "s"}.`
        : "Preview timestamp overlap before trusting a replay or simulated-paper draft.",
      href: workflowHref("workbench", "builder"),
      cta: "Preview",
    },
    {
      label: "Build Draft",
      title: hasDraft ? savedDraftId || "Generated" : "No Draft",
      value: plugin.label || plugin.id || "plugin",
      status: hasDraft ? draftValid ? "ok" : "warn" : hasAlignment && commonTimestamps > 0 ? "warn" : "bad",
      detail: hasDraft
        ? draftValid ? "Draft validation is clean enough to run." : "Draft exists but needs validation review."
        : "Review plugin, mode, risk limits, costs, and output before saving generated YAML.",
      href: workflowHref("workbench", "builder"),
      cta: "Build",
    },
    {
      label: "Run Draft",
      title: latestRun ? text(latestRun.status) : "Not Run",
      value: latestRun ? text(latestRun.action) : "validate/replay",
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : draftValid ? "warn" : "bad",
      detail: latestRun
        ? `${text(latestRun.draft_id || savedDraftId)} ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.`
        : draftValid ? "Run validate, replay, or simulated paper from the saved draft." : "Generate and validate a draft before running.",
      href: workflowHref("workbench", "run"),
      cta: "Run",
    },
    {
      label: "Open Results",
      title: hasArtifacts ? "Loaded" : latestRun && latestRun.artifact_path ? "Available" : "No Artifacts",
      value: hasArtifacts ? text(artifacts.run_id || artifacts.draft_id) : latestRun && latestRun.artifact_path ? "loadable" : "missing",
      status: hasArtifacts ? "ok" : latestRun && latestRun.artifact_path ? "warn" : latestRun ? "bad" : "bad",
      detail: hasArtifacts
        ? "Performance and Runs can inspect this run's charts, orders, fills, decisions, and logs."
        : latestRun && latestRun.artifact_path
          ? "Artifacts exist; load them before comparing performance."
          : "Completed run artifacts appear after a draft run finishes.",
      href: workflowHref(hasArtifacts ? "performance" : "workbench", hasArtifacts ? "home" : "artifacts"),
      cta: hasArtifacts ? "Performance" : "Artifacts",
    },
    {
      label: "Review Boundary",
      title: plugin.visibility || plugin.status || "Unknown",
      value: plugin.status || "plugin",
      status: plugin.visibility === "public_example" || plugin.status === "example_only" ? "warn" : plugin.id ? "ok" : "bad",
      detail: plugin.id
        ? text(plugin.boundary || "Public examples are illustrative; private strategies belong in ignored local configs.")
        : "Choose a configured Workbench plugin before generating a draft.",
      href: workflowHref("workbench", "builder"),
      cta: "Review",
    },
  ];
}

function renderWorkbenchWorkflowLauncher() {
  const container = $("workbench-workflows");
  if (!container) return;
  const cards = workbenchWorkflowCards();
  container.innerHTML = cards.map((card) => `
    <a class="action-card workflow-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <div class="workflow-card-foot">
        <em>${escapeHtml(card.value)}</em>
        <b>${escapeHtml(card.cta)}</b>
      </div>
    </a>
  `).join("");
}

function handleWorkbenchHomeAction(action) {
  const targets = {
    data: "config-dataset",
    quality: "config-data-quality-body",
    alignment: "config-alignment",
    generate: "config-form",
    run: "config-run-form",
    results: "config-runs-body",
  };
  const lenses = {
    data: "builder",
    quality: "builder",
    alignment: "builder",
    generate: "builder",
    run: "run",
    results: "artifacts",
  };
  if (action === "alignment" && $("config-preview-alignment") instanceof HTMLButtonElement && !$("config-preview-alignment").disabled) {
    applyWorkbenchLens("builder");
    $("config-preview-alignment").click();
    return;
  }
  if (action === "results" && (state.configArtifacts || {}).run_id) {
    navigateToView("performance");
    return;
  }
  applyWorkbenchLens(lenses[action] || "builder");
  const element = $(targets[action] || "config-form");
  if (element) {
    element.scrollIntoView({ block: "start", behavior: "smooth" });
    if (typeof element.focus === "function") element.focus({ preventScroll: true });
  }
}

function activateWorkbenchGuideAction(target) {
  const targetId = String(target.dataset.guideTarget || "");
  const clickId = String(target.dataset.guideClick || "");
  const lens = targetId.includes("config-run") || targetId.includes("config-runs") ? "run" : "builder";
  applyWorkbenchLens(lens);
  const clickElement = clickId ? $(clickId) : null;
  if (clickElement instanceof HTMLButtonElement && !clickElement.disabled) {
    clickElement.click();
    return;
  }
  const element = targetId ? $(targetId) : null;
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  if (typeof element.focus === "function") {
    element.focus({ preventScroll: true });
  }
}

function selectedConfigPlugin() {
  const pluginId = $("config-plugin") ? $("config-plugin").value : "";
  return ((state.configOptions && state.configOptions.plugins) || []).find((plugin) => plugin.id === pluginId) || {};
}

function pluginBoundaryStatus(plugin) {
  if (!plugin || !plugin.id) return "bad";
  const visibility = text(plugin.visibility || plugin.status).toLowerCase();
  return visibility === "public_example" || visibility === "example_only" ? "warn" : "ok";
}

function pluginVisibilityBucket(plugin) {
  const visibility = text((plugin || {}).visibility || (plugin || {}).status).toLowerCase();
  if (visibility === "public_example" || visibility === "example_only") return "public";
  if (visibility === "private_local" || visibility.includes("private") || visibility.includes("local")) return "private";
  return "other";
}

function pluginRegistryPathSummary(paths) {
  const visible = (paths || []).map((path) => text(path)).filter((path) => path !== "n/a");
  const localCount = visible.filter((path) => /(^|\/)plugin_registry_local\.ya?ml$|(^|\/)local/i.test(path)).length;
  return {
    count: visible.length,
    localCount,
    label: visible.length ? visible.slice(0, 2).join("; ") : "none configured",
  };
}

function renderWorkbenchPluginBoundary() {
  if (!$("workbench-plugin-boundary-title") || !$("workbench-plugin-boundary-cards") || !$("workbench-plugin-boundary-actions")) return;
  const options = state.configOptions || {};
  const plugins = options.plugins || [];
  const selected = selectedConfigPlugin();
  const selectedStatus = pluginBoundaryStatus(selected);
  const selectedBucket = pluginVisibilityBucket(selected);
  const publicCount = plugins.filter((plugin) => pluginVisibilityBucket(plugin) === "public").length;
  const privateCount = plugins.filter((plugin) => pluginVisibilityBucket(plugin) === "private").length;
  const otherCount = Math.max(0, plugins.length - publicCount - privateCount);
  const strategyFields = (selected.strategy_fields || []).filter((field) => field && field.name);
  const resultFields = (selected.result_fields || []).filter((field) => field && field.name);
  const registry = pluginRegistryPathSummary(options.plugin_registry_paths || []);
  const selectedTitle = selected.id
    ? text(selected.label || selected.id)
    : "Choose A Plugin";
  const title = selected.id
    ? selectedBucket === "public"
      ? "Example Plugin Selected"
      : selectedBucket === "private"
        ? "Local Plugin Selected"
        : "Plugin Selected"
    : "No Plugin Selected";
  const note = selected.id
    ? selectedBucket === "public"
      ? "This public example demonstrates the framework only; do not treat it as a viable strategy."
      : text(selected.boundary || "Local private plugin metadata is loaded from ignored registry files.")
    : "Choose a public example or ignored local plugin before generating a draft.";
  $("workbench-plugin-boundary-title").textContent = title;
  $("workbench-plugin-boundary-note").textContent = note;
  const cards = [
    {
      status: selectedStatus,
      label: "Selected",
      title: selectedTitle,
      note: selected.id ? `${text(selected.visibility || selected.status)} - ${text(selected.spec)}` : "No selected plugin metadata.",
    },
    {
      status: publicCount ? "warn" : "bad",
      label: "Public Examples",
      title: numberText(publicCount, 0),
      note: otherCount
        ? `${numberText(otherCount, 0)} uncategorized plugin${otherCount === 1 ? "" : "s"} also loaded.`
        : "Generic examples should document wiring, not real strategy edge.",
    },
    {
      status: privateCount ? "ok" : "warn",
      label: "Local Private",
      title: numberText(privateCount, 0),
      note: privateCount
        ? "Ignored local registry entries can point at private strategy implementations."
        : "No private/local plugin metadata is loaded in this dashboard session.",
    },
    {
      status: registry.count ? registry.localCount ? "ok" : "warn" : "bad",
      label: "Registry Paths",
      title: numberText(registry.count, 0),
      note: registry.count ? registry.label : "No plugin registry paths reported by config_options.",
    },
    {
      status: strategyFields.length || resultFields.length ? "ok" : selected.id ? "warn" : "bad",
      label: "Exposed Fields",
      title: `${numberText(strategyFields.length, 0)} in / ${numberText(resultFields.length, 0)} out`,
      note: selected.id
        ? "Only declared public-safe fields appear in forms and artifact summaries."
        : "Select a plugin to see declared public-safe fields.",
    },
    {
      status: options.config_schema_version && options.form_schema_version ? "ok" : "warn",
      label: "Schema",
      title: `v${text(options.config_schema_version)} / form v${text(options.form_schema_version)}`,
      note: `Guide v${text(options.guide_schema_version)}; ${numberText((options.form_schema || []).length, 0)} rendered fields.`,
    },
  ];
  $("workbench-plugin-boundary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const actions = [
    {
      action: "select-plugin",
      title: "Choose Plugin",
      note: "Jump to the plugin field in the generated builder form.",
      label: "Select",
      disabled: false,
    },
    {
      action: "boundary-detail",
      title: "Open Boundary Detail",
      note: "Review selected plugin visibility, registry paths, and description.",
      label: "Detail",
      disabled: !selected.id,
    },
    {
      action: "field-help",
      title: "Review Public Fields",
      note: "Inspect public-safe inputs, outputs, result sections, and widgets.",
      label: "Fields",
      disabled: !selected.id,
    },
    {
      action: "help-boundary",
      title: "Open Boundary Guide",
      note: "Read the Help view notes on public examples versus private local config.",
      label: "Help",
      disabled: false,
    },
  ];
  $("workbench-plugin-boundary-actions").innerHTML = actions.map((action) => `
    <button type="button" class="workbench-plugin-boundary-action ${action.disabled ? "secondary" : ""}" data-workbench-plugin-boundary-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.note)}</small>
      </span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

function handleWorkbenchPluginBoundaryAction(action) {
  if (action === "help-boundary") {
    navigateToHelpLens("boundary");
    return;
  }
  const targets = {
    "select-plugin": "config-plugin",
    "boundary-detail": "config-plugin-boundary",
    "field-help": "config-plugin-field-help",
  };
  const element = $(targets[action] || "");
  if (!element) return;
  element.scrollIntoView({ block: "center", behavior: "smooth" });
  if (typeof element.focus === "function") element.focus({ preventScroll: true });
}

function renderConfigPluginBoundary() {
  if (!$("config-plugin-boundary") || !$("config-plugin-boundary-note")) return;
  const plugin = selectedConfigPlugin();
  const visibility = plugin.visibility || plugin.status || "unknown";
  $("config-plugin-boundary-note").innerHTML = visibility === "public_example"
    ? `<span class="status-warn">example only</span>`
    : statusText(visibility);
  const pairs = [
    ["Selected Plugin", text(plugin.label || plugin.id)],
    ["Config Schema", `v${text((state.configOptions || {}).config_schema_version)} / form v${text((state.configOptions || {}).form_schema_version)}`],
    ["Visibility", text(visibility)],
    ["Status", text(plugin.status)],
    ["Spec", text(plugin.spec)],
    ["Registry Paths", ((state.configOptions || {}).plugin_registry_paths || []).join("; ") || "none"],
    ["Description", text(plugin.description)],
    ["Boundary", text(plugin.boundary || "Keep private strategy specs in ignored local configs.")],
  ];
  $("config-plugin-boundary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
}

function pluginFieldMetaLine(field) {
  const parts = [
    field.kind ? `kind ${text(field.kind)}` : "",
    field.required ? "required" : "",
    field.advanced ? "advanced" : "",
    field.default !== undefined ? `default ${text(field.default)}` : "",
    field.min !== undefined || field.max !== undefined ? `bounds ${text(field.min ?? "n/a")}..${text(field.max ?? "n/a")}` : "",
    field.step !== undefined ? `step ${text(field.step)}` : "",
    field.unit ? `unit ${text(field.unit)}` : "",
    field.prefix ? `prefix ${text(field.prefix)}` : "",
    field.suffix ? `suffix ${text(field.suffix)}` : "",
    field.decimals !== undefined ? `decimals ${text(field.decimals)}` : "",
  ].filter(Boolean);
  const options = (field.options || [])
    .map((option) => text(option.label || option.value))
    .filter((value) => value !== "n/a")
    .slice(0, 6);
  if (options.length) parts.push(`options ${options.join(", ")}`);
  return parts.length ? parts.join("; ") : "No extra display metadata declared.";
}

function renderPluginFieldHelpCard(field, groupLabel) {
  const title = text(field.label || field.name);
  const help = text(field.help || field.description || field.placeholder || "No public-safe help text declared.");
  const status = field.required ? "warn" : field.advanced ? "waiting" : "ok";
  return `
    <article class="plugin-field-help-card status-${escapeHtml(status)}">
      <span>${escapeHtml(groupLabel)}</span>
      <strong>${escapeHtml(title)}</strong>
      <small class="mono">${escapeHtml(field.name ? `${groupLabel === "Input" ? "strategy" : "result"}.${field.name}` : groupLabel)}</small>
      <p>${escapeHtml(help)}</p>
      <small>${escapeHtml(pluginFieldMetaLine(field))}</small>
    </article>
  `;
}

function renderPluginResultSectionHelpCard(section, resultFields) {
  const resultByName = new Map((resultFields || []).map((field) => [text(field.name), field]));
  const fields = (section.fields || [])
    .map((name) => resultByName.get(text(name)) || { name, label: name })
    .filter((field) => field && field.name);
  const fieldLabels = fields.length
    ? fields.map((field) => text(field.label || field.name)).join(", ")
    : "No result fields declared.";
  const fieldPaths = fields.length
    ? fields.map((field) => `result.${text(field.name)}`).join(", ")
    : "n/a";
  const help = text(section.description || section.help || "Public-safe grouping for declared result fields.");
  const status = fields.length ? "ok" : "warn";
  return `
    <article class="plugin-field-help-card status-${escapeHtml(status)}">
      <span>Result Section</span>
      <strong>${escapeHtml(text(section.label || section.id))}</strong>
      <small class="mono">${escapeHtml(fieldPaths)}</small>
      <p>${escapeHtml(help)}</p>
      <small>${escapeHtml(`${numberText(fields.length, 0)} grouped field${fields.length === 1 ? "" : "s"}: ${fieldLabels}`)}</small>
    </article>
  `;
}

function renderPluginResultWidgetHelpCard(widget, resultFields) {
  const resultByName = new Map((resultFields || []).map((field) => [text(field.name), field]));
  const fields = (widget.fields || [])
    .map((name) => resultByName.get(text(name)) || { name, label: name })
    .filter((field) => field && field.name);
  const fieldLabels = fields.length
    ? fields.map((field) => text(field.label || field.name)).join(", ")
    : "No result fields declared.";
  const fieldPaths = fields.length
    ? fields.map((field) => `result.${text(field.name)}`).join(", ")
    : "n/a";
  const help = text(widget.description || widget.help || "Public-safe artifact display widget.");
  const status = fields.length ? "ok" : "warn";
  return `
    <article class="plugin-field-help-card status-${escapeHtml(status)}">
      <span>Result Widget ${escapeHtml(text(widget.kind || "cards"))}</span>
      <strong>${escapeHtml(text(widget.label || widget.id))}</strong>
      <small class="mono">${escapeHtml(fieldPaths)}</small>
      <p>${escapeHtml(help)}</p>
      <small>${escapeHtml(`${numberText(fields.length, 0)} displayed field${fields.length === 1 ? "" : "s"}: ${fieldLabels}`)}</small>
    </article>
  `;
}

function renderConfigPluginFieldHelp() {
  if (!$("config-plugin-field-help") || !$("config-plugin-field-help-note")) return;
  const plugin = selectedConfigPlugin();
  const strategyFields = (plugin.strategy_fields || []).filter((field) => field && field.name);
  const resultFields = (plugin.result_fields || []).filter((field) => field && field.name);
  const resultSections = (plugin.result_sections || []).filter((section) => section && section.id);
  const resultWidgets = (plugin.result_widgets || []).filter((widget) => widget && widget.id);
  $("config-plugin-field-help-note").textContent = plugin.id
    ? `${numberText(strategyFields.length, 0)} input field${strategyFields.length === 1 ? "" : "s"} / ${numberText(resultFields.length, 0)} result field${resultFields.length === 1 ? "" : "s"} / ${numberText(resultSections.length, 0)} result section${resultSections.length === 1 ? "" : "s"} / ${numberText(resultWidgets.length, 0)} result widget${resultWidgets.length === 1 ? "" : "s"} for ${text(plugin.label || plugin.id)}`
    : "Choose a plugin to see public-safe field help.";
  const cards = [
    ...strategyFields.map((field) => renderPluginFieldHelpCard(field, "Input")),
    ...resultFields.map((field) => renderPluginFieldHelpCard(field, "Result")),
    ...resultSections.map((section) => renderPluginResultSectionHelpCard(section, resultFields)),
    ...resultWidgets.map((widget) => renderPluginResultWidgetHelpCard(widget, resultFields)),
  ];
  $("config-plugin-field-help").innerHTML = cards.length
    ? cards.join("")
    : `<div class="empty-card"><strong>No plugin field metadata</strong><span>Declare public-safe strategy_fields, result_fields, result_sections, and result_widgets in the plugin registry to explain configuration inputs and artifact diagnostics.</span></div>`;
}

function renderConfigBrokerBoundary() {
  if (!$("config-broker-boundary") || !$("config-broker-boundary-note")) return;
  const adapters = (state.configOptions && state.configOptions.broker_adapters) || [];
  const paperReady = adapters.filter((adapter) => (adapter.account_modes || []).includes("paper")).length;
  const executable = adapters.filter((adapter) => adapter.execution_supported !== false).length;
  $("config-broker-boundary-note").textContent = adapters.length
    ? `${numberText(adapters.length, 0)} adapters / ${numberText(executable, 0)} executable / ${numberText(paperReady, 0)} paper-capable`
    : "No broker adapter metadata loaded";
  $("config-broker-boundary").innerHTML = adapters.length
    ? adapters.map((adapter) => {
        const requirements = [
          adapter.requires_gateway ? "Gateway/API required" : "No Gateway required",
          adapter.requires_static_prices ? "static prices required" : "live/account prices",
          adapter.persists_local_state ? "local state file" : "broker/account state",
        ].join(" / ");
        const executableNote = adapter.execution_supported === false
          ? `Unavailable: ${text(adapter.unsupported_reason || "execution is not implemented")}`
          : "Execution adapter available";
        return `
          <div class="broker-capability-card">
            <span>${statusText(adapter.status)}</span>
            <strong>${escapeHtml(text(adapter.label || adapter.id))}</strong>
            <small>${escapeHtml(text(adapter.description))}</small>
            <small>${escapeHtml(executableNote)}</small>
            <small>Modes: ${escapeHtml((adapter.account_modes || []).join(", ") || "none")}</small>
            <small>Orders: ${escapeHtml((adapter.order_types || []).join(", ") || "none")} / sizing ${escapeHtml((adapter.order_sizing || []).join(", ") || "none")}</small>
            <small>${escapeHtml(requirements)}</small>
            <small>${escapeHtml(text(adapter.boundary))}</small>
          </div>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No adapter metadata</strong><span>Refresh config options or check the dashboard server logs.</span></div>`;
}

function selectedCompareDatasets() {
  const selectedPaths = state.dataCompareSelectedPaths.length
    ? state.dataCompareSelectedPaths
    : Array.from($("data-compare-datasets").selectedOptions).map((option) => option.value);
  return (state.dataCatalog.datasets || []).filter((item) => selectedPaths.includes(item.path));
}

function updateCompareSelectionFromSelect(announce = false) {
  const select = $("data-compare-datasets");
  const previousSelection = state.dataCompareSelectedPaths.join("\u0000");
  const selected = Array.from(select.selectedOptions).map((option) => option.value);
  const capped = selected.slice(0, MAX_DATA_COMPARE_DATASETS);
  state.dataCompareSelectedPaths = capped;
  if (announce || select.options.length) {
    state.dataCompareSelectionCleared = capped.length === 0;
  }
  for (const option of select.options) {
    option.selected = capped.includes(option.value);
  }
  if (announce && selected.length > MAX_DATA_COMPARE_DATASETS) {
    $("last-refresh").textContent = `Compare selection capped at ${MAX_DATA_COMPARE_DATASETS} datasets`;
  }
  if (announce && previousSelection !== capped.join("\u0000") && state.dataCompare && state.dataCompare.generated_at) {
    state.dataCompare = {};
    renderDataCompare();
  }
}

function selectedCompareRangeBounds() {
  const selected = selectedCompareDatasets();
  const starts = selected.map((dataset) => timestampMillis(dataset.first_timestamp)).filter((value) => value !== null);
  const ends = selected.map((dataset) => timestampMillis(dataset.last_timestamp)).filter((value) => value !== null);
  if (!starts.length || !ends.length) {
    return { selected, unionStart: null, unionEnd: null, overlapStart: null, overlapEnd: null };
  }
  return {
    selected,
    unionStart: Math.min(...starts),
    unionEnd: Math.max(...ends),
    overlapStart: Math.max(...starts),
    overlapEnd: Math.min(...ends),
  };
}

async function applyDataCompareRangePreset() {
  const preset = $("data-compare-range-preset").value || "custom";
  if (preset === "custom") return;
  const bounds = selectedCompareRangeBounds();
  if (bounds.selected.length < 2) {
    $("data-compare-note").innerHTML = `<span class="status-bad">Select at least two datasets before applying a compare range preset</span>`;
    $("data-compare-range-preset").value = "custom";
    return;
  }
  if (bounds.unionStart === null || bounds.unionEnd === null || bounds.overlapStart === null || bounds.overlapEnd === null) {
    $("data-compare-note").innerHTML = `<span class="status-bad">Selected datasets do not expose enough timestamp metadata for range presets</span>`;
    $("data-compare-range-preset").value = "custom";
    return;
  }
  if (preset === "full") {
    $("data-compare-start").value = "";
    $("data-compare-end").value = "";
  } else {
    if (bounds.overlapStart > bounds.overlapEnd) {
      $("data-compare-note").innerHTML = `<span class="status-bad">Selected datasets have no common timestamp overlap</span>`;
      $("data-compare-range-preset").value = "custom";
      return;
    }
    let startMillis = bounds.overlapStart;
    const endMillis = bounds.overlapEnd;
    if (preset !== "overlap") {
      const days = Number(preset.replace("d", ""));
      if (!Number.isFinite(days) || days <= 0) {
        $("data-compare-range-preset").value = "custom";
        return;
      }
      const oneDay = 24 * 60 * 60 * 1000;
      startMillis = Math.max(bounds.overlapStart, endMillis - Math.max(0, days - 1) * oneDay);
    }
    $("data-compare-start").value = new Date(startMillis).toISOString().slice(0, 10);
    $("data-compare-end").value = new Date(endMillis).toISOString().slice(0, 10);
  }
  await loadDataCompare();
  $("last-refresh").textContent = `Compare range preset applied: ${preset}`;
}

function latestAccountRow(accountRows) {
  const rows = accountRows || [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const rowItem = rows[index] || {};
    if (rowItem.positions || rowItem.equity !== undefined || rowItem.cash !== undefined) {
      return rowItem;
    }
  }
  return {};
}

function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function timestampMillis(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

function timestampAgeLabel(value) {
  const millis = timestampMillis(value);
  if (millis === null) return "not published";
  const ageSeconds = Math.max(0, (Date.now() - millis) / 1000);
  return `${text(value)} (${age(ageSeconds)} ago)`;
}

function shortTimestampAgeLabel(value) {
  const millis = timestampMillis(value);
  if (millis === null) return "not published";
  const ageSeconds = Math.max(0, (Date.now() - millis) / 1000);
  return `${age(ageSeconds)} ago`;
}

function setMetricValue(id, value, { className = "", meta = "" } = {}) {
  const element = $(id);
  if (!element) return;
  element.textContent = value;
  element.className = className;
  const parent = element.parentElement;
  if (!parent) return;
  let metaElement = parent.querySelector(".metric-source");
  if (!metaElement) {
    metaElement = document.createElement("small");
    metaElement.className = "metric-source";
    parent.appendChild(metaElement);
  }
  metaElement.textContent = meta;
}

function sourceTimestamp(source, accountRow = {}) {
  const summary = (source && source.summary) || {};
  const perf = (source && source.performance) || {};
  return firstPresent(
    accountRow.timestamp,
    summary.account_end_time,
    perf.account_end_time,
    summary.finished_at,
    perf.finished_at,
    summary.generated_at,
    perf.generated_at,
    summary.last_decision_time,
    perf.last_decision_time,
    (state.status || {}).generated_at,
  );
}

function sourceMetaLabel(source, accountRow = {}) {
  const timestamp = sourceTimestamp(source, accountRow);
  const sourceLabel = text((source && source.label) || "No source");
  return timestamp ? `${sourceLabel} / updated ${shortTimestampAgeLabel(timestamp)}` : sourceLabel;
}

function firstPresent(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function metricTimestamp(metrics, keys) {
  for (const key of keys) {
    const value = metrics ? metrics[key] : null;
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function eventStatusIsBad(event) {
  const status = String((event && event.status) || "").toLowerCase();
  return status.includes("reject") || status.includes("cancel") || status.includes("fail") || status.includes("error");
}

function runtimeStatusItems() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const supervisor = latestSupervisor();
  const metrics = (latestRun && latestRun.metrics) || {};
  const freshness = (latestRun && latestRun.freshness) || {};
  const supervisorFreshness = (supervisor && supervisor.freshness) || {};
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestOrder = events.find((event) => event.type === "order");
  const latestRejection = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const openOrders = currentOpenOrderRows();
  const heartbeatTimestamp = firstPresent(
    freshness.timestamp,
    metricTimestamp(metrics, ["last_decision_time", "account_end_time"]),
    supervisor && supervisor.generated_at,
    payload.generated_at,
  );
  const marketTimestamp = metricTimestamp(metrics, [
    "latest_data_time",
    "latest_market_data_time",
    "latest_bar_time",
    "last_bar_time",
    "market_data_time",
  ]);
  const accountTimestamp = metricTimestamp(metrics, [
    "account_end_time",
    "latest_account_time",
    "latest_account_timestamp",
    "account_snapshot_time",
  ]);
  const decisionTimestamp = firstPresent(metrics.last_decision_time, latestDecision && latestDecision.timestamp);
  const mode = metrics.mode || null;
  const heartbeatStale = Boolean(freshness.stale || supervisorFreshness.stale);
  const gatewayReachable = gateway.enabled ? gateway.reachable : null;
  const gatewayStatus = !gateway.enabled
    ? "warn"
    : gatewayReachable === true ? "ok" : gatewayReachable === false ? "bad" : "warn";
  return [
    {
      label: "Process Heartbeat",
      value: timestampAgeLabel(heartbeatTimestamp),
      status: heartbeatTimestamp ? (heartbeatStale ? "warn" : "ok") : "bad",
      detail: latestRun
        ? `Run ${text(latestRun.id)} freshness ${age(freshness.age_seconds)}`
        : supervisor
          ? `Supervisor ${text(supervisor.id)} freshness ${age(supervisorFreshness.age_seconds)}`
          : "No run or supervisor heartbeat is configured.",
    },
    {
      label: "Gateway/API",
      value: gateway.enabled ? (gatewayReachable ? "reachable" : "not reachable") : "disabled",
      status: gatewayStatus,
      detail: gateway.enabled
        ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === null || gateway.latency_ms === undefined ? "" : `${gateway.latency_ms}ms`}`
        : "Gateway checks are disabled in this dashboard config.",
    },
    {
      label: "Runner Mode",
      value: text(mode),
      status: latestRun ? (mode ? "ok" : "warn") : "bad",
      detail: latestRun
        ? `Run status ${text(latestRun.status)}`
        : "No current run is publishing telemetry.",
    },
    {
      label: "Latest Market Data",
      value: timestampAgeLabel(marketTimestamp),
      status: marketTimestamp ? "ok" : "warn",
      detail: marketTimestamp
        ? "Last bar/snapshot timestamp published by the runner."
        : "Runner summary does not publish latest bar or market-data time yet.",
    },
    {
      label: "Latest Account",
      value: timestampAgeLabel(accountTimestamp),
      status: accountTimestamp ? "ok" : "warn",
      detail: accountTimestamp
        ? `${numberText(metrics.account_snapshot_count, 0)} account snapshots summarized`
        : "Runner summary does not publish latest account snapshot time yet.",
    },
    {
      label: "Latest Decision",
      value: timestampAgeLabel(decisionTimestamp),
      status: decisionTimestamp ? "ok" : latestRun ? "warn" : "bad",
      detail: latestDecision
        ? `${text(latestDecision.symbol)} ${text(latestDecision.detail)}`
        : "No recent decision event is available.",
    },
    {
      label: "Open Orders",
      value: numberText(openOrders.length, 0),
      status: openOrders.length ? "warn" : "ok",
      detail: openOrders.length
        ? `${text(openOrders[0].symbol)} ${text(openOrders[0].status)} ${text(openOrders[0].timestamp)}`
        : "No recent non-terminal order events.",
    },
    {
      label: "Latest Rejection",
      value: latestRejection ? timestampAgeLabel(latestRejection.timestamp) : "none",
      status: latestRejection ? "bad" : "ok",
      detail: latestRejection
        ? `${text(latestRejection.symbol)} ${text(latestRejection.status)} ${text(latestRejection.detail)}`
        : latestOrder
          ? `Latest order ${text(latestOrder.symbol)} ${text(latestOrder.status)}`
          : "No recent rejected/canceled order events.",
    },
  ];
}

function paperMonitorItems() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const supervisor = latestSupervisor();
  const metrics = (latestRun && latestRun.metrics) || {};
  const freshness = (latestRun && latestRun.freshness) || {};
  const supervisorFreshness = (supervisor && supervisor.freshness) || {};
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestOrder = events.find((event) => event.type === "order");
  const latestFill = events.find((event) => event.type === "fill");
  const gatewayReachable = gateway.enabled ? gateway.reachable : null;
  const accountTimestamp = metricTimestamp(metrics, [
    "account_end_time",
    "latest_account_time",
    "latest_account_timestamp",
    "account_snapshot_time",
  ]);
  const marketTimestamp = metricTimestamp(metrics, [
    "latest_data_time",
    "latest_market_data_time",
    "latest_bar_time",
    "last_bar_time",
    "market_data_time",
  ]);
  const decisionTimestamp = firstPresent(metrics.last_decision_time, latestDecision && latestDecision.timestamp);
  const nextDecision = firstPresent(
    metrics.next_decision_time,
    metrics.next_expected_decision_time,
    metrics.next_check_time,
    metrics.next_signal_time,
  );
  const nextOrderContext = firstPresent(
    metrics.next_order_condition,
    metrics.next_order_reason,
    metrics.latest_signal_reason,
    metrics.signal_reason,
    latestDecision && latestDecision.detail,
  );
  const mode = String(metrics.mode || "").replace("-", "_").toLowerCase();
  const observing = Boolean(latestRun && !freshness.stale && (marketTimestamp || decisionTimestamp));
  const stale = Boolean((freshness && freshness.stale) || (supervisorFreshness && supervisorFreshness.stale));
  return [
    {
      label: "Gateway/API",
      status: gateway.enabled ? (gatewayReachable ? "ok" : "bad") : "warn",
      detail: gateway.enabled
        ? gatewayReachable
          ? `Gateway reachable at ${text(gateway.host)}:${text(gateway.port)}.`
          : `Gateway check failed: ${text(gateway.error || "not reachable")}.`
        : "Gateway checks are disabled; enable them to verify broker connectivity.",
    },
    {
      label: "Account Freshness",
      status: accountTimestamp ? "ok" : "warn",
      detail: accountTimestamp
        ? `Latest account snapshot ${timestampAgeLabel(accountTimestamp)}; ${numberText(metrics.account_snapshot_count, 0)} summarized snapshots.`
        : "No latest account timestamp published; paper monitor cannot prove account state is fresh.",
    },
    {
      label: "Config And Mode",
      status: latestRun ? (["paper", "simulated_paper", "shadow"].includes(mode) ? "ok" : mode ? "warn" : "bad") : "bad",
      detail: latestRun
        ? `Run ${text(latestRun.id)} status=${text(latestRun.status)} mode=${text(metrics.mode || "unpublished")}.`
        : "No current telemetry run is publishing config or mode.",
    },
    {
      label: "Observing Market",
      status: observing ? (stale ? "warn" : "ok") : "bad",
      detail: observing
        ? `Market data ${marketTimestamp ? timestampAgeLabel(marketTimestamp) : "n/a"}; latest decision ${decisionTimestamp ? timestampAgeLabel(decisionTimestamp) : "n/a"}.`
        : "No recent market-data or decision timestamp is available from the runner.",
    },
    {
      label: "Order Context",
      status: nextOrderContext || nextDecision || latestOrder || latestFill ? "ok" : latestRun ? "warn" : "bad",
      detail: nextOrderContext
        ? `Latest/next condition: ${text(nextOrderContext)}.`
        : nextDecision
          ? `Next expected decision ${text(nextDecision)}.`
          : latestOrder
            ? `Latest order ${text(latestOrder.symbol)} ${text(latestOrder.status)} at ${text(latestOrder.timestamp)}.`
            : latestFill
              ? `Latest fill ${text(latestFill.symbol)} at ${text(latestFill.timestamp)}.`
              : "Runner has not published the next order condition or recent order context.",
    },
  ];
}

function performancePeriodWindow(accountRows, period) {
  const rows = (accountRows || []).filter((item) => timestampMillis(item.timestamp) !== null);
  if (!rows.length || period === "all") {
    return { start: null, end: null, label: "all available" };
  }
  const ordered = rows.slice().sort((a, b) => timestampMillis(a.timestamp) - timestampMillis(b.timestamp));
  const end = timestampMillis(ordered[ordered.length - 1].timestamp);
  if (end === null) return { start: null, end: null, label: "all available" };
  if (period === "today") {
    const day = new Date(end);
    const start = Date.UTC(day.getUTCFullYear(), day.getUTCMonth(), day.getUTCDate());
    return { start, end, label: "today" };
  }
  const days = period === "week" ? 7 : period === "month" ? 30 : period === "3m" ? 90 : null;
  if (!days) return { start: null, end: null, label: "all available" };
  return { start: end - days * 24 * 60 * 60 * 1000, end, label: period === "3m" ? "3 months" : period };
}

function rowsInWindow(rows, window) {
  if (!window || (window.start === null && window.end === null)) return rows || [];
  return (rows || []).filter((item) => {
    const millis = timestampMillis(item.timestamp);
    if (millis === null) return false;
    if (window.start !== null && millis < window.start) return false;
    if (window.end !== null && millis > window.end) return false;
    return true;
  });
}

function performanceFromAccountRows(accountRows) {
  const rows = numericAccountRows(accountRows);
  if (rows.length < 2) return {};
  const initialEquity = rows[0].equity;
  const finalEquity = rows[rows.length - 1].equity;
  let peak = initialEquity;
  let maxDrawdown = 0;
  for (const rowItem of rows) {
    peak = Math.max(peak, rowItem.equity);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, ((rowItem.equity / peak) - 1) * 100);
    }
  }
  const grossValues = (accountRows || []).map((rowItem) => finiteNumber(rowItem.gross_exposure)).filter((value) => value !== null);
  const maxGrossExposure = grossValues.length ? Math.max(...grossValues) : null;
  const startTime = timestampMillis(rows[0].timestamp);
  const endTime = timestampMillis(rows[rows.length - 1].timestamp);
  const elapsedDays = startTime !== null && endTime !== null ? Math.max((endTime - startTime) / 86400000, 0) : null;
  const totalReturnPct = initialEquity ? ((finalEquity / initialEquity) - 1) * 100 : null;
  return {
    initial_equity: initialEquity,
    final_equity: finalEquity,
    elapsed_days: elapsedDays,
    total_return_pct: totalReturnPct,
    max_drawdown_pct: maxDrawdown,
    return_per_day_pct: elapsedDays && elapsedDays > 0 && initialEquity > 0
      ? ((Math.pow(finalEquity / initialEquity, 1 / elapsedDays) - 1) * 100)
      : null,
    return_per_month_pct: elapsedDays && elapsedDays > 0 && initialEquity > 0
      ? ((Math.pow(finalEquity / initialEquity, 30.4375 / elapsedDays) - 1) * 100)
      : null,
    return_per_year_pct: elapsedDays && elapsedDays > 0 && initialEquity > 0
      ? ((Math.pow(finalEquity / initialEquity, 365.25 / elapsedDays) - 1) * 100)
      : null,
    short_horizon_projection: elapsedDays !== null && elapsedDays < 30,
    max_gross_exposure: maxGrossExposure,
    max_gross_exposure_pct: maxGrossExposure !== null && initialEquity > 0 ? (maxGrossExposure / initialEquity) * 100 : null,
  };
}

function modeMeaning(mode) {
  const value = String(mode || "").replace("-", "_").toLowerCase();
  if (value === "replay") return "Historical replay from saved files; no broker account is touched.";
  if (value === "simulated_paper") return "Local simulated-paper run using saved or streamed prices and simulated fills.";
  if (value === "shadow") return "Observation mode; signals can be logged without submitting orders.";
  if (value === "paper") return "Broker paper account metrics; orders may have been submitted to a paper account.";
  if (value === "live") return "Live account metrics; treat all results and controls as production-sensitive.";
  return "Mode unavailable; inspect the source run or telemetry before interpreting results.";
}

function sourceMeaning(source) {
  if (source.source_type === "archived_artifact") return "Full archived run artifacts are loaded, including account snapshots when available.";
  if (source.source_type === "run_summary") return "Using a saved run summary; detailed curves need the run artifacts.";
  if (source.source_type === "live_telemetry") return "Using latest published telemetry; persistence depends on the runner output.";
  return "No performance source is loaded yet.";
}

function projectionCaveat(perf, summary, elapsedDays) {
  const projected = Boolean(perf.short_horizon_projection ?? summary.short_horizon_projection);
  if (projected || (elapsedDays !== null && elapsedDays < 30)) {
    const horizon = elapsedDays !== null ? `${numberText(elapsedDays, 2)} elapsed days` : "a short elapsed window";
    return `Short horizon: per-day/month/year figures annualize ${horizon}. They are scale references, not forecasts.`;
  }
  if (elapsedDays !== null) {
    return `Window spans ${numberText(elapsedDays, 2)} elapsed days; annualized figures are still descriptive, not predictive.`;
  }
  return "No elapsed account window is available; prefer total return and drawdown over annualized figures.";
}

function fillNotional(fill) {
  const quantity = Math.abs(finiteNumber(fill.quantity) || 0);
  const price = finiteNumber(fill.price);
  if (!quantity || price === null) return 0;
  return quantity * price;
}

function turnoverStats(fills, initialEquity) {
  const notional = (fills || []).reduce((sum, fill) => sum + fillNotional(fill), 0);
  const equity = finiteNumber(initialEquity);
  return {
    notional,
    pct: equity && equity > 0 ? (notional / equity) * 100 : null,
  };
}

function normalizedFillSide(value) {
  const side = String(value || "").trim().toLowerCase();
  if (side === "buy" || side === "bot" || side === "b") return "buy";
  if (side === "sell" || side === "sld" || side === "s") return "sell";
  return side;
}

function holdDurationLabel(start, end) {
  const startMs = timestampMillis(start);
  const endMs = timestampMillis(end);
  if (startMs === null || endMs === null || endMs < startMs) return "n/a";
  const minutes = Math.round((endMs - startMs) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`;
  return `${(hours / 24).toLocaleString("en-US", { maximumFractionDigits: 1 })}d`;
}

function buildTradeLedger(fills) {
  const lotsBySymbol = new Map();
  const closed = [];
  const sortedFills = (fills || []).slice().sort((a, b) => String(a.timestamp || "").localeCompare(String(b.timestamp || "")));
  const lotsFor = (symbol) => {
    if (!lotsBySymbol.has(symbol)) lotsBySymbol.set(symbol, { long: [], short: [] });
    return lotsBySymbol.get(symbol);
  };
  const openLot = (bucket, fill, quantity, side) => {
    const price = finiteNumber(fill.price);
    if (!quantity || price === null) return;
    bucket.push({
      symbol: text(fill.symbol),
      side,
      quantity,
      remaining: quantity,
      entry_price: price,
      entry_time: fill.timestamp,
      commission_per_unit: (finiteNumber(fill.commission) || 0) / quantity,
      tag: fill.tag,
    });
  };
  const closeLots = (bucket, fill, quantity, side) => {
    const exitPrice = finiteNumber(fill.price);
    if (!quantity || exitPrice === null) return quantity;
    let remaining = quantity;
    const exitCommissionPerUnit = (finiteNumber(fill.commission) || 0) / quantity;
    while (remaining > 0 && bucket.length) {
      const lot = bucket[0];
      const closeQuantity = Math.min(remaining, lot.remaining);
      const grossPnl = side === "long"
        ? (exitPrice - lot.entry_price) * closeQuantity
        : (lot.entry_price - exitPrice) * closeQuantity;
      const commission = ((lot.commission_per_unit || 0) + exitCommissionPerUnit) * closeQuantity;
      closed.push({
        symbol: lot.symbol,
        state: "closed",
        side,
        quantity: closeQuantity,
        entry_time: lot.entry_time,
        entry_price: lot.entry_price,
        exit_time: fill.timestamp,
        exit_price: exitPrice,
        pnl: grossPnl - commission,
      });
      lot.remaining -= closeQuantity;
      remaining -= closeQuantity;
      if (lot.remaining <= 1e-9) bucket.shift();
    }
    return remaining;
  };

  for (const fill of sortedFills) {
    const symbol = text(fill.symbol);
    const side = normalizedFillSide(fill.side);
    const quantity = Math.abs(finiteNumber(fill.quantity) || 0);
    const lots = lotsFor(symbol);
    if (!symbol || !quantity) continue;
    if (side === "buy") {
      const remainder = closeLots(lots.short, fill, quantity, "short");
      openLot(lots.long, fill, remainder, "long");
    } else if (side === "sell") {
      const remainder = closeLots(lots.long, fill, quantity, "long");
      openLot(lots.short, fill, remainder, "short");
    }
  }

  const open = [];
  for (const lots of lotsBySymbol.values()) {
    for (const lot of [...lots.long, ...lots.short]) {
      open.push({
        symbol: lot.symbol,
        state: "open",
        side: lot.side,
        quantity: lot.remaining,
        entry_time: lot.entry_time,
        entry_price: lot.entry_price,
        exit_time: null,
        exit_price: null,
        pnl: null,
      });
    }
  }
  const wins = closed.filter((trade) => finiteNumber(trade.pnl) > 0);
  const losses = closed.filter((trade) => finiteNumber(trade.pnl) < 0);
  const grossProfit = wins.reduce((sum, trade) => sum + Number(trade.pnl), 0);
  const grossLoss = Math.abs(losses.reduce((sum, trade) => sum + Number(trade.pnl), 0));
  return {
    closed,
    open,
    rows: [...open, ...closed].sort((a, b) => String(b.exit_time || b.entry_time || "").localeCompare(String(a.exit_time || a.entry_time || ""))),
    stats: {
      closed_count: closed.length,
      open_count: open.length,
      wins: wins.length,
      losses: losses.length,
      avg_win: wins.length ? grossProfit / wins.length : null,
      avg_loss: losses.length ? grossLoss / losses.length : null,
      profit_factor: grossLoss > 0 ? grossProfit / grossLoss : grossProfit > 0 ? Infinity : null,
    },
  };
}

function renderPerformanceTradeControls(ledger) {
  if (!$("performance-trade-summary")) return ledger.rows || [];
  const stateFilter = (($("performance-trade-filter-state") || {}).value || "").toLowerCase();
  const sideFilter = (($("performance-trade-filter-side") || {}).value || "").toLowerCase();
  const symbolFilter = (($("performance-trade-filter-symbol") || {}).value || "").trim().toUpperCase();
  const rows = (ledger.rows || []).filter((trade) => (
    (!stateFilter || String(trade.state || "").toLowerCase() === stateFilter)
    && (!sideFilter || String(trade.side || "").toLowerCase() === sideFilter)
    && (!symbolFilter || String(trade.symbol || "").toUpperCase().includes(symbolFilter))
  ));
  const openNotional = (ledger.open || []).reduce((sum, trade) => {
    const quantity = finiteNumber(trade.quantity) || 0;
    const price = finiteNumber(trade.entry_price) || 0;
    return sum + Math.abs(quantity * price);
  }, 0);
  const closedPnl = (ledger.closed || []).reduce((sum, trade) => sum + (finiteNumber(trade.pnl) || 0), 0);
  const winRate = ledger.stats.closed_count
    ? (Number(ledger.stats.wins || 0) / Number(ledger.stats.closed_count || 1)) * 100
    : null;
  const activeFilters = [stateFilter, sideFilter, symbolFilter].filter(Boolean).length;
  const cards = [
    {
      status: ledger.stats.open_count ? "warn" : ledger.rows.length ? "ok" : "bad",
      title: numberText(ledger.stats.open_count, 0),
      label: "Open",
      note: ledger.stats.open_count
        ? `${money(openNotional)} entry notional still open.`
        : "No open lots from selected fills.",
    },
    {
      status: ledger.stats.closed_count ? "ok" : "warn",
      title: numberText(ledger.stats.closed_count, 0),
      label: "Closed",
      note: ledger.stats.closed_count
        ? `${money(closedPnl)} realized from matched lots.`
        : "No closed matched lots in this period.",
    },
    {
      status: winRate === null ? "warn" : Number(ledger.stats.losses || 0) ? "warn" : "ok",
      title: winRate === null ? "n/a" : pctText(winRate),
      label: "Win Rate",
      note: ledger.stats.closed_count
        ? `${numberText(ledger.stats.wins, 0)} wins / ${numberText(ledger.stats.losses, 0)} losses.`
        : "Needs closed trades.",
    },
    {
      status: rows.length ? "ok" : ledger.rows.length ? "warn" : "bad",
      title: `${numberText(rows.length, 0)} / ${numberText(ledger.rows.length, 0)}`,
      label: "Shown",
      note: activeFilters
        ? `${numberText(activeFilters, 0)} active trade filter${activeFilters === 1 ? "" : "s"}.`
        : "No trade filters applied.",
    },
  ];
  $("performance-trade-summary").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  return rows;
}

function performanceTradeFilters() {
  return {
    state: (($("performance-trade-filter-state") || {}).value || "").toLowerCase(),
    side: (($("performance-trade-filter-side") || {}).value || "").toLowerCase(),
    symbol: (($("performance-trade-filter-symbol") || {}).value || "").trim().toUpperCase(),
  };
}

function performanceTradeFilterCount() {
  const filters = performanceTradeFilters();
  return [filters.state, filters.side, filters.symbol].filter(Boolean).length;
}

function tradeLedgerRealizedPnl(ledger) {
  return (ledger.closed || []).reduce((sum, trade) => sum + (finiteNumber(trade.pnl) || 0), 0);
}

function tradeLedgerWorstLoss(ledger) {
  const losses = (ledger.closed || [])
    .filter((trade) => finiteNumber(trade.pnl) !== null && Number(trade.pnl) < 0)
    .sort((left, right) => Number(left.pnl || 0) - Number(right.pnl || 0));
  return losses[0] || null;
}

function tradeLedgerNewestOpen(ledger) {
  const open = (ledger.open || []).slice();
  open.sort((left, right) => String(right.entry_time || "").localeCompare(String(left.entry_time || "")));
  return open[0] || null;
}

function renderPerformanceTradeAssistant(ledger, shownRows = [], fills = []) {
  if (!$("performance-trade-assistant-title") || !$("performance-trade-assistant-cards") || !$("performance-trade-assistant-actions")) return;
  const realizedPnl = tradeLedgerRealizedPnl(ledger);
  const winRate = ledger.stats.closed_count
    ? (Number(ledger.stats.wins || 0) / Number(ledger.stats.closed_count || 1)) * 100
    : null;
  const worstLoss = tradeLedgerWorstLoss(ledger);
  const newestOpen = tradeLedgerNewestOpen(ledger);
  const activeFilters = performanceTradeFilterCount();
  const profitFactor = Number.isFinite(ledger.stats.profit_factor)
    ? numberText(ledger.stats.profit_factor, 2)
    : ledger.stats.profit_factor === Infinity ? "inf" : "n/a";
  let title = "No Trades To Review";
  let note = fills.length
    ? `${numberText(fills.length, 0)} fill${fills.length === 1 ? "" : "s"} loaded, but no paired trade rows are available yet.`
    : "Load a run or artifact with sanitized fills to build the public-safe trade ledger.";
  if (ledger.stats.open_count) {
    title = "Open Exposure In Ledger";
    note = `${numberText(ledger.stats.open_count, 0)} open lot${ledger.stats.open_count === 1 ? "" : "s"} remain; newest is ${text(newestOpen && newestOpen.symbol)} from ${text(newestOpen && newestOpen.entry_time)}.`;
  } else if (ledger.stats.closed_count && realizedPnl >= 0) {
    title = "Closed Trades Positive";
    note = `${numberText(ledger.stats.closed_count, 0)} closed trade${ledger.stats.closed_count === 1 ? "" : "s"} have ${money(realizedPnl)} realized PnL in the selected source.`;
  } else if (ledger.stats.closed_count) {
    title = "Closed Trades Negative";
    note = `${numberText(ledger.stats.closed_count, 0)} closed trade${ledger.stats.closed_count === 1 ? "" : "s"} have ${money(realizedPnl)} realized PnL; inspect losses before trusting this run.`;
  }
  if (activeFilters) {
    note += ` ${numberText(activeFilters, 0)} filter${activeFilters === 1 ? "" : "s"} active; ${numberText(shownRows.length, 0)} of ${numberText((ledger.rows || []).length, 0)} rows shown.`;
  }
  $("performance-trade-assistant-title").textContent = title;
  $("performance-trade-assistant-note").textContent = note;
  const cards = [
    {
      status: ledger.stats.closed_count ? realizedPnl >= 0 ? "ok" : "bad" : "warn",
      label: "Realized",
      title: ledger.stats.closed_count ? money(realizedPnl) : "n/a",
      note: ledger.stats.closed_count ? `${numberText(ledger.stats.closed_count, 0)} closed paired trades.` : "No closed trades yet.",
    },
    {
      status: ledger.stats.open_count ? "warn" : ledger.rows.length ? "ok" : "bad",
      label: "Open",
      title: numberText(ledger.stats.open_count, 0),
      note: newestOpen ? `${text(newestOpen.symbol)} entered ${text(newestOpen.entry_time)}.` : "No open matched lots.",
    },
    {
      status: winRate === null ? "warn" : winRate >= 50 ? "ok" : "warn",
      label: "Win Rate",
      title: winRate === null ? "n/a" : pctText(winRate),
      note: ledger.stats.closed_count ? `${numberText(ledger.stats.wins, 0)} wins / ${numberText(ledger.stats.losses, 0)} losses.` : "Needs closed trades.",
    },
    {
      status: worstLoss ? "warn" : ledger.stats.closed_count ? "ok" : "warn",
      label: worstLoss ? "Largest Loss" : "Profit Factor",
      title: worstLoss ? money(worstLoss.pnl) : profitFactor,
      note: worstLoss ? `${text(worstLoss.symbol)} closed ${text(worstLoss.exit_time)}.` : "No losing closed trade in this source.",
    },
  ];
  $("performance-trade-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const actions = [
    {
      action: "open",
      title: "Show Open Lots",
      note: ledger.stats.open_count ? "Filter the ledger to currently open matched lots." : "No open lots are available in this source.",
      label: "Open",
      disabled: !ledger.stats.open_count,
    },
    {
      action: "closed",
      title: "Show Closed Trades",
      note: ledger.stats.closed_count ? "Filter the ledger to completed matched trades." : "No closed trades are available in this source.",
      label: "Closed",
      disabled: !ledger.stats.closed_count,
    },
    {
      action: "worst-loss",
      title: "Inspect Largest Loss",
      note: worstLoss ? `Filter to ${text(worstLoss.symbol)} and closed trades.` : "No losing closed trade is available.",
      label: "Inspect",
      disabled: !worstLoss,
    },
    {
      action: activeFilters ? "clear" : "runs",
      title: activeFilters ? "Clear Filters" : "Open Runs",
      note: activeFilters ? "Return to the full trade ledger." : "Open Runs for artifact, event, and log context.",
      label: activeFilters ? "Clear" : "Runs",
      disabled: false,
    },
  ];
  $("performance-trade-assistant-actions").innerHTML = actions.map((action) => `
    <button type="button" class="performance-trade-assistant-action ${action.disabled ? "secondary" : ""}" data-performance-trade-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.note)}</small>
      </span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

function applyPerformanceTradeFilter({ state = "", side = "", symbol = "" } = {}) {
  $("performance-trade-filter-state").value = state;
  $("performance-trade-filter-side").value = side;
  $("performance-trade-filter-symbol").value = symbol;
  renderPerformance();
}

function currentTradeLedger() {
  const source = performanceSource();
  const window = selectedPerformanceWindow(source.accountRows || []);
  const fills = eventsInPeriod(source.fills || [], window.start, window.end, (fill) => fill.timestamp || fill.time);
  return tradeLedgerFromFills(fills);
}

function handlePerformanceTradeAssistantAction(action) {
  const ledger = currentTradeLedger();
  if (action === "open") {
    applyPerformanceTradeFilter({ state: "open" });
    $("performance-trades-body").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Performance trade ledger filtered to open lots";
    return;
  }
  if (action === "closed") {
    applyPerformanceTradeFilter({ state: "closed" });
    $("performance-trades-body").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Performance trade ledger filtered to closed trades";
    return;
  }
  if (action === "worst-loss") {
    const worstLoss = tradeLedgerWorstLoss(ledger);
    if (!worstLoss) {
      $("last-refresh").textContent = "No losing closed trade is available in the selected performance source";
      return;
    }
    applyPerformanceTradeFilter({ state: "closed", symbol: text(worstLoss.symbol).toUpperCase() });
    $("performance-trades-body").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = `Performance trade ledger filtered to largest loss symbol ${text(worstLoss.symbol)}`;
    return;
  }
  if (action === "clear") {
    applyPerformanceTradeFilter();
    $("last-refresh").textContent = "Performance trade filters cleared";
    return;
  }
  navigateToRunsLens("runs");
}

function nonzeroPositionsFromAccountRow(accountRow = {}, summary = {}) {
  const positions = accountRow.positions || summary.final_positions || {};
  const values = accountRow.position_values || {};
  const averageCosts = accountRow.average_costs || {};
  const unrealizedBySymbol = accountRow.unrealized_pnl_by_symbol || {};
  const borrowFees = accountRow.borrow_fee_accrued_by_symbol || {};
  const positionDetails = accountRow.position_details || {};
  return Object.entries(positions || {})
    .map(([symbol, quantity]) => {
      const numericQuantity = Number(quantity);
      const value = Number(values[symbol]);
      const detail = positionDetails[symbol] || {};
      const detailCurrentPrice = finiteNumber(detail.current_price);
      const currentPrice = detailCurrentPrice !== null
        ? detailCurrentPrice
        : Number.isFinite(value) && numericQuantity ? value / numericQuantity : null;
      return {
        symbol,
        quantity: numericQuantity,
        value,
        average_cost: finiteNumber(averageCosts[symbol]),
        current_price: currentPrice,
        unrealized_pnl: finiteNumber(unrealizedBySymbol[symbol]),
        borrow_fee_accrued: finiteNumber(borrowFees[symbol]),
        entry_time: text(detail.entry_time) !== "n/a" ? detail.entry_time : null,
        entry_price: finiteNumber(detail.entry_price),
        expected_hold_minutes: finiteNumber(detail.expected_hold_minutes),
        hold_until: text(detail.hold_until) !== "n/a" ? detail.hold_until : null,
        active_exit_rule: text(detail.active_exit_rule) !== "n/a" ? detail.active_exit_rule : null,
        exit_state: text(detail.exit_state) !== "n/a" ? detail.exit_state : null,
        stop_state: text(detail.stop_state) !== "n/a" ? detail.stop_state : null,
        stop_price: finiteNumber(detail.stop_price),
        target_price: finiteNumber(detail.target_price),
        mae_pct: finiteNumber(detail.mae_pct),
        mfe_pct: finiteNumber(detail.mfe_pct),
      };
    })
    .filter((item) => Number.isFinite(item.quantity) && item.quantity !== 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function nonzeroPositionsFromSource(source) {
  const summary = (source && source.summary) || {};
  const accountRow = latestAccountRow((source && source.account) || []);
  return nonzeroPositionsFromAccountRow(accountRow, summary);
}

function positionDetailHtml(position, { includeQuantity = true } = {}) {
  const exitState = position.exit_state || position.stop_state;
  const entryMillis = timestampMillis(position.entry_time);
  const ageText = entryMillis === null ? "" : `Age ${age(Math.max(0, (Date.now() - entryMillis) / 1000))}`;
  const detailLines = [
    includeQuantity ? `Quantity ${numberText(position.quantity, 6)}` : "",
    Number.isFinite(position.value) ? `Value ${money(position.value)}` : "",
    position.entry_time ? `Entry ${text(position.entry_time)}` : "",
    ageText,
    position.entry_price !== null ? `Entry Px ${money(position.entry_price)}` : "",
    position.average_cost !== null ? `Avg ${money(position.average_cost)}` : "",
    position.current_price !== null ? `Price ${money(position.current_price)}` : "",
    position.unrealized_pnl !== null ? `Unrealized ${money(position.unrealized_pnl)}` : "",
    position.borrow_fee_accrued !== null ? `Borrow ${money(position.borrow_fee_accrued)}` : "",
    position.expected_hold_minutes !== null ? `Hold ${numberText(position.expected_hold_minutes, 0)}m` : "",
    position.hold_until ? `Until ${text(position.hold_until)}` : "",
    position.active_exit_rule ? `Exit ${text(position.active_exit_rule)}` : "",
    exitState ? `State ${text(exitState)}` : "",
    position.stop_price !== null ? `Stop ${money(position.stop_price)}` : "",
    position.target_price !== null ? `Target ${money(position.target_price)}` : "",
    position.mae_pct !== null ? `MAE ${pctText(position.mae_pct)}` : "",
    position.mfe_pct !== null ? `MFE ${pctText(position.mfe_pct)}` : "",
  ].filter(Boolean);
  return detailLines.map((line) => `<small>${escapeHtml(line)}</small>`).join("");
}

function positionSnapshotDrilldown(snapshot) {
  const positions = nonzeroPositionsFromAccountRow(snapshot);
  if (!positions.length) return `<span class="muted">flat</span>`;
  const detailCount = positions.filter((position) => (
    position.entry_time ||
    position.entry_price !== null ||
    position.expected_hold_minutes !== null ||
    position.active_exit_rule ||
    position.stop_price !== null ||
    position.target_price !== null ||
    position.mae_pct !== null ||
    position.mfe_pct !== null
  )).length;
  const summary = `${numberText(positions.length, 0)} open${detailCount ? ` / ${numberText(detailCount, 0)} detailed` : ""}`;
  return `
    <details class="json-drilldown position-drilldown">
      <summary>${escapeHtml(summary)}</summary>
      <div class="position-mini-list">
        ${positions.map((position) => `
          <div class="position-mini-card">
            <span>${escapeHtml(position.symbol)}</span>
            <strong>${escapeHtml(numberText(position.quantity, 4))}</strong>
            ${positionDetailHtml(position, { includeQuantity: false })}
          </div>
        `).join("")}
      </div>
    </details>
  `;
}

function overviewHealthChecks() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const runs = payload.runs || [];
  const alerts = payload.alerts || [];
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const fetchRoots = (state.fetchManifests && state.fetchManifests.roots) || [];
  const workbenchRuns = (state.configRuns && state.configRuns.runs) || [];
  const events = runEventRows();
  const gatewayStatus = gateway.enabled
    ? gateway.reachable ? "ok" : "bad"
    : "warn";
  const dataStatus = datasets.length > 2 ? "ok" : datasets.length ? "warn" : "bad";
  const fetchRootStatus = fetchRoots.some((root) => root.exists && root.is_dir) ? "ok" : "warn";
  const runStatus = runs.length ? "ok" : workbenchRuns.length ? "warn" : "bad";
  const eventStatus = events.length ? "ok" : runs.length ? "warn" : "bad";
  return [
    {
      label: "Telemetry",
      status: payload.generated_at ? "ok" : "bad",
      detail: payload.generated_at ? `latest ${payload.generated_at}` : "No status has been published yet.",
    },
    {
      label: "Gateway/API",
      status: gatewayStatus,
      detail: gateway.enabled
        ? `reachable=${text(gateway.reachable)} ${gateway.latency_ms === null || gateway.latency_ms === undefined ? "" : `${gateway.latency_ms}ms`}`
        : "Gateway checks are disabled in this dashboard config.",
    },
    {
      label: "Strategy Runs",
      status: runStatus,
      detail: runs.length
        ? `${runs.length} published run${runs.length === 1 ? "" : "s"}`
        : workbenchRuns.length
          ? `${workbenchRuns.length} saved workbench run${workbenchRuns.length === 1 ? "" : "s"}, no live telemetry run`
          : "No published or saved runs yet.",
    },
    {
      label: "Signals/Fills",
      status: eventStatus,
      detail: events.length
        ? `${events.length} recent decision/order/fill events`
        : runs.length
          ? "Run telemetry exists, but no recent signal/order/fill events were published."
          : "No current run events yet.",
    },
    {
      label: "Saved Data",
      status: dataStatus,
      detail: datasets.length
        ? `${datasets.length} scanned dataset${datasets.length === 1 ? "" : "s"}`
        : "No saved CSV/parquet data is visible under configured roots.",
    },
    {
      label: "Fetch Jobs",
      status: fetchRootStatus,
      detail: fetchRoots.length
        ? `${fetchRoots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0)} manifests across ${fetchRoots.length} root${fetchRoots.length === 1 ? "" : "s"}`
        : "No fetch manifest root is configured.",
    },
    {
      label: "Alerts",
      status: alerts.length ? "warn" : "ok",
      detail: alerts.length
        ? `${alerts.length} alert${alerts.length === 1 ? "" : "s"} need review`
        : "No published alerts.",
    },
  ];
}

function sortedStatusRollups() {
  const rollups = ((state.statusEquityRollups && state.statusEquityRollups.rollups) || []).slice();
  return rollups.sort((left, right) => {
    const leftKey = String(left.account_end_time || left.day || "");
    const rightKey = String(right.account_end_time || right.day || "");
    return leftKey.localeCompare(rightKey);
  });
}

function statusRollupSeriesStats(rollups) {
  const rows = (rollups || []).filter((item) => finiteNumber(item.end_equity) !== null);
  if (!rows.length) {
    return {
      start_equity: null,
      end_equity: null,
      total_return_pct: null,
      max_drawdown_pct: null,
      first_day: null,
      last_day: null,
    };
  }
  const first = rows[0];
  const last = rows[rows.length - 1];
  const startEquity = finiteNumber(first.start_equity) ?? finiteNumber(first.end_equity);
  const endEquity = finiteNumber(last.end_equity);
  let peak = null;
  let maxDrawdown = 0;
  for (const rowItem of rows) {
    const equity = finiteNumber(rowItem.end_equity);
    if (equity === null) continue;
    peak = peak === null ? equity : Math.max(peak, equity);
    if (peak > 0) {
      maxDrawdown = Math.min(maxDrawdown, ((equity / peak) - 1) * 100);
    }
  }
  return {
    start_equity: startEquity,
    end_equity: endEquity,
    total_return_pct: startEquity && endEquity !== null ? ((endEquity / startEquity) - 1) * 100 : null,
    max_drawdown_pct: maxDrawdown,
    first_day: first.day || null,
    last_day: last.day || null,
  };
}

function trailingStatusRollups(rollups, days) {
  const rows = (rollups || []).filter((item) => item.day && timestampMillis(`${item.day}T00:00:00Z`) !== null);
  if (!rows.length) return [];
  const latestMillis = Math.max(...rows.map((item) => timestampMillis(`${item.day}T00:00:00Z`)));
  const cutoffMillis = latestMillis - Math.max(0, Number(days || 1) - 1) * 86400000;
  return rows.filter((item) => {
    const millis = timestampMillis(`${item.day}T00:00:00Z`);
    return millis !== null && millis >= cutoffMillis && millis <= latestMillis;
  }).sort((left, right) => String(left.day || "").localeCompare(String(right.day || "")));
}

function rollupReturnClass(value) {
  const number = finiteNumber(value);
  if (number === null) return statusClass("warn");
  return statusClass(number >= 0 ? "ok" : "bad");
}

function drawdownClass(value) {
  const number = finiteNumber(value);
  if (number === null) return statusClass("warn");
  if (number <= -10) return statusClass("bad");
  if (number < 0) return statusClass("warn");
  return statusClass("ok");
}

function livePeriodTile(label, value, detail, className) {
  return `
    <div class="status-tile">
      <span>${escapeHtml(label)}</span>
      <strong class="${escapeHtml(className || statusClass("unknown"))}">${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

function renderPerformanceLivePeriodSummary() {
  if (!$("performance-live-period-note") || !$("performance-live-period-cards")) return;
  const payload = state.statusEquityRollups || {};
  const rollups = sortedStatusRollups();
  if (!rollups.length) {
    $("performance-live-period-note").textContent = "No status-history equity rollups loaded";
    $("performance-live-period-cards").innerHTML = [
      livePeriodTile("Latest Day", "n/a", "Publish status snapshots during paper/live sessions.", statusClass("warn")),
      livePeriodTile("Recent", "n/a", "Trailing period summaries need at least one rollup day.", statusClass("warn")),
      livePeriodTile("All Available", "n/a", "No sanitized live/paper equity path is available yet.", statusClass("warn")),
    ].join("");
    return;
  }
  const periodRollups = payload.period_rollups || {};
  const latestDay = rollups[rollups.length - 1];
  const weekStats = statusRollupSeriesStats(trailingStatusRollups(rollups, 7));
  const threeMonthStats = statusRollupSeriesStats(trailingStatusRollups(rollups, 90));
  const allStats = statusRollupSeriesStats(rollups);
  const latestMonth = ((periodRollups.month || [])[0]) || null;
  const latestYear = ((periodRollups.year || [])[0]) || null;
  const nodeCount = new Set(rollups.map((item) => text(item.node_id))).size;
  const latestActivity = `${numberText(latestDay.order_count || 0, 0)}O / ${numberText(latestDay.fill_count || 0, 0)}F / ${numberText(latestDay.rejection_count || 0, 0)}R`;
  $("performance-live-period-note").textContent = payload.generated_at
    ? `${numberText(rollups.length, 0)} live/paper day row${rollups.length === 1 ? "" : "s"} from ${numberText(nodeCount, 0)} node${nodeCount === 1 ? "" : "s"}; latest ${text(payload.generated_at)}`
    : `${numberText(rollups.length, 0)} live/paper day row${rollups.length === 1 ? "" : "s"} loaded`;
  const tiles = [
    livePeriodTile(
      "Latest Day",
      pctText(latestDay.daily_return_pct),
      `${text(latestDay.day)} ${text(latestDay.node_id)}; ${money(latestDay.start_equity)} to ${money(latestDay.end_equity)}; ${latestActivity}.`,
      rollupReturnClass(latestDay.daily_return_pct),
    ),
    livePeriodTile(
      "Last 7 Days",
      pctText(weekStats.total_return_pct),
      `${text(weekStats.first_day)} to ${text(weekStats.last_day)} from status-history equity.`,
      rollupReturnClass(weekStats.total_return_pct),
    ),
    livePeriodTile(
      "Month",
      pctText(latestMonth && latestMonth.total_return_pct),
      latestMonth
        ? `${text(latestMonth.label)}; ${numberText(latestMonth.day_count, 0)} day${latestMonth.day_count === 1 ? "" : "s"} / ${numberText(latestMonth.snapshot_count, 0)} snapshots.`
        : "No monthly status-history summary yet.",
      rollupReturnClass(latestMonth && latestMonth.total_return_pct),
    ),
    livePeriodTile(
      "Last 3 Months",
      pctText(threeMonthStats.total_return_pct),
      `${text(threeMonthStats.first_day)} to ${text(threeMonthStats.last_day)} from trailing rollup rows.`,
      rollupReturnClass(threeMonthStats.total_return_pct),
    ),
    livePeriodTile(
      "Year",
      pctText(latestYear && latestYear.total_return_pct),
      latestYear
        ? `${text(latestYear.label)}; ${numberText(latestYear.day_count, 0)} day${latestYear.day_count === 1 ? "" : "s"} / ${numberText(latestYear.snapshot_count, 0)} snapshots.`
        : "No yearly status-history summary yet.",
      rollupReturnClass(latestYear && latestYear.total_return_pct),
    ),
    livePeriodTile(
      "All / Drawdown",
      `${pctText(allStats.total_return_pct)} / ${pctText(allStats.max_drawdown_pct)}`,
      `${text(allStats.first_day)} to ${text(allStats.last_day)}; drawdown from end-of-day equity.`,
      drawdownClass(allStats.max_drawdown_pct),
    ),
  ];
  $("performance-live-period-cards").innerHTML = tiles.join("");
}

function renderOverviewPerformanceSnapshot() {
  if (
    !$("overview-performance-result")
    || !$("overview-performance-summary")
    || !$("overview-performance-note")
    || !$("overview-performance-tiles")
    || !$("overview-performance-chart")
  ) return;
  const payload = state.statusEquityRollups || {};
  const rollups = sortedStatusRollups();
  const latestDay = rollups.length ? rollups[rollups.length - 1] : null;
  const periodRollups = payload.period_rollups || {};
  const latestMonth = ((periodRollups.month || [])[0]) || null;
  const latestYear = ((periodRollups.year || [])[0]) || null;
  const seriesStats = statusRollupSeriesStats(rollups);
  const totalOrders = rollups.reduce((sum, item) => sum + Number(item.order_count || 0), 0);
  const totalFills = rollups.reduce((sum, item) => sum + Number(item.fill_count || 0), 0);
  const totalRejects = rollups.reduce((sum, item) => sum + Number(item.rejection_count || 0), 0);
  const totalAlerts = rollups.reduce((sum, item) => sum + Number(item.alert_count || 0), 0);
  if (!rollups.length) {
    $("overview-performance-note").textContent = "No status-history equity rollups loaded";
    $("overview-performance-result").textContent = "n/a";
    $("overview-performance-result").className = "";
    $("overview-performance-summary").textContent = "Run the status publisher during paper/live sessions to populate today, recent, and all-available performance.";
    $("overview-performance-tiles").innerHTML = [
      { label: "Today", value: "n/a", detail: "No status-history day rows yet.", status: "warn" },
      { label: "Recent", value: "n/a", detail: "Monthly/yearly rollups need status snapshots.", status: "warn" },
      { label: "Activity", value: "n/a", detail: "No orders, fills, rejects, or alerts observed.", status: "warn" },
    ].map((tile) => `
      <div class="status-tile">
        <span>${escapeHtml(tile.label)}</span>
        <strong class="${statusClass(tile.status)}">${escapeHtml(tile.value)}</strong>
        <small>${escapeHtml(tile.detail)}</small>
      </div>
    `).join("");
    $("overview-performance-chart").innerHTML = emptyChart("No status-history return chart available");
    return;
  }
  const resultValue = latestDay ? pctText(latestDay.daily_return_pct) : pctText(seriesStats.total_return_pct);
  const resultClass = rollupReturnClass(latestDay ? latestDay.daily_return_pct : seriesStats.total_return_pct);
  const nodeCount = new Set(rollups.map((item) => text(item.node_id))).size;
  $("overview-performance-result").textContent = resultValue;
  $("overview-performance-result").className = resultClass;
  $("overview-performance-note").textContent = `${numberText(rollups.length, 0)} day row${rollups.length === 1 ? "" : "s"} from ${numberText(nodeCount, 0)} node${nodeCount === 1 ? "" : "s"}`;
  $("overview-performance-summary").textContent = latestDay
    ? `Latest day ${text(latestDay.day)} on ${text(latestDay.node_id)}; ${numberText(latestDay.snapshot_count, 0)} status snapshots.`
    : "Status rollups loaded; open Performance for full tables and exports.";
  const activityStatus = totalRejects || totalAlerts
    ? "bad"
    : totalFills
      ? "ok"
      : totalOrders ? "warn" : "warn";
  const tiles = [
    {
      label: "Today",
      value: pctText(latestDay && latestDay.daily_return_pct),
      detail: latestDay ? `${money(latestDay.start_equity)} to ${money(latestDay.end_equity)} on ${text(latestDay.day)}.` : "No latest day row.",
      className: rollupReturnClass(latestDay && latestDay.daily_return_pct),
    },
    {
      label: "Month",
      value: pctText(latestMonth && latestMonth.total_return_pct),
      detail: latestMonth ? `${text(latestMonth.label)} / ${numberText(latestMonth.day_count, 0)} day${latestMonth.day_count === 1 ? "" : "s"}.` : "No monthly rollup yet.",
      className: rollupReturnClass(latestMonth && latestMonth.total_return_pct),
    },
    {
      label: "Year",
      value: pctText(latestYear && latestYear.total_return_pct),
      detail: latestYear ? `${text(latestYear.label)} / ${numberText(latestYear.day_count, 0)} day${latestYear.day_count === 1 ? "" : "s"}.` : "No yearly rollup yet.",
      className: rollupReturnClass(latestYear && latestYear.total_return_pct),
    },
    {
      label: "All Available",
      value: pctText(seriesStats.total_return_pct),
      detail: `${text(seriesStats.first_day)} to ${text(seriesStats.last_day)}.`,
      className: rollupReturnClass(seriesStats.total_return_pct),
    },
    {
      label: "Max Drawdown",
      value: pctText(seriesStats.max_drawdown_pct),
      detail: "Derived from status-history end-of-day equity.",
      className: drawdownClass(seriesStats.max_drawdown_pct),
    },
    {
      label: "Activity",
      value: `${numberText(totalFills, 0)} fills`,
      detail: `${numberText(totalOrders, 0)} orders / ${numberText(totalRejects, 0)} rejects / ${numberText(totalAlerts, 0)} alerts.`,
      className: statusClass(activityStatus),
    },
  ];
  $("overview-performance-tiles").innerHTML = tiles.map((tile) => `
    <div class="status-tile">
      <span>${escapeHtml(tile.label)}</span>
      <strong class="${tile.className}">${escapeHtml(tile.value)}</strong>
      <small>${escapeHtml(tile.detail)}</small>
    </div>
  `).join("");
  $("overview-performance-chart").innerHTML = statusRollupReturnChart(rollups);
}

function renderOverview() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const runMetrics = (latestRun && latestRun.metrics) || {};
  const performance = latestArtifactPerformance();
  const perf = performance.performance || {};
  const summary = performance.summary || {};
  const accountRows = performance.account || [];
  const latestAccount = latestAccountRow(accountRows);
  const equity = perf.final_equity ?? summary.final_equity ?? runMetrics.final_equity;
  const cash = latestAccount.cash ?? summary.final_cash ?? runMetrics.final_cash;
  const realizedPnl = latestAccount.realized_pnl ?? perf.realized_pnl ?? summary.realized_pnl ?? runMetrics.realized_pnl;
  const unrealizedPnl = latestAccount.unrealized_pnl ?? perf.unrealized_pnl ?? summary.unrealized_pnl ?? runMetrics.unrealized_pnl;
  const mode = perf.mode ?? summary.mode ?? runMetrics.mode;
  const todayWindow = performancePeriodWindow(accountRows, "today");
  const weekWindow = performancePeriodWindow(accountRows, "week");
  const todayPerf = performanceFromAccountRows(rowsInWindow(accountRows, todayWindow));
  const weekPerf = performanceFromAccountRows(rowsInWindow(accountRows, weekWindow));
  const exposurePct = perf.max_gross_exposure_pct ?? summary.max_gross_exposure_pct ?? runMetrics.max_gross_exposure_pct;
  const nextCheck = firstPresent(
    runMetrics.next_decision_time,
    runMetrics.next_expected_decision_time,
    runMetrics.next_check_time,
    runMetrics.next_signal_time,
  );
  const events = runEventRows();
  const latestSignal = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");
  const latestRejection = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const latestBarTime = metricTimestamp(runMetrics, [
    "latest_data_time",
    "latest_market_data_time",
    "latest_bar_time",
    "last_bar_time",
    "market_data_time",
  ]);
  const statusMeta = payload.generated_at ? `status updated ${shortTimestampAgeLabel(payload.generated_at)}` : "status not published";
  const sourceMeta = sourceMetaLabel(performance, latestAccount);
  const accountMeta = latestAccount.timestamp
    ? `account snapshot ${shortTimestampAgeLabel(latestAccount.timestamp)}`
    : sourceMeta;
  const todayRows = rowsInWindow(accountRows, todayWindow);
  const weekRows = rowsInWindow(accountRows, weekWindow);
  const todayMeta = todayRows.length ? `${todayWindow.label} / ${numberText(todayRows.length, 0)} account snapshots` : `${todayWindow.label} / no account snapshots`;
  const weekMeta = weekRows.length ? `${weekWindow.label} / ${numberText(weekRows.length, 0)} account snapshots` : `${weekWindow.label} / no account snapshots`;

  $("overview-equity").textContent = money(equity);
  $("overview-equity").className = "value-equity";
  $("overview-subtitle").textContent = sourceMeta;
  renderStrategyIdentity("overview-strategy-identity", performance);
  setMetricValue("overview-mode", text(mode), {
    className: statusClass(mode ? "ok" : "unknown"),
    meta: sourceMeta,
  });
  setMetricValue("overview-gateway", gateway.enabled ? text(gateway.reachable) : "disabled", {
    className: statusClass(gateway.enabled ? gateway.reachable : "warn"),
    meta: statusMeta,
  });
  setMetricValue("overview-latest-signal", latestSignal ? text(latestSignal.symbol) : "n/a", {
    className: statusClass(latestSignal ? "ok" : "warn"),
    meta: latestSignal ? `decision ${shortTimestampAgeLabel(latestSignal.timestamp)}` : "no decision event",
  });
  setMetricValue("overview-latest-bar", latestBarTime ? timestampAgeLabel(latestBarTime) : "n/a", {
    className: statusClass(latestBarTime ? "ok" : "warn"),
    meta: latestBarTime ? `market data ${text(latestBarTime)}` : "runner has not published latest bar time",
  });
  setMetricValue("overview-latest-fill", latestFill ? text(latestFill.symbol) : "n/a", {
    className: statusClass(latestFill ? "ok" : "warn"),
    meta: latestFill ? `fill ${shortTimestampAgeLabel(latestFill.timestamp)}` : "no fill event",
  });
  setMetricValue("overview-latest-rejection", latestRejection ? text(latestRejection.symbol) : "none", {
    className: statusClass(latestRejection ? "bad" : "ok"),
    meta: latestRejection ? `${text(latestRejection.status)} ${shortTimestampAgeLabel(latestRejection.timestamp)}` : "no rejected/canceled order event",
  });
  setMetricValue("overview-cash", money(cash), { className: "value-cash", meta: accountMeta });
  setMetricValue("overview-realized-pnl", money(realizedPnl), {
    className: signedValueClass(realizedPnl),
    meta: accountMeta,
  });
  setMetricValue("overview-unrealized-pnl", money(unrealizedPnl), {
    className: signedValueClass(unrealizedPnl),
    meta: accountMeta,
  });
  setMetricValue("overview-today-return", pctText(todayPerf.total_return_pct), {
    className: signedValueClass(todayPerf.total_return_pct),
    meta: todayMeta,
  });
  setMetricValue("overview-week-return", pctText(weekPerf.total_return_pct), {
    className: signedValueClass(weekPerf.total_return_pct),
    meta: weekMeta,
  });
  setMetricValue("overview-exposure", pctText(exposurePct), {
    className: statusClass(exposurePct == null ? "" : exposurePct ? "warn" : "ok"),
    meta: sourceMeta,
  });
  setMetricValue("overview-next-check", nextCheck ? text(nextCheck) : "n/a", {
    className: statusClass(nextCheck ? "ok" : "warn"),
    meta: latestRun ? `runner ${text(latestRun.id)}` : "no current runner",
  });
  renderOverviewPerformanceSnapshot();
  renderOverviewGlance();
  renderOverviewWorkflowLauncher();
  renderOverviewSessionState();
  renderRuntimeStatus();
  renderOverviewHealth();
  renderOverviewAlerts();
  renderOverviewOrders();
  renderOverviewPositions();
  renderOverviewTimeline();
}

function overviewGlanceModel() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const runs = payload.runs || [];
  const alerts = payload.alerts || [];
  const health = overviewHealthChecks();
  const badHealth = health.filter((item) => item.status === "bad");
  const warnHealth = health.filter((item) => item.status === "warn");
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");
  const latestRejectedOrder = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const openOrders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const positions = nonzeroPositionsFromSource(source);
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const fetchManifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const performance = latestArtifactPerformance();
  const accountRows = performance.account || [];
  const todayWindow = performancePeriodWindow(accountRows, "today");
  const todayRows = rowsInWindow(accountRows, todayWindow);
  const todayPerf = performanceFromAccountRows(todayRows);
  const gatewayOk = !gateway.enabled || gateway.reachable === true;
  const hasCurrentTelemetry = Boolean(payload.generated_at && runs.length);
  let status = "bad";
  let title = "Connect Telemetry";
  let summary = "No current run is publishing status. Start the local publisher or open Operations to inspect service state.";
  let primary = { label: "Operations", target: "operations" };
  let secondary = { label: "Help", target: "help" };

  if (hasCurrentTelemetry) {
    status = "ok";
    title = "Monitoring";
    summary = latestDecision
      ? `Latest decision: ${text(latestDecision.symbol)} ${shortTimestampAgeLabel(latestDecision.timestamp)}.`
      : "A run is publishing, but no recent decision event is visible.";
    primary = { label: "Performance", target: "performance" };
    secondary = { label: "Runs", target: "runs" };
  }
  if (datasets.length === 0 && !hasCurrentTelemetry) {
    status = "bad";
    title = "Add Data Roots";
    summary = "No saved historical data is visible, so replay and benchmark workflows will be limited.";
    primary = { label: "Data Library", target: "data" };
    secondary = { label: "Fetch Jobs", target: "fetch" };
  }
  if (badHealth.length) {
    status = "bad";
    title = badHealth[0].label;
    summary = badHealth[0].detail;
    primary = badHealth[0].label === "Saved Data" ? { label: "Data Library", target: "data" } : { label: "Operations", target: "operations" };
    secondary = { label: "Help", target: "help" };
  } else if (!gatewayOk) {
    status = "bad";
    title = "Gateway Down";
    summary = "Gateway/API checks are enabled but not reachable.";
    primary = { label: "Operations", target: "operations" };
    secondary = { label: "Help", target: "help" };
  } else if (alerts.length) {
    status = "warn";
    title = "Review Alerts";
    summary = `${numberText(alerts.length, 0)} current alert${alerts.length === 1 ? "" : "s"} published.`;
    primary = { label: "Operations", target: "operations" };
    secondary = { label: "Runs", target: "runs" };
  } else if (latestRejectedOrder) {
    status = "bad";
    title = "Order Issue";
    summary = `${text(latestRejectedOrder.symbol)} ${text(latestRejectedOrder.status)} ${shortTimestampAgeLabel(latestRejectedOrder.timestamp)}.`;
    primary = { label: "Runs", target: "runs" };
    secondary = { label: "Operations", target: "operations" };
  } else if (openOrders.length) {
    status = "warn";
    title = "Open Orders";
    summary = `${numberText(openOrders.length, 0)} non-terminal order event${openOrders.length === 1 ? "" : "s"} need broker/account review.`;
    primary = { label: "Runs", target: "runs" };
    secondary = { label: "Operations", target: "operations" };
  } else if (positions.length) {
    status = "warn";
    title = "Positions Open";
    summary = `${positions.slice(0, 3).map((position) => position.symbol).join(", ")}${positions.length > 3 ? "..." : ""} open from the current account source.`;
    primary = { label: "Performance", target: "performance" };
    secondary = { label: "Runs", target: "runs" };
  } else if (hasCurrentTelemetry && !latestDecision) {
    status = "warn";
    title = "Awaiting Signal";
    summary = "The run is publishing, but no latest decision is visible yet.";
    primary = { label: "Runs", target: "runs" };
    secondary = { label: "Operations", target: "operations" };
  } else if (warnHealth.length) {
    status = "warn";
    title = warnHealth[0].label;
    summary = warnHealth[0].detail;
  } else if (latestFill) {
    status = "ok";
    title = "Filled Today";
    summary = `${text(latestFill.symbol)} filled ${shortTimestampAgeLabel(latestFill.timestamp)}.`;
  }

  const cards = [
    {
      label: "Telemetry",
      value: payload.generated_at ? shortTimestampAgeLabel(payload.generated_at) : "missing",
      status: payload.generated_at ? "ok" : "bad",
      detail: runs.length ? `${numberText(runs.length, 0)} published run${runs.length === 1 ? "" : "s"}` : "No current run list.",
    },
    {
      label: "Today Return",
      value: pctText(todayPerf.total_return_pct),
      status: todayPerf.total_return_pct == null ? "warn" : todayPerf.total_return_pct >= 0 ? "ok" : "bad",
      detail: todayRows.length ? `${numberText(todayRows.length, 0)} account snapshots` : "No current-day account path.",
    },
    {
      label: "Trade State",
      value: openOrders.length ? `${numberText(openOrders.length, 0)} open` : positions.length ? `${numberText(positions.length, 0)} pos` : latestFill ? "filled" : latestDecision ? "checked" : "quiet",
      status: latestRejectedOrder ? "bad" : openOrders.length || positions.length ? "warn" : latestDecision || latestFill ? "ok" : hasCurrentTelemetry ? "warn" : "bad",
      detail: latestRejectedOrder
        ? `${text(latestRejectedOrder.symbol)} ${text(latestRejectedOrder.status)}`
        : latestDecision
          ? `${text(latestDecision.symbol)} ${shortTimestampAgeLabel(latestDecision.timestamp)}`
          : "No recent decision/order/fill event.",
    },
    {
      label: "Saved Data",
      value: numberText(datasets.length, 0),
      status: datasets.length > 2 ? "ok" : datasets.length ? "warn" : "bad",
      detail: fetchManifests.length
        ? `${numberText(fetchManifests.length, 0)} fetch manifest${fetchManifests.length === 1 ? "" : "s"} visible`
        : "No fetch manifests loaded.",
    },
  ];

  return { status, title, summary, primary, secondary, cards };
}

function renderOverviewGlance() {
  if (!$("overview-glance-title") || !$("overview-glance-cards")) return;
  const model = overviewGlanceModel();
  $("overview-glance-note").textContent = model.status === "ok"
    ? "Current public telemetry looks usable"
    : model.status === "warn"
      ? "Usable with items to inspect"
      : "Needs attention before trusting the run";
  $("overview-glance-title").textContent = model.title;
  $("overview-glance-title").className = statusClass(model.status);
  $("overview-glance-summary").textContent = model.summary;
  const primary = $("overview-glance-primary");
  const secondary = $("overview-glance-secondary");
  if (primary) {
    primary.textContent = model.primary.label;
    primary.dataset.viewTarget = model.primary.target;
  }
  if (secondary) {
    secondary.textContent = model.secondary.label;
    secondary.dataset.viewTarget = model.secondary.target;
  }
  $("overview-glance-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
}

function workflowHref(target, lens = "") {
  const view = normalizeView(target || "overview");
  return lens ? `#${view}/${encodeURIComponent(lens)}` : `#${view}`;
}

function overviewWorkflowCards() {
  const payload = state.status || {};
  const runs = payload.runs || [];
  const events = runEventRows();
  const openOrders = currentOpenOrderRows();
  const latestRejectedOrder = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const source = latestArtifactPerformance();
  const accountRows = source.account || [];
  const rollups = sortedStatusRollups();
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const fetchManifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const workbenchRuns = (state.configRuns && state.configRuns.runs) || [];
  const draftRows = (state.configDrafts && state.configDrafts.drafts) || [];
  const health = overviewHealthChecks();
  const badHealth = health.filter((item) => item.status === "bad");
  const warnHealth = health.filter((item) => item.status === "warn");
  const glance = overviewGlanceModel();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");
  const positions = nonzeroPositionsFromSource(source);
  const performanceReady = accountRows.length || rollups.length;
  const runReady = events.length || runs.length || workbenchRuns.length;
  const setupStatus = badHealth.length ? "bad" : warnHealth.length ? "warn" : "ok";

  return [
    {
      label: "Monitor Today",
      title: glance.title,
      value: payload.generated_at ? shortTimestampAgeLabel(payload.generated_at) : "missing",
      status: glance.status,
      detail: glance.summary,
      href: workflowHref(glance.primary.target, glance.primary.lens || ""),
      cta: glance.primary.label,
    },
    {
      label: "Review Performance",
      title: performanceReady ? "Results Available" : "No Result Path",
      value: accountRows.length ? `${numberText(accountRows.length, 0)} snapshots` : rollups.length ? `${numberText(rollups.length, 0)} day rows` : "empty",
      status: performanceReady ? "ok" : runs.length ? "warn" : "bad",
      detail: performanceReady
        ? "Open the portfolio-first performance page for returns, drawdown, trades, and rollups."
        : runs.length
          ? "A run is publishing, but account/performance snapshots are not visible yet."
          : "No current or archived performance source is loaded.",
      href: workflowHref("performance", "home"),
      cta: "Open Performance",
    },
    {
      label: "Browse Saved Data",
      title: datasets.length ? "Data Library Ready" : "No Data Visible",
      value: `${numberText(datasets.length, 0)} files`,
      status: datasets.length > 2 ? "ok" : datasets.length ? "warn" : "bad",
      detail: fetchManifests.length
        ? `${numberText(fetchManifests.length, 0)} fetch manifest${fetchManifests.length === 1 ? "" : "s"} are also visible.`
        : "Use Data Library to see configured roots, suggested roots, symbols, charts, and missing-file diagnostics.",
      href: workflowHref("data", datasets.length ? "browse" : "diagnostics"),
      cta: datasets.length ? "Browse Data" : "Fix Data Roots",
    },
    {
      label: "Build And Simulate",
      title: datasets.length ? "Workbench Available" : "Needs Data",
      value: draftRows.length ? `${numberText(draftRows.length, 0)} drafts` : "no drafts",
      status: datasets.length ? draftRows.length ? "ok" : "warn" : "bad",
      detail: datasets.length
        ? "Select scanned files, preview timestamp alignment, generate a public-safe draft, then run validation or replay."
        : "The workbench needs saved datasets before it can build a useful replay or simulated-paper config.",
      href: workflowHref("workbench", datasets.length ? "builder" : "home"),
      cta: "Open Workbench",
    },
    {
      label: "Inspect Runs And Orders",
      title: latestRejectedOrder ? "Order Issue" : openOrders.length ? "Open Orders" : runReady ? "Run Evidence" : "No Runs Yet",
      value: events.length ? `${numberText(events.length, 0)} events` : runs.length ? `${numberText(runs.length, 0)} runs` : "empty",
      status: latestRejectedOrder ? "bad" : openOrders.length ? "warn" : runReady ? "ok" : "bad",
      detail: latestRejectedOrder
        ? `${text(latestRejectedOrder.symbol)} ${text(latestRejectedOrder.status)} needs review.`
        : latestFill
          ? `${text(latestFill.symbol)} fill is visible; inspect timeline and artifacts.`
          : latestDecision
            ? `${text(latestDecision.symbol)} decision is visible; inspect order/fill context.`
            : "Use Runs for current account boundary, orders, fills, rejects, events, and artifacts.",
      href: workflowHref("runs", openOrders.length || positions.length ? "state" : "runs"),
      cta: "Open Runs",
    },
    {
      label: "Fix Setup",
      title: badHealth.length ? badHealth[0].label : warnHealth.length ? warnHealth[0].label : "Setup Looks Clean",
      value: badHealth.length ? `${numberText(badHealth.length, 0)} blockers` : warnHealth.length ? `${numberText(warnHealth.length, 0)} warnings` : "clean",
      status: setupStatus,
      detail: badHealth.length
        ? badHealth[0].detail
        : warnHealth.length
          ? warnHealth[0].detail
          : "No current overview health blockers. Use Operations for Gateway, supervisors, remote nodes, and command audit.",
      href: workflowHref(setupStatus === "ok" ? "operations" : "help", setupStatus === "ok" ? "paper" : "workflows"),
      cta: setupStatus === "ok" ? "Open Operations" : "Open Guide",
    },
  ];
}

function renderOverviewWorkflowLauncher() {
  if (!$("overview-workflow-grid") || !$("overview-workflow-note")) return;
  const cards = overviewWorkflowCards();
  const badCount = cards.filter((card) => card.status === "bad").length;
  const warnCount = cards.filter((card) => card.status === "warn").length;
  $("overview-workflow-note").textContent = badCount
    ? `${numberText(badCount, 0)} workflow${badCount === 1 ? "" : "s"} blocked or empty`
    : warnCount
      ? `${numberText(warnCount, 0)} workflow${warnCount === 1 ? "" : "s"} need review`
      : "Core workflows have usable public-safe evidence";
  $("overview-workflow-grid").innerHTML = cards.map((card) => `
    <a class="action-card workflow-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <div class="workflow-card-foot">
        <em>${escapeHtml(card.value)}</em>
        <b>${escapeHtml(card.cta)}</b>
      </div>
    </a>
  `).join("");
}

function utcDayKey(value) {
  const millis = timestampMillis(value);
  if (millis === null) return "";
  return new Date(millis).toISOString().slice(0, 10);
}

function overviewReferenceTime(events, payload) {
  const candidates = [
    payload && payload.generated_at,
    ...events.map((event) => event.timestamp),
  ].map(timestampMillis).filter((value) => value !== null);
  return candidates.length ? new Date(Math.max(...candidates)).toISOString() : null;
}

function eventSummary(events, type) {
  const rows = (events || []).filter((event) => event.type === type);
  return {
    count: rows.length,
    latest: rows[0] || null,
  };
}

function renderOverviewSessionState() {
  if (!$("overview-session-state-cards") || !$("overview-session-state-note")) return;
  const payload = state.status || {};
  const runs = payload.runs || [];
  const events = runEventRows();
  const reference = overviewReferenceTime(events, payload);
  const day = utcDayKey(reference);
  const dayEvents = day ? events.filter((event) => utcDayKey(event.timestamp) === day) : [];
  const decisions = eventSummary(dayEvents, "decision");
  const orders = eventSummary(dayEvents, "order");
  const fills = eventSummary(dayEvents, "fill");
  const rejections = eventSummary(dayEvents.filter(eventStatusIsBad), "order");
  let stateLabel = "No Current Run";
  let stateStatus = "bad";
  let stateNote = "No runner telemetry is publishing into the dashboard.";
  if (runs.length && !decisions.count) {
    stateLabel = "Awaiting Check";
    stateStatus = "warn";
    stateNote = "A run is publishing, but no decision event is visible for the current UTC day.";
  } else if (decisions.count && !orders.count && !fills.count) {
    stateLabel = "No Trade Today";
    stateStatus = "ok";
    stateNote = decisions.latest
      ? `Latest checked ${text(decisions.latest.symbol)}: ${text(decisions.latest.detail)}.`
      : "Decision events were published without order or fill activity.";
  } else if (fills.count) {
    stateLabel = "Filled Today";
    stateStatus = rejections.count ? "warn" : "ok";
    stateNote = `${numberText(fills.count, 0)} fill${fills.count === 1 ? "" : "s"} from ${numberText(orders.count, 0)} order event${orders.count === 1 ? "" : "s"}.`;
  } else if (orders.count) {
    stateLabel = rejections.count ? "Order Issue" : "Order Submitted";
    stateStatus = rejections.count ? "bad" : "warn";
    stateNote = rejections.count
      ? `${numberText(rejections.count, 0)} rejected/canceled order event${rejections.count === 1 ? "" : "s"} today.`
      : "Orders were submitted today, but no fill event is visible yet.";
  }
  $("overview-session-state-note").textContent = day
    ? `${day} UTC / ${numberText(dayEvents.length, 0)} current-day event${dayEvents.length === 1 ? "" : "s"}`
    : "No current-session reference time loaded";
  const cards = [
    {
      status: stateStatus,
      label: "State",
      title: stateLabel,
      note: stateNote,
    },
    {
      status: decisions.count ? "ok" : runs.length ? "warn" : "bad",
      label: "Latest Check",
      title: decisions.latest ? text(decisions.latest.symbol || "checked") : "n/a",
      note: decisions.latest
        ? `${text(decisions.latest.timestamp)} / ${text(decisions.latest.detail)}`
        : runs.length ? "No decision event for the current UTC day." : "No run is publishing decisions.",
    },
    {
      status: orders.count ? rejections.count ? "bad" : "warn" : decisions.count ? "ok" : "warn",
      label: "Orders",
      title: numberText(orders.count, 0),
      note: orders.latest
        ? `${text(orders.latest.symbol)} ${text(orders.latest.status)} ${shortTimestampAgeLabel(orders.latest.timestamp)}.`
        : "No current-day order events.",
    },
    {
      status: fills.count ? "ok" : orders.count ? "warn" : "ok",
      label: "Fills",
      title: numberText(fills.count, 0),
      note: fills.latest
        ? `${text(fills.latest.symbol)} filled ${shortTimestampAgeLabel(fills.latest.timestamp)}.`
        : "No current-day fill events.",
    },
  ];
  $("overview-session-state-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderRuntimeStatus() {
  const items = runtimeStatusItems();
  const badCount = items.filter((item) => item.status === "bad").length;
  const warnCount = items.filter((item) => item.status === "warn").length;
  $("runtime-status-note").textContent = badCount
    ? `${badCount} missing or bad runtime signal${badCount === 1 ? "" : "s"}`
    : warnCount
      ? `${warnCount} runtime warning${warnCount === 1 ? "" : "s"}`
      : "Runtime telemetry looks current";
  $("runtime-status-grid").innerHTML = items.map((item) => `
    <div class="runtime-status-card">
      <span>${escapeHtml(item.label)}</span>
      <strong class="${statusClass(item.status)}">${escapeHtml(item.value)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </div>
  `).join("");
}

function renderOverviewHealth() {
  const checks = overviewHealthChecks();
  const badCount = checks.filter((item) => item.status === "bad").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;
  $("overview-health-note").textContent = badCount
    ? `${badCount} blocker${badCount === 1 ? "" : "s"} / ${warnCount} warning${warnCount === 1 ? "" : "s"}`
    : warnCount
      ? `${warnCount} warning${warnCount === 1 ? "" : "s"}`
      : "All visible checks are ok";
  $("overview-health-grid").innerHTML = checks.map((item) => `
    <div class="health-card">
      <span>${statusText(item.status)}</span>
      <strong>${escapeHtml(item.label)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </div>
  `).join("");
  $("overview-checklist-note").textContent = "Concrete next checks";
  $("overview-checklist").innerHTML = checks.map((item) => `
    <div class="check-item ${statusClass(item.status)}">
      <span>${escapeHtml(item.status)}</span>
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </div>
    </div>
  `).join("");
}

function renderOverviewPositions() {
  const source = latestArtifactPerformance();
  const accountRow = latestAccountRow(source.account || []);
  const positions = nonzeroPositionsFromSource(source);
  $("overview-positions-note").textContent = source.account && source.account.length
    ? `Snapshot ${text(accountRow.timestamp)}`
    : "Using latest available summary";
  $("overview-positions-grid").innerHTML = positions.length
    ? positions.map((item) => `
        <div class="position-card">
          <span>Symbol</span>
          <strong>${escapeHtml(item.symbol)}</strong>
          ${positionDetailHtml(item)}
        </div>
      `).join("")
    : `<div class="empty-card"><strong>No open positions</strong><span>The latest selected or published run is flat, or no account snapshot has been loaded.</span></div>`;
}

function renderOverviewOrders() {
  const orders = currentOpenOrderRows().slice(0, 5);
  $("overview-orders-note").textContent = orders.length
    ? `${numberText(orders.length, 0)} current non-terminal order event${orders.length === 1 ? "" : "s"}`
    : "No current non-terminal order telemetry";
  $("overview-orders-body").innerHTML = orders.length
    ? orders.map((orderItem) => row([
        escapeHtml(orderItem.timestamp),
        escapeHtml(orderItem.run_id),
        statusText(orderItem.status),
        escapeHtml(orderItem.symbol),
        escapeHtml(orderItem.side),
        escapeHtml(orderItem.quantity ?? orderItem.cash_quantity ?? ""),
        escapeHtml([orderItem.reason, orderItem.tag].filter(Boolean).join(" / ")),
      ])).join("")
    : row([`<span class="muted">No current open-order telemetry. Broker-native open orders require runners to publish open-order state.</span>`, "", "", "", "", "", ""]);
}

function renderOverviewAlerts() {
  const alerts = ((state.status && state.status.alerts) || []).slice(0, 6);
  $("overview-alerts-note").textContent = alerts.length
    ? `${numberText(alerts.length, 0)} current alert${alerts.length === 1 ? "" : "s"}`
    : "No current alerts";
  $("overview-alerts-body").innerHTML = alerts.length
    ? alerts.map((alert) => row([
        statusText(alert.level === "warn" ? "warn" : alert.level),
        escapeHtml(alert.kind),
        escapeHtml(alert.message),
      ])).join("")
    : row([`<span class="muted">No stale-data, stale-account, gateway, rejection, or risk alerts are currently published.</span>`, "", ""]);
}

function renderOverviewTimeline() {
  const allEvents = runEventRows();
  const reference = overviewReferenceTime(allEvents, state.status || {});
  const day = utcDayKey(reference);
  const dayEvents = day ? allEvents.filter((event) => utcDayKey(event.timestamp) === day) : [];
  const events = (dayEvents.length ? dayEvents : allEvents).slice(0, 12);
  $("overview-timeline-note").textContent = dayEvents.length
    ? `${day} UTC / ${numberText(dayEvents.length, 0)} current-day event${dayEvents.length === 1 ? "" : "s"}`
    : allEvents.length
      ? `No current-day events; showing ${numberText(events.length, 0)} latest recent event${events.length === 1 ? "" : "s"}`
      : "No recent telemetry events";
  $("overview-timeline-body").innerHTML = events.length
    ? events.map((event) => row([
        escapeHtml(event.timestamp),
        escapeHtml(event.run_id),
        escapeHtml(event.type),
        statusText(event.status),
        escapeHtml(event.symbol),
        escapeHtml(event.detail),
      ])).join("")
    : row([`<span class="muted">No signals, orders, or fills have been published for the current telemetry day.</span>`, "", "", "", "", ""]);
}

function renderMetrics() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const runs = payload.runs || [];
  const supervisors = payload.supervisors || [];
  const remote = payload.remote_control || {};
  const alerts = payload.alerts || [];
  const history = state.history || [];
  $("subtitle").textContent = `${text(payload.node_id)} - ${text(payload.generated_at)}`;
  $("metric-status").textContent = text(payload.status);
  $("metric-status").className = statusClass(payload.status);
  $("metric-gateway").textContent = gateway.enabled ? text(gateway.reachable) : "disabled";
  $("metric-gateway").className = statusClass(gateway.reachable);
  $("metric-runs").textContent = String(runs.length);
  $("metric-supervisors").textContent = String(supervisors.length);
  $("metric-supervisors").className = supervisors.some((item) => item.status && item.status !== "ok") ? "status-warn" : "status-ok";
  const latestRemote = remote.latest_event || {};
  const latestRemoteResult = latestRemote.result || {};
  const latestRemotePost = latestRemoteResult.post_result || {};
  const remoteBad = latestRemote.event === "poll_failed" || latestRemoteResult.status === "failed" || latestRemoteResult.status === "rejected" || latestRemotePost.status === "failed";
  $("metric-remote").textContent = remote.enabled ? (remote.audit_exists ? "audit" : "empty") : "off";
  $("metric-remote").className = remoteBad ? "status-warn" : "status-ok";
  $("metric-alerts").textContent = String(alerts.length);
  $("metric-alerts").className = alerts.length ? "status-warn" : "status-ok";
  $("metric-history").textContent = String(history.length);
  $("metric-data").textContent = String((state.dataCatalog.datasets || []).length);
  $("command-node").value = payload.node_id || $("command-node").value || "example-local-trader";
  if (supervisors.length && !$("command-supervisor").value) {
    $("command-supervisor").value = supervisors[0].id || "";
  }
}

function renderPerformance() {
  $("performance-source-mode").value = state.performanceSourceMode || "current";
  renderPerformanceBenchmarkOptions();
  const source = latestArtifactPerformance();
  const perf = source.performance || {};
  const summary = source.summary || {};
  const allAccountRows = source.account || [];
  const period = $("performance-period").value || "all";
  const window = performancePeriodWindow(allAccountRows, period);
  const accountRows = period === "all" ? allAccountRows : rowsInWindow(allAccountRows, window);
  const periodPerf = Object.keys(perf).length && period === "all"
    ? perf
    : performanceFromAccountRows(accountRows);
  const fills = period === "all" ? (source.fills || []) : rowsInWindow(source.fills || [], window);
  const ledger = buildTradeLedger(fills);
  const equity = periodPerf.final_equity ?? summary.final_equity;
  const latestAccount = latestAccountRow(accountRows.length ? accountRows : (source.account || []));
  const mode = perf.mode ?? summary.mode;
  const initialEquity = periodPerf.initial_equity ?? (period === "all" ? (perf.initial_equity ?? summary.initial_equity) : null);
  const turnover = turnoverStats(fills, initialEquity);
  const positionCount = nonzeroPositionsFromSource(source).length;
  const decisions = summary.decisions ?? (source.decisions || []).length;
  const orders = summary.orders ?? (source.orders || []).length;
  const fillCount = summary.fills ?? (source.fills || []).length;
  const rejections = summary.rejections ?? summary.rejects ?? 0;
  const approvalRequired = summary.approval_required_orders ?? perf.approval_required_orders ?? 0;
  const loopIterations = summary.loop_iterations ?? perf.loop_iterations ?? 0;
  const sessionIdleIterations = summary.session_idle_iterations ?? perf.session_idle_iterations ?? 0;
  const elapsedDays = periodPerf.elapsed_days ?? (period === "all" ? (perf.elapsed_days ?? summary.elapsed_days) : null);
  const realizedPnl = latestAccount.realized_pnl ?? perf.realized_pnl ?? summary.realized_pnl;
  const unrealizedPnl = latestAccount.unrealized_pnl ?? perf.unrealized_pnl ?? summary.unrealized_pnl;
  const totalPnl = latestAccount.total_pnl ?? perf.total_pnl ?? summary.total_pnl;
  const totalCommission = latestAccount.total_commission ?? perf.total_commission ?? summary.total_commission;
  const totalBorrowFees = latestAccount.total_borrow_fees ?? perf.total_borrow_fees ?? summary.total_borrow_fees;
  const sourceMeta = sourceMetaLabel(source, latestAccount);
  const windowMeta = `${window.label} / ${accountRows.length ? `${numberText(accountRows.length, 0)} account snapshots` : "no account snapshots"}`;
  const fillsMeta = `${window.label} / ${numberText(fills.length, 0)} fills`;
  const tradeMeta = ledger.stats.closed_count
    ? `${numberText(ledger.stats.closed_count, 0)} closed trades from fills`
    : fillsMeta;
  renderPerformanceTriage({
    source,
    window,
    accountRows,
    allAccountRows,
    periodPerf,
    fills,
    ledger,
    mode,
    latestAccount,
    decisions,
    orders,
    fillCount,
    rejections,
    approvalRequired,
  });
  renderPerformanceHome({
    source,
    window,
    accountRows,
    allAccountRows,
    periodPerf,
    fills,
    ledger,
    mode,
    latestAccount,
    decisions,
    orders,
    fillCount,
    rejections,
    approvalRequired,
  });
  renderPerformanceLivePeriodSummary();
  renderPerformanceStory({
    source,
    window,
    accountRows,
    periodPerf,
    fills,
    ledger,
    latestAccount,
    decisions,
    orders,
    fillCount,
    rejections,
    approvalRequired,
  });
  $("performance-note").textContent = `${source.label} / ${window.label}`;
  setMetricValue("performance-equity", money(equity), { className: "value-equity", meta: sourceMeta });
  $("performance-context").textContent = accountRows.length
    ? `${numberText(accountRows.length, 0)} account snapshots in selected period; latest ${shortTimestampAgeLabel(latestAccount.timestamp)}.`
    : "Showing latest summarized run; select Artifacts for an equity curve.";
  setMetricValue("performance-source", source.label, {
    className: statusClass(source.has_data ? "ok" : "warn"),
    meta: sourceMeta,
  });
  setMetricValue("performance-mode", text(mode), {
    className: statusClass(mode ? "ok" : "unknown"),
    meta: sourceMeta,
  });
  setMetricValue("performance-latest-account", text(latestAccount.timestamp), {
    className: statusClass(latestAccount.timestamp ? "ok" : "warn"),
    meta: latestAccount.timestamp ? `updated ${shortTimestampAgeLabel(latestAccount.timestamp)}` : "no account snapshot",
  });
  setMetricValue("performance-position-count", numberText(positionCount, 0), { meta: sourceMeta });
  setMetricValue("performance-activity", `${numberText(decisions, 0)}D / ${numberText(orders, 0)}O / ${numberText(fillCount, 0)}F / ${numberText(rejections, 0)}R / ${numberText(approvalRequired, 0)}A`, {
    meta: sourceMeta,
  });
  setMetricValue("performance-return", pctText(periodPerf.total_return_pct ?? (period === "all" ? summary.total_return_pct : null)), {
    className: signedValueClass(periodPerf.total_return_pct ?? (period === "all" ? summary.total_return_pct : null)),
    meta: windowMeta,
  });
  setMetricValue("performance-drawdown", pctText(periodPerf.max_drawdown_pct ?? (period === "all" ? summary.max_drawdown_pct : null)), {
    className: drawdownValueClass(periodPerf.max_drawdown_pct ?? (period === "all" ? summary.max_drawdown_pct : null)),
    meta: windowMeta,
  });
  setMetricValue("performance-return-day", pctText(periodPerf.return_per_day_pct ?? (period === "all" ? summary.return_per_day_pct : null)), {
    className: signedValueClass(periodPerf.return_per_day_pct ?? (period === "all" ? summary.return_per_day_pct : null)),
    meta: windowMeta,
  });
  setMetricValue("performance-exposure", pctText(periodPerf.max_gross_exposure_pct ?? (period === "all" ? summary.max_gross_exposure_pct : null)), {
    meta: windowMeta,
  });
  setMetricValue("performance-win-loss", ledger.stats.closed_count ? `${numberText(ledger.stats.wins, 0)}W / ${numberText(ledger.stats.losses, 0)}L` : "n/a", {
    meta: tradeMeta,
  });
  setMetricValue("performance-profit-factor", Number.isFinite(ledger.stats.profit_factor)
    ? numberText(ledger.stats.profit_factor, 2)
    : ledger.stats.profit_factor === Infinity ? "inf" : "n/a", {
    meta: tradeMeta,
  });
  setMetricValue("performance-avg-win-loss", ledger.stats.closed_count ? `${money(ledger.stats.avg_win)} / ${money(ledger.stats.avg_loss)}` : "n/a", {
    meta: tradeMeta,
  });
  setMetricValue("performance-turnover", turnover.pct !== null ? pctText(turnover.pct) : "n/a", {
    meta: fillsMeta,
  });
  const projectionWarning = Boolean(periodPerf.short_horizon_projection ?? perf.short_horizon_projection ?? summary.short_horizon_projection);
  $("performance-context-note").innerHTML = projectionWarning
    ? `<span class="status-warn">Short-horizon annualized stats</span>`
    : "How to read the selected performance window";
  const contextPairs = [
    ["Metric Source", sourceMeaning(source)],
    ["Mode Meaning", modeMeaning(mode)],
    ["Selected Window", `${window.label}; ${accountRows.length ? `${numberText(accountRows.length, 0)} account snapshots` : "no account snapshots"}`],
    ["Elapsed", elapsedDays !== null && elapsedDays !== undefined ? `${numberText(elapsedDays, 4)} days` : "n/a"],
    ["Turnover Basis", `${money(turnover.notional)} filled notional${turnover.pct !== null ? ` / ${money(initialEquity)} initial equity` : "; initial equity unavailable"}`],
    ["Accounting PnL", `Realized ${money(realizedPnl)} / Unrealized ${money(unrealizedPnl)} / Total ${money(totalPnl)}`],
    ["Costs", `Commission ${money(totalCommission)} / Borrow ${money(totalBorrowFees)}`],
    ["Approval Holds", numberText(approvalRequired, 0)],
    ["Loop", summary.loop_enabled ? `${numberText(loopIterations, 0)} iterations` : "one-shot"],
    ["Lifecycle", summary.stopped_by_control ? `stopped by ${text(summary.stop_marker)}` : "running/complete"],
    ["Session", summary.session_enabled ? `${text(summary.session_status)} / idle ${numberText(sessionIdleIterations, 0)}` : "unrestricted"],
    ["Projection Caveat", projectionCaveat(periodPerf, summary, elapsedDays)],
    ["Annualized Scale", `Day ${pctText(periodPerf.return_per_day_pct ?? (period === "all" ? summary.return_per_day_pct : null))} / Month ${pctText(periodPerf.return_per_month_pct ?? (period === "all" ? summary.return_per_month_pct : null))} / Year ${pctText(periodPerf.return_per_year_pct ?? (period === "all" ? summary.return_per_year_pct : null))}`],
  ];
  $("performance-metric-context").innerHTML = contextPairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  const sessionRows = latestSessionAccountRows(allAccountRows);
  const sessionStats = intradayPnlStats(sessionRows);
  $("performance-intraday-note").textContent = sessionStats
    ? `${sessionStats.day} ${text(sessionStats.start_time)} -> ${text(sessionStats.end_time)}`
    : "Load account snapshots to see today's or the latest session's PnL";
  $("performance-intraday-pnl").textContent = sessionStats ? money(sessionStats.pnl) : "n/a";
  $("performance-intraday-pnl").className = sessionStats ? signedValueClass(sessionStats.pnl) : "value-neutral";
  $("performance-intraday-return").textContent = sessionStats ? pctText(sessionStats.return_pct) : "n/a";
  $("performance-intraday-return").className = sessionStats ? signedValueClass(sessionStats.return_pct) : "value-neutral";
  $("performance-intraday-range").textContent = sessionStats
    ? `${money(sessionStats.high_pnl)} / ${money(sessionStats.low_pnl)}`
    : "n/a";
  $("performance-intraday-snapshots").textContent = sessionStats ? numberText(sessionStats.count, 0) : "n/a";
  $("performance-intraday-chart").innerHTML = intradayPnlChart(sessionRows);
  $("performance-equity-chart").innerHTML = equityChart(accountRows);
  $("performance-benchmark-chart").innerHTML = benchmarkOverlayChart(accountRows, state.performanceBenchmarkDetail);
  $("performance-benchmark-note").textContent = state.performanceBenchmarkDetail && state.performanceBenchmarkDetail.path
    ? `${text(state.performanceBenchmarkDetail.symbol)} ${text(state.performanceBenchmarkDetail.bar_size)} from ${text(state.performanceBenchmarkDetail.path)}`
    : "Choose a saved dataset to compare normalized returns.";
  $("performance-drawdown-chart").innerHTML = drawdownChart(accountRows);
  $("performance-daily-return-chart").innerHTML = dailyReturnChart(accountRows);
  $("performance-calendar-chart").innerHTML = calendarReturnHeatmap(accountRows);
  $("performance-drawdown-note").textContent = accountRows.length
    ? "Computed from account equity snapshots"
    : "Load archived artifacts for drawdown curve";
  $("performance-daily-note").textContent = accountRows.length
    ? "Computed from first/last equity by date"
    : "Load archived artifacts for daily bars";
  $("performance-calendar-note").textContent = accountRows.length
    ? "Green/red daily return cells"
    : "Load archived artifacts for calendar view";
  const shownTradeRows = renderPerformanceTradeControls(ledger);
  renderPerformanceTradeAssistant(ledger, shownTradeRows, fills);
  $("performance-trade-note").textContent = fills.length
    ? `${numberText(ledger.stats.closed_count, 0)} closed / ${numberText(ledger.stats.open_count, 0)} open from ${numberText(fills.length, 0)} fills; ${numberText(shownTradeRows.length, 0)} shown`
    : "Load artifacts with fills for trade rows";
  $("performance-trades-body").innerHTML = shownTradeRows.length
    ? shownTradeRows.slice(0, 40).map((trade) => row([
        escapeHtml(trade.symbol),
        statusText(trade.state === "closed" ? "ok" : "warn"),
        escapeHtml(trade.side),
        numberText(trade.quantity, 4),
        `${escapeHtml(text(trade.entry_time))}<br>${escapeHtml(money(trade.entry_price))}`,
        trade.exit_time ? `${escapeHtml(text(trade.exit_time))}<br>${escapeHtml(money(trade.exit_price))}` : `<span class="muted">open</span>`,
        trade.pnl === null ? "n/a" : signedValueHtml(trade.pnl, money),
        escapeHtml(holdDurationLabel(trade.entry_time, trade.exit_time || new Date().toISOString())),
      ])).join("")
    : row([`<span class="muted">${ledger.rows.length ? "No trades match the active filters" : "No fills in selected period"}</span>`, "", "", "", "", "", "", ""]);

  const runs = ((state.runComparison && state.runComparison.runs) || []).slice(0, 12);
  $("performance-runs-body").innerHTML = runs.length
    ? runs.map((runItem) => row([
        escapeHtml(runItem.finished_at),
        escapeHtml(runItem.draft_id),
        escapeHtml(runItem.action),
        statusText(runItem.status),
        pctText(runItem.total_return_pct),
        pctText(runItem.max_drawdown_pct),
        pctText(runItem.return_per_day_pct),
        escapeHtml(runItem.fills),
        escapeHtml(runItem.rejections),
      ])).join("")
    : row([`<span class="muted">No saved runs yet</span>`, "", "", "", "", "", "", "", ""]);
}

function performanceRiskStatus(drawdownPct, exposurePct) {
  const drawdown = finiteNumber(drawdownPct);
  const exposure = finiteNumber(exposurePct);
  if (drawdown === null && exposure === null) return "bad";
  const drawdownAbs = drawdown === null ? 0 : Math.abs(drawdown);
  if (drawdownAbs >= 20 || (exposure !== null && exposure >= 150)) return "bad";
  if (drawdownAbs >= 8 || (exposure !== null && exposure >= 100)) return "warn";
  return "ok";
}

function renderPerformanceStory(context) {
  if (!$("performance-story-cards") || !$("performance-story-note")) return;
  const {
    source,
    window,
    accountRows,
    periodPerf,
    fills,
    ledger,
    latestAccount,
    decisions,
    orders,
    fillCount,
    rejections,
    approvalRequired,
  } = context;
  const totalReturn = finiteNumber(periodPerf.total_return_pct);
  const drawdown = finiteNumber(periodPerf.max_drawdown_pct);
  const exposure = finiteNumber(periodPerf.max_gross_exposure_pct);
  const elapsedDays = finiteNumber(periodPerf.elapsed_days);
  const hasBenchmark = Boolean((state.performanceBenchmarkDetail || {}).path);
  const hasAccount = accountRows.length > 0;
  const hasExecutionIssue = Number(rejections || 0) > 0 || Number(approvalRequired || 0) > 0;
  const hasActivity = Number(decisions || 0) || Number(orders || 0) || Number(fillCount || 0);
  const outcomeStatus = totalReturn === null
    ? source.has_data ? "warn" : "bad"
    : totalReturn >= 0 ? "ok" : "warn";
  const evidenceStatus = !source.has_data
    ? "bad"
    : hasAccount && fills.length && ledger.stats.closed_count ? "ok"
      : hasAccount || fills.length || hasActivity ? "warn" : "bad";
  const trustStatus = hasExecutionIssue
    ? "bad"
    : latestAccount.timestamp ? "ok" : source.has_data ? "warn" : "bad";
  let nextTitle = "Load Performance";
  let nextNote = "Publish telemetry, run a replay, or open saved artifacts before interpreting results.";
  if (source.has_data && !hasAccount) {
    nextTitle = "Open Richer Source";
    nextNote = "This source is summary-only for the selected period; load artifacts or switch to All for curves and PnL.";
  } else if (hasExecutionIssue) {
    nextTitle = "Inspect Execution";
    nextNote = "Rejected orders or approval holds can make headline returns misleading; open Runs before evaluating quality.";
  } else if (source.has_data && !hasBenchmark) {
    nextTitle = "Add Benchmark";
    nextNote = "Load a saved benchmark dataset to compare normalized strategy return against the market context.";
  } else if (source.has_data) {
    nextTitle = "Read Charts";
    nextNote = "Outcome, drawdown, execution, and benchmark context are ready for this selected window.";
  }
  const cards = [
    {
      status: outcomeStatus,
      label: "Outcome",
      title: totalReturn === null ? "No return yet" : pctText(totalReturn),
      note: `${window.label}; final equity ${money(periodPerf.final_equity)} over ${elapsedDays === null ? "n/a" : `${numberText(elapsedDays, 3)} day${elapsedDays === 1 ? "" : "s"}`}.`,
    },
    {
      status: performanceRiskStatus(drawdown, exposure),
      label: "Risk",
      title: `DD ${pctText(drawdown)}`,
      note: `Max exposure ${pctText(exposure)}; drawdown/exposure are computed from selected account snapshots when available.`,
    },
    {
      status: evidenceStatus,
      label: "Evidence",
      title: hasAccount ? `${numberText(accountRows.length, 0)} snapshots` : "Summary only",
      note: `${numberText(fills.length, 0)} fills / ${numberText(ledger.stats.closed_count, 0)} closed trades / ${numberText(decisions, 0)} decisions.`,
    },
    {
      status: trustStatus,
      label: "Operational Trust",
      title: hasExecutionIssue ? "Review needed" : latestAccount.timestamp ? "Fresh enough" : "No account timestamp",
      note: `${numberText(rejections, 0)} rejects / ${numberText(approvalRequired, 0)} approval holds; latest account ${latestAccount.timestamp ? shortTimestampAgeLabel(latestAccount.timestamp) : "n/a"}.`,
    },
    {
      status: source.has_data && !hasExecutionIssue ? (hasBenchmark ? "ok" : "warn") : "bad",
      label: "Next Read",
      title: nextTitle,
      note: nextNote,
    },
  ];
  $("performance-story-note").textContent = `${text(source.label)} interpreted for ${window.label}`;
  $("performance-story-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderPerformanceTriage(context) {
  if (!$("performance-triage-cards") || !$("performance-triage-note")) return;
  const {
    source,
    window,
    accountRows,
    allAccountRows,
    periodPerf,
    fills,
    ledger,
    mode,
    latestAccount,
    decisions,
    orders,
    fillCount,
    rejections,
    approvalRequired,
  } = context;
  const statusRollups = (state.statusEquityRollups && state.statusEquityRollups.rollups) || [];
  const periodRollups = (state.statusEquityRollups && state.statusEquityRollups.period_rollups) || {};
  const monthRollups = periodRollups.month || [];
  const yearRollups = periodRollups.year || [];
  const benchmark = state.performanceBenchmarkDetail || {};
  const hasBenchmark = Boolean(benchmark.path);
  const hasArtifactDepth = Boolean((source.account || []).length || (source.fills || []).length || (source.orders || []).length || (source.decisions || []).length);
  const sourceStatus = source.has_data ? (hasArtifactDepth ? "ok" : "warn") : "bad";
  const windowStatus = accountRows.length ? "ok" : source.has_data ? "warn" : "bad";
  const executionStatus = rejections > 0 || approvalRequired > 0
    ? "warn"
    : fillCount > 0
      ? "ok"
      : decisions || orders ? "warn" : "bad";
  let nextStatus = "bad";
  let nextTitle = "Load Source";
  let nextNote = "Publish telemetry, run a Workbench config, or open a saved artifact.";
  if (source.has_data && !accountRows.length && !hasArtifactDepth) {
    nextStatus = "warn";
    nextTitle = "Open Artifact";
    nextNote = "Current source has summary metrics only; open artifacts for equity curves, drawdown, fills, and trade rows.";
  } else if (source.has_data && !accountRows.length) {
    nextStatus = "warn";
    nextTitle = "Change Period";
    nextNote = "Selected period has no account snapshots; switch to All or load a run with snapshots in this window.";
  } else if (rejections > 0 || approvalRequired > 0) {
    nextStatus = "warn";
    nextTitle = "Review Execution";
    nextNote = "Rejected orders or approval holds are present; inspect Runs before trusting performance.";
  } else if (source.has_data && !hasBenchmark) {
    nextStatus = "warn";
    nextTitle = "Add Benchmark";
    nextNote = "Optional: load a saved benchmark dataset to compare normalized returns.";
  } else if (source.has_data) {
    nextStatus = "ok";
    nextTitle = "Review Charts";
    nextNote = "Equity, drawdown, daily return, trade, and rollup detail are ready for this source.";
  }
  const totalReturn = Number(periodPerf.total_return_pct);
  const returnStatus = Number.isFinite(totalReturn)
    ? totalReturn >= 0 ? "ok" : "warn"
    : windowStatus;
  const cards = [
    {
      status: sourceStatus,
      title: text(source.label),
      label: "Source",
      note: hasArtifactDepth
        ? `${text(source.source_type)} with account/fill/order detail.`
        : source.has_data
          ? `${text(source.source_type)} summary-only source.`
          : "No current telemetry, artifact, or saved run summary loaded.",
    },
    {
      status: windowStatus,
      title: window.label,
      label: "Period",
      note: `${numberText(accountRows.length, 0)} selected account snapshots / ${numberText((allAccountRows || []).length, 0)} total.`,
    },
    {
      status: returnStatus,
      title: pctText(periodPerf.total_return_pct),
      label: "Return",
      note: `Drawdown ${pctText(periodPerf.max_drawdown_pct)} / elapsed ${numberText(periodPerf.elapsed_days, 4)} days.`,
    },
    {
      status: executionStatus,
      title: `${numberText(fillCount, 0)} fills / ${numberText(rejections, 0)} rejects`,
      label: "Execution",
      note: `${numberText(decisions, 0)} decisions / ${numberText(orders, 0)} orders / ${numberText(approvalRequired, 0)} approval holds.`,
    },
    {
      status: ledger.stats.closed_count ? "ok" : fills.length ? "warn" : "bad",
      title: `${numberText(ledger.stats.closed_count, 0)} closed`,
      label: "Trades",
      note: ledger.stats.closed_count
        ? `${numberText(ledger.stats.wins, 0)} wins / ${numberText(ledger.stats.losses, 0)} losses / profit factor ${Number.isFinite(ledger.stats.profit_factor) ? numberText(ledger.stats.profit_factor, 2) : ledger.stats.profit_factor === Infinity ? "inf" : "n/a"}.`
        : fills.length ? "Fills exist but trade pairing has open/unclosed rows." : "Load artifact fills to derive trade stats.",
    },
    {
      status: statusRollups.length ? "ok" : "warn",
      title: numberText(statusRollups.length, 0),
      label: "Live/Paper Rollups",
      note: statusRollups.length
        ? `${numberText(monthRollups.length, 0)} month rows / ${numberText(yearRollups.length, 0)} year rows from status history.`
        : "No status-history equity rollups loaded.",
    },
    {
      status: hasBenchmark ? "ok" : source.has_data ? "warn" : "bad",
      title: hasBenchmark ? text(benchmark.symbol) : "None",
      label: "Benchmark",
      note: hasBenchmark
        ? `${text(benchmark.bar_size)} from ${text(benchmark.source)}.`
        : "Optional normalized saved-data overlay is not loaded.",
    },
    {
      status: latestAccount.timestamp ? "ok" : source.has_data ? "warn" : "bad",
      title: mode ? text(mode) : "Unknown",
      label: "Account Freshness",
      note: latestAccount.timestamp
        ? `Latest account ${shortTimestampAgeLabel(latestAccount.timestamp)}.`
        : "No account snapshot timestamp for the selected source.",
    },
    {
      status: nextStatus,
      title: nextTitle,
      label: "Next Action",
      note: nextNote,
    },
  ];
  $("performance-triage-note").textContent = `${text(source.label)} / ${text(mode)} / ${numberText(accountRows.length, 0)} account snapshots / ${numberText(fills.length, 0)} fills`;
  $("performance-triage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderPerformanceHome(context) {
  if (!$("performance-home-result") || !$("performance-home-note") || !$("performance-home-tiles")) return;
  const {
    source,
    window,
    accountRows,
    allAccountRows,
    periodPerf,
    fills,
    ledger,
    mode,
    latestAccount,
    decisions,
    orders,
    fillCount,
    rejections,
    approvalRequired,
  } = context;
  const benchmark = state.performanceBenchmarkDetail || {};
  const totalReturn = Number(periodPerf.total_return_pct);
  const returnClass = Number.isFinite(totalReturn)
    ? signedValueClass(totalReturn)
    : "value-neutral";
  const result = source.has_data
    ? `${pctText(periodPerf.total_return_pct)} / ${money(periodPerf.final_equity)}`
    : "No performance data";
  let nextNote = "Publish telemetry, run a Workbench config, or open a saved artifact from Runs.";
  if (source.has_data && !accountRows.length) {
    nextNote = "Selected source lacks account snapshots for this period; switch period or open a richer artifact.";
  } else if (rejections > 0 || approvalRequired > 0) {
    nextNote = "Execution needs review: rejected orders or approval holds are present.";
  } else if (source.has_data && !benchmark.path) {
    nextNote = "Performance is readable; optionally load a saved benchmark dataset for context.";
  } else if (source.has_data) {
    nextNote = "Charts, trade rows, rollups, and source context are ready for inspection.";
  }
  $("performance-home-result").textContent = result;
  $("performance-home-result").className = returnClass;
  $("performance-home-note").textContent = `${text(source.label)} / ${text(mode)} / ${window.label}. ${nextNote}`;
  renderStrategyIdentity("performance-strategy-identity", source);
  const executionStatus = rejections > 0 || approvalRequired > 0
    ? "warn"
    : fillCount > 0
      ? "ok"
      : decisions || orders ? "warn" : "bad";
  const freshnessStatus = latestAccount.timestamp ? "ok" : source.has_data ? "warn" : "bad";
  const tradeStatus = ledger.stats.closed_count ? "ok" : fills.length ? "warn" : "bad";
  const tiles = [
    {
      status: source.has_data ? "ok" : "bad",
      label: "Source",
      value: text(source.source_type || source.label),
      detail: source.has_data ? text(source.label) : "No current or saved run selected.",
    },
    {
      status: accountRows.length ? "ok" : source.has_data ? "warn" : "bad",
      label: "Window",
      value: window.label,
      detail: `${numberText(accountRows.length, 0)} account snapshots.`,
    },
    {
      status: executionStatus,
      label: "Execution",
      value: `${numberText(fillCount, 0)} fills`,
      detail: `${numberText(decisions, 0)} decisions / ${numberText(orders, 0)} orders / ${numberText(rejections, 0)} rejects / ${numberText(approvalRequired, 0)} approvals.`,
    },
    {
      status: tradeStatus,
      label: "Trades",
      value: `${numberText(ledger.stats.closed_count, 0)} closed`,
      detail: ledger.stats.closed_count
        ? `${numberText(ledger.stats.wins, 0)} wins / ${numberText(ledger.stats.losses, 0)} losses.`
        : fills.length ? "Fills exist but paired trade rows remain open." : "No fills for trade stats.",
    },
    {
      status: freshnessStatus,
      label: "Freshness",
      value: latestAccount.timestamp ? shortTimestampAgeLabel(latestAccount.timestamp) : "n/a",
      detail: latestAccount.timestamp ? text(latestAccount.timestamp) : "No account snapshot timestamp.",
    },
    {
      status: benchmark.path ? "ok" : source.has_data ? "warn" : "bad",
      label: "Benchmark",
      value: benchmark.path ? text(benchmark.symbol) : "None",
      detail: benchmark.path ? `${text(benchmark.bar_size)} ${text(benchmark.source)}` : "Optional saved-data overlay not loaded.",
    },
  ];
  $("performance-home-tiles").innerHTML = tiles.map((tile) => `
    <div class="status-tile">
      <span>${escapeHtml(tile.label)}</span>
      <strong class="${statusClass(tile.status)}">${escapeHtml(tile.value)}</strong>
      <small>${escapeHtml(tile.detail)}</small>
    </div>
  `).join("");
  renderPerformanceWorkflowLauncher({ ...context, allAccountRows });
}

function performanceWorkflowCards(context) {
  const {
    source,
    window,
    accountRows,
    allAccountRows,
    periodPerf,
    fills,
    ledger,
    latestAccount,
    decisions,
    orders,
    fillCount,
    rejections,
    approvalRequired,
  } = context;
  const benchmark = state.performanceBenchmarkDetail || {};
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const statusRollups = (state.statusEquityRollups && state.statusEquityRollups.rollups) || [];
  const runRollups = (state.performanceRollups && state.performanceRollups.rollups) || [];
  const sessionRows = latestSessionAccountRows(allAccountRows || accountRows || []);
  const sessionStats = intradayPnlStats(sessionRows);
  const maxDrawdown = Number(periodPerf.max_drawdown_pct);
  const exposure = Number(periodPerf.max_gross_exposure_pct);
  const executionIssueCount = Number(rejections || 0) + Number(approvalRequired || 0);
  const hasRollups = statusRollups.length || runRollups.length;
  const hasTradeEvidence = fills.length || ledger.stats.closed_count || ledger.stats.open_count;
  const sourceHasSnapshots = accountRows.length || (allAccountRows || []).length;
  const sourceEvidence = source.has_data
    ? sourceHasSnapshots ? "account path" : decisions || orders || fillCount ? "activity only" : "summary only"
    : "missing";
  return [
    {
      label: "Check Today",
      title: sessionStats ? pctText(sessionStats.return_pct) : "No Session",
      value: sessionStats ? money(sessionStats.pnl) : "n/a",
      status: sessionStats ? sessionStats.return_pct >= 0 ? "ok" : "bad" : source.has_data ? "warn" : "bad",
      detail: sessionStats
        ? `${numberText(sessionStats.count, 0)} latest-session snapshots from ${text(sessionStats.day)}.`
        : "Need current or archived account snapshots for today's/latest-session PnL.",
      href: workflowHref("performance", "home"),
      cta: "Session",
    },
    {
      label: "Review Risk",
      title: Number.isFinite(maxDrawdown) ? pctText(maxDrawdown) : "No Drawdown",
      value: Number.isFinite(exposure) ? pctText(exposure) : "exposure n/a",
      status: !source.has_data ? "bad" : Number.isFinite(maxDrawdown) && maxDrawdown <= -10 ? "bad" : Number.isFinite(maxDrawdown) && maxDrawdown < 0 ? "warn" : "ok",
      detail: accountRows.length
        ? `${window.label}: drawdown and exposure are derived from account snapshots.`
        : "Load account artifacts for drawdown, exposure, and daily-return context.",
      href: workflowHref("performance", "home"),
      cta: "Risk",
    },
    {
      label: "Inspect Trades",
      title: ledger.stats.closed_count ? `${numberText(ledger.stats.closed_count, 0)} closed` : fills.length ? `${numberText(fills.length, 0)} fills` : "No Trades",
      value: ledger.stats.closed_count ? `${numberText(ledger.stats.wins, 0)}W/${numberText(ledger.stats.losses, 0)}L` : `${numberText(rejections, 0)} rejects`,
      status: executionIssueCount ? "warn" : hasTradeEvidence ? "ok" : source.has_data ? "warn" : "bad",
      detail: executionIssueCount
        ? `${numberText(rejections, 0)} rejects and ${numberText(approvalRequired, 0)} approval holds need review.`
        : hasTradeEvidence ? "Open the trade lens for paired fills, open positions, win/loss, and filters." : "No fills are available for trade pairing.",
      href: workflowHref("performance", "trades"),
      cta: "Trades",
    },
    {
      label: "Open Rollups",
      title: hasRollups ? `${numberText(statusRollups.length + runRollups.length, 0)} rows` : "No Rollups",
      value: statusRollups.length ? "live/paper" : runRollups.length ? "archived" : "empty",
      status: hasRollups ? "ok" : source.has_data ? "warn" : "bad",
      detail: hasRollups
        ? "Review daily, monthly, yearly, live/paper, and archived account-equity summaries."
        : "Rollups need status history or archived account artifacts.",
      href: workflowHref("performance", "rollups"),
      cta: "Rollups",
    },
    {
      label: "Compare Benchmark",
      title: benchmark.path ? text(benchmark.symbol) : "No Benchmark",
      value: benchmark.path ? text(benchmark.bar_size) : `${numberText(datasets.length, 0)} datasets`,
      status: benchmark.path ? "ok" : datasets.length && source.has_data ? "warn" : "bad",
      detail: benchmark.path
        ? "Benchmark overlay is loaded against the selected strategy equity path."
        : datasets.length ? "Choose a saved Data Library file to overlay normalized benchmark returns." : "No saved datasets are available for benchmark overlay.",
      href: workflowHref(benchmark.path ? "performance" : "data", benchmark.path ? "home" : "browse"),
      cta: benchmark.path ? "Overlay" : "Pick Data",
    },
    {
      label: "Verify Source",
      title: sourceHasSnapshots ? "Snapshot Path" : source.has_data ? "Limited Source" : "No Source",
      value: sourceEvidence,
      status: sourceHasSnapshots ? "ok" : source.has_data ? "warn" : "bad",
      detail: latestAccount && latestAccount.timestamp
        ? `Latest account snapshot ${shortTimestampAgeLabel(latestAccount.timestamp)}.`
        : "Open diagnostics or Runs to verify whether this is current telemetry, summary-only data, or an artifact.",
      href: workflowHref(source.has_data ? "runs" : "workbench", source.has_data ? "runs" : "home"),
      cta: source.has_data ? "Runs" : "Workbench",
    },
  ];
}

function renderPerformanceWorkflowLauncher(context) {
  const container = $("performance-workflows");
  if (!container) return;
  const cards = performanceWorkflowCards(context);
  container.innerHTML = cards.map((card) => `
    <a class="action-card workflow-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <div class="workflow-card-foot">
        <em>${escapeHtml(card.value)}</em>
        <b>${escapeHtml(card.cta)}</b>
      </div>
    </a>
  `).join("");
}

function renderPerformanceRollups() {
  const payload = state.performanceRollups || {};
  const rollups = payload.rollups || [];
  renderPerformanceRollupAssistant();
  $("performance-rollups-note").textContent = payload.generated_at
    ? `${numberText(rollups.length, 0)} shown / ${numberText(payload.total || rollups.length, 0)} total day rows`
    : "No daily rollups loaded";
  $("performance-rollups-body").innerHTML = rollups.length
    ? rollups.map((item) => row([
        escapeHtml(item.day),
        escapeHtml(item.draft_id),
        `<span class="mono">${escapeHtml(item.run_id)}</span>`,
        escapeHtml(item.mode),
        signedValueHtml(item.daily_return_pct, pctText),
        equityValueHtml(item.start_equity),
        equityValueHtml(item.end_equity),
        escapeHtml(numberText(item.snapshot_count, 0)),
        escapeHtml(`${numberText(item.order_count, 0)}O / ${numberText(item.fill_count, 0)}F / ${numberText(item.rejection_count, 0)}R`),
        escapeHtml(pctText(item.max_gross_exposure_pct)),
        item.run_id
          ? `<button type="button" class="secondary inspect-run-artifacts" data-run-id="${escapeHtml(item.run_id)}">Artifacts</button>`
          : "",
      ])).join("")
    : row([`<span class="muted">No archived account artifacts have daily equity snapshots yet.</span>`, "", "", "", "", "", "", "", "", "", ""]);
}

function performancePeriodRows(payload = {}) {
  const periodRollups = payload.period_rollups || {};
  return [
    ...(periodRollups.month || []).map((item) => ({ ...item, periodLabel: `Month ${item.label}`, periodType: "month" })),
    ...(periodRollups.year || []).map((item) => ({ ...item, periodLabel: `Year ${item.label}`, periodType: "year" })),
  ];
}

function bestRollupRow(rows, key) {
  return (rows || [])
    .filter((item) => finiteNumber(item[key]) !== null)
    .sort((left, right) => Number(right[key]) - Number(left[key]))[0] || null;
}

function worstRollupRow(rows, key) {
  return (rows || [])
    .filter((item) => finiteNumber(item[key]) !== null)
    .sort((left, right) => Number(left[key]) - Number(right[key]))[0] || null;
}

function latestRollupRow(rows) {
  const copy = (rows || []).slice();
  copy.sort((left, right) => String(right.day || right.last_day || "").localeCompare(String(left.day || left.last_day || "")));
  return copy[0] || null;
}

function renderPerformanceRollupAssistant() {
  if (!$("performance-rollup-assistant-title") || !$("performance-rollup-assistant-cards") || !$("performance-rollup-assistant-actions")) return;
  const statusPayload = state.statusEquityRollups || {};
  const statusRows = statusPayload.rollups || [];
  const statusPeriodRows = performancePeriodRows(statusPayload);
  const runPayload = state.performanceRollups || {};
  const runRows = runPayload.rollups || [];
  const runPeriodRows = performancePeriodRows(runPayload);
  const hasStatus = Boolean(statusRows.length || statusPeriodRows.length);
  const hasArchived = Boolean(runRows.length || runPeriodRows.length);
  const latestStatus = latestRollupRow(statusRows);
  const latestRun = latestRollupRow(runRows);
  const bestStatus = bestRollupRow(statusRows, "daily_return_pct");
  const worstStatus = worstRollupRow(statusRows, "daily_return_pct");
  const bestPeriod = bestRollupRow([...statusPeriodRows, ...runPeriodRows], "total_return_pct");
  const alertCount = statusRows.reduce((sum, item) => sum + Number(item.alert_count || 0), 0);
  const rejectionCount = [...statusRows, ...runRows].reduce((sum, item) => sum + Number(item.rejection_count || 0), 0);
  let title = "No Rollups Loaded";
  let note = "Publish status snapshots during paper/live sessions or load saved run artifacts to populate rollups.";
  if (hasStatus) {
    title = "Live/Paper Rollups Available";
    note = latestStatus
      ? `Latest status day ${text(latestStatus.day)} returned ${pctText(latestStatus.daily_return_pct)} with ${numberText(latestStatus.snapshot_count, 0)} snapshots.`
      : "Status-history period summaries are available.";
  } else if (hasArchived) {
    title = "Archived Run Rollups Available";
    note = latestRun
      ? `Latest archived day ${text(latestRun.day)} returned ${pctText(latestRun.daily_return_pct)} from saved account artifacts.`
      : "Archived month/year summaries are available.";
  }
  if (alertCount || rejectionCount) {
    note += ` ${numberText(alertCount, 0)} status alert${alertCount === 1 ? "" : "s"} and ${numberText(rejectionCount, 0)} rejection${rejectionCount === 1 ? "" : "s"} need context.`;
  }
  $("performance-rollup-assistant-title").textContent = title;
  $("performance-rollup-assistant-note").textContent = note;
  const cards = [
    {
      status: hasStatus ? "ok" : "warn",
      label: "Status Days",
      title: numberText(statusRows.length, 0),
      note: latestStatus ? `${text(latestStatus.node_id)} / ${text(latestStatus.mode)} / ${text(latestStatus.day)}.` : "No paper/live status day rows.",
    },
    {
      status: hasArchived ? "ok" : "warn",
      label: "Archived Days",
      title: numberText(runRows.length, 0),
      note: latestRun ? `${text(latestRun.draft_id)} / ${text(latestRun.day)}.` : "No archived run day rows.",
    },
    {
      status: bestStatus ? "ok" : "warn",
      label: "Best Status Day",
      title: bestStatus ? pctText(bestStatus.daily_return_pct) : "n/a",
      note: bestStatus ? `${text(bestStatus.day)} / ${text(bestStatus.node_id)}.` : "Needs status-history day returns.",
    },
    {
      status: worstStatus ? Number(worstStatus.daily_return_pct) < 0 ? "bad" : "ok" : "warn",
      label: "Worst Status Day",
      title: worstStatus ? pctText(worstStatus.daily_return_pct) : "n/a",
      note: worstStatus ? `${text(worstStatus.day)} / ${text(worstStatus.node_id)}.` : "Needs status-history day returns.",
    },
    {
      status: bestPeriod ? "ok" : "warn",
      label: "Best Period",
      title: bestPeriod ? pctText(bestPeriod.total_return_pct) : "n/a",
      note: bestPeriod ? `${text(bestPeriod.periodLabel)} / ${rangeLabel(bestPeriod.first_day, bestPeriod.last_day)}.` : "No month/year summary rows.",
    },
  ];
  $("performance-rollup-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const actions = [
    {
      action: "status",
      title: "Review Status Days",
      note: hasStatus ? "Jump to live/paper status-history day rows." : "No status-history rows are loaded yet.",
      label: "Status",
      disabled: !statusRows.length,
    },
    {
      action: "periods",
      title: "Review Periods",
      note: statusPeriodRows.length || runPeriodRows.length ? "Jump to month/year summaries." : "No period summaries are loaded yet.",
      label: "Periods",
      disabled: !(statusPeriodRows.length || runPeriodRows.length),
    },
    {
      action: "archived",
      title: "Review Archived Runs",
      note: hasArchived ? "Jump to saved run daily rollups." : "No archived run daily rollups are loaded yet.",
      label: "Archived",
      disabled: !runRows.length,
    },
    {
      action: "export-status",
      title: "Export Status CSV",
      note: hasStatus ? "Download public-safe status day and period rows." : "Export an empty CSV template from the endpoint.",
      label: "Export",
      disabled: false,
    },
  ];
  $("performance-rollup-assistant-actions").innerHTML = actions.map((action) => `
    <button type="button" class="performance-rollup-assistant-action ${action.disabled ? "secondary" : ""}" data-performance-rollup-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.note)}</small>
      </span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

function handlePerformanceRollupAssistantAction(action) {
  if (action === "status") {
    $("performance-status-rollups-body").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Reviewing live/paper status day rollups";
    return;
  }
  if (action === "periods") {
    const statusPeriodRows = performancePeriodRows(state.statusEquityRollups || {});
    const target = statusPeriodRows.length ? "performance-status-period-rollups-body" : "performance-period-rollups-body";
    $(target).scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Reviewing performance period rollups";
    return;
  }
  if (action === "archived") {
    $("performance-rollups-body").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Reviewing archived run day rollups";
    return;
  }
  downloadStatusRollupsCsv().catch((err) => {
    $("last-refresh").textContent = `Status rollups CSV export failed: ${err.message}`;
  });
}

function renderStatusEquityRollups() {
  if (
    !$("performance-status-rollups-body")
    || !$("performance-status-rollups-note")
    || !$("performance-status-equity-chart")
    || !$("performance-status-equity-note")
    || !$("performance-status-return-chart")
    || !$("performance-status-return-note")
    || !$("performance-status-period-rollups-body")
    || !$("performance-status-period-rollups-note")
  ) return;
  const payload = state.statusEquityRollups || {};
  const rollups = payload.rollups || [];
  const periodRollups = payload.period_rollups || {};
  const periodRows = [
    ...(periodRollups.month || []).map((item) => ({ ...item, periodLabel: `Month ${item.label}` })),
    ...(periodRollups.year || []).map((item) => ({ ...item, periodLabel: `Year ${item.label}` })),
  ];
  $("performance-status-rollups-note").textContent = payload.generated_at
    ? `${numberText(rollups.length, 0)} shown / ${numberText(payload.total || rollups.length, 0)} status-history day rows from ${numberText(payload.history_scanned || 0, 0)} snapshots; O/F/R are max observed sanitized recent-event counts`
    : "No status-history rollups loaded";
  const statusNodeCount = new Set(rollups.map((item) => text(item.node_id))).size;
  $("performance-status-equity-note").textContent = rollups.length
    ? `${numberText(statusNodeCount, 0)} node${statusNodeCount === 1 ? "" : "s"} with end-of-day equity`
    : "Run the status publisher during paper/live sessions to populate this chart";
  $("performance-status-return-note").textContent = rollups.length
    ? "Daily status-history return bars; hover bars for day/node labels"
    : "Daily returns need at least one status-history equity day";
  $("performance-status-equity-chart").innerHTML = statusRollupEquityChart(rollups);
  $("performance-status-return-chart").innerHTML = statusRollupReturnChart(rollups);
  $("performance-status-rollups-body").innerHTML = rollups.length
    ? rollups.map((item) => row([
        escapeHtml(item.day),
        escapeHtml(item.node_id),
        escapeHtml(text(item.mode)),
        signedValueHtml(item.daily_return_pct, pctText),
        equityValueHtml(item.start_equity),
        equityValueHtml(item.end_equity),
        escapeHtml(numberText(item.snapshot_count, 0)),
        escapeHtml(`${numberText(item.order_count, 0)}O / ${numberText(item.fill_count, 0)}F / ${numberText(item.rejection_count, 0)}R`),
        escapeHtml(numberText(item.alert_count, 0)),
        statusText(item.gateway_reachable),
      ])).join("")
    : row([`<span class="muted">No status-history equity snapshots yet. Run the status publisher during paper/live sessions to populate this table.</span>`, "", "", "", "", "", "", "", "", ""]);
  $("performance-status-period-rollups-note").textContent = payload.generated_at
    ? `${numberText(periodRows.length, 0)} month/year summaries from status-history equity snapshots`
    : "No status-history period rollups loaded";
  $("performance-status-period-rollups-body").innerHTML = periodRows.length
    ? periodRows.map((item) => row([
        escapeHtml(item.periodLabel),
        escapeHtml(rangeLabel(item.first_day, item.last_day)),
        signedValueHtml(item.total_return_pct, pctText),
        equityValueHtml(item.start_equity),
        equityValueHtml(item.end_equity),
        escapeHtml(numberText(item.day_count, 0)),
        escapeHtml(numberText(item.node_count, 0)),
        escapeHtml(numberText(item.snapshot_count, 0)),
        escapeHtml(`${numberText(item.order_count, 0)}O / ${numberText(item.fill_count, 0)}F / ${numberText(item.rejection_count, 0)}R`),
        escapeHtml(numberText(item.alert_count, 0)),
      ])).join("")
    : row([`<span class="muted">No status-history month/year summaries yet.</span>`, "", "", "", "", "", "", "", "", ""]);
}

function renderPerformancePeriodRollups() {
  const payload = state.performanceRollups || {};
  const periodRollups = payload.period_rollups || {};
  const rows = [
    ...(periodRollups.month || []).map((item) => ({ ...item, periodLabel: `Month ${item.label}` })),
    ...(periodRollups.year || []).map((item) => ({ ...item, periodLabel: `Year ${item.label}` })),
  ];
  $("performance-period-rollups-note").textContent = payload.generated_at
    ? `${numberText(rows.length, 0)} month/year summaries from ${numberText(payload.total || 0, 0)} daily rows`
    : "No period rollups loaded";
  $("performance-period-rollups-body").innerHTML = rows.length
    ? rows.map((item) => row([
        escapeHtml(item.periodLabel),
        escapeHtml(rangeLabel(item.first_day, item.last_day)),
        signedValueHtml(item.total_return_pct, pctText),
        equityValueHtml(item.start_equity),
        equityValueHtml(item.end_equity),
        escapeHtml(numberText(item.day_count, 0)),
        escapeHtml(numberText(item.run_count, 0)),
        escapeHtml(`${numberText(item.order_count, 0)}O / ${numberText(item.fill_count, 0)}F / ${numberText(item.rejection_count, 0)}R`),
        escapeHtml(pctText(item.max_gross_exposure_pct)),
      ])).join("")
    : row([`<span class="muted">No month/year summaries yet.</span>`, "", "", "", "", "", "", "", ""]);
}

function rangeLabel(start, end) {
  if (!start && !end) return "n/a";
  return `${text(start)} -> ${text(end)}`;
}

function timezoneLabel(mode) {
  if (mode === "local") return "Local";
  if (mode === "eastern") return "Eastern";
  return "UTC";
}

function formatTimestampForMode(value, mode = "utc") {
  const millis = timestampMillis(value);
  if (millis === null) return text(value);
  const options = {
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
    timeZoneName: "short",
  };
  if (mode === "utc") options.timeZone = "UTC";
  if (mode === "eastern") options.timeZone = "America/New_York";
  return new Intl.DateTimeFormat("en-US", options).format(new Date(millis));
}

function timeRangeLabel(start, end, mode = "utc") {
  if (!start && !end) return "n/a";
  return `${formatTimestampForMode(start, mode)} -> ${formatTimestampForMode(end, mode)}`;
}

function miniChart(points) {
  if (!points || points.length < 2) return `<span class="muted">n/a</span>`;
  const closes = points.map((point) => Number(point.close)).filter((value) => Number.isFinite(value));
  if (closes.length < 2) return `<span class="muted">n/a</span>`;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const width = 180;
  const height = 46;
  const span = max - min || 1;
  const coords = closes.map((value, index) => {
    const x = closes.length === 1 ? 0 : (index / (closes.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = closes[closes.length - 1];
  const first = closes[0];
  const cls = last >= first ? "spark-good" : "spark-bad";
  return `<svg class="sparkline ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="close preview"><polyline points="${coords}"></polyline></svg>`;
}

function emptyChart(message) {
  return `<div class="chart-empty">${escapeHtml(message)}</div>`;
}

function compactDataPreviewChart(dataset) {
  const points = (dataset && dataset.preview) || [];
  const rows = points.map((point) => ({
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    close: Number(point.close),
    volume: Number(point.volume),
  })).filter((point) => point.millis !== null && Number.isFinite(point.close));
  if (rows.length < 2) {
    return `<div class="empty-card"><strong>No preview chart</strong><span>Open Data Detail to fetch a fresh sampled view for this saved file.</span></div>`;
  }
  const closes = rows.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const minTime = Math.min(...rows.map((point) => point.millis));
  const maxTime = Math.max(...rows.map((point) => point.millis));
  const width = 520;
  const priceHeight = 118;
  const volumeHeight = rows.some((point) => Number.isFinite(point.volume)) ? 28 : 0;
  const volumeGap = volumeHeight ? 10 : 0;
  const height = priceHeight + volumeGap + volumeHeight;
  const priceSpan = max - min || 1;
  const timeSpan = maxTime - minTime || 1;
  const xFor = (millis) => ((millis - minTime) / timeSpan) * width;
  const coords = rows.map((point) => {
    const x = xFor(point.millis);
    const y = priceHeight - ((point.close - min) / priceSpan) * priceHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const first = rows[0];
  const last = rows[rows.length - 1];
  const returnPct = first.close ? ((last.close - first.close) / first.close) : null;
  const cls = last.close >= first.close ? "spark-good" : "spark-bad";
  let volumeBars = "";
  const volumes = rows.map((point) => point.volume).filter((value) => Number.isFinite(value));
  if (volumes.length) {
    const maxVolume = Math.max(...volumes, 1);
    const barWidth = Math.max(1, width / rows.length);
    const baseY = priceHeight + volumeGap;
    volumeBars = rows.map((point) => {
      if (!Number.isFinite(point.volume)) return "";
      const x = Math.max(0, xFor(point.millis) - barWidth / 2);
      const barHeight = Math.max(1, (point.volume / maxVolume) * volumeHeight);
      const y = baseY + volumeHeight - barHeight;
      return `<rect class="volume-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"></rect>`;
    }).join("");
  }
  const caption = `${text(dataset.symbol)} ${text(dataset.bar_size)} best-file preview / ${numberText(rows.length, 0)} sampled points / ${pctText(returnPct)}`;
  return `
    <div class="symbol-profile-chart-head">
      <strong>${escapeHtml(text(dataset.symbol))} Preview</strong>
      <span>${escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp))} / ${escapeHtml(text(dataset.source))} / ${escapeHtml(text(dataset.quality_status))}/${escapeHtml(text(dataset.storage_contract_status))}</span>
    </div>
    <svg class="detail-chart symbol-profile-preview ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="selected symbol best-file price preview">
      <polyline points="${coords}"><title>${escapeHtml(caption)}</title></polyline>
      ${volumeBars}
    </svg>
    <span class="chart-caption">${escapeHtml(caption)}</span>
  `;
}

function gapMarkerBands(gaps, width, priceHeight, minTime, maxTime, timezoneMode = "utc") {
  const timeSpan = maxTime - minTime || 1;
  return visibleGapRows(gaps, minTime, maxTime).map((gap) => {
    const start = timestampMillis(gap.from_timestamp);
    const end = timestampMillis(gap.to_timestamp);
    const x1 = Math.max(0, ((start - minTime) / timeSpan) * width);
    const x2 = Math.min(width, ((end - minTime) / timeSpan) * width);
    const bandWidth = Math.max(2, x2 - x1);
    const label = `${formatTimestampForMode(gap.from_timestamp, timezoneMode)} -> ${formatTimestampForMode(gap.to_timestamp, timezoneMode)} gap ${interval(gap.gap_seconds)}`;
    return `<rect class="gap-marker-band" x="${x1.toFixed(1)}" y="0" width="${bandWidth.toFixed(1)}" height="${priceHeight.toFixed(1)}"><title>${escapeHtml(label)}</title></rect><line class="gap-marker-line" x1="${x2.toFixed(1)}" y1="0" x2="${x2.toFixed(1)}" y2="${priceHeight.toFixed(1)}"><title>${escapeHtml(label)}</title></line>`;
  }).join("");
}

function visibleGapRows(gaps, minTime, maxTime) {
  return (gaps || []).filter((gap) => {
    const start = timestampMillis(gap.from_timestamp);
    const end = timestampMillis(gap.to_timestamp);
    return start !== null && end !== null && end > minTime && start < maxTime;
  });
}

function gapMarkerLegend(gaps, minTime, maxTime, timezoneMode = "utc") {
  const rows = gaps || [];
  if (!rows.length) return "";
  const visible = visibleGapRows(rows, minTime, maxTime);
  const largest = visible.slice().sort((left, right) => (
    (finiteNumber(right.gap_seconds) ?? finiteNumber(right.estimated_missing_intervals) ?? 0)
    - (finiteNumber(left.gap_seconds) ?? finiteNumber(left.estimated_missing_intervals) ?? 0)
  ))[0];
  const visibleText = `${numberText(visible.length, 0)} of ${numberText(rows.length, 0)} returned gap${rows.length === 1 ? "" : "s"} visible`;
  const detailText = largest
    ? `Largest visible ${interval(largest.gap_seconds)} from ${formatTimestampForMode(largest.from_timestamp, timezoneMode)} to ${formatTimestampForMode(largest.to_timestamp, timezoneMode)}`
    : "Returned gaps are outside the current chart window";
  return `<div class="chart-legend gap-marker-legend"><span class="legend-item"><span class="gap-legend-swatch"></span>${escapeHtml(visibleText)}</span><span class="muted">${escapeHtml(detailText)}</span></div>`;
}

function detailChart(points, timezoneMode = "utc", gaps = []) {
  if (!points || points.length < 2) return emptyChart("No price preview available");
  const rows = points.map((point) => ({
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    close: Number(point.close),
    volume: Number(point.volume),
  })).filter((point) => point.millis !== null && Number.isFinite(point.close));
  if (rows.length < 2) return emptyChart("No price preview available");
  const closes = rows.map((point) => point.close);
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const minTime = Math.min(...rows.map((point) => point.millis));
  const maxTime = Math.max(...rows.map((point) => point.millis));
  const width = 720;
  const priceHeight = 160;
  const volumeHeight = rows.some((point) => Number.isFinite(point.volume)) ? 44 : 0;
  const volumeGap = volumeHeight ? 16 : 0;
  const height = priceHeight + volumeGap + volumeHeight;
  const span = max - min || 1;
  const timeSpan = maxTime - minTime || 1;
  const xFor = (millis) => ((millis - minTime) / timeSpan) * width;
  const coords = rows.map((point, index) => {
    const x = rows.length === 1 ? 0 : xFor(point.millis);
    const y = priceHeight - ((point.close - min) / span) * priceHeight;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = closes[closes.length - 1];
  const first = closes[0];
  const cls = last >= first ? "spark-good" : "spark-bad";
  let volumeBars = "";
  const volumes = rows.map((point) => point.volume).filter((value) => Number.isFinite(value));
  if (volumes.length) {
    const maxVolume = Math.max(...volumes, 1);
    const barWidth = Math.max(1, width / rows.length);
    const baseY = priceHeight + volumeGap;
    volumeBars = rows.map((point) => {
      if (!Number.isFinite(point.volume)) return "";
      const x = Math.max(0, xFor(point.millis) - barWidth / 2);
      const barHeight = Math.max(1, (point.volume / maxVolume) * volumeHeight);
      const y = baseY + volumeHeight - barHeight;
      return `<rect class="volume-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"><title>${escapeHtml(formatTimestampForMode(point.timestamp, timezoneMode))} volume ${escapeHtml(numberText(point.volume, 0))}</title></rect>`;
    }).join("");
  }
  const gapMarkers = gapMarkerBands(gaps, width, priceHeight, minTime, maxTime, timezoneMode);
  const gapLegend = gapMarkerLegend(gaps, minTime, maxTime, timezoneMode);
  const caption = `${formatTimestampForMode(rows[0].timestamp, timezoneMode)} close ${numberText(first)} | ${formatTimestampForMode(rows[rows.length - 1].timestamp, timezoneMode)} close ${numberText(last)}`;
  return `<svg class="detail-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="saved data price, gaps, and volume">${gapMarkers}<polyline points="${coords}"><title>${escapeHtml(caption)}</title></polyline>${volumeBars}</svg>${gapLegend}<span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function candlestickChart(points, timezoneMode = "utc", gaps = []) {
  if (!points || points.length < 2) return detailChart(points, timezoneMode, gaps);
  const rows = points.map((point) => ({
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    open: Number(point.open),
    high: Number(point.high),
    low: Number(point.low),
    close: Number(point.close),
    volume: Number(point.volume),
  })).filter((point) => (
    point.millis !== null
    && Number.isFinite(point.open)
    && Number.isFinite(point.high)
    && Number.isFinite(point.low)
    && Number.isFinite(point.close)
  ));
  if (rows.length < 2) return detailChart(points, timezoneMode, gaps);
  const lows = rows.map((point) => point.low);
  const highs = rows.map((point) => point.high);
  const min = Math.min(...lows);
  const max = Math.max(...highs);
  const minTime = Math.min(...rows.map((point) => point.millis));
  const maxTime = Math.max(...rows.map((point) => point.millis));
  const width = 720;
  const priceHeight = 170;
  const volumeHeight = rows.some((point) => Number.isFinite(point.volume)) ? 44 : 0;
  const volumeGap = volumeHeight ? 16 : 0;
  const height = priceHeight + volumeGap + volumeHeight;
  const span = max - min || 1;
  const timeSpan = maxTime - minTime || 1;
  const xFor = (millis) => ((millis - minTime) / timeSpan) * width;
  const xStep = rows.length === 1 ? width : width / (rows.length - 1);
  const candleWidth = Math.max(2, Math.min(10, xStep * 0.55));
  const yFor = (value) => priceHeight - ((value - min) / span) * priceHeight;
  const candles = rows.map((point, index) => {
    const x = rows.length === 1 ? width / 2 : xFor(point.millis);
    const openY = yFor(point.open);
    const closeY = yFor(point.close);
    const highY = yFor(point.high);
    const lowY = yFor(point.low);
    const top = Math.min(openY, closeY);
    const bodyHeight = Math.max(1, Math.abs(openY - closeY));
    const cls = point.close >= point.open ? "candle-good" : "candle-bad";
    const label = `${formatTimestampForMode(point.timestamp, timezoneMode)} O ${numberText(point.open)} H ${numberText(point.high)} L ${numberText(point.low)} C ${numberText(point.close)}`;
    return `<g class="${cls}"><line class="candle-wick" x1="${x.toFixed(1)}" y1="${highY.toFixed(1)}" x2="${x.toFixed(1)}" y2="${lowY.toFixed(1)}"><title>${escapeHtml(label)}</title></line><rect class="candle-body" x="${(x - candleWidth / 2).toFixed(1)}" y="${top.toFixed(1)}" width="${candleWidth.toFixed(1)}" height="${bodyHeight.toFixed(1)}"><title>${escapeHtml(label)}</title></rect></g>`;
  }).join("");
  let volumeBars = "";
  const volumes = rows.map((point) => point.volume).filter((value) => Number.isFinite(value));
  if (volumes.length) {
    const maxVolume = Math.max(...volumes, 1);
    const barWidth = Math.max(1, width / rows.length);
    const baseY = priceHeight + volumeGap;
    volumeBars = rows.map((point) => {
      if (!Number.isFinite(point.volume)) return "";
      const x = Math.max(0, xFor(point.millis) - barWidth / 2);
      const barHeight = Math.max(1, (point.volume / maxVolume) * volumeHeight);
      const y = baseY + volumeHeight - barHeight;
      return `<rect class="volume-bar" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${barHeight.toFixed(1)}"><title>${escapeHtml(formatTimestampForMode(point.timestamp, timezoneMode))} volume ${escapeHtml(numberText(point.volume, 0))}</title></rect>`;
    }).join("");
  }
  const gapMarkers = gapMarkerBands(gaps, width, priceHeight, minTime, maxTime, timezoneMode);
  const gapLegend = gapMarkerLegend(gaps, minTime, maxTime, timezoneMode);
  const first = rows[0];
  const last = rows[rows.length - 1];
  const caption = `${formatTimestampForMode(first.timestamp, timezoneMode)} close ${numberText(first.close)} | ${formatTimestampForMode(last.timestamp, timezoneMode)} close ${numberText(last.close)}`;
  return `<svg class="detail-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="saved data candlestick, gaps, and volume">${gapMarkers}${candles}${volumeBars}</svg>${gapLegend}<span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function compareChart(series, timezoneMode = "utc") {
  const rows = (series || []).map((item) => ({
    symbol: item.symbol,
    points: (item.points || []).map((point) => ({
      timestamp: point.timestamp,
      millis: timestampMillis(point.timestamp),
      value: Number(point.normalized_return_pct),
    })).filter((point) => point.millis !== null && Number.isFinite(point.value)),
  })).filter((item) => item.points.length >= 2);
  const allPoints = rows.flatMap((item) => item.points);
  if (rows.length < 2 || allPoints.length < 4) {
    return emptyChart("Select at least two datasets with comparable close paths.");
  }
  const minTime = Math.min(...allPoints.map((point) => point.millis));
  const maxTime = Math.max(...allPoints.map((point) => point.millis));
  const minValue = Math.min(...allPoints.map((point) => point.value));
  const maxValue = Math.max(...allPoints.map((point) => point.value));
  const width = 720;
  const height = 220;
  const timeSpan = maxTime - minTime || 1;
  const valueSpan = maxValue - minValue || 1;
  const colors = ["#00a76f", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f"];
  const polylines = rows.map((item, index) => {
    const coords = item.points.map((point) => {
      const x = ((point.millis - minTime) / timeSpan) * width;
      const y = height - ((point.value - minValue) / valueSpan) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `<polyline points="${coords}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="2"><title>${escapeHtml(item.symbol)}</title></polyline>`;
  }).join("");
  const axisY = maxValue >= 0 && minValue <= 0
    ? height - ((0 - minValue) / valueSpan) * height
    : null;
  const zeroLine = axisY === null
    ? ""
    : `<line class="axis-line" x1="0" y1="${axisY.toFixed(1)}" x2="${width}" y2="${axisY.toFixed(1)}"></line>`;
  const legend = rows.map((item, index) => (
    `<span class="legend-item"><span style="background:${colors[index % colors.length]}"></span>${escapeHtml(item.symbol)}</span>`
  )).join("");
  const caption = `${formatTimestampForMode(new Date(minTime).toISOString(), timezoneMode)} -> ${formatTimestampForMode(new Date(maxTime).toISOString(), timezoneMode)} normalized close return`;
  return `<svg class="detail-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="saved data comparison">${zeroLine}${polylines}</svg><div class="chart-legend">${legend}</div><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function equityChart(points, markers = []) {
  if (!points || points.length < 2) return emptyChart("No equity curve available");
  const rows = (points || []).map((point, index) => ({
    index,
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    equity: Number(point.equity),
  })).filter((point) => Number.isFinite(point.equity));
  const values = rows.map((point) => point.equity);
  if (values.length < 2) return emptyChart("No equity curve available");
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const xForIndex = (index) => (values.length === 1 ? 0 : (index / (values.length - 1)) * width);
  const yForValue = (value) => height - ((value - min) / span) * height;
  const coords = rows.map((point, index) => {
    const x = xForIndex(index);
    const y = yForValue(point.equity);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const rowForMarker = (marker) => {
    const markerMillis = timestampMillis(marker.timestamp);
    if (markerMillis === null) return null;
    return rows.reduce((best, point, index) => {
      if (point.millis === null) return best;
      const distance = Math.abs(point.millis - markerMillis);
      return !best || distance < best.distance ? { point, index, distance } : best;
    }, null);
  };
  const chartMarkers = (markers || []).slice(0, 40).map((marker) => {
    const match = rowForMarker(marker);
    if (!match) return null;
    const type = String(marker.type || "event").replace(/[^a-z0-9_-]/gi, "-").toLowerCase();
    const x = xForIndex(match.index);
    const y = yForValue(match.point.equity);
    const label = [marker.type, marker.symbol, marker.label, marker.timestamp].map(text).filter((value) => value !== "n/a").join(" ");
    return { type, x, y, label };
  }).filter(Boolean);
  const markerElements = chartMarkers.map((marker) => (
    `<circle class="chart-marker marker-${escapeHtml(marker.type)}" cx="${marker.x.toFixed(1)}" cy="${marker.y.toFixed(1)}" r="4"><title>${escapeHtml(marker.label)}</title></circle>`
  )).join("");
  const markerGroups = [
    ["entry-fill", "Entry fills"],
    ["exit-fill", "Exit fills"],
    ["entry-marker", "Entry markers"],
    ["exit-marker", "Exit markers"],
  ].map(([type, label]) => ({
    type,
    label,
    count: chartMarkers.filter((marker) => marker.type === type).length,
  })).filter((item) => item.count > 0);
  const markerLegend = markerGroups.length
    ? `<div class="chart-legend marker-legend">${markerGroups.map((item) => `<span class="legend-item marker-${escapeHtml(item.type)}"><span></span>${escapeHtml(item.label)} ${numberText(item.count, 0)}</span>`).join("")}</div>`
    : "";
  const cls = values[values.length - 1] >= values[0] ? "spark-good" : "spark-bad";
  return `<svg class="detail-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="equity curve"><polyline points="${coords}"></polyline>${markerElements}</svg>${markerLegend}`;
}

function normalizedReturnPoints(rows, valueKey) {
  const ordered = (rows || []).map((point) => ({
    timestamp: point.timestamp,
    millis: timestampMillis(point.timestamp),
    value: Number(point[valueKey]),
  })).filter((point) => point.millis !== null && Number.isFinite(point.value))
    .sort((a, b) => a.millis - b.millis);
  const base = ordered.find((point) => point.value !== 0);
  if (!base) return [];
  return ordered.map((point) => ({
    timestamp: point.timestamp,
    millis: point.millis,
    value: ((point.value / base.value) - 1) * 100,
  })).filter((point) => Number.isFinite(point.value));
}

function benchmarkOverlayChart(accountRows, benchmarkDetail) {
  const accountPoints = normalizedReturnPoints(accountRows, "equity");
  const benchmarkPoints = normalizedReturnPoints((benchmarkDetail && benchmarkDetail.preview) || [], "close");
  if (accountPoints.length < 2) {
    return emptyChart("Load account snapshots to compare against a benchmark.");
  }
  if (!benchmarkDetail || !benchmarkDetail.path) {
    return emptyChart("Choose a saved dataset, then load the benchmark overlay.");
  }
  if (benchmarkPoints.length < 2) {
    return emptyChart("Selected benchmark has no plottable close path.");
  }
  const series = [
    { label: "Strategy", points: accountPoints, className: "benchmark-strategy-line" },
    { label: benchmarkDetail.symbol || "Benchmark", points: benchmarkPoints, className: "benchmark-market-line" },
  ];
  const allPoints = series.flatMap((item) => item.points);
  const minTime = Math.min(...allPoints.map((point) => point.millis));
  const maxTime = Math.max(...allPoints.map((point) => point.millis));
  const minValue = Math.min(0, ...allPoints.map((point) => point.value));
  const maxValue = Math.max(0, ...allPoints.map((point) => point.value));
  const width = 720;
  const height = 180;
  const timeSpan = maxTime - minTime || 1;
  const valueSpan = maxValue - minValue || 1;
  const yFor = (value) => height - ((value - minValue) / valueSpan) * height;
  const lineFor = (item) => {
    const coords = item.points.map((point) => {
      const x = ((point.millis - minTime) / timeSpan) * width;
      const y = yFor(point.value);
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `<polyline class="${escapeHtml(item.className)}" points="${coords}"><title>${escapeHtml(item.label)}</title></polyline>`;
  };
  const zeroY = yFor(0).toFixed(1);
  const legend = series.map((item) => (
    `<span class="legend-item ${escapeHtml(item.className)}"><span></span>${escapeHtml(item.label)}</span>`
  )).join("");
  const accountLatest = accountPoints[accountPoints.length - 1].value;
  const benchmarkLatest = benchmarkPoints[benchmarkPoints.length - 1].value;
  const caption = `Strategy ${pctText(accountLatest)} / ${text(benchmarkDetail.symbol || "benchmark")} ${pctText(benchmarkLatest)} normalized return`;
  return `<svg class="detail-chart benchmark-overlay" viewBox="0 0 ${width} ${height}" role="img" aria-label="strategy and benchmark normalized return overlay"><line class="axis-line" x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}"></line>${series.map(lineFor).join("")}</svg><div class="chart-legend">${legend}</div><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function numericAccountRows(points) {
  return (points || []).map((point) => ({
    timestamp: point.timestamp,
    equity: Number(point.equity),
  })).filter((point) => point.timestamp && Number.isFinite(point.equity));
}

function latestSessionAccountRows(points) {
  const rows = numericAccountRows(points).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  if (!rows.length) return [];
  const latestDay = String(rows[rows.length - 1].timestamp).slice(0, 10);
  return rows.filter((point) => String(point.timestamp).slice(0, 10) === latestDay);
}

function intradayPnlStats(points) {
  const rows = numericAccountRows(points).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  if (!rows.length) return null;
  const first = rows[0];
  const last = rows[rows.length - 1];
  const pnls = rows.map((point) => point.equity - first.equity);
  const pnl = last.equity - first.equity;
  return {
    day: String(last.timestamp).slice(0, 10),
    start_time: first.timestamp,
    end_time: last.timestamp,
    count: rows.length,
    pnl,
    return_pct: first.equity > 0 ? (pnl / first.equity) * 100 : null,
    high_pnl: Math.max(...pnls),
    low_pnl: Math.min(...pnls),
  };
}

function intradayPnlChart(points) {
  const rows = numericAccountRows(points).sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
  if (rows.length < 2) return emptyChart("No intraday PnL curve available");
  const base = rows[0].equity;
  const values = rows.map((point) => point.equity - base).filter((value) => Number.isFinite(value));
  if (values.length < 2) return emptyChart("No intraday PnL curve available");
  const min = Math.min(...values, 0);
  const max = Math.max(...values, 0);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const yFor = (value) => height - ((value - min) / span) * height;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = yFor(value);
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const finalPnl = values[values.length - 1];
  const cls = finalPnl >= 0 ? "spark-good" : "spark-bad";
  const zeroY = yFor(0).toFixed(1);
  const caption = `${String(rows[0].timestamp).slice(0, 10)} session PnL ${money(finalPnl)} from ${numberText(rows.length, 0)} snapshots`;
  return `<svg class="detail-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="intraday profit and loss curve"><line class="axis-line" x1="0" y1="${zeroY}" x2="${width}" y2="${zeroY}"></line><polyline points="${coords}"></polyline></svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function drawdownChart(points) {
  const rows = numericAccountRows(points);
  if (rows.length < 2) return emptyChart("No drawdown curve available");
  let peak = rows[0].equity;
  const values = rows.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown = peak > 0 ? ((point.equity / peak) - 1) * 100 : 0;
    return { timestamp: point.timestamp, value: drawdown };
  });
  return scalarLineChart(values, {
    label: "drawdown curve",
    empty: "No drawdown curve available",
    className: "spark-bad",
    valueFormatter: pctText,
  });
}

function dailyReturns(points) {
  const rows = numericAccountRows(points);
  const byDay = new Map();
  for (const point of rows) {
    const day = String(point.timestamp).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(point);
  }
  return Array.from(byDay.entries()).map(([day, items]) => {
    const ordered = items.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const first = ordered[0].equity;
    const last = ordered[ordered.length - 1].equity;
    const value = first > 0 ? ((last / first) - 1) * 100 : 0;
    return { day, value };
  }).filter((item) => Number.isFinite(item.value));
}

function dailyReturnChart(points) {
  const rows = dailyReturns(points);
  if (!rows.length) return emptyChart("No daily return bars available");
  const width = 720;
  const height = 180;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const barGap = 4;
  const barWidth = Math.max(3, (width - padding * 2 - barGap * Math.max(0, rows.length - 1)) / rows.length);
  const axisY = height / 2;
  const bars = rows.map((item, index) => {
    const magnitude = (Math.abs(item.value) / maxAbs) * (height / 2 - padding);
    const x = padding + index * (barWidth + barGap);
    const y = item.value >= 0 ? axisY - magnitude : axisY;
    const cls = item.value >= 0 ? "return-bar-good" : "return-bar-bad";
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(item.day)} ${escapeHtml(pctText(item.value))}</title></rect>`;
  }).join("");
  const labels = rows.slice(-3).map((item) => `${item.day} ${pctText(item.value)}`).join(" | ");
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="daily return bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(labels)}</span>`;
}

function calendarReturnHeatmap(points) {
  const rows = dailyReturns(points).sort((a, b) => String(a.day).localeCompare(String(b.day)));
  if (!rows.length) return emptyChart("No daily returns available for calendar view");
  const byDay = new Map(rows.map((item) => [item.day, item.value]));
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const start = new Date(`${rows[0].day}T00:00:00Z`);
  const end = new Date(`${rows[rows.length - 1].day}T00:00:00Z`);
  start.setUTCDate(start.getUTCDate() - start.getUTCDay());
  const cells = [];
  for (const cursor = new Date(start); cursor <= end; cursor.setUTCDate(cursor.getUTCDate() + 1)) {
    const day = cursor.toISOString().slice(0, 10);
    const value = byDay.get(day);
    let cls = "calendar-cell-empty";
    let label = `${day} no account return`;
    if (Number.isFinite(value)) {
      const intensity = Math.min(4, Math.max(1, Math.ceil((Math.abs(value) / maxAbs) * 4)));
      cls = value >= 0 ? `calendar-good-${intensity}` : `calendar-bad-${intensity}`;
      label = `${day} ${pctText(value)}`;
    }
    cells.push(`<span class="calendar-cell ${cls}" title="${escapeHtml(label)}"></span>`);
  }
  const latest = rows.slice(-5).map((item) => `${item.day} ${pctText(item.value)}`).join(" | ");
  return `<div class="calendar-scroll"><div class="calendar-heatmap" role="img" aria-label="daily return calendar heatmap">${cells.join("")}</div></div><span class="chart-caption">${escapeHtml(latest)}</span>`;
}

function scalarLineChart(points, { label, empty, className, valueFormatter }) {
  if (!points || points.length < 2) return emptyChart(empty);
  const values = points.map((point) => Number(point.value)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return emptyChart(empty);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const latest = values[values.length - 1];
  const caption = `${valueFormatter ? valueFormatter(latest) : numberText(latest)} latest`;
  return `<svg class="detail-chart ${className || ""}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}"><polyline points="${coords}"></polyline></svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function statusRollupChartRows(rollups, valueKey) {
  return (rollups || []).map((item) => ({
    day: item.day,
    node_id: text(item.node_id),
    millis: timestampMillis(`${item.day}T00:00:00Z`),
    value: Number(item[valueKey]),
  })).filter((item) => item.day && item.millis !== null && Number.isFinite(item.value))
    .sort((left, right) => (left.millis - right.millis) || left.node_id.localeCompare(right.node_id));
}

function statusRollupEquityChart(rollups) {
  const rows = statusRollupChartRows(rollups, "end_equity");
  if (rows.length < 2) return emptyChart("No status-history equity curve available");
  const byNode = new Map();
  for (const item of rows) {
    if (!byNode.has(item.node_id)) byNode.set(item.node_id, []);
    byNode.get(item.node_id).push(item);
  }
  const drawable = Array.from(byNode.entries()).filter(([, items]) => items.length >= 2);
  if (!drawable.length) return emptyChart("Need at least two status-history equity days for one node.");
  const values = rows.map((item) => item.value);
  const minValue = Math.min(...values);
  const maxValue = Math.max(...values);
  const minTime = Math.min(...rows.map((item) => item.millis));
  const maxTime = Math.max(...rows.map((item) => item.millis));
  const width = 720;
  const height = 180;
  const valueSpan = maxValue - minValue || 1;
  const timeSpan = maxTime - minTime || 1;
  const colors = ["#00a76f", "#2563eb", "#d97706", "#dc2626", "#7c3aed", "#0891b2", "#be123c", "#4d7c0f"];
  const lines = drawable.map(([node, items], index) => {
    const coords = items.map((item) => {
      const x = ((item.millis - minTime) / timeSpan) * width;
      const y = height - ((item.value - minValue) / valueSpan) * height;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    return `<polyline points="${coords}" fill="none" stroke="${colors[index % colors.length]}" stroke-width="2"><title>${escapeHtml(node)}</title></polyline>`;
  }).join("");
  const legend = drawable.map(([node], index) => (
    `<span class="legend-item"><span style="background:${colors[index % colors.length]}"></span>${escapeHtml(node)}</span>`
  )).join("");
  const latest = rows[rows.length - 1];
  const caption = `${escapeHtml(latest.day)} ${escapeHtml(latest.node_id)} end equity ${escapeHtml(money(latest.value))}`;
  return `<svg class="detail-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="status-history equity by node">${lines}</svg><div class="chart-legend">${legend}</div><span class="chart-caption">${caption}</span>`;
}

function statusRollupReturnChart(rollups) {
  const rows = statusRollupChartRows(rollups, "daily_return_pct").slice(-60);
  if (!rows.length) return emptyChart("No status-history daily returns available");
  const width = 720;
  const height = 180;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const barGap = 4;
  const barWidth = Math.max(3, (width - padding * 2 - barGap * Math.max(0, rows.length - 1)) / rows.length);
  const axisY = height / 2;
  const bars = rows.map((item, index) => {
    const magnitude = (Math.abs(item.value) / maxAbs) * (height / 2 - padding);
    const x = padding + index * (barWidth + barGap);
    const y = item.value >= 0 ? axisY - magnitude : axisY;
    const cls = item.value >= 0 ? "return-bar-good" : "return-bar-bad";
    const label = `${item.day} ${item.node_id} ${pctText(item.value)}`;
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(label)}</title></rect>`;
  }).join("");
  const labels = rows.slice(-3).map((item) => `${item.day} ${item.node_id} ${pctText(item.value)}`).join(" | ");
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="status-history daily return bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(labels)}</span>`;
}

function dataCatalogFilters() {
  return {
    text: ($("data-filter-text").value || "").trim().toLowerCase(),
    quality: $("data-filter-quality").value || "",
    bar: $("data-filter-bar").value || "",
    asset: $("data-filter-asset").value || "",
    source: $("data-filter-source").value || "",
    session: $("data-filter-session").value || "",
    contract: $("data-filter-contract").value || "",
    sort: $("data-filter-sort").value || "modified_desc",
  };
}

function dataCatalogSortValue(dataset, key) {
  if (key === "modified") return timestampMillis(dataset.modified_at) || 0;
  if (key === "rows") return Number(dataset.rows || 0);
  if (key === "size") return Number(dataset.size_bytes || 0);
  if (key === "range") return timestampMillis(dataset.last_timestamp) || 0;
  if (key === "quality") {
    const rank = { ok: 0, warn: 1, bad: 2 };
    return rank[String(dataset.quality_status || "").toLowerCase()] ?? 3;
  }
  if (key === "contract") {
    const rank = { ok: 0, warn: 1, bad: 2 };
    return rank[String(dataset.storage_contract_status || "").toLowerCase()] ?? 3;
  }
  return String(dataset.symbol || dataset.path || "").toLowerCase();
}

function sortDataCatalogRows(datasets, sortKey) {
  const [key, direction] = String(sortKey || "modified_desc").split("_");
  const multiplier = direction === "asc" ? 1 : -1;
  return (datasets || []).slice().sort((left, right) => {
    const leftValue = dataCatalogSortValue(left, key);
    const rightValue = dataCatalogSortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier;
    }
    const primary = String(leftValue).localeCompare(String(rightValue)) * multiplier;
    if (primary) return primary;
    return `${text(left.symbol)} ${text(left.path)}`.localeCompare(`${text(right.symbol)} ${text(right.path)}`);
  });
}

function filteredDataCatalog(datasets) {
  const filters = dataCatalogFilters();
  const manifestPaths = manifestPathFilterPaths();
  const filtered = (datasets || []).filter((dataset) => {
    if (manifestPaths.size && !manifestPaths.has(text(dataset.path))) return false;
    if (filters.quality && dataset.quality_status !== filters.quality) return false;
    if (filters.bar && text(dataset.bar_size) !== filters.bar) return false;
    if (filters.asset && text(dataset.asset_class) !== filters.asset) return false;
    if (filters.source && text(dataset.source) !== filters.source) return false;
    if (filters.session && text(dataset.storage_session) !== filters.session) return false;
    if (filters.contract && text(dataset.storage_contract_status) !== filters.contract) return false;
    if (filters.text) {
      const haystack = [
        dataset.symbol,
        dataset.asset_class,
        dataset.source,
        dataset.bar_size,
        dataset.storage_session,
        dataset.storage_contract_status,
        dataset.storage_contract_label,
        dataset.path,
        dataset.root,
        dataset.source_timezone,
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });
  return sortDataCatalogRows(filtered, filters.sort);
}

function renderDataFilterOptions(datasets) {
  const makeOptions = (id, values) => {
    const select = $(id);
    const current = select.value;
    const options = Array.from(new Set(values.map(text).filter((item) => item !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) {
      select.value = current;
    }
  };
  makeOptions("data-filter-bar", (datasets || []).map((item) => item.bar_size));
  makeOptions("data-filter-asset", (datasets || []).map((item) => item.asset_class));
  makeOptions("data-filter-source", (datasets || []).map((item) => item.source));
  makeOptions("data-filter-session", (datasets || []).map((item) => item.storage_session));
  makeOptions("data-filter-contract", (datasets || []).map((item) => item.storage_contract_status));
}

function symbolBrowserGroups(datasets = state.dataCatalog.datasets || []) {
  const groups = new Map();
  for (const dataset of (datasets || [])) {
    const symbol = text(dataset.symbol);
    if (symbol === "n/a") continue;
    if (!groups.has(symbol)) groups.set(symbol, []);
    groups.get(symbol).push(dataset);
  }
  for (const rows of groups.values()) {
    rows.sort((a, b) => {
      const qualityRank = { ok: 0, warn: 1, bad: 2 };
      const aQuality = qualityRank[text(a.quality_status)] ?? 3;
      const bQuality = qualityRank[text(b.quality_status)] ?? 3;
      if (aQuality !== bQuality) return aQuality - bQuality;
      const aContract = qualityRank[text(a.storage_contract_status)] ?? 3;
      const bContract = qualityRank[text(b.storage_contract_status)] ?? 3;
      if (aContract !== bContract) return aContract - bContract;
      const aRows = Number(a.rows || 0);
      const bRows = Number(b.rows || 0);
      if (aRows !== bRows) return bRows - aRows;
      return text(a.path).localeCompare(text(b.path));
    });
  }
  return groups;
}

function symbolBrowserFacetControls() {
  return {
    source: (($("data-symbol-browser-source") || {}).value || ""),
    bar: (($("data-symbol-browser-bar") || {}).value || ""),
    session: (($("data-symbol-browser-session") || {}).value || ""),
    quality: (($("data-symbol-browser-quality") || {}).value || ""),
    contract: (($("data-symbol-browser-contract") || {}).value || ""),
  };
}

function datasetMatchesSymbolBrowserFacets(dataset, facets = symbolBrowserFacetControls()) {
  return (!facets.source || text(dataset.source) === facets.source)
    && (!facets.bar || text(dataset.bar_size) === facets.bar)
    && (!facets.session || text(dataset.storage_session) === facets.session)
    && (!facets.quality || text(dataset.quality_status) === facets.quality)
    && (!facets.contract || text(dataset.storage_contract_status) === facets.contract);
}

function symbolBrowserFilteredDatasets() {
  const facets = symbolBrowserFacetControls();
  return (state.dataCatalog.datasets || []).filter((dataset) => datasetMatchesSymbolBrowserFacets(dataset, facets));
}

function symbolBrowserFilteredGroups() {
  return symbolBrowserGroups(symbolBrowserFilteredDatasets());
}

function symbolBrowserFacetSummary(facets = symbolBrowserFacetControls()) {
  return [
    facets.source ? `source ${facets.source}` : "",
    facets.bar ? `bar ${facets.bar}` : "",
    facets.session ? `session ${facets.session}` : "",
    facets.quality ? `quality ${facets.quality}` : "",
    facets.contract ? `contract ${facets.contract}` : "",
  ].filter(Boolean);
}

function renderSymbolBrowserFacetOptions(datasets = state.dataCatalog.datasets || []) {
  const makeOptions = (id, values) => {
    const select = $(id);
    if (!select) return;
    const current = select.value || "";
    const options = Array.from(new Set((values || []).map(text).filter((value) => value && value !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) {
      select.value = current;
    }
  };
  makeOptions("data-symbol-browser-source", datasets.map((item) => item.source));
  makeOptions("data-symbol-browser-bar", datasets.map((item) => item.bar_size));
  makeOptions("data-symbol-browser-session", datasets.map((item) => item.storage_session));
  makeOptions("data-symbol-browser-quality", datasets.map((item) => item.quality_status));
  makeOptions("data-symbol-browser-contract", datasets.map((item) => item.storage_contract_status));
}

function renderCatalogSymbolDatalists(browserSymbols, catalogSymbols = browserSymbols) {
  const renderOptions = (symbols) => (symbols || []).map((symbol) => `<option value="${escapeHtml(symbol)}"></option>`).join("");
  const browserDatalist = $("data-symbol-browser-options");
  if (browserDatalist) browserDatalist.innerHTML = renderOptions(browserSymbols);
  const catalogDatalist = $("data-filter-symbol-options");
  if (catalogDatalist) catalogDatalist.innerHTML = renderOptions(catalogSymbols);
}

function selectedSymbolBrowserSymbol() {
  return ($("data-symbol-browser-input").value || "").trim().toUpperCase();
}

function selectedSymbolBrowserDatasets() {
  const symbol = selectedSymbolBrowserSymbol();
  if (!symbol) return [];
  return symbolBrowserFilteredGroups().get(symbol) || [];
}

function symbolGroupSummary(symbol, rows) {
  const datasets = rows || [];
  const best = datasets[0] || {};
  const sources = Array.from(new Set(datasets.map((item) => text(item.source)).filter((item) => item !== "n/a"))).slice(0, 4);
  const bars = Array.from(new Set(datasets.map((item) => text(item.bar_size)).filter((item) => item !== "n/a"))).slice(0, 4);
  const assets = Array.from(new Set(datasets.map((item) => text(item.asset_class)).filter((item) => item !== "n/a"))).slice(0, 3);
  const rowsTotal = datasets.reduce((sum, item) => sum + Number(item.rows || 0), 0);
  const latest = datasets
    .map((item) => timestampMillis(item.last_timestamp) || timestampMillis(item.modified_at) || 0)
    .reduce((max, value) => Math.max(max, value), 0);
  return {
    symbol,
    best,
    file_count: datasets.length,
    rows_total: rowsTotal,
    sources,
    bars,
    assets,
    quality_status: text(best.quality_status),
    storage_contract_status: text(best.storage_contract_status),
    latest_millis: latest,
    range: rangeLabel(best.first_timestamp, best.last_timestamp),
  };
}

function symbolQuickPickSuggestions(query, groups, limit = 8) {
  const normalized = String(query || "").trim().toUpperCase();
  const summaries = Array.from(groups.entries()).map(([symbol, rows]) => symbolGroupSummary(symbol, rows));
  return summaries
    .map((summary) => {
      const symbol = text(summary.symbol).toUpperCase();
      const exact = normalized && symbol === normalized;
      const starts = normalized && symbol.startsWith(normalized);
      const includes = normalized && symbol.includes(normalized);
      const score = exact
        ? 0
        : starts
          ? 1
          : includes
            ? 2
            : normalized ? 5 : 3;
      return { ...summary, score };
    })
    .filter((summary) => !normalized || summary.score < 5)
    .sort((left, right) => {
      if (left.score !== right.score) return left.score - right.score;
      const qualityDelta = datasetQualityRank(left.quality_status) - datasetQualityRank(right.quality_status);
      if (qualityDelta) return qualityDelta;
      const contractDelta = datasetQualityRank(left.storage_contract_status) - datasetQualityRank(right.storage_contract_status);
      if (contractDelta) return contractDelta;
      if (left.file_count !== right.file_count) return right.file_count - left.file_count;
      if (left.rows_total !== right.rows_total) return right.rows_total - left.rows_total;
      if (left.latest_millis !== right.latest_millis) return right.latest_millis - left.latest_millis;
      return text(left.symbol).localeCompare(text(right.symbol));
    })
    .slice(0, limit);
}

function renderSymbolQuickPicks(groups, query) {
  const container = $("data-symbol-quick-picks");
  if (!container) return;
  const suggestions = symbolQuickPickSuggestions(query, groups, 8);
  if (!suggestions.length) {
    container.innerHTML = "";
    return;
  }
  const normalized = String(query || "").trim().toUpperCase();
  const title = normalized ? `Quick picks matching ${normalized}` : "Quick picks from scanned data";
  container.innerHTML = `
    <span class="symbol-quick-pick-head">${escapeHtml(title)}</span>
    <div class="symbol-quick-pick-grid">
      ${suggestions.map((summary) => `
        <button type="button" class="symbol-quick-pick" data-symbol="${escapeHtml(summary.symbol)}">
          <span>${escapeHtml(summary.assets.join(", ") || "unknown asset")}</span>
          <strong>${escapeHtml(summary.symbol)}</strong>
          <small>${escapeHtml(numberText(summary.file_count, 0))} file${summary.file_count === 1 ? "" : "s"} / ${escapeHtml(numberText(summary.rows_total, 0))} rows</small>
          <small>${escapeHtml(summary.sources.join(", ") || "unknown source")} / ${escapeHtml(summary.bars.join(", ") || "unknown bar")}</small>
          <small>${qualityBadge(summary.quality_status)} ${qualityBadge(summary.storage_contract_status)} ${escapeHtml(summary.range)}</small>
        </button>
      `).join("")}
    </div>
  `;
}

function symbolMatchLabel(score) {
  if (score === 0) return "exact";
  if (score === 1) return "starts";
  if (score === 2) return "contains";
  return "ranked";
}

function symbolTypeaheadSuggestions(groups, query) {
  return symbolQuickPickSuggestions(query, groups, 6);
}

function renderSymbolTypeahead(groups, query) {
  const container = $("data-symbol-typeahead");
  if (!container) return;
  const suggestions = symbolTypeaheadSuggestions(groups, query);
  const normalized = String(query || "").trim().toUpperCase();
  const input = $("data-symbol-browser-input");
  if (!suggestions.length) {
    container.innerHTML = normalized
      ? `<div class="empty-card"><strong>No symbol suggestions</strong><span>Try a different ticker, or Diagnose to search configured and suggested roots.</span></div>`
      : "";
    state.symbolTypeaheadActiveIndex = 0;
    if (input) {
      input.setAttribute("aria-expanded", "false");
      input.removeAttribute("aria-activedescendant");
    }
    return;
  }
  state.symbolTypeaheadActiveIndex = Math.max(0, Math.min(state.symbolTypeaheadActiveIndex || 0, suggestions.length - 1));
  container.innerHTML = `
    <span class="symbol-typeahead-head">${escapeHtml(normalized ? `Best matches for ${normalized}` : "Best symbol matches")}</span>
    <div id="data-symbol-typeahead-list" class="symbol-typeahead-list" role="listbox" aria-label="Symbol suggestions">
      ${suggestions.map((summary, index) => `
        <button id="data-symbol-typeahead-option-${index}" type="button" class="symbol-typeahead-option ${index === state.symbolTypeaheadActiveIndex ? "is-active" : ""}" data-symbol="${escapeHtml(summary.symbol)}" role="option" aria-selected="${index === state.symbolTypeaheadActiveIndex ? "true" : "false"}">
          <strong>${escapeHtml(summary.symbol)}</strong>
          <span>${escapeHtml(summary.assets.join(", ") || "unknown asset")} / ${escapeHtml(summary.sources.join(", ") || "unknown source")} / ${escapeHtml(summary.bars.join(", ") || "unknown bar")}<br>${escapeHtml(numberText(summary.file_count, 0))} file${summary.file_count === 1 ? "" : "s"} / ${escapeHtml(numberText(summary.rows_total, 0))} rows / ${escapeHtml(summary.range)}</span>
          <small class="symbol-match-badge">${escapeHtml(symbolMatchLabel(summary.score))}</small>
        </button>
      `).join("")}
    </div>
  `;
  if (input) {
    input.setAttribute("aria-expanded", "true");
    input.setAttribute("aria-activedescendant", `data-symbol-typeahead-option-${state.symbolTypeaheadActiveIndex}`);
  }
}

function selectSymbolBrowserSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return;
  $("data-symbol-browser-input").value = normalized;
  renderSymbolBrowser();
}

function topSymbolBrowserSuggestion() {
  const groups = symbolBrowserFilteredGroups();
  const suggestions = symbolTypeaheadSuggestions(groups, selectedSymbolBrowserSymbol());
  return (suggestions[0] || {}).symbol || "";
}

function activeSymbolTypeaheadSuggestion() {
  const groups = symbolBrowserFilteredGroups();
  const suggestions = symbolTypeaheadSuggestions(groups, selectedSymbolBrowserSymbol());
  if (!suggestions.length) return "";
  const index = Math.max(0, Math.min(state.symbolTypeaheadActiveIndex || 0, suggestions.length - 1));
  return (suggestions[index] || {}).symbol || "";
}

function moveSymbolTypeaheadSelection(delta) {
  const groups = symbolBrowserFilteredGroups();
  const suggestions = symbolTypeaheadSuggestions(groups, selectedSymbolBrowserSymbol());
  if (!suggestions.length) return "";
  state.symbolTypeaheadActiveIndex = ((state.symbolTypeaheadActiveIndex || 0) + delta + suggestions.length) % suggestions.length;
  renderSymbolTypeahead(groups, selectedSymbolBrowserSymbol());
  return (suggestions[state.symbolTypeaheadActiveIndex] || {}).symbol || "";
}

function bestCatalogDatasetForSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return null;
  return (symbolBrowserGroups().get(normalized) || [])[0] || null;
}

function datasetQualityRank(value) {
  const rank = { ok: 0, warn: 1, bad: 2 };
  return rank[String(value || "").toLowerCase()] ?? 3;
}

function recommendedDataRows(filteredRows = []) {
  const sourceRows = filteredRows.length ? filteredRows : (state.dataCatalog.datasets || []);
  return sourceRows
    .filter((dataset) => dataset && dataset.path)
    .slice()
    .sort((left, right) => {
      const qualityDelta = datasetQualityRank(left.quality_status) - datasetQualityRank(right.quality_status);
      if (qualityDelta) return qualityDelta;
      const rowDelta = Number(right.rows || 0) - Number(left.rows || 0);
      if (rowDelta) return rowDelta;
      const timeDelta = (timestampMillis(right.last_timestamp) || timestampMillis(right.modified_at) || 0)
        - (timestampMillis(left.last_timestamp) || timestampMillis(left.modified_at) || 0);
      if (timeDelta) return timeDelta;
      return `${text(left.symbol)} ${text(left.path)}`.localeCompare(`${text(right.symbol)} ${text(right.path)}`);
    })
    .slice(0, 6);
}

function renderDataSearchAssistant(filteredRows = []) {
  if (!$("data-search-title") || !$("data-search-cards") || !$("data-search-actions")) return;
  const datasets = state.dataCatalog.datasets || [];
  const filters = dataCatalogFilters();
  const query = String(filters.text || "").trim().toUpperCase();
  const hiddenCount = Math.max(0, datasets.length - filteredRows.length);
  const exactSymbols = new Set(filteredRows.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const qualityCounts = countBy(filteredRows, "quality_status");
  const contractCounts = countBy(filteredRows, "storage_contract_status");
  const sourceCounts = countBy(filteredRows, "source");
  const barCounts = countBy(filteredRows, "bar_size");
  const bestMatch = filteredRows.find((dataset) => dataset.path) || null;
  const suggestions = symbolQuickPickSuggestions(query, symbolBrowserGroups(), query ? 5 : 4);
  const activeFacets = [
    filters.quality ? `quality ${filters.quality}` : "",
    filters.bar ? `bar ${filters.bar}` : "",
    filters.asset ? `asset ${filters.asset}` : "",
    filters.source ? `source ${filters.source}` : "",
    filters.session ? `session ${filters.session}` : "",
    filters.contract ? `contract ${filters.contract}` : "",
  ].filter(Boolean);
  let title = "No search applied";
  let note = "Use search and facets to narrow saved files, then inspect, compare, or diagnose a symbol.";
  if (query || activeFacets.length) {
    title = `${numberText(filteredRows.length, 0)} matching file${filteredRows.length === 1 ? "" : "s"}`;
    note = filteredRows.length
      ? `${numberText(exactSymbols.size, 0)} symbol${exactSymbols.size === 1 ? "" : "s"} match ${[query, ...activeFacets].filter(Boolean).join(" / ")}.`
      : `No saved files match ${[query, ...activeFacets].filter(Boolean).join(" / ")}. Diagnose can check roots and fetch manifests for a symbol.`;
  } else if (datasets.length) {
    title = `${numberText(datasets.length, 0)} searchable saved file${datasets.length === 1 ? "" : "s"}`;
    note = "Start from a ticker, source, bar size, storage session, quality state, contract state, or local path.";
  }
  $("data-search-title").textContent = title;
  $("data-search-note").textContent = note;
  const cards = [
    {
      label: "Visible Now",
      status: filteredRows.length ? "ok" : datasets.length ? "warn" : "bad",
      title: `${numberText(filteredRows.length, 0)} / ${numberText(datasets.length, 0)}`,
      note: hiddenCount ? `${numberText(hiddenCount, 0)} files hidden by current filters.` : "No files are hidden by current filters.",
    },
    {
      label: "Symbols",
      status: exactSymbols.size ? "ok" : filteredRows.length ? "warn" : "bad",
      title: numberText(exactSymbols.size, 0),
      note: exactSymbols.size ? `${Array.from(exactSymbols).slice(0, 5).join(", ")}${exactSymbols.size > 5 ? "..." : ""}` : "No matching symbols in catalog rows.",
    },
    {
      label: "Quality",
      status: Number(qualityCounts.bad || 0) ? "bad" : Number(qualityCounts.warn || 0) ? "warn" : filteredRows.length ? "ok" : "bad",
      title: countSummary(qualityCounts),
      note: Number(qualityCounts.bad || 0) || Number(qualityCounts.warn || 0)
        ? "Review warn/bad files before replay."
        : filteredRows.length ? "Matching rows are currently ok-quality." : "No quality counts to show.",
    },
    {
      label: "Contract",
      status: Number(contractCounts.bad || 0) ? "bad" : Number(contractCounts.warn || 0) ? "warn" : filteredRows.length ? "ok" : "bad",
      title: countSummary(contractCounts),
      note: Number(contractCounts.bad || 0) || Number(contractCounts.warn || 0)
        ? "Review storage metadata before replay."
        : filteredRows.length ? "Matching rows satisfy current storage-contract checks." : "No contract counts to show.",
    },
    {
      label: "Source And Bar",
      status: filteredRows.length ? "ok" : "warn",
      title: topCountEntries(sourceCounts, 2).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") || "none",
      note: topCountEntries(barCounts, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") || "No bar-size metadata in matches.",
    },
  ];
  $("data-search-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const suggestionButtons = suggestions.map((summary) => {
    const exactRows = symbolBrowserGroups().get(text(summary.symbol)) || [];
    const canCompare = exactRows.filter((dataset) => dataset.path).length >= 2;
    return `
      <div class="data-search-action-card">
        <div>
          <strong>${escapeHtml(summary.symbol)}</strong>
          <span>${escapeHtml(numberText(summary.file_count, 0))} file${summary.file_count === 1 ? "" : "s"} / ${escapeHtml(numberText(summary.rows_total, 0))} rows</span>
          <small>${escapeHtml(summary.sources.join(", ") || "unknown source")} / ${escapeHtml(summary.bars.join(", ") || "unknown bar")} / ${qualityBadge(summary.quality_status)} / contract ${escapeHtml(countSummary(countBy(exactRows, "storage_contract_status")))}</small>
        </div>
        <div>
          <button type="button" data-home-action="filter" data-symbol="${escapeHtml(summary.symbol)}">Filter</button>
          <button type="button" class="secondary" data-home-action="inspect" data-symbol="${escapeHtml(summary.symbol)}">Inspect</button>
          <button type="button" class="secondary" data-home-action="compare" data-symbol="${escapeHtml(summary.symbol)}"${canCompare ? "" : " disabled"}>Compare</button>
          <button type="button" class="secondary" data-home-action="diagnose" data-symbol="${escapeHtml(summary.symbol)}">Diagnose</button>
        </div>
      </div>
    `;
  });
  $("data-search-actions").innerHTML = suggestionButtons.length
    ? suggestionButtons.join("")
    : bestMatch
      ? `
        <div class="data-search-action-card">
          <div>
            <strong>${escapeHtml(text(bestMatch.symbol))}</strong>
            <span>${escapeHtml(text(bestMatch.bar_size))} / ${escapeHtml(text(bestMatch.source))} / ${escapeHtml(numberText(bestMatch.rows, 0))} rows</span>
            <small>${escapeHtml(rangeLabel(bestMatch.first_timestamp, bestMatch.last_timestamp))}</small>
          </div>
          <div>
            <button type="button" data-home-action="inspect" data-symbol="${escapeHtml(text(bestMatch.symbol))}" data-path="${escapeHtml(bestMatch.path)}">Inspect</button>
            <button type="button" class="secondary" data-home-action="filter" data-symbol="${escapeHtml(text(bestMatch.symbol))}">Filter</button>
          </div>
        </div>
      `
      : `<div class="empty-card"><strong>No quick actions</strong><span>Clear filters, raise the catalog limit, or diagnose a typed symbol.</span></div>`;
}

function renderSymbolBrowser() {
  const allGroups = symbolBrowserGroups();
  renderSymbolBrowserFacetOptions(state.dataCatalog.datasets || []);
  const groups = symbolBrowserFilteredGroups();
  const symbols = Array.from(groups.keys()).sort();
  const allSymbols = Array.from(allGroups.keys()).sort();
  const input = $("data-symbol-browser-input");
  const datasetSelect = $("data-symbol-browser-dataset");
  const previousSymbol = selectedSymbolBrowserSymbol();
  renderCatalogSymbolDatalists(symbols, allSymbols);
  if (!previousSymbol && symbols.length) input.value = symbols[0];
  const activeSymbol = selectedSymbolBrowserSymbol();
  renderSymbolProfile(activeSymbol);
  renderSymbolTypeahead(groups, activeSymbol);
  renderSymbolQuickPicks(groups, activeSymbol);
  const facetLabels = symbolBrowserFacetSummary();
  if (previousSymbol && !groups.has(previousSymbol)) {
    datasetSelect.innerHTML = "";
    renderSymbolSelectionPanel(previousSymbol);
    const fullCatalogHint = allGroups.has(previousSymbol)
      ? "This symbol exists in the catalog, but not under the current source/bar/session/quality facets."
      : "Choose a quick pick above, or use Diagnose to check unconfigured roots and fetch manifests for this symbol.";
    $("data-symbol-browser-note").innerHTML = `<span class="status-warn">No catalog files match ${escapeHtml(previousSymbol)}${facetLabels.length ? ` under ${escapeHtml(facetLabels.join(" / "))}` : ""}</span>`;
    $("data-symbol-browser-matches").innerHTML = `<div class="empty-card"><strong>No exact match</strong><span>${escapeHtml(fullCatalogHint)}</span></div>`;
    return;
  }
  const selected = selectedSymbolBrowserDatasets();
  const datasetOptions = selected.map((dataset) => ({
    value: dataset.path,
    label: `${text(dataset.bar_size)} ${text(dataset.source)} ${text(dataset.quality_status)}/${text(dataset.storage_contract_status)} ${numberText(dataset.rows, 0)} rows`,
  }));
  replaceOptions(datasetSelect, datasetOptions);
  renderSymbolSelectionPanel(activeSymbol);
  $("data-symbol-browser-note").textContent = symbols.length
    ? `${numberText(symbols.length, 0)} matching scanned symbols${facetLabels.length ? ` after ${facetLabels.join(" / ")}` : ""}; ${numberText(selected.length, 0)} file${selected.length === 1 ? "" : "s"} for ${text(selectedSymbolBrowserSymbol())}`
    : facetLabels.length
      ? `No scanned symbols match ${facetLabels.join(" / ")}`
      : "No scanned symbols loaded";
  $("data-symbol-browser-matches").innerHTML = selected.length
    ? selected.slice(0, 6).map((dataset) => `
        <button type="button" class="symbol-match-card" data-path="${escapeHtml(dataset.path)}">
          <span>${escapeHtml(text(dataset.symbol))}</span>
          <strong>${escapeHtml(text(dataset.bar_size))}</strong>
          <small>${escapeHtml(text(dataset.source))} / ${escapeHtml(text(dataset.asset_class))} / ${escapeHtml(text(dataset.quality_status))}/${escapeHtml(text(dataset.storage_contract_status))}</small>
          <small>${escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp))}</small>
        </button>
      `).join("")
    : `<div class="empty-card"><strong>No scanned symbols</strong><span>Add or configure historical data roots, then refresh the catalog.</span></div>`;
}

function symbolProfileModel(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const rows = normalized ? (symbolBrowserFilteredGroups().get(normalized) || []) : [];
  const allRows = normalized ? (symbolBrowserGroups().get(normalized) || []) : [];
  const best = rows[0] || null;
  const range = timestampRangeFromDatasets(rows);
  const totalRows = rows.reduce((sum, dataset) => sum + Number(dataset.rows || 0), 0);
  const qualities = countBy(rows, "quality_status");
  const contracts = countBy(rows, "storage_contract_status");
  const sources = Array.from(new Set(rows.map((dataset) => text(dataset.source)).filter((value) => value !== "n/a"))).sort();
  const bars = Array.from(new Set(rows.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a"))).sort();
  const assets = Array.from(new Set(rows.map((dataset) => text(dataset.asset_class)).filter((value) => value !== "n/a"))).sort();
  const latestMillis = rows
    .map((dataset) => timestampMillis(dataset.last_timestamp) || timestampMillis(dataset.modified_at) || 0)
    .reduce((max, value) => Math.max(max, value), 0);
  const qualityScore = rows.length ? Math.min(...rows.map((dataset) => datasetQualityRank(dataset.quality_status))) : 3;
  const contractScore = rows.length ? Math.min(...rows.map((dataset) => datasetQualityRank(dataset.storage_contract_status))) : 3;
  return {
    symbol: normalized,
    rows,
    allRows,
    best,
    range,
    totalRows,
    qualities,
    contracts,
    sources,
    bars,
    assets,
    latestMillis,
    qualityScore,
    contractScore,
  };
}

function renderSymbolProfile(symbol) {
  if (!$("data-symbol-profile-title")) return;
  const model = symbolProfileModel(symbol);
  const hasRows = Boolean(model.rows.length);
  const hasQuery = Boolean(model.symbol);
  $("data-symbol-profile-title").textContent = hasRows
    ? `${model.symbol} saved history`
    : hasQuery ? `${model.symbol} not in current catalog` : "No symbol selected";
  $("data-symbol-profile-note").textContent = hasRows
    ? `${numberText(model.rows.length, 0)} file${model.rows.length === 1 ? "" : "s"} / ${numberText(model.totalRows, 0)} rows / ${model.assets.join(", ") || "unknown asset"}`
    : hasQuery
      ? model.allRows.length
        ? "This symbol exists in the catalog, but current Symbol Browser facets hide every file."
        : "No scanned file matches this symbol. Diagnose can check configured roots, suggested roots, and fetch manifests."
      : "Pick a scanned symbol to summarize saved history, quality, and next actions.";
  for (const id of ["data-symbol-profile-inspect", "data-symbol-profile-workbench", "data-symbol-profile-filter"]) {
    $(id).disabled = !hasRows;
  }
  $("data-symbol-profile-compare").disabled = model.rows.length < 2;
  $("data-symbol-profile-diagnose").disabled = !hasQuery;
  const qualityStatus = model.qualityScore === 0 ? "ok" : model.qualityScore === 1 ? "warn" : model.qualityScore === 2 ? "bad" : "warn";
  const contractStatus = model.contractScore === 0 ? "ok" : model.contractScore === 1 ? "warn" : model.contractScore === 2 ? "bad" : "warn";
  const cards = [
    {
      status: hasRows ? "ok" : "bad",
      label: "Files",
      title: numberText(model.rows.length, 0),
      note: hasRows ? `${numberText(model.totalRows, 0)} total rows across selected symbol files.` : "No catalog-visible files for this symbol.",
    },
    {
      status: model.range.start && model.range.end ? "ok" : hasRows ? "warn" : "bad",
      label: "Coverage",
      title: model.range.start && model.range.end ? `${model.range.start} -> ${model.range.end}` : "n/a",
      note: model.latestMillis ? `Latest saved bar ${new Date(model.latestMillis).toISOString().slice(0, 10)}.` : "No timestamp range loaded.",
    },
    {
      status: qualityStatus,
      label: "Quality",
      title: hasRows ? countSummary(model.qualities) : "n/a",
      note: qualityStatus === "ok" ? "Best available files report ok quality." : "Inspect gaps/nulls before simulation.",
    },
    {
      status: contractStatus,
      label: "Contract",
      title: hasRows ? countSummary(model.contracts) : "n/a",
      note: contractStatus === "ok"
        ? "Best available files satisfy storage metadata checks."
        : "Review timestamp/session/bar-size/adjustment metadata before replay.",
    },
    {
      status: model.best ? "ok" : "bad",
      label: "Best File",
      title: model.best ? `${text(model.best.bar_size)} ${text(model.best.source)}` : "n/a",
      note: model.best ? `${numberText(model.best.rows, 0)} rows / ${text(model.best.storage_session)} / ${bytes(model.best.size_bytes)}` : "No inspectable file selected.",
    },
  ];
  $("data-symbol-profile-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-symbol-profile-chart").innerHTML = model.best
    ? compactDataPreviewChart(model.best)
    : `<div class="empty-card"><strong>No chartable file selected</strong><span>${hasQuery ? "Diagnose this symbol or inspect fetch jobs for saved output clues." : "Pick a symbol from the browser or directory."}</span></div>`;
  $("data-symbol-profile-files").innerHTML = hasRows
    ? model.rows.slice(0, 4).map((dataset) => `
      <div class="symbol-profile-file">
        <div>
          <strong>${escapeHtml(text(dataset.bar_size))} ${escapeHtml(text(dataset.source))}</strong>
          <span>${escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp))}</span>
          <small>${qualityBadge(dataset.quality_status, dataset.quality_warnings)} ${qualityBadge(dataset.storage_contract_status, dataset.storage_contract_warnings)} ${escapeHtml(numberText(dataset.rows, 0))} rows / ${escapeHtml(text(dataset.storage_session))}</small>
          <small class="mono">${escapeHtml(text(dataset.path))}</small>
        </div>
        <button type="button" class="secondary symbol-profile-file-open" data-path="${escapeHtml(dataset.path)}">Open</button>
      </div>
    `).join("")
    : `<div class="empty-card"><strong>${hasQuery ? "Symbol not visible" : "Choose a symbol"}</strong><span>${hasQuery ? (model.allRows.length ? "Clear or broaden Symbol Browser facets to show this symbol's catalog files." : "Run Diagnose to see whether files exist outside configured roots or fetch jobs returned no data.") : "Use typeahead, quick picks, or the Symbol Directory."}</span></div>`;
}

function symbolDirectoryControls() {
  return {
    filter: (($("data-symbol-directory-filter") || {}).value || "").trim().toLowerCase(),
    asset: (($("data-symbol-directory-asset") || {}).value || ""),
    source: (($("data-symbol-directory-source") || {}).value || ""),
    bar: (($("data-symbol-directory-bar") || {}).value || ""),
    session: (($("data-symbol-directory-session") || {}).value || ""),
    quality: (($("data-symbol-directory-quality") || {}).value || ""),
    contract: (($("data-symbol-directory-contract") || {}).value || ""),
    sort: (($("data-symbol-directory-sort") || {}).value || "files_desc"),
    limit: Number((($("data-symbol-directory-limit") || {}).value || "60")),
  };
}

function renderSymbolDirectoryFilterOptions(datasets) {
  const makeOptions = (id, values) => {
    const select = $(id);
    if (!select) return;
    const current = select.value;
    const options = Array.from(new Set((values || []).map(text).filter((item) => item !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) select.value = current;
  };
  makeOptions("data-symbol-directory-asset", datasets.map((item) => item.asset_class));
  makeOptions("data-symbol-directory-source", datasets.map((item) => item.source));
  makeOptions("data-symbol-directory-bar", datasets.map((item) => item.bar_size));
  makeOptions("data-symbol-directory-session", datasets.map((item) => item.storage_session));
  makeOptions("data-symbol-directory-quality", datasets.map((item) => item.quality_status));
  makeOptions("data-symbol-directory-contract", datasets.map((item) => item.storage_contract_status));
}

function symbolDirectoryQualityScore(qualities) {
  const rank = { ok: 0, warn: 1, bad: 2 };
  const entries = Object.keys(qualities || {});
  if (!entries.length) return 3;
  return Math.min(...entries.map((key) => rank[String(key).toLowerCase()] ?? 3));
}

function symbolDirectorySortValue(item, key) {
  if (key === "files") return Number(item.file_count || 0);
  if (key === "rows") return Number(item.row_count || 0);
  if (key === "latest") return timestampMillis(item.last_day) || 0;
  if (key === "quality") return symbolDirectoryQualityScore(item.qualities);
  if (key === "contract") return symbolDirectoryQualityScore(item.contracts);
  return String(item.symbol || "").toLowerCase();
}

function sortSymbolDirectoryRows(rows, sortKey) {
  const [key, direction] = String(sortKey || "files_desc").split("_");
  const multiplier = direction === "asc" ? 1 : -1;
  return (rows || []).slice().sort((left, right) => {
    const leftValue = symbolDirectorySortValue(left, key);
    const rightValue = symbolDirectorySortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier;
    }
    const primary = String(leftValue).localeCompare(String(rightValue)) * multiplier;
    if (primary) return primary;
    return left.symbol.localeCompare(right.symbol);
  });
}

function symbolDirectoryRows() {
  const controls = symbolDirectoryControls();
  const datasetByPath = new Map((state.dataCatalog.datasets || []).map((dataset) => [dataset.path, dataset]));
  const summaries = state.dataCatalog.symbol_summaries || [];
  const rows = summaries.length
    ? summaries.map((summary) => ({
        symbol: text(summary.symbol),
        best: datasetByPath.get(summary.best_path) || { path: summary.best_path },
        file_count: Number(summary.file_count || 0),
        row_count: Number(summary.row_count || 0),
        assets: (summary.asset_classes || []).map(text).filter((value) => value !== "n/a").sort(),
        sources: (summary.sources || []).map(text).filter((value) => value !== "n/a").sort(),
        bars: (summary.bar_sizes || []).map(text).filter((value) => value !== "n/a").sort(),
        sessions: (summary.storage_sessions || []).map(text).filter((value) => value !== "n/a").sort(),
        mixed_sessions: Boolean(summary.mixed_storage_sessions),
        session_profile: text(summary.storage_session_profile || ((summary.storage_sessions || []).join(", "))),
        qualities: summary.quality_counts || {},
        contracts: summary.storage_contract_counts || {},
        first_day: summary.first_timestamp,
        last_day: summary.last_timestamp,
      }))
    : Array.from(symbolBrowserGroups()).map(([symbol, datasets]) => {
        const totalRows = datasets.reduce((sum, dataset) => sum + Number(dataset.rows || 0), 0);
        const ranges = timestampRangeFromDatasets(datasets);
        const best = datasets[0] || {};
        return {
          symbol,
          best,
          file_count: datasets.length,
          row_count: totalRows,
          assets: Array.from(new Set(datasets.map((dataset) => text(dataset.asset_class)).filter((value) => value !== "n/a"))).sort(),
          sources: Array.from(new Set(datasets.map((dataset) => text(dataset.source)).filter((value) => value !== "n/a"))).sort(),
          bars: Array.from(new Set(datasets.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a"))).sort(),
          sessions: Array.from(new Set(datasets.map((dataset) => text(dataset.storage_session)).filter((value) => value !== "n/a"))).sort(),
          mixed_sessions: Array.from(new Set(datasets.map((dataset) => text(dataset.storage_session)).filter((value) => value !== "n/a"))).length > 1,
          session_profile: Array.from(new Set(datasets.map((dataset) => text(dataset.storage_session)).filter((value) => value !== "n/a"))).join(", ") || "unknown",
          qualities: countBy(datasets, "quality_status"),
          contracts: countBy(datasets, "storage_contract_status"),
          first_day: ranges.start,
          last_day: ranges.end,
        };
      });
  const filtered = controls.filter
    ? rows.filter((item) => {
        const haystack = [
          item.symbol,
          item.assets.join(" "),
          item.sources.join(" "),
          item.bars.join(" "),
          item.sessions.join(" "),
          countSummary(item.qualities),
          countSummary(item.contracts),
          item.first_day,
          item.last_day,
        ].map(text).join(" ").toLowerCase();
        return haystack.includes(controls.filter);
      })
    : rows;
  const faceted = filtered.filter((item) => (
    (!controls.asset || item.assets.includes(controls.asset))
    && (!controls.source || item.sources.includes(controls.source))
    && (!controls.bar || item.bars.includes(controls.bar))
    && (!controls.session || item.sessions.includes(controls.session))
    && (!controls.quality || Object.prototype.hasOwnProperty.call(item.qualities || {}, controls.quality))
    && (!controls.contract || Object.prototype.hasOwnProperty.call(item.contracts || {}, controls.contract))
  ));
  const sorted = sortSymbolDirectoryRows(faceted, controls.sort);
  return {
    rows: sorted.slice(0, Math.max(1, Math.min(200, controls.limit || 60))),
    all_rows: sorted,
    filtered_count: faceted.length,
    total_count: rows.length,
    controls,
  };
}

function countArrayValues(rows, key) {
  const counts = {};
  for (const rowItem of rows || []) {
    for (const value of rowItem[key] || []) {
      if (!value || value === "n/a") continue;
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return counts;
}

function renderSymbolDirectorySummary(directory) {
  if (!$("data-symbol-directory-summary")) return;
  const rows = directory.all_rows || [];
  const shown = directory.rows || [];
  const fileCount = rows.reduce((sum, item) => sum + Number(item.file_count || 0), 0);
  const rowCount = rows.reduce((sum, item) => sum + Number(item.row_count || 0), 0);
  const latestMillis = rows
    .map((item) => timestampMillis(item.last_day) || 0)
    .reduce((max, value) => Math.max(max, value), 0);
  const qualityIssueCount = rows.filter((item) => symbolDirectoryQualityScore(item.qualities) > 0).length;
  const contractIssueCount = rows.filter((item) => symbolDirectoryQualityScore(item.contracts) > 0).length;
  const mixedSessionCount = rows.filter((item) => item.mixed_sessions).length;
  const sourceTop = topCountEntries(countArrayValues(rows, "sources"), 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ");
  const barTop = topCountEntries(countArrayValues(rows, "bars"), 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ");
  const activeFilters = [
    directory.controls.filter ? `search ${directory.controls.filter}` : "",
    directory.controls.asset,
    directory.controls.source,
    directory.controls.bar,
    directory.controls.session,
    directory.controls.quality,
    directory.controls.contract,
  ].filter(Boolean);
  const cards = [
    {
      status: rows.length ? "ok" : directory.total_count ? "warn" : "bad",
      title: `${numberText(shown.length, 0)} / ${numberText(rows.length, 0)}`,
      label: "Shown Symbols",
      note: activeFilters.length
        ? `Filtered by ${activeFilters.join(", ")} from ${numberText(directory.total_count, 0)} total scanned symbols.`
        : `${numberText(directory.total_count, 0)} total scanned symbols are available.`,
    },
    {
      status: fileCount ? "ok" : "bad",
      title: numberText(fileCount, 0),
      label: "Files",
      note: `${numberText(rowCount, 0)} rows across the currently matched symbol set.`,
    },
    {
      status: rows.length ? "ok" : "warn",
      title: latestMillis ? new Date(latestMillis).toISOString().slice(0, 10) : "n/a",
      label: "Latest Data",
      note: `Sources: ${sourceTop || "none"}; bars: ${barTop || "none"}.`,
    },
    {
      status: qualityIssueCount ? "warn" : rows.length ? "ok" : "bad",
      title: numberText(qualityIssueCount, 0),
      label: "Quality Review",
      note: qualityIssueCount
        ? "Matched symbols include at least one warn/bad best-quality file."
        : rows.length ? "Matched symbols currently start with ok-quality files." : "No symbols matched.",
    },
    {
      status: contractIssueCount ? "warn" : rows.length ? "ok" : "bad",
      title: numberText(contractIssueCount, 0),
      label: "Contract Review",
      note: contractIssueCount
        ? "Matched symbols include files with storage-contract metadata warnings."
        : rows.length ? "Matched symbols satisfy current storage-contract checks." : "No symbols matched.",
    },
    {
      status: mixedSessionCount ? "warn" : rows.length ? "ok" : "bad",
      title: numberText(mixedSessionCount, 0),
      label: "Mixed Sessions",
      note: mixedSessionCount
        ? "Matched symbols combine RTH, extended-hours, or 24/7 files; verify the intended replay session."
        : rows.length ? "Matched symbols have a single storage-session profile." : "No symbols matched.",
    },
  ];
  $("data-symbol-directory-summary").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function firstUniqueSymbolRows(candidates) {
  const seen = new Set();
  const rows = [];
  for (const item of candidates || []) {
    const symbol = text(item && item.symbol);
    if (!symbol || symbol === "n/a" || seen.has(symbol)) continue;
    seen.add(symbol);
    rows.push(item);
  }
  return rows;
}

function symbolDirectoryRecommendationRows(directory) {
  const rows = directory.all_rows || [];
  const newest = rows.slice().sort((left, right) => (timestampMillis(right.last_day) || 0) - (timestampMillis(left.last_day) || 0))[0] || null;
  const largest = rows.slice().sort((left, right) => Number(right.row_count || 0) - Number(left.row_count || 0))[0] || null;
  const cleanest = rows.slice().sort((left, right) => {
    const quality = symbolDirectoryQualityScore(left.qualities) - symbolDirectoryQualityScore(right.qualities);
    if (quality) return quality;
    const contract = symbolDirectoryQualityScore(left.contracts) - symbolDirectoryQualityScore(right.contracts);
    if (contract) return contract;
    return Number(right.row_count || 0) - Number(left.row_count || 0);
  })[0] || null;
  const mostFiles = rows.slice().sort((left, right) => Number(right.file_count || 0) - Number(left.file_count || 0))[0] || null;
  return firstUniqueSymbolRows([newest, largest, cleanest, mostFiles]).slice(0, 4);
}

function renderSymbolDirectoryAssistant(directory) {
  if (!$("data-directory-assistant-title") || !$("data-directory-assistant-cards") || !$("data-directory-assistant-actions")) return;
  const rows = directory.all_rows || [];
  const shown = directory.rows || [];
  const recommendations = symbolDirectoryRecommendationRows(directory);
  const latest = recommendations.find((item) => timestampMillis(item.last_day)) || null;
  const qualityOk = rows.filter((item) => symbolDirectoryQualityScore(item.qualities) === 0).length;
  const contractOk = rows.filter((item) => symbolDirectoryQualityScore(item.contracts) === 0).length;
  const compareReady = rows.filter((item) => Number(item.file_count || 0) >= 2).length;
  const activeFilters = [
    directory.controls.filter ? `search ${directory.controls.filter}` : "",
    directory.controls.asset,
    directory.controls.source,
    directory.controls.bar,
    directory.controls.session,
    directory.controls.quality,
    directory.controls.contract,
  ].filter(Boolean);
  let title = "No Symbols Matched";
  let note = activeFilters.length
    ? "No saved symbols match the current directory filters. Clear or broaden the filters."
    : "Configure data roots or run a fetch job, then refresh Data Library.";
  if (rows.length) {
    title = recommendations.length ? `Try ${text(recommendations[0].symbol)}` : "Symbols Available";
    note = activeFilters.length
      ? `${numberText(shown.length, 0)} shown from ${numberText(rows.length, 0)} matched symbols after ${activeFilters.join(", ")}.`
      : `${numberText(rows.length, 0)} scanned symbols are available; start with recent, large, clean, or multi-file symbols.`;
  }
  $("data-directory-assistant-title").textContent = title;
  $("data-directory-assistant-note").textContent = note;
  const cards = [
    {
      status: rows.length ? "ok" : "bad",
      label: "Matched",
      title: `${numberText(shown.length, 0)} / ${numberText(rows.length, 0)}`,
      note: activeFilters.length ? `Filters: ${activeFilters.join(", ")}.` : "No directory filters applied.",
    },
    {
      status: latest ? "ok" : "warn",
      label: "Newest",
      title: latest ? text(latest.symbol) : "n/a",
      note: latest ? `Latest bar ${text(latest.last_day)}.` : "No timestamped symbol row.",
    },
    {
      status: qualityOk ? "ok" : rows.length ? "warn" : "bad",
      label: "Clean",
      title: numberText(qualityOk, 0),
      note: rows.length ? `${numberText(rows.length - qualityOk, 0)} matched symbol${rows.length - qualityOk === 1 ? "" : "s"} need quality review.` : "No quality rows loaded.",
    },
    {
      status: contractOk ? "ok" : rows.length ? "warn" : "bad",
      label: "Contract Clear",
      title: numberText(contractOk, 0),
      note: rows.length ? `${numberText(rows.length - contractOk, 0)} matched symbol${rows.length - contractOk === 1 ? "" : "s"} need metadata review.` : "No contract rows loaded.",
    },
    {
      status: compareReady ? "ok" : rows.length ? "warn" : "bad",
      label: "Compare Ready",
      title: numberText(compareReady, 0),
      note: "Symbols with at least two saved files can be compared before simulation.",
    },
  ];
  $("data-directory-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-directory-assistant-actions").innerHTML = recommendations.length
    ? recommendations.map((item, index) => {
        const symbol = text(item.symbol);
        const bestPath = text((item.best || {}).path);
        const compareDisabled = Number(item.file_count || 0) < 2 ? " disabled" : "";
        return `
          <div class="data-directory-action-card">
            <div>
              <span>${escapeHtml(index === 0 ? "Recommended" : "Candidate")}</span>
              <strong>${escapeHtml(symbol)}</strong>
              <small>${escapeHtml(numberText(item.file_count, 0))} files / ${escapeHtml(numberText(item.row_count, 0))} rows / ${escapeHtml(rangeLabel(item.first_day, item.last_day))}</small>
              <small>${escapeHtml(item.assets.join(", ") || "unknown asset")} / ${escapeHtml(item.sources.join(", ") || "unknown source")} / quality ${escapeHtml(countSummary(item.qualities))} / contract ${escapeHtml(countSummary(item.contracts))}</small>
            </div>
            <div>
              <button type="button" data-directory-action="inspect" data-symbol="${escapeHtml(symbol)}" data-path="${escapeHtml(bestPath)}">Inspect</button>
              <button type="button" class="secondary" data-directory-action="workbench" data-symbol="${escapeHtml(symbol)}" data-path="${escapeHtml(bestPath)}">Workbench</button>
              <button type="button" class="secondary" data-directory-action="compare" data-symbol="${escapeHtml(symbol)}"${compareDisabled}>Compare</button>
              <button type="button" class="secondary" data-directory-action="filter" data-symbol="${escapeHtml(symbol)}">Filter</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No symbol recommendation</strong><span>Clear filters, increase the catalog limit, or configure/fetch saved data.</span></div>`;
}

function renderSymbolDirectory() {
  if (!$("data-symbol-directory") || !$("data-symbol-directory-note")) return;
  const groups = symbolBrowserGroups();
  renderSymbolDirectoryFilterOptions(state.dataCatalog.datasets || []);
  const directory = symbolDirectoryRows();
  const rows = directory.rows;
  const filteredCount = directory.filtered_count;
  const totalSymbols = Number(state.dataCatalog.symbol_count || groups.size || directory.total_count || 0);
  const activeFilters = [
    directory.controls.filter ? `"${directory.controls.filter}"` : "",
    directory.controls.asset,
    directory.controls.source,
    directory.controls.bar,
    directory.controls.session,
    directory.controls.quality,
    directory.controls.contract,
  ].filter(Boolean);
  const filterLabel = activeFilters.length ? ` matching ${activeFilters.join(", ")}` : "";
  $("data-symbol-directory-note").textContent = totalSymbols
    ? `${numberText(rows.length, 0)} shown / ${numberText(filteredCount, 0)}${filterLabel} / ${numberText(totalSymbols, 0)} scanned symbol${totalSymbols === 1 ? "" : "s"}`
    : "No scanned symbols loaded";
  renderSymbolDirectorySummary(directory);
  renderSymbolDirectoryAssistant(directory);
  $("data-symbol-directory").innerHTML = rows.length
    ? rows.map((item) => {
        const symbol = escapeHtml(item.symbol);
        const bestPath = escapeHtml(text(item.best.path));
        const canCompare = Number(item.file_count || 0) >= 2;
        return `
          <div class="symbol-directory-card">
            <div>
              <span class="eyebrow">${escapeHtml(item.assets.join(", ") || "unknown asset")}</span>
              <strong>${symbol}</strong>
              <small>${escapeHtml(numberText(item.file_count, 0))} file${item.file_count === 1 ? "" : "s"} / ${escapeHtml(numberText(item.row_count, 0))} rows</small>
              <small>${escapeHtml(item.sources.join(", ") || "unknown source")} / ${escapeHtml(item.bars.join(", ") || "unknown bar")}</small>
              <small>${escapeHtml(item.session_profile || item.sessions.join(", ") || "unknown session")}${item.mixed_sessions ? " / mixed session review" : ""}</small>
              <small>${escapeHtml(rangeLabel(item.first_day, item.last_day))}</small>
              <small>quality ${escapeHtml(countSummary(item.qualities))} / contract ${escapeHtml(countSummary(item.contracts))}</small>
            </div>
            <div class="symbol-directory-actions">
              <button type="button" class="secondary symbol-directory-filter" data-symbol="${symbol}">Filter</button>
              <button type="button" class="secondary symbol-directory-inspect" data-symbol="${symbol}" data-path="${bestPath}">Inspect</button>
              <button type="button" class="secondary symbol-directory-compare" data-symbol="${symbol}"${canCompare ? "" : " disabled"}>Compare</button>
              <button type="button" class="secondary symbol-directory-diagnose" data-symbol="${symbol}">Diagnose</button>
            </div>
          </div>
        `;
      }).join("")
    : directory.controls.filter
      ? `<div class="empty-card"><strong>No symbols match</strong><span>Clear the directory filter or search for a different symbol, asset, source, bar size, or quality.</span></div>`
      : `<div class="empty-card"><strong>No scanned symbols</strong><span>Configure data roots or run a fetch job, then refresh the catalog.</span></div>`;
}

function countSummary(counts) {
  const entries = Object.entries(counts || {});
  return entries.length
    ? entries.map(([key, value]) => `${key}:${numberText(value, 0)}`).join(" ")
    : "none";
}

function topCountEntries(counts, limit = 4) {
  return Object.entries(counts || {})
    .filter(([key, value]) => key && key !== "n/a" && Number(value || 0) > 0)
    .sort((left, right) => {
      const countDelta = Number(right[1] || 0) - Number(left[1] || 0);
      return countDelta || String(left[0]).localeCompare(String(right[0]));
    })
    .slice(0, limit);
}

function breakdownChips(label, counts) {
  const entries = topCountEntries(counts);
  const chips = entries.length
    ? entries.map(([key, value]) => `<span class="breakdown-chip">${escapeHtml(key)} ${escapeHtml(numberText(value, 0))}</span>`).join("")
    : `<span class="breakdown-chip">none</span>`;
  return `<div class="breakdown-group"><span>${escapeHtml(label)}</span><div class="breakdown-chips">${chips}</div></div>`;
}

function countBy(rows, key) {
  const counts = {};
  for (const rowItem of rows || []) {
    const value = text(rowItem[key]);
    if (!value || value === "n/a") continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function dataUniverseRows() {
  const datasets = state.dataCatalog.datasets || [];
  const datasetByPath = new Map(datasets.map((dataset) => [dataset.path, dataset]));
  const summaries = state.dataCatalog.symbol_summaries || [];
  if (summaries.length) {
    return summaries.map((summary) => ({
      symbol: text(summary.symbol),
      best: datasetByPath.get(summary.best_path) || { path: summary.best_path },
      file_count: Number(summary.file_count || 0),
      row_count: Number(summary.row_count || 0),
      assets: (summary.asset_classes || []).map(text).filter((value) => value !== "n/a").sort(),
      sources: (summary.sources || []).map(text).filter((value) => value !== "n/a").sort(),
      bars: (summary.bar_sizes || []).map(text).filter((value) => value !== "n/a").sort(),
      sessions: (summary.storage_sessions || []).map(text).filter((value) => value !== "n/a").sort(),
      mixed_sessions: Boolean(summary.mixed_storage_sessions),
      session_profile: text(summary.storage_session_profile || ((summary.storage_sessions || []).join(", "))),
      qualities: summary.quality_counts || {},
      contracts: summary.storage_contract_counts || {},
      first_day: summary.first_timestamp,
      last_day: summary.last_timestamp,
      best_quality_status: text(summary.best_quality_status),
      best_storage_contract_status: text(summary.best_storage_contract_status),
      best_rows: Number(summary.best_rows || 0),
    }));
  }
  return Array.from(symbolBrowserGroups()).map(([symbol, rows]) => {
    const ranges = timestampRangeFromDatasets(rows);
    const best = rows[0] || {};
    return {
      symbol,
      best,
      file_count: rows.length,
      row_count: rows.reduce((sum, dataset) => sum + Number(dataset.rows || 0), 0),
      assets: Array.from(new Set(rows.map((dataset) => text(dataset.asset_class)).filter((value) => value !== "n/a"))).sort(),
      sources: Array.from(new Set(rows.map((dataset) => text(dataset.source)).filter((value) => value !== "n/a"))).sort(),
      bars: Array.from(new Set(rows.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a"))).sort(),
      sessions: Array.from(new Set(rows.map((dataset) => text(dataset.storage_session)).filter((value) => value !== "n/a"))).sort(),
      mixed_sessions: Array.from(new Set(rows.map((dataset) => text(dataset.storage_session)).filter((value) => value !== "n/a"))).length > 1,
      session_profile: Array.from(new Set(rows.map((dataset) => text(dataset.storage_session)).filter((value) => value !== "n/a"))).join(", ") || "unknown",
      qualities: countBy(rows, "quality_status"),
      contracts: countBy(rows, "storage_contract_status"),
      first_day: ranges.start,
      last_day: ranges.end,
      best_quality_status: text(best.quality_status),
      best_storage_contract_status: text(best.storage_contract_status),
      best_rows: Number(best.rows || 0),
    };
  });
}

function renderDataUniversePanel() {
  if (!$("data-universe-title") || !$("data-universe-cards") || !$("data-universe-symbols")) return;
  const rows = dataUniverseRows();
  const fileCount = rows.reduce((sum, item) => sum + Number(item.file_count || 0), 0);
  const rowCount = rows.reduce((sum, item) => sum + Number(item.row_count || 0), 0);
  const latestMillis = rows
    .map((item) => timestampMillis(item.last_day) || 0)
    .reduce((max, value) => Math.max(max, value), 0);
  const qualityIssueSymbols = rows.filter((item) => Number(item.qualities.bad || 0) || Number(item.qualities.warn || 0));
  const contractIssueSymbols = rows.filter((item) => Number(item.contracts.bad || 0) || Number(item.contracts.warn || 0));
  const multiFileSymbols = rows.filter((item) => Number(item.file_count || 0) >= 2);
  const mixedSessionSymbols = rows.filter((item) => item.mixed_sessions);
  const sourceTop = topCountEntries(countArrayValues(rows, "sources"), 4);
  const barTop = topCountEntries(countArrayValues(rows, "bars"), 4);
  const sessionTop = topCountEntries(countArrayValues(rows, "sessions"), 4);
  const assetsTop = topCountEntries(countArrayValues(rows, "assets"), 4);
  const topSymbols = rows.slice()
    .sort((left, right) => Number(right.row_count || 0) - Number(left.row_count || 0) || Number(right.file_count || 0) - Number(left.file_count || 0))
    .slice(0, 6);
  let nextAction = "Browse";
  let note = "Search symbols, inspect a file, compare related histories, or send selected datasets to Workbench.";
  if (!rows.length) {
    nextAction = "Configure Roots";
    note = "No saved-data universe is visible yet. Configure data roots or run a fetch job, then refresh Data Library.";
  } else if (qualityIssueSymbols.length) {
    nextAction = "Review Quality";
    note = `${numberText(qualityIssueSymbols.length, 0)} symbol${qualityIssueSymbols.length === 1 ? "" : "s"} have warn/bad files. Review diagnostics before replay.`;
  } else if (contractIssueSymbols.length) {
    nextAction = "Review Metadata";
    note = `${numberText(contractIssueSymbols.length, 0)} symbol${contractIssueSymbols.length === 1 ? "" : "s"} have storage-contract warnings. Review metadata before replay.`;
  } else if (!multiFileSymbols.length && rows.length > 1) {
    nextAction = "Compare Symbols";
    note = "The universe has multiple symbols. Use Compare for overlapping date windows or fetch additional bar sizes for same-symbol checks.";
  }
  $("data-universe-title").textContent = rows.length
    ? `${numberText(rows.length, 0)} scanned symbol${rows.length === 1 ? "" : "s"}`
    : "No universe loaded";
  $("data-universe-note").textContent = rows.length
    ? `${numberText(fileCount, 0)} files / ${numberText(rowCount, 0)} rows. ${note}`
    : note;
  const cards = [
    {
      label: "Latest Data",
      status: latestMillis ? "ok" : rows.length ? "warn" : "bad",
      title: latestMillis ? new Date(latestMillis).toISOString().slice(0, 10) : "n/a",
      note: latestMillis ? `Most recent saved timestamp across scanned symbols. Next: ${nextAction}.` : "No timestamp range was found.",
    },
    {
      label: "Sources",
      status: sourceTop.length ? "ok" : rows.length ? "warn" : "bad",
      title: sourceTop.length ? sourceTop.map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") : "none",
      note: assetsTop.length ? `Assets: ${assetsTop.map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ")}.` : "No asset/source metadata found.",
    },
    {
      label: "Bars And Sessions",
      status: mixedSessionSymbols.length ? "warn" : barTop.length || sessionTop.length ? "ok" : rows.length ? "warn" : "bad",
      title: barTop.length ? barTop.map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") : "none",
      note: mixedSessionSymbols.length
        ? `${numberText(mixedSessionSymbols.length, 0)} symbol${mixedSessionSymbols.length === 1 ? "" : "s"} have mixed session files; verify RTH/extended scope before replay.`
        : sessionTop.length ? `Sessions: ${sessionTop.map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ")}.` : "No storage-session metadata found.",
    },
    {
      label: "Replay Readiness",
      status: !rows.length ? "bad" : qualityIssueSymbols.length || contractIssueSymbols.length ? "warn" : "ok",
      title: qualityIssueSymbols.length || contractIssueSymbols.length
        ? `${numberText(qualityIssueSymbols.length + contractIssueSymbols.length, 0)} review`
        : rows.length ? "Ready To Inspect" : "No Data",
      note: qualityIssueSymbols.length || contractIssueSymbols.length
        ? `${numberText(qualityIssueSymbols.length, 0)} quality / ${numberText(contractIssueSymbols.length, 0)} contract symbol reviews.`
        : multiFileSymbols.length
        ? `${numberText(multiFileSymbols.length, 0)} symbol${multiFileSymbols.length === 1 ? "" : "s"} have multiple files for same-symbol comparisons.`
        : "Inspect representative files before using this universe in Workbench.",
    },
  ];
  $("data-universe-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-universe-symbols").innerHTML = topSymbols.length
    ? topSymbols.map((item) => `
      <button type="button" class="data-universe-symbol" data-home-action="filter" data-symbol="${escapeHtml(item.symbol)}">
        <strong>${escapeHtml(item.symbol)}</strong>
        <span>${escapeHtml(numberText(item.file_count, 0))} files / ${escapeHtml(numberText(item.row_count, 0))} rows</span>
        <small>${escapeHtml(item.sources.join(", ") || "unknown source")} / ${escapeHtml(item.bars.join(", ") || "unknown bar")} / ${escapeHtml(item.session_profile || item.sessions.join(", ") || "unknown session")}</small>
        <small>quality ${escapeHtml(countSummary(item.qualities))} / contract ${escapeHtml(countSummary(item.contracts))}</small>
      </button>
    `).join("")
    : `<div class="empty-card"><strong>No symbols to rank</strong><span>Refresh Data Library after adding saved data roots.</span></div>`;
}

function timestampRangeFromDatasets(datasets) {
  const starts = (datasets || []).map((dataset) => timestampMillis(dataset.first_timestamp)).filter((value) => value !== null);
  const ends = (datasets || []).map((dataset) => timestampMillis(dataset.last_timestamp)).filter((value) => value !== null);
  if (!starts.length || !ends.length) return { start: null, end: null };
  return {
    start: new Date(Math.min(...starts)).toISOString().slice(0, 10),
    end: new Date(Math.max(...ends)).toISOString().slice(0, 10),
  };
}

function shellQuote(value) {
  const raw = text(value);
  return `'${raw.replace(/'/g, "'\\''")}'`;
}

function approvalPreviewCommand(preview, artifacts) {
  const previewFile = text((artifacts || {}).order_preview_file);
  const approvalId = text((preview || {}).approval_id);
  if (!previewFile || !approvalId) return "";
  return `python3 scripts/approve_order_preview.py ${shellQuote(previewFile)} --approval-id ${shellQuote(approvalId)}`;
}

function approvalPreviewCanApprove(preview, artifacts) {
  const status = text(preview && preview.approval_status).toLowerCase();
  return Boolean(
    artifacts
    && artifacts.order_preview_file
    && preview
    && preview.approval_id
    && preview.approval_digest
    && ["required", "approval_required"].includes(status)
  );
}

function csvCell(value) {
  const raw = value === null || value === undefined ? "" : String(value);
  return /[",\n\r]/.test(raw) ? `"${raw.replace(/"/g, '""')}"` : raw;
}

function csvLine(values) {
  return values.map(csvCell).join(",");
}

function dirname(path) {
  const raw = String(path || "");
  const normalized = raw.replace(/\/+$/, "");
  const index = normalized.lastIndexOf("/");
  if (index <= 0) return index === 0 ? "/" : ".";
  return normalized.slice(0, index);
}

function manifestPathFilterPaths() {
  return new Set(((state.manifestPathFilter || {}).paths || []).map(text).filter((value) => value !== "n/a"));
}

function fetchVisibleOutputPaths(detail = state.fetchManifestDetail || {}) {
  const paths = new Set();
  for (const item of (detail.outputs || [])) {
    if (!item.data_detail_available || !item.data_detail_path) continue;
    paths.add(text(item.data_detail_path));
  }
  return Array.from(paths).sort();
}

function yamlScalar(value) {
  return JSON.stringify(String(value || ""));
}

function dataRootConfigPaths() {
  const diagnostics = state.diagnostics || {};
  const paths = new Set();
  for (const root of [...(diagnostics.data_roots || []), ...(diagnostics.suggested_data_roots || [])]) {
    const value = text(root.display_path || root.path);
    if (value && value !== "n/a") paths.add(value);
  }
  return Array.from(paths).sort();
}

function dataRootsYamlSnippet() {
  const paths = dataRootConfigPaths();
  if (!paths.length) return "";
  return [
    "dashboard:",
    "  data_roots:",
    ...paths.map((path) => `    - ${yamlScalar(path)}`),
  ].join("\n");
}

function fetchManifestRootConfigPaths() {
  const payload = state.fetchManifests || {};
  const paths = new Set();
  for (const root of (payload.roots || [])) {
    const value = text(root.display_path || root.path);
    if (value && value !== "n/a") paths.add(value);
  }
  return Array.from(paths).sort();
}

function fetchManifestRootsYamlSnippet() {
  const paths = fetchManifestRootConfigPaths();
  if (!paths.length) return "";
  return [
    "dashboard:",
    "  fetch_manifest_roots:",
    ...paths.map((path) => `    - ${yamlScalar(path)}`),
  ].join("\n");
}

function replayStarterCommand(detail) {
  const path = detail && detail.path;
  const symbol = detail && detail.symbol;
  if (!path) return "";
  return [
    `# Selected dataset: ${text(symbol)} ${path}`,
    "# Use Workbench to generate a private/public-safe draft that maps this file, then run:",
    "python3 live/plugin_runner.py --config <saved_draft.yaml> --mode replay --max-steps 200",
  ].join("\n");
}

function renderDataCatalog() {
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  const filtered = filteredDataCatalog(datasets);
  const loadState = dataLibraryLoadState();
  const firstCatalogLoad = loadState.catalogLoading && !loadState.catalogLoaded && datasets.length === 0;
  renderDataFilterOptions(datasets);
  renderDataLibrarySummary();
  renderDataHome(filtered);
  renderDataFacetSummary(datasets, filtered);
  renderDataSearchAssistant(filtered);
  renderSymbolBrowser();
  renderSymbolDirectory();
  $("data-catalog-body").innerHTML = filtered.length
    ? filtered.map((dataset) => row([
        escapeHtml(dataset.symbol),
        escapeHtml(dataset.asset_class),
        escapeHtml(dataset.source),
        escapeHtml(dataset.bar_size),
        escapeHtml(dataset.storage_session),
        escapeHtml(dataset.adjustment_status),
        escapeHtml(dataset.format),
        escapeHtml(dataset.rows),
        escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp)),
        escapeHtml(interval(dataset.median_interval_seconds)),
        escapeHtml(dataset.estimated_missing_intervals),
        qualityBadge(dataset.quality_status, dataset.quality_warnings),
        qualityBadge(dataset.storage_contract_status, dataset.storage_contract_warnings),
        escapeHtml(dataset.source_timezone),
        miniChart(dataset.preview || []),
        escapeHtml(bytes(dataset.size_bytes)),
        escapeHtml(timestampAgeLabel(dataset.modified_at)),
        `<span class="mono">${escapeHtml(dataset.path)}</span>`,
        `<span class="button-pair"><button type="button" class="secondary inspect-data" data-path="${escapeHtml(dataset.path)}">Inspect</button><button type="button" class="secondary copy-data-path-row" data-path="${escapeHtml(dataset.path)}">Copy Path</button></span>`,
      ])).join("")
    : firstCatalogLoad
      ? row([`<span class="status-warn">Loading saved-data catalog...</span>`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""])
      : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  const errors = catalog.errors || [];
  const filterLabel = [
    `${numberText(filtered.length, 0)} shown / ${numberText(datasets.length, 0)} found`,
    `quality ${countSummary(catalog.quality_counts)}`,
    `bars ${countSummary(catalog.bar_size_counts)}`,
    `assets ${countSummary(catalog.asset_class_counts)}`,
    `sources ${countSummary(catalog.source_counts)}`,
    `sessions ${countSummary(catalog.storage_session_counts)}`,
    `contracts ${countSummary(catalog.storage_contract_counts)}`,
    `rows ${numberText(catalog.row_count_total, 0)}`,
    `size ${bytes(catalog.size_bytes_total)}`,
  ].join(" | ");
  const errorText = errors.length
    ? errors.map((item) => `<span class="status-warn">${escapeHtml(item.path)}: ${escapeHtml(item.error)}</span>`).join("<br>")
    : "";
  if (loadState.catalogLoading) {
    const loadingText = loadState.catalogLoaded
      ? "Refreshing saved-data catalog in the background"
      : "Loading saved-data catalog from configured roots";
    $("data-catalog-errors").innerHTML = `<span class="status-warn">${escapeHtml(loadingText)}; large local caches can take tens of seconds.</span>`;
  } else if (loadState.catalogError) {
    $("data-catalog-errors").innerHTML = `<span class="status-bad">Data catalog refresh failed: ${escapeHtml(loadState.catalogError)}</span>`;
  } else {
    $("data-catalog-errors").innerHTML = errorText
      ? `${escapeHtml(filterLabel)}<br>${errorText}`
      : escapeHtml(filterLabel);
  }
}

function dataFilterSummary() {
  const filters = dataCatalogFilters();
  const labels = [];
  if (filters.text) labels.push(`search "${filters.text}"`);
  if (filters.quality) labels.push(`quality ${filters.quality}`);
  if (filters.bar) labels.push(`bar ${filters.bar}`);
  if (filters.asset) labels.push(`asset ${filters.asset}`);
  if (filters.source) labels.push(`source ${filters.source}`);
  if (filters.session) labels.push(`session ${filters.session}`);
  if (filters.contract) labels.push(`contract ${filters.contract}`);
  if (state.manifestPathFilter && (state.manifestPathFilter.paths || []).length) {
    labels.push(`fetch outputs ${numberText((state.manifestPathFilter.paths || []).length, 0)}`);
  }
  if (filters.sort && filters.sort !== "modified_desc") labels.push(`sort ${filters.sort.replace("_", " ")}`);
  return labels;
}

function renderDataFacetSummary(datasets = [], filteredRows = []) {
  if (!$("data-facet-summary-title") || !$("data-facet-summary-cards") || !$("data-facet-clear")) return;
  const filters = dataCatalogFilters();
  const labels = dataFilterSummary();
  const hiddenCount = Math.max(0, datasets.length - filteredRows.length);
  const symbolCount = new Set(filteredRows.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a")).size;
  const assetCounts = countBy(filteredRows, "asset_class");
  const sourceCounts = countBy(filteredRows, "source");
  const barCounts = countBy(filteredRows, "bar_size");
  const sessionCounts = countBy(filteredRows, "storage_session");
  const qualityCounts = countBy(filteredRows, "quality_status");
  const contractCounts = countBy(filteredRows, "storage_contract_status");
  const newest = filteredRows
    .map((dataset) => timestampMillis(dataset.modified_at))
    .filter((value) => value !== null)
    .sort((left, right) => right - left)[0] || null;
  $("data-facet-summary-title").textContent = datasets.length
    ? `${numberText(filteredRows.length, 0)} visible file${filteredRows.length === 1 ? "" : "s"}`
    : "No saved files loaded";
  $("data-facet-summary-note").textContent = labels.length
    ? `${labels.join(" / ")}; ${numberText(hiddenCount, 0)} file${hiddenCount === 1 ? "" : "s"} hidden.`
    : datasets.length
      ? "No Browse filters are active; use facets to narrow by asset, source, bar, session, quality, or contract state."
      : "Refresh Data Library or configure data roots before browsing saved files.";
  $("data-facet-clear").disabled = !labels.length;
  const cards = [
    {
      label: "Active Filters",
      status: labels.length ? "warn" : datasets.length ? "ok" : "bad",
      title: labels.length ? numberText(labels.length, 0) : "None",
      note: labels.length ? labels.join(" / ") : "Showing all loaded catalog rows.",
    },
    {
      label: "Symbols",
      status: symbolCount ? "ok" : datasets.length ? "warn" : "bad",
      title: numberText(symbolCount, 0),
      note: `${numberText(filteredRows.length, 0)} files visible / ${numberText(hiddenCount, 0)} hidden.`,
    },
    {
      label: "Assets",
      status: filteredRows.length ? "ok" : "warn",
      title: countSummary(assetCounts) || "none",
      note: "Stock, ETF, crypto, and unknown asset inference from catalog metadata.",
    },
    {
      label: "Sources",
      status: filteredRows.length ? "ok" : "warn",
      title: topCountEntries(sourceCounts, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") || "none",
      note: "IBKR, Schwab, Polygon, FirstRate, ZeroHash, file, or inferred source labels.",
    },
    {
      label: "Bars And Sessions",
      status: filteredRows.length ? "ok" : "warn",
      title: topCountEntries(barCounts, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") || "none",
      note: topCountEntries(sessionCounts, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") || "No storage-session metadata.",
    },
    {
      label: "Readiness",
      status: Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0)
        ? "bad"
        : Number(qualityCounts.warn || 0) || Number(contractCounts.warn || 0) ? "warn" : filteredRows.length ? "ok" : "bad",
      title: `Q ${countSummary(qualityCounts) || "n/a"}`,
      note: `Contract ${countSummary(contractCounts) || "n/a"}; newest ${newest ? shortTimestampAgeLabel(new Date(newest).toISOString()) : "n/a"}.`,
    },
  ];
  $("data-facet-summary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function clearDataCatalogFilters() {
  $("data-filter-text").value = "";
  $("data-filter-quality").value = "";
  $("data-filter-bar").value = "";
  $("data-filter-asset").value = "";
  $("data-filter-source").value = "";
  $("data-filter-session").value = "";
  $("data-filter-contract").value = "";
  $("data-filter-sort").value = "modified_desc";
  state.manifestPathFilter = null;
}

function catalogScopeIsCapped(catalog = {}) {
  const limit = Number(catalog.limit || $("data-catalog-limit").value || 0);
  const count = Number(catalog.count || (catalog.datasets || []).length || 0);
  const rootSummaries = catalog.root_summaries || [];
  return Boolean(
    limit
    && count >= limit
    && rootSummaries.some((item) => item.scan_capped || item.not_scanned_reason === "global catalog limit reached")
  );
}

function setDataCatalogLimitToMax() {
  const limit = $("data-catalog-limit");
  const values = Array.from(limit.options || []).map((option) => Number(option.value)).filter(Boolean);
  const next = Math.max(...values, Number(limit.value || 0), Number((state.dataCatalog || {}).limit || 0));
  if (next) limit.value = String(next);
  dataLibraryLoadState().catalogLimitTouched = true;
}

function renderDataScopeAssistant(filteredRows = []) {
  if (!$("data-scope-assistant-title") || !$("data-scope-assistant-cards") || !$("data-scope-assistant-actions")) return;
  const catalog = state.dataCatalog || {};
  const diagnostics = state.diagnostics || {};
  const datasets = catalog.datasets || [];
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const totalRootFiles = roots.reduce((sum, root) => sum + Number(root.data_file_count || 0), 0);
  const count = Number(catalog.count || datasets.length || 0);
  const limit = Number(catalog.limit || $("data-catalog-limit").value || 0);
  const settings = dataCatalogSettings();
  const maxLimit = Math.max(settings.defaultLimit, settings.maxLimit);
  const capped = catalogScopeIsCapped(catalog);
  const filterLabels = dataFilterSummary();
  const hiddenByFilters = Math.max(0, count - filteredRows.length);
  const symbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const parserErrors = Number(catalog.error_count || 0);
  const qualityCounts = catalog.quality_counts || {};
  const contractCounts = catalog.storage_contract_counts || countBy(datasets, "storage_contract_status");
  const qualityIssues = Number(qualityCounts.bad || 0) + Number(qualityCounts.warn || 0);
  const contractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  const loadState = dataLibraryLoadState();
  const loading = loadState.catalogLoading && !loadState.catalogLoaded && !count;
  let status = "bad";
  let title = "No Catalog Loaded";
  let note = "Refresh Data Library or configure dashboard.data_roots before browsing saved historical data.";
  if (loading) {
    status = "warn";
    title = "Scanning Saved Data";
    note = "Configured roots are loading in the background; large local caches can take tens of seconds.";
  } else if (capped) {
    status = "warn";
    title = "Catalog May Be Capped";
    note = `Loaded ${numberText(count, 0)} rows at the ${numberText(limit, 0)} row limit. Raise the scan limit before concluding symbols are missing.`;
  } else if (hiddenByFilters === count && count) {
    status = "warn";
    title = "Filters Hide Everything";
    note = `${filterLabels.join(" / ")} hides all ${numberText(count, 0)} loaded catalog rows.`;
  } else if (suggestedRoots.length && (!roots.length || !count)) {
    status = "bad";
    title = "Suggested Roots Found";
    note = `${numberText(suggestedRoots.length, 0)} unconfigured root${suggestedRoots.length === 1 ? "" : "s"} may contain saved data outside the current scan.`;
  } else if (parserErrors || qualityIssues || contractIssues) {
    status = parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) ? "bad" : "warn";
    title = "Review Data Readiness";
    note = `${numberText(parserErrors, 0)} parser errors, ${numberText(qualityIssues, 0)} quality reviews, ${numberText(contractIssues, 0)} metadata reviews.`;
  } else if (count) {
    status = "ok";
    title = "Catalog Scope Ready";
    note = `${numberText(symbols.size, 0)} symbols and ${numberText(count, 0)} files are loaded under configured roots.`;
  }
  $("data-scope-assistant-title").textContent = title;
  $("data-scope-assistant-title").className = statusClass(status);
  $("data-scope-assistant-note").textContent = note;
  const cards = [
    {
      status: loading ? "warn" : capped ? "warn" : count ? "ok" : "bad",
      label: "Loaded Files",
      title: count ? `${numberText(count, 0)} / ${limit ? numberText(limit, 0) : "n/a"}` : loading ? "Loading" : "None",
      note: capped ? "The scan hit its row cap." : count ? "Rows currently available to Browse, Inspect, Compare, and Workbench." : "No catalog rows are loaded.",
    },
    {
      status: symbols.size ? "ok" : count ? "warn" : "bad",
      label: "Symbols",
      title: numberText(symbols.size, 0),
      note: symbols.size ? "Use Browse or the Symbol Directory to search the scanned universe." : "No symbols could be inferred from loaded files.",
    },
    {
      status: hiddenByFilters ? hiddenByFilters === count ? "bad" : "warn" : count ? "ok" : "bad",
      label: "Filter Scope",
      title: `${numberText(filteredRows.length, 0)} shown`,
      note: hiddenByFilters ? `${numberText(hiddenByFilters, 0)} rows hidden by current filters.` : filterLabels.length ? "Filters are active but still show rows." : "No catalog filters are active.",
    },
    {
      status: suggestedRoots.length ? "warn" : roots.length ? "ok" : "bad",
      label: "Roots",
      title: `${numberText(roots.length, 0)} configured`,
      note: suggestedRoots.length
        ? `${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"} not scanned.`
        : `${numberText(totalRootFiles, 0)} root-scanner file${totalRootFiles === 1 ? "" : "s"} visible.`,
    },
    {
      status: parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) ? "bad" : qualityIssues || contractIssues ? "warn" : count ? "ok" : "bad",
      label: "Readiness",
      title: qualityIssues || contractIssues || parserErrors ? `${numberText(qualityIssues + contractIssues + parserErrors, 0)} review` : count ? "Clean Enough" : "Unknown",
      note: `quality ${countSummary(qualityCounts) || "n/a"} / contract ${countSummary(contractCounts) || "n/a"}`,
    },
  ];
  $("data-scope-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-scope-assistant-actions").innerHTML = [
    {
      action: "raise-limit",
      status: capped || (limit && limit < maxLimit) ? "warn" : "ok",
      title: "Scan Max Rows",
      note: `Set Rows to scan to ${numberText(maxLimit, 0)} and refresh the catalog.`,
      disabled: !maxLimit || limit >= maxLimit,
    },
    {
      action: "clear-filters",
      status: filterLabels.length ? "ok" : "warn",
      title: "Clear Filters",
      note: filterLabels.length ? "Show every loaded catalog row again." : "No catalog filters are active.",
      disabled: !filterLabels.length,
    },
    {
      action: "browse",
      status: count ? "ok" : "bad",
      title: "Browse Symbols",
      note: "Open the searchable saved-symbol universe.",
      disabled: !count,
    },
    {
      action: "diagnostics",
      status: capped || suggestedRoots.length || parserErrors ? "warn" : count ? "ok" : "bad",
      title: "Open Diagnostics",
      note: "Inspect root visibility, parser skips, scan caps, and storage audit.",
      disabled: !roots.length && !suggestedRoots.length,
    },
    {
      action: "copy-roots",
      status: dataRootConfigPaths().length ? "ok" : "bad",
      title: "Copy Root YAML",
      note: "Copy configured and suggested dashboard.data_roots.",
      disabled: !dataRootConfigPaths().length,
    },
    {
      action: "refresh",
      status: "ok",
      title: "Refresh Catalog",
      note: "Reload saved-data rows from the selected scan limit.",
      disabled: false,
    },
  ].map((item) => `
    <button class="data-storage-assistant-action status-${escapeHtml(item.status)}" data-data-scope-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

function handleDataScopeAssistantAction(action) {
  if (action === "raise-limit") {
    setDataCatalogLimitToMax();
    refreshDataLibrary({ force: true, includeDiagnostics: shouldLoadDataDiagnostics() }).catch((err) => {
      $("last-refresh").textContent = `Catalog refresh failed: ${err.message}`;
    });
    return;
  }
  if (action === "clear-filters") {
    clearDataCatalogFilters();
    renderDataCatalog();
    $("last-refresh").textContent = "Data Library filters cleared";
    return;
  }
  if (action === "browse") {
    navigateToDataLens("browse");
    $("data-symbol-browser-input").focus();
    return;
  }
  if (action === "diagnostics") {
    navigateToDataLens("diagnostics");
    refreshDataDiagnostics({ force: false }).catch((err) => {
      $("last-refresh").textContent = `Data diagnostics refresh failed: ${err.message}`;
    });
    return;
  }
  if (action === "copy-roots") {
    copyDataRootsYaml();
    return;
  }
  if (action === "refresh") {
    refreshDataLibrary({ force: true, includeDiagnostics: shouldLoadDataDiagnostics() }).catch((err) => {
      $("last-refresh").textContent = `Catalog refresh failed: ${err.message}`;
    });
  }
}

function renderDataHome(filteredRows = []) {
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  const diagnostics = state.diagnostics || {};
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const loadState = dataLibraryLoadState();
  const firstCatalogLoad = loadState.catalogLoading && !loadState.catalogLoaded && datasets.length === 0;
  const catalogCount = Number(catalog.count || datasets.length || 0);
  const symbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const totalRows = Number(catalog.row_count_total || 0);
  const totalRootFiles = roots.reduce((sum, root) => sum + Number(root.data_file_count || 0), 0);
  const filterLabels = dataFilterSummary();
  const best = filteredRows.find((dataset) => dataset.path) || datasets.find((dataset) => dataset.path) || null;
  const rootSummaries = catalog.root_summaries || [];
  const parserErrors = Number(catalog.error_count || rootSummaries.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0));
  const capped = rootSummaries.some((item) => item.scan_capped || item.not_scanned_reason === "global catalog limit reached");
  const qualityCounts = catalog.quality_counts || {};
  const badCount = Number(qualityCounts.bad || 0);
  const warnCount = Number(qualityCounts.warn || 0);
  const contractCounts = catalog.storage_contract_counts || countBy(datasets, "storage_contract_status");
  const contractBadCount = Number(contractCounts.bad || 0);
  const contractWarnCount = Number(contractCounts.warn || 0);

  let nextStep = "Inspect";
  let nextNote = "Pick a saved file, inspect its chart, then use Workbench for replay setup.";
  if (firstCatalogLoad) {
    nextStep = "Loading";
    nextNote = "Scanning configured roots in the background; large caches can take tens of seconds.";
  } else if (!roots.length || !totalRootFiles) {
    nextStep = suggestedRoots.length ? "Add Root" : "Fetch Data";
    nextNote = suggestedRoots.length
      ? `Add suggested root ${text(suggestedRoots[0].display_path || suggestedRoots[0].path)} to dashboard.data_roots.`
      : "Configure a saved-data root or run a fetch job before replaying.";
  } else if (!catalogCount) {
    nextStep = "Scan";
    nextNote = "Roots exist, but no parseable CSV/parquet catalog rows were found.";
  } else if (!filteredRows.length) {
    nextStep = "Clear Filters";
    nextNote = "Catalog data exists, but the current filter hides every row.";
  } else if (parserErrors || badCount) {
    nextStep = "Review Quality";
    nextNote = `${numberText(parserErrors, 0)} parser errors and ${numberText(badCount, 0)} bad files need review before simulation.`;
  } else if (contractBadCount || contractWarnCount) {
    nextStep = "Review Metadata";
    nextNote = `${numberText(contractBadCount + contractWarnCount, 0)} files have storage-contract warnings before simulation.`;
  } else if (capped) {
    nextStep = "Raise Limit";
    nextNote = `The catalog appears capped at ${numberText(catalog.limit || 0, 0)} rows; increase the scan limit to see more files.`;
  } else if (warnCount) {
    nextStep = "Inspect Warnings";
    nextNote = `${numberText(warnCount, 0)} warn-quality files are usable only after reviewing gaps/nulls.`;
  }

  $("data-home-title").textContent = firstCatalogLoad
    ? "Loading saved data catalog"
    : catalogCount
    ? `${numberText(symbols.size, 0)} symbols across ${numberText(catalogCount, 0)} files`
    : "No saved data loaded";
  $("data-home-note").textContent = firstCatalogLoad
    ? `${numberText(roots.length, 0)} configured root${roots.length === 1 ? "" : "s"} are being scanned. Keep using other dashboard pages while this finishes.`
    : catalogCount
    ? `${numberText(totalRows, 0)} rows under configured roots. Use filters, Symbol Browser, or Inspect First Match to browse offline history.`
    : "Configure data roots or refresh the catalog to inspect historical files.";
  $("data-home-filtered-count").textContent = `${numberText(filteredRows.length, 0)} / ${numberText(catalogCount, 0)}`;
  $("data-home-filter-note").textContent = filterLabels.length ? filterLabels.join(" / ") : "No filter applied";
  $("data-home-best-symbol").textContent = best ? text(best.symbol) : "n/a";
  $("data-home-best-note").textContent = best
    ? `${text(best.bar_size)} ${text(best.source)} ${text(best.quality_status)} / contract ${text(best.storage_contract_status)} / ${numberText(best.rows, 0)} rows`
    : "No inspectable dataset";
  $("data-home-next-step").textContent = nextStep;
  $("data-home-next-note").textContent = nextNote;
  $("data-home-inspect-top").disabled = !best;
  $("data-home-breakdown").innerHTML = [
    breakdownChips("Assets", catalog.asset_class_counts || countBy(datasets, "asset_class")),
    breakdownChips("Sources", catalog.source_counts || countBy(datasets, "source")),
    breakdownChips("Bars", catalog.bar_size_counts || countBy(datasets, "bar_size")),
    breakdownChips("Quality", catalog.quality_counts || countBy(datasets, "quality_status")),
    breakdownChips("Contract", contractCounts),
  ].join("");
  renderDataScopeAssistant(filteredRows);
  renderDataUniversePanel();
  renderDataHomeWorkflows(filteredRows);
  renderDataHomeShortlist(filteredRows);
}

function dataHomeWorkflowCards(filteredRows = []) {
  const catalog = state.dataCatalog || {};
  const diagnostics = state.diagnostics || {};
  const datasets = catalog.datasets || [];
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const rootSummaries = catalog.root_summaries || [];
  const qualityCounts = catalog.quality_counts || {};
  const contractCounts = catalog.storage_contract_counts || countBy(datasets, "storage_contract_status");
  const parserErrors = Number(catalog.error_count || rootSummaries.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0));
  const capped = rootSummaries.some((item) => item.scan_capped || item.not_scanned_reason === "global catalog limit reached");
  const visibleSymbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const inspectable = filteredRows.find((dataset) => dataset.path) || datasets.find((dataset) => dataset.path) || null;
  const groups = symbolBrowserGroups();
  const comparableSymbols = Array.from(groups.entries())
    .filter(([, rows]) => rows.filter((item) => item.path).length >= 2)
    .map(([symbol]) => symbol);
  const selectedRows = selectedConfigDatasets();
  const rootFileCount = roots.reduce((sum, root) => sum + Number(root.data_file_count || 0), 0);
  const hiddenConfiguredFiles = Math.max(0, rootFileCount - Number(catalog.count || datasets.length || 0));
  const visibilityIssue = suggestedRoots.length || parserErrors || capped || hiddenConfiguredFiles;
  const qualityIssueCount = Number(qualityCounts.bad || 0) + Number(qualityCounts.warn || 0);
  const contractIssueCount = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);

  return [
    {
      label: "Find A Symbol",
      title: visibleSymbols.size ? `${numberText(visibleSymbols.size, 0)} symbols` : "No Symbols",
      value: `${numberText(datasets.length, 0)} files`,
      status: visibleSymbols.size ? "ok" : "bad",
      detail: visibleSymbols.size
        ? "Open the catalog-backed Symbol Browser and Directory to search every scanned symbol."
        : "No symbols are visible because no parseable saved data is loaded.",
      href: workflowHref("data", "browse"),
      cta: "Browse",
    },
    {
      label: "Inspect History",
      title: inspectable ? text(inspectable.symbol) : "No File",
      value: inspectable ? `${text(inspectable.bar_size)} / ${numberText(inspectable.rows, 0)} rows` : "empty",
      status: inspectable ? text(inspectable.quality_status) === "bad" ? "warn" : "ok" : "bad",
      detail: inspectable
        ? "Open a saved file viewer with range presets, timezone display, price/volume chart, gaps, and export."
        : "Add or fetch saved CSV/parquet data before inspecting historical bars.",
      href: workflowHref("data", "inspect"),
      cta: "Inspect",
    },
    {
      label: "Compare Files",
      title: comparableSymbols.length ? `${numberText(comparableSymbols.length, 0)} comparable` : "Need Matches",
      value: comparableSymbols[0] || "no pairs",
      status: comparableSymbols.length ? "ok" : datasets.length ? "warn" : "bad",
      detail: comparableSymbols.length
        ? "Compare normalized close paths for symbols with multiple saved files or overlapping datasets."
        : "Comparison needs at least two inspectable files for a symbol or selected range.",
      href: workflowHref("data", "compare"),
      cta: "Compare",
    },
    {
      label: "Build Simulation",
      title: selectedRows.length ? `${numberText(selectedRows.length, 0)} selected` : datasets.length ? "Ready To Select" : "Needs Data",
      value: filteredRows.length ? `${numberText(filteredRows.length, 0)} shown` : "no rows",
      status: datasets.length ? selectedRows.length ? "ok" : "warn" : "bad",
      detail: selectedRows.length
        ? "Selected datasets can be previewed for timestamp alignment in Workbench."
        : datasets.length
          ? "Choose saved files from Data Library, then send them to Workbench for replay or simulated-paper setup."
          : "The Workbench needs saved data before it can build useful config drafts.",
      href: workflowHref("workbench", "builder"),
      cta: "Workbench",
    },
    {
      label: "Check Quality",
      title: qualityIssueCount || contractIssueCount ? `${numberText(qualityIssueCount + contractIssueCount, 0)} review` : datasets.length ? "Clean Enough" : "No Scan",
      value: parserErrors ? `${numberText(parserErrors, 0)} parser errors` : `quality ${countSummary(qualityCounts) || "n/a"} / contract ${countSummary(contractCounts) || "n/a"}`,
      status: parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) ? "bad" : qualityIssueCount || contractIssueCount ? "warn" : datasets.length ? "ok" : "bad",
      detail: parserErrors || qualityIssueCount || contractIssueCount
        ? "Review parser errors, bad files, warn-quality files, storage metadata, gaps, nulls, and duplicate timestamps before replay."
        : "No catalog quality or storage-contract issues are visible in the current scan.",
      href: workflowHref("data", "diagnostics"),
      cta: "Diagnostics",
    },
    {
      label: "Fix Visibility",
      title: visibilityIssue ? "Review Roots" : roots.length ? "Roots Mapped" : "No Roots",
      value: suggestedRoots.length ? `${numberText(suggestedRoots.length, 0)} suggested` : capped ? "capped" : `${numberText(roots.length, 0)} roots`,
      status: !roots.length || suggestedRoots.length || parserErrors ? "bad" : capped || hiddenConfiguredFiles ? "warn" : "ok",
      detail: !roots.length
        ? "Configure dashboard.data_roots or run a fetch job so saved files can be scanned."
        : suggestedRoots.length
          ? "Suggested roots contain saved files outside configured dashboard roots."
          : capped
            ? "The catalog is capped; raise Rows to scan if expected symbols are hidden."
            : hiddenConfiguredFiles
              ? "Storage Audit can explain configured-root files that are not catalog-visible."
              : "Configured roots are visible and no root-level visibility issue is currently flagged.",
      href: workflowHref("data", "diagnostics"),
      cta: "Fix Roots",
    },
  ];
}

function renderDataHomeWorkflows(filteredRows = []) {
  const container = $("data-home-workflows");
  if (!container) return;
  const cards = dataHomeWorkflowCards(filteredRows);
  container.innerHTML = cards.map((card) => `
    <a class="action-card workflow-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <div class="workflow-card-foot">
        <em>${escapeHtml(card.value)}</em>
        <b>${escapeHtml(card.cta)}</b>
      </div>
    </a>
  `).join("");
}

function renderDataHomeShortlist(filteredRows = []) {
  const container = $("data-home-shortlist");
  if (!container) return;
  const rows = recommendedDataRows(filteredRows);
  if (!rows.length) {
    container.innerHTML = `<div class="empty-card"><strong>No saved files to shortlist</strong><span>Configure data roots or fetch history, then refresh the catalog.</span></div>`;
    return;
  }
  container.innerHTML = rows.map((dataset) => {
    const symbol = text(dataset.symbol);
    const exactMatches = (symbolBrowserGroups().get(symbol) || []).filter((item) => item.path);
    const compareDisabled = exactMatches.length < 2 ? " disabled" : "";
    return `
      <div class="data-shortlist-card">
        <div>
          <span class="eyebrow">${escapeHtml(text(dataset.asset_class))} / ${escapeHtml(text(dataset.source))}</span>
          <strong>${escapeHtml(symbol)}</strong>
          <small>${escapeHtml(text(dataset.bar_size))} / ${escapeHtml(text(dataset.storage_session))} / ${escapeHtml(numberText(dataset.rows, 0))} rows</small>
          <small>${escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp))}</small>
          <small>${qualityBadge(dataset.quality_status, dataset.quality_warnings)} ${qualityBadge(dataset.storage_contract_status, dataset.storage_contract_warnings)} ${escapeHtml(bytes(dataset.size_bytes))} / updated ${escapeHtml(shortTimestampAgeLabel(dataset.modified_at))}</small>
        </div>
        <div class="data-shortlist-actions">
          <button type="button" data-home-action="inspect" data-path="${escapeHtml(dataset.path)}" data-symbol="${escapeHtml(symbol)}">Inspect</button>
          <button type="button" class="secondary" data-home-action="filter" data-symbol="${escapeHtml(symbol)}">Filter</button>
          <button type="button" class="secondary" data-home-action="compare" data-symbol="${escapeHtml(symbol)}"${compareDisabled}>Compare</button>
        </div>
      </div>
    `;
  }).join("");
}

function rootCatalogSummary(root, rootSummaries = [], datasets = []) {
  const rootPath = text(root.display_path || root.path);
  const rootPathLower = rootPath.toLowerCase();
  const summary = rootSummaries.find((item) => {
    const values = [item.path, item.display_path, item.root].map(text).map((value) => value.toLowerCase());
    return values.includes(rootPathLower);
  }) || {};
  const visibleRows = datasets.filter((dataset) => {
    const datasetRoot = text(dataset.root).toLowerCase();
    const datasetPath = text(dataset.path).toLowerCase();
    return datasetRoot === rootPathLower || datasetPath.startsWith(`${rootPathLower}/`);
  });
  return {
    catalogVisible: visibleRows.length || Number(summary.parsed_count || 0),
    candidateCount: Number(summary.candidate_count || root.data_file_count || 0),
    parsedCount: Number(summary.parsed_count || visibleRows.length || 0),
    parseErrors: Number(summary.parse_error_count || 0),
    unsupported: Number(summary.unsupported_file_count || 0),
    capped: Boolean(summary.scan_capped || summary.not_scanned_reason === "global catalog limit reached"),
    reason: text(summary.not_scanned_reason || summary.error || ""),
    contractCounts: countBy(visibleRows, "storage_contract_status"),
  };
}

function renderDataSourceMap() {
  if (!$("data-source-map") || !$("data-source-map-note")) return;
  const diagnostics = state.diagnostics || {};
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  const rootSummaries = catalog.root_summaries || [];
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const cards = [];
  for (const root of roots) {
    const summary = rootCatalogSummary(root, rootSummaries, datasets);
    const diskFiles = Number(root.data_file_count || summary.candidateCount || 0);
    const hiddenFiles = Math.max(0, diskFiles - summary.catalogVisible);
    let status = "ok";
    let title = "Catalog visible";
    let action = "Filter";
    let actionKind = "filter";
    if (!root.exists || !root.is_dir) {
      status = "bad";
      title = "Root unavailable";
      action = "Copy YAML";
      actionKind = "copy-roots";
    } else if (summary.parseErrors) {
      status = "bad";
      title = "Parser errors";
      action = "Scan Diagnostics";
      actionKind = "scan";
    } else if (!diskFiles) {
      status = "warn";
      title = "No saved files";
      action = "Fetch Jobs";
      actionKind = "fetch";
    } else if (!summary.catalogVisible || hiddenFiles || summary.capped) {
      status = "warn";
      title = summary.capped ? "Catalog capped" : "Some files hidden";
      action = summary.capped ? "Raise Limit" : "Storage Audit";
      actionKind = summary.capped ? "raise-limit" : "audit";
    }
    const detailParts = [
      `${numberText(diskFiles, 0)} disk file${diskFiles === 1 ? "" : "s"}`,
      `${numberText(summary.catalogVisible, 0)} catalog-visible`,
      hiddenFiles ? `${numberText(hiddenFiles, 0)} hidden` : "",
      summary.parseErrors ? `${numberText(summary.parseErrors, 0)} parser errors` : "",
      summary.unsupported ? `${numberText(summary.unsupported, 0)} unsupported` : "",
      countSummary(summary.contractCounts) ? `contract ${countSummary(summary.contractCounts)}` : "",
    ].filter(Boolean);
    cards.push({
      status,
      title,
      root: root.display_path || root.path,
      scope: `${text(root.scope)} / ${text(root.scope_note)}`,
      detail: detailParts.join(" / "),
      reason: summary.reason,
      action,
      actionKind,
    });
  }
  for (const root of suggestedRoots) {
    cards.push({
      status: "warn",
      title: "Suggested root not scanned",
      root: root.display_path || root.path,
      scope: `${text(root.scope)} / ${text(root.scope_note)}`,
      detail: `${numberText(root.data_file_count, 0)} saved file${Number(root.data_file_count || 0) === 1 ? "" : "s"} found outside configured roots`,
      reason: "Add this path to dashboard.data_roots or copy the generated YAML block.",
      action: "Copy YAML",
      actionKind: "copy-roots",
    });
  }
  $("data-source-map-note").textContent = cards.length
    ? `${numberText(roots.length, 0)} configured / ${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"}`
    : "No configured or suggested data roots loaded";
  $("data-source-map").innerHTML = cards.length
    ? cards.slice(0, 12).map((card) => `
      <div class="action-card status-${escapeHtml(card.status)}">
        <span>${escapeHtml(card.title)}</span>
        <strong>${escapeHtml(card.detail)}</strong>
        <small class="mono">${escapeHtml(text(card.root))}</small>
        <small>${escapeHtml(card.scope)}</small>
        ${card.reason && card.reason !== "n/a" ? `<small>${escapeHtml(card.reason)}</small>` : ""}
        <button type="button" class="secondary" data-source-map-action="${escapeHtml(card.actionKind)}" data-root-query="${escapeHtml(text(card.root))}">${escapeHtml(card.action)}</button>
      </div>
    `).join("")
    : `<div class="empty-card"><strong>No data roots mapped</strong><span>Configure dashboard.data_roots or run a fetch job, then refresh Data Library.</span></div>`;
}

function selectedSymbolBrowserPath() {
  return $("data-symbol-browser-dataset").value || (selectedSymbolBrowserDatasets()[0] || {}).path || "";
}

function selectedSymbolBrowserDataset() {
  const selectedPath = selectedSymbolBrowserPath();
  if (!selectedPath) return selectedSymbolBrowserDatasets()[0] || null;
  return selectedSymbolBrowserDatasets().find((dataset) => dataset.path === selectedPath)
    || (state.dataCatalog.datasets || []).find((dataset) => dataset.path === selectedPath)
    || null;
}

function renderSymbolSelectionPanel(symbol) {
  if (!$("data-symbol-selection-title")) return;
  const model = symbolProfileModel(symbol);
  const selectedDataset = selectedSymbolBrowserDataset() || model.best;
  const hasRows = Boolean(model.rows.length);
  const hasQuery = Boolean(model.symbol);
  $("data-symbol-selection-title").textContent = hasRows
    ? model.symbol
    : hasQuery ? `${model.symbol} not visible` : "No symbol selected";
  $("data-symbol-selection-note").textContent = hasRows
    ? `${numberText(model.rows.length, 0)} saved file${model.rows.length === 1 ? "" : "s"} / ${numberText(model.totalRows, 0)} rows. Actions use ${text((selectedDataset || {}).bar_size)} ${text((selectedDataset || {}).source)} unless noted.`
    : hasQuery
      ? model.allRows.length
        ? "This symbol exists in the catalog, but current Symbol Browser facets hide every file."
        : "This symbol is not in the current catalog. Diagnose can check configured roots, suggested roots, and fetch manifests."
      : "Type a ticker, choose a quick pick, or browse the Symbol Directory to load a saved-data symbol.";
  const buttonStates = {
    "data-symbol-selection-filter": hasRows,
    "data-symbol-selection-inspect": Boolean(selectedDataset && selectedDataset.path),
    "data-symbol-selection-workbench": Boolean(selectedDataset && selectedDataset.path),
    "data-symbol-selection-compare": model.rows.length >= 2,
    "data-symbol-selection-diagnose": hasQuery,
  };
  for (const [id, enabled] of Object.entries(buttonStates)) {
    const button = $(id);
    if (button) button.disabled = !enabled;
  }
  const qualityScore = model.qualityScore;
  const qualityStatus = qualityScore === 0 ? "ok" : qualityScore === 1 ? "warn" : qualityScore === 2 ? "bad" : "warn";
  const contractScore = model.contractScore;
  const contractStatus = contractScore === 0 ? "ok" : contractScore === 1 ? "warn" : contractScore === 2 ? "bad" : "warn";
  const cards = [
    {
      status: hasRows ? "ok" : hasQuery ? "warn" : "bad",
      label: "Selection",
      title: hasQuery ? model.symbol : "n/a",
      note: hasRows
        ? `${numberText(model.rows.length, 0)} files in the current catalog.`
        : hasQuery ? (model.allRows.length ? "Exact symbol is hidden by Symbol Browser facets." : "No exact saved-data match is visible.") : "No symbol query entered.",
    },
    {
      status: selectedDataset ? "ok" : "bad",
      label: "Action File",
      title: selectedDataset ? `${text(selectedDataset.bar_size)} ${text(selectedDataset.source)}` : "n/a",
      note: selectedDataset
        ? `${numberText(selectedDataset.rows, 0)} rows / ${text(selectedDataset.storage_session)} / ${bytes(selectedDataset.size_bytes)}`
        : "Inspect and Workbench need a saved file.",
    },
    {
      status: model.range.start && model.range.end ? "ok" : hasRows ? "warn" : "bad",
      label: "Coverage",
      title: model.range.start && model.range.end ? `${model.range.start} -> ${model.range.end}` : "n/a",
      note: model.latestMillis ? `Latest saved bar ${new Date(model.latestMillis).toISOString().slice(0, 10)}.` : "No timestamp range loaded.",
    },
    {
      status: qualityStatus,
      label: "Quality",
      title: hasRows ? countSummary(model.qualities) : "n/a",
      note: qualityScore === 0
        ? "Best-ranked files report ok quality."
        : hasRows ? "Review warnings before simulation." : "No quality data available.",
    },
    {
      status: contractStatus,
      label: "Contract",
      title: hasRows ? countSummary(model.contracts) : "n/a",
      note: contractScore === 0
        ? "Best-ranked files satisfy storage metadata checks."
        : hasRows ? "Review metadata warnings before Workbench replay." : "No contract data available.",
    },
  ];
  $("data-symbol-selection-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function selectCatalogDatasetInWorkbench(dataset) {
  if (!dataset || !dataset.path) {
    $("data-symbol-browser-note").innerHTML = `<span class="status-bad">Select a catalog dataset first</span>`;
    return;
  }
  const datasetSelect = $("config-dataset");
  if (!datasetSelect) return;
  let found = false;
  for (const option of datasetSelect.options) {
    option.selected = option.value === dataset.path;
    if (option.value === dataset.path) found = true;
  }
  if (!found) {
    const option = document.createElement("option");
    option.value = dataset.path;
    option.textContent = `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`;
    option.selected = true;
    datasetSelect.appendChild(option);
  }
  if ($("config-start-date")) $("config-start-date").value = dateInputValueFromTimestamp(dataset.first_timestamp);
  if ($("config-end-date")) $("config-end-date").value = dateInputValueFromTimestamp(dataset.last_timestamp);
  renderConfigLivePanels();
  navigateToWorkbenchLens("builder");
  window.setTimeout(() => {
    const target = $("workbench-stepper") || $("config-form");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 50);
  $("last-refresh").textContent = `Selected ${text(dataset.symbol)} for Workbench simulation`;
}

async function inspectSelectedSymbol() {
  const path = selectedSymbolBrowserPath();
  if (!path) {
    $("data-symbol-browser-note").innerHTML = `<span class="status-bad">Select a catalog dataset first</span>`;
    return;
  }
  await loadDataDetail(path, { resetControls: true });
}

async function diagnoseSelectedSymbol() {
  const symbol = selectedSymbolBrowserSymbol();
  if (!symbol) {
    $("data-symbol-browser-note").innerHTML = `<span class="status-bad">Enter a symbol first</span>`;
    return;
  }
  $("data-symbol-input").value = symbol;
  await diagnoseDataSymbol(new Event("submit"));
}

async function compareSelectedSymbolDatasets() {
  const symbol = selectedSymbolBrowserSymbol();
  if (!symbol) {
    $("data-symbol-browser-note").innerHTML = `<span class="status-bad">Enter a symbol first</span>`;
    return;
  }
  const matches = (state.dataCatalog.datasets || [])
    .filter((dataset) => text(dataset.symbol).toUpperCase() === symbol && dataset.path)
    .slice(0, MAX_DATA_COMPARE_DATASETS);
  if (matches.length < 2) {
    $("data-symbol-browser-note").innerHTML = `<span class="status-warn">Need at least two saved ${escapeHtml(symbol)} datasets to compare</span>`;
    return;
  }
  state.dataCompareSelectedPaths = matches.map((dataset) => dataset.path);
  state.dataCompareSelectionCleared = false;
  $("data-compare-filter").value = symbol;
  renderDataCompareControls();
  $("data-symbol-browser-note").textContent = `Selected ${numberText(matches.length, 0)} ${symbol} datasets and loaded comparison`;
  await loadDataCompare();
  $("last-refresh").textContent = `Loaded comparison for ${numberText(matches.length, 0)} ${symbol} datasets`;
  if ($("data-compare-form")) $("data-compare-form").scrollIntoView({ block: "start", behavior: "smooth" });
}

async function handleSymbolDirectoryAction(target) {
  const symbol = String(target.dataset.symbol || "").trim().toUpperCase();
  if (!symbol) return;
  $("data-symbol-browser-input").value = symbol;
  renderSymbolBrowser();
  if (target.classList.contains("symbol-directory-filter")) {
    $("data-filter-text").value = symbol;
    state.manifestPathFilter = null;
    renderDataCatalog();
    $("last-refresh").textContent = `Data Library filtered to ${symbol}`;
    return;
  }
  if (target.classList.contains("symbol-directory-inspect")) {
    const path = target.dataset.path || (bestCatalogDatasetForSymbol(symbol) || {}).path || "";
    if (!path) {
      $("data-symbol-directory-note").innerHTML = `<span class="status-bad">No inspectable file for ${escapeHtml(symbol)}</span>`;
      return;
    }
    await loadDataDetail(path, { resetControls: true });
    $("last-refresh").textContent = `Loaded ${symbol} data detail`;
    return;
  }
  if (target.classList.contains("symbol-directory-compare")) {
    await compareSelectedSymbolDatasets();
    return;
  }
  if (target.classList.contains("symbol-directory-diagnose")) {
    $("data-symbol-input").value = symbol;
    await diagnoseDataSymbol(new Event("submit"));
  }
}

async function handleSymbolDirectoryAssistantAction(target) {
  const action = String(target.dataset.directoryAction || "");
  const symbol = String(target.dataset.symbol || "").trim().toUpperCase();
  const path = target.dataset.path || (bestCatalogDatasetForSymbol(symbol) || {}).path || "";
  if (!symbol) return;
  $("data-symbol-browser-input").value = symbol;
  renderSymbolBrowser();
  if (action === "filter") {
    $("data-symbol-directory-filter").value = symbol;
    $("data-filter-text").value = symbol;
    state.manifestPathFilter = null;
    renderSymbolDirectory();
    renderDataCatalog();
    $("last-refresh").textContent = `Data Library filtered to ${symbol}`;
    return;
  }
  if (action === "workbench") {
    const dataset = (state.dataCatalog.datasets || []).find((item) => item.path === path) || bestCatalogDatasetForSymbol(symbol);
    selectCatalogDatasetInWorkbench(dataset);
    return;
  }
  if (action === "compare") {
    await compareSelectedSymbolDatasets();
    return;
  }
  if (!path) {
    $("data-symbol-directory-note").innerHTML = `<span class="status-bad">No inspectable file for ${escapeHtml(symbol)}</span>`;
    return;
  }
  await loadDataDetail(path, { resetControls: true });
  $("last-refresh").textContent = `Loaded ${symbol} data detail`;
}

async function handleDataHomeShortlistAction(target) {
  const action = String(target.dataset.homeAction || "");
  const symbol = String(target.dataset.symbol || "").trim().toUpperCase();
  if (symbol) {
    $("data-symbol-browser-input").value = symbol;
    renderSymbolBrowser();
  }
  if (action === "inspect") {
    const path = target.dataset.path || (bestCatalogDatasetForSymbol(symbol) || {}).path || "";
    if (!path) {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">No inspectable file for ${escapeHtml(symbol || "selected symbol")}</span>`;
      return;
    }
    await loadDataDetail(path, { resetControls: true });
    $("last-refresh").textContent = `Loaded ${symbol || "selected"} data detail`;
    return;
  }
  if (action === "filter") {
    $("data-filter-text").value = symbol;
    state.manifestPathFilter = null;
    renderDataCatalog();
    $("last-refresh").textContent = symbol ? `Data Library filtered to ${symbol}` : "Data Library filter cleared";
    return;
  }
  if (action === "compare") {
    await compareSelectedSymbolDatasets();
  }
  if (action === "diagnose") {
    if (!symbol) {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">Select a symbol to diagnose</span>`;
      return;
    }
    await diagnoseSelectedSymbol();
  }
}

async function handleSymbolProfileAction(target) {
  const action = String(target.dataset.symbolProfileAction || "");
  const symbol = selectedSymbolBrowserSymbol();
  const dataset = bestCatalogDatasetForSymbol(symbol);
  if (action === "inspect") {
    if (!dataset || !dataset.path) throw new Error(`No inspectable file for ${symbol || "selected symbol"}`);
    await loadDataDetail(dataset.path, { resetControls: true });
    $("last-refresh").textContent = `Loaded ${symbol} data detail`;
    return;
  }
  if (action === "workbench") {
    if (!dataset || !dataset.path) throw new Error(`No Workbench-ready file for ${symbol || "selected symbol"}`);
    selectCatalogDatasetInWorkbench(dataset);
    return;
  }
  if (action === "compare") {
    await compareSelectedSymbolDatasets();
    return;
  }
  if (action === "filter") {
    $("data-filter-text").value = symbol;
    state.manifestPathFilter = null;
    renderDataCatalog();
    $("last-refresh").textContent = symbol ? `Data Library filtered to ${symbol}` : "Data Library filter cleared";
    return;
  }
  if (action === "diagnose") {
    if (!symbol) throw new Error("Enter a symbol first");
    $("data-symbol-input").value = symbol;
    await diagnoseDataSymbol(new Event("submit"));
  }
}

async function handleSymbolSelectionAction(action) {
  const symbol = selectedSymbolBrowserSymbol();
  const dataset = selectedSymbolBrowserDataset();
  if (action === "filter") {
    $("data-filter-text").value = symbol;
    state.manifestPathFilter = null;
    renderDataCatalog();
    $("last-refresh").textContent = symbol ? `Data Library filtered to ${symbol}` : "Data Library filter cleared";
    return;
  }
  if (action === "inspect") {
    if (!dataset || !dataset.path) throw new Error(`No inspectable file for ${symbol || "selected symbol"}`);
    await loadDataDetail(dataset.path, { resetControls: true });
    $("last-refresh").textContent = `Loaded ${symbol} data detail`;
    return;
  }
  if (action === "workbench") {
    if (!dataset || !dataset.path) throw new Error(`No Workbench-ready file for ${symbol || "selected symbol"}`);
    selectCatalogDatasetInWorkbench(dataset);
    return;
  }
  if (action === "compare") {
    await compareSelectedSymbolDatasets();
    return;
  }
  if (action === "diagnose") {
    if (!symbol) throw new Error("Enter a symbol first");
    $("data-symbol-input").value = symbol;
    await diagnoseDataSymbol(new Event("submit"));
  }
}

function renderDataLibrarySummary() {
  const diagnostics = state.diagnostics || {};
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  const loadState = dataLibraryLoadState();
  const firstCatalogLoad = loadState.catalogLoading && !loadState.catalogLoaded && datasets.length === 0;
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const existingRoots = roots.filter((root) => root.exists && root.is_dir);
  const totalRootFiles = roots.reduce((sum, root) => sum + Number(root.data_file_count || 0), 0);
  const rootConfigPaths = dataRootConfigPaths();
  const catalogCount = Number(catalog.count || 0);
  syncDataCatalogLimitControl();
  const catalogLimit = Number(catalog.limit || $("data-catalog-limit").value || 0);
  const symbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const timestampRange = timestampRangeFromDatasets(datasets);
  const qualityCounts = catalog.quality_counts || {};
  const warnCount = Number(qualityCounts.warn || 0);
  const badCount = Number(qualityCounts.bad || 0);
  const parseErrorCount = Number(catalog.error_count || 0);
  $("data-root-count").textContent = numberText(roots.length, 0);
  $("data-root-note").textContent = `${numberText(existingRoots.length, 0)} active / ${numberText(totalRootFiles, 0)} files visible to root scanner`;
  $("copy-data-roots-yaml").disabled = !rootConfigPaths.length;
  $("data-root-config-note").textContent = rootConfigPaths.length
    ? `${numberText(rootConfigPaths.length, 0)} configured/suggested root${rootConfigPaths.length === 1 ? "" : "s"} ready to copy`
    : "No configured or suggested roots to copy";
  $("data-symbol-count").textContent = numberText(symbols.size, 0);
  $("data-symbol-note").textContent = symbols.size
    ? `${countSummary(catalog.asset_class_counts)} assets`
    : firstCatalogLoad
      ? "Catalog scan is running."
      : "No scanned symbols found under configured roots.";
  $("data-file-count").textContent = firstCatalogLoad ? "Loading" : numberText(catalogCount, 0);
  $("data-file-note").textContent = firstCatalogLoad
    ? "Scanning saved CSV/parquet files under configured roots."
    : `${numberText(catalog.row_count_total, 0)} rows / ${bytes(catalog.size_bytes_total)}`;
  $("data-date-range").textContent = firstCatalogLoad
    ? "Loading"
    : timestampRange.start && timestampRange.end
    ? `${timestampRange.start} -> ${timestampRange.end}`
    : "n/a";
  $("data-date-range-note").textContent = catalog.latest_modified_at
    ? `Latest file modified ${timestampAgeLabel(catalog.latest_modified_at)}`
    : firstCatalogLoad
      ? "Timestamp range appears after the catalog scan completes."
      : "No file modification timestamp published.";
  $("data-quality-summary").textContent = firstCatalogLoad
    ? "Loading"
    : badCount || warnCount || parseErrorCount
    ? `${numberText(badCount, 0)} bad / ${numberText(warnCount, 0)} warn`
    : "ok";
  $("data-quality-summary").className = statusClass(firstCatalogLoad ? "warn" : badCount || parseErrorCount ? "bad" : warnCount ? "warn" : catalogCount ? "ok" : "unknown");
  $("data-quality-note").textContent = parseErrorCount
    ? `${numberText(parseErrorCount, 0)} parser error${parseErrorCount === 1 ? "" : "s"}; check scan diagnostics.`
    : firstCatalogLoad
      ? "Quality counts appear after parser metadata is loaded."
      : `${countSummary(qualityCounts)} quality / ${countSummary(catalog.source_counts)} sources`;
  let visibilityStatus = "ok";
  let visibilityNote = `${numberText(catalogCount, 0)} catalog rows loaded from configured roots.`;
  if (firstCatalogLoad) {
    visibilityStatus = "warn";
    visibilityNote = `Scanning ${numberText(roots.length, 0)} configured root${roots.length === 1 ? "" : "s"}; catalog rows are loading.`;
  } else if (!roots.length || !totalRootFiles) {
    visibilityStatus = "bad";
    visibilityNote = "No CSV/parquet files are visible under the configured roots.";
  } else if (catalogCount <= 2 && roots.some((root) => String(root.path || "").includes("examples/data"))) {
    visibilityStatus = "warn";
    visibilityNote = suggestedRoots.length
      ? `Only example data is loaded. Suggested root ${text(suggestedRoots[0].display_path || suggestedRoots[0].path)} has ${numberText(suggestedRoots[0].data_file_count, 0)} files.`
      : "Only example data is visible. Add cache/history directories with --data-root or local config.";
  } else if (catalogLimit && catalogCount >= catalogLimit && totalRootFiles > catalogCount) {
    visibilityStatus = "warn";
    visibilityNote = `Catalog hit the ${numberText(catalogLimit, 0)} row limit while ${numberText(totalRootFiles, 0)} files exist under roots.`;
  }
  $("data-visibility-status").textContent = visibilityStatus;
  $("data-visibility-status").className = statusClass(visibilityStatus);
  $("data-visibility-note").textContent = visibilityNote;
  $("data-root-cards").innerHTML = roots.length
    ? roots.map((root) => {
        const status = !root.exists ? "bad" : !root.is_dir ? "bad" : Number(root.data_file_count || 0) ? "ok" : "warn";
        return `
          <div class="root-card">
            <span>${statusText(status)}</span>
            <strong>${escapeHtml(numberText(root.data_file_count, 0))} files</strong>
            <small>${escapeHtml(text(root.scope))} - ${escapeHtml(text(root.scope_note))}</small>
            <small class="mono">${escapeHtml(root.display_path || root.path)}</small>
            <small>writable=${escapeHtml(text(root.writable))}</small>
          </div>
        `;
      }).join("") + suggestedRoots.map((root) => `
        <div class="root-card suggested-root">
          <span class="status-warn">suggested</span>
          <strong>${escapeHtml(numberText(root.data_file_count, 0))} files</strong>
          <small>${escapeHtml(text(root.scope))} - ${escapeHtml(text(root.scope_note))}</small>
          <small class="mono">${escapeHtml(root.display_path || root.path)}</small>
          <small>Not currently scanned. Start the dashboard with this data root.</small>
        </div>
      `).join("")
    : `<div class="root-card"><span class="status-bad">bad</span><strong>No roots configured</strong><small>Add at least one data root.</small></div>`;
  renderDataSourceMap();
  renderDataLibraryGuide({
    catalog,
    datasets,
    roots,
    suggestedRoots,
    existingRoots,
    totalRootFiles,
    catalogCount,
    catalogLimit,
    symbols,
  });
  renderDataCatalogScanDiagnostics();
  renderDataCatalogHealth();
}

function handleDataSourceMapAction(target) {
  const action = String(target.dataset.sourceMapAction || "");
  const rootQuery = String(target.dataset.rootQuery || "").trim();
  if (action === "filter") {
    $("data-filter-text").value = rootQuery;
    state.manifestPathFilter = null;
    renderDataCatalog();
    $("last-refresh").textContent = `Data Library filtered to ${rootQuery}`;
    return;
  }
  if (action === "copy-roots") {
    copyDataRootsYaml();
    return;
  }
  if (action === "fetch") {
    navigateToView("fetch");
    return;
  }
  if (action === "raise-limit") {
    $("data-catalog-limit").focus();
    $("last-refresh").textContent = "Increase Rows to scan, then refresh Data Library";
    return;
  }
  const targetId = action === "scan" ? "data-catalog-scan-body" : "data-storage-audit-list";
  const element = $(targetId);
  if (element) element.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderDataLibraryGuide(context = {}) {
  if (!$("data-library-guide") || !$("data-library-guide-note")) return;
  const catalog = context.catalog || state.dataCatalog || {};
  const datasets = context.datasets || catalog.datasets || [];
  const roots = context.roots || (state.diagnostics || {}).data_roots || [];
  const suggestedRoots = context.suggestedRoots || (state.diagnostics || {}).suggested_data_roots || [];
  const existingRoots = context.existingRoots || roots.filter((root) => root.exists && root.is_dir);
  const totalRootFiles = Number(context.totalRootFiles ?? roots.reduce((sum, root) => sum + Number(root.data_file_count || 0), 0));
  const catalogCount = Number(context.catalogCount ?? catalog.count ?? datasets.length);
  const catalogLimit = Number(context.catalogLimit ?? catalog.limit ?? 0);
  const symbols = context.symbols || new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const rootSummaries = catalog.root_summaries || [];
  const totalCandidates = rootSummaries.reduce((sum, item) => sum + Number(item.candidate_count || 0), 0);
  const totalParsed = rootSummaries.reduce((sum, item) => sum + Number(item.parsed_count || 0), 0);
  const totalParserErrors = rootSummaries.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0);
  const totalUnsupported = rootSummaries.reduce((sum, item) => sum + Number(item.unsupported_file_count || 0), 0);
  const capped = rootSummaries.some((item) => item.scan_capped || item.not_scanned_reason === "global catalog limit reached");
  const onlyExamples = catalogCount > 0 && catalogCount <= 2 && roots.some((root) => String(root.path || "").includes("examples/data"));
  const selected = selectedConfigDatasets();
  const detail = state.dataDetail || {};
  const steps = [
    {
      status: existingRoots.length && totalRootFiles ? "ok" : suggestedRoots.length ? "warn" : "bad",
      label: "Configure Roots",
      detail: existingRoots.length && totalRootFiles
        ? `${numberText(existingRoots.length, 0)} active root${existingRoots.length === 1 ? "" : "s"} with ${numberText(totalRootFiles, 0)} visible files.`
        : suggestedRoots.length
          ? `Configured roots look sparse; suggested root has ${numberText(suggestedRoots[0].data_file_count, 0)} files.`
          : "Add cache or history directories with dashboard.data_roots or --data-root.",
    },
    {
      status: !catalogCount ? "bad" : capped || (catalogLimit && totalCandidates > catalogCount) ? "warn" : "ok",
      label: "Scan Catalog",
      detail: !catalogCount
        ? "No catalog rows loaded; increase the scan limit only after roots are correct."
        : capped || (catalogLimit && totalCandidates > catalogCount)
          ? `${numberText(catalogCount, 0)} rows shown, but the scan appears capped at ${numberText(catalogLimit, 0)}.`
          : `${numberText(catalogCount, 0)} datasets and ${numberText(symbols.size, 0)} symbols are searchable.`,
    },
    {
      status: totalParserErrors ? "bad" : totalUnsupported ? "warn" : totalCandidates ? "ok" : "bad",
      label: "Resolve Skips",
      detail: totalParserErrors
        ? `${numberText(totalParserErrors, 0)} parser error${totalParserErrors === 1 ? "" : "s"} need review in Catalog Scan Diagnostics.`
        : totalUnsupported
          ? `${numberText(totalUnsupported, 0)} unsupported files were skipped; this is ok if they are notes/logs.`
          : totalCandidates
            ? `${numberText(totalParsed, 0)} candidates parsed without catalog parser errors.`
            : "No candidate CSV/parquet files were scanned.",
    },
    {
      status: !symbols.size ? "bad" : onlyExamples ? "warn" : "ok",
      label: "Find Symbols",
      detail: !symbols.size
        ? "Use Diagnose to check whether the symbol lives outside configured roots."
        : onlyExamples
          ? "Only example symbols may be visible; check suggested roots or raise the catalog limit."
          : "Use Symbol Browser or table filters to find any scanned saved dataset.",
    },
    {
      status: detail.path ? "ok" : catalogCount ? "warn" : "bad",
      label: "Inspect History",
      detail: detail.path
        ? `Data Detail is showing ${text(detail.symbol)} from ${text(detail.path)}.`
        : catalogCount
          ? "Pick a symbol and click Inspect to chart saved historical data offline."
          : "Fetch or configure data before opening Data Detail.",
    },
    {
      status: selected.length ? "ok" : catalogCount ? "warn" : "bad",
      label: "Simulate",
      detail: selected.length
        ? `${numberText(selected.length, 0)} dataset${selected.length === 1 ? "" : "s"} selected in Config Workbench.`
        : catalogCount
          ? "Select datasets in Config Workbench after confirming their quality and timestamp coverage."
          : "No datasets are ready for Workbench simulation yet.",
    },
  ];
  const ready = steps.filter((step) => step.status === "ok").length;
  $("data-library-guide-note").textContent = `${ready} of ${steps.length} steps ready`;
  $("data-library-guide").innerHTML = steps.map((step) => (
    `<div class="check-item status-${escapeHtml(step.status)}"><span>${escapeHtml(step.status)}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div></div>`
  )).join("");
}

function renderDataCatalogScanDiagnostics() {
  const catalog = state.dataCatalog || {};
  const rows = catalog.root_summaries || [];
  const totalCandidates = rows.reduce((sum, item) => sum + Number(item.candidate_count || 0), 0);
  const totalErrors = rows.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0);
  const capped = rows.filter((item) => item.scan_capped).length;
  $("data-catalog-scan-note").textContent = rows.length
    ? `${numberText(rows.length, 0)} roots / ${numberText(totalCandidates, 0)} candidates / ${numberText(totalErrors, 0)} errors${capped ? ` / ${numberText(capped, 0)} capped` : ""}`
    : "No catalog scan loaded";
  $("data-catalog-scan-body").innerHTML = rows.length
    ? rows.map((item) => {
        const status = !item.exists || !item.is_dir
          ? "bad"
          : item.scan_capped || item.not_scanned_reason || Number(item.parse_error_count || 0)
            ? "warn"
            : "ok";
        const reason = item.not_scanned_reason
          || ((item.sample_errors || [])[0] || {}).error
          || (item.scan_capped ? "catalog limit reached" : "none");
        const sample = (item.sample_skipped_files || [])[0] || {};
        return row([
          `<span class="mono">${escapeHtml(item.display_path || item.path)}</span>`,
          statusText(status),
          escapeHtml(numberText(item.candidate_count, 0)),
          escapeHtml(numberText(item.parsed_count, 0)),
          escapeHtml(numberText(item.parse_error_count, 0)),
          escapeHtml(numberText(item.unsupported_file_count, 0)),
          `${escapeHtml(numberText(item.scan_duration_ms, 3))} ms`,
          escapeHtml(reason),
          sample.path
            ? `<span class="mono">${escapeHtml(sample.path)}</span><br><span class="muted">${escapeHtml(text(sample.reason))}</span>`
            : `<span class="muted">none</span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No roots were scanned</span>`, "", "", "", "", "", "", "", ""]);
}

function renderDataCatalogHealth() {
  if (!$("data-catalog-health-cards") || !$("data-catalog-health-note")) return;
  const catalog = state.dataCatalog || {};
  const audit = state.dataStorageAudit || {};
  const datasets = catalog.datasets || [];
  const scanRows = catalog.root_summaries || [];
  const auditSummary = audit.visibility_summary || {};
  const catalogRows = Number(catalog.count ?? datasets.length ?? 0);
  const totalRows = Number(catalog.total ?? catalogRows);
  const symbolCount = Number(catalog.symbol_count || 0);
  const parserErrors = Number(catalog.error_count || 0)
    || scanRows.reduce((sum, rowItem) => sum + Number(rowItem.parse_error_count || 0), 0);
  const unsupportedScanFiles = scanRows.reduce((sum, rowItem) => sum + Number(rowItem.unsupported_file_count || 0), 0);
  const unsupportedAuditFiles = Number(audit.unsupported_file_count || auditSummary.unsupported_file_count || 0);
  const unsupportedFiles = Math.max(unsupportedScanFiles, unsupportedAuditFiles);
  const cappedCatalogRoots = scanRows.filter((rowItem) => rowItem.scan_capped).length;
  const cappedAuditRoots = Number(auditSummary.capped_root_count || 0);
  const cappedRoots = Math.max(cappedCatalogRoots, cappedAuditRoots);
  const hiddenConfigured = Number(auditSummary.hidden_configured_file_count ?? audit.hidden_configured_file_count ?? 0);
  const suggestedFiles = Number(auditSummary.suggested_unconfigured_file_count ?? audit.suggested_file_count ?? 0);
  const hiddenTotal = Number(auditSummary.hidden_total_file_count ?? (hiddenConfigured + suggestedFiles));
  const catalogLimit = Number(catalog.limit || 0);
  const storageContractCounts = catalog.storage_contract_counts || {};
  const contractIssues = Number(storageContractCounts.warn || 0) + Number(storageContractCounts.bad || 0);
  const cards = [
    {
      status: catalogRows ? "ok" : "bad",
      label: "Visible Catalog",
      title: `${numberText(catalogRows, 0)} file${catalogRows === 1 ? "" : "s"}`,
      note: `${numberText(symbolCount, 0)} symbol${symbolCount === 1 ? "" : "s"} / ${numberText(totalRows, 0)} total row${totalRows === 1 ? "" : "s"} from configured roots.`,
    },
    {
      status: parserErrors ? "bad" : catalogRows ? "ok" : "warn",
      label: "Malformed",
      title: numberText(parserErrors, 0),
      note: parserErrors
        ? "Parser errors need file-format, timestamp, or OHLC/close column review."
        : "No parser errors reported by the current catalog scan.",
    },
    {
      status: unsupportedFiles ? "warn" : "ok",
      label: "Unsupported",
      title: numberText(unsupportedFiles, 0),
      note: unsupportedFiles
        ? "Unsupported extensions are skipped and will not appear in saved-data tables."
        : "No unsupported saved-data files found in current scan/audit summaries.",
    },
    {
      status: contractIssues ? "warn" : catalogRows ? "ok" : "waiting",
      label: "Storage Contract",
      title: numberText(contractIssues, 0),
      note: contractIssues
        ? "Some files have ambiguous timestamp, session, bar-size, or adjustment metadata."
        : "Visible files satisfy the current storage-contract checks.",
    },
    {
      status: cappedRoots ? "warn" : "ok",
      label: "Scan Caps",
      title: numberText(cappedRoots, 0),
      note: cappedRoots
        ? `Raise catalog or disk scan limits; current catalog limit is ${numberText(catalogLimit, 0)}.`
        : "No root reports a catalog or disk scan cap.",
    },
    {
      status: hiddenTotal ? "warn" : audit.generated_at ? "ok" : "waiting",
      label: "Hidden/Suggested",
      title: numberText(hiddenTotal, 0),
      note: audit.generated_at
        ? `${numberText(hiddenConfigured, 0)} hidden configured / ${numberText(suggestedFiles, 0)} suggested-root file${suggestedFiles === 1 ? "" : "s"}.`
        : "Run Storage Audit to compare disk files against catalog-visible files.",
    },
  ];
  const nextAction = parserErrors
    ? "Review Catalog Scan Diagnostics for malformed file samples."
    : contractIssues
      ? "Filter the catalog for review-status storage contracts before replay."
    : hiddenTotal
      ? "Inspect Storage Audit and copy data_roots YAML for suggested roots."
      : cappedRoots
        ? "Raise catalog or disk scan limits, then refresh Data Library."
        : unsupportedFiles
          ? "Check unsupported samples before assuming files are missing."
          : catalogRows
            ? "Catalog health looks usable; inspect symbols or compare saved files."
            : "Configure a saved-data root or run a fetch job, then refresh.";
  $("data-catalog-health-note").textContent = nextAction;
  $("data-catalog-health-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderDataStorageAudit() {
  const audit = state.dataStorageAudit || {};
  const configuredRows = audit.configured_roots || [];
  const suggestedRows = audit.suggested_roots || [];
  $("data-storage-audit-note").innerHTML = audit.status
    ? qualityBadge(audit.status, audit.warnings || [])
    : "No storage audit loaded";
  const pairs = [
    ["Generated", text(audit.generated_at)],
    ["Catalog Limit", numberText(audit.catalog_limit, 0)],
    ["Per-root Scan Limit", numberText(audit.scan_limit, 0)],
    ["Catalog-visible Files", numberText(audit.catalog_visible_count, 0)],
    ["Configured Files", numberText(audit.configured_file_count, 0)],
    ["Hidden Configured Files", numberText(audit.hidden_configured_file_count, 0)],
    ["Suggested-root Files", numberText(audit.suggested_file_count, 0)],
    ["Unsupported Files", numberText(audit.unsupported_file_count, 0)],
    ["Storage Sessions", countSummary(audit.storage_session_guess_counts)],
    ["Storage Contract", countSummary(audit.storage_contract_guess_counts)],
    ["Root Scan Time", `${numberText(audit.scan_duration_ms_total, 3)} ms`],
    ["Warnings", (audit.warnings || []).join("; ") || "none"],
  ];
  $("data-storage-audit-list").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  renderDataStorageAssistant(audit);
  $("data-storage-visibility-summary").innerHTML = dataStorageVisibilitySummaryCards(audit);
  $("data-storage-audit-actions").innerHTML = dataStorageAuditActions(audit);
  renderDataCatalogHealth();
  const rows = [
    ...configuredRows.map((item) => ({ ...item, scope: "configured" })),
    ...suggestedRows.map((item) => ({ ...item, scope: "suggested" })),
  ];
  $("data-storage-audit-body").innerHTML = rows.length
    ? rows.map((item) => {
        const scopeClass = item.scope === "configured" ? "status-ok" : "status-warn";
        const hiddenSamples = (item.sample_hidden_paths || []).slice(0, 3);
        const unsupportedSamples = (item.sample_unsupported_paths || []).slice(0, 3);
        return row([
          `<span class="${scopeClass}">${escapeHtml(item.scope)}</span>`,
          `<span class="mono">${escapeHtml(item.display_path || item.path)}</span>`,
          `${escapeHtml(text(item.root_scope))}<br><span class="muted">${escapeHtml(text(item.root_scope_note))}</span>`,
          `${escapeHtml(numberText(item.file_count, 0))}${item.scan_capped ? " capped" : ""}`,
          escapeHtml(numberText(item.catalog_visible_count, 0)),
          escapeHtml(numberText(item.hidden_file_count, 0)),
          `${escapeHtml(numberText(item.unsupported_file_count, 0))}<br><span class="muted">${escapeHtml(countSummary(item.unsupported_extension_counts))}</span>`,
          `${escapeHtml(numberText(item.scan_duration_ms, 3))} ms`,
          escapeHtml(countSummary(item.extension_counts)),
          escapeHtml(countSummary(item.asset_class_guess_counts)),
          escapeHtml(countSummary(item.bar_size_guess_counts)),
          escapeHtml(countSummary(item.storage_session_guess_counts)),
          `${escapeHtml(countSummary(item.source_guess_counts))}<br><span class="muted">contract ${escapeHtml(countSummary(item.storage_contract_guess_counts))}</span>`,
          hiddenSamples.length
            ? hiddenSamples.map((path) => `<span class="mono">${escapeHtml(path)}</span>`).join("<br>")
            : `<span class="muted">none</span>`,
          unsupportedSamples.length
            ? unsupportedSamples.map((path) => `<span class="mono">${escapeHtml(path)}</span>`).join("<br>")
            : `<span class="muted">none</span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No data roots with saved files were found</span>`, "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
}

function dataStorageAuditModel(audit = {}) {
  const summary = audit.visibility_summary || {};
  const configuredRows = audit.configured_roots || [];
  const suggestedRows = audit.suggested_roots || [];
  const allRows = [...configuredRows, ...suggestedRows];
  const configuredFiles = Number(audit.configured_file_count || 0);
  const configuredVisible = Number(summary.catalog_visible_configured_file_count ?? audit.configured_visible_count ?? audit.catalog_visible_count ?? 0);
  const hiddenConfigured = Number(summary.hidden_configured_file_count ?? audit.hidden_configured_file_count ?? 0);
  const suggestedFiles = Number(summary.suggested_unconfigured_file_count ?? audit.suggested_file_count ?? 0);
  const unsupportedFiles = Number(summary.unsupported_file_count ?? audit.unsupported_file_count ?? 0);
  const catalogErrors = Number(audit.catalog_error_count || 0);
  const cappedRows = allRows.filter((rowItem) => rowItem.scan_capped);
  const errorRows = allRows.filter((rowItem) => Number(rowItem.error_count || 0) > 0);
  const hiddenTotal = Number(summary.hidden_total_file_count ?? (hiddenConfigured + suggestedFiles));
  const visibilityPct = finiteNumber(summary.configured_visibility_pct);
  return {
    generated: Boolean(audit.generated_at),
    configuredRows,
    suggestedRows,
    allRows,
    configuredFiles,
    configuredVisible,
    hiddenConfigured,
    suggestedFiles,
    unsupportedFiles,
    catalogErrors,
    cappedRows,
    errorRows,
    hiddenTotal,
    visibilityPct,
  };
}

function renderDataStorageAssistant(audit = state.dataStorageAudit || {}) {
  if (!$("data-storage-assistant-title") || !$("data-storage-assistant-cards") || !$("data-storage-assistant-actions")) return;
  const model = dataStorageAuditModel(audit);
  const status = !model.generated
    ? "waiting"
    : model.catalogErrors || model.errorRows.length
      ? "bad"
      : model.hiddenTotal || model.unsupportedFiles || model.cappedRows.length
        ? "warn"
        : model.configuredFiles
          ? "ok"
          : "bad";
  const title = !model.generated
    ? "Run Storage Audit"
    : status === "ok"
      ? "Saved Data Visibility Looks Good"
      : status === "bad"
        ? "Saved Data Visibility Blocked"
        : "Saved Data Needs Review";
  const note = !model.generated
    ? "Refresh Data Library diagnostics to compare disk files, configured roots, suggested roots, and catalog-visible rows."
    : model.catalogErrors || model.errorRows.length
      ? "Parser or root scan errors can keep files out of the catalog. Review scan diagnostics before trusting saved-data coverage."
      : model.suggestedFiles
        ? "History exists outside configured roots. Copy data_roots YAML or add the suggested path to local dashboard config."
        : model.hiddenConfigured
          ? "Some configured-root files are not catalog-visible. Raise limits or inspect hidden samples to learn why."
          : model.unsupportedFiles
            ? "Unsupported extensions were skipped; confirm whether those files should be converted or ignored."
            : model.cappedRows.length
              ? "At least one audited root hit the disk scan cap. Raise the disk scan limit for a fuller inventory."
              : model.configuredFiles
                ? "Configured roots have catalog-visible saved files. Browse symbols or inspect a saved file next."
                : "No saved CSV/parquet files were found under configured or suggested roots.";
  $("data-storage-assistant-title").textContent = title;
  $("data-storage-assistant-title").className = statusClass(status);
  $("data-storage-assistant-note").textContent = note;
  const cards = [
    {
      status: model.configuredFiles ? model.hiddenConfigured ? "warn" : "ok" : model.suggestedFiles ? "warn" : "bad",
      label: "Configured Roots",
      title: model.visibilityPct === null ? numberText(model.configuredVisible, 0) : pctText(model.visibilityPct),
      note: `${numberText(model.configuredVisible, 0)} visible / ${numberText(model.configuredFiles, 0)} configured saved file${model.configuredFiles === 1 ? "" : "s"}.`,
    },
    {
      status: model.suggestedFiles ? "warn" : model.generated ? "ok" : "waiting",
      label: "Suggested Roots",
      title: numberText(model.suggestedFiles, 0),
      note: model.suggestedFiles
        ? `${numberText(model.suggestedRows.length, 0)} unconfigured root${model.suggestedRows.length === 1 ? "" : "s"} contain saved data.`
        : "No unconfigured saved-data roots were detected.",
    },
    {
      status: model.hiddenConfigured ? "warn" : model.generated ? "ok" : "waiting",
      label: "Hidden Files",
      title: numberText(model.hiddenConfigured, 0),
      note: model.hiddenConfigured
        ? "Configured-root files exist on disk but did not appear in the bounded catalog."
        : "No configured-root hidden files reported by the audit.",
    },
    {
      status: model.catalogErrors || model.errorRows.length ? "bad" : model.unsupportedFiles ? "warn" : model.generated ? "ok" : "waiting",
      label: "Skips And Errors",
      title: `${numberText(model.catalogErrors + model.errorRows.length, 0)} errors`,
      note: `${numberText(model.unsupportedFiles, 0)} unsupported file${model.unsupportedFiles === 1 ? "" : "s"}; ${numberText(model.cappedRows.length, 0)} capped root${model.cappedRows.length === 1 ? "" : "s"}.`,
    },
  ];
  $("data-storage-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const actions = [
    {
      action: "copy-roots",
      status: model.suggestedFiles ? "warn" : dataRootConfigPaths().length ? "ok" : "bad",
      title: "Copy data_roots YAML",
      note: model.suggestedFiles
        ? "Copy configured plus suggested roots into ignored local config."
        : "Copy the current dashboard data-root block.",
      disabled: !dataRootConfigPaths().length,
    },
    {
      action: "raise-disk",
      status: model.cappedRows.length ? "warn" : "ok",
      title: "Raise Disk Scan",
      note: model.cappedRows.length
        ? "Switch Storage Audit to the largest per-root scan limit and refresh diagnostics."
        : "Use this only when you suspect a large root is capped.",
      disabled: !model.generated,
    },
    {
      action: "raise-catalog",
      status: model.hiddenConfigured ? "warn" : "ok",
      title: "Raise Catalog Rows",
      note: model.hiddenConfigured
        ? "Increase Data Library row cap so more configured-root files can appear."
        : "Useful when the catalog table has reached its row limit.",
      disabled: !model.generated,
    },
    {
      action: "scan",
      status: model.catalogErrors || model.errorRows.length ? "bad" : model.unsupportedFiles ? "warn" : "ok",
      title: "Review Scan Diagnostics",
      note: "Jump to parser errors, unsupported files, skipped samples, and cap reasons.",
      disabled: !model.generated,
    },
    {
      action: "browse",
      status: model.configuredVisible ? "ok" : "bad",
      title: "Browse Visible Symbols",
      note: "Open Symbol Browser and Directory for currently catalog-visible files.",
      disabled: !model.configuredVisible,
    },
    {
      action: "fetch",
      status: model.configuredFiles || model.suggestedFiles ? "ok" : "warn",
      title: "Open Fetch Jobs",
      note: model.configuredFiles || model.suggestedFiles
        ? "Review fetch outputs that should map into Data Library."
        : "Fetch history when no saved files are present.",
      disabled: false,
    },
  ];
  $("data-storage-assistant-actions").innerHTML = actions.map((item) => `
    <button class="data-storage-assistant-action status-${escapeHtml(item.status)}" data-data-storage-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

function handleDataStorageAssistantAction(action) {
  if (action === "copy-roots") {
    copyDataRootsYaml();
    return;
  }
  if (action === "raise-disk") {
    $("data-storage-scan-limit").value = "50000";
    refreshDataDiagnostics({ force: true }).catch((err) => {
      $("last-refresh").textContent = `Storage audit refresh failed: ${err.message}`;
    });
    return;
  }
  if (action === "raise-catalog") {
    setDataCatalogLimitToMax();
    refreshDataLibrary({ includeDiagnostics: true, force: true }).catch((err) => {
      $("last-refresh").textContent = `Catalog refresh failed: ${err.message}`;
    });
    return;
  }
  if (action === "scan") {
    $("data-catalog-scan-body").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Review Catalog Scan Diagnostics for parser errors, skipped files, and scan caps";
    return;
  }
  if (action === "browse") {
    navigateToDataLens("browse");
    return;
  }
  if (action === "fetch") {
    navigateToView("fetch");
  }
}

function dataStorageVisibilitySummaryCards(audit = {}) {
  if (!audit.generated_at) {
    return `
      <div class="empty-card">
        <span>Visibility</span>
        <strong>No Audit Loaded</strong>
        <small>Refresh Data Library to compare disk files with catalog-visible rows.</small>
      </div>
    `;
  }
  const summary = audit.visibility_summary || {};
  const configuredFiles = Number(audit.configured_file_count || 0);
  const configuredVisible = Number(summary.catalog_visible_configured_file_count ?? audit.configured_visible_count ?? 0);
  const hiddenConfigured = Number(summary.hidden_configured_file_count ?? audit.hidden_configured_file_count ?? 0);
  const suggestedFiles = Number(summary.suggested_unconfigured_file_count ?? audit.suggested_file_count ?? 0);
  const unsupportedFiles = Number(summary.unsupported_file_count ?? audit.unsupported_file_count ?? 0);
  const cappedRoots = Number(summary.capped_root_count || 0);
  const hiddenTotal = Number(summary.hidden_total_file_count ?? (hiddenConfigured + suggestedFiles));
  const visibilityPct = finiteNumber(summary.configured_visibility_pct);
  const hiddenStatus = hiddenTotal ? "warn" : configuredFiles ? "ok" : "bad";
  const cards = [
    {
      status: configuredFiles ? hiddenConfigured ? "warn" : "ok" : suggestedFiles ? "warn" : "bad",
      label: "Configured Visibility",
      title: visibilityPct === null ? "n/a" : pctText(visibilityPct),
      note: `${numberText(configuredVisible, 0)} of ${numberText(configuredFiles, 0)} configured-root saved file${configuredFiles === 1 ? "" : "s"} are catalog-visible.`,
    },
    {
      status: hiddenStatus,
      label: "Hidden From Catalog",
      title: numberText(hiddenTotal, 0),
      note: `${numberText(hiddenConfigured, 0)} hidden configured / ${numberText(suggestedFiles, 0)} suggested-root file${suggestedFiles === 1 ? "" : "s"}.`,
    },
    {
      status: unsupportedFiles ? "warn" : "ok",
      label: "Unsupported",
      title: numberText(unsupportedFiles, 0),
      note: unsupportedFiles
        ? `${countSummary(audit.unsupported_extension_counts)} extensions are skipped by the catalog.`
        : "No unsupported files found in audited roots.",
    },
    {
      status: cappedRoots ? "warn" : "ok",
      label: "Scan Caps",
      title: numberText(cappedRoots, 0),
      note: cappedRoots
        ? `${numberText(cappedRoots, 0)} root${cappedRoots === 1 ? "" : "s"} hit the ${numberText(audit.scan_limit, 0)} per-root disk scan limit.`
        : "No audited root hit the selected disk scan limit.",
    },
  ];
  return cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function dataStorageAuditActions(audit = {}) {
  const configuredRows = audit.configured_roots || [];
  const suggestedRows = audit.suggested_roots || [];
  const rows = [...configuredRows, ...suggestedRows];
  const configuredFiles = Number(audit.configured_file_count || 0);
  const suggestedFiles = Number(audit.suggested_file_count || 0);
  const hiddenConfigured = Number(audit.hidden_configured_file_count || 0);
  const unsupportedFiles = Number(audit.unsupported_file_count || 0);
  const catalogErrors = Number(audit.catalog_error_count || 0);
  const cappedRows = rows.filter((rowItem) => rowItem.scan_capped);
  const errorRoots = rows.filter((rowItem) => Number(rowItem.error_count || 0) > 0);
  const cards = [];
  if (!audit.generated_at) {
    cards.push({
      status: "waiting",
      title: "Run Audit",
      note: "Refresh Data Library to scan configured and suggested saved-data roots.",
    });
  } else if (!configuredFiles && suggestedFiles) {
    cards.push({
      status: "warn",
      title: "Configure Suggested Root",
      note: `${numberText(suggestedFiles, 0)} saved file${suggestedFiles === 1 ? "" : "s"} exist in suggested roots. Copy data_roots YAML or start the dashboard with those roots.`,
    });
  } else if (!configuredFiles && !suggestedFiles) {
    cards.push({
      status: "bad",
      title: "No Saved Files Found",
      note: "Fetch historical data or add the cache/history directory that contains CSV/parquet files.",
    });
  } else {
    cards.push({
      status: "ok",
      title: "Roots Scanned",
      note: `${numberText(configuredFiles, 0)} configured file${configuredFiles === 1 ? "" : "s"} and ${numberText(suggestedFiles, 0)} suggested-root file${suggestedFiles === 1 ? "" : "s"} were audited.`,
    });
  }
  if (configuredFiles && suggestedFiles) {
    cards.push({
      status: "warn",
      title: "Add Suggested Roots",
      note: `${numberText(suggestedFiles, 0)} additional saved file${suggestedFiles === 1 ? "" : "s"} exist outside configured roots.`,
    });
  }
  if (hiddenConfigured) {
    cards.push({
      status: "warn",
      title: "Inspect Hidden Files",
      note: `${numberText(hiddenConfigured, 0)} configured-root file${hiddenConfigured === 1 ? "" : "s"} did not appear in the bounded catalog result. Raise catalog limit or inspect sample hidden paths.`,
    });
  }
  if (cappedRows.length) {
    cards.push({
      status: "warn",
      title: "Raise Disk Scan Limit",
      note: `${numberText(cappedRows.length, 0)} root${cappedRows.length === 1 ? "" : "s"} hit the per-root scan limit of ${numberText(audit.scan_limit, 0)} files.`,
    });
  }
  if (unsupportedFiles) {
    cards.push({
      status: "warn",
      title: "Check Unsupported Files",
      note: `${numberText(unsupportedFiles, 0)} file${unsupportedFiles === 1 ? "" : "s"} under audited roots have unsupported extensions and are not catalog-visible.`,
    });
  }
  if (catalogErrors || errorRoots.length) {
    cards.push({
      status: "bad",
      title: "Review Parser Errors",
      note: `${numberText(catalogErrors, 0)} catalog parser error${catalogErrors === 1 ? "" : "s"} and ${numberText(errorRoots.length, 0)} root scan error${errorRoots.length === 1 ? "" : "s"} need review in scan diagnostics or the audit table.`,
    });
  }
  if (audit.status === "ok" && cards.length === 1) {
    cards.push({
      status: "ok",
      title: "Ready To Browse",
      note: "Use Symbol Directory, Data Detail, or Compare Saved Data to inspect saved files before replay.",
    });
  }
  return cards.slice(0, 5).map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderDataCoverage() {
  const coverage = state.dataCoverage || {};
  const symbols = coverage.symbols || [];
  const dateBins = coverage.date_bins || [];
  $("data-coverage-note").textContent = coverage.generated_at
    ? `${numberText(symbols.length, 0)} shown / ${numberText(coverage.total_symbol_count || symbols.length, 0)} symbols / ${numberText(dateBins.length, 0)} dates`
    : "No coverage loaded";
  $("data-coverage-grid").innerHTML = symbols.length
    ? symbols.slice(0, 30).map((item) => {
        const covered = (item.coverage || []).filter(Boolean).length;
        const cells = (item.coverage || []).map((hasData, index) => {
          const title = `${dateBins[index] || "date"} ${hasData ? "covered" : "missing"}`;
          return `<span class="coverage-cell ${hasData ? "covered" : "missing"}" title="${escapeHtml(title)}"></span>`;
        }).join("");
        return `
          <div class="coverage-row">
            <div class="coverage-label">
              <strong>${escapeHtml(item.symbol)}</strong>
              <small>${escapeHtml((item.bar_sizes || []).join(", ") || "n/a")} / ${escapeHtml((item.sources || []).join(", ") || "n/a")} / ${escapeHtml((item.storage_sessions || []).join(", ") || "n/a")}</small>
            </div>
            <div class="coverage-strip">${cells}</div>
            <small>${escapeHtml(numberText(covered, 0))}/${escapeHtml(numberText(dateBins.length, 0))} recent dates</small>
          </div>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No coverage yet</strong><span>No parseable saved datasets are visible under configured roots.</span></div>`;
}

function renderDataGapSummary() {
  const summary = state.dataGapSummary || {};
  const gapRows = summary.gap_rows || [];
  const calendarRows = summary.calendar_rows || [];
  $("data-gap-summary-note").innerHTML = summary.generated_at
    ? qualityBadge(summary.status, summary.warnings || [])
    : "No gap summary loaded";
  const pairs = [
    ["Datasets", numberText(summary.dataset_count, 0)],
    ["Files With Gaps", numberText(summary.files_with_gap_warnings, 0)],
    ["Estimated Missing Intervals", numberText(summary.total_estimated_missing_intervals, 0)],
    ["Largest Gap", interval(summary.largest_gap_seconds)],
    ["Files With Missing Days", numberText(summary.files_with_missing_calendar_days, 0)],
    ["Catalog Errors", numberText(summary.catalog_error_count, 0)],
  ];
  $("data-gap-summary-list").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  $("data-gap-summary-body").innerHTML = gapRows.length
    ? gapRows.map((item) => row([
        escapeHtml(item.symbol),
        `${escapeHtml(text(item.bar_size))}<br><small>${escapeHtml(text(item.storage_session))}</small>`,
        escapeHtml(numberText(item.estimated_missing_intervals, 0)),
        escapeHtml(interval(item.largest_gap_seconds)),
        qualityBadge(item.quality_status, []),
        escapeHtml(rangeLabel(item.first_timestamp, item.last_timestamp)),
        `<span class="mono">${escapeHtml(item.path)}</span>`,
      ])).join("")
    : row([`<span class="muted">No timestamp gap warnings in the current catalog scan.</span>`, "", "", "", "", "", ""]);
  $("data-calendar-gap-body").innerHTML = calendarRows.length
    ? calendarRows.map((item) => row([
        escapeHtml(item.symbol),
        `${escapeHtml(text(item.bar_size))}<br><small>${escapeHtml(text(item.storage_session))}</small>`,
        escapeHtml(numberText(item.missing_calendar_days, 0)),
        `${escapeHtml(numberText(item.date_count, 0))} / ${escapeHtml(numberText(item.calendar_day_count, 0))}`,
        escapeHtml(rangeLabel(item.first_day, item.last_day)),
        `<span class="mono">${escapeHtml(item.path)}</span>`,
      ])).join("")
    : row([`<span class="muted">No missing calendar-day gaps in the current catalog scan.</span>`, "", "", "", "", ""]);
}

function heatmapCellClass(hour) {
  const expected = Number(hour.expected_intervals || 0);
  if (!expected) return "empty";
  const completeness = Number(hour.completeness_pct);
  if (!Number.isFinite(completeness)) return "empty";
  if (completeness >= 99.5) return "good";
  if (completeness >= 95) return "warn-light";
  if (completeness >= 80) return "warn";
  return "bad";
}

function renderDataMinuteHeatmap() {
  const summary = state.dataMinuteHeatmap || {};
  const rows = summary.rows || [];
  $("data-minute-heatmap-note").innerHTML = summary.generated_at
    ? qualityBadge(summary.status, summary.warnings || [])
    : "No minute heatmap loaded";
  const pairs = [
    ["Datasets", numberText(summary.dataset_count, 0)],
    ["Overall Completeness", pctText(summary.overall_completeness_pct)],
    ["Expected Intervals", numberText(summary.total_expected_intervals, 0)],
    ["Missing Intervals", numberText(summary.total_estimated_missing_intervals, 0)],
    ["Parser Errors", numberText(summary.error_count, 0)],
  ];
  $("data-minute-heatmap-list").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  $("data-minute-heatmap-grid").innerHTML = rows.length
    ? rows.slice(0, 20).map((item) => {
        const cells = (item.hours || []).map((hour) => {
          const label = `${String(hour.hour_utc).padStart(2, "0")}:00 UTC completeness ${pctText(hour.completeness_pct)}, missing ${numberText(hour.estimated_missing_intervals, 0)} of ${numberText(hour.expected_intervals, 0)}`;
          return `<span class="coverage-cell heatmap-${heatmapCellClass(hour)}" title="${escapeHtml(label)}"></span>`;
        }).join("");
        return `
          <div class="coverage-row minute-heatmap-row">
            <div class="coverage-label">
              <strong>${escapeHtml(item.symbol)}</strong>
              <small>${escapeHtml(text(item.bar_size))} / ${escapeHtml(text(item.source))} / ${escapeHtml(text(item.storage_session))}</small>
            </div>
            <div class="coverage-strip minute-heatmap-strip">${cells}</div>
            <small>${escapeHtml(pctText(item.completeness_pct))} complete</small>
          </div>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No interval heatmap yet</strong><span>No parseable multi-row saved datasets are visible under configured roots.</span></div>`;
  $("data-minute-heatmap-body").innerHTML = rows.length
    ? rows.slice(0, 20).map((item) => {
        const worst = (item.worst_hours || []).map((hour) => (
          `${String(hour.hour_utc).padStart(2, "0")}:00 ${pctText(hour.completeness_pct)} (${numberText(hour.estimated_missing_intervals, 0)} missing)`
        )).join("; ") || "none";
        return row([
          escapeHtml(item.symbol),
          escapeHtml(text(item.bar_size)),
          escapeHtml(pctText(item.completeness_pct)),
          escapeHtml(numberText(item.estimated_missing_intervals, 0)),
          escapeHtml(interval(item.median_interval_seconds)),
          escapeHtml(worst),
          `<span class="mono">${escapeHtml(item.path)}</span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No intraday interval gaps in the current catalog scan.</span>`, "", "", "", "", "", ""]);
  const dateHourRows = summary.date_hour_rows || [];
  const dateHourMatrix = summary.date_hour_matrix || [];
  $("data-minute-date-hour-grid").innerHTML = dateHourMatrix.length
    ? dateHourMatrix.slice(0, 20).map((item) => {
        const cells = (item.hours || []).map((hour) => {
          const label = `${text(item.symbol)} ${text(item.date_utc)} ${String(hour.hour_utc).padStart(2, "0")}:00 UTC completeness ${pctText(hour.completeness_pct)}, missing ${numberText(hour.estimated_missing_intervals, 0)} of ${numberText(hour.expected_intervals, 0)}`;
          return `<span class="coverage-cell heatmap-${heatmapCellClass(hour)}" title="${escapeHtml(label)}"></span>`;
        }).join("");
        return `
          <div class="coverage-row minute-heatmap-row">
            <div class="coverage-label">
              <strong>${escapeHtml(item.symbol)} ${escapeHtml(item.date_utc)}</strong>
              <small>${escapeHtml(text(item.bar_size))} / ${escapeHtml(text(item.source))} / ${escapeHtml(numberText(item.estimated_missing_intervals, 0))} missing</small>
            </div>
            <div class="coverage-strip minute-heatmap-strip">${cells}</div>
            <small>${escapeHtml(pctText(item.completeness_pct))} complete</small>
          </div>
        `;
      }).join("")
    : "";
  $("data-minute-date-hour-body").innerHTML = dateHourRows.length
    ? dateHourRows.slice(0, 20).map((item) => row([
        escapeHtml(item.symbol),
        escapeHtml(item.date_utc),
        escapeHtml(`${String(item.hour_utc).padStart(2, "0")}:00`),
        escapeHtml(pctText(item.completeness_pct)),
        escapeHtml(numberText(item.estimated_missing_intervals, 0)),
        `${escapeHtml(numberText(item.actual_intervals, 0))} / ${escapeHtml(numberText(item.expected_intervals, 0))}`,
        `<span class="mono">${escapeHtml(item.path)}</span>`,
      ])).join("")
    : row([`<span class="muted">No date/hour missing interval drilldowns in the current catalog scan.</span>`, "", "", "", "", "", ""]);
}

function renderSymbolDiagnostic() {
  const diagnostic = state.symbolDiagnostic || {};
  $("data-symbol-diagnostic-status").innerHTML = diagnostic.status
    ? statusText(diagnostic.status === "visible" ? "ok" : diagnostic.status === "not_found" ? "bad" : "warn")
    : "No symbol checked";
  const pairs = diagnostic.symbol
    ? [
        ["Symbol", diagnostic.symbol],
        ["Status", diagnostic.status],
        ["Finding", diagnostic.message],
        ["Next Step", diagnostic.action],
        ["Catalog Matches", numberText((diagnostic.catalog_matches || []).length, 0)],
        ["Configured Candidates", numberText((diagnostic.configured_candidates || []).length, 0)],
        ["Unconfigured Matches", numberText((diagnostic.unconfigured_matches || []).length, 0)],
      ]
    : [["How to use", "Enter a ticker to explain whether saved data is visible, outside the scan limit, in an unconfigured root, malformed, or only present in fetch errors."]];
  $("data-symbol-diagnostic-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");

  const candidates = [
    ...(diagnostic.configured_candidates || []),
    ...(diagnostic.unconfigured_matches || []).map((item) => ({ ...item, unconfigured: true })),
  ];
  $("data-symbol-candidates-body").innerHTML = candidates.length
    ? candidates.slice(0, 50).map((item) => row([
        `<span class="mono">${escapeHtml(item.path)}</span>`,
        escapeHtml(item.unconfigured ? "unconfigured" : text(item.in_catalog_scope)),
        escapeHtml(item.symbol || "n/a"),
        escapeHtml(numberText(item.rows, 0)),
        escapeHtml(rangeLabel(item.first_timestamp, item.last_timestamp)),
        escapeHtml(item.error || item.quality_status || ""),
      ])).join("")
    : row([`<span class="muted">No matching files checked</span>`, "", "", "", "", ""]);

  const fetchRows = diagnostic.fetch_manifest_rows || [];
  $("data-symbol-fetch-body").innerHTML = fetchRows.length
    ? fetchRows.slice(0, 50).map((item) => row([
        escapeHtml(item.job_id),
        escapeHtml(item.type),
        statusText(item.status || item.kind),
        escapeHtml(item.day),
        escapeHtml(item.path || item.message || `rows=${text(item.rows)}`),
      ])).join("")
    : row([`<span class="muted">No fetch manifest clues for this symbol</span>`, "", "", "", ""]);
}

function renderWorkbenchStatus() {
  const status = state.workbenchStatus || {};
  const latest = status.latest_run || {};
  $("workbench-status-note").textContent = status.run_count === undefined
    ? "Not loaded"
    : `${numberText(status.run_count, 0)} runs / ${numberText(status.archived_run_count, 0)} archives`;
  const latestLabel = latest.run_id
    ? `${text(latest.draft_id)} ${text(latest.action)} ${text(latest.status)} ${text(latest.finished_at)}`
    : "none";
  const pairs = [
    ["Drafts", numberText(status.draft_count, 0)],
    ["Runs", numberText(status.run_count, 0)],
    ["Archived Runs", numberText(status.archived_run_count, 0)],
    ["Orphan Archives", numberText(status.orphaned_archive_count, 0)],
    ["Orphan Outputs", numberText(status.orphaned_output_count, 0)],
    ["Reclaimable", bytes(status.reclaimable_bytes)],
    ["State Size", bytes(status.state_bytes)],
    ["Draft Size", bytes(status.draft_bytes)],
    ["Archive Size", bytes(status.archived_artifact_bytes)],
    ["Output Size", bytes(status.workbench_output_bytes)],
    ["Run Statuses", jsonDrilldown(status.status_counts || {}, countSummary(status.status_counts || {})), true],
    ["Run Actions", jsonDrilldown(status.action_counts || {}, countSummary(status.action_counts || {})), true],
    ["Latest Run", latestLabel],
    ["State Dir", status.state_dir],
  ];
  $("workbench-status-list").innerHTML = kvRows(pairs);
}

function pathList(items) {
  const rows = (items || []).slice(0, 8).map((item) => (
    `${item.path} (${bytes(item.size_bytes)})`
  ));
  if ((items || []).length > rows.length) {
    rows.push(`+${(items || []).length - rows.length} more`);
  }
  return rows.length ? rows.join("\n") : "none";
}

function renderCleanupPlan() {
  const plan = state.cleanupPlan || {};
  $("cleanup-note").textContent = plan.generated_at
    ? `${numberText(plan.reclaimable_dir_count, 0)} directories / ${bytes(plan.reclaimable_bytes)}`
    : "Not loaded";
  const pairs = [
    ["Generated", text(plan.generated_at)],
    ["Orphan Archives", numberText(plan.orphaned_archive_count, 0)],
    ["Orphan Outputs", numberText(plan.orphaned_output_count, 0)],
    ["Reclaimable", bytes(plan.reclaimable_bytes)],
    ["Archive Paths", pathList(plan.orphaned_archives)],
    ["Output Paths", pathList(plan.orphaned_outputs)],
  ];
  $("cleanup-plan").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd><span class="mono">${escapeHtml(value)}</span></dd>`
  )).join("");
}

function renderDiagnostics() {
  const diagnostics = state.diagnostics || {};
  const stateDir = diagnostics.state_dir || {};
  const dataRoots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const assets = diagnostics.dashboard_assets || [];
  $("diagnostics-note").innerHTML = diagnostics.status
    ? qualityBadge(diagnostics.status, diagnostics.warnings || [])
    : "Not loaded";
  const rootSummary = dataRoots.length
    ? dataRoots.map((root) => (
        `${root.display_path || root.path}: exists=${text(root.exists)} writable=${text(root.writable)} files=${numberText(root.data_file_count, 0)}`
      )).join("\n")
    : "none";
  const suggestedRootSummary = suggestedRoots.length
    ? suggestedRoots.map((root) => (
        `${root.display_path || root.path}: files=${numberText(root.data_file_count, 0)}`
      )).join("\n")
    : "none";
  const assetSummary = assets.length
    ? assets.map((asset) => `${asset.name}: ${asset.exists ? "ok" : "missing"} (${bytes(asset.size_bytes)})`).join("\n")
    : "none";
  const pairs = [
    ["Generated", text(diagnostics.generated_at)],
    ["Warnings", (diagnostics.warnings || []).join("; ") || "none"],
    ["State Dir", `${text(stateDir.path)} writable=${text(stateDir.writable)} exists=${text(stateDir.exists)}`],
    ["Data Roots", rootSummary],
    ["Suggested Roots", suggestedRootSummary],
    ["Dashboard Assets", assetSummary],
  ];
  $("diagnostics-list").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd><span class="mono">${escapeHtml(value)}</span></dd>`
  )).join("");
}

function renderEndpointMap() {
  const endpointMap = state.endpointMap || {};
  const endpoints = endpointMap.endpoints || [];
  $("endpoint-map-note").textContent = endpointMap.generated_at
    ? `${numberText(endpointMap.count, 0)} endpoints / ${countSummary(endpointMap.categories)}`
    : "Not loaded";
  $("endpoint-map-body").innerHTML = endpoints.length
    ? endpoints.map((endpoint) => row([
        `<span class="mono">${escapeHtml(endpoint.method)}</span>`,
        `<span class="mono">${escapeHtml(endpoint.path)}</span>`,
        escapeHtml(endpoint.category),
        escapeHtml(endpoint.description),
        escapeHtml(endpoint.response),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", ""]);
}

function renderDataDetail() {
  const detail = state.dataDetail || {};
  const coverage = detail.coverage || {};
  const quality = detail.quality || {};
  const price = detail.price_stats || {};
  const returns = detail.return_stats || {};
  const volume = detail.volume_stats || {};
  const ohlc = detail.ohlc_stats || {};
  const viewer = detail.viewer || {};
  const timezoneMode = $("data-detail-timezone").value || "utc";
  const chartStyle = $("data-detail-chart-style").value || "candles";
  $("data-detail-title").textContent = detail.path
    ? `${text(detail.symbol)} ${text(detail.bar_size)} - ${text(detail.path)}`
    : "No dataset selected";
  if (detail.path && detail.symbol) {
    $("data-detail-symbol").value = text(detail.symbol);
  }
  $("data-detail-viewer-note").textContent = detail.path
    ? `${numberText(viewer.sampled_points, 0)} plotted / ${numberText(viewer.filtered_rows, 0)} in range / ${numberText(viewer.available_rows, 0)} available rows, ${viewer.sampled ? "sampled" : "full"} ${timezoneLabel(timezoneMode)} view`
    : "Select a dataset to inspect saved history offline.";
  $("copy-data-path").disabled = !detail.path;
  $("copy-data-root-flag").disabled = !detail.path;
  $("copy-data-replay-command").disabled = !detail.path;
  $("use-data-detail-workbench").disabled = !detail.path;
  $("export-data-detail-range").disabled = !detail.path;
  $("export-data-missing-intervals").disabled = !detail.path;
  if ($("data-detail-focus-gap")) {
    $("data-detail-focus-gap").disabled = !detail.path || !largestDataDetailGap(detail);
  }
  renderDataDetailNavigator(detail);
  renderDataDetailAssistant(detail, timezoneMode);
  renderDataDetailOverview(detail, timezoneMode);
  $("data-detail-health").innerHTML = dataDetailHealthCards(detail, timezoneMode);
  renderDataDetailRangeStats(detail, timezoneMode);
  const pairs = [
    ["File Path", text(detail.path)],
    ["Asset", text(detail.asset_class)],
    ["Source", text(detail.source)],
    ["Canonical Symbol", text(detail.canonical_symbol)],
    ["Session", text(detail.storage_session)],
    ["Adjustment", text(detail.adjustment_status)],
    ["Storage Contract", `${text(detail.storage_contract_status)}${(detail.storage_contract_warnings || []).length ? ` (${(detail.storage_contract_warnings || []).join("; ")})` : ""}`],
    ["File Size", bytes(detail.size_bytes)],
    ["Modified", timestampAgeLabel(detail.modified_at)],
    ["Rows", numberText(detail.rows, 0)],
    ["Viewer Rows", `${numberText(viewer.filtered_rows, 0)} filtered / ${numberText(viewer.available_rows, 0)} available`],
    ["Viewer Range", timeRangeLabel(viewer.first_timestamp, viewer.last_timestamp, timezoneMode)],
    ["Range", timeRangeLabel(coverage.first_timestamp, coverage.last_timestamp, timezoneMode)],
    ["Median Step", interval(coverage.median_interval_seconds)],
    ["Largest Gap", interval(coverage.largest_gap_seconds)],
    ["Missing Est.", numberText(coverage.estimated_missing_intervals, 0)],
    ["Duplicates", numberText(coverage.duplicate_timestamps, 0)],
    ["Quality", `${text(quality.quality_status)}${(quality.quality_warnings || []).length ? ` (${(quality.quality_warnings || []).length})` : ""}`],
    ["Warnings", (quality.quality_warnings || []).join("; ") || "none"],
    ["TZ", text(detail.source_timezone)],
    ["Display TZ", timezoneLabel(timezoneMode)],
    ["Close Range", `${numberText(price.min_close)} -> ${numberText(price.max_close)}`],
    ["OHLC", ohlc.available ? "available" : "close-only"],
    ["OHLC High/Low", `${numberText(ohlc.range_high)} -> ${numberText(ohlc.range_low)}`],
    ["Open To Close", pctText(ohlc.open_to_close_pct)],
    ["Candle Bias", ohlc.available ? `${numberText(ohlc.up_candles, 0)} up / ${numberText(ohlc.down_candles, 0)} down / ${numberText(ohlc.flat_candles, 0)} flat` : "n/a"],
    ["Total Return", pctText(price.total_return_pct)],
    ["Bar Std", pctText(returns.std_pct)],
    ["Mean Abs Bar", pctText(returns.mean_abs_pct)],
    ["Volume Median", numberText(volume.median, 0)],
  ];
  $("data-detail-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  $("data-detail-chart").innerHTML = chartStyle === "line"
    ? detailChart(detail.preview || [], timezoneMode, detail.gaps || [])
    : candlestickChart(detail.preview || [], timezoneMode, detail.gaps || []);

  const nullCounts = quality.null_counts || {};
  $("data-quality-body").innerHTML = Object.keys(nullCounts).length
    ? Object.entries(nullCounts).map(([key, value]) => row([
        escapeHtml(key),
        escapeHtml(value),
      ])).join("")
    : row([`<span class="muted">none</span>`, ""]);

  const gaps = detail.gaps || [];
  $("data-gaps-body").innerHTML = gaps.length
    ? gaps.map((gap) => row([
        escapeHtml(formatTimestampForMode(gap.from_timestamp, timezoneMode)),
        escapeHtml(formatTimestampForMode(gap.to_timestamp, timezoneMode)),
        escapeHtml(interval(gap.gap_seconds)),
        escapeHtml(gap.estimated_missing_intervals),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", ""]);
  const missingIntervals = detail.missing_intervals || [];
  const omitted = Number(detail.missing_interval_omitted_count || 0);
  $("data-missing-intervals-note").textContent = detail.path
    ? `${numberText(missingIntervals.length, 0)} shown / ${numberText(coverage.estimated_missing_intervals, 0)} estimated${omitted ? ` / ${numberText(omitted, 0)} omitted by limit` : ""}`
    : "No missing intervals loaded";
  $("data-missing-intervals-body").innerHTML = missingIntervals.length
    ? missingIntervals.map((item) => row([
        escapeHtml(formatTimestampForMode(item.expected_timestamp, timezoneMode)),
        `${escapeHtml(formatTimestampForMode(item.from_timestamp, timezoneMode))}<br><span class="muted">${escapeHtml(formatTimestampForMode(item.to_timestamp, timezoneMode))}</span>`,
        escapeHtml(interval(item.gap_seconds)),
      ])).join("")
    : row([`<span class="muted">No inferred missing timestamps in this saved file.</span>`, "", ""]);
}

function previewCloseReturn(points = []) {
  const rows = (points || []).map((point) => ({
    timestamp: point.timestamp,
    close: finiteNumber(point.close),
  })).filter((point) => point.close !== null);
  if (rows.length < 2) return null;
  const first = rows[0].close;
  const last = rows[rows.length - 1].close;
  if (!first) return null;
  return ((last / first) - 1) * 100;
}

function renderDataDetailRangeStats(detail = {}, timezoneMode = "utc") {
  const container = $("data-detail-range-stats");
  if (!container) return;
  if (!detail || !detail.path) {
    container.innerHTML = `
      <div class="data-range-stat">
        <span>Range Stats</span>
        <strong>No File</strong>
        <small>Open a saved dataset to see return, close range, volume, gap, and sampling stats.</small>
      </div>
    `;
    return;
  }
  const price = detail.price_stats || {};
  const returns = detail.return_stats || {};
  const volume = detail.volume_stats || {};
  const ohlc = detail.ohlc_stats || {};
  const coverage = detail.coverage || {};
  const viewer = detail.viewer || {};
  const previewReturn = previewCloseReturn(detail.preview || []);
  const totalReturn = finiteNumber(price.total_return_pct) ?? previewReturn;
  const missingIntervals = finiteNumber(coverage.estimated_missing_intervals) || 0;
  const largestGap = finiteNumber(coverage.largest_gap_seconds);
  const filteredRows = finiteNumber(viewer.filtered_rows) || 0;
  const plottedRows = finiteNumber(viewer.sampled_points) || 0;
  const omittedRows = finiteNumber(viewer.points_omitted) || 0;
  const viewerStatus = text(viewer.status || (viewer.sampled ? "sampled" : "full"));
  const cards = [
    {
      label: "Return",
      title: pctText(totalReturn),
      note: `Selected/viewed range ${timeRangeLabel(viewer.first_timestamp, viewer.last_timestamp, timezoneMode)}.`,
      status: totalReturn === null ? "unknown" : totalReturn >= 0 ? "ok" : "bad",
    },
    {
      label: "Close Range",
      title: `${numberText(price.min_close)} -> ${numberText(price.max_close)}`,
      note: `Start close ${numberText(price.start_close)} / end close ${numberText(price.end_close)}.`,
      status: finiteNumber(price.min_close) === null || finiteNumber(price.max_close) === null ? "unknown" : "ok",
    },
    {
      label: "OHLC Span",
      title: ohlc.available ? pctText(ohlc.high_low_range_pct) : "Close Only",
      note: ohlc.available
        ? `High ${numberText(ohlc.range_high)} / low ${numberText(ohlc.range_low)} across ${numberText(ohlc.candle_count, 0)} candles.`
        : `Missing ${((ohlc.missing_columns || []).join(", ") || "OHLC")} columns; candles fall back to close-line context.`,
      status: ohlc.available ? "ok" : "warn",
    },
    {
      label: "Candle Bias",
      title: ohlc.available ? `${numberText(ohlc.up_candles, 0)} up / ${numberText(ohlc.down_candles, 0)} down` : "n/a",
      note: ohlc.available
        ? `${numberText(ohlc.flat_candles, 0)} flat; open-to-close ${pctText(ohlc.open_to_close_pct)} / up share ${pctText(ohlc.up_candle_pct)}.`
        : "Open/high/low columns are needed for candle direction and range context.",
      status: ohlc.available ? "ok" : "warn",
    },
    {
      label: "Bar Movement",
      title: pctText(returns.mean_abs_pct),
      note: `Std ${pctText(returns.std_pct)} across available bar returns.`,
      status: finiteNumber(returns.mean_abs_pct) === null ? "unknown" : "ok",
    },
    {
      label: "Volume",
      title: numberText(volume.median, 0),
      note: `Median volume; max ${numberText(volume.max, 0)}.`,
      status: finiteNumber(volume.median) === null ? "unknown" : "ok",
    },
    {
      label: "Gaps",
      title: missingIntervals ? `${numberText(missingIntervals, 0)} missing` : "No Missing",
      note: `Largest gap ${interval(largestGap)}.`,
      status: missingIntervals ? "warn" : "ok",
    },
    {
      label: "Viewer",
      title: viewer.sampled ? "Sampled" : viewerStatus === "empty_range" ? "Empty" : "Full",
      note: `${numberText(plottedRows, 0)} plotted / ${numberText(filteredRows, 0)} rows${omittedRows ? ` / ${numberText(omittedRows, 0)} omitted` : ""}.`,
      status: viewerStatus === "empty_range" || viewerStatus === "unavailable" ? "bad" : viewer.sampled ? "warn" : "ok",
    },
  ];
  container.innerHTML = cards.map((card) => `
    <div class="data-range-stat status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${statusClass(card.status)}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function dataDetailNavigationModel(detail = {}) {
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const path = String(detail.path || state.dataDetailPath || "");
  const filteredRows = filteredDataCatalog(datasets).filter((dataset) => dataset.path);
  let rows = filteredRows;
  let scope = "current filters";
  let index = path ? rows.findIndex((dataset) => String(dataset.path || "") === path) : -1;
  if (path && index < 0) {
    rows = sortDataCatalogRows(datasets, dataCatalogFilters().sort).filter((dataset) => dataset.path);
    scope = "all catalog files";
    index = rows.findIndex((dataset) => String(dataset.path || "") === path);
  }
  return {
    rows,
    scope,
    index,
    current: index >= 0 ? rows[index] : null,
    previous: index > 0 ? rows[index - 1] : null,
    next: index >= 0 && index < rows.length - 1 ? rows[index + 1] : null,
  };
}

function renderDataDetailNavigator(detail = {}) {
  if (!$("data-detail-prev") || !$("data-detail-next") || !$("data-detail-nav-note")) return;
  const model = dataDetailNavigationModel(detail);
  $("data-detail-prev").disabled = !model.previous;
  $("data-detail-next").disabled = !model.next;
  $("data-detail-prev").dataset.path = model.previous ? text(model.previous.path) : "";
  $("data-detail-next").dataset.path = model.next ? text(model.next.path) : "";
  if (!model.rows.length) {
    $("data-detail-nav-note").textContent = "No catalog files are available for previous/next navigation.";
  } else if (model.index >= 0) {
    $("data-detail-nav-note").textContent = `File ${numberText(model.index + 1, 0)} of ${numberText(model.rows.length, 0)} in ${model.scope}.`;
  } else {
    $("data-detail-nav-note").textContent = `${numberText(model.rows.length, 0)} catalog file${model.rows.length === 1 ? "" : "s"} available; open one to browse adjacent files.`;
  }
}

async function openAdjacentDataDetail(direction) {
  const model = dataDetailNavigationModel(state.dataDetail || {});
  const target = direction < 0 ? model.previous : model.next;
  if (!target || !target.path) {
    $("data-detail-nav-note").textContent = direction < 0 ? "No previous catalog file in this browse set." : "No next catalog file in this browse set.";
    return;
  }
  await loadDataDetail(target.path, { resetControls: true });
  $("data-detail-nav-note").textContent = `Opened ${text(target.symbol)} ${text(target.bar_size)} from ${text(target.source)}.`;
}

function dateInputValueFromTimestamp(value) {
  const millis = timestampMillis(value);
  return millis === null ? "" : new Date(millis).toISOString().slice(0, 10);
}

function dataDetailWorkbenchDateRange(detail) {
  const coverage = (detail && detail.coverage) || {};
  const viewer = (detail && detail.viewer) || {};
  return {
    start: $("data-detail-start").value || dateInputValueFromTimestamp(viewer.first_timestamp || coverage.first_timestamp),
    end: $("data-detail-end").value || dateInputValueFromTimestamp(viewer.last_timestamp || coverage.last_timestamp),
  };
}

function useDataDetailInWorkbench() {
  const detail = state.dataDetail || {};
  const path = detail.path || state.dataDetailPath;
  if (!path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Open a saved dataset first</span>`;
    return;
  }
  const datasetSelect = $("config-dataset");
  if (!datasetSelect) return;
  let found = false;
  for (const option of datasetSelect.options) {
    option.selected = option.value === path;
    if (option.value === path) found = true;
  }
  if (!found) {
    const label = `${text(detail.symbol)} ${text(detail.bar_size)} [${text((detail.quality || {}).quality_status || "unknown")}] - ${path}`;
    const option = document.createElement("option");
    option.value = path;
    option.textContent = label;
    option.selected = true;
    datasetSelect.appendChild(option);
  }
  const range = dataDetailWorkbenchDateRange(detail);
  if ($("config-start-date")) $("config-start-date").value = range.start;
  if ($("config-end-date")) $("config-end-date").value = range.end;
  renderConfigLivePanels();
  navigateToWorkbenchLens("builder");
  window.setTimeout(() => {
    const target = $("config-form");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 50);
  $("last-refresh").textContent = `Selected ${text(detail.symbol || path)} for Workbench simulation`;
}

function renderDataDetailAssistant(detail = {}, timezoneMode = "utc") {
  if (!$("data-detail-assistant-title") || !$("data-detail-assistant-cards") || !$("data-detail-assistant-actions")) return;
  const path = detail && detail.path;
  if (!path) {
    $("data-detail-assistant-title").textContent = "Open a saved file";
    $("data-detail-assistant-note").textContent = "Use Jump to Symbol, Symbol Browser, or a catalog row to inspect saved history before simulating.";
    $("data-detail-assistant-cards").innerHTML = [
      {
        status: "bad",
        title: "No File",
        label: "Readiness",
        note: "No saved dataset is loaded.",
      },
      {
        status: "warn",
        title: "Pick Symbol",
        label: "Next Action",
        note: "Open the best scanned file or inspect a specific catalog row.",
      },
    ].map((card) => `
      <div class="action-card status-${escapeHtml(card.status)}">
        <span>${statusText(card.status)}</span>
        <strong>${escapeHtml(card.title)}</strong>
        <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
      </div>
    `).join("");
    $("data-detail-assistant-actions").innerHTML = dataDetailAssistantActionsHtml([
      {
        action: "workbench",
        status: "bad",
        title: "Use In Workbench",
        note: "Disabled until a saved file is open.",
        disabled: true,
      },
      {
        action: "compare",
        status: "bad",
        title: "Compare Symbol",
        note: "Disabled until an opened file has a catalog symbol.",
        disabled: true,
      },
    ]);
    return;
  }
  const coverage = detail.coverage || {};
  const quality = detail.quality || {};
  const viewer = detail.viewer || {};
  const qualityStatus = text(quality.quality_status || "unknown");
  const contractStatus = text(detail.storage_contract_status || "unknown");
  const contractWarnings = Array.isArray(detail.storage_contract_warnings) ? detail.storage_contract_warnings : [];
  const warnings = Array.isArray(quality.quality_warnings) ? quality.quality_warnings : [];
  const nullCounts = quality.null_counts || {};
  const nullRows = Object.values(nullCounts).reduce((total, value) => total + (Number(value) || 0), 0);
  const duplicateRows = finiteNumber(coverage.duplicate_timestamps) || 0;
  const missingIntervals = finiteNumber(coverage.estimated_missing_intervals) || 0;
  const largestGap = largestDataDetailGap(detail);
  const rows = finiteNumber(detail.rows) ?? finiteNumber(viewer.available_rows) ?? 0;
  const viewerStatus = text(viewer.status || (viewer.sampled ? "sampled" : "full"));
  const blocked = qualityStatus === "bad" || contractStatus === "bad" || duplicateRows > 0 || rows <= 1 || viewerStatus === "unavailable";
  const needsReview = !blocked && (
    qualityStatus === "warn" ||
    contractStatus === "warn" ||
    warnings.length > 0 ||
    contractWarnings.length > 0 ||
    nullRows > 0 ||
    missingIntervals > 0 ||
    viewerStatus === "empty_range"
  );
  const readinessStatus = blocked ? "bad" : needsReview ? "warn" : "ok";
  const readinessTitle = blocked ? "Blocked" : needsReview ? "Review" : "Ready";
  const readinessNote = blocked
    ? "Fix bad quality, metadata blockers, duplicates, unavailable rows, or a one-row file before replay."
    : needsReview
      ? "Replay is possible, but inspect gaps, nulls, metadata warnings, or the selected chart range first."
      : "No obvious replay blockers were found in this saved file.";
  const matchingFiles = (state.dataCatalog.datasets || [])
    .filter((dataset) => text(dataset.symbol).toUpperCase() === text(detail.symbol).toUpperCase() && dataset.path);
  const gapTitle = largestGap
    ? `${interval(largestGap.gap_seconds)} gap`
    : missingIntervals
      ? `${numberText(missingIntervals, 0)} missing`
      : "No Gaps";
  const cards = [
    {
      status: readinessStatus,
      title: readinessTitle,
      label: "Simulation",
      note: readinessNote,
    },
    {
      status: rows > 1 ? "ok" : "bad",
      title: numberText(rows, 0),
      label: "Rows",
      note: timeRangeLabel(coverage.first_timestamp || viewer.first_timestamp, coverage.last_timestamp || viewer.last_timestamp, timezoneMode),
    },
    {
      status: largestGap || missingIntervals ? "warn" : "ok",
      title: gapTitle,
      label: "Gaps",
      note: missingIntervals
        ? `${numberText(missingIntervals, 0)} estimated missing interval${missingIntervals === 1 ? "" : "s"}.`
        : "No estimated missing intervals in this detail response.",
    },
    {
      status: duplicateRows > 0 ? "bad" : nullRows > 0 ? "warn" : "ok",
      title: `${numberText(duplicateRows, 0)} dup / ${numberText(nullRows, 0)} null`,
      label: "Integrity",
      note: warnings.length ? warnings.slice(0, 2).join("; ") : "No quality warnings reported.",
    },
    {
      status: contractStatus === "bad" ? "bad" : contractStatus === "warn" ? "warn" : "ok",
      title: contractStatus,
      label: "Storage Contract",
      note: contractWarnings.length ? contractWarnings.slice(0, 2).join("; ") : "Metadata checks passed.",
    },
    {
      status: viewerStatus === "empty_range" || viewerStatus === "unavailable" ? "bad" : viewer.sampled ? "warn" : "ok",
      title: viewer.sampled ? "Sampled" : viewerStatus === "empty_range" ? "Empty" : "Full",
      label: "Chart",
      note: `${numberText(viewer.sampled_points, 0)} plotted / ${numberText(viewer.filtered_rows, 0)} filtered rows.`,
    },
  ];
  const bestAction = blocked
    ? "Clean or refetch before using this file in a replay."
    : needsReview
      ? largestGap
        ? "Focus the largest gap, then decide whether this range is acceptable."
        : "Review quality and metadata tables before sending the file to Workbench."
      : "Use this file in Workbench or compare sibling files for the same symbol.";
  $("data-detail-assistant-title").textContent = `${text(detail.symbol)} ${text(detail.bar_size)} ${readinessTitle}`;
  $("data-detail-assistant-note").textContent = `${text(detail.source)} / ${text(detail.storage_session)} - ${bestAction}`;
  $("data-detail-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-detail-assistant-actions").innerHTML = dataDetailAssistantActionsHtml([
    {
      action: "workbench",
      status: blocked || contractStatus !== "ok" ? "warn" : "ok",
      title: "Use In Workbench",
      note: blocked
        ? "Still selectable, but quality or metadata blockers should be fixed first."
        : contractStatus !== "ok" ? "Selectable after metadata review." : "Select this file and range in the Config Builder.",
      disabled: false,
    },
    {
      action: "gap",
      status: largestGap ? "warn" : "ok",
      title: "Focus Largest Gap",
      note: largestGap ? `Zoom to ${interval(largestGap.gap_seconds)} missing-data region.` : "No returned gap is available to focus.",
      disabled: !largestGap,
    },
    {
      action: "export-range",
      status: "ok",
      title: "Export Range CSV",
      note: "Download the current date range with normalized timestamps.",
      disabled: false,
    },
    {
      action: "compare",
      status: matchingFiles.length >= 2 ? "ok" : "warn",
      title: "Compare Symbol Files",
      note: matchingFiles.length >= 2
        ? `Load up to ${numberText(Math.min(matchingFiles.length, MAX_DATA_COMPARE_DATASETS), 0)} ${text(detail.symbol)} files in Compare.`
        : "Need at least two catalog files for this symbol.",
      disabled: matchingFiles.length < 2,
    },
  ]);
}

function dataDetailAssistantActionsHtml(actions = []) {
  return actions.map((item) => `
    <button class="data-detail-assistant-action status-${escapeHtml(item.status)}" data-data-detail-assistant-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

async function handleDataDetailAssistantAction(action) {
  const detail = state.dataDetail || {};
  if (action === "workbench") {
    useDataDetailInWorkbench();
    return;
  }
  if (action === "gap") {
    await focusDataDetailLargestGap();
    return;
  }
  if (action === "export-range") {
    await downloadDataDetailRangeCsv();
    return;
  }
  if (action === "compare") {
    const symbol = text(detail.symbol).toUpperCase();
    if (!symbol || symbol === "N/A") {
      $("data-detail-assistant-note").innerHTML = `<span class="status-bad">Opened file does not have a comparable symbol</span>`;
      return;
    }
    $("data-symbol-browser-input").value = symbol;
    renderSymbolBrowser();
    await compareSelectedSymbolDatasets();
    navigateToDataLens("compare");
  }
}

function renderDataDetailOverview(detail, timezoneMode = "utc") {
  if (!$("data-detail-overview") || !$("data-detail-overview-note")) return;
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const symbolCount = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a")).size;
  const qualityCounts = datasets.reduce((counts, dataset) => {
    const key = text(dataset.quality_status || "unknown");
    counts[key] = (counts[key] || 0) + 1;
    return counts;
  }, {});
  const contractCounts = countBy(datasets, "storage_contract_status");
  const detailPath = detail && detail.path;
  const viewer = (detail && detail.viewer) || {};
  const quality = (detail && detail.quality) || {};
  const contractStatus = text((detail && detail.storage_contract_status) || "unknown");
  const contractWarnings = Array.isArray(detail && detail.storage_contract_warnings) ? detail.storage_contract_warnings : [];
  const selectedSymbol = detailPath
    ? text(detail.symbol)
    : (($("data-detail-symbol") && $("data-detail-symbol").value.trim()) || "");
  const matchingSymbolFiles = selectedSymbol
    ? datasets.filter((dataset) => text(dataset.symbol).toUpperCase() === selectedSymbol.toUpperCase())
    : [];
  const viewerStatus = text(viewer.status || (viewer.sampled ? "sampled" : detailPath ? "full" : "waiting"));
  const catalogContractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  const catalogStatus = datasets.length ? (qualityCounts.bad || contractCounts.bad ? "warn" : "ok") : "bad";
  const openedQualityStatus = text(quality.quality_status || "ok");
  const openedStatus = detailPath
    ? openedQualityStatus === "bad" || contractStatus === "bad"
      ? "bad"
      : openedQualityStatus === "warn" || contractStatus === "warn"
        ? "warn"
        : "ok"
    : datasets.length ? "warn" : "bad";
  const openedContractStatus = detailPath
    ? contractStatus === "bad" ? "bad" : contractStatus === "warn" ? "warn" : "ok"
    : datasets.length ? "warn" : "bad";
  const chartStatus = !detailPath
    ? "bad"
    : viewerStatus === "empty_range" || viewerStatus === "unavailable"
      ? "bad"
      : viewer.sampled
        ? "warn"
        : "ok";
  let nextStatus = "bad";
  let nextTitle = "Scan Data";
  let nextNote = "Configure data roots or refresh the catalog so saved files appear here.";
  if (datasets.length && !detailPath) {
    nextStatus = "warn";
    nextTitle = "Open File";
    nextNote = selectedSymbol
      ? `Open the best ${selectedSymbol} file or choose one from the catalog table.`
      : "Enter a symbol or click Preview/Open from the catalog table.";
  } else if (detailPath && chartStatus === "bad") {
    nextStatus = "bad";
    nextTitle = "Adjust Range";
    nextNote = "The current viewer range has no plotted rows; widen the date range or use sampled mode.";
  } else if (detailPath && text(quality.quality_status) !== "ok") {
    nextStatus = "warn";
    nextTitle = "Review Quality";
    nextNote = "Inspect gaps, missing intervals, nulls, and duplicate timestamps before replaying this file.";
  } else if (detailPath && contractStatus !== "ok") {
    nextStatus = contractStatus === "bad" ? "bad" : "warn";
    nextTitle = "Review Metadata";
    nextNote = contractWarnings.length ? contractWarnings.slice(0, 2).join("; ") : "Review storage-contract metadata before replaying this file.";
  } else if (detailPath) {
    nextStatus = "ok";
    nextTitle = "Use In Workbench";
    nextNote = "Copy the replay starter or select this saved file in the Workbench Config Builder.";
  }
  const cards = [
    {
      status: catalogStatus,
      title: numberText(datasets.length, 0),
      label: "Catalog Files",
      note: `${numberText(symbolCount, 0)} symbols; quality ${countSummary(qualityCounts) || "n/a"} / contract ${countSummary(contractCounts) || "n/a"}.`,
    },
    {
      status: selectedSymbol ? matchingSymbolFiles.length ? "ok" : "warn" : datasets.length ? "warn" : "bad",
      title: selectedSymbol || "No Symbol",
      label: "Symbol",
      note: selectedSymbol
        ? `${numberText(matchingSymbolFiles.length, 0)} scanned file${matchingSymbolFiles.length === 1 ? "" : "s"} match this symbol.`
        : "Enter a symbol or use the Symbol Directory.",
    },
    {
      status: openedStatus,
      title: detailPath ? text(detail.bar_size) : "None",
      label: "Opened File",
      note: detailPath
        ? `${text(detail.source)} / ${text(detail.storage_session)} / ${openedQualityStatus}.`
        : "No saved file is loaded in Data Detail yet.",
    },
    {
      status: openedContractStatus,
      title: detailPath ? contractStatus : "None",
      label: "Storage Contract",
      note: detailPath
        ? contractWarnings.length ? contractWarnings.slice(0, 2).join("; ") : `${bytes(detail.size_bytes)}; metadata checks passed.`
        : catalogContractIssues
          ? `${numberText(catalogContractIssues, 0)} catalog file${catalogContractIssues === 1 ? "" : "s"} need metadata review.`
          : "Open a saved file to inspect its storage metadata.",
    },
    {
      status: chartStatus,
      title: detailPath ? (viewer.sampled ? "Sampled" : "Full") : "No Chart",
      label: "Chart",
      note: detailPath
        ? `${numberText(viewer.sampled_points, 0)} plotted / ${numberText(viewer.filtered_rows, 0)} in range using ${timezoneLabel(timezoneMode)}.`
        : "Open a file to render a saved-history chart.",
    },
    {
      status: detailPath ? "ok" : "bad",
      title: detailPath ? "Available" : "Disabled",
      label: "Actions",
      note: detailPath
        ? "Copy path, data-root flag, replay starter, send to Workbench, or export missing intervals."
        : "Actions enable after a saved file is opened.",
    },
    {
      status: nextStatus,
      title: nextTitle,
      label: "Next Action",
      note: nextNote,
    },
  ];
  $("data-detail-overview-note").textContent = detailPath
    ? `${text(detail.symbol)} ${text(detail.bar_size)} from ${text(detail.source)}; ${numberText(viewer.sampled_points, 0)} plotted`
    : `${numberText(datasets.length, 0)} catalog files / ${numberText(symbolCount, 0)} symbols available`;
  $("data-detail-overview").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function dataDetailHealthCards(detail, timezoneMode = "utc") {
  if (!detail || !detail.path) {
    return `<div class="health-card empty-card"><span>${statusText("waiting")}</span><strong>Select Data</strong><small>Choose a saved dataset to see replay-readiness checks.</small></div>`;
  }
  const coverage = detail.coverage || {};
  const quality = detail.quality || {};
  const viewer = detail.viewer || {};
  const warnings = quality.quality_warnings || [];
  const nullCounts = quality.null_counts || {};
  const nullRows = Object.values(nullCounts).reduce((total, value) => total + (Number(value) || 0), 0);
  const duplicateRows = Number(coverage.duplicate_timestamps || 0);
  const missingIntervals = Number(coverage.estimated_missing_intervals || 0);
  const largestGap = Number(coverage.largest_gap_seconds);
  const qualityStatus = text(quality.quality_status || "unknown");
  const contractStatus = text(detail.storage_contract_status || "unknown");
  const contractWarnings = Array.isArray(detail.storage_contract_warnings) ? detail.storage_contract_warnings : [];
  const viewerStatus = text(viewer.status || (viewer.sampled ? "sampled" : "full"));
  const viewerCardStatus = viewerStatus === "unavailable" || viewerStatus === "empty_range"
    ? "bad"
    : viewerStatus === "sampled"
      ? "warn"
      : "ok";
  const viewerTitle = viewerStatus === "sampled"
    ? `${numberText(viewer.sampled_points, 0)} sampled`
    : viewerStatus === "empty_range"
      ? "Empty Range"
      : viewerStatus === "unavailable"
        ? "Unavailable"
        : `${numberText(viewer.sampled_points, 0)} full`;
  const viewerNote = viewerStatus === "sampled"
    ? `${numberText(viewer.points_omitted, 0)} rows omitted from ${numberText(viewer.filtered_rows, 0)} filtered rows.`
    : `${text(viewer.status_reason || "All filtered rows are plotted.")} ${numberText(viewer.filtered_rows, 0)} filtered / ${numberText(viewer.available_rows, 0)} available.`;
  const replayStatus = qualityStatus === "bad" || contractStatus === "bad" || duplicateRows > 0
    ? "bad"
    : qualityStatus === "warn" || contractStatus === "warn" || warnings.length || contractWarnings.length || nullRows > 0 || missingIntervals > 0
      ? "warn"
      : "ok";
  const replayNote = replayStatus === "ok"
    ? "No obvious quality or metadata blockers in this bounded detail view."
    : replayStatus === "warn"
      ? "Review warnings, metadata, or gaps before using this range in a replay."
      : "Fix bad quality, metadata, or duplicate timestamps before replaying this file.";
  const gapStatus = missingIntervals > 0 ? "warn" : Number.isFinite(largestGap) && largestGap > 0 ? "ok" : "ok";
  const integrityStatus = duplicateRows > 0 ? "bad" : nullRows > 0 ? "warn" : "ok";
  const cards = [
    {
      status: qualityStatus,
      title: text(quality.quality_status || "unknown"),
      label: "Quality",
      note: warnings.length ? warnings.slice(0, 2).join("; ") : "No quality warnings reported.",
    },
    {
      status: gapStatus,
      title: `${numberText(missingIntervals, 0)} missing`,
      label: "Gaps",
      note: `Largest ${interval(coverage.largest_gap_seconds)} across ${timeRangeLabel(viewer.first_timestamp, viewer.last_timestamp, timezoneMode)}.`,
    },
    {
      status: integrityStatus,
      title: `${numberText(duplicateRows, 0)} dup / ${numberText(nullRows, 0)} null`,
      label: "Integrity",
      note: "Duplicate timestamps are blockers; nulls require review.",
    },
    {
      status: contractStatus === "bad" ? "bad" : contractStatus === "warn" ? "warn" : "ok",
      title: contractStatus,
      label: "Storage Contract",
      note: contractWarnings.length ? contractWarnings.slice(0, 2).join("; ") : "Metadata checks passed.",
    },
    {
      status: viewerCardStatus,
      title: viewerTitle,
      label: "Viewer",
      note: viewerNote,
    },
    {
      status: replayStatus,
      title: replayStatus === "ok" ? "Ready" : replayStatus === "warn" ? "Review" : "Blocked",
      label: "Replay Readiness",
      note: replayNote,
    },
  ];
  return cards.map((card) => `
    <div class="health-card data-health-card">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderDataCompareControls() {
  const select = $("data-compare-datasets");
  const previousSelection = new Set(
    state.dataCompareSelectedPaths.length
      ? state.dataCompareSelectedPaths
      : Array.from(select.selectedOptions).map((option) => option.value)
  );
  const filter = ($("data-compare-filter").value || "").trim().toLowerCase();
  const facets = {
    asset: $("data-compare-asset").value || "",
    source: $("data-compare-source").value || "",
    bar: $("data-compare-bar").value || "",
    session: $("data-compare-session").value || "",
    quality: $("data-compare-quality").value || "",
    contract: $("data-compare-contract").value || "",
  };
  const allDatasets = state.dataCatalog.datasets || [];
  renderDataCompareFilterOptions(allDatasets);
  const visibleDatasets = allDatasets.filter((dataset) => {
    if (previousSelection.has(dataset.path)) return true;
    if (facets.asset && text(dataset.asset_class) !== facets.asset) return false;
    if (facets.source && text(dataset.source) !== facets.source) return false;
    if (facets.bar && text(dataset.bar_size) !== facets.bar) return false;
    if (facets.session && text(dataset.storage_session) !== facets.session) return false;
    if (facets.quality && text(dataset.quality_status) !== facets.quality) return false;
    if (facets.contract && text(dataset.storage_contract_status) !== facets.contract) return false;
    if (!filter) return true;
    const haystack = [
      dataset.symbol,
      dataset.asset_class,
      dataset.source,
      dataset.bar_size,
      dataset.storage_session,
      dataset.quality_status,
      dataset.storage_contract_status,
      dataset.storage_contract_label,
      dataset.path,
    ].map(text).join(" ").toLowerCase();
    return haystack.includes(filter);
  });
  const datasets = visibleDatasets.map((dataset) => ({
    value: dataset.path,
    label: `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`,
  }));
  replaceOptions(select, datasets);
  for (const option of select.options) {
    option.selected = previousSelection.has(option.value);
  }
  if (!previousSelection.size && !state.dataCompareSelectionCleared && datasets.length >= 2) {
    for (const option of select.options) option.selected = false;
    select.options[0].selected = true;
    select.options[1].selected = true;
  }
  updateCompareSelectionFromSelect();
  const selectedCount = state.dataCompareSelectedPaths.length;
  if ($("use-data-compare-workbench")) $("use-data-compare-workbench").disabled = selectedCount === 0;
  const activeFilters = [
    filter ? `"${filter}"` : "",
    facets.asset,
    facets.source,
    facets.bar,
    facets.session,
    facets.quality,
    facets.contract,
  ].filter(Boolean);
  $("data-compare-filter-note").textContent = activeFilters.length
    ? `${numberText(visibleDatasets.length, 0)} shown / ${numberText(allDatasets.length, 0)} total matching ${activeFilters.join(", ")}; ${numberText(selectedCount, 0)} selected, max ${MAX_DATA_COMPARE_DATASETS}`
    : `${numberText(allDatasets.length, 0)} catalog datasets; ${numberText(selectedCount, 0)} selected, max ${MAX_DATA_COMPARE_DATASETS}`;
  renderDataCompareAssistant(state.dataCompare || {}, $("data-compare-timezone").value || "utc");
}

function renderDataCompareFilterOptions(datasets) {
  const makeOptions = (id, values) => {
    const select = $(id);
    if (!select) return;
    const current = select.value;
    const options = Array.from(new Set((values || []).map(text).filter((item) => item !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) select.value = current;
  };
  makeOptions("data-compare-asset", datasets.map((item) => item.asset_class));
  makeOptions("data-compare-source", datasets.map((item) => item.source));
  makeOptions("data-compare-bar", datasets.map((item) => item.bar_size));
  makeOptions("data-compare-session", datasets.map((item) => item.storage_session));
  makeOptions("data-compare-quality", datasets.map((item) => item.quality_status));
  makeOptions("data-compare-contract", datasets.map((item) => item.storage_contract_status));
}

function selectShownCompareDatasets() {
  const select = $("data-compare-datasets");
  const paths = Array.from(select.options).map((option) => option.value).slice(0, MAX_DATA_COMPARE_DATASETS);
  state.dataCompareSelectedPaths = paths;
  state.dataCompareSelectionCleared = paths.length === 0;
  state.dataCompare = {};
  for (const option of select.options) {
    option.selected = paths.includes(option.value);
  }
  renderDataCompareControls();
  renderDataCompare();
  $("data-compare-range-preset").value = "custom";
  $("last-refresh").textContent = paths.length
    ? `Selected ${numberText(paths.length, 0)} shown dataset${paths.length === 1 ? "" : "s"} for comparison`
    : "No shown datasets to select";
}

function selectSymbolCompareDatasets() {
  const symbol = ($("data-compare-filter").value || "").trim().toUpperCase();
  if (!symbol) {
    $("last-refresh").textContent = "Enter a symbol in Find Dataset before selecting symbol matches";
    return;
  }
  const matches = (state.dataCatalog.datasets || [])
    .filter((dataset) => text(dataset.symbol).toUpperCase() === symbol)
    .slice(0, MAX_DATA_COMPARE_DATASETS);
  if (!matches.length) {
    $("last-refresh").textContent = `No exact catalog symbol matches for ${symbol}`;
    return;
  }
  state.dataCompareSelectedPaths = matches.map((dataset) => dataset.path);
  state.dataCompareSelectionCleared = false;
  state.dataCompare = {};
  $("data-compare-filter").value = symbol;
  renderDataCompareControls();
  renderDataCompare();
  $("data-compare-range-preset").value = "custom";
  $("last-refresh").textContent = `Selected ${numberText(matches.length, 0)} ${symbol} dataset${matches.length === 1 ? "" : "s"} for comparison`;
}

function clearCompareSelection() {
  state.dataCompareSelectedPaths = [];
  state.dataCompareSelectionCleared = true;
  state.dataCompare = {};
  $("data-compare-filter").value = "";
  $("data-compare-asset").value = "";
  $("data-compare-source").value = "";
  $("data-compare-bar").value = "";
  $("data-compare-session").value = "";
  $("data-compare-quality").value = "";
  $("data-compare-contract").value = "";
  $("data-compare-range-preset").value = "custom";
  for (const option of $("data-compare-datasets").options) {
    option.selected = false;
  }
  renderDataCompareControls();
  renderDataCompare();
  $("last-refresh").textContent = "Compare selection cleared";
}

function useDataCompareInWorkbench() {
  const selected = selectedCompareDatasets();
  if (!selected.length) {
    $("data-compare-note").innerHTML = `<span class="status-bad">Select at least one saved dataset before sending to Workbench</span>`;
    return;
  }
  const datasetSelect = $("config-dataset");
  if (!datasetSelect) return;
  const selectedPaths = new Set(selected.map((dataset) => dataset.path));
  for (const option of datasetSelect.options) {
    option.selected = selectedPaths.has(option.value);
  }
  for (const dataset of selected) {
    if (Array.from(datasetSelect.options).some((option) => option.value === dataset.path)) continue;
    const option = document.createElement("option");
    option.value = dataset.path;
    option.textContent = `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`;
    option.selected = true;
    datasetSelect.appendChild(option);
  }
  if ($("config-start-date")) $("config-start-date").value = $("data-compare-start").value || "";
  if ($("config-end-date")) $("config-end-date").value = $("data-compare-end").value || "";
  renderConfigLivePanels();
  navigateToWorkbenchLens("builder");
  window.setTimeout(() => {
    const target = $("workbench-stepper") || $("config-form");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 50);
  $("last-refresh").textContent = `Selected ${numberText(selected.length, 0)} compared dataset${selected.length === 1 ? "" : "s"} for Workbench simulation`;
}

function renderDataCompareAssistant(comparison = {}, timezoneMode = "utc") {
  if (!$("data-compare-assistant-title") || !$("data-compare-assistant-cards") || !$("data-compare-assistant-actions")) return;
  const selected = selectedCompareDatasets();
  const selectedCount = selected.length;
  const bounds = selectedCompareRangeBounds();
  const hasOverlap = bounds.overlapStart !== null && bounds.overlapEnd !== null && bounds.overlapStart <= bounds.overlapEnd;
  const unionRange = bounds.unionStart !== null && bounds.unionEnd !== null
    ? timeRangeLabel(new Date(bounds.unionStart).toISOString(), new Date(bounds.unionEnd).toISOString(), timezoneMode)
    : "n/a";
  const overlapRange = hasOverlap
    ? timeRangeLabel(new Date(bounds.overlapStart).toISOString(), new Date(bounds.overlapEnd).toISOString(), timezoneMode)
    : "No common range";
  const comparisonLoaded = Boolean(comparison && comparison.generated_at);
  const series = comparison.series || [];
  const common = finiteNumber(comparison.common_timestamp_count) || 0;
  const union = finiteNumber(comparison.union_timestamp_count) || 0;
  const overlapPct = union > 0 ? (common / union) * 100 : null;
  const warningCount = finiteNumber(comparison.warning_count) || 0;
  const readyStatus = selectedCount < 2 || !hasOverlap || (comparisonLoaded && common <= 0)
    ? "bad"
    : warningCount > 0 || !comparisonLoaded
      ? "warn"
      : "ok";
  const readyTitle = readyStatus === "ok" ? "Ready" : readyStatus === "warn" ? "Review" : "Blocked";
  const selectedSymbols = Array.from(new Set(selected.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a")));
  const selectedBars = Array.from(new Set(selected.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a")));
  const selectedContractCounts = countBy(selected, "storage_contract_status");
  const selectedContractIssues = Number(selectedContractCounts.bad || 0) + Number(selectedContractCounts.warn || 0);
  const returnRows = series.map((item) => ({
    symbol: text(item.symbol),
    value: finiteNumber(item.total_return_pct),
  })).filter((item) => item.value !== null);
  const leader = returnRows.slice().sort((left, right) => right.value - left.value)[0] || null;
  const laggard = returnRows.slice().sort((left, right) => left.value - right.value)[0] || null;
  const spread = leader && laggard ? leader.value - laggard.value : null;
  let nextAction = "Select at least two saved files to compare.";
  if (selectedCount >= 2 && !hasOverlap) {
    nextAction = "Choose files with overlapping timestamp ranges or widen the selected universe.";
  } else if (selectedCount >= 2 && !comparisonLoaded) {
    nextAction = "Run Compare or apply the common-overlap preset before reading the chart.";
  } else if (comparisonLoaded && common <= 0) {
    nextAction = "Use the overlap preset or choose files that share timestamps.";
  } else if (selectedContractIssues > 0) {
    nextAction = "Review selected file storage metadata before sending the comparison to Workbench.";
  } else if (warningCount > 0) {
    nextAction = "Review comparison warnings before sending selected files to Workbench.";
  } else if (comparisonLoaded) {
    nextAction = "Review leader/laggard behavior, then export or send the selected window to Workbench.";
  }
  $("data-compare-assistant-title").textContent = `${numberText(selectedCount, 0)} selected - ${readyTitle}`;
  $("data-compare-assistant-note").textContent = nextAction;
  const cards = [
    {
      status: selectedCount >= 2 ? "ok" : "bad",
      title: numberText(selectedCount, 0),
      label: "Selected",
      note: selectedSymbols.length
        ? `${selectedSymbols.slice(0, 4).join(", ")}${selectedSymbols.length > 4 ? "..." : ""}; bars ${selectedBars.join(", ") || "n/a"}.`
        : "No saved datasets selected.",
    },
    {
      status: hasOverlap ? "ok" : selectedCount >= 2 ? "bad" : "warn",
      title: hasOverlap ? "Overlap" : "No Overlap",
      label: "Range",
      note: selectedCount >= 2 ? overlapRange : unionRange,
    },
    {
      status: comparisonLoaded ? common > 0 ? "ok" : "bad" : "warn",
      title: comparisonLoaded ? numberText(common, 0) : "Not Run",
      label: "Common Timestamps",
      note: comparisonLoaded
        ? `${overlapPct === null ? "n/a" : pctText(overlapPct)} of ${numberText(union, 0)} union timestamps.`
        : "Run Compare to measure actual normalized overlap.",
    },
    {
      status: selectedContractIssues ? "warn" : selectedCount ? "ok" : "bad",
      title: selectedCount ? countSummary(selectedContractCounts) : "n/a",
      label: "Contract",
      note: selectedContractIssues
        ? "Selected files have storage-contract warnings."
        : selectedCount ? "Selected files satisfy current storage-contract checks." : "No selected files.",
    },
    {
      status: warningCount > 0 ? "warn" : comparisonLoaded ? "ok" : "warn",
      title: comparisonLoaded ? numberText(warningCount, 0) : "n/a",
      label: "Warnings",
      note: warningCount ? (comparison.warnings || []).slice(0, 2).join("; ") : comparisonLoaded ? "No comparison warnings reported." : "Warnings appear after Compare runs.",
    },
    {
      status: spread === null ? comparisonLoaded ? "unknown" : "warn" : Math.abs(spread) > 10 ? "warn" : "ok",
      title: spread === null ? "n/a" : pctText(spread),
      label: "Return Spread",
      note: leader && laggard ? `${leader.symbol} minus ${laggard.symbol}.` : "Need loaded return paths for leader/laggard context.",
    },
  ];
  $("data-compare-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-compare-assistant-actions").innerHTML = dataCompareAssistantActionsHtml([
    {
      action: "compare",
      status: selectedCount >= 2 && hasOverlap ? "ok" : "bad",
      title: "Run Compare",
      note: selectedCount >= 2 ? "Load normalized close-return paths for the selected files." : "Select at least two files first.",
      disabled: selectedCount < 2,
    },
    {
      action: "overlap",
      status: hasOverlap ? "ok" : "bad",
      title: "Use Common Overlap",
      note: hasOverlap ? "Apply the shared timestamp window and reload comparison." : "Selected files do not expose an overlap window.",
      disabled: selectedCount < 2 || !hasOverlap,
    },
    {
      action: "workbench",
      status: selectedCount ? (warningCount || selectedContractIssues) ? "warn" : "ok" : "bad",
      title: "Use In Workbench",
      note: selectedContractIssues
        ? "Send selected datasets only after reviewing storage-contract warnings."
        : selectedCount ? "Send selected datasets and date window to the Config Builder." : "Select at least one saved dataset first.",
      disabled: selectedCount < 1,
    },
    {
      action: "export",
      status: series.length ? "ok" : "warn",
      title: "Export Compare CSV",
      note: series.length ? "Download the loaded normalized comparison paths." : "Run Compare before exporting paths.",
      disabled: !series.length,
    },
    {
      action: "copy-json",
      status: selectedCount >= 2 ? "ok" : "bad",
      title: "Copy Request JSON",
      note: selectedCount >= 2 ? "Copy the exact compare request payload." : "Select at least two files first.",
      disabled: selectedCount < 2,
    },
  ]);
}

function dataCompareAssistantActionsHtml(actions = []) {
  return actions.map((item) => `
    <button class="data-compare-assistant-action status-${escapeHtml(item.status)}" data-data-compare-assistant-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

async function handleDataCompareAssistantAction(action) {
  if (action === "compare") {
    await loadDataCompare();
    return;
  }
  if (action === "overlap") {
    $("data-compare-range-preset").value = "overlap";
    await applyDataCompareRangePreset();
    return;
  }
  if (action === "workbench") {
    useDataCompareInWorkbench();
    return;
  }
  if (action === "export") {
    await downloadDataCompareCsv();
    return;
  }
  if (action === "copy-json") {
    copyDataCompareJson();
  }
}

function renderDataCompare() {
  const comparison = state.dataCompare || {};
  const series = comparison.series || [];
  const timezoneMode = $("data-compare-timezone").value || "utc";
  $("export-data-compare-csv").disabled = !series.length;
  $("data-compare-note").innerHTML = comparison.generated_at
    ? `${escapeHtml(numberText(comparison.dataset_count, 0))} datasets / ${escapeHtml(numberText(comparison.common_timestamp_count, 0))} common timestamps / ${escapeHtml(numberText(comparison.union_timestamp_count, 0))} union timestamps${comparison.warning_count ? ` <span class="status-warn">${escapeHtml((comparison.warnings || []).join("; "))}</span>` : ""}`
    : "Select two or more datasets to compare normalized close paths.";
  renderDataCompareAssistant(comparison, timezoneMode);
  $("data-compare-readiness").innerHTML = dataCompareReadinessCards(comparison, timezoneMode);
  renderDataCompareStats(comparison, timezoneMode);
  $("data-compare-chart").innerHTML = compareChart(series, timezoneMode);
  $("data-compare-body").innerHTML = series.length
    ? series.map((item) => row([
        escapeHtml(item.symbol),
        `${escapeHtml(numberText(item.filtered_rows, 0))} / ${escapeHtml(numberText(item.available_rows, 0))}`,
        escapeHtml(timeRangeLabel(item.first_timestamp, item.last_timestamp, timezoneMode)),
        escapeHtml(numberText(item.first_close)),
        escapeHtml(numberText(item.last_close)),
        signedValueHtml(item.total_return_pct, pctText),
        escapeHtml(`${text(item.source)} ${text(item.bar_size)}`),
        `<span class="mono">${escapeHtml(item.path)}</span>`,
      ])).join("")
    : row([`<span class="muted">No comparison loaded</span>`, "", "", "", "", "", "", ""]);
}

function renderDataCompareStats(comparison = {}, timezoneMode = "utc") {
  const container = $("data-compare-stats");
  if (!container) return;
  const series = comparison.series || [];
  if (!comparison.generated_at || !series.length) {
    container.innerHTML = `
      <div class="data-range-stat">
        <span>Comparison Stats</span>
        <strong>No Comparison</strong>
        <small>Select and compare at least two saved datasets to see leader, laggard, spread, overlap, and sampling stats.</small>
      </div>
    `;
    return;
  }
  const returnRows = series.map((item) => ({
    symbol: text(item.symbol),
    source: `${text(item.source)} ${text(item.bar_size)}`,
    value: finiteNumber(item.total_return_pct),
  })).filter((item) => item.value !== null);
  const leader = returnRows.slice().sort((left, right) => right.value - left.value)[0] || null;
  const laggard = returnRows.slice().sort((left, right) => left.value - right.value)[0] || null;
  const spread = leader && laggard ? leader.value - laggard.value : null;
  const common = finiteNumber(comparison.common_timestamp_count) || 0;
  const union = finiteNumber(comparison.union_timestamp_count) || 0;
  const overlapPct = union > 0 ? (common / union) * 100 : null;
  const warningCount = finiteNumber(comparison.warning_count) || 0;
  const cards = [
    {
      label: "Leader",
      title: leader ? `${leader.symbol} ${pctText(leader.value)}` : "n/a",
      note: leader ? leader.source : "No valid return series in this comparison.",
      status: leader ? leader.value >= 0 ? "ok" : "bad" : "unknown",
    },
    {
      label: "Laggard",
      title: laggard ? `${laggard.symbol} ${pctText(laggard.value)}` : "n/a",
      note: laggard ? laggard.source : "No valid return series in this comparison.",
      status: laggard ? laggard.value >= 0 ? "ok" : "bad" : "unknown",
    },
    {
      label: "Spread",
      title: pctText(spread),
      note: leader && laggard ? `${leader.symbol} minus ${laggard.symbol}.` : "Need at least two return series.",
      status: spread === null ? "unknown" : spread > 10 ? "warn" : "ok",
    },
    {
      label: "Overlap",
      title: overlapPct === null ? "n/a" : pctText(overlapPct),
      note: `${numberText(common, 0)} common / ${numberText(union, 0)} union timestamps.`,
      status: common <= 0 ? "bad" : overlapPct !== null && overlapPct < 50 ? "warn" : "ok",
    },
    {
      label: "Sampling",
      title: text(comparison.sample_mode || "unknown"),
      note: `${numberText(comparison.preview_points, 0)} requested points; range ${timeRangeLabel(comparison.common_first_timestamp, comparison.common_last_timestamp, timezoneMode)}.`,
      status: comparison.sample_mode === "full" ? "ok" : "warn",
    },
    {
      label: "Warnings",
      title: numberText(warningCount, 0),
      note: warningCount ? (comparison.warnings || []).slice(0, 2).join("; ") : "No comparison warnings reported.",
      status: warningCount ? "warn" : "ok",
    },
  ];
  container.innerHTML = cards.map((card) => `
    <div class="data-range-stat status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${statusClass(card.status)}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function dataCompareReadinessCards(comparison, timezoneMode = "utc") {
  const selected = selectedCompareDatasets();
  const contractCounts = countBy(selected, "storage_contract_status");
  const contractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  if (!comparison || !comparison.generated_at) {
    const contractCard = selected.length
      ? `<div class="health-card data-compare-card"><span>${statusText(contractIssues ? "warn" : "ok")}</span><strong>${escapeHtml(countSummary(contractCounts))}</strong><small>Storage Contract - ${escapeHtml(contractIssues ? "Review selected file metadata before replay." : "Selected files pass current metadata checks.")}</small></div>`
      : "";
    return `<div class="health-card empty-card"><span>${statusText("waiting")}</span><strong>Select Datasets</strong><small>Choose at least two saved files to check timestamp overlap.</small></div>${contractCard}`;
  }
  const common = Number(comparison.common_timestamp_count || 0);
  const union = Number(comparison.union_timestamp_count || 0);
  const warningCount = Number(comparison.warning_count || 0);
  const datasetCount = Number(comparison.dataset_count || 0);
  const overlapPct = union > 0 ? (common / union) * 100 : null;
  const readiness = common <= 0
    ? "bad"
    : warningCount > 0 || datasetCount < 2
      ? "warn"
      : "ok";
  const sampleStatus = comparison.sample_mode === "full" ? "ok" : "warn";
  const cards = [
    {
      status: common > 0 ? "ok" : "bad",
      title: numberText(common, 0),
      label: "Common Timestamps",
      note: `${overlapPct === null ? "n/a" : pctText(overlapPct)} of ${numberText(union, 0)} union timestamps.`,
    },
    {
      status: warningCount ? "warn" : "ok",
      title: numberText(warningCount, 0),
      label: "Warnings",
      note: warningCount ? (comparison.warnings || []).slice(0, 2).join("; ") : "No comparison warnings reported.",
    },
    {
      status: sampleStatus,
      title: text(comparison.sample_mode),
      label: "Sampling",
      note: `${numberText(comparison.preview_points, 0)} requested points; chart uses sampled paths unless full mode fits.`,
    },
    {
      status: contractIssues ? "warn" : selected.length ? "ok" : "bad",
      title: selected.length ? countSummary(contractCounts) : "n/a",
      label: "Storage Contract",
      note: contractIssues ? "Review selected file metadata before replay." : "Selected files pass current metadata checks.",
    },
    {
      status: readiness,
      title: readiness === "ok" ? "Ready" : readiness === "warn" ? "Review" : "Blocked",
      label: "Comparison Readiness",
      note: common > 0
        ? `Common range ${timeRangeLabel(comparison.common_first_timestamp, comparison.common_last_timestamp, timezoneMode)}.`
        : "No shared timestamps in the selected range.",
    },
  ];
  return cards.map((card) => `
    <div class="health-card data-compare-card">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderFetchJobs() {
  const payload = state.fetchManifests || {};
  const manifests = payload.manifests || [];
  const filteredManifests = filteredFetchManifests(manifests);
  const roots = payload.roots || [];
  const rootConfigPaths = fetchManifestRootConfigPaths();
  const rowsTotal = manifests.reduce((sum, item) => sum + Number(item.rows || 0), 0);
  renderFetchFilterOptions(manifests);
  $("fetch-jobs-note").textContent = payload.generated_at
    ? `${numberText(filteredManifests.length, 0)} shown / ${numberText(payload.total || manifests.length, 0)} total`
    : "No fetch manifests loaded";
  $("fetch-job-count").textContent = numberText(manifests.length, 0);
  $("fetch-job-status-summary").textContent = countSummary(payload.status_counts);
  $("fetch-job-rows").textContent = numberText(rowsTotal, 0);
  $("fetch-job-kind-summary").textContent = countSummary(payload.kind_counts);
  $("fetch-root-count").textContent = numberText(roots.length, 0);
  $("fetch-root-note").textContent = roots.length
    ? `${numberText(roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0), 0)} manifest files under configured roots`
    : "No fetch manifest roots configured";
  $("copy-fetch-roots-yaml").disabled = !rootConfigPaths.length;
  $("fetch-root-config-note").textContent = rootConfigPaths.length
    ? `${numberText(rootConfigPaths.length, 0)} manifest root${rootConfigPaths.length === 1 ? "" : "s"} ready to copy`
    : "No manifest roots to copy";
  $("fetch-root-cards").innerHTML = roots.length
    ? roots.map((root) => {
        const status = !root.exists ? "bad" : !root.is_dir ? "bad" : Number(root.manifest_count || 0) ? "ok" : "warn";
        return `
          <div class="root-card">
            <span>${statusText(status)}</span>
            <strong>${escapeHtml(numberText(root.manifest_count, 0))} jobs</strong>
            <small class="mono">${escapeHtml(root.display_path || root.path)}</small>
            <small>writable=${escapeHtml(text(root.writable))}</small>
          </div>
        `;
      }).join("")
    : `<div class="root-card"><span class="status-warn">warn</span><strong>No roots</strong><small>Add a fetch manifest root.</small></div>`;
  renderFetchTriageCards({ manifests, filteredManifests, roots, rootConfigPaths, rowsTotal });
  renderFetchWorkflowLauncher({ manifests, filteredManifests, roots, rootConfigPaths, rowsTotal });
  renderFetchJobsGuide({ manifests, filteredManifests, roots, rootConfigPaths });
  renderFetchSearchAssistant(manifests, filteredManifests);
  const errors = payload.errors || [];
  const errorRows = errors.map((item) => row([
    escapeHtml(item.path),
    "",
    statusText("bad"),
    "",
    "",
    "",
    "",
    "",
    "",
    escapeHtml(item.error),
    "",
    "",
    "",
  ]));
  const manifestRows = filteredManifests.map((item) => {
    const symbolSummary = [
      `ok ${numberText(item.success_symbols, 0)}`,
      `empty ${numberText(item.empty_symbols, 0)}`,
      `failed ${numberText(item.failed_symbols, 0)}`,
      `skipped ${numberText(item.skipped_symbols, 0)}`,
    ].join(" / ");
    const chunkSummary = [
      `ok ${numberText(item.success_chunks, 0)}`,
      `empty ${numberText(item.empty_chunks, 0)}`,
      `failed ${numberText(item.failed_chunks, 0)}`,
      item.pending_chunks !== undefined && item.pending_chunks !== null ? `planned ${numberText(item.pending_chunks, 0)}` : "",
    ].filter(Boolean).join(" / ");
    const etaSummary = [
      item.latest_eta_seconds !== undefined && item.latest_eta_seconds !== null ? `eta ${interval(item.latest_eta_seconds)}` : "",
      item.latest_avg_chunk_seconds !== undefined && item.latest_avg_chunk_seconds !== null ? `avg ${interval(item.latest_avg_chunk_seconds)}` : "",
      item.latest_avg_symbol_seconds !== undefined && item.latest_avg_symbol_seconds !== null ? `sym avg ${interval(item.latest_avg_symbol_seconds)}` : "",
      item.latest_completed_symbols !== undefined && item.latest_completed_symbols !== null ? `symbols ${numberText(item.latest_completed_symbols, 0)}/${numberText(item.latest_total_symbols || item.symbols_requested, 0)}` : "",
      item.retry_events ? `retries ${numberText(item.retry_events, 0)}` : "",
      item.pacing_wait_events ? `waits ${numberText(item.pacing_wait_events, 0)}` : "",
    ].filter(Boolean).join(" / ") || "n/a";
    const output = item.latest_output_path || item.out_dir || item.first_output_path || "";
    return row([
      escapeHtml(item.started_at),
      escapeHtml(item.kind),
      statusText(item.status),
      escapeHtml(item.bar_size),
      escapeHtml(rangeLabel(item.range_start, item.range_end || item.duration || item.months)),
      escapeHtml(symbolSummary),
      escapeHtml(chunkSummary),
      escapeHtml(etaSummary),
      escapeHtml(numberText(item.rows, 0)),
      `<span class="${Number(item.errors || 0) ? "status-warn" : "status-ok"}">${escapeHtml(numberText(item.errors, 0))}</span>`,
      fetchOutputVisibilityHtml(item),
      `<span class="mono">${escapeHtml(output)}</span>`,
      `<button type="button" class="secondary inspect-fetch" data-job-id="${escapeHtml(item.job_id)}">Inspect</button>`,
    ]);
  });
  $("fetch-manifests-body").innerHTML = manifestRows.length || errorRows.length
    ? manifestRows.concat(errorRows).join("")
    : row([`<span class="muted">No fetch manifests match the current filters.</span>`, "", "", "", "", "", "", "", "", "", "", "", ""]);
}

function fetchManifestOutputIssueCount(item) {
  return (
    Number(item.output_missing_file_count || 0) +
    Number(item.output_outside_data_roots_count || 0) +
    Number(item.output_no_path_count || 0) +
    Number(item.output_unsupported_file_count || 0)
  );
}

function fetchManifestLabel(item) {
  return text(item.job_id || item.path || "fetch job");
}

function recommendedFetchManifests(filteredManifests = []) {
  return (filteredManifests || [])
    .slice()
    .sort((left, right) => {
      const leftIssue = fetchManifestIssueCount(left) + fetchManifestOutputIssueCount(left);
      const rightIssue = fetchManifestIssueCount(right) + fetchManifestOutputIssueCount(right);
      if (leftIssue !== rightIssue) return rightIssue - leftIssue;
      const activeDelta = Number(!fetchJobTerminal(right.status)) - Number(!fetchJobTerminal(left.status));
      if (activeDelta) return activeDelta;
      const leftTime = timestampMillis(left.finished_at || left.started_at) || 0;
      const rightTime = timestampMillis(right.finished_at || right.started_at) || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return fetchManifestLabel(left).localeCompare(fetchManifestLabel(right));
    })
    .slice(0, 5);
}

function renderFetchSearchAssistant(manifests = [], filteredManifests = []) {
  if (!$("fetch-search-title") || !$("fetch-search-cards") || !$("fetch-search-actions")) return;
  const filters = fetchJobFilters();
  const activeLabels = [
    filters.text ? `search ${filters.text}` : "",
    filters.status ? `status ${filters.status}` : "",
    filters.kind ? `kind ${filters.kind}` : "",
  ].filter(Boolean);
  const hidden = Math.max(0, manifests.length - filteredManifests.length);
  const activeJobs = filteredManifests.filter((item) => !fetchJobTerminal(item.status));
  const reviewJobs = filteredManifests.filter((item) => fetchManifestIssueCount(item) > 0 || fetchManifestOutputIssueCount(item) > 0);
  const visibleOutputs = filteredManifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = filteredManifests.reduce((sum, item) => sum + fetchManifestOutputIssueCount(item), 0);
  const retryEvents = filteredManifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = filteredManifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const statusCounts = countBy(filteredManifests, "status");
  const kindCounts = countBy(filteredManifests, "kind");
  $("fetch-search-title").textContent = manifests.length
    ? activeLabels.length
      ? `${numberText(filteredManifests.length, 0)} matching fetch job${filteredManifests.length === 1 ? "" : "s"}`
      : `${numberText(manifests.length, 0)} searchable fetch job${manifests.length === 1 ? "" : "s"}`
    : "No jobs loaded";
  $("fetch-search-note").textContent = manifests.length
    ? activeLabels.length
      ? `${activeLabels.join(" / ")}. ${numberText(hidden, 0)} job${hidden === 1 ? "" : "s"} hidden by current filters.`
      : "Use the filters to find failed pulls, active manifests, visible outputs, or a specific symbol/path."
    : "Run a fetcher that writes JSON manifests or configure dashboard.fetch_manifest_roots.";
  const cards = [
    {
      label: "Visible Jobs",
      status: filteredManifests.length ? "ok" : manifests.length ? "warn" : "bad",
      title: `${numberText(filteredManifests.length, 0)} / ${numberText(manifests.length, 0)}`,
      note: hidden ? `${numberText(hidden, 0)} hidden by filters.` : "All loaded jobs are visible.",
    },
    {
      label: "Status / Kind",
      status: filteredManifests.length ? "ok" : "warn",
      title: countSummary(statusCounts),
      note: `Kinds: ${countSummary(kindCounts)}.`,
    },
    {
      label: "Recovery Pressure",
      status: reviewJobs.length ? "warn" : filteredManifests.length ? "ok" : "bad",
      title: numberText(reviewJobs.length, 0),
      note: reviewJobs.length
        ? "Open a recommended job to see recovery plan, resume command, and output visibility."
        : filteredManifests.length ? "No matching job has summarized errors or output path issues." : "No matching jobs to review.",
    },
    {
      label: "Output Visibility",
      status: outputIssues ? "warn" : visibleOutputs ? "ok" : filteredManifests.length ? "warn" : "bad",
      title: `${numberText(visibleOutputs, 0)} visible`,
      note: outputIssues ? `${numberText(outputIssues, 0)} output path issue${outputIssues === 1 ? "" : "s"}.` : "Visible outputs can move into Data Library from Fetch Detail.",
    },
    {
      label: "Active / Pace",
      status: activeJobs.length || retryEvents || pacingWaits ? "warn" : filteredManifests.length ? "ok" : "bad",
      title: `${numberText(activeJobs.length, 0)} active`,
      note: `${numberText(retryEvents, 0)} retries / ${numberText(pacingWaits, 0)} pacing waits in matching jobs.`,
    },
  ];
  $("fetch-search-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const recommendations = recommendedFetchManifests(filteredManifests);
  $("fetch-search-actions").innerHTML = recommendations.length
    ? recommendations.map((item) => {
        const issueCount = fetchManifestIssueCount(item) + fetchManifestOutputIssueCount(item);
        const visible = Number(item.output_visible_count || item.visible_output_count || 0);
        const status = issueCount ? "warn" : fetchJobTerminal(item.status) ? "ok" : "warn";
        return `
          <div class="fetch-search-action-card status-${escapeHtml(status)}">
            <div>
              <span>${statusText(status)}</span>
              <strong>${escapeHtml(fetchManifestLabel(item))}</strong>
              <small>${escapeHtml(text(item.kind))} / ${escapeHtml(text(item.status))} / ${escapeHtml(text(item.bar_size))} / ${escapeHtml(rangeLabel(item.range_start, item.range_end || item.duration || item.months))}</small>
              <small>${escapeHtml(numberText(item.rows, 0))} rows / visible outputs ${escapeHtml(numberText(visible, 0))} / issues ${escapeHtml(numberText(issueCount, 0))}</small>
            </div>
            <div>
              <button type="button" data-fetch-search-action="inspect" data-job-id="${escapeHtml(item.job_id)}">Inspect</button>
              <button type="button" class="secondary" data-fetch-search-action="status" data-status="${escapeHtml(text(item.status))}">Status</button>
              <button type="button" class="secondary" data-fetch-search-action="kind" data-kind="${escapeHtml(text(item.kind))}">Kind</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No recommended fetch jobs</strong><span>Clear filters or configure manifest roots to load fetch jobs.</span></div>`;
}

function handleFetchSearchAction(target) {
  const action = String(target.dataset.fetchSearchAction || "");
  if (action === "inspect") {
    loadFetchManifestDetail(target.dataset.jobId || "").catch((err) => {
      $("last-refresh").textContent = `Fetch manifest detail failed: ${err.message}`;
    });
    return;
  }
  if (action === "status") {
    $("fetch-filter-status").value = target.dataset.status || "";
    renderFetchJobs();
    return;
  }
  if (action === "kind") {
    $("fetch-filter-kind").value = target.dataset.kind || "";
    renderFetchJobs();
  }
}

function fetchOutputVisibilityHtml(item) {
  const visible = Number(item.output_visible_count || 0);
  const missing = Number(item.output_missing_file_count || 0);
  const outside = Number(item.output_outside_data_roots_count || 0);
  const noPath = Number(item.output_no_path_count || 0);
  const unsupported = Number(item.output_unsupported_file_count || 0);
  const issueCount = missing + outside + noPath + unsupported;
  const status = issueCount ? "warn" : visible ? "ok" : "unknown";
  const detail = [
    `visible ${numberText(visible, 0)}`,
    missing ? `missing ${numberText(missing, 0)}` : "",
    outside ? `outside ${numberText(outside, 0)}` : "",
    noPath ? `no path ${numberText(noPath, 0)}` : "",
    unsupported ? `unsupported ${numberText(unsupported, 0)}` : "",
  ].filter(Boolean).join(" / ") || "n/a";
  return `<span class="${statusClass(status)}">${escapeHtml(detail)}</span>`;
}

function fetchJobTerminal(status) {
  return ["completed", "failed", "partial", "cancelled", "canceled"].includes(text(status).toLowerCase());
}

function fetchManifestIssueCount(manifest) {
  return [
    manifest.errors,
    manifest.failed_symbols,
    manifest.failed_chunks,
    manifest.output_missing_file_count,
    manifest.output_outside_data_roots_count,
    manifest.output_unsupported_file_count,
  ].reduce((sum, value) => sum + Number(value || 0), 0);
}

function renderFetchTriageCards(context = {}) {
  if (!$("fetch-triage-cards") || !$("fetch-triage-note")) return;
  const manifests = context.manifests || [];
  const filteredManifests = context.filteredManifests || manifests;
  const roots = context.roots || [];
  const rootConfigPaths = context.rootConfigPaths || [];
  const activeJobs = manifests.filter((item) => !fetchJobTerminal(item.status));
  const failedJobs = manifests.filter((item) => fetchManifestIssueCount(item) > 0);
  const retryEvents = manifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const pacingSeconds = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_seconds || 0), 0);
  const outputVisible = manifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = manifests.reduce((sum, item) => (
    sum +
    Number(item.output_missing_file_count || 0) +
    Number(item.output_outside_data_roots_count || 0) +
    Number(item.output_unsupported_file_count || 0)
  ), 0);
  const rootManifestCount = roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0);
  const cards = [
    {
      status: roots.length && rootManifestCount ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      title: roots.length ? `${numberText(rootManifestCount, 0)} files` : "No Roots",
      label: "Manifest Roots",
      note: roots.length
        ? `${numberText(roots.length, 0)} configured root${roots.length === 1 ? "" : "s"} are scanned.`
        : "Add dashboard.fetch_manifest_roots or run a fetcher that writes JSON manifests.",
    },
    {
      status: activeJobs.length ? "warn" : manifests.length ? "ok" : "bad",
      title: numberText(activeJobs.length, 0),
      label: "Active Jobs",
      note: activeJobs.length
        ? "One or more manifests look non-terminal; inspect progress before starting another pull."
        : manifests.length
          ? "No active/non-terminal fetch jobs in the loaded manifest list."
          : "No fetch manifests are loaded.",
    },
    {
      status: failedJobs.length ? "warn" : manifests.length ? "ok" : "bad",
      title: numberText(failedJobs.length, 0),
      label: "Jobs Needing Review",
      note: failedJobs.length
        ? "Filter by errors or inspect a job to copy a resume command and review blockers."
        : manifests.length
          ? "Loaded jobs have no summarized errors, failed symbols, failed chunks, or output visibility issues."
          : "Load manifests before reviewing failures.",
    },
    {
      status: outputIssues ? "warn" : outputVisible ? "ok" : manifests.length ? "warn" : "bad",
      title: `${numberText(outputVisible, 0)} visible`,
      label: "Output Visibility",
      note: outputIssues
        ? `${numberText(outputIssues, 0)} output path issue${outputIssues === 1 ? "" : "s"} need root/path review.`
        : outputVisible
          ? "Visible outputs can be opened from Fetch Detail or filtered in Data Library."
          : "Select a manifest to annotate output paths against configured data roots.",
    },
    {
      status: retryEvents || pacingWaits ? "warn" : manifests.length ? "ok" : "bad",
      title: `${numberText(retryEvents, 0)}R / ${numberText(pacingWaits, 0)}W`,
      label: "Retries / Waits",
      note: pacingWaits
        ? `${interval(pacingSeconds)} of pacing waits recorded across loaded jobs.`
        : retryEvents
          ? "Retry events are present; inspect detail for symbols and attempts."
          : "No retry or pacing events summarized in loaded manifests.",
    },
  ];
  $("fetch-triage-note").textContent = manifests.length
    ? `${numberText(filteredManifests.length, 0)} shown / ${numberText(manifests.length, 0)} loaded; ${numberText(context.rowsTotal || 0, 0)} rows`
    : "No fetch manifests loaded";
  $("fetch-triage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function fetchWorkflowCards(context = {}) {
  const manifests = context.manifests || [];
  const filteredManifests = context.filteredManifests || manifests;
  const roots = context.roots || [];
  const rootConfigPaths = context.rootConfigPaths || [];
  const detail = state.fetchManifestDetail || {};
  const activeJobs = manifests.filter((item) => !fetchJobTerminal(item.status));
  const jobsNeedingReview = manifests.filter((item) => fetchManifestIssueCount(item) > 0);
  const visibleOutputPaths = fetchVisibleOutputPaths(detail);
  const outputVisible = manifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = manifests.reduce((sum, item) => (
    sum +
    Number(item.output_missing_file_count || 0) +
    Number(item.output_outside_data_roots_count || 0) +
    Number(item.output_unsupported_file_count || 0)
  ), 0);
  const retryEvents = manifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const rootManifestCount = roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0);
  const selectedHasFailures = Number((detail.counts || {}).failed_symbols || detail.failed_symbols || 0) > 0
    || Number((detail.counts || {}).failed_chunks || detail.failed_chunks || 0) > 0
    || Number((detail.counts || {}).errors || detail.error_total || 0) > 0;
  const resumeCommand = fetchResumeCommand(detail);

  return [
    {
      label: "Configure Roots",
      title: roots.length ? `${numberText(rootManifestCount, 0)} manifests` : "No Roots",
      value: roots.length ? `${numberText(roots.length, 0)} roots` : `${numberText(rootConfigPaths.length, 0)} config paths`,
      status: roots.length && rootManifestCount ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      detail: roots.length
        ? "Fetch manifests are readable from configured roots."
        : "Add dashboard.fetch_manifest_roots or run a fetcher that writes JSON manifests.",
      href: workflowHref("fetch", "home"),
      cta: "Roots",
    },
    {
      label: "Monitor Jobs",
      title: activeJobs.length ? `${numberText(activeJobs.length, 0)} active` : manifests.length ? "No Active" : "No Jobs",
      value: `${numberText(filteredManifests.length, 0)} shown`,
      status: activeJobs.length ? "warn" : manifests.length ? "ok" : "bad",
      detail: activeJobs.length
        ? "Inspect active/non-terminal jobs before starting another fetch."
        : manifests.length ? "Use the Jobs lens to scan completed and failed fetches." : "No fetch manifest rows are loaded.",
      href: workflowHref("fetch", "jobs"),
      cta: "Jobs",
    },
    {
      label: "Recover Failures",
      title: detail.job_id ? text(detail.recovery_status || detail.status || "selected") : jobsNeedingReview.length ? `${numberText(jobsNeedingReview.length, 0)} review` : "No Detail",
      value: detail.job_id && resumeCommand ? "resume ready" : `${numberText(retryEvents, 0)}R/${numberText(pacingWaits, 0)}W`,
      status: detail.job_id ? selectedHasFailures ? resumeCommand ? "ok" : "warn" : "ok" : jobsNeedingReview.length ? "warn" : manifests.length ? "ok" : "bad",
      detail: detail.job_id
        ? selectedHasFailures ? "Selected job has failed work; review recovery plan and copy resume command when available." : "Selected job has no summarized failed symbols/chunks."
        : jobsNeedingReview.length ? "Open a job with failures or output issues to see recovery guidance." : "No loaded job currently reports recovery pressure.",
      href: workflowHref("fetch", "detail"),
      cta: "Recover",
    },
    {
      label: "Review Outputs",
      title: detail.job_id ? `${numberText(visibleOutputPaths.length, 0)} visible` : `${numberText(outputVisible, 0)} visible`,
      value: outputIssues ? `${numberText(outputIssues, 0)} issues` : "paths ok",
      status: detail.job_id ? visibleOutputPaths.length ? "ok" : Number(detail.output_total || 0) ? "warn" : "bad" : outputIssues ? "warn" : outputVisible ? "ok" : manifests.length ? "warn" : "bad",
      detail: detail.job_id
        ? visibleOutputPaths.length ? "Selected job outputs can be filtered into Data Library." : "Selected job outputs are missing, unsupported, outside configured roots, or absent."
        : outputVisible ? "Open a manifest detail to filter produced files into Data Library." : "Output visibility needs a selected manifest or configured data roots.",
      href: workflowHref("fetch", "detail"),
      cta: "Outputs",
    },
    {
      label: "Open Saved Data",
      title: visibleOutputPaths.length ? "Ready" : "Needs Visible Outputs",
      value: visibleOutputPaths.length ? `${numberText(visibleOutputPaths.length, 0)} files` : "none selected",
      status: visibleOutputPaths.length ? "ok" : detail.job_id ? "warn" : "bad",
      detail: visibleOutputPaths.length
        ? "Use Show Outputs in Data Library, Compare Outputs, or Copy Output Paths from Fetch Detail."
        : "Select a job with Data Library-visible output files first.",
      href: workflowHref(visibleOutputPaths.length ? "data" : "fetch", visibleOutputPaths.length ? "browse" : "detail"),
      cta: visibleOutputPaths.length ? "Data" : "Select Job",
    },
    {
      label: "Simulate Outputs",
      title: visibleOutputPaths.length ? "Workbench Ready" : "Not Ready",
      value: visibleOutputPaths.length ? `${numberText(visibleOutputPaths.length, 0)} inputs` : "no inputs",
      status: visibleOutputPaths.length ? "ok" : detail.job_id ? "warn" : "bad",
      detail: visibleOutputPaths.length
        ? "Send the selected fetch's visible outputs into Workbench with the manifest date range."
        : "Fetch outputs need to be visible under configured data roots before Workbench handoff.",
      href: workflowHref(visibleOutputPaths.length ? "workbench" : "fetch", visibleOutputPaths.length ? "builder" : "detail"),
      cta: "Workbench",
    },
  ];
}

function renderFetchWorkflowLauncher(context = {}) {
  const container = $("fetch-workflows");
  if (!container) return;
  const cards = fetchWorkflowCards(context);
  container.innerHTML = cards.map((card) => `
    <a class="action-card workflow-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <div class="workflow-card-foot">
        <em>${escapeHtml(card.value)}</em>
        <b>${escapeHtml(card.cta)}</b>
      </div>
    </a>
  `).join("");
}

function renderFetchJobsGuide(context = {}) {
  if (!$("fetch-jobs-guide") || !$("fetch-jobs-guide-note")) return;
  const payload = state.fetchManifests || {};
  const manifests = context.manifests || payload.manifests || [];
  const filteredManifests = context.filteredManifests || filteredFetchManifests(manifests);
  const roots = context.roots || payload.roots || [];
  const rootConfigPaths = context.rootConfigPaths || fetchManifestRootConfigPaths();
  const detail = state.fetchManifestDetail || {};
  const existingRoots = roots.filter((root) => root.exists && root.is_dir);
  const rootManifestCount = roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0);
  const failedJobs = manifests.filter((item) => Number(item.errors || 0) || Number(item.failed_symbols || 0) || Number(item.failed_chunks || 0));
  const terminalJobs = manifests.filter((item) => ["completed", "failed", "partial", "cancelled"].includes(text(item.status).toLowerCase()));
  const activeJobs = manifests.filter((item) => !["completed", "failed", "partial", "cancelled"].includes(text(item.status).toLowerCase()));
  const visibleOutputPaths = fetchVisibleOutputPaths(detail);
  const outputTotal = Number(detail.output_total || 0);
  const selectedHasFailures = Number((detail.counts || {}).failed_symbols || detail.failed_symbols || 0) > 0
    || Number((detail.counts || {}).failed_chunks || detail.failed_chunks || 0) > 0
    || Number((detail.counts || {}).errors || detail.error_total || 0) > 0;
  const resumeCommand = fetchResumeCommand(detail);
  const steps = [
    {
      status: existingRoots.length ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      label: "Configure Manifest Roots",
      detail: existingRoots.length
        ? `${numberText(existingRoots.length, 0)} active root${existingRoots.length === 1 ? "" : "s"} with ${numberText(rootManifestCount, 0)} manifest file${rootManifestCount === 1 ? "" : "s"}.`
        : rootConfigPaths.length
          ? "Roots are configured but none are currently readable directories."
          : "Add dashboard.fetch_manifest_roots or run a fetcher that writes JSON manifests.",
    },
    {
      status: manifests.length ? "ok" : existingRoots.length ? "warn" : "bad",
      label: "Load Jobs",
      detail: manifests.length
        ? `${numberText(manifests.length, 0)} job${manifests.length === 1 ? "" : "s"} loaded; ${numberText(activeJobs.length, 0)} active and ${numberText(terminalJobs.length, 0)} terminal.`
        : existingRoots.length
          ? "Roots are readable, but no manifest JSON files were found yet."
          : "No readable manifest roots are available.",
    },
    {
      status: !manifests.length ? "bad" : failedJobs.length ? "warn" : "ok",
      label: "Review Failures",
      detail: !manifests.length
        ? "No jobs loaded to review."
        : failedJobs.length
          ? `${numberText(failedJobs.length, 0)} job${failedJobs.length === 1 ? "" : "s"} have errors, failed symbols, or failed chunks.`
          : "No loaded job reports errors or failed chunks.",
    },
    {
      status: filteredManifests.length ? "ok" : manifests.length ? "warn" : "bad",
      label: "Find a Job",
      detail: filteredManifests.length
        ? `${numberText(filteredManifests.length, 0)} job${filteredManifests.length === 1 ? "" : "s"} match the current search/filter.`
        : manifests.length
          ? "Current filters hide every loaded job; clear search/status/kind filters."
          : "Load manifests before filtering.",
    },
    {
      status: detail.job_id ? (outputTotal ? "ok" : "warn") : manifests.length ? "warn" : "bad",
      label: "Inspect Outputs",
      detail: detail.job_id
        ? outputTotal
          ? `${text(detail.job_id)} records ${numberText(outputTotal, 0)} output row${outputTotal === 1 ? "" : "s"}.`
          : `${text(detail.job_id)} is selected but records no output paths.`
        : manifests.length
          ? "Click Inspect on a job to see symbol progress, output visibility, errors, and events."
          : "No job is available to inspect.",
    },
    {
      status: !detail.job_id ? "warn" : visibleOutputPaths.length ? "ok" : outputTotal ? "warn" : "bad",
      label: "Open Saved Data",
      detail: !detail.job_id
        ? "Select a job first; visible output files can jump directly into Data Library."
        : visibleOutputPaths.length
          ? `${numberText(visibleOutputPaths.length, 0)} produced file${visibleOutputPaths.length === 1 ? "" : "s"} are visible in configured data roots.`
          : outputTotal
            ? "Outputs exist, but they are missing, outside configured data roots, or unsupported."
            : "The selected job has no output paths to connect to Data Library.",
    },
    {
      status: !detail.job_id ? "warn" : selectedHasFailures ? (resumeCommand ? "ok" : "warn") : "ok",
      label: "Recover or Export",
      detail: !detail.job_id
        ? "Select a job to copy a resume command or export the detailed rows."
        : selectedHasFailures && resumeCommand
          ? "Copy Resume Command for failed work, or Export Detail CSV for offline review."
          : selectedHasFailures
            ? "Export Detail CSV and manually reconstruct the retry command for this job type."
            : "Export Detail CSV if you want a portable audit of symbols, outputs, errors, and events.",
    },
  ];
  const ready = steps.filter((step) => step.status === "ok").length;
  $("fetch-jobs-guide-note").textContent = `${ready} of ${steps.length} steps ready`;
  $("fetch-jobs-guide").innerHTML = steps.map((step) => (
    `<div class="check-item status-${escapeHtml(step.status)}"><span>${escapeHtml(step.status)}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div></div>`
  )).join("");
}

function renderFetchManifestDetail() {
  const detail = state.fetchManifestDetail || {};
  const resumeCommand = fetchResumeCommand(detail);
  const visibleOutputPaths = fetchVisibleOutputPaths(detail);
  $("fetch-detail-title").textContent = detail.job_id
    ? `${text(detail.job_id)} - ${text(detail.status)}`
    : "No fetch job selected";
  $("copy-fetch-resume-command").disabled = !resumeCommand;
  $("show-fetch-outputs-data").disabled = !visibleOutputPaths.length;
  $("compare-fetch-outputs").disabled = visibleOutputPaths.length < 2;
  $("use-fetch-outputs-workbench").disabled = !visibleOutputPaths.length;
  $("copy-fetch-output-paths").disabled = !visibleOutputPaths.length;
  $("export-fetch-detail-csv").disabled = !detail.job_id;
  const counts = detail.counts || {};
  const plan = detail.plan || {};
  const resumePlan = detail.resume_plan || {};
  const parameters = detail.parameters || {};
  $("fetch-recovery-cards").innerHTML = fetchRecoveryCards(detail, resumeCommand);
  $("fetch-recovery-plan").innerHTML = fetchRecoveryPlan(detail, resumeCommand, visibleOutputPaths);
  renderFetchResumePanel(detail, resumeCommand);
  const pairs = [
    ["Job", text(detail.job_id)],
    ["Kind", text(detail.kind)],
    ["Status", text(detail.status)],
    ["Started", text(detail.started_at)],
    ["Finished", text(detail.finished_at)],
    ["Bar / Range", `${text(parameters.bar_size)} ${rangeLabel(plan.range_start || parameters.start, plan.range_end || parameters.end || parameters.duration)}`],
    ["Symbols", jsonDrilldown(counts.status_counts || {}, countSummary(counts.status_counts || {})), true],
    ["Outputs", `${numberText(detail.output_total, 0)} total / rows ${numberText(counts.rows, 0)}`],
    ["Data Library Visibility", jsonDrilldown(detail.output_visibility_counts || {}, countSummary(detail.output_visibility_counts || {})), true],
    ["Output Statuses", jsonDrilldown(counts.output_status_counts || {}, countSummary(counts.output_status_counts || {})), true],
    ["Errors", `${escapeHtml(numberText(detail.error_total, 0))} total ${jsonDrilldown(counts.error_kind_counts || {}, countSummary(counts.error_kind_counts || {}))}`, true],
    ["Recovery", `${text(detail.recovery_status)} / ${text(detail.recovery_action)} - ${text(detail.recovery_note)}`],
    ["Resume Scope", resumePlan.resume_summary ? jsonDrilldown(resumePlan, resumePlan.resume_summary) : "n/a", Boolean(resumePlan.resume_summary)],
    ["Retries", `${numberText(counts.retry_events, 0)} retry events`],
    ["Pacing Waits", `${numberText(counts.pacing_wait_events, 0)} waits / ${interval(counts.pacing_wait_seconds)}`],
    ["Latest ETA", counts.latest_eta_seconds !== null && counts.latest_eta_seconds !== undefined ? interval(counts.latest_eta_seconds) : "n/a"],
    ["Avg Chunk", counts.latest_avg_chunk_seconds !== null && counts.latest_avg_chunk_seconds !== undefined ? interval(counts.latest_avg_chunk_seconds) : "n/a"],
    ["Symbol Progress", counts.latest_completed_symbols !== null && counts.latest_completed_symbols !== undefined ? `${numberText(counts.latest_completed_symbols, 0)} / ${numberText(counts.latest_total_symbols || counts.requested_symbols, 0)}` : "n/a"],
    ["Avg Symbol", counts.latest_avg_symbol_seconds !== null && counts.latest_avg_symbol_seconds !== undefined ? interval(counts.latest_avg_symbol_seconds) : "n/a"],
    ["Resume", resumeCommand || "n/a"],
    ["Output Dir", text(parameters.out_dir)],
    ["Manifest", text(detail.path)],
  ];
  $("fetch-detail-summary").innerHTML = kvRows(pairs, { mono: true });

  const symbols = detail.symbols || [];
  $("fetch-symbols-body").innerHTML = symbols.length
    ? symbols.map((item) => row([
        escapeHtml(item.symbol),
        statusText(item.status),
        escapeHtml(numberText(item.bars, 0)),
        escapeHtml(`${numberText(item.chunks_completed, 0)} / fail ${numberText(item.chunks_failed, 0)} / skip ${numberText(item.chunks_skipped, 0)}`),
        escapeHtml(rangeLabel(item.first_timestamp, item.last_timestamp)),
        escapeHtml(item.message),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);

  const errors = detail.errors || [];
  $("fetch-errors-body").innerHTML = errors.length
    ? errors.slice().reverse().map((item) => row([
        escapeHtml(item.timestamp),
        escapeHtml(item.symbol),
        statusText(item.kind),
        escapeHtml(item.day),
        escapeHtml(numberText(item.attempt_count, 0)),
        escapeHtml(item.message),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);

  const events = (detail.events || []).filter((item) => item.type === "retry" || item.type === "pacing_wait");
  $("fetch-events-note").textContent = detail.job_id
    ? `${numberText(events.length, 0)} retry/pacing events shown`
    : "No retry or pacing events selected";
  $("fetch-events-body").innerHTML = events.length
    ? events.slice().reverse().map((item) => row([
        escapeHtml(item.timestamp),
        statusText(item.type === "retry" ? "warn" : "ok"),
        escapeHtml(item.symbol),
        escapeHtml(item.day),
        escapeHtml(item.type === "retry"
          ? `attempt ${numberText(item.attempt, 0)} / max ${numberText(item.max_retries, 0)} after ${interval(item.delay_seconds)}: ${text(item.message)}`
          : `${text(item.reason)} ${interval(item.seconds)}`),
      ])).join("")
    : row([`<span class="muted">No retry or pacing events recorded in this manifest.</span>`, "", "", "", ""]);

  const outputs = detail.outputs || [];
  $("fetch-output-note").textContent = detail.job_id
    ? `${numberText(outputs.length, 0)} shown / ${numberText(detail.output_total, 0)} total`
    : "No output rows selected";
  $("fetch-outputs-body").innerHTML = outputs.length
    ? outputs.slice().reverse().map((item) => row([
        escapeHtml(item.timestamp),
        escapeHtml(item.symbol),
        statusText(item.status),
        escapeHtml(item.day),
        escapeHtml(numberText(item.rows, 0)),
        escapeHtml(`${interval(item.elapsed_seconds)} / ${numberText(item.attempt_count, 0)} attempts`),
        escapeHtml(rangeLabel(item.first_timestamp, item.last_timestamp)),
        `<span class="mono">${escapeHtml(item.path)}</span>`,
        item.data_detail_available
          ? `<button type="button" class="secondary inspect-data" data-path="${escapeHtml(item.data_detail_path)}">Inspect Data</button>`
          : `<span class="muted">${escapeHtml(fetchOutputVisibilityLabel(item))}</span>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", ""]);
  renderFetchJobsGuide();
}

function applyFetchOutputDataFilter() {
  const detail = state.fetchManifestDetail || {};
  const paths = fetchVisibleOutputPaths(detail);
  if (!paths.length) {
    $("last-refresh").textContent = "Selected fetch has no Data Library-visible outputs";
    return;
  }
  state.manifestPathFilter = {
    job_id: detail.job_id || "selected fetch",
    paths,
  };
  $("data-filter-text").value = "";
  $("data-filter-quality").value = "";
  $("data-filter-bar").value = "";
  $("data-filter-asset").value = "";
  $("data-filter-source").value = "";
  $("data-filter-session").value = "";
  $("data-filter-contract").value = "";
  $("data-filter-sort").value = "modified_desc";
  navigateToDataLens("browse");
  renderDataCatalog();
  $("last-refresh").textContent = `Data Library filtered to ${numberText(paths.length, 0)} visible output${paths.length === 1 ? "" : "s"} from ${text(detail.job_id || "selected fetch")}`;
}

function useFetchOutputsInWorkbench() {
  const detail = state.fetchManifestDetail || {};
  const paths = fetchVisibleOutputPaths(detail);
  if (!paths.length) {
    $("last-refresh").textContent = "Selected fetch has no Data Library-visible outputs for Workbench";
    return;
  }
  const datasetSelect = $("config-dataset");
  if (!datasetSelect) return;
  const selectedPaths = new Set(paths);
  for (const option of datasetSelect.options) {
    option.selected = selectedPaths.has(option.value);
  }
  const catalogByPath = new Map((state.dataCatalog.datasets || []).map((dataset) => [dataset.path, dataset]));
  for (const path of paths) {
    if (Array.from(datasetSelect.options).some((option) => option.value === path)) continue;
    const dataset = catalogByPath.get(path) || { path };
    const option = document.createElement("option");
    option.value = path;
    option.textContent = `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${path}`;
    option.selected = true;
    datasetSelect.appendChild(option);
  }
  const plan = detail.plan || {};
  const parameters = detail.parameters || {};
  const start = dateInputValueFromTimestamp(plan.range_start || parameters.start);
  const end = dateInputValueFromTimestamp(plan.range_end || parameters.end);
  if ($("config-start-date")) $("config-start-date").value = start;
  if ($("config-end-date")) $("config-end-date").value = end;
  renderConfigLivePanels();
  navigateToWorkbenchLens("builder");
  window.setTimeout(() => {
    const target = $("workbench-stepper") || $("config-form");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 50);
  $("last-refresh").textContent = `Selected ${numberText(paths.length, 0)} fetch output${paths.length === 1 ? "" : "s"} for Workbench simulation`;
}

async function compareFetchOutputs() {
  const detail = state.fetchManifestDetail || {};
  const paths = fetchVisibleOutputPaths(detail).slice(0, MAX_DATA_COMPARE_DATASETS);
  if (paths.length < 2) {
    $("last-refresh").textContent = "Selected fetch needs at least two Data Library-visible outputs to compare";
    return;
  }
  state.dataCompareSelectedPaths = paths;
  state.dataCompareSelectionCleared = false;
  $("data-compare-filter").value = "";
  $("data-compare-asset").value = "";
  $("data-compare-source").value = "";
  $("data-compare-bar").value = "";
  $("data-compare-session").value = "";
  $("data-compare-quality").value = "";
  $("data-compare-contract").value = "";
  $("data-compare-range-preset").value = "custom";
  const plan = detail.plan || {};
  const parameters = detail.parameters || {};
  $("data-compare-start").value = dateInputValueFromTimestamp(plan.range_start || parameters.start);
  $("data-compare-end").value = dateInputValueFromTimestamp(plan.range_end || parameters.end);
  renderDataCompareControls();
  await loadDataCompare();
  navigateToDataLens("compare");
  if ($("data-compare-form")) $("data-compare-form").scrollIntoView({ block: "start", behavior: "smooth" });
  $("last-refresh").textContent = `Compared ${numberText(paths.length, 0)} visible output${paths.length === 1 ? "" : "s"} from ${text(detail.job_id || "selected fetch")}`;
}

function copyFetchVisibleOutputPaths() {
  const detail = state.fetchManifestDetail || {};
  const paths = fetchVisibleOutputPaths(detail);
  if (!paths.length) {
    $("last-refresh").textContent = "Selected fetch has no Data Library-visible output paths";
    return;
  }
  copyText(paths.join("\n")).then(() => {
    $("last-refresh").textContent = `Copied ${numberText(paths.length, 0)} visible fetch output path${paths.length === 1 ? "" : "s"}`;
  }).catch((err) => {
    $("last-refresh").textContent = `Copy failed: ${err.message}`;
  });
}

function copyDataRootsYaml() {
  const snippet = dataRootsYamlSnippet();
  const count = dataRootConfigPaths().length;
  if (!snippet) {
    $("last-refresh").textContent = "No configured or suggested data roots to copy";
    return;
  }
  copyText(snippet).then(() => {
    $("last-refresh").textContent = `Copied dashboard.data_roots YAML for ${numberText(count, 0)} root${count === 1 ? "" : "s"}`;
  }).catch((err) => {
    $("last-refresh").textContent = `Copy failed: ${err.message}`;
  });
}

function copyFetchManifestRootsYaml() {
  const snippet = fetchManifestRootsYamlSnippet();
  const count = fetchManifestRootConfigPaths().length;
  if (!snippet) {
    $("last-refresh").textContent = "No configured fetch manifest roots to copy";
    return;
  }
  copyText(snippet).then(() => {
    $("last-refresh").textContent = `Copied dashboard.fetch_manifest_roots YAML for ${numberText(count, 0)} root${count === 1 ? "" : "s"}`;
  }).catch((err) => {
    $("last-refresh").textContent = `Copy failed: ${err.message}`;
  });
}

function fetchOutputVisibilityLabel(item) {
  if (!item || item.data_detail_available) return "visible";
  if (item.data_detail_status === "missing_file") return "missing file";
  if (item.data_detail_status === "outside_data_roots") return "outside data roots";
  if (item.data_detail_status === "no_path") return "no path";
  if (item.data_detail_status === "unsupported_file") return "unsupported file";
  return text(item.data_detail_reason || item.data_detail_status || "not inspectable");
}

function renderFetchResumePanel(detail, resumeCommand = "") {
  if (!$("fetch-resume-note") || !$("fetch-resume-cards") || !$("fetch-resume-command")) return;
  const resumePlan = (detail && detail.resume_plan) || {};
  const resumeState = (detail && detail.resume_state) || {};
  const hasJob = Boolean(detail && detail.job_id);
  const supported = Boolean(resumeCommand);
  const retryCount = Number(resumePlan.retry_failed_count || (detail && detail.resume_retry_count) || 0);
  const skipCount = Number(resumePlan.skip_completed_count || (detail && detail.resume_skip_count) || 0);
  const reviewCount = Number(resumePlan.review_no_data_count || (detail && detail.resume_review_count) || 0);
  const pendingCount = Number(resumePlan.pending_estimate || (detail && detail.resume_pending_estimate) || 0);
  $("fetch-resume-note").textContent = hasJob
    ? supported
      ? text(resumePlan.resume_summary || "Resume command is available for this manifest.")
      : "This selected manifest is not resumable through the built-in fetch resume command."
    : "Select a resumable fetch job to see retry scope.";
  const cards = [
    {
      status: supported ? "ok" : hasJob ? "warn" : "waiting",
      label: "Command",
      title: supported ? "Available" : "Unavailable",
      note: supported ? "Copy and run locally after fixing any listed blockers." : "Stock and crypto history manifests expose built-in resume commands.",
    },
    {
      status: skipCount ? "ok" : supported ? "warn" : "waiting",
      label: "Skip",
      title: numberText(skipCount, 0),
      note: "Completed/empty work the fetcher can skip when resuming.",
    },
    {
      status: retryCount ? "warn" : supported ? "ok" : "waiting",
      label: "Retry",
      title: numberText(retryCount, 0),
      note: "Failed or incomplete work estimated for retry.",
    },
    {
      status: reviewCount ? "warn" : supported ? "ok" : "waiting",
      label: "Review",
      title: numberText(reviewCount, 0),
      note: "No-data rows to inspect before deciding whether to force a refetch.",
    },
    {
      status: pendingCount ? "warn" : supported ? "ok" : "waiting",
      label: "Pending",
      title: numberText(pendingCount, 0),
      note: "Estimated unfinished work from the manifest plan.",
    },
  ];
  $("fetch-resume-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  if ($("fetch-resume-state-note")) {
    $("fetch-resume-state-note").textContent = resumeState && resumeState.summary
      ? `Manifest-owned state loaded: ${text(resumeState.summary)}`
      : hasJob
        ? "This manifest has no normalized resume_state; the resume plan is inferred from symbols, outputs, errors, and plan rows."
        : "Inspect a fetch manifest to see whether normalized resume_state is available.";
  }
  if ($("fetch-resume-state-cards")) {
    const stateCards = resumeState && resumeState.summary ? [
      {
        status: Number(resumeState.pending_symbol_count || resumeState.failed_day_count || 0) ? "warn" : "ok",
        label: "State",
        title: text((resumeState.resume_modes || []).join(", ") || "normalized"),
        note: text(resumeState.summary),
      },
      {
        status: Number(resumeState.done_symbol_count || resumeState.completed_output_path_count || 0) ? "ok" : "waiting",
        label: "Completed",
        title: `${numberText(resumeState.done_symbol_count, 0)} sym / ${numberText(resumeState.completed_output_path_count, 0)} paths`,
        note: `Sample: ${text((resumeState.done_symbols_sample || resumeState.completed_output_paths_sample || []).slice(0, 5).join(", ") || "none")}`,
      },
      {
        status: Number(resumeState.pending_symbol_count || resumeState.failed_symbol_count || resumeState.failed_day_count || 0) ? "warn" : "ok",
        label: "Pending",
        title: `${numberText(resumeState.pending_symbol_count, 0)} sym / ${numberText(resumeState.failed_day_count, 0)} days`,
        note: `Sample: ${text((resumeState.pending_symbols_sample || resumeState.failed_symbols_sample || Object.keys(resumeState.failed_days_by_symbol_sample || {})).slice(0, 5).join(", ") || "none")}`,
      },
      {
        status: Number(resumeState.no_data_symbol_count || resumeState.no_data_day_count || 0) ? "warn" : "ok",
        label: "No Data",
        title: `${numberText(resumeState.no_data_symbol_count, 0)} sym / ${numberText(resumeState.no_data_day_count, 0)} days`,
        note: `Sample: ${text((resumeState.no_data_symbols_sample || Object.keys(resumeState.no_data_days_by_symbol_sample || {})).slice(0, 5).join(", ") || "none")}`,
      },
      {
        status: Number(resumeState.permission_symbol_count || resumeState.contract_symbol_count || 0) ? "bad" : "ok",
        label: "Blocked",
        title: `${numberText(resumeState.permission_symbol_count, 0)} perm / ${numberText(resumeState.contract_symbol_count, 0)} contract`,
        note: `Retryable sample: ${text((resumeState.retryable_symbols_sample || []).slice(0, 5).join(", ") || "none")}`,
      },
    ] : [];
    $("fetch-resume-state-cards").innerHTML = stateCards.length
      ? stateCards.map((card) => `
        <div class="action-card status-${escapeHtml(card.status)}">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.title)}</strong>
          <small>${escapeHtml(card.note)}</small>
        </div>
      `).join("")
      : "";
  }
  $("fetch-resume-command").innerHTML = supported
    ? `<span class="mono">${escapeHtml(resumeCommand)}</span><button type="button" class="secondary copy-fetch-resume-inline" data-command="${escapeHtml(resumeCommand)}">Copy</button>`
    : `<span class="muted">${hasJob ? "No built-in resume command for this manifest kind." : "Inspect a stock or crypto history manifest first."}</span>`;
}

function fetchRecoveryCards(detail, resumeCommand = "") {
  if (!detail || !detail.job_id) {
    return `<div class="health-card empty-card"><span>${statusText("waiting")}</span><strong>Select Fetch</strong><small>Inspect a fetch job to see retry and recovery guidance.</small></div>`;
  }
  const counts = detail.counts || {};
  const failedSymbols = Number(counts.failed_symbols || detail.failed_symbols || 0);
  const emptySymbols = Number(counts.empty_symbols || detail.empty_symbols || 0);
  const successSymbols = Number(counts.success_symbols || detail.success_symbols || 0);
  const failedChunks = Number(counts.failed_chunks || detail.failed_chunks || 0);
  const errors = Number(counts.errors || detail.error_total || 0);
  const retryEvents = Number(counts.retry_events || 0);
  const waits = Number(counts.pacing_wait_events || 0);
  const waitSeconds = Number(counts.pacing_wait_seconds || 0);
  const errorKinds = counts.error_kind_counts || {};
  const permissionErrors = Number(errorKinds.permission || 0);
  const visibleOutputs = Number(detail.output_visible_count || 0);
  const missingOutputs = Number(detail.output_missing_file_count || 0);
  const outsideOutputs = Number(detail.output_outside_data_roots_count || 0);
  const noPathOutputs = Number(detail.output_no_path_count || 0);
  const unsupportedOutputs = Number(detail.output_unsupported_file_count || 0);
  const outputTotal = Number(detail.output_total || 0);
  const hasFailures = failedSymbols > 0 || failedChunks > 0 || errors > 0;
  const resumePlan = detail.resume_plan || {};
  const resumePending = Number(resumePlan.pending_estimate || detail.resume_pending_estimate || 0);
  const resumeSkipped = Number(resumePlan.skip_completed_count || detail.resume_skip_count || 0);
  const resumeRetry = Number(resumePlan.retry_failed_count || detail.resume_retry_count || 0);
  const resumeReview = Number(resumePlan.review_no_data_count || detail.resume_review_count || 0);
  const recoverStatus = detail.recovery_status || (permissionErrors > 0
    ? "bad"
    : hasFailures
      ? "warn"
      : "ok");
  const recoveryDisplayStatus = recoverStatus === "blocked" ? "bad" : recoverStatus === "retry" || recoverStatus === "review" ? "warn" : recoverStatus === "ready" ? "ok" : recoverStatus;
  const recoverNote = detail.recovery_note || (permissionErrors > 0
    ? "Permission failures usually need subscription/account changes before retrying."
    : hasFailures && resumeCommand
      ? "Copy the resume command to retry failed or missing work."
      : hasFailures
        ? "Review errors and rerun with the same inputs after fixing the cause."
        : "No failed symbols or chunks recorded.");
  const coverageStatus = failedSymbols > 0 ? "warn" : successSymbols > 0 ? "ok" : "bad";
  const visibilityStatus = !outputTotal
    ? "bad"
    : missingOutputs || outsideOutputs || noPathOutputs || unsupportedOutputs
      ? "warn"
      : "ok";
  const visibilityNote = !outputTotal
    ? "No output paths are recorded in this manifest."
    : missingOutputs || outsideOutputs || noPathOutputs || unsupportedOutputs
      ? `${numberText(missingOutputs, 0)} missing / ${numberText(outsideOutputs, 0)} outside roots / ${numberText(noPathOutputs, 0)} no path / ${numberText(unsupportedOutputs, 0)} unsupported.`
      : "Every recorded output is inspectable from Data Library.";
  const retryStatus = retryEvents > 0 ? "warn" : "ok";
  const pacingStatus = waits > 0 ? "warn" : "ok";
  const cards = [
    {
      status: coverageStatus,
      title: `${numberText(successSymbols, 0)} ok / ${numberText(failedSymbols, 0)} failed`,
      label: "Symbol Coverage",
      note: `${numberText(emptySymbols, 0)} empty symbols; ${numberText(failedChunks, 0)} failed chunks.`,
    },
    {
      status: recoveryDisplayStatus,
      title: text(detail.recovery_action || (recoveryDisplayStatus === "ok" ? "ready" : recoveryDisplayStatus === "warn" ? "retry" : "blocked")),
      label: "Recovery",
      note: recoverNote,
    },
    {
      status: resumeCommand ? (resumePending || resumeSkipped ? "ok" : "warn") : "warn",
      title: resumePlan.resume_mode ? text(resumePlan.resume_mode) : "n/a",
      label: "Resume Scope",
      note: resumePlan.resume_summary
        ? resumePlan.resume_summary
        : resumeCommand
          ? `Skip ${numberText(resumeSkipped, 0)} / retry ${numberText(resumeRetry, 0)} / review ${numberText(resumeReview, 0)}.`
          : "No built-in resume command for this manifest kind.",
    },
    {
      status: visibilityStatus,
      title: `${numberText(visibleOutputs, 0)} / ${numberText(outputTotal, 0)}`,
      label: "Data Visibility",
      note: visibilityNote,
    },
    {
      status: retryStatus,
      title: numberText(retryEvents, 0),
      label: "Retries",
      note: retryEvents ? "Transient failures were retried; inspect event rows." : "No retry events recorded.",
    },
    {
      status: pacingStatus,
      title: interval(waitSeconds),
      label: "Pacing Waits",
      note: waits ? `${numberText(waits, 0)} waits recorded; useful for IBKR pacing diagnosis.` : "No pacing waits recorded.",
    },
  ];
  return cards.map((card) => `
    <div class="health-card fetch-recovery-card">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function fetchRecoveryPlan(detail, resumeCommand = "", visibleOutputPaths = []) {
  if (!detail || !detail.job_id) {
    return `
      <div class="check-item status-warn">
        <span>warn</span>
        <div><strong>Select a fetch job</strong><small>Choose Inspect on a manifest to see recovery steps, resume support, and output visibility.</small></div>
      </div>
    `;
  }
  const action = String(detail.recovery_action || "");
  const status = detail.recovery_status || "unknown";
  const hasResume = Boolean(resumeCommand);
  const resumePlan = detail.resume_plan || {};
  const steps = [];
  if (action === "fix_permissions") {
    steps.push({
      status: "bad",
      label: "Fix market-data permissions",
      detail: "Permission errors are blocking recovery; update subscriptions/contracts before retrying this manifest.",
    });
  } else if (action === "fix_contracts") {
    steps.push({
      status: "bad",
      label: "Fix symbol or contract settings",
      detail: "Contract/security-definition failures need symbol, exchange, or data-type corrections before retrying.",
    });
  } else if (action === "review_no_data") {
    steps.push({
      status: "warn",
      label: "Review no-data symbols",
      detail: "No-data responses may be valid for inactive symbols or unsupported dates; inspect symbol/error rows before retrying.",
    });
  } else if (action === "fix_data_roots") {
    steps.push({
      status: "warn",
      label: "Fix Data Library roots",
      detail: "Outputs exist but are missing, unsupported, or outside configured roots; update data_roots or inspect output paths.",
    });
  } else if (action === "resume_manifest") {
    steps.push({
      status: "warn",
      label: "Resume failed work",
      detail: "Use the generated resume command after checking Gateway/API stability and any retryable errors.",
    });
  } else if (status === "ready") {
    steps.push({
      status: "ok",
      label: "Inspect outputs",
      detail: "No recovery blockers are visible; review Data Library-visible outputs or export detail rows.",
    });
  } else {
    steps.push({
      status: status === "blocked" ? "bad" : status === "retry" || status === "review" ? "warn" : "ok",
      label: text(action || status),
      detail: text(detail.recovery_note || "Review recovery cards and detail rows."),
    });
  }
  steps.push({
    status: hasResume ? "ok" : "warn",
    label: hasResume ? "Resume command available" : "No resume command",
    detail: hasResume
      ? text(resumePlan.resume_summary || "Copy Resume Command to retry failed, missing, or incomplete manifest work while skipping completed items when the fetcher supports it.")
      : "This manifest kind is not resumable through the generic resume command.",
  });
  steps.push({
    status: visibleOutputPaths.length ? "ok" : Number(detail.output_total || 0) ? "warn" : "bad",
    label: visibleOutputPaths.length ? "Review visible outputs" : "No visible outputs",
    detail: visibleOutputPaths.length
      ? `Show ${numberText(visibleOutputPaths.length, 0)} Data Library-visible output${visibleOutputPaths.length === 1 ? "" : "s"} as a filtered saved-data set.`
      : "Recorded outputs are missing, outside configured data roots, unsupported, or absent.",
  });
  return steps.map((step) => `
    <div class="check-item status-${escapeHtml(step.status)}">
      <span>${escapeHtml(step.status)}</span>
      <div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div>
    </div>
  `).join("");
}

function fetchResumeCommand(detail) {
  if (!detail || !detail.path) return "";
  if (detail.resume_command) return text(detail.resume_command);
  if (detail.kind === "crypto_history") {
    return `python3 live/fetch_crypto_history.py --resume-manifest ${shellQuote(detail.path)}`;
  }
  if (detail.kind === "stock_history") {
    return `python3 live/fetch_history.py --resume-manifest ${shellQuote(detail.path)}`;
  }
  return "";
}

function fetchJobFilters() {
  return {
    text: ($("fetch-filter-text").value || "").trim().toLowerCase(),
    status: $("fetch-filter-status").value || "",
    kind: $("fetch-filter-kind").value || "",
    sort: $("fetch-filter-sort").value || "started_desc",
  };
}

function renderFetchFilterOptions(manifests) {
  const makeOptions = (id, values) => {
    const current = $(id).value || "";
    const unique = Array.from(new Set((values || []).map(text).filter((value) => value && value !== "n/a"))).sort();
    $(id).innerHTML = `<option value="">All</option>${unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (unique.includes(current)) $(id).value = current;
  };
  makeOptions("fetch-filter-status", (manifests || []).map((item) => item.status));
  makeOptions("fetch-filter-kind", (manifests || []).map((item) => item.kind));
}

function fetchManifestSortValue(item, key) {
  if (key === "started") return timestampMillis(item.started_at) || 0;
  if (key === "finished") return timestampMillis(item.finished_at) || 0;
  if (key === "errors") return Number(item.errors || 0);
  if (key === "rows") return Number(item.rows || 0);
  if (key === "symbols") return Number(item.symbols_requested || item.success_symbols || 0);
  return String(item.kind || item.job_id || "").toLowerCase();
}

function filteredFetchManifests(manifests) {
  const filters = fetchJobFilters();
  const filtered = (manifests || []).filter((item) => {
    if (filters.status && text(item.status) !== filters.status) return false;
    if (filters.kind && text(item.kind) !== filters.kind) return false;
    if (filters.text) {
      const haystack = [
        item.job_id,
        item.kind,
        item.status,
        item.started_at,
        item.finished_at,
        item.latest_output_path,
        item.first_output_path,
        item.out_dir,
        item.error_sample,
        ...(item.symbols || []),
        ...(item.symbols_requested_list || []),
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });
  const [key, direction] = String(filters.sort || "started_desc").split("_");
  const multiplier = direction === "asc" ? 1 : -1;
  return filtered.slice().sort((left, right) => {
    const leftValue = fetchManifestSortValue(left, key);
    const rightValue = fetchManifestSortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier;
    }
    const primary = String(leftValue).localeCompare(String(rightValue)) * multiplier;
    if (primary) return primary;
    return String(left.job_id || "").localeCompare(String(right.job_id || ""));
  });
}

function replaceOptions(select, options) {
  const currentValues = select.multiple
    ? new Set(Array.from(select.selectedOptions).map((option) => option.value))
    : new Set([select.value]);
  select.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.value)}"${option.description ? ` title="${escapeHtml(option.description)}"` : ""}>${escapeHtml(option.label)}</option>`
  )).join("");
  let restored = false;
  for (const option of select.options) {
    if (currentValues.has(option.value)) {
      option.selected = true;
      restored = true;
    }
  }
  if (!select.multiple && !restored && options.length) {
    select.value = options[0].value;
  }
}

function configFormOptionRows(field, options) {
  const source = field.options_source || "";
  if (source === "plugins") {
    return (options.plugins || []).map((plugin) => ({
      value: plugin.id,
      label: `${plugin.label} (${plugin.visibility || plugin.status})`,
    }));
  }
  if (source === "modes") return (options.modes || []).map((mode) => ({ value: mode, label: mode }));
  if (source === "risk_presets") {
    return (options.risk_presets || []).map((preset) => ({
      value: preset.id,
      label: `${preset.label} - ${preset.description}`,
    }));
  }
  if (source === "datasets") {
    return (state.dataCatalog.datasets || []).map((dataset) => ({
      value: dataset.path,
      label: `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`,
    }));
  }
  return (field.options || []).map((option) => ({
    value: option.value ?? option.id ?? option,
    label: option.description
      ? `${option.label ?? option.value ?? option.id ?? option} - ${option.description}`
      : option.label ?? option.value ?? option.id ?? option,
    description: option.description || "",
  }));
}

function configSectionMetadataById() {
  const sections = (state.configOptions && state.configOptions.form_sections) || [];
  return Object.fromEntries(sections.map((section) => [section.id, section]));
}

function configSectionTitle(section, metadataById = configSectionMetadataById()) {
  return text((metadataById[section] || {}).label || section);
}

function configSectionHelp(section, metadataById = configSectionMetadataById()) {
  return text((metadataById[section] || {}).help || "");
}

function configSectionOrder(section, metadataById = configSectionMetadataById()) {
  const value = Number((metadataById[section] || {}).order);
  return Number.isFinite(value) ? value : 999;
}

function configFieldTitle(field, label) {
  const meta = [];
  if (field.required) meta.push("Required");
  if (field.unit) meta.push(`Unit: ${field.unit}`);
  if (field.advanced) meta.push("Advanced");
  const metaHtml = meta.length
    ? `<span class="field-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</span>`
    : "";
  return `<span class="field-title"><span>${label}</span>${metaHtml}</span>`;
}

function configFieldDescription(field) {
  const description = field.description
    ? `<small class="field-description">${escapeHtml(field.description)}</small>`
    : "";
  const help = field.help ? `<small>${escapeHtml(field.help)}</small>` : "";
  return `${description}${help}`;
}

function configFieldInputAffix(field, inputHtml) {
  const prefix = field.prefix ? `<span class="field-affix">${escapeHtml(field.prefix)}</span>` : "";
  const suffix = field.suffix || field.unit;
  const suffixHtml = suffix ? `<span class="field-affix">${escapeHtml(suffix)}</span>` : "";
  if (!prefix && !suffixHtml) return inputHtml;
  return `<span class="field-input-row">${prefix}${inputHtml}${suffixHtml}</span>`;
}

function renderConfigField(field) {
  const id = escapeHtml(field.id);
  const label = escapeHtml(field.label || field.name || field.id);
  const title = configFieldTitle(field, label);
  const help = configFieldDescription(field);
  const pluginAttr = field.plugin_id ? ` data-plugin-id="${escapeHtml(field.plugin_id)}"` : "";
  const cls = [
    field.kind === "checkbox" ? "checkbox-field" : "",
    field.plugin_id ? "plugin-strategy-field" : "",
    field.wide ? "wide-field" : "",
    field.advanced ? "advanced-field" : "",
  ].filter(Boolean).join(" ");
  const fieldPath = field.plugin_id && field.name ? `strategy.${field.name}` : field.name || field.id;
  const validation = `<small class="field-validation-message" data-field-error-for="${escapeHtml(fieldPath)}" hidden></small>`;
  if (field.kind === "select") {
    const multiple = field.multiple ? " multiple" : "";
    const size = field.size ? ` size="${escapeHtml(String(field.size))}"` : "";
    const required = field.required ? " required" : "";
    return `<label class="${escapeHtml(cls)}"${pluginAttr}>${title}<select id="${id}"${multiple}${size}${required}></select>${help}${validation}</label>`;
  }
  if (field.kind === "checkbox") {
    return `<label class="${escapeHtml(cls)}"${pluginAttr}><input id="${id}" type="checkbox">${title}${help}${validation}</label>`;
  }
  const type = field.kind === "date" ? "date" : field.kind === "number" ? "number" : "text";
  const attrs = [
    `id="${id}"`,
    `type="${escapeHtml(type)}"`,
    field.placeholder ? `placeholder="${escapeHtml(String(field.placeholder))}"` : "",
    field.min !== undefined ? `min="${escapeHtml(String(field.min))}"` : "",
    field.max !== undefined ? `max="${escapeHtml(String(field.max))}"` : "",
    field.step !== undefined ? `step="${escapeHtml(String(field.step))}"` : "",
    field.required ? "required" : "",
  ].filter(Boolean).join(" ");
  return `<label class="${escapeHtml(cls)}"${pluginAttr}>${title}${configFieldInputAffix(field, `<input ${attrs}>`)}${help}${validation}</label>`;
}

function updatePluginStrategyFields() {
  const selectedPluginId = $("config-plugin") ? $("config-plugin").value : "";
  for (const field of document.querySelectorAll(".plugin-strategy-field")) {
    const visible = !field.dataset.pluginId || field.dataset.pluginId === selectedPluginId;
    field.hidden = !visible;
  }
}

function renderConfigFormSchema() {
  const fields = (state.configOptions && state.configOptions.form_schema) || [];
  const container = $("config-form-fields");
  if (!container || container.dataset.rendered === "true" || !fields.length) return;
  const sectionMetadata = configSectionMetadataById();
  const sections = [];
  for (const field of fields) {
    const section = field.section || "settings";
    let group = sections.find((item) => item.section === section);
    if (!group) {
      group = { section, fields: [] };
      sections.push(group);
    }
    group.fields.push(field);
  }
  sections.sort((left, right) => (
    configSectionOrder(left.section, sectionMetadata) - configSectionOrder(right.section, sectionMetadata)
    || left.section.localeCompare(right.section)
  ));
  container.innerHTML = sections.map((group) => `
    <fieldset id="config-section-${escapeHtml(group.section)}" class="config-field-section">
      <legend>${escapeHtml(configSectionTitle(group.section, sectionMetadata))}</legend>
      <p>${escapeHtml(configSectionHelp(group.section, sectionMetadata))}</p>
      <div class="config-field-grid">
        ${group.fields.map(renderConfigField).join("")}
      </div>
    </fieldset>
  `).join("");
  container.dataset.rendered = "true";
}

function renderConfigBuilder() {
  const options = state.configOptions || {};
  const defaults = options.defaults || {};
  const runActions = (options.run_actions || []).map((action) => ({ value: action, label: action }));
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const draftOptions = drafts.map((draft) => ({
    value: draft.draft_id,
    label: `${draft.draft_id} - ${text(draft.mode)}`,
  }));
  renderConfigFormSchema();
  for (const field of options.form_schema || []) {
    if (field.kind === "select" && $(field.id)) {
      replaceOptions($(field.id), configFormOptionRows(field, options));
    }
  }
  if (runActions.length) replaceOptions($("config-run-action"), runActions);
  replaceOptions($("config-run-draft"), draftOptions);

  const defaultFields = Object.fromEntries((options.form_schema || [])
    .filter((field) => field.default_key)
    .map((field) => [field.id, defaults[field.default_key]]));
  for (const field of options.form_schema || []) {
    if (field.default !== undefined && defaultFields[field.id] === undefined) {
      defaultFields[field.id] = field.default;
    }
  }
  defaultFields["config-run-max-steps"] = defaults.max_steps;
  defaultFields["config-run-timeout"] = defaults.run_timeout_seconds;
  for (const [id, value] of Object.entries(defaultFields)) {
    const el = $(id);
    if (!el || value === undefined) continue;
    if (el.type === "checkbox") {
      el.checked = Boolean(value);
    } else if (!el.value) {
      el.value = String(value);
    }
  }
  renderConfigDataQuality();
  updatePluginStrategyFields();
  renderWorkbenchHome();
  renderWorkbenchGuide();
  renderWorkbenchPluginBoundary();
  renderConfigPluginBoundary();
  renderConfigPluginFieldHelp();
  renderConfigBrokerBoundary();
  renderWorkbenchBuilderAssistant();
  renderConfigBuilderReadiness();
  renderConfigCompatibility();
  renderConfigValidationMessages();

  const draft = state.configDraft;
  if (!draft) {
    const draftErrors = normalizeConfigDraftErrors(state.configDraftErrors || []);
    $("config-validation").innerHTML = draftErrors.length
      ? `<span class="status-bad">invalid</span> <span class="muted">${escapeHtml(draftErrors.join("; "))}</span>`
      : `<span class="muted">Select datasets, review quality/alignment, then Generate.</span>`;
    $("config-yaml").value = "";
    $("config-commands").innerHTML = `<dt>Next</dt><dd><span class="muted">Generate a draft to get local validate/replay commands.</span></dd>`;
    renderConfigAlignment(state.alignmentPreview || {});
    return;
  }
  const valid = draft.validation && draft.validation.valid;
  const errors = (draft.validation && draft.validation.errors) || [];
  $("config-validation").innerHTML = valid
    ? `<span class="status-ok">valid</span>${draft.saved_path ? ` <span class="muted">${escapeHtml(draft.saved_path)}</span>` : ""}`
    : `<span class="status-bad">invalid</span> <span class="muted">${escapeHtml(errors.join("; "))}</span>`;
  $("config-yaml").value = draft.yaml || "";
  $("config-commands").innerHTML = draft.commands
    ? Object.entries(draft.commands).map(([name, command]) => (
        `<dt>${escapeHtml(name)}</dt><dd><span class="command-line"><span class="mono">${escapeHtml(command)}</span><button type="button" class="secondary copy-command" data-command="${escapeHtml(command)}">Copy</button></span></dd>`
      )).join("")
    : "";
  renderConfigAlignment(draft.alignment || {});
}

function configFieldLabel(path) {
  const selectedPlugin = selectedConfigPlugin();
  const strategyMatch = String(path || "").match(/^strategy\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (strategyMatch) {
    const field = (selectedPlugin.strategy_fields || []).find((item) => item.name === strategyMatch[1]);
    return field ? text(field.label || field.name) : `Strategy ${strategyMatch[1]}`;
  }
  const formField = ((state.configOptions || {}).form_schema || []).find((field) => field.name === path || field.id === path);
  return formField ? text(formField.label || formField.name || formField.id) : text(path);
}

function configErrorPath(message) {
  const raw = String(message || "");
  const strategyMatch = raw.match(/\bstrategy\.([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (strategyMatch) return `strategy.${strategyMatch[1]}`;
  const pathMatch = raw.match(/\b(metadata|data|runner|account|risk|costs|session|execution)\.([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (pathMatch) return `${pathMatch[1]}.${pathMatch[2]}`;
  if (/plugin/i.test(raw)) return "plugin";
  if (/dataset|data|quality|alignment|timestamp|file/i.test(raw)) return "data";
  if (/risk|order|notional|exposure|cash|quantity/i.test(raw)) return "risk";
  if (/session|timezone|weekday/i.test(raw)) return "session";
  if (/runner|output|mode/i.test(raw)) return "runner";
  return "draft";
}

function normalizeConfigDraftErrors(errorOrMessages) {
  const rawMessages = Array.isArray(errorOrMessages)
    ? errorOrMessages
    : [errorOrMessages && errorOrMessages.message ? errorOrMessages.message : errorOrMessages];
  const normalized = [];
  for (const raw of rawMessages) {
    const withoutStatus = String(raw || "")
      .replace(/^\d{3}\s+[A-Za-z ]+:\s*/, "")
      .trim();
    for (const part of withoutStatus.split(/\s*;\s*/)) {
      const message = part.trim();
      if (message && !normalized.includes(message)) normalized.push(message);
    }
  }
  return normalized;
}

function validationMessageGroups() {
  const messages = normalizeConfigDraftErrors(state.configDraftErrors || []);
  const groups = new Map();
  for (const message of messages) {
    const path = configErrorPath(message);
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(message);
  }
  return Array.from(groups.entries()).map(([path, messagesForPath]) => ({ path, messages: messagesForPath }));
}

function clearFieldValidationMessages() {
  for (const label of document.querySelectorAll(".field-has-error")) {
    label.classList.remove("field-has-error");
  }
  for (const item of document.querySelectorAll(".field-validation-message")) {
    item.textContent = "";
    item.hidden = true;
  }
}

function renderFieldValidationMessages(groups) {
  clearFieldValidationMessages();
  for (const group of groups) {
    const messageEl = Array.from(document.querySelectorAll(".field-validation-message"))
      .find((item) => item instanceof HTMLElement && item.dataset.fieldErrorFor === group.path);
    if (!(messageEl instanceof HTMLElement)) continue;
    messageEl.textContent = group.messages.join("; ");
    messageEl.hidden = false;
    const label = messageEl.closest("label");
    if (label) label.classList.add("field-has-error");
  }
}

function renderConfigValidationMessages() {
  if (!$("config-validation-messages") || !$("config-validation-message-note")) return;
  const groups = validationMessageGroups();
  renderFieldValidationMessages(groups);
  const total = groups.reduce((count, group) => count + group.messages.length, 0);
  $("config-validation-message-note").textContent = total
    ? `${numberText(total, 0)} message${total === 1 ? "" : "s"} from draft validation`
    : "No validation messages";
  $("config-validation-messages").innerHTML = groups.length
    ? groups.map((group) => `
        <div class="validation-message-card">
          <span>${escapeHtml(group.path)}</span>
          <strong>${escapeHtml(configFieldLabel(group.path))}</strong>
          <small>${escapeHtml(group.messages.join("; "))}</small>
        </div>
      `).join("")
    : `<div class="empty-card"><span>Ready</span><strong>No Draft Errors</strong><small>Generate a draft to run server-side validation for selected data and plugin fields.</small></div>`;
}

function handleConfigDraftError(error) {
  state.configDraft = null;
  state.configDraftErrors = normalizeConfigDraftErrors(error);
  renderConfigBuilder();
  $("last-refresh").textContent = `Config draft failed: ${error.message}`;
}

function renderConfigBuilderReadiness() {
  if (!$("config-builder-readiness")) return;
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const plugin = selectedConfigPlugin();
  const mode = $("config-mode") ? $("config-mode").value : "";
  const dateRange = configDateRangePayload();
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const riskValues = [
    finiteNumber($("config-max-orders") && $("config-max-orders").value),
    finiteNumber($("config-max-notional") && $("config-max-notional").value),
    finiteNumber($("config-max-exposure") && $("config-max-exposure").value),
  ];
  const costValues = [
    finiteNumber($("config-slippage") && $("config-slippage").value),
    finiteNumber($("config-commission") && $("config-commission").value),
  ];
  const draft = state.configDraft || {};
  const draftValid = draft.validation ? Boolean(draft.validation.valid) : false;
  const cards = [
    {
      status: dataReadiness.status,
      title: numberText(selected.length, 0),
      label: "Data",
      note: selected.length
        ? dataReadiness.issueCount
          ? dataReadiness.reviewNote
          : "Selected datasets pass catalog quality and metadata checks."
        : "Choose one or more Data Library files.",
    },
    {
      status: alignment.dataset_count ? Number(alignment.warning_count || 0) ? "warn" : "ok" : selected.length ? "warn" : "bad",
      title: alignment.dataset_count ? numberText(alignment.common_timestamp_count, 0) : "Preview",
      label: "Alignment",
      note: alignment.dataset_count
        ? `${numberText(alignment.dataset_count, 0)} dataset${alignment.dataset_count === 1 ? "" : "s"}; ${pctText(alignment.common_coverage_pct)} common coverage.`
        : "Preview alignment before trusting a replay window.",
    },
    {
      status: plugin.id ? plugin.visibility === "public_example" ? "warn" : "ok" : "bad",
      title: text(plugin.label || plugin.id),
      label: "Plugin",
      note: plugin.visibility === "public_example"
        ? "Public example plugin demonstrates wiring only."
        : text(plugin.boundary || "Private/local plugin metadata loaded from registry."),
    },
    {
      status: mode ? "ok" : "bad",
      title: text(mode),
      label: "Mode",
      note: dateRange.start || dateRange.end
        ? `Range ${dateRange.start || "first bar"} to ${dateRange.end || "last bar"}.`
        : "No date range set; replay uses each selected file's full history.",
    },
    {
      status: riskValues.every((value) => value !== null && value > 0) ? "ok" : "bad",
      title: text($("config-risk-preset") && $("config-risk-preset").value),
      label: "Risk",
      note: `Orders ${text($("config-max-orders") && $("config-max-orders").value)}, notional ${money($("config-max-notional") && $("config-max-notional").value)}, exposure ${pctText(Number($("config-max-exposure") && $("config-max-exposure").value) * 100)}.`,
    },
    {
      status: costValues.every((value) => value !== null && value >= 0) ? "ok" : "bad",
      title: `${numberText($("config-slippage") && $("config-slippage").value, 2)} / ${numberText($("config-commission") && $("config-commission").value, 2)}`,
      label: "Costs",
      note: "Simulated slippage and commission basis points.",
    },
    {
      status: draft.yaml ? draftValid ? "ok" : "warn" : "bad",
      title: draft.yaml ? draftValid ? "Valid" : "Review" : "Not Generated",
      label: "Draft",
      note: draft.yaml
        ? draft.saved_path ? `Saved to ${text(draft.saved_path)}.` : "Generated draft is not saved."
        : "Generate a draft to get YAML and local commands.",
    },
  ];
  $("config-builder-readiness").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderWorkbenchBuilderAssistant() {
  if (!$("workbench-builder-assistant-title") || !$("workbench-builder-assistant-cards") || !$("workbench-builder-assistant-actions")) return;
  const selected = selectedConfigDatasets();
  const plugin = selectedConfigPlugin();
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const draftErrors = normalizeConfigDraftErrors(state.configDraftErrors || []);
  const savedPath = draft.saved_path || "";
  const draftValid = draft.validation ? Boolean(draft.validation.valid) : false;
  const dataReadiness = selectedDataReadiness(selected);
  const allowQualityWarnings = $("config-allow-quality-warnings") ? $("config-allow-quality-warnings").checked : false;
  const qualityBlocked = Boolean(dataReadiness.qualityIssues.length && !allowQualityWarnings);
  const dataReviewBlocked = qualityBlocked || dataReadiness.contractIssues.length > 0;
  let title = "Select Saved Data";
  let note = "Choose one or more Data Library files before generating a replay or simulated-paper draft.";
  if (selected.length && !alignment.dataset_count) {
    title = "Preview Alignment Next";
    note = `${numberText(selected.length, 0)} dataset${selected.length === 1 ? "" : "s"} selected; preview timestamp overlap before trusting the replay window.`;
  } else if (selected.length && alignment.dataset_count && !draft.yaml) {
    title = dataReviewBlocked ? "Review Data Readiness" : "Ready To Generate Draft";
    note = dataReviewBlocked
      ? `${dataReadiness.summary}; inspect quality and storage metadata before generating.`
      : `Alignment has ${numberText(alignment.common_timestamp_count, 0)} common timestamps; generate a public-safe draft next.`;
  } else if (draft.yaml && !draftValid) {
    title = "Draft Needs Fixes";
    note = draftErrors.length ? draftErrors.join("; ") : "Generated draft is invalid; review validation messages and field highlights.";
  } else if (draftValid && !savedPath) {
    title = "Draft Valid But Unsaved";
    note = "Enable save or generate a saved draft before running it from the Run lens.";
  } else if (draftValid) {
    title = "Draft Ready To Run";
    note = `${text(savedPath)} is valid; open Run to validate saved drafts or execute replay/simulated paper.`;
  }
  $("workbench-builder-assistant-title").textContent = title;
  $("workbench-builder-assistant-note").textContent = note;
  const cards = [
    {
      status: selected.length ? dataReviewBlocked ? "warn" : "ok" : "bad",
      label: "Data",
      title: numberText(selected.length, 0),
      note: selected.length
        ? dataReadiness.issueCount ? dataReadiness.reviewNote : "Selected files are ready for review."
        : "No saved files selected.",
    },
    {
      status: plugin.id ? plugin.visibility === "public_example" ? "warn" : "ok" : "bad",
      label: "Plugin",
      title: text(plugin.label || plugin.id),
      note: plugin.id ? text(plugin.visibility || plugin.boundary || "registry loaded") : "No plugin selected.",
    },
    {
      status: alignment.dataset_count ? Number(alignment.warning_count || 0) ? "warn" : "ok" : selected.length ? "warn" : "bad",
      label: "Alignment",
      title: alignment.dataset_count ? numberText(alignment.common_timestamp_count, 0) : "Preview",
      note: alignment.dataset_count ? `${pctText(alignment.common_coverage_pct)} common coverage.` : "Alignment has not been previewed.",
    },
    {
      status: draft.yaml ? draftValid ? "ok" : "bad" : "warn",
      label: "Draft",
      title: draft.yaml ? draftValid ? "Valid" : "Invalid" : "None",
      note: draft.yaml ? savedPath ? "Saved draft path exists." : "Generated draft is not saved." : "Generate YAML and local commands.",
    },
    {
      status: draftValid && savedPath ? "ok" : draftValid ? "warn" : "bad",
      label: "Run",
      title: draftValid && savedPath ? "Ready" : "Not Ready",
      note: draftValid && savedPath ? "Open Run to execute or validate saved drafts." : "Run requires a valid saved draft.",
    },
  ];
  $("workbench-builder-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const actions = [
    {
      action: "data",
      title: selected.length ? "Change Selected Data" : "Select Data",
      note: selected.length ? "Open Data Library to add or replace saved files." : "Browse saved historical datasets.",
      label: "Data",
      disabled: false,
    },
    {
      action: "alignment",
      title: "Preview Alignment",
      note: selected.length ? "Check common timestamps across selected files." : "Select data before previewing alignment.",
      label: "Preview",
      disabled: !selected.length,
    },
    {
      action: draft.yaml && !draftValid ? "preview-draft" : "generate",
      title: draft.yaml && !draftValid ? "Preview Draft Again" : "Generate Draft",
      note: selected.length && plugin.id ? "Build YAML and server-side validation output." : "Select data and plugin before generating.",
      label: draft.yaml && !draftValid ? "Preview" : "Generate",
      disabled: !selected.length || !plugin.id,
    },
    {
      action: "run",
      title: "Open Run",
      note: draftValid && savedPath ? "Run or validate the saved draft." : "Generate and save a valid draft first.",
      label: "Run",
      disabled: !(draftValid && savedPath),
    },
  ];
  $("workbench-builder-assistant-actions").innerHTML = actions.map((action) => `
    <button type="button" class="workbench-builder-assistant-action ${action.disabled ? "secondary" : ""}" data-workbench-builder-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.note)}</small>
      </span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

function handleWorkbenchBuilderAssistantAction(action) {
  if (action === "data") {
    navigateToDataLens("browse");
    return;
  }
  if (action === "alignment") {
    $("config-preview-alignment").click();
    return;
  }
  if (action === "preview-draft") {
    $("config-preview-draft").click();
    return;
  }
  if (action === "run") {
    navigateToWorkbenchLens("run");
    return;
  }
  $("config-generate-draft").click();
}

function selectedRunDraft() {
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  return ((state.configDrafts && state.configDrafts.drafts) || [])
    .find((draft) => draft.draft_id === selectedDraftId) || null;
}

function selectedRunDraftValidation() {
  const draft = selectedRunDraft();
  return draft ? draftValidationById()[draft.draft_id] || null : null;
}

function selectedRunDraftCommands() {
  const draft = selectedRunDraft();
  if (!draft || !draft.path) return {};
  const configPath = shellQuote(draft.path);
  const maxSteps = finiteNumber($("config-run-max-steps") && $("config-run-max-steps").value);
  const maxStepsArg = maxSteps !== null && maxSteps > 0 ? ` --max-steps ${Math.round(maxSteps)}` : "";
  return {
    validate: `python3 live/plugin_runner.py --config ${configPath} --validate-only`,
    replay: `python3 live/plugin_runner.py --config ${configPath} --mode replay${maxStepsArg}`,
    simulated_paper: `python3 live/plugin_runner.py --config ${configPath} --mode simulated-paper${maxStepsArg}`,
  };
}

function runCommandBoundaryNote(action) {
  if (action === "validate") return "Validation only; imports the plugin and checks config without replaying bars or submitting orders.";
  if (action === "replay") return "Replay only; evaluates saved bars and writes artifacts without broker orders.";
  if (action === "simulated_paper") return "Local simulated paper; uses runner accounting and artifacts without touching a broker.";
  return "Choose validate, replay, or simulated paper before running a saved draft.";
}

function renderWorkbenchRunCommands() {
  if (!$("workbench-run-command-note") || !$("workbench-run-commands") || !$("workbench-run-command-cards")) return;
  const draft = selectedRunDraft();
  const commands = selectedRunDraftCommands();
  const validation = selectedRunDraftValidation();
  const runAction = $("config-run-action") ? $("config-run-action").value : "";
  const commandEntries = Object.entries(commands);
  $("workbench-run-command-note").textContent = draft
    ? `${text(draft.draft_id)} local commands${validation ? validation.valid ? " / validation passed" : " / validation failed" : " / validation unchecked"}`
    : "Select a saved draft to copy local plugin-runner commands.";
  const cards = [
    {
      status: draft ? "ok" : "bad",
      title: draft ? text(draft.draft_id) : "No draft",
      label: "Selected Draft",
      note: draft && draft.path ? `Local YAML: ${text(draft.path)}` : "Generate and save a draft before running.",
    },
    {
      status: validation ? validation.valid ? "ok" : "bad" : draft ? "warn" : "waiting",
      title: validation ? validation.valid ? "Passed" : "Failed" : "Unchecked",
      label: "Validation",
      note: validation
        ? validation.valid
          ? "The saved draft passed server validation."
          : "Fix validation errors before trusting a replay or simulated-paper run."
        : "Run Validate Drafts or choose validate before replaying.",
    },
    {
      status: commands[runAction] ? "ok" : draft ? "warn" : "waiting",
      title: text(runAction || "n/a"),
      label: "Selected Action",
      note: commands[runAction]
        ? "The highlighted command below matches the Run form action."
        : "Choose an available local plugin-runner action.",
    },
    {
      status: runAction === "validate" || runAction === "replay" ? "ok" : runAction === "simulated_paper" ? "warn" : "waiting",
      title: runAction === "validate" || runAction === "replay" ? "No broker orders" : runAction === "simulated_paper" ? "Simulated only" : "Choose action",
      label: "Boundary",
      note: runCommandBoundaryNote(runAction),
    },
  ];
  $("workbench-run-command-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-run-commands").innerHTML = commandEntries.length
    ? commandEntries.map(([name, command]) => {
        const recommended = (runAction === "validate" && name === "validate")
          || (runAction === "replay" && name === "replay")
          || (runAction === "simulated_paper" && name === "simulated_paper");
        const label = recommended ? `${name} (selected)` : name;
        return `<dt>${escapeHtml(label)}</dt><dd><span class="command-line"><span class="mono">${escapeHtml(command)}</span><button type="button" class="secondary copy-run-command" data-command="${escapeHtml(command)}">Copy</button></span></dd>`;
      }).join("")
    : `<dt>Next</dt><dd><span class="muted">Generate and save a draft in Builder, then select it here.</span></dd>`;
}

function configCompatibilityNext(cards) {
  const blocked = cards.find((card) => card.status === "bad");
  if (blocked) return blocked.next;
  const warning = cards.find((card) => card.status === "warn");
  if (warning) return warning.next;
  return "Ready to validate or run the selected draft with the configured public-safe runner.";
}

function renderConfigCompatibility() {
  if (!$("config-compatibility-cards") || !$("config-compatibility-note") || !$("config-compatibility-detail")) return;
  const options = state.configOptions || {};
  const selected = selectedConfigDatasets();
  const plugin = selectedConfigPlugin();
  const visibility = plugin.visibility || plugin.status || "";
  const strategyFields = plugin.strategy_fields || [];
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const qualityIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.quality_status).toLowerCase()));
  const contractIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.storage_contract_status).toLowerCase()));
  const allowQualityWarnings = $("config-allow-quality-warnings") ? $("config-allow-quality-warnings").checked : false;
  const barSizes = Array.from(new Set(selected.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a")));
  const sources = Array.from(new Set(selected.map((dataset) => text(dataset.source)).filter((value) => value !== "n/a")));
  const schemasPresent = [
    options.config_schema_version,
    options.form_schema_version,
    options.guide_schema_version,
  ].every((value) => finiteNumber(value) !== null);
  const generatedDraft = state.configDraft || {};
  const generatedValid = generatedDraft.validation ? Boolean(generatedDraft.validation.valid) : null;
  const savedDraft = selectedRunDraft();
  const savedValidation = selectedRunDraftValidation();
  const runAction = $("config-run-action") ? $("config-run-action").value : "";
  const alignmentWarnings = Number(alignment.warning_count || (alignment.warnings || []).length || 0);
  const commonTimestamps = Number(alignment.common_timestamp_count || 0);
  const cards = [
    {
      status: schemasPresent ? "ok" : "bad",
      title: `v${text(options.config_schema_version)} / form v${text(options.form_schema_version)}`,
      label: "Schema",
      note: `Guide v${text(options.guide_schema_version)}; ${numberText((options.form_schema || []).length, 0)} fields.`,
      next: "Refresh the dashboard server so config_options includes all schema versions.",
    },
    {
      status: plugin.id ? visibility === "public_example" ? "warn" : "ok" : "bad",
      title: text(plugin.label || plugin.id),
      label: "Plugin",
      note: `${text(visibility)}; ${numberText(strategyFields.length, 0)} public-safe field${strategyFields.length === 1 ? "" : "s"}.`,
      next: plugin.id
        ? "Public examples prove wiring only; choose an ignored local plugin registry entry for real private logic."
        : "Choose a configured Workbench plugin.",
    },
    {
      status: !selected.length ? "bad" : contractIssues.some((dataset) => text(dataset.storage_contract_status).toLowerCase() === "bad") ? "bad" : (qualityIssues.length && !allowQualityWarnings) || contractIssues.length ? "warn" : "ok",
      title: selected.length ? numberText(selected.length, 0) : "None",
      label: "Data",
      note: selected.length
        ? `${barSizes.join(", ") || "unknown bars"} from ${sources.join(", ") || "unknown source"}; ${numberText(qualityIssues.length, 0)} quality / ${numberText(contractIssues.length, 0)} contract issue${contractIssues.length === 1 ? "" : "s"}.`
        : "No saved datasets selected.",
      next: selected.length
        ? "Review Selected Data Quality and storage-contract metadata before trusting a replay draft."
        : "Choose one or more scanned saved-data files.",
    },
    {
      status: alignment.dataset_count
        ? commonTimestamps > 0 ? alignmentWarnings ? "warn" : "ok" : "bad"
        : selected.length ? "warn" : "bad",
      title: alignment.dataset_count ? numberText(commonTimestamps, 0) : "Preview",
      label: "Alignment",
      note: alignment.dataset_count
        ? `${pctText(alignment.common_coverage_pct)} common coverage; ${numberText(alignmentWarnings, 0)} warning${alignmentWarnings === 1 ? "" : "s"}.`
        : "Alignment has not been previewed for the selected files.",
      next: alignment.dataset_count
        ? "Fix date ranges or dataset choices until the replay window has common timestamps."
        : "Preview alignment before generating or trusting a replay draft.",
    },
    {
      status: generatedDraft.yaml ? generatedValid ? "ok" : "bad" : savedDraft ? savedValidation ? savedValidation.valid ? "ok" : "bad" : "warn" : "warn",
      title: generatedDraft.yaml ? generatedValid ? "Generated Valid" : "Generated Invalid" : savedDraft ? text(savedDraft.draft_id) : "No Draft",
      label: "Draft",
      note: generatedDraft.yaml
        ? generatedDraft.saved_path ? "Current generated YAML is saved locally." : "Current generated YAML is not saved locally."
        : savedDraft
          ? savedValidation ? savedValidation.valid ? "Selected saved draft passed validation." : "Selected saved draft has validation errors." : "Selected saved draft has not been validated in this session."
          : "No generated or selected saved draft is ready.",
      next: generatedDraft.yaml
        ? generatedValid ? "Save and run the draft, or inspect the generated local commands." : "Fix generated draft validation errors before running."
        : savedDraft ? "Click Validate Drafts, then run the selected draft." : "Generate and save a draft from the selected data.",
    },
    {
      status: savedDraft && runAction ? savedValidation ? savedValidation.valid ? "ok" : "bad" : "warn" : "warn",
      title: runAction || "No Action",
      label: "Run",
      note: savedDraft
        ? `${text(savedDraft.mode)} draft selected; action=${text(runAction)}.`
        : "No saved draft is selected in Run Draft.",
      next: savedDraft
        ? "Validate the selected draft before running replay or simulated paper."
        : "Save a generated draft, then select it under Run Draft.",
    },
  ];
  $("config-compatibility-note").textContent = configCompatibilityNext(cards);
  $("config-compatibility-cards").innerHTML = cards.map((card) => `
    <div class="health-card compatibility-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const detailPairs = [
    ["Schema Versions", `config=${text(options.config_schema_version)}, form=${text(options.form_schema_version)}, guide=${text(options.guide_schema_version)}`],
    ["Plugin Spec", text(plugin.spec)],
    ["Plugin Registry Paths", (options.plugin_registry_paths || []).join("; ") || "none"],
    ["Strategy Fields", strategyFields.length ? strategyFields.map((field) => `${field.name}:${field.kind}`).join(", ") : "none"],
    ["Selected Bar Sizes", barSizes.join(", ") || "none"],
    ["Selected Sources", sources.join(", ") || "none"],
    ["Selected Contract Issues", contractIssues.length ? contractIssues.map((dataset) => `${text(dataset.symbol)} ${text(dataset.bar_size)} ${text(dataset.storage_contract_status)}`).join("; ") : "none"],
    ["Selected Paths", selected.map((dataset) => dataset.path).join("\n") || "none"],
    ["Alignment Window", alignment.dataset_count ? rangeLabel(alignment.common_first_timestamp, alignment.common_last_timestamp) : "not previewed"],
    ["Saved Draft Validation", savedDraft ? savedValidation ? savedValidation.valid ? "valid" : `invalid: ${(savedValidation.errors || []).join("; ")}` : "not checked" : "no saved draft selected"],
    ["Next Action", configCompatibilityNext(cards)],
  ];
  $("config-compatibility-detail").innerHTML = detailPairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
}

function renderConfigLivePanels() {
  renderConfigDataQuality();
  updatePluginStrategyFields();
  renderWorkbenchPluginBoundary();
  renderConfigPluginBoundary();
  renderConfigPluginFieldHelp();
  renderWorkbenchBuilderAssistant();
  renderConfigBuilderReadiness();
  renderConfigCompatibility();
  renderWorkbenchGuide();
}

function configPluginStrategyPayload() {
  const payload = {};
  const selectedPluginId = $("config-plugin") ? $("config-plugin").value : "";
  const fields = ((state.configOptions || {}).form_schema || [])
    .filter((field) => field.plugin_id === selectedPluginId);
  for (const field of fields) {
    const el = $(field.id);
    if (!el) continue;
    payload[field.name] = field.kind === "checkbox" ? el.checked : el.value;
  }
  return payload;
}

function renderConfigAlignment(alignment) {
  const warnings = alignment.warnings || [];
  $("config-alignment-note").innerHTML = alignment.dataset_count
    ? warnings.length
      ? `<span class="status-warn">${warnings.length} warning${warnings.length === 1 ? "" : "s"}</span>`
      : `<span class="status-ok">aligned</span>`
    : "Select datasets, then preview alignment";
  if (!alignment.dataset_count) {
    $("config-alignment").innerHTML = `<dt>Next</dt><dd>Select one or more datasets and click Preview Alignment before generating a runnable draft.</dd>`;
    renderWorkbenchGuide();
    return;
  }
  const rows = alignment.rows || [];
  const symbolSummary = rows.map((item) => (
    `${text(item.symbol)} quality=${text(item.quality_status)} quality_warnings=${numberText(item.quality_warning_count, 0)} rows=${numberText(item.rows, 0)} ts=${numberText(item.timestamp_count, 0)} step=${interval(item.median_interval_seconds)}`
  )).join("; ");
  const pairs = [
    ["Datasets", numberText(alignment.dataset_count, 0)],
    ["Symbols", (alignment.symbols || []).join(", ")],
    ["Filter Range", alignment.filter_start || alignment.filter_end ? timeRangeLabel(alignment.filter_start, alignment.filter_end) : "Full file history"],
    ["Common Timestamps", numberText(alignment.common_timestamp_count, 0)],
    ["Union Timestamps", numberText(alignment.union_timestamp_count, 0)],
    ["Common Coverage", pctText(alignment.common_coverage_pct)],
    ["Common Range", rangeLabel(alignment.common_first_timestamp, alignment.common_last_timestamp)],
    ["Warnings", warnings.length ? warnings.join("; ") : "none"],
    ["Per Symbol", symbolSummary || "n/a"],
  ];
  $("config-alignment").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  renderConfigBuilderReadiness();
  renderConfigCompatibility();
  renderWorkbenchGuide();
}

function draftValidationById() {
  const rows = (state.draftValidations && state.draftValidations.validations) || [];
  return Object.fromEntries(rows.map((rowItem) => [rowItem.draft_id, rowItem]));
}

function draftValidationBadge(draftId) {
  const validation = draftValidationById()[draftId];
  if (!validation) return `<span class="muted">not checked</span>`;
  if (validation.valid) return statusText("ok");
  const errors = validation.errors || [];
  const suffix = errors.length ? ` (${errors.length})` : "";
  const title = errors.length ? ` title="${escapeHtml(errors.join("; "))}"` : "";
  return `<span class="status-bad"${title}>invalid${escapeHtml(suffix)}</span>`;
}

function renderDraftValidations() {
  const payload = state.draftValidations || {};
  const rows = payload.validations || [];
  const invalid = rows.filter((rowItem) => !rowItem.valid);
  const pairs = [
    ["Checked", text(payload.generated_at)],
    ["Drafts", numberText(payload.count, 0)],
    ["Valid", numberText(payload.valid_count, 0)],
    ["Invalid", numberText(payload.invalid_count, 0)],
  ];
  if (invalid.length) {
    pairs.push([
      "Errors",
      invalid.map((rowItem) => (
        `${rowItem.draft_id}: ${(rowItem.errors || []).join("; ")}`
      )).join("\n"),
    ]);
  }
  $("config-draft-validations").innerHTML = rows.length || payload.generated_at
    ? pairs.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd><span class="mono">${escapeHtml(value)}</span></dd>`).join("")
    : `<dt>Next</dt><dd><span class="muted">Save a generated draft locally, then click Validate Drafts.</span></dd>`;
}

function renderWorkbenchTriage() {
  if (!$("workbench-triage-cards") || !$("workbench-triage-note")) return;
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const runs = (state.configRuns && state.configRuns.runs) || [];
  const validations = (state.draftValidations && state.draftValidations.validations) || [];
  const validationByDraft = draftValidationById();
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  const selectedDraft = drafts.find((draft) => draft.draft_id === selectedDraftId) || null;
  const selectedValidation = selectedDraftId ? validationByDraft[selectedDraftId] : null;
  const latestRun = latestWorkbenchRunForDraft(selectedDraftId);
  const artifacts = state.configArtifacts || {};
  const invalidCount = validations.filter((item) => !item.valid).length;
  const uncheckedCount = drafts.filter((draft) => !validationByDraft[draft.draft_id]).length;
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "timeout");
  const completedRuns = runs.filter((run) => run.status === "completed");
  const selectedHasArtifacts = Boolean(latestRun && latestRun.artifact_path);
  let nextStatus = "bad";
  let nextTitle = "Generate";
  let nextNote = "Select saved data and generate a local draft.";
  if (selectedDraft) {
    if (!selectedValidation) {
      nextStatus = "warn";
      nextTitle = "Validate";
      nextNote = `${selectedDraft.draft_id} has not been checked in this session.`;
    } else if (!selectedValidation.valid) {
      nextStatus = "bad";
      nextTitle = "Fix Draft";
      nextNote = `${selectedDraft.draft_id} has validation errors.`;
    } else if (!latestRun) {
      nextStatus = "warn";
      nextTitle = "Run";
      nextNote = `${selectedDraft.draft_id} is valid and ready for replay or simulated paper.`;
    } else if (latestRun.status !== "completed") {
      nextStatus = "warn";
      nextTitle = "Inspect Run";
      nextNote = `${latestRun.run_id || selectedDraft.draft_id} ended with ${text(latestRun.status)}.`;
    } else if (!selectedHasArtifacts && !artifacts.run_id && !artifacts.draft_id) {
      nextStatus = "warn";
      nextTitle = "Open Results";
      nextNote = "Completed run exists; load artifacts to inspect performance.";
    } else {
      nextStatus = "ok";
      nextTitle = "Review";
      nextNote = "Artifacts are available for performance, orders, fills, and logs.";
    }
  }
  const cards = [
    {
      status: drafts.length ? uncheckedCount ? "warn" : "ok" : "bad",
      title: numberText(drafts.length, 0),
      label: "Drafts",
      note: drafts.length
        ? `${numberText(uncheckedCount, 0)} unchecked; ${numberText(invalidCount, 0)} invalid.`
        : "No saved drafts; generate one from the Config Builder.",
    },
    {
      status: validations.length ? invalidCount ? "bad" : "ok" : drafts.length ? "warn" : "bad",
      title: validations.length ? `${numberText(validations.length - invalidCount, 0)} valid` : "Not Checked",
      label: "Validation",
      note: validations.length
        ? `${numberText(validations.length, 0)} checked at ${text((state.draftValidations || {}).generated_at)}.`
        : "Click Validate Drafts before running saved configs.",
    },
    {
      status: runs.length ? failedRuns.length ? "warn" : "ok" : "bad",
      title: numberText(runs.length, 0),
      label: "Runs",
      note: runs.length
        ? `${numberText(completedRuns.length, 0)} completed; ${numberText(failedRuns.length, 0)} need log review.`
        : "No validate/replay/simulated-paper runs recorded yet.",
    },
    {
      status: selectedDraft ? selectedValidation && !selectedValidation.valid ? "bad" : "ok" : "bad",
      title: text(selectedDraftId),
      label: "Selected Draft",
      note: selectedDraft
        ? `${text(selectedDraft.status_label || selectedDraft.status)} / ${text(selectedDraft.mode)} / ${text((selectedDraft.symbols || []).join(", "))}.`
        : "Choose a saved draft in the Run form.",
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : selectedDraft ? "warn" : "bad",
      title: latestRun ? text(latestRun.status) : "No Run",
      label: "Latest",
      note: latestRun
        ? `${text(latestRun.action)} finished ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.`
        : "Run the selected draft to create comparable artifacts.",
    },
    {
      status: artifacts.run_id || artifacts.draft_id ? "ok" : selectedHasArtifacts ? "warn" : "bad",
      title: artifacts.run_id || artifacts.draft_id ? "Loaded" : selectedHasArtifacts ? "Available" : "Missing",
      label: "Artifacts",
      note: artifacts.run_id || artifacts.draft_id
        ? `${text(artifacts.draft_id)} ${artifacts.run_id ? `/ ${text(artifacts.run_id)}` : "latest output"} is loaded.`
        : selectedHasArtifacts
          ? "Open Artifacts or Results for the selected draft."
          : "No output artifacts found for the selected draft yet.",
    },
    {
      status: nextStatus,
      title: nextTitle,
      label: "Next Action",
      note: nextNote,
    },
  ];
  $("workbench-triage-note").textContent = `${numberText(drafts.length, 0)} drafts / ${numberText(runs.length, 0)} runs / ${numberText(validations.length, 0)} validations`;
  $("workbench-triage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function workbenchRunReadinessModel() {
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  const runAction = $("config-run-action") ? $("config-run-action").value : "";
  const maxSteps = finiteNumber($("config-run-max-steps") && $("config-run-max-steps").value);
  const timeoutSeconds = finiteNumber($("config-run-timeout") && $("config-run-timeout").value);
  const selectedDraft = selectedRunDraft();
  const validation = selectedRunDraftValidation();
  const latestRun = latestWorkbenchRunForDraft(selectedDraftId);
  const artifacts = state.configArtifacts || {};
  const loadedSameDraft = Boolean(selectedDraftId && artifacts.draft_id && artifacts.draft_id === selectedDraftId);
  const loadedSameRun = Boolean(latestRun && artifacts.run_id && artifacts.run_id === latestRun.run_id);
  const blockers = [];
  const warnings = [];

  if (!selectedDraft) blockers.push("Select a saved draft.");
  if (!runAction) blockers.push("Choose validate, replay, or simulated paper.");
  if (selectedDraft && validation && validation.valid === false) blockers.push("Fix validation errors before running.");
  if (selectedDraft && !validation) warnings.push("Draft has not been validated in this browser session.");
  if (selectedDraft && latestRun && latestRun.status !== "completed") warnings.push(`Latest run ended with ${text(latestRun.status)}.`);
  if (runAction && runAction !== "validate" && selectedDraft && validation && validation.valid !== true) {
    warnings.push("Run Validate Drafts first for a cleaner pre-flight check.");
  }
  if (maxSteps !== null && maxSteps <= 0) blockers.push("Max steps must be positive.");
  if (timeoutSeconds !== null && timeoutSeconds <= 0) blockers.push("Timeout must be positive.");

  let status = "bad";
  let title = "Blocked";
  let note = blockers.join(" ");
  let primaryAction = "select";
  if (!blockers.length && warnings.length) {
    status = "warn";
    title = "Runnable With Review";
    note = warnings.join(" ");
    primaryAction = validation ? "run" : "validate";
  } else if (!blockers.length) {
    status = "ok";
    title = "Ready To Run";
    note = `${text(selectedDraftId)} can run ${text(runAction)} with the current settings.`;
    primaryAction = runAction && runAction !== "validate" ? "run_performance" : "run";
  } else if (selectedDraft && validation && validation.valid === false) {
    primaryAction = "validation";
  } else if (selectedDraft && !validation) {
    primaryAction = "validate";
  }

  const cards = [
    {
      status: selectedDraft ? "ok" : "bad",
      label: "Draft",
      title: selectedDraft ? text(selectedDraft.draft_id) : "Missing",
      note: selectedDraft
        ? `${text(selectedDraft.mode)} / ${(selectedDraft.symbols || []).join(", ") || "no symbols"}`
        : "Save a generated draft, then select it here.",
    },
    {
      status: validation ? validation.valid ? "ok" : "bad" : selectedDraft ? "warn" : "bad",
      label: "Validation",
      title: validation ? validation.valid ? "Valid" : "Invalid" : "Unchecked",
      note: validation
        ? validation.valid ? "Server validation passed." : (validation.errors || []).join("; ") || "Validation failed."
        : "Click Validate Drafts before replay or simulated paper.",
    },
    {
      status: runAction ? "ok" : "bad",
      label: "Action",
      title: runAction || "Missing",
      note: `Max steps ${maxSteps === null ? "default" : numberText(maxSteps, 0)}; timeout ${timeoutSeconds === null ? "default" : numberText(timeoutSeconds, 0)} seconds.`,
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : selectedDraft ? "warn" : "bad",
      label: "Latest Run",
      title: latestRun ? text(latestRun.status) : "None",
      note: latestRun
        ? `${text(latestRun.action)} ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.`
        : "No recorded run for this draft yet.",
    },
    {
      status: loadedSameRun || loadedSameDraft ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "bad",
      label: "Results",
      title: loadedSameRun || loadedSameDraft ? "Loaded" : latestRun && latestRun.artifact_path ? "Available" : "Missing",
      note: loadedSameRun || loadedSameDraft
        ? "Performance and Runs can inspect this output."
        : latestRun && latestRun.artifact_path
          ? "Open Performance to load run artifacts."
          : "Replay or simulated paper creates performance artifacts.",
    },
  ];

  const actions = [
    {
      id: "select",
      label: "Select Draft",
      enabled: true,
      secondary: primaryAction !== "select",
    },
    {
      id: "validate",
      label: "Validate Drafts",
      enabled: Boolean(selectedDraft),
      secondary: primaryAction !== "validate",
    },
    {
      id: "run",
      label: "Run Selected",
      enabled: Boolean(selectedDraft && runAction && !blockers.length),
      secondary: primaryAction !== "run",
    },
    {
      id: "run_performance",
      label: "Run + Performance",
      enabled: Boolean(selectedDraft && runAction && runAction !== "validate" && !blockers.length),
      secondary: primaryAction !== "run_performance",
    },
    {
      id: "results",
      label: "Open Results",
      enabled: Boolean(latestRun && latestRun.status === "completed" && latestRun.action !== "validate"),
      secondary: true,
    },
  ];

  return { status, title, note, blockers, warnings, cards, actions };
}

function renderWorkbenchRunReadiness() {
  if (!$("workbench-run-readiness-note") || !$("workbench-run-readiness-cards") || !$("workbench-run-readiness-actions")) return;
  const model = workbenchRunReadinessModel();
  const suffix = model.blockers.length
    ? `${numberText(model.blockers.length, 0)} blocker${model.blockers.length === 1 ? "" : "s"}`
    : model.warnings.length
      ? `${numberText(model.warnings.length, 0)} warning${model.warnings.length === 1 ? "" : "s"}`
      : "ready";
  $("workbench-run-readiness-note").innerHTML = `<span class="${escapeHtml(statusClass(model.status))}">${escapeHtml(model.title)}</span> - ${escapeHtml(suffix)}. ${escapeHtml(model.note)}`;
  $("workbench-run-readiness-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-run-readiness-actions").innerHTML = model.actions.map((action) => `
    <button
      type="button"
      class="${action.secondary ? "secondary " : ""}workbench-run-readiness-action"
      data-run-readiness-action="${escapeHtml(action.id)}"
      ${action.enabled ? "" : "disabled"}
    >${escapeHtml(action.label)}</button>
  `).join("");
}

function handleWorkbenchRunReadinessAction(action) {
  if (action === "select") {
    const element = $("config-run-draft");
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      if (typeof element.focus === "function") element.focus({ preventScroll: true });
    }
    return;
  }
  if (action === "validate" && $("validate-drafts") instanceof HTMLButtonElement && !$("validate-drafts").disabled) {
    $("validate-drafts").click();
    return;
  }
  if (action === "run" && $("config-run-form")) {
    $("config-run-form").requestSubmit();
    return;
  }
  if (action === "run_performance") {
    runConfigDraft(null, { openPerformance: true }).catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
    return;
  }
  if (action === "results") {
    openWorkbenchResultPerformance().catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  }
}

function workbenchResultModel() {
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  const selectedDraft = selectedRunDraft();
  const validation = selectedRunDraftValidation();
  const latestRun = latestWorkbenchRunForDraft(selectedDraftId);
  const summary = (latestRun && latestRun.summary) || {};
  const artifacts = state.configArtifacts || {};
  const loadedSameRun = Boolean(latestRun && artifacts.run_id && artifacts.run_id === latestRun.run_id);
  const loadedSameDraft = Boolean(selectedDraftId && artifacts.draft_id && artifacts.draft_id === selectedDraftId);
  let status = "bad";
  let title = "Select Draft";
  let note = "Choose a saved draft, validate it, then run replay or simulated paper.";
  if (selectedDraft) {
    status = validation && validation.valid === false ? "bad" : "warn";
    title = latestRun ? text(latestRun.status) : "Ready To Run";
    note = latestRun
      ? `${text(latestRun.action)} finished ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.`
      : `${selectedDraft.draft_id} is selected; run validate, replay, or simulated paper.`;
  }
  if (latestRun) {
    if (latestRun.status === "failed" || latestRun.status === "timeout") {
      status = "bad";
      title = "Review Log";
      note = `${latestRun.run_id || selectedDraftId} ended with ${text(latestRun.status)}. Open the log before trusting outputs.`;
    } else if (latestRun.action === "validate") {
      status = latestRun.status === "completed" ? "ok" : "warn";
      title = "Validated";
      note = "Validation finished; choose replay or simulated paper to create performance artifacts.";
    } else if (loadedSameRun || loadedSameDraft) {
      status = "ok";
      title = "Results Loaded";
      note = "Artifacts are loaded. Open Performance for charts or Runs for the session timeline.";
    } else if (latestRun.artifact_path) {
      status = latestRun.status === "completed" ? "warn" : "bad";
      title = "Open Results";
      note = "A completed run has artifacts available; load results to inspect equity, orders, fills, and logs.";
    } else if (latestRun.status === "completed") {
      status = "warn";
      title = "Find Outputs";
      note = "The latest run completed but no explicit artifact path was reported. Try loading the draft's latest output.";
    }
  }
  const hasRun = Boolean(latestRun);
  const canOpenPerformance = Boolean(selectedDraftId && latestRun && latestRun.action !== "validate" && latestRun.status === "completed");
  const cards = [
    {
      status: selectedDraft ? validation && validation.valid === false ? "bad" : "ok" : "bad",
      label: "Selected Draft",
      title: selectedDraft ? text(selectedDraft.draft_id) : "None",
      note: selectedDraft ? `${text(selectedDraft.mode)} / ${(selectedDraft.symbols || []).join(", ") || "no symbols"}` : "Select a saved draft in Run Draft.",
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : selectedDraft ? "warn" : "bad",
      label: "Latest Run",
      title: latestRun ? text(latestRun.action) : "None",
      note: latestRun ? `${text(latestRun.run_id)} / ${text(latestRun.status)}` : "No run recorded for the selected draft.",
    },
    {
      status: loadedSameRun || loadedSameDraft ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "bad",
      label: "Artifacts",
      title: loadedSameRun || loadedSameDraft ? "Loaded" : latestRun && latestRun.artifact_path ? "Available" : "Missing",
      note: loadedSameRun || loadedSameDraft
        ? `${text(artifacts.draft_id)} ${artifacts.run_id ? `/ ${text(artifacts.run_id)}` : "latest output"}.`
        : latestRun && latestRun.artifact_path
          ? "Click Open Performance to load charts."
          : "No artifact path is visible for this run.",
    },
    {
      status: latestRun && latestRun.status === "completed" ? "ok" : latestRun ? "warn" : "bad",
      label: "Activity",
      title: latestRun ? `${numberText(summary.fills, 0)} fills` : "n/a",
      note: latestRun
        ? `${numberText(summary.decisions, 0)} decisions / ${numberText(summary.rejections, 0)} rejects.`
        : "Run a draft to summarize decisions, fills, and rejects.",
    },
  ];
  return {
    status,
    title,
    note,
    selectedDraftId,
    latestRun,
    hasRun,
    canOpenPerformance,
    cards,
  };
}

function renderWorkbenchRunResult() {
  if (!$("workbench-result-title") || !$("workbench-result-tiles")) return;
  const model = workbenchResultModel();
  $("workbench-result-title").textContent = model.title;
  $("workbench-result-title").className = statusClass(model.status);
  $("workbench-result-note").textContent = model.note;
  $("workbench-result-open-performance").disabled = !model.canOpenPerformance;
  $("workbench-result-open-runs").disabled = !model.hasRun;
  $("workbench-result-open-log").disabled = !model.hasRun;
  $("workbench-result-tiles").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function applyRiskPreset() {
  if (!$("config-risk-preset")) return;
  const presetId = $("config-risk-preset").value;
  const preset = (state.configOptions.risk_presets || []).find((item) => item.id === presetId);
  const values = preset && preset.values ? preset.values : {};
  const fieldMap = {
    "config-max-orders": values.max_orders_per_run,
    "config-max-notional": values.max_notional_per_order,
    "config-max-quantity": values.max_quantity,
    "config-max-cash": values.max_cash_quantity,
    "config-max-exposure": values.max_gross_exposure_pct,
    "config-slippage": values.sim_slippage_bps,
    "config-commission": values.sim_commission_bps,
  };
  for (const [id, value] of Object.entries(fieldMap)) {
    if ($(id) && value !== undefined) {
      $(`${id}`).value = String(value);
    }
  }
}

function renderWorkbenchRuns() {
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  renderDraftValidations();
  renderWorkbenchHome();
  renderWorkbenchGuide();
  renderWorkbenchRunReadiness();
  renderWorkbenchRunCommands();
  renderWorkbenchTriage();
  renderWorkbenchRunResult();
  $("config-drafts-body").innerHTML = drafts.length
    ? drafts.map((draft) => row([
        escapeHtml(draft.draft_id),
        escapeHtml(draft.folder),
        statusText(draft.status_label || draft.status || "unknown"),
        escapeHtml(draft.mode),
        escapeHtml((draft.symbols || []).join(", ")),
        escapeHtml((draft.tags || []).join(", ") || "none"),
        escapeHtml(draft.modified_at),
        draftValidationBadge(draft.draft_id),
        `<span class="mono">${escapeHtml(draft.output_dir)}</span>`,
        `<span class="button-pair"><button type="button" class="secondary inspect-draft-detail" data-draft-id="${escapeHtml(draft.draft_id)}">YAML</button><button type="button" class="secondary download-draft-yaml" data-draft-id="${escapeHtml(draft.draft_id)}">Download</button><button type="button" class="secondary inspect-draft" data-draft-id="${escapeHtml(draft.draft_id)}">Artifacts</button><button type="button" class="secondary open-draft-performance" data-draft-id="${escapeHtml(draft.draft_id)}">Results</button><button type="button" class="secondary delete-draft" data-draft-id="${escapeHtml(draft.draft_id)}">Delete</button></span>`,
      ])).join("")
    : row([`<span class="muted">No saved drafts yet. Select saved data, enable Save draft locally, then Generate.</span>`, "", "", "", "", "", "", "", "", ""]);

  const runs = (state.configRuns && state.configRuns.runs) || [];
  $("config-runs-body").innerHTML = runs.length
    ? runs.map((run) => {
        const summary = run.summary || {};
        const detail = run.stderr_tail
          ? run.stderr_tail.split("\n").slice(-2).join(" ")
          : JSON.stringify(summary || {});
        return row([
          escapeHtml(run.finished_at),
          escapeHtml(run.draft_id),
          escapeHtml(run.action),
          statusText(run.status),
          escapeHtml(run.duration_seconds),
          escapeHtml(summary.decisions),
          escapeHtml(summary.fills),
          escapeHtml(summary.rejections),
          `<span class="mono">${escapeHtml(detail)}</span>`,
          `<span class="button-pair">${
            run.artifact_path
              ? `<button type="button" class="secondary inspect-run-artifacts" data-run-id="${escapeHtml(run.run_id)}">Artifacts</button><button type="button" class="secondary open-run-performance" data-run-id="${escapeHtml(run.run_id)}">Results</button>`
              : `<button type="button" class="secondary inspect-draft" data-draft-id="${escapeHtml(run.draft_id)}">Latest</button><button type="button" class="secondary open-draft-performance" data-draft-id="${escapeHtml(run.draft_id)}">Results</button>`
          }<button type="button" class="secondary inspect-run-log" data-run-id="${escapeHtml(run.run_id)}">Log</button></span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No draft runs yet. Save a valid draft, choose validate/replay/simulated paper, then Run.</span>`, "", "", "", "", "", "", "", "", ""]);
}

function comparisonCard(title, run, value) {
  if (!run) {
    return `<div class="compare-card"><span>${escapeHtml(title)}</span><strong>n/a</strong><small>No summarized run</small></div>`;
  }
  return `
    <div class="compare-card">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(text(run.draft_id))} - ${escapeHtml(text(run.action))}</small>
    </div>
  `;
}

function renderComparisonFilterOptions(runs) {
  const makeOptions = (id, values) => {
    const select = $(id);
    const current = select.value;
    const options = Array.from(new Set(values.map(text).filter((value) => value !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) {
      select.value = current;
    }
  };
  makeOptions("comparison-filter-status", runs.map((run) => run.status));
  makeOptions("comparison-filter-action", runs.map((run) => run.action));
  makeOptions("comparison-filter-mode", runs.map((run) => run.mode));
}

function filteredComparisonRuns(runs) {
  const query = ($("comparison-filter-text").value || "").trim().toLowerCase();
  const status = $("comparison-filter-status").value || "";
  const action = $("comparison-filter-action").value || "";
  const mode = $("comparison-filter-mode").value || "";
  const summary = $("comparison-filter-summary").value || "";
  return (runs || []).filter((run) => {
    if (status && text(run.status) !== status) return false;
    if (action && text(run.action) !== action) return false;
    if (mode && text(run.mode) !== mode) return false;
    if (summary === "yes" && !run.summary_available) return false;
    if (summary === "no" && run.summary_available) return false;
    if (query) {
      const haystack = [
        run.run_id,
        run.draft_id,
        run.action,
        run.status,
        run.mode,
        run.finished_at,
        run.total_return_pct,
        run.max_drawdown_pct,
        run.fills,
        run.rejections,
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

function comparisonSortMetric(runItem, sortMode) {
  if (sortMode === "finished_desc") return Date.parse(runItem.finished_at || "");
  if (sortMode === "return_desc") return Number(runItem.total_return_pct);
  if (sortMode === "return_day_desc") return Number(runItem.return_per_day_pct);
  if (sortMode === "drawdown_asc") {
    const value = Number(runItem.max_drawdown_pct);
    return Number.isFinite(value) ? Math.abs(value) : Number.NaN;
  }
  if (sortMode === "exposure_desc") return Number(runItem.max_gross_exposure_pct);
  if (sortMode === "positions_desc") return Number(runItem.max_position_count);
  return Date.parse(runItem.finished_at || "");
}

function sortedComparisonRuns(runs) {
  const sortMode = $("comparison-sort").value || "finished_desc";
  const ascending = sortMode === "drawdown_asc";
  return (runs || []).map((runItem, index) => ({
    runItem,
    index,
    metric: comparisonSortMetric(runItem, sortMode),
  })).sort((a, b) => {
    const aFinite = Number.isFinite(a.metric);
    const bFinite = Number.isFinite(b.metric);
    if (!aFinite && !bFinite) return a.index - b.index;
    if (!aFinite) return 1;
    if (!bFinite) return -1;
    if (a.metric === b.metric) return a.index - b.index;
    return ascending ? a.metric - b.metric : b.metric - a.metric;
  }).map((item) => item.runItem);
}

function comparisonBestRun(runs, metric, { smallest = false } = {}) {
  const eligible = (runs || [])
    .map((runItem) => ({ runItem, value: finiteNumber(runItem[metric]) }))
    .filter((item) => item.value !== null);
  if (!eligible.length) return null;
  return eligible.sort((left, right) => smallest ? left.value - right.value : right.value - left.value)[0].runItem;
}

function comparisonTotal(runs, key) {
  return (runs || []).reduce((sum, runItem) => sum + Number(runItem[key] || 0), 0);
}

function renderComparisonSummaryCards(runs, allRuns) {
  if (!$("comparison-summary-cards") || !$("comparison-summary-note")) return;
  const summarized = runs.filter((runItem) => runItem.summary_available);
  const bestReturn = comparisonBestRun(summarized, "total_return_pct");
  const lowestDrawdown = comparisonBestRun(summarized, "max_drawdown_pct");
  const worstDrawdown = comparisonBestRun(summarized, "max_drawdown_pct", { smallest: true });
  const shortHorizon = summarized.filter((runItem) => runItem.short_horizon_projection).length;
  const fills = comparisonTotal(runs, "fills");
  const rejects = comparisonTotal(runs, "rejections");
  const modes = new Set(runs.map((runItem) => text(runItem.mode)).filter((value) => value !== "n/a")).size;
  const drafts = new Set(runs.map((runItem) => text(runItem.draft_id)).filter((value) => value !== "n/a")).size;
  let nextStatus = "bad";
  let nextTitle = "No Runs";
  let nextNote = "Run a Workbench replay or simulated-paper draft to create comparable summaries.";
  if (runs.length && !summarized.length) {
    nextStatus = "warn";
    nextTitle = "Need Summaries";
    nextNote = "The filtered runs exist but do not have public-safe summary artifacts.";
  } else if (rejects > 0) {
    nextStatus = "warn";
    nextTitle = "Review Rejects";
    nextNote = "Filtered runs include rejected orders; open artifacts or logs before trusting the result.";
  } else if (shortHorizon > 0) {
    nextStatus = "warn";
    nextTitle = "Short Horizon";
    nextNote = "Some filtered runs are projection-flagged; compare them as exploratory, not stable.";
  } else if (summarized.length) {
    nextStatus = "ok";
    nextTitle = "Comparable";
    nextNote = "The filtered set has summaries and no visible reject or short-horizon warnings.";
  }
  $("comparison-summary-note").textContent = `${numberText(runs.length, 0)} filtered / ${numberText(allRuns.length, 0)} total`;
  const cards = [
    {
      status: summarized.length ? "ok" : runs.length ? "warn" : "bad",
      label: "Coverage",
      title: `${numberText(summarized.length, 0)} summarized`,
      note: `${numberText(drafts, 0)} draft${drafts === 1 ? "" : "s"} / ${numberText(modes, 0)} mode${modes === 1 ? "" : "s"} in the filtered set.`,
    },
    {
      status: bestReturn ? "ok" : "bad",
      label: "Best Return",
      title: bestReturn ? pctText(bestReturn.total_return_pct) : "n/a",
      note: bestReturn ? `${text(bestReturn.draft_id)} / ${text(bestReturn.mode)} / ${text(bestReturn.run_id)}` : "No summarized return metric.",
    },
    {
      status: lowestDrawdown ? "ok" : "bad",
      label: "Lowest Drawdown",
      title: lowestDrawdown ? pctText(lowestDrawdown.max_drawdown_pct) : "n/a",
      note: lowestDrawdown ? `${text(lowestDrawdown.draft_id)} / ${text(lowestDrawdown.mode)} / ${text(lowestDrawdown.run_id)}` : "No summarized drawdown metric.",
    },
    {
      status: worstDrawdown && finiteNumber(worstDrawdown.max_drawdown_pct) < -10 ? "bad" : worstDrawdown ? "warn" : "bad",
      label: "Worst Drawdown",
      title: worstDrawdown ? pctText(worstDrawdown.max_drawdown_pct) : "n/a",
      note: worstDrawdown ? `${text(worstDrawdown.draft_id)} / ${text(worstDrawdown.mode)} / ${text(worstDrawdown.run_id)}` : "No summarized drawdown metric.",
    },
    {
      status: rejects ? "bad" : fills ? "ok" : runs.length ? "warn" : "bad",
      label: "Execution",
      title: `${numberText(fills, 0)} fills`,
      note: `${numberText(rejects, 0)} rejects across filtered runs.`,
    },
    {
      status: nextStatus,
      label: "Next Action",
      title: nextTitle,
      note: nextNote,
    },
  ];
  $("comparison-summary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderRunComparison() {
  const comparison = state.runComparison || {};
  const allRuns = comparison.runs || [];
  renderComparisonFilterOptions(allRuns);
  const runs = sortedComparisonRuns(filteredComparisonRuns(allRuns));
  const leaders = comparison.leaders || {};
  const summaryCount = Number(comparison.summary_count || 0);
  $("comparison-note").textContent = `${numberText(runs.length, 0)} shown / ${numberText(comparison.total || allRuns.length, 0)} recorded / ${summaryCount} summarized`;
  renderComparisonSummaryCards(runs, allRuns);
  $("comparison-leaders").innerHTML = [
    comparisonCard("Best Return", leaders.best_total_return, pctText((leaders.best_total_return || {}).total_return_pct)),
    comparisonCard("Best Return/day", leaders.best_return_per_day, pctText((leaders.best_return_per_day || {}).return_per_day_pct)),
    comparisonCard("Lowest Drawdown", leaders.lowest_drawdown, pctText((leaders.lowest_drawdown || {}).max_drawdown_pct)),
    `<div class="compare-card"><span>Short Horizon</span><strong>${escapeHtml(numberText(comparison.short_horizon_count || 0, 0))}</strong><small>Projection-flagged runs</small></div>`,
  ].join("");
  $("comparison-body").innerHTML = runs.length
    ? runs.map((runItem) => {
        const projection = runItem.summary_available
          ? (runItem.short_horizon_projection ? "short" : "full")
          : "n/a";
        return row([
          escapeHtml(runItem.finished_at),
          escapeHtml(runItem.draft_id),
          escapeHtml(runItem.action),
          statusText(runItem.status),
          pctText(runItem.total_return_pct),
          pctText(runItem.max_drawdown_pct),
          pctText(runItem.return_per_day_pct),
          pctText(runItem.max_gross_exposure_pct),
          escapeHtml(runItem.max_position_count),
          numberText(runItem.elapsed_days, 4),
          escapeHtml(runItem.fills),
          escapeHtml(runItem.rejections),
          escapeHtml(projection),
          `<span class="button-pair">${
            runItem.artifact_available
              ? `<button type="button" class="secondary inspect-run-artifacts" data-run-id="${escapeHtml(runItem.run_id)}">Artifacts</button>`
              : ""
          }<button type="button" class="secondary inspect-run-log" data-run-id="${escapeHtml(runItem.run_id)}">Log</button></span>`,
        ]);
      }).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", "", "", "", "", ""]);
}

function renderRunDetail() {
  const detail = state.runDetail || {};
  const evidence = state.runEvidence || detail || {};
  const artifacts = evidence.artifacts || {};
  const logs = evidence.logs || {};
  $("run-log-title").textContent = detail.run_id
    ? `${text(detail.draft_id)} / ${text(detail.run_id)}`
    : "No run selected";
  const pairs = [
    ["Run ID", text(detail.run_id)],
    ["Draft", text(detail.draft_id)],
    ["Action", text(detail.action)],
    ["Status", text(detail.status)],
    ["Return Code", text(detail.returncode)],
    ["Started", text(detail.started_at)],
    ["Finished", text(detail.finished_at)],
    ["Seconds", numberText(detail.duration_seconds, 3)],
    ["Summary", text(detail.summary_available)],
    ["Artifacts", text(detail.artifact_available)],
    ["Command", (detail.command || []).join(" ")],
  ];
  $("run-log-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  if ($("run-evidence-cards")) {
    const cards = evidence.evidence_cards || [
      {
        status: detail.run_id ? statusClass(detail.status).replace("status-", "") || "warn" : "bad",
        label: "Execution",
        title: detail.run_id ? text(detail.status) : "No Run",
        note: detail.run_id ? `Return code ${text(detail.returncode)}.` : "Select a run from Workbench or Runs.",
      },
    ];
    $("run-evidence-cards").innerHTML = cards.map((card) => `
      <div class="action-card status-${escapeHtml(card.status || "bad")}">
        <span>${escapeHtml(card.label || "Evidence")}</span>
        <strong>${escapeHtml(card.title || "n/a")}</strong>
        <small>${escapeHtml(card.note || "")}</small>
      </div>
    `).join("");
  }
  if ($("run-evidence-note")) {
    const pathNote = artifacts.path ? ` Archive ${text(artifacts.path)}.` : "";
    const errorNote = artifacts.error ? ` ${text(artifacts.error)}.` : "";
    $("run-evidence-note").textContent = detail.run_id
      ? `${numberText(artifacts.existing_count || 0, 0)} artifact files / ${bytes(artifacts.bytes || 0)} / ${numberText(artifacts.jsonl_row_count || 0, 0)} JSONL rows.${pathNote}${errorNote}`
      : "Open a run log to inspect bounded artifacts and log tails.";
  }
  if ($("run-evidence-files-body")) {
    const files = artifacts.files || [];
    $("run-evidence-files-body").innerHTML = files.length
      ? files.map((item) => row([
          `<span class="mono">${escapeHtml(item.name)}</span>`,
          statusText(item.exists ? "ok" : "bad"),
          bytes(item.bytes || 0),
          item.line_count === null || item.line_count === undefined
            ? "n/a"
            : `${numberText(item.line_count, 0)}${item.line_count_capped ? "+" : ""}`,
          escapeHtml(text(item.modified_at)),
        ])).join("")
      : row([`<span class="muted">No archived artifact manifest for this run.</span>`, "", "", "", ""]);
  }
  $("run-log-stdout").value = (logs.stdout && logs.stdout.tail) || detail.stdout_tail || "";
  $("run-log-stderr").value = (logs.stderr && logs.stderr.tail) || detail.stderr_tail || "";
}

function nonzeroObjectCount(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).filter((item) => {
    const number = finiteNumber(item);
    return number !== null && number !== 0;
  }).length;
}

function artifactSessionRows(artifacts) {
  const rows = [];
  for (const decision of artifacts.decisions || []) {
    rows.push({
      timestamp: decision.timestamp,
      type: "decision",
      status: decision.paused ? "paused" : "ok",
      symbol: (decision.symbols || []).slice(0, 5).join(", "),
      detail: `${numberText(decision.intent_count, 0)} intents; step ${text(decision.step)}`,
    });
  }
  for (const orderItem of artifacts.orders || []) {
    const status = text(orderItem.status);
    const rejected = status.toLowerCase().includes("reject");
    const quantity = orderItem.cash_quantity !== undefined && orderItem.cash_quantity !== null && orderItem.cash_quantity !== ""
      ? `cash ${money(orderItem.cash_quantity)}`
      : `qty ${text(orderItem.quantity)}`;
    rows.push({
      timestamp: orderItem.timestamp,
      type: rejected ? "reject" : "order",
      status,
      symbol: orderItem.symbol,
      detail: `${text(orderItem.side)} ${quantity}; ${text(orderItem.reason || orderItem.tag || orderItem.order_type)}`,
    });
  }
  for (const fill of artifacts.fills || []) {
    rows.push({
      timestamp: fill.timestamp,
      type: "fill",
      status: fill.simulated ? "simulated" : "filled",
      symbol: fill.symbol,
      detail: `${text(fill.side)} qty ${numberText(fill.quantity, 4)} @ ${money(fill.price)}; commission ${money(fill.commission)}`,
    });
  }
  for (const account of artifacts.account || []) {
    rows.push({
      timestamp: account.timestamp,
      type: "account",
      status: "snapshot",
      symbol: `${numberText(nonzeroObjectCount(account.positions), 0)} positions`,
      detail: `equity ${money(account.equity)}; cash ${money(account.cash)}; gross ${money(account.gross_exposure)}`,
    });
  }
  return rows.sort((left, right) => {
    const leftTime = timestampMillis(left.timestamp) || 0;
    const rightTime = timestampMillis(right.timestamp) || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return String(right.type || "").localeCompare(String(left.type || ""));
  });
}

function strategyDrilldownRows(decisions) {
  return (decisions || [])
    .map((decision) => ({
      timestamp: decision.timestamp,
      symbols: decision.symbols || [],
      intent_count: Number(decision.intent_count || 0),
      drilldown: decision.drilldown || {},
    }))
    .filter((item) => Object.keys(item.drilldown).length);
}

function nearThresholdMissRows(drilldowns) {
  return (drilldowns || [])
    .filter((item) => item.intent_count === 0 && item.drilldown && item.drilldown.near_threshold === true)
    .sort((left, right) => {
      const leftTime = timestampMillis(left.timestamp) || 0;
      const rightTime = timestampMillis(right.timestamp) || 0;
      return rightTime - leftTime;
    });
}

function drilldownSignalText(drilldown) {
  const label = text(drilldown.signal_label || drilldown.reason || "signal");
  const value = drilldown.signal_value === undefined ? "n/a" : numberText(drilldown.signal_value, 4);
  return `${label}: ${value}`;
}

function drilldownThresholdText(drilldown) {
  const parts = [];
  if (drilldown.threshold !== undefined) parts.push(`threshold ${numberText(drilldown.threshold, 4)}`);
  if (drilldown.threshold_distance !== undefined) parts.push(`distance ${numberText(drilldown.threshold_distance, 4)}`);
  if (drilldown.threshold_direction !== undefined) parts.push(text(drilldown.threshold_direction));
  return parts.join("; ") || "n/a";
}

function drilldownHoldText(drilldown) {
  if (drilldown.hold_until) return text(drilldown.hold_until);
  if (drilldown.expected_hold_minutes !== undefined) return `${numberText(drilldown.expected_hold_minutes, 0)}m expected`;
  return "n/a";
}

function drilldownNearText(drilldown) {
  const label = drilldown.near_threshold ? "near" : "no";
  return drilldown.near_threshold_reason ? `${label}: ${text(drilldown.near_threshold_reason)}` : label;
}

function drilldownExitText(drilldown) {
  const parts = [];
  if (drilldown.entry_marker) parts.push(`entry ${text(drilldown.entry_marker)}`);
  if (drilldown.exit_marker) parts.push(`exit ${text(drilldown.exit_marker)}`);
  if (drilldown.active_exit_rule) parts.push(`rule ${text(drilldown.active_exit_rule)}`);
  if (drilldown.exit_state) parts.push(`exit ${text(drilldown.exit_state)}`);
  if (drilldown.stop_state) parts.push(`stop ${text(drilldown.stop_state)}`);
  if (drilldown.stop_price !== undefined) parts.push(`stop ${money(drilldown.stop_price)}`);
  if (drilldown.target_price !== undefined) parts.push(`target ${money(drilldown.target_price)}`);
  return parts.join("; ") || "n/a";
}

function drilldownMaeMfeText(drilldown) {
  const mae = drilldown.mae_pct === undefined ? "n/a" : pctText(drilldown.mae_pct);
  const mfe = drilldown.mfe_pct === undefined ? "n/a" : pctText(drilldown.mfe_pct);
  return `${mae} / ${mfe}`;
}

function pluginResultFieldValue(field, value) {
  if (value === undefined || value === null || value === "") return "n/a";
  const kind = text(field.kind || "text");
  const decimals = Number(field.decimals);
  const hasDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 8;
  const prefix = text(field.prefix || "");
  const suffixParts = [field.suffix, field.unit].map((item) => text(item || "")).filter((item) => item && item !== "n/a");
  let formatted = "";
  if (kind === "percent") formatted = pctText(value);
  else if (kind === "currency") formatted = money(value);
  else if (kind === "boolean") formatted = value ? "yes" : "no";
  else if (kind === "duration_minutes") formatted = `${numberText(value, hasDecimals ? decimals : 2)} min`;
  else if (kind === "number") formatted = numberText(value, hasDecimals ? decimals : 4);
  else if (Array.isArray(value)) formatted = value.map((item) => text(item)).join(", ");
  else formatted = text(value);
  if (formatted === "n/a") return formatted;
  return `${prefix && prefix !== "n/a" ? prefix : ""}${formatted}${suffixParts.length ? ` ${suffixParts.join(" ")}` : ""}`;
}

function pluginResultFieldHelp(field) {
  const parts = [
    text(field.help || ""),
    text(field.description || ""),
    field.kind ? `kind ${text(field.kind)}` : "",
    field.decimals !== undefined ? `${numberText(field.decimals, 0)} decimals` : "",
    field.prefix ? `prefix ${text(field.prefix)}` : "",
    field.suffix ? `suffix ${text(field.suffix)}` : "",
    field.unit ? `unit ${text(field.unit)}` : "",
  ].filter((item) => item && item !== "n/a");
  return parts.length ? parts.join("; ") : "n/a";
}

function pluginResultDisplayDescriptor(field) {
  const pieces = [
    field.order !== undefined ? `order ${numberText(field.order, 2)}` : "registry order",
    field.kind ? `kind ${text(field.kind)}` : "",
    field.decimals !== undefined ? `${numberText(field.decimals, 0)} decimals` : "",
    field.prefix ? `prefix ${text(field.prefix)}` : "",
    field.suffix ? `suffix ${text(field.suffix)}` : "",
    field.unit ? `unit ${text(field.unit)}` : "",
  ].filter((item) => item && item !== "n/a");
  return pieces.join("; ") || "default text display";
}

function pluginResultFieldRows(artifacts) {
  const fields = ((artifacts.plugin || {}).result_fields || [])
    .filter((field) => field && field.name)
    .slice(0, 12);
  if (!fields.length) return [];
  const rows = [];
  for (const decision of artifacts.decisions || []) {
    const drilldown = decision.drilldown || {};
    for (const field of fields) {
      if (!(field.name in drilldown)) continue;
      rows.push({
        timestamp: decision.timestamp,
        symbols: decision.symbols || [],
        field,
        value: drilldown[field.name],
      });
      if (rows.length >= 100) return rows;
    }
  }
  return rows;
}

function pluginFieldList(fields) {
  const names = (fields || [])
    .filter((field) => field && field.name)
    .map((field) => text(field.label || field.name));
  return names.length ? names.join(", ") : "none";
}

function renderArtifactPluginBoundary(artifacts) {
  if (!$("artifact-plugin-boundary-note") || !$("artifact-plugin-boundary-cards") || !$("artifact-plugin-boundary")) return;
  const plugin = artifacts.plugin || {};
  const summary = artifacts.plugin_result_summary || {};
  const contract = artifacts.plugin_contract || {};
  const contractPlugin = (contract.plugin || {});
  const contractObserved = (contract.observed || {});
  const strategyFields = (plugin.strategy_fields || []).filter((field) => field && field.name);
  const resultFields = (plugin.result_fields || []).filter((field) => field && field.name);
  const declared = Number(summary.declared_field_count ?? resultFields.length);
  const emittedFields = Number(summary.emitted_field_count || 0);
  const emittedValues = Number(summary.emitted_value_count || 0);
  const decisionCount = Number(summary.decision_count ?? (artifacts.decisions || []).length);
  const unlabeledCount = Number(summary.unlabeled_public_key_count || 0);
  const pluginLabel = text(plugin.label || plugin.id || plugin.spec || contractPlugin.name || contractPlugin.spec || "Unknown plugin");
  const pluginStatus = plugin.matched
    ? plugin.visibility === "public_example" ? "warn" : "ok"
    : "bad";
  $("artifact-plugin-boundary-note").textContent = summary.note || (plugin.matched
    ? `${pluginLabel} metadata loaded from the Workbench plugin registry`
    : "No matching Workbench plugin registry entry for this artifact");
  const cards = [
    {
      status: pluginStatus,
      title: pluginLabel,
      label: "Plugin",
      note: plugin.matched
        ? plugin.visibility === "public_example"
          ? "Public example wiring only; not a viable strategy."
          : text(plugin.boundary || "Local/private plugin metadata.")
        : "Load or restore the matching plugin registry entry for this draft.",
    },
    {
      status: strategyFields.length ? "ok" : "warn",
      title: numberText(strategyFields.length, 0),
      label: "Declared Inputs",
      note: strategyFields.length
        ? pluginFieldList(strategyFields)
        : "No public-safe strategy_fields metadata declared.",
    },
    {
      status: declared ? summary.status || "ok" : "warn",
      title: `${numberText(emittedFields, 0)} / ${numberText(declared, 0)}`,
      label: "Declared Results",
      note: declared
        ? `${numberText(emittedValues, 0)} value${emittedValues === 1 ? "" : "s"} emitted across ${numberText(decisionCount, 0)} loaded decision${decisionCount === 1 ? "" : "s"}.`
        : "Declare result_fields to label public diagnostics in artifacts.",
    },
    {
      status: unlabeledCount ? "warn" : emittedValues ? "ok" : "waiting",
      title: numberText(unlabeledCount, 0),
      label: "Unlabeled Keys",
      note: unlabeledCount
        ? "Sanitized dashboard keys were emitted without result_fields labels."
        : "No extra sanitized dashboard keys beyond declared result metadata.",
    },
    {
      status: contract.available ? "ok" : "warn",
      title: contract.available ? "Loaded" : "Missing",
      label: "Runner Contract",
      note: contract.available
        ? `${numberText(contractObserved.dashboard_keys ? contractObserved.dashboard_keys.length : 0, 0)} public dashboard key${(contractObserved.dashboard_keys || []).length === 1 ? "" : "s"} observed by plugin_runner.`
        : "Older runs may not have plugin_contract.json archived.",
    },
  ];
  $("artifact-plugin-boundary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const coverage = declared
    ? `${numberText(emittedFields, 0)} / ${numberText(declared, 0)} fields, ${numberText(emittedValues, 0)} values`
    : "No declared result fields";
  const unlabeledKeys = summary.unlabeled_public_keys || [];
  const contractKeys = contractObserved.dashboard_keys || [];
  const contractArtifacts = (contract.artifacts || []).filter((item) => item && item.name);
  $("artifact-plugin-boundary").innerHTML = kvRows([
    ["Plugin", pluginLabel],
    ["Registry Match", statusText(plugin.matched ? "ok" : "bad"), true],
    ["Runner Contract", statusText(contract.available ? "ok" : "warn"), true],
    ["Visibility", text(plugin.visibility || "n/a")],
    ["Status", text(plugin.status || "n/a")],
    ["Spec", (plugin.spec || contractPlugin.spec) ? `<span class="mono">${escapeHtml(plugin.spec || contractPlugin.spec)}</span>` : "n/a", Boolean(plugin.spec || contractPlugin.spec)],
    ["Plugin Class", text(contractPlugin.class || "n/a")],
    ["Plugin Validators", numberText(contractPlugin.validator_count, 0)],
    ["Boundary", text(plugin.boundary || plugin.description || "n/a")],
    ["Strategy Inputs", jsonDrilldown(strategyFields.map((field) => ({
      name: field.name,
      label: field.label,
      kind: field.kind,
      required: Boolean(field.required),
    })), pluginFieldList(strategyFields)), true],
    ["Result Fields", jsonDrilldown(resultFields.map((field) => ({
      name: field.name,
      label: field.label,
      kind: field.kind,
      unit: field.unit,
      prefix: field.prefix,
      suffix: field.suffix,
      decimals: field.decimals,
    })), pluginFieldList(resultFields)), true],
    ["Result Sections", jsonDrilldown(resultSections.map((section) => ({
      id: section.id,
      label: section.label,
      fields: section.fields,
    })), resultSections.length ? resultSections.map((section) => text(section.label || section.id)).join(", ") : "none"), true],
    ["Result Coverage", `${coverage}; ${numberText(decisionCount, 0)} decision${decisionCount === 1 ? "" : "s"} loaded`],
    ["Observed Dashboard Keys", jsonDrilldown(contractKeys, contractKeys.length ? contractKeys.join(", ") : "none"), true],
    ["Unlabeled Keys", jsonDrilldown(unlabeledKeys, unlabeledKeys.length ? unlabeledKeys.join(", ") : "none"), true],
    ["Contract Artifacts", jsonDrilldown(contractArtifacts, contractArtifacts.length ? `${numberText(contractArtifacts.length, 0)} file records` : "none"), true],
  ]);
}

function renderArtifactPluginCoverage(artifacts) {
  if (!$("artifact-plugin-coverage-note") || !$("artifact-plugin-coverage-body")) return;
  const summary = artifacts.plugin_result_summary || {};
  const coverageRows = (summary.field_coverage || []).filter((item) => item && item.name);
  const decisionCount = Number(summary.decision_count ?? (artifacts.decisions || []).length);
  renderArtifactPluginResultSections(artifacts, coverageRows, decisionCount);
  renderArtifactPluginResultWidgets(artifacts, coverageRows, decisionCount);
  renderArtifactPluginResultSnapshot(artifacts, coverageRows, decisionCount);
  renderArtifactPluginDisplayPlan(artifacts, coverageRows, decisionCount);
  $("artifact-plugin-coverage-note").textContent = coverageRows.length
    ? `${numberText(summary.emitted_field_count || 0, 0)} / ${numberText(summary.declared_field_count || coverageRows.length, 0)} declared field${coverageRows.length === 1 ? "" : "s"} emitted in ${numberText(decisionCount, 0)} loaded decision${decisionCount === 1 ? "" : "s"}`
    : "No declared plugin result fields to measure";
  $("artifact-plugin-coverage-body").innerHTML = coverageRows.length
    ? coverageRows.map((item) => {
        const emitted = decisionCount
          ? `${numberText(item.emitted_count, 0)} / ${numberText(decisionCount, 0)} (${pctText(item.coverage_pct)})`
          : numberText(item.emitted_count, 0);
        const latestValue = item.latest_timestamp
          ? `${pluginResultFieldValue(item, item.latest_value)} @ ${text(item.latest_timestamp)}`
          : pluginResultFieldValue(item, item.latest_value);
        const latestSymbols = (item.latest_symbols || []).length ? `; ${(item.latest_symbols || []).join(", ")}` : "";
        return row([
          escapeHtml(text(item.label || item.name)),
          escapeHtml(text(item.kind)),
          escapeHtml(emitted),
          escapeHtml(`${latestValue}${latestSymbols}`),
          statusText(item.status || "waiting"),
        ]);
      }).join("")
    : row([`<span class="muted">Declare result_fields in the plugin registry to summarize artifact diagnostics.</span>`, "", "", "", ""]);
}

function renderArtifactPluginResultSections(artifacts, coverageRows = [], decisionCount = 0) {
  if (!$("artifact-plugin-result-sections")) return;
  const summary = artifacts.plugin_result_summary || {};
  const sections = (summary.section_coverage || []).filter((section) => section && section.id);
  if (!sections.length) {
    $("artifact-plugin-result-sections").innerHTML = "";
    return;
  }
  const coverageByName = new Map((coverageRows || []).map((item) => [text(item.name), item]));
  $("artifact-plugin-result-sections").innerHTML = sections.slice(0, 8).map((section) => {
    const status = section.status || "waiting";
    const fields = (section.fields || []).slice(0, 6).map((name) => {
      const coverage = coverageByName.get(text(name)) || {};
      const emitted = Number(coverage.emitted_count || 0);
      const value = emitted ? pluginResultFieldValue(coverage, coverage.latest_value) : "n/a";
      const label = text(coverage.label || name);
      return `<span><b>${escapeHtml(label)}</b> ${escapeHtml(value)}</span>`;
    }).join("");
    const note = [
      `${numberText(section.emitted_field_count || 0, 0)} / ${numberText(section.field_count || 0, 0)} fields emitted`,
      decisionCount ? `${numberText(decisionCount, 0)} loaded decisions` : "no loaded decisions",
      text(section.description || section.help || ""),
    ].filter((item) => item && item !== "n/a").join("; ");
    return `
      <article class="plugin-result-display-card status-${escapeHtml(status)}">
        <span>${statusText(status)}</span>
        <strong>${escapeHtml(text(section.label || section.id))}</strong>
        <p>${escapeHtml(pctText(section.field_coverage_pct))}</p>
        <small>${escapeHtml(note)}</small>
        <small>${fields || "No declared fields in this section."}</small>
      </article>
    `;
  }).join("");
}

function pluginResultSparkline(points = [], label = "plugin result trend") {
  const values = (points || [])
    .map((point) => finiteNumber(point.value))
    .filter((value) => value !== null);
  if (values.length < 2) return `<span class="muted">No trend yet</span>`;
  const width = 220;
  const height = 52;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cls = values[values.length - 1] >= values[0] ? "spark-good" : "spark-bad";
  const caption = `${text(label)} ${numberText(values[0])} to ${numberText(values[values.length - 1])}`;
  return `<svg class="plugin-widget-sparkline-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(text(label))}"><polyline points="${coords}"><title>${escapeHtml(caption)}</title></polyline></svg>`;
}

function pluginResultLineChart(fieldRows = [], label = "plugin result chart") {
  const series = (fieldRows || [])
    .map((field, index) => ({
      name: text(field.label || field.name || `Series ${index + 1}`),
      className: `plugin-series-${index % 6}`,
      values: (field.points || [])
        .map((point, pointIndex) => ({
          index: pointIndex,
          timestamp: point.timestamp,
          value: finiteNumber(point.value),
        }))
        .filter((point) => point.value !== null),
    }))
    .filter((item) => item.values.length >= 2)
    .slice(0, 6);
  if (!series.length) return `<span class="muted">No chart points yet</span>`;
  const allValues = series.flatMap((item) => item.values.map((point) => point.value));
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || 1;
  const maxPoints = Math.max(...series.map((item) => item.values.length));
  const width = 420;
  const height = 170;
  const pad = 18;
  const chartWidth = width - pad * 2;
  const chartHeight = height - pad * 2;
  const zeroY = min < 0 && max > 0
    ? pad + chartHeight - ((0 - min) / span) * chartHeight
    : null;
  const zeroLine = zeroY === null
    ? ""
    : `<line class="plugin-widget-line-zero" x1="${pad}" x2="${width - pad}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"></line>`;
  const paths = series.map((item) => {
    const coords = item.values.map((point, pointIndex) => {
      const x = pad + (maxPoints <= 1 ? 0 : (pointIndex / (maxPoints - 1)) * chartWidth);
      const y = pad + chartHeight - ((point.value - min) / span) * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const first = item.values[0].value;
    const last = item.values[item.values.length - 1].value;
    const title = `${item.name} ${numberText(first)} to ${numberText(last)} across ${numberText(item.values.length, 0)} points`;
    return `<polyline class="${escapeHtml(item.className)}" points="${coords}"><title>${escapeHtml(title)}</title></polyline>`;
  }).join("");
  const legend = series.map((item) => `
    <span><i class="${escapeHtml(item.className)}"></i>${escapeHtml(item.name)}</span>
  `).join("");
  const caption = `${text(label)} / ${numberText(series.length, 0)} series / ${numberText(maxPoints, 0)} max points`;
  return `
    <svg class="plugin-widget-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(text(label))}">
      ${zeroLine}
      ${paths}
    </svg>
    <div class="plugin-widget-line-legend">${legend}</div>
    <small>${escapeHtml(caption)}</small>
  `;
}

function renderArtifactPluginResultWidgets(artifacts, coverageRows = [], decisionCount = 0) {
  if (!$("artifact-plugin-result-widgets")) return;
  const summary = artifacts.plugin_result_summary || {};
  const widgets = (summary.widget_coverage || []).filter((widget) => widget && widget.id);
  if (!widgets.length) {
    $("artifact-plugin-result-widgets").innerHTML = "";
    return;
  }
  $("artifact-plugin-result-widgets").innerHTML = widgets.slice(0, 8).map((widget) => {
    const status = widget.status || "waiting";
    const kind = text(widget.kind || "cards");
    const fieldRows = (widget.field_summaries || []).slice(0, 8);
    let body = "";
    if (kind === "table") {
      body = `<table class="mini-table"><tbody>${fieldRows.map((field) => `
        <tr>
          <td>${escapeHtml(text(field.label || field.name))}</td>
          <td>${escapeHtml(pluginResultFieldValue(field, field.latest_value))}</td>
          <td>${escapeHtml(numberText(field.emitted_count, 0))}</td>
        </tr>
      `).join("")}</tbody></table>`;
    } else if (kind === "bar_summary") {
      body = `<div class="plugin-widget-bars">${fieldRows.map((field) => {
        const pct = finiteNumber(field.coverage_pct) ?? 0;
        return `
          <span><b>${escapeHtml(text(field.label || field.name))}</b><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i><em>${escapeHtml(pctText(field.coverage_pct))}</em></span>
        `;
      }).join("")}</div>`;
    } else if (kind === "sparkline") {
      body = `<div class="plugin-widget-sparklines">${fieldRows.map((field) => `
        <div>
          <span><b>${escapeHtml(text(field.label || field.name))}</b><em>${escapeHtml(pluginResultFieldValue(field, field.latest_value))}</em></span>
          ${pluginResultSparkline(field.points || [], field.label || field.name)}
        </div>
      `).join("")}</div>`;
    } else if (kind === "line_chart") {
      body = `<div class="plugin-widget-line-chart-wrap">${pluginResultLineChart(fieldRows, widget.label || widget.id)}</div>`;
    } else {
      body = `<div class="plugin-widget-card-list">${fieldRows.map((field) => `
        <span><b>${escapeHtml(text(field.label || field.name))}</b> ${escapeHtml(pluginResultFieldValue(field, field.latest_value))}</span>
      `).join("")}</div>`;
    }
    const note = [
      `${numberText(widget.emitted_field_count || 0, 0)} / ${numberText(widget.field_count || 0, 0)} fields emitted`,
      decisionCount ? `${numberText(decisionCount, 0)} loaded decisions` : "no loaded decisions",
      text(widget.description || widget.help || ""),
    ].filter((item) => item && item !== "n/a").join("; ");
    return `
      <article class="plugin-result-display-card status-${escapeHtml(status)} plugin-result-widget plugin-result-widget-${escapeHtml(kind)}">
        <span>${statusText(status)} ${escapeHtml(kind)}</span>
        <strong>${escapeHtml(text(widget.label || widget.id))}</strong>
        <small>${escapeHtml(note)}</small>
        ${body || "<small>No widget fields emitted yet.</small>"}
      </article>
    `;
  }).join("");
}

function renderArtifactPluginDisplayPlan(artifacts, coverageRows = [], decisionCount = 0) {
  if (!$("artifact-plugin-display-plan")) return;
  const declaredFields = ((artifacts.plugin || {}).result_fields || []).filter((field) => field && field.name);
  if (!declaredFields.length) {
    $("artifact-plugin-display-plan").innerHTML = "";
    return;
  }
  const coverageByName = new Map((coverageRows || []).map((item) => [text(item.name), item]));
  $("artifact-plugin-display-plan").innerHTML = declaredFields
    .slice()
    .sort((left, right) => Number(left.order || 999) - Number(right.order || 999) || text(left.label || left.name).localeCompare(text(right.label || right.name)))
    .slice(0, 12)
    .map((field) => {
      const coverage = coverageByName.get(text(field.name)) || {};
      const emitted = Number(coverage.emitted_count || 0);
      const status = emitted ? coverage.status || "ok" : decisionCount ? "warn" : "waiting";
      const latestValue = emitted ? pluginResultFieldValue({ ...field, ...coverage }, coverage.latest_value) : "n/a";
      const coverageText = decisionCount
        ? `${numberText(emitted, 0)} / ${numberText(decisionCount, 0)} decisions`
        : "no loaded decisions";
      const help = text(field.help || field.description || "No help text declared.");
      return `
        <article class="plugin-result-display-card status-${escapeHtml(status)}">
          <span>${statusText(status)}</span>
          <strong>${escapeHtml(text(field.label || field.name))}</strong>
          <small class="mono">${escapeHtml(`diagnostics.dashboard.${field.name}`)}</small>
          <p>${escapeHtml(latestValue)}</p>
          <small>${escapeHtml(`${coverageText}; ${pluginResultDisplayDescriptor(field)}. ${help}`)}</small>
        </article>
      `;
    }).join("");
}

function renderArtifactPluginResultSnapshot(artifacts, coverageRows = [], decisionCount = 0) {
  if (!$("artifact-plugin-result-snapshot")) return;
  const declaredFields = ((artifacts.plugin || {}).result_fields || []).filter((field) => field && field.name);
  if (!declaredFields.length) {
    $("artifact-plugin-result-snapshot").innerHTML = `
      <div class="empty-card">
        <span>Plugin Results</span>
        <strong>No Declared Fields</strong>
        <small>Declare public-safe result_fields in the plugin registry to build custom result cards.</small>
      </div>
    `;
    return;
  }
  const coverageByName = new Map((coverageRows || []).map((item) => [text(item.name), item]));
  const cards = declaredFields
    .slice()
    .sort((left, right) => Number(left.order || 999) - Number(right.order || 999) || text(left.label || left.name).localeCompare(text(right.label || right.name)))
    .slice(0, 8)
    .map((field) => {
      const coverage = coverageByName.get(text(field.name)) || {};
      const emitted = Number(coverage.emitted_count || 0);
      const status = emitted ? coverage.status || "ok" : decisionCount ? "warn" : "waiting";
      const value = emitted ? pluginResultFieldValue({ ...field, ...coverage }, coverage.latest_value) : "n/a";
      const latest = coverage.latest_timestamp ? `Latest ${timestampAgeLabel(coverage.latest_timestamp)}.` : "No emitted value in loaded decisions.";
      const help = text(field.help || field.description || "");
      const symbols = (coverage.latest_symbols || []).length ? ` Symbols ${(coverage.latest_symbols || []).join(", ")}.` : "";
      return {
        status,
        label: text(field.label || field.name),
        value,
        note: `${emitted ? `${numberText(emitted, 0)} / ${numberText(decisionCount, 0)} decisions. ` : ""}${latest}${symbols}${help && help !== "n/a" ? ` ${help}` : ""}`,
      };
    });
  $("artifact-plugin-result-snapshot").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function workbenchArtifactsAssistantModel(artifacts = state.configArtifacts || {}) {
  const summary = artifacts.summary || {};
  const performance = artifacts.performance || {};
  const pluginSummary = artifacts.plugin_result_summary || {};
  const performanceRollups = artifacts.performance_rollups || {};
  const decisions = artifacts.decisions || [];
  const orders = artifacts.orders || [];
  const fills = artifacts.fills || [];
  const account = artifacts.account || [];
  const orderPreviews = artifacts.order_previews || [];
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id || artifacts.output_dir);
  const runId = text(artifacts.run_id || "n/a");
  const draftId = text(artifacts.draft_id || "n/a");
  const rejectCount = finiteNumber(summary.rejections) ?? orders.filter((order) => text(order.status).toLowerCase().includes("reject")).length;
  const fillCount = finiteNumber(summary.fills) ?? fills.length;
  const decisionCount = finiteNumber(summary.decisions) ?? decisions.length;
  const accountCount = finiteNumber(performance.account_snapshot_count) ?? account.length;
  const returnPct = finiteNumber(performance.total_return_pct);
  const drawdownPct = finiteNumber(performance.max_drawdown_pct);
  const emittedFields = finiteNumber(pluginSummary.emitted_field_count) || 0;
  const declaredFields = finiteNumber(pluginSummary.declared_field_count) || ((artifacts.plugin || {}).result_fields || []).length;
  const unlabeledFields = finiteNumber(pluginSummary.unlabeled_public_key_count) || 0;
  const rollupCount = ((performanceRollups || {}).rollups || []).length;
  const hasLog = Boolean(state.runDetail && (state.runDetail.run_id === artifacts.run_id || state.runDetail.draft_id === artifacts.draft_id));
  let status = "bad";
  let title = "Load Artifacts";
  let note = "Open Results or Artifacts from a completed Workbench run.";
  if (hasArtifacts) {
    status = rejectCount > 0 || unlabeledFields > 0 ? "warn" : "ok";
    title = rejectCount > 0 ? "Review Execution" : emittedFields || declaredFields ? "Inspect Results" : "Artifacts Loaded";
    note = rejectCount > 0
      ? "Rejected orders are present; inspect orders, fills, and logs before trusting the run."
      : "Use Performance for charts, Runs for timelines, and the plugin tables for public-safe strategy evidence.";
  }
  const cards = [
    {
      status: hasArtifacts ? "ok" : "bad",
      title: hasArtifacts ? runId : "None",
      label: "Loaded Run",
      note: hasArtifacts ? `${draftId}; output ${text(artifacts.output_dir)}.` : "No run artifact payload is loaded.",
    },
    {
      status: returnPct === null ? hasArtifacts ? "warn" : "bad" : returnPct >= 0 ? "ok" : "bad",
      title: pctText(returnPct),
      label: "Return",
      note: `Drawdown ${pctText(drawdownPct)}; ${numberText(accountCount, 0)} account snapshot${accountCount === 1 ? "" : "s"}.`,
    },
    {
      status: rejectCount > 0 ? "bad" : fillCount > 0 ? "ok" : decisionCount > 0 ? "warn" : hasArtifacts ? "warn" : "bad",
      title: `${numberText(fillCount, 0)} fills`,
      label: "Execution",
      note: `${numberText(decisionCount, 0)} decisions / ${numberText(orders.length, 0)} orders / ${numberText(rejectCount, 0)} rejects.`,
    },
    {
      status: declaredFields ? unlabeledFields ? "warn" : emittedFields ? "ok" : "warn" : hasArtifacts ? "warn" : "bad",
      title: declaredFields ? `${numberText(emittedFields, 0)} / ${numberText(declaredFields, 0)}` : "Undeclared",
      label: "Plugin Results",
      note: unlabeledFields
        ? `${numberText(unlabeledFields, 0)} sanitized key${unlabeledFields === 1 ? "" : "s"} lack result-field labels.`
        : declaredFields ? "Declared result fields are available for this artifact." : "No public-safe result_fields metadata declared.",
    },
    {
      status: rollupCount ? "ok" : hasArtifacts ? "warn" : "bad",
      title: numberText(rollupCount, 0),
      label: "Rollups",
      note: rollupCount ? "Runner-owned daily rollups are loaded." : "No performance_rollups.json data loaded.",
    },
    {
      status: orderPreviews.length ? "warn" : hasArtifacts ? "ok" : "bad",
      title: numberText(orderPreviews.length, 0),
      label: "Order Previews",
      note: orderPreviews.length ? "Manual approval previews require operator review." : "No held order previews in this artifact.",
    },
  ];
  const actions = [
    {
      action: "performance",
      status: hasArtifacts ? "ok" : "bad",
      title: "Open Performance",
      note: "Show this artifact's equity, drawdown, rollups, and trade summaries.",
      disabled: !hasArtifacts,
    },
    {
      action: "runs",
      status: hasArtifacts ? "ok" : "bad",
      title: "Open Runs",
      note: "Inspect run state, event timelines, orders, fills, and decisions.",
      disabled: !hasArtifacts,
    },
    {
      action: "log",
      status: hasLog ? "ok" : hasArtifacts ? "warn" : "bad",
      title: "Open Log",
      note: hasLog ? "Run log evidence is already loaded." : "Load bounded stdout/stderr and artifact evidence for this run.",
      disabled: !hasArtifacts || !artifacts.run_id,
    },
    {
      action: "export",
      status: artifacts.run_id ? "ok" : "bad",
      title: "Export JSON",
      note: "Download the bounded public-safe artifact payload.",
      disabled: !artifacts.run_id,
    },
  ];
  return { status, title, note, cards, actions };
}

function renderWorkbenchArtifactsAssistant(artifacts = state.configArtifacts || {}) {
  if (!$("workbench-artifacts-assistant-title") || !$("workbench-artifacts-assistant-cards") || !$("workbench-artifacts-assistant-actions")) return;
  const model = workbenchArtifactsAssistantModel(artifacts);
  $("workbench-artifacts-assistant-title").textContent = model.title;
  $("workbench-artifacts-assistant-title").className = statusClass(model.status);
  $("workbench-artifacts-assistant-note").textContent = model.note;
  $("workbench-artifacts-assistant-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-artifacts-assistant-actions").innerHTML = model.actions.map((item) => `
    <button class="workbench-artifacts-assistant-action status-${escapeHtml(item.status)}" data-workbench-artifacts-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

async function handleWorkbenchArtifactsAssistantAction(action) {
  if (action === "performance") {
    navigateToView("performance");
    return;
  }
  if (action === "runs") {
    navigateToRunsLens("events");
    return;
  }
  if (action === "log") {
    const runId = state.configArtifacts && state.configArtifacts.run_id;
    if (!runId) throw new Error("No run id is loaded for log inspection");
    await loadRunDetail(runId);
    return;
  }
  if (action === "export") {
    await downloadRunArtifactsJson();
  }
}

function artifactChartMarkers(artifacts) {
  const markers = [];
  for (const fill of artifacts.fills || []) {
    markers.push({
      timestamp: fill.timestamp,
      type: normalizedFillSide(fill.side) === "sell" ? "exit-fill" : "entry-fill",
      symbol: fill.symbol,
      label: `${text(fill.side)} ${numberText(fill.quantity, 4)} @ ${money(fill.price)}`,
    });
  }
  for (const decision of artifacts.decisions || []) {
    const drilldown = decision.drilldown || {};
    if (drilldown.entry_marker) {
      markers.push({
        timestamp: decision.timestamp,
        type: "entry-marker",
        symbol: (decision.symbols || []).slice(0, 3).join(", "),
        label: text(drilldown.entry_marker),
      });
    }
    if (drilldown.exit_marker) {
      markers.push({
        timestamp: decision.timestamp,
        type: "exit-marker",
        symbol: (decision.symbols || []).slice(0, 3).join(", "),
        label: text(drilldown.exit_marker),
      });
    }
  }
  return markers;
}

function renderWorkbenchArtifacts() {
  const artifacts = state.configArtifacts || {};
  const summary = artifacts.summary || {};
  const performance = artifacts.performance || {};
  $("artifact-title").textContent = artifacts.run_id
    ? `${artifacts.draft_id} / ${artifacts.run_id} - ${text(artifacts.output_dir)}`
    : artifacts.draft_id
      ? `${artifacts.draft_id} - ${text(artifacts.output_dir)}`
    : "No run selected";
  renderWorkbenchArtifactsAssistant(artifacts);
  const pairs = [
    ["Mode", text(summary.mode)],
    ["Decisions", text(summary.decisions)],
    ["Orders", text(summary.orders)],
    ["Fills", text(summary.fills)],
    ["Rejections", text(summary.rejections)],
    ["Approval Holds", text(summary.approval_required_orders)],
    ["Loop", summary.loop_enabled ? `${numberText(summary.loop_iterations, 0)} iterations` : "one-shot"],
    ["Lifecycle", summary.stopped_by_control ? `stopped by ${text(summary.stop_marker)}` : "running/complete"],
    ["Session", summary.session_enabled ? `${text(summary.session_status)} / idle ${numberText(summary.session_idle_iterations, 0)}` : "unrestricted"],
    ["Snapshots", text(performance.account_snapshot_count)],
    ["Initial Equity", money(performance.initial_equity)],
    ["Final Cash", money(summary.final_cash)],
    ["Final Equity", money(performance.final_equity ?? summary.final_equity)],
    ["Realized PnL", money(performance.realized_pnl ?? summary.realized_pnl)],
    ["Unrealized PnL", money(performance.unrealized_pnl ?? summary.unrealized_pnl)],
    ["Total PnL", money(performance.total_pnl ?? summary.total_pnl)],
    ["Total Commission", money(performance.total_commission ?? summary.total_commission)],
    ["Total Borrow Fees", money(performance.total_borrow_fees ?? summary.total_borrow_fees)],
    ["Return", pctText(performance.total_return_pct)],
    ["Max Drawdown", pctText(performance.max_drawdown_pct)],
    ["Elapsed Days", numberText(performance.elapsed_days, 4)],
    ["Return / Day", pctText(performance.return_per_day_pct)],
    ["Return / Month", pctText(performance.return_per_month_pct)],
    ["Return / Year", pctText(performance.return_per_year_pct)],
    ["Projection", performance.short_horizon_projection ? "short horizon" : "full horizon"],
    ["Max Gross Exposure", `${money(performance.max_gross_exposure)} (${pctText(performance.max_gross_exposure_pct)})`],
    ["Max Abs Net Exposure", `${money(performance.max_abs_net_exposure)} (${pctText(performance.max_abs_net_exposure_pct)})`],
    ["Max Positions", numberText(performance.max_position_count, 0)],
    ["Positions", jsonDrilldown(summary.final_positions || {}, objectSummary(summary.final_positions || {})), true],
  ];
  $("artifact-summary").innerHTML = kvRows(pairs);
  $("artifact-equity-chart").innerHTML = equityChart(artifacts.account || [], artifactChartMarkers(artifacts));
  renderArtifactPluginBoundary(artifacts);
  const timeline = artifactSessionRows(artifacts);
  $("artifact-session-body").innerHTML = timeline.length
    ? timeline.map((item) => row([
        escapeHtml(item.timestamp),
        statusText(item.type),
        statusText(item.status),
        escapeHtml(text(item.symbol)),
        escapeHtml(item.detail),
      ])).join("")
    : row([`<span class="muted">No decisions, orders, fills, or account snapshots in this artifact.</span>`, "", "", "", ""]);
  const performanceRollups = artifacts.performance_rollups || {};
  const dailyRollups = performanceRollups.rollups || [];
  const periodRollups = performanceRollups.period_rollups || {};
  const periodRows = [
    ...(periodRollups.month || []),
    ...(periodRollups.year || []),
  ];
  $("artifact-performance-rollups-note").textContent = performanceRollups.available
    ? `${numberText(dailyRollups.length, 0)} shown / ${numberText(performanceRollups.total || dailyRollups.length, 0)} runner-owned day rollup${(performanceRollups.total || dailyRollups.length) === 1 ? "" : "s"}`
    : "No performance_rollups.json artifact loaded";
  $("artifact-performance-rollups-body").innerHTML = dailyRollups.length
    ? dailyRollups.map((item) => row([
        escapeHtml(item.day),
        escapeHtml(text(item.mode)),
        escapeHtml(numberText(item.snapshot_count, 0)),
        escapeHtml(pctText(item.daily_return_pct)),
        escapeHtml(money(item.start_equity)),
        escapeHtml(money(item.end_equity)),
        escapeHtml(money(item.max_gross_exposure)),
        escapeHtml(money(item.total_pnl)),
      ])).join("")
    : row([`<span class="muted">Runner-owned rollups appear when performance_rollups.json is archived with the run.</span>`, "", "", "", "", "", "", ""]);
  $("artifact-performance-period-rollups-note").textContent = performanceRollups.available
    ? `${numberText(periodRows.length, 0)} runner-owned month/year period rollup${periodRows.length === 1 ? "" : "s"}`
    : "No runner-owned period rollups loaded";
  $("artifact-performance-period-rollups-body").innerHTML = periodRows.length
    ? periodRows.map((item) => row([
        escapeHtml(text(item.period)),
        escapeHtml(text(item.label)),
        escapeHtml(numberText(item.day_count, 0)),
        escapeHtml(pctText(item.total_return_pct)),
        escapeHtml(money(item.start_equity)),
        escapeHtml(money(item.end_equity)),
        escapeHtml(numberText(item.snapshot_count, 0)),
        escapeHtml(numberText(item.max_position_count, 0)),
      ])).join("")
    : row([`<span class="muted">No month/year rollups in this artifact.</span>`, "", "", "", "", "", "", ""]);

  const decisions = artifacts.decisions || [];
  const drilldowns = strategyDrilldownRows(decisions);
  $("artifact-drilldown-note").textContent = drilldowns.length
    ? `${numberText(drilldowns.length, 0)} decision drilldown row${drilldowns.length === 1 ? "" : "s"} from diagnostics.dashboard`
    : "No public-safe strategy drilldown diagnostics in this artifact";
  $("artifact-drilldown-body").innerHTML = drilldowns.length
    ? drilldowns.map((item) => {
        const drilldown = item.drilldown || {};
        return row([
          escapeHtml(item.timestamp),
          escapeHtml((item.symbols || []).join(", ")),
          escapeHtml(drilldownSignalText(drilldown)),
          escapeHtml(drilldownThresholdText(drilldown)),
          statusText(drilldownNearText(drilldown)),
          escapeHtml(drilldownHoldText(drilldown)),
          escapeHtml(drilldownExitText(drilldown)),
          escapeHtml(drilldownMaeMfeText(drilldown)),
        ]);
      }).join("")
    : row([`<span class="muted">Plugins can publish public-safe fields under diagnostics.dashboard to populate this table.</span>`, "", "", "", "", "", "", ""]);
  renderArtifactPluginCoverage(artifacts);
  const pluginFields = ((artifacts.plugin || {}).result_fields || []).filter((field) => field && field.name);
  const pluginFieldRows = pluginResultFieldRows(artifacts);
  const pluginLabel = text((artifacts.plugin || {}).label || (artifacts.plugin || {}).id || (artifacts.plugin || {}).spec);
  $("artifact-plugin-fields-note").textContent = pluginFields.length
    ? pluginFieldRows.length
      ? `${numberText(pluginFieldRows.length, 0)} labeled public diagnostic value${pluginFieldRows.length === 1 ? "" : "s"} from ${pluginLabel}`
      : `${numberText(pluginFields.length, 0)} configured result field${pluginFields.length === 1 ? "" : "s"} for ${pluginLabel}; no matching decision diagnostics in this artifact`
    : "No plugin result field metadata is configured for this artifact";
  $("artifact-plugin-fields-body").innerHTML = pluginFieldRows.length
    ? pluginFieldRows.map((item) => row([
        escapeHtml(item.timestamp),
        escapeHtml((item.symbols || []).join(", ")),
        escapeHtml(text(item.field.label || item.field.name)),
        escapeHtml(pluginResultFieldValue(item.field, item.value)),
        escapeHtml(pluginResultFieldHelp(item.field)),
      ])).join("")
    : row([`<span class="muted">Declare result_fields in the public or ignored local plugin registry, then emit matching diagnostics.dashboard keys.</span>`, "", "", "", ""]);
  const nearMisses = nearThresholdMissRows(drilldowns);
  $("artifact-near-threshold-note").textContent = nearMisses.length
    ? `${numberText(nearMisses.length, 0)} close decision${nearMisses.length === 1 ? "" : "s"} without order intents`
    : "No public-safe near-threshold misses in this artifact";
  $("artifact-near-threshold-body").innerHTML = nearMisses.length
    ? nearMisses.slice(0, 50).map((item) => {
        const drilldown = item.drilldown || {};
        return row([
          escapeHtml(item.timestamp),
          escapeHtml((item.symbols || []).join(", ")),
          escapeHtml(drilldownSignalText(drilldown)),
          escapeHtml(drilldown.threshold_distance === undefined ? "n/a" : numberText(drilldown.threshold_distance, 4)),
          escapeHtml(text(drilldown.near_threshold_reason || drilldown.reason)),
          escapeHtml(drilldownHoldText(drilldown)),
          escapeHtml(drilldownExitText(drilldown)),
        ]);
      }).join("")
    : row([`<span class="muted">No missed near-threshold decisions published.</span>`, "", "", "", "", "", ""]);
  $("artifact-decisions-body").innerHTML = decisions.length
    ? decisions.map((decision) => row([
        escapeHtml(decision.timestamp),
        escapeHtml(decision.step),
        escapeHtml(decision.mode),
        escapeHtml(decision.intent_count),
        statusText(decision.paused ? "paused" : "ok"),
        escapeHtml((decision.symbols || []).join(", ")),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);

  const orders = artifacts.orders || [];
  $("artifact-orders-body").innerHTML = orders.length
    ? orders.map((orderItem) => row([
        escapeHtml(orderItem.timestamp),
        statusText(orderItem.status),
        escapeHtml(orderItem.symbol),
        escapeHtml(orderItem.side),
        escapeHtml(orderItem.order_type),
        escapeHtml(orderItem.quantity),
        escapeHtml(orderItem.cash_quantity),
        escapeHtml(orderItem.reason),
        escapeHtml(orderItem.tag),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", ""]);

  const orderPreviews = artifacts.order_previews || [];
  $("artifact-order-previews-note").textContent = orderPreviews.length
    ? `${numberText(orderPreviews.length, 0)} preview${orderPreviews.length === 1 ? "" : "s"} loaded from order_previews.jsonl`
    : "No manual-approval order previews in this artifact";
  $("artifact-order-previews-body").innerHTML = orderPreviews.length
    ? orderPreviews.map((preview) => {
        const command = approvalPreviewCommand(preview, artifacts);
        const actions = [];
        if (approvalPreviewCanApprove(preview, artifacts)) {
          actions.push(`<button type="button" class="approve-order-preview" data-approval-id="${escapeHtml(preview.approval_id)}">Approve</button>`);
        }
        if (command) {
          actions.push(`<button type="button" class="secondary copy-approval-command" data-command="${escapeHtml(command)}">Copy</button>`);
        }
        const actionCell = actions.length ? `<span class="button-pair">${actions.join("")}</span>` : `<span class="muted">n/a</span>`;
        return row([
          escapeHtml(preview.timestamp),
          statusText(preview.approval_status || (preview.approval_required ? "required" : "preview")),
          `<span class="mono">${escapeHtml(preview.approval_id)}</span>`,
          escapeHtml(preview.symbol),
          escapeHtml(preview.side),
          escapeHtml(preview.order_type),
          escapeHtml(numberText(preview.quantity, 4)),
          escapeHtml(money(preview.cash_quantity)),
          escapeHtml(money(preview.estimated_notional)),
          escapeHtml(money(preview.equity)),
          `<span class="mono">${escapeHtml(preview.approval_file)}</span>`,
          actionCell,
          escapeHtml(preview.tag),
        ]);
      }).join("")
    : row([`<span class="muted">Order previews appear when execution.require_order_approval holds orders for operator approval.</span>`, "", "", "", "", "", "", "", "", "", "", "", ""]);

  const fills = artifacts.fills || [];
  $("artifact-fills-body").innerHTML = fills.length
    ? fills.map((fill) => row([
        escapeHtml(fill.timestamp),
        escapeHtml(fill.symbol),
        escapeHtml(fill.side),
        escapeHtml(fill.quantity),
        escapeHtml(fill.price),
        escapeHtml(fill.commission),
        escapeHtml(fill.simulated),
        escapeHtml(fill.tag),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", ""]);

  const account = artifacts.account || [];
  $("artifact-account-note").textContent = account.length
    ? `${numberText(account.length, 0)} sanitized account snapshot${account.length === 1 ? "" : "s"}`
    : "No account snapshots in this artifact";
  $("artifact-account-body").innerHTML = account.length
    ? account.map((snapshot) => row([
        escapeHtml(snapshot.timestamp),
        escapeHtml(text(snapshot.step)),
        escapeHtml(text(snapshot.mode)),
        escapeHtml(money(snapshot.cash)),
        escapeHtml(money(snapshot.equity)),
        escapeHtml(money(snapshot.gross_exposure)),
        escapeHtml(money(snapshot.net_exposure)),
        jsonDrilldown(snapshot.positions || {}, `${numberText(nonzeroObjectCount(snapshot.positions), 0)} open`),
        positionSnapshotDrilldown(snapshot),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", ""]);
}

function renderRuns() {
  const runs = (state.status && state.status.runs) || [];
  renderRunsFilterOptions(runs);
  const visibleRuns = sortedRuns(filteredRuns(runs));
  renderCurrentOrdersAndPositions();
  renderRunsTriage();
  renderRunsWorkflowLauncher();
  renderRunsAccountBoundary();
  renderRunsSearchAssistant(runs, visibleRuns);
  $("runs-table-note").textContent = `${numberText(visibleRuns.length, 0)} shown / ${numberText(runs.length, 0)} published run${runs.length === 1 ? "" : "s"}`;
  $("runs-body").innerHTML = visibleRuns.length
    ? visibleRuns.map((run) => {
        const metrics = run.metrics || {};
        return row([
          escapeHtml(run.id),
          statusText(run.status),
          escapeHtml(metrics.mode),
          escapeHtml(metrics.decisions),
          escapeHtml(metrics.orders),
          escapeHtml(metrics.fills),
          escapeHtml(metrics.rejections),
          escapeHtml(money(metrics.final_equity)),
          escapeHtml(metrics.last_decision_time),
          `<span class="${statusClass((run.freshness || {}).stale ? "warn" : "ok")}">${escapeHtml(age((run.freshness || {}).age_seconds))}</span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No published runs match the current filters.</span>`, "", "", "", "", "", "", "", "", ""]);
}

function runsFilterState() {
  return {
    text: ($("runs-filter-text").value || "").trim().toLowerCase(),
    status: $("runs-filter-status").value || "",
    mode: $("runs-filter-mode").value || "",
    sort: $("runs-filter-sort").value || "age_asc",
  };
}

function runMetricsNumber(run, key) {
  return Number(((run || {}).metrics || {})[key] || 0);
}

function runsNestedCount(rows, getter) {
  const counts = {};
  for (const item of rows || []) {
    const value = text(getter(item));
    if (!value || value === "n/a") continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function recommendedRuns(filtered = []) {
  return (filtered || [])
    .slice()
    .sort((left, right) => {
      const leftRejects = runMetricsNumber(left, "rejections");
      const rightRejects = runMetricsNumber(right, "rejections");
      if (leftRejects !== rightRejects) return rightRejects - leftRejects;
      const leftFills = runMetricsNumber(left, "fills");
      const rightFills = runMetricsNumber(right, "fills");
      if (leftFills !== rightFills) return rightFills - leftFills;
      const leftOrders = runMetricsNumber(left, "orders");
      const rightOrders = runMetricsNumber(right, "orders");
      if (leftOrders !== rightOrders) return rightOrders - leftOrders;
      const leftAge = Number((left.freshness || {}).age_seconds);
      const rightAge = Number((right.freshness || {}).age_seconds);
      if (Number.isFinite(leftAge) && Number.isFinite(rightAge) && leftAge !== rightAge) return leftAge - rightAge;
      return text(left.id).localeCompare(text(right.id));
    })
    .slice(0, 5);
}

function renderRunsSearchAssistant(runs = [], visibleRuns = []) {
  if (!$("runs-search-title") || !$("runs-search-cards") || !$("runs-search-actions")) return;
  const filters = runsFilterState();
  const activeLabels = [
    filters.text ? `search ${filters.text}` : "",
    filters.status ? `status ${filters.status}` : "",
    filters.mode ? `mode ${filters.mode}` : "",
  ].filter(Boolean);
  const hidden = Math.max(0, runs.length - visibleRuns.length);
  const statusCounts = runsNestedCount(visibleRuns, (run) => run.status);
  const modeCounts = runsNestedCount(visibleRuns, (run) => (run.metrics || {}).mode);
  const staleRuns = visibleRuns.filter((run) => (run.freshness || {}).stale);
  const decisions = visibleRuns.reduce((sum, run) => sum + runMetricsNumber(run, "decisions"), 0);
  const orders = visibleRuns.reduce((sum, run) => sum + runMetricsNumber(run, "orders"), 0);
  const fills = visibleRuns.reduce((sum, run) => sum + runMetricsNumber(run, "fills"), 0);
  const rejects = visibleRuns.reduce((sum, run) => sum + runMetricsNumber(run, "rejections"), 0);
  const newestAge = visibleRuns
    .map((run) => Number((run.freshness || {}).age_seconds))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  $("runs-search-title").textContent = runs.length
    ? activeLabels.length
      ? `${numberText(visibleRuns.length, 0)} matching run${visibleRuns.length === 1 ? "" : "s"}`
      : `${numberText(runs.length, 0)} searchable run${runs.length === 1 ? "" : "s"}`
    : "No runs loaded";
  $("runs-search-note").textContent = runs.length
    ? activeLabels.length
      ? `${activeLabels.join(" / ")}. ${numberText(hidden, 0)} run${hidden === 1 ? "" : "s"} hidden by filters.`
      : "Use the filters to find stale, rejected, filled, active, replay, shadow, paper, or simulated-paper runs."
    : "No current published run telemetry is available yet.";
  const cards = [
    {
      label: "Visible Runs",
      status: visibleRuns.length ? "ok" : runs.length ? "warn" : "bad",
      title: `${numberText(visibleRuns.length, 0)} / ${numberText(runs.length, 0)}`,
      note: hidden ? `${numberText(hidden, 0)} hidden by filters.` : "All published runs are visible.",
    },
    {
      label: "Status / Mode",
      status: visibleRuns.length ? "ok" : "warn",
      title: countSummary(statusCounts),
      note: `Modes: ${countSummary(modeCounts)}.`,
    },
    {
      label: "Freshness",
      status: staleRuns.length ? "warn" : visibleRuns.length ? "ok" : "bad",
      title: Number.isFinite(newestAge) ? age(newestAge) : "n/a",
      note: staleRuns.length
        ? `${numberText(staleRuns.length, 0)} visible run${staleRuns.length === 1 ? "" : "s"} marked stale.`
        : "No visible run is marked stale.",
    },
    {
      label: "Execution",
      status: rejects ? "bad" : fills ? "ok" : orders ? "warn" : visibleRuns.length ? "warn" : "bad",
      title: `${numberText(fills, 0)} fills / ${numberText(rejects, 0)} rejects`,
      note: `${numberText(orders, 0)} orders and ${numberText(decisions, 0)} decisions across visible runs.`,
    },
  ];
  $("runs-search-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const recommendations = recommendedRuns(visibleRuns);
  $("runs-search-actions").innerHTML = recommendations.length
    ? recommendations.map((run) => {
        const metrics = run.metrics || {};
        const runRejects = Number(metrics.rejections || 0);
        const runFills = Number(metrics.fills || 0);
        const status = runRejects ? "bad" : (run.freshness || {}).stale ? "warn" : runFills ? "ok" : "warn";
        return `
          <div class="runs-search-action-card status-${escapeHtml(status)}">
            <div>
              <span>${statusText(status)}</span>
              <strong>${escapeHtml(text(run.id))}</strong>
              <small>${escapeHtml(text(run.status))} / ${escapeHtml(text(metrics.mode))} / age ${escapeHtml(age((run.freshness || {}).age_seconds))}</small>
              <small>${escapeHtml(numberText(metrics.decisions, 0))} decisions / ${escapeHtml(numberText(metrics.orders, 0))} orders / ${escapeHtml(numberText(metrics.fills, 0))} fills / ${escapeHtml(numberText(metrics.rejections, 0))} rejects</small>
            </div>
            <div>
              <button type="button" data-runs-search-action="events" data-run-id="${escapeHtml(text(run.id))}">Events</button>
              <button type="button" class="secondary" data-runs-search-action="status" data-status="${escapeHtml(text(run.status))}">Status</button>
              <button type="button" class="secondary" data-runs-search-action="mode" data-mode="${escapeHtml(text(metrics.mode))}">Mode</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No recommended runs</strong><span>Clear filters or wait for published run telemetry.</span></div>`;
}

function handleRunsSearchAction(target) {
  const action = String(target.dataset.runsSearchAction || "");
  if (action === "events") {
    $("run-events-filter-text").value = target.dataset.runId || "";
    renderRunEvents();
    navigateToRunsLens("events");
    return;
  }
  if (action === "status") {
    $("runs-filter-status").value = target.dataset.status || "";
    renderRuns();
    return;
  }
  if (action === "mode") {
    $("runs-filter-mode").value = target.dataset.mode || "";
    renderRuns();
  }
}

function renderRunsFilterOptions(runs) {
  const makeOptions = (id, values) => {
    const select = $(id);
    if (!select) return;
    const current = select.value;
    const options = Array.from(new Set(values.map(text).filter((value) => value !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) select.value = current;
  };
  makeOptions("runs-filter-status", runs.map((run) => run.status));
  makeOptions("runs-filter-mode", runs.map((run) => (run.metrics || {}).mode));
}

function filteredRuns(runs) {
  const query = ($("runs-filter-text").value || "").trim().toLowerCase();
  const status = $("runs-filter-status").value || "";
  const mode = $("runs-filter-mode").value || "";
  return (runs || []).filter((run) => {
    const metrics = run.metrics || {};
    if (status && text(run.status) !== status) return false;
    if (mode && text(metrics.mode) !== mode) return false;
    if (!query) return true;
    const haystack = [
      run.id,
      run.status,
      metrics.mode,
      metrics.decisions,
      metrics.orders,
      metrics.fills,
      metrics.rejections,
      metrics.final_equity,
      metrics.last_decision_time,
    ].map(text).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function runSortMetric(run, sortMode) {
  const metrics = run.metrics || {};
  if (sortMode === "age_asc" || sortMode === "age_desc") return Number((run.freshness || {}).age_seconds);
  if (sortMode === "decisions_desc") return Number(metrics.decisions);
  if (sortMode === "fills_desc") return Number(metrics.fills);
  if (sortMode === "rejects_desc") return Number(metrics.rejections);
  if (sortMode === "equity_desc") return Number(metrics.final_equity);
  return text(run.id);
}

function sortedRuns(runs) {
  const sortMode = $("runs-filter-sort").value || "age_asc";
  const ascending = sortMode === "age_asc" || sortMode === "id_asc";
  return (runs || []).map((run, index) => ({
    run,
    index,
    metric: runSortMetric(run, sortMode),
  })).sort((left, right) => {
    if (typeof left.metric === "string" || typeof right.metric === "string") {
      const result = String(left.metric).localeCompare(String(right.metric));
      return result || left.index - right.index;
    }
    const leftFinite = Number.isFinite(left.metric);
    const rightFinite = Number.isFinite(right.metric);
    if (!leftFinite && !rightFinite) return left.index - right.index;
    if (!leftFinite) return 1;
    if (!rightFinite) return -1;
    if (left.metric === right.metric) return left.index - right.index;
    return ascending ? left.metric - right.metric : right.metric - left.metric;
  }).map((item) => item.run);
}

function renderRunsTriage() {
  if (!$("runs-triage-cards") || !$("runs-triage-note")) return;
  const runs = (state.status && state.status.runs) || [];
  const history = state.history || [];
  const orders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const positions = nonzeroPositionsFromSource(source);
  const events = runEventRows();
  const latestRun = runs[0] || null;
  const latestMetrics = (latestRun && latestRun.metrics) || {};
  const fills = events.filter((event) => event.type === "fill");
  const rejectedOrders = events.filter((event) => event.type === "order" && eventStatusIsBad(event));
  const latestEvent = events[0] || null;
  const artifactLoaded = Boolean(state.configArtifacts && (state.configArtifacts.run_id || state.configArtifacts.draft_id));
  let nextStatus = "bad";
  let nextTitle = "Start Runner";
  let nextNote = "No run telemetry is currently published.";
  if (runs.length) {
    if (orders.length) {
      nextStatus = "warn";
      nextTitle = "Review Orders";
      nextNote = "Non-terminal order telemetry is present; verify broker/account state.";
    } else if (rejectedOrders.length) {
      nextStatus = "bad";
      nextTitle = "Inspect Rejects";
      nextNote = "Recent rejected/canceled order events need review before trusting the run.";
    } else if (positions.length) {
      nextStatus = "warn";
      nextTitle = "Review Positions";
      nextNote = "Managed positions are open; check intended hold and exit context.";
    } else if (!events.length) {
      nextStatus = "warn";
      nextTitle = "Await Events";
      nextNote = "Run telemetry exists but no recent decisions, orders, or fills were published.";
    } else {
      nextStatus = "ok";
      nextTitle = "Inspect Timeline";
      nextNote = "Recent run activity is available; use tables below for decisions, orders, fills, and artifacts.";
    }
  } else if (history.length) {
    nextStatus = "warn";
    nextTitle = "Check Status";
    nextNote = "Status history exists but no current run list is published.";
  }
  const cards = [
    {
      status: runs.length ? "ok" : history.length ? "warn" : "bad",
      title: numberText(runs.length, 0),
      label: "Published Runs",
      note: latestRun
        ? `${text(latestRun.id)} ${text(latestRun.status)} / ${text(latestMetrics.mode)} / age ${age((latestRun.freshness || {}).age_seconds)}.`
        : history.length
          ? `${numberText(history.length, 0)} status snapshots, no current run payload.`
          : "No current runs published.",
    },
    {
      status: orders.length ? "warn" : "ok",
      title: numberText(orders.length, 0),
      label: "Open Orders",
      note: orders.length
        ? `${text(orders[0].symbol)} ${text(orders[0].side)} ${text(orders[0].status)} is the latest non-terminal order.`
        : "No recent non-terminal order telemetry.",
    },
    {
      status: positions.length ? "warn" : runs.length ? "ok" : "bad",
      title: numberText(positions.length, 0),
      label: "Positions",
      note: positions.length
        ? `${positions.slice(0, 3).map((position) => position.symbol).join(", ")}${positions.length > 3 ? "..." : ""} open from selected/current account source.`
        : "Latest selected/current account source is flat or missing.",
    },
    {
      status: events.length ? rejectedOrders.length ? "warn" : "ok" : runs.length ? "warn" : "bad",
      title: numberText(events.length, 0),
      label: "Recent Events",
      note: latestEvent
        ? `${text(latestEvent.type)} ${text(latestEvent.status)} ${text(latestEvent.symbol)} at ${text(latestEvent.timestamp)}.`
        : "No recent decisions, orders, or fills published.",
    },
    {
      status: rejectedOrders.length ? "bad" : fills.length ? "ok" : events.length ? "warn" : "bad",
      title: `${numberText(fills.length, 0)} fills / ${numberText(rejectedOrders.length, 0)} rejects`,
      label: "Execution",
      note: rejectedOrders.length
        ? "Review rejected or canceled order detail before continuing."
        : fills.length
          ? "Recent fills are visible in the run event tables."
          : "No fill telemetry in the recent event window.",
    },
    {
      status: artifactLoaded ? "ok" : runs.length ? "warn" : "bad",
      title: artifactLoaded ? "Loaded" : "Not Loaded",
      label: "Artifact Detail",
      note: artifactLoaded
        ? `${text((state.configArtifacts || {}).draft_id)} ${text((state.configArtifacts || {}).run_id || "latest output")} loaded.`
        : "Open a saved run artifact from Workbench or Performance for full sanitized detail.",
    },
    {
      status: nextStatus,
      title: nextTitle,
      label: "Next Action",
      note: nextNote,
    },
  ];
  $("runs-triage-note").textContent = `${numberText(runs.length, 0)} runs / ${numberText(orders.length, 0)} open orders / ${numberText(positions.length, 0)} positions / ${numberText(events.length, 0)} recent events`;
  $("runs-triage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function runsWorkflowCards() {
  const runs = (state.status && state.status.runs) || [];
  const history = state.history || [];
  const orders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const positions = nonzeroPositionsFromSource(source);
  const events = runEventRows();
  const fills = events.filter((event) => event.type === "fill");
  const rejectedOrders = events.filter((event) => event.type === "order" && eventStatusIsBad(event));
  const latestEvent = events[0] || null;
  const artifactLoaded = Boolean(state.configArtifacts && (state.configArtifacts.run_id || state.configArtifacts.draft_id));
  const savedRuns = (state.configRuns && state.configRuns.runs) || [];
  const visibleRuns = sortedRuns(filteredRuns(runs));
  const sourceLabel = source.label || source.source_type || "source";
  return [
    {
      label: "Current State",
      title: runs.length ? `${numberText(runs.length, 0)} Published` : savedRuns.length ? `${numberText(savedRuns.length, 0)} Saved` : "No Runs",
      value: history.length ? `${numberText(history.length, 0)} snapshots` : "no history",
      status: runs.length ? "ok" : savedRuns.length || history.length ? "warn" : "bad",
      detail: runs.length
        ? "Review current telemetry, account boundary, open orders, and positions before reading archived tables."
        : savedRuns.length ? "Saved Workbench runs exist, but no current runner telemetry is publishing." : "Start or publish a runner before Runs can answer current strategy state.",
      href: workflowHref("runs", "state"),
      cta: "State",
    },
    {
      label: "Open Orders",
      title: orders.length ? `${numberText(orders.length, 0)} Open` : "No Open Orders",
      value: rejectedOrders.length ? `${numberText(rejectedOrders.length, 0)} rejects` : "orders clear",
      status: rejectedOrders.length ? "bad" : orders.length ? "warn" : runs.length || artifactLoaded ? "ok" : "bad",
      detail: rejectedOrders.length
        ? "Rejected or canceled order telemetry is present; inspect broker/account state before trusting the run."
        : orders.length ? "Non-terminal order telemetry is visible; reconcile it with broker state." : "No recent non-terminal order telemetry is visible.",
      href: workflowHref("runs", "state"),
      cta: "Orders",
    },
    {
      label: "Positions",
      title: positions.length ? `${numberText(positions.length, 0)} Open` : "No Positions",
      value: text(sourceLabel),
      status: positions.length ? "warn" : source.has_data ? "ok" : "bad",
      detail: positions.length
        ? `${positions.slice(0, 4).map((position) => text(position.symbol)).join(", ")}${positions.length > 4 ? "..." : ""} open in the selected/current account source.`
        : source.has_data ? "Selected/current account source is flat or lacks nonzero positions." : "Load telemetry or artifacts with account snapshots to verify position state.",
      href: workflowHref("runs", "state"),
      cta: "Positions",
    },
    {
      label: "Event Timeline",
      title: events.length ? `${numberText(events.length, 0)} Events` : "No Events",
      value: latestEvent ? text(latestEvent.type) : "empty",
      status: rejectedOrders.length ? "bad" : events.length ? "ok" : runs.length ? "warn" : "bad",
      detail: latestEvent
        ? `Latest ${text(latestEvent.type)} ${text(latestEvent.status)} ${text(latestEvent.symbol)} at ${text(latestEvent.timestamp)}.`
        : "No recent decisions, orders, fills, or rejects are published.",
      href: workflowHref("runs", "events"),
      cta: "Events",
    },
    {
      label: "Run Search",
      title: visibleRuns.length ? `${numberText(visibleRuns.length, 0)} Shown` : "No Matches",
      value: runs.length ? `${numberText(runs.length, 0)} total` : `${numberText(savedRuns.length, 0)} saved`,
      status: visibleRuns.length ? "ok" : runs.length || savedRuns.length ? "warn" : "bad",
      detail: visibleRuns.length
        ? "Open the filtered run table for status, mode, freshness, decisions, orders, fills, and rejects."
        : runs.length ? "Current filters hide all published runs; adjust search, status, mode, or sort." : "No published run table is available yet.",
      href: workflowHref("runs", "runs"),
      cta: "Search",
    },
    {
      label: "Loaded Artifacts",
      title: artifactLoaded ? "Loaded" : savedRuns.length ? "Available" : "No Artifact",
      value: artifactLoaded
        ? text((state.configArtifacts || {}).run_id || (state.configArtifacts || {}).draft_id)
        : savedRuns.length ? `${numberText(savedRuns.length, 0)} saved` : "missing",
      status: artifactLoaded ? "ok" : savedRuns.length ? "warn" : "bad",
      detail: artifactLoaded
        ? `Loaded artifacts expose decisions, fills, logs, account rows, and Performance charts; ${numberText(fills.length, 0)} recent fills are also visible.`
        : savedRuns.length ? "Open a saved Workbench run artifact for full sanitized detail." : "Run or load a Workbench artifact to inspect replay/simulated-paper evidence.",
      href: workflowHref(artifactLoaded ? "performance" : "workbench", artifactLoaded ? "home" : "artifacts"),
      cta: artifactLoaded ? "Performance" : "Artifacts",
    },
  ];
}

function renderRunsWorkflowLauncher() {
  const container = $("runs-workflows");
  if (!container) return;
  const cards = runsWorkflowCards();
  container.innerHTML = cards.map((card) => `
    <a class="action-card workflow-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <div class="workflow-card-foot">
        <em>${escapeHtml(card.value)}</em>
        <b>${escapeHtml(card.cta)}</b>
      </div>
    </a>
  `).join("");
}

function accountBoundaryAuthority(mode, source) {
  const value = String(mode || "").replace("-", "_").toLowerCase();
  if (value === "live") return ["bad", "Live Orders", "Live account mode; do not treat dashboard controls or results as harmless."];
  if (value === "paper") return ["warn", "Broker Paper", "Broker paper account mode; orders may be submitted to a paper account."];
  if (value === "simulated_paper") return ["ok", "Local Sim", "Local simulated-paper state; fills and account values are simulated."];
  if (value === "shadow") return ["ok", "Observe Only", "Shadow state should log signals without submitting orders."];
  if (value === "replay") return ["ok", "Historical", "Replay state comes from saved files and archived artifacts."];
  if (source && source.source_type === "archived_artifact") return ["warn", "Archived", "Mode is missing; inspect artifact metadata before interpreting account state."];
  return ["bad", "Unknown", "Mode is unavailable; verify the runner source before interpreting account state."];
}

function renderRunsAccountBoundary() {
  if (!$("runs-account-boundary-cards") || !$("runs-account-boundary-note")) return;
  const source = latestArtifactPerformance();
  const summary = source.summary || {};
  const perf = source.performance || {};
  const accountRow = latestAccountRow(source.account || []);
  const positions = nonzeroPositionsFromSource(source);
  const mode = perf.mode ?? summary.mode;
  const authority = accountBoundaryAuthority(mode, source);
  const runs = (state.status && state.status.runs) || [];
  const orders = currentOpenOrderRows();
  const hasAccountSnapshots = Boolean(source.account && source.account.length);
  const hasTelemetryRuns = runs.length > 0;
  const sourceStatus = source.has_data
    ? source.source_type === "live_telemetry" ? "warn" : "ok"
    : "bad";
  let nextStatus = "bad";
  let nextTitle = "Load State";
  let nextNote = "Publish telemetry or open archived artifacts before trusting account-state tables.";
  if (source.has_data && !hasAccountSnapshots && source.source_type === "run_summary") {
    nextStatus = "warn";
    nextTitle = "Open Artifact";
    nextNote = "Summary-only runs do not prove current positions or account freshness.";
  } else if (orders.length) {
    nextStatus = "warn";
    nextTitle = "Verify Orders";
    nextNote = "Non-terminal order telemetry exists; reconcile it with broker/account state.";
  } else if (source.has_data && String(mode || "").toLowerCase() === "live") {
    nextStatus = "bad";
    nextTitle = "Live Caution";
    nextNote = "Live mode requires stronger operational review before taking action.";
  } else if (source.has_data) {
    nextStatus = "ok";
    nextTitle = "Review Detail";
    nextNote = "Boundary is clear enough to inspect positions, events, and artifacts below.";
  }
  const cards = [
    {
      status: sourceStatus,
      title: text(source.source_type),
      label: "Selected Source",
      note: sourceMeaning(source),
    },
    {
      status: authority[0],
      title: authority[1],
      label: "Order Authority",
      note: authority[2],
    },
    {
      status: hasAccountSnapshots ? "ok" : source.has_data ? "warn" : "bad",
      title: hasAccountSnapshots ? numberText(source.account.length, 0) : "None",
      label: "Account Snapshots",
      note: hasAccountSnapshots
        ? `Latest ${shortTimestampAgeLabel(accountRow.timestamp)} from ${text(source.label)}.`
        : "No account snapshot rows loaded for this source.",
    },
    {
      status: positions.length ? "warn" : source.has_data ? "ok" : "bad",
      title: numberText(positions.length, 0),
      label: "Managed Positions",
      note: positions.length
        ? `${positions.slice(0, 4).map((position) => position.symbol).join(", ")}${positions.length > 4 ? "..." : ""} open in selected source.`
        : "Selected source is flat or lacks position detail.",
    },
    {
      status: hasTelemetryRuns ? "ok" : source.source_type === "archived_artifact" ? "warn" : "bad",
      title: numberText(runs.length, 0),
      label: "Current Telemetry",
      note: hasTelemetryRuns
        ? `${numberText(runs.length, 0)} published run${runs.length === 1 ? "" : "s"} in current status.`
        : "No current published run list; archived data may be historical only.",
    },
    {
      status: orders.length ? "warn" : "ok",
      title: numberText(orders.length, 0),
      label: "Open-Order Signal",
      note: orders.length
        ? "Recent non-terminal order telemetry is visible below."
        : "No recent non-terminal order telemetry.",
    },
    {
      status: nextStatus,
      title: nextTitle,
      label: "Next Action",
      note: nextNote,
    },
  ];
  $("runs-account-boundary-note").textContent = `${text(source.label)} / ${text(mode)} / ${numberText(positions.length, 0)} positions / ${numberText(orders.length, 0)} open-order events`;
  $("runs-account-boundary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function terminalOrderStatus(status) {
  const value = String(status || "").toLowerCase();
  return [
    "filled",
    "cancelled",
    "canceled",
    "rejected",
    "inactive",
    "expired",
    "done",
  ].includes(value);
}

function currentOpenOrderRows() {
  const runs = (state.status && state.status.runs) || [];
  const orders = [];
  for (const run of runs) {
    for (const orderItem of ((run.recent_events || {}).orders || [])) {
      if (terminalOrderStatus(orderItem.status)) continue;
      orders.push({
        run_id: run.id,
        timestamp: orderItem.timestamp,
        status: orderItem.status,
        symbol: orderItem.symbol,
        side: orderItem.side,
        order_type: orderItem.order_type,
        quantity: orderItem.quantity,
        cash_quantity: orderItem.cash_quantity,
        reason: orderItem.reason,
        tag: orderItem.tag,
      });
    }
  }
  return orders
    .filter((item) => item.timestamp || item.symbol || item.status)
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
    .slice(0, 20);
}

function renderCurrentOrdersAndPositions() {
  const orders = currentOpenOrderRows();
  $("current-orders-note").textContent = orders.length
    ? `${numberText(orders.length, 0)} recent non-terminal order event${orders.length === 1 ? "" : "s"}`
    : "No recent non-terminal order events";
  $("current-orders-body").innerHTML = orders.length
    ? orders.map((orderItem) => row([
        escapeHtml(orderItem.timestamp),
        escapeHtml(orderItem.run_id),
        statusText(orderItem.status),
        escapeHtml(orderItem.symbol),
        escapeHtml(orderItem.side),
        escapeHtml(orderItem.order_type),
        escapeHtml(orderItem.quantity ?? orderItem.cash_quantity ?? ""),
        escapeHtml([orderItem.reason, orderItem.tag].filter(Boolean).join(" / ")),
      ])).join("")
    : row([`<span class="muted">No recent open-order telemetry. Broker open-order state requires runners to publish open orders.</span>`, "", "", "", "", "", "", ""]);

  const source = latestArtifactPerformance();
  const accountRow = latestAccountRow(source.account || []);
  const positions = nonzeroPositionsFromSource(source);
  $("current-positions-note").textContent = source.account && source.account.length
    ? `Snapshot ${text(accountRow.timestamp)}`
    : "Latest selected/published summary";
  $("current-positions-grid").innerHTML = positions.length
    ? positions.map((position) => `
        <div class="position-card">
          <span>${escapeHtml(position.symbol)}</span>
          <strong>${escapeHtml(numberText(position.quantity, 4))}</strong>
          ${positionDetailHtml(position, { includeQuantity: false })}
        </div>
      `).join("")
    : `<div class="empty-card"><strong>No managed positions</strong><span>The latest selected or published account state is flat, or no account snapshot has been loaded.</span></div>`;
}

function runEventRows() {
  const runs = (state.status && state.status.runs) || [];
  const events = [];
  for (const run of runs) {
    const recent = run.recent_events || {};
    for (const event of recent.decisions || []) {
      const symbols = Array.isArray(event.symbols)
        ? event.symbols
        : event.symbol ? [event.symbol] : [];
      const detail = [
        event.status ? `status=${text(event.status)}` : "",
        event.reason ? `reason=${text(event.reason)}` : "",
        event.intents !== undefined ? `intents=${text(event.intents)}` : "",
        event.step !== undefined ? `step=${text(event.step)}` : "",
      ].filter(Boolean).join(" ");
      events.push({
        run_id: run.id,
        type: "decision",
        timestamp: event.timestamp,
        status: event.paused ? "paused" : "ok",
        symbol: symbols.join(", "),
        detail: detail || "decision checked",
      });
    }
    for (const event of recent.orders || []) {
      events.push({
        run_id: run.id,
        type: "order",
        timestamp: event.timestamp,
        status: event.status,
        symbol: event.symbol,
        detail: `${text(event.side)} ${text(event.order_type)} qty=${text(event.quantity)} cash=${text(event.cash_quantity)} reason=${text(event.reason)} tag=${text(event.tag)}`,
      });
    }
    for (const event of recent.fills || []) {
      events.push({
        run_id: run.id,
        type: "fill",
        timestamp: event.timestamp,
        status: "filled",
        symbol: event.symbol,
        detail: `${text(event.side)} qty=${text(event.quantity)} price=${text(event.price)} commission=${text(event.commission)} tag=${text(event.tag)}`,
      });
    }
  }
  return events
    .filter((event) => event.timestamp)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 30);
}

function eventActivityKey(event) {
  return [
    event.type,
    event.run_id,
    event.timestamp,
    event.status,
    event.symbol,
    event.detail,
  ].map(text).join("|");
}

function fetchActivityKey(item) {
  return text(item.job_id || item.path || `${item.started_at}-${item.kind}-${item.bar_size}`);
}

function alertActivityKey(item) {
  return [item.status, item.severity, item.category, item.message, item.detail].map(text).join("|");
}

function terminalFetchStatus(status) {
  const value = String(status || "").toLowerCase();
  return [
    "complete",
    "completed",
    "done",
    "success",
    "failed",
    "error",
    "cancelled",
    "canceled",
  ].includes(value);
}

function activitySnapshot() {
  const events = runEventRows();
  const fetches = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const alerts = (state.status && state.status.alerts) || [];
  return {
    eventKeys: new Set(events.map(eventActivityKey)),
    fetchByKey: new Map(fetches.map((item) => [fetchActivityKey(item), item])),
    alertKeys: new Set(alerts.map(alertActivityKey)),
    counts: {
      events: events.length,
      fetches: fetches.length,
      alerts: alerts.length,
    },
  };
}

function eventChangeCard(event) {
  const status = event.type === "fill"
    ? "ok"
    : String(event.status || "").toLowerCase().includes("reject") || String(event.status || "").toLowerCase().includes("cancel")
      ? "bad"
      : event.type === "order" ? "warn" : "ok";
  const label = event.type === "fill"
    ? `Fill ${text(event.symbol)}`
    : event.type === "order"
      ? `Order ${text(event.symbol)}`
      : `Decision ${text(event.run_id)}`;
  return {
    status,
    title: label,
    detail: `${text(event.timestamp)} - ${text(event.detail)}`,
  };
}

function activityChanges(before, after) {
  if (!before) {
    return {
      initial: true,
      items: [{
        status: "ok",
        title: "Initial snapshot loaded",
        detail: `${numberText(after.counts.events, 0)} events / ${numberText(after.counts.fetches, 0)} fetch jobs / ${numberText(after.counts.alerts, 0)} alerts`,
      }],
    };
  }
  const items = [];
  for (const event of runEventRows()) {
    if (!before.eventKeys.has(eventActivityKey(event))) {
      items.push(eventChangeCard(event));
    }
  }
  for (const [key, item] of after.fetchByKey.entries()) {
    const previous = before.fetchByKey.get(key);
    const status = text(item.status);
    if (!previous && terminalFetchStatus(status)) {
      items.push({
        status: status.toLowerCase().includes("fail") || status.toLowerCase().includes("error") ? "bad" : "ok",
        title: `Fetch ${status}`,
        detail: `${text(item.kind)} ${text(item.bar_size)} rows=${numberText(item.rows, 0)} errors=${numberText(item.errors, 0)}`,
      });
    } else if (previous && text(previous.status) !== status && terminalFetchStatus(status)) {
      items.push({
        status: status.toLowerCase().includes("fail") || status.toLowerCase().includes("error") ? "bad" : "ok",
        title: `Fetch changed to ${status}`,
        detail: `${text(item.kind)} ${text(item.bar_size)} rows=${numberText(item.rows, 0)} errors=${numberText(item.errors, 0)}`,
      });
    }
  }
  const alerts = (state.status && state.status.alerts) || [];
  for (const alert of alerts) {
    if (!before.alertKeys.has(alertActivityKey(alert))) {
      items.push({
        status: "bad",
        title: text(alert.category || alert.status || alert.severity || "Alert"),
        detail: text(alert.message || alert.detail || JSON.stringify(alert)),
      });
    }
  }
  return { initial: false, items: items.slice(0, 12) };
}

function overviewChangeCardsHtml(items, emptyText) {
  return items.length
    ? items.map((item) => `
        <div class="change-card">
          <span>${statusText(item.status)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.detail)}</small>
        </div>
      `).join("")
    : `<div class="empty-card"><strong>No new activity</strong><span>${escapeHtml(emptyText)}</span></div>`;
}

function renderOverviewChanges() {
  const changes = state.activityChanges || { items: [], initial: true };
  const items = changes.items || [];
  const detailNote = changes.initial
    ? "Current refresh baseline"
    : items.length ? `${numberText(items.length, 0)} change${items.length === 1 ? "" : "s"} since prior refresh` : "No new activity since prior refresh";
  const summaryItems = changes.initial ? items : items.slice(0, 3);
  if ($("overview-changes-note")) $("overview-changes-note").textContent = detailNote;
  if ($("overview-change-cards")) {
    $("overview-change-cards").innerHTML = overviewChangeCardsHtml(
      items,
      "No new recent signals, orders, fills, alerts, or completed fetch jobs since the previous refresh.",
    );
  }
  if ($("overview-change-summary-note")) {
    $("overview-change-summary-note").textContent = changes.initial
      ? "Current refresh baseline"
      : items.length ? `${numberText(items.length, 0)} new activity item${items.length === 1 ? "" : "s"}` : "No new activity since prior refresh";
  }
  if ($("overview-change-summary-cards")) {
    $("overview-change-summary-cards").innerHTML = overviewChangeCardsHtml(
      summaryItems,
      "No new signals, orders, fills, alerts, or completed fetches since the prior refresh.",
    );
  }
}

function renderRunEvents() {
  const allEvents = runEventRows();
  renderRunEventFilterOptions(allEvents);
  const events = sortedRunEvents(filteredRunEvents(allEvents));
  renderRunsEventsAssistant(allEvents, events);
  $("run-events-note").textContent = `${numberText(events.length, 0)} shown / ${numberText(allEvents.length, 0)} recent event${allEvents.length === 1 ? "" : "s"}`;
  $("run-events-body").innerHTML = events.length
    ? events.map((event) => row([
        escapeHtml(event.timestamp),
        escapeHtml(event.run_id),
        escapeHtml(event.type),
        statusText(event.status),
        escapeHtml(event.symbol),
        escapeHtml(event.detail),
      ])).join("")
    : row([`<span class="muted">No recent run events match the current filters.</span>`, "", "", "", "", ""]);
}

function renderRunsEventsAssistant(allEvents = [], visibleEvents = []) {
  if (!$("runs-events-assistant-title") || !$("runs-events-assistant-cards") || !$("runs-events-assistant-actions")) return;
  const filters = {
    text: ($("run-events-filter-text").value || "").trim(),
    type: $("run-events-filter-type").value || "",
    status: $("run-events-filter-status").value || "",
    sort: $("run-events-filter-sort").value || "time_desc",
  };
  const hidden = Math.max(0, allEvents.length - visibleEvents.length);
  const latest = visibleEvents[0] || allEvents[0] || null;
  const badEvents = visibleEvents.filter(eventStatusIsBad);
  const allBadEvents = allEvents.filter(eventStatusIsBad);
  const fills = visibleEvents.filter((event) => event.type === "fill");
  const orders = visibleEvents.filter((event) => event.type === "order");
  const decisions = visibleEvents.filter((event) => event.type === "decision");
  const symbols = new Set(visibleEvents.map((event) => text(event.symbol)).filter((value) => value && value !== "n/a"));
  const runs = new Set(visibleEvents.map((event) => text(event.run_id)).filter((value) => value && value !== "n/a"));
  const activeFilters = [
    filters.text ? `search ${filters.text}` : "",
    filters.type ? `type ${filters.type}` : "",
    filters.status ? `status ${filters.status}` : "",
  ].filter(Boolean);
  let status = "bad";
  let title = "No Events";
  let note = "No current published decisions, orders, or fills are available.";
  if (visibleEvents.length) {
    status = badEvents.length ? "bad" : fills.length ? "ok" : orders.length ? "warn" : "ok";
    title = badEvents.length ? "Review Issues" : fills.length ? "Fills Visible" : "Timeline Visible";
    note = activeFilters.length
      ? `${activeFilters.join(" / ")}. ${numberText(hidden, 0)} event${hidden === 1 ? "" : "s"} hidden.`
      : "Recent timeline activity is visible; filter for rejects, fills, orders, decisions, symbols, or runs.";
  } else if (allEvents.length) {
    status = "warn";
    title = "No Matches";
    note = "Clear or adjust filters to show recent timeline activity.";
  }
  $("runs-events-assistant-title").textContent = title;
  $("runs-events-assistant-title").className = statusClass(status);
  $("runs-events-assistant-note").textContent = note;
  const cards = [
    {
      status: visibleEvents.length ? "ok" : allEvents.length ? "warn" : "bad",
      title: `${numberText(visibleEvents.length, 0)} / ${numberText(allEvents.length, 0)}`,
      label: "Visible",
      note: hidden ? `${numberText(hidden, 0)} hidden by filters.` : "All recent events are visible.",
    },
    {
      status: badEvents.length ? "bad" : visibleEvents.length ? "ok" : "bad",
      title: numberText(badEvents.length, 0),
      label: "Issues",
      note: allBadEvents.length
        ? `${numberText(allBadEvents.length, 0)} rejected, canceled, failed, or error event${allBadEvents.length === 1 ? "" : "s"} in the recent timeline.`
        : "No bad event statuses in the recent timeline.",
    },
    {
      status: fills.length ? "ok" : orders.length ? "warn" : decisions.length ? "ok" : "bad",
      title: `${numberText(fills.length, 0)} fills`,
      label: "Mix",
      note: `${numberText(decisions.length, 0)} decisions / ${numberText(orders.length, 0)} orders visible.`,
    },
    {
      status: latest ? eventStatusIsBad(latest) ? "bad" : latest.type === "order" ? "warn" : "ok" : "bad",
      title: latest ? text(latest.type) : "n/a",
      label: "Latest",
      note: latest ? `${text(latest.timestamp)} / ${text(latest.run_id)} / ${text(latest.symbol)}` : "No latest event available.",
    },
    {
      status: runs.size ? "ok" : "bad",
      title: numberText(runs.size, 0),
      label: "Runs",
      note: `${numberText(symbols.size, 0)} symbol${symbols.size === 1 ? "" : "s"} represented in visible events.`,
    },
  ];
  $("runs-events-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const latestRunId = latest ? text(latest.run_id) : "";
  $("runs-events-assistant-actions").innerHTML = [
    {
      action: "issues",
      status: allBadEvents.length ? "bad" : "ok",
      title: "Show Issues",
      note: allBadEvents.length ? "Filter to rejected, canceled, failed, or error events." : "No issue events to isolate.",
      disabled: !allBadEvents.length,
    },
    {
      action: "fills",
      status: allEvents.some((event) => event.type === "fill") ? "ok" : "warn",
      title: "Show Fills",
      note: "Filter timeline to filled executions.",
      disabled: !allEvents.some((event) => event.type === "fill"),
    },
    {
      action: "orders",
      status: allEvents.some((event) => event.type === "order") ? "warn" : "bad",
      title: "Show Orders",
      note: "Filter timeline to submitted, canceled, rejected, or held orders.",
      disabled: !allEvents.some((event) => event.type === "order"),
    },
    {
      action: "decisions",
      status: allEvents.some((event) => event.type === "decision") ? "ok" : "bad",
      title: "Show Decisions",
      note: "Filter timeline to strategy checks and no-order decisions.",
      disabled: !allEvents.some((event) => event.type === "decision"),
    },
    {
      action: "latest-run",
      status: latestRunId ? "ok" : "bad",
      title: "Latest Run",
      note: latestRunId ? `Filter to ${latestRunId}.` : "No latest run available.",
      disabled: !latestRunId,
    },
    {
      action: "clear",
      status: activeFilters.length ? "ok" : "warn",
      title: "Clear Filters",
      note: activeFilters.length ? "Return to the full recent timeline." : "No event filters are active.",
      disabled: !activeFilters.length,
    },
  ].map((item) => `
    <button class="runs-events-assistant-action status-${escapeHtml(item.status)}" data-runs-events-action="${escapeHtml(item.action)}" data-run-id="${escapeHtml(latestRunId)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

function applyRunsEventsAssistantAction(action, runId = "") {
  if (action === "issues") {
    $("run-events-filter-text").value = "reject cancel fail error";
    $("run-events-filter-type").value = "";
    $("run-events-filter-status").value = "";
  } else if (action === "fills") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "fill";
    $("run-events-filter-status").value = "";
  } else if (action === "orders") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "order";
    $("run-events-filter-status").value = "";
  } else if (action === "decisions") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "decision";
    $("run-events-filter-status").value = "";
  } else if (action === "latest-run") {
    $("run-events-filter-text").value = runId;
    $("run-events-filter-type").value = "";
    $("run-events-filter-status").value = "";
  } else if (action === "clear") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "";
    $("run-events-filter-status").value = "";
  }
  renderRunEvents();
}

function renderRunEventFilterOptions(events) {
  const select = $("run-events-filter-status");
  if (!select) return;
  const current = select.value;
  const options = Array.from(new Set((events || []).map((event) => text(event.status)).filter((value) => value !== "n/a"))).sort();
  select.innerHTML = [
    `<option value="">All</option>`,
    ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
  ].join("");
  if (options.includes(current)) select.value = current;
}

function filteredRunEvents(events) {
  const query = ($("run-events-filter-text").value || "").trim().toLowerCase();
  const type = $("run-events-filter-type").value || "";
  const status = $("run-events-filter-status").value || "";
  return (events || []).filter((event) => {
    if (type && text(event.type) !== type) return false;
    if (status && text(event.status) !== status) return false;
    if (!query) return true;
    const haystack = [
      event.timestamp,
      event.run_id,
      event.type,
      event.status,
      event.symbol,
      event.detail,
    ].map(text).join(" ").toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    return terms.length > 1 ? terms.some((term) => haystack.includes(term)) : haystack.includes(query);
  });
}

function sortedRunEvents(events) {
  const sortMode = $("run-events-filter-sort").value || "time_desc";
  return (events || []).slice().sort((left, right) => {
    if (sortMode === "time_asc") return String(left.timestamp || "").localeCompare(String(right.timestamp || ""));
    if (sortMode === "type_asc") {
      return String(left.type || "").localeCompare(String(right.type || ""))
        || String(left.timestamp || "").localeCompare(String(right.timestamp || ""));
    }
    if (sortMode === "symbol_asc") {
      return String(left.symbol || "").localeCompare(String(right.symbol || ""))
        || String(left.timestamp || "").localeCompare(String(right.timestamp || ""));
    }
    if (sortMode === "run_asc") {
      return String(left.run_id || "").localeCompare(String(right.run_id || ""))
        || String(left.timestamp || "").localeCompare(String(right.timestamp || ""));
    }
    return String(right.timestamp || "").localeCompare(String(left.timestamp || ""));
  });
}

function renderSupervisors() {
  const supervisors = (state.status && state.status.supervisors) || [];
  $("supervisors-body").innerHTML = supervisors.length
    ? supervisors.map((supervisor) => row([
        escapeHtml(supervisor.id),
        statusText(supervisor.status),
        escapeHtml((supervisor.jobs || []).length),
        escapeHtml(supervisor.generated_at),
        `<span class="${statusClass((supervisor.freshness || {}).stale ? "warn" : "ok")}">${escapeHtml(age((supervisor.freshness || {}).age_seconds))}</span>`,
        jsonDrilldown(supervisor.job_status_counts || {}, countSummary(supervisor.job_status_counts || {})),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);
}

function renderRemoteControl() {
  const remote = (state.status && state.status.remote_control) || {};
  const latest = remote.latest_event || {};
  const latestResult = latest.result || {};
  const integrity = remote.integrity || {};
  const integrityStatus = text(integrity.status || (remote.audit_exists ? "unknown" : "missing"));
  const latestLabel = latest.event
    ? `${text(latest.event)} ${text(latestResult.action)} ${text(latestResult.status)}`
    : "none";
  const signatureDetail = integrity.signature_status
    ? ` / local signature ${text(integrity.signature_status)}`
    : "";
  const integrityDetail = `${numberText(integrity.checked_records, 0)} checked / ${numberText(integrity.legacy_records, 0)} legacy${signatureDetail}`;
  $("remote-control-body").innerHTML = row([
    remote.enabled ? statusText(remote.audit_exists ? "ok" : "waiting") : statusText("disabled"),
    escapeHtml(latestLabel),
    `<span class="${statusClass((remote.freshness || {}).stale ? "warn" : "ok")}">${escapeHtml(age((remote.freshness || {}).age_seconds))}</span>`,
    `<span class="${statusClass(integrityStatus === "ok" ? "ok" : integrityStatus === "broken" ? "bad" : "warn")}">${escapeHtml(integrityStatus)}</span><br><span class="muted">${escapeHtml(integrityDetail)}</span>`,
    jsonDrilldown(remote.result_status_counts || {}, countSummary(remote.result_status_counts || {})),
    jsonDrilldown(remote.post_status_counts || {}, countSummary(remote.post_status_counts || {})),
    escapeHtml(remote.audit_log),
  ]);
}

function renderAlerts() {
  const alerts = (state.status && state.status.alerts) || [];
  $("alerts-body").innerHTML = alerts.length
    ? alerts.map((alert) => row([
        statusText(alert.level === "warn" ? "warn" : alert.level),
        escapeHtml(alert.kind),
        escapeHtml(alert.message),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", ""]);
}

function renderGateway() {
  const gateway = (state.status && state.status.gateway) || {};
  const pairs = [
    ["Enabled", text(gateway.enabled)],
    ["Host", text(gateway.host)],
    ["Port", text(gateway.port)],
    ["Reachable", text(gateway.reachable)],
    ["Latency", gateway.latency_ms === null || gateway.latency_ms === undefined ? "n/a" : `${gateway.latency_ms} ms`],
    ["Error", text(gateway.error)],
  ];
  $("gateway-list").innerHTML = pairs.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
}

function renderPaperMonitor() {
  if (!$("paper-monitor-guide") || !$("paper-monitor-note")) return;
  const items = paperMonitorItems();
  const okCount = items.filter((item) => item.status === "ok").length;
  const badCount = items.filter((item) => item.status === "bad").length;
  const warnCount = items.filter((item) => item.status === "warn").length;
  $("paper-monitor-note").textContent = badCount
    ? `${badCount} blocker${badCount === 1 ? "" : "s"} before trusting paper monitoring`
    : warnCount
      ? `${warnCount} paper-monitor warning${warnCount === 1 ? "" : "s"}`
      : `${okCount} paper-monitor checks ready`;
  renderPaperMonitorHealth(items);
  renderPaperObservationPacket();
  $("paper-monitor-guide").innerHTML = items.map((item) => (
    `<div class="check-item status-${escapeHtml(item.status)}"><span>${escapeHtml(item.status)}</span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`
  )).join("");
}

function paperObservationPacketModel() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const supervisor = latestSupervisor();
  const metrics = (latestRun && latestRun.metrics) || {};
  const freshness = (latestRun && latestRun.freshness) || {};
  const supervisorFreshness = (supervisor && supervisor.freshness) || {};
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestOrder = events.find((event) => event.type === "order");
  const latestFill = events.find((event) => event.type === "fill");
  const latestReject = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const openOrders = currentOpenOrderRows();
  const accountTimestamp = metricTimestamp(metrics, [
    "account_end_time",
    "latest_account_time",
    "latest_account_timestamp",
    "account_snapshot_time",
  ]);
  const marketTimestamp = metricTimestamp(metrics, [
    "latest_data_time",
    "latest_market_data_time",
    "latest_bar_time",
    "last_bar_time",
    "market_data_time",
  ]);
  const decisionTimestamp = firstPresent(metrics.last_decision_time, latestDecision && latestDecision.timestamp);
  const nextDecision = firstPresent(
    metrics.next_decision_time,
    metrics.next_expected_decision_time,
    metrics.next_check_time,
    metrics.next_signal_time,
  );
  const nextOrderContext = firstPresent(
    metrics.next_order_condition,
    metrics.next_order_reason,
    metrics.latest_signal_reason,
    metrics.signal_reason,
    latestDecision && latestDecision.detail,
  );
  const heartbeatTimestamp = firstPresent(
    freshness.timestamp,
    metricTimestamp(metrics, ["last_decision_time", "account_end_time"]),
    supervisor && supervisor.generated_at,
    payload.generated_at,
  );
  const mode = String(metrics.mode || "").replace("-", "_").toLowerCase();
  const stale = Boolean((freshness && freshness.stale) || (supervisorFreshness && supervisorFreshness.stale));
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const activeObserver = Boolean(latestRun && !stale && (marketTimestamp || decisionTimestamp));
  let status = "bad";
  let title = "Not Observing";
  let note = "No current runner market-data or decision timestamp is visible.";
  if (latestRun) {
    status = activeObserver
      ? latestReject || openOrders.length ? "warn" : "ok"
      : stale ? "warn" : "bad";
    title = activeObserver ? "Observing" : stale ? "Telemetry Stale" : "Waiting For Bars";
    note = activeObserver
      ? "Runner telemetry includes fresh market or decision observations."
      : stale
        ? "Runner or supervisor heartbeat is stale; confirm the process before trusting paper state."
        : "Runner exists, but market-data or decision timestamps are missing.";
  }
  const cards = [
    {
      status,
      label: "Observer",
      title,
      note,
    },
    {
      status: gatewayStatus,
      label: "Gateway/API",
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      note: gateway.enabled
        ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === null || gateway.latency_ms === undefined ? "" : `${gateway.latency_ms}ms`}`
        : "Gateway reachability is not being checked.",
    },
    {
      status: marketTimestamp ? stale ? "warn" : "ok" : "bad",
      label: "Market Feed",
      title: timestampAgeLabel(marketTimestamp),
      note: marketTimestamp ? "Latest bar/snapshot timestamp from runner metrics." : "No market-data timestamp published.",
    },
    {
      status: accountTimestamp ? stale ? "warn" : "ok" : "warn",
      label: "Account Feed",
      title: timestampAgeLabel(accountTimestamp),
      note: accountTimestamp
        ? `${numberText(metrics.account_snapshot_count, 0)} account snapshot${Number(metrics.account_snapshot_count || 0) === 1 ? "" : "s"} summarized.`
        : "No account snapshot timestamp published.",
    },
    {
      status: decisionTimestamp ? stale ? "warn" : "ok" : latestRun ? "warn" : "bad",
      label: "Decision Loop",
      title: decisionTimestamp ? timestampAgeLabel(decisionTimestamp) : nextDecision ? "Scheduled" : "Missing",
      note: decisionTimestamp
        ? latestDecision ? `${text(latestDecision.symbol)} ${text(latestDecision.detail)}` : "Last decision time is published in metrics."
        : nextDecision ? `Next expected decision ${text(nextDecision)}.` : "No decision timestamp or next check is visible.",
    },
    {
      status: latestReject ? "bad" : openOrders.length ? "warn" : nextOrderContext || latestOrder || latestFill ? "ok" : latestRun ? "warn" : "bad",
      label: "Order Context",
      title: latestReject ? "Rejected" : openOrders.length ? `${numberText(openOrders.length, 0)} open` : nextOrderContext ? "Signal Visible" : latestOrder ? "Order Visible" : latestFill ? "Fill Visible" : "Missing",
      note: latestReject
        ? `${text(latestReject.symbol)} ${text(latestReject.status)} ${text(latestReject.detail)}`
        : openOrders.length
          ? `${text(openOrders[0].symbol)} ${text(openOrders[0].status)} ${timestampAgeLabel(openOrders[0].timestamp)}.`
          : nextOrderContext
            ? text(nextOrderContext)
            : latestOrder
              ? `${text(latestOrder.symbol)} ${text(latestOrder.status)}.`
              : latestFill
                ? `${text(latestFill.symbol)} filled ${timestampAgeLabel(latestFill.timestamp)}.`
                : "No next-order condition, recent order, or fill context is visible.",
    },
    {
      status: latestRun ? ["paper", "simulated_paper", "shadow"].includes(mode) ? "ok" : mode ? "warn" : "bad" : "bad",
      label: "Mode",
      title: text(metrics.mode || "unpublished"),
      note: latestRun ? `Run ${text(latestRun.id)} status=${text(latestRun.status)}; heartbeat ${timestampAgeLabel(heartbeatTimestamp)}.` : "No current run is publishing telemetry.",
    },
  ];
  const detail = [
    ["Run", latestRun ? `${text(latestRun.id)} / ${text(latestRun.status)} / ${text(metrics.mode || "unpublished")}` : "none"],
    ["Supervisor", supervisor ? `${text(supervisor.id)} / ${text(supervisor.status)} / ${timestampAgeLabel(supervisor.generated_at)}` : "none"],
    ["Market Timestamp", text(marketTimestamp)],
    ["Account Timestamp", text(accountTimestamp)],
    ["Decision Timestamp", text(decisionTimestamp)],
    ["Next Decision", text(nextDecision)],
    ["Latest Order", latestOrder ? `${text(latestOrder.symbol)} ${text(latestOrder.status)} ${text(latestOrder.timestamp)}` : "none"],
    ["Latest Fill", latestFill ? `${text(latestFill.symbol)} ${text(latestFill.timestamp)}` : "none"],
    ["Latest Rejection", latestReject ? `${text(latestReject.symbol)} ${text(latestReject.status)} ${text(latestReject.detail)}` : "none"],
    ["Next Order Context", text(nextOrderContext)],
  ];
  return { status, title, note, cards, detail };
}

function renderPaperObservationPacket() {
  if (!$("paper-observation-note") || !$("paper-observation-cards") || !$("paper-observation-detail")) return;
  const model = paperObservationPacketModel();
  $("paper-observation-note").innerHTML = `<span class="${escapeHtml(statusClass(model.status))}">${escapeHtml(model.title)}</span> - ${escapeHtml(model.note)}`;
  $("paper-observation-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("paper-observation-detail").innerHTML = model.detail.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
}

function paperMonitorActionFor(item) {
  const label = String((item && item.label) || "").toLowerCase();
  if (label.includes("gateway")) return { target: "gateway-list", label: "Review Gateway" };
  if (label.includes("account")) return { target: "performance-home-result", label: "Open Performance" };
  if (label.includes("config") || label.includes("mode")) return { target: "current-runs-body", label: "Review Runs" };
  if (label.includes("market") || label.includes("order")) return { target: "overview-timeline-body", label: "Review Timeline" };
  return { target: "paper-monitor-guide", label: "Review Check" };
}

function renderPaperMonitorHealth(items = []) {
  if (!$("paper-monitor-health")) return;
  const blockers = items.filter((item) => item.status === "bad");
  const warnings = items.filter((item) => item.status === "warn");
  const ready = items.filter((item) => item.status === "ok");
  const firstActionItem = blockers[0] || warnings[0] || null;
  const action = firstActionItem ? paperMonitorActionFor(firstActionItem) : { target: "paper-monitor-guide", label: "Monitor Ready" };
  const cards = [
    {
      status: blockers.length ? "bad" : warnings.length ? "warn" : "ok",
      label: "Readiness",
      title: blockers.length ? `${numberText(blockers.length, 0)} blockers` : warnings.length ? `${numberText(warnings.length, 0)} warnings` : "Ready",
      note: `${numberText(ready.length, 0)} of ${numberText(items.length, 0)} checks green.`,
    },
    {
      status: firstActionItem ? firstActionItem.status : "ok",
      label: "Next Action",
      title: action.label,
      note: firstActionItem ? `${text(firstActionItem.label)}: ${text(firstActionItem.detail)}` : "No visible paper-monitor blockers.",
    },
    {
      status: items.find((item) => item.label === "Config And Mode")?.status || "warn",
      label: "Mode Safety",
      title: items.find((item) => item.label === "Config And Mode")?.status === "ok" ? "Paper/Shadow" : "Review",
      note: items.find((item) => item.label === "Config And Mode")?.detail || "No current run mode is published.",
    },
    {
      status: items.find((item) => item.label === "Order Context")?.status || "warn",
      label: "Order Context",
      title: items.find((item) => item.label === "Order Context")?.status === "ok" ? "Visible" : "Missing",
      note: items.find((item) => item.label === "Order Context")?.detail || "No next-order condition is published.",
    },
  ];
  $("paper-monitor-health").innerHTML = cards.map((card) => `
    <div class="health-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function operationsHomeState() {
  const status = state.status || {};
  const gateway = status.gateway || {};
  const alerts = status.alerts || [];
  const paperItems = paperMonitorItems();
  const paperBad = paperItems.filter((item) => item.status === "bad").length;
  const paperWarn = paperItems.filter((item) => item.status === "warn").length;
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const staleRemote = remoteNodes.filter((node) => {
    const ageSeconds = (Date.now() - (timestampMillis(node.received_at || node.generated_at) || 0)) / 1000;
    return Number.isFinite(ageSeconds) && ageSeconds > 900;
  }).length;
  const commandAudit = state.commandAudit || {};
  const auditEvents = commandAudit.events || [];
  const integrity = commandAudit.integrity || {};
  const localRemote = status.remote_control || {};
  const localIntegrity = localRemote.integrity || {};
  const localIntegrityStatus = String(localIntegrity.status || "").toLowerCase();
  const localSignatureStatus = String(localIntegrity.signature_status || "").toLowerCase();
  const localAuditBad = ["broken", "error"].includes(localIntegrityStatus)
    || ["bad", "missing_key", "invalid", "failed"].includes(localSignatureStatus);
  const localAuditWarn = !localAuditBad && Boolean(localRemote.enabled) && (
    !localIntegrityStatus || ["empty", "legacy", "missing", "unknown"].includes(localIntegrityStatus)
    || ["warn", "disabled", "empty"].includes(localSignatureStatus)
  );
  const auditBad = localAuditBad
    || ["broken", "invalid"].includes(String(integrity.status || "").toLowerCase())
    || ["invalid", "failed"].includes(String(integrity.signature_status || "").toLowerCase());
  const auditWarn = !auditBad && (
    localAuditWarn ||
    !auditEvents.length
    || ["legacy", "unsigned", "disabled", "mixed"].includes(String(integrity.signature_status || "").toLowerCase())
    || ["legacy", "unchecked", "missing"].includes(String(integrity.status || "").toLowerCase())
  );
  const gatewayStatus = gateway.enabled
    ? gateway.reachable ? "ok" : "bad"
    : "warn";
  let result = "Review Operations";
  let note = "Use Operations Home to route into local paper monitoring, remote nodes, command audit, or Gateway diagnostics.";
  let nextAction = "paper";
  if (paperBad) {
    result = "Paper Monitor Blocked";
    note = `${numberText(paperBad, 0)} local paper-monitor blocker${paperBad === 1 ? "" : "s"} need review before trusting automation.`;
    nextAction = "paper";
  } else if (gatewayStatus === "bad") {
    result = "Gateway Not Reachable";
    note = text(gateway.error || "Gateway/API check is enabled but not reachable.");
    nextAction = "gateway";
  } else if (remoteAlerts || staleRemote) {
    result = "Remote Nodes Need Review";
    note = `${numberText(remoteAlerts, 0)} remote alert${remoteAlerts === 1 ? "" : "s"} / ${numberText(staleRemote, 0)} stale node${staleRemote === 1 ? "" : "s"}.`;
    nextAction = "remote";
  } else if (auditBad || auditWarn) {
    result = auditBad ? "Command Audit Broken" : "Command Audit Needs Review";
    note = integrity.status || localIntegrity.status
      ? `Receiver ${text(integrity.status || "not loaded")}; local ${text(localIntegrity.status || "not loaded")}; server signature ${text(integrity.signature_status || "not loaded")}; local signature ${text(localIntegrity.signature_status || "not loaded")}.`
      : "No command audit events or integrity status loaded yet.";
    nextAction = "audit";
  } else if (alerts.length || paperWarn) {
    result = "Warnings Present";
    note = `${numberText(alerts.length, 0)} local alert${alerts.length === 1 ? "" : "s"} / ${numberText(paperWarn, 0)} paper warning${paperWarn === 1 ? "" : "s"}.`;
    nextAction = alerts.length ? "gateway" : "paper";
  } else {
    result = "Operations Look Ready";
    note = "Local paper checks, Gateway, remote nodes, and command audit have no visible blockers.";
    nextAction = "remote";
  }
  const tiles = [
    {
      label: "Paper",
      status: paperBad ? "bad" : paperWarn ? "warn" : "ok",
      title: paperBad ? `${numberText(paperBad, 0)} blockers` : paperWarn ? `${numberText(paperWarn, 0)} warnings` : "Ready",
      note: `${numberText(paperItems.length, 0)} monitor checks.`,
    },
    {
      label: "Gateway",
      status: gatewayStatus,
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      note: gateway.enabled ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === undefined || gateway.latency_ms === null ? "" : `${gateway.latency_ms}ms`}` : "Gateway check disabled.",
    },
    {
      label: "Remote",
      status: remoteNodes.length ? remoteAlerts || staleRemote ? "warn" : "ok" : "warn",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} node${remoteNodes.length === 1 ? "" : "s"}` : "No Nodes",
      note: `${numberText(remoteAlerts, 0)} alerts / ${numberText(staleRemote, 0)} stale.`,
    },
    {
      label: "Audit",
      status: auditBad ? "bad" : auditWarn ? "warn" : "ok",
      title: auditBad ? "Broken" : auditWarn ? "Review" : "OK",
      note: `receiver ${text(integrity.status || "n/a")} / local ${text(localIntegrity.status || "n/a")} / signatures ${text(integrity.signature_status || "n/a")}/${text(localIntegrity.signature_status || "n/a")}.`,
    },
    {
      label: "Alerts",
      status: alerts.length ? "warn" : "ok",
      title: numberText(alerts.length, 0),
      note: alerts.length ? "Local alerts need review." : "No local alerts.",
    },
  ];
  return { result, note, nextAction, tiles };
}

function renderOperationsHome() {
  if (!$("operations-home-result") || !$("operations-home-note") || !$("operations-home-tiles")) return;
  const model = operationsHomeState();
  $("operations-home-result").textContent = model.result;
  $("operations-home-note").textContent = model.note;
  for (const button of document.querySelectorAll("[data-operations-home-action]")) {
    if (!(button instanceof HTMLButtonElement)) continue;
    const active = button.dataset.operationsHomeAction === model.nextAction;
    button.classList.toggle("secondary", !active);
  }
  $("operations-home-tiles").innerHTML = model.tiles.map((tile) => `
    <div class="action-card status-${escapeHtml(tile.status)}">
      <span>${escapeHtml(tile.label)}</span>
      <strong>${escapeHtml(tile.title)}</strong>
      <small>${escapeHtml(tile.note)}</small>
    </div>
  `).join("");
  renderOperationsWorkflowLauncher();
}

function operationsWorkflowCards() {
  const status = state.status || {};
  const gateway = status.gateway || {};
  const alerts = status.alerts || [];
  const paperItems = paperMonitorItems();
  const paperBad = paperItems.filter((item) => item.status === "bad").length;
  const paperWarn = paperItems.filter((item) => item.status === "warn").length;
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const staleRemote = remoteNodes.filter((node) => {
    const millis = timestampMillis(node.received_at || node.generated_at);
    return millis === null || ((Date.now() - millis) / 1000) > 900;
  }).length;
  const commandAudit = state.commandAudit || {};
  const auditEvents = commandAudit.events || [];
  const integrity = commandAudit.integrity || {};
  const localRemote = status.remote_control || {};
  const localIntegrity = localRemote.integrity || {};
  const integrityStatus = String(integrity.status || "").toLowerCase();
  const signatureStatus = String(integrity.signature_status || "").toLowerCase();
  const localIntegrityStatus = String(localIntegrity.status || "").toLowerCase();
  const localSignatureStatus = String(localIntegrity.signature_status || "").toLowerCase();
  const localAuditBad = ["broken", "error"].includes(localIntegrityStatus)
    || ["bad", "missing_key", "invalid", "failed"].includes(localSignatureStatus);
  const localAuditWarn = !localAuditBad && Boolean(localRemote.enabled) && (
    !localIntegrityStatus || ["empty", "legacy", "missing", "unknown"].includes(localIntegrityStatus)
    || ["warn", "disabled", "empty"].includes(localSignatureStatus)
  );
  const auditBad = localAuditBad || ["broken", "invalid"].includes(integrityStatus) || ["invalid", "failed"].includes(signatureStatus);
  const auditWarn = !auditBad && (
    localAuditWarn ||
    !auditEvents.length ||
    ["legacy", "unsigned", "disabled", "mixed"].includes(signatureStatus) ||
    ["legacy", "unchecked", "missing"].includes(integrityStatus)
  );
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const commands = state.commands || [];
  const results = state.results || [];
  const pendingCommands = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failedResults = results.filter((result) => {
    const value = String(result.status || "").toLowerCase();
    return ["failed", "error", "rejected", "cancelled", "canceled"].includes(value);
  });
  const supervisors = status.supervisors || [];
  const supervisorIssues = supervisors.filter((supervisor) => supervisor.status && supervisor.status !== "ok");
  const diagnostics = state.diagnostics || {};
  const cleanup = state.cleanupPlan || {};
  const diagnosticWarnings = [
    ...(diagnostics.warnings || []),
    ...(diagnostics.errors || []),
    ...(cleanup.warnings || []),
    ...(cleanup.errors || []),
  ];

  return [
    {
      label: "Paper Monitor",
      title: paperBad ? `${numberText(paperBad, 0)} Blockers` : paperWarn ? `${numberText(paperWarn, 0)} Warnings` : "Ready",
      value: `${numberText(paperItems.length, 0)} checks`,
      status: paperBad ? "bad" : paperWarn ? "warn" : "ok",
      detail: paperBad
        ? "Gateway, account, mode, market-data, or order-context checks need review before trusting paper automation."
        : paperWarn ? "Paper monitoring is partially visible, but one or more readiness checks need review." : "Local paper-monitor checks have no visible blockers.",
      href: workflowHref("operations", "paper"),
      cta: "Paper",
    },
    {
      label: "Gateway/API",
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      value: gateway.enabled ? `${text(gateway.host)}:${text(gateway.port)}` : "not checked",
      status: gatewayStatus,
      detail: gateway.enabled
        ? gateway.reachable ? "Gateway/API check is reachable from this dashboard host." : text(gateway.error || "Gateway/API check is enabled but unreachable.")
        : "Gateway reachability checks are disabled in the current status payload.",
      href: workflowHref("operations", "diagnostics"),
      cta: "Gateway",
    },
    {
      label: "Remote Nodes",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} Nodes` : "No Nodes",
      value: `${numberText(remoteAlerts, 0)} alerts`,
      status: remoteNodes.length ? remoteAlerts || staleRemote ? "warn" : "ok" : "warn",
      detail: remoteNodes.length
        ? `${numberText(staleRemote, 0)} stale heartbeat${staleRemote === 1 ? "" : "s"}; inspect node detail for sanitized runs, alerts, and activity.`
        : "No read-only cloud monitoring snapshots are loaded yet.",
      href: workflowHref("operations", "remote"),
      cta: "Remote",
    },
    {
      label: "Command Audit",
      title: auditBad ? "Broken" : auditWarn ? "Needs Review" : "OK",
      value: `local ${text(localIntegrity.status || "n/a")}`,
      status: auditBad ? "bad" : auditWarn ? "warn" : "ok",
      detail: auditBad
        ? "Receiver or local worker audit integrity is broken/invalid; review audit rows before issuing controls."
        : auditWarn ? "Command audit is missing, legacy, unsigned, locally unchecked, or partially unchecked." : "Receiver and local command audit integrity have no visible blockers.",
      href: workflowHref("operations", "control"),
      cta: "Audit",
    },
    {
      label: "Control Queue",
      title: pendingCommands.length ? `${numberText(pendingCommands.length, 0)} Pending` : commands.length ? "No Pending" : "No Commands",
      value: failedResults.length ? `${numberText(failedResults.length, 0)} failed` : `${numberText(results.length, 0)} results`,
      status: failedResults.length ? "bad" : pendingCommands.length ? "warn" : commands.length || results.length ? "ok" : "warn",
      detail: pendingCommands.length
        ? "Remote-control commands are waiting for a worker; confirm node, action, and audit state."
        : failedResults.length ? "Recent command results include failures or rejections." : "Queue and result tables are available for remote-control review.",
      href: workflowHref("operations", "control"),
      cta: "Queue",
    },
    {
      label: "Diagnostics",
      title: alerts.length || diagnosticWarnings.length || supervisorIssues.length ? "Review" : "Clean",
      value: `${numberText(alerts.length, 0)} alerts`,
      status: alerts.length || diagnosticWarnings.length || supervisorIssues.length ? "warn" : "ok",
      detail: alerts.length || diagnosticWarnings.length || supervisorIssues.length
        ? `${numberText(supervisorIssues.length, 0)} supervisor issue${supervisorIssues.length === 1 ? "" : "s"} and ${numberText(diagnosticWarnings.length, 0)} diagnostic warning${diagnosticWarnings.length === 1 ? "" : "s"} are visible.`
        : "No local alerts, supervisor issues, or diagnostic warnings are visible.",
      href: workflowHref("operations", "diagnostics"),
      cta: "Diagnostics",
    },
  ];
}

function renderOperationsWorkflowLauncher() {
  const container = $("operations-workflows");
  if (!container) return;
  const cards = operationsWorkflowCards();
  container.innerHTML = cards.map((card) => `
    <a class="action-card workflow-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
      <div class="workflow-card-foot">
        <em>${escapeHtml(card.value)}</em>
        <b>${escapeHtml(card.cta)}</b>
      </div>
    </a>
  `).join("");
}

function handleOperationsHomeAction(action) {
  const targets = {
    paper: "paper-monitor-guide",
    remote: "remote-nodes-body",
    audit: "command-audit-body",
    gateway: "gateway-list",
  };
  const lenses = {
    paper: "paper",
    remote: "remote",
    audit: "control",
    gateway: "diagnostics",
  };
  applyOperationsLens(lenses[action] || "paper");
  const element = $(targets[action] || "paper-monitor-guide");
  if (element) element.scrollIntoView({ block: "start", behavior: "smooth" });
}

function commandStatusIsFailed(status) {
  const value = String(status || "").toLowerCase();
  return ["failed", "error", "rejected", "cancelled", "canceled"].includes(value);
}

function newestRemoteNodeId() {
  const nodes = ((state.remoteNodes && state.remoteNodes.nodes) || []).slice();
  nodes.sort((left, right) => (
    (timestampMillis(right.received_at || right.generated_at) || 0)
    - (timestampMillis(left.received_at || left.generated_at) || 0)
  ));
  return nodes.length ? text(nodes[0].node_id) : "";
}

function controlAssistantModel() {
  const commands = state.commands || [];
  const results = state.results || [];
  const pendingCommands = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failedResults = results.filter((result) => commandStatusIsFailed(result.status));
  const latestResult = results.slice().reverse()[0] || null;
  const audit = state.commandAudit || {};
  const events = audit.events || [];
  const integrity = audit.integrity || {};
  const integrityStatus = String(integrity.status || "").toLowerCase();
  const signatureStatus = String(integrity.signature_status || "").toLowerCase();
  const auditBad = ["broken", "invalid", "error"].includes(integrityStatus) || ["invalid", "failed", "missing_key"].includes(signatureStatus);
  const auditWarn = !auditBad && (!events.length || ["legacy", "unchecked", "missing"].includes(integrityStatus) || ["disabled", "unsigned", "mixed"].includes(signatureStatus));
  const node = ($("command-node") && $("command-node").value.trim()) || newestRemoteNodeId();
  let title = "Control Queue Clear";
  let summary = "No pending or failed commands are visible; read-only status checks are the safest next action.";
  if (!node) {
    title = "Pick A Remote Node";
    summary = "No node is selected and no remote node snapshot is loaded, so queued commands would not have a clear target.";
  } else if (failedResults.length) {
    title = "Review Failed Command";
    summary = `${numberText(failedResults.length, 0)} recent command result${failedResults.length === 1 ? "" : "s"} failed, errored, or were rejected.`;
  } else if (pendingCommands.length) {
    title = "Command Pending";
    summary = `${numberText(pendingCommands.length, 0)} command${pendingCommands.length === 1 ? "" : "s"} waiting for a worker result.`;
  } else if (auditBad || auditWarn) {
    title = auditBad ? "Audit Integrity Blocker" : "Audit Needs Review";
    summary = `Receiver audit ${text(integrity.status || "not loaded")}; signature ${text(integrity.signature_status || "not loaded")}.`;
  } else if (!commands.length && !results.length) {
    title = "Ready For First Status Check";
    summary = "Queue a read-only status request to confirm the worker can receive, execute, and audit controls.";
  }
  const cards = [
    {
      status: node ? "ok" : "warn",
      label: "Target",
      title: node || "No node",
      note: node ? "Newest or selected remote node is available." : "Load remote snapshots or type a node ID.",
    },
    {
      status: pendingCommands.length ? "warn" : "ok",
      label: "Pending",
      title: numberText(pendingCommands.length, 0),
      note: pendingCommands.length ? `${text(pendingCommands[0].action)} waiting since ${text(pendingCommands[0].created_at)}.` : "No queued command is waiting.",
    },
    {
      status: failedResults.length ? "bad" : latestResult ? "ok" : "warn",
      label: "Results",
      title: failedResults.length ? `${numberText(failedResults.length, 0)} failed` : latestResult ? text(latestResult.status || "received") : "none",
      note: latestResult ? `${text(latestResult.action || latestResult.command_id)} / ${timestampAgeLabel(latestResult.received_at)}.` : "No command result rows loaded yet.",
    },
    {
      status: auditBad ? "bad" : auditWarn ? "warn" : "ok",
      label: "Audit",
      title: text(integrity.status || "not loaded"),
      note: `${numberText(events.length, 0)} rows / signature ${text(integrity.signature_status || "n/a")}.`,
    },
  ];
  const actions = [
    {
      action: "use-node",
      title: node ? "Use Newest Node" : "Find Node",
      note: node ? `Fill command target with ${node}.` : "Open Remote Nodes to inspect available targets.",
      label: node ? "Use Node" : "Remote",
      disabled: !node && !newestRemoteNodeId(),
    },
    {
      action: "request-status",
      title: "Queue Status Check",
      note: "Prepare a read-only request_status command for the selected node.",
      label: "Prepare",
      disabled: !node,
    },
    {
      action: failedResults.length ? "review-failed" : pendingCommands.length ? "review-pending" : "review-audit",
      title: failedResults.length ? "Review Failed Result" : pendingCommands.length ? "Review Pending Command" : "Review Audit",
      note: failedResults.length
        ? "Jump to command results and inspect the latest failure payload."
        : pendingCommands.length ? "Jump to queued commands before adding another control." : "Jump to command audit integrity and event rows.",
      label: "Review",
      disabled: false,
    },
    {
      action: "export-audit",
      title: "Export Audit CSV",
      note: "Download sanitized command audit rows for retention or off-host review.",
      label: "Export",
      disabled: false,
    },
  ];
  return { title, summary, cards, actions };
}

function renderControlAssistant() {
  if (!$("control-assistant-title") || !$("control-assistant-cards") || !$("control-assistant-actions")) return;
  const model = controlAssistantModel();
  $("control-assistant-title").textContent = model.title;
  $("control-assistant-summary").textContent = model.summary;
  $("control-assistant-note").textContent = `${numberText((state.commands || []).length, 0)} queued command row${(state.commands || []).length === 1 ? "" : "s"} / ${numberText((state.results || []).length, 0)} result row${(state.results || []).length === 1 ? "" : "s"}`;
  $("control-assistant-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("control-assistant-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="control-assistant-action ${action.disabled ? "secondary" : ""}" data-control-assistant-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.note)}</small>
      </span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

function handleControlAssistantAction(action) {
  const node = newestRemoteNodeId() || ($("command-node") && $("command-node").value.trim()) || "";
  if (action === "use-node") {
    if (node) $("command-node").value = node;
    $("command-node").focus();
    $("last-refresh").textContent = node ? `Command target set to ${node}` : "Open Remote Nodes to choose a command target";
    renderControlAssistant();
    return;
  }
  if (action === "request-status") {
    if (node && !$("command-node").value.trim()) $("command-node").value = node;
    $("command-action").value = "request_status";
    updateCommandFields();
    $("command-form").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Read-only request_status command prepared; review target before queueing";
    renderControlAssistant();
    return;
  }
  if (action === "review-pending") {
    $("commands-body").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "review-failed") {
    $("results-body").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "export-audit") {
    exportCommandAuditCsv().catch((err) => {
      $("last-refresh").textContent = `Command audit CSV export failed: ${err.message}`;
    });
    return;
  }
  $("command-audit-body").scrollIntoView({ block: "start", behavior: "smooth" });
}

function prepareRequestStatusCommand(nodeId = "") {
  const cleanNode = text(nodeId);
  if (cleanNode && cleanNode !== "n/a") $("command-node").value = cleanNode;
  $("command-action").value = "request_status";
  updateCommandFields();
  applyOperationsLens("control");
  $("command-form").scrollIntoView({ block: "start", behavior: "smooth" });
  $("last-refresh").textContent = cleanNode && cleanNode !== "n/a"
    ? `Read-only request_status prepared for ${cleanNode}; review before queueing`
    : "Read-only request_status prepared; choose a node before queueing";
  renderControlAssistant();
}

function remoteNodeFilters() {
  return {
    text: ($("remote-filter-text").value || "").trim().toLowerCase(),
    status: $("remote-filter-status").value || "",
    mode: $("remote-filter-mode").value || "",
    sort: $("remote-filter-sort").value || "heartbeat_desc",
  };
}

function renderRemoteNodeFilterOptions(nodes) {
  const makeOptions = (id, values) => {
    const current = $(id).value || "";
    const unique = Array.from(new Set((values || []).map(text).filter((value) => value && value !== "n/a"))).sort();
    $(id).innerHTML = `<option value="">All</option>${unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (unique.includes(current)) $(id).value = current;
  };
  makeOptions("remote-filter-status", (nodes || []).map((node) => node.status));
  makeOptions("remote-filter-mode", (nodes || []).map((node) => node.mode));
}

function remoteNodeSortValue(node, key) {
  if (key === "heartbeat") return timestampMillis(node.received_at || node.generated_at) || 0;
  if (key === "alerts") return Number(node.alert_count || 0);
  if (key === "orders") return Number(node.open_order_count || 0);
  if (key === "equity") return finiteNumber(node.final_equity) || 0;
  return String(node.node_id || "").toLowerCase();
}

function filteredRemoteNodes(nodes) {
  const filters = remoteNodeFilters();
  const filtered = (nodes || []).filter((node) => {
    if (filters.status && text(node.status) !== filters.status) return false;
    if (filters.mode && text(node.mode) !== filters.mode) return false;
    if (filters.text) {
      const haystack = [
        node.node_id,
        node.status,
        node.mode,
        node.latest_run_id,
        node.latest_run_status,
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });
  const [key, direction] = String(filters.sort || "heartbeat_desc").split("_");
  const multiplier = direction === "asc" ? 1 : -1;
  return filtered.slice().sort((left, right) => {
    const leftValue = remoteNodeSortValue(left, key);
    const rightValue = remoteNodeSortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier;
    }
    const primary = String(leftValue).localeCompare(String(rightValue)) * multiplier;
    if (primary) return primary;
    return String(left.node_id || "").localeCompare(String(right.node_id || ""));
  });
}

function remoteDetailActivityFilter() {
  return $("remote-detail-activity-filter") ? $("remote-detail-activity-filter").value || "" : "";
}

function renderRemoteDetailAssistant(detail = state.remoteNodeDetail || {}, context = {}) {
  if (!$("remote-detail-assistant-title") || !$("remote-detail-assistant-cards") || !$("remote-detail-assistant-actions")) return;
  const summary = detail.summary || {};
  const runs = detail.runs || [];
  const alerts = detail.alerts || [];
  const activity = context.activity || remoteNodeActivityEvents(runs);
  const artifactRows = context.artifactRows || remoteRunArtifactEvidenceRows(runs);
  const filteredActivity = context.filteredActivity || activity;
  const artifactFileCount = artifactRows.reduce((sum, item) => sum + Number((item.evidence || {}).existing_count || 0), 0);
  const artifactRowCount = artifactRows.reduce((sum, item) => sum + Number((item.evidence || {}).jsonl_row_count || 0), 0);
  const latestActivity = activity[0] || null;
  const completedRuns = runs.filter((run) => text(run.status).toLowerCase() === "completed");
  const failedRuns = runs.filter((run) => ["failed", "error", "timeout", "cancelled", "canceled"].includes(text(run.status).toLowerCase()));
  const rejectedActivity = activity.filter((event) => eventStatusIsBad({
    status: eventStatus(event, event.type),
  }));
  const heartbeatMillis = timestampMillis(summary.received_at || summary.generated_at || detail.generated_at);
  const heartbeatAgeSeconds = heartbeatMillis === null ? null : (Date.now() - heartbeatMillis) / 1000;
  const heartbeatStale = heartbeatAgeSeconds === null || heartbeatAgeSeconds > 900;
  let status = "bad";
  let title = "Select Remote Node";
  let note = "Click Detail on a Remote Nodes row to inspect sanitized monitoring detail.";
  if (detail.node_id) {
    status = alerts.length || failedRuns.length || rejectedActivity.length || heartbeatStale ? "warn" : "ok";
    title = status === "ok" ? "Remote Node Healthy" : "Remote Node Needs Review";
    note = status === "ok"
      ? "Heartbeat, alerts, activity, and bounded artifact evidence have no visible blockers."
      : "Review stale heartbeat, alerts, failed runs, rejected activity, or missing artifact evidence before trusting remote state.";
  }
  $("remote-detail-assistant-title").textContent = title;
  $("remote-detail-assistant-title").className = statusClass(status);
  $("remote-detail-assistant-note").textContent = note;
  const cards = [
    {
      status: detail.node_id ? heartbeatStale ? "warn" : "ok" : "bad",
      title: detail.node_id ? timestampAgeLabel(summary.received_at || summary.generated_at || detail.generated_at) : "No Node",
      label: "Heartbeat",
      note: detail.node_id ? `${numberText(detail.count || 0, 0)} loaded / ${numberText(detail.total || 0, 0)} stored snapshots.` : "No remote detail payload loaded.",
    },
    {
      status: alerts.length ? "bad" : detail.node_id ? "ok" : "bad",
      title: numberText(alerts.length, 0),
      label: "Alerts",
      note: alerts.length ? text((alerts[0] || {}).message || (alerts[0] || {}).kind) : "No latest alerts in the selected node snapshot.",
    },
    {
      status: failedRuns.length ? "bad" : completedRuns.length ? "ok" : runs.length ? "warn" : detail.node_id ? "warn" : "bad",
      title: `${numberText(completedRuns.length, 0)} completed`,
      label: "Latest Runs",
      note: `${numberText(failedRuns.length, 0)} failed/error run${failedRuns.length === 1 ? "" : "s"} / ${numberText(runs.length, 0)} loaded.`,
    },
    {
      status: rejectedActivity.length ? "bad" : activity.length ? "ok" : detail.node_id ? "warn" : "bad",
      title: numberText(filteredActivity.length, 0),
      label: "Activity",
      note: latestActivity ? `${text(latestActivity.type)} ${timestampAgeLabel(eventTimestamp(latestActivity))}; ${numberText(rejectedActivity.length, 0)} issue events.` : "No sanitized decision/order/fill activity loaded.",
    },
    {
      status: artifactRows.length ? "ok" : detail.node_id ? "warn" : "bad",
      title: numberText(artifactFileCount, 0),
      label: "Artifact Files",
      note: artifactRows.length ? `${numberText(artifactRows.length, 0)} runs / ${numberText(artifactRowCount, 0)} JSONL rows.` : "No bounded artifact evidence in latest run summaries.",
    },
  ];
  $("remote-detail-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("remote-detail-assistant-actions").innerHTML = [
    {
      action: "decisions",
      status: activity.some((event) => event.type === "decision") ? "ok" : "bad",
      title: "Show Decisions",
      note: "Filter remote activity to sanitized strategy decisions.",
      disabled: !activity.some((event) => event.type === "decision"),
    },
    {
      action: "orders",
      status: activity.some((event) => event.type === "order") ? "warn" : "bad",
      title: "Show Orders",
      note: "Filter remote activity to sanitized order rows.",
      disabled: !activity.some((event) => event.type === "order"),
    },
    {
      action: "fills",
      status: activity.some((event) => event.type === "fill") ? "ok" : "bad",
      title: "Show Fills",
      note: "Filter remote activity to fills.",
      disabled: !activity.some((event) => event.type === "fill"),
    },
    {
      action: "clear",
      status: remoteDetailActivityFilter() ? "ok" : "warn",
      title: "Clear Activity Filter",
      note: "Return to all sanitized activity rows.",
      disabled: !remoteDetailActivityFilter(),
    },
    {
      action: "control",
      status: detail.node_id ? "warn" : "bad",
      title: "Use As Control Target",
      note: detail.node_id ? `Fill command target with ${text(detail.node_id)} and open Control.` : "Select a node before targeting controls.",
      disabled: !detail.node_id,
    },
    {
      action: "export",
      status: detail.node_id ? "ok" : "bad",
      title: "Export Detail CSV",
      note: "Download bounded sanitized node detail rows.",
      disabled: !detail.node_id,
    },
  ].map((item) => `
    <button class="remote-detail-assistant-action status-${escapeHtml(item.status)}" data-remote-detail-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

function handleRemoteDetailAssistantAction(action) {
  if (action === "decisions" || action === "orders" || action === "fills") {
    $("remote-detail-activity-filter").value = action.slice(0, -1);
    renderRemoteNodeDetail();
    return;
  }
  if (action === "clear") {
    $("remote-detail-activity-filter").value = "";
    renderRemoteNodeDetail();
    return;
  }
  if (action === "control") {
    const nodeId = text((state.remoteNodeDetail || {}).node_id);
    if (nodeId && nodeId !== "n/a") $("command-node").value = nodeId;
    applyOperationsLens("control");
    $("command-form").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "export") {
    downloadRemoteNodeDetailCsv().catch((err) => {
      $("last-refresh").textContent = `Remote node detail CSV export failed: ${err.message}`;
    });
  }
}

function eventTimestamp(event) {
  return event.timestamp
    || event.time
    || event.submitted_at
    || event.filled_at
    || event.decision_time
    || event.created_at
    || event.updated_at
    || "";
}

function eventSymbol(event) {
  return event.symbol || event.ticker || event.contract || event.instrument || "";
}

function eventStatus(event, type) {
  return event.status || event.action || event.side || type || "";
}

function eventDetail(event) {
  const keys = ["reason", "tag", "side", "quantity", "price", "cash_quantity", "signal", "threshold"];
  const parts = [];
  for (const key of keys) {
    if (event[key] !== undefined && event[key] !== null && event[key] !== "") {
      parts.push(`${key}:${text(event[key])}`);
    }
  }
  return parts.length ? parts.join(" ") : objectSummary(event);
}

function remoteNodeActivityEvents(runs) {
  const events = [];
  for (const runItem of runs || []) {
    for (const event of runItem.recent_decisions || []) {
      events.push({ ...event, run_id: runItem.id, type: "decision" });
    }
    for (const event of runItem.recent_orders || []) {
      events.push({ ...event, run_id: runItem.id, type: "order" });
    }
    for (const event of runItem.recent_fills || []) {
      events.push({ ...event, run_id: runItem.id, type: "fill" });
    }
  }
  return events.sort((left, right) => (timestampMillis(eventTimestamp(right)) || 0) - (timestampMillis(eventTimestamp(left)) || 0));
}

function remoteRunArtifactEvidenceRows(runs) {
  return (runs || [])
    .map((runItem) => ({ run: runItem, evidence: runItem.artifact_evidence || null }))
    .filter((item) => item.evidence);
}

function remoteArtifactMissingNames(evidence) {
  const missing = Array.isArray(evidence.missing_files)
    ? evidence.missing_files.filter(Boolean)
    : (evidence.files || [])
      .filter((item) => !item.exists)
      .map((item) => item.name)
      .filter(Boolean);
  return missing.length ? missing.slice(0, 4).join(", ") : "none";
}

function remoteArtifactCategorySummary(evidence) {
  const categories = evidence.category_counts || {};
  const top = topCountEntries(categories, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ");
  const metadata = Number(evidence.metadata_file_count || 0);
  const streams = Number(evidence.event_stream_count || 0);
  return top || `${numberText(metadata, 0)} metadata / ${numberText(streams, 0)} streams`;
}

function staleRemoteNodes(nodes = [], maxAgeSeconds = 900) {
  return (nodes || []).filter((node) => {
    const millis = timestampMillis(node.received_at || node.generated_at);
    if (millis === null) return true;
    return ((Date.now() - millis) / 1000) > maxAgeSeconds;
  });
}

function newestRemoteNode(nodes = []) {
  return (nodes || []).slice().sort((left, right) => (
    (timestampMillis(right.received_at || right.generated_at) || 0)
    - (timestampMillis(left.received_at || left.generated_at) || 0)
  ))[0] || null;
}

function renderRemoteNodesAssistant(nodes = [], filteredNodes = []) {
  if (!$("remote-nodes-assistant-title") || !$("remote-nodes-assistant-cards") || !$("remote-nodes-assistant-actions")) return;
  const staleNodes = staleRemoteNodes(nodes);
  const alertNodes = (nodes || []).filter((node) => Number(node.alert_count || 0) > 0);
  const orderNodes = (nodes || []).filter((node) => Number(node.open_order_count || 0) > 0);
  const gatewayDown = (nodes || []).filter((node) => node.gateway_reachable === false);
  const newest = newestRemoteNode(nodes);
  const activeFilters = [
    $("remote-filter-text").value ? `search ${$("remote-filter-text").value}` : "",
    $("remote-filter-status").value ? `status ${$("remote-filter-status").value}` : "",
    $("remote-filter-mode").value ? `mode ${$("remote-filter-mode").value}` : "",
  ].filter(Boolean);
  let status = "bad";
  let title = "No Remote Nodes";
  let note = "No authenticated status snapshots are loaded for remote monitoring.";
  if (nodes.length) {
    status = staleNodes.length || gatewayDown.length ? "bad" : alertNodes.length || orderNodes.length ? "warn" : "ok";
    title = staleNodes.length
      ? "Stale Heartbeats"
      : gatewayDown.length
        ? "Gateway Issues"
        : alertNodes.length
          ? "Alerts Present"
          : orderNodes.length
            ? "Open Orders Visible"
            : "Remote Nodes Ready";
    note = activeFilters.length
      ? `${activeFilters.join(" / ")}; ${numberText(filteredNodes.length, 0)} of ${numberText(nodes.length, 0)} nodes shown.`
      : status === "ok"
        ? "Remote snapshots have fresh heartbeats and no visible alert/order blockers."
        : "Use the actions below to sort toward the risky nodes, open detail, or prepare a read-only status request.";
  }
  $("remote-nodes-assistant-title").textContent = title;
  $("remote-nodes-assistant-title").className = statusClass(status);
  $("remote-nodes-assistant-note").textContent = note;
  const cards = [
    {
      status: nodes.length ? staleNodes.length ? "bad" : "ok" : "bad",
      title: staleNodes.length ? `${numberText(staleNodes.length, 0)} stale` : nodes.length ? "Fresh" : "No Nodes",
      label: "Heartbeat",
      note: newest ? `Newest ${text(newest.node_id)} ${timestampAgeLabel(newest.received_at || newest.generated_at)}.` : "No remote heartbeat loaded.",
    },
    {
      status: alertNodes.length ? "warn" : nodes.length ? "ok" : "bad",
      title: numberText(alertNodes.length, 0),
      label: "Alert Nodes",
      note: alertNodes.length ? alertNodes.slice(0, 3).map((node) => text(node.node_id)).join(", ") : "No remote node alerts visible.",
    },
    {
      status: orderNodes.length ? "warn" : nodes.length ? "ok" : "bad",
      title: numberText(orderNodes.length, 0),
      label: "Open-Order Nodes",
      note: orderNodes.length ? "Verify broker state locally before issuing controls." : "No non-terminal remote order events visible.",
    },
    {
      status: gatewayDown.length ? "bad" : nodes.length ? "ok" : "bad",
      title: gatewayDown.length ? `${numberText(gatewayDown.length, 0)} down` : nodes.length ? "Reachable" : "Unknown",
      label: "Gateway/API",
      note: gatewayDown.length ? gatewayDown.slice(0, 3).map((node) => text(node.node_id)).join(", ") : "No remote Gateway/API blockers in latest snapshots.",
    },
    {
      status: filteredNodes.length ? "ok" : nodes.length ? "warn" : "bad",
      title: `${numberText(filteredNodes.length, 0)} / ${numberText(nodes.length, 0)}`,
      label: "Shown",
      note: activeFilters.length ? "Current filters are hiding some nodes." : "No remote filters are active.",
    },
  ];
  $("remote-nodes-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("remote-nodes-assistant-actions").innerHTML = [
    {
      action: "alerts",
      status: alertNodes.length ? "warn" : "ok",
      title: "Sort Alerts First",
      note: alertNodes.length ? "Show nodes with the most alerts at the top." : "No alerting nodes to prioritize.",
      disabled: !alertNodes.length,
    },
    {
      action: "stale",
      status: staleNodes.length ? "bad" : "ok",
      title: "Sort Stale First",
      note: staleNodes.length ? "Show oldest heartbeat first." : "No stale heartbeat detected.",
      disabled: !staleNodes.length,
    },
    {
      action: "orders",
      status: orderNodes.length ? "warn" : "ok",
      title: "Sort Open Orders",
      note: orderNodes.length ? "Show nodes with the most non-terminal order events." : "No open-order nodes to prioritize.",
      disabled: !orderNodes.length,
    },
    {
      action: "newest-detail",
      status: newest ? "ok" : "bad",
      title: "Open Newest Detail",
      note: newest ? `Load bounded detail for ${text(newest.node_id)}.` : "No node detail can be loaded yet.",
      disabled: !newest,
    },
    {
      action: "request-status",
      status: newest ? "warn" : "bad",
      title: "Prepare Status Check",
      note: newest ? `Prepare read-only request_status for ${text(newest.node_id)}.` : "No node is available as a target.",
      disabled: !newest,
    },
    {
      action: "clear",
      status: activeFilters.length ? "ok" : "warn",
      title: "Clear Filters",
      note: activeFilters.length ? "Return to all remote nodes." : "No remote filters are active.",
      disabled: !activeFilters.length,
    },
    {
      action: "export",
      status: nodes.length ? "ok" : "bad",
      title: "Export Nodes CSV",
      note: "Download sanitized remote-node summaries.",
      disabled: !nodes.length,
    },
  ].map((item) => `
    <button class="remote-detail-assistant-action status-${escapeHtml(item.status)}" data-remote-nodes-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

function handleRemoteNodesAssistantAction(action) {
  const nodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const newest = newestRemoteNode(nodes);
  if (action === "alerts") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = "alerts_desc";
    renderRemoteNodes();
    $("last-refresh").textContent = "Remote nodes sorted by alert count";
    return;
  }
  if (action === "stale") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = "heartbeat_asc";
    renderRemoteNodes();
    $("last-refresh").textContent = "Remote nodes sorted by oldest heartbeat";
    return;
  }
  if (action === "orders") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = "orders_desc";
    renderRemoteNodes();
    $("last-refresh").textContent = "Remote nodes sorted by open-order count";
    return;
  }
  if (action === "newest-detail") {
    loadRemoteNodeDetail(text((newest || {}).node_id)).catch((err) => {
      $("last-refresh").textContent = `Remote node detail failed: ${err.message}`;
    });
    return;
  }
  if (action === "request-status") {
    prepareRequestStatusCommand(text((newest || {}).node_id));
    return;
  }
  if (action === "clear") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = "heartbeat_desc";
    renderRemoteNodes();
    $("last-refresh").textContent = "Remote node filters cleared";
    return;
  }
  if (action === "export") {
    downloadRemoteNodesCsv().catch((err) => {
      $("last-refresh").textContent = `Remote nodes CSV export failed: ${err.message}`;
    });
  }
}

function renderRemoteNodes() {
  if (!$("remote-nodes-body") || !$("remote-nodes-note")) return;
  const payload = state.remoteNodes || {};
  const nodes = payload.nodes || [];
  const filteredNodes = filteredRemoteNodes(nodes);
  const alertTotal = nodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const openOrderTotal = nodes.reduce((sum, node) => sum + Number(node.open_order_count || 0), 0);
  renderRemoteNodeFilterOptions(nodes);
  $("remote-nodes-note").textContent = nodes.length
    ? `${numberText(filteredNodes.length, 0)} shown / ${numberText(nodes.length, 0)} monitored node${nodes.length === 1 ? "" : "s"} from ${numberText(payload.total, 0)} status snapshot${payload.total === 1 ? "" : "s"}`
    : "No remote status snapshots have been received yet";
  $("remote-node-count").textContent = numberText(nodes.length, 0);
  $("remote-node-status-summary").textContent = nodes.length ? countSummary(countBy(nodes, "status")) : "No snapshots received";
  $("remote-alert-count").textContent = numberText(alertTotal, 0);
  $("remote-alert-count").className = statusClass(alertTotal ? "warn" : nodes.length ? "ok" : "unknown");
  $("remote-alert-note").textContent = nodes.length ? `${numberText(alertTotal, 0)} alert${alertTotal === 1 ? "" : "s"} across monitored nodes` : "No remote alerts loaded";
  $("remote-open-order-count").textContent = numberText(openOrderTotal, 0);
  $("remote-open-order-count").className = statusClass(openOrderTotal ? "warn" : nodes.length ? "ok" : "unknown");
  $("remote-open-order-note").textContent = nodes.length ? `${numberText(openOrderTotal, 0)} non-terminal order event${openOrderTotal === 1 ? "" : "s"}` : "Sanitized order telemetry only";
  renderRemoteNodesHealth(nodes, filteredNodes);
  renderRemoteNodesAssistant(nodes, filteredNodes);
  $("remote-nodes-body").innerHTML = filteredNodes.length
    ? filteredNodes.map((node) => row([
        escapeHtml(node.node_id),
        statusText(node.status),
        escapeHtml(timestampAgeLabel(node.received_at || node.generated_at)),
        statusText(node.gateway_reachable),
        escapeHtml(text(node.mode)),
        escapeHtml(money(node.final_equity)),
        escapeHtml(numberText(node.position_count, 0)),
        escapeHtml(numberText(node.open_order_count, 0)),
        escapeHtml(`${numberText(node.decision_count, 0)}D / ${numberText(node.order_count, 0)}O / ${numberText(node.fill_count, 0)}F / ${numberText(node.rejection_count, 0)}R`),
        escapeHtml(timestampAgeLabel(node.latest_account_time)),
        escapeHtml(timestampAgeLabel(node.latest_data_time)),
        escapeHtml(numberText(node.alert_count, 0)),
        `<span class="button-pair"><button type="button" class="secondary inspect-remote-node" data-node-id="${escapeHtml(node.node_id)}">Detail</button><button type="button" class="secondary request-remote-status" data-node-id="${escapeHtml(node.node_id)}">Status</button></span>`,
      ])).join("")
    : row([`<span class="muted">${nodes.length ? "No remote nodes match the current filters." : "No cloud monitoring snapshots yet. Post status with scripts/publish_status.py to this receiver or another authenticated endpoint."}</span>`, "", "", "", "", "", "", "", "", "", "", "", ""]);
}

function renderRemoteNodesHealth(nodes = [], filteredNodes = []) {
  if (!$("remote-nodes-health")) return;
  const staleNodes = nodes.filter((node) => {
    const millis = timestampMillis(node.received_at || node.generated_at);
    if (millis === null) return true;
    return ((Date.now() - millis) / 1000) > 900;
  });
  const gatewayDown = nodes.filter((node) => node.gateway_reachable === false);
  const alertTotal = nodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const openOrders = nodes.reduce((sum, node) => sum + Number(node.open_order_count || 0), 0);
  const staleData = nodes.filter((node) => {
    const millis = timestampMillis(node.latest_data_time);
    if (millis === null) return false;
    return ((Date.now() - millis) / 1000) > 900;
  });
  const staleAccounts = nodes.filter((node) => {
    const millis = timestampMillis(node.latest_account_time);
    if (millis === null) return false;
    return ((Date.now() - millis) / 1000) > 900;
  });
  const newest = nodes.slice().sort((left, right) => (
    (timestampMillis(right.received_at || right.generated_at) || 0) - (timestampMillis(left.received_at || left.generated_at) || 0)
  ))[0] || null;
  const cards = [
    {
      status: !nodes.length ? "warn" : staleNodes.length ? "bad" : "ok",
      label: "Heartbeat",
      title: nodes.length ? staleNodes.length ? `${numberText(staleNodes.length, 0)} stale` : "Fresh" : "No Nodes",
      note: newest ? `Newest ${text(newest.node_id)} ${timestampAgeLabel(newest.received_at || newest.generated_at)}.` : "No remote snapshots received.",
    },
    {
      status: gatewayDown.length ? "bad" : nodes.length ? "ok" : "warn",
      label: "Gateway",
      title: gatewayDown.length ? `${numberText(gatewayDown.length, 0)} down` : nodes.length ? "Reachable" : "Unknown",
      note: gatewayDown.length ? gatewayDown.slice(0, 3).map((node) => node.node_id).join(", ") : "No remote Gateway/API blockers in latest snapshots.",
    },
    {
      status: alertTotal ? "warn" : nodes.length ? "ok" : "warn",
      label: "Alerts",
      title: numberText(alertTotal, 0),
      note: alertTotal ? "Inspect Remote Node Detail for latest sanitized alerts." : "No remote alerts in latest node snapshots.",
    },
    {
      status: openOrders ? "warn" : nodes.length ? "ok" : "warn",
      label: "Open Orders",
      title: numberText(openOrders, 0),
      note: openOrders ? "Verify broker state on the local trading machine before issuing controls." : "No non-terminal remote order events.",
    },
    {
      status: staleData.length || staleAccounts.length ? "warn" : nodes.length ? "ok" : "warn",
      label: "Data/Account",
      title: staleData.length || staleAccounts.length ? "Review" : nodes.length ? "Current" : "Unknown",
      note: `${numberText(staleData.length, 0)} stale data / ${numberText(staleAccounts.length, 0)} stale account timestamp${staleAccounts.length === 1 ? "" : "s"}.`,
    },
    {
      status: filteredNodes.length ? "ok" : nodes.length ? "warn" : "bad",
      label: "Filtered View",
      title: `${numberText(filteredNodes.length, 0)} / ${numberText(nodes.length, 0)}`,
      note: filteredNodes.length ? "The table below matches the current filters." : "Clear filters to see monitored nodes.",
    },
  ];
  $("remote-nodes-health").innerHTML = cards.map((card) => `
    <div class="health-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderRemoteNodeRunHealth(detail = {}, runs = [], activity = []) {
  if (!$("remote-node-run-health")) return;
  const selected = Boolean(detail.node_id);
  const artifactRows = remoteRunArtifactEvidenceRows(runs);
  const artifactExisting = artifactRows.reduce((sum, item) => sum + Number(item.evidence.existing_count || 0), 0);
  const artifactMissing = artifactRows.reduce((sum, item) => sum + Number(item.evidence.missing_count || 0), 0);
  const statusCounts = countBy(runs, "status");
  const failedCount = runs.filter((runItem) => ["failed", "timeout", "error", "rejected"].includes(text(runItem.status).toLowerCase())).length;
  const completedCount = runs.filter((runItem) => text(runItem.status).toLowerCase() === "completed").length;
  const totalDecisions = runs.reduce((sum, runItem) => sum + Number(runItem.decisions || 0), 0);
  const totalOrders = runs.reduce((sum, runItem) => sum + Number(runItem.orders || 0), 0);
  const totalFills = runs.reduce((sum, runItem) => sum + Number(runItem.fills || 0), 0);
  const totalRejections = runs.reduce((sum, runItem) => sum + Number(runItem.rejections || 0), 0);
  const latestDecisionRun = runs
    .map((runItem) => ({ runItem, millis: timestampMillis(runItem.last_decision_time) }))
    .filter((item) => item.millis !== null)
    .sort((left, right) => right.millis - left.millis)[0] || null;
  const latestEquityRun = runs.find((runItem) => finiteNumber(runItem.final_equity) !== null) || null;
  const cards = [
    {
      status: !selected ? "bad" : !runs.length ? "warn" : failedCount ? "bad" : "ok",
      label: "Latest Runs",
      title: runs.length ? `${numberText(completedCount, 0)} completed` : selected ? "No Runs" : "Select Node",
      note: runs.length ? `${numberText(runs.length, 0)} bounded run summaries; ${countSummary(statusCounts)}.` : "Select a node or wait for published run summaries.",
    },
    {
      status: !selected ? "bad" : activity.length ? "ok" : runs.length ? "warn" : "bad",
      label: "Activity",
      title: `${numberText(totalDecisions, 0)}D / ${numberText(totalOrders, 0)}O / ${numberText(totalFills, 0)}F`,
      note: activity.length
        ? `${numberText(activity.length, 0)} sanitized decisions/orders/fills are visible below.`
        : "No bounded decision, order, or fill rows in latest run summaries.",
    },
    {
      status: totalRejections ? "warn" : runs.length ? "ok" : "warn",
      label: "Rejections",
      title: numberText(totalRejections, 0),
      note: totalRejections ? "Review remote activity locally before issuing controls." : "No rejection count in latest remote run summaries.",
    },
    {
      status: !selected ? "bad" : latestDecisionRun ? "ok" : runs.length ? "warn" : "bad",
      label: "Latest Decision",
      title: latestDecisionRun ? timestampAgeLabel(latestDecisionRun.runItem.last_decision_time) : "n/a",
      note: latestDecisionRun
        ? `${text(latestDecisionRun.runItem.id)} published the newest decision timestamp.`
        : "Run summaries did not publish last_decision_time.",
    },
    {
      status: latestEquityRun ? "ok" : runs.length ? "warn" : "bad",
      label: "Equity Snapshot",
      title: latestEquityRun ? money(latestEquityRun.final_equity) : "n/a",
      note: latestEquityRun
        ? `${text(latestEquityRun.id)} / cash ${money(latestEquityRun.final_cash)} / positions ${numberText(latestEquityRun.position_count, 0)}.`
        : "Run summaries did not publish final equity.",
    },
    {
      status: !selected ? "bad" : artifactRows.length ? artifactMissing ? "warn" : "ok" : runs.length ? "warn" : "bad",
      label: "Artifact Evidence",
      title: artifactRows.length ? `${numberText(artifactExisting, 0)} files` : "none",
      note: artifactRows.length
        ? `${numberText(artifactRows.length, 0)} run${artifactRows.length === 1 ? "" : "s"} published bounded artifact evidence; ${numberText(artifactMissing, 0)} expected file${artifactMissing === 1 ? "" : "s"} missing.`
        : "Status publisher did not include artifact evidence for these latest runs.",
    },
    {
      status: "warn",
      label: "Cloud Boundary",
      title: "Sanitized",
      note: "Remote detail shows bounded summaries only; raw logs, credentials, and private strategy diagnostics stay local.",
    },
  ];
  $("remote-node-run-health").innerHTML = cards.map((card) => `
    <div class="health-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderRemoteNodeBoundaryPolicy(detail = {}) {
  if (!$("remote-node-boundary-note") || !$("remote-node-boundary-cards")) return;
  const policy = detail.boundary_policy || {};
  const hasPolicy = Boolean(policy.name);
  const excluded = policy.excluded || [];
  const included = policy.included || [];
  $("remote-node-boundary-note").textContent = hasPolicy
    ? text(policy.retention_note || "Remote detail is bounded and sanitized before display.")
    : "Remote detail uses bounded sanitized status summaries.";
  const cards = [
    {
      status: detail.node_id ? "ok" : "warn",
      label: "Boundary",
      title: hasPolicy ? "Sanitized" : "Not Loaded",
      note: hasPolicy ? text(policy.scope) : "Select a node to load the remote detail boundary.",
    },
    {
      status: hasPolicy ? "ok" : "warn",
      label: "Snapshot Limit",
      title: numberText(policy.snapshot_limit || detail.limit || 0, 0),
      note: `${numberText(policy.latest_run_limit || 0, 0)} latest runs / ${numberText(policy.recent_event_limit_per_stream || 0, 0)} events per stream.`,
    },
    {
      status: hasPolicy ? "ok" : "warn",
      label: "Artifact Evidence",
      title: `${numberText(policy.artifact_file_limit_per_run || 0, 0)} files`,
      note: "Names, categories, sizes, modified times, and row counts only.",
    },
    {
      status: "warn",
      label: "Excluded",
      title: `${numberText(excluded.length, 0)} classes`,
      note: excluded.slice(0, 4).join(", ") || "Raw logs, credentials, and private diagnostics stay local.",
    },
    {
      status: hasPolicy ? "ok" : "warn",
      label: "Included",
      title: `${numberText(included.length, 0)} classes`,
      note: included.slice(0, 3).join(", ") || "Bounded summary rows only.",
    },
  ];
  $("remote-node-boundary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderRemoteNodeDetail() {
  if (!$("remote-node-detail-summary") || !$("remote-node-detail-note")) return;
  const detail = state.remoteNodeDetail || {};
  const summary = detail.summary || {};
  const runs = detail.runs || [];
  const alerts = detail.alerts || [];
  const history = detail.history || [];
  const activity = remoteNodeActivityEvents(runs);
  const artifactRows = remoteRunArtifactEvidenceRows(runs);
  const artifactFileCount = artifactRows.reduce((sum, item) => sum + Number(item.evidence.existing_count || 0), 0);
  const artifactRowCount = artifactRows.reduce((sum, item) => sum + Number(item.evidence.jsonl_row_count || 0), 0);
  const activityFilter = remoteDetailActivityFilter();
  const filteredActivity = activityFilter ? activity.filter((event) => event.type === activityFilter) : activity;
  const latestActivity = activity[0] || {};
  renderRemoteDetailAssistant(detail, {
    activity,
    artifactRows,
    filteredActivity,
  });
  $("remote-node-detail-note").textContent = detail.node_id
    ? `${text(detail.node_id)} / ${numberText(detail.total, 0)} stored status snapshot${detail.total === 1 ? "" : "s"}`
    : "Select a remote node to inspect bounded sanitized status detail";
  if ($("export-remote-node-detail-csv")) {
    $("export-remote-node-detail-csv").disabled = !detail.node_id;
  }
  $("remote-detail-snapshot-count").textContent = numberText(detail.count || 0, 0);
  $("remote-detail-snapshot-note").textContent = detail.node_id
    ? `${numberText(detail.count || 0, 0)} loaded / ${numberText(detail.total || 0, 0)} stored`
    : "Select a node";
  $("remote-detail-activity-count").textContent = numberText(filteredActivity.length, 0);
  $("remote-detail-activity-note").textContent = activity.length
    ? `${text(latestActivity.type)} ${timestampAgeLabel(eventTimestamp(latestActivity))}`
    : "No sanitized activity in latest runs";
  $("remote-detail-alert-count").textContent = numberText(alerts.length, 0);
  $("remote-detail-alert-count").className = statusClass(alerts.length ? "warn" : detail.node_id ? "ok" : "unknown");
  $("remote-detail-alert-note").textContent = detail.node_id
    ? `${numberText(alerts.length, 0)} latest alert${alerts.length === 1 ? "" : "s"}`
    : "No node selected";
  if ($("remote-detail-artifact-count")) {
    $("remote-detail-artifact-count").textContent = numberText(artifactFileCount, 0);
    $("remote-detail-artifact-count").className = statusClass(artifactRows.length ? "ok" : detail.node_id ? "warn" : "unknown");
  }
  if ($("remote-detail-artifact-note")) {
    $("remote-detail-artifact-note").textContent = artifactRows.length
      ? `${numberText(artifactRows.length, 0)} run${artifactRows.length === 1 ? "" : "s"} / ${numberText(artifactRowCount, 0)} JSONL row${artifactRowCount === 1 ? "" : "s"}`
      : detail.node_id ? "No artifact evidence published by latest run summaries" : "No node selected";
  }
  renderRemoteNodeRunHealth(detail, runs, activity);
  renderRemoteNodeBoundaryPolicy(detail);
  const pairs = detail.node_id
    ? [
        ["Node", text(detail.node_id)],
        ["Status", text(summary.status)],
        ["Heartbeat", timestampAgeLabel(summary.received_at || summary.generated_at)],
        ["Gateway", text(summary.gateway_reachable)],
        ["Mode", text(summary.mode)],
        ["Equity", money(summary.final_equity)],
        ["Positions", numberText(summary.position_count, 0)],
        ["Open Orders", numberText(summary.open_order_count, 0)],
        ["Latest Account", timestampAgeLabel(summary.latest_account_time)],
        ["Latest Data", timestampAgeLabel(summary.latest_data_time)],
      ]
    : [["Next", "Click Detail on a Remote Nodes row."]];
  $("remote-node-detail-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  $("remote-node-activity-body").innerHTML = filteredActivity.length
    ? filteredActivity.map((event) => row([
        escapeHtml(eventTimestamp(event)),
        escapeHtml(text(event.run_id)),
        statusText(event.type),
        escapeHtml(text(eventSymbol(event))),
        statusText(eventStatus(event, event.type)),
        escapeHtml(eventDetail(event)),
      ])).join("")
    : row([`<span class="muted">${activity.length ? "No remote activity matches this filter." : "No sanitized recent decisions, orders, or fills in the latest run summaries."}</span>`, "", "", "", "", ""]);
  $("remote-node-runs-body").innerHTML = runs.length
    ? runs.map((runItem) => row([
        escapeHtml(runItem.id),
        statusText(runItem.status),
        escapeHtml(text(runItem.mode)),
        escapeHtml(money(runItem.final_equity)),
        escapeHtml(`${numberText(runItem.decisions, 0)}D / ${numberText(runItem.orders, 0)}O / ${numberText(runItem.fills, 0)}F / ${numberText(runItem.rejections, 0)}R`),
        escapeHtml(timestampAgeLabel(runItem.last_decision_time)),
      ])).join("")
    : row([`<span class="muted">No latest run summaries in this node snapshot.</span>`, "", "", "", "", ""]);
  if ($("remote-node-artifacts-note")) {
    $("remote-node-artifacts-note").textContent = artifactRows.length
      ? `${numberText(artifactRows.length, 0)} bounded run artifact evidence summar${artifactRows.length === 1 ? "y" : "ies"}; categories, file names, row counts, and sizes only.`
      : "No artifact evidence was published for the selected node.";
  }
  if ($("remote-node-artifacts-body")) {
    $("remote-node-artifacts-body").innerHTML = artifactRows.length
      ? artifactRows.map(({ run: runItem, evidence }) => row([
          escapeHtml(runItem.id),
          escapeHtml(`${numberText(evidence.existing_count, 0)} / ${numberText(evidence.expected_count, 0)}`),
          escapeHtml(numberText(evidence.jsonl_row_count, 0)),
          escapeHtml(remoteArtifactCategorySummary(evidence)),
          escapeHtml(bytes(evidence.total_bytes)),
          escapeHtml(timestampAgeLabel(evidence.latest_modified_at)),
          escapeHtml(remoteArtifactMissingNames(evidence)),
        ])).join("")
      : row([`<span class="muted">${runs.length ? "Latest runs do not include artifact evidence yet. Update scripts/publish_status.py on the publishing node." : "No latest run summaries in this node snapshot."}</span>`, "", "", "", "", "", ""]);
  }
  $("remote-node-alerts-body").innerHTML = alerts.length
    ? alerts.map((alert) => row([
        statusText(alert.level === "warn" ? "warn" : alert.level),
        escapeHtml(alert.kind),
        escapeHtml(alert.message),
      ])).join("")
    : row([`<span class="muted">No latest alerts in this node snapshot.</span>`, "", ""]);
  $("remote-node-history-body").innerHTML = history.length
    ? history.map((item) => {
        const remoteLabel = item.remote_latest_event
          ? `${text(item.remote_latest_event)} ${text(item.remote_latest_action)} ${text(item.remote_latest_status)}`
          : "none";
        return row([
          escapeHtml(item.received_at),
          statusText(item.status),
          statusText(item.gateway_reachable),
          escapeHtml(numberText(item.alert_count, 0)),
          jsonDrilldown(item.run_status_counts || {}, countSummary(item.run_status_counts || {})),
          escapeHtml(remoteLabel),
        ]);
      }).join("")
    : row([`<span class="muted">No bounded history loaded for this node.</span>`, "", "", "", "", ""]);
}

function renderHistory() {
  $("history-body").innerHTML = state.history.length
    ? state.history.map((snapshot) => {
        const remoteLabel = snapshot.remote_latest_event
          ? `${text(snapshot.remote_latest_event)} ${text(snapshot.remote_latest_action)} ${text(snapshot.remote_latest_status)}`
          : "none";
        return row([
          escapeHtml(snapshot.received_at),
          escapeHtml(snapshot.node_id),
          statusText(snapshot.status),
          statusText(snapshot.gateway_reachable),
          escapeHtml(snapshot.alert_count),
          jsonDrilldown(snapshot.run_status_counts || {}, countSummary(snapshot.run_status_counts || {})),
          jsonDrilldown(snapshot.supervisor_status_counts || {}, countSummary(snapshot.supervisor_status_counts || {})),
          escapeHtml(remoteLabel),
        ]);
      }).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", ""]);
}

function renderCommands() {
  $("commands-body").innerHTML = state.commands.length
    ? state.commands.map((command) => row([
        escapeHtml(command.command_id),
        escapeHtml(command.node_id),
        escapeHtml(command.action),
        jsonDrilldown(command.params || {}, objectSummary(command.params || {})),
        statusText(command.status),
        escapeHtml(command.created_at),
        command.status === "pending"
          ? `<button type="button" class="secondary cancel-command" data-command-id="${escapeHtml(command.command_id)}" data-node-id="${escapeHtml(command.node_id)}">Cancel</button>`
          : "",
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", ""]);
}

function renderResults() {
  $("results-body").innerHTML = state.results.length
    ? state.results.slice(-20).reverse().map((result) => row([
        escapeHtml(result.command_id),
        escapeHtml(result.action),
        statusText(result.status),
        escapeHtml(result.received_at),
        jsonDrilldown(result.result || result.error || {}, objectSummary(result.result || result.error || {})),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", ""]);
}

function renderCommandAudit() {
  const events = (state.commandAudit && state.commandAudit.events) || [];
  const integrity = (state.commandAudit && state.commandAudit.integrity) || {};
  const retention = (state.commandAudit && state.commandAudit.retention_policy) || {};
  const signatureText = integrity.signature_status
    ? `signature ${integrity.signature_status}${integrity.signature_key_env ? ` via ${integrity.signature_key_env}` : ""}; signed ${numberText(integrity.signed_records, 0)} / unsigned ${numberText(integrity.unsigned_records, 0)}`
    : "signature not loaded";
  const integrityText = integrity.status
    ? `Integrity ${integrity.status}; checked ${numberText(integrity.checked_records, 0)} hashed records; ${signatureText}`
    : "Integrity not loaded";
  const retentionText = retention.status
    ? ` Retention ${text(retention.status)}: ${text(retention.summary)}`
    : "";
  $("command-audit-note").textContent = events.length
    ? `${events.length} latest sanitized command audit events. ${integrityText}${retentionText}`
    : `No command audit events have been recorded yet. ${integrityText}${retentionText}`;
  renderCommandAuditHealth(events, integrity, retention);
  $("command-audit-body").innerHTML = events.length
    ? events.slice(-30).reverse().map((event) => row([
        escapeHtml(event.audited_at),
        escapeHtml(event.event),
        escapeHtml(event.node_id),
        escapeHtml(event.command_id),
        escapeHtml(event.action),
        statusText(event.status || (event.error ? "rejected" : "")),
        event.row_signature ? statusText("ok") : `<span class="muted">${integrity.signature_status === "disabled" ? "disabled" : "unsigned"}</span>`,
        escapeHtml(Array.isArray(event.param_keys) ? event.param_keys.join(", ") : ""),
        event.error ? `<span class="status-bad">${escapeHtml(event.error)}</span>` : "",
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", ""]);
}

function renderCommandAuditHealth(events = [], integrity = {}, retention = {}) {
  if (!$("command-audit-health")) return;
  const latest = events.slice().reverse()[0] || events[0] || null;
  const status = text(integrity.status || "unknown");
  const signatureStatus = text(integrity.signature_status || "disabled");
  const checked = Number(integrity.checked_records || 0);
  const signed = Number(integrity.signed_records || 0);
  const unsigned = Number(integrity.unsigned_records || 0);
  const legacy = Number(integrity.legacy_records || 0);
  const signatureTotal = signed + unsigned;
  const retentionStatus = text(retention.status || "not_loaded");
  const cards = [
    {
      status: status === "ok" ? "ok" : checked ? "bad" : "warn",
      label: "Hash Chain",
      title: status,
      note: checked ? `${numberText(checked, 0)} checked; ${numberText(legacy, 0)} legacy rows.` : "No hash-chained records checked yet.",
    },
    {
      status: signatureStatus === "ok" ? "ok" : signatureStatus === "disabled" ? "warn" : "bad",
      label: "Signature",
      title: signatureStatus,
      note: signatureTotal
        ? `${numberText(signed, 0)} signed / ${numberText(unsigned, 0)} unsigned${integrity.signature_key_env ? ` via ${text(integrity.signature_key_env)}` : ""}.`
        : "HMAC signing is disabled or no signed records exist yet.",
    },
    {
      status: latest ? latest.error ? "bad" : latest.status === "rejected" ? "warn" : "ok" : "warn",
      label: "Latest Event",
      title: latest ? text(latest.event || latest.action || "event") : "none",
      note: latest
        ? `${text(latest.node_id)} / ${text(latest.action)} / ${text(latest.status || "recorded")} / ${timestampAgeLabel(latest.audited_at)}`
        : "No sanitized command audit rows are loaded.",
    },
    {
      status: retentionStatus === "blocked" ? "bad" : "warn",
      label: "Retention",
      title: retentionStatus,
      note: retention.summary || "Export CSV or use ops/cloud/sync-command-audit.example.sh for dry-run-first off-host retention.",
    },
    {
      status: retention.off_host_retention_verified ? "ok" : "warn",
      label: "Off-host",
      title: retention.off_host_retention_verified ? "Verified" : text(retention.off_host_status || "not_verified"),
      note: retention.off_host_sync_helper
        ? `Use ${text(retention.off_host_sync_helper)}; provider retention examples must be verified in a real account.`
        : "No off-host retention policy is loaded.",
    },
  ];
  $("command-audit-health").innerHTML = cards.map((card) => `
    <div class="health-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderAll() {
  renderOverview();
  renderOverviewChanges();
  renderMetrics();
  renderPerformance();
  renderStatusEquityRollups();
  renderPerformancePeriodRollups();
  renderPerformanceRollups();
  renderWorkbenchStatus();
  renderCleanupPlan();
  renderDiagnostics();
  renderEndpointMap();
  renderDataCatalog();
  renderDataDetail();
  renderDataCompareControls();
  renderDataCompare();
  renderDataCoverage();
  renderDataGapSummary();
  renderDataMinuteHeatmap();
  renderDataStorageAudit();
  renderSymbolDiagnostic();
  renderFetchJobs();
  renderFetchManifestDetail();
  renderConfigBuilder();
  renderWorkbenchRuns();
  renderRunComparison();
  renderRunDetail();
  renderWorkbenchArtifacts();
  renderRuns();
  renderRunEvents();
  renderSupervisors();
  renderRemoteControl();
  renderAlerts();
  renderGateway();
  renderPaperMonitor();
  renderRemoteNodes();
  renderRemoteNodeDetail();
  renderHistory();
  renderCommands();
  renderResults();
  renderCommandAudit();
  renderControlAssistant();
  renderOperationsHome();
  renderHelpSetupGaps();
  renderPageIntro();
  $("last-refresh").textContent = `Last refresh: ${new Date().toLocaleString()}`;
}

function shouldLoadDataDiagnostics() {
  return activeView() === "data" && selectedDataLens() === "diagnostics";
}

async function refreshDataDiagnostics({ force = false } = {}) {
  const loadState = dataLibraryLoadState();
  if (loadState.diagnosticsLoading && !force) return;
  if (loadState.diagnosticsLoaded && !force) return;
  loadState.diagnosticsLoading = true;
  loadState.diagnosticsError = "";
  setDataDiagnosticsLoadingNote("Loading Data Library diagnostics; large local caches can take a while.", "warn");
  const requestId = loadState.requestId;
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const storageScanLimit = encodeURIComponent($("data-storage-scan-limit").value || "5000");
  try {
    const dataCoverage = await fetchJson(`/data_coverage?limit=${catalogLimit}&max_symbols=60&max_dates=60`);
    if (requestId !== loadState.requestId) return;
    state.dataCoverage = dataCoverage || { symbols: [], date_bins: [], errors: [] };
    renderDataCoverage();
    const dataGapSummary = await fetchJson(`/data_gap_summary?catalog_limit=${catalogLimit}&top_limit=20`);
    if (requestId !== loadState.requestId) return;
    state.dataGapSummary = dataGapSummary || { gap_rows: [], calendar_rows: [] };
    renderDataGapSummary();
    const dataMinuteHeatmap = await fetchJson(`/data_minute_heatmap?catalog_limit=${catalogLimit}&top_limit=20`);
    if (requestId !== loadState.requestId) return;
    state.dataMinuteHeatmap = dataMinuteHeatmap || { rows: [], errors: [] };
    renderDataMinuteHeatmap();
    const dataStorageAudit = await fetchJson(`/data_storage_audit?catalog_limit=${catalogLimit}&scan_limit=${storageScanLimit}`);
    if (requestId !== loadState.requestId) return;
    state.dataStorageAudit = dataStorageAudit || { configured_roots: [], suggested_roots: [], warnings: [] };
    loadState.diagnosticsLoaded = true;
    loadState.diagnosticsRequested = false;
    renderDataStorageAudit();
    renderDataLibrarySummary();
    renderPageIntro();
  } catch (err) {
    if (requestId !== loadState.requestId) return;
    loadState.diagnosticsError = err.message;
    setDataDiagnosticsLoadingNote(`Data diagnostics refresh failed: ${err.message}`, "bad");
  } finally {
    if (requestId === loadState.requestId) {
      loadState.diagnosticsLoading = false;
    }
  }
}

async function refreshDataLibrary({ includeDiagnostics = false, force = false } = {}) {
  const loadState = dataLibraryLoadState();
  if (includeDiagnostics) loadState.diagnosticsRequested = true;
  if (loadState.catalogLoading && !force) return;
  if (loadState.catalogLoaded && !force) {
    if (includeDiagnostics || loadState.diagnosticsRequested) {
      await refreshDataDiagnostics({ force: false });
    }
    return;
  }
  const requestId = loadState.requestId + 1;
  loadState.requestId = requestId;
  loadState.catalogLoading = true;
  loadState.catalogError = "";
  loadState.diagnosticsLoaded = false;
  loadState.diagnosticsError = "";
  loadState.diagnosticsRequested = Boolean(includeDiagnostics);
  state.dataCoverage = { symbols: [], date_bins: [], errors: [] };
  state.dataGapSummary = { gap_rows: [], calendar_rows: [] };
  state.dataMinuteHeatmap = { rows: [], errors: [] };
  state.dataStorageAudit = { configured_roots: [], suggested_roots: [], warnings: [] };
  renderDataCatalog();
  renderDataCoverage();
  renderDataGapSummary();
  renderDataMinuteHeatmap();
  renderDataStorageAudit();
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  try {
    const dataCatalog = await fetchJson(`/data_catalog?limit=${catalogLimit}&preview_points=${dataCatalogPreviewPoints()}`);
    if (requestId !== loadState.requestId) return;
    state.dataCatalog = dataCatalog || { datasets: [], errors: [] };
    loadState.catalogLoaded = true;
    loadState.catalogLoading = false;
    renderDataCatalog();
    renderDataDetail();
    renderDataCompareControls();
    renderConfigBuilder();
    renderMetrics();
    renderPageIntro();
    $("last-refresh").textContent = `Data catalog loaded: ${new Date().toLocaleString()}`;
    if (includeDiagnostics || loadState.diagnosticsRequested) {
      await refreshDataDiagnostics({ force });
    }
  } catch (err) {
    if (requestId !== loadState.requestId) return;
    loadState.catalogError = err.message;
    $("last-refresh").textContent = `Data catalog refresh failed: ${err.message}`;
  } finally {
    if (requestId === loadState.requestId) {
      loadState.catalogLoading = false;
      renderDataCatalog();
    }
  }
}

async function refresh(options = {}) {
  const node = $("command-node").value || (state.status && state.status.node_id) || "";
  const beforeActivity = state.refreshLoaded ? activitySnapshot() : null;
  const status = await fetchJson("/status");
  state.status = status;
  const nodeId = encodeURIComponent(node || status.node_id || "");
  const [
    history,
    remoteNodes,
    diagnostics,
    fetchManifests,
    workbenchStatus,
    cleanupPlan,
    endpointMap,
    configOptions,
    configDrafts,
    draftValidations,
    configRuns,
    runComparison,
    performanceRollups,
    statusEquityRollups,
    commands,
    results,
    commandAudit,
  ] = await Promise.all([
    fetchJson(`/status_history${nodeId ? `?node_id=${nodeId}&limit=20` : "?limit=20"}`),
    fetchJson("/remote_nodes?limit=100"),
    fetchJson("/workbench_diagnostics"),
    fetchJson("/fetch_manifests?limit=50"),
    fetchJson("/workbench_status"),
    fetchJson("/workbench_cleanup_plan"),
    fetchJson("/workbench_endpoints"),
    fetchJson("/config_options"),
    fetchJson("/config_drafts"),
    fetchJson("/config_draft_validations"),
    fetchJson("/config_draft_runs?limit=20"),
    fetchJson("/config_draft_run_comparison?limit=50"),
    fetchJson("/config_draft_daily_rollups?limit=100&run_limit=100"),
    fetchJson("/status_equity_rollups?limit=100&history_limit=5000"),
    fetchJson(`/commands${nodeId ? `?node_id=${nodeId}` : ""}`),
    fetchJson(`/command_results${nodeId ? `?node_id=${nodeId}` : ""}`),
    fetchJson(`/command_audit${nodeId ? `?node_id=${nodeId}&limit=100` : "?limit=100"}`),
  ]);
  state.diagnostics = diagnostics || {};
  syncDataCatalogLimitControl();
  state.history = history.history || [];
  state.remoteNodes = remoteNodes || { nodes: [] };
  state.fetchManifests = fetchManifests || { manifests: [], roots: [], errors: [] };
  state.workbenchStatus = workbenchStatus || {};
  state.cleanupPlan = cleanupPlan || {};
  state.endpointMap = endpointMap || { endpoints: [] };
  state.configOptions = configOptions || { plugins: [], modes: [], defaults: {} };
  state.configDrafts = configDrafts || { drafts: [], errors: [] };
  state.draftValidations = draftValidations || { validations: [] };
  state.configRuns = configRuns || { runs: [] };
  state.runComparison = runComparison || { runs: [], leaders: {} };
  state.performanceRollups = performanceRollups || { rollups: [], errors: [] };
  state.statusEquityRollups = statusEquityRollups || { rollups: [], period_rollups: {} };
  state.commands = commands.commands || [];
  state.results = results.results || [];
  state.commandAudit = commandAudit || { events: [] };
  state.activityChanges = activityChanges(beforeActivity, activitySnapshot());
  state.refreshLoaded = true;
  renderAll();
  refreshDataLibrary({
    includeDiagnostics: Boolean(options.forceDataDiagnostics || shouldLoadDataDiagnostics()),
    force: Boolean(options.forceData),
  }).catch((err) => {
    $("last-refresh").textContent = `Data Library refresh failed: ${err.message}`;
  });
}

function configDraftRequestPayload({ saveOverride = null } = {}) {
  const selected = selectedConfigDatasets();
  if (!selected.length) {
    throw new Error("Select at least one saved dataset first");
  }
  return {
    name: $("config-name").value,
    plugin_id: $("config-plugin").value,
    mode: $("config-mode").value,
    strategy: configPluginStrategyPayload(),
    datasets: selected.map((dataset) => ({ symbol: dataset.symbol, path: dataset.path })),
    ...configDateRangePayload(),
    starting_cash: $("config-starting-cash").value,
    history_bars: $("config-history-bars").value,
    session_enabled: $("config-session-enabled").checked,
    session_timezone: $("config-session-timezone").value,
    session_start: $("config-session-start").value,
    session_end: $("config-session-end").value,
    session_weekdays: $("config-session-weekdays").value,
    session_outside: $("config-session-outside").value,
    risk_preset: $("config-risk-preset").value,
    max_steps: $("config-max-steps").value,
    max_orders_per_run: $("config-max-orders").value,
    max_notional_per_order: $("config-max-notional").value,
    max_quantity: $("config-max-quantity").value,
    max_cash_quantity: $("config-max-cash").value,
    max_gross_exposure_pct: $("config-max-exposure").value,
    sim_slippage_bps: $("config-slippage").value,
    sim_commission_bps: $("config-commission").value,
    allow_quality_warnings: $("config-allow-quality-warnings").checked,
    save: saveOverride === null ? $("config-save").checked : Boolean(saveOverride),
  };
}

async function submitConfigDraft({ previewOnly = false } = {}) {
  const payload = configDraftRequestPayload({ saveOverride: previewOnly ? false : null });
  const response = await fetchJson(previewOnly ? "/config_draft_preview" : "/config_draft", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.configDraft = response.draft;
  state.configDraftErrors = [];
  state.alignmentPreview = response.draft ? response.draft.alignment || null : null;
  if (response.draft && response.draft.saved_path) {
    state.configDrafts = await fetchJson("/config_drafts");
    state.draftValidations = await fetchJson("/config_draft_validations");
    state.workbenchStatus = await fetchJson("/workbench_status");
    state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  }
  renderConfigBuilder();
  renderWorkbenchRuns();
  renderRunComparison();
  renderWorkbenchStatus();
  renderCleanupPlan();
  $("last-refresh").textContent = previewOnly
    ? `Config draft preview generated: ${new Date().toLocaleString()}`
    : `Config draft generated: ${new Date().toLocaleString()}`;
}

async function generateConfigDraft(event) {
  event.preventDefault();
  await submitConfigDraft({ previewOnly: false });
}

async function previewConfigAlignment() {
  const selected = selectedConfigDatasets();
  if (!selected.length) {
    $("config-alignment-note").innerHTML = `<span class="status-bad">Select at least one saved dataset first</span>`;
    $("config-alignment").innerHTML = "";
    return;
  }
  const response = await fetchJson("/data_alignment", {
    method: "POST",
    body: JSON.stringify({
      datasets: selected.map((dataset) => ({ symbol: dataset.symbol, path: dataset.path })),
      ...configDateRangePayload(),
    }),
  });
  state.alignmentPreview = response.alignment || {};
  renderConfigAlignment(state.alignmentPreview);
  renderWorkbenchBuilderAssistant();
  renderConfigBuilderReadiness();
  renderConfigCompatibility();
  $("last-refresh").textContent = `Alignment preview loaded: ${new Date().toLocaleString()}`;
}

function dataDetailQuery(path) {
  const params = new URLSearchParams();
  params.set("path", path);
  params.set("preview_points", $("data-detail-points").value || "600");
  params.set("gap_limit", "30");
  params.set("missing_interval_limit", "120");
  params.set("sample_mode", $("data-detail-mode").value || "sampled");
  const start = $("data-detail-start").value;
  const end = $("data-detail-end").value;
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return params.toString();
}

function dataDetailCoverageRange(detail = state.dataDetail || {}) {
  const coverage = detail.coverage || {};
  const viewer = detail.viewer || {};
  const start = timestampMillis(coverage.first_timestamp || viewer.first_timestamp);
  const end = timestampMillis(coverage.last_timestamp || viewer.last_timestamp);
  return { start, end };
}

function largestDataDetailGap(detail = state.dataDetail || {}) {
  const gaps = (detail && detail.gaps) || [];
  const valid = gaps.filter((gap) => gap && gap.from_timestamp && gap.to_timestamp);
  if (!valid.length) return null;
  return valid.slice().sort((left, right) => {
    const rightScore = finiteNumber(right.gap_seconds) ?? finiteNumber(right.estimated_missing_intervals) ?? 0;
    const leftScore = finiteNumber(left.gap_seconds) ?? finiteNumber(left.estimated_missing_intervals) ?? 0;
    return rightScore - leftScore;
  })[0];
}

async function focusDataDetailLargestGap() {
  const path = state.dataDetailPath || (state.dataDetail && state.dataDetail.path) || "";
  if (!path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Open a saved dataset before focusing a gap</span>`;
    return;
  }
  const gap = largestDataDetailGap();
  if (!gap) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">No returned gaps are available for the current saved file</span>`;
    return;
  }
  const start = dateInputValueFromTimestamp(gap.from_timestamp);
  const end = dateInputValueFromTimestamp(gap.to_timestamp);
  if (!start || !end) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Largest gap timestamps could not be converted to a date range</span>`;
    return;
  }
  $("data-detail-start").value = start;
  $("data-detail-end").value = end;
  $("data-detail-range-preset").value = "custom";
  await loadDataDetail(path);
  $("last-refresh").textContent = `Focused largest gap: ${start} to ${end}`;
}

async function applyDataDetailRangePreset() {
  const preset = $("data-detail-range-preset").value || "custom";
  if (preset === "custom") return;
  const path = state.dataDetailPath || (state.dataDetail && state.dataDetail.path) || "";
  if (!path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Open a saved dataset before applying a range preset</span>`;
    $("data-detail-range-preset").value = "custom";
    return;
  }
  const range = dataDetailCoverageRange();
  if (range.start === null || range.end === null) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Selected file does not expose a timestamp range for presets</span>`;
    $("data-detail-range-preset").value = "custom";
    return;
  }
  if (preset === "full") {
    $("data-detail-start").value = "";
    $("data-detail-end").value = "";
  } else {
    const days = Number(preset.replace("d", ""));
    if (!Number.isFinite(days) || days <= 0) {
      $("data-detail-range-preset").value = "custom";
      return;
    }
    const oneDay = 24 * 60 * 60 * 1000;
    const startMillis = Math.max(range.start, range.end - Math.max(0, days - 1) * oneDay);
    $("data-detail-start").value = new Date(startMillis).toISOString().slice(0, 10);
    $("data-detail-end").value = new Date(range.end).toISOString().slice(0, 10);
  }
  await loadDataDetail(path);
  $("last-refresh").textContent = `Data detail range preset applied: ${preset}`;
}

async function loadDataDetail(path, { resetControls = false } = {}) {
  if (!path) throw new Error("dataset path is required");
  state.dataDetailPath = path;
  if (resetControls) {
    $("data-detail-start").value = "";
    $("data-detail-end").value = "";
    $("data-detail-range-preset").value = "custom";
    $("data-detail-points").value = "600";
    $("data-detail-mode").value = "sampled";
  }
  const response = await fetchJson(`/data_detail?${dataDetailQuery(path)}`);
  state.dataDetail = response;
  renderDataDetail();
  if (activeView() === "data") applyDataLens("inspect");
  $("last-refresh").textContent = `Data detail loaded: ${new Date().toLocaleString()}`;
}

async function loadPerformanceBenchmark() {
  const path = $("performance-benchmark").value || "";
  state.performanceBenchmarkPath = path;
  if (!path) {
    state.performanceBenchmarkDetail = null;
    renderPerformance();
    $("last-refresh").textContent = `Benchmark overlay cleared: ${new Date().toLocaleString()}`;
    return;
  }
  const params = new URLSearchParams();
  params.set("path", path);
  params.set("preview_points", "600");
  params.set("gap_limit", "20");
  params.set("sample_mode", "sampled");
  const response = await fetchJson(`/data_detail?${params.toString()}`);
  state.performanceBenchmarkDetail = response;
  renderPerformance();
  $("last-refresh").textContent = `Benchmark loaded: ${new Date().toLocaleString()}`;
}

async function reloadDataDetail(event) {
  event.preventDefault();
  const path = state.dataDetailPath || (state.dataDetail && state.dataDetail.path) || "";
  if (!path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Select a saved dataset first</span>`;
    return;
  }
  await loadDataDetail(path);
}

async function loadDataDetailForSymbol() {
  const symbol = ($("data-detail-symbol").value || "").trim().toUpperCase();
  if (!symbol) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Enter a scanned symbol first</span>`;
    return;
  }
  const dataset = bestCatalogDatasetForSymbol(symbol);
  if (!dataset || !dataset.path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">No catalog file found for ${escapeHtml(symbol)}</span>`;
    return;
  }
  await loadDataDetail(dataset.path, { resetControls: true });
  $("data-detail-viewer-note").textContent = `Opened ${text(dataset.symbol)} ${text(dataset.bar_size)} from ${text(dataset.source)}.`;
}

function dataComparePayload() {
  const selected = selectedCompareDatasets();
  if (selected.length < 2) {
    throw new Error("Select at least two saved datasets first");
  }
  return {
    datasets: selected.map((dataset) => ({ symbol: dataset.symbol, path: dataset.path })),
    preview_points: $("data-compare-points").value || "400",
    sample_mode: $("data-compare-mode").value || "sampled",
    start: $("data-compare-start").value,
    end: $("data-compare-end").value,
  };
}

async function loadDataCompare(event) {
  if (event) event.preventDefault();
  let payload;
  try {
    payload = dataComparePayload();
  } catch (err) {
    $("data-compare-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    return;
  }
  const response = await fetchJson("/data_compare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.dataCompare = response.comparison || {};
  renderDataCompare();
  if (activeView() === "data") applyDataLens("compare");
  $("last-refresh").textContent = `Data comparison loaded: ${new Date().toLocaleString()}`;
}

function copyDataCompareJson() {
  let payload;
  try {
    payload = dataComparePayload();
  } catch (err) {
    $("data-compare-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    return;
  }
  copyText(JSON.stringify(payload, null, 2)).then(() => {
    $("last-refresh").textContent = `Copied comparison JSON for ${numberText(payload.datasets.length, 0)} datasets`;
  }).catch((err) => {
    $("last-refresh").textContent = `Copy failed: ${err.message}`;
  });
}

async function diagnoseDataSymbol(event) {
  event.preventDefault();
  const symbol = $("data-symbol-input").value.trim();
  if (!symbol) {
    $("data-symbol-diagnostic-status").innerHTML = `<span class="status-bad">Enter a symbol</span>`;
    return;
  }
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const response = await fetchJson(`/data_symbol_diagnostic?symbol=${encodeURIComponent(symbol)}&limit=${catalogLimit}`);
  state.symbolDiagnostic = response;
  renderSymbolDiagnostic();
  if (activeView() === "data") applyDataLens("diagnostics");
  $("last-refresh").textContent = `Symbol diagnostic loaded: ${new Date().toLocaleString()}`;
}

async function loadFetchManifestDetail(jobId) {
  const response = await fetchJson(`/fetch_manifest_detail?job_id=${encodeURIComponent(jobId)}&limit=500`);
  state.fetchManifestDetail = response;
  renderFetchManifestDetail();
  if (activeView() === "fetch") applyFetchLens("detail");
  $("last-refresh").textContent = `Fetch manifest loaded: ${new Date().toLocaleString()}`;
}

async function loadRemoteNodeDetail(nodeId) {
  if (!nodeId) throw new Error("node_id is required");
  const response = await fetchJson(`/remote_node_detail?node_id=${encodeURIComponent(nodeId)}&limit=20`);
  state.remoteNodeDetail = response;
  renderRemoteNodeDetail();
  $("last-refresh").textContent = `Remote node detail loaded: ${new Date().toLocaleString()}`;
}

async function loadConfigArtifacts(draftId, options = {}) {
  const response = await fetchJson(`/config_draft_artifacts?draft_id=${encodeURIComponent(draftId)}&limit=100`);
  state.configArtifacts = response;
  state.performanceSourceMode = "artifact";
  renderWorkbenchArtifacts();
  renderWorkbenchRunReadiness();
  renderWorkbenchTriage();
  renderWorkbenchRunResult();
  renderPerformance();
  renderOverview();
  if (options.openPerformance) navigateToView("performance");
  else if (activeView() === "workbench") applyWorkbenchLens("artifacts");
  $("last-refresh").textContent = options.openPerformance
    ? `Results opened: ${new Date().toLocaleString()}`
    : `Artifacts loaded: ${new Date().toLocaleString()}`;
}

async function loadConfigDraftDetail(draftId) {
  const response = await fetchJson(`/config_draft_detail?draft_id=${encodeURIComponent(draftId)}`);
  const draft = response.draft || {};
  state.configDraft = {
    name: draft.name,
    saved_path: draft.path,
    validation: response.validation || { valid: false, errors: [] },
    yaml: response.yaml || "",
    commands: response.commands || {},
    alignment: response.alignment || {},
  };
  state.alignmentPreview = response.alignment || null;
  renderConfigBuilder();
  $("last-refresh").textContent = `Draft detail loaded: ${new Date().toLocaleString()}`;
}

async function downloadDraftYaml(draftId) {
  if (!draftId) return;
  const body = await fetchText(`/config_draft_yaml?draft_id=${encodeURIComponent(draftId)}`);
  const blob = new Blob([body], { type: "application/x-yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${draftId}.yaml`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Draft YAML downloaded: ${new Date().toLocaleString()}`;
}

async function deleteConfigDraft(draftId) {
  if (!draftId) return;
  if (!window.confirm(`Delete saved draft ${draftId}?`)) {
    return;
  }
  await fetchJson("/config_draft/delete", {
    method: "POST",
    body: JSON.stringify({
      draft_id: draftId,
      confirm: "delete-draft",
    }),
  });
  state.configDrafts = await fetchJson("/config_drafts");
  state.draftValidations = await fetchJson("/config_draft_validations");
  state.workbenchStatus = await fetchJson("/workbench_status");
  state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  const selected = $("config-run-draft").value;
  if (selected === draftId) {
    state.configDraft = null;
    state.alignmentPreview = null;
    state.configArtifacts = null;
    if (state.performanceSourceMode === "artifact") state.performanceSourceMode = "current";
  }
  renderConfigBuilder();
  renderWorkbenchRuns();
  renderWorkbenchStatus();
  renderCleanupPlan();
  renderWorkbenchArtifacts();
  $("last-refresh").textContent = `Draft deleted: ${new Date().toLocaleString()}`;
}

async function validateDrafts() {
  state.draftValidations = await fetchJson("/config_draft_validations");
  renderDraftValidations();
  renderWorkbenchRuns();
  renderWorkbenchGuide();
  $("last-refresh").textContent = `Draft validations refreshed: ${new Date().toLocaleString()}`;
}

async function loadRunArtifacts(runId, options = {}) {
  const response = await fetchJson(`/config_draft_run_artifacts?run_id=${encodeURIComponent(runId)}&limit=100`);
  state.configArtifacts = response;
  state.performanceSourceMode = "artifact";
  renderWorkbenchArtifacts();
  renderWorkbenchRunReadiness();
  renderWorkbenchTriage();
  renderWorkbenchRunResult();
  renderPerformance();
  renderOverview();
  renderWorkbenchGuide();
  if (options.openPerformance) navigateToView("performance");
  else if (activeView() === "workbench") applyWorkbenchLens("artifacts");
  $("last-refresh").textContent = options.openPerformance
    ? `Run results opened: ${new Date().toLocaleString()}`
    : `Run artifacts loaded: ${new Date().toLocaleString()}`;
}

async function approveOrderPreview(approvalId) {
  const artifacts = state.configArtifacts || {};
  if (!artifacts.order_preview_file) throw new Error("No order preview file is loaded");
  const preview = (artifacts.order_previews || []).find((item) => text(item.approval_id) === text(approvalId));
  if (!approvalPreviewCanApprove(preview, artifacts)) {
    throw new Error("Selected preview is not approval-required or is missing approval metadata");
  }
  const label = `${text(preview.side)} ${text(preview.symbol)} ${money(preview.estimated_notional)}`;
  if (!window.confirm(`Approve held order preview ${approvalId}?\n\n${label}\n\nThis writes a local approval file only. Review broker/account state before rerunning or continuing the runner.`)) {
    return;
  }
  const response = await fetchJson("/order_preview_approval", {
    method: "POST",
    body: JSON.stringify({
      preview_file: artifacts.order_preview_file,
      approval_id: approvalId,
      approver: "dashboard-operator",
    }),
  });
  preview.approval_status = "approved_file";
  preview.approval_file = (response.approval || {}).approval_file || preview.approval_file;
  preview.approval_file_exists = true;
  renderWorkbenchArtifacts();
  $("last-refresh").textContent = `Approval file written: ${text((response.approval || {}).approval_file)}`;
}

async function loadCompletedRunOutput(run, draftId, options = {}) {
  const action = text(run && run.action);
  const status = text(run && run.status);
  if (!run || action === "validate" || status !== "completed") {
    return false;
  }
  if (run.run_id && run.artifact_path) {
    await loadRunArtifacts(run.run_id, options);
    return true;
  }
  await loadConfigArtifacts(draftId, options);
  return true;
}

async function loadRunDetail(runId, options = {}) {
  const response = await fetchJson(`/config_draft_run_evidence?run_id=${encodeURIComponent(runId)}`);
  state.runDetail = response;
  state.runEvidence = response;
  renderRunDetail();
  if (options.navigate !== false) {
    navigateToView("workbench");
    applyWorkbenchLens("artifacts");
  }
  $("last-refresh").textContent = `Run log loaded: ${new Date().toLocaleString()}`;
}

async function runConfigDraft(event = null, options = {}) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  const draftId = $("config-run-draft").value;
  if (!draftId) {
    $("config-run-status").innerHTML = `<span class="status-bad">Save a generated draft locally before running.</span>`;
    return;
  }
  $("config-run-status").innerHTML = `<span class="status-warn">running</span>`;
  const response = await fetchJson("/config_draft/run", {
    method: "POST",
    body: JSON.stringify({
      draft_id: draftId,
      action: $("config-run-action").value,
      max_steps: $("config-run-max-steps").value,
      timeout_seconds: $("config-run-timeout").value,
    }),
  });
  const run = response.run || {};
  $("config-run-status").innerHTML = statusText(run.status);
  state.configRuns = await fetchJson("/config_draft_runs?limit=20");
  state.runComparison = await fetchJson("/config_draft_run_comparison?limit=50");
  state.performanceRollups = await fetchJson("/config_draft_daily_rollups?limit=100&run_limit=100");
  state.workbenchStatus = await fetchJson("/workbench_status");
  state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  const loadedArtifacts = await loadCompletedRunOutput(run, draftId, {
    openPerformance: Boolean(options.openPerformance),
  });
  renderWorkbenchRuns();
  renderRunComparison();
  renderPerformanceRollups();
  renderPerformancePeriodRollups();
  renderWorkbenchStatus();
  renderCleanupPlan();
  renderWorkbenchGuide();
  $("last-refresh").textContent = loadedArtifacts
    ? `Config draft run finished and results loaded: ${new Date().toLocaleString()}`
    : `Config draft run finished: ${new Date().toLocaleString()}`;
}

async function openWorkbenchResultPerformance() {
  const model = workbenchResultModel();
  if (!model.selectedDraftId || !model.latestRun || model.latestRun.action === "validate") {
    $("config-run-status").innerHTML = `<span class="status-warn">Run replay or simulated paper before opening performance.</span>`;
    return;
  }
  if (model.latestRun.artifact_path) {
    await loadRunArtifacts(model.latestRun.run_id, { openPerformance: true });
    return;
  }
  await loadConfigArtifacts(model.selectedDraftId, { openPerformance: true });
}

async function openWorkbenchResultLog() {
  const model = workbenchResultModel();
  if (!model.latestRun) {
    $("config-run-status").innerHTML = `<span class="status-warn">Run the selected draft before opening a log.</span>`;
    return;
  }
  await loadRunDetail(model.latestRun.run_id);
}

async function refreshCleanupPlan() {
  state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  state.workbenchStatus = await fetchJson("/workbench_status");
  renderWorkbenchStatus();
  renderCleanupPlan();
  $("last-refresh").textContent = `Cleanup plan refreshed: ${new Date().toLocaleString()}`;
}

async function runWorkbenchCleanup(dryRun) {
  if (!dryRun && !window.confirm("Delete orphaned workbench archive/output directories?")) {
    return;
  }
  const payload = { dry_run: dryRun };
  if (!dryRun) payload.confirm = "prune-workbench";
  const response = await fetchJson("/workbench_cleanup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.cleanupPlan = dryRun ? (response.plan || {}) : await fetchJson("/workbench_cleanup_plan");
  state.workbenchStatus = await fetchJson("/workbench_status");
  renderWorkbenchStatus();
  renderCleanupPlan();
  const action = dryRun ? "Cleanup dry run" : `Cleanup deleted ${numberText(response.delete_count || 0, 0)} directories`;
  $("last-refresh").textContent = `${action}: ${new Date().toLocaleString()}`;
}

async function downloadRunsCsv() {
  const body = await fetchText("/config_draft_runs_export?limit=200");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "workbench_runs.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Run CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDraftsCsv() {
  const body = await fetchText("/config_drafts_export");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "workbench_drafts.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Draft CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadRunArtifactsJson() {
  const runId = state.configArtifacts && state.configArtifacts.run_id;
  if (!runId) {
    $("last-refresh").textContent = "Select archived run artifacts before exporting JSON";
    return;
  }
  const body = await fetchText(`/config_draft_run_artifacts_export?run_id=${encodeURIComponent(runId)}&limit=100`);
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${runId}_artifacts.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Run artifacts JSON exported: ${new Date().toLocaleString()}`;
}

async function downloadRemoteNodesCsv() {
  const body = await fetchText("/remote_nodes_export?limit=500");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "remote_nodes.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Remote nodes CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadRemoteNodeDetailCsv() {
  const detail = state.remoteNodeDetail || {};
  const nodeId = String(detail.node_id || "").trim();
  if (!nodeId) {
    $("last-refresh").textContent = "Select a remote node before exporting detail CSV";
    return;
  }
  const body = await fetchText(`/remote_node_detail_export?node_id=${encodeURIComponent(nodeId)}&limit=100`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeNodeId = nodeId.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "remote_node";
  const link = document.createElement("a");
  link.href = url;
  link.download = `remote_node_detail_${safeNodeId}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Remote node detail CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadStatusRollupsCsv() {
  const body = await fetchText("/status_equity_rollups_export?limit=500&history_limit=50000");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "status_equity_rollups.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Status rollups CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadCommandAuditCsv() {
  const node = $("command-node").value || (state.status && state.status.node_id) || "";
  const nodeParam = node ? `node_id=${encodeURIComponent(node)}&` : "";
  const body = await fetchText(`/command_audit_export?${nodeParam}limit=500`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "command_audit.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Command audit CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataCatalogCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_catalog_export?limit=${catalogLimit}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "saved_data_catalog.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Data catalog CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataSymbolDirectoryCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_symbol_directory_export?limit=${catalogLimit}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_symbol_directory.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Symbol directory CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadFetchManifestsCsv() {
  const body = await fetchText("/fetch_manifests_export?limit=500");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fetch_manifests.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Fetch jobs CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadFetchDetailCsv() {
  const detail = state.fetchManifestDetail || {};
  if (!detail.job_id) {
    $("last-refresh").textContent = "Select a fetch manifest before exporting detail CSV";
    return;
  }
  const jobId = String(detail.job_id);
  const body = await fetchText(`/fetch_manifest_detail_export?job_id=${encodeURIComponent(jobId)}&limit=2000`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${jobId}_fetch_detail.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Fetch detail CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataCatalogScanCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_catalog_scan_export?limit=${catalogLimit}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_catalog_scan.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Catalog scan CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataStorageAuditCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const storageScanLimit = encodeURIComponent($("data-storage-scan-limit").value || "5000");
  const body = await fetchText(`/data_storage_audit_export?catalog_limit=${catalogLimit}&scan_limit=${storageScanLimit}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_storage_audit.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Storage audit CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataCoverageCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_coverage_export?limit=${catalogLimit}&max_symbols=500&max_dates=366`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_coverage.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Coverage CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataGapSummaryCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_gap_summary_export?catalog_limit=${catalogLimit}&top_limit=100`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_gap_summary.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Gap summary CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataMinuteHeatmapCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_minute_heatmap_export?catalog_limit=${catalogLimit}&top_limit=100`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_minute_heatmap.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Minute heatmap CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataDetailRangeCsv() {
  const detail = state.dataDetail || {};
  const path = detail.path || state.dataDetailPath || "";
  if (!path) {
    $("last-refresh").textContent = "Open a saved dataset before exporting the Data Detail range";
    return;
  }
  const params = new URLSearchParams();
  params.set("path", path);
  const start = $("data-detail-start").value || "";
  const end = $("data-detail-end").value || "";
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const body = await fetchText(`/data_detail_export?${params.toString()}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const symbol = text(detail.symbol || "saved_data").replace(/[^A-Za-z0-9_.-]+/g, "_");
  link.href = url;
  link.download = `${symbol}_data_detail_range.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Data Detail range CSV exported: ${new Date().toLocaleString()}`;
}

function downloadDataCompareCsv() {
  const comparison = state.dataCompare || {};
  const series = comparison.series || [];
  if (!series.length) {
    $("last-refresh").textContent = "Run a saved-data comparison before exporting CSV";
    return;
  }
  const rows = [[
    "symbol",
    "timestamp",
    "close",
    "normalized_return_pct",
    "total_return_pct",
    "source",
    "bar_size",
    "path",
  ]];
  for (const item of series) {
    for (const point of (item.points || [])) {
      rows.push([
        item.symbol,
        point.timestamp,
        point.close,
        point.normalized_return_pct,
        item.total_return_pct,
        item.source,
        item.bar_size,
        item.path,
      ]);
    }
  }
  const body = `${rows.map(csvLine).join("\n")}\n`;
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_compare.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Comparison CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadDataMissingIntervalsCsv() {
  const path = (state.dataDetail || {}).path || "";
  if (!path) {
    $("last-refresh").textContent = "Select a saved dataset before exporting missing intervals";
    return;
  }
  const params = new URLSearchParams();
  params.set("path", path);
  const body = await fetchText(`/data_missing_intervals_export?${params.toString()}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(state.dataDetail.symbol || "data").replace(/[^A-Za-z0-9_.-]+/g, "_")}_missing_intervals.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Missing interval CSV exported: ${new Date().toLocaleString()}`;
}

async function downloadWorkbenchSnapshot() {
  const body = await fetchText("/workbench_snapshot_export");
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "workbench_snapshot.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Workbench snapshot exported: ${new Date().toLocaleString()}`;
}

async function copyText(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

async function queueCommand(event) {
  event.preventDefault();
  const action = $("command-action").value;
  const boundary = commandBoundaries[action] || {};
  if (boundary.confirm && !$("command-confirm").checked) {
    $("command-confirm").focus();
    $("last-refresh").textContent = "Review and confirm the command boundary before queueing this action";
    return;
  }
  const params = {};
  for (const field of commandFields[action] || []) {
    const value = $(`command-${field}`).value.trim();
    if (!value) {
      $(`command-${field}`).focus();
      $("last-refresh").textContent = `${commandParamNames[field]} is required`;
      return;
    }
    params[commandParamNames[field]] = value;
  }
  await fetchJson("/commands", {
    method: "POST",
    body: JSON.stringify({
      node_id: $("command-node").value.trim(),
      action,
      params,
    }),
  });
  await refresh();
}

async function cancelCommand(commandId, nodeId) {
  await fetchJson("/commands/cancel", {
    method: "POST",
    body: JSON.stringify({
      command_id: commandId,
      node_id: nodeId,
    }),
  });
  await refresh();
}

function updateCommandFields() {
  const action = $("command-action").value;
  const visible = new Set(commandFields[action] || []);
  for (const field of ["run", "config", "supervisor", "job"]) {
    const label = $(`command-${field}-field`);
    const input = $(`command-${field}`);
    const shown = visible.has(field);
    label.classList.toggle("hidden", !shown);
    input.required = shown;
    input.disabled = !shown;
  }
  const boundary = commandBoundaries[action] || {};
  const confirmField = $("command-confirm-field");
  const confirmInput = $("command-confirm");
  confirmInput.checked = false;
  confirmInput.required = Boolean(boundary.confirm);
  confirmInput.disabled = !boundary.confirm;
  confirmField.classList.toggle("hidden", !boundary.confirm);
  $("command-boundary").innerHTML = `
    <span class="status-${boundary.klass === "read-only" ? "ok" : boundary.klass === "launcher" ? "warn" : "neutral"}">${escapeHtml(boundary.klass || "unknown")}</span>
    <strong>${escapeHtml(boundary.title || action)}</strong>
    <small>${escapeHtml(boundary.note || "No boundary metadata is available for this action.")}</small>
  `;
}

function initToken() {
  $("auth-token").value = token();
  $("save-token").addEventListener("click", () => {
    sessionStorage.setItem("statusToken", $("auth-token").value);
    refresh({ forceData: true, forceDataDiagnostics: shouldLoadDataDiagnostics() }).catch((err) => {
      $("last-refresh").textContent = `Refresh failed: ${err.message}`;
    });
  });
}

function init() {
  const storedView = sessionStorage.getItem("dashboardView") || "overview";
  setActiveView(window.location.hash ? viewFromHash() : storedView);
  for (const button of document.querySelectorAll("[data-view-target]")) {
    button.addEventListener("click", () => navigateToViewTarget(button.dataset.viewTarget, button.dataset.viewLens || ""));
  }
  for (const button of document.querySelectorAll("[data-overview-lens-target]")) {
    button.addEventListener("click", () => navigateToOverviewLens(button.dataset.overviewLensTarget));
  }
  for (const button of document.querySelectorAll("[data-performance-lens-target]")) {
    button.addEventListener("click", () => navigateToPerformanceLens(button.dataset.performanceLensTarget));
  }
  for (const button of document.querySelectorAll("[data-data-lens-target]")) {
    button.addEventListener("click", () => navigateToDataLens(button.dataset.dataLensTarget));
  }
  for (const button of document.querySelectorAll("[data-fetch-lens-target]")) {
    button.addEventListener("click", () => navigateToFetchLens(button.dataset.fetchLensTarget));
  }
  for (const button of document.querySelectorAll("[data-workbench-lens-target]")) {
    button.addEventListener("click", () => navigateToWorkbenchLens(button.dataset.workbenchLensTarget));
  }
  for (const button of document.querySelectorAll("[data-runs-lens-target]")) {
    button.addEventListener("click", () => navigateToRunsLens(button.dataset.runsLensTarget));
  }
  for (const button of document.querySelectorAll("[data-operations-lens-target]")) {
    button.addEventListener("click", () => navigateToOperationsLens(button.dataset.operationsLensTarget));
  }
  for (const button of document.querySelectorAll("[data-help-lens-target]")) {
    button.addEventListener("click", () => navigateToHelpLens(button.dataset.helpLensTarget));
  }
  window.addEventListener("hashchange", () => setActiveView(viewFromHash()));

  initToken();
  updateCommandFields();
  $("command-action").addEventListener("change", updateCommandFields);
  $("refresh").addEventListener("click", () => {
    refresh({ forceData: true, forceDataDiagnostics: shouldLoadDataDiagnostics() }).catch((err) => {
      $("last-refresh").textContent = `Refresh failed: ${err.message}`;
    });
  });
  $("cleanup-refresh").addEventListener("click", () => {
    refreshCleanupPlan().catch((err) => {
      $("last-refresh").textContent = `Cleanup plan failed: ${err.message}`;
    });
  });
  $("cleanup-dry-run").addEventListener("click", () => {
    runWorkbenchCleanup(true).catch((err) => {
      $("last-refresh").textContent = `Cleanup dry run failed: ${err.message}`;
    });
  });
  $("cleanup-apply").addEventListener("click", () => {
    runWorkbenchCleanup(false).catch((err) => {
      $("last-refresh").textContent = `Cleanup failed: ${err.message}`;
    });
  });
  $("data-filter-text").addEventListener("input", renderDataCatalog);
  $("data-filter-quality").addEventListener("change", renderDataCatalog);
  $("data-filter-bar").addEventListener("change", renderDataCatalog);
  $("data-filter-asset").addEventListener("change", renderDataCatalog);
  $("data-filter-source").addEventListener("change", renderDataCatalog);
  $("data-filter-session").addEventListener("change", renderDataCatalog);
  $("data-filter-contract").addEventListener("change", renderDataCatalog);
  $("data-filter-sort").addEventListener("change", renderDataCatalog);
  $("data-home-clear-filters").addEventListener("click", () => {
    clearDataCatalogFilters();
    renderDataCatalog();
    $("last-refresh").textContent = "Data Library filters cleared";
  });
  $("data-facet-clear").addEventListener("click", () => {
    clearDataCatalogFilters();
    renderDataCatalog();
    $("last-refresh").textContent = "Data Library browse filters cleared";
  });
  $("data-home-inspect-top").addEventListener("click", () => {
    const match = filteredDataCatalog(state.dataCatalog.datasets || []).find((dataset) => dataset.path);
    if (!match) {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">No matching dataset to inspect</span>`;
      return;
    }
    loadDataDetail(match.path, { resetControls: true }).catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-home-open-workbench").addEventListener("click", () => navigateToWorkbenchLens("home"));
  $("data-home-open-fetch").addEventListener("click", () => navigateToView("fetch"));
  $("data-home-shortlist").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-home-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataHomeShortlistAction(target).catch((err) => {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-universe-symbols").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-home-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataHomeShortlistAction(target).catch((err) => {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-search-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-home-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataHomeShortlistAction(target).catch((err) => {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-source-map").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-source-map-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataSourceMapAction(target);
  });
  $("data-scope-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-data-scope-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleDataScopeAssistantAction(target.dataset.dataScopeAction || "");
  });
  $("data-storage-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-data-storage-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleDataStorageAssistantAction(button.dataset.dataStorageAction || "");
  });
  for (const button of document.querySelectorAll("[data-workbench-home-action]")) {
    button.addEventListener("click", () => {
      handleWorkbenchHomeAction(button.dataset.workbenchHomeAction || "");
    });
  }
  for (const button of document.querySelectorAll("[data-operations-home-action]")) {
    button.addEventListener("click", () => {
      handleOperationsHomeAction(button.dataset.operationsHomeAction || "");
    });
  }
  $("control-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-control-assistant-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleControlAssistantAction(target.dataset.controlAssistantAction || "");
  });
  $("copy-data-roots-yaml").addEventListener("click", copyDataRootsYaml);
  $("fetch-filter-text").addEventListener("input", renderFetchJobs);
  $("fetch-filter-status").addEventListener("change", renderFetchJobs);
  $("fetch-filter-kind").addEventListener("change", renderFetchJobs);
  $("fetch-filter-sort").addEventListener("change", renderFetchJobs);
  $("fetch-search-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-fetch-search-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleFetchSearchAction(target);
  });
  $("copy-fetch-roots-yaml").addEventListener("click", copyFetchManifestRootsYaml);
  $("export-fetch-manifests-csv").addEventListener("click", () => {
    downloadFetchManifestsCsv().catch((err) => {
      $("last-refresh").textContent = `Fetch jobs CSV export failed: ${err.message}`;
    });
  });
  $("remote-filter-text").addEventListener("input", renderRemoteNodes);
  $("remote-filter-status").addEventListener("change", renderRemoteNodes);
  $("remote-filter-mode").addEventListener("change", renderRemoteNodes);
  $("remote-filter-sort").addEventListener("change", renderRemoteNodes);
  $("remote-nodes-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-remote-nodes-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleRemoteNodesAssistantAction(target.dataset.remoteNodesAction || "");
  });
  $("remote-detail-activity-filter").addEventListener("change", renderRemoteNodeDetail);
  $("remote-detail-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-remote-detail-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleRemoteDetailAssistantAction(button.dataset.remoteDetailAction || "");
  });
  $("runs-filter-text").addEventListener("input", renderRuns);
  $("runs-filter-status").addEventListener("change", renderRuns);
  $("runs-filter-mode").addEventListener("change", renderRuns);
  $("runs-filter-sort").addEventListener("change", renderRuns);
  $("runs-search-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-runs-search-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleRunsSearchAction(target);
  });
  $("run-events-filter-text").addEventListener("input", renderRunEvents);
  $("run-events-filter-type").addEventListener("change", renderRunEvents);
  $("run-events-filter-status").addEventListener("change", renderRunEvents);
  $("run-events-filter-sort").addEventListener("change", renderRunEvents);
  $("runs-events-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-runs-events-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    applyRunsEventsAssistantAction(button.dataset.runsEventsAction || "", button.dataset.runId || "");
  });
  for (const id of ["config-dataset", "config-start-date", "config-end-date"]) {
    if ($(id)) $(id).addEventListener("change", renderConfigLivePanels);
  }
  $("config-data-open-detail").addEventListener("click", () => {
    openFirstConfigDatasetDetail().catch((err) => {
      $("config-data-actions-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-data-compare-selected").addEventListener("click", () => {
    compareConfigDatasets().catch((err) => {
      $("config-data-actions-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-data-open-library").addEventListener("click", () => navigateToView("data"));
  $("workbench-selected-data-list").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest("[data-workbench-selected-data-action]")
      : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleWorkbenchSelectedDataAction(target);
  });
  $("config-run-draft").addEventListener("change", () => {
    renderWorkbenchGuide();
    renderWorkbenchTriage();
    renderWorkbenchRunResult();
    renderWorkbenchRunCommands();
    renderConfigCompatibility();
  });
  onOptional("config-plugin", "change", () => {
    renderConfigLivePanels();
  });
  $("data-detail-timezone").addEventListener("change", renderDataDetail);
  $("data-detail-chart-style").addEventListener("change", renderDataDetail);
  $("data-detail-range-preset").addEventListener("change", () => {
    applyDataDetailRangePreset().catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-start").addEventListener("input", () => {
    $("data-detail-range-preset").value = "custom";
  });
  $("data-detail-end").addEventListener("input", () => {
    $("data-detail-range-preset").value = "custom";
  });
  $("data-detail-symbol-load").addEventListener("click", () => {
    loadDataDetailForSymbol().catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-prev").addEventListener("click", () => {
    openAdjacentDataDetail(-1).catch((err) => {
      $("data-detail-nav-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-next").addEventListener("click", () => {
    openAdjacentDataDetail(1).catch((err) => {
      $("data-detail-nav-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-focus-gap").addEventListener("click", () => {
    focusDataDetailLargestGap().catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-data-detail-assistant-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleDataDetailAssistantAction(button.dataset.dataDetailAssistantAction || "").catch((err) => {
      $("data-detail-assistant-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-symbol").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    loadDataDetailForSymbol().catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-compare-timezone").addEventListener("change", renderDataCompare);
  $("data-compare-filter").addEventListener("input", renderDataCompareControls);
  $("data-compare-asset").addEventListener("change", renderDataCompareControls);
  $("data-compare-source").addEventListener("change", renderDataCompareControls);
  $("data-compare-bar").addEventListener("change", renderDataCompareControls);
  $("data-compare-session").addEventListener("change", renderDataCompareControls);
  $("data-compare-quality").addEventListener("change", renderDataCompareControls);
  $("data-compare-contract").addEventListener("change", renderDataCompareControls);
  $("data-compare-datasets").addEventListener("change", () => updateCompareSelectionFromSelect(true));
  $("data-compare-range-preset").addEventListener("change", () => {
    applyDataCompareRangePreset().catch((err) => {
      $("data-compare-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-compare-start").addEventListener("input", () => {
    $("data-compare-range-preset").value = "custom";
  });
  $("data-compare-end").addEventListener("input", () => {
    $("data-compare-range-preset").value = "custom";
  });
  $("data-compare-select-symbol").addEventListener("click", selectSymbolCompareDatasets);
  $("data-compare-select-shown").addEventListener("click", selectShownCompareDatasets);
  $("data-compare-clear").addEventListener("click", clearCompareSelection);
  $("data-compare-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-data-compare-assistant-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleDataCompareAssistantAction(button.dataset.dataCompareAssistantAction || "").catch((err) => {
      $("data-compare-assistant-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-catalog-limit").addEventListener("change", () => {
    dataLibraryLoadState().catalogLimitTouched = true;
    refreshDataLibrary({ includeDiagnostics: shouldLoadDataDiagnostics(), force: true }).catch((err) => {
      $("last-refresh").textContent = `Catalog refresh failed: ${err.message}`;
    });
  });
  $("data-storage-scan-limit").addEventListener("change", () => {
    refreshDataDiagnostics({ force: true }).catch((err) => {
      $("last-refresh").textContent = `Storage audit refresh failed: ${err.message}`;
    });
  });
  $("data-symbol-browser-input").addEventListener("input", () => {
    state.symbolTypeaheadActiveIndex = 0;
    renderSymbolBrowser();
  });
  $("data-symbol-browser-dataset").addEventListener("change", () => {
    renderSymbolSelectionPanel(selectedSymbolBrowserSymbol());
    renderSymbolProfile(selectedSymbolBrowserSymbol());
  });
  for (const id of ["data-symbol-browser-source", "data-symbol-browser-bar", "data-symbol-browser-session", "data-symbol-browser-quality", "data-symbol-browser-contract"]) {
    $(id).addEventListener("change", () => {
      state.symbolTypeaheadActiveIndex = 0;
      renderSymbolBrowser();
    });
  }
  $("data-symbol-browser-clear-facets").addEventListener("click", () => {
    $("data-symbol-browser-source").value = "";
    $("data-symbol-browser-bar").value = "";
    $("data-symbol-browser-session").value = "";
    $("data-symbol-browser-quality").value = "";
    $("data-symbol-browser-contract").value = "";
    state.symbolTypeaheadActiveIndex = 0;
    renderSymbolBrowser();
    $("last-refresh").textContent = "Symbol Browser facets cleared";
  });
  $("data-symbol-browser-input").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const symbol = moveSymbolTypeaheadSelection(event.key === "ArrowDown" ? 1 : -1);
      if (symbol) $("last-refresh").textContent = `Highlighted ${symbol} in Symbol Browser`;
      return;
    }
    if (event.key === "Escape") {
      state.symbolTypeaheadActiveIndex = 0;
      $("data-symbol-browser-input").blur();
      return;
    }
    if (event.key !== "Enter") return;
    const symbol = selectedSymbolBrowserDatasets().length
      ? selectedSymbolBrowserSymbol()
      : activeSymbolTypeaheadSuggestion() || topSymbolBrowserSuggestion();
    if (!symbol) return;
    event.preventDefault();
    selectSymbolBrowserSymbol(symbol);
    $("last-refresh").textContent = `Selected ${symbol} in Symbol Browser`;
  });
  $("data-symbol-typeahead").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".symbol-typeahead-option") : null;
    if (!(target instanceof HTMLElement)) return;
    const symbol = String(target.dataset.symbol || "");
    selectSymbolBrowserSymbol(symbol);
    $("last-refresh").textContent = `Selected ${symbol} in Symbol Browser`;
  });
  $("data-symbol-quick-picks").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".symbol-quick-pick") : null;
    if (!(target instanceof HTMLElement)) return;
    const symbol = String(target.dataset.symbol || "");
    selectSymbolBrowserSymbol(symbol);
    $("last-refresh").textContent = `Selected ${symbol} in Symbol Browser`;
  });
  $("data-symbol-directory-filter").addEventListener("input", renderSymbolDirectory);
  $("data-symbol-directory-asset").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-source").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-bar").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-session").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-quality").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-contract").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-sort").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-limit").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-clear").addEventListener("click", () => {
    $("data-symbol-directory-filter").value = "";
    $("data-symbol-directory-asset").value = "";
    $("data-symbol-directory-source").value = "";
    $("data-symbol-directory-bar").value = "";
    $("data-symbol-directory-session").value = "";
    $("data-symbol-directory-quality").value = "";
    $("data-symbol-directory-contract").value = "";
    $("data-symbol-directory-sort").value = "files_desc";
    $("data-symbol-directory-limit").value = "60";
    renderSymbolDirectory();
  });
  $("data-symbol-browser-filter").addEventListener("click", () => {
    const symbol = selectedSymbolBrowserSymbol();
    $("data-filter-text").value = symbol;
    renderDataCatalog();
    $("last-refresh").textContent = symbol ? `Catalog filtered to ${symbol}` : "Catalog symbol filter cleared";
  });
  $("data-symbol-browser-inspect").addEventListener("click", () => {
    inspectSelectedSymbol().catch((err) => {
      $("data-symbol-browser-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-browser-compare").addEventListener("click", () => {
    compareSelectedSymbolDatasets().catch((err) => {
      $("data-symbol-browser-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-browser-diagnose").addEventListener("click", () => {
    diagnoseSelectedSymbol().catch((err) => {
      $("data-symbol-browser-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  for (const [id, action] of [
    ["data-symbol-selection-filter", "filter"],
    ["data-symbol-selection-inspect", "inspect"],
    ["data-symbol-selection-workbench", "workbench"],
    ["data-symbol-selection-compare", "compare"],
    ["data-symbol-selection-diagnose", "diagnose"],
  ]) {
    $(id).addEventListener("click", () => {
      handleSymbolSelectionAction(action).catch((err) => {
        $("data-symbol-selection-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
      });
    });
  }
  for (const id of [
    "data-symbol-profile-inspect",
    "data-symbol-profile-workbench",
    "data-symbol-profile-compare",
    "data-symbol-profile-filter",
    "data-symbol-profile-diagnose",
  ]) {
    $(id).addEventListener("click", (event) => {
      handleSymbolProfileAction(event.currentTarget).catch((err) => {
        $("data-symbol-profile-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
      });
    });
  }
  $("config-preview-alignment").addEventListener("click", () => {
    previewConfigAlignment().catch((err) => {
      $("config-alignment-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("export-runs-csv").addEventListener("click", () => {
    downloadRunsCsv().catch((err) => {
      $("last-refresh").textContent = `Run CSV export failed: ${err.message}`;
    });
  });
  $("export-drafts-csv").addEventListener("click", () => {
    downloadDraftsCsv().catch((err) => {
      $("last-refresh").textContent = `Draft CSV export failed: ${err.message}`;
    });
  });
  $("export-run-artifacts-json").addEventListener("click", () => {
    downloadRunArtifactsJson().catch((err) => {
      $("last-refresh").textContent = `Run artifact JSON export failed: ${err.message}`;
    });
  });
  $("export-remote-nodes-csv").addEventListener("click", () => {
    downloadRemoteNodesCsv().catch((err) => {
      $("last-refresh").textContent = `Remote nodes CSV export failed: ${err.message}`;
    });
  });
  $("export-remote-node-detail-csv").addEventListener("click", () => {
    downloadRemoteNodeDetailCsv().catch((err) => {
      $("last-refresh").textContent = `Remote node detail CSV export failed: ${err.message}`;
    });
  });
  $("export-status-rollups-csv").addEventListener("click", () => {
    downloadStatusRollupsCsv().catch((err) => {
      $("last-refresh").textContent = `Status rollups CSV export failed: ${err.message}`;
    });
  });
  $("export-command-audit-csv").addEventListener("click", () => {
    downloadCommandAuditCsv().catch((err) => {
      $("last-refresh").textContent = `Command audit CSV export failed: ${err.message}`;
    });
  });
  $("export-data-catalog-csv").addEventListener("click", () => {
    downloadDataCatalogCsv().catch((err) => {
      $("last-refresh").textContent = `Data catalog CSV export failed: ${err.message}`;
    });
  });
  $("export-data-symbol-directory-csv").addEventListener("click", () => {
    downloadDataSymbolDirectoryCsv().catch((err) => {
      $("last-refresh").textContent = `Symbol directory CSV export failed: ${err.message}`;
    });
  });
  $("export-data-catalog-scan-csv").addEventListener("click", () => {
    downloadDataCatalogScanCsv().catch((err) => {
      $("last-refresh").textContent = `Catalog scan CSV export failed: ${err.message}`;
    });
  });
  $("export-data-storage-audit-csv").addEventListener("click", () => {
    downloadDataStorageAuditCsv().catch((err) => {
      $("last-refresh").textContent = `Storage audit CSV export failed: ${err.message}`;
    });
  });
  $("export-data-coverage-csv").addEventListener("click", () => {
    downloadDataCoverageCsv().catch((err) => {
      $("last-refresh").textContent = `Coverage CSV export failed: ${err.message}`;
    });
  });
  $("export-data-gap-summary-csv").addEventListener("click", () => {
    downloadDataGapSummaryCsv().catch((err) => {
      $("last-refresh").textContent = `Gap summary CSV export failed: ${err.message}`;
    });
  });
  $("export-data-minute-heatmap-csv").addEventListener("click", () => {
    downloadDataMinuteHeatmapCsv().catch((err) => {
      $("last-refresh").textContent = `Minute heatmap CSV export failed: ${err.message}`;
    });
  });
  $("copy-data-compare-json").addEventListener("click", copyDataCompareJson);
  $("use-data-compare-workbench").addEventListener("click", useDataCompareInWorkbench);
  $("export-data-compare-csv").addEventListener("click", downloadDataCompareCsv);
  $("export-workbench-snapshot").addEventListener("click", () => {
    downloadWorkbenchSnapshot().catch((err) => {
      $("last-refresh").textContent = `Workbench snapshot export failed: ${err.message}`;
    });
  });
  $("validate-drafts").addEventListener("click", () => {
    validateDrafts().catch((err) => {
      $("last-refresh").textContent = `Draft validation failed: ${err.message}`;
    });
  });
  $("comparison-filter-status").addEventListener("change", renderRunComparison);
  $("comparison-filter-action").addEventListener("change", renderRunComparison);
  $("comparison-filter-mode").addEventListener("change", renderRunComparison);
  $("comparison-filter-summary").addEventListener("change", renderRunComparison);
  $("comparison-filter-text").addEventListener("input", renderRunComparison);
  $("comparison-sort").addEventListener("change", renderRunComparison);
  $("performance-source-mode").addEventListener("change", () => {
    state.performanceSourceMode = $("performance-source-mode").value || "current";
    renderPerformance();
    renderOverview();
  });
  $("performance-home-open-runs").addEventListener("click", () => navigateToRunsLens("runs"));
  $("performance-home-open-workbench").addEventListener("click", () => navigateToWorkbenchLens("home"));
  $("performance-home-open-data").addEventListener("click", () => navigateToView("data"));
  $("performance-period").addEventListener("change", renderPerformance);
  $("performance-trade-filter-state").addEventListener("change", renderPerformance);
  $("performance-trade-filter-side").addEventListener("change", renderPerformance);
  $("performance-trade-filter-symbol").addEventListener("input", renderPerformance);
  $("performance-trade-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-trade-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceTradeAssistantAction(target.dataset.performanceTradeAction || "");
  });
  $("performance-rollup-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-rollup-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceRollupAssistantAction(target.dataset.performanceRollupAction || "");
  });
  $("performance-benchmark").addEventListener("change", () => {
    state.performanceBenchmarkPath = $("performance-benchmark").value || "";
    if (!state.performanceBenchmarkPath) {
      state.performanceBenchmarkDetail = null;
      renderPerformance();
    }
  });
  $("performance-load-benchmark").addEventListener("click", () => {
    loadPerformanceBenchmark().catch((err) => {
      $("performance-benchmark-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
      $("last-refresh").textContent = `Benchmark load failed: ${err.message}`;
    });
  });
  $("command-form").addEventListener("submit", (event) => {
    queueCommand(event).catch((err) => {
      $("last-refresh").textContent = `Command failed: ${err.message}`;
    });
  });
  $("config-form").addEventListener("submit", (event) => {
    generateConfigDraft(event).catch((err) => {
      handleConfigDraftError(err);
    });
  });
  $("config-preview-draft").addEventListener("click", () => {
    submitConfigDraft({ previewOnly: true }).catch((err) => {
      handleConfigDraftError(err);
    });
  });
  $("config-form").addEventListener("input", renderConfigLivePanels);
  $("config-form").addEventListener("change", (event) => {
    if (event.target instanceof HTMLElement && event.target.id === "config-risk-preset") {
      applyRiskPreset();
    }
    renderConfigLivePanels();
  });
  $("workbench-guide").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".workbench-guide-action") : null;
    if (!(target instanceof HTMLElement)) return;
    activateWorkbenchGuideAction(target);
  });
  $("workbench-stepper").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".workbench-guide-action") : null;
    if (!(target instanceof HTMLElement)) return;
    activateWorkbenchGuideAction(target);
  });
  $("data-symbol-diagnostic-form").addEventListener("submit", (event) => {
    diagnoseDataSymbol(event).catch((err) => {
      $("data-symbol-diagnostic-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-form").addEventListener("submit", (event) => {
    reloadDataDetail(event).catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-compare-form").addEventListener("submit", (event) => {
    loadDataCompare(event).catch((err) => {
      $("data-compare-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-run-form").addEventListener("submit", (event) => {
    runConfigDraft(event).catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-run-form").addEventListener("input", renderWorkbenchRunReadiness);
  $("config-run-form").addEventListener("change", () => {
    renderWorkbenchRunReadiness();
    renderWorkbenchRunCommands();
    renderWorkbenchTriage();
    renderWorkbenchRunResult();
  });
  $("workbench-run-readiness-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".workbench-run-readiness-action") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleWorkbenchRunReadinessAction(target.dataset.runReadinessAction || "");
  });
  $("workbench-builder-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-workbench-builder-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleWorkbenchBuilderAssistantAction(target.dataset.workbenchBuilderAction || "");
  });
  $("workbench-plugin-boundary-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-workbench-plugin-boundary-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleWorkbenchPluginBoundaryAction(target.dataset.workbenchPluginBoundaryAction || "");
  });
  $("workbench-result-open-performance").addEventListener("click", () => {
    openWorkbenchResultPerformance().catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("workbench-result-open-runs").addEventListener("click", () => navigateToRunsLens("runs"));
  $("workbench-result-open-log").addEventListener("click", () => {
    openWorkbenchResultLog().catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("workbench-artifacts-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-workbench-artifacts-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleWorkbenchArtifactsAssistantAction(button.dataset.workbenchArtifactsAction || "").catch((err) => {
      $("workbench-artifacts-assistant-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-commands").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("copy-command")) return;
    copyText(target.dataset.command || "").then(() => {
      $("last-refresh").textContent = `Command copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("workbench-run-commands").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("copy-run-command")) return;
    copyText(target.dataset.command || "").then(() => {
      $("last-refresh").textContent = `Run command copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  onOptional("config-risk-preset", "change", applyRiskPreset);
  for (const id of ["config-drafts-body", "config-runs-body", "comparison-body", "performance-rollups-body"]) {
    $(id).addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains("inspect-draft")) {
        loadConfigArtifacts(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Artifact load failed: ${err.message}`;
        });
      }
      if (target.classList.contains("open-draft-performance")) {
        loadConfigArtifacts(target.dataset.draftId || "", { openPerformance: true }).catch((err) => {
          $("last-refresh").textContent = `Result load failed: ${err.message}`;
        });
      }
      if (target.classList.contains("inspect-draft-detail")) {
        loadConfigDraftDetail(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Draft detail failed: ${err.message}`;
        });
      }
      if (target.classList.contains("download-draft-yaml")) {
        downloadDraftYaml(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Draft download failed: ${err.message}`;
        });
      }
      if (target.classList.contains("delete-draft")) {
        deleteConfigDraft(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Draft delete failed: ${err.message}`;
        });
      }
      if (target.classList.contains("inspect-run-artifacts")) {
        loadRunArtifacts(target.dataset.runId || "").catch((err) => {
          $("last-refresh").textContent = `Run artifact load failed: ${err.message}`;
        });
      }
      if (target.classList.contains("open-run-performance")) {
        loadRunArtifacts(target.dataset.runId || "", { openPerformance: true }).catch((err) => {
          $("last-refresh").textContent = `Run result load failed: ${err.message}`;
        });
      }
      if (target.classList.contains("inspect-run-log")) {
        loadRunDetail(target.dataset.runId || "").catch((err) => {
          $("last-refresh").textContent = `Run log load failed: ${err.message}`;
        });
      }
    });
  }
  $("artifact-order-previews-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains("copy-approval-command")) {
      copyText(target.dataset.command || "").then(() => {
        $("last-refresh").textContent = `Approval command copied: ${new Date().toLocaleString()}`;
      }).catch((err) => {
        $("last-refresh").textContent = `Copy failed: ${err.message}`;
      });
      return;
    }
    if (target.classList.contains("approve-order-preview")) {
      approveOrderPreview(target.dataset.approvalId || "").catch((err) => {
        $("last-refresh").textContent = `Approval failed: ${err.message}`;
      });
    }
  });
  $("remote-nodes-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains("inspect-remote-node")) {
      loadRemoteNodeDetail(target.dataset.nodeId || "").catch((err) => {
        $("last-refresh").textContent = `Remote node detail failed: ${err.message}`;
      });
      return;
    }
    if (target.classList.contains("request-remote-status")) {
      prepareRequestStatusCommand(target.dataset.nodeId || "");
    }
  });
  $("data-catalog-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains("copy-data-path-row")) {
      copyText(target.dataset.path || "").then(() => {
        $("last-refresh").textContent = `Dataset path copied: ${new Date().toLocaleString()}`;
      }).catch((err) => {
        $("last-refresh").textContent = `Copy failed: ${err.message}`;
      });
      return;
    }
    if (target.classList.contains("inspect-data")) {
      loadDataDetail(target.dataset.path || "", { resetControls: true }).catch((err) => {
        $("last-refresh").textContent = `Data detail failed: ${err.message}`;
      });
    }
  });
  $("data-symbol-browser-matches").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".symbol-match-card") : null;
    if (!(target instanceof HTMLElement)) return;
    loadDataDetail(target.dataset.path || "", { resetControls: true }).catch((err) => {
      $("data-symbol-browser-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-profile-files").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".symbol-profile-file-open") : null;
    if (!(target instanceof HTMLElement)) return;
    loadDataDetail(target.dataset.path || "", { resetControls: true }).catch((err) => {
      $("data-symbol-profile-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-directory").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-symbol]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleSymbolDirectoryAction(target).catch((err) => {
      $("data-symbol-directory-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-directory-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-directory-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleSymbolDirectoryAssistantAction(target).catch((err) => {
      $("data-symbol-directory-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("copy-data-path").addEventListener("click", () => {
    copyText((state.dataDetail || {}).path || "").then(() => {
      $("last-refresh").textContent = `Dataset path copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("copy-data-root-flag").addEventListener("click", () => {
    const path = (state.dataDetail || {}).path || "";
    copyText(`--data-root ${shellQuote(dirname(path))}`).then(() => {
      $("last-refresh").textContent = `Data root flag copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("copy-data-replay-command").addEventListener("click", () => {
    copyText(replayStarterCommand(state.dataDetail || {})).then(() => {
      $("last-refresh").textContent = `Replay starter copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("use-data-detail-workbench").addEventListener("click", useDataDetailInWorkbench);
  $("export-data-detail-range").addEventListener("click", () => {
    downloadDataDetailRangeCsv().catch((err) => {
      $("last-refresh").textContent = `Data Detail range export failed: ${err.message}`;
    });
  });
  $("export-data-missing-intervals").addEventListener("click", () => {
    downloadDataMissingIntervalsCsv().catch((err) => {
      $("last-refresh").textContent = `Missing interval export failed: ${err.message}`;
    });
  });
  $("fetch-manifests-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("inspect-fetch")) return;
    loadFetchManifestDetail(target.dataset.jobId || "").catch((err) => {
      $("last-refresh").textContent = `Fetch manifest detail failed: ${err.message}`;
    });
  });
  $("fetch-outputs-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("inspect-data")) return;
    loadDataDetail(target.dataset.path || "", { resetControls: true }).catch((err) => {
      $("last-refresh").textContent = `Fetch output data detail failed: ${err.message}`;
    });
  });
  $("copy-fetch-resume-command").addEventListener("click", () => {
    const command = fetchResumeCommand(state.fetchManifestDetail || {});
    if (!command) {
      $("last-refresh").textContent = "Select a resumable stock or crypto fetch manifest before copying a resume command";
      return;
    }
    copyText(command).then(() => {
      $("last-refresh").textContent = `Fetch resume command copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("fetch-resume-command").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".copy-fetch-resume-inline") : null;
    if (!(target instanceof HTMLElement)) return;
    copyText(target.dataset.command || "").then(() => {
      $("last-refresh").textContent = `Fetch resume command copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("show-fetch-outputs-data").addEventListener("click", applyFetchOutputDataFilter);
  $("compare-fetch-outputs").addEventListener("click", () => {
    compareFetchOutputs().catch((err) => {
      $("last-refresh").textContent = `Fetch output comparison failed: ${err.message}`;
    });
  });
  $("use-fetch-outputs-workbench").addEventListener("click", useFetchOutputsInWorkbench);
  $("copy-fetch-output-paths").addEventListener("click", copyFetchVisibleOutputPaths);
  $("export-fetch-detail-csv").addEventListener("click", () => {
    downloadFetchDetailCsv().catch((err) => {
      $("last-refresh").textContent = `Fetch detail CSV export failed: ${err.message}`;
    });
  });
  $("commands-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("cancel-command")) return;
    cancelCommand(target.dataset.commandId || "", target.dataset.nodeId || "").catch((err) => {
      $("last-refresh").textContent = `Cancel failed: ${err.message}`;
    });
  });
  refresh().catch((err) => {
    $("last-refresh").textContent = `Refresh failed: ${err.message}`;
  });
}

document.addEventListener("DOMContentLoaded", init);
