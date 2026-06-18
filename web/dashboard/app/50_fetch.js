import {
  $,
  MAX_DATA_COMPARE_DATASETS,
  age,
  escapeHtml,
  interval,
  jsonDrilldown,
  kvRows,
  navigateToDataLens,
  navigateToFetchLens,
  navigateToWorkbenchLens,
  numberText,
  row,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { attachDatasetOptionMetadata, rememberWorkbenchDataset } from "./20_workbench_foundation.js";
import { fetchBackendStatusModel, renderFetchBackendStatus, timestampAgeLabel, timestampMillis } from "./30_runtime_core.js";
import { workflowHref } from "./32_overview.js";
import { rangeLabel } from "./34_charts.js";
import { countBy, countSummary, dataRootConfigPaths, dataRootsYamlSnippet, fetchManifestRootConfigPaths, fetchManifestRootsYamlSnippet, fetchVisibleOutputPaths, shellQuote } from "./40_data_catalog.js";
import { dataReplayReadiness, renderDataCatalog } from "./41_data_explorer.js";
import { dateInputValueFromTimestamp, renderDataCompareControls } from "./43_data_detail_compare.js";
import { renderConfigLivePanels } from "./60_workbench_builder.js";
import { copyText, downloadFetchManifestsCsv, loadDataCompare, loadFetchManifestDetail } from "./90_bootstrap.js";

export function renderFetchJobs() {
  const payload = state.fetchManifests || {};
  const manifests = payload.manifests || [];
  const filteredManifests = filteredFetchManifests(manifests);
  const roots = payload.roots || [];
  const rootConfigPaths = fetchManifestRootConfigPaths();
  const rowsTotal = manifests.reduce((sum, item) => sum + Number(item.rows || 0), 0);
  renderFetchFilterOptions(manifests);
  $("fetch-jobs-note").textContent = payload.generated_at
    ? `${numberText(filteredManifests.length, 0)} shown / ${numberText(payload.total || manifests.length, 0)} total`
    : "No fetch manifests loaded";
  $("fetch-job-count").textContent = numberText(manifests.length, 0);
  $("fetch-job-status-summary").textContent = countSummary(payload.status_counts);
  $("fetch-job-rows").textContent = numberText(rowsTotal, 0);
  $("fetch-job-kind-summary").textContent = countSummary(payload.kind_counts);
  $("fetch-root-count").textContent = numberText(roots.length, 0);
  $("fetch-root-note").textContent = roots.length
    ? `${numberText(roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0), 0)} manifest files under configured roots`
    : "No fetch manifest roots configured";
  $("copy-fetch-roots-yaml").disabled = !rootConfigPaths.length;
  $("fetch-root-config-note").textContent = rootConfigPaths.length
    ? `${numberText(rootConfigPaths.length, 0)} manifest root${rootConfigPaths.length === 1 ? "" : "s"} ready to copy`
    : "No manifest roots to copy";
  $("fetch-root-cards").innerHTML = roots.length
    ? roots.map((root) => {
        const status = !root.exists ? "bad" : !root.is_dir ? "bad" : Number(root.manifest_count || 0) ? "ok" : "warn";
        return `
          <div class="root-card">
            <span>${statusText(status)}</span>
            <strong>${escapeHtml(numberText(root.manifest_count, 0))} jobs</strong>
            <small class="mono">${escapeHtml(root.display_path || root.path)}</small>
            <small>writable=${escapeHtml(text(root.writable))}</small>
          </div>
        `;
      }).join("")
    : `<div class="root-card"><span class="status-warn">warn</span><strong>No roots</strong><small>Add a fetch manifest root.</small></div>`;
  renderFetchHealthPanel({ manifests, filteredManifests, roots, rootConfigPaths, rowsTotal });
  renderFetchBackendStatus();
  renderFetchActionSummary({ manifests, filteredManifests, roots, rootConfigPaths, rowsTotal });
  renderFetchEvidence({ manifests, filteredManifests, roots, rootConfigPaths, rowsTotal });
  renderFetchProgressReview({ manifests, filteredManifests, roots, rootConfigPaths, rowsTotal });
  renderFetchTriageCards({ manifests, filteredManifests, roots, rootConfigPaths, rowsTotal });
  renderFetchWorkflowLauncher({ manifests, filteredManifests, roots, rootConfigPaths, rowsTotal });
  renderFetchJobsGuide({ manifests, filteredManifests, roots, rootConfigPaths });
  renderFetchSearchAssistant(manifests, filteredManifests);
  const errors = payload.errors || [];
  const errorRows = errors.map((item) => row([
    escapeHtml(item.path),
    "",
    statusText("bad"),
    "",
    "",
    "",
    "",
    "",
    "",
    "",
    escapeHtml(item.error),
    "",
    "",
    "",
  ]));
  const manifestRows = filteredManifests.map((item) => {
    const symbolSummary = [
      `ok ${numberText(item.success_symbols, 0)}`,
      `empty ${numberText(item.empty_symbols, 0)}`,
      `failed ${numberText(item.failed_symbols, 0)}`,
      `skipped ${numberText(item.skipped_symbols, 0)}`,
    ].join(" / ");
    const chunkSummary = [
      `ok ${numberText(item.success_chunks, 0)}`,
      `empty ${numberText(item.empty_chunks, 0)}`,
      `failed ${numberText(item.failed_chunks, 0)}`,
      item.pending_chunks !== undefined && item.pending_chunks !== null ? `planned ${numberText(item.pending_chunks, 0)}` : "",
    ].filter(Boolean).join(" / ");
    const etaSummary = [
      item.latest_eta_seconds !== undefined && item.latest_eta_seconds !== null ? `eta ${interval(item.latest_eta_seconds)}` : "",
      item.latest_avg_chunk_seconds !== undefined && item.latest_avg_chunk_seconds !== null ? `avg ${interval(item.latest_avg_chunk_seconds)}` : "",
      item.latest_avg_symbol_seconds !== undefined && item.latest_avg_symbol_seconds !== null ? `sym avg ${interval(item.latest_avg_symbol_seconds)}` : "",
      item.latest_completed_symbols !== undefined && item.latest_completed_symbols !== null ? `symbols ${numberText(item.latest_completed_symbols, 0)}/${numberText(item.latest_total_symbols || item.symbols_requested, 0)}` : "",
      item.retry_events ? `retries ${numberText(item.retry_events, 0)}` : "",
      item.pacing_wait_events ? `waits ${numberText(item.pacing_wait_events, 0)}` : "",
    ].filter(Boolean).join(" / ") || "n/a";
    const activitySummary = [
      item.last_event_at ? timestampAgeLabel(item.last_event_at) : "",
      item.last_event_source ? text(item.last_event_source) : "",
    ].filter(Boolean).join(" / ") || "n/a";
    const output = item.latest_output_path || item.out_dir || item.first_output_path || "";
    return row([
      escapeHtml(item.started_at),
      escapeHtml(item.kind),
      statusText(item.status),
      escapeHtml(activitySummary),
      escapeHtml(item.bar_size),
      escapeHtml(rangeLabel(item.range_start, item.range_end || item.duration || item.months)),
      escapeHtml(symbolSummary),
      escapeHtml(chunkSummary),
      escapeHtml(etaSummary),
      escapeHtml(numberText(item.rows, 0)),
      `<span class="${Number(item.errors || 0) ? "status-warn" : "status-ok"}">${escapeHtml(numberText(item.errors, 0))}</span>`,
      fetchOutputVisibilityHtml(item),
      `<span class="mono">${escapeHtml(output)}</span>`,
      `<button type="button" class="secondary inspect-fetch" data-job-id="${escapeHtml(item.job_id)}">Inspect</button>`,
    ]);
  });
  $("fetch-manifests-body").innerHTML = manifestRows.length || errorRows.length
    ? manifestRows.concat(errorRows).join("")
    : row([`<span class="muted">No fetch manifests match the current filters.</span>`, "", "", "", "", "", "", "", "", "", "", "", "", ""]);
}

export function renderFetchHealthPanel(context = {}) {
  if (!$("fetch-health-title") || !$("fetch-health-cards") || !$("fetch-health-actions")) return;
  const manifests = context.manifests || [];
  const filteredManifests = context.filteredManifests || manifests;
  const roots = context.roots || [];
  const rootConfigPaths = context.rootConfigPaths || [];
  const rootManifestCount = roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0);
  const activeJobs = manifests.filter((item) => !fetchJobTerminal(item.status));
  const reviewJobs = manifests.filter((item) => fetchManifestIssueCount(item) > 0 || fetchManifestOutputIssueCount(item) > 0);
  const retryEvents = manifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const visibleOutputs = manifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = manifests.reduce((sum, item) => sum + fetchManifestOutputIssueCount(item), 0);
  const selectedDetail = state.fetchManifestDetail || {};
  const selectedVisibleOutputs = fetchVisibleOutputPaths(selectedDetail);
  const hiddenByFilters = Math.max(0, manifests.length - filteredManifests.length);
  let status = "idle";
  let title = "No Fetch Jobs";
  let note = "No dashboard-readable fetch manifests are loaded. Configure manifest roots or run a fetcher that writes JSON manifests.";
  let primaryHref = "#fetch";
  let primaryLabel = "Configure Roots";
  if (!roots.length && rootConfigPaths.length) {
    status = "warn";
    title = "Manifest Roots Need Scan";
    note = `${numberText(rootConfigPaths.length, 0)} manifest root path${rootConfigPaths.length === 1 ? "" : "s"} are configured or suggested, but no manifest rows are loaded.`;
  } else if (activeJobs.length) {
    status = "warn";
    title = "Fetch Running Or Incomplete";
    note = `${numberText(activeJobs.length, 0)} non-terminal manifest${activeJobs.length === 1 ? "" : "s"} are visible. Inspect progress before starting more pulls.`;
    primaryHref = "#fetch/jobs";
    primaryLabel = "Open Jobs";
  } else if (reviewJobs.length) {
    status = "warn";
    title = "Recovery Needed";
    note = `${numberText(reviewJobs.length, 0)} fetch job${reviewJobs.length === 1 ? "" : "s"} report failures, retry pressure, or output path issues.`;
    primaryHref = "#fetch/detail";
    primaryLabel = "Open Detail";
  } else if (outputIssues) {
    status = "warn";
    title = "Output Visibility Issues";
    note = `${numberText(outputIssues, 0)} produced output path issue${outputIssues === 1 ? "" : "s"} need Data Library root/path review.`;
    primaryHref = "#fetch/detail";
    primaryLabel = "Review Outputs";
  } else if (visibleOutputs) {
    status = "ok";
    title = "Fetch Outputs Ready";
    note = `${numberText(visibleOutputs, 0)} output file${visibleOutputs === 1 ? "" : "s"} are visible from Data Library roots.`;
    primaryHref = selectedVisibleOutputs.length ? "#data/browse" : "#fetch/jobs";
    primaryLabel = selectedVisibleOutputs.length ? "Open Data" : "Open Jobs";
  } else if (manifests.length) {
    status = "warn";
    title = "Jobs Loaded";
    note = `${numberText(manifests.length, 0)} fetch manifest${manifests.length === 1 ? "" : "s"} are loaded, but no Data Library-visible outputs are summarized yet.`;
    primaryHref = "#fetch/jobs";
    primaryLabel = "Inspect Jobs";
  }
  $("fetch-health-title").textContent = title;
  $("fetch-health-title").className = statusClass(status);
  $("fetch-health-note").textContent = note;
  const cards = [
    {
      label: "Manifest Roots",
      title: roots.length ? `${numberText(roots.length, 0)} roots` : "none",
      status: roots.length && rootManifestCount ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      detail: `${numberText(rootManifestCount, 0)} manifest file${rootManifestCount === 1 ? "" : "s"} under configured roots.`,
    },
    {
      label: "Loaded Jobs",
      title: `${numberText(filteredManifests.length, 0)} / ${numberText(manifests.length, 0)}`,
      status: filteredManifests.length ? "ok" : manifests.length ? "warn" : "idle",
      detail: hiddenByFilters ? `${numberText(hiddenByFilters, 0)} job${hiddenByFilters === 1 ? "" : "s"} hidden by filters.` : `${numberText(context.rowsTotal || 0, 0)} fetched rows summarized.`,
    },
    {
      label: "Active Jobs",
      title: numberText(activeJobs.length, 0),
      status: activeJobs.length ? "warn" : manifests.length ? "ok" : "idle",
      detail: activeJobs.length ? "Inspect active/non-terminal manifests before launching another pull." : "No active/non-terminal jobs loaded.",
    },
    {
      label: "Recovery",
      title: numberText(reviewJobs.length, 0),
      status: reviewJobs.length ? "warn" : manifests.length ? "ok" : "bad",
      detail: `${numberText(retryEvents, 0)} retries / ${numberText(pacingWaits, 0)} pacing waits across loaded jobs.`,
    },
    {
      label: "Output Visibility",
      title: `${numberText(visibleOutputs, 0)} visible`,
      status: outputIssues ? "warn" : visibleOutputs ? "ok" : manifests.length ? "warn" : "idle",
      detail: outputIssues ? `${numberText(outputIssues, 0)} missing/outside/no-path/unsupported output issue${outputIssues === 1 ? "" : "s"}.` : "Visible outputs can be opened from Fetch Detail.",
    },
    {
      label: "Selected Detail",
      title: selectedDetail.job_id ? text(selectedDetail.job_id) : "none",
      status: selectedDetail.job_id ? selectedVisibleOutputs.length ? "ok" : "warn" : "warn",
      detail: selectedDetail.job_id ? `${numberText(selectedVisibleOutputs.length, 0)} selected visible output${selectedVisibleOutputs.length === 1 ? "" : "s"}.` : "Select a job to see resume and output actions.",
    },
  ];
  $("fetch-health-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
  $("fetch-health-actions").innerHTML = [
    `<a href="${escapeHtml(primaryHref)}">${escapeHtml(primaryLabel)}</a>`,
    `<a class="secondary" href="#fetch/jobs">Jobs</a>`,
    `<a class="secondary" href="#fetch/detail">Detail</a>`,
    `<a class="secondary" href="#data/browse">Data Library</a>`,
    `<a class="secondary" href="#workbench/builder">Workbench</a>`,
  ].join("");
}

export function fetchActionSummaryModel(context = {}) {
  const manifests = context.manifests || [];
  const filteredManifests = context.filteredManifests || manifests;
  const roots = context.roots || [];
  const rootConfigPaths = context.rootConfigPaths || [];
  const activeJobs = manifests.filter((item) => !fetchJobTerminal(item.status));
  const issueJobs = manifests.filter((item) => fetchManifestIssueCount(item) > 0);
  const outputIssueJobs = manifests.filter((item) => fetchManifestOutputIssueCount(item) > 0);
  const retryEvents = manifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const visibleOutputs = manifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const selectedDetail = state.fetchManifestDetail || {};
  const selectedOutputs = selectedDetail.outputs || [];
  const selectedVisibleOutputs = fetchVisibleOutputPaths(selectedDetail);
  const selectedResume = fetchResumeCommand(selectedDetail);
  const hiddenByFilters = Math.max(0, manifests.length - filteredManifests.length);
  const backend = fetchBackendStatusModel();
  const backendRows = backend.rows || [];
  const backendEndpointRows = backendRows.filter((item) => item.label !== "required status");
  const backendIssues = backendEndpointRows.filter((item) => item.status !== "ok");
  const backendUnprobed = !backendEndpointRows.length && Boolean(state.status && state.status.generated_at);
  const firstBackendIssue = backendIssues[0] || null;
  const focusJob = selectedDetail.job_id
    ? selectedDetail
    : activeJobs[0] || issueJobs[0] || outputIssueJobs[0] || filteredManifests[0] || manifests[0] || null;
  let status = "idle";
  let title = "Configure Manifest Roots";
  let note = "No dashboard-readable fetch manifests are loaded. Add manifest roots or run a fetcher that writes JSON manifests.";
  let primaryHref = "#fetch";
  let primaryLabel = "Review Roots";
  if (backendUnprobed || firstBackendIssue) {
    status = firstBackendIssue ? "warn" : "bad";
    title = firstBackendIssue ? "Refresh Fetch APIs" : "Check Fetch APIs";
    note = firstBackendIssue
      ? `${text(firstBackendIssue.label)} is degraded: ${text(firstBackendIssue.detail)}. Confirm backend status before changing roots or rerunning fetches.`
      : "Fetch endpoint checks have not run yet. Refresh Fetch APIs before treating empty jobs or sessions as missing files.";
    primaryHref = "#operations/diagnostics";
    primaryLabel = "API Health";
  } else if (activeJobs.length) {
    status = "warn";
    title = "Inspect Active Fetch";
    note = `${numberText(activeJobs.length, 0)} non-terminal fetch manifest${activeJobs.length === 1 ? "" : "s"} are visible; check progress, activity age, ETA, and pacing before starting another pull.`;
    primaryHref = "#fetch/jobs";
    primaryLabel = "Open Jobs";
  } else if (issueJobs.length) {
    status = "warn";
    title = "Recover Failed Fetch";
    note = `${numberText(issueJobs.length, 0)} manifest${issueJobs.length === 1 ? "" : "s"} report failed, no-data, permission, retry, or error pressure.`;
    primaryHref = "#fetch/detail";
    primaryLabel = "Open Detail";
  } else if (outputIssueJobs.length) {
    status = "warn";
    title = "Fix Output Visibility";
    note = `${numberText(outputIssueJobs.length, 0)} manifest${outputIssueJobs.length === 1 ? "" : "s"} have missing, outside-root, unsupported, or no-path output evidence.`;
    primaryHref = "#data/diagnostics";
    primaryLabel = "Data Diagnostics";
  } else if (selectedDetail.job_id && selectedVisibleOutputs.length) {
    status = "ok";
    title = "Review Selected Outputs";
    note = `${numberText(selectedVisibleOutputs.length, 0)} selected output file${selectedVisibleOutputs.length === 1 ? "" : "s"} are visible to Data Library; inspect, compare, or send them to Workbench.`;
    primaryHref = "#data/browse";
    primaryLabel = "Open Data";
  } else if (visibleOutputs) {
    status = "ok";
    title = "Open Fetched Data";
    note = `${numberText(visibleOutputs, 0)} output file${visibleOutputs === 1 ? "" : "s"} are visible across loaded fetch manifests.`;
    primaryHref = "#fetch/jobs";
    primaryLabel = "Choose Job";
  } else if (manifests.length) {
    status = "warn";
    title = "Inspect Loaded Jobs";
    note = `${numberText(manifests.length, 0)} fetch manifest${manifests.length === 1 ? "" : "s"} are loaded, but no visible output handoff is ready.`;
    primaryHref = "#fetch/jobs";
    primaryLabel = "Open Jobs";
  } else if (roots.length || rootConfigPaths.length) {
    status = "warn";
    title = "Roots Need Manifests";
    note = `${numberText(roots.length || rootConfigPaths.length, 0)} manifest root${(roots.length || rootConfigPaths.length) === 1 ? "" : "s"} are known, but no jobs are loaded.`;
  }
  const cards = [
    {
      label: "Backend Check",
      status: backendUnprobed ? "bad" : firstBackendIssue ? "warn" : "ok",
      title: backendUnprobed ? "No Checks" : firstBackendIssue ? "Review" : backend.title,
      note: backendUnprobed
        ? "Refresh Fetch APIs to verify /fetch_manifests and /runtime_sessions."
        : firstBackendIssue ? `${text(firstBackendIssue.label)}: ${text(firstBackendIssue.detail)}` : backend.note,
    },
    {
      label: "Inspect First",
      status,
      title,
      note,
    },
    {
      label: "Focus Job",
      status: focusJob ? fetchManifestIssueCount(focusJob) || fetchManifestOutputIssueCount(focusJob) ? "warn" : fetchJobTerminal(focusJob.status) ? "ok" : "warn" : "idle",
      title: focusJob ? fetchManifestLabel(focusJob) : "none",
      note: focusJob
        ? `${text(focusJob.status)} / ${text(focusJob.kind)} / rows ${numberText(focusJob.rows, 0)} / activity ${focusJob.last_event_at ? timestampAgeLabel(focusJob.last_event_at) : "n/a"}.`
        : "No manifest is available to focus.",
    },
    {
      label: "Recovery Pressure",
      status: issueJobs.length ? "warn" : manifests.length ? "ok" : "bad",
      title: `${numberText(issueJobs.length, 0)} jobs`,
      note: `${numberText(retryEvents, 0)} retries and ${numberText(pacingWaits, 0)} pacing waits across loaded manifests.`,
    },
    {
      label: "Output Handoff",
      status: outputIssueJobs.length ? "warn" : visibleOutputs ? "ok" : manifests.length ? "warn" : "idle",
      title: `${numberText(visibleOutputs, 0)} visible`,
      note: outputIssueJobs.length
        ? `${numberText(outputIssueJobs.length, 0)} job${outputIssueJobs.length === 1 ? "" : "s"} have output-root issues.`
        : visibleOutputs ? "Visible outputs can move to Data Library, Compare, or Workbench." : "No visible output files are summarized.",
    },
    {
      label: "Selected Detail",
      status: selectedDetail.job_id ? selectedVisibleOutputs.length ? "ok" : selectedResume ? "warn" : "warn" : "warn",
      title: selectedDetail.job_id ? text(selectedDetail.job_id) : "none",
      note: selectedDetail.job_id
        ? `${numberText(selectedOutputs.length, 0)} outputs / ${numberText(selectedVisibleOutputs.length, 0)} visible / resume ${selectedResume ? "available" : "n/a"}.`
        : "Select a manifest to expose resume, output, compare, and Workbench actions.",
    },
    {
      label: "Filters",
      status: hiddenByFilters ? "warn" : "ok",
      title: hiddenByFilters ? `${numberText(hiddenByFilters, 0)} hidden` : "Clear",
      note: hiddenByFilters ? "Some manifests are hidden by Jobs filters." : "No manifest rows are hidden by filters.",
    },
  ];
  const actions = [
    { href: primaryHref, label: primaryLabel, secondary: false },
    { href: "#fetch/jobs", label: "Jobs", secondary: true },
    { href: "#fetch/detail", label: "Detail", secondary: true },
    { href: "#data/browse", label: "Data Library", secondary: true },
    { href: "#workbench/builder", label: "Workbench", secondary: true },
  ];
  return { title, note, cards, actions };
}

export function renderFetchActionSummary(context = {}) {
  if (!$("fetch-action-note") || !$("fetch-action-cards") || !$("fetch-action-actions")) return;
  const model = fetchActionSummaryModel(context);
  $("fetch-action-note").textContent = `${model.title}: ${model.note}`;
  $("fetch-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("fetch-action-actions").innerHTML = model.actions.map((action) => `
    <a href="${escapeHtml(action.href)}"${action.secondary ? ` class="secondary"` : ""}>${escapeHtml(action.label)}</a>
  `).join("");
}

export function fetchManifestOutputIssueCount(item) {
  return (
    Number(item.output_missing_file_count || 0) +
    Number(item.output_outside_data_roots_count || 0) +
    Number(item.output_no_path_count || 0) +
    Number(item.output_unsupported_file_count || 0)
  );
}

export function fetchManifestLabel(item) {
  return text(item.job_id || item.path || "fetch job");
}

export function fetchEvidenceModel(context = {}) {
  const manifests = context.manifests || [];
  const filteredManifests = context.filteredManifests || manifests;
  const roots = context.roots || [];
  const rootConfigPaths = context.rootConfigPaths || [];
  const rootManifestCount = roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0);
  const activeJobs = manifests.filter((item) => !fetchJobTerminal(item.status));
  const reviewJobs = manifests.filter((item) => fetchManifestIssueCount(item) > 0 || fetchManifestOutputIssueCount(item) > 0);
  const visibleOutputs = manifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = manifests.reduce((sum, item) => sum + fetchManifestOutputIssueCount(item), 0);
  const retryEvents = manifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const selectedDetail = state.fetchManifestDetail || {};
  const selectedVisibleOutputs = fetchVisibleOutputPaths(selectedDetail);
  const selectedResume = fetchResumeCommand(selectedDetail);
  const selectedOutputIssues = (selectedDetail.outputs || []).filter((item) => !item.data_detail_available || !item.data_detail_path).length;
  const focusJob = selectedDetail.job_id
    ? manifests.find((item) => item.job_id === selectedDetail.job_id) || selectedDetail
    : fetchProgressJob(filteredManifests.length ? filteredManifests : manifests);
  const hiddenByFilters = Math.max(0, manifests.length - filteredManifests.length);
  let headline = "No fetch evidence";
  let headlineStatus = "idle";
  let note = "Configure manifest roots or run a fetcher that writes dashboard-readable JSON manifests.";
  if (!roots.length && rootConfigPaths.length) {
    headline = "Configured roots need manifests";
    headlineStatus = "warn";
    note = `${numberText(rootConfigPaths.length, 0)} manifest root path${rootConfigPaths.length === 1 ? "" : "s"} are known, but no readable manifest rows are loaded.`;
  } else if (activeJobs.length) {
    headline = "Active fetch evidence";
    headlineStatus = "warn";
    note = `${numberText(activeJobs.length, 0)} non-terminal manifest${activeJobs.length === 1 ? "" : "s"} are loaded; inspect progress before launching more pulls.`;
  } else if (reviewJobs.length || outputIssues) {
    headline = "Recovery evidence";
    headlineStatus = "warn";
    note = `${numberText(reviewJobs.length, 0)} job${reviewJobs.length === 1 ? "" : "s"} need failure/output review; ${numberText(outputIssues, 0)} output visibility issue${outputIssues === 1 ? "" : "s"}.`;
  } else if (visibleOutputs) {
    headline = "Output-backed fetch evidence";
    headlineStatus = "ok";
    note = `${numberText(visibleOutputs, 0)} output file${visibleOutputs === 1 ? "" : "s"} are visible to Data Library.`;
  } else if (manifests.length) {
    headline = "Manifest-backed fetch evidence";
    headlineStatus = "warn";
    note = `${numberText(manifests.length, 0)} manifest${manifests.length === 1 ? "" : "s"} are loaded, but visible output evidence is weak or absent.`;
  } else if (roots.length) {
    headline = "Root-only fetch evidence";
    headlineStatus = "warn";
    note = `${numberText(roots.length, 0)} manifest root${roots.length === 1 ? "" : "s"} are configured, but no jobs are loaded.`;
  }
  const cards = [
    {
      label: "Evidence Chain",
      status: headlineStatus,
      title: headline,
      note,
    },
    {
      label: "Manifest Roots",
      status: roots.length && rootManifestCount ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      title: roots.length ? `${numberText(roots.length, 0)} root${roots.length === 1 ? "" : "s"}` : "None",
      note: `${numberText(rootManifestCount, 0)} manifest file${rootManifestCount === 1 ? "" : "s"} under configured roots; ${numberText(rootConfigPaths.length, 0)} config path${rootConfigPaths.length === 1 ? "" : "s"}.`,
    },
    {
      label: "Loaded Manifests",
      status: manifests.length ? filteredManifests.length ? "ok" : "warn" : "bad",
      title: `${numberText(filteredManifests.length, 0)} / ${numberText(manifests.length, 0)}`,
      note: hiddenByFilters ? `${numberText(hiddenByFilters, 0)} hidden by Jobs filters.` : `${numberText(context.rowsTotal || 0, 0)} fetched rows summarized.`,
    },
    {
      label: "Recovery",
      status: reviewJobs.length || retryEvents || pacingWaits ? "warn" : manifests.length ? "ok" : "bad",
      title: `${numberText(reviewJobs.length, 0)} review`,
      note: `${numberText(retryEvents, 0)} retries / ${numberText(pacingWaits, 0)} pacing waits across loaded manifests.`,
    },
    {
      label: "Output Visibility",
      status: outputIssues ? "warn" : visibleOutputs ? "ok" : manifests.length ? "warn" : "bad",
      title: `${numberText(visibleOutputs, 0)} visible`,
      note: outputIssues ? `${numberText(outputIssues, 0)} missing/outside/no-path/unsupported output issue${outputIssues === 1 ? "" : "s"}.` : "Visible outputs can be opened through Fetch Detail or Data Library.",
    },
    {
      label: "Selected Detail",
      status: selectedDetail.job_id ? selectedVisibleOutputs.length ? "ok" : selectedOutputIssues ? "warn" : "warn" : "bad",
      title: selectedDetail.job_id ? text(selectedDetail.job_id) : "None",
      note: selectedDetail.job_id
        ? `${numberText(selectedVisibleOutputs.length, 0)} visible selected output${selectedVisibleOutputs.length === 1 ? "" : "s"}; resume ${selectedResume ? "available" : "unavailable"}.`
        : focusJob ? `Focus job available: ${fetchManifestLabel(focusJob)}.` : "Inspect a job to see resume and output actions.",
    },
  ];
  const lines = [
    {
      status: roots.length && rootManifestCount ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      title: "Root Evidence",
      detail: roots.length
        ? `${numberText(roots.length, 0)} configured manifest root${roots.length === 1 ? "" : "s"} scanned; ${numberText(rootManifestCount, 0)} manifest file${rootManifestCount === 1 ? "" : "s"} found.`
        : rootConfigPaths.length ? "Manifest root paths are available to copy into local config, but the current scan has no readable roots." : "No fetch manifest roots are loaded.",
    },
    {
      status: manifests.length ? "ok" : "idle",
      title: "Manifest Evidence",
      detail: manifests.length
        ? `${numberText(manifests.length, 0)} loaded manifest${manifests.length === 1 ? "" : "s"} across statuses ${countSummary(countBy(manifests, "status"))}; kinds ${countSummary(countBy(manifests, "kind"))}.`
        : "No dashboard-readable fetch manifest rows are loaded.",
    },
    {
      status: activeJobs.length || reviewJobs.length ? "warn" : manifests.length ? "ok" : "bad",
      title: "Progress And Recovery",
      detail: `${numberText(activeJobs.length, 0)} active/non-terminal; ${numberText(reviewJobs.length, 0)} needing review; ${numberText(retryEvents, 0)} retry events; ${numberText(pacingWaits, 0)} pacing waits.`,
    },
    {
      status: outputIssues ? "warn" : visibleOutputs ? "ok" : manifests.length ? "warn" : "bad",
      title: "Output Evidence",
      detail: `${numberText(visibleOutputs, 0)} Data Library-visible outputs; ${numberText(outputIssues, 0)} output path issues across loaded manifests.`,
    },
    {
      status: selectedDetail.job_id ? selectedVisibleOutputs.length ? "ok" : "warn" : "idle",
      title: "Selected Detail",
      detail: selectedDetail.job_id
        ? `${text(selectedDetail.job_id)} selected; ${numberText(selectedVisibleOutputs.length, 0)} visible output paths; resume command ${selectedResume ? "available" : "not available"}.`
        : "No selected fetch detail. Inspect a focus job before comparing outputs or sending files to Workbench.",
    },
  ];
  const next = !roots.length && rootConfigPaths.length
    ? { label: "Copy Roots YAML", action: "roots", status: "warn" }
    : !manifests.length
      ? { label: "Open Jobs", action: "jobs", status: "bad" }
      : focusJob && !selectedDetail.job_id
        ? { label: "Inspect Focus Job", action: "inspect", status: reviewJobs.length || activeJobs.length ? "warn" : "ok", jobId: text(focusJob.job_id) }
        : selectedVisibleOutputs.length
          ? { label: "Show Outputs", action: "data", status: "ok" }
          : outputIssues || reviewJobs.length
            ? { label: "Open Detail", action: "detail", status: "warn" }
            : { label: "Open Jobs", action: "jobs", status: "ok" };
  lines.push({
    status: next.status,
    title: "Next Verification",
    detail: `${next.label}${next.jobId ? `: ${next.jobId}` : ""}.`,
  });
  return { headline, note: `${headline} / next: ${next.label}`, cards, lines, next };
}

export function fetchEvidenceText(model) {
  return [
    `Fetch Evidence: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

export function renderFetchEvidence(context = {}) {
  if (!$("fetch-evidence-note") || !$("fetch-evidence-cards") || !$("fetch-evidence-body") || !$("fetch-evidence-actions")) return;
  const model = fetchEvidenceModel(context);
  state.fetchEvidenceText = fetchEvidenceText(model);
  $("fetch-evidence-note").textContent = model.note;
  $("fetch-evidence-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("fetch-evidence-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("fetch-evidence-actions").innerHTML = [
    `<button type="button" data-fetch-evidence-action="copy">Copy Evidence</button>`,
    `<button type="button" class="secondary" data-fetch-evidence-action="${escapeHtml(model.next.action)}" data-job-id="${escapeHtml(model.next.jobId || "")}">${escapeHtml(model.next.label)}</button>`,
    `<button type="button" class="secondary" data-fetch-evidence-action="jobs">Jobs</button>`,
    `<button type="button" class="secondary" data-fetch-evidence-action="detail">Detail</button>`,
    `<button type="button" class="secondary" data-fetch-evidence-action="data">Data Library</button>`,
  ].join("");
}

export function handleFetchEvidenceAction(action, target = null) {
  if (action === "copy") {
    copyText(state.fetchEvidenceText || "No fetch evidence loaded").then(() => {
      $("last-refresh").textContent = "Fetch evidence copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Fetch evidence copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "roots") return copyFetchManifestRootsYaml();
  if (action === "inspect") {
    const jobId = target ? target.dataset.jobId || "" : "";
    if (!jobId) {
      $("last-refresh").textContent = "No fetch job available to inspect";
      return;
    }
    loadFetchManifestDetail(jobId).catch((err) => {
      $("last-refresh").textContent = `Fetch manifest detail failed: ${err.message}`;
    });
    return;
  }
  if (action === "jobs") return navigateToFetchLens("jobs");
  if (action === "detail") return navigateToFetchLens("detail");
  if (action === "data") return navigateToDataLens("browse");
}

export function fetchProgressJob(manifests = []) {
  const sorted = (manifests || []).slice().sort((left, right) => {
    const leftActive = !fetchJobTerminal(left.status);
    const rightActive = !fetchJobTerminal(right.status);
    if (leftActive !== rightActive) return rightActive ? 1 : -1;
    const leftIssue = fetchManifestIssueCount(left) + fetchManifestOutputIssueCount(left);
    const rightIssue = fetchManifestIssueCount(right) + fetchManifestOutputIssueCount(right);
    if (leftIssue !== rightIssue) return rightIssue - leftIssue;
    const leftTime = timestampMillis(left.finished_at || left.started_at) || 0;
    const rightTime = timestampMillis(right.finished_at || right.started_at) || 0;
    return rightTime - leftTime;
  });
  return sorted[0] || null;
}

export function fetchProgressPair(done, total) {
  const doneValue = Number(done || 0);
  const totalValue = Number(total || 0);
  if (!totalValue) return doneValue ? numberText(doneValue, 0) : "n/a";
  return `${numberText(doneValue, 0)} / ${numberText(totalValue, 0)}`;
}

export function fetchProgressReviewModel(context = {}) {
  const manifests = context.manifests || [];
  const filteredManifests = context.filteredManifests || manifests;
  const roots = context.roots || [];
  const rootConfigPaths = context.rootConfigPaths || [];
  const activeJobs = manifests.filter((item) => !fetchJobTerminal(item.status));
  const partialJobs = manifests.filter((item) => text(item.status).toLowerCase() === "partial");
  const failedJobs = manifests.filter((item) => text(item.status).toLowerCase() === "failed");
  const reviewJobs = manifests.filter((item) => fetchManifestIssueCount(item) > 0 || fetchManifestOutputIssueCount(item) > 0);
  const visibleOutputs = manifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = manifests.reduce((sum, item) => sum + fetchManifestOutputIssueCount(item), 0);
  const retryEvents = manifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const pacingSeconds = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_seconds || 0), 0);
  const selectedJob = fetchProgressJob(filteredManifests.length ? filteredManifests : manifests);
  const selectedIssueCount = selectedJob ? fetchManifestIssueCount(selectedJob) + fetchManifestOutputIssueCount(selectedJob) : 0;
  const selectedActive = selectedJob ? !fetchJobTerminal(selectedJob.status) : false;
  const symbolDone = selectedJob
    ? selectedJob.latest_completed_symbols !== undefined && selectedJob.latest_completed_symbols !== null
      ? Number(selectedJob.latest_completed_symbols || 0)
      : Number(selectedJob.success_symbols || 0) + Number(selectedJob.empty_symbols || 0) + Number(selectedJob.failed_symbols || 0) + Number(selectedJob.skipped_symbols || 0)
    : 0;
  const symbolTotal = selectedJob ? Number(selectedJob.latest_total_symbols || selectedJob.symbols_requested || selectedJob.symbol_count || 0) : 0;
  const chunkDone = selectedJob
    ? selectedJob.latest_completed_chunks !== undefined && selectedJob.latest_completed_chunks !== null
      ? Number(selectedJob.latest_completed_chunks || 0)
      : Number(selectedJob.success_chunks || 0) + Number(selectedJob.empty_chunks || 0) + Number(selectedJob.failed_chunks || 0)
    : 0;
  const chunkTotal = selectedJob ? Number(selectedJob.latest_total_chunks || selectedJob.pending_chunks || selectedJob.chunk_count || 0) : 0;
  const eta = selectedJob && selectedJob.latest_eta_seconds !== undefined && selectedJob.latest_eta_seconds !== null
    ? interval(selectedJob.latest_eta_seconds)
    : "";
  const avgChunk = selectedJob && selectedJob.latest_avg_chunk_seconds !== undefined && selectedJob.latest_avg_chunk_seconds !== null
    ? interval(selectedJob.latest_avg_chunk_seconds)
    : "";
  const avgSymbol = selectedJob && selectedJob.latest_avg_symbol_seconds !== undefined && selectedJob.latest_avg_symbol_seconds !== null
    ? interval(selectedJob.latest_avg_symbol_seconds)
    : "";
  let headline = "No fetch manifests loaded";
  let note = "Configure manifest roots or run a fetcher that writes dashboard-readable JSON manifests.";
  if (activeJobs.length) {
    headline = "Active fetch manifests need attention";
    note = `${numberText(activeJobs.length, 0)} non-terminal job${activeJobs.length === 1 ? "" : "s"} are visible. Use progress and pacing evidence before starting another pull.`;
  } else if (reviewJobs.length) {
    headline = "Fetch recovery or output review is needed";
    note = `${numberText(reviewJobs.length, 0)} job${reviewJobs.length === 1 ? "" : "s"} have failures, no-data/retry pressure, or output visibility issues.`;
  } else if (manifests.length) {
    headline = "Fetch manifests are loaded";
    note = visibleOutputs
      ? `${numberText(visibleOutputs, 0)} output file${visibleOutputs === 1 ? "" : "s"} are visible to Data Library.`
      : "Jobs are loaded, but visible output paths are not summarized yet.";
  } else if (roots.length || rootConfigPaths.length) {
    headline = "Manifest roots are configured";
    note = "Roots are known, but no fetch job manifests are loaded from the current scan.";
  }
  const cards = [
    {
      status: manifests.length ? "ok" : roots.length || rootConfigPaths.length ? "warn" : "bad",
      label: "Loaded Jobs",
      title: `${numberText(filteredManifests.length, 0)} / ${numberText(manifests.length, 0)}`,
      note: filteredManifests.length === manifests.length ? "No Fetch Jobs filters are hiding manifests." : `${numberText(Math.max(0, manifests.length - filteredManifests.length), 0)} hidden by filters.`,
    },
    {
      status: activeJobs.length ? "warn" : manifests.length ? "ok" : "idle",
      label: "Active",
      title: numberText(activeJobs.length, 0),
      note: activeJobs.length ? "Non-terminal manifests are still updating or incomplete." : "No active/non-terminal manifests loaded.",
    },
    {
      status: partialJobs.length || failedJobs.length ? "warn" : manifests.length ? "ok" : "bad",
      label: "Terminal Review",
      title: `${numberText(partialJobs.length, 0)} partial / ${numberText(failedJobs.length, 0)} failed`,
      note: "Partial/failed manifests should be inspected before broad retry.",
    },
    {
      status: retryEvents || pacingWaits ? "warn" : manifests.length ? "ok" : "idle",
      label: "Retry / Pace",
      title: `${numberText(retryEvents, 0)}R / ${numberText(pacingWaits, 0)}W`,
      note: pacingWaits ? `${interval(pacingSeconds)} total pacing wait time.` : "No retry or pacing pressure reported.",
    },
    {
      status: outputIssues ? "warn" : visibleOutputs ? "ok" : manifests.length ? "warn" : "bad",
      label: "Outputs",
      title: `${numberText(visibleOutputs, 0)} visible`,
      note: outputIssues ? `${numberText(outputIssues, 0)} output visibility issue${outputIssues === 1 ? "" : "s"}.` : "Visible outputs can be reviewed in Data Library.",
    },
    {
      status: selectedJob ? selectedIssueCount ? "warn" : selectedActive ? "warn" : "ok" : "idle",
      label: "Review Job",
      title: selectedJob ? fetchManifestLabel(selectedJob) : "none",
      note: selectedJob
        ? `${text(selectedJob.status)} / ${text(selectedJob.kind)} / ${text(selectedJob.bar_size)}.`
        : "No manifest is available to inspect.",
    },
  ];
  const lines = [
    {
      status: selectedJob ? selectedActive ? "warn" : selectedIssueCount ? "warn" : "ok" : "idle",
      title: selectedJob ? `Focus job: ${fetchManifestLabel(selectedJob)}` : "No focus job",
      detail: selectedJob
        ? `${rangeLabel(selectedJob.range_start, selectedJob.range_end || selectedJob.duration || selectedJob.months)}; rows ${numberText(selectedJob.rows, 0)}; status ${text(selectedJob.status)}.`
        : "No fetch manifest is loaded; configure roots or run a fetcher that writes JSON manifests.",
    },
    {
      status: selectedJob && (symbolTotal || symbolDone) ? "ok" : selectedJob ? "warn" : "idle",
      title: "Symbol progress",
      detail: selectedJob
        ? `${fetchProgressPair(symbolDone, symbolTotal)} symbols; ok ${numberText(selectedJob.success_symbols, 0)}, empty ${numberText(selectedJob.empty_symbols, 0)}, failed ${numberText(selectedJob.failed_symbols, 0)}, skipped ${numberText(selectedJob.skipped_symbols, 0)}.`
        : "No symbol progress available.",
    },
    {
      status: selectedJob && (chunkTotal || chunkDone) ? "ok" : selectedJob ? "warn" : "idle",
      title: "Chunk progress",
      detail: selectedJob
        ? `${fetchProgressPair(chunkDone, chunkTotal)} chunks; ok ${numberText(selectedJob.success_chunks, 0)}, empty ${numberText(selectedJob.empty_chunks, 0)}, failed ${numberText(selectedJob.failed_chunks, 0)}.`
        : "No chunk progress available.",
    },
    {
      status: selectedJob && (eta || avgChunk || avgSymbol) ? "ok" : selectedJob ? "warn" : "idle",
      title: "ETA and pace",
      detail: selectedJob
        ? [eta ? `ETA ${eta}` : "", avgChunk ? `avg chunk ${avgChunk}` : "", avgSymbol ? `avg symbol ${avgSymbol}` : "", selectedJob.pacing_wait_events ? `${numberText(selectedJob.pacing_wait_events, 0)} waits` : "", selectedJob.retry_events ? `${numberText(selectedJob.retry_events, 0)} retries` : ""].filter(Boolean).join("; ") || "This manifest has no latest ETA or rolling average fields."
        : "No pacing evidence available.",
    },
    {
      status: selectedJob ? selectedIssueCount ? "warn" : "ok" : "idle",
      title: "Recovery and visibility",
      detail: selectedJob
        ? `Recovery ${text(selectedJob.recovery_status || "n/a")} / ${text(selectedJob.recovery_action || "n/a")}; visible outputs ${numberText(selectedJob.output_visible_count || selectedJob.visible_output_count, 0)}; output issues ${numberText(fetchManifestOutputIssueCount(selectedJob), 0)}.`
        : "No recovery plan or output visibility is available.",
    },
  ];
  return { headline, note, cards, lines, selectedJob };
}

export function fetchProgressReviewText(model) {
  return [
    `Fetch Progress Review: ${model.headline}`,
    `Next action: ${model.note}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

export function renderFetchProgressReview(context = {}) {
  if (
    !$("fetch-progress-review-title")
    || !$("fetch-progress-review-note")
    || !$("fetch-progress-review-cards")
    || !$("fetch-progress-review-body")
    || !$("fetch-progress-review-actions")
  ) return;
  const model = fetchProgressReviewModel(context);
  state.fetchProgressReviewText = fetchProgressReviewText(model);
  $("fetch-progress-review-title").textContent = model.headline;
  $("fetch-progress-review-note").textContent = model.note;
  $("fetch-progress-review-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("fetch-progress-review-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("fetch-progress-review-actions").innerHTML = [
    `<button type="button" data-fetch-progress-action="copy">Copy Review</button>`,
    `<button type="button" class="secondary" data-fetch-progress-action="inspect"${model.selectedJob ? "" : " disabled"}>Inspect Focus Job</button>`,
    `<button type="button" class="secondary" data-fetch-progress-action="jobs">Jobs Table</button>`,
    `<button type="button" class="secondary" data-fetch-progress-action="export">Export Jobs CSV</button>`,
    `<button type="button" class="secondary" data-fetch-progress-action="roots">Copy Roots YAML</button>`,
  ].join("");
  $("fetch-progress-review-actions").dataset.focusJobId = model.selectedJob ? text(model.selectedJob.job_id) : "";
}

export function handleFetchProgressAction(action) {
  if (action === "copy") {
    copyText(state.fetchProgressReviewText || "No fetch progress review loaded").then(() => {
      $("last-refresh").textContent = "Fetch progress review copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Fetch progress review copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "inspect") {
    const jobId = $("fetch-progress-review-actions").dataset.focusJobId || "";
    if (!jobId) {
      $("last-refresh").textContent = "No fetch job is available to inspect";
      return;
    }
    loadFetchManifestDetail(jobId).catch((err) => {
      $("last-refresh").textContent = `Fetch manifest detail failed: ${err.message}`;
    });
    return;
  }
  if (action === "jobs") return navigateToFetchLens("jobs");
  if (action === "export") {
    downloadFetchManifestsCsv().catch((err) => {
      $("last-refresh").textContent = `Fetch jobs CSV export failed: ${err.message}`;
    });
    return;
  }
  if (action === "roots") return copyFetchManifestRootsYaml();
}

export function recommendedFetchManifests(filteredManifests = []) {
  return (filteredManifests || [])
    .slice()
    .sort((left, right) => {
      const leftIssue = fetchManifestIssueCount(left) + fetchManifestOutputIssueCount(left);
      const rightIssue = fetchManifestIssueCount(right) + fetchManifestOutputIssueCount(right);
      if (leftIssue !== rightIssue) return rightIssue - leftIssue;
      const activeDelta = Number(!fetchJobTerminal(right.status)) - Number(!fetchJobTerminal(left.status));
      if (activeDelta) return activeDelta;
      const leftTime = timestampMillis(left.finished_at || left.started_at) || 0;
      const rightTime = timestampMillis(right.finished_at || right.started_at) || 0;
      if (leftTime !== rightTime) return rightTime - leftTime;
      return fetchManifestLabel(left).localeCompare(fetchManifestLabel(right));
    })
    .slice(0, 5);
}

export function renderFetchSearchAssistant(manifests = [], filteredManifests = []) {
  if (!$("fetch-search-title") || !$("fetch-search-cards") || !$("fetch-search-actions")) return;
  const filters = fetchJobFilters();
  const activeLabels = [
    filters.text ? `search ${filters.text}` : "",
    filters.status ? `status ${filters.status}` : "",
    filters.kind ? `kind ${filters.kind}` : "",
  ].filter(Boolean);
  const hidden = Math.max(0, manifests.length - filteredManifests.length);
  const activeJobs = filteredManifests.filter((item) => !fetchJobTerminal(item.status));
  const reviewJobs = filteredManifests.filter((item) => fetchManifestIssueCount(item) > 0 || fetchManifestOutputIssueCount(item) > 0);
  const visibleOutputs = filteredManifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = filteredManifests.reduce((sum, item) => sum + fetchManifestOutputIssueCount(item), 0);
  const retryEvents = filteredManifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = filteredManifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const statusCounts = countBy(filteredManifests, "status");
  const kindCounts = countBy(filteredManifests, "kind");
  $("fetch-search-title").textContent = manifests.length
    ? activeLabels.length
      ? `${numberText(filteredManifests.length, 0)} matching fetch job${filteredManifests.length === 1 ? "" : "s"}`
      : `${numberText(manifests.length, 0)} searchable fetch job${manifests.length === 1 ? "" : "s"}`
    : "No jobs loaded";
  $("fetch-search-note").textContent = manifests.length
    ? activeLabels.length
      ? `${activeLabels.join(" / ")}. ${numberText(hidden, 0)} job${hidden === 1 ? "" : "s"} hidden by current filters.`
      : "Use the filters to find failed pulls, active manifests, visible outputs, or a specific symbol/path."
    : "Run a fetcher that writes JSON manifests or configure dashboard.fetch_manifest_roots.";
  const cards = [
    {
      label: "Visible Jobs",
      status: filteredManifests.length ? "ok" : manifests.length ? "warn" : "bad",
      title: `${numberText(filteredManifests.length, 0)} / ${numberText(manifests.length, 0)}`,
      note: hidden ? `${numberText(hidden, 0)} hidden by filters.` : "All loaded jobs are visible.",
    },
    {
      label: "Status / Kind",
      status: filteredManifests.length ? "ok" : "warn",
      title: countSummary(statusCounts),
      note: `Kinds: ${countSummary(kindCounts)}.`,
    },
    {
      label: "Recovery Pressure",
      status: reviewJobs.length ? "warn" : filteredManifests.length ? "ok" : "bad",
      title: numberText(reviewJobs.length, 0),
      note: reviewJobs.length
        ? "Open a recommended job to see recovery plan, resume command, and output visibility."
        : filteredManifests.length ? "No matching job has summarized errors or output path issues." : "No matching jobs to review.",
    },
    {
      label: "Output Visibility",
      status: outputIssues ? "warn" : visibleOutputs ? "ok" : filteredManifests.length ? "warn" : "bad",
      title: `${numberText(visibleOutputs, 0)} visible`,
      note: outputIssues ? `${numberText(outputIssues, 0)} output path issue${outputIssues === 1 ? "" : "s"}.` : "Visible outputs can move into Data Library from Fetch Detail.",
    },
    {
      label: "Active / Pace",
      status: activeJobs.length || retryEvents || pacingWaits ? "warn" : filteredManifests.length ? "ok" : "bad",
      title: `${numberText(activeJobs.length, 0)} active`,
      note: `${numberText(retryEvents, 0)} retries / ${numberText(pacingWaits, 0)} pacing waits in matching jobs.`,
    },
  ];
  $("fetch-search-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const recommendations = recommendedFetchManifests(filteredManifests);
  $("fetch-search-actions").innerHTML = recommendations.length
    ? recommendations.map((item) => {
        const issueCount = fetchManifestIssueCount(item) + fetchManifestOutputIssueCount(item);
        const visible = Number(item.output_visible_count || item.visible_output_count || 0);
        const status = issueCount ? "warn" : fetchJobTerminal(item.status) ? "ok" : "warn";
        return `
          <div class="fetch-search-action-card status-${escapeHtml(status)}">
            <div>
              <span>${statusText(status)}</span>
              <strong>${escapeHtml(fetchManifestLabel(item))}</strong>
              <small>${escapeHtml(text(item.kind))} / ${escapeHtml(text(item.status))} / ${escapeHtml(text(item.bar_size))} / ${escapeHtml(rangeLabel(item.range_start, item.range_end || item.duration || item.months))}</small>
              <small>${escapeHtml(numberText(item.rows, 0))} rows / visible outputs ${escapeHtml(numberText(visible, 0))} / issues ${escapeHtml(numberText(issueCount, 0))}</small>
            </div>
            <div>
              <button type="button" data-fetch-search-action="inspect" data-job-id="${escapeHtml(item.job_id)}">Inspect</button>
              <button type="button" class="secondary" data-fetch-search-action="status" data-status="${escapeHtml(text(item.status))}">Status</button>
              <button type="button" class="secondary" data-fetch-search-action="kind" data-kind="${escapeHtml(text(item.kind))}">Kind</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No recommended fetch jobs</strong><span>Clear filters or configure manifest roots to load fetch jobs.</span></div>`;
}

export function handleFetchSearchAction(target) {
  const action = String(target.dataset.fetchSearchAction || "");
  if (action === "inspect") {
    loadFetchManifestDetail(target.dataset.jobId || "").catch((err) => {
      $("last-refresh").textContent = `Fetch manifest detail failed: ${err.message}`;
    });
    return;
  }
  if (action === "status") {
    $("fetch-filter-status").value = target.dataset.status || "";
    renderFetchJobs();
    return;
  }
  if (action === "kind") {
    $("fetch-filter-kind").value = target.dataset.kind || "";
    renderFetchJobs();
  }
}

export function fetchOutputVisibilityHtml(item) {
  const visible = Number(item.output_visible_count || 0);
  const missing = Number(item.output_missing_file_count || 0);
  const outside = Number(item.output_outside_data_roots_count || 0);
  const noPath = Number(item.output_no_path_count || 0);
  const unsupported = Number(item.output_unsupported_file_count || 0);
  const issueCount = missing + outside + noPath + unsupported;
  const status = issueCount ? "warn" : visible ? "ok" : "idle";
  const detail = [
    `visible ${numberText(visible, 0)}`,
    missing ? `missing ${numberText(missing, 0)}` : "",
    outside ? `outside ${numberText(outside, 0)}` : "",
    noPath ? `no path ${numberText(noPath, 0)}` : "",
    unsupported ? `unsupported ${numberText(unsupported, 0)}` : "",
  ].filter(Boolean).join(" / ") || "n/a";
  return `<span class="${statusClass(status)}">${escapeHtml(detail)}</span>`;
}

export function fetchJobTerminal(status) {
  return ["completed", "failed", "partial", "cancelled", "canceled"].includes(text(status).toLowerCase());
}

export function fetchManifestIssueCount(manifest) {
  return [
    manifest.errors,
    manifest.failed_symbols,
    manifest.failed_chunks,
    manifest.output_missing_file_count,
    manifest.output_outside_data_roots_count,
    manifest.output_unsupported_file_count,
  ].reduce((sum, value) => sum + Number(value || 0), 0);
}

export function renderFetchTriageCards(context = {}) {
  if (!$("fetch-triage-cards") || !$("fetch-triage-note")) return;
  const manifests = context.manifests || [];
  const filteredManifests = context.filteredManifests || manifests;
  const roots = context.roots || [];
  const rootConfigPaths = context.rootConfigPaths || [];
  const activeJobs = manifests.filter((item) => !fetchJobTerminal(item.status));
  const failedJobs = manifests.filter((item) => fetchManifestIssueCount(item) > 0);
  const retryEvents = manifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const pacingSeconds = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_seconds || 0), 0);
  const outputVisible = manifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = manifests.reduce((sum, item) => (
    sum +
    Number(item.output_missing_file_count || 0) +
    Number(item.output_outside_data_roots_count || 0) +
    Number(item.output_unsupported_file_count || 0)
  ), 0);
  const rootManifestCount = roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0);
  const cards = [
    {
      status: roots.length && rootManifestCount ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      title: roots.length ? `${numberText(rootManifestCount, 0)} files` : "No Roots",
      label: "Manifest Roots",
      note: roots.length
        ? `${numberText(roots.length, 0)} configured root${roots.length === 1 ? "" : "s"} are scanned.`
        : "Add dashboard.fetch_manifest_roots or run a fetcher that writes JSON manifests.",
    },
    {
      status: activeJobs.length ? "warn" : manifests.length ? "ok" : "idle",
      title: numberText(activeJobs.length, 0),
      label: "Active Jobs",
      note: activeJobs.length
        ? "One or more manifests look non-terminal; inspect progress before starting another pull."
        : manifests.length
          ? "No active/non-terminal fetch jobs in the loaded manifest list."
          : "No fetch manifests are loaded.",
    },
    {
      status: failedJobs.length ? "warn" : manifests.length ? "ok" : "idle",
      title: numberText(failedJobs.length, 0),
      label: "Jobs Needing Review",
      note: failedJobs.length
        ? "Filter by errors or inspect a job to copy a resume command and review blockers."
        : manifests.length
          ? "Loaded jobs have no summarized errors, failed symbols, failed chunks, or output visibility issues."
          : "Load manifests before reviewing failures.",
    },
    {
      status: outputIssues ? "warn" : outputVisible ? "ok" : manifests.length ? "warn" : "idle",
      title: `${numberText(outputVisible, 0)} visible`,
      label: "Output Visibility",
      note: outputIssues
        ? `${numberText(outputIssues, 0)} output path issue${outputIssues === 1 ? "" : "s"} need root/path review.`
        : outputVisible
          ? "Visible outputs can be opened from Fetch Detail or filtered in Data Library."
          : "Select a manifest to annotate output paths against configured data roots.",
    },
    {
      status: retryEvents || pacingWaits ? "warn" : manifests.length ? "ok" : "idle",
      title: `${numberText(retryEvents, 0)}R / ${numberText(pacingWaits, 0)}W`,
      label: "Retries / Waits",
      note: pacingWaits
        ? `${interval(pacingSeconds)} of pacing waits recorded across loaded jobs.`
        : retryEvents
          ? "Retry events are present; inspect detail for symbols and attempts."
          : "No retry or pacing events summarized in loaded manifests.",
    },
  ];
  $("fetch-triage-note").textContent = manifests.length
    ? `${numberText(filteredManifests.length, 0)} shown / ${numberText(manifests.length, 0)} loaded; ${numberText(context.rowsTotal || 0, 0)} rows`
    : "No fetch manifests loaded";
  $("fetch-triage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function fetchWorkflowCards(context = {}) {
  const manifests = context.manifests || [];
  const filteredManifests = context.filteredManifests || manifests;
  const roots = context.roots || [];
  const rootConfigPaths = context.rootConfigPaths || [];
  const detail = state.fetchManifestDetail || {};
  const activeJobs = manifests.filter((item) => !fetchJobTerminal(item.status));
  const jobsNeedingReview = manifests.filter((item) => fetchManifestIssueCount(item) > 0);
  const visibleOutputPaths = fetchVisibleOutputPaths(detail);
  const outputVisible = manifests.reduce((sum, item) => sum + Number(item.output_visible_count || item.visible_output_count || 0), 0);
  const outputIssues = manifests.reduce((sum, item) => (
    sum +
    Number(item.output_missing_file_count || 0) +
    Number(item.output_outside_data_roots_count || 0) +
    Number(item.output_unsupported_file_count || 0)
  ), 0);
  const retryEvents = manifests.reduce((sum, item) => sum + Number(item.retry_events || 0), 0);
  const pacingWaits = manifests.reduce((sum, item) => sum + Number(item.pacing_wait_events || 0), 0);
  const rootManifestCount = roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0);
  const selectedHasFailures = Number((detail.counts || {}).failed_symbols || detail.failed_symbols || 0) > 0
    || Number((detail.counts || {}).failed_chunks || detail.failed_chunks || 0) > 0
    || Number((detail.counts || {}).errors || detail.error_total || 0) > 0;
  const resumeCommand = fetchResumeCommand(detail);

  return [
    {
      label: "Configure Roots",
      title: roots.length ? `${numberText(rootManifestCount, 0)} manifests` : "No Roots",
      value: roots.length ? `${numberText(roots.length, 0)} roots` : `${numberText(rootConfigPaths.length, 0)} config paths`,
      status: roots.length && rootManifestCount ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      detail: roots.length
        ? "Fetch manifests are readable from configured roots."
        : "Add dashboard.fetch_manifest_roots or run a fetcher that writes JSON manifests.",
      href: workflowHref("fetch", "home"),
      cta: "Roots",
    },
    {
      label: "Monitor Jobs",
      title: activeJobs.length ? `${numberText(activeJobs.length, 0)} active` : manifests.length ? "No Active" : "No Jobs",
      value: `${numberText(filteredManifests.length, 0)} shown`,
      status: activeJobs.length ? "warn" : manifests.length ? "ok" : "idle",
      detail: activeJobs.length
        ? "Inspect active/non-terminal jobs before starting another fetch."
        : manifests.length ? "Use the Jobs lens to scan completed and failed fetches." : "No fetch manifest rows are loaded.",
      href: workflowHref("fetch", "jobs"),
      cta: "Jobs",
    },
    {
      label: "Recover Failures",
      title: detail.job_id ? text(detail.recovery_status || detail.status || "selected") : jobsNeedingReview.length ? `${numberText(jobsNeedingReview.length, 0)} review` : "No Detail",
      value: detail.job_id && resumeCommand ? "resume ready" : `${numberText(retryEvents, 0)}R/${numberText(pacingWaits, 0)}W`,
      status: detail.job_id ? selectedHasFailures ? resumeCommand ? "ok" : "warn" : "ok" : jobsNeedingReview.length ? "warn" : manifests.length ? "ok" : "idle",
      detail: detail.job_id
        ? selectedHasFailures ? "Selected job has failed work; review recovery plan and copy resume command when available." : "Selected job has no summarized failed symbols/chunks."
        : jobsNeedingReview.length ? "Open a job with failures or output issues to see recovery guidance." : "No loaded job currently reports recovery pressure.",
      href: workflowHref("fetch", "detail"),
      cta: "Recover",
    },
    {
      label: "Review Outputs",
      title: detail.job_id ? `${numberText(visibleOutputPaths.length, 0)} visible` : `${numberText(outputVisible, 0)} visible`,
      value: outputIssues ? `${numberText(outputIssues, 0)} issues` : "paths ok",
      status: detail.job_id ? visibleOutputPaths.length ? "ok" : Number(detail.output_total || 0) ? "warn" : "bad" : outputIssues ? "warn" : outputVisible ? "ok" : manifests.length ? "warn" : "bad",
      detail: detail.job_id
        ? visibleOutputPaths.length ? "Selected job outputs can be filtered into Data Library." : "Selected job outputs are missing, unsupported, outside configured roots, or absent."
        : outputVisible ? "Open a manifest detail to filter produced files into Data Library." : "Output visibility needs a selected manifest or configured data roots.",
      href: workflowHref("fetch", "detail"),
      cta: "Outputs",
    },
    {
      label: "Open Saved Data",
      title: visibleOutputPaths.length ? "Ready" : "Needs Visible Outputs",
      value: visibleOutputPaths.length ? `${numberText(visibleOutputPaths.length, 0)} files` : "none selected",
      status: visibleOutputPaths.length ? "ok" : detail.job_id ? "warn" : "idle",
      detail: visibleOutputPaths.length
        ? "Use Show Outputs in Data Library, Compare Outputs, or Copy Output Paths from Fetch Detail."
        : "Select a job with Data Library-visible output files first.",
      href: workflowHref(visibleOutputPaths.length ? "data" : "fetch", visibleOutputPaths.length ? "browse" : "detail"),
      cta: visibleOutputPaths.length ? "Data" : "Select Job",
    },
    {
      label: "Simulate Outputs",
      title: visibleOutputPaths.length ? "Workbench Ready" : "Not Ready",
      value: visibleOutputPaths.length ? `${numberText(visibleOutputPaths.length, 0)} inputs` : "no inputs",
      status: visibleOutputPaths.length ? "ok" : detail.job_id ? "warn" : "bad",
      detail: visibleOutputPaths.length
        ? "Send the selected fetch's visible outputs into Workbench with the manifest date range."
        : "Fetch outputs need to be visible under configured data roots before Workbench handoff.",
      href: workflowHref(visibleOutputPaths.length ? "workbench" : "fetch", visibleOutputPaths.length ? "builder" : "detail"),
      cta: "Workbench",
    },
  ];
}

export function renderFetchWorkflowLauncher(context = {}) {
  const container = $("fetch-workflows");
  if (!container) return;
  const cards = fetchWorkflowCards(context);
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

export function renderFetchJobsGuide(context = {}) {
  if (!$("fetch-jobs-guide") || !$("fetch-jobs-guide-note")) return;
  const payload = state.fetchManifests || {};
  const manifests = context.manifests || payload.manifests || [];
  const filteredManifests = context.filteredManifests || filteredFetchManifests(manifests);
  const roots = context.roots || payload.roots || [];
  const rootConfigPaths = context.rootConfigPaths || fetchManifestRootConfigPaths();
  const detail = state.fetchManifestDetail || {};
  const existingRoots = roots.filter((root) => root.exists && root.is_dir);
  const rootManifestCount = roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0);
  const failedJobs = manifests.filter((item) => Number(item.errors || 0) || Number(item.failed_symbols || 0) || Number(item.failed_chunks || 0));
  const terminalJobs = manifests.filter((item) => ["completed", "failed", "partial", "cancelled"].includes(text(item.status).toLowerCase()));
  const activeJobs = manifests.filter((item) => !["completed", "failed", "partial", "cancelled"].includes(text(item.status).toLowerCase()));
  const visibleOutputPaths = fetchVisibleOutputPaths(detail);
  const outputTotal = Number(detail.output_total || 0);
  const selectedHasFailures = Number((detail.counts || {}).failed_symbols || detail.failed_symbols || 0) > 0
    || Number((detail.counts || {}).failed_chunks || detail.failed_chunks || 0) > 0
    || Number((detail.counts || {}).errors || detail.error_total || 0) > 0;
  const resumeCommand = fetchResumeCommand(detail);
  const steps = [
    {
      status: existingRoots.length ? "ok" : rootConfigPaths.length ? "warn" : "bad",
      label: "Configure Manifest Roots",
      detail: existingRoots.length
        ? `${numberText(existingRoots.length, 0)} active root${existingRoots.length === 1 ? "" : "s"} with ${numberText(rootManifestCount, 0)} manifest file${rootManifestCount === 1 ? "" : "s"}.`
        : rootConfigPaths.length
          ? "Roots are configured but none are currently readable directories."
          : "Add dashboard.fetch_manifest_roots or run a fetcher that writes JSON manifests.",
    },
    {
      status: manifests.length ? "ok" : existingRoots.length ? "warn" : "idle",
      label: "Load Jobs",
      detail: manifests.length
        ? `${numberText(manifests.length, 0)} job${manifests.length === 1 ? "" : "s"} loaded; ${numberText(activeJobs.length, 0)} active and ${numberText(terminalJobs.length, 0)} terminal.`
        : existingRoots.length
          ? "Roots are readable, but no manifest JSON files were found yet."
          : "No readable manifest roots are available.",
    },
    {
      status: !manifests.length ? "idle" : failedJobs.length ? "warn" : "ok",
      label: "Review Failures",
      detail: !manifests.length
        ? "No jobs loaded to review."
        : failedJobs.length
          ? `${numberText(failedJobs.length, 0)} job${failedJobs.length === 1 ? "" : "s"} have errors, failed symbols, or failed chunks.`
          : "No loaded job reports errors or failed chunks.",
    },
    {
      status: filteredManifests.length ? "ok" : manifests.length ? "warn" : "idle",
      label: "Find a Job",
      detail: filteredManifests.length
        ? `${numberText(filteredManifests.length, 0)} job${filteredManifests.length === 1 ? "" : "s"} match the current search/filter.`
        : manifests.length
          ? "Current filters hide every loaded job; clear search/status/kind filters."
          : "Load manifests before filtering.",
    },
    {
      status: detail.job_id ? (outputTotal ? "ok" : "warn") : manifests.length ? "warn" : "idle",
      label: "Inspect Outputs",
      detail: detail.job_id
        ? outputTotal
          ? `${text(detail.job_id)} records ${numberText(outputTotal, 0)} output row${outputTotal === 1 ? "" : "s"}.`
          : `${text(detail.job_id)} is selected but records no output paths.`
        : manifests.length
          ? "Click Inspect on a job to see symbol progress, output visibility, errors, and events."
          : "No job is available to inspect.",
    },
    {
      status: !detail.job_id ? "warn" : visibleOutputPaths.length ? "ok" : outputTotal ? "warn" : "idle",
      label: "Open Saved Data",
      detail: !detail.job_id
        ? "Select a job first; visible output files can jump directly into Data Library."
        : visibleOutputPaths.length
          ? `${numberText(visibleOutputPaths.length, 0)} produced file${visibleOutputPaths.length === 1 ? "" : "s"} are visible in configured data roots.`
          : outputTotal
            ? "Outputs exist, but they are missing, outside configured data roots, or unsupported."
            : "The selected job has no output paths to connect to Data Library.",
    },
    {
      status: !detail.job_id ? "warn" : selectedHasFailures ? (resumeCommand ? "ok" : "warn") : "ok",
      label: "Recover or Export",
      detail: !detail.job_id
        ? "Select a job to copy a resume command or export the detailed rows."
        : selectedHasFailures && resumeCommand
          ? "Copy Resume Command for failed work, or Export Detail CSV for offline review."
          : selectedHasFailures
            ? "Export Detail CSV and manually reconstruct the retry command for this job type."
            : "Export Detail CSV if you want a portable audit of symbols, outputs, errors, and events.",
    },
  ];
  const ready = steps.filter((step) => step.status === "ok").length;
  $("fetch-jobs-guide-note").textContent = `${ready} of ${steps.length} steps ready`;
  $("fetch-jobs-guide").innerHTML = steps.map((step) => (
    `<div class="check-item status-${escapeHtml(step.status)}"><span>${escapeHtml(step.status)}</span><div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div></div>`
  )).join("");
}

export function renderFetchManifestDetail() {
  const detail = state.fetchManifestDetail || {};
  const resumeCommand = fetchResumeCommand(detail);
  const visibleOutputPaths = fetchVisibleOutputPaths(detail);
  $("fetch-detail-title").textContent = detail.job_id
    ? `${text(detail.job_id)} - ${text(detail.status)}`
    : "No fetch job selected";
  $("copy-fetch-resume-command").disabled = !resumeCommand;
  $("show-fetch-outputs-data").disabled = !visibleOutputPaths.length;
  $("compare-fetch-outputs").disabled = visibleOutputPaths.length < 2;
  $("use-fetch-outputs-workbench").disabled = !visibleOutputPaths.length;
  $("copy-fetch-output-paths").disabled = !visibleOutputPaths.length;
  $("export-fetch-detail-csv").disabled = !detail.job_id;
  const counts = detail.counts || {};
  const plan = detail.plan || {};
  const resumePlan = detail.resume_plan || {};
  const parameters = detail.parameters || {};
  $("fetch-recovery-cards").innerHTML = fetchRecoveryCards(detail, resumeCommand);
  $("fetch-recovery-plan").innerHTML = fetchRecoveryPlan(detail, resumeCommand, visibleOutputPaths);
  renderFetchResumePanel(detail, resumeCommand);
  const pairs = [
    ["Job", text(detail.job_id)],
    ["Kind", text(detail.kind)],
    ["Status", text(detail.status)],
    ["Started", text(detail.started_at)],
    ["Finished", text(detail.finished_at)],
    ["Last Activity", detail.last_event_at ? `${timestampAgeLabel(detail.last_event_at)} / ${text(detail.last_event_source)}` : "n/a"],
    ["Bar / Range", `${text(parameters.bar_size)} ${rangeLabel(plan.range_start || parameters.start, plan.range_end || parameters.end || parameters.duration)}`],
    ["Symbols", jsonDrilldown(counts.status_counts || {}, countSummary(counts.status_counts || {})), true],
    ["Outputs", `${numberText(detail.output_total, 0)} total / rows ${numberText(counts.rows, 0)}`],
    ["Data Library Visibility", jsonDrilldown(detail.output_visibility_counts || {}, countSummary(detail.output_visibility_counts || {})), true],
    ["Output Statuses", jsonDrilldown(counts.output_status_counts || {}, countSummary(counts.output_status_counts || {})), true],
    ["Errors", `${escapeHtml(numberText(detail.error_total, 0))} total ${jsonDrilldown(counts.error_kind_counts || {}, countSummary(counts.error_kind_counts || {}))}`, true],
    ["Recovery", `${text(detail.recovery_status)} / ${text(detail.recovery_action)} - ${text(detail.recovery_note)}`],
    ["Resume Scope", resumePlan.resume_summary ? jsonDrilldown(resumePlan, resumePlan.resume_summary) : "n/a", Boolean(resumePlan.resume_summary)],
    ["Retries", `${numberText(counts.retry_events, 0)} retry events`],
    ["Pacing Waits", `${numberText(counts.pacing_wait_events, 0)} waits / ${interval(counts.pacing_wait_seconds)}`],
    ["Latest ETA", counts.latest_eta_seconds !== null && counts.latest_eta_seconds !== undefined ? interval(counts.latest_eta_seconds) : "n/a"],
    ["Avg Chunk", counts.latest_avg_chunk_seconds !== null && counts.latest_avg_chunk_seconds !== undefined ? interval(counts.latest_avg_chunk_seconds) : "n/a"],
    ["Symbol Progress", counts.latest_completed_symbols !== null && counts.latest_completed_symbols !== undefined ? `${numberText(counts.latest_completed_symbols, 0)} / ${numberText(counts.latest_total_symbols || counts.requested_symbols, 0)}` : "n/a"],
    ["Avg Symbol", counts.latest_avg_symbol_seconds !== null && counts.latest_avg_symbol_seconds !== undefined ? interval(counts.latest_avg_symbol_seconds) : "n/a"],
    ["Resume", resumeCommand || "n/a"],
    ["Output Dir", text(parameters.out_dir)],
    ["Manifest", text(detail.path)],
  ];
  $("fetch-detail-summary").innerHTML = kvRows(pairs, { mono: true });

  const symbols = detail.symbols || [];
  $("fetch-symbols-body").innerHTML = symbols.length
    ? symbols.map((item) => row([
        escapeHtml(item.symbol),
        statusText(item.status),
        escapeHtml(numberText(item.bars, 0)),
        escapeHtml(`${numberText(item.chunks_completed, 0)} / fail ${numberText(item.chunks_failed, 0)} / skip ${numberText(item.chunks_skipped, 0)}`),
        escapeHtml(rangeLabel(item.first_timestamp, item.last_timestamp)),
        escapeHtml(item.message),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);

  const errors = detail.errors || [];
  $("fetch-errors-body").innerHTML = errors.length
    ? errors.slice().reverse().map((item) => row([
        escapeHtml(item.timestamp),
        escapeHtml(item.symbol),
        statusText(item.kind),
        escapeHtml(item.day),
        escapeHtml(numberText(item.attempt_count, 0)),
        escapeHtml(item.message),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);

  const events = (detail.events || []).filter((item) => item.type === "retry" || item.type === "pacing_wait");
  $("fetch-events-note").textContent = detail.job_id
    ? `${numberText(events.length, 0)} retry/pacing events shown`
    : "No retry or pacing events selected";
  $("fetch-events-body").innerHTML = events.length
    ? events.slice().reverse().map((item) => row([
        escapeHtml(item.timestamp),
        statusText(item.type === "retry" ? "warn" : "ok"),
        escapeHtml(item.symbol),
        escapeHtml(item.day),
        escapeHtml(item.type === "retry"
          ? `attempt ${numberText(item.attempt, 0)} / max ${numberText(item.max_retries, 0)} after ${interval(item.delay_seconds)}: ${text(item.message)}`
          : `${text(item.reason)} ${interval(item.seconds)}`),
      ])).join("")
    : row([`<span class="muted">No retry or pacing events recorded in this manifest.</span>`, "", "", "", ""]);

  const outputs = detail.outputs || [];
  $("fetch-output-note").textContent = detail.job_id
    ? `${numberText(outputs.length, 0)} shown / ${numberText(detail.output_total, 0)} total`
    : "No output rows selected";
  $("fetch-outputs-body").innerHTML = outputs.length
    ? outputs.slice().reverse().map((item) => row([
        escapeHtml(item.timestamp),
        escapeHtml(item.symbol),
        statusText(item.status),
        escapeHtml(item.day),
        escapeHtml(numberText(item.rows, 0)),
        escapeHtml(`${interval(item.elapsed_seconds)} / ${numberText(item.attempt_count, 0)} attempts`),
        escapeHtml(rangeLabel(item.first_timestamp, item.last_timestamp)),
        fetchOutputReplayReadiness(item),
        `<span class="mono">${escapeHtml(item.path)}</span>`,
        item.data_detail_available
          ? `<button type="button" class="secondary inspect-data" data-path="${escapeHtml(item.data_detail_path)}">Inspect Data</button>`
          : `<span class="muted">${escapeHtml(fetchOutputVisibilityLabel(item))}</span>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", ""]);
  renderFetchJobsGuide();
}

export function applyFetchOutputDataFilter() {
  const detail = state.fetchManifestDetail || {};
  const paths = fetchVisibleOutputPaths(detail);
  if (!paths.length) {
    $("last-refresh").textContent = "Selected fetch has no Data Library-visible outputs";
    return;
  }
  state.manifestPathFilter = {
    job_id: detail.job_id || "selected fetch",
    paths,
  };
  $("data-filter-text").value = "";
  $("data-filter-quality").value = "";
  $("data-filter-bar").value = "";
  $("data-filter-asset").value = "";
  $("data-filter-source").value = "";
  $("data-filter-session").value = "";
  $("data-filter-contract").value = "";
  $("data-filter-replay").value = "";
  $("data-filter-sort").value = "modified_desc";
  navigateToDataLens("browse");
  renderDataCatalog();
  $("last-refresh").textContent = `Data Library locally filtered to ${numberText(paths.length, 0)} visible output${paths.length === 1 ? "" : "s"} from ${text(detail.job_id || "selected fetch")}`;
}

export function useFetchOutputsInWorkbench() {
  const detail = state.fetchManifestDetail || {};
  const paths = fetchVisibleOutputPaths(detail);
  if (!paths.length) {
    $("last-refresh").textContent = "Selected fetch has no Data Library-visible outputs for Workbench";
    return;
  }
  const datasetSelect = $("config-dataset");
  if (!datasetSelect) return;
  const selectedPaths = new Set(paths);
  for (const option of datasetSelect.options) {
    option.selected = selectedPaths.has(option.value);
  }
  const catalogByPath = new Map((state.dataCatalog.datasets || []).map((dataset) => [dataset.path, dataset]));
  for (const path of paths) {
    if (Array.from(datasetSelect.options).some((option) => option.value === path)) continue;
    const dataset = catalogByPath.get(path) || { path };
    rememberWorkbenchDataset(dataset);
    const option = document.createElement("option");
    option.value = path;
    option.textContent = `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${path}`;
    option.selected = true;
    attachDatasetOptionMetadata(option, dataset);
    datasetSelect.appendChild(option);
  }
  const plan = detail.plan || {};
  const parameters = detail.parameters || {};
  const start = dateInputValueFromTimestamp(plan.range_start || parameters.start);
  const end = dateInputValueFromTimestamp(plan.range_end || parameters.end);
  if ($("config-start-date")) $("config-start-date").value = start;
  if ($("config-end-date")) $("config-end-date").value = end;
  renderConfigLivePanels();
  navigateToWorkbenchLens("builder");
  window.setTimeout(() => {
    const target = $("workbench-stepper") || $("config-form");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 50);
  $("last-refresh").textContent = `Selected ${numberText(paths.length, 0)} fetch output${paths.length === 1 ? "" : "s"} for Workbench simulation`;
}

export async function compareFetchOutputs() {
  const detail = state.fetchManifestDetail || {};
  const paths = fetchVisibleOutputPaths(detail).slice(0, MAX_DATA_COMPARE_DATASETS);
  if (paths.length < 2) {
    $("last-refresh").textContent = "Selected fetch needs at least two Data Library-visible outputs to compare";
    return;
  }
  state.dataCompareSelectedPaths = paths;
  state.dataCompareSelectionCleared = false;
  $("data-compare-filter").value = "";
  $("data-compare-asset").value = "";
  $("data-compare-source").value = "";
  $("data-compare-bar").value = "";
  $("data-compare-session").value = "";
  $("data-compare-quality").value = "";
  $("data-compare-contract").value = "";
  $("data-compare-range-preset").value = "custom";
  const plan = detail.plan || {};
  const parameters = detail.parameters || {};
  $("data-compare-start").value = dateInputValueFromTimestamp(plan.range_start || parameters.start);
  $("data-compare-end").value = dateInputValueFromTimestamp(plan.range_end || parameters.end);
  renderDataCompareControls();
  await loadDataCompare();
  navigateToDataLens("compare");
  if ($("data-compare-form")) $("data-compare-form").scrollIntoView({ block: "start", behavior: "smooth" });
  $("last-refresh").textContent = `Compared ${numberText(paths.length, 0)} visible output${paths.length === 1 ? "" : "s"} from ${text(detail.job_id || "selected fetch")}`;
}

export function copyFetchVisibleOutputPaths() {
  const detail = state.fetchManifestDetail || {};
  const paths = fetchVisibleOutputPaths(detail);
  if (!paths.length) {
    $("last-refresh").textContent = "Selected fetch has no Data Library-visible output paths";
    return;
  }
  copyText(paths.join("\n")).then(() => {
    $("last-refresh").textContent = `Copied ${numberText(paths.length, 0)} visible fetch output path${paths.length === 1 ? "" : "s"}`;
  }).catch((err) => {
    $("last-refresh").textContent = `Copy failed: ${err.message}`;
  });
}

export function copyDataRootsYaml() {
  const snippet = dataRootsYamlSnippet();
  const count = dataRootConfigPaths().length;
  if (!snippet) {
    $("last-refresh").textContent = "No configured or suggested data roots to copy";
    return;
  }
  copyText(snippet).then(() => {
    $("last-refresh").textContent = `Copied dashboard.data_roots YAML for ${numberText(count, 0)} root${count === 1 ? "" : "s"}`;
  }).catch((err) => {
    $("last-refresh").textContent = `Copy failed: ${err.message}`;
  });
}

export function copyFetchManifestRootsYaml() {
  const snippet = fetchManifestRootsYamlSnippet();
  const count = fetchManifestRootConfigPaths().length;
  if (!snippet) {
    $("last-refresh").textContent = "No configured fetch manifest roots to copy";
    return;
  }
  copyText(snippet).then(() => {
    $("last-refresh").textContent = `Copied dashboard.fetch_manifest_roots YAML for ${numberText(count, 0)} root${count === 1 ? "" : "s"}`;
  }).catch((err) => {
    $("last-refresh").textContent = `Copy failed: ${err.message}`;
  });
}

export function fetchOutputVisibilityLabel(item) {
  if (!item || item.data_detail_available) return "visible";
  if (item.data_detail_status === "missing_file") return "missing file";
  if (item.data_detail_status === "outside_data_roots") return "outside data roots";
  if (item.data_detail_status === "no_path") return "no path";
  if (item.data_detail_status === "unsupported_file") return "unsupported file";
  return text(item.data_detail_reason || item.data_detail_status || "not inspectable");
}

export function dataCatalogDatasetByPath(path) {
  const target = text(path);
  if (!target || target === "n/a") return null;
  return (state.dataCatalog.datasets || []).find((dataset) => text(dataset.path) === target) || null;
}

export function fetchOutputReplayReadiness(item) {
  if (!item || !item.data_detail_available) {
    const label = fetchOutputVisibilityLabel(item);
    const status = item && item.data_detail_status === "missing_file" ? "bad" : "warn";
    return `
      <div class="data-readiness-cell ${escapeHtml(statusClass(status))}">
        <strong>${escapeHtml(status === "bad" ? "Missing" : "Not Visible")}</strong>
        <span>${escapeHtml(label)}</span>
        <small>Fix output path or data roots before replay.</small>
      </div>
    `;
  }
  const dataset = dataCatalogDatasetByPath(item.data_detail_path || item.path);
  if (dataset) return dataReplayReadiness(dataset);
  return `
    <div class="data-readiness-cell ${escapeHtml(statusClass("warn"))}">
      <strong>Review</strong>
      <span>Visible output is not in the current bounded catalog scan.</span>
      <small>Refresh Data Library or raise Rows to scan.</small>
    </div>
  `;
}

export function renderFetchResumePanel(detail, resumeCommand = "") {
  if (!$("fetch-resume-note") || !$("fetch-resume-cards") || !$("fetch-resume-command")) return;
  const resumePlan = (detail && detail.resume_plan) || {};
  const resumeState = (detail && detail.resume_state) || {};
  const hasJob = Boolean(detail && detail.job_id);
  const supported = Boolean(resumeCommand);
  const retryCount = Number(resumePlan.retry_failed_count || (detail && detail.resume_retry_count) || 0);
  const skipCount = Number(resumePlan.skip_completed_count || (detail && detail.resume_skip_count) || 0);
  const reviewCount = Number(resumePlan.review_no_data_count || (detail && detail.resume_review_count) || 0);
  const pendingCount = Number(resumePlan.pending_estimate || (detail && detail.resume_pending_estimate) || 0);
  $("fetch-resume-note").textContent = hasJob
    ? supported
      ? text(resumePlan.resume_summary || "Resume command is available for this manifest.")
      : "This selected manifest is not resumable through the built-in fetch resume command."
    : "Select a resumable fetch job to see retry scope.";
  const cards = [
    {
      status: supported ? "ok" : hasJob ? "warn" : "waiting",
      label: "Command",
      title: supported ? "Available" : "Unavailable",
      note: supported ? "Copy and run locally after fixing any listed blockers." : "Stock and crypto history manifests expose built-in resume commands.",
    },
    {
      status: skipCount ? "ok" : supported ? "warn" : "waiting",
      label: "Skip",
      title: numberText(skipCount, 0),
      note: "Completed/empty work the fetcher can skip when resuming.",
    },
    {
      status: retryCount ? "warn" : supported ? "ok" : "waiting",
      label: "Retry",
      title: numberText(retryCount, 0),
      note: "Failed or incomplete work estimated for retry.",
    },
    {
      status: reviewCount ? "warn" : supported ? "ok" : "waiting",
      label: "Review",
      title: numberText(reviewCount, 0),
      note: "No-data rows to inspect before deciding whether to force a refetch.",
    },
    {
      status: pendingCount ? "warn" : supported ? "ok" : "waiting",
      label: "Pending",
      title: numberText(pendingCount, 0),
      note: "Estimated unfinished work from the manifest plan.",
    },
  ];
  $("fetch-resume-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  if ($("fetch-resume-state-note")) {
    $("fetch-resume-state-note").textContent = resumeState && resumeState.summary
      ? `Manifest-owned state loaded: ${text(resumeState.summary)}`
      : hasJob
        ? "This manifest has no normalized resume_state; the resume plan is inferred from symbols, outputs, errors, and plan rows."
        : "Inspect a fetch manifest to see whether normalized resume_state is available.";
  }
  if ($("fetch-resume-state-cards")) {
    const stateCards = resumeState && resumeState.summary ? [
      {
        status: Number(resumeState.pending_symbol_count || resumeState.failed_day_count || 0) ? "warn" : "ok",
        label: "State",
        title: text((resumeState.resume_modes || []).join(", ") || "normalized"),
        note: text(resumeState.summary),
      },
      {
        status: Number(resumeState.done_symbol_count || resumeState.completed_output_path_count || 0) ? "ok" : "waiting",
        label: "Completed",
        title: `${numberText(resumeState.done_symbol_count, 0)} sym / ${numberText(resumeState.completed_output_path_count, 0)} paths`,
        note: `Sample: ${text((resumeState.done_symbols_sample || resumeState.completed_output_paths_sample || []).slice(0, 5).join(", ") || "none")}`,
      },
      {
        status: Number(resumeState.pending_symbol_count || resumeState.failed_symbol_count || resumeState.failed_day_count || 0) ? "warn" : "ok",
        label: "Pending",
        title: `${numberText(resumeState.pending_symbol_count, 0)} sym / ${numberText(resumeState.failed_day_count, 0)} days`,
        note: `Sample: ${text((resumeState.pending_symbols_sample || resumeState.failed_symbols_sample || Object.keys(resumeState.failed_days_by_symbol_sample || {})).slice(0, 5).join(", ") || "none")}`,
      },
      {
        status: Number(resumeState.no_data_symbol_count || resumeState.no_data_day_count || 0) ? "warn" : "ok",
        label: "No Data",
        title: `${numberText(resumeState.no_data_symbol_count, 0)} sym / ${numberText(resumeState.no_data_day_count, 0)} days`,
        note: `Sample: ${text((resumeState.no_data_symbols_sample || Object.keys(resumeState.no_data_days_by_symbol_sample || {})).slice(0, 5).join(", ") || "none")}`,
      },
      {
        status: Number(resumeState.permission_symbol_count || resumeState.contract_symbol_count || 0) ? "bad" : "ok",
        label: "Blocked",
        title: `${numberText(resumeState.permission_symbol_count, 0)} perm / ${numberText(resumeState.contract_symbol_count, 0)} contract`,
        note: `Retryable sample: ${text((resumeState.retryable_symbols_sample || []).slice(0, 5).join(", ") || "none")}`,
      },
    ] : [];
    $("fetch-resume-state-cards").innerHTML = stateCards.length
      ? stateCards.map((card) => `
        <div class="action-card status-${escapeHtml(card.status)}">
          <span>${escapeHtml(card.label)}</span>
          <strong>${escapeHtml(card.title)}</strong>
          <small>${escapeHtml(card.note)}</small>
        </div>
      `).join("")
      : "";
  }
  $("fetch-resume-command").innerHTML = supported
    ? `<span class="mono">${escapeHtml(resumeCommand)}</span><button type="button" class="secondary copy-fetch-resume-inline" data-command="${escapeHtml(resumeCommand)}">Copy</button>`
    : `<span class="muted">${hasJob ? "No built-in resume command for this manifest kind." : "Inspect a stock or crypto history manifest first."}</span>`;
}

export function fetchRecoveryCards(detail, resumeCommand = "") {
  if (!detail || !detail.job_id) {
    return `<div class="health-card empty-card"><span>${statusText("waiting")}</span><strong>Select Fetch</strong><small>Inspect a fetch job to see retry and recovery guidance.</small></div>`;
  }
  const counts = detail.counts || {};
  const failedSymbols = Number(counts.failed_symbols || detail.failed_symbols || 0);
  const emptySymbols = Number(counts.empty_symbols || detail.empty_symbols || 0);
  const successSymbols = Number(counts.success_symbols || detail.success_symbols || 0);
  const failedChunks = Number(counts.failed_chunks || detail.failed_chunks || 0);
  const errors = Number(counts.errors || detail.error_total || 0);
  const retryEvents = Number(counts.retry_events || 0);
  const waits = Number(counts.pacing_wait_events || 0);
  const waitSeconds = Number(counts.pacing_wait_seconds || 0);
  const errorKinds = counts.error_kind_counts || {};
  const permissionErrors = Number(errorKinds.permission || 0);
  const visibleOutputs = Number(detail.output_visible_count || 0);
  const missingOutputs = Number(detail.output_missing_file_count || 0);
  const outsideOutputs = Number(detail.output_outside_data_roots_count || 0);
  const noPathOutputs = Number(detail.output_no_path_count || 0);
  const unsupportedOutputs = Number(detail.output_unsupported_file_count || 0);
  const outputTotal = Number(detail.output_total || 0);
  const hasFailures = failedSymbols > 0 || failedChunks > 0 || errors > 0;
  const resumePlan = detail.resume_plan || {};
  const resumePending = Number(resumePlan.pending_estimate || detail.resume_pending_estimate || 0);
  const resumeSkipped = Number(resumePlan.skip_completed_count || detail.resume_skip_count || 0);
  const resumeRetry = Number(resumePlan.retry_failed_count || detail.resume_retry_count || 0);
  const resumeReview = Number(resumePlan.review_no_data_count || detail.resume_review_count || 0);
  const recoverStatus = detail.recovery_status || (permissionErrors > 0
    ? "bad"
    : hasFailures
      ? "warn"
      : "ok");
  const recoveryDisplayStatus = recoverStatus === "blocked" ? "bad" : recoverStatus === "retry" || recoverStatus === "review" ? "warn" : recoverStatus === "ready" ? "ok" : recoverStatus;
  const recoverNote = detail.recovery_note || (permissionErrors > 0
    ? "Permission failures usually need subscription/account changes before retrying."
    : hasFailures && resumeCommand
      ? "Copy the resume command to retry failed or missing work."
      : hasFailures
        ? "Review errors and rerun with the same inputs after fixing the cause."
        : "No failed symbols or chunks recorded.");
  const coverageStatus = failedSymbols > 0 ? "warn" : successSymbols > 0 ? "ok" : "idle";
  const visibilityStatus = !outputTotal
    ? "bad"
    : missingOutputs || outsideOutputs || noPathOutputs || unsupportedOutputs
      ? "warn"
      : "ok";
  const visibilityNote = !outputTotal
    ? "No output paths are recorded in this manifest."
    : missingOutputs || outsideOutputs || noPathOutputs || unsupportedOutputs
      ? `${numberText(missingOutputs, 0)} missing / ${numberText(outsideOutputs, 0)} outside roots / ${numberText(noPathOutputs, 0)} no path / ${numberText(unsupportedOutputs, 0)} unsupported.`
      : "Every recorded output is inspectable from Data Library.";
  const retryStatus = retryEvents > 0 ? "warn" : "ok";
  const pacingStatus = waits > 0 ? "warn" : "ok";
  const cards = [
    {
      status: coverageStatus,
      title: `${numberText(successSymbols, 0)} ok / ${numberText(failedSymbols, 0)} failed`,
      label: "Symbol Coverage",
      note: `${numberText(emptySymbols, 0)} empty symbols; ${numberText(failedChunks, 0)} failed chunks.`,
    },
    {
      status: recoveryDisplayStatus,
      title: text(detail.recovery_action || (recoveryDisplayStatus === "ok" ? "ready" : recoveryDisplayStatus === "warn" ? "retry" : "blocked")),
      label: "Recovery",
      note: recoverNote,
    },
    {
      status: resumeCommand ? (resumePending || resumeSkipped ? "ok" : "warn") : "warn",
      title: resumePlan.resume_mode ? text(resumePlan.resume_mode) : "n/a",
      label: "Resume Scope",
      note: resumePlan.resume_summary
        ? resumePlan.resume_summary
        : resumeCommand
          ? `Skip ${numberText(resumeSkipped, 0)} / retry ${numberText(resumeRetry, 0)} / review ${numberText(resumeReview, 0)}.`
          : "No built-in resume command for this manifest kind.",
    },
    {
      status: visibilityStatus,
      title: `${numberText(visibleOutputs, 0)} / ${numberText(outputTotal, 0)}`,
      label: "Data Visibility",
      note: visibilityNote,
    },
    {
      status: retryStatus,
      title: numberText(retryEvents, 0),
      label: "Retries",
      note: retryEvents ? "Transient failures were retried; inspect event rows." : "No retry events recorded.",
    },
    {
      status: pacingStatus,
      title: interval(waitSeconds),
      label: "Pacing Waits",
      note: waits ? `${numberText(waits, 0)} waits recorded; useful for IBKR pacing diagnosis.` : "No pacing waits recorded.",
    },
  ];
  return cards.map((card) => `
    <div class="health-card fetch-recovery-card">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function fetchRecoveryPlan(detail, resumeCommand = "", visibleOutputPaths = []) {
  if (!detail || !detail.job_id) {
    return `
      <div class="check-item status-warn">
        <span>warn</span>
        <div><strong>Select a fetch job</strong><small>Choose Inspect on a manifest to see recovery steps, resume support, and output visibility.</small></div>
      </div>
    `;
  }
  const action = String(detail.recovery_action || "");
  const status = detail.recovery_status || "unknown";
  const hasResume = Boolean(resumeCommand);
  const resumePlan = detail.resume_plan || {};
  const steps = [];
  if (action === "fix_permissions") {
    steps.push({
      status: "bad",
      label: "Fix market-data permissions",
      detail: "Permission errors are blocking recovery; update subscriptions/contracts before retrying this manifest.",
    });
  } else if (action === "fix_contracts") {
    steps.push({
      status: "bad",
      label: "Fix symbol or contract settings",
      detail: "Contract/security-definition failures need symbol, exchange, or data-type corrections before retrying.",
    });
  } else if (action === "review_no_data") {
    steps.push({
      status: "warn",
      label: "Review no-data symbols",
      detail: "No-data responses may be valid for inactive symbols or unsupported dates; inspect symbol/error rows before retrying.",
    });
  } else if (action === "fix_data_roots") {
    steps.push({
      status: "warn",
      label: "Fix Data Library roots",
      detail: "Outputs exist but are missing, unsupported, or outside configured roots; update data_roots or inspect output paths.",
    });
  } else if (action === "resume_manifest") {
    steps.push({
      status: "warn",
      label: "Resume failed work",
      detail: "Use the generated resume command after checking Gateway/API stability and any retryable errors.",
    });
  } else if (status === "ready") {
    steps.push({
      status: "ok",
      label: "Inspect outputs",
      detail: "No recovery blockers are visible; review Data Library-visible outputs or export detail rows.",
    });
  } else {
    steps.push({
      status: status === "blocked" ? "bad" : status === "retry" || status === "review" ? "warn" : "ok",
      label: text(action || status),
      detail: text(detail.recovery_note || "Review recovery cards and detail rows."),
    });
  }
  steps.push({
    status: hasResume ? "ok" : "warn",
    label: hasResume ? "Resume command available" : "No resume command",
    detail: hasResume
      ? text(resumePlan.resume_summary || "Copy Resume Command to retry failed, missing, or incomplete manifest work while skipping completed items when the fetcher supports it.")
      : "This manifest kind is not resumable through the generic resume command.",
  });
  steps.push({
    status: visibleOutputPaths.length ? "ok" : Number(detail.output_total || 0) ? "warn" : "idle",
    label: visibleOutputPaths.length ? "Review visible outputs" : "No visible outputs",
    detail: visibleOutputPaths.length
      ? `Show ${numberText(visibleOutputPaths.length, 0)} Data Library-visible output${visibleOutputPaths.length === 1 ? "" : "s"} as a filtered saved-data set.`
      : "Recorded outputs are missing, outside configured data roots, unsupported, or absent.",
  });
  return steps.map((step) => `
    <div class="check-item status-${escapeHtml(step.status)}">
      <span>${escapeHtml(step.status)}</span>
      <div><strong>${escapeHtml(step.label)}</strong><small>${escapeHtml(step.detail)}</small></div>
    </div>
  `).join("");
}

export function fetchResumeCommand(detail) {
  if (!detail || !detail.path) return "";
  if (detail.resume_command) return text(detail.resume_command);
  if (detail.kind === "crypto_history") {
    return `python3 live/fetch_crypto_history.py --resume-manifest ${shellQuote(detail.path)}`;
  }
  if (detail.kind === "stock_history") {
    return `python3 live/fetch_history.py --resume-manifest ${shellQuote(detail.path)}`;
  }
  return "";
}

export function fetchJobFilters() {
  return {
    text: ($("fetch-filter-text").value || "").trim().toLowerCase(),
    status: $("fetch-filter-status").value || "",
    kind: $("fetch-filter-kind").value || "",
    sort: $("fetch-filter-sort").value || "started_desc",
  };
}

export function renderFetchFilterOptions(manifests) {
  const makeOptions = (id, values) => {
    const current = $(id).value || "";
    const unique = Array.from(new Set((values || []).map(text).filter((value) => value && value !== "n/a"))).sort();
    $(id).innerHTML = `<option value="">All</option>${unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (unique.includes(current)) $(id).value = current;
  };
  makeOptions("fetch-filter-status", (manifests || []).map((item) => item.status));
  makeOptions("fetch-filter-kind", (manifests || []).map((item) => item.kind));
}

export function fetchManifestSortValue(item, key) {
  if (key === "started") return timestampMillis(item.started_at) || 0;
  if (key === "finished") return timestampMillis(item.finished_at) || 0;
  if (key === "errors") return Number(item.errors || 0);
  if (key === "rows") return Number(item.rows || 0);
  if (key === "symbols") return Number(item.symbols_requested || item.success_symbols || 0);
  return String(item.kind || item.job_id || "").toLowerCase();
}

export function filteredFetchManifests(manifests) {
  const filters = fetchJobFilters();
  const filtered = (manifests || []).filter((item) => {
    if (filters.status && text(item.status) !== filters.status) return false;
    if (filters.kind && text(item.kind) !== filters.kind) return false;
    if (filters.text) {
      const haystack = [
        item.job_id,
        item.kind,
        item.status,
        item.started_at,
        item.finished_at,
        item.latest_output_path,
        item.first_output_path,
        item.out_dir,
        item.error_sample,
        ...(item.symbols || []),
        ...(item.symbols_requested_list || []),
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });
  const [key, direction] = String(filters.sort || "started_desc").split("_");
  const multiplier = direction === "asc" ? 1 : -1;
  return filtered.slice().sort((left, right) => {
    const leftValue = fetchManifestSortValue(left, key);
    const rightValue = fetchManifestSortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier;
    }
    const primary = String(leftValue).localeCompare(String(rightValue)) * multiplier;
    if (primary) return primary;
    return String(left.job_id || "").localeCompare(String(right.job_id || ""));
  });
}
