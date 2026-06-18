function renderRuns() {
  const runs = (state.status && state.status.runs) || [];
  renderRunsFilterOptions(runs);
  const visibleRuns = sortedRuns(filteredRuns(runs));
  renderCurrentOrdersAndPositions();
  renderRunsTriage();
  renderRunsReviewPanel();
  renderRunsActionSummary();
  renderRunsEvidence();
  renderRuntimeSessions();
  renderRunsWorkflowLauncher();
  renderRunsAccountBoundary();
  renderRunsSearchAssistant(runs, visibleRuns);
  $("runs-table-note").textContent = `${numberText(visibleRuns.length, 0)} shown / ${numberText(runs.length, 0)} published run${runs.length === 1 ? "" : "s"}`;
  $("runs-body").innerHTML = visibleRuns.length
    ? visibleRuns.map((run) => {
        const metrics = normalizedRunMetrics(run);
        return row([
          escapeHtml(run.id),
          statusText(run.status),
          escapeHtml(metrics.mode),
          escapeHtml(metrics.decisions),
          escapeHtml(metrics.orders),
          escapeHtml(metrics.fills),
          escapeHtml(metrics.rejections),
          escapeHtml(money(metrics.final_equity)),
          escapeHtml(metrics.last_decision_time),
          `<span class="${statusClass((run.freshness || {}).stale ? "warn" : "ok")}">${escapeHtml(age((run.freshness || {}).age_seconds))}</span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No published runs match the current filters.</span>`, "", "", "", "", "", "", "", "", ""]);
}

function runtimeSessionRows() {
  return ((state.runtimeSessions && state.runtimeSessions.sessions) || [])
    .slice()
    .sort((left, right) => text(right.latest_modified_at || right.modified_at).localeCompare(text(left.latest_modified_at || left.modified_at)));
}

function renderRuntimeSessions() {
  if (!$("runtime-sessions-note") || !$("runtime-sessions-cards") || !$("runtime-sessions-body")) return;
  const payload = state.runtimeSessions || {};
  const sessions = runtimeSessionRows();
  const latest = sessions[0] || null;
  const runCounts = payload.run_counts || {};
  const statusCounts = payload.status_counts || {};
  $("runtime-sessions-note").textContent = sessions.length
    ? `${numberText(sessions.length, 0)} session folder${sessions.length === 1 ? "" : "s"} loaded from configured data roots; ${numberText(payload.file_count_total || 0, 0)} files summarized.`
    : "No runtime session folders found under configured data roots. This is separate from Fetch Jobs history manifests.";
  const cards = [
    {
      label: "Session Folders",
      status: sessions.length ? "ok" : "warn",
      title: `${numberText(sessions.length, 0)} / ${numberText(payload.total || sessions.length, 0)}`,
      note: sessions.length ? `${numberText(Object.keys(runCounts).length, 0)} run ${Object.keys(runCounts).length === 1 ? "family" : "families"} visible.` : "Add paper/shadow session roots to dashboard.data_roots.",
    },
    {
      label: "Artifact Files",
      status: Number(payload.file_count_total || 0) ? "ok" : sessions.length ? "warn" : "bad",
      title: numberText(payload.file_count_total || 0, 0),
      note: `${numberText(payload.csv_count_total || 0, 0)} CSV / ${numberText(payload.parquet_count_total || 0, 0)} parquet across loaded sessions.`,
    },
    {
      label: "Latest Session",
      status: latest ? "ok" : "bad",
      title: latest ? text(latest.run_id) : "none",
      note: latest ? `${text(latest.session_id)} modified ${shortTimestampAgeLabel(latest.latest_modified_at || latest.modified_at)}.` : "No session manifest has been indexed.",
    },
    {
      label: "Status Mix",
      status: sessions.length ? "ok" : "warn",
      title: countSummary(statusCounts),
      note: `Runs: ${countSummary(runCounts)}.`,
    },
  ];
  $("runtime-sessions-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("runtime-sessions-body").innerHTML = sessions.length
    ? sessions.slice(0, 25).map((session) => row([
        escapeHtml(text(session.run_id)),
        escapeHtml(text(session.session_id)),
        statusText(session.status),
        escapeHtml(numberText(session.file_count, 0)),
        escapeHtml(numberText(session.signal_file_count, 0)),
        escapeHtml(numberText(session.order_file_count, 0)),
        escapeHtml(numberText(session.fill_file_count, 0)),
        escapeHtml(numberText(session.bar_file_count, 0)),
        escapeHtml(shortTimestampAgeLabel(session.latest_modified_at || session.modified_at)),
        escapeHtml(text(session.path)),
        `<button type="button" class="secondary inspect-runtime-session" data-session-path="${escapeHtml(text(session.path))}">Inspect</button>`,
      ])).join("")
    : row([`<span class="muted">No runtime sessions found. Fetch Jobs can still be empty while paper/shadow run telemetry exists in current status.</span>`, "", "", "", "", "", "", "", "", "", ""]);
  renderRuntimeSessionDetail();
}

function renderRuntimeSessionDetail() {
  if (!$("runtime-session-detail-note") || !$("runtime-session-detail-cards") || !$("runtime-session-detail-body")) return;
  const detail = state.runtimeSessionDetail || {};
  const summary = detail.summary || {};
  const files = detail.files || [];
  if (!detail.path) {
    $("runtime-session-detail-note").textContent = "Select a runtime session to inspect file categories, sizes, row counts, and public-safe boundary.";
    $("runtime-session-detail-cards").innerHTML = "";
    $("runtime-session-detail-body").innerHTML = row([`<span class="muted">No runtime session selected.</span>`, "", "", "", "", ""]);
    return;
  }
  $("runtime-session-detail-note").textContent = `${text(summary.run_id)} / ${text(summary.session_id)}; raw file contents and private strategy config are excluded.`;
  const categoryCounts = detail.category_counts || {};
  const cards = [
    {
      label: "Files",
      status: files.length ? "ok" : "warn",
      title: numberText(files.length, 0),
      note: `${bytes(files.reduce((sum, item) => sum + Number(item.size_bytes || 0), 0))} across this session.`,
    },
    {
      label: "Rows",
      status: Number(detail.row_count_total || 0) ? "ok" : "warn",
      title: numberText(detail.row_count_total || 0, 0),
      note: "CSV and JSONL row counts only; parquet row counts are not read here.",
    },
    {
      label: "Categories",
      status: Object.keys(categoryCounts).length ? "ok" : "warn",
      title: countSummary(categoryCounts),
      note: "Manifest, signal, order, fill, market-data, account, log, and metadata buckets.",
    },
    {
      label: "Boundary",
      status: "ok",
      title: "Public-safe",
      note: "Raw rows, logs, credentials, and private strategy config are excluded.",
    },
  ];
  $("runtime-session-detail-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("runtime-session-detail-body").innerHTML = files.length
    ? files.map((file) => row([
        escapeHtml(file.name),
        statusText(file.category === "log" ? "warn" : "ok", { suffix: ` ${text(file.category)}` }),
        escapeHtml(file.row_count === null || file.row_count === undefined ? text(file.row_count_status) : numberText(file.row_count, 0)),
        escapeHtml(bytes(file.size_bytes)),
        escapeHtml(shortTimestampAgeLabel(file.modified_at)),
        escapeHtml(file.path),
      ])).join("")
    : row([`<span class="muted">No files are visible for this selected session.</span>`, "", "", "", "", ""]);
}

function runsFilterState() {
  return {
    text: ($("runs-filter-text").value || "").trim().toLowerCase(),
    status: $("runs-filter-status").value || "",
    mode: $("runs-filter-mode").value || "",
    sort: $("runs-filter-sort").value || "age_asc",
  };
}

function runMetricsNumber(run, key) {
  return Number(normalizedRunMetrics(run)[key] || 0);
}

function runsNestedCount(rows, getter) {
  const counts = {};
  for (const item of rows || []) {
    const value = text(getter(item));
    if (!value || value === "n/a") continue;
    counts[value] = (counts[value] || 0) + 1;
  }
  return counts;
}

function recommendedRuns(filtered = []) {
  return (filtered || [])
    .slice()
    .sort((left, right) => {
      const leftRejects = runMetricsNumber(left, "rejections");
      const rightRejects = runMetricsNumber(right, "rejections");
      if (leftRejects !== rightRejects) return rightRejects - leftRejects;
      const leftFills = runMetricsNumber(left, "fills");
      const rightFills = runMetricsNumber(right, "fills");
      if (leftFills !== rightFills) return rightFills - leftFills;
      const leftOrders = runMetricsNumber(left, "orders");
      const rightOrders = runMetricsNumber(right, "orders");
      if (leftOrders !== rightOrders) return rightOrders - leftOrders;
      const leftAge = Number((left.freshness || {}).age_seconds);
      const rightAge = Number((right.freshness || {}).age_seconds);
      if (Number.isFinite(leftAge) && Number.isFinite(rightAge) && leftAge !== rightAge) return leftAge - rightAge;
      return text(left.id).localeCompare(text(right.id));
    })
    .slice(0, 5);
}

function renderRunsSearchAssistant(runs = [], visibleRuns = []) {
  if (!$("runs-search-title") || !$("runs-search-cards") || !$("runs-search-actions")) return;
  const filters = runsFilterState();
  const activeLabels = [
    filters.text ? `search ${filters.text}` : "",
    filters.status ? `status ${filters.status}` : "",
    filters.mode ? `mode ${filters.mode}` : "",
  ].filter(Boolean);
  const hidden = Math.max(0, runs.length - visibleRuns.length);
  const statusCounts = runsNestedCount(visibleRuns, (run) => run.status);
  const modeCounts = runsNestedCount(visibleRuns, (run) => normalizedRunMetrics(run).mode);
  const staleRuns = visibleRuns.filter((run) => (run.freshness || {}).stale);
  const decisions = visibleRuns.reduce((sum, run) => sum + runMetricsNumber(run, "decisions"), 0);
  const orders = visibleRuns.reduce((sum, run) => sum + runMetricsNumber(run, "orders"), 0);
  const fills = visibleRuns.reduce((sum, run) => sum + runMetricsNumber(run, "fills"), 0);
  const rejects = visibleRuns.reduce((sum, run) => sum + runMetricsNumber(run, "rejections"), 0);
  const newestAge = visibleRuns
    .map((run) => Number((run.freshness || {}).age_seconds))
    .filter(Number.isFinite)
    .sort((left, right) => left - right)[0];
  $("runs-search-title").textContent = runs.length
    ? activeLabels.length
      ? `${numberText(visibleRuns.length, 0)} matching run${visibleRuns.length === 1 ? "" : "s"}`
      : `${numberText(runs.length, 0)} searchable run${runs.length === 1 ? "" : "s"}`
    : "No runs loaded";
  $("runs-search-note").textContent = runs.length
    ? activeLabels.length
      ? `${activeLabels.join(" / ")}. ${numberText(hidden, 0)} run${hidden === 1 ? "" : "s"} hidden by filters.`
      : "Use the filters to find stale, rejected, filled, active, replay, shadow, paper, or simulated-paper runs."
    : "No current published run telemetry is available yet.";
  const cards = [
    {
      label: "Visible Runs",
      status: visibleRuns.length ? "ok" : runs.length ? "warn" : "bad",
      title: `${numberText(visibleRuns.length, 0)} / ${numberText(runs.length, 0)}`,
      note: hidden ? `${numberText(hidden, 0)} hidden by filters.` : "All published runs are visible.",
    },
    {
      label: "Status / Mode",
      status: visibleRuns.length ? "ok" : "warn",
      title: countSummary(statusCounts),
      note: `Modes: ${countSummary(modeCounts)}.`,
    },
    {
      label: "Freshness",
      status: staleRuns.length ? "warn" : visibleRuns.length ? "ok" : "idle",
      title: Number.isFinite(newestAge) ? age(newestAge) : "n/a",
      note: staleRuns.length
        ? `${numberText(staleRuns.length, 0)} visible run${staleRuns.length === 1 ? "" : "s"} marked stale.`
        : "No visible run is marked stale.",
    },
    {
      label: "Execution",
      status: rejects ? "bad" : fills ? "ok" : orders ? "warn" : visibleRuns.length ? "warn" : "bad",
      title: `${numberText(fills, 0)} fills / ${numberText(rejects, 0)} rejects`,
      note: `${numberText(orders, 0)} orders and ${numberText(decisions, 0)} decisions across visible runs.`,
    },
  ];
  $("runs-search-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const recommendations = recommendedRuns(visibleRuns);
  $("runs-search-actions").innerHTML = recommendations.length
    ? recommendations.map((run) => {
        const metrics = normalizedRunMetrics(run);
        const runRejects = Number(metrics.rejections || 0);
        const runFills = Number(metrics.fills || 0);
        const status = runRejects ? "bad" : (run.freshness || {}).stale ? "warn" : runFills ? "ok" : "warn";
        return `
          <div class="runs-search-action-card status-${escapeHtml(status)}">
            <div>
              <span>${statusText(status)}</span>
              <strong>${escapeHtml(text(run.id))}</strong>
              <small>${escapeHtml(text(run.status))} / ${escapeHtml(text(metrics.mode))} / age ${escapeHtml(age((run.freshness || {}).age_seconds))}</small>
              <small>${escapeHtml(numberText(metrics.decisions, 0))} decisions / ${escapeHtml(numberText(metrics.orders, 0))} orders / ${escapeHtml(numberText(metrics.fills, 0))} fills / ${escapeHtml(numberText(metrics.rejections, 0))} rejects</small>
            </div>
            <div>
              <button type="button" data-runs-search-action="events" data-run-id="${escapeHtml(text(run.id))}">Events</button>
              <button type="button" class="secondary" data-runs-search-action="status" data-status="${escapeHtml(text(run.status))}">Status</button>
              <button type="button" class="secondary" data-runs-search-action="mode" data-mode="${escapeHtml(text(metrics.mode))}">Mode</button>
            </div>
          </div>
        `;
      }).join("")
    : `<div class="empty-card"><strong>No recommended runs</strong><span>Clear filters or wait for published run telemetry.</span></div>`;
}

function handleRunsSearchAction(target) {
  const action = String(target.dataset.runsSearchAction || "");
  if (action === "events") {
    $("run-events-filter-text").value = target.dataset.runId || "";
    renderRunEvents();
    navigateToRunsLens("events");
    return;
  }
  if (action === "status") {
    $("runs-filter-status").value = target.dataset.status || "";
    renderRuns();
    return;
  }
  if (action === "mode") {
    $("runs-filter-mode").value = target.dataset.mode || "";
    renderRuns();
  }
}

function renderRunsFilterOptions(runs) {
  const makeOptions = (id, values) => {
    const select = $(id);
    if (!select) return;
    const current = select.value;
    const options = Array.from(new Set(values.map(text).filter((value) => value !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) select.value = current;
  };
  makeOptions("runs-filter-status", runs.map((run) => run.status));
  makeOptions("runs-filter-mode", runs.map((run) => normalizedRunMetrics(run).mode));
}

function filteredRuns(runs) {
  const query = ($("runs-filter-text").value || "").trim().toLowerCase();
  const status = $("runs-filter-status").value || "";
  const mode = $("runs-filter-mode").value || "";
  return (runs || []).filter((run) => {
    const metrics = normalizedRunMetrics(run);
    if (status && text(run.status) !== status) return false;
    if (mode && text(metrics.mode) !== mode) return false;
    if (!query) return true;
    const haystack = [
      run.id,
      run.status,
      metrics.mode,
      metrics.decisions,
      metrics.orders,
      metrics.fills,
      metrics.rejections,
      metrics.final_equity,
      metrics.last_decision_time,
    ].map(text).join(" ").toLowerCase();
    return haystack.includes(query);
  });
}

function runSortMetric(run, sortMode) {
  const metrics = normalizedRunMetrics(run);
  if (sortMode === "age_asc" || sortMode === "age_desc") return Number((run.freshness || {}).age_seconds);
  if (sortMode === "decisions_desc") return Number(metrics.decisions);
  if (sortMode === "fills_desc") return Number(metrics.fills);
  if (sortMode === "rejects_desc") return Number(metrics.rejections);
  if (sortMode === "equity_desc") return Number(metrics.final_equity);
  return text(run.id);
}

function sortedRuns(runs) {
  const sortMode = $("runs-filter-sort").value || "age_asc";
  const ascending = sortMode === "age_asc" || sortMode === "id_asc";
  return (runs || []).map((run, index) => ({
    run,
    index,
    metric: runSortMetric(run, sortMode),
  })).sort((left, right) => {
    if (typeof left.metric === "string" || typeof right.metric === "string") {
      const result = String(left.metric).localeCompare(String(right.metric));
      return result || left.index - right.index;
    }
    const leftFinite = Number.isFinite(left.metric);
    const rightFinite = Number.isFinite(right.metric);
    if (!leftFinite && !rightFinite) return left.index - right.index;
    if (!leftFinite) return 1;
    if (!rightFinite) return -1;
    if (left.metric === right.metric) return left.index - right.index;
    return ascending ? left.metric - right.metric : right.metric - left.metric;
  }).map((item) => item.run);
}

function renderRunsTriage() {
  if (!$("runs-triage-cards") || !$("runs-triage-note")) return;
  const runs = (state.status && state.status.runs) || [];
  const history = state.history || [];
  const orders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const positions = nonzeroPositionsFromSource(source);
  const events = runEventRows();
  const latestRun = runs[0] || null;
  const latestMetrics = normalizedRunMetrics(latestRun);
  const fills = events.filter((event) => event.type === "fill");
  const rejectedOrders = events.filter((event) => event.type === "order" && eventStatusIsBad(event));
  const latestEvent = events[0] || null;
  const artifactLoaded = Boolean(state.configArtifacts && (state.configArtifacts.run_id || state.configArtifacts.draft_id));
  let nextStatus = "idle";
  let nextTitle = "Start Runner";
  let nextNote = "No run telemetry is currently published.";
  if (runs.length) {
    if (orders.length) {
      nextStatus = "warn";
      nextTitle = "Review Orders";
      nextNote = "Non-terminal order telemetry is present; verify broker/account state.";
    } else if (rejectedOrders.length) {
      nextStatus = "bad";
      nextTitle = "Inspect Rejects";
      nextNote = "Recent rejected/canceled order events need review before trusting the run.";
    } else if (positions.length) {
      nextStatus = "warn";
      nextTitle = "Review Positions";
      nextNote = "Managed positions are open; check intended hold and exit context.";
    } else if (!events.length) {
      nextStatus = "warn";
      nextTitle = "Await Events";
      nextNote = "Run telemetry exists but no recent decisions, orders, or fills were published.";
    } else {
      nextStatus = "ok";
      nextTitle = "Inspect Timeline";
      nextNote = "Recent run activity is available; use tables below for decisions, orders, fills, and artifacts.";
    }
  } else if (history.length) {
    nextStatus = "warn";
    nextTitle = "Check Status";
    nextNote = "Status history exists but no current run list is published.";
  }
  const cards = [
    {
      status: runs.length ? "ok" : history.length ? "warn" : "idle",
      title: numberText(runs.length, 0),
      label: "Published Runs",
      note: latestRun
        ? `${text(latestRun.id)} ${text(latestRun.status)} / ${text(latestMetrics.mode)} / age ${age((latestRun.freshness || {}).age_seconds)}.`
        : history.length
          ? `${numberText(history.length, 0)} status snapshots, no current run payload.`
          : "No current runs published.",
    },
    {
      status: orders.length ? "warn" : "ok",
      title: numberText(orders.length, 0),
      label: "Open Orders",
      note: orders.length
        ? `${text(orders[0].symbol)} ${text(orders[0].side)} ${text(orders[0].status)} is the latest non-terminal order.`
        : "No recent non-terminal order telemetry.",
    },
    {
      status: positions.length ? "warn" : runs.length ? "ok" : "bad",
      title: numberText(positions.length, 0),
      label: "Positions",
      note: positions.length
        ? `${positions.slice(0, 3).map((position) => position.symbol).join(", ")}${positions.length > 3 ? "..." : ""} open from selected/current account source.`
        : "Latest selected/current account source is flat or missing.",
    },
    {
      status: events.length ? rejectedOrders.length ? "warn" : "ok" : runs.length ? "warn" : "idle",
      title: numberText(events.length, 0),
      label: "Recent Events",
      note: latestEvent
        ? `${text(latestEvent.type)} ${text(latestEvent.status)} ${text(latestEvent.symbol)} at ${text(latestEvent.timestamp)}.`
        : "No recent decisions, orders, or fills published.",
    },
    {
      status: rejectedOrders.length ? "bad" : fills.length ? "ok" : events.length ? "warn" : "bad",
      title: `${numberText(fills.length, 0)} fills / ${numberText(rejectedOrders.length, 0)} rejects`,
      label: "Execution",
      note: rejectedOrders.length
        ? "Review rejected or canceled order detail before continuing."
        : fills.length
          ? "Recent fills are visible in the run event tables."
          : "No fill telemetry in the recent event window.",
    },
    {
      status: artifactLoaded ? "ok" : runs.length ? "warn" : "bad",
      title: artifactLoaded ? "Loaded" : "Not Loaded",
      label: "Artifact Detail",
      note: artifactLoaded
        ? `${text((state.configArtifacts || {}).draft_id)} ${text((state.configArtifacts || {}).run_id || "latest output")} loaded.`
        : "Open a saved run artifact from Workbench or Performance for full sanitized detail.",
    },
    {
      status: nextStatus,
      title: nextTitle,
      label: "Next Action",
      note: nextNote,
    },
  ];
  $("runs-triage-note").textContent = `${numberText(runs.length, 0)} runs / ${numberText(orders.length, 0)} open orders / ${numberText(positions.length, 0)} positions / ${numberText(events.length, 0)} recent events`;
  $("runs-triage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

function renderRunsReviewPanel() {
  if (!$("runs-review-title") || !$("runs-review-cards") || !$("runs-review-actions")) return;
  const runs = (state.status && state.status.runs) || [];
  const history = state.history || [];
  const orders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const positions = nonzeroPositionsFromSource(source);
  const events = runEventRows();
  const decisions = events.filter((event) => event.type === "decision");
  const orderEvents = events.filter((event) => event.type === "order");
  const fills = events.filter((event) => event.type === "fill");
  const badEvents = events.filter(eventStatusIsBad);
  const latestRun = runs[0] || null;
  const latestMetrics = normalizedRunMetrics(latestRun);
  const artifactLoaded = Boolean(state.configArtifacts && (state.configArtifacts.run_id || state.configArtifacts.draft_id));
  const savedRuns = (state.configRuns && state.configRuns.runs) || [];
  const accountRow = latestAccountRow(source.account || []);
  let status = "idle";
  let title = "No Current Run";
  let note = "No current published run telemetry is available. Start/publish a runner or load a saved Workbench artifact.";
  let primaryHref = "#operations/paper";
  let primaryLabel = "Open Operations";
  if (orders.length) {
    status = "warn";
    title = "Open Orders Need Review";
    note = `${numberText(orders.length, 0)} non-terminal order event${orders.length === 1 ? "" : "s"} are visible; reconcile broker/account state before reading results.`;
    primaryHref = "#runs/state";
    primaryLabel = "Review State";
  } else if (badEvents.length) {
    status = "bad";
    title = "Execution Issues";
    note = `${numberText(badEvents.length, 0)} rejected, canceled, failed, or error event${badEvents.length === 1 ? "" : "s"} are visible in the recent timeline.`;
    primaryHref = "#runs/events";
    primaryLabel = "Show Events";
  } else if (positions.length) {
    status = "warn";
    title = "Positions Open";
    note = `${positions.slice(0, 4).map((position) => text(position.symbol)).join(", ")}${positions.length > 4 ? "..." : ""} open in the selected/current account source.`;
    primaryHref = "#runs/state";
    primaryLabel = "Review Positions";
  } else if (fills.length) {
    status = "ok";
    title = "Fills Visible";
    note = `${numberText(fills.length, 0)} fill event${fills.length === 1 ? "" : "s"} visible; inspect trades in Performance or event detail in Runs.`;
    primaryHref = "#performance/trades";
    primaryLabel = "Open Trades";
  } else if (runs.length && events.length) {
    status = "ok";
    title = "Timeline Ready";
    note = "Recent decisions/orders/fills are available; use Events or Run Search for exact rows.";
    primaryHref = "#runs/events";
    primaryLabel = "Open Events";
  } else if (runs.length) {
    status = "warn";
    title = "Awaiting Activity";
    note = "A run is publishing, but recent decision/order/fill telemetry is not visible yet.";
    primaryHref = "#runs/runs";
    primaryLabel = "Search Runs";
  } else if (artifactLoaded || savedRuns.length) {
    status = artifactLoaded ? "ok" : "warn";
    title = artifactLoaded ? "Artifact Loaded" : "Saved Runs Available";
    note = artifactLoaded
      ? "Loaded Workbench artifacts can be inspected through Performance, Runs, and Artifacts."
      : "Saved Workbench runs exist; load artifacts for detailed events and charts.";
    primaryHref = artifactLoaded ? "#performance" : "#workbench/artifacts";
    primaryLabel = artifactLoaded ? "Open Performance" : "Open Artifacts";
  } else if (history.length) {
    status = "warn";
    title = "Status History Only";
    note = "Status snapshots exist, but no current run payload is published.";
  }
  $("runs-review-title").textContent = title;
  $("runs-review-title").className = statusClass(status);
  $("runs-review-note").textContent = note;
  const cards = [
    {
      label: "Run Source",
      title: runs.length ? `${numberText(runs.length, 0)} current` : savedRuns.length ? `${numberText(savedRuns.length, 0)} saved` : "none",
      status: runs.length ? "ok" : savedRuns.length || artifactLoaded || history.length ? "warn" : "bad",
      detail: latestRun
        ? `${text(latestRun.id)} ${text(latestRun.status)} / ${text(latestMetrics.mode)} / age ${age((latestRun.freshness || {}).age_seconds)}.`
        : artifactLoaded ? `Loaded ${text((state.configArtifacts || {}).run_id || (state.configArtifacts || {}).draft_id)}.` : "No current run list.",
    },
    {
      label: "Account State",
      title: positions.length ? `${numberText(positions.length, 0)} positions` : source.has_data ? "flat/unknown" : "missing",
      status: positions.length ? "warn" : source.has_data ? "ok" : "idle",
      detail: source.account && source.account.length
        ? `Latest account ${shortTimestampAgeLabel(accountRow.timestamp)} from ${text(source.label)}.`
        : source.has_data ? `${text(source.label)} has no account snapshot rows.` : "No account source loaded.",
    },
    {
      label: "Orders",
      title: orders.length ? `${numberText(orders.length, 0)} open` : `${numberText(orderEvents.length, 0)} recent`,
      status: orders.length ? "warn" : badEvents.length ? "bad" : orderEvents.length ? "ok" : runs.length ? "warn" : "bad",
      detail: orders.length ? `${text(orders[0].symbol)} ${text(orders[0].status)} is latest non-terminal order.` : `${numberText(badEvents.length, 0)} issue event${badEvents.length === 1 ? "" : "s"} visible.`,
    },
    {
      label: "Timeline Mix",
      title: `${numberText(decisions.length, 0)}D / ${numberText(orderEvents.length, 0)}O / ${numberText(fills.length, 0)}F`,
      status: badEvents.length ? "bad" : fills.length ? "ok" : events.length ? "warn" : runs.length ? "warn" : "bad",
      detail: events[0] ? `Latest ${text(events[0].type)} ${text(events[0].symbol)} ${shortTimestampAgeLabel(events[0].timestamp)}.` : "No recent event rows.",
    },
    {
      label: "Artifacts",
      title: artifactLoaded ? "loaded" : savedRuns.length ? "available" : "missing",
      status: artifactLoaded ? "ok" : savedRuns.length ? "warn" : "idle",
      detail: artifactLoaded
        ? "Charts, logs, decisions, fills, and account rows can be inspected."
        : savedRuns.length ? "Load a saved run artifact for detailed evidence." : "Run or load a Workbench artifact for richer detail.",
    },
  ];
  $("runs-review-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
  $("runs-review-actions").innerHTML = [
    `<a href="${escapeHtml(primaryHref)}">${escapeHtml(primaryLabel)}</a>`,
    `<a class="secondary" href="#runs/state">State</a>`,
    `<a class="secondary" href="#runs/events">Events</a>`,
    `<a class="secondary" href="#runs/runs">Run Search</a>`,
  ].join("");
}

function runsActionSummaryModel() {
  const runs = (state.status && state.status.runs) || [];
  const history = state.history || [];
  const orders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const positions = nonzeroPositionsFromSource(source);
  const events = runEventRows();
  const decisions = events.filter((event) => event.type === "decision");
  const orderEvents = events.filter((event) => event.type === "order");
  const fills = events.filter((event) => event.type === "fill");
  const badEvents = events.filter(eventStatusIsBad);
  const artifacts = state.configArtifacts || {};
  const savedRuns = (state.configRuns && state.configRuns.runs) || [];
  const artifactLoaded = Boolean(artifacts.run_id || artifacts.draft_id);
  const latestRun = runs[0] || null;
  const latestMetrics = normalizedRunMetrics(latestRun);
  const latestEvent = events[0] || null;
  let status = "idle";
  let title = "Start With State";
  let note = "No current run payload is publishing. Start a runner or load a saved artifact before inspecting results.";
  let primaryHref = "#operations/paper";
  let primaryLabel = "Open Operations";
  if (orders.length) {
    status = "warn";
    title = "Inspect Open Orders";
    note = `${numberText(orders.length, 0)} non-terminal order event${orders.length === 1 ? "" : "s"} need broker/account reconciliation first.`;
    primaryHref = "#runs/state";
    primaryLabel = "Review State";
  } else if (badEvents.length) {
    status = "bad";
    title = "Inspect Execution Issues";
    note = `${numberText(badEvents.length, 0)} rejected, canceled, failed, or error event${badEvents.length === 1 ? "" : "s"} should be reviewed before trusting performance.`;
    primaryHref = "#runs/events";
    primaryLabel = "Show Events";
  } else if (positions.length) {
    status = "warn";
    title = "Inspect Positions";
    note = `${numberText(positions.length, 0)} open position${positions.length === 1 ? "" : "s"} visible in the selected/current account source.`;
    primaryHref = "#runs/state";
    primaryLabel = "Review Positions";
  } else if (fills.length) {
    status = "ok";
    title = "Connect Fills To Results";
    note = `${numberText(fills.length, 0)} recent fill event${fills.length === 1 ? "" : "s"} visible; inspect Performance trades and run events next.`;
    primaryHref = "#performance/trades";
    primaryLabel = "Open Trades";
  } else if (events.length) {
    status = "ok";
    title = "Read Event Flow";
    note = `${numberText(events.length, 0)} recent event${events.length === 1 ? "" : "s"} visible across decisions, orders, and fills.`;
    primaryHref = "#runs/events";
    primaryLabel = "Open Events";
  } else if (runs.length) {
    status = "warn";
    title = "Runner Is Quiet";
    note = `${numberText(runs.length, 0)} current run${runs.length === 1 ? "" : "s"} publishing, but no recent decision/order/fill events are visible.`;
    primaryHref = "#runs/runs";
    primaryLabel = "Search Runs";
  } else if (artifactLoaded || savedRuns.length) {
    status = artifactLoaded ? "ok" : "warn";
    title = artifactLoaded ? "Review Loaded Artifact" : "Load Saved Artifact";
    note = artifactLoaded
      ? "Loaded run artifacts can be reviewed through Performance, Runs Evidence, and Workbench Artifacts."
      : `${numberText(savedRuns.length, 0)} saved run${savedRuns.length === 1 ? "" : "s"} available; load one for detailed decisions, orders, fills, and charts.`;
    primaryHref = artifactLoaded ? "#performance" : "#workbench/artifacts";
    primaryLabel = artifactLoaded ? "Open Performance" : "Open Artifacts";
  } else if (history.length) {
    status = "warn";
    title = "Status History Only";
    note = `${numberText(history.length, 0)} status snapshot${history.length === 1 ? "" : "s"} loaded without a current run list.`;
    primaryHref = "#runs/state";
    primaryLabel = "Review State";
  }
  const cards = [
    {
      label: "Inspect First",
      status,
      title,
      note,
    },
    {
      label: "Current Run",
      status: runs.length ? (latestRun && (latestRun.freshness || {}).stale ? "warn" : "ok") : savedRuns.length || artifactLoaded ? "warn" : "idle",
      title: runs.length ? text(latestRun.id) : artifactLoaded ? "artifact" : savedRuns.length ? `${numberText(savedRuns.length, 0)} saved` : "none",
      note: latestRun
        ? `${text(latestRun.status)} / ${text(latestMetrics.mode)} / age ${age((latestRun.freshness || {}).age_seconds)}.`
        : artifactLoaded ? `${text(artifacts.draft_id || "draft")} ${text(artifacts.run_id || "run")} loaded.` : "No current run payload loaded.",
    },
    {
      label: "Account Boundary",
      status: orders.length || positions.length ? "warn" : source.has_data ? "ok" : "idle",
      title: `${numberText(orders.length, 0)} orders / ${numberText(positions.length, 0)} pos`,
      note: source.has_data
        ? `${text(source.label || source.source_type)} is the selected/current account source.`
        : "No account source is loaded for this view.",
    },
    {
      label: "Event Pressure",
      status: badEvents.length ? "bad" : fills.length ? "ok" : orderEvents.length ? "warn" : decisions.length ? "ok" : runs.length ? "warn" : "idle",
      title: `${numberText(decisions.length, 0)}D / ${numberText(orderEvents.length, 0)}O / ${numberText(fills.length, 0)}F`,
      note: latestEvent
        ? `Latest ${text(latestEvent.type)} ${text(latestEvent.status)} ${text(latestEvent.symbol)}.`
        : "No recent event telemetry is visible.",
    },
    {
      label: "Artifact Depth",
      status: artifactLoaded ? "ok" : savedRuns.length ? "warn" : "idle",
      title: artifactLoaded ? "loaded" : savedRuns.length ? "available" : "missing",
      note: artifactLoaded
        ? `${numberText((artifacts.decisions || []).length, 0)} decisions / ${numberText((artifacts.orders || []).length, 0)} orders / ${numberText((artifacts.fills || []).length, 0)} fills.`
        : savedRuns.length ? "Saved runs exist; load artifacts for drilldown evidence." : "No saved run artifact is visible.",
    },
  ];
  const actions = [
    { href: primaryHref, label: primaryLabel, secondary: false },
    { href: "#runs/state", label: "State", secondary: true },
    { href: "#runs/events", label: "Events", secondary: true },
    { href: "#runs/runs", label: "Run Search", secondary: true },
    { href: "#performance", label: "Performance", secondary: true },
    { href: "#workbench/artifacts", label: "Artifacts", secondary: true },
  ];
  return { status, title, note, cards, actions };
}

function renderRunsActionSummary() {
  if (!$("runs-action-note") || !$("runs-action-cards") || !$("runs-action-actions")) return;
  const model = runsActionSummaryModel();
  $("runs-action-note").textContent = `${model.title}: ${model.note}`;
  $("runs-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("runs-action-actions").innerHTML = model.actions.map((action) => `
    <a href="${escapeHtml(action.href)}"${action.secondary ? ` class="secondary"` : ""}>${escapeHtml(action.label)}</a>
  `).join("");
}

function runsEvidenceModel() {
  const status = state.status || {};
  const runs = status.runs || [];
  const history = state.history || [];
  const allEvents = runEventRows();
  const visibleEvents = sortedRunEvents(filteredRunEvents(allEvents));
  const decisions = allEvents.filter((event) => event.type === "decision");
  const orderEvents = allEvents.filter((event) => event.type === "order");
  const fills = allEvents.filter((event) => event.type === "fill");
  const badEvents = allEvents.filter(eventStatusIsBad);
  const visibleBadEvents = visibleEvents.filter(eventStatusIsBad);
  const eventFlow = runsEventFlowModel(allEvents, visibleEvents);
  const execution = executionQualityReviewModel(allEvents, visibleEvents);
  const orders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const positions = nonzeroPositionsFromSource(source);
  const accountRows = source.account || [];
  const accountRow = latestAccountRow(accountRows);
  const artifacts = state.configArtifacts || {};
  const savedRuns = (state.configRuns && state.configRuns.runs) || [];
  const artifactLoaded = Boolean(artifacts.run_id || artifacts.draft_id);
  const artifactDecisionRows = artifacts.decisions || [];
  const artifactOrderRows = artifacts.orders || [];
  const artifactFillRows = artifacts.fills || [];
  const artifactAccountRows = artifacts.account || [];
  const artifactLogs = artifacts.logs || [];
  const rawArtifactRollups = artifacts.performance_rollups || artifacts.rollups || [];
  const artifactRollups = Array.isArray(rawArtifactRollups)
    ? rawArtifactRollups
    : [
        ...(rawArtifactRollups.rollups || []),
        ...Object.values(rawArtifactRollups.period_rollups || {}).flat(),
      ];
  const hiddenEvents = Math.max(0, allEvents.length - visibleEvents.length);
  const activeFilters = [
    ($("run-events-filter-text") || {}).value ? `event search ${$("run-events-filter-text").value}` : "",
    ($("run-events-filter-type") || {}).value ? `event type ${$("run-events-filter-type").value}` : "",
    ($("run-events-filter-status") || {}).value ? `event status ${$("run-events-filter-status").value}` : "",
    ($("runs-filter-text") || {}).value ? `run search ${$("runs-filter-text").value}` : "",
    ($("runs-filter-status") || {}).value ? `run status ${$("runs-filter-status").value}` : "",
    ($("runs-filter-mode") || {}).value ? `run mode ${$("runs-filter-mode").value}` : "",
  ].filter(Boolean);
  const latestRun = runs[0] || null;
  const latestMetrics = normalizedRunMetrics(latestRun);
  let statusValue = "idle";
  let headline = "No run evidence loaded";
  let next = { action: "state", label: "Review State" };
  let note = "Publish runner telemetry or load saved Workbench artifacts before trusting run evidence.";
  if (orders.length) {
    statusValue = "warn";
    headline = "Open-order evidence needs review";
    note = `${numberText(orders.length, 0)} non-terminal order event${orders.length === 1 ? "" : "s"} are visible; reconcile state before reading results.`;
    next = { action: "state", label: "Review State" };
  } else if (badEvents.length) {
    statusValue = "bad";
    headline = "Execution issue evidence needs review";
    note = `${numberText(badEvents.length, 0)} rejected, canceled, failed, or error event${badEvents.length === 1 ? "" : "s"} are visible.`;
    next = { action: "issues", label: "Show Issues" };
  } else if (positions.length) {
    statusValue = "warn";
    headline = "Position evidence needs review";
    note = `${numberText(positions.length, 0)} position${positions.length === 1 ? "" : "s"} visible in the selected/current account source.`;
    next = { action: "state", label: "Review Positions" };
  } else if (fills.length || artifactFillRows.length) {
    statusValue = "ok";
    headline = "Fill evidence is visible";
    note = `${numberText(fills.length, 0)} recent fill event${fills.length === 1 ? "" : "s"} and ${numberText(artifactFillRows.length, 0)} loaded artifact fill row${artifactFillRows.length === 1 ? "" : "s"} are visible.`;
    next = { action: "performance", label: "Open Performance" };
  } else if (allEvents.length) {
    statusValue = "ok";
    headline = "Event evidence is visible";
    note = `${numberText(allEvents.length, 0)} recent event${allEvents.length === 1 ? "" : "s"} are available; inspect event rows for decision/order context.`;
    next = { action: "events", label: "Open Events" };
  } else if (runs.length) {
    statusValue = "warn";
    headline = "Run telemetry without event evidence";
    note = `${numberText(runs.length, 0)} run${runs.length === 1 ? "" : "s"} published, but no recent decision/order/fill rows are visible.`;
    next = { action: "runs", label: "Search Runs" };
  } else if (artifactLoaded || savedRuns.length) {
    statusValue = artifactLoaded ? "ok" : "warn";
    headline = artifactLoaded ? "Artifact evidence loaded" : "Saved runs are available";
    note = artifactLoaded
      ? "Loaded artifact rows can be reviewed in Performance, Runs, and Workbench Artifacts."
      : "Saved Workbench runs exist; load one to expose detailed decisions, orders, fills, account rows, and logs.";
    next = { action: artifactLoaded ? "artifacts" : "workbench-artifacts", label: "Open Artifacts" };
  } else if (history.length) {
    statusValue = "warn";
    headline = "Status history without run evidence";
    note = "Status snapshots exist, but no current run list or loaded artifact is visible.";
    next = { action: "state", label: "Review State" };
  }
  const cards = [
    {
      status: runs.length ? "ok" : history.length || savedRuns.length || artifactLoaded ? "warn" : "bad",
      label: "Run Source",
      title: runs.length ? `${numberText(runs.length, 0)} current` : artifactLoaded ? "Artifact" : savedRuns.length ? `${numberText(savedRuns.length, 0)} saved` : "None",
      note: latestRun
        ? `${text(latestRun.id)} ${text(latestRun.status)} / ${text(latestMetrics.mode)} / age ${age((latestRun.freshness || {}).age_seconds)}.`
        : artifactLoaded ? `${text(artifacts.draft_id || "draft")} ${text(artifacts.run_id || "run")} loaded.` : "No current run list.",
    },
    {
      status: allEvents.length ? badEvents.length ? "warn" : "ok" : runs.length ? "warn" : "bad",
      label: "Recent Events",
      title: `${numberText(visibleEvents.length, 0)} / ${numberText(allEvents.length, 0)}`,
      note: `${numberText(decisions.length, 0)} decisions / ${numberText(orderEvents.length, 0)} orders / ${numberText(fills.length, 0)} fills; ${numberText(hiddenEvents, 0)} hidden by filters.`,
    },
    {
      status: badEvents.length ? "bad" : execution.status,
      label: "Execution Proof",
      title: badEvents.length ? `${numberText(badEvents.length, 0)} issues` : execution.title,
      note: execution.note,
    },
    {
      status: accountRows.length || artifactAccountRows.length ? positions.length ? "warn" : "ok" : source.has_data ? "warn" : "idle",
      label: "Account Proof",
      title: accountRows.length || artifactAccountRows.length ? `${numberText(Math.max(accountRows.length, artifactAccountRows.length), 0)} rows` : "Missing",
      note: accountRows.length
        ? `Latest ${shortTimestampAgeLabel(accountRow.timestamp)} from ${text(source.label)}; ${numberText(positions.length, 0)} positions.`
        : source.has_data ? `${text(source.label)} has no account snapshot rows.` : "No selected/current account source.",
    },
    {
      status: artifactLoaded ? "ok" : savedRuns.length ? "warn" : "idle",
      label: "Artifact Proof",
      title: artifactLoaded ? "Loaded" : savedRuns.length ? "Available" : "Missing",
      note: artifactLoaded
        ? `${numberText(artifactDecisionRows.length, 0)} decisions / ${numberText(artifactOrderRows.length, 0)} orders / ${numberText(artifactFillRows.length, 0)} fills / ${numberText(artifactLogs.length, 0)} logs.`
        : savedRuns.length ? "Saved runs exist, but no artifact is loaded." : "No saved run artifact is visible.",
    },
    {
      status: activeFilters.length ? "warn" : "ok",
      label: "Filters",
      title: activeFilters.length ? `${numberText(activeFilters.length, 0)} active` : "Clear",
      note: activeFilters.length ? activeFilters.slice(0, 3).join(" / ") : "No run/event filters are active.",
    },
  ];
  const lines = [
    {
      status: statusValue,
      title: "Summary",
      detail: `${headline}. ${note}`,
    },
    {
      status: cards[0].status,
      title: "Run Source Evidence",
      detail: latestRun
        ? `Current run ${text(latestRun.id)} status=${text(latestRun.status)} mode=${text(latestMetrics.mode)} freshness=${age((latestRun.freshness || {}).age_seconds)}; ${numberText(history.length, 0)} status-history snapshot${history.length === 1 ? "" : "s"}.`
        : artifactLoaded ? `Loaded artifact draft=${text(artifacts.draft_id)} run=${text(artifacts.run_id)}; ${numberText(savedRuns.length, 0)} saved run record${savedRuns.length === 1 ? "" : "s"} visible.`
          : `${numberText(savedRuns.length, 0)} saved run record${savedRuns.length === 1 ? "" : "s"}; ${numberText(history.length, 0)} status-history snapshot${history.length === 1 ? "" : "s"}.`,
    },
    {
      status: cards[1].status,
      title: "Event Flow Evidence",
      detail: `${numberText(visibleEvents.length, 0)} visible / ${numberText(allEvents.length, 0)} recent events; ${numberText(decisions.length, 0)} decisions, ${numberText(orderEvents.length, 0)} orders, ${numberText(fills.length, 0)} fills. ${eventFlow.nextAction}`,
    },
    {
      status: badEvents.length ? "bad" : execution.status,
      title: "Execution Quality Evidence",
      detail: `${execution.title}. ${numberText(execution.orders.length, 0)} order rows, ${numberText(execution.fills.length, 0)} fill rows, ${numberText(execution.missed.length, 0)} missed/rejected/canceled/held rows.`,
    },
    {
      status: orders.length || positions.length ? "warn" : source.has_data ? "ok" : "bad",
      title: "Account Boundary Evidence",
      detail: `${text(source.label || source.source_type)}; ${numberText(accountRows.length || artifactAccountRows.length, 0)} account row${(accountRows.length || artifactAccountRows.length) === 1 ? "" : "s"}; ${numberText(orders.length, 0)} non-terminal order event${orders.length === 1 ? "" : "s"}; ${numberText(positions.length, 0)} position${positions.length === 1 ? "" : "s"}.`,
    },
    {
      status: artifactLoaded ? "ok" : savedRuns.length ? "warn" : "idle",
      title: "Artifact Evidence",
      detail: artifactLoaded
        ? `${numberText(artifactDecisionRows.length, 0)} decisions, ${numberText(artifactOrderRows.length, 0)} orders, ${numberText(artifactFillRows.length, 0)} fills, ${numberText(artifactAccountRows.length, 0)} account rows, ${numberText(artifactRollups.length, 0)} rollup rows, ${numberText(artifactLogs.length, 0)} logs.`
        : savedRuns.length ? "Saved run records exist but detailed artifact rows are not loaded." : "No saved run artifact is loaded.",
    },
    {
      status: activeFilters.length ? "warn" : "ok",
      title: "Filter Evidence",
      detail: activeFilters.length
        ? `${activeFilters.join(" / ")}; ${numberText(hiddenEvents, 0)} recent event${hiddenEvents === 1 ? "" : "s"} hidden.`
        : "No run or event filters are active.",
    },
    {
      status: statusValue,
      title: "Next Verification",
      detail: `${next.label}: ${note}`,
    },
  ];
  return { status: statusValue, headline, note, next, cards, lines, visibleBadEvents, badEvents, fills, orderEvents, decisions, artifactLoaded };
}

function runsEvidenceText(model) {
  return [
    `Runs Evidence: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((line) => `${line.title}: ${line.detail}`),
  ].join("\n");
}

function renderRunsEvidence() {
  if (!$("runs-evidence-note") || !$("runs-evidence-cards") || !$("runs-evidence-body") || !$("runs-evidence-actions")) return;
  const model = runsEvidenceModel();
  state.runsEvidenceText = runsEvidenceText(model);
  $("runs-evidence-note").textContent = `${model.headline}: ${model.note}`;
  $("runs-evidence-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("runs-evidence-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("runs-evidence-actions").innerHTML = [
    `<button type="button" data-runs-evidence-action="copy">Copy Evidence</button>`,
    `<button type="button" class="secondary" data-runs-evidence-action="${escapeHtml(model.next.action)}">${escapeHtml(model.next.label)}</button>`,
    `<button type="button" class="secondary" data-runs-evidence-action="state">State</button>`,
    `<button type="button" class="secondary" data-runs-evidence-action="events">Events</button>`,
    `<button type="button" class="secondary" data-runs-evidence-action="runs">Run Search</button>`,
    `<button type="button" class="secondary" data-runs-evidence-action="performance"${model.fills.length || model.artifactLoaded ? "" : " disabled"}>Performance</button>`,
    `<button type="button" class="secondary" data-runs-evidence-action="artifacts"${model.artifactLoaded ? "" : " disabled"}>Artifacts</button>`,
  ].join("");
}

function handleRunsEvidenceAction(action) {
  if (action === "copy") {
    copyText(state.runsEvidenceText || "No runs evidence loaded").then(() => {
      $("last-refresh").textContent = "Runs evidence copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Runs evidence copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "issues") {
    applyRunsEventsAssistantAction("issues");
    return navigateToRunsLens("events");
  }
  if (action === "performance") return navigateToPerformanceLens("home");
  if (action === "artifacts" || action === "workbench-artifacts") return navigateToWorkbenchLens("artifacts");
  if (action === "events") return navigateToRunsLens("events");
  if (action === "runs") return navigateToRunsLens("runs");
  navigateToRunsLens("state");
}

function runsWorkflowCards() {
  const runs = (state.status && state.status.runs) || [];
  const history = state.history || [];
  const orders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const positions = nonzeroPositionsFromSource(source);
  const events = runEventRows();
  const fills = events.filter((event) => event.type === "fill");
  const rejectedOrders = events.filter((event) => event.type === "order" && eventStatusIsBad(event));
  const latestEvent = events[0] || null;
  const artifactLoaded = Boolean(state.configArtifacts && (state.configArtifacts.run_id || state.configArtifacts.draft_id));
  const savedRuns = (state.configRuns && state.configRuns.runs) || [];
  const visibleRuns = sortedRuns(filteredRuns(runs));
  const sourceLabel = source.label || source.source_type || "source";
  return [
    {
      label: "Current State",
      title: runs.length ? `${numberText(runs.length, 0)} Published` : savedRuns.length ? `${numberText(savedRuns.length, 0)} Saved` : "No Runs",
      value: history.length ? `${numberText(history.length, 0)} snapshots` : "no history",
      status: runs.length ? "ok" : savedRuns.length || history.length ? "warn" : "bad",
      detail: runs.length
        ? "Review current telemetry, account boundary, open orders, and positions before reading archived tables."
        : savedRuns.length ? "Saved Workbench runs exist, but no current runner telemetry is publishing." : "Start or publish a runner before Runs can answer current strategy state.",
      href: workflowHref("runs", "state"),
      cta: "State",
    },
    {
      label: "Open Orders",
      title: orders.length ? `${numberText(orders.length, 0)} Open` : "No Open Orders",
      value: rejectedOrders.length ? `${numberText(rejectedOrders.length, 0)} rejects` : "orders clear",
      status: rejectedOrders.length ? "bad" : orders.length ? "warn" : runs.length || artifactLoaded ? "ok" : "idle",
      detail: rejectedOrders.length
        ? "Rejected or canceled order telemetry is present; inspect broker/account state before trusting the run."
        : orders.length ? "Non-terminal order telemetry is visible; reconcile it with broker state." : "No recent non-terminal order telemetry is visible.",
      href: workflowHref("runs", "state"),
      cta: "Orders",
    },
    {
      label: "Positions",
      title: positions.length ? `${numberText(positions.length, 0)} Open` : "No Positions",
      value: text(sourceLabel),
      status: positions.length ? "warn" : source.has_data ? "ok" : "bad",
      detail: positions.length
        ? `${positions.slice(0, 4).map((position) => text(position.symbol)).join(", ")}${positions.length > 4 ? "..." : ""} open in the selected/current account source.`
        : source.has_data ? "Selected/current account source is flat or lacks nonzero positions." : "Load telemetry or artifacts with account snapshots to verify position state.",
      href: workflowHref("runs", "state"),
      cta: "Positions",
    },
    {
      label: "Event Timeline",
      title: events.length ? `${numberText(events.length, 0)} Events` : "No Events",
      value: latestEvent ? text(latestEvent.type) : "empty",
      status: rejectedOrders.length ? "bad" : events.length ? "ok" : runs.length ? "warn" : "idle",
      detail: latestEvent
        ? `Latest ${text(latestEvent.type)} ${text(latestEvent.status)} ${text(latestEvent.symbol)} at ${text(latestEvent.timestamp)}.`
        : "No recent decisions, orders, fills, or rejects are published.",
      href: workflowHref("runs", "events"),
      cta: "Events",
    },
    {
      label: "Run Search",
      title: visibleRuns.length ? `${numberText(visibleRuns.length, 0)} Shown` : "No Matches",
      value: runs.length ? `${numberText(runs.length, 0)} total` : `${numberText(savedRuns.length, 0)} saved`,
      status: visibleRuns.length ? "ok" : runs.length || savedRuns.length ? "warn" : "idle",
      detail: visibleRuns.length
        ? "Open the filtered run table for status, mode, freshness, decisions, orders, fills, and rejects."
        : runs.length ? "Current filters hide all published runs; adjust search, status, mode, or sort." : "No published run table is available yet.",
      href: workflowHref("runs", "runs"),
      cta: "Search",
    },
    {
      label: "Loaded Artifacts",
      title: artifactLoaded ? "Loaded" : savedRuns.length ? "Available" : "No Artifact",
      value: artifactLoaded
        ? text((state.configArtifacts || {}).run_id || (state.configArtifacts || {}).draft_id)
        : savedRuns.length ? `${numberText(savedRuns.length, 0)} saved` : "missing",
      status: artifactLoaded ? "ok" : savedRuns.length ? "warn" : "idle",
      detail: artifactLoaded
        ? `Loaded artifacts expose decisions, fills, logs, account rows, and Performance charts; ${numberText(fills.length, 0)} recent fills are also visible.`
        : savedRuns.length ? "Open a saved Workbench run artifact for full sanitized detail." : "Run or load a Workbench artifact to inspect replay/simulated-paper evidence.",
      href: workflowHref(artifactLoaded ? "performance" : "workbench", artifactLoaded ? "home" : "artifacts"),
      cta: artifactLoaded ? "Performance" : "Artifacts",
    },
  ];
}

function renderRunsWorkflowLauncher() {
  const container = $("runs-workflows");
  if (!container) return;
  const cards = runsWorkflowCards();
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

function accountBoundaryAuthority(mode, source) {
  const value = String(mode || "").replace("-", "_").toLowerCase();
  if (value === "live") return ["bad", "Live Orders", "Live account mode; do not treat dashboard controls or results as harmless."];
  if (value === "paper") return ["warn", "Broker Paper", "Broker paper account mode; orders may be submitted to a paper account."];
  if (value === "simulated_paper") return ["ok", "Local Sim", "Local simulated-paper state; fills and account values are simulated."];
  if (value === "shadow") return ["ok", "Observe Only", "Shadow state should log signals without submitting orders."];
  if (value === "replay") return ["ok", "Historical", "Replay state comes from saved files and archived artifacts."];
  if (source && source.source_type === "archived_artifact") return ["warn", "Archived", "Mode is missing; inspect artifact metadata before interpreting account state."];
  return ["bad", "Unknown", "Mode is unavailable; verify the runner source before interpreting account state."];
}

function runsStateActionSummaryModel() {
  const source = latestArtifactPerformance();
  const summary = source.summary || {};
  const perf = source.performance || {};
  const accountRows = source.account || [];
  const accountRow = latestAccountRow(accountRows);
  const positions = nonzeroPositionsFromSource(source);
  const mode = perf.mode ?? summary.mode;
  const authority = accountBoundaryAuthority(mode, source);
  const runs = (state.status && state.status.runs) || [];
  const history = state.history || [];
  const orders = currentOpenOrderRows();
  const events = runEventRows();
  const fills = events.filter((event) => event.type === "fill");
  const badEvents = events.filter(eventStatusIsBad);
  const artifacts = state.configArtifacts || {};
  const savedRuns = (state.configRuns && state.configRuns.runs) || [];
  const artifactLoaded = Boolean(artifacts.run_id || artifacts.draft_id);
  const latestRun = runs[0] || null;
  const latestMetrics = normalizedRunMetrics(latestRun);
  const accountFreshness = accountRow && accountRow.timestamp ? shortTimestampAgeLabel(accountRow.timestamp) : "n/a";
  let status = "idle";
  let title = "No Account State Proof";
  let note = "Publish runner telemetry or load a saved artifact with account snapshots before trusting positions or order state.";
  let primaryAction = "operations";
  if (orders.length) {
    status = "warn";
    title = "Reconcile Open Orders";
    note = `${numberText(orders.length, 0)} non-terminal order event${orders.length === 1 ? "" : "s"} visible; compare with broker state before trusting results.`;
    primaryAction = "orders";
  } else if (String(mode || "").replace("-", "_").toLowerCase() === "live") {
    status = "bad";
    title = "Live Account State";
    note = "Live mode is visible in the selected source; verify account authority and operations before taking action.";
    primaryAction = "operations";
  } else if (badEvents.length) {
    status = "bad";
    title = "Execution Issues";
    note = `${numberText(badEvents.length, 0)} rejected, canceled, failed, or error event${badEvents.length === 1 ? "" : "s"} visible in recent telemetry.`;
    primaryAction = "events";
  } else if (positions.length) {
    status = "warn";
    title = "Review Open Positions";
    note = `${positions.slice(0, 4).map((position) => text(position.symbol)).join(", ")}${positions.length > 4 ? "..." : ""} open in the selected/current account source.`;
    primaryAction = "positions";
  } else if (accountRows.length) {
    status = "ok";
    title = "Account Source Ready";
    note = `Latest account snapshot ${accountFreshness}; no managed positions or open-order events are visible.`;
    primaryAction = fills.length ? "performance" : "events";
  } else if (source.has_data) {
    status = "warn";
    title = "Source Has No Account Rows";
    note = `${text(source.label)} is loaded, but no account snapshots are available to prove positions or cash.`;
    primaryAction = artifactLoaded ? "artifacts" : "runs";
  } else if (runs.length || history.length) {
    status = "warn";
    title = "Telemetry Without Account Proof";
    note = `${numberText(runs.length, 0)} current run${runs.length === 1 ? "" : "s"} and ${numberText(history.length, 0)} status snapshot${history.length === 1 ? "" : "s"} loaded, but no account rows are selected.`;
    primaryAction = "runs";
  } else if (savedRuns.length) {
    status = "warn";
    title = "Load Saved Run Artifacts";
    note = `${numberText(savedRuns.length, 0)} saved run${savedRuns.length === 1 ? "" : "s"} visible; load artifacts to inspect account/order evidence.`;
    primaryAction = "artifacts";
  }
  const cards = [
    {
      label: "Inspect First",
      status,
      title,
      note,
    },
    {
      label: "Order Authority",
      status: authority[0],
      title: authority[1],
      note: authority[2],
    },
    {
      label: "Account Source",
      status: accountRows.length ? "ok" : source.has_data ? "warn" : "idle",
      title: accountRows.length ? `${numberText(accountRows.length, 0)} rows` : source.has_data ? "partial" : "missing",
      note: accountRows.length
        ? `${text(source.label)} latest ${accountFreshness}.`
        : source.has_data ? `${text(source.label)} has no account snapshot rows.` : "No account-bearing source is selected.",
    },
    {
      label: "Orders / Positions",
      status: orders.length || positions.length ? "warn" : accountRows.length ? "ok" : "idle",
      title: `${numberText(orders.length, 0)} / ${numberText(positions.length, 0)}`,
      note: orders.length
        ? `${text(orders[0].symbol)} ${text(orders[0].status)} is latest non-terminal order.`
        : positions.length ? "Open managed positions need hold/exit review." : "No open-order events or nonzero positions visible.",
    },
    {
      label: "Current Run",
      status: runs.length ? (latestRun && (latestRun.freshness || {}).stale ? "warn" : "ok") : history.length || savedRuns.length || artifactLoaded ? "warn" : "bad",
      title: runs.length ? text(latestRun.id) : artifactLoaded ? "artifact" : history.length ? "history" : "none",
      note: latestRun
        ? `${text(latestRun.status)} / ${text(latestMetrics.mode)} / age ${age((latestRun.freshness || {}).age_seconds)}.`
        : artifactLoaded ? `${text(artifacts.run_id || artifacts.draft_id)} loaded.` : `${numberText(history.length, 0)} status snapshots / ${numberText(savedRuns.length, 0)} saved runs.`,
    },
    {
      label: "Next Move",
      status,
      title: primaryAction === "orders" ? "Orders" : primaryAction === "positions" ? "Positions" : primaryAction === "performance" ? "Performance" : "Drill Down",
      note: title,
    },
  ];
  const actionTitles = {
    orders: "Open Orders",
    positions: "Positions",
    events: "Events",
    performance: "Performance",
    artifacts: "Artifacts",
    runs: "Run Search",
    history: "Status History",
    operations: "Operations",
  };
  const actionLabels = {
    orders: "Primary",
    positions: "Primary",
    events: primaryAction === "events" ? "Primary" : "Timeline",
    performance: primaryAction === "performance" ? "Primary" : "Results",
    artifacts: primaryAction === "artifacts" ? "Primary" : "Saved",
    runs: primaryAction === "runs" ? "Primary" : "Search",
    history: "Proof",
    operations: primaryAction === "operations" ? "Primary" : "Setup",
  };
  const actions = [
    primaryAction,
    "orders",
    "positions",
    "events",
    "performance",
    "artifacts",
    "runs",
    "history",
    "operations",
  ].filter((action, index, list) => list.indexOf(action) === index).map((action) => ({
    action,
    title: actionTitles[action] || action,
    label: actionLabels[action] || "Open",
    disabled: (action === "performance" && !fills.length && !artifactLoaded)
      || (action === "artifacts" && !artifactLoaded && !savedRuns.length)
      || (action === "orders" && !orders.length)
      || (action === "positions" && !positions.length),
  }));
  return { status, title, note, cards, actions };
}

function renderRunsStateActionSummary() {
  if (!$("runs-state-action-note") || !$("runs-state-action-cards") || !$("runs-state-action-actions")) return;
  const model = runsStateActionSummaryModel();
  $("runs-state-action-note").textContent = `${model.title}: ${model.note}`;
  $("runs-state-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("runs-state-action-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="${action.disabled ? "secondary" : ""}" data-runs-state-action="${escapeHtml(action.action)}"${action.disabled ? " disabled" : ""}>
      <span>${escapeHtml(action.title)}</span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

function handleRunsStateAction(action) {
  if (action === "orders") {
    const target = $("current-orders-body") || $("current-orders-note");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "positions") {
    const target = $("current-positions-grid") || $("current-positions-note");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "events") return navigateToRunsLens("events");
  if (action === "performance") return navigateToPerformanceLens("home");
  if (action === "artifacts") return navigateToWorkbenchLens("artifacts");
  if (action === "runs") return navigateToRunsLens("runs");
  if (action === "history") {
    const target = $("history-body");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  navigateToOperationsLens("paper");
}

function renderRunsAccountBoundary() {
  if (!$("runs-account-boundary-cards") || !$("runs-account-boundary-note")) return;
  const source = latestArtifactPerformance();
  const summary = source.summary || {};
  const perf = source.performance || {};
  const accountRow = latestAccountRow(source.account || []);
  const positions = nonzeroPositionsFromSource(source);
  const mode = perf.mode ?? summary.mode;
  const authority = accountBoundaryAuthority(mode, source);
  const runs = (state.status && state.status.runs) || [];
  const orders = currentOpenOrderRows();
  const hasAccountSnapshots = Boolean(source.account && source.account.length);
  const hasTelemetryRuns = runs.length > 0;
  const sourceStatus = source.has_data
    ? source.source_type === "live_telemetry" ? "warn" : "ok"
    : "bad";
  let nextStatus = "bad";
  let nextTitle = "Load State";
  let nextNote = "Publish telemetry or open archived artifacts before trusting account-state tables.";
  if (source.has_data && !hasAccountSnapshots && source.source_type === "run_summary") {
    nextStatus = "warn";
    nextTitle = "Open Artifact";
    nextNote = "Summary-only runs do not prove current positions or account freshness.";
  } else if (orders.length) {
    nextStatus = "warn";
    nextTitle = "Verify Orders";
    nextNote = "Non-terminal order telemetry exists; reconcile it with broker/account state.";
  } else if (source.has_data && String(mode || "").toLowerCase() === "live") {
    nextStatus = "bad";
    nextTitle = "Live Caution";
    nextNote = "Live mode requires stronger operational review before taking action.";
  } else if (source.has_data) {
    nextStatus = "ok";
    nextTitle = "Review Detail";
    nextNote = "Boundary is clear enough to inspect positions, events, and artifacts below.";
  }
  const cards = [
    {
      status: sourceStatus,
      title: text(source.source_type),
      label: "Selected Source",
      note: sourceMeaning(source),
    },
    {
      status: authority[0],
      title: authority[1],
      label: "Order Authority",
      note: authority[2],
    },
    {
      status: hasAccountSnapshots ? "ok" : source.has_data ? "warn" : "idle",
      title: hasAccountSnapshots ? numberText(source.account.length, 0) : "None",
      label: "Account Snapshots",
      note: hasAccountSnapshots
        ? `Latest ${shortTimestampAgeLabel(accountRow.timestamp)} from ${text(source.label)}.`
        : "No account snapshot rows loaded for this source.",
    },
    {
      status: positions.length ? "warn" : source.has_data ? "ok" : "bad",
      title: numberText(positions.length, 0),
      label: "Managed Positions",
      note: positions.length
        ? `${positions.slice(0, 4).map((position) => position.symbol).join(", ")}${positions.length > 4 ? "..." : ""} open in selected source.`
        : "Selected source is flat or lacks position detail.",
    },
    {
      status: hasTelemetryRuns ? "ok" : source.source_type === "archived_artifact" ? "warn" : "idle",
      title: numberText(runs.length, 0),
      label: "Current Telemetry",
      note: hasTelemetryRuns
        ? `${numberText(runs.length, 0)} published run${runs.length === 1 ? "" : "s"} in current status.`
        : "No current published run list; archived data may be historical only.",
    },
    {
      status: orders.length ? "warn" : "ok",
      title: numberText(orders.length, 0),
      label: "Open-Order Signal",
      note: orders.length
        ? "Recent non-terminal order telemetry is visible below."
        : "No recent non-terminal order telemetry.",
    },
    {
      status: nextStatus,
      title: nextTitle,
      label: "Next Action",
      note: nextNote,
    },
  ];
  $("runs-account-boundary-note").textContent = `${text(source.label)} / ${text(mode)} / ${numberText(positions.length, 0)} positions / ${numberText(orders.length, 0)} open-order events`;
  $("runs-account-boundary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  renderRunsStateActionSummary();
}

function terminalOrderStatus(status) {
  const value = String(status || "").toLowerCase();
  return [
    "filled",
    "cancelled",
    "canceled",
    "rejected",
    "inactive",
    "expired",
    "done",
  ].includes(value);
}

function currentOpenOrderRows() {
  const runs = (state.status && state.status.runs) || [];
  const orders = [];
  for (const run of runs) {
    for (const orderItem of ((run.recent_events || {}).orders || [])) {
      if (terminalOrderStatus(orderItem.status)) continue;
      orders.push({
        run_id: run.id,
        timestamp: orderItem.timestamp,
        status: orderItem.status,
        symbol: orderItem.symbol,
        side: orderItem.side,
        order_type: orderItem.order_type,
        quantity: orderItem.quantity,
        cash_quantity: orderItem.cash_quantity,
        reason: orderItem.reason,
        tag: orderItem.tag,
      });
    }
  }
  return orders
    .filter((item) => item.timestamp || item.symbol || item.status)
    .sort((a, b) => String(b.timestamp || "").localeCompare(String(a.timestamp || "")))
    .slice(0, 20);
}

function renderCurrentOrdersAndPositions() {
  const orders = currentOpenOrderRows();
  $("current-orders-note").textContent = orders.length
    ? `${numberText(orders.length, 0)} recent non-terminal order event${orders.length === 1 ? "" : "s"}`
    : "No recent non-terminal order events";
  $("current-orders-body").innerHTML = orders.length
    ? orders.map((orderItem) => row([
        escapeHtml(orderItem.timestamp),
        escapeHtml(orderItem.run_id),
        statusText(orderItem.status),
        escapeHtml(orderItem.symbol),
        escapeHtml(orderItem.side),
        escapeHtml(orderItem.order_type),
        escapeHtml(orderItem.quantity ?? orderItem.cash_quantity ?? ""),
        escapeHtml([orderItem.reason, orderItem.tag].filter(Boolean).join(" / ")),
      ])).join("")
    : row([`<span class="muted">No recent open-order telemetry. Broker open-order state requires runners to publish open orders.</span>`, "", "", "", "", "", "", ""]);

  const source = latestArtifactPerformance();
  const accountRow = latestAccountRow(source.account || []);
  const positions = nonzeroPositionsFromSource(source);
  $("current-positions-note").textContent = source.account && source.account.length
    ? `Snapshot ${text(accountRow.timestamp)}`
    : "Latest selected/published summary";
  $("current-positions-grid").innerHTML = positions.length
    ? positions.map((position) => `
        <div class="position-card">
          <span>${escapeHtml(position.symbol)}</span>
          <strong>${escapeHtml(numberText(position.quantity, 4))}</strong>
          ${positionDetailHtml(position, { includeQuantity: false })}
        </div>
      `).join("")
    : `<div class="empty-card"><strong>No managed positions</strong><span>The latest selected or published account state is flat, or no account snapshot has been loaded.</span></div>`;
}

function runEventRows() {
  const runs = (state.status && state.status.runs) || [];
  const events = [];
  for (const run of runs) {
    const recent = run.recent_events || {};
    for (const event of recent.decisions || []) {
      const symbols = Array.isArray(event.symbols)
        ? event.symbols
        : event.symbol ? [event.symbol] : [];
      const detail = [
        event.status ? `status=${text(event.status)}` : "",
        event.reason ? `reason=${text(event.reason)}` : "",
        event.intents !== undefined ? `intents=${text(event.intents)}` : "",
        event.step !== undefined ? `step=${text(event.step)}` : "",
      ].filter(Boolean).join(" ");
      events.push({
        run_id: run.id,
        type: "decision",
        timestamp: event.timestamp,
        status: event.paused ? "paused" : "ok",
        symbol: symbols.join(", "),
        detail: detail || "decision checked",
      });
    }
    for (const event of recent.orders || []) {
      events.push({
        run_id: run.id,
        type: "order",
        timestamp: event.timestamp,
        status: event.status,
        symbol: event.symbol,
        detail: `${text(event.side)} ${text(event.order_type)} qty=${text(event.quantity)} cash=${text(event.cash_quantity)} reason=${text(event.reason)} tag=${text(event.tag)}`,
        raw: event,
      });
    }
    for (const event of recent.fills || []) {
      events.push({
        run_id: run.id,
        type: "fill",
        timestamp: event.timestamp,
        status: "filled",
        symbol: event.symbol,
        detail: `${text(event.side)} qty=${text(event.quantity)} price=${text(event.price)} commission=${text(event.commission)} tag=${text(event.tag)}`,
        raw: event,
      });
    }
  }
  return events
    .filter((event) => event.timestamp)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 30);
}

function eventActivityKey(event) {
  return [
    event.type,
    event.run_id,
    event.timestamp,
    event.status,
    event.symbol,
    event.detail,
  ].map(text).join("|");
}

function fetchActivityKey(item) {
  return text(item.job_id || item.path || `${item.started_at}-${item.kind}-${item.bar_size}`);
}

function alertActivityKey(item) {
  return [item.status, item.severity, item.category, item.message, item.detail].map(text).join("|");
}

function terminalFetchStatus(status) {
  const value = String(status || "").toLowerCase();
  return [
    "complete",
    "completed",
    "done",
    "success",
    "failed",
    "error",
    "cancelled",
    "canceled",
  ].includes(value);
}

function activitySnapshot() {
  const events = runEventRows();
  const fetches = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const alerts = (state.status && state.status.alerts) || [];
  return {
    eventKeys: new Set(events.map(eventActivityKey)),
    fetchByKey: new Map(fetches.map((item) => [fetchActivityKey(item), item])),
    alertKeys: new Set(alerts.map(alertActivityKey)),
    counts: {
      events: events.length,
      fetches: fetches.length,
      alerts: alerts.length,
    },
  };
}

function eventChangeCard(event) {
  const status = event.type === "fill"
    ? "ok"
    : String(event.status || "").toLowerCase().includes("reject") || String(event.status || "").toLowerCase().includes("cancel")
      ? "bad"
      : event.type === "order" ? "warn" : "ok";
  const label = event.type === "fill"
    ? `Fill ${text(event.symbol)}`
    : event.type === "order"
      ? `Order ${text(event.symbol)}`
      : `Decision ${text(event.run_id)}`;
  return {
    status,
    title: label,
    detail: `${text(event.timestamp)} - ${text(event.detail)}`,
  };
}

function activityChanges(before, after) {
  if (!before) {
    return {
      initial: true,
      items: [{
        status: "ok",
        title: "Initial snapshot loaded",
        detail: `${numberText(after.counts.events, 0)} events / ${numberText(after.counts.fetches, 0)} fetch jobs / ${numberText(after.counts.alerts, 0)} alerts`,
      }],
    };
  }
  const items = [];
  for (const event of runEventRows()) {
    if (!before.eventKeys.has(eventActivityKey(event))) {
      items.push(eventChangeCard(event));
    }
  }
  for (const [key, item] of after.fetchByKey.entries()) {
    const previous = before.fetchByKey.get(key);
    const status = text(item.status);
    if (!previous && terminalFetchStatus(status)) {
      items.push({
        status: status.toLowerCase().includes("fail") || status.toLowerCase().includes("error") ? "bad" : "ok",
        title: `Fetch ${status}`,
        detail: `${text(item.kind)} ${text(item.bar_size)} rows=${numberText(item.rows, 0)} errors=${numberText(item.errors, 0)}`,
      });
    } else if (previous && text(previous.status) !== status && terminalFetchStatus(status)) {
      items.push({
        status: status.toLowerCase().includes("fail") || status.toLowerCase().includes("error") ? "bad" : "ok",
        title: `Fetch changed to ${status}`,
        detail: `${text(item.kind)} ${text(item.bar_size)} rows=${numberText(item.rows, 0)} errors=${numberText(item.errors, 0)}`,
      });
    }
  }
  const alerts = (state.status && state.status.alerts) || [];
  for (const alert of alerts) {
    if (!before.alertKeys.has(alertActivityKey(alert))) {
      items.push({
        status: "bad",
        title: text(alert.category || alert.status || alert.severity || "Alert"),
        detail: text(alert.message || alert.detail || JSON.stringify(alert)),
      });
    }
  }
  return { initial: false, items: items.slice(0, 12) };
}

function overviewChangeCardsHtml(items, emptyText) {
  return items.length
    ? items.map((item) => `
        <div class="change-card">
          <span>${statusText(item.status)}</span>
          <strong>${escapeHtml(item.title)}</strong>
          <small>${escapeHtml(item.detail)}</small>
        </div>
      `).join("")
    : `<div class="empty-card"><strong>No new activity</strong><span>${escapeHtml(emptyText)}</span></div>`;
}

function renderOverviewChanges() {
  const changes = state.activityChanges || { items: [], initial: true };
  const items = changes.items || [];
  const detailNote = changes.initial
    ? "Current refresh baseline"
    : items.length ? `${numberText(items.length, 0)} change${items.length === 1 ? "" : "s"} since prior refresh` : "No new activity since prior refresh";
  const summaryItems = changes.initial ? items : items.slice(0, 3);
  if ($("overview-changes-note")) $("overview-changes-note").textContent = detailNote;
  if ($("overview-change-cards")) {
    $("overview-change-cards").innerHTML = overviewChangeCardsHtml(
      items,
      "No new recent signals, orders, fills, alerts, or completed fetch jobs since the previous refresh.",
    );
  }
  if ($("overview-change-summary-note")) {
    $("overview-change-summary-note").textContent = changes.initial
      ? "Current refresh baseline"
      : items.length ? `${numberText(items.length, 0)} new activity item${items.length === 1 ? "" : "s"}` : "No new activity since prior refresh";
  }
  if ($("overview-change-summary-cards")) {
    $("overview-change-summary-cards").innerHTML = overviewChangeCardsHtml(
      summaryItems,
      "No new signals, orders, fills, alerts, or completed fetches since the prior refresh.",
    );
  }
}

function renderRunEvents() {
  const allEvents = runEventRows();
  renderRunEventFilterOptions(allEvents);
  const events = sortedRunEvents(filteredRunEvents(allEvents));
  renderRunsEventsAssistant(allEvents, events);
  renderRunsEventFlowReport(allEvents, events);
  renderExecutionQualityReview(allEvents, events);
  $("run-events-note").textContent = `${numberText(events.length, 0)} shown / ${numberText(allEvents.length, 0)} recent event${allEvents.length === 1 ? "" : "s"}`;
  if ($("run-events-timeline-chart")) {
    $("run-events-timeline-chart").innerHTML = eventTimelineChart(events);
  }
  $("run-events-body").innerHTML = events.length
    ? events.map((event) => row([
        escapeHtml(event.timestamp),
        escapeHtml(event.run_id),
        escapeHtml(event.type),
        statusText(event.status),
        escapeHtml(event.symbol),
        escapeHtml(event.detail),
      ])).join("")
    : row([`<span class="muted">No recent run events match the current filters.</span>`, "", "", "", "", ""]);
}

function renderRunsEventsAssistant(allEvents = [], visibleEvents = []) {
  if (!$("runs-events-assistant-title") || !$("runs-events-assistant-cards") || !$("runs-events-assistant-actions")) return;
  const filters = {
    text: ($("run-events-filter-text").value || "").trim(),
    type: $("run-events-filter-type").value || "",
    status: $("run-events-filter-status").value || "",
    sort: $("run-events-filter-sort").value || "time_desc",
  };
  const hidden = Math.max(0, allEvents.length - visibleEvents.length);
  const latest = visibleEvents[0] || allEvents[0] || null;
  const badEvents = visibleEvents.filter(eventStatusIsBad);
  const allBadEvents = allEvents.filter(eventStatusIsBad);
  const fills = visibleEvents.filter((event) => event.type === "fill");
  const orders = visibleEvents.filter((event) => event.type === "order");
  const decisions = visibleEvents.filter((event) => event.type === "decision");
  const symbols = new Set(visibleEvents.map((event) => text(event.symbol)).filter((value) => value && value !== "n/a"));
  const runs = new Set(visibleEvents.map((event) => text(event.run_id)).filter((value) => value && value !== "n/a"));
  const activeFilters = [
    filters.text ? `search ${filters.text}` : "",
    filters.type ? `type ${filters.type}` : "",
    filters.status ? `status ${filters.status}` : "",
  ].filter(Boolean);
  let status = "idle";
  let title = "No Events";
  let note = "No current published decisions, orders, or fills are available.";
  if (visibleEvents.length) {
    status = badEvents.length ? "bad" : fills.length ? "ok" : orders.length ? "warn" : "ok";
    title = badEvents.length ? "Review Issues" : fills.length ? "Fills Visible" : "Timeline Visible";
    note = activeFilters.length
      ? `${activeFilters.join(" / ")}. ${numberText(hidden, 0)} event${hidden === 1 ? "" : "s"} hidden.`
      : "Recent timeline activity is visible; filter for rejects, fills, orders, decisions, symbols, or runs.";
  } else if (allEvents.length) {
    status = "warn";
    title = "No Matches";
    note = "Clear or adjust filters to show recent timeline activity.";
  }
  $("runs-events-assistant-title").textContent = title;
  $("runs-events-assistant-title").className = statusClass(status);
  $("runs-events-assistant-note").textContent = note;
  const cards = [
    {
      status: visibleEvents.length ? "ok" : allEvents.length ? "warn" : "bad",
      title: `${numberText(visibleEvents.length, 0)} / ${numberText(allEvents.length, 0)}`,
      label: "Visible",
      note: hidden ? `${numberText(hidden, 0)} hidden by filters.` : "All recent events are visible.",
    },
    {
      status: badEvents.length ? "bad" : visibleEvents.length ? "ok" : "bad",
      title: numberText(badEvents.length, 0),
      label: "Issues",
      note: allBadEvents.length
        ? `${numberText(allBadEvents.length, 0)} rejected, canceled, failed, or error event${allBadEvents.length === 1 ? "" : "s"} in the recent timeline.`
        : "No bad event statuses in the recent timeline.",
    },
    {
      status: fills.length ? "ok" : orders.length ? "warn" : decisions.length ? "ok" : "bad",
      title: `${numberText(fills.length, 0)} fills`,
      label: "Mix",
      note: `${numberText(decisions.length, 0)} decisions / ${numberText(orders.length, 0)} orders visible.`,
    },
    {
      status: latest ? eventStatusIsBad(latest) ? "bad" : latest.type === "order" ? "warn" : "ok" : "idle",
      title: latest ? text(latest.type) : "n/a",
      label: "Latest",
      note: latest ? `${text(latest.timestamp)} / ${text(latest.run_id)} / ${text(latest.symbol)}` : "No latest event available.",
    },
    {
      status: runs.size ? "ok" : "bad",
      title: numberText(runs.size, 0),
      label: "Runs",
      note: `${numberText(symbols.size, 0)} symbol${symbols.size === 1 ? "" : "s"} represented in visible events.`,
    },
  ];
  $("runs-events-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const latestRunId = latest ? text(latest.run_id) : "";
  $("runs-events-assistant-actions").innerHTML = [
    {
      action: "issues",
      status: allBadEvents.length ? "bad" : "ok",
      title: "Show Issues",
      note: allBadEvents.length ? "Filter to rejected, canceled, failed, or error events." : "No issue events to isolate.",
      disabled: !allBadEvents.length,
    },
    {
      action: "fills",
      status: allEvents.some((event) => event.type === "fill") ? "ok" : "warn",
      title: "Show Fills",
      note: "Filter timeline to filled executions.",
      disabled: !allEvents.some((event) => event.type === "fill"),
    },
    {
      action: "orders",
      status: allEvents.some((event) => event.type === "order") ? "warn" : "bad",
      title: "Show Orders",
      note: "Filter timeline to submitted, canceled, rejected, or held orders.",
      disabled: !allEvents.some((event) => event.type === "order"),
    },
    {
      action: "decisions",
      status: allEvents.some((event) => event.type === "decision") ? "ok" : "bad",
      title: "Show Decisions",
      note: "Filter timeline to strategy checks and no-order decisions.",
      disabled: !allEvents.some((event) => event.type === "decision"),
    },
    {
      action: "latest-run",
      status: latestRunId ? "ok" : "idle",
      title: "Latest Run",
      note: latestRunId ? `Filter to ${latestRunId}.` : "No latest run available.",
      disabled: !latestRunId,
    },
    {
      action: "clear",
      status: activeFilters.length ? "ok" : "warn",
      title: "Clear Filters",
      note: activeFilters.length ? "Return to the full recent timeline." : "No event filters are active.",
      disabled: !activeFilters.length,
    },
  ].map((item) => `
    <button class="runs-events-assistant-action status-${escapeHtml(item.status)}" data-runs-events-action="${escapeHtml(item.action)}" data-run-id="${escapeHtml(latestRunId)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

function runsEventFlowModel(allEvents = [], visibleEvents = []) {
  const filters = {
    text: ($("run-events-filter-text").value || "").trim(),
    type: $("run-events-filter-type").value || "",
    status: $("run-events-filter-status").value || "",
    sort: $("run-events-filter-sort").value || "time_desc",
  };
  const runs = (state.status && state.status.runs) || [];
  const savedRuns = (state.configRuns && state.configRuns.runs) || [];
  const artifacts = state.configArtifacts || {};
  const filteredOut = Math.max(0, allEvents.length - visibleEvents.length);
  const latest = visibleEvents[0] || allEvents[0] || null;
  const badEvents = visibleEvents.filter(eventStatusIsBad);
  const allBadEvents = allEvents.filter(eventStatusIsBad);
  const decisions = visibleEvents.filter((event) => event.type === "decision");
  const orders = visibleEvents.filter((event) => event.type === "order");
  const fills = visibleEvents.filter((event) => event.type === "fill");
  const symbols = new Set(visibleEvents.map((event) => text(event.symbol)).filter((value) => value && value !== "n/a"));
  const runIds = new Set(visibleEvents.map((event) => text(event.run_id)).filter((value) => value && value !== "n/a"));
  const issueSymbols = new Set(badEvents.map((event) => text(event.symbol)).filter((value) => value && value !== "n/a"));
  const typeCounts = countBy(visibleEvents, "type");
  const statusCounts = countBy(visibleEvents, "status");
  const runCounts = countBy(visibleEvents, "run_id");
  const symbolCounts = countBy(visibleEvents, "symbol");
  const activeFilters = [
    filters.text ? `search ${filters.text}` : "",
    filters.type ? `type ${filters.type}` : "",
    filters.status ? `status ${filters.status}` : "",
  ].filter(Boolean);
  let status = "idle";
  let headline = "No event flow visible";
  let nextAction = "Start or publish a runner, or load a Workbench artifact with decisions/orders/fills.";
  if (visibleEvents.length) {
    if (badEvents.length) {
      status = "bad";
      headline = "Execution issues need review";
      nextAction = "Filter to issues first, then inspect the affected run, symbol, order status, and broker/account boundary.";
    } else if (fills.length) {
      status = "ok";
      headline = "Fills are visible";
      nextAction = "Open fills or Performance Trades to connect executions to account/equity outcomes.";
    } else if (orders.length) {
      status = "warn";
      headline = "Orders without fills visible";
      nextAction = "Review order statuses and open-order state before trusting the run outcome.";
    } else {
      status = "ok";
      headline = "Decision timeline visible";
      nextAction = "Read decision rows for signal/no-order context, then inspect orders/fills if they appear.";
    }
  } else if (allEvents.length) {
    status = "warn";
    headline = "Filters hide every event";
    nextAction = "Clear event filters or broaden the search to recover the recent timeline.";
  } else if (runs.length || savedRuns.length || artifacts.run_id || artifacts.draft_id) {
    status = "warn";
    headline = "Runs exist but no recent event rows";
    nextAction = "Open a saved artifact or verify runners publish bounded recent decisions, orders, and fills.";
  }
  const cards = [
    {
      status: visibleEvents.length ? "ok" : allEvents.length ? "warn" : "bad",
      label: "Visible Flow",
      title: `${numberText(visibleEvents.length, 0)} / ${numberText(allEvents.length, 0)}`,
      note: filteredOut ? `${numberText(filteredOut, 0)} event${filteredOut === 1 ? "" : "s"} hidden by filters.` : "All recent events are visible.",
    },
    {
      status: badEvents.length ? "bad" : allBadEvents.length ? "warn" : visibleEvents.length ? "ok" : "bad",
      label: "Issues",
      title: numberText(badEvents.length, 0),
      note: badEvents.length
        ? `${numberText(issueSymbols.size, 0)} affected symbol${issueSymbols.size === 1 ? "" : "s"} in the visible set.`
        : allBadEvents.length ? `${numberText(allBadEvents.length, 0)} issue event${allBadEvents.length === 1 ? "" : "s"} hidden by filters.` : "No rejected/canceled/failed/error statuses in recent events.",
    },
    {
      status: fills.length ? "ok" : orders.length ? "warn" : decisions.length ? "ok" : "idle",
      label: "Decision -> Fill",
      title: `${numberText(decisions.length, 0)}D / ${numberText(orders.length, 0)}O / ${numberText(fills.length, 0)}F`,
      note: fills.length ? "Executions are visible." : orders.length ? "Orders are visible without matching visible fills." : decisions.length ? "Only decision events are visible." : "No event mix loaded.",
    },
    {
      status: runIds.size ? "ok" : "idle",
      label: "Runs / Symbols",
      title: `${numberText(runIds.size, 0)} / ${numberText(symbols.size, 0)}`,
      note: topCountEntries(runCounts, 1).length
        ? `Most active run ${topCountEntries(runCounts, 1).map(([key, value]) => `${key} (${numberText(value, 0)})`).join(", ")}.`
        : "No run ids in visible events.",
    },
    {
      status,
      label: "Next Read",
      title: headline,
      note: nextAction,
    },
  ];
  const lines = [
    {
      status,
      title: "Summary",
      detail: `${headline}. ${numberText(visibleEvents.length, 0)} visible recent event${visibleEvents.length === 1 ? "" : "s"} across ${numberText(runIds.size, 0)} run${runIds.size === 1 ? "" : "s"} and ${numberText(symbols.size, 0)} symbol${symbols.size === 1 ? "" : "s"}.`,
    },
    {
      status: activeFilters.length ? "warn" : "ok",
      title: "Current Filters",
      detail: activeFilters.length ? `${activeFilters.join(" / ")}; ${numberText(filteredOut, 0)} hidden event${filteredOut === 1 ? "" : "s"}.` : "No event filters are active.",
    },
    {
      status: badEvents.length ? "bad" : allBadEvents.length ? "warn" : "ok",
      title: "Execution Issues",
      detail: badEvents.length
        ? `${numberText(badEvents.length, 0)} visible rejected/canceled/failed/error event${badEvents.length === 1 ? "" : "s"}; affected symbols ${Array.from(issueSymbols).slice(0, 6).join(", ") || "n/a"}.`
        : allBadEvents.length ? `${numberText(allBadEvents.length, 0)} issue event${allBadEvents.length === 1 ? "" : "s"} exist outside the current filter.` : "No issue event status is visible in the recent event window.",
    },
    {
      status: fills.length ? "ok" : orders.length ? "warn" : decisions.length ? "ok" : "idle",
      title: "Event Mix",
      detail: `Types ${countSummary(typeCounts)}; statuses ${countSummary(statusCounts)}.`,
    },
    {
      status: latest ? eventStatusIsBad(latest) ? "bad" : latest.type === "order" ? "warn" : "ok" : "idle",
      title: "Latest Event",
      detail: latest ? `${text(latest.timestamp)} / ${text(latest.run_id)} / ${text(latest.type)} / ${text(latest.status)} / ${text(latest.symbol)} / ${text(latest.detail)}` : "No latest event row is available.",
    },
    {
      status: symbols.size ? "ok" : "bad",
      title: "Coverage",
      detail: `Top symbols ${topCountEntries(symbolCounts, 5).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") || "none"}; top runs ${topCountEntries(runCounts, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ") || "none"}.`,
    },
    {
      status,
      title: "Next Action",
      detail: nextAction,
    },
  ];
  return { status, headline, nextAction, cards, lines, latestRunId: latest ? text(latest.run_id) : "", activeFilters, allBadEvents, allEvents };
}

function runsEventFlowReportText(model) {
  return [
    `Runs Event Flow Report: ${model.headline}`,
    ...model.lines.map((line) => `${line.title}: ${line.detail}`),
  ].join("\n");
}

function renderRunsEventFlowReport(allEvents = [], visibleEvents = []) {
  if (!$("runs-event-flow-note") || !$("runs-event-flow-cards") || !$("runs-event-flow-body") || !$("runs-event-flow-actions")) return;
  const model = runsEventFlowModel(allEvents, visibleEvents);
  state.runsEventFlowReportText = runsEventFlowReportText(model);
  $("runs-event-flow-note").textContent = model.nextAction;
  $("runs-event-flow-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("runs-event-flow-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("runs-event-flow-actions").innerHTML = [
    `<button type="button" data-runs-event-flow-action="copy">Copy Report</button>`,
    `<button type="button" class="secondary" data-runs-event-flow-action="issues"${model.allBadEvents.length ? "" : " disabled"}>Show Issues</button>`,
    `<button type="button" class="secondary" data-runs-event-flow-action="fills"${model.allEvents.some((event) => event.type === "fill") ? "" : " disabled"}>Show Fills</button>`,
    `<button type="button" class="secondary" data-runs-event-flow-action="orders"${model.allEvents.some((event) => event.type === "order") ? "" : " disabled"}>Show Orders</button>`,
    `<button type="button" class="secondary" data-runs-event-flow-action="decisions"${model.allEvents.some((event) => event.type === "decision") ? "" : " disabled"}>Show Decisions</button>`,
    `<button type="button" class="secondary" data-runs-event-flow-action="latest-run" data-run-id="${escapeHtml(model.latestRunId)}"${model.latestRunId ? "" : " disabled"}>Latest Run</button>`,
    `<button type="button" class="secondary" data-runs-event-flow-action="clear"${model.activeFilters.length ? "" : " disabled"}>Clear Filters</button>`,
  ].join("");
}

function executionField(row, keys) {
  for (const key of keys) {
    const value = row ? row[key] : null;
    if (value !== null && value !== undefined && value !== "") return value;
  }
  return null;
}

function executionNumber(row, keys) {
  const value = executionField(row, keys);
  const number = finiteNumber(value);
  return number === null ? null : number;
}

function executionStatusIsMissed(row) {
  const status = String(executionField(row, ["status", "order_status"]) || "").toLowerCase();
  const reason = String(executionField(row, ["reason", "message", "error"]) || "").toLowerCase();
  const combined = `${status} ${reason}`;
  return ["reject", "cancel", "fail", "error", "expired", "inactive", "approval_required", "held"].some((token) => combined.includes(token));
}

function executionStatusIsFilled(row) {
  const status = String(executionField(row, ["status", "order_status"]) || "").toLowerCase();
  return status.includes("fill");
}

function executionReviewRows(allEvents = [], visibleEvents = []) {
  const artifacts = state.configArtifacts || {};
  const rows = [];
  for (const event of visibleEvents || []) {
    if (event.type !== "order" && event.type !== "fill") continue;
    rows.push({
      source: "recent",
      run_id: event.run_id,
      event_type: event.type,
      timestamp: event.timestamp,
      symbol: event.symbol,
      status: event.status,
      row: event.raw || event,
    });
  }
  for (const orderItem of artifacts.orders || []) {
    rows.push({
      source: "artifact",
      run_id: artifacts.run_id || artifacts.draft_id || "",
      event_type: "order",
      timestamp: orderItem.timestamp,
      symbol: orderItem.symbol,
      status: orderItem.status,
      row: orderItem,
    });
  }
  for (const fill of artifacts.fills || []) {
    rows.push({
      source: "artifact",
      run_id: artifacts.run_id || artifacts.draft_id || "",
      event_type: "fill",
      timestamp: fill.timestamp,
      symbol: fill.symbol,
      status: fill.status || (fill.simulated ? "simulated" : "filled"),
      row: fill,
    });
  }
  const keyFor = (item) => [
    item.source,
    item.event_type,
    item.run_id,
    item.timestamp,
    item.symbol,
    text(executionField(item.row, ["side"])),
    text(executionField(item.row, ["quantity", "cash_quantity"])),
    text(executionField(item.row, ["status", "order_status"])),
  ].join("|");
  const seen = new Set();
  return rows.filter((item) => {
    const key = keyFor(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function executionQuote(row, prefix) {
  const bid = executionNumber(row, [`${prefix}_bid`, `${prefix}_bid_price`, `${prefix}Bid`, `${prefix}BidPrice`]);
  const ask = executionNumber(row, [`${prefix}_ask`, `${prefix}_ask_price`, `${prefix}Ask`, `${prefix}AskPrice`]);
  return { bid, ask, spread: bid !== null && ask !== null ? ask - bid : null };
}

function executionSpreadBps(row) {
  const explicit = executionNumber(row, ["effective_spread_bps", "spread_capture_bps", "spread_bps", "fill_spread_bps"]);
  if (explicit !== null) return explicit;
  const fill = executionNumber(row, ["avg_fill_price", "average_fill_price", "price", "fill_price", "avg_price"]);
  const bid = executionNumber(row, ["submit_bid", "submit_bid_price", "decision_bid", "decision_bid_price", "bid", "bid_price"]);
  const ask = executionNumber(row, ["submit_ask", "submit_ask_price", "decision_ask", "decision_ask_price", "ask", "ask_price"]);
  if (fill === null || bid === null || ask === null || bid <= 0 || ask <= 0 || ask < bid) return null;
  const mid = (bid + ask) / 2;
  if (mid <= 0) return null;
  return (2 * Math.abs(fill - mid) / mid) * 10000;
}

function executionQualityReviewModel(allEvents = [], visibleEvents = []) {
  const rows = executionReviewRows(allEvents, visibleEvents);
  const orders = rows.filter((item) => item.event_type === "order");
  const fills = rows.filter((item) => item.event_type === "fill");
  const missed = orders.filter((item) => executionStatusIsMissed(item.row));
  const filledOrders = orders.filter((item) => executionStatusIsFilled(item.row));
  const orderTypes = countBy(orders.map((item) => ({
    order_type: executionField(item.row, ["order_type", "orderType", "type"]) || "unknown",
  })), "order_type");
  const decisionQuotes = orders.filter((item) => {
    const quote = executionQuote(item.row, "decision");
    return quote.bid !== null && quote.ask !== null;
  });
  const submitQuotes = orders.filter((item) => {
    const quote = executionQuote(item.row, "submit");
    return quote.bid !== null && quote.ask !== null;
  });
  const limitRows = orders.filter((item) => executionField(item.row, ["limit_price", "lmtPrice", "lmt_price", "entry_limit_price", "cap_price", "price_cap"]) !== null);
  const fillTimingRows = fills.filter((item) => executionField(item.row, ["fill_time", "filled_at", "timestamp"]) !== null);
  const avgFillRows = fills.filter((item) => executionField(item.row, ["avg_fill_price", "average_fill_price", "price", "fill_price", "avg_price"]) !== null);
  const spreadRows = fills.filter((item) => executionSpreadBps(item.row) !== null);
  const latestIssue = missed[0] || null;
  const missedRate = orders.length ? (missed.length / orders.length) * 100 : null;
  const fillEvidenceCount = Math.min(orders.length, filledOrders.length + fills.length);
  const fillRate = orders.length ? (fillEvidenceCount / orders.length) * 100 : null;
  let status = "bad";
  let title = "No execution telemetry";
  let note = "Publish order and fill rows to review execution quality fields.";
  if (rows.length) {
    if (missed.length) {
      status = "bad";
      title = "Missed fills need review";
      note = `${numberText(missed.length, 0)} missed/rejected/canceled/held order event${missed.length === 1 ? "" : "s"} visible.`;
    } else if (fills.length && (decisionQuotes.length || submitQuotes.length || spreadRows.length)) {
      status = "ok";
      title = "Execution context visible";
      note = "Fills and at least one quote or spread context field are available.";
    } else if (fills.length || orders.length) {
      status = "warn";
      title = "Basic execution visible";
      note = "Orders/fills are visible, but richer quote, limit, timing, or spread fields are incomplete.";
    }
  }
  const missing = [];
  if (orders.length && !decisionQuotes.length) missing.push("decision bid/ask");
  if (orders.length && !submitQuotes.length) missing.push("submit bid/ask");
  if (orders.length && !limitRows.length) missing.push("limit/cap price");
  if (fills.length && !avgFillRows.length) missing.push("average fill");
  if (fills.length && !spreadRows.length) missing.push("effective spread");
  const cards = [
    {
      status: orders.length || fills.length ? "ok" : "bad",
      label: "Rows",
      title: `${numberText(orders.length, 0)}O / ${numberText(fills.length, 0)}F`,
      note: `${numberText(rows.filter((item) => item.source === "recent").length, 0)} recent / ${numberText(rows.filter((item) => item.source === "artifact").length, 0)} artifact rows.`,
    },
    {
      status: missed.length ? "bad" : orders.length ? "ok" : "warn",
      label: "Missed Fill Rate",
      title: missedRate === null ? "n/a" : pctText(missedRate),
      note: missed.length ? `${numberText(missed.length, 0)} missed/rejected/canceled/held order rows.` : "No missed-order status is visible.",
    },
    {
      status: decisionQuotes.length || submitQuotes.length ? "ok" : orders.length ? "warn" : "bad",
      label: "Quote Coverage",
      title: `${numberText(decisionQuotes.length, 0)}D / ${numberText(submitQuotes.length, 0)}S`,
      note: "Decision-time and submit-time bid/ask rows.",
    },
    {
      status: fills.length ? avgFillRows.length === fills.length ? "ok" : "warn" : "bad",
      label: "Fill Price",
      title: `${numberText(avgFillRows.length, 0)} / ${numberText(fills.length, 0)}`,
      note: "Fills with average/fill price fields.",
    },
    {
      status: spreadRows.length ? "ok" : fills.length ? "warn" : "bad",
      label: "Spread Context",
      title: `${numberText(spreadRows.length, 0)} rows`,
      note: "Rows with explicit spread fields or enough quote/fill data to derive effective spread.",
    },
  ];
  const lines = [
    {
      status,
      title: "Summary",
      detail: `${title}. ${numberText(orders.length, 0)} order rows, ${numberText(fills.length, 0)} fill rows, ${numberText(missed.length, 0)} missed/rejected/canceled/held rows.`,
    },
    {
      status: missed.length ? "bad" : orders.length ? "ok" : "warn",
      title: "Order Outcomes",
      detail: `Fill rate ${fillRate === null ? "n/a" : pctText(fillRate)}; missed-fill rate ${missedRate === null ? "n/a" : pctText(missedRate)}; order types ${countSummary(orderTypes)}.`,
    },
    {
      status: decisionQuotes.length || submitQuotes.length ? "ok" : orders.length ? "warn" : "bad",
      title: "Quote Evidence",
      detail: `${numberText(decisionQuotes.length, 0)} decision-time quote row${decisionQuotes.length === 1 ? "" : "s"} and ${numberText(submitQuotes.length, 0)} submit-time quote row${submitQuotes.length === 1 ? "" : "s"}.`,
    },
    {
      status: limitRows.length ? "ok" : orders.length ? "warn" : "bad",
      title: "Order Style",
      detail: `${numberText(limitRows.length, 0)} order row${limitRows.length === 1 ? "" : "s"} include limit/cap price fields. Types: ${countSummary(orderTypes)}.`,
    },
    {
      status: avgFillRows.length && fillTimingRows.length ? "ok" : fills.length ? "warn" : "bad",
      title: "Fill Evidence",
      detail: `${numberText(avgFillRows.length, 0)} fills include average/fill price; ${numberText(fillTimingRows.length, 0)} include fill timestamps.`,
    },
    {
      status: spreadRows.length ? "ok" : fills.length ? "warn" : "bad",
      title: "Spread Evidence",
      detail: spreadRows.length
        ? `${numberText(spreadRows.length, 0)} row${spreadRows.length === 1 ? "" : "s"} expose effective spread or quote-derived spread context.`
        : "No effective-spread or sufficient bid/ask plus fill-price fields are visible.",
    },
    {
      status: missing.length ? "warn" : rows.length ? "ok" : "idle",
      title: "Instrumentation Gap",
      detail: missing.length
        ? `Next runner/broker fields to publish: ${missing.join(", ")}.`
        : rows.length ? "Required review fields are covered in the visible execution rows." : "No order/fill rows are available yet.",
    },
    {
      status: latestIssue ? "bad" : "ok",
      title: "Latest Issue",
      detail: latestIssue
        ? `${text(latestIssue.timestamp)} / ${text(latestIssue.symbol)} / ${text(executionField(latestIssue.row, ["status", "order_status"]))} / ${text(executionField(latestIssue.row, ["reason", "message", "error"]))}`
        : "No missed/rejected/canceled/held order is visible in the current review set.",
    },
  ];
  return { status, title, note, cards, lines, missed, orders, fills, missing };
}

function executionQualityReviewText(model) {
  return [
    `Execution Quality Review: ${model.title}`,
    ...model.lines.map((line) => `${line.title}: ${line.detail}`),
  ].join("\n");
}

function renderExecutionQualityReview(allEvents = [], visibleEvents = []) {
  if (!$("execution-quality-review-title") || !$("execution-quality-review-note") || !$("execution-quality-review-cards") || !$("execution-quality-review-body") || !$("execution-quality-review-actions")) return;
  const model = executionQualityReviewModel(allEvents, visibleEvents);
  state.executionQualityReviewText = executionQualityReviewText(model);
  $("execution-quality-review-title").textContent = model.title;
  $("execution-quality-review-title").className = statusClass(model.status);
  $("execution-quality-review-note").textContent = model.note;
  $("execution-quality-review-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("execution-quality-review-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("execution-quality-review-actions").innerHTML = [
    `<button type="button" data-execution-quality-action="copy">Copy Review</button>`,
    `<button type="button" class="secondary" data-execution-quality-action="issues"${model.missed.length ? "" : " disabled"}>Show Missed</button>`,
    `<button type="button" class="secondary" data-execution-quality-action="orders"${model.orders.length ? "" : " disabled"}>Show Orders</button>`,
    `<button type="button" class="secondary" data-execution-quality-action="fills"${model.fills.length ? "" : " disabled"}>Show Fills</button>`,
    `<button type="button" class="secondary" data-execution-quality-action="clear">Clear Filters</button>`,
  ].join("");
}

function handleExecutionQualityAction(action) {
  if (action === "copy") {
    copyText(state.executionQualityReviewText || "No execution quality review loaded").then(() => {
      $("last-refresh").textContent = "Execution quality review copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Execution quality copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "issues") {
    $("run-events-filter-text").value = "reject cancel fail error expired inactive approval held";
    $("run-events-filter-type").value = "order";
    $("run-events-filter-status").value = "";
  } else if (action === "orders") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "order";
    $("run-events-filter-status").value = "";
  } else if (action === "fills") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "fill";
    $("run-events-filter-status").value = "";
  } else if (action === "clear") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "";
    $("run-events-filter-status").value = "";
  }
  renderRunEvents();
  navigateToRunsLens("events");
}

function handleRunsEventFlowAction(target) {
  const action = target.dataset.runsEventFlowAction || "";
  if (action === "copy") {
    copyText(state.runsEventFlowReportText || "No runs event flow report loaded").then(() => {
      $("last-refresh").textContent = "Runs event flow report copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Runs event flow copy failed: ${err.message}`;
    });
    return;
  }
  applyRunsEventsAssistantAction(action, target.dataset.runId || "");
  navigateToRunsLens("events");
}

function applyRunsEventsAssistantAction(action, runId = "") {
  if (action === "issues") {
    $("run-events-filter-text").value = "reject cancel fail error";
    $("run-events-filter-type").value = "";
    $("run-events-filter-status").value = "";
  } else if (action === "fills") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "fill";
    $("run-events-filter-status").value = "";
  } else if (action === "orders") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "order";
    $("run-events-filter-status").value = "";
  } else if (action === "decisions") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "decision";
    $("run-events-filter-status").value = "";
  } else if (action === "latest-run") {
    $("run-events-filter-text").value = runId;
    $("run-events-filter-type").value = "";
    $("run-events-filter-status").value = "";
  } else if (action === "clear") {
    $("run-events-filter-text").value = "";
    $("run-events-filter-type").value = "";
    $("run-events-filter-status").value = "";
  }
  renderRunEvents();
}

function renderRunEventFilterOptions(events) {
  const select = $("run-events-filter-status");
  if (!select) return;
  const current = select.value;
  const options = Array.from(new Set((events || []).map((event) => text(event.status)).filter((value) => value !== "n/a"))).sort();
  select.innerHTML = [
    `<option value="">All</option>`,
    ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
  ].join("");
  if (options.includes(current)) select.value = current;
}

function filteredRunEvents(events) {
  const query = ($("run-events-filter-text").value || "").trim().toLowerCase();
  const type = $("run-events-filter-type").value || "";
  const status = $("run-events-filter-status").value || "";
  return (events || []).filter((event) => {
    if (type && text(event.type) !== type) return false;
    if (status && text(event.status) !== status) return false;
    if (!query) return true;
    const haystack = [
      event.timestamp,
      event.run_id,
      event.type,
      event.status,
      event.symbol,
      event.detail,
    ].map(text).join(" ").toLowerCase();
    const terms = query.split(/\s+/).filter(Boolean);
    return terms.length > 1 ? terms.some((term) => haystack.includes(term)) : haystack.includes(query);
  });
}

function sortedRunEvents(events) {
  const sortMode = $("run-events-filter-sort").value || "time_desc";
  return (events || []).slice().sort((left, right) => {
    if (sortMode === "time_asc") return String(left.timestamp || "").localeCompare(String(right.timestamp || ""));
    if (sortMode === "type_asc") {
      return String(left.type || "").localeCompare(String(right.type || ""))
        || String(left.timestamp || "").localeCompare(String(right.timestamp || ""));
    }
    if (sortMode === "symbol_asc") {
      return String(left.symbol || "").localeCompare(String(right.symbol || ""))
        || String(left.timestamp || "").localeCompare(String(right.timestamp || ""));
    }
    if (sortMode === "run_asc") {
      return String(left.run_id || "").localeCompare(String(right.run_id || ""))
        || String(left.timestamp || "").localeCompare(String(right.timestamp || ""));
    }
    return String(right.timestamp || "").localeCompare(String(left.timestamp || ""));
  });
}

