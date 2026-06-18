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

function openOverviewSourceDetail() {
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

function firstPresent(...values) {
  for (const value of values) {
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function normalizedRunMetrics(run = {}) {
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

function metricTimestamp(metrics, keys) {
  for (const key of keys) {
    const value = metrics ? metrics[key] : null;
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function runtimeMarketDataModel(metrics = {}, latestRun = null) {
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

function remoteNodeMarketDataModel(node = {}) {
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

function symbolInventoryModel() {
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

function savedDataMetricModel() {
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

function backendPipelineModel() {
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

function renderBackendPipeline() {
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

function dashboardApiHealthModel() {
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

function renderDashboardApiHealth() {
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

function fetchBackendStatusModel() {
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

function renderFetchBackendStatus() {
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

async function checkFetchBackendApis() {
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

function handleFetchBackendStatusAction(action) {
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

function workbenchBackendStatusModel() {
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

function renderWorkbenchBackendStatus() {
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

async function checkWorkbenchBackendApis() {
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

function handleWorkbenchBackendStatusAction(action) {
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

function dataBackendStatusModel() {
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

function renderDataBackendStatus() {
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

function handleDataBackendStatusAction(action) {
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

function dashboardApiHealthReportText() {
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

function copyDashboardApiHealthReport() {
  copyText(dashboardApiHealthReportText()).then(() => {
    $("last-refresh").textContent = "Dashboard API health report copied";
  }).catch((err) => {
    $("last-refresh").textContent = `Copy Dashboard API health report failed: ${err.message}`;
  });
}

function downloadDashboardApiHealthCsv() {
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

async function checkDashboardDataApis() {
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

function runtimeActivityModel() {
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

function metricLatestRejection(metrics) {
  if (!metrics || !metrics.latest_rejection_time) return null;
  return {
    type: "order",
    timestamp: metrics.latest_rejection_time,
    symbol: metrics.latest_rejection_symbol || "",
    status: metrics.latest_rejection_status || "rejected",
    detail: metrics.latest_rejection_reason || "",
  };
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

function paperMonitorItems() {
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

function performancePeriodWindow(accountRows, period) {
  if (typeof period === "string" && period.startsWith("day:")) {
    const day = period.slice(4);
    const start = timestampMillis(`${day}T00:00:00Z`);
    if (start !== null) {
      return { start, end: start + 24 * 60 * 60 * 1000 - 1, label: `day ${day}` };
    }
  }
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
      status: ledger.stats.open_count ? "warn" : ledger.rows.length ? "ok" : "idle",
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
      status: rows.length ? "ok" : ledger.rows.length ? "warn" : "idle",
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
      status: ledger.stats.open_count ? "warn" : ledger.rows.length ? "ok" : "idle",
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
  const dataStatus = datasets.length > 2 ? "ok" : datasets.length ? "warn" : "idle";
  const fetchRootStatus = fetchRoots.some((root) => root.exists && root.is_dir) ? "ok" : "warn";
  const runStatus = runs.length ? "ok" : workbenchRuns.length ? "warn" : "idle";
  const eventStatus = events.length ? "ok" : runs.length ? "warn" : "idle";
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
  const runMetrics = normalizedRunMetrics(latestRun);
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
  const monthWindow = performancePeriodWindow(accountRows, "month");
  const todayPerf = performanceFromAccountRows(rowsInWindow(accountRows, todayWindow));
  const weekPerf = performanceFromAccountRows(rowsInWindow(accountRows, weekWindow));
  const monthPerf = performanceFromAccountRows(rowsInWindow(accountRows, monthWindow));
  const latestStatusMonth = (((state.statusEquityRollups || {}).period_rollups || {}).month || [])[0] || null;
  const monthReturn = latestStatusMonth && finiteNumber(latestStatusMonth.total_return_pct) !== null
    ? latestStatusMonth.total_return_pct
    : monthPerf.total_return_pct;
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
  const latestRejection = events.find((event) => event.type === "order" && eventStatusIsBad(event)) || metricLatestRejection(runMetrics);
  const latestBarTime = metricTimestamp(runMetrics, [
    "latest_bar_time",
    "latest_data_time",
    "latest_market_data_time",
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
  const monthRows = rowsInWindow(accountRows, monthWindow);
  const todayMeta = todayRows.length ? `${todayWindow.label} / ${numberText(todayRows.length, 0)} account snapshots` : `${todayWindow.label} / no account snapshots`;
  const weekMeta = weekRows.length ? `${weekWindow.label} / ${numberText(weekRows.length, 0)} account snapshots` : `${weekWindow.label} / no account snapshots`;
  const monthMeta = latestStatusMonth && finiteNumber(latestStatusMonth.total_return_pct) !== null
    ? `${text(latestStatusMonth.label)} status rollup / ${numberText(latestStatusMonth.day_count, 0)} days`
    : monthRows.length ? `${monthWindow.label} / ${numberText(monthRows.length, 0)} account snapshots` : `${monthWindow.label} / no account snapshots`;

  $("overview-equity").textContent = money(equity);
  $("overview-equity").className = "value-equity";
  $("overview-subtitle").textContent = sourceMeta;
  if ($("overview-equity-spark")) {
    $("overview-equity-spark").innerHTML = equitySparkline(accountRows);
  }
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
  setMetricValue("overview-month-return", pctText(monthReturn), {
    className: signedValueClass(monthReturn),
    meta: monthMeta,
  });
  setMetricValue("overview-exposure", pctText(exposurePct), {
    className: statusClass(exposurePct == null ? "" : exposurePct ? "warn" : "ok"),
    meta: sourceMeta,
  });
  setMetricValue("overview-next-check", nextCheck ? text(nextCheck) : "n/a", {
    className: statusClass(nextCheck ? "ok" : "warn"),
    meta: latestRun ? `runner ${text(latestRun.id)}` : "no current runner",
  });
  renderOverviewCommandCenter();
  renderBackendPipeline();
  renderOverviewPerformanceSnapshot();
  renderOverviewGlance();
  renderOverviewHealthReport();
  renderOverviewWorkflowLauncher();
  renderOverviewSessionState();
  renderRuntimeStatus();
  renderOverviewHealth();
  renderOverviewAlerts();
  renderOverviewOrders();
  renderOverviewPositions();
  renderOverviewTimeline();
}

function renderOverviewCommandCenter() {
  if (!$("overview-command-title") || !$("overview-command-cards")) return;
  const payload = state.status || {};
  const runs = payload.runs || [];
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");
  const latestRejectedOrder = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const openOrders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const accountRows = source.account || [];
  const latestAccount = latestAccountRow(accountRows);
  const positions = nonzeroPositionsFromSource(source);
  const rollups = sortedStatusRollups();
  const latestDay = rollups.length ? rollups[rollups.length - 1] : null;
  const todayWindow = performancePeriodWindow(accountRows, "today");
  const todayRows = rowsInWindow(accountRows, todayWindow);
  const todayPerf = performanceFromAccountRows(todayRows);
  const todayReturn = latestDay && finiteNumber(latestDay.daily_return_pct) !== null
    ? latestDay.daily_return_pct
    : todayPerf.total_return_pct;
  const latestRun = latestTelemetryRun();
  const runMetrics = normalizedRunMetrics(latestRun);
  const marketData = runtimeMarketDataModel(runMetrics, latestRun);
  const activity = runtimeActivityModel();
  const glance = overviewGlanceModel();
  const primary = $("overview-command-primary");
  const secondary = $("overview-command-secondary");
  $("overview-command-note").textContent = payload.generated_at
    ? `Status ${shortTimestampAgeLabel(payload.generated_at)} / ${numberText(events.length, 0)} recent event${events.length === 1 ? "" : "s"}`
    : "No current telemetry published";
  $("overview-command-title").textContent = glance.title;
  $("overview-command-title").className = statusClass(glance.status);
  $("overview-command-summary").textContent = glance.summary;
  if (primary) {
    primary.textContent = glance.primary.label;
    primary.dataset.viewTarget = glance.primary.target;
    primary.dataset.viewLens = glance.primary.lens || "";
  }
  if (secondary) {
    secondary.textContent = glance.secondary.label;
    secondary.dataset.viewTarget = glance.secondary.target;
    secondary.dataset.viewLens = glance.secondary.lens || "";
  }
  const accountDetail = latestAccount.timestamp
    ? `Latest account ${shortTimestampAgeLabel(latestAccount.timestamp)}.`
    : accountRows.length ? "Account rows loaded without timestamp." : "No account snapshot loaded.";
  const cards = [
    {
      label: "Today Return",
      title: pctText(todayReturn),
      status: todayReturn === null || todayReturn === undefined ? "warn" : todayReturn >= 0 ? "ok" : "bad",
      className: signedValueClass(todayReturn),
      detail: latestDay && finiteNumber(latestDay.daily_return_pct) !== null
        ? `${text(latestDay.day)} status rollup with ${numberText(latestDay.snapshot_count, 0)} snapshots.`
        : todayRows.length ? `${numberText(todayRows.length, 0)} account snapshots in today's window.` : "No current-day equity evidence.",
    },
    {
      label: "Decision Loop",
      title: latestDecision ? text(latestDecision.symbol || "checked") : runs.length ? "awaiting" : "offline",
      status: latestRejectedOrder ? "bad" : latestDecision ? "ok" : runs.length ? "warn" : "idle",
      detail: latestRejectedOrder
        ? `${text(latestRejectedOrder.symbol)} ${text(latestRejectedOrder.status)} ${shortTimestampAgeLabel(latestRejectedOrder.timestamp)}.`
        : latestDecision
          ? `${text(latestDecision.status || latestDecision.detail)} ${shortTimestampAgeLabel(latestDecision.timestamp)}.`
          : runs.length ? "A run is visible, but no latest decision event is published." : "No run is publishing decisions.",
    },
    {
      label: "Orders And Fills",
      title: openOrders.length ? `${numberText(openOrders.length, 0)} open` : latestFill ? "filled" : positions.length ? `${numberText(positions.length, 0)} pos` : "flat",
      status: latestRejectedOrder ? "bad" : openOrders.length || positions.length ? "warn" : latestFill ? "ok" : runs.length ? "ok" : "bad",
      detail: latestFill
        ? `${text(latestFill.symbol)} fill ${shortTimestampAgeLabel(latestFill.timestamp)}.`
        : openOrders.length ? "Open order telemetry needs broker/account review." : positions.length ? "Open positions are visible in the current account source." : "No open order or fill telemetry.",
    },
    {
      label: "Evidence",
      title: source.has_data ? text(source.label) : "missing",
      status: source.has_data && (accountRows.length || rollups.length) ? "ok" : source.has_data || rollups.length ? "warn" : "bad",
      detail: `${numberText(accountRows.length, 0)} account snapshots / ${numberText(rollups.length, 0)} status day rows. ${accountDetail}`,
    },
    {
      label: "Runtime Activity",
      title: activity.label,
      status: activity.status,
      detail: activity.detail,
    },
    {
      label: "Market Data",
      title: marketData.title,
      status: marketData.status,
      detail: marketData.detail,
    },
  ];
  $("overview-command-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className || statusClass(card.status))}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
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
  const dataInventory = symbolInventoryModel();
  const fetchManifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const artifactRows = runs
    .map((runItem) => ({ run: runItem, evidence: runItem.artifact_evidence || null }))
    .filter((item) => item.evidence);
  const artifactExisting = artifactRows.reduce((sum, item) => sum + Number(item.evidence.existing_count || 0), 0);
  const artifactMissing = artifactRows.reduce((sum, item) => sum + Number(item.evidence.missing_count || 0), 0);
  const artifactJsonlRows = artifactRows.reduce((sum, item) => sum + Number(item.evidence.jsonl_row_count || 0), 0);
  const performanceArtifactRuns = artifactRows.filter((item) => {
    const categories = item.evidence.category_counts || {};
    return Number(categories.performance || 0) > 0;
  }).length;
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
  if (!dataInventory.fileCount && datasets.length === 0 && !hasCurrentTelemetry) {
    status = "idle";
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
      value: dataInventory.symbolCount
        ? `${numberText(dataInventory.symbolCount, 0)} symbols`
        : numberText(datasets.length, 0),
      status: dataInventory.fileCount ? dataInventory.status : datasets.length > 2 ? "ok" : datasets.length ? "warn" : "idle",
      detail: dataInventory.fileCount
        ? `${numberText(dataInventory.fileCount, 0)} indexed file${dataInventory.fileCount === 1 ? "" : "s"}; ${dataInventory.indexComplete === false ? "partial" : "complete"} root index.`
        : fetchManifests.length
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

function worstStatusFrom(items = []) {
  // "idle" means empty-by-design (nothing started yet); it never raises a rollup.
  const ranks = { bad: 3, warn: 2, unknown: 1, ok: 0, idle: 0 };
  return (items || []).reduce((worst, item) => {
    const status = text(item.status || "unknown").toLowerCase();
    return (ranks[status] ?? 1) > (ranks[worst] ?? 1) ? status : worst;
  }, "ok");
}

function overviewHealthReportModel() {
  const payload = state.status || {};
  const runs = payload.runs || [];
  const alerts = payload.alerts || [];
  const latestRun = latestTelemetryRun();
  const metrics = normalizedRunMetrics(latestRun);
  const source = latestArtifactPerformance();
  const accountRows = source.account || [];
  const latestAccount = latestAccountRow(accountRows);
  const positions = nonzeroPositionsFromSource(source);
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestOrder = events.find((event) => event.type === "order");
  const latestFill = events.find((event) => event.type === "fill");
  const latestReject = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const openOrders = currentOpenOrderRows();
  const runtimeItems = runtimeStatusItems();
  const healthChecks = overviewHealthChecks();
  const glance = overviewGlanceModel();
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const fetchManifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const artifactRows = remoteRunArtifactEvidenceRows(runs);
  const artifactExisting = artifactRows.reduce((sum, item) => sum + Number(item.evidence.existing_count || 0), 0);
  const artifactMissing = artifactRows.reduce((sum, item) => sum + Number(item.evidence.missing_count || 0), 0);
  const artifactJsonlRows = artifactRows.reduce((sum, item) => sum + Number(item.evidence.jsonl_row_count || 0), 0);
  const performanceArtifactRuns = artifactRows.filter((item) => {
    const categories = item.evidence.category_counts || {};
    return Number(categories.performance || 0) > 0;
  }).length;
  const todayWindow = performancePeriodWindow(accountRows, "today");
  const todayRows = rowsInWindow(accountRows, todayWindow);
  const todayPerf = performanceFromAccountRows(todayRows);
  const runtimeWorst = worstStatusFrom(runtimeItems);
  const healthWorst = worstStatusFrom(healthChecks);
  const accountFresh = latestAccount.timestamp ? timestampAgeLabel(latestAccount.timestamp) : "missing";
  const marketTimestamp = metricTimestamp(metrics, [
    "latest_bar_time",
    "latest_data_time",
    "latest_market_data_time",
    "last_bar_time",
    "market_data_time",
  ]);
  const decisionTimestamp = firstPresent(metrics.last_decision_time, latestDecision && latestDecision.timestamp);
  const nextCheck = firstPresent(
    metrics.next_decision_time,
    metrics.next_expected_decision_time,
    metrics.next_check_time,
    metrics.next_signal_time,
  );
  const executionStatus = latestReject ? "bad" : openOrders.length || positions.length ? "warn" : latestFill || latestOrder || latestDecision ? "ok" : latestRun ? "warn" : "bad";
  const dataStatus = datasets.length > 2 ? "ok" : datasets.length ? "warn" : "bad";
  const workbenchStatus = drafts.length ? "ok" : datasets.length ? "warn" : "bad";
  const blockers = [
    runtimeWorst === "bad" ? "runtime" : "",
    healthWorst === "bad" ? "health" : "",
    alerts.some((alert) => ["bad", "error"].includes(text(alert.level).toLowerCase())) ? "alerts" : "",
    latestReject ? "rejected order" : "",
    !runs.length && !source.has_data ? "no telemetry/artifact" : "",
  ].filter(Boolean);
  const warnings = [
    runtimeWorst === "warn" ? "runtime" : "",
    healthWorst === "warn" ? "health" : "",
    alerts.length ? "alerts" : "",
    openOrders.length ? "open orders" : "",
    positions.length ? "open positions" : "",
    datasets.length <= 2 ? "saved data" : "",
    !drafts.length ? "workbench draft" : "",
  ].filter(Boolean);
  const status = blockers.length ? "bad" : warnings.length ? "warn" : "ok";
  const headline = blockers.length ? "Review blockers before trusting today" : warnings.length ? "Usable with review items" : "Current strategy state looks usable";
  let nextAction = blockers.length
    ? "Open Operations or Runs to resolve the first blocker before trusting performance."
    : warnings.length
      ? "Review warnings, then use Performance for results and Runs for exact event evidence."
      : "Use Performance for current results; use Runs if a number needs exact evidence.";
  if (latestReject) {
    nextAction = "Open Runs Events and inspect the rejected/canceled order before continuing.";
  } else if (openOrders.length) {
    nextAction = "Open Runs State to reconcile non-terminal order telemetry with broker/account state.";
  } else if (!datasets.length) {
    nextAction = "Open Data Library to configure saved data roots before replay/benchmark work.";
  } else if (!drafts.length && datasets.length) {
    nextAction = "Open Workbench to turn visible saved data into a validated example replay draft.";
  }
  const cards = [
    {
      status,
      label: "Current Read",
      title: headline,
      note: glance.summary,
    },
    {
      status: runtimeWorst,
      label: "Runtime",
      title: runtimeWorst === "bad" ? "Blocked" : runtimeWorst === "warn" ? "Review" : "OK",
      note: runtimeItems.map((item) => `${item.label}: ${item.value}`).slice(0, 3).join("; ") || "No runtime items loaded.",
    },
    {
      status: alerts.length ? "warn" : "ok",
      label: "Alerts",
      title: numberText(alerts.length, 0),
      note: alerts.length ? text(alerts[0].message || alerts[0].kind) : "No current alerts published.",
    },
    {
      status: executionStatus,
      label: "Execution",
      title: `${numberText(openOrders.length, 0)} open / ${latestReject ? "reject" : latestFill ? "fill" : latestDecision ? "checked" : "quiet"}`,
      note: latestReject
        ? `${text(latestReject.symbol)} ${text(latestReject.status)} ${text(latestReject.detail)}`
        : latestFill ? `${text(latestFill.symbol)} filled ${shortTimestampAgeLabel(latestFill.timestamp)}.`
          : latestDecision ? `${text(latestDecision.symbol)} decision ${shortTimestampAgeLabel(latestDecision.timestamp)}.`
            : "No recent decision/order/fill event is visible.",
    },
    {
      status: todayPerf.total_return_pct == null ? "warn" : todayPerf.total_return_pct >= 0 ? "ok" : "bad",
      label: "Performance",
      title: pctText(todayPerf.total_return_pct),
      note: todayRows.length ? `${numberText(todayRows.length, 0)} account snapshots today; latest account ${accountFresh}.` : "No current-day account path loaded.",
    },
    {
      status: artifactRows.length ? artifactMissing ? "warn" : "ok" : runs.length ? "warn" : "bad",
      label: "Artifacts",
      title: artifactRows.length ? `${numberText(artifactExisting, 0)} files` : "none",
      note: artifactRows.length
        ? `${numberText(artifactMissing, 0)} missing; ${numberText(artifactJsonlRows, 0)} JSONL rows; ${numberText(performanceArtifactRuns, 0)} performance rollup run${performanceArtifactRuns === 1 ? "" : "s"}.`
        : "Current runs did not publish bounded artifact evidence.",
    },
    {
      status: dataStatus,
      label: "Saved Data",
      title: numberText(datasets.length, 0),
      note: fetchManifests.length ? `${numberText(fetchManifests.length, 0)} fetch manifest${fetchManifests.length === 1 ? "" : "s"} visible.` : "No fetch manifests loaded.",
    },
    {
      status: workbenchStatus,
      label: "Workbench",
      title: drafts.length ? `${numberText(drafts.length, 0)} drafts` : "No Drafts",
      note: drafts.length ? "Saved drafts are available for validation/run review." : datasets.length ? "Visible saved data can be turned into a replay draft." : "Workbench needs visible saved data first.",
    },
  ];
  const lines = [
    {
      status,
      title: "Summary",
      detail: `${headline}. ${numberText(blockers.length, 0)} blocker${blockers.length === 1 ? "" : "s"} / ${numberText(warnings.length, 0)} warning${warnings.length === 1 ? "" : "s"}.`,
    },
    {
      status: payload.generated_at ? "ok" : "bad",
      title: "Telemetry",
      detail: payload.generated_at
        ? `Status updated ${shortTimestampAgeLabel(payload.generated_at)}; ${numberText(runs.length, 0)} run${runs.length === 1 ? "" : "s"} published; mode ${text(metrics.mode)}.`
        : "No status payload is published.",
    },
    {
      status: runtimeWorst,
      title: "Runtime Loop",
      detail: `Market ${timestampAgeLabel(marketTimestamp)}; decision ${timestampAgeLabel(decisionTimestamp)}; next check ${text(nextCheck || "n/a")}.`,
    },
    {
      status: alerts.length || latestReject ? latestReject ? "bad" : "warn" : "ok",
      title: "Alerts And Orders",
      detail: `${numberText(alerts.length, 0)} alert${alerts.length === 1 ? "" : "s"}; ${numberText(openOrders.length, 0)} non-terminal order event${openOrders.length === 1 ? "" : "s"}; latest reject ${latestReject ? `${text(latestReject.symbol)} ${text(latestReject.status)}` : "none"}.`,
    },
    {
      status: positions.length ? "warn" : source.has_data ? "ok" : "bad",
      title: "Account And Positions",
      detail: `${text(source.label || source.source_type)}; latest account ${accountFresh}; ${numberText(positions.length, 0)} open position${positions.length === 1 ? "" : "s"}; today return ${pctText(todayPerf.total_return_pct)}.`,
    },
    {
      status: artifactRows.length ? artifactMissing ? "warn" : "ok" : runs.length ? "warn" : "idle",
      title: "Artifact Evidence",
      detail: artifactRows.length
        ? `${numberText(artifactRows.length, 0)} current run${artifactRows.length === 1 ? "" : "s"}; ${numberText(artifactExisting, 0)} existing expected files; ${numberText(artifactMissing, 0)} missing; ${numberText(artifactJsonlRows, 0)} JSONL rows; ${numberText(performanceArtifactRuns, 0)} performance rollup artifact${performanceArtifactRuns === 1 ? "" : "s"}.`
        : "No bounded current-run artifact evidence is published.",
    },
    {
      status: dataStatus,
      title: "Data And Workbench",
      detail: `${numberText(datasets.length, 0)} saved dataset${datasets.length === 1 ? "" : "s"}; ${numberText(fetchManifests.length, 0)} fetch manifest${fetchManifests.length === 1 ? "" : "s"}; ${numberText(drafts.length, 0)} Workbench draft${drafts.length === 1 ? "" : "s"}.`,
    },
    {
      status,
      title: "Next Action",
      detail: nextAction,
    },
  ];
  return { status, headline, nextAction, cards, lines };
}

function overviewHealthReportText(model) {
  return [
    `Strategy Health Report: ${model.headline}`,
    ...model.lines.map((line) => `${line.title}: ${line.detail}`),
  ].join("\n");
}

function renderOverviewHealthReport() {
  if (!$("overview-health-report-note") || !$("overview-health-report-cards") || !$("overview-health-report-body") || !$("overview-health-report-actions")) return;
  const model = overviewHealthReportModel();
  state.overviewHealthReportText = overviewHealthReportText(model);
  $("overview-health-report-note").textContent = model.nextAction;
  $("overview-health-report-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("overview-health-report-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("overview-health-report-actions").innerHTML = [
    `<button type="button" data-overview-health-report-action="copy">Copy Report</button>`,
    `<button type="button" class="secondary" data-overview-health-report-action="performance">Performance</button>`,
    `<button type="button" class="secondary" data-overview-health-report-action="runs">Runs Events</button>`,
    `<button type="button" class="secondary" data-overview-health-report-action="operations">Operations</button>`,
    `<button type="button" class="secondary" data-overview-health-report-action="data">Data Library</button>`,
    `<button type="button" class="secondary" data-overview-health-report-action="workbench">Workbench</button>`,
  ].join("");
}

function handleOverviewHealthReportAction(action) {
  if (action === "copy") {
    copyText(state.overviewHealthReportText || "No strategy health report loaded").then(() => {
      $("last-refresh").textContent = "Strategy health report copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Strategy health report copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "performance") return navigateToView("performance");
  if (action === "runs") return navigateToRunsLens("events");
  if (action === "operations") return navigateToOperationsLens("home");
  if (action === "data") return navigateToDataLens("home");
  if (action === "workbench") return navigateToWorkbenchLens("home");
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
      status: performanceReady ? "ok" : runs.length ? "warn" : "idle",
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
      status: datasets.length ? draftRows.length ? "ok" : "warn" : "idle",
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
  let stateStatus = "idle";
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

const ALERT_GUIDANCE = [
  { match: /^gateway_/, meaning: "The IB Gateway/API connection has a problem.", action: "Run Check Gateway in Operations; restart the gateway service or complete its login if needed.", target: "operations", targetLabel: "Open Operations" },
  { match: /^market_data_health/, meaning: "A runner reports incomplete or stale market data for some symbols.", action: "Open the run's market-data card in Operations; refetch history for the listed symbols if the gap persists.", target: "operations", targetLabel: "Open Operations" },
  { match: /^run_stale/, meaning: "A run has not published a fresh decision within its configured age limit.", action: "Check the supervisor schedule and the run's latest session in Runs.", target: "runs", targetLabel: "Open Runs" },
  { match: /^rejected_orders/, meaning: "Recent orders were rejected by the broker.", action: "Filter Runs Events to rejected orders and read each broker message.", target: "runs", targetLabel: "Open Runs" },
  { match: /^risk_limit_trip/, meaning: "A configured risk limit blocked activity.", action: "Review the triggering order in Runs and the run's risk settings before changing any limit.", target: "runs", targetLabel: "Open Runs" },
  { match: /^remote_control_/, meaning: "The remote-control command or audit path reported a problem.", action: "Inspect command audit integrity and worker state in Operations Control.", target: "operations", targetLabel: "Open Operations" },
  { match: /^supervisor_/, meaning: "The paper supervisor or one of its scheduled jobs has an issue.", action: "Check supervisor state in Operations and the supervisor service logs if a job missed its window.", target: "operations", targetLabel: "Open Operations" },
  { match: /^unexpected_/, meaning: "The account's position state does not match what the strategy expects.", action: "Reconcile expected versus actual positions in Runs State before trusting automation.", target: "runs", targetLabel: "Open Runs" },
  { match: /^run_/, meaning: "A configured run's telemetry or artifacts are missing or unreadable.", action: "Inspect the run's state and artifacts in Runs; verify the runner and status bridge are writing.", target: "runs", targetLabel: "Open Runs" },
];

function alertGuidance(kind) {
  const entry = ALERT_GUIDANCE.find((item) => item.match.test(String(kind || "")));
  return entry || {
    meaning: "A published telemetry health check failed.",
    action: "Inspect current health checks in Operations.",
    target: "operations",
    targetLabel: "Open Operations",
  };
}

function alertCardsHtml(alerts, emptyMessage) {
  if (!alerts.length) {
    return `<div class="chart-empty">${escapeHtml(emptyMessage)}</div>`;
  }
  const cards = alerts.map((alert) => {
    const guidance = alertGuidance(alert.kind);
    const level = alert.level === "warn" ? "warn" : alert.level === "error" || alert.level === "bad" ? "bad" : text(alert.level);
    return `
    <div class="action-card alert-card status-${escapeHtml(level)}">
      <span>${statusText(level)} ${escapeHtml(text(alert.kind))}</span>
      <strong>${escapeHtml(text(alert.message))}</strong>
      <small>${escapeHtml(guidance.meaning)} ${escapeHtml(guidance.action)}</small>
      <button class="secondary nav-jump" type="button" data-view-target="${escapeHtml(guidance.target)}">${escapeHtml(guidance.targetLabel)}</button>
    </div>`;
  }).join("");
  return `${cards}<p class="muted alert-clear-note">Alerts are recomputed from telemetry on every publish and clear automatically once the underlying condition resolves — there is nothing to dismiss manually.</p>`;
}

function renderOverviewAlerts() {
  const alerts = ((state.status && state.status.alerts) || []).slice(0, 6);
  $("overview-alerts-note").textContent = alerts.length
    ? `${numberText(alerts.length, 0)} current alert${alerts.length === 1 ? "" : "s"}`
    : "No current alerts";
  $("overview-alerts-body").innerHTML = alertCardsHtml(
    alerts,
    "No stale-data, stale-account, gateway, rejection, or risk alerts are currently published.",
  );
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
  $("subtitle").textContent = state.statusFetchError
    ? `Status fetch failed: ${state.statusFetchError}`
    : `${text(payload.node_id)} - ${text(payload.generated_at)}`;
  renderTopbarStatusStrip();
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
  const dataMetric = savedDataMetricModel();
  $("metric-data").textContent = dataMetric.value;
  $("metric-data").className = statusClass(dataMetric.status);
  $("metric-data").title = dataMetric.title;
  $("command-node").value = payload.node_id || $("command-node").value || "example-local-trader";
  if (supervisors.length && !$("command-supervisor").value) {
    $("command-supervisor").value = supervisors[0].id || "";
  }
}

function renderPerformance() {
  $("performance-source-mode").value = state.performanceSourceMode || "current";
  const telemetryRunSelect = $("performance-telemetry-run");
  if (telemetryRunSelect) {
    const telemetryRuns = (state.status && state.status.runs) || [];
    const optionKey = telemetryRuns.map((runItem) => String(runItem.id || "")).join("|");
    if (telemetryRunSelect.dataset.optionKey !== optionKey) {
      telemetryRunSelect.innerHTML = telemetryRuns.length
        ? telemetryRuns.map((runItem) => `<option value="${escapeHtml(String(runItem.id || ""))}">${escapeHtml(String(runItem.id || "run"))}</option>`).join("")
        : `<option value="">No published runs</option>`;
      telemetryRunSelect.dataset.optionKey = optionKey;
    }
    const selectedRun = selectedTelemetryRun();
    telemetryRunSelect.value = selectedRun && selectedRun.id ? String(selectedRun.id) : "";
    telemetryRunSelect.disabled = telemetryRuns.length < 2;
  }
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
  renderPerformanceActionSummary({
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
  renderPerformanceScoreboard({
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
  renderPerformanceReview({
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
  renderPerformanceEvidence({
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
  renderPerformanceReport({
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
    positionCount,
    turnover,
  });
  renderPerformanceSnapshot({
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
  if ($("performance-trade-cumulative-chart")) {
    $("performance-trade-cumulative-chart").innerHTML = tradeCumulativePnlChart(shownTradeRows);
    $("performance-trade-pnl-chart").innerHTML = tradePnlBarChart(shownTradeRows);
  }
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
  const windowStatus = accountRows.length ? "ok" : source.has_data ? "warn" : "idle";
  const executionStatus = rejections > 0 || approvalRequired > 0
    ? "warn"
    : fillCount > 0
      ? "ok"
      : decisions || orders ? "warn" : "bad";
  let nextStatus = "idle";
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
      status: latestAccount.timestamp ? "ok" : source.has_data ? "warn" : "idle",
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
  const freshnessStatus = latestAccount.timestamp ? "ok" : source.has_data ? "warn" : "idle";
  const tradeStatus = ledger.stats.closed_count ? "ok" : fills.length ? "warn" : "idle";
  const tiles = [
    {
      status: source.has_data ? "ok" : "idle",
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

function performanceActionSummaryModel(context) {
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
  const statusRollups = (state.statusEquityRollups && state.statusEquityRollups.rollups) || [];
  const runRollups = (state.performanceRollups && state.performanceRollups.rollups) || [];
  const issueCount = Number(rejections || 0) + Number(approvalRequired || 0);
  const totalReturn = finiteNumber(periodPerf.total_return_pct);
  const drawdown = finiteNumber(periodPerf.max_drawdown_pct);
  const accountTotal = Number((allAccountRows || []).length || 0);
  const selectedAccounts = Number((accountRows || []).length || 0);
  const hasRollups = statusRollups.length || runRollups.length;
  const hasTrades = Number(ledger.stats.closed_count || 0) || Number(ledger.stats.open_count || 0) || fills.length;
  const hasActivity = Number(decisions || 0) || Number(orders || 0) || Number(fillCount || 0) || issueCount;
  let priority = {
    action: "workbench",
    label: "Workbench",
    title: "Create Evidence",
    note: "No performance source is loaded. Run a replay/simulated-paper draft or publish runner telemetry first.",
    status: "bad",
  };
  if (source.has_data && !selectedAccounts && accountTotal) {
    priority = {
      action: "period-all",
      label: "All Period",
      title: "Selected Period Empty",
      note: `${window.label} has no account snapshots, but ${numberText(accountTotal, 0)} account snapshot${accountTotal === 1 ? "" : "s"} exist outside the window.`,
      status: "warn",
    };
  } else if (source.has_data && !selectedAccounts && !hasActivity) {
    priority = {
      action: "evidence",
      label: "Evidence",
      title: "Summary Only",
      note: "The selected source has headline data but no account, fill, decision, or order evidence for this window.",
      status: "warn",
    };
  } else if (issueCount) {
    priority = {
      action: "orders",
      label: "Orders",
      title: "Execution Review",
      note: `${numberText(rejections, 0)} rejection${rejections === 1 ? "" : "s"} and ${numberText(approvalRequired, 0)} approval hold${approvalRequired === 1 ? "" : "s"} are visible.`,
      status: "warn",
    };
  } else if (drawdown !== null && Math.abs(drawdown) >= 8) {
    priority = {
      action: "rollups",
      label: "Rollups",
      title: "Risk Review",
      note: `Drawdown is ${pctText(drawdown)} in the selected evidence; inspect rollups and risk continuity first.`,
      status: Math.abs(drawdown) >= 20 ? "bad" : "warn",
    };
  } else if (source.has_data && !hasTrades) {
    priority = {
      action: "trades",
      label: "Trades",
      title: "No Trade Rows",
      note: "Performance has a source, but no paired trade rows are available for win/loss or fill-level behavior.",
      status: "warn",
    };
  } else if (source.has_data && !hasRollups) {
    priority = {
      action: "rollups",
      label: "Rollups",
      title: "No Period History",
      note: "Daily/monthly/yearly rollups are missing, so longer-period continuity is not yet visible.",
      status: "warn",
    };
  } else if (source.has_data && !benchmark.path) {
    priority = {
      action: "benchmark",
      label: "Benchmark",
      title: "Add Market Context",
      note: "Load a saved Data Library file to compare normalized strategy return against a benchmark.",
      status: "warn",
    };
  } else if (source.has_data) {
    priority = {
      action: "trades",
      label: "Trades",
      title: totalReturn !== null && totalReturn >= 0 ? "Inspect Positive Window" : "Inspect Current Window",
      note: "Source, account path, execution, rollups, and benchmark context are available. Inspect trades or charts next.",
      status: totalReturn !== null && totalReturn < 0 ? "warn" : "ok",
    };
  }
  const cards = [
    {
      status: source.has_data ? selectedAccounts ? "ok" : "warn" : "idle",
      label: "Source",
      title: source.has_data ? text(source.label) : "No Source",
      note: source.has_data
        ? `${numberText(selectedAccounts, 0)} selected account snapshot${selectedAccounts === 1 ? "" : "s"} / ${numberText(accountTotal, 0)} total.`
        : "Publish telemetry, run a draft, or open a saved artifact.",
    },
    {
      status: totalReturn === null ? "warn" : totalReturn >= 0 ? "ok" : "bad",
      label: "Return",
      title: pctText(totalReturn),
      note: `${window.label}; drawdown ${pctText(drawdown)}.`,
      className: signedValueClass(totalReturn),
    },
    {
      status: issueCount ? "warn" : source.has_data ? "ok" : "bad",
      label: "Execution",
      title: issueCount ? `${numberText(issueCount, 0)} issue${issueCount === 1 ? "" : "s"}` : `${numberText(fillCount, 0)} fills`,
      note: `${numberText(orders, 0)} orders / ${numberText(rejections, 0)} rejects / ${numberText(approvalRequired, 0)} approvals.`,
    },
    {
      status: hasTrades ? "ok" : source.has_data ? "warn" : "bad",
      label: "Trades",
      title: hasTrades ? `${numberText(ledger.stats.closed_count, 0)} closed` : "No Rows",
      note: hasTrades ? `${numberText(ledger.stats.wins, 0)} wins / ${numberText(ledger.stats.losses, 0)} losses.` : "Load fills or artifacts for trade-level stats.",
    },
    {
      status: hasRollups ? "ok" : source.has_data ? "warn" : "bad",
      label: "Rollups",
      title: hasRollups ? `${numberText(statusRollups.length + runRollups.length, 0)} rows` : "Missing",
      note: hasRollups ? "Daily/period continuity is available." : "Status-history or run rollups are not loaded.",
    },
    {
      status: priority.status,
      label: "Next Move",
      title: priority.title,
      note: priority.note,
    },
  ];
  const actions = [
    priority,
    { action: "trades", label: "Trades", title: "Open Trades", status: hasTrades ? "ok" : "warn" },
    { action: "rollups", label: "Rollups", title: "Open Rollups", status: hasRollups ? "ok" : "warn" },
    { action: "orders", label: "Orders", title: "Review Orders", status: issueCount ? "warn" : "ok" },
    { action: "benchmark", label: "Benchmark", title: "Load Benchmark", status: benchmark.path ? "ok" : "warn" },
    { action: "evidence", label: "Evidence", title: "Review Evidence", status: source.has_data ? "ok" : "bad" },
  ];
  return {
    note: `${text(source.label)} / ${window.label}; priority: ${priority.title}. Latest account ${latestAccount.timestamp ? shortTimestampAgeLabel(latestAccount.timestamp) : "n/a"}.`,
    cards,
    actions,
  };
}

function renderPerformanceActionSummary(context) {
  if (!$("performance-action-note") || !$("performance-action-cards") || !$("performance-action-actions")) return;
  const model = performanceActionSummaryModel(context);
  $("performance-action-note").textContent = model.note;
  $("performance-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className || statusClass(card.status))}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("performance-action-actions").innerHTML = model.actions.map((action, index) => `
    <button type="button" class="${index ? "secondary" : ""}" data-performance-action="${escapeHtml(action.action)}">
      <span>${escapeHtml(action.title)}</span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

function handlePerformanceAction(action) {
  if (action === "period-all") {
    $("performance-period").value = "all";
    renderPerformance();
    $("last-refresh").textContent = "Performance period switched to All";
    return;
  }
  if (action === "trades") return navigateToPerformanceLens("trades");
  if (action === "rollups") return navigateToPerformanceLens("rollups");
  if (action === "orders") return navigateToRunsLens("state");
  if (action === "benchmark") return navigateToDataLens("browse");
  if (action === "workbench") return navigateToWorkbenchLens("home");
  const target = $("performance-evidence-note");
  if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
}

function renderPerformanceScoreboard(context) {
  if (!$("performance-scoreboard-note") || !$("performance-scoreboard-cards") || !$("performance-scoreboard-actions")) return;
  const {
    source,
    window,
    accountRows,
    allAccountRows,
    periodPerf,
    mode,
    latestAccount,
    rejections,
    approvalRequired,
  } = context;
  const snapshot = performanceSnapshotModel(context);
  const cardsByLabel = new Map((snapshot.cards || []).map((card) => [card.label, card]));
  const issueCount = Number(rejections || 0) + Number(approvalRequired || 0);
  const sourceStatus = source.has_data
    ? issueCount ? "warn" : accountRows.length || (allAccountRows || []).length ? "ok" : "warn"
    : "bad";
  const sourceCard = {
    status: sourceStatus,
    className: statusClass(sourceStatus),
    label: "Source",
    title: source.has_data ? text(mode || source.source_type || "loaded") : "No Source",
    note: source.has_data
      ? `${text(source.label)}; latest account ${latestAccount.timestamp ? shortTimestampAgeLabel(latestAccount.timestamp) : "n/a"}.`
      : "Publish telemetry, open a saved run, or load Workbench artifacts.",
  };
  const scoreboardCards = [
    sourceCard,
    cardsByLabel.get("Today"),
    cardsByLabel.get("Recent"),
    cardsByLabel.get("Month"),
    cardsByLabel.get("All Available"),
    cardsByLabel.get("Max Drawdown"),
    cardsByLabel.get("Readiness"),
  ].filter(Boolean);
  const numericReturn = finiteNumber(periodPerf.total_return_pct);
  const headline = source.has_data
    ? `${pctText(numericReturn)} selected-window return`
    : "No current performance source";
  const evidence = accountRows.length
    ? `${numberText(accountRows.length, 0)} account snapshots in ${window.label}`
    : (allAccountRows || []).length
      ? `${numberText((allAccountRows || []).length, 0)} account snapshots outside this period`
      : "no account snapshot path";
  const issueText = issueCount
    ? `${numberText(issueCount, 0)} execution issue${issueCount === 1 ? "" : "s"} visible`
    : "no visible rejects or approval holds";
  $("performance-scoreboard-note").textContent = `${headline}; ${evidence}; ${issueText}.`;
  $("performance-scoreboard-cards").innerHTML = scoreboardCards.map((card) => `
    <article class="performance-scoreboard-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className || statusClass(card.status))}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </article>
  `).join("");
  $("performance-scoreboard-actions").innerHTML = [
    `<a href="#performance/trades">Trades</a>`,
    `<a class="secondary" href="#performance/rollups">Rollups</a>`,
    `<a class="secondary" href="#runs/state">Orders</a>`,
    `<a class="secondary" href="#data/browse">Benchmark Data</a>`,
  ].join("");
}

function renderPerformanceReview(context) {
  if (!$("performance-review-note") || !$("performance-review-cards") || !$("performance-review-actions")) return;
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
  const totalReturn = finiteNumber(periodPerf.total_return_pct);
  const drawdown = finiteNumber(periodPerf.max_drawdown_pct);
  const exposure = finiteNumber(periodPerf.max_gross_exposure_pct);
  const elapsedDays = finiteNumber(periodPerf.elapsed_days);
  const executionIssues = Number(rejections || 0) + Number(approvalRequired || 0);
  const rollups = sortedStatusRollups();
  const latestDay = rollups.length ? rollups[rollups.length - 1] : null;
  const benchmark = state.performanceBenchmarkDetail || {};
  const sourceHasDepth = accountRows.length || (allAccountRows || []).length || fills.length || orders || decisions;
  let verdictStatus = "bad";
  let verdictTitle = "Load Performance";
  let verdictNote = "No current telemetry, saved run summary, or artifact account path is available for review.";
  let primaryHref = "#runs";
  let primaryLabel = "Open Runs";
  if (source.has_data && !sourceHasDepth) {
    verdictStatus = "warn";
    verdictTitle = "Summary Only";
    verdictNote = "Headline metrics exist, but there are not enough account snapshots, fills, or decisions to explain them.";
    primaryHref = "#workbench/artifacts";
    primaryLabel = "Open Artifacts";
  } else if (source.has_data && !accountRows.length) {
    verdictStatus = "warn";
    verdictTitle = "Change Window";
    verdictNote = "The selected period has no account snapshots, so charts and drawdown are limited for this window.";
    primaryHref = "#performance/diagnostics";
    primaryLabel = "Open Diagnostics";
  } else if (executionIssues) {
    verdictStatus = "warn";
    verdictTitle = "Execution Review Needed";
    verdictNote = "Rejected orders or approval holds are present, so inspect execution before judging strategy quality.";
    primaryHref = "#runs/state";
    primaryLabel = "Review Orders";
  } else if (totalReturn === null) {
    verdictStatus = "warn";
    verdictTitle = "Return Unavailable";
    verdictNote = "The source is loaded, but the selected window does not expose a computable return.";
    primaryHref = "#performance/diagnostics";
    primaryLabel = "Open Diagnostics";
  } else if (drawdown !== null && Math.abs(drawdown) >= 10) {
    verdictStatus = totalReturn >= 0 ? "warn" : "bad";
    verdictTitle = totalReturn >= 0 ? "Positive, Risky" : "Negative With Drawdown";
    verdictNote = "The return window is readable, but drawdown is large enough that risk should be reviewed first.";
    primaryHref = "#performance/rollups";
    primaryLabel = "Open Rollups";
  } else {
    verdictStatus = totalReturn >= 0 ? "ok" : "warn";
    verdictTitle = totalReturn >= 0 ? "Readable Positive Window" : "Readable Negative Window";
    verdictNote = benchmark.path
      ? "Outcome, account path, execution, and benchmark context are available for this window."
      : "Outcome and execution are readable; add a benchmark if you want market-context comparison.";
    primaryHref = benchmark.path ? "#performance/trades" : "#data/browse";
    primaryLabel = benchmark.path ? "Inspect Trades" : "Load Benchmark";
  }
  const cards = [
    {
      status: verdictStatus,
      label: "Verdict",
      title: verdictTitle,
      note: verdictNote,
      className: statusClass(verdictStatus),
    },
    {
      status: accountRows.length ? "ok" : source.has_data ? "warn" : "bad",
      label: "Evidence Depth",
      title: accountRows.length ? `${numberText(accountRows.length, 0)} snapshots` : "No snapshots",
      note: `${numberText(fills.length, 0)} fills / ${numberText(ledger.stats.closed_count, 0)} closed trades / ${numberText(decisions, 0)} decisions in scope.`,
      className: statusClass(accountRows.length ? "ok" : source.has_data ? "warn" : "idle"),
    },
    {
      status: totalReturn === null ? "warn" : totalReturn >= 0 ? "ok" : "bad",
      label: "Window Result",
      title: pctText(totalReturn),
      note: `${window.label}; drawdown ${pctText(drawdown)} / elapsed ${elapsedDays === null ? "n/a" : `${numberText(elapsedDays, 3)} days`} / exposure ${pctText(exposure)}.`,
      className: signedValueClass(totalReturn),
    },
    {
      status: executionIssues ? "warn" : fillCount ? "ok" : source.has_data ? "warn" : "bad",
      label: "Execution Quality",
      title: executionIssues ? `${numberText(executionIssues, 0)} issues` : `${numberText(fillCount, 0)} fills`,
      note: `${numberText(orders, 0)} orders / ${numberText(rejections, 0)} rejects / ${numberText(approvalRequired, 0)} approval holds.`,
      className: statusClass(executionIssues ? "warn" : fillCount ? "ok" : source.has_data ? "warn" : "idle"),
    },
    {
      status: latestDay ? "ok" : source.has_data ? "warn" : "bad",
      label: "Live/Paper Continuity",
      title: latestDay ? pctText(latestDay.daily_return_pct) : "No rollups",
      note: latestDay
        ? `${text(latestDay.day)} ${text(latestDay.node_id)}; ${numberText(rollups.length, 0)} status-history day row${rollups.length === 1 ? "" : "s"}.`
        : "Status-history rollups are not loaded, so current paper/live continuity is not visible here.",
      className: latestDay ? rollupReturnClass(latestDay.daily_return_pct) : statusClass(source.has_data ? "warn" : "idle"),
    },
    {
      status: benchmark.path ? "ok" : source.has_data ? "warn" : "idle",
      label: "Market Context",
      title: benchmark.path ? text(benchmark.symbol) : "No benchmark",
      note: benchmark.path
        ? `${text(benchmark.bar_size)} benchmark overlay loaded from saved data.`
        : "Load a saved benchmark dataset when strategy return needs market context.",
      className: statusClass(benchmark.path ? "ok" : source.has_data ? "warn" : "idle"),
    },
  ];
  $("performance-review-note").textContent = `${text(source.label)} / ${text(mode)} / ${window.label}; latest account ${latestAccount.timestamp ? shortTimestampAgeLabel(latestAccount.timestamp) : "n/a"}`;
  $("performance-review-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className)}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("performance-review-actions").innerHTML = [
    `<a href="${escapeHtml(primaryHref)}">${escapeHtml(primaryLabel)}</a>`,
    `<a class="secondary" href="#performance/trades">Trades</a>`,
    `<a class="secondary" href="#performance/rollups">Rollups</a>`,
    `<a class="secondary" href="#runs/state">Orders</a>`,
    `<a class="secondary" href="#data/browse">Benchmark Data</a>`,
  ].join("");
}

function performanceReportModel(context) {
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
    positionCount,
    turnover,
  } = context;
  const rollups = sortedStatusRollups();
  const periodRollups = (state.statusEquityRollups && state.statusEquityRollups.period_rollups) || {};
  const latestDay = rollups.length ? rollups[rollups.length - 1] : null;
  const weekStats = statusRollupSeriesStats(trailingStatusRollups(rollups, 7));
  const allStatusStats = statusRollupSeriesStats(rollups);
  const latestMonth = ((periodRollups.month || [])[0]) || null;
  const totalReturn = finiteNumber(periodPerf.total_return_pct);
  const todayReturn = latestDay && finiteNumber(latestDay.daily_return_pct) !== null ? latestDay.daily_return_pct : null;
  const recentReturn = finiteNumber(weekStats.total_return_pct);
  const monthReturn = latestMonth && finiteNumber(latestMonth.total_return_pct) !== null ? latestMonth.total_return_pct : null;
  const allReturn = finiteNumber(allStatusStats.total_return_pct) !== null ? allStatusStats.total_return_pct : totalReturn;
  const drawdown = finiteNumber(allStatusStats.max_drawdown_pct) !== null ? allStatusStats.max_drawdown_pct : finiteNumber(periodPerf.max_drawdown_pct);
  const equity = finiteNumber(periodPerf.final_equity) !== null ? periodPerf.final_equity : latestAccount.equity;
  const issueCount = Number(rejections || 0) + Number(approvalRequired || 0);
  const hasCurrentRollups = rollups.length > 0;
  const hasSnapshots = accountRows.length || (allAccountRows || []).length;
  let status = "idle";
  let headline = "No current performance evidence";
  let note = "Publish paper/live status or load a saved run artifact before reading the report.";
  if (source.has_data && hasSnapshots) {
    status = issueCount ? "warn" : "ok";
    headline = totalReturn !== null ? `${pctText(totalReturn)} over ${window.label}` : "Current source loaded";
    note = `${text(source.label)} has ${numberText(accountRows.length, 0)} account snapshots in the selected window.`;
  } else if (source.has_data) {
    status = "warn";
    headline = "Summary-only source";
    note = "Headline metrics or events are loaded, but account snapshots are limited.";
  } else if (hasCurrentRollups) {
    status = "warn";
    headline = "Status rollups only";
    note = "Current status-history rollups are available, but no selected source account path is loaded.";
  }
  const cards = [
    {
      status,
      label: "Report",
      title: headline,
      note,
      className: totalReturn === null ? statusClass(status) : signedValueClass(totalReturn),
    },
    {
      status: todayReturn === null ? "warn" : todayReturn >= 0 ? "ok" : "bad",
      label: "Today",
      title: pctText(todayReturn),
      note: latestDay ? `${text(latestDay.day)} from status-history snapshots.` : "No current-day status return loaded.",
      className: signedValueClass(todayReturn),
    },
    {
      status: monthReturn === null ? "warn" : monthReturn >= 0 ? "ok" : "bad",
      label: "Month",
      title: pctText(monthReturn),
      note: latestMonth ? `${text(latestMonth.label)} status period; ${numberText(latestMonth.day_count, 0)} day rows.` : "No monthly status rollup yet.",
      className: signedValueClass(monthReturn),
    },
    {
      status: drawdown === null ? "warn" : drawdown <= -10 ? "bad" : drawdown < 0 ? "warn" : "ok",
      label: "Risk",
      title: pctText(drawdown),
      note: `Max drawdown; exposure ${pctText(periodPerf.max_gross_exposure_pct)}.`,
      className: drawdownValueClass(drawdown),
    },
  ];
  const lines = [
    {
      status: source.has_data ? "ok" : "bad",
      title: "Source",
      detail: `${text(source.label)} / ${text(mode || "n/a")} / ${window.label}. Latest account snapshot ${latestAccount.timestamp ? shortTimestampAgeLabel(latestAccount.timestamp) : "n/a"}.`,
    },
    {
      status: equity === null ? "warn" : "ok",
      title: "Equity And Return",
      detail: `Equity ${money(equity)}; today ${pctText(todayReturn)}, recent ${pctText(recentReturn)}, month ${pctText(monthReturn)}, all available ${pctText(allReturn)}.`,
    },
    {
      status: drawdown === null ? "warn" : drawdown <= -10 ? "bad" : drawdown < 0 ? "warn" : "ok",
      title: "Risk",
      detail: `Max drawdown ${pctText(drawdown)}, max exposure ${pctText(periodPerf.max_gross_exposure_pct)}, turnover ${money(turnover.notional)} over ${window.label}.`,
    },
    {
      status: ledger.stats.closed_count ? "ok" : fills.length ? "warn" : source.has_data ? "warn" : "bad",
      title: "Trades",
      detail: `${numberText(fillCount, 0)} fills, ${numberText(ledger.stats.closed_count, 0)} closed trades, ${numberText(ledger.stats.open_count, 0)} open trade rows, ${numberText(positionCount, 0)} open positions.`,
    },
    {
      status: issueCount ? "warn" : source.has_data ? "ok" : "bad",
      title: "Execution",
      detail: `${numberText(decisions, 0)} decisions, ${numberText(orders, 0)} orders, ${numberText(rejections, 0)} rejections, ${numberText(approvalRequired, 0)} approval holds.`,
    },
    {
      status: hasCurrentRollups || hasSnapshots ? "ok" : "warn",
      title: "Evidence",
      detail: `${numberText(rollups.length, 0)} status-history day rows and ${numberText((allAccountRows || []).length, 0)} account snapshots are available for charts and rollups.`,
    },
  ];
  const nextAction = issueCount
    ? "Review orders and rejections before judging strategy quality."
    : source.has_data && !hasCurrentRollups
      ? "Keep the status publisher running so paper/live daily history accumulates."
      : source.has_data
        ? "Use Rollups for period history and Trades for fill-level behavior."
        : "Load telemetry, a saved run, or Workbench artifacts.";
  lines.push({
    status: issueCount ? "warn" : source.has_data ? "ok" : "bad",
    title: "Next Action",
    detail: nextAction,
  });
  return {
    status,
    headline,
    note: `${text(source.label)} / ${text(mode || "n/a")} / ${window.label}`,
    cards,
    lines,
  };
}

function performanceReportText(model) {
  const lines = [
    `Current Strategy Report: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ];
  return lines.join("\n");
}

function renderPerformanceReport(context) {
  if (!$("performance-report-note") || !$("performance-report-cards") || !$("performance-report-body") || !$("performance-report-actions")) return;
  const model = performanceReportModel(context);
  state.performanceReportText = performanceReportText(model);
  $("performance-report-note").textContent = model.note;
  $("performance-report-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className || statusClass(card.status))}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("performance-report-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("performance-report-actions").innerHTML = [
    `<button type="button" data-performance-report-action="copy">Copy Report</button>`,
    `<button type="button" class="secondary" data-performance-report-action="rollups">Open Rollups</button>`,
    `<button type="button" class="secondary" data-performance-report-action="trades">Open Trades</button>`,
    `<button type="button" class="secondary" data-performance-report-action="operations">Check Operations</button>`,
  ].join("");
}

function handlePerformanceReportAction(action) {
  if (action === "copy") {
    copyText(state.performanceReportText || "No current strategy report loaded").then(() => {
      $("last-refresh").textContent = "Current strategy report copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Report copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "rollups") {
    navigateToPerformanceLens("rollups");
    return;
  }
  if (action === "trades") {
    navigateToPerformanceLens("trades");
    return;
  }
  navigateToOperationsLens("paper");
}

function performanceEvidenceModel(context) {
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
  const rollups = sortedStatusRollups();
  const periodRollups = (state.statusEquityRollups && state.statusEquityRollups.period_rollups) || {};
  const latestRollup = rollups.length ? rollups[rollups.length - 1] : null;
  const benchmark = state.performanceBenchmarkDetail || {};
  const timestamp = sourceTimestamp(source, latestAccount);
  const issueCount = Number(rejections || 0) + Number(approvalRequired || 0);
  const accountCount = Number((allAccountRows || []).length || 0);
  const windowAccountCount = Number((accountRows || []).length || 0);
  const closedTradeCount = Number((ledger.stats || {}).closed_count || 0);
  const statusPeriodCount = Number((periodRollups.month || []).length || 0) + Number((periodRollups.year || []).length || 0);
  let headlineStatus = "idle";
  let headline = "No evidence chain";
  let note = "Publish telemetry, load a saved run, or open Workbench artifacts before trusting performance metrics.";
  if (source.has_data && windowAccountCount) {
    headlineStatus = issueCount ? "warn" : "ok";
    headline = "Account-backed result";
    note = `${numberText(windowAccountCount, 0)} account snapshots support ${window.label}; charts and drawdown are evidence-backed.`;
  } else if (source.has_data && accountCount) {
    headlineStatus = "warn";
    headline = "Account-backed source, empty window";
    note = "The selected source has account snapshots, but the current period filter excludes them.";
  } else if (source.has_data && (fillCount || orders || decisions)) {
    headlineStatus = "warn";
    headline = "Event-backed summary";
    note = "Events exist, but account snapshots are missing or unavailable for this selected source.";
  } else if (source.has_data) {
    headlineStatus = "warn";
    headline = "Summary-only result";
    note = "A summary is loaded without enough account, fill, or decision evidence for full verification.";
  } else if (rollups.length) {
    headlineStatus = "warn";
    headline = "Rollups only";
    note = "Live/paper status-history rollups exist, but no selected source is loaded.";
  }
  const cards = [
    {
      label: "Evidence Chain",
      status: headlineStatus,
      title: headline,
      note,
      className: statusClass(headlineStatus),
    },
    {
      label: "Selected Source",
      status: source.has_data ? "ok" : "bad",
      title: text(source.source_type || "none"),
      note: `${text(source.label)}; mode ${text(mode || "n/a")}; updated ${timestamp ? shortTimestampAgeLabel(timestamp) : "n/a"}.`,
      className: statusClass(source.has_data ? "ok" : "idle"),
    },
    {
      label: "Account Path",
      status: windowAccountCount ? "ok" : accountCount ? "warn" : "bad",
      title: windowAccountCount ? `${numberText(windowAccountCount, 0)} in window` : `${numberText(accountCount, 0)} total`,
      note: latestAccount.timestamp ? `Latest account ${timestampAgeLabel(latestAccount.timestamp)}.` : "No account snapshot timestamp.",
      className: statusClass(windowAccountCount ? "ok" : accountCount ? "warn" : "idle"),
    },
    {
      label: "Execution Rows",
      status: issueCount ? "warn" : fillCount ? "ok" : source.has_data ? "warn" : "bad",
      title: `${numberText(fillCount, 0)} fills`,
      note: `${numberText(decisions, 0)} decisions / ${numberText(orders, 0)} orders / ${numberText(rejections, 0)} rejects / ${numberText(approvalRequired, 0)} approvals.`,
      className: statusClass(issueCount ? "warn" : fillCount ? "ok" : source.has_data ? "warn" : "idle"),
    },
    {
      label: "Status Rollups",
      status: rollups.length ? "ok" : source.has_data ? "warn" : "idle",
      title: `${numberText(rollups.length, 0)} day rows`,
      note: latestRollup
        ? `Latest ${text(latestRollup.day)} ${text(latestRollup.node_id)} return ${pctText(latestRollup.daily_return_pct)}; ${numberText(statusPeriodCount, 0)} period rows.`
        : "No persisted live/paper status-history rollups loaded.",
      className: latestRollup ? rollupReturnClass(latestRollup.daily_return_pct) : statusClass(source.has_data ? "warn" : "idle"),
    },
    {
      label: "Benchmark",
      status: benchmark.path ? "ok" : source.has_data ? "warn" : "idle",
      title: benchmark.path ? text(benchmark.symbol) : "Not loaded",
      note: benchmark.path
        ? `${text(benchmark.bar_size)} ${text(benchmark.source)} overlay is available.`
        : "No market-context saved dataset is loaded for this result.",
      className: statusClass(benchmark.path ? "ok" : source.has_data ? "warn" : "idle"),
    },
  ];
  const lines = [
    {
      status: source.has_data ? "ok" : "bad",
      title: "Source Authority",
      detail: `${sourceMeaning(source)} Selected mode is ${text(mode || "n/a")}; source label is ${text(source.label)}.`,
    },
    {
      status: windowAccountCount ? "ok" : accountCount ? "warn" : "bad",
      title: "Account Evidence",
      detail: `${numberText(windowAccountCount, 0)} account snapshots in ${window.label}; ${numberText(accountCount, 0)} total account snapshots available. Latest ${latestAccount.timestamp ? text(latestAccount.timestamp) : "n/a"}.`,
    },
    {
      status: finiteNumber(periodPerf.total_return_pct) === null ? "warn" : finiteNumber(periodPerf.total_return_pct) >= 0 ? "ok" : "bad",
      title: "Return Evidence",
      detail: `Selected-window return ${pctText(periodPerf.total_return_pct)}, drawdown ${pctText(periodPerf.max_drawdown_pct)}, elapsed ${periodPerf.elapsed_days === undefined || periodPerf.elapsed_days === null ? "n/a" : `${numberText(periodPerf.elapsed_days, 4)} days`}.`,
    },
    {
      status: closedTradeCount ? "ok" : fills.length ? "warn" : source.has_data ? "warn" : "bad",
      title: "Trade Evidence",
      detail: `${numberText(fills.length, 0)} fills in selected window; ${numberText(closedTradeCount, 0)} closed trades and ${numberText((ledger.stats || {}).open_count || 0, 0)} open trade rows after pairing.`,
    },
    {
      status: issueCount ? "warn" : source.has_data ? "ok" : "idle",
      title: "Execution Issues",
      detail: issueCount
        ? `${numberText(rejections, 0)} rejections and ${numberText(approvalRequired, 0)} approval holds need order-level review.`
        : "No rejected orders or approval holds are visible in the selected performance source.",
    },
    {
      status: rollups.length ? "ok" : "warn",
      title: "Persistence",
      detail: rollups.length
        ? `${numberText(rollups.length, 0)} persisted status-history day rows are available independent of a currently open run.`
        : "No persisted status-history day rows are available; current performance may depend on loaded artifacts only.",
    },
    {
      status: benchmark.path ? "ok" : source.has_data ? "warn" : "idle",
      title: "Benchmark Context",
      detail: benchmark.path
        ? `Benchmark ${text(benchmark.symbol)} from ${text(benchmark.path)} is loaded for normalized-return overlay.`
        : "No benchmark is loaded; absolute strategy return has no market-context overlay.",
    },
  ];
  const next = issueCount
    ? { label: "Review Orders", href: "#runs/state", status: "warn" }
    : !windowAccountCount && accountCount
      ? { label: "Change Period", href: "#performance", status: "warn" }
      : !source.has_data
        ? { label: "Open Runs", href: "#runs", status: "bad" }
        : !benchmark.path
          ? { label: "Load Benchmark", href: "#data/browse", status: "warn" }
          : { label: "Inspect Trades", href: "#performance/trades", status: "ok" };
  lines.push({
    status: next.status,
    title: "Next Verification",
    detail: `${next.label}: ${next.href.replace("#", "")}.`,
  });
  return {
    headline,
    note: `${text(source.label)} / ${window.label}`,
    cards,
    lines,
    next,
  };
}

function performanceEvidenceText(model) {
  return [
    `Performance Evidence: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

function renderPerformanceEvidence(context) {
  if (!$("performance-evidence-note") || !$("performance-evidence-cards") || !$("performance-evidence-body") || !$("performance-evidence-actions")) return;
  const model = performanceEvidenceModel(context);
  state.performanceEvidenceText = performanceEvidenceText(model);
  $("performance-evidence-note").textContent = model.note;
  $("performance-evidence-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className || statusClass(card.status))}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("performance-evidence-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("performance-evidence-actions").innerHTML = [
    `<button type="button" data-performance-evidence-action="copy">Copy Evidence</button>`,
    `<a class="secondary" href="${escapeHtml(model.next.href)}">${escapeHtml(model.next.label)}</a>`,
    `<a class="secondary" href="#performance/rollups">Rollups</a>`,
    `<a class="secondary" href="#runs/events">Events</a>`,
  ].join("");
}

function handlePerformanceEvidenceAction(action) {
  if (action !== "copy") return;
  copyText(state.performanceEvidenceText || "No performance evidence loaded").then(() => {
    $("last-refresh").textContent = "Performance evidence copied";
  }).catch((err) => {
    $("last-refresh").textContent = `Performance evidence copy failed: ${err.message}`;
  });
}

function performanceSnapshotReturnCard({ label, value, detail, source }) {
  const numeric = finiteNumber(value);
  return {
    status: numeric === null ? "warn" : numeric >= 0 ? "ok" : "bad",
    className: signedValueClass(numeric),
    label,
    title: pctText(numeric),
    note: `${detail} Source: ${source}.`,
  };
}

function performanceSnapshotModel(context) {
  const {
    source,
    allAccountRows,
    periodPerf,
    mode,
    rejections,
    approvalRequired,
  } = context;
  const payload = state.statusEquityRollups || {};
  const rollups = sortedStatusRollups();
  const periodRollups = payload.period_rollups || {};
  const latestDay = rollups.length ? rollups[rollups.length - 1] : null;
  const weekStats = statusRollupSeriesStats(trailingStatusRollups(rollups, 7));
  const allStatusStats = statusRollupSeriesStats(rollups);
  const latestMonth = ((periodRollups.month || [])[0]) || null;
  const latestYear = ((periodRollups.year || [])[0]) || null;
  const todayRows = rowsInWindow(allAccountRows || [], performancePeriodWindow(allAccountRows || [], "today"));
  const weekRows = rowsInWindow(allAccountRows || [], performancePeriodWindow(allAccountRows || [], "week"));
  const monthRows = rowsInWindow(allAccountRows || [], performancePeriodWindow(allAccountRows || [], "month"));
  const todayPerf = performanceFromAccountRows(todayRows);
  const weekPerf = performanceFromAccountRows(weekRows);
  const monthPerf = performanceFromAccountRows(monthRows);
  const allAccountPerf = performanceFromAccountRows(allAccountRows || []);
  const todayValue = latestDay && finiteNumber(latestDay.daily_return_pct) !== null
    ? latestDay.daily_return_pct
    : todayPerf.total_return_pct;
  const todayDetail = latestDay && finiteNumber(latestDay.daily_return_pct) !== null
    ? `${text(latestDay.day)} ${money(latestDay.start_equity)} to ${money(latestDay.end_equity)}; ${numberText(latestDay.snapshot_count, 0)} status snapshots.`
    : todayRows.length
      ? `${numberText(todayRows.length, 0)} account snapshots in the current-day window.`
      : "No current-day status or account path is loaded.";
  const weekValue = finiteNumber(weekStats.total_return_pct) !== null
    ? weekStats.total_return_pct
    : weekPerf.total_return_pct;
  const weekDetail = finiteNumber(weekStats.total_return_pct) !== null
    ? `${text(weekStats.first_day)} to ${text(weekStats.last_day)} from trailing status days.`
    : weekRows.length
      ? `${numberText(weekRows.length, 0)} account snapshots in the trailing-week window.`
      : "No trailing-week equity path is loaded.";
  const monthValue = latestMonth && finiteNumber(latestMonth.total_return_pct) !== null
    ? latestMonth.total_return_pct
    : monthPerf.total_return_pct;
  const monthDetail = latestMonth && finiteNumber(latestMonth.total_return_pct) !== null
    ? `${text(latestMonth.label)}; ${numberText(latestMonth.day_count, 0)} day rows / ${numberText(latestMonth.snapshot_count, 0)} snapshots.`
    : monthRows.length
      ? `${numberText(monthRows.length, 0)} account snapshots in the trailing-month window.`
      : "No monthly status rollup or trailing-month account path is loaded.";
  const yearValue = latestYear && finiteNumber(latestYear.total_return_pct) !== null
    ? latestYear.total_return_pct
    : null;
  const yearDetail = latestYear && finiteNumber(latestYear.total_return_pct) !== null
    ? `${text(latestYear.label)}; ${numberText(latestYear.day_count, 0)} day rows / ${numberText(latestYear.snapshot_count, 0)} snapshots.`
    : "No yearly status-history rollup is loaded yet.";
  const allValue = finiteNumber(allStatusStats.total_return_pct) !== null
    ? allStatusStats.total_return_pct
    : finiteNumber(periodPerf.total_return_pct) !== null
      ? periodPerf.total_return_pct
      : allAccountPerf.total_return_pct;
  const allDetail = finiteNumber(allStatusStats.total_return_pct) !== null
    ? `${text(allStatusStats.first_day)} to ${text(allStatusStats.last_day)} from status-history equity.`
    : allAccountRows && allAccountRows.length
      ? `${numberText(allAccountRows.length, 0)} account snapshots in the selected source.`
      : "No all-available equity path is loaded.";
  const drawdownValue = finiteNumber(allStatusStats.max_drawdown_pct) !== null
    ? allStatusStats.max_drawdown_pct
    : finiteNumber(periodPerf.max_drawdown_pct) !== null
      ? periodPerf.max_drawdown_pct
      : allAccountPerf.max_drawdown_pct;
  const drawdownSource = finiteNumber(allStatusStats.max_drawdown_pct) !== null
    ? "status-history rollups"
    : allAccountRows && allAccountRows.length ? "selected account snapshots" : "unavailable";
  const cards = [
    performanceSnapshotReturnCard({
      label: "Today",
      value: todayValue,
      detail: todayDetail,
      source: latestDay && finiteNumber(latestDay.daily_return_pct) !== null ? "status-history latest day" : "selected account snapshots",
    }),
    performanceSnapshotReturnCard({
      label: "Recent",
      value: weekValue,
      detail: weekDetail,
      source: finiteNumber(weekStats.total_return_pct) !== null ? "status-history trailing 7 days" : "selected account snapshots",
    }),
    performanceSnapshotReturnCard({
      label: "Month",
      value: monthValue,
      detail: monthDetail,
      source: latestMonth && finiteNumber(latestMonth.total_return_pct) !== null ? "status-history month rollup" : "selected account snapshots",
    }),
    performanceSnapshotReturnCard({
      label: "Year",
      value: yearValue,
      detail: yearDetail,
      source: latestYear && finiteNumber(latestYear.total_return_pct) !== null ? "status-history year rollup" : "unavailable",
    }),
    performanceSnapshotReturnCard({
      label: "All Available",
      value: allValue,
      detail: allDetail,
      source: finiteNumber(allStatusStats.total_return_pct) !== null ? "status-history all days" : "selected source",
    }),
    {
      status: drawdownValue === null ? "warn" : drawdownValue <= -10 ? "bad" : drawdownValue < 0 ? "warn" : "ok",
      className: drawdownValueClass(drawdownValue),
      label: "Max Drawdown",
      title: pctText(drawdownValue),
      note: `Peak-to-current equity loss. Source: ${drawdownSource}.`,
    },
    {
      status: Number(rejections || 0) || Number(approvalRequired || 0) ? "warn" : source.has_data ? "ok" : "idle",
      className: statusClass(Number(rejections || 0) || Number(approvalRequired || 0) ? "warn" : source.has_data ? "ok" : "idle"),
      label: "Readiness",
      title: source.has_data ? text(mode || "loaded") : "No Source",
      note: source.has_data
        ? `${numberText(rejections, 0)} rejects / ${numberText(approvalRequired, 0)} approval holds visible for this source.`
        : "Publish telemetry or load run artifacts before reading performance.",
    },
  ];
  const readyCount = cards.filter((card) => card.status === "ok").length;
  const headline = rollups.length
    ? `${numberText(rollups.length, 0)} status-history day row${rollups.length === 1 ? "" : "s"}`
    : allAccountRows && allAccountRows.length
      ? `${numberText(allAccountRows.length, 0)} account snapshot${allAccountRows.length === 1 ? "" : "s"}`
      : "no equity path";
  return {
    note: `${headline}; ${readyCount} of ${cards.length} snapshot cards are green`,
    cards,
  };
}

function renderPerformanceSnapshot(context) {
  if (!$("performance-snapshot-note") || !$("performance-snapshot-cards") || !$("performance-snapshot-actions")) return;
  const model = performanceSnapshotModel(context);
  $("performance-snapshot-note").textContent = model.note;
  $("performance-snapshot-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className || statusClass(card.status))}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("performance-snapshot-actions").innerHTML = [
    `<button type="button" data-performance-snapshot-action="rollups">Open Rollups</button>`,
    `<button type="button" class="secondary" data-performance-snapshot-action="trades">Open Trades</button>`,
    `<button type="button" class="secondary" data-performance-snapshot-action="runs">Open Runs</button>`,
    `<button type="button" class="secondary" data-performance-snapshot-action="benchmark">Load Benchmark</button>`,
  ].join("");
}

function handlePerformanceSnapshotAction(action) {
  if (action === "rollups") {
    navigateToPerformanceLens("rollups");
    return;
  }
  if (action === "trades") {
    navigateToPerformanceLens("trades");
    return;
  }
  if (action === "runs") {
    navigateToRunsLens("runs");
    return;
  }
  if ($("performance-load-benchmark")) $("performance-load-benchmark").click();
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
      status: executionIssueCount ? "warn" : hasTradeEvidence ? "ok" : source.has_data ? "warn" : "idle",
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
      status: benchmark.path ? "ok" : datasets.length && source.has_data ? "warn" : "idle",
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
  renderPerformanceRollupContinuity();
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

function dayMillis(day) {
  if (!day) return null;
  return timestampMillis(`${day}T00:00:00Z`);
}

function calendarDayCount(firstDay, lastDay) {
  const firstMillis = dayMillis(firstDay);
  const lastMillis = dayMillis(lastDay);
  if (firstMillis === null || lastMillis === null || lastMillis < firstMillis) return null;
  return Math.floor((lastMillis - firstMillis) / 86400000) + 1;
}

function statusRollupContinuityModel() {
  const statusPayload = state.statusEquityRollups || {};
  const statusRows = sortedStatusRollups();
  const archivedPayload = state.performanceRollups || {};
  const archivedRows = archivedPayload.rollups || [];
  const statusPeriodRows = performancePeriodRows(statusPayload);
  const archivedPeriodRows = performancePeriodRows(archivedPayload);
  const dayRows = statusRows.filter((item) => dayMillis(item.day) !== null);
  const uniqueDays = Array.from(new Set(dayRows.map((item) => item.day))).sort();
  const firstDay = uniqueDays[0] || "";
  const lastDay = uniqueDays[uniqueDays.length - 1] || "";
  const calendarDays = calendarDayCount(firstDay, lastDay);
  const missingDays = calendarDays === null ? null : Math.max(0, calendarDays - uniqueDays.length);
  const latest = latestRollupRow(statusRows);
  const latestTimestamp = latest && (latest.account_end_time || latest.day);
  const latestMillis = latestTimestamp ? timestampMillis(latestTimestamp) : null;
  const latestAgeHours = latestMillis === null ? null : (Date.now() - latestMillis) / 3600000;
  const stale = latestAgeHours !== null && latestAgeHours > 36;
  const veryStale = latestAgeHours !== null && latestAgeHours > 96;
  const nodes = Array.from(new Set(statusRows.map((item) => text(item.node_id)).filter((item) => item !== "n/a"))).sort();
  const modes = Array.from(new Set(statusRows.map((item) => text(item.mode)).filter((item) => item !== "n/a"))).sort();
  const snapshotCount = statusRows.reduce((sum, item) => sum + Number(item.snapshot_count || 0), 0);
  const snapshotDensity = uniqueDays.length ? snapshotCount / uniqueDays.length : null;
  const alertCount = statusRows.reduce((sum, item) => sum + Number(item.alert_count || 0), 0);
  const rejectionCount = statusRows.reduce((sum, item) => sum + Number(item.rejection_count || 0), 0);
  const gatewayDownCount = statusRows.filter((item) => item.gateway_reachable === false).length;
  const sourceStatus = statusRows.length
    ? veryStale || gatewayDownCount ? "bad" : stale || missingDays || alertCount || rejectionCount ? "warn" : "ok"
    : archivedRows.length ? "warn" : "bad";
  const headline = statusRows.length
    ? sourceStatus === "ok"
      ? "Live/paper rollup continuity looks usable"
      : sourceStatus === "bad"
        ? "Live/paper rollup continuity needs review"
        : "Live/paper rollup continuity is partial"
    : archivedRows.length
      ? "Only archived run rollups are loaded"
      : "No rollup continuity evidence loaded";
  const note = statusRows.length
    ? `${numberText(statusRows.length, 0)} status day row${statusRows.length === 1 ? "" : "s"} across ${numberText(uniqueDays.length, 0)} observed day${uniqueDays.length === 1 ? "" : "s"}; latest ${latestTimestamp ? timestampAgeLabel(latestTimestamp) : "n/a"}.`
    : archivedRows.length
      ? "Archived run rollups can explain saved simulations, but they do not prove current paper/live continuity."
      : "Run status publishing during paper/live sessions or load run artifacts before relying on period performance.";
  const cards = [
    {
      status: sourceStatus,
      label: "Continuity",
      title: statusRows.length ? `${numberText(uniqueDays.length, 0)} days` : "Missing",
      note: calendarDays === null
        ? "No status-history day range is available."
        : `${rangeLabel(firstDay, lastDay)}; ${numberText(missingDays, 0)} missing calendar day${missingDays === 1 ? "" : "s"} inside the range.`,
    },
    {
      status: latest ? veryStale ? "bad" : stale ? "warn" : "ok" : "idle",
      label: "Latest Status",
      title: latestTimestamp ? timestampAgeLabel(latestTimestamp) : "n/a",
      note: latest ? `${text(latest.node_id)} / ${text(latest.mode)} / ${text(latest.day)}.` : "No live/paper status day row is loaded.",
    },
    {
      status: snapshotDensity === null ? "bad" : snapshotDensity >= 4 ? "ok" : "warn",
      label: "Snapshot Density",
      title: snapshotDensity === null ? "n/a" : `${numberText(snapshotDensity, 1)} / day`,
      note: `${numberText(snapshotCount, 0)} total status snapshot${snapshotCount === 1 ? "" : "s"} across observed days.`,
    },
    {
      status: nodes.length > 1 || modes.length > 1 ? "warn" : statusRows.length ? "ok" : "bad",
      label: "Node / Mode Mix",
      title: `${numberText(nodes.length, 0)} node${nodes.length === 1 ? "" : "s"}`,
      note: `${nodes.slice(0, 3).join(", ") || "none"}${nodes.length > 3 ? "..." : ""}; modes ${modes.slice(0, 4).join(", ") || "none"}.`,
    },
    {
      status: rejectionCount || alertCount || gatewayDownCount ? "warn" : statusRows.length ? "ok" : "bad",
      label: "Issues",
      title: `${numberText(rejectionCount, 0)} rejects`,
      note: `${numberText(alertCount, 0)} alerts / ${numberText(gatewayDownCount, 0)} Gateway-down day row${gatewayDownCount === 1 ? "" : "s"}.`,
    },
    {
      status: archivedRows.length || archivedPeriodRows.length ? "ok" : statusRows.length ? "warn" : "bad",
      label: "Archived Backup",
      title: `${numberText(archivedRows.length, 0)} days`,
      note: `${numberText(archivedPeriodRows.length, 0)} archived month/year period row${archivedPeriodRows.length === 1 ? "" : "s"} loaded.`,
    },
  ];
  const lines = [
    {
      status: statusRows.length ? "ok" : archivedRows.length ? "warn" : "bad",
      title: "What This Proves",
      detail: statusRows.length
        ? "Status rollups come from persisted sanitized status-history snapshots, so they can answer current paper/live daily and period performance without an open artifact."
        : archivedRows.length ? "Archived run rollups explain saved replay/simulation artifacts, but current paper/live continuity is missing." : "There is no persisted rollup evidence for current or archived performance.",
    },
    {
      status: latest ? veryStale ? "bad" : stale ? "warn" : "ok" : "idle",
      title: "Freshness",
      detail: latestTimestamp
        ? `Latest status rollup timestamp is ${timestampAgeLabel(latestTimestamp)} from ${text(latestTimestamp)}.`
        : "No latest status rollup timestamp is available.",
    },
    {
      status: missingDays ? "warn" : statusRows.length ? "ok" : "bad",
      title: "Calendar Coverage",
      detail: calendarDays === null
        ? "No rollup calendar range can be computed."
        : `${numberText(uniqueDays.length, 0)} observed day${uniqueDays.length === 1 ? "" : "s"} out of ${numberText(calendarDays, 0)} calendar day${calendarDays === 1 ? "" : "s"} from ${rangeLabel(firstDay, lastDay)}.`,
    },
    {
      status: snapshotDensity === null ? "bad" : snapshotDensity >= 4 ? "ok" : "warn",
      title: "Snapshot Density",
      detail: snapshotDensity === null
        ? "No status snapshots were summarized into day rows."
        : `${numberText(snapshotCount, 0)} snapshots produce an average of ${numberText(snapshotDensity, 1)} snapshot${snapshotDensity === 1 ? "" : "s"} per observed day.`,
    },
    {
      status: rejectionCount || alertCount || gatewayDownCount ? "warn" : statusRows.length ? "ok" : "bad",
      title: "Execution Caveats",
      detail: `${numberText(rejectionCount, 0)} observed rejects, ${numberText(alertCount, 0)} alerts, and ${numberText(gatewayDownCount, 0)} Gateway-down day rows are present in status rollups.`,
    },
    {
      status: sourceStatus,
      title: "Next Action",
      detail: sourceStatus === "ok"
        ? "Use the status day and period tables below for paper/live continuity, then inspect Trades or Runs if a day looks surprising."
        : statusRows.length ? "Review the stale/gap/issue cards, export the status CSV if needed, and check Operations for publisher or Gateway gaps." : "Start status publishing during paper/live sessions or load saved artifacts before relying on period stats.",
    },
  ];
  return {
    status: sourceStatus,
    headline,
    note,
    cards,
    lines,
    statusRows,
    statusPeriodRows,
    archivedRows,
    archivedPeriodRows,
  };
}

function performanceRollupContinuityText(model) {
  return [
    `Status Rollup Continuity: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

function renderPerformanceRollupContinuity() {
  if (
    !$("performance-rollup-continuity-note")
    || !$("performance-rollup-continuity-cards")
    || !$("performance-rollup-continuity-body")
    || !$("performance-rollup-continuity-actions")
  ) return;
  const model = statusRollupContinuityModel();
  state.performanceRollupContinuityText = performanceRollupContinuityText(model);
  $("performance-rollup-continuity-note").textContent = model.note;
  $("performance-rollup-continuity-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("performance-rollup-continuity-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("performance-rollup-continuity-actions").innerHTML = [
    `<button type="button" data-performance-rollup-continuity-action="copy">Copy Continuity</button>`,
    `<button type="button" class="secondary" data-performance-rollup-continuity-action="status">Status Rows</button>`,
    `<button type="button" class="secondary" data-performance-rollup-continuity-action="periods">Periods</button>`,
    `<button type="button" class="secondary" data-performance-rollup-continuity-action="archived">Archived</button>`,
    `<button type="button" class="secondary" data-performance-rollup-continuity-action="operations">Operations</button>`,
    `<button type="button" class="secondary" data-performance-rollup-continuity-action="export">Export CSV</button>`,
  ].join("");
}

function handlePerformanceRollupContinuityAction(action) {
  if (action === "copy") {
    copyText(state.performanceRollupContinuityText || "No rollup continuity report loaded").then(() => {
      $("last-refresh").textContent = "Rollup continuity report copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Rollup continuity copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "status") {
    $("performance-status-rollups-body").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Reviewing status rollup rows";
    return;
  }
  if (action === "periods") {
    const statusPeriodRows = performancePeriodRows(state.statusEquityRollups || {});
    const target = statusPeriodRows.length ? "performance-status-period-rollups-body" : "performance-period-rollups-body";
    $(target).scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Reviewing rollup period rows";
    return;
  }
  if (action === "archived") {
    $("performance-rollups-body").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Reviewing archived rollup rows";
    return;
  }
  if (action === "operations") {
    navigateToOperationsLens("paper");
    return;
  }
  downloadStatusRollupsCsv().catch((err) => {
    $("last-refresh").textContent = `Status rollups CSV export failed: ${err.message}`;
  });
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

async function reloadTelemetryArtifacts() {
  const run = selectedTelemetryRun();
  const runId = run && run.id ? String(run.id) : "";
  if (!runId) {
    state.telemetryAccount = { run_id: "", account: [], decisions: [], orders: [], fills: [], performance: {} };
    renderAll();
    return;
  }
  const result = await fetchOptionalJson(
    "telemetry account",
    `/telemetry_run_artifacts?run_id=${encodeURIComponent(runId)}&limit=500`,
    { account: [], decisions: [], orders: [], fills: [], performance: {} },
  );
  const payload = result.payload || {};
  state.telemetryAccount = {
    run_id: runId,
    account: payload.account || [],
    decisions: payload.decisions || [],
    orders: payload.orders || [],
    fills: payload.fills || [],
    performance: payload.performance || {},
  };
  renderAll();
}

function focusPerformanceDay(day) {
  const select = $("performance-period");
  if (!select || !day) return;
  const value = `day:${day}`;
  let option = select.querySelector('option[data-day-focus="1"]');
  if (!option) {
    option = document.createElement("option");
    option.dataset.dayFocus = "1";
    select.appendChild(option);
  }
  option.value = value;
  option.textContent = `Day ${day}`;
  select.value = value;
  renderPerformance();
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
        `<button type="button" class="secondary rollup-day-focus" data-day="${escapeHtml(item.day)}" title="Focus charts, KPIs, and trades on this day">${escapeHtml(item.day)}</button>`,
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
  if ($("performance-status-period-chart")) {
    $("performance-status-period-chart").innerHTML = periodReturnBarChart(periodRows);
  }
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

function closedTradesByExit(tradeRows) {
  return (tradeRows || [])
    .filter((trade) => trade.state === "closed" && finiteNumber(trade.pnl) !== null && trade.exit_time)
    .sort((a, b) => String(a.exit_time).localeCompare(String(b.exit_time)));
}

function tradeCumulativePnlChart(tradeRows) {
  const ordered = closedTradesByExit(tradeRows);
  if (ordered.length < 2) return emptyChart("Need two or more closed trades for a realized PnL curve");
  let running = 0;
  const points = ordered.map((trade) => {
    running += Number(trade.pnl);
    return { timestamp: trade.exit_time, value: running };
  });
  return scalarLineChart(points, {
    label: "cumulative realized PnL",
    empty: "Need two or more closed trades for a realized PnL curve",
    className: points[points.length - 1].value >= 0 ? "spark-good" : "spark-bad",
    valueFormatter: money,
  });
}

function tradePnlBarChart(tradeRows) {
  const ordered = closedTradesByExit(tradeRows);
  if (!ordered.length) return emptyChart("No closed trades in the selected window");
  const width = 720;
  const height = 180;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...ordered.map((trade) => Math.abs(Number(trade.pnl))));
  const barGap = 3;
  const barWidth = Math.max(2, (width - padding * 2 - barGap * Math.max(0, ordered.length - 1)) / ordered.length);
  const axisY = height / 2;
  const bars = ordered.map((trade, index) => {
    const value = Number(trade.pnl);
    const magnitude = (Math.abs(value) / maxAbs) * (height / 2 - padding);
    const x = padding + index * (barWidth + barGap);
    const y = value >= 0 ? axisY - magnitude : axisY;
    const cls = value >= 0 ? "return-bar-good" : "return-bar-bad";
    const label = `${text(trade.symbol)} ${text(trade.side)} ${money(value)} (${String(trade.exit_time).slice(0, 10)})`;
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(label)}</title></rect>`;
  }).join("");
  const best = ordered.reduce((acc, trade) => (Number(trade.pnl) > Number(acc.pnl) ? trade : acc), ordered[0]);
  const worst = ordered.reduce((acc, trade) => (Number(trade.pnl) < Number(acc.pnl) ? trade : acc), ordered[0]);
  const caption = `best ${text(best.symbol)} ${money(best.pnl)} / worst ${text(worst.symbol)} ${money(worst.pnl)}`;
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="per-trade realized PnL bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function equitySparkline(accountRows) {
  const values = (accountRows || []).map((row) => Number(row.equity)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return "";
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 360;
  const height = 56;
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cls = values[values.length - 1] >= values[0] ? "spark-good" : "spark-bad";
  return `<svg class="sparkline hero-spark ${cls}" viewBox="0 0 ${width} ${height}" preserveAspectRatio="none" role="img" aria-label="selected-source equity history"><polyline points="${coords}"></polyline></svg>`;
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

function eventTimelineChart(events) {
  const rows = (events || [])
    .map((event) => ({ ...event, millis: timestampMillis(event.timestamp) }))
    .filter((event) => event.millis !== null);
  if (!rows.length) return emptyChart("No events in the current filter window");
  const minMillis = Math.min(...rows.map((event) => event.millis));
  const maxMillis = Math.max(...rows.map((event) => event.millis));
  const hourMs = 60 * 60 * 1000;
  const daily = maxMillis - minMillis > 48 * hourMs;
  const bucketMs = daily ? 24 * hourMs : hourMs;
  const buckets = new Map();
  for (const event of rows) {
    const key = Math.floor(event.millis / bucketMs) * bucketMs;
    if (!buckets.has(key)) buckets.set(key, { decision: 0, order: 0, fill: 0, bad: 0 });
    const bucket = buckets.get(key);
    if (eventStatusIsBad(event)) bucket.bad += 1;
    else if (event.type === "fill") bucket.fill += 1;
    else if (event.type === "order") bucket.order += 1;
    else bucket.decision += 1;
  }
  const ordered = Array.from(buckets.entries()).sort((a, b) => a[0] - b[0]);
  const width = 720;
  const height = 140;
  const padding = 12;
  const maxTotal = Math.max(1, ...ordered.map(([, b]) => b.decision + b.order + b.fill + b.bad));
  const barGap = 2;
  const barWidth = Math.min(48, Math.max(3, (width - padding * 2 - barGap * Math.max(0, ordered.length - 1)) / ordered.length));
  const groupWidth = ordered.length * barWidth + Math.max(0, ordered.length - 1) * barGap;
  const offset = Math.max(padding, (width - groupWidth) / 2);
  const scale = (height - padding * 2) / maxTotal;
  const segments = [["decision", "event-seg-decision"], ["order", "event-seg-order"], ["fill", "event-seg-fill"], ["bad", "event-seg-bad"]];
  const bars = ordered.map(([key, bucket], index) => {
    const x = offset + index * (barWidth + barGap);
    const label = daily ? new Date(key).toISOString().slice(0, 10) : new Date(key).toISOString().slice(0, 13) + ":00Z";
    const total = bucket.decision + bucket.order + bucket.fill + bucket.bad;
    let y = height - padding;
    const parts = segments.map(([kind, cls]) => {
      const count = bucket[kind];
      if (!count) return "";
      const segmentHeight = Math.max(1, count * scale);
      y -= segmentHeight;
      return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${segmentHeight.toFixed(1)}"><title>${escapeHtml(`${label}: ${count} ${kind === "bad" ? "rejected/issue" : kind} of ${total} events`)}</title></rect>`;
    }).join("");
    return parts;
  }).join("");
  const peak = ordered.reduce((acc, item) => {
    const total = item[1].decision + item[1].order + item[1].fill + item[1].bad;
    return total > acc.total ? { key: item[0], total } : acc;
  }, { key: ordered[0][0], total: 0 });
  const peakLabel = daily ? new Date(peak.key).toISOString().slice(0, 10) : new Date(peak.key).toISOString().slice(11, 16) + " UTC";
  const caption = `${numberText(ordered.length, 0)} ${daily ? "day" : "hour"} buckets; peak ${numberText(peak.total, 0)} events at ${peakLabel}`;
  const legend = `<div class="chart-legend event-timeline-legend"><span class="legend-item event-seg-decision"><span></span>decisions</span><span class="legend-item event-seg-order"><span></span>orders</span><span class="legend-item event-seg-fill"><span></span>fills</span><span class="legend-item event-seg-bad"><span></span>rejected/issues</span></div>`;
  return `<svg class="detail-chart event-timeline" viewBox="0 0 ${width} ${height}" role="img" aria-label="event density over time">${bars}</svg>${legend}<span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function periodReturnBarChart(periodRows) {
  const rows = (periodRows || [])
    .map((item) => ({ label: text(item.periodLabel || item.label), value: Number(item.total_return_pct) }))
    .filter((item) => Number.isFinite(item.value));
  if (!rows.length) return emptyChart("No period rollups available yet");
  const width = 720;
  const height = 160;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const barGap = 14;
  const barWidth = Math.min(90, Math.max(24, (width - padding * 2 - barGap * Math.max(0, rows.length - 1)) / rows.length));
  const axisY = height / 2;
  const groupWidth = rows.length * barWidth + Math.max(0, rows.length - 1) * barGap;
  const offset = Math.max(padding, (width - groupWidth) / 2);
  const bars = rows.map((item, index) => {
    const magnitude = (Math.abs(item.value) / maxAbs) * (height / 2 - padding);
    const x = offset + index * (barWidth + barGap);
    const y = item.value >= 0 ? axisY - magnitude : axisY;
    const cls = item.value >= 0 ? "return-bar-good" : "return-bar-bad";
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(`${item.label} ${pctText(item.value)}`)}</title></rect>`;
  }).join("");
  const caption = rows.map((item) => `${item.label} ${pctText(item.value)}`).join(" | ");
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="period return bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
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

