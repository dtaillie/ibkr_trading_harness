import {
  $,
  age,
  escapeHtml,
  money,
  normalizeView,
  numberText,
  pctText,
  renderTopbarStatusStrip,
  row,
  signedValueClass,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { latestArtifactPerformance, latestTelemetryRun, renderStrategyIdentity } from "./20_workbench_foundation.js";
import {
  eventStatusIsBad,
  finiteNumber,
  firstPresent,
  latestAccountRow,
  metricLatestRejection,
  metricTimestamp,
  normalizedRunMetrics,
  renderBackendPipeline,
  runtimeActivityModel,
  runtimeMarketDataModel,
  runtimeStatusItems,
  savedDataMetricModel,
  setMetricValue,
  shortTimestampAgeLabel,
  sourceMetaLabel,
  symbolInventoryModel,
  timestampAgeLabel,
  timestampMillis,
} from "./30_runtime_core.js";
import { nonzeroPositionsFromSource, performanceFromAccountRows, performancePeriodWindow, rowsInWindow } from "./31_performance_math.js";
import { emptyChart, equitySparkline, statusRollupReturnChart } from "./34_charts.js";
import { currentOpenOrderRows, runEventRows } from "./70_runs.js";
import { eventStatus, remoteRunArtifactEvidenceRows } from "./80_operations.js";

export function overviewHealthChecks() {
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

export function sortedStatusRollups() {
  const rollups = ((state.statusEquityRollups && state.statusEquityRollups.rollups) || []).slice();
  return rollups.sort((left, right) => {
    const leftKey = String(left.account_end_time || left.day || "");
    const rightKey = String(right.account_end_time || right.day || "");
    return leftKey.localeCompare(rightKey);
  });
}

export function statusRollupSeriesStats(rollups) {
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

export function trailingStatusRollups(rollups, days) {
  const rows = (rollups || []).filter((item) => item.day && timestampMillis(`${item.day}T00:00:00Z`) !== null);
  if (!rows.length) return [];
  const latestMillis = Math.max(...rows.map((item) => timestampMillis(`${item.day}T00:00:00Z`)));
  const cutoffMillis = latestMillis - Math.max(0, Number(days || 1) - 1) * 86400000;
  return rows.filter((item) => {
    const millis = timestampMillis(`${item.day}T00:00:00Z`);
    return millis !== null && millis >= cutoffMillis && millis <= latestMillis;
  }).sort((left, right) => String(left.day || "").localeCompare(String(right.day || "")));
}

export function rollupReturnClass(value) {
  const number = finiteNumber(value);
  if (number === null) return statusClass("warn");
  return statusClass(number >= 0 ? "ok" : "bad");
}

export function drawdownClass(value) {
  const number = finiteNumber(value);
  if (number === null) return statusClass("warn");
  if (number <= -10) return statusClass("bad");
  if (number < 0) return statusClass("warn");
  return statusClass("ok");
}

export function livePeriodTile(label, value, detail, className) {
  return `
    <div class="status-tile">
      <span>${escapeHtml(label)}</span>
      <strong class="${escapeHtml(className || statusClass("unknown"))}">${escapeHtml(value)}</strong>
      <small>${escapeHtml(detail)}</small>
    </div>
  `;
}

export function renderPerformanceLivePeriodSummary() {
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

export function renderOverviewPerformanceSnapshot() {
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

export function renderOverview() {
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

export function renderOverviewCommandCenter() {
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

export function overviewGlanceModel() {
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

export function renderOverviewGlance() {
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

export function worstStatusFrom(items = []) {
  // "idle" means empty-by-design (nothing started yet); it never raises a rollup.
  const ranks = { bad: 3, warn: 2, unknown: 1, ok: 0, idle: 0 };
  return (items || []).reduce((worst, item) => {
    const status = text(item.status || "unknown").toLowerCase();
    return (ranks[status] ?? 1) > (ranks[worst] ?? 1) ? status : worst;
  }, "ok");
}

export function overviewHealthReportModel() {
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

export function overviewHealthReportText(model) {
  return [
    `Strategy Health Report: ${model.headline}`,
    ...model.lines.map((line) => `${line.title}: ${line.detail}`),
  ].join("\n");
}

export function renderOverviewHealthReport() {
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

export function handleOverviewHealthReportAction(action) {
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

export function workflowHref(target, lens = "") {
  const view = normalizeView(target || "overview");
  return lens ? `#${view}/${encodeURIComponent(lens)}` : `#${view}`;
}

export function overviewWorkflowCards() {
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

export function renderOverviewWorkflowLauncher() {
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

export function utcDayKey(value) {
  const millis = timestampMillis(value);
  if (millis === null) return "";
  return new Date(millis).toISOString().slice(0, 10);
}

export function overviewReferenceTime(events, payload) {
  const candidates = [
    payload && payload.generated_at,
    ...events.map((event) => event.timestamp),
  ].map(timestampMillis).filter((value) => value !== null);
  return candidates.length ? new Date(Math.max(...candidates)).toISOString() : null;
}

export function eventSummary(events, type) {
  const rows = (events || []).filter((event) => event.type === type);
  return {
    count: rows.length,
    latest: rows[0] || null,
  };
}

export function renderOverviewSessionState() {
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

export function renderRuntimeStatus() {
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

export function renderOverviewHealth() {
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

export function renderOverviewPositions() {
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

export function renderOverviewOrders() {
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

export const ALERT_GUIDANCE = [
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

export function alertGuidance(kind) {
  const entry = ALERT_GUIDANCE.find((item) => item.match.test(String(kind || "")));
  return entry || {
    meaning: "A published telemetry health check failed.",
    action: "Inspect current health checks in Operations.",
    target: "operations",
    targetLabel: "Open Operations",
  };
}

export function alertCardsHtml(alerts, emptyMessage) {
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

export function renderOverviewAlerts() {
  const alerts = ((state.status && state.status.alerts) || []).slice(0, 6);
  $("overview-alerts-note").textContent = alerts.length
    ? `${numberText(alerts.length, 0)} current alert${alerts.length === 1 ? "" : "s"}`
    : "No current alerts";
  $("overview-alerts-body").innerHTML = alertCardsHtml(
    alerts,
    "No stale-data, stale-account, gateway, rejection, or risk alerts are currently published.",
  );
}

export function renderOverviewTimeline() {
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

export function renderMetrics() {
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
