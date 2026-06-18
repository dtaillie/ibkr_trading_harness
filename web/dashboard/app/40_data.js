function dataCatalogFilters() {
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

function dataReplayReadinessModel(dataset) {
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
  if (key === "replay") {
    const rank = { ok: 0, warn: 1, bad: 2 };
    return rank[dataReplayReadinessModel(dataset).status] ?? 3;
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

function symbolRootIndexEntry(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  if (!normalized) return null;
  return ((state.dataSymbolIndex || {}).symbols || [])
    .find((item) => text(item.symbol).toUpperCase() === normalized) || null;
}

function rootIndexSamplePathsForSymbol(symbol) {
  return rootIndexArray(symbolRootIndexEntry(symbol) || {}, "sample_paths");
}

function symbolVisibilityDiagnostic(symbol) {
  const normalized = String(symbol || "").trim().toUpperCase();
  const diagnostic = state.symbolDiagnostic || {};
  return normalized && text(diagnostic.symbol).toUpperCase() === normalized ? diagnostic : null;
}

function symbolVisibilityModel(symbol = selectedSymbolBrowserSymbol()) {
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

function renderSymbolVisibilityExplainer() {
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

async function handleSymbolVisibilityAction(action) {
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

function renderSymbolCoverageLedger(directory) {
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

function renderSymbolDirectory() {
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

function rootIndexArray(row, key) {
  const value = row && row[key];
  if (Array.isArray(value)) return value.map(text).filter((item) => item && item !== "n/a");
  const asText = text(value);
  return asText && asText !== "n/a" ? [asText] : [];
}

function rootIndexFilterState() {
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

function rootIndexServerQueryParams() {
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

function rootIndexDetailServerQueryParams(symbol) {
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

function dataCatalogServerQueryParams() {
  const filters = dataCatalogFilters();
  const params = new URLSearchParams();
  params.set("limit", String(selectedDataCatalogLimit()));
  params.set("offset", String(selectedDataCatalogOffset()));
  params.set("preview_points", String(dataCatalogPreviewPoints()));
  appendDataServerFiltersToParams(params, filters);
  return params;
}

function dataSymbolDirectoryServerQueryParams() {
  const filters = dataCatalogFilters();
  const params = new URLSearchParams();
  params.set("limit", String(selectedDataCatalogLimit()));
  appendDataServerFiltersToParams(params, filters);
  return params;
}

function dataHistoryMatrixServerQueryParams() {
  return dataSymbolDirectoryServerQueryParams();
}

function dataServerFilterMap(filters = dataCatalogFilters()) {
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

function appendDataServerFiltersToParams(params, filters = dataCatalogFilters()) {
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

function normalizedDataServerFilterMap(map = {}) {
  const normalized = {};
  for (const key of ["query", "asset_class", "source", "bar_size", "storage_session", "quality_status", "storage_contract_status", "replay_status"]) {
    const value = text(map[key]).toLowerCase();
    if (value && value !== "n/a") normalized[key] = value;
  }
  return normalized;
}

function dataServerFilterMapsEqual(left = {}, right = {}) {
  const a = normalizedDataServerFilterMap(left);
  const b = normalizedDataServerFilterMap(right);
  const keys = new Set([...Object.keys(a), ...Object.keys(b)]);
  for (const key of keys) {
    if ((a[key] || "") !== (b[key] || "")) return false;
  }
  return true;
}

function dataHistoryMatrixUsesBackendRows(payload = state.dataHistoryMatrix || {}) {
  const rows = payload.rows || payload.groups || [];
  if (!rows.length || !dataHistoryMatrixBackendScopeApplied(payload)) return false;
  return true;
}

function dataHistoryMatrixBackendScopeApplied(payload = state.dataHistoryMatrix || {}) {
  if (!payload || payload.source === "catalog_fallback") return false;
  if (!Array.isArray(payload.rows || payload.groups)) return false;
  return dataServerFilterMapsEqual(payload.filters || {}, dataServerFilterMap());
}

function dataServerFilterLabelsFromMap(map = {}) {
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

function dataCatalogServerFilterLabels() {
  return dataServerFilterLabelsFromMap(dataServerFilterMap());
}

function dataCatalogServerScopeModel(catalog = state.dataCatalog || {}) {
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

async function refreshRootIndexFromServerFilters() {
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

async function loadRootIndexDetail(symbol) {
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

function syncRootIndexOptions(symbols = []) {
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

function rootIndexSortValue(row, key) {
  if (key === "files") return Number(row.file_count || 0);
  if (key === "modified") return timestampMillis(row.latest_modified_at) || 0;
  if (key === "size") return Number(row.size_bytes_total || 0);
  return text(row.symbol).toLowerCase();
}

function rootIndexRows() {
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

function rootIndexRootStatus(root) {
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

function rootIndexScanStats(index = state.dataSymbolIndex || {}) {
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

function renderRootIndexDetail() {
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

function renderRootIndexBrowser() {
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

async function handleRootIndexBrowserAction(target) {
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

async function handleRootIndexDetailAction(target) {
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

function dataReplayReadiness(dataset) {
  const model = dataReplayReadinessModel(dataset);
  return `
    <div class="data-readiness-cell ${escapeHtml(statusClass(model.status))}">
      <strong>${escapeHtml(model.title)}</strong>
      <span>${escapeHtml(model.detail)}</span>
      <small>${escapeHtml(`tz ${text(dataset.source_timezone)} / adjust ${text(dataset.adjustment_status)}`)}</small>
    </div>
  `;
}

function renderDataCatalog() {
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
  if (filters.replay) labels.push(`replay ${filters.replay}`);
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

function dataExplorerDimensions() {
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

function dataExplorerGroupRows(datasets, dimension) {
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

function renderDataExplorer(datasets = [], filteredRows = []) {
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

function setDataCatalogFacetFilter(filter, value) {
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

function handleDataExplorerAction(target) {
  const action = String(target.dataset.dataExplorerAction || "");
  if (action === "filter") {
    setDataCatalogFacetFilter(target.dataset.explorerFilter || "", target.dataset.explorerValue || "");
  }
}

function clearDataCatalogFilters() {
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

function handleDataServerFilterControlChange() {
  setDataCatalogOffset(0);
  renderDataCatalog();
}

function previewDataCatalogServerFilters(message) {
  setDataCatalogOffset(0);
  renderDataCatalog();
  $("last-refresh").textContent = `${message}; local preview only. Use Search Scan to apply this scope to backend catalog, Symbol Directory, and History Matrix.`;
}

async function runDataCatalogServerSearch(statusPrefix = "Catalog scan filtered") {
  setDataCatalogOffset(0);
  await refreshDataLibrary({ includeDiagnostics: shouldLoadDataDiagnostics(), force: true });
  const serverFilters = dataCatalogServerFilterLabels();
  $("last-refresh").textContent = serverFilters.length
    ? `${statusPrefix}: ${serverFilters.join(" / ")}`
    : "Catalog scan refreshed without server filters";
}

function catalogScopeIsCapped(catalog = {}) {
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

function fetchManifestVisibilityTotals(manifests = []) {
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

function dataVisibilityReportModel(filteredRows = []) {
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

function dataVisibilityReportText(model) {
  return [
    `Data Visibility Report: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

function dataActionSummaryModel(filteredRows = []) {
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

function renderDataActionSummary(filteredRows = []) {
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

function rootIndexSpotlightModel(filteredRows = []) {
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

function renderRootIndexSpotlight(filteredRows = []) {
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

function handleRootIndexSpotlightAction(target) {
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

function renderDataVisibilityReport(filteredRows = []) {
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

function handleDataVisibilityReportAction(action) {
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

function dataInventoryEvidenceModel(filteredRows = []) {
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

function dataInventoryEvidenceText(model) {
  return [
    `Historical Inventory Evidence: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

function renderDataInventoryEvidence(filteredRows = []) {
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

function handleDataInventoryEvidenceAction(action) {
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

function renderDataInventoryPanel(filteredRows = []) {
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

function renderDataHistoryReview(filteredRows = []) {
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

function dataHistoryMatrixRows(rows = []) {
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

function renderDataHistoryMatrix(filteredRows = []) {
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

function renderDataHistoryMatrixSummary(matrix = [], rows = [], activeFilters = [], options = {}) {
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

function dataHistoryMatrixGroupDatasets(target) {
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

function applyDataHistoryMatrixFilter(target) {
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

async function handleDataHistoryMatrixAction(target) {
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

function renderDataPreviewWall(filteredRows = []) {
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

function renderDataPreviewSummary(rows = [], total = 0, filteredRows = []) {
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
      status: hasRows ? "ok" : hasQuery ? "warn" : "idle",
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
      status: model.range.start && model.range.end ? "ok" : hasRows ? "warn" : "idle",
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
  dataset = rememberWorkbenchDataset(dataset);
  const datasetSelect = $("config-dataset");
  if (!datasetSelect) return;
  let found = false;
  for (const option of datasetSelect.options) {
    option.selected = option.value === dataset.path;
    if (option.value === dataset.path) {
      attachDatasetOptionMetadata(option, dataset);
      found = true;
    }
  }
  if (!found) {
    const option = document.createElement("option");
    option.value = dataset.path;
    option.textContent = `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`;
    option.selected = true;
    attachDatasetOptionMetadata(option, dataset);
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
    previewDataCatalogServerFilters(`Data Library filtered to ${symbol}`);
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
  if (target.classList.contains("symbol-directory-workbench")) {
    const path = target.dataset.path || (bestCatalogDatasetForSymbol(symbol) || {}).path || "";
    const dataset = (state.dataCatalog.datasets || []).find((item) => item.path === path) || bestCatalogDatasetForSymbol(symbol);
    if (!dataset || !dataset.path) {
      $("data-symbol-directory-note").innerHTML = `<span class="status-bad">No Workbench-ready file for ${escapeHtml(symbol)}</span>`;
      return;
    }
    selectCatalogDatasetInWorkbench(dataset);
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
    previewDataCatalogServerFilters(`Data Library filtered to ${symbol}`);
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
    previewDataCatalogServerFilters(symbol ? `Data Library filtered to ${symbol}` : "Data Library filter cleared");
    return;
  }
  if (action === "compare") {
    await compareSelectedSymbolDatasets();
  }
  if (action === "workbench") {
    const path = target.dataset.path || (bestCatalogDatasetForSymbol(symbol) || {}).path || "";
    const dataset = (state.dataCatalog.datasets || []).find((item) => item.path === path) || bestCatalogDatasetForSymbol(symbol);
    if (!dataset || !dataset.path) {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">No Workbench-ready file for ${escapeHtml(symbol || "selected symbol")}</span>`;
      return;
    }
    selectCatalogDatasetInWorkbench(dataset);
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
    previewDataCatalogServerFilters(symbol ? `Data Library filtered to ${symbol}` : "Data Library filter cleared");
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
    previewDataCatalogServerFilters(symbol ? `Data Library filtered to ${symbol}` : "Data Library filter cleared");
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
  renderDataBackendStatus();
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
    previewDataCatalogServerFilters(`Data Library filtered to ${rootQuery}`);
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
      status: !catalogCount ? "idle" : capped || (catalogLimit && totalCandidates > catalogCount) ? "warn" : "ok",
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
      status: detail.path ? "ok" : catalogCount ? "warn" : "idle",
      label: "Inspect History",
      detail: detail.path
        ? `Data Detail is showing ${text(detail.symbol)} from ${text(detail.path)}.`
        : catalogCount
          ? "Pick a symbol and click Inspect to chart saved historical data offline."
          : "Fetch or configure data before opening Data Detail.",
    },
    {
      status: selected.length ? "ok" : catalogCount ? "warn" : "idle",
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
  const totalDeferred = rows.reduce((sum, item) => sum + Number(item.deferred_to_child_root_count || 0), 0);
  const capped = rows.filter((item) => item.scan_capped).length;
  $("data-catalog-scan-note").textContent = rows.length
    ? `${numberText(rows.length, 0)} roots / ${numberText(totalCandidates, 0)} candidates / ${numberText(totalErrors, 0)} errors${totalDeferred ? ` / ${numberText(totalDeferred, 0)} deferred to child roots` : ""}${capped ? ` / ${numberText(capped, 0)} capped` : ""}`
    : "No catalog scan loaded";
  $("data-catalog-scan-body").innerHTML = rows.length
    ? rows.map((item) => {
        const status = !item.exists || !item.is_dir
          ? "bad"
          : item.scan_capped || item.not_scanned_reason || Number(item.parse_error_count || 0)
            ? "warn"
            : "ok";
        const reason = item.not_scanned_reason
          || item.inventory_reason
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
          escapeHtml(numberText(item.deferred_to_child_root_count, 0)),
          `${escapeHtml(numberText(item.scan_duration_ms, 3))} ms`,
          escapeHtml(reason),
          sample.path
            ? `<span class="mono">${escapeHtml(sample.path)}</span><br><span class="muted">${escapeHtml(text(sample.reason))}</span>`
            : `<span class="muted">none</span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No roots were scanned</span>`, "", "", "", "", "", "", "", "", ""]);
  renderDataCatalogScanReport();
}

function catalogScanReportModel() {
  const catalog = state.dataCatalog || {};
  const audit = state.dataStorageAudit || {};
  const auditSummary = audit.visibility_summary || {};
  const rows = catalog.root_summaries || [];
  const inventory = catalog.root_inventory || {};
  const catalogRows = Number(catalog.count ?? (catalog.datasets || []).length ?? 0);
  const totalCandidates = Number(inventory.candidate_count ?? rows.reduce((sum, item) => sum + Number(item.candidate_count || 0), 0));
  const totalParsed = Number(inventory.parsed_count ?? rows.reduce((sum, item) => sum + Number(item.parsed_count || 0), 0));
  const parserErrors = Number(inventory.parse_error_count ?? catalog.error_count ?? rows.reduce((sum, item) => sum + Number(item.parse_error_count || 0), 0));
  const unsupportedFiles = Number(inventory.unsupported_file_count ?? rows.reduce((sum, item) => sum + Number(item.unsupported_file_count || 0), 0));
  const skippedSamples = rows.reduce((sum, item) => sum + ((item.sample_skipped_files || []).length), 0);
  const missingRoots = Number(inventory.missing_root_count ?? rows.filter((item) => !item.exists || !item.is_dir).length);
  const cappedRoots = Number(inventory.capped_root_count ?? rows.filter((item) => item.scan_capped || item.not_scanned_reason === "global catalog limit reached").length);
  const notScannedRoots = Number(inventory.not_scanned_root_count ?? rows.filter((item) => item.not_scanned_reason).length);
  const totalDurationMs = rows.reduce((sum, item) => sum + Number(item.scan_duration_ms || 0), 0);
  const hiddenConfigured = Number(auditSummary.hidden_configured_file_count ?? audit.hidden_configured_file_count ?? 0);
  const suggestedFiles = Number(auditSummary.suggested_unconfigured_file_count ?? audit.suggested_file_count ?? 0);
  const topIssueRoot = rows.find((item) => (
    !item.exists
    || !item.is_dir
    || Number(item.parse_error_count || 0)
    || item.scan_capped
    || item.not_scanned_reason
    || Number(item.unsupported_file_count || 0)
  ));
  const status = !rows.length || missingRoots || parserErrors
    ? "bad"
    : cappedRoots || notScannedRoots || unsupportedFiles || hiddenConfigured || suggestedFiles
      ? "warn"
      : "ok";
  const headline = status === "bad"
    ? "Catalog scan has blockers"
    : status === "warn"
      ? "Catalog scan needs review"
      : "Catalog scan looks usable";
  const nextAction = missingRoots
    ? "Fix missing or unreadable data roots before increasing scan limits."
    : parserErrors
      ? "Review parser-error samples in Catalog Scan Diagnostics."
      : cappedRoots || notScannedRoots
        ? "Raise the catalog row limit and refresh Data Library diagnostics."
        : hiddenConfigured || suggestedFiles
          ? "Run Storage Audit and copy data_roots YAML for suggested roots."
          : unsupportedFiles
            ? "Review unsupported samples before assuming files are missing."
            : catalogRows
              ? "Browse or inspect saved symbols; scan evidence is clean enough."
              : "Configure saved-data roots or run a fetch job.";
  const cards = [
    {
      status,
      label: "Current Read",
      title: headline,
      note: nextAction,
    },
    {
      status: inventory.status || status,
      label: "Inventory",
      title: text(inventory.status || status),
      note: text(inventory.primary_issue || "Root inventory summary unavailable."),
    },
    {
      status: rows.length ? missingRoots ? "bad" : "ok" : "bad",
      label: "Roots",
      title: numberText(rows.length, 0),
      note: `${numberText(missingRoots, 0)} missing/unreadable; ${numberText(notScannedRoots, 0)} not scanned.`,
    },
    {
      status: parserErrors ? "bad" : totalCandidates ? "ok" : "bad",
      label: "Parsed",
      title: `${numberText(totalParsed, 0)} / ${numberText(totalCandidates, 0)}`,
      note: `${numberText(parserErrors, 0)} parser error${parserErrors === 1 ? "" : "s"}.`,
    },
    {
      status: cappedRoots ? "warn" : "ok",
      label: "Caps",
      title: numberText(cappedRoots, 0),
      note: `Catalog limit ${numberText(catalog.limit || 0, 0)}; scan time ${numberText(totalDurationMs, 3)} ms.`,
    },
    {
      status: unsupportedFiles || skippedSamples ? "warn" : "ok",
      label: "Skips",
      title: `${numberText(unsupportedFiles, 0)} unsupported`,
      note: `${numberText(skippedSamples, 0)} bounded skipped sample${skippedSamples === 1 ? "" : "s"} in scan evidence.`,
    },
    {
      status: hiddenConfigured || suggestedFiles ? "warn" : audit.generated_at ? "ok" : "waiting",
      label: "Audit",
      title: audit.generated_at ? `${numberText(hiddenConfigured + suggestedFiles, 0)} hidden/suggested` : "not run",
      note: audit.generated_at
        ? `${numberText(hiddenConfigured, 0)} hidden configured; ${numberText(suggestedFiles, 0)} suggested-root files.`
        : "Open diagnostics to run Storage Audit for disk-vs-catalog visibility.",
    },
  ];
  const lines = [
    {
      status: inventory.status || status,
      title: "Inventory Summary",
      detail: `${numberText(inventory.root_count ?? rows.length, 0)} root${(inventory.root_count ?? rows.length) === 1 ? "" : "s"}; ${numberText(inventory.readable_root_count ?? 0, 0)} readable; status ${text(inventory.status || status)}; issue ${text(inventory.primary_issue || "not available")}.`,
    },
    {
      status: rows.length ? missingRoots ? "bad" : "ok" : "bad",
      title: "Root Scope",
      detail: rows.length
        ? `${numberText(rows.length, 0)} root${rows.length === 1 ? "" : "s"} scanned; ${numberText(missingRoots, 0)} missing/unreadable; ${numberText(notScannedRoots, 0)} not scanned.`
        : "No root scan summaries were returned by the catalog endpoint.",
    },
    {
      status: parserErrors ? "bad" : totalCandidates ? "ok" : "bad",
      title: "Parsing",
      detail: `${numberText(totalCandidates, 0)} candidate file${totalCandidates === 1 ? "" : "s"}; ${numberText(totalParsed, 0)} parsed; ${numberText(parserErrors, 0)} parser error${parserErrors === 1 ? "" : "s"}.`,
    },
    {
      status: unsupportedFiles || skippedSamples ? "warn" : "ok",
      title: "Skipped Files",
      detail: `${numberText(unsupportedFiles, 0)} unsupported file${unsupportedFiles === 1 ? "" : "s"}; ${numberText(skippedSamples, 0)} bounded skipped sample${skippedSamples === 1 ? "" : "s"} exposed.`,
    },
    {
      status: cappedRoots ? "warn" : "ok",
      title: "Scan Limits",
      detail: `${numberText(cappedRoots, 0)} capped root${cappedRoots === 1 ? "" : "s"}; catalog limit ${numberText(catalog.limit || 0, 0)}; total scan time ${numberText(totalDurationMs, 3)} ms.`,
    },
    {
      status: hiddenConfigured || suggestedFiles ? "warn" : audit.generated_at ? "ok" : "waiting",
      title: "Storage Audit",
      detail: audit.generated_at
        ? `${numberText(hiddenConfigured, 0)} hidden configured file${hiddenConfigured === 1 ? "" : "s"}; ${numberText(suggestedFiles, 0)} suggested-root file${suggestedFiles === 1 ? "" : "s"}.`
        : "Storage Audit has not published disk-vs-catalog visibility evidence yet.",
    },
    {
      status: topIssueRoot ? topIssueRoot.parse_error_count || !topIssueRoot.exists || !topIssueRoot.is_dir ? "bad" : "warn" : "ok",
      title: "Top Issue Root",
      detail: topIssueRoot
        ? `${text(topIssueRoot.display_path || topIssueRoot.path)} - ${text(topIssueRoot.not_scanned_reason || ((topIssueRoot.sample_errors || [])[0] || {}).error || ((topIssueRoot.sample_skipped_files || [])[0] || {}).reason || "review scan row")}`
        : "No root-level issue sample found.",
    },
    {
      status,
      title: "Next Action",
      detail: nextAction,
    },
  ];
  return { status, headline, nextAction, cards, lines };
}

function catalogScanReportText(model) {
  return [
    `Catalog Scan Report: ${model.headline}`,
    ...model.lines.map((line) => `${line.title}: ${line.detail}`),
  ].join("\n");
}

function renderDataCatalogScanReport() {
  if (
    !$("data-catalog-scan-report-note")
    || !$("data-catalog-scan-report-cards")
    || !$("data-catalog-scan-report-body")
    || !$("data-catalog-scan-report-actions")
  ) return;
  const model = catalogScanReportModel();
  state.catalogScanReportText = catalogScanReportText(model);
  $("data-catalog-scan-report-note").textContent = model.nextAction;
  $("data-catalog-scan-report-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-catalog-scan-report-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("data-catalog-scan-report-actions").innerHTML = [
    `<button type="button" data-catalog-scan-report-action="copy">Copy Report</button>`,
    `<button type="button" class="secondary" data-catalog-scan-report-action="export">Export Scan CSV</button>`,
    `<button type="button" class="secondary" data-catalog-scan-report-action="raise">Raise Rows</button>`,
    `<button type="button" class="secondary" data-catalog-scan-report-action="storage">Storage Audit</button>`,
    `<button type="button" class="secondary" data-catalog-scan-report-action="roots">Copy Roots YAML</button>`,
  ].join("");
}

function handleDataCatalogScanReportAction(action) {
  if (action === "copy") {
    copyText(state.catalogScanReportText || "No catalog scan report loaded").then(() => {
      $("last-refresh").textContent = "Catalog scan report copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Catalog scan report copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "export") {
    downloadDataCatalogScanCsv().catch((err) => {
      $("last-refresh").textContent = `Catalog scan CSV export failed: ${err.message}`;
    });
    return;
  }
  if (action === "raise") {
    setDataCatalogLimitToMax();
    refreshDataLibrary({ includeDiagnostics: true, force: true }).catch((err) => {
      $("last-refresh").textContent = `Catalog refresh failed: ${err.message}`;
    });
    return;
  }
  if (action === "storage") {
    const element = $("data-storage-audit-list") || $("data-storage-audit-body");
    if (element) element.scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Review Storage Audit for disk-vs-catalog visibility";
    return;
  }
  if (action === "roots") {
    copyDataRootsYaml();
  }
}

function renderDataCatalogHealth() {
  if (!$("data-catalog-health-cards") || !$("data-catalog-health-note")) return;
  const catalog = state.dataCatalog || {};
  const audit = state.dataStorageAudit || {};
  const datasets = catalog.datasets || [];
  const scanRows = catalog.root_summaries || [];
  const inventory = catalog.root_inventory || {};
  const auditSummary = audit.visibility_summary || {};
  const catalogRows = Number(catalog.count ?? datasets.length ?? 0);
  const totalRows = Number(catalog.total ?? catalogRows);
  const symbolCount = Number(catalog.symbol_count || 0);
  const parserErrors = Number(inventory.parse_error_count ?? catalog.error_count ?? scanRows.reduce((sum, rowItem) => sum + Number(rowItem.parse_error_count || 0), 0));
  const unsupportedScanFiles = scanRows.reduce((sum, rowItem) => sum + Number(rowItem.unsupported_file_count || 0), 0);
  const unsupportedAuditFiles = Number(audit.unsupported_file_count || auditSummary.unsupported_file_count || 0);
  const unsupportedFiles = Math.max(Number(inventory.unsupported_file_count ?? 0), unsupportedScanFiles, unsupportedAuditFiles);
  const cappedCatalogRoots = Number(inventory.capped_root_count ?? scanRows.filter((rowItem) => rowItem.scan_capped).length);
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
  renderDataCoverageAssistant();
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
  renderDataCoverageAssistant();
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
  renderDataCoverageAssistant();
}

function dataCoverageStats() {
  const coverage = state.dataCoverage || {};
  const gapSummary = state.dataGapSummary || {};
  const minuteSummary = state.dataMinuteHeatmap || {};
  const symbols = coverage.symbols || [];
  const dateBins = coverage.date_bins || [];
  const totalSymbolCount = Number(coverage.total_symbol_count || symbols.length || 0);
  let coveredBins = 0;
  let expectedBins = 0;
  for (const item of symbols) {
    const bins = item.coverage || [];
    expectedBins += dateBins.length || bins.length;
    coveredBins += bins.filter(Boolean).length;
  }
  const coveragePct = expectedBins ? (coveredBins / expectedBins) * 100 : null;
  const hiddenSymbols = Math.max(0, totalSymbolCount - symbols.length);
  const gapRows = gapSummary.gap_rows || [];
  const calendarRows = gapSummary.calendar_rows || [];
  const filesWithGaps = Number(gapSummary.files_with_gap_warnings || gapRows.length || 0);
  const filesWithMissingDays = Number(gapSummary.files_with_missing_calendar_days || calendarRows.length || 0);
  const estimatedMissing = Number(gapSummary.total_estimated_missing_intervals || 0);
  const minuteRows = minuteSummary.rows || [];
  const incompleteMinuteRows = minuteRows.filter((item) => {
    const pct = Number(item.completeness_pct);
    return Number.isFinite(pct) && pct < 99.5;
  }).length;
  const minuteMissing = Number(minuteSummary.total_estimated_missing_intervals || 0);
  const minuteCompleteness = minuteSummary.overall_completeness_pct;
  return {
    hasCoverage: Boolean(coverage.generated_at || gapSummary.generated_at || minuteSummary.generated_at),
    symbolsShown: symbols.length,
    totalSymbolCount,
    hiddenSymbols,
    dateBinCount: dateBins.length,
    coveragePct,
    coveredBins,
    expectedBins,
    filesWithGaps,
    filesWithMissingDays,
    estimatedMissing,
    largestGapSeconds: gapSummary.largest_gap_seconds,
    catalogErrorCount: Number(gapSummary.catalog_error_count || 0),
    minuteRows: minuteRows.length,
    incompleteMinuteRows,
    minuteMissing,
    minuteCompleteness,
    minuteErrorCount: Number(minuteSummary.error_count || 0),
  };
}

function dataCoverageCardStatus(value, warnAt, badAt) {
  if (value === null || value === undefined || value === "") return "neutral";
  const number = Number(value);
  if (!Number.isFinite(number)) return "neutral";
  if (number >= badAt) return "bad";
  if (number >= warnAt) return "warn";
  return "ok";
}

function renderDataCoverageAssistant() {
  if (!$("data-coverage-assistant-title") || !$("data-coverage-assistant-cards") || !$("data-coverage-assistant-actions")) return;
  const stats = dataCoverageStats();
  if (!stats.hasCoverage) {
    $("data-coverage-assistant-title").textContent = "No coverage scan loaded";
    $("data-coverage-assistant-title").className = "status-neutral";
    $("data-coverage-assistant-note").textContent = "Load diagnostics to summarize symbol/date coverage, gap pressure, minute completeness, and exportable evidence.";
    $("data-coverage-assistant-cards").innerHTML = [
      { status: "neutral", title: "Coverage", value: "Waiting", note: "No symbol/date bins have been scanned yet." },
      { status: "neutral", title: "Gaps", value: "Waiting", note: "No timestamp or calendar-gap summary is loaded." },
      { status: "neutral", title: "Minutes", value: "Waiting", note: "No minute completeness heatmap is loaded." },
    ].map(dataCoverageAssistantCardHtml).join("");
    $("data-coverage-assistant-actions").innerHTML = dataCoverageAssistantActionsHtml([
      { action: "coverage", status: "neutral", title: "Review Coverage", note: "Jump to symbol/date bins.", disabled: true },
      { action: "gaps", status: "neutral", title: "Review Gaps", note: "Jump to timestamp and calendar gaps.", disabled: true },
    ]);
    return;
  }
  const coverageMissing = stats.expectedBins ? stats.expectedBins - stats.coveredBins : 0;
  const gapPressure = stats.estimatedMissing + stats.filesWithMissingDays + stats.catalogErrorCount;
  const minutePressure = stats.minuteMissing + stats.incompleteMinuteRows + stats.minuteErrorCount;
  const titleStatus = gapPressure || minutePressure || coverageMissing ? "warn" : "ok";
  $("data-coverage-assistant-title").textContent = titleStatus === "ok" ? "Coverage looks complete" : "Coverage needs review";
  $("data-coverage-assistant-title").className = statusClass(titleStatus);
  $("data-coverage-assistant-note").textContent = `${numberText(stats.symbolsShown, 0)} of ${numberText(stats.totalSymbolCount, 0)} symbols shown across ${numberText(stats.dateBinCount, 0)} recent date bins. Use the actions to inspect the underlying scan or export it.`;
  const cards = [
    {
      status: stats.hiddenSymbols ? "warn" : "ok",
      title: "Catalog Scope",
      value: `${numberText(stats.symbolsShown, 0)} / ${numberText(stats.totalSymbolCount, 0)}`,
      note: stats.hiddenSymbols
        ? `${numberText(stats.hiddenSymbols, 0)} symbols are outside the bounded scan view.`
        : "All scanned symbols are visible in the coverage view.",
    },
    {
      status: stats.coveragePct === null ? "neutral" : stats.coveragePct >= 98 ? "ok" : stats.coveragePct >= 90 ? "warn" : "bad",
      title: "Date Coverage",
      value: pctText(stats.coveragePct),
      note: `${numberText(stats.coveredBins, 0)} of ${numberText(stats.expectedBins, 0)} symbol/date bins have data.`,
    },
    {
      status: dataCoverageCardStatus(gapPressure, 1, 1000),
      title: "Gap Pressure",
      value: numberText(stats.estimatedMissing, 0),
      note: `${numberText(stats.filesWithGaps, 0)} files with interval gaps, ${numberText(stats.filesWithMissingDays, 0)} with missing days.`,
    },
    {
      status: stats.minuteCompleteness === undefined || stats.minuteCompleteness === null ? "neutral" : Number(stats.minuteCompleteness) >= 99.5 ? "ok" : Number(stats.minuteCompleteness) >= 95 ? "warn" : "bad",
      title: "Minute Completeness",
      value: pctText(stats.minuteCompleteness),
      note: `${numberText(stats.incompleteMinuteRows, 0)} incomplete files; ${numberText(stats.minuteMissing, 0)} estimated missing intervals.`,
    },
  ];
  $("data-coverage-assistant-cards").innerHTML = cards.map(dataCoverageAssistantCardHtml).join("");
  $("data-coverage-assistant-actions").innerHTML = dataCoverageAssistantActionsHtml([
    { action: "coverage", status: coverageMissing ? "warn" : "ok", title: "Review Coverage", note: "Jump to the symbol/date coverage heatmap." },
    { action: "gaps", status: gapPressure ? "warn" : "ok", title: "Review Gaps", note: "Jump to timestamp and calendar-gap rows." },
    { action: "minutes", status: minutePressure ? "warn" : "ok", title: "Review Minutes", note: "Jump to UTC-hour minute completeness rows." },
    { action: "export", status: "neutral", title: "Export Evidence", note: "Download coverage, gap, and minute CSVs." },
  ]);
}

function dataCoverageAssistantCardHtml(card) {
  return `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.title)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `;
}

function dataCoverageAssistantActionsHtml(actions) {
  return actions.map((item) => `
    <button class="data-coverage-assistant-action status-${escapeHtml(item.status)}" data-data-coverage-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <b>${item.disabled ? "Waiting" : "Open"}</b>
    </button>
  `).join("");
}

function handleDataCoverageAssistantAction(action) {
  const scrollTo = (id) => {
    const target = $(id);
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  };
  if (action === "coverage") {
    scrollTo("data-coverage-grid");
    return;
  }
  if (action === "gaps") {
    scrollTo("data-gap-summary-body");
    return;
  }
  if (action === "minutes") {
    scrollTo("data-minute-heatmap-grid");
    return;
  }
  if (action === "export") {
    for (const id of ["export-data-coverage-csv", "export-data-gap-summary-csv", "export-data-minute-heatmap-csv"]) {
      const button = $(id);
      if (button) button.click();
    }
  }
}

function renderSymbolDiagnostic() {
  const diagnostic = state.symbolDiagnostic || {};
  const summary = diagnostic.diagnostic_summary || {};
  state.symbolDiagnosticReportText = symbolDiagnosticReportText(diagnostic);
  $("data-symbol-diagnostic-status").innerHTML = diagnostic.status
    ? statusText(summary.status || (diagnostic.status === "visible" ? "ok" : diagnostic.status === "not_found" ? "bad" : "warn"))
    : "No symbol checked";
  $("copy-symbol-diagnostic-report").disabled = !diagnostic.symbol;
  const pairs = diagnostic.symbol
    ? [
        ["Symbol", diagnostic.symbol],
        ["Status", diagnostic.status],
        ["Diagnostic", summary.status || "n/a"],
        ["Finding", diagnostic.message],
        ["Next Step", diagnostic.action],
        ["Catalog Matches", numberText(summary.visible_match_count ?? (diagnostic.catalog_matches || []).length, 0)],
        ["Configured Candidates", numberText(summary.configured_candidate_count ?? (diagnostic.configured_candidates || []).length, 0)],
        ["Unconfigured Matches", numberText(summary.unconfigured_match_count ?? (diagnostic.unconfigured_matches || []).length, 0)],
        ["Parser Errors", numberText(summary.parse_error_count, 0)],
        ["Catalog Limit Blocks", numberText(summary.limit_blocked_count, 0)],
        ["Quality Reviews", numberText(summary.visible_quality_review_count, 0)],
        ["Timestamp Reviews", numberText(summary.visible_timestamp_review_count, 0)],
        ["Storage Reviews", numberText(summary.visible_storage_contract_review_count, 0)],
        ["Root Inventory", `${text(summary.root_inventory_status || "unknown")} - ${text(summary.root_inventory_primary_issue || "n/a")}`],
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
        escapeHtml(item.error || [
          item.quality_status ? `Q ${item.quality_status}` : "",
          item.storage_contract_status ? `contract ${item.storage_contract_status}` : "",
          item.timestamp_parse_failures ? `${numberText(item.timestamp_parse_failures, 0)} ts fail` : "",
          item.duplicate_timestamps ? `${numberText(item.duplicate_timestamps, 0)} dup ts` : "",
        ].filter(Boolean).join(" / ")),
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

function renderSymbolBatchDiagnostic() {
  if (!$("data-symbol-batch-note") || !$("data-symbol-batch-cards") || !$("data-symbol-batch-body")) return;
  const payload = state.symbolBatchDiagnostic || {};
  const rows = payload.rows || [];
  const statusCounts = payload.status_counts || {};
  const diagnosticCounts = payload.diagnostic_status_counts || {};
  state.symbolBatchDiagnosticReportText = symbolBatchDiagnosticReportText(payload);
  if ($("export-data-symbol-batch-csv")) $("export-data-symbol-batch-csv").disabled = !rows.length;
  if ($("copy-symbol-batch-report")) $("copy-symbol-batch-report").disabled = !rows.length;
  $("data-symbol-batch-note").textContent = payload.requested_count
    ? `${numberText(payload.visible_count || 0, 0)} visible / ${numberText(payload.missing_count || 0, 0)} need action across ${numberText(payload.requested_count, 0)} checked symbol${payload.requested_count === 1 ? "" : "s"}.`
    : "Paste up to 50 symbols to check catalog-visible, configured-but-limited, unconfigured, parse-error, fetch-error, or missing states.";
  const cards = [
    {
      label: "Checked",
      status: payload.requested_count ? "ok" : "warn",
      title: numberText(payload.requested_count || 0, 0),
      note: payload.truncated ? `Input was capped at ${numberText(payload.max_symbols, 0)} symbols.` : "Duplicate symbols are removed before checking.",
    },
    {
      label: "Visible",
      status: Number(payload.visible_count || 0) ? "ok" : rows.length ? "warn" : "idle",
      title: numberText(payload.visible_count || 0, 0),
      note: "Symbols with at least one current parsed catalog row.",
    },
    {
      label: "Need Action",
      status: Number(payload.missing_count || 0) ? "warn" : rows.length ? "ok" : "warn",
      title: numberText(payload.missing_count || 0, 0),
      note: countSummary(statusCounts),
    },
    {
      label: "Diagnostics",
      status: rows.length ? "ok" : "warn",
      title: countSummary(diagnosticCounts),
      note: `Catalog limit ${numberText(payload.catalog_limit || selectedDataCatalogLimit(), 0)}.`,
    },
  ];
  $("data-symbol-batch-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("data-symbol-batch-body").innerHTML = rows.length
    ? rows.map((item) => row([
        escapeHtml(item.symbol),
        statusText(item.status === "visible" ? "ok" : item.status === "not_found" ? "bad" : "warn", { suffix: ` ${text(item.status)}` }),
        escapeHtml(numberText(item.visible_match_count, 0)),
        escapeHtml(numberText(item.configured_candidate_count, 0)),
        escapeHtml(numberText(item.unconfigured_match_count, 0)),
        escapeHtml(text(item.message)),
        escapeHtml(text(item.action)),
        item.best_path
          ? `<span class="mono">${escapeHtml(text(item.best_bar_size))}</span> ${escapeHtml(text(item.best_source))}<br><span class="muted">${escapeHtml(numberText(item.best_rows, 0))} rows</span>`
          : `<span class="muted">n/a</span>`,
        `<span class="button-pair"><button class="secondary compact-button inspect-batch-symbol" type="button" data-symbol="${escapeHtml(item.symbol)}" data-path="${escapeHtml(item.best_path || "")}"${item.best_path ? "" : " disabled"}>Inspect</button><button class="secondary compact-button workbench-batch-symbol" type="button" data-symbol="${escapeHtml(item.symbol)}" data-path="${escapeHtml(item.best_path || "")}"${item.best_path ? "" : " disabled"}>Workbench</button><button class="secondary compact-button diagnose-batch-symbol" type="button" data-symbol="${escapeHtml(item.symbol)}">Diagnose</button></span>`,
      ])).join("")
    : row([`<span class="muted">No universe diagnostic loaded.</span>`, "", "", "", "", "", "", "", ""]);
}

function symbolBatchDiagnosticReportText(payload = {}) {
  const rows = payload.rows || [];
  if (!rows.length) return "No universe visibility check loaded.";
  const lines = [
    "Universe Visibility Check",
    `Generated: ${text(payload.generated_at)}`,
    `Checked: ${numberText(payload.requested_count, 0)} / visible=${numberText(payload.visible_count, 0)} / need_action=${numberText(payload.missing_count, 0)}`,
    `Catalog Limit: ${numberText(payload.catalog_limit, 0)} / capped=${payload.truncated ? "true" : "false"}`,
    `Status Counts: ${countSummary(payload.status_counts || {})}`,
    `Diagnostic Counts: ${countSummary(payload.diagnostic_status_counts || {})}`,
    "Rows:",
    ...rows.map((item, index) => [
      `${index + 1}. ${text(item.symbol)}`,
      `status=${text(item.status)}`,
      `diagnostic=${text(item.diagnostic_status)}`,
      `visible=${numberText(item.visible_match_count, 0)}`,
      `configured=${numberText(item.configured_candidate_count, 0)}`,
      `unconfigured=${numberText(item.unconfigured_match_count, 0)}`,
      item.best_path ? `best=${item.best_path}` : "best=n/a",
      `issue=${text(item.message)}`,
      `next=${text(item.action)}`,
    ].join(" | ")),
  ];
  return lines.join("\n");
}

function symbolDiagnosticReportText(diagnostic = {}) {
  if (!diagnostic || !diagnostic.symbol) return "No symbol diagnostic loaded.";
  const summary = diagnostic.diagnostic_summary || {};
  const rootInventory = diagnostic.root_inventory || {};
  const candidates = [
    ...(diagnostic.configured_candidates || []),
    ...(diagnostic.unconfigured_matches || []).map((item) => ({ ...item, unconfigured: true })),
  ];
  const candidateLines = candidates.length
    ? candidates.slice(0, 10).map((item, index) => [
        `${index + 1}. ${item.path || "n/a"}`,
        `scope=${item.unconfigured ? "unconfigured" : text(item.in_catalog_scope)}`,
        `symbol=${text(item.symbol)}`,
        `rows=${numberText(item.rows, 0)}`,
        `quality=${text(item.quality_status)}`,
        `storage=${text(item.storage_contract_status)}`,
        `range=${rangeLabel(item.first_timestamp, item.last_timestamp)}`,
        item.error ? `error=${item.error}` : "",
      ].filter(Boolean).join(" | "))
    : ["none"];
  const fetchLines = (diagnostic.fetch_manifest_rows || []).length
    ? (diagnostic.fetch_manifest_rows || []).slice(0, 10).map((item, index) => [
        `${index + 1}. ${text(item.job_id)}`,
        `type=${text(item.type)}`,
        `status=${text(item.status || item.kind)}`,
        item.day ? `day=${item.day}` : "",
        item.path ? `path=${item.path}` : "",
        item.message ? `message=${item.message}` : "",
      ].filter(Boolean).join(" | "))
    : ["none"];
  return [
    `Symbol Diagnostic: ${diagnostic.symbol}`,
    `Status: ${text(diagnostic.status)} / ${text(summary.status)}`,
    `Finding: ${text(diagnostic.message)}`,
    `Next Step: ${text(diagnostic.action)}`,
    `Catalog: visible=${numberText(summary.visible_match_count, 0)} configured=${numberText(summary.configured_candidate_count, 0)} unconfigured=${numberText(summary.unconfigured_match_count, 0)} limit_blocked=${numberText(summary.limit_blocked_count, 0)}`,
    `Reviews: parser=${numberText(summary.parse_error_count, 0)} quality=${numberText(summary.visible_quality_review_count, 0)} timestamp=${numberText(summary.visible_timestamp_review_count, 0)} storage=${numberText(summary.visible_storage_contract_review_count, 0)} fetch_errors=${numberText(summary.fetch_error_count, 0)}`,
    `Root Inventory: ${text(rootInventory.status || summary.root_inventory_status)} - ${text(rootInventory.primary_issue || summary.root_inventory_primary_issue)}`,
    "Candidates:",
    ...candidateLines,
    "Fetch Manifest Clues:",
    ...fetchLines,
  ].join("\n");
}

function copySymbolDiagnosticReport() {
  copyText(state.symbolDiagnosticReportText || "No symbol diagnostic loaded.").then(() => {
    $("last-refresh").textContent = "Symbol diagnostic report copied";
  }).catch((err) => {
    $("last-refresh").textContent = `Symbol diagnostic report copy failed: ${err.message}`;
  });
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

function dataDetailActionSummaryModel(detail = {}, timezoneMode = "utc") {
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

function renderDataDetailActionSummary(detail = {}, timezoneMode = "utc") {
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

async function handleDataDetailAction(action) {
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
  for (const option of datasetSelect.options) {
    option.selected = option.value === path;
    if (option.value === path) {
      attachDatasetOptionMetadata(option, dataset);
      found = true;
    }
  }
  if (!found) {
    const label = `${text(detail.symbol)} ${text(detail.bar_size)} [${text((detail.quality || {}).quality_status || "unknown")}] - ${path}`;
    const option = document.createElement("option");
    option.value = path;
    option.textContent = label;
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

function renderDataDetailAssistant(detail = {}, timezoneMode = "utc") {
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
  renderDataCompareActionSummary(state.dataCompare || {}, $("data-compare-timezone").value || "utc");
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
    rememberWorkbenchDataset(dataset);
    if (Array.from(datasetSelect.options).some((option) => option.value === dataset.path)) continue;
    const option = document.createElement("option");
    option.value = dataset.path;
    option.textContent = `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`;
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

function dataCompareActionSummaryModel(comparison = {}, timezoneMode = "utc") {
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

function renderDataCompareActionSummary(comparison = {}, timezoneMode = "utc") {
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

async function handleDataCompareAction(action) {
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

