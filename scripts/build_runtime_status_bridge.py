#!/usr/bin/env python3
"""Build generic dashboard telemetry from legacy paper-runner artifacts.

The public dashboard reads generic plugin-run artifacts. Some older/private
paper runners write CSV/JSON session folders instead. This bridge keeps the
runtime/dashboard contract generic by translating those folders into sanitized
summary.json, runner_status.json, decisions.jsonl, orders.jsonl, fills.jsonl,
and account.jsonl files.
"""

from __future__ import annotations

import argparse
import csv
import json
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open() as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def read_csv_rows(path: Path) -> list[dict[str, str]]:
    if not path.exists():
        return []
    with path.open(newline="") as f:
        return [dict(row) for row in csv.DictReader(f)]


def write_json(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def write_jsonl(path: Path, rows: list[dict[str, Any]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        for row in rows:
            f.write(json.dumps(row, sort_keys=True))
            f.write("\n")
    tmp.replace(path)


def parse_float(raw: Any) -> float | None:
    if raw in {None, ""}:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if value == value and value not in {float("inf"), float("-inf")} else None


def parse_bool(raw: Any) -> bool:
    if isinstance(raw, bool):
        return raw
    return str(raw or "").strip().lower() in {"1", "true", "yes", "y", "on"}


def first_value(*values: Any) -> Any:
    for value in values:
        if value not in {None, ""}:
            return value
    return None


def parse_timestamp(raw: Any) -> datetime | None:
    if not raw:
        return None
    try:
        parsed = datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def iso_or_none(value: Any) -> str | None:
    parsed = parse_timestamp(value)
    if parsed is not None:
        return parsed.isoformat()
    return str(value) if value not in {None, ""} else None


def latest_timestamp(values: list[Any]) -> str | None:
    parsed = [parse_timestamp(value) for value in values if value]
    parsed = [value for value in parsed if value is not None]
    if not parsed:
        return None
    return max(parsed).isoformat()


def session_dirs(root: Path, *, max_sessions: int) -> list[Path]:
    if not root.exists():
        return []
    sessions = [path for path in root.iterdir() if path.is_dir()]
    sessions.sort()
    if max_sessions > 0:
        sessions = sessions[-max_sessions:]
    return sessions


def split_symbols(raw: Any) -> list[str]:
    if isinstance(raw, list):
        return [str(item).strip() for item in raw if str(item).strip()]
    return [part.strip() for part in str(raw or "").split(",") if part.strip()]


def public_order_tag(raw: Any) -> str | None:
    value = str(raw or "").strip().lower()
    if not value:
        return None
    if "exit" in value or "sell" in value:
        return "exit"
    if "entry" in value or "buy" in value:
        return "entry"
    return "event"


def max_bar_timestamp(path: Path) -> str | None:
    latest = None
    for row in read_csv_rows(path):
        ts = row.get("timestamp")
        if ts and (latest is None or str(ts) > str(latest)):
            latest = ts
    return iso_or_none(latest)


def crypto_decision_from_signal(row: dict[str, str], session: Path) -> dict[str, Any]:
    signal = parse_float(row.get("signal"))
    threshold = parse_float(row.get("strategy_min_abs_signal"))
    threshold_distance = None
    if signal is not None and threshold is not None:
        threshold_distance = abs(signal) - threshold
    reason = first_value(row.get("reason"), row.get("action_reason"), "unknown")
    return {
        "timestamp": iso_or_none(first_value(row.get("decision_hour"), row.get("run_started_at"))),
        "mode": "simulated_paper" if parse_bool(row.get("simulate_fills")) else "paper",
        "step": session.name,
        "intents": [],
        "diagnostics": {
            "symbols": split_symbols(row.get("target_symbols")),
            "dashboard": {
                "reason": reason,
                "signal_label": "Selection score",
                "signal_value": signal,
                "threshold": threshold,
                "threshold_distance": threshold_distance,
                "near_threshold": bool(threshold_distance is not None and -0.002 <= threshold_distance < 0),
                "near_threshold_reason": row.get("action_reason") or reason,
                "expected_hold_minutes": int(float(row["strategy_hold_h"]) * 60) if row.get("strategy_hold_h") else None,
                "active_exit_rule": "trailing_stop" if row.get("strategy_trailing_stop_pct") else None,
            },
        },
        "signal": {
            "symbol": row.get("target_symbol") or None,
            "reason": reason,
        },
    }


def crypto_order_from_row(row: dict[str, str]) -> dict[str, Any]:
    status = first_value(row.get("sim_status"), "submitted" if parse_bool(row.get("submitted")) else None, "pending")
    return {
        "timestamp": iso_or_none(row.get("timestamp")),
        "status": status,
        "symbol": row.get("symbol") or None,
        "side": (row.get("side") or "").lower() or None,
        "quantity": parse_float(row.get("quantity")),
        "cash_quantity": parse_float(row.get("cash_quantity")),
        "tag": public_order_tag(row.get("tag")),
        "simulated": parse_bool(row.get("simulated")),
    }


def fill_from_row(row: dict[str, str]) -> dict[str, Any]:
    return {
        "timestamp": iso_or_none(row.get("timestamp")),
        "symbol": row.get("symbol") or None,
        "side": (row.get("side") or "").lower() or None,
        "quantity": parse_float(row.get("quantity")),
        "price": parse_float(row.get("price")),
        "commission": parse_float(row.get("commission")) or 0.0,
        "tag": public_order_tag(row.get("tag")),
        "simulated": True,
    }


def account_from_crypto_signal(row: dict[str, str], state: dict[str, Any] | None = None) -> dict[str, Any]:
    cash = parse_float(row.get("cash"))
    equity = parse_float(row.get("estimated_equity"))
    positions = state.get("sim_positions", {}) if isinstance(state, dict) else {}
    return {
        "timestamp": iso_or_none(first_value(row.get("run_started_at"), row.get("decision_hour"))),
        "cash": cash,
        "equity": equity,
        "positions": positions if isinstance(positions, dict) else {},
        "gross_exposure": None,
        "net_exposure": None,
    }


def build_crypto_run(state_path: Path, sessions_root: Path, out_dir: Path, *, max_sessions: int) -> dict[str, Any]:
    state = read_json(state_path)
    decisions: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []
    fills: list[dict[str, Any]] = []
    account: list[dict[str, Any]] = []
    data_times: list[str] = []
    symbols: set[str] = set()
    modes = Counter()

    for session in session_dirs(sessions_root, max_sessions=max_sessions):
        signal_rows = read_csv_rows(session / "signal.csv")
        for row in signal_rows:
            decisions.append(crypto_decision_from_signal(row, session))
            account.append(account_from_crypto_signal(row, state))
            if row.get("latest_data_time"):
                data_times.append(row["latest_data_time"])
            symbols.update(split_symbols(row.get("target_symbols")))
            if row.get("target_symbol"):
                symbols.add(row["target_symbol"])
            modes[str(row.get("simulate_fills"))] += 1
        orders.extend(crypto_order_from_row(row) for row in read_csv_rows(session / "orders.csv"))
        fills.extend(fill_from_row(row) for row in read_csv_rows(session / "fills.csv"))

    if state:
        account.append({
            "timestamp": iso_or_none(state.get("last_run_at")),
            "cash": parse_float(state.get("sim_cash")),
            "equity": parse_float(state.get("sim_equity")),
            "positions": state.get("sim_positions") if isinstance(state.get("sim_positions"), dict) else {},
            "gross_exposure": None,
            "net_exposure": None,
        })
        signal = state.get("last_signal") if isinstance(state.get("last_signal"), dict) else {}
        if state.get("last_decision_hour"):
            decisions.append({
                "timestamp": iso_or_none(state.get("last_decision_hour")),
                "mode": state.get("last_mode") or "unknown",
                "step": "state",
                "intents": [],
                "diagnostics": {
                    "symbols": sorted(symbols),
                    "dashboard": {
                        "reason": signal.get("reason") or "state_snapshot",
                        "signal_label": "Selection score",
                        "signal_value": parse_float(signal.get("signal")),
                    },
                },
                "signal": signal,
            })

    latest_signal = state.get("last_signal") if isinstance(state.get("last_signal"), dict) else {}
    final_account = next((row for row in reversed(account) if row.get("equity") is not None), {})
    final_positions = final_account.get("positions") if isinstance(final_account.get("positions"), dict) else {}
    summary = {
        "mode": state.get("last_mode") or ("simulated_paper" if modes.get("True") else "paper"),
        "loop_enabled": True,
        "loop_iterations": len(decisions),
        "decisions": len(decisions),
        "orders": len(orders),
        "fills": len(fills),
        "rejections": sum(1 for row in orders if str(row.get("status") or "").lower() in {"rejected", "cancelled", "canceled"}),
        "final_cash": final_account.get("cash"),
        "final_equity": final_account.get("equity"),
        "final_positions": final_positions,
        "account_snapshot_count": len(account),
        "latest_data_time": latest_timestamp(data_times),
        "latest_bar_time": latest_timestamp(data_times),
        "latest_signal_reason": latest_signal.get("reason"),
        "latest_signal_label": "Selection score",
        "latest_signal_value": parse_float(latest_signal.get("signal")),
        "next_check_reason": "scheduled_runner",
    }
    write_run_artifacts(
        out_dir,
        summary=summary,
        runner_status={
            "state": "running",
            "updated_at": utc_now().isoformat(),
            "latest_signal_reason": summary["latest_signal_reason"],
            "latest_signal_value": summary["latest_signal_value"],
            "next_check_reason": "scheduled_runner",
        },
        decisions=decisions,
        orders=orders,
        fills=fills,
        account=account,
        symbols=sorted(symbols),
        bridge_kind="legacy_crypto_csv_sessions",
    )
    return {"run_dir": str(out_dir), "decisions": len(decisions), "orders": len(orders), "fills": len(fills)}


def account_values_from_snapshot(path: Path) -> dict[str, float | None]:
    payload = read_json(path)
    values: dict[str, float] = {}
    rows = payload.get("raw") if isinstance(payload.get("raw"), list) else []
    for row in rows:
        if not isinstance(row, dict) or row.get("currency") not in {"USD", ""}:
            continue
        tag = str(row.get("tag") or "")
        value = parse_float(row.get("value"))
        if tag and value is not None and tag not in values:
            values[tag] = value
    return {
        "cash": values.get("TotalCashValue") or values.get("CashBalance") or values.get("AvailableFunds"),
        "equity": values.get("NetLiquidation") or values.get("EquityWithLoanValue"),
        "gross_exposure": values.get("GrossPositionValue"),
        "net_exposure": values.get("GrossPositionValue"),
    }


def stock_decision_from_signal(row: dict[str, str], manifest: dict[str, Any], session: Path) -> dict[str, Any]:
    accepted = parse_bool(row.get("accepted"))
    reason = "accepted" if accepted else (row.get("reject_reason") or "rejected")
    return {
        "timestamp": iso_or_none(first_value(manifest.get("run_finished_at"), manifest.get("run_started_at"), row.get("date"))),
        "mode": "signal_monitor",
        "step": session.name,
        "intents": [],
        "diagnostics": {
            "symbols": [row.get("symbol")] if row.get("symbol") else [],
            "dashboard": {
                "reason": reason,
                "signal_label": "Accepted candidate",
                "signal_value": 1.0 if accepted else 0.0,
                "threshold": 1.0,
                "threshold_distance": 0.0 if accepted else -1.0,
                "near_threshold": False,
            },
        },
        "signal": {
            "symbol": row.get("symbol") or None,
            "side": row.get("side") or None,
            "reason": reason,
        },
    }


def build_stock_run(sessions_root: Path, out_dir: Path, *, max_sessions: int) -> dict[str, Any]:
    decisions: list[dict[str, Any]] = []
    account: list[dict[str, Any]] = []
    data_times: list[str] = []
    symbols: set[str] = set()
    accepted = 0
    rejected = 0
    latest_reason = None

    for session in session_dirs(sessions_root, max_sessions=max_sessions):
        manifest = read_json(session / "manifest.json")
        latest_bar = max_bar_timestamp(session / "today_bars.csv")
        if latest_bar:
            data_times.append(latest_bar)
        account_values = account_values_from_snapshot(session / "account_snapshot.json")
        if account_values:
            account.append({
                "timestamp": iso_or_none(first_value(manifest.get("run_finished_at"), manifest.get("run_started_at"))),
                "cash": account_values.get("cash"),
                "equity": account_values.get("equity"),
                "positions": {},
                "gross_exposure": account_values.get("gross_exposure"),
                "net_exposure": account_values.get("net_exposure"),
            })
        for row in read_csv_rows(session / "shadow_signals.csv"):
            decision = stock_decision_from_signal(row, manifest, session)
            decisions.append(decision)
            if row.get("symbol"):
                symbols.add(row["symbol"])
            if parse_bool(row.get("accepted")):
                accepted += 1
            else:
                rejected += 1
            latest_reason = decision["signal"].get("reason")
        for symbol_row in read_csv_rows(session / "subscriptions.csv"):
            if symbol_row.get("symbol"):
                symbols.add(symbol_row["symbol"])

    final_account = next((row for row in reversed(account) if row.get("equity") is not None), {})
    summary = {
        "mode": "signal_monitor",
        "loop_enabled": True,
        "loop_iterations": len(decisions),
        "decisions": len(decisions),
        "orders": 0,
        "fills": 0,
        "rejections": 0,
        "final_cash": final_account.get("cash"),
        "final_equity": final_account.get("equity"),
        "final_positions": {},
        "account_snapshot_count": len(account),
        "latest_data_time": latest_timestamp(data_times),
        "latest_bar_time": latest_timestamp(data_times),
        "latest_signal_reason": latest_reason,
        "latest_signal_label": "Accepted candidate",
        "latest_signal_value": 1.0 if accepted else (0.0 if rejected else None),
        "accepted_signals": accepted,
        "rejected_signals": rejected,
        "next_check_reason": "market_session_schedule",
    }
    write_run_artifacts(
        out_dir,
        summary=summary,
        runner_status={
            "state": "signal_monitor",
            "updated_at": utc_now().isoformat(),
            "latest_signal_reason": latest_reason,
            "next_check_reason": "market_session_schedule",
        },
        decisions=decisions,
        orders=[],
        fills=[],
        account=account,
        symbols=sorted(symbols),
        bridge_kind="legacy_stock_csv_sessions",
    )
    return {"run_dir": str(out_dir), "decisions": len(decisions), "orders": 0, "fills": 0}


def write_run_artifacts(
    out_dir: Path,
    *,
    summary: dict[str, Any],
    runner_status: dict[str, Any],
    decisions: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    fills: list[dict[str, Any]],
    account: list[dict[str, Any]],
    symbols: list[str],
    bridge_kind: str,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "summary.json", summary)
    write_json(out_dir / "runner_status.json", runner_status)
    write_json(out_dir / "plugin_contract.json", {
        "schema_version": 1,
        "plugin": {
            "name": bridge_kind,
            "spec": "legacy_runtime_status_bridge",
            "validator_count": 0,
        },
        "data": {
            "symbols": symbols,
            "file_count": 0,
        },
        "observed": {
            "dashboard_keys": ["reason", "signal_label", "signal_value", "threshold_distance"],
            "intent_metadata_keys": [],
        },
    })
    write_jsonl(out_dir / "decisions.jsonl", decisions)
    write_jsonl(out_dir / "orders.jsonl", orders)
    write_jsonl(out_dir / "fills.jsonl", fills)
    write_jsonl(out_dir / "account.jsonl", account)


def build_supervisor_status(state_path: Path, out_path: Path) -> dict[str, Any]:
    state = read_json(state_path)
    now = utc_now().isoformat()
    jobs = []
    for key, value in sorted(state.items()):
        if value in {None, ""}:
            continue
        jobs.append({
            "id": key,
            "status": "observed",
            "last_seen_at": iso_or_none(value) if key.endswith(("_at", "_started")) else None,
            "value": value,
        })
    payload = {
        "status": "ok" if state else "missing",
        "generated_at": now,
        "jobs": jobs,
    }
    write_json(out_path, payload)
    return {"path": str(out_path), "jobs": len(jobs)}


def build_parser() -> argparse.ArgumentParser:
    parser = argparse.ArgumentParser(description="Bridge legacy paper runtime artifacts into generic dashboard telemetry")
    parser.add_argument("--crypto-state", type=Path, default=Path("paper_logs/crypto_hourly_reversal/state.json"))
    parser.add_argument("--crypto-sessions", type=Path, default=Path("paper_logs/crypto_hourly_reversal/sessions"))
    parser.add_argument("--crypto-out", type=Path, default=Path("paper_logs/runtime_status/crypto_hourly_reversal"))
    parser.add_argument("--stock-sessions", type=Path, default=Path("paper_logs/sip_orb_fail/sessions"))
    parser.add_argument("--stock-out", type=Path, default=Path("paper_logs/runtime_status/stock_intraday"))
    parser.add_argument("--supervisor-state", type=Path, default=Path("paper_logs/paper_supervisor/state.json"))
    parser.add_argument("--supervisor-out", type=Path, default=Path("paper_logs/runtime_status/paper_supervisor/status.json"))
    parser.add_argument("--max-sessions", type=int, default=500)
    parser.add_argument("--json", action="store_true")
    return parser


def main() -> None:
    args = build_parser().parse_args()
    result = {
        "generated_at": utc_now().isoformat(),
        "crypto": build_crypto_run(args.crypto_state, args.crypto_sessions, args.crypto_out, max_sessions=args.max_sessions),
        "stock": build_stock_run(args.stock_sessions, args.stock_out, max_sessions=args.max_sessions),
        "supervisor": build_supervisor_status(args.supervisor_state, args.supervisor_out),
    }
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(
            "runtime status bridge: "
            f"crypto decisions={result['crypto']['decisions']} "
            f"stock decisions={result['stock']['decisions']} "
            f"supervisor jobs={result['supervisor']['jobs']}"
        )


if __name__ == "__main__":
    main()
