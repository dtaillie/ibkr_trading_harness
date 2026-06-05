#!/usr/bin/env python3
"""Tiny local receiver/dashboard for public telemetry prototypes."""

from __future__ import annotations

import argparse
import csv
import html
import io
import json
import math
import os
import mimetypes
import re
import shutil
import subprocess
import sys
import time
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, unquote, urlparse

import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from live.plugin_runner import validate_config as validate_runner_config


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

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DASHBOARD_DIR = ROOT / "web" / "dashboard"
DEFAULT_DATA_ROOTS = (ROOT / "examples" / "data",)
DEFAULT_FETCH_MANIFEST_ROOTS = (ROOT / "paper_logs" / "fetch_manifests",)
SUGGESTED_DATA_ROOTS = (
    ROOT / "cache",
    ROOT / "cache" / "ibkr",
    ROOT / "data",
    ROOT / "paper_logs" / "history",
    ROOT / "paper_logs" / "crypto_history",
)
BAR_SIZE_TOKENS = ("1min", "5min", "15min", "30min", "1h", "1d")
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
    },
)
CONFIG_BUILDER_MODES = ("replay", "shadow", "simulated_paper")
CONFIG_DRAFT_RUN_ACTIONS = ("validate", "replay", "simulated_paper")
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
WORKBENCH_OUTPUT_ROOT = ROOT / "paper_logs" / "workbench"
MAX_DRAFT_RUN_STEPS = 500
MAX_DRAFT_RUN_TIMEOUT_SECONDS = 120
MAX_ARTIFACT_ROWS = 500
MAX_DATA_DETAIL_POINTS = 1000
MAX_DATA_GAP_ROWS = 200
MAX_CONFIG_DRAFT_DATASETS = 20
OUTPUT_TAIL_BYTES = 8000
RUN_ARTIFACT_FILES = ("summary.json", "decisions.jsonl", "orders.jsonl", "fills.jsonl", "account.jsonl")
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
        "path": "/data_catalog_export",
        "category": "data",
        "description": "Download saved data catalog metadata.",
        "response": "CSV download",
    },
    {
        "method": "GET",
        "path": "/data_detail",
        "category": "data",
        "description": "Inspect one saved data file with coverage, gap, null, and price summaries.",
        "response": "JSON dataset detail",
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
        "path": "/fetch_manifest_detail",
        "category": "data",
        "description": "Inspect one historical-data fetch job manifest.",
        "response": "JSON fetch-job manifest detail",
    },
    {
        "method": "POST",
        "path": "/data_alignment",
        "category": "data",
        "description": "Preview timestamp alignment for selected saved datasets.",
        "response": "JSON alignment summary",
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


def parse_limit(params: dict[str, list[str]], *, default: int = 50, maximum: int = 500) -> int:
    raw = params.get("limit", [str(default)])[0]
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("limit must be an integer") from exc
    if value < 1 or value > maximum:
        raise ValueError(f"limit must be between 1 and {maximum}")
    return value


def parse_bool_param(params: dict[str, list[str]], key: str, *, default: bool) -> bool:
    raw = params.get(key, [str(default).lower()])[0].strip().lower()
    if raw in {"1", "true", "yes", "on"}:
        return True
    if raw in {"0", "false", "no", "off"}:
        return False
    raise ValueError(f"{key} must be true or false")


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
    auth_token_env: str | None = None,
) -> dict[str, Any]:
    settings: dict[str, Any] = {
        "host": "127.0.0.1",
        "port": 8765,
        "state_dir": Path("paper_logs/cloud_status_server"),
        "dashboard_dir": DEFAULT_DASHBOARD_DIR,
        "data_roots": None,
        "fetch_manifest_roots": None,
        "auth_token_env": None,
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
    if auth_token_env is not None:
        settings["auth_token_env"] = auth_token_env
    return settings


def data_file_candidates(data_roots: list[Path], *, limit: int) -> list[Path]:
    files: list[Path] = []
    for root in data_roots:
        if not root.exists() or not root.is_dir():
            continue
        for path in sorted(root.rglob("*")):
            if path.is_file() and path.suffix.lower() in {".csv", ".parquet"}:
                files.append(path)
                if len(files) >= limit:
                    return files
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
    if "ibkr" in lowered or "interactive" in lowered:
        return "ibkr"
    if "schwab" in lowered:
        return "schwab"
    if "polygon" in lowered:
        return "polygon"
    if "firstrate" in lowered or "first_rate" in lowered:
        return "firstrate"
    if "zerohash" in lowered:
        return "zerohash"
    if "cache" in lowered:
        return "cache"
    return "file"


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
        "asset_class": infer_asset_class(path, symbol),
        "bar_size": infer_bar_size(path, df),
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
    files = data_file_candidates(data_roots, limit=limit)
    for path in files:
        root = next((candidate for candidate in data_roots if path.is_relative_to(candidate)), path.parent)
        try:
            datasets.append(summarize_data_file(path, root=root, preview_points=preview_points))
        except Exception as exc:
            errors.append({
                "path": path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path),
                "error": str(exc),
            })
    modified_values = [str(item.get("modified_at")) for item in datasets if item.get("modified_at")]
    return {
        "roots": [root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root) for root in data_roots],
        "datasets": datasets,
        "errors": errors,
        "count": len(datasets),
        "error_count": len(errors),
        "quality_counts": count_values(datasets, "quality_status"),
        "bar_size_counts": count_values(datasets, "bar_size"),
        "asset_class_counts": count_values(datasets, "asset_class"),
        "source_counts": count_values(datasets, "source"),
        "row_count_total": sum(int(item.get("rows") or 0) for item in datasets),
        "size_bytes_total": sum(int(item.get("size_bytes") or 0) for item in datasets),
        "latest_modified_at": max(modified_values) if modified_values else None,
        "limit": limit,
        "preview_points": preview_points,
    }


DATA_CATALOG_EXPORT_FIELDS = (
    "path",
    "root",
    "symbol",
    "asset_class",
    "source",
    "bar_size",
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


def build_data_catalog_csv(data_roots: list[Path], *, limit: int = 200) -> str:
    catalog = build_data_catalog(data_roots, limit=limit, preview_points=2)
    out = io.StringIO()
    writer = csv.DictWriter(out, fieldnames=DATA_CATALOG_EXPORT_FIELDS, extrasaction="ignore")
    writer.writeheader()
    for row in catalog["datasets"]:
        writer.writerow({field: row.get(field) for field in DATA_CATALOG_EXPORT_FIELDS})
    return out.getvalue()


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


def load_fetch_manifest_detail(
    job_id: str,
    *,
    fetch_manifest_roots: list[Path],
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
    return {
        **summary,
        "schema_version": payload.get("schema_version"),
        "parameters": payload.get("parameters") if isinstance(payload.get("parameters"), dict) else {},
        "plan": payload.get("plan") if isinstance(payload.get("plan"), dict) else {},
        "counts": payload.get("counts") if isinstance(payload.get("counts"), dict) else {},
        "symbols_requested": payload.get("symbols_requested") if isinstance(payload.get("symbols_requested"), list) else [],
        "symbols": symbols,
        "outputs": outputs[-limit:],
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


def public_plugin_by_id(plugin_id: str) -> dict[str, str] | None:
    return next((plugin for plugin in CONFIG_BUILDER_PLUGINS if plugin["id"] == plugin_id), None)


def data_path_allowed(raw_path: str, data_roots: list[Path]) -> tuple[Path, str]:
    candidate = Path(raw_path)
    path = candidate if candidate.is_absolute() else ROOT / candidate
    path = path.resolve()
    if path.suffix.lower() not in {".csv", ".parquet"}:
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


def timestamp_summary_for_file(symbol: str, path: Path) -> dict[str, Any]:
    df, fmt = read_data_file(path)
    ts_col = timestamp_column(df)
    raw_ts = df[ts_col] if ts_col else (df.index if isinstance(df.index, pd.DatetimeIndex) else None)
    parsed = pd.Series([], dtype="datetime64[ns, UTC]")
    if raw_ts is not None:
        parsed = pd.Series(parse_datetime_utc(raw_ts))
    valid = parsed.dropna().drop_duplicates().sort_values()
    diffs = valid.diff().dropna().dt.total_seconds() if len(valid) > 1 else pd.Series([], dtype="float64")
    return {
        "symbol": symbol,
        "path": path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path),
        "format": fmt,
        "rows": int(len(df)),
        "timestamp_column": ts_col,
        "timestamp_count": int(len(valid)),
        "timestamp_parse_failures": int(parsed.isna().sum()) if raw_ts is not None else None,
        "first_timestamp": valid.iloc[0].isoformat() if not valid.empty else None,
        "last_timestamp": valid.iloc[-1].isoformat() if not valid.empty else None,
        "median_interval_seconds": finite_float(diffs.median()) if not diffs.empty else None,
        "_timestamps": valid,
    }


def build_data_alignment_for_files(selected: dict[str, tuple[Path, str]]) -> dict[str, Any]:
    rows = []
    warnings = []
    timestamp_sets = []
    union_values: set[pd.Timestamp] = set()
    for symbol, (path, _rel_path) in sorted(selected.items()):
        summary = timestamp_summary_for_file(symbol, path)
        timestamps = list(summary.pop("_timestamps"))
        if not summary["timestamp_column"]:
            warnings.append(f"{symbol}: no timestamp column found")
        if not timestamps:
            warnings.append(f"{symbol}: no parseable timestamps")
        elif summary["timestamp_parse_failures"]:
            warnings.append(f"{symbol}: {summary['timestamp_parse_failures']} timestamp parse failures")
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


def build_data_alignment(payload: dict[str, Any], *, data_roots: list[Path]) -> dict[str, Any]:
    selected = selected_data_files(payload.get("datasets") or [], data_roots)
    return build_data_alignment_for_files(selected)


def build_data_detail(
    raw_path: str,
    *,
    data_roots: list[Path],
    preview_points: int = 300,
    gap_limit: int = 20,
) -> dict[str, Any]:
    if preview_points < 2 or preview_points > MAX_DATA_DETAIL_POINTS:
        raise ValueError(f"preview_points must be between 2 and {MAX_DATA_DETAIL_POINTS}")
    if gap_limit < 1 or gap_limit > MAX_DATA_GAP_ROWS:
        raise ValueError(f"gap_limit must be between 1 and {MAX_DATA_GAP_ROWS}")

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

    parsed_valid = parsed_ts.dropna()
    ordered = parsed_valid.sort_values()
    diffs = ordered.diff().dropna().dt.total_seconds() if not ordered.empty else pd.Series([], dtype="float64")
    median_interval = finite_float(diffs.median()) if not diffs.empty else None
    largest_gap = finite_float(diffs.max()) if not diffs.empty else None
    gap_rows = []
    estimated_missing = 0
    if median_interval and median_interval > 0 and len(ordered) > 1:
        previous = ordered.iloc[0]
        for current in ordered.iloc[1:]:
            gap_seconds = float((current - previous).total_seconds())
            if gap_seconds > median_interval * 1.5:
                missing = max(0, round(gap_seconds / median_interval) - 1)
                estimated_missing += missing
                if len(gap_rows) < gap_limit:
                    gap_rows.append({
                        "from_timestamp": previous.isoformat(),
                        "to_timestamp": current.isoformat(),
                        "gap_seconds": finite_float(gap_seconds),
                        "estimated_missing_intervals": int(missing),
                    })
            previous = current

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
        for idx in evenly_sample_indices(len(scoped), preview_points):
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
        "asset_class": infer_asset_class(path, symbol),
        "bar_size": infer_bar_size(path, df),
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
        },
        "price_stats": price_stats,
        "return_stats": return_stats,
        "volume_stats": volume_stats,
        "gaps": gap_rows,
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


def build_config_draft(payload: dict[str, Any], *, state_dir: Path, data_roots: list[Path]) -> dict[str, Any]:
    name = slugify(str(payload.get("name") or "workbench_example"))
    plugin_id = str(payload.get("plugin_id") or "no_edge_template")
    plugin = public_plugin_by_id(plugin_id)
    if plugin is None:
        raise ValueError(f"unsupported plugin_id: {plugin_id}")
    mode = str(payload.get("mode") or "replay").replace("-", "_").lower()
    if mode not in CONFIG_BUILDER_MODES:
        raise ValueError(f"mode must be one of {', '.join(CONFIG_BUILDER_MODES)}")
    risk_preset = str(payload.get("risk_preset") or "demo_minimal").strip()
    risk_preset_ids = {preset["id"] for preset in CONFIG_BUILDER_RISK_PRESETS}
    if risk_preset not in risk_preset_ids:
        raise ValueError(f"risk_preset must be one of {', '.join(sorted(risk_preset_ids))}")

    selected = selected_data_files(payload.get("datasets") or [], data_roots)
    data_files = {symbol: rel_path for symbol, (_path, rel_path) in selected.items()}
    alignment = build_data_alignment_for_files(selected)

    starting_cash = number_field(payload, "starting_cash", 10000)
    history_bars = number_field(payload, "history_bars", 100, integer=True)
    max_steps = number_field(payload, "max_steps", 100, integer=True)
    max_orders = number_field(payload, "max_orders_per_run", 1, integer=True)
    max_notional = number_field(payload, "max_notional_per_order", 100)
    max_quantity = number_field(payload, "max_quantity", 10)
    max_cash_quantity = number_field(payload, "max_cash_quantity", 100)
    max_gross_exposure_pct = number_field(payload, "max_gross_exposure_pct", 0.05)

    config = {
        "description": (
            "GENERATED EXAMPLE ONLY. Public workbench draft using a no-edge "
            "strategy plugin. This demonstrates wiring and validation only."
        ),
        "metadata": {
            "strategy_plugin": plugin["spec"],
            "status": plugin["status"],
            "risk_preset": risk_preset,
        },
        "strategy": {
            "example_parameter": True,
        },
        "runner": {
            "mode": mode,
            "starting_cash": starting_cash,
            "history_bars": history_bars,
            "max_steps": max_steps,
            "output_dir": f"paper_logs/workbench/{name}",
            "clean_output_dir": True,
        },
        "data": {
            "source": "files",
            "timestamp_column": str(payload.get("timestamp_column") or "timestamp"),
            "files": data_files,
        },
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
        },
        "broker": {
            "host": "127.0.0.1",
            "port": 4002,
            "client_id": 301,
        },
        "notes": [
            "Generated by the public workbench.",
            "Example only; do not trade this configuration.",
            "Paper mode is intentionally not generated for public example plugins.",
        ],
    }
    yaml_text = yaml.safe_dump(config, sort_keys=False)
    errors = validate_runner_config(config, config_path=ROOT / "config" / f"{name}.yaml")
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


def config_builder_options() -> dict[str, Any]:
    return {
        "plugins": list(CONFIG_BUILDER_PLUGINS),
        "modes": list(CONFIG_BUILDER_MODES),
        "run_actions": list(CONFIG_DRAFT_RUN_ACTIONS),
        "risk_presets": list(CONFIG_BUILDER_RISK_PRESETS),
        "defaults": {
            "name": "workbench_example",
            "starting_cash": 10000,
            "history_bars": 100,
            "risk_preset": "demo_minimal",
            "max_steps": 100,
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


def config_draft_validation_record(path: Path, *, data_roots: list[Path]) -> dict[str, Any]:
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
        )
        base.update({
            "mode": runner.get("mode"),
            "output_dir": runner.get("output_dir"),
            "plugin": metadata.get("strategy_plugin") or metadata.get("plugin"),
            "status": metadata.get("status"),
            "symbols": sorted((data.get("files") or {}).keys()) if isinstance(data.get("files"), dict) else [],
            "valid": not errors,
            "errors": errors,
            "error_count": len(errors),
        })
    except Exception as exc:
        base["errors"] = [str(exc)]
        base["error_count"] = 1
    return base


def build_config_draft_validations(state_dir: Path, *, data_roots: list[Path]) -> dict[str, Any]:
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
        config_draft_validation_record(path, data_roots=data_roots)
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
) -> list[str]:
    errors = validate_runner_config(config, config_path=config_path)
    metadata = config.get("metadata") or {}
    runner = config.get("runner") or {}
    data = config.get("data") or {}
    spec = metadata.get("strategy_plugin") or metadata.get("plugin")
    allowed_specs = {plugin["spec"] for plugin in CONFIG_BUILDER_PLUGINS}
    if spec not in allowed_specs:
        errors.append("workbench drafts can only run public generic no-edge plugins")
    if metadata.get("status") != "example_only":
        errors.append("workbench drafts must be marked metadata.status=example_only")
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


def load_config_draft_detail(state_dir: Path, draft_id: str, *, data_roots: list[Path]) -> dict[str, Any]:
    path = config_draft_path(state_dir, draft_id)
    config = read_yaml_mapping(path)
    errors = validate_workbench_draft_config(
        config,
        config_path=path,
        data_roots=data_roots,
        action="replay",
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


def load_config_draft_yaml(state_dir: Path, draft_id: str, *, data_roots: list[Path]) -> tuple[str, str]:
    path = config_draft_path(state_dir, draft_id)
    config = read_yaml_mapping(path)
    errors = validate_workbench_draft_config(
        config,
        config_path=path,
        data_roots=data_roots,
        action="replay",
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
        if path.is_file() and path.suffix.lower() in {".csv", ".parquet"}:
            count += 1
            if count >= limit:
                break
    return count


def data_root_row(root: Path) -> dict[str, Any]:
    row = writable_probe(root, expect_dir=True)
    row["display_path"] = root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root)
    row["data_file_count"] = data_file_count(root)
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
) -> dict[str, Any]:
    catalog = build_data_catalog(data_roots, limit=200, preview_points=2)
    dataset_rows = [
        {field: row.get(field) for field in DATA_CATALOG_EXPORT_FIELDS}
        for row in catalog["datasets"]
    ]
    return {
        "schema_version": 1,
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
        "config_options": config_builder_options(),
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
    }


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


def summarize_account_artifact(row: dict[str, Any]) -> dict[str, Any]:
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
    }


def load_config_draft_artifacts(
    state_dir: Path,
    draft_id: str,
    *,
    data_roots: list[Path],
    limit: int = 100,
) -> dict[str, Any]:
    path = config_draft_path(state_dir, draft_id)
    config = read_yaml_mapping(path)
    errors = validate_workbench_draft_config(
        config,
        config_path=path,
        data_roots=data_roots,
        action="replay",
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


def run_config_draft(payload: dict[str, Any], *, state_dir: Path, data_roots: list[Path]) -> dict[str, Any]:
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
    command = {
        "command_id": str(payload.get("command_id") or f"cmd-{int(datetime.now(timezone.utc).timestamp() * 1000000)}"),
        "node_id": node_id,
        "action": action,
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


def save_command_result(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
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
    return stored


def cancel_command(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
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
    dashboard_dir = DEFAULT_DASHBOARD_DIR
    data_roots = list(DEFAULT_DATA_ROOTS)
    fetch_manifest_roots = list(DEFAULT_FETCH_MANIFEST_ROOTS)

    def auth_token(self) -> str | None:
        if not self.auth_token_env:
            return None
        return os.getenv(self.auth_token_env)

    def require_auth(self) -> bool:
        if not self.auth_token_env:
            return True
        bearer_value = self.auth_token()
        if not bearer_value:
            json_response(self, 503, {"error": f"auth token env var is not set: {self.auth_token_env}"})
            return False
        expected = f"Bearer {bearer_value}"
        if self.headers.get("Authorization") == expected:
            return True
        json_response(self, 401, {"error": "unauthorized"})
        return False

    def do_POST(self) -> None:
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
            try:
                command = enqueue_command(self.state_dir, payload)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "command": command})
            return
        if self.path == "/commands/cancel":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = cancel_command(self.state_dir, payload)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "result": result})
            return
        if self.path == "/command_results":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = save_command_result(self.state_dir, payload)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "result": result})
            return
        if self.path == "/config_draft":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = build_config_draft(payload, state_dir=self.state_dir, data_roots=self.data_roots)
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
        if self.path == "/config_draft/run":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = run_config_draft(payload, state_dir=self.state_dir, data_roots=self.data_roots)
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
                payload = build_data_detail(
                    raw_path,
                    data_roots=self.data_roots,
                    preview_points=preview_points,
                    gap_limit=gap_limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
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
                    limit=limit,
                )
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
            return
        if parsed.path == "/config_options":
            if not self.require_auth():
                return
            json_response(self, 200, config_builder_options())
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
        if parsed.path == "/config_draft_validations":
            if not self.require_auth():
                return
            payload = build_config_draft_validations(self.state_dir, data_roots=self.data_roots)
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
                payload = load_config_draft_detail(self.state_dir, draft_id, data_roots=self.data_roots)
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
                filename, yaml_body = load_config_draft_yaml(self.state_dir, draft_id, data_roots=self.data_roots)
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
        json_response(self, 404, {"error": "not found"})

    def log_message(self, format: str, *args: Any) -> None:
        return


def create_server(
    host: str,
    port: int,
    state_dir: Path,
    *,
    auth_token_env: str | None = None,
    dashboard_dir: Path = DEFAULT_DASHBOARD_DIR,
    data_roots: list[Path] | None = None,
    fetch_manifest_roots: list[Path] | None = None,
) -> ThreadingHTTPServer:
    class Handler(StatusHandler):
        pass

    Handler.state_dir = state_dir
    Handler.auth_token_env = auth_token_env
    Handler.dashboard_dir = dashboard_dir
    Handler.data_roots = parse_data_roots(data_roots)
    Handler.fetch_manifest_roots = parse_fetch_manifest_roots(fetch_manifest_roots)
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
    parser.add_argument("--auth-token-env", default=None, help="Optional env var containing bearer token")
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
            auth_token_env=args.auth_token_env,
        )
    except (TypeError, ValueError) as exc:
        raise SystemExit(str(exc)) from exc

    server = create_server(
        settings["host"],
        int(settings["port"]),
        settings["state_dir"],
        auth_token_env=settings["auth_token_env"],
        dashboard_dir=settings["dashboard_dir"],
        data_roots=settings["data_roots"],
        fetch_manifest_roots=settings["fetch_manifest_roots"],
    )
    print(f"Serving status dashboard at http://{settings['host']}:{server.server_address[1]}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
