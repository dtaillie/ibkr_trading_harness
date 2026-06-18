import {
  $,
  age,
  bytes,
  dataCatalogPreviewPoints,
  dataLibraryLoadState,
  durationMsText,
  escapeHtml,
  fetchJson,
  jsonDrilldown,
  navigateToDataLens,
  navigateToView,
  numberText,
  qualityBadge,
  renderPageIntro,
  row,
  selectedDataCatalogLimit,
  selectedDataCatalogOffset,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { finiteNumber, shortTimestampAgeLabel, timestampMillis } from "./30_runtime_core.js";
import { compactDataPreviewChart, rangeLabel } from "./34_charts.js";
import { renderDataCatalog, runDataCatalogServerSearch } from "./41_data_explorer.js";
import { handleSymbolSelectionAction, renderDataCoverage, renderSymbolSelectionPanel, selectCatalogDatasetInWorkbench } from "./42_data_symbols.js";
import { dataCatalogDatasetByPath } from "./50_fetch.js";
import { replaceOptions } from "./60_workbench_builder.js";
import { copyText, diagnoseDataSymbol, loadDataDetail, refresh } from "./90_bootstrap.js";

export function dataCatalogFilters() {
  return {
    text: ($("data-filter-text").value || "").trim().toLowerCase(),
    quality: $("data-filter-quality").value || "",
    bar: $("data-filter-bar").value || "",
    asset: $("data-filter-asset").value || "",
    source: $("data-filter-source").value || "",
    session: $("data-filter-session").value || "",
    contract: $("data-filter-contract").value || "",
    replay: $("data-filter-replay").value || "",
    sort: $("data-filter-sort").value || "modified_desc",
  };
}

export function dataReplayReadinessModel(dataset) {
  const quality = text(dataset.quality_status).toLowerCase();
  const contract = text(dataset.storage_contract_status).toLowerCase();
  const adjustment = text(dataset.adjustment_status).toLowerCase();
  const timezone = text(dataset.source_timezone).toLowerCase();
  const missing = finiteNumber(dataset.estimated_missing_intervals) || 0;
  const warnings = [
    ...(Array.isArray(dataset.quality_warnings) ? dataset.quality_warnings : []),
    ...(Array.isArray(dataset.storage_contract_warnings) ? dataset.storage_contract_warnings : []),
  ].map(text).filter((item) => item && item !== "n/a");
  const reviewReasons = [];
  if (missing > 0) reviewReasons.push(`${numberText(missing, 0)} missing interval${missing === 1 ? "" : "s"}`);
  if (!timezone || timezone === "unknown" || timezone === "n/a") reviewReasons.push("unknown source timezone");
  if (adjustment === "unknown") reviewReasons.push("unknown adjustment metadata");
  if (warnings.length) reviewReasons.push(warnings[0]);
  const status = quality === "bad" || contract === "bad"
    ? "bad"
    : quality === "warn" || contract === "warn" || reviewReasons.length
      ? "warn"
      : "ok";
  const title = status === "ok" ? "Replay Ready" : status === "bad" ? "Blocked" : "Review";
  const detail = status === "ok"
    ? "No catalog quality or storage-contract warnings."
    : reviewReasons.slice(0, 2).join("; ") || "Review quality and storage-contract metadata.";
  return { status, title, detail };
}

export function dataCatalogSortValue(dataset, key) {
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
  if (key === "replay") {
    const rank = { ok: 0, warn: 1, bad: 2 };
    return rank[dataReplayReadinessModel(dataset).status] ?? 3;
  }
  return String(dataset.symbol || dataset.path || "").toLowerCase();
}

export function sortDataCatalogRows(datasets, sortKey) {
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

export function filteredDataCatalog(datasets) {
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
    if (filters.replay && dataReplayReadinessModel(dataset).status !== filters.replay) return false;
    if (filters.text) {
      const replay = dataReplayReadinessModel(dataset);
      const haystack = [
        dataset.symbol,
        dataset.asset_class,
        dataset.source,
        dataset.bar_size,
        dataset.storage_session,
        dataset.storage_contract_status,
        dataset.storage_contract_label,
        replay.title,
        replay.status,
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

export function renderDataFilterOptions(datasets) {
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

export function symbolBrowserGroups(datasets = state.dataCatalog.datasets || []) {
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

export function symbolBrowserFacetControls() {
  return {
    source: (($("data-symbol-browser-source") || {}).value || ""),
    bar: (($("data-symbol-browser-bar") || {}).value || ""),
    session: (($("data-symbol-browser-session") || {}).value || ""),
    quality: (($("data-symbol-browser-quality") || {}).value || ""),
    contract: (($("data-symbol-browser-contract") || {}).value || ""),
  };
}

export function datasetMatchesSymbolBrowserFacets(dataset, facets = symbolBrowserFacetControls()) {
  return (!facets.source || text(dataset.source) === facets.source)
    && (!facets.bar || text(dataset.bar_size) === facets.bar)
    && (!facets.session || text(dataset.storage_session) === facets.session)
    && (!facets.quality || text(dataset.quality_status) === facets.quality)
    && (!facets.contract || text(dataset.storage_contract_status) === facets.contract);
}

export function symbolBrowserFilteredDatasets() {
  const facets = symbolBrowserFacetControls();
  return (state.dataCatalog.datasets || []).filter((dataset) => datasetMatchesSymbolBrowserFacets(dataset, facets));
}

export function symbolBrowserFilteredGroups() {
  return symbolBrowserGroups(symbolBrowserFilteredDatasets());
}

export function symbolBrowserFacetSummary(facets = symbolBrowserFacetControls()) {
  return [
    facets.source ? `source ${facets.source}` : "",
    facets.bar ? `bar ${facets.bar}` : "",
    facets.session ? `session ${facets.session}` : "",
    facets.quality ? `quality ${facets.quality}` : "",
    facets.contract ? `contract ${facets.contract}` : "",
  ].filter(Boolean);
}

export function renderSymbolBrowserFacetOptions(datasets = state.dataCatalog.datasets || []) {
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

export function renderCatalogSymbolDatalists(browserSymbols, catalogSymbols = browserSymbols) {
  const renderOptions = (symbols) => (symbols || []).map((symbol) => `<option value="${escapeHtml(symbol)}"></option>`).join("");
  const browserDatalist = $("data-symbol-browser-options");
  if (browserDatalist) browserDatalist.innerHTML = renderOptions(browserSymbols);
  const catalogDatalist = $("data-filter-symbol-options");
  if (catalogDatalist) catalogDatalist.innerHTML = renderOptions(catalogSymbols);
}

export function selectedSymbolBrowserSymbol() {
  return ($("data-symbol-browser-input").value || "").trim().toUpperCase();
}

export function selectedSymbolBrowserDatasets() {
  const symbol = selectedSymbolBrowserSymbol();
  if (!symbol) return [];
  return symbolBrowserFilteredGroups().get(symbol) || [];
}

export function symbolGroupSummary(symbol, rows) {
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

export function symbolQuickPickSuggestions(query, groups, limit = 8) {
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

export function renderSymbolQuickPicks(groups, query) {
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

export function symbolMatchLabel(score) {
  if (score === 0) return "exact";
  if (score === 1) return "starts";
  if (score === 2) return "contains";
  return "ranked";
}

export function symbolTypeaheadSuggestions(groups, query) {
  return symbolQuickPickSuggestions(query, groups, 6);
}

export function renderSymbolTypeahead(groups, query) {
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

export function selectSymbolBrowserSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return;
  $("data-symbol-browser-input").value = normalized;
  renderSymbolBrowser();
}

export function topSymbolBrowserSuggestion() {
  const groups = symbolBrowserFilteredGroups();
  const suggestions = symbolTypeaheadSuggestions(groups, selectedSymbolBrowserSymbol());
  return (suggestions[0] || {}).symbol || "";
}

export function activeSymbolTypeaheadSuggestion() {
  const groups = symbolBrowserFilteredGroups();
  const suggestions = symbolTypeaheadSuggestions(groups, selectedSymbolBrowserSymbol());
  if (!suggestions.length) return "";
  const index = Math.max(0, Math.min(state.symbolTypeaheadActiveIndex || 0, suggestions.length - 1));
  return (suggestions[index] || {}).symbol || "";
}

export function moveSymbolTypeaheadSelection(delta) {
  const groups = symbolBrowserFilteredGroups();
  const suggestions = symbolTypeaheadSuggestions(groups, selectedSymbolBrowserSymbol());
  if (!suggestions.length) return "";
  state.symbolTypeaheadActiveIndex = ((state.symbolTypeaheadActiveIndex || 0) + delta + suggestions.length) % suggestions.length;
  renderSymbolTypeahead(groups, selectedSymbolBrowserSymbol());
  return (suggestions[state.symbolTypeaheadActiveIndex] || {}).symbol || "";
}

export function symbolRootIndexEntry(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return null;
  return ((state.dataSymbolIndex || {}).symbols || [])
    .find((item) => text(item.symbol).toUpperCase() === normalized) || null;
}

export function rootIndexSamplePathsForSymbol(symbol) {
  return rootIndexArray(symbolRootIndexEntry(symbol) || {}, "sample_paths");
}

export function symbolVisibilityDiagnostic(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const diagnostic = state.symbolDiagnostic || {};
  return normalized && text(diagnostic.symbol).toUpperCase() === normalized ? diagnostic : null;
}

export function symbolVisibilityModel(symbol = selectedSymbolBrowserSymbol()) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const filteredRows = normalized ? (symbolBrowserFilteredGroups().get(normalized) || []) : [];
  const catalogRows = normalized ? (symbolBrowserGroups().get(normalized) || []) : [];
  const rootEntry = symbolRootIndexEntry(normalized);
  const rootFiles = Number((rootEntry || {}).file_count || rootIndexArray(rootEntry || {}, "sample_paths").length || 0);
  const diagnostic = symbolVisibilityDiagnostic(normalized);
  const diagnosticSummary = (diagnostic || {}).diagnostic_summary || {};
  const diagnosticStatus = diagnostic ? (
    diagnosticSummary.status === "ok" || diagnostic.status === "visible" ? "ok"
      : diagnosticSummary.status === "bad" || diagnostic.status === "not_found" ? "bad"
        : "warn"
  ) : normalized ? "warn" : "bad";
  const facets = symbolBrowserFacetSummary();
  const rootSamples = rootIndexArray(rootEntry || {}, "sample_paths");
  const fetchRows = (diagnostic || {}).fetch_manifest_rows || [];
  let status = "bad";
  let title = "Enter a symbol";
  let note = "Type a ticker in Symbol Browser to explain whether saved data is visible, filtered out, only on disk, or missing.";
  if (normalized && filteredRows.length) {
    status = "ok";
    title = "Catalog visible";
    note = `${normalized} has ${numberText(filteredRows.length, 0)} visible saved file${filteredRows.length === 1 ? "" : "s"} under current facets.`;
  } else if (normalized && catalogRows.length) {
    status = "warn";
    title = "Hidden by facets";
    note = `${normalized} exists in the catalog, but current Symbol Browser facets hide every file.`;
  } else if (normalized && rootEntry) {
    status = "warn";
    title = "On disk, not catalog-visible";
    note = `${normalized} appears in the root index, but no parsed catalog row is visible. Diagnose root scope, parsing, catalog limits, or storage metadata.`;
  } else if (normalized && diagnostic) {
    status = diagnostic.status === "visible" ? "ok" : diagnostic.status === "not_found" ? "bad" : "warn";
    title = text(diagnostic.message || diagnostic.status || "Diagnostic loaded");
    note = text(diagnostic.action || "Review symbol diagnostic details.");
  } else if (normalized) {
    status = "bad";
    title = "No local evidence";
    note = `${normalized} is not visible in the catalog or root index. Diagnose roots/fetch manifests or fetch the symbol.`;
  }
  const cards = [
    {
      status,
      label: "Visibility",
      title,
      note,
    },
    {
      status: filteredRows.length ? "ok" : catalogRows.length ? "warn" : "bad",
      label: "Catalog",
      title: `${numberText(filteredRows.length, 0)} visible / ${numberText(catalogRows.length, 0)} total`,
      note: catalogRows.length
        ? `${countSummary(countBy(catalogRows, "source"))} sources; ${countSummary(countBy(catalogRows, "bar_size"))} bars.`
        : "No parsed catalog rows match this symbol.",
    },
    {
      status: facets.length && !filteredRows.length && catalogRows.length ? "warn" : facets.length ? "ok" : "warn",
      label: "Facets",
      title: facets.length ? facets.join(" / ") : "None",
      note: facets.length
        ? filteredRows.length ? "Current facets still allow visible rows." : catalogRows.length ? "Clear facets to reveal catalog rows." : "Facets are active, but there are no catalog rows to reveal."
        : "No Symbol Browser facets are narrowing this symbol.",
    },
    {
      status: rootEntry ? catalogRows.length ? "ok" : "warn" : "bad",
      label: "Root Index",
      title: rootEntry ? `${numberText(rootFiles, 0)} candidate file${rootFiles === 1 ? "" : "s"}` : "No candidate",
      note: rootEntry
        ? `${rootIndexArray(rootEntry, "sources").join(", ") || "unknown source"} / ${rootIndexArray(rootEntry, "bar_sizes").join(", ") || "unknown bar"}.`
        : "Root index has no filename/path-inferred match.",
    },
    {
      status: diagnosticStatus,
      label: "Diagnostic",
      title: diagnostic ? text(diagnostic.status) : "Not run",
      note: diagnostic
        ? `${numberText(diagnosticSummary.configured_candidate_count ?? (diagnostic.configured_candidates || []).length, 0)} configured candidates / ${numberText(diagnosticSummary.unconfigured_match_count ?? (diagnostic.unconfigured_matches || []).length, 0)} unconfigured / ${numberText(fetchRows.length, 0)} fetch clues.`
        : normalized ? "Run Diagnose for root, parser, catalog-limit, and fetch-manifest evidence." : "Enter a symbol before diagnosing.",
    },
  ];
  const lines = [
    {
      status: filteredRows.length ? "ok" : catalogRows.length ? "warn" : "bad",
      title: "Catalog Explanation",
      detail: !normalized
        ? "No symbol query is active."
        : filteredRows.length
          ? `${normalized} is visible now. Inspect, compare, filter, or send the best file to Workbench.`
          : catalogRows.length
            ? `${normalized} has catalog rows, but current facets hide them: ${facets.join(" / ") || "unknown facet state"}.`
            : "No parsed catalog row currently matches this symbol.",
    },
    {
      status: rootEntry ? "warn" : "bad",
      title: "Disk Clues",
      detail: rootEntry
        ? `${numberText(rootFiles, 0)} root-index candidate${rootFiles === 1 ? "" : "s"}; ${rootSamples.length ? `${numberText(rootSamples.length, 0)} sample path${rootSamples.length === 1 ? "" : "s"}` : "no sample paths"}; source ${rootIndexArray(rootEntry, "sources").join(", ") || "unknown"} / bars ${rootIndexArray(rootEntry, "bar_sizes").join(", ") || "unknown"}.`
        : "No root-index candidate is loaded for this symbol.",
    },
    {
      status: diagnostic ? "ok" : normalized ? "warn" : "bad",
      title: "Diagnostic Evidence",
      detail: diagnostic
        ? `${text(diagnostic.message || diagnostic.status)} Next step: ${text(diagnostic.action || "review diagnostic tables")}.`
        : "Diagnose has not been run for the active symbol in this session.",
    },
  ];
  const next = !normalized
    ? { label: "Type Symbol", action: "", status: "bad", disabled: true }
    : filteredRows.length
      ? { label: "Inspect Best File", action: "inspect", status: "ok" }
      : catalogRows.length
        ? { label: "Clear Facets", action: "clear-facets", status: "warn" }
        : rootEntry || !diagnostic
          ? { label: "Diagnose", action: "diagnose", status: "warn" }
          : { label: "Open Fetch Jobs", action: "fetch", status: "bad" };
  return { symbol: normalized, status, title, note, cards, lines, next, rootEntry };
}

export function renderSymbolVisibilityExplainer() {
  if (!$("data-symbol-visibility-note") || !$("data-symbol-visibility-cards") || !$("data-symbol-visibility-body") || !$("data-symbol-visibility-actions")) return;
  const model = symbolVisibilityModel();
  $("data-symbol-visibility-note").textContent = model.symbol ? `${model.symbol}: ${model.note}` : model.note;
  $("data-symbol-visibility-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-symbol-visibility-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  const actions = [
    model.next,
    { label: "Filter Catalog", action: "filter", status: "ok", disabled: !model.symbol },
    { label: "Show Root Index", action: "root-index", status: "warn", disabled: !model.rootEntry },
    { label: "Inspect Sample", action: "inspect-root-sample", status: "warn", disabled: !model.rootEntry || !rootIndexSamplePathsForSymbol(model.symbol).length },
    { label: "Copy Paths", action: "copy-root-paths", status: "warn", disabled: !model.rootEntry },
    { label: "Diagnose", action: "diagnose", status: "warn", disabled: !model.symbol },
    { label: "Fetch Jobs", action: "fetch", status: "warn", disabled: false },
  ].filter((action, index, array) => action && action.action !== "" && array.findIndex((item) => item.action === action.action) === index);
  $("data-symbol-visibility-actions").innerHTML = actions.map((action) => `
    <button type="button" class="${action.status === "ok" ? "" : "secondary"}" data-symbol-visibility-action="${escapeHtml(action.action)}"${action.disabled ? " disabled" : ""}>${escapeHtml(action.label)}</button>
  `).join("");
}

export async function handleSymbolVisibilityAction(action) {
  if (action === "clear-facets") {
    $("data-symbol-browser-source").value = "";
    $("data-symbol-browser-bar").value = "";
    $("data-symbol-browser-session").value = "";
    $("data-symbol-browser-quality").value = "";
    $("data-symbol-browser-contract").value = "";
    renderSymbolBrowser();
    $("last-refresh").textContent = "Symbol facets cleared";
    return;
  }
  if (action === "filter" || action === "inspect" || action === "diagnose") {
    await handleSymbolSelectionAction(action);
    renderSymbolVisibilityExplainer();
    return;
  }
  if (action === "root-index") {
    const symbol = selectedSymbolBrowserSymbol();
    if (!symbol) throw new Error("Enter a symbol first");
    $("data-root-index-filter").value = symbol;
    renderRootIndexBrowser();
    navigateToDataLens("browse");
    $("last-refresh").textContent = `Root Index filtered to ${symbol}`;
    return;
  }
  if (action === "copy-root-paths") {
    const symbol = selectedSymbolBrowserSymbol();
    const paths = rootIndexSamplePathsForSymbol(symbol);
    if (!paths.length) throw new Error(`No root-index sample paths for ${symbol || "selected symbol"}`);
    await copyText(paths.join("\n"));
    $("last-refresh").textContent = `Copied ${numberText(paths.length, 0)} root-index sample path${paths.length === 1 ? "" : "s"} for ${symbol}`;
    return;
  }
  if (action === "inspect-root-sample") {
    const symbol = selectedSymbolBrowserSymbol();
    const path = rootIndexSamplePathsForSymbol(symbol)[0] || "";
    if (!path) throw new Error(`No root-index sample path for ${symbol || "selected symbol"}`);
    await loadDataDetail(path, { resetControls: true });
    $("last-refresh").textContent = `Loaded root-index sample for ${symbol}`;
    return;
  }
  if (action === "fetch") {
    navigateToView("fetch");
  }
}

export function bestCatalogDatasetForSymbol(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return null;
  return (symbolBrowserGroups().get(normalized) || [])[0] || null;
}

export function datasetQualityRank(value) {
  const rank = { ok: 0, warn: 1, bad: 2 };
  return rank[String(value || "").toLowerCase()] ?? 3;
}

export function recommendedDataRows(filteredRows = []) {
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

export function renderDataSearchAssistant(filteredRows = []) {
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
      status: Number(qualityCounts.bad || 0) ? "bad" : Number(qualityCounts.warn || 0) ? "warn" : filteredRows.length ? "ok" : "idle",
      title: countSummary(qualityCounts),
      note: Number(qualityCounts.bad || 0) || Number(qualityCounts.warn || 0)
        ? "Review warn/bad files before replay."
        : filteredRows.length ? "Matching rows are currently ok-quality." : "No quality counts to show.",
    },
    {
      label: "Contract",
      status: Number(contractCounts.bad || 0) ? "bad" : Number(contractCounts.warn || 0) ? "warn" : filteredRows.length ? "ok" : "idle",
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

export function renderSymbolBrowser() {
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
  renderSymbolVisibilityExplainer();
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

export function symbolProfileModel(symbol) {
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

export function renderSymbolProfile(symbol) {
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
      status: hasRows ? "ok" : "idle",
      label: "Files",
      title: numberText(model.rows.length, 0),
      note: hasRows ? `${numberText(model.totalRows, 0)} total rows across selected symbol files.` : "No catalog-visible files for this symbol.",
    },
    {
      status: model.range.start && model.range.end ? "ok" : hasRows ? "warn" : "idle",
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
      status: model.best ? "ok" : "idle",
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

export function symbolDirectoryControls() {
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

export function renderSymbolDirectoryFilterOptions(datasets) {
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

export function symbolDirectoryQualityScore(qualities) {
  const rank = { ok: 0, warn: 1, bad: 2 };
  const entries = Object.keys(qualities || {});
  if (!entries.length) return 3;
  return Math.min(...entries.map((key) => rank[String(key).toLowerCase()] ?? 3));
}

export function symbolDirectorySortValue(item, key) {
  if (key === "files") return Number(item.file_count || 0);
  if (key === "rows") return Number(item.row_count || 0);
  if (key === "latest") return timestampMillis(item.last_day) || 0;
  if (key === "quality") return symbolDirectoryQualityScore(item.qualities);
  if (key === "contract") return symbolDirectoryQualityScore(item.contracts);
  return String(item.symbol || "").toLowerCase();
}

export function sortSymbolDirectoryRows(rows, sortKey) {
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

export function symbolDirectoryRows() {
  const controls = symbolDirectoryControls();
  const datasetByPath = new Map((state.dataCatalog.datasets || []).map((dataset) => [dataset.path, dataset]));
  const directoryPayload = state.dataSymbolDirectory || {};
  const summaries = (directoryPayload.symbol_summaries || directoryPayload.symbols || state.dataCatalog.symbol_summaries || []);
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

export function countArrayValues(rows, key) {
  const counts = {};
  for (const rowItem of rows || []) {
    for (const value of rowItem[key] || []) {
      if (!value || value === "n/a") continue;
      counts[value] = (counts[value] || 0) + 1;
    }
  }
  return counts;
}

export function renderSymbolDirectorySummary(directory) {
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

export function firstUniqueSymbolRows(candidates) {
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

export function symbolDirectoryRecommendationRows(directory) {
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

export function renderSymbolDirectoryAssistant(directory) {
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
      status: rows.length ? "ok" : "idle",
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
      status: qualityOk ? "ok" : rows.length ? "warn" : "idle",
      label: "Clean",
      title: numberText(qualityOk, 0),
      note: rows.length ? `${numberText(rows.length - qualityOk, 0)} matched symbol${rows.length - qualityOk === 1 ? "" : "s"} need quality review.` : "No quality rows loaded.",
    },
    {
      status: contractOk ? "ok" : rows.length ? "warn" : "idle",
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

export function renderSymbolCoverageLedger(directory) {
  if (!$("data-symbol-coverage-note") || !$("data-symbol-coverage-body")) return;
  const rows = directory.rows || [];
  const allRows = directory.all_rows || [];
  const activeFilters = [
    directory.controls.filter ? `search ${directory.controls.filter}` : "",
    directory.controls.asset,
    directory.controls.source,
    directory.controls.bar,
    directory.controls.session,
    directory.controls.quality,
    directory.controls.contract,
  ].filter(Boolean);
  $("data-symbol-coverage-note").textContent = rows.length
    ? `${numberText(rows.length, 0)} shown / ${numberText(allRows.length, 0)} matched symbol${allRows.length === 1 ? "" : "s"}${activeFilters.length ? ` after ${activeFilters.join(", ")}` : ""}`
    : allRows.length
      ? "Current Show limit hides all rows; increase the directory limit or clear filters."
      : "No symbol coverage rows match the current directory filters.";
  $("data-symbol-coverage-body").innerHTML = rows.length
    ? rows.map((item) => {
        const symbol = text(item.symbol);
        const bestPath = text((item.best || {}).path);
        const qualityScore = symbolDirectoryQualityScore(item.qualities);
        const contractScore = symbolDirectoryQualityScore(item.contracts);
        const readinessStatus = qualityScore > 1 || contractScore > 1 ? "bad" : qualityScore || contractScore ? "warn" : "ok";
        const canCompare = Number(item.file_count || 0) >= 2;
        return row([
          escapeHtml(symbol),
          escapeHtml(rangeLabel(item.first_day, item.last_day)),
          escapeHtml(numberText(item.file_count, 0)),
          escapeHtml(numberText(item.row_count, 0)),
          escapeHtml(item.sources.join(", ") || "unknown"),
          escapeHtml(item.bars.join(", ") || "unknown"),
          escapeHtml(item.session_profile || item.sessions.join(", ") || "unknown"),
          `<div class="data-readiness-cell ${escapeHtml(statusClass(readinessStatus))}">
            <strong>${escapeHtml(readinessStatus === "bad" ? "Blocked" : readinessStatus === "warn" ? "Review" : "Ready")}</strong>
            <span>${escapeHtml(`Q ${countSummary(item.qualities) || "n/a"} / contract ${countSummary(item.contracts) || "n/a"}`)}</span>
            <small>${escapeHtml(item.mixed_sessions ? "Mixed sessions; verify replay scope." : "Single session profile.")}</small>
          </div>`,
          `<span class="button-pair">
            <button type="button" class="secondary symbol-directory-inspect" data-symbol="${escapeHtml(symbol)}" data-path="${escapeHtml(bestPath)}">Inspect</button>
            <button type="button" class="secondary symbol-directory-filter" data-symbol="${escapeHtml(symbol)}">Filter</button>
            <button type="button" class="secondary symbol-directory-compare" data-symbol="${escapeHtml(symbol)}"${canCompare ? "" : " disabled"}>Compare</button>
            <button type="button" class="secondary symbol-directory-workbench" data-symbol="${escapeHtml(symbol)}" data-path="${escapeHtml(bestPath)}" title="Use in Workbench">Build</button>
          </span>`,
        ]);
      }).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", ""]);
}

export function renderSymbolDirectory() {
  if (!$("data-symbol-directory") || !$("data-symbol-directory-note")) return;
  const groups = symbolBrowserGroups();
  renderSymbolDirectoryFilterOptions(state.dataCatalog.datasets || []);
  const directory = symbolDirectoryRows();
  const rows = directory.rows;
  const filteredCount = directory.filtered_count;
  const totalSymbols = Number((state.dataSymbolDirectory || {}).symbol_count || state.dataCatalog.symbol_count || groups.size || directory.total_count || 0);
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
  renderSymbolCoverageLedger(directory);
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
              <button type="button" class="secondary symbol-directory-workbench" data-symbol="${symbol}" data-path="${bestPath}" title="Use in Workbench">Build</button>
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

export function countSummary(counts) {
  const entries = Object.entries(counts || {});
  return entries.length
    ? entries.map(([key, value]) => `${key}:${numberText(value, 0)}`).join(" ")
    : "none";
}

export function topCountEntries(counts, limit = 4) {
  return Object.entries(counts || {})
    .filter(([key, value]) => key && key !== "n/a" && Number(value || 0) > 0)
    .sort((left, right) => {
      const countDelta = Number(right[1] || 0) - Number(left[1] || 0);
      return countDelta || String(left[0]).localeCompare(String(right[0]));
    })
    .slice(0, limit);
}

export function breakdownChips(label, counts) {
  const entries = topCountEntries(counts);
  const chips = entries.length
    ? entries.map(([key, value]) => `<span class="breakdown-chip">${escapeHtml(key)} ${escapeHtml(numberText(value, 0))}</span>`).join("")
    : `<span class="breakdown-chip">none</span>`;
  return `<div class="breakdown-group"><span>${escapeHtml(label)}</span><div class="breakdown-chips">${chips}</div></div>`;
}

export function countBy(rows, key) {
  const counts = {};
  for (const rowItem of rows || []) {
    const value = text(rowItem[key]);
    if (!value || value === "n/a") continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

export function dataUniverseRows() {
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

export function renderDataUniversePanel() {
  if (!$("data-universe-title") || !$("data-universe-cards") || !$("data-universe-symbols")) return;
  const rows = dataUniverseRows();
  const symbolIndex = state.dataSymbolIndex || {};
  const indexFileCount = Number(symbolIndex.file_count || 0);
  const indexSymbolCount = Number(symbolIndex.symbol_count || 0);
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
    ? `${numberText(rows.length, 0)} parsed symbol${rows.length === 1 ? "" : "s"}`
    : "No universe loaded";
  $("data-universe-note").textContent = rows.length
    ? `${numberText(fileCount, 0)} parsed files / ${numberText(rowCount, 0)} rows; root index sees ${numberText(indexFileCount || fileCount, 0)} candidate files across ${numberText(indexSymbolCount || rows.length, 0)} symbols. ${note}`
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
      status: mixedSessionSymbols.length ? "warn" : barTop.length || sessionTop.length ? "ok" : rows.length ? "warn" : "idle",
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

export function rootIndexArray(row, key) {
  const value = row && row[key];
  if (Array.isArray(value)) return value.map(text).filter((item) => item && item !== "n/a");
  const asText = text(value);
  return asText && asText !== "n/a" ? [asText] : [];
}

export function rootIndexFilterState() {
  return {
    text: (($("data-root-index-filter") || {}).value || "").trim().toLowerCase(),
    asset: (($("data-root-index-asset") || {}).value || ""),
    source: (($("data-root-index-source") || {}).value || ""),
    bar: (($("data-root-index-bar") || {}).value || ""),
    session: (($("data-root-index-session") || {}).value || ""),
    sort: (($("data-root-index-sort") || {}).value || "files_desc"),
    limit: Number((($("data-root-index-limit") || {}).value || "50")),
  };
}

export function rootIndexServerQueryParams() {
  const filters = rootIndexFilterState();
  const params = new URLSearchParams();
  params.set("limit", String(Math.max(Number(selectedDataCatalogLimit()) || 0, 5000)));
  if (filters.text) params.set("q", filters.text);
  if (filters.asset) params.set("asset_class", filters.asset);
  if (filters.source) params.set("source", filters.source);
  if (filters.bar) params.set("bar_size", filters.bar);
  if (filters.session) params.set("storage_session", filters.session);
  return params;
}

export function rootIndexDetailServerQueryParams(symbol) {
  const filters = rootIndexFilterState();
  const params = new URLSearchParams();
  params.set("symbol", String(symbol || "").trim().toUpperCase());
  params.set("limit", String(Math.max(Number(filters.limit || 0), 100)));
  if (filters.asset) params.set("asset_class", filters.asset);
  if (filters.source) params.set("source", filters.source);
  if (filters.bar) params.set("bar_size", filters.bar);
  if (filters.session) params.set("storage_session", filters.session);
  return params;
}

export function dataCatalogServerQueryParams() {
  const filters = dataCatalogFilters();
  const params = new URLSearchParams();
  params.set("limit", String(selectedDataCatalogLimit()));
  params.set("offset", String(selectedDataCatalogOffset()));
  params.set("preview_points", String(dataCatalogPreviewPoints()));
  appendDataServerFiltersToParams(params, filters);
  return params;
}

export function dataSymbolDirectoryServerQueryParams() {
  const filters = dataCatalogFilters();
  const params = new URLSearchParams();
  params.set("limit", String(selectedDataCatalogLimit()));
  appendDataServerFiltersToParams(params, filters);
  return params;
}

export function dataHistoryMatrixServerQueryParams() {
  return dataSymbolDirectoryServerQueryParams();
}

export function dataServerFilterMap(filters = dataCatalogFilters()) {
  return Object.fromEntries(Object.entries({
    query: filters.text,
    asset_class: filters.asset,
    source: filters.source,
    bar_size: filters.bar,
    storage_session: filters.session,
    quality_status: filters.quality,
    storage_contract_status: filters.contract,
    replay_status: filters.replay,
  }).filter(([, value]) => text(value) !== "n/a"));
}

export function appendDataServerFiltersToParams(params, filters = dataCatalogFilters()) {
  const map = dataServerFilterMap(filters);
  if (map.query) params.set("q", map.query);
  if (map.asset_class) params.set("asset_class", map.asset_class);
  if (map.source) params.set("source", map.source);
  if (map.bar_size) params.set("bar_size", map.bar_size);
  if (map.storage_session) params.set("storage_session", map.storage_session);
  if (map.quality_status) params.set("quality_status", map.quality_status);
  if (map.storage_contract_status) params.set("storage_contract_status", map.storage_contract_status);
  if (map.replay_status) params.set("replay_status", map.replay_status);
}

export function normalizedDataServerFilterMap(map = {}) {
  const normalized = {};
  for (const key of ["query", "asset_class", "source", "bar_size", "storage_session", "quality_status", "storage_contract_status", "replay_status"]) {
    const value = text(map[key]).toLowerCase();
    if (value && value !== "n/a") normalized[key] = value;
  }
  return normalized;
}

export function dataServerFilterMapsEqual(left = {}, right = {}) {
  const a = normalizedDataServerFilterMap(left);
  const b = normalizedDataServerFilterMap(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] || "") !== (b[key] || "")) return false;
  }
  return true;
}

export function dataHistoryMatrixUsesBackendRows(payload = state.dataHistoryMatrix || {}) {
  const rows = payload.rows || payload.groups || [];
  if (!rows.length || !dataHistoryMatrixBackendScopeApplied(payload)) return false;
  return true;
}

export function dataHistoryMatrixBackendScopeApplied(payload = state.dataHistoryMatrix || {}) {
  if (!payload || payload.source === "catalog_fallback") return false;
  if (!Array.isArray(payload.rows || payload.groups)) return false;
  return dataServerFilterMapsEqual(payload.filters || {}, dataServerFilterMap());
}

export function dataServerFilterLabelsFromMap(map = {}) {
  const normalized = normalizedDataServerFilterMap(map);
  return [
    normalized.query ? `search ${normalized.query}` : "",
    normalized.asset_class ? `asset ${normalized.asset_class}` : "",
    normalized.source ? `source ${normalized.source}` : "",
    normalized.bar_size ? `bar ${normalized.bar_size}` : "",
    normalized.storage_session ? `session ${normalized.storage_session}` : "",
    normalized.quality_status ? `quality ${normalized.quality_status}` : "",
    normalized.storage_contract_status ? `contract ${normalized.storage_contract_status}` : "",
    normalized.replay_status ? `replay ${normalized.replay_status}` : "",
  ].filter(Boolean);
}

export function dataCatalogServerFilterLabels() {
  return dataServerFilterLabelsFromMap(dataServerFilterMap());
}

export function dataCatalogServerScopeModel(catalog = state.dataCatalog || {}) {
  const loadState = dataLibraryLoadState();
  const currentMap = dataServerFilterMap();
  const loadedMap = catalog.filters || {};
  const currentLabels = dataServerFilterLabelsFromMap(currentMap);
  const loadedLabels = dataServerFilterLabelsFromMap(loadedMap);
  const loaded = Boolean(loadState.catalogLoaded || (catalog.datasets || []).length || catalog.count);
  if (!loaded) {
    return {
      status: "waiting",
      title: "No backend scan loaded",
      note: currentLabels.length
        ? `Current controls are set to ${currentLabels.join(" / ")}; run Search Scan to load that scope.`
        : "Refresh or run Search Scan to load the backend catalog scope.",
      currentLabels,
      loadedLabels,
      applied: false,
    };
  }
  const applied = dataServerFilterMapsEqual(loadedMap, currentMap);
  if (applied) {
    return {
      status: currentLabels.length ? "ok" : "neutral",
      title: currentLabels.length ? "Backend-applied filters" : "Unfiltered backend scan",
      note: currentLabels.length
        ? `Backend scan matches ${currentLabels.join(" / ")}.`
        : "No server-side filters are active on the loaded catalog scan.",
      currentLabels,
      loadedLabels,
      applied: true,
    };
  }
  return {
    status: "warn",
    title: "Local preview only",
    note: `Current controls are ${currentLabels.length ? currentLabels.join(" / ") : "unfiltered"}, but the loaded backend scan is ${loadedLabels.length ? loadedLabels.join(" / ") : "unfiltered"}. Run Search Scan to apply these filters server-side.`,
    currentLabels,
    loadedLabels,
    applied: false,
  };
}

export async function refreshRootIndexFromServerFilters() {
  const params = rootIndexServerQueryParams();
  const activeFilterCount = Array.from(params.keys()).filter((key) => key !== "limit").length;
  $("data-root-index-note").textContent = activeFilterCount
    ? "Searching configured roots with server-side filters..."
    : "Refreshing the default Root Index from configured roots...";
  const payload = await fetchJson(`/data_symbol_index?${params.toString()}`);
  state.dataSymbolIndex = payload || { symbols: [], files: [], errors: [] };
  renderRootIndexBrowser();
  renderDataCatalog();
  renderDataCoverage();
  renderPageIntro();
  $("last-refresh").textContent = activeFilterCount
    ? `Root Index server search loaded: ${numberText((state.dataSymbolIndex.symbols || []).length, 0)} symbol${(state.dataSymbolIndex.symbols || []).length === 1 ? "" : "s"}`
    : "Root Index refreshed from configured roots";
}

export async function loadRootIndexDetail(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) throw new Error("Select a root-index symbol first");
  const params = rootIndexDetailServerQueryParams(normalized);
  $("data-root-index-detail-note").textContent = `Loading candidate files for ${normalized}...`;
  const payload = await fetchJson(`/data_symbol_index_detail?${params.toString()}`);
  state.dataSymbolIndexDetail = payload || { symbol: normalized, files: [], errors: [] };
  renderRootIndexDetail();
  navigateToDataLens("browse");
  $("last-refresh").textContent = `Root Index candidate files loaded for ${normalized}`;
}

export function syncRootIndexOptions(symbols = []) {
  const makeSelect = (id, values) => {
    const select = $(id);
    if (!select) return;
    const current = select.value;
    const options = Array.from(new Set(values.map(text).filter((item) => item && item !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) select.value = current;
  };
  makeSelect("data-root-index-asset", symbols.map((item) => item.asset_class));
  makeSelect("data-root-index-source", symbols.flatMap((item) => rootIndexArray(item, "sources")));
  makeSelect("data-root-index-bar", symbols.flatMap((item) => rootIndexArray(item, "bar_sizes")));
  makeSelect("data-root-index-session", symbols.flatMap((item) => rootIndexArray(item, "storage_sessions")));
}

export function rootIndexSortValue(row, key) {
  if (key === "files") return Number(row.file_count || 0);
  if (key === "modified") return timestampMillis(row.latest_modified_at) || 0;
  if (key === "size") return Number(row.size_bytes_total || 0);
  return text(row.symbol).toLowerCase();
}

export function rootIndexRows() {
  const symbols = ((state.dataSymbolIndex || {}).symbols || []).slice();
  syncRootIndexOptions(symbols);
  const filters = rootIndexFilterState();
  const rows = symbols.filter((item) => {
    if (filters.asset && text(item.asset_class) !== filters.asset) return false;
    if (filters.source && !rootIndexArray(item, "sources").includes(filters.source)) return false;
    if (filters.bar && !rootIndexArray(item, "bar_sizes").includes(filters.bar)) return false;
    if (filters.session && !rootIndexArray(item, "storage_sessions").includes(filters.session)) return false;
    if (filters.text) {
      const haystack = [
        item.symbol,
        item.display_symbol,
        item.asset_class,
        ...rootIndexArray(item, "sources"),
        ...rootIndexArray(item, "bar_sizes"),
        ...rootIndexArray(item, "storage_sessions"),
        ...rootIndexArray(item, "adjustment_statuses"),
        ...rootIndexArray(item, "roots"),
        ...rootIndexArray(item, "sample_paths"),
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });
  const [key, direction] = String(filters.sort || "files_desc").split("_");
  const multiplier = direction === "asc" ? 1 : -1;
  rows.sort((left, right) => {
    const leftValue = rootIndexSortValue(left, key);
    const rightValue = rootIndexSortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier;
    }
    const primary = String(leftValue).localeCompare(String(rightValue)) * multiplier;
    if (primary) return primary;
    return text(left.symbol).localeCompare(text(right.symbol));
  });
  return { rows, filters, shown: rows.slice(0, Math.max(1, filters.limit || 50)) };
}

export function rootIndexRootStatus(root) {
  const overlap = root.covered_by_root
    ? ` Covered by earlier root ${text(root.covered_by_root)}.`
    : root.duplicate_of_root ? ` Duplicate of earlier root ${text(root.duplicate_of_root)}.` : "";
  const deferred = Number(root.deferred_to_child_root_count || 0)
    ? ` Deferred ${numberText(root.deferred_to_child_root_count, 0)} file${Number(root.deferred_to_child_root_count || 0) === 1 ? "" : "s"} to configured child roots.`
    : "";
  if (!root.exists || !root.is_dir) return { status: "bad", title: "Unavailable", note: "Root is missing or not a directory." };
  if (root.scan_capped) return { status: "warn", title: "Capped", note: `${text(root.not_scanned_reason || "Global root-index limit reached.")}.${overlap}${deferred}` };
  if (root.not_scanned_reason) return { status: "warn", title: "Not Scanned", note: `${text(root.not_scanned_reason)}.${overlap}${deferred}` };
  if (Number(root.parse_error_count || 0)) return { status: "bad", title: "Errors", note: `${numberText(root.parse_error_count, 0)} scan error${Number(root.parse_error_count || 0) === 1 ? "" : "s"}.` };
  if (Number(root.candidate_count || 0)) return { status: "ok", title: "Indexed", note: `${numberText(root.candidate_count, 0)} supported candidate file${Number(root.candidate_count || 0) === 1 ? "" : "s"}.${overlap}${deferred}` };
  if (Number(root.unsupported_file_count || 0)) return { status: "warn", title: "Unsupported Only", note: `${numberText(root.unsupported_file_count, 0)} unsupported file${Number(root.unsupported_file_count || 0) === 1 ? "" : "s"} found.` };
  return { status: "warn", title: "No Candidates", note: `No supported CSV/parquet files found.${overlap}${deferred}` };
}

export function rootIndexScanStats(index = state.dataSymbolIndex || {}) {
  const roots = index.root_summaries || [];
  const totalRootScanMs = roots.reduce((sum, root) => sum + Number(root.scan_duration_ms || 0), 0);
  const slowestRoot = roots.slice().sort((left, right) => Number(right.scan_duration_ms || 0) - Number(left.scan_duration_ms || 0))[0] || null;
  const loadState = dataLibraryLoadState();
  const indexCache = index.scan_cache || {};
  const catalogCache = (state.dataCatalog || {}).scan_cache || {};
  return {
    rootCount: roots.length,
    totalRootScanMs,
    slowestRoot,
    clientCatalogFetchMs: loadState.lastCatalogFetchMs,
    clientSymbolIndexFetchMs: loadState.lastSymbolIndexFetchMs,
    clientTotalFetchMs: loadState.lastDataLibraryFetchMs,
    symbolIndexLimit: loadState.lastSymbolIndexLimit || Number(index.limit || 0),
    indexCacheStatus: text(indexCache.status || "n/a"),
    indexCacheAgeSeconds: Number(indexCache.age_seconds || 0),
    indexCacheTtlSeconds: Number(indexCache.ttl_seconds || 0),
    catalogCacheStatus: text(catalogCache.status || "n/a"),
  };
}

export function renderRootIndexDetail() {
  if (!$("data-root-index-detail-note") || !$("data-root-index-detail-summary") || !$("data-root-index-detail-body")) return;
  const detail = state.dataSymbolIndexDetail || {};
  const files = detail.files || [];
  const symbol = text(detail.symbol || "");
  if ($("export-data-root-index-detail-csv")) $("export-data-root-index-detail-csv").disabled = !symbol || symbol === "n/a" || !files.length;
  if (!symbol || symbol === "n/a") {
    $("data-root-index-detail-note").textContent = "Select Show Files for a root-index symbol.";
    $("data-root-index-detail-summary").innerHTML = "";
    $("data-root-index-detail-body").innerHTML = row([`<span class="muted">No root-index symbol selected.</span>`, "", "", "", "", "", "", "", ""]);
    return;
  }
  const capped = detail.index_complete === false || Number(detail.scan_capped_root_count || 0) > 0;
  $("data-root-index-detail-note").textContent = `${symbol}: ${numberText(files.length, 0)} candidate file${files.length === 1 ? "" : "s"}${capped ? " from a capped scan" : ""}.`;
  const cards = [
    {
      label: "Candidate Files",
      status: files.length ? (capped ? "warn" : "ok") : "bad",
      title: numberText(files.length, 0),
      note: `${numberText(detail.candidate_count || 0, 0)} root-index candidate${Number(detail.candidate_count || 0) === 1 ? "" : "s"} scanned for ${symbol}.`,
    },
    {
      label: "Source / Bar",
      status: files.length ? "ok" : "bad",
      title: `${countSummary(detail.source_counts || {}) || "n/a"} / ${countSummary(detail.bar_size_counts || {}) || "n/a"}`,
      note: `${countSummary(detail.storage_session_counts || {}) || "unknown session"}; ${countSummary(detail.asset_class_counts || {}) || "unknown asset"}.`,
    },
    {
      label: "Latest Modified",
      status: detail.latest_modified_at ? "ok" : files.length ? "warn" : "bad",
      title: detail.latest_modified_at ? shortTimestampAgeLabel(detail.latest_modified_at) : "n/a",
      note: detail.latest_modified_at ? text(detail.latest_modified_at) : "No modified timestamp in candidate rows.",
    },
    {
      label: "Scan Scope",
      status: capped ? "warn" : Number(detail.not_scanned_root_count || 0) ? "warn" : "ok",
      title: capped ? "Capped" : "Bounded",
      note: `${numberText(detail.limit || 0, 0)} detail limit; ${numberText(detail.error_count || 0, 0)} candidate summarization error${Number(detail.error_count || 0) === 1 ? "" : "s"}.`,
    },
  ];
  $("data-root-index-detail-summary").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-root-index-detail-body").innerHTML = files.length
    ? files.slice(0, 100).map((item) => {
        const path = text(item.path || "");
        const catalogDataset = dataCatalogDatasetByPath(path);
        const catalogStatus = catalogDataset ? "ok" : "warn";
        const catalogLabel = catalogDataset ? "parsed" : "candidate only";
        const catalogNote = catalogDataset
          ? `${text(catalogDataset.quality_status)} quality / ${text(catalogDataset.storage_contract_status)} contract`
          : "Run Search Scan or Inspect to parse chart/readiness metadata.";
        return row([
          `<span class="mono">${escapeHtml(path)}</span>`,
          escapeHtml(text(item.source)),
          escapeHtml(text(item.bar_size)),
          escapeHtml(text(item.storage_session)),
          escapeHtml(text(item.format)),
          escapeHtml(bytes(item.size_bytes)),
          escapeHtml(item.modified_at ? shortTimestampAgeLabel(item.modified_at) : "n/a"),
          `<span class="${escapeHtml(statusClass(catalogStatus))}">${escapeHtml(catalogLabel)}</span><br><span class="muted">${escapeHtml(catalogNote)}</span>`,
          `<span class="button-pair"><button type="button" class="secondary root-index-detail-inspect" data-path="${escapeHtml(path)}">Inspect</button><button type="button" class="secondary root-index-detail-workbench" data-path="${escapeHtml(path)}">Workbench</button><button type="button" class="secondary root-index-detail-search" data-path="${escapeHtml(path)}" data-symbol="${escapeHtml(text(item.symbol || symbol))}" data-source="${escapeHtml(text(item.source))}" data-bar="${escapeHtml(text(item.bar_size))}" data-session="${escapeHtml(text(item.storage_session))}">Search Scan</button><button type="button" class="secondary root-index-detail-copy" data-path="${escapeHtml(path)}">Copy Path</button></span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No candidate files found for ${escapeHtml(symbol)} under the current Root Index filters.</span>`, "", "", "", "", "", "", "", ""]);
}

export function renderRootIndexBrowser() {
  if (!$("data-root-index-note") || !$("data-root-index-summary") || !$("data-root-index-body")) return;
  const index = state.dataSymbolIndex || {};
  const symbols = index.symbols || [];
  const { rows, filters, shown } = rootIndexRows();
  const datasets = (state.dataCatalog || {}).datasets || [];
  const parsedSymbols = new Set(datasets.map((dataset) => text(dataset.symbol).toUpperCase()).filter((value) => value && value !== "N/A"));
  const parsedMatches = rows.filter((item) => parsedSymbols.has(text(item.symbol).toUpperCase()));
  const indexError = text(index.index_error || ((index.errors || [])[0] || {}).error || "");
  const capped = index.index_complete === false || Number(index.scan_capped_root_count || 0) > 0;
  const scanStats = rootIndexScanStats(index);
  const serverFilters = index.filters || {};
  const serverFilterActive = Boolean(index.filter_active);
  const serverFilterLabels = Object.entries(serverFilters)
    .filter(([_key, value]) => text(value) !== "n/a")
    .map(([key, value]) => `${key}=${text(value)}`);
  const activeFilters = [
    filters.text ? `search "${filters.text}"` : "",
    filters.asset ? `asset ${filters.asset}` : "",
    filters.source ? `source ${filters.source}` : "",
    filters.bar ? `bar ${filters.bar}` : "",
    filters.session ? `session ${filters.session}` : "",
  ].filter(Boolean);
  $("data-root-index-note").textContent = indexError !== "n/a"
    ? `Root index failed: ${indexError}`
    : symbols.length
      ? `${numberText(rows.length, 0)} matched / ${numberText(symbols.length, 0)} candidate symbols inferred from filenames and paths${capped ? "; scan capped" : ""}${serverFilterActive ? "; server-filtered" : ""}.`
      : "No root-index symbols loaded; configure data roots or refresh Data Library.";
  const cards = [
    {
      label: "Candidate Symbols",
      status: indexError !== "n/a" ? "bad" : symbols.length ? (capped ? "warn" : "ok") : "bad",
      title: numberText(symbols.length, 0),
      note: `${numberText(index.file_count || 0, 0)} candidate files; ${capped ? "bounded by scan limits" : "full configured-root index"}.`,
    },
    {
      label: "Matched Now",
      status: rows.length ? "ok" : symbols.length ? "warn" : "bad",
      title: numberText(rows.length, 0),
      note: serverFilterActive
        ? `Server: ${serverFilterLabels.join(" / ") || "active"}; skipped ${numberText(index.filter_skipped_count_total || 0, 0)} nonmatching supported files.`
        : activeFilters.length ? activeFilters.join(" / ") : "No Root Index filters active.",
    },
    {
      label: "Also Parsed",
      status: parsedMatches.length ? "ok" : rows.length ? "warn" : "bad",
      title: numberText(parsedMatches.length, 0),
      note: parsedMatches.length
        ? "These candidate symbols also appear in the quality catalog."
        : rows.length ? "Candidates may be outside the parsed limit or skipped by parser/root settings." : "No matched candidates.",
    },
    {
      label: "Latest Modified",
      status: index.latest_modified_at ? "ok" : symbols.length ? "warn" : "bad",
      title: index.latest_modified_at ? shortTimestampAgeLabel(index.latest_modified_at) : "n/a",
      note: index.latest_modified_at ? text(index.latest_modified_at) : "No modification timestamp found.",
    },
    {
      label: "Scan Time",
      status: scanStats.clientSymbolIndexFetchMs > 15000 || scanStats.totalRootScanMs > 15000 ? "warn" : symbols.length ? "ok" : "bad",
      title: scanStats.clientSymbolIndexFetchMs ? durationMsText(scanStats.clientSymbolIndexFetchMs) : durationMsText(scanStats.totalRootScanMs),
      note: `${numberText(scanStats.rootCount, 0)} roots; server cache ${scanStats.indexCacheStatus}${scanStats.indexCacheStatus === "hit" ? ` age ${numberText(scanStats.indexCacheAgeSeconds, 1)}s` : ""}; server root scan ${durationMsText(scanStats.totalRootScanMs)}; slowest ${text((scanStats.slowestRoot || {}).display_path || (scanStats.slowestRoot || {}).path || "n/a")} ${durationMsText((scanStats.slowestRoot || {}).scan_duration_ms)}.`,
    },
  ];
  $("data-root-index-summary").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  if ($("data-root-index-roots")) {
    const roots = index.root_summaries || [];
    $("data-root-index-roots").innerHTML = roots.length
      ? roots.slice(0, 8).map((root) => {
          const model = rootIndexRootStatus(root);
          return `
            <div class="action-card status-${escapeHtml(model.status)}">
              <span>${escapeHtml(model.title)}</span>
              <strong>${escapeHtml(text(root.display_path || root.path))}</strong>
              <small>${escapeHtml(model.note)}${Number(root.filter_skipped_count || 0) ? ` Skipped ${escapeHtml(numberText(root.filter_skipped_count, 0))} by server filter.` : ""} Unsupported ${escapeHtml(numberText(root.unsupported_file_count || 0, 0))}; scan ${escapeHtml(numberText(root.scan_duration_ms || 0, 1))}ms.</small>
            </div>
          `;
        }).join("")
      : `<div class="empty-card"><strong>No root-index root scan</strong><span>Refresh Data Library after configuring data roots.</span></div>`;
  }
  $("data-root-index-body").innerHTML = shown.length
    ? shown.map((item) => {
        const symbol = text(item.symbol);
        const samplePaths = rootIndexArray(item, "sample_paths");
        const parsed = parsedSymbols.has(symbol.toUpperCase());
        return row([
          `<strong>${escapeHtml(symbol)}</strong><br><span class="muted">${escapeHtml(text(item.display_symbol))}${parsed ? " / parsed" : " / candidate only"}</span>`,
          `${escapeHtml(numberText(item.file_count, 0))}<br><span class="muted">${escapeHtml(bytes(item.size_bytes_total))}</span>`,
          escapeHtml(text(item.asset_class)),
          escapeHtml(rootIndexArray(item, "sources").join(", ") || "unknown"),
          escapeHtml(rootIndexArray(item, "bar_sizes").join(", ") || "unknown"),
          escapeHtml(rootIndexArray(item, "storage_sessions").join(", ") || "unknown"),
          escapeHtml(item.latest_modified_at ? shortTimestampAgeLabel(item.latest_modified_at) : "n/a"),
          samplePaths.length
            ? jsonDrilldown(samplePaths, samplePaths.slice(0, 2).join(" | "))
            : `<span class="muted">none</span>`,
          `<span class="button-pair"><button type="button" class="secondary root-index-show-files" data-symbol="${escapeHtml(symbol)}">Show Files</button><button type="button" class="secondary root-index-inspect-sample" data-symbol="${escapeHtml(symbol)}" data-path="${escapeHtml(samplePaths[0] || "")}"${samplePaths.length ? "" : " disabled"}>Inspect Sample</button><button type="button" class="secondary root-index-search-catalog" data-symbol="${escapeHtml(symbol)}">Search Scan</button><button type="button" class="secondary root-index-diagnose" data-symbol="${escapeHtml(symbol)}">Diagnose</button><button type="button" class="secondary root-index-copy-paths" data-symbol="${escapeHtml(symbol)}">Copy Paths</button></span>`,
        ]);
      }).join("")
    : row([symbols.length ? `<span class="muted">No root-index symbols match the current filters.</span>` : `<span class="muted">No root-index symbols loaded.</span>`, "", "", "", "", "", "", "", ""]);
  renderRootIndexDetail();
}

export async function handleRootIndexBrowserAction(target) {
  const symbol = String(target.dataset.symbol || "").trim().toUpperCase();
  if (!symbol) return;
  if (target.classList.contains("root-index-show-files")) {
    await loadRootIndexDetail(symbol);
    return;
  }
  if (target.classList.contains("root-index-inspect-sample")) {
    const path = target.dataset.path || "";
    if (!path) {
      $("data-root-index-note").innerHTML = `<span class="status-bad">No sample path available for ${escapeHtml(symbol)}</span>`;
      return;
    }
    await loadDataDetail(path, { resetControls: true });
    $("last-refresh").textContent = `Loaded root-index sample for ${symbol}`;
    return;
  }
  if (target.classList.contains("root-index-search-catalog")) {
    $("data-filter-text").value = symbol;
    $("data-symbol-browser-input").value = symbol;
    state.manifestPathFilter = null;
    navigateToDataLens("browse");
    await runDataCatalogServerSearch(`Catalog scan searched for ${symbol}`);
    return;
  }
  if (target.classList.contains("root-index-diagnose")) {
    $("data-symbol-input").value = symbol;
    await diagnoseDataSymbol(new Event("submit"));
    return;
  }
  if (target.classList.contains("root-index-copy-paths")) {
    const item = ((state.dataSymbolIndex || {}).symbols || []).find((rowItem) => text(rowItem.symbol).toUpperCase() === symbol);
    const paths = rootIndexArray(item || {}, "sample_paths");
    await copyText(paths.join("\n"));
    $("last-refresh").textContent = paths.length
      ? `Copied ${numberText(paths.length, 0)} sample root-index path${paths.length === 1 ? "" : "s"} for ${symbol}`
      : `No sample paths available for ${symbol}`;
  }
}

export async function handleRootIndexDetailAction(target) {
  const path = target.dataset.path || "";
  if (!path) return;
  if (target.classList.contains("root-index-detail-inspect")) {
    await loadDataDetail(path, { resetControls: true });
    $("last-refresh").textContent = "Loaded root-index candidate data detail";
    return;
  }
  if (target.classList.contains("root-index-detail-workbench")) {
    const detail = state.dataSymbolIndexDetail || {};
    const item = (detail.files || []).find((rowItem) => text(rowItem.path) === path) || { path };
    selectCatalogDatasetInWorkbench({
      ...item,
      path,
      symbol: item.symbol || detail.symbol,
      canonical_symbol: item.canonical_symbol || item.symbol || detail.symbol,
      quality_status: item.quality_status || "warn",
      quality_warning_count: item.quality_warning_count ?? 1,
      storage_contract_status: item.storage_contract_status || "warn",
      storage_contract_warning_count: item.storage_contract_warning_count ?? 1,
      replay_status: item.replay_status || "warn",
    });
    $("last-refresh").textContent = `Selected ${text(item.symbol || detail.symbol || path)} root-index candidate for Workbench`;
    return;
  }
  if (target.classList.contains("root-index-detail-search")) {
    $("data-filter-text").value = target.dataset.symbol || "";
    $("data-filter-source").value = target.dataset.source || "";
    $("data-filter-bar").value = target.dataset.bar || "";
    $("data-filter-session").value = target.dataset.session || "";
    state.manifestPathFilter = null;
    navigateToDataLens("browse");
    await runDataCatalogServerSearch(`Catalog scan searched candidate ${text(target.dataset.symbol || path)}`);
    return;
  }
  if (target.classList.contains("root-index-detail-copy")) {
    await copyText(path);
    $("last-refresh").textContent = "Root Index candidate path copied";
  }
}

export function timestampRangeFromDatasets(datasets) {
  const starts = (datasets || []).map((dataset) => timestampMillis(dataset.first_timestamp)).filter((value) => value !== null);
  const ends = (datasets || []).map((dataset) => timestampMillis(dataset.last_timestamp)).filter((value) => value !== null);
  if (!starts.length || !ends.length) return { start: null, end: null };
  return {
    start: new Date(Math.min(...starts)).toISOString().slice(0, 10),
    end: new Date(Math.max(...ends)).toISOString().slice(0, 10),
  };
}

export function shellQuote(value) {
  const raw = text(value);
  return `'${raw.replace(/'/g, "'\\''")}'`;
}

export function approvalPreviewCommand(preview, artifacts) {
  const previewFile = text((artifacts || {}).order_preview_file);
  const approvalId = text((preview || {}).approval_id);
  if (!previewFile || !approvalId) return "";
  return `python3 scripts/approve_order_preview.py ${shellQuote(previewFile)} --approval-id ${shellQuote(approvalId)}`;
}

export function approvalPreviewCanApprove(preview, artifacts) {
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

export function csvCell(value) {
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

export function fetchVisibleOutputPaths(detail = state.fetchManifestDetail || {}) {
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

export function dataRootConfigPaths() {
  const diagnostics = state.diagnostics || {};
  const paths = new Set();
  for (const root of [...(diagnostics.data_roots || []), ...(diagnostics.suggested_data_roots || [])]) {
    const value = text(root.display_path || root.path);
    if (value && value !== "n/a") paths.add(value);
  }
  return Array.from(paths).sort();
}

export function dataRootsYamlSnippet() {
  const paths = dataRootConfigPaths();
  if (!paths.length) return "";
  return [
    "dashboard:",
    "  data_roots:",
    ...paths.map((path) => `    - ${yamlScalar(path)}`),
  ].join("\n");
}

export function fetchManifestRootConfigPaths() {
  const payload = state.fetchManifests || {};
  const paths = new Set();
  for (const root of (payload.roots || [])) {
    const value = text(root.display_path || root.path);
    if (value && value !== "n/a") paths.add(value);
  }
  return Array.from(paths).sort();
}

export function fetchManifestRootsYamlSnippet() {
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
