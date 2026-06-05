const state = {
  status: null,
  history: [],
  dataCatalog: { datasets: [], errors: [] },
  dataDetail: null,
  fetchManifests: { manifests: [], roots: [], errors: [] },
  fetchManifestDetail: null,
  workbenchStatus: {},
  cleanupPlan: {},
  diagnostics: {},
  endpointMap: { endpoints: [] },
  configOptions: { plugins: [], modes: [], defaults: {} },
  configDraft: null,
  alignmentPreview: null,
  configDrafts: { drafts: [], errors: [] },
  draftValidations: { validations: [] },
  configRuns: { runs: [] },
  runComparison: { runs: [], leaders: {} },
  runDetail: null,
  configArtifacts: null,
  commands: [],
  results: [],
};

const commandFields = {
  pause_runner: [],
  request_status: [],
  resume_runner: [],
  run_supervisor_once: ["supervisor"],
  summarize_run: ["run"],
  supervisor_status: ["supervisor"],
  validate_config: ["config"],
  validate_supervisor_config: ["supervisor"],
};

const commandParamNames = {
  config: "config_id",
  run: "run_id",
  supervisor: "supervisor_id",
};

const $ = (id) => document.getElementById(id);

function token() {
  return sessionStorage.getItem("statusToken") || "";
}

function headers() {
  const out = { "Content-Type": "application/json" };
  const value = token();
  if (value) out.Authorization = `Bearer ${value}`;
  return out;
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.json();
}

async function fetchText(url, options = {}) {
  const response = await fetch(url, {
    ...options,
    headers: { ...headers(), ...(options.headers || {}) },
  });
  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}`);
  }
  return response.text();
}

function text(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  return String(value);
}

function escapeHtml(value) {
  return text(value).replace(/[&<>"']/g, (char) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    "\"": "&quot;",
    "'": "&#39;",
  }[char]));
}

function money(value) {
  if (value === null || value === undefined || value === "") return "n/a";
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return new Intl.NumberFormat("en-US", { style: "currency", currency: "USD" }).format(number);
}

function numberText(value, digits = 4) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return number.toLocaleString("en-US", { maximumFractionDigits: digits });
}

function pctText(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  return `${number.toLocaleString("en-US", { maximumFractionDigits: 3 })}%`;
}

function bytes(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 1024) return `${number} B`;
  if (number < 1024 * 1024) return `${(number / 1024).toFixed(1)} KB`;
  if (number < 1024 * 1024 * 1024) return `${(number / 1024 / 1024).toFixed(1)} MB`;
  return `${(number / 1024 / 1024 / 1024).toFixed(1)} GB`;
}

function age(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 120) return `${Math.round(number)}s`;
  if (number < 7200) return `${Math.round(number / 60)}m`;
  if (number < 172800) return `${Math.round(number / 3600)}h`;
  return `${Math.round(number / 86400)}d`;
}

function interval(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return "n/a";
  if (number < 120) return `${Math.round(number)}s`;
  if (number < 7200) return `${Math.round(number / 60)}m`;
  if (number < 172800) return `${Math.round(number / 3600)}h`;
  return `${Math.round(number / 86400)}d`;
}

function statusClass(value) {
  if (value === "ok" || value === true || value === "completed" || value === "running" || value === "waiting") return "status-ok";
  if (value === "warn" || value === "pending" || value === "paused" || value === "canceled") return "status-warn";
  if (value === "bad" || value === "failed" || value === "rejected" || value === "timeout" || value === "unknown" || value === false) return "status-bad";
  return "";
}

function row(cells) {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}

function statusText(value) {
  const label = text(value);
  return `<span class="${statusClass(value)}">${escapeHtml(label)}</span>`;
}

function qualityBadge(status, warnings = []) {
  const warningList = Array.isArray(warnings) ? warnings : [];
  const suffix = warningList.length ? ` (${warningList.length})` : "";
  const title = warningList.length ? ` title="${escapeHtml(warningList.join("; "))}"` : "";
  return `<span class="${statusClass(status)}"${title}>${escapeHtml(text(status))}${escapeHtml(suffix)}</span>`;
}

function setActiveView(view) {
  const targetView = view || "overview";
  for (const section of document.querySelectorAll(".dashboard-section")) {
    section.hidden = section.dataset.view !== targetView;
  }
  for (const button of document.querySelectorAll("[data-view-target]")) {
    button.classList.toggle("active", button.dataset.viewTarget === targetView);
  }
  sessionStorage.setItem("dashboardView", targetView);
}

function latestTelemetryRun() {
  const runs = (state.status && state.status.runs) || [];
  if (!runs.length) return null;
  return runs.slice().sort((a, b) => {
    const aTime = String((a.metrics || {}).last_decision_time || a.generated_at || "");
    const bTime = String((b.metrics || {}).last_decision_time || b.generated_at || "");
    return bTime.localeCompare(aTime);
  })[0];
}

function latestSummarizedComparisonRun() {
  const runs = (state.runComparison && state.runComparison.runs) || [];
  return runs.find((runItem) => runItem.summary_available) || null;
}

function latestArtifactPerformance() {
  const artifacts = state.configArtifacts || {};
  if (artifacts.run_id || artifacts.draft_id) {
    return {
      label: artifacts.run_id
        ? `${text(artifacts.draft_id)} / ${text(artifacts.run_id)}`
        : `${text(artifacts.draft_id)} latest output`,
      summary: artifacts.summary || {},
      performance: artifacts.performance || {},
      account: artifacts.account || [],
    };
  }
  const comparison = latestSummarizedComparisonRun();
  if (comparison) {
    return {
      label: `${text(comparison.draft_id)} / ${text(comparison.action)} ${text(comparison.finished_at)}`,
      summary: comparison,
      performance: comparison,
      account: [],
    };
  }
  const telemetryRun = latestTelemetryRun();
  if (telemetryRun) {
    const metrics = telemetryRun.metrics || {};
    return {
      label: `${text(telemetryRun.id)} telemetry`,
      summary: metrics,
      performance: metrics,
      account: [],
    };
  }
  return { label: "No run data", summary: {}, performance: {}, account: [] };
}

function selectedConfigDatasets() {
  const selectedPaths = Array.from($("config-dataset").selectedOptions).map((option) => option.value);
  return (state.dataCatalog.datasets || []).filter((item) => selectedPaths.includes(item.path));
}

function latestAccountRow(accountRows) {
  const rows = accountRows || [];
  for (let index = rows.length - 1; index >= 0; index -= 1) {
    const rowItem = rows[index] || {};
    if (rowItem.positions || rowItem.equity !== undefined || rowItem.cash !== undefined) {
      return rowItem;
    }
  }
  return {};
}

function nonzeroPositionsFromSource(source) {
  const summary = (source && source.summary) || {};
  const accountRow = latestAccountRow((source && source.account) || []);
  const positions = accountRow.positions || summary.final_positions || {};
  const values = accountRow.position_values || {};
  return Object.entries(positions || {})
    .map(([symbol, quantity]) => ({ symbol, quantity: Number(quantity), value: Number(values[symbol]) }))
    .filter((item) => Number.isFinite(item.quantity) && item.quantity !== 0)
    .sort((a, b) => a.symbol.localeCompare(b.symbol));
}

function overviewHealthChecks() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const runs = payload.runs || [];
  const alerts = payload.alerts || [];
  const datasets = (state.dataCatalog && state.dataCatalog.datasets) || [];
  const fetchRoots = (state.fetchManifests && state.fetchManifests.roots) || [];
  const workbenchRuns = (state.configRuns && state.configRuns.runs) || [];
  const events = runEventRows();
  const gatewayStatus = gateway.enabled
    ? gateway.reachable ? "ok" : "bad"
    : "warn";
  const dataStatus = datasets.length > 2 ? "ok" : datasets.length ? "warn" : "bad";
  const fetchRootStatus = fetchRoots.some((root) => root.exists && root.is_dir) ? "ok" : "warn";
  const runStatus = runs.length ? "ok" : workbenchRuns.length ? "warn" : "bad";
  const eventStatus = events.length ? "ok" : runs.length ? "warn" : "bad";
  return [
    {
      label: "Telemetry",
      status: payload.generated_at ? "ok" : "bad",
      detail: payload.generated_at ? `latest ${payload.generated_at}` : "No status has been published yet.",
    },
    {
      label: "Gateway/API",
      status: gatewayStatus,
      detail: gateway.enabled
        ? `reachable=${text(gateway.reachable)} ${gateway.latency_ms === null || gateway.latency_ms === undefined ? "" : `${gateway.latency_ms}ms`}`
        : "Gateway checks are disabled in this dashboard config.",
    },
    {
      label: "Strategy Runs",
      status: runStatus,
      detail: runs.length
        ? `${runs.length} published run${runs.length === 1 ? "" : "s"}`
        : workbenchRuns.length
          ? `${workbenchRuns.length} saved workbench run${workbenchRuns.length === 1 ? "" : "s"}, no live telemetry run`
          : "No published or saved runs yet.",
    },
    {
      label: "Signals/Fills",
      status: eventStatus,
      detail: events.length
        ? `${events.length} recent decision/order/fill events`
        : runs.length
          ? "Run telemetry exists, but no recent signal/order/fill events were published."
          : "No current run events yet.",
    },
    {
      label: "Saved Data",
      status: dataStatus,
      detail: datasets.length
        ? `${datasets.length} scanned dataset${datasets.length === 1 ? "" : "s"}`
        : "No saved CSV/parquet data is visible under configured roots.",
    },
    {
      label: "Fetch Jobs",
      status: fetchRootStatus,
      detail: fetchRoots.length
        ? `${fetchRoots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0)} manifests across ${fetchRoots.length} root${fetchRoots.length === 1 ? "" : "s"}`
        : "No fetch manifest root is configured.",
    },
    {
      label: "Alerts",
      status: alerts.length ? "warn" : "ok",
      detail: alerts.length
        ? `${alerts.length} alert${alerts.length === 1 ? "" : "s"} need review`
        : "No published alerts.",
    },
  ];
}

function renderOverview() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const runMetrics = (latestRun && latestRun.metrics) || {};
  const performance = latestArtifactPerformance();
  const perf = performance.performance || {};
  const summary = performance.summary || {};
  const equity = perf.final_equity ?? summary.final_equity ?? runMetrics.final_equity;
  const mode = perf.mode ?? summary.mode ?? runMetrics.mode;
  const events = runEventRows();
  const latestSignal = events.find((event) => event.type === "decision");
  const latestFill = events.find((event) => event.type === "fill");

  $("overview-equity").textContent = money(equity);
  $("overview-subtitle").textContent = performance.label;
  $("overview-mode").textContent = text(mode);
  $("overview-mode").className = statusClass(mode ? "ok" : "unknown");
  $("overview-gateway").textContent = gateway.enabled ? text(gateway.reachable) : "disabled";
  $("overview-gateway").className = statusClass(gateway.enabled ? gateway.reachable : "warn");
  $("overview-latest-signal").textContent = latestSignal
    ? `${text(latestSignal.symbol)} ${text(latestSignal.timestamp)}`
    : "n/a";
  $("overview-latest-fill").textContent = latestFill
    ? `${text(latestFill.symbol)} ${text(latestFill.timestamp)}`
    : "n/a";
  renderOverviewHealth();
  renderOverviewPositions();
  renderOverviewTimeline();
}

function renderOverviewHealth() {
  const checks = overviewHealthChecks();
  const badCount = checks.filter((item) => item.status === "bad").length;
  const warnCount = checks.filter((item) => item.status === "warn").length;
  $("overview-health-note").textContent = badCount
    ? `${badCount} blocker${badCount === 1 ? "" : "s"} / ${warnCount} warning${warnCount === 1 ? "" : "s"}`
    : warnCount
      ? `${warnCount} warning${warnCount === 1 ? "" : "s"}`
      : "All visible checks are ok";
  $("overview-health-grid").innerHTML = checks.map((item) => `
    <div class="health-card">
      <span>${statusText(item.status)}</span>
      <strong>${escapeHtml(item.label)}</strong>
      <small>${escapeHtml(item.detail)}</small>
    </div>
  `).join("");
  $("overview-checklist-note").textContent = "Concrete next checks";
  $("overview-checklist").innerHTML = checks.map((item) => `
    <div class="check-item ${statusClass(item.status)}">
      <span>${escapeHtml(item.status)}</span>
      <div>
        <strong>${escapeHtml(item.label)}</strong>
        <small>${escapeHtml(item.detail)}</small>
      </div>
    </div>
  `).join("");
}

function renderOverviewPositions() {
  const source = latestArtifactPerformance();
  const accountRow = latestAccountRow(source.account || []);
  const positions = nonzeroPositionsFromSource(source);
  $("overview-positions-note").textContent = source.account && source.account.length
    ? `Snapshot ${text(accountRow.timestamp)}`
    : "Using latest available summary";
  $("overview-positions-grid").innerHTML = positions.length
    ? positions.map((item) => `
        <div class="position-card">
          <span>Symbol</span>
          <strong>${escapeHtml(item.symbol)}</strong>
          <small>Quantity ${escapeHtml(numberText(item.quantity, 6))}${Number.isFinite(item.value) ? ` / Value ${escapeHtml(money(item.value))}` : ""}</small>
        </div>
      `).join("")
    : `<div class="empty-card"><strong>No open positions</strong><span>The latest selected or published run is flat, or no account snapshot has been loaded.</span></div>`;
}

function renderOverviewTimeline() {
  const events = runEventRows().slice(0, 10);
  $("overview-timeline-note").textContent = events.length
    ? `${events.length} recent event${events.length === 1 ? "" : "s"}`
    : "No recent telemetry events";
  $("overview-timeline-body").innerHTML = events.length
    ? events.map((event) => row([
        escapeHtml(event.timestamp),
        escapeHtml(event.run_id),
        escapeHtml(event.type),
        statusText(event.status),
        escapeHtml(event.symbol),
        escapeHtml(event.detail),
      ])).join("")
    : row([`<span class="muted">No signals, orders, or fills have been published yet.</span>`, "", "", "", "", ""]);
}

function renderMetrics() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const runs = payload.runs || [];
  const supervisors = payload.supervisors || [];
  const remote = payload.remote_control || {};
  const alerts = payload.alerts || [];
  const history = state.history || [];
  $("subtitle").textContent = `${text(payload.node_id)} - ${text(payload.generated_at)}`;
  $("metric-status").textContent = text(payload.status);
  $("metric-status").className = statusClass(payload.status);
  $("metric-gateway").textContent = gateway.enabled ? text(gateway.reachable) : "disabled";
  $("metric-gateway").className = statusClass(gateway.reachable);
  $("metric-runs").textContent = String(runs.length);
  $("metric-supervisors").textContent = String(supervisors.length);
  $("metric-supervisors").className = supervisors.some((item) => item.status && item.status !== "ok") ? "status-warn" : "status-ok";
  const latestRemote = remote.latest_event || {};
  const latestRemoteResult = latestRemote.result || {};
  const latestRemotePost = latestRemoteResult.post_result || {};
  const remoteBad = latestRemote.event === "poll_failed" || latestRemoteResult.status === "failed" || latestRemoteResult.status === "rejected" || latestRemotePost.status === "failed";
  $("metric-remote").textContent = remote.enabled ? (remote.audit_exists ? "audit" : "empty") : "off";
  $("metric-remote").className = remoteBad ? "status-warn" : "status-ok";
  $("metric-alerts").textContent = String(alerts.length);
  $("metric-alerts").className = alerts.length ? "status-warn" : "status-ok";
  $("metric-history").textContent = String(history.length);
  $("metric-data").textContent = String((state.dataCatalog.datasets || []).length);
  $("command-node").value = payload.node_id || $("command-node").value || "example-local-trader";
  if (supervisors.length && !$("command-supervisor").value) {
    $("command-supervisor").value = supervisors[0].id || "";
  }
}

function renderPerformance() {
  const source = latestArtifactPerformance();
  const perf = source.performance || {};
  const summary = source.summary || {};
  const equity = perf.final_equity ?? summary.final_equity;
  $("performance-note").textContent = source.label;
  $("performance-equity").textContent = money(equity);
  $("performance-context").textContent = source.account.length
    ? "Showing selected archived run artifacts."
    : "Showing latest summarized run; select Artifacts for an equity curve.";
  $("performance-return").textContent = pctText(perf.total_return_pct ?? summary.total_return_pct);
  $("performance-drawdown").textContent = pctText(perf.max_drawdown_pct ?? summary.max_drawdown_pct);
  $("performance-return-day").textContent = pctText(perf.return_per_day_pct ?? summary.return_per_day_pct);
  $("performance-exposure").textContent = pctText(perf.max_gross_exposure_pct ?? summary.max_gross_exposure_pct);
  $("performance-equity-chart").innerHTML = equityChart(source.account || []);
  $("performance-drawdown-chart").innerHTML = drawdownChart(source.account || []);
  $("performance-daily-return-chart").innerHTML = dailyReturnChart(source.account || []);
  $("performance-drawdown-note").textContent = source.account.length
    ? "Computed from account equity snapshots"
    : "Load archived artifacts for drawdown curve";
  $("performance-daily-note").textContent = source.account.length
    ? "Computed from first/last equity by date"
    : "Load archived artifacts for daily bars";

  const runs = ((state.runComparison && state.runComparison.runs) || []).slice(0, 12);
  $("performance-runs-body").innerHTML = runs.length
    ? runs.map((runItem) => row([
        escapeHtml(runItem.finished_at),
        escapeHtml(runItem.draft_id),
        escapeHtml(runItem.action),
        statusText(runItem.status),
        pctText(runItem.total_return_pct),
        pctText(runItem.max_drawdown_pct),
        pctText(runItem.return_per_day_pct),
        escapeHtml(runItem.fills),
        escapeHtml(runItem.rejections),
      ])).join("")
    : row([`<span class="muted">No saved runs yet</span>`, "", "", "", "", "", "", "", ""]);
}

function rangeLabel(start, end) {
  if (!start && !end) return "n/a";
  return `${text(start)} -> ${text(end)}`;
}

function miniChart(points) {
  if (!points || points.length < 2) return `<span class="muted">n/a</span>`;
  const closes = points.map((point) => Number(point.close)).filter((value) => Number.isFinite(value));
  if (closes.length < 2) return `<span class="muted">n/a</span>`;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const width = 180;
  const height = 46;
  const span = max - min || 1;
  const coords = closes.map((value, index) => {
    const x = closes.length === 1 ? 0 : (index / (closes.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = closes[closes.length - 1];
  const first = closes[0];
  const cls = last >= first ? "spark-good" : "spark-bad";
  return `<svg class="sparkline ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="close preview"><polyline points="${coords}"></polyline></svg>`;
}

function detailChart(points) {
  if (!points || points.length < 2) return `<span class="muted">No price preview available</span>`;
  const closes = points.map((point) => Number(point.close)).filter((value) => Number.isFinite(value));
  if (closes.length < 2) return `<span class="muted">No price preview available</span>`;
  const min = Math.min(...closes);
  const max = Math.max(...closes);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const coords = closes.map((value, index) => {
    const x = closes.length === 1 ? 0 : (index / (closes.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const last = closes[closes.length - 1];
  const first = closes[0];
  const cls = last >= first ? "spark-good" : "spark-bad";
  return `<svg class="detail-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="sampled close prices"><polyline points="${coords}"></polyline></svg>`;
}

function equityChart(points) {
  if (!points || points.length < 2) return `<span class="muted">No equity curve available</span>`;
  const values = points.map((point) => Number(point.equity)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return `<span class="muted">No equity curve available</span>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cls = values[values.length - 1] >= values[0] ? "spark-good" : "spark-bad";
  return `<svg class="detail-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="equity curve"><polyline points="${coords}"></polyline></svg>`;
}

function numericAccountRows(points) {
  return (points || []).map((point) => ({
    timestamp: point.timestamp,
    equity: Number(point.equity),
  })).filter((point) => point.timestamp && Number.isFinite(point.equity));
}

function drawdownChart(points) {
  const rows = numericAccountRows(points);
  if (rows.length < 2) return `<span class="muted">No drawdown curve available</span>`;
  let peak = rows[0].equity;
  const values = rows.map((point) => {
    peak = Math.max(peak, point.equity);
    const drawdown = peak > 0 ? ((point.equity / peak) - 1) * 100 : 0;
    return { timestamp: point.timestamp, value: drawdown };
  });
  return scalarLineChart(values, {
    label: "drawdown curve",
    empty: "No drawdown curve available",
    className: "spark-bad",
    valueFormatter: pctText,
  });
}

function dailyReturns(points) {
  const rows = numericAccountRows(points);
  const byDay = new Map();
  for (const point of rows) {
    const day = String(point.timestamp).slice(0, 10);
    if (!byDay.has(day)) byDay.set(day, []);
    byDay.get(day).push(point);
  }
  return Array.from(byDay.entries()).map(([day, items]) => {
    const ordered = items.slice().sort((a, b) => String(a.timestamp).localeCompare(String(b.timestamp)));
    const first = ordered[0].equity;
    const last = ordered[ordered.length - 1].equity;
    const value = first > 0 ? ((last / first) - 1) * 100 : 0;
    return { day, value };
  }).filter((item) => Number.isFinite(item.value));
}

function dailyReturnChart(points) {
  const rows = dailyReturns(points);
  if (!rows.length) return `<span class="muted">No daily return bars available</span>`;
  const width = 720;
  const height = 180;
  const padding = 12;
  const maxAbs = Math.max(0.01, ...rows.map((item) => Math.abs(item.value)));
  const barGap = 4;
  const barWidth = Math.max(3, (width - padding * 2 - barGap * Math.max(0, rows.length - 1)) / rows.length);
  const axisY = height / 2;
  const bars = rows.map((item, index) => {
    const magnitude = (Math.abs(item.value) / maxAbs) * (height / 2 - padding);
    const x = padding + index * (barWidth + barGap);
    const y = item.value >= 0 ? axisY - magnitude : axisY;
    const cls = item.value >= 0 ? "return-bar-good" : "return-bar-bad";
    return `<rect class="${cls}" x="${x.toFixed(1)}" y="${y.toFixed(1)}" width="${barWidth.toFixed(1)}" height="${Math.max(1, magnitude).toFixed(1)}"><title>${escapeHtml(item.day)} ${escapeHtml(pctText(item.value))}</title></rect>`;
  }).join("");
  const labels = rows.slice(-3).map((item) => `${item.day} ${pctText(item.value)}`).join(" | ");
  return `<svg class="detail-chart return-bars" viewBox="0 0 ${width} ${height}" role="img" aria-label="daily return bars"><line class="axis-line" x1="0" y1="${axisY}" x2="${width}" y2="${axisY}"></line>${bars}</svg><span class="chart-caption">${escapeHtml(labels)}</span>`;
}

function scalarLineChart(points, { label, empty, className, valueFormatter }) {
  if (!points || points.length < 2) return `<span class="muted">${escapeHtml(empty)}</span>`;
  const values = points.map((point) => Number(point.value)).filter((value) => Number.isFinite(value));
  if (values.length < 2) return `<span class="muted">${escapeHtml(empty)}</span>`;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const width = 720;
  const height = 180;
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const latest = values[values.length - 1];
  const caption = `${valueFormatter ? valueFormatter(latest) : numberText(latest)} latest`;
  return `<svg class="detail-chart ${className || ""}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(label)}"><polyline points="${coords}"></polyline></svg><span class="chart-caption">${escapeHtml(caption)}</span>`;
}

function dataCatalogFilters() {
  return {
    text: ($("data-filter-text").value || "").trim().toLowerCase(),
    quality: $("data-filter-quality").value || "",
    bar: $("data-filter-bar").value || "",
    asset: $("data-filter-asset").value || "",
    source: $("data-filter-source").value || "",
  };
}

function filteredDataCatalog(datasets) {
  const filters = dataCatalogFilters();
  return (datasets || []).filter((dataset) => {
    if (filters.quality && dataset.quality_status !== filters.quality) return false;
    if (filters.bar && text(dataset.bar_size) !== filters.bar) return false;
    if (filters.asset && text(dataset.asset_class) !== filters.asset) return false;
    if (filters.source && text(dataset.source) !== filters.source) return false;
    if (filters.text) {
      const haystack = [
        dataset.symbol,
        dataset.asset_class,
        dataset.source,
        dataset.bar_size,
        dataset.path,
        dataset.root,
        dataset.source_timezone,
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });
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
}

function countSummary(counts) {
  const entries = Object.entries(counts || {});
  return entries.length
    ? entries.map(([key, value]) => `${key}:${numberText(value, 0)}`).join(" ")
    : "none";
}

function renderDataCatalog() {
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  const filtered = filteredDataCatalog(datasets);
  renderDataFilterOptions(datasets);
  renderDataLibrarySummary();
  $("data-catalog-body").innerHTML = filtered.length
    ? filtered.map((dataset) => row([
        escapeHtml(dataset.symbol),
        escapeHtml(dataset.asset_class),
        escapeHtml(dataset.source),
        escapeHtml(dataset.bar_size),
        escapeHtml(dataset.format),
        escapeHtml(dataset.rows),
        escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp)),
        escapeHtml(interval(dataset.median_interval_seconds)),
        escapeHtml(dataset.estimated_missing_intervals),
        qualityBadge(dataset.quality_status, dataset.quality_warnings),
        escapeHtml(dataset.source_timezone),
        miniChart(dataset.preview || []),
        escapeHtml(bytes(dataset.size_bytes)),
        `<span class="mono">${escapeHtml(dataset.path)}</span>`,
        `<button type="button" class="secondary inspect-data" data-path="${escapeHtml(dataset.path)}">Inspect</button>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
  const errors = catalog.errors || [];
  const filterLabel = [
    `${numberText(filtered.length, 0)} shown / ${numberText(datasets.length, 0)} found`,
    `quality ${countSummary(catalog.quality_counts)}`,
    `bars ${countSummary(catalog.bar_size_counts)}`,
    `assets ${countSummary(catalog.asset_class_counts)}`,
    `sources ${countSummary(catalog.source_counts)}`,
    `rows ${numberText(catalog.row_count_total, 0)}`,
    `size ${bytes(catalog.size_bytes_total)}`,
  ].join(" | ");
  const errorText = errors.length
    ? errors.map((item) => `<span class="status-warn">${escapeHtml(item.path)}: ${escapeHtml(item.error)}</span>`).join("<br>")
    : "";
  $("data-catalog-errors").innerHTML = errorText
    ? `${escapeHtml(filterLabel)}<br>${errorText}`
    : escapeHtml(filterLabel);
}

function renderDataLibrarySummary() {
  const diagnostics = state.diagnostics || {};
  const catalog = state.dataCatalog || {};
  const roots = diagnostics.data_roots || [];
  const suggestedRoots = diagnostics.suggested_data_roots || [];
  const existingRoots = roots.filter((root) => root.exists && root.is_dir);
  const totalRootFiles = roots.reduce((sum, root) => sum + Number(root.data_file_count || 0), 0);
  const catalogCount = Number(catalog.count || 0);
  const catalogLimit = Number(catalog.limit || $("data-catalog-limit").value || 0);
  $("data-root-count").textContent = numberText(roots.length, 0);
  $("data-root-note").textContent = `${numberText(existingRoots.length, 0)} active / ${numberText(totalRootFiles, 0)} files visible to root scanner`;
  let visibilityStatus = "ok";
  let visibilityNote = `${numberText(catalogCount, 0)} catalog rows loaded from configured roots.`;
  if (!roots.length || !totalRootFiles) {
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
            <small class="mono">${escapeHtml(root.display_path || root.path)}</small>
            <small>writable=${escapeHtml(text(root.writable))}</small>
          </div>
        `;
      }).join("") + suggestedRoots.map((root) => `
        <div class="root-card suggested-root">
          <span class="status-warn">suggested</span>
          <strong>${escapeHtml(numberText(root.data_file_count, 0))} files</strong>
          <small class="mono">${escapeHtml(root.display_path || root.path)}</small>
          <small>Not currently scanned. Start the dashboard with this data root.</small>
        </div>
      `).join("")
    : `<div class="root-card"><span class="status-bad">bad</span><strong>No roots configured</strong><small>Add at least one data root.</small></div>`;
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
    ["Run Statuses", JSON.stringify(status.status_counts || {})],
    ["Run Actions", JSON.stringify(status.action_counts || {})],
    ["Latest Run", latestLabel],
    ["State Dir", status.state_dir],
  ];
  $("workbench-status-list").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
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

function renderDataDetail() {
  const detail = state.dataDetail || {};
  const coverage = detail.coverage || {};
  const quality = detail.quality || {};
  const price = detail.price_stats || {};
  const returns = detail.return_stats || {};
  const volume = detail.volume_stats || {};
  $("data-detail-title").textContent = detail.path
    ? `${text(detail.symbol)} ${text(detail.bar_size)} - ${text(detail.path)}`
    : "No dataset selected";
  const pairs = [
    ["Asset", text(detail.asset_class)],
    ["Source", text(detail.source)],
    ["Rows", numberText(detail.rows, 0)],
    ["Range", rangeLabel(coverage.first_timestamp, coverage.last_timestamp)],
    ["Median Step", interval(coverage.median_interval_seconds)],
    ["Largest Gap", interval(coverage.largest_gap_seconds)],
    ["Missing Est.", numberText(coverage.estimated_missing_intervals, 0)],
    ["Duplicates", numberText(coverage.duplicate_timestamps, 0)],
    ["Quality", `${text(quality.quality_status)}${(quality.quality_warnings || []).length ? ` (${(quality.quality_warnings || []).length})` : ""}`],
    ["Warnings", (quality.quality_warnings || []).join("; ") || "none"],
    ["TZ", text(detail.source_timezone)],
    ["Close Range", `${numberText(price.min_close)} -> ${numberText(price.max_close)}`],
    ["Total Return", pctText(price.total_return_pct)],
    ["Bar Std", pctText(returns.std_pct)],
    ["Mean Abs Bar", pctText(returns.mean_abs_pct)],
    ["Volume Median", numberText(volume.median, 0)],
  ];
  $("data-detail-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  $("data-detail-chart").innerHTML = detailChart(detail.preview || []);

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
        escapeHtml(gap.from_timestamp),
        escapeHtml(gap.to_timestamp),
        escapeHtml(interval(gap.gap_seconds)),
        escapeHtml(gap.estimated_missing_intervals),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", ""]);
}

function renderFetchJobs() {
  const payload = state.fetchManifests || {};
  const manifests = payload.manifests || [];
  const roots = payload.roots || [];
  const rowsTotal = manifests.reduce((sum, item) => sum + Number(item.rows || 0), 0);
  $("fetch-jobs-note").textContent = payload.generated_at
    ? `${numberText(manifests.length, 0)} shown / ${numberText(payload.total || manifests.length, 0)} total`
    : "No fetch manifests loaded";
  $("fetch-job-count").textContent = numberText(manifests.length, 0);
  $("fetch-job-status-summary").textContent = countSummary(payload.status_counts);
  $("fetch-job-rows").textContent = numberText(rowsTotal, 0);
  $("fetch-job-kind-summary").textContent = countSummary(payload.kind_counts);
  $("fetch-root-count").textContent = numberText(roots.length, 0);
  $("fetch-root-note").textContent = roots.length
    ? `${numberText(roots.reduce((sum, root) => sum + Number(root.manifest_count || 0), 0), 0)} manifest files under configured roots`
    : "No fetch manifest roots configured";
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
    escapeHtml(item.error),
    "",
    "",
  ]));
  const manifestRows = manifests.map((item) => {
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
    const output = item.latest_output_path || item.out_dir || item.first_output_path || "";
    return row([
      escapeHtml(item.started_at),
      escapeHtml(item.kind),
      statusText(item.status),
      escapeHtml(item.bar_size),
      escapeHtml(rangeLabel(item.range_start, item.range_end || item.duration || item.months)),
      escapeHtml(symbolSummary),
      escapeHtml(chunkSummary),
      escapeHtml(numberText(item.rows, 0)),
      `<span class="${Number(item.errors || 0) ? "status-warn" : "status-ok"}">${escapeHtml(numberText(item.errors, 0))}</span>`,
      `<span class="mono">${escapeHtml(output)}</span>`,
      `<button type="button" class="secondary inspect-fetch" data-job-id="${escapeHtml(item.job_id)}">Inspect</button>`,
    ]);
  });
  $("fetch-manifests-body").innerHTML = manifestRows.length || errorRows.length
    ? manifestRows.concat(errorRows).join("")
    : row([`<span class="muted">No fetch manifests yet. Run a fetch command to create one.</span>`, "", "", "", "", "", "", "", "", "", ""]);
}

function renderFetchManifestDetail() {
  const detail = state.fetchManifestDetail || {};
  $("fetch-detail-title").textContent = detail.job_id
    ? `${text(detail.job_id)} - ${text(detail.status)}`
    : "No fetch job selected";
  const counts = detail.counts || {};
  const plan = detail.plan || {};
  const parameters = detail.parameters || {};
  const pairs = [
    ["Job", text(detail.job_id)],
    ["Kind", text(detail.kind)],
    ["Status", text(detail.status)],
    ["Started", text(detail.started_at)],
    ["Finished", text(detail.finished_at)],
    ["Bar / Range", `${text(parameters.bar_size)} ${rangeLabel(plan.range_start || parameters.start, plan.range_end || parameters.end || parameters.duration)}`],
    ["Symbols", JSON.stringify(counts.status_counts || {})],
    ["Outputs", `${numberText(detail.output_total, 0)} total / rows ${numberText(counts.rows, 0)}`],
    ["Output Statuses", JSON.stringify(counts.output_status_counts || {})],
    ["Errors", `${numberText(detail.error_total, 0)} total ${JSON.stringify(counts.error_kind_counts || {})}`],
    ["Output Dir", text(parameters.out_dir)],
    ["Manifest", text(detail.path)],
  ];
  $("fetch-detail-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd><span class="mono">${escapeHtml(value)}</span></dd>`
  )).join("");

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
        escapeHtml(item.message),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", ""]);

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
        escapeHtml(rangeLabel(item.first_timestamp, item.last_timestamp)),
        `<span class="mono">${escapeHtml(item.path)}</span>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", ""]);
}

function replaceOptions(select, options) {
  const currentValues = select.multiple
    ? new Set(Array.from(select.selectedOptions).map((option) => option.value))
    : new Set([select.value]);
  select.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.value)}">${escapeHtml(option.label)}</option>`
  )).join("");
  let restored = false;
  for (const option of select.options) {
    if (currentValues.has(option.value)) {
      option.selected = true;
      restored = true;
    }
  }
  if (!select.multiple && !restored && options.length) {
    select.value = options[0].value;
  }
  if (select.multiple && !restored && select.options.length) {
    select.options[0].selected = true;
  }
}

function renderConfigBuilder() {
  const options = state.configOptions || {};
  const defaults = options.defaults || {};
  const plugins = (options.plugins || []).map((plugin) => ({
    value: plugin.id,
    label: `${plugin.label} (${plugin.status})`,
  }));
  const modes = (options.modes || []).map((mode) => ({ value: mode, label: mode }));
  const runActions = (options.run_actions || []).map((action) => ({ value: action, label: action }));
  const riskPresets = (options.risk_presets || []).map((preset) => ({
    value: preset.id,
    label: `${preset.label} - ${preset.description}`,
  }));
  const datasets = (state.dataCatalog.datasets || []).map((dataset) => ({
    value: dataset.path,
    label: `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}] - ${dataset.path}`,
  }));
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const draftOptions = drafts.map((draft) => ({
    value: draft.draft_id,
    label: `${draft.draft_id} - ${text(draft.mode)}`,
  }));
  if (plugins.length) replaceOptions($("config-plugin"), plugins);
  if (modes.length) replaceOptions($("config-mode"), modes);
  if (runActions.length) replaceOptions($("config-run-action"), runActions);
  if (riskPresets.length) replaceOptions($("config-risk-preset"), riskPresets);
  replaceOptions($("config-dataset"), datasets);
  replaceOptions($("config-run-draft"), draftOptions);

  const defaultFields = {
    "config-name": defaults.name,
    "config-starting-cash": defaults.starting_cash,
    "config-history-bars": defaults.history_bars,
    "config-max-steps": defaults.max_steps,
    "config-run-max-steps": defaults.max_steps,
    "config-risk-preset": defaults.risk_preset,
    "config-max-orders": defaults.max_orders_per_run,
    "config-max-notional": defaults.max_notional_per_order,
    "config-max-quantity": defaults.max_quantity,
    "config-max-cash": defaults.max_cash_quantity,
    "config-max-exposure": defaults.max_gross_exposure_pct,
    "config-slippage": defaults.sim_slippage_bps,
    "config-commission": defaults.sim_commission_bps,
    "config-run-timeout": defaults.run_timeout_seconds,
  };
  for (const [id, value] of Object.entries(defaultFields)) {
    if (!$(`${id}`).value && value !== undefined) $(`${id}`).value = String(value);
  }

  const draft = state.configDraft;
  if (!draft) {
    $("config-validation").innerHTML = `<span class="muted">No draft generated</span>`;
    $("config-yaml").value = "";
    $("config-commands").innerHTML = "";
    renderConfigAlignment(state.alignmentPreview || {});
    return;
  }
  const valid = draft.validation && draft.validation.valid;
  const errors = (draft.validation && draft.validation.errors) || [];
  $("config-validation").innerHTML = valid
    ? `<span class="status-ok">valid</span>${draft.saved_path ? ` <span class="muted">${escapeHtml(draft.saved_path)}</span>` : ""}`
    : `<span class="status-bad">invalid</span> <span class="muted">${escapeHtml(errors.join("; "))}</span>`;
  $("config-yaml").value = draft.yaml || "";
  $("config-commands").innerHTML = draft.commands
    ? Object.entries(draft.commands).map(([name, command]) => (
        `<dt>${escapeHtml(name)}</dt><dd><span class="mono">${escapeHtml(command)}</span></dd>`
      )).join("")
    : "";
  renderConfigAlignment(draft.alignment || {});
}

function renderConfigAlignment(alignment) {
  const warnings = alignment.warnings || [];
  $("config-alignment-note").innerHTML = alignment.dataset_count
    ? warnings.length
      ? `<span class="status-warn">${warnings.length} warning${warnings.length === 1 ? "" : "s"}</span>`
      : `<span class="status-ok">aligned</span>`
    : "No alignment data";
  const rows = alignment.rows || [];
  const symbolSummary = rows.map((item) => (
    `${text(item.symbol)} rows=${numberText(item.rows, 0)} ts=${numberText(item.timestamp_count, 0)} step=${interval(item.median_interval_seconds)}`
  )).join("; ");
  const pairs = [
    ["Datasets", numberText(alignment.dataset_count, 0)],
    ["Symbols", (alignment.symbols || []).join(", ")],
    ["Common Timestamps", numberText(alignment.common_timestamp_count, 0)],
    ["Union Timestamps", numberText(alignment.union_timestamp_count, 0)],
    ["Common Coverage", pctText(alignment.common_coverage_pct)],
    ["Common Range", rangeLabel(alignment.common_first_timestamp, alignment.common_last_timestamp)],
    ["Warnings", warnings.length ? warnings.join("; ") : "none"],
    ["Per Symbol", symbolSummary || "n/a"],
  ];
  $("config-alignment").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
}

function draftValidationById() {
  const rows = (state.draftValidations && state.draftValidations.validations) || [];
  return Object.fromEntries(rows.map((rowItem) => [rowItem.draft_id, rowItem]));
}

function draftValidationBadge(draftId) {
  const validation = draftValidationById()[draftId];
  if (!validation) return `<span class="muted">not checked</span>`;
  if (validation.valid) return statusText("ok");
  const errors = validation.errors || [];
  const suffix = errors.length ? ` (${errors.length})` : "";
  const title = errors.length ? ` title="${escapeHtml(errors.join("; "))}"` : "";
  return `<span class="status-bad"${title}>invalid${escapeHtml(suffix)}</span>`;
}

function renderDraftValidations() {
  const payload = state.draftValidations || {};
  const rows = payload.validations || [];
  const invalid = rows.filter((rowItem) => !rowItem.valid);
  const pairs = [
    ["Checked", text(payload.generated_at)],
    ["Drafts", numberText(payload.count, 0)],
    ["Valid", numberText(payload.valid_count, 0)],
    ["Invalid", numberText(payload.invalid_count, 0)],
  ];
  if (invalid.length) {
    pairs.push([
      "Errors",
      invalid.map((rowItem) => (
        `${rowItem.draft_id}: ${(rowItem.errors || []).join("; ")}`
      )).join("\n"),
    ]);
  }
  $("config-draft-validations").innerHTML = rows.length || payload.generated_at
    ? pairs.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd><span class="mono">${escapeHtml(value)}</span></dd>`).join("")
    : `<dt>Checked</dt><dd><span class="muted">Not checked</span></dd>`;
}

function applyRiskPreset() {
  const presetId = $("config-risk-preset").value;
  const preset = (state.configOptions.risk_presets || []).find((item) => item.id === presetId);
  const values = preset && preset.values ? preset.values : {};
  const fieldMap = {
    "config-max-orders": values.max_orders_per_run,
    "config-max-notional": values.max_notional_per_order,
    "config-max-quantity": values.max_quantity,
    "config-max-cash": values.max_cash_quantity,
    "config-max-exposure": values.max_gross_exposure_pct,
    "config-slippage": values.sim_slippage_bps,
    "config-commission": values.sim_commission_bps,
  };
  for (const [id, value] of Object.entries(fieldMap)) {
    if (value !== undefined) {
      $(`${id}`).value = String(value);
    }
  }
}

function renderWorkbenchRuns() {
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  renderDraftValidations();
  $("config-drafts-body").innerHTML = drafts.length
    ? drafts.map((draft) => row([
        escapeHtml(draft.draft_id),
        escapeHtml(draft.mode),
        escapeHtml((draft.symbols || []).join(", ")),
        escapeHtml(draft.modified_at),
        draftValidationBadge(draft.draft_id),
        `<span class="mono">${escapeHtml(draft.output_dir)}</span>`,
        `<span class="button-pair"><button type="button" class="secondary inspect-draft-detail" data-draft-id="${escapeHtml(draft.draft_id)}">YAML</button><button type="button" class="secondary download-draft-yaml" data-draft-id="${escapeHtml(draft.draft_id)}">Download</button><button type="button" class="secondary inspect-draft" data-draft-id="${escapeHtml(draft.draft_id)}">Artifacts</button><button type="button" class="secondary delete-draft" data-draft-id="${escapeHtml(draft.draft_id)}">Delete</button></span>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", ""]);

  const runs = (state.configRuns && state.configRuns.runs) || [];
  $("config-runs-body").innerHTML = runs.length
    ? runs.map((run) => {
        const summary = run.summary || {};
        const detail = run.stderr_tail
          ? run.stderr_tail.split("\n").slice(-2).join(" ")
          : JSON.stringify(summary || {});
        return row([
          escapeHtml(run.finished_at),
          escapeHtml(run.draft_id),
          escapeHtml(run.action),
          statusText(run.status),
          escapeHtml(run.duration_seconds),
          escapeHtml(summary.decisions),
          escapeHtml(summary.fills),
          escapeHtml(summary.rejections),
          `<span class="mono">${escapeHtml(detail)}</span>`,
          `<span class="button-pair">${
            run.artifact_path
              ? `<button type="button" class="secondary inspect-run-artifacts" data-run-id="${escapeHtml(run.run_id)}">Artifacts</button>`
              : `<button type="button" class="secondary inspect-draft" data-draft-id="${escapeHtml(run.draft_id)}">Latest</button>`
          }<button type="button" class="secondary inspect-run-log" data-run-id="${escapeHtml(run.run_id)}">Log</button></span>`,
        ]);
      }).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", ""]);
}

function comparisonCard(title, run, value) {
  if (!run) {
    return `<div class="compare-card"><span>${escapeHtml(title)}</span><strong>n/a</strong><small>No summarized run</small></div>`;
  }
  return `
    <div class="compare-card">
      <span>${escapeHtml(title)}</span>
      <strong>${escapeHtml(value)}</strong>
      <small>${escapeHtml(text(run.draft_id))} - ${escapeHtml(text(run.action))}</small>
    </div>
  `;
}

function renderComparisonFilterOptions(runs) {
  const makeOptions = (id, values) => {
    const select = $(id);
    const current = select.value;
    const options = Array.from(new Set(values.map(text).filter((value) => value !== "n/a"))).sort();
    select.innerHTML = [
      `<option value="">All</option>`,
      ...options.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`),
    ].join("");
    if (options.includes(current)) {
      select.value = current;
    }
  };
  makeOptions("comparison-filter-status", runs.map((run) => run.status));
  makeOptions("comparison-filter-action", runs.map((run) => run.action));
}

function filteredComparisonRuns(runs) {
  const status = $("comparison-filter-status").value || "";
  const action = $("comparison-filter-action").value || "";
  const summary = $("comparison-filter-summary").value || "";
  return (runs || []).filter((run) => {
    if (status && text(run.status) !== status) return false;
    if (action && text(run.action) !== action) return false;
    if (summary === "yes" && !run.summary_available) return false;
    if (summary === "no" && run.summary_available) return false;
    return true;
  });
}

function comparisonSortMetric(runItem, sortMode) {
  if (sortMode === "finished_desc") return Date.parse(runItem.finished_at || "");
  if (sortMode === "return_desc") return Number(runItem.total_return_pct);
  if (sortMode === "return_day_desc") return Number(runItem.return_per_day_pct);
  if (sortMode === "drawdown_asc") {
    const value = Number(runItem.max_drawdown_pct);
    return Number.isFinite(value) ? Math.abs(value) : Number.NaN;
  }
  if (sortMode === "exposure_desc") return Number(runItem.max_gross_exposure_pct);
  if (sortMode === "positions_desc") return Number(runItem.max_position_count);
  return Date.parse(runItem.finished_at || "");
}

function sortedComparisonRuns(runs) {
  const sortMode = $("comparison-sort").value || "finished_desc";
  const ascending = sortMode === "drawdown_asc";
  return (runs || []).map((runItem, index) => ({
    runItem,
    index,
    metric: comparisonSortMetric(runItem, sortMode),
  })).sort((a, b) => {
    const aFinite = Number.isFinite(a.metric);
    const bFinite = Number.isFinite(b.metric);
    if (!aFinite && !bFinite) return a.index - b.index;
    if (!aFinite) return 1;
    if (!bFinite) return -1;
    if (a.metric === b.metric) return a.index - b.index;
    return ascending ? a.metric - b.metric : b.metric - a.metric;
  }).map((item) => item.runItem);
}

function renderRunComparison() {
  const comparison = state.runComparison || {};
  const allRuns = comparison.runs || [];
  renderComparisonFilterOptions(allRuns);
  const runs = sortedComparisonRuns(filteredComparisonRuns(allRuns));
  const leaders = comparison.leaders || {};
  const summaryCount = Number(comparison.summary_count || 0);
  $("comparison-note").textContent = `${numberText(runs.length, 0)} shown / ${numberText(comparison.total || allRuns.length, 0)} recorded / ${summaryCount} summarized`;
  $("comparison-leaders").innerHTML = [
    comparisonCard("Best Return", leaders.best_total_return, pctText((leaders.best_total_return || {}).total_return_pct)),
    comparisonCard("Best Return/day", leaders.best_return_per_day, pctText((leaders.best_return_per_day || {}).return_per_day_pct)),
    comparisonCard("Lowest Drawdown", leaders.lowest_drawdown, pctText((leaders.lowest_drawdown || {}).max_drawdown_pct)),
    `<div class="compare-card"><span>Short Horizon</span><strong>${escapeHtml(numberText(comparison.short_horizon_count || 0, 0))}</strong><small>Projection-flagged runs</small></div>`,
  ].join("");
  $("comparison-body").innerHTML = runs.length
    ? runs.map((runItem) => {
        const projection = runItem.summary_available
          ? (runItem.short_horizon_projection ? "short" : "full")
          : "n/a";
        return row([
          escapeHtml(runItem.finished_at),
          escapeHtml(runItem.draft_id),
          escapeHtml(runItem.action),
          statusText(runItem.status),
          pctText(runItem.total_return_pct),
          pctText(runItem.max_drawdown_pct),
          pctText(runItem.return_per_day_pct),
          pctText(runItem.max_gross_exposure_pct),
          escapeHtml(runItem.max_position_count),
          numberText(runItem.elapsed_days, 4),
          escapeHtml(runItem.fills),
          escapeHtml(runItem.rejections),
          escapeHtml(projection),
          `<span class="button-pair">${
            runItem.artifact_available
              ? `<button type="button" class="secondary inspect-run-artifacts" data-run-id="${escapeHtml(runItem.run_id)}">Artifacts</button>`
              : ""
          }<button type="button" class="secondary inspect-run-log" data-run-id="${escapeHtml(runItem.run_id)}">Log</button></span>`,
        ]);
      }).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", "", "", "", "", ""]);
}

function renderRunDetail() {
  const detail = state.runDetail || {};
  $("run-log-title").textContent = detail.run_id
    ? `${text(detail.draft_id)} / ${text(detail.run_id)}`
    : "No run selected";
  const pairs = [
    ["Run ID", text(detail.run_id)],
    ["Draft", text(detail.draft_id)],
    ["Action", text(detail.action)],
    ["Status", text(detail.status)],
    ["Return Code", text(detail.returncode)],
    ["Started", text(detail.started_at)],
    ["Finished", text(detail.finished_at)],
    ["Seconds", numberText(detail.duration_seconds, 3)],
    ["Summary", text(detail.summary_available)],
    ["Artifacts", text(detail.artifact_available)],
    ["Command", (detail.command || []).join(" ")],
  ];
  $("run-log-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  $("run-log-stdout").value = detail.stdout_tail || "";
  $("run-log-stderr").value = detail.stderr_tail || "";
}

function renderWorkbenchArtifacts() {
  const artifacts = state.configArtifacts || {};
  const summary = artifacts.summary || {};
  const performance = artifacts.performance || {};
  $("artifact-title").textContent = artifacts.run_id
    ? `${artifacts.draft_id} / ${artifacts.run_id} - ${text(artifacts.output_dir)}`
    : artifacts.draft_id
      ? `${artifacts.draft_id} - ${text(artifacts.output_dir)}`
    : "No run selected";
  const pairs = [
    ["Mode", text(summary.mode)],
    ["Decisions", text(summary.decisions)],
    ["Orders", text(summary.orders)],
    ["Fills", text(summary.fills)],
    ["Rejections", text(summary.rejections)],
    ["Snapshots", text(performance.account_snapshot_count)],
    ["Initial Equity", money(performance.initial_equity)],
    ["Final Cash", money(summary.final_cash)],
    ["Final Equity", money(performance.final_equity ?? summary.final_equity)],
    ["Return", pctText(performance.total_return_pct)],
    ["Max Drawdown", pctText(performance.max_drawdown_pct)],
    ["Elapsed Days", numberText(performance.elapsed_days, 4)],
    ["Return / Day", pctText(performance.return_per_day_pct)],
    ["Return / Month", pctText(performance.return_per_month_pct)],
    ["Return / Year", pctText(performance.return_per_year_pct)],
    ["Projection", performance.short_horizon_projection ? "short horizon" : "full horizon"],
    ["Max Gross Exposure", `${money(performance.max_gross_exposure)} (${pctText(performance.max_gross_exposure_pct)})`],
    ["Max Abs Net Exposure", `${money(performance.max_abs_net_exposure)} (${pctText(performance.max_abs_net_exposure_pct)})`],
    ["Max Positions", numberText(performance.max_position_count, 0)],
    ["Positions", JSON.stringify(summary.final_positions || {})],
  ];
  $("artifact-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  $("artifact-equity-chart").innerHTML = equityChart(artifacts.account || []);

  const decisions = artifacts.decisions || [];
  $("artifact-decisions-body").innerHTML = decisions.length
    ? decisions.map((decision) => row([
        escapeHtml(decision.timestamp),
        escapeHtml(decision.step),
        escapeHtml(decision.mode),
        escapeHtml(decision.intent_count),
        statusText(decision.paused ? "paused" : "ok"),
        escapeHtml((decision.symbols || []).join(", ")),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);

  const orders = artifacts.orders || [];
  $("artifact-orders-body").innerHTML = orders.length
    ? orders.map((orderItem) => row([
        escapeHtml(orderItem.timestamp),
        statusText(orderItem.status),
        escapeHtml(orderItem.symbol),
        escapeHtml(orderItem.side),
        escapeHtml(orderItem.order_type),
        escapeHtml(orderItem.quantity),
        escapeHtml(orderItem.cash_quantity),
        escapeHtml(orderItem.reason),
        escapeHtml(orderItem.tag),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", ""]);

  const fills = artifacts.fills || [];
  $("artifact-fills-body").innerHTML = fills.length
    ? fills.map((fill) => row([
        escapeHtml(fill.timestamp),
        escapeHtml(fill.symbol),
        escapeHtml(fill.side),
        escapeHtml(fill.quantity),
        escapeHtml(fill.price),
        escapeHtml(fill.commission),
        escapeHtml(fill.simulated),
        escapeHtml(fill.tag),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", ""]);
}

function renderRuns() {
  const runs = (state.status && state.status.runs) || [];
  $("runs-body").innerHTML = runs.length
    ? runs.map((run) => {
        const metrics = run.metrics || {};
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
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", ""]);
}

function runEventRows() {
  const runs = (state.status && state.status.runs) || [];
  const events = [];
  for (const run of runs) {
    const recent = run.recent_events || {};
    for (const event of recent.decisions || []) {
      events.push({
        run_id: run.id,
        type: "decision",
        timestamp: event.timestamp,
        status: event.paused ? "paused" : "ok",
        symbol: (event.symbols || []).join(", "),
        detail: `intents=${text(event.intents)} step=${text(event.step)}`,
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
      });
    }
  }
  return events
    .filter((event) => event.timestamp)
    .sort((a, b) => String(b.timestamp).localeCompare(String(a.timestamp)))
    .slice(0, 30);
}

function renderRunEvents() {
  const events = runEventRows();
  $("run-events-body").innerHTML = events.length
    ? events.map((event) => row([
        escapeHtml(event.timestamp),
        escapeHtml(event.run_id),
        escapeHtml(event.type),
        statusText(event.status),
        escapeHtml(event.symbol),
        escapeHtml(event.detail),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);
}

function renderSupervisors() {
  const supervisors = (state.status && state.status.supervisors) || [];
  $("supervisors-body").innerHTML = supervisors.length
    ? supervisors.map((supervisor) => row([
        escapeHtml(supervisor.id),
        statusText(supervisor.status),
        escapeHtml((supervisor.jobs || []).length),
        escapeHtml(supervisor.generated_at),
        `<span class="${statusClass((supervisor.freshness || {}).stale ? "warn" : "ok")}">${escapeHtml(age((supervisor.freshness || {}).age_seconds))}</span>`,
        `<span class="mono">${escapeHtml(JSON.stringify(supervisor.job_status_counts || {}, null, 2))}</span>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);
}

function renderRemoteControl() {
  const remote = (state.status && state.status.remote_control) || {};
  const latest = remote.latest_event || {};
  const latestResult = latest.result || {};
  const latestLabel = latest.event
    ? `${text(latest.event)} ${text(latestResult.action)} ${text(latestResult.status)}`
    : "none";
  $("remote-control-body").innerHTML = row([
    remote.enabled ? statusText(remote.audit_exists ? "ok" : "waiting") : statusText("disabled"),
    escapeHtml(latestLabel),
    `<span class="${statusClass((remote.freshness || {}).stale ? "warn" : "ok")}">${escapeHtml(age((remote.freshness || {}).age_seconds))}</span>`,
    `<span class="mono">${escapeHtml(JSON.stringify(remote.result_status_counts || {}, null, 2))}</span>`,
    `<span class="mono">${escapeHtml(JSON.stringify(remote.post_status_counts || {}, null, 2))}</span>`,
    escapeHtml(remote.audit_log),
  ]);
}

function renderAlerts() {
  const alerts = (state.status && state.status.alerts) || [];
  $("alerts-body").innerHTML = alerts.length
    ? alerts.map((alert) => row([
        statusText(alert.level === "warn" ? "warn" : alert.level),
        escapeHtml(alert.kind),
        escapeHtml(alert.message),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", ""]);
}

function renderGateway() {
  const gateway = (state.status && state.status.gateway) || {};
  const pairs = [
    ["Enabled", text(gateway.enabled)],
    ["Host", text(gateway.host)],
    ["Port", text(gateway.port)],
    ["Reachable", text(gateway.reachable)],
    ["Latency", gateway.latency_ms === null || gateway.latency_ms === undefined ? "n/a" : `${gateway.latency_ms} ms`],
    ["Error", text(gateway.error)],
  ];
  $("gateway-list").innerHTML = pairs.map(([key, value]) => `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`).join("");
}

function renderHistory() {
  $("history-body").innerHTML = state.history.length
    ? state.history.map((snapshot) => {
        const remoteLabel = snapshot.remote_latest_event
          ? `${text(snapshot.remote_latest_event)} ${text(snapshot.remote_latest_action)} ${text(snapshot.remote_latest_status)}`
          : "none";
        return row([
          escapeHtml(snapshot.received_at),
          escapeHtml(snapshot.node_id),
          statusText(snapshot.status),
          statusText(snapshot.gateway_reachable),
          escapeHtml(snapshot.alert_count),
          `<span class="mono">${escapeHtml(JSON.stringify(snapshot.run_status_counts || {}, null, 2))}</span>`,
          `<span class="mono">${escapeHtml(JSON.stringify(snapshot.supervisor_status_counts || {}, null, 2))}</span>`,
          escapeHtml(remoteLabel),
        ]);
      }).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", ""]);
}

function renderCommands() {
  $("commands-body").innerHTML = state.commands.length
    ? state.commands.map((command) => row([
        escapeHtml(command.command_id),
        escapeHtml(command.node_id),
        escapeHtml(command.action),
        `<span class="mono">${escapeHtml(JSON.stringify(command.params || {}, null, 2))}</span>`,
        statusText(command.status),
        escapeHtml(command.created_at),
        command.status === "pending"
          ? `<button type="button" class="secondary cancel-command" data-command-id="${escapeHtml(command.command_id)}" data-node-id="${escapeHtml(command.node_id)}">Cancel</button>`
          : "",
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", ""]);
}

function renderResults() {
  $("results-body").innerHTML = state.results.length
    ? state.results.slice(-20).reverse().map((result) => row([
        escapeHtml(result.command_id),
        escapeHtml(result.action),
        statusText(result.status),
        escapeHtml(result.received_at),
        `<span class="mono">${escapeHtml(JSON.stringify(result.result || result.error || {}, null, 2))}</span>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", ""]);
}

function renderAll() {
  renderOverview();
  renderMetrics();
  renderPerformance();
  renderWorkbenchStatus();
  renderCleanupPlan();
  renderDiagnostics();
  renderEndpointMap();
  renderDataCatalog();
  renderDataDetail();
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
  renderHistory();
  renderCommands();
  renderResults();
  $("last-refresh").textContent = `Last refresh: ${new Date().toLocaleString()}`;
}

async function refresh() {
  const node = $("command-node").value || (state.status && state.status.node_id) || "";
  const status = await fetchJson("/status");
  state.status = status;
  const nodeId = encodeURIComponent(node || status.node_id || "");
  const history = await fetchJson(`/status_history${nodeId ? `?node_id=${nodeId}&limit=20` : "?limit=20"}`);
  const catalogLimit = encodeURIComponent($("data-catalog-limit").value || "200");
  const dataCatalog = await fetchJson(`/data_catalog?limit=${catalogLimit}&preview_points=80`);
  const fetchManifests = await fetchJson("/fetch_manifests?limit=50");
  const workbenchStatus = await fetchJson("/workbench_status");
  const cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  const diagnostics = await fetchJson("/workbench_diagnostics");
  const endpointMap = await fetchJson("/workbench_endpoints");
  const configOptions = await fetchJson("/config_options");
  const configDrafts = await fetchJson("/config_drafts");
  const draftValidations = await fetchJson("/config_draft_validations");
  const configRuns = await fetchJson("/config_draft_runs?limit=20");
  const runComparison = await fetchJson("/config_draft_run_comparison?limit=50");
  const commands = await fetchJson(`/commands${nodeId ? `?node_id=${nodeId}` : ""}`);
  const results = await fetchJson(`/command_results${nodeId ? `?node_id=${nodeId}` : ""}`);
  state.history = history.history || [];
  state.dataCatalog = dataCatalog || { datasets: [], errors: [] };
  state.fetchManifests = fetchManifests || { manifests: [], roots: [], errors: [] };
  state.workbenchStatus = workbenchStatus || {};
  state.cleanupPlan = cleanupPlan || {};
  state.diagnostics = diagnostics || {};
  state.endpointMap = endpointMap || { endpoints: [] };
  state.configOptions = configOptions || { plugins: [], modes: [], defaults: {} };
  state.configDrafts = configDrafts || { drafts: [], errors: [] };
  state.draftValidations = draftValidations || { validations: [] };
  state.configRuns = configRuns || { runs: [] };
  state.runComparison = runComparison || { runs: [], leaders: {} };
  state.commands = commands.commands || [];
  state.results = results.results || [];
  renderAll();
}

async function generateConfigDraft(event) {
  event.preventDefault();
  const selected = selectedConfigDatasets();
  if (!selected.length) {
    $("config-validation").innerHTML = `<span class="status-bad">Select at least one saved dataset first</span>`;
    return;
  }
  const payload = {
    name: $("config-name").value,
    plugin_id: $("config-plugin").value,
    mode: $("config-mode").value,
    datasets: selected.map((dataset) => ({ symbol: dataset.symbol, path: dataset.path })),
    starting_cash: $("config-starting-cash").value,
    history_bars: $("config-history-bars").value,
    risk_preset: $("config-risk-preset").value,
    max_steps: $("config-max-steps").value,
    max_orders_per_run: $("config-max-orders").value,
    max_notional_per_order: $("config-max-notional").value,
    max_quantity: $("config-max-quantity").value,
    max_cash_quantity: $("config-max-cash").value,
    max_gross_exposure_pct: $("config-max-exposure").value,
    sim_slippage_bps: $("config-slippage").value,
    sim_commission_bps: $("config-commission").value,
    save: $("config-save").checked,
  };
  const response = await fetchJson("/config_draft", {
    method: "POST",
    body: JSON.stringify(payload),
  });
  state.configDraft = response.draft;
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
  $("last-refresh").textContent = `Config draft generated: ${new Date().toLocaleString()}`;
}

async function previewConfigAlignment() {
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
    }),
  });
  state.alignmentPreview = response.alignment || {};
  renderConfigAlignment(state.alignmentPreview);
  $("last-refresh").textContent = `Alignment preview loaded: ${new Date().toLocaleString()}`;
}

async function loadDataDetail(path) {
  const response = await fetchJson(`/data_detail?path=${encodeURIComponent(path)}&preview_points=360&gap_limit=30`);
  state.dataDetail = response;
  renderDataDetail();
  $("last-refresh").textContent = `Data detail loaded: ${new Date().toLocaleString()}`;
}

async function loadFetchManifestDetail(jobId) {
  const response = await fetchJson(`/fetch_manifest_detail?job_id=${encodeURIComponent(jobId)}&limit=500`);
  state.fetchManifestDetail = response;
  renderFetchManifestDetail();
  $("last-refresh").textContent = `Fetch manifest loaded: ${new Date().toLocaleString()}`;
}

async function loadConfigArtifacts(draftId) {
  const response = await fetchJson(`/config_draft_artifacts?draft_id=${encodeURIComponent(draftId)}&limit=100`);
  state.configArtifacts = response;
  renderWorkbenchArtifacts();
  renderPerformance();
  renderOverview();
  $("last-refresh").textContent = `Artifacts loaded: ${new Date().toLocaleString()}`;
}

async function loadConfigDraftDetail(draftId) {
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

async function downloadDraftYaml(draftId) {
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

async function deleteConfigDraft(draftId) {
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
  }
  renderConfigBuilder();
  renderWorkbenchRuns();
  renderWorkbenchStatus();
  renderCleanupPlan();
  renderWorkbenchArtifacts();
  $("last-refresh").textContent = `Draft deleted: ${new Date().toLocaleString()}`;
}

async function validateDrafts() {
  state.draftValidations = await fetchJson("/config_draft_validations");
  renderDraftValidations();
  renderWorkbenchRuns();
  $("last-refresh").textContent = `Draft validations refreshed: ${new Date().toLocaleString()}`;
}

async function loadRunArtifacts(runId) {
  const response = await fetchJson(`/config_draft_run_artifacts?run_id=${encodeURIComponent(runId)}&limit=100`);
  state.configArtifacts = response;
  renderWorkbenchArtifacts();
  renderPerformance();
  renderOverview();
  $("last-refresh").textContent = `Run artifacts loaded: ${new Date().toLocaleString()}`;
}

async function loadRunDetail(runId) {
  const response = await fetchJson(`/config_draft_run_detail?run_id=${encodeURIComponent(runId)}`);
  state.runDetail = response;
  renderRunDetail();
  $("last-refresh").textContent = `Run log loaded: ${new Date().toLocaleString()}`;
}

async function runConfigDraft(event) {
  event.preventDefault();
  const draftId = $("config-run-draft").value;
  if (!draftId) {
    $("config-run-status").innerHTML = `<span class="status-bad">Save a draft before running</span>`;
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
  state.workbenchStatus = await fetchJson("/workbench_status");
  state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  if (($("config-run-action").value || "") !== "validate") {
    await loadConfigArtifacts(draftId);
  }
  renderWorkbenchRuns();
  renderRunComparison();
  renderWorkbenchStatus();
  renderCleanupPlan();
  $("last-refresh").textContent = `Config draft run finished: ${new Date().toLocaleString()}`;
}

async function refreshCleanupPlan() {
  state.cleanupPlan = await fetchJson("/workbench_cleanup_plan");
  state.workbenchStatus = await fetchJson("/workbench_status");
  renderWorkbenchStatus();
  renderCleanupPlan();
  $("last-refresh").textContent = `Cleanup plan refreshed: ${new Date().toLocaleString()}`;
}

async function runWorkbenchCleanup(dryRun) {
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

async function downloadRunsCsv() {
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

async function downloadRunArtifactsJson() {
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

async function downloadDataCatalogCsv() {
  const body = await fetchText("/data_catalog_export?limit=500");
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

async function downloadWorkbenchSnapshot() {
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

async function queueCommand(event) {
  event.preventDefault();
  const action = $("command-action").value;
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

async function cancelCommand(commandId, nodeId) {
  await fetchJson("/commands/cancel", {
    method: "POST",
    body: JSON.stringify({
      command_id: commandId,
      node_id: nodeId,
    }),
  });
  await refresh();
}

function updateCommandFields() {
  const action = $("command-action").value;
  const visible = new Set(commandFields[action] || []);
  for (const field of ["run", "config", "supervisor"]) {
    const label = $(`command-${field}-field`);
    const input = $(`command-${field}`);
    const shown = visible.has(field);
    label.classList.toggle("hidden", !shown);
    input.required = shown;
    input.disabled = !shown;
  }
}

function initToken() {
  $("auth-token").value = token();
  $("save-token").addEventListener("click", () => {
    sessionStorage.setItem("statusToken", $("auth-token").value);
    refresh().catch((err) => {
      $("last-refresh").textContent = `Refresh failed: ${err.message}`;
    });
  });
}

function init() {
  initToken();
  updateCommandFields();
  $("command-action").addEventListener("change", updateCommandFields);
  $("refresh").addEventListener("click", () => {
    refresh().catch((err) => {
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
  $("data-filter-text").addEventListener("input", renderDataCatalog);
  $("data-filter-quality").addEventListener("change", renderDataCatalog);
  $("data-filter-bar").addEventListener("change", renderDataCatalog);
  $("data-filter-asset").addEventListener("change", renderDataCatalog);
  $("data-filter-source").addEventListener("change", renderDataCatalog);
  $("data-catalog-limit").addEventListener("change", () => {
    refresh().catch((err) => {
      $("last-refresh").textContent = `Catalog refresh failed: ${err.message}`;
    });
  });
  for (const button of document.querySelectorAll("[data-view-target]")) {
    button.addEventListener("click", () => setActiveView(button.dataset.viewTarget));
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
  $("export-run-artifacts-json").addEventListener("click", () => {
    downloadRunArtifactsJson().catch((err) => {
      $("last-refresh").textContent = `Run artifact JSON export failed: ${err.message}`;
    });
  });
  $("export-data-catalog-csv").addEventListener("click", () => {
    downloadDataCatalogCsv().catch((err) => {
      $("last-refresh").textContent = `Data catalog CSV export failed: ${err.message}`;
    });
  });
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
  $("comparison-filter-summary").addEventListener("change", renderRunComparison);
  $("comparison-sort").addEventListener("change", renderRunComparison);
  $("command-form").addEventListener("submit", (event) => {
    queueCommand(event).catch((err) => {
      $("last-refresh").textContent = `Command failed: ${err.message}`;
    });
  });
  $("config-form").addEventListener("submit", (event) => {
    generateConfigDraft(event).catch((err) => {
      $("config-validation").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-run-form").addEventListener("submit", (event) => {
    runConfigDraft(event).catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  });
  $("config-risk-preset").addEventListener("change", applyRiskPreset);
  for (const id of ["config-drafts-body", "config-runs-body", "comparison-body"]) {
    $(id).addEventListener("click", (event) => {
      const target = event.target;
      if (!(target instanceof HTMLElement)) return;
      if (target.classList.contains("inspect-draft")) {
        loadConfigArtifacts(target.dataset.draftId || "").catch((err) => {
          $("last-refresh").textContent = `Artifact load failed: ${err.message}`;
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
      if (target.classList.contains("inspect-run-log")) {
        loadRunDetail(target.dataset.runId || "").catch((err) => {
          $("last-refresh").textContent = `Run log load failed: ${err.message}`;
        });
      }
    });
  }
  $("data-catalog-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("inspect-data")) return;
    loadDataDetail(target.dataset.path || "").catch((err) => {
      $("last-refresh").textContent = `Data detail failed: ${err.message}`;
    });
  });
  $("fetch-manifests-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("inspect-fetch")) return;
    loadFetchManifestDetail(target.dataset.jobId || "").catch((err) => {
      $("last-refresh").textContent = `Fetch manifest detail failed: ${err.message}`;
    });
  });
  $("commands-body").addEventListener("click", (event) => {
    const target = event.target;
    if (!(target instanceof HTMLElement) || !target.classList.contains("cancel-command")) return;
    cancelCommand(target.dataset.commandId || "", target.dataset.nodeId || "").catch((err) => {
      $("last-refresh").textContent = `Cancel failed: ${err.message}`;
    });
  });
  setActiveView(sessionStorage.getItem("dashboardView") || "overview");
  refresh().catch((err) => {
    $("last-refresh").textContent = `Refresh failed: ${err.message}`;
  });
}

document.addEventListener("DOMContentLoaded", init);
