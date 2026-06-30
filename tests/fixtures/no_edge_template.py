"""Test fixture: a no-op strategy plugin.

Relocated from the public examples (it used to be
``examples.strategies.no_edge_template``) once the named example strategies
(sma_crossover, rsi_mean_reversion, opening_range_breakout) became the public
face. It survives only as a test vehicle: a permissive strategy that accepts any
config and intentionally emits no orders, so the generic runner can be exercised
(replay, decisions, config preview) without trading behaviour getting in the way.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from framework.strategy_plugin import StrategyContext, StrategyDecision


class NoEdgeTemplateStrategy:
    name = "no_edge_template"

    def on_start(self, config: dict[str, Any]) -> None:
        self.config = dict(config)

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        return StrategyDecision(
            timestamp=context.now,
            intents=[],
            signal={"reason": "example_only_no_signal"},
            diagnostics={
                "symbols_seen": sorted(data),
                "note": "This fixture intentionally emits no orders.",
                "dashboard": {
                    "reason": "example_only_no_signal",
                    "signal_label": "Example score",
                    "signal_value": 0.0,
                    "threshold": 1.0,
                    "threshold_distance": -1.0,
                    "near_threshold": False,
                    "expected_hold_minutes": 0,
                    "active_exit_rule": "none",
                },
            },
        )

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        return None


def create_strategy(config: dict[str, Any]) -> NoEdgeTemplateStrategy:
    strategy = NoEdgeTemplateStrategy()
    strategy.on_start(config)
    return strategy
