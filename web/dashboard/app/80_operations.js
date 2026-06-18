import {
  $,
  age,
  applyOperationsLens,
  bytes,
  commandBoundaries,
  escapeHtml,
  jsonDrilldown,
  money,
  navigateToOperationsLens,
  navigateToPerformanceLens,
  navigateToRunsLens,
  numberText,
  objectSummary,
  row,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { latestSupervisor, latestTelemetryRun } from "./20_workbench_foundation.js";
import {
  eventStatusIsBad,
  finiteNumber,
  firstPresent,
  metricTimestamp,
  normalizedRunMetrics,
  paperMonitorItems,
  remoteNodeMarketDataModel,
  runtimeActivityModel,
  runtimeMarketDataModel,
  timestampAgeLabel,
  timestampMillis,
} from "./30_runtime_core.js";
import { alertCardsHtml, workflowHref } from "./32_overview.js";
import { countBy, countSummary, topCountEntries } from "./40_data_catalog.js";
import { currentOpenOrderRows, runEventRows } from "./70_runs.js";
import { copyText, downloadRemoteNodeDetailCsv, downloadRemoteNodesCsv, loadRemoteNodeDetail, updateCommandFields } from "./90_bootstrap.js";

export function supervisorJobRows(supervisor) {
  return Array.isArray(supervisor && supervisor.jobs) ? supervisor.jobs.filter((job) => job && typeof job === "object") : [];
}

export function supervisorJobSummary(supervisor) {
  const jobs = supervisorJobRows(supervisor);
  if (!jobs.length) return { status: "warn", text: "0", detail: "No jobs published" };
  const missed = jobs.filter((job) => job.missed_window === true || String(job.status || "").toLowerCase() === "missed");
  const running = jobs.filter((job) => String(job.status || "").toLowerCase() === "running");
  const due = jobs.filter((job) => String(job.status || "").toLowerCase() === "due");
  const waiting = jobs.filter((job) => String(job.status || "").toLowerCase() === "waiting");
  const next = jobs
    .filter((job) => job.next_start_at)
    .slice()
    .sort((a, b) => String(a.next_start_at || "").localeCompare(String(b.next_start_at || "")))[0];
  const status = missed.length ? "bad" : due.length || running.length ? "ok" : "warn";
  const textValue = missed.length
    ? `${numberText(missed.length, 0)} missed`
    : running.length ? `${numberText(running.length, 0)} running`
      : due.length ? `${numberText(due.length, 0)} due`
        : `${numberText(waiting.length, 0)} waiting`;
  const detail = missed.length
    ? `${text(missed[0].label || missed[0].id)} missed ${text(missed[0].reason || "start window")}.`
    : next ? `Next: ${text(next.label || next.id)} at ${text(next.next_start_at)}.`
      : "No next start time published.";
  return { status, text: textValue, detail };
}

export function supervisorActionStatus(value) {
  const status = String(value || "").toLowerCase();
  if (!status) return "unknown";
  if (["ok", "running", "waiting", "not_due", "due", "completed", "completed_or_exited", "success", "idle"].includes(status)) return "ok";
  if (["paused", "pending", "stopped", "exited", "disabled", "missing", "not_running"].includes(status)) return "warn";
  if (["failed", "error", "bad", "rejected", "timeout", "dead", "crashed", "exception", "missed", "missed_start_window"].includes(status)) return "bad";
  return status.includes("fail") || status.includes("error") || status.includes("crash") ? "bad" : "warn";
}

export function firstSupervisorId(supervisors) {
  const match = (supervisors || []).find((supervisor) => text(supervisor.id) !== "n/a");
  return match ? text(match.id) : "";
}

export function supervisorActionSummaryModel() {
  const supervisors = (state.status && state.status.supervisors) || [];
  const jobs = supervisors.flatMap(supervisorJobRows);
  const staleSupervisors = supervisors.filter((supervisor) => Boolean((supervisor.freshness || {}).stale));
  const badSupervisors = supervisors.filter((supervisor) => supervisorActionStatus(supervisor.status) === "bad");
  const warnSupervisors = supervisors.filter((supervisor) => supervisorActionStatus(supervisor.status) === "warn");
  const badJobs = jobs.filter((job) => supervisorActionStatus(job.status || job.reason) === "bad");
  const pausedJobs = jobs.filter((job) => supervisorActionStatus(job.status || job.reason) === "warn" && String(job.status || job.reason || "").toLowerCase().includes("paused"));
  const restartMarkers = jobs.filter((job) => text(job.restart_marker) !== "n/a");
  const pauseMarkers = jobs.filter((job) => text(job.pause_marker) !== "n/a");
  const selectedSupervisor = firstSupervisorId(supervisors);
  let headline = "No Supervisor State";
  let note = "No local supervisor status payload is loaded; configure one before relying on managed public plugin jobs.";
  let severity = "warn";
  if (supervisors.length) {
    if (badSupervisors.length || badJobs.length) {
      headline = "Supervisor Issue";
      note = `${numberText(badSupervisors.length, 0)} supervisor status blocker${badSupervisors.length === 1 ? "" : "s"} and ${numberText(badJobs.length, 0)} job issue${badJobs.length === 1 ? "" : "s"} need review.`;
      severity = "bad";
    } else if (staleSupervisors.length) {
      headline = "Supervisor Stale";
      note = `${numberText(staleSupervisors.length, 0)} supervisor heartbeat${staleSupervisors.length === 1 ? "" : "s"} stale; confirm the local process before trusting runner state.`;
      severity = "warn";
    } else if (pausedJobs.length || warnSupervisors.length) {
      headline = "Supervisor Paused Or Waiting";
      note = `${numberText(pausedJobs.length, 0)} paused job${pausedJobs.length === 1 ? "" : "s"} and ${numberText(warnSupervisors.length, 0)} supervisor warning${warnSupervisors.length === 1 ? "" : "s"} visible.`;
      severity = "warn";
    } else {
      headline = "Supervisors Healthy";
      note = `${numberText(supervisors.length, 0)} supervisor${supervisors.length === 1 ? "" : "s"} and ${numberText(jobs.length, 0)} job${jobs.length === 1 ? "" : "s"} have no visible blockers.`;
      severity = "ok";
    }
  }
  const cards = [
    {
      status: supervisors.length ? severity : "warn",
      label: "Supervisor State",
      title: supervisors.length ? headline : "Not Loaded",
      note,
    },
    {
      status: staleSupervisors.length ? "warn" : supervisors.length ? "ok" : "warn",
      label: "Freshness",
      title: staleSupervisors.length ? `${numberText(staleSupervisors.length, 0)} stale` : supervisors.length ? "Fresh" : "No State",
      note: supervisors.length
        ? `Newest visible supervisor: ${text((supervisors[0] || {}).id)} / ${timestampAgeLabel((supervisors[0] || {}).generated_at)}.`
        : "Publish supervisor status to see heartbeat age.",
    },
    {
      status: badJobs.length ? "bad" : pausedJobs.length ? "warn" : jobs.length ? "ok" : "warn",
      label: "Jobs",
      title: jobs.length ? `${numberText(jobs.length, 0)} visible` : "None",
      note: badJobs.length
        ? `${numberText(badJobs.length, 0)} job${badJobs.length === 1 ? "" : "s"} failed or errored.`
        : pausedJobs.length ? `${numberText(pausedJobs.length, 0)} job${pausedJobs.length === 1 ? "" : "s"} paused by marker.` : "Job status counts are available below.",
    },
    {
      status: restartMarkers.length || pauseMarkers.length ? "warn" : "ok",
      label: "Control Markers",
      title: `${numberText(pauseMarkers.length, 0)} pause / ${numberText(restartMarkers.length, 0)} restart`,
      note: restartMarkers.length || pauseMarkers.length
        ? "Configured markers make pause/resume or managed restarts available through local controls."
        : "No pause or restart markers are visible in current job rows.",
    },
  ];
  const actions = [
    {
      action: "prepare-status",
      title: "Prepare Status Check",
      note: selectedSupervisor ? `Fill supervisor_status for ${selectedSupervisor}.` : "Load a supervisor ID before checking status.",
      label: "Status",
      disabled: !selectedSupervisor,
    },
    {
      action: "inspect",
      title: "Inspect Supervisor Rows",
      note: "Jump to the raw supervisor table for IDs, ages, and job status counts.",
      label: "Inspect",
      disabled: !supervisors.length,
    },
    {
      action: "run-once",
      title: "Prepare Run Once",
      note: selectedSupervisor ? "Fill run_supervisor_once without queueing it." : "Needs a configured supervisor ID.",
      label: "Run Once",
      disabled: !selectedSupervisor,
    },
    {
      action: "runbook",
      title: "Open Restart Runbook",
      note: "Review local service and supervisor restart recipes before broad restarts.",
      label: "Runbook",
      disabled: false,
    },
  ];
  return { headline, note, cards, actions, selectedSupervisor };
}

export function renderSupervisorActionSummary() {
  if (!$("supervisor-action-note") || !$("supervisor-action-cards") || !$("supervisor-action-actions")) return;
  const model = supervisorActionSummaryModel();
  $("supervisor-action-note").textContent = model.note;
  $("supervisor-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("supervisor-action-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="${action.disabled ? "secondary" : ""}" data-supervisor-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.note)}</small>
      </span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

export function handleSupervisorAction(action) {
  const supervisors = (state.status && state.status.supervisors) || [];
  const supervisorId = firstSupervisorId(supervisors);
  if (action === "prepare-status") {
    if (supervisorId) $("command-supervisor").value = supervisorId;
    $("command-action").value = "supervisor_status";
    updateCommandFields();
    $("command-form").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = supervisorId
      ? `Read-only supervisor_status prepared for ${supervisorId}; review before queueing`
      : "Load a supervisor before preparing supervisor_status";
    return;
  }
  if (action === "run-once") {
    if (supervisorId) $("command-supervisor").value = supervisorId;
    $("command-action").value = "run_supervisor_once";
    updateCommandFields();
    $("command-form").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = supervisorId
      ? `run_supervisor_once prepared for ${supervisorId}; review local boundary before queueing`
      : "Load a supervisor before preparing run_supervisor_once";
    return;
  }
  if (action === "runbook") {
    window.location.href = "/docs/service_restart_runbook.md";
    return;
  }
  $("supervisors-body").scrollIntoView({ block: "start", behavior: "smooth" });
}

export function renderSupervisors() {
  const supervisors = (state.status && state.status.supervisors) || [];
  renderSupervisorActionSummary();
  $("supervisors-body").innerHTML = supervisors.length
    ? supervisors.map((supervisor) => {
      const jobSummary = supervisorJobSummary(supervisor);
      return row([
        escapeHtml(supervisor.id),
        statusText(supervisor.status),
        `<span class="${statusClass(jobSummary.status)}">${escapeHtml(jobSummary.text)}</span><br><span class="muted">${escapeHtml(jobSummary.detail)}</span>`,
        escapeHtml(supervisor.generated_at),
        `<span class="${statusClass((supervisor.freshness || {}).stale ? "warn" : "ok")}">${escapeHtml(age((supervisor.freshness || {}).age_seconds))}</span>`,
        jsonDrilldown(supervisor.job_status_counts || {}, countSummary(supervisor.job_status_counts || {})),
      ]);
    }).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", ""]);
}

export function renderRemoteControl() {
  const remote = (state.status && state.status.remote_control) || {};
  const latest = remote.latest_event || {};
  const latestResult = latest.result || {};
  const integrity = remote.integrity || {};
  const integrityStatus = text(integrity.status || (remote.audit_exists ? "unknown" : "missing"));
  const latestLabel = latest.event
    ? `${text(latest.event)} ${text(latestResult.action)} ${text(latestResult.status)}`
    : "none";
  const signatureDetail = integrity.signature_status
    ? ` / local signature ${text(integrity.signature_status)}`
    : "";
  const integrityDetail = `${numberText(integrity.checked_records, 0)} checked / ${numberText(integrity.legacy_records, 0)} legacy${signatureDetail}`;
  $("remote-control-body").innerHTML = row([
    remote.enabled ? statusText(remote.audit_exists ? "ok" : "waiting") : statusText("disabled"),
    escapeHtml(latestLabel),
    `<span class="${statusClass((remote.freshness || {}).stale ? "warn" : "ok")}">${escapeHtml(age((remote.freshness || {}).age_seconds))}</span>`,
    `<span class="${statusClass(integrityStatus === "ok" ? "ok" : integrityStatus === "broken" ? "bad" : "warn")}">${escapeHtml(integrityStatus)}</span><br><span class="muted">${escapeHtml(integrityDetail)}</span>`,
    jsonDrilldown(remote.result_status_counts || {}, countSummary(remote.result_status_counts || {})),
    jsonDrilldown(remote.post_status_counts || {}, countSummary(remote.post_status_counts || {})),
    escapeHtml(remote.audit_log),
  ]);
}

export function renderAlerts() {
  const alerts = (state.status && state.status.alerts) || [];
  $("alerts-body").innerHTML = alertCardsHtml(alerts, "No current alerts are published.");
}

export function renderGateway() {
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

export function cloudDeploymentReadinessModel() {
  const status = state.status || {};
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const staleRemote = staleRemoteNodes(remoteNodes);
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const remoteGatewayDown = remoteNodes.filter((node) => node.gateway_reachable === false).length;
  const localRemote = status.remote_control || {};
  const commandAudit = state.commandAudit || {};
  const integrity = commandAudit.integrity || {};
  const localIntegrity = localRemote.integrity || {};
  const localIntegrityStatus = text(localIntegrity.status || "").toLowerCase();
  const localSignatureStatus = text(localIntegrity.signature_status || "").toLowerCase();
  const receiverIntegrityStatus = text(integrity.status || "").toLowerCase();
  const receiverSignatureStatus = text(integrity.signature_status || "").toLowerCase();
  const localAuditBad = ["broken", "error"].includes(localIntegrityStatus)
    || ["bad", "missing_key", "invalid", "failed"].includes(localSignatureStatus);
  const receiverAuditBad = ["broken", "invalid", "error"].includes(receiverIntegrityStatus)
    || ["bad", "missing_key", "invalid", "failed"].includes(receiverSignatureStatus);
  const auditEvents = commandAudit.events || [];
  const auditWarn = !localAuditBad && !receiverAuditBad && (
    !auditEvents.length
    || ["legacy", "unchecked", "missing", "unknown", "empty"].includes(localIntegrityStatus)
    || ["legacy", "unchecked", "missing", "unknown", "empty"].includes(receiverIntegrityStatus)
    || ["legacy", "unsigned", "disabled", "mixed", "empty"].includes(localSignatureStatus)
    || ["legacy", "unsigned", "disabled", "mixed", "empty"].includes(receiverSignatureStatus)
  );
  const alerts = status.alerts || [];
  const remoteStatus = !remoteNodes.length ? "warn" : staleRemote.length || remoteGatewayDown ? "bad" : remoteAlerts ? "warn" : "ok";
  const auditStatus = localAuditBad || receiverAuditBad ? "bad" : auditWarn ? "warn" : "ok";
  const cards = [
    {
      status: remoteStatus,
      label: "Remote Monitor",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} nodes` : "No Nodes",
      note: remoteNodes.length
        ? `${numberText(staleRemote.length, 0)} stale / ${numberText(remoteGatewayDown, 0)} Gateway down / ${numberText(remoteAlerts, 0)} alerts.`
        : "No hosted/local status snapshots are visible yet.",
    },
    {
      status: auditStatus,
      label: "Command Audit",
      title: auditStatus === "bad" ? "Broken" : auditStatus === "warn" ? "Review" : "OK",
      note: `receiver ${text(integrity.status || "n/a")} / local ${text(localIntegrity.status || "n/a")} / signatures ${text(integrity.signature_status || "n/a")}/${text(localIntegrity.signature_status || "n/a")}.`,
    },
    {
      status: "warn",
      label: "Network Boundary",
      title: "Manual Review",
      note: "Confirm VPN/proxy/firewall allowlists and do not expose unauthenticated receiver ports.",
    },
    {
      status: "warn",
      label: "Provider Hardening",
      title: "Manual Review",
      note: "Run the cloud-example audit and inspect provider firewall, proxy, TLS, and retention settings.",
    },
  ];
  const lines = [
    {
      status: "ok",
      title: "Local Authority",
      detail: "Broker credentials, Gateway login, strategy configs, raw logs, and order authority stay on the trading machine; the hosted receiver should get sanitized status only.",
    },
    {
      status: remoteStatus,
      title: "Remote Monitoring",
      detail: remoteNodes.length
        ? `${numberText(remoteNodes.length, 0)} monitored node${remoteNodes.length === 1 ? "" : "s"}; ${numberText(staleRemote.length, 0)} stale heartbeat${staleRemote.length === 1 ? "" : "s"}; ${numberText(remoteAlerts, 0)} remote alert${remoteAlerts === 1 ? "" : "s"}.`
        : "Publish sanitized status snapshots before relying on cloud checking.",
    },
    {
      status: auditStatus,
      title: "Command Audit",
      detail: `${numberText(auditEvents.length, 0)} receiver audit event${auditEvents.length === 1 ? "" : "s"}; receiver integrity ${text(integrity.status || "n/a")}; local integrity ${text(localIntegrity.status || "n/a")}; local signature ${text(localIntegrity.signature_status || "n/a")}.`,
    },
    {
      status: "warn",
      title: "Authentication",
      detail: "Use token-authenticated status publishing and command polling. Rotate tokens outside the public repo and avoid logging secrets in status payloads.",
    },
    {
      status: "warn",
      title: "Network Boundary",
      detail: "Put the receiver behind private networking, VPN, reverse proxy allowlists, cloud firewalls, or host firewall rules. Treat internet exposure as unapproved until manually hardened.",
    },
    {
      status: "warn",
      title: "Retention",
      detail: "Keep hosted history bounded and sanitized. Sync command-audit evidence off-host only with a dry-run-first helper and provider retention controls.",
    },
    {
      status: alerts.length ? "warn" : "ok",
      title: "Current Alerts",
      detail: alerts.length ? `${numberText(alerts.length, 0)} local alert${alerts.length === 1 ? "" : "s"} visible; latest ${text(alerts[0].kind || alerts[0].category || alerts[0].message)}.` : "No local alerts are visible in the current status payload.",
    },
  ];
  const blockers = cards.filter((card) => card.status === "bad").length;
  const warnings = cards.filter((card) => card.status === "warn").length + lines.filter((line) => line.status === "warn").length;
  const headline = blockers
    ? "Cloud deployment has blockers"
    : "Cloud deployment needs manual review";
  return {
    status: blockers ? "bad" : "warn",
    headline,
    note: `${numberText(blockers, 0)} blocker${blockers === 1 ? "" : "s"} / ${numberText(warnings, 0)} review item${warnings === 1 ? "" : "s"} before hosted exposure`,
    cards,
    lines,
  };
}

export function cloudDeploymentReadinessText(model) {
  return [
    `Cloud Deployment Readiness: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

export function renderCloudDeploymentReadiness() {
  if (!$("cloud-readiness-note") || !$("cloud-readiness-cards") || !$("cloud-readiness-body") || !$("cloud-readiness-actions")) return;
  const model = cloudDeploymentReadinessModel();
  state.cloudDeploymentReadinessText = cloudDeploymentReadinessText(model);
  $("cloud-readiness-note").textContent = model.note;
  $("cloud-readiness-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("cloud-readiness-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("cloud-readiness-actions").innerHTML = [
    `<button type="button" data-cloud-readiness-action="copy">Copy Readiness</button>`,
    `<a class="secondary" href="/docs/cloud_monitoring_deployment.md" target="_blank" rel="noreferrer">Cloud Runbook</a>`,
    `<a class="secondary" href="/docs/service_restart_runbook.md" target="_blank" rel="noreferrer">Restart Runbook</a>`,
    `<a class="secondary" href="#operations/remote">Remote Nodes</a>`,
    `<a class="secondary" href="#operations/control">Command Audit</a>`,
  ].join("");
}

export function handleCloudReadinessAction(action) {
  if (action !== "copy") return;
  copyText(state.cloudDeploymentReadinessText || "No cloud deployment readiness loaded").then(() => {
    $("last-refresh").textContent = "Cloud deployment readiness copied";
  }).catch((err) => {
    $("last-refresh").textContent = `Cloud readiness copy failed: ${err.message}`;
  });
}

export function renderPaperMonitor() {
  if (!$("paper-monitor-guide") || !$("paper-monitor-note")) return;
  const items = paperMonitorItems();
  const okCount = items.filter((item) => item.status === "ok").length;
  const badCount = items.filter((item) => item.status === "bad").length;
  const warnCount = items.filter((item) => item.status === "warn").length;
  $("paper-monitor-note").textContent = badCount
    ? `${badCount} blocker${badCount === 1 ? "" : "s"} before trusting paper monitoring`
    : warnCount
      ? `${warnCount} paper-monitor warning${warnCount === 1 ? "" : "s"}`
      : `${okCount} paper-monitor checks ready`;
  renderPaperActionSummary(items);
  renderPaperMonitorHealth(items);
  renderPaperObservationPacket();
  $("paper-monitor-guide").innerHTML = items.map((item) => (
    `<div class="check-item status-${escapeHtml(item.status)}"><span>${escapeHtml(item.status)}</span><div><strong>${escapeHtml(item.label)}</strong><small>${escapeHtml(item.detail)}</small></div></div>`
  )).join("");
}

export function paperActionSummaryModel(items = paperMonitorItems()) {
  const observation = paperObservationPacketModel();
  const blockers = items.filter((item) => item.status === "bad");
  const warnings = items.filter((item) => item.status === "warn");
  const ready = items.filter((item) => item.status === "ok");
  const firstIssue = blockers[0] || warnings[0] || null;
  const gatewayItem = items.find((item) => item.label === "Gateway/API") || {};
  const accountItem = items.find((item) => item.label === "Account Freshness") || {};
  const modeItem = items.find((item) => item.label === "Config And Mode") || {};
  const observingItem = items.find((item) => item.label === "Observing Market") || {};
  const orderItem = items.find((item) => item.label === "Order Context") || {};
  const latestRun = latestTelemetryRun();
  const events = runEventRows();
  const fills = events.filter((event) => event.type === "fill");
  const badEvents = events.filter(eventStatusIsBad);
  const openOrders = currentOpenOrderRows();
  let title = "Paper Monitor Ready";
  let note = "Gateway, mode, observation, account, and order-context checks have no visible blockers.";
  let status = "ok";
  let primaryAction = "runs";
  if (blockers.length) {
    status = "bad";
    title = `${numberText(blockers.length, 0)} Paper Blocker${blockers.length === 1 ? "" : "s"}`;
    note = `${text(firstIssue.label)}: ${text(firstIssue.detail)}`;
    primaryAction = text(firstIssue.label).toLowerCase().includes("gateway")
      ? "gateway"
      : text(firstIssue.label).toLowerCase().includes("observing")
        ? "guide"
        : text(firstIssue.label).toLowerCase().includes("config")
          ? "runs"
          : "guide";
  } else if (warnings.length) {
    status = "warn";
    title = `${numberText(warnings.length, 0)} Paper Warning${warnings.length === 1 ? "" : "s"}`;
    note = `${text(firstIssue.label)}: ${text(firstIssue.detail)}`;
    primaryAction = text(firstIssue.label).toLowerCase().includes("account")
      ? "performance"
      : text(firstIssue.label).toLowerCase().includes("order")
        ? "runs"
        : "guide";
  } else if (fills.length || badEvents.length || openOrders.length) {
    status = badEvents.length ? "bad" : openOrders.length ? "warn" : "ok";
    title = badEvents.length ? "Review Execution" : openOrders.length ? "Review Open Orders" : "Review Fills";
    note = badEvents.length
      ? `${numberText(badEvents.length, 0)} rejected, canceled, failed, or error event${badEvents.length === 1 ? "" : "s"} visible.`
      : openOrders.length
        ? `${numberText(openOrders.length, 0)} non-terminal order event${openOrders.length === 1 ? "" : "s"} visible.`
        : `${numberText(fills.length, 0)} fill event${fills.length === 1 ? "" : "s"} visible; inspect performance/trades.`;
    primaryAction = badEvents.length || openOrders.length ? "runs" : "performance";
  } else if (!latestRun) {
    status = "bad";
    title = "No Paper Telemetry";
    note = "No current runner is publishing telemetry; start or publish a paper/shadow runner.";
    primaryAction = "guide";
  }
  const cards = [
    {
      label: "Readiness",
      status,
      title,
      note: `${numberText(ready.length, 0)} / ${numberText(items.length, 0)} checks ready.`,
    },
    {
      label: "Gateway/API",
      status: gatewayItem.status || "warn",
      title: gatewayItem.status === "ok" ? "Reachable" : gatewayItem.status === "bad" ? "Down" : "Review",
      note: gatewayItem.detail || "No Gateway/API check loaded.",
    },
    {
      label: "Observer",
      status: observation.status,
      title: observation.title,
      note: observation.note,
    },
    {
      label: "Mode / Account",
      status: modeItem.status === "ok" && accountItem.status === "ok" ? "ok" : modeItem.status === "bad" ? "bad" : "warn",
      title: modeItem.status === "ok" ? "Paper/Shadow" : "Review",
      note: `${modeItem.detail || "Mode unavailable"} ${accountItem.detail || ""}`.trim(),
    },
    {
      label: "Order Context",
      status: badEvents.length ? "bad" : openOrders.length ? "warn" : orderItem.status || "warn",
      title: badEvents.length ? `${numberText(badEvents.length, 0)} issues` : openOrders.length ? `${numberText(openOrders.length, 0)} open` : orderItem.status === "ok" ? "Visible" : "Missing",
      note: badEvents.length
        ? `${text(badEvents[0].symbol)} ${text(badEvents[0].status)} ${text(badEvents[0].detail)}`
        : openOrders.length ? `${text(openOrders[0].symbol)} ${text(openOrders[0].status)} ${timestampAgeLabel(openOrders[0].timestamp)}.` : orderItem.detail || "No order context loaded.",
    },
    {
      label: "Next Move",
      status,
      title,
      note,
    },
  ];
  const actions = [
    { action: primaryAction, label: "Primary", title: primaryAction === "gateway" ? "Gateway Diagnostics" : primaryAction === "performance" ? "Open Performance" : primaryAction === "runs" ? "Open Runs" : "Review Checks", disabled: false },
    { action: "guide", label: "Checks", title: "Review Checklist", disabled: false },
    { action: "gateway", label: "Gateway", title: "Gateway Diagnostics", disabled: false },
    { action: "runs", label: "Runs", title: "Runs / Orders", disabled: false },
    { action: "performance", label: "Performance", title: "Performance", disabled: false },
    { action: "runbook", label: "Runbook", title: "Gateway Runbook", disabled: false },
  ];
  return { status, title, note, cards, actions, observingItem };
}

export function renderPaperActionSummary(items = paperMonitorItems()) {
  if (!$("paper-action-note") || !$("paper-action-cards") || !$("paper-action-actions")) return;
  const model = paperActionSummaryModel(items);
  $("paper-action-note").textContent = `${model.title}: ${model.note}`;
  $("paper-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("paper-action-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="${action.disabled ? "secondary" : ""}" data-paper-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>${escapeHtml(action.title)}</span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

export function handlePaperAction(action) {
  if (action === "gateway") {
    navigateToOperationsLens("diagnostics");
    window.setTimeout(() => {
      const target = $("gateway-list");
      if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    }, 50);
    return;
  }
  if (action === "runs") return navigateToRunsLens("events");
  if (action === "performance") return navigateToPerformanceLens("home");
  if (action === "runbook") {
    window.location.href = "/docs/ibkr_gateway_runbook.md";
    return;
  }
  const target = action === "observation" ? $("paper-observation-detail") : $("paper-monitor-guide");
  if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
}

export function paperObservationPacketModel() {
  const payload = state.status || {};
  const gateway = payload.gateway || {};
  const latestRun = latestTelemetryRun();
  const supervisor = latestSupervisor();
  const metrics = normalizedRunMetrics(latestRun);
  const freshness = (latestRun && latestRun.freshness) || {};
  const supervisorFreshness = (supervisor && supervisor.freshness) || {};
  const events = runEventRows();
  const latestDecision = events.find((event) => event.type === "decision");
  const latestOrder = events.find((event) => event.type === "order");
  const latestFill = events.find((event) => event.type === "fill");
  const latestReject = events.find((event) => event.type === "order" && eventStatusIsBad(event));
  const openOrders = currentOpenOrderRows();
  const activity = runtimeActivityModel();
  const accountTimestamp = metricTimestamp(metrics, [
    "account_end_time",
    "latest_account_time",
    "latest_account_timestamp",
    "account_snapshot_time",
  ]);
  const marketData = runtimeMarketDataModel(metrics, latestRun);
  const marketTimestamp = marketData.timestamp;
  const decisionTimestamp = firstPresent(metrics.last_decision_time, latestDecision && latestDecision.timestamp);
  const nextDecision = firstPresent(
    metrics.next_decision_time,
    metrics.next_expected_decision_time,
    metrics.next_check_time,
    metrics.next_signal_time,
  );
  const nextOrderContext = firstPresent(
    metrics.next_order_condition,
    metrics.next_order_reason,
    metrics.latest_signal_reason,
    metrics.signal_reason,
    latestDecision && latestDecision.detail,
  );
  const heartbeatTimestamp = firstPresent(
    freshness.timestamp,
    metricTimestamp(metrics, ["last_decision_time", "account_end_time"]),
    supervisor && supervisor.generated_at,
    payload.generated_at,
  );
  const mode = String(metrics.mode || "").replace("-", "_").toLowerCase();
  const stale = Boolean((freshness && freshness.stale) || (supervisorFreshness && supervisorFreshness.stale));
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const activeObserver = Boolean(latestRun && !stale && marketData.status !== "bad" && (marketTimestamp || decisionTimestamp));
  let status = "bad";
  let title = "Not Observing";
  let note = "No current runner market-data or decision timestamp is visible.";
  if (latestRun) {
    status = activeObserver
      ? latestReject || openOrders.length ? "warn" : "ok"
      : stale ? "warn" : "bad";
    title = activeObserver ? "Observing" : stale ? "Telemetry Stale" : "Waiting For Bars";
    note = activeObserver
      ? "Runner telemetry includes fresh market or decision observations."
      : stale
        ? "Runner or supervisor heartbeat is stale; confirm the process before trusting paper state."
        : "Runner exists, but market-data or decision timestamps are missing.";
  }
  const cards = [
    {
      status,
      label: "Observer",
      title,
      note,
    },
    {
      status: activity.status,
      label: "Runtime Activity",
      title: activity.label,
      note: activity.detail,
    },
    {
      status: gatewayStatus,
      label: "Gateway/API",
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      note: gateway.enabled
        ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === null || gateway.latency_ms === undefined ? "" : `${gateway.latency_ms}ms`}`
        : "Gateway reachability is not being checked.",
    },
    {
      status: marketTimestamp ? stale ? "warn" : "ok" : "bad",
      label: "Market Feed",
      title: timestampAgeLabel(marketTimestamp),
      note: marketTimestamp ? "Latest bar/snapshot timestamp from runner metrics." : "No market-data timestamp published.",
    },
    {
      status: accountTimestamp ? stale ? "warn" : "ok" : "warn",
      label: "Account Feed",
      title: timestampAgeLabel(accountTimestamp),
      note: accountTimestamp
        ? `${numberText(metrics.account_snapshot_count, 0)} account snapshot${Number(metrics.account_snapshot_count || 0) === 1 ? "" : "s"} summarized.`
        : "No account snapshot timestamp published.",
    },
    {
      status: decisionTimestamp ? stale ? "warn" : "ok" : latestRun ? "warn" : "bad",
      label: "Decision Loop",
      title: decisionTimestamp ? timestampAgeLabel(decisionTimestamp) : nextDecision ? "Scheduled" : "Missing",
      note: decisionTimestamp
        ? latestDecision ? `${text(latestDecision.symbol)} ${text(latestDecision.detail)}` : "Last decision time is published in metrics."
        : nextDecision ? `Next expected decision ${text(nextDecision)}.` : "No decision timestamp or next check is visible.",
    },
    {
      status: latestReject ? "bad" : openOrders.length ? "warn" : nextOrderContext || latestOrder || latestFill ? "ok" : latestRun ? "warn" : "bad",
      label: "Order Context",
      title: latestReject ? "Rejected" : openOrders.length ? `${numberText(openOrders.length, 0)} open` : nextOrderContext ? "Signal Visible" : latestOrder ? "Order Visible" : latestFill ? "Fill Visible" : "Missing",
      note: latestReject
        ? `${text(latestReject.symbol)} ${text(latestReject.status)} ${text(latestReject.detail)}`
        : openOrders.length
          ? `${text(openOrders[0].symbol)} ${text(openOrders[0].status)} ${timestampAgeLabel(openOrders[0].timestamp)}.`
          : nextOrderContext
            ? text(nextOrderContext)
            : latestOrder
              ? `${text(latestOrder.symbol)} ${text(latestOrder.status)}.`
              : latestFill
                ? `${text(latestFill.symbol)} filled ${timestampAgeLabel(latestFill.timestamp)}.`
                : "No next-order condition, recent order, or fill context is visible.",
    },
    {
      status: latestRun ? ["paper", "simulated_paper", "shadow"].includes(mode) ? "ok" : mode ? "warn" : "bad" : "bad",
      label: "Mode",
      title: text(metrics.mode || "unpublished"),
      note: latestRun ? `Run ${text(latestRun.id)} status=${text(latestRun.status)}; heartbeat ${timestampAgeLabel(heartbeatTimestamp)}.` : "No current run is publishing telemetry.",
    },
  ];
  const detail = [
    ["Run", latestRun ? `${text(latestRun.id)} / ${text(latestRun.status)} / ${text(metrics.mode || "unpublished")}` : "none"],
    ["Supervisor", supervisor ? `${text(supervisor.id)} / ${text(supervisor.status)} / ${timestampAgeLabel(supervisor.generated_at)}` : "none"],
    ["Market Timestamp", text(marketTimestamp)],
    ["Account Timestamp", text(accountTimestamp)],
    ["Decision Timestamp", text(decisionTimestamp)],
    ["Next Decision", text(nextDecision)],
    ["Latest Order", latestOrder ? `${text(latestOrder.symbol)} ${text(latestOrder.status)} ${text(latestOrder.timestamp)}` : "none"],
    ["Latest Fill", latestFill ? `${text(latestFill.symbol)} ${text(latestFill.timestamp)}` : "none"],
    ["Latest Rejection", latestReject ? `${text(latestReject.symbol)} ${text(latestReject.status)} ${text(latestReject.detail)}` : "none"],
    ["Next Order Context", text(nextOrderContext)],
  ];
  return { status, title, note, cards, detail };
}

export function renderPaperObservationPacket() {
  if (!$("paper-observation-note") || !$("paper-observation-cards") || !$("paper-observation-detail")) return;
  const model = paperObservationPacketModel();
  $("paper-observation-note").innerHTML = `<span class="${escapeHtml(statusClass(model.status))}">${escapeHtml(model.title)}</span> - ${escapeHtml(model.note)}`;
  $("paper-observation-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("paper-observation-detail").innerHTML = model.detail.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
}

export function paperMonitorActionFor(item) {
  const label = String((item && item.label) || "").toLowerCase();
  if (label.includes("gateway")) return { target: "gateway-list", label: "Review Gateway" };
  if (label.includes("account")) return { target: "performance-home-result", label: "Open Performance" };
  if (label.includes("config") || label.includes("mode")) return { target: "current-runs-body", label: "Review Runs" };
  if (label.includes("market") || label.includes("order")) return { target: "overview-timeline-body", label: "Review Timeline" };
  return { target: "paper-monitor-guide", label: "Review Check" };
}

export function renderPaperMonitorHealth(items = []) {
  if (!$("paper-monitor-health")) return;
  const blockers = items.filter((item) => item.status === "bad");
  const warnings = items.filter((item) => item.status === "warn");
  const ready = items.filter((item) => item.status === "ok");
  const firstActionItem = blockers[0] || warnings[0] || null;
  const action = firstActionItem ? paperMonitorActionFor(firstActionItem) : { target: "paper-monitor-guide", label: "Monitor Ready" };
  const cards = [
    {
      status: blockers.length ? "bad" : warnings.length ? "warn" : "ok",
      label: "Readiness",
      title: blockers.length ? `${numberText(blockers.length, 0)} blockers` : warnings.length ? `${numberText(warnings.length, 0)} warnings` : "Ready",
      note: `${numberText(ready.length, 0)} of ${numberText(items.length, 0)} checks green.`,
    },
    {
      status: firstActionItem ? firstActionItem.status : "ok",
      label: "Next Action",
      title: action.label,
      note: firstActionItem ? `${text(firstActionItem.label)}: ${text(firstActionItem.detail)}` : "No visible paper-monitor blockers.",
    },
    {
      status: items.find((item) => item.label === "Config And Mode")?.status || "warn",
      label: "Mode Safety",
      title: items.find((item) => item.label === "Config And Mode")?.status === "ok" ? "Paper/Shadow" : "Review",
      note: items.find((item) => item.label === "Config And Mode")?.detail || "No current run mode is published.",
    },
    {
      status: items.find((item) => item.label === "Order Context")?.status || "warn",
      label: "Order Context",
      title: items.find((item) => item.label === "Order Context")?.status === "ok" ? "Visible" : "Missing",
      note: items.find((item) => item.label === "Order Context")?.detail || "No next-order condition is published.",
    },
  ];
  $("paper-monitor-health").innerHTML = cards.map((card) => `
    <div class="health-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function operationsHomeState() {
  const status = state.status || {};
  const gateway = status.gateway || {};
  const alerts = status.alerts || [];
  const paperItems = paperMonitorItems();
  const paperBad = paperItems.filter((item) => item.status === "bad").length;
  const paperWarn = paperItems.filter((item) => item.status === "warn").length;
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const staleRemote = remoteNodes.filter((node) => {
    const ageSeconds = (Date.now() - (timestampMillis(node.received_at || node.generated_at) || 0)) / 1000;
    return Number.isFinite(ageSeconds) && ageSeconds > 900;
  }).length;
  const commandAudit = state.commandAudit || {};
  const auditEvents = commandAudit.events || [];
  const integrity = commandAudit.integrity || {};
  const localRemote = status.remote_control || {};
  const localIntegrity = localRemote.integrity || {};
  const localIntegrityStatus = String(localIntegrity.status || "").toLowerCase();
  const localSignatureStatus = String(localIntegrity.signature_status || "").toLowerCase();
  const localAuditBad = ["broken", "error"].includes(localIntegrityStatus)
    || ["bad", "missing_key", "invalid", "failed"].includes(localSignatureStatus);
  const localAuditWarn = !localAuditBad && Boolean(localRemote.enabled) && (
    !localIntegrityStatus || ["empty", "legacy", "missing", "unknown"].includes(localIntegrityStatus)
    || ["warn", "disabled", "empty"].includes(localSignatureStatus)
  );
  const auditBad = localAuditBad
    || ["broken", "invalid"].includes(String(integrity.status || "").toLowerCase())
    || ["invalid", "failed"].includes(String(integrity.signature_status || "").toLowerCase());
  const auditWarn = !auditBad && (
    localAuditWarn ||
    !auditEvents.length
    || ["legacy", "unsigned", "disabled", "mixed"].includes(String(integrity.signature_status || "").toLowerCase())
    || ["legacy", "unchecked", "missing"].includes(String(integrity.status || "").toLowerCase())
  );
  const gatewayStatus = gateway.enabled
    ? gateway.reachable ? "ok" : "bad"
    : "warn";
  let result = "Review Operations";
  let note = "Use Operations Home to route into local paper monitoring, remote nodes, command audit, or Gateway diagnostics.";
  let nextAction = "paper";
  if (paperBad) {
    result = "Paper Monitor Blocked";
    note = `${numberText(paperBad, 0)} local paper-monitor blocker${paperBad === 1 ? "" : "s"} need review before trusting automation.`;
    nextAction = "paper";
  } else if (gatewayStatus === "bad") {
    result = "Gateway Not Reachable";
    note = text(gateway.error || "Gateway/API check is enabled but not reachable.");
    nextAction = "gateway";
  } else if (remoteAlerts || staleRemote) {
    result = "Remote Nodes Need Review";
    note = `${numberText(remoteAlerts, 0)} remote alert${remoteAlerts === 1 ? "" : "s"} / ${numberText(staleRemote, 0)} stale node${staleRemote === 1 ? "" : "s"}.`;
    nextAction = "remote";
  } else if (auditBad || auditWarn) {
    result = auditBad ? "Command Audit Broken" : "Command Audit Needs Review";
    note = integrity.status || localIntegrity.status
      ? `Receiver ${text(integrity.status || "not loaded")}; local ${text(localIntegrity.status || "not loaded")}; server signature ${text(integrity.signature_status || "not loaded")}; local signature ${text(localIntegrity.signature_status || "not loaded")}.`
      : "No command audit events or integrity status loaded yet.";
    nextAction = "audit";
  } else if (alerts.length || paperWarn) {
    result = "Warnings Present";
    note = `${numberText(alerts.length, 0)} local alert${alerts.length === 1 ? "" : "s"} / ${numberText(paperWarn, 0)} paper warning${paperWarn === 1 ? "" : "s"}.`;
    nextAction = alerts.length ? "gateway" : "paper";
  } else {
    result = "Operations Look Ready";
    note = "Local paper checks, Gateway, remote nodes, and command audit have no visible blockers.";
    nextAction = "remote";
  }
  const tiles = [
    {
      label: "Paper",
      status: paperBad ? "bad" : paperWarn ? "warn" : "ok",
      title: paperBad ? `${numberText(paperBad, 0)} blockers` : paperWarn ? `${numberText(paperWarn, 0)} warnings` : "Ready",
      note: `${numberText(paperItems.length, 0)} monitor checks.`,
    },
    {
      label: "Gateway",
      status: gatewayStatus,
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      note: gateway.enabled ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === undefined || gateway.latency_ms === null ? "" : `${gateway.latency_ms}ms`}` : "Gateway check disabled.",
    },
    {
      label: "Remote",
      status: remoteNodes.length ? remoteAlerts || staleRemote ? "warn" : "ok" : "warn",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} node${remoteNodes.length === 1 ? "" : "s"}` : "No Nodes",
      note: `${numberText(remoteAlerts, 0)} alerts / ${numberText(staleRemote, 0)} stale.`,
    },
    {
      label: "Audit",
      status: auditBad ? "bad" : auditWarn ? "warn" : "ok",
      title: auditBad ? "Broken" : auditWarn ? "Review" : "OK",
      note: `receiver ${text(integrity.status || "n/a")} / local ${text(localIntegrity.status || "n/a")} / signatures ${text(integrity.signature_status || "n/a")}/${text(localIntegrity.signature_status || "n/a")}.`,
    },
    {
      label: "Alerts",
      status: alerts.length ? "warn" : "ok",
      title: numberText(alerts.length, 0),
      note: alerts.length ? "Local alerts need review." : "No local alerts.",
    },
  ];
  return { result, note, nextAction, tiles };
}

export function renderOperationsHome() {
  if (!$("operations-home-result") || !$("operations-home-note") || !$("operations-home-tiles")) return;
  const model = operationsHomeState();
  $("operations-home-result").textContent = model.result;
  $("operations-home-note").textContent = model.note;
  for (const button of document.querySelectorAll("[data-operations-home-action]")) {
    if (!(button instanceof HTMLButtonElement)) continue;
    const active = button.dataset.operationsHomeAction === model.nextAction;
    button.classList.toggle("secondary", !active);
  }
  $("operations-home-tiles").innerHTML = model.tiles.map((tile) => `
    <div class="action-card status-${escapeHtml(tile.status)}">
      <span>${escapeHtml(tile.label)}</span>
      <strong>${escapeHtml(tile.title)}</strong>
      <small>${escapeHtml(tile.note)}</small>
    </div>
  `).join("");
  renderOperationsReadinessPanel(model);
  renderOperationsActionSummary(model);
  renderOperationsEvidence(model);
  renderOperationsWorkflowLauncher();
}

export function renderOperationsReadinessPanel(model = operationsHomeState()) {
  if (!$("operations-readiness-title") || !$("operations-readiness-cards") || !$("operations-readiness-actions")) return;
  const status = state.status || {};
  const gateway = status.gateway || {};
  const alerts = status.alerts || [];
  const paperItems = paperMonitorItems();
  const paperBad = paperItems.filter((item) => item.status === "bad").length;
  const paperWarn = paperItems.filter((item) => item.status === "warn").length;
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const staleRemote = remoteNodes.filter((node) => {
    const millis = timestampMillis(node.received_at || node.generated_at);
    return millis === null || ((Date.now() - millis) / 1000) > 900;
  }).length;
  const commandAudit = state.commandAudit || {};
  const auditEvents = commandAudit.events || [];
  const integrity = commandAudit.integrity || {};
  const localRemote = status.remote_control || {};
  const localIntegrity = localRemote.integrity || {};
  const commands = state.commands || [];
  const results = state.results || [];
  const pendingCommands = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failedResults = results.filter((result) => commandStatusIsFailed(result.status));
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const auditStatus = model.tiles.find((tile) => tile.label === "Audit") || {};
  const overallStatus = model.tiles.some((tile) => tile.status === "bad")
    ? "bad"
    : model.tiles.some((tile) => tile.status === "warn") ? "warn" : "ok";
  const nextAction = model.nextAction || "paper";
  const routeByAction = {
    paper: ["#operations/paper", "Paper Monitor"],
    remote: ["#operations/remote", "Remote Nodes"],
    audit: ["#operations/control", "Command Audit"],
    gateway: ["#operations/diagnostics", "Gateway"],
  };
  const [primaryHref, primaryLabel] = routeByAction[nextAction] || routeByAction.paper;
  $("operations-readiness-title").textContent = model.result;
  $("operations-readiness-title").className = statusClass(overallStatus);
  $("operations-readiness-note").textContent = model.note;
  const cards = [
    {
      label: "Local Paper",
      title: paperBad ? `${numberText(paperBad, 0)} blockers` : paperWarn ? `${numberText(paperWarn, 0)} warnings` : "ready",
      status: paperBad ? "bad" : paperWarn ? "warn" : "ok",
      detail: `${numberText(paperItems.length, 0)} readiness checks; inspect Gateway, account freshness, mode, data feed, and order context.`,
    },
    {
      label: "Gateway/API",
      title: gateway.enabled ? gateway.reachable ? "reachable" : "down" : "disabled",
      status: gatewayStatus,
      detail: gateway.enabled ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === undefined || gateway.latency_ms === null ? "" : `${gateway.latency_ms}ms`}` : "Reachability check disabled.",
    },
    {
      label: "Remote Monitor",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} nodes` : "no nodes",
      status: remoteNodes.length ? remoteAlerts || staleRemote ? "warn" : "ok" : "warn",
      detail: `${numberText(remoteAlerts, 0)} alerts / ${numberText(staleRemote, 0)} stale heartbeat${staleRemote === 1 ? "" : "s"}.`,
    },
    {
      label: "Command Audit",
      title: auditStatus.title || "not loaded",
      status: auditStatus.status || "warn",
      detail: `${numberText(auditEvents.length, 0)} sanitized audit event${auditEvents.length === 1 ? "" : "s"}; receiver ${text(integrity.status || "n/a")} / local ${text(localIntegrity.status || "n/a")}.`,
    },
    {
      label: "Control Queue",
      title: pendingCommands.length ? `${numberText(pendingCommands.length, 0)} pending` : failedResults.length ? `${numberText(failedResults.length, 0)} failed` : "clear",
      status: failedResults.length ? "bad" : pendingCommands.length ? "warn" : commands.length || results.length ? "ok" : "warn",
      detail: `${numberText(commands.length, 0)} queued command${commands.length === 1 ? "" : "s"} / ${numberText(results.length, 0)} result${results.length === 1 ? "" : "s"}.`,
    },
    {
      label: "Alerts",
      title: numberText(alerts.length, 0),
      status: alerts.length ? "warn" : "ok",
      detail: alerts.length ? `${text(alerts[0].kind || alerts[0].category || alerts[0].message)} is the latest local alert.` : "No local alerts in current status.",
    },
  ];
  $("operations-readiness-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.detail)}</small>
    </div>
  `).join("");
  $("operations-readiness-actions").innerHTML = [
    `<a href="${escapeHtml(primaryHref)}">${escapeHtml(primaryLabel)}</a>`,
    `<a class="secondary" href="#operations/paper">Paper</a>`,
    `<a class="secondary" href="#operations/remote">Remote</a>`,
    `<a class="secondary" href="#operations/control">Control</a>`,
    `<a class="secondary" href="#operations/diagnostics">Diagnostics</a>`,
  ].join("");
}

export function operationsActionSummaryModel(model = operationsHomeState()) {
  const status = state.status || {};
  const gateway = status.gateway || {};
  const alerts = status.alerts || [];
  const paperItems = paperMonitorItems();
  const paperBad = paperItems.filter((item) => item.status === "bad").length;
  const paperWarn = paperItems.filter((item) => item.status === "warn").length;
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const staleRemote = staleRemoteNodes(remoteNodes);
  const commandAudit = state.commandAudit || {};
  const auditEvents = commandAudit.events || [];
  const integrity = commandAudit.integrity || {};
  const localRemote = status.remote_control || {};
  const localIntegrity = localRemote.integrity || {};
  const commands = state.commands || [];
  const results = state.results || [];
  const pendingCommands = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failedResults = results.filter((result) => commandStatusIsFailed(result.status));
  const actionRoutes = {
    paper: ["#operations/paper", "Paper Monitor"],
    remote: ["#operations/remote", "Remote Nodes"],
    audit: ["#operations/control", "Command Audit"],
    gateway: ["#operations/diagnostics", "Gateway"],
  };
  const [primaryHref, primaryLabel] = actionRoutes[model.nextAction] || actionRoutes.paper;
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const auditTile = model.tiles.find((tile) => tile.label === "Audit") || { status: "warn", title: "Review", note: "No audit tile loaded." };
  const remoteTile = model.tiles.find((tile) => tile.label === "Remote") || { status: "warn", title: "No Nodes", note: "No remote state loaded." };
  const cards = [
    {
      label: "Inspect First",
      status: model.tiles.some((tile) => tile.status === "bad") ? "bad" : model.tiles.some((tile) => tile.status === "warn") ? "warn" : "ok",
      title: model.result,
      note: model.note,
    },
    {
      label: "Paper Monitor",
      status: paperBad ? "bad" : paperWarn ? "warn" : "ok",
      title: paperBad ? `${numberText(paperBad, 0)} blockers` : paperWarn ? `${numberText(paperWarn, 0)} warnings` : "Ready",
      note: `${numberText(paperItems.length, 0)} paper checks; route here before trusting paper automation.`,
    },
    {
      label: "Gateway/API",
      status: gatewayStatus,
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      note: gateway.enabled ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === undefined || gateway.latency_ms === null ? "" : `${gateway.latency_ms}ms`}` : "Gateway reachability is not checked.",
    },
    {
      label: "Remote Monitor",
      status: remoteTile.status,
      title: remoteTile.title,
      note: remoteNodes.length
        ? `${numberText(remoteAlerts, 0)} alerts / ${numberText(staleRemote.length, 0)} stale node${staleRemote.length === 1 ? "" : "s"}.`
        : "No remote status snapshots are loaded.",
    },
    {
      label: "Command Control",
      status: failedResults.length || auditTile.status === "bad" ? "bad" : pendingCommands.length || auditTile.status === "warn" ? "warn" : "ok",
      title: pendingCommands.length ? `${numberText(pendingCommands.length, 0)} pending` : failedResults.length ? `${numberText(failedResults.length, 0)} failed` : auditTile.title,
      note: `${numberText(auditEvents.length, 0)} audit events; receiver ${text(integrity.status || "n/a")} / local ${text(localIntegrity.status || "n/a")}.`,
    },
    {
      label: "Alerts",
      status: alerts.length ? "warn" : "ok",
      title: numberText(alerts.length, 0),
      note: alerts.length ? `${text(alerts[0].kind || alerts[0].category || alerts[0].message)} is the latest local alert.` : "No local alerts are visible.",
    },
  ];
  const actions = [
    { href: primaryHref, label: primaryLabel, secondary: false },
    { href: "#operations/paper", label: "Paper", secondary: true },
    { href: "#operations/remote", label: "Remote", secondary: true },
    { href: "#operations/control", label: "Control", secondary: true },
    { href: "#operations/diagnostics", label: "Diagnostics", secondary: true },
  ];
  return { title: model.result, note: model.note, cards, actions };
}

export function renderOperationsActionSummary(model = operationsHomeState()) {
  if (!$("operations-action-note") || !$("operations-action-cards") || !$("operations-action-actions")) return;
  const summary = operationsActionSummaryModel(model);
  $("operations-action-note").textContent = `${summary.title}: ${summary.note}`;
  $("operations-action-cards").innerHTML = summary.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("operations-action-actions").innerHTML = summary.actions.map((action) => `
    <a href="${escapeHtml(action.href)}"${action.secondary ? ` class="secondary"` : ""}>${escapeHtml(action.label)}</a>
  `).join("");
}

export function operationsEvidenceModel(model = operationsHomeState()) {
  const status = state.status || {};
  const gateway = status.gateway || {};
  const alerts = status.alerts || [];
  const paperItems = paperMonitorItems();
  const paperBad = paperItems.filter((item) => item.status === "bad");
  const paperWarn = paperItems.filter((item) => item.status === "warn");
  const paperObservation = paperObservationPacketModel();
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const staleRemote = staleRemoteNodes(remoteNodes);
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const remoteGatewayDown = remoteNodes.filter((node) => node.gateway_reachable === false);
  const commandAudit = state.commandAudit || {};
  const auditEvents = commandAudit.events || [];
  const integrity = commandAudit.integrity || {};
  const localRemote = status.remote_control || {};
  const localIntegrity = localRemote.integrity || {};
  const commands = state.commands || [];
  const results = state.results || [];
  const pendingCommands = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failedResults = results.filter((result) => commandStatusIsFailed(result.status));
  const latestRun = latestTelemetryRun();
  const supervisor = latestSupervisor();
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const auditStatus = (model.tiles.find((tile) => tile.label === "Audit") || {}).status || "warn";
  const remoteStatus = remoteNodes.length
    ? staleRemote.length || remoteGatewayDown.length ? "bad" : remoteAlerts ? "warn" : "ok"
    : "warn";
  const queueStatus = failedResults.length ? "bad" : pendingCommands.length ? "warn" : commands.length || results.length ? "ok" : "warn";
  const cards = [
    {
      status: paperBad.length ? "bad" : paperWarn.length ? "warn" : "ok",
      label: "Paper Proof",
      title: paperBad.length ? `${numberText(paperBad.length, 0)} blockers` : paperWarn.length ? `${numberText(paperWarn.length, 0)} warnings` : "Ready",
      note: `${numberText(paperItems.length, 0)} checks; ${paperObservation.title}.`,
    },
    {
      status: gatewayStatus,
      label: "Gateway/API",
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      note: gateway.enabled
        ? `${text(gateway.host)}:${text(gateway.port)} ${gateway.latency_ms === null || gateway.latency_ms === undefined ? "" : `${gateway.latency_ms}ms`}`
        : "Reachability check is disabled.",
    },
    {
      status: remoteStatus,
      label: "Remote Proof",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} nodes` : "No Nodes",
      note: remoteNodes.length
        ? `${numberText(staleRemote.length, 0)} stale / ${numberText(remoteGatewayDown.length, 0)} Gateway down / ${numberText(remoteAlerts, 0)} alerts.`
        : "No sanitized remote status snapshots loaded.",
    },
    {
      status: auditStatus,
      label: "Audit Chain",
      title: auditStatus === "bad" ? "Broken" : auditStatus === "warn" ? "Review" : "OK",
      note: `${numberText(auditEvents.length, 0)} events; receiver ${text(integrity.status || "n/a")} / local ${text(localIntegrity.status || "n/a")}.`,
    },
    {
      status: queueStatus,
      label: "Control Queue",
      title: pendingCommands.length ? `${numberText(pendingCommands.length, 0)} pending` : failedResults.length ? `${numberText(failedResults.length, 0)} failed` : commands.length || results.length ? "Visible" : "Empty",
      note: `${numberText(commands.length, 0)} queued / ${numberText(results.length, 0)} results.`,
    },
    {
      status: alerts.length ? "warn" : "ok",
      label: "Alerts",
      title: numberText(alerts.length, 0),
      note: alerts.length ? text(alerts[0].kind || alerts[0].category || alerts[0].message) : "No current local alerts.",
    },
  ];
  const lines = [
    {
      status: latestRun ? paperObservation.status : "bad",
      title: "Local Runner Evidence",
      detail: latestRun
        ? `Run ${text(latestRun.id)} status=${text(latestRun.status)}; paper observer ${text(paperObservation.title)}; supervisor ${supervisor ? `${text(supervisor.id)} ${timestampAgeLabel(supervisor.generated_at)}` : "not visible"}.`
        : "No current runner telemetry is publishing into the dashboard.",
    },
    {
      status: gatewayStatus,
      title: "Gateway/API Evidence",
      detail: gateway.enabled
        ? gateway.reachable
          ? `Gateway reachable at ${text(gateway.host)}:${text(gateway.port)} with latency ${gateway.latency_ms === null || gateway.latency_ms === undefined ? "n/a" : `${gateway.latency_ms} ms`}.`
          : `Gateway check failed: ${text(gateway.error || "not reachable")}.`
        : "Gateway reachability is disabled; this is acceptable for offline replay but not enough for paper/live monitoring.",
    },
    {
      status: paperBad.length ? "bad" : paperWarn.length ? "warn" : "ok",
      title: "Paper Readiness Evidence",
      detail: paperBad.length
        ? `${numberText(paperBad.length, 0)} blocker${paperBad.length === 1 ? "" : "s"}: ${paperBad.slice(0, 3).map((item) => text(item.label)).join(", ")}.`
        : paperWarn.length
          ? `${numberText(paperWarn.length, 0)} warning${paperWarn.length === 1 ? "" : "s"}: ${paperWarn.slice(0, 3).map((item) => text(item.label)).join(", ")}.`
          : "Paper readiness checks have no visible blockers.",
    },
    {
      status: remoteStatus,
      title: "Remote Monitoring Evidence",
      detail: remoteNodes.length
        ? `${numberText(remoteNodes.length, 0)} node${remoteNodes.length === 1 ? "" : "s"}; ${numberText(staleRemote.length, 0)} stale heartbeat${staleRemote.length === 1 ? "" : "s"}; ${numberText(remoteGatewayDown.length, 0)} remote Gateway blocker${remoteGatewayDown.length === 1 ? "" : "s"}; ${numberText(remoteAlerts, 0)} remote alert${remoteAlerts === 1 ? "" : "s"}.`
        : "No remote monitoring snapshots have been posted; publish sanitized status before relying on cloud checking.",
    },
    {
      status: auditStatus,
      title: "Command Audit Evidence",
      detail: `${numberText(auditEvents.length, 0)} receiver event${auditEvents.length === 1 ? "" : "s"}; receiver integrity ${text(integrity.status || "n/a")}; receiver signature ${text(integrity.signature_status || "n/a")}; local integrity ${text(localIntegrity.status || "n/a")}; local signature ${text(localIntegrity.signature_status || "n/a")}.`,
    },
    {
      status: queueStatus,
      title: "Control Queue Evidence",
      detail: `${numberText(pendingCommands.length, 0)} pending command${pendingCommands.length === 1 ? "" : "s"}; ${numberText(failedResults.length, 0)} failed result${failedResults.length === 1 ? "" : "s"}; ${numberText(commands.length, 0)} total queued command${commands.length === 1 ? "" : "s"}.`,
    },
    {
      status: alerts.length ? "warn" : "ok",
      title: "Alert Evidence",
      detail: alerts.length
        ? `${numberText(alerts.length, 0)} local alert${alerts.length === 1 ? "" : "s"} visible; latest ${text(alerts[0].kind || alerts[0].category || alerts[0].message)}.`
        : "No local alerts are visible in the current status payload.",
    },
  ];
  const blockers = cards.filter((card) => card.status === "bad").length;
  const warnings = cards.filter((card) => card.status === "warn").length + lines.filter((line) => line.status === "warn").length;
  const actionLabels = {
    paper: "Review Paper",
    remote: "Review Remote",
    audit: "Review Audit",
    gateway: "Review Gateway",
  };
  return {
    status: blockers ? "bad" : warnings ? "warn" : "ok",
    headline: model.result,
    note: `${model.note} Evidence: ${numberText(blockers, 0)} blocker${blockers === 1 ? "" : "s"} / ${numberText(warnings, 0)} review item${warnings === 1 ? "" : "s"}.`,
    cards,
    lines,
    next: {
      action: model.nextAction || "paper",
      label: actionLabels[model.nextAction] || "Review Paper",
    },
  };
}

export function operationsEvidenceText(model) {
  return [
    `Operations Evidence: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

export function renderOperationsEvidence(model = operationsHomeState()) {
  if (!$("operations-evidence-note") || !$("operations-evidence-cards") || !$("operations-evidence-body") || !$("operations-evidence-actions")) return;
  const evidence = operationsEvidenceModel(model);
  state.operationsEvidenceText = operationsEvidenceText(evidence);
  $("operations-evidence-note").textContent = evidence.note;
  $("operations-evidence-cards").innerHTML = evidence.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("operations-evidence-body").innerHTML = evidence.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("operations-evidence-actions").innerHTML = [
    `<button type="button" data-operations-evidence-action="copy">Copy Evidence</button>`,
    `<button type="button" class="secondary" data-operations-evidence-action="${escapeHtml(evidence.next.action)}">${escapeHtml(evidence.next.label)}</button>`,
    `<button type="button" class="secondary" data-operations-evidence-action="paper">Paper</button>`,
    `<button type="button" class="secondary" data-operations-evidence-action="remote">Remote</button>`,
    `<button type="button" class="secondary" data-operations-evidence-action="audit">Audit</button>`,
    `<button type="button" class="secondary" data-operations-evidence-action="gateway">Gateway</button>`,
  ].join("");
}

export function handleOperationsEvidenceAction(action) {
  if (action === "copy") {
    copyText(state.operationsEvidenceText || "No operations evidence loaded").then(() => {
      $("last-refresh").textContent = "Operations evidence copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Operations evidence copy failed: ${err.message}`;
    });
    return;
  }
  handleOperationsHomeAction(action || "paper");
}

export function operationsWorkflowCards() {
  const status = state.status || {};
  const gateway = status.gateway || {};
  const alerts = status.alerts || [];
  const paperItems = paperMonitorItems();
  const paperBad = paperItems.filter((item) => item.status === "bad").length;
  const paperWarn = paperItems.filter((item) => item.status === "warn").length;
  const remoteNodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const remoteAlerts = remoteNodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const staleRemote = remoteNodes.filter((node) => {
    const millis = timestampMillis(node.received_at || node.generated_at);
    return millis === null || ((Date.now() - millis) / 1000) > 900;
  }).length;
  const commandAudit = state.commandAudit || {};
  const auditEvents = commandAudit.events || [];
  const integrity = commandAudit.integrity || {};
  const localRemote = status.remote_control || {};
  const localIntegrity = localRemote.integrity || {};
  const integrityStatus = String(integrity.status || "").toLowerCase();
  const signatureStatus = String(integrity.signature_status || "").toLowerCase();
  const localIntegrityStatus = String(localIntegrity.status || "").toLowerCase();
  const localSignatureStatus = String(localIntegrity.signature_status || "").toLowerCase();
  const localAuditBad = ["broken", "error"].includes(localIntegrityStatus)
    || ["bad", "missing_key", "invalid", "failed"].includes(localSignatureStatus);
  const localAuditWarn = !localAuditBad && Boolean(localRemote.enabled) && (
    !localIntegrityStatus || ["empty", "legacy", "missing", "unknown"].includes(localIntegrityStatus)
    || ["warn", "disabled", "empty"].includes(localSignatureStatus)
  );
  const auditBad = localAuditBad || ["broken", "invalid"].includes(integrityStatus) || ["invalid", "failed"].includes(signatureStatus);
  const auditWarn = !auditBad && (
    localAuditWarn ||
    !auditEvents.length ||
    ["legacy", "unsigned", "disabled", "mixed"].includes(signatureStatus) ||
    ["legacy", "unchecked", "missing"].includes(integrityStatus)
  );
  const gatewayStatus = gateway.enabled ? gateway.reachable ? "ok" : "bad" : "warn";
  const commands = state.commands || [];
  const results = state.results || [];
  const pendingCommands = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failedResults = results.filter((result) => {
    const value = String(result.status || "").toLowerCase();
    return ["failed", "error", "rejected", "cancelled", "canceled"].includes(value);
  });
  const supervisors = status.supervisors || [];
  const supervisorIssues = supervisors.filter((supervisor) => supervisor.status && supervisor.status !== "ok");
  const diagnostics = state.diagnostics || {};
  const cleanup = state.cleanupPlan || {};
  const diagnosticWarnings = [
    ...(diagnostics.warnings || []),
    ...(diagnostics.errors || []),
    ...(cleanup.warnings || []),
    ...(cleanup.errors || []),
  ];

  return [
    {
      label: "Paper Monitor",
      title: paperBad ? `${numberText(paperBad, 0)} Blockers` : paperWarn ? `${numberText(paperWarn, 0)} Warnings` : "Ready",
      value: `${numberText(paperItems.length, 0)} checks`,
      status: paperBad ? "bad" : paperWarn ? "warn" : "ok",
      detail: paperBad
        ? "Gateway, account, mode, market-data, or order-context checks need review before trusting paper automation."
        : paperWarn ? "Paper monitoring is partially visible, but one or more readiness checks need review." : "Local paper-monitor checks have no visible blockers.",
      href: workflowHref("operations", "paper"),
      cta: "Paper",
    },
    {
      label: "Gateway/API",
      title: gateway.enabled ? gateway.reachable ? "Reachable" : "Down" : "Disabled",
      value: gateway.enabled ? `${text(gateway.host)}:${text(gateway.port)}` : "not checked",
      status: gatewayStatus,
      detail: gateway.enabled
        ? gateway.reachable ? "Gateway/API check is reachable from this dashboard host." : text(gateway.error || "Gateway/API check is enabled but unreachable.")
        : "Gateway reachability checks are disabled in the current status payload.",
      href: workflowHref("operations", "diagnostics"),
      cta: "Gateway",
    },
    {
      label: "Remote Nodes",
      title: remoteNodes.length ? `${numberText(remoteNodes.length, 0)} Nodes` : "No Nodes",
      value: `${numberText(remoteAlerts, 0)} alerts`,
      status: remoteNodes.length ? remoteAlerts || staleRemote ? "warn" : "ok" : "warn",
      detail: remoteNodes.length
        ? `${numberText(staleRemote, 0)} stale heartbeat${staleRemote === 1 ? "" : "s"}; inspect node detail for sanitized runs, alerts, and activity.`
        : "No read-only cloud monitoring snapshots are loaded yet.",
      href: workflowHref("operations", "remote"),
      cta: "Remote",
    },
    {
      label: "Command Audit",
      title: auditBad ? "Broken" : auditWarn ? "Needs Review" : "OK",
      value: `local ${text(localIntegrity.status || "n/a")}`,
      status: auditBad ? "bad" : auditWarn ? "warn" : "ok",
      detail: auditBad
        ? "Receiver or local worker audit integrity is broken/invalid; review audit rows before issuing controls."
        : auditWarn ? "Command audit is missing, legacy, unsigned, locally unchecked, or partially unchecked." : "Receiver and local command audit integrity have no visible blockers.",
      href: workflowHref("operations", "control"),
      cta: "Audit",
    },
    {
      label: "Control Queue",
      title: pendingCommands.length ? `${numberText(pendingCommands.length, 0)} Pending` : commands.length ? "No Pending" : "No Commands",
      value: failedResults.length ? `${numberText(failedResults.length, 0)} failed` : `${numberText(results.length, 0)} results`,
      status: failedResults.length ? "bad" : pendingCommands.length ? "warn" : commands.length || results.length ? "ok" : "warn",
      detail: pendingCommands.length
        ? "Remote-control commands are waiting for a worker; confirm node, action, and audit state."
        : failedResults.length ? "Recent command results include failures or rejections." : "Queue and result tables are available for remote-control review.",
      href: workflowHref("operations", "control"),
      cta: "Queue",
    },
    {
      label: "Diagnostics",
      title: alerts.length || diagnosticWarnings.length || supervisorIssues.length ? "Review" : "Clean",
      value: `${numberText(alerts.length, 0)} alerts`,
      status: alerts.length || diagnosticWarnings.length || supervisorIssues.length ? "warn" : "ok",
      detail: alerts.length || diagnosticWarnings.length || supervisorIssues.length
        ? `${numberText(supervisorIssues.length, 0)} supervisor issue${supervisorIssues.length === 1 ? "" : "s"} and ${numberText(diagnosticWarnings.length, 0)} diagnostic warning${diagnosticWarnings.length === 1 ? "" : "s"} are visible.`
        : "No local alerts, supervisor issues, or diagnostic warnings are visible.",
      href: workflowHref("operations", "diagnostics"),
      cta: "Diagnostics",
    },
  ];
}

export function renderOperationsWorkflowLauncher() {
  const container = $("operations-workflows");
  if (!container) return;
  const cards = operationsWorkflowCards();
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

export function handleOperationsHomeAction(action) {
  const targets = {
    paper: "paper-monitor-guide",
    remote: "remote-nodes-body",
    audit: "command-audit-body",
    gateway: "gateway-list",
  };
  const lenses = {
    paper: "paper",
    remote: "remote",
    audit: "control",
    gateway: "diagnostics",
  };
  applyOperationsLens(lenses[action] || "paper");
  const element = $(targets[action] || "paper-monitor-guide");
  if (element) element.scrollIntoView({ block: "start", behavior: "smooth" });
}

export function commandStatusIsFailed(status) {
  const value = String(status || "").toLowerCase();
  return ["failed", "error", "rejected", "cancelled", "canceled"].includes(value);
}

export function newestRemoteNodeId() {
  const nodes = ((state.remoteNodes && state.remoteNodes.nodes) || []).slice();
  nodes.sort((left, right) => (
    (timestampMillis(right.received_at || right.generated_at) || 0)
    - (timestampMillis(left.received_at || left.generated_at) || 0)
  ));
  return nodes.length ? text(nodes[0].node_id) : "";
}

export function controlAssistantModel() {
  const commands = state.commands || [];
  const results = state.results || [];
  const pendingCommands = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failedResults = results.filter((result) => commandStatusIsFailed(result.status));
  const latestResult = results.slice().reverse()[0] || null;
  const audit = state.commandAudit || {};
  const events = audit.events || [];
  const integrity = audit.integrity || {};
  const integrityStatus = String(integrity.status || "").toLowerCase();
  const signatureStatus = String(integrity.signature_status || "").toLowerCase();
  const auditBad = ["broken", "invalid", "error"].includes(integrityStatus) || ["invalid", "failed", "missing_key"].includes(signatureStatus);
  const auditWarn = !auditBad && (!events.length || ["legacy", "unchecked", "missing"].includes(integrityStatus) || ["disabled", "unsigned", "mixed"].includes(signatureStatus));
  const node = ($("command-node") && $("command-node").value.trim()) || newestRemoteNodeId();
  let title = "Control Queue Clear";
  let summary = "No pending or failed commands are visible; read-only status checks are the safest next action.";
  if (!node) {
    title = "Pick A Remote Node";
    summary = "No node is selected and no remote node snapshot is loaded, so queued commands would not have a clear target.";
  } else if (failedResults.length) {
    title = "Review Failed Command";
    summary = `${numberText(failedResults.length, 0)} recent command result${failedResults.length === 1 ? "" : "s"} failed, errored, or were rejected.`;
  } else if (pendingCommands.length) {
    title = "Command Pending";
    summary = `${numberText(pendingCommands.length, 0)} command${pendingCommands.length === 1 ? "" : "s"} waiting for a worker result.`;
  } else if (auditBad || auditWarn) {
    title = auditBad ? "Audit Integrity Blocker" : "Audit Needs Review";
    summary = `Receiver audit ${text(integrity.status || "not loaded")}; signature ${text(integrity.signature_status || "not loaded")}.`;
  } else if (!commands.length && !results.length) {
    title = "Ready For First Status Check";
    summary = "Queue a read-only status request to confirm the worker can receive, execute, and audit controls.";
  }
  const cards = [
    {
      status: node ? "ok" : "warn",
      label: "Target",
      title: node || "No node",
      note: node ? "Newest or selected remote node is available." : "Load remote snapshots or type a node ID.",
    },
    {
      status: pendingCommands.length ? "warn" : "ok",
      label: "Pending",
      title: numberText(pendingCommands.length, 0),
      note: pendingCommands.length ? `${text(pendingCommands[0].action)} waiting since ${text(pendingCommands[0].created_at)}.` : "No queued command is waiting.",
    },
    {
      status: failedResults.length ? "bad" : latestResult ? "ok" : "warn",
      label: "Results",
      title: failedResults.length ? `${numberText(failedResults.length, 0)} failed` : latestResult ? text(latestResult.status || "received") : "none",
      note: latestResult ? `${text(latestResult.action || latestResult.command_id)} / ${timestampAgeLabel(latestResult.received_at)}.` : "No command result rows loaded yet.",
    },
    {
      status: auditBad ? "bad" : auditWarn ? "warn" : "ok",
      label: "Audit",
      title: text(integrity.status || "not loaded"),
      note: `${numberText(events.length, 0)} rows / signature ${text(integrity.signature_status || "n/a")}.`,
    },
  ];
  const actions = [
    {
      action: "use-node",
      title: node ? "Use Newest Node" : "Find Node",
      note: node ? `Fill command target with ${node}.` : "Open Remote Nodes to inspect available targets.",
      label: node ? "Use Node" : "Remote",
      disabled: !node && !newestRemoteNodeId(),
    },
    {
      action: "request-status",
      title: "Queue Status Check",
      note: "Prepare a read-only request_status command for the selected node.",
      label: "Prepare",
      disabled: !node,
    },
    {
      action: failedResults.length ? "review-failed" : pendingCommands.length ? "review-pending" : "review-audit",
      title: failedResults.length ? "Review Failed Result" : pendingCommands.length ? "Review Pending Command" : "Review Audit",
      note: failedResults.length
        ? "Jump to command results and inspect the latest failure payload."
        : pendingCommands.length ? "Jump to queued commands before adding another control." : "Jump to command audit integrity and event rows.",
      label: "Review",
      disabled: false,
    },
    {
      action: "export-audit",
      title: "Export Audit CSV",
      note: "Download sanitized command audit rows for retention or off-host review.",
      label: "Export",
      disabled: false,
    },
  ];
  return { title, summary, cards, actions };
}

export function renderControlAssistant() {
  if (!$("control-assistant-title") || !$("control-assistant-cards") || !$("control-assistant-actions")) return;
  const model = controlAssistantModel();
  $("control-assistant-title").textContent = model.title;
  $("control-assistant-summary").textContent = model.summary;
  $("control-assistant-note").textContent = `${numberText((state.commands || []).length, 0)} queued command row${(state.commands || []).length === 1 ? "" : "s"} / ${numberText((state.results || []).length, 0)} result row${(state.results || []).length === 1 ? "" : "s"}`;
  $("control-assistant-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("control-assistant-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="control-assistant-action ${action.disabled ? "secondary" : ""}" data-control-assistant-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.note)}</small>
      </span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

export function handleControlAssistantAction(action) {
  const node = newestRemoteNodeId() || ($("command-node") && $("command-node").value.trim()) || "";
  if (action === "use-node") {
    if (node) $("command-node").value = node;
    $("command-node").focus();
    $("last-refresh").textContent = node ? `Command target set to ${node}` : "Open Remote Nodes to choose a command target";
    renderControlAssistant();
    return;
  }
  if (action === "request-status") {
    if (node && !$("command-node").value.trim()) $("command-node").value = node;
    $("command-action").value = "request_status";
    updateCommandFields();
    $("command-form").scrollIntoView({ block: "start", behavior: "smooth" });
    $("last-refresh").textContent = "Read-only request_status command prepared; review target before queueing";
    renderControlAssistant();
    return;
  }
  if (action === "review-pending") {
    $("commands-body").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "review-failed") {
    $("results-body").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "export-audit") {
    exportCommandAuditCsv().catch((err) => {
      $("last-refresh").textContent = `Command audit CSV export failed: ${err.message}`;
    });
    return;
  }
  $("command-audit-body").scrollIntoView({ block: "start", behavior: "smooth" });
}

export function commandSafetyReviewModel() {
  const commands = state.commands || [];
  const results = state.results || [];
  const audit = state.commandAudit || {};
  const events = audit.events || [];
  const integrity = audit.integrity || {};
  const retention = audit.retention_policy || {};
  const pending = commands.filter((command) => String(command.status || "").toLowerCase() === "pending");
  const failed = results.filter((result) => commandStatusIsFailed(result.status));
  const actions = Object.entries(commandBoundaries);
  const byClass = actions.reduce((acc, [, boundary]) => {
    const key = boundary.klass || "unknown";
    acc[key] = (acc[key] || 0) + 1;
    return acc;
  }, {});
  const confirmCount = actions.filter(([, boundary]) => boundary.confirm).length;
  const selectedAction = ($("command-action") && $("command-action").value) || "request_status";
  const selectedBoundary = commandBoundaries[selectedAction] || {};
  const node = ($("command-node") && $("command-node").value.trim()) || newestRemoteNodeId();
  const integrityStatus = String(integrity.status || "").toLowerCase();
  const signatureStatus = String(integrity.signature_status || "").toLowerCase();
  const auditBad = ["broken", "invalid", "error"].includes(integrityStatus) || ["invalid", "failed", "missing_key"].includes(signatureStatus);
  const auditWarn = !auditBad && (!events.length || ["legacy", "unchecked", "missing"].includes(integrityStatus) || ["disabled", "unsigned", "mixed"].includes(signatureStatus));
  const highRiskActions = ["flatten_live_positions", "change_strategy_config", "enable_live_orders"];
  const headline = auditBad
    ? "Command audit integrity must be fixed before trusting remote controls"
    : failed.length
      ? "Review failed command results before queueing more controls"
      : pending.length
        ? "A command is pending; avoid stacking controls until the worker responds"
        : "Command surface is bounded; start with read-only checks";
  const nextAction = auditBad
    ? "Open Command Audit, export CSV, and inspect local/server audit-chain configuration."
    : failed.length
      ? "Review Command Results and the audit row for the failed action."
      : pending.length
        ? "Wait for or cancel the pending command before adding another control."
        : node
          ? "Prepare request_status first, then queue control/launcher actions only after reading the boundary copy."
          : "Load or type a remote node before queueing any command.";
  const cards = [
    {
      status: node ? "ok" : "warn",
      label: "Target",
      title: node || "No node",
      note: node ? "A target node is available for command review." : "Remote commands need an explicit node target.",
    },
    {
      status: "ok",
      label: "Read-only",
      title: numberText(byClass["read-only"] || 0, 0),
      note: "Validation, status, and summary commands should be the first remote checks.",
    },
    {
      status: confirmCount ? "warn" : "ok",
      label: "Controls",
      title: `${numberText(confirmCount, 0)} confirm`,
      note: `${numberText(byClass.control || 0, 0)} control and ${numberText(byClass.launcher || 0, 0)} launcher actions require local-boundary review.`,
    },
    {
      status: pending.length ? "warn" : failed.length ? "bad" : "ok",
      label: "Queue",
      title: pending.length ? `${numberText(pending.length, 0)} pending` : failed.length ? `${numberText(failed.length, 0)} failed` : "Clear",
      note: pending[0] ? `${text(pending[0].action)} waiting since ${text(pending[0].created_at)}.` : failed[0] ? `${text(failed[0].action || failed[0].command_id)} failed/rejected.` : "No blocking command queue state.",
    },
    {
      status: auditBad ? "bad" : auditWarn ? "warn" : "ok",
      label: "Audit",
      title: text(integrity.status || "not loaded"),
      note: `${numberText(events.length, 0)} event rows; signature ${text(integrity.signature_status || "n/a")}.`,
    },
    {
      status: retention.off_host_verified ? "ok" : "warn",
      label: "Retention",
      title: retention.off_host_verified ? "Verified" : text(retention.status || "local only"),
      note: retention.summary || "Off-host immutable retention remains a deployment review item.",
    },
    {
      status: "bad",
      label: "Reserved High Risk",
      title: numberText(highRiskActions.length, 0),
      note: `${highRiskActions.join(", ")} stay fail-closed in the public command surface.`,
    },
    {
      status: selectedBoundary.confirm ? "warn" : selectedBoundary.klass === "read-only" ? "ok" : "neutral",
      label: "Selected Action",
      title: selectedAction,
      note: selectedBoundary.note || "Select an action to see boundary metadata.",
    },
  ];
  const lines = [
    {
      status: node ? "ok" : "warn",
      title: "1. Choose the command target deliberately",
      detail: node ? `Current/newest target is ${node}. Verify it is the intended local trading machine before queueing.` : "Remote snapshots or an explicit typed node ID are required before queueing.",
    },
    {
      status: "ok",
      title: "2. Prefer read-only commands first",
      detail: "Use request_status, validations, supervisor_status, or summarize_run before control and launcher actions.",
    },
    {
      status: confirmCount ? "warn" : "ok",
      title: "3. Treat control and launcher commands as local operations",
      detail: "Pause/resume, simulated flattening, one-shot supervisor runs, and restarts rely on local markers, allowlists, and worker configuration.",
    },
    {
      status: auditBad ? "bad" : auditWarn ? "warn" : "ok",
      title: "4. Verify audit integrity and signatures",
      detail: `Audit status ${text(integrity.status || "not loaded")}; signature ${text(integrity.signature_status || "not loaded")}; retention ${text(retention.status || "not loaded")}.`,
    },
    {
      status: "bad",
      title: "5. Keep live-control actions outside this public surface",
      detail: "Live flattening, strategy-config changes, and enabling live orders require a separate stronger design and remain rejected here.",
    },
  ];
  return { headline, nextAction, cards, lines };
}

export function commandSafetyReviewText(model) {
  return [
    `Command Safety Review: ${model.headline}`,
    `Next action: ${model.nextAction}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

export function renderCommandSafetyReview() {
  if (
    !$("command-safety-review-title")
    || !$("command-safety-review-note")
    || !$("command-safety-review-cards")
    || !$("command-safety-review-body")
    || !$("command-safety-review-actions")
  ) return;
  const model = commandSafetyReviewModel();
  state.commandSafetyReviewText = commandSafetyReviewText(model);
  $("command-safety-review-title").textContent = model.headline;
  $("command-safety-review-note").textContent = model.nextAction;
  $("command-safety-review-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("command-safety-review-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("command-safety-review-actions").innerHTML = [
    `<button type="button" data-command-safety-action="copy">Copy Review</button>`,
    `<button type="button" class="secondary" data-command-safety-action="request-status">Prepare Status Check</button>`,
    `<button type="button" class="secondary" data-command-safety-action="audit">Command Audit</button>`,
    `<button type="button" class="secondary" data-command-safety-action="remote">Remote Nodes</button>`,
    `<button type="button" class="secondary" data-command-safety-action="cloud">Cloud Boundary</button>`,
  ].join("");
}

export function handleCommandSafetyAction(action) {
  if (action === "copy") {
    copyText(state.commandSafetyReviewText || "No command safety review loaded").then(() => {
      $("last-refresh").textContent = "Command safety review copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Command safety review copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "request-status") {
    prepareRequestStatusCommand(newestRemoteNodeId() || ($("command-node") && $("command-node").value.trim()) || "");
    return;
  }
  if (action === "audit") {
    $("command-audit-body").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "remote") return applyOperationsLens("remote");
  if (action === "cloud") return applyOperationsLens("diagnostics");
}

export function prepareRequestStatusCommand(nodeId = "") {
  const cleanNode = text(nodeId);
  if (cleanNode && cleanNode !== "n/a") $("command-node").value = cleanNode;
  $("command-action").value = "request_status";
  updateCommandFields();
  applyOperationsLens("control");
  $("command-form").scrollIntoView({ block: "start", behavior: "smooth" });
  $("last-refresh").textContent = cleanNode && cleanNode !== "n/a"
    ? `Read-only request_status prepared for ${cleanNode}; review before queueing`
    : "Read-only request_status prepared; choose a node before queueing";
  renderControlAssistant();
}

export function remoteNodeFilters() {
  return {
    text: ($("remote-filter-text").value || "").trim().toLowerCase(),
    status: $("remote-filter-status").value || "",
    mode: $("remote-filter-mode").value || "",
    sort: $("remote-filter-sort").value || "heartbeat_desc",
  };
}

export function renderRemoteNodeFilterOptions(nodes) {
  const makeOptions = (id, values) => {
    const current = $(id).value || "";
    const unique = Array.from(new Set((values || []).map(text).filter((value) => value && value !== "n/a"))).sort();
    $(id).innerHTML = `<option value="">All</option>${unique.map((value) => `<option value="${escapeHtml(value)}">${escapeHtml(value)}</option>`).join("")}`;
    if (unique.includes(current)) $(id).value = current;
  };
  makeOptions("remote-filter-status", (nodes || []).map((node) => node.status));
  makeOptions("remote-filter-mode", (nodes || []).map((node) => node.mode));
}

export function remoteNodeSortValue(node, key) {
  if (key === "heartbeat") return timestampMillis(node.received_at || node.generated_at) || 0;
  if (key === "alerts") return Number(node.alert_count || 0);
  if (key === "orders") return Number(node.open_order_count || 0);
  if (key === "equity") return finiteNumber(node.final_equity) || 0;
  return String(node.node_id || "").toLowerCase();
}

export function filteredRemoteNodes(nodes) {
  const filters = remoteNodeFilters();
  const filtered = (nodes || []).filter((node) => {
    if (filters.status && text(node.status) !== filters.status) return false;
    if (filters.mode && text(node.mode) !== filters.mode) return false;
    if (filters.text) {
      const haystack = [
        node.node_id,
        node.status,
        node.mode,
        node.latest_run_id,
        node.latest_run_status,
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(filters.text)) return false;
    }
    return true;
  });
  const [key, direction] = String(filters.sort || "heartbeat_desc").split("_");
  const multiplier = direction === "asc" ? 1 : -1;
  return filtered.slice().sort((left, right) => {
    const leftValue = remoteNodeSortValue(left, key);
    const rightValue = remoteNodeSortValue(right, key);
    if (typeof leftValue === "number" && typeof rightValue === "number" && leftValue !== rightValue) {
      return (leftValue - rightValue) * multiplier;
    }
    const primary = String(leftValue).localeCompare(String(rightValue)) * multiplier;
    if (primary) return primary;
    return String(left.node_id || "").localeCompare(String(right.node_id || ""));
  });
}

export function remoteDetailActivityFilter() {
  return $("remote-detail-activity-filter") ? $("remote-detail-activity-filter").value || "" : "";
}

export function renderRemoteDetailAssistant(detail = state.remoteNodeDetail || {}, context = {}) {
  if (!$("remote-detail-assistant-title") || !$("remote-detail-assistant-cards") || !$("remote-detail-assistant-actions")) return;
  const summary = detail.summary || {};
  const runs = detail.runs || [];
  const alerts = detail.alerts || [];
  const activity = context.activity || remoteNodeActivityEvents(runs);
  const artifactRows = context.artifactRows || remoteRunArtifactEvidenceRows(runs);
  const filteredActivity = context.filteredActivity || activity;
  const artifactFileCount = artifactRows.reduce((sum, item) => sum + Number((item.evidence || {}).existing_count || 0), 0);
  const artifactRowCount = artifactRows.reduce((sum, item) => sum + Number((item.evidence || {}).jsonl_row_count || 0), 0);
  const latestActivity = activity[0] || null;
  const completedRuns = runs.filter((run) => text(run.status).toLowerCase() === "completed");
  const failedRuns = runs.filter((run) => ["failed", "error", "timeout", "cancelled", "canceled"].includes(text(run.status).toLowerCase()));
  const rejectedActivity = activity.filter((event) => eventStatusIsBad({
    status: eventStatus(event, event.type),
  }));
  const heartbeatMillis = timestampMillis(summary.received_at || summary.generated_at || detail.generated_at);
  const heartbeatAgeSeconds = heartbeatMillis === null ? null : (Date.now() - heartbeatMillis) / 1000;
  const heartbeatStale = heartbeatAgeSeconds === null || heartbeatAgeSeconds > 900;
  let status = "idle";
  let title = "Select Remote Node";
  let note = "Click Detail on a Remote Nodes row to inspect sanitized monitoring detail.";
  if (detail.node_id) {
    status = alerts.length || failedRuns.length || rejectedActivity.length || heartbeatStale ? "warn" : "ok";
    title = status === "ok" ? "Remote Node Healthy" : "Remote Node Needs Review";
    note = status === "ok"
      ? "Heartbeat, alerts, activity, and bounded artifact evidence have no visible blockers."
      : "Review stale heartbeat, alerts, failed runs, rejected activity, or missing artifact evidence before trusting remote state.";
  }
  $("remote-detail-assistant-title").textContent = title;
  $("remote-detail-assistant-title").className = statusClass(status);
  $("remote-detail-assistant-note").textContent = note;
  const cards = [
    {
      status: detail.node_id ? heartbeatStale ? "warn" : "ok" : "idle",
      title: detail.node_id ? timestampAgeLabel(summary.received_at || summary.generated_at || detail.generated_at) : "No Node",
      label: "Heartbeat",
      note: detail.node_id ? `${numberText(detail.count || 0, 0)} loaded / ${numberText(detail.total || 0, 0)} stored snapshots.` : "No remote detail payload loaded.",
    },
    {
      status: alerts.length ? "bad" : detail.node_id ? "ok" : "idle",
      title: numberText(alerts.length, 0),
      label: "Alerts",
      note: alerts.length ? text((alerts[0] || {}).message || (alerts[0] || {}).kind) : "No latest alerts in the selected node snapshot.",
    },
    {
      status: failedRuns.length ? "bad" : completedRuns.length ? "ok" : runs.length ? "warn" : detail.node_id ? "warn" : "bad",
      title: `${numberText(completedRuns.length, 0)} completed`,
      label: "Latest Runs",
      note: `${numberText(failedRuns.length, 0)} failed/error run${failedRuns.length === 1 ? "" : "s"} / ${numberText(runs.length, 0)} loaded.`,
    },
    {
      status: rejectedActivity.length ? "bad" : activity.length ? "ok" : detail.node_id ? "warn" : "idle",
      title: numberText(filteredActivity.length, 0),
      label: "Activity",
      note: latestActivity ? `${text(latestActivity.type)} ${timestampAgeLabel(eventTimestamp(latestActivity))}; ${numberText(rejectedActivity.length, 0)} issue events.` : "No sanitized decision/order/fill activity loaded.",
    },
    {
      status: artifactRows.length ? "ok" : detail.node_id ? "warn" : "bad",
      title: numberText(artifactFileCount, 0),
      label: "Artifact Files",
      note: artifactRows.length ? `${numberText(artifactRows.length, 0)} runs / ${numberText(artifactRowCount, 0)} JSONL rows.` : "No bounded artifact evidence in latest run summaries.",
    },
  ];
  $("remote-detail-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("remote-detail-assistant-actions").innerHTML = [
    {
      action: "decisions",
      status: activity.some((event) => event.type === "decision") ? "ok" : "bad",
      title: "Show Decisions",
      note: "Filter remote activity to sanitized strategy decisions.",
      disabled: !activity.some((event) => event.type === "decision"),
    },
    {
      action: "orders",
      status: activity.some((event) => event.type === "order") ? "warn" : "bad",
      title: "Show Orders",
      note: "Filter remote activity to sanitized order rows.",
      disabled: !activity.some((event) => event.type === "order"),
    },
    {
      action: "fills",
      status: activity.some((event) => event.type === "fill") ? "ok" : "bad",
      title: "Show Fills",
      note: "Filter remote activity to fills.",
      disabled: !activity.some((event) => event.type === "fill"),
    },
    {
      action: "clear",
      status: remoteDetailActivityFilter() ? "ok" : "warn",
      title: "Clear Activity Filter",
      note: "Return to all sanitized activity rows.",
      disabled: !remoteDetailActivityFilter(),
    },
    {
      action: "control",
      status: detail.node_id ? "warn" : "idle",
      title: "Use As Control Target",
      note: detail.node_id ? `Fill command target with ${text(detail.node_id)} and open Control.` : "Select a node before targeting controls.",
      disabled: !detail.node_id,
    },
    {
      action: "export",
      status: detail.node_id ? "ok" : "bad",
      title: "Export Detail CSV",
      note: "Download bounded sanitized node detail rows.",
      disabled: !detail.node_id,
    },
  ].map((item) => `
    <button class="remote-detail-assistant-action status-${escapeHtml(item.status)}" data-remote-detail-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

export function handleRemoteDetailAssistantAction(action) {
  if (action === "decisions" || action === "orders" || action === "fills") {
    $("remote-detail-activity-filter").value = action.slice(0, -1);
    renderRemoteNodeDetail();
    return;
  }
  if (action === "clear") {
    $("remote-detail-activity-filter").value = "";
    renderRemoteNodeDetail();
    return;
  }
  if (action === "control") {
    const nodeId = text((state.remoteNodeDetail || {}).node_id);
    if (nodeId && nodeId !== "n/a") $("command-node").value = nodeId;
    applyOperationsLens("control");
    $("command-form").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "export") {
    downloadRemoteNodeDetailCsv().catch((err) => {
      $("last-refresh").textContent = `Remote node detail CSV export failed: ${err.message}`;
    });
  }
}

export function remoteNodeHealthReportModel(detail = state.remoteNodeDetail || {}, context = {}) {
  const summary = detail.summary || {};
  const runs = detail.runs || [];
  const alerts = detail.alerts || [];
  const activity = context.activity || remoteNodeActivityEvents(runs);
  const filteredActivity = context.filteredActivity || activity;
  const artifactRows = context.artifactRows || remoteRunArtifactEvidenceRows(runs);
  const latestActivity = activity[0] || null;
  const completedRuns = runs.filter((run) => text(run.status).toLowerCase() === "completed");
  const failedRuns = runs.filter((run) => ["failed", "error", "timeout", "cancelled", "canceled"].includes(text(run.status).toLowerCase()));
  const rejectedActivity = activity.filter((event) => eventStatusIsBad({
    status: eventStatus(event, event.type),
  }));
  const heartbeatTimestamp = summary.received_at || summary.generated_at || detail.generated_at;
  const heartbeatMillis = timestampMillis(heartbeatTimestamp);
  const heartbeatAgeSeconds = heartbeatMillis === null ? null : (Date.now() - heartbeatMillis) / 1000;
  const heartbeatStale = heartbeatAgeSeconds === null || heartbeatAgeSeconds > 900;
  const latestAccount = summary.latest_account_time;
  const latestData = firstPresent(summary.latest_data_time, summary.latest_bar_time);
  const accountMillis = timestampMillis(latestAccount);
  const dataMillis = timestampMillis(latestData);
  const accountStale = accountMillis === null || ((Date.now() - accountMillis) / 1000) > 900;
  const dataStale = dataMillis === null || ((Date.now() - dataMillis) / 1000) > 900;
  const artifactFileCount = artifactRows.reduce((sum, item) => sum + Number((item.evidence || {}).existing_count || 0), 0);
  const artifactMissingCount = artifactRows.reduce((sum, item) => sum + Number((item.evidence || {}).missing_count || 0), 0);
  const artifactRowCount = artifactRows.reduce((sum, item) => sum + Number((item.evidence || {}).jsonl_row_count || 0), 0);
  const boundary = detail.boundary_policy || {};
  const hasBoundary = Boolean(boundary.name);
  let status = "idle";
  let headline = "No remote node selected";
  let note = "Select Detail on a Remote Nodes row to build a health report.";
  if (detail.node_id) {
    status = heartbeatStale || failedRuns.length || rejectedActivity.length || alerts.length || artifactMissingCount ? "warn" : "ok";
    headline = status === "ok" ? "Remote node health evidence is usable" : "Remote node health needs review";
    note = `${text(detail.node_id)} / ${text(summary.mode)} / heartbeat ${timestampAgeLabel(heartbeatTimestamp)} / ${numberText(alerts.length, 0)} alert${alerts.length === 1 ? "" : "s"}.`;
  }
  const cards = [
    {
      status: detail.node_id ? heartbeatStale ? "warn" : "ok" : "idle",
      label: "Heartbeat",
      title: detail.node_id ? timestampAgeLabel(heartbeatTimestamp) : "No Node",
      note: detail.node_id ? `${numberText(detail.count || 0, 0)} loaded / ${numberText(detail.total || 0, 0)} stored status snapshots.` : "Select a remote node first.",
    },
    {
      status: detail.node_id ? summary.gateway_reachable === false ? "bad" : summary.gateway_reachable === true ? "ok" : "warn" : "idle",
      label: "Gateway/API",
      title: detail.node_id ? text(summary.gateway_reachable) : "n/a",
      note: detail.node_id ? `${text(summary.status)} / mode ${text(summary.mode)}.` : "No remote Gateway evidence loaded.",
    },
    {
      status: detail.node_id ? accountStale || dataStale ? "warn" : "ok" : "idle",
      label: "Feeds",
      title: `${accountStale ? "Review" : "Fresh"}`,
      note: `Account ${timestampAgeLabel(latestAccount)} / data ${timestampAgeLabel(latestData)}.`,
    },
    {
      status: alerts.length ? "bad" : detail.node_id ? "ok" : "idle",
      label: "Alerts",
      title: numberText(alerts.length, 0),
      note: alerts.length ? text((alerts[0] || {}).message || (alerts[0] || {}).kind) : "No latest alerts in selected node detail.",
    },
    {
      status: failedRuns.length ? "bad" : completedRuns.length ? "ok" : runs.length ? "warn" : detail.node_id ? "warn" : "idle",
      label: "Runs",
      title: `${numberText(completedRuns.length, 0)} completed`,
      note: `${numberText(failedRuns.length, 0)} failed/error; ${numberText(runs.length, 0)} bounded latest run summaries.`,
    },
    {
      status: rejectedActivity.length ? "bad" : activity.length ? "ok" : detail.node_id ? "warn" : "idle",
      label: "Activity",
      title: numberText(filteredActivity.length, 0),
      note: latestActivity ? `${text(latestActivity.type)} ${timestampAgeLabel(eventTimestamp(latestActivity))}; ${numberText(rejectedActivity.length, 0)} issue events.` : "No bounded decision/order/fill activity loaded.",
    },
    {
      status: artifactMissingCount ? "warn" : artifactRows.length ? "ok" : detail.node_id ? "warn" : "idle",
      label: "Artifacts",
      title: `${numberText(artifactFileCount, 0)} files`,
      note: `${numberText(artifactRows.length, 0)} run evidence rows / ${numberText(artifactRowCount, 0)} JSONL rows / ${numberText(artifactMissingCount, 0)} missing expected files.`,
    },
    {
      status: hasBoundary ? "ok" : detail.node_id ? "warn" : "idle",
      label: "Boundary",
      title: hasBoundary ? "Sanitized" : "Missing",
      note: hasBoundary ? text(boundary.retention_note || boundary.scope) : "Boundary policy is not loaded for the selected node.",
    },
  ];
  const lines = [
    {
      status,
      title: "Current Read",
      detail: detail.node_id ? `${headline}: ${note}` : "No node is selected. Use Remote Nodes table Detail to load one.",
    },
    {
      status: detail.node_id ? heartbeatStale ? "warn" : "ok" : "idle",
      title: "Heartbeat And Source",
      detail: detail.node_id
        ? `Latest heartbeat ${timestampAgeLabel(heartbeatTimestamp)}; ${numberText(detail.count || 0, 0)} loaded snapshots out of ${numberText(detail.total || 0, 0)} stored.`
        : "No heartbeat source is loaded.",
    },
    {
      status: detail.node_id ? accountStale || dataStale ? "warn" : "ok" : "idle",
      title: "Account And Data Feeds",
      detail: `Equity ${money(summary.final_equity)}, cash ${money(summary.cash)}, positions ${numberText(summary.position_count, 0)}, open orders ${numberText(summary.open_order_count, 0)}, account ${timestampAgeLabel(latestAccount)}, data ${timestampAgeLabel(latestData)}.`,
    },
    {
      status: failedRuns.length || rejectedActivity.length ? "warn" : runs.length || activity.length ? "ok" : detail.node_id ? "warn" : "idle",
      title: "Runs And Activity",
      detail: `${numberText(runs.length, 0)} latest run summaries, ${numberText(completedRuns.length, 0)} completed, ${numberText(failedRuns.length, 0)} failed/error, ${numberText(activity.length, 0)} activity rows, ${numberText(rejectedActivity.length, 0)} issue events.`,
    },
    {
      status: artifactMissingCount ? "warn" : artifactRows.length ? "ok" : detail.node_id ? "warn" : "idle",
      title: "Artifact Evidence",
      detail: artifactRows.length
        ? `${numberText(artifactRows.length, 0)} latest runs include bounded artifact evidence: ${numberText(artifactFileCount, 0)} existing files, ${numberText(artifactRowCount, 0)} JSONL rows, ${numberText(artifactMissingCount, 0)} missing expected files.`
        : "No bounded artifact evidence is included in the latest remote run summaries.",
    },
    {
      status: hasBoundary ? "ok" : "warn",
      title: "Cloud Boundary",
      detail: hasBoundary
        ? `${text(boundary.scope)} Excludes ${(boundary.excluded || []).slice(0, 4).join(", ") || "raw logs, credentials, local paths, and private diagnostics"}.`
        : "Remote detail should remain bounded and sanitized before any richer cloud artifact browsing.",
    },
    {
      status,
      title: "Next Action",
      detail: status === "ok"
        ? "Remote evidence is readable; use Performance or Runs locally for deeper artifact-level inspection if a metric looks surprising."
        : detail.node_id ? "Review alerts, stale feed timestamps, failed runs, rejected activity, missing artifact evidence, or Gateway state before trusting cloud status." : "Select a node, then copy or export this report.",
    },
  ];
  return { status, headline, note, cards, lines };
}

export function remoteNodeHealthReportText(model) {
  return [
    `Remote Node Health Report: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

export function renderRemoteNodeHealthReport(detail = state.remoteNodeDetail || {}, context = {}) {
  if (
    !$("remote-node-health-report-note")
    || !$("remote-node-health-report-cards")
    || !$("remote-node-health-report-body")
    || !$("remote-node-health-report-actions")
  ) return;
  const model = remoteNodeHealthReportModel(detail, context);
  state.remoteNodeHealthReportText = remoteNodeHealthReportText(model);
  $("remote-node-health-report-note").textContent = model.note;
  $("remote-node-health-report-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("remote-node-health-report-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("remote-node-health-report-actions").innerHTML = [
    `<button type="button" data-remote-node-health-report-action="copy">Copy Report</button>`,
    `<button type="button" class="secondary" data-remote-node-health-report-action="activity">Activity</button>`,
    `<button type="button" class="secondary" data-remote-node-health-report-action="artifacts">Artifacts</button>`,
    `<button type="button" class="secondary" data-remote-node-health-report-action="export">Export CSV</button>`,
    `<button type="button" class="secondary" data-remote-node-health-report-action="control">Control</button>`,
    `<button type="button" class="secondary" data-remote-node-health-report-action="cloud">Cloud Readiness</button>`,
  ].join("");
}

export function handleRemoteNodeHealthReportAction(action) {
  if (action === "copy") {
    copyText(state.remoteNodeHealthReportText || "No remote node health report loaded").then(() => {
      $("last-refresh").textContent = "Remote node health report copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Remote health report copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "activity") {
    $("remote-node-activity-body").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "artifacts") {
    $("remote-node-artifacts-body").scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "export") {
    downloadRemoteNodeDetailCsv().catch((err) => {
      $("last-refresh").textContent = `Remote node detail CSV export failed: ${err.message}`;
    });
    return;
  }
  if (action === "control") {
    handleRemoteDetailAssistantAction("control");
    return;
  }
  navigateToOperationsLens("diagnostics");
  $("cloud-readiness-note").scrollIntoView({ block: "start", behavior: "smooth" });
}

export function eventTimestamp(event) {
  return event.timestamp
    || event.time
    || event.submitted_at
    || event.filled_at
    || event.decision_time
    || event.created_at
    || event.updated_at
    || "";
}

export function eventSymbol(event) {
  return event.symbol || event.ticker || event.contract || event.instrument || "";
}

export function eventStatus(event, type) {
  return event.status || event.action || event.side || type || "";
}

export function eventDetail(event) {
  const keys = ["reason", "tag", "side", "quantity", "price", "cash_quantity", "signal", "threshold"];
  const parts = [];
  for (const key of keys) {
    if (event[key] !== undefined && event[key] !== null && event[key] !== "") {
      parts.push(`${key}:${text(event[key])}`);
    }
  }
  return parts.length ? parts.join(" ") : objectSummary(event);
}

export function remoteNodeActivityEvents(runs) {
  const events = [];
  for (const runItem of runs || []) {
    for (const event of runItem.recent_decisions || []) {
      events.push({ ...event, run_id: runItem.id, type: "decision" });
    }
    for (const event of runItem.recent_orders || []) {
      events.push({ ...event, run_id: runItem.id, type: "order" });
    }
    for (const event of runItem.recent_fills || []) {
      events.push({ ...event, run_id: runItem.id, type: "fill" });
    }
  }
  return events.sort((left, right) => (timestampMillis(eventTimestamp(right)) || 0) - (timestampMillis(eventTimestamp(left)) || 0));
}

export function remoteRunArtifactEvidenceRows(runs) {
  return (runs || [])
    .map((runItem) => ({ run: runItem, evidence: runItem.artifact_evidence || null }))
    .filter((item) => item.evidence);
}

export function remoteArtifactMissingNames(evidence) {
  const missing = Array.isArray(evidence.missing_files)
    ? evidence.missing_files.filter(Boolean)
    : (evidence.files || [])
      .filter((item) => !item.exists)
      .map((item) => item.name)
      .filter(Boolean);
  return missing.length ? missing.slice(0, 4).join(", ") : "none";
}

export function remoteArtifactCategorySummary(evidence) {
  const categories = evidence.category_counts || {};
  const top = topCountEntries(categories, 3).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ");
  const metadata = Number(evidence.metadata_file_count || 0);
  const streams = Number(evidence.event_stream_count || 0);
  return top || `${numberText(metadata, 0)} metadata / ${numberText(streams, 0)} streams`;
}

export function staleRemoteNodes(nodes = [], maxAgeSeconds = 900) {
  return (nodes || []).filter((node) => {
    const millis = timestampMillis(node.received_at || node.generated_at);
    if (millis === null) return true;
    return ((Date.now() - millis) / 1000) > maxAgeSeconds;
  });
}

export function newestRemoteNode(nodes = []) {
  return (nodes || []).slice().sort((left, right) => (
    (timestampMillis(right.received_at || right.generated_at) || 0)
    - (timestampMillis(left.received_at || left.generated_at) || 0)
  ))[0] || null;
}

export function renderRemoteNodesAssistant(nodes = [], filteredNodes = []) {
  if (!$("remote-nodes-assistant-title") || !$("remote-nodes-assistant-cards") || !$("remote-nodes-assistant-actions")) return;
  const staleNodes = staleRemoteNodes(nodes);
  const alertNodes = (nodes || []).filter((node) => Number(node.alert_count || 0) > 0);
  const orderNodes = (nodes || []).filter((node) => Number(node.open_order_count || 0) > 0);
  const gatewayDown = (nodes || []).filter((node) => node.gateway_reachable === false);
  const newest = newestRemoteNode(nodes);
  const activeFilters = [
    $("remote-filter-text").value ? `search ${$("remote-filter-text").value}` : "",
    $("remote-filter-status").value ? `status ${$("remote-filter-status").value}` : "",
    $("remote-filter-mode").value ? `mode ${$("remote-filter-mode").value}` : "",
  ].filter(Boolean);
  let status = "bad";
  let title = "No Remote Nodes";
  let note = "No authenticated status snapshots are loaded for remote monitoring.";
  if (nodes.length) {
    status = staleNodes.length || gatewayDown.length ? "bad" : alertNodes.length || orderNodes.length ? "warn" : "ok";
    title = staleNodes.length
      ? "Stale Heartbeats"
      : gatewayDown.length
        ? "Gateway Issues"
        : alertNodes.length
          ? "Alerts Present"
          : orderNodes.length
            ? "Open Orders Visible"
            : "Remote Nodes Ready";
    note = activeFilters.length
      ? `${activeFilters.join(" / ")}; ${numberText(filteredNodes.length, 0)} of ${numberText(nodes.length, 0)} nodes shown.`
      : status === "ok"
        ? "Remote snapshots have fresh heartbeats and no visible alert/order blockers."
        : "Use the actions below to sort toward the risky nodes, open detail, or prepare a read-only status request.";
  }
  $("remote-nodes-assistant-title").textContent = title;
  $("remote-nodes-assistant-title").className = statusClass(status);
  $("remote-nodes-assistant-note").textContent = note;
  const cards = [
    {
      status: nodes.length ? staleNodes.length ? "bad" : "ok" : "idle",
      title: staleNodes.length ? `${numberText(staleNodes.length, 0)} stale` : nodes.length ? "Fresh" : "No Nodes",
      label: "Heartbeat",
      note: newest ? `Newest ${text(newest.node_id)} ${timestampAgeLabel(newest.received_at || newest.generated_at)}.` : "No remote heartbeat loaded.",
    },
    {
      status: alertNodes.length ? "warn" : nodes.length ? "ok" : "idle",
      title: numberText(alertNodes.length, 0),
      label: "Alert Nodes",
      note: alertNodes.length ? alertNodes.slice(0, 3).map((node) => text(node.node_id)).join(", ") : "No remote node alerts visible.",
    },
    {
      status: orderNodes.length ? "warn" : nodes.length ? "ok" : "idle",
      title: numberText(orderNodes.length, 0),
      label: "Open-Order Nodes",
      note: orderNodes.length ? "Verify broker state locally before issuing controls." : "No non-terminal remote order events visible.",
    },
    {
      status: gatewayDown.length ? "bad" : nodes.length ? "ok" : "bad",
      title: gatewayDown.length ? `${numberText(gatewayDown.length, 0)} down` : nodes.length ? "Reachable" : "Unknown",
      label: "Gateway/API",
      note: gatewayDown.length ? gatewayDown.slice(0, 3).map((node) => text(node.node_id)).join(", ") : "No remote Gateway/API blockers in latest snapshots.",
    },
    {
      status: filteredNodes.length ? "ok" : nodes.length ? "warn" : "bad",
      title: `${numberText(filteredNodes.length, 0)} / ${numberText(nodes.length, 0)}`,
      label: "Shown",
      note: activeFilters.length ? "Current filters are hiding some nodes." : "No remote filters are active.",
    },
  ];
  $("remote-nodes-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("remote-nodes-assistant-actions").innerHTML = [
    {
      action: "alerts",
      status: alertNodes.length ? "warn" : "ok",
      title: "Sort Alerts First",
      note: alertNodes.length ? "Show nodes with the most alerts at the top." : "No alerting nodes to prioritize.",
      disabled: !alertNodes.length,
    },
    {
      action: "stale",
      status: staleNodes.length ? "bad" : "ok",
      title: "Sort Stale First",
      note: staleNodes.length ? "Show oldest heartbeat first." : "No stale heartbeat detected.",
      disabled: !staleNodes.length,
    },
    {
      action: "orders",
      status: orderNodes.length ? "warn" : "ok",
      title: "Sort Open Orders",
      note: orderNodes.length ? "Show nodes with the most non-terminal order events." : "No open-order nodes to prioritize.",
      disabled: !orderNodes.length,
    },
    {
      action: "newest-detail",
      status: newest ? "ok" : "idle",
      title: "Open Newest Detail",
      note: newest ? `Load bounded detail for ${text(newest.node_id)}.` : "No node detail can be loaded yet.",
      disabled: !newest,
    },
    {
      action: "request-status",
      status: newest ? "warn" : "idle",
      title: "Prepare Status Check",
      note: newest ? `Prepare read-only request_status for ${text(newest.node_id)}.` : "No node is available as a target.",
      disabled: !newest,
    },
    {
      action: "clear",
      status: activeFilters.length ? "ok" : "warn",
      title: "Clear Filters",
      note: activeFilters.length ? "Return to all remote nodes." : "No remote filters are active.",
      disabled: !activeFilters.length,
    },
    {
      action: "export",
      status: nodes.length ? "ok" : "bad",
      title: "Export Nodes CSV",
      note: "Download sanitized remote-node summaries.",
      disabled: !nodes.length,
    },
  ].map((item) => `
    <button class="remote-detail-assistant-action status-${escapeHtml(item.status)}" data-remote-nodes-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

export function handleRemoteNodesAssistantAction(action) {
  const nodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const newest = newestRemoteNode(nodes);
  if (action === "alerts") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = "alerts_desc";
    renderRemoteNodes();
    $("last-refresh").textContent = "Remote nodes sorted by alert count";
    return;
  }
  if (action === "stale") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = "heartbeat_asc";
    renderRemoteNodes();
    $("last-refresh").textContent = "Remote nodes sorted by oldest heartbeat";
    return;
  }
  if (action === "orders") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = "orders_desc";
    renderRemoteNodes();
    $("last-refresh").textContent = "Remote nodes sorted by open-order count";
    return;
  }
  if (action === "newest-detail") {
    loadRemoteNodeDetail(text((newest || {}).node_id)).catch((err) => {
      $("last-refresh").textContent = `Remote node detail failed: ${err.message}`;
    });
    return;
  }
  if (action === "request-status") {
    prepareRequestStatusCommand(text((newest || {}).node_id));
    return;
  }
  if (action === "clear") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = "heartbeat_desc";
    renderRemoteNodes();
    $("last-refresh").textContent = "Remote node filters cleared";
    return;
  }
  if (action === "export") {
    downloadRemoteNodesCsv().catch((err) => {
      $("last-refresh").textContent = `Remote nodes CSV export failed: ${err.message}`;
    });
  }
}

export function remoteNodesReportModel(nodes = [], filteredNodes = []) {
  const staleNodes = staleRemoteNodes(nodes);
  const alertNodes = (nodes || []).filter((node) => Number(node.alert_count || 0) > 0);
  const orderNodes = (nodes || []).filter((node) => Number(node.open_order_count || 0) > 0);
  const gatewayDown = (nodes || []).filter((node) => node.gateway_reachable === false);
  const feedIssueNodes = (nodes || []).filter((node) => ["bad", "error"].includes(text(node.market_data_status || "").toLowerCase()));
  const feedWarnNodes = (nodes || []).filter((node) => text(node.market_data_status || "").toLowerCase() === "warn");
  const staleData = (nodes || []).filter((node) => {
    const millis = timestampMillis(node.latest_data_time);
    return millis !== null && ((Date.now() - millis) / 1000) > 900;
  });
  const staleAccounts = (nodes || []).filter((node) => {
    const millis = timestampMillis(node.latest_account_time);
    return millis !== null && ((Date.now() - millis) / 1000) > 900;
  });
  const newest = newestRemoteNode(nodes);
  const alertTotal = (nodes || []).reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const orderTotal = (nodes || []).reduce((sum, node) => sum + Number(node.open_order_count || 0), 0);
  const statusCounts = countBy(nodes || [], "status");
  const issueCount = staleNodes.length + alertNodes.length + orderNodes.length + gatewayDown.length + feedIssueNodes.length + feedWarnNodes.length + staleData.length + staleAccounts.length;
  const status = !nodes.length ? "bad" : gatewayDown.length || staleNodes.length || feedIssueNodes.length ? "bad" : alertNodes.length || orderNodes.length || feedWarnNodes.length || staleData.length || staleAccounts.length ? "warn" : "ok";
  const headline = !nodes.length
    ? "No remote monitoring snapshots"
    : status === "ok"
      ? "Remote monitoring looks healthy"
      : status === "bad"
        ? "Remote monitoring needs attention"
        : "Remote monitoring has warnings";
  const note = nodes.length
    ? `${numberText(nodes.length, 0)} node${nodes.length === 1 ? "" : "s"} / ${numberText(filteredNodes.length, 0)} shown / ${countSummary(statusCounts)}`
    : "Publish sanitized status snapshots to populate remote monitoring.";
  const cards = [
    {
      status,
      label: "Report",
      title: headline,
      note,
    },
    {
      status: !nodes.length ? "idle" : staleNodes.length ? "bad" : "ok",
      label: "Heartbeat",
      title: staleNodes.length ? `${numberText(staleNodes.length, 0)} stale` : nodes.length ? "Fresh" : "No Nodes",
      note: newest ? `Newest ${text(newest.node_id)} ${timestampAgeLabel(newest.received_at || newest.generated_at)}.` : "No heartbeat loaded.",
    },
    {
      status: alertTotal ? "warn" : nodes.length ? "ok" : "idle",
      label: "Alerts",
      title: numberText(alertTotal, 0),
      note: alertNodes.length ? `${numberText(alertNodes.length, 0)} node${alertNodes.length === 1 ? "" : "s"} have alerts.` : "No remote alerts visible.",
    },
    {
      status: orderTotal ? "warn" : nodes.length ? "ok" : "bad",
      label: "Open Orders",
      title: numberText(orderTotal, 0),
      note: orderNodes.length ? "Verify broker state on the trading machine." : "No non-terminal remote order telemetry.",
    },
  ];
  const lines = [
    {
      status: nodes.length ? "ok" : "idle",
      title: "Coverage",
      detail: `${numberText(nodes.length, 0)} monitored node${nodes.length === 1 ? "" : "s"}; ${numberText(filteredNodes.length, 0)} visible after filters; statuses ${countSummary(statusCounts) || "none"}.`,
    },
    {
      status: !nodes.length ? "idle" : staleNodes.length ? "bad" : "ok",
      title: "Heartbeat",
      detail: newest ? `Newest node ${text(newest.node_id)} arrived ${timestampAgeLabel(newest.received_at || newest.generated_at)}; ${numberText(staleNodes.length, 0)} stale node${staleNodes.length === 1 ? "" : "s"}.` : "No heartbeat evidence loaded.",
    },
    {
      status: gatewayDown.length ? "bad" : nodes.length ? "ok" : "bad",
      title: "Gateway/API",
      detail: gatewayDown.length ? `${numberText(gatewayDown.length, 0)} node${gatewayDown.length === 1 ? "" : "s"} report Gateway/API unreachable: ${gatewayDown.slice(0, 4).map((node) => text(node.node_id)).join(", ")}.` : nodes.length ? "No remote Gateway/API blockers in latest snapshots." : "Gateway/API state unavailable.",
    },
    {
      status: alertTotal ? "warn" : nodes.length ? "ok" : "bad",
      title: "Alerts",
      detail: `${numberText(alertTotal, 0)} alert${alertTotal === 1 ? "" : "s"} across ${numberText(alertNodes.length, 0)} node${alertNodes.length === 1 ? "" : "s"}.`,
    },
    {
      status: orderTotal ? "warn" : nodes.length ? "ok" : "bad",
      title: "Orders",
      detail: `${numberText(orderTotal, 0)} non-terminal order event${orderTotal === 1 ? "" : "s"} across ${numberText(orderNodes.length, 0)} node${orderNodes.length === 1 ? "" : "s"}.`,
    },
    {
      status: feedIssueNodes.length ? "bad" : feedWarnNodes.length || staleData.length || staleAccounts.length ? "warn" : nodes.length ? "ok" : "bad",
      title: "Data And Account",
      detail: `${numberText(feedIssueNodes.length, 0)} feed issue${feedIssueNodes.length === 1 ? "" : "s"}; ${numberText(feedWarnNodes.length, 0)} feed warning${feedWarnNodes.length === 1 ? "" : "s"}; ${numberText(staleData.length, 0)} stale data timestamp${staleData.length === 1 ? "" : "s"}; ${numberText(staleAccounts.length, 0)} stale account timestamp${staleAccounts.length === 1 ? "" : "s"}.`,
    },
  ];
  const nextAction = !nodes.length
    ? "Start the status publisher or point the dashboard at the remote receiver."
    : gatewayDown.length || staleNodes.length
      ? "Open newest/stale node detail and verify the trading machine service state."
      : feedIssueNodes.length || feedWarnNodes.length
        ? "Open node detail and inspect the market-data health reason before treating the runner as disconnected."
      : alertNodes.length || orderNodes.length
        ? "Inspect node detail before issuing any remote controls."
        : "Remote monitoring is readable; export CSV or inspect detail when needed.";
  lines.push({
    status: !nodes.length ? "bad" : issueCount ? "warn" : "ok",
    title: "Next Action",
    detail: nextAction,
  });
  return { status, headline, note, cards, lines, newest };
}

export function remoteNodesReportText(model) {
  return [
    `Remote Monitor Report: ${model.headline}`,
    `Context: ${model.note}`,
    ...model.lines.map((item) => `${item.title}: ${item.detail}`),
  ].join("\n");
}

export function renderRemoteNodesReport(nodes = [], filteredNodes = []) {
  if (!$("remote-report-note") || !$("remote-report-cards") || !$("remote-report-body") || !$("remote-report-actions")) return;
  const model = remoteNodesReportModel(nodes, filteredNodes);
  state.remoteNodesReportText = remoteNodesReportText(model);
  $("remote-report-note").textContent = model.note;
  $("remote-report-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("remote-report-body").innerHTML = model.lines.map((item) => `
    <article class="performance-report-line status-${escapeHtml(item.status)}">
      <strong>${escapeHtml(item.title)}</strong>
      <span>${escapeHtml(item.detail)}</span>
    </article>
  `).join("");
  $("remote-report-actions").innerHTML = [
    `<button type="button" data-remote-report-action="copy">Copy Report</button>`,
    `<button type="button" class="secondary" data-remote-report-action="detail"${model.newest ? "" : " disabled"}>Open Newest Detail</button>`,
    `<button type="button" class="secondary" data-remote-report-action="status"${model.newest ? "" : " disabled"}>Prepare Status Check</button>`,
    `<button type="button" class="secondary" data-remote-report-action="export"${nodes.length ? "" : " disabled"}>Export Nodes CSV</button>`,
  ].join("");
}

export function handleRemoteReportAction(action) {
  const nodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const newest = newestRemoteNode(nodes);
  if (action === "copy") {
    copyText(state.remoteNodesReportText || "No remote monitor report loaded").then(() => {
      $("last-refresh").textContent = "Remote monitor report copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Remote report copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "detail") {
    loadRemoteNodeDetail(text((newest || {}).node_id)).catch((err) => {
      $("last-refresh").textContent = `Remote node detail failed: ${err.message}`;
    });
    return;
  }
  if (action === "status") {
    prepareRequestStatusCommand(text((newest || {}).node_id));
    return;
  }
  downloadRemoteNodesCsv().catch((err) => {
    $("last-refresh").textContent = `Remote nodes CSV export failed: ${err.message}`;
  });
}

export function remoteActionSummaryModel(nodes = [], filteredNodes = []) {
  const staleNodes = staleRemoteNodes(nodes);
  const alertNodes = (nodes || []).filter((node) => Number(node.alert_count || 0) > 0);
  const orderNodes = (nodes || []).filter((node) => Number(node.open_order_count || 0) > 0);
  const gatewayDown = (nodes || []).filter((node) => node.gateway_reachable === false);
  const feedIssueNodes = (nodes || []).filter((node) => ["bad", "error"].includes(text(node.market_data_status || "").toLowerCase()));
  const feedWarnNodes = (nodes || []).filter((node) => text(node.market_data_status || "").toLowerCase() === "warn");
  const staleData = (nodes || []).filter((node) => {
    const millis = timestampMillis(node.latest_data_time);
    return millis !== null && ((Date.now() - millis) / 1000) > 900;
  });
  const staleAccounts = (nodes || []).filter((node) => {
    const millis = timestampMillis(node.latest_account_time);
    return millis !== null && ((Date.now() - millis) / 1000) > 900;
  });
  const newest = newestRemoteNode(nodes);
  const activeFilters = [
    $("remote-filter-text").value ? `search ${$("remote-filter-text").value}` : "",
    $("remote-filter-status").value ? `status ${$("remote-filter-status").value}` : "",
    $("remote-filter-mode").value ? `mode ${$("remote-filter-mode").value}` : "",
  ].filter(Boolean);
  const issueCount = staleNodes.length + gatewayDown.length + alertNodes.length + orderNodes.length + feedIssueNodes.length + feedWarnNodes.length + staleData.length + staleAccounts.length;
  let status = "bad";
  let title = "No Remote Nodes";
  let note = "No authenticated status snapshots are loaded. Start the status publisher or point the dashboard at the receiver.";
  let primaryAction = "diagnostics";
  if (nodes.length) {
    status = staleNodes.length || gatewayDown.length || feedIssueNodes.length ? "bad" : alertNodes.length || orderNodes.length || feedWarnNodes.length || staleData.length || staleAccounts.length ? "warn" : "ok";
    if (staleNodes.length) {
      title = "Review Stale Heartbeats";
      note = `${numberText(staleNodes.length, 0)} node${staleNodes.length === 1 ? "" : "s"} have stale or missing heartbeats.`;
      primaryAction = "stale";
    } else if (gatewayDown.length) {
      title = "Review Gateway/API";
      note = `${numberText(gatewayDown.length, 0)} node${gatewayDown.length === 1 ? "" : "s"} report Gateway/API unreachable.`;
      primaryAction = "detail";
    } else if (feedIssueNodes.length || feedWarnNodes.length) {
      title = "Review Market Data";
      note = `${numberText(feedIssueNodes.length, 0)} feed issue${feedIssueNodes.length === 1 ? "" : "s"} / ${numberText(feedWarnNodes.length, 0)} feed warning${feedWarnNodes.length === 1 ? "" : "s"}.`;
      primaryAction = "detail";
    } else if (alertNodes.length) {
      title = "Review Remote Alerts";
      note = `${numberText(alertNodes.length, 0)} node${alertNodes.length === 1 ? "" : "s"} have alert rows in latest snapshots.`;
      primaryAction = "alerts";
    } else if (orderNodes.length) {
      title = "Review Open Orders";
      note = `${numberText(orderNodes.length, 0)} node${orderNodes.length === 1 ? "" : "s"} show non-terminal order telemetry.`;
      primaryAction = "orders";
    } else if (staleData.length || staleAccounts.length) {
      title = "Review Feed Freshness";
      note = `${numberText(staleData.length, 0)} stale data timestamp${staleData.length === 1 ? "" : "s"} / ${numberText(staleAccounts.length, 0)} stale account timestamp${staleAccounts.length === 1 ? "" : "s"}.`;
      primaryAction = "detail";
    } else if (activeFilters.length && filteredNodes.length < nodes.length) {
      title = "Filters Are Active";
      note = `${numberText(filteredNodes.length, 0)} of ${numberText(nodes.length, 0)} nodes shown; clear filters for the full cloud view.`;
      primaryAction = "clear";
    } else {
      title = "Remote Monitoring Ready";
      note = "Remote snapshots are fresh with no visible alerts, open orders, or Gateway/API blockers.";
      primaryAction = "report";
    }
  }
  const cards = [
    {
      label: "Inspect First",
      status,
      title,
      note,
    },
    {
      label: "Coverage",
      status: nodes.length ? filteredNodes.length ? "ok" : "warn" : "idle",
      title: `${numberText(filteredNodes.length, 0)} / ${numberText(nodes.length, 0)}`,
      note: activeFilters.length ? activeFilters.join(" / ") : "No remote filters are active.",
    },
    {
      label: "Heartbeat",
      status: nodes.length ? staleNodes.length ? "bad" : "ok" : "idle",
      title: staleNodes.length ? `${numberText(staleNodes.length, 0)} stale` : nodes.length ? "Fresh" : "No Nodes",
      note: newest ? `Newest ${text(newest.node_id)} ${timestampAgeLabel(newest.received_at || newest.generated_at)}.` : "No heartbeat loaded.",
    },
    {
      label: "Gateway/API",
      status: gatewayDown.length ? "bad" : nodes.length ? "ok" : "bad",
      title: gatewayDown.length ? `${numberText(gatewayDown.length, 0)} down` : nodes.length ? "Reachable" : "Unknown",
      note: gatewayDown.length ? gatewayDown.slice(0, 3).map((node) => text(node.node_id)).join(", ") : "No Gateway/API blocker in latest snapshots.",
    },
    {
      label: "Alerts / Orders",
      status: feedIssueNodes.length ? "bad" : alertNodes.length || orderNodes.length || feedWarnNodes.length ? "warn" : nodes.length ? "ok" : "bad",
      title: `${numberText(alertNodes.length, 0)} / ${numberText(orderNodes.length, 0)}`,
      note: `${numberText(issueCount, 0)} total issue bucket${issueCount === 1 ? "" : "s"}; ${numberText(feedIssueNodes.length + feedWarnNodes.length, 0)} market-data.`,
    },
    {
      label: "Next Move",
      status,
      title: primaryAction === "report" ? "Copy Report" : primaryAction === "clear" ? "Clear Filters" : "Drill Down",
      note: title,
    },
  ];
  const actionTitles = {
    stale: "Sort Stale",
    alerts: "Sort Alerts",
    orders: "Sort Orders",
    detail: "Open Detail",
    clear: "Clear Filters",
    report: "Remote Report",
    status: "Status Check",
    export: "Export CSV",
    control: "Control",
    diagnostics: "Diagnostics",
    runbook: "Cloud Runbook",
  };
  const actionLabels = {
    stale: "Primary",
    alerts: "Primary",
    orders: "Primary",
    detail: "Primary",
    clear: "Primary",
    report: "Primary",
    diagnostics: nodes.length ? "Setup" : "Primary",
    status: "Read-only",
    export: "CSV",
    control: "Queue",
    runbook: "Docs",
  };
  const actions = [
    primaryAction,
    "detail",
    "status",
    "report",
    "export",
    "control",
    "diagnostics",
    "runbook",
  ].filter((action, index, list) => list.indexOf(action) === index).map((action) => ({
    action,
    title: actionTitles[action] || action,
    label: actionLabels[action] || "Open",
    disabled: ["detail", "status", "report", "export"].includes(action) && !nodes.length,
  }));
  return { status, title, note, cards, actions, newest };
}

export function renderRemoteActionSummary(nodes = [], filteredNodes = []) {
  if (!$("remote-action-note") || !$("remote-action-cards") || !$("remote-action-actions")) return;
  const model = remoteActionSummaryModel(nodes, filteredNodes);
  $("remote-action-note").textContent = `${model.title}: ${model.note}`;
  $("remote-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("remote-action-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="${action.disabled ? "secondary" : ""}" data-remote-action="${escapeHtml(action.action)}"${action.disabled ? " disabled" : ""}>
      <span>${escapeHtml(action.title)}</span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

export function handleRemoteAction(action) {
  const nodes = (state.remoteNodes && state.remoteNodes.nodes) || [];
  const newest = newestRemoteNode(nodes);
  if (action === "stale" || action === "alerts" || action === "orders" || action === "clear") {
    $("remote-filter-text").value = "";
    $("remote-filter-status").value = "";
    $("remote-filter-mode").value = "";
    $("remote-filter-sort").value = action === "stale"
      ? "heartbeat_asc"
      : action === "alerts"
        ? "alerts_desc"
        : action === "orders"
          ? "orders_desc"
          : "heartbeat_desc";
    renderRemoteNodes();
    $("last-refresh").textContent = action === "clear" ? "Remote node filters cleared" : `Remote nodes sorted for ${action}`;
    return;
  }
  if (action === "detail") {
    loadRemoteNodeDetail(text((newest || {}).node_id)).catch((err) => {
      $("last-refresh").textContent = `Remote node detail failed: ${err.message}`;
    });
    return;
  }
  if (action === "status") {
    prepareRequestStatusCommand(text((newest || {}).node_id));
    return;
  }
  if (action === "report") {
    const target = $("remote-report-body") || $("remote-report-note");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
    return;
  }
  if (action === "export") {
    downloadRemoteNodesCsv().catch((err) => {
      $("last-refresh").textContent = `Remote nodes CSV export failed: ${err.message}`;
    });
    return;
  }
  if (action === "control") return navigateToOperationsLens("control");
  if (action === "runbook") {
    window.location.href = "/docs/cloud_monitoring_deployment.md";
    return;
  }
  navigateToOperationsLens("diagnostics");
  window.setTimeout(() => {
    const target = $("cloud-readiness-note") || $("gateway-list");
    if (target) target.scrollIntoView({ block: "start", behavior: "smooth" });
  }, 50);
}

export function renderRemoteNodes() {
  if (!$("remote-nodes-body") || !$("remote-nodes-note")) return;
  const payload = state.remoteNodes || {};
  const nodes = payload.nodes || [];
  const filteredNodes = filteredRemoteNodes(nodes);
  const alertTotal = nodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const openOrderTotal = nodes.reduce((sum, node) => sum + Number(node.open_order_count || 0), 0);
  renderRemoteNodeFilterOptions(nodes);
  $("remote-nodes-note").textContent = nodes.length
    ? `${numberText(filteredNodes.length, 0)} shown / ${numberText(nodes.length, 0)} monitored node${nodes.length === 1 ? "" : "s"} from ${numberText(payload.total, 0)} status snapshot${payload.total === 1 ? "" : "s"}`
    : "No remote status snapshots have been received yet";
  $("remote-node-count").textContent = numberText(nodes.length, 0);
  $("remote-node-status-summary").textContent = nodes.length ? countSummary(countBy(nodes, "status")) : "No snapshots received";
  $("remote-alert-count").textContent = numberText(alertTotal, 0);
  $("remote-alert-count").className = statusClass(alertTotal ? "warn" : nodes.length ? "ok" : "unknown");
  $("remote-alert-note").textContent = nodes.length ? `${numberText(alertTotal, 0)} alert${alertTotal === 1 ? "" : "s"} across monitored nodes` : "No remote alerts loaded";
  $("remote-open-order-count").textContent = numberText(openOrderTotal, 0);
  $("remote-open-order-count").className = statusClass(openOrderTotal ? "warn" : nodes.length ? "ok" : "unknown");
  $("remote-open-order-note").textContent = nodes.length ? `${numberText(openOrderTotal, 0)} non-terminal order event${openOrderTotal === 1 ? "" : "s"}` : "Sanitized order telemetry only";
  renderRemoteActionSummary(nodes, filteredNodes);
  renderRemoteNodesHealth(nodes, filteredNodes);
  renderRemoteNodesAssistant(nodes, filteredNodes);
  renderRemoteNodesReport(nodes, filteredNodes);
  $("remote-nodes-body").innerHTML = filteredNodes.length
    ? filteredNodes.map((node) => {
        const feed = remoteNodeMarketDataModel(node);
        const runNames = (node.runs || []).map((runItem) => text(runItem.id)).filter(Boolean);
        const runLabel = runNames.length
          ? `${numberText(node.run_count || runNames.length, 0)}: ${runNames.slice(0, 3).join(", ")}${runNames.length > 3 ? ", ..." : ""}`
          : numberText(node.run_count || 0, 0);
        return row([
          escapeHtml(node.node_id),
          statusText(node.status),
          `<span title="${escapeHtml(runNames.join(", ") || countSummary(node.run_status_counts || {}))}">${escapeHtml(runLabel)}</span>`,
          escapeHtml(timestampAgeLabel(node.received_at || node.generated_at)),
          statusText(node.gateway_reachable),
          escapeHtml(text(node.mode)),
          escapeHtml(money(node.final_equity)),
          escapeHtml(numberText(node.position_count, 0)),
          escapeHtml(numberText(node.open_order_count, 0)),
          escapeHtml(`${numberText(node.decision_count, 0)}D / ${numberText(node.order_count, 0)}O / ${numberText(node.fill_count, 0)}F / ${numberText(node.rejection_count, 0)}R`),
          escapeHtml(timestampAgeLabel(node.latest_account_time)),
          escapeHtml(timestampAgeLabel(node.latest_data_time)),
          `<span title="${escapeHtml(feed.detail)}">${statusText(feed.status)} ${escapeHtml(feed.title)}</span>`,
          escapeHtml(numberText(node.alert_count, 0)),
          `<span class="button-pair"><button type="button" class="secondary inspect-remote-node" data-node-id="${escapeHtml(node.node_id)}">Detail</button><button type="button" class="secondary request-remote-status" data-node-id="${escapeHtml(node.node_id)}">Status</button></span>`,
        ]);
      }).join("")
    : row([`<span class="muted">${nodes.length ? "No remote nodes match the current filters." : "No cloud monitoring snapshots yet. Post status with scripts/publish_status.py to this receiver or another authenticated endpoint."}</span>`, "", "", "", "", "", "", "", "", "", "", "", "", "", ""]);
}

export function renderRemoteNodesHealth(nodes = [], filteredNodes = []) {
  if (!$("remote-nodes-health")) return;
  const staleNodes = nodes.filter((node) => {
    const millis = timestampMillis(node.received_at || node.generated_at);
    if (millis === null) return true;
    return ((Date.now() - millis) / 1000) > 900;
  });
  const gatewayDown = nodes.filter((node) => node.gateway_reachable === false);
  const alertTotal = nodes.reduce((sum, node) => sum + Number(node.alert_count || 0), 0);
  const openOrders = nodes.reduce((sum, node) => sum + Number(node.open_order_count || 0), 0);
  const feedIssueNodes = nodes.filter((node) => ["bad", "error"].includes(text(node.market_data_status || "").toLowerCase()));
  const feedWarnNodes = nodes.filter((node) => text(node.market_data_status || "").toLowerCase() === "warn");
  const staleData = nodes.filter((node) => {
    const millis = timestampMillis(node.latest_data_time);
    if (millis === null) return false;
    return ((Date.now() - millis) / 1000) > 900;
  });
  const staleAccounts = nodes.filter((node) => {
    const millis = timestampMillis(node.latest_account_time);
    if (millis === null) return false;
    return ((Date.now() - millis) / 1000) > 900;
  });
  const newest = nodes.slice().sort((left, right) => (
    (timestampMillis(right.received_at || right.generated_at) || 0) - (timestampMillis(left.received_at || left.generated_at) || 0)
  ))[0] || null;
  const cards = [
    {
      status: !nodes.length ? "warn" : staleNodes.length ? "bad" : "ok",
      label: "Heartbeat",
      title: nodes.length ? staleNodes.length ? `${numberText(staleNodes.length, 0)} stale` : "Fresh" : "No Nodes",
      note: newest ? `Newest ${text(newest.node_id)} ${timestampAgeLabel(newest.received_at || newest.generated_at)}.` : "No remote snapshots received.",
    },
    {
      status: gatewayDown.length ? "bad" : nodes.length ? "ok" : "warn",
      label: "Gateway",
      title: gatewayDown.length ? `${numberText(gatewayDown.length, 0)} down` : nodes.length ? "Reachable" : "Unknown",
      note: gatewayDown.length ? gatewayDown.slice(0, 3).map((node) => node.node_id).join(", ") : "No remote Gateway/API blockers in latest snapshots.",
    },
    {
      status: alertTotal ? "warn" : nodes.length ? "ok" : "warn",
      label: "Alerts",
      title: numberText(alertTotal, 0),
      note: alertTotal ? "Inspect Remote Node Detail for latest sanitized alerts." : "No remote alerts in latest node snapshots.",
    },
    {
      status: openOrders ? "warn" : nodes.length ? "ok" : "warn",
      label: "Open Orders",
      title: numberText(openOrders, 0),
      note: openOrders ? "Verify broker state on the local trading machine before issuing controls." : "No non-terminal remote order events.",
    },
    {
      status: feedIssueNodes.length ? "bad" : feedWarnNodes.length || staleData.length || staleAccounts.length ? "warn" : nodes.length ? "ok" : "warn",
      label: "Feed/Account",
      title: feedIssueNodes.length ? "Feed Issue" : feedWarnNodes.length || staleData.length || staleAccounts.length ? "Review" : nodes.length ? "Current" : "Unknown",
      note: `${numberText(feedIssueNodes.length, 0)} feed issue / ${numberText(feedWarnNodes.length, 0)} feed warning / ${numberText(staleAccounts.length, 0)} stale account timestamp${staleAccounts.length === 1 ? "" : "s"}.`,
    },
    {
      status: filteredNodes.length ? "ok" : nodes.length ? "warn" : "bad",
      label: "Filtered View",
      title: `${numberText(filteredNodes.length, 0)} / ${numberText(nodes.length, 0)}`,
      note: filteredNodes.length ? "The table below matches the current filters." : "Clear filters to see monitored nodes.",
    },
  ];
  $("remote-nodes-health").innerHTML = cards.map((card) => `
    <div class="health-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function renderRemoteNodeRunHealth(detail = {}, runs = [], activity = []) {
  if (!$("remote-node-run-health")) return;
  const selected = Boolean(detail.node_id);
  const artifactRows = remoteRunArtifactEvidenceRows(runs);
  const artifactExisting = artifactRows.reduce((sum, item) => sum + Number(item.evidence.existing_count || 0), 0);
  const artifactMissing = artifactRows.reduce((sum, item) => sum + Number(item.evidence.missing_count || 0), 0);
  const statusCounts = countBy(runs, "status");
  const failedCount = runs.filter((runItem) => ["failed", "timeout", "error", "rejected"].includes(text(runItem.status).toLowerCase())).length;
  const completedCount = runs.filter((runItem) => text(runItem.status).toLowerCase() === "completed").length;
  const totalDecisions = runs.reduce((sum, runItem) => sum + Number(runItem.decisions || 0), 0);
  const totalOrders = runs.reduce((sum, runItem) => sum + Number(runItem.orders || 0), 0);
  const totalFills = runs.reduce((sum, runItem) => sum + Number(runItem.fills || 0), 0);
  const totalRejections = runs.reduce((sum, runItem) => sum + Number(runItem.rejections || 0), 0);
  const latestDecisionRun = runs
    .map((runItem) => ({ runItem, millis: timestampMillis(runItem.last_decision_time) }))
    .filter((item) => item.millis !== null)
    .sort((left, right) => right.millis - left.millis)[0] || null;
  const latestEquityRun = runs.find((runItem) => finiteNumber(runItem.final_equity) !== null) || null;
  const cards = [
    {
      status: !selected ? "idle" : !runs.length ? "warn" : failedCount ? "bad" : "ok",
      label: "Latest Runs",
      title: runs.length ? `${numberText(completedCount, 0)} completed` : selected ? "No Runs" : "Select Node",
      note: runs.length ? `${numberText(runs.length, 0)} bounded run summaries; ${countSummary(statusCounts)}.` : "Select a node or wait for published run summaries.",
    },
    {
      status: !selected ? "bad" : activity.length ? "ok" : runs.length ? "warn" : "bad",
      label: "Activity",
      title: `${numberText(totalDecisions, 0)}D / ${numberText(totalOrders, 0)}O / ${numberText(totalFills, 0)}F`,
      note: activity.length
        ? `${numberText(activity.length, 0)} sanitized decisions/orders/fills are visible below.`
        : "No bounded decision, order, or fill rows in latest run summaries.",
    },
    {
      status: totalRejections ? "warn" : runs.length ? "ok" : "warn",
      label: "Rejections",
      title: numberText(totalRejections, 0),
      note: totalRejections ? "Review remote activity locally before issuing controls." : "No rejection count in latest remote run summaries.",
    },
    {
      status: !selected ? "bad" : latestDecisionRun ? "ok" : runs.length ? "warn" : "bad",
      label: "Latest Decision",
      title: latestDecisionRun ? timestampAgeLabel(latestDecisionRun.runItem.last_decision_time) : "n/a",
      note: latestDecisionRun
        ? `${text(latestDecisionRun.runItem.id)} published the newest decision timestamp.`
        : "Run summaries did not publish last_decision_time.",
    },
    {
      status: latestEquityRun ? "ok" : runs.length ? "warn" : "bad",
      label: "Equity Snapshot",
      title: latestEquityRun ? money(latestEquityRun.final_equity) : "n/a",
      note: latestEquityRun
        ? `${text(latestEquityRun.id)} / cash ${money(latestEquityRun.final_cash)} / positions ${numberText(latestEquityRun.position_count, 0)}.`
        : "Run summaries did not publish final equity.",
    },
    {
      status: !selected ? "bad" : artifactRows.length ? artifactMissing ? "warn" : "ok" : runs.length ? "warn" : "bad",
      label: "Artifact Evidence",
      title: artifactRows.length ? `${numberText(artifactExisting, 0)} files` : "none",
      note: artifactRows.length
        ? `${numberText(artifactRows.length, 0)} run${artifactRows.length === 1 ? "" : "s"} published bounded artifact evidence; ${numberText(artifactMissing, 0)} expected file${artifactMissing === 1 ? "" : "s"} missing.`
        : "Status publisher did not include artifact evidence for these latest runs.",
    },
    {
      status: "warn",
      label: "Cloud Boundary",
      title: "Sanitized",
      note: "Remote detail shows bounded summaries only; raw logs, credentials, and private strategy diagnostics stay local.",
    },
  ];
  $("remote-node-run-health").innerHTML = cards.map((card) => `
    <div class="health-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function renderRemoteNodeBoundaryPolicy(detail = {}) {
  if (!$("remote-node-boundary-note") || !$("remote-node-boundary-cards")) return;
  const policy = detail.boundary_policy || {};
  const hasPolicy = Boolean(policy.name);
  const excluded = policy.excluded || [];
  const included = policy.included || [];
  $("remote-node-boundary-note").textContent = hasPolicy
    ? text(policy.retention_note || "Remote detail is bounded and sanitized before display.")
    : "Remote detail uses bounded sanitized status summaries.";
  const cards = [
    {
      status: detail.node_id ? "ok" : "warn",
      label: "Boundary",
      title: hasPolicy ? "Sanitized" : "Not Loaded",
      note: hasPolicy ? text(policy.scope) : "Select a node to load the remote detail boundary.",
    },
    {
      status: hasPolicy ? "ok" : "warn",
      label: "Snapshot Limit",
      title: numberText(policy.snapshot_limit || detail.limit || 0, 0),
      note: `${numberText(policy.latest_run_limit || 0, 0)} latest runs / ${numberText(policy.recent_event_limit_per_stream || 0, 0)} events per stream.`,
    },
    {
      status: hasPolicy ? "ok" : "warn",
      label: "Artifact Evidence",
      title: `${numberText(policy.artifact_file_limit_per_run || 0, 0)} files`,
      note: "Names, categories, sizes, modified times, and row counts only.",
    },
    {
      status: "warn",
      label: "Excluded",
      title: `${numberText(excluded.length, 0)} classes`,
      note: excluded.slice(0, 4).join(", ") || "Raw logs, credentials, and private diagnostics stay local.",
    },
    {
      status: hasPolicy ? "ok" : "warn",
      label: "Included",
      title: `${numberText(included.length, 0)} classes`,
      note: included.slice(0, 3).join(", ") || "Bounded summary rows only.",
    },
  ];
  $("remote-node-boundary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function renderRemoteNodeDetail() {
  if (!$("remote-node-detail-summary") || !$("remote-node-detail-note")) return;
  const detail = state.remoteNodeDetail || {};
  const summary = detail.summary || {};
  const runs = detail.runs || [];
  const alerts = detail.alerts || [];
  const history = detail.history || [];
  const activity = remoteNodeActivityEvents(runs);
  const artifactRows = remoteRunArtifactEvidenceRows(runs);
  const artifactFileCount = artifactRows.reduce((sum, item) => sum + Number(item.evidence.existing_count || 0), 0);
  const artifactRowCount = artifactRows.reduce((sum, item) => sum + Number(item.evidence.jsonl_row_count || 0), 0);
  const activityFilter = remoteDetailActivityFilter();
  const filteredActivity = activityFilter ? activity.filter((event) => event.type === activityFilter) : activity;
  const latestActivity = activity[0] || {};
  renderRemoteDetailAssistant(detail, {
    activity,
    artifactRows,
    filteredActivity,
  });
  renderRemoteNodeHealthReport(detail, {
    activity,
    artifactRows,
    filteredActivity,
  });
  $("remote-node-detail-note").textContent = detail.node_id
    ? `${text(detail.node_id)} / ${numberText(detail.total, 0)} stored status snapshot${detail.total === 1 ? "" : "s"}`
    : "Select a remote node to inspect bounded sanitized status detail";
  if ($("export-remote-node-detail-csv")) {
    $("export-remote-node-detail-csv").disabled = !detail.node_id;
  }
  $("remote-detail-snapshot-count").textContent = numberText(detail.count || 0, 0);
  $("remote-detail-snapshot-note").textContent = detail.node_id
    ? `${numberText(detail.count || 0, 0)} loaded / ${numberText(detail.total || 0, 0)} stored`
    : "Select a node";
  $("remote-detail-activity-count").textContent = numberText(filteredActivity.length, 0);
  $("remote-detail-activity-note").textContent = activity.length
    ? `${text(latestActivity.type)} ${timestampAgeLabel(eventTimestamp(latestActivity))}`
    : "No sanitized activity in latest runs";
  $("remote-detail-alert-count").textContent = numberText(alerts.length, 0);
  $("remote-detail-alert-count").className = statusClass(alerts.length ? "warn" : detail.node_id ? "ok" : "unknown");
  $("remote-detail-alert-note").textContent = detail.node_id
    ? `${numberText(alerts.length, 0)} latest alert${alerts.length === 1 ? "" : "s"}`
    : "No node selected";
  if ($("remote-detail-artifact-count")) {
    $("remote-detail-artifact-count").textContent = numberText(artifactFileCount, 0);
    $("remote-detail-artifact-count").className = statusClass(artifactRows.length ? "ok" : detail.node_id ? "warn" : "unknown");
  }
  if ($("remote-detail-artifact-note")) {
    $("remote-detail-artifact-note").textContent = artifactRows.length
      ? `${numberText(artifactRows.length, 0)} run${artifactRows.length === 1 ? "" : "s"} / ${numberText(artifactRowCount, 0)} JSONL row${artifactRowCount === 1 ? "" : "s"}`
      : detail.node_id ? "No artifact evidence published by latest run summaries" : "No node selected";
  }
  renderRemoteNodeRunHealth(detail, runs, activity);
  renderRemoteNodeBoundaryPolicy(detail);
  const summaryFeed = remoteNodeMarketDataModel(summary);
  const pairs = detail.node_id
    ? [
        ["Market Feed", `${summaryFeed.title}: ${summaryFeed.detail}`],
        ["Node", text(detail.node_id)],
        ["Status", text(summary.status)],
        ["Heartbeat", timestampAgeLabel(summary.received_at || summary.generated_at)],
        ["Gateway", text(summary.gateway_reachable)],
        ["Mode", text(summary.mode)],
        ["Equity", money(summary.final_equity)],
        ["Positions", numberText(summary.position_count, 0)],
        ["Open Orders", numberText(summary.open_order_count, 0)],
        ["Latest Account", timestampAgeLabel(summary.latest_account_time)],
        ["Latest Data", timestampAgeLabel(summary.latest_data_time)],
      ]
    : [["Next", "Click Detail on a Remote Nodes row."]];
  $("remote-node-detail-summary").innerHTML = pairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
  $("remote-node-activity-body").innerHTML = filteredActivity.length
    ? filteredActivity.map((event) => row([
        escapeHtml(eventTimestamp(event)),
        escapeHtml(text(event.run_id)),
        statusText(event.type),
        escapeHtml(text(eventSymbol(event))),
        statusText(eventStatus(event, event.type)),
        escapeHtml(eventDetail(event)),
      ])).join("")
    : row([`<span class="muted">${activity.length ? "No remote activity matches this filter." : "No sanitized recent decisions, orders, or fills in the latest run summaries."}</span>`, "", "", "", "", ""]);
  $("remote-node-runs-body").innerHTML = runs.length
    ? runs.map((runItem) => {
        const feed = remoteNodeMarketDataModel(runItem);
        return row([
          escapeHtml(runItem.id),
          statusText(runItem.status),
          escapeHtml(text(runItem.mode)),
          escapeHtml(money(runItem.final_equity)),
          escapeHtml(`${numberText(runItem.decisions, 0)}D / ${numberText(runItem.orders, 0)}O / ${numberText(runItem.fills, 0)}F / ${numberText(runItem.rejections, 0)}R`),
          `<span title="${escapeHtml(feed.detail)}">${statusText(feed.status)} ${escapeHtml(feed.title)}</span>`,
          escapeHtml(timestampAgeLabel(runItem.last_decision_time)),
        ]);
      }).join("")
    : row([`<span class="muted">No latest run summaries in this node snapshot.</span>`, "", "", "", "", "", ""]);
  if ($("remote-node-artifacts-note")) {
    $("remote-node-artifacts-note").textContent = artifactRows.length
      ? `${numberText(artifactRows.length, 0)} bounded run artifact evidence summar${artifactRows.length === 1 ? "y" : "ies"}; categories, file names, row counts, and sizes only.`
      : "No artifact evidence was published for the selected node.";
  }
  if ($("remote-node-artifacts-body")) {
    $("remote-node-artifacts-body").innerHTML = artifactRows.length
      ? artifactRows.map(({ run: runItem, evidence }) => row([
          escapeHtml(runItem.id),
          escapeHtml(`${numberText(evidence.existing_count, 0)} / ${numberText(evidence.expected_count, 0)}`),
          escapeHtml(numberText(evidence.jsonl_row_count, 0)),
          escapeHtml(remoteArtifactCategorySummary(evidence)),
          escapeHtml(bytes(evidence.total_bytes)),
          escapeHtml(timestampAgeLabel(evidence.latest_modified_at)),
          escapeHtml(remoteArtifactMissingNames(evidence)),
        ])).join("")
      : row([`<span class="muted">${runs.length ? "Latest runs do not include artifact evidence yet. Update scripts/publish_status.py on the publishing node." : "No latest run summaries in this node snapshot."}</span>`, "", "", "", "", "", ""]);
  }
  $("remote-node-alerts-body").innerHTML = alerts.length
    ? alerts.map((alert) => row([
        statusText(alert.level === "warn" ? "warn" : alert.level),
        escapeHtml(alert.kind),
        escapeHtml(alert.message),
      ])).join("")
    : row([`<span class="muted">No latest alerts in this node snapshot.</span>`, "", ""]);
  $("remote-node-history-body").innerHTML = history.length
    ? history.map((item) => {
        const remoteLabel = item.remote_latest_event
          ? `${text(item.remote_latest_event)} ${text(item.remote_latest_action)} ${text(item.remote_latest_status)}`
          : "none";
        return row([
          escapeHtml(item.received_at),
          statusText(item.status),
          statusText(item.gateway_reachable),
          escapeHtml(numberText(item.alert_count, 0)),
          jsonDrilldown(item.run_status_counts || {}, countSummary(item.run_status_counts || {})),
          escapeHtml(remoteLabel),
        ]);
      }).join("")
    : row([`<span class="muted">No bounded history loaded for this node.</span>`, "", "", "", "", ""]);
}

export function renderHistory() {
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
          jsonDrilldown(snapshot.run_status_counts || {}, countSummary(snapshot.run_status_counts || {})),
          jsonDrilldown(snapshot.supervisor_status_counts || {}, countSummary(snapshot.supervisor_status_counts || {})),
          escapeHtml(remoteLabel),
        ]);
      }).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", ""]);
}

export function renderCommands() {
  $("commands-body").innerHTML = state.commands.length
    ? state.commands.map((command) => row([
        escapeHtml(command.command_id),
        escapeHtml(command.node_id),
        escapeHtml(command.action),
        jsonDrilldown(command.params || {}, objectSummary(command.params || {})),
        statusText(command.status),
        escapeHtml(command.created_at),
        command.status === "pending"
          ? `<button type="button" class="secondary cancel-command" data-command-id="${escapeHtml(command.command_id)}" data-node-id="${escapeHtml(command.node_id)}">Cancel</button>`
          : "",
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", ""]);
}

export function renderResults() {
  $("results-body").innerHTML = state.results.length
    ? state.results.slice(-20).reverse().map((result) => row([
        escapeHtml(result.command_id),
        escapeHtml(result.action),
        statusText(result.status),
        escapeHtml(result.received_at),
        jsonDrilldown(result.result || result.error || {}, objectSummary(result.result || result.error || {})),
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", ""]);
}

export function renderCommandAudit() {
  const events = (state.commandAudit && state.commandAudit.events) || [];
  const integrity = (state.commandAudit && state.commandAudit.integrity) || {};
  const retention = (state.commandAudit && state.commandAudit.retention_policy) || {};
  const signatureText = integrity.signature_status
    ? `signature ${integrity.signature_status}${integrity.signature_key_env ? ` via ${integrity.signature_key_env}` : ""}; signed ${numberText(integrity.signed_records, 0)} / unsigned ${numberText(integrity.unsigned_records, 0)}`
    : "signature not loaded";
  const integrityText = integrity.status
    ? `Integrity ${integrity.status}; checked ${numberText(integrity.checked_records, 0)} hashed records; ${signatureText}`
    : "Integrity not loaded";
  const retentionText = retention.status
    ? ` Retention ${text(retention.status)}: ${text(retention.summary)}`
    : "";
  $("command-audit-note").textContent = events.length
    ? `${events.length} latest sanitized command audit events. ${integrityText}${retentionText}`
    : `No command audit events have been recorded yet. ${integrityText}${retentionText}`;
  renderCommandAuditHealth(events, integrity, retention);
  $("command-audit-body").innerHTML = events.length
    ? events.slice(-30).reverse().map((event) => row([
        escapeHtml(event.audited_at),
        escapeHtml(event.event),
        escapeHtml(event.node_id),
        escapeHtml(event.command_id),
        escapeHtml(event.action),
        statusText(event.status || (event.error ? "rejected" : "")),
        event.row_signature ? statusText("ok") : `<span class="muted">${integrity.signature_status === "disabled" ? "disabled" : "unsigned"}</span>`,
        escapeHtml(Array.isArray(event.param_keys) ? event.param_keys.join(", ") : ""),
        event.error ? `<span class="status-bad">${escapeHtml(event.error)}</span>` : "",
      ])).join("")
    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", ""]);
}

export function renderCommandAuditHealth(events = [], integrity = {}, retention = {}) {
  if (!$("command-audit-health")) return;
  const latest = events.slice().reverse()[0] || events[0] || null;
  const status = text(integrity.status || "unknown");
  const signatureStatus = text(integrity.signature_status || "disabled");
  const checked = Number(integrity.checked_records || 0);
  const signed = Number(integrity.signed_records || 0);
  const unsigned = Number(integrity.unsigned_records || 0);
  const legacy = Number(integrity.legacy_records || 0);
  const signatureTotal = signed + unsigned;
  const retentionStatus = text(retention.status || "not_loaded");
  const cards = [
    {
      status: status === "ok" ? "ok" : checked ? "bad" : "warn",
      label: "Hash Chain",
      title: status,
      note: checked ? `${numberText(checked, 0)} checked; ${numberText(legacy, 0)} legacy rows.` : "No hash-chained records checked yet.",
    },
    {
      status: signatureStatus === "ok" ? "ok" : signatureStatus === "disabled" ? "warn" : "bad",
      label: "Signature",
      title: signatureStatus,
      note: signatureTotal
        ? `${numberText(signed, 0)} signed / ${numberText(unsigned, 0)} unsigned${integrity.signature_key_env ? ` via ${text(integrity.signature_key_env)}` : ""}.`
        : "HMAC signing is disabled or no signed records exist yet.",
    },
    {
      status: latest ? latest.error ? "bad" : latest.status === "rejected" ? "warn" : "ok" : "warn",
      label: "Latest Event",
      title: latest ? text(latest.event || latest.action || "event") : "none",
      note: latest
        ? `${text(latest.node_id)} / ${text(latest.action)} / ${text(latest.status || "recorded")} / ${timestampAgeLabel(latest.audited_at)}`
        : "No sanitized command audit rows are loaded.",
    },
    {
      status: retentionStatus === "blocked" ? "bad" : "warn",
      label: "Retention",
      title: retentionStatus,
      note: retention.summary || "Export CSV or use ops/cloud/sync-command-audit.example.sh for dry-run-first off-host retention.",
    },
    {
      status: retention.off_host_retention_verified ? "ok" : "warn",
      label: "Off-host",
      title: retention.off_host_retention_verified ? "Verified" : text(retention.off_host_status || "not_verified"),
      note: retention.off_host_sync_helper
        ? `Use ${text(retention.off_host_sync_helper)}; provider retention examples must be verified in a real account.`
        : "No off-host retention policy is loaded.",
    },
  ];
  $("command-audit-health").innerHTML = cards.map((card) => `
    <div class="health-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

