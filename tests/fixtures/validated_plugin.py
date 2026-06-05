from __future__ import annotations

from typing import Any

import pandas as pd

from framework.strategy_plugin import StrategyContext, StrategyDecision


def validate_config(config: dict[str, Any], *, full_config: dict[str, Any] | None = None) -> list[str]:
    errors = []
    if not isinstance(config.get("symbol"), str) or not config["symbol"].strip():
        errors.append("strategy.symbol must be a non-empty string")
    if config.get("threshold") is None:
        errors.append("strategy.threshold is required")
    return errors


class ValidatedPlugin:
    name = "validated_fixture"

    def __init__(self, config: dict[str, Any]):
        self.config = dict(config)

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        return StrategyDecision(
            timestamp=context.now,
            intents=[],
            signal={"fixture": "validated"},
            diagnostics={"symbols_seen": sorted(data)},
        )

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        return None


def create_strategy(config: dict[str, Any]) -> ValidatedPlugin:
    return ValidatedPlugin(config)
