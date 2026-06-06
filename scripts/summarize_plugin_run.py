#!/usr/bin/env python3
"""Summarize artifacts from live/plugin_runner.py."""

from __future__ import annotations

import argparse
import json
from datetime import datetime, timezone
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


def finite_float(raw: Any) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value == value and value not in {float("inf"), float("-inf")} else None


def account_performance(rows: list[dict[str, Any]]) -> dict[str, Any]:
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
    if not equity_values:
        return {
            "account_snapshot_count": len(rows),
            "initial_equity": None,
            "total_return_pct": None,
            "max_drawdown_pct": None,
            "account_start_time": timestamps[0].isoformat() if timestamps else None,
            "account_end_time": timestamps[-1].isoformat() if timestamps else None,
            "elapsed_seconds": None,
            "elapsed_days": None,
            "return_per_day_pct": None,
            "return_per_month_pct": None,
            "return_per_year_pct": None,
            "short_horizon_projection": False,
            "max_gross_exposure": max_gross_exposure,
            "max_gross_exposure_pct": None,
            "max_abs_net_exposure": max_abs_net_exposure,
            "max_abs_net_exposure_pct": None,
            "max_position_count": max_position_count,
        }
    initial = equity_values[0]
    final = equity_values[-1]
    total_return = (final / initial) - 1.0 if initial else None
    total_return_pct = total_return * 100.0 if total_return is not None else None
    peak = initial
    max_drawdown = 0.0
    for value in equity_values:
        peak = max(peak, value)
        if peak > 0:
            max_drawdown = min(max_drawdown, (value / peak - 1.0) * 100.0)
    elapsed_seconds = None
    elapsed_days = None
    return_per_day_pct = None
    return_per_month_pct = None
    return_per_year_pct = None
    if len(timestamps) >= 2:
        elapsed_seconds = (timestamps[-1] - timestamps[0]).total_seconds()
        if elapsed_seconds > 0:
            elapsed_days = elapsed_seconds / 86400.0
            if total_return is not None and initial > 0 and final > 0:
                ratio = final / initial
                return_per_day_pct = finite_float((ratio ** (1.0 / elapsed_days) - 1.0) * 100.0)
                return_per_month_pct = finite_float((ratio ** (30.4375 / elapsed_days) - 1.0) * 100.0)
                return_per_year_pct = finite_float((ratio ** (365.25 / elapsed_days) - 1.0) * 100.0)
    return {
        "account_snapshot_count": len(rows),
        "initial_equity": initial,
        "total_return_pct": total_return_pct,
        "max_drawdown_pct": max_drawdown,
        "account_start_time": timestamps[0].isoformat() if timestamps else None,
        "account_end_time": timestamps[-1].isoformat() if timestamps else None,
        "elapsed_seconds": elapsed_seconds,
        "elapsed_days": elapsed_days,
        "return_per_day_pct": return_per_day_pct,
        "return_per_month_pct": return_per_month_pct,
        "return_per_year_pct": return_per_year_pct,
        "short_horizon_projection": bool(elapsed_days is not None and elapsed_days < 30.0),
        "max_gross_exposure": finite_float(max_gross_exposure),
        "max_gross_exposure_pct": finite_float((max_gross_exposure / initial) * 100.0) if initial and max_gross_exposure is not None else None,
        "max_abs_net_exposure": finite_float(max_abs_net_exposure),
        "max_abs_net_exposure_pct": finite_float((max_abs_net_exposure / initial) * 100.0) if initial and max_abs_net_exposure is not None else None,
        "max_position_count": max_position_count,
    }


def first_last_timestamp(rows: list[dict[str, Any]]) -> tuple[str | None, str | None]:
    timestamps = [str(row["timestamp"]) for row in rows if row.get("timestamp")]
    if not timestamps:
        return None, None
    return min(timestamps), max(timestamps)


def summarize_decision_record(row: dict[str, Any]) -> dict[str, Any]:
    intents = row.get("intents") or []
    diagnostics = row.get("diagnostics") or {}
    signal = row.get("signal") or {}
    record = {
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
    dashboard = diagnostics.get("dashboard") if isinstance(diagnostics, dict) else None
    if isinstance(dashboard, dict):
        public_keys = {
            "reason",
            "signal_label",
            "signal_value",
            "threshold",
            "threshold_distance",
            "near_threshold",
            "near_threshold_reason",
            "expected_hold_minutes",
            "active_exit_rule",
            "exit_state",
            "stop_state",
            "mae_pct",
            "mfe_pct",
        }
        record["drilldown"] = {
            key: value
            for key, value in dashboard.items()
            if key in public_keys and isinstance(value, bool | int | float | str)
        }
    return record


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
    plugin_contract = load_json(run_dir / "plugin_contract.json")
    decisions = load_jsonl(run_dir / "decisions.jsonl")
    orders = load_jsonl(run_dir / "orders.jsonl")
    fills = load_jsonl(run_dir / "fills.jsonl")
    account = load_jsonl(run_dir / "account.jsonl")
    first_ts, last_ts = first_last_timestamp(decisions)

    rejected_orders = [row for row in orders if row.get("status") == "rejected"]
    filled_notional = sum(fill_notional(row) for row in fills)
    fill_commission = sum_float(fills, "commission")
    performance = account_performance(account)

    metrics = {
        "run_dir": str(run_dir),
        "mode": summary.get("mode"),
        "loop_enabled": bool(summary.get("loop_enabled", False)),
        "loop_iterations": int(summary.get("loop_iterations", 0) or 0),
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
        "account_snapshot_count": summary.get("account_snapshot_count", performance["account_snapshot_count"]),
        "initial_equity": summary.get("initial_equity", performance["initial_equity"]),
        "total_return_pct": summary.get("total_return_pct", performance["total_return_pct"]),
        "max_drawdown_pct": summary.get("max_drawdown_pct", performance["max_drawdown_pct"]),
        "account_start_time": summary.get("account_start_time", performance["account_start_time"]),
        "account_end_time": summary.get("account_end_time", performance["account_end_time"]),
        "latest_data_time": summary.get("latest_data_time") or summary.get("latest_market_data_time"),
        "elapsed_seconds": summary.get("elapsed_seconds", performance["elapsed_seconds"]),
        "elapsed_days": summary.get("elapsed_days", performance["elapsed_days"]),
        "return_per_day_pct": summary.get("return_per_day_pct", performance["return_per_day_pct"]),
        "return_per_month_pct": summary.get("return_per_month_pct", performance["return_per_month_pct"]),
        "return_per_year_pct": summary.get("return_per_year_pct", performance["return_per_year_pct"]),
        "short_horizon_projection": summary.get("short_horizon_projection", performance["short_horizon_projection"]),
        "max_gross_exposure": summary.get("max_gross_exposure", performance["max_gross_exposure"]),
        "max_gross_exposure_pct": summary.get("max_gross_exposure_pct", performance["max_gross_exposure_pct"]),
        "max_abs_net_exposure": summary.get("max_abs_net_exposure", performance["max_abs_net_exposure"]),
        "max_abs_net_exposure_pct": summary.get("max_abs_net_exposure_pct", performance["max_abs_net_exposure_pct"]),
        "max_position_count": summary.get("max_position_count", performance["max_position_count"]),
        "plugin_contract_available": bool(plugin_contract),
        "plugin_contract_schema_version": plugin_contract.get("schema_version"),
        "plugin_spec": (plugin_contract.get("plugin") or {}).get("spec") if isinstance(plugin_contract.get("plugin"), dict) else None,
        "plugin_name": (plugin_contract.get("plugin") or {}).get("name") if isinstance(plugin_contract.get("plugin"), dict) else None,
        "plugin_validator_count": (plugin_contract.get("plugin") or {}).get("validator_count") if isinstance(plugin_contract.get("plugin"), dict) else None,
        "data_symbols": (plugin_contract.get("data") or {}).get("symbols", []) if isinstance(plugin_contract.get("data"), dict) else [],
        "observed_dashboard_keys": (plugin_contract.get("observed") or {}).get("dashboard_keys", []) if isinstance(plugin_contract.get("observed"), dict) else [],
        "observed_intent_metadata_keys": (plugin_contract.get("observed") or {}).get("intent_metadata_keys", []) if isinstance(plugin_contract.get("observed"), dict) else [],
        "artifact_files": {
            "summary": (run_dir / "summary.json").exists(),
            "runner_status": (run_dir / "runner_status.json").exists(),
            "performance_rollups": (run_dir / "performance_rollups.json").exists(),
            "plugin_contract": (run_dir / "plugin_contract.json").exists(),
            "decisions": (run_dir / "decisions.jsonl").exists(),
            "orders": (run_dir / "orders.jsonl").exists(),
            "fills": (run_dir / "fills.jsonl").exists(),
            "account": (run_dir / "account.jsonl").exists(),
            "order_previews": (run_dir / "order_previews.jsonl").exists(),
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


def format_percent(value: Any) -> str:
    if value is None:
        return "n/a"
    return f"{float(value):.4g}%"


def format_text(metrics: dict[str, Any]) -> str:
    lines = [
        f"Run: {metrics['run_dir']}",
        f"Mode: {metrics.get('mode') or 'unknown'}",
        f"Loop: {'enabled' if metrics.get('loop_enabled') else 'one-shot'} iterations={metrics.get('loop_iterations', 0)}",
        f"Decisions: {metrics['decisions']} records={metrics['decision_records']}",
        f"Window: {metrics.get('first_decision_time') or 'n/a'} -> {metrics.get('last_decision_time') or 'n/a'}",
        f"Orders: {metrics['orders']} events={metrics['order_events']} statuses={metrics['order_status_counts']}",
        f"Fills: {metrics['fills']} notional={format_money(metrics['filled_notional'])} commission={format_money(metrics['fill_commission'])}",
        f"Rejections: {metrics['rejections']} reasons={metrics['rejection_reasons']}",
        f"Final cash: {format_money(metrics.get('final_cash'))}",
        f"Final equity: {format_money(metrics.get('final_equity'))}",
        f"Return: {format_percent(metrics.get('total_return_pct'))}",
        f"Max drawdown: {format_percent(metrics.get('max_drawdown_pct'))}",
        f"Elapsed days: {metrics.get('elapsed_days') if metrics.get('elapsed_days') is not None else 'n/a'}",
        f"Return/day: {format_percent(metrics.get('return_per_day_pct'))}",
        f"Return/month: {format_percent(metrics.get('return_per_month_pct'))}",
        f"Return/year: {format_percent(metrics.get('return_per_year_pct'))}",
        f"Max gross exposure: {format_money(metrics.get('max_gross_exposure'))} ({format_percent(metrics.get('max_gross_exposure_pct'))})",
        f"Max abs net exposure: {format_money(metrics.get('max_abs_net_exposure'))} ({format_percent(metrics.get('max_abs_net_exposure_pct'))})",
        f"Max positions: {metrics.get('max_position_count')}",
        f"Final positions: {metrics['final_positions']}",
        f"Plugin contract: {'available' if metrics.get('plugin_contract_available') else 'missing'} plugin={metrics.get('plugin_name') or metrics.get('plugin_spec') or 'n/a'}",
        f"Observed dashboard keys: {metrics.get('observed_dashboard_keys') or []}",
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
