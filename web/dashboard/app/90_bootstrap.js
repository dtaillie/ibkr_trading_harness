import {
  $,
  AUTO_REFRESH_INTERVAL_MS,
  activeView,
  applyDataLens,
  applyFetchLens,
  applyWorkbenchLens,
  commandBoundaries,
  commandFields,
  commandParamNames,
  dataEndpointContract,
  dataLibraryLoadState,
  durationMsText,
  escapeHtml,
  fetchJson,
  fetchOptionalJson,
  fetchText,
  handleRouteAction,
  interval,
  jumpToDashboardTarget,
  money,
  navigateToDataLens,
  navigateToFetchLens,
  navigateToHelpLens,
  navigateToOperationsLens,
  navigateToOverviewLens,
  navigateToPerformanceLens,
  navigateToRunsLens,
  navigateToView,
  navigateToViewTarget,
  navigateToWorkbenchLens,
  numberText,
  onOptional,
  renderPageIntro,
  routeHash,
  routeUrl,
  row,
  selectedDataCatalogLimit,
  selectedDataCatalogOffset,
  selectedDataLens,
  setActiveView,
  setDataCatalogOffset,
  setDataDiagnosticsLoadingNote,
  startDashboardTask,
  state,
  statusText,
  syncDataCatalogLimitControl,
  text,
  token,
  viewFromHash,
} from "./00_core.js";
import { handleHelpCloudAccessAction, handleHelpModeBoundaryAction, handleHelpPerformanceGuideAction, handleHelpTaskNavigatorAction, handlePublicationReviewAction, renderHelpSetupGaps, renderHelpWorkbenchQuickstart } from "./10_help.js";
import {
  activateWorkbenchGuideAction,
  applyDataCompareRangePreset,
  compareConfigDatasets,
  configDateRangePayload,
  handleWorkbenchEvidenceAction,
  handleWorkbenchExampleGalleryAction,
  handleWorkbenchHomeAction,
  handleWorkbenchPluginBoundaryAction,
  handleWorkbenchSelectedDataAction,
  openFirstConfigDatasetDetail,
  renderWorkbenchGuide,
  renderWorkbenchHome,
  selectedCompareDatasets,
  selectedConfigDatasets,
  selectedDataCoverageRows,
  selectedTelemetryRun,
  updateCompareSelectionFromSelect,
} from "./20_workbench_foundation.js";
import {
  checkDashboardDataApis,
  copyDashboardApiHealthReport,
  downloadDashboardApiHealthCsv,
  finiteNumber,
  handleDataBackendStatusAction,
  handleFetchBackendStatusAction,
  handleWorkbenchBackendStatusAction,
  openOverviewSourceDetail,
  renderDashboardApiHealth,
  timestampMillis,
} from "./30_runtime_core.js";
import { handlePerformanceTradeAssistantAction } from "./31_performance_math.js";
import { handleOverviewHealthReportAction, renderMetrics, renderOverview } from "./32_overview.js";
import {
  focusPerformanceDay,
  handlePerformanceAction,
  handlePerformanceEvidenceAction,
  handlePerformanceReportAction,
  handlePerformanceRollupAssistantAction,
  handlePerformanceRollupContinuityAction,
  handlePerformanceSnapshotAction,
  reloadTelemetryArtifacts,
  renderPerformance,
  renderPerformancePeriodRollups,
  renderPerformanceRollups,
  renderStatusEquityRollups,
} from "./33_performance_views.js";
import {
  activeSymbolTypeaheadSuggestion,
  approvalPreviewCanApprove,
  bestCatalogDatasetForSymbol,
  countSummary,
  dataCatalogServerQueryParams,
  dataHistoryMatrixBackendScopeApplied,
  dataHistoryMatrixServerQueryParams,
  dataSymbolDirectoryServerQueryParams,
  filteredDataCatalog,
  handleRootIndexBrowserAction,
  handleRootIndexDetailAction,
  handleSymbolVisibilityAction,
  moveSymbolTypeaheadSelection,
  refreshRootIndexFromServerFilters,
  renderRootIndexBrowser,
  renderSymbolBrowser,
  renderSymbolDirectory,
  renderSymbolProfile,
  renderSymbolVisibilityExplainer,
  rootIndexDetailServerQueryParams,
  rootIndexServerQueryParams,
  selectSymbolBrowserSymbol,
  selectedSymbolBrowserDatasets,
  selectedSymbolBrowserSymbol,
  shellQuote,
  symbolDirectoryRows,
  topSymbolBrowserSuggestion,
} from "./40_data_catalog.js";
import {
  clearDataCatalogFilters,
  dataFilterSummary,
  dataHistoryMatrixRows,
  handleDataExplorerAction,
  handleDataHistoryMatrixAction,
  handleDataInventoryEvidenceAction,
  handleDataScopeAssistantAction,
  handleDataServerFilterControlChange,
  handleDataVisibilityReportAction,
  handleRootIndexSpotlightAction,
  previewDataCatalogServerFilters,
  renderDataCatalog,
  runDataCatalogServerSearch,
} from "./41_data_explorer.js";
import {
  compareSelectedSymbolDatasets,
  copySymbolDiagnosticReport,
  diagnoseSelectedSymbol,
  handleDataCatalogScanReportAction,
  handleDataCoverageAssistantAction,
  handleDataHomeShortlistAction,
  handleDataSourceMapAction,
  handleDataStorageAssistantAction,
  handleSymbolDirectoryAction,
  handleSymbolDirectoryAssistantAction,
  handleSymbolProfileAction,
  handleSymbolSelectionAction,
  inspectSelectedSymbol,
  renderCleanupPlan,
  renderDataCoverage,
  renderDataGapSummary,
  renderDataLibrarySummary,
  renderDataMinuteHeatmap,
  renderDataStorageAudit,
  renderDiagnostics,
  renderEndpointMap,
  renderSymbolBatchDiagnostic,
  renderSymbolDiagnostic,
  renderSymbolSelectionPanel,
  renderWorkbenchStatus,
  selectCatalogDatasetInWorkbench,
} from "./42_data_symbols.js";
import {
  clearCompareSelection,
  dateInputValueFromTimestamp,
  handleDataCompareAction,
  handleDataCompareAssistantAction,
  handleDataDetailAction,
  handleDataDetailAssistantAction,
  openAdjacentDataDetail,
  renderDataCompare,
  renderDataCompareControls,
  renderDataDetail,
  renderDataDetailActionSummary,
  selectShownCompareDatasets,
  selectSymbolCompareDatasets,
  useDataCompareInWorkbench,
  useDataDetailInWorkbench,
} from "./43_data_detail_compare.js";
import {
  applyFetchOutputDataFilter,
  compareFetchOutputs,
  copyDataRootsYaml,
  copyFetchManifestRootsYaml,
  copyFetchVisibleOutputPaths,
  fetchResumeCommand,
  handleFetchEvidenceAction,
  handleFetchProgressAction,
  handleFetchSearchAction,
  renderFetchJobs,
  renderFetchManifestDetail,
  useFetchOutputsInWorkbench,
} from "./50_fetch.js";
import {
  applyRiskPreset,
  configFieldValue,
  configPluginStrategyPayload,
  handleConfigDraftError,
  handleWorkbenchArtifactsActionSummary,
  handleWorkbenchArtifactsAssistantAction,
  handleWorkbenchBuilderAssistantAction,
  handleWorkbenchDraftInventoryAction,
  handleWorkbenchRunReadinessAction,
  renderConfigAlignment,
  renderConfigBuilder,
  renderConfigBuilderReadiness,
  renderConfigCompatibility,
  renderConfigLivePanels,
  renderDraftValidations,
  renderRunComparison,
  renderRunDetail,
  renderWorkbenchArtifacts,
  renderWorkbenchArtifactsActionSummary,
  renderWorkbenchBuilderAssistant,
  renderWorkbenchDraftInventory,
  renderWorkbenchRunCommands,
  renderWorkbenchRunReadiness,
  renderWorkbenchRunResult,
  renderWorkbenchRuns,
  renderWorkbenchTriage,
  workbenchResultModel,
} from "./60_workbench_builder.js";
import {
  activityChanges,
  activitySnapshot,
  applyRunsEventsAssistantAction,
  handleExecutionQualityAction,
  handleRunsEventFlowAction,
  handleRunsEvidenceAction,
  handleRunsSearchAction,
  handleRunsStateAction,
  renderOverviewChanges,
  renderRunEvents,
  renderRuns,
  renderRuntimeSessionDetail,
} from "./70_runs.js";
import {
  handleCloudReadinessAction,
  handleCommandSafetyAction,
  handleControlAssistantAction,
  handleOperationsEvidenceAction,
  handleOperationsHomeAction,
  handlePaperAction,
  handleRemoteAction,
  handleRemoteDetailAssistantAction,
  handleRemoteNodeHealthReportAction,
  handleRemoteNodesAssistantAction,
  handleRemoteReportAction,
  handleSupervisorAction,
  prepareRequestStatusCommand,
  renderAlerts,
  renderCloudDeploymentReadiness,
  renderCommandAudit,
  renderCommandSafetyReview,
  renderCommands,
  renderControlAssistant,
  renderGateway,
  renderHistory,
  renderOperationsHome,
  renderPaperMonitor,
  renderRemoteControl,
  renderRemoteNodeDetail,
  renderRemoteNodes,
  renderResults,
  renderSupervisors,
} from "./80_operations.js";

export function renderAll() {
  renderOverview();
  renderOverviewChanges();
  renderMetrics();
  renderPerformance();
  renderStatusEquityRollups();
  renderPerformancePeriodRollups();
  renderPerformanceRollups();
  renderWorkbenchStatus();
  renderCleanupPlan();
  renderDiagnostics();
  renderEndpointMap();
  renderDataCatalog();
  renderDataDetail();
  renderDataCompareControls();
  renderDataCompare();
  renderDataCoverage();
  renderDataGapSummary();
  renderDataMinuteHeatmap();
  renderDataStorageAudit();
  renderSymbolDiagnostic();
  renderSymbolBatchDiagnostic();
  renderFetchJobs();
  renderFetchManifestDetail();
  renderConfigBuilder();
  renderWorkbenchRuns();
  renderRunComparison();
  renderRunDetail();
  renderWorkbenchArtifacts();
  renderRuns();
  renderRunEvents();
  renderSupervisors();
  renderRemoteControl();
  renderAlerts();
  renderGateway();
  renderPaperMonitor();
  renderRemoteNodes();
  renderRemoteNodeDetail();
  renderCloudDeploymentReadiness();
  renderHistory();
  renderCommands();
  renderResults();
  renderCommandAudit();
  renderControlAssistant();
  renderCommandSafetyReview();
  renderOperationsHome();
  renderDashboardApiHealth();
  renderHelpSetupGaps();
  renderPageIntro();
  $("last-refresh").textContent = `Last refresh: ${new Date().toLocaleString()}`;
}

export function shouldLoadDataDiagnostics() {
  return activeView() === "data" && selectedDataLens() === "diagnostics";
}

export async function refreshDataDiagnostics({ force = false } = {}) {
  const loadState = dataLibraryLoadState();
  if (loadState.diagnosticsLoading && !force) return;
  if (loadState.diagnosticsLoaded && !force) return;
  loadState.diagnosticsLoading = true;
  loadState.diagnosticsError = "";
  setDataDiagnosticsLoadingNote("Loading Data Library diagnostics; large local caches can take a while.", "warn");
  const requestId = loadState.requestId;
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const storageScanLimit = encodeURIComponent($("data-storage-scan-limit").value || "5000");
  const diagnosticLabels = new Set([
    "data coverage",
    "data gap summary",
    "data minute heatmap",
    "data storage audit",
  ]);
  const endpointContracts = (state.dataEndpointContracts || []).filter((item) => !diagnosticLabels.has(item.label));
  const recordDiagnosticEndpoint = (label, url, payload, options = {}) => {
    endpointContracts.push(dataEndpointContract(label, url, payload, options));
    state.dataEndpointContracts = endpointContracts;
    renderDashboardApiHealth();
  };
  try {
    const coverageUrl = `/data_coverage?limit=${catalogLimit}&max_symbols=60&max_dates=60`;
    const coverageStarted = performance.now();
    let dataCoverage;
    try {
      dataCoverage = await fetchJson(coverageUrl);
      if (requestId !== loadState.requestId) return;
      recordDiagnosticEndpoint("coverage", coverageUrl, dataCoverage, {
        durationMs: performance.now() - coverageStarted,
      });
    } catch (coverageErr) {
      if (requestId !== loadState.requestId) return;
      recordDiagnosticEndpoint("coverage", coverageUrl, { symbols: [], errors: [{ error: coverageErr.message }] }, {
        durationMs: performance.now() - coverageStarted,
        error: coverageErr.message,
      });
      throw coverageErr;
    }
    if (requestId !== loadState.requestId) return;
    state.dataCoverage = dataCoverage || { symbols: [], date_bins: [], errors: [] };
    renderDataCoverage();
    const gapUrl = `/data_gap_summary?catalog_limit=${catalogLimit}&top_limit=20`;
    const gapStarted = performance.now();
    let dataGapSummary;
    try {
      dataGapSummary = await fetchJson(gapUrl);
      if (requestId !== loadState.requestId) return;
      recordDiagnosticEndpoint("gap summary", gapUrl, dataGapSummary, {
        durationMs: performance.now() - gapStarted,
      });
    } catch (gapErr) {
      if (requestId !== loadState.requestId) return;
      recordDiagnosticEndpoint("gap summary", gapUrl, { gap_rows: [], calendar_rows: [], errors: [{ error: gapErr.message }] }, {
        durationMs: performance.now() - gapStarted,
        error: gapErr.message,
      });
      throw gapErr;
    }
    if (requestId !== loadState.requestId) return;
    state.dataGapSummary = dataGapSummary || { gap_rows: [], calendar_rows: [] };
    renderDataGapSummary();
    const heatmapUrl = `/data_minute_heatmap?catalog_limit=${catalogLimit}&top_limit=20`;
    const heatmapStarted = performance.now();
    let dataMinuteHeatmap;
    try {
      dataMinuteHeatmap = await fetchJson(heatmapUrl);
      if (requestId !== loadState.requestId) return;
      recordDiagnosticEndpoint("minute heatmap", heatmapUrl, dataMinuteHeatmap, {
        durationMs: performance.now() - heatmapStarted,
      });
    } catch (heatmapErr) {
      if (requestId !== loadState.requestId) return;
      recordDiagnosticEndpoint("minute heatmap", heatmapUrl, { rows: [], errors: [{ error: heatmapErr.message }] }, {
        durationMs: performance.now() - heatmapStarted,
        error: heatmapErr.message,
      });
      throw heatmapErr;
    }
    if (requestId !== loadState.requestId) return;
    state.dataMinuteHeatmap = dataMinuteHeatmap || { rows: [], errors: [] };
    renderDataMinuteHeatmap();
    const storageAuditUrl = `/data_storage_audit?catalog_limit=${catalogLimit}&scan_limit=${storageScanLimit}`;
    const storageAuditStarted = performance.now();
    let dataStorageAudit;
    try {
      dataStorageAudit = await fetchJson(storageAuditUrl);
      if (requestId !== loadState.requestId) return;
      recordDiagnosticEndpoint("storage audit", storageAuditUrl, dataStorageAudit, {
        durationMs: performance.now() - storageAuditStarted,
      });
    } catch (storageAuditErr) {
      if (requestId !== loadState.requestId) return;
      recordDiagnosticEndpoint("storage audit", storageAuditUrl, { configured_roots: [], suggested_roots: [], warnings: [], errors: [{ error: storageAuditErr.message }] }, {
        durationMs: performance.now() - storageAuditStarted,
        error: storageAuditErr.message,
      });
      throw storageAuditErr;
    }
    if (requestId !== loadState.requestId) return;
    state.dataStorageAudit = dataStorageAudit || { configured_roots: [], suggested_roots: [], warnings: [] };
    loadState.diagnosticsLoaded = true;
    loadState.diagnosticsRequested = false;
    renderDataStorageAudit();
    renderDataLibrarySummary();
    renderPageIntro();
  } catch (err) {
    if (requestId !== loadState.requestId) return;
    loadState.diagnosticsError = err.message;
    setDataDiagnosticsLoadingNote(`Data diagnostics refresh failed: ${err.message}`, "bad");
    renderDashboardApiHealth();
  } finally {
    if (requestId === loadState.requestId) {
      loadState.diagnosticsLoading = false;
      renderDashboardApiHealth();
    }
  }
}

export async function refreshDataLibrary({ includeDiagnostics = false, force = false } = {}) {
  const loadState = dataLibraryLoadState();
  if (includeDiagnostics) loadState.diagnosticsRequested = true;
  if (loadState.catalogLoading && !force) return;
  if (loadState.catalogLoaded && !force) {
    if (includeDiagnostics || loadState.diagnosticsRequested) {
      await refreshDataDiagnostics({ force: false });
    }
    return;
  }
  const requestId = loadState.requestId + 1;
  loadState.requestId = requestId;
  const symbolIndexLimit = encodeURIComponent(Math.max(Number(selectedDataCatalogLimit()) || 0, 20000));
  loadState.catalogLoading = true;
  loadState.catalogError = "";
  loadState.diagnosticsLoaded = false;
  loadState.diagnosticsError = "";
  loadState.diagnosticsRequested = Boolean(includeDiagnostics);
  state.dataSymbolIndex = { symbols: [], files: [], errors: [] };
  state.dataSymbolDirectory = { symbols: [], symbol_summaries: [], errors: [] };
  state.dataHistoryMatrix = { rows: [], groups: [], errors: [] };
  state.dataCoverage = { symbols: [], date_bins: [], errors: [] };
  state.dataGapSummary = { gap_rows: [], calendar_rows: [] };
  state.dataMinuteHeatmap = { rows: [], errors: [] };
  state.dataStorageAudit = { configured_roots: [], suggested_roots: [], warnings: [] };
  state.dataEndpointContracts = [];
  loadState.lastCatalogFetchMs = null;
  loadState.lastSymbolDirectoryFetchMs = null;
  loadState.lastHistoryMatrixFetchMs = null;
  loadState.lastSymbolIndexFetchMs = null;
  loadState.lastDataLibraryFetchMs = null;
  loadState.lastSymbolIndexLimit = Number(decodeURIComponent(symbolIndexLimit));
  renderDataCatalog();
  renderDataCoverage();
  renderDataGapSummary();
  renderDataMinuteHeatmap();
  renderDataStorageAudit();
  try {
    const totalStarted = performance.now();
    const endpointContracts = [];
    const catalogParams = dataCatalogServerQueryParams();
    if (force) catalogParams.set("refresh", "1");
    const catalogUrl = `/data_catalog?${catalogParams.toString()}`;
    const catalogStarted = performance.now();
    let dataCatalog;
    try {
      dataCatalog = await fetchJson(catalogUrl);
      loadState.lastCatalogFetchMs = performance.now() - catalogStarted;
      endpointContracts.push(dataEndpointContract("catalog", catalogUrl, dataCatalog, {
        durationMs: loadState.lastCatalogFetchMs,
      }));
    } catch (catalogErr) {
      loadState.lastCatalogFetchMs = performance.now() - catalogStarted;
      endpointContracts.push(dataEndpointContract("catalog", catalogUrl, { datasets: [], errors: [{ error: catalogErr.message }] }, {
        durationMs: loadState.lastCatalogFetchMs,
        error: catalogErr.message,
      }));
      state.dataEndpointContracts = endpointContracts;
      renderDashboardApiHealth();
      throw catalogErr;
    }
    let dataSymbolDirectory = {
      symbols: dataCatalog.symbol_summaries || [],
      symbol_summaries: dataCatalog.symbol_summaries || [],
      errors: [],
      source: "catalog_fallback",
    };
    const directoryParams = dataSymbolDirectoryServerQueryParams();
    if (force) directoryParams.set("refresh", "1");
    const directoryUrl = `/data_symbol_directory?${directoryParams.toString()}`;
    const directoryStarted = performance.now();
    try {
      dataSymbolDirectory = await fetchJson(directoryUrl);
      loadState.lastSymbolDirectoryFetchMs = performance.now() - directoryStarted;
      endpointContracts.push(dataEndpointContract("symbol directory", directoryUrl, dataSymbolDirectory, {
        durationMs: loadState.lastSymbolDirectoryFetchMs,
      }));
    } catch (directoryErr) {
      loadState.lastSymbolDirectoryFetchMs = performance.now() - directoryStarted;
      dataSymbolDirectory = {
        ...dataSymbolDirectory,
        errors: [{ error: directoryErr.message }],
        directory_error: directoryErr.message,
      };
      endpointContracts.push(dataEndpointContract("symbol directory", directoryUrl, dataSymbolDirectory, {
        durationMs: loadState.lastSymbolDirectoryFetchMs,
        error: directoryErr.message,
        fallback: "catalog symbol summaries",
      }));
    }
    const fallbackHistoryMatrixRows = dataHistoryMatrixRows(dataCatalog.datasets || []);
    let dataHistoryMatrix = {
      rows: fallbackHistoryMatrixRows,
      groups: fallbackHistoryMatrixRows,
      errors: [],
      source: "catalog_fallback",
    };
    const matrixParams = dataHistoryMatrixServerQueryParams();
    if (force) matrixParams.set("refresh", "1");
    const matrixUrl = `/data_history_matrix?${matrixParams.toString()}`;
    const matrixStarted = performance.now();
    try {
      dataHistoryMatrix = await fetchJson(matrixUrl);
      loadState.lastHistoryMatrixFetchMs = performance.now() - matrixStarted;
      endpointContracts.push(dataEndpointContract("history matrix", matrixUrl, dataHistoryMatrix, {
        durationMs: loadState.lastHistoryMatrixFetchMs,
      }));
    } catch (matrixErr) {
      loadState.lastHistoryMatrixFetchMs = performance.now() - matrixStarted;
      dataHistoryMatrix = {
        ...dataHistoryMatrix,
        errors: [{ error: matrixErr.message }],
        matrix_error: matrixErr.message,
      };
      endpointContracts.push(dataEndpointContract("history matrix", matrixUrl, dataHistoryMatrix, {
        durationMs: loadState.lastHistoryMatrixFetchMs,
        error: matrixErr.message,
        fallback: "browser grouping from catalog rows",
      }));
    }
    let dataSymbolIndex = { symbols: [], files: [], errors: [] };
    const indexUrl = `/data_symbol_index?limit=${symbolIndexLimit}${force ? "&refresh=1" : ""}`;
    const indexStarted = performance.now();
    try {
      dataSymbolIndex = await fetchJson(indexUrl);
      loadState.lastSymbolIndexFetchMs = performance.now() - indexStarted;
      endpointContracts.push(dataEndpointContract("root index", indexUrl, dataSymbolIndex, {
        durationMs: loadState.lastSymbolIndexFetchMs,
      }));
    } catch (indexErr) {
      loadState.lastSymbolIndexFetchMs = performance.now() - indexStarted;
      dataSymbolIndex = { symbols: [], files: [], errors: [{ error: indexErr.message }], index_error: indexErr.message };
      endpointContracts.push(dataEndpointContract("root index", indexUrl, dataSymbolIndex, {
        durationMs: loadState.lastSymbolIndexFetchMs,
        error: indexErr.message,
        fallback: "empty root-index inventory",
      }));
    }
    loadState.lastDataLibraryFetchMs = performance.now() - totalStarted;
    if (requestId !== loadState.requestId) return;
    state.dataEndpointContracts = endpointContracts;
    state.dataCatalog = dataCatalog || { datasets: [], errors: [] };
    state.dataSymbolDirectory = dataSymbolDirectory || { symbols: [], symbol_summaries: [], errors: [] };
    state.dataHistoryMatrix = dataHistoryMatrix || { rows: [], groups: [], errors: [] };
    state.dataSymbolIndex = dataSymbolIndex || { symbols: [], files: [], errors: [] };
    loadState.catalogLoaded = true;
    loadState.catalogLoading = false;
    renderDataCatalog();
    renderDataDetail();
    renderDataCompareControls();
    renderConfigBuilder();
    renderOverview();
    renderMetrics();
    renderDashboardApiHealth();
    renderPageIntro();
    const catalogCacheStatus = text((state.dataCatalog.scan_cache || {}).status || "n/a");
    const directoryCacheStatus = text((state.dataSymbolDirectory.scan_cache || {}).status || "n/a");
    const matrixCacheStatus = text((state.dataHistoryMatrix.scan_cache || {}).status || "n/a");
    const indexCacheStatus = text((state.dataSymbolIndex.scan_cache || {}).status || "n/a");
    $("last-refresh").textContent = `Data catalog loaded: ${new Date().toLocaleString()} / catalog ${durationMsText(loadState.lastCatalogFetchMs)} (${catalogCacheStatus}) / symbols ${durationMsText(loadState.lastSymbolDirectoryFetchMs)} (${directoryCacheStatus}) / matrix ${durationMsText(loadState.lastHistoryMatrixFetchMs)} (${matrixCacheStatus}) / root index ${durationMsText(loadState.lastSymbolIndexFetchMs)} (${indexCacheStatus})`;
    if (includeDiagnostics || loadState.diagnosticsRequested) {
      await refreshDataDiagnostics({ force });
    }
  } catch (err) {
    if (requestId !== loadState.requestId) return;
    loadState.catalogError = err.message;
    $("last-refresh").textContent = `Data catalog refresh failed: ${err.message}`;
    renderDashboardApiHealth();
  } finally {
    if (requestId === loadState.requestId) {
      loadState.catalogLoading = false;
      renderDataCatalog();
      renderDashboardApiHealth();
    }
  }
}

export async function refresh(options = {}) {
  if (state.refreshInFlight) return;
  state.refreshInFlight = true;
  try {
    await refreshOnce(options);
  } finally {
    state.refreshInFlight = false;
  }
}

export async function refreshOnce(options = {}) {
  const node = $("command-node").value || (state.status && state.status.node_id) || "";
  const beforeActivity = state.refreshLoaded ? activitySnapshot() : null;
  // Keep last-known telemetry when /status fails so a transient error does
  // not blank a previously healthy page; the topbar surfaces the failure.
  let status = state.status || {};
  try {
    status = await fetchJson("/status");
    state.statusFetchError = "";
  } catch (err) {
    state.statusFetchError = err && err.message ? err.message : String(err);
  }
  state.status = status;
  const nodeId = encodeURIComponent(node || status.node_id || "");
  const telemetryRun = selectedTelemetryRun();
  const telemetryRunId = telemetryRun && telemetryRun.id ? String(telemetryRun.id) : "";
  const optionalRequests = [
    fetchOptionalJson("status history", `/status_history${nodeId ? `?node_id=${nodeId}&limit=20` : "?limit=20"}`, { history: [] }),
    fetchOptionalJson("remote nodes", "/remote_nodes?limit=100", { nodes: [] }),
    fetchOptionalJson("workbench diagnostics", "/workbench_diagnostics", {}),
    fetchOptionalJson("fetch manifests", "/fetch_manifests?limit=50", { manifests: [], roots: [], errors: [] }),
    fetchOptionalJson("runtime sessions", "/runtime_sessions?limit=100", { sessions: [], errors: [] }),
    fetchOptionalJson("workbench status", "/workbench_status", {}),
    fetchOptionalJson("cleanup plan", "/workbench_cleanup_plan", {}),
    fetchOptionalJson("endpoint map", "/workbench_endpoints", { endpoints: [] }),
    fetchOptionalJson("config options", "/config_options", { plugins: [], modes: [], defaults: {} }),
    fetchOptionalJson("config drafts", "/config_drafts", { drafts: [], errors: [] }),
    fetchOptionalJson("draft validations", "/config_draft_validations", { validations: [] }),
    fetchOptionalJson("draft runs", "/config_draft_runs?limit=20", { runs: [] }),
    fetchOptionalJson("run comparison", "/config_draft_run_comparison?limit=50", { runs: [], leaders: {} }),
    fetchOptionalJson("performance rollups", "/config_draft_daily_rollups?limit=100&run_limit=100", { rollups: [], errors: [] }),
    fetchOptionalJson("status equity rollups", "/status_equity_rollups?limit=100&history_limit=5000", { rollups: [], period_rollups: {} }),
    fetchOptionalJson("commands", `/commands${nodeId ? `?node_id=${nodeId}` : ""}`, { commands: [] }),
    fetchOptionalJson("command results", `/command_results${nodeId ? `?node_id=${nodeId}` : ""}`, { results: [] }),
    fetchOptionalJson("command audit", `/command_audit${nodeId ? `?node_id=${nodeId}&limit=100` : "?limit=100"}`, { events: [] }),
  ];
  if (telemetryRunId) {
    optionalRequests.push(fetchOptionalJson(
      "telemetry account",
      `/telemetry_run_artifacts?run_id=${encodeURIComponent(telemetryRunId)}&limit=500`,
      { account: [], decisions: [], orders: [], fills: [], performance: {} },
    ));
  }
  const optionalResults = await Promise.all(optionalRequests);
  const optional = Object.fromEntries(optionalResults.map((result) => [result.label, result.payload]));
  state.refreshContracts = optionalResults.map((result) => ({
    label: result.label,
    status: result.error ? "warn" : "ok",
    detail: result.error || "loaded",
  }));
  state.refreshErrors = optionalResults
    .filter((result) => result.error)
    .map((result) => ({ label: result.label, error: result.error }));
  const history = optional["status history"];
  const remoteNodes = optional["remote nodes"];
  const diagnostics = optional["workbench diagnostics"];
  const fetchManifests = optional["fetch manifests"];
  const runtimeSessions = optional["runtime sessions"];
  const workbenchStatus = optional["workbench status"];
  const cleanupPlan = optional["cleanup plan"];
  const endpointMap = optional["endpoint map"];
  const configOptions = optional["config options"];
  const configDrafts = optional["config drafts"];
  const draftValidations = optional["draft validations"];
  const configRuns = optional["draft runs"];
  const runComparison = optional["run comparison"];
  const performanceRollups = optional["performance rollups"];
  const statusEquityRollups = optional["status equity rollups"];
  const commands = optional["commands"];
  const results = optional["command results"];
  const commandAudit = optional["command audit"];
  state.diagnostics = diagnostics || {};
  syncDataCatalogLimitControl();
  state.history = history.history || [];
  state.remoteNodes = remoteNodes || { nodes: [] };
  state.fetchManifests = fetchManifests || { manifests: [], roots: [], errors: [] };
  state.runtimeSessions = runtimeSessions || { sessions: [], errors: [] };
  state.workbenchStatus = workbenchStatus || {};
  state.cleanupPlan = cleanupPlan || {};
  state.endpointMap = endpointMap || { endpoints: [] };
  state.configOptions = configOptions || { plugins: [], modes: [], defaults: {} };
  state.configDrafts = configDrafts || { drafts: [], errors: [] };
  state.draftValidations = draftValidations || { validations: [] };
  state.configRuns = configRuns || { runs: [] };
  state.runComparison = runComparison || { runs: [], leaders: {} };
  state.performanceRollups = performanceRollups || { rollups: [], errors: [] };
  state.statusEquityRollups = statusEquityRollups || { rollups: [], period_rollups: {} };
  const telemetryAccount = optional["telemetry account"] || { account: [], decisions: [], orders: [], fills: [], performance: {} };
  state.telemetryAccount = {
    run_id: telemetryRunId,
    account: telemetryAccount.account || [],
    decisions: telemetryAccount.decisions || [],
    orders: telemetryAccount.orders || [],
    fills: telemetryAccount.fills || [],
    performance: telemetryAccount.performance || {},
  };
  state.commands = commands.commands || [];
  state.results = results.results || [];
  state.commandAudit = commandAudit || { events: [] };
  state.activityChanges = activityChanges(beforeActivity, activitySnapshot());
  state.refreshLoaded = true;
  renderAll();
  refreshDataLibrary({
    includeDiagnostics: Boolean(options.forceDataDiagnostics || shouldLoadDataDiagnostics()),
    force: Boolean(options.forceData),
  }).catch((err) => {
    $("last-refresh").textContent = `Data Library refresh failed: ${err.message}`;
  });
}

export function configDraftRequestPayload({ saveOverride = null } = {}) {
  const selected = selectedConfigDatasets();
  if (!selected.length) {
    throw new Error("Select at least one saved dataset first");
  }
  return {
    name: $("config-name").value,
    plugin_id: $("config-plugin").value,
    mode: $("config-mode").value,
    strategy: configPluginStrategyPayload(),
    datasets: selected.map((dataset) => ({ symbol: dataset.symbol, path: dataset.path })),
    ...configDateRangePayload(),
    starting_cash: $("config-starting-cash").value,
    history_bars: $("config-history-bars").value,
    session_enabled: $("config-session-enabled").checked,
    session_timezone: configFieldValue("config-session-timezone"),
    session_start: configFieldValue("config-session-start"),
    session_end: configFieldValue("config-session-end"),
    session_weekdays: configFieldValue("config-session-weekdays"),
    session_outside: configFieldValue("config-session-outside"),
    risk_preset: $("config-risk-preset").value,
    max_steps: $("config-max-steps").value,
    max_orders_per_run: $("config-max-orders").value,
    max_notional_per_order: $("config-max-notional").value,
    max_quantity: $("config-max-quantity").value,
    max_cash_quantity: $("config-max-cash").value,
    max_gross_exposure_pct: $("config-max-exposure").value,
    sim_slippage_bps: $("config-slippage").value,
    sim_commission_bps: $("config-commission").value,
    allow_quality_warnings: $("config-allow-quality-warnings").checked,
    save: saveOverride === null ? $("config-save").checked : Boolean(saveOverride),
  };
}

export async function submitConfigDraft({ previewOnly = false } = {}) {
  const payload = configDraftRequestPayload({ saveOverride: previewOnly ? false : null });
  const response = await fetchJson(previewOnly ? "/config_draft_preview" : "/config_draft", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.configDraft = response.draft;
  state.configDraftErrors = [];
  state.alignmentPreview = response.draft ? response.draft.alignment || null : null;
  if (response.draft && response.draft.saved_path) {
    state.configDrafts = await fetchJson("/config_drafts");
    state.draftValidations = await fetchJson("/config_draft_validations");
    state.workbenchStatus = await fetchJson("/workbench_status");
    state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  }
  renderConfigBuilder();
  renderWorkbenchRuns();
  renderRunComparison();
  renderWorkbenchStatus();
  renderCleanupPlan();
  $("last-refresh").textContent = previewOnly
    ? `Config draft preview generated: ${new Date().toLocaleString()}`
    : `Config draft generated: ${new Date().toLocaleString()}`;
}

export async function generateConfigDraft(event) {
  event.preventDefault();
  await submitConfigDraft({ previewOnly: false });
}

export async function previewConfigAlignment() {
  const selected = selectedConfigDatasets();
  if (!selected.length) {
    $("config-alignment-note").innerHTML = `<span class="status-bad">Select at least one saved dataset first</span>`;
    $("config-alignment").innerHTML = "";
    return;
  }
  const response = await fetchJson("/data_alignment", {
    method: "POST",
    body: JSON.stringify({
      datasets: selected.map((dataset) => ({ symbol: dataset.symbol, path: dataset.path })),
      ...configDateRangePayload(),
    }),
  });
  state.alignmentPreview = response.alignment || {};
  renderConfigAlignment(state.alignmentPreview);
  renderWorkbenchBuilderAssistant();
  renderConfigBuilderReadiness();
  renderConfigCompatibility();
  renderWorkbenchHome();
  $("last-refresh").textContent = `Alignment preview loaded: ${new Date().toLocaleString()}`;
}

export function dataDetailQuery(path) {
  const params = new URLSearchParams();
  params.set("path", path);
  params.set("preview_points", $("data-detail-points").value || "600");
  params.set("gap_limit", "30");
  params.set("missing_interval_limit", "120");
  params.set("sample_mode", $("data-detail-mode").value || "sampled");
  const start = $("data-detail-start").value;
  const end = $("data-detail-end").value;
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  return params.toString();
}

export function dataDetailCoverageRange(detail = state.dataDetail || {}) {
  const coverage = detail.coverage || {};
  const viewer = detail.viewer || {};
  const start = timestampMillis(coverage.first_timestamp || viewer.first_timestamp);
  const end = timestampMillis(coverage.last_timestamp || viewer.last_timestamp);
  return { start, end };
}

export function largestDataDetailGap(detail = state.dataDetail || {}) {
  const gaps = (detail && detail.gaps) || [];
  const valid = gaps.filter((gap) => gap && gap.from_timestamp && gap.to_timestamp);
  if (!valid.length) return null;
  return valid.slice().sort((left, right) => {
    const rightScore = finiteNumber(right.gap_seconds) ?? finiteNumber(right.estimated_missing_intervals) ?? 0;
    const leftScore = finiteNumber(left.gap_seconds) ?? finiteNumber(left.estimated_missing_intervals) ?? 0;
    return rightScore - leftScore;
  })[0];
}

export async function focusDataDetailLargestGap() {
  const path = state.dataDetailPath || (state.dataDetail && state.dataDetail.path) || "";
  if (!path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Open a saved dataset before focusing a gap</span>`;
    return;
  }
  const gap = largestDataDetailGap();
  if (!gap) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">No returned gaps are available for the current saved file</span>`;
    return;
  }
  const start = dateInputValueFromTimestamp(gap.from_timestamp);
  const end = dateInputValueFromTimestamp(gap.to_timestamp);
  if (!start || !end) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Largest gap timestamps could not be converted to a date range</span>`;
    return;
  }
  $("data-detail-start").value = start;
  $("data-detail-end").value = end;
  $("data-detail-range-preset").value = "custom";
  await loadDataDetail(path);
  $("last-refresh").textContent = `Focused largest gap: ${start} to ${end}`;
}

export async function applyDataDetailRangePreset() {
  const preset = $("data-detail-range-preset").value || "custom";
  if (preset === "custom") return;
  const path = state.dataDetailPath || (state.dataDetail && state.dataDetail.path) || "";
  if (!path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Open a saved dataset before applying a range preset</span>`;
    $("data-detail-range-preset").value = "custom";
    return;
  }
  const range = dataDetailCoverageRange();
  if (range.start === null || range.end === null) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Selected file does not expose a timestamp range for presets</span>`;
    $("data-detail-range-preset").value = "custom";
    return;
  }
  if (preset === "full") {
    $("data-detail-start").value = "";
    $("data-detail-end").value = "";
  } else {
    const days = Number(preset.replace("d", ""));
    if (!Number.isFinite(days) || days <= 0) {
      $("data-detail-range-preset").value = "custom";
      return;
    }
    const oneDay = 24 * 60 * 60 * 1000;
    const startMillis = Math.max(range.start, range.end - Math.max(0, days - 1) * oneDay);
    $("data-detail-start").value = new Date(startMillis).toISOString().slice(0, 10);
    $("data-detail-end").value = new Date(range.end).toISOString().slice(0, 10);
  }
  await loadDataDetail(path);
  $("last-refresh").textContent = `Data detail range preset applied: ${preset}`;
}

export async function loadDataDetail(path, { resetControls = false } = {}) {
  if (!path) throw new Error("dataset path is required");
  state.dataDetailPath = path;
  if (resetControls) {
    $("data-detail-start").value = "";
    $("data-detail-end").value = "";
    $("data-detail-range-preset").value = "custom";
    $("data-detail-points").value = "600";
    $("data-detail-mode").value = "sampled";
  }
  const response = await fetchJson(`/data_detail?${dataDetailQuery(path)}`);
  state.dataDetail = response;
  renderDataDetail();
  if (activeView() === "data") applyDataLens("inspect");
  $("last-refresh").textContent = `Data detail loaded: ${new Date().toLocaleString()}`;
}

export async function loadPerformanceBenchmark() {
  const path = $("performance-benchmark").value || "";
  state.performanceBenchmarkPath = path;
  if (!path) {
    state.performanceBenchmarkDetail = null;
    renderPerformance();
    $("last-refresh").textContent = `Benchmark overlay cleared: ${new Date().toLocaleString()}`;
    return;
  }
  const params = new URLSearchParams();
  params.set("path", path);
  params.set("preview_points", "600");
  params.set("gap_limit", "20");
  params.set("sample_mode", "sampled");
  const response = await fetchJson(`/data_detail?${params.toString()}`);
  state.performanceBenchmarkDetail = response;
  renderPerformance();
  $("last-refresh").textContent = `Benchmark loaded: ${new Date().toLocaleString()}`;
}

export async function reloadDataDetail(event) {
  event.preventDefault();
  const path = state.dataDetailPath || (state.dataDetail && state.dataDetail.path) || "";
  if (!path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Select a saved dataset first</span>`;
    return;
  }
  await loadDataDetail(path);
}

export async function loadDataDetailForSymbol() {
  const symbol = ($("data-detail-symbol").value || "").trim().toUpperCase();
  if (!symbol) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">Enter a scanned symbol first</span>`;
    return;
  }
  const dataset = bestCatalogDatasetForSymbol(symbol);
  if (!dataset || !dataset.path) {
    $("data-detail-viewer-note").innerHTML = `<span class="status-bad">No catalog file found for ${escapeHtml(symbol)}</span>`;
    return;
  }
  await loadDataDetail(dataset.path, { resetControls: true });
  $("data-detail-viewer-note").textContent = `Opened ${text(dataset.symbol)} ${text(dataset.bar_size)} from ${text(dataset.source)}.`;
}

export function dataComparePayload() {
  const selected = selectedCompareDatasets();
  if (selected.length < 2) {
    throw new Error("Select at least two saved datasets first");
  }
  return {
    datasets: selected.map((dataset) => ({ symbol: dataset.symbol, path: dataset.path })),
    preview_points: $("data-compare-points").value || "400",
    sample_mode: $("data-compare-mode").value || "sampled",
    start: $("data-compare-start").value,
    end: $("data-compare-end").value,
  };
}

export async function loadDataCompare(event) {
  if (event) event.preventDefault();
  let payload;
  try {
    payload = dataComparePayload();
  } catch (err) {
    $("data-compare-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    return;
  }
  const response = await fetchJson("/data_compare", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.dataCompare = response.comparison || {};
  renderDataCompare();
  if (activeView() === "data") applyDataLens("compare");
  $("last-refresh").textContent = `Data comparison loaded: ${new Date().toLocaleString()}`;
}

export function copyDataCompareJson() {
  let payload;
  try {
    payload = dataComparePayload();
  } catch (err) {
    $("data-compare-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    return;
  }
  copyText(JSON.stringify(payload, null, 2)).then(() => {
    $("last-refresh").textContent = `Copied comparison JSON for ${numberText(payload.datasets.length, 0)} datasets`;
  }).catch((err) => {
    $("last-refresh").textContent = `Copy failed: ${err.message}`;
  });
}

export async function diagnoseDataSymbol(event) {
  event.preventDefault();
  const symbol = $("data-symbol-input").value.trim();
  if (!symbol) {
    $("data-symbol-diagnostic-status").innerHTML = `<span class="status-bad">Enter a symbol</span>`;
    return;
  }
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const response = await fetchJson(`/data_symbol_diagnostic?symbol=${encodeURIComponent(symbol)}&limit=${catalogLimit}`);
  state.symbolDiagnostic = response;
  renderSymbolDiagnostic();
  renderSymbolVisibilityExplainer();
  if (activeView() === "data") applyDataLens("diagnostics");
  $("last-refresh").textContent = `Symbol diagnostic loaded: ${new Date().toLocaleString()}`;
}

export async function diagnoseSymbolUniverse(event) {
  event.preventDefault();
  const symbols = $("data-symbol-batch-input").value.trim();
  if (!symbols) {
    $("data-symbol-batch-note").innerHTML = `<span class="status-bad">Enter one or more symbols</span>`;
    return;
  }
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const response = await fetchJson(`/data_symbol_diagnostics?symbols=${encodeURIComponent(symbols)}&limit=${catalogLimit}&max_symbols=50`);
  state.symbolBatchDiagnostic = response;
  renderSymbolBatchDiagnostic();
  if (activeView() === "data") applyDataLens("diagnostics");
  $("last-refresh").textContent = `Universe visibility check loaded: ${new Date().toLocaleString()}`;
}

export async function diagnoseBatchSymbol(symbol) {
  const cleaned = text(symbol).trim();
  if (!cleaned) return;
  $("data-symbol-input").value = cleaned;
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const response = await fetchJson(`/data_symbol_diagnostic?symbol=${encodeURIComponent(cleaned)}&limit=${catalogLimit}`);
  state.symbolDiagnostic = response;
  renderSymbolDiagnostic();
  renderSymbolVisibilityExplainer();
  if (activeView() === "data") applyDataLens("diagnostics");
  $("last-refresh").textContent = `Symbol diagnostic loaded from batch: ${cleaned}`;
}

export function batchSymbolDataset(symbol, path) {
  const cleaned = text(symbol).trim().toUpperCase();
  const bestPath = text(path).trim();
  const rows = ((state.symbolBatchDiagnostic || {}).rows || []);
  const row = rows.find((item) => text(item.symbol).toUpperCase() === cleaned && text(item.best_path) === bestPath)
    || rows.find((item) => text(item.symbol).toUpperCase() === cleaned && item.best_path);
  const catalogDataset = (state.dataCatalog.datasets || []).find((item) => item.path === bestPath)
    || (row && (state.dataCatalog.datasets || []).find((item) => item.path === row.best_path));
  if (catalogDataset) return catalogDataset;
  if (!row || !row.best_path) return null;
  return {
    symbol: row.symbol,
    path: row.best_path,
    source: row.best_source,
    bar_size: row.best_bar_size,
    storage_session: row.best_storage_session,
    quality_status: row.best_quality_status,
    storage_contract_status: row.best_storage_contract_status,
    first_timestamp: row.best_first_timestamp,
    last_timestamp: row.best_last_timestamp,
    rows: row.best_rows,
  };
}

export async function inspectBatchSymbolBestFile(symbol, path) {
  const dataset = batchSymbolDataset(symbol, path);
  if (!dataset || !dataset.path) throw new Error(`No best file is available for ${text(symbol) || "selected symbol"}`);
  await loadDataDetail(dataset.path, { resetControls: true });
  $("last-refresh").textContent = `Loaded ${text(dataset.symbol)} best file from universe check`;
}

export function useBatchSymbolInWorkbench(symbol, path) {
  const dataset = batchSymbolDataset(symbol, path);
  if (!dataset || !dataset.path) throw new Error(`No Workbench-ready best file is available for ${text(symbol) || "selected symbol"}`);
  selectCatalogDatasetInWorkbench(dataset);
}

export async function downloadSymbolBatchDiagnosticsCsv() {
  const payloadSymbols = ((state.symbolBatchDiagnostic || {}).symbols || []).join(",");
  const symbols = payloadSymbols || $("data-symbol-batch-input").value.trim();
  if (!symbols) {
    $("data-symbol-batch-note").innerHTML = `<span class="status-bad">Enter one or more symbols</span>`;
    return;
  }
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_symbol_diagnostics_export?symbols=${encodeURIComponent(symbols)}&limit=${catalogLimit}&max_symbols=50`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_symbol_diagnostics.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Universe visibility CSV exported: ${new Date().toLocaleString()}`;
}

export function copySymbolBatchDiagnosticReport() {
  copyText(state.symbolBatchDiagnosticReportText || "No universe visibility check loaded.").then(() => {
    $("last-refresh").textContent = "Universe visibility report copied";
  }).catch((err) => {
    $("last-refresh").textContent = `Universe visibility report copy failed: ${err.message}`;
  });
}

export async function loadFetchManifestDetail(jobId) {
  const response = await fetchJson(`/fetch_manifest_detail?job_id=${encodeURIComponent(jobId)}&limit=500`);
  state.fetchManifestDetail = response;
  renderFetchManifestDetail();
  if (activeView() === "fetch") applyFetchLens("detail");
  $("last-refresh").textContent = `Fetch manifest loaded: ${new Date().toLocaleString()}`;
}

export async function loadRemoteNodeDetail(nodeId) {
  if (!nodeId) throw new Error("node_id is required");
  const response = await fetchJson(`/remote_node_detail?node_id=${encodeURIComponent(nodeId)}&limit=20`);
  state.remoteNodeDetail = response;
  renderRemoteNodeDetail();
  $("last-refresh").textContent = `Remote node detail loaded: ${new Date().toLocaleString()}`;
}

export async function loadConfigArtifacts(draftId, options = {}) {
  const response = await fetchJson(`/config_draft_artifacts?draft_id=${encodeURIComponent(draftId)}&limit=100`);
  state.configArtifacts = response;
  state.performanceSourceMode = "artifact";
  renderWorkbenchArtifacts();
  renderWorkbenchHome();
  renderWorkbenchRunReadiness();
  renderWorkbenchTriage();
  renderWorkbenchRunResult();
  renderPerformance();
  renderOverview();
  if (options.openPerformance) navigateToView("performance");
  else if (activeView() === "workbench") applyWorkbenchLens("artifacts");
  $("last-refresh").textContent = options.openPerformance
    ? `Results opened: ${new Date().toLocaleString()}`
    : `Artifacts loaded: ${new Date().toLocaleString()}`;
}

export async function loadConfigDraftDetail(draftId) {
  const response = await fetchJson(`/config_draft_detail?draft_id=${encodeURIComponent(draftId)}`);
  const draft = response.draft || {};
  state.configDraft = {
    name: draft.name,
    saved_path: draft.path,
    validation: response.validation || { valid: false, errors: [] },
    yaml: response.yaml || "",
    commands: response.commands || {},
    alignment: response.alignment || {},
  };
  state.alignmentPreview = response.alignment || null;
  renderConfigBuilder();
  $("last-refresh").textContent = `Draft detail loaded: ${new Date().toLocaleString()}`;
}

export async function downloadDraftYaml(draftId) {
  if (!draftId) return;
  const body = await fetchText(`/config_draft_yaml?draft_id=${encodeURIComponent(draftId)}`);
  const blob = new Blob([body], { type: "application/x-yaml;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${draftId}.yaml`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Draft YAML downloaded: ${new Date().toLocaleString()}`;
}

export async function deleteConfigDraft(draftId) {
  if (!draftId) return;
  if (!window.confirm(`Delete saved draft ${draftId}?`)) {
    return;
  }
  await fetchJson("/config_draft/delete", {
    method: "POST",
    body: JSON.stringify({
      draft_id: draftId,
      confirm: "delete-draft",
    }),
  });
  state.configDrafts = await fetchJson("/config_drafts");
  state.draftValidations = await fetchJson("/config_draft_validations");
  state.workbenchStatus = await fetchJson("/workbench_status");
  state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  const selected = $("config-run-draft").value;
  if (selected === draftId) {
    state.configDraft = null;
    state.alignmentPreview = null;
    state.configArtifacts = null;
    if (state.performanceSourceMode === "artifact") state.performanceSourceMode = "current";
  }
  renderConfigBuilder();
  renderWorkbenchRuns();
  renderWorkbenchStatus();
  renderCleanupPlan();
  renderWorkbenchArtifacts();
  $("last-refresh").textContent = `Draft deleted: ${new Date().toLocaleString()}`;
}

export async function validateDrafts() {
  state.draftValidations = await fetchJson("/config_draft_validations");
  renderDraftValidations();
  renderWorkbenchRuns();
  renderWorkbenchGuide();
  $("last-refresh").textContent = `Draft validations refreshed: ${new Date().toLocaleString()}`;
}

export async function loadRunArtifacts(runId, options = {}) {
  const response = await fetchJson(`/config_draft_run_artifacts?run_id=${encodeURIComponent(runId)}&limit=100`);
  state.configArtifacts = response;
  state.performanceSourceMode = "artifact";
  renderWorkbenchArtifacts();
  renderWorkbenchHome();
  renderWorkbenchRunReadiness();
  renderWorkbenchTriage();
  renderWorkbenchRunResult();
  renderPerformance();
  renderOverview();
  renderWorkbenchGuide();
  if (options.openPerformance) navigateToView("performance");
  else if (activeView() === "workbench") applyWorkbenchLens("artifacts");
  $("last-refresh").textContent = options.openPerformance
    ? `Run results opened: ${new Date().toLocaleString()}`
    : `Run artifacts loaded: ${new Date().toLocaleString()}`;
}

export async function approveOrderPreview(approvalId) {
  const artifacts = state.configArtifacts || {};
  if (!artifacts.order_preview_file) throw new Error("No order preview file is loaded");
  const preview = (artifacts.order_previews || []).find((item) => text(item.approval_id) === text(approvalId));
  if (!approvalPreviewCanApprove(preview, artifacts)) {
    throw new Error("Selected preview is not approval-required or is missing approval metadata");
  }
  const label = `${text(preview.side)} ${text(preview.symbol)} ${money(preview.estimated_notional)}`;
  if (!window.confirm(`Approve held order preview ${approvalId}?\n\n${label}\n\nThis writes a local approval file only. Review broker/account state before rerunning or continuing the runner.`)) {
    return;
  }
  const response = await fetchJson("/order_preview_approval", {
    method: "POST",
    body: JSON.stringify({
      preview_file: artifacts.order_preview_file,
      approval_id: approvalId,
      approver: "dashboard-operator",
    }),
  });
  preview.approval_status = "approved_file";
  preview.approval_file = (response.approval || {}).approval_file || preview.approval_file;
  preview.approval_file_exists = true;
  renderWorkbenchArtifacts();
  $("last-refresh").textContent = `Approval file written: ${text((response.approval || {}).approval_file)}`;
}

export async function loadCompletedRunOutput(run, draftId, options = {}) {
  const action = text(run && run.action);
  const status = text(run && run.status);
  if (!run || action === "validate" || status !== "completed") {
    return false;
  }
  if (run.run_id && run.artifact_path) {
    await loadRunArtifacts(run.run_id, options);
    return true;
  }
  await loadConfigArtifacts(draftId, options);
  return true;
}

export async function loadRunDetail(runId, options = {}) {
  const response = await fetchJson(`/config_draft_run_evidence?run_id=${encodeURIComponent(runId)}`);
  state.runDetail = response;
  state.runEvidence = response;
  renderRunDetail();
  renderWorkbenchArtifactsActionSummary(state.configArtifacts || {});
  if (options.navigate !== false) {
    navigateToView("workbench");
    applyWorkbenchLens("artifacts");
  }
  $("last-refresh").textContent = `Run log loaded: ${new Date().toLocaleString()}`;
}

export async function runConfigDraft(event = null, options = {}) {
  if (event && typeof event.preventDefault === "function") event.preventDefault();
  const draftId = $("config-run-draft").value;
  if (!draftId) {
    $("config-run-status").innerHTML = `<span class="status-bad">Save a generated draft locally before running.</span>`;
    return;
  }
  $("config-run-status").innerHTML = `<span class="status-warn">running</span>`;
  const response = await fetchJson("/config_draft/run", {
    method: "POST",
    body: JSON.stringify({
      draft_id: draftId,
      action: $("config-run-action").value,
      max_steps: $("config-run-max-steps").value,
      timeout_seconds: $("config-run-timeout").value,
    }),
  });
  const run = response.run || {};
  $("config-run-status").innerHTML = statusText(run.status);
  state.configRuns = await fetchJson("/config_draft_runs?limit=20");
  state.runComparison = await fetchJson("/config_draft_run_comparison?limit=50");
  state.performanceRollups = await fetchJson("/config_draft_daily_rollups?limit=100&run_limit=100");
  state.workbenchStatus = await fetchJson("/workbench_status");
  state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  const loadedArtifacts = await loadCompletedRunOutput(run, draftId, {
    openPerformance: Boolean(options.openPerformance),
  });
  renderWorkbenchRuns();
  renderRunComparison();
  renderPerformanceRollups();
  renderPerformancePeriodRollups();
  renderWorkbenchStatus();
  renderCleanupPlan();
  renderWorkbenchGuide();
  $("last-refresh").textContent = loadedArtifacts
    ? `Config draft run finished and results loaded: ${new Date().toLocaleString()}`
    : `Config draft run finished: ${new Date().toLocaleString()}`;
}

export async function openWorkbenchResultPerformance() {
  const model = workbenchResultModel();
  if (!model.selectedDraftId || !model.latestRun || model.latestRun.action === "validate") {
    $("config-run-status").innerHTML = `<span class="status-warn">Run replay or simulated paper before opening performance.</span>`;
    return;
  }
  if (model.latestRun.artifact_path) {
    await loadRunArtifacts(model.latestRun.run_id, { openPerformance: true });
    return;
  }
  await loadConfigArtifacts(model.selectedDraftId, { openPerformance: true });
}

export async function openWorkbenchResultLog() {
  const model = workbenchResultModel();
  if (!model.latestRun) {
    $("config-run-status").innerHTML = `<span class="status-warn">Run the selected draft before opening a log.</span>`;
    return;
  }
  await loadRunDetail(model.latestRun.run_id);
}

export async function refreshCleanupPlan() {
  state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  state.workbenchStatus = await fetchJson("/workbench_status");
  renderWorkbenchStatus();
  renderCleanupPlan();
  $("last-refresh").textContent = `Cleanup plan refreshed: ${new Date().toLocaleString()}`;
}

export async function runWorkbenchCleanup(dryRun) {
  if (!dryRun && !window.confirm("Delete orphaned workbench archive/output directories?")) {
    return;
  }
  const payload = { dry_run: dryRun };
  if (!dryRun) payload.confirm = "prune-workbench";
  const response = await fetchJson("/workbench_cleanup", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.cleanupPlan = dryRun ? (response.plan || {}) : await fetchJson("/workbench_cleanup_plan");
  state.workbenchStatus = await fetchJson("/workbench_status");
  renderWorkbenchStatus();
  renderCleanupPlan();
  const action = dryRun ? "Cleanup dry run" : `Cleanup deleted ${numberText(response.delete_count || 0, 0)} directories`;
  $("last-refresh").textContent = `${action}: ${new Date().toLocaleString()}`;
}

export async function downloadRunsCsv() {
  const body = await fetchText("/config_draft_runs_export?limit=200");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "workbench_runs.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Run CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadRuntimeSessionsCsv() {
  const body = await fetchText("/runtime_sessions_export?limit=1000");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "runtime_sessions.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Runtime sessions CSV exported: ${new Date().toLocaleString()}`;
}

export async function loadRuntimeSessionDetail(path) {
  if (!path) throw new Error("No runtime session path selected");
  const response = await fetchJson(`/runtime_session_detail?path=${encodeURIComponent(path)}`);
  state.runtimeSessionDetail = response;
  renderRuntimeSessionDetail();
  $("last-refresh").textContent = `Runtime session detail loaded: ${new Date().toLocaleString()}`;
}

export async function downloadDraftsCsv() {
  const body = await fetchText("/config_drafts_export");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "workbench_drafts.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Draft CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadRunArtifactsJson() {
  const runId = state.configArtifacts && state.configArtifacts.run_id;
  if (!runId) {
    $("last-refresh").textContent = "Select archived run artifacts before exporting JSON";
    return;
  }
  const body = await fetchText(`/config_draft_run_artifacts_export?run_id=${encodeURIComponent(runId)}&limit=100`);
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${runId}_artifacts.json`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Run artifacts JSON exported: ${new Date().toLocaleString()}`;
}

export async function downloadRemoteNodesCsv() {
  const body = await fetchText("/remote_nodes_export?limit=500");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "remote_nodes.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Remote nodes CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadRemoteNodeDetailCsv() {
  const detail = state.remoteNodeDetail || {};
  const nodeId = String(detail.node_id || "").trim();
  if (!nodeId) {
    $("last-refresh").textContent = "Select a remote node before exporting detail CSV";
    return;
  }
  const body = await fetchText(`/remote_node_detail_export?node_id=${encodeURIComponent(nodeId)}&limit=100`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const safeNodeId = nodeId.replace(/[^A-Za-z0-9_.-]+/g, "_").replace(/^_+|_+$/g, "") || "remote_node";
  const link = document.createElement("a");
  link.href = url;
  link.download = `remote_node_detail_${safeNodeId}.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Remote node detail CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadStatusRollupsCsv() {
  const body = await fetchText("/status_equity_rollups_export?limit=500&history_limit=50000");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "status_equity_rollups.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Status rollups CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadCommandAuditCsv() {
  const node = $("command-node").value || (state.status && state.status.node_id) || "";
  const nodeParam = node ? `node_id=${encodeURIComponent(node)}&` : "";
  const body = await fetchText(`/command_audit_export?${nodeParam}limit=500`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "command_audit.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Command audit CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataCatalogCsv() {
  const catalogParams = dataCatalogServerQueryParams();
  catalogParams.delete("preview_points");
  const body = await fetchText(`/data_catalog_export?${catalogParams.toString()}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "saved_data_catalog.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Data catalog CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataSymbolDirectoryCsv() {
  const params = dataSymbolDirectoryServerQueryParams();
  const body = await fetchText(`/data_symbol_directory_export?${params.toString()}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_symbol_directory.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Symbol directory CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataSymbolIndexCsv() {
  const params = rootIndexServerQueryParams();
  const body = await fetchText(`/data_symbol_index_export?${params.toString()}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_symbol_index.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Root index CSV exported: ${new Date().toLocaleString()}`;
}

export function downloadSymbolCoverageLedgerCsv() {
  const directory = symbolDirectoryRows();
  const header = [
    "symbol",
    "first_timestamp",
    "last_timestamp",
    "file_count",
    "row_count",
    "asset_classes",
    "sources",
    "bar_sizes",
    "storage_sessions",
    "storage_session_profile",
    "mixed_storage_sessions",
    "quality_counts",
    "storage_contract_counts",
    "best_path",
  ];
  const lines = [
    csvLine(header),
    ...(directory.rows || []).map((item) => csvLine([
      item.symbol,
      item.first_day,
      item.last_day,
      item.file_count,
      item.row_count,
      (item.assets || []).join("|"),
      (item.sources || []).join("|"),
      (item.bars || []).join("|"),
      (item.sessions || []).join("|"),
      item.session_profile,
      item.mixed_sessions ? "true" : "false",
      countSummary(item.qualities),
      countSummary(item.contracts),
      (item.best || {}).path || "",
    ])),
  ];
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "symbol_coverage_ledger.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Symbol coverage ledger CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataHistoryMatrixCsv() {
  const catalogRows = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const activeFilters = dataFilterSummary();
  try {
    const params = dataHistoryMatrixServerQueryParams();
    const body = await fetchText(`/data_history_matrix_export?${params.toString()}`);
    const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "data_history_matrix.csv";
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
    $("last-refresh").textContent = `Saved history matrix CSV exported from server: ${new Date().toLocaleString()}`;
    return;
  } catch (err) {
    $("data-history-matrix-note").innerHTML = `<span class="status-warn">Server matrix export failed, using current browser rows: ${escapeHtml(err.message)}</span>`;
  }
  const useBackendScope = dataHistoryMatrixBackendScopeApplied(state.dataHistoryMatrix || {});
  const rows = useBackendScope ? [] : activeFilters.length ? filteredDataCatalog(catalogRows) : catalogRows;
  const matrix = useBackendScope ? dataHistoryMatrixRows([]) : dataHistoryMatrixRows(rows);
  const header = [
    "asset_class",
    "source",
    "bar_size",
    "storage_session",
    "symbol_count",
    "file_count",
    "row_count",
    "first_date",
    "last_date",
    "latest_modified_age",
    "replay_status",
    "replay_counts",
    "quality_counts",
    "storage_contract_counts",
  ];
  const lines = [
    csvLine(header),
    ...matrix.map((group) => csvLine([
      group.asset,
      group.source,
      group.bar,
      group.session,
      group.symbol_count,
      group.file_count,
      group.row_count,
      group.first_label,
      group.last_label,
      group.latest_label,
      group.status,
      countSummary(group.replay_counts),
      countSummary(group.quality_counts),
      countSummary(group.contract_counts),
    ])),
  ];
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "saved_history_matrix.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Saved history matrix CSV exported from browser rows: ${new Date().toLocaleString()}`;
}

export function downloadWorkbenchSelectedDataCsv() {
  const rows = selectedDataCoverageRows();
  const range = configDateRangePayload();
  const header = [
    "index",
    "symbol",
    "asset_class",
    "source",
    "bar_size",
    "storage_session",
    "source_timezone",
    "adjustment_status",
    "first_timestamp",
    "last_timestamp",
    "rows",
    "quality_status",
    "storage_contract_status",
    "replay_status",
    "replay_detail",
    "workbench_start_date",
    "workbench_end_date",
    "path",
  ];
  const lines = [
    csvLine(header),
    ...rows.map((item) => csvLine([
      item.index,
      item.symbol,
      item.asset,
      item.source,
      item.bar_size,
      item.storage_session,
      item.source_timezone,
      item.adjustment_status,
      item.first_timestamp,
      item.last_timestamp,
      item.rows,
      item.quality_status,
      item.storage_contract_status,
      item.replay_status,
      item.replay_detail,
      range.start,
      range.end,
      item.path,
    ])),
  ];
  const blob = new Blob([`${lines.join("\n")}\n`], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "workbench_selected_data.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Workbench selected data CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadFetchManifestsCsv() {
  const body = await fetchText("/fetch_manifests_export?limit=500");
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "fetch_manifests.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Fetch jobs CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadFetchDetailCsv() {
  const detail = state.fetchManifestDetail || {};
  if (!detail.job_id) {
    $("last-refresh").textContent = "Select a fetch manifest before exporting detail CSV";
    return;
  }
  const jobId = String(detail.job_id);
  const body = await fetchText(`/fetch_manifest_detail_export?job_id=${encodeURIComponent(jobId)}&limit=2000`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${jobId}_fetch_detail.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Fetch detail CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataCatalogScanCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_catalog_scan_export?limit=${catalogLimit}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_catalog_scan.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Catalog scan CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadRootIndexDetailCsv() {
  const detail = state.dataSymbolIndexDetail || {};
  const symbol = text(detail.symbol || "");
  if (!symbol || symbol === "n/a" || !(detail.files || []).length) {
    $("last-refresh").textContent = "Select a Root Index symbol with candidate files before exporting";
    return;
  }
  const params = rootIndexDetailServerQueryParams(symbol);
  const body = await fetchText(`/data_symbol_index_detail_export?${params.toString()}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${symbol}_root_index_files.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Root Index candidate files CSV exported for ${symbol}: ${new Date().toLocaleString()}`;
}

export async function downloadDataStorageAuditCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const storageScanLimit = encodeURIComponent($("data-storage-scan-limit").value || "5000");
  const body = await fetchText(`/data_storage_audit_export?catalog_limit=${catalogLimit}&scan_limit=${storageScanLimit}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_storage_audit.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Storage audit CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataCoverageCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_coverage_export?limit=${catalogLimit}&max_symbols=500&max_dates=366`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_coverage.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Coverage CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataGapSummaryCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_gap_summary_export?catalog_limit=${catalogLimit}&top_limit=100`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_gap_summary.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Gap summary CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataMinuteHeatmapCsv() {
  const catalogLimit = encodeURIComponent(selectedDataCatalogLimit());
  const body = await fetchText(`/data_minute_heatmap_export?catalog_limit=${catalogLimit}&top_limit=100`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_minute_heatmap.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Minute heatmap CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataDetailRangeCsv() {
  const detail = state.dataDetail || {};
  const path = detail.path || state.dataDetailPath || "";
  if (!path) {
    $("last-refresh").textContent = "Open a saved dataset before exporting the Data Detail range";
    return;
  }
  const params = new URLSearchParams();
  params.set("path", path);
  const start = $("data-detail-start").value || "";
  const end = $("data-detail-end").value || "";
  if (start) params.set("start", start);
  if (end) params.set("end", end);
  const body = await fetchText(`/data_detail_export?${params.toString()}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  const symbol = text(detail.symbol || "saved_data").replace(/[^A-Za-z0-9_.-]+/g, "_");
  link.href = url;
  link.download = `${symbol}_data_detail_range.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Data Detail range CSV exported: ${new Date().toLocaleString()}`;
}

export function downloadDataCompareCsv() {
  const comparison = state.dataCompare || {};
  const series = comparison.series || [];
  if (!series.length) {
    $("last-refresh").textContent = "Run a saved-data comparison before exporting CSV";
    return;
  }
  const rows = [[
    "symbol",
    "timestamp",
    "close",
    "normalized_return_pct",
    "total_return_pct",
    "source",
    "bar_size",
    "path",
  ]];
  for (const item of series) {
    for (const point of (item.points || [])) {
      rows.push([
        item.symbol,
        point.timestamp,
        point.close,
        point.normalized_return_pct,
        item.total_return_pct,
        item.source,
        item.bar_size,
        item.path,
      ]);
    }
  }
  const body = `${rows.map(csvLine).join("\n")}\n`;
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "data_compare.csv";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Comparison CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadDataMissingIntervalsCsv() {
  const path = (state.dataDetail || {}).path || "";
  if (!path) {
    $("last-refresh").textContent = "Select a saved dataset before exporting missing intervals";
    return;
  }
  const params = new URLSearchParams();
  params.set("path", path);
  const body = await fetchText(`/data_missing_intervals_export?${params.toString()}`);
  const blob = new Blob([body], { type: "text/csv;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = `${(state.dataDetail.symbol || "data").replace(/[^A-Za-z0-9_.-]+/g, "_")}_missing_intervals.csv`;
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Missing interval CSV exported: ${new Date().toLocaleString()}`;
}

export async function downloadWorkbenchSnapshot() {
  const body = await fetchText("/workbench_snapshot_export");
  const blob = new Blob([body], { type: "application/json;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "workbench_snapshot.json";
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
  $("last-refresh").textContent = `Workbench snapshot exported: ${new Date().toLocaleString()}`;
}

export async function copyText(value) {
  if (navigator.clipboard && navigator.clipboard.writeText) {
    await navigator.clipboard.writeText(value);
    return;
  }
  const textarea = document.createElement("textarea");
  textarea.value = value;
  textarea.setAttribute("readonly", "");
  textarea.style.position = "fixed";
  textarea.style.left = "-9999px";
  document.body.appendChild(textarea);
  textarea.select();
  document.execCommand("copy");
  textarea.remove();
}

export async function queueCommand(event) {
  event.preventDefault();
  const action = $("command-action").value;
  const boundary = commandBoundaries[action] || {};
  if (boundary.confirm && !$("command-confirm").checked) {
    $("command-confirm").focus();
    $("last-refresh").textContent = "Review and confirm the command boundary before queueing this action";
    return;
  }
  const params = {};
  for (const field of commandFields[action] || []) {
    const value = $(`command-${field}`).value.trim();
    if (!value) {
      $(`command-${field}`).focus();
      $("last-refresh").textContent = `${commandParamNames[field]} is required`;
      return;
    }
    params[commandParamNames[field]] = value;
  }
  await fetchJson("/commands", {
    method: "POST",
    body: JSON.stringify({
      node_id: $("command-node").value.trim(),
      action,
      params,
    }),
  });
  await refresh();
}

export async function cancelCommand(commandId, nodeId) {
  await fetchJson("/commands/cancel", {
    method: "POST",
    body: JSON.stringify({
      command_id: commandId,
      node_id: nodeId,
    }),
  });
  await refresh();
}

export function updateCommandFields() {
  const action = $("command-action").value;
  const visible = new Set(commandFields[action] || []);
  for (const field of ["run", "config", "supervisor", "job"]) {
    const label = $(`command-${field}-field`);
    const input = $(`command-${field}`);
    const shown = visible.has(field);
    label.classList.toggle("hidden", !shown);
    input.required = shown;
    input.disabled = !shown;
  }
  const boundary = commandBoundaries[action] || {};
  const confirmField = $("command-confirm-field");
  const confirmInput = $("command-confirm");
  confirmInput.checked = false;
  confirmInput.required = Boolean(boundary.confirm);
  confirmInput.disabled = !boundary.confirm;
  confirmField.classList.toggle("hidden", !boundary.confirm);
  $("command-boundary").innerHTML = `
    <span class="status-${boundary.klass === "read-only" ? "ok" : boundary.klass === "launcher" ? "warn" : "neutral"}">${escapeHtml(boundary.klass || "unknown")}</span>
    <strong>${escapeHtml(boundary.title || action)}</strong>
    <small>${escapeHtml(boundary.note || "No boundary metadata is available for this action.")}</small>
  `;
  renderCommandSafetyReview();
}

export function initToken() {
  $("auth-token").value = token();
  $("save-token").addEventListener("click", () => {
    sessionStorage.setItem("statusToken", $("auth-token").value);
    refresh({ forceData: true, forceDataDiagnostics: shouldLoadDataDiagnostics() }).catch((err) => {
      $("last-refresh").textContent = `Refresh failed: ${err.message}`;
    });
  });
}

export function init() {
  const storedView = sessionStorage.getItem("dashboardView") || "overview";
  setActiveView(window.location.hash ? viewFromHash() : storedView);
  for (const button of document.querySelectorAll("[data-view-target]")) {
    button.addEventListener("click", () => navigateToViewTarget(button.dataset.viewTarget, button.dataset.viewLens || ""));
  }
  // Alert cards render dynamically, so their open-the-fixing-page buttons
  // need delegation rather than the static binding above.
  for (const alertContainerId of ["overview-alerts-body", "alerts-body"]) {
    const container = $(alertContainerId);
    if (!container) continue;
    container.addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement) || !target.dataset.viewTarget) return;
      navigateToViewTarget(target.dataset.viewTarget, target.dataset.viewLens || "");
    });
  }
  const introToggle = $("page-intro-toggle");
  if (introToggle) {
    const applyIntroCollapsed = (collapsed) => {
      $("page-intro").classList.toggle("page-intro-collapsed", collapsed);
      introToggle.textContent = collapsed ? "Show Guide" : "Hide Guide";
      introToggle.setAttribute("aria-expanded", collapsed ? "false" : "true");
    };
    applyIntroCollapsed(localStorage.getItem("pageIntroCollapsed") === "1");
    introToggle.addEventListener("click", () => {
      const collapsed = !$("page-intro").classList.contains("page-intro-collapsed");
      localStorage.setItem("pageIntroCollapsed", collapsed ? "1" : "0");
      applyIntroCollapsed(collapsed);
    });
  }
  $("dashboard-jump-go").addEventListener("click", () => jumpToDashboardTarget($("dashboard-jump").value));
  $("dashboard-jump").addEventListener("change", () => jumpToDashboardTarget($("dashboard-jump").value));
  $("dashboard-task-go").addEventListener("click", () => startDashboardTask($("dashboard-task").value));
  $("dashboard-task").addEventListener("change", () => startDashboardTask($("dashboard-task").value));
  $("check-dashboard-data-apis").addEventListener("click", () => {
    checkDashboardDataApis().catch((err) => {
      $("last-refresh").textContent = `Data API checks failed: ${err.message}`;
    });
  });
  $("data-backend-status-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("[data-data-backend-status-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataBackendStatusAction(target.dataset.dataBackendStatusAction || "");
  });
  $("fetch-backend-status-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("[data-fetch-backend-status-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleFetchBackendStatusAction(target.dataset.fetchBackendStatusAction || "");
  });
  $("copy-dashboard-api-health-report").addEventListener("click", copyDashboardApiHealthReport);
  $("export-dashboard-api-health-csv").addEventListener("click", downloadDashboardApiHealthCsv);
  $("page-route-crumbs").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("[data-route-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleRouteAction(target.dataset.routeAction || "");
  });
  $("page-route-home").addEventListener("click", () => handleRouteAction("page-home"));
  $("page-route-copy").addEventListener("click", () => {
    const link = $("page-route-copy").dataset.routeLink || routeUrl();
    copyText(link).then(() => {
      $("last-refresh").textContent = `Dashboard link copied: ${routeHash()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy dashboard link failed: ${err.message}`;
    });
  });
  for (const button of document.querySelectorAll("[data-overview-lens-target]")) {
    button.addEventListener("click", () => navigateToOverviewLens(button.dataset.overviewLensTarget));
  }
  for (const button of document.querySelectorAll("[data-performance-lens-target]")) {
    button.addEventListener("click", () => navigateToPerformanceLens(button.dataset.performanceLensTarget));
  }
  for (const button of document.querySelectorAll("[data-data-lens-target]")) {
    button.addEventListener("click", () => navigateToDataLens(button.dataset.dataLensTarget));
  }
  for (const button of document.querySelectorAll("[data-fetch-lens-target]")) {
    button.addEventListener("click", () => navigateToFetchLens(button.dataset.fetchLensTarget));
  }
  for (const button of document.querySelectorAll("[data-workbench-lens-target]")) {
    button.addEventListener("click", () => navigateToWorkbenchLens(button.dataset.workbenchLensTarget));
  }
  for (const button of document.querySelectorAll("[data-runs-lens-target]")) {
    button.addEventListener("click", () => navigateToRunsLens(button.dataset.runsLensTarget));
  }
  for (const button of document.querySelectorAll("[data-operations-lens-target]")) {
    button.addEventListener("click", () => navigateToOperationsLens(button.dataset.operationsLensTarget));
  }
  for (const button of document.querySelectorAll("[data-help-lens-target]")) {
    button.addEventListener("click", () => navigateToHelpLens(button.dataset.helpLensTarget));
  }
  window.addEventListener("hashchange", () => setActiveView(viewFromHash()));

  initToken();
  updateCommandFields();
  $("command-action").addEventListener("change", updateCommandFields);
  $("refresh").addEventListener("click", () => {
    refresh({ forceData: true, forceDataDiagnostics: shouldLoadDataDiagnostics() }).catch((err) => {
      $("last-refresh").textContent = `Refresh failed: ${err.message}`;
    });
  });
  $("cleanup-refresh").addEventListener("click", () => {
    refreshCleanupPlan().catch((err) => {
      $("last-refresh").textContent = `Cleanup plan failed: ${err.message}`;
    });
  });
  $("cleanup-dry-run").addEventListener("click", () => {
    runWorkbenchCleanup(true).catch((err) => {
      $("last-refresh").textContent = `Cleanup dry run failed: ${err.message}`;
    });
  });
  $("cleanup-apply").addEventListener("click", () => {
    runWorkbenchCleanup(false).catch((err) => {
      $("last-refresh").textContent = `Cleanup failed: ${err.message}`;
    });
  });
  $("data-filter-text").addEventListener("input", handleDataServerFilterControlChange);
  $("data-filter-quality").addEventListener("change", handleDataServerFilterControlChange);
  $("data-filter-bar").addEventListener("change", handleDataServerFilterControlChange);
  $("data-filter-asset").addEventListener("change", handleDataServerFilterControlChange);
  $("data-filter-source").addEventListener("change", handleDataServerFilterControlChange);
  $("data-filter-session").addEventListener("change", handleDataServerFilterControlChange);
  $("data-filter-contract").addEventListener("change", handleDataServerFilterControlChange);
  $("data-filter-replay").addEventListener("change", handleDataServerFilterControlChange);
  $("data-filter-sort").addEventListener("change", renderDataCatalog);
  $("data-filter-server-search").addEventListener("click", () => {
    runDataCatalogServerSearch("Catalog scan filtered").catch((err) => {
      $("last-refresh").textContent = `Catalog scan search failed: ${err.message}`;
    });
  });
  $("data-filter-clear").addEventListener("click", () => {
    clearDataCatalogFilters();
    setDataCatalogOffset(0);
    refreshDataLibrary({ includeDiagnostics: shouldLoadDataDiagnostics(), force: true }).then(() => {
      $("last-refresh").textContent = "Catalog filters cleared";
    }).catch((err) => {
      $("last-refresh").textContent = `Catalog refresh failed: ${err.message}`;
    });
  });
  $("data-root-index-filter").addEventListener("input", renderRootIndexBrowser);
  $("data-root-index-asset").addEventListener("change", renderRootIndexBrowser);
  $("data-root-index-source").addEventListener("change", renderRootIndexBrowser);
  $("data-root-index-bar").addEventListener("change", renderRootIndexBrowser);
  $("data-root-index-session").addEventListener("change", renderRootIndexBrowser);
  $("data-root-index-sort").addEventListener("change", renderRootIndexBrowser);
  $("data-root-index-limit").addEventListener("change", renderRootIndexBrowser);
  $("data-root-index-clear").addEventListener("click", () => {
    $("data-root-index-filter").value = "";
    $("data-root-index-asset").value = "";
    $("data-root-index-source").value = "";
    $("data-root-index-bar").value = "";
    $("data-root-index-session").value = "";
    $("data-root-index-sort").value = "files_desc";
    $("data-root-index-limit").value = "50";
    renderRootIndexBrowser();
    $("last-refresh").textContent = "Root Index filters cleared";
  });
  $("data-root-index-server-search").addEventListener("click", () => {
    refreshRootIndexFromServerFilters().catch((err) => {
      state.dataSymbolIndex = { symbols: [], files: [], errors: [{ error: err.message }], index_error: err.message };
      renderRootIndexBrowser();
      $("last-refresh").textContent = `Root Index server search failed: ${err.message}`;
    });
  });
  $("data-root-index-body").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest(".root-index-show-files, .root-index-inspect-sample, .root-index-search-catalog, .root-index-diagnose, .root-index-copy-paths")
      : null;
    if (!(target instanceof HTMLElement)) return;
    handleRootIndexBrowserAction(target).catch((err) => {
      $("data-root-index-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-root-index-detail-body").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest(".root-index-detail-inspect, .root-index-detail-workbench, .root-index-detail-search, .root-index-detail-copy")
      : null;
    if (!(target instanceof HTMLElement)) return;
    handleRootIndexDetailAction(target).catch((err) => {
      $("data-root-index-detail-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("export-data-root-index-detail-csv").addEventListener("click", () => {
    downloadRootIndexDetailCsv().catch((err) => {
      $("data-root-index-detail-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-home-clear-filters").addEventListener("click", () => {
    clearDataCatalogFilters();
    renderDataCatalog();
    $("last-refresh").textContent = "Data Library filters cleared";
  });
  $("data-facet-clear").addEventListener("click", () => {
    clearDataCatalogFilters();
    renderDataCatalog();
    $("last-refresh").textContent = "Data Library browse filters cleared";
  });
  $("data-home-inspect-top").addEventListener("click", () => {
    const match = filteredDataCatalog(state.dataCatalog.datasets || []).find((dataset) => dataset.path);
    if (!match) {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">No matching dataset to inspect</span>`;
      return;
    }
    loadDataDetail(match.path, { resetControls: true }).catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-home-open-workbench").addEventListener("click", () => navigateToWorkbenchLens("home"));
  $("data-home-open-fetch").addEventListener("click", () => navigateToView("fetch"));
  $("overview-open-source").addEventListener("click", openOverviewSourceDetail);
  $("overview-health-report-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-overview-health-report-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleOverviewHealthReportAction(target.dataset.overviewHealthReportAction || "");
  });
  $("help-task-navigator-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-help-task-navigator-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleHelpTaskNavigatorAction(target.dataset.helpTaskNavigatorAction || "");
  });
  $("help-performance-guide-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-help-performance-guide-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleHelpPerformanceGuideAction(target.dataset.helpPerformanceGuideAction || "");
  });
  $("help-mode-boundary-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-help-mode-boundary-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleHelpModeBoundaryAction(target.dataset.helpModeBoundaryAction || "");
  });
  $("help-cloud-access-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-help-cloud-access-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleHelpCloudAccessAction(target.dataset.helpCloudAccessAction || "");
  });
  $("help-publication-review-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-publication-review-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handlePublicationReviewAction(target.dataset.publicationReviewAction || "");
  });
  $("data-home-shortlist").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-home-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataHomeShortlistAction(target).catch((err) => {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-preview-wall").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-home-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataHomeShortlistAction(target).catch((err) => {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-universe-symbols").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-home-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataHomeShortlistAction(target).catch((err) => {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-root-index-spotlight-symbols").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-root-spotlight-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleRootIndexSpotlightAction(target);
  });
  $("data-root-index-spotlight-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-root-spotlight-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleRootIndexSpotlightAction(target);
  });
  $("data-search-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-home-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataHomeShortlistAction(target).catch((err) => {
      $("data-catalog-errors").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-explorer-groups").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-data-explorer-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataExplorerAction(target);
  });
  $("data-history-matrix-body").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".data-history-matrix-action") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataHistoryMatrixAction(target).catch((err) => {
      $("data-history-matrix-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-source-map").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-source-map-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleDataSourceMapAction(target);
  });
  $("data-scope-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-data-scope-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleDataScopeAssistantAction(target.dataset.dataScopeAction || "");
  });
  $("data-visibility-report-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-data-visibility-report-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleDataVisibilityReportAction(target.dataset.dataVisibilityReportAction || "");
  });
  $("data-inventory-evidence-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-data-inventory-evidence-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleDataInventoryEvidenceAction(target.dataset.dataInventoryEvidenceAction || "");
  });
  $("data-catalog-scan-report-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-catalog-scan-report-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleDataCatalogScanReportAction(target.dataset.catalogScanReportAction || "");
  });
  $("data-storage-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-data-storage-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleDataStorageAssistantAction(button.dataset.dataStorageAction || "");
  });
  $("data-coverage-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-data-coverage-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleDataCoverageAssistantAction(button.dataset.dataCoverageAction || "");
  });
  for (const button of document.querySelectorAll("[data-workbench-home-action]")) {
    button.addEventListener("click", () => {
      handleWorkbenchHomeAction(button.dataset.workbenchHomeAction || "");
    });
  }
  $("workbench-backend-status-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("[data-workbench-backend-status-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleWorkbenchBackendStatusAction(target.dataset.workbenchBackendStatusAction || "");
  });
  $("workbench-example-gallery-cards").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-workbench-example-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleWorkbenchExampleGalleryAction(target);
  });
  $("workbench-evidence-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-workbench-evidence-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleWorkbenchEvidenceAction(target.dataset.workbenchEvidenceAction || "");
  });
  for (const button of document.querySelectorAll("[data-operations-home-action]")) {
    button.addEventListener("click", () => {
      handleOperationsHomeAction(button.dataset.operationsHomeAction || "");
    });
  }
  $("operations-evidence-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-operations-evidence-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleOperationsEvidenceAction(target.dataset.operationsEvidenceAction || "");
  });
  $("paper-action-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-paper-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handlePaperAction(target.dataset.paperAction || "guide");
  });
  $("control-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-control-assistant-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleControlAssistantAction(target.dataset.controlAssistantAction || "");
  });
  $("supervisor-action-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-supervisor-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleSupervisorAction(target.dataset.supervisorAction || "");
  });
  $("command-safety-review-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-command-safety-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleCommandSafetyAction(target.dataset.commandSafetyAction || "");
  });
  $("copy-data-roots-yaml").addEventListener("click", copyDataRootsYaml);
  $("fetch-filter-text").addEventListener("input", renderFetchJobs);
  $("fetch-filter-status").addEventListener("change", renderFetchJobs);
  $("fetch-filter-kind").addEventListener("change", renderFetchJobs);
  $("fetch-filter-sort").addEventListener("change", renderFetchJobs);
  $("fetch-search-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-fetch-search-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleFetchSearchAction(target);
  });
  $("fetch-progress-review-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-fetch-progress-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleFetchProgressAction(target.dataset.fetchProgressAction || "");
  });
  $("fetch-evidence-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-fetch-evidence-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleFetchEvidenceAction(target.dataset.fetchEvidenceAction || "", target);
  });
  $("copy-fetch-roots-yaml").addEventListener("click", copyFetchManifestRootsYaml);
  $("export-fetch-manifests-csv").addEventListener("click", () => {
    downloadFetchManifestsCsv().catch((err) => {
      $("last-refresh").textContent = `Fetch jobs CSV export failed: ${err.message}`;
    });
  });
  $("remote-filter-text").addEventListener("input", renderRemoteNodes);
  $("remote-filter-status").addEventListener("change", renderRemoteNodes);
  $("remote-filter-mode").addEventListener("change", renderRemoteNodes);
  $("remote-filter-sort").addEventListener("change", renderRemoteNodes);
  $("remote-action-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-remote-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleRemoteAction(target.dataset.remoteAction || "");
  });
  $("remote-nodes-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-remote-nodes-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleRemoteNodesAssistantAction(target.dataset.remoteNodesAction || "");
  });
  $("remote-report-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-remote-report-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleRemoteReportAction(target.dataset.remoteReportAction || "");
  });
  $("cloud-readiness-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-cloud-readiness-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleCloudReadinessAction(target.dataset.cloudReadinessAction || "");
  });
  $("remote-detail-activity-filter").addEventListener("change", renderRemoteNodeDetail);
  $("remote-detail-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-remote-detail-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleRemoteDetailAssistantAction(button.dataset.remoteDetailAction || "");
  });
  $("remote-node-health-report-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-remote-node-health-report-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleRemoteNodeHealthReportAction(target.dataset.remoteNodeHealthReportAction || "");
  });
  $("runs-filter-text").addEventListener("input", renderRuns);
  $("runs-filter-status").addEventListener("change", renderRuns);
  $("runs-filter-mode").addEventListener("change", renderRuns);
  $("runs-filter-sort").addEventListener("change", renderRuns);
  $("runs-search-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-runs-search-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleRunsSearchAction(target);
  });
  $("runs-evidence-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-runs-evidence-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleRunsEvidenceAction(target.dataset.runsEvidenceAction || "");
  });
  $("runs-state-action-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-runs-state-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleRunsStateAction(target.dataset.runsStateAction || "");
  });
  $("run-events-filter-text").addEventListener("input", renderRunEvents);
  $("run-events-filter-type").addEventListener("change", renderRunEvents);
  $("run-events-filter-status").addEventListener("change", renderRunEvents);
  $("run-events-filter-sort").addEventListener("change", renderRunEvents);
  $("runs-events-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-runs-events-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    applyRunsEventsAssistantAction(button.dataset.runsEventsAction || "", button.dataset.runId || "");
  });
  $("runs-event-flow-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-runs-event-flow-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleRunsEventFlowAction(target);
  });
  $("execution-quality-review-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-execution-quality-action]") : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleExecutionQualityAction(target.dataset.executionQualityAction || "");
  });
  for (const id of ["config-dataset", "config-start-date", "config-end-date"]) {
    if ($(id)) $(id).addEventListener("change", renderConfigLivePanels);
  }
  $("config-data-open-detail").addEventListener("click", () => {
    openFirstConfigDatasetDetail().catch((err) => {
      $("config-data-actions-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-data-compare-selected").addEventListener("click", () => {
    compareConfigDatasets().catch((err) => {
      $("config-data-actions-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-data-open-library").addEventListener("click", () => navigateToView("data"));
  $("workbench-selected-data-list").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest("[data-workbench-selected-data-action]")
      : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleWorkbenchSelectedDataAction(target);
  });
  $("workbench-selected-coverage-body").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest("[data-workbench-selected-data-action]")
      : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleWorkbenchSelectedDataAction(target);
  });
  $("config-run-draft").addEventListener("change", () => {
    renderWorkbenchHome();
    renderWorkbenchGuide();
    renderWorkbenchTriage();
    renderWorkbenchRunResult();
    renderWorkbenchRunCommands();
    renderWorkbenchDraftInventory();
    renderConfigCompatibility();
    renderHelpWorkbenchQuickstart();
  });
  onOptional("config-plugin", "change", () => {
    renderConfigLivePanels();
  });
  $("data-detail-timezone").addEventListener("change", renderDataDetail);
  $("data-detail-chart-style").addEventListener("change", renderDataDetail);
  $("data-detail-range-preset").addEventListener("change", () => {
    applyDataDetailRangePreset().catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-start").addEventListener("input", () => {
    $("data-detail-range-preset").value = "custom";
  });
  $("data-detail-end").addEventListener("input", () => {
    $("data-detail-range-preset").value = "custom";
  });
  $("data-detail-symbol-load").addEventListener("click", () => {
    loadDataDetailForSymbol().catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-prev").addEventListener("click", () => {
    openAdjacentDataDetail(-1).catch((err) => {
      $("data-detail-nav-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-next").addEventListener("click", () => {
    openAdjacentDataDetail(1).catch((err) => {
      $("data-detail-nav-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-focus-gap").addEventListener("click", () => {
    focusDataDetailLargestGap().catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-action-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest("button[data-data-detail-action]")
      : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleDataDetailAction(target.dataset.dataDetailAction || "").catch((err) => {
      $("data-detail-action-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-data-detail-assistant-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleDataDetailAssistantAction(button.dataset.dataDetailAssistantAction || "").catch((err) => {
      $("data-detail-assistant-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-symbol").addEventListener("keydown", (event) => {
    if (event.key !== "Enter") return;
    event.preventDefault();
    loadDataDetailForSymbol().catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-symbol").addEventListener("input", () => {
    renderDataDetailActionSummary(state.dataDetail || {}, $("data-detail-timezone").value || "utc");
  });
  $("data-compare-timezone").addEventListener("change", renderDataCompare);
  $("data-compare-filter").addEventListener("input", renderDataCompareControls);
  $("data-compare-asset").addEventListener("change", renderDataCompareControls);
  $("data-compare-source").addEventListener("change", renderDataCompareControls);
  $("data-compare-bar").addEventListener("change", renderDataCompareControls);
  $("data-compare-session").addEventListener("change", renderDataCompareControls);
  $("data-compare-quality").addEventListener("change", renderDataCompareControls);
  $("data-compare-contract").addEventListener("change", renderDataCompareControls);
  $("data-compare-datasets").addEventListener("change", () => updateCompareSelectionFromSelect(true));
  $("data-compare-range-preset").addEventListener("change", () => {
    applyDataCompareRangePreset().catch((err) => {
      $("data-compare-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-compare-start").addEventListener("input", () => {
    $("data-compare-range-preset").value = "custom";
  });
  $("data-compare-end").addEventListener("input", () => {
    $("data-compare-range-preset").value = "custom";
  });
  $("data-compare-select-symbol").addEventListener("click", selectSymbolCompareDatasets);
  $("data-compare-select-shown").addEventListener("click", selectShownCompareDatasets);
  $("data-compare-clear").addEventListener("click", clearCompareSelection);
  $("data-compare-action-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest("button[data-data-compare-action]")
      : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleDataCompareAction(target.dataset.dataCompareAction || "").catch((err) => {
      $("data-compare-action-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-compare-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-data-compare-assistant-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleDataCompareAssistantAction(button.dataset.dataCompareAssistantAction || "").catch((err) => {
      $("data-compare-assistant-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-catalog-limit").addEventListener("change", () => {
    dataLibraryLoadState().catalogLimitTouched = true;
    setDataCatalogOffset(0);
    refreshDataLibrary({ includeDiagnostics: shouldLoadDataDiagnostics(), force: true }).catch((err) => {
      $("last-refresh").textContent = `Catalog refresh failed: ${err.message}`;
    });
  });
  $("data-catalog-prev-page").addEventListener("click", () => {
    const catalog = state.dataCatalog || {};
    setDataCatalogOffset(catalog.previous_offset ?? Math.max(0, selectedDataCatalogOffset() - Number(selectedDataCatalogLimit() || 0)));
    refreshDataLibrary({ includeDiagnostics: shouldLoadDataDiagnostics(), force: true }).catch((err) => {
      $("last-refresh").textContent = `Catalog page load failed: ${err.message}`;
    });
  });
  $("data-catalog-next-page").addEventListener("click", () => {
    const catalog = state.dataCatalog || {};
    setDataCatalogOffset(catalog.next_offset ?? (selectedDataCatalogOffset() + Number(selectedDataCatalogLimit() || 0)));
    refreshDataLibrary({ includeDiagnostics: shouldLoadDataDiagnostics(), force: true }).catch((err) => {
      $("last-refresh").textContent = `Catalog page load failed: ${err.message}`;
    });
  });
  $("data-storage-scan-limit").addEventListener("change", () => {
    refreshDataDiagnostics({ force: true }).catch((err) => {
      $("last-refresh").textContent = `Storage audit refresh failed: ${err.message}`;
    });
  });
  $("data-symbol-browser-input").addEventListener("input", () => {
    state.symbolTypeaheadActiveIndex = 0;
    renderSymbolBrowser();
  });
  $("data-symbol-browser-dataset").addEventListener("change", () => {
    renderSymbolSelectionPanel(selectedSymbolBrowserSymbol());
    renderSymbolProfile(selectedSymbolBrowserSymbol());
  });
  for (const id of ["data-symbol-browser-source", "data-symbol-browser-bar", "data-symbol-browser-session", "data-symbol-browser-quality", "data-symbol-browser-contract"]) {
    $(id).addEventListener("change", () => {
      state.symbolTypeaheadActiveIndex = 0;
      renderSymbolBrowser();
    });
  }
  $("data-symbol-browser-clear-facets").addEventListener("click", () => {
    $("data-symbol-browser-source").value = "";
    $("data-symbol-browser-bar").value = "";
    $("data-symbol-browser-session").value = "";
    $("data-symbol-browser-quality").value = "";
    $("data-symbol-browser-contract").value = "";
    state.symbolTypeaheadActiveIndex = 0;
    renderSymbolBrowser();
    $("last-refresh").textContent = "Symbol Browser facets cleared";
  });
  $("data-symbol-browser-input").addEventListener("keydown", (event) => {
    if (event.key === "ArrowDown" || event.key === "ArrowUp") {
      event.preventDefault();
      const symbol = moveSymbolTypeaheadSelection(event.key === "ArrowDown" ? 1 : -1);
      if (symbol) $("last-refresh").textContent = `Highlighted ${symbol} in Symbol Browser`;
      return;
    }
    if (event.key === "Escape") {
      state.symbolTypeaheadActiveIndex = 0;
      $("data-symbol-browser-input").blur();
      return;
    }
    if (event.key !== "Enter") return;
    const symbol = selectedSymbolBrowserDatasets().length
      ? selectedSymbolBrowserSymbol()
      : activeSymbolTypeaheadSuggestion() || topSymbolBrowserSuggestion();
    if (!symbol) return;
    event.preventDefault();
    selectSymbolBrowserSymbol(symbol);
    $("last-refresh").textContent = `Selected ${symbol} in Symbol Browser`;
  });
  $("data-symbol-typeahead").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".symbol-typeahead-option") : null;
    if (!(target instanceof HTMLElement)) return;
    const symbol = String(target.dataset.symbol || "");
    selectSymbolBrowserSymbol(symbol);
    $("last-refresh").textContent = `Selected ${symbol} in Symbol Browser`;
  });
  $("data-symbol-quick-picks").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".symbol-quick-pick") : null;
    if (!(target instanceof HTMLElement)) return;
    const symbol = String(target.dataset.symbol || "");
    selectSymbolBrowserSymbol(symbol);
    $("last-refresh").textContent = `Selected ${symbol} in Symbol Browser`;
  });
  $("data-symbol-directory-filter").addEventListener("input", renderSymbolDirectory);
  $("data-symbol-directory-asset").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-source").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-bar").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-session").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-quality").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-contract").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-sort").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-limit").addEventListener("change", renderSymbolDirectory);
  $("data-symbol-directory-clear").addEventListener("click", () => {
    $("data-symbol-directory-filter").value = "";
    $("data-symbol-directory-asset").value = "";
    $("data-symbol-directory-source").value = "";
    $("data-symbol-directory-bar").value = "";
    $("data-symbol-directory-session").value = "";
    $("data-symbol-directory-quality").value = "";
    $("data-symbol-directory-contract").value = "";
    $("data-symbol-directory-sort").value = "files_desc";
    $("data-symbol-directory-limit").value = "60";
    renderSymbolDirectory();
  });
  $("data-symbol-browser-filter").addEventListener("click", () => {
    const symbol = selectedSymbolBrowserSymbol();
    $("data-filter-text").value = symbol;
    state.manifestPathFilter = null;
    previewDataCatalogServerFilters(symbol ? `Catalog filtered to ${symbol}` : "Catalog symbol filter cleared");
  });
  $("data-symbol-browser-inspect").addEventListener("click", () => {
    inspectSelectedSymbol().catch((err) => {
      $("data-symbol-browser-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-browser-compare").addEventListener("click", () => {
    compareSelectedSymbolDatasets().catch((err) => {
      $("data-symbol-browser-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-browser-diagnose").addEventListener("click", () => {
    diagnoseSelectedSymbol().catch((err) => {
      $("data-symbol-browser-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-visibility-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-symbol-visibility-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleSymbolVisibilityAction(target.dataset.symbolVisibilityAction || "").catch((err) => {
      $("data-symbol-visibility-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  for (const [id, action] of [
    ["data-symbol-selection-filter", "filter"],
    ["data-symbol-selection-inspect", "inspect"],
    ["data-symbol-selection-workbench", "workbench"],
    ["data-symbol-selection-compare", "compare"],
    ["data-symbol-selection-diagnose", "diagnose"],
  ]) {
    $(id).addEventListener("click", () => {
      handleSymbolSelectionAction(action).catch((err) => {
        $("data-symbol-selection-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
      });
    });
  }
  for (const id of [
    "data-symbol-profile-inspect",
    "data-symbol-profile-workbench",
    "data-symbol-profile-compare",
    "data-symbol-profile-filter",
    "data-symbol-profile-diagnose",
  ]) {
    $(id).addEventListener("click", (event) => {
      handleSymbolProfileAction(event.currentTarget).catch((err) => {
        $("data-symbol-profile-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
      });
    });
  }
  $("config-preview-alignment").addEventListener("click", () => {
    previewConfigAlignment().catch((err) => {
      $("config-alignment-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("export-runs-csv").addEventListener("click", () => {
    downloadRunsCsv().catch((err) => {
      $("last-refresh").textContent = `Run CSV export failed: ${err.message}`;
    });
  });
  $("export-runtime-sessions-csv").addEventListener("click", () => {
    downloadRuntimeSessionsCsv().catch((err) => {
      $("last-refresh").textContent = `Runtime sessions CSV export failed: ${err.message}`;
    });
  });
  $("runtime-sessions-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("inspect-runtime-session")) return;
    loadRuntimeSessionDetail(target.dataset.sessionPath || "").catch((err) => {
      $("runtime-session-detail-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("export-drafts-csv").addEventListener("click", () => {
    downloadDraftsCsv().catch((err) => {
      $("last-refresh").textContent = `Draft CSV export failed: ${err.message}`;
    });
  });
  $("export-run-artifacts-json").addEventListener("click", () => {
    downloadRunArtifactsJson().catch((err) => {
      $("last-refresh").textContent = `Run artifact JSON export failed: ${err.message}`;
    });
  });
  $("export-remote-nodes-csv").addEventListener("click", () => {
    downloadRemoteNodesCsv().catch((err) => {
      $("last-refresh").textContent = `Remote nodes CSV export failed: ${err.message}`;
    });
  });
  $("export-remote-node-detail-csv").addEventListener("click", () => {
    downloadRemoteNodeDetailCsv().catch((err) => {
      $("last-refresh").textContent = `Remote node detail CSV export failed: ${err.message}`;
    });
  });
  $("export-status-rollups-csv").addEventListener("click", () => {
    downloadStatusRollupsCsv().catch((err) => {
      $("last-refresh").textContent = `Status rollups CSV export failed: ${err.message}`;
    });
  });
  $("export-command-audit-csv").addEventListener("click", () => {
    downloadCommandAuditCsv().catch((err) => {
      $("last-refresh").textContent = `Command audit CSV export failed: ${err.message}`;
    });
  });
  $("export-data-catalog-csv").addEventListener("click", () => {
    downloadDataCatalogCsv().catch((err) => {
      $("last-refresh").textContent = `Data catalog CSV export failed: ${err.message}`;
    });
  });
  $("export-data-symbol-directory-csv").addEventListener("click", () => {
    downloadDataSymbolDirectoryCsv().catch((err) => {
      $("last-refresh").textContent = `Symbol directory CSV export failed: ${err.message}`;
    });
  });
  $("export-data-symbol-index-csv").addEventListener("click", () => {
    downloadDataSymbolIndexCsv().catch((err) => {
      $("last-refresh").textContent = `Root index CSV export failed: ${err.message}`;
    });
  });
  $("export-symbol-coverage-ledger-csv").addEventListener("click", downloadSymbolCoverageLedgerCsv);
  $("export-data-history-matrix-csv").addEventListener("click", () => {
    downloadDataHistoryMatrixCsv().catch((err) => {
      $("last-refresh").textContent = `Saved history matrix CSV export failed: ${err.message}`;
    });
  });
  $("export-workbench-selected-data-csv").addEventListener("click", downloadWorkbenchSelectedDataCsv);
  $("export-data-catalog-scan-csv").addEventListener("click", () => {
    downloadDataCatalogScanCsv().catch((err) => {
      $("last-refresh").textContent = `Catalog scan CSV export failed: ${err.message}`;
    });
  });
  $("export-data-storage-audit-csv").addEventListener("click", () => {
    downloadDataStorageAuditCsv().catch((err) => {
      $("last-refresh").textContent = `Storage audit CSV export failed: ${err.message}`;
    });
  });
  $("export-data-coverage-csv").addEventListener("click", () => {
    downloadDataCoverageCsv().catch((err) => {
      $("last-refresh").textContent = `Coverage CSV export failed: ${err.message}`;
    });
  });
  $("export-data-gap-summary-csv").addEventListener("click", () => {
    downloadDataGapSummaryCsv().catch((err) => {
      $("last-refresh").textContent = `Gap summary CSV export failed: ${err.message}`;
    });
  });
  $("export-data-minute-heatmap-csv").addEventListener("click", () => {
    downloadDataMinuteHeatmapCsv().catch((err) => {
      $("last-refresh").textContent = `Minute heatmap CSV export failed: ${err.message}`;
    });
  });
  $("copy-data-compare-json").addEventListener("click", copyDataCompareJson);
  $("use-data-compare-workbench").addEventListener("click", useDataCompareInWorkbench);
  $("export-data-compare-csv").addEventListener("click", downloadDataCompareCsv);
  $("export-workbench-snapshot").addEventListener("click", () => {
    downloadWorkbenchSnapshot().catch((err) => {
      $("last-refresh").textContent = `Workbench snapshot export failed: ${err.message}`;
    });
  });
  $("validate-drafts").addEventListener("click", () => {
    validateDrafts().catch((err) => {
      $("last-refresh").textContent = `Draft validation failed: ${err.message}`;
    });
  });
  $("comparison-filter-status").addEventListener("change", renderRunComparison);
  $("comparison-filter-action").addEventListener("change", renderRunComparison);
  $("comparison-filter-mode").addEventListener("change", renderRunComparison);
  $("comparison-filter-summary").addEventListener("change", renderRunComparison);
  $("comparison-filter-text").addEventListener("input", renderRunComparison);
  $("comparison-sort").addEventListener("change", renderRunComparison);
  $("performance-source-mode").addEventListener("change", () => {
    state.performanceSourceMode = $("performance-source-mode").value || "current";
    renderPerformance();
    renderOverview();
  });
  $("performance-home-open-runs").addEventListener("click", () => navigateToRunsLens("runs"));
  $("performance-home-open-workbench").addEventListener("click", () => navigateToWorkbenchLens("home"));
  $("performance-home-open-data").addEventListener("click", () => navigateToView("data"));
  $("performance-period").addEventListener("change", renderPerformance);
  $("performance-telemetry-run").addEventListener("change", () => {
    state.performanceTelemetryRunId = $("performance-telemetry-run").value || "";
    reloadTelemetryArtifacts().catch((err) => {
      $("last-refresh").textContent = `Telemetry artifact reload failed: ${err.message}`;
    });
  });
  $("performance-status-rollups-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("rollup-day-focus")) return;
    focusPerformanceDay(target.dataset.day || "");
  });
  $("performance-trade-filter-state").addEventListener("change", renderPerformance);
  $("performance-trade-filter-side").addEventListener("change", renderPerformance);
  $("performance-trade-filter-symbol").addEventListener("input", renderPerformance);
  $("performance-action-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceAction(target.dataset.performanceAction || "");
  });
  $("performance-trade-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-trade-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceTradeAssistantAction(target.dataset.performanceTradeAction || "");
  });
  $("performance-rollup-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-rollup-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceRollupAssistantAction(target.dataset.performanceRollupAction || "");
  });
  $("performance-rollup-continuity-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-rollup-continuity-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceRollupContinuityAction(target.dataset.performanceRollupContinuityAction || "");
  });
  $("performance-snapshot-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-snapshot-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceSnapshotAction(target.dataset.performanceSnapshotAction || "");
  });
  $("performance-evidence-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-evidence-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceEvidenceAction(target.dataset.performanceEvidenceAction || "");
  });
  $("performance-report-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-performance-report-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handlePerformanceReportAction(target.dataset.performanceReportAction || "");
  });
  $("performance-benchmark").addEventListener("change", () => {
    state.performanceBenchmarkPath = $("performance-benchmark").value || "";
    if (!state.performanceBenchmarkPath) {
      state.performanceBenchmarkDetail = null;
      renderPerformance();
    }
  });
  $("performance-load-benchmark").addEventListener("click", () => {
    loadPerformanceBenchmark().catch((err) => {
      $("performance-benchmark-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
      $("last-refresh").textContent = `Benchmark load failed: ${err.message}`;
    });
  });
  $("command-form").addEventListener("submit", (event) => {
    queueCommand(event).catch((err) => {
      $("last-refresh").textContent = `Command failed: ${err.message}`;
    });
  });
  $("config-form").addEventListener("submit", (event) => {
    generateConfigDraft(event).catch((err) => {
      handleConfigDraftError(err);
    });
  });
  $("config-preview-draft").addEventListener("click", () => {
    submitConfigDraft({ previewOnly: true }).catch((err) => {
      handleConfigDraftError(err);
    });
  });
  $("config-form").addEventListener("input", renderConfigLivePanels);
  $("config-form").addEventListener("change", (event) => {
    if (event.target instanceof HTMLElement && event.target.id === "config-risk-preset") {
      applyRiskPreset();
    }
    renderConfigLivePanels();
  });
  $("workbench-guide").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".workbench-guide-action") : null;
    if (!(target instanceof HTMLElement)) return;
    activateWorkbenchGuideAction(target);
  });
  $("workbench-stepper").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".workbench-guide-action") : null;
    if (!(target instanceof HTMLElement)) return;
    activateWorkbenchGuideAction(target);
  });
  $("data-symbol-diagnostic-form").addEventListener("submit", (event) => {
    diagnoseDataSymbol(event).catch((err) => {
      $("data-symbol-diagnostic-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-batch-form").addEventListener("submit", (event) => {
    diagnoseSymbolUniverse(event).catch((err) => {
      $("data-symbol-batch-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("copy-symbol-diagnostic-report").addEventListener("click", copySymbolDiagnosticReport);
  $("export-data-symbol-batch-csv").addEventListener("click", () => {
    downloadSymbolBatchDiagnosticsCsv().catch((err) => {
      $("data-symbol-batch-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("copy-symbol-batch-report").addEventListener("click", copySymbolBatchDiagnosticReport);
  $("data-symbol-batch-body").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest(".inspect-batch-symbol, .workbench-batch-symbol, .diagnose-batch-symbol")
      : null;
    if (!(target instanceof HTMLElement)) return;
    const symbol = target.dataset.symbol || "";
    const path = target.dataset.path || "";
    let action;
    if (target.classList.contains("inspect-batch-symbol")) {
      action = inspectBatchSymbolBestFile(symbol, path);
    } else if (target.classList.contains("workbench-batch-symbol")) {
      action = Promise.resolve().then(() => useBatchSymbolInWorkbench(symbol, path));
    } else {
      action = diagnoseBatchSymbol(symbol);
    }
    action.catch((err) => {
      $("data-symbol-diagnostic-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-detail-form").addEventListener("submit", (event) => {
    reloadDataDetail(event).catch((err) => {
      $("data-detail-viewer-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-compare-form").addEventListener("submit", (event) => {
    loadDataCompare(event).catch((err) => {
      $("data-compare-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-run-form").addEventListener("submit", (event) => {
    runConfigDraft(event).catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-run-form").addEventListener("input", renderWorkbenchRunReadiness);
  $("config-run-form").addEventListener("change", () => {
    renderWorkbenchRunReadiness();
    renderWorkbenchRunCommands();
    renderWorkbenchTriage();
    renderWorkbenchRunResult();
  });
  $("workbench-run-readiness-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".workbench-run-readiness-action") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleWorkbenchRunReadinessAction(target.dataset.runReadinessAction || "");
  });
  $("workbench-draft-inventory-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-draft-inventory-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleWorkbenchDraftInventoryAction(target.dataset.draftInventoryAction || "");
  });
  $("workbench-builder-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-workbench-builder-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleWorkbenchBuilderAssistantAction(target.dataset.workbenchBuilderAction || "");
  });
  $("workbench-plugin-boundary-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-workbench-plugin-boundary-action]") : null;
    if (!(target instanceof HTMLButtonElement) || target.disabled) return;
    handleWorkbenchPluginBoundaryAction(target.dataset.workbenchPluginBoundaryAction || "");
  });
  $("workbench-result-open-performance").addEventListener("click", () => {
    openWorkbenchResultPerformance().catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("workbench-result-open-runs").addEventListener("click", () => navigateToRunsLens("runs"));
  $("workbench-result-open-log").addEventListener("click", () => {
    openWorkbenchResultLog().catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("workbench-artifacts-action-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement
      ? event.target.closest("button[data-workbench-artifacts-summary-action]")
      : null;
    if (!(target instanceof HTMLElement) || target.hasAttribute("disabled")) return;
    handleWorkbenchArtifactsActionSummary(target.dataset.workbenchArtifactsSummaryAction || "").catch((err) => {
      $("workbench-artifacts-action-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("workbench-artifacts-assistant-actions").addEventListener("click", (event) => {
    const target = event.target;
    const button = target instanceof HTMLElement
      ? target.closest("[data-workbench-artifacts-action]")
      : null;
    if (!(button instanceof HTMLElement) || button.hasAttribute("disabled")) return;
    handleWorkbenchArtifactsAssistantAction(button.dataset.workbenchArtifactsAction || "").catch((err) => {
      $("workbench-artifacts-assistant-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-commands").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("copy-command")) return;
    copyText(target.dataset.command || "").then(() => {
      $("last-refresh").textContent = `Command copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("workbench-run-commands").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("copy-run-command")) return;
    copyText(target.dataset.command || "").then(() => {
      $("last-refresh").textContent = `Run command copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  onOptional("config-risk-preset", "change", applyRiskPreset);
  for (const id of ["config-drafts-body", "config-runs-body", "comparison-body", "performance-rollups-body"]) {
    $(id).addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains("inspect-draft")) {
        loadConfigArtifacts(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Artifact load failed: ${err.message}`;
        });
      }
      if (target.classList.contains("open-draft-performance")) {
        loadConfigArtifacts(target.dataset.draftId || "", { openPerformance: true }).catch((err) => {
          $("last-refresh").textContent = `Result load failed: ${err.message}`;
        });
      }
      if (target.classList.contains("inspect-draft-detail")) {
        loadConfigDraftDetail(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Draft detail failed: ${err.message}`;
        });
      }
      if (target.classList.contains("download-draft-yaml")) {
        downloadDraftYaml(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Draft download failed: ${err.message}`;
        });
      }
      if (target.classList.contains("delete-draft")) {
        deleteConfigDraft(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Draft delete failed: ${err.message}`;
        });
      }
      if (target.classList.contains("inspect-run-artifacts")) {
        loadRunArtifacts(target.dataset.runId || "").catch((err) => {
          $("last-refresh").textContent = `Run artifact load failed: ${err.message}`;
        });
      }
      if (target.classList.contains("open-run-performance")) {
        loadRunArtifacts(target.dataset.runId || "", { openPerformance: true }).catch((err) => {
          $("last-refresh").textContent = `Run result load failed: ${err.message}`;
        });
      }
      if (target.classList.contains("inspect-run-log")) {
        loadRunDetail(target.dataset.runId || "").catch((err) => {
          $("last-refresh").textContent = `Run log load failed: ${err.message}`;
        });
      }
    });
  }
  $("artifact-order-previews-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains("copy-approval-command")) {
      copyText(target.dataset.command || "").then(() => {
        $("last-refresh").textContent = `Approval command copied: ${new Date().toLocaleString()}`;
      }).catch((err) => {
        $("last-refresh").textContent = `Copy failed: ${err.message}`;
      });
      return;
    }
    if (target.classList.contains("approve-order-preview")) {
      approveOrderPreview(target.dataset.approvalId || "").catch((err) => {
        $("last-refresh").textContent = `Approval failed: ${err.message}`;
      });
    }
  });
  $("remote-nodes-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains("inspect-remote-node")) {
      loadRemoteNodeDetail(target.dataset.nodeId || "").catch((err) => {
        $("last-refresh").textContent = `Remote node detail failed: ${err.message}`;
      });
      return;
    }
    if (target.classList.contains("request-remote-status")) {
      prepareRequestStatusCommand(target.dataset.nodeId || "");
    }
  });
  $("data-catalog-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.classList.contains("copy-data-path-row")) {
      copyText(target.dataset.path || "").then(() => {
        $("last-refresh").textContent = `Dataset path copied: ${new Date().toLocaleString()}`;
      }).catch((err) => {
        $("last-refresh").textContent = `Copy failed: ${err.message}`;
      });
      return;
    }
    if (target.classList.contains("inspect-data")) {
      loadDataDetail(target.dataset.path || "", { resetControls: true }).catch((err) => {
        $("last-refresh").textContent = `Data detail failed: ${err.message}`;
      });
    }
  });
  $("data-symbol-browser-matches").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".symbol-match-card") : null;
    if (!(target instanceof HTMLElement)) return;
    loadDataDetail(target.dataset.path || "", { resetControls: true }).catch((err) => {
      $("data-symbol-browser-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-profile-files").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".symbol-profile-file-open") : null;
    if (!(target instanceof HTMLElement)) return;
    loadDataDetail(target.dataset.path || "", { resetControls: true }).catch((err) => {
      $("data-symbol-profile-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-directory").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-symbol]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleSymbolDirectoryAction(target).catch((err) => {
      $("data-symbol-directory-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-symbol-coverage-body").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-symbol]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleSymbolDirectoryAction(target).catch((err) => {
      $("data-symbol-coverage-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("data-directory-assistant-actions").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest("button[data-directory-action]") : null;
    if (!(target instanceof HTMLElement)) return;
    handleSymbolDirectoryAssistantAction(target).catch((err) => {
      $("data-symbol-directory-note").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("copy-data-path").addEventListener("click", () => {
    copyText((state.dataDetail || {}).path || "").then(() => {
      $("last-refresh").textContent = `Dataset path copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("copy-data-root-flag").addEventListener("click", () => {
    const path = (state.dataDetail || {}).path || "";
    copyText(`--data-root ${shellQuote(dirname(path))}`).then(() => {
      $("last-refresh").textContent = `Data root flag copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("copy-data-replay-command").addEventListener("click", () => {
    copyText(replayStarterCommand(state.dataDetail || {})).then(() => {
      $("last-refresh").textContent = `Replay starter copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("use-data-detail-workbench").addEventListener("click", useDataDetailInWorkbench);
  $("export-data-detail-range").addEventListener("click", () => {
    downloadDataDetailRangeCsv().catch((err) => {
      $("last-refresh").textContent = `Data Detail range export failed: ${err.message}`;
    });
  });
  $("export-data-missing-intervals").addEventListener("click", () => {
    downloadDataMissingIntervalsCsv().catch((err) => {
      $("last-refresh").textContent = `Missing interval export failed: ${err.message}`;
    });
  });
  $("fetch-manifests-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("inspect-fetch")) return;
    loadFetchManifestDetail(target.dataset.jobId || "").catch((err) => {
      $("last-refresh").textContent = `Fetch manifest detail failed: ${err.message}`;
    });
  });
  $("fetch-outputs-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("inspect-data")) return;
    loadDataDetail(target.dataset.path || "", { resetControls: true }).catch((err) => {
      $("last-refresh").textContent = `Fetch output data detail failed: ${err.message}`;
    });
  });
  $("copy-fetch-resume-command").addEventListener("click", () => {
    const command = fetchResumeCommand(state.fetchManifestDetail || {});
    if (!command) {
      $("last-refresh").textContent = "Select a resumable stock or crypto fetch manifest before copying a resume command";
      return;
    }
    copyText(command).then(() => {
      $("last-refresh").textContent = `Fetch resume command copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("fetch-resume-command").addEventListener("click", (event) => {
    const target = event.target instanceof HTMLElement ? event.target.closest(".copy-fetch-resume-inline") : null;
    if (!(target instanceof HTMLElement)) return;
    copyText(target.dataset.command || "").then(() => {
      $("last-refresh").textContent = `Fetch resume command copied: ${new Date().toLocaleString()}`;
    }).catch((err) => {
      $("last-refresh").textContent = `Copy failed: ${err.message}`;
    });
  });
  $("show-fetch-outputs-data").addEventListener("click", applyFetchOutputDataFilter);
  $("compare-fetch-outputs").addEventListener("click", () => {
    compareFetchOutputs().catch((err) => {
      $("last-refresh").textContent = `Fetch output comparison failed: ${err.message}`;
    });
  });
  $("use-fetch-outputs-workbench").addEventListener("click", useFetchOutputsInWorkbench);
  $("copy-fetch-output-paths").addEventListener("click", copyFetchVisibleOutputPaths);
  $("export-fetch-detail-csv").addEventListener("click", () => {
    downloadFetchDetailCsv().catch((err) => {
      $("last-refresh").textContent = `Fetch detail CSV export failed: ${err.message}`;
    });
  });
  $("commands-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("cancel-command")) return;
    cancelCommand(target.dataset.commandId || "", target.dataset.nodeId || "").catch((err) => {
      $("last-refresh").textContent = `Cancel failed: ${err.message}`;
    });
  });
  refresh().catch((err) => {
    $("last-refresh").textContent = `Refresh failed: ${err.message}`;
  });
  window.setInterval(() => {
    if (document.hidden) return;
    refresh().catch((err) => {
      $("last-refresh").textContent = `Auto-refresh failed: ${err.message}`;
    });
  }, AUTO_REFRESH_INTERVAL_MS);
}

export function initializeDashboard() {
  document.addEventListener("DOMContentLoaded", init);
}
