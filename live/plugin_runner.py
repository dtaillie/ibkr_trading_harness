#!/usr/bin/env python3
"""Generic strategy-plugin runner.

This runner is intentionally strategy-neutral. It loads a plugin from config,
feeds it bar data, records decisions, and can run in replay, shadow,
simulated-paper, or explicitly confirmed IBKR paper mode.
"""

from __future__ import annotations

import argparse
import json
import logging
import math
import shutil
import sys
from dataclasses import asdict, dataclass, is_dataclass
from datetime import datetime, timezone
from enum import Enum
from pathlib import Path
from typing import Any

import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import Bar, Order, Side
from framework.plugin_loader import create_plugin, load_object
from framework.strategy_plugin import OrderIntent, StrategyContext
from live.ibkr_broker import IBKRBroker
from live.ibkr_data import BAR_SIZES, fetch_ibkr_bars


log = logging.getLogger(__name__)

VALID_MODES = {"replay", "shadow", "simulated_paper", "paper"}
SUPPORTED_ORDER_TYPES = {"market"}


@dataclass(frozen=True)
class RunnerResult:
    mode: str
    decisions: int
    orders: int
    fills: int
    rejections: int
    final_cash: float | None
    final_equity: float | None
    final_positions: dict[str, float]
    output_dir: Path
    account_snapshot_count: int = 0
    initial_equity: float | None = None
    total_return_pct: float | None = None
    max_drawdown_pct: float | None = None


class ConfigValidationError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("Invalid runner config:\n" + "\n".join(f"- {err}" for err in errors))


def normalize_mode(raw: str) -> str:
    mode = raw.replace("-", "_").lower()
    if mode not in VALID_MODES:
        raise ValueError(f"Unsupported mode {raw!r}; use one of {sorted(VALID_MODES)}")
    return mode


def read_config(path: Path) -> dict[str, Any]:
    with path.open() as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config must be a YAML mapping: {path}")
    return data


def plugin_spec(config: dict[str, Any]) -> str:
    metadata = config.get("metadata") or {}
    spec = metadata.get("strategy_plugin") or metadata.get("plugin")
    if not spec:
        raise ValueError("Config must define metadata.strategy_plugin")
    return str(spec)


def section(config: dict[str, Any], name: str, errors: list[str]) -> dict[str, Any]:
    raw = config.get(name) or {}
    if not isinstance(raw, dict):
        errors.append(f"{name} must be a mapping")
        return {}
    return raw


def validate_bool(value: Any, field: str, errors: list[str]) -> None:
    if value is not None and not isinstance(value, bool):
        errors.append(f"{field} must be true or false")


def validate_positive_int(value: Any, field: str, errors: list[str], *, allow_zero: bool = False) -> None:
    if value is None:
        return
    try:
        number = int(value)
    except (TypeError, ValueError):
        errors.append(f"{field} must be an integer")
        return
    if str(value).strip() not in {str(number), f"{number}.0"} and not isinstance(value, int):
        errors.append(f"{field} must be an integer")
        return
    if allow_zero:
        if number < 0:
            errors.append(f"{field} must be >= 0")
    elif number <= 0:
        errors.append(f"{field} must be > 0")


def validate_nonnegative_float(value: Any, field: str, errors: list[str], *, positive: bool = False) -> None:
    if value is None:
        return
    try:
        number = float(value)
    except (TypeError, ValueError):
        errors.append(f"{field} must be numeric")
        return
    if not math.isfinite(number):
        errors.append(f"{field} must be finite")
    elif positive and number <= 0:
        errors.append(f"{field} must be > 0")
    elif not positive and number < 0:
        errors.append(f"{field} must be >= 0")


def validate_string_list(value: Any, field: str, errors: list[str], *, allowed: set[str] | None = None) -> None:
    if value is None:
        return
    if not isinstance(value, list) or not value:
        errors.append(f"{field} must be a non-empty list")
        return
    normalized = {str(item).lower() for item in value}
    if allowed is not None:
        invalid = sorted(normalized - allowed)
        if invalid:
            errors.append(f"{field} contains unsupported values: {invalid}")


def validate_config(
    config: dict[str, Any],
    *,
    config_path: Path | None = None,
    mode_override: str | None = None,
    max_steps_override: int | None = None,
    check_files: bool = True,
    check_plugin: bool = True,
) -> list[str]:
    errors: list[str] = []
    metadata = section(config, "metadata", errors)
    runner_cfg = section(config, "runner", errors)
    data_cfg = section(config, "data", errors)
    execution_cfg = section(config, "execution", errors)
    broker_cfg = section(config, "broker", errors)
    control_cfg = section(config, "control", errors)
    section(config, "strategy", errors)

    try:
        spec = plugin_spec(config)
    except ValueError as exc:
        errors.append(str(exc))
        spec = ""
    if spec and check_plugin:
        try:
            load_object(spec)
        except Exception as exc:
            errors.append(f"metadata.strategy_plugin could not be imported: {exc}")
    if metadata.get("status") == "example_only" and runner_cfg.get("mode") == "paper":
        errors.append("example_only configs must not default to paper mode")

    mode_raw = mode_override or str(runner_cfg.get("mode", "replay"))
    try:
        normalize_mode(mode_raw)
    except ValueError as exc:
        errors.append(str(exc))

    validate_positive_int(runner_cfg.get("history_bars", 500), "runner.history_bars", errors)
    validate_positive_int(runner_cfg.get("max_steps"), "runner.max_steps", errors)
    if max_steps_override is not None:
        validate_positive_int(max_steps_override, "--max-steps", errors)
    validate_nonnegative_float(runner_cfg.get("starting_cash"), "runner.starting_cash", errors)
    validate_bool(runner_cfg.get("clean_output_dir"), "runner.clean_output_dir", errors)
    if runner_cfg.get("output_dir") is not None and not str(runner_cfg["output_dir"]).strip():
        errors.append("runner.output_dir must not be empty")
    if control_cfg.get("pause_marker") is not None and not str(control_cfg["pause_marker"]).strip():
        errors.append("control.pause_marker must not be empty")

    source = str(data_cfg.get("source", "files")).lower()
    if source not in {"files", "ibkr"}:
        errors.append("data.source must be files or ibkr")
    elif source == "files":
        files = data_cfg.get("files") or {}
        if not isinstance(files, dict) or not files:
            errors.append("data.source=files requires data.files mapping symbols to CSV/parquet paths")
        else:
            for raw_symbol, raw_path in files.items():
                symbol = str(raw_symbol).strip().upper()
                if not symbol:
                    errors.append("data.files contains an empty symbol")
                path = Path(str(raw_path))
                if path.suffix.lower() not in {".csv", ".parquet"}:
                    errors.append(f"data.files[{symbol}] must be a .csv or .parquet file")
                if check_files and not path.exists():
                    prefix = f"{config_path.parent}/" if config_path else ""
                    errors.append(f"data.files[{symbol}] does not exist: {prefix}{path}")
    elif source == "ibkr":
        symbols = data_cfg.get("symbols")
        if not isinstance(symbols, list) or not symbols:
            errors.append("data.source=ibkr requires non-empty data.symbols")
        ib_cfg = data_cfg.get("ibkr") or {}
        if not isinstance(ib_cfg, dict):
            errors.append("data.ibkr must be a mapping")
            ib_cfg = {}
        bar_size = str(ib_cfg.get("bar_size", data_cfg.get("bar_size", "5min")))
        if bar_size not in BAR_SIZES:
            errors.append(f"IBKR bar_size must be one of {sorted(BAR_SIZES)}")
        validate_positive_int(ib_cfg.get("port", 4002), "data.ibkr.port", errors)
        validate_positive_int(ib_cfg.get("client_id", 299), "data.ibkr.client_id", errors, allow_zero=True)
        validate_bool(ib_cfg.get("use_cache"), "data.ibkr.use_cache", errors)

    validate_string_list(execution_cfg.get("allowed_symbols"), "execution.allowed_symbols", errors)
    validate_string_list(execution_cfg.get("allowed_sides"), "execution.allowed_sides", errors, allowed={"buy", "sell"})
    validate_string_list(
        execution_cfg.get("allowed_order_types"),
        "execution.allowed_order_types",
        errors,
        allowed=SUPPORTED_ORDER_TYPES,
    )
    validate_bool(execution_cfg.get("allow_short"), "execution.allow_short", errors)
    validate_bool(execution_cfg.get("require_current_price"), "execution.require_current_price", errors)
    validate_bool(execution_cfg.get("allow_quantity_and_cash"), "execution.allow_quantity_and_cash", errors)
    validate_positive_int(execution_cfg.get("max_orders_per_run"), "execution.max_orders_per_run", errors)
    validate_nonnegative_float(execution_cfg.get("max_quantity"), "execution.max_quantity", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("max_cash_quantity"), "execution.max_cash_quantity", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("max_notional_per_order"), "execution.max_notional_per_order", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("max_gross_exposure_pct"), "execution.max_gross_exposure_pct", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("sim_slippage_bps"), "execution.sim_slippage_bps", errors)
    validate_nonnegative_float(execution_cfg.get("sim_commission_bps"), "execution.sim_commission_bps", errors)

    validate_positive_int(broker_cfg.get("port", 4002), "broker.port", errors)
    validate_positive_int(broker_cfg.get("client_id", 301), "broker.client_id", errors, allow_zero=True)
    if broker_cfg.get("host") is not None and not str(broker_cfg["host"]).strip():
        errors.append("broker.host must not be empty")

    return errors


def validate_config_file(
    config_path: Path,
    *,
    mode_override: str | None = None,
    max_steps_override: int | None = None,
) -> dict[str, Any]:
    config = read_config(config_path)
    errors = validate_config(
        config,
        config_path=config_path,
        mode_override=mode_override,
        max_steps_override=max_steps_override,
    )
    if errors:
        raise ConfigValidationError(errors)
    return config


def jsonable(value: Any) -> Any:
    if isinstance(value, pd.Timestamp):
        return value.isoformat()
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if isinstance(value, Enum):
        return value.name
    if is_dataclass(value):
        return jsonable(asdict(value))
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    if hasattr(value, "item"):
        try:
            return value.item()
        except Exception:
            pass
    return value


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(jsonable(record), sort_keys=True) + "\n")


def write_json(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w") as f:
        json.dump(jsonable(record), f, indent=2, sort_keys=True)
        f.write("\n")


def finite_float(raw: Any) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def normalize_frame(
    df: pd.DataFrame,
    *,
    symbol: str,
    timestamp_column: str = "timestamp",
) -> pd.DataFrame:
    if timestamp_column in df.columns:
        ts = pd.to_datetime(df[timestamp_column], utc=True)
        df = df.drop(columns=[timestamp_column]).copy()
        df.index = ts
    else:
        df = df.copy()
        df.index = pd.to_datetime(df.index, utc=True)
    df.index.name = "timestamp"
    df = df.rename(columns={c: c.lower() for c in df.columns})
    missing = [c for c in ("open", "high", "low", "close", "volume") if c not in df.columns]
    if missing:
        raise ValueError(f"{symbol}: missing required bar columns: {missing}")
    out = df[["open", "high", "low", "close", "volume"]].copy()
    for col in out.columns:
        out[col] = out[col].astype(float)
    out = out.sort_index()
    out = out[~out.index.duplicated(keep="last")]
    return out


def bars_to_frame(bars: list[Bar]) -> pd.DataFrame:
    rows = [
        {
            "timestamp": b.timestamp,
            "open": b.open,
            "high": b.high,
            "low": b.low,
            "close": b.close,
            "volume": b.volume,
        }
        for b in bars
    ]
    if not rows:
        return pd.DataFrame(columns=["open", "high", "low", "close", "volume"])
    return normalize_frame(pd.DataFrame(rows), symbol=bars[0].symbol)


def load_file_panels(data_cfg: dict[str, Any]) -> dict[str, pd.DataFrame]:
    files = data_cfg.get("files") or {}
    if not isinstance(files, dict) or not files:
        raise ValueError("data.source=files requires data.files mapping symbols to CSV/parquet paths")
    timestamp_column = str(data_cfg.get("timestamp_column", "timestamp"))
    panels: dict[str, pd.DataFrame] = {}
    for symbol, raw_path in files.items():
        path = Path(str(raw_path))
        if not path.exists():
            raise FileNotFoundError(path)
        if path.suffix.lower() == ".parquet":
            raw = pd.read_parquet(path)
        else:
            raw = pd.read_csv(path)
        panels[str(symbol).upper()] = normalize_frame(
            raw,
            symbol=str(symbol).upper(),
            timestamp_column=timestamp_column,
        )
    return panels


def load_ibkr_panels(data_cfg: dict[str, Any]) -> dict[str, pd.DataFrame]:
    from ib_insync import IB

    symbols = [str(s).upper() for s in data_cfg.get("symbols", [])]
    if not symbols:
        raise ValueError("data.source=ibkr requires data.symbols")
    ib_cfg = data_cfg.get("ibkr") or {}
    host = str(ib_cfg.get("host", "127.0.0.1"))
    port = int(ib_cfg.get("port", 4002))
    client_id = int(ib_cfg.get("client_id", 299))
    bar_size = str(ib_cfg.get("bar_size", data_cfg.get("bar_size", "5min")))
    duration = str(ib_cfg.get("duration", data_cfg.get("duration", "1 D")))
    use_rth = bool(ib_cfg.get("use_rth", data_cfg.get("use_rth", True)))
    what_to_show = ib_cfg.get("what_to_show", data_cfg.get("what_to_show"))
    crypto_exchange = ib_cfg.get("crypto_exchange", data_cfg.get("crypto_exchange"))

    ib = IB()
    log.info("Connecting to IBKR for data at %s:%d client_id=%d", host, port, client_id)
    ib.connect(host, port, clientId=client_id)
    try:
        panels = {}
        for symbol in symbols:
            bars = fetch_ibkr_bars(
                ib,
                symbol,
                duration=duration,
                bar_size=bar_size,
                use_rth=use_rth,
                use_cache=bool(ib_cfg.get("use_cache", False)),
                what_to_show=what_to_show,
                crypto_exchange=crypto_exchange,
            )
            panels[symbol] = bars_to_frame(bars)
            log.info("%s: loaded %d bars", symbol, len(panels[symbol]))
        return panels
    finally:
        ib.disconnect()


def load_panels(data_cfg: dict[str, Any]) -> dict[str, pd.DataFrame]:
    source = str(data_cfg.get("source", "files")).lower()
    if source == "files":
        return load_file_panels(data_cfg)
    if source == "ibkr":
        return load_ibkr_panels(data_cfg)
    raise ValueError(f"Unsupported data.source {source!r}; use files or ibkr")


def replay_times(panels: dict[str, pd.DataFrame]) -> list[pd.Timestamp]:
    times = sorted({ts for df in panels.values() for ts in df.index})
    if not times:
        raise ValueError("No bar timestamps available")
    return times


def latest_time(panels: dict[str, pd.DataFrame]) -> pd.Timestamp:
    latest = [df.index.max() for df in panels.values() if not df.empty]
    if not latest:
        raise ValueError("No bar timestamps available")
    return max(latest)


def snapshot_at(
    panels: dict[str, pd.DataFrame],
    now: pd.Timestamp,
    *,
    history_bars: int,
) -> dict[str, pd.DataFrame]:
    snapshot = {}
    for symbol, df in panels.items():
        scoped = df.loc[df.index <= now]
        if scoped.empty:
            continue
        snapshot[symbol] = scoped.tail(history_bars).copy()
    return snapshot


def latest_prices(snapshot: dict[str, pd.DataFrame]) -> dict[str, float]:
    return {
        symbol: float(df["close"].iloc[-1])
        for symbol, df in snapshot.items()
        if not df.empty
    }


def account_snapshot_record(
    *,
    now: pd.Timestamp,
    step: int,
    mode: str,
    cash: float | None,
    equity: float | None,
    positions: dict[str, float],
    prices: dict[str, float],
) -> dict[str, Any]:
    position_values = {
        symbol: float(qty) * float(prices.get(symbol, 0.0))
        for symbol, qty in positions.items()
    }
    gross_exposure = sum(abs(value) for value in position_values.values())
    net_exposure = sum(position_values.values())
    return {
        "timestamp": now,
        "step": step,
        "mode": mode,
        "cash": finite_float(cash),
        "equity": finite_float(equity),
        "positions": {symbol: finite_float(qty) for symbol, qty in positions.items()},
        "position_values": {symbol: finite_float(value) for symbol, value in position_values.items()},
        "gross_exposure": finite_float(gross_exposure),
        "net_exposure": finite_float(net_exposure),
    }


def account_metrics(records: list[dict[str, Any]]) -> dict[str, Any]:
    equity_values = [finite_float(row.get("equity")) for row in records]
    equity_values = [value for value in equity_values if value is not None]
    if not equity_values:
        return {
            "account_snapshot_count": len(records),
            "initial_equity": None,
            "total_return_pct": None,
            "max_drawdown_pct": None,
        }
    initial = equity_values[0]
    final = equity_values[-1]
    total_return_pct = ((final / initial) - 1.0) * 100.0 if initial else None
    peak = equity_values[0]
    max_drawdown = 0.0
    for value in equity_values:
        peak = max(peak, value)
        if peak > 0:
            max_drawdown = min(max_drawdown, (value / peak - 1.0) * 100.0)
    return {
        "account_snapshot_count": len(records),
        "initial_equity": initial,
        "total_return_pct": finite_float(total_return_pct),
        "max_drawdown_pct": finite_float(max_drawdown),
    }


class SimulatedExecutor:
    def __init__(self, cash: float, execution_cfg: dict[str, Any]):
        self.cash = float(cash)
        self.positions: dict[str, float] = {}
        self.allow_short = bool(execution_cfg.get("allow_short", False))
        self.slippage_bps = float(execution_cfg.get("sim_slippage_bps", 0.0))
        self.commission_bps = float(execution_cfg.get("sim_commission_bps", 0.0))

    def equity(self, prices: dict[str, float]) -> float:
        return self.cash + sum(qty * prices.get(symbol, 0.0) for symbol, qty in self.positions.items())

    def execute(self, intent: OrderIntent, price: float, now: pd.Timestamp) -> tuple[dict[str, Any] | None, str | None]:
        side = intent.side.lower()
        if side not in {"buy", "sell"}:
            return None, f"unsupported side {intent.side!r}"

        fill_price = float(price)
        if side == "buy":
            fill_price *= 1.0 + self.slippage_bps / 10000.0
        else:
            fill_price *= 1.0 - self.slippage_bps / 10000.0

        if intent.quantity is None:
            if intent.cash_quantity is None:
                return None, "quantity or cash_quantity is required"
            quantity = float(intent.cash_quantity) / fill_price
        else:
            quantity = float(intent.quantity)
        if quantity <= 0:
            return None, "quantity must be positive"

        notional = quantity * fill_price
        commission = notional * self.commission_bps / 10000.0
        current_qty = self.positions.get(intent.symbol, 0.0)

        if side == "buy":
            if notional + commission > self.cash + 1e-9:
                return None, "insufficient simulated cash"
            self.cash -= notional + commission
            self.positions[intent.symbol] = current_qty + quantity
        else:
            if not self.allow_short and quantity > current_qty + 1e-9:
                return None, "simulated short sale disabled"
            self.cash += notional - commission
            new_qty = current_qty - quantity
            if abs(new_qty) < 1e-9:
                self.positions.pop(intent.symbol, None)
            else:
                self.positions[intent.symbol] = new_qty

        return {
            "timestamp": now,
            "symbol": intent.symbol,
            "side": side,
            "quantity": quantity,
            "price": fill_price,
            "commission": commission,
            "tag": intent.tag,
            "simulated": True,
        }, None


class PaperExecutor:
    def __init__(self, broker_cfg: dict[str, Any]):
        self.broker = IBKRBroker(
            host=str(broker_cfg.get("host", "127.0.0.1")),
            port=int(broker_cfg.get("port", 4002)),
            client_id=int(broker_cfg.get("client_id", 301)),
        )
        self.connected = False

    def connect(self) -> None:
        if not self.connected:
            self.broker.connect()
            self.connected = True

    def disconnect(self) -> None:
        if self.connected:
            self.broker.disconnect()
            self.connected = False

    def cash(self) -> float:
        self.connect()
        return self.broker.get_cash()

    def positions(self) -> dict[str, float]:
        self.connect()
        return self.broker.get_positions()

    def execute(self, intent: OrderIntent, now: pd.Timestamp) -> tuple[dict[str, Any] | None, str | None]:
        side = intent.side.lower()
        if side not in {"buy", "sell"}:
            return None, f"unsupported side {intent.side!r}"
        if intent.quantity is None and intent.cash_quantity is None:
            return None, "quantity or cash_quantity is required"
        quantity = float(intent.quantity or 0.0)
        order = Order(
            symbol=intent.symbol,
            side=Side.BUY if side == "buy" else Side.SELL,
            quantity=quantity,
            timestamp=now.to_pydatetime(),
            tag=intent.tag,
            cash_quantity=float(intent.cash_quantity) if intent.cash_quantity is not None else None,
        )
        self.connect()
        fill = self.broker.submit_order(order)
        if fill is None:
            return None, self.broker.last_order_message or self.broker.last_order_status or "order not filled"
        return {
            "timestamp": fill.timestamp,
            "symbol": fill.symbol,
            "side": fill.side.name.lower(),
            "quantity": fill.quantity,
            "price": fill.price,
            "commission": fill.commission,
            "tag": fill.tag,
            "simulated": False,
        }, None


def intent_record(intent: OrderIntent, *, status: str, reason: str | None = None) -> dict[str, Any]:
    record = {
        "status": status,
        "symbol": intent.symbol,
        "side": intent.side,
        "quantity": intent.quantity,
        "cash_quantity": intent.cash_quantity,
        "order_type": intent.order_type,
        "tag": intent.tag,
        "metadata": intent.metadata,
    }
    if reason:
        record["reason"] = reason
    return record


def normalize_intent(intent: OrderIntent) -> OrderIntent:
    return OrderIntent(
        symbol=str(intent.symbol).upper(),
        side=str(intent.side).lower(),
        quantity=intent.quantity,
        cash_quantity=intent.cash_quantity,
        order_type=str(intent.order_type or "market").lower(),
        tag=str(intent.tag or ""),
        metadata=dict(intent.metadata or {}),
    )


def as_float(raw: Any, *, field: str) -> float | None:
    if raw is None:
        return None
    try:
        value = float(raw)
    except (TypeError, ValueError) as exc:
        raise ValueError(f"{field} must be numeric") from exc
    if not math.isfinite(value):
        raise ValueError(f"{field} must be finite")
    return value


def estimate_intent_notional(intent: OrderIntent, price: float | None) -> float | None:
    if intent.cash_quantity is not None:
        cash_quantity = as_float(intent.cash_quantity, field="cash_quantity")
        return abs(cash_quantity) if cash_quantity is not None else None
    if intent.quantity is not None and price is not None:
        quantity = as_float(intent.quantity, field="quantity")
        return abs(quantity * price) if quantity is not None else None
    return None


def validate_intent(
    intent: OrderIntent,
    *,
    mode: str,
    execution_cfg: dict[str, Any],
    data_symbols: set[str],
    prices: dict[str, float],
    positions: dict[str, float],
    cash: float | None,
    equity: float | None,
) -> str | None:
    symbol = str(intent.symbol).upper()
    side = str(intent.side).lower()
    order_type = str(intent.order_type or "market").lower()
    allowed_symbols = {
        str(s).upper()
        for s in execution_cfg.get("allowed_symbols", data_symbols)
    }
    allowed_sides = {
        str(s).lower()
        for s in execution_cfg.get("allowed_sides", ["buy", "sell"])
    }
    allowed_order_types = {
        str(s).lower()
        for s in execution_cfg.get("allowed_order_types", ["market"])
    }

    if symbol not in allowed_symbols:
        return f"symbol {symbol} is not in allowed_symbols"
    if side not in {"buy", "sell"}:
        return f"unsupported side {intent.side!r}"
    if side not in allowed_sides:
        return f"side {side} is not allowed"
    if order_type not in allowed_order_types:
        return f"order_type {order_type} is not allowed"

    has_quantity = intent.quantity is not None
    has_cash_quantity = intent.cash_quantity is not None
    if not has_quantity and not has_cash_quantity:
        return "quantity or cash_quantity is required"
    if has_quantity and has_cash_quantity and not bool(execution_cfg.get("allow_quantity_and_cash", False)):
        return "provide quantity or cash_quantity, not both"

    try:
        quantity = as_float(intent.quantity, field="quantity")
        cash_quantity = as_float(intent.cash_quantity, field="cash_quantity")
    except ValueError as exc:
        return str(exc)
    if quantity is not None and quantity <= 0:
        return "quantity must be positive"
    if cash_quantity is not None and cash_quantity <= 0:
        return "cash_quantity must be positive"
    if side == "sell" and cash_quantity is not None and quantity is None:
        return "sell intents require quantity"
    if mode == "paper" and not symbol.endswith("-USD") and quantity is None:
        return "IBKR paper equity orders require quantity"

    price = prices.get(symbol)
    if bool(execution_cfg.get("require_current_price", True)) and price is None:
        return f"no current price for {symbol}"

    try:
        notional = estimate_intent_notional(intent, price)
        max_quantity = as_float(execution_cfg.get("max_quantity"), field="max_quantity")
        max_cash_quantity = as_float(execution_cfg.get("max_cash_quantity"), field="max_cash_quantity")
        max_notional = as_float(execution_cfg.get("max_notional_per_order"), field="max_notional_per_order")
        max_gross_exposure = as_float(execution_cfg.get("max_gross_exposure_pct"), field="max_gross_exposure_pct")
    except ValueError as exc:
        return str(exc)

    if max_quantity is not None and quantity is not None and quantity > max_quantity:
        return f"quantity {quantity:.8f} exceeds max_quantity {max_quantity:.8f}"
    if max_cash_quantity is not None and cash_quantity is not None and cash_quantity > max_cash_quantity:
        return f"cash_quantity {cash_quantity:.2f} exceeds max_cash_quantity {max_cash_quantity:.2f}"
    if max_notional is not None and notional is not None and notional > max_notional:
        return f"notional {notional:.2f} exceeds max_notional_per_order {max_notional:.2f}"
    if side == "buy" and cash is not None and notional is not None and notional > cash + 1e-9:
        return f"notional {notional:.2f} exceeds available cash {cash:.2f}"

    if side == "sell" and not bool(execution_cfg.get("allow_short", False)):
        held_qty = float(positions.get(symbol, 0.0))
        if quantity is not None and quantity > held_qty + 1e-9:
            return f"sell quantity {quantity:.8f} exceeds held quantity {held_qty:.8f}"

    if max_gross_exposure is not None and equity is not None and equity > 0 and notional is not None:
        current_gross = sum(
            abs(float(qty) * prices.get(pos_symbol, 0.0))
            for pos_symbol, qty in positions.items()
        )
        projected_gross = current_gross + notional if side == "buy" else max(0.0, current_gross - notional)
        gross_pct = projected_gross / equity
        if gross_pct > max_gross_exposure + 1e-12:
            return f"projected gross exposure {gross_pct:.4f} exceeds max_gross_exposure_pct {max_gross_exposure:.4f}"

    return None


def run_from_config(
    config_path: Path,
    *,
    mode_override: str | None = None,
    output_dir_override: Path | None = None,
    max_steps: int | None = None,
    confirm_paper_orders: bool = False,
) -> RunnerResult:
    config = validate_config_file(
        config_path,
        mode_override=mode_override,
        max_steps_override=max_steps,
    )
    runner_cfg = config.get("runner") or {}
    execution_cfg = config.get("execution") or {}
    control_cfg = config.get("control") or {}
    mode = normalize_mode(mode_override or str(runner_cfg.get("mode", "replay")))
    if mode == "paper" and not confirm_paper_orders:
        raise ValueError("paper mode requires --confirm-paper-orders")

    output_dir = output_dir_override or Path(str(runner_cfg.get("output_dir", "paper_logs/generic_plugin_runner")))
    if bool(runner_cfg.get("clean_output_dir", False)) and output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    runner_starting_cash = finite_float(runner_cfg.get("starting_cash", execution_cfg.get("starting_cash", 10000.0)))

    spec = plugin_spec(config)
    strategy_cfg = config.get("strategy") or {}
    plugin = create_plugin(spec, strategy_cfg)
    panels = load_panels(config.get("data") or {})
    history_bars = int(runner_cfg.get("history_bars", 500))
    if history_bars <= 0:
        raise ValueError("runner.history_bars must be positive")

    if mode in {"replay", "simulated_paper"}:
        times = replay_times(panels)
    else:
        times = [latest_time(panels)]
    if max_steps is None and runner_cfg.get("max_steps") is not None:
        max_steps = int(runner_cfg["max_steps"])
    if max_steps is not None:
        times = times[:max_steps]

    simulated = None
    paper = None
    if mode == "simulated_paper":
        starting_cash = float(runner_cfg.get("starting_cash", execution_cfg.get("starting_cash", 10000.0)))
        simulated = SimulatedExecutor(starting_cash, execution_cfg)
    elif mode == "paper":
        paper = PaperExecutor(config.get("broker") or {})

    decisions = 0
    orders = 0
    fills = 0
    rejections = 0
    accepted_orders = 0
    final_prices: dict[str, float] = {}
    paper_final_cash: float | None = None
    paper_final_positions: dict[str, float] = {}
    account_records: list[dict[str, Any]] = []
    pause_marker = None
    if control_cfg.get("pause_marker") is not None:
        pause_marker = Path(str(control_cfg["pause_marker"]))

    try:
        for step, now in enumerate(times, start=1):
            snapshot = snapshot_at(panels, now, history_bars=history_bars)
            if not snapshot:
                continue
            final_prices = latest_prices(snapshot)
            if pause_marker is not None and pause_marker.exists():
                decisions += 1
                append_jsonl(output_dir / "decisions.jsonl", {
                    "timestamp": now,
                    "step": step,
                    "mode": mode,
                    "signal": {"paused": True},
                    "diagnostics": {
                        "paused": True,
                        "pause_marker": str(pause_marker),
                        "symbols": sorted(snapshot),
                    },
                    "intents": [],
                })
                if simulated is not None:
                    account_cash = simulated.cash
                    account_positions = dict(simulated.positions)
                    account_equity = simulated.equity(final_prices)
                else:
                    account_cash = runner_starting_cash
                    account_positions = {}
                    account_equity = runner_starting_cash
                account_record = account_snapshot_record(
                    now=now,
                    step=step,
                    mode=mode,
                    cash=account_cash,
                    equity=account_equity,
                    positions=account_positions,
                    prices=final_prices,
                )
                account_records.append(account_record)
                append_jsonl(output_dir / "account.jsonl", account_record)
                log.info("Decision step=%d time=%s paused by %s", step, now.isoformat(), pause_marker)
                continue
            if simulated is not None:
                cash = simulated.cash
                positions = dict(simulated.positions)
                equity = simulated.equity(final_prices)
            elif paper is not None:
                cash = paper.cash()
                positions = paper.positions()
                equity = None
            else:
                cash = runner_starting_cash
                positions = {}
                equity = runner_starting_cash

            context = StrategyContext(
                now=now,
                mode=mode,
                cash=float(cash) if cash is not None else None,
                equity=float(equity) if equity is not None else None,
                positions=positions,
                metadata={
                    "config_path": str(config_path),
                    "step": step,
                    "symbols": sorted(snapshot),
                },
            )
            decision = plugin.on_data(snapshot, context)
            decisions += 1
            append_jsonl(output_dir / "decisions.jsonl", {
                "timestamp": decision.timestamp,
                "step": step,
                "mode": mode,
                "signal": decision.signal,
                "diagnostics": decision.diagnostics,
                "intents": decision.intents,
            })
            log.info(
                "Decision step=%d time=%s intents=%d",
                step,
                now.isoformat(),
                len(decision.intents),
            )

            for raw_intent in decision.intents:
                intent = normalize_intent(raw_intent)
                orders += 1
                append_jsonl(output_dir / "orders.jsonl", {
                    "timestamp": now,
                    **intent_record(intent, status="observed" if mode in {"replay", "shadow"} else "pending"),
                })
                max_orders = execution_cfg.get("max_orders_per_run")
                if max_orders is not None and accepted_orders >= int(max_orders):
                    rejections += 1
                    reason = f"max_orders_per_run {int(max_orders)} reached"
                    append_jsonl(output_dir / "orders.jsonl", {
                        "timestamp": now,
                        **intent_record(intent, status="rejected", reason=reason),
                    })
                    log.warning("%s rejected: %s", intent.symbol, reason)
                    continue

                reason = validate_intent(
                    intent,
                    mode=mode,
                    execution_cfg=execution_cfg,
                    data_symbols=set(snapshot),
                    prices=final_prices,
                    positions=positions,
                    cash=float(cash) if cash is not None else None,
                    equity=float(equity) if equity is not None else None,
                )
                if reason is not None:
                    rejections += 1
                    append_jsonl(output_dir / "orders.jsonl", {
                        "timestamp": now,
                        **intent_record(intent, status="rejected", reason=reason),
                    })
                    log.warning("%s rejected: %s", intent.symbol, reason)
                    continue

                if mode in {"replay", "shadow"}:
                    continue
                accepted_orders += 1

                if mode == "simulated_paper" and simulated is not None:
                    price = final_prices.get(intent.symbol)
                    if price is None:
                        rejections += 1
                        reason = "no current price for symbol"
                        append_jsonl(output_dir / "orders.jsonl", {
                            "timestamp": now,
                            **intent_record(intent, status="rejected", reason=reason),
                        })
                        continue
                    fill, reason = simulated.execute(intent, price, now)
                elif mode == "paper" and paper is not None:
                    fill, reason = paper.execute(intent, now)
                else:
                    fill, reason = None, "unsupported execution mode"

                if fill is None:
                    rejections += 1
                    append_jsonl(output_dir / "orders.jsonl", {
                        "timestamp": now,
                        **intent_record(intent, status="rejected", reason=reason),
                    })
                    log.warning("%s rejected: %s", intent.symbol, reason)
                    continue

                fills += 1
                append_jsonl(output_dir / "fills.jsonl", fill)
                plugin.on_fill(fill, context)
                if simulated is not None:
                    cash = simulated.cash
                    positions = dict(simulated.positions)
                    equity = simulated.equity(final_prices)
                elif paper is not None:
                    try:
                        cash = paper.cash()
                        positions = paper.positions()
                    except Exception as exc:
                        log.warning("Could not refresh paper account snapshot after fill: %s", exc)
                    equity = None
                log.info(
                    "Filled %s %s qty=%.8f price=%.4f tag=%s",
                    fill["side"],
                    fill["symbol"],
                    float(fill["quantity"]),
                    float(fill["price"]),
                    fill.get("tag", ""),
                )
            account_record = account_snapshot_record(
                now=now,
                step=step,
                mode=mode,
                cash=float(cash) if cash is not None else None,
                equity=float(equity) if equity is not None else None,
                positions=positions,
                prices=final_prices,
            )
            account_records.append(account_record)
            append_jsonl(output_dir / "account.jsonl", account_record)
    finally:
        if paper is not None:
            if paper.connected:
                try:
                    paper_final_cash = paper.cash()
                    paper_final_positions = paper.positions()
                except Exception as exc:
                    log.warning("Could not capture final paper account snapshot: %s", exc)
            paper.disconnect()

    if simulated is not None:
        final_cash = simulated.cash
        final_positions = dict(simulated.positions)
        final_equity = simulated.equity(final_prices)
    elif paper is not None:
        final_cash = paper_final_cash
        final_positions = paper_final_positions
        final_equity = None
    else:
        final_cash = runner_starting_cash
        final_positions = {}
        final_equity = runner_starting_cash

    perf = account_metrics(account_records)
    result = RunnerResult(
        mode=mode,
        decisions=decisions,
        orders=orders,
        fills=fills,
        rejections=rejections,
        final_cash=final_cash,
        final_equity=final_equity,
        final_positions=final_positions,
        output_dir=output_dir,
        account_snapshot_count=int(perf["account_snapshot_count"]),
        initial_equity=perf["initial_equity"],
        total_return_pct=perf["total_return_pct"],
        max_drawdown_pct=perf["max_drawdown_pct"],
    )
    write_json(output_dir / "summary.json", asdict(result))
    log.info(
        "Run complete: decisions=%d orders=%d fills=%d rejections=%d output_dir=%s",
        decisions,
        orders,
        fills,
        rejections,
        output_dir,
    )
    return result


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a generic strategy plugin")
    parser.add_argument("--config", required=True, type=Path)
    parser.add_argument("--mode", default=None, help="replay, shadow, simulated-paper, or paper")
    parser.add_argument("--output-dir", default=None, type=Path)
    parser.add_argument("--max-steps", type=int, default=None)
    parser.add_argument(
        "--validate-only",
        action="store_true",
        help="Validate config, plugin import, and static data references without running.",
    )
    parser.add_argument(
        "--confirm-paper-orders",
        action="store_true",
        help="Required for mode=paper because it submits orders through IBKR.",
    )
    parser.add_argument("--log-level", default="INFO")
    args = parser.parse_args()

    logging.basicConfig(
        level=getattr(logging, args.log_level.upper()),
        format="%(asctime)s [%(levelname)s] %(message)s",
    )
    try:
        if args.validate_only:
            validate_config_file(
                args.config,
                mode_override=args.mode,
                max_steps_override=args.max_steps,
            )
            log.info("Config valid: %s", args.config)
            return
        run_from_config(
            args.config,
            mode_override=args.mode,
            output_dir_override=args.output_dir,
            max_steps=args.max_steps,
            confirm_paper_orders=args.confirm_paper_orders,
        )
    except Exception as exc:
        log.error("Runner failed: %s", exc)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
