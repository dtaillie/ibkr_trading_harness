"""Minimal public strategy plugin interface.

This module is intentionally generic. Private strategy logic should implement
this interface in ignored/private modules, while public examples should remain
non-viable demonstrations.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any, Protocol

import pandas as pd


@dataclass(frozen=True)
class StrategyContext:
    now: pd.Timestamp
    mode: str
    cash: float | None = None
    equity: float | None = None
    positions: dict[str, float] = field(default_factory=dict)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class OrderIntent:
    symbol: str
    side: str
    quantity: float | None = None
    cash_quantity: float | None = None
    order_type: str = "market"
    tag: str = ""
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True)
class StrategyDecision:
    timestamp: pd.Timestamp
    intents: list[OrderIntent] = field(default_factory=list)
    signal: dict[str, Any] = field(default_factory=dict)
    diagnostics: dict[str, Any] = field(default_factory=dict)


def equity_fraction_cash(
    context: "StrategyContext",
    fraction: float,
    *,
    available: float | None = None,
    min_cash: float = 1.0,
) -> float | None:
    """Dollars to allocate to one entry: ``fraction`` of current equity, capped by the
    cash still available so concurrent positions across symbols never over-allocate the
    account. Returns ``None`` when too little cash remains to take a meaningful position.

    Pass ``available`` (a running cash budget you decrement as you append intents in one
    ``on_data`` call) to keep several same-bar entries from collectively over-spending.
    """
    equity = context.equity if context.equity is not None else context.cash
    if equity is None:
        return None
    target = float(equity) * float(fraction)
    cap = context.cash if available is None else available
    if cap is not None:
        target = min(target, float(cap))
    return target if target >= float(min_cash) else None


class StrategyPlugin(Protocol):
    """Protocol implemented by public examples and private strategy plugins."""

    name: str

    def on_start(self, config: dict[str, Any]) -> None:
        """Validate config and initialize strategy-local state."""

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        """Return order intents and diagnostics for the current data snapshot."""

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        """Update strategy-local state after an execution fill."""


def validate_strategy_config(config: dict[str, Any], *, full_config: dict[str, Any] | None = None) -> list[str]:
    """Optional plugin-module hook for static strategy config checks.

    Strategy modules or factory functions may expose ``validate_config`` or
    ``validate_strategy_config``. The generic runner calls those hooks during
    config validation before loading data or connecting to a broker.
    """
    return []
