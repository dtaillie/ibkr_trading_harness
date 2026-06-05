#!/usr/bin/env python3
"""Tiny local receiver/dashboard for public telemetry prototypes."""

from __future__ import annotations

import argparse
import csv
import hashlib
import hmac
import html
import io
import ipaddress
import json
import math
import os
import mimetypes
import re
import shutil
import subprocess
import sys
import time
from collections import Counter, deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, unquote, urlparse

import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from live.plugin_runner import validate_config as validate_runner_config
from live.broker_adapters import broker_adapter_capabilities


ALLOWED_COMMAND_ACTIONS = {
    "pause_runner",
    "resume_runner",
    "request_status",
    "run_supervisor_once",
    "summarize_run",
    "supervisor_status",
    "validate_config",
    "validate_supervisor_config",
}

COMMAND_PARAM_FIELDS = {
    "pause_runner": (),
    "request_status": (),
    "resume_runner": (),
    "run_supervisor_once": ("supervisor_id",),
    "summarize_run": ("run_id",),
    "supervisor_status": ("supervisor_id",),
    "validate_config": ("config_id",),
    "validate_supervisor_config": ("supervisor_id",),
}

COMMAND_ACTION_CLASSES = {
    "pause_runner": "control",
    "request_status": "read_only",
    "resume_runner": "control",
    "run_supervisor_once": "launcher",
    "summarize_run": "read_only",
    "supervisor_status": "read_only",
    "validate_config": "read_only",
    "validate_supervisor_config": "read_only",
}

DEFAULT_COMMAND_SCOPE_POLICY = {
    "enabled": True,
    "allowed_action_classes": ("read_only", "control"),
    "allowed_actions": (),
}

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DASHBOARD_DIR = ROOT / "web" / "dashboard"
DEFAULT_DATA_ROOTS = (ROOT / "examples" / "data",)
DEFAULT_FETCH_MANIFEST_ROOTS = (ROOT / "paper_logs" / "fetch_manifests",)
DEFAULT_PLUGIN_REGISTRY_PATHS = (ROOT / "config" / "plugin_registry_local.yaml",)
PUBLIC_DOCS = {
    "web_ui_runbook.md": ROOT / "docs" / "web_ui_runbook.md",
    "public_quickstart.md": ROOT / "docs" / "public_quickstart.md",
    "configuration_privacy.md": ROOT / "docs" / "configuration_privacy.md",
    "publication_readiness.md": ROOT / "docs" / "publication_readiness.md",
    "ibkr_gateway_runbook.md": ROOT / "docs" / "ibkr_gateway_runbook.md",
    "paper_trading_runbook.md": ROOT / "docs" / "paper_trading_runbook.md",
    "market_data_permissions_runbook.md": ROOT / "docs" / "market_data_permissions_runbook.md",
    "service_restart_runbook.md": ROOT / "docs" / "service_restart_runbook.md",
    "failed_order_diagnosis_runbook.md": ROOT / "docs" / "failed_order_diagnosis_runbook.md",
    "cloud_monitoring_deployment.md": ROOT / "docs" / "cloud_monitoring_deployment.md",
    "work_queue.md": ROOT / "docs" / "work_queue.md",
}
SUGGESTED_DATA_ROOTS = (
    ROOT / "cache",
    ROOT / "cache" / "ibkr",
    ROOT / "data",
    ROOT / "paper_logs" / "history",
    ROOT / "paper_logs" / "crypto_history",
)
BAR_SIZE_TOKENS = ("1min", "5min", "15min", "30min", "1h", "1d")
DATA_FILE_SUFFIXES = {".csv", ".parquet"}
ETF_SYMBOLS = {
    "DIA",
    "EEM",
    "EFA",
    "GLD",
    "HYG",
    "IWM",
    "LQD",
    "QQQ",
    "SLV",
    "SPY",
    "TLT",
    "VXX",
    "XBI",
    "XLB",
    "XLC",
    "XLE",
    "XLF",
    "XLI",
    "XLK",
    "XLP",
    "XLU",
    "XLV",
    "XLY",
}
CONFIG_BUILDER_PLUGINS = (
    {
        "id": "no_edge_template",
        "label": "No-edge template",
        "spec": "examples.strategies.no_edge_template:create_strategy",
        "status": "example_only",
        "visibility": "public_example",
        "description": "Demonstrates plugin wiring only; not a viable trading strategy.",
        "boundary": (
            "Public Workbench drafts only list generic example plugins. Point "
            "ignored local configs at private plugins for real strategy work."
        ),
        "strategy_fields": [
            {
                "name": "example_parameter",
                "label": "Example Parameter",
                "kind": "checkbox",
                "default": True,
                "help": "Demonstrates plugin-specific config wiring only.",
            },
        ],
    },
)
CONFIG_BUILDER_MODES = ("replay", "shadow", "simulated_paper")
CONFIG_DRAFT_RUN_ACTIONS = ("validate", "replay", "simulated_paper")
CONFIG_SCHEMA_VERSION = 1
CONFIG_FORM_SCHEMA_VERSION = 2
PLUGIN_STRATEGY_FIELD_KINDS = {"text", "number", "checkbox", "select"}
WORKBENCH_SNAPSHOT_SCHEMA_VERSION = 1
CONFIG_BUILDER_RISK_PRESETS = (
    {
        "id": "demo_minimal",
        "label": "Demo minimal",
        "description": "Small one-order example settings for wiring checks.",
        "values": {
            "max_orders_per_run": 1,
            "max_notional_per_order": 100,
            "max_quantity": 10,
            "max_cash_quantity": 100,
            "max_gross_exposure_pct": 0.05,
            "sim_slippage_bps": 0,
            "sim_commission_bps": 0,
        },
    },
    {
        "id": "costed_demo",
        "label": "Costed demo",
        "description": "Small example settings with nonzero simulated costs.",
        "values": {
            "max_orders_per_run": 2,
            "max_notional_per_order": 250,
            "max_quantity": 25,
            "max_cash_quantity": 250,
            "max_gross_exposure_pct": 0.10,
            "sim_slippage_bps": 2,
            "sim_commission_bps": 0.5,
        },
    },
    {
        "id": "larger_replay_demo",
        "label": "Larger replay demo",
        "description": "Larger non-live example guardrails for replay experiments.",
        "values": {
            "max_orders_per_run": 5,
            "max_notional_per_order": 1000,
            "max_quantity": 100,
            "max_cash_quantity": 1000,
            "max_gross_exposure_pct": 0.25,
            "sim_slippage_bps": 5,
            "sim_commission_bps": 1,
        },
    },
)
CONFIG_BUILDER_FORM_SCHEMA = (
    {"id": "config-name", "name": "name", "label": "Name", "kind": "text", "default_key": "name", "section": "identity", "help": "Local draft name. The server normalizes it for file-safe output."},
    {"id": "config-plugin", "name": "plugin_id", "label": "Plugin", "kind": "select", "options_source": "plugins", "section": "identity", "help": "Public examples demonstrate wiring only; private plugins belong in ignored local configs."},
    {"id": "config-mode", "name": "mode", "label": "Mode", "kind": "select", "options_source": "modes", "section": "identity", "help": "Replay and simulated-paper are public-safe local modes."},
    {"id": "config-dataset", "name": "datasets", "label": "Datasets", "kind": "select", "options_source": "datasets", "multiple": True, "size": 5, "wide": True, "section": "data", "help": "Choose one or more scanned CSV/parquet files from Data Library."},
    {"id": "config-start-date", "name": "start", "label": "Start Date", "kind": "date", "section": "data", "help": "Optional replay start date."},
    {"id": "config-end-date", "name": "end", "label": "End Date", "kind": "date", "section": "data", "help": "Optional replay end date."},
    {"id": "config-starting-cash", "name": "starting_cash", "label": "Starting Cash", "kind": "number", "min": 1, "step": 100, "default_key": "starting_cash", "section": "account", "help": "Starting cash for replay or simulated-paper accounting."},
    {"id": "config-history-bars", "name": "history_bars", "label": "History Bars", "kind": "number", "min": 1, "step": 1, "default_key": "history_bars", "section": "account", "help": "Number of prior bars provided to the plugin decision window."},
    {"id": "config-max-steps", "name": "max_steps", "label": "Max Steps", "kind": "number", "min": 1, "step": 1, "default_key": "max_steps", "section": "account", "help": "Optional cap on replay steps for quick tests."},
    {"id": "config-session-enabled", "name": "session_enabled", "label": "Use session window", "kind": "checkbox", "section": "runtime", "help": "When enabled, loop mode can idle outside a configured local session."},
    {"id": "config-session-timezone", "name": "session_timezone", "label": "Session Timezone", "kind": "text", "default_key": "session_timezone", "section": "runtime", "help": "IANA timezone such as America/New_York or UTC."},
    {"id": "config-session-start", "name": "session_start", "label": "Session Start", "kind": "text", "default_key": "session_start", "section": "runtime", "help": "Local session start time as HH:MM."},
    {"id": "config-session-end", "name": "session_end", "label": "Session End", "kind": "text", "default_key": "session_end", "section": "runtime", "help": "Local session end time as HH:MM."},
    {"id": "config-session-weekdays", "name": "session_weekdays", "label": "Weekdays", "kind": "text", "default_key": "session_weekdays", "section": "runtime", "help": "Comma-separated weekdays, e.g. monday,tuesday,wednesday,thursday,friday."},
    {"id": "config-session-outside", "name": "session_outside", "label": "Outside Session", "kind": "select", "default_key": "session_outside", "section": "runtime", "options": [{"value": "idle", "label": "idle - record idle decision"}, {"value": "run", "label": "run - evaluate anyway"}], "help": "Idle records a visible no-order decision without calling the plugin."},
    {"id": "config-risk-preset", "name": "risk_preset", "label": "Risk Preset", "kind": "select", "options_source": "risk_presets", "default_key": "risk_preset", "section": "risk", "help": "Public presets are conservative examples, not recommendations."},
    {"id": "config-max-orders", "name": "max_orders_per_run", "label": "Max Orders", "kind": "number", "min": 1, "step": 1, "default_key": "max_orders_per_run", "section": "risk", "help": "Maximum order intents allowed in one run."},
    {"id": "config-max-notional", "name": "max_notional_per_order", "label": "Max Notional", "kind": "number", "min": 1, "step": 1, "default_key": "max_notional_per_order", "section": "risk", "help": "Maximum notional value per order intent."},
    {"id": "config-max-quantity", "name": "max_quantity", "label": "Max Quantity", "kind": "number", "min": 0.0001, "step": 0.0001, "default_key": "max_quantity", "section": "risk", "help": "Maximum share/unit quantity per order intent."},
    {"id": "config-max-cash", "name": "max_cash_quantity", "label": "Max Cash Qty", "kind": "number", "min": 1, "step": 1, "default_key": "max_cash_quantity", "section": "risk", "help": "Maximum cash quantity for venues that require cash-sized orders."},
    {"id": "config-max-exposure", "name": "max_gross_exposure_pct", "label": "Max Exposure", "kind": "number", "min": 0.0001, "step": 0.0001, "default_key": "max_gross_exposure_pct", "section": "risk", "help": "Maximum gross exposure as a fraction of equity."},
    {"id": "config-slippage", "name": "sim_slippage_bps", "label": "Slippage bps", "kind": "number", "min": 0, "step": 0.1, "default_key": "sim_slippage_bps", "section": "costs", "help": "Simulated slippage in basis points."},
    {"id": "config-commission", "name": "sim_commission_bps", "label": "Commission bps", "kind": "number", "min": 0, "step": 0.1, "default_key": "sim_commission_bps", "section": "costs", "help": "Simulated commission in basis points."},
    {"id": "config-save", "name": "save", "label": "Save draft locally", "kind": "checkbox", "section": "output", "help": "Save generated YAML under the local workbench state directory."},
    {"id": "config-allow-quality-warnings", "name": "allow_quality_warnings", "label": "Allow suspicious data for this draft", "kind": "checkbox", "wide": True, "section": "output", "help": "Requires explicit acknowledgement before using warn/bad datasets."},
)
WORKBENCH_OUTPUT_ROOT = ROOT / "paper_logs" / "workbench"
MAX_DRAFT_RUN_STEPS = 500
MAX_DRAFT_RUN_TIMEOUT_SECONDS = 120
MAX_ARTIFACT_ROWS = 500
MAX_DATA_DETAIL_POINTS = 1000
MAX_DATA_GAP_ROWS = 200
MAX_DATA_MISSING_INTERVAL_ROWS = 1000
MAX_DATA_MISSING_INTERVAL_EXPORT_ROWS = 1000000
MAX_CONFIG_DRAFT_DATASETS = 20
MAX_DATA_COMPARE_DATASETS = 8
OUTPUT_TAIL_BYTES = 8000
RUN_ARTIFACT_FILES = ("summary.json", "decisions.jsonl", "orders.jsonl", "fills.jsonl", "account.jsonl")
PUBLIC_DECISION_DRILLDOWN_FIELDS = (
    "reason",
    "signal_label",
    "signal_value",
    "threshold",
    "threshold_distance",
    "threshold_direction",
    "near_threshold",
    "near_threshold_reason",
    "entry_marker",
    "exit_marker",
    "expected_hold_minutes",
    "hold_until",
    "active_exit_rule",
    "exit_state",
    "stop_state",
    "stop_price",
    "target_price",
    "current_price",
    "entry_price",
    "mae_pct",
    "mfe_pct",
)
PUBLIC_POSITION_DETAIL_FIELDS = (
    "entry_time",
    "entry_price",
    "current_price",
    "expected_hold_minutes",
    "hold_until",
    "active_exit_rule",
    "exit_state",
    "stop_state",
    "stop_price",
    "target_price",
    "mae_pct",
    "mfe_pct",
)
PUBLIC_ENDPOINTS = (
    {
        "method": "GET",
        "path": "/status",
        "category": "telemetry",
        "description": "Return the latest posted node status snapshot.",
        "response": "JSON status payload",
    },
    {
        "method": "GET",
        "path": "/status_history",
        "category": "telemetry",
        "description": "Return summarized recent status snapshots, optionally filtered by node_id.",
        "response": "JSON history rows",
    },
    {
        "method": "GET",
        "path": "/status_equity_rollups",
        "category": "telemetry",
        "description": "Summarize sanitized status-history equity snapshots by UTC day, month, and year.",
        "response": "JSON status-history performance rollups",
    },
    {
        "method": "GET",
        "path": "/status_equity_rollups_export",
        "category": "telemetry",
        "description": "Download sanitized status-history daily, monthly, and yearly equity rollups.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/remote_nodes",
        "category": "telemetry",
        "description": "Return sanitized latest read-only monitoring summaries by node.",
        "response": "JSON node summaries",
    },
    {
        "method": "GET",
        "path": "/remote_nodes_export",
        "category": "telemetry",
        "description": "Download sanitized latest read-only monitoring summaries by node.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/remote_node_detail",
        "category": "telemetry",
        "description": "Return bounded sanitized latest status detail and history for one node.",
        "response": "JSON node detail",
    },
    {
        "method": "POST",
        "path": "/status",
        "category": "telemetry",
        "description": "Receive and persist a node status snapshot.",
        "response": "JSON receipt",
    },
    {
        "method": "GET",
        "path": "/data_catalog",
        "category": "data",
        "description": "Inspect CSV/parquet data files under configured public data roots.",
        "response": "JSON catalog with quality metadata",
    },
    {
        "method": "GET",
        "path": "/docs/{name}",
        "category": "help",
        "description": "Serve allowlisted public Markdown docs for in-dashboard runbooks and guidance.",
        "response": "Markdown text",
    },
    {
        "method": "GET",
        "path": "/data_catalog_export",
        "category": "data",
        "description": "Download saved data catalog metadata.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/data_catalog_scan_export",
        "category": "data",
        "description": "Download data-root catalog scan diagnostics and skipped-file samples.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/data_detail",
        "category": "data",
        "description": "Inspect one saved data file with range-filtered sampled or full-in-range price/volume series.",
        "response": "JSON dataset detail and viewer series",
    },
    {
        "method": "GET",
        "path": "/data_missing_intervals_export",
        "category": "data",
        "description": "Download inferred missing expected timestamps for one saved data file.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/data_coverage",
        "category": "data",
        "description": "Summarize saved-data date coverage by symbol for heatmap-style views.",
        "response": "JSON coverage bins and rows",
    },
    {
        "method": "GET",
        "path": "/data_coverage_export",
        "category": "data",
        "description": "Download saved-data symbol/date coverage rows.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/data_gap_summary",
        "category": "data",
        "description": "Summarize worst saved-data timestamp gaps and missing calendar days.",
        "response": "JSON aggregate gap rows",
    },
    {
        "method": "GET",
        "path": "/data_gap_summary_export",
        "category": "data",
        "description": "Download worst saved-data timestamp and calendar gap rows.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/data_minute_heatmap",
        "category": "data",
        "description": "Summarize saved-data intraday interval completeness by UTC hour.",
        "response": "JSON hourly missing-interval heatmap rows",
    },
    {
        "method": "GET",
        "path": "/data_minute_heatmap_export",
        "category": "data",
        "description": "Download saved-data intraday interval completeness rows.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/data_symbol_diagnostic",
        "category": "data",
        "description": "Explain whether a requested symbol is visible, skipped, unconfigured, or absent.",
        "response": "JSON symbol visibility diagnosis",
    },
    {
        "method": "GET",
        "path": "/data_storage_audit",
        "category": "data",
        "description": "Compare local CSV/parquet files on disk with catalog-visible saved-data rows.",
        "response": "JSON root-by-root storage audit",
    },
    {
        "method": "GET",
        "path": "/data_storage_audit_export",
        "category": "data",
        "description": "Download root-by-root saved-data storage audit metadata.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/fetch_manifests",
        "category": "data",
        "description": "List historical-data fetch job manifests.",
        "response": "JSON fetch-job manifest summaries",
    },
    {
        "method": "GET",
        "path": "/fetch_manifests_export",
        "category": "data",
        "description": "Download historical-data fetch job manifest summaries.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/fetch_manifest_detail",
        "category": "data",
        "description": "Inspect one historical-data fetch job manifest.",
        "response": "JSON fetch-job manifest detail",
    },
    {
        "method": "GET",
        "path": "/fetch_manifest_detail_export",
        "category": "data",
        "description": "Download selected fetch manifest symbols, outputs, errors, and retry/pacing events.",
        "response": "CSV download",
    },
    {
        "method": "POST",
        "path": "/data_alignment",
        "category": "data",
        "description": "Preview timestamp alignment for selected saved datasets.",
        "response": "JSON alignment summary",
    },
    {
        "method": "POST",
        "path": "/data_compare",
        "category": "data",
        "description": "Compare normalized close paths for several saved datasets over one local time range.",
        "response": "JSON normalized saved-data comparison series",
    },
    {
        "method": "GET",
        "path": "/config_options",
        "category": "config",
        "description": "Return public config-builder plugin, mode, action, preset, and default options.",
        "response": "JSON options",
    },
    {
        "method": "POST",
        "path": "/config_draft",
        "category": "config",
        "description": "Generate an example public workbench config draft, optionally saving it locally.",
        "response": "JSON draft with YAML and validation",
    },
    {
        "method": "GET",
        "path": "/config_drafts",
        "category": "config",
        "description": "List saved public workbench config drafts.",
        "response": "JSON draft list",
    },
    {
        "method": "GET",
        "path": "/config_drafts_export",
        "category": "config",
        "description": "Download saved public workbench config draft inventory rows.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/config_draft_validations",
        "category": "config",
        "description": "Validate every saved draft against public workbench guardrails.",
        "response": "JSON validation summary",
    },
    {
        "method": "GET",
        "path": "/config_draft_detail",
        "category": "config",
        "description": "Load one valid saved draft with YAML, commands, and alignment summary.",
        "response": "JSON draft detail",
    },
    {
        "method": "GET",
        "path": "/config_draft_yaml",
        "category": "config",
        "description": "Download one validated saved draft YAML file.",
        "response": "YAML download",
    },
    {
        "method": "POST",
        "path": "/config_draft/delete",
        "category": "config",
        "description": "Delete one saved draft YAML after explicit confirmation.",
        "response": "JSON deletion result",
    },
    {
        "method": "POST",
        "path": "/config_draft/run",
        "category": "config",
        "description": "Validate, replay, or simulated-paper-run a saved public draft with bounds.",
        "response": "JSON run record",
    },
    {
        "method": "GET",
        "path": "/config_draft_runs",
        "category": "runs",
        "description": "List recent saved-draft run records.",
        "response": "JSON run list",
    },
    {
        "method": "GET",
        "path": "/config_draft_run_comparison",
        "category": "runs",
        "description": "Return public-safe run comparison metrics and leaders.",
        "response": "JSON comparison",
    },
    {
        "method": "GET",
        "path": "/config_draft_daily_rollups",
        "category": "runs",
        "description": "Summarize archived account artifacts by UTC day for current-performance views.",
        "response": "JSON daily run rollups",
    },
    {
        "method": "GET",
        "path": "/config_draft_runs_export",
        "category": "runs",
        "description": "Download public-safe recent run comparison rows.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/config_draft_run_detail",
        "category": "runs",
        "description": "Return command, timing, stdout, and stderr detail for one run.",
        "response": "JSON run detail",
    },
    {
        "method": "GET",
        "path": "/config_draft_artifacts",
        "category": "runs",
        "description": "Return sanitized latest artifacts for a saved draft output directory.",
        "response": "JSON artifact summary",
    },
    {
        "method": "GET",
        "path": "/config_draft_run_artifacts",
        "category": "runs",
        "description": "Return sanitized archived artifacts for one saved-draft run.",
        "response": "JSON artifact summary",
    },
    {
        "method": "GET",
        "path": "/config_draft_run_artifacts_export",
        "category": "runs",
        "description": "Download sanitized archived artifacts for one saved-draft run.",
        "response": "JSON download",
    },
    {
        "method": "GET",
        "path": "/workbench_status",
        "category": "workbench",
        "description": "Return local draft, run, archive, and cleanup status.",
        "response": "JSON status summary",
    },
    {
        "method": "GET",
        "path": "/workbench_cleanup_plan",
        "category": "workbench",
        "description": "Preview orphaned workbench archive/output cleanup.",
        "response": "JSON cleanup plan",
    },
    {
        "method": "POST",
        "path": "/workbench_cleanup",
        "category": "workbench",
        "description": "Dry-run or apply orphaned workbench archive/output cleanup.",
        "response": "JSON cleanup result",
    },
    {
        "method": "GET",
        "path": "/workbench_diagnostics",
        "category": "workbench",
        "description": "Probe state directory, data roots, and dashboard asset availability.",
        "response": "JSON diagnostics",
    },
    {
        "method": "GET",
        "path": "/workbench_snapshot_export",
        "category": "workbench",
        "description": "Download a public-safe snapshot of workbench state and metadata.",
        "response": "JSON download",
    },
    {
        "method": "GET",
        "path": "/workbench_endpoints",
        "category": "workbench",
        "description": "Return this public endpoint map.",
        "response": "JSON endpoint list",
    },
    {
        "method": "GET",
        "path": "/commands",
        "category": "remote",
        "description": "List pending local remote-control commands.",
        "response": "JSON command list",
    },
    {
        "method": "POST",
        "path": "/commands",
        "category": "remote",
        "description": "Queue an allow-listed local remote-control command.",
        "response": "JSON command record",
    },
    {
        "method": "POST",
        "path": "/commands/cancel",
        "category": "remote",
        "description": "Cancel a pending local remote-control command.",
        "response": "JSON cancel result",
    },
    {
        "method": "GET",
        "path": "/command_results",
        "category": "remote",
        "description": "List recent command results for a node.",
        "response": "JSON result list",
    },
    {
        "method": "POST",
        "path": "/command_results",
        "category": "remote",
        "description": "Receive and persist a command execution result.",
        "response": "JSON receipt",
    },
    {
        "method": "GET",
        "path": "/command_audit",
        "category": "remote",
        "description": "List sanitized command queue/cancel/result audit events.",
        "response": "JSON audit event list",
    },
    {
        "method": "GET",
        "path": "/command_audit_export",
        "category": "remote",
        "description": "Download sanitized command queue/cancel/result audit events with integrity metadata.",
        "response": "CSV audit event export",
    },
)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler: BaseHTTPRequestHandler, status: int, body: str, content_type: str = "text/html") -> None:
    raw = body.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def download_text_response(
    handler: BaseHTTPRequestHandler,
    status: int,
    body: str,
    *,
    filename: str,
    content_type: str,
) -> None:
    raw = body.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Disposition", f'attachment; filename="{filename}"')
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def file_response(handler: BaseHTTPRequestHandler, path: Path) -> None:
    if not path.exists() or not path.is_file():
        json_response(handler, 404, {"error": "not found"})
        return
    raw = path.read_bytes()
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def public_doc_response(handler: BaseHTTPRequestHandler, name: str) -> None:
    clean_name = Path(name).name
    path = PUBLIC_DOCS.get(clean_name)
    if path is None or not path.exists() or not path.is_file():
        json_response(handler, 404, {"error": "not found"})
        return
    text_response(handler, 200, path.read_text(), content_type="text/markdown; charset=utf-8")


def load_latest(state_dir: Path) -> dict[str, Any] | None:
    path = state_dir / "latest_status.json"
    if not path.exists():
        return None
    with path.open() as f:
        data = json.load(f)
    return data if isinstance(data, dict) else None


def status_history_path(state_dir: Path) -> Path:
    return state_dir / "status_history.jsonl"


def count_by_status(items: Iterable[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return counts


def summarize_status_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    gateway = row.get("gateway") or {}
    remote = row.get("remote_control") or {}
    latest_remote = remote.get("latest_event") or {}
    latest_remote_result = latest_remote.get("result") or {}
    runs = row.get("runs") or []
    supervisors = row.get("supervisors") or []
    alerts = row.get("alerts") or []
    return {
        "node_id": row.get("node_id"),
        "status": row.get("status"),
        "generated_at": row.get("generated_at"),
        "received_at": row.get("received_at"),
        "alert_count": len(alerts) if isinstance(alerts, list) else 0,
        "run_count": len(runs) if isinstance(runs, list) else 0,
        "run_status_counts": count_by_status(runs) if isinstance(runs, list) else {},
        "supervisor_count": len(supervisors) if isinstance(supervisors, list) else 0,
        "supervisor_status_counts": count_by_status(supervisors) if isinstance(supervisors, list) else {},
        "gateway_reachable": gateway.get("reachable"),
        "remote_latest_event": latest_remote.get("event"),
        "remote_latest_action": latest_remote_result.get("action"),
        "remote_latest_status": latest_remote_result.get("status"),
    }


def parse_status_timestamp(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def nonterminal_order_count(recent_events: dict[str, Any]) -> int:
    orders = recent_events.get("orders") if isinstance(recent_events, dict) else []
    if not isinstance(orders, list):
        return 0
    terminal = {"filled", "cancelled", "canceled", "rejected", "inactive", "api_cancelled"}
    count = 0
    for order in orders:
        if not isinstance(order, dict):
            continue
        status = str(order.get("status") or "").strip().lower()
        if status and status not in terminal:
            count += 1
    return count


def nonzero_position_count(positions: Any) -> int:
    if not isinstance(positions, dict):
        return 0
    count = 0
    for value in positions.values():
        numeric = finite_float(value)
        if numeric not in {None, 0.0}:
            count += 1
    return count


def latest_run_for_status(row: dict[str, Any]) -> dict[str, Any]:
    runs = row.get("runs") or []
    if not isinstance(runs, list) or not runs:
        return {}
    ordered = sorted(
        (run for run in runs if isinstance(run, dict)),
        key=lambda run: str(((run.get("metrics") or {}).get("last_decision_time")) or run.get("generated_at") or ""),
        reverse=True,
    )
    return ordered[0] if ordered else {}


def summarize_remote_node(row: dict[str, Any]) -> dict[str, Any]:
    gateway = row.get("gateway") or {}
    alerts = row.get("alerts") or []
    latest_run = latest_run_for_status(row)
    metrics = latest_run.get("metrics") or {}
    recent_events = latest_run.get("recent_events") or {}
    positions = metrics.get("final_positions") or {}
    position_count = len([qty for qty in positions.values() if finite_float(qty) not in {None, 0.0}]) if isinstance(positions, dict) else None
    decision_count = len(recent_events.get("decisions") or []) if isinstance(recent_events, dict) else 0
    order_count = len(recent_events.get("orders") or []) if isinstance(recent_events, dict) else 0
    fill_count = len(recent_events.get("fills") or []) if isinstance(recent_events, dict) else 0
    return {
        "node_id": row.get("node_id"),
        "status": row.get("status"),
        "generated_at": row.get("generated_at"),
        "received_at": row.get("received_at"),
        "gateway_reachable": gateway.get("reachable"),
        "alert_count": len(alerts) if isinstance(alerts, list) else 0,
        "latest_run_id": latest_run.get("id"),
        "latest_run_status": latest_run.get("status"),
        "mode": metrics.get("mode"),
        "final_equity": finite_float(metrics.get("final_equity")),
        "cash": finite_float(metrics.get("final_cash")),
        "position_count": position_count,
        "open_order_count": nonterminal_order_count(recent_events),
        "decision_count": decision_count,
        "order_count": order_count,
        "fill_count": fill_count,
        "rejection_count": int(metrics.get("rejections") or 0) if metrics.get("rejections") is not None else None,
        "latest_account_time": metrics.get("account_end_time") or metrics.get("latest_account_time") or metrics.get("account_snapshot_time"),
        "latest_data_time": metrics.get("latest_data_time") or metrics.get("latest_market_data_time") or metrics.get("latest_bar_time"),
        "latest_decision_time": metrics.get("last_decision_time"),
    }


REMOTE_NODES_EXPORT_FIELDS = (
    "node_id",
    "status",
    "generated_at",
    "received_at",
    "gateway_reachable",
    "alert_count",
    "latest_run_id",
    "latest_run_status",
    "mode",
    "final_equity",
    "cash",
    "position_count",
    "open_order_count",
    "decision_count",
    "order_count",
    "fill_count",
    "rejection_count",
    "latest_account_time",
    "latest_data_time",
    "latest_decision_time",
)


def load_remote_nodes(state_dir: Path, *, limit: int = 100) -> dict[str, Any]:
    path = status_history_path(state_dir)
    if not path.exists():
        return {"nodes": [], "count": 0, "total": 0, "limit": limit}
    latest_by_node: dict[str, dict[str, Any]] = {}
    total = 0
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict):
                continue
            node_id = str(row.get("node_id") or "").strip()
            if not node_id:
                continue
            total += 1
            latest_by_node[node_id] = summarize_remote_node(row)
    nodes = sorted(
        latest_by_node.values(),
        key=lambda item: str(item.get("received_at") or item.get("generated_at") or ""),
        reverse=True,
    )[:limit]
    return {"nodes": nodes, "count": len(nodes), "total": total, "limit": limit}


def build_remote_nodes_csv(state_dir: Path, *, limit: int = 100) -> str:
    payload = load_remote_nodes(state_dir, limit=limit)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=REMOTE_NODES_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in payload.get("nodes") or []:
        writer.writerow({field: compact_csv_value(row.get(field)) for field in REMOTE_NODES_EXPORT_FIELDS})
    return out.getvalue()


def sanitize_remote_run(run: dict[str, Any]) -> dict[str, Any]:
    metrics = run.get("metrics") or {}
    recent = run.get("recent_events") or {}
    return {
        "id": run.get("id"),
        "status": run.get("status"),
        "exists": run.get("exists"),
        "freshness": run.get("freshness"),
        "data_freshness": run.get("data_freshness"),
        "account_freshness": run.get("account_freshness"),
        "mode": metrics.get("mode"),
        "decisions": metrics.get("decisions"),
        "orders": metrics.get("orders"),
        "fills": metrics.get("fills"),
        "rejections": metrics.get("rejections"),
        "final_equity": finite_float(metrics.get("final_equity")),
        "final_cash": finite_float(metrics.get("final_cash")),
        "position_count": nonzero_position_count(metrics.get("final_positions") or {}),
        "latest_data_time": metrics.get("latest_data_time"),
        "latest_account_time": metrics.get("account_end_time") or metrics.get("latest_account_time") or metrics.get("account_snapshot_time"),
        "last_decision_time": metrics.get("last_decision_time"),
        "recent_decisions": recent.get("decisions", [])[:10] if isinstance(recent, dict) else [],
        "recent_orders": recent.get("orders", [])[:10] if isinstance(recent, dict) else [],
        "recent_fills": recent.get("fills", [])[:10] if isinstance(recent, dict) else [],
    }


def sanitize_remote_supervisor(supervisor: dict[str, Any]) -> dict[str, Any]:
    return {
        "id": supervisor.get("id"),
        "status": supervisor.get("status"),
        "exists": supervisor.get("exists"),
        "generated_at": supervisor.get("generated_at"),
        "freshness": supervisor.get("freshness"),
        "job_status_counts": supervisor.get("job_status_counts") or {},
    }


def load_remote_node_detail(state_dir: Path, node_id: str, *, limit: int = 20) -> dict[str, Any]:
    node = str(node_id or "").strip()
    if not node:
        raise ValueError("node_id is required")
    path = status_history_path(state_dir)
    if not path.exists():
        return {"node_id": node, "summary": {}, "history": [], "alerts": [], "runs": [], "supervisors": [], "count": 0, "total": 0, "limit": limit}
    rows: deque[dict[str, Any]] = deque(maxlen=limit)
    latest: dict[str, Any] | None = None
    total = 0
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict) or str(row.get("node_id") or "").strip() != node:
                continue
            total += 1
            latest = row
            rows.append(summarize_status_snapshot(row))
    if latest is None:
        return {"node_id": node, "summary": {}, "history": [], "alerts": [], "runs": [], "supervisors": [], "count": 0, "total": 0, "limit": limit}
    alerts = latest.get("alerts") if isinstance(latest.get("alerts"), list) else []
    runs = latest.get("runs") if isinstance(latest.get("runs"), list) else []
    supervisors = latest.get("supervisors") if isinstance(latest.get("supervisors"), list) else []
    return {
        "node_id": node,
        "summary": summarize_remote_node(latest),
        "history": list(reversed(rows)),
        "alerts": [
            {
                "level": alert.get("level"),
                "kind": alert.get("kind"),
                "message": alert.get("message"),
            }
            for alert in alerts
            if isinstance(alert, dict)
        ][:20],
        "runs": [sanitize_remote_run(run) for run in runs if isinstance(run, dict)][:20],
        "supervisors": [sanitize_remote_supervisor(item) for item in supervisors if isinstance(item, dict)][:20],
        "count": len(rows),
        "total": total,
        "limit": limit,
    }


def load_status_history(state_dir: Path, *, node_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    path = status_history_path(state_dir)
    if not path.exists():
        return {"history": [], "count": 0, "total": 0, "limit": limit}
    rows: deque[dict[str, Any]] = deque(maxlen=limit)
    total = 0
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict):
                continue
            if node_id and row.get("node_id") != node_id:
                continue
            total += 1
            rows.append(summarize_status_snapshot(row))
    history = list(reversed(rows))
    return {"history": history, "count": len(history), "total": total, "limit": limit}


def build_status_equity_rollups(
    state_dir: Path,
    *,
    node_id: str | None = None,
    limit: int = 100,
    history_limit: int = 5000,
) -> dict[str, Any]:
    path = status_history_path(state_dir)
    if not path.exists():
        return {
            "generated_at": utc_now(),
            "rollups": [],
            "period_rollups": {"month": [], "year": []},
            "count": 0,
            "total": 0,
            "limit": limit,
            "history_limit": history_limit,
            "node_id": node_id,
        }
    rows: deque[dict[str, Any]] = deque(maxlen=history_limit)
    scanned = 0
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                raw = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(raw, dict):
                continue
            if node_id and str(raw.get("node_id") or "") != node_id:
                continue
            scanned += 1
            rows.append(raw)

    by_day: dict[tuple[str, str], list[tuple[datetime, dict[str, Any]]]] = {}
    for raw in rows:
        timestamp = parse_status_timestamp(raw.get("received_at") or raw.get("generated_at"))
        if timestamp is None:
            continue
        summary = summarize_remote_node(raw)
        equity = finite_float(summary.get("final_equity"))
        if equity is None:
            continue
        node = str(summary.get("node_id") or raw.get("node_id") or "local")
        summary["snapshot_time"] = timestamp.isoformat()
        summary["final_equity"] = equity
        by_day.setdefault((node, timestamp.date().isoformat()), []).append((timestamp, summary))

    rollups = []
    for (node, day), items in by_day.items():
        ordered = sorted(items, key=lambda item: item[0])
        start = ordered[0][1]
        end = ordered[-1][1]
        start_equity = finite_float(start.get("final_equity"))
        end_equity = finite_float(end.get("final_equity"))
        daily_return_pct = (
            ((end_equity / start_equity) - 1.0) * 100.0
            if start_equity and end_equity is not None
            else None
        )
        rollups.append({
            "day": day,
            "node_id": node,
            "mode": end.get("mode"),
            "latest_run_id": end.get("latest_run_id"),
            "latest_run_status": end.get("latest_run_status"),
            "status": end.get("status"),
            "gateway_reachable": end.get("gateway_reachable"),
            "snapshot_count": len(ordered),
            "account_start_time": ordered[0][0].isoformat(),
            "account_end_time": ordered[-1][0].isoformat(),
            "start_equity": start_equity,
            "end_equity": end_equity,
            "daily_return_pct": finite_float(daily_return_pct),
            "position_count": end.get("position_count"),
            "open_order_count": end.get("open_order_count"),
            "alert_count": max(int(item[1].get("alert_count") or 0) for item in ordered),
            "order_count": max(int(item[1].get("order_count") or 0) for item in ordered),
            "fill_count": max(int(item[1].get("fill_count") or 0) for item in ordered),
            "rejection_count": max(int(item[1].get("rejection_count") or 0) for item in ordered),
        })
    rollups = sorted(
        rollups,
        key=lambda row: (str(row.get("day") or ""), str(row.get("account_end_time") or ""), str(row.get("node_id") or "")),
        reverse=True,
    )
    return {
        "generated_at": utc_now(),
        "rollups": rollups[:limit],
        "period_rollups": build_period_rollups_from_daily_rows(rollups),
        "count": min(len(rollups), limit),
        "total": len(rollups),
        "limit": limit,
        "history_limit": history_limit,
        "history_scanned": scanned,
        "node_id": node_id,
    }


STATUS_EQUITY_ROLLUP_EXPORT_FIELDS = (
    "row_type",
    "label",
    "day",
    "node_id",
    "mode",
    "latest_run_id",
    "latest_run_status",
    "status",
    "gateway_reachable",
    "snapshot_count",
    "account_start_time",
    "account_end_time",
    "first_day",
    "last_day",
    "start_equity",
    "end_equity",
    "daily_return_pct",
    "total_return_pct",
    "day_count",
    "node_count",
    "position_count",
    "open_order_count",
    "alert_count",
    "order_count",
    "fill_count",
    "rejection_count",
)


def build_status_equity_rollups_csv(
    state_dir: Path,
    *,
    node_id: str = "",
    limit: int = 100,
    history_limit: int = 5000,
) -> str:
    payload = build_status_equity_rollups(state_dir, node_id=node_id, limit=limit, history_limit=history_limit)
    rows: list[dict[str, Any]] = []
    for item in payload.get("rollups") or []:
        if isinstance(item, dict):
            rows.append({"row_type": "daily", "label": item.get("day"), **item})
    period_rollups = payload.get("period_rollups") if isinstance(payload.get("period_rollups"), dict) else {}
    for row_type in ("month", "year"):
        for item in period_rollups.get(row_type) or []:
            if isinstance(item, dict):
                rows.append({"row_type": row_type, **item})
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=STATUS_EQUITY_ROLLUP_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: compact_csv_value(row.get(field)) for field in STATUS_EQUITY_ROLLUP_EXPORT_FIELDS})
    return out.getvalue()


def parse_limit(params: dict[str, list[str]], *, default: int = 50, maximum: int = 500) -> int:
    raw = params.get("limit", [str(default)])[0]
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("limit must be an integer") from exc
    if value < 1 or value > maximum:
        raise ValueError(f"limit must be between 1 and {maximum}")
    return value


def parse_int_param(
    params: dict[str, list[str]],
    key: str,
    *,
    default: int,
    minimum: int = 1,
    maximum: int = 500,
) -> int:
    raw = params.get(key, [str(default)])[0]
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError(f"{key} must be an integer") from exc
    if value < minimum or value > maximum:
        raise ValueError(f"{key} must be between {minimum} and {maximum}")
    return value


def parse_bool_param(params: dict[str, list[str]], key: str, *, default: bool) -> bool:
    raw = params.get(key, [str(default).lower()])[0].strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{key} must be true or false")


def parse_optional_utc_timestamp(raw: str | None, *, end_of_day: bool = False) -> pd.Timestamp | None:
    value = str(raw or "").strip()
    if not value:
        return None
    try:
        parsed = pd.to_datetime(value, utc=True, errors="raise", format="mixed")
    except TypeError:
        parsed = pd.to_datetime(value, utc=True, errors="raise")
    except Exception as exc:
        raise ValueError(f"invalid timestamp: {value}") from exc
    if end_of_day and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        parsed = parsed + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
    return parsed


def parse_data_roots(raw_roots: list[Path] | None) -> list[Path]:
    roots = raw_roots if raw_roots else list(DEFAULT_DATA_ROOTS)
    out = []
    for root in roots:
        path = root if root.is_absolute() else ROOT / root
        out.append(path.resolve())
    return out


def parse_fetch_manifest_roots(raw_roots: list[Path] | None) -> list[Path]:
    roots = raw_roots if raw_roots else list(DEFAULT_FETCH_MANIFEST_ROOTS)
    out = []
    for root in roots:
        path = root if root.is_absolute() else ROOT / root
        out.append(path.resolve())
    return out


def parse_plugin_registry_paths(raw_paths: list[Path] | None) -> list[Path]:
    paths = raw_paths if raw_paths is not None else list(DEFAULT_PLUGIN_REGISTRY_PATHS)
    out = []
    for raw in paths:
        path = raw if raw.is_absolute() else ROOT / raw
        out.append(path.resolve())
    return out


def read_optional_yaml_mapping(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise ValueError(f"config file does not exist: {path}")
    with path.open() as f:
        payload = yaml.safe_load(f) or {}
    if not isinstance(payload, dict):
        raise ValueError("config file must be a YAML mapping")
    return payload


def dashboard_server_settings(
    config_path: Path | None,
    *,
    host: str | None = None,
    port: int | None = None,
    state_dir: Path | None = None,
    dashboard_dir: Path | None = None,
    data_roots: list[Path] | None = None,
    fetch_manifest_roots: list[Path] | None = None,
    plugin_registry_paths: list[Path] | None = None,
    auth_token_env: str | None = None,
    command_audit_signature_env: str | None = None,
) -> dict[str, Any]:
    settings: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 8765,
        "state_dir": Path("paper_logs/cloud_status_server"),
        "dashboard_dir": DEFAULT_DASHBOARD_DIR,
        "data_roots": None,
        "fetch_manifest_roots": None,
        "plugin_registry_paths": None,
        "auth_token_env": None,
        "auth_tokens": [],
        "network_access": {"enabled": False, "allowed_client_networks": [], "trust_x_forwarded_for": False},
        "command_rate_limit": {"enabled": True, "window_seconds": 60.0, "max_per_node": 30},
        "command_scopes": normalize_command_scope_policy({}),
        "command_audit_signature_env": None,
    }
    if config_path is not None:
        config = read_optional_yaml_mapping(config_path)
        dashboard = config.get("dashboard") or {}
        if not isinstance(dashboard, dict):
            raise ValueError("dashboard config must be a mapping")
        if dashboard.get("host") is not None:
            settings["host"] = str(dashboard["host"])
        if dashboard.get("port") is not None:
            settings["port"] = int(dashboard["port"])
        if dashboard.get("state_dir") is not None:
            settings["state_dir"] = Path(str(dashboard["state_dir"]))
        if dashboard.get("dashboard_dir") is not None:
            settings["dashboard_dir"] = Path(str(dashboard["dashboard_dir"]))
        if dashboard.get("auth_token_env") is not None:
            settings["auth_token_env"] = str(dashboard["auth_token_env"])
        if dashboard.get("auth_tokens") is not None:
            settings["auth_tokens"] = normalize_auth_token_configs(dashboard["auth_tokens"])
        if dashboard.get("network_access") is not None:
            network_access = dashboard["network_access"]
            if not isinstance(network_access, dict):
                raise ValueError("dashboard.network_access must be a mapping")
            settings["network_access"] = normalize_network_access_config(network_access)
        if dashboard.get("command_audit_signature_env") is not None:
            settings["command_audit_signature_env"] = str(dashboard["command_audit_signature_env"]).strip() or None
        if dashboard.get("data_roots") is not None:
            raw_roots = dashboard["data_roots"]
            if not isinstance(raw_roots, list):
                raise ValueError("dashboard.data_roots must be a list")
            settings["data_roots"] = [Path(str(root)) for root in raw_roots]
        if dashboard.get("fetch_manifest_roots") is not None:
            raw_roots = dashboard["fetch_manifest_roots"]
            if not isinstance(raw_roots, list):
                raise ValueError("dashboard.fetch_manifest_roots must be a list")
            settings["fetch_manifest_roots"] = [Path(str(root)) for root in raw_roots]
        if dashboard.get("plugin_registry_paths") is not None:
            raw_paths = dashboard["plugin_registry_paths"]
            if not isinstance(raw_paths, list):
                raise ValueError("dashboard.plugin_registry_paths must be a list")
            settings["plugin_registry_paths"] = [Path(str(path)) for path in raw_paths]
        if dashboard.get("command_rate_limit") is not None:
            rate_limit = dashboard["command_rate_limit"]
            if not isinstance(rate_limit, dict):
                raise ValueError("dashboard.command_rate_limit must be a mapping")
            settings["command_rate_limit"] = {
                **settings["command_rate_limit"],
                **rate_limit,
            }
        if dashboard.get("command_scopes") is not None:
            scopes = dashboard["command_scopes"]
            if not isinstance(scopes, dict):
                raise ValueError("dashboard.command_scopes must be a mapping")
            settings["command_scopes"] = normalize_command_scope_policy(scopes)

    if host is not None:
        settings["host"] = host
    if port is not None:
        settings["port"] = port
    if state_dir is not None:
        settings["state_dir"] = state_dir
    if dashboard_dir is not None:
        settings["dashboard_dir"] = dashboard_dir
    if data_roots is not None:
        settings["data_roots"] = data_roots
    if fetch_manifest_roots is not None:
        settings["fetch_manifest_roots"] = fetch_manifest_roots
    if plugin_registry_paths is not None:
        settings["plugin_registry_paths"] = plugin_registry_paths
    if auth_token_env is not None:
        settings["auth_token_env"] = auth_token_env
    if command_audit_signature_env is not None:
        settings["command_audit_signature_env"] = command_audit_signature_env
    return settings


def scan_data_file_candidates(data_roots: list[Path], *, limit: int) -> tuple[list[Path], list[dict[str, Any]]]:
    files: list[Path] = []
    root_summaries: list[dict[str, Any]] = []
    for root in data_roots:
        started = time.monotonic()
        resolved = root.resolve()
        summary: dict[str, Any] = {
            "path": display_path(resolved),
            "display_path": display_path(resolved),
            "exists": resolved.exists(),
            "is_dir": resolved.is_dir() if resolved.exists() else False,
            "catalog_limit": limit,
            "candidate_count": 0,
            "parsed_count": 0,
            "parse_error_count": 0,
            "unsupported_file_count": 0,
            "scan_capped": False,
            "not_scanned_reason": None,
            "sample_errors": [],
            "sample_unsupported_files": [],
        }
        root_summaries.append(summary)
        if len(files) >= limit:
            summary["not_scanned_reason"] = "global catalog limit already reached"
            summary["scan_duration_ms"] = round((time.monotonic() - started) * 1000.0, 3)
            continue
        if not root.exists() or not root.is_dir():
            summary["not_scanned_reason"] = "root missing or not a directory"
            summary["scan_duration_ms"] = round((time.monotonic() - started) * 1000.0, 3)
            continue
        try:
            for path in sorted(root.rglob("*")):
                try:
                    if not path.is_file():
                        continue
                except OSError as exc:
                    summary["parse_error_count"] += 1
                    if len(summary["sample_errors"]) < 5:
                        summary["sample_errors"].append({"path": display_path(path), "error": str(exc)})
                    continue
                if path.suffix.lower() not in DATA_FILE_SUFFIXES:
                    summary["unsupported_file_count"] += 1
                    if len(summary["sample_unsupported_files"]) < 5:
                        summary["sample_unsupported_files"].append({
                            "path": display_path(path),
                            "reason": f"unsupported extension {path.suffix.lower() or 'none'}",
                        })
                    continue
                if len(files) >= limit:
                    summary["scan_capped"] = True
                    summary["not_scanned_reason"] = "global catalog limit reached"
                    summary["scan_duration_ms"] = round((time.monotonic() - started) * 1000.0, 3)
                    break
                files.append(path)
                summary["candidate_count"] += 1
        except OSError as exc:
            summary["parse_error_count"] += 1
            summary["not_scanned_reason"] = str(exc)
            if len(summary["sample_errors"]) < 5:
                summary["sample_errors"].append({"path": display_path(resolved), "error": str(exc)})
        finally:
            summary["scan_duration_ms"] = round((time.monotonic() - started) * 1000.0, 3)
    return files, root_summaries


def data_file_candidates(data_roots: list[Path], *, limit: int) -> list[Path]:
    files, _root_summaries = scan_data_file_candidates(data_roots, limit=limit)
    return files


def infer_symbol(path: Path, df: pd.DataFrame) -> str | None:
    if "symbol" in df.columns:
        values = [str(value).upper() for value in df["symbol"].dropna().unique()[:2]]
        if len(values) == 1:
            return values[0]
    match = re.match(r"([A-Za-z0-9.-]+)", path.stem)
    return match.group(1).upper() if match else None


def infer_bar_size(path: Path, df: pd.DataFrame) -> str | None:
    if "bar_size" in df.columns:
        values = [str(value) for value in df["bar_size"].dropna().unique()[:2]]
        if len(values) == 1:
            return values[0]
    lowered = "/".join(part.lower() for part in path.parts)
    for token in BAR_SIZE_TOKENS:
        if token in lowered:
            return token
    return None


def infer_asset_class(path: Path, symbol: str | None) -> str:
    symbol_text = (symbol or "").upper()
    lowered = "/".join(part.lower() for part in path.parts)
    if symbol_text.endswith("-USD") or "crypto" in lowered or "zerohash" in lowered:
        return "crypto"
    if symbol_text in ETF_SYMBOLS:
        return "etf"
    return "stock" if symbol_text else "unknown"


def infer_data_source(path: Path) -> str:
    lowered = "/".join(part.lower() for part in path.parts)
    if "examples/data" in lowered:
        return "example"
    if "zerohash" in lowered:
        return "zerohash"
    if "ibkr" in lowered or "interactive" in lowered:
        return "ibkr"
    if "schwab" in lowered:
        return "schwab"
    if "polygon" in lowered:
        return "polygon"
    if "firstrate" in lowered or "first_rate" in lowered:
        return "firstrate"
    if "cache" in lowered:
        return "cache"
    return "file"


def canonical_symbol(symbol: str | None, asset_class: str) -> str | None:
    if not symbol:
        return None
    cleaned = symbol.upper().replace("_", "-")
    if asset_class == "crypto" and "-" not in cleaned:
        return f"{cleaned}-USD"
    return cleaned


def single_metadata_value(df: pd.DataFrame, *names: str) -> str | None:
    lower_map = {str(col).lower().replace("_", " "): str(col) for col in df.columns}
    for name in names:
        column = lower_map.get(name.lower().replace("_", " "))
        if not column:
            continue
        values = [str(value).strip() for value in df[column].dropna().unique()[:2]]
        if len(values) == 1 and values[0]:
            return values[0]
    return None


def infer_storage_session(path: Path, df: pd.DataFrame, asset_class: str) -> str:
    explicit = single_metadata_value(df, "session", "trading_session", "rth")
    if explicit is not None:
        lowered = explicit.lower()
        if lowered in {"true", "1", "rth", "regular", "regular_hours"}:
            return "rth"
        if lowered in {"false", "0", "extended", "all", "all_hours", "eth"}:
            return "extended"
        if lowered in {"24_7", "24/7", "crypto"}:
            return "24_7"
        return explicit
    if asset_class == "crypto":
        return "24_7"
    lowered_path = "/".join(part.lower() for part in path.parts)
    if "rthtrue" in lowered_path or "rth_true" in lowered_path:
        return "rth"
    if "rthfalse" in lowered_path or "rth_false" in lowered_path:
        return "extended"
    return "unknown"


def infer_adjustment_status(path: Path, df: pd.DataFrame, asset_class: str) -> str:
    explicit = single_metadata_value(df, "adjustment", "adjusted", "price_adjustment")
    if explicit is not None:
        lowered = explicit.lower()
        if lowered in {"true", "1", "adjusted", "split_adjusted", "split/dividend_adjusted"}:
            return "adjusted"
        if lowered in {"false", "0", "raw", "unadjusted"}:
            return "raw"
        return explicit
    lowered_cols = {str(col).lower().replace("_", " ") for col in df.columns}
    if any(name in lowered_cols for name in {"adj close", "adjusted close", "split factor", "dividend"}):
        return "adjusted"
    if asset_class == "crypto":
        return "not_applicable"
    if infer_data_source(path) == "ibkr":
        return "raw"
    return "unknown"


def classify_data_root(path: Path) -> str:
    lowered = "/".join(part.lower() for part in path.resolve().parts)
    if "examples/data" in lowered:
        return "public_example"
    if "/private/" in f"/{lowered}/":
        return "private_local"
    if any(token in lowered for token in ("cache", "paper_logs", "data")):
        return "local_cache"
    return "local_path"


def data_root_scope_note(scope: str) -> str:
    return {
        "public_example": "Bundled public sample data.",
        "private_local": "Local/private path; keep out of public commits.",
        "local_cache": "Local cache or runtime data root.",
        "local_path": "Local user-configured data root.",
    }.get(scope, "Local user-configured data root.")


def timestamp_column(df: pd.DataFrame) -> str | None:
    lower_map = {str(col).lower(): str(col) for col in df.columns}
    for name in ("timestamp", "datetime", "date", "time"):
        if name in lower_map:
            return lower_map[name]
    return None


def source_timezone_label(raw: pd.Series | pd.Index) -> str:
    dtype = getattr(raw, "dtype", None)
    if getattr(dtype, "tz", None) is not None:
        return str(dtype.tz)
    sample = [str(value) for value in list(raw.dropna()[:20] if isinstance(raw, pd.Series) else raw.dropna()[:20])]
    if any(re.search(r"(Z|[+-]\d{2}:?\d{2})$", value) for value in sample):
        return "offset-aware"
    return "naive/unknown"


def parse_datetime_utc(raw: Any) -> Any:
    try:
        return pd.to_datetime(raw, utc=True, errors="coerce", format="mixed")
    except TypeError:
        return pd.to_datetime(raw, utc=True, errors="coerce")


def close_column(df: pd.DataFrame) -> str | None:
    lower_map = {str(col).lower(): str(col) for col in df.columns}
    return lower_map.get("close") or lower_map.get("last")


def volume_column(df: pd.DataFrame) -> str | None:
    lower_map = {str(col).lower(): str(col) for col in df.columns}
    return lower_map.get("volume")


def data_quality_summary(
    *,
    rows: int,
    timestamp_available: bool,
    valid_timestamp_count: int,
    timestamp_parse_failures: int | None,
    duplicate_timestamps: int,
    median_interval_seconds: float | None,
    largest_gap_seconds: float | None,
    estimated_missing_intervals: int | None,
    close_column_name: str | None,
    close_missing: int | None,
    volume_column_name: str | None,
    volume_missing: int | None,
) -> dict[str, Any]:
    blockers = []
    warnings = []
    if rows <= 0:
        blockers.append("file contains no rows")
    if not timestamp_available:
        blockers.append("no timestamp column or DatetimeIndex found")
    elif valid_timestamp_count <= 0:
        blockers.append("no parseable timestamps")
    elif timestamp_parse_failures:
        warnings.append(f"{timestamp_parse_failures} timestamp parse failures")
    if close_column_name is None:
        blockers.append("no close/last column found")
    elif close_missing:
        warnings.append(f"{close_missing} missing close values")
    if duplicate_timestamps:
        warnings.append(f"{duplicate_timestamps} duplicate timestamps")
    if estimated_missing_intervals:
        warnings.append(f"{estimated_missing_intervals} estimated missing intervals")
    elif (
        median_interval_seconds is not None
        and largest_gap_seconds is not None
        and median_interval_seconds > 0
        and largest_gap_seconds > median_interval_seconds * 3
    ):
        warnings.append("largest timestamp gap is more than 3x the median interval")
    if volume_column_name is None:
        warnings.append("no volume column found")
    elif volume_missing:
        warnings.append(f"{volume_missing} missing volume values")

    status = "bad" if blockers else "warn" if warnings else "ok"
    all_warnings = blockers + warnings
    return {
        "quality_status": status,
        "quality_warnings": all_warnings,
        "quality_warning_count": len(all_warnings),
    }


def evenly_sample_indices(length: int, points: int) -> list[int]:
    if length <= points:
        return list(range(length))
    if points <= 1:
        return [length - 1]
    step = (length - 1) / (points - 1)
    return sorted({round(index * step) for index in range(points)})


def summarize_data_file(path: Path, *, root: Path, preview_points: int) -> dict[str, Any]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        df = pd.read_csv(path)
        fmt = "csv"
    elif suffix == ".parquet":
        df = pd.read_parquet(path)
        fmt = "parquet"
    else:
        raise ValueError(f"unsupported data file type: {path.suffix}")

    ts_col = timestamp_column(df)
    raw_ts = df[ts_col] if ts_col else (df.index if isinstance(df.index, pd.DatetimeIndex) else None)
    parsed_all = pd.Series([], dtype="datetime64[ns, UTC]")
    parsed_ts = pd.Series([], dtype="datetime64[ns, UTC]")
    source_tz = None
    if raw_ts is not None:
        source_tz = source_timezone_label(raw_ts)
        parsed_all = pd.Series(parse_datetime_utc(raw_ts))
        parsed_ts = parsed_all.dropna()

    first_ts = last_ts = None
    median_interval = largest_gap = None
    estimated_missing: int | None = None
    if not parsed_ts.empty:
        ordered = parsed_ts.sort_values()
        first_ts = ordered.iloc[0].isoformat()
        last_ts = ordered.iloc[-1].isoformat()
        diffs = ordered.diff().dropna().dt.total_seconds()
        if not diffs.empty:
            median_interval = float(diffs.median())
            largest_gap = float(diffs.max())
            if median_interval > 0:
                estimated_missing = int(
                    sum(max(0, round(float(diff) / median_interval) - 1) for diff in diffs if diff > median_interval * 1.5)
                )

    close_col = close_column(df)
    volume_col = volume_column(df)
    close_missing = None
    if close_col:
        close_missing = int(pd.to_numeric(df[close_col], errors="coerce").isna().sum())
    volume_missing = None
    if volume_col:
        volume_missing = int(pd.to_numeric(df[volume_col], errors="coerce").isna().sum())
    duplicate_timestamps = int(parsed_ts.duplicated().sum()) if not parsed_ts.empty else 0
    timestamp_parse_failures = int(parsed_all.isna().sum()) if raw_ts is not None else None
    quality = data_quality_summary(
        rows=int(len(df)),
        timestamp_available=raw_ts is not None,
        valid_timestamp_count=int(len(parsed_ts)),
        timestamp_parse_failures=timestamp_parse_failures,
        duplicate_timestamps=duplicate_timestamps,
        median_interval_seconds=median_interval,
        largest_gap_seconds=largest_gap,
        estimated_missing_intervals=estimated_missing,
        close_column_name=close_col,
        close_missing=close_missing,
        volume_column_name=volume_col,
        volume_missing=volume_missing,
    )
    preview = []
    if close_col and not parsed_ts.empty:
        scoped = pd.DataFrame({
            "timestamp": parse_datetime_utc(raw_ts),
            "close": pd.to_numeric(df[close_col], errors="coerce"),
        })
        if volume_col:
            scoped["volume"] = pd.to_numeric(df[volume_col], errors="coerce")
        scoped = scoped.dropna(subset=["timestamp", "close"]).sort_values("timestamp")
        for idx in evenly_sample_indices(len(scoped), preview_points):
            row = scoped.iloc[idx]
            item = {
                "timestamp": row["timestamp"].isoformat(),
                "close": float(row["close"]),
            }
            if volume_col and pd.notna(row.get("volume")):
                item["volume"] = float(row["volume"])
            preview.append(item)

    stat = path.stat()
    symbol = infer_symbol(path, df)
    asset_class = infer_asset_class(path, symbol)
    return {
        "path": path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path),
        "root": root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root),
        "format": fmt,
        "source": infer_data_source(path),
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "rows": int(len(df)),
        "columns": [str(col) for col in df.columns],
        "symbol": symbol,
        "canonical_symbol": canonical_symbol(symbol, asset_class),
        "asset_class": asset_class,
        "bar_size": infer_bar_size(path, df),
        "storage_session": infer_storage_session(path, df, asset_class),
        "adjustment_status": infer_adjustment_status(path, df, asset_class),
        "timestamp_column": ts_col,
        "source_timezone": source_tz,
        "normalized_timezone": "UTC" if source_tz else None,
        "first_timestamp": first_ts,
        "last_timestamp": last_ts,
        "median_interval_seconds": median_interval,
        "largest_gap_seconds": largest_gap,
        "estimated_missing_intervals": estimated_missing,
        "timestamp_parse_failures": timestamp_parse_failures,
        "duplicate_timestamps": duplicate_timestamps,
        "close_column": close_col,
        "volume_column": volume_col,
        **quality,
        "preview": preview,
    }


def build_data_catalog(
    data_roots: list[Path],
    *,
    limit: int = 50,
    preview_points: int = 80,
) -> dict[str, Any]:
    if preview_points < 2 or preview_points > 500:
        raise ValueError("preview_points must be between 2 and 500")
    datasets = []
    errors = []
    files, root_summaries = scan_data_file_candidates(data_roots, limit=limit)
    root_summary_by_path = {str(row["path"]): row for row in root_summaries}
    for path in files:
        root = next((candidate for candidate in data_roots if path.is_relative_to(candidate)), path.parent)
        root_key = display_path(root)
        root_summary = root_summary_by_path.get(root_key)
        try:
            datasets.append(summarize_data_file(path, root=root, preview_points=preview_points))
            if root_summary is not None:
                root_summary["parsed_count"] += 1
        except Exception as exc:
            if root_summary is not None:
                root_summary["parse_error_count"] += 1
                if len(root_summary["sample_errors"]) < 5:
                    root_summary["sample_errors"].append({
                        "path": display_path(path),
                        "error": str(exc),
                    })
            errors.append({
                "path": path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path),
                "root": root_key,
                "error": str(exc),
            })
    modified_values = [str(item.get("modified_at")) for item in datasets if item.get("modified_at")]
    for row in root_summaries:
        row["skipped_candidate_count"] = max(0, int(row.get("candidate_count") or 0) - int(row.get("parsed_count") or 0) - int(row.get("parse_error_count") or 0))
        row["sample_skipped_files"] = [
            *[
                {
                    "path": item.get("path"),
                    "reason": item.get("error") or "parser error",
                }
                for item in (row.get("sample_errors") or [])[:5]
            ],
            *[
                {
                    "path": item.get("path"),
                    "reason": item.get("reason") or "unsupported file",
                }
                for item in (row.get("sample_unsupported_files") or [])[:5]
            ],
        ][:5]
    return {
        "roots": [root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root) for root in data_roots],
        "root_summaries": root_summaries,
        "datasets": datasets,
        "errors": errors,
        "count": len(datasets),
        "error_count": len(errors),
        "quality_counts": count_values(datasets, "quality_status"),
        "bar_size_counts": count_values(datasets, "bar_size"),
        "asset_class_counts": count_values(datasets, "asset_class"),
        "source_counts": count_values(datasets, "source"),
        "storage_session_counts": count_values(datasets, "storage_session"),
        "adjustment_status_counts": count_values(datasets, "adjustment_status"),
        "row_count_total": sum(int(item.get("rows") or 0) for item in datasets),
        "size_bytes_total": sum(int(item.get("size_bytes") or 0) for item in datasets),
        "latest_modified_at": max(modified_values) if modified_values else None,
        "limit": limit,
        "preview_points": preview_points,
    }


def data_files_for_root(root: Path, *, scan_limit: int) -> tuple[list[Path], bool, list[dict[str, str]], dict[str, Any]]:
    files: list[Path] = []
    errors: list[dict[str, str]] = []
    unsupported: dict[str, Any] = {
        "unsupported_file_count": 0,
        "unsupported_extension_counts": {},
        "sample_unsupported_paths": [],
    }
    capped = False
    if not root.exists() or not root.is_dir():
        return files, capped, errors, unsupported
    try:
        iterator = root.rglob("*")
        for path in iterator:
            try:
                if not path.is_file():
                    continue
            except OSError as exc:
                errors.append({"path": display_path(path), "error": str(exc)})
                continue
            suffix = path.suffix.lower() or "none"
            if suffix not in DATA_FILE_SUFFIXES:
                unsupported["unsupported_file_count"] += 1
                counts = unsupported["unsupported_extension_counts"]
                counts[suffix] = int(counts.get(suffix, 0)) + 1
                if len(unsupported["sample_unsupported_paths"]) < 10:
                    unsupported["sample_unsupported_paths"].append(display_path(path))
                continue
            if len(files) >= scan_limit:
                capped = True
                break
            files.append(path)
    except OSError as exc:
        errors.append({"path": display_path(root), "error": str(exc)})
    unsupported["unsupported_extension_counts"] = dict(sorted(unsupported["unsupported_extension_counts"].items()))
    return files, capped, errors, unsupported


def audit_data_root(
    root: Path,
    *,
    configured: bool,
    catalog_paths: set[str],
    scan_limit: int,
) -> dict[str, Any]:
    resolved = root.resolve()
    started = time.perf_counter()
    probe = writable_probe(resolved, expect_dir=True)
    files, capped, errors, unsupported = data_files_for_root(resolved, scan_limit=scan_limit)
    file_rows = []
    for path in files:
        display = display_path(path)
        symbol = infer_symbol(path, pd.DataFrame())
        file_rows.append({
            "path": display,
            "extension": path.suffix.lower(),
            "source": infer_data_source(path),
            "asset_class": infer_asset_class(path, symbol),
            "bar_size": infer_bar_size(path, pd.DataFrame()),
            "catalog_visible": display in catalog_paths,
        })
    visible_count = sum(1 for row in file_rows if row["catalog_visible"])
    hidden_rows = [row for row in file_rows if not row["catalog_visible"]]
    size_bytes = 0
    for path in files:
        try:
            size_bytes += path.stat().st_size
        except OSError:
            continue
    scan_duration_ms = (time.perf_counter() - started) * 1000.0
    return {
        **probe,
        "display_path": display_path(resolved),
        "configured": configured,
        "root_scope": classify_data_root(resolved),
        "root_scope_note": data_root_scope_note(classify_data_root(resolved)),
        "file_count": len(files),
        "scan_limit": scan_limit,
        "scan_duration_ms": round(scan_duration_ms, 3),
        "scan_capped": capped,
        "size_bytes": size_bytes,
        "catalog_visible_count": visible_count,
        "hidden_file_count": len(hidden_rows),
        "extension_counts": count_values(file_rows, "extension"),
        "asset_class_guess_counts": count_values(file_rows, "asset_class"),
        "source_guess_counts": count_values(file_rows, "source"),
        "bar_size_guess_counts": count_values(file_rows, "bar_size"),
        "sample_hidden_paths": [row["path"] for row in hidden_rows[:10]],
        "unsupported_file_count": unsupported["unsupported_file_count"],
        "unsupported_extension_counts": unsupported["unsupported_extension_counts"],
        "sample_unsupported_paths": unsupported["sample_unsupported_paths"],
        "errors": errors,
        "error_count": len(errors),
    }


def merge_count_maps(rows: Iterable[dict[str, Any]], field: str) -> dict[str, int]:
    counts: Counter[str] = Counter()
    for row in rows:
        values = row.get(field)
        if not isinstance(values, dict):
            continue
        for key, value in values.items():
            counts[str(key)] += int(value or 0)
    return dict(sorted(counts.items()))


def build_data_storage_audit(
    data_roots: list[Path],
    *,
    catalog_limit: int = 200,
    scan_limit: int = 5000,
) -> dict[str, Any]:
    catalog = build_data_catalog(data_roots, limit=catalog_limit, preview_points=2)
    catalog_paths = {str(row.get("path") or "") for row in catalog.get("datasets", [])}
    configured_rows = [
        audit_data_root(root, configured=True, catalog_paths=catalog_paths, scan_limit=scan_limit)
        for root in data_roots
    ]
    configured_resolved = {root.resolve() for root in data_roots}
    suggested_rows = []
    for root in SUGGESTED_DATA_ROOTS:
        resolved = root.resolve()
        if resolved in configured_resolved:
            continue
        row = audit_data_root(resolved, configured=False, catalog_paths=catalog_paths, scan_limit=scan_limit)
        if row["file_count"] or row["error_count"]:
            suggested_rows.append(row)
    configured_file_count = sum(int(row.get("file_count") or 0) for row in configured_rows)
    configured_visible_count = sum(int(row.get("catalog_visible_count") or 0) for row in configured_rows)
    hidden_configured_count = sum(int(row.get("hidden_file_count") or 0) for row in configured_rows)
    suggested_file_count = sum(int(row.get("file_count") or 0) for row in suggested_rows)
    unsupported_file_count = sum(int(row.get("unsupported_file_count") or 0) for row in configured_rows + suggested_rows)
    warnings = []
    if not configured_file_count:
        warnings.append("No CSV/parquet files were found under configured data roots.")
    if hidden_configured_count:
        warnings.append("Some configured-root files are not visible in the current catalog result.")
    if suggested_file_count:
        warnings.append("Suggested local roots contain files that are not currently scanned.")
    if unsupported_file_count:
        warnings.append("Some root files have unsupported extensions and are not catalog-visible.")
    if catalog.get("errors"):
        warnings.append("Some configured-root files failed catalog parsing.")
    if any(row.get("scan_capped") for row in configured_rows + suggested_rows):
        warnings.append("The storage audit reached its per-root scan limit.")
    if not configured_file_count and not suggested_file_count:
        status = "bad"
    elif warnings:
        status = "warn"
    else:
        status = "ok"
    return {
        "generated_at": utc_now(),
        "status": status,
        "warnings": warnings,
        "warning_count": len(warnings),
        "catalog_limit": catalog_limit,
        "scan_limit": scan_limit,
        "scan_duration_ms_total": round(sum(float(row.get("scan_duration_ms") or 0.0) for row in configured_rows + suggested_rows), 3),
        "catalog_visible_count": len(catalog_paths),
        "catalog_error_count": int(catalog.get("error_count") or 0),
        "configured_file_count": configured_file_count,
        "configured_visible_count": configured_visible_count,
        "hidden_configured_file_count": hidden_configured_count,
        "suggested_file_count": suggested_file_count,
        "unsupported_file_count": unsupported_file_count,
        "extension_counts": merge_count_maps(configured_rows + suggested_rows, "extension_counts"),
        "unsupported_extension_counts": merge_count_maps(configured_rows + suggested_rows, "unsupported_extension_counts"),
        "asset_class_guess_counts": merge_count_maps(configured_rows + suggested_rows, "asset_class_guess_counts"),
        "source_guess_counts": merge_count_maps(configured_rows + suggested_rows, "source_guess_counts"),
        "bar_size_guess_counts": merge_count_maps(configured_rows + suggested_rows, "bar_size_guess_counts"),
        "configured_extension_counts": merge_count_maps(configured_rows, "extension_counts"),
        "configured_asset_class_guess_counts": merge_count_maps(configured_rows, "asset_class_guess_counts"),
        "configured_source_guess_counts": merge_count_maps(configured_rows, "source_guess_counts"),
        "configured_bar_size_guess_counts": merge_count_maps(configured_rows, "bar_size_guess_counts"),
        "configured_roots": configured_rows,
        "suggested_roots": suggested_rows,
    }


DATA_CATALOG_EXPORT_FIELDS = (
    "path",
    "root",
    "symbol",
    "canonical_symbol",
    "asset_class",
    "source",
    "bar_size",
    "storage_session",
    "adjustment_status",
    "format",
    "rows",
    "first_timestamp",
    "last_timestamp",
    "median_interval_seconds",
    "largest_gap_seconds",
    "estimated_missing_intervals",
    "quality_status",
    "quality_warning_count",
    "timestamp_parse_failures",
    "duplicate_timestamps",
    "close_column",
    "volume_column",
    "source_timezone",
    "size_bytes",
    "modified_at",
)


DATA_CATALOG_SCAN_EXPORT_FIELDS = (
    "row_type",
    "path",
    "display_path",
    "exists",
    "is_dir",
    "catalog_limit",
    "candidate_count",
    "parsed_count",
    "parse_error_count",
    "unsupported_file_count",
    "skipped_candidate_count",
    "scan_duration_ms",
    "scan_capped",
    "not_scanned_reason",
    "sample_path",
    "sample_reason",
    "sample_error",
)


DATA_STORAGE_AUDIT_EXPORT_FIELDS = (
    "scope",
    "path",
    "display_path",
    "root_scope",
    "root_scope_note",
    "exists",
    "is_dir",
    "writable",
    "file_count",
    "catalog_visible_count",
    "hidden_file_count",
    "scan_limit",
    "scan_duration_ms",
    "scan_capped",
    "size_bytes",
    "error_count",
    "unsupported_file_count",
    "unsupported_extension_counts",
    "sample_unsupported_paths",
    "extension_counts",
    "asset_class_guess_counts",
    "source_guess_counts",
    "bar_size_guess_counts",
    "sample_hidden_paths",
    "errors",
)


DATA_COVERAGE_EXPORT_FIELDS = (
    "symbol",
    "asset_class",
    "sources",
    "bar_sizes",
    "storage_sessions",
    "dataset_count",
    "row_count",
    "date_count",
    "first_timestamp",
    "last_timestamp",
    "date",
    "covered",
)


DATA_GAP_SUMMARY_EXPORT_FIELDS = (
    "row_type",
    "symbol",
    "asset_class",
    "source",
    "bar_size",
    "storage_session",
    "path",
    "first_timestamp",
    "last_timestamp",
    "median_interval_seconds",
    "largest_gap_seconds",
    "estimated_missing_intervals",
    "quality_status",
    "quality_warning_count",
    "first_day",
    "last_day",
    "date_count",
    "calendar_day_count",
    "missing_calendar_days",
)


DATA_MINUTE_HEATMAP_EXPORT_FIELDS = (
    "row_type",
    "symbol",
    "asset_class",
    "source",
    "bar_size",
    "storage_session",
    "path",
    "first_timestamp",
    "last_timestamp",
    "median_interval_seconds",
    "completeness_pct",
    "actual_intervals",
    "expected_intervals",
    "estimated_missing_intervals",
    "hour_utc",
    "date_utc",
    "format",
    "rows",
)


FETCH_MANIFEST_EXPORT_FIELDS = (
    "job_id",
    "kind",
    "status",
    "started_at",
    "finished_at",
    "modified_at",
    "symbols_requested",
    "tracked_symbols",
    "success_symbols",
    "failed_symbols",
    "partial_symbols",
    "empty_symbols",
    "skipped_symbols",
    "success_chunks",
    "empty_chunks",
    "failed_chunks",
    "pending_chunks",
    "skipped_existing_chunks",
    "outputs",
    "errors",
    "rows",
    "retry_events",
    "pacing_wait_events",
    "pacing_wait_seconds",
    "avg_output_elapsed_seconds",
    "latest_completed_chunks",
    "latest_remaining_chunks",
    "latest_completed_symbols",
    "latest_remaining_symbols",
    "latest_total_symbols",
    "latest_eta_seconds",
    "latest_avg_chunk_seconds",
    "latest_avg_symbol_seconds",
    "error_kind_counts",
    "status_counts",
    "output_status_counts",
    "bar_size",
    "duration",
    "months",
    "exchange",
    "range_start",
    "range_end",
    "out_dir",
    "first_output_path",
    "latest_output_path",
    "output_path_sample",
    "path",
    "root",
    "size_bytes",
)


FETCH_MANIFEST_DETAIL_EXPORT_FIELDS = (
    "row_type",
    "job_id",
    "kind",
    "status",
    "symbol",
    "symbol_status",
    "timestamp",
    "day",
    "rows",
    "bars",
    "chunks_completed",
    "chunks_failed",
    "chunks_skipped",
    "first_timestamp",
    "last_timestamp",
    "path",
    "data_detail_path",
    "data_detail_available",
    "data_detail_status",
    "data_detail_reason",
    "elapsed_seconds",
    "attempt_count",
    "error_kind",
    "event_type",
    "attempt",
    "max_retries",
    "delay_seconds",
    "seconds",
    "reason",
    "message",
)


def compact_csv_value(value: Any) -> Any:
    if isinstance(value, dict):
        return json.dumps(value, sort_keys=True)
    if isinstance(value, list):
        if all(not isinstance(item, (dict, list)) for item in value):
            return ";".join(str(item) for item in value)
        return json.dumps(value, sort_keys=True)
    return value


def build_data_storage_audit_csv(
    data_roots: list[Path],
    *,
    catalog_limit: int = 200,
    scan_limit: int = 5000,
) -> str:
    audit = build_data_storage_audit(data_roots, catalog_limit=catalog_limit, scan_limit=scan_limit)
    rows = [
        *({**row, "scope": "configured"} for row in audit.get("configured_roots", [])),
        *({**row, "scope": "suggested"} for row in audit.get("suggested_roots", [])),
    ]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=DATA_STORAGE_AUDIT_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: compact_csv_value(row.get(field)) for field in DATA_STORAGE_AUDIT_EXPORT_FIELDS})
    return out.getvalue()


def build_data_catalog_csv(data_roots: list[Path], *, limit: int = 200) -> str:
    catalog = build_data_catalog(data_roots, limit=limit, preview_points=2)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=DATA_CATALOG_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in catalog["datasets"]:
        writer.writerow({field: row.get(field) for field in DATA_CATALOG_EXPORT_FIELDS})
    return out.getvalue()


def build_data_catalog_scan_csv(data_roots: list[Path], *, limit: int = 200) -> str:
    catalog = build_data_catalog(data_roots, limit=limit, preview_points=2)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=DATA_CATALOG_SCAN_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for item in catalog.get("root_summaries", []):
        base = {field: item.get(field) for field in DATA_CATALOG_SCAN_EXPORT_FIELDS}
        base["row_type"] = "root"
        writer.writerow({field: compact_csv_value(base.get(field)) for field in DATA_CATALOG_SCAN_EXPORT_FIELDS})
        for sample in item.get("sample_skipped_files") or []:
            row = {
                **base,
                "row_type": "skipped_sample",
                "sample_path": sample.get("path"),
                "sample_reason": sample.get("reason"),
                "sample_error": sample.get("error"),
            }
            writer.writerow({field: compact_csv_value(row.get(field)) for field in DATA_CATALOG_SCAN_EXPORT_FIELDS})
    return out.getvalue()


def build_data_coverage_csv(
    data_roots: list[Path],
    *,
    limit: int = 200,
    max_symbols: int = 60,
    max_dates: int = 60,
) -> str:
    coverage = build_data_coverage(data_roots, limit=limit, max_symbols=max_symbols, max_dates=max_dates)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=DATA_COVERAGE_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    date_bins = coverage.get("date_bins") or []
    for item in coverage.get("symbols") or []:
        flags = list(item.get("coverage") or [])
        for index, date_value in enumerate(date_bins):
            writer.writerow({
                "symbol": item.get("symbol"),
                "asset_class": item.get("asset_class"),
                "sources": compact_csv_value(item.get("sources")),
                "bar_sizes": compact_csv_value(item.get("bar_sizes")),
                "storage_sessions": compact_csv_value(item.get("storage_sessions")),
                "dataset_count": item.get("dataset_count"),
                "row_count": item.get("row_count"),
                "date_count": item.get("date_count"),
                "first_timestamp": item.get("first_timestamp"),
                "last_timestamp": item.get("last_timestamp"),
                "date": date_value,
                "covered": bool(flags[index]) if index < len(flags) else False,
            })
    return out.getvalue()


def build_data_gap_summary_csv(
    data_roots: list[Path],
    *,
    catalog_limit: int = 200,
    top_limit: int = 20,
) -> str:
    summary = build_data_gap_summary(data_roots, catalog_limit=catalog_limit, top_limit=top_limit)
    rows = [
        *({**row, "row_type": "timestamp_gap"} for row in summary.get("gap_rows", [])),
        *({**row, "row_type": "calendar_gap"} for row in summary.get("calendar_rows", [])),
    ]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=DATA_GAP_SUMMARY_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: compact_csv_value(row.get(field)) for field in DATA_GAP_SUMMARY_EXPORT_FIELDS})
    return out.getvalue()


def build_data_minute_heatmap_csv(
    data_roots: list[Path],
    *,
    catalog_limit: int = 200,
    top_limit: int = 20,
) -> str:
    summary = build_data_minute_heatmap(data_roots, catalog_limit=catalog_limit, top_limit=top_limit)
    rows = []
    for item in summary.get("rows") or []:
        for hour in item.get("hours") or []:
            if int(hour.get("expected_intervals") or 0) <= 0:
                continue
            rows.append({
                "row_type": "hour_summary",
                "symbol": item.get("symbol"),
                "asset_class": item.get("asset_class"),
                "source": item.get("source"),
                "bar_size": item.get("bar_size"),
                "storage_session": item.get("storage_session"),
                "path": item.get("path"),
                "first_timestamp": item.get("first_timestamp"),
                "last_timestamp": item.get("last_timestamp"),
                "median_interval_seconds": item.get("median_interval_seconds"),
                "format": item.get("format"),
                "rows": item.get("rows"),
                **hour,
            })
    for item in summary.get("date_hour_rows") or []:
        rows.append({**item, "row_type": "date_hour"})
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=DATA_MINUTE_HEATMAP_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: compact_csv_value(row.get(field)) for field in DATA_MINUTE_HEATMAP_EXPORT_FIELDS})
    return out.getvalue()


def normalize_symbol(value: str) -> str:
    return re.sub(r"[^A-Z0-9]+", "", value.upper())


def path_matches_symbol(path: Path, symbol: str) -> bool:
    normalized = normalize_symbol(symbol)
    if not normalized:
        return False
    path_parts = [normalize_symbol(part) for part in path.parts]
    stem = normalize_symbol(path.stem)
    return any(part == normalized for part in path_parts) or stem.startswith(normalized) or normalized in stem


def matching_symbol_files(
    roots: list[Path],
    symbol: str,
    *,
    limit: int = 100,
    max_scanned_files: int = 5000,
) -> list[tuple[Path, Path]]:
    matches: list[tuple[Path, Path]] = []
    for root in roots:
        if not root.exists() or not root.is_dir():
            continue
        scanned = 0
        for path in root.rglob("*"):
            if not path.is_file() or path.suffix.lower() not in DATA_FILE_SUFFIXES:
                continue
            scanned += 1
            if path_matches_symbol(path, symbol):
                matches.append((path, root))
                if len(matches) >= limit:
                    return matches
            if scanned >= max_scanned_files:
                break
    return matches


def read_timestamp_frame(path: Path) -> tuple[pd.DataFrame, str]:
    df, fmt = read_data_file(path)
    ts_col = timestamp_column(df)
    if ts_col is None and not isinstance(df.index, pd.DatetimeIndex):
        raise ValueError("no timestamp column or DatetimeIndex found")
    return df, fmt


def coverage_for_data_file(path: Path, *, root: Path) -> dict[str, Any]:
    df, fmt = read_timestamp_frame(path)
    ts_col = timestamp_column(df)
    raw_ts = df[ts_col] if ts_col else df.index
    parsed = pd.Series(parse_datetime_utc(raw_ts)).dropna()
    if parsed.empty:
        raise ValueError("no parseable timestamps")
    dates = sorted({item.date().isoformat() for item in parsed})
    first = parsed.min().isoformat()
    last = parsed.max().isoformat()
    first_day = datetime.fromisoformat(dates[0]).date()
    last_day = datetime.fromisoformat(dates[-1]).date()
    calendar_days = (last_day - first_day).days + 1
    symbol = infer_symbol(path, df)
    asset_class = infer_asset_class(path, symbol)
    return {
        "path": display_path(path),
        "root": display_path(root),
        "symbol": symbol,
        "asset_class": asset_class,
        "source": infer_data_source(path),
        "bar_size": infer_bar_size(path, df),
        "storage_session": infer_storage_session(path, df, asset_class),
        "format": fmt,
        "rows": int(len(df)),
        "first_timestamp": first,
        "last_timestamp": last,
        "first_day": dates[0],
        "last_day": dates[-1],
        "date_count": len(dates),
        "calendar_day_count": calendar_days,
        "missing_calendar_days": max(0, calendar_days - len(dates)),
        "dates": dates,
    }


def build_data_coverage(
    data_roots: list[Path],
    *,
    limit: int = 200,
    max_symbols: int = 60,
    max_dates: int = 60,
) -> dict[str, Any]:
    if max_symbols < 1 or max_symbols > 500:
        raise ValueError("max_symbols must be between 1 and 500")
    if max_dates < 1 or max_dates > 366:
        raise ValueError("max_dates must be between 1 and 366")
    dataset_rows = []
    errors = []
    for path in data_file_candidates(data_roots, limit=limit):
        root = next((candidate for candidate in data_roots if path.is_relative_to(candidate)), path.parent)
        try:
            dataset_rows.append(coverage_for_data_file(path, root=root))
        except Exception as exc:
            errors.append({"path": display_path(path), "error": str(exc)})

    by_symbol: dict[str, dict[str, Any]] = {}
    for row in dataset_rows:
        symbol = str(row.get("symbol") or "UNKNOWN")
        if symbol not in by_symbol:
            by_symbol[symbol] = {
                "symbol": symbol,
                "asset_class": row.get("asset_class"),
                "sources": set(),
                "bar_sizes": set(),
                "storage_sessions": set(),
                "dataset_count": 0,
                "row_count": 0,
                "dates": set(),
                "first_timestamp": None,
                "last_timestamp": None,
            }
        item = by_symbol[symbol]
        item["dataset_count"] += 1
        item["row_count"] += int(row.get("rows") or 0)
        if row.get("source"):
            item["sources"].add(str(row["source"]))
        if row.get("bar_size"):
            item["bar_sizes"].add(str(row["bar_size"]))
        if row.get("storage_session"):
            item["storage_sessions"].add(str(row["storage_session"]))
        item["dates"].update(row.get("dates") or [])
        first = row.get("first_timestamp")
        last = row.get("last_timestamp")
        if first and (item["first_timestamp"] is None or str(first) < str(item["first_timestamp"])):
            item["first_timestamp"] = first
        if last and (item["last_timestamp"] is None or str(last) > str(item["last_timestamp"])):
            item["last_timestamp"] = last

    all_dates = sorted({date for item in by_symbol.values() for date in item["dates"]})
    date_bins = all_dates[-max_dates:]
    symbol_rows = []
    for item in sorted(by_symbol.values(), key=lambda row: (-len(row["dates"]), str(row["symbol"])))[:max_symbols]:
        dates = set(item["dates"])
        symbol_rows.append({
            "symbol": item["symbol"],
            "asset_class": item["asset_class"],
            "sources": sorted(item["sources"]),
            "bar_sizes": sorted(item["bar_sizes"]),
            "storage_sessions": sorted(item["storage_sessions"]),
            "dataset_count": item["dataset_count"],
            "row_count": item["row_count"],
            "date_count": len(dates),
            "first_timestamp": item["first_timestamp"],
            "last_timestamp": item["last_timestamp"],
            "coverage": [date in dates for date in date_bins],
        })
    return {
        "generated_at": utc_now(),
        "roots": [display_path(root) for root in data_roots],
        "date_bins": date_bins,
        "symbols": symbol_rows,
        "datasets": [
            {key: value for key, value in row.items() if key != "dates"}
            for row in dataset_rows
        ],
        "count": len(symbol_rows),
        "dataset_count": len(dataset_rows),
        "total_symbol_count": len(by_symbol),
        "error_count": len(errors),
        "errors": errors,
        "limit": limit,
        "max_symbols": max_symbols,
        "max_dates": max_dates,
    }


def build_data_gap_summary(
    data_roots: list[Path],
    *,
    catalog_limit: int = 200,
    top_limit: int = 20,
) -> dict[str, Any]:
    if top_limit < 1 or top_limit > 100:
        raise ValueError("top_limit must be between 1 and 100")
    catalog = build_data_catalog(data_roots, limit=catalog_limit, preview_points=2)
    coverage = build_data_coverage(data_roots, limit=catalog_limit, max_symbols=500, max_dates=366)
    datasets = catalog.get("datasets") or []
    gap_rows = []
    for item in datasets:
        missing = int(item.get("estimated_missing_intervals") or 0)
        largest_gap = finite_float(item.get("largest_gap_seconds"))
        median_interval = finite_float(item.get("median_interval_seconds"))
        suspicious_gap = (
            largest_gap is not None
            and median_interval is not None
            and median_interval > 0
            and largest_gap > median_interval * 3
        )
        if missing <= 0 and not suspicious_gap:
            continue
        gap_rows.append({
            "symbol": item.get("symbol"),
            "asset_class": item.get("asset_class"),
            "source": item.get("source"),
            "bar_size": item.get("bar_size"),
            "storage_session": item.get("storage_session"),
            "path": item.get("path"),
            "rows": item.get("rows"),
            "first_timestamp": item.get("first_timestamp"),
            "last_timestamp": item.get("last_timestamp"),
            "median_interval_seconds": median_interval,
            "largest_gap_seconds": largest_gap,
            "estimated_missing_intervals": missing,
            "quality_status": item.get("quality_status"),
            "quality_warning_count": item.get("quality_warning_count"),
        })
    gap_rows.sort(key=lambda row: (
        -int(row.get("estimated_missing_intervals") or 0),
        -float(row.get("largest_gap_seconds") or 0.0),
        str(row.get("symbol") or ""),
    ))
    calendar_rows = [
        {
            "symbol": row.get("symbol"),
            "asset_class": row.get("asset_class"),
            "source": row.get("source"),
            "bar_size": row.get("bar_size"),
            "storage_session": row.get("storage_session"),
            "path": row.get("path"),
            "first_day": row.get("first_day"),
            "last_day": row.get("last_day"),
            "date_count": row.get("date_count"),
            "calendar_day_count": row.get("calendar_day_count"),
            "missing_calendar_days": row.get("missing_calendar_days"),
        }
        for row in (coverage.get("datasets") or [])
        if int(row.get("missing_calendar_days") or 0) > 0
    ]
    calendar_rows.sort(key=lambda row: (
        -int(row.get("missing_calendar_days") or 0),
        str(row.get("symbol") or ""),
    ))
    total_missing = sum(int(row.get("estimated_missing_intervals") or 0) for row in gap_rows)
    files_with_missing = sum(1 for row in gap_rows if int(row.get("estimated_missing_intervals") or 0) > 0)
    largest_gap = max([float(row.get("largest_gap_seconds") or 0.0) for row in gap_rows], default=0.0)
    status = "bad" if catalog.get("error_count") and not datasets else "warn" if gap_rows or calendar_rows or catalog.get("error_count") else "ok"
    warnings = []
    if gap_rows:
        warnings.append(f"{len(gap_rows)} files have timestamp gaps or suspicious intervals")
    if calendar_rows:
        warnings.append(f"{len(calendar_rows)} files have missing calendar days")
    if catalog.get("error_count"):
        warnings.append(f"{catalog.get('error_count')} files failed catalog parsing")
    return {
        "generated_at": utc_now(),
        "status": status,
        "warnings": warnings,
        "warning_count": len(warnings),
        "roots": [display_path(root) for root in data_roots],
        "catalog_limit": catalog_limit,
        "top_limit": top_limit,
        "dataset_count": len(datasets),
        "catalog_error_count": catalog.get("error_count"),
        "total_estimated_missing_intervals": total_missing,
        "files_with_missing_intervals": files_with_missing,
        "files_with_gap_warnings": len(gap_rows),
        "largest_gap_seconds": largest_gap if largest_gap > 0 else None,
        "files_with_missing_calendar_days": len(calendar_rows),
        "gap_rows": gap_rows[:top_limit],
        "calendar_rows": calendar_rows[:top_limit],
    }


def interval_heatmap_for_data_file(path: Path, *, root: Path) -> dict[str, Any]:
    df, fmt = read_timestamp_frame(path)
    ts_col = timestamp_column(df)
    raw_ts = df[ts_col] if ts_col else df.index
    parsed = pd.Series(parse_datetime_utc(raw_ts)).dropna().sort_values()
    if parsed.empty:
        raise ValueError("no parseable timestamps")
    ordered = parsed.drop_duplicates().sort_values()
    if len(ordered) < 2:
        raise ValueError("not enough timestamps for interval completeness")
    diffs = ordered.diff().dropna().dt.total_seconds()
    positive_diffs = diffs[diffs > 0]
    if positive_diffs.empty:
        raise ValueError("not enough positive timestamp intervals")
    median_interval = finite_float(positive_diffs.median())
    if median_interval is None or median_interval <= 0:
        raise ValueError("invalid median timestamp interval")

    actual_by_hour: Counter[int] = Counter(int(ts.hour) for ts in ordered)
    actual_by_date_hour: Counter[tuple[str, int]] = Counter((ts.date().isoformat(), int(ts.hour)) for ts in ordered)
    missing_by_hour: Counter[int] = Counter()
    missing_by_date_hour: Counter[tuple[str, int]] = Counter()
    previous = ordered.iloc[0]
    step = pd.Timedelta(seconds=median_interval)
    for current in ordered.iloc[1:]:
        gap_seconds = float((current - previous).total_seconds())
        if gap_seconds > median_interval * 1.5:
            missing = max(0, round(gap_seconds / median_interval) - 1)
            for index in range(1, missing + 1):
                estimated_ts = previous + step * index
                if estimated_ts >= current:
                    break
                missing_by_hour[int(estimated_ts.hour)] += 1
                missing_by_date_hour[(estimated_ts.date().isoformat(), int(estimated_ts.hour))] += 1
        previous = current

    hours = []
    total_actual = 0
    total_missing = 0
    for hour in range(24):
        actual = int(actual_by_hour.get(hour, 0))
        missing = int(missing_by_hour.get(hour, 0))
        expected = actual + missing
        total_actual += actual
        total_missing += missing
        completeness = (actual / expected * 100.0) if expected else None
        hours.append({
            "hour_utc": hour,
            "actual_intervals": actual,
            "estimated_missing_intervals": missing,
            "expected_intervals": expected,
            "completeness_pct": finite_float(completeness),
        })

    worst_hours = sorted(
        [hour for hour in hours if int(hour["expected_intervals"] or 0) > 0],
        key=lambda row: (
            float(row["completeness_pct"] if row["completeness_pct"] is not None else 100.0),
            -int(row["estimated_missing_intervals"] or 0),
            int(row["hour_utc"] or 0),
        ),
    )[:4]
    expected_total = total_actual + total_missing
    completeness_total = (total_actual / expected_total * 100.0) if expected_total else None
    symbol = infer_symbol(path, df)
    date_hour_rows = []
    for key in sorted(set(actual_by_date_hour) | set(missing_by_date_hour)):
        day, hour = key
        actual = int(actual_by_date_hour.get(key, 0))
        missing = int(missing_by_date_hour.get(key, 0))
        expected = actual + missing
        if expected <= 0:
            continue
        completeness = (actual / expected * 100.0) if expected else None
        date_hour_rows.append({
            "date_utc": day,
            "hour_utc": hour,
            "actual_intervals": actual,
            "estimated_missing_intervals": missing,
            "expected_intervals": expected,
            "completeness_pct": finite_float(completeness),
        })
    worst_date_hours = sorted(
        [row for row in date_hour_rows if int(row.get("estimated_missing_intervals") or 0) > 0],
        key=lambda row: (
            float(row["completeness_pct"] if row.get("completeness_pct") is not None else 100.0),
            -int(row.get("estimated_missing_intervals") or 0),
            str(row.get("date_utc") or ""),
            int(row.get("hour_utc") or 0),
        ),
    )[:12]
    asset_class = infer_asset_class(path, symbol)
    return {
        "path": display_path(path),
        "root": display_path(root),
        "symbol": symbol,
        "asset_class": asset_class,
        "source": infer_data_source(path),
        "bar_size": infer_bar_size(path, df),
        "storage_session": infer_storage_session(path, df, asset_class),
        "format": fmt,
        "rows": int(len(df)),
        "first_timestamp": ordered.iloc[0].isoformat(),
        "last_timestamp": ordered.iloc[-1].isoformat(),
        "median_interval_seconds": median_interval,
        "actual_intervals": total_actual,
        "expected_intervals": expected_total,
        "estimated_missing_intervals": total_missing,
        "completeness_pct": finite_float(completeness_total),
        "hours": hours,
        "worst_hours": worst_hours,
        "worst_date_hours": worst_date_hours,
    }


def build_data_minute_heatmap(
    data_roots: list[Path],
    *,
    catalog_limit: int = 200,
    top_limit: int = 20,
) -> dict[str, Any]:
    if top_limit < 1 or top_limit > 100:
        raise ValueError("top_limit must be between 1 and 100")
    rows = []
    errors = []
    for path in data_file_candidates(data_roots, limit=catalog_limit):
        root = next((candidate for candidate in data_roots if path.is_relative_to(candidate)), path.parent)
        try:
            rows.append(interval_heatmap_for_data_file(path, root=root))
        except Exception as exc:
            errors.append({"path": display_path(path), "error": str(exc)})

    rows.sort(key=lambda row: (
        float(row["completeness_pct"] if row.get("completeness_pct") is not None else 100.0),
        -int(row.get("estimated_missing_intervals") or 0),
        str(row.get("symbol") or ""),
    ))
    total_expected = sum(int(row.get("expected_intervals") or 0) for row in rows)
    total_missing = sum(int(row.get("estimated_missing_intervals") or 0) for row in rows)
    completeness = ((total_expected - total_missing) / total_expected * 100.0) if total_expected else None
    date_hour_rows = []
    for row in rows:
        for item in row.get("worst_date_hours") or []:
            date_hour_rows.append({
                "symbol": row.get("symbol"),
                "asset_class": row.get("asset_class"),
                "source": row.get("source"),
                "bar_size": row.get("bar_size"),
                "storage_session": row.get("storage_session"),
                "path": row.get("path"),
                **item,
            })
    date_hour_rows.sort(key=lambda row: (
        float(row["completeness_pct"] if row.get("completeness_pct") is not None else 100.0),
        -int(row.get("estimated_missing_intervals") or 0),
        str(row.get("symbol") or ""),
        str(row.get("date_utc") or ""),
        int(row.get("hour_utc") or 0),
    ))
    warnings = []
    if total_missing:
        warnings.append(f"{total_missing} estimated missing intraday intervals")
    if errors:
        warnings.append(f"{len(errors)} files failed interval heatmap parsing")
    status = "bad" if errors and not rows else "warn" if warnings else "ok"
    return {
        "generated_at": utc_now(),
        "status": status,
        "warnings": warnings,
        "warning_count": len(warnings),
        "roots": [display_path(root) for root in data_roots],
        "catalog_limit": catalog_limit,
        "top_limit": top_limit,
        "dataset_count": len(rows),
        "error_count": len(errors),
        "total_expected_intervals": total_expected,
        "total_estimated_missing_intervals": total_missing,
        "overall_completeness_pct": finite_float(completeness),
        "rows": rows[:top_limit],
        "date_hour_rows": date_hour_rows[:top_limit],
        "errors": errors[:top_limit],
    }


def fetch_manifest_symbol_rows(symbol: str, fetch_manifest_roots: list[Path], *, limit: int = 50) -> list[dict[str, Any]]:
    rows = []
    wanted = normalize_symbol(symbol)
    for path, _root in fetch_manifest_candidates(fetch_manifest_roots)[:limit]:
        try:
            payload = read_fetch_manifest(path)
        except Exception:
            continue
        job_id = payload.get("job_id") or path.stem
        for output in payload.get("outputs") or []:
            if not isinstance(output, dict) or normalize_symbol(str(output.get("symbol") or "")) != wanted:
                continue
            rows.append({
                "job_id": job_id,
                "type": "output",
                "status": output.get("status"),
                "rows": output.get("rows"),
                "path": output.get("path"),
                "day": output.get("day"),
                "timestamp": output.get("timestamp"),
            })
        for error_row in payload.get("errors") or []:
            if not isinstance(error_row, dict) or normalize_symbol(str(error_row.get("symbol") or "")) != wanted:
                continue
            rows.append({
                "job_id": job_id,
                "type": "error",
                "kind": error_row.get("kind"),
                "message": error_row.get("message"),
                "day": error_row.get("day"),
                "timestamp": error_row.get("timestamp"),
            })
    return rows[:limit]


def build_data_symbol_diagnostic(
    symbol: str,
    *,
    data_roots: list[Path],
    fetch_manifest_roots: list[Path],
    catalog_limit: int = 200,
) -> dict[str, Any]:
    cleaned = symbol.strip().upper()
    if not cleaned:
        raise ValueError("symbol is required")
    if not re.match(r"^[A-Z0-9][A-Z0-9.-]{0,31}$", cleaned):
        raise ValueError("symbol must look like a ticker, e.g. SPY or BTC-USD")
    catalog = build_data_catalog(data_roots, limit=catalog_limit, preview_points=2)
    wanted = normalize_symbol(cleaned)
    catalog_matches = [
        row for row in catalog["datasets"]
        if normalize_symbol(str(row.get("symbol") or "")) == wanted
    ]
    catalog_scope_paths = {
        display_path(path)
        for path in data_file_candidates(data_roots, limit=catalog_limit)
    }

    configured_candidates = [
        {
            "path": row.get("path"),
            "root": row.get("root"),
            "in_catalog_scope": True,
            "symbol": row.get("symbol"),
            "quality_status": row.get("quality_status"),
            "rows": row.get("rows"),
            "bar_size": row.get("bar_size"),
            "first_timestamp": row.get("first_timestamp"),
            "last_timestamp": row.get("last_timestamp"),
        }
        for row in catalog_matches
    ]
    parse_errors = []
    limit_blocked = []
    if not catalog_matches:
        for path, root in matching_symbol_files(data_roots, cleaned, limit=50, max_scanned_files=5000):
            row = {
                "path": display_path(path),
                "root": display_path(root),
                "in_catalog_scope": display_path(path) in catalog_scope_paths,
            }
            try:
                summary = summarize_data_file(path, root=root, preview_points=2)
                row.update({
                    "symbol": summary.get("symbol"),
                    "quality_status": summary.get("quality_status"),
                    "rows": summary.get("rows"),
                    "bar_size": summary.get("bar_size"),
                    "first_timestamp": summary.get("first_timestamp"),
                    "last_timestamp": summary.get("last_timestamp"),
                })
                if normalize_symbol(str(summary.get("symbol") or "")) == wanted and not row["in_catalog_scope"]:
                    limit_blocked.append(row)
            except Exception as exc:
                row["error"] = str(exc)
                parse_errors.append(row)
            configured_candidates.append(row)

    configured_resolved = [row for row in configured_candidates if normalize_symbol(str(row.get("symbol") or "")) == wanted]
    suggested_roots = [
        root.resolve()
        for root in SUGGESTED_DATA_ROOTS
        if root.resolve() not in {candidate.resolve() for candidate in data_roots}
    ]
    unconfigured_matches = [
        {
            "path": display_path(path),
            "root": display_path(root),
        }
        for path, root in matching_symbol_files(suggested_roots, cleaned, limit=50, max_scanned_files=5000)
    ]
    fetch_rows = fetch_manifest_symbol_rows(cleaned, fetch_manifest_roots)
    if catalog_matches:
        status = "visible"
        message = f"{cleaned} is visible in the current catalog."
        action = "Use Search or Inspect in Data Library."
    elif limit_blocked:
        status = "catalog_limited"
        message = f"{cleaned} exists under configured roots but is outside the current catalog limit."
        action = "Increase Rows to scan or narrow roots."
    elif configured_resolved:
        status = "parse_or_quality_issue"
        message = f"{cleaned} has configured candidate files but was not returned as a visible catalog row."
        action = "Inspect parser errors, quality warnings, and catalog limit."
    elif parse_errors:
        status = "parse_error"
        message = f"{cleaned} has matching configured files, but parsing failed."
        action = "Fix the file format, timestamp column, or close/last column."
    elif unconfigured_matches:
        status = "not_configured"
        message = f"{cleaned} appears under a local root that is not configured."
        action = "Add that root to dashboard.data_roots or start the server with --data-root."
    elif any(row.get("type") == "error" for row in fetch_rows):
        status = "fetch_failed_or_empty"
        message = f"{cleaned} appears in fetch manifests but no visible saved file was found."
        action = "Open Fetch Jobs to review no-data, permission, or request errors."
    else:
        status = "not_found"
        message = f"No configured or suggested saved-data file was found for {cleaned}."
        action = "Fetch the symbol or add the directory containing it to dashboard.data_roots."
    return {
        "generated_at": utc_now(),
        "symbol": cleaned,
        "status": status,
        "message": message,
        "action": action,
        "catalog_limit": catalog_limit,
        "catalog_matches": catalog_matches,
        "configured_candidates": configured_candidates,
        "unconfigured_matches": unconfigured_matches,
        "fetch_manifest_rows": fetch_rows,
        "root_summary": {
            "configured": [data_root_row(root) for root in data_roots],
            "suggested": [
                data_root_row(root)
                for root in suggested_roots
                if root.exists() and root.is_dir() and data_file_count(root)
            ],
        },
    }


def fetch_manifest_root_row(root: Path) -> dict[str, Any]:
    row = writable_probe(root, expect_dir=True)
    row["display_path"] = root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root)
    row["manifest_count"] = fetch_manifest_count(root)
    return row


def fetch_manifest_count(root: Path, *, limit: int = 10_000) -> int:
    if not root.exists() or not root.is_dir():
        return 0
    count = 0
    for path in root.rglob("*.json"):
        if path.is_file():
            count += 1
            if count >= limit:
                break
    return count


def fetch_manifest_candidates(fetch_manifest_roots: list[Path]) -> list[tuple[Path, Path]]:
    files: list[tuple[Path, Path]] = []
    for root in fetch_manifest_roots:
        if not root.exists() or not root.is_dir():
            continue
        for path in root.rglob("*.json"):
            if path.is_file():
                files.append((path, root))
    return sorted(files, key=lambda item: item[0].stat().st_mtime, reverse=True)


def read_fetch_manifest(path: Path) -> dict[str, Any]:
    with path.open() as f:
        payload = json.load(f)
    if not isinstance(payload, dict):
        raise ValueError("fetch manifest must be a JSON object")
    return payload


def summarize_fetch_manifest(path: Path, *, root: Path) -> dict[str, Any]:
    payload = read_fetch_manifest(path)
    stat = path.stat()
    counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
    plan = payload.get("plan") if isinstance(payload.get("plan"), dict) else {}
    parameters = payload.get("parameters") if isinstance(payload.get("parameters"), dict) else {}
    outputs = payload.get("outputs") if isinstance(payload.get("outputs"), list) else []
    errors = payload.get("errors") if isinstance(payload.get("errors"), list) else []
    symbols = payload.get("symbols_requested") if isinstance(payload.get("symbols_requested"), list) else []
    output_paths = [
        str(row.get("path"))
        for row in outputs
        if isinstance(row, dict) and row.get("path")
    ]
    first_output = outputs[0] if outputs and isinstance(outputs[0], dict) else {}
    latest_output = outputs[-1] if outputs and isinstance(outputs[-1], dict) else {}
    return {
        "job_id": payload.get("job_id") or path.stem,
        "path": display_path(path),
        "root": display_path(root),
        "kind": payload.get("kind"),
        "status": payload.get("status"),
        "started_at": payload.get("started_at"),
        "finished_at": payload.get("finished_at"),
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "size_bytes": stat.st_size,
        "symbols_requested": counts.get("requested_symbols", len(symbols)),
        "tracked_symbols": counts.get("tracked_symbols"),
        "success_symbols": counts.get("success_symbols"),
        "failed_symbols": counts.get("failed_symbols"),
        "partial_symbols": counts.get("partial_symbols"),
        "empty_symbols": counts.get("empty_symbols"),
        "skipped_symbols": counts.get("skipped_symbols"),
        "outputs": counts.get("outputs", len(outputs)),
        "errors": counts.get("errors", len(errors)),
        "rows": counts.get("rows"),
        "success_chunks": counts.get("success_chunks"),
        "empty_chunks": counts.get("empty_chunks"),
        "failed_chunks": counts.get("failed_chunks"),
        "retry_events": counts.get("retry_events"),
        "pacing_wait_events": counts.get("pacing_wait_events"),
        "pacing_wait_seconds": counts.get("pacing_wait_seconds"),
        "avg_output_elapsed_seconds": counts.get("avg_output_elapsed_seconds"),
        "latest_completed_chunks": counts.get("latest_completed_chunks"),
        "latest_remaining_chunks": counts.get("latest_remaining_chunks"),
        "latest_completed_symbols": counts.get("latest_completed_symbols"),
        "latest_remaining_symbols": counts.get("latest_remaining_symbols"),
        "latest_total_symbols": counts.get("latest_total_symbols"),
        "latest_eta_seconds": counts.get("latest_eta_seconds"),
        "latest_avg_chunk_seconds": counts.get("latest_avg_chunk_seconds"),
        "latest_avg_symbol_seconds": counts.get("latest_avg_symbol_seconds"),
        "error_kind_counts": counts.get("error_kind_counts") or {},
        "status_counts": counts.get("status_counts") or {},
        "output_status_counts": counts.get("output_status_counts") or {},
        "bar_size": parameters.get("bar_size"),
        "duration": parameters.get("duration"),
        "months": parameters.get("months"),
        "exchange": parameters.get("exchange"),
        "out_dir": parameters.get("out_dir"),
        "pending_chunks": plan.get("pending_chunks"),
        "skipped_existing_chunks": plan.get("skipped_existing_chunks"),
        "range_start": plan.get("range_start") or parameters.get("start"),
        "range_end": plan.get("range_end") or parameters.get("end"),
        "first_output_path": first_output.get("path"),
        "latest_output_path": latest_output.get("path"),
        "output_path_sample": output_paths[:5],
    }


def build_fetch_manifests(
    fetch_manifest_roots: list[Path],
    *,
    limit: int = 50,
) -> dict[str, Any]:
    manifests = []
    errors = []
    candidates = fetch_manifest_candidates(fetch_manifest_roots)
    for path, root in candidates[:limit]:
        try:
            manifests.append(summarize_fetch_manifest(path, root=root))
        except Exception as exc:
            errors.append({"path": display_path(path), "error": str(exc)})
    return {
        "generated_at": utc_now(),
        "roots": [fetch_manifest_root_row(root) for root in fetch_manifest_roots],
        "manifests": manifests,
        "count": len(manifests),
        "total": len(candidates),
        "limit": limit,
        "errors": errors,
        "error_count": len(errors),
        "status_counts": count_values(manifests, "status"),
        "kind_counts": count_values(manifests, "kind"),
    }


def build_fetch_manifests_csv(fetch_manifest_roots: list[Path], *, limit: int = 200) -> str:
    payload = build_fetch_manifests(fetch_manifest_roots, limit=limit)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=FETCH_MANIFEST_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in payload.get("manifests", []):
        writer.writerow({field: compact_csv_value(row.get(field)) for field in FETCH_MANIFEST_EXPORT_FIELDS})
    return out.getvalue()


def build_fetch_manifest_detail_csv(
    job_id: str,
    *,
    fetch_manifest_roots: list[Path],
    data_roots: list[Path],
    limit: int = 2000,
) -> str:
    detail = load_fetch_manifest_detail(
        job_id,
        fetch_manifest_roots=fetch_manifest_roots,
        data_roots=data_roots,
        limit=limit,
    )
    base = {
        "job_id": detail.get("job_id"),
        "kind": detail.get("kind"),
        "status": detail.get("status"),
    }
    rows: list[dict[str, Any]] = []
    for item in detail.get("symbols") or []:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                **base,
                "row_type": "symbol",
                "symbol": item.get("symbol"),
                "symbol_status": item.get("status"),
                "bars": item.get("bars"),
                "chunks_completed": item.get("chunks_completed"),
                "chunks_failed": item.get("chunks_failed"),
                "chunks_skipped": item.get("chunks_skipped"),
                "first_timestamp": item.get("first_timestamp"),
                "last_timestamp": item.get("last_timestamp"),
                "message": item.get("message"),
            }
        )
    for item in detail.get("outputs") or []:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                **base,
                "row_type": "output",
                "symbol": item.get("symbol"),
                "symbol_status": item.get("status"),
                "timestamp": item.get("timestamp"),
                "day": item.get("day"),
                "rows": item.get("rows"),
                "first_timestamp": item.get("first_timestamp"),
                "last_timestamp": item.get("last_timestamp"),
                "path": item.get("path"),
                "data_detail_path": item.get("data_detail_path"),
                "data_detail_available": item.get("data_detail_available"),
                "data_detail_status": item.get("data_detail_status"),
                "data_detail_reason": item.get("data_detail_reason"),
                "elapsed_seconds": item.get("elapsed_seconds"),
                "attempt_count": item.get("attempt_count"),
                "message": item.get("message"),
            }
        )
    for item in detail.get("errors") or []:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                **base,
                "row_type": "error",
                "symbol": item.get("symbol"),
                "timestamp": item.get("timestamp"),
                "day": item.get("day"),
                "error_kind": item.get("kind"),
                "attempt_count": item.get("attempt_count"),
                "message": item.get("message"),
            }
        )
    for item in detail.get("events") or []:
        if not isinstance(item, dict):
            continue
        rows.append(
            {
                **base,
                "row_type": "event",
                "symbol": item.get("symbol"),
                "timestamp": item.get("timestamp"),
                "day": item.get("day"),
                "event_type": item.get("type"),
                "attempt": item.get("attempt"),
                "max_retries": item.get("max_retries"),
                "delay_seconds": item.get("delay_seconds"),
                "seconds": item.get("seconds"),
                "reason": item.get("reason"),
                "message": item.get("message"),
            }
        )

    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=FETCH_MANIFEST_DETAIL_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: compact_csv_value(row.get(field)) for field in FETCH_MANIFEST_DETAIL_EXPORT_FIELDS})
    return out.getvalue()


def find_fetch_manifest_path(job_id: str, fetch_manifest_roots: list[Path]) -> Path:
    raw = job_id.strip()
    if not raw:
        raise ValueError("job_id is required")
    safe = slugify(raw)
    for path, _root in fetch_manifest_candidates(fetch_manifest_roots):
        if path.stem == safe or path.stem == raw:
            return path
        try:
            payload = read_fetch_manifest(path)
        except Exception:
            continue
        if str(payload.get("job_id") or "") == raw:
            return path
    raise ValueError(f"fetch manifest not found: {raw}")


def annotate_fetch_output(row: dict[str, Any], data_roots: list[Path]) -> dict[str, Any]:
    out = dict(row)
    out["data_detail_path"] = None
    out["data_detail_available"] = False
    out["data_detail_status"] = "no_path"
    out["data_detail_reason"] = "output row has no path"
    raw_path = str(row.get("path") or "").strip()
    if not raw_path:
        return out
    candidate = Path(raw_path)
    path = candidate if candidate.is_absolute() else ROOT / candidate
    path = path.resolve()
    if path.suffix.lower() not in DATA_FILE_SUFFIXES:
        out["data_detail_status"] = "unsupported_file"
        out["data_detail_reason"] = "output path is not a supported CSV/parquet data file"
        return out
    resolved_roots = [root.resolve() for root in data_roots]
    if not any(path.is_relative_to(root) for root in resolved_roots):
        out["data_detail_status"] = "outside_data_roots"
        out["data_detail_reason"] = "data file must be inside a configured data root"
        return out
    rel_path = path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)
    out["data_detail_path"] = rel_path
    if path.exists():
        out["data_detail_available"] = True
        out["data_detail_status"] = "visible"
        out["data_detail_reason"] = "visible in configured data roots"
    else:
        out["data_detail_status"] = "missing_file"
        out["data_detail_reason"] = "path is under a configured data root but the file is missing"
    return out


def load_fetch_manifest_detail(
    job_id: str,
    *,
    fetch_manifest_roots: list[Path],
    data_roots: list[Path] | None = None,
    limit: int = 250,
) -> dict[str, Any]:
    path = find_fetch_manifest_path(job_id, fetch_manifest_roots)
    root = next((candidate for candidate in fetch_manifest_roots if path.is_relative_to(candidate)), path.parent)
    payload = read_fetch_manifest(path)
    outputs = payload.get("outputs") if isinstance(payload.get("outputs"), list) else []
    errors = payload.get("errors") if isinstance(payload.get("errors"), list) else []
    events = payload.get("events") if isinstance(payload.get("events"), list) else []
    symbols_map = payload.get("symbols") if isinstance(payload.get("symbols"), dict) else {}
    symbols = list(symbols_map.values())
    summary = summarize_fetch_manifest(path, root=root)
    annotated_all_outputs = [
        annotate_fetch_output(row, data_roots or [])
        for row in outputs
        if isinstance(row, dict)
    ]
    output_visibility_counts = count_values(annotated_all_outputs, "data_detail_status")
    annotated_outputs = annotated_all_outputs[-limit:]
    return {
        **summary,
        "schema_version": payload.get("schema_version"),
        "parameters": payload.get("parameters") if isinstance(payload.get("parameters"), dict) else {},
        "plan": payload.get("plan") if isinstance(payload.get("plan"), dict) else {},
        "counts": payload.get("counts") if isinstance(payload.get("counts"), dict) else {},
        "symbols_requested": payload.get("symbols_requested") if isinstance(payload.get("symbols_requested"), list) else [],
        "symbols": symbols,
        "outputs": annotated_outputs,
        "output_visibility_counts": output_visibility_counts,
        "output_visible_count": int(output_visibility_counts.get("visible") or 0),
        "output_missing_file_count": int(output_visibility_counts.get("missing_file") or 0),
        "output_outside_data_roots_count": int(output_visibility_counts.get("outside_data_roots") or 0),
        "output_no_path_count": int(output_visibility_counts.get("no_path") or 0),
        "output_unsupported_file_count": int(output_visibility_counts.get("unsupported_file") or 0),
        "errors": errors[-limit:],
        "events": events[-limit:],
        "output_total": len(outputs),
        "error_total": len(errors),
        "event_total": len(events),
        "limit": limit,
    }


def slugify(value: str) -> str:
    slug = re.sub(r"[^A-Za-z0-9_.-]+", "_", value.strip()).strip("._-")
    return slug[:80] or "workbench_config"


def normalize_config_plugin(row: dict[str, Any], *, source: str, source_path: str | None = None) -> dict[str, Any]:
    plugin_id = str(row.get("id") or "").strip()
    spec = str(row.get("spec") or row.get("strategy_plugin") or "").strip()
    if not plugin_id:
        raise ValueError("plugin id is required")
    if not spec or ":" not in spec:
        raise ValueError(f"plugin {plugin_id} must define spec as module:function")
    visibility = str(row.get("visibility") or ("public_example" if source == "builtin" else "private_local")).strip()
    status = str(row.get("status") or ("example_only" if source == "builtin" else "private_local")).strip()
    label = str(row.get("label") or plugin_id).strip()
    description = str(row.get("description") or "").strip()
    boundary = str(row.get("boundary") or "").strip()
    if not boundary:
        boundary = (
            "Public example plugin; not a viable trading strategy."
            if source == "builtin"
            else "Loaded from an ignored local plugin registry; keep strategy logic and tuned configs private."
        )
    plugin: dict[str, Any] = {
        "id": plugin_id,
        "label": label,
        "spec": spec,
        "status": status,
        "visibility": visibility,
        "description": description,
        "boundary": boundary,
        "strategy_fields": normalize_plugin_strategy_fields(row.get("strategy_fields"), plugin_id=plugin_id),
        "source": source,
    }
    if source_path:
        plugin["source_path"] = source_path
    return plugin


def normalize_plugin_strategy_fields(raw_fields: Any, *, plugin_id: str) -> list[dict[str, Any]]:
    if raw_fields is None:
        return []
    if not isinstance(raw_fields, list):
        raise ValueError(f"plugin {plugin_id} strategy_fields must be a list")
    normalized = []
    seen: set[str] = set()
    for idx, raw in enumerate(raw_fields, start=1):
        if not isinstance(raw, dict):
            raise ValueError(f"plugin {plugin_id} strategy_fields[{idx}] must be a mapping")
        name = str(raw.get("name") or "").strip()
        if not name or not re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", name):
            raise ValueError(f"plugin {plugin_id} strategy_fields[{idx}].name must be a safe identifier")
        if name in seen:
            raise ValueError(f"plugin {plugin_id} strategy_fields contains duplicate field {name}")
        seen.add(name)
        kind = str(raw.get("kind") or "text").strip().lower()
        if kind not in PLUGIN_STRATEGY_FIELD_KINDS:
            raise ValueError(
                f"plugin {plugin_id} strategy_fields[{name}].kind must be one of {sorted(PLUGIN_STRATEGY_FIELD_KINDS)}"
            )
        field = {
            "id": f"config-plugin-field-{slugify(plugin_id)}-{name}".replace("_", "-"),
            "name": name,
            "label": str(raw.get("label") or name.replace("_", " ").title()).strip(),
            "kind": kind,
            "section": "plugin_strategy",
            "plugin_id": plugin_id,
            "help": str(raw.get("help") or "").strip(),
        }
        for key in ("default", "min", "max", "step"):
            if key in raw:
                field[key] = raw[key]
        if raw.get("wide") is not None:
            field["wide"] = bool(raw["wide"])
        if raw.get("options") is not None:
            options = raw["options"]
            if not isinstance(options, list) or not options:
                raise ValueError(f"plugin {plugin_id} strategy_fields[{name}].options must be a non-empty list")
            field["options"] = options
        normalized.append(field)
    return normalized


def load_config_builder_plugins(plugin_registry_paths: list[Path] | None = None) -> list[dict[str, Any]]:
    plugins = [normalize_config_plugin(plugin, source="builtin") for plugin in CONFIG_BUILDER_PLUGINS]
    seen = {plugin["id"] for plugin in plugins}
    for path in parse_plugin_registry_paths(plugin_registry_paths):
        if not path.exists():
            continue
        payload = read_optional_yaml_mapping(path)
        rows = payload.get("plugins") if isinstance(payload.get("plugins"), list) else []
        for row in rows:
            if not isinstance(row, dict):
                raise ValueError(f"plugin registry row in {path} must be a mapping")
            if row.get("enabled") is False:
                continue
            plugin = normalize_config_plugin(row, source="local_registry", source_path=str(path))
            if plugin["id"] in seen:
                raise ValueError(f"duplicate plugin id in plugin registry: {plugin['id']}")
            seen.add(plugin["id"])
            plugins.append(plugin)
    return plugins


def config_plugin_by_id(plugin_id: str, plugins: list[dict[str, Any]]) -> dict[str, Any] | None:
    return next((plugin for plugin in plugins if plugin["id"] == plugin_id), None)


def data_path_allowed(raw_path: str, data_roots: list[Path]) -> tuple[Path, str]:
    candidate = Path(raw_path)
    path = candidate if candidate.is_absolute() else ROOT / candidate
    path = path.resolve()
    if path.suffix.lower() not in DATA_FILE_SUFFIXES:
        raise ValueError("data file must be .csv or .parquet")
    if not path.exists():
        raise ValueError(f"data file does not exist: {raw_path}")
    if not any(path.is_relative_to(root) for root in data_roots):
        raise ValueError("data file must be inside a configured data root")
    return path, path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path)


def selected_data_files(
    datasets: Any,
    data_roots: list[Path],
) -> dict[str, tuple[Path, str]]:
    if not isinstance(datasets, list) or not datasets:
        raise ValueError("datasets must be a non-empty list")
    if len(datasets) > MAX_CONFIG_DRAFT_DATASETS:
        raise ValueError(f"datasets cannot exceed {MAX_CONFIG_DRAFT_DATASETS}")
    selected: dict[str, tuple[Path, str]] = {}
    seen_paths: set[str] = set()
    for item in datasets:
        if not isinstance(item, dict):
            raise ValueError("each dataset must be a mapping")
        symbol = str(item.get("symbol") or "").strip().upper()
        raw_path = str(item.get("path") or "").strip()
        if not symbol:
            raise ValueError("dataset symbol is required")
        if not raw_path:
            raise ValueError("dataset path is required")
        path, rel_path = data_path_allowed(raw_path, data_roots)
        if symbol in selected:
            raise ValueError(f"duplicate dataset symbol: {symbol}")
        if rel_path in seen_paths:
            raise ValueError(f"duplicate dataset path: {rel_path}")
        seen_paths.add(rel_path)
        selected[symbol] = (path, rel_path)
    if not selected:
        raise ValueError("at least one dataset is required")
    return selected


def read_data_file(path: Path) -> tuple[pd.DataFrame, str]:
    suffix = path.suffix.lower()
    if suffix == ".csv":
        return pd.read_csv(path), "csv"
    if suffix == ".parquet":
        return pd.read_parquet(path), "parquet"
    raise ValueError(f"unsupported data file type: {path.suffix}")


def column_named(df: pd.DataFrame, name: str) -> str | None:
    lower_map = {str(col).lower(): str(col) for col in df.columns}
    return lower_map.get(name.lower())


def finite_float(raw: Any) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def numeric_stats(series: pd.Series) -> dict[str, Any]:
    numeric = pd.to_numeric(series, errors="coerce")
    valid = numeric.dropna()
    return {
        "count": int(valid.count()),
        "missing": int(numeric.isna().sum()),
        "min": finite_float(valid.min()) if not valid.empty else None,
        "max": finite_float(valid.max()) if not valid.empty else None,
        "mean": finite_float(valid.mean()) if not valid.empty else None,
        "median": finite_float(valid.median()) if not valid.empty else None,
        "std": finite_float(valid.std()) if len(valid) > 1 else None,
    }


def pct(value: float | None) -> float | None:
    return finite_float(value * 100.0) if value is not None else None


def timestamp_summary_for_file(
    symbol: str,
    path: Path,
    *,
    start_ts: pd.Timestamp | None = None,
    end_ts: pd.Timestamp | None = None,
) -> dict[str, Any]:
    df, fmt = read_data_file(path)
    data_summary = summarize_data_file(path, root=path.parent.resolve(), preview_points=2)
    ts_col = timestamp_column(df)
    raw_ts = df[ts_col] if ts_col else (df.index if isinstance(df.index, pd.DatetimeIndex) else None)
    parsed = pd.Series([], dtype="datetime64[ns, UTC]")
    if raw_ts is not None:
        parsed = pd.Series(parse_datetime_utc(raw_ts))
    valid_all = parsed.dropna().drop_duplicates().sort_values()
    valid = valid_all
    if start_ts is not None:
        valid = valid[valid >= start_ts]
    if end_ts is not None:
        valid = valid[valid <= end_ts]
    diffs = valid.diff().dropna().dt.total_seconds() if len(valid) > 1 else pd.Series([], dtype="float64")
    return {
        "symbol": symbol,
        "path": path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path),
        "format": fmt,
        "rows": int(len(df)),
        "timestamp_column": ts_col,
        "timestamp_count": int(len(valid)),
        "total_timestamp_count": int(len(valid_all)),
        "timestamp_parse_failures": int(parsed.isna().sum()) if raw_ts is not None else None,
        "filter_start": start_ts.isoformat() if start_ts is not None else None,
        "filter_end": end_ts.isoformat() if end_ts is not None else None,
        "first_timestamp": valid.iloc[0].isoformat() if not valid.empty else None,
        "last_timestamp": valid.iloc[-1].isoformat() if not valid.empty else None,
        "median_interval_seconds": finite_float(diffs.median()) if not diffs.empty else None,
        "quality_status": data_summary.get("quality_status"),
        "quality_warnings": data_summary.get("quality_warnings") or [],
        "quality_warning_count": data_summary.get("quality_warning_count", 0),
        "_timestamps": valid,
    }


def build_data_alignment_for_files(
    selected: dict[str, tuple[Path, str]],
    *,
    start_ts: pd.Timestamp | None = None,
    end_ts: pd.Timestamp | None = None,
) -> dict[str, Any]:
    rows = []
    warnings = []
    timestamp_sets = []
    union_values: set[pd.Timestamp] = set()
    for symbol, (path, _rel_path) in sorted(selected.items()):
        summary = timestamp_summary_for_file(symbol, path, start_ts=start_ts, end_ts=end_ts)
        timestamps = list(summary.pop("_timestamps"))
        if not summary["timestamp_column"]:
            warnings.append(f"{symbol}: no timestamp column found")
        if not timestamps:
            if start_ts is not None or end_ts is not None:
                warnings.append(f"{symbol}: no parseable timestamps in selected date range")
            else:
                warnings.append(f"{symbol}: no parseable timestamps")
        elif summary["timestamp_parse_failures"]:
            warnings.append(f"{symbol}: {summary['timestamp_parse_failures']} timestamp parse failures")
        if summary.get("quality_status") in {"warn", "bad"}:
            quality_items = summary.get("quality_warnings") or []
            warnings.append(f"{symbol}: data quality {summary.get('quality_status')} - {'; '.join(quality_items) or 'review file'}")
        timestamp_set = set(timestamps)
        timestamp_sets.append(timestamp_set)
        union_values.update(timestamp_set)
        rows.append(summary)

    common_values = set.intersection(*timestamp_sets) if timestamp_sets and all(timestamp_sets) else set()
    timestamp_counts = [int(row["timestamp_count"]) for row in rows if int(row["timestamp_count"]) > 0]
    interval_values = [
        float(row["median_interval_seconds"])
        for row in rows
        if row.get("median_interval_seconds") is not None and float(row["median_interval_seconds"]) > 0
    ]
    if len(interval_values) > 1 and max(interval_values) / min(interval_values) > 1.05:
        warnings.append("selected datasets have different median bar intervals")
    if len(rows) > 1 and timestamp_counts:
        min_count = min(timestamp_counts)
        if not common_values:
            warnings.append("selected datasets have no common timestamps")
        elif len(common_values) < min_count:
            warnings.append("selected datasets have partial timestamp overlap")

    common_sorted = sorted(common_values)
    common_count = len(common_sorted)
    min_timestamp_count = min(timestamp_counts) if timestamp_counts else 0
    coverage_pct = (
        (float(common_count) / float(min_timestamp_count)) * 100.0
        if min_timestamp_count
        else None
    )
    return {
        "dataset_count": len(rows),
        "symbols": [row["symbol"] for row in rows],
        "rows": rows,
        "filter_start": start_ts.isoformat() if start_ts is not None else None,
        "filter_end": end_ts.isoformat() if end_ts is not None else None,
        "common_timestamp_count": common_count,
        "union_timestamp_count": len(union_values),
        "min_timestamp_count": min_timestamp_count,
        "common_coverage_pct": finite_float(coverage_pct),
        "common_first_timestamp": common_sorted[0].isoformat() if common_sorted else None,
        "common_last_timestamp": common_sorted[-1].isoformat() if common_sorted else None,
        "warnings": warnings,
        "warning_count": len(warnings),
        "aligned": bool(rows and common_count > 0 and not warnings),
    }


def parse_payload_date_range(payload: dict[str, Any]) -> tuple[str | None, str | None, pd.Timestamp | None, pd.Timestamp | None]:
    start_raw = str(payload.get("start") or "").strip() or None
    end_raw = str(payload.get("end") or "").strip() or None
    start_ts = parse_optional_utc_timestamp(start_raw)
    end_ts = parse_optional_utc_timestamp(end_raw, end_of_day=True)
    if start_ts is not None and end_ts is not None and start_ts > end_ts:
        raise ValueError("start must be before or equal to end")
    return start_raw, end_raw, start_ts, end_ts


def build_data_alignment(payload: dict[str, Any], *, data_roots: list[Path]) -> dict[str, Any]:
    selected = selected_data_files(payload.get("datasets") or [], data_roots)
    _start_raw, _end_raw, start_ts, end_ts = parse_payload_date_range(payload)
    return build_data_alignment_for_files(selected, start_ts=start_ts, end_ts=end_ts)


def build_data_compare(payload: dict[str, Any], *, data_roots: list[Path]) -> dict[str, Any]:
    datasets = payload.get("datasets") or []
    selected = selected_data_files(datasets, data_roots)
    if len(selected) < 2:
        raise ValueError("select at least two datasets to compare")
    if len(selected) > MAX_DATA_COMPARE_DATASETS:
        raise ValueError(f"comparison cannot exceed {MAX_DATA_COMPARE_DATASETS} datasets")
    try:
        preview_points = int(payload.get("preview_points") or 300)
    except (TypeError, ValueError) as exc:
        raise ValueError("preview_points must be an integer") from exc
    if preview_points < 2 or preview_points > MAX_DATA_DETAIL_POINTS:
        raise ValueError(f"preview_points must be between 2 and {MAX_DATA_DETAIL_POINTS}")
    sample_mode = str(payload.get("sample_mode") or "sampled").strip().lower()
    if sample_mode not in {"sampled", "full"}:
        raise ValueError("sample_mode must be sampled or full")
    start_ts = parse_optional_utc_timestamp(str(payload.get("start") or "").strip() or None)
    end_ts = parse_optional_utc_timestamp(str(payload.get("end") or "").strip() or None, end_of_day=True)
    if start_ts is not None and end_ts is not None and start_ts > end_ts:
        raise ValueError("start must be before end")

    series = []
    timestamp_sets = []
    union_values: set[pd.Timestamp] = set()
    warnings = []
    for symbol, (path, rel_path) in sorted(selected.items()):
        df, fmt = read_data_file(path)
        ts_col = timestamp_column(df)
        close_col = close_column(df)
        if not ts_col:
            raise ValueError(f"{symbol}: no timestamp column found")
        if not close_col:
            raise ValueError(f"{symbol}: no close/last column found")
        scoped = pd.DataFrame({
            "timestamp": parse_datetime_utc(df[ts_col]),
            "close": pd.to_numeric(df[close_col], errors="coerce"),
        }).dropna(subset=["timestamp", "close"]).sort_values("timestamp")
        available_rows = int(len(scoped))
        if start_ts is not None:
            scoped = scoped[scoped["timestamp"] >= start_ts]
        if end_ts is not None:
            scoped = scoped[scoped["timestamp"] <= end_ts]
        filtered_rows = int(len(scoped))
        if filtered_rows < 2:
            warnings.append(f"{symbol}: fewer than two rows in selected range")
        if sample_mode == "full" and filtered_rows > preview_points:
            raise ValueError(
                "full sample_mode requires every selected file to fit inside preview_points; "
                "narrow the date range, increase preview_points, or use sampled mode"
            )

        timestamp_set = set(scoped["timestamp"].drop_duplicates())
        timestamp_sets.append(timestamp_set)
        union_values.update(timestamp_set)
        first_close = finite_float(scoped.iloc[0]["close"]) if filtered_rows else None
        last_close = finite_float(scoped.iloc[-1]["close"]) if filtered_rows else None
        total_return = (
            (last_close / first_close - 1.0)
            if first_close is not None and first_close != 0 and last_close is not None
            else None
        )
        sample_indices = list(range(len(scoped))) if sample_mode == "full" else evenly_sample_indices(len(scoped), preview_points)
        points = []
        for idx in sample_indices:
            row = scoped.iloc[idx]
            close_value = finite_float(row["close"])
            normalized = (
                ((close_value / first_close) - 1.0) * 100.0
                if first_close is not None and first_close != 0 and close_value is not None
                else None
            )
            points.append({
                "timestamp": row["timestamp"].isoformat(),
                "close": close_value,
                "normalized_return_pct": finite_float(normalized),
            })
        series.append({
            "symbol": symbol,
            "path": rel_path,
            "format": fmt,
            "source": infer_data_source(path),
            "asset_class": infer_asset_class(path, symbol),
            "bar_size": infer_bar_size(path, df),
            "available_rows": available_rows,
            "filtered_rows": filtered_rows,
            "sampled_points": len(points),
            "sampled": bool(filtered_rows > len(points)),
            "first_timestamp": scoped.iloc[0]["timestamp"].isoformat() if filtered_rows else None,
            "last_timestamp": scoped.iloc[-1]["timestamp"].isoformat() if filtered_rows else None,
            "first_close": first_close,
            "last_close": last_close,
            "total_return_pct": pct(total_return),
            "points": points,
        })

    common_values = set.intersection(*timestamp_sets) if timestamp_sets and all(timestamp_sets) else set()
    common_sorted = sorted(common_values)
    return {
        "generated_at": utc_now(),
        "dataset_count": len(series),
        "sample_mode": sample_mode,
        "preview_points": preview_points,
        "requested_start": start_ts.isoformat() if start_ts is not None else None,
        "requested_end": end_ts.isoformat() if end_ts is not None else None,
        "series": series,
        "common_timestamp_count": len(common_values),
        "union_timestamp_count": len(union_values),
        "common_first_timestamp": common_sorted[0].isoformat() if common_sorted else None,
        "common_last_timestamp": common_sorted[-1].isoformat() if common_sorted else None,
        "warnings": warnings,
        "warning_count": len(warnings),
    }


def missing_interval_analysis(
    parsed_ts: pd.Series,
    *,
    gap_limit: int,
    missing_interval_limit: int | None,
) -> dict[str, Any]:
    parsed_valid = parsed_ts.dropna()
    ordered = parsed_valid.sort_values()
    diffs = ordered.diff().dropna().dt.total_seconds() if not ordered.empty else pd.Series([], dtype="float64")
    median_interval = finite_float(diffs.median()) if not diffs.empty else None
    largest_gap = finite_float(diffs.max()) if not diffs.empty else None
    gap_rows = []
    missing_interval_rows = []
    estimated_missing = 0
    if median_interval and median_interval > 0 and len(ordered) > 1:
        previous = ordered.iloc[0]
        expected_step = pd.Timedelta(seconds=float(median_interval))
        for current in ordered.iloc[1:]:
            gap_seconds = float((current - previous).total_seconds())
            if gap_seconds > median_interval * 1.5:
                missing = max(0, round(gap_seconds / median_interval) - 1)
                estimated_missing += missing
                gap_index = len(gap_rows)
                if len(gap_rows) < gap_limit:
                    gap_rows.append({
                        "from_timestamp": previous.isoformat(),
                        "to_timestamp": current.isoformat(),
                        "gap_seconds": finite_float(gap_seconds),
                        "estimated_missing_intervals": int(missing),
                    })
                expected_ts = previous + expected_step
                emitted_for_gap = 0
                while expected_ts < current and emitted_for_gap < missing:
                    if missing_interval_limit is None or len(missing_interval_rows) < missing_interval_limit:
                        missing_interval_rows.append({
                            "expected_timestamp": expected_ts.isoformat(),
                            "from_timestamp": previous.isoformat(),
                            "to_timestamp": current.isoformat(),
                            "gap_seconds": finite_float(gap_seconds),
                            "gap_index": gap_index,
                        })
                    expected_ts += expected_step
                    emitted_for_gap += 1
            previous = current
    missing_interval_omitted = (
        max(0, int(estimated_missing) - len(missing_interval_rows))
        if missing_interval_limit is not None
        else 0
    )
    return {
        "parsed_valid": parsed_valid,
        "ordered": ordered,
        "median_interval": median_interval,
        "largest_gap": largest_gap,
        "gap_rows": gap_rows,
        "missing_interval_rows": missing_interval_rows,
        "estimated_missing": int(estimated_missing),
        "missing_interval_omitted": int(missing_interval_omitted),
    }


def data_missing_intervals_csv(
    raw_path: str,
    *,
    data_roots: list[Path],
    max_rows: int = MAX_DATA_MISSING_INTERVAL_EXPORT_ROWS,
) -> tuple[str, str]:
    if max_rows < 1 or max_rows > MAX_DATA_MISSING_INTERVAL_EXPORT_ROWS:
        raise ValueError(f"max_rows must be between 1 and {MAX_DATA_MISSING_INTERVAL_EXPORT_ROWS}")
    path, rel_path = data_path_allowed(raw_path, data_roots)
    df, _fmt = read_data_file(path)
    ts_col = timestamp_column(df)
    raw_ts = df[ts_col] if ts_col else (df.index if isinstance(df.index, pd.DatetimeIndex) else None)
    if raw_ts is None:
        raise ValueError("data file has no timestamp column")
    analysis = missing_interval_analysis(
        pd.Series(parse_datetime_utc(raw_ts)),
        gap_limit=MAX_DATA_GAP_ROWS,
        missing_interval_limit=max_rows,
    )
    output = io.StringIO()
    writer = csv.DictWriter(
        output,
        fieldnames=[
            "path",
            "expected_timestamp",
            "from_timestamp",
            "to_timestamp",
            "gap_seconds",
            "gap_index",
            "estimated_missing_intervals",
            "omitted_by_export_cap",
        ],
    )
    writer.writeheader()
    omitted = int(analysis["missing_interval_omitted"])
    for row_item in analysis["missing_interval_rows"]:
        writer.writerow({
            "path": rel_path,
            "expected_timestamp": row_item.get("expected_timestamp"),
            "from_timestamp": row_item.get("from_timestamp"),
            "to_timestamp": row_item.get("to_timestamp"),
            "gap_seconds": row_item.get("gap_seconds"),
            "gap_index": row_item.get("gap_index"),
            "estimated_missing_intervals": analysis["estimated_missing"],
            "omitted_by_export_cap": omitted,
        })
    safe_name = re.sub(r"[^A-Za-z0-9_.-]+", "_", Path(rel_path).stem).strip("_") or "data"
    return output.getvalue(), f"{safe_name}_missing_intervals.csv"


def build_data_detail(
    raw_path: str,
    *,
    data_roots: list[Path],
    preview_points: int = 300,
    gap_limit: int = 20,
    missing_interval_limit: int = 100,
    start: str | None = None,
    end: str | None = None,
    sample_mode: str = "sampled",
) -> dict[str, Any]:
    if preview_points < 2 or preview_points > MAX_DATA_DETAIL_POINTS:
        raise ValueError(f"preview_points must be between 2 and {MAX_DATA_DETAIL_POINTS}")
    if gap_limit < 1 or gap_limit > MAX_DATA_GAP_ROWS:
        raise ValueError(f"gap_limit must be between 1 and {MAX_DATA_GAP_ROWS}")
    if missing_interval_limit < 1 or missing_interval_limit > MAX_DATA_MISSING_INTERVAL_ROWS:
        raise ValueError(f"missing_interval_limit must be between 1 and {MAX_DATA_MISSING_INTERVAL_ROWS}")
    sample_mode = str(sample_mode or "sampled").strip().lower()
    if sample_mode not in {"sampled", "full"}:
        raise ValueError("sample_mode must be sampled or full")
    start_ts = parse_optional_utc_timestamp(start)
    end_ts = parse_optional_utc_timestamp(end, end_of_day=True)
    if start_ts is not None and end_ts is not None and start_ts > end_ts:
        raise ValueError("start must be before end")

    path, rel_path = data_path_allowed(raw_path, data_roots)
    root = next((candidate for candidate in data_roots if path.is_relative_to(candidate)), path.parent)
    df, fmt = read_data_file(path)
    ts_col = timestamp_column(df)
    raw_ts = df[ts_col] if ts_col else (df.index if isinstance(df.index, pd.DatetimeIndex) else None)
    parsed_ts = pd.Series([], dtype="datetime64[ns, UTC]")
    source_tz = None
    if raw_ts is not None:
        source_tz = source_timezone_label(raw_ts)
        parsed_ts = pd.Series(parse_datetime_utc(raw_ts))

    analysis = missing_interval_analysis(
        parsed_ts,
        gap_limit=gap_limit,
        missing_interval_limit=missing_interval_limit,
    )
    parsed_valid = analysis["parsed_valid"]
    ordered = analysis["ordered"]
    median_interval = analysis["median_interval"]
    largest_gap = analysis["largest_gap"]
    gap_rows = analysis["gap_rows"]
    missing_interval_rows = analysis["missing_interval_rows"]
    estimated_missing = analysis["estimated_missing"]
    missing_interval_omitted = analysis["missing_interval_omitted"]

    columns = {
        "timestamp": ts_col,
        "open": column_named(df, "open"),
        "high": column_named(df, "high"),
        "low": column_named(df, "low"),
        "close": close_column(df),
        "volume": volume_column(df),
    }
    null_counts = {
        str(col): int(df[col].isna().sum())
        for col in df.columns
        if int(df[col].isna().sum()) > 0
    }
    if raw_ts is not None:
        null_counts["timestamp_parse_failures"] = int(parsed_ts.isna().sum())

    close_col = columns["close"]
    volume_col = columns["volume"]
    close_missing = int(pd.to_numeric(df[close_col], errors="coerce").isna().sum()) if close_col else None
    volume_missing = int(pd.to_numeric(df[volume_col], errors="coerce").isna().sum()) if volume_col else None
    timestamp_parse_failures = int(parsed_ts.isna().sum()) if raw_ts is not None else None
    duplicate_timestamps = int(parsed_valid.duplicated().sum()) if not parsed_valid.empty else 0
    quality_summary = data_quality_summary(
        rows=int(len(df)),
        timestamp_available=raw_ts is not None,
        valid_timestamp_count=int(len(parsed_valid)),
        timestamp_parse_failures=timestamp_parse_failures,
        duplicate_timestamps=duplicate_timestamps,
        median_interval_seconds=median_interval,
        largest_gap_seconds=largest_gap,
        estimated_missing_intervals=int(estimated_missing),
        close_column_name=close_col,
        close_missing=close_missing,
        volume_column_name=volume_col,
        volume_missing=volume_missing,
    )
    price_stats: dict[str, Any] = {}
    return_stats: dict[str, Any] = {}
    volume_stats: dict[str, Any] = {}
    preview = []
    viewer: dict[str, Any] = {
        "requested_start": start_ts.isoformat() if start_ts is not None else None,
        "requested_end": end_ts.isoformat() if end_ts is not None else None,
        "sample_mode": sample_mode,
        "max_points": preview_points,
        "available_rows": 0,
        "filtered_rows": 0,
        "sampled_points": 0,
        "sampled": False,
        "points_omitted": 0,
        "status": "unavailable",
        "status_reason": "no close column or parseable timestamp column",
        "first_timestamp": None,
        "last_timestamp": None,
        "source_timezone": source_tz,
        "normalized_timezone": "UTC" if source_tz else None,
        "has_volume": bool(volume_col),
    }
    if close_col and raw_ts is not None:
        scoped = pd.DataFrame({
            "timestamp": parse_datetime_utc(raw_ts),
            "close": pd.to_numeric(df[close_col], errors="coerce"),
        })
        for name in ("open", "high", "low"):
            col = columns[name]
            if col:
                scoped[name] = pd.to_numeric(df[col], errors="coerce")
        if volume_col:
            scoped["volume"] = pd.to_numeric(df[volume_col], errors="coerce")
        scoped = scoped.dropna(subset=["timestamp", "close"]).sort_values("timestamp")
        viewer["available_rows"] = int(len(scoped))
        if start_ts is not None:
            scoped = scoped[scoped["timestamp"] >= start_ts]
        if end_ts is not None:
            scoped = scoped[scoped["timestamp"] <= end_ts]
        viewer["filtered_rows"] = int(len(scoped))
        if sample_mode == "full" and len(scoped) > preview_points:
            raise ValueError(
                "full sample_mode requires filtered rows to fit inside preview_points; "
                "narrow the date range, increase preview_points, or use sampled mode"
            )
        if not scoped.empty:
            viewer["first_timestamp"] = scoped.iloc[0]["timestamp"].isoformat()
            viewer["last_timestamp"] = scoped.iloc[-1]["timestamp"].isoformat()

        closes = scoped["close"].dropna()
        if not closes.empty:
            first_close = finite_float(closes.iloc[0])
            last_close = finite_float(closes.iloc[-1])
            total_return = (
                (last_close / first_close - 1.0)
                if first_close is not None and first_close != 0 and last_close is not None
                else None
            )
            price_stats = {
                "start_close": first_close,
                "end_close": last_close,
                "min_close": finite_float(closes.min()),
                "max_close": finite_float(closes.max()),
                "total_return_pct": pct(total_return),
            }
            returns = closes.pct_change().replace([float("inf"), float("-inf")], pd.NA).dropna()
            if not returns.empty:
                positive = returns[returns > 0]
                return_stats = {
                    "count": int(returns.count()),
                    "mean_pct": pct(finite_float(returns.mean())),
                    "median_pct": pct(finite_float(returns.median())),
                    "std_pct": pct(finite_float(returns.std())) if len(returns) > 1 else None,
                    "min_pct": pct(finite_float(returns.min())),
                    "max_pct": pct(finite_float(returns.max())),
                    "mean_abs_pct": pct(finite_float(returns.abs().mean())),
                    "positive_pct": pct(float(len(positive)) / float(len(returns))),
                }
        if volume_col and "volume" in scoped:
            volume_numeric = scoped["volume"]
            volume_stats = {
                **numeric_stats(volume_numeric),
                "zero_rows": int((volume_numeric.fillna(-1) == 0).sum()),
                "sum": finite_float(volume_numeric.sum()),
            }
        sample_indices = list(range(len(scoped))) if sample_mode == "full" else evenly_sample_indices(len(scoped), preview_points)
        viewer["sampled"] = bool(len(scoped) > len(sample_indices))
        viewer["sampled_points"] = int(len(sample_indices))
        viewer["points_omitted"] = max(0, int(len(scoped)) - int(len(sample_indices)))
        if scoped.empty:
            viewer["status"] = "empty_range"
            viewer["status_reason"] = "no rows match the selected date range"
        elif viewer["sampled"]:
            viewer["status"] = "sampled"
            viewer["status_reason"] = "range exceeds point limit; evenly sampled for display"
        else:
            viewer["status"] = "full"
            viewer["status_reason"] = "all filtered rows are plotted"
        for idx in sample_indices:
            row = scoped.iloc[idx]
            item = {
                "timestamp": row["timestamp"].isoformat(),
                "close": finite_float(row["close"]),
            }
            for name in ("open", "high", "low", "volume"):
                if name in scoped and pd.notna(row.get(name)):
                    item[name] = finite_float(row[name])
            preview.append(item)

    stat = path.stat()
    symbol = infer_symbol(path, df)
    asset_class = infer_asset_class(path, symbol)
    return {
        "path": rel_path,
        "root": root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root),
        "format": fmt,
        "source": infer_data_source(path),
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "rows": int(len(df)),
        "columns": [str(col) for col in df.columns],
        "symbol": symbol,
        "canonical_symbol": canonical_symbol(symbol, asset_class),
        "asset_class": asset_class,
        "bar_size": infer_bar_size(path, df),
        "storage_session": infer_storage_session(path, df, asset_class),
        "adjustment_status": infer_adjustment_status(path, df, asset_class),
        "column_map": columns,
        "source_timezone": source_tz,
        "normalized_timezone": "UTC" if source_tz else None,
        "coverage": {
            "first_timestamp": ordered.iloc[0].isoformat() if not ordered.empty else None,
            "last_timestamp": ordered.iloc[-1].isoformat() if not ordered.empty else None,
            "median_interval_seconds": median_interval,
            "largest_gap_seconds": largest_gap,
            "estimated_missing_intervals": int(estimated_missing),
            "duplicate_timestamps": duplicate_timestamps,
            "timestamp_parse_failures": timestamp_parse_failures,
        },
        "quality": {
            **quality_summary,
            "null_counts": null_counts,
            "gap_count_returned": len(gap_rows),
            "missing_interval_count_returned": len(missing_interval_rows),
            "missing_interval_omitted_count": missing_interval_omitted,
        },
        "price_stats": price_stats,
        "return_stats": return_stats,
        "volume_stats": volume_stats,
        "viewer": viewer,
        "gaps": gap_rows,
        "missing_intervals": missing_interval_rows,
        "missing_interval_limit": missing_interval_limit,
        "missing_interval_omitted_count": missing_interval_omitted,
        "preview": preview,
        "preview_points": preview_points,
    }


def number_field(payload: dict[str, Any], key: str, default: float, *, integer: bool = False) -> int | float:
    raw = payload.get(key, default)
    try:
        value = int(raw) if integer else float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be numeric") from exc
    if value <= 0:
        raise ValueError(f"{key} must be > 0")
    return value


def plugin_strategy_value(raw: Any, field: dict[str, Any]) -> Any:
    kind = str(field.get("kind") or "text")
    if kind == "checkbox":
        return bool(raw)
    if kind == "number":
        if raw is None or str(raw).strip() == "":
            raw = field.get("default", 0)
        try:
            value = float(raw)
        except (TypeError, ValueError) as exc:
            raise ValueError(f"strategy.{field['name']} must be numeric") from exc
        if field.get("step") and str(field.get("step")).strip() in {"1", "1.0"}:
            value = int(value)
        return value
    if kind == "select":
        value = str(raw if raw is not None and str(raw) != "" else field.get("default", "")).strip()
        allowed = {
            str(option.get("value") if isinstance(option, dict) else option)
            for option in field.get("options", [])
        }
        if allowed and value not in allowed:
            raise ValueError(f"strategy.{field['name']} must be one of {sorted(allowed)}")
        return value
    return str(raw if raw is not None else field.get("default", "")).strip()


def plugin_strategy_config(payload: dict[str, Any], plugin: dict[str, Any]) -> dict[str, Any]:
    raw_strategy = payload.get("strategy") if isinstance(payload.get("strategy"), dict) else {}
    strategy: dict[str, Any] = {}
    for field in plugin.get("strategy_fields") or []:
        name = str(field["name"])
        raw = raw_strategy.get(name, field.get("default"))
        strategy[name] = plugin_strategy_value(raw, field)
    return strategy


def build_config_draft(
    payload: dict[str, Any],
    *,
    state_dir: Path,
    data_roots: list[Path],
    plugins: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    name = slugify(str(payload.get("name") or "workbench_example"))
    plugin_id = str(payload.get("plugin_id") or "no_edge_template")
    available_plugins = plugins or load_config_builder_plugins()
    plugin = config_plugin_by_id(plugin_id, available_plugins)
    if plugin is None:
        raise ValueError(f"unsupported plugin_id: {plugin_id}")
    mode = str(payload.get("mode") or "replay").replace("-", "_").lower()
    if mode not in CONFIG_BUILDER_MODES:
        raise ValueError(f"mode must be one of {', '.join(CONFIG_BUILDER_MODES)}")
    risk_preset = str(payload.get("risk_preset") or "demo_minimal").strip()
    risk_preset_ids = {preset["id"] for preset in CONFIG_BUILDER_RISK_PRESETS}
    if risk_preset not in risk_preset_ids:
        raise ValueError(f"risk_preset must be one of {', '.join(sorted(risk_preset_ids))}")
    strategy_config = plugin_strategy_config(payload, plugin)

    selected = selected_data_files(payload.get("datasets") or [], data_roots)
    data_files = {symbol: rel_path for symbol, (_path, rel_path) in selected.items()}
    start_raw, end_raw, start_ts, end_ts = parse_payload_date_range(payload)
    alignment = build_data_alignment_for_files(selected, start_ts=start_ts, end_ts=end_ts)
    quality_rows = [
        row
        for row in alignment.get("rows", [])
        if row.get("quality_status") in {"warn", "bad"}
    ]
    if quality_rows and not bool(payload.get("allow_quality_warnings", False)):
        symbols = ", ".join(str(row.get("symbol")) for row in quality_rows)
        raise ValueError(
            "selected datasets have data quality warnings: "
            f"{symbols}; set allow_quality_warnings=true to continue"
        )

    starting_cash = number_field(payload, "starting_cash", 10000)
    history_bars = number_field(payload, "history_bars", 100, integer=True)
    max_steps = number_field(payload, "max_steps", 100, integer=True)
    max_orders = number_field(payload, "max_orders_per_run", 1, integer=True)
    max_notional = number_field(payload, "max_notional_per_order", 100)
    max_quantity = number_field(payload, "max_quantity", 10)
    max_cash_quantity = number_field(payload, "max_cash_quantity", 100)
    max_gross_exposure_pct = number_field(payload, "max_gross_exposure_pct", 0.05)
    session_config = None
    if bool(payload.get("session_enabled", False)):
        weekdays_raw = str(payload.get("session_weekdays") or "").strip()
        weekdays = [
            item.strip()
            for item in re.split(r"[\s,]+", weekdays_raw)
            if item.strip()
        ] or ["monday", "tuesday", "wednesday", "thursday", "friday"]
        session_config = {
            "timezone": str(payload.get("session_timezone") or "America/New_York").strip(),
            "start": str(payload.get("session_start") or "09:30").strip(),
            "end": str(payload.get("session_end") or "16:00").strip(),
            "weekdays": weekdays,
            "outside_session": str(payload.get("session_outside") or "idle").strip(),
        }

    data_config = {
        "source": "files",
        "timestamp_column": str(payload.get("timestamp_column") or "timestamp"),
        "files": data_files,
    }
    if start_raw:
        data_config["start"] = start_raw
    if end_raw:
        data_config["end"] = end_raw

    metadata = {
        "config_schema_version": CONFIG_SCHEMA_VERSION,
        "strategy_plugin": plugin["spec"],
        "status": plugin["status"],
        "risk_preset": risk_preset,
    }
    if start_raw or end_raw:
        metadata["date_range"] = {
            "start": start_raw,
            "end": end_raw,
        }

    config = {
        "description": (
            "Generated by the public workbench. Public example plugins are "
            "wiring demonstrations only; local registry plugins remain private."
        ),
        "metadata": metadata,
        "strategy": strategy_config,
        "runner": {
            "mode": mode,
            "starting_cash": starting_cash,
            "history_bars": history_bars,
            "max_steps": max_steps,
            "output_dir": f"paper_logs/workbench/{name}",
            "clean_output_dir": True,
        },
        "data": data_config,
        "execution": {
            "allowed_symbols": sorted(data_files),
            "allowed_sides": ["buy", "sell"],
            "allowed_order_types": ["market"],
            "allow_short": False,
            "require_current_price": True,
            "max_orders_per_run": max_orders,
            "max_notional_per_order": max_notional,
            "max_quantity": max_quantity,
            "max_cash_quantity": max_cash_quantity,
            "max_gross_exposure_pct": max_gross_exposure_pct,
            "sim_slippage_bps": float(payload.get("sim_slippage_bps", 0) or 0),
            "sim_commission_bps": float(payload.get("sim_commission_bps", 0) or 0),
        },
        "control": {
            "pause_marker": f"paper_logs/control/{name}.pause",
            "stop_marker": f"paper_logs/control/{name}.stop",
        },
        "broker": {
            "host": "127.0.0.1",
            "port": 4002,
            "client_id": 301,
        },
        "notes": [
            "Generated by the public workbench.",
            "Review plugin visibility, data quality, and risk limits before any paper/live use.",
            plugin["boundary"],
        ],
    }
    if session_config is not None:
        config["runner"]["session"] = session_config
    yaml_text = yaml.safe_dump(config, sort_keys=False)
    errors = validate_workbench_draft_config(
        config,
        config_path=ROOT / "config" / f"{name}.yaml",
        data_roots=data_roots,
        action="validate",
        plugins=available_plugins,
    )
    saved_path = None
    if bool(payload.get("save", False)):
        drafts_dir = state_dir / "config_drafts"
        drafts_dir.mkdir(parents=True, exist_ok=True)
        path = drafts_dir / f"{name}.yaml"
        path.write_text(yaml_text, encoding="utf-8")
        saved_path = str(path)

    command_path = saved_path or f"<write-yaml-to>/{name}.yaml"
    return {
        "name": name,
        "plugin": plugin,
        "config": config,
        "yaml": yaml_text,
        "saved_path": saved_path,
        "validation": {
            "valid": not errors,
            "errors": errors,
        },
        "commands": plugin_runner_commands(command_path),
        "alignment": alignment,
    }


def config_builder_options(plugin_registry_paths: list[Path] | None = None) -> dict[str, Any]:
    plugins = load_config_builder_plugins(plugin_registry_paths)
    plugin_strategy_fields = [
        field
        for plugin in plugins
        for field in (plugin.get("strategy_fields") or [])
    ]
    return {
        "config_schema_version": CONFIG_SCHEMA_VERSION,
        "form_schema_version": CONFIG_FORM_SCHEMA_VERSION,
        "plugins": plugins,
        "plugin_registry_paths": [display_path(path) for path in parse_plugin_registry_paths(plugin_registry_paths)],
        "modes": list(CONFIG_BUILDER_MODES),
        "run_actions": list(CONFIG_DRAFT_RUN_ACTIONS),
        "broker_adapters": broker_adapter_capabilities(),
        "risk_presets": list(CONFIG_BUILDER_RISK_PRESETS),
        "form_schema": list(CONFIG_BUILDER_FORM_SCHEMA) + plugin_strategy_fields,
        "defaults": {
            "name": "workbench_example",
            "starting_cash": 10000,
            "history_bars": 100,
            "risk_preset": "demo_minimal",
            "max_steps": 100,
            "session_timezone": "America/New_York",
            "session_start": "09:30",
            "session_end": "16:00",
            "session_weekdays": "monday,tuesday,wednesday,thursday,friday",
            "session_outside": "idle",
            "max_orders_per_run": 1,
            "max_notional_per_order": 100,
            "max_quantity": 10,
            "max_cash_quantity": 100,
            "max_gross_exposure_pct": 0.05,
            "sim_slippage_bps": 0,
            "sim_commission_bps": 0,
            "run_timeout_seconds": 30,
        },
    }


def config_drafts_dir(state_dir: Path) -> Path:
    return state_dir / "config_drafts"


def config_draft_runs_path(state_dir: Path) -> Path:
    return state_dir / "config_draft_runs.jsonl"


def config_draft_run_artifacts_root(state_dir: Path) -> Path:
    return state_dir / "run_artifacts"


def config_draft_run_artifact_dir(state_dir: Path, run_id: str) -> Path:
    safe_id = slugify(run_id)
    if not safe_id:
        raise ValueError("run_id is invalid")
    root = config_draft_run_artifacts_root(state_dir).resolve()
    path = (root / safe_id).resolve()
    if not path.is_relative_to(root):
        raise ValueError("run_id is invalid")
    return path


def config_draft_path(state_dir: Path, draft_id: str) -> Path:
    safe_id = slugify(draft_id)
    path = (config_drafts_dir(state_dir) / f"{safe_id}.yaml").resolve()
    root = config_drafts_dir(state_dir).resolve()
    if not path.is_relative_to(root):
        raise ValueError("draft_id is invalid")
    if not path.exists() or not path.is_file():
        raise ValueError(f"config draft not found: {safe_id}")
    return path


def read_yaml_mapping(path: Path) -> dict[str, Any]:
    with path.open() as f:
        config = yaml.safe_load(f) or {}
    if not isinstance(config, dict):
        raise ValueError("config draft must be a YAML mapping")
    return config


def draft_folder_label(path: Path) -> str:
    root = config_drafts_dir(Path(".")).name
    parent = path.parent.name or root
    return parent


def draft_status_label(metadata: dict[str, Any], runner: dict[str, Any]) -> str:
    status = str(metadata.get("status") or "").strip()
    mode = str(runner.get("mode") or "").strip()
    if status:
        return status
    if mode:
        return mode
    return "unknown"


def draft_tags(metadata: dict[str, Any], runner: dict[str, Any], data: dict[str, Any]) -> list[str]:
    tags = []
    mode = str(runner.get("mode") or "").strip()
    status = str(metadata.get("status") or "").strip()
    plugin = str(metadata.get("strategy_plugin") or metadata.get("plugin") or "").strip()
    files = data.get("files") if isinstance(data.get("files"), dict) else {}
    if status:
        tags.append(status)
    if mode:
        tags.append(mode)
    if plugin.startswith("examples."):
        tags.append("public_example")
    if files:
        tags.append(f"{len(files)} symbols")
    return tags


def config_draft_record(path: Path) -> dict[str, Any]:
    config = read_yaml_mapping(path)
    runner = config.get("runner") or {}
    metadata = config.get("metadata") or {}
    data = config.get("data") or {}
    stat = path.stat()
    return {
        "draft_id": path.stem,
        "path": str(path),
        "name": path.stem,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "size_bytes": stat.st_size,
        "mode": runner.get("mode"),
        "output_dir": runner.get("output_dir"),
        "plugin": metadata.get("strategy_plugin") or metadata.get("plugin"),
        "status": metadata.get("status"),
        "status_label": draft_status_label(metadata, runner),
        "folder": draft_folder_label(path),
        "tags": draft_tags(metadata, runner, data),
        "symbols": sorted((data.get("files") or {}).keys()) if isinstance(data.get("files"), dict) else [],
    }


def list_config_drafts(state_dir: Path) -> dict[str, Any]:
    root = config_drafts_dir(state_dir)
    if not root.exists():
        return {"drafts": [], "count": 0}
    drafts = []
    errors = []
    for path in sorted(root.glob("*.yaml")):
        try:
            drafts.append(config_draft_record(path))
        except Exception as exc:
            errors.append({"path": str(path), "error": str(exc)})
    return {"drafts": drafts, "count": len(drafts), "errors": errors, "error_count": len(errors)}


def config_draft_validation_record(
    path: Path,
    *,
    data_roots: list[Path],
    plugins: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    stat = path.stat()
    base: dict[str, Any] = {
        "draft_id": path.stem,
        "path": str(path),
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "size_bytes": stat.st_size,
        "mode": None,
        "output_dir": None,
        "plugin": None,
        "status": None,
        "status_label": "unknown",
        "folder": draft_folder_label(path),
        "tags": [],
        "symbols": [],
        "valid": False,
        "errors": [],
        "error_count": 0,
    }
    try:
        config = read_yaml_mapping(path)
        runner = config.get("runner") or {}
        metadata = config.get("metadata") or {}
        data = config.get("data") or {}
        errors = validate_workbench_draft_config(
            config,
            config_path=path,
            data_roots=data_roots,
            action="replay",
            plugins=plugins,
        )
        base.update({
            "mode": runner.get("mode"),
            "output_dir": runner.get("output_dir"),
            "plugin": metadata.get("strategy_plugin") or metadata.get("plugin"),
            "status": metadata.get("status"),
            "status_label": draft_status_label(metadata, runner),
            "tags": draft_tags(metadata, runner, data),
            "symbols": sorted((data.get("files") or {}).keys()) if isinstance(data.get("files"), dict) else [],
            "valid": not errors,
            "errors": errors,
            "error_count": len(errors),
        })
    except Exception as exc:
        base["errors"] = [str(exc)]
        base["error_count"] = 1
    return base


def build_config_draft_validations(
    state_dir: Path,
    *,
    data_roots: list[Path],
    plugins: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    root = config_drafts_dir(state_dir)
    if not root.exists():
        return {
            "generated_at": utc_now(),
            "validations": [],
            "count": 0,
            "valid_count": 0,
            "invalid_count": 0,
        }
    rows = [
        config_draft_validation_record(path, data_roots=data_roots, plugins=plugins)
        for path in sorted(root.glob("*.yaml"))
    ]
    valid_count = sum(1 for row in rows if row.get("valid"))
    return {
        "generated_at": utc_now(),
        "validations": rows,
        "count": len(rows),
        "valid_count": valid_count,
        "invalid_count": len(rows) - valid_count,
    }


def delete_config_draft(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    draft_id = str(payload.get("draft_id") or "").strip()
    if not draft_id:
        raise ValueError("draft_id is required")
    if str(payload.get("confirm") or "") != "delete-draft":
        raise ValueError("confirm must be 'delete-draft'")
    path = config_draft_path(state_dir, draft_id)
    record = config_draft_record(path)
    path.unlink()
    return {
        "deleted": True,
        "draft": record,
        "deleted_path": str(path),
    }


def plugin_runner_commands(config_path: str) -> dict[str, str]:
    return {
        "validate": f"python3 live/plugin_runner.py --config {config_path} --validate-only",
        "replay": f"python3 live/plugin_runner.py --config {config_path} --mode replay",
        "simulated_paper": f"python3 live/plugin_runner.py --config {config_path} --mode simulated-paper",
    }


def bounded_positive_int(
    payload: dict[str, Any],
    key: str,
    *,
    default: int,
    maximum: int,
) -> int:
    raw = payload.get(key, default)
    try:
        value = int(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{key} must be an integer") from exc
    if value <= 0 or value > maximum:
        raise ValueError(f"{key} must be between 1 and {maximum}")
    return value


def validate_workbench_draft_config(
    config: dict[str, Any],
    *,
    config_path: Path,
    data_roots: list[Path],
    action: str,
    plugins: list[dict[str, Any]] | None = None,
) -> list[str]:
    errors = validate_runner_config(config, config_path=config_path)
    metadata = config.get("metadata") or {}
    runner = config.get("runner") or {}
    data = config.get("data") or {}
    spec = metadata.get("strategy_plugin") or metadata.get("plugin")
    available_plugins = plugins or load_config_builder_plugins()
    status = metadata.get("status")
    plugin = next(
        (item for item in available_plugins if item.get("spec") == spec and item.get("status") == status),
        None,
    ) or next((item for item in available_plugins if item.get("spec") == spec), None)
    if plugin is None:
        errors.append("workbench drafts can only run configured Workbench plugins")
    elif metadata.get("status") != plugin.get("status"):
        errors.append(f"workbench draft metadata.status must match plugin status {plugin.get('status')}")
    mode = str(runner.get("mode", "replay")).replace("-", "_").lower()
    if mode not in CONFIG_BUILDER_MODES:
        errors.append(f"runner.mode must be one of {', '.join(CONFIG_BUILDER_MODES)}")
    if action not in CONFIG_DRAFT_RUN_ACTIONS:
        errors.append(f"action must be one of {', '.join(CONFIG_DRAFT_RUN_ACTIONS)}")
    if str(data.get("source", "files")).lower() != "files":
        errors.append("workbench drafts can only run file-based data")
    files = data.get("files") or {}
    if isinstance(files, dict):
        for raw_path in files.values():
            try:
                data_path_allowed(str(raw_path), data_roots)
            except ValueError as exc:
                errors.append(str(exc))
    return errors


def load_config_draft_detail(
    state_dir: Path,
    draft_id: str,
    *,
    data_roots: list[Path],
    plugins: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    path = config_draft_path(state_dir, draft_id)
    config = read_yaml_mapping(path)
    errors = validate_workbench_draft_config(
        config,
        config_path=path,
        data_roots=data_roots,
        action="replay",
        plugins=plugins,
    )
    valid = not errors
    alignment: dict[str, Any] = {}
    if valid:
        data = config.get("data") or {}
        files = data.get("files") or {}
        selected = {
            str(symbol).upper(): data_path_allowed(str(raw_path), data_roots)
            for symbol, raw_path in files.items()
        } if isinstance(files, dict) else {}
        alignment = build_data_alignment_for_files(selected) if selected else {}
    return {
        "draft": config_draft_record(path),
        "validation": {
            "valid": valid,
            "errors": errors,
        },
        "yaml": path.read_text(encoding="utf-8") if valid else "",
        "commands": plugin_runner_commands(str(path)) if valid else {},
        "alignment": alignment,
    }


def load_config_draft_yaml(
    state_dir: Path,
    draft_id: str,
    *,
    data_roots: list[Path],
    plugins: list[dict[str, Any]] | None = None,
) -> tuple[str, str]:
    path = config_draft_path(state_dir, draft_id)
    config = read_yaml_mapping(path)
    errors = validate_workbench_draft_config(
        config,
        config_path=path,
        data_roots=data_roots,
        action="replay",
        plugins=plugins,
    )
    if errors:
        raise ValueError("; ".join(errors))
    return path.name, path.read_text(encoding="utf-8")


def tail_text(value: str | bytes | None, *, max_bytes: int = OUTPUT_TAIL_BYTES) -> str:
    if value is None:
        return ""
    if isinstance(value, bytes):
        raw = value[-max_bytes:]
        return raw.decode("utf-8", errors="replace")
    encoded = value.encode("utf-8", errors="replace")
    return encoded[-max_bytes:].decode("utf-8", errors="replace")


def run_summary_for_config(config: dict[str, Any]) -> dict[str, Any] | None:
    runner = config.get("runner") or {}
    output_dir = runner.get("output_dir")
    if not output_dir:
        return None
    summary_path = (ROOT / str(output_dir) / "summary.json").resolve()
    if not summary_path.exists() or not summary_path.is_file():
        return None
    try:
        with summary_path.open() as f:
            summary = json.load(f)
    except json.JSONDecodeError:
        return None
    return summary if isinstance(summary, dict) else None


def append_config_draft_run(state_dir: Path, record: dict[str, Any]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    with config_draft_runs_path(state_dir).open("a") as f:
        f.write(json.dumps(record, sort_keys=True) + "\n")


def list_config_draft_runs(state_dir: Path, *, limit: int = 20) -> dict[str, Any]:
    path = config_draft_runs_path(state_dir)
    if not path.exists():
        return {"runs": [], "count": 0, "total": 0, "limit": limit}
    rows: deque[dict[str, Any]] = deque(maxlen=limit)
    total = 0
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict):
                continue
            total += 1
            rows.append(row)
    runs = list(reversed(rows))
    return {"runs": runs, "count": len(runs), "total": total, "limit": limit}


def read_config_draft_run_rows(state_dir: Path) -> list[dict[str, Any]]:
    path = config_draft_runs_path(state_dir)
    if not path.exists():
        return []
    rows = []
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return rows


def directory_size_bytes(path: Path) -> int:
    if not path.exists():
        return 0
    total = 0
    for item in path.rglob("*"):
        if item.is_file():
            try:
                total += item.stat().st_size
            except OSError:
                continue
    return total


def child_dirs(path: Path) -> list[Path]:
    if not path.exists() or not path.is_dir():
        return []
    return sorted(item for item in path.iterdir() if item.is_dir())


def display_path(path: Path) -> str:
    resolved = path.resolve()
    return resolved.relative_to(ROOT).as_posix() if resolved.is_relative_to(ROOT) else str(resolved)


def directory_plan_item(path: Path) -> dict[str, Any]:
    stat = path.stat()
    return {
        "path": display_path(path),
        "absolute_path": str(path.resolve()),
        "size_bytes": directory_size_bytes(path),
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
    }


def resolve_workbench_output_dir(raw_output_dir: str) -> Path:
    raw = raw_output_dir.strip()
    if not raw:
        raise ValueError("runner.output_dir is required")
    candidate = Path(raw)
    output_dir = candidate if candidate.is_absolute() else ROOT / candidate
    output_dir = output_dir.resolve()
    root = WORKBENCH_OUTPUT_ROOT.resolve()
    if not output_dir.is_relative_to(root):
        raise ValueError("runner.output_dir must be inside paper_logs/workbench")
    return output_dir


def collect_referenced_artifact_dirs(state_dir: Path, runs: list[dict[str, Any]]) -> set[Path]:
    root = config_draft_run_artifacts_root(state_dir).resolve()
    referenced: set[Path] = set()
    for row in runs:
        if row.get("artifact_path"):
            path = Path(str(row["artifact_path"])).resolve()
            if path.is_relative_to(root):
                referenced.add(path)
        if row.get("run_id"):
            try:
                referenced.add(config_draft_run_artifact_dir(state_dir, str(row["run_id"])).resolve())
            except ValueError:
                continue
    return referenced


def referenced_workbench_output_dirs(state_dir: Path, runs: list[dict[str, Any]]) -> set[Path]:
    referenced: set[Path] = set()

    def add_raw(raw: Any) -> None:
        if raw is None:
            return
        try:
            referenced.add(resolve_workbench_output_dir(str(raw)))
        except ValueError:
            return

    drafts_dir = config_drafts_dir(state_dir)
    if drafts_dir.exists():
        for path in sorted(drafts_dir.glob("*.yaml")):
            try:
                config = read_yaml_mapping(path)
            except Exception:
                continue
            runner = config.get("runner") if isinstance(config.get("runner"), dict) else {}
            add_raw(runner.get("output_dir"))

    for row in runs:
        add_raw(row.get("output_dir"))
        summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
        add_raw(summary.get("output_dir"))
    return referenced


def path_contains_any(path: Path, candidates: Iterable[Path]) -> bool:
    resolved = path.resolve()
    return any(candidate.resolve().is_relative_to(resolved) for candidate in candidates)


def build_workbench_cleanup_plan(state_dir: Path) -> dict[str, Any]:
    artifacts_root = config_draft_run_artifacts_root(state_dir).resolve()
    output_root = WORKBENCH_OUTPUT_ROOT.resolve()
    runs = read_config_draft_run_rows(state_dir)

    artifact_dirs = child_dirs(artifacts_root)
    referenced_artifacts = collect_referenced_artifact_dirs(state_dir, runs)
    orphaned_archives = [
        path for path in artifact_dirs
        if path.resolve() not in referenced_artifacts
    ]

    referenced_outputs = referenced_workbench_output_dirs(state_dir, runs)
    orphaned_outputs = [
        path for path in child_dirs(output_root)
        if not path_contains_any(path, referenced_outputs)
    ]
    archive_items = [directory_plan_item(path) for path in orphaned_archives]
    output_items = [directory_plan_item(path) for path in orphaned_outputs]
    reclaimable_bytes = sum(int(item["size_bytes"]) for item in archive_items + output_items)
    return {
        "generated_at": utc_now(),
        "state_dir": str(state_dir),
        "run_artifacts_dir": str(artifacts_root),
        "workbench_output_root": str(output_root),
        "referenced_archive_count": len(referenced_artifacts),
        "referenced_output_count": len(referenced_outputs),
        "orphaned_archive_count": len(archive_items),
        "orphaned_output_count": len(output_items),
        "reclaimable_dir_count": len(archive_items) + len(output_items),
        "reclaimable_bytes": reclaimable_bytes,
        "orphaned_archives": archive_items,
        "orphaned_outputs": output_items,
    }


def parse_bool_payload(payload: dict[str, Any], key: str, *, default: bool) -> bool:
    raw = payload.get(key, default)
    if isinstance(raw, bool):
        return raw
    if isinstance(raw, str):
        lowered = raw.strip().lower()
        if lowered in {"1", "true", "yes", "on"}:
            return True
        if lowered in {"0", "false", "no", "off"}:
            return False
    raise ValueError(f"{key} must be true or false")


def remove_cleanup_dir(path: Path, *, root: Path) -> None:
    resolved = path.resolve()
    root = root.resolve()
    if resolved == root or not resolved.is_relative_to(root):
        raise ValueError(f"cleanup path is outside allowed root: {resolved}")
    if resolved.exists():
        shutil.rmtree(resolved)


def run_workbench_cleanup(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    dry_run = parse_bool_payload(payload, "dry_run", default=True)
    if not dry_run and str(payload.get("confirm") or "") != "prune-workbench":
        raise ValueError("confirm must be 'prune-workbench' when dry_run is false")
    plan = build_workbench_cleanup_plan(state_dir)
    deleted = []
    errors = []
    if not dry_run:
        groups = [
            ("archive", config_draft_run_artifacts_root(state_dir).resolve(), plan["orphaned_archives"]),
            ("output", WORKBENCH_OUTPUT_ROOT.resolve(), plan["orphaned_outputs"]),
        ]
        for kind, root, items in groups:
            for item in items:
                path = Path(str(item["absolute_path"]))
                try:
                    remove_cleanup_dir(path, root=root)
                    deleted.append({"kind": kind, "path": item["path"], "size_bytes": item["size_bytes"]})
                except Exception as exc:
                    errors.append({"kind": kind, "path": item["path"], "error": str(exc)})
    return {
        "ok": not errors,
        "dry_run": dry_run,
        "confirm_required": "prune-workbench",
        "plan": plan,
        "deleted": deleted,
        "delete_count": len(deleted),
        "errors": errors,
        "error_count": len(errors),
    }


def writable_probe(path: Path, *, expect_dir: bool) -> dict[str, Any]:
    resolved = path.resolve()
    exists = resolved.exists()
    parent = resolved if exists and resolved.is_dir() else resolved.parent
    while not parent.exists() and parent != parent.parent:
        parent = parent.parent
    writable = os.access(parent, os.W_OK) if parent.exists() else False
    return {
        "path": str(resolved),
        "exists": exists,
        "is_dir": resolved.is_dir() if exists else False,
        "is_file": resolved.is_file() if exists else False,
        "writable": bool(writable),
        "expected": "directory" if expect_dir else "file",
    }


def data_file_count(root: Path, *, limit: int = 10_000) -> int:
    if not root.exists() or not root.is_dir():
        return 0
    count = 0
    for path in root.rglob("*"):
        if path.is_file() and path.suffix.lower() in DATA_FILE_SUFFIXES:
            count += 1
            if count >= limit:
                break
    return count


def data_root_row(root: Path) -> dict[str, Any]:
    row = writable_probe(root, expect_dir=True)
    row["display_path"] = root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root)
    row["data_file_count"] = data_file_count(root)
    row["scope"] = classify_data_root(root)
    row["scope_note"] = data_root_scope_note(row["scope"])
    return row


def build_workbench_diagnostics(
    state_dir: Path,
    *,
    data_roots: list[Path],
    dashboard_dir: Path,
) -> dict[str, Any]:
    warnings = []
    blockers = []
    state_probe = writable_probe(state_dir, expect_dir=True)
    if not state_probe["writable"]:
        blockers.append("state directory parent is not writable")

    dashboard_assets = []
    for name in ("index.html", "app.js", "styles.css"):
        path = dashboard_dir / name
        item = {
            "name": name,
            "path": str(path.resolve()),
            "exists": path.exists() and path.is_file(),
            "size_bytes": path.stat().st_size if path.exists() and path.is_file() else 0,
        }
        if not item["exists"]:
            blockers.append(f"dashboard asset missing: {name}")
        dashboard_assets.append(item)

    data_root_rows = []
    for root in data_roots:
        row = data_root_row(root)
        if not row["exists"]:
            warnings.append(f"data root does not exist: {root}")
        elif not row["is_dir"]:
            warnings.append(f"data root is not a directory: {root}")
        elif row["data_file_count"] == 0:
            warnings.append(f"data root has no CSV/parquet files: {root}")
        data_root_rows.append(row)
    if not data_root_rows:
        warnings.append("no data roots configured")
    configured = {root.resolve() for root in data_roots}
    suggested_rows = []
    for root in SUGGESTED_DATA_ROOTS:
        resolved = root.resolve()
        if resolved in configured:
            continue
        row = data_root_row(resolved)
        if row["exists"] and row["is_dir"] and row["data_file_count"]:
            suggested_rows.append(row)

    status = "bad" if blockers else "warn" if warnings else "ok"
    return {
        "generated_at": utc_now(),
        "status": status,
        "warnings": blockers + warnings,
        "warning_count": len(blockers) + len(warnings),
        "state_dir": state_probe,
        "dashboard_dir": str(dashboard_dir.resolve()),
        "dashboard_assets": dashboard_assets,
        "data_roots": data_root_rows,
        "suggested_data_roots": suggested_rows,
    }


def build_workbench_snapshot(
    state_dir: Path,
    *,
    data_roots: list[Path],
    dashboard_dir: Path,
    fetch_manifest_roots: list[Path],
    plugin_registry_paths: list[Path] | None = None,
) -> dict[str, Any]:
    catalog = build_data_catalog(data_roots, limit=200, preview_points=2)
    dataset_rows = [
        {field: row.get(field) for field in DATA_CATALOG_EXPORT_FIELDS}
        for row in catalog["datasets"]
    ]
    return {
        "schema_version": WORKBENCH_SNAPSHOT_SCHEMA_VERSION,
        "config_schema_version": CONFIG_SCHEMA_VERSION,
        "form_schema_version": CONFIG_FORM_SCHEMA_VERSION,
        "generated_at": utc_now(),
        "workbench_status": build_workbench_status(state_dir),
        "diagnostics": build_workbench_diagnostics(
            state_dir,
            data_roots=data_roots,
            dashboard_dir=dashboard_dir,
        ),
        "data_catalog": {
            "roots": catalog["roots"],
            "count": catalog["count"],
            "error_count": catalog["error_count"],
            "quality_counts": catalog["quality_counts"],
            "bar_size_counts": catalog["bar_size_counts"],
            "asset_class_counts": catalog["asset_class_counts"],
            "source_counts": catalog["source_counts"],
            "row_count_total": catalog["row_count_total"],
            "size_bytes_total": catalog["size_bytes_total"],
            "latest_modified_at": catalog["latest_modified_at"],
            "datasets": dataset_rows,
        },
        "fetch_manifests": build_fetch_manifests(fetch_manifest_roots, limit=50),
        "config_options": config_builder_options(plugin_registry_paths),
        "run_comparison": build_config_draft_run_comparison(state_dir, limit=50),
    }


def build_workbench_endpoints() -> dict[str, Any]:
    return {
        "generated_at": utc_now(),
        "endpoints": list(PUBLIC_ENDPOINTS),
        "count": len(PUBLIC_ENDPOINTS),
        "categories": count_values(PUBLIC_ENDPOINTS, "category"),
    }


def build_workbench_status(state_dir: Path) -> dict[str, Any]:
    drafts_dir = config_drafts_dir(state_dir)
    artifacts_root = config_draft_run_artifacts_root(state_dir)
    runs = read_config_draft_run_rows(state_dir)
    latest_run = None
    if runs:
        latest_run = max(runs, key=lambda row: str(row.get("finished_at") or row.get("started_at") or ""))
    artifact_dirs = child_dirs(artifacts_root)
    referenced_archives = collect_referenced_artifact_dirs(state_dir, runs)
    orphaned_artifact_dirs = [
        path for path in artifact_dirs
        if path.resolve() not in referenced_archives
    ]
    cleanup_plan = build_workbench_cleanup_plan(state_dir)
    return {
        "state_dir": str(state_dir),
        "drafts_dir": str(drafts_dir),
        "run_log": str(config_draft_runs_path(state_dir)),
        "run_artifacts_dir": str(artifacts_root),
        "workbench_output_root": str(WORKBENCH_OUTPUT_ROOT),
        "draft_count": len(list(drafts_dir.glob("*.yaml"))) if drafts_dir.exists() else 0,
        "run_count": len(runs),
        "archived_run_count": len(artifact_dirs),
        "orphaned_archive_count": len(orphaned_artifact_dirs),
        "orphaned_output_count": cleanup_plan["orphaned_output_count"],
        "reclaimable_bytes": cleanup_plan["reclaimable_bytes"],
        "status_counts": count_values(runs, "status"),
        "action_counts": count_values(runs, "action"),
        "state_bytes": directory_size_bytes(state_dir),
        "draft_bytes": directory_size_bytes(drafts_dir),
        "archived_artifact_bytes": directory_size_bytes(artifacts_root),
        "workbench_output_bytes": directory_size_bytes(WORKBENCH_OUTPUT_ROOT),
        "latest_run": summarize_config_draft_run_for_comparison(latest_run) if latest_run else None,
    }


def find_config_draft_run(state_dir: Path, run_id: str) -> dict[str, Any]:
    safe_id = slugify(run_id)
    if not safe_id:
        raise ValueError("run_id is required")
    path = config_draft_runs_path(state_dir)
    if not path.exists():
        raise ValueError(f"run not found: {safe_id}")
    found = None
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("run_id") == safe_id:
                found = row
    if found is None:
        raise ValueError(f"run not found: {safe_id}")
    return found


def load_config_draft_run_detail(state_dir: Path, run_id: str) -> dict[str, Any]:
    row = find_config_draft_run(state_dir, run_id)
    summary = row.get("summary") if isinstance(row.get("summary"), dict) else None
    return {
        "run_id": row.get("run_id"),
        "draft_id": row.get("draft_id"),
        "action": row.get("action"),
        "status": row.get("status"),
        "returncode": row.get("returncode"),
        "started_at": row.get("started_at"),
        "finished_at": row.get("finished_at"),
        "duration_seconds": row.get("duration_seconds"),
        "command": row.get("command") if isinstance(row.get("command"), list) else [],
        "stdout_tail": row.get("stdout_tail") or "",
        "stderr_tail": row.get("stderr_tail") or "",
        "artifact_available": bool(row.get("artifact_path")),
        "artifact_path": row.get("artifact_path"),
        "summary_available": bool(summary),
        "summary": summary,
    }


def count_values(rows: Iterable[dict[str, Any]], key: str) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        label = str(row.get(key) or "unknown")
        counts[label] = counts.get(label, 0) + 1
    return dict(sorted(counts.items()))


def successful_run_summary(row: dict[str, Any]) -> dict[str, Any]:
    summary = row.get("summary") if isinstance(row.get("summary"), dict) else {}
    if row.get("status") != "completed" or row.get("returncode") not in (0, None):
        return {}
    return summary


def summarize_config_draft_run_for_comparison(row: dict[str, Any]) -> dict[str, Any]:
    summary = successful_run_summary(row)
    return {
        "run_id": row.get("run_id"),
        "draft_id": row.get("draft_id"),
        "action": row.get("action"),
        "status": row.get("status"),
        "returncode": row.get("returncode"),
        "started_at": row.get("started_at"),
        "finished_at": row.get("finished_at"),
        "duration_seconds": row.get("duration_seconds"),
        "artifact_available": bool(row.get("artifact_path")),
        "summary_available": bool(summary),
        "mode": summary.get("mode"),
        "decisions": summary.get("decisions"),
        "orders": summary.get("orders"),
        "fills": summary.get("fills"),
        "rejections": summary.get("rejections"),
        "initial_equity": summary.get("initial_equity"),
        "final_equity": summary.get("final_equity"),
        "final_cash": summary.get("final_cash"),
        "total_return_pct": summary.get("total_return_pct"),
        "max_drawdown_pct": summary.get("max_drawdown_pct"),
        "elapsed_days": summary.get("elapsed_days"),
        "return_per_day_pct": summary.get("return_per_day_pct"),
        "return_per_month_pct": summary.get("return_per_month_pct"),
        "return_per_year_pct": summary.get("return_per_year_pct"),
        "short_horizon_projection": summary.get("short_horizon_projection"),
        "max_gross_exposure": summary.get("max_gross_exposure"),
        "max_gross_exposure_pct": summary.get("max_gross_exposure_pct"),
        "max_abs_net_exposure": summary.get("max_abs_net_exposure"),
        "max_abs_net_exposure_pct": summary.get("max_abs_net_exposure_pct"),
        "max_position_count": summary.get("max_position_count"),
    }


def run_with_max_metric(runs: list[dict[str, Any]], metric: str) -> dict[str, Any] | None:
    eligible = [(finite_float(row.get(metric)), row) for row in runs]
    eligible = [(value, row) for value, row in eligible if value is not None]
    if not eligible:
        return None
    return max(eligible, key=lambda item: item[0])[1]


def build_config_draft_run_comparison(state_dir: Path, *, limit: int = 50) -> dict[str, Any]:
    payload = list_config_draft_runs(state_dir, limit=limit)
    runs = [summarize_config_draft_run_for_comparison(row) for row in payload["runs"]]
    summarized = [row for row in runs if row.get("summary_available")]
    leaders = {
        "best_total_return": run_with_max_metric(summarized, "total_return_pct"),
        "best_return_per_day": run_with_max_metric(summarized, "return_per_day_pct"),
        "lowest_drawdown": run_with_max_metric(summarized, "max_drawdown_pct"),
    }
    return {
        "runs": runs,
        "count": len(runs),
        "total": payload["total"],
        "limit": payload["limit"],
        "status_counts": count_values(runs, "status"),
        "action_counts": count_values(runs, "action"),
        "summary_count": len(summarized),
        "short_horizon_count": sum(1 for row in summarized if row.get("short_horizon_projection")),
        "leaders": leaders,
    }


RUN_EXPORT_FIELDS = (
    "finished_at",
    "started_at",
    "run_id",
    "draft_id",
    "action",
    "status",
    "returncode",
    "duration_seconds",
    "summary_available",
    "artifact_available",
    "mode",
    "decisions",
    "orders",
    "fills",
    "rejections",
    "initial_equity",
    "final_equity",
    "final_cash",
    "total_return_pct",
    "max_drawdown_pct",
    "elapsed_days",
    "return_per_day_pct",
    "return_per_month_pct",
    "return_per_year_pct",
    "short_horizon_projection",
    "max_gross_exposure_pct",
    "max_abs_net_exposure_pct",
    "max_position_count",
)


DRAFT_EXPORT_FIELDS = (
    "draft_id",
    "name",
    "folder",
    "status",
    "status_label",
    "mode",
    "plugin",
    "symbol_count",
    "symbols",
    "tags",
    "modified_at",
    "size_bytes",
    "valid",
    "error_count",
    "errors",
    "output_dir",
    "path",
)


def build_config_drafts_csv(
    state_dir: Path,
    *,
    data_roots: list[Path],
    plugins: list[dict[str, Any]] | None = None,
) -> str:
    drafts_payload = list_config_drafts(state_dir)
    validations_payload = build_config_draft_validations(state_dir, data_roots=data_roots, plugins=plugins)
    validations = {
        str(row.get("draft_id")): row
        for row in validations_payload.get("validations", [])
        if row.get("draft_id")
    }
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=DRAFT_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for draft in drafts_payload.get("drafts", []):
        validation = validations.get(str(draft.get("draft_id")), {})
        row = {
            **draft,
            "symbol_count": len(draft.get("symbols") or []),
            "valid": validation.get("valid"),
            "error_count": validation.get("error_count"),
            "errors": validation.get("errors"),
        }
        writer.writerow({field: compact_csv_value(row.get(field)) for field in DRAFT_EXPORT_FIELDS})
    return out.getvalue()


def build_config_draft_runs_csv(state_dir: Path, *, limit: int = 200) -> str:
    payload = list_config_draft_runs(state_dir, limit=limit)
    rows = [summarize_config_draft_run_for_comparison(row) for row in payload["runs"]]
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=RUN_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        writer.writerow({field: row.get(field) for field in RUN_EXPORT_FIELDS})
    return out.getvalue()


def safe_workbench_output_dir(config: dict[str, Any]) -> Path:
    runner = config.get("runner") or {}
    raw_output_dir = str(runner.get("output_dir") or "").strip()
    return resolve_workbench_output_dir(raw_output_dir)


def read_json_file(path: Path) -> dict[str, Any] | None:
    if not path.exists() or not path.is_file():
        return None
    with path.open() as f:
        data = json.load(f)
    return data if isinstance(data, dict) else None


def read_jsonl_tail(path: Path, *, limit: int) -> list[dict[str, Any]]:
    if not path.exists() or not path.is_file():
        return []
    rows: deque[dict[str, Any]] = deque(maxlen=limit)
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict):
                rows.append(row)
    return list(rows)


def summarize_decision_artifact(row: dict[str, Any]) -> dict[str, Any]:
    intents = row.get("intents")
    diagnostics = row.get("diagnostics") if isinstance(row.get("diagnostics"), dict) else {}
    symbols = diagnostics.get("symbols") or diagnostics.get("symbols_seen")
    if not isinstance(symbols, list):
        symbols = []
    return {
        "timestamp": row.get("timestamp"),
        "step": row.get("step"),
        "mode": row.get("mode"),
        "intent_count": len(intents) if isinstance(intents, list) else 0,
        "paused": bool(diagnostics.get("paused")),
        "symbols": [str(symbol) for symbol in symbols[:25]],
        "drilldown": sanitize_public_decision_drilldown(diagnostics),
    }


def safe_public_drilldown_value(value: Any) -> Any:
    if value is None or isinstance(value, bool | int | float | str):
        return value
    if isinstance(value, list):
        safe = [safe_public_drilldown_value(item) for item in value[:10]]
        return [item for item in safe if item is not None]
    return None


def sanitize_public_decision_drilldown(diagnostics: dict[str, Any]) -> dict[str, Any]:
    raw = diagnostics.get("dashboard") if isinstance(diagnostics, dict) else None
    if not isinstance(raw, dict):
        return {}
    out = {}
    for key in PUBLIC_DECISION_DRILLDOWN_FIELDS:
        if key not in raw:
            continue
        value = safe_public_drilldown_value(raw.get(key))
        if value is not None:
            out[key] = value
    return out


def summarize_order_artifact(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "timestamp": row.get("timestamp"),
        "status": row.get("status"),
        "symbol": row.get("symbol"),
        "side": row.get("side"),
        "order_type": row.get("order_type"),
        "quantity": row.get("quantity"),
        "cash_quantity": row.get("cash_quantity"),
        "reason": row.get("reason"),
        "tag": row.get("tag"),
    }


def summarize_fill_artifact(row: dict[str, Any]) -> dict[str, Any]:
    return {
        "timestamp": row.get("timestamp"),
        "symbol": row.get("symbol"),
        "side": row.get("side"),
        "quantity": row.get("quantity"),
        "price": row.get("price"),
        "commission": row.get("commission"),
        "tag": row.get("tag"),
        "simulated": row.get("simulated"),
    }


def summarize_position_details(raw: Any) -> dict[str, dict[str, Any]]:
    if not isinstance(raw, dict):
        return {}
    details: dict[str, dict[str, Any]] = {}
    for symbol, value in raw.items():
        if not isinstance(value, dict):
            continue
        public = {
            field: value.get(field)
            for field in PUBLIC_POSITION_DETAIL_FIELDS
            if value.get(field) is not None
        }
        if public:
            details[str(symbol)] = public
    return details


def summarize_account_artifact(row: dict[str, Any]) -> dict[str, Any]:
    raw_position_details = row.get("position_details")
    if not isinstance(raw_position_details, dict):
        raw_position_details = row.get("position_metadata")
    return {
        "timestamp": row.get("timestamp"),
        "step": row.get("step"),
        "mode": row.get("mode"),
        "cash": row.get("cash"),
        "equity": row.get("equity"),
        "gross_exposure": row.get("gross_exposure"),
        "net_exposure": row.get("net_exposure"),
        "positions": row.get("positions") if isinstance(row.get("positions"), dict) else {},
        "position_values": row.get("position_values") if isinstance(row.get("position_values"), dict) else {},
        "average_costs": row.get("average_costs") if isinstance(row.get("average_costs"), dict) else {},
        "unrealized_pnl_by_symbol": row.get("unrealized_pnl_by_symbol") if isinstance(row.get("unrealized_pnl_by_symbol"), dict) else {},
        "position_details": summarize_position_details(raw_position_details),
        "realized_pnl": row.get("realized_pnl"),
        "unrealized_pnl": row.get("unrealized_pnl"),
        "total_pnl": row.get("total_pnl"),
        "total_commission": row.get("total_commission"),
        "total_borrow_fees": row.get("total_borrow_fees"),
        "borrow_fee_accrued": row.get("borrow_fee_accrued"),
        "borrow_fee_accrued_by_symbol": row.get("borrow_fee_accrued_by_symbol") if isinstance(row.get("borrow_fee_accrued_by_symbol"), dict) else {},
    }


def performance_from_account(rows: list[dict[str, Any]], summary: dict[str, Any] | None) -> dict[str, Any]:
    summary = summary or {}
    timestamps = []
    for row in rows:
        raw = row.get("timestamp")
        if not raw:
            continue
        try:
            parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
        except ValueError:
            continue
        if parsed.tzinfo is None:
            parsed = parsed.replace(tzinfo=timezone.utc)
        timestamps.append(parsed.astimezone(timezone.utc))
    equity_values = [finite_float(row.get("equity")) for row in rows]
    equity_values = [value for value in equity_values if value is not None]
    gross_values = [finite_float(row.get("gross_exposure")) for row in rows]
    gross_values = [value for value in gross_values if value is not None]
    net_values = [finite_float(row.get("net_exposure")) for row in rows]
    net_values = [value for value in net_values if value is not None]
    max_gross_exposure = max(gross_values) if gross_values else None
    max_abs_net_exposure = max((abs(value) for value in net_values), default=None)
    max_position_count = 0
    for row in rows:
        positions = row.get("positions")
        if isinstance(positions, dict):
            count = sum(1 for value in positions.values() if finite_float(value) not in (None, 0.0))
            max_position_count = max(max_position_count, count)
    latest_accounting = rows[-1] if rows else {}
    if equity_values:
        initial_equity = equity_values[0]
        final_equity = equity_values[-1]
        total_return = (final_equity / initial_equity) - 1.0 if initial_equity else None
        total_return_pct = total_return * 100.0 if total_return is not None else None
        peak = initial_equity
        max_drawdown = 0.0
        for value in equity_values:
            peak = max(peak, value)
            if peak > 0:
                max_drawdown = min(max_drawdown, (value / peak - 1.0) * 100.0)
    else:
        initial_equity = summary.get("initial_equity")
        final_equity = summary.get("final_equity")
        total_return = None
        total_return_pct = summary.get("total_return_pct")
        max_drawdown = summary.get("max_drawdown_pct")
    elapsed_seconds = None
    elapsed_days = None
    return_per_day_pct = None
    return_per_month_pct = None
    return_per_year_pct = None
    if len(timestamps) >= 2:
        elapsed_seconds = finite_float((timestamps[-1] - timestamps[0]).total_seconds())
        if elapsed_seconds is not None and elapsed_seconds > 0:
            elapsed_days = elapsed_seconds / 86400.0
            if equity_values and initial_equity and final_equity and initial_equity > 0 and final_equity > 0:
                ratio = final_equity / initial_equity
                return_per_day_pct = finite_float((ratio ** (1.0 / elapsed_days) - 1.0) * 100.0)
                return_per_month_pct = finite_float((ratio ** (30.4375 / elapsed_days) - 1.0) * 100.0)
                return_per_year_pct = finite_float((ratio ** (365.25 / elapsed_days) - 1.0) * 100.0)
    return {
        "account_snapshot_count": summary.get("account_snapshot_count", len(rows)),
        "initial_equity": summary.get("initial_equity", initial_equity),
        "final_equity": summary.get("final_equity", final_equity),
        "total_return_pct": summary.get("total_return_pct", finite_float(total_return_pct)),
        "max_drawdown_pct": summary.get("max_drawdown_pct", finite_float(max_drawdown)),
        "account_start_time": summary.get("account_start_time", timestamps[0].isoformat() if timestamps else None),
        "account_end_time": summary.get("account_end_time", timestamps[-1].isoformat() if timestamps else None),
        "elapsed_seconds": summary.get("elapsed_seconds", elapsed_seconds),
        "elapsed_days": summary.get("elapsed_days", elapsed_days),
        "return_per_day_pct": summary.get("return_per_day_pct", return_per_day_pct),
        "return_per_month_pct": summary.get("return_per_month_pct", return_per_month_pct),
        "return_per_year_pct": summary.get("return_per_year_pct", return_per_year_pct),
        "short_horizon_projection": summary.get(
            "short_horizon_projection",
            bool(elapsed_days is not None and elapsed_days < 30.0),
        ),
        "max_gross_exposure": summary.get("max_gross_exposure", finite_float(max_gross_exposure)),
        "max_gross_exposure_pct": summary.get(
            "max_gross_exposure_pct",
            finite_float((max_gross_exposure / initial_equity) * 100.0)
            if initial_equity and max_gross_exposure is not None
            else None,
        ),
        "max_abs_net_exposure": summary.get("max_abs_net_exposure", finite_float(max_abs_net_exposure)),
        "max_abs_net_exposure_pct": summary.get(
            "max_abs_net_exposure_pct",
            finite_float((max_abs_net_exposure / initial_equity) * 100.0)
            if initial_equity and max_abs_net_exposure is not None
            else None,
        ),
        "max_position_count": summary.get("max_position_count", max_position_count),
        "realized_pnl": summary.get("realized_pnl", finite_float(latest_accounting.get("realized_pnl"))),
        "unrealized_pnl": summary.get("unrealized_pnl", finite_float(latest_accounting.get("unrealized_pnl"))),
        "total_pnl": summary.get("total_pnl", finite_float(latest_accounting.get("total_pnl"))),
        "total_commission": summary.get("total_commission", finite_float(latest_accounting.get("total_commission"))),
        "total_borrow_fees": summary.get("total_borrow_fees", finite_float(latest_accounting.get("total_borrow_fees"))),
    }


def parse_artifact_timestamp(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def artifact_utc_day(row: dict[str, Any]) -> str | None:
    parsed = parse_artifact_timestamp(row.get("timestamp"))
    return parsed.date().isoformat() if parsed else None


def count_artifact_rows_by_day(rows: list[dict[str, Any]], *, rejected_only: bool = False) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        if rejected_only:
            status = str(row.get("status") or "").lower()
            if status not in {"rejected", "reject", "cancelled", "canceled"} and not row.get("reason"):
                continue
        day = artifact_utc_day(row)
        if not day:
            continue
        counts[day] = counts.get(day, 0) + 1
    return counts


def archived_artifact_path_for_record(state_dir: Path, record: dict[str, Any]) -> Path | None:
    artifact_path = record.get("artifact_path")
    if artifact_path:
        path = Path(str(artifact_path)).resolve()
    else:
        run_id = str(record.get("run_id") or "").strip()
        if not run_id:
            return None
        path = config_draft_run_artifact_dir(state_dir, run_id)
    root = config_draft_run_artifacts_root(state_dir).resolve()
    if not path.is_relative_to(root):
        raise ValueError("run artifact path is invalid")
    return path


def daily_rollups_for_run_record(
    state_dir: Path,
    record: dict[str, Any],
    *,
    artifact_limit: int,
) -> tuple[list[dict[str, Any]], list[dict[str, Any]]]:
    errors = []
    try:
        path = archived_artifact_path_for_record(state_dir, record)
    except ValueError as exc:
        return [], [{"run_id": record.get("run_id"), "error": str(exc)}]
    if path is None or not path.exists() or not path.is_dir():
        return [], []
    summary = read_json_file(path / "summary.json") or {}
    account_rows = read_jsonl_tail(path / "account.jsonl", limit=artifact_limit)
    fills = read_jsonl_tail(path / "fills.jsonl", limit=artifact_limit)
    orders = read_jsonl_tail(path / "orders.jsonl", limit=artifact_limit)
    by_day: dict[str, list[tuple[datetime, dict[str, Any]]]] = {}
    for row in account_rows:
        parsed = parse_artifact_timestamp(row.get("timestamp"))
        equity = finite_float(row.get("equity"))
        if parsed is None or equity is None:
            continue
        by_day.setdefault(parsed.date().isoformat(), []).append((parsed, row))
    fill_counts = count_artifact_rows_by_day(fills)
    order_counts = count_artifact_rows_by_day(orders)
    rejection_counts = count_artifact_rows_by_day(orders, rejected_only=True)
    rollups = []
    for day, rows in sorted(by_day.items(), reverse=True):
        ordered = sorted(rows, key=lambda item: item[0])
        start_row = ordered[0][1]
        end_row = ordered[-1][1]
        start_equity = finite_float(start_row.get("equity"))
        end_equity = finite_float(end_row.get("equity"))
        daily_return_pct = (
            ((end_equity / start_equity) - 1.0) * 100.0
            if start_equity and end_equity is not None
            else None
        )
        gross_values = [finite_float(row.get("gross_exposure")) for _parsed, row in ordered]
        gross_values = [value for value in gross_values if value is not None]
        max_gross = max(gross_values) if gross_values else None
        rollups.append({
            "day": day,
            "run_id": record.get("run_id"),
            "draft_id": record.get("draft_id"),
            "action": record.get("action"),
            "status": record.get("status"),
            "mode": summary.get("mode") or end_row.get("mode"),
            "artifact_path": str(path),
            "snapshot_count": len(ordered),
            "account_start_time": ordered[0][0].isoformat(),
            "account_end_time": ordered[-1][0].isoformat(),
            "start_equity": start_equity,
            "end_equity": end_equity,
            "daily_return_pct": finite_float(daily_return_pct),
            "fill_count": fill_counts.get(day, 0),
            "order_count": order_counts.get(day, 0),
            "rejection_count": rejection_counts.get(day, 0),
            "max_gross_exposure": finite_float(max_gross),
            "max_gross_exposure_pct": (
                finite_float((max_gross / start_equity) * 100.0)
                if start_equity and max_gross is not None
                else None
            ),
        })
    return rollups, errors


def build_config_draft_daily_rollups(
    state_dir: Path,
    *,
    limit: int = 100,
    run_limit: int = 100,
    artifact_limit: int = 5000,
) -> dict[str, Any]:
    runs_payload = list_config_draft_runs(state_dir, limit=run_limit)
    rows = []
    errors = []
    for record in runs_payload["runs"]:
        run_rows, run_errors = daily_rollups_for_run_record(state_dir, record, artifact_limit=artifact_limit)
        rows.extend(run_rows)
        errors.extend(run_errors)
    rows = sorted(
        rows,
        key=lambda row: (str(row.get("day") or ""), str(row.get("account_end_time") or ""), str(row.get("run_id") or "")),
        reverse=True,
    )
    return {
        "generated_at": utc_now(),
        "rollups": rows[:limit],
        "period_rollups": build_period_rollups_from_daily_rows(rows),
        "count": min(len(rows), limit),
        "total": len(rows),
        "limit": limit,
        "run_limit": run_limit,
        "artifact_limit": artifact_limit,
        "error_count": len(errors),
        "errors": errors[:25],
    }


def build_period_rollups_from_daily_rows(rows: list[dict[str, Any]]) -> dict[str, list[dict[str, Any]]]:
    grouped: dict[str, dict[str, list[dict[str, Any]]]] = {"month": {}, "year": {}}
    for row in rows:
        day = str(row.get("day") or "")
        if len(day) >= 7:
            grouped["month"].setdefault(day[:7], []).append(row)
        if len(day) >= 4:
            grouped["year"].setdefault(day[:4], []).append(row)

    out: dict[str, list[dict[str, Any]]] = {}
    for period, buckets in grouped.items():
        period_rows = []
        for label, bucket in buckets.items():
            ordered = sorted(bucket, key=lambda item: str(item.get("account_start_time") or item.get("day") or ""))
            start_equity = finite_float(ordered[0].get("start_equity")) if ordered else None
            end_equity = finite_float(ordered[-1].get("end_equity")) if ordered else None
            total_return_pct = (
                ((end_equity / start_equity) - 1.0) * 100.0
                if start_equity and end_equity is not None
                else None
            )
            max_exposure_pct = max(
                (
                    value
                    for value in (finite_float(item.get("max_gross_exposure_pct")) for item in ordered)
                    if value is not None
                ),
                default=None,
            )
            period_rows.append({
                "period": period,
                "label": label,
                "day_count": len({str(item.get("day")) for item in ordered if item.get("day")}),
                "run_count": len({str(item.get("run_id")) for item in ordered if item.get("run_id")}),
                "node_count": len({str(item.get("node_id")) for item in ordered if item.get("node_id")}),
                "start_equity": start_equity,
                "end_equity": end_equity,
                "total_return_pct": finite_float(total_return_pct),
                "snapshot_count": sum(int(item.get("snapshot_count") or 0) for item in ordered),
                "order_count": sum(int(item.get("order_count") or 0) for item in ordered),
                "fill_count": sum(int(item.get("fill_count") or 0) for item in ordered),
                "rejection_count": sum(int(item.get("rejection_count") or 0) for item in ordered),
                "max_gross_exposure_pct": finite_float(max_exposure_pct),
                "first_day": ordered[0].get("day") if ordered else None,
                "last_day": ordered[-1].get("day") if ordered else None,
            })
        out[period] = sorted(period_rows, key=lambda item: str(item.get("label") or ""), reverse=True)
    return out


def load_config_draft_artifacts(
    state_dir: Path,
    draft_id: str,
    *,
    data_roots: list[Path],
    plugins: list[dict[str, Any]] | None = None,
    limit: int = 100,
) -> dict[str, Any]:
    path = config_draft_path(state_dir, draft_id)
    config = read_yaml_mapping(path)
    errors = validate_workbench_draft_config(
        config,
        config_path=path,
        data_roots=data_roots,
        action="replay",
        plugins=plugins,
    )
    if errors:
        raise ValueError("; ".join(errors))
    output_dir = safe_workbench_output_dir(config)
    summary = read_json_file(output_dir / "summary.json")
    decisions_raw = read_jsonl_tail(output_dir / "decisions.jsonl", limit=limit)
    orders_raw = read_jsonl_tail(output_dir / "orders.jsonl", limit=limit)
    fills_raw = read_jsonl_tail(output_dir / "fills.jsonl", limit=limit)
    account_raw = read_jsonl_tail(output_dir / "account.jsonl", limit=limit)
    return {
        "draft_id": path.stem,
        "output_dir": output_dir.relative_to(ROOT).as_posix() if output_dir.is_relative_to(ROOT) else str(output_dir),
        "summary": summary,
        "performance": performance_from_account(account_raw, summary),
        "counts": {
            "decisions": len(decisions_raw),
            "orders": len(orders_raw),
            "fills": len(fills_raw),
            "account": len(account_raw),
        },
        "decisions": [summarize_decision_artifact(row) for row in decisions_raw],
        "orders": [summarize_order_artifact(row) for row in orders_raw],
        "fills": [summarize_fill_artifact(row) for row in fills_raw],
        "account": [summarize_account_artifact(row) for row in account_raw],
        "limit": limit,
    }


def archive_config_draft_run_artifacts(state_dir: Path, run_id: str, output_dir: Path) -> str | None:
    if not output_dir.exists() or not output_dir.is_dir():
        return None
    dest = config_draft_run_artifact_dir(state_dir, run_id)
    dest.mkdir(parents=True, exist_ok=True)
    copied = False
    for name in RUN_ARTIFACT_FILES:
        src = output_dir / name
        if src.exists() and src.is_file():
            shutil.copy2(src, dest / name)
            copied = True
    return str(dest) if copied else None


def load_config_draft_run_artifacts(
    state_dir: Path,
    run_id: str,
    *,
    limit: int = 100,
) -> dict[str, Any]:
    record = find_config_draft_run(state_dir, run_id)
    artifact_path = record.get("artifact_path")
    if artifact_path:
        path = Path(str(artifact_path)).resolve()
    else:
        path = config_draft_run_artifact_dir(state_dir, run_id)
    root = config_draft_run_artifacts_root(state_dir).resolve()
    if not path.is_relative_to(root):
        raise ValueError("run artifact path is invalid")
    if not path.exists() or not path.is_dir():
        raise ValueError(f"run artifacts not found: {record.get('run_id')}")
    summary = read_json_file(path / "summary.json")
    decisions_raw = read_jsonl_tail(path / "decisions.jsonl", limit=limit)
    orders_raw = read_jsonl_tail(path / "orders.jsonl", limit=limit)
    fills_raw = read_jsonl_tail(path / "fills.jsonl", limit=limit)
    account_raw = read_jsonl_tail(path / "account.jsonl", limit=limit)
    return {
        "run_id": record.get("run_id"),
        "draft_id": record.get("draft_id"),
        "action": record.get("action"),
        "status": record.get("status"),
        "output_dir": record.get("summary", {}).get("output_dir") if isinstance(record.get("summary"), dict) else None,
        "artifact_path": str(path),
        "summary": summary,
        "performance": performance_from_account(account_raw, summary),
        "counts": {
            "decisions": len(decisions_raw),
            "orders": len(orders_raw),
            "fills": len(fills_raw),
            "account": len(account_raw),
        },
        "decisions": [summarize_decision_artifact(row) for row in decisions_raw],
        "orders": [summarize_order_artifact(row) for row in orders_raw],
        "fills": [summarize_fill_artifact(row) for row in fills_raw],
        "account": [summarize_account_artifact(row) for row in account_raw],
        "limit": limit,
    }


def run_config_draft(
    payload: dict[str, Any],
    *,
    state_dir: Path,
    data_roots: list[Path],
    plugins: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    draft_id = str(payload.get("draft_id") or "").strip()
    if not draft_id:
        raise ValueError("draft_id is required")
    action = str(payload.get("action") or "validate").replace("-", "_").lower()
    if action not in CONFIG_DRAFT_RUN_ACTIONS:
        raise ValueError(f"action must be one of {', '.join(CONFIG_DRAFT_RUN_ACTIONS)}")
    max_steps = bounded_positive_int(payload, "max_steps", default=100, maximum=MAX_DRAFT_RUN_STEPS)
    timeout_seconds = bounded_positive_int(
        payload,
        "timeout_seconds",
        default=30,
        maximum=MAX_DRAFT_RUN_TIMEOUT_SECONDS,
    )
    path = config_draft_path(state_dir, draft_id)
    config = read_yaml_mapping(path)
    errors = validate_workbench_draft_config(
        config,
        config_path=path,
        data_roots=data_roots,
        action=action,
        plugins=plugins,
    )
    if errors:
        raise ValueError("; ".join(errors))

    command = [sys.executable, "live/plugin_runner.py", "--config", str(path)]
    if action == "validate":
        command.append("--validate-only")
    else:
        command.extend(["--mode", action.replace("_", "-"), "--max-steps", str(max_steps)])

    started = time.monotonic()
    started_at = utc_now()
    run_id = f"draft-{int(datetime.now(timezone.utc).timestamp() * 1000000)}"
    status = "completed"
    returncode: int | None = None
    stdout = ""
    stderr = ""
    try:
        completed = subprocess.run(
            command,
            cwd=ROOT,
            check=False,
            capture_output=True,
            text=True,
            timeout=timeout_seconds,
        )
        returncode = completed.returncode
        stdout = completed.stdout
        stderr = completed.stderr
        if completed.returncode != 0:
            status = "failed"
    except subprocess.TimeoutExpired as exc:
        status = "timeout"
        stdout = tail_text(exc.stdout)
        stderr = tail_text(exc.stderr)

    duration_seconds = round(time.monotonic() - started, 3)
    summary = (
        run_summary_for_config(config)
        if action != "validate" and status == "completed" and returncode == 0
        else None
    )
    artifact_path = None
    if summary is not None:
        artifact_path = archive_config_draft_run_artifacts(
            state_dir,
            run_id,
            safe_workbench_output_dir(config),
        )
    record = {
        "run_id": run_id,
        "draft_id": path.stem,
        "action": action,
        "status": status,
        "returncode": returncode,
        "started_at": started_at,
        "finished_at": utc_now(),
        "duration_seconds": duration_seconds,
        "command": command,
        "stdout_tail": tail_text(stdout),
        "stderr_tail": tail_text(stderr),
        "artifact_path": artifact_path,
        "summary": summary,
    }
    append_config_draft_run(state_dir, record)
    return record


def read_json_body(handler: BaseHTTPRequestHandler, *, max_bytes: int = 1_000_000) -> dict[str, Any] | None:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0 or length > max_bytes:
        json_response(handler, 400, {"error": "invalid content length"})
        return None
    try:
        payload = json.loads(handler.rfile.read(length).decode("utf-8"))
    except json.JSONDecodeError as exc:
        json_response(handler, 400, {"error": str(exc)})
        return None
    if not isinstance(payload, dict):
        json_response(handler, 400, {"error": "payload must be a JSON object"})
        return None
    return payload


def save_status(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    state_dir.mkdir(parents=True, exist_ok=True)
    stored = dict(payload)
    stored["received_at"] = utc_now()
    with (state_dir / "latest_status.json").open("w") as f:
        json.dump(stored, f, indent=2, sort_keys=True)
        f.write("\n")
    with status_history_path(state_dir).open("a") as f:
        f.write(json.dumps(stored, sort_keys=True) + "\n")
    return stored


def commands_path(state_dir: Path) -> Path:
    return state_dir / "commands.json"


def results_path(state_dir: Path) -> Path:
    return state_dir / "command_results.jsonl"


def command_audit_path(state_dir: Path) -> Path:
    return state_dir / "command_audit.jsonl"


def command_rate_limit_path(state_dir: Path) -> Path:
    return state_dir / "command_rate_limits.json"


def normalize_command_scope_policy(
    raw: dict[str, Any] | None,
    *,
    default_allowed_action_classes: Iterable[str] | None = None,
    default_allowed_actions: Iterable[str] | None = None,
) -> dict[str, Any]:
    default_classes = tuple(default_allowed_action_classes or DEFAULT_COMMAND_SCOPE_POLICY["allowed_action_classes"])
    default_actions = tuple(default_allowed_actions or DEFAULT_COMMAND_SCOPE_POLICY["allowed_actions"])
    policy = {
        "enabled": DEFAULT_COMMAND_SCOPE_POLICY["enabled"],
        "allowed_action_classes": set(default_classes),
        "allowed_actions": set(default_actions),
    }
    if not raw:
        return policy
    if raw.get("enabled") is not None:
        policy["enabled"] = bool(raw.get("enabled"))
    if raw.get("allowed_action_classes") is not None:
        classes = raw["allowed_action_classes"]
        if not isinstance(classes, (list, tuple, set)):
            raise ValueError("dashboard.command_scopes.allowed_action_classes must be a list")
        policy["allowed_action_classes"] = {str(item).strip() for item in classes if str(item).strip()}
    if raw.get("allowed_actions") is not None:
        actions = raw["allowed_actions"]
        if not isinstance(actions, (list, tuple, set)):
            raise ValueError("dashboard.command_scopes.allowed_actions must be a list")
        normalized_actions = {str(action).strip() for action in actions if str(action).strip()}
        unknown = sorted(action for action in normalized_actions if action not in ALLOWED_COMMAND_ACTIONS)
        if unknown:
            raise ValueError(f"dashboard.command_scopes.allowed_actions contains unsupported actions: {', '.join(unknown)}")
        policy["allowed_actions"] = normalized_actions
    return policy


def command_action_class(action: str) -> str:
    return COMMAND_ACTION_CLASSES.get(action, "unknown")


def command_scope_error(action: str, policy: dict[str, Any]) -> str | None:
    if policy.get("enabled") is False:
        return None
    allowed_actions = set(policy.get("allowed_actions") or [])
    if action in allowed_actions:
        return None
    action_class = command_action_class(action)
    allowed_classes = set(policy.get("allowed_action_classes") or [])
    if action_class in allowed_classes:
        return None
    return f"command action is outside server scope: {action} ({action_class})"


def normalize_auth_token_configs(raw: list[Any] | None) -> list[dict[str, Any]]:
    if raw is None:
        return []
    if not isinstance(raw, list):
        raise ValueError("dashboard.auth_tokens must be a list")
    tokens: list[dict[str, Any]] = []
    for index, item in enumerate(raw):
        if not isinstance(item, dict):
            raise ValueError(f"dashboard.auth_tokens[{index}] must be a mapping")
        token_env = str(item.get("token_env") or "").strip()
        if not token_env:
            raise ValueError(f"dashboard.auth_tokens[{index}].token_env is required")
        scope_raw: dict[str, Any] = {}
        if item.get("command_scopes") is not None:
            if not isinstance(item["command_scopes"], dict):
                raise ValueError(f"dashboard.auth_tokens[{index}].command_scopes must be a mapping")
            scope_raw.update(item["command_scopes"])
        if item.get("allowed_action_classes") is not None:
            scope_raw["allowed_action_classes"] = item["allowed_action_classes"]
        if item.get("allowed_actions") is not None:
            scope_raw["allowed_actions"] = item["allowed_actions"]
        if item.get("enabled") is not None:
            scope_raw["enabled"] = item["enabled"]
        tokens.append({
            "token_env": token_env,
            "role": str(item.get("role") or token_env).strip(),
            "command_scopes": normalize_command_scope_policy(
                scope_raw,
                default_allowed_action_classes=("read_only",),
                default_allowed_actions=(),
            ),
        })
    return tokens


def normalize_network_access_config(raw: dict[str, Any] | None) -> dict[str, Any]:
    config = {
        "enabled": False,
        "allowed_client_networks": [],
        "trust_x_forwarded_for": False,
    }
    if not raw:
        return config
    if raw.get("enabled") is not None:
        config["enabled"] = bool(raw.get("enabled"))
    if raw.get("trust_x_forwarded_for") is not None:
        config["trust_x_forwarded_for"] = bool(raw.get("trust_x_forwarded_for"))
    if raw.get("allowed_client_networks") is not None:
        networks = raw["allowed_client_networks"]
        if not isinstance(networks, list):
            raise ValueError("dashboard.network_access.allowed_client_networks must be a list")
        parsed = []
        for item in networks:
            value = str(item).strip()
            if not value:
                continue
            try:
                parsed.append(ipaddress.ip_network(value, strict=False))
            except ValueError as exc:
                raise ValueError(f"invalid dashboard.network_access.allowed_client_networks entry: {value}") from exc
        config["allowed_client_networks"] = parsed
    return config


def display_network_access_config(config: dict[str, Any]) -> dict[str, Any]:
    return {
        "enabled": bool(config.get("enabled")),
        "allowed_client_networks": [str(item) for item in config.get("allowed_client_networks") or []],
        "trust_x_forwarded_for": bool(config.get("trust_x_forwarded_for")),
    }


def load_commands(state_dir: Path) -> list[dict[str, Any]]:
    path = commands_path(state_dir)
    if not path.exists():
        return []
    with path.open() as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def save_commands(state_dir: Path, commands: list[dict[str, Any]]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    with commands_path(state_dir).open("w") as f:
        json.dump(commands, f, indent=2, sort_keys=True)
        f.write("\n")


def sanitized_command_audit_payload(payload: dict[str, Any]) -> dict[str, Any]:
    params = payload.get("params") if isinstance(payload.get("params"), dict) else {}
    action = str(payload.get("action") or "")
    return {
        "command_id": str(payload.get("command_id") or ""),
        "node_id": str(payload.get("node_id") or ""),
        "action": action,
        "action_class": str(payload.get("action_class") or command_action_class(action)),
        "status": str(payload.get("status") or ""),
        "param_keys": sorted(str(key) for key in params),
    }


def append_command_audit(state_dir: Path, record: dict[str, Any], *, signature_env: str | None = None) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    payload = {
        "audited_at": utc_now(),
        **record,
    }
    path = command_audit_path(state_dir)
    payload["hash_algorithm"] = "sha256"
    payload["prev_hash"] = latest_command_audit_hash(path)
    payload["record_hash"] = command_audit_record_hash(payload)
    if signature_env:
        payload["signature_algorithm"] = "hmac-sha256"
        payload["signature_key_env"] = signature_env
        payload["row_signature"] = command_audit_signature(payload, signature_env)
    with path.open("a") as f:
        f.write(json.dumps(payload, sort_keys=True) + "\n")


def command_audit_hash_payload(payload: dict[str, Any]) -> str:
    stripped = {
        key: value
        for key, value in payload.items()
        if key not in {"record_hash", "row_signature", "signature_algorithm", "signature_key_env"}
    }
    return json.dumps(stripped, sort_keys=True, separators=(",", ":"), default=str)


def command_audit_record_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(command_audit_hash_payload(payload).encode("utf-8")).hexdigest()


def command_audit_signature_payload(payload: dict[str, Any]) -> str:
    signed = {
        "record_hash": str(payload.get("record_hash") or ""),
        "hash_algorithm": str(payload.get("hash_algorithm") or ""),
        "prev_hash": str(payload.get("prev_hash") or ""),
        "audited_at": str(payload.get("audited_at") or ""),
        "event": str(payload.get("event") or ""),
        "node_id": str(payload.get("node_id") or ""),
        "command_id": str(payload.get("command_id") or ""),
        "action": str(payload.get("action") or ""),
        "status": str(payload.get("status") or ""),
    }
    return json.dumps(signed, sort_keys=True, separators=(",", ":"), default=str)


def command_audit_signature(payload: dict[str, Any], signature_env: str) -> str:
    signing_material = os.getenv(signature_env)
    if not signing_material:
        return ""
    return hmac.new(
        signing_material.encode("utf-8"),
        command_audit_signature_payload(payload).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def latest_command_audit_hash(path: Path) -> str:
    if not path.exists():
        return ""
    latest = ""
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if isinstance(row, dict) and row.get("record_hash"):
                latest = str(row["record_hash"])
    return latest


def verify_command_audit(state_dir: Path, *, signature_env: str | None = None) -> dict[str, Any]:
    path = command_audit_path(state_dir)
    if not path.exists():
        return {
            "status": "empty",
            "checked_records": 0,
            "legacy_records": 0,
            "line_count": 0,
            "latest_hash": "",
            "signature_status": "disabled" if not signature_env else "empty",
            "signed_records": 0,
            "unsigned_records": 0,
            "signature_key_env": signature_env or "",
            "errors": [],
        }
    expected_prev = ""
    checked_records = 0
    legacy_records = 0
    line_count = 0
    latest_hash = ""
    signed_records = 0
    unsigned_records = 0
    errors: list[dict[str, Any]] = []
    signature_secret_available = bool(signature_env and os.getenv(signature_env))
    with path.open() as f:
        for line_no, line in enumerate(f, start=1):
            if not line.strip():
                continue
            line_count += 1
            try:
                row = json.loads(line)
            except json.JSONDecodeError as exc:
                errors.append({"line": line_no, "error": f"invalid JSON: {exc}"})
                continue
            if not isinstance(row, dict):
                errors.append({"line": line_no, "error": "audit row is not an object"})
                continue
            record_hash = str(row.get("record_hash") or "")
            if not record_hash:
                legacy_records += 1
                if checked_records:
                    errors.append({"line": line_no, "error": "legacy unhashed row appears after hash chain started"})
                expected_prev = ""
                continue
            algorithm = str(row.get("hash_algorithm") or "")
            if algorithm != "sha256":
                errors.append({"line": line_no, "error": f"unsupported hash algorithm: {algorithm or 'missing'}"})
            prev_hash = str(row.get("prev_hash") or "")
            if prev_hash != expected_prev:
                errors.append({
                    "line": line_no,
                    "error": "prev_hash mismatch",
                    "expected_prev_hash": expected_prev,
                    "actual_prev_hash": prev_hash,
                })
            computed_hash = command_audit_record_hash(row)
            if computed_hash != record_hash:
                errors.append({
                    "line": line_no,
                    "error": "record_hash mismatch",
                    "expected_record_hash": computed_hash,
                    "actual_record_hash": record_hash,
                })
            row_signature = str(row.get("row_signature") or "")
            if row_signature:
                signed_records += 1
                signature_algorithm = str(row.get("signature_algorithm") or "")
                if signature_algorithm != "hmac-sha256":
                    errors.append({"line": line_no, "error": f"unsupported signature algorithm: {signature_algorithm or 'missing'}"})
                if signature_env and signature_secret_available:
                    expected_signature = command_audit_signature(row, signature_env)
                    if not hmac.compare_digest(expected_signature, row_signature):
                        errors.append({
                            "line": line_no,
                            "error": "row_signature mismatch",
                            "expected_signature": expected_signature,
                            "actual_signature": row_signature,
                        })
            elif signature_env:
                unsigned_records += 1
            checked_records += 1
            latest_hash = record_hash
            expected_prev = record_hash
    if errors:
        status = "bad"
    elif legacy_records:
        status = "warn"
    elif checked_records:
        status = "ok"
    else:
        status = "empty"
    if not signature_env:
        signature_status = "disabled"
    elif not signature_secret_available:
        signature_status = "missing_key"
    elif errors:
        signature_status = "bad" if any("signature" in str(error.get("error", "")) for error in errors) else ("warn" if unsigned_records else "ok")
    elif unsigned_records:
        signature_status = "warn"
    elif signed_records:
        signature_status = "ok"
    else:
        signature_status = "empty"
    return {
        "status": status,
        "checked_records": checked_records,
        "legacy_records": legacy_records,
        "line_count": line_count,
        "latest_hash": latest_hash,
        "signature_status": signature_status,
        "signed_records": signed_records,
        "unsigned_records": unsigned_records,
        "signature_key_env": signature_env or "",
        "errors": errors[:20],
    }


def load_command_audit(state_dir: Path, *, node_id: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
    path = command_audit_path(state_dir)
    if not path.exists():
        return []
    events: deque[dict[str, Any]] = deque(maxlen=max(1, limit))
    with path.open() as f:
        for line in f:
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict):
                continue
            if node_id is not None and row.get("node_id") != node_id:
                continue
            events.append(row)
    return list(events)


COMMAND_AUDIT_EXPORT_FIELDS = (
    "audited_at",
    "event",
    "node_id",
    "command_id",
    "action",
    "action_class",
    "status",
    "param_keys",
    "error",
    "reason",
    "integrity_status",
    "signature_status",
    "checked_records",
    "legacy_records",
    "signed_records",
    "unsigned_records",
    "signature_key_env",
    "hash_algorithm",
    "prev_hash",
    "record_hash",
    "signature_algorithm",
    "row_signature",
)


def build_command_audit_csv(
    state_dir: Path,
    *,
    node_id: str = "",
    limit: int = 100,
    signature_env: str | None = None,
) -> str:
    integrity = verify_command_audit(state_dir, signature_env=signature_env)
    rows = load_command_audit(state_dir, node_id=node_id or None, limit=limit)
    shared = {
        "integrity_status": integrity.get("status"),
        "signature_status": integrity.get("signature_status"),
        "checked_records": integrity.get("checked_records"),
        "legacy_records": integrity.get("legacy_records"),
        "signed_records": integrity.get("signed_records"),
        "unsigned_records": integrity.get("unsigned_records"),
        "signature_key_env": integrity.get("signature_key_env"),
    }
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=COMMAND_AUDIT_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in rows:
        merged = {**shared, **row}
        writer.writerow({field: compact_csv_value(merged.get(field)) for field in COMMAND_AUDIT_EXPORT_FIELDS})
    return out.getvalue()


def load_command_rate_state(state_dir: Path) -> dict[str, list[float]]:
    path = command_rate_limit_path(state_dir)
    if not path.exists():
        return {}
    try:
        with path.open() as f:
            data = json.load(f)
    except (OSError, json.JSONDecodeError):
        return {}
    if not isinstance(data, dict):
        return {}
    state: dict[str, list[float]] = {}
    for key, values in data.items():
        if isinstance(values, list):
            state[str(key)] = [float(value) for value in values if isinstance(value, int | float)]
    return state


def save_command_rate_state(state_dir: Path, state: dict[str, list[float]]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    with command_rate_limit_path(state_dir).open("w") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")


def command_rate_limit_error(
    state_dir: Path,
    node_id: str,
    config: dict[str, Any],
    *,
    now_monotonic: float | None = None,
) -> str | None:
    if config.get("enabled") is False:
        return None
    if not node_id:
        return None
    window_seconds = float(config.get("window_seconds", 60.0))
    max_per_node = int(config.get("max_per_node", 30))
    if window_seconds <= 0 or max_per_node <= 0:
        return None

    now_value = time.monotonic() if now_monotonic is None else now_monotonic
    state = load_command_rate_state(state_dir)
    recent = [ts for ts in state.get(node_id, []) if now_value - ts <= window_seconds]
    if len(recent) >= max_per_node:
        state[node_id] = recent
        save_command_rate_state(state_dir, state)
        return f"command queue rate limit exceeded for {node_id}: max_per_node={max_per_node}"
    recent.append(now_value)
    state[node_id] = recent
    save_command_rate_state(state_dir, state)
    return None


def enqueue_command(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    node_id = str(payload.get("node_id") or "").strip()
    action = str(payload.get("action") or "").strip()
    if not node_id:
        raise ValueError("node_id is required")
    if action not in ALLOWED_COMMAND_ACTIONS:
        raise ValueError(f"unsupported action: {action}")
    params = payload.get("params") or {}
    if not isinstance(params, dict):
        raise ValueError("params must be a mapping")
    params = normalized_command_params(action, params)
    commands = load_commands(state_dir)
    command_id = str(payload.get("command_id") or f"cmd-{int(datetime.now(timezone.utc).timestamp() * 1000000)}")
    if any(command.get("command_id") == command_id for command in commands):
        raise ValueError(f"command_id already exists: {command_id}")
    command = {
        "command_id": command_id,
        "node_id": node_id,
        "action": action,
        "action_class": command_action_class(action),
        "params": params,
        "status": "pending",
        "created_at": utc_now(),
    }
    commands.append(command)
    save_commands(state_dir, commands)
    return command


def normalized_command_params(action: str, params: dict[str, Any]) -> dict[str, str]:
    fields = COMMAND_PARAM_FIELDS.get(action)
    if fields is None:
        raise ValueError(f"unsupported action: {action}")
    allowed = set(fields)
    extra = sorted(key for key, value in params.items() if key not in allowed and value not in (None, ""))
    if extra:
        raise ValueError(f"unsupported params for {action}: {', '.join(extra)}")
    normalized: dict[str, str] = {}
    for field in fields:
        value = str(params.get(field) or "").strip()
        if not value:
            raise ValueError(f"{field} is required for {action}")
        normalized[field] = value
    return normalized


def pending_commands(state_dir: Path, node_id: str | None = None) -> list[dict[str, Any]]:
    commands = load_commands(state_dir)
    return [
        command
        for command in commands
        if command.get("status") == "pending"
        and (node_id is None or command.get("node_id") == node_id)
    ]


def save_command_result(state_dir: Path, payload: dict[str, Any], *, signature_env: str | None = None) -> dict[str, Any]:
    command_id = str(payload.get("command_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    status = str(payload.get("status") or "").strip()
    if not command_id:
        raise ValueError("command_id is required")
    if not node_id:
        raise ValueError("node_id is required")
    if status not in {"canceled", "completed", "failed", "rejected"}:
        raise ValueError("status must be canceled, completed, failed, or rejected")
    stored = dict(payload)
    stored["received_at"] = utc_now()
    commands = load_commands(state_dir)
    for command in commands:
        if command.get("command_id") == command_id:
            command["status"] = status
            command["completed_at"] = stored["received_at"]
            break
    save_commands(state_dir, commands)
    state_dir.mkdir(parents=True, exist_ok=True)
    with results_path(state_dir).open("a") as f:
        f.write(json.dumps(stored, sort_keys=True) + "\n")
    append_command_audit(
        state_dir,
        {
            "event": "result_received",
            **sanitized_command_audit_payload(stored),
        },
        signature_env=signature_env,
    )
    return stored


def cancel_command(state_dir: Path, payload: dict[str, Any], *, signature_env: str | None = None) -> dict[str, Any]:
    command_id = str(payload.get("command_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    if not command_id:
        raise ValueError("command_id is required")
    if not node_id:
        raise ValueError("node_id is required")

    commands = load_commands(state_dir)
    matched: dict[str, Any] | None = None
    for command in commands:
        if command.get("command_id") == command_id and command.get("node_id") == node_id:
            matched = command
            break
    if matched is None:
        raise ValueError("command not found")
    if matched.get("status") != "pending":
        raise ValueError(f"command is not pending: {matched.get('status')}")

    now = utc_now()
    matched["status"] = "canceled"
    matched["completed_at"] = now
    save_commands(state_dir, commands)
    stored = {
        "command_id": command_id,
        "node_id": node_id,
        "action": matched.get("action"),
        "status": "canceled",
        "received_at": now,
        "result": {"canceled": True},
    }
    state_dir.mkdir(parents=True, exist_ok=True)
    with results_path(state_dir).open("a") as f:
        f.write(json.dumps(stored, sort_keys=True) + "\n")
    append_command_audit(
        state_dir,
        {
            "event": "command_canceled",
            **sanitized_command_audit_payload(stored),
        },
        signature_env=signature_env,
    )
    return stored


def load_command_results(state_dir: Path, node_id: str | None = None) -> list[dict[str, Any]]:
    path = results_path(state_dir)
    if not path.exists():
        return []
    rows = []
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if isinstance(row, dict) and (node_id is None or row.get("node_id") == node_id):
                rows.append(row)
    return rows


def render_dashboard(payload: dict[str, Any] | None) -> str:
    if payload is None:
        body = "<p>No status has been received yet.</p>"
    else:
        alerts = payload.get("alerts") or []
        runs = payload.get("runs") or []
        gateway = payload.get("gateway") or {}
        alert_rows = "".join(
            f"<tr><td>{html.escape(str(a.get('level', '')))}</td><td>{html.escape(str(a.get('kind', '')))}</td><td>{html.escape(str(a.get('message', '')))}</td></tr>"
            for a in alerts
        ) or "<tr><td colspan='3'>none</td></tr>"
        run_rows = ""
        for run in runs:
            metrics = run.get("metrics") or {}
            run_rows += (
                "<tr>"
                f"<td>{html.escape(str(run.get('id', '')))}</td>"
                f"<td>{html.escape(str(run.get('status', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('mode', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('decisions', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('fills', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('rejections', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('final_equity', '')))}</td>"
                "</tr>"
            )
        if not run_rows:
            run_rows = "<tr><td colspan='7'>none</td></tr>"
        body = f"""
        <section>
          <h2>Node</h2>
          <dl>
            <dt>ID</dt><dd>{html.escape(str(payload.get('node_id', '')))}</dd>
            <dt>Status</dt><dd>{html.escape(str(payload.get('status', '')))}</dd>
            <dt>Generated</dt><dd>{html.escape(str(payload.get('generated_at', '')))}</dd>
            <dt>Received</dt><dd>{html.escape(str(payload.get('received_at', '')))}</dd>
          </dl>
        </section>
        <section>
          <h2>Gateway</h2>
          <dl>
            <dt>Enabled</dt><dd>{html.escape(str(gateway.get('enabled')))}</dd>
            <dt>Endpoint</dt><dd>{html.escape(str(gateway.get('host')))}:{html.escape(str(gateway.get('port')))}</dd>
            <dt>Reachable</dt><dd>{html.escape(str(gateway.get('reachable')))}</dd>
            <dt>Latency</dt><dd>{html.escape(str(gateway.get('latency_ms')))} ms</dd>
          </dl>
        </section>
        <section>
          <h2>Runs</h2>
          <table>
            <thead><tr><th>ID</th><th>Status</th><th>Mode</th><th>Decisions</th><th>Fills</th><th>Rejections</th><th>Final Equity</th></tr></thead>
            <tbody>{run_rows}</tbody>
          </table>
        </section>
        <section>
          <h2>Alerts</h2>
          <table>
            <thead><tr><th>Level</th><th>Kind</th><th>Message</th></tr></thead>
            <tbody>{alert_rows}</tbody>
          </table>
        </section>
        """
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trading Harness Status</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 24px; color: #17202a; background: #f7f9fb; }}
    main {{ max-width: 1120px; margin: 0 auto; }}
    section {{ margin: 18px 0; }}
    table {{ width: 100%; border-collapse: collapse; background: white; }}
    th, td {{ text-align: left; border-bottom: 1px solid #d9e2ec; padding: 8px; }}
    dl {{ display: grid; grid-template-columns: 140px 1fr; gap: 8px; background: white; padding: 12px; }}
    dt {{ font-weight: 600; }}
  </style>
</head>
<body>
  <main>
    <h1>Trading Harness Status</h1>
    {body}
  </main>
</body>
</html>
"""


class StatusHandler(BaseHTTPRequestHandler):
    state_dir = Path("paper_logs/cloud_status_server")
    auth_token_env: str | None = None
    auth_tokens: list[dict[str, Any]] = []
    network_access: dict[str, Any] = normalize_network_access_config({})
    dashboard_dir = DEFAULT_DASHBOARD_DIR
    data_roots = list(DEFAULT_DATA_ROOTS)
    fetch_manifest_roots = list(DEFAULT_FETCH_MANIFEST_ROOTS)
    command_rate_limit: dict[str, Any] = {"enabled": True, "window_seconds": 60.0, "max_per_node": 30}
    command_scopes: dict[str, Any] = normalize_command_scope_policy({})
    command_audit_signature_env: str | None = None

    def auth_token(self) -> str | None:
        if not self.auth_token_env:
            return None
        return os.getenv(self.auth_token_env)

    def client_ip_for_access_check(self) -> str:
        if self.network_access.get("trust_x_forwarded_for"):
            forwarded = str(self.headers.get("X-Forwarded-For") or "").split(",", 1)[0].strip()
            if forwarded:
                return forwarded
        return str(self.client_address[0])

    def require_network_access(self) -> bool:
        if not self.network_access.get("enabled"):
            return True
        networks = self.network_access.get("allowed_client_networks") or []
        if not networks:
            json_response(self, 403, {"error": "network access is enabled but no client networks are allowed"})
            return False
        raw_ip = self.client_ip_for_access_check()
        try:
            client_ip = ipaddress.ip_address(raw_ip)
        except ValueError:
            json_response(self, 403, {"error": f"client IP is invalid or not allowed: {raw_ip}"})
            return False
        if any(client_ip in network for network in networks):
            return True
        json_response(self, 403, {"error": f"client IP is not allowed: {raw_ip}"})
        return False

    def configured_auth_tokens(self) -> list[dict[str, Any]]:
        configs = []
        if self.auth_token_env:
            configs.append({
                "token_env": self.auth_token_env,
                "role": "server",
                "command_scopes": None,
            })
        configs.extend(self.auth_tokens)
        return configs

    def resolve_auth_context(self) -> dict[str, Any] | None:
        configs = self.configured_auth_tokens()
        if not configs:
            return {"role": "anonymous", "token_env": None, "command_scopes": None}
        available = []
        missing = []
        for config in configs:
            token_env = str(config.get("token_env") or "")
            token_value = os.getenv(token_env)
            if token_value:
                available.append((config, token_value))
            else:
                missing.append(token_env)
        if not available:
            missing_text = ", ".join(sorted(env for env in missing if env))
            json_response(self, 503, {"error": f"auth token env var is not set: {missing_text}"})
            return None
        auth_header = self.headers.get("Authorization")
        for config, token_value in available:
            if auth_header == f"Bearer {token_value}":
                return {
                    "role": str(config.get("role") or config.get("token_env") or "token"),
                    "token_env": str(config.get("token_env") or ""),
                    "command_scopes": config.get("command_scopes"),
                }
        json_response(self, 401, {"error": "unauthorized"})
        return None

    def require_auth(self) -> bool:
        context = self.resolve_auth_context()
        if context is None:
            return False
        self.auth_context = context
        return True

    def do_POST(self) -> None:
        if not self.require_network_access():
            return
        if not self.require_auth():
            return
        if self.path == "/status":
            payload = read_json_body(self)
            if payload is None:
                return
            stored = save_status(self.state_dir, payload)
            json_response(self, 200, {"ok": True, "received_at": stored["received_at"]})
            return
        if self.path == "/commands":
            payload = read_json_body(self)
            if payload is None:
                return
            node_id = str(payload.get("node_id") or "").strip() if isinstance(payload, dict) else ""
            action = str(payload.get("action") or "").strip() if isinstance(payload, dict) else ""
            auth_context = getattr(self, "auth_context", {}) or {}
            if error := command_scope_error(action, self.command_scopes):
                append_command_audit(
                    self.state_dir,
                    {
                        "event": "queue_rejected",
                        "error": error,
                        "auth_role": str(auth_context.get("role") or ""),
                        **sanitized_command_audit_payload(payload),
                    },
                    signature_env=self.command_audit_signature_env,
                )
                json_response(self, 403, {"error": error})
                return
            token_scopes = auth_context.get("command_scopes")
            if token_scopes and (error := command_scope_error(action, token_scopes)):
                append_command_audit(
                    self.state_dir,
                    {
                        "event": "queue_rejected",
                        "error": error,
                        "auth_role": str(auth_context.get("role") or ""),
                        **sanitized_command_audit_payload(payload),
                    },
                    signature_env=self.command_audit_signature_env,
                )
                json_response(self, 403, {"error": error})
                return
            if error := command_rate_limit_error(self.state_dir, node_id, self.command_rate_limit):
                append_command_audit(
                    self.state_dir,
                    {
                        "event": "queue_rejected",
                        "error": error,
                        "auth_role": str(auth_context.get("role") or ""),
                        **sanitized_command_audit_payload(payload),
                    },
                    signature_env=self.command_audit_signature_env,
                )
                json_response(self, 429, {"error": error})
                return
            try:
                command = enqueue_command(self.state_dir, payload)
            except ValueError as exc:
                append_command_audit(
                    self.state_dir,
                    {
                        "event": "queue_rejected",
                        "error": str(exc),
                        "auth_role": str(auth_context.get("role") or ""),
                        **sanitized_command_audit_payload(payload),
                    },
                    signature_env=self.command_audit_signature_env,
                )
                json_response(self, 400, {"error": str(exc)})
                return
            append_command_audit(
                self.state_dir,
                {
                    "event": "command_queued",
                    "auth_role": str(auth_context.get("role") or ""),
                    **sanitized_command_audit_payload(command),
                },
                signature_env=self.command_audit_signature_env,
            )
            json_response(self, 200, {"ok": True, "command": command})
            return
        if self.path == "/commands/cancel":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = cancel_command(self.state_dir, payload, signature_env=self.command_audit_signature_env)
            except ValueError as exc:
                append_command_audit(
                    self.state_dir,
                    {
                        "event": "cancel_rejected",
                        "error": str(exc),
                        **sanitized_command_audit_payload(payload),
                    },
                    signature_env=self.command_audit_signature_env,
                )
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "result": result})
            return
        if self.path == "/command_results":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = save_command_result(self.state_dir, payload, signature_env=self.command_audit_signature_env)
            except ValueError as exc:
                append_command_audit(
                    self.state_dir,
                    {
                        "event": "result_rejected",
                        "error": str(exc),
                        **sanitized_command_audit_payload(payload),
                    },
                    signature_env=self.command_audit_signature_env,
                )
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "result": result})
            return
        if self.path == "/config_draft":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                plugins = load_config_builder_plugins(self.plugin_registry_paths)
                result = build_config_draft(payload, state_dir=self.state_dir, data_roots=self.data_roots, plugins=plugins)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "draft": result})
            return
        if self.path == "/config_draft/delete":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = delete_config_draft(self.state_dir, payload)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "result": result})
            return
        if self.path == "/data_alignment":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = build_data_alignment(payload, data_roots=self.data_roots)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "alignment": result})
            return
        if self.path == "/data_compare":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = build_data_compare(payload, data_roots=self.data_roots)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "comparison": result})
            return
        if self.path == "/config_draft/run":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                plugins = load_config_builder_plugins(self.plugin_registry_paths)
                result = run_config_draft(payload, state_dir=self.state_dir, data_roots=self.data_roots, plugins=plugins)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "run": result})
            return
        if self.path == "/workbench_cleanup":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = run_workbench_cleanup(self.state_dir, payload)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, result)
            return
        else:
            json_response(self, 404, {"error": "not found"})
            return

    def do_GET(self) -> None:
        if not self.require_network_access():
            return
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        node_id = params.get("node_id", [None])[0]
        if parsed.path == "/status":
            if not self.require_auth():
                return
            payload = load_latest(self.state_dir)
            json_response(self, 200, payload or {})
            return
        if parsed.path == "/status_history":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            payload = load_status_history(self.state_dir, node_id=node_id, limit=limit)
            json_response(self, 200, payload)
            return
        if parsed.path == "/status_equity_rollups":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=100, maximum=500)
                history_limit = parse_int_param(params, "history_limit", default=5000, maximum=50000)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            payload = build_status_equity_rollups(self.state_dir, node_id=node_id, limit=limit, history_limit=history_limit)
            json_response(self, 200, payload)
            return
        if parsed.path == "/status_equity_rollups_export":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=100, maximum=500)
                history_limit = parse_int_param(params, "history_limit", default=5000, maximum=50000)
                csv_body = build_status_equity_rollups_csv(
                    self.state_dir,
                    node_id=node_id,
                    limit=limit,
                    history_limit=history_limit,
                )
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="status_equity_rollups.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/remote_nodes":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=100, maximum=500)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, load_remote_nodes(self.state_dir, limit=limit))
            return
        if parsed.path == "/remote_nodes_export":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=100, maximum=500)
                csv_body = build_remote_nodes_csv(self.state_dir, limit=limit)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="remote_nodes.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/remote_node_detail":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=20, maximum=100)
                detail_node_id = str(params.get("node_id", [""])[0] or "").strip()
                payload = load_remote_node_detail(self.state_dir, detail_node_id, limit=limit)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/commands":
            if not self.require_auth():
                return
            json_response(self, 200, {"commands": pending_commands(self.state_dir, node_id=node_id)})
            return
        if parsed.path == "/command_results":
            if not self.require_auth():
                return
            json_response(self, 200, {"results": load_command_results(self.state_dir, node_id=node_id)})
            return
        if parsed.path == "/command_audit":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=100, maximum=500)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(
                self,
                200,
                {
                    "events": load_command_audit(self.state_dir, node_id=node_id, limit=limit),
                    "integrity": verify_command_audit(self.state_dir, signature_env=self.command_audit_signature_env),
                },
            )
            return
        if parsed.path == "/command_audit_export":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=100, maximum=500)
                csv_body = build_command_audit_csv(
                    self.state_dir,
                    node_id=node_id,
                    limit=limit,
                    signature_env=self.command_audit_signature_env,
                )
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="command_audit.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/data_catalog":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=200, maximum=500)
                preview_points = int(params.get("preview_points", ["80"])[0])
                payload = build_data_catalog(self.data_roots, limit=limit, preview_points=preview_points)
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/data_catalog_export":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=200, maximum=500)
                csv_body = build_data_catalog_csv(self.data_roots, limit=limit)
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="saved_data_catalog.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/data_catalog_scan_export":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=200, maximum=500)
                csv_body = build_data_catalog_scan_csv(self.data_roots, limit=limit)
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="data_catalog_scan.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/data_detail":
            if not self.require_auth():
                return
            raw_path = str(params.get("path", [""])[0]).strip()
            if not raw_path:
                json_response(self, 400, {"error": "path is required"})
                return
            try:
                preview_points = int(params.get("preview_points", ["300"])[0])
                gap_limit = int(params.get("gap_limit", ["20"])[0])
                missing_interval_limit = int(params.get("missing_interval_limit", ["100"])[0])
                start = str(params.get("start", [""])[0]).strip()
                end = str(params.get("end", [""])[0]).strip()
                sample_mode = str(params.get("sample_mode", ["sampled"])[0]).strip()
                payload = build_data_detail(
                    raw_path,
                    data_roots=self.data_roots,
                    preview_points=preview_points,
                    gap_limit=gap_limit,
                    missing_interval_limit=missing_interval_limit,
                    start=start,
                    end=end,
                    sample_mode=sample_mode,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/data_missing_intervals_export":
            if not self.require_auth():
                return
            raw_path = str(params.get("path", [""])[0]).strip()
            if not raw_path:
                json_response(self, 400, {"error": "path is required"})
                return
            try:
                max_rows = parse_int_param(
                    params,
                    "max_rows",
                    default=MAX_DATA_MISSING_INTERVAL_EXPORT_ROWS,
                    maximum=MAX_DATA_MISSING_INTERVAL_EXPORT_ROWS,
                )
                csv_body, filename = data_missing_intervals_csv(
                    raw_path,
                    data_roots=self.data_roots,
                    max_rows=max_rows,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename=filename,
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/data_coverage":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=200, maximum=1000)
                max_symbols = parse_int_param(params, "max_symbols", default=60, maximum=500)
                max_dates = parse_int_param(params, "max_dates", default=60, maximum=366)
                payload = build_data_coverage(
                    self.data_roots,
                    limit=limit,
                    max_symbols=max_symbols,
                    max_dates=max_dates,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/data_coverage_export":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=200, maximum=1000)
                max_symbols = parse_int_param(params, "max_symbols", default=60, maximum=500)
                max_dates = parse_int_param(params, "max_dates", default=60, maximum=366)
                csv_body = build_data_coverage_csv(
                    self.data_roots,
                    limit=limit,
                    max_symbols=max_symbols,
                    max_dates=max_dates,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="data_coverage.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/data_gap_summary":
            if not self.require_auth():
                return
            try:
                catalog_limit = parse_int_param(params, "catalog_limit", default=200, maximum=1000)
                top_limit = parse_int_param(params, "top_limit", default=20, maximum=100)
                payload = build_data_gap_summary(
                    self.data_roots,
                    catalog_limit=catalog_limit,
                    top_limit=top_limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/data_gap_summary_export":
            if not self.require_auth():
                return
            try:
                catalog_limit = parse_int_param(params, "catalog_limit", default=200, maximum=1000)
                top_limit = parse_int_param(params, "top_limit", default=20, maximum=100)
                csv_body = build_data_gap_summary_csv(
                    self.data_roots,
                    catalog_limit=catalog_limit,
                    top_limit=top_limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="data_gap_summary.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/data_minute_heatmap":
            if not self.require_auth():
                return
            try:
                catalog_limit = parse_int_param(params, "catalog_limit", default=200, maximum=1000)
                top_limit = parse_int_param(params, "top_limit", default=20, maximum=100)
                payload = build_data_minute_heatmap(
                    self.data_roots,
                    catalog_limit=catalog_limit,
                    top_limit=top_limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/data_minute_heatmap_export":
            if not self.require_auth():
                return
            try:
                catalog_limit = parse_int_param(params, "catalog_limit", default=200, maximum=1000)
                top_limit = parse_int_param(params, "top_limit", default=20, maximum=100)
                csv_body = build_data_minute_heatmap_csv(
                    self.data_roots,
                    catalog_limit=catalog_limit,
                    top_limit=top_limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="data_minute_heatmap.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/data_symbol_diagnostic":
            if not self.require_auth():
                return
            raw_symbol = str(params.get("symbol", [""])[0]).strip()
            try:
                catalog_limit = parse_limit(params, default=200, maximum=1000)
                payload = build_data_symbol_diagnostic(
                    raw_symbol,
                    data_roots=self.data_roots,
                    fetch_manifest_roots=self.fetch_manifest_roots,
                    catalog_limit=catalog_limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/data_storage_audit":
            if not self.require_auth():
                return
            try:
                catalog_limit = parse_int_param(params, "catalog_limit", default=200, maximum=1000)
                scan_limit = parse_int_param(params, "scan_limit", default=5000, maximum=50000)
                payload = build_data_storage_audit(
                    self.data_roots,
                    catalog_limit=catalog_limit,
                    scan_limit=scan_limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/data_storage_audit_export":
            if not self.require_auth():
                return
            try:
                catalog_limit = parse_int_param(params, "catalog_limit", default=200, maximum=1000)
                scan_limit = parse_int_param(params, "scan_limit", default=5000, maximum=50000)
                csv_body = build_data_storage_audit_csv(
                    self.data_roots,
                    catalog_limit=catalog_limit,
                    scan_limit=scan_limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="data_storage_audit.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/fetch_manifests":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=50, maximum=500)
                payload = build_fetch_manifests(self.fetch_manifest_roots, limit=limit)
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/fetch_manifests_export":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=200, maximum=500)
                csv_body = build_fetch_manifests_csv(self.fetch_manifest_roots, limit=limit)
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="fetch_manifests.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/fetch_manifest_detail":
            if not self.require_auth():
                return
            job_id = str(params.get("job_id", [""])[0]).strip()
            if not job_id:
                json_response(self, 400, {"error": "job_id is required"})
                return
            try:
                limit = parse_limit(params, default=250, maximum=2000)
                payload = load_fetch_manifest_detail(
                    job_id,
                    fetch_manifest_roots=self.fetch_manifest_roots,
                    data_roots=self.data_roots,
                    limit=limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/fetch_manifest_detail_export":
            if not self.require_auth():
                return
            job_id = str(params.get("job_id", [""])[0]).strip()
            if not job_id:
                json_response(self, 400, {"error": "job_id is required"})
                return
            try:
                limit = parse_limit(params, default=2000, maximum=5000)
                csv_body = build_fetch_manifest_detail_csv(
                    job_id,
                    fetch_manifest_roots=self.fetch_manifest_roots,
                    data_roots=self.data_roots,
                    limit=limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename=f"{slugify(job_id)}_fetch_detail.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/config_options":
            if not self.require_auth():
                return
            try:
                payload = config_builder_options(self.plugin_registry_paths)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/workbench_status":
            if not self.require_auth():
                return
            json_response(self, 200, build_workbench_status(self.state_dir))
            return
        if parsed.path == "/workbench_cleanup_plan":
            if not self.require_auth():
                return
            json_response(self, 200, build_workbench_cleanup_plan(self.state_dir))
            return
        if parsed.path == "/workbench_diagnostics":
            if not self.require_auth():
                return
            payload = build_workbench_diagnostics(
                self.state_dir,
                data_roots=self.data_roots,
                dashboard_dir=self.dashboard_dir,
            )
            json_response(self, 200, payload)
            return
        if parsed.path == "/workbench_snapshot_export":
            if not self.require_auth():
                return
            payload = build_workbench_snapshot(
                self.state_dir,
                data_roots=self.data_roots,
                dashboard_dir=self.dashboard_dir,
                fetch_manifest_roots=self.fetch_manifest_roots,
                plugin_registry_paths=self.plugin_registry_paths,
            )
            download_text_response(
                self,
                200,
                json.dumps(payload, indent=2, sort_keys=True),
                filename="workbench_snapshot.json",
                content_type="application/json; charset=utf-8",
            )
            return
        if parsed.path == "/workbench_endpoints":
            if not self.require_auth():
                return
            json_response(self, 200, build_workbench_endpoints())
            return
        if parsed.path == "/config_drafts":
            if not self.require_auth():
                return
            json_response(self, 200, list_config_drafts(self.state_dir))
            return
        if parsed.path == "/config_drafts_export":
            if not self.require_auth():
                return
            try:
                plugins = load_config_builder_plugins(self.plugin_registry_paths)
                csv_body = build_config_drafts_csv(self.state_dir, data_roots=self.data_roots, plugins=plugins)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="workbench_drafts.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/config_draft_validations":
            if not self.require_auth():
                return
            try:
                plugins = load_config_builder_plugins(self.plugin_registry_paths)
                payload = build_config_draft_validations(self.state_dir, data_roots=self.data_roots, plugins=plugins)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/config_draft_detail":
            if not self.require_auth():
                return
            draft_id = str(params.get("draft_id", [""])[0]).strip()
            if not draft_id:
                json_response(self, 400, {"error": "draft_id is required"})
                return
            try:
                plugins = load_config_builder_plugins(self.plugin_registry_paths)
                payload = load_config_draft_detail(self.state_dir, draft_id, data_roots=self.data_roots, plugins=plugins)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/config_draft_yaml":
            if not self.require_auth():
                return
            draft_id = str(params.get("draft_id", [""])[0]).strip()
            if not draft_id:
                json_response(self, 400, {"error": "draft_id is required"})
                return
            try:
                plugins = load_config_builder_plugins(self.plugin_registry_paths)
                filename, yaml_body = load_config_draft_yaml(self.state_dir, draft_id, data_roots=self.data_roots, plugins=plugins)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                yaml_body,
                filename=filename,
                content_type="application/x-yaml; charset=utf-8",
            )
            return
        if parsed.path == "/config_draft_runs":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=20, maximum=100)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, list_config_draft_runs(self.state_dir, limit=limit))
            return
        if parsed.path == "/config_draft_run_comparison":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=50, maximum=200)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, build_config_draft_run_comparison(self.state_dir, limit=limit))
            return
        if parsed.path == "/config_draft_daily_rollups":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=100, maximum=500)
                run_limit = parse_int_param(params, "run_limit", default=100, maximum=500)
                artifact_limit = parse_int_param(params, "artifact_limit", default=5000, maximum=50000)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(
                self,
                200,
                build_config_draft_daily_rollups(
                    self.state_dir,
                    limit=limit,
                    run_limit=run_limit,
                    artifact_limit=artifact_limit,
                ),
            )
            return
        if parsed.path == "/config_draft_runs_export":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params, default=200, maximum=500)
                csv_body = build_config_draft_runs_csv(self.state_dir, limit=limit)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                csv_body,
                filename="workbench_runs.csv",
                content_type="text/csv; charset=utf-8",
            )
            return
        if parsed.path == "/config_draft_run_detail":
            if not self.require_auth():
                return
            run_id = str(params.get("run_id", [""])[0]).strip()
            if not run_id:
                json_response(self, 400, {"error": "run_id is required"})
                return
            try:
                payload = load_config_draft_run_detail(self.state_dir, run_id)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/config_draft_artifacts":
            if not self.require_auth():
                return
            draft_id = str(params.get("draft_id", [""])[0]).strip()
            if not draft_id:
                json_response(self, 400, {"error": "draft_id is required"})
                return
            try:
                limit = parse_limit(params, default=100, maximum=MAX_ARTIFACT_ROWS)
                payload = load_config_draft_artifacts(
                    self.state_dir,
                    draft_id,
                    data_roots=self.data_roots,
                    plugins=load_config_builder_plugins(self.plugin_registry_paths),
                    limit=limit,
                )
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/config_draft_run_artifacts":
            if not self.require_auth():
                return
            run_id = str(params.get("run_id", [""])[0]).strip()
            if not run_id:
                json_response(self, 400, {"error": "run_id is required"})
                return
            try:
                limit = parse_limit(params, default=100, maximum=MAX_ARTIFACT_ROWS)
                payload = load_config_draft_run_artifacts(self.state_dir, run_id, limit=limit)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/config_draft_run_artifacts_export":
            if not self.require_auth():
                return
            run_id = str(params.get("run_id", [""])[0]).strip()
            if not run_id:
                json_response(self, 400, {"error": "run_id is required"})
                return
            try:
                limit = parse_limit(params, default=100, maximum=MAX_ARTIFACT_ROWS)
                payload = load_config_draft_run_artifacts(self.state_dir, run_id, limit=limit)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            download_text_response(
                self,
                200,
                json.dumps(payload, indent=2, sort_keys=True),
                filename=f"{slugify(run_id)}_artifacts.json",
                content_type="application/json; charset=utf-8",
            )
            return
        if parsed.path in {"/", "/index.html"}:
            index = self.dashboard_dir / "index.html"
            if index.exists():
                file_response(self, index)
            else:
                text_response(self, 200, render_dashboard(load_latest(self.state_dir)))
            return
        if parsed.path.startswith("/dashboard/"):
            rel = Path(unquote(parsed.path.removeprefix("/dashboard/")))
            if rel.is_absolute() or ".." in rel.parts:
                json_response(self, 404, {"error": "not found"})
                return
            file_response(self, self.dashboard_dir / rel)
            return
        if parsed.path.startswith("/docs/"):
            rel = Path(unquote(parsed.path.removeprefix("/docs/")))
            if rel.is_absolute() or len(rel.parts) != 1 or ".." in rel.parts:
                json_response(self, 404, {"error": "not found"})
                return
            public_doc_response(self, rel.name)
            return
        json_response(self, 404, {"error": "not found"})

    def log_message(self, format: str, *args: Any) -> None:
        return


def create_server(
    host: str,
    port: int,
    state_dir: Path,
    *,
    auth_token_env: str | None = None,
    auth_tokens: list[dict[str, Any]] | None = None,
    network_access: dict[str, Any] | None = None,
    dashboard_dir: Path = DEFAULT_DASHBOARD_DIR,
    data_roots: list[Path] | None = None,
    fetch_manifest_roots: list[Path] | None = None,
    plugin_registry_paths: list[Path] | None = None,
    command_rate_limit: dict[str, Any] | None = None,
    command_scopes: dict[str, Any] | None = None,
    command_audit_signature_env: str | None = None,
) -> ThreadingHTTPServer:
    class Handler(StatusHandler):
        pass

    Handler.state_dir = state_dir
    Handler.auth_token_env = auth_token_env
    Handler.auth_tokens = normalize_auth_token_configs(auth_tokens)
    Handler.network_access = normalize_network_access_config(network_access)
    Handler.dashboard_dir = dashboard_dir
    Handler.data_roots = parse_data_roots(data_roots)
    Handler.fetch_manifest_roots = parse_fetch_manifest_roots(fetch_manifest_roots)
    Handler.plugin_registry_paths = parse_plugin_registry_paths(plugin_registry_paths)
    Handler.command_rate_limit = command_rate_limit or {"enabled": True, "window_seconds": 60.0, "max_per_node": 30}
    Handler.command_scopes = normalize_command_scope_policy(command_scopes)
    Handler.command_audit_signature_env = command_audit_signature_env
    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local telemetry receiver/dashboard")
    parser.add_argument("--config", type=Path, default=None, help="Optional config with a dashboard section")
    parser.add_argument("--host", default=None)
    parser.add_argument("--port", type=int, default=None)
    parser.add_argument("--state-dir", type=Path, default=None)
    parser.add_argument("--dashboard-dir", type=Path, default=None)
    parser.add_argument(
        "--data-root",
        action="append",
        type=Path,
        default=None,
        help="Local data root to scan for CSV/parquet files. Can be repeated. Defaults to examples/data.",
    )
    parser.add_argument(
        "--fetch-manifest-root",
        action="append",
        type=Path,
        default=None,
        help="Local fetch manifest root to scan for JSON fetch job manifests. Can be repeated.",
    )
    parser.add_argument(
        "--plugin-registry",
        action="append",
        type=Path,
        default=None,
        help="Ignored local plugin registry YAML to expose private plugin metadata in the Workbench. Can be repeated.",
    )
    parser.add_argument("--auth-token-env", default=None, help="Optional env var containing bearer token")
    parser.add_argument(
        "--command-audit-signature-env",
        default=None,
        help="Optional env var containing an HMAC key for signing command audit rows.",
    )
    args = parser.parse_args()
    try:
        settings = dashboard_server_settings(
            args.config,
            host=args.host,
            port=args.port,
            state_dir=args.state_dir,
            dashboard_dir=args.dashboard_dir,
            data_roots=args.data_root,
            fetch_manifest_roots=args.fetch_manifest_root,
            plugin_registry_paths=args.plugin_registry,
            auth_token_env=args.auth_token_env,
            command_audit_signature_env=args.command_audit_signature_env,
        )
    except (TypeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc

    server = create_server(
        settings["host"],
        int(settings["port"]),
        settings["state_dir"],
        auth_token_env=settings["auth_token_env"],
        auth_tokens=settings["auth_tokens"],
        network_access=settings["network_access"],
        dashboard_dir=settings["dashboard_dir"],
        data_roots=settings["data_roots"],
        fetch_manifest_roots=settings["fetch_manifest_roots"],
        plugin_registry_paths=settings["plugin_registry_paths"],
        command_rate_limit=settings["command_rate_limit"],
        command_scopes=settings["command_scopes"],
        command_audit_signature_env=settings["command_audit_signature_env"],
    )
    print(f"Serving status dashboard at http://{settings['host']}:{server.server_address[1]}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
