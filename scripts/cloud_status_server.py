#!/usr/bin/env python3
"""Tiny local receiver/dashboard for public telemetry prototypes."""

from __future__ import annotations

import argparse
import html
import json
import math
import os
import mimetypes
import re
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
BAR_SIZE_TOKENS = ("1min", "5min", "15min", "30min", "1h", "1d")
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
WORKBENCH_OUTPUT_ROOT = ROOT / "paper_logs" / "workbench"
MAX_DRAFT_RUN_STEPS = 500
MAX_DRAFT_RUN_TIMEOUT_SECONDS = 120
MAX_ARTIFACT_ROWS = 500
MAX_DATA_DETAIL_POINTS = 1000
MAX_DATA_GAP_ROWS = 200
OUTPUT_TAIL_BYTES = 8000


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


def close_column(df: pd.DataFrame) -> str | None:
    lower_map = {str(col).lower(): str(col) for col in df.columns}
    return lower_map.get("close") or lower_map.get("last")


def volume_column(df: pd.DataFrame) -> str | None:
    lower_map = {str(col).lower(): str(col) for col in df.columns}
    return lower_map.get("volume")


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
    parsed_ts = pd.Series([], dtype="datetime64[ns, UTC]")
    source_tz = None
    if raw_ts is not None:
        source_tz = source_timezone_label(raw_ts)
        parsed_ts = pd.Series(pd.to_datetime(raw_ts, utc=True, errors="coerce")).dropna()

    first_ts = last_ts = None
    median_interval = largest_gap = None
    estimated_missing = None
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
    preview = []
    if close_col and not parsed_ts.empty:
        scoped = pd.DataFrame({
            "timestamp": pd.to_datetime(raw_ts, utc=True, errors="coerce"),
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
    return {
        "path": path.relative_to(ROOT).as_posix() if path.is_relative_to(ROOT) else str(path),
        "root": root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root),
        "format": fmt,
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "rows": int(len(df)),
        "columns": [str(col) for col in df.columns],
        "symbol": infer_symbol(path, df),
        "bar_size": infer_bar_size(path, df),
        "timestamp_column": ts_col,
        "source_timezone": source_tz,
        "normalized_timezone": "UTC" if source_tz else None,
        "first_timestamp": first_ts,
        "last_timestamp": last_ts,
        "median_interval_seconds": median_interval,
        "largest_gap_seconds": largest_gap,
        "estimated_missing_intervals": estimated_missing,
        "close_column": close_col,
        "volume_column": volume_col,
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
    return {
        "roots": [root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root) for root in data_roots],
        "datasets": datasets,
        "errors": errors,
        "count": len(datasets),
        "error_count": len(errors),
        "limit": limit,
        "preview_points": preview_points,
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
        parsed_ts = pd.Series(pd.to_datetime(raw_ts, utc=True, errors="coerce"))

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
    price_stats: dict[str, Any] = {}
    return_stats: dict[str, Any] = {}
    volume_stats: dict[str, Any] = {}
    preview = []
    if close_col and raw_ts is not None:
        scoped = pd.DataFrame({
            "timestamp": pd.to_datetime(raw_ts, utc=True, errors="coerce"),
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
    return {
        "path": rel_path,
        "root": root.relative_to(ROOT).as_posix() if root.is_relative_to(ROOT) else str(root),
        "format": fmt,
        "size_bytes": stat.st_size,
        "modified_at": datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat(),
        "rows": int(len(df)),
        "columns": [str(col) for col in df.columns],
        "symbol": infer_symbol(path, df),
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
            "duplicate_timestamps": int(parsed_valid.duplicated().sum()) if not parsed_valid.empty else 0,
            "timestamp_parse_failures": int(parsed_ts.isna().sum()) if raw_ts is not None else None,
        },
        "quality": {
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

    datasets = payload.get("datasets") or []
    if not isinstance(datasets, list) or not datasets:
        raise ValueError("datasets must be a non-empty list")
    data_files: dict[str, str] = {}
    for item in datasets:
        if not isinstance(item, dict):
            raise ValueError("each dataset must be a mapping")
        symbol = str(item.get("symbol") or "").strip().upper()
        raw_path = str(item.get("path") or "").strip()
        if not symbol:
            raise ValueError("dataset symbol is required")
        if not raw_path:
            raise ValueError("dataset path is required")
        _, rel_path = data_path_allowed(raw_path, data_roots)
        data_files[symbol] = rel_path
    if not data_files:
        raise ValueError("at least one dataset is required")

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
        "commands": {
            "validate": f"python3 live/plugin_runner.py --config {command_path} --validate-only",
            "replay": f"python3 live/plugin_runner.py --config {command_path} --mode replay",
            "simulated_paper": f"python3 live/plugin_runner.py --config {command_path} --mode simulated-paper",
        },
    }


def config_builder_options() -> dict[str, Any]:
    return {
        "plugins": list(CONFIG_BUILDER_PLUGINS),
        "modes": list(CONFIG_BUILDER_MODES),
        "run_actions": list(CONFIG_DRAFT_RUN_ACTIONS),
        "defaults": {
            "name": "workbench_example",
            "starting_cash": 10000,
            "history_bars": 100,
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


def safe_workbench_output_dir(config: dict[str, Any]) -> Path:
    runner = config.get("runner") or {}
    raw_output_dir = str(runner.get("output_dir") or "").strip()
    if not raw_output_dir:
        raise ValueError("runner.output_dir is required")
    candidate = Path(raw_output_dir)
    output_dir = candidate if candidate.is_absolute() else ROOT / candidate
    output_dir = output_dir.resolve()
    root = WORKBENCH_OUTPUT_ROOT.resolve()
    if not output_dir.is_relative_to(root):
        raise ValueError("runner.output_dir must be inside paper_logs/workbench")
    return output_dir


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
    return {
        "draft_id": path.stem,
        "output_dir": output_dir.relative_to(ROOT).as_posix() if output_dir.is_relative_to(ROOT) else str(output_dir),
        "summary": summary,
        "counts": {
            "decisions": len(decisions_raw),
            "orders": len(orders_raw),
            "fills": len(fills_raw),
        },
        "decisions": [summarize_decision_artifact(row) for row in decisions_raw],
        "orders": [summarize_order_artifact(row) for row in orders_raw],
        "fills": [summarize_fill_artifact(row) for row in fills_raw],
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
    summary = run_summary_for_config(config) if action != "validate" else None
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
                limit = parse_limit(params, default=50, maximum=200)
                preview_points = int(params.get("preview_points", ["80"])[0])
                payload = build_data_catalog(self.data_roots, limit=limit, preview_points=preview_points)
            except (TypeError, ValueError) as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, payload)
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
        if parsed.path == "/config_options":
            if not self.require_auth():
                return
            json_response(self, 200, config_builder_options())
            return
        if parsed.path == "/config_drafts":
            if not self.require_auth():
                return
            json_response(self, 200, list_config_drafts(self.state_dir))
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
) -> ThreadingHTTPServer:
    class Handler(StatusHandler):
        pass

    Handler.state_dir = state_dir
    Handler.auth_token_env = auth_token_env
    Handler.dashboard_dir = dashboard_dir
    Handler.data_roots = parse_data_roots(data_roots)
    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local telemetry receiver/dashboard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--state-dir", type=Path, default=Path("paper_logs/cloud_status_server"))
    parser.add_argument("--dashboard-dir", type=Path, default=DEFAULT_DASHBOARD_DIR)
    parser.add_argument(
        "--data-root",
        action="append",
        type=Path,
        default=None,
        help="Local data root to scan for CSV/parquet files. Can be repeated. Defaults to examples/data.",
    )
    parser.add_argument("--auth-token-env", default=None, help="Optional env var containing bearer token")
    args = parser.parse_args()

    server = create_server(
        args.host,
        args.port,
        args.state_dir,
        auth_token_env=args.auth_token_env,
        dashboard_dir=args.dashboard_dir,
        data_roots=args.data_root,
    )
    print(f"Serving status dashboard at http://{args.host}:{server.server_address[1]}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
