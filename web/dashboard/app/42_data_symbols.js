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

