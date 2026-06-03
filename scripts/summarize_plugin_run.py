#!/usr/bin/env python3
"""Summarize artifacts from live/plugin_runner.py."""

from __future__ import annotations

import argparse
import json
from collections import Counter
from pathlib import Path
from typing import Any


def load_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open() as f:
        data = json.load(f)
    if not isinstance(data, dict):
        raise ValueError(f"{path} must contain a JSON object")
    return data


def load_jsonl(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    with path.open() as f:
        for lineno, line in enumerate(f, start=1):
            line = line.strip()
            if not line:
                continue
            data = json.loads(line)
            if not isinstance(data, dict):
                raise ValueError(f"{path}:{lineno} must contain a JSON object")
            rows.append(data)
    return rows


def load_recent_jsonl(path: Path, *, max_rows: int) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    with path.open() as f:
        lines = [line for line in f if line.strip()]
    for lineno, line in enumerate(lines[-max_rows:], start=max(1, len(lines) - max_rows + 1)):
        data = json.loads(line)
        if not isinstance(data, dict):
            raise ValueError(f"{path}:{lineno} must contain a JSON object")
        rows.append(data)
    return rows


def count_values(rows: list[dict[str, Any]], key: str) -> dict[str, int]:
    return dict(sorted(Counter(str(row.get(key, "")) for row in rows if row.get(key) not in {None, ""}).items()))


def sum_float(rows: list[dict[str, Any]], key: str) -> float:
    total = 0.0
    for row in rows:
        raw = row.get(key)
        if raw is None:
            continue
        total += float(raw)
    return total


def fill_notional(row: dict[str, Any]) -> float:
    quantity = float(row.get("quantity") or 0.0)
    price = float(row.get("price") or 0.0)
    return abs(quantity * price)


def first_last_timestamp(rows: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    timestamps = [str(row["timestamp"]) for row in rows if row.get("timestamp")]
    if not timestamps:
        return None, None
    return min(timestamps), max(timestamps)


def summarize_decision_record(row: dict[str, Any]) -> dict[str, Any]:
    intents = row.get("intents") or []
    diagnostics = row.get("diagnostics") or {}
    signal = row.get("signal") or {}
    return {
        "timestamp": row.get("timestamp"),
        "step": row.get("step"),
        "mode": row.get("mode"),
        "intents": len(intents) if isinstance(intents, list) else 0,
        "paused": bool(
            (diagnostics.get("paused") if isinstance(diagnostics, dict) else False)
            or (signal.get("paused") if isinstance(signal, dict) else False)
        ),
        "symbols": sorted(diagnostics.get("symbols") or []) if isinstance(diagnostics, dict) else [],
    }


def summarize_order_record(row: dict[str, Any]) -> dict[str, Any]:
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


def summarize_fill_record(row: dict[str, Any]) -> dict[str, Any]:
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


def summarize_recent_run_events(run_dir: Path, *, max_rows: int = 5) -> dict[str, Any]:
    if max_rows <= 0:
        raise ValueError("max_rows must be > 0")
    return {
        "max_rows": max_rows,
        "decisions": [
            summarize_decision_record(row)
            for row in load_recent_jsonl(run_dir / "decisions.jsonl", max_rows=max_rows)
        ],
        "orders": [
            summarize_order_record(row)
            for row in load_recent_jsonl(run_dir / "orders.jsonl", max_rows=max_rows)
        ],
        "fills": [
            summarize_fill_record(row)
            for row in load_recent_jsonl(run_dir / "fills.jsonl", max_rows=max_rows)
        ],
    }


def summarize_run(run_dir: Path) -> dict[str, Any]:
    if not run_dir.exists() or not run_dir.is_dir():
        raise FileNotFoundError(f"run directory not found: {run_dir}")

    summary = load_json(run_dir / "summary.json")
    decisions = load_jsonl(run_dir / "decisions.jsonl")
    orders = load_jsonl(run_dir / "orders.jsonl")
    fills = load_jsonl(run_dir / "fills.jsonl")
    first_ts, last_ts = first_last_timestamp(decisions)

    rejected_orders = [row for row in orders if row.get("status") == "rejected"]
    filled_notional = sum(fill_notional(row) for row in fills)
    fill_commission = sum_float(fills, "commission")

    metrics = {
        "run_dir": str(run_dir),
        "mode": summary.get("mode"),
        "decisions": int(summary.get("decisions", len(decisions)) or 0),
        "decision_records": len(decisions),
        "first_decision_time": first_ts,
        "last_decision_time": last_ts,
        "orders": int(summary.get("orders", len(orders)) or 0),
        "order_events": len(orders),
        "order_status_counts": count_values(orders, "status"),
        "rejections": int(summary.get("rejections", len(rejected_orders)) or 0),
        "rejection_reasons": count_values(rejected_orders, "reason"),
        "fills": int(summary.get("fills", len(fills)) or 0),
        "fill_symbols": count_values(fills, "symbol"),
        "fill_sides": count_values(fills, "side"),
        "filled_notional": filled_notional,
        "fill_commission": fill_commission,
        "final_cash": summary.get("final_cash"),
        "final_equity": summary.get("final_equity"),
        "final_positions": summary.get("final_positions") or {},
        "artifact_files": {
            "summary": (run_dir / "summary.json").exists(),
            "decisions": (run_dir / "decisions.jsonl").exists(),
            "orders": (run_dir / "orders.jsonl").exists(),
            "fills": (run_dir / "fills.jsonl").exists(),
        },
    }
    if metrics["final_cash"] is not None and metrics["final_equity"] is not None:
        metrics["unrealized_pnl_estimate"] = float(metrics["final_equity"]) - float(metrics["final_cash"])
    else:
        metrics["unrealized_pnl_estimate"] = None
    return metrics


def format_money(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"${float(value):,.2f}"


def format_text(metrics: dict[str, Any]) -> str:
    lines = [
        f"Run: {metrics['run_dir']}",
        f"Mode: {metrics.get('mode') or 'unknown'}",
        f"Decisions: {metrics['decisions']} records={metrics['decision_records']}",
        f"Window: {metrics.get('first_decision_time') or 'n/a'} -> {metrics.get('last_decision_time') or 'n/a'}",
        f"Orders: {metrics['orders']} events={metrics['order_events']} statuses={metrics['order_status_counts']}",
        f"Fills: {metrics['fills']} notional={format_money(metrics['filled_notional'])} commission={format_money(metrics['fill_commission'])}",
        f"Rejections: {metrics['rejections']} reasons={metrics['rejection_reasons']}",
        f"Final cash: {format_money(metrics.get('final_cash'))}",
        f"Final equity: {format_money(metrics.get('final_equity'))}",
        f"Final positions: {metrics['final_positions']}",
    ]
    return "\n".join(lines)


def main() -> None:
    parser = argparse.ArgumentParser(description="Summarize generic plugin runner artifacts")
    parser.add_argument("run_dir", type=Path)
    parser.add_argument("--json", action="store_true", help="Emit machine-readable JSON")
    args = parser.parse_args()

    metrics = summarize_run(args.run_dir)
    if args.json:
        print(json.dumps(metrics, indent=2, sort_keys=True))
    else:
        print(format_text(metrics))


if __name__ == "__main__":
    main()
