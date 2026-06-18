import {
  $,
  MAX_DATA_COMPARE_DATASETS,
  bytes,
  dataCatalogSettings,
  dataLibraryLoadState,
  durationMsText,
  escapeHtml,
  interval,
  navigateToDataLens,
  navigateToView,
  navigateToWorkbenchLens,
  numberText,
  pctText,
  qualityBadge,
  row,
  selectedDataCatalogOffset,
  setDataCatalogOffset,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { attachDatasetOptionMetadata, rememberWorkbenchDataset, selectedConfigDatasets } from "./20_workbench_foundation.js";
import { dataBackendStatusModel, shortTimestampAgeLabel, symbolInventoryModel, timestampAgeLabel, timestampMillis } from "./30_runtime_core.js";
import { workflowHref } from "./32_overview.js";
import { miniChart, rangeLabel } from "./34_charts.js";
import {
  breakdownChips,
  countBy,
  countSummary,
  dataRootConfigPaths,
  dataCatalogFilters,
  dataCatalogServerFilterLabels,
  dataCatalogServerScopeModel,
  dataHistoryMatrixBackendScopeApplied,
  dataReplayReadinessModel,
  filteredDataCatalog,
  recommendedDataRows,
  renderDataFilterOptions,
  renderDataSearchAssistant,
  renderDataUniversePanel,
  renderRootIndexBrowser,
  renderSymbolBrowser,
  renderSymbolDirectory,
  rootIndexArray,
  rootIndexScanStats,
  symbolBrowserGroups,
  timestampRangeFromDatasets,
  topCountEntries,
} from "./40_data_catalog.js";
import { renderDataLibrarySummary } from "./42_data_symbols.js";
import { previewCloseReturn, renderDataCompareControls } from "./43_data_detail_compare.js";
import { copyDataRootsYaml, fetchManifestOutputIssueCount } from "./50_fetch.js";
import { renderConfigLivePanels } from "./60_workbench_builder.js";
import { copyText, loadDataCompare, loadDataDetail, refresh, refreshDataDiagnostics, refreshDataLibrary, shouldLoadDataDiagnostics } from "./90_bootstrap.js";

export function dataReplayReadiness(dataset) {
  const model = dataReplayReadinessModel(dataset);
  return `
    <div class="data-readiness-cell ${escapeHtml(statusClass(model.status))}">
      <strong>${escapeHtml(model.title)}</strong>
      <span>${escapeHtml(model.detail)}</span>
      <small>${escapeHtml(`tz ${text(dataset.source_timezone)} / adjust ${text(dataset.adjustment_status)}`)}</small>
    </div>
  `;
}

export function renderDataCatalog() {
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  const filtered = filteredDataCatalog(datasets);
  const loadState = dataLibraryLoadState();
  const firstCatalogLoad = loadState.catalogLoading && !loadState.catalogLoaded && datasets.length === 0;
  const offset = Number(catalog.offset ?? selectedDataCatalogOffset() ?? 0);
  const limit = Number(catalog.limit || $("data-catalog-limit").value || 0);
  const count = Number(catalog.count || datasets.length || 0);
  const pageStart = count ? offset + 1 : offset;
  const pageEnd = Number(catalog.page_end_offset ?? (offset + count));
  if ($("data-catalog-page-status")) {
    $("data-catalog-page-status").textContent = count
      ? `Rows ${numberText(pageStart, 0)}-${numberText(pageEnd, 0)}`
      : offset ? `Offset ${numberText(offset, 0)}` : "No rows";
  }
  if ($("data-catalog-page-note")) {
    const scanLimit = Number(catalog.scan_limit || limit || 0);
    const serverFilters = dataCatalogServerFilterLabels();
    const scope = dataCatalogServerScopeModel(catalog);
    $("data-catalog-page-note").textContent = [
      `${scope.title}: ${scope.note}`,
      serverFilters.length ? `server filters: ${serverFilters.join(" / ")}` : "",
      limit ? `Page size ${numberText(limit, 0)}` : "",
      scanLimit ? `scanned through ${numberText(scanLimit, 0)}` : "",
      Number(catalog.filter_skipped_count_total || 0) ? `${numberText(catalog.filter_skipped_count_total, 0)} skipped by filters` : "",
      catalog.has_next_page ? "more rows available" : "end of current bounded scan",
    ].filter(Boolean).join(" / ") || "Use pages to browse larger saved-data roots.";
  }
  if ($("data-catalog-prev-page")) $("data-catalog-prev-page").disabled = !catalog.has_previous_page || loadState.catalogLoading;
  if ($("data-catalog-next-page")) $("data-catalog-next-page").disabled = !catalog.has_next_page || loadState.catalogLoading;
  renderDataFilterOptions(datasets);
  renderDataLibrarySummary();
  renderDataHome(filtered);
  renderDataFacetSummary(datasets, filtered);
  renderDataExplorer(datasets, filtered);
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
        dataReplayReadiness(dataset),
        escapeHtml(dataset.source_timezone),
        miniChart(dataset.preview || []),
        escapeHtml(bytes(dataset.size_bytes)),
        escapeHtml(timestampAgeLabel(dataset.modified_at)),
        `<span class="mono">${escapeHtml(dataset.path)}</span>`,
        `<span class="button-pair"><button type="button" class="secondary inspect-data" data-path="${escapeHtml(dataset.path)}">Inspect</button><button type="button" class="secondary copy-data-path-row" data-path="${escapeHtml(dataset.path)}">Copy Path</button></span>`,
      ])).join("")
    : firstCatalogLoad
      ? row([`<span class="status-warn">Loading saved-data catalog...</span>`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""])
      : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  const errors = catalog.errors || [];
  const symbolIndex = state.dataSymbolIndex || {};
  const indexFileCount = Number(symbolIndex.file_count || 0);
  const indexSymbolCount = Number(symbolIndex.symbol_count || 0);
  const indexStatus = symbolIndex.index_error
    ? `index error ${text(symbolIndex.index_error)}`
    : indexFileCount
      ? `root index ${numberText(indexFileCount, 0)} files / ${numberText(indexSymbolCount, 0)} symbols${symbolIndex.index_complete === false ? " capped" : ""}`
      : "root index not loaded";
  const filterLabel = [
    `${numberText(filtered.length, 0)} shown / ${numberText(datasets.length, 0)} found`,
    indexStatus,
    dataCatalogServerScopeModel(catalog).title,
    `scope ${text(catalog.catalog_visibility_status || "unknown")}`,
    `capped roots ${numberText(catalog.scan_capped_root_count || 0, 0)}`,
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

export function dataFilterSummary() {
  const filters = dataCatalogFilters();
  const labels = [];
  if (filters.text) labels.push(`search "${filters.text}"`);
  if (filters.quality) labels.push(`quality ${filters.quality}`);
  if (filters.bar) labels.push(`bar ${filters.bar}`);
  if (filters.asset) labels.push(`asset ${filters.asset}`);
  if (filters.source) labels.push(`source ${filters.source}`);
  if (filters.session) labels.push(`session ${filters.session}`);
  if (filters.contract) labels.push(`contract ${filters.contract}`);
  if (filters.replay) labels.push(`replay ${filters.replay}`);
  if (state.manifestPathFilter && (state.manifestPathFilter.paths || []).length) {
    labels.push(`fetch outputs ${numberText((state.manifestPathFilter.paths || []).length, 0)}`);
  }
  if (filters.sort && filters.sort !== "modified_desc") labels.push(`sort ${filters.sort.replace("_", " ")}`);
  return labels;
}

export function renderDataFacetSummary(datasets = [], filteredRows = []) {
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
  const replayCounts = {};
  for (const dataset of filteredRows) {
    const replayStatus = dataReplayReadinessModel(dataset).status;
    replayCounts[replayStatus] = (replayCounts[replayStatus] || 0) + 1;
  }
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
      status: Number(replayCounts.bad || 0)
        ? "bad"
        : Number(replayCounts.warn || 0) ? "warn" : filteredRows.length ? "ok" : "bad",
      title: `Replay ${countSummary(replayCounts) || "n/a"}`,
      note: `Q ${countSummary(qualityCounts) || "n/a"} / contract ${countSummary(contractCounts) || "n/a"}; newest ${newest ? shortTimestampAgeLabel(new Date(newest).toISOString()) : "n/a"}.`,
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

export function dataExplorerDimensions() {
  return [
    { key: "asset_class", label: "Asset", filter: "asset", control: "data-filter-asset" },
    { key: "source", label: "Source", filter: "source", control: "data-filter-source" },
    { key: "bar_size", label: "Bar Size", filter: "bar", control: "data-filter-bar" },
    { key: "storage_session", label: "Session", filter: "session", control: "data-filter-session" },
    { key: "quality_status", label: "Quality", filter: "quality", control: "data-filter-quality" },
    { key: "storage_contract_status", label: "Contract", filter: "contract", control: "data-filter-contract" },
    { key: "replay_readiness", label: "Replay", filter: "replay", control: "data-filter-replay", value: (dataset) => dataReplayReadinessModel(dataset).status },
  ];
}

export function dataExplorerGroupRows(datasets, dimension) {
  const groups = new Map();
  for (const dataset of datasets || []) {
    const value = text(dimension.value ? dimension.value(dataset) : dataset[dimension.key]);
    if (!value || value === "n/a") continue;
    if (!groups.has(value)) {
      groups.set(value, {
        value,
        file_count: 0,
        row_count: 0,
        symbols: new Set(),
        latest: null,
        quality_counts: {},
        contract_counts: {},
      });
    }
    const group = groups.get(value);
    group.file_count += 1;
    group.row_count += Number(dataset.rows || 0);
    const symbol = text(dataset.symbol);
    if (symbol !== "n/a") group.symbols.add(symbol);
    const latest = timestampMillis(dataset.last_timestamp) || timestampMillis(dataset.modified_at);
    if (latest && (!group.latest || latest > group.latest)) group.latest = latest;
    const quality = text(dataset.quality_status);
    if (quality !== "n/a") group.quality_counts[quality] = (group.quality_counts[quality] || 0) + 1;
    const contract = text(dataset.storage_contract_status);
    if (contract !== "n/a") group.contract_counts[contract] = (group.contract_counts[contract] || 0) + 1;
  }
  return Array.from(groups.values())
    .map((group) => ({
      ...group,
      symbol_count: group.symbols.size,
      latest_label: group.latest ? new Date(group.latest).toISOString().slice(0, 10) : "n/a",
      status: Number(group.quality_counts.bad || 0) || Number(group.contract_counts.bad || 0)
        ? "bad"
        : Number(group.quality_counts.warn || 0) || Number(group.contract_counts.warn || 0) ? "warn" : "ok",
    }))
    .sort((left, right) => Number(right.file_count || 0) - Number(left.file_count || 0) || String(left.value).localeCompare(String(right.value)));
}

export function renderDataExplorer(datasets = [], filteredRows = []) {
  if (!$("data-explorer-note") || !$("data-explorer-cards") || !$("data-explorer-groups")) return;
  const symbolIndex = state.dataSymbolIndex || {};
  const indexFileCount = Number(symbolIndex.file_count || 0);
  const indexSymbolCount = Number(symbolIndex.symbol_count || 0);
  const indexCapped = Number(symbolIndex.scan_capped_root_count || 0) > 0 || symbolIndex.index_complete === false;
  const indexError = text(symbolIndex.index_error || ((symbolIndex.errors || [])[0] || {}).error || "");
  const symbolCount = new Set((datasets || []).map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a")).size;
  const filteredSymbolCount = new Set((filteredRows || []).map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a")).size;
  const totalRows = (datasets || []).reduce((sum, dataset) => sum + Number(dataset.rows || 0), 0);
  const latest = (datasets || [])
    .map((dataset) => timestampMillis(dataset.last_timestamp) || 0)
    .reduce((max, value) => Math.max(max, value), 0);
  const filters = dataFilterSummary();
  $("data-explorer-note").textContent = datasets.length
    ? filters.length
      ? `${numberText(filteredRows.length, 0)} files match ${filters.join(", ")}. Click a group to replace the current Browse filter.`
      : `${numberText(datasets.length, 0)} full-catalog files across ${numberText(symbolCount, 0)} symbols; broad root index sees ${numberText(indexFileCount || datasets.length, 0)} candidate files across ${numberText(indexSymbolCount || symbolCount, 0)} symbols. Click a group to filter the table, Symbol Browser, and downstream actions.`
    : "Configure data roots or fetch history, then refresh Data Library to explore saved files.";
  const cards = [
    {
      status: indexError !== "n/a" ? "bad" : indexFileCount ? (indexCapped ? "warn" : "ok") : datasets.length ? "warn" : "idle",
      label: "Root Index",
      title: indexFileCount ? `${numberText(indexFileCount, 0)} files` : "n/a",
      note: indexError !== "n/a"
        ? `Broad index failed: ${indexError}.`
        : indexFileCount
          ? `${numberText(indexSymbolCount, 0)} symbols inferred from filenames/paths${indexCapped ? "; index capped" : "; broader than the parsed catalog when limits apply"}.`
          : "No broad symbol index loaded yet.",
    },
    {
      status: datasets.length ? "ok" : "idle",
      label: "Full Catalog",
      title: `${numberText(datasets.length, 0)} files`,
      note: `${numberText(symbolCount, 0)} symbols / ${numberText(totalRows, 0)} parsed rows with quality and preview metadata.`,
    },
    {
      status: filteredRows.length ? "ok" : datasets.length ? "warn" : "bad",
      label: "Visible Now",
      title: `${numberText(filteredRows.length, 0)} files`,
      note: `${numberText(filteredSymbolCount, 0)} symbols after Browse filters.`,
    },
    {
      status: latest ? "ok" : datasets.length ? "warn" : "idle",
      label: "Latest Bar",
      title: latest ? new Date(latest).toISOString().slice(0, 10) : "n/a",
      note: latest ? "Newest timestamp in the loaded catalog." : "No timestamped saved files loaded.",
    },
  ];
  $("data-explorer-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const dimensions = dataExplorerDimensions();
  $("data-explorer-groups").innerHTML = datasets.length
    ? dimensions.map((dimension) => {
        const groups = dataExplorerGroupRows(datasets, dimension).slice(0, 8);
        return `
          <section class="data-explorer-group">
            <div>
              <span class="eyebrow">${escapeHtml(dimension.label)}</span>
              <strong>${escapeHtml(groups.length ? `${numberText(groups.length, 0)} top group${groups.length === 1 ? "" : "s"}` : "No values")}</strong>
            </div>
            <div class="data-explorer-buttons">
              ${groups.length ? groups.map((group) => `
                <button type="button" class="data-explorer-button status-${escapeHtml(group.status)}" data-data-explorer-action="filter" data-explorer-filter="${escapeHtml(dimension.filter)}" data-explorer-value="${escapeHtml(group.value)}">
                  <span>
                    <strong>${escapeHtml(group.value)}</strong>
                    <small>${escapeHtml(numberText(group.file_count, 0))} files / ${escapeHtml(numberText(group.symbol_count, 0))} symbols / ${escapeHtml(numberText(group.row_count, 0))} rows</small>
                    <small>latest ${escapeHtml(group.latest_label)} / Q ${escapeHtml(countSummary(group.quality_counts))} / contract ${escapeHtml(countSummary(group.contract_counts))}</small>
                  </span>
                  <b>Filter</b>
                </button>
              `).join("") : `<div class="empty-card"><strong>No ${escapeHtml(dimension.label)} groups</strong><span>No values found in the current catalog.</span></div>`}
            </div>
          </section>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No saved-data groups</strong><span>Refresh Data Library after configuring data roots or running fetch jobs.</span></div>`;
}

export function setDataCatalogFacetFilter(filter, value) {
  clearDataCatalogFilters();
  const mapping = {
    asset: "data-filter-asset",
    source: "data-filter-source",
    bar: "data-filter-bar",
    session: "data-filter-session",
    quality: "data-filter-quality",
    contract: "data-filter-contract",
    replay: "data-filter-replay",
  };
  const id = mapping[filter] || "";
  if (id && $(id)) $(id).value = value;
  state.manifestPathFilter = null;
  const label = dataExplorerDimensions().find((item) => item.filter === filter)?.label || filter;
  previewDataCatalogServerFilters(`Browse filtered to ${label}: ${value}`);
  if ($("data-catalog-body")) $("data-catalog-body").scrollIntoView({ block: "start", behavior: "smooth" });
}

export function handleDataExplorerAction(target) {
  const action = String(target.dataset.dataExplorerAction || "");
  if (action === "filter") {
    setDataCatalogFacetFilter(target.dataset.explorerFilter || "", target.dataset.explorerValue || "");
  }
}

export function clearDataCatalogFilters() {
  $("data-filter-text").value = "";
  $("data-filter-quality").value = "";
  $("data-filter-bar").value = "";
  $("data-filter-asset").value = "";
  $("data-filter-source").value = "";
  $("data-filter-session").value = "";
  $("data-filter-contract").value = "";
  $("data-filter-replay").value = "";
  $("data-filter-sort").value = "modified_desc";
  state.manifestPathFilter = null;
}

export function handleDataServerFilterControlChange() {
  setDataCatalogOffset(0);
  renderDataCatalog();
}

export function previewDataCatalogServerFilters(message) {
  setDataCatalogOffset(0);
  renderDataCatalog();
  $("last-refresh").textContent = `${message}; local preview only. Use Search Scan to apply this scope to backend catalog, Symbol Directory, and History Matrix.`;
}

export async function runDataCatalogServerSearch(statusPrefix = "Catalog scan filtered") {
  setDataCatalogOffset(0);
  await refreshDataLibrary({ includeDiagnostics: shouldLoadDataDiagnostics(), force: true });
  const serverFilters = dataCatalogServerFilterLabels();
  $("last-refresh").textContent = serverFilters.length
    ? `${statusPrefix}: ${serverFilters.join(" / ")}`
    : "Catalog scan refreshed without server filters";
}

export function catalogScopeIsCapped(catalog = {}) {
  const limit = Number(catalog.limit || $("data-catalog-limit").value || 0);
  const count = Number(catalog.count || (catalog.datasets || []).length || 0);
  const rootSummaries = catalog.root_summaries || [];
  const inventory = catalog.root_inventory || {};
  return Boolean(
    limit
    && count >= limit
    && (Number(inventory.capped_root_count || 0) || rootSummaries.some((item) => item.scan_capped || item.not_scanned_reason === "global catalog limit reached"))
  );
}

export function setDataCatalogLimitToMax() {
  const limit = $("data-catalog-limit");
  const values = Array.from(limit.options || []).map((option) => Number(option.value)).filter(Boolean);
  const next = Math.max(...values, Number(limit.value || 0), Number((state.dataCatalog || {}).limit || 0));
  if (next) limit.value = String(next);
  dataLibraryLoadState().catalogLimitTouched = true;
}

export function renderDataScopeAssistant(filteredRows = []) {
  if (!$("data-scope-assistant-title") || !$("data-scope-assistant-cards") || !$("data-scope-assistant-actions")) return;
  const catalog = state.dataCatalog || {};
  const diagnostics = state.diagnostics || {};
  const datasets = catalog.datasets || [];
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const inventory = catalog.root_inventory || {};
  const totalRootFiles = roots.reduce((sum, root) => sum + Number(root.data_file_count || 0), 0);
  const count = Number(catalog.count || datasets.length || 0);
  const limit = Number(catalog.limit || $("data-catalog-limit").value || 0);
  const settings = dataCatalogSettings();
  const maxLimit = Math.max(settings.defaultLimit, settings.maxLimit);
  const capped = catalogScopeIsCapped(catalog);
  const filterLabels = dataFilterSummary();
  const hiddenByFilters = Math.max(0, count - filteredRows.length);
  const symbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const parserErrors = Number(inventory.parse_error_count ?? catalog.error_count ?? 0);
  const scanCappedRoots = Number(inventory.capped_root_count ?? catalog.scan_capped_root_count ?? 0);
  const notScannedRoots = Number(inventory.not_scanned_root_count ?? catalog.not_scanned_root_count ?? 0);
  const unsupportedFiles = Number(inventory.unsupported_file_count ?? catalog.unsupported_file_count_total ?? 0);
  const skippedCandidates = Number(inventory.skipped_candidate_count ?? catalog.skipped_candidate_count_total ?? 0);
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
    note = `Loaded ${numberText(count, 0)} rows at the ${numberText(limit, 0)} row limit; ${numberText(scanCappedRoots, 0)} root${scanCappedRoots === 1 ? "" : "s"} hit the cap. Raise the scan limit before concluding symbols are missing.`;
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
      status: loading ? "warn" : capped ? "warn" : count ? "ok" : "idle",
      label: "Loaded Files",
      title: count ? `${numberText(count, 0)} / ${limit ? numberText(limit, 0) : "n/a"}` : loading ? "Loading" : "None",
      note: capped ? "The scan hit its row cap." : count ? `Rows available to Browse, Inspect, Compare, and Workbench; scope ${text(catalog.catalog_visibility_status || "unknown")}.` : "No catalog rows are loaded.",
    },
    {
      status: symbols.size ? "ok" : count ? "warn" : "idle",
      label: "Symbols",
      title: numberText(symbols.size, 0),
      note: symbols.size ? `${numberText(skippedCandidates, 0)} supported candidate${skippedCandidates === 1 ? "" : "s"} skipped in this bounded scan.` : "No symbols could be inferred from loaded files.",
    },
    {
      status: hiddenByFilters ? hiddenByFilters === count ? "bad" : "warn" : count ? "ok" : "bad",
      label: "Filter Scope",
      title: `${numberText(filteredRows.length, 0)} shown`,
      note: hiddenByFilters ? `${numberText(hiddenByFilters, 0)} rows hidden by current filters.` : filterLabels.length ? "Filters are active but still show rows." : "No catalog filters are active.",
    },
    {
      status: inventory.status || (suggestedRoots.length ? "warn" : roots.length ? "ok" : "bad"),
      label: "Root Inventory",
      title: `${numberText(inventory.readable_root_count ?? roots.length, 0)} readable`,
      note: suggestedRoots.length
        ? `${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"} not scanned.`
        : `${text(inventory.primary_issue || "root inventory loaded")}; ${numberText(totalRootFiles, 0)} root-scanner file${totalRootFiles === 1 ? "" : "s"} visible; ${numberText(notScannedRoots, 0)} root${notScannedRoots === 1 ? "" : "s"} not scanned.`,
    },
    {
      status: parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) ? "bad" : qualityIssues || contractIssues ? "warn" : count ? "ok" : "bad",
      label: "Readiness",
      title: qualityIssues || contractIssues || parserErrors ? `${numberText(qualityIssues + contractIssues + parserErrors, 0)} review` : count ? "Clean Enough" : "Unknown",
      note: `quality ${countSummary(qualityCounts) || "n/a"} / contract ${countSummary(contractCounts) || "n/a"} / unsupported ${numberText(unsupportedFiles, 0)}`,
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

export function handleDataScopeAssistantAction(action) {
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

export function fetchManifestVisibilityTotals(manifests = []) {
  return (manifests || []).reduce((totals, manifest) => {
    totals.visible += Number(manifest.output_visible_count || manifest.visible_output_count || 0);
    totals.missing += Number(manifest.output_missing_file_count || 0);
    totals.outside += Number(manifest.output_outside_data_roots_count || 0);
    totals.unsupported += Number(manifest.output_unsupported_file_count || 0);
    totals.noPath += Number(manifest.output_no_path_count || 0);
    totals.issues += fetchManifestOutputIssueCount(manifest);
    totals.rows += Number(manifest.rows || 0);
    totals.errors += Number(manifest.errors || 0) + Number(manifest.failed_symbols || 0) + Number(manifest.failed_chunks || 0);
    return totals;
  }, { visible: 0, missing: 0, outside: 0, unsupported: 0, noPath: 0, issues: 0, rows: 0, errors: 0 });
}

export function dataVisibilityReportModel(filteredRows = []) {
  const catalog = state.dataCatalog || {};
  const diagnostics = state.diagnostics || {};
  const audit = state.dataStorageAudit || {};
  const auditSummary = audit.visibility_summary || {};
  const datasets = catalog.datasets || [];
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const rootSummaries = catalog.root_summaries || [];
  const inventory = catalog.root_inventory || {};
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const fetchTotals = fetchManifestVisibilityTotals(manifests);
  const catalogRows = Number(catalog.count || datasets.length || 0);
  const symbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const filterLabels = dataFilterSummary();
  const hiddenByFilters = Math.max(0, catalogRows - filteredRows.length);
  const parserErrors = Number(inventory.parse_error_count ?? catalog.error_count ?? rootSummaries.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0));
  const unsupportedScanFiles = rootSummaries.reduce((sum, item) => sum + Number(item.unsupported_file_count || 0), 0);
  const unsupportedAuditFiles = Number(audit.unsupported_file_count || auditSummary.unsupported_file_count || 0);
  const unsupportedFiles = Math.max(Number(inventory.unsupported_file_count ?? 0), unsupportedScanFiles, unsupportedAuditFiles);
  const capped = catalogScopeIsCapped(catalog);
  const configuredFiles = Number(audit.configured_file_count || 0);
  const configuredVisible = Number(auditSummary.catalog_visible_configured_file_count ?? audit.configured_visible_count ?? audit.catalog_visible_count ?? catalogRows);
  const hiddenConfigured = Number(auditSummary.hidden_configured_file_count ?? audit.hidden_configured_file_count ?? 0);
  const suggestedFiles = Number(auditSummary.suggested_unconfigured_file_count ?? audit.suggested_file_count ?? 0);
  const hiddenTotal = Number(auditSummary.hidden_total_file_count ?? (hiddenConfigured + suggestedFiles));
  const qualityCounts = catalog.quality_counts || countBy(datasets, "quality_status");
  const contractCounts = catalog.storage_contract_counts || countBy(datasets, "storage_contract_status");
  const qualityIssues = Number(qualityCounts.bad || 0) + Number(qualityCounts.warn || 0);
  const contractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  const issueCount = parserErrors + unsupportedFiles + (capped ? 1 : 0) + hiddenTotal + hiddenByFilters + fetchTotals.issues + fetchTotals.errors;
  let status = "bad";
  let headline = "No saved data visible";
  let note = "Configure dashboard.data_roots or run fetch jobs before using Data Library.";
  if (catalogRows && !issueCount) {
    status = "ok";
    headline = "Saved data is visible";
    note = `${numberText(symbols.size, 0)} symbols and ${numberText(catalogRows, 0)} files are visible under configured roots.`;
  } else if (catalogRows) {
    status = parserErrors || fetchTotals.errors ? "bad" : "warn";
    headline = "Saved data needs visibility review";
    note = `${numberText(catalogRows, 0)} files are visible, but ${numberText(issueCount, 0)} visibility or readiness clues need review.`;
  } else if (suggestedRoots.length || suggestedFiles || manifests.length) {
    status = "warn";
    headline = "Data may exist outside the catalog";
    note = `${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"} and ${numberText(manifests.length, 0)} fetch manifest${manifests.length === 1 ? "" : "s"} are visible.`;
  }
  const cards = [
    {
      status,
      label: "Report",
      title: headline,
      note,
    },
    {
      status: catalogRows ? hiddenByFilters ? "warn" : "ok" : "bad",
      label: "Catalog",
      title: `${numberText(filteredRows.length, 0)} / ${numberText(catalogRows, 0)}`,
      note: hiddenByFilters ? `${numberText(hiddenByFilters, 0)} loaded rows are hidden by filters.` : `${numberText(symbols.size, 0)} symbols visible.`,
    },
    {
      status: inventory.status || (suggestedRoots.length || suggestedFiles || hiddenConfigured ? "warn" : roots.length ? "ok" : "bad"),
      label: "Roots",
      title: `${numberText(inventory.readable_root_count ?? roots.length, 0)} readable`,
      note: `${text(inventory.primary_issue || "inventory pending")}; ${numberText(hiddenConfigured, 0)} hidden configured / ${numberText(suggestedFiles || suggestedRoots.length, 0)} suggested.`,
    },
    {
      status: fetchTotals.issues || fetchTotals.errors ? "warn" : fetchTotals.visible ? "ok" : manifests.length ? "warn" : "bad",
      label: "Fetch Outputs",
      title: `${numberText(fetchTotals.visible, 0)} visible`,
      note: `${numberText(fetchTotals.missing, 0)} missing / ${numberText(fetchTotals.outside, 0)} outside roots / ${numberText(fetchTotals.unsupported, 0)} unsupported.`,
    },
  ];
  const lines = [
    {
      status: catalogRows ? "ok" : "bad",
      title: "Catalog Rows",
      detail: `${numberText(catalogRows, 0)} file row${catalogRows === 1 ? "" : "s"} and ${numberText(symbols.size, 0)} symbol${symbols.size === 1 ? "" : "s"} are loaded under configured roots.`,
    },
    {
      status: hiddenByFilters ? hiddenByFilters === catalogRows ? "bad" : "warn" : catalogRows ? "ok" : "idle",
      title: "Active Filters",
      detail: filterLabels.length ? `${filterLabels.join(" / ")}; ${numberText(hiddenByFilters, 0)} row${hiddenByFilters === 1 ? "" : "s"} hidden.` : "No Data Library filters are active.",
    },
    {
      status: capped ? "warn" : catalogRows ? "ok" : "idle",
      title: "Scan Limit",
      detail: capped ? `Catalog appears capped at ${numberText(catalog.limit || 0, 0)} rows. Raise the scan limit before concluding symbols are missing.` : "No catalog scan cap is visible in root summaries.",
    },
    {
      status: inventory.status || (suggestedRoots.length || suggestedFiles || hiddenConfigured ? "warn" : roots.length ? "ok" : "idle"),
      title: "Root Visibility",
      detail: `${numberText(roots.length, 0)} configured root${roots.length === 1 ? "" : "s"}; inventory ${text(inventory.status || "unknown")} (${text(inventory.primary_issue || "no summary")}); ${numberText(configuredVisible, 0)} catalog-visible configured files; ${numberText(hiddenConfigured, 0)} hidden configured; ${numberText(suggestedFiles || suggestedRoots.length, 0)} suggested outside configured roots.`,
    },
    {
      status: parserErrors ? "bad" : unsupportedFiles ? "warn" : catalogRows ? "ok" : "bad",
      title: "Parser And Skips",
      detail: `${numberText(parserErrors, 0)} parser error${parserErrors === 1 ? "" : "s"}; ${numberText(unsupportedFiles, 0)} unsupported file${unsupportedFiles === 1 ? "" : "s"}.`,
    },
    {
      status: qualityIssues || contractIssues ? "warn" : catalogRows ? "ok" : "bad",
      title: "Replay Readiness",
      detail: `${numberText(qualityIssues, 0)} quality review file${qualityIssues === 1 ? "" : "s"}; ${numberText(contractIssues, 0)} storage-contract review file${contractIssues === 1 ? "" : "s"}.`,
    },
    {
      status: fetchTotals.issues || fetchTotals.errors ? "warn" : fetchTotals.visible ? "ok" : manifests.length ? "warn" : "bad",
      title: "Fetch Output Visibility",
      detail: `${numberText(manifests.length, 0)} fetch manifest${manifests.length === 1 ? "" : "s"}; ${numberText(fetchTotals.visible, 0)} visible outputs; ${numberText(fetchTotals.missing, 0)} missing; ${numberText(fetchTotals.outside, 0)} outside data roots; ${numberText(fetchTotals.unsupported, 0)} unsupported; ${numberText(fetchTotals.errors, 0)} fetch errors/failures.`,
    },
  ];
  const nextAction = parserErrors
    ? "Open Diagnostics and review parser/root scan errors."
    : suggestedRoots.length || suggestedFiles
      ? "Copy data_roots YAML and add suggested roots to ignored local config."
      : capped
        ? "Raise the catalog scan limit and refresh Data Library."
        : hiddenByFilters
          ? "Clear filters or open Browse to inspect the loaded rows."
          : fetchTotals.issues || fetchTotals.errors
            ? "Open Fetch Jobs and inspect manifests with output visibility issues."
            : catalogRows
              ? "Browse, inspect, compare, or send visible files to Workbench."
              : "Run a fetch job or configure saved-data roots.";
  lines.push({
    status: status === "ok" ? "ok" : parserErrors || fetchTotals.errors ? "bad" : "warn",
    title: "Next Action",
    detail: nextAction,
  });
  return { status, headline, note, cards, lines };
}

export function dataVisibilityReportText(model) {
  return [
    `Data Visibility Report: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

export function dataActionSummaryModel(filteredRows = []) {
  const catalog = state.dataCatalog || {};
  const diagnostics = state.diagnostics || {};
  const datasets = catalog.datasets || [];
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const rootSummaries = catalog.root_summaries || [];
  const rootInventory = catalog.root_inventory || {};
  const symbolIndex = state.dataSymbolIndex || {};
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const fetchTotals = fetchManifestVisibilityTotals(manifests);
  const loadState = dataLibraryLoadState();
  const firstCatalogLoad = loadState.catalogLoading && !loadState.catalogLoaded && datasets.length === 0;
  const backend = dataBackendStatusModel();
  const backendRows = backend.rows || [];
  const backendIssues = backendRows.filter((item) => item.status !== "ok");
  const backendUnprobed = !backendRows.length && !loadState.catalogLoading && !loadState.diagnosticsLoading;
  const firstBackendIssue = backendIssues[0] || null;
  const catalogRows = Number(catalog.count || datasets.length || 0);
  const filteredCount = Number((filteredRows || []).length || 0);
  const filters = dataFilterSummary();
  const hiddenByFilters = Math.max(0, catalogRows - filteredCount);
  const symbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const activeRows = filters.length ? filteredRows : datasets;
  const activeSymbols = new Set((activeRows || []).map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const range = timestampRangeFromDatasets(activeRows || []);
  const matrix = dataHistoryMatrixRows(activeRows || []);
  const readyGroups = matrix.filter((group) => group.status === "ok").length;
  const blockedGroups = matrix.filter((group) => group.status === "bad").length;
  const parserErrors = Number(rootInventory.parse_error_count ?? catalog.error_count ?? rootSummaries.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0));
  const qualityCounts = catalog.quality_counts || countBy(datasets, "quality_status");
  const contractCounts = catalog.storage_contract_counts || countBy(datasets, "storage_contract_status");
  const qualityIssues = Number(qualityCounts.bad || 0) + Number(qualityCounts.warn || 0);
  const contractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  const capped = catalogScopeIsCapped(catalog);
  const indexFiles = Number(symbolIndex.file_count || ((symbolIndex.files || []).length) || 0);
  const indexSymbols = Number(symbolIndex.symbol_count || ((symbolIndex.symbols || []).length) || 0);
  const indexCapped = symbolIndex.index_complete === false || Number(symbolIndex.scan_capped_root_count || 0) > 0;
  const indexError = text(symbolIndex.index_error || ((symbolIndex.errors || [])[0] || {}).error || "");
  const best = (filteredRows || []).find((dataset) => dataset.path) || datasets.find((dataset) => dataset.path) || null;
  const issueCount = parserErrors + Number(qualityCounts.bad || 0) + Number(contractCounts.bad || 0) + fetchTotals.errors;
  let status = "bad";
  let headline = "No saved data is ready yet";
  let note = "Start by configuring roots, running a fetch, or opening diagnostics to explain what the dashboard can see.";
  let primaryHref = "#data/diagnostics";
  let primaryLabel = "Open Diagnostics";

  if (backendUnprobed) {
    status = "warn";
    headline = "Data backend checks have not run";
    note = "Run Check Data APIs before treating empty saved-data panels as missing files or bad roots.";
    primaryHref = "#data/diagnostics";
    primaryLabel = "Check Data APIs";
  } else if (firstBackendIssue && !firstCatalogLoad) {
    status = "warn";
    headline = "Data backend needs review";
    note = `${text(firstBackendIssue.label)} reported ${text(firstBackendIssue.status)}; refresh backend checks before changing roots or fetch jobs.`;
    primaryHref = "#data/diagnostics";
    primaryLabel = "Check Data APIs";
  } else if (firstCatalogLoad) {
    status = "warn";
    headline = "Saved-data scan is running";
    note = `${numberText(roots.length, 0)} configured root${roots.length === 1 ? "" : "s"} are scanning; this summary will update when catalog rows load.`;
    primaryHref = "#data";
    primaryLabel = "Stay On Data Home";
  } else if (suggestedRoots.length && (!roots.length || !catalogRows)) {
    status = "warn";
    headline = "Local history may be outside configured roots";
    note = `${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"} may contain saved bars that Data Library is not scanning yet.`;
    primaryHref = "#data/diagnostics";
    primaryLabel = "Copy Root YAML";
  } else if (!catalogRows && indexFiles) {
    status = "warn";
    headline = "Root index sees files, but parser catalog is empty";
    note = `${numberText(indexFiles, 0)} candidate file${indexFiles === 1 ? "" : "s"} and ${numberText(indexSymbols, 0)} symbol${indexSymbols === 1 ? "" : "s"} are inferred from filenames.`;
    primaryHref = "#data/diagnostics";
    primaryLabel = "Review Scanner";
  } else if (!catalogRows && manifests.length) {
    status = "warn";
    headline = "Fetch jobs exist, but no saved rows are visible";
    note = `${numberText(manifests.length, 0)} fetch manifest${manifests.length === 1 ? "" : "s"} are loaded; check output paths and data roots.`;
    primaryHref = "#fetch";
    primaryLabel = "Open Fetch Jobs";
  } else if (!catalogRows) {
    status = roots.length ? "warn" : "bad";
    headline = roots.length ? "Configured roots have no parsed rows" : "No saved-data roots configured";
    note = roots.length ? "Open diagnostics to see parser errors, unsupported files, or scan limits." : "Configure dashboard.data_roots or run a fetch job before browsing history.";
    primaryHref = roots.length ? "#data/diagnostics" : "#fetch";
    primaryLabel = roots.length ? "Open Diagnostics" : "Fetch Data";
  } else if (hiddenByFilters === catalogRows) {
    status = "warn";
    headline = "Filters hide every saved file";
    note = `${numberText(catalogRows, 0)} files are loaded, but current filters show zero rows.`;
    primaryHref = "#data/browse";
    primaryLabel = "Browse And Clear";
  } else if (parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0)) {
    status = "bad";
    headline = "Visible data has replay blockers";
    note = `${numberText(parserErrors, 0)} parser errors, ${numberText(Number(qualityCounts.bad || 0), 0)} bad-quality files, and ${numberText(Number(contractCounts.bad || 0), 0)} bad-contract files need review.`;
    primaryHref = "#data/diagnostics";
    primaryLabel = "Review Blockers";
  } else if (capped || indexCapped || (indexFiles && indexFiles > catalogRows)) {
    status = "warn";
    headline = "Visible catalog may be a partial sample";
    note = `Parsed catalog has ${numberText(catalogRows, 0)} files while the root index sees ${numberText(indexFiles, 0)} candidate files.`;
    primaryHref = "#data/diagnostics";
    primaryLabel = "Check Scan Limit";
  } else if (fetchTotals.issues || fetchTotals.errors) {
    status = "warn";
    headline = "Fetch outputs need visibility review";
    note = `${numberText(fetchTotals.issues + fetchTotals.errors, 0)} fetch output or failure clue${fetchTotals.issues + fetchTotals.errors === 1 ? "" : "s"} are visible.`;
    primaryHref = "#fetch";
    primaryLabel = "Review Fetch Jobs";
  } else {
    status = qualityIssues || contractIssues ? "warn" : "ok";
    headline = `${numberText(activeSymbols.size || symbols.size, 0)} symbols are ready to inspect`;
    note = `${numberText(filteredCount || catalogRows, 0)} visible file${(filteredCount || catalogRows) === 1 ? "" : "s"} across ${numberText(matrix.length, 0)} source/bar/session group${matrix.length === 1 ? "" : "s"}.`;
    primaryHref = "#data/browse";
    primaryLabel = "Browse Saved Data";
  }

  const cards = [
    {
      status,
      label: "Next Move",
      title: headline,
      detail: note,
    },
    {
      status: backend.status,
      label: "Backend Check",
      title: backend.title,
      detail: backend.note,
    },
    {
      status: catalogRows ? hiddenByFilters ? "warn" : "ok" : "bad",
      label: "Visible Scope",
      title: `${numberText(filteredCount, 0)} / ${numberText(catalogRows, 0)} files`,
      detail: filters.length ? `${filters.join(" / ")}; ${numberText(hiddenByFilters, 0)} hidden.` : `${numberText(symbols.size, 0)} symbols loaded with no active Browse filters.`,
    },
    {
      status: indexError !== "n/a" ? "bad" : indexFiles ? (indexCapped || indexFiles > catalogRows ? "warn" : "ok") : catalogRows ? "warn" : "bad",
      label: "Universe Check",
      title: indexFiles ? `${numberText(indexSymbols, 0)} indexed symbols` : `${numberText(symbols.size, 0)} parsed symbols`,
      detail: indexError !== "n/a" ? `Index failed: ${indexError}.` : `${numberText(indexFiles, 0)} root-index candidates; catalog ${capped ? "capped" : "not capped"}.`,
    },
    {
      status: parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) ? "bad" : qualityIssues || contractIssues ? "warn" : catalogRows ? "ok" : "bad",
      label: "Readiness",
      title: issueCount ? `${numberText(issueCount, 0)} blocker` : catalogRows ? "Usable" : "Unknown",
      detail: `${numberText(qualityIssues, 0)} quality review / ${numberText(contractIssues, 0)} contract review / ${numberText(parserErrors, 0)} parser errors.`,
    },
    {
      status: blockedGroups ? "bad" : readyGroups ? "ok" : matrix.length ? "warn" : catalogRows ? "warn" : "idle",
      label: "History Groups",
      title: `${numberText(matrix.length, 0)} groups`,
      detail: `${numberText(readyGroups, 0)} ready and ${numberText(blockedGroups, 0)} blocked for Workbench replay. ${range.start && range.end ? `${range.start} to ${range.end}.` : "No timestamp range loaded."}`,
    },
    {
      status: best ? "ok" : catalogRows ? "warn" : "idle",
      label: "Inspect First",
      title: best ? text(best.symbol) : "none",
      detail: best ? `${text(best.bar_size)} ${text(best.source)} / ${numberText(best.rows, 0)} rows / ${text(best.quality_status)} quality.` : "No inspectable file is currently visible.",
    },
  ];
  const actions = [
    { href: primaryHref, label: primaryLabel },
    { href: "#data/browse", label: "Browse", secondary: true },
    { href: "#data/inspect", label: "Inspect", secondary: true },
    { href: "#data/compare", label: "Compare", secondary: true },
    { href: "#data/diagnostics", label: "Diagnostics", secondary: true },
    { href: "#workbench/builder", label: "Workbench", secondary: true },
    { href: "#fetch", label: "Fetch Jobs", secondary: true },
  ];
  return { status, headline, note, cards, actions };
}

export function renderDataActionSummary(filteredRows = []) {
  if (!$("data-action-note") || !$("data-action-cards") || !$("data-action-actions")) return;
  const model = dataActionSummaryModel(filteredRows);
  $("data-action-note").textContent = model.note;
  $("data-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
  $("data-action-actions").innerHTML = model.actions.map((action) => (
    `<a${action.secondary ? ' class="secondary"' : ""} href="${escapeHtml(action.href)}">${escapeHtml(action.label)}</a>`
  )).join("");
}

export function rootIndexSpotlightModel(filteredRows = []) {
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  const inventory = symbolInventoryModel();
  const index = state.dataSymbolIndex || {};
  const catalogSymbols = new Set(datasets.map((dataset) => text(dataset.symbol).toUpperCase()).filter((value) => value && value !== "N/A"));
  const filteredSymbols = new Set((filteredRows || []).map((dataset) => text(dataset.symbol).toUpperCase()).filter((value) => value && value !== "N/A"));
  const topSymbols = (inventory.topSymbols || [])
    .map((item) => ({
      symbol: text(item.symbol || item.display_symbol).toUpperCase(),
      asset_class: text(item.asset_class),
      file_count: Number(item.file_count || 0),
      sources: rootIndexArray(item, "sources"),
      bar_sizes: rootIndexArray(item, "bar_sizes"),
      latest_modified_at: item.latest_modified_at,
      parsed: catalogSymbols.has(text(item.symbol || item.display_symbol).toUpperCase()),
      visible: filteredSymbols.has(text(item.symbol || item.display_symbol).toUpperCase()),
    }))
    .filter((item) => item.symbol && item.symbol !== "N/A")
    .slice(0, 10);
  const parsedJoinCount = ((index.symbols || []) || [])
    .filter((item) => catalogSymbols.has(text(item.symbol).toUpperCase()))
    .length;
  const sourceSummary = countSummary(inventory.raw.source_counts || index.source_counts || {});
  const barSummary = countSummary(inventory.raw.bar_size_counts || index.bar_size_counts || {});
  const assetSummary = countSummary(inventory.raw.asset_class_counts || index.asset_class_counts || {});
  const partial = inventory.indexComplete === false || inventory.scanCappedRootCount > 0 || inventory.notScannedRootCount > 0;
  const deferred = Number(inventory.raw.deferred_to_child_root_count_total || index.deferred_to_child_root_count_total || 0);
  const unsupported = Number(inventory.raw.unsupported_file_count_total || index.unsupported_file_count_total || 0);
  const scanStats = rootIndexScanStats(index);
  let status = inventory.status;
  let headline = "No saved universe indexed";
  let note = "Refresh Data Library after configuring saved-data roots or running fetch jobs.";
  if (inventory.symbolCount || inventory.fileCount) {
    status = inventory.status;
    headline = `${numberText(inventory.symbolCount, 0)} indexed symbol${inventory.symbolCount === 1 ? "" : "s"}`;
    note = `${numberText(inventory.fileCount, 0)} root-index candidate file${inventory.fileCount === 1 ? "" : "s"} are visible before parser/quality catalog limits.`;
    if (partial) note += " The index is partial, so more files may exist beyond the current scan.";
  }
  const cards = [
    {
      label: "Root Index",
      status,
      title: headline,
      note,
    },
    {
      label: "Catalog Join",
      status: catalogSymbols.size ? inventory.symbolCount > catalogSymbols.size ? "warn" : "ok" : inventory.symbolCount ? "warn" : "bad",
      title: `${numberText(catalogSymbols.size, 0)} parsed / ${numberText(inventory.symbolCount, 0)} indexed`,
      note: `${numberText(parsedJoinCount, 0)} indexed symbol${parsedJoinCount === 1 ? "" : "s"} also appear in the parsed quality catalog; ${numberText(filteredSymbols.size, 0)} are visible after filters.`,
    },
    {
      label: "Scan Scope",
      status: partial ? "warn" : inventory.fileCount ? "ok" : "bad",
      title: partial ? "Partial" : inventory.fileCount ? "Complete" : "Empty",
      note: `${numberText(inventory.scanCappedRootCount, 0)} capped roots / ${numberText(inventory.notScannedRootCount, 0)} not scanned / ${numberText(deferred, 0)} deferred to child roots.`,
    },
    {
      label: "Refresh Cost",
      status: scanStats.clientSymbolIndexFetchMs > 15000 || scanStats.totalRootScanMs > 15000 ? "warn" : inventory.fileCount ? "ok" : "bad",
      title: scanStats.clientSymbolIndexFetchMs ? durationMsText(scanStats.clientSymbolIndexFetchMs) : durationMsText(scanStats.totalRootScanMs),
      note: `Root-index limit ${numberText(scanStats.symbolIndexLimit, 0)}; catalog cache ${scanStats.catalogCacheStatus}; root-index cache ${scanStats.indexCacheStatus}; server root scan ${durationMsText(scanStats.totalRootScanMs)}; slowest root ${text((scanStats.slowestRoot || {}).display_path || (scanStats.slowestRoot || {}).path || "n/a")}.`,
    },
    {
      label: "Sources",
      status: inventory.fileCount ? "ok" : "idle",
      title: sourceSummary,
      note: `Assets ${assetSummary}; bars ${barSummary}.`,
    },
    {
      label: "Cleanup",
      status: unsupported ? "warn" : inventory.fileCount ? "ok" : "idle",
      title: `${numberText(unsupported, 0)} unsupported`,
      note: unsupported ? "Unsupported files exist near saved data roots; diagnostics can explain what the scanner skipped." : "No unsupported files reported in the root-index summary.",
    },
  ];
  return { status, headline, note, cards, topSymbols };
}

export function renderRootIndexSpotlight(filteredRows = []) {
  if (!$("data-root-index-spotlight-note") || !$("data-root-index-spotlight-cards") || !$("data-root-index-spotlight-symbols")) return;
  const model = rootIndexSpotlightModel(filteredRows);
  $("data-root-index-spotlight-note").textContent = model.note;
  $("data-root-index-spotlight-note").className = `section-note ${statusClass(model.status)}`;
  $("data-root-index-spotlight-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-root-index-spotlight-symbols").innerHTML = model.topSymbols.length
    ? model.topSymbols.map((item) => `
      <button type="button" class="data-universe-symbol" data-root-spotlight-action="root-filter" data-symbol="${escapeHtml(item.symbol)}">
        <strong>${escapeHtml(item.symbol)}</strong>
        <span>${escapeHtml(numberText(item.file_count, 0))} root-index file${item.file_count === 1 ? "" : "s"} / ${escapeHtml(item.asset_class)}</span>
        <small>${escapeHtml(item.sources.join(", ") || "unknown source")} / ${escapeHtml(item.bar_sizes.join(", ") || "unknown bar")}</small>
        <small>${escapeHtml(item.parsed ? item.visible ? "parsed and visible now" : "parsed but hidden by filters" : "indexed on disk, not parsed in catalog sample")}${item.latest_modified_at ? ` / ${escapeHtml(shortTimestampAgeLabel(item.latest_modified_at))}` : ""}</small>
      </button>
    `).join("")
    : `<div class="empty-card"><strong>No indexed symbols</strong><span>Configure data roots, run a fetch job, or refresh Data Library.</span></div>`;
  if ($("data-root-index-spotlight-actions")) {
    $("data-root-index-spotlight-actions").innerHTML = [
      `<button type="button" data-root-spotlight-action="browse">Browse Root Index</button>`,
      `<button type="button" class="secondary" data-root-spotlight-action="clear">Clear Root Filter</button>`,
      `<button type="button" class="secondary" data-root-spotlight-action="diagnostics">Diagnostics</button>`,
      `<button type="button" class="secondary" data-root-spotlight-action="export">Export CSV</button>`,
      `<button type="button" class="secondary" data-root-spotlight-action="roots">Copy Root YAML</button>`,
    ].join("");
  }
}

export function handleRootIndexSpotlightAction(target) {
  const action = String(target.dataset.rootSpotlightAction || "");
  const symbol = String(target.dataset.symbol || "").trim().toUpperCase();
  if (action === "root-filter") {
    if ($("data-root-index-filter")) $("data-root-index-filter").value = symbol;
    if ($("data-symbol-browser-input")) $("data-symbol-browser-input").value = symbol;
    renderRootIndexBrowser();
    renderSymbolBrowser();
    navigateToDataLens("browse");
    $("last-refresh").textContent = `Root Index filtered to ${symbol}`;
    return;
  }
  if (action === "browse") {
    navigateToDataLens("browse");
    window.setTimeout(() => {
      const targetElement = $("data-root-index-filter") || $("data-root-index-summary");
      if (targetElement) targetElement.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
    return;
  }
  if (action === "clear") {
    if ($("data-root-index-filter")) $("data-root-index-filter").value = "";
    if ($("data-root-index-asset")) $("data-root-index-asset").value = "";
    if ($("data-root-index-source")) $("data-root-index-source").value = "";
    if ($("data-root-index-bar")) $("data-root-index-bar").value = "";
    if ($("data-root-index-session")) $("data-root-index-session").value = "";
    renderRootIndexBrowser();
    $("last-refresh").textContent = "Root Index filters cleared";
    return;
  }
  if (action === "diagnostics") {
    navigateToDataLens("diagnostics");
    refreshDataDiagnostics({ force: false }).catch((err) => {
      $("last-refresh").textContent = `Data diagnostics refresh failed: ${err.message}`;
    });
    return;
  }
  if (action === "export") {
    if ($("export-data-symbol-index-csv")) $("export-data-symbol-index-csv").click();
    return;
  }
  if (action === "roots") {
    copyDataRootsYaml();
  }
}

export function renderDataVisibilityReport(filteredRows = []) {
  if (!$("data-visibility-report-note") || !$("data-visibility-report-cards") || !$("data-visibility-report-body") || !$("data-visibility-report-actions")) return;
  const model = dataVisibilityReportModel(filteredRows);
  state.dataVisibilityReportText = dataVisibilityReportText(model);
  $("data-visibility-report-note").textContent = model.note;
  $("data-visibility-report-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-visibility-report-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("data-visibility-report-actions").innerHTML = [
    `<button type="button" data-data-visibility-report-action="copy">Copy Report</button>`,
    `<button type="button" class="secondary" data-data-visibility-report-action="diagnostics">Open Diagnostics</button>`,
    `<button type="button" class="secondary" data-data-visibility-report-action="fetch">Open Fetch Jobs</button>`,
    `<button type="button" class="secondary" data-data-visibility-report-action="clear">Clear Filters</button>`,
    `<button type="button" class="secondary" data-data-visibility-report-action="roots">Copy Root YAML</button>`,
  ].join("");
}

export function handleDataVisibilityReportAction(action) {
  if (action === "copy") {
    copyText(state.dataVisibilityReportText || "No data visibility report loaded").then(() => {
      $("last-refresh").textContent = "Data visibility report copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Data visibility report copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "diagnostics") {
    navigateToDataLens("diagnostics");
    refreshDataDiagnostics({ force: false }).catch((err) => {
      $("last-refresh").textContent = `Data diagnostics refresh failed: ${err.message}`;
    });
    return;
  }
  if (action === "fetch") {
    navigateToView("fetch");
    return;
  }
  if (action === "clear") {
    clearDataCatalogFilters();
    renderDataCatalog();
    $("last-refresh").textContent = "Data Library filters cleared";
    return;
  }
  copyDataRootsYaml();
}

export function dataInventoryEvidenceModel(filteredRows = []) {
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  const diagnostics = state.diagnostics || {};
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const symbolIndex = state.dataSymbolIndex || {};
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const fetchTotals = fetchManifestVisibilityTotals(manifests);
  const filters = dataFilterSummary();
  const activeRows = filters.length ? filteredRows : datasets;
  const catalogRows = Number(catalog.count || datasets.length || 0);
  const hiddenByFilters = Math.max(0, catalogRows - filteredRows.length);
  const catalogSymbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const visibleSymbols = new Set((activeRows || []).map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const inventory = symbolInventoryModel();
  const indexSymbols = inventory.symbolCount;
  const indexFiles = inventory.fileCount;
  const indexCapped = inventory.indexComplete === false || inventory.scanCappedRootCount > 0 || inventory.notScannedRootCount > 0;
  const overlapNote = inventory.overlappingRootCount
    ? `; ${numberText(inventory.overlappingRootCount, 0)} overlapping root${inventory.overlappingRootCount === 1 ? "" : "s"}`
    : "";
  const indexError = text(symbolIndex.index_error || ((symbolIndex.errors || [])[0] || {}).error || "");
  const rootSummaries = catalog.root_summaries || [];
  const rootInventory = catalog.root_inventory || {};
  const capped = catalogScopeIsCapped(catalog);
  const parserErrors = Number(rootInventory.parse_error_count ?? catalog.error_count ?? rootSummaries.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0));
  const unsupportedFiles = Number(rootInventory.unsupported_file_count || rootSummaries.reduce((sum, item) => sum + Number(item.unsupported_file_count || 0), 0));
  const qualityCounts = catalog.quality_counts || countBy(datasets, "quality_status");
  const contractCounts = catalog.storage_contract_counts || countBy(datasets, "storage_contract_status");
  const qualityIssues = Number(qualityCounts.bad || 0) + Number(qualityCounts.warn || 0);
  const contractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  const matrix = dataHistoryMatrixRows(activeRows || []);
  const readyGroups = matrix.filter((group) => group.status === "ok").length;
  const reviewGroups = matrix.filter((group) => group.status === "warn").length;
  const blockedGroups = matrix.filter((group) => group.status === "bad").length;
  const range = timestampRangeFromDatasets(activeRows || []);
  const totalRows = (activeRows || []).reduce((sum, dataset) => sum + Number(dataset.rows || 0), 0);
  const suggestedCount = suggestedRoots.length;
  const catalogLooksPartial = Boolean(capped || indexCapped || (indexFiles && indexFiles > catalogRows));
  const hasBlockingIssues = Boolean(parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) || indexError !== "n/a");

  let status = "bad";
  let headline = "No historical data is visible";
  let note = "Configure saved-data roots, run a fetch job, or refresh Data Library before using saved bars.";
  if (catalogRows && !hasBlockingIssues && !catalogLooksPartial && !hiddenByFilters && !fetchTotals.issues && !fetchTotals.errors) {
    status = "ok";
    headline = "Historical data is discoverable";
    note = `${numberText(catalogSymbols.size, 0)} symbols, ${numberText(catalogRows, 0)} files, and ${numberText(matrix.length, 0)} source/bar/session groups are visible.`;
  } else if (catalogRows) {
    status = hasBlockingIssues ? "bad" : "warn";
    headline = "Historical data is visible, but needs review";
    note = `${numberText(catalogRows, 0)} catalog files are loaded; use the evidence below to explain missing symbols, filters, caps, or replay blockers.`;
  } else if (indexFiles || suggestedCount || manifests.length) {
    status = "warn";
    headline = "Historical data clues exist outside the parsed catalog";
    note = `${numberText(indexFiles, 0)} root-index candidate files, ${numberText(suggestedCount, 0)} suggested roots, and ${numberText(manifests.length, 0)} fetch manifests are visible.`;
  }

  const nextAction = parserErrors
    ? "Open Diagnostics and resolve parser/root scan errors before trusting replay results."
    : suggestedCount && !catalogRows
      ? "Copy the data_roots YAML and add suggested local roots, then refresh Data Library."
      : catalogLooksPartial
        ? "Raise the catalog/root-index limit, refresh Data Library, then recheck whether missing symbols are still absent."
        : hiddenByFilters
          ? "Clear filters or open Browse to inspect the full saved-data catalog."
          : fetchTotals.issues || fetchTotals.errors
            ? "Open Fetch Jobs and inspect manifests with hidden, missing, unsupported, or failed outputs."
            : blockedGroups
              ? "Use the Saved History Matrix to review blocked groups before Workbench replay."
              : catalogRows
                ? "Browse symbols, inspect a file, compare matching files, or send ready groups to Workbench."
                : "Run a fetch job or configure saved-data roots.";

  const cards = [
    {
      status,
      label: "Evidence",
      title: headline,
      note,
    },
    {
      status: catalogRows ? hiddenByFilters ? "warn" : "ok" : "bad",
      label: "Parsed Catalog",
      title: `${numberText(catalogRows, 0)} files`,
      note: `${numberText(catalogSymbols.size, 0)} symbols / ${numberText(catalog.row_count_total || totalRows, 0)} rows; ${numberText(hiddenByFilters, 0)} hidden by filters.`,
    },
    {
      status: indexError !== "n/a" ? "bad" : indexFiles ? inventory.status : catalogRows ? "warn" : "bad",
      label: "Root Index",
      title: indexFiles ? `${numberText(indexFiles, 0)} candidates` : "n/a",
      note: indexError !== "n/a"
        ? `Root index failed: ${indexError}.`
        : `${numberText(indexSymbols, 0)} inferred symbols; ${inventory.reason}${indexCapped ? "; partial scan" : ""}${indexFiles > catalogRows ? "; broader than parsed catalog" : ""}${overlapNote}.`,
    },
    {
      status: blockedGroups ? "bad" : reviewGroups ? "warn" : readyGroups ? "ok" : catalogRows ? "warn" : "bad",
      label: "Matrix",
      title: `${numberText(matrix.length, 0)} groups`,
      note: `${numberText(readyGroups, 0)} ready / ${numberText(reviewGroups, 0)} review / ${numberText(blockedGroups, 0)} blocked.`,
    },
    {
      status: parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) ? "bad" : qualityIssues || contractIssues ? "warn" : catalogRows ? "ok" : "bad",
      label: "Replay Quality",
      title: parserErrors || qualityIssues || contractIssues ? `${numberText(parserErrors + qualityIssues + contractIssues, 0)} review` : catalogRows ? "Clean enough" : "Unknown",
      note: `${numberText(parserErrors, 0)} parser errors; quality ${countSummary(qualityCounts)}; contract ${countSummary(contractCounts)}.`,
    },
    {
      status: fetchTotals.issues || fetchTotals.errors ? "warn" : fetchTotals.visible ? "ok" : manifests.length ? "warn" : "bad",
      label: "Fetch Clues",
      title: `${numberText(fetchTotals.visible, 0)} visible`,
      note: `${numberText(manifests.length, 0)} manifests; ${numberText(fetchTotals.missing, 0)} missing / ${numberText(fetchTotals.outside, 0)} outside roots / ${numberText(fetchTotals.errors, 0)} failures.`,
    },
  ];

  const lines = [
    {
      status: catalogRows ? "ok" : "bad",
      title: "Parsed Catalog",
      detail: `${numberText(catalogRows, 0)} saved file row${catalogRows === 1 ? "" : "s"} across ${numberText(catalogSymbols.size, 0)} symbol${catalogSymbols.size === 1 ? "" : "s"} are currently parsed under configured roots.`,
    },
    {
      status: activeRows.length ? "ok" : catalogRows ? "warn" : "bad",
      title: "Current Scope",
      detail: filters.length
        ? `${filters.join(" / ")} leaves ${numberText(activeRows.length, 0)} file${activeRows.length === 1 ? "" : "s"} and ${numberText(visibleSymbols.size, 0)} symbol${visibleSymbols.size === 1 ? "" : "s"} visible; ${numberText(hiddenByFilters, 0)} files are hidden.`
        : `No Browse filters are active; Data Home is using all ${numberText(activeRows.length, 0)} catalog file${activeRows.length === 1 ? "" : "s"}.`,
    },
    {
      status: range.start && range.end ? "ok" : activeRows.length ? "warn" : "idle",
      title: "Saved-Bar Window",
      detail: range.start && range.end
        ? `${range.start} to ${range.end} across ${numberText(totalRows, 0)} parsed row${totalRows === 1 ? "" : "s"} in the current scope.`
        : "No timestamp range is available for the current saved-data scope.",
    },
    {
      status: indexError !== "n/a" ? "bad" : indexFiles ? inventory.status : catalogRows ? "warn" : "bad",
      title: "Root Index Cross-Check",
      detail: indexError !== "n/a"
        ? `Root index failed with: ${indexError}.`
        : `${numberText(indexFiles, 0)} candidate file${indexFiles === 1 ? "" : "s"} and ${numberText(indexSymbols, 0)} symbol${indexSymbols === 1 ? "" : "s"} were inferred from root paths; inventory=${inventory.reason}; parsed catalog has ${numberText(catalogRows, 0)} files${catalogLooksPartial ? ", so the catalog may be partial" : ""}${overlapNote}.`,
    },
    {
      status: blockedGroups ? "bad" : reviewGroups ? "warn" : readyGroups ? "ok" : catalogRows ? "warn" : "bad",
      title: "Saved History Matrix",
      detail: `${numberText(matrix.length, 0)} source/bar/session group${matrix.length === 1 ? "" : "s"}: ${numberText(readyGroups, 0)} ready, ${numberText(reviewGroups, 0)} review, ${numberText(blockedGroups, 0)} blocked.`,
    },
    {
      status: suggestedCount || unsupportedFiles || capped ? "warn" : roots.length ? "ok" : "bad",
      title: "Roots And Scanner",
      detail: `${numberText(roots.length, 0)} configured root${roots.length === 1 ? "" : "s"}; ${numberText(suggestedCount, 0)} suggested root${suggestedCount === 1 ? "" : "s"}; ${numberText(unsupportedFiles, 0)} unsupported file${unsupportedFiles === 1 ? "" : "s"}; catalog scan ${capped ? "appears capped" : "not capped"}.`,
    },
    {
      status: fetchTotals.issues || fetchTotals.errors ? "warn" : fetchTotals.visible ? "ok" : manifests.length ? "warn" : "bad",
      title: "Fetch Output Link",
      detail: `${numberText(manifests.length, 0)} fetch manifest${manifests.length === 1 ? "" : "s"} loaded; ${numberText(fetchTotals.visible, 0)} outputs are Data Library-visible, ${numberText(fetchTotals.outside, 0)} are outside data roots, ${numberText(fetchTotals.missing, 0)} are missing, and ${numberText(fetchTotals.errors, 0)} failed.`,
    },
    {
      status: status === "ok" ? "ok" : hasBlockingIssues ? "bad" : "warn",
      title: "Next Action",
      detail: nextAction,
    },
  ];

  return { status, headline, note, cards, lines };
}

export function dataInventoryEvidenceText(model) {
  return [
    `Historical Inventory Evidence: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

export function renderDataInventoryEvidence(filteredRows = []) {
  if (!$("data-inventory-evidence-note") || !$("data-inventory-evidence-cards") || !$("data-inventory-evidence-body") || !$("data-inventory-evidence-actions")) return;
  const model = dataInventoryEvidenceModel(filteredRows);
  state.dataInventoryEvidenceText = dataInventoryEvidenceText(model);
  $("data-inventory-evidence-note").textContent = model.note;
  $("data-inventory-evidence-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-inventory-evidence-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("data-inventory-evidence-actions").innerHTML = [
    `<button type="button" data-data-inventory-evidence-action="copy">Copy Evidence</button>`,
    `<button type="button" class="secondary" data-data-inventory-evidence-action="browse">Browse Saved Data</button>`,
    `<button type="button" class="secondary" data-data-inventory-evidence-action="matrix">Open Matrix</button>`,
    `<button type="button" class="secondary" data-data-inventory-evidence-action="diagnostics">Diagnostics</button>`,
    `<button type="button" class="secondary" data-data-inventory-evidence-action="fetch">Fetch Jobs</button>`,
    `<button type="button" class="secondary" data-data-inventory-evidence-action="clear">Clear Filters</button>`,
    `<button type="button" class="secondary" data-data-inventory-evidence-action="roots">Copy Root YAML</button>`,
    `<button type="button" class="secondary" data-data-inventory-evidence-action="workbench">Workbench</button>`,
  ].join("");
}

export function handleDataInventoryEvidenceAction(action) {
  if (action === "copy") {
    copyText(state.dataInventoryEvidenceText || "No historical inventory evidence loaded").then(() => {
      $("last-refresh").textContent = "Historical inventory evidence copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Historical inventory evidence copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "browse") {
    navigateToDataLens("browse");
    return;
  }
  if (action === "matrix") {
    navigateToDataLens("home");
    window.setTimeout(() => {
      const destination = $("data-history-matrix-summary") || $("data-history-matrix-body");
      if (destination) destination.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
    return;
  }
  if (action === "diagnostics") {
    navigateToDataLens("diagnostics");
    refreshDataDiagnostics({ force: false }).catch((err) => {
      $("last-refresh").textContent = `Data diagnostics refresh failed: ${err.message}`;
    });
    return;
  }
  if (action === "fetch") {
    navigateToView("fetch");
    return;
  }
  if (action === "clear") {
    clearDataCatalogFilters();
    renderDataCatalog();
    $("last-refresh").textContent = "Data Library filters cleared";
    return;
  }
  if (action === "roots") {
    copyDataRootsYaml();
    return;
  }
  navigateToWorkbenchLens("builder");
}

export function renderDataHome(filteredRows = []) {
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
  renderDataActionSummary(filteredRows);
  renderRootIndexSpotlight(filteredRows);
  renderDataScopeAssistant(filteredRows);
  renderDataInventoryPanel(filteredRows);
  renderDataHistoryReview(filteredRows);
  renderDataVisibilityReport(filteredRows);
  renderDataInventoryEvidence(filteredRows);
  renderDataHistoryMatrix(filteredRows);
  renderDataUniversePanel();
  renderRootIndexBrowser();
  renderDataPreviewWall(filteredRows);
  renderDataHomeWorkflows(filteredRows);
  renderDataHomeShortlist(filteredRows);
}

export function renderDataInventoryPanel(filteredRows = []) {
  if (!$("data-inventory-title") || !$("data-inventory-cards") || !$("data-inventory-actions")) return;
  const catalog = state.dataCatalog || {};
  const diagnostics = state.diagnostics || {};
  const datasets = catalog.datasets || [];
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const loadState = dataLibraryLoadState();
  const firstCatalogLoad = loadState.catalogLoading && !loadState.catalogLoaded && datasets.length === 0;
  const catalogCount = Number(catalog.count || datasets.length || 0);
  const symbolIndex = state.dataSymbolIndex || {};
  const inventory = symbolInventoryModel();
  const indexFileCount = inventory.fileCount;
  const indexSymbolCount = inventory.symbolCount;
  const indexCapped = inventory.indexComplete === false || inventory.scanCappedRootCount > 0 || inventory.notScannedRootCount > 0;
  const overlapNote = inventory.overlappingRootCount
    ? `; ${numberText(inventory.overlappingRootCount, 0)} overlapping root${inventory.overlappingRootCount === 1 ? "" : "s"}`
    : "";
  const indexError = text(symbolIndex.index_error || ((symbolIndex.errors || [])[0] || {}).error || "");
  const rootSummaries = catalog.root_summaries || [];
  const totalRootFiles = roots.reduce((sum, root) => sum + Number(root.data_file_count || 0), 0);
  const symbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const range = timestampRangeFromDatasets(datasets);
  const qualityCounts = catalog.quality_counts || countBy(datasets, "quality_status");
  const contractCounts = catalog.storage_contract_counts || countBy(datasets, "storage_contract_status");
  const parserErrors = Number(catalog.error_count || rootSummaries.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0));
  const qualityIssues = Number(qualityCounts.bad || 0) + Number(qualityCounts.warn || 0);
  const contractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  const capped = catalogScopeIsCapped(catalog);
  const hiddenByFilters = Math.max(0, catalogCount - filteredRows.length);
  const rootScopes = countBy(roots, "scope");
  const localRootCount = roots.filter((root) => ["private", "local-cache", "local-path"].includes(text(root.scope))).length;
  let status = "bad";
  let title = "No saved data visible";
  let note = "Configure dashboard.data_roots, run a fetch job, or add a suggested local root before using the Workbench.";
  let nextHref = "#data/diagnostics";
  let nextLabel = "Open Diagnostics";
  if (firstCatalogLoad) {
    status = "warn";
    title = "Scanning saved-data roots";
    note = "The catalog is loading in the background; large history folders can take longer than the lightweight status refresh.";
    nextHref = "#data";
    nextLabel = "Stay On Data Home";
  } else if (suggestedRoots.length && (!roots.length || !catalogCount)) {
    status = "bad";
    title = "Add suggested roots";
    note = `${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"} may contain real history outside the configured scan.`;
  } else if (capped) {
    status = "warn";
    title = indexFileCount > catalogCount ? "Catalog is a bounded sample" : "Raise the scan limit";
    note = indexFileCount > catalogCount
      ? `The parsed catalog is capped at ${numberText(catalog.limit || 0, 0)} rows, while the broad root index sees ${numberText(indexFileCount, 0)} candidate files across ${numberText(indexSymbolCount, 0)} symbols.`
      : `The catalog appears capped at ${numberText(catalog.limit || 0, 0)} rows, so missing symbols may simply be beyond the current scan window.`;
  } else if (catalogCount && hiddenByFilters === catalogCount) {
    status = "warn";
    title = "Filters hide all rows";
    note = "Saved data is loaded, but the active Browse filters hide every catalog row.";
    nextHref = "#data/browse";
    nextLabel = "Clear Or Browse";
  } else if (parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0)) {
    status = "bad";
    title = "Review data readiness";
    note = `${numberText(parserErrors, 0)} parser errors, ${numberText(qualityIssues, 0)} quality reviews, and ${numberText(contractIssues, 0)} metadata reviews are visible.`;
  } else if (catalogCount) {
    status = qualityIssues || contractIssues ? "warn" : "ok";
    title = `${numberText(symbols.size, 0)} symbols ready to browse`;
    note = `${numberText(catalogCount, 0)} saved files are visible under configured roots; inspect or compare files before sending them to Workbench.`;
    nextHref = "#data/browse";
    nextLabel = "Browse Symbols";
  }
  $("data-inventory-title").textContent = title;
  $("data-inventory-title").className = statusClass(status);
  $("data-inventory-note").textContent = note;
  const rootScopeText = countSummary(rootScopes) || (roots.length ? "unknown scope" : "no roots");
  const cards = [
    {
      label: "Universe",
      title: firstCatalogLoad ? "Loading" : `${numberText(symbols.size, 0)} symbols`,
      status: firstCatalogLoad ? "warn" : symbols.size ? "ok" : "bad",
      detail: `${numberText(catalogCount, 0)} catalog files / ${numberText(catalog.row_count_total || 0, 0)} rows.`,
    },
    {
      label: "Root Index",
      title: indexFileCount ? `${numberText(indexSymbolCount, 0)} symbols` : "n/a",
      status: indexError !== "n/a" ? "bad" : indexFileCount ? inventory.status : catalogCount ? "warn" : "idle",
      detail: indexError !== "n/a"
        ? `Index failed: ${indexError}.`
        : indexFileCount
          ? `${numberText(indexFileCount, 0)} candidate files; ${inventory.reason}${indexCapped ? `; ${numberText(inventory.scanCappedRootCount, 0)} capped / ${numberText(inventory.notScannedRootCount, 0)} not scanned roots` : ""}${overlapNote}.`
          : "No broad root index loaded.",
    },
    {
      label: "Roots",
      title: `${numberText(roots.length, 0)} configured`,
      status: suggestedRoots.length ? "warn" : roots.length && totalRootFiles ? "ok" : "bad",
      detail: `${rootScopeText}; ${numberText(localRootCount, 0)} local/private root${localRootCount === 1 ? "" : "s"}; ${numberText(suggestedRoots.length, 0)} suggested.`,
    },
    {
      label: "Coverage",
      title: range.start && range.end ? `${range.start} to ${range.end}` : "n/a",
      status: range.start && range.end ? "ok" : catalogCount ? "warn" : "bad",
      detail: catalog.latest_modified_at ? `Latest file modified ${timestampAgeLabel(catalog.latest_modified_at)}.` : "No latest modification timestamp.",
    },
    {
      label: "Readiness",
      title: parserErrors || qualityIssues || contractIssues ? `${numberText(parserErrors + qualityIssues + contractIssues, 0)} review` : catalogCount ? "Clean Enough" : "Unknown",
      status: parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) ? "bad" : qualityIssues || contractIssues ? "warn" : catalogCount ? "ok" : "bad",
      detail: `quality ${countSummary(qualityCounts) || "n/a"} / contract ${countSummary(contractCounts) || "n/a"}.`,
    },
    {
      label: "Visible Now",
      title: `${numberText(filteredRows.length, 0)} shown`,
      status: hiddenByFilters ? hiddenByFilters === catalogCount ? "bad" : "warn" : catalogCount ? "ok" : "bad",
      detail: hiddenByFilters ? `${numberText(hiddenByFilters, 0)} rows hidden by filters.` : "No active filters hide catalog rows.",
    },
  ];
  $("data-inventory-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
  $("data-inventory-actions").innerHTML = [
    `<a href="${escapeHtml(nextHref)}">${escapeHtml(nextLabel)}</a>`,
    `<a class="secondary" href="#data/diagnostics">Root Diagnostics</a>`,
    `<a class="secondary" href="#workbench/builder">Open Workbench</a>`,
  ].join("");
}

export function renderDataHistoryReview(filteredRows = []) {
  if (!$("data-history-note") || !$("data-history-cards") || !$("data-history-actions")) return;
  const catalog = state.dataCatalog || {};
  const diagnostics = state.diagnostics || {};
  const datasets = catalog.datasets || [];
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const loadState = dataLibraryLoadState();
  const firstCatalogLoad = loadState.catalogLoading && !loadState.catalogLoaded && datasets.length === 0;
  const catalogCount = Number(catalog.count || datasets.length || 0);
  const visibleRows = filteredRows || [];
  const symbols = new Set(datasets.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const visibleSymbols = new Set(visibleRows.map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a"));
  const range = timestampRangeFromDatasets(datasets);
  const visibleRange = timestampRangeFromDatasets(visibleRows);
  const sourceCounts = catalog.source_counts || countBy(datasets, "source");
  const barCounts = catalog.bar_size_counts || countBy(datasets, "bar_size");
  const sessionCounts = catalog.storage_session_counts || countBy(datasets, "storage_session");
  const qualityCounts = catalog.quality_counts || countBy(datasets, "quality_status");
  const contractCounts = catalog.storage_contract_counts || countBy(datasets, "storage_contract_status");
  const rootSummaries = catalog.root_summaries || [];
  const parserErrors = Number(catalog.error_count || rootSummaries.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0));
  const capped = catalogScopeIsCapped(catalog);
  const qualityIssues = Number(qualityCounts.bad || 0) + Number(qualityCounts.warn || 0);
  const contractIssues = Number(contractCounts.bad || 0) + Number(contractCounts.warn || 0);
  const hiddenByFilters = Math.max(0, catalogCount - visibleRows.length);
  const topSources = topCountEntries(sourceCounts, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ");
  const topBars = topCountEntries(barCounts, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ");
  const topSessions = topCountEntries(sessionCounts, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ");
  const best = visibleRows.find((dataset) => dataset.path) || datasets.find((dataset) => dataset.path) || null;
  let status = "bad";
  let note = "Configure data roots or run a fetch job before historical data can be browsed, charted, compared, or used in Workbench.";
  let primaryHref = "#data/diagnostics";
  let primaryLabel = "Open Diagnostics";
  if (firstCatalogLoad) {
    status = "warn";
    note = "Saved-data roots are still scanning in the background; this review will fill in after the catalog loads.";
    primaryHref = "#data";
    primaryLabel = "Stay On Data Home";
  } else if (suggestedRoots.length && (!roots.length || !catalogCount)) {
    status = "bad";
    note = `${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"} may contain historical data that is not in dashboard.data_roots yet.`;
  } else if (!catalogCount) {
    status = roots.length ? "warn" : "bad";
    note = roots.length
      ? "Configured roots exist, but no dashboard-readable CSV/parquet history is visible from the catalog scan."
      : "No configured saved-data roots are visible to the dashboard.";
  } else if (hiddenByFilters === catalogCount) {
    status = "warn";
    note = "Historical data is loaded, but current filters hide every file. Clear filters or browse by symbol.";
    primaryHref = "#data/browse";
    primaryLabel = "Browse Data";
  } else if (parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0)) {
    status = "bad";
    note = `${numberText(parserErrors, 0)} parser errors plus ${numberText(qualityIssues + contractIssues, 0)} readiness reviews need attention before trusting simulations.`;
  } else if (capped) {
    status = "warn";
    note = `The catalog appears capped at ${numberText(catalog.limit || 0, 0)} rows, so visible symbols may be a partial view of disk history.`;
    primaryHref = "#data/diagnostics";
    primaryLabel = "Review Scan Limit";
  } else {
    status = qualityIssues || contractIssues ? "warn" : "ok";
    note = `${numberText(symbols.size, 0)} saved symbol${symbols.size === 1 ? "" : "s"} across ${numberText(catalogCount, 0)} file${catalogCount === 1 ? "" : "s"} are visible for offline inspection, comparison, and Workbench replay.`;
    primaryHref = "#data/browse";
    primaryLabel = "Browse Symbols";
  }
  $("data-history-note").textContent = note;
  const cards = [
    {
      label: "Visible Universe",
      title: firstCatalogLoad ? "Loading" : `${numberText(visibleSymbols.size || symbols.size, 0)} symbols`,
      status: firstCatalogLoad ? "warn" : visibleRows.length ? "ok" : catalogCount ? "warn" : "idle",
      detail: `${numberText(visibleRows.length, 0)} shown / ${numberText(catalogCount, 0)} catalog files; ${numberText(hiddenByFilters, 0)} hidden by filters.`,
    },
    {
      label: "Coverage Window",
      title: visibleRange.start && visibleRange.end ? `${visibleRange.start} to ${visibleRange.end}` : range.start && range.end ? `${range.start} to ${range.end}` : "n/a",
      status: range.start && range.end ? "ok" : catalogCount ? "warn" : "idle",
      detail: catalog.latest_modified_at ? `Newest file modified ${timestampAgeLabel(catalog.latest_modified_at)}.` : "No file modification timestamp loaded.",
    },
    {
      label: "Sources",
      title: topSources || "none",
      status: topSources ? "ok" : catalogCount ? "warn" : "bad",
      detail: `Bars: ${topBars || "none"}; sessions: ${topSessions || "unknown"}.`,
    },
    {
      label: "Readiness",
      title: parserErrors || qualityIssues || contractIssues ? `${numberText(parserErrors + qualityIssues + contractIssues, 0)} review` : catalogCount ? "Clean enough" : "Unknown",
      status: parserErrors || Number(qualityCounts.bad || 0) || Number(contractCounts.bad || 0) ? "bad" : qualityIssues || contractIssues ? "warn" : catalogCount ? "ok" : "bad",
      detail: `quality ${countSummary(qualityCounts) || "n/a"} / contract ${countSummary(contractCounts) || "n/a"}.`,
    },
    {
      label: "Root Scope",
      title: `${numberText(roots.length, 0)} configured`,
      status: suggestedRoots.length || capped ? "warn" : roots.length ? "ok" : "bad",
      detail: `${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"}; scan ${capped ? "capped" : "not capped"}.`,
    },
    {
      label: "Best Next File",
      title: best ? text(best.symbol) : "none",
      status: best ? "ok" : catalogCount ? "warn" : "idle",
      detail: best ? `${text(best.bar_size)} ${text(best.source)} / ${numberText(best.rows, 0)} rows / ${text(best.path)}` : "No inspectable file is selected or visible.",
    },
  ];
  $("data-history-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
  $("data-history-actions").innerHTML = [
    `<a href="${escapeHtml(primaryHref)}">${escapeHtml(primaryLabel)}</a>`,
    `<a class="secondary" href="#data/inspect">Inspect File</a>`,
    `<a class="secondary" href="#data/compare">Compare</a>`,
    `<a class="secondary" href="#workbench/builder">Use In Workbench</a>`,
    `<a class="secondary" href="#fetch">Fetch Jobs</a>`,
  ].join("");
}

export function dataHistoryMatrixRows(rows = []) {
  const backendRows = ((state.dataHistoryMatrix || {}).rows || (state.dataHistoryMatrix || {}).groups || []);
  if ((!rows || !rows.length) && backendRows.length) {
    return backendRows.map((group) => ({
      ...group,
      asset: text(group.asset || group.asset_class),
      source: text(group.source),
      bar: text(group.bar || group.bar_size),
      session: text(group.session || group.storage_session),
      status: text(group.status || group.replay_status),
      first_label: text(group.first_label || (group.first_timestamp ? String(group.first_timestamp).slice(0, 10) : "n/a")),
      last_label: text(group.last_label || (group.last_timestamp ? String(group.last_timestamp).slice(0, 10) : "n/a")),
      latest_label: group.latest_label || (group.latest_modified_at ? shortTimestampAgeLabel(group.latest_modified_at) : "n/a"),
      replay_counts: group.replay_counts || {},
      quality_counts: group.quality_counts || {},
      contract_counts: group.contract_counts || group.storage_contract_counts || {},
    }));
  }
  const groups = new Map();
  for (const dataset of rows || []) {
    const asset = text(dataset.asset_class);
    const source = text(dataset.source);
    const bar = text(dataset.bar_size);
    const session = text(dataset.storage_session);
    const key = [asset, source, bar, session].join("\u0001");
    if (!groups.has(key)) {
      groups.set(key, {
        asset,
        source,
        bar,
        session,
        symbols: new Set(),
        file_count: 0,
        row_count: 0,
        first: null,
        last: null,
        latest_modified: null,
        replay_counts: {},
        quality_counts: {},
        contract_counts: {},
      });
    }
    const group = groups.get(key);
    const symbol = text(dataset.symbol);
    if (symbol !== "n/a") group.symbols.add(symbol);
    group.file_count += 1;
    group.row_count += Number(dataset.rows || 0);
    const first = timestampMillis(dataset.first_timestamp);
    const last = timestampMillis(dataset.last_timestamp);
    const modified = timestampMillis(dataset.modified_at);
    if (first !== null) group.first = group.first === null ? first : Math.min(group.first, first);
    if (last !== null) group.last = group.last === null ? last : Math.max(group.last, last);
    if (modified !== null) group.latest_modified = group.latest_modified === null ? modified : Math.max(group.latest_modified, modified);
    const replayStatus = dataReplayReadinessModel(dataset).status;
    group.replay_counts[replayStatus] = (group.replay_counts[replayStatus] || 0) + 1;
    const quality = text(dataset.quality_status);
    if (quality !== "n/a") group.quality_counts[quality] = (group.quality_counts[quality] || 0) + 1;
    const contract = text(dataset.storage_contract_status);
    if (contract !== "n/a") group.contract_counts[contract] = (group.contract_counts[contract] || 0) + 1;
  }
  return Array.from(groups.values()).map((group) => {
    const replayBad = Number(group.replay_counts.bad || 0);
    const replayWarn = Number(group.replay_counts.warn || 0);
    const status = replayBad ? "bad" : replayWarn ? "warn" : "ok";
    return {
      ...group,
      symbol_count: group.symbols.size,
      status,
      first_label: group.first === null ? "n/a" : new Date(group.first).toISOString().slice(0, 10),
      last_label: group.last === null ? "n/a" : new Date(group.last).toISOString().slice(0, 10),
      latest_label: group.latest_modified === null ? "n/a" : shortTimestampAgeLabel(new Date(group.latest_modified).toISOString()),
    };
  }).sort((left, right) => (
    Number(right.symbol_count || 0) - Number(left.symbol_count || 0)
    || Number(right.row_count || 0) - Number(left.row_count || 0)
    || `${left.asset} ${left.source} ${left.bar} ${left.session}`.localeCompare(`${right.asset} ${right.source} ${right.bar} ${right.session}`)
  ));
}

export function renderDataHistoryMatrix(filteredRows = []) {
  if (!$("data-history-matrix-note") || !$("data-history-matrix-body")) return;
  const catalogRows = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const activeFilters = dataFilterSummary();
  const backendMatrix = state.dataHistoryMatrix || {};
  const useBackendScope = dataHistoryMatrixBackendScopeApplied(backendMatrix);
  const rows = useBackendScope ? [] : activeFilters.length ? filteredRows : catalogRows;
  const matrix = useBackendScope ? dataHistoryMatrixRows([]) : dataHistoryMatrixRows(rows);
  const totalSymbols = useBackendScope
    ? Number(backendMatrix.symbol_count || 0)
    : new Set((rows || []).map((dataset) => text(dataset.symbol)).filter((value) => value !== "n/a")).size;
  const shown = matrix.slice(0, 18);
  $("data-history-matrix-note").textContent = rows.length
    ? `${numberText(matrix.length, 0)} source/bar/session group${matrix.length === 1 ? "" : "s"} across ${numberText(totalSymbols, 0)} symbol${totalSymbols === 1 ? "" : "s"}${activeFilters.length ? ` after filters: ${activeFilters.join(" / ")}` : ""}.`
    : useBackendScope
      ? `${numberText(matrix.length, 0)} server-backed source/bar/session group${matrix.length === 1 ? "" : "s"} across ${numberText(totalSymbols, 0)} symbol${totalSymbols === 1 ? "" : "s"}${activeFilters.length ? ` after filters: ${activeFilters.join(" / ")}` : ""}.`
    : "No saved history rows are visible; configure data roots, raise the scan limit, or clear filters.";
  renderDataHistoryMatrixSummary(matrix, rows, activeFilters, { serverBacked: useBackendScope });
  $("data-history-matrix-body").innerHTML = shown.length
    ? shown.map((group) => row([
        escapeHtml(group.asset),
        escapeHtml(group.source),
        escapeHtml(group.bar),
        escapeHtml(group.session),
        escapeHtml(numberText(group.symbol_count, 0)),
        escapeHtml(numberText(group.file_count, 0)),
        escapeHtml(numberText(group.row_count, 0)),
        escapeHtml(`${group.first_label} to ${group.last_label}`),
        `<div class="data-readiness-cell ${escapeHtml(statusClass(group.status))}">
          <strong>${escapeHtml(group.status === "bad" ? "Blocked" : group.status === "warn" ? "Review" : "Ready")}</strong>
          <span>${escapeHtml(countSummary(group.replay_counts) || "n/a")}</span>
          <small>${escapeHtml(`Q ${countSummary(group.quality_counts) || "n/a"} / contract ${countSummary(group.contract_counts) || "n/a"} / updated ${group.latest_label}`)}</small>
        </div>`,
        `<span class="button-pair">
          <button type="button" class="secondary data-history-matrix-action" data-matrix-action="filter" data-asset="${escapeHtml(group.asset)}" data-source="${escapeHtml(group.source)}" data-bar="${escapeHtml(group.bar)}" data-session="${escapeHtml(group.session)}">Browse</button>
          <button type="button" class="secondary data-history-matrix-action" data-matrix-action="inspect" data-asset="${escapeHtml(group.asset)}" data-source="${escapeHtml(group.source)}" data-bar="${escapeHtml(group.bar)}" data-session="${escapeHtml(group.session)}">Inspect</button>
          <button type="button" class="secondary data-history-matrix-action" data-matrix-action="compare" data-asset="${escapeHtml(group.asset)}" data-source="${escapeHtml(group.source)}" data-bar="${escapeHtml(group.bar)}" data-session="${escapeHtml(group.session)}" ${group.file_count < 2 ? "disabled" : ""}>Compare</button>
          <button type="button" class="secondary data-history-matrix-action" data-matrix-action="workbench" data-asset="${escapeHtml(group.asset)}" data-source="${escapeHtml(group.source)}" data-bar="${escapeHtml(group.bar)}" data-session="${escapeHtml(group.session)}">Workbench</button>
        </span>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", ""]);
}

export function renderDataHistoryMatrixSummary(matrix = [], rows = [], activeFilters = [], options = {}) {
  if (!$("data-history-matrix-summary")) return;
  if (!matrix.length) {
    $("data-history-matrix-summary").innerHTML = `
      <div class="action-card status-bad">
        <span>Matrix Assistant</span>
        <strong>No history groups</strong>
        <small>Configure data roots, raise the catalog scan limit, or clear filters before looking for symbols.</small>
      </div>
    `;
    return;
  }
  const readyGroups = matrix.filter((group) => group.status === "ok");
  const reviewGroups = matrix.filter((group) => group.status === "warn");
  const blockedGroups = matrix.filter((group) => group.status === "bad");
  const compareReady = matrix.filter((group) => Number(group.file_count || 0) >= 2);
  const top = matrix[0];
  const topLabel = `${text(top.asset)} / ${text(top.source)} / ${text(top.bar)} / ${text(top.session)}`;
  const matrixFileCount = matrix.reduce((sum, group) => sum + Number(group.file_count || 0), 0);
  const totalRows = rows.length
    ? rows.reduce((sum, dataset) => sum + Number(dataset.rows || 0), 0)
    : matrix.reduce((sum, group) => sum + Number(group.row_count || 0), 0);
  const scopeFileCount = rows.length ? rows.length : matrixFileCount;
  const nextTitle = blockedGroups.length
    ? "Review Blockers"
    : compareReady.length ? "Compare Top Group" : "Inspect Best File";
  const nextNote = blockedGroups.length
    ? `${numberText(blockedGroups.length, 0)} group${blockedGroups.length === 1 ? "" : "s"} have replay-blocking quality or metadata issues.`
    : compareReady.length
      ? `${numberText(compareReady.length, 0)} group${compareReady.length === 1 ? "" : "s"} can be compared immediately.`
      : "Only single-file groups are visible; start with Inspect or broaden the catalog scan.";
  const cards = [
    {
      status: top.status,
      label: "Best Starting Group",
      title: topLabel,
      note: `${numberText(top.symbol_count, 0)} symbols / ${numberText(top.file_count, 0)} files / ${numberText(top.row_count, 0)} rows; ${top.first_label} to ${top.last_label}.`,
    },
    {
      status: blockedGroups.length ? "bad" : reviewGroups.length ? "warn" : "ok",
      label: "Replay Readiness",
      title: `${numberText(readyGroups.length, 0)} ready`,
      note: `${numberText(reviewGroups.length, 0)} review / ${numberText(blockedGroups.length, 0)} blocked groups from ${numberText(matrix.length, 0)} total.`,
    },
    {
      status: compareReady.length ? "ok" : "warn",
      label: "Compare/Workbench",
      title: `${numberText(compareReady.length, 0)} multi-file`,
      note: compareReady.length
        ? "Use Compare or Workbench on a matrix row to select the top files in that slice."
        : "Comparison needs at least two files in one source/bar/session group.",
    },
    {
      status: activeFilters.length ? "warn" : "ok",
      label: "Current Scope",
      title: `${numberText(scopeFileCount, 0)} files`,
      note: activeFilters.length
        ? `Matrix is narrowed by ${activeFilters.join(" / ")}${options.serverBacked ? " from the server payload" : " from browser rows"}.`
        : `${numberText(totalRows, 0)} rows are included in the current bounded catalog matrix.`,
    },
    {
      status: blockedGroups.length ? "warn" : "ok",
      label: "Next Action",
      title: nextTitle,
      note: nextNote,
    },
  ];
  $("data-history-matrix-summary").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function dataHistoryMatrixGroupDatasets(target) {
  const asset = text(target.dataset.asset);
  const source = text(target.dataset.source);
  const bar = text(target.dataset.bar);
  const session = text(target.dataset.session);
  return (state.dataCatalog.datasets || []).filter((dataset) => (
    text(dataset.asset_class) === asset
    && text(dataset.source) === source
    && text(dataset.bar_size) === bar
    && text(dataset.storage_session) === session
    && dataset.path
  ));
}

export function applyDataHistoryMatrixFilter(target) {
  clearDataCatalogFilters();
  $("data-filter-asset").value = target.dataset.asset || "";
  $("data-filter-source").value = target.dataset.source || "";
  $("data-filter-bar").value = target.dataset.bar || "";
  $("data-filter-session").value = target.dataset.session || "";
  state.manifestPathFilter = null;
  navigateToDataLens("browse");
  previewDataCatalogServerFilters(`Browse filtered to ${text(target.dataset.asset)} / ${text(target.dataset.source)} / ${text(target.dataset.bar)} / ${text(target.dataset.session)}`);
  if ($("data-catalog-body")) $("data-catalog-body").scrollIntoView({ block: "start", behavior: "smooth" });
}

export async function handleDataHistoryMatrixAction(target) {
  const action = String(target.dataset.matrixAction || "filter");
  if (action === "filter") {
    applyDataHistoryMatrixFilter(target);
    return;
  }
  const groupRows = recommendedDataRows(dataHistoryMatrixGroupDatasets(target));
  if (!groupRows.length) {
    $("data-history-matrix-note").innerHTML = `<span class="status-bad">No inspectable files found for this history group.</span>`;
    return;
  }
  if (action === "inspect") {
    await loadDataDetail(groupRows[0].path, { resetControls: true });
    $("last-refresh").textContent = `Loaded ${text(groupRows[0].symbol)} from Saved History Matrix`;
    return;
  }
  if (action === "compare") {
    const selected = groupRows.slice(0, MAX_DATA_COMPARE_DATASETS);
    if (selected.length < 2) {
      $("data-history-matrix-note").innerHTML = `<span class="status-warn">Need at least two files in this history group to compare.</span>`;
      return;
    }
    state.dataCompareSelectedPaths = selected.map((dataset) => dataset.path);
    state.dataCompareSelectionCleared = false;
    $("data-compare-filter").value = "";
    $("data-compare-asset").value = target.dataset.asset || "";
    $("data-compare-source").value = target.dataset.source || "";
    $("data-compare-bar").value = target.dataset.bar || "";
    $("data-compare-session").value = target.dataset.session || "";
    renderDataCompareControls();
    await loadDataCompare();
    $("last-refresh").textContent = `Loaded comparison for ${numberText(selected.length, 0)} files from Saved History Matrix`;
    return;
  }
  if (action === "workbench") {
    const selected = groupRows.slice(0, MAX_DATA_COMPARE_DATASETS);
    const datasetSelect = $("config-dataset");
    if (!datasetSelect) return;
    const selectedPaths = new Set(selected.map((dataset) => dataset.path));
    for (const option of datasetSelect.options) {
      option.selected = selectedPaths.has(option.value);
    }
    for (const dataset of selected) {
      rememberWorkbenchDataset(dataset);
      if (Array.from(datasetSelect.options).some((option) => option.value === dataset.path)) continue;
      const option = document.createElement("option");
      option.value = dataset.path;
      option.textContent = `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`;
      option.selected = true;
      attachDatasetOptionMetadata(option, dataset);
      datasetSelect.appendChild(option);
    }
    const range = timestampRangeFromDatasets(selected);
    if ($("config-start-date")) $("config-start-date").value = range.start || "";
    if ($("config-end-date")) $("config-end-date").value = range.end || "";
    renderConfigLivePanels();
    navigateToWorkbenchLens("builder");
    window.setTimeout(() => {
      const destination = $("workbench-stepper") || $("config-form");
      if (destination) destination.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
    $("last-refresh").textContent = `Selected ${numberText(selected.length, 0)} matrix file${selected.length === 1 ? "" : "s"} for Workbench`;
  }
}

export function dataHomeWorkflowCards(filteredRows = []) {
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
      status: visibleSymbols.size ? "ok" : "idle",
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
      status: datasets.length ? selectedRows.length ? "ok" : "warn" : "idle",
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

export function renderDataHomeWorkflows(filteredRows = []) {
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

export function renderDataHomeShortlist(filteredRows = []) {
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

export function renderDataPreviewWall(filteredRows = []) {
  const container = $("data-preview-wall");
  if (!container || !$("data-preview-wall-note")) return;
  const rows = recommendedDataRows(filteredRows).slice(0, 8);
  const total = (filteredRows.length ? filteredRows : (state.dataCatalog.datasets || [])).length;
  renderDataPreviewSummary(rows, total, filteredRows);
  $("data-preview-wall-note").textContent = rows.length
    ? `${numberText(rows.length, 0)} preview${rows.length === 1 ? "" : "s"} from ${numberText(total, 0)} visible saved file${total === 1 ? "" : "s"}`
    : "No saved files are currently visible for preview";
  if (!rows.length) {
    container.innerHTML = `<div class="empty-card"><strong>No saved-data previews</strong><span>Configure data roots, clear filters, or fetch historical data to populate this wall.</span></div>`;
    return;
  }
  container.innerHTML = rows.map((dataset) => {
    const symbol = text(dataset.symbol);
    const exactMatches = (symbolBrowserGroups().get(symbol) || []).filter((item) => item.path);
    const compareDisabled = exactMatches.length < 2 ? " disabled" : "";
    const previewReturn = previewCloseReturn(dataset.preview || []);
    const returnLabel = Number.isFinite(previewReturn) ? pctText(previewReturn) : "n/a";
    return `
      <div class="data-preview-card">
        <div class="data-preview-card-head">
          <span class="eyebrow">${escapeHtml(text(dataset.asset_class))} / ${escapeHtml(text(dataset.source))}</span>
          <strong>${escapeHtml(symbol)}</strong>
          <small>${escapeHtml(text(dataset.bar_size))} / ${escapeHtml(text(dataset.storage_session))} / ${escapeHtml(numberText(dataset.rows, 0))} rows</small>
        </div>
        <div class="data-preview-spark">${miniChart(dataset.preview || [])}</div>
        <div class="data-preview-card-meta">
          <span>${escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp))}</span>
          <span>preview return ${escapeHtml(returnLabel)}</span>
          <span>${qualityBadge(dataset.quality_status, dataset.quality_warnings)} ${qualityBadge(dataset.storage_contract_status, dataset.storage_contract_warnings)}</span>
        </div>
        <div class="data-shortlist-actions">
          <button type="button" data-home-action="inspect" data-path="${escapeHtml(dataset.path)}" data-symbol="${escapeHtml(symbol)}">Inspect</button>
          <button type="button" class="secondary" data-home-action="workbench" data-path="${escapeHtml(dataset.path)}" data-symbol="${escapeHtml(symbol)}">Workbench</button>
          <button type="button" class="secondary" data-home-action="compare" data-symbol="${escapeHtml(symbol)}"${compareDisabled}>Compare</button>
        </div>
      </div>
    `;
  }).join("");
}

export function renderDataPreviewSummary(rows = [], total = 0, filteredRows = []) {
  const container = $("data-preview-summary");
  if (!container) return;
  const catalogRows = state.dataCatalog.datasets || [];
  const activeFilters = dataFilterSummary();
  if (!rows.length) {
    container.innerHTML = `
      <div class="action-card status-bad">
        <span>Preview Summary</span>
        <strong>No Previewable Files</strong>
        <small>Configure data roots, refresh the catalog, clear filters, or run a fetch job before using saved-data previews.</small>
      </div>
    `;
    return;
  }
  const symbols = new Set(rows.map((dataset) => text(dataset.symbol)).filter((item) => item !== "n/a"));
  const sourceCounts = countBy(rows, "source");
  const barCounts = countBy(rows, "bar_size");
  const readinessCounts = rows.reduce((counts, dataset) => {
    const status = dataReplayReadinessModel(dataset).status;
    counts[status] = (counts[status] || 0) + 1;
    return counts;
  }, {});
  const returns = rows.map((dataset) => ({
    dataset,
    value: previewCloseReturn(dataset.preview || []),
  })).filter((item) => Number.isFinite(item.value));
  const leader = returns.slice().sort((left, right) => Number(right.value || 0) - Number(left.value || 0))[0] || null;
  const previewable = rows.filter((dataset) => (dataset.preview || []).length >= 2);
  const range = rows.reduce((acc, dataset) => {
    const first = timestampMillis(dataset.first_timestamp);
    const last = timestampMillis(dataset.last_timestamp);
    if (first !== null) acc.first = acc.first === null ? first : Math.min(acc.first, first);
    if (last !== null) acc.last = acc.last === null ? last : Math.max(acc.last, last);
    return acc;
  }, { first: null, last: null });
  const rangeText = range.first !== null && range.last !== null
    ? `${new Date(range.first).toISOString().slice(0, 10)} to ${new Date(range.last).toISOString().slice(0, 10)}`
    : "n/a";
  const ready = Number(readinessCounts.ok || 0);
  const review = Number(readinessCounts.warn || 0);
  const blocked = Number(readinessCounts.bad || 0);
  const scopeStatus = activeFilters.length ? "warn" : "ok";
  const readinessStatus = blocked ? "bad" : review ? "warn" : "ok";
  const previewStatus = previewable.length ? "ok" : "warn";
  const nextStatus = blocked ? "warn" : previewable.length ? "ok" : "warn";
  const nextTitle = blocked
    ? "Review Blockers"
    : previewable.length >= 2 ? "Compare Or Inspect" : "Inspect First";
  const nextNote = blocked
    ? `${numberText(blocked, 0)} previewed file${blocked === 1 ? "" : "s"} have replay-blocking readiness.`
    : previewable.length >= 2
      ? "Use preview cards to inspect individual files or compare symbols with visible sampled paths."
      : "Only one sampled path is available; inspect it before sending to Workbench.";
  const cards = [
    {
      status: scopeStatus,
      label: "Preview Scope",
      title: `${numberText(symbols.size, 0)} symbols`,
      note: `${numberText(rows.length, 0)} shown / ${numberText(total, 0)} visible files${activeFilters.length ? ` after filters: ${activeFilters.join(" / ")}` : ""}.`,
    },
    {
      status: readinessStatus,
      label: "Replay Readiness",
      title: `${numberText(ready, 0)} ready`,
      note: `${numberText(review, 0)} review / ${numberText(blocked, 0)} blocked among previewed files.`,
    },
    {
      status: previewStatus,
      label: "Coverage Preview",
      title: rangeText,
      note: `${numberText(previewable.length, 0)} sampled close path${previewable.length === 1 ? "" : "s"}; sources ${countSummary(sourceCounts)}; bars ${countSummary(barCounts)}.`,
    },
    {
      status: leader ? Number(leader.value) >= 0 ? "ok" : "bad" : "warn",
      label: "Preview Leader",
      title: leader ? text(leader.dataset.symbol) : "n/a",
      note: leader
        ? `Sampled close return ${pctText(leader.value)} from ${text(leader.dataset.source)} ${text(leader.dataset.bar_size)}.`
        : "No sampled preview return is available in the current card set.",
    },
    {
      status: nextStatus,
      label: "Next Move",
      title: nextTitle,
      note: `${nextNote} Catalog has ${numberText(catalogRows.length, 0)} total bounded rows loaded.`,
    },
  ];
  container.innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function rootCatalogSummary(root, rootSummaries = [], datasets = []) {
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

export function renderDataSourceMap() {
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
