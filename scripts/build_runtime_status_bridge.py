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
from dataclasses import dataclass
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


def finite_float(raw: Any) -> float | None:
    return parse_float(raw)


def sort_key_timestamp(row: dict[str, Any]) -> datetime:
    return parse_timestamp(row.get("timestamp")) or datetime.min.replace(tzinfo=timezone.utc)


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


@dataclass
class PositionLot:
    quantity: float
    price: float
    entry_time: str | None


@dataclass
class AccountingState:
    positions: dict[str, float]
    average_costs: dict[str, float]
    realized_pnl: float
    unrealized_pnl_by_symbol: dict[str, float]
    unrealized_pnl: float
    total_pnl: float
    total_commission: float
    gross_exposure: float
    net_exposure: float
    position_details: dict[str, dict[str, Any]]


def market_price_for_symbol(symbol: str, lots: list[PositionLot], prices: dict[str, float]) -> float | None:
    if symbol in prices:
        return prices[symbol]
    if lots:
        return lots[-1].price
    return None


def close_lots(lots: list[PositionLot], quantity: float, price: float) -> tuple[float, list[PositionLot]]:
    remaining = quantity
    realized = 0.0
    updated = [PositionLot(lot.quantity, lot.price, lot.entry_time) for lot in lots]
    while remaining > 1e-12 and updated:
        lot = updated[0]
        closed_qty = min(lot.quantity, remaining)
        realized += closed_qty * (price - lot.price)
        lot.quantity -= closed_qty
        remaining -= closed_qty
        if lot.quantity <= 1e-12:
            updated.pop(0)
    return realized, updated


def accounting_state_from_fills(fills: list[dict[str, Any]], prices: dict[str, float] | None = None) -> AccountingState:
    prices = prices or {}
    lots_by_symbol: dict[str, list[PositionLot]] = {}
    realized_pnl = 0.0
    total_commission = 0.0
    for fill in sorted(fills, key=sort_key_timestamp):
        symbol = str(fill.get("symbol") or "").strip()
        side = str(fill.get("side") or "").strip().lower()
        quantity = parse_float(fill.get("quantity")) or 0.0
        price = parse_float(fill.get("price")) or 0.0
        commission = parse_float(fill.get("commission")) or 0.0
        if not symbol or quantity <= 0 or price <= 0:
            continue
        total_commission += commission
        lots = lots_by_symbol.setdefault(symbol, [])
        if side == "buy":
            lots.append(PositionLot(quantity=quantity, price=price, entry_time=fill.get("timestamp")))
        elif side == "sell":
            closed_realized, updated_lots = close_lots(lots, quantity, price)
            lots_by_symbol[symbol] = updated_lots
            realized_pnl += closed_realized
        prices.setdefault(symbol, price)

    positions: dict[str, float] = {}
    average_costs: dict[str, float] = {}
    unrealized_by_symbol: dict[str, float] = {}
    position_details: dict[str, dict[str, Any]] = {}
    gross_exposure = 0.0
    net_exposure = 0.0
    unrealized_pnl = 0.0
    for symbol, lots in sorted(lots_by_symbol.items()):
        quantity = sum(lot.quantity for lot in lots)
        if quantity <= 1e-12:
            continue
        cost = sum(lot.quantity * lot.price for lot in lots)
        average_cost = cost / quantity if quantity else 0.0
        current_price = market_price_for_symbol(symbol, lots, prices) or average_cost
        market_value = quantity * current_price
        unrealized = quantity * (current_price - average_cost)
        positions[symbol] = quantity
        average_costs[symbol] = average_cost
        unrealized_by_symbol[symbol] = unrealized
        gross_exposure += abs(market_value)
        net_exposure += market_value
        unrealized_pnl += unrealized
        first_lot = lots[0]
        position_details[symbol] = {
            "entry_time": first_lot.entry_time,
            "entry_price": first_lot.price,
            "average_cost": average_cost,
            "current_price": current_price,
            "current_value": market_value,
            "unrealized_pnl": unrealized,
            "active_exit_rule": "trailing_stop",
            "exit_state": "holding",
        }
    return AccountingState(
        positions=positions,
        average_costs=average_costs,
        realized_pnl=realized_pnl,
        unrealized_pnl_by_symbol=unrealized_by_symbol,
        unrealized_pnl=unrealized_pnl,
        total_pnl=realized_pnl + unrealized_pnl,
        total_commission=total_commission,
        gross_exposure=gross_exposure,
        net_exposure=net_exposure,
        position_details=position_details,
    )


def max_gross_exposure_from_fills(fills: list[dict[str, Any]]) -> float:
    positions: dict[str, float] = {}
    prices: dict[str, float] = {}
    max_gross = 0.0
    for fill in sorted(fills, key=sort_key_timestamp):
        symbol = str(fill.get("symbol") or "").strip()
        side = str(fill.get("side") or "").strip().lower()
        quantity = parse_float(fill.get("quantity")) or 0.0
        price = parse_float(fill.get("price")) or 0.0
        if not symbol or quantity <= 0 or price <= 0:
            continue
        signed_quantity = quantity if side == "buy" else -quantity if side == "sell" else 0.0
        positions[symbol] = positions.get(symbol, 0.0) + signed_quantity
        if abs(positions[symbol]) <= 1e-12:
            positions.pop(symbol, None)
        prices[symbol] = price
        gross = sum(abs(qty * prices.get(sym, 0.0)) for sym, qty in positions.items())
        max_gross = max(max_gross, gross)
    return max_gross


def exposure_by_day_from_fills(fills: list[dict[str, Any]]) -> dict[str, dict[str, float]]:
    positions: dict[str, float] = {}
    prices: dict[str, float] = {}
    by_day: dict[str, dict[str, float]] = {}
    for fill in sorted(fills, key=sort_key_timestamp):
        symbol = str(fill.get("symbol") or "").strip()
        side = str(fill.get("side") or "").strip().lower()
        quantity = parse_float(fill.get("quantity")) or 0.0
        price = parse_float(fill.get("price")) or 0.0
        day = row_utc_day(fill)
        if not symbol or quantity <= 0 or price <= 0 or not day:
            continue
        signed_quantity = quantity if side == "buy" else -quantity if side == "sell" else 0.0
        positions[symbol] = positions.get(symbol, 0.0) + signed_quantity
        if abs(positions[symbol]) <= 1e-12:
            positions.pop(symbol, None)
        prices[symbol] = price
        gross = sum(abs(qty * prices.get(sym, 0.0)) for sym, qty in positions.items())
        net = sum(qty * prices.get(sym, 0.0) for sym, qty in positions.items())
        current = by_day.setdefault(day, {"max_gross_exposure": 0.0, "max_abs_net_exposure": 0.0})
        current["max_gross_exposure"] = max(current["max_gross_exposure"], gross)
        current["max_abs_net_exposure"] = max(current["max_abs_net_exposure"], abs(net))
    return by_day


def normalized_positions(raw: Any) -> dict[str, float] | None:
    if not isinstance(raw, dict):
        return None
    positions = {
        str(symbol): quantity
        for symbol, raw_quantity in raw.items()
        if (quantity := parse_float(raw_quantity)) is not None and abs(quantity) > 1e-12
    }
    return positions


def positions_close(left: dict[str, float], right: dict[str, float], *, tolerance: float = 1e-6) -> bool:
    symbols = set(left) | set(right)
    return all(abs(left.get(symbol, 0.0) - right.get(symbol, 0.0)) <= tolerance for symbol in symbols)


def exposure_from_positions(positions: dict[str, float], prices: dict[str, float]) -> tuple[float, float]:
    gross = 0.0
    net = 0.0
    for symbol, quantity in positions.items():
        price = prices.get(symbol)
        if price is None:
            continue
        value = quantity * price
        gross += abs(value)
        net += value
    return gross, net


def row_utc_day(row: dict[str, Any]) -> str | None:
    parsed = parse_timestamp(row.get("timestamp"))
    return parsed.date().isoformat() if parsed else None


def count_events_by_day(rows: list[dict[str, Any]], *, rejected_only: bool = False) -> dict[str, int]:
    counts: dict[str, int] = {}
    for row in rows:
        if rejected_only:
            status = str(row.get("status") or row.get("order_status") or "").strip().lower()
            if status not in {"rejected", "cancelled", "canceled", "error"}:
                continue
        day = row_utc_day(row)
        if not day:
            continue
        counts[day] = counts.get(day, 0) + 1
    return counts


def position_count(row: dict[str, Any]) -> int:
    positions = row.get("positions")
    if not isinstance(positions, dict):
        return 0
    return sum(1 for value in positions.values() if parse_float(value) not in (None, 0.0))


def daily_account_rollups(
    account: list[dict[str, Any]],
    *,
    orders: list[dict[str, Any]],
    fills: list[dict[str, Any]],
    mode: str | None,
    include_fill_exposure: bool,
) -> list[dict[str, Any]]:
    by_day: dict[str, list[dict[str, Any]]] = {}
    for row in account:
        day = row_utc_day(row)
        equity = parse_float(row.get("equity"))
        if not day or equity is None:
            continue
        enriched = dict(row)
        enriched["_timestamp"] = sort_key_timestamp(row)
        by_day.setdefault(day, []).append(enriched)
    order_counts = count_events_by_day(orders)
    fill_counts = count_events_by_day(fills)
    rejection_counts = count_events_by_day(orders, rejected_only=True)
    fill_exposure = exposure_by_day_from_fills(fills) if include_fill_exposure else {}

    rollups: list[dict[str, Any]] = []
    for day, rows in by_day.items():
        ordered = sorted(rows, key=lambda item: item["_timestamp"])
        start = ordered[0]
        end = ordered[-1]
        start_equity = parse_float(start.get("equity"))
        end_equity = parse_float(end.get("equity"))
        daily_return_pct = (
            ((end_equity / start_equity) - 1.0) * 100.0
            if start_equity and end_equity is not None
            else None
        )
        gross_values = [parse_float(row.get("gross_exposure")) for row in ordered]
        gross_values = [value for value in gross_values if value is not None]
        net_values = [parse_float(row.get("net_exposure")) for row in ordered]
        net_values = [value for value in net_values if value is not None]
        fill_day_exposure = fill_exposure.get(day, {})
        max_gross = max(
            [*gross_values, parse_float(fill_day_exposure.get("max_gross_exposure")) or 0.0],
            default=None,
        )
        max_abs_net = max(
            [*(abs(value) for value in net_values), parse_float(fill_day_exposure.get("max_abs_net_exposure")) or 0.0],
            default=None,
        )
        rollups.append({
            "day": day,
            "mode": mode,
            "snapshot_count": len(ordered),
            "account_start_time": start["_timestamp"].isoformat(),
            "account_end_time": end["_timestamp"].isoformat(),
            "start_equity": start_equity,
            "end_equity": end_equity,
            "daily_return_pct": finite_float(daily_return_pct),
            "max_gross_exposure": finite_float(max_gross),
            "max_abs_net_exposure": finite_float(max_abs_net),
            "max_position_count": max(position_count(row) for row in ordered),
            "realized_pnl": finite_float(end.get("realized_pnl")),
            "unrealized_pnl": finite_float(end.get("unrealized_pnl")),
            "total_pnl": finite_float(end.get("total_pnl")),
            "total_commission": finite_float(end.get("total_commission")),
            "total_borrow_fees": finite_float(end.get("total_borrow_fees")),
            "order_count": order_counts.get(day, 0),
            "fill_count": fill_counts.get(day, 0),
            "rejection_count": rejection_counts.get(day, 0),
        })
    return sorted(rollups, key=lambda row: str(row.get("day") or ""), reverse=True)


def period_account_rollups(rows: list[dict[str, Any]], *, period: str) -> list[dict[str, Any]]:
    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in rows:
        day = str(row.get("day") or "")
        if len(day) < 7:
            continue
        label = day[:7] if period == "month" else day[:4]
        grouped.setdefault(label, []).append(row)
    out: list[dict[str, Any]] = []
    for label, group in grouped.items():
        ordered = sorted(group, key=lambda item: str(item.get("day") or ""))
        start = ordered[0]
        end = ordered[-1]
        start_equity = parse_float(start.get("start_equity"))
        end_equity = parse_float(end.get("end_equity"))
        total_return_pct = (
            ((end_equity / start_equity) - 1.0) * 100.0
            if start_equity and end_equity is not None
            else None
        )
        out.append({
            "label": label,
            "first_day": start.get("day"),
            "last_day": end.get("day"),
            "day_count": len(ordered),
            "start_equity": start_equity,
            "end_equity": end_equity,
            "total_return_pct": finite_float(total_return_pct),
            "snapshot_count": sum(int(row.get("snapshot_count") or 0) for row in ordered),
            "max_gross_exposure": finite_float(max((parse_float(row.get("max_gross_exposure")) or 0.0 for row in ordered), default=None)),
            "max_abs_net_exposure": finite_float(max((parse_float(row.get("max_abs_net_exposure")) or 0.0 for row in ordered), default=None)),
            "max_position_count": max(int(row.get("max_position_count") or 0) for row in ordered),
            "order_count": sum(int(row.get("order_count") or 0) for row in ordered),
            "fill_count": sum(int(row.get("fill_count") or 0) for row in ordered),
            "rejection_count": sum(int(row.get("rejection_count") or 0) for row in ordered),
        })
    return sorted(out, key=lambda row: str(row.get("label") or ""), reverse=True)


def build_performance_rollups(
    *,
    out_dir: Path,
    summary: dict[str, Any],
    account: list[dict[str, Any]],
    orders: list[dict[str, Any]],
    fills: list[dict[str, Any]],
    bridge_kind: str,
    include_fill_exposure: bool,
) -> dict[str, Any]:
    daily = daily_account_rollups(
        account,
        orders=orders,
        fills=fills,
        mode=summary.get("mode"),
        include_fill_exposure=include_fill_exposure,
    )
    return {
        "schema_version": 1,
        "generated_at": utc_now().isoformat(),
        "source": "legacy_runtime_status_bridge",
        "bridge_kind": bridge_kind,
        "mode": summary.get("mode"),
        "output_dir": str(out_dir),
        "summary": {
            "decisions": summary.get("decisions"),
            "orders": summary.get("orders"),
            "fills": summary.get("fills"),
            "rejections": summary.get("rejections"),
            "account_snapshot_count": summary.get("account_snapshot_count"),
            "initial_equity": daily[-1].get("start_equity") if daily else None,
            "final_equity": summary.get("final_equity"),
            "total_return_pct": summary.get("total_return_pct"),
            "max_drawdown_pct": summary.get("max_drawdown_pct"),
            "account_start_time": daily[-1].get("account_start_time") if daily else None,
            "account_end_time": daily[0].get("account_end_time") if daily else None,
        },
        "rollups": daily,
        "period_rollups": {
            "month": period_account_rollups(daily, period="month"),
            "year": period_account_rollups(daily, period="year"),
        },
        "count": len(daily),
        "total": len(daily),
    }


def equity_delta(account_rows: list[dict[str, Any]]) -> float | None:
    equities = [parse_float(row.get("equity")) for row in account_rows]
    equities = [value for value in equities if value is not None]
    if len(equities) < 2:
        return None
    return equities[-1] - equities[0]


def account_from_crypto_signal(
    row: dict[str, str],
    state: dict[str, Any] | None = None,
    accounting: AccountingState | None = None,
) -> dict[str, Any]:
    cash = parse_float(row.get("cash"))
    equity = parse_float(row.get("estimated_equity"))
    positions = accounting.positions if accounting is not None else state.get("sim_positions", {}) if isinstance(state, dict) else {}
    gross = accounting.gross_exposure if accounting is not None else None
    net = accounting.net_exposure if accounting is not None else None
    return {
        "timestamp": iso_or_none(first_value(row.get("run_started_at"), row.get("decision_hour"))),
        "cash": cash,
        "equity": equity,
        "positions": positions if isinstance(positions, dict) else {},
        "gross_exposure": gross,
        "net_exposure": net,
        "gross_exposure_pct": (gross / equity) * 100.0 if equity and gross is not None else None,
        "net_exposure_pct": (net / equity) * 100.0 if equity and net is not None else None,
        "average_costs": accounting.average_costs if accounting is not None else {},
        "unrealized_pnl_by_symbol": accounting.unrealized_pnl_by_symbol if accounting is not None else {},
        "position_details": accounting.position_details if accounting is not None else {},
        "realized_pnl": accounting.realized_pnl if accounting is not None else None,
        "unrealized_pnl": accounting.unrealized_pnl if accounting is not None else None,
        "total_pnl": accounting.total_pnl if accounting is not None else None,
        "total_commission": accounting.total_commission if accounting is not None else None,
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
    signal_rows_by_session: list[tuple[Path, dict[str, str]]] = []

    for session in session_dirs(sessions_root, max_sessions=max_sessions):
        signal_rows = read_csv_rows(session / "signal.csv")
        for row in signal_rows:
            signal_rows_by_session.append((session, row))
            if row.get("latest_data_time"):
                data_times.append(row["latest_data_time"])
            symbols.update(split_symbols(row.get("target_symbols")))
            if row.get("target_symbol"):
                symbols.add(row["target_symbol"])
            modes[str(row.get("simulate_fills"))] += 1
        orders.extend(crypto_order_from_row(row) for row in read_csv_rows(session / "orders.csv"))
        fills.extend(fill_from_row(row) for row in read_csv_rows(session / "fills.csv"))

    state_prices = state.get("sim_last_prices") if isinstance(state.get("sim_last_prices"), dict) else {}
    prices = {
        str(symbol): price
        for symbol, raw_price in state_prices.items()
        if (price := parse_float(raw_price)) is not None
    }

    final_accounting = accounting_state_from_fills(fills, prices.copy())
    state_positions = normalized_positions(state.get("sim_positions"))
    reconstructed_positions_match_state = (
        state_positions is None or positions_close(final_accounting.positions, state_positions)
    )

    for session, row in signal_rows_by_session:
        timestamp = parse_timestamp(first_value(row.get("run_started_at"), row.get("decision_hour")))
        fills_to_date = [
            fill
            for fill in fills
            if timestamp is None or sort_key_timestamp(fill) <= timestamp
        ]
        accounting = (
            accounting_state_from_fills(fills_to_date, prices.copy())
            if reconstructed_positions_match_state
            else None
        )
        decisions.append(crypto_decision_from_signal(row, session))
        account.append(account_from_crypto_signal(row, state, accounting))

    if state:
        final_equity = parse_float(state.get("sim_equity"))
        authoritative_positions = state_positions if state_positions is not None else final_accounting.positions
        authoritative_gross, authoritative_net = exposure_from_positions(authoritative_positions, prices)
        pnl_from_equity = equity_delta(account + [{"equity": final_equity}]) if final_equity is not None else None
        if reconstructed_positions_match_state:
            realized_pnl = final_accounting.realized_pnl
            unrealized_pnl = final_accounting.unrealized_pnl
            total_pnl = final_accounting.total_pnl
            average_costs = final_accounting.average_costs
            unrealized_by_symbol = final_accounting.unrealized_pnl_by_symbol
            position_details = final_accounting.position_details
        else:
            realized_pnl = pnl_from_equity if not authoritative_positions else None
            unrealized_pnl = 0.0 if not authoritative_positions else None
            total_pnl = pnl_from_equity
            average_costs = {}
            unrealized_by_symbol = {}
            position_details = {}
        account.append({
            "timestamp": iso_or_none(state.get("last_run_at")),
            "cash": parse_float(state.get("sim_cash")),
            "equity": final_equity,
            "positions": authoritative_positions,
            "gross_exposure": authoritative_gross,
            "net_exposure": authoritative_net,
            "gross_exposure_pct": (
                authoritative_gross / final_equity * 100.0
                if final_equity else None
            ),
            "net_exposure_pct": (
                authoritative_net / final_equity * 100.0
                if final_equity else None
            ),
            "average_costs": average_costs,
            "unrealized_pnl_by_symbol": unrealized_by_symbol,
            "position_details": position_details,
            "realized_pnl": realized_pnl,
            "unrealized_pnl": unrealized_pnl,
            "total_pnl": total_pnl,
            "total_commission": final_accounting.total_commission,
            "accounting_source": "fills" if reconstructed_positions_match_state else "state_equity",
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
    max_gross_exposure = max((parse_float(row.get("gross_exposure")) or 0.0 for row in account), default=0.0)
    max_abs_net_exposure = max((abs(parse_float(row.get("net_exposure")) or 0.0) for row in account), default=0.0)
    initial_equity = next((parse_float(row.get("equity")) for row in account if parse_float(row.get("equity")) is not None), None)
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
        "realized_pnl": final_account.get("realized_pnl"),
        "unrealized_pnl": final_account.get("unrealized_pnl"),
        "total_pnl": final_account.get("total_pnl"),
        "total_commission": final_account.get("total_commission"),
        "max_gross_exposure": max_gross_exposure,
        "max_gross_exposure_pct": (max_gross_exposure / initial_equity * 100.0) if initial_equity else None,
        "max_abs_net_exposure": max_abs_net_exposure,
        "max_abs_net_exposure_pct": (max_abs_net_exposure / initial_equity * 100.0) if initial_equity else None,
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
        include_fill_exposure_rollups=False,
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


def stock_order_from_entry_row(row: dict[str, str]) -> dict[str, Any]:
    status = str(row.get("entry_status") or "").strip().lower() or "unknown"
    return {
        "timestamp": iso_or_none(row.get("timestamp")),
        "status": status,
        "symbol": row.get("symbol") or None,
        "side": (row.get("entry_action") or "").lower() or None,
        "order_type": row.get("entry_order_type") or None,
        "quantity": parse_float(first_value(row.get("filled_qty"), row.get("quantity"))),
        "reason": None,
        "tag": "entry",
        "avg_fill_price": parse_float(row.get("avg_fill_price")),
        "order_status": row.get("entry_status") or None,
        "message": row.get("entry_message") or None,
    }


def stock_order_from_eod_row(row: dict[str, str]) -> dict[str, Any]:
    return {
        "timestamp": iso_or_none(row.get("timestamp")),
        "status": (row.get("status") or "unknown").strip().lower(),
        "symbol": row.get("symbol") or None,
        "side": (row.get("action") or "").lower() or None,
        "order_type": "MKT",
        "quantity": parse_float(row.get("quantity")),
        "reason": "eod_flatten",
        "tag": "exit",
        "avg_fill_price": parse_float(row.get("avg_price")),
        "order_status": row.get("status") or None,
        "message": row.get("message") or None,
    }


def stock_fill_from_entry_row(row: dict[str, str]) -> dict[str, Any]:
    return {
        "timestamp": iso_or_none(row.get("timestamp")),
        "symbol": row.get("symbol") or None,
        "side": (row.get("entry_action") or "").lower() or None,
        "quantity": parse_float(row.get("quantity")),
        "price": parse_float(row.get("avg_price")),
        "commission": parse_float(row.get("commission")) or 0.0,
        "tag": "entry",
        "simulated": False,
    }


def stock_fill_from_eod_row(row: dict[str, str]) -> dict[str, Any]:
    return {
        "timestamp": iso_or_none(row.get("timestamp")),
        "symbol": row.get("symbol") or None,
        "side": (row.get("action") or "").lower() or None,
        "quantity": parse_float(row.get("quantity")),
        "price": parse_float(row.get("avg_price")),
        "commission": 0.0,
        "tag": "exit",
        "simulated": False,
    }


def build_stock_run(
    sessions_root: Path,
    out_dir: Path,
    *,
    order_log: Path,
    fill_log: Path,
    eod_flatten_log: Path,
    max_sessions: int,
) -> dict[str, Any]:
    decisions: list[dict[str, Any]] = []
    account: list[dict[str, Any]] = []
    orders: list[dict[str, Any]] = []
    fills: list[dict[str, Any]] = []
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

    entry_order_rows = read_csv_rows(order_log)
    entry_fill_rows = read_csv_rows(fill_log)
    eod_rows = read_csv_rows(eod_flatten_log)
    orders.extend(stock_order_from_entry_row(row) for row in entry_order_rows)
    orders.extend(stock_order_from_eod_row(row) for row in eod_rows)
    fills.extend(stock_fill_from_entry_row(row) for row in entry_fill_rows)
    fills.extend(stock_fill_from_eod_row(row) for row in eod_rows if str(row.get("status") or "").lower() == "filled")
    orders.sort(key=sort_key_timestamp)
    fills.sort(key=sort_key_timestamp)
    symbols.update(str(row.get("symbol")) for row in orders if row.get("symbol"))

    final_accounting = accounting_state_from_fills(fills, {})
    max_fill_gross_exposure = max_gross_exposure_from_fills(fills)
    final_account = next((row for row in reversed(account) if row.get("equity") is not None), {})
    if final_account:
        final_account.update({
            "positions": final_accounting.positions,
            "gross_exposure": final_accounting.gross_exposure,
            "net_exposure": final_accounting.net_exposure,
            "gross_exposure_pct": (
                final_accounting.gross_exposure / final_account["equity"] * 100.0
                if final_account.get("equity") else None
            ),
            "net_exposure_pct": (
                final_accounting.net_exposure / final_account["equity"] * 100.0
                if final_account.get("equity") else None
            ),
            "average_costs": final_accounting.average_costs,
            "unrealized_pnl_by_symbol": final_accounting.unrealized_pnl_by_symbol,
            "position_details": final_accounting.position_details,
            "realized_pnl": final_accounting.realized_pnl,
            "unrealized_pnl": final_accounting.unrealized_pnl,
            "total_pnl": final_accounting.total_pnl,
            "total_commission": final_accounting.total_commission,
            "accounting_source": "fills",
        })
    max_gross_exposure = max(max_fill_gross_exposure, final_accounting.gross_exposure, max((parse_float(row.get("gross_exposure")) or 0.0 for row in account), default=0.0))
    max_abs_net_exposure = max(max_fill_gross_exposure, abs(final_accounting.net_exposure), max((abs(parse_float(row.get("net_exposure")) or 0.0) for row in account), default=0.0))
    initial_equity = next((parse_float(row.get("equity")) for row in account if parse_float(row.get("equity")) is not None), None)
    summary = {
        "mode": "paper" if orders or fills else "signal_monitor",
        "loop_enabled": True,
        "loop_iterations": len(decisions),
        "decisions": len(decisions),
        "orders": len(orders),
        "fills": len(fills),
        "rejections": sum(1 for row in orders if str(row.get("status") or "").lower() in {"rejected", "cancelled", "canceled", "error"}),
        "final_cash": final_account.get("cash"),
        "final_equity": final_account.get("equity"),
        "final_positions": final_accounting.positions,
        "account_snapshot_count": len(account),
        "realized_pnl": final_accounting.realized_pnl,
        "unrealized_pnl": final_accounting.unrealized_pnl,
        "total_pnl": final_accounting.total_pnl,
        "total_commission": final_accounting.total_commission,
        "max_gross_exposure": max_gross_exposure,
        "max_gross_exposure_pct": (max_gross_exposure / initial_equity * 100.0) if initial_equity else None,
        "max_abs_net_exposure": max_abs_net_exposure,
        "max_abs_net_exposure_pct": (max_abs_net_exposure / initial_equity * 100.0) if initial_equity else None,
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
        orders=orders,
        fills=fills,
        account=account,
        symbols=sorted(symbols),
        bridge_kind="legacy_stock_csv_sessions",
        include_fill_exposure_rollups=True,
    )
    return {"run_dir": str(out_dir), "decisions": len(decisions), "orders": len(orders), "fills": len(fills)}


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
    include_fill_exposure_rollups: bool,
) -> None:
    out_dir.mkdir(parents=True, exist_ok=True)
    write_json(out_dir / "summary.json", summary)
    write_json(out_dir / "runner_status.json", runner_status)
    write_json(
        out_dir / "performance_rollups.json",
        build_performance_rollups(
            out_dir=out_dir,
            summary=summary,
            account=account,
            orders=orders,
            fills=fills,
            bridge_kind=bridge_kind,
            include_fill_exposure=include_fill_exposure_rollups,
        ),
    )
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
    parser.add_argument("--stock-order-log", type=Path, default=Path("paper_logs/sip_orb_fail/paper_orders.csv"))
    parser.add_argument("--stock-fill-log", type=Path, default=Path("paper_logs/sip_orb_fail/paper_fills.csv"))
    parser.add_argument("--stock-eod-flatten-log", type=Path, default=Path("paper_logs/sip_orb_fail/paper_eod_flatten.csv"))
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
        "stock": build_stock_run(
            args.stock_sessions,
            args.stock_out,
            order_log=args.stock_order_log,
            fill_log=args.stock_fill_log,
            eod_flatten_log=args.stock_eod_flatten_log,
            max_sessions=args.max_sessions,
        ),
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
