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
import os
import re
import shutil
import sys
import time
from dataclasses import asdict, dataclass, is_dataclass
from datetime import datetime, time as datetime_time, timezone
from enum import Enum
from pathlib import Path
from typing import Any
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

import pandas as pd
import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import Bar, Order, Side
from framework.plugin_loader import create_plugin, load_object, validate_plugin_config
from framework.strategy_plugin import OrderIntent, StrategyContext
from live.broker_adapters import broker_adapter_capability, broker_adapter_ids, create_broker_adapter
from live.ibkr_data import BAR_SIZES, fetch_ibkr_bars


log = logging.getLogger(__name__)

VALID_MODES = {"replay", "shadow", "simulated_paper", "paper"}
SUPPORTED_ORDER_TYPES = {"market"}
SUPPORTED_BROKER_ADAPTERS = broker_adapter_ids()
KNOWN_IBKR_PAPER_PORTS = {4002, 7497}
KNOWN_IBKR_LIVE_PORTS = {4001, 7496}
SECONDS_PER_YEAR = 365.25 * 24 * 60 * 60
WEEKDAY_NAMES = {
    "mon": 0,
    "monday": 0,
    "tue": 1,
    "tuesday": 1,
    "wed": 2,
    "wednesday": 2,
    "thu": 3,
    "thursday": 3,
    "fri": 4,
    "friday": 4,
    "sat": 5,
    "saturday": 5,
    "sun": 6,
    "sunday": 6,
}


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
    performance_rollups_path: Path | None = None
    runner_status_path: Path | None = None
    account_snapshot_count: int = 0
    initial_equity: float | None = None
    total_return_pct: float | None = None
    max_drawdown_pct: float | None = None
    account_start_time: str | None = None
    account_end_time: str | None = None
    latest_data_time: str | None = None
    elapsed_seconds: float | None = None
    elapsed_days: float | None = None
    return_per_day_pct: float | None = None
    return_per_month_pct: float | None = None
    return_per_year_pct: float | None = None
    short_horizon_projection: bool = False
    max_gross_exposure: float | None = None
    max_gross_exposure_pct: float | None = None
    max_abs_net_exposure: float | None = None
    max_abs_net_exposure_pct: float | None = None
    max_position_count: int = 0
    realized_pnl: float | None = None
    unrealized_pnl: float | None = None
    total_pnl: float | None = None
    total_commission: float | None = None
    total_borrow_fees: float | None = None
    approval_required_orders: int = 0
    loop_enabled: bool = False
    loop_iterations: int = 0
    session_enabled: bool = False
    session_idle_iterations: int = 0
    session_status: str | None = None
    stopped_by_control: bool = False
    stop_marker: str | None = None


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


def validate_nonnegative_float_map(value: Any, field: str, errors: list[str]) -> None:
    if value is None:
        return
    if not isinstance(value, dict):
        errors.append(f"{field} must be a mapping")
        return
    for raw_key, raw_value in value.items():
        if not str(raw_key).strip():
            errors.append(f"{field} contains an empty symbol")
            continue
        validate_nonnegative_float(raw_value, f"{field}[{raw_key}]", errors)


def parse_session_time(raw: Any, *, field: str) -> datetime_time:
    value = str(raw or "").strip()
    for fmt in ("%H:%M", "%H:%M:%S"):
        try:
            return datetime.strptime(value, fmt).time()
        except ValueError:
            pass
    raise ValueError(f"{field} must be formatted as HH:MM or HH:MM:SS")


def parse_session_weekdays(raw: Any, *, field: str) -> set[int]:
    if raw is None:
        return set(range(7))
    if not isinstance(raw, list) or not raw:
        raise ValueError(f"{field} must be a non-empty list")
    weekdays: set[int] = set()
    for item in raw:
        if isinstance(item, int):
            day = item
        else:
            text = str(item).strip().lower()
            if text.isdigit():
                day = int(text)
            elif text in WEEKDAY_NAMES:
                day = WEEKDAY_NAMES[text]
            else:
                raise ValueError(f"{field} contains unsupported weekday {item!r}")
        if day < 0 or day > 6:
            raise ValueError(f"{field} weekday values must be 0-6 where Monday is 0")
        weekdays.add(day)
    return weekdays


def normalize_session_config(runner_cfg: dict[str, Any]) -> dict[str, Any] | None:
    raw = runner_cfg.get("session")
    if raw is None:
        return None
    if not isinstance(raw, dict):
        raise ValueError("runner.session must be a mapping")
    timezone_name = str(raw.get("timezone", "UTC")).strip()
    if not timezone_name:
        raise ValueError("runner.session.timezone must not be empty")
    try:
        timezone_info = ZoneInfo(timezone_name)
    except ZoneInfoNotFoundError as exc:
        raise ValueError(f"runner.session.timezone is unknown: {timezone_name}") from exc
    start_time = parse_session_time(raw.get("start"), field="runner.session.start") if raw.get("start") is not None else None
    end_time = parse_session_time(raw.get("end"), field="runner.session.end") if raw.get("end") is not None else None
    if start_time is None and end_time is not None:
        raise ValueError("runner.session.start is required when runner.session.end is set")
    if start_time is not None and end_time is None:
        raise ValueError("runner.session.end is required when runner.session.start is set")
    outside_session = str(raw.get("outside_session", "idle")).strip().lower().replace("-", "_")
    if outside_session not in {"idle", "run"}:
        raise ValueError("runner.session.outside_session must be idle or run")
    return {
        "timezone": timezone_name,
        "timezone_info": timezone_info,
        "start": start_time,
        "end": end_time,
        "weekdays": parse_session_weekdays(raw.get("weekdays"), field="runner.session.weekdays"),
        "outside_session": outside_session,
    }


def session_state(now: pd.Timestamp, session_cfg: dict[str, Any] | None) -> dict[str, Any]:
    if session_cfg is None:
        return {"enabled": False, "status": "unrestricted", "inside": True}
    timestamp = pd.Timestamp(now)
    if timestamp.tzinfo is None:
        timestamp = timestamp.tz_localize(timezone.utc)
    else:
        timestamp = timestamp.tz_convert(timezone.utc)
    local_dt = timestamp.to_pydatetime().astimezone(session_cfg["timezone_info"])
    local_time = local_dt.time()
    start = session_cfg["start"]
    end = session_cfg["end"]
    active_day = local_dt.weekday()
    inside_time = True
    if start is not None and end is not None:
        if start <= end:
            inside_time = start <= local_time <= end
        elif local_time >= start:
            inside_time = True
        elif local_time <= end:
            inside_time = True
            active_day = (active_day - 1) % 7
        else:
            inside_time = False
    inside_weekday = active_day in session_cfg["weekdays"]
    inside = inside_time and inside_weekday
    return {
        "enabled": True,
        "status": "inside_session" if inside else "outside_session",
        "inside": inside,
        "timezone": session_cfg["timezone"],
        "local_time": local_dt.isoformat(),
        "start": start.isoformat(timespec="minutes") if start else None,
        "end": end.isoformat(timespec="minutes") if end else None,
        "weekdays": sorted(session_cfg["weekdays"]),
        "outside_session": session_cfg["outside_session"],
    }


def validate_config(
    config: dict[str, Any],
    *,
    config_path: Path | None = None,
    mode_override: str | None = None,
    max_steps_override: int | None = None,
    loop_override: bool | None = None,
    max_loop_iterations_override: int | None = None,
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
    strategy_cfg = section(config, "strategy", errors)

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
        else:
            for err in validate_plugin_config(spec, strategy_cfg, full_config=config):
                errors.append(f"metadata.strategy_plugin config: {err}")
    if metadata.get("status") == "example_only" and runner_cfg.get("mode") == "paper":
        errors.append("example_only configs must not default to paper mode")

    mode_raw = mode_override or str(runner_cfg.get("mode", "replay"))
    try:
        normalized_mode = normalize_mode(mode_raw)
    except ValueError as exc:
        errors.append(str(exc))
        normalized_mode = "replay"

    validate_positive_int(runner_cfg.get("history_bars", 500), "runner.history_bars", errors)
    validate_positive_int(runner_cfg.get("max_steps"), "runner.max_steps", errors)
    if max_steps_override is not None:
        validate_positive_int(max_steps_override, "--max-steps", errors)
    validate_bool(runner_cfg.get("loop"), "runner.loop", errors)
    validate_nonnegative_float(runner_cfg.get("loop_interval_seconds"), "runner.loop_interval_seconds", errors)
    validate_positive_int(runner_cfg.get("max_loop_iterations"), "runner.max_loop_iterations", errors)
    validate_bool(runner_cfg.get("skip_duplicate_latest"), "runner.skip_duplicate_latest", errors)
    if max_loop_iterations_override is not None:
        validate_positive_int(max_loop_iterations_override, "--max-loop-iterations", errors)
    loop_enabled = bool(loop_override) if loop_override is not None else bool(runner_cfg.get("loop", False))
    if loop_enabled and normalized_mode not in {"shadow", "paper"}:
        errors.append("runner.loop is only supported for shadow or paper mode")
    validate_nonnegative_float(runner_cfg.get("starting_cash"), "runner.starting_cash", errors)
    validate_bool(runner_cfg.get("clean_output_dir"), "runner.clean_output_dir", errors)
    if runner_cfg.get("output_dir") is not None and not str(runner_cfg["output_dir"]).strip():
        errors.append("runner.output_dir must not be empty")
    try:
        normalize_session_config(runner_cfg)
    except ValueError as exc:
        errors.append(str(exc))
    if control_cfg.get("pause_marker") is not None and not str(control_cfg["pause_marker"]).strip():
        errors.append("control.pause_marker must not be empty")
    if control_cfg.get("stop_marker") is not None and not str(control_cfg["stop_marker"]).strip():
        errors.append("control.stop_marker must not be empty")

    source = str(data_cfg.get("source", "files")).lower()
    try:
        data_date_range(data_cfg)
    except ValueError as exc:
        errors.append(str(exc))
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
    validate_string_list(execution_cfg.get("shortable_symbols"), "execution.shortable_symbols", errors)
    validate_bool(execution_cfg.get("allow_short"), "execution.allow_short", errors)
    validate_bool(execution_cfg.get("require_current_price"), "execution.require_current_price", errors)
    validate_bool(execution_cfg.get("allow_quantity_and_cash"), "execution.allow_quantity_and_cash", errors)
    validate_bool(execution_cfg.get("require_order_approval"), "execution.require_order_approval", errors)
    validate_positive_int(execution_cfg.get("max_orders_per_run"), "execution.max_orders_per_run", errors)
    validate_nonnegative_float(execution_cfg.get("max_quantity"), "execution.max_quantity", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("max_cash_quantity"), "execution.max_cash_quantity", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("max_notional_per_order"), "execution.max_notional_per_order", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("max_gross_exposure_pct"), "execution.max_gross_exposure_pct", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("max_short_notional_per_symbol"), "execution.max_short_notional_per_symbol", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("max_total_short_notional"), "execution.max_total_short_notional", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("sim_slippage_bps"), "execution.sim_slippage_bps", errors)
    validate_nonnegative_float(execution_cfg.get("sim_buy_slippage_bps"), "execution.sim_buy_slippage_bps", errors)
    validate_nonnegative_float(execution_cfg.get("sim_sell_slippage_bps"), "execution.sim_sell_slippage_bps", errors)
    validate_nonnegative_float(execution_cfg.get("sim_market_impact_bps_per_10k"), "execution.sim_market_impact_bps_per_10k", errors)
    validate_nonnegative_float(execution_cfg.get("sim_commission_bps"), "execution.sim_commission_bps", errors)
    validate_nonnegative_float(execution_cfg.get("sim_commission_per_share"), "execution.sim_commission_per_share", errors)
    validate_nonnegative_float(execution_cfg.get("sim_min_commission"), "execution.sim_min_commission", errors)
    validate_nonnegative_float(execution_cfg.get("sim_max_commission_pct"), "execution.sim_max_commission_pct", errors, positive=True)
    validate_nonnegative_float(execution_cfg.get("sim_short_borrow_bps_annual"), "execution.sim_short_borrow_bps_annual", errors)
    validate_nonnegative_float_map(
        execution_cfg.get("sim_short_borrow_bps_annual_by_symbol"),
        "execution.sim_short_borrow_bps_annual_by_symbol",
        errors,
    )

    validate_positive_int(broker_cfg.get("port", 4002), "broker.port", errors)
    validate_positive_int(broker_cfg.get("client_id", 301), "broker.client_id", errors, allow_zero=True)
    validate_bool(broker_cfg.get("allow_live_broker_port_for_paper"), "broker.allow_live_broker_port_for_paper", errors)
    adapter = str(broker_cfg.get("adapter", broker_cfg.get("provider", "ibkr"))).lower().replace("-", "_")
    if adapter not in SUPPORTED_BROKER_ADAPTERS:
        errors.append(f"broker.adapter must be one of {sorted(SUPPORTED_BROKER_ADAPTERS)}")
    else:
        capability = broker_adapter_capability(adapter)
        raw_order_types = execution_cfg.get("allowed_order_types")
        configured_order_types = raw_order_types if isinstance(raw_order_types, list) and raw_order_types else ["market"]
        unsupported_order_types = set(str(item).lower() for item in configured_order_types) - set(capability["order_types"])
        if unsupported_order_types:
            errors.append(f"broker.adapter {adapter} does not support order types: {sorted(unsupported_order_types)}")
    if broker_cfg.get("host") is not None and not str(broker_cfg["host"]).strip():
        errors.append("broker.host must not be empty")
    account_mode = broker_cfg.get("account_mode")
    if account_mode is not None and str(account_mode).lower().replace("-", "_") not in {"paper", "live"}:
        errors.append("broker.account_mode must be paper or live")
    if adapter == "file":
        if broker_cfg.get("state_path") is not None and not str(broker_cfg["state_path"]).strip():
            errors.append("broker.state_path must not be empty")
        if broker_cfg.get("orders_path") is not None and not str(broker_cfg["orders_path"]).strip():
            errors.append("broker.orders_path must not be empty")
        validate_nonnegative_float(broker_cfg.get("starting_cash"), "broker.starting_cash", errors)
        validate_nonnegative_float(broker_cfg.get("commission_bps"), "broker.commission_bps", errors)
        validate_bool(broker_cfg.get("allow_short"), "broker.allow_short", errors)
        prices = broker_cfg.get("prices")
        if prices is not None:
            if not isinstance(prices, dict) or not prices:
                errors.append("broker.prices must be a non-empty mapping")
            else:
                for symbol, price in prices.items():
                    if not str(symbol).strip():
                        errors.append("broker.prices contains an empty symbol")
                    validate_nonnegative_float(price, f"broker.prices[{symbol}]", errors, positive=True)

    return errors


def validate_config_file(
    config_path: Path,
    *,
    mode_override: str | None = None,
    max_steps_override: int | None = None,
    loop_override: bool | None = None,
    max_loop_iterations_override: int | None = None,
) -> dict[str, Any]:
    config = read_config(config_path)
    errors = validate_config(
        config,
        config_path=config_path,
        mode_override=mode_override,
        max_steps_override=max_steps_override,
        loop_override=loop_override,
        max_loop_iterations_override=max_loop_iterations_override,
    )
    if errors:
        raise ConfigValidationError(errors)
    return config


def paper_broker_safety_errors(
    broker_cfg: dict[str, Any],
    *,
    allow_live_broker_port: bool = False,
) -> list[str]:
    errors: list[str] = []
    adapter = str(broker_cfg.get("adapter", broker_cfg.get("provider", "ibkr"))).lower().replace("-", "_")
    capability = broker_adapter_capability(adapter) if adapter in SUPPORTED_BROKER_ADAPTERS else {}
    account_mode = str(broker_cfg.get("account_mode", "paper")).lower().replace("-", "_")
    if account_mode != "paper":
        errors.append("paper mode requires broker.account_mode: paper")
    if account_mode not in set(capability.get("account_modes") or []):
        errors.append(f"broker.adapter {adapter} does not advertise account_mode {account_mode}")
    port = int(broker_cfg.get("port", 4002))
    if not capability.get("requires_gateway", False):
        return errors
    config_allows_live_port = bool(broker_cfg.get("allow_live_broker_port_for_paper", False))
    known_live_ports = set(int(item) for item in capability.get("known_live_ports") or KNOWN_IBKR_LIVE_PORTS)
    known_paper_ports = set(int(item) for item in capability.get("known_paper_ports") or KNOWN_IBKR_PAPER_PORTS)
    if port in known_live_ports and not (config_allows_live_port and allow_live_broker_port):
        errors.append(
            "paper mode refuses known live IBKR ports "
            f"{sorted(known_live_ports)}; use a paper port "
            f"{sorted(known_paper_ports)} or set broker.allow_live_broker_port_for_paper "
            "and pass --allow-live-broker-port"
        )
    if port not in known_paper_ports and port not in known_live_ports and broker_cfg.get("account_mode") is None:
        errors.append("non-standard broker.port requires explicit broker.account_mode: paper")
    return errors


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


def write_json_atomic(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with tmp.open("w") as f:
        json.dump(jsonable(record), f, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def finite_float(raw: Any) -> float | None:
    try:
        value = float(raw)
    except (TypeError, ValueError):
        return None
    return value if math.isfinite(value) else None


def parse_optional_timestamp(raw: Any, *, field: str, end_of_day: bool = False) -> pd.Timestamp | None:
    value = str(raw or "").strip()
    if not value:
        return None
    try:
        parsed = pd.to_datetime(value, utc=True, errors="raise", format="mixed")
    except TypeError:
        parsed = pd.to_datetime(value, utc=True, errors="raise")
    except Exception as exc:
        raise ValueError(f"{field} must be a parseable timestamp") from exc
    if end_of_day and re.fullmatch(r"\d{4}-\d{2}-\d{2}", value):
        parsed = parsed + pd.Timedelta(days=1) - pd.Timedelta(microseconds=1)
    return parsed


def data_date_range(data_cfg: dict[str, Any]) -> tuple[pd.Timestamp | None, pd.Timestamp | None]:
    start_ts = parse_optional_timestamp(data_cfg.get("start"), field="data.start")
    end_ts = parse_optional_timestamp(data_cfg.get("end"), field="data.end", end_of_day=True)
    if start_ts is not None and end_ts is not None and start_ts > end_ts:
        raise ValueError("data.start must be before or equal to data.end")
    return start_ts, end_ts


def filter_frame_by_data_range(
    frame: pd.DataFrame,
    *,
    symbol: str,
    start_ts: pd.Timestamp | None,
    end_ts: pd.Timestamp | None,
) -> pd.DataFrame:
    out = frame
    if start_ts is not None:
        out = out.loc[out.index >= start_ts]
    if end_ts is not None:
        out = out.loc[out.index <= end_ts]
    if (start_ts is not None or end_ts is not None) and out.empty:
        raise ValueError(f"{symbol}: no bars remain after data.start/data.end filter")
    return out


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
    start_ts, end_ts = data_date_range(data_cfg)
    panels: dict[str, pd.DataFrame] = {}
    for symbol, raw_path in files.items():
        path = Path(str(raw_path))
        if not path.exists():
            raise FileNotFoundError(path)
        if path.suffix.lower() == ".parquet":
            raw = pd.read_parquet(path)
        else:
            raw = pd.read_csv(path)
        normalized = normalize_frame(
            raw,
            symbol=str(symbol).upper(),
            timestamp_column=timestamp_column,
        )
        panels[str(symbol).upper()] = filter_frame_by_data_range(
            normalized,
            symbol=str(symbol).upper(),
            start_ts=start_ts,
            end_ts=end_ts,
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


def latest_snapshot_time(snapshot: dict[str, pd.DataFrame]) -> pd.Timestamp | None:
    latest = [df.index.max() for df in snapshot.values() if not df.empty]
    if not latest:
        return None
    return max(latest)


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
    accounting: dict[str, Any] | None = None,
) -> dict[str, Any]:
    position_values = {
        symbol: float(qty) * float(prices.get(symbol, 0.0))
        for symbol, qty in positions.items()
    }
    gross_exposure = sum(abs(value) for value in position_values.values())
    net_exposure = sum(position_values.values())
    record = {
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
    if accounting:
        average_costs = accounting.get("average_costs") if isinstance(accounting.get("average_costs"), dict) else {}
        unrealized_by_symbol = accounting.get("unrealized_pnl_by_symbol") if isinstance(accounting.get("unrealized_pnl_by_symbol"), dict) else {}
        record.update({
            "average_costs": {symbol: finite_float(value) for symbol, value in average_costs.items()},
            "realized_pnl": finite_float(accounting.get("realized_pnl")),
            "unrealized_pnl": finite_float(accounting.get("unrealized_pnl")),
            "unrealized_pnl_by_symbol": {symbol: finite_float(value) for symbol, value in unrealized_by_symbol.items()},
            "total_pnl": finite_float(accounting.get("total_pnl")),
            "total_commission": finite_float(accounting.get("total_commission")),
            "total_borrow_fees": finite_float(accounting.get("total_borrow_fees")),
            "borrow_fee_accrued": finite_float(accounting.get("borrow_fee_accrued")),
            "borrow_fee_accrued_by_symbol": {
                symbol: finite_float(value)
                for symbol, value in (
                    accounting.get("borrow_fee_accrued_by_symbol")
                    if isinstance(accounting.get("borrow_fee_accrued_by_symbol"), dict)
                    else {}
                ).items()
            },
        })
    return record


def account_metrics(records: list[dict[str, Any]]) -> dict[str, Any]:
    timestamps = []
    for row in records:
        raw_ts = row.get("timestamp")
        if raw_ts is None:
            continue
        parsed = pd.to_datetime(raw_ts, utc=True, errors="coerce")
        if not pd.isna(parsed):
            timestamps.append(parsed)
    equity_values = [finite_float(row.get("equity")) for row in records]
    equity_values = [value for value in equity_values if value is not None]
    gross_values = [finite_float(row.get("gross_exposure")) for row in records]
    gross_values = [value for value in gross_values if value is not None]
    net_values = [finite_float(row.get("net_exposure")) for row in records]
    net_values = [value for value in net_values if value is not None]
    max_gross_exposure = max(gross_values) if gross_values else None
    max_abs_net_exposure = max((abs(value) for value in net_values), default=None)
    latest_accounting = records[-1] if records else {}
    max_position_count = 0
    for row in records:
        positions = row.get("positions")
        if isinstance(positions, dict):
            count = sum(1 for value in positions.values() if finite_float(value) not in (None, 0.0))
            max_position_count = max(max_position_count, count)
    if not equity_values:
        return {
            "account_snapshot_count": len(records),
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
            "realized_pnl": finite_float(latest_accounting.get("realized_pnl")),
            "unrealized_pnl": finite_float(latest_accounting.get("unrealized_pnl")),
            "total_pnl": finite_float(latest_accounting.get("total_pnl")),
            "total_commission": finite_float(latest_accounting.get("total_commission")),
            "total_borrow_fees": finite_float(latest_accounting.get("total_borrow_fees")),
        }
    initial = equity_values[0]
    final = equity_values[-1]
    total_return = (final / initial) - 1.0 if initial else None
    total_return_pct = total_return * 100.0 if total_return is not None else None
    peak = equity_values[0]
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
    if timestamps and len(timestamps) >= 2:
        elapsed_seconds = finite_float((timestamps[-1] - timestamps[0]).total_seconds())
        if elapsed_seconds is not None and elapsed_seconds > 0:
            elapsed_days = elapsed_seconds / 86400.0
            if total_return is not None and initial > 0 and final > 0:
                ratio = final / initial
                return_per_day_pct = finite_float((ratio ** (1.0 / elapsed_days) - 1.0) * 100.0)
                return_per_month_pct = finite_float((ratio ** (30.4375 / elapsed_days) - 1.0) * 100.0)
                return_per_year_pct = finite_float((ratio ** (365.25 / elapsed_days) - 1.0) * 100.0)
    return {
        "account_snapshot_count": len(records),
        "initial_equity": initial,
        "total_return_pct": finite_float(total_return_pct),
        "max_drawdown_pct": finite_float(max_drawdown),
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
        "realized_pnl": finite_float(latest_accounting.get("realized_pnl")),
        "unrealized_pnl": finite_float(latest_accounting.get("unrealized_pnl")),
        "total_pnl": finite_float(latest_accounting.get("total_pnl")),
        "total_commission": finite_float(latest_accounting.get("total_commission")),
        "total_borrow_fees": finite_float(latest_accounting.get("total_borrow_fees")),
    }


def daily_account_rollups(records: list[dict[str, Any]]) -> list[dict[str, Any]]:
    by_day: dict[str, list[dict[str, Any]]] = {}
    for row in records:
        parsed = pd.to_datetime(row.get("timestamp"), utc=True, errors="coerce")
        if pd.isna(parsed):
            continue
        equity = finite_float(row.get("equity"))
        if equity is None:
            continue
        day = parsed.date().isoformat()
        enriched = dict(row)
        enriched["_timestamp"] = parsed
        enriched["_equity"] = equity
        by_day.setdefault(day, []).append(enriched)

    rollups: list[dict[str, Any]] = []
    for day, rows in by_day.items():
        ordered = sorted(rows, key=lambda item: item["_timestamp"])
        start = ordered[0]
        end = ordered[-1]
        start_equity = finite_float(start.get("equity"))
        end_equity = finite_float(end.get("equity"))
        daily_return_pct = (
            ((end_equity / start_equity) - 1.0) * 100.0
            if start_equity and end_equity is not None
            else None
        )
        gross_values = [finite_float(row.get("gross_exposure")) for row in ordered]
        gross_values = [value for value in gross_values if value is not None]
        net_values = [finite_float(row.get("net_exposure")) for row in ordered]
        net_values = [value for value in net_values if value is not None]
        max_position_count = 0
        for row in ordered:
            positions = row.get("positions")
            if isinstance(positions, dict):
                count = sum(1 for value in positions.values() if finite_float(value) not in (None, 0.0))
                max_position_count = max(max_position_count, count)
        rollups.append({
            "day": day,
            "mode": end.get("mode"),
            "snapshot_count": len(ordered),
            "account_start_time": start["_timestamp"].isoformat(),
            "account_end_time": end["_timestamp"].isoformat(),
            "start_equity": start_equity,
            "end_equity": end_equity,
            "daily_return_pct": finite_float(daily_return_pct),
            "max_gross_exposure": finite_float(max(gross_values) if gross_values else None),
            "max_abs_net_exposure": finite_float(max((abs(value) for value in net_values), default=None)),
            "max_position_count": max_position_count,
            "realized_pnl": finite_float(end.get("realized_pnl")),
            "unrealized_pnl": finite_float(end.get("unrealized_pnl")),
            "total_pnl": finite_float(end.get("total_pnl")),
            "total_commission": finite_float(end.get("total_commission")),
            "total_borrow_fees": finite_float(end.get("total_borrow_fees")),
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
        start_equity = finite_float(start.get("start_equity"))
        end_equity = finite_float(end.get("end_equity"))
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
            "max_gross_exposure": finite_float(max((finite_float(row.get("max_gross_exposure")) or 0.0 for row in ordered), default=None)),
            "max_abs_net_exposure": finite_float(max((finite_float(row.get("max_abs_net_exposure")) or 0.0 for row in ordered), default=None)),
            "max_position_count": max(int(row.get("max_position_count") or 0) for row in ordered),
        })
    return sorted(out, key=lambda row: str(row.get("label") or ""), reverse=True)


def account_rollup_artifact(records: list[dict[str, Any]], result: RunnerResult) -> dict[str, Any]:
    daily = daily_account_rollups(records)
    return {
        "schema_version": 1,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "source": "plugin_runner",
        "mode": result.mode,
        "output_dir": str(result.output_dir),
        "summary": {
            "decisions": result.decisions,
            "orders": result.orders,
            "fills": result.fills,
            "rejections": result.rejections,
            "account_snapshot_count": result.account_snapshot_count,
            "initial_equity": result.initial_equity,
            "final_equity": result.final_equity,
            "total_return_pct": result.total_return_pct,
            "max_drawdown_pct": result.max_drawdown_pct,
            "account_start_time": result.account_start_time,
            "account_end_time": result.account_end_time,
        },
        "rollups": daily,
        "period_rollups": {
            "month": period_account_rollups(daily, period="month"),
            "year": period_account_rollups(daily, period="year"),
        },
        "count": len(daily),
        "total": len(daily),
    }


class SimulatedExecutor:
    def __init__(self, cash: float, execution_cfg: dict[str, Any]):
        self.cash = float(cash)
        self.positions: dict[str, float] = {}
        self.average_costs: dict[str, float] = {}
        self.realized_pnl = 0.0
        self.total_commission = 0.0
        self.total_borrow_fees = 0.0
        self.last_borrow_fee_time: pd.Timestamp | None = None
        self.last_borrow_fee_accrued = 0.0
        self.last_borrow_fee_accrued_by_symbol: dict[str, float] = {}
        self.allow_short = bool(execution_cfg.get("allow_short", False))
        self.slippage_bps = float(execution_cfg.get("sim_slippage_bps", 0.0))
        self.buy_slippage_bps = execution_cfg.get("sim_buy_slippage_bps")
        self.sell_slippage_bps = execution_cfg.get("sim_sell_slippage_bps")
        self.market_impact_bps_per_10k = float(execution_cfg.get("sim_market_impact_bps_per_10k", 0.0))
        self.commission_bps = float(execution_cfg.get("sim_commission_bps", 0.0))
        self.commission_per_share = float(execution_cfg.get("sim_commission_per_share", 0.0))
        self.min_commission = float(execution_cfg.get("sim_min_commission", 0.0))
        self.max_commission_pct = execution_cfg.get("sim_max_commission_pct")
        self.short_borrow_bps_annual = float(execution_cfg.get("sim_short_borrow_bps_annual", 0.0))
        self.short_borrow_bps_annual_by_symbol = {
            str(symbol).upper(): float(rate)
            for symbol, rate in (execution_cfg.get("sim_short_borrow_bps_annual_by_symbol") or {}).items()
        }

    def slippage_for(self, *, side: str, requested_notional: float | None) -> float:
        if side == "buy" and self.buy_slippage_bps is not None:
            base = float(self.buy_slippage_bps)
        elif side == "sell" and self.sell_slippage_bps is not None:
            base = float(self.sell_slippage_bps)
        else:
            base = self.slippage_bps
        notional = max(0.0, float(requested_notional or 0.0))
        impact = (notional / 10000.0) * self.market_impact_bps_per_10k
        return base + impact

    def commission_for(self, *, notional: float, quantity: float) -> float:
        commission = notional * self.commission_bps / 10000.0
        commission += abs(quantity) * self.commission_per_share
        if self.min_commission > 0:
            commission = max(commission, self.min_commission)
        if self.max_commission_pct is not None:
            commission = min(commission, notional * float(self.max_commission_pct) / 100.0)
        return commission

    def equity(self, prices: dict[str, float]) -> float:
        return self.cash + sum(qty * prices.get(symbol, 0.0) for symbol, qty in self.positions.items())

    def unrealized_pnl_by_symbol(self, prices: dict[str, float]) -> dict[str, float]:
        out: dict[str, float] = {}
        for symbol, qty in self.positions.items():
            price = prices.get(symbol)
            avg_cost = self.average_costs.get(symbol)
            if price is None or avg_cost is None:
                continue
            if qty > 0:
                out[symbol] = (float(price) - avg_cost) * qty
            elif qty < 0:
                out[symbol] = (avg_cost - float(price)) * abs(qty)
        return out

    def accounting_snapshot(self, prices: dict[str, float]) -> dict[str, Any]:
        unrealized_by_symbol = self.unrealized_pnl_by_symbol(prices)
        unrealized = sum(unrealized_by_symbol.values())
        return {
            "average_costs": dict(self.average_costs),
            "realized_pnl": self.realized_pnl,
            "unrealized_pnl": unrealized,
            "unrealized_pnl_by_symbol": unrealized_by_symbol,
            "total_pnl": self.realized_pnl + unrealized - self.total_borrow_fees,
            "total_commission": self.total_commission,
            "total_borrow_fees": self.total_borrow_fees,
            "borrow_fee_accrued": self.last_borrow_fee_accrued,
            "borrow_fee_accrued_by_symbol": dict(self.last_borrow_fee_accrued_by_symbol),
        }

    def borrow_bps_for(self, symbol: str) -> float:
        return self.short_borrow_bps_annual_by_symbol.get(str(symbol).upper(), self.short_borrow_bps_annual)

    def accrue_borrow_fees(self, now: pd.Timestamp, prices: dict[str, float]) -> float:
        timestamp = pd.Timestamp(now)
        if timestamp.tzinfo is None:
            timestamp = timestamp.tz_localize(timezone.utc)
        else:
            timestamp = timestamp.tz_convert(timezone.utc)
        self.last_borrow_fee_accrued = 0.0
        self.last_borrow_fee_accrued_by_symbol = {}
        if self.last_borrow_fee_time is None:
            self.last_borrow_fee_time = timestamp
            return 0.0
        elapsed_seconds = (timestamp - self.last_borrow_fee_time).total_seconds()
        self.last_borrow_fee_time = timestamp
        if elapsed_seconds <= 0:
            return 0.0

        accrued_by_symbol: dict[str, float] = {}
        for symbol, qty in self.positions.items():
            if float(qty) >= 0:
                continue
            price = finite_float(prices.get(symbol))
            if price is None or price <= 0:
                continue
            borrow_bps = self.borrow_bps_for(symbol)
            if borrow_bps <= 0:
                continue
            short_notional = abs(float(qty)) * price
            fee = short_notional * (borrow_bps / 10000.0) * (elapsed_seconds / SECONDS_PER_YEAR)
            if fee > 0:
                accrued_by_symbol[symbol] = fee
        total_fee = sum(accrued_by_symbol.values())
        if total_fee > 0:
            self.cash -= total_fee
            self.total_borrow_fees += total_fee
            self.last_borrow_fee_accrued = total_fee
            self.last_borrow_fee_accrued_by_symbol = accrued_by_symbol
        return total_fee

    @staticmethod
    def opening_average_cost(side_sign: float, fill_price: float, quantity: float, commission: float) -> float:
        if quantity <= 0:
            return fill_price
        if side_sign >= 0:
            return fill_price + commission / quantity
        return fill_price - commission / quantity

    def apply_accounting(
        self,
        *,
        symbol: str,
        old_qty: float,
        delta_qty: float,
        fill_price: float,
        commission: float,
    ) -> float:
        self.total_commission += commission
        old_avg = self.average_costs.get(symbol, fill_price)
        if abs(old_qty) < 1e-9:
            self.average_costs[symbol] = self.opening_average_cost(delta_qty, fill_price, abs(delta_qty), commission)
            return 0.0

        if old_qty * delta_qty > 0:
            old_abs = abs(old_qty)
            add_abs = abs(delta_qty)
            new_abs = old_abs + add_abs
            self.average_costs[symbol] = (
                old_abs * old_avg
                + add_abs * fill_price
                + (commission if delta_qty > 0 else -commission)
            ) / new_abs
            return 0.0

        close_qty = min(abs(old_qty), abs(delta_qty))
        commission_for_close = commission * (close_qty / abs(delta_qty)) if abs(delta_qty) > 0 else 0.0
        if old_qty > 0:
            realized = (fill_price - old_avg) * close_qty - commission_for_close
        else:
            realized = (old_avg - fill_price) * close_qty - commission_for_close
        self.realized_pnl += realized

        remaining_open_qty = abs(delta_qty) - close_qty
        new_qty = old_qty + delta_qty
        if abs(new_qty) < 1e-9:
            self.average_costs.pop(symbol, None)
        elif old_qty * new_qty > 0:
            self.average_costs[symbol] = old_avg
        elif remaining_open_qty > 1e-9:
            leftover_commission = commission - commission_for_close
            self.average_costs[symbol] = self.opening_average_cost(
                new_qty,
                fill_price,
                remaining_open_qty,
                leftover_commission,
            )
        return realized

    def execute(self, intent: OrderIntent, price: float, now: pd.Timestamp) -> tuple[dict[str, Any] | None, str | None]:
        side = intent.side.lower()
        if side not in {"buy", "sell"}:
            return None, f"unsupported side {intent.side!r}"

        requested_notional = estimate_intent_notional(intent, float(price))
        fill_price = float(price)
        slippage_bps = self.slippage_for(side=side, requested_notional=requested_notional)
        if side == "buy":
            fill_price *= 1.0 + slippage_bps / 10000.0
        else:
            fill_price *= 1.0 - slippage_bps / 10000.0

        if intent.quantity is None:
            if intent.cash_quantity is None:
                return None, "quantity or cash_quantity is required"
            quantity = float(intent.cash_quantity) / fill_price
        else:
            quantity = float(intent.quantity)
        if quantity <= 0:
            return None, "quantity must be positive"

        notional = quantity * fill_price
        commission = self.commission_for(notional=notional, quantity=quantity)
        current_qty = self.positions.get(intent.symbol, 0.0)
        delta_qty = quantity if side == "buy" else -quantity

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
        realized = self.apply_accounting(
            symbol=intent.symbol,
            old_qty=current_qty,
            delta_qty=delta_qty,
            fill_price=fill_price,
            commission=commission,
        )
        avg_after = self.average_costs.get(intent.symbol)

        return {
            "timestamp": now,
            "symbol": intent.symbol,
            "side": side,
            "quantity": quantity,
            "price": fill_price,
            "commission": commission,
            "slippage_bps": slippage_bps,
            "realized_pnl": realized,
            "cumulative_realized_pnl": self.realized_pnl,
            "average_cost_after": avg_after,
            "tag": intent.tag,
            "simulated": True,
        }, None


class PaperExecutor:
    def __init__(self, broker_cfg: dict[str, Any]):
        self.broker = create_broker_adapter(broker_cfg)
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


def order_preview_record(
    intent: OrderIntent,
    *,
    now: pd.Timestamp,
    step: int,
    mode: str,
    price: float | None,
    cash: float | None,
    equity: float | None,
    positions: dict[str, float],
    approval_status: str,
) -> dict[str, Any]:
    return {
        "timestamp": now,
        "step": step,
        "mode": mode,
        "approval_required": True,
        "approval_status": approval_status,
        **intent_record(intent, status="preview"),
        "price": finite_float(price),
        "estimated_notional": finite_float(estimate_intent_notional(intent, price)),
        "cash": finite_float(cash),
        "equity": finite_float(equity),
        "positions": {symbol: finite_float(qty) for symbol, qty in positions.items()},
    }


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


def short_notional_by_symbol(positions: dict[str, float], prices: dict[str, float]) -> dict[str, float]:
    return {
        symbol: abs(float(qty)) * float(prices.get(symbol, 0.0))
        for symbol, qty in positions.items()
        if float(qty) < 0 and prices.get(symbol) is not None
    }


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
        max_short_symbol = as_float(execution_cfg.get("max_short_notional_per_symbol"), field="max_short_notional_per_symbol")
        max_total_short = as_float(execution_cfg.get("max_total_short_notional"), field="max_total_short_notional")
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
    elif side == "sell" and quantity is not None and price is not None:
        held_qty = float(positions.get(symbol, 0.0))
        projected_qty = held_qty - quantity
        if projected_qty < -1e-9:
            shortable = execution_cfg.get("shortable_symbols")
            if shortable is not None:
                allowed_shorts = {str(item).upper() for item in shortable}
                if symbol not in allowed_shorts:
                    return f"symbol {symbol} is not in shortable_symbols"
            projected_short = abs(projected_qty) * float(price)
            if max_short_symbol is not None and projected_short > max_short_symbol + 1e-9:
                return f"projected short notional {projected_short:.2f} exceeds max_short_notional_per_symbol {max_short_symbol:.2f}"
            if max_total_short is not None:
                current_shorts = short_notional_by_symbol(positions, prices)
                current_shorts.pop(symbol, None)
                projected_total_short = sum(current_shorts.values()) + projected_short
                if projected_total_short > max_total_short + 1e-9:
                    return f"projected total short notional {projected_total_short:.2f} exceeds max_total_short_notional {max_total_short:.2f}"

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
    approve_orders: bool = False,
    allow_live_broker_port: bool = False,
    loop: bool | None = None,
    loop_interval_seconds: float | None = None,
    max_loop_iterations: int | None = None,
) -> RunnerResult:
    config = validate_config_file(
        config_path,
        mode_override=mode_override,
        max_steps_override=max_steps,
        loop_override=loop,
        max_loop_iterations_override=max_loop_iterations,
    )
    runner_cfg = config.get("runner") or {}
    execution_cfg = config.get("execution") or {}
    control_cfg = config.get("control") or {}
    mode = normalize_mode(mode_override or str(runner_cfg.get("mode", "replay")))
    if mode == "paper" and not confirm_paper_orders:
        raise ValueError("paper mode requires --confirm-paper-orders")
    if mode == "paper":
        paper_safety_errors = paper_broker_safety_errors(
            config.get("broker") or {},
            allow_live_broker_port=allow_live_broker_port,
        )
        if paper_safety_errors:
            raise ValueError("paper broker safety gate failed:\n" + "\n".join(f"- {err}" for err in paper_safety_errors))
    loop_enabled = bool(loop) if loop is not None else bool(runner_cfg.get("loop", False))
    loop_interval = (
        float(loop_interval_seconds)
        if loop_interval_seconds is not None
        else float(runner_cfg.get("loop_interval_seconds", 60.0))
    )
    if loop_interval < 0:
        raise ValueError("loop_interval_seconds must be >= 0")
    if max_loop_iterations is None and runner_cfg.get("max_loop_iterations") is not None:
        max_loop_iterations = int(runner_cfg["max_loop_iterations"])
    if loop_enabled and mode not in {"shadow", "paper"}:
        raise ValueError("runner.loop is only supported for shadow or paper mode")
    skip_duplicate_latest = bool(runner_cfg.get("skip_duplicate_latest", True))
    session_cfg = normalize_session_config(runner_cfg)

    output_dir = output_dir_override or Path(str(runner_cfg.get("output_dir", "paper_logs/generic_plugin_runner")))
    if bool(runner_cfg.get("clean_output_dir", False)) and output_dir.exists():
        shutil.rmtree(output_dir)
    output_dir.mkdir(parents=True, exist_ok=True)
    runner_starting_cash = finite_float(runner_cfg.get("starting_cash", execution_cfg.get("starting_cash", 10000.0)))

    spec = plugin_spec(config)
    strategy_cfg = config.get("strategy") or {}
    plugin = create_plugin(spec, strategy_cfg)
    history_bars = int(runner_cfg.get("history_bars", 500))
    if history_bars <= 0:
        raise ValueError("runner.history_bars must be positive")
    if max_steps is None and runner_cfg.get("max_steps") is not None:
        max_steps = int(runner_cfg["max_steps"])

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
    approval_required_orders = 0
    accepted_orders = 0
    final_prices: dict[str, float] = {}
    paper_final_cash: float | None = None
    paper_final_positions: dict[str, float] = {}
    account_records: list[dict[str, Any]] = []
    latest_data_time: str | None = None
    loop_iterations = 0
    session_idle_iterations = 0
    latest_session_status: str | None = None
    last_processed_latest: pd.Timestamp | None = None
    pause_marker = None
    if control_cfg.get("pause_marker") is not None:
        pause_marker = Path(str(control_cfg["pause_marker"]))
    stop_marker = None
    if control_cfg.get("stop_marker") is not None:
        stop_marker = Path(str(control_cfg["stop_marker"]))
    stopped_by_control = False
    runner_status_path = output_dir / "runner_status.json"
    run_started_at = datetime.now(timezone.utc)
    latest_error: dict[str, str] | None = None
    last_decision_time: str | None = None

    def update_runner_status(
        state: str,
        *,
        note: str | None = None,
        result: RunnerResult | None = None,
    ) -> None:
        payload: dict[str, Any] = {
            "schema_version": 1,
            "state": state,
            "mode": mode,
            "pid": os.getpid(),
            "started_at": run_started_at,
            "updated_at": datetime.now(timezone.utc),
            "output_dir": output_dir,
            "latest_data_time": latest_data_time,
            "last_decision_time": last_decision_time,
            "counts": {
                "decisions": decisions,
                "orders": orders,
                "fills": fills,
                "rejections": rejections,
                "approval_required_orders": approval_required_orders,
                "account": len(account_records),
            },
            "loop": {
                "enabled": loop_enabled,
                "iterations": loop_iterations,
                "max_iterations": max_loop_iterations,
                "interval_seconds": loop_interval,
                "skip_duplicate_latest": skip_duplicate_latest,
            },
            "session": {
                "enabled": session_cfg is not None,
                "status": latest_session_status,
                "idle_iterations": session_idle_iterations,
            },
            "control": {
                "stopped_by_control": stopped_by_control,
                "stop_marker": str(stop_marker) if stop_marker is not None else None,
                "pause_marker": str(pause_marker) if pause_marker is not None else None,
            },
            "last_error": latest_error,
        }
        if note:
            payload["note"] = note
        if result is not None:
            payload["result"] = {
                "summary_path": output_dir / "summary.json",
                "performance_rollups_path": result.performance_rollups_path,
                "final_cash": result.final_cash,
                "final_equity": result.final_equity,
                "final_positions": result.final_positions,
                "total_return_pct": result.total_return_pct,
                "max_drawdown_pct": result.max_drawdown_pct,
                "account_snapshot_count": result.account_snapshot_count,
            }
        try:
            write_json_atomic(runner_status_path, payload)
        except Exception as exc:
            log.warning("Could not write runner status: %s", exc)

    update_runner_status("starting")

    def process_step(step: int, now: pd.Timestamp, panels: dict[str, pd.DataFrame]) -> None:
        nonlocal decisions
        nonlocal orders
        nonlocal fills
        nonlocal rejections
        nonlocal approval_required_orders
        nonlocal accepted_orders
        nonlocal final_prices
        nonlocal latest_data_time
        nonlocal paper_final_cash
        nonlocal paper_final_positions
        nonlocal last_decision_time

        snapshot = snapshot_at(panels, now, history_bars=history_bars)
        if not snapshot:
            update_runner_status("waiting_for_data", note="no snapshot data for current step")
            return
        snapshot_time = latest_snapshot_time(snapshot)
        if snapshot_time is not None:
            latest_data_time = snapshot_time.isoformat()
        final_prices = latest_prices(snapshot)
        if simulated is not None:
            simulated.accrue_borrow_fees(now, final_prices)
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
                accounting=simulated.accounting_snapshot(final_prices) if simulated is not None else None,
            )
            account_records.append(account_record)
            append_jsonl(output_dir / "account.jsonl", account_record)
            last_decision_time = now.isoformat()
            update_runner_status("paused", note=f"pause marker exists: {pause_marker}")
            log.info("Decision step=%d time=%s paused by %s", step, now.isoformat(), pause_marker)
            return
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
                "loop_enabled": loop_enabled,
                "loop_iteration": loop_iterations if loop_enabled else None,
            },
        )
        decision = plugin.on_data(snapshot, context)
        decisions += 1
        last_decision_time = decision.timestamp.isoformat()
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

            require_order_approval = bool(execution_cfg.get("require_order_approval", False))
            if require_order_approval:
                price = final_prices.get(intent.symbol)
                approval_status = "approved" if approve_orders else "required"
                append_jsonl(output_dir / "order_previews.jsonl", order_preview_record(
                    intent,
                    now=now,
                    step=step,
                    mode=mode,
                    price=price,
                    cash=float(cash) if cash is not None else None,
                    equity=float(equity) if equity is not None else None,
                    positions=positions,
                    approval_status=approval_status,
                ))
                if not approve_orders:
                    approval_required_orders += 1
                    reason = "manual approval required"
                    append_jsonl(output_dir / "orders.jsonl", {
                        "timestamp": now,
                        **intent_record(intent, status="approval_required", reason=reason),
                    })
                    log.warning("%s held: %s", intent.symbol, reason)
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
                    paper_final_cash = cash
                    paper_final_positions = positions
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
            accounting=simulated.accounting_snapshot(final_prices) if simulated is not None else None,
        )
        account_records.append(account_record)
        append_jsonl(output_dir / "account.jsonl", account_record)
        update_runner_status("running")

    def record_session_idle(step: int, now: pd.Timestamp, panels: dict[str, pd.DataFrame], state: dict[str, Any]) -> None:
        nonlocal decisions
        nonlocal final_prices
        nonlocal latest_data_time
        nonlocal session_idle_iterations
        nonlocal latest_session_status
        nonlocal last_decision_time

        snapshot = snapshot_at(panels, now, history_bars=history_bars)
        snapshot_time = latest_snapshot_time(snapshot)
        if snapshot_time is not None:
            latest_data_time = snapshot_time.isoformat()
        final_prices = latest_prices(snapshot) if snapshot else {}
        decisions += 1
        session_idle_iterations += 1
        latest_session_status = str(state.get("status") or "outside_session")
        append_jsonl(output_dir / "decisions.jsonl", {
            "timestamp": now,
            "step": step,
            "mode": mode,
            "signal": {"idle": True, "reason": "outside_session"},
            "diagnostics": {
                "idle": True,
                "reason": "outside_session",
                "session": state,
                "symbols": sorted(snapshot),
                "loop_enabled": loop_enabled,
                "loop_iteration": loop_iterations,
            },
            "intents": [],
        })
        log.info(
            "Decision step=%d time=%s idle outside configured session",
            step,
            now.isoformat(),
        )
        last_decision_time = now.isoformat()
        update_runner_status("idle", note="outside configured session")

    try:
        if not loop_enabled:
            panels = load_panels(config.get("data") or {})
            if mode in {"replay", "simulated_paper"}:
                times = replay_times(panels)
            else:
                times = [latest_time(panels)]
            if max_steps is not None:
                times = times[:max_steps]
            for step, now in enumerate(times, start=1):
                process_step(step, now, panels)
        else:
            step = 0
            while max_loop_iterations is None or loop_iterations < max_loop_iterations:
                if stop_marker is not None and stop_marker.exists():
                    stopped_by_control = True
                    log.info("Loop stopped by control marker: %s", stop_marker)
                    update_runner_status("stopped", note=f"stop marker exists: {stop_marker}")
                    break
                loop_iterations += 1
                panels = load_panels(config.get("data") or {})
                now = latest_time(panels)
                if skip_duplicate_latest and last_processed_latest is not None and now <= last_processed_latest:
                    log.info(
                        "Loop iteration=%d skipped duplicate latest data time=%s",
                        loop_iterations,
                        now.isoformat(),
                    )
                    latest_data_time = now.isoformat()
                    update_runner_status("waiting_for_new_data", note="latest data timestamp was already processed")
                else:
                    state = session_state(now, session_cfg)
                    step += 1
                    latest_session_status = str(state.get("status") or latest_session_status or "unrestricted")
                    if session_cfg is not None and not bool(state["inside"]) and session_cfg["outside_session"] == "idle":
                        record_session_idle(step, now, panels, state)
                    else:
                        process_step(step, now, panels)
                    last_processed_latest = now
                if max_loop_iterations is not None and loop_iterations >= max_loop_iterations:
                    break
                if loop_interval > 0:
                    time.sleep(loop_interval)
    except Exception as exc:
        latest_error = {"type": type(exc).__name__, "message": str(exc)}
        update_runner_status("failed", note=str(exc))
        raise
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
    performance_rollups_path = output_dir / "performance_rollups.json"
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
        performance_rollups_path=performance_rollups_path,
        runner_status_path=runner_status_path,
        account_snapshot_count=int(perf["account_snapshot_count"]),
        initial_equity=perf["initial_equity"],
        total_return_pct=perf["total_return_pct"],
        max_drawdown_pct=perf["max_drawdown_pct"],
        account_start_time=perf["account_start_time"],
        account_end_time=perf["account_end_time"],
        latest_data_time=latest_data_time,
        elapsed_seconds=perf["elapsed_seconds"],
        elapsed_days=perf["elapsed_days"],
        return_per_day_pct=perf["return_per_day_pct"],
        return_per_month_pct=perf["return_per_month_pct"],
        return_per_year_pct=perf["return_per_year_pct"],
        short_horizon_projection=bool(perf["short_horizon_projection"]),
        max_gross_exposure=perf["max_gross_exposure"],
        max_gross_exposure_pct=perf["max_gross_exposure_pct"],
        max_abs_net_exposure=perf["max_abs_net_exposure"],
        max_abs_net_exposure_pct=perf["max_abs_net_exposure_pct"],
        max_position_count=int(perf["max_position_count"]),
        realized_pnl=perf["realized_pnl"],
        unrealized_pnl=perf["unrealized_pnl"],
        total_pnl=perf["total_pnl"],
        total_commission=perf["total_commission"],
        total_borrow_fees=perf["total_borrow_fees"],
        approval_required_orders=approval_required_orders,
        loop_enabled=loop_enabled,
        loop_iterations=loop_iterations,
        session_enabled=session_cfg is not None,
        session_idle_iterations=session_idle_iterations,
        session_status=latest_session_status,
        stopped_by_control=stopped_by_control,
        stop_marker=str(stop_marker) if stop_marker is not None else None,
    )
    write_json(performance_rollups_path, account_rollup_artifact(account_records, result))
    write_json(output_dir / "summary.json", asdict(result))
    update_runner_status("stopped" if stopped_by_control else "completed", result=result)
    log.info(
        "Run complete: decisions=%d orders=%d fills=%d rejections=%d approval_required=%d loop_iterations=%d session_idle=%d stopped_by_control=%s output_dir=%s",
        decisions,
        orders,
        fills,
        rejections,
        approval_required_orders,
        loop_iterations,
        session_idle_iterations,
        stopped_by_control,
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
    parser.add_argument(
        "--allow-live-broker-port",
        action="store_true",
        help="Additional opt-in required if a paper config intentionally uses a known live IBKR port.",
    )
    parser.add_argument(
        "--approve-orders",
        action="store_true",
        help="Approve orders for configs that set execution.require_order_approval=true.",
    )
    parser.add_argument(
        "--loop",
        action="store_true",
        help="Continuously reload latest data and evaluate shadow/paper configs until stopped.",
    )
    parser.add_argument(
        "--loop-interval-seconds",
        type=float,
        default=None,
        help="Sleep interval between loop evaluations; defaults to runner.loop_interval_seconds or 60.",
    )
    parser.add_argument(
        "--max-loop-iterations",
        type=int,
        default=None,
        help="Optional safety bound for --loop, useful for smoke tests.",
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
                loop_override=args.loop if args.loop else None,
                max_loop_iterations_override=args.max_loop_iterations,
            )
            log.info("Config valid: %s", args.config)
            return
        run_from_config(
            args.config,
            mode_override=args.mode,
            output_dir_override=args.output_dir,
            max_steps=args.max_steps,
            confirm_paper_orders=args.confirm_paper_orders,
            approve_orders=args.approve_orders,
            allow_live_broker_port=args.allow_live_broker_port,
            loop=args.loop if args.loop else None,
            loop_interval_seconds=args.loop_interval_seconds,
            max_loop_iterations=args.max_loop_iterations,
        )
    except Exception as exc:
        log.error("Runner failed: %s", exc)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
