#!/usr/bin/env python3
"""Consolidate chunked saved bar files into one parquet per symbol/group."""

from __future__ import annotations

import argparse
import json
import re
import sys
from collections import defaultdict
from pathlib import Path
from typing import Any

import pandas as pd

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from live.plugin_runner import normalize_frame  # noqa: E402
from scripts.cloud_status_server import (  # noqa: E402
    dashboard_server_settings,
    infer_adjustment_status,
    infer_asset_class,
    infer_bar_size,
    infer_data_source,
    infer_storage_session,
    infer_symbol,
    parse_data_roots,
    scan_data_file_candidates,
)

OPERATIONAL_FILE_NAMES = {
    "exit_monitor.csv",
    "fetch_manifest.csv",
    "fills.csv",
    "ledger.csv",
    "orders.csv",
    "paper_eod_flatten.csv",
    "paper_fills.csv",
    "paper_orders.csv",
    "shadow_signals.csv",
    "signal.csv",
    "signals.csv",
    "subscriptions.csv",
    "today_bars.csv",
}
OPERATIONAL_SYMBOLS = {"BARS", "FILLS", "ORDERS", "SHADOW", "SIGNAL", "SIGNALS", "SUBSCRIPTIONS", "TODAY"}


def safe_part(value: Any, *, fallback: str = "unknown") -> str:
    text = str(value or fallback).strip()
    text = re.sub(r"[^A-Za-z0-9._-]+", "_", text)
    return text.strip("._-") or fallback


def read_frame(path: Path) -> pd.DataFrame:
    if path.suffix.lower() == ".parquet":
        return pd.read_parquet(path)
    if path.suffix.lower() == ".csv":
        return pd.read_csv(path)
    raise ValueError(f"unsupported file type: {path}")


def is_operational_artifact(path: Path, symbol: str | None) -> bool:
    name = path.name.lower()
    stem = path.stem.lower()
    if name in OPERATIONAL_FILE_NAMES:
        return True
    if re.fullmatch(r"bars_\d+(min|m|h|d)", stem):
        return True
    return str(symbol or "").upper() in OPERATIONAL_SYMBOLS


def bar_group_for_path(path: Path, *, include_operational: bool = False) -> tuple[tuple[str, str, str, str, str], pd.DataFrame] | None:
    raw = read_frame(path)
    symbol = infer_symbol(path, raw)
    if not include_operational and is_operational_artifact(path, symbol):
        return None
    if not symbol:
        return None
    asset_class = infer_asset_class(path, symbol)
    bar_size = infer_bar_size(path, raw) or "unknown"
    source = infer_data_source(path) or "file"
    storage_session = infer_storage_session(path, raw, asset_class) or "unknown"
    adjustment_status = infer_adjustment_status(path, raw, asset_class) or "unknown"
    normalized = normalize_frame(raw, symbol=symbol)
    normalized = normalized.reset_index()
    normalized["symbol"] = symbol
    key = (symbol, bar_size, source, storage_session, adjustment_status)
    return key, normalized


def output_name(key: tuple[str, str, str, str, str], frame: pd.DataFrame) -> str:
    symbol, bar_size, source, storage_session, adjustment_status = key
    timestamps = pd.to_datetime(frame["timestamp"], utc=True, errors="coerce").dropna()
    first = timestamps.min().strftime("%Y%m%d") if not timestamps.empty else "start"
    last = timestamps.max().strftime("%Y%m%d") if not timestamps.empty else "end"
    return "_".join([
        safe_part(symbol),
        safe_part(bar_size),
        safe_part(source),
        safe_part(storage_session),
        safe_part(adjustment_status),
        first,
        last,
    ]) + ".parquet"


def consolidate_saved_bars(
    data_roots: list[Path],
    *,
    output_root: Path,
    limit: int,
    symbols: set[str] | None = None,
    include_operational: bool = False,
    dry_run: bool = False,
) -> dict[str, Any]:
    if symbols:
        file_by_path: dict[Path, Path] = {}
        root_summaries = []
        per_symbol_limit = max(limit, 1)
        for symbol in sorted(symbols):
            symbol_files, symbol_root_summaries = scan_data_file_candidates(
                data_roots,
                limit=per_symbol_limit,
                filters={"query": symbol.lower()},
            )
            for path in symbol_files:
                file_by_path[path.resolve()] = path
            for row in symbol_root_summaries:
                row = {**row, "symbol_filter": symbol}
                root_summaries.append(row)
        files = list(file_by_path.values())[:limit]
    else:
        files, root_summaries = scan_data_file_candidates(data_roots, limit=limit)
    grouped: dict[tuple[str, str, str, str, str], list[pd.DataFrame]] = defaultdict(list)
    skipped: list[dict[str, str]] = []
    scanned = 0
    for path in files:
      try:
          item = bar_group_for_path(path, include_operational=include_operational)
      except Exception as exc:  # noqa: BLE001 - report and keep scanning other files
          skipped.append({"path": str(path), "reason": str(exc)})
          continue
      if item is None:
          continue
      key, frame = item
      if symbols and key[0].upper() not in symbols:
          continue
      grouped[key].append(frame)
      scanned += 1

    outputs = []
    if not dry_run:
        output_root.mkdir(parents=True, exist_ok=True)
    for key, frames in sorted(grouped.items()):
        combined = pd.concat(frames, ignore_index=True)
        combined["timestamp"] = pd.to_datetime(combined["timestamp"], utc=True, errors="coerce")
        combined = combined.dropna(subset=["timestamp"]).sort_values("timestamp")
        combined = combined.drop_duplicates(subset=["timestamp"], keep="last")
        ordered = combined[["timestamp", "open", "high", "low", "close", "volume", "symbol"]].copy()
        out_path = output_root / output_name(key, ordered)
        row = {
            "symbol": key[0],
            "bar_size": key[1],
            "source": key[2],
            "storage_session": key[3],
            "adjustment_status": key[4],
            "input_files": len(frames),
            "rows": int(len(ordered)),
            "first_timestamp": ordered["timestamp"].min().isoformat() if len(ordered) else None,
            "last_timestamp": ordered["timestamp"].max().isoformat() if len(ordered) else None,
            "path": str(out_path),
        }
        outputs.append(row)
        if not dry_run:
            ordered.to_parquet(out_path, index=False)

    return {
        "data_roots": [str(root) for root in data_roots],
        "output_root": str(output_root),
        "input_candidates": len(files),
        "input_bar_files": scanned,
        "output_count": len(outputs),
        "outputs": outputs,
        "skipped": skipped[:50],
        "root_summaries": root_summaries,
        "dry_run": dry_run,
    }


def parse_symbols(values: list[str] | None) -> set[str] | None:
    if not values:
        return None
    symbols = {
        item.strip().upper()
        for value in values
        for item in value.split(",")
        if item.strip()
    }
    return symbols or None


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Consolidate chunked saved bar CSV/parquet files")
    parser.add_argument("--config", type=Path, default=None, help="Dashboard config whose dashboard.data_roots should be scanned")
    parser.add_argument("--data-root", action="append", type=Path, default=None, help="Data root to scan; can be repeated")
    parser.add_argument("--output-root", type=Path, default=ROOT / "data" / "consolidated_bars")
    parser.add_argument("--symbol", action="append", default=None, help="Restrict to symbols; accepts comma-separated values")
    parser.add_argument("--limit", type=int, default=100000, help="Maximum candidate files to scan")
    parser.add_argument("--include-operational", action="store_true", help="Include runtime artifacts such as bars_1min.parquet")
    parser.add_argument("--dry-run", action="store_true", help="Report outputs without writing parquet files")
    parser.add_argument("--json", action="store_true", help="Print JSON report")
    args = parser.parse_args(argv)

    settings = dashboard_server_settings(args.config, data_roots=args.data_root if args.data_root else None)
    data_roots = parse_data_roots(settings["data_roots"])
    report = consolidate_saved_bars(
        data_roots,
        output_root=args.output_root,
        limit=args.limit,
        symbols=parse_symbols(args.symbol),
        include_operational=args.include_operational,
        dry_run=args.dry_run,
    )
    if args.json:
        print(json.dumps(report, indent=2, sort_keys=True))
    else:
        print(f"Consolidated groups: {report['output_count']} from {report['input_bar_files']} bar files")
        print(f"Output root: {report['output_root']}")
        for row in report["outputs"]:
            print(
                f"- {row['symbol']} {row['bar_size']} {row['source']} {row['storage_session']} "
                f"files={row['input_files']} rows={row['rows']} -> {row['path']}"
            )
        if report["skipped"]:
            print(f"Skipped with errors: {len(report['skipped'])} shown")
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
