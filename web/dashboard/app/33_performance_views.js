import {
  $,
  drawdownValueClass,
  equityValueHtml,
  escapeHtml,
  fetchOptionalJson,
  money,
  navigateToDataLens,
  navigateToOperationsLens,
  navigateToPerformanceLens,
  navigateToRunsLens,
  navigateToWorkbenchLens,
  numberText,
  pctText,
  row,
  signedValueClass,
  signedValueHtml,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { latestArtifactPerformance, renderPerformanceBenchmarkOptions, renderStrategyIdentity, selectedTelemetryRun } from "./20_workbench_foundation.js";
import { finiteNumber, latestAccountRow, setMetricValue, shortTimestampAgeLabel, sourceMetaLabel, sourceTimestamp, timestampAgeLabel, timestampMillis } from "./30_runtime_core.js";
import {
  buildTradeLedger,
  holdDurationLabel,
  modeMeaning,
  nonzeroPositionsFromSource,
  normalizedFillSide,
  performanceFromAccountRows,
  performancePeriodWindow,
  projectionCaveat,
  renderPerformanceTradeAssistant,
  renderPerformanceTradeControls,
  rowsInWindow,
  sourceMeaning,
  turnoverStats,
} from "./31_performance_math.js";
import { renderPerformanceLivePeriodSummary, rollupReturnClass, sortedStatusRollups, statusRollupSeriesStats, trailingStatusRollups, workflowHref } from "./32_overview.js";
import {
  benchmarkOverlayChart,
  calendarReturnHeatmap,
  candlestickChart,
  dailyReturnChart,
  drawdownChart,
  emptyChart,
  equityChart,
  formatTimestampForMode,
  intradayPnlChart,
  intradayPnlStats,
  latestSessionAccountRows,
  periodReturnBarChart,
  rangeLabel,
  statusRollupEquityChart,
  statusRollupReturnChart,
  tradeCumulativePnlChart,
  tradePnlBarChart,
} from "./34_charts.js";
import { copyText, downloadStatusRollupsCsv, loadPerformanceTradeBars, renderAll } from "./90_bootstrap.js";

// Build the buy/sell markers + entry->exit connectors for one symbol, in the
// numeric form candlestickChart's overlay layer expects. Sides are normalized
// here so the chart module stays a plain plotter.
function buildTradeOverlay(symbolFills, closedTrades) {
  const markers = symbolFills.map((fill) => {
    const side = normalizedFillSide(fill.side) === "sell" ? "sell" : "buy";
    const quantity = Math.abs(finiteNumber(fill.quantity) || 0);
    const price = finiteNumber(fill.price);
    return {
      millis: timestampMillis(fill.timestamp),
      price,
      side,
      label: `${formatTimestampForMode(fill.timestamp, "utc")} · ${side} ${numberText(quantity, 0)} @ ${numberText(price)}`,
    };
  });
  const trades = closedTrades.map((trade) => {
    const pnl = finiteNumber(trade.pnl);
    return {
      entryMillis: timestampMillis(trade.entry_time),
      entryPrice: finiteNumber(trade.entry_price),
      exitMillis: timestampMillis(trade.exit_time),
      exitPrice: finiteNumber(trade.exit_price),
      win: pnl !== null && pnl >= 0,
      label: `${text(trade.side)} ${numberText(Math.abs(finiteNumber(trade.quantity) || 0), 0)} · entry ${numberText(finiteNumber(trade.entry_price))} → exit ${numberText(finiteNumber(trade.exit_price))} · P&L ${money(trade.pnl)}`,
    };
  });
  return { markers, trades };
}

// Per-symbol price chart with the strategy's buys/sells overlaid — the standard
// "did my entries/exits make sense?" view. Fills and closed trades come straight
// from the run artifacts renderPerformance already computed; the symbol's bars are
// fetched lazily (loadPerformanceTradeBars) and cached in state.performanceTradeBars.
export function renderPerformanceTradeChart(fills, ledger) {
  const container = $("performance-trade-chart");
  const select = $("performance-trade-symbol");
  if (!container || !select) return;
  const note = $("performance-trade-chart-note");
  const legend = $("performance-trade-legend");
  const usableFills = (fills || []).filter((fill) => (
    fill && finiteNumber(fill.price) !== null && timestampMillis(fill.timestamp) !== null && text(fill.symbol) !== "n/a"
  ));
  const counts = new Map();
  for (const fill of usableFills) counts.set(text(fill.symbol), (counts.get(text(fill.symbol)) || 0) + 1);
  const symbols = Array.from(counts.entries()).sort((left, right) => right[1] - left[1]).map(([symbol]) => symbol);
  if (!symbols.length) {
    select.innerHTML = `<option value="">No fills</option>`;
    select.disabled = true;
    if (legend) legend.innerHTML = "";
    if (note) note.textContent = "No fills in this run — run a simulated-paper backtest (not replay) to see buys and sells here.";
    container.innerHTML = emptyChart("No fills to plot.");
    return;
  }
  select.disabled = symbols.length < 2;
  const signature = symbols.join("|");
  if (select.dataset.symbolSignature !== signature) {
    select.dataset.symbolSignature = signature;
    select.innerHTML = symbols.map((symbol) => `<option value="${escapeHtml(symbol)}">${escapeHtml(symbol)} · ${numberText(counts.get(symbol), 0)} fills</option>`).join("");
  }
  const symbol = select.value && symbols.includes(select.value) ? select.value : symbols[0];
  select.value = symbol;
  const symbolFills = usableFills.filter((fill) => text(fill.symbol) === symbol);
  const closedTrades = ((ledger && ledger.closed) || []).filter((trade) => text(trade.symbol) === symbol);
  const times = symbolFills.map((fill) => timestampMillis(fill.timestamp)).filter((value) => value !== null);
  const minTime = Math.min(...times);
  const maxTime = Math.max(...times);
  const key = `${symbol}|${minTime}|${maxTime}`;
  if (legend) {
    legend.innerHTML = [
      `<span class="legend-item"><span class="trade-legend-mark buy"></span>buy</span>`,
      `<span class="legend-item"><span class="trade-legend-mark sell"></span>sell</span>`,
      `<span class="legend-item"><span class="trade-legend-line win"></span>winning trade</span>`,
      `<span class="legend-item"><span class="trade-legend-line loss"></span>losing trade</span>`,
    ].join("");
  }
  if (note) {
    const wins = closedTrades.filter((trade) => (finiteNumber(trade.pnl) ?? -1) >= 0).length;
    const winRate = closedTrades.length ? (wins / closedTrades.length) * 100 : null;
    note.textContent = `${symbol}: ${numberText(symbolFills.length, 0)} fills · ${numberText(closedTrades.length, 0)} closed trades${winRate !== null ? ` · ${pctText(winRate)} win rate` : ""}.`;
  }
  const bars = state.performanceTradeBars || {};
  if (bars.key !== key && bars.loadingKey !== key) {
    loadPerformanceTradeBars(symbol, { start: minTime, end: maxTime, key }).catch(() => {});
  }
  if (bars.key === key && Array.isArray(bars.points) && bars.points.length >= 2) {
    container.innerHTML = candlestickChart(bars.points, "utc", [], buildTradeOverlay(symbolFills, closedTrades));
  } else if (bars.key === key && bars.error) {
    container.innerHTML = emptyChart(bars.error);
  } else {
    container.innerHTML = emptyChart(`Loading ${symbol} price bars…`);
  }
}

export function renderPerformance() {
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
  // Signal to the auto-benchmark loader (90_bootstrap) that a run with enough
  // account history to overlay is present, without a circular import.
  state.performanceHasAccountData = accountRows.length >= 2;
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
  setMetricValue("performance-activity", `${numberText(orders, 0)} orders / ${numberText(fillCount, 0)} fills / ${numberText(rejections, 0)} rejects`, {
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
  renderPerformanceTradeChart(fills, ledger);
  $("performance-benchmark-chart").innerHTML = benchmarkOverlayChart(accountRows, state.performanceBenchmarkDetail);
  $("performance-benchmark-note").textContent = state.performanceBenchmarkDetail && state.performanceBenchmarkDetail.path
    ? (state.benchmarkExplicit
        ? `${text(state.performanceBenchmarkDetail.symbol)} ${text(state.performanceBenchmarkDetail.bar_size)} from ${text(state.performanceBenchmarkDetail.path)}`
        : `Auto-picked ${text(state.performanceBenchmarkDetail.symbol)} ${text(state.performanceBenchmarkDetail.bar_size)} as the market benchmark — choose another dataset or "No benchmark" above to change.`)
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

export function performanceRiskStatus(drawdownPct, exposurePct) {
  const drawdown = finiteNumber(drawdownPct);
  const exposure = finiteNumber(exposurePct);
  if (drawdown === null && exposure === null) return "bad";
  const drawdownAbs = drawdown === null ? 0 : Math.abs(drawdown);
  if (drawdownAbs >= 20 || (exposure !== null && exposure >= 150)) return "bad";
  if (drawdownAbs >= 8 || (exposure !== null && exposure >= 100)) return "warn";
  return "ok";
}

export function renderPerformanceHome(context) {
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
  const returnKnown = Number.isFinite(totalReturn);
  const equityKnown = finiteNumber(periodPerf.final_equity) !== null;
  const returnClass = returnKnown
    ? signedValueClass(totalReturn)
    : "value-neutral";
  // A null return next to real equity used to read as a bare "n/a / $X" and look
  // like a failed run. Lead with the equity we do have and explain the blank.
  const result = !source.has_data
    ? "No performance data"
    : returnKnown
      ? `${pctText(periodPerf.total_return_pct)} / ${money(periodPerf.final_equity)}`
      : equityKnown
        ? `Equity ${money(periodPerf.final_equity)}`
        : "No performance data";
  let nextNote = "Publish telemetry, run a Workbench config, or open a saved artifact from Runs.";
  if (source.has_data && !returnKnown) {
    nextNote = "No computed return for this period - live telemetry alone can't produce one. Run a Workbench backtest, or use the Source selector to load a saved run artifact (and set Period to All).";
  } else if (source.has_data && !accountRows.length) {
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

export function performanceReportModel(context) {
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

export function performanceReportText(model) {
  const lines = [
    `Current Strategy Report: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ];
  return lines.join("\n");
}

export function renderPerformanceReport(context) {
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

export function handlePerformanceReportAction(action) {
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

export function performanceEvidenceModel(context) {
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

export function performanceEvidenceText(model) {
  return [
    `Performance Evidence: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

export function performanceSnapshotReturnCard({ label, value, detail, source }) {
  const numeric = finiteNumber(value);
  return {
    status: numeric === null ? "warn" : numeric >= 0 ? "ok" : "bad",
    className: signedValueClass(numeric),
    label,
    title: pctText(numeric),
    note: `${detail} Source: ${source}.`,
  };
}

export function performanceSnapshotModel(context) {
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

export function renderPerformanceSnapshot(context) {
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

export function handlePerformanceSnapshotAction(action) {
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

export function performanceWorkflowCards(context) {
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

export function renderPerformanceWorkflowLauncher(context) {
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

export function renderPerformanceRollups() {
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

export function performancePeriodRows(payload = {}) {
  const periodRollups = payload.period_rollups || {};
  return [
    ...(periodRollups.month || []).map((item) => ({ ...item, periodLabel: `Month ${item.label}`, periodType: "month" })),
    ...(periodRollups.year || []).map((item) => ({ ...item, periodLabel: `Year ${item.label}`, periodType: "year" })),
  ];
}

export function bestRollupRow(rows, key) {
  return (rows || [])
    .filter((item) => finiteNumber(item[key]) !== null)
    .sort((left, right) => Number(right[key]) - Number(left[key]))[0] || null;
}

export function worstRollupRow(rows, key) {
  return (rows || [])
    .filter((item) => finiteNumber(item[key]) !== null)
    .sort((left, right) => Number(left[key]) - Number(right[key]))[0] || null;
}

export function latestRollupRow(rows) {
  const copy = (rows || []).slice();
  copy.sort((left, right) => String(right.day || right.last_day || "").localeCompare(String(left.day || left.last_day || "")));
  return copy[0] || null;
}

export function renderPerformanceRollupAssistant() {
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

export function dayMillis(day) {
  if (!day) return null;
  return timestampMillis(`${day}T00:00:00Z`);
}

export function calendarDayCount(firstDay, lastDay) {
  const firstMillis = dayMillis(firstDay);
  const lastMillis = dayMillis(lastDay);
  if (firstMillis === null || lastMillis === null || lastMillis < firstMillis) return null;
  return Math.floor((lastMillis - firstMillis) / 86400000) + 1;
}

export function statusRollupContinuityModel() {
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
        ? "Status rollups come from persisted status-history snapshots, so they can answer current paper/live daily and period performance without an open artifact."
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

export function performanceRollupContinuityText(model) {
  return [
    `Status Rollup Continuity: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

export function renderPerformanceRollupContinuity() {
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

export function handlePerformanceRollupContinuityAction(action) {
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

export function handlePerformanceRollupAssistantAction(action) {
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

export async function reloadTelemetryArtifacts() {
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

export function focusPerformanceDay(day) {
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

export function renderStatusEquityRollups() {
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
    ? `${numberText(rollups.length, 0)} shown / ${numberText(payload.total || rollups.length, 0)} status-history day rows from ${numberText(payload.history_scanned || 0, 0)} snapshots; orders/fills/rejects are max observed recent-event counts`
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

export function renderPerformancePeriodRollups() {
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

