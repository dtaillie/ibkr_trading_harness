"""Example-only crypto signal plugin.

This deliberately emits no tradable edge. It exists to show the plugin contract
without publishing a strategy.
"""

from __future__ import annotations

from datetime import datetime
from typing import Any

import pandas as pd

from framework.crypto_signal_plugin import CryptoSignal


class NoEdgeCryptoSignalPlugin:
    name = "no_edge_crypto_signal"

    def __init__(self, config: dict[str, Any]):
        self.config = config

    def target_symbols(self, symbols: list[str], strategy_cfg: dict[str, Any]) -> list[str]:
        configured = strategy_cfg.get("target_symbols")
        allowed = {str(symbol).upper() for symbol in configured} if configured else set(symbols)
        excluded = {str(symbol).upper() for symbol in strategy_cfg.get("target_exclude_symbols", [])}
        return [symbol for symbol in symbols if symbol in allowed and symbol not in excluded]

    def select_signal(
        self,
        close: pd.DataFrame,
        good: pd.DataFrame,
        strategy_cfg: dict[str, Any],
    ) -> CryptoSignal:
        if close.empty:
            decision_time = pd.Timestamp.now(tz="UTC").floor("h")
        else:
            decision_time = close.index.max()
        return CryptoSignal(decision_time, None, None, None, None, "example_no_edge")

    def position_entry_price(
        self,
        state: dict[str, Any],
        symbol: str,
        prices: dict[str, float],
    ) -> float | None:
        raw = state.get("current_entry_price")
        try:
            price = float(raw)
        except (TypeError, ValueError):
            price = 0.0
        if price > 0:
            return price
        fallback = prices.get(symbol)
        return float(fallback) if fallback and fallback > 0 else None

    def evaluate_position_exit(
        self,
        *,
        panel: dict[str, pd.DataFrame],
        symbol: str,
        entry_time: datetime | None,
        entry_price: float | None,
        hold_until: datetime | None,
        now: datetime,
        prior_high_water: float | None,
        exit_cfg: dict[str, Any],
        check_start_time: datetime | None = None,
    ) -> tuple[str | None, float | None]:
        if not exit_cfg.get("enabled", False):
            return None, prior_high_water
        high_water = prior_high_water or entry_price
        if hold_until is not None and now >= hold_until:
            return "exit_max_hold", high_water
        return None, high_water

    def evaluate_tick_exit(
        self,
        *,
        price: float,
        entry_price: float,
        high_water: float,
        hold_until: datetime | None,
        now: datetime,
        exit_cfg: dict[str, Any],
    ) -> tuple[str | None, float]:
        high_water = max(high_water, price)
        if exit_cfg.get("enabled", False) and hold_until is not None and now >= hold_until:
            return "exit_max_hold", high_water
        return None, high_water


def create_plugin(config: dict[str, Any]) -> NoEdgeCryptoSignalPlugin:
    return NoEdgeCryptoSignalPlugin(config)
