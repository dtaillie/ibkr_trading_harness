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


class StrategyPlugin(Protocol):
    """Protocol implemented by public examples and private strategy plugins."""

    name: str

    def on_start(self, config: dict[str, Any]) -> None:
        """Validate config and initialize strategy-local state."""

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        """Return order intents and diagnostics for the current data snapshot."""

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        """Update strategy-local state after an execution fill."""

