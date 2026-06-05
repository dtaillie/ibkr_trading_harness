from __future__ import annotations

from typing import Any

import pandas as pd

from framework.strategy_plugin import OrderIntent, StrategyContext, StrategyDecision


class RoundTripPlugin:
    name = "round_trip_fixture"

    def __init__(self, config: dict[str, Any]):
        self.symbol = str(config.get("symbol", "SPY"))
        self.quantity = float(config.get("quantity", 10.0))
        self.fills: list[dict[str, Any]] = []

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        step = int((context.metadata or {}).get("step") or 0)
        intents = []
        if self.symbol in data and step == 1:
            intents.append(OrderIntent(symbol=self.symbol, side="buy", quantity=self.quantity, tag="fixture_round_buy"))
        if self.symbol in data and step == 3 and context.positions.get(self.symbol):
            intents.append(OrderIntent(symbol=self.symbol, side="sell", quantity=self.quantity, tag="fixture_round_sell"))
        return StrategyDecision(
            timestamp=context.now,
            intents=intents,
            signal={"fixture": "round_trip"},
            diagnostics={"mode": context.mode, "step": step},
        )

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        self.fills.append(dict(fill))


def create_strategy(config: dict[str, Any]) -> RoundTripPlugin:
    return RoundTripPlugin(config)
