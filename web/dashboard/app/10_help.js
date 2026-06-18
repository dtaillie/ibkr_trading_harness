function helpSetupGapItems() {
  const status = state.status || {};
  const diagnostics = state.diagnostics || {};
  const catalog = state.dataCatalog || {};
  const fetchManifests = state.fetchManifests || {};
  const drafts = state.configDrafts || {};
  const runs = status.runs || [];
  const alerts = status.alerts || [];
  const gateway = status.gateway || {};
  const dataRoots = diagnostics.data_roots || [];
  const activeRoots = dataRoots.filter((root) => root.exists && root.is_dir);
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const datasets = catalog.datasets || [];
  const cappedRoots = (catalog.root_summaries || []).filter((root) => root.scan_capped);
  const manifests = fetchManifests.manifests || [];
  const draftRows = drafts.drafts || [];
  const statusLoaded = Object.keys(status).length > 0;
  const gatewayEnabled = Boolean(gateway.enabled);
  return [
    {
      status: statusLoaded ? runs.length ? "ok" : "warn" : "bad",
      title: statusLoaded ? runs.length ? "Telemetry is publishing" : "Status loaded, no run rows" : "No status snapshot loaded",
      label: "Overview",
      note: statusLoaded
        ? runs.length
          ? `${numberText(runs.length, 0)} run${runs.length === 1 ? "" : "s"} visible; ${numberText(alerts.length, 0)} alert${alerts.length === 1 ? "" : "s"}`
          : "The receiver is reachable, but no runner telemetry is publishing recent run rows."
        : "Start the status publisher or point the dashboard at a state directory with current status.",
      href: "#overview",
    },
    {
      status: gatewayEnabled ? gateway.reachable ? "ok" : "bad" : "warn",
      title: gatewayEnabled ? gateway.reachable ? "Gateway/API check is reachable" : "Gateway/API check is not reachable" : "Gateway check is disabled",
      label: "Operations",
      note: gatewayEnabled
        ? gateway.reachable
          ? `${text(gateway.host)}:${text(gateway.port)} responded`
          : text(gateway.error || "Gateway is enabled but not reachable")
        : "This is fine for offline replay; enable Gateway checks for paper/live monitoring.",
      href: "#operations",
    },
    {
      status: activeRoots.length ? suggestedRoots.length ? "warn" : "ok" : "bad",
      title: activeRoots.length ? suggestedRoots.length ? "Data roots work, but extra roots exist" : "Configured data roots are readable" : "No readable data root configured",
      label: "Data Library",
      note: activeRoots.length
        ? `${numberText(activeRoots.length, 0)} active root${activeRoots.length === 1 ? "" : "s"}; ${numberText(suggestedRoots.length, 0)} suggested root${suggestedRoots.length === 1 ? "" : "s"} with data`
        : "Add a local cache/history directory under dashboard.data_roots.",
      href: "#data",
    },
    {
      status: datasets.length ? cappedRoots.length ? "warn" : "ok" : "idle",
      title: datasets.length ? cappedRoots.length ? "Saved data is visible but scan is capped" : "Saved data is visible" : "No saved datasets loaded",
      label: "Data Library",
      note: datasets.length
        ? `${numberText(datasets.length, 0)} dataset${datasets.length === 1 ? "" : "s"} loaded; catalog limit ${numberText(catalog.limit || 0, 0)}`
        : "Fetch data, add data roots, or inspect Storage Audit for roots outside the scan.",
      href: "#data",
    },
    {
      status: manifests.length ? "ok" : "warn",
      title: manifests.length ? "Fetch manifests are visible" : "No fetch manifests visible",
      label: "Fetch Jobs",
      note: manifests.length
        ? `${numberText(manifests.length, 0)} latest manifest${manifests.length === 1 ? "" : "s"} loaded`
        : "Fetch Jobs will stay empty until fetch scripts write manifests under dashboard.fetch_manifest_roots.",
      href: "#fetch",
    },
    {
      status: draftRows.length ? "ok" : datasets.length ? "warn" : "idle",
      title: draftRows.length ? "Workbench drafts exist" : datasets.length ? "Ready to create a replay draft" : "Workbench needs saved data first",
      label: "Workbench",
      note: draftRows.length
        ? `${numberText(draftRows.length, 0)} draft${draftRows.length === 1 ? "" : "s"} available for validation/run review`
        : datasets.length
          ? "Select scanned data, preview alignment, then generate a public-safe draft."
          : "Load at least one saved dataset before generating a replay or simulated-paper draft.",
      href: "#workbench",
    },
  ];
}

function renderHelpSetupGaps() {
  if (!$("help-setup-gaps") || !$("help-setup-note")) return;
  const items = helpSetupGapItems();
  const badCount = items.filter((item) => item.status === "bad").length;
  const warnCount = items.filter((item) => item.status === "warn").length;
  $("help-setup-note").textContent = badCount
    ? `${badCount} setup blocker${badCount === 1 ? "" : "s"} to address first`
    : warnCount
      ? `${warnCount} setup warning${warnCount === 1 ? "" : "s"}`
      : "Core setup surfaces look ready";
  $("help-setup-gaps").innerHTML = items.map((item) => `
    <a class="action-card status-${escapeHtml(item.status)}" href="${escapeHtml(item.href)}">
      <span>${statusText(item.status)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.label)} - ${escapeHtml(item.note)}</small>
    </a>
  `).join("");
  renderHelpWorkflowLauncher(items);
  renderHelpGuidedTour(items);
  renderHelpNextAssistant(items);
  renderHelpTaskNavigator(items);
  renderHelpPerformanceGuide();
  renderHelpModeBoundary();
  renderHelpCloudAccessGuide();
  renderPublicationReviewAssistant(items);
  renderHelpWorkbenchQuickstart();
}

function helpWorkflowCards(setupItems = helpSetupGapItems()) {
  const runs = (state.status && state.status.runs) || [];
  const events = runEventRows();
  const openOrders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const accountRows = source.account || [];
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const draftRows = (state.configDrafts && state.configDrafts.drafts) || [];
  const workbenchRuns = (state.configRuns && state.configRuns.runs) || [];
  const artifactLoaded = Boolean(state.configArtifacts && (state.configArtifacts.run_id || state.configArtifacts.draft_id));
  const badSetup = setupItems.filter((item) => item.status === "bad");
  const warnSetup = setupItems.filter((item) => item.status === "warn");
  const latestDecision = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");
  const latestReject = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const runEvidence = runs.length || events.length || accountRows.length;
  const simulationReady = datasets.length && (draftRows.length || workbenchRuns.length || artifactLoaded);
  const firstSetupIssue = badSetup[0] || warnSetup[0] || null;
  return [
    {
      label: "Monitor Today",
      title: runs.length ? `${numberText(runs.length, 0)} Runs` : "No Telemetry",
      value: latestReject ? "reject visible" : latestFill ? "fill visible" : latestDecision ? "decision visible" : openOrders.length ? "open orders" : "start here",
      status: latestReject ? "bad" : openOrders.length ? "warn" : runs.length ? "ok" : "bad",
      detail: runs.length
        ? "Use Overview for current health, mode, latest signal/fill, positions, and the fastest next action."
        : "Start with Overview and Operations to determine whether a runner is publishing current telemetry.",
      href: workflowHref("overview", runs.length ? "home" : "diagnostics"),
      cta: "Overview",
    },
    {
      label: "Read Performance",
      title: accountRows.length ? "Account Path" : source.has_data ? "Limited Source" : "No Source",
      value: accountRows.length ? `${numberText(accountRows.length, 0)} snapshots` : source.source_type || "missing",
      status: accountRows.length ? "ok" : source.has_data ? "warn" : runEvidence ? "warn" : "bad",
      detail: accountRows.length
        ? "Open Performance for latest-session PnL, equity curve, drawdown, returns, trades, and rollups."
        : "Performance needs account snapshots or run artifacts before return and drawdown views become useful.",
      href: workflowHref("performance", source.has_data ? "home" : "diagnostics"),
      cta: "Performance",
    },
    {
      label: "Inspect Data",
      title: datasets.length ? `${numberText(datasets.length, 0)} Files` : "No Files",
      value: manifests.length ? `${numberText(manifests.length, 0)} fetches` : "data roots",
      status: datasets.length > 2 ? "ok" : datasets.length ? "warn" : manifests.length ? "warn" : "idle",
      detail: datasets.length
        ? "Use Data Library for symbols, saved-file charts, quality checks, comparisons, and visibility diagnostics."
        : manifests.length ? "Fetch manifests exist; use Fetch Jobs and Data Library to understand output visibility." : "Configure data roots or run a fetch before simulation workflows can start.",
      href: workflowHref("data", datasets.length ? "browse" : "diagnostics"),
      cta: "Data",
    },
    {
      label: "Build Simulation",
      title: simulationReady ? "Ready" : datasets.length ? "Needs Draft" : "Needs Data",
      value: draftRows.length ? `${numberText(draftRows.length, 0)} drafts` : workbenchRuns.length ? `${numberText(workbenchRuns.length, 0)} runs` : "workbench",
      status: simulationReady ? "ok" : datasets.length ? "warn" : "idle",
      detail: datasets.length
        ? "Use Workbench to select files, preview alignment, build a public-safe draft, validate it, and run replay."
        : "Simulation starts after Data Library can see saved historical files.",
      href: workflowHref("workbench", datasets.length ? "builder" : "home"),
      cta: "Workbench",
    },
    {
      label: "Troubleshoot",
      title: firstSetupIssue ? firstSetupIssue.title : "Setup Looks Clean",
      value: badSetup.length ? `${numberText(badSetup.length, 0)} blockers` : warnSetup.length ? `${numberText(warnSetup.length, 0)} warnings` : "no gaps",
      status: badSetup.length ? "bad" : warnSetup.length ? "warn" : "ok",
      detail: firstSetupIssue
        ? `${text(firstSetupIssue.label)}: ${text(firstSetupIssue.note)}`
        : "Current setup-gap checks have no visible blockers; use Operations for paper, Gateway, remote, and command health.",
      href: firstSetupIssue ? firstSetupIssue.href : workflowHref("operations", "paper"),
      cta: firstSetupIssue ? "Fix Gap" : "Operations",
    },
    {
      label: "Publish Safely",
      title: "Boundary Guide",
      value: "public/private",
      status: "ok",
      detail: "Use the Boundary and Docs lenses for public examples, ignored private configs, publication checks, and runbook links.",
      href: workflowHref("help", "boundary"),
      cta: "Boundary",
    },
  ];
}

function helpNextAssistantModel(setupItems = helpSetupGapItems()) {
  const workflows = helpWorkflowCards(setupItems);
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const runs = (state.status && state.status.runs) || [];
  const events = runEventRows();
  const source = latestArtifactPerformance();
  const badSetup = setupItems.filter((item) => item.status === "bad");
  const warnSetup = setupItems.filter((item) => item.status === "warn");
  let primary = workflows.find((card) => card.label === "Monitor Today") || workflows[0];
  let title = "Check Current Health";
  let note = "Start in Overview to confirm whether a runner is publishing telemetry and whether the latest state is fresh.";
  if (badSetup.length) {
    primary = workflows.find((card) => card.label === "Troubleshoot") || primary;
    title = "Fix Setup First";
    note = `${text(badSetup[0].label)} is blocking the workflow: ${text(badSetup[0].note)}`;
  } else if (!datasets.length) {
    primary = workflows.find((card) => card.label === "Inspect Data") || primary;
    title = "Make Saved Data Visible";
    note = "Data Library needs configured roots and visible CSV/parquet files before replay setup is useful.";
  } else if (!drafts.length) {
    primary = workflows.find((card) => card.label === "Build Simulation") || primary;
    title = "Build A Replay Draft";
    note = "Saved data is visible; use Workbench to select files, preview alignment, generate a draft, and validate it.";
  } else if (runs.length || events.length) {
    primary = workflows.find((card) => card.label === "Monitor Today") || primary;
    title = "Review Current Run";
    note = "Runner telemetry exists; use Overview first, then Performance or Runs when a number needs evidence.";
  } else if (source.has_data) {
    primary = workflows.find((card) => card.label === "Read Performance") || primary;
    title = "Read Saved Performance";
    note = "A saved artifact source is loaded; inspect Performance for returns, drawdown, trades, and rollups.";
  } else if (warnSetup.length) {
    primary = workflows.find((card) => card.label === "Troubleshoot") || primary;
    title = "Review Setup Warnings";
    note = `${text(warnSetup[0].label)} has a warning: ${text(warnSetup[0].note)}`;
  }
  const supportCards = [
    {
      status: badSetup.length ? "bad" : warnSetup.length ? "warn" : "ok",
      label: "Setup",
      title: badSetup.length ? `${numberText(badSetup.length, 0)} blockers` : warnSetup.length ? `${numberText(warnSetup.length, 0)} warnings` : "Ready",
      note: badSetup[0] ? text(badSetup[0].title) : warnSetup[0] ? text(warnSetup[0].title) : "No visible setup blockers.",
    },
    {
      status: runs.length || events.length ? "ok" : "warn",
      label: "Telemetry",
      title: runs.length ? `${numberText(runs.length, 0)} runs` : events.length ? `${numberText(events.length, 0)} events` : "None",
      note: runs.length || events.length ? "Current run evidence is available." : "No current run telemetry is visible.",
    },
    {
      status: datasets.length ? "ok" : "idle",
      label: "Data",
      title: numberText(datasets.length, 0),
      note: datasets.length ? "Saved data is visible to the dashboard." : "No saved data is catalog-visible.",
    },
    {
      status: drafts.length ? "ok" : datasets.length ? "warn" : "idle",
      label: "Workbench",
      title: drafts.length ? `${numberText(drafts.length, 0)} drafts` : "No drafts",
      note: drafts.length ? "Saved drafts can be validated or run." : datasets.length ? "Create a replay draft next." : "Workbench needs visible data first.",
    },
  ];
  const actions = [
    primary,
    workflows.find((card) => card.label === "Inspect Data"),
    workflows.find((card) => card.label === "Build Simulation"),
    workflows.find((card) => card.label === "Publish Safely"),
  ].filter(Boolean);
  return { title, note, primary, supportCards, actions };
}

function helpGuidedTourModel(setupItems = helpSetupGapItems()) {
  const runs = (state.status && state.status.runs) || [];
  const events = runEventRows();
  const openOrders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const accountRows = source.account || [];
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const workbenchRuns = (state.configRuns && state.configRuns.runs) || [];
  const artifacts = state.configArtifacts || {};
  const artifactLoaded = Boolean(artifacts.run_id || artifacts.draft_id);
  const badSetup = setupItems.filter((item) => item.status === "bad");
  const warnSetup = setupItems.filter((item) => item.status === "warn");
  const badEvents = events.filter(eventStatusIsBad);
  const fills = events.filter((event) => event.type === "fill");
  const tour = [
    {
      step: "1",
      label: "Current Health",
      title: runs.length ? "Telemetry Visible" : badSetup.length ? "Fix Setup First" : "Confirm Runner",
      status: runs.length ? "ok" : badSetup.length ? "bad" : "warn",
      note: runs.length
        ? `${numberText(runs.length, 0)} current run${runs.length === 1 ? "" : "s"} publishing; start with Overview Home.`
        : badSetup.length ? `${text(badSetup[0].label)} is blocking the first read.` : "No current run list is visible; use Overview and Operations to confirm state.",
      href: runs.length ? "#overview" : badSetup.length ? badSetup[0].href : "#operations/diagnostics",
      cta: runs.length ? "Overview" : badSetup.length ? "Fix Gap" : "Diagnostics",
    },
    {
      step: "2",
      label: "Performance Read",
      title: accountRows.length ? "Account-Backed" : source.has_data ? "Limited Evidence" : "Needs Source",
      status: accountRows.length ? "ok" : source.has_data ? "warn" : "bad",
      note: accountRows.length
        ? `${numberText(accountRows.length, 0)} account snapshot${accountRows.length === 1 ? "" : "s"} support equity, return, and drawdown views.`
        : source.has_data ? `${text(source.label)} is available, but account-snapshot depth is limited.` : "Load current telemetry or a saved artifact before trusting returns.",
      href: source.has_data ? "#performance" : "#performance/diagnostics",
      cta: "Performance",
    },
    {
      step: "3",
      label: "Saved Data",
      title: datasets.length ? `${numberText(datasets.length, 0)} Files` : manifests.length ? "Fetches Exist" : "No Catalog",
      status: datasets.length > 2 ? "ok" : datasets.length || manifests.length ? "warn" : "bad",
      note: datasets.length
        ? "Use Data Home, Browse, Inspect, and Compare to prove historical files before simulation."
        : manifests.length ? "Fetch manifests exist; use Fetch Jobs to connect outputs to Data Library visibility." : "Configure data roots or fetch history before Workbench replay.",
      href: datasets.length ? "#data" : manifests.length ? "#fetch" : "#data/diagnostics",
      cta: datasets.length ? "Data" : manifests.length ? "Fetch Jobs" : "Data Setup",
    },
    {
      step: "4",
      label: "Simulation Path",
      title: drafts.length || workbenchRuns.length || artifactLoaded ? "Workbench Ready" : datasets.length ? "Create Draft" : "Needs Data",
      status: drafts.length || workbenchRuns.length || artifactLoaded ? "ok" : datasets.length ? "warn" : "idle",
      note: drafts.length
        ? `${numberText(drafts.length, 0)} draft${drafts.length === 1 ? "" : "s"} can be validated or run.`
        : workbenchRuns.length || artifactLoaded ? "Saved runs or loaded artifacts are available for review." : datasets.length ? "Select saved files, preview alignment, then generate a replay draft." : "Workbench should wait until saved data is visible.",
      href: datasets.length || drafts.length ? "#workbench/builder" : "#workbench",
      cta: "Workbench",
    },
    {
      step: "5",
      label: "Run Evidence",
      title: badEvents.length ? "Issues First" : fills.length ? "Fills Visible" : events.length ? "Timeline Ready" : runs.length ? "Await Events" : "No Timeline",
      status: badEvents.length ? "bad" : fills.length || events.length ? "ok" : runs.length ? "warn" : "bad",
      note: badEvents.length
        ? `${numberText(badEvents.length, 0)} issue event${badEvents.length === 1 ? "" : "s"} need Runs review.`
        : fills.length ? `${numberText(fills.length, 0)} fill event${fills.length === 1 ? "" : "s"} visible; connect executions to results.` : events.length ? `${numberText(events.length, 0)} event${events.length === 1 ? "" : "s"} visible for decision/order/fill proof.` : "Runs needs current telemetry or loaded artifacts.",
      href: badEvents.length || events.length ? "#runs/events" : "#runs",
      cta: "Runs",
    },
    {
      step: "6",
      label: "Operate Safely",
      title: openOrders.length ? "Orders Need Review" : warnSetup.length ? "Warnings Exist" : "Boundary Clear",
      status: openOrders.length ? "warn" : warnSetup.length ? "warn" : "ok",
      note: openOrders.length
        ? `${numberText(openOrders.length, 0)} open/non-terminal order event${openOrders.length === 1 ? "" : "s"} visible; review state before action.`
        : warnSetup.length ? `${text(warnSetup[0].label)} warning remains; use Operations or Help Boundary.` : "Use Operations for service state and Help Boundary before public publishing.",
      href: openOrders.length ? "#runs/state" : warnSetup.length ? warnSetup[0].href : "#operations/paper",
      cta: openOrders.length ? "State" : warnSetup.length ? "Review" : "Operations",
    },
  ];
  const firstBad = tour.find((item) => item.status === "bad");
  const firstWarn = tour.find((item) => item.status === "warn");
  const next = firstBad || firstWarn || tour[0];
  const readyCount = tour.filter((item) => item.status === "ok").length;
  const headline = firstBad
    ? `Start at step ${firstBad.step}: ${firstBad.label}`
    : firstWarn ? `Review step ${firstWarn.step}: ${firstWarn.label}` : "Tour is ready end to end";
  const note = firstBad || firstWarn
    ? next.note
    : "Current dashboard evidence supports the full path from monitoring through data, simulation, run evidence, operations, and publication boundary.";
  return { headline, note, readyCount, next, tour };
}

function renderHelpGuidedTour(setupItems = helpSetupGapItems()) {
  if (!$("help-tour-title") || !$("help-tour-note") || !$("help-tour-cards") || !$("help-tour-actions")) return;
  const model = helpGuidedTourModel(setupItems);
  $("help-tour-title").textContent = model.headline;
  $("help-tour-note").textContent = `${numberText(model.readyCount, 0)} of ${numberText(model.tour.length, 0)} steps ready. ${model.note}`;
  $("help-tour-cards").innerHTML = model.tour.map((item) => `
    <a class="action-card workflow-card status-${escapeHtml(item.status)}" href="${escapeHtml(item.href)}">
      <span>${escapeHtml(item.step)}. ${escapeHtml(item.label)}</span>
      <strong>${escapeHtml(item.title)}</strong>
      <small>${escapeHtml(item.note)}</small>
      <div class="workflow-card-foot">
        <em>${statusText(item.status)}</em>
        <b>${escapeHtml(item.cta)}</b>
      </div>
    </a>
  `).join("");
  $("help-tour-actions").innerHTML = [
    `<a class="help-next-action primary-help-action status-${escapeHtml(model.next.status)}" href="${escapeHtml(model.next.href)}">
      <span>
        <strong>${escapeHtml(`Next: ${model.next.label}`)}</strong>
        <small>${escapeHtml(model.next.note)}</small>
      </span>
      <b>${escapeHtml(model.next.cta)}</b>
    </a>`,
    `<a class="help-next-action status-ok" href="#help/pages">
      <span>
        <strong>Page Guide</strong>
        <small>Read what each top-level page is responsible for.</small>
      </span>
      <b>Pages</b>
    </a>`,
    `<a class="help-next-action status-ok" href="#help/boundary">
      <span>
        <strong>Public Boundary</strong>
        <small>Check what stays private before publishing or writing about the project.</small>
      </span>
      <b>Boundary</b>
    </a>`,
  ].join("");
}

function renderHelpNextAssistant(setupItems = helpSetupGapItems()) {
  if (!$("help-next-title") || !$("help-next-cards") || !$("help-next-actions")) return;
  const model = helpNextAssistantModel(setupItems);
  $("help-next-title").textContent = model.title;
  $("help-next-note").textContent = model.note;
  $("help-next-cards").innerHTML = model.supportCards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("help-next-actions").innerHTML = model.actions.map((action, index) => `
    <a class="help-next-action ${index === 0 ? "primary-help-action" : ""} status-${escapeHtml(action.status)}" href="${escapeHtml(action.href)}">
      <span>
        <strong>${escapeHtml(index === 0 ? `Recommended: ${action.label}` : action.label)}</strong>
        <small>${escapeHtml(action.detail)}</small>
      </span>
      <b>${escapeHtml(action.cta)}</b>
    </a>
  `).join("");
}

function helpTaskNavigatorModel(setupItems = helpSetupGapItems()) {
  const workflows = helpWorkflowCards(setupItems);
  const next = helpNextAssistantModel(setupItems);
  const runs = (state.status && state.status.runs) || [];
  const events = runEventRows();
  const openOrders = currentOpenOrderRows();
  const source = latestArtifactPerformance();
  const accountRows = source.account || [];
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const workbenchRuns = (state.configRuns && state.configRuns.runs) || [];
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const commandAudit = state.commandAudit || {};
  const badSetup = setupItems.filter((item) => item.status === "bad");
  const warnSetup = setupItems.filter((item) => item.status === "warn");
  const findWorkflow = (label) => workflows.find((card) => card.label === label) || {};
  const latestDecision = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");
  const latestReject = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const latestAccount = latestAccountRow(accountRows);
  const overallStatus = badSetup.length || latestReject ? "bad" : warnSetup.length || openOrders.length ? "warn" : "ok";
  const headline = badSetup.length
    ? "Fix setup blockers before trusting dashboard output"
    : latestReject
      ? "Inspect rejected order evidence before continuing"
      : warnSetup.length
        ? "Useable, with setup warnings to review"
        : "Dashboard route map is ready";
  const tasks = [
    {
      status: findWorkflow("Monitor Today").status || (runs.length ? "ok" : "bad"),
      title: "Monitor Current Run",
      route: "overview",
      cta: "Overview",
      detail: runs.length
        ? `${numberText(runs.length, 0)} run${runs.length === 1 ? "" : "s"} visible; latest decision ${latestDecision ? shortTimestampAgeLabel(latestDecision.timestamp) : "not visible"}.`
        : "Open Overview and Operations to confirm whether a runner is publishing telemetry.",
    },
    {
      status: accountRows.length ? "ok" : source.has_data ? "warn" : "bad",
      title: "Read Performance",
      route: "performance",
      cta: "Performance",
      detail: accountRows.length
        ? `${numberText(accountRows.length, 0)} account snapshots; latest account ${latestAccount.timestamp ? shortTimestampAgeLabel(latestAccount.timestamp) : "missing"}.`
        : source.has_data ? `${text(source.label)} has limited performance evidence.` : "Load telemetry or an artifact before return/drawdown views are useful.",
    },
    {
      status: datasets.length > 2 ? "ok" : datasets.length ? "warn" : manifests.length ? "warn" : "idle",
      title: "Inspect Saved Data",
      route: "data",
      cta: "Data Library",
      detail: datasets.length
        ? `${numberText(datasets.length, 0)} saved dataset${datasets.length === 1 ? "" : "s"} visible; use Browse, Detail, Compare, and diagnostics to inspect history.`
        : manifests.length ? "Fetch manifests exist; inspect Fetch outputs and Data Library visibility." : "Configure data roots or run a fetch before replay work.",
    },
    {
      status: manifests.length ? "ok" : "warn",
      title: "Recover Fetch Jobs",
      route: "fetch",
      cta: "Fetch Jobs",
      detail: manifests.length
        ? `${numberText(manifests.length, 0)} fetch manifest${manifests.length === 1 ? "" : "s"} available for output/error review.`
        : "Fetch recovery needs manifests; use fetch scripts that write manifest artifacts.",
    },
    {
      status: drafts.length || workbenchRuns.length ? "ok" : datasets.length ? "warn" : "idle",
      title: "Build Or Replay Simulation",
      route: "workbench",
      cta: "Workbench",
      detail: drafts.length
        ? `${numberText(drafts.length, 0)} draft${drafts.length === 1 ? "" : "s"} ready for validation or run review.`
        : datasets.length ? "Visible data can be selected, aligned, and converted into a replay draft." : "Workbench needs saved data first.",
    },
    {
      status: latestReject ? "bad" : openOrders.length ? "warn" : events.length ? "ok" : runs.length ? "warn" : "bad",
      title: "Inspect Decisions And Orders",
      route: "runs",
      cta: "Runs Events",
      detail: latestReject
        ? `${text(latestReject.symbol)} ${text(latestReject.status)} needs review.`
        : latestFill ? `${text(latestFill.symbol)} fill visible; inspect exact event context in Runs.`
          : events.length ? `${numberText(events.length, 0)} event${events.length === 1 ? "" : "s"} visible for timeline review.` : "Runs needs telemetry or loaded artifacts.",
    },
    {
      status: remoteNodes.length ? worstStatusFrom(remoteNodes) : commandAudit.enabled === false ? "warn" : "ok",
      title: "Operate Remotely",
      route: "operations",
      cta: "Operations",
      detail: remoteNodes.length
        ? `${numberText(remoteNodes.length, 0)} remote node${remoteNodes.length === 1 ? "" : "s"} visible; review diagnostics, supervisors, and command audit.`
        : "Use Operations for Gateway/API state, diagnostics, command boundaries, cleanup, and remote receiver setup.",
    },
    {
      status: "ok",
      title: "Publish Safely",
      route: "boundary",
      cta: "Boundary",
      detail: "Use Help Boundary for private configs, public examples, export commands, readiness audits, and blog/publication checks.",
    },
  ];
  const cards = [
    {
      status: overallStatus,
      label: "Current Read",
      title: headline,
      note: next.note,
    },
    {
      status: next.primary ? next.primary.status : "warn",
      label: "Recommended",
      title: next.title,
      note: next.primary ? `${next.primary.label}: ${next.primary.detail}` : "Choose a route below.",
    },
    {
      status: badSetup.length ? "bad" : warnSetup.length ? "warn" : "ok",
      label: "Setup",
      title: badSetup.length ? `${numberText(badSetup.length, 0)} blockers` : warnSetup.length ? `${numberText(warnSetup.length, 0)} warnings` : "Ready",
      note: badSetup[0] ? text(badSetup[0].title) : warnSetup[0] ? text(warnSetup[0].title) : "No setup blockers in the current dashboard state.",
    },
    {
      status: datasets.length && (runs.length || source.has_data) ? "ok" : datasets.length || runs.length || source.has_data ? "warn" : "bad",
      label: "Evidence",
      title: `${numberText(datasets.length, 0)} data / ${numberText(runs.length, 0)} runs`,
      note: `${numberText(events.length, 0)} events; ${numberText(manifests.length, 0)} fetch manifests; source ${text(source.source_type)}.`,
    },
  ];
  return { headline, next, cards, tasks };
}

function helpTaskNavigatorText(model) {
  return [
    `Help Task Navigator: ${model.headline}`,
    `Recommended: ${model.next.title} - ${model.next.note}`,
    ...model.tasks.map((task) => `${task.title} [${task.status}]: ${task.detail}`),
  ].join("\n");
}

function renderHelpTaskNavigator(setupItems = helpSetupGapItems()) {
  if (
    !$("help-task-navigator-title")
    || !$("help-task-navigator-note")
    || !$("help-task-navigator-cards")
    || !$("help-task-navigator-body")
    || !$("help-task-navigator-actions")
  ) return;
  const model = helpTaskNavigatorModel(setupItems);
  state.helpTaskNavigatorText = helpTaskNavigatorText(model);
  $("help-task-navigator-title").textContent = model.headline;
  $("help-task-navigator-note").textContent = model.next.note;
  $("help-task-navigator-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("help-task-navigator-body").innerHTML = model.tasks.map((task) => `
    <article class="performance-report-line status-${escapeHtml(task.status)}">
      <strong>${escapeHtml(task.title)}</strong>
      <span>${escapeHtml(task.detail)}</span>
    </article>
  `).join("");
  $("help-task-navigator-actions").innerHTML = [
    `<button type="button" data-help-task-navigator-action="copy">Copy Guide</button>`,
    ...model.tasks.map((task) => `
      <button type="button" class="secondary" data-help-task-navigator-action="${escapeHtml(task.route)}">${escapeHtml(task.cta)}</button>
    `),
  ].join("");
}

function handleHelpTaskNavigatorAction(action) {
  if (action === "copy") {
    copyText(state.helpTaskNavigatorText || "No Help task navigator guide loaded").then(() => {
      $("last-refresh").textContent = "Help task navigator guide copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Help task navigator copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "overview") return navigateToView("overview");
  if (action === "performance") return navigateToView("performance");
  if (action === "data") return navigateToDataLens("browse");
  if (action === "fetch") return navigateToView("fetch");
  if (action === "workbench") return navigateToWorkbenchLens("builder");
  if (action === "runs") return navigateToRunsLens("events");
  if (action === "operations") return navigateToOperationsLens("diagnostics");
  if (action === "boundary") return navigateToHelpLens("boundary");
}

function performanceGuideContext() {
  const source = latestArtifactPerformance();
  const perf = source.performance || {};
  const summary = source.summary || {};
  const allAccountRows = source.account || [];
  const period = ($("performance-period") || {}).value || "all";
  const window = performancePeriodWindow(allAccountRows, period);
  const accountRows = period === "all" ? allAccountRows : rowsInWindow(allAccountRows, window);
  const periodPerf = Object.keys(perf).length && period === "all"
    ? perf
    : performanceFromAccountRows(accountRows);
  const fills = period === "all" ? (source.fills || []) : rowsInWindow(source.fills || [], window);
  const ledger = buildTradeLedger(fills);
  const latestAccount = latestAccountRow(accountRows.length ? accountRows : allAccountRows);
  const mode = perf.mode ?? summary.mode;
  return {
    source,
    window,
    accountRows,
    allAccountRows,
    periodPerf,
    fills,
    ledger,
    mode,
    latestAccount,
    decisions: summary.decisions ?? (source.decisions || []).length,
    orders: summary.orders ?? (source.orders || []).length,
    fillCount: summary.fills ?? (source.fills || []).length,
    rejections: summary.rejections ?? summary.rejects ?? 0,
    approvalRequired: summary.approval_required_orders ?? perf.approval_required_orders ?? 0,
  };
}

function helpPerformanceGuideModel() {
  const context = performanceGuideContext();
  const snapshot = performanceSnapshotModel(context);
  const evidence = performanceEvidenceModel(context);
  const workflows = performanceWorkflowCards(context);
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");
  const latestReject = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const rollups = sortedStatusRollups();
  const todayCard = snapshot.cards.find((card) => card.label === "Today") || null;
  const drawdownCard = snapshot.cards.find((card) => card.label === "Max Drawdown") || null;
  const tradeWorkflow = workflows.find((card) => card.label === "Inspect Trades") || {};
  const rollupWorkflow = workflows.find((card) => card.label === "Open Rollups") || {};
  const sourceHasAccountPath = Boolean(context.accountRows.length || context.allAccountRows.length);
  let status = "bad";
  let headline = "Performance evidence is not loaded yet";
  let note = "Open Performance after telemetry or artifacts publish account snapshots, fills, or status-history rollups.";
  if (latestReject) {
    status = "bad";
    headline = "Review rejected order before trusting performance";
    note = `${text(latestReject.symbol)} ${text(latestReject.status)} is visible in recent events; inspect Runs before reading returns as final.`;
  } else if (sourceHasAccountPath) {
    status = "ok";
    headline = "Account-backed performance is available";
    note = `${numberText(context.accountRows.length || context.allAccountRows.length, 0)} account snapshot${(context.accountRows.length || context.allAccountRows.length) === 1 ? "" : "s"} support the selected Performance window.`;
  } else if (rollups.length) {
    status = "warn";
    headline = "Status-history rollups are available";
    note = `${numberText(rollups.length, 0)} persisted live/paper day row${rollups.length === 1 ? "" : "s"} can answer recent performance while source artifacts are limited.`;
  } else if (context.source.has_data) {
    status = "warn";
    headline = "Performance source is limited";
    note = "A summary or event-backed source is loaded, but account snapshots are missing for full equity/drawdown verification.";
  }
  const cards = [
    {
      status,
      label: "Current Read",
      title: headline,
      note,
    },
    {
      status: todayCard ? todayCard.status : "idle",
      label: "Today",
      title: todayCard ? todayCard.title : "n/a",
      note: todayCard ? todayCard.note : "No today/latest-session return card is available.",
    },
    {
      status: evidence.cards[0] ? evidence.cards[0].status : "bad",
      label: "Evidence Chain",
      title: evidence.headline,
      note: evidence.cards[0] ? evidence.cards[0].note : evidence.note,
    },
    {
      status: drawdownCard ? drawdownCard.status : "idle",
      label: "Risk",
      title: drawdownCard ? drawdownCard.title : "n/a",
      note: drawdownCard ? drawdownCard.note : "No drawdown card is available.",
    },
    {
      status: tradeWorkflow.status || "idle",
      label: "Trades",
      title: tradeWorkflow.title || "No Trades",
      note: tradeWorkflow.detail || "No fill/trade pairing evidence is visible.",
    },
    {
      status: rollupWorkflow.status || (rollups.length ? "ok" : "idle"),
      label: "Rollups",
      title: rollupWorkflow.title || `${numberText(rollups.length, 0)} rows`,
      note: rollupWorkflow.detail || "No daily/month/year rollup evidence is visible.",
    },
  ];
  const lines = [
    {
      status,
      title: "1. Start With Overview",
      detail: latestReject
        ? `Overview and Runs show a rejected/canceled order state for ${text(latestReject.symbol)}; reconcile that before trusting PnL.`
        : latestFill
          ? `Overview should show the latest fill for ${text(latestFill.symbol)} and current account/position state.`
          : latestDecision
            ? `Overview should show the latest decision check (${shortTimestampAgeLabel(latestDecision.timestamp)}) even if no order fired.`
            : "Overview tells you whether telemetry exists, whether it is fresh, and whether no-trade-today is simply the current state.",
    },
    {
      status: sourceHasAccountPath ? "ok" : context.source.has_data || rollups.length ? "warn" : "bad",
      title: "2. Read Performance Home",
      detail: sourceHasAccountPath
        ? `Performance Home uses ${numberText(context.accountRows.length || context.allAccountRows.length, 0)} account snapshots for equity, return, drawdown, and latest-session charts.`
        : context.source.has_data ? "Performance can show source identity and event-backed summary, but account path metrics need account snapshots." : "Performance needs telemetry, status-history rollups, or loaded Workbench artifacts before it can answer returns.",
    },
    {
      status: evidence.cards[0] ? evidence.cards[0].status : "bad",
      title: "3. Check The Evidence Chain",
      detail: evidence.lines.slice(0, 3).map((item) => `${item.title}: ${item.detail}`).join(" "),
    },
    {
      status: context.rejections || context.approvalRequired ? "warn" : context.fills.length ? "ok" : context.source.has_data ? "warn" : "bad",
      title: "4. Verify Trades And Orders",
      detail: `${numberText(context.fills.length, 0)} fills in the selected window; ${numberText((context.ledger.stats || {}).closed_count || 0, 0)} closed trades; ${numberText(context.rejections, 0)} rejects; ${numberText(context.approvalRequired, 0)} approval holds.`,
    },
    {
      status: rollups.length ? "ok" : context.source.has_data ? "warn" : "bad",
      title: "5. Use Rollups For The Longer View",
      detail: rollups.length
        ? `${numberText(rollups.length, 0)} persisted status-history day rows can answer day/month/year performance independent of the currently selected artifact.`
        : "Daily/month/year views need persisted status-history rollups or archived run rollups.",
    },
    {
      status: evidence.next.status,
      title: "Next Verification",
      detail: `${evidence.next.label}: use ${evidence.next.href.replace("#", "")}, then return to Performance Home if the number still needs context.`,
    },
  ];
  return { status, headline, note, cards, lines, evidence };
}

function helpPerformanceGuideText(model) {
  return [
    `Today's Performance Guide: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

function renderHelpPerformanceGuide() {
  if (
    !$("help-performance-guide-title")
    || !$("help-performance-guide-note")
    || !$("help-performance-guide-cards")
    || !$("help-performance-guide-body")
    || !$("help-performance-guide-actions")
  ) return;
  const model = helpPerformanceGuideModel();
  state.helpPerformanceGuideText = helpPerformanceGuideText(model);
  $("help-performance-guide-title").textContent = model.headline;
  $("help-performance-guide-note").textContent = model.note;
  $("help-performance-guide-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("help-performance-guide-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("help-performance-guide-actions").innerHTML = [
    `<button type="button" data-help-performance-guide-action="copy">Copy Guide</button>`,
    `<button type="button" class="secondary" data-help-performance-guide-action="overview">Overview</button>`,
    `<button type="button" class="secondary" data-help-performance-guide-action="performance">Performance Home</button>`,
    `<button type="button" class="secondary" data-help-performance-guide-action="rollups">Rollups</button>`,
    `<button type="button" class="secondary" data-help-performance-guide-action="trades">Trades</button>`,
    `<button type="button" class="secondary" data-help-performance-guide-action="runs">Runs Evidence</button>`,
    `<button type="button" class="secondary" data-help-performance-guide-action="operations">Operations</button>`,
  ].join("");
}

function handleHelpPerformanceGuideAction(action) {
  if (action === "copy") {
    copyText(state.helpPerformanceGuideText || "No performance guide loaded").then(() => {
      $("last-refresh").textContent = "Performance guide copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Performance guide copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "overview") return navigateToOverviewLens("home");
  if (action === "performance") return navigateToPerformanceLens("home");
  if (action === "rollups") return navigateToPerformanceLens("rollups");
  if (action === "trades") return navigateToPerformanceLens("trades");
  if (action === "runs") return navigateToRunsLens("events");
  if (action === "operations") return navigateToOperationsLens("paper");
}

function normalizedModeName(value) {
  const mode = String(value || "").replace("-", "_").toLowerCase();
  // Bespoke-runner vocabulary -> plugin-runner mode names.
  if (mode === "simulate_fills") return "simulated_paper";
  if (mode === "signal_monitor") return "shadow";
  return mode;
}

function helpModeDefinitionRows() {
  return [
    {
      mode: "replay",
      status: "ok",
      title: "Replay",
      detail: "Historical saved data and archived artifacts only; no broker order authority.",
      verify: "Workbench Run and saved artifacts.",
    },
    {
      mode: "shadow",
      status: "ok",
      title: "Shadow",
      detail: "Live observation and signal logging; order submissions should stay disabled.",
      verify: "Overview telemetry, Runs decisions, and Operations monitor state.",
    },
    {
      mode: "simulated_paper",
      status: "ok",
      title: "Simulated Paper",
      detail: "Local file-backed or in-process simulated fills/account state; no broker order authority.",
      verify: "Workbench artifacts, simulated account snapshots, and run config.",
    },
    {
      mode: "paper",
      status: "warn",
      title: "Broker Paper",
      detail: "Broker API order authority against a paper account; resettable, but still real API automation.",
      verify: "Operations Gateway/API, Runs orders/fills, and Performance account snapshots.",
    },
    {
      mode: "live",
      status: "bad",
      title: "Live",
      detail: "Broker API order authority against a live account; requires explicit private operational controls.",
      verify: "Runs account boundary, command audit, Gateway/API, and broker account state.",
    },
  ];
}

function helpModeBoundaryModel() {
  const source = latestArtifactPerformance();
  const summary = source.summary || {};
  const perf = source.performance || {};
  const latestRun = latestTelemetryRun();
  const metrics = normalizedRunMetrics(latestRun);
  const gateway = ((state.status || {}).gateway) || {};
  const openOrders = currentOpenOrderRows();
  const accountRows = source.account || [];
  const workbenchMode = $("config-mode") ? $("config-mode").value : "";
  const rawMode = firstPresent(
    metrics.mode,
    perf.mode,
    summary.mode,
    workbenchMode,
  );
  const mode = normalizedModeName(rawMode);
  const authority = accountBoundaryAuthority(mode, source);
  const modeDefinition = helpModeDefinitionRows().find((rowItem) => rowItem.mode === mode) || null;
  const sourceStatus = source.has_data
    ? source.source_type === "live_telemetry" ? "warn" : "ok"
    : latestRun ? "warn" : "bad";
  const gatewayStatus = gateway.enabled
    ? gateway.reachable ? "ok" : "bad"
    : mode === "paper" || mode === "live" ? "warn" : "ok";
  const accountStatus = accountRows.length
    ? "ok"
    : source.has_data || latestRun ? "warn" : "bad";
  const latestAccount = latestAccountRow(accountRows);
  const headline = modeDefinition
    ? `${modeDefinition.title}: ${authority[1]}`
    : "Mode authority is not identified yet";
  const note = modeDefinition
    ? `${authority[2]} Verify with the linked evidence views before trusting results.`
    : "Load telemetry, a Workbench artifact, or choose a Workbench mode to see order authority.";
  const cards = [
    {
      status: modeDefinition ? modeDefinition.status : "bad",
      label: "Current Mode",
      title: modeDefinition ? modeDefinition.title : "Unknown",
      note: rawMode ? `Published as ${text(rawMode)}.` : "No mode is published by the selected source.",
    },
    {
      status: authority[0],
      label: "Order Authority",
      title: authority[1],
      note: authority[2],
    },
    {
      status: sourceStatus,
      label: "Selected Source",
      title: text(source.source_type),
      note: source.has_data ? `${text(source.label)} - ${sourceMeaning(source)}` : "No telemetry or artifact source is loaded.",
    },
    {
      status: gatewayStatus,
      label: "Gateway/API",
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      note: gateway.enabled
        ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === undefined || gateway.latency_ms === null ? "" : `${gateway.latency_ms}ms`}`
        : "Gateway checks are disabled; fine for replay, but not enough for paper/live.",
    },
    {
      status: accountStatus,
      label: "Account Evidence",
      title: accountRows.length ? `${numberText(accountRows.length, 0)} snapshots` : "Missing",
      note: accountRows.length
        ? `Latest account ${shortTimestampAgeLabel(latestAccount.timestamp)}.`
        : "Account-backed PnL and position checks need published account snapshots.",
    },
    {
      status: openOrders.length ? "warn" : "ok",
      label: "Open Orders",
      title: numberText(openOrders.length, 0),
      note: openOrders.length
        ? `${text(openOrders[0].symbol)} ${text(openOrders[0].status)} needs Runs/broker reconciliation.`
        : "No recent non-terminal order telemetry.",
    },
  ];
  const definitions = helpModeDefinitionRows().map((rowItem) => ({
    status: rowItem.mode === mode ? rowItem.status : "ok",
    title: rowItem.title,
    detail: `${rowItem.detail} Verify in ${rowItem.verify}`,
  }));
  const verification = [
    {
      status: source.has_data || latestRun ? "ok" : "idle",
      title: "1. Identify The Source",
      detail: source.has_data
        ? `${text(source.label)} is selected as ${text(source.source_type)}.`
        : latestRun ? `Latest run ${text(latestRun.id)} is publishing telemetry, but Performance source detail is limited.` : "No current telemetry or loaded artifact is visible.",
    },
    {
      status: authority[0],
      title: "2. Read Order Authority",
      detail: `${authority[1]} - ${authority[2]}`,
    },
    {
      status: gatewayStatus,
      title: "3. Check Broker Connectivity",
      detail: gateway.enabled
        ? gateway.reachable ? "Gateway/API is reachable in Operations." : `Gateway/API is not reachable: ${text(gateway.error || "no response")}.`
        : "Gateway reachability is not checked; enable it before broker paper/live monitoring.",
    },
    {
      status: openOrders.length ? "warn" : "ok",
      title: "4. Reconcile Orders",
      detail: openOrders.length
        ? `${numberText(openOrders.length, 0)} non-terminal order event${openOrders.length === 1 ? "" : "s"} visible; inspect Runs Events and broker state.`
        : "No non-terminal order events are visible.",
    },
    {
      status: accountStatus,
      title: "5. Verify Account State",
      detail: accountRows.length
        ? `${numberText(accountRows.length, 0)} account snapshots support Performance and position views.`
        : "Account snapshots are missing; performance may be event-backed or summary-only.",
    },
    {
      status: modeDefinition ? "ok" : "warn",
      title: "Next Verification",
      detail: modeDefinition
        ? `${modeDefinition.verify} Use Boundary for public/private export rules.`
        : "Choose a Workbench mode or load a run artifact, then return to this guide.",
    },
  ];
  return { headline, note, cards, definitions, verification };
}

function helpModeBoundaryText(model) {
  return [
    `Mode And Order Authority Guide: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.verification.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

function renderHelpModeBoundary() {
  if (
    !$("help-mode-boundary-title")
    || !$("help-mode-boundary-note")
    || !$("help-mode-boundary-cards")
    || !$("help-mode-boundary-body")
    || !$("help-mode-boundary-actions")
  ) return;
  const model = helpModeBoundaryModel();
  state.helpModeBoundaryText = helpModeBoundaryText(model);
  $("help-mode-boundary-title").textContent = model.headline;
  $("help-mode-boundary-note").textContent = model.note;
  $("help-mode-boundary-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("help-mode-boundary-body").innerHTML = [
    ...model.definitions.map((line) => `
      <article class="performance-report-line status-${escapeHtml(line.status)}">
        <strong>${escapeHtml(line.title)}</strong>
        <span>${escapeHtml(line.detail)}</span>
      </article>
    `),
    ...model.verification.map((line) => `
      <article class="performance-report-line status-${escapeHtml(line.status)}">
        <strong>${escapeHtml(line.title)}</strong>
        <span>${escapeHtml(line.detail)}</span>
      </article>
    `),
  ].join("");
  $("help-mode-boundary-actions").innerHTML = [
    `<button type="button" data-help-mode-boundary-action="copy">Copy Guide</button>`,
    `<button type="button" class="secondary" data-help-mode-boundary-action="overview">Overview</button>`,
    `<button type="button" class="secondary" data-help-mode-boundary-action="workbench">Workbench</button>`,
    `<button type="button" class="secondary" data-help-mode-boundary-action="performance">Performance</button>`,
    `<button type="button" class="secondary" data-help-mode-boundary-action="runs">Runs</button>`,
    `<button type="button" class="secondary" data-help-mode-boundary-action="operations">Operations</button>`,
    `<button type="button" class="secondary" data-help-mode-boundary-action="boundary">Boundary</button>`,
  ].join("");
}

function handleHelpModeBoundaryAction(action) {
  if (action === "copy") {
    copyText(state.helpModeBoundaryText || "No mode boundary guide loaded").then(() => {
      $("last-refresh").textContent = "Mode boundary guide copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Mode boundary guide copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "overview") return navigateToOverviewLens("home");
  if (action === "workbench") return navigateToWorkbenchLens("builder");
  if (action === "performance") return navigateToPerformanceLens("home");
  if (action === "runs") return navigateToRunsLens("state");
  if (action === "operations") return navigateToOperationsLens("paper");
  if (action === "boundary") return navigateToHelpLens("boundary");
}

function helpCloudAccessGuideModel() {
  const status = state.status || {};
  const gateway = status.gateway || {};
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const staleNodes = staleRemoteNodes(remoteNodes);
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const remoteOpenOrders = remoteNodes.reduce((sum, node) => sum + Number(node.open_order_count || 0), 0);
  const commandAudit = state.commandAudit || {};
  const auditEvents = commandAudit.events || [];
  const integrity = commandAudit.integrity || {};
  const localRemote = status.remote_control || {};
  const localIntegrity = localRemote.integrity || {};
  const commands = state.commands || [];
  const results = state.results || [];
  const pendingCommands = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failedResults = results.filter((result) => commandStatusIsFailed(result.status));
  const supervisors = (status.supervisors || []);
  const supervisorJobs = supervisors.reduce((sum, supervisor) => sum + Number((supervisor.jobs || []).length || supervisor.job_count || 0), 0);
  const latestRun = latestTelemetryRun();
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const remoteStatus = !remoteNodes.length ? "warn" : staleNodes.length || remoteAlerts ? "warn" : "ok";
  const auditStatus = ["broken", "invalid", "error"].includes(String(integrity.status || "").toLowerCase())
    || ["bad", "invalid", "failed"].includes(String(integrity.signature_status || "").toLowerCase())
    || ["broken", "error"].includes(String(localIntegrity.status || "").toLowerCase())
    || ["bad", "invalid", "failed"].includes(String(localIntegrity.signature_status || "").toLowerCase())
    ? "bad"
    : auditEvents.length ? "ok" : localRemote.enabled ? "warn" : "warn";
  const controlStatus = failedResults.length || auditStatus === "bad"
    ? "bad"
    : pendingCommands.length || !auditEvents.length ? "warn" : "ok";
  const localRunnerStatus = latestRun || supervisors.length
    ? "ok"
    : "warn";
  const cloudCheckingReady = remoteNodes.length && !staleNodes.length && !remoteAlerts;
  const headline = auditStatus === "bad" || gatewayStatus === "bad"
    ? "Cloud access needs local review"
    : cloudCheckingReady && controlStatus !== "bad"
      ? "Cloud checking is visible; keep order authority local"
      : "Cloud checking is a local-first setup task";
  const note = remoteNodes.length
    ? `${numberText(remoteNodes.length, 0)} remote node${remoteNodes.length === 1 ? "" : "s"}, ${numberText(staleNodes.length, 0)} stale, ${numberText(remoteAlerts, 0)} alert${remoteAlerts === 1 ? "" : "s"}, and ${numberText(auditEvents.length, 0)} command-audit event${auditEvents.length === 1 ? "" : "s"} are visible.`
    : "No remote nodes are visible yet. Publish sanitized status from the trading machine before relying on cloud checking.";
  const cards = [
    {
      status: remoteStatus,
      label: "Cloud Checking",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} nodes` : "Not Publishing",
      note: remoteNodes.length
        ? `${numberText(staleNodes.length, 0)} stale / ${numberText(remoteAlerts, 0)} alerts / ${numberText(remoteOpenOrders, 0)} open orders.`
        : "Start the status publisher or post a sanitized snapshot to a hosted/local receiver.",
    },
    {
      status: gatewayStatus,
      label: "Local Gateway",
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Not Checked",
      note: gateway.enabled ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === undefined || gateway.latency_ms === null ? "" : `${gateway.latency_ms}ms`}` : "Broker connectivity stays on the trading machine.",
    },
    {
      status: localRunnerStatus,
      label: "Local Running",
      title: latestRun ? text(latestRun.run_id || latestRun.name || "runner") : supervisors.length ? `${numberText(supervisors.length, 0)} supervisor` : "No Local Proof",
      note: latestRun
        ? `Latest telemetry mode ${text(normalizedRunMetrics(latestRun).mode || latestRun.mode)}; cloud should only observe sanitized status.`
        : supervisors.length ? `${numberText(supervisorJobs, 0)} supervised job${supervisorJobs === 1 ? "" : "s"} visible.` : "Run jobs locally or through the local supervisor before expecting remote status.",
    },
    {
      status: controlStatus,
      label: "Cloud Commands",
      title: pendingCommands.length ? `${numberText(pendingCommands.length, 0)} pending` : failedResults.length ? `${numberText(failedResults.length, 0)} failed` : auditEvents.length ? "Audited" : "No Audit",
      note: `${numberText(commands.length, 0)} queued / ${numberText(results.length, 0)} results; receiver ${text(integrity.status || "n/a")} / local ${text(localIntegrity.status || "n/a")}.`,
    },
    {
      status: "ok",
      label: "Authority Boundary",
      title: "Local First",
      note: "Broker login, credentials, raw logs, private strategies, and live/paper order authority stay local.",
    },
    {
      status: "warn",
      label: "Hosted Hardening",
      title: "Manual Review",
      note: "Token auth, VPN/proxy/firewall allowlists, TLS, and bounded retention still need provider-specific review.",
    },
  ];
  const lines = [
    {
      status: remoteStatus,
      title: "Cloud Checking",
      detail: remoteNodes.length
        ? "Use Operations > Remote to inspect sanitized status snapshots, heartbeat freshness, equity, positions, open orders, recent activity counts, and alerts."
        : "Cloud checking starts when the trading machine publishes sanitized status snapshots with scripts/publish_status.py or the status-publisher service.",
    },
    {
      status: localRunnerStatus,
      title: "Cloud Running",
      detail: "The public-safe model is local running with remote visibility: the local supervisor/plugin runner owns jobs, Gateway, data, credentials, and broker authority. The hosted receiver should not directly run broker sessions.",
    },
    {
      status: controlStatus,
      title: "Remote Commands",
      detail: "Remote commands are queued requests that a local command worker polls and validates. Keep them low-risk, audited, rate-limited, and behind local enable markers; high-risk live controls are rejected fail-closed.",
    },
    {
      status: auditStatus,
      title: "Audit Evidence",
      detail: `${numberText(auditEvents.length, 0)} receiver event${auditEvents.length === 1 ? "" : "s"}; receiver integrity ${text(integrity.status || "n/a")}; receiver signature ${text(integrity.signature_status || "n/a")}; local integrity ${text(localIntegrity.status || "n/a")}.`,
    },
    {
      status: "ok",
      title: "Public/Private Boundary",
      detail: "Public examples can show the harness, receiver, status publishing, sanitized monitoring, and command audit. Private strategy configs, account IDs, credentials, logs, and tuned signals stay in ignored local files.",
    },
    {
      status: "warn",
      title: "Before Internet Exposure",
      detail: "Read Cloud Deployment Readiness, run the cloud-example audit, confirm provider firewall/proxy/TLS/retention settings, and prefer private networking or allowlisted access.",
    },
  ];
  return { headline, note, cards, lines };
}

function helpCloudAccessGuideText(model) {
  return [
    `Cloud Access Guide: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

function renderHelpCloudAccessGuide() {
  if (
    !$("help-cloud-access-title")
    || !$("help-cloud-access-note")
    || !$("help-cloud-access-cards")
    || !$("help-cloud-access-body")
    || !$("help-cloud-access-actions")
  ) return;
  const model = helpCloudAccessGuideModel();
  state.helpCloudAccessGuideText = helpCloudAccessGuideText(model);
  $("help-cloud-access-title").textContent = model.headline;
  $("help-cloud-access-note").textContent = model.note;
  $("help-cloud-access-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("help-cloud-access-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("help-cloud-access-actions").innerHTML = [
    `<button type="button" data-help-cloud-access-action="copy">Copy Guide</button>`,
    `<button type="button" class="secondary" data-help-cloud-access-action="remote">Remote Nodes</button>`,
    `<button type="button" class="secondary" data-help-cloud-access-action="control">Command Control</button>`,
    `<button type="button" class="secondary" data-help-cloud-access-action="diagnostics">Cloud Readiness</button>`,
    `<a class="secondary" href="/docs/cloud_monitoring_deployment.md" target="_blank" rel="noreferrer">Cloud Runbook</a>`,
    `<a class="secondary" href="/docs/service_restart_runbook.md" target="_blank" rel="noreferrer">Restart Runbook</a>`,
  ].join("");
}

function handleHelpCloudAccessAction(action) {
  if (action === "copy") {
    copyText(state.helpCloudAccessGuideText || "No cloud access guide loaded").then(() => {
      $("last-refresh").textContent = "Cloud access guide copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Cloud access guide copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "remote") return navigateToOperationsLens("remote");
  if (action === "control") return navigateToOperationsLens("control");
  if (action === "diagnostics") return navigateToOperationsLens("diagnostics");
}

function publicationReviewModel(setupItems = helpSetupGapItems()) {
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const manifests = (state.fetchManifests && state.fetchManifests.manifests) || [];
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const workbenchRuns = (state.configRuns && state.configRuns.runs) || [];
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const runs = (state.status && state.status.runs) || [];
  const badSetup = setupItems.filter((item) => item.status === "bad");
  const warnSetup = setupItems.filter((item) => item.status === "warn");
  const hasOperationalEvidence = datasets.length || manifests.length || drafts.length || workbenchRuns.length || runs.length;
  const headline = badSetup.length
    ? "Resolve visible setup blockers before publishing a walkthrough"
    : "Public candidate still needs automated gate plus human review";
  const nextAction = badSetup.length
    ? `${text(badSetup[0].label)} is blocking the operator story: ${text(badSetup[0].note)}`
    : "Export the public subset, run the consolidated gate in the public copy, then manually read docs, examples, dashboard copy, and the blog draft.";
  const cards = [
    {
      status: "ok",
      label: "Export Boundary",
      title: "Explicit Copy",
      note: "Use the exporter and review the manifest instead of pushing this private tree.",
    },
    {
      status: "warn",
      label: "Automated Gate",
      title: "Run Before Push",
      note: "Strict readiness, cloud examples, tests, smokes, accessibility, and optional screenshot layout checks run outside the browser.",
    },
    {
      status: badSetup.length ? "bad" : warnSetup.length ? "warn" : "ok",
      label: "Dashboard Story",
      title: badSetup.length ? `${numberText(badSetup.length, 0)} blockers` : warnSetup.length ? `${numberText(warnSetup.length, 0)} warnings` : "Coherent",
      note: badSetup[0] ? text(badSetup[0].title) : warnSetup[0] ? text(warnSetup[0].title) : "Current public dashboard setup checks have no visible blockers.",
    },
    {
      status: hasOperationalEvidence ? "ok" : "warn",
      label: "Example Evidence",
      title: `${numberText(datasets.length, 0)} data / ${numberText(drafts.length, 0)} drafts`,
      note: hasOperationalEvidence
        ? `${numberText(manifests.length, 0)} manifests, ${numberText(workbenchRuns.length, 0)} Workbench runs, ${numberText(remoteNodes.length, 0)} remote nodes visible.`
        : "Seeded smokes still cover the UI, but local state has little example evidence loaded.",
    },
    {
      status: "bad",
      label: "Never Publish",
      title: "Private Edge",
      note: "Keep tuned strategy logic, real configs, account IDs, credentials, local logs, and research outputs out of the public copy.",
    },
    {
      status: "warn",
      label: "Human Review",
      title: "Still Required",
      note: "Read README, examples, docs, dashboard labels, cloud examples, and blog draft for private assumptions and overclaims.",
    },
  ];
  const lines = [
    {
      status: "ok",
      title: "1. Review the public export manifest",
      detail: "Run the manifest list command first so the public subset shape is inspectable before replacing the public mirror.",
    },
    {
      status: "warn",
      title: "2. Run the consolidated publish gate",
      detail: "Use the exported public repo as the working directory; include screenshots for the slower final UI/layout pass.",
    },
    {
      status: "warn",
      title: "3. Manually inspect public copy and blog draft",
      detail: "Automated checks can catch sensitive tokens and private paths, but they cannot judge strategy leakage, performance claims, or publication tone.",
    },
    {
      status: "bad",
      title: "4. Keep private strategy material out",
      detail: "Do not export private plugins, tuned universes, research notebooks, paper/live configs, account identifiers, credentials, logs, or cached private data.",
    },
    {
      status: remoteNodes.length ? "warn" : "ok",
      title: "5. Treat cloud controls as a conservative prototype",
      detail: remoteNodes.length
        ? "Remote nodes are visible; verify auth, network allowlists, audit retention, and sanitized payload boundaries before writing about hosted access."
        : "Public cloud examples should stay token-authenticated, allowlisted, sanitized, and local-authority-first.",
    },
  ];
  return { headline, nextAction, cards, lines };
}

function publicationReviewText(model) {
  return [
    `Publication Review Assistant: ${model.headline}`,
    `Next action: ${model.nextAction}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

function renderPublicationReviewAssistant(setupItems = helpSetupGapItems()) {
  if (
    !$("help-publication-review-title")
    || !$("help-publication-review-note")
    || !$("help-publication-review-cards")
    || !$("help-publication-review-body")
    || !$("help-publication-review-actions")
  ) return;
  const model = publicationReviewModel(setupItems);
  state.publicationReviewText = publicationReviewText(model);
  $("help-publication-review-title").textContent = model.headline;
  $("help-publication-review-note").textContent = model.nextAction;
  $("help-publication-review-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("help-publication-review-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("help-publication-review-actions").innerHTML = [
    `<button type="button" data-publication-review-action="copy">Copy Review</button>`,
    `<button type="button" class="secondary" data-publication-review-action="copy-gate">Copy Gate</button>`,
    `<button type="button" class="secondary" data-publication-review-action="copy-export">Copy Export</button>`,
    `<button type="button" class="secondary" data-publication-review-action="workbench">Plugin Boundary</button>`,
    `<button type="button" class="secondary" data-publication-review-action="operations">Cloud Boundary</button>`,
  ].join("");
}

function handlePublicationReviewAction(action) {
  if (action === "copy") {
    copyText(state.publicationReviewText || "No publication review loaded").then(() => {
      $("last-refresh").textContent = "Publication review copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Publication review copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "copy-gate") {
    copyText("python3 scripts/public_publish_check.py --include-screenshots").then(() => {
      $("last-refresh").textContent = "Publication gate command copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Publication gate copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "copy-export") {
    copyText("python3 scripts/export_public_repo.py --dest ../algo_trade_public --force").then(() => {
      $("last-refresh").textContent = "Public export command copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Public export command copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "workbench") return navigateToWorkbenchLens("builder");
  if (action === "operations") return navigateToOperationsLens("diagnostics");
}

function renderHelpWorkflowLauncher(setupItems = helpSetupGapItems()) {
  const container = $("help-workflows");
  if (!container) return;
  const cards = helpWorkflowCards(setupItems);
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

function helpWorkbenchQuickstartModel() {
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const selectedDraft = selectedRunDraft();
  const selectedDraftId = selectedDraft ? selectedDraft.draft_id : draft.name || "";
  const validation = selectedDraftId ? draftValidationById()[selectedDraftId] : null;
  const draftValid = draft.validation ? Boolean(draft.validation.valid) : Boolean(validation && validation.valid);
  const latestRun = latestWorkbenchRunForDraft(selectedDraftId) || ((state.configRuns && state.configRuns.runs) || [])[0] || null;
  const artifacts = state.configArtifacts || {};
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id);
  const alignmentStatus = alignment.dataset_count
    ? Number(alignment.common_timestamp_count || 0) > 0
      ? Number(alignment.warning_count || 0) ? "warn" : "ok"
      : "bad"
    : selected.length ? "warn" : "bad";
  const cards = [
    {
      status: datasets.length ? "ok" : "bad",
      step: "1",
      title: "Find Saved Data",
      note: datasets.length
        ? `${numberText(datasets.length, 0)} catalog-visible files. Start in Data Library and inspect files before simulation.`
        : "Configure or scan data roots before Workbench can build a useful replay.",
      href: workflowHref("data", datasets.length ? "browse" : "diagnostics"),
      cta: "Data",
    },
    {
      status: selected.length ? dataReadiness.status : datasets.length ? "warn" : "idle",
      step: "2",
      title: "Select Data Packet",
      note: selected.length
        ? `${numberText(selected.length, 0)} selected; ${dataReadiness.summary}.`
        : "Send files from Data Detail, Data Compare, Fetch Outputs, or the Builder dataset field.",
      href: workflowHref("workbench", "builder"),
      cta: "Builder",
    },
    {
      status: alignmentStatus,
      step: "3",
      title: "Preview Alignment",
      note: alignment.dataset_count
        ? `${numberText(alignment.common_timestamp_count, 0)} common timestamps / ${pctText(alignment.common_coverage_pct)} common coverage.`
        : "Preview alignment after selecting files and a date range.",
      href: workflowHref("workbench", "builder"),
      cta: "Preview",
    },
    {
      status: draft.yaml || drafts.length ? draftValid ? "ok" : "warn" : selected.length ? "warn" : "idle",
      step: "4",
      title: "Generate Draft",
      note: draft.yaml
        ? draftValid ? "Current generated draft validates cleanly." : "Generated draft needs validation review."
        : drafts.length ? `${numberText(drafts.length, 0)} saved draft${drafts.length === 1 ? "" : "s"} available.` : "Generate a public-safe draft from selected data, plugin, risk, and cost fields.",
      href: workflowHref("workbench", "builder"),
      cta: "Draft",
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : draftValid ? "warn" : "idle",
      step: "5",
      title: "Run Replay",
      note: latestRun
        ? `${text(latestRun.action)} ${text(latestRun.status)} for ${text(latestRun.draft_id || selectedDraftId)}.`
        : draftValid ? "A valid draft is ready to run from the Run lens." : "Validate a saved draft before running replay or simulated paper.",
      href: workflowHref("workbench", "run"),
      cta: "Run",
    },
    {
      status: hasArtifacts ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "idle",
      step: "6",
      title: "Open Results",
      note: hasArtifacts
        ? "Loaded artifacts are visible in Performance, Runs, and Workbench Artifacts."
        : latestRun && latestRun.artifact_path ? "A completed run has artifacts; load them before reading performance." : "Results appear after a completed replay/simulated-paper run.",
      href: workflowHref(hasArtifacts ? "performance" : "workbench", hasArtifacts ? "home" : "artifacts"),
      cta: hasArtifacts ? "Performance" : "Artifacts",
    },
  ];
  const firstBad = cards.find((card) => card.status === "bad");
  const firstWarn = cards.find((card) => card.status === "warn");
  const next = firstBad || firstWarn || cards[cards.length - 1];
  const note = `${cards.filter((card) => card.status === "ok").length} of ${cards.length} steps ready; next: ${next.title}`;
  const actions = [
    next,
    cards[0],
    cards[1],
    cards[4],
    cards[5],
  ].filter((card, index, array) => card && array.findIndex((item) => item.title === card.title) === index);
  return { note, cards, actions };
}

function renderHelpWorkbenchQuickstart() {
  if (!$("help-workbench-quickstart-note") || !$("help-workbench-quickstart-cards") || !$("help-workbench-quickstart-actions")) return;
  const model = helpWorkbenchQuickstartModel();
  $("help-workbench-quickstart-note").textContent = model.note;
  $("help-workbench-quickstart-cards").innerHTML = model.cards.map((card) => `
    <a class="action-card status-${escapeHtml(card.status)}" href="${escapeHtml(card.href)}">
      <span>Step ${escapeHtml(card.step)} - ${escapeHtml(statusText(card.status))}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </a>
  `).join("");
  $("help-workbench-quickstart-actions").innerHTML = model.actions.map((action, index) => `
    <a class="${index === 0 ? "" : "secondary"}" href="${escapeHtml(action.href)}">${escapeHtml(index === 0 ? `Next: ${action.cta}` : action.cta)}</a>
  `).join("");
}

