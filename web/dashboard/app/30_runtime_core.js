import {
  $,
  age,
  dataLibraryLoadState,
  escapeHtml,
  navigateToOperationsLens,
  navigateToRunsLens,
  navigateToWorkbenchLens,
  numberText,
  row,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { latestArtifactPerformance, latestSupervisor, latestTelemetryRun } from "./20_workbench_foundation.js";
import { currentOpenOrderRows, runEventRows } from "./70_runs.js";
import { copyText, refresh, refreshDataLibrary } from "./90_bootstrap.js";

export function latestAccountRow(accountRows) {
  const rows = accountRows || [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const rowItem = rows[index] || {};
    if (rowItem.positions || rowItem.equity !== undefined || rowItem.cash !== undefined) {
      return rowItem;
    }
  }
  return {};
}

export function finiteNumber(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

export function timestampMillis(value) {
  const parsed = Date.parse(value || "");
  return Number.isFinite(parsed) ? parsed : null;
}

export function timestampAgeLabel(value) {
  const millis = timestampMillis(value);
  if (millis === null) return "not published";
  const ageSeconds = Math.max(0, (Date.now() - millis) / 1000);
  return `${text(value)} (${age(ageSeconds)} ago)`;
}

export function shortTimestampAgeLabel(value) {
  const millis = timestampMillis(value);
  if (millis === null) return "not published";
  const ageSeconds = Math.max(0, (Date.now() - millis) / 1000);
  return `${age(ageSeconds)} ago`;
}

export function setMetricValue(id, value, { className = "", meta = "" } = {}) {
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

export function sourceTimestamp(source, accountRow = {}) {
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

export function sourceMetaLabel(source, accountRow = {}) {
  const timestamp = sourceTimestamp(source, accountRow);
  const sourceLabel = text((source && source.label) || "No source");
  return timestamp ? `${sourceLabel} / updated ${shortTimestampAgeLabel(timestamp)}` : sourceLabel;
}

export function openOverviewSourceDetail() {
  const source = latestArtifactPerformance();
  if (source.source_type === "archived_artifact" && source.has_data) {
    navigateToWorkbenchLens("artifacts");
    return;
  }
  if (source.source_type === "live_telemetry" && source.has_data) {
    navigateToRunsLens("state");
    return;
  }
  if (source.source_type === "run_summary" && source.has_data) {
    navigateToRunsLens("runs");
    return;
  }
  navigateToOperationsLens("diagnostics");
}

export function firstPresent(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

export function normalizedRunMetrics(run = {}) {
  run = run || {};
  const metrics = { ...((run && run.metrics) || {}) };
  const copyIfPresent = (target, ...values) => {
    const value = firstPresent(metrics[target], ...values);
    if (value !== null && value !== undefined && value !== "") metrics[target] = value;
  };
  for (const field of [
    "mode",
    "decisions",
    "orders",
    "fills",
    "rejections",
    "final_equity",
    "final_positions",
    "realized_pnl",
    "unrealized_pnl",
    "total_pnl",
    "total_commission",
    "latest_rejection_time",
    "latest_rejection_symbol",
    "latest_rejection_status",
    "latest_rejection_reason",
    "next_check_time",
    "next_expected_decision_time",
    "next_check_reason",
    "next_order_condition",
    "latest_signal_reason",
    "latest_signal_label",
    "latest_signal_value",
  ]) {
    copyIfPresent(field, run[field]);
  }
  copyIfPresent("final_cash", run.final_cash, run.cash);
  copyIfPresent("cash", run.cash, run.final_cash);
  copyIfPresent("last_decision_time", run.latest_decision_time, run.last_decision_time);
  copyIfPresent("account_end_time", run.latest_account_time, run.account_end_time);
  copyIfPresent("latest_account_time", run.latest_account_time, run.account_end_time);
  copyIfPresent("latest_data_time", run.latest_data_time, run.latest_market_data_time, run.latest_bar_time);
  copyIfPresent("latest_bar_time", run.latest_bar_time, run.latest_data_time, run.latest_market_data_time);
  copyIfPresent("position_count", run.position_count);
  copyIfPresent("open_order_count", run.open_order_count);
  copyIfPresent("approval_required_orders", run.approval_required_orders);
  copyIfPresent("approval_hold_count", run.approval_hold_count);
  const health = { ...((metrics.market_data_health && typeof metrics.market_data_health === "object") ? metrics.market_data_health : {}) };
  const healthField = (target, ...values) => {
    const value = firstPresent(health[target], ...values);
    if (value !== null && value !== undefined && value !== "") health[target] = value;
  };
  healthField("status", run.market_data_status, metrics.market_data_status);
  healthField("reason", run.market_data_reason, metrics.market_data_reason);
  healthField("requested_symbol_count", run.market_data_requested_symbol_count);
  healthField("symbols_with_bars_count", run.market_data_symbols_with_bars_count);
  healthField("symbols_without_bars_count", run.market_data_symbols_without_bars_count);
  healthField("symbols_with_live_prices_count", run.market_data_symbols_with_live_prices_count);
  healthField("timeout_like_count", run.market_data_timeout_like_count);
  healthField("skipped_after_timeouts_count", run.market_data_skipped_after_timeouts_count);
  if (Object.keys(health).length) metrics.market_data_health = health;
  copyIfPresent("market_data_status", run.market_data_status, health.status);
  copyIfPresent("market_data_reason", run.market_data_reason, health.reason);
  return metrics;
}

export function metricTimestamp(metrics, keys) {
  for (const key of keys) {
    const value = metrics ? metrics[key] : null;
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

export function runtimeMarketDataModel(metrics = {}, latestRun = null) {
  const timestamp = metricTimestamp(metrics, [
    "latest_bar_time",
    "latest_data_time",
    "latest_market_data_time",
    "last_bar_time",
    "market_data_time",
  ]);
  const health = metrics.market_data_health || {};
  const healthStatus = text(metrics.market_data_status || health.status || "").toLowerCase();
  const reason = text(metrics.market_data_reason || health.reason || "");
  const requested = Number(health.requested_symbol_count || 0);
  const bars = Number(health.symbols_with_bars_count || 0);
  const live = Number(health.symbols_with_live_prices_count || 0);
  const hasStructuredHealth = Boolean(healthStatus && healthStatus !== "n/a");
  const isBad = ["bad", "error"].includes(healthStatus);
  const isWarn = healthStatus === "warn";
  const coverage = requested
    ? `${numberText(bars, 0)}/${numberText(requested, 0)} symbols with bars, ${numberText(live, 0)} live prices`
    : "";
  if (isBad || isWarn) {
    return {
      timestamp,
      status: isBad ? "bad" : "warn",
      title: isBad ? "feed issue" : "degraded",
      value: isBad ? "feed issue" : "degraded",
      detail: `${reason && reason !== "n/a" ? reason : "market_data_health"}${coverage ? `; ${coverage}.` : "."}`,
      reason,
      health,
      hasStructuredHealth,
    };
  }
  if (timestamp) {
    return {
      timestamp,
      status: "ok",
      title: timestampAgeLabel(timestamp),
      value: timestampAgeLabel(timestamp),
      detail: hasStructuredHealth && coverage
        ? `Market data health ${healthStatus}; ${coverage}.`
        : "Last bar/snapshot timestamp published by the runner.",
      reason,
      health,
      hasStructuredHealth,
    };
  }
  return {
    timestamp: null,
    status: latestRun ? "warn" : "bad",
    title: "n/a",
    value: "n/a",
    detail: latestRun
      ? "Runner summary does not publish latest bar or market-data time yet."
      : "No current run is publishing market-data telemetry.",
    reason,
    health,
    hasStructuredHealth,
  };
}

export function remoteNodeMarketDataModel(node = {}) {
  const statusValue = text(node.market_data_status || "").toLowerCase();
  const reason = text(node.market_data_reason || "");
  const requested = Number(node.market_data_requested_symbol_count || 0);
  const bars = Number(node.market_data_symbols_with_bars_count || 0);
  const live = Number(node.market_data_symbols_with_live_prices_count || 0);
  const timeouts = Number(node.market_data_timeout_like_count || 0);
  const skipped = Number(node.market_data_skipped_after_timeouts_count || 0);
  const latestMillis = timestampMillis(node.latest_data_time);
  const stale = latestMillis !== null && ((Date.now() - latestMillis) / 1000) > 900;
  const coverage = requested
    ? `${numberText(bars, 0)}/${numberText(requested, 0)} bars, ${numberText(live, 0)} live`
    : "";
  const timeoutDetail = timeouts || skipped
    ? `${numberText(timeouts, 0)} timeout-like / ${numberText(skipped, 0)} skipped`
    : "";
  if (["bad", "error"].includes(statusValue)) {
    return {
      status: "bad",
      title: "Feed issue",
      detail: [reason || "market data health bad", coverage, timeoutDetail].filter(Boolean).join("; "),
    };
  }
  if (statusValue === "warn") {
    return {
      status: "warn",
      title: "Feed warning",
      detail: [reason || "market data degraded", coverage, timeoutDetail].filter(Boolean).join("; "),
    };
  }
  if (stale) {
    return {
      status: "warn",
      title: "Stale feed",
      detail: `${timestampAgeLabel(node.latest_data_time)}${coverage ? `; ${coverage}` : ""}`,
    };
  }
  if (node.latest_data_time) {
    return {
      status: "ok",
      title: "Current",
      detail: `${timestampAgeLabel(node.latest_data_time)}${coverage ? `; ${coverage}` : ""}`,
    };
  }
  return {
    status: "warn",
    title: "Unknown",
    detail: reason || "No market-data timestamp or health summary published.",
  };
}

export function symbolInventoryModel() {
  const index = state.dataSymbolIndex || {};
  const inventory = index.symbol_inventory || {};
  const symbolCount = Number(inventory.symbol_count ?? index.symbol_count ?? ((index.symbols || []).length) ?? 0);
  const fileCount = Number(inventory.file_count ?? index.file_count ?? ((index.files || []).length) ?? 0);
  const status = text(inventory.status || (index.index_complete === false ? "warn" : symbolCount || fileCount ? "ok" : "bad")).toLowerCase();
  return {
    raw: inventory,
    status: ["ok", "warn", "bad"].includes(status) ? status : "warn",
    reason: text(inventory.reason || (index.index_complete === false ? "partial_index" : "n/a")),
    note: text(inventory.note || ""),
    symbolCount,
    fileCount,
    indexComplete: inventory.index_complete ?? index.index_complete,
    scanCappedRootCount: Number(inventory.scan_capped_root_count ?? index.scan_capped_root_count ?? 0),
    notScannedRootCount: Number(inventory.not_scanned_root_count ?? index.not_scanned_root_count ?? 0),
    candidateCountTotal: Number(inventory.candidate_count_total ?? index.candidate_count_total ?? 0),
    supportedFileSeenCountTotal: Number(inventory.supported_file_seen_count_total ?? index.supported_file_seen_count_total ?? 0),
    overlappingRootCount: Number(inventory.overlapping_root_count ?? 0),
    overlappingNotScannedRootCount: Number(inventory.overlapping_not_scanned_root_count ?? 0),
    filterActive: Boolean(inventory.filter_active ?? index.filter_active),
    topSymbols: inventory.top_symbols || (index.symbols || []).slice(0, 10),
  };
}

export function savedDataMetricModel() {
  const inventory = symbolInventoryModel();
  const index = state.dataSymbolIndex || {};
  const catalog = state.dataCatalog || {};
  const catalogRows = (catalog.datasets || []).length;
  if (index.index_error) {
    return { value: `${numberText(catalogRows, 0)} files`, status: "warn", title: text(index.index_error) };
  }
  if (inventory.symbolCount || inventory.fileCount) {
    const partial = inventory.indexComplete === false ? "partial" : "complete";
    return {
      value: `${numberText(inventory.symbolCount, 0)} symbols`,
      status: inventory.status,
      title: `${numberText(inventory.fileCount, 0)} indexed files; ${partial} root index; ${inventory.reason}.`,
    };
  }
  return {
    value: `${numberText(catalogRows, 0)} files`,
    status: catalogRows ? "warn" : "idle",
    title: catalogRows ? "Parsed catalog is loaded, but broad symbol index is not." : "No saved data is visible.",
  };
}

export function backendPipelineModel() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const runs = payload.runs || [];
  const supervisors = payload.supervisors || [];
  const alerts = payload.alerts || [];
  const activity = runtimeActivityModel();
  const latestRun = latestTelemetryRun();
  const metrics = normalizedRunMetrics(latestRun);
  const marketData = runtimeMarketDataModel(metrics, latestRun);
  const inventory = symbolInventoryModel();
  const fetchManifests = state.fetchManifests || {};
  const fetchRows = fetchManifests.manifests || [];
  const fetchRoots = fetchManifests.roots || [];
  const runtimeSessions = state.runtimeSessions || {};
  const sessionRows = runtimeSessions.sessions || [];
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const refreshErrors = state.refreshErrors || [];
  const statusFresh = Boolean(payload.generated_at);
  const staleRuns = runs.filter((runItem) => (runItem.freshness || {}).stale);
  const missedJobs = supervisors.flatMap((supervisor) => (
    (supervisor.jobs || [])
      .filter((job) => text(job.status).toLowerCase() === "missed" || job.missed_window)
      .map((job) => ({ supervisor, job }))
  ));
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const manifestRootCount = fetchRoots.filter((root) => root.exists && (root.is_dir || root.is_file)).length;
  const remoteFreshCount = remoteNodes.filter((node) => !((node.freshness || {}).stale)).length;
  const cards = [
    {
      id: "receiver",
      label: "Dashboard Receiver",
      title: statusFresh ? "Receiving" : "No Snapshot",
      status: statusFresh ? "ok" : "bad",
      note: statusFresh
        ? `Latest status ${timestampAgeLabel(payload.generated_at)}; history ${(state.history || []).length} rows.`
        : "The UI can load, but no local status snapshot has been received.",
    },
    {
      id: "publisher",
      label: "Publisher / Runs",
      title: runs.length ? `${numberText(runs.length, 0)} run${runs.length === 1 ? "" : "s"}` : "No Runs",
      status: runs.length ? staleRuns.length ? "warn" : "ok" : "bad",
      note: runs.length
        ? `${numberText(staleRuns.length, 0)} stale; latest ${text((latestRun || {}).id || "n/a")}.`
        : "Status is present, but no strategy run rows are publishing.",
    },
    {
      id: "supervisor",
      label: "Supervisor Jobs",
      title: activity.label,
      status: missedJobs.length ? "warn" : activity.status,
      note: missedJobs.length
        ? `${numberText(missedJobs.length, 0)} missed window${missedJobs.length === 1 ? "" : "s"}; next ${text(activity.raw.next_job_id || "job")} ${text(activity.raw.next_start_at || "n/a")}.`
        : activity.detail,
    },
    {
      id: "gateway",
      label: "IBKR Gateway/API",
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      status: gatewayStatus,
      note: gateway.enabled
        ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === null || gateway.latency_ms === undefined ? "" : `${gateway.latency_ms}ms`}`
        : "Gateway checks are disabled; replay can still work, paper/live cannot be proven.",
    },
    {
      id: "market-data",
      label: "Market Data Feed",
      title: marketData.title,
      status: marketData.status,
      note: marketData.detail,
    },
    {
      id: "saved-data",
      label: "Saved History",
      title: inventory.symbolCount || inventory.fileCount
        ? `${numberText(inventory.symbolCount, 0)} symbols`
        : "No Index",
      status: inventory.status,
      note: inventory.symbolCount || inventory.fileCount
        ? `${numberText(inventory.fileCount, 0)} indexed files; ${inventory.indexComplete === false ? "partial scan" : "complete scan"}.`
        : "No saved CSV/parquet files are visible from configured roots.",
    },
    {
      id: "runtime-sessions",
      label: "Runtime Sessions",
      title: sessionRows.length ? `${numberText(sessionRows.length, 0)} session${sessionRows.length === 1 ? "" : "s"}` : "No Sessions",
      status: sessionRows.length ? "ok" : (runtimeSessions.error_count || (runtimeSessions.errors || []).length) ? "bad" : "warn",
      note: sessionRows.length
        ? `${numberText(runtimeSessions.total || sessionRows.length, 0)} total discovered; ${numberText(runtimeSessions.file_count_total || 0, 0)} recent evidence files.`
        : "No runtime session folders are visible from configured data roots.",
    },
    {
      id: "fetch-manifests",
      label: "Fetch Manifests",
      title: fetchRows.length ? `${numberText(fetchRows.length, 0)} job${fetchRows.length === 1 ? "" : "s"}` : "No Jobs",
      status: fetchRows.length ? "ok" : manifestRootCount ? "warn" : "bad",
      note: fetchRows.length
        ? `Latest fetch evidence is visible; roots ${numberText(manifestRootCount, 0)}.`
        : manifestRootCount
          ? "Manifest roots exist, but no fetch job manifests are visible."
          : "No readable fetch-manifest root is configured.",
    },
    {
      id: "remote",
      label: "Remote Publication",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} node${remoteNodes.length === 1 ? "" : "s"}` : "No Nodes",
      status: remoteNodes.length ? remoteFreshCount ? "ok" : "warn" : "warn",
      note: remoteNodes.length
        ? `${numberText(remoteFreshCount, 0)} fresh remote snapshot${remoteFreshCount === 1 ? "" : "s"}; cloud visibility is sanitized status only.`
        : "Remote/cloud monitoring is optional; local dashboard can still operate.",
    },
    {
      id: "api-contracts",
      label: "API Contracts",
      title: refreshErrors.length ? `${numberText(refreshErrors.length, 0)} failure${refreshErrors.length === 1 ? "" : "s"}` : "All Loaded",
      status: refreshErrors.length ? "warn" : "ok",
      note: refreshErrors.length
        ? `${text(refreshErrors[0].label)} failed: ${text(refreshErrors[0].error)}`
        : "Required status plus optional dashboard panels responded during the latest refresh.",
    },
  ];
  const bad = cards.filter((card) => card.status === "bad");
  const warn = cards.filter((card) => card.status === "warn");
  const status = bad.length ? "bad" : warn.length ? "warn" : "ok";
  const note = bad.length
    ? `${numberText(bad.length, 0)} backend pipeline blocker${bad.length === 1 ? "" : "s"}; start with ${bad[0].label}.`
    : warn.length
      ? `${numberText(warn.length, 0)} backend warning${warn.length === 1 ? "" : "s"}; data exists but some feeds/jobs need review.`
      : "Receiver, runs, broker check, saved data, and publication evidence are visible.";
  return { status, note, cards, alerts };
}

export function renderBackendPipeline() {
  if (!$("backend-pipeline-note") || !$("backend-pipeline-grid")) return;
  const model = backendPipelineModel();
  $("backend-pipeline-note").textContent = model.note;
  $("backend-pipeline-note").className = `section-note ${statusClass(model.status)}`;
  $("backend-pipeline-grid").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function dashboardApiHealthModel() {
  const contracts = state.refreshContracts || [];
  const dataContracts = state.dataEndpointContracts || [];
  const errors = state.refreshErrors || [];
  const statusLoaded = Boolean(state.status && state.status.generated_at);
  const loaded = contracts.filter((item) => item.status === "ok").length;
  const dataLoaded = dataContracts.filter((item) => item.status === "ok").length;
  const dataFailed = dataContracts.filter((item) => item.status !== "ok").length;
  const failed = errors.length + dataFailed;
  const total = contracts.length + dataContracts.length;
  const status = !statusLoaded ? "bad" : failed ? "warn" : "ok";
  const title = !statusLoaded ? "Status Missing" : failed ? `${numberText(failed, 0)} Optional Issue${failed === 1 ? "" : "s"}` : "API Loaded";
  const note = !statusLoaded
    ? "The required /status endpoint did not produce a usable snapshot for this dashboard refresh."
    : failed
      ? `${numberText(loaded + dataLoaded, 0)} / ${numberText(total, 0)} optional endpoint groups loaded; first issue: ${text((errors[0] && errors[0].label) || (dataContracts.find((item) => item.status !== "ok") || {}).label)}.`
      : total ? `${numberText(total, 0)} optional endpoint groups loaded during the latest refresh.` : "Status loaded; optional endpoint groups have not been sampled yet.";
  const cards = [
    {
      status: statusLoaded ? "ok" : "bad",
      label: "Required Status",
      title: statusLoaded ? "Loaded" : "Missing",
      note: statusLoaded ? `Generated ${timestampAgeLabel(state.status.generated_at)}.` : "Refresh could not load current telemetry.",
    },
    {
      status,
      label: "Optional APIs",
      title: total ? `${numberText(loaded + dataLoaded, 0)} / ${numberText(total, 0)}` : "n/a",
      note: failed ? `${numberText(failed, 0)} optional issue${failed === 1 ? "" : "s"} preserved as degraded panels.` : "Optional panels loaded without blocking the page.",
    },
    {
      status: (state.dataLibrary || {}).catalogError ? "warn" : "ok",
      label: "Data Library Async",
      title: (state.dataLibrary || {}).catalogError ? "Review" : (state.dataLibrary || {}).catalogLoaded ? "Loaded" : "Deferred",
      note: (state.dataLibrary || {}).catalogError || ((state.dataLibrary || {}).catalogLoaded ? "Saved-data catalog loaded after the main refresh." : "Saved-data catalog loads separately because large roots can take time."),
    },
    {
      status: dataFailed ? "warn" : dataContracts.length ? "ok" : "warn",
      label: "Data Endpoints",
      title: dataContracts.length ? `${numberText(dataLoaded, 0)} / ${numberText(dataContracts.length, 0)}` : "Pending",
      note: dataContracts.length
        ? dataFailed ? "At least one Data Library backend endpoint used a fallback or returned warnings." : "Catalog, symbol, matrix, and root-index endpoint checks are visible below."
        : "Data Library endpoint checks appear after the async saved-data refresh finishes or fails.",
    },
  ];
  const rows = [
    {
      label: "required status",
      status: statusLoaded ? "ok" : "bad",
      detail: statusLoaded ? `latest /status generated ${text(state.status.generated_at)}` : "required /status payload missing",
    },
    ...contracts,
    ...dataContracts,
  ];
  return { status, title, note, cards, rows };
}

export function renderDashboardApiHealth() {
  if (!$("dashboard-api-health-note") || !$("dashboard-api-health-cards") || !$("dashboard-api-health-body")) return;
  const model = dashboardApiHealthModel();
  const loadState = dataLibraryLoadState();
  $("dashboard-api-health-note").textContent = `${model.title}: ${model.note}`;
  $("dashboard-api-health-note").className = `section-note ${statusClass(model.status)}`;
  if ($("check-dashboard-data-apis")) $("check-dashboard-data-apis").disabled = Boolean(loadState.catalogLoading || loadState.diagnosticsLoading);
  if ($("copy-dashboard-api-health-report")) $("copy-dashboard-api-health-report").disabled = !model.rows.length;
  if ($("export-dashboard-api-health-csv")) $("export-dashboard-api-health-csv").disabled = !model.rows.length;
  $("dashboard-api-health-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("dashboard-api-health-body").innerHTML = model.rows.length
    ? model.rows.map((item) => row([
      escapeHtml(item.label),
      statusText(item.status),
      escapeHtml(item.detail),
    ])).join("")
    : row([`<span class="muted">No dashboard API refresh evidence has been recorded yet.</span>`, "", ""]);
  renderDataBackendStatus();
  renderFetchBackendStatus();
  renderWorkbenchBackendStatus();
}

export function fetchBackendStatusModel() {
  const contracts = state.refreshContracts || [];
  const fetchLabels = new Set(["fetch manifests", "runtime sessions"]);
  const rows = contracts.filter((item) => fetchLabels.has(item.label));
  const issues = rows.filter((item) => item.status !== "ok");
  const statusLoaded = Boolean(state.status && state.status.generated_at);
  const fetchManifests = state.fetchManifests || {};
  const runtimeSessions = state.runtimeSessions || {};
  const manifests = fetchManifests.manifests || [];
  const sessions = runtimeSessions.sessions || [];
  const manifestErrors = Number(fetchManifests.error_count || 0) + Number((fetchManifests.errors || []).length);
  const sessionErrors = Number(runtimeSessions.error_count || 0) + Number((runtimeSessions.errors || []).length);
  const status = !statusLoaded ? "bad" : issues.length ? "warn" : rows.length ? "ok" : "idle";
  const title = !statusLoaded
    ? "Status Missing"
    : rows.length
      ? `${numberText(rows.length - issues.length, 0)} / ${numberText(rows.length, 0)} OK`
      : "No Checks";
  const note = !statusLoaded
    ? "The required /status endpoint did not load, so Fetch Jobs backend state is not trustworthy yet."
    : issues.length
      ? `First issue: ${text(issues[0].label)}. Refresh Fetch APIs or open API Health before changing roots or rerunning fetches.`
      : rows.length
        ? "Fetch manifests and runtime-session endpoint checks are visible."
        : "Refresh Fetch APIs to probe manifest and runtime-session endpoints from this page.";
  const cards = [
    {
      status,
      label: "Fetch APIs",
      title,
      note,
    },
    {
      status: rows.find((item) => item.label === "fetch manifests")?.status || "idle",
      label: "Fetch Manifests",
      title: manifests.length ? `${numberText(manifests.length, 0)} job${manifests.length === 1 ? "" : "s"}` : "No Jobs",
      note: manifestErrors
        ? `${numberText(manifestErrors, 0)} manifest scan issue${manifestErrors === 1 ? "" : "s"} reported.`
        : manifests.length ? "Manifest rows loaded from configured roots." : "Endpoint loaded, but no manifest rows are visible yet.",
    },
    {
      status: rows.find((item) => item.label === "runtime sessions")?.status || "idle",
      label: "Runtime Sessions",
      title: sessions.length ? `${numberText(sessions.length, 0)} session${sessions.length === 1 ? "" : "s"}` : "No Sessions",
      note: sessionErrors
        ? `${numberText(sessionErrors, 0)} runtime-session scan issue${sessionErrors === 1 ? "" : "s"} reported.`
        : sessions.length ? "Runtime session rows loaded from configured data roots." : "Endpoint loaded, but no runtime session rows are visible yet.",
    },
  ];
  const tableRows = [
    {
      label: "required status",
      status: statusLoaded ? "ok" : "bad",
      detail: statusLoaded ? `latest /status generated ${text(state.status.generated_at)}` : "required /status payload missing",
    },
    ...rows,
  ];
  return { status, title, note, rows: tableRows, cards, unprobed: statusLoaded && !rows.length, issues };
}

export function renderFetchBackendStatus() {
  if (!$("fetch-backend-status-note") || !$("fetch-backend-status-cards") || !$("fetch-backend-status-body") || !$("fetch-backend-status-actions")) return;
  const model = fetchBackendStatusModel();
  $("fetch-backend-status-note").textContent = model.note;
  $("fetch-backend-status-note").className = `section-note ${statusClass(model.status)}`;
  $("fetch-backend-status-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("fetch-backend-status-actions").innerHTML = [
    `<button type="button" data-fetch-backend-status-action="check">Refresh Fetch APIs</button>`,
    `<button type="button" class="secondary" data-fetch-backend-status-action="operations">Open API Health</button>`,
    `<button type="button" class="secondary" data-fetch-backend-status-action="copy"${model.rows.length ? "" : " disabled"}>Copy Report</button>`,
    `<button type="button" class="secondary" data-fetch-backend-status-action="export"${model.rows.length ? "" : " disabled"}>Export CSV</button>`,
  ].join("");
  $("fetch-backend-status-body").innerHTML = model.rows.length
    ? model.rows.map((item) => row([
      escapeHtml(item.label),
      statusText(item.status),
      escapeHtml(item.detail),
    ])).join("")
    : row([`<span class="muted">No Fetch Jobs backend endpoint checks have been recorded yet.</span>`, "", ""]);
}

export async function checkFetchBackendApis() {
  $("last-refresh").textContent = "Refreshing Fetch Jobs backend APIs...";
  try {
    await refresh();
    $("last-refresh").textContent = `Fetch backend API checks completed: ${new Date().toLocaleString()}`;
  } catch (err) {
    $("last-refresh").textContent = `Fetch backend API checks failed: ${err.message}`;
  } finally {
    renderFetchBackendStatus();
    renderDashboardApiHealth();
  }
}

export function handleFetchBackendStatusAction(action) {
  if (action === "check") {
    checkFetchBackendApis();
    return;
  }
  if (action === "operations") {
    navigateToOperationsLens("diagnostics");
    return;
  }
  if (action === "copy") {
    copyDashboardApiHealthReport();
    return;
  }
  if (action === "export") {
    downloadDashboardApiHealthCsv();
  }
}

export function workbenchBackendStatusModel() {
  const contracts = state.refreshContracts || [];
  const workbenchLabels = new Set([
    "workbench diagnostics",
    "workbench status",
    "cleanup plan",
    "endpoint map",
    "config options",
    "config drafts",
    "draft validations",
    "draft runs",
    "run comparison",
    "performance rollups",
  ]);
  const rows = contracts.filter((item) => workbenchLabels.has(item.label));
  const issues = rows.filter((item) => item.status !== "ok");
  const statusLoaded = Boolean(state.status && state.status.generated_at);
  const options = state.configOptions || {};
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const runs = (state.configRuns && state.configRuns.runs) || [];
  const comparisonRuns = (state.runComparison && state.runComparison.runs) || [];
  const rollups = (state.performanceRollups && state.performanceRollups.rollups) || [];
  const status = !statusLoaded ? "bad" : issues.length ? "warn" : rows.length ? "ok" : "idle";
  const title = !statusLoaded
    ? "Status Missing"
    : rows.length
      ? `${numberText(rows.length - issues.length, 0)} / ${numberText(rows.length, 0)} OK`
      : "No Checks";
  const note = !statusLoaded
    ? "The required /status endpoint did not load, so Workbench backend state is not trustworthy yet."
    : issues.length
      ? `First issue: ${text(issues[0].label)}. Refresh Workbench APIs or open API Health before changing config inputs.`
      : rows.length
        ? "Workbench schema, draft, run, comparison, rollup, and maintenance endpoint checks are visible."
        : "Refresh Workbench APIs to probe schema, draft, run, and artifact-support endpoints from this page.";
  const cards = [
    {
      status,
      label: "Workbench APIs",
      title,
      note,
    },
    {
      status: rows.find((item) => item.label === "config options")?.status || "bad",
      label: "Schema Options",
      title: `${numberText((options.plugins || []).length, 0)} plugins`,
      note: `${numberText((options.modes || []).length, 0)} modes loaded from public/private-safe registry metadata.`,
    },
    {
      status: rows.find((item) => item.label === "config drafts")?.status || "idle",
      label: "Drafts",
      title: drafts.length ? `${numberText(drafts.length, 0)} draft${drafts.length === 1 ? "" : "s"}` : "No Drafts",
      note: drafts.length ? "Saved draft metadata loaded." : "Endpoint loaded, but no saved drafts are visible yet.",
    },
    {
      status: rows.find((item) => item.label === "draft runs")?.status || "idle",
      label: "Runs",
      title: runs.length ? `${numberText(runs.length, 0)} run${runs.length === 1 ? "" : "s"}` : "No Runs",
      note: runs.length ? "Saved run metadata loaded for Workbench Run and Artifacts." : "Endpoint loaded, but no saved Workbench runs are visible yet.",
    },
    {
      status: rows.find((item) => item.label === "run comparison")?.status || "bad",
      label: "Comparison",
      title: comparisonRuns.length ? `${numberText(comparisonRuns.length, 0)} row${comparisonRuns.length === 1 ? "" : "s"}` : "No Rows",
      note: rollups.length ? `${numberText(rollups.length, 0)} performance rollup rows also loaded.` : "Run comparison is available when saved runs exist.",
    },
  ];
  const tableRows = [
    {
      label: "required status",
      status: statusLoaded ? "ok" : "bad",
      detail: statusLoaded ? `latest /status generated ${text(state.status.generated_at)}` : "required /status payload missing",
    },
    ...rows,
  ];
  return { status, title, note, rows: tableRows, cards, unprobed: statusLoaded && !rows.length, issues };
}

export function renderWorkbenchBackendStatus() {
  if (!$("workbench-backend-status-note") || !$("workbench-backend-status-cards") || !$("workbench-backend-status-body") || !$("workbench-backend-status-actions")) return;
  const model = workbenchBackendStatusModel();
  $("workbench-backend-status-note").textContent = model.note;
  $("workbench-backend-status-note").className = `section-note ${statusClass(model.status)}`;
  $("workbench-backend-status-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-backend-status-actions").innerHTML = [
    `<button type="button" data-workbench-backend-status-action="check">Refresh Workbench APIs</button>`,
    `<button type="button" class="secondary" data-workbench-backend-status-action="operations">Open API Health</button>`,
    `<button type="button" class="secondary" data-workbench-backend-status-action="copy"${model.rows.length ? "" : " disabled"}>Copy Report</button>`,
    `<button type="button" class="secondary" data-workbench-backend-status-action="export"${model.rows.length ? "" : " disabled"}>Export CSV</button>`,
  ].join("");
  $("workbench-backend-status-body").innerHTML = model.rows.length
    ? model.rows.map((item) => row([
      escapeHtml(item.label),
      statusText(item.status),
      escapeHtml(item.detail),
    ])).join("")
    : row([`<span class="muted">No Workbench backend endpoint checks have been recorded yet.</span>`, "", ""]);
}

export async function checkWorkbenchBackendApis() {
  $("last-refresh").textContent = "Refreshing Workbench backend APIs...";
  try {
    await refresh();
    $("last-refresh").textContent = `Workbench backend API checks completed: ${new Date().toLocaleString()}`;
  } catch (err) {
    $("last-refresh").textContent = `Workbench backend API checks failed: ${err.message}`;
  } finally {
    renderWorkbenchBackendStatus();
    renderDashboardApiHealth();
  }
}

export function handleWorkbenchBackendStatusAction(action) {
  if (action === "check") {
    checkWorkbenchBackendApis();
    return;
  }
  if (action === "operations") {
    navigateToOperationsLens("diagnostics");
    return;
  }
  if (action === "copy") {
    copyDashboardApiHealthReport();
    return;
  }
  if (action === "export") {
    downloadDashboardApiHealthCsv();
  }
}

export function dataBackendStatusModel() {
  const rows = (state.dataEndpointContracts || []);
  const ok = rows.filter((item) => item.status === "ok").length;
  const issues = rows.filter((item) => item.status !== "ok");
  const loadState = dataLibraryLoadState();
  const loading = Boolean(loadState.catalogLoading || loadState.diagnosticsLoading);
  const status = loading ? "warn" : issues.length ? "warn" : rows.length ? "ok" : "bad";
  const title = loading
    ? "Checking"
    : rows.length
      ? `${numberText(ok, 0)} / ${numberText(rows.length, 0)} OK`
      : "No Checks";
  const note = loading
    ? "Data Library backend checks are running."
    : issues.length
      ? `First issue: ${text(issues[0].label)}. Use Check Data APIs for a fresh probe or export the report.`
      : rows.length
        ? "Catalog, root-index, and diagnostics backend checks are visible."
        : "Run Check Data APIs to probe saved-data backend endpoints from this page.";
  const cards = [
    {
      status,
      label: "Data APIs",
      title,
      note,
    },
    {
      status: (state.dataLibrary || {}).catalogError ? "warn" : (state.dataLibrary || {}).catalogLoaded ? "ok" : loading ? "warn" : "idle",
      label: "Catalog Refresh",
      title: (state.dataLibrary || {}).catalogError ? "Review" : (state.dataLibrary || {}).catalogLoaded ? "Loaded" : loading ? "Loading" : "Not Loaded",
      note: (state.dataLibrary || {}).catalogError || ((state.dataLibrary || {}).catalogLoaded ? "Async Data Library refresh completed." : "No completed saved-data refresh is recorded yet."),
    },
    {
      status: loadState.diagnosticsError ? "warn" : loadState.diagnosticsLoaded ? "ok" : loadState.diagnosticsLoading ? "warn" : "waiting",
      label: "Diagnostics",
      title: loadState.diagnosticsError ? "Review" : loadState.diagnosticsLoaded ? "Loaded" : loadState.diagnosticsLoading ? "Loading" : "Deferred",
      note: loadState.diagnosticsError || (loadState.diagnosticsLoaded ? "Coverage, gap, minute, and storage-audit checks completed." : "Diagnostics are lazy until requested."),
    },
  ];
  return { status, title, note, rows, cards };
}

export function renderDataBackendStatus() {
  if (!$("data-backend-status-note") || !$("data-backend-status-cards") || !$("data-backend-status-body") || !$("data-backend-status-actions")) return;
  const model = dataBackendStatusModel();
  $("data-backend-status-note").textContent = model.note;
  $("data-backend-status-note").className = `section-note ${statusClass(model.status)}`;
  $("data-backend-status-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-backend-status-actions").innerHTML = [
    `<button type="button" data-data-backend-status-action="check">Check Data APIs</button>`,
    `<button type="button" class="secondary" data-data-backend-status-action="operations">Open API Health</button>`,
    `<button type="button" class="secondary" data-data-backend-status-action="copy"${model.rows.length ? "" : " disabled"}>Copy Report</button>`,
    `<button type="button" class="secondary" data-data-backend-status-action="export"${model.rows.length ? "" : " disabled"}>Export CSV</button>`,
  ].join("");
  $("data-backend-status-body").innerHTML = model.rows.length
    ? model.rows.map((item) => row([
      escapeHtml(item.label),
      statusText(item.status),
      escapeHtml(item.detail),
    ])).join("")
    : row([`<span class="muted">No Data Library backend endpoint checks have been recorded yet.</span>`, "", ""]);
}

export function handleDataBackendStatusAction(action) {
  if (action === "check") {
    checkDashboardDataApis().catch((err) => {
      $("last-refresh").textContent = `Data API checks failed: ${err.message}`;
    });
    return;
  }
  if (action === "operations") {
    navigateToOperationsLens("diagnostics");
    return;
  }
  if (action === "copy") {
    copyDashboardApiHealthReport();
    return;
  }
  if (action === "export") {
    downloadDashboardApiHealthCsv();
  }
}

export function dashboardApiHealthReportText() {
  const model = dashboardApiHealthModel();
  const lines = [
    "Dashboard API Health",
    `Status: ${model.title}`,
    `Summary: ${model.note}`,
    `Generated: ${new Date().toISOString()}`,
    "",
    "Endpoint rows:",
  ];
  for (const item of model.rows || []) {
    lines.push(`- ${text(item.label)} [${text(item.status)}]: ${text(item.detail)}`);
  }
  return lines.join("\n");
}

export function copyDashboardApiHealthReport() {
  copyText(dashboardApiHealthReportText()).then(() => {
    $("last-refresh").textContent = "Dashboard API health report copied";
  }).catch((err) => {
    $("last-refresh").textContent = `Copy Dashboard API health report failed: ${err.message}`;
  });
}

export function downloadDashboardApiHealthCsv() {
  const model = dashboardApiHealthModel();
  const lines = [
    csvLine(["label", "status", "detail"]),
    ...model.rows.map((item) => csvLine([item.label, item.status, item.detail])),
  ];
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "dashboard_api_health.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Dashboard API health CSV exported: ${new Date().toLocaleString()}`;
}

export async function checkDashboardDataApis() {
  $("last-refresh").textContent = "Checking Data Library backend APIs...";
  if ($("check-dashboard-data-apis")) $("check-dashboard-data-apis").disabled = true;
  try {
    await refreshDataLibrary({ includeDiagnostics: true, force: true });
    $("last-refresh").textContent = `Data API checks completed: ${new Date().toLocaleString()}`;
  } catch (err) {
    $("last-refresh").textContent = `Data API checks failed: ${err.message}`;
  } finally {
    renderDashboardApiHealth();
  }
}

export function runtimeActivityModel() {
  const activity = (state.status && state.status.runtime_activity) || {};
  const status = String(activity.status || "").toLowerCase();
  const mappedStatus = status === "running" || status === "publishing" || status === "due"
    ? "ok"
    : status === "warn" || status === "stale" || status === "idle"
      ? "warn"
      : "bad";
  const active = Number(activity.active_child_count || 0);
  const running = Number(activity.running_job_count || 0);
  const due = Number(activity.due_job_count || 0);
  const missed = Number(activity.missed_job_count || 0);
  const freshRuns = Number(activity.fresh_run_count || 0);
  const next = activity.next_start_at ? ` Next: ${text(activity.next_job_id || "job")} at ${text(activity.next_start_at)}.` : "";
  const pieces = [
    active ? `${numberText(active, 0)} active child${active === 1 ? "" : "ren"}` : "",
    running ? `${numberText(running, 0)} running job${running === 1 ? "" : "s"}` : "",
    due ? `${numberText(due, 0)} due job${due === 1 ? "" : "s"}` : "",
    missed ? `${numberText(missed, 0)} missed window${missed === 1 ? "" : "s"}` : "",
    freshRuns ? `${numberText(freshRuns, 0)} fresh run${freshRuns === 1 ? "" : "s"}` : "",
  ].filter(Boolean);
  return {
    raw: activity,
    status: mappedStatus,
    label: text(activity.label || status || "unknown"),
    reason: text(activity.reason || "no_activity_evidence"),
    detail: `${pieces.length ? pieces.join("; ") : "No active child/job evidence is published."}${next}`,
  };
}

export function metricLatestRejection(metrics) {
  if (!metrics || !metrics.latest_rejection_time) return null;
  return {
    type: "order",
    timestamp: metrics.latest_rejection_time,
    symbol: metrics.latest_rejection_symbol || "",
    status: metrics.latest_rejection_status || "rejected",
    detail: metrics.latest_rejection_reason || "",
  };
}

export function eventStatusIsBad(event) {
  const status = String((event && event.status) || "").toLowerCase();
  return status.includes("reject") || status.includes("cancel") || status.includes("fail") || status.includes("error");
}

export function runtimeStatusItems() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const supervisor = latestSupervisor();
  const metrics = normalizedRunMetrics(latestRun);
  const freshness = (latestRun && latestRun.freshness) || {};
  const supervisorFreshness = (supervisor && supervisor.freshness) || {};
  const activity = runtimeActivityModel();
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestOrder = events.find((event) => event.type === "order");
  const latestRejection = events.find((event) => event.type === "order" && eventStatusIsBad(event)) || metricLatestRejection(metrics);
  const openOrders = currentOpenOrderRows();
  const heartbeatTimestamp = firstPresent(
    freshness.timestamp,
    metricTimestamp(metrics, ["last_decision_time", "account_end_time"]),
    supervisor && supervisor.generated_at,
    payload.generated_at,
  );
  const marketData = runtimeMarketDataModel(metrics, latestRun);
  const marketTimestamp = marketData.timestamp;
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
      label: "Runtime Activity",
      value: activity.label,
      status: activity.status,
      detail: activity.detail,
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
      value: marketData.value,
      status: marketData.status,
      detail: marketData.detail,
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
      status: decisionTimestamp ? "ok" : latestRun ? "warn" : "idle",
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

export function paperMonitorItems() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const supervisor = latestSupervisor();
  const metrics = normalizedRunMetrics(latestRun);
  const freshness = (latestRun && latestRun.freshness) || {};
  const supervisorFreshness = (supervisor && supervisor.freshness) || {};
  const activity = runtimeActivityModel();
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
  const marketData = runtimeMarketDataModel(metrics, latestRun);
  const marketTimestamp = marketData.timestamp;
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
      label: "Runtime Activity",
      status: activity.status,
      detail: `${activity.label}: ${activity.detail}`,
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
      status: marketData.status === "bad" ? "bad" : observing ? (stale ? "warn" : "ok") : "idle",
      detail: marketData.status === "bad"
        ? marketData.detail
        : observing
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
