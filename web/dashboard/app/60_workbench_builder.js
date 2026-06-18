import {
  $,
  bytes,
  escapeHtml,
  interval,
  jsonDrilldown,
  kvRows,
  money,
  navigateToDataLens,
  navigateToRunsLens,
  navigateToView,
  navigateToWorkbenchLens,
  numberText,
  objectSummary,
  pctText,
  row,
  state,
  statusClass,
  statusText,
  text,
} from "./00_core.js";
import { renderHelpWorkbenchQuickstart } from "./10_help.js";
import {
  attachDatasetOptionMetadata,
  configDateRangePayload,
  latestWorkbenchRunForDraft,
  renderConfigBrokerBoundary,
  renderConfigDataQuality,
  renderConfigPluginBoundary,
  renderConfigPluginFieldHelp,
  renderWorkbenchGuide,
  renderWorkbenchHome,
  renderWorkbenchPluginBoundary,
  selectedConfigDatasets,
  selectedConfigPlugin,
  selectedDataReadiness,
  workbenchDatasetRows,
} from "./20_workbench_foundation.js";
import { finiteNumber, timestampAgeLabel, timestampMillis } from "./30_runtime_core.js";
import { normalizedFillSide, positionSnapshotDrilldown } from "./31_performance_math.js";
import { equityChart, rangeLabel, timeRangeLabel } from "./34_charts.js";
import { approvalPreviewCanApprove, approvalPreviewCommand, countBy, countSummary, shellQuote, topCountEntries } from "./40_data_catalog.js";
import {
  copyText,
  downloadDraftsCsv,
  downloadRunArtifactsJson,
  loadConfigArtifacts,
  loadRunArtifacts,
  loadRunDetail,
  openWorkbenchResultPerformance,
  runConfigDraft,
  validateDrafts,
} from "./90_bootstrap.js";

export function replaceOptions(select, options) {
  const currentValues = select.multiple
    ? new Set(Array.from(select.selectedOptions).map((option) => option.value))
    : new Set([select.value]);
  select.innerHTML = options.map((option) => (
    `<option value="${escapeHtml(option.value)}"${option.description ? ` title="${escapeHtml(option.description)}"` : ""}>${escapeHtml(option.label)}</option>`
  )).join("");
  options.forEach((option, index) => {
    if (option.dataset && select.options[index]) attachDatasetOptionMetadata(select.options[index], option.dataset);
  });
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
}

export function configFormOptionRows(field, options) {
  const source = field.options_source || "";
  if (source === "plugins") {
    return (options.plugins || []).map((plugin) => ({
      value: plugin.id,
      label: `${plugin.label} (${plugin.visibility || plugin.status})`,
    }));
  }
  if (source === "modes") return (options.modes || []).map((mode) => ({ value: mode, label: mode }));
  if (source === "risk_presets") {
    return (options.risk_presets || []).map((preset) => ({
      value: preset.id,
      label: `${preset.label} - ${preset.description}`,
    }));
  }
  if (source === "datasets") {
    return workbenchDatasetRows().map((dataset) => ({
      value: dataset.path,
      label: `${text(dataset.symbol)} ${text(dataset.bar_size)} [${text(dataset.quality_status)}/${text(dataset.storage_contract_status)}] - ${dataset.path}`,
      dataset,
    }));
  }
  return (field.options || []).map((option) => ({
    value: option.value ?? option.id ?? option,
    label: option.description
      ? `${option.label ?? option.value ?? option.id ?? option} - ${option.description}`
      : option.label ?? option.value ?? option.id ?? option,
    description: option.description || "",
  }));
}

export function configSectionMetadataById() {
  const sections = (state.configOptions && state.configOptions.form_sections) || [];
  return Object.fromEntries(sections.map((section) => [section.id, section]));
}

export function configSectionTitle(section, metadataById = configSectionMetadataById()) {
  return text((metadataById[section] || {}).label || section);
}

export function configSectionHelp(section, metadataById = configSectionMetadataById()) {
  return text((metadataById[section] || {}).help || "");
}

export function configSectionOrder(section, metadataById = configSectionMetadataById()) {
  const value = Number((metadataById[section] || {}).order);
  return Number.isFinite(value) ? value : 999;
}

export function configFieldTitle(field, label) {
  const meta = [];
  if (field.required) meta.push("Required");
  if (field.unit) meta.push(`Unit: ${field.unit}`);
  if (field.advanced) meta.push("Advanced");
  const metaHtml = meta.length
    ? `<span class="field-meta">${meta.map((item) => `<span>${escapeHtml(item)}</span>`).join("")}</span>`
    : "";
  return `<span class="field-title"><span>${label}</span>${metaHtml}</span>`;
}

export function configFieldDescription(field) {
  const description = field.description
    ? `<small class="field-description">${escapeHtml(field.description)}</small>`
    : "";
  const help = field.help ? `<small>${escapeHtml(field.help)}</small>` : "";
  return `${description}${help}`;
}

export function configFieldInputAffix(field, inputHtml) {
  const prefix = field.prefix ? `<span class="field-affix">${escapeHtml(field.prefix)}</span>` : "";
  const suffix = field.suffix || field.unit;
  const suffixHtml = suffix ? `<span class="field-affix">${escapeHtml(suffix)}</span>` : "";
  if (!prefix && !suffixHtml) return inputHtml;
  return `<span class="field-input-row">${prefix}${inputHtml}${suffixHtml}</span>`;
}

export function renderConfigField(field) {
  const id = escapeHtml(field.id);
  const label = escapeHtml(field.label || field.name || field.id);
  const title = configFieldTitle(field, label);
  const help = configFieldDescription(field);
  const pluginAttr = field.plugin_id ? ` data-plugin-id="${escapeHtml(field.plugin_id)}"` : "";
  const cls = [
    field.kind === "checkbox" ? "checkbox-field" : "",
    field.plugin_id ? "plugin-strategy-field" : "",
    field.wide ? "wide-field" : "",
    field.advanced ? "advanced-field" : "",
  ].filter(Boolean).join(" ");
  const fieldPath = field.plugin_id && field.name ? `strategy.${field.name}` : field.name || field.id;
  const validation = `<small class="field-validation-message" data-field-error-for="${escapeHtml(fieldPath)}" hidden></small>`;
  if (field.kind === "select") {
    const multiple = field.multiple ? " multiple" : "";
    const size = field.size ? ` size="${escapeHtml(String(field.size))}"` : "";
    const required = field.required ? " required" : "";
    return `<label class="${escapeHtml(cls)}"${pluginAttr}>${title}<select id="${id}"${multiple}${size}${required}></select>${help}${validation}</label>`;
  }
  if (field.kind === "checkbox") {
    return `<label class="${escapeHtml(cls)}"${pluginAttr}><input id="${id}" type="checkbox">${title}${help}${validation}</label>`;
  }
  const type = field.kind === "date" ? "date" : field.kind === "time" ? "time" : field.kind === "number" ? "number" : "text";
  const attrs = [
    `id="${id}"`,
    `type="${escapeHtml(type)}"`,
    field.placeholder ? `placeholder="${escapeHtml(String(field.placeholder))}"` : "",
    field.min !== undefined ? `min="${escapeHtml(String(field.min))}"` : "",
    field.max !== undefined ? `max="${escapeHtml(String(field.max))}"` : "",
    field.step !== undefined ? `step="${escapeHtml(String(field.step))}"` : "",
    field.required ? "required" : "",
  ].filter(Boolean).join(" ");
  return `<label class="${escapeHtml(cls)}"${pluginAttr}>${title}${configFieldInputAffix(field, `<input ${attrs}>`)}${help}${validation}</label>`;
}

export function updatePluginStrategyFields() {
  const selectedPluginId = $("config-plugin") ? $("config-plugin").value : "";
  for (const field of document.querySelectorAll(".plugin-strategy-field")) {
    const visible = !field.dataset.pluginId || field.dataset.pluginId === selectedPluginId;
    field.hidden = !visible;
  }
}

export function renderConfigFormSchema() {
  const fields = (state.configOptions && state.configOptions.form_schema) || [];
  const container = $("config-form-fields");
  if (!container || container.dataset.rendered === "true" || !fields.length) return;
  const sectionMetadata = configSectionMetadataById();
  const sections = [];
  for (const field of fields) {
    const section = field.section || "settings";
    let group = sections.find((item) => item.section === section);
    if (!group) {
      group = { section, fields: [] };
      sections.push(group);
    }
    group.fields.push(field);
  }
  sections.sort((left, right) => (
    configSectionOrder(left.section, sectionMetadata) - configSectionOrder(right.section, sectionMetadata)
    || left.section.localeCompare(right.section)
  ));
  container.innerHTML = sections.map((group) => `
    <fieldset id="config-section-${escapeHtml(group.section)}" class="config-field-section">
      <legend>${escapeHtml(configSectionTitle(group.section, sectionMetadata))}</legend>
      <p>${escapeHtml(configSectionHelp(group.section, sectionMetadata))}</p>
      <div class="config-field-grid">
        ${group.fields.map(renderConfigField).join("")}
      </div>
    </fieldset>
  `).join("");
  container.dataset.rendered = "true";
}

export function setConfigFieldDefault(el, value) {
  if (!el || value === undefined) return;
  if (el.type === "checkbox") {
    el.checked = Boolean(value);
    return;
  }
  if (el instanceof HTMLSelectElement && el.multiple) {
    const selected = new Set(Array.isArray(value) ? value.map(text) : text(value).split(",").map((item) => item.trim()).filter(Boolean));
    let changed = false;
    for (const option of el.options) {
      option.selected = selected.has(option.value);
      changed = changed || option.selected;
    }
    if (changed) return;
  }
  if (!el.value) {
    el.value = String(value);
  }
}

export function configFieldValue(id) {
  const el = $(id);
  if (el instanceof HTMLSelectElement && el.multiple) {
    return Array.from(el.selectedOptions).map((option) => option.value).join(",");
  }
  return el ? el.value : "";
}

export function renderConfigBuilder() {
  const options = state.configOptions || {};
  const defaults = options.defaults || {};
  const runActions = (options.run_actions || []).map((action) => ({ value: action, label: action }));
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const draftOptions = drafts.map((draft) => ({
    value: draft.draft_id,
    label: `${draft.draft_id} - ${text(draft.mode)}`,
  }));
  renderConfigFormSchema();
  for (const field of options.form_schema || []) {
    if (field.kind === "select" && $(field.id)) {
      replaceOptions($(field.id), configFormOptionRows(field, options));
    }
  }
  if (runActions.length) replaceOptions($("config-run-action"), runActions);
  replaceOptions($("config-run-draft"), draftOptions);

  const defaultFields = Object.fromEntries((options.form_schema || [])
    .filter((field) => field.default_key)
    .map((field) => [field.id, defaults[field.default_key]]));
  for (const field of options.form_schema || []) {
    if (field.default !== undefined && defaultFields[field.id] === undefined) {
      defaultFields[field.id] = field.default;
    }
  }
  defaultFields["config-run-max-steps"] = defaults.max_steps;
  defaultFields["config-run-timeout"] = defaults.run_timeout_seconds;
  for (const [id, value] of Object.entries(defaultFields)) {
    setConfigFieldDefault($(id), value);
  }
  renderConfigDataQuality();
  updatePluginStrategyFields();
  renderWorkbenchHome();
  renderWorkbenchGuide();
  renderWorkbenchPluginBoundary();
  renderConfigPluginBoundary();
  renderConfigPluginFieldHelp();
  renderConfigBrokerBoundary();
  renderWorkbenchBuilderAssistant();
  renderConfigBuilderReadiness();
  renderConfigCompatibility();
  renderConfigValidationMessages();

  const draft = state.configDraft;
  if (!draft) {
    const draftErrors = normalizeConfigDraftErrors(state.configDraftErrors || []);
    $("config-validation").innerHTML = draftErrors.length
      ? `<span class="status-bad">invalid</span> <span class="muted">${escapeHtml(draftErrors.join("; "))}</span>`
      : `<span class="muted">Select datasets, review quality/alignment, then Generate.</span>`;
    $("config-yaml").value = "";
    $("config-commands").innerHTML = `<dt>Next</dt><dd><span class="muted">Generate a draft to get local validate/replay commands.</span></dd>`;
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
        `<dt>${escapeHtml(name)}</dt><dd><span class="command-line"><span class="mono">${escapeHtml(command)}</span><button type="button" class="secondary copy-command" data-command="${escapeHtml(command)}">Copy</button></span></dd>`
      )).join("")
    : "";
  renderConfigAlignment(draft.alignment || {});
}

export function configFieldLabel(path) {
  const selectedPlugin = selectedConfigPlugin();
  const strategyMatch = String(path || "").match(/^strategy\.([A-Za-z_][A-Za-z0-9_]*)$/);
  if (strategyMatch) {
    const field = (selectedPlugin.strategy_fields || []).find((item) => item.name === strategyMatch[1]);
    return field ? text(field.label || field.name) : `Strategy ${strategyMatch[1]}`;
  }
  const formField = ((state.configOptions || {}).form_schema || []).find((field) => field.name === path || field.id === path);
  return formField ? text(formField.label || formField.name || formField.id) : text(path);
}

export function configErrorPath(message) {
  const raw = String(message || "");
  const strategyMatch = raw.match(/\bstrategy\.([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (strategyMatch) return `strategy.${strategyMatch[1]}`;
  const pathMatch = raw.match(/\b(metadata|data|runner|account|risk|costs|session|execution)\.([A-Za-z_][A-Za-z0-9_]*)\b/);
  if (pathMatch) return `${pathMatch[1]}.${pathMatch[2]}`;
  if (/plugin/i.test(raw)) return "plugin";
  if (/dataset|data|quality|alignment|timestamp|file/i.test(raw)) return "data";
  if (/risk|order|notional|exposure|cash|quantity/i.test(raw)) return "risk";
  if (/session|timezone|weekday/i.test(raw)) return "session";
  if (/runner|output|mode/i.test(raw)) return "runner";
  return "draft";
}

export function normalizeConfigDraftErrors(errorOrMessages) {
  const rawMessages = Array.isArray(errorOrMessages)
    ? errorOrMessages
    : [errorOrMessages && errorOrMessages.message ? errorOrMessages.message : errorOrMessages];
  const normalized = [];
  for (const raw of rawMessages) {
    const withoutStatus = String(raw || "")
      .replace(/^\d{3}\s+[A-Za-z ]+:\s*/, "")
      .trim();
    for (const part of withoutStatus.split(/\s*;\s*/)) {
      const message = part.trim();
      if (message && !normalized.includes(message)) normalized.push(message);
    }
  }
  return normalized;
}

export function validationMessageGroups() {
  const messages = normalizeConfigDraftErrors(state.configDraftErrors || []);
  const groups = new Map();
  for (const message of messages) {
    const path = configErrorPath(message);
    if (!groups.has(path)) groups.set(path, []);
    groups.get(path).push(message);
  }
  return Array.from(groups.entries()).map(([path, messagesForPath]) => ({ path, messages: messagesForPath }));
}

export function clearFieldValidationMessages() {
  for (const label of document.querySelectorAll(".field-has-error")) {
    label.classList.remove("field-has-error");
  }
  for (const item of document.querySelectorAll(".field-validation-message")) {
    item.textContent = "";
    item.hidden = true;
  }
}

export function renderFieldValidationMessages(groups) {
  clearFieldValidationMessages();
  for (const group of groups) {
    const messageEl = Array.from(document.querySelectorAll(".field-validation-message"))
      .find((item) => item instanceof HTMLElement && item.dataset.fieldErrorFor === group.path);
    if (!(messageEl instanceof HTMLElement)) continue;
    messageEl.textContent = group.messages.join("; ");
    messageEl.hidden = false;
    const label = messageEl.closest("label");
    if (label) label.classList.add("field-has-error");
  }
}

export function renderConfigValidationMessages() {
  if (!$("config-validation-messages") || !$("config-validation-message-note")) return;
  const groups = validationMessageGroups();
  renderFieldValidationMessages(groups);
  const total = groups.reduce((count, group) => count + group.messages.length, 0);
  $("config-validation-message-note").textContent = total
    ? `${numberText(total, 0)} message${total === 1 ? "" : "s"} from draft validation`
    : "No validation messages";
  $("config-validation-messages").innerHTML = groups.length
    ? groups.map((group) => `
        <div class="validation-message-card">
          <span>${escapeHtml(group.path)}</span>
          <strong>${escapeHtml(configFieldLabel(group.path))}</strong>
          <small>${escapeHtml(group.messages.join("; "))}</small>
        </div>
      `).join("")
    : `<div class="empty-card"><span>Ready</span><strong>No Draft Errors</strong><small>Generate a draft to run server-side validation for selected data and plugin fields.</small></div>`;
}

export function handleConfigDraftError(error) {
  state.configDraft = null;
  state.configDraftErrors = normalizeConfigDraftErrors(error);
  renderConfigBuilder();
  $("last-refresh").textContent = `Config draft failed: ${error.message}`;
}

export function renderConfigBuilderReadiness() {
  if (!$("config-builder-readiness")) return;
  const selected = selectedConfigDatasets();
  const dataReadiness = selectedDataReadiness(selected);
  const plugin = selectedConfigPlugin();
  const mode = $("config-mode") ? $("config-mode").value : "";
  const dateRange = configDateRangePayload();
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const riskValues = [
    finiteNumber($("config-max-orders") && $("config-max-orders").value),
    finiteNumber($("config-max-notional") && $("config-max-notional").value),
    finiteNumber($("config-max-exposure") && $("config-max-exposure").value),
  ];
  const costValues = [
    finiteNumber($("config-slippage") && $("config-slippage").value),
    finiteNumber($("config-commission") && $("config-commission").value),
  ];
  const draft = state.configDraft || {};
  const draftValid = draft.validation ? Boolean(draft.validation.valid) : false;
  const cards = [
    {
      status: dataReadiness.status,
      title: numberText(selected.length, 0),
      label: "Data",
      note: selected.length
        ? dataReadiness.issueCount
          ? dataReadiness.reviewNote
          : "Selected datasets pass catalog quality and metadata checks."
        : "Choose one or more Data Library files.",
    },
    {
      status: alignment.dataset_count ? Number(alignment.warning_count || 0) ? "warn" : "ok" : selected.length ? "warn" : "idle",
      title: alignment.dataset_count ? numberText(alignment.common_timestamp_count, 0) : "Preview",
      label: "Alignment",
      note: alignment.dataset_count
        ? `${numberText(alignment.dataset_count, 0)} dataset${alignment.dataset_count === 1 ? "" : "s"}; ${pctText(alignment.common_coverage_pct)} common coverage.`
        : "Preview alignment before trusting a replay window.",
    },
    {
      status: plugin.id ? plugin.visibility === "public_example" ? "warn" : "ok" : "bad",
      title: text(plugin.label || plugin.id),
      label: "Plugin",
      note: plugin.visibility === "public_example"
        ? "Public example plugin demonstrates wiring only."
        : text(plugin.boundary || "Private/local plugin metadata loaded from registry."),
    },
    {
      status: mode ? "ok" : "idle",
      title: text(mode),
      label: "Mode",
      note: dateRange.start || dateRange.end
        ? `Range ${dateRange.start || "first bar"} to ${dateRange.end || "last bar"}.`
        : "No date range set; replay uses each selected file's full history.",
    },
    {
      status: riskValues.every((value) => value !== null && value > 0) ? "ok" : "bad",
      title: text($("config-risk-preset") && $("config-risk-preset").value),
      label: "Risk",
      note: `Orders ${text($("config-max-orders") && $("config-max-orders").value)}, notional ${money($("config-max-notional") && $("config-max-notional").value)}, exposure ${pctText(Number($("config-max-exposure") && $("config-max-exposure").value) * 100)}.`,
    },
    {
      status: costValues.every((value) => value !== null && value >= 0) ? "ok" : "bad",
      title: `${numberText($("config-slippage") && $("config-slippage").value, 2)} / ${numberText($("config-commission") && $("config-commission").value, 2)}`,
      label: "Costs",
      note: "Simulated slippage and commission basis points.",
    },
    {
      status: draft.yaml ? draftValid ? "ok" : "warn" : "idle",
      title: draft.yaml ? draftValid ? "Valid" : "Review" : "Not Generated",
      label: "Draft",
      note: draft.yaml
        ? draft.saved_path ? `Saved to ${text(draft.saved_path)}.` : "Generated draft is not saved."
        : "Generate a draft to get YAML and local commands.",
    },
  ];
  $("config-builder-readiness").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function renderWorkbenchBuilderAssistant() {
  if (!$("workbench-builder-assistant-title") || !$("workbench-builder-assistant-cards") || !$("workbench-builder-assistant-actions")) return;
  const selected = selectedConfigDatasets();
  const plugin = selectedConfigPlugin();
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const draft = state.configDraft || {};
  const draftErrors = normalizeConfigDraftErrors(state.configDraftErrors || []);
  const savedPath = draft.saved_path || "";
  const draftValid = draft.validation ? Boolean(draft.validation.valid) : false;
  const dataReadiness = selectedDataReadiness(selected);
  const allowQualityWarnings = $("config-allow-quality-warnings") ? $("config-allow-quality-warnings").checked : false;
  const qualityBlocked = Boolean(dataReadiness.qualityIssues.length && !allowQualityWarnings);
  const dataReviewBlocked = qualityBlocked || dataReadiness.contractIssues.length > 0;
  let title = "Select Saved Data";
  let note = "Choose one or more Data Library files before generating a replay or simulated-paper draft.";
  if (selected.length && !alignment.dataset_count) {
    title = "Preview Alignment Next";
    note = `${numberText(selected.length, 0)} dataset${selected.length === 1 ? "" : "s"} selected; preview timestamp overlap before trusting the replay window.`;
  } else if (selected.length && alignment.dataset_count && !draft.yaml) {
    title = dataReviewBlocked ? "Review Data Readiness" : "Ready To Generate Draft";
    note = dataReviewBlocked
      ? `${dataReadiness.summary}; inspect quality and storage metadata before generating.`
      : `Alignment has ${numberText(alignment.common_timestamp_count, 0)} common timestamps; generate a public-safe draft next.`;
  } else if (draft.yaml && !draftValid) {
    title = "Draft Needs Fixes";
    note = draftErrors.length ? draftErrors.join("; ") : "Generated draft is invalid; review validation messages and field highlights.";
  } else if (draftValid && !savedPath) {
    title = "Draft Valid But Unsaved";
    note = "Enable save or generate a saved draft before running it from the Run lens.";
  } else if (draftValid) {
    title = "Draft Ready To Run";
    note = `${text(savedPath)} is valid; open Run to validate saved drafts or execute replay/simulated paper.`;
  }
  $("workbench-builder-assistant-title").textContent = title;
  $("workbench-builder-assistant-note").textContent = note;
  const cards = [
    {
      status: selected.length ? dataReviewBlocked ? "warn" : "ok" : "idle",
      label: "Data",
      title: numberText(selected.length, 0),
      note: selected.length
        ? dataReadiness.issueCount ? dataReadiness.reviewNote : "Selected files are ready for review."
        : "No saved files selected.",
    },
    {
      status: plugin.id ? plugin.visibility === "public_example" ? "warn" : "ok" : "idle",
      label: "Plugin",
      title: text(plugin.label || plugin.id),
      note: plugin.id ? text(plugin.visibility || plugin.boundary || "registry loaded") : "No plugin selected.",
    },
    {
      status: alignment.dataset_count ? Number(alignment.warning_count || 0) ? "warn" : "ok" : selected.length ? "warn" : "idle",
      label: "Alignment",
      title: alignment.dataset_count ? numberText(alignment.common_timestamp_count, 0) : "Preview",
      note: alignment.dataset_count ? `${pctText(alignment.common_coverage_pct)} common coverage.` : "Alignment has not been previewed.",
    },
    {
      status: draft.yaml ? draftValid ? "ok" : "bad" : "warn",
      label: "Draft",
      title: draft.yaml ? draftValid ? "Valid" : "Invalid" : "None",
      note: draft.yaml ? savedPath ? "Saved draft path exists." : "Generated draft is not saved." : "Generate YAML and local commands.",
    },
    {
      status: draftValid && savedPath ? "ok" : draftValid ? "warn" : "idle",
      label: "Run",
      title: draftValid && savedPath ? "Ready" : "Not Ready",
      note: draftValid && savedPath ? "Open Run to execute or validate saved drafts." : "Run requires a valid saved draft.",
    },
  ];
  $("workbench-builder-assistant-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const actions = [
    {
      action: "data",
      title: selected.length ? "Change Selected Data" : "Select Data",
      note: selected.length ? "Open Data Library to add or replace saved files." : "Browse saved historical datasets.",
      label: "Data",
      disabled: false,
    },
    {
      action: "alignment",
      title: "Preview Alignment",
      note: selected.length ? "Check common timestamps across selected files." : "Select data before previewing alignment.",
      label: "Preview",
      disabled: !selected.length,
    },
    {
      action: draft.yaml && !draftValid ? "preview-draft" : "generate",
      title: draft.yaml && !draftValid ? "Preview Draft Again" : "Generate Draft",
      note: selected.length && plugin.id ? "Build YAML and server-side validation output." : "Select data and plugin before generating.",
      label: draft.yaml && !draftValid ? "Preview" : "Generate",
      disabled: !selected.length || !plugin.id,
    },
    {
      action: "run",
      title: "Open Run",
      note: draftValid && savedPath ? "Run or validate the saved draft." : "Generate and save a valid draft first.",
      label: "Run",
      disabled: !(draftValid && savedPath),
    },
  ];
  $("workbench-builder-assistant-actions").innerHTML = actions.map((action) => `
    <button type="button" class="workbench-builder-assistant-action ${action.disabled ? "secondary" : ""}" data-workbench-builder-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>
        <strong>${escapeHtml(action.title)}</strong>
        <small>${escapeHtml(action.note)}</small>
      </span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

export function handleWorkbenchBuilderAssistantAction(action) {
  if (action === "data") {
    navigateToDataLens("browse");
    return;
  }
  if (action === "alignment") {
    $("config-preview-alignment").click();
    return;
  }
  if (action === "preview-draft") {
    $("config-preview-draft").click();
    return;
  }
  if (action === "run") {
    navigateToWorkbenchLens("run");
    return;
  }
  $("config-generate-draft").click();
}

export function selectedRunDraft() {
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  return ((state.configDrafts && state.configDrafts.drafts) || [])
    .find((draft) => draft.draft_id === selectedDraftId) || null;
}

export function selectedRunDraftValidation() {
  const draft = selectedRunDraft();
  return draft ? draftValidationById()[draft.draft_id] || null : null;
}

export function selectedRunDraftCommands() {
  const draft = selectedRunDraft();
  if (!draft || !draft.path) return {};
  const configPath = shellQuote(draft.path);
  const maxSteps = finiteNumber($("config-run-max-steps") && $("config-run-max-steps").value);
  const maxStepsArg = maxSteps !== null && maxSteps > 0 ? ` --max-steps ${Math.round(maxSteps)}` : "";
  return {
    validate: `python3 live/plugin_runner.py --config ${configPath} --validate-only`,
    replay: `python3 live/plugin_runner.py --config ${configPath} --mode replay${maxStepsArg}`,
    simulated_paper: `python3 live/plugin_runner.py --config ${configPath} --mode simulated-paper${maxStepsArg}`,
  };
}

export function runCommandBoundaryNote(action) {
  if (action === "validate") return "Validation only; imports the plugin and checks config without replaying bars or submitting orders.";
  if (action === "replay") return "Replay only; evaluates saved bars and writes artifacts without broker orders.";
  if (action === "simulated_paper") return "Local simulated paper; uses runner accounting and artifacts without touching a broker.";
  return "Choose validate, replay, or simulated paper before running a saved draft.";
}

export function renderWorkbenchRunCommands() {
  if (!$("workbench-run-command-note") || !$("workbench-run-commands") || !$("workbench-run-command-cards")) return;
  const draft = selectedRunDraft();
  const commands = selectedRunDraftCommands();
  const validation = selectedRunDraftValidation();
  const runAction = $("config-run-action") ? $("config-run-action").value : "";
  const commandEntries = Object.entries(commands);
  $("workbench-run-command-note").textContent = draft
    ? `${text(draft.draft_id)} local commands${validation ? validation.valid ? " / validation passed" : " / validation failed" : " / validation unchecked"}`
    : "Select a saved draft to copy local plugin-runner commands.";
  const cards = [
    {
      status: draft ? "ok" : "idle",
      title: draft ? text(draft.draft_id) : "No draft",
      label: "Selected Draft",
      note: draft && draft.path ? `Local YAML: ${text(draft.path)}` : "Generate and save a draft before running.",
    },
    {
      status: validation ? validation.valid ? "ok" : "bad" : draft ? "warn" : "waiting",
      title: validation ? validation.valid ? "Passed" : "Failed" : "Unchecked",
      label: "Validation",
      note: validation
        ? validation.valid
          ? "The saved draft passed server validation."
          : "Fix validation errors before trusting a replay or simulated-paper run."
        : "Run Validate Drafts or choose validate before replaying.",
    },
    {
      status: commands[runAction] ? "ok" : draft ? "warn" : "waiting",
      title: text(runAction || "n/a"),
      label: "Selected Action",
      note: commands[runAction]
        ? "The highlighted command below matches the Run form action."
        : "Choose an available local plugin-runner action.",
    },
    {
      status: runAction === "validate" || runAction === "replay" ? "ok" : runAction === "simulated_paper" ? "warn" : "waiting",
      title: runAction === "validate" || runAction === "replay" ? "No broker orders" : runAction === "simulated_paper" ? "Simulated only" : "Choose action",
      label: "Boundary",
      note: runCommandBoundaryNote(runAction),
    },
  ];
  $("workbench-run-command-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-run-commands").innerHTML = commandEntries.length
    ? commandEntries.map(([name, command]) => {
        const recommended = (runAction === "validate" && name === "validate")
          || (runAction === "replay" && name === "replay")
          || (runAction === "simulated_paper" && name === "simulated_paper");
        const label = recommended ? `${name} (selected)` : name;
        return `<dt>${escapeHtml(label)}</dt><dd><span class="command-line"><span class="mono">${escapeHtml(command)}</span><button type="button" class="secondary copy-run-command" data-command="${escapeHtml(command)}">Copy</button></span></dd>`;
      }).join("")
    : `<dt>Next</dt><dd><span class="muted">Generate and save a draft in Builder, then select it here.</span></dd>`;
}

export function configCompatibilityNext(cards) {
  const blocked = cards.find((card) => card.status === "bad");
  if (blocked) return blocked.next;
  const warning = cards.find((card) => card.status === "warn");
  if (warning) return warning.next;
  return "Ready to validate or run the selected draft with the configured public-safe runner.";
}

export function renderConfigCompatibility() {
  if (!$("config-compatibility-cards") || !$("config-compatibility-note") || !$("config-compatibility-detail")) return;
  const options = state.configOptions || {};
  const selected = selectedConfigDatasets();
  const plugin = selectedConfigPlugin();
  const visibility = plugin.visibility || plugin.status || "";
  const strategyFields = plugin.strategy_fields || [];
  const alignment = state.alignmentPreview || (state.configDraft && state.configDraft.alignment) || {};
  const qualityIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.quality_status).toLowerCase()));
  const contractIssues = selected.filter((dataset) => ["warn", "bad"].includes(text(dataset.storage_contract_status).toLowerCase()));
  const allowQualityWarnings = $("config-allow-quality-warnings") ? $("config-allow-quality-warnings").checked : false;
  const barSizes = Array.from(new Set(selected.map((dataset) => text(dataset.bar_size)).filter((value) => value !== "n/a")));
  const sources = Array.from(new Set(selected.map((dataset) => text(dataset.source)).filter((value) => value !== "n/a")));
  const schemasPresent = [
    options.config_schema_version,
    options.form_schema_version,
    options.guide_schema_version,
  ].every((value) => finiteNumber(value) !== null);
  const generatedDraft = state.configDraft || {};
  const generatedValid = generatedDraft.validation ? Boolean(generatedDraft.validation.valid) : null;
  const savedDraft = selectedRunDraft();
  const savedValidation = selectedRunDraftValidation();
  const runAction = $("config-run-action") ? $("config-run-action").value : "";
  const alignmentWarnings = Number(alignment.warning_count || (alignment.warnings || []).length || 0);
  const commonTimestamps = Number(alignment.common_timestamp_count || 0);
  const cards = [
    {
      status: schemasPresent ? "ok" : "bad",
      title: `v${text(options.config_schema_version)} / form v${text(options.form_schema_version)}`,
      label: "Schema",
      note: `Guide v${text(options.guide_schema_version)}; ${numberText((options.form_schema || []).length, 0)} fields.`,
      next: "Refresh the dashboard server so config_options includes all schema versions.",
    },
    {
      status: plugin.id ? visibility === "public_example" ? "warn" : "ok" : "idle",
      title: text(plugin.label || plugin.id),
      label: "Plugin",
      note: `${text(visibility)}; ${numberText(strategyFields.length, 0)} public-safe field${strategyFields.length === 1 ? "" : "s"}.`,
      next: plugin.id
        ? "Public examples prove wiring only; choose an ignored local plugin registry entry for real private logic."
        : "Choose a configured Workbench plugin.",
    },
    {
      status: !selected.length ? "idle" : contractIssues.some((dataset) => text(dataset.storage_contract_status).toLowerCase() === "bad") ? "bad" : (qualityIssues.length && !allowQualityWarnings) || contractIssues.length ? "warn" : "ok",
      title: selected.length ? numberText(selected.length, 0) : "None",
      label: "Data",
      note: selected.length
        ? `${barSizes.join(", ") || "unknown bars"} from ${sources.join(", ") || "unknown source"}; ${numberText(qualityIssues.length, 0)} quality / ${numberText(contractIssues.length, 0)} contract issue${contractIssues.length === 1 ? "" : "s"}.`
        : "No saved datasets selected.",
      next: selected.length
        ? "Review Selected Data Quality and storage-contract metadata before trusting a replay draft."
        : "Choose one or more scanned saved-data files.",
    },
    {
      status: alignment.dataset_count
        ? commonTimestamps > 0 ? alignmentWarnings ? "warn" : "ok" : "bad"
        : selected.length ? "warn" : "idle",
      title: alignment.dataset_count ? numberText(commonTimestamps, 0) : "Preview",
      label: "Alignment",
      note: alignment.dataset_count
        ? `${pctText(alignment.common_coverage_pct)} common coverage; ${numberText(alignmentWarnings, 0)} warning${alignmentWarnings === 1 ? "" : "s"}.`
        : "Alignment has not been previewed for the selected files.",
      next: alignment.dataset_count
        ? "Fix date ranges or dataset choices until the replay window has common timestamps."
        : "Preview alignment before generating or trusting a replay draft.",
    },
    {
      status: generatedDraft.yaml ? generatedValid ? "ok" : "bad" : savedDraft ? savedValidation ? savedValidation.valid ? "ok" : "bad" : "warn" : "warn",
      title: generatedDraft.yaml ? generatedValid ? "Generated Valid" : "Generated Invalid" : savedDraft ? text(savedDraft.draft_id) : "No Draft",
      label: "Draft",
      note: generatedDraft.yaml
        ? generatedDraft.saved_path ? "Current generated YAML is saved locally." : "Current generated YAML is not saved locally."
        : savedDraft
          ? savedValidation ? savedValidation.valid ? "Selected saved draft passed validation." : "Selected saved draft has validation errors." : "Selected saved draft has not been validated in this session."
          : "No generated or selected saved draft is ready.",
      next: generatedDraft.yaml
        ? generatedValid ? "Save and run the draft, or inspect the generated local commands." : "Fix generated draft validation errors before running."
        : savedDraft ? "Click Validate Drafts, then run the selected draft." : "Generate and save a draft from the selected data.",
    },
    {
      status: savedDraft && runAction ? savedValidation ? savedValidation.valid ? "ok" : "bad" : "warn" : "warn",
      title: runAction || "No Action",
      label: "Run",
      note: savedDraft
        ? `${text(savedDraft.mode)} draft selected; action=${text(runAction)}.`
        : "No saved draft is selected in Run Draft.",
      next: savedDraft
        ? "Validate the selected draft before running replay or simulated paper."
        : "Save a generated draft, then select it under Run Draft.",
    },
  ];
  $("config-compatibility-note").textContent = configCompatibilityNext(cards);
  $("config-compatibility-cards").innerHTML = cards.map((card) => `
    <div class="health-card compatibility-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const detailPairs = [
    ["Schema Versions", `config=${text(options.config_schema_version)}, form=${text(options.form_schema_version)}, guide=${text(options.guide_schema_version)}`],
    ["Plugin Spec", text(plugin.spec)],
    ["Plugin Registry Paths", (options.plugin_registry_paths || []).join("; ") || "none"],
    ["Strategy Fields", strategyFields.length ? strategyFields.map((field) => `${field.name}:${field.kind}`).join(", ") : "none"],
    ["Selected Bar Sizes", barSizes.join(", ") || "none"],
    ["Selected Sources", sources.join(", ") || "none"],
    ["Selected Contract Issues", contractIssues.length ? contractIssues.map((dataset) => `${text(dataset.symbol)} ${text(dataset.bar_size)} ${text(dataset.storage_contract_status)}`).join("; ") : "none"],
    ["Selected Paths", selected.map((dataset) => dataset.path).join("\n") || "none"],
    ["Alignment Window", alignment.dataset_count ? rangeLabel(alignment.common_first_timestamp, alignment.common_last_timestamp) : "not previewed"],
    ["Saved Draft Validation", savedDraft ? savedValidation ? savedValidation.valid ? "valid" : `invalid: ${(savedValidation.errors || []).join("; ")}` : "not checked" : "no saved draft selected"],
    ["Next Action", configCompatibilityNext(cards)],
  ];
  $("config-compatibility-detail").innerHTML = detailPairs.map(([key, value]) => (
    `<dt>${escapeHtml(key)}</dt><dd>${escapeHtml(value)}</dd>`
  )).join("");
}

export function renderConfigLivePanels() {
  renderConfigDataQuality();
  updatePluginStrategyFields();
  renderWorkbenchPluginBoundary();
  renderConfigPluginBoundary();
  renderConfigPluginFieldHelp();
  renderWorkbenchBuilderAssistant();
  renderConfigBuilderReadiness();
  renderConfigCompatibility();
  renderWorkbenchGuide();
  renderWorkbenchHome();
  renderHelpWorkbenchQuickstart();
}

export function configPluginStrategyPayload() {
  const payload = {};
  const selectedPluginId = $("config-plugin") ? $("config-plugin").value : "";
  const fields = ((state.configOptions || {}).form_schema || [])
    .filter((field) => field.plugin_id === selectedPluginId);
  for (const field of fields) {
    const el = $(field.id);
    if (!el) continue;
    payload[field.name] = field.kind === "checkbox" ? el.checked : el.value;
  }
  return payload;
}

export function renderConfigAlignment(alignment) {
  const warnings = alignment.warnings || [];
  $("config-alignment-note").innerHTML = alignment.dataset_count
    ? warnings.length
      ? `<span class="status-warn">${warnings.length} warning${warnings.length === 1 ? "" : "s"}</span>`
      : `<span class="status-ok">aligned</span>`
    : "Select datasets, then preview alignment";
  if (!alignment.dataset_count) {
    $("config-alignment").innerHTML = `<dt>Next</dt><dd>Select one or more datasets and click Preview Alignment before generating a runnable draft.</dd>`;
    renderWorkbenchGuide();
    return;
  }
  const rows = alignment.rows || [];
  const symbolSummary = rows.map((item) => (
    `${text(item.symbol)} quality=${text(item.quality_status)} quality_warnings=${numberText(item.quality_warning_count, 0)} rows=${numberText(item.rows, 0)} ts=${numberText(item.timestamp_count, 0)} step=${interval(item.median_interval_seconds)}`
  )).join("; ");
  const pairs = [
    ["Datasets", numberText(alignment.dataset_count, 0)],
    ["Symbols", (alignment.symbols || []).join(", ")],
    ["Filter Range", alignment.filter_start || alignment.filter_end ? timeRangeLabel(alignment.filter_start, alignment.filter_end) : "Full file history"],
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
  renderConfigBuilderReadiness();
  renderConfigCompatibility();
  renderWorkbenchGuide();
}

export function draftValidationById() {
  const rows = (state.draftValidations && state.draftValidations.validations) || [];
  return Object.fromEntries(rows.map((rowItem) => [rowItem.draft_id, rowItem]));
}

export function draftValidationBadge(draftId) {
  const validation = draftValidationById()[draftId];
  if (!validation) return `<span class="muted">not checked</span>`;
  if (validation.valid) return statusText("ok");
  const errors = validation.errors || [];
  const suffix = errors.length ? ` (${errors.length})` : "";
  const title = errors.length ? ` title="${escapeHtml(errors.join("; "))}"` : "";
  return `<span class="status-bad"${title}>invalid${escapeHtml(suffix)}</span>`;
}

export function renderDraftValidations() {
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
    : `<dt>Next</dt><dd><span class="muted">Save a generated draft locally, then click Validate Drafts.</span></dd>`;
}

export function renderWorkbenchTriage() {
  if (!$("workbench-triage-cards") || !$("workbench-triage-note")) return;
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const runs = (state.configRuns && state.configRuns.runs) || [];
  const validations = (state.draftValidations && state.draftValidations.validations) || [];
  const validationByDraft = draftValidationById();
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  const selectedDraft = drafts.find((draft) => draft.draft_id === selectedDraftId) || null;
  const selectedValidation = selectedDraftId ? validationByDraft[selectedDraftId] : null;
  const latestRun = latestWorkbenchRunForDraft(selectedDraftId);
  const artifacts = state.configArtifacts || {};
  const invalidCount = validations.filter((item) => !item.valid).length;
  const uncheckedCount = drafts.filter((draft) => !validationByDraft[draft.draft_id]).length;
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "timeout");
  const completedRuns = runs.filter((run) => run.status === "completed");
  const selectedHasArtifacts = Boolean(latestRun && latestRun.artifact_path);
  let nextStatus = "idle";
  let nextTitle = "Generate";
  let nextNote = "Select saved data and generate a local draft.";
  if (selectedDraft) {
    if (!selectedValidation) {
      nextStatus = "warn";
      nextTitle = "Validate";
      nextNote = `${selectedDraft.draft_id} has not been checked in this session.`;
    } else if (!selectedValidation.valid) {
      nextStatus = "bad";
      nextTitle = "Fix Draft";
      nextNote = `${selectedDraft.draft_id} has validation errors.`;
    } else if (!latestRun) {
      nextStatus = "warn";
      nextTitle = "Run";
      nextNote = `${selectedDraft.draft_id} is valid and ready for replay or simulated paper.`;
    } else if (latestRun.status !== "completed") {
      nextStatus = "warn";
      nextTitle = "Inspect Run";
      nextNote = `${latestRun.run_id || selectedDraft.draft_id} ended with ${text(latestRun.status)}.`;
    } else if (!selectedHasArtifacts && !artifacts.run_id && !artifacts.draft_id) {
      nextStatus = "warn";
      nextTitle = "Open Results";
      nextNote = "Completed run exists; load artifacts to inspect performance.";
    } else {
      nextStatus = "ok";
      nextTitle = "Review";
      nextNote = "Artifacts are available for performance, orders, fills, and logs.";
    }
  }
  const cards = [
    {
      status: drafts.length ? uncheckedCount ? "warn" : "ok" : "idle",
      title: numberText(drafts.length, 0),
      label: "Drafts",
      note: drafts.length
        ? `${numberText(uncheckedCount, 0)} unchecked; ${numberText(invalidCount, 0)} invalid.`
        : "No saved drafts; generate one from the Config Builder.",
    },
    {
      status: validations.length ? invalidCount ? "bad" : "ok" : drafts.length ? "warn" : "idle",
      title: validations.length ? `${numberText(validations.length - invalidCount, 0)} valid` : "Not Checked",
      label: "Validation",
      note: validations.length
        ? `${numberText(validations.length, 0)} checked at ${text((state.draftValidations || {}).generated_at)}.`
        : "Click Validate Drafts before running saved configs.",
    },
    {
      status: runs.length ? failedRuns.length ? "warn" : "ok" : "idle",
      title: numberText(runs.length, 0),
      label: "Runs",
      note: runs.length
        ? `${numberText(completedRuns.length, 0)} completed; ${numberText(failedRuns.length, 0)} need log review.`
        : "No validate/replay/simulated-paper runs recorded yet.",
    },
    {
      status: selectedDraft ? selectedValidation && !selectedValidation.valid ? "bad" : "ok" : "idle",
      title: text(selectedDraftId),
      label: "Selected Draft",
      note: selectedDraft
        ? `${text(selectedDraft.status_label || selectedDraft.status)} / ${text(selectedDraft.mode)} / ${text((selectedDraft.symbols || []).join(", "))}.`
        : "Choose a saved draft in the Run form.",
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : selectedDraft ? "warn" : "bad",
      title: latestRun ? text(latestRun.status) : "No Run",
      label: "Latest",
      note: latestRun
        ? `${text(latestRun.action)} finished ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.`
        : "Run the selected draft to create comparable artifacts.",
    },
    {
      status: artifacts.run_id || artifacts.draft_id ? "ok" : selectedHasArtifacts ? "warn" : "idle",
      title: artifacts.run_id || artifacts.draft_id ? "Loaded" : selectedHasArtifacts ? "Available" : "Missing",
      label: "Artifacts",
      note: artifacts.run_id || artifacts.draft_id
        ? `${text(artifacts.draft_id)} ${artifacts.run_id ? `/ ${text(artifacts.run_id)}` : "latest output"} is loaded.`
        : selectedHasArtifacts
          ? "Open Artifacts or Results for the selected draft."
          : "No output artifacts found for the selected draft yet.",
    },
    {
      status: nextStatus,
      title: nextTitle,
      label: "Next Action",
      note: nextNote,
    },
  ];
  $("workbench-triage-note").textContent = `${numberText(drafts.length, 0)} drafts / ${numberText(runs.length, 0)} runs / ${numberText(validations.length, 0)} validations`;
  $("workbench-triage-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function workbenchDraftInventoryModel() {
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  const runs = (state.configRuns && state.configRuns.runs) || [];
  const validations = (state.draftValidations && state.draftValidations.validations) || [];
  const validationByDraft = draftValidationById();
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  const selectedDraft = drafts.find((draft) => draft.draft_id === selectedDraftId) || null;
  const selectedValidation = selectedDraftId ? validationByDraft[selectedDraftId] : null;
  const latestRun = latestWorkbenchRunForDraft(selectedDraftId);
  const validCount = validations.filter((item) => item.valid).length;
  const invalidCount = validations.filter((item) => item.valid === false).length;
  const uncheckedDrafts = drafts.filter((draft) => !validationByDraft[draft.draft_id]);
  const completedRuns = runs.filter((run) => run.status === "completed");
  const failedRuns = runs.filter((run) => run.status === "failed" || run.status === "timeout");
  const draftIdsWithRuns = new Set(runs.map((run) => run.draft_id).filter(Boolean));
  const runnableDrafts = drafts.filter((draft) => {
    const validation = validationByDraft[draft.draft_id];
    return validation && validation.valid === true;
  });
  const folders = countBy(drafts, "folder");
  const statuses = countBy(drafts, "status_label");
  const tagCounts = {};
  for (const draft of drafts) {
    for (const tag of draft.tags || []) tagCounts[tag] = (tagCounts[tag] || 0) + 1;
  }
  const topTags = topCountEntries(tagCounts, 4).map(([key, value]) => `${key} ${numberText(value, 0)}`).join(", ");
  let headline = "No saved drafts yet";
  let note = "Use Builder to select data, preview alignment, generate, and save a local draft before running.";
  if (drafts.length) {
    if (invalidCount) {
      headline = "Fix invalid drafts before running";
      note = `${numberText(invalidCount, 0)} saved draft${invalidCount === 1 ? "" : "s"} failed validation. Review messages before replay or simulated paper.`;
    } else if (uncheckedDrafts.length) {
      headline = "Validate saved drafts before running";
      note = `${numberText(uncheckedDrafts.length, 0)} saved draft${uncheckedDrafts.length === 1 ? "" : "s"} have not been validated in this session.`;
    } else if (runnableDrafts.length && !runs.length) {
      headline = "Drafts are ready to run";
      note = `${numberText(runnableDrafts.length, 0)} valid draft${runnableDrafts.length === 1 ? "" : "s"} are available; run replay or simulated paper to create artifacts.`;
    } else {
      headline = "Saved draft inventory is ready";
      note = `${numberText(drafts.length, 0)} saved draft${drafts.length === 1 ? "" : "s"}, ${numberText(completedRuns.length, 0)} completed run${completedRuns.length === 1 ? "" : "s"}, and ${numberText(failedRuns.length, 0)} failed/timeout run${failedRuns.length === 1 ? "" : "s"}.`;
    }
  }
  const cards = [
    {
      status: drafts.length ? "ok" : "idle",
      label: "Drafts",
      title: numberText(drafts.length, 0),
      note: Object.keys(folders).length ? `Folders: ${countSummary(folders)}.` : "No draft folders loaded.",
    },
    {
      status: validations.length ? invalidCount ? "bad" : "ok" : drafts.length ? "warn" : "idle",
      label: "Validation",
      title: `${numberText(validCount, 0)} valid`,
      note: validations.length ? `${numberText(invalidCount, 0)} invalid; ${numberText(uncheckedDrafts.length, 0)} unchecked.` : "Click Validate Drafts to populate validation state.",
    },
    {
      status: runnableDrafts.length ? "ok" : drafts.length ? "warn" : "idle",
      label: "Runnable",
      title: numberText(runnableDrafts.length, 0),
      note: "Drafts with passing saved-draft validation.",
    },
    {
      status: runs.length ? failedRuns.length ? "warn" : "ok" : drafts.length ? "warn" : "idle",
      label: "Runs",
      title: numberText(runs.length, 0),
      note: `${numberText(completedRuns.length, 0)} completed; ${numberText(failedRuns.length, 0)} failed/timeout; ${numberText(draftIdsWithRuns.size, 0)} draft IDs with runs.`,
    },
    {
      status: selectedDraft ? selectedValidation && selectedValidation.valid === false ? "bad" : selectedValidation ? "ok" : "warn" : "idle",
      label: "Selected",
      title: selectedDraft ? text(selectedDraft.draft_id) : "None",
      note: selectedDraft
        ? `${text(selectedDraft.status_label || selectedDraft.status)} / ${text(selectedDraft.folder)} / tags ${(selectedDraft.tags || []).join(", ") || "none"}.`
        : "Choose a saved draft in the Run form.",
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : selectedDraft ? "warn" : "idle",
      label: "Selected Latest",
      title: latestRun ? text(latestRun.status) : "No run",
      note: latestRun ? `${text(latestRun.action)} ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.` : "No run recorded for the selected draft.",
    },
  ];
  const lines = [
    {
      status: drafts.length ? "ok" : "idle",
      title: "Draft organization",
      detail: drafts.length ? `Folders ${countSummary(folders)}; statuses ${countSummary(statuses)}; top tags ${topTags || "none"}.` : "No saved drafts are available yet.",
    },
    {
      status: uncheckedDrafts.length ? "warn" : invalidCount ? "bad" : validations.length ? "ok" : drafts.length ? "warn" : "idle",
      title: "Validation coverage",
      detail: validations.length ? `${numberText(validations.length, 0)} checked at ${text((state.draftValidations || {}).generated_at)}; ${numberText(uncheckedDrafts.length, 0)} unchecked.` : "No saved-draft validation results are loaded in this session.",
    },
    {
      status: failedRuns.length ? "warn" : runs.length ? "ok" : drafts.length ? "warn" : "idle",
      title: "Run coverage",
      detail: runs.length ? `${numberText(completedRuns.length, 0)} completed and ${numberText(failedRuns.length, 0)} failed/timeout runs; ${numberText(draftIdsWithRuns.size, 0)} draft IDs have run evidence.` : "No saved draft runs have been recorded yet.",
    },
    {
      status: selectedDraft ? selectedValidation && selectedValidation.valid === false ? "bad" : selectedValidation ? "ok" : "warn" : "idle",
      title: "Selected draft next step",
      detail: selectedDraft
        ? selectedValidation
          ? selectedValidation.valid
            ? latestRun ? "Selected draft is valid; inspect latest run or run another replay/simulated-paper pass." : "Selected draft is valid; choose replay or simulated paper to create artifacts."
            : `Fix validation errors: ${(selectedValidation.errors || []).slice(0, 3).join("; ") || "validation failed"}.`
          : "Validate the selected draft before replay or simulated paper."
        : "Select a saved draft before running.",
    },
  ];
  return { headline, note, cards, lines };
}

export function workbenchDraftInventoryText(model) {
  return [
    `Draft Inventory Review: ${model.headline}`,
    `Next action: ${model.note}`,
    ...model.cards.map((card) => `${card.label} [${card.status}]: ${card.title} - ${card.note}`),
    ...model.lines.map((line) => `${line.title} [${line.status}]: ${line.detail}`),
  ].join("\n");
}

export function renderWorkbenchDraftInventory() {
  if (
    !$("workbench-draft-inventory-title")
    || !$("workbench-draft-inventory-note")
    || !$("workbench-draft-inventory-cards")
    || !$("workbench-draft-inventory-body")
    || !$("workbench-draft-inventory-actions")
  ) return;
  const model = workbenchDraftInventoryModel();
  state.workbenchDraftInventoryText = workbenchDraftInventoryText(model);
  $("workbench-draft-inventory-title").textContent = model.headline;
  $("workbench-draft-inventory-note").textContent = model.note;
  $("workbench-draft-inventory-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-draft-inventory-body").innerHTML = model.lines.map((line) => `
    <article class="performance-report-line status-${escapeHtml(line.status)}">
      <strong>${escapeHtml(line.title)}</strong>
      <span>${escapeHtml(line.detail)}</span>
    </article>
  `).join("");
  $("workbench-draft-inventory-actions").innerHTML = [
    `<button type="button" data-draft-inventory-action="copy">Copy Review</button>`,
    `<button type="button" class="secondary" data-draft-inventory-action="validate">Validate Drafts</button>`,
    `<button type="button" class="secondary" data-draft-inventory-action="export">Export Drafts CSV</button>`,
    `<button type="button" class="secondary" data-draft-inventory-action="builder">Builder</button>`,
    `<button type="button" class="secondary" data-draft-inventory-action="run">Run Form</button>`,
  ].join("");
}

export function handleWorkbenchDraftInventoryAction(action) {
  if (action === "copy") {
    copyText(state.workbenchDraftInventoryText || "No draft inventory review loaded").then(() => {
      $("last-refresh").textContent = "Draft inventory review copied";
    }).catch((err) => {
      $("last-refresh").textContent = `Draft inventory review copy failed: ${err.message}`;
    });
    return;
  }
  if (action === "validate") {
    validateDrafts().catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
    return;
  }
  if (action === "export") {
    downloadDraftsCsv().catch((err) => {
      $("last-refresh").textContent = `Draft CSV export failed: ${err.message}`;
    });
    return;
  }
  if (action === "builder") return navigateToWorkbenchLens("builder");
  if (action === "run") {
    const element = $("config-run-form");
    if (element) element.scrollIntoView({ block: "start", behavior: "smooth" });
  }
}

export function workbenchRunReadinessModel() {
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  const runAction = $("config-run-action") ? $("config-run-action").value : "";
  const maxSteps = finiteNumber($("config-run-max-steps") && $("config-run-max-steps").value);
  const timeoutSeconds = finiteNumber($("config-run-timeout") && $("config-run-timeout").value);
  const selectedDraft = selectedRunDraft();
  const validation = selectedRunDraftValidation();
  const latestRun = latestWorkbenchRunForDraft(selectedDraftId);
  const artifacts = state.configArtifacts || {};
  const loadedSameDraft = Boolean(selectedDraftId && artifacts.draft_id && artifacts.draft_id === selectedDraftId);
  const loadedSameRun = Boolean(latestRun && artifacts.run_id && artifacts.run_id === latestRun.run_id);
  const blockers = [];
  const warnings = [];

  if (!selectedDraft) blockers.push("Select a saved draft.");
  if (!runAction) blockers.push("Choose validate, replay, or simulated paper.");
  if (selectedDraft && validation && validation.valid === false) blockers.push("Fix validation errors before running.");
  if (selectedDraft && !validation) warnings.push("Draft has not been validated in this browser session.");
  if (selectedDraft && latestRun && latestRun.status !== "completed") warnings.push(`Latest run ended with ${text(latestRun.status)}.`);
  if (runAction && runAction !== "validate" && selectedDraft && validation && validation.valid !== true) {
    warnings.push("Run Validate Drafts first for a cleaner pre-flight check.");
  }
  if (maxSteps !== null && maxSteps <= 0) blockers.push("Max steps must be positive.");
  if (timeoutSeconds !== null && timeoutSeconds <= 0) blockers.push("Timeout must be positive.");

  let status = selectedDraft ? "bad" : "idle";
  let title = "Blocked";
  let note = blockers.join(" ");
  let primaryAction = "select";
  if (!blockers.length && warnings.length) {
    status = "warn";
    title = "Runnable With Review";
    note = warnings.join(" ");
    primaryAction = validation ? "run" : "validate";
  } else if (!blockers.length) {
    status = "ok";
    title = "Ready To Run";
    note = `${text(selectedDraftId)} can run ${text(runAction)} with the current settings.`;
    primaryAction = runAction && runAction !== "validate" ? "run_performance" : "run";
  } else if (selectedDraft && validation && validation.valid === false) {
    primaryAction = "validation";
  } else if (selectedDraft && !validation) {
    primaryAction = "validate";
  }

  const cards = [
    {
      status: selectedDraft ? "ok" : "idle",
      label: "Draft",
      title: selectedDraft ? text(selectedDraft.draft_id) : "Missing",
      note: selectedDraft
        ? `${text(selectedDraft.mode)} / ${(selectedDraft.symbols || []).join(", ") || "no symbols"}`
        : "Save a generated draft, then select it here.",
    },
    {
      status: validation ? validation.valid ? "ok" : "bad" : selectedDraft ? "warn" : "idle",
      label: "Validation",
      title: validation ? validation.valid ? "Valid" : "Invalid" : "Unchecked",
      note: validation
        ? validation.valid ? "Server validation passed." : (validation.errors || []).join("; ") || "Validation failed."
        : "Click Validate Drafts before replay or simulated paper.",
    },
    {
      status: runAction ? "ok" : "bad",
      label: "Action",
      title: runAction || "Missing",
      note: `Max steps ${maxSteps === null ? "default" : numberText(maxSteps, 0)}; timeout ${timeoutSeconds === null ? "default" : numberText(timeoutSeconds, 0)} seconds.`,
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : selectedDraft ? "warn" : "idle",
      label: "Latest Run",
      title: latestRun ? text(latestRun.status) : "None",
      note: latestRun
        ? `${text(latestRun.action)} ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.`
        : "No recorded run for this draft yet.",
    },
    {
      status: loadedSameRun || loadedSameDraft ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "idle",
      label: "Results",
      title: loadedSameRun || loadedSameDraft ? "Loaded" : latestRun && latestRun.artifact_path ? "Available" : "Missing",
      note: loadedSameRun || loadedSameDraft
        ? "Performance and Runs can inspect this output."
        : latestRun && latestRun.artifact_path
          ? "Open Performance to load run artifacts."
          : "Replay or simulated paper creates performance artifacts.",
    },
  ];

  const actions = [
    {
      id: "select",
      label: "Select Draft",
      enabled: true,
      secondary: primaryAction !== "select",
    },
    {
      id: "validate",
      label: "Validate Drafts",
      enabled: Boolean(selectedDraft),
      secondary: primaryAction !== "validate",
    },
    {
      id: "run",
      label: "Run Selected",
      enabled: Boolean(selectedDraft && runAction && !blockers.length),
      secondary: primaryAction !== "run",
    },
    {
      id: "run_performance",
      label: "Run + Performance",
      enabled: Boolean(selectedDraft && runAction && runAction !== "validate" && !blockers.length),
      secondary: primaryAction !== "run_performance",
    },
    {
      id: "results",
      label: "Open Results",
      enabled: Boolean(latestRun && latestRun.status === "completed" && latestRun.action !== "validate"),
      secondary: true,
    },
  ];

  return { status, title, note, blockers, warnings, cards, actions };
}

export function renderWorkbenchRunReadiness() {
  if (!$("workbench-run-readiness-note") || !$("workbench-run-readiness-cards") || !$("workbench-run-readiness-actions")) return;
  const model = workbenchRunReadinessModel();
  const suffix = model.blockers.length
    ? `${numberText(model.blockers.length, 0)} blocker${model.blockers.length === 1 ? "" : "s"}`
    : model.warnings.length
      ? `${numberText(model.warnings.length, 0)} warning${model.warnings.length === 1 ? "" : "s"}`
      : "ready";
  $("workbench-run-readiness-note").innerHTML = `<span class="${escapeHtml(statusClass(model.status))}">${escapeHtml(model.title)}</span> - ${escapeHtml(suffix)}. ${escapeHtml(model.note)}`;
  $("workbench-run-readiness-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-run-readiness-actions").innerHTML = model.actions.map((action) => `
    <button
      type="button"
      class="${action.secondary ? "secondary " : ""}workbench-run-readiness-action"
      data-run-readiness-action="${escapeHtml(action.id)}"
      ${action.enabled ? "" : "disabled"}
    >${escapeHtml(action.label)}</button>
  `).join("");
}

export function handleWorkbenchRunReadinessAction(action) {
  if (action === "select") {
    const element = $("config-run-draft");
    if (element) {
      element.scrollIntoView({ block: "center", behavior: "smooth" });
      if (typeof element.focus === "function") element.focus({ preventScroll: true });
    }
    return;
  }
  if (action === "validate" && $("validate-drafts") instanceof HTMLButtonElement && !$("validate-drafts").disabled) {
    $("validate-drafts").click();
    return;
  }
  if (action === "run" && $("config-run-form")) {
    $("config-run-form").requestSubmit();
    return;
  }
  if (action === "run_performance") {
    runConfigDraft(null, { openPerformance: true }).catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
    return;
  }
  if (action === "results") {
    openWorkbenchResultPerformance().catch((err) => {
      $("config-run-status").innerHTML = `<span class="status-bad">${escapeHtml(err.message)}</span>`;
    });
  }
}

export function workbenchResultModel() {
  const selectedDraftId = $("config-run-draft") ? $("config-run-draft").value : "";
  const selectedDraft = selectedRunDraft();
  const validation = selectedRunDraftValidation();
  const latestRun = latestWorkbenchRunForDraft(selectedDraftId);
  const summary = (latestRun && latestRun.summary) || {};
  const artifacts = state.configArtifacts || {};
  const loadedSameRun = Boolean(latestRun && artifacts.run_id && artifacts.run_id === latestRun.run_id);
  const loadedSameDraft = Boolean(selectedDraftId && artifacts.draft_id && artifacts.draft_id === selectedDraftId);
  let status = "idle";
  let title = "Select Draft";
  let note = "Choose a saved draft, validate it, then run replay or simulated paper.";
  if (selectedDraft) {
    status = validation && validation.valid === false ? "bad" : "warn";
    title = latestRun ? text(latestRun.status) : "Ready To Run";
    note = latestRun
      ? `${text(latestRun.action)} finished ${timestampAgeLabel(latestRun.finished_at || latestRun.started_at)}.`
      : `${selectedDraft.draft_id} is selected; run validate, replay, or simulated paper.`;
  }
  if (latestRun) {
    if (latestRun.status === "failed" || latestRun.status === "timeout") {
      status = "bad";
      title = "Review Log";
      note = `${latestRun.run_id || selectedDraftId} ended with ${text(latestRun.status)}. Open the log before trusting outputs.`;
    } else if (latestRun.action === "validate") {
      status = latestRun.status === "completed" ? "ok" : "warn";
      title = "Validated";
      note = "Validation finished; choose replay or simulated paper to create performance artifacts.";
    } else if (loadedSameRun || loadedSameDraft) {
      status = "ok";
      title = "Results Loaded";
      note = "Artifacts are loaded. Open Performance for charts or Runs for the session timeline.";
    } else if (latestRun.artifact_path) {
      status = latestRun.status === "completed" ? "warn" : "bad";
      title = "Open Results";
      note = "A completed run has artifacts available; load results to inspect equity, orders, fills, and logs.";
    } else if (latestRun.status === "completed") {
      status = "warn";
      title = "Find Outputs";
      note = "The latest run completed but no explicit artifact path was reported. Try loading the draft's latest output.";
    }
  }
  const hasRun = Boolean(latestRun);
  const canOpenPerformance = Boolean(selectedDraftId && latestRun && latestRun.action !== "validate" && latestRun.status === "completed");
  const cards = [
    {
      status: selectedDraft ? validation && validation.valid === false ? "bad" : "ok" : "idle",
      label: "Selected Draft",
      title: selectedDraft ? text(selectedDraft.draft_id) : "None",
      note: selectedDraft ? `${text(selectedDraft.mode)} / ${(selectedDraft.symbols || []).join(", ") || "no symbols"}` : "Select a saved draft in Run Draft.",
    },
    {
      status: latestRun ? latestRun.status === "completed" ? "ok" : "warn" : selectedDraft ? "warn" : "idle",
      label: "Latest Run",
      title: latestRun ? text(latestRun.action) : "None",
      note: latestRun ? `${text(latestRun.run_id)} / ${text(latestRun.status)}` : "No run recorded for the selected draft.",
    },
    {
      status: loadedSameRun || loadedSameDraft ? "ok" : latestRun && latestRun.artifact_path ? "warn" : "idle",
      label: "Artifacts",
      title: loadedSameRun || loadedSameDraft ? "Loaded" : latestRun && latestRun.artifact_path ? "Available" : "Missing",
      note: loadedSameRun || loadedSameDraft
        ? `${text(artifacts.draft_id)} ${artifacts.run_id ? `/ ${text(artifacts.run_id)}` : "latest output"}.`
        : latestRun && latestRun.artifact_path
          ? "Click Open Performance to load charts."
          : "No artifact path is visible for this run.",
    },
    {
      status: latestRun && latestRun.status === "completed" ? "ok" : latestRun ? "warn" : "idle",
      label: "Activity",
      title: latestRun ? `${numberText(summary.fills, 0)} fills` : "n/a",
      note: latestRun
        ? `${numberText(summary.decisions, 0)} decisions / ${numberText(summary.rejections, 0)} rejects.`
        : "Run a draft to summarize decisions, fills, and rejects.",
    },
  ];
  return {
    status,
    title,
    note,
    selectedDraftId,
    latestRun,
    hasRun,
    canOpenPerformance,
    cards,
  };
}

export function renderWorkbenchRunResult() {
  if (!$("workbench-result-title") || !$("workbench-result-tiles")) return;
  const model = workbenchResultModel();
  $("workbench-result-title").textContent = model.title;
  $("workbench-result-title").className = statusClass(model.status);
  $("workbench-result-note").textContent = model.note;
  $("workbench-result-open-performance").disabled = !model.canOpenPerformance;
  $("workbench-result-open-runs").disabled = !model.hasRun;
  $("workbench-result-open-log").disabled = !model.hasRun;
  $("workbench-result-tiles").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function applyRiskPreset() {
  if (!$("config-risk-preset")) return;
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
    if ($(id) && value !== undefined) {
      $(`${id}`).value = String(value);
    }
  }
}

export function renderWorkbenchRuns() {
  const drafts = (state.configDrafts && state.configDrafts.drafts) || [];
  renderDraftValidations();
  renderWorkbenchHome();
  renderWorkbenchGuide();
  renderWorkbenchRunReadiness();
  renderWorkbenchDraftInventory();
  renderWorkbenchRunCommands();
  renderWorkbenchTriage();
  renderWorkbenchRunResult();
  $("config-drafts-body").innerHTML = drafts.length
    ? drafts.map((draft) => row([
        escapeHtml(draft.draft_id),
        escapeHtml(draft.folder),
        statusText(draft.status_label || draft.status || "unknown"),
        escapeHtml(draft.mode),
        escapeHtml((draft.symbols || []).join(", ")),
        escapeHtml((draft.tags || []).join(", ") || "none"),
        escapeHtml(draft.modified_at),
        draftValidationBadge(draft.draft_id),
        `<span class="mono">${escapeHtml(draft.output_dir)}</span>`,
        `<span class="button-pair"><button type="button" class="secondary inspect-draft-detail" data-draft-id="${escapeHtml(draft.draft_id)}">YAML</button><button type="button" class="secondary download-draft-yaml" data-draft-id="${escapeHtml(draft.draft_id)}">Download</button><button type="button" class="secondary inspect-draft" data-draft-id="${escapeHtml(draft.draft_id)}">Artifacts</button><button type="button" class="secondary open-draft-performance" data-draft-id="${escapeHtml(draft.draft_id)}">Results</button><button type="button" class="secondary delete-draft" data-draft-id="${escapeHtml(draft.draft_id)}">Delete</button></span>`,
      ])).join("")
    : row([`<span class="muted">No saved drafts yet. Select saved data, enable Save draft locally, then Generate.</span>`, "", "", "", "", "", "", "", "", ""]);

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
              ? `<button type="button" class="secondary inspect-run-artifacts" data-run-id="${escapeHtml(run.run_id)}">Artifacts</button><button type="button" class="secondary open-run-performance" data-run-id="${escapeHtml(run.run_id)}">Results</button>`
              : `<button type="button" class="secondary inspect-draft" data-draft-id="${escapeHtml(run.draft_id)}">Latest</button><button type="button" class="secondary open-draft-performance" data-draft-id="${escapeHtml(run.draft_id)}">Results</button>`
          }<button type="button" class="secondary inspect-run-log" data-run-id="${escapeHtml(run.run_id)}">Log</button></span>`,
        ]);
      }).join("")
    : row([`<span class="muted">No draft runs yet. Save a valid draft, choose validate/replay/simulated paper, then Run.</span>`, "", "", "", "", "", "", "", "", ""]);
}

export function comparisonCard(title, run, value) {
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

export function renderComparisonFilterOptions(runs) {
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
  makeOptions("comparison-filter-mode", runs.map((run) => run.mode));
}

export function filteredComparisonRuns(runs) {
  const query = ($("comparison-filter-text").value || "").trim().toLowerCase();
  const status = $("comparison-filter-status").value || "";
  const action = $("comparison-filter-action").value || "";
  const mode = $("comparison-filter-mode").value || "";
  const summary = $("comparison-filter-summary").value || "";
  return (runs || []).filter((run) => {
    if (status && text(run.status) !== status) return false;
    if (action && text(run.action) !== action) return false;
    if (mode && text(run.mode) !== mode) return false;
    if (summary === "yes" && !run.summary_available) return false;
    if (summary === "no" && run.summary_available) return false;
    if (query) {
      const haystack = [
        run.run_id,
        run.draft_id,
        run.action,
        run.status,
        run.mode,
        run.finished_at,
        run.total_return_pct,
        run.max_drawdown_pct,
        run.fills,
        run.rejections,
      ].map(text).join(" ").toLowerCase();
      if (!haystack.includes(query)) return false;
    }
    return true;
  });
}

export function comparisonSortMetric(runItem, sortMode) {
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

export function sortedComparisonRuns(runs) {
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

export function comparisonBestRun(runs, metric, { smallest = false } = {}) {
  const eligible = (runs || [])
    .map((runItem) => ({ runItem, value: finiteNumber(runItem[metric]) }))
    .filter((item) => item.value !== null);
  if (!eligible.length) return null;
  return eligible.sort((left, right) => smallest ? left.value - right.value : right.value - left.value)[0].runItem;
}

export function comparisonTotal(runs, key) {
  return (runs || []).reduce((sum, runItem) => sum + Number(runItem[key] || 0), 0);
}

export function renderComparisonSummaryCards(runs, allRuns) {
  if (!$("comparison-summary-cards") || !$("comparison-summary-note")) return;
  const summarized = runs.filter((runItem) => runItem.summary_available);
  const bestReturn = comparisonBestRun(summarized, "total_return_pct");
  const lowestDrawdown = comparisonBestRun(summarized, "max_drawdown_pct");
  const worstDrawdown = comparisonBestRun(summarized, "max_drawdown_pct", { smallest: true });
  const shortHorizon = summarized.filter((runItem) => runItem.short_horizon_projection).length;
  const fills = comparisonTotal(runs, "fills");
  const rejects = comparisonTotal(runs, "rejections");
  const modes = new Set(runs.map((runItem) => text(runItem.mode)).filter((value) => value !== "n/a")).size;
  const drafts = new Set(runs.map((runItem) => text(runItem.draft_id)).filter((value) => value !== "n/a")).size;
  let nextStatus = "idle";
  let nextTitle = "No Runs";
  let nextNote = "Run a Workbench replay or simulated-paper draft to create comparable summaries.";
  if (runs.length && !summarized.length) {
    nextStatus = "warn";
    nextTitle = "Need Summaries";
    nextNote = "The filtered runs exist but do not have public-safe summary artifacts.";
  } else if (rejects > 0) {
    nextStatus = "warn";
    nextTitle = "Review Rejects";
    nextNote = "Filtered runs include rejected orders; open artifacts or logs before trusting the result.";
  } else if (shortHorizon > 0) {
    nextStatus = "warn";
    nextTitle = "Short Horizon";
    nextNote = "Some filtered runs are projection-flagged; compare them as exploratory, not stable.";
  } else if (summarized.length) {
    nextStatus = "ok";
    nextTitle = "Comparable";
    nextNote = "The filtered set has summaries and no visible reject or short-horizon warnings.";
  }
  $("comparison-summary-note").textContent = `${numberText(runs.length, 0)} filtered / ${numberText(allRuns.length, 0)} total`;
  const cards = [
    {
      status: summarized.length ? "ok" : runs.length ? "warn" : "bad",
      label: "Coverage",
      title: `${numberText(summarized.length, 0)} summarized`,
      note: `${numberText(drafts, 0)} draft${drafts === 1 ? "" : "s"} / ${numberText(modes, 0)} mode${modes === 1 ? "" : "s"} in the filtered set.`,
    },
    {
      status: bestReturn ? "ok" : "bad",
      label: "Best Return",
      title: bestReturn ? pctText(bestReturn.total_return_pct) : "n/a",
      note: bestReturn ? `${text(bestReturn.draft_id)} / ${text(bestReturn.mode)} / ${text(bestReturn.run_id)}` : "No summarized return metric.",
    },
    {
      status: lowestDrawdown ? "ok" : "bad",
      label: "Lowest Drawdown",
      title: lowestDrawdown ? pctText(lowestDrawdown.max_drawdown_pct) : "n/a",
      note: lowestDrawdown ? `${text(lowestDrawdown.draft_id)} / ${text(lowestDrawdown.mode)} / ${text(lowestDrawdown.run_id)}` : "No summarized drawdown metric.",
    },
    {
      status: worstDrawdown && finiteNumber(worstDrawdown.max_drawdown_pct) < -10 ? "bad" : worstDrawdown ? "warn" : "bad",
      label: "Worst Drawdown",
      title: worstDrawdown ? pctText(worstDrawdown.max_drawdown_pct) : "n/a",
      note: worstDrawdown ? `${text(worstDrawdown.draft_id)} / ${text(worstDrawdown.mode)} / ${text(worstDrawdown.run_id)}` : "No summarized drawdown metric.",
    },
    {
      status: rejects ? "bad" : fills ? "ok" : runs.length ? "warn" : "bad",
      label: "Execution",
      title: `${numberText(fills, 0)} fills`,
      note: `${numberText(rejects, 0)} rejects across filtered runs.`,
    },
    {
      status: nextStatus,
      label: "Next Action",
      title: nextTitle,
      note: nextNote,
    },
  ];
  $("comparison-summary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function renderRunComparison() {
  const comparison = state.runComparison || {};
  const allRuns = comparison.runs || [];
  renderComparisonFilterOptions(allRuns);
  const runs = sortedComparisonRuns(filteredComparisonRuns(allRuns));
  const leaders = comparison.leaders || {};
  const summaryCount = Number(comparison.summary_count || 0);
  $("comparison-note").textContent = `${numberText(runs.length, 0)} shown / ${numberText(comparison.total || allRuns.length, 0)} recorded / ${summaryCount} summarized`;
  renderComparisonSummaryCards(runs, allRuns);
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

export function renderRunDetail() {
  const detail = state.runDetail || {};
  const evidence = state.runEvidence || detail || {};
  const artifacts = evidence.artifacts || {};
  const logs = evidence.logs || {};
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
  if ($("run-evidence-cards")) {
    const cards = evidence.evidence_cards || [
      {
        status: detail.run_id ? statusClass(detail.status).replace("status-", "") || "warn" : "idle",
        label: "Execution",
        title: detail.run_id ? text(detail.status) : "No Run",
        note: detail.run_id ? `Return code ${text(detail.returncode)}.` : "Select a run from Workbench or Runs.",
      },
    ];
    $("run-evidence-cards").innerHTML = cards.map((card) => `
      <div class="action-card status-${escapeHtml(card.status || "bad")}">
        <span>${escapeHtml(card.label || "Evidence")}</span>
        <strong>${escapeHtml(card.title || "n/a")}</strong>
        <small>${escapeHtml(card.note || "")}</small>
      </div>
    `).join("");
  }
  if ($("run-evidence-note")) {
    const pathNote = artifacts.path ? ` Archive ${text(artifacts.path)}.` : "";
    const errorNote = artifacts.error ? ` ${text(artifacts.error)}.` : "";
    $("run-evidence-note").textContent = detail.run_id
      ? `${numberText(artifacts.existing_count || 0, 0)} artifact files / ${bytes(artifacts.bytes || 0)} / ${numberText(artifacts.jsonl_row_count || 0, 0)} JSONL rows.${pathNote}${errorNote}`
      : "Open a run log to inspect bounded artifacts and log tails.";
  }
  if ($("run-evidence-files-body")) {
    const files = artifacts.files || [];
    $("run-evidence-files-body").innerHTML = files.length
      ? files.map((item) => row([
          `<span class="mono">${escapeHtml(item.name)}</span>`,
          statusText(item.exists ? "ok" : "bad"),
          bytes(item.bytes || 0),
          item.line_count === null || item.line_count === undefined
            ? "n/a"
            : `${numberText(item.line_count, 0)}${item.line_count_capped ? "+" : ""}`,
          escapeHtml(text(item.modified_at)),
        ])).join("")
      : row([`<span class="muted">No archived artifact manifest for this run.</span>`, "", "", "", ""]);
  }
  $("run-log-stdout").value = (logs.stdout && logs.stdout.tail) || detail.stdout_tail || "";
  $("run-log-stderr").value = (logs.stderr && logs.stderr.tail) || detail.stderr_tail || "";
}

export function nonzeroObjectCount(value) {
  if (!value || typeof value !== "object") return 0;
  return Object.values(value).filter((item) => {
    const number = finiteNumber(item);
    return number !== null && number !== 0;
  }).length;
}

export function artifactSessionRows(artifacts) {
  const rows = [];
  for (const decision of artifacts.decisions || []) {
    rows.push({
      timestamp: decision.timestamp,
      type: "decision",
      status: decision.paused ? "paused" : "ok",
      symbol: (decision.symbols || []).slice(0, 5).join(", "),
      detail: `${numberText(decision.intent_count, 0)} intents; step ${text(decision.step)}`,
    });
  }
  for (const orderItem of artifacts.orders || []) {
    const status = text(orderItem.status);
    const rejected = status.toLowerCase().includes("reject");
    const quantity = orderItem.cash_quantity !== undefined && orderItem.cash_quantity !== null && orderItem.cash_quantity !== ""
      ? `cash ${money(orderItem.cash_quantity)}`
      : `qty ${text(orderItem.quantity)}`;
    rows.push({
      timestamp: orderItem.timestamp,
      type: rejected ? "reject" : "order",
      status,
      symbol: orderItem.symbol,
      detail: `${text(orderItem.side)} ${quantity}; ${text(orderItem.reason || orderItem.tag || orderItem.order_type)}`,
    });
  }
  for (const fill of artifacts.fills || []) {
    rows.push({
      timestamp: fill.timestamp,
      type: "fill",
      status: fill.simulated ? "simulated" : "filled",
      symbol: fill.symbol,
      detail: `${text(fill.side)} qty ${numberText(fill.quantity, 4)} @ ${money(fill.price)}; commission ${money(fill.commission)}`,
    });
  }
  for (const account of artifacts.account || []) {
    rows.push({
      timestamp: account.timestamp,
      type: "account",
      status: "snapshot",
      symbol: `${numberText(nonzeroObjectCount(account.positions), 0)} positions`,
      detail: `equity ${money(account.equity)}; cash ${money(account.cash)}; gross ${money(account.gross_exposure)}`,
    });
  }
  return rows.sort((left, right) => {
    const leftTime = timestampMillis(left.timestamp) || 0;
    const rightTime = timestampMillis(right.timestamp) || 0;
    if (leftTime !== rightTime) return rightTime - leftTime;
    return String(right.type || "").localeCompare(String(left.type || ""));
  });
}

export function strategyDrilldownRows(decisions) {
  return (decisions || [])
    .map((decision) => ({
      timestamp: decision.timestamp,
      symbols: decision.symbols || [],
      intent_count: Number(decision.intent_count || 0),
      drilldown: decision.drilldown || {},
    }))
    .filter((item) => Object.keys(item.drilldown).length);
}

export function nearThresholdMissRows(drilldowns) {
  return (drilldowns || [])
    .filter((item) => item.intent_count === 0 && item.drilldown && item.drilldown.near_threshold === true)
    .sort((left, right) => {
      const leftTime = timestampMillis(left.timestamp) || 0;
      const rightTime = timestampMillis(right.timestamp) || 0;
      return rightTime - leftTime;
    });
}

export function drilldownSignalText(drilldown) {
  const label = text(drilldown.signal_label || drilldown.reason || "signal");
  const value = drilldown.signal_value === undefined ? "n/a" : numberText(drilldown.signal_value, 4);
  return `${label}: ${value}`;
}

export function drilldownThresholdText(drilldown) {
  const parts = [];
  if (drilldown.threshold !== undefined) parts.push(`threshold ${numberText(drilldown.threshold, 4)}`);
  if (drilldown.threshold_distance !== undefined) parts.push(`distance ${numberText(drilldown.threshold_distance, 4)}`);
  if (drilldown.threshold_direction !== undefined) parts.push(text(drilldown.threshold_direction));
  return parts.join("; ") || "n/a";
}

export function drilldownHoldText(drilldown) {
  if (drilldown.hold_until) return text(drilldown.hold_until);
  if (drilldown.expected_hold_minutes !== undefined) return `${numberText(drilldown.expected_hold_minutes, 0)}m expected`;
  return "n/a";
}

export function drilldownNearText(drilldown) {
  const label = drilldown.near_threshold ? "near" : "no";
  return drilldown.near_threshold_reason ? `${label}: ${text(drilldown.near_threshold_reason)}` : label;
}

export function drilldownExitText(drilldown) {
  const parts = [];
  if (drilldown.entry_marker) parts.push(`entry ${text(drilldown.entry_marker)}`);
  if (drilldown.exit_marker) parts.push(`exit ${text(drilldown.exit_marker)}`);
  if (drilldown.active_exit_rule) parts.push(`rule ${text(drilldown.active_exit_rule)}`);
  if (drilldown.exit_state) parts.push(`exit ${text(drilldown.exit_state)}`);
  if (drilldown.stop_state) parts.push(`stop ${text(drilldown.stop_state)}`);
  if (drilldown.stop_price !== undefined) parts.push(`stop ${money(drilldown.stop_price)}`);
  if (drilldown.target_price !== undefined) parts.push(`target ${money(drilldown.target_price)}`);
  return parts.join("; ") || "n/a";
}

export function drilldownMaeMfeText(drilldown) {
  const mae = drilldown.mae_pct === undefined ? "n/a" : pctText(drilldown.mae_pct);
  const mfe = drilldown.mfe_pct === undefined ? "n/a" : pctText(drilldown.mfe_pct);
  return `${mae} / ${mfe}`;
}

export function pluginResultFieldValue(field, value) {
  if (value === undefined || value === null || value === "") return "n/a";
  const kind = text(field.kind || "text");
  const decimals = Number(field.decimals);
  const hasDecimals = Number.isInteger(decimals) && decimals >= 0 && decimals <= 8;
  const prefix = text(field.prefix || "");
  const suffixParts = [field.suffix, field.unit].map((item) => text(item || "")).filter((item) => item && item !== "n/a");
  let formatted = "";
  if (kind === "percent") formatted = pctText(value);
  else if (kind === "currency") formatted = money(value);
  else if (kind === "boolean") formatted = value ? "yes" : "no";
  else if (kind === "duration_minutes") formatted = `${numberText(value, hasDecimals ? decimals : 2)} min`;
  else if (kind === "number") formatted = numberText(value, hasDecimals ? decimals : 4);
  else if (Array.isArray(value)) formatted = value.map((item) => text(item)).join(", ");
  else formatted = text(value);
  if (formatted === "n/a") return formatted;
  return `${prefix && prefix !== "n/a" ? prefix : ""}${formatted}${suffixParts.length ? ` ${suffixParts.join(" ")}` : ""}`;
}

export function pluginResultFieldHelp(field) {
  const parts = [
    text(field.help || ""),
    text(field.description || ""),
    field.kind ? `kind ${text(field.kind)}` : "",
    field.decimals !== undefined ? `${numberText(field.decimals, 0)} decimals` : "",
    field.prefix ? `prefix ${text(field.prefix)}` : "",
    field.suffix ? `suffix ${text(field.suffix)}` : "",
    field.unit ? `unit ${text(field.unit)}` : "",
  ].filter((item) => item && item !== "n/a");
  return parts.length ? parts.join("; ") : "n/a";
}

export function pluginResultDisplayDescriptor(field) {
  const pieces = [
    field.order !== undefined ? `order ${numberText(field.order, 2)}` : "registry order",
    field.kind ? `kind ${text(field.kind)}` : "",
    field.decimals !== undefined ? `${numberText(field.decimals, 0)} decimals` : "",
    field.prefix ? `prefix ${text(field.prefix)}` : "",
    field.suffix ? `suffix ${text(field.suffix)}` : "",
    field.unit ? `unit ${text(field.unit)}` : "",
  ].filter((item) => item && item !== "n/a");
  return pieces.join("; ") || "default text display";
}

export function pluginResultFieldRows(artifacts) {
  const fields = ((artifacts.plugin || {}).result_fields || [])
    .filter((field) => field && field.name)
    .slice(0, 12);
  if (!fields.length) return [];
  const rows = [];
  for (const decision of artifacts.decisions || []) {
    const drilldown = decision.drilldown || {};
    for (const field of fields) {
      if (!(field.name in drilldown)) continue;
      rows.push({
        timestamp: decision.timestamp,
        symbols: decision.symbols || [],
        field,
        value: drilldown[field.name],
      });
      if (rows.length >= 100) return rows;
    }
  }
  return rows;
}

export function pluginFieldList(fields) {
  const names = (fields || [])
    .filter((field) => field && field.name)
    .map((field) => text(field.label || field.name));
  return names.length ? names.join(", ") : "none";
}

export function renderArtifactPluginBoundary(artifacts) {
  if (!$("artifact-plugin-boundary-note") || !$("artifact-plugin-boundary-cards") || !$("artifact-plugin-boundary")) return;
  const plugin = artifacts.plugin || {};
  const summary = artifacts.plugin_result_summary || {};
  const contract = artifacts.plugin_contract || {};
  const contractPlugin = (contract.plugin || {});
  const contractObserved = (contract.observed || {});
  const strategyFields = (plugin.strategy_fields || []).filter((field) => field && field.name);
  const resultFields = (plugin.result_fields || []).filter((field) => field && field.name);
  const resultSections = (plugin.result_sections || []).filter((section) => section && section.id);
  const resultWidgets = (plugin.result_widgets || []).filter((widget) => widget && widget.id);
  const declared = Number(summary.declared_field_count ?? resultFields.length);
  const emittedFields = Number(summary.emitted_field_count || 0);
  const emittedValues = Number(summary.emitted_value_count || 0);
  const decisionCount = Number(summary.decision_count ?? (artifacts.decisions || []).length);
  const unlabeledCount = Number(summary.unlabeled_public_key_count || 0);
  const pluginLabel = text(plugin.label || plugin.id || plugin.spec || contractPlugin.name || contractPlugin.spec || "Unknown plugin");
  const pluginStatus = plugin.matched
    ? plugin.visibility === "public_example" ? "warn" : "ok"
    : "bad";
  $("artifact-plugin-boundary-note").textContent = summary.note || (plugin.matched
    ? `${pluginLabel} metadata loaded from the Workbench plugin registry`
    : "No matching Workbench plugin registry entry for this artifact");
  const cards = [
    {
      status: pluginStatus,
      title: pluginLabel,
      label: "Plugin",
      note: plugin.matched
        ? plugin.visibility === "public_example"
          ? "Public example wiring only; not a viable strategy."
          : text(plugin.boundary || "Local/private plugin metadata.")
        : "Load or restore the matching plugin registry entry for this draft.",
    },
    {
      status: strategyFields.length ? "ok" : "warn",
      title: numberText(strategyFields.length, 0),
      label: "Declared Inputs",
      note: strategyFields.length
        ? pluginFieldList(strategyFields)
        : "No public-safe strategy_fields metadata declared.",
    },
    {
      status: declared ? summary.status || "ok" : "warn",
      title: `${numberText(emittedFields, 0)} / ${numberText(declared, 0)}`,
      label: "Declared Results",
      note: declared
        ? `${numberText(emittedValues, 0)} value${emittedValues === 1 ? "" : "s"} emitted across ${numberText(decisionCount, 0)} loaded decision${decisionCount === 1 ? "" : "s"}.`
        : "Declare result_fields to label public diagnostics in artifacts.",
    },
    {
      status: unlabeledCount ? "warn" : emittedValues ? "ok" : "waiting",
      title: numberText(unlabeledCount, 0),
      label: "Unlabeled Keys",
      note: unlabeledCount
        ? "Sanitized dashboard keys were emitted without result_fields labels."
        : "No extra sanitized dashboard keys beyond declared result metadata.",
    },
    {
      status: contract.available ? "ok" : "warn",
      title: contract.available ? "Loaded" : "Missing",
      label: "Runner Contract",
      note: contract.available
        ? `${numberText(contractObserved.dashboard_keys ? contractObserved.dashboard_keys.length : 0, 0)} public dashboard key${(contractObserved.dashboard_keys || []).length === 1 ? "" : "s"} observed by plugin_runner.`
        : "Older runs may not have plugin_contract.json archived.",
    },
  ];
  $("artifact-plugin-boundary-cards").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  const coverage = declared
    ? `${numberText(emittedFields, 0)} / ${numberText(declared, 0)} fields, ${numberText(emittedValues, 0)} values`
    : "No declared result fields";
  const unlabeledKeys = summary.unlabeled_public_keys || [];
  const contractKeys = contractObserved.dashboard_keys || [];
  const contractArtifacts = (contract.artifacts || []).filter((item) => item && item.name);
  $("artifact-plugin-boundary").innerHTML = kvRows([
    ["Plugin", pluginLabel],
    ["Registry Match", statusText(plugin.matched ? "ok" : "bad"), true],
    ["Runner Contract", statusText(contract.available ? "ok" : "warn"), true],
    ["Visibility", text(plugin.visibility || "n/a")],
    ["Status", text(plugin.status || "n/a")],
    ["Spec", (plugin.spec || contractPlugin.spec) ? `<span class="mono">${escapeHtml(plugin.spec || contractPlugin.spec)}</span>` : "n/a", Boolean(plugin.spec || contractPlugin.spec)],
    ["Plugin Class", text(contractPlugin.class || "n/a")],
    ["Plugin Validators", numberText(contractPlugin.validator_count, 0)],
    ["Boundary", text(plugin.boundary || plugin.description || "n/a")],
    ["Strategy Inputs", jsonDrilldown(strategyFields.map((field) => ({
      name: field.name,
      label: field.label,
      kind: field.kind,
      required: Boolean(field.required),
    })), pluginFieldList(strategyFields)), true],
    ["Result Fields", jsonDrilldown(resultFields.map((field) => ({
      name: field.name,
      label: field.label,
      kind: field.kind,
      unit: field.unit,
      prefix: field.prefix,
      suffix: field.suffix,
      decimals: field.decimals,
    })), pluginFieldList(resultFields)), true],
    ["Result Sections", jsonDrilldown(resultSections.map((section) => ({
      id: section.id,
      label: section.label,
      fields: section.fields,
    })), resultSections.length ? resultSections.map((section) => text(section.label || section.id)).join(", ") : "none"), true],
    ["Result Widgets", jsonDrilldown(resultWidgets.map((widget) => ({
      id: widget.id,
      label: widget.label,
      kind: widget.kind,
      chart_kind: widget.chart_kind,
      point_limit: widget.point_limit,
      fields: widget.fields,
    })), resultWidgets.length ? resultWidgets.map((widget) => `${text(widget.label || widget.id)} (${text(widget.kind)})`).join(", ") : "none"), true],
    ["Result Coverage", `${coverage}; ${numberText(decisionCount, 0)} decision${decisionCount === 1 ? "" : "s"} loaded`],
    ["Observed Dashboard Keys", jsonDrilldown(contractKeys, contractKeys.length ? contractKeys.join(", ") : "none"), true],
    ["Unlabeled Keys", jsonDrilldown(unlabeledKeys, unlabeledKeys.length ? unlabeledKeys.join(", ") : "none"), true],
    ["Contract Artifacts", jsonDrilldown(contractArtifacts, contractArtifacts.length ? `${numberText(contractArtifacts.length, 0)} file records` : "none"), true],
  ]);
}

export function renderArtifactPluginCoverage(artifacts) {
  if (!$("artifact-plugin-coverage-note") || !$("artifact-plugin-coverage-body")) return;
  const summary = artifacts.plugin_result_summary || {};
  const coverageRows = (summary.field_coverage || []).filter((item) => item && item.name);
  const decisionCount = Number(summary.decision_count ?? (artifacts.decisions || []).length);
  renderArtifactPluginResultSections(artifacts, coverageRows, decisionCount);
  renderArtifactPluginWidgetSummary(artifacts, decisionCount);
  renderArtifactPluginResultWidgets(artifacts, coverageRows, decisionCount);
  renderArtifactPluginResultSnapshot(artifacts, coverageRows, decisionCount);
  renderArtifactPluginDisplayPlan(artifacts, coverageRows, decisionCount);
  $("artifact-plugin-coverage-note").textContent = coverageRows.length
    ? `${numberText(summary.emitted_field_count || 0, 0)} / ${numberText(summary.declared_field_count || coverageRows.length, 0)} declared field${coverageRows.length === 1 ? "" : "s"} emitted in ${numberText(decisionCount, 0)} loaded decision${decisionCount === 1 ? "" : "s"}`
    : "No declared plugin result fields to measure";
  $("artifact-plugin-coverage-body").innerHTML = coverageRows.length
    ? coverageRows.map((item) => {
        const emitted = decisionCount
          ? `${numberText(item.emitted_count, 0)} / ${numberText(decisionCount, 0)} (${pctText(item.coverage_pct)})`
          : numberText(item.emitted_count, 0);
        const latestValue = item.latest_timestamp
          ? `${pluginResultFieldValue(item, item.latest_value)} @ ${text(item.latest_timestamp)}`
          : pluginResultFieldValue(item, item.latest_value);
        const latestSymbols = (item.latest_symbols || []).length ? `; ${(item.latest_symbols || []).join(", ")}` : "";
        return row([
          escapeHtml(text(item.label || item.name)),
          escapeHtml(text(item.kind)),
          escapeHtml(emitted),
          escapeHtml(`${latestValue}${latestSymbols}`),
          statusText(item.status || "waiting"),
        ]);
      }).join("")
    : row([`<span class="muted">Declare result_fields in the plugin registry to summarize artifact diagnostics.</span>`, "", "", "", ""]);
}

export function renderArtifactPluginResultSections(artifacts, coverageRows = [], decisionCount = 0) {
  if (!$("artifact-plugin-result-sections")) return;
  const summary = artifacts.plugin_result_summary || {};
  const sections = (summary.section_coverage || []).filter((section) => section && section.id);
  if (!sections.length) {
    $("artifact-plugin-result-sections").innerHTML = "";
    return;
  }
  const coverageByName = new Map((coverageRows || []).map((item) => [text(item.name), item]));
  $("artifact-plugin-result-sections").innerHTML = sections.slice(0, 8).map((section) => {
    const status = section.status || "waiting";
    const fields = (section.fields || []).slice(0, 6).map((name) => {
      const coverage = coverageByName.get(text(name)) || {};
      const emitted = Number(coverage.emitted_count || 0);
      const value = emitted ? pluginResultFieldValue(coverage, coverage.latest_value) : "n/a";
      const label = text(coverage.label || name);
      return `<span><b>${escapeHtml(label)}</b> ${escapeHtml(value)}</span>`;
    }).join("");
    const note = [
      `${numberText(section.emitted_field_count || 0, 0)} / ${numberText(section.field_count || 0, 0)} fields emitted`,
      decisionCount ? `${numberText(decisionCount, 0)} loaded decisions` : "no loaded decisions",
      text(section.description || section.help || ""),
    ].filter((item) => item && item !== "n/a").join("; ");
    return `
      <article class="plugin-result-display-card status-${escapeHtml(status)}">
        <span>${statusText(status)}</span>
        <strong>${escapeHtml(text(section.label || section.id))}</strong>
        <p>${escapeHtml(pctText(section.field_coverage_pct))}</p>
        <small>${escapeHtml(note)}</small>
        <small>${fields || "No declared fields in this section."}</small>
      </article>
    `;
  }).join("");
}

export function pluginResultSparkline(points = [], label = "plugin result trend") {
  const values = (points || [])
    .map((point) => finiteNumber(point.value))
    .filter((value) => value !== null);
  if (values.length < 2) return `<span class="muted">No trend yet</span>`;
  const width = 220;
  const height = 52;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const coords = values.map((value, index) => {
    const x = values.length === 1 ? 0 : (index / (values.length - 1)) * width;
    const y = height - ((value - min) / span) * height;
    return `${x.toFixed(1)},${y.toFixed(1)}`;
  }).join(" ");
  const cls = values[values.length - 1] >= values[0] ? "spark-good" : "spark-bad";
  const caption = `${text(label)} ${numberText(values[0])} to ${numberText(values[values.length - 1])}`;
  return `<svg class="plugin-widget-sparkline-chart ${cls}" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(text(label))}"><polyline points="${coords}"><title>${escapeHtml(caption)}</title></polyline></svg>`;
}

export function pluginResultLineChart(fieldRows = [], label = "plugin result chart") {
  const series = (fieldRows || [])
    .map((field, index) => ({
      name: text(field.label || field.name || `Series ${index + 1}`),
      className: `plugin-series-${index % 6}`,
      values: (field.points || [])
        .map((point, pointIndex) => ({
          index: pointIndex,
          timestamp: point.timestamp,
          value: finiteNumber(point.value),
        }))
        .filter((point) => point.value !== null),
    }))
    .filter((item) => item.values.length >= 2)
    .slice(0, 6);
  if (!series.length) return `<span class="muted">No chart points yet</span>`;
  const allValues = series.flatMap((item) => item.values.map((point) => point.value));
  const min = Math.min(...allValues);
  const max = Math.max(...allValues);
  const span = max - min || 1;
  const maxPoints = Math.max(...series.map((item) => item.values.length));
  const width = 420;
  const height = 170;
  const pad = 18;
  const chartWidth = width - pad * 2;
  const chartHeight = height - pad * 2;
  const zeroY = min < 0 && max > 0
    ? pad + chartHeight - ((0 - min) / span) * chartHeight
    : null;
  const zeroLine = zeroY === null
    ? ""
    : `<line class="plugin-widget-line-zero" x1="${pad}" x2="${width - pad}" y1="${zeroY.toFixed(1)}" y2="${zeroY.toFixed(1)}"></line>`;
  const paths = series.map((item) => {
    const coords = item.values.map((point, pointIndex) => {
      const x = pad + (maxPoints <= 1 ? 0 : (pointIndex / (maxPoints - 1)) * chartWidth);
      const y = pad + chartHeight - ((point.value - min) / span) * chartHeight;
      return `${x.toFixed(1)},${y.toFixed(1)}`;
    }).join(" ");
    const first = item.values[0].value;
    const last = item.values[item.values.length - 1].value;
    const title = `${item.name} ${numberText(first)} to ${numberText(last)} across ${numberText(item.values.length, 0)} points`;
    return `<polyline class="${escapeHtml(item.className)}" points="${coords}"><title>${escapeHtml(title)}</title></polyline>`;
  }).join("");
  const legend = series.map((item) => `
    <span><i class="${escapeHtml(item.className)}"></i>${escapeHtml(item.name)}</span>
  `).join("");
  const caption = `${text(label)} / ${numberText(series.length, 0)} series / ${numberText(maxPoints, 0)} max points`;
  return `
    <svg class="plugin-widget-line-chart" viewBox="0 0 ${width} ${height}" role="img" aria-label="${escapeHtml(text(label))}">
      ${zeroLine}
      ${paths}
    </svg>
    <div class="plugin-widget-line-legend">${legend}</div>
    <small>${escapeHtml(caption)}</small>
  `;
}

export function renderArtifactPluginWidgetSummary(artifacts, decisionCount = 0) {
  if (!$("artifact-plugin-widget-summary")) return;
  const summary = artifacts.plugin_result_summary || {};
  const widgets = (summary.widget_coverage || []).filter((widget) => widget && widget.id);
  const declaredWidgets = ((artifacts.plugin || {}).result_widgets || []).filter((widget) => widget && widget.id);
  if (!widgets.length && !declaredWidgets.length) {
    $("artifact-plugin-widget-summary").innerHTML = `
      <div class="empty-card">
        <span>Result Widgets</span>
        <strong>No Widgets Declared</strong>
        <small>Declare public-safe result_widgets in the plugin registry to render card, table, bar, sparkline, line-chart, or custom-chart artifact summaries.</small>
      </div>
    `;
    return;
  }
  const emittedWidgets = widgets.filter((widget) => Number(widget.emitted_field_count || 0) > 0).length;
  const chartWidgets = widgets.filter((widget) => ["sparkline", "line_chart", "custom_chart"].includes(text(widget.kind))).length;
  const totalFields = widgets.reduce((sum, widget) => sum + Number(widget.field_count || 0), 0);
  const emittedFields = widgets.reduce((sum, widget) => sum + Number(widget.emitted_field_count || 0), 0);
  const pointCount = widgets.reduce((sum, widget) => (
    sum + (widget.field_summaries || []).reduce((inner, field) => inner + (field.points || []).length, 0)
  ), 0);
  const incompleteWidgets = widgets.filter((widget) => text(widget.status) !== "ok" || Number(widget.emitted_field_count || 0) < Number(widget.field_count || 0));
  const kindCounts = widgets.reduce((counts, widget) => {
    const kind = text(widget.kind || "cards");
    counts[kind] = (counts[kind] || 0) + 1;
    return counts;
  }, {});
  const coveragePct = totalFields ? (emittedFields / totalFields) * 100 : null;
  const nextStatus = !decisionCount ? "waiting" : incompleteWidgets.length ? "warn" : emittedWidgets ? "ok" : "bad";
  const nextTitle = !decisionCount
    ? "Load Decisions"
    : incompleteWidgets.length
      ? "Review Missing Widget Fields"
      : emittedWidgets
        ? "Widgets Ready"
        : "No Widget Values";
  const nextNote = !decisionCount
    ? "Widget coverage appears after artifact decisions with matching diagnostics.dashboard fields are loaded."
    : incompleteWidgets.length
      ? `${numberText(incompleteWidgets.length, 0)} widget${incompleteWidgets.length === 1 ? "" : "s"} have missing declared fields or non-ok coverage.`
      : emittedWidgets
        ? "Declared widgets have emitted public-safe result values."
        : "Declared widgets exist, but no fields were emitted by loaded decisions.";
  const cards = [
    {
      status: widgets.length ? "ok" : "warn",
      label: "Declared Widgets",
      title: numberText(widgets.length || declaredWidgets.length, 0),
      note: countSummary(kindCounts) || "Widget metadata is declared, but coverage has not been summarized yet.",
    },
    {
      status: emittedWidgets ? "ok" : decisionCount ? "bad" : "waiting",
      label: "Emitted Widgets",
      title: `${numberText(emittedWidgets, 0)} / ${numberText(widgets.length || declaredWidgets.length, 0)}`,
      note: `${numberText(emittedFields, 0)} / ${numberText(totalFields, 0)} declared widget field${totalFields === 1 ? "" : "s"} emitted (${pctText(coveragePct)}).`,
    },
    {
      status: chartWidgets ? pointCount ? "ok" : "warn" : "waiting",
      label: "Chart Widgets",
      title: numberText(chartWidgets, 0),
      note: chartWidgets
        ? `${numberText(pointCount, 0)} bounded point${pointCount === 1 ? "" : "s"} available for sparkline/line/custom-chart widgets.`
        : "No sparkline, line-chart, or custom-chart widgets declared.",
    },
    {
      status: nextStatus,
      label: "Next Action",
      title: nextTitle,
      note: nextNote,
    },
  ];
  $("artifact-plugin-widget-summary").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function renderArtifactPluginResultWidgets(artifacts, coverageRows = [], decisionCount = 0) {
  if (!$("artifact-plugin-result-widgets")) return;
  const summary = artifacts.plugin_result_summary || {};
  const widgets = (summary.widget_coverage || []).filter((widget) => widget && widget.id);
  if (!widgets.length) {
    $("artifact-plugin-result-widgets").innerHTML = "";
    return;
  }
  $("artifact-plugin-result-widgets").innerHTML = widgets.slice(0, 8).map((widget) => {
    const status = widget.status || "waiting";
    const kind = text(widget.kind || "cards");
    const fieldRows = (widget.field_summaries || []).slice(0, 8);
    let body = "";
    if (kind === "table") {
      body = `<table class="mini-table"><tbody>${fieldRows.map((field) => `
        <tr>
          <td>${escapeHtml(text(field.label || field.name))}</td>
          <td>${escapeHtml(pluginResultFieldValue(field, field.latest_value))}</td>
          <td>${escapeHtml(numberText(field.emitted_count, 0))}</td>
        </tr>
      `).join("")}</tbody></table>`;
    } else if (kind === "bar_summary") {
      body = `<div class="plugin-widget-bars">${fieldRows.map((field) => {
        const pct = finiteNumber(field.coverage_pct) ?? 0;
        return `
          <span><b>${escapeHtml(text(field.label || field.name))}</b><i style="width:${Math.max(0, Math.min(100, pct)).toFixed(1)}%"></i><em>${escapeHtml(pctText(field.coverage_pct))}</em></span>
        `;
      }).join("")}</div>`;
    } else if (kind === "sparkline" || (kind === "custom_chart" && text(widget.chart_kind || "line_chart") === "sparkline")) {
      body = `<div class="plugin-widget-sparklines">${fieldRows.map((field) => `
        <div>
          <span><b>${escapeHtml(text(field.label || field.name))}</b><em>${escapeHtml(pluginResultFieldValue(field, field.latest_value))}</em></span>
          ${pluginResultSparkline(field.points || [], field.label || field.name)}
        </div>
      `).join("")}</div>`;
    } else if (kind === "line_chart" || kind === "custom_chart") {
      body = `<div class="plugin-widget-line-chart-wrap">${pluginResultLineChart(fieldRows, widget.label || widget.id)}</div>`;
    } else {
      body = `<div class="plugin-widget-card-list">${fieldRows.map((field) => `
        <span><b>${escapeHtml(text(field.label || field.name))}</b> ${escapeHtml(pluginResultFieldValue(field, field.latest_value))}</span>
      `).join("")}</div>`;
    }
    const note = [
      `${numberText(widget.emitted_field_count || 0, 0)} / ${numberText(widget.field_count || 0, 0)} fields emitted`,
      decisionCount ? `${numberText(decisionCount, 0)} loaded decisions` : "no loaded decisions",
      text(widget.description || widget.help || ""),
    ].filter((item) => item && item !== "n/a").join("; ");
    return `
      <article class="plugin-result-display-card status-${escapeHtml(status)} plugin-result-widget plugin-result-widget-${escapeHtml(kind)}">
        <span>${statusText(status)} ${escapeHtml(kind)}</span>
        <strong>${escapeHtml(text(widget.label || widget.id))}</strong>
        <small>${escapeHtml(note)}</small>
        ${body || "<small>No widget fields emitted yet.</small>"}
      </article>
    `;
  }).join("");
}

export function renderArtifactPluginDisplayPlan(artifacts, coverageRows = [], decisionCount = 0) {
  if (!$("artifact-plugin-display-plan")) return;
  const declaredFields = ((artifacts.plugin || {}).result_fields || []).filter((field) => field && field.name);
  if (!declaredFields.length) {
    $("artifact-plugin-display-plan").innerHTML = "";
    return;
  }
  const coverageByName = new Map((coverageRows || []).map((item) => [text(item.name), item]));
  $("artifact-plugin-display-plan").innerHTML = declaredFields
    .slice()
    .sort((left, right) => Number(left.order || 999) - Number(right.order || 999) || text(left.label || left.name).localeCompare(text(right.label || right.name)))
    .slice(0, 12)
    .map((field) => {
      const coverage = coverageByName.get(text(field.name)) || {};
      const emitted = Number(coverage.emitted_count || 0);
      const status = emitted ? coverage.status || "ok" : decisionCount ? "warn" : "waiting";
      const latestValue = emitted ? pluginResultFieldValue({ ...field, ...coverage }, coverage.latest_value) : "n/a";
      const coverageText = decisionCount
        ? `${numberText(emitted, 0)} / ${numberText(decisionCount, 0)} decisions`
        : "no loaded decisions";
      const help = text(field.help || field.description || "No help text declared.");
      return `
        <article class="plugin-result-display-card status-${escapeHtml(status)}">
          <span>${statusText(status)}</span>
          <strong>${escapeHtml(text(field.label || field.name))}</strong>
          <small class="mono">${escapeHtml(`diagnostics.dashboard.${field.name}`)}</small>
          <p>${escapeHtml(latestValue)}</p>
          <small>${escapeHtml(`${coverageText}; ${pluginResultDisplayDescriptor(field)}. ${help}`)}</small>
        </article>
      `;
    }).join("");
}

export function renderArtifactPluginResultSnapshot(artifacts, coverageRows = [], decisionCount = 0) {
  if (!$("artifact-plugin-result-snapshot")) return;
  const declaredFields = ((artifacts.plugin || {}).result_fields || []).filter((field) => field && field.name);
  if (!declaredFields.length) {
    $("artifact-plugin-result-snapshot").innerHTML = `
      <div class="empty-card">
        <span>Plugin Results</span>
        <strong>No Declared Fields</strong>
        <small>Declare public-safe result_fields in the plugin registry to build custom result cards.</small>
      </div>
    `;
    return;
  }
  const coverageByName = new Map((coverageRows || []).map((item) => [text(item.name), item]));
  const cards = declaredFields
    .slice()
    .sort((left, right) => Number(left.order || 999) - Number(right.order || 999) || text(left.label || left.name).localeCompare(text(right.label || right.name)))
    .slice(0, 8)
    .map((field) => {
      const coverage = coverageByName.get(text(field.name)) || {};
      const emitted = Number(coverage.emitted_count || 0);
      const status = emitted ? coverage.status || "ok" : decisionCount ? "warn" : "waiting";
      const value = emitted ? pluginResultFieldValue({ ...field, ...coverage }, coverage.latest_value) : "n/a";
      const latest = coverage.latest_timestamp ? `Latest ${timestampAgeLabel(coverage.latest_timestamp)}.` : "No emitted value in loaded decisions.";
      const help = text(field.help || field.description || "");
      const symbols = (coverage.latest_symbols || []).length ? ` Symbols ${(coverage.latest_symbols || []).join(", ")}.` : "";
      return {
        status,
        label: text(field.label || field.name),
        value,
        note: `${emitted ? `${numberText(emitted, 0)} / ${numberText(decisionCount, 0)} decisions. ` : ""}${latest}${symbols}${help && help !== "n/a" ? ` ${help}` : ""}`,
      };
    });
  $("artifact-plugin-result-snapshot").innerHTML = cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.value)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
}

export function workbenchArtifactsAssistantModel(artifacts = state.configArtifacts || {}) {
  const summary = artifacts.summary || {};
  const performance = artifacts.performance || {};
  const pluginSummary = artifacts.plugin_result_summary || {};
  const performanceRollups = artifacts.performance_rollups || {};
  const decisions = artifacts.decisions || [];
  const orders = artifacts.orders || [];
  const fills = artifacts.fills || [];
  const account = artifacts.account || [];
  const orderPreviews = artifacts.order_previews || [];
  const hasArtifacts = Boolean(artifacts.run_id || artifacts.draft_id || artifacts.output_dir);
  const runId = text(artifacts.run_id || "n/a");
  const draftId = text(artifacts.draft_id || "n/a");
  const rejectCount = finiteNumber(summary.rejections) ?? orders.filter((order) => text(order.status).toLowerCase().includes("reject")).length;
  const fillCount = finiteNumber(summary.fills) ?? fills.length;
  const decisionCount = finiteNumber(summary.decisions) ?? decisions.length;
  const accountCount = finiteNumber(performance.account_snapshot_count) ?? account.length;
  const returnPct = finiteNumber(performance.total_return_pct);
  const drawdownPct = finiteNumber(performance.max_drawdown_pct);
  const emittedFields = finiteNumber(pluginSummary.emitted_field_count) || 0;
  const declaredFields = finiteNumber(pluginSummary.declared_field_count) || ((artifacts.plugin || {}).result_fields || []).length;
  const unlabeledFields = finiteNumber(pluginSummary.unlabeled_public_key_count) || 0;
  const rollupCount = ((performanceRollups || {}).rollups || []).length;
  const hasLog = Boolean(state.runDetail && (state.runDetail.run_id === artifacts.run_id || state.runDetail.draft_id === artifacts.draft_id));
  let status = "idle";
  let title = "Load Artifacts";
  let note = "Open Results or Artifacts from a completed Workbench run.";
  if (hasArtifacts) {
    status = rejectCount > 0 || unlabeledFields > 0 ? "warn" : "ok";
    title = rejectCount > 0 ? "Review Execution" : emittedFields || declaredFields ? "Inspect Results" : "Artifacts Loaded";
    note = rejectCount > 0
      ? "Rejected orders are present; inspect orders, fills, and logs before trusting the run."
      : "Use Performance for charts, Runs for timelines, and the plugin tables for public-safe strategy evidence.";
  }
  const cards = [
    {
      status: hasArtifacts ? "ok" : "idle",
      title: hasArtifacts ? runId : "None",
      label: "Loaded Run",
      note: hasArtifacts ? `${draftId}; output ${text(artifacts.output_dir)}.` : "No run artifact payload is loaded.",
    },
    {
      status: returnPct === null ? hasArtifacts ? "warn" : "bad" : returnPct >= 0 ? "ok" : "bad",
      title: pctText(returnPct),
      label: "Return",
      note: `Drawdown ${pctText(drawdownPct)}; ${numberText(accountCount, 0)} account snapshot${accountCount === 1 ? "" : "s"}.`,
    },
    {
      status: rejectCount > 0 ? "bad" : fillCount > 0 ? "ok" : decisionCount > 0 ? "warn" : hasArtifacts ? "warn" : "bad",
      title: `${numberText(fillCount, 0)} fills`,
      label: "Execution",
      note: `${numberText(decisionCount, 0)} decisions / ${numberText(orders.length, 0)} orders / ${numberText(rejectCount, 0)} rejects.`,
    },
    {
      status: declaredFields ? unlabeledFields ? "warn" : emittedFields ? "ok" : "warn" : hasArtifacts ? "warn" : "bad",
      title: declaredFields ? `${numberText(emittedFields, 0)} / ${numberText(declaredFields, 0)}` : "Undeclared",
      label: "Plugin Results",
      note: unlabeledFields
        ? `${numberText(unlabeledFields, 0)} sanitized key${unlabeledFields === 1 ? "" : "s"} lack result-field labels.`
        : declaredFields ? "Declared result fields are available for this artifact." : "No public-safe result_fields metadata declared.",
    },
    {
      status: rollupCount ? "ok" : hasArtifacts ? "warn" : "idle",
      title: numberText(rollupCount, 0),
      label: "Rollups",
      note: rollupCount ? "Runner-owned daily rollups are loaded." : "No performance_rollups.json data loaded.",
    },
    {
      status: orderPreviews.length ? "warn" : hasArtifacts ? "ok" : "bad",
      title: numberText(orderPreviews.length, 0),
      label: "Order Previews",
      note: orderPreviews.length ? "Manual approval previews require operator review." : "No held order previews in this artifact.",
    },
  ];
  const actions = [
    {
      action: "performance",
      status: hasArtifacts ? "ok" : "bad",
      title: "Open Performance",
      note: "Show this artifact's equity, drawdown, rollups, and trade summaries.",
      disabled: !hasArtifacts,
    },
    {
      action: "runs",
      status: hasArtifacts ? "ok" : "bad",
      title: "Open Runs",
      note: "Inspect run state, event timelines, orders, fills, and decisions.",
      disabled: !hasArtifacts,
    },
    {
      action: "log",
      status: hasLog ? "ok" : hasArtifacts ? "warn" : "bad",
      title: "Open Log",
      note: hasLog ? "Run log evidence is already loaded." : "Load bounded stdout/stderr and artifact evidence for this run.",
      disabled: !hasArtifacts || !artifacts.run_id,
    },
    {
      action: "export",
      status: artifacts.run_id ? "ok" : "bad",
      title: "Export JSON",
      note: "Download the bounded public-safe artifact payload.",
      disabled: !artifacts.run_id,
    },
  ];
  return { status, title, note, cards, actions };
}

export function latestLoadableWorkbenchRun() {
  return ((state.configRuns && state.configRuns.runs) || [])
    .find((run) => run && (run.run_id || run.draft_id) && text(run.status) === "completed" && text(run.action) !== "validate") || null;
}

export function workbenchArtifactsActionSummaryModel(artifacts = state.configArtifacts || {}) {
  const savedRuns = (state.configRuns && state.configRuns.runs) || [];
  const loadableRun = latestLoadableWorkbenchRun();
  const summary = artifacts.summary || {};
  const performance = artifacts.performance || {};
  const pluginSummary = artifacts.plugin_result_summary || {};
  const decisions = artifacts.decisions || [];
  const orders = artifacts.orders || [];
  const fills = artifacts.fills || [];
  const logsLoaded = Boolean(state.runDetail && (state.runDetail.run_id === artifacts.run_id || state.runDetail.draft_id === artifacts.draft_id));
  const loaded = Boolean(artifacts.run_id || artifacts.draft_id || artifacts.output_dir);
  const runId = text(artifacts.run_id || (loadableRun && loadableRun.run_id) || "none");
  const draftId = text(artifacts.draft_id || (loadableRun && loadableRun.draft_id) || "none");
  const rejects = finiteNumber(summary.rejections) ?? orders.filter((order) => text(order.status).toLowerCase().includes("reject")).length;
  const approvalHolds = finiteNumber(summary.approval_required_orders) || (artifacts.order_previews || []).length;
  const accountRows = finiteNumber(performance.account_snapshot_count) ?? (artifacts.account || []).length;
  const returnPct = finiteNumber(performance.total_return_pct);
  const drawdownPct = finiteNumber(performance.max_drawdown_pct);
  const emittedFields = finiteNumber(pluginSummary.emitted_field_count) || 0;
  const declaredFields = finiteNumber(pluginSummary.declared_field_count) || ((artifacts.plugin || {}).result_fields || []).length;
  const unlabeledKeys = finiteNumber(pluginSummary.unlabeled_public_key_count) || 0;
  const rollups = ((artifacts.performance_rollups || {}).rollups || []).length;
  let status = "idle";
  let title = "Load Latest Artifact";
  let note = savedRuns.length
    ? `${numberText(savedRuns.length, 0)} saved run${savedRuns.length === 1 ? "" : "s"} are available; load one before reading artifact detail.`
    : "No saved Workbench run artifacts are visible yet. Run a replay or simulated-paper draft first.";
  if (loaded) {
    status = rejects || approvalHolds || unlabeledKeys ? "warn" : "ok";
    title = rejects ? "Review Execution" : approvalHolds ? "Review Held Orders" : "Use Loaded Results";
    note = rejects
      ? `${numberText(rejects, 0)} rejection${rejects === 1 ? "" : "s"} are present; inspect orders, logs, and Runs before trusting results.`
      : approvalHolds
        ? `${numberText(approvalHolds, 0)} order preview/approval hold${approvalHolds === 1 ? "" : "s"} need operator review.`
        : "Loaded artifacts are ready for Performance, Runs, plugin result review, logs, or JSON export.";
  } else if (loadableRun) {
    status = "warn";
    title = "Load Latest Completed Run";
    note = `${text(loadableRun.draft_id)} / ${text(loadableRun.run_id)} can be loaded for artifact inspection.`;
  }
  const cards = [
    {
      label: "Artifact State",
      status: loaded ? "ok" : loadableRun ? "warn" : "idle",
      title: loaded ? "Loaded" : loadableRun ? "Available" : "Missing",
      note: loaded ? `${draftId} / ${runId}` : loadableRun ? "Completed run exists but is not loaded." : "No completed run artifact is available.",
    },
    {
      label: "Result",
      status: returnPct === null ? loaded ? "warn" : "idle" : returnPct >= 0 ? "ok" : "bad",
      title: loaded ? pctText(returnPct) : "n/a",
      note: loaded ? `Drawdown ${pctText(drawdownPct)}; ${numberText(accountRows, 0)} account snapshot${accountRows === 1 ? "" : "s"}.` : "Load artifacts for return and drawdown.",
    },
    {
      label: "Execution",
      status: rejects ? "bad" : approvalHolds ? "warn" : fills.length ? "ok" : decisions.length ? "warn" : loaded ? "warn" : "bad",
      title: `${numberText(fills.length, 0)} fills / ${numberText(rejects, 0)} rejects`,
      note: `${numberText(decisions.length, 0)} decisions / ${numberText(orders.length, 0)} orders / ${numberText(approvalHolds, 0)} approval holds.`,
    },
    {
      label: "Plugin Evidence",
      status: unlabeledKeys ? "warn" : emittedFields ? "ok" : declaredFields ? "warn" : loaded ? "warn" : "idle",
      title: declaredFields ? `${numberText(emittedFields, 0)} / ${numberText(declaredFields, 0)}` : "none",
      note: unlabeledKeys ? `${numberText(unlabeledKeys, 0)} public keys lack declared labels.` : "Declared result fields drive the plugin result cards below.",
    },
    {
      label: "Logs / Rollups",
      status: logsLoaded && rollups ? "ok" : loaded ? "warn" : "idle",
      title: `${logsLoaded ? "log" : "no log"} / ${numberText(rollups, 0)} rollups`,
      note: logsLoaded ? "Bounded stdout/stderr evidence is loaded." : "Open Log for bounded stdout/stderr and artifact evidence.",
    },
    {
      label: "Next Move",
      status,
      title,
      note,
    },
  ];
  const actions = [
    { action: "load-latest", label: "Load", title: "Load Latest", disabled: loaded || !loadableRun },
    { action: "performance", label: "Performance", title: "Open Performance", disabled: !loaded },
    { action: "runs", label: "Runs", title: "Open Runs", disabled: !loaded },
    { action: "log", label: "Log", title: "Open Log", disabled: !loaded || !artifacts.run_id },
    { action: "export", label: "Export", title: "Export JSON", disabled: !loaded || !artifacts.run_id },
    { action: "run", label: "Run", title: "Run Draft", disabled: false },
  ];
  return { status, title, note, cards, actions, loadableRun };
}

export function renderWorkbenchArtifactsActionSummary(artifacts = state.configArtifacts || {}) {
  if (!$("workbench-artifacts-action-note") || !$("workbench-artifacts-action-cards") || !$("workbench-artifacts-action-actions")) return;
  const model = workbenchArtifactsActionSummaryModel(artifacts);
  $("workbench-artifacts-action-note").textContent = `${model.title}: ${model.note}`;
  $("workbench-artifacts-action-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${escapeHtml(card.label)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-artifacts-action-actions").innerHTML = model.actions.map((action) => `
    <button type="button" class="${action.disabled ? "secondary" : ""}" data-workbench-artifacts-summary-action="${escapeHtml(action.action)}" ${action.disabled ? "disabled" : ""}>
      <span>${escapeHtml(action.title)}</span>
      <b>${escapeHtml(action.label)}</b>
    </button>
  `).join("");
}

export async function handleWorkbenchArtifactsActionSummary(action) {
  if (action === "load-latest") {
    const run = latestLoadableWorkbenchRun();
    if (!run) throw new Error("No completed Workbench run is available to load");
    if (run.run_id && run.artifact_path) {
      await loadRunArtifacts(run.run_id);
      return;
    }
    if (run.draft_id) {
      await loadConfigArtifacts(run.draft_id);
      return;
    }
    throw new Error("Latest completed run has no loadable run_id or draft_id");
  }
  if (action === "performance") {
    navigateToView("performance");
    return;
  }
  if (action === "runs") {
    navigateToRunsLens("events");
    return;
  }
  if (action === "log") {
    const runId = state.configArtifacts && state.configArtifacts.run_id;
    if (!runId) throw new Error("No run id is loaded for log inspection");
    await loadRunDetail(runId);
    return;
  }
  if (action === "export") {
    await downloadRunArtifactsJson();
    return;
  }
  if (action === "run") {
    navigateToWorkbenchLens("run");
  }
}

export function renderWorkbenchArtifactsAssistant(artifacts = state.configArtifacts || {}) {
  if (!$("workbench-artifacts-assistant-title") || !$("workbench-artifacts-assistant-cards") || !$("workbench-artifacts-assistant-actions")) return;
  const model = workbenchArtifactsAssistantModel(artifacts);
  $("workbench-artifacts-assistant-title").textContent = model.title;
  $("workbench-artifacts-assistant-title").className = statusClass(model.status);
  $("workbench-artifacts-assistant-note").textContent = model.note;
  $("workbench-artifacts-assistant-cards").innerHTML = model.cards.map((card) => `
    <div class="action-card status-${escapeHtml(card.status)}">
      <span>${statusText(card.status)}</span>
      <strong>${escapeHtml(card.title)}</strong>
      <small>${escapeHtml(card.label)} - ${escapeHtml(card.note)}</small>
    </div>
  `).join("");
  $("workbench-artifacts-assistant-actions").innerHTML = model.actions.map((item) => `
    <button class="workbench-artifacts-assistant-action status-${escapeHtml(item.status)}" data-workbench-artifacts-action="${escapeHtml(item.action)}" type="button"${item.disabled ? " disabled" : ""}>
      <span>
        <strong>${escapeHtml(item.title)}</strong>
        <small>${escapeHtml(item.note)}</small>
      </span>
      <span>${statusText(item.status)}</span>
    </button>
  `).join("");
}

export async function handleWorkbenchArtifactsAssistantAction(action) {
  if (action === "performance") {
    navigateToView("performance");
    return;
  }
  if (action === "runs") {
    navigateToRunsLens("events");
    return;
  }
  if (action === "log") {
    const runId = state.configArtifacts && state.configArtifacts.run_id;
    if (!runId) throw new Error("No run id is loaded for log inspection");
    await loadRunDetail(runId);
    return;
  }
  if (action === "export") {
    await downloadRunArtifactsJson();
  }
}

export function artifactChartMarkers(artifacts) {
  const markers = [];
  for (const fill of artifacts.fills || []) {
    markers.push({
      timestamp: fill.timestamp,
      type: normalizedFillSide(fill.side) === "sell" ? "exit-fill" : "entry-fill",
      symbol: fill.symbol,
      label: `${text(fill.side)} ${numberText(fill.quantity, 4)} @ ${money(fill.price)}`,
    });
  }
  for (const decision of artifacts.decisions || []) {
    const drilldown = decision.drilldown || {};
    if (drilldown.entry_marker) {
      markers.push({
        timestamp: decision.timestamp,
        type: "entry-marker",
        symbol: (decision.symbols || []).slice(0, 3).join(", "),
        label: text(drilldown.entry_marker),
      });
    }
    if (drilldown.exit_marker) {
      markers.push({
        timestamp: decision.timestamp,
        type: "exit-marker",
        symbol: (decision.symbols || []).slice(0, 3).join(", "),
        label: text(drilldown.exit_marker),
      });
    }
  }
  return markers;
}

export function renderWorkbenchArtifacts() {
  const artifacts = state.configArtifacts || {};
  const summary = artifacts.summary || {};
  const performance = artifacts.performance || {};
  $("artifact-title").textContent = artifacts.run_id
    ? `${artifacts.draft_id} / ${artifacts.run_id} - ${text(artifacts.output_dir)}`
    : artifacts.draft_id
      ? `${artifacts.draft_id} - ${text(artifacts.output_dir)}`
    : "No run selected";
  renderWorkbenchArtifactsActionSummary(artifacts);
  renderWorkbenchArtifactsAssistant(artifacts);
  const pairs = [
    ["Mode", text(summary.mode)],
    ["Decisions", text(summary.decisions)],
    ["Orders", text(summary.orders)],
    ["Fills", text(summary.fills)],
    ["Rejections", text(summary.rejections)],
    ["Approval Holds", text(summary.approval_required_orders)],
    ["Loop", summary.loop_enabled ? `${numberText(summary.loop_iterations, 0)} iterations` : "one-shot"],
    ["Lifecycle", summary.stopped_by_control ? `stopped by ${text(summary.stop_marker)}` : "running/complete"],
    ["Session", summary.session_enabled ? `${text(summary.session_status)} / idle ${numberText(summary.session_idle_iterations, 0)}` : "unrestricted"],
    ["Snapshots", text(performance.account_snapshot_count)],
    ["Initial Equity", money(performance.initial_equity)],
    ["Final Cash", money(summary.final_cash)],
    ["Final Equity", money(performance.final_equity ?? summary.final_equity)],
    ["Realized PnL", money(performance.realized_pnl ?? summary.realized_pnl)],
    ["Unrealized PnL", money(performance.unrealized_pnl ?? summary.unrealized_pnl)],
    ["Total PnL", money(performance.total_pnl ?? summary.total_pnl)],
    ["Total Commission", money(performance.total_commission ?? summary.total_commission)],
    ["Total Borrow Fees", money(performance.total_borrow_fees ?? summary.total_borrow_fees)],
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
    ["Positions", jsonDrilldown(summary.final_positions || {}, objectSummary(summary.final_positions || {})), true],
  ];
  $("artifact-summary").innerHTML = kvRows(pairs);
  $("artifact-equity-chart").innerHTML = equityChart(artifacts.account || [], artifactChartMarkers(artifacts));
  renderArtifactPluginBoundary(artifacts);
  const timeline = artifactSessionRows(artifacts);
  $("artifact-session-body").innerHTML = timeline.length
    ? timeline.map((item) => row([
        escapeHtml(item.timestamp),
        statusText(item.type),
        statusText(item.status),
        escapeHtml(text(item.symbol)),
        escapeHtml(item.detail),
      ])).join("")
    : row([`<span class="muted">No decisions, orders, fills, or account snapshots in this artifact.</span>`, "", "", "", ""]);
  const performanceRollups = artifacts.performance_rollups || {};
  const dailyRollups = performanceRollups.rollups || [];
  const periodRollups = performanceRollups.period_rollups || {};
  const periodRows = [
    ...(periodRollups.month || []),
    ...(periodRollups.year || []),
  ];
  $("artifact-performance-rollups-note").textContent = performanceRollups.available
    ? `${numberText(dailyRollups.length, 0)} shown / ${numberText(performanceRollups.total || dailyRollups.length, 0)} runner-owned day rollup${(performanceRollups.total || dailyRollups.length) === 1 ? "" : "s"}`
    : "No performance_rollups.json artifact loaded";
  $("artifact-performance-rollups-body").innerHTML = dailyRollups.length
    ? dailyRollups.map((item) => row([
        escapeHtml(item.day),
        escapeHtml(text(item.mode)),
        escapeHtml(numberText(item.snapshot_count, 0)),
        escapeHtml(pctText(item.daily_return_pct)),
        escapeHtml(money(item.start_equity)),
        escapeHtml(money(item.end_equity)),
        escapeHtml(money(item.max_gross_exposure)),
        escapeHtml(money(item.total_pnl)),
      ])).join("")
    : row([`<span class="muted">Runner-owned rollups appear when performance_rollups.json is archived with the run.</span>`, "", "", "", "", "", "", ""]);
  $("artifact-performance-period-rollups-note").textContent = performanceRollups.available
    ? `${numberText(periodRows.length, 0)} runner-owned month/year period rollup${periodRows.length === 1 ? "" : "s"}`
    : "No runner-owned period rollups loaded";
  $("artifact-performance-period-rollups-body").innerHTML = periodRows.length
    ? periodRows.map((item) => row([
        escapeHtml(text(item.period)),
        escapeHtml(text(item.label)),
        escapeHtml(numberText(item.day_count, 0)),
        escapeHtml(pctText(item.total_return_pct)),
        escapeHtml(money(item.start_equity)),
        escapeHtml(money(item.end_equity)),
        escapeHtml(numberText(item.snapshot_count, 0)),
        escapeHtml(numberText(item.max_position_count, 0)),
      ])).join("")
    : row([`<span class="muted">No month/year rollups in this artifact.</span>`, "", "", "", "", "", "", ""]);

  const decisions = artifacts.decisions || [];
  const drilldowns = strategyDrilldownRows(decisions);
  $("artifact-drilldown-note").textContent = drilldowns.length
    ? `${numberText(drilldowns.length, 0)} decision drilldown row${drilldowns.length === 1 ? "" : "s"} from diagnostics.dashboard`
    : "No public-safe strategy drilldown diagnostics in this artifact";
  $("artifact-drilldown-body").innerHTML = drilldowns.length
    ? drilldowns.map((item) => {
        const drilldown = item.drilldown || {};
        return row([
          escapeHtml(item.timestamp),
          escapeHtml((item.symbols || []).join(", ")),
          escapeHtml(drilldownSignalText(drilldown)),
          escapeHtml(drilldownThresholdText(drilldown)),
          statusText(drilldownNearText(drilldown)),
          escapeHtml(drilldownHoldText(drilldown)),
          escapeHtml(drilldownExitText(drilldown)),
          escapeHtml(drilldownMaeMfeText(drilldown)),
        ]);
      }).join("")
    : row([`<span class="muted">Plugins can publish public-safe fields under diagnostics.dashboard to populate this table.</span>`, "", "", "", "", "", "", ""]);
  renderArtifactPluginCoverage(artifacts);
  const pluginFields = ((artifacts.plugin || {}).result_fields || []).filter((field) => field && field.name);
  const pluginFieldRows = pluginResultFieldRows(artifacts);
  const pluginLabel = text((artifacts.plugin || {}).label || (artifacts.plugin || {}).id || (artifacts.plugin || {}).spec);
  $("artifact-plugin-fields-note").textContent = pluginFields.length
    ? pluginFieldRows.length
      ? `${numberText(pluginFieldRows.length, 0)} labeled public diagnostic value${pluginFieldRows.length === 1 ? "" : "s"} from ${pluginLabel}`
      : `${numberText(pluginFields.length, 0)} configured result field${pluginFields.length === 1 ? "" : "s"} for ${pluginLabel}; no matching decision diagnostics in this artifact`
    : "No plugin result field metadata is configured for this artifact";
  $("artifact-plugin-fields-body").innerHTML = pluginFieldRows.length
    ? pluginFieldRows.map((item) => row([
        escapeHtml(item.timestamp),
        escapeHtml((item.symbols || []).join(", ")),
        escapeHtml(text(item.field.label || item.field.name)),
        escapeHtml(pluginResultFieldValue(item.field, item.value)),
        escapeHtml(pluginResultFieldHelp(item.field)),
      ])).join("")
    : row([`<span class="muted">Declare result_fields in the public or ignored local plugin registry, then emit matching diagnostics.dashboard keys.</span>`, "", "", "", ""]);
  const nearMisses = nearThresholdMissRows(drilldowns);
  $("artifact-near-threshold-note").textContent = nearMisses.length
    ? `${numberText(nearMisses.length, 0)} close decision${nearMisses.length === 1 ? "" : "s"} without order intents`
    : "No public-safe near-threshold misses in this artifact";
  $("artifact-near-threshold-body").innerHTML = nearMisses.length
    ? nearMisses.slice(0, 50).map((item) => {
        const drilldown = item.drilldown || {};
        return row([
          escapeHtml(item.timestamp),
          escapeHtml((item.symbols || []).join(", ")),
          escapeHtml(drilldownSignalText(drilldown)),
          escapeHtml(drilldown.threshold_distance === undefined ? "n/a" : numberText(drilldown.threshold_distance, 4)),
          escapeHtml(text(drilldown.near_threshold_reason || drilldown.reason)),
          escapeHtml(drilldownHoldText(drilldown)),
          escapeHtml(drilldownExitText(drilldown)),
        ]);
      }).join("")
    : row([`<span class="muted">No missed near-threshold decisions published.</span>`, "", "", "", "", "", ""]);
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

  const orderPreviews = artifacts.order_previews || [];
  $("artifact-order-previews-note").textContent = orderPreviews.length
    ? `${numberText(orderPreviews.length, 0)} preview${orderPreviews.length === 1 ? "" : "s"} loaded from order_previews.jsonl`
    : "No manual-approval order previews in this artifact";
  $("artifact-order-previews-body").innerHTML = orderPreviews.length
    ? orderPreviews.map((preview) => {
        const command = approvalPreviewCommand(preview, artifacts);
        const actions = [];
        if (approvalPreviewCanApprove(preview, artifacts)) {
          actions.push(`<button type="button" class="approve-order-preview" data-approval-id="${escapeHtml(preview.approval_id)}">Approve</button>`);
        }
        if (command) {
          actions.push(`<button type="button" class="secondary copy-approval-command" data-command="${escapeHtml(command)}">Copy</button>`);
        }
        const actionCell = actions.length ? `<span class="button-pair">${actions.join("")}</span>` : `<span class="muted">n/a</span>`;
        return row([
          escapeHtml(preview.timestamp),
          statusText(preview.approval_status || (preview.approval_required ? "required" : "preview")),
          `<span class="mono">${escapeHtml(preview.approval_id)}</span>`,
          escapeHtml(preview.symbol),
          escapeHtml(preview.side),
          escapeHtml(preview.order_type),
          escapeHtml(numberText(preview.quantity, 4)),
          escapeHtml(money(preview.cash_quantity)),
          escapeHtml(money(preview.estimated_notional)),
          escapeHtml(money(preview.equity)),
          `<span class="mono">${escapeHtml(preview.approval_file)}</span>`,
          actionCell,
          escapeHtml(preview.tag),
        ]);
      }).join("")
    : row([`<span class="muted">Order previews appear when execution.require_order_approval holds orders for operator approval.</span>`, "", "", "", "", "", "", "", "", "", "", "", ""]);

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

  const account = artifacts.account || [];
  $("artifact-account-note").textContent = account.length
    ? `${numberText(account.length, 0)} sanitized account snapshot${account.length === 1 ? "" : "s"}`
    : "No account snapshots in this artifact";
  $("artifact-account-body").innerHTML = account.length
	    ? account.map((snapshot) => row([
	        escapeHtml(snapshot.timestamp),
	        escapeHtml(text(snapshot.step)),
	        escapeHtml(text(snapshot.mode)),
	        escapeHtml(money(snapshot.cash)),
	        escapeHtml(money(snapshot.equity)),
	        statusText(snapshot.equity_source === "provided" ? "ok" : snapshot.equity_source === "estimated_from_cash_and_prices" ? "warn" : "unknown", { suffix: ` ${text(snapshot.equity_source)}` }),
	        escapeHtml(money(snapshot.gross_exposure)),
	        escapeHtml(money(snapshot.net_exposure)),
	        `${statusText(snapshot.pricing_status === "ok" || snapshot.pricing_status === "flat" ? "ok" : snapshot.pricing_status === "partial" ? "warn" : "unknown", { suffix: ` ${text(snapshot.pricing_status)}` })}<br><span class="muted">${escapeHtml(numberText(snapshot.priced_position_count, 0))}/${escapeHtml(numberText(snapshot.position_count, 0))} priced, ${escapeHtml(numberText(snapshot.price_count, 0))} prices</span>`,
	        jsonDrilldown(snapshot.positions || {}, `${numberText(nonzeroObjectCount(snapshot.positions), 0)} open`),
	        positionSnapshotDrilldown(snapshot),
	      ])).join("")
	    : row([`<span class="muted">none</span>`, "", "", "", "", "", "", "", "", "", ""]);
}

