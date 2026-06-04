const state = {
  status: null,
  history: [],
  dataCatalog: { datasets: [], errors: [] },
  dataDetail: null,
  workbenchStatus: {},
  configOptions: { plugins: [], modes: [], defaults: {} },
  configDraft: null,
  configDrafts: { drafts: [], errors: [] },
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
  if (value === "failed" || value === "rejected" || value === "timeout" || value === "unknown" || value === false) return "status-bad";
  return "";
}

function row(cells) {
  return `<tr>${cells.map((cell) => `<td>${cell}</td>`).join("")}</tr>`;
}

function statusText(value) {
  const label = text(value);
  return `<span class="${statusClass(value)}">${escapeHtml(label)}</span>`;
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

function renderDataCatalog() {
  const catalog = state.dataCatalog || {};
  const datasets = catalog.datasets || [];
  $("data-catalog-body").innerHTML = datasets.length
    ? datasets.map((dataset) => row([
        escapeHtml(dataset.symbol),
        escapeHtml(dataset.bar_size),
        escapeHtml(dataset.format),
        escapeHtml(dataset.rows),
        escapeHtml(rangeLabel(dataset.first_timestamp, dataset.last_timestamp)),
        escapeHtml(interval(dataset.median_interval_seconds)),
        escapeHtml(dataset.estimated_missing_intervals),
        escapeHtml(dataset.source_timezone),
        miniChart(dataset.preview || []),
        escapeHtml(bytes(dataset.size_bytes)),
        `<span class="mono">${escapeHtml(dataset.path)}</span>`,
        `<button type="button" class="secondary inspect-data" data-path="${escapeHtml(dataset.path)}">Inspect</button>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", "", "", ""]);
  const errors = catalog.errors || [];
  $("data-catalog-errors").innerHTML = errors.length
    ? errors.map((item) => `<span class="status-warn">${escapeHtml(item.path)}: ${escapeHtml(item.error)}</span>`).join("<br>")
    : "";
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
    ["Rows", numberText(detail.rows, 0)],
    ["Range", rangeLabel(coverage.first_timestamp, coverage.last_timestamp)],
    ["Median Step", interval(coverage.median_interval_seconds)],
    ["Largest Gap", interval(coverage.largest_gap_seconds)],
    ["Missing Est.", numberText(coverage.estimated_missing_intervals, 0)],
    ["Duplicates", numberText(coverage.duplicate_timestamps, 0)],
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
  const datasets = (state.dataCatalog.datasets || []).map((dataset) => ({
    value: dataset.path,
    label: `${text(dataset.symbol)} ${text(dataset.bar_size)} - ${dataset.path}`,
  }));
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const draftOptions = drafts.map((draft) => ({
    value: draft.draft_id,
    label: `${draft.draft_id} - ${text(draft.mode)}`,
  }));
  if (plugins.length) replaceOptions($("config-plugin"), plugins);
  if (modes.length) replaceOptions($("config-mode"), modes);
  if (runActions.length) replaceOptions($("config-run-action"), runActions);
  replaceOptions($("config-dataset"), datasets);
  replaceOptions($("config-run-draft"), draftOptions);

  const defaultFields = {
    "config-name": defaults.name,
    "config-starting-cash": defaults.starting_cash,
    "config-history-bars": defaults.history_bars,
    "config-max-steps": defaults.max_steps,
    "config-run-max-steps": defaults.max_steps,
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
    $("config-alignment-note").textContent = "No draft generated";
    $("config-alignment").innerHTML = "";
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

function renderWorkbenchRuns() {
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  $("config-drafts-body").innerHTML = drafts.length
    ? drafts.map((draft) => row([
        escapeHtml(draft.draft_id),
        escapeHtml(draft.mode),
        escapeHtml((draft.symbols || []).join(", ")),
        escapeHtml(draft.modified_at),
        `<span class="mono">${escapeHtml(draft.output_dir)}</span>`,
        `<span class="button-pair"><button type="button" class="secondary inspect-draft-detail" data-draft-id="${escapeHtml(draft.draft_id)}">YAML</button><button type="button" class="secondary inspect-draft" data-draft-id="${escapeHtml(draft.draft_id)}">Artifacts</button></span>`,
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);

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

function renderRunComparison() {
  const comparison = state.runComparison || {};
  const runs = comparison.runs || [];
  const leaders = comparison.leaders || {};
  const summaryCount = Number(comparison.summary_count || 0);
  $("comparison-note").textContent = `${summaryCount} summarized / ${numberText(comparison.total || runs.length, 0)} recorded`;
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
  renderMetrics();
  renderWorkbenchStatus();
  renderDataCatalog();
  renderDataDetail();
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
  const dataCatalog = await fetchJson("/data_catalog?limit=50&preview_points=80");
  const workbenchStatus = await fetchJson("/workbench_status");
  const configOptions = await fetchJson("/config_options");
  const configDrafts = await fetchJson("/config_drafts");
  const configRuns = await fetchJson("/config_draft_runs?limit=20");
  const runComparison = await fetchJson("/config_draft_run_comparison?limit=50");
  const commands = await fetchJson(`/commands${nodeId ? `?node_id=${nodeId}` : ""}`);
  const results = await fetchJson(`/command_results${nodeId ? `?node_id=${nodeId}` : ""}`);
  state.history = history.history || [];
  state.dataCatalog = dataCatalog || { datasets: [], errors: [] };
  state.workbenchStatus = workbenchStatus || {};
  state.configOptions = configOptions || { plugins: [], modes: [], defaults: {} };
  state.configDrafts = configDrafts || { drafts: [], errors: [] };
  state.configRuns = configRuns || { runs: [] };
  state.runComparison = runComparison || { runs: [], leaders: {} };
  state.commands = commands.commands || [];
  state.results = results.results || [];
  renderAll();
}

async function generateConfigDraft(event) {
  event.preventDefault();
  const selectedPaths = Array.from($("config-dataset").selectedOptions).map((option) => option.value);
  const selected = (state.dataCatalog.datasets || []).filter((item) => selectedPaths.includes(item.path));
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
  if (response.draft && response.draft.saved_path) {
    state.configDrafts = await fetchJson("/config_drafts");
    state.workbenchStatus = await fetchJson("/workbench_status");
  }
  renderConfigBuilder();
  renderWorkbenchRuns();
  renderRunComparison();
  $("last-refresh").textContent = `Config draft generated: ${new Date().toLocaleString()}`;
}

async function loadDataDetail(path) {
  const response = await fetchJson(`/data_detail?path=${encodeURIComponent(path)}&preview_points=360&gap_limit=30`);
  state.dataDetail = response;
  renderDataDetail();
  $("last-refresh").textContent = `Data detail loaded: ${new Date().toLocaleString()}`;
}

async function loadConfigArtifacts(draftId) {
  const response = await fetchJson(`/config_draft_artifacts?draft_id=${encodeURIComponent(draftId)}&limit=100`);
  state.configArtifacts = response;
  renderWorkbenchArtifacts();
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
  renderConfigBuilder();
  $("last-refresh").textContent = `Draft detail loaded: ${new Date().toLocaleString()}`;
}

async function loadRunArtifacts(runId) {
  const response = await fetchJson(`/config_draft_run_artifacts?run_id=${encodeURIComponent(runId)}&limit=100`);
  state.configArtifacts = response;
  renderWorkbenchArtifacts();
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
  if (($("config-run-action").value || "") !== "validate") {
    await loadConfigArtifacts(draftId);
  }
  renderWorkbenchRuns();
  renderRunComparison();
  $("last-refresh").textContent = `Config draft run finished: ${new Date().toLocaleString()}`;
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
}

document.addEventListener("DOMContentLoaded", init);
