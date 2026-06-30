import {
  $,
  MAX_DATA_COMPARE_DATASETS,
  bytes,
  escapeHtml,
  interval,
  navigateToDataLens,
  navigateToWorkbenchLens,
  numberText,
  pctText,
  row,
  signedValueHtml,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { applyDataCompareRangePreset, attachDatasetOptionMetadata, rememberWorkbenchDataset, selectedCompareDatasets, selectedCompareRangeBounds, setWorkbenchSelectedDatasetPaths, updateCompareSelectionFromSelect, workbenchDatasetOptionLabel } from "./20_workbench_foundation.js";
import { finiteNumber, timestampAgeLabel, timestampMillis } from "./30_runtime_core.js";
import { candlestickChart, compareChart, detailChart, formatTimestampForMode, timeRangeLabel, timezoneLabel } from "./34_charts.js";
import { bestCatalogDatasetForSymbol, countBy, countSummary, dataCatalogFilters, filteredDataCatalog, renderSymbolBrowser, sortDataCatalogRows } from "./40_data_catalog.js";
import { compareSelectedSymbolDatasets } from "./42_data_symbols.js";
import { renderConfigLivePanels, replaceOptions } from "./60_workbench_builder.js";
import {
  copyDataCompareJson,
  downloadDataCompareCsv,
  downloadDataDetailRangeCsv,
  focusDataDetailLargestGap,
  largestDataDetailGap,
  loadDataCompare,
  loadDataDetail,
  loadDataDetailForSymbol,
  reloadDataDetail,
} from "./90_bootstrap.js";

export function dataDetailActionSummaryModel(detail = {}, timezoneMode = "utc") {
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const typedSymbol = ($("data-detail-symbol") && $("data-detail-symbol").value.trim().toUpperCase()) || "";
  const opened = Boolean(detail && detail.path);
  const symbol = opened ? text(detail.symbol).toUpperCase() : typedSymbol;
  const best = symbol ? bestCatalogDatasetForSymbol(symbol) : null;
  const matchingFiles = symbol
    ? datasets.filter((dataset) => text(dataset.symbol).toUpperCase() === symbol && dataset.path)
    : [];
  if (!opened) {
    const catalogStatus = datasets.length ? "ok" : "idle";
    const symbolStatus = symbol ? best ? "ok" : "warn" : "warn";
    const note = datasets.length
      ? symbol
        ? best
          ? `Best ${symbol} file is ready to open: ${text(best.bar_size)} from ${text(best.source)}.`
          : `${symbol} is not visible in the loaded catalog; diagnose roots, filters, or fetch output.`
        : "Enter a scanned symbol, pick a catalog row, or browse the symbol directory."
      : "No catalog rows are loaded; refresh Data Library or configure data roots.";
    return {
      note,
      cards: [
        {
          status: catalogStatus,
          label: "Catalog",
          title: datasets.length ? `${numberText(datasets.length, 0)} files` : "No Files",
          note: datasets.length ? "Saved files are available for offline inspection." : "Load or configure saved-data roots first.",
        },
        {
          status: symbolStatus,
          label: "Symbol",
          title: symbol || "Choose One",
          note: symbol ? `${numberText(matchingFiles.length, 0)} matching scanned file${matchingFiles.length === 1 ? "" : "s"}.` : "Use Jump to Symbol or Browse.",
        },
        {
          status: best ? "ok" : "warn",
          label: "Best File",
          title: best ? `${text(best.bar_size)} ${text(best.source)}` : "None Selected",
          note: best ? `${numberText(best.rows, 0)} rows; ${text(best.quality_status || "unknown")} quality.` : "Open a catalog file before charting or replay handoff.",
        },
        {
          status: best ? "ok" : datasets.length ? "warn" : "bad",
          label: "Next Move",
          title: best ? "Open Best File" : datasets.length ? "Browse Data" : "Fix Roots",
          note: best ? "Open the file and inspect chart, gaps, and metadata." : datasets.length ? "Browse or diagnose the symbol before opening detail." : "Use Diagnostics to explain missing roots or scanner state.",
        },
      ],
      actions: [
        { action: "open-best", label: "Open", title: "Open Best File", disabled: !best },
        { action: "browse", label: "Browse", title: "Browse Catalog", disabled: !datasets.length },
        { action: "diagnostics", label: "Diagnose", title: "Open Diagnostics", disabled: false },
      ],
    };
  }
  const coverage = detail.coverage || {};
  const quality = detail.quality || {};
  const viewer = detail.viewer || {};
  const qualityStatus = text(quality.quality_status || "unknown");
  const contractStatus = text(detail.storage_contract_status || "unknown");
  const warnings = Array.isArray(quality.quality_warnings) ? quality.quality_warnings : [];
  const contractWarnings = Array.isArray(detail.storage_contract_warnings) ? detail.storage_contract_warnings : [];
  const duplicateRows = finiteNumber(coverage.duplicate_timestamps) || 0;
  const missingIntervals = finiteNumber(coverage.estimated_missing_intervals) || 0;
  const nullRows = Object.values(quality.null_counts || {}).reduce((sum, value) => sum + (Number(value) || 0), 0);
  const largestGap = largestDataDetailGap(detail);
  const viewerStatus = text(viewer.status || (viewer.sampled ? "sampled" : "full"));
  const chartBad = viewerStatus === "empty_range" || viewerStatus === "unavailable";
  const blocked = qualityStatus === "bad" || contractStatus === "bad" || duplicateRows > 0 || chartBad;
  const review = !blocked && (
    qualityStatus === "warn" ||
    contractStatus === "warn" ||
    warnings.length ||
    contractWarnings.length ||
    nullRows > 0 ||
    missingIntervals > 0 ||
    viewer.sampled
  );
  const readinessStatus = blocked ? "bad" : review ? "warn" : "ok";
  const nextTitle = chartBad
    ? "Reload Or Widen Range"
    : blocked
      ? "Fix Before Replay"
      : largestGap
        ? "Inspect Largest Gap"
        : review
          ? "Review Warnings"
          : "Use In Workbench";
  const nextNote = chartBad
    ? "The selected range has no usable chart rows; reload after widening the range or use Full file."
    : blocked
      ? "Bad quality, metadata, duplicate timestamps, or chart availability blocks a clean replay handoff."
      : largestGap
        ? "Focus the largest gap before deciding whether the selected range is usable."
        : review
          ? "Warnings do not necessarily block inspection, but review them before simulation."
          : "This saved file and range are ready for Workbench or comparison.";
  return {
    note: `${text(detail.symbol)} ${text(detail.bar_size)} / ${text(detail.source)} / ${timeRangeLabel(viewer.first_timestamp || coverage.first_timestamp, viewer.last_timestamp || coverage.last_timestamp, timezoneMode)}.`,
    cards: [
      {
        status: readinessStatus,
        label: "Replay Readiness",
        title: blocked ? "Blocked" : review ? "Review" : "Ready",
        note: nextNote,
      },
      {
        status: chartBad ? "bad" : viewer.sampled ? "warn" : "ok",
        label: "Viewer",
        title: chartBad ? "No Rows" : viewer.sampled ? "Sampled" : "Full",
        note: `${numberText(viewer.sampled_points, 0)} plotted / ${numberText(viewer.filtered_rows, 0)} filtered rows.`,
      },
      {
        status: missingIntervals || largestGap ? "warn" : "ok",
        label: "Gaps",
        title: largestGap ? interval(largestGap.gap_seconds) : missingIntervals ? `${numberText(missingIntervals, 0)} missing` : "None",
        note: missingIntervals ? `${numberText(missingIntervals, 0)} estimated missing interval${missingIntervals === 1 ? "" : "s"}.` : "No returned gap pressure in this detail response.",
      },
      {
        status: duplicateRows ? "bad" : nullRows ? "warn" : "ok",
        label: "Integrity",
        title: `${numberText(duplicateRows, 0)} dup / ${numberText(nullRows, 0)} null`,
        note: duplicateRows ? "Duplicate timestamps should be fixed before replay." : nullRows ? "Nulls need review before replay." : "No duplicate/null pressure reported.",
      },
      {
        status: contractStatus === "bad" ? "bad" : contractStatus === "warn" ? "warn" : "ok",
        label: "Metadata",
        title: contractStatus,
        note: contractWarnings.length ? contractWarnings.slice(0, 2).join("; ") : "Storage-contract metadata is acceptable.",
      },
      {
        status: readinessStatus,
        label: "Next Move",
        title: nextTitle,
        note: nextNote,
      },
    ],
    actions: [
      { action: "reload", label: "Reload", title: "Reload View", disabled: false },
      { action: "gap", label: "Gap", title: "Focus Largest Gap", disabled: !largestGap },
      { action: "workbench", label: "Workbench", title: "Use In Workbench", disabled: false },
      { action: "compare", label: "Compare", title: "Compare Symbol", disabled: matchingFiles.length < 2 },
      { action: "export-range", label: "Export", title: "Export Range CSV", disabled: false },
    ],
  };
}

export function renderDataDetailActionSummary(detail = {}, timezoneMode = "utc") {
  if (!$("data-detail-action-note") || !$("data-detail-action-cards") || !$("data-detail-action-actions")) return;
  const model = dataDetailActionSummaryModel(detail, timezoneMode);
  $("data-detail-action-note").textContent = model.note;
  $("data-detail-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-detail-action-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="${action.disabled ? "secondary" : ""}" data-data-detail-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>${escapeHtml(action.title)}</span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

export async function handleDataDetailAction(action) {
  if (action === "open-best") {
    await loadDataDetailForSymbol();
    return;
  }
  if (action === "browse") {
    navigateToDataLens("browse");
    return;
  }
  if (action === "diagnostics") {
    navigateToDataLens("diagnostics");
    return;
  }
  if (action === "reload") {
    await reloadDataDetail({ preventDefault() {} });
    return;
  }
  if (action === "gap") {
    await focusDataDetailLargestGap();
    return;
  }
  if (action === "workbench") {
    useDataDetailInWorkbench();
    return;
  }
  if (action === "compare") {
    const detail = state.dataDetail || {};
    const symbol = text(detail.symbol).toUpperCase();
    if (symbol && symbol !== "N/A") $("data-symbol-browser-input").value = symbol;
    renderSymbolBrowser();
    await compareSelectedSymbolDatasets();
    navigateToDataLens("compare");
    return;
  }
  if (action === "export-range") {
    await downloadDataDetailRangeCsv();
  }
}

export function renderDataDetail() {
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
  renderDataDetailActionSummary(detail, timezoneMode);
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

export function previewCloseReturn(points = []) {
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

export function renderDataDetailRangeStats(detail = {}, timezoneMode = "utc") {
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

export function dataDetailNavigationModel(detail = {}) {
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

export function renderDataDetailNavigator(detail = {}) {
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

export async function openAdjacentDataDetail(direction) {
  const model = dataDetailNavigationModel(state.dataDetail || {});
  const target = direction < 0 ? model.previous : model.next;
  if (!target || !target.path) {
    $("data-detail-nav-note").textContent = direction < 0 ? "No previous catalog file in this browse set." : "No next catalog file in this browse set.";
    return;
  }
  await loadDataDetail(target.path, { resetControls: true });
  $("data-detail-nav-note").textContent = `Opened ${text(target.symbol)} ${text(target.bar_size)} from ${text(target.source)}.`;
}

export function dateInputValueFromTimestamp(value) {
  const millis = timestampMillis(value);
  return millis === null ? "" : new Date(millis).toISOString().slice(0, 10);
}

export function dataDetailWorkbenchDateRange(detail) {
  const coverage = (detail && detail.coverage) || {};
  const viewer = (detail && detail.viewer) || {};
  return {
    start: $("data-detail-start").value || dateInputValueFromTimestamp(viewer.first_timestamp || coverage.first_timestamp),
    end: $("data-detail-end").value || dateInputValueFromTimestamp(viewer.last_timestamp || coverage.last_timestamp),
  };
}

export function useDataDetailInWorkbench() {
  const detail = state.dataDetail || {};
  const path = detail.path || state.dataDetailPath;
  if (!path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Open a saved dataset first</span>`;
    return;
  }
  const datasetSelect = $("config-dataset");
  if (!datasetSelect) return;
  const dataset = rememberWorkbenchDataset({
    path,
    symbol: detail.symbol,
    canonical_symbol: detail.canonical_symbol || detail.symbol,
    asset_class: detail.asset_class,
    source: detail.source,
    bar_size: detail.bar_size,
    storage_session: detail.storage_session,
    adjustment_status: detail.adjustment_status,
    storage_contract_status: (detail.storage_contract || {}).status || detail.storage_contract_status,
    storage_contract_warning_count: (detail.storage_contract || {}).warning_count,
    quality_status: (detail.quality || {}).quality_status,
    quality_warning_count: (detail.quality || {}).quality_warning_count,
    rows: detail.rows,
    first_timestamp: (detail.coverage || {}).first_timestamp,
    last_timestamp: (detail.coverage || {}).last_timestamp,
    size_bytes: detail.size_bytes,
    modified_at: detail.modified_at,
    root: detail.root,
    format: detail.format,
  });
  let found = false;
  setWorkbenchSelectedDatasetPaths([path]);
  for (const option of datasetSelect.options) {
    option.selected = option.value === path;
    if (option.value === path) {
      attachDatasetOptionMetadata(option, dataset);
      found = true;
    }
  }
  if (!found) {
    const option = document.createElement("option");
    option.value = path;
    option.textContent = workbenchDatasetOptionLabel(dataset);
    option.selected = true;
    attachDatasetOptionMetadata(option, dataset);
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

export function renderDataDetailAssistant(detail = {}, timezoneMode = "utc") {
  if (!$("data-detail-assistant-title") || !$("data-detail-assistant-cards") || !$("data-detail-assistant-actions")) return;
  const path = detail && detail.path;
  if (!path) {
    $("data-detail-assistant-title").textContent = "Open a saved file";
    $("data-detail-assistant-note").textContent = "Use Jump to Symbol, Symbol Browser, or a catalog row to inspect saved history before simulating.";
    $("data-detail-assistant-cards").innerHTML = [
      {
        status: "idle",
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

export function dataDetailAssistantActionsHtml(actions = []) {
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

export async function handleDataDetailAssistantAction(action) {
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

export function renderDataDetailOverview(detail, timezoneMode = "utc") {
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
      status: selectedSymbol ? matchingSymbolFiles.length ? "ok" : "warn" : datasets.length ? "warn" : "idle",
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

export function dataDetailHealthCards(detail, timezoneMode = "utc") {
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

export function renderDataCompareControls() {
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
  renderDataCompareActionSummary(state.dataCompare || {}, $("data-compare-timezone").value || "utc");
  renderDataCompareAssistant(state.dataCompare || {}, $("data-compare-timezone").value || "utc");
}

export function renderDataCompareFilterOptions(datasets) {
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

export function selectShownCompareDatasets() {
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

export function selectSymbolCompareDatasets() {
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

export function clearCompareSelection() {
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

export function useDataCompareInWorkbench() {
  const selected = selectedCompareDatasets();
  if (!selected.length) {
    $("data-compare-note").innerHTML = `<span class="status-bad">Select at least one saved dataset before sending to Workbench</span>`;
    return;
  }
  const datasetSelect = $("config-dataset");
  if (!datasetSelect) return;
  const selectedPaths = new Set(selected.map((dataset) => dataset.path));
  setWorkbenchSelectedDatasetPaths(Array.from(selectedPaths));
  for (const option of datasetSelect.options) {
    option.selected = selectedPaths.has(option.value);
  }
  for (const dataset of selected) {
    rememberWorkbenchDataset(dataset);
    if (Array.from(datasetSelect.options).some((option) => option.value === dataset.path)) continue;
    const option = document.createElement("option");
    option.value = dataset.path;
    option.textContent = workbenchDatasetOptionLabel(dataset);
    option.selected = true;
    attachDatasetOptionMetadata(option, dataset);
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

export function dataCompareActionSummaryModel(comparison = {}, timezoneMode = "utc") {
  const datasets = state.dataCatalog.datasets || [];
  const selected = selectedCompareDatasets();
  const selectedCount = selected.length;
  const visibleCount = $("data-compare-datasets")
    ? Array.from($("data-compare-datasets").options).length
    : datasets.length;
  const filter = ($("data-compare-filter") && $("data-compare-filter").value.trim()) || "";
  const bounds = selectedCompareRangeBounds();
  const hasOverlap = bounds.overlapStart !== null && bounds.overlapEnd !== null && bounds.overlapStart <= bounds.overlapEnd;
  const overlapLabel = hasOverlap
    ? timeRangeLabel(new Date(bounds.overlapStart).toISOString(), new Date(bounds.overlapEnd).toISOString(), timezoneMode)
    : selectedCount >= 2 ? "No common overlap" : "Select files first";
  const loaded = Boolean(comparison && comparison.generated_at);
  const series = comparison.series || [];
  const common = finiteNumber(comparison.common_timestamp_count) || 0;
  const union = finiteNumber(comparison.union_timestamp_count) || 0;
  const warningCount = finiteNumber(comparison.warning_count) || 0;
  const contractCounts = countBy(selected, "storage_contract_status");
  const contractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  const qualityCounts = countBy(selected, "quality_status");
  const qualityIssues = Number(qualityCounts.bad || 0) + Number(qualityCounts.warn || 0);
  const returnRows = series.map((item) => ({
    symbol: text(item.symbol),
    value: finiteNumber(item.total_return_pct),
  })).filter((item) => item.value !== null);
  const leader = returnRows.slice().sort((left, right) => right.value - left.value)[0] || null;
  const laggard = returnRows.slice().sort((left, right) => left.value - right.value)[0] || null;
  const spread = leader && laggard ? leader.value - laggard.value : null;

  let note = "Select two saved datasets, apply an overlap window if needed, then compare normalized close-return paths.";
  let nextTitle = "Select Files";
  let nextStatus = datasets.length ? "warn" : "idle";
  let nextNote = datasets.length
    ? "Choose at least two catalog files or use Select Shown after filtering."
    : "Refresh or configure saved-data roots so catalog files appear.";
  if (!datasets.length) {
    note = "No parsed saved-data catalog is loaded; fix Data Library visibility before comparing files.";
    nextTitle = "Open Diagnostics";
  } else if (selectedCount < 2) {
    note = `${numberText(datasets.length, 0)} catalog files are available; ${numberText(visibleCount, 0)} are visible under current filters.`;
  } else if (!hasOverlap) {
    note = `${numberText(selectedCount, 0)} selected files do not share a timestamp window.`;
    nextTitle = "Fix Overlap";
    nextStatus = "bad";
    nextNote = "Choose files with overlapping ranges or relax the current file selection.";
  } else if (!loaded) {
    note = `${numberText(selectedCount, 0)} selected files share ${overlapLabel}; run Compare to load normalized paths.`;
    nextTitle = "Run Compare";
    nextStatus = "ok";
    nextNote = "Load common timestamps, warnings, leader/laggard return, and exportable paths.";
  } else if (common <= 0) {
    note = "The comparison loaded, but no common timestamps were returned for the selected window.";
    nextTitle = "Use Overlap";
    nextStatus = "bad";
    nextNote = "Apply the common-overlap preset or choose files with matching bar timestamps.";
  } else if (contractIssues || qualityIssues || warningCount) {
    note = `${numberText(common, 0)} common timestamps loaded with review pressure before Workbench handoff.`;
    nextTitle = "Review Warnings";
    nextStatus = "warn";
    nextNote = "Inspect storage-contract, quality, and comparison warnings before building a replay.";
  } else {
    note = `${numberText(common, 0)} common timestamps loaded; compare paths are ready for Workbench or CSV export.`;
    nextTitle = "Use Results";
    nextStatus = "ok";
    nextNote = "Send selected files and date range to Workbench, export CSV, or copy the request JSON.";
  }

  return {
    note,
    cards: [
      {
        status: datasets.length ? "ok" : "bad",
        label: "Catalog",
        title: numberText(datasets.length, 0),
        note: `${numberText(visibleCount, 0)} visible under Compare filters.`,
      },
      {
        status: selectedCount >= 2 ? "ok" : "idle",
        label: "Selection",
        title: numberText(selectedCount, 0),
        note: selectedCount
          ? `${Array.from(new Set(selected.map((item) => text(item.symbol)))).slice(0, 4).join(", ")} selected.`
          : filter ? `No selected files for "${filter}".` : "Select files or filter by symbol.",
      },
      {
        status: selectedCount < 2 ? "warn" : hasOverlap ? "ok" : "bad",
        label: "Overlap",
        title: selectedCount < 2 ? "Pending" : hasOverlap ? "Shared" : "Blocked",
        note: overlapLabel,
      },
      {
        status: loaded ? common > 0 ? "ok" : "bad" : "warn",
        label: "Comparison",
        title: loaded ? `${numberText(common, 0)} common` : "Not Run",
        note: loaded ? `${numberText(union, 0)} union timestamps / ${numberText(series.length, 0)} series.` : "Run Compare after selecting files.",
      },
      {
        status: contractIssues || qualityIssues || warningCount ? "warn" : selectedCount ? "ok" : "bad",
        label: "Review",
        title: `${numberText(contractIssues + qualityIssues + warningCount, 0)} issue${contractIssues + qualityIssues + warningCount === 1 ? "" : "s"}`,
        note: `Contracts ${countSummary(contractCounts) || "n/a"}; quality ${countSummary(qualityCounts) || "n/a"}.`,
      },
      {
        status: nextStatus,
        label: "Next Move",
        title: nextTitle,
        note: spread === null ? nextNote : `${nextNote} Spread ${pctText(spread)} (${leader.symbol} minus ${laggard.symbol}).`,
      },
    ],
    actions: [
      { action: "select-shown", label: "Select", title: "Select Shown", disabled: !visibleCount },
      { action: "select-symbol", label: "Symbol", title: "Select Symbol", disabled: !filter },
      { action: "compare", label: "Compare", title: "Run Compare", disabled: selectedCount < 2 || !hasOverlap },
      { action: "overlap", label: "Overlap", title: "Use Overlap", disabled: selectedCount < 2 || !hasOverlap },
      { action: "workbench", label: "Workbench", title: "Use In Workbench", disabled: selectedCount < 1 },
      { action: "export", label: "Export", title: "Export CSV", disabled: !series.length },
    ],
  };
}

export function renderDataCompareActionSummary(comparison = {}, timezoneMode = "utc") {
  if (!$("data-compare-action-note") || !$("data-compare-action-cards") || !$("data-compare-action-actions")) return;
  const model = dataCompareActionSummaryModel(comparison, timezoneMode);
  $("data-compare-action-note").textContent = model.note;
  $("data-compare-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-compare-action-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="${action.disabled ? "secondary" : ""}" data-data-compare-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>${escapeHtml(action.title)}</span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

export async function handleDataCompareAction(action) {
  if (action === "select-shown") {
    selectShownCompareDatasets();
    return;
  }
  if (action === "select-symbol") {
    selectSymbolCompareDatasets();
    return;
  }
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
    return;
  }
  if (action === "browse") {
    navigateToDataLens("browse");
  }
}

export function renderDataCompareAssistant(comparison = {}, timezoneMode = "utc") {
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
      status: selectedCount >= 2 ? "ok" : "idle",
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
      status: selectedContractIssues ? "warn" : selectedCount ? "ok" : "idle",
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
      status: selectedCount >= 2 && hasOverlap ? "ok" : "idle",
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
      status: selectedCount ? (warningCount || selectedContractIssues) ? "warn" : "ok" : "idle",
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
      status: selectedCount >= 2 ? "ok" : "idle",
      title: "Copy Request JSON",
      note: selectedCount >= 2 ? "Copy the exact compare request payload." : "Select at least two files first.",
      disabled: selectedCount < 2,
    },
  ]);
}

export function dataCompareAssistantActionsHtml(actions = []) {
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

export async function handleDataCompareAssistantAction(action) {
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

export function renderDataCompare() {
  const comparison = state.dataCompare || {};
  const series = comparison.series || [];
  const timezoneMode = $("data-compare-timezone").value || "utc";
  $("export-data-compare-csv").disabled = !series.length;
  $("data-compare-note").innerHTML = comparison.generated_at
    ? `${escapeHtml(numberText(comparison.dataset_count, 0))} datasets / ${escapeHtml(numberText(comparison.common_timestamp_count, 0))} common timestamps / ${escapeHtml(numberText(comparison.union_timestamp_count, 0))} union timestamps${comparison.warning_count ? ` <span class="status-warn">${escapeHtml((comparison.warnings || []).join("; "))}</span>` : ""}`
    : "Select two or more datasets to compare normalized close paths.";
  renderDataCompareActionSummary(comparison, timezoneMode);
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

export function renderDataCompareStats(comparison = {}, timezoneMode = "utc") {
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

export function dataCompareReadinessCards(comparison, timezoneMode = "utc") {
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
      status: contractIssues ? "warn" : selected.length ? "ok" : "idle",
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
