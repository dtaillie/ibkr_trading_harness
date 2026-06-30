import {
  $,
  age,
  escapeHtml,
  money,
  navigateToRunsLens,
  numberText,
  pctText,
  state,
  text,
} from "./00_core.js";
import { latestArtifactPerformance } from "./20_workbench_foundation.js";
import { finiteNumber, latestAccountRow, timestampMillis } from "./30_runtime_core.js";
import { renderPerformance } from "./33_performance_views.js";
import { numericAccountRows } from "./34_charts.js";

export function performancePeriodWindow(accountRows, period) {
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

export function rowsInWindow(rows, window) {
  if (!window || (window.start === null && window.end === null)) return rows || [];
  return (rows || []).filter((item) => {
    const millis = timestampMillis(item.timestamp);
    if (millis === null) return false;
    if (window.start !== null && millis < window.start) return false;
    if (window.end !== null && millis > window.end) return false;
    return true;
  });
}

export function performanceFromAccountRows(accountRows) {
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

export function modeMeaning(mode) {
  const value = String(mode || "").replace("-", "_").toLowerCase();
  if (value === "replay") return "Historical replay from saved files; no broker account is touched.";
  if (value === "simulated_paper") return "Local simulated-paper run using saved or streamed prices and simulated fills.";
  if (value === "shadow") return "Observation mode; signals can be logged without submitting orders.";
  if (value === "paper") return "Broker paper account metrics; orders may have been submitted to a paper account.";
  if (value === "live") return "Live account metrics; treat all results and controls as production-sensitive.";
  return "Mode unavailable; inspect the source run or telemetry before interpreting results.";
}

export function sourceMeaning(source) {
  if (source.source_type === "archived_artifact") return "Full archived run artifacts are loaded, including account snapshots when available.";
  if (source.source_type === "run_summary") return "Using a saved run summary; detailed curves need the run artifacts.";
  if (source.source_type === "live_telemetry") return "Using latest published telemetry; persistence depends on the runner output.";
  return "No performance source is loaded yet.";
}

export function projectionCaveat(perf, summary, elapsedDays) {
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

export function fillNotional(fill) {
  const quantity = Math.abs(finiteNumber(fill.quantity) || 0);
  const price = finiteNumber(fill.price);
  if (!quantity || price === null) return 0;
  return quantity * price;
}

export function turnoverStats(fills, initialEquity) {
  const notional = (fills || []).reduce((sum, fill) => sum + fillNotional(fill), 0);
  const equity = finiteNumber(initialEquity);
  return {
    notional,
    pct: equity && equity > 0 ? (notional / equity) * 100 : null,
  };
}

export function normalizedFillSide(value) {
  const side = String(value || "").trim().toLowerCase();
  if (side === "buy" || side === "bot" || side === "b") return "buy";
  if (side === "sell" || side === "sld" || side === "s") return "sell";
  return side;
}

export function holdDurationLabel(start, end) {
  const startMs = timestampMillis(start);
  const endMs = timestampMillis(end);
  if (startMs === null || endMs === null || endMs < startMs) return "n/a";
  const minutes = Math.round((endMs - startMs) / 60000);
  if (minutes < 60) return `${minutes}m`;
  const hours = minutes / 60;
  if (hours < 48) return `${hours.toLocaleString("en-US", { maximumFractionDigits: 1 })}h`;
  return `${(hours / 24).toLocaleString("en-US", { maximumFractionDigits: 1 })}d`;
}

export function buildTradeLedger(fills) {
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

// Collapse per-bar account snapshots to one equity value per UTC calendar date
// (last snapshot of each date), matching analysis/__init__.py's daily_equities.
export function dailyEquitySeries(accountRows) {
  const rows = numericAccountRows(accountRows)
    .filter((row) => timestampMillis(row.timestamp) !== null)
    .slice()
    .sort((a, b) => timestampMillis(a.timestamp) - timestampMillis(b.timestamp));
  const byDate = new Map();
  for (const row of rows) {
    const date = new Date(timestampMillis(row.timestamp));
    const key = `${date.getUTCFullYear()}-${date.getUTCMonth()}-${date.getUTCDate()}`;
    byDate.set(key, row.equity); // chronological iteration -> last equity of the date wins
  }
  return Array.from(byDate.values());
}

// Daily Sharpe, annualized x sqrt(252), replicating analysis/__init__.py exactly:
// population std (divide by N), and null (shown as n/a) when there are fewer than
// two trading days or zero volatility, rather than the Python's degenerate 0.
export function sharpeFromAccountRows(accountRows) {
  const daily = dailyEquitySeries(accountRows);
  if (daily.length < 2) return null;
  const returns = [];
  for (let i = 1; i < daily.length; i += 1) {
    if (!daily[i - 1]) return null;
    returns.push(daily[i] / daily[i - 1] - 1);
  }
  if (returns.length < 2) return null;
  const avg = returns.reduce((sum, value) => sum + value, 0) / returns.length;
  const variance = returns.reduce((sum, value) => sum + (value - avg) ** 2, 0) / returns.length;
  const std = Math.sqrt(variance);
  if (!(std > 0)) return null;
  return (avg / std) * Math.sqrt(252);
}

// The single source of truth for a backtest's headline metrics. Return/drawdown/
// equity come from the runner's own performance summary; Sharpe is computed from
// account snapshots and win rate / profit factor from the paired-fill ledger.
export function tearSheetMetrics(artifacts = {}) {
  const performance = artifacts.performance || {};
  const summary = artifacts.summary || {};
  const account = artifacts.account || [];
  const fills = artifacts.fills || [];
  const ledger = buildTradeLedger(fills);
  const closedCount = ledger.stats.closed_count;
  return {
    returnPct: finiteNumber(performance.total_return_pct),
    drawdownPct: finiteNumber(performance.max_drawdown_pct),
    finalEquity: performance.final_equity ?? summary.final_equity,
    netPnl: performance.total_pnl ?? summary.total_pnl ?? performance.realized_pnl ?? summary.realized_pnl,
    // Prefer the server's full-run Sharpe (consistent with return/drawdown); fall
    // back to a local compute from the (possibly capped) account rows for older
    // artifacts whose payload predates the server field.
    sharpe: finiteNumber(performance.sharpe) ?? sharpeFromAccountRows(account),
    winRatePct: closedCount ? (Number(ledger.stats.wins || 0) / closedCount) * 100 : null,
    profitFactor: ledger.stats.profit_factor,
    closedCount,
    fills: finiteNumber(summary.fills) ?? fills.length,
    tradingDays: dailyEquitySeries(account).length,
  };
}

export function renderPerformanceTradeControls(ledger) {
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

export function performanceTradeFilters() {
  return {
    state: (($("performance-trade-filter-state") || {}).value || "").toLowerCase(),
    side: (($("performance-trade-filter-side") || {}).value || "").toLowerCase(),
    symbol: (($("performance-trade-filter-symbol") || {}).value || "").trim().toUpperCase(),
  };
}

export function performanceTradeFilterCount() {
  const filters = performanceTradeFilters();
  return [filters.state, filters.side, filters.symbol].filter(Boolean).length;
}

export function tradeLedgerRealizedPnl(ledger) {
  return (ledger.closed || []).reduce((sum, trade) => sum + (finiteNumber(trade.pnl) || 0), 0);
}

export function tradeLedgerWorstLoss(ledger) {
  const losses = (ledger.closed || [])
    .filter((trade) => finiteNumber(trade.pnl) !== null && Number(trade.pnl) < 0)
    .sort((left, right) => Number(left.pnl || 0) - Number(right.pnl || 0));
  return losses[0] || null;
}

export function tradeLedgerNewestOpen(ledger) {
  const open = (ledger.open || []).slice();
  open.sort((left, right) => String(right.entry_time || "").localeCompare(String(left.entry_time || "")));
  return open[0] || null;
}

export function renderPerformanceTradeAssistant(ledger, shownRows = [], fills = []) {
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

export function applyPerformanceTradeFilter({ state = "", side = "", symbol = "" } = {}) {
  $("performance-trade-filter-state").value = state;
  $("performance-trade-filter-side").value = side;
  $("performance-trade-filter-symbol").value = symbol;
  renderPerformance();
}

export function currentTradeLedger() {
  const source = latestArtifactPerformance();
  const accountRows = source.account || [];
  const period = $("performance-period").value || "all";
  const window = performancePeriodWindow(accountRows, period);
  const fills = period === "all" ? (source.fills || []) : rowsInWindow(source.fills || [], window);
  return buildTradeLedger(fills);
}

export function handlePerformanceTradeAssistantAction(action) {
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

export function nonzeroPositionsFromAccountRow(accountRow = {}, summary = {}) {
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

export function nonzeroPositionsFromSource(source) {
  const summary = (source && source.summary) || {};
  const accountRow = latestAccountRow((source && source.account) || []);
  return nonzeroPositionsFromAccountRow(accountRow, summary);
}

export function positionDetailHtml(position, { includeQuantity = true } = {}) {
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

export function positionSnapshotDrilldown(snapshot) {
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
