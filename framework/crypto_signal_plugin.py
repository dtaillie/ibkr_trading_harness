"""Protocol for crypto signal plugins used by paper/sim runners."""

from __future__ import annotations

from dataclasses import dataclass
from datetime import datetime
from typing import Any, Protocol

import pandas as pd


@dataclass(frozen=True)
class CryptoSignal:
    decision_time: pd.Timestamp
    symbol: str | None
    signal: float | None
    raw_return: float | None
    market_return: float | None
    reason: str


class CryptoSignalPlugin(Protocol):
    name: str

    def target_symbols(self, symbols: list[str], strategy_cfg: dict[str, Any]) -> list[str]:
        """Return tradable target symbols from the configured universe."""

    def select_signal(
        self,
        close: pd.DataFrame,
        good: pd.DataFrame,
        strategy_cfg: dict[str, Any],
    ) -> CryptoSignal:
        """Return the signal for the current decision window."""

    def position_entry_price(
        self,
        state: dict[str, Any],
        symbol: str,
        prices: dict[str, float],
    ) -> float | None:
        """Return the price to use for active-position exit checks."""

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
        """Evaluate an exit using recent bars."""

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
        """Evaluate an exit from live tick/snapshot price updates."""
