import {
  $,
  MAX_DATA_COMPARE_DATASETS,
  applyWorkbenchLens,
  escapeHtml,
  navigateToDataLens,
  navigateToHelpLens,
  navigateToView,
  numberText,
  pctText,
  qualityBadge,
  row,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { firstPresent, normalizedRunMetrics, renderWorkbenchBackendStatus, shortTimestampAgeLabel, sourceTimestamp, timestampAgeLabel, timestampMillis, workbenchBackendStatusModel } from "./30_runtime_core.js";
import { workflowHref } from "./32_overview.js";
import { rangeLabel, timeRangeLabel } from "./34_charts.js";
import { countSummary, dataReplayReadinessModel } from "./40_data_catalog.js";
import { renderDataCompare, renderDataCompareControls } from "./43_data_detail_compare.js";
import { draftValidationById, normalizeConfigDraftErrors, renderConfigLivePanels, replaceOptions, selectedRunDraft } from "./60_workbench_builder.js";
import { copyText, loadDataCompare, loadDataDetail } from "./90_bootstrap.js";

const WORKBENCH_OPERATIONAL_FILE_NAMES = new Set([
  "exit_monitor.csv",
  "fetch_manifest.csv",
  "fills.csv",
  "ledger.csv",
  "orders.csv",
  "paper_eod_flatten.csv",
  "paper_fills.csv",
  "paper_orders.csv",
  "shadow_signals.csv",
  "signal.csv",
  "signals.csv",
  "subscriptions.csv",
  "today_bars.csv",
]);

const WORKBENCH_OPERATIONAL_SYMBOLS = new Set([
  "BARS",
  "FILLS",
  "ORDERS",
  "SHADOW",
  "SIGNAL",
  "SIGNALS",
  "SUBSCRIPTIONS",
  "TODAY",
]);

export function latestTelemetryRun() {
  const runs = (state.status && state.status.runs) || [];
  if (!runs.length) return null;
  return runs.slice().sort((a, b) => {
    const aMetrics = normalizedRunMetrics(a);
    const bMetrics = normalizedRunMetrics(b);
    const aTime = String(aMetrics.last_decision_time || a.latest_decision_time || a.generated_at || "");
    const bTime = String(bMetrics.last_decision_time || b.latest_decision_time || b.generated_at || "");
    return bTime.localeCompare(aTime);
  })[0];
}

export function selectedTelemetryRun() {
  const runs = (state.status && state.status.runs) || [];
  const wanted = state.performanceTelemetryRunId;
  if (wanted) {
    const match = runs.find((runItem) => String(runItem.id || "") === wanted);
    if (match) return match;
  }
  return latestTelemetryRun();
}

export function latestSupervisor() {
  const supervisors = (state.status && state.status.supervisors) || [];
  if (!supervisors.length) return null;
  return supervisors.slice().sort((a, b) => {
    const aTime = String(a.generated_at || "");
    const bTime = String(b.generated_at || "");
    return bTime.localeCompare(aTime);
  })[0];
}

export function latestSummarizedComparisonRun() {
  const runs = (state.runComparison && state.runComparison.runs) || [];
  return runs.find((runItem) => runItem.summary_available) || null;
}

export function emptyPerformanceSource(label = "No run data", sourceType = "none") {
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

export function artifactPerformanceSource() {
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

export function summaryPerformanceSource() {
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

export function telemetryPerformanceSource() {
  const telemetryRun = selectedTelemetryRun();
  if (telemetryRun) {
    const metrics = telemetryRun.metrics || {};
    const bridged = state.telemetryAccount && state.telemetryAccount.run_id === String(telemetryRun.id || "")
      ? state.telemetryAccount
      : { account: [], decisions: [], orders: [], fills: [], performance: {} };
    return {
      label: `${text(telemetryRun.id)} telemetry`,
      summary: metrics,
      performance: { ...(bridged.performance || {}), ...metrics },
      account: bridged.account || [],
      fills: bridged.fills || [],
      orders: bridged.orders || [],
      decisions: bridged.decisions || [],
      source_type: "live_telemetry",
      has_data: true,
    };
  }
  return emptyPerformanceSource("No current telemetry", "live_telemetry");
}

export function currentPerformanceSource() {
  const telemetry = telemetryPerformanceSource();
  if (telemetry.source_type === "live_telemetry" && telemetry.label !== "No current telemetry") return telemetry;
  const summary = summaryPerformanceSource();
  if (summary.source_type === "run_summary" && summary.label !== "No saved run summary") return summary;
  return emptyPerformanceSource("No current run data", "current");
}

export function latestArtifactPerformance() {
  if (state.performanceSourceMode === "artifact") return artifactPerformanceSource();
  if (state.performanceSourceMode === "latest_run") return summaryPerformanceSource();
  return currentPerformanceSource();
}

export function strategyIdentityModel(source = latestArtifactPerformance()) {
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
    metrics.latest_bar_time,
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

export function renderStrategyIdentity(targetId, source = latestArtifactPerformance()) {
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

export function benchmarkDatasets() {
  return (state.dataCatalog.datasets || [])
    .filter((dataset) => dataset.path)
    .sort((a, b) => {
      const left = `${text(a.symbol)} ${text(a.bar_size)} ${text(a.path)}`.toLowerCase();
      const right = `${text(b.symbol)} ${text(b.bar_size)} ${text(b.path)}`.toLowerCase();
      return left.localeCompare(right);
    });
}

export function renderPerformanceBenchmarkOptions() {
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

export function selectedConfigDatasets() {
  const select = $("config-dataset");
  if (!select) return [];
  const catalogByPath = new Map(workbenchDatasetRows().map((item) => [item.path, item]));
  const selectedValues = Array.from(select.selectedOptions).map((option) => option.value);
  const fallbackValues = Array.isArray(state.workbenchSelectedDatasetPaths) ? state.workbenchSelectedDatasetPaths : [];
  const values = selectedValues.length ? selectedValues : fallbackValues;
  const optionByValue = new Map(Array.from(select.options).map((option) => [option.value, option]));
  return values
    .map((value) => catalogByPath.get(value) || datasetFromConfigOption(optionByValue.get(value)) || (state.workbenchExtraDatasets || {})[value])
    .filter((dataset) => dataset && dataset.path);
}

export function workbenchDatasetRows() {
  const selectedPaths = new Set(Array.isArray(state.workbenchSelectedDatasetPaths) ? state.workbenchSelectedDatasetPaths : []);
  // When a picker symbol search is active, scope the listbox to the server-side
  // matches instead of the loaded catalog. The catalog scan is capped for speed,
  // so a searched symbol may not be in it at all; clearing the search box (sets
  // workbenchDatasetSearch back to null) restores the full catalog.
  const search = state.workbenchDatasetSearch;
  const searchActive = Boolean(search && search.query && Array.isArray(search.datasets));
  const baseRows = searchActive ? search.datasets : (state.dataCatalog.datasets || []);
  const catalogRows = baseRows.filter((dataset) => (
    dataset
    && dataset.path
    && (workbenchDatasetSelectable(dataset) || selectedPaths.has(dataset.path))
  ));
  const rowsByPath = new Map(catalogRows.map((dataset) => [dataset.path, dataset]));
  // Keep any already-selected dataset visible even while a search scopes the list,
  // so an active selection never silently drops out of the picker.
  if (searchActive) {
    for (const dataset of (state.dataCatalog.datasets || [])) {
      if (dataset && dataset.path && selectedPaths.has(dataset.path) && !rowsByPath.has(dataset.path)) {
        rowsByPath.set(dataset.path, dataset);
      }
    }
  }
  for (const dataset of Object.values(state.workbenchExtraDatasets || {})) {
    if (dataset && dataset.path && !rowsByPath.has(dataset.path)) {
      rowsByPath.set(dataset.path, dataset);
    }
  }
  return Array.from(rowsByPath.values());
}

export function workbenchDatasetSelectable(dataset = {}) {
  const rawPath = text(dataset.path || "");
  if (!rawPath || rawPath === "n/a") return false;
  // Structurally unusable files (no close column, no rows, no timestamps, ...) can
  // never be backtested — the run gate blocks them — so keep them out of the picker.
  // This catches operational runtime logs (shadow_signals/fills/orders, including
  // date-prefixed names the lists below miss) that scan in from the paper_logs roots.
  if (text(dataset.quality_blocking_status).toLowerCase() === "bad") return false;
  const name = rawPath.split(/[\\/]/).pop().toLowerCase();
  const stem = name.replace(/\.(csv|parquet)$/i, "");
  const symbol = text(dataset.symbol || dataset.canonical_symbol || "").toUpperCase();
  if (WORKBENCH_OPERATIONAL_FILE_NAMES.has(name)) return false;
  if (/^bars_\d+(min|m|h|d)$/.test(stem)) return false;
  if (WORKBENCH_OPERATIONAL_SYMBOLS.has(symbol)) return false;
  return true;
}

export function workbenchDatasetOptionLabel(dataset = {}) {
  return `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`;
}

function worstDatasetStatus(statuses) {
  const rank = { bad: 3, warn: 2, ok: 1 };
  let worst = "ok";
  for (const status of statuses) {
    const value = text(status).toLowerCase();
    if ((rank[value] || 0) > (rank[worst] || 0)) worst = value;
  }
  return worst;
}

// Pick the single file that represents a symbol+bar+session group for a run.
// The runner takes one file per symbol, so a group must resolve to exactly one
// path: prefer an already-consolidated multi-day file, otherwise the widest /
// most-complete chunk.
function workbenchGroupRepresentative(members) {
  // Honor an explicit per-file pick (e.g. "Use in Workbench" on one chunk) so the
  // picker keeps highlighting it; otherwise prefer a consolidated multi-day file.
  const selected = new Set(Array.isArray(state.workbenchSelectedDatasetPaths) ? state.workbenchSelectedDatasetPaths : []);
  const picked = members.find((item) => selected.has(item.path));
  if (picked) return picked;
  const consolidated = members.find((item) => /(^|[\\/])consolidated_bars[\\/]/.test(text(item.path)));
  if (consolidated) return consolidated;
  return members.slice().sort((left, right) => {
    const spanLeft = (timestampMillis(left.last_timestamp) || 0) - (timestampMillis(left.first_timestamp) || 0);
    const spanRight = (timestampMillis(right.last_timestamp) || 0) - (timestampMillis(right.first_timestamp) || 0);
    if (spanRight !== spanLeft) return spanRight - spanLeft;
    return (Number(right.rows) || 0) - (Number(left.rows) || 0);
  })[0];
}

// Sort key for a bar size: minutes per bar. Lets the duration selector list
// 1min before 5min before 1h before 1d regardless of catalog order. Unknown
// sizes sort last.
export function barSizeMinutes(barSize) {
  // Alternation is longest-prefix-first (regex picks the leftmost match): "month"
  // / "mo" must precede bare "m" or an unanchored match would stop at "m" and read
  // a month bar as one minute.
  const match = text(barSize).toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(min|month|mo|hour|hr|h|day|d|week|w|m)?/);
  if (!match) return Infinity;
  const value = Number(match[1]);
  const unit = match[2] || "min";
  if (unit.startsWith("mo")) return value * 1440 * 30;
  if (unit.startsWith("w")) return value * 1440 * 7;
  if (unit.startsWith("d")) return value * 1440;
  if (unit.startsWith("h")) return value * 60;
  return value;
}

// Friendly label for a bar size: "1min" -> "1 min", "1h" -> "1 hour", "1d" -> "1 day".
export function barSizeDurationLabel(barSize) {
  const raw = text(barSize);
  const match = raw.toLowerCase().match(/^(\d+(?:\.\d+)?)\s*(min|m|h|hr|hour|d|day|w|week|mo|month)?$/);
  if (!match) return raw;
  const value = match[1];
  const unit = match[2] || "min";
  const word = unit.startsWith("mo") ? "month" : unit.startsWith("w") ? "week"
    : unit.startsWith("d") ? "day" : unit.startsWith("h") ? "hour" : "min";
  const plural = word !== "min" && Number(value) !== 1 ? "s" : "";
  return `${value} ${word}${plural}`;
}

// Bar durations seen in saved data this session. The catalog scan is capped, so a
// later (re)scan can return a different subset of files; remembering every duration
// we have ever seen keeps the "Bar duration" selector stable instead of dropping an
// option mid-session (which would strand the user on whatever duration they're on).
const workbenchSeenDurations = new Set();

// Distinct bar durations across the saved data the picker can reach (loaded
// catalog + any explicitly-remembered datasets + active search results), with a
// count each, sorted finest-first. Feeds the "Bar duration" selector; derived
// from the full catalog (not the search-scoped rows) so the options stay stable.
export function workbenchAvailableDurations() {
  const counts = new Map();
  const tally = (rows) => {
    for (const dataset of rows || []) {
      if (dataset && dataset.path && workbenchDatasetSelectable(dataset)) {
        const barSize = text(dataset.bar_size || "n/a");
        counts.set(barSize, (counts.get(barSize) || 0) + 1);
        workbenchSeenDurations.add(barSize);
      }
    }
  };
  tally(state.dataCatalog.datasets || []);
  tally(Object.values(state.workbenchExtraDatasets || {}));
  if (state.workbenchDatasetSearch && Array.isArray(state.workbenchDatasetSearch.datasets)) {
    tally(state.workbenchDatasetSearch.datasets);
  }
  // Re-add any duration seen earlier this session that this (capped) scan missed,
  // so the selector keeps every option it has ever offered.
  for (const barSize of workbenchSeenDurations) {
    if (!counts.has(barSize)) counts.set(barSize, 0);
  }
  return Array.from(counts.entries())
    .map(([bar_size, count]) => ({ bar_size, count }))
    .sort((left, right) => barSizeMinutes(left.bar_size) - barSizeMinutes(right.bar_size) || left.bar_size.localeCompare(right.bar_size));
}

// Collapse the per-file dataset rows into one entry per symbol+bar_size+session
// (the same key consolidate_saved_bars.py merges on) so the picker shows
// "AAL · 1min · 165 files · <range>" instead of 165 near-identical rows.
export function workbenchDatasetGroups() {
  const groups = new Map();
  for (const dataset of workbenchDatasetRows()) {
    const symbol = text(dataset.canonical_symbol || dataset.symbol || "UNKNOWN");
    const barSize = text(dataset.bar_size || "n/a");
    const session = text(dataset.storage_session || "");
    const key = `${symbol}|${barSize}|${session}`;
    let group = groups.get(key);
    if (!group) {
      group = { key, symbol, bar_size: barSize, storage_session: session, members: [], file_count: 0, total_rows: 0, first_timestamp: null, last_timestamp: null };
      groups.set(key, group);
    }
    group.members.push(dataset);
    group.file_count += 1;
    group.total_rows += Number(dataset.rows) || 0;
    if (dataset.first_timestamp && (!group.first_timestamp || String(dataset.first_timestamp) < String(group.first_timestamp))) group.first_timestamp = dataset.first_timestamp;
    if (dataset.last_timestamp && (!group.last_timestamp || String(dataset.last_timestamp) > String(group.last_timestamp))) group.last_timestamp = dataset.last_timestamp;
  }
  const result = [];
  for (const group of groups.values()) {
    group.representative = workbenchGroupRepresentative(group.members);
    group.quality_status = worstDatasetStatus(group.members.map((item) => item.quality_status));
    // quality_blocking_status only flags real corruption (dup timestamps, OHLC
    // inversions, negative volume, ...) — not the benign session-gap advisories
    // that mark virtually every intraday file "warn". The picker badges on this.
    group.quality_blocking_status = worstDatasetStatus(group.members.map((item) => item.quality_blocking_status));
    group.storage_contract_status = worstDatasetStatus(group.members.map((item) => item.storage_contract_status));
    group.bar_size_mismatch = group.members.some((item) => item.bar_size_mismatch);
    group.bar_size_mixed = group.members.some((item) => item.bar_size_mixed);
    result.push(group);
  }
  // Scope to a single bar duration so a symbol that exists at 1min AND 5min shows
  // once, not twice — you can't then accidentally backtest the same name at two
  // cadences. "" / null means "All durations". An already-selected dataset is kept
  // visible even when it is off-duration so switching duration never silently drops
  // a selection.
  // Raw value, not text(): text("") returns "n/a", which would filter to a
  // non-existent "n/a" duration and empty the picker when "All durations" ("") is
  // selected.
  const duration = state.workbenchDatasetDuration || "";
  const scoped = duration
    ? result.filter((group) => {
        if (group.bar_size === duration) return true;
        const selectedPaths = new Set(Array.isArray(state.workbenchSelectedDatasetPaths) ? state.workbenchSelectedDatasetPaths : []);
        return group.members.some((member) => selectedPaths.has(member.path));
      })
    : result;
  scoped.sort((left, right) => left.symbol.localeCompare(right.symbol) || barSizeMinutes(left.bar_size) - barSizeMinutes(right.bar_size));
  return scoped;
}

export function workbenchDatasetGroupLabel(group = {}) {
  const session = group.storage_session && group.storage_session !== "n/a" ? ` · ${group.storage_session}` : "";
  // After consolidation most groups are a single file; only surface a count when
  // there is more than one, to keep the (often-truncated) row label short.
  const files = group.file_count > 1 ? ` · ${numberText(group.file_count, 0)} files` : "";
  const day = (timestamp) => text(timestamp).slice(0, 10);
  const span = group.first_timestamp ? ` · ${day(group.first_timestamp)} → ${day(group.last_timestamp)}` : "";
  // Show the granularity actually present, not just the filename label: older
  // "1min" extended files are frequently 5-minute data (IBKR lookback limit), so a
  // mismatch is flagged inline so it is not silently backtested as 1-minute bars.
  const rep = group.representative || {};
  let bar = text(group.bar_size);
  if (group.bar_size_mixed) bar = `${bar} (mixed cadence)`;
  else if (group.bar_size_mismatch && rep.bar_size_actual) bar = `${bar}→${text(rep.bar_size_actual)} bars`;
  // Badge only genuine corruption; benign session-gap advisories no longer mark
  // every intraday row as suspicious.
  const quality = group.quality_blocking_status === "bad" ? " [corrupt]" : "";
  return `${text(group.symbol)} · ${bar}${session}${files}${span}${quality}`;
}

export function setWorkbenchSelectedDatasetPaths(paths = []) {
  const unique = Array.from(new Set(paths.map(text).filter((value) => value && value !== "n/a")));
  state.workbenchSelectedDatasetPaths = unique;
  const select = $("config-dataset");
  if (select) {
    const selected = new Set(unique);
    for (const option of select.options) {
      option.selected = selected.has(option.value);
    }
  }
  return unique;
}

export function syncWorkbenchSelectedDatasetPathsFromSelect() {
  const select = $("config-dataset");
  return setWorkbenchSelectedDatasetPaths(select ? Array.from(select.selectedOptions).map((option) => option.value) : []);
}

export function rememberWorkbenchDataset(dataset = {}) {
  if (!dataset || !dataset.path) return dataset;
  const normalized = {
    ...dataset,
    symbol: dataset.symbol || dataset.display_symbol || dataset.canonical_symbol || "unknown",
    canonical_symbol: dataset.canonical_symbol || dataset.symbol || dataset.display_symbol || "",
    asset_class: dataset.asset_class || "unknown",
    source: dataset.source || "unknown",
    bar_size: dataset.bar_size || "unknown",
    storage_session: dataset.storage_session || "unknown",
    adjustment_status: dataset.adjustment_status || "unknown",
    storage_contract_status: dataset.storage_contract_status || "warn",
    storage_contract_warning_count: Number(dataset.storage_contract_warning_count ?? (dataset.storage_contract_status ? 0 : 1)),
    quality_status: dataset.quality_status || ((dataset.quality || {}).quality_status) || "warn",
    quality_warning_count: Number(dataset.quality_warning_count ?? ((dataset.quality || {}).quality_warning_count) ?? (dataset.quality_status ? 0 : 1)),
    replay_status: dataset.replay_status || "warn",
  };
  state.workbenchExtraDatasets = {
    ...(state.workbenchExtraDatasets || {}),
    [normalized.path]: normalized,
  };
  return normalized;
}

export function datasetFromConfigOption(option) {
  if (!option || !option.value) return null;
  return {
    path: option.value,
    symbol: option.dataset.symbol || text(option.textContent).split(/\s+/)[0] || "unknown",
    canonical_symbol: option.dataset.canonicalSymbol || option.dataset.symbol || "",
    asset_class: option.dataset.assetClass || "unknown",
    source: option.dataset.source || "unknown",
    bar_size: option.dataset.barSize || "unknown",
    storage_session: option.dataset.storageSession || "unknown",
    adjustment_status: option.dataset.adjustmentStatus || "unknown",
    storage_contract_status: option.dataset.storageContractStatus || "warn",
    storage_contract_warning_count: Number(option.dataset.storageContractWarningCount || 1),
    quality_status: option.dataset.qualityStatus || "warn",
    quality_warning_count: Number(option.dataset.qualityWarningCount || 1),
    rows: Number(option.dataset.rows || 0),
    first_timestamp: option.dataset.firstTimestamp || null,
    last_timestamp: option.dataset.lastTimestamp || null,
    size_bytes: Number(option.dataset.sizeBytes || 0),
    modified_at: option.dataset.modifiedAt || null,
    root: option.dataset.root || "",
    format: option.dataset.format || "",
    replay_status: option.dataset.replayStatus || "warn",
  };
}

export function attachDatasetOptionMetadata(option, dataset = {}) {
  if (!option || !dataset) return option;
  const set = (key, value) => {
    if (value !== undefined && value !== null && value !== "") option.dataset[key] = String(value);
  };
  set("symbol", dataset.symbol || dataset.display_symbol || dataset.canonical_symbol);
  set("canonicalSymbol", dataset.canonical_symbol || dataset.symbol);
  set("assetClass", dataset.asset_class);
  set("source", dataset.source);
  set("barSize", dataset.bar_size);
  set("storageSession", dataset.storage_session);
  set("adjustmentStatus", dataset.adjustment_status);
  set("storageContractStatus", dataset.storage_contract_status || "warn");
  set("storageContractWarningCount", dataset.storage_contract_warning_count ?? (dataset.storage_contract_status ? 0 : 1));
  set("qualityStatus", dataset.quality_status || ((dataset.quality || {}).quality_status) || "warn");
  set("qualityWarningCount", dataset.quality_warning_count ?? ((dataset.quality || {}).quality_warning_count) ?? (dataset.quality_status ? 0 : 1));
  set("rows", dataset.rows);
  set("firstTimestamp", dataset.first_timestamp);
  set("lastTimestamp", dataset.last_timestamp);
  set("sizeBytes", dataset.size_bytes);
  set("modifiedAt", dataset.modified_at);
  set("root", dataset.root);
  set("format", dataset.format);
  set("replayStatus", dataset.replay_status);
  return option;
}

export function selectedDataReadiness(selected = selectedConfigDatasets()) {
  // Mirror the run gate: only genuine corruption blocks readiness. Benign
  // session-gap advisories (which mark almost every intraday file "warn") must not
  // make a runnable dataset look "not ready".
  const qualityIssues = selected.filter((dataset) => text(dataset.quality_blocking_status || dataset.quality_status).toLowerCase() === "bad");
  const contractIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.storage_contract_status).toLowerCase()));
  const badContract = contractIssues.some((dataset) => text(dataset.storage_contract_status).toLowerCase() === "bad");
  const issueCount = qualityIssues.length + contractIssues.length;
  return {
    qualityIssues,
    contractIssues,
    issueCount,
    status: !selected.length ? "idle" : badContract ? "bad" : issueCount ? "warn" : "ok",
    summary: `${numberText(qualityIssues.length, 0)} quality / ${numberText(contractIssues.length, 0)} contract`,
    cleanNote: "Selected files pass current quality and storage-contract checks.",
    reviewNote: `${numberText(qualityIssues.length, 0)} quality and ${numberText(contractIssues.length, 0)} contract issue${contractIssues.length === 1 ? "" : "s"} need review.`,
  };
}

export function configDateRangePayload() {
  return {
    start: $("config-start-date") ? $("config-start-date").value : "",
    end: $("config-end-date") ? $("config-end-date").value : "",
  };
}

export function renderConfigDataQuality() {
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
    text(dataset.quality_blocking_status || dataset.quality_status).toLowerCase() === "bad"
  ));
  $("config-data-quality-note").innerHTML = warningRows.length
    ? `<span class="status-warn">${warningRows.length} corrupt of ${selected.length} selected</span>`
    : `<span class="status-ok">${selected.length} selected datasets ready</span>`;
  $("config-data-quality-body").innerHTML = selected.map((dataset) => row([
    escapeHtml(text(dataset.symbol)),
    qualityBadge(dataset.quality_blocking_status || dataset.quality_status, dataset.quality_blocking_warnings || dataset.quality_warnings),
    qualityBadge(dataset.storage_contract_status, dataset.storage_contract_warnings),
    escapeHtml(text(dataset.bar_size)),
    escapeHtml(numberText(dataset.rows, 0)),
    escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp)),
    escapeHtml((dataset.quality_warnings || []).join("; ") || "none"),
    `<span class="mono">${escapeHtml(dataset.path)}</span>`,
  ])).join("");
}

export function selectedDataPacketStatus(selected, alignment, qualityIssues, contractIssues) {
  if (!selected.length) return { status: "idle", title: "Choose Data", note: "Select saved files from Data Library before building a draft." };
  if (qualityIssues.length && contractIssues.length) return { status: "warn", title: "Review Data", note: `${numberText(qualityIssues.length, 0)} quality and ${numberText(contractIssues.length, 0)} metadata issue${contractIssues.length === 1 ? "" : "s"} need review.` };
  if (qualityIssues.length) return { status: "warn", title: "Review Quality", note: `${numberText(qualityIssues.length, 0)} selected file${qualityIssues.length === 1 ? "" : "s"} need review before replay.` };
  if (contractIssues.length) return { status: "warn", title: "Review Metadata", note: `${numberText(contractIssues.length, 0)} selected file${contractIssues.length === 1 ? "" : "s"} have storage-contract warnings.` };
  if (!alignment.dataset_count) return { status: "warn", title: "Preview Alignment", note: "Selected files are clean enough to review; preview timestamp overlap next." };
  if (Number(alignment.common_timestamp_count || 0) <= 0) return { status: "bad", title: "No Overlap", note: "Selected files do not share timestamps in the current date range." };
  if (Number(alignment.warning_count || 0)) return { status: "warn", title: "Alignment Warnings", note: `${numberText(alignment.warning_count, 0)} alignment warning${Number(alignment.warning_count || 0) === 1 ? "" : "s"} need review.` };
  return { status: "ok", title: "Ready", note: "Selected files have quality and timestamp overlap evidence." };
}

export function renderWorkbenchSelectedDataPacket(selected = selectedConfigDatasets()) {
  if (!$("workbench-selected-data-note") || !$("workbench-selected-data-cards") || !$("workbench-selected-data-list")) return;
  renderWorkbenchSelectedDataCoverage(selected);
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const range = configDateRangePayload();
  const qualityIssues = selected.filter((dataset) => text(dataset.quality_blocking_status || dataset.quality_status).toLowerCase() === "bad");
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
      status: selected.length ? "ok" : "idle",
      title: symbols.length ? `${numberText(symbols.length, 0)} symbol${symbols.length === 1 ? "" : "s"}` : "None",
      label: "Universe",
      note: symbols.length ? symbols.slice(0, 5).join(", ") : "Use Data Library to choose saved files.",
    },
    {
      status: selected.length ? "ok" : "idle",
      title: bars.length ? bars.join(", ") : "n/a",
      label: "Bars",
      note: sources.length ? `Sources: ${sources.slice(0, 4).join(", ")}` : "No source metadata loaded.",
    },
    {
      status: contractIssues.length ? "warn" : selected.length ? "ok" : "idle",
      title: selected.length ? contractIssues.length ? `${numberText(contractIssues.length, 0)} review` : "Clear" : "n/a",
      label: "Contract",
      note: contractIssues.length
        ? "Review timestamp/session/bar-size/adjustment metadata before replay."
        : selected.length ? "Selected files pass current storage-contract checks." : "No selected files.",
    },
    {
      status: range.start || range.end ? "ok" : selected.length ? "warn" : "idle",
      title: range.start || range.end ? "Date Window" : "Full Files",
      label: "Range",
      note: range.start || range.end ? `${range.start || "first bar"} to ${range.end || "last bar"}` : "No Workbench date filter set.",
    },
    {
      status: alignment.dataset_count ? Number(alignment.common_timestamp_count || 0) ? "ok" : "bad" : selected.length ? "warn" : "idle",
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

export function selectedDataCoverageRows(selected = selectedConfigDatasets()) {
  return (selected || []).map((dataset, index) => {
    const replay = dataReplayReadinessModel(dataset);
    const quality = text(dataset.quality_status).toLowerCase();
    const contract = text(dataset.storage_contract_status).toLowerCase();
    const status = replay.status || (quality === "bad" || contract === "bad" ? "bad" : quality === "warn" || contract === "warn" ? "warn" : "ok");
    return {
      index: index + 1,
      path: dataset.path || "",
      symbol: text(dataset.symbol),
      source: text(dataset.source),
      asset: text(dataset.asset_class),
      bar_size: text(dataset.bar_size),
      storage_session: text(dataset.storage_session),
      source_timezone: text(dataset.source_timezone),
      adjustment_status: text(dataset.adjustment_status),
      first_timestamp: dataset.first_timestamp || "",
      last_timestamp: dataset.last_timestamp || "",
      range: rangeLabel(dataset.first_timestamp, dataset.last_timestamp),
      rows: Number(dataset.rows || 0),
      quality_status: text(dataset.quality_status),
      storage_contract_status: text(dataset.storage_contract_status),
      replay_status: status,
      replay_title: replay.title,
      replay_detail: replay.detail,
    };
  });
}

export function renderWorkbenchSelectedDataCoverage(selected = selectedConfigDatasets()) {
  if (
    !$("workbench-selected-coverage-note")
    || !$("workbench-selected-coverage-cards")
    || !$("workbench-selected-coverage-body")
    || !$("export-workbench-selected-data-csv")
  ) return;
  const rows = selectedDataCoverageRows(selected);
  const symbols = new Set(rows.map((item) => item.symbol).filter((value) => value !== "n/a"));
  const sources = new Set(rows.map((item) => item.source).filter((value) => value !== "n/a"));
  const bars = new Set(rows.map((item) => item.bar_size).filter((value) => value !== "n/a"));
  const sessions = new Set(rows.map((item) => item.storage_session).filter((value) => value !== "n/a"));
  const replayCounts = rows.reduce((counts, item) => {
    counts[item.replay_status] = (counts[item.replay_status] || 0) + 1;
    return counts;
  }, {});
  const reviewCount = Number(replayCounts.warn || 0) + Number(replayCounts.bad || 0);
  $("export-workbench-selected-data-csv").disabled = !rows.length;
  $("workbench-selected-coverage-note").textContent = rows.length
    ? `${numberText(rows.length, 0)} files / ${numberText(symbols.size, 0)} symbols / ${reviewCount ? `${numberText(reviewCount, 0)} review` : "replay ready"}`
    : "No selected coverage to export";
  const cards = [
    {
      status: rows.length ? "ok" : "idle",
      label: "Files",
      title: numberText(rows.length, 0),
      note: symbols.size ? `${numberText(symbols.size, 0)} selected symbol${symbols.size === 1 ? "" : "s"}.` : "Choose saved files before simulating.",
    },
    {
      status: rows.length && !reviewCount ? "ok" : reviewCount ? "warn" : "idle",
      label: "Replay",
      title: rows.length ? reviewCount ? `${numberText(reviewCount, 0)} review` : "Ready" : "n/a",
      note: countSummary(replayCounts) || "No selected replay evidence.",
    },
    {
      status: sources.size && bars.size ? "ok" : rows.length ? "warn" : "idle",
      label: "Mix",
      title: bars.size ? Array.from(bars).slice(0, 3).join(", ") : "n/a",
      note: sources.size ? `Sources ${Array.from(sources).slice(0, 3).join(", ")}.` : "No source metadata loaded.",
    },
    {
      status: sessions.size === 1 ? "ok" : sessions.size > 1 ? "warn" : rows.length ? "warn" : "idle",
      label: "Session",
      title: sessions.size ? Array.from(sessions).slice(0, 3).join(", ") : "n/a",
      note: sessions.size > 1 ? "Mixed storage sessions need strategy-aware replay review." : "Storage-session metadata is consistent.",
    },
  ];
  $("workbench-selected-coverage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-selected-coverage-body").innerHTML = rows.length
    ? rows.map((item) => row([
        escapeHtml(item.symbol),
        escapeHtml(`${item.asset} / ${item.source}`),
        escapeHtml(item.bar_size),
        escapeHtml(item.storage_session),
        escapeHtml(item.range),
        escapeHtml(numberText(item.rows, 0)),
        `<div class="data-readiness-cell ${escapeHtml(statusClass(item.replay_status))}"><strong>${escapeHtml(item.replay_title)}</strong><span>${escapeHtml(item.replay_detail)}</span><small>${escapeHtml(`tz ${item.source_timezone} / adjust ${item.adjustment_status}`)}</small></div>`,
        `<div class="table-actions">
          <button type="button" class="secondary" data-workbench-selected-data-action="inspect" data-path="${escapeHtml(item.path)}">Inspect</button>
          <button type="button" class="secondary" data-workbench-selected-data-action="compare" data-path="${escapeHtml(item.path)}">Compare</button>
          <button type="button" class="secondary" data-workbench-selected-data-action="remove" data-path="${escapeHtml(item.path)}">Remove</button>
        </div>`,
      ])).join("")
    : row([
        `<span class="muted">select data</span>`,
        "",
        "",
        "",
        "",
        "",
        "",
        "",
      ]);
}

export function renderConfigDataActions(selected = selectedConfigDatasets()) {
  if (!$("config-data-actions-note") || !$("config-data-actions-cards")) return;
  const qualityIssues = selected.filter((dataset) => text(dataset.quality_blocking_status || dataset.quality_status).toLowerCase() === "bad");
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
      status: selected.length ? "ok" : "idle",
      label: "Selected",
      title: numberText(selected.length, 0),
      note: symbols.length ? `${symbols.slice(0, 4).join(", ")}${symbols.length > 4 ? "..." : ""}` : "No saved files selected.",
    },
    {
      status: qualityIssues.length ? "warn" : selected.length ? "ok" : "idle",
      label: "Quality",
      title: qualityIssues.length ? `${numberText(qualityIssues.length, 0)} review` : selected.length ? "Clean" : "n/a",
      note: qualityIssues.length ? "Review warnings before generating a replay draft." : "No selected quality warnings reported.",
    },
    {
      status: contractIssues.length ? "warn" : selected.length ? "ok" : "idle",
      label: "Contract",
      title: contractIssues.length ? `${numberText(contractIssues.length, 0)} review` : selected.length ? "Clear" : "n/a",
      note: contractIssues.length ? "Review storage metadata before generating a replay draft." : "Selected files pass current storage-contract checks.",
    },
    {
      status: compareReady ? "ok" : selected.length ? "warn" : "idle",
      label: "Compare",
      title: compareReady ? "Ready" : "Need 2+",
      note: compareReady ? `${bars.join(", ") || "unknown bars"} from ${sources.join(", ") || "unknown sources"}.` : "Select at least two files to compare overlap.",
    },
    {
      status: range.start || range.end ? "ok" : selected.length ? "warn" : "idle",
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

export async function openFirstConfigDatasetDetail() {
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

export async function compareConfigDatasets() {
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

export async function inspectWorkbenchSelectedDataset(path) {
  if (!path) throw new Error("selected dataset path is missing");
  await loadDataDetail(path, { resetControls: true });
  navigateToDataLens("inspect");
  if ($("data-detail-form")) $("data-detail-form").scrollIntoView({ block: "start", behavior: "smooth" });
  $("last-refresh").textContent = "Opened Workbench selected dataset";
}

export async function compareWorkbenchSelectedDataset(path) {
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

export function removeWorkbenchSelectedDataset(path) {
  const select = $("config-dataset");
  if (!select || !path) return;
  for (const option of select.options) {
    if (option.value === path) option.selected = false;
  }
  syncWorkbenchSelectedDatasetPathsFromSelect();
  state.configDraft = null;
  state.configDraftErrors = [];
  state.alignmentPreview = null;
  renderConfigLivePanels();
  $("workbench-selected-data-note").textContent = "Removed selected dataset; preview alignment again before generating.";
}

export function handleWorkbenchSelectedDataAction(button) {
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

export function latestWorkbenchRunForDraft(draftId) {
  const runs = (state.configRuns && state.configRuns.runs) || [];
  return runs.find((run) => !draftId || run.draft_id === draftId) || null;
}

export function configGuideStepMetadata() {
  const steps = (state.configOptions && state.configOptions.guide_steps) || [];
  return steps.slice().sort((left, right) => {
    const leftOrder = Number(left.order);
    const rightOrder = Number(right.order);
    const leftValue = Number.isFinite(leftOrder) ? leftOrder : 999;
    const rightValue = Number.isFinite(rightOrder) ? rightOrder : 999;
    return leftValue - rightValue || text(left.id).localeCompare(text(right.id));
  });
}

export function workbenchGuideAction(step) {
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

export function renderWorkbenchGuide() {
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
      status: selected.length ? "ok" : "idle",
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
      status: !selected.length ? "idle" : hasDateRange ? "ok" : "warn",
      fallbackLabel: "Choose Range",
      detail: !selected.length
        ? "Select data before narrowing the replay window."
        : hasDateRange
          ? `Replay window: ${dateRange.start || "first bar"} to ${dateRange.end || "last bar"}.`
          : "Optional; unset uses each file's full history.",
    },
    {
      id: "alignment",
      status: alignment.dataset_count ? (alignmentWarnings ? "warn" : "ok") : "idle",
      fallbackLabel: "Inspect Alignment",
      detail: alignment.dataset_count
        ? `${numberText(alignment.common_timestamp_count, 0)} common timestamps${alignmentWarnings ? `; ${alignmentWarnings} warning${alignmentWarnings === 1 ? "" : "s"}` : ""}.`
        : "Click Preview Alignment or Generate to verify timestamp overlap.",
    },
    {
      id: "draft",
      status: draft.yaml ? (draftValid ? "ok" : "warn") : "idle",
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

export function renderWorkbenchStepper(steps = []) {
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

export function workbenchHomeState() {
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
      status: alignment.dataset_count ? Number(alignment.common_timestamp_count || 0) > 0 ? Number(alignment.warning_count || 0) ? "warn" : "ok" : "bad" : selected.length ? "warn" : "idle",
      label: "Alignment",
      title: alignment.dataset_count ? numberText(alignment.common_timestamp_count, 0) : "Preview",
      note: alignment.dataset_count ? `${pctText(alignment.common_coverage_pct)} common coverage.` : "Not previewed.",
    },
    {
      status: hasDateRange ? "ok" : selected.length ? "warn" : "idle",
      label: "Window",
      title: hasDateRange ? "Bounded" : "Full History",
      note: hasDateRange ? timeRangeLabel(configDateRangePayload().start, configDateRangePayload().end) : "No date range set.",
    },
    {
      status: draftReady ? "ok" : draft.yaml || savedDraft ? "warn" : "idle",
      label: "Draft",
      title: savedDraftId ? text(savedDraftId) : draft.yaml ? "Generated" : "Missing",
      note: draftReady ? "Valid." : draft.yaml || savedDraft ? "Needs validation." : "Generate a draft.",
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : draftReady ? "warn" : "idle",
      label: "Run",
      title: latestRun ? text(latestRun.status) : "Not Run",
      note: latestRun ? `${text(latestRun.action)} ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.` : "Run after validation.",
    },
    {
      status: hasArtifacts ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "idle",
      label: "Results",
      title: hasArtifacts ? "Loaded" : latestRun && latestRun.artifact_path ? "Available" : "Missing",
      note: hasArtifacts ? "Performance/Runs can inspect artifacts." : "No loaded artifact yet.",
    },
  ];
  return { result, note, nextAction, tiles };
}

export function renderWorkbenchHome() {
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
  renderWorkbenchStageSummary(stateModel);
  renderWorkbenchBackendStatus();
  renderWorkbenchActionSummary(stateModel);
  renderWorkbenchExampleGallery();
  renderWorkbenchSimulationPlan(stateModel);
  renderWorkbenchReadinessReview(stateModel);
  renderWorkbenchEvidence();
  renderWorkbenchWorkflowLauncher();
}

export function workbenchNextActionHref(action) {
  if (action === "data") return "#data/browse";
  if (action === "quality" || action === "alignment" || action === "generate") return "#workbench/builder";
  if (action === "run") return "#workbench/run";
  if (action === "results") return "#workbench/artifacts";
  return "#workbench";
}

export function workbenchNextActionLabel(action) {
  if (action === "data") return "Select Data";
  if (action === "quality") return "Review Data";
  if (action === "alignment") return "Preview Alignment";
  if (action === "generate") return "Open Builder";
  if (action === "run") return "Open Run";
  if (action === "results") return "Open Results";
  return "Open Workbench";
}

export function renderWorkbenchStageSummary(stateModel = workbenchHomeState()) {
  if (!$("workbench-stage-note") || !$("workbench-stage-cards") || !$("workbench-stage-actions")) return;
  const tiles = stateModel.tiles || [];
  const okCount = tiles.filter((tile) => tile.status === "ok").length;
  const warnCount = tiles.filter((tile) => tile.status === "warn").length;
  const badCount = tiles.filter((tile) => tile.status === "bad").length;
  const dataTile = tiles.find((tile) => tile.label === "Data") || {};
  const alignmentTile = tiles.find((tile) => tile.label === "Alignment") || {};
  const draftTile = tiles.find((tile) => tile.label === "Draft") || {};
  const runTile = tiles.find((tile) => tile.label === "Run") || {};
  const resultsTile = tiles.find((tile) => tile.label === "Results") || {};
  const nextHref = workbenchNextActionHref(stateModel.nextAction);
  const nextLabel = workbenchNextActionLabel(stateModel.nextAction);
  const status = badCount ? "bad" : warnCount ? "warn" : okCount ? "ok" : "idle";
  $("workbench-stage-note").textContent = `${stateModel.result}; ${numberText(okCount, 0)} ready / ${numberText(warnCount, 0)} review / ${numberText(badCount, 0)} blocked. Next: ${nextLabel}.`;
  const cards = [
    {
      status,
      label: "Current Stage",
      title: stateModel.result,
      note: stateModel.note,
      className: statusClass(status),
    },
    {
      status: dataTile.status || "idle",
      label: "Data Packet",
      title: dataTile.title || "None",
      note: dataTile.note || "Select saved files before generating a draft.",
      className: statusClass(dataTile.status || "idle"),
    },
    {
      status: alignmentTile.status || "idle",
      label: "Alignment",
      title: alignmentTile.title || "Preview",
      note: alignmentTile.note || "Preview shared timestamps before running.",
      className: statusClass(alignmentTile.status || "idle"),
    },
    {
      status: draftTile.status || "idle",
      label: "Draft",
      title: draftTile.title || "Missing",
      note: draftTile.note || "Generate and validate a public-safe draft.",
      className: statusClass(draftTile.status || "idle"),
    },
    {
      status: runTile.status || "idle",
      label: "Run",
      title: runTile.title || "Not Run",
      note: runTile.note || "Run after draft validation.",
      className: statusClass(runTile.status || "idle"),
    },
    {
      status: resultsTile.status || "idle",
      label: "Results",
      title: resultsTile.title || "Missing",
      note: resultsTile.note || "Load artifacts before reading Performance.",
      className: statusClass(resultsTile.status || "idle"),
    },
  ];
  $("workbench-stage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className)}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-stage-actions").innerHTML = [
    `<a href="${escapeHtml(nextHref)}">${escapeHtml(nextLabel)}</a>`,
    `<a class="secondary" href="#data/browse">Data Library</a>`,
    `<a class="secondary" href="#workbench/builder">Builder</a>`,
    `<a class="secondary" href="#workbench/run">Run</a>`,
    `<a class="secondary" href="#performance">Performance</a>`,
  ].join("");
}

export function workbenchActionSummaryModel(stateModel = workbenchHomeState()) {
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const savedDraft = selectedRunDraft();
  const savedDraftId = savedDraft ? savedDraft.draft_id : draft.name || ($("config-run-draft") && $("config-run-draft").value) || "";
  const validation = savedDraftId ? draftValidationById()[savedDraftId] : null;
  const generatedValid = draft.validation ? Boolean(draft.validation.valid) : false;
  const draftValid = Boolean(draft.yaml && generatedValid) || Boolean(savedDraft && validation && validation.valid);
  const latestRun = latestWorkbenchRunForDraft(savedDraftId);
  const artifacts = state.configArtifacts || {};
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id);
  const plugin = selectedConfigPlugin();
  const mode = $("config-mode") ? $("config-mode").value : "";
  const alignmentCommon = Number(alignment.common_timestamp_count || 0);
  const alignmentWarnings = Number(alignment.warning_count || (alignment.warnings || []).length || 0);
  const alignmentStatus = alignment.dataset_count
    ? alignmentCommon > 0 ? alignmentWarnings ? "warn" : "ok" : "bad"
    : selected.length ? "warn" : "idle";
  const nextHref = workbenchNextActionHref(stateModel.nextAction);
  const nextLabel = workbenchNextActionLabel(stateModel.nextAction);
  const runStatus = latestRun
    ? latestRun.status === "completed" ? "ok" : "warn"
    : draftValid ? "warn" : "idle";
  const resultsStatus = hasArtifacts ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "idle";
  const backend = workbenchBackendStatusModel();
  const backendRows = backend.rows || [];
  const backendEndpointRows = backendRows.filter((item) => item.label !== "required status");
  const backendIssues = backendEndpointRows.filter((item) => item.status !== "ok");
  const backendUnprobed = !backendEndpointRows.length && Boolean(state.status && state.status.generated_at);
  const firstBackendIssue = backendIssues[0] || null;
  const overallStatus = (stateModel.tiles || []).some((tile) => tile.status === "bad")
    ? "bad"
    : (stateModel.tiles || []).some((tile) => tile.status === "warn") ? "warn" : (stateModel.tiles || []).some((tile) => tile.status === "ok") ? "ok" : "idle";
  const primaryNote = backendUnprobed
    ? "Workbench endpoint checks have not run yet. Refresh Workbench APIs before treating empty drafts, runs, or schema options as missing."
    : firstBackendIssue
      ? `${text(firstBackendIssue.label)} is degraded: ${text(firstBackendIssue.detail)}. Confirm backend status before changing config inputs.`
      : stateModel.note;
  const primaryTitle = backendUnprobed ? "Check Workbench APIs" : firstBackendIssue ? "Refresh Workbench APIs" : stateModel.result;
  const primaryStatus = backendUnprobed ? "idle" : firstBackendIssue ? "warn" : overallStatus;
  const primaryHref = backendUnprobed || firstBackendIssue ? "#operations/diagnostics" : nextHref;
  const primaryLabel = backendUnprobed || firstBackendIssue ? "API Health" : nextLabel;
  const cards = [
    {
      label: "Backend Check",
      status: backendUnprobed ? "bad" : firstBackendIssue ? "warn" : "ok",
      title: backendUnprobed ? "No Checks" : firstBackendIssue ? "Review" : backend.title,
      detail: backendUnprobed
        ? "Refresh Workbench APIs to verify schema, draft, run, comparison, and rollup endpoints."
        : firstBackendIssue ? `${text(firstBackendIssue.label)}: ${text(firstBackendIssue.detail)}` : backend.note,
    },
    {
      label: "Next Move",
      status: primaryStatus,
      title: primaryTitle,
      detail: primaryNote,
    },
    {
      label: "Data",
      status: selected.length ? dataReadiness.status : "idle",
      title: selected.length ? `${numberText(selected.length, 0)} selected` : "Choose files",
      detail: selected.length ? dataReadiness.issueCount ? dataReadiness.reviewNote : dataReadiness.cleanNote : "Start from Data Library, Compare, or Fetch Outputs.",
    },
    {
      label: "Alignment",
      status: alignmentStatus,
      title: alignment.dataset_count ? `${numberText(alignmentCommon, 0)} common` : "Preview needed",
      detail: alignment.dataset_count ? `${pctText(alignment.common_coverage_pct)} common coverage / ${numberText(alignmentWarnings, 0)} warnings.` : "Preview timestamp overlap before generating YAML.",
    },
    {
      label: "Plugin And Mode",
      status: plugin.id ? pluginBoundaryStatus(plugin) : "idle",
      title: plugin.label || plugin.id || "No plugin",
      detail: plugin.id ? `${text(mode || "mode n/a")} / ${text(plugin.visibility || plugin.boundary || "registry metadata")}.` : "Choose a public example or ignored local plugin.",
    },
    {
      label: "Draft",
      status: draftValid ? "ok" : draft.yaml || savedDraft ? "warn" : alignmentCommon > 0 ? "warn" : "idle",
      title: savedDraftId || (draft.yaml ? "Generated" : "Missing"),
      detail: draftValid ? "Draft is valid enough to run." : draft.yaml || savedDraft ? "Draft exists, but validation needs review." : "Generate and save a draft after data/plugin review.",
    },
    {
      label: "Run And Results",
      status: hasArtifacts ? "ok" : runStatus === "bad" || resultsStatus === "bad" ? "bad" : "warn",
      title: hasArtifacts ? "Artifacts loaded" : latestRun ? text(latestRun.status || latestRun.action) : "Not run",
      detail: hasArtifacts ? "Open Performance or Runs for charts/events." : latestRun && latestRun.artifact_path ? "Completed artifacts are available; load them before reading performance." : "Run validate/replay/simulated-paper from the Run lens.",
    },
  ];
  const actions = [
    { href: primaryHref, label: primaryLabel },
    { href: "#data/browse", label: "Data Library", secondary: true },
    { href: "#workbench/builder", label: "Builder", secondary: true },
    { href: "#workbench/run", label: "Run", secondary: true },
    { href: "#workbench/artifacts", label: "Artifacts", secondary: true },
    { href: "#performance", label: "Performance", secondary: true },
    { href: "#runs", label: "Runs", secondary: true },
  ];
  return { note: `${stateModel.result}: ${stateModel.note}`, cards, actions };
}

export function renderWorkbenchActionSummary(stateModel = workbenchHomeState()) {
  if (!$("workbench-action-note") || !$("workbench-action-cards") || !$("workbench-action-actions")) return;
  const model = workbenchActionSummaryModel(stateModel);
  $("workbench-action-note").textContent = model.note;
  $("workbench-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
  $("workbench-action-actions").innerHTML = model.actions.map((action) => (
    `<a${action.secondary ? ' class="secondary"' : ""} href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`
  )).join("");
}

export function workbenchExampleGalleryModel() {
  const options = state.configOptions || {};
  const plugins = options.plugins || [];
  const publicExamples = plugins.filter((plugin) => pluginBoundaryStatus(plugin) === "warn");
  const privatePlugins = plugins.filter((plugin) => pluginVisibilityBucket(plugin) === "private");
  const modes = (options.modes || ["replay"]).map(text).filter((mode) => mode !== "n/a");
  const defaultMode = modes.includes("replay") ? "replay" : modes[0] || "";
  const selected = selectedConfigDatasets();
  const selectedPlugin = selectedConfigPlugin();
  const registry = pluginRegistryPathSummary(options.plugin_registry_paths || []);
  const cards = publicExamples.map((plugin) => {
    const fieldCount = (plugin.strategy_fields || []).length;
    const resultCount = (plugin.result_fields || []).length;
    return {
      type: "public",
      status: "warn",
      pluginId: plugin.id,
      mode: defaultMode,
      label: "Public Example",
      title: text(plugin.label || plugin.id),
      note: text(plugin.description || "Generic no-edge wiring demo. Use it to learn the Workbench path, not as a viable strategy."),
      detail: `${numberText(fieldCount, 0)} field${fieldCount === 1 ? "" : "s"} / ${numberText(resultCount, 0)} result label${resultCount === 1 ? "" : "s"}; ${selected.length ? `${numberText(selected.length, 0)} selected file${selected.length === 1 ? "" : "s"}` : "choose saved data first"}.`,
      action: "select",
      actionLabel: "Use Example",
    };
  });
  if (privatePlugins.length) {
    cards.push({
      type: "private",
      status: selectedPlugin.id && pluginVisibilityBucket(selectedPlugin) === "private" ? "ok" : "warn",
      pluginId: privatePlugins[0].id,
      mode: defaultMode,
      label: "Ignored Local",
      title: `${numberText(privatePlugins.length, 0)} private/local plugin${privatePlugins.length === 1 ? "" : "s"}`,
      note: "Local registry metadata is loaded from ignored config files. Keep private strategy logic, tuned defaults, and private results out of public commits.",
      detail: registry.localCount ? `${numberText(registry.localCount, 0)} local registry path${registry.localCount === 1 ? "" : "s"} detected.` : "Private plugin metadata is available in this dashboard state.",
      action: "select-private",
      actionLabel: "Use Local",
    });
  } else {
    cards.push({
      type: "private",
      status: "idle",
      pluginId: "",
      mode: defaultMode,
      label: "Ignored Local",
      title: "No private registry loaded",
      note: "Copy the example registry to an ignored local file when you are ready to add private plugin metadata.",
      detail: `Registry paths: ${registry.label}.`,
      action: "registry-docs",
      actionLabel: "Open Docs",
    });
  }
  cards.push({
    type: "guardrail",
    status: "ok",
    pluginId: "",
    mode: defaultMode,
    label: "Boundary",
    title: "Examples are not strategies",
    note: "Gallery actions only select plugin and mode fields. Preview, validation, local save, and run controls stay in Builder and Run.",
    detail: modes.length ? `Available modes: ${modes.join(", ")}.` : "Mode options are loaded from the Workbench schema.",
    action: "builder",
    actionLabel: "Open Builder",
  });
  return {
    count: publicExamples.length,
    privateCount: privatePlugins.length,
    selectedCount: selected.length,
    cards,
  };
}

export function renderWorkbenchExampleGallery() {
  if (!$("workbench-example-gallery-note") || !$("workbench-example-gallery-cards")) return;
  const model = workbenchExampleGalleryModel();
  $("workbench-example-gallery-note").textContent = model.count
    ? `${numberText(model.count, 0)} public no-edge example${model.count === 1 ? "" : "s"}; ${numberText(model.privateCount, 0)} ignored local plugin${model.privateCount === 1 ? "" : "s"}; ${numberText(model.selectedCount, 0)} selected data file${model.selectedCount === 1 ? "" : "s"}.`
    : "No public example plugins loaded from the Workbench schema.";
  $("workbench-example-gallery-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)} workbench-example-card">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
      <small>${escapeHtml(card.detail)}</small>
      <button type="button" class="secondary" data-workbench-example-action="${escapeHtml(card.action)}" data-plugin-id="${escapeHtml(card.pluginId)}" data-mode="${escapeHtml(card.mode)}">${escapeHtml(card.actionLabel)}</button>
    </div>
  `).join("");
}

export function handleWorkbenchExampleGalleryAction(target) {
  const action = target.dataset.workbenchExampleAction || "";
  if (action === "registry-docs") {
    window.open("/docs/public_quickstart.md#workbench-config-builder", "_blank", "noreferrer");
    return;
  }
  if (action === "builder") {
    applyWorkbenchLens("builder");
    $("config-form").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  const pluginId = target.dataset.pluginId || "";
  const mode = target.dataset.mode || "";
  if (pluginId && $("config-plugin")) $("config-plugin").value = pluginId;
  if (mode && $("config-mode")) $("config-mode").value = mode;
  renderConfigLivePanels();
  applyWorkbenchLens("builder");
  const focusTarget = $("config-plugin") || $("config-form");
  if (focusTarget) {
    focusTarget.scrollIntoView({ block: "center", behavior: "smooth" });
    if (typeof focusTarget.focus === "function") focusTarget.focus({ preventScroll: true });
  }
  $("last-refresh").textContent = pluginId
    ? `Workbench example selected: ${pluginId}`
    : `Workbench builder opened: ${new Date().toLocaleString()}`;
}

export function renderWorkbenchSimulationPlan(stateModel = workbenchHomeState()) {
  if (!$("workbench-simulation-title") || !$("workbench-simulation-cards") || !$("workbench-simulation-actions")) return;
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
  const plugin = selectedConfigPlugin();
  const range = configDateRangePayload();
  const hasRange = Boolean(range.start || range.end);
  const alignmentReady = Boolean(alignment.dataset_count && Number(alignment.common_timestamp_count || 0) > 0);
  const runCompleted = Boolean(latestRun && latestRun.status === "completed");
  const hasDraft = Boolean(draft.yaml || savedDraft);
  const planStatus = stateModel.tiles.some((tile) => tile.status === "bad")
    ? "bad"
    : stateModel.tiles.some((tile) => tile.status === "warn") ? "warn" : "ok";
  $("workbench-simulation-title").textContent = stateModel.result;
  $("workbench-simulation-title").className = statusClass(planStatus);
  $("workbench-simulation-note").textContent = stateModel.note;
  const steps = [
    {
      label: "1. Select Data",
      title: selected.length ? `${numberText(selected.length, 0)} selected` : "Choose files",
      status: selected.length ? dataReadiness.status : "bad",
      note: selected.length ? dataReadiness.issueCount ? dataReadiness.reviewNote : dataReadiness.cleanNote : "Start in Data Library or Builder dataset controls.",
      href: "#data/browse",
    },
    {
      label: "2. Bound Window",
      title: hasRange ? "Date range set" : "Full history",
      status: selected.length ? hasRange ? "ok" : "warn" : "idle",
      note: hasRange ? timeRangeLabel(range.start, range.end) : "Optional, but useful when comparing runs or avoiding stale periods.",
      href: "#workbench/builder",
    },
    {
      label: "3. Preview Alignment",
      title: alignment.dataset_count ? `${numberText(alignment.common_timestamp_count, 0)} common` : "Not previewed",
      status: alignment.dataset_count ? alignmentReady ? Number(alignment.warning_count || 0) ? "warn" : "ok" : "bad" : selected.length ? "warn" : "idle",
      note: alignment.dataset_count ? `${pctText(alignment.common_coverage_pct)} common coverage; ${numberText(alignment.warning_count || 0, 0)} warning${Number(alignment.warning_count || 0) === 1 ? "" : "s"}.` : "Preview shared timestamps before generating YAML.",
      href: "#workbench/builder",
    },
    {
      label: "4. Pick Plugin",
      title: plugin.label || plugin.id || "No plugin",
      status: plugin.id ? pluginBoundaryStatus(plugin) : "idle",
      note: plugin.id ? text(plugin.description || plugin.boundary || "Review public/private boundary before saving.") : "Choose a public example or ignored local plugin.",
      href: "#workbench/builder",
    },
    {
      label: "5. Validate Draft",
      title: savedDraftId || (draft.yaml ? "Generated" : "No draft"),
      status: draftReady ? "ok" : hasDraft ? "warn" : alignmentReady ? "warn" : "idle",
      note: draftReady ? "Draft validation is clean enough to run." : hasDraft ? "Draft exists, but validation still needs review." : "Generate or preview draft YAML after data/plugin/risk review.",
      href: "#workbench/run",
    },
    {
      label: "6. Run And Inspect",
      title: hasArtifacts ? "Artifacts loaded" : latestRun ? text(latestRun.status) : "Not run",
      status: hasArtifacts ? "ok" : runCompleted ? "warn" : latestRun ? "warn" : draftReady ? "warn" : "idle",
      note: hasArtifacts ? "Open Performance for charts or Runs for events/logs." : runCompleted ? "Completed run has artifacts available; load them before reading results." : latestRun ? "Review run status before comparing results." : "Run validate/replay/simulated-paper after validation.",
      href: hasArtifacts ? "#performance" : "#workbench/run",
    },
  ];
  $("workbench-simulation-cards").innerHTML = steps.map((step) => `
    <a class="action-card workflow-card status-${escapeHtml(step.status)}" href="${escapeHtml(step.href)}">
      <span>${escapeHtml(step.label)}</span>
      <strong>${escapeHtml(step.title)}</strong>
      <small>${escapeHtml(step.note)}</small>
    </a>
  `).join("");
  $("workbench-simulation-actions").innerHTML = [
    `<a href="#workbench/builder">${selected.length ? "Open Builder" : "Choose Data"}</a>`,
    `<a class="secondary" href="#workbench/run">Run Draft</a>`,
    `<a class="secondary" href="${hasArtifacts ? "#performance" : "#workbench/artifacts"}">${hasArtifacts ? "Open Performance" : "Open Artifacts"}</a>`,
  ].join("");
}

export function renderWorkbenchReadinessReview(stateModel = workbenchHomeState()) {
  if (!$("workbench-readiness-note") || !$("workbench-readiness-cards") || !$("workbench-readiness-actions")) return;
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const savedDraft = selectedRunDraft();
  const savedDraftId = savedDraft ? savedDraft.draft_id : draft.name || ($("config-run-draft") && $("config-run-draft").value) || "";
  const validation = savedDraftId ? draftValidationById()[savedDraftId] : null;
  const plugin = selectedConfigPlugin();
  const latestRun = latestWorkbenchRunForDraft(savedDraftId);
  const artifacts = state.configArtifacts || {};
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id);
  const alignmentReady = Boolean(alignment.dataset_count && Number(alignment.common_timestamp_count || 0) > 0);
  const draftGenerated = Boolean(draft.yaml || savedDraft);
  const draftValid = draft.validation ? Boolean(draft.validation.valid) : Boolean(validation && validation.valid);
  const draftErrors = normalizeConfigDraftErrors(state.configDraftErrors || []);
  const runComplete = Boolean(latestRun && latestRun.status === "completed");
  const runIssue = Boolean(latestRun && latestRun.status && !["completed", "success", "ok"].includes(text(latestRun.status).toLowerCase()));
  const publicExample = plugin.visibility === "public_example";
  let status = "idle";
  let title = "Select Data";
  let note = "Start with saved historical data, then preview timestamp alignment before generating a replay draft.";
  let primaryHref = "#data/browse";
  let primaryLabel = "Select Data";
  if (selected.length && dataReadiness.issueCount) {
    status = dataReadiness.status;
    title = "Review Selected Data";
    note = dataReadiness.reviewNote;
    primaryHref = "#workbench/builder";
    primaryLabel = "Review Data";
  } else if (selected.length && !alignmentReady) {
    status = alignment.dataset_count ? "bad" : "warn";
    title = "Preview Alignment";
    note = alignment.dataset_count
      ? "Selected files do not expose a usable common timestamp window for this replay setup."
      : "Selected files need an alignment preview before draft generation.";
    primaryHref = "#workbench/builder";
    primaryLabel = "Preview Alignment";
  } else if (selected.length && alignmentReady && !plugin.id) {
    status = "idle";
    title = "Choose Plugin";
    note = "Pick a registered strategy plugin before generating a draft.";
    primaryHref = "#workbench/builder";
    primaryLabel = "Choose Plugin";
  } else if (selected.length && alignmentReady && !draftGenerated) {
    status = publicExample ? "warn" : "ok";
    title = "Generate Draft";
    note = publicExample
      ? "A bundled public strategy is selected; generate a replay draft against the selected data."
      : "Data and alignment are ready for draft preview/generation.";
    primaryHref = "#workbench/builder";
    primaryLabel = "Generate Draft";
  } else if (draftGenerated && !draftValid) {
    status = "bad";
    title = "Fix Draft";
    note = draftErrors.length ? draftErrors.join("; ") : "Draft exists but validation is not clean yet.";
    primaryHref = "#workbench/builder";
    primaryLabel = "Fix Builder";
  } else if (draftValid && !latestRun) {
    status = "warn";
    title = "Run Draft";
    note = "A valid saved draft is ready; run validate/replay from the Run lens before reading performance.";
    primaryHref = "#workbench/run";
    primaryLabel = "Open Run";
  } else if (latestRun && !hasArtifacts) {
    status = runComplete ? "warn" : runIssue ? "bad" : "warn";
    title = runComplete ? "Load Artifacts" : "Review Run";
    note = runComplete
      ? "The latest run completed, but artifacts are not loaded in the dashboard yet."
      : "The latest run needs review before performance can be trusted.";
    primaryHref = "#workbench/artifacts";
    primaryLabel = runComplete ? "Open Artifacts" : "Review Run";
  } else if (hasArtifacts) {
    status = "ok";
    title = "Inspect Results";
    note = "Artifacts are loaded; use Performance for charts and Runs for decisions, orders, fills, rejects, and logs.";
    primaryHref = "#performance";
    primaryLabel = "Open Performance";
  }
  $("workbench-readiness-note").textContent = `${title} - ${note}`;
  const alignmentStatus = alignment.dataset_count ? alignmentReady ? Number(alignment.warning_count || 0) ? "warn" : "ok" : "bad" : selected.length ? "warn" : "idle";
  const cards = [
    {
      label: "Selected Data",
      title: selected.length ? `${numberText(selected.length, 0)} file${selected.length === 1 ? "" : "s"}` : "none",
      status: selected.length ? dataReadiness.status : "idle",
      detail: selected.length ? dataReadiness.issueCount ? dataReadiness.reviewNote : dataReadiness.cleanNote : "Choose saved files from Data Library.",
    },
    {
      label: "Alignment",
      title: alignment.dataset_count ? `${numberText(alignment.common_timestamp_count, 0)} common` : "not previewed",
      status: alignmentStatus,
      detail: alignment.dataset_count ? `${pctText(alignment.common_coverage_pct)} common coverage / ${numberText(alignment.warning_count || 0, 0)} warnings.` : "Preview shared timestamps before generating.",
    },
    {
      label: "Plugin Boundary",
      title: plugin.label || plugin.id || "none",
      status: plugin.id ? pluginBoundaryStatus(plugin) : "idle",
      detail: plugin.id ? text(plugin.visibility || plugin.boundary || "registry metadata loaded") : "Choose a public example or local/private plugin.",
    },
    {
      label: "Draft",
      title: draftGenerated ? draftValid ? "valid" : "review" : "none",
      status: draftGenerated ? draftValid ? "ok" : "bad" : alignmentReady ? "warn" : "idle",
      detail: savedDraftId ? `${text(savedDraftId)}${validation ? ` / validation ${text(validation.status || validation.valid)}` : ""}` : draft.yaml ? "Generated YAML is not saved as a selected draft." : "Generate or preview YAML after setup.",
    },
    {
      label: "Latest Run",
      title: latestRun ? text(latestRun.status || latestRun.action || latestRun.run_id) : "not run",
      status: latestRun ? runComplete ? "ok" : runIssue ? "bad" : "warn" : draftValid ? "warn" : "idle",
      detail: latestRun ? `${text(latestRun.action || "run")} / ${text(latestRun.run_id || "no id")}` : "Run validate or replay after the draft is valid.",
    },
    {
      label: "Results",
      title: hasArtifacts ? "loaded" : latestRun && latestRun.artifact_path ? "available" : "missing",
      status: hasArtifacts ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "idle",
      detail: hasArtifacts ? "Performance and Runs can inspect loaded artifacts." : "Load run artifacts before interpreting charts or trades.",
    },
  ];
  $("workbench-readiness-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
  $("workbench-readiness-actions").innerHTML = [
    `<a href="${escapeHtml(primaryHref)}">${escapeHtml(primaryLabel)}</a>`,
    `<a class="secondary" href="#workbench/builder">Builder</a>`,
    `<a class="secondary" href="#workbench/run">Run</a>`,
    `<a class="secondary" href="#workbench/artifacts">Artifacts</a>`,
    `<a class="secondary" href="#runs">Runs</a>`,
  ].join("");
}

export function workbenchEvidenceModel() {
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const savedDraft = selectedRunDraft();
  const savedDraftId = savedDraft ? savedDraft.draft_id : draft.name || ($("config-run-draft") && $("config-run-draft").value) || "";
  const validation = savedDraftId ? draftValidationById()[savedDraftId] : null;
  const plugin = selectedConfigPlugin();
  const latestRun = latestWorkbenchRunForDraft(savedDraftId) || ((state.configRuns && state.configRuns.runs) || [])[0] || null;
  const artifacts = state.configArtifacts || {};
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id);
  const hasDraft = Boolean(draft.yaml || savedDraft);
  const draftErrors = normalizeConfigDraftErrors(state.configDraftErrors || []);
  const generatedValid = draft.validation ? Boolean(draft.validation.valid) : false;
  const savedValid = Boolean(savedDraft && validation && validation.valid);
  const draftValid = generatedValid || savedValid;
  const commonTimestamps = Number(alignment.common_timestamp_count || 0);
  const alignmentWarnings = Number(alignment.warning_count || (alignment.warnings || []).length || 0);
  const alignmentReady = Boolean(alignment.dataset_count && commonTimestamps > 0);
  const latestRunComplete = Boolean(latestRun && latestRun.status === "completed");
  const latestRunIssue = Boolean(latestRun && latestRun.status && !["completed", "success", "ok"].includes(text(latestRun.status).toLowerCase()));
  const artifactsMatchRun = !hasArtifacts || !latestRun || !artifacts.run_id || !latestRun.run_id || artifacts.run_id === latestRun.run_id;
  let headlineStatus = "idle";
  let headline = "No Workbench evidence";
  let note = "Select saved data before trusting a replay or simulated-paper workflow.";
  if (hasArtifacts) {
    headlineStatus = artifactsMatchRun ? "ok" : "warn";
    headline = artifactsMatchRun ? "Artifact-backed workflow" : "Loaded artifact differs from latest run";
    note = `${text(artifacts.draft_id || savedDraftId || "draft")} artifacts are loaded for Performance, Runs, and Artifacts review.`;
  } else if (latestRunComplete && latestRun.artifact_path) {
    headlineStatus = "warn";
    headline = "Completed run needs loading";
    note = `${text(latestRun.run_id || latestRun.draft_id)} completed, but artifacts are not loaded in this dashboard session.`;
  } else if (latestRun) {
    headlineStatus = latestRunIssue ? "bad" : "warn";
    headline = "Run evidence exists";
    note = `${text(latestRun.action || "run")} ${text(latestRun.status || "unknown")} for ${text(latestRun.draft_id || savedDraftId || "draft")}.`;
  } else if (draftValid) {
    headlineStatus = "warn";
    headline = "Draft evidence only";
    note = "A valid draft is available, but no replay or simulated-paper run has produced artifacts yet.";
  } else if (hasDraft) {
    headlineStatus = "bad";
    headline = "Draft needs validation";
    note = draftErrors.length ? draftErrors.slice(0, 2).join("; ") : "A draft exists, but validation evidence is not clean.";
  } else if (alignmentReady && plugin.id) {
    headlineStatus = pluginBoundaryStatus(plugin) === "warn" ? "warn" : "ok";
    headline = "Ready to draft";
    note = "Selected data, alignment, and plugin metadata are ready for draft generation.";
  } else if (selected.length) {
    headlineStatus = alignment.dataset_count ? "bad" : "warn";
    headline = "Data evidence selected";
    note = "Selected files need alignment, plugin, draft, run, and artifact evidence before performance review.";
  }
  const selectedSymbols = selected.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a");
  const cards = [
    {
      label: "Evidence Chain",
      status: headlineStatus,
      title: headline,
      note,
      className: statusClass(headlineStatus),
    },
    {
      label: "Selected Data",
      status: selected.length ? dataReadiness.status : "idle",
      title: selected.length ? `${numberText(selected.length, 0)} file${selected.length === 1 ? "" : "s"}` : "None",
      note: selected.length
        ? `${selectedSymbols.slice(0, 5).join(", ") || "selected files"}; ${dataReadiness.summary}.`
        : "Choose saved data from Data Library, Compare, Fetch Outputs, or Builder.",
      className: statusClass(selected.length ? dataReadiness.status : "idle"),
    },
    {
      label: "Alignment",
      status: alignment.dataset_count ? alignmentReady ? alignmentWarnings ? "warn" : "ok" : "bad" : selected.length ? "warn" : "idle",
      title: alignment.dataset_count ? `${numberText(commonTimestamps, 0)} common` : "Not previewed",
      note: alignment.dataset_count
        ? `${pctText(alignment.common_coverage_pct)} common coverage; ${numberText(alignmentWarnings, 0)} warning${alignmentWarnings === 1 ? "" : "s"}.`
        : "Preview shared timestamps before generating YAML.",
      className: statusClass(alignment.dataset_count ? alignmentReady ? alignmentWarnings ? "warn" : "ok" : "bad" : selected.length ? "warn" : "idle"),
    },
    {
      label: "Plugin",
      status: plugin.id ? pluginBoundaryStatus(plugin) : "idle",
      title: plugin.label || plugin.id || "None",
      note: plugin.id
        ? `${text(plugin.visibility || plugin.status || "registry")}; ${text(plugin.description || plugin.boundary || "review registry metadata")}.`
        : "Choose a public example plugin or ignored local plugin.",
      className: statusClass(plugin.id ? pluginBoundaryStatus(plugin) : "idle"),
    },
    {
      label: "Draft",
      status: hasDraft ? draftValid ? "ok" : "bad" : alignmentReady ? "warn" : "idle",
      title: savedDraftId || (draft.yaml ? "Generated" : "Missing"),
      note: hasDraft
        ? draftValid ? "Validation evidence is clean enough to run." : "Validation failed or has not passed."
        : "Generate and save a draft before running.",
      className: statusClass(hasDraft ? draftValid ? "ok" : "bad" : alignmentReady ? "warn" : "idle"),
    },
    {
      label: "Run And Results",
      status: hasArtifacts ? artifactsMatchRun ? "ok" : "warn" : latestRun ? latestRunComplete ? "warn" : latestRunIssue ? "bad" : "warn" : draftValid ? "warn" : "idle",
      title: hasArtifacts ? "Artifacts loaded" : latestRun ? text(latestRun.status || latestRun.action) : "Not run",
      note: hasArtifacts
        ? `${text(artifacts.run_id || artifacts.draft_id)} loaded.`
        : latestRun
          ? `${text(latestRun.action)} ${text(latestRun.run_id || latestRun.draft_id || "run")} ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.`
          : "Run validate, replay, or simulated paper after validation.",
      className: statusClass(hasArtifacts ? artifactsMatchRun ? "ok" : "warn" : latestRun ? latestRunComplete ? "warn" : latestRunIssue ? "bad" : "warn" : draftValid ? "warn" : "idle"),
    },
  ];
  const range = configDateRangePayload();
  const lines = [
    {
      status: selected.length ? dataReadiness.status : "idle",
      title: "Data Evidence",
      detail: selected.length
        ? `${numberText(selected.length, 0)} selected file${selected.length === 1 ? "" : "s"} across ${Array.from(new Set(selected.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a"))).join(", ") || "unknown bar sizes"}; replay window ${range.start || "first bar"} to ${range.end || "last bar"}.`
        : "No saved files are selected for the workflow.",
    },
    {
      status: alignment.dataset_count ? alignmentReady ? alignmentWarnings ? "warn" : "ok" : "bad" : selected.length ? "warn" : "idle",
      title: "Alignment Evidence",
      detail: alignment.dataset_count
        ? `${numberText(commonTimestamps, 0)} common timestamps from ${text(alignment.common_first_timestamp || "n/a")} to ${text(alignment.common_last_timestamp || "n/a")}; ${pctText(alignment.common_coverage_pct)} common coverage.`
        : "No alignment preview is loaded for the current selected data packet.",
    },
    {
      status: plugin.id ? pluginBoundaryStatus(plugin) : "idle",
      title: "Plugin Boundary",
      detail: plugin.id
        ? `${text(plugin.id)} is ${text(plugin.visibility || plugin.status || "registry")}; bundled strategies run through the generic runner and private plugins should stay in ignored local config.`
        : "No Workbench plugin is selected.",
    },
    {
      status: hasDraft ? draftValid ? "ok" : "bad" : "warn",
      title: "Draft Evidence",
      detail: hasDraft
        ? `${savedDraftId || draft.name || "generated draft"} ${draftValid ? "has passing validation evidence" : "does not have passing validation evidence"}${draft.saved_path ? `; saved at ${text(draft.saved_path)}` : savedDraft && savedDraft.path ? `; saved at ${text(savedDraft.path)}` : ""}.`
        : "No generated or saved draft is active for this workflow.",
    },
    {
      status: latestRun ? latestRunComplete ? "ok" : latestRunIssue ? "bad" : "warn" : draftValid ? "warn" : "idle",
      title: "Run Evidence",
      detail: latestRun
        ? `${text(latestRun.action || "run")} ${text(latestRun.status || "unknown")} for ${text(latestRun.draft_id || savedDraftId || "draft")}; artifact path ${text(latestRun.artifact_path || "not recorded")}.`
        : "No recent Workbench run is attached to the active draft.",
    },
    {
      status: hasArtifacts ? artifactsMatchRun ? "ok" : "warn" : latestRunComplete && latestRun.artifact_path ? "warn" : "idle",
      title: "Artifact Evidence",
      detail: hasArtifacts
        ? `Loaded artifact ${text(artifacts.run_id || artifacts.draft_id)}${artifactsMatchRun ? " matches the current run context or no newer run is selected" : " differs from the latest selected run"}.`
        : latestRunComplete && latestRun.artifact_path ? "A completed run has artifacts available; load them before reading performance." : "No run artifacts are loaded.",
    },
  ];
  const next = !selected.length
    ? { label: "Select Data", href: "#data/browse", status: "idle" }
    : !alignmentReady
      ? { label: "Preview Alignment", href: "#workbench/builder", status: "warn" }
      : !plugin.id
        ? { label: "Choose Plugin", href: "#workbench/builder", status: "idle" }
        : !draftValid
          ? { label: "Validate Draft", href: "#workbench/run", status: "idle" }
          : !latestRun
            ? { label: "Run Draft", href: "#workbench/run", status: "warn" }
            : !hasArtifacts
              ? { label: "Load Artifacts", href: "#workbench/artifacts", status: "warn" }
              : { label: "Open Performance", href: "#performance", status: "ok" };
  lines.push({
    status: next.status,
    title: "Next Verification",
    detail: `${next.label}: ${next.href.replace("#", "")}.`,
  });
  return {
    headline,
    note: `${headline} / next: ${next.label}`,
    cards,
    lines,
    next,
  };
}

export function workbenchEvidenceText(model) {
  return [
    `Workbench Evidence: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

export function renderWorkbenchEvidence() {
  if (!$("workbench-evidence-note") || !$("workbench-evidence-cards") || !$("workbench-evidence-body") || !$("workbench-evidence-actions")) return;
  const model = workbenchEvidenceModel();
  state.workbenchEvidenceText = workbenchEvidenceText(model);
  $("workbench-evidence-note").textContent = model.note;
  $("workbench-evidence-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong class="${escapeHtml(card.className || statusClass(card.status))}">${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-evidence-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("workbench-evidence-actions").innerHTML = [
    `<button type="button" data-workbench-evidence-action="copy">Copy Evidence</button>`,
    `<a class="secondary" href="${escapeHtml(model.next.href)}">${escapeHtml(model.next.label)}</a>`,
    `<a class="secondary" href="#workbench/run">Run</a>`,
    `<a class="secondary" href="#performance">Performance</a>`,
  ].join("");
}

export function handleWorkbenchEvidenceAction(action) {
  if (action !== "copy") return;
  copyText(state.workbenchEvidenceText || "No workbench evidence loaded").then(() => {
    $("last-refresh").textContent = "Workbench evidence copied";
  }).catch((err) => {
    $("last-refresh").textContent = `Workbench evidence copy failed: ${err.message}`;
  });
}

export function workbenchWorkflowCards() {
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
      status: hasAlignment ? commonTimestamps > 0 ? alignmentWarnings ? "warn" : "ok" : "bad" : selected.length ? "warn" : "idle",
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
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : draftValid ? "warn" : "idle",
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
      status: hasArtifacts ? "ok" : latestRun && latestRun.artifact_path ? "warn" : latestRun ? "bad" : "idle",
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
      status: plugin.visibility === "public_example" || plugin.status === "example_only" ? "warn" : plugin.id ? "ok" : "idle",
      detail: plugin.id
        ? text(plugin.boundary || "Registered strategy metadata loaded for this draft.")
        : "Choose a configured Workbench plugin before generating a draft.",
      href: workflowHref("workbench", "builder"),
      cta: "Review",
    },
  ];
}

export function renderWorkbenchWorkflowLauncher() {
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

export function handleWorkbenchHomeAction(action) {
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

export function activateWorkbenchGuideAction(target) {
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

export function selectedConfigPlugin() {
  const pluginId = $("config-plugin") ? $("config-plugin").value : "";
  return ((state.configOptions && state.configOptions.plugins) || []).find((plugin) => plugin.id === pluginId) || {};
}

export function pluginBoundaryStatus(plugin) {
  if (!plugin || !plugin.id) return "bad";
  const visibility = text(plugin.visibility || plugin.status).toLowerCase();
  return visibility === "public_example" || visibility === "example_only" ? "warn" : "ok";
}

export function pluginVisibilityBucket(plugin) {
  const visibility = text((plugin || {}).visibility || (plugin || {}).status).toLowerCase();
  if (visibility === "public_example" || visibility === "example_only") return "public";
  if (visibility === "private_local" || visibility.includes("private") || visibility.includes("local")) return "private";
  return "other";
}

export function pluginRegistryPathSummary(paths) {
  const visible = (paths || []).map((path) => text(path)).filter((path) => path !== "n/a");
  const localCount = visible.filter((path) => /(^|\/)plugin_registry_local\.ya?ml$|(^|\/)local/i.test(path)).length;
  return {
    count: visible.length,
    localCount,
    label: visible.length ? visible.slice(0, 2).join("; ") : "none configured",
  };
}

export function renderWorkbenchPluginBoundary() {
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
      label: "Bundled Strategies",
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
      status: strategyFields.length || resultFields.length ? "ok" : selected.id ? "warn" : "idle",
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
      note: "Read the Help view notes on bundled strategies versus private local config.",
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

export function handleWorkbenchPluginBoundaryAction(action) {
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

export function renderConfigPluginBoundary() {
  if (!$("config-plugin-boundary") || !$("config-plugin-boundary-note")) return;
  const plugin = selectedConfigPlugin();
  const visibility = plugin.visibility || plugin.status || "unknown";
  $("config-plugin-boundary-note").innerHTML = visibility === "public_example"
    ? `<span class="status-warn">bundled public strategy</span>`
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

export function pluginFieldMetaLine(field) {
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

export function renderPluginFieldHelpCard(field, groupLabel) {
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

export function renderPluginResultSectionHelpCard(section, resultFields) {
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

export function renderPluginResultWidgetHelpCard(widget, resultFields) {
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
  const chartDetail = text(widget.kind) === "custom_chart"
    ? ` / ${text(widget.chart_kind || "line_chart")} / ${numberText(widget.point_limit || 80, 0)} pts`
    : widget.point_limit ? ` / ${numberText(widget.point_limit, 0)} pts` : "";
  return `
    <article class="plugin-field-help-card status-${escapeHtml(status)}">
      <span>Result Widget ${escapeHtml(text(widget.kind || "cards"))}${escapeHtml(chartDetail)}</span>
      <strong>${escapeHtml(text(widget.label || widget.id))}</strong>
      <small class="mono">${escapeHtml(fieldPaths)}</small>
      <p>${escapeHtml(help)}</p>
      <small>${escapeHtml(`${numberText(fields.length, 0)} displayed field${fields.length === 1 ? "" : "s"}: ${fieldLabels}`)}</small>
    </article>
  `;
}

export function pluginValidationRuleDetail(rule) {
  const type = text(rule.type);
  if (type === "required") return `strategy.${text(rule.field)} is required.`;
  if (type === "require_any") {
    const fields = (rule.fields || []).map((field) => `strategy.${text(field)}`).join(", ");
    return `At least ${numberText(rule.min_count || 1, 0)} of ${fields || "declared fields"} must be set.`;
  }
  if (type === "comparison") {
    const right = rule.other_field ? `strategy.${text(rule.other_field)}` : numberText(rule.value, 4);
    return `strategy.${text(rule.field)} ${text(rule.operator)} ${right}.`;
  }
  return "Public-safe plugin validation rule.";
}

export function renderPluginValidationRuleHelpCard(rule) {
  const help = text(rule.help || rule.description || rule.error || "Public-safe plugin-authored validation metadata.");
  return `
    <article class="plugin-field-help-card status-warn">
      <span>Validation Rule</span>
      <strong>${escapeHtml(text(rule.label || rule.id))}</strong>
      <small class="mono">${escapeHtml(pluginValidationRuleDetail(rule))}</small>
      <p>${escapeHtml(help)}</p>
      <small>${escapeHtml(text(rule.error || "Server validation enforces this rule before a draft can run."))}</small>
    </article>
  `;
}

export function renderConfigPluginFieldHelp() {
  if (!$("config-plugin-field-help") || !$("config-plugin-field-help-note")) return;
  const plugin = selectedConfigPlugin();
  const strategyFields = (plugin.strategy_fields || []).filter((field) => field && field.name);
  const validationRules = (plugin.validation_rules || []).filter((rule) => rule && rule.id);
  const resultFields = (plugin.result_fields || []).filter((field) => field && field.name);
  const resultSections = (plugin.result_sections || []).filter((section) => section && section.id);
  const resultWidgets = (plugin.result_widgets || []).filter((widget) => widget && widget.id);
  $("config-plugin-field-help-note").textContent = plugin.id
    ? `${numberText(strategyFields.length, 0)} input field${strategyFields.length === 1 ? "" : "s"} / ${numberText(validationRules.length, 0)} validation rule${validationRules.length === 1 ? "" : "s"} / ${numberText(resultFields.length, 0)} result field${resultFields.length === 1 ? "" : "s"} / ${numberText(resultSections.length, 0)} result section${resultSections.length === 1 ? "" : "s"} / ${numberText(resultWidgets.length, 0)} result widget${resultWidgets.length === 1 ? "" : "s"} for ${text(plugin.label || plugin.id)}`
    : "Choose a plugin to see public-safe field help.";
  const cards = [
    ...strategyFields.map((field) => renderPluginFieldHelpCard(field, "Input")),
    ...validationRules.map((rule) => renderPluginValidationRuleHelpCard(rule)),
    ...resultFields.map((field) => renderPluginFieldHelpCard(field, "Result")),
    ...resultSections.map((section) => renderPluginResultSectionHelpCard(section, resultFields)),
    ...resultWidgets.map((widget) => renderPluginResultWidgetHelpCard(widget, resultFields)),
  ];
  $("config-plugin-field-help").innerHTML = cards.length
    ? cards.join("")
    : `<div class="empty-card"><strong>No plugin field metadata</strong><span>Declare public-safe strategy_fields, result_fields, result_sections, and result_widgets in the plugin registry to explain configuration inputs and artifact diagnostics.</span></div>`;
}

export function renderConfigBrokerBoundary() {
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

export function selectedCompareDatasets() {
  const selectedPaths = state.dataCompareSelectedPaths.length
    ? state.dataCompareSelectedPaths
    : Array.from($("data-compare-datasets").selectedOptions).map((option) => option.value);
  return (state.dataCatalog.datasets || []).filter((item) => selectedPaths.includes(item.path));
}

export function updateCompareSelectionFromSelect(announce = false) {
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

export function selectedCompareRangeBounds() {
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

export async function applyDataCompareRangePreset() {
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
