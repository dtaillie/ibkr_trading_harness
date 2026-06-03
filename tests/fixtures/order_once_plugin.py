from __future__ import annotations

from typing import Any

import pandas as pd

from framework.strategy_plugin import OrderIntent, StrategyContext, StrategyDecision


class OrderOncePlugin:
    name = "order_once_fixture"

    def __init__(self, config: dict[str, Any]):
        self.symbol = str(config.get("symbol", "SPY"))
        self.side = str(config.get("side", "buy"))
        self.quantity = config.get("quantity")
        self.cash_quantity = config.get("cash_quantity", 1000.0)
        self.repeat = bool(config.get("repeat", False))
        self.did_order = False
        self.fills: list[dict[str, Any]] = []

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        intents = []
        should_order = self.repeat or not self.did_order
        if should_order and self.symbol in data and (self.repeat or not context.positions.get(self.symbol)):
            intents.append(
                OrderIntent(
                    symbol=self.symbol,
                    side=self.side,
                    quantity=self.quantity,
                    cash_quantity=self.cash_quantity,
                    tag="fixture_buy_once",
                )
            )
            self.did_order = True
        return StrategyDecision(
            timestamp=context.now,
            intents=intents,
            signal={"fixture": "order_once"},
            diagnostics={"mode": context.mode},
        )

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        self.fills.append(dict(fill))


def create_strategy(config: dict[str, Any]) -> OrderOncePlugin:
    return OrderOncePlugin(config)
