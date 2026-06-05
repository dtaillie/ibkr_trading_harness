"""Non-viable example strategy plugin.

This plugin exists only to demonstrate the interface. It intentionally emits no
orders and should not be used as a trading strategy.
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
                "note": "This public example intentionally emits no orders.",
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
