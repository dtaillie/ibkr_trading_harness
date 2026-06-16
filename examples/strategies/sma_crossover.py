"""Educational example strategy: simple moving-average (SMA) crossover.

EXAMPLE ONLY -- this is a non-viable demonstration that exists to show the
StrategyPlugin interface end to end (a real BUY then a real SELL). It implements
a textbook public pattern (fast SMA crossing a slow SMA) with NO claimed edge,
NO tuning, and NO research value; it demonstrates wiring only. Do not trade it.

Rule:
  - BUY  (enter long) when the fast SMA crosses ABOVE the slow SMA while flat.
  - SELL (flat) when the fast SMA crosses BELOW the slow SMA while long.

Entries size by dollars (``cash_quantity``); exits sell the held quantity, since
the runner requires an explicit quantity on sell intents.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from framework.strategy_plugin import OrderIntent, StrategyContext, StrategyDecision


class SmaCrossoverStrategy:
    name = "sma_crossover"

    def on_start(self, config: dict[str, Any]) -> None:
        self.config = dict(config)
        self.symbol = str(config.get("symbol", "SPY")).upper()
        self.fast = int(config.get("fast", 5))
        self.slow = int(config.get("slow", 20))
        self.cash_quantity = float(config.get("cash_quantity", 10_000))
        if self.fast < 1 or self.slow < 1:
            raise ValueError("sma_crossover: fast and slow must be >= 1")
        if self.fast >= self.slow:
            raise ValueError("sma_crossover: fast must be strictly less than slow")
        if self.cash_quantity <= 0:
            raise ValueError("sma_crossover: cash_quantity must be > 0")

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        intents: list[OrderIntent] = []
        reason = "no_signal"
        df = data.get(self.symbol)
        held = float(context.positions.get(self.symbol, 0.0) or 0.0)
        fast_now = slow_now = None

        if df is not None and len(df) > self.slow:
            close = df["close"]
            fast = close.rolling(self.fast).mean()
            slow = close.rolling(self.slow).mean()
            fast_now, fast_prev = float(fast.iloc[-1]), float(fast.iloc[-2])
            slow_now, slow_prev = float(slow.iloc[-1]), float(slow.iloc[-2])
            cross_up = fast_prev <= slow_prev and fast_now > slow_now
            cross_down = fast_prev >= slow_prev and fast_now < slow_now

            if cross_up and held <= 0:
                intents.append(OrderIntent(
                    symbol=self.symbol, side="buy", cash_quantity=self.cash_quantity,
                    order_type="market", tag="sma_cross_up_enter_long",
                ))
                reason = "fast_crossed_above_slow"
            elif cross_down and held > 0:
                intents.append(OrderIntent(
                    symbol=self.symbol, side="sell", quantity=held,
                    order_type="market", tag="sma_cross_down_exit_long",
                ))
                reason = "fast_crossed_below_slow"

        spread = None if fast_now is None or slow_now is None else fast_now - slow_now
        return StrategyDecision(
            timestamp=context.now,
            intents=intents,
            signal={"reason": reason, "fast_sma": fast_now, "slow_sma": slow_now},
            diagnostics={
                "symbols_seen": sorted(data),
                "note": "Example only; non-viable textbook SMA crossover, no edge.",
                "dashboard": {
                    "reason": reason,
                    "signal_label": f"SMA{self.fast}-SMA{self.slow} spread",
                    "signal_value": round(spread, 4) if spread is not None else 0.0,
                    "threshold": 0.0,
                    "near_threshold": spread is not None and abs(spread) < 0.05,
                    "active_exit_rule": "sma_cross_down",
                },
            },
        )

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        return None


def create_strategy(config: dict[str, Any]) -> SmaCrossoverStrategy:
    strategy = SmaCrossoverStrategy()
    strategy.on_start(config)
    return strategy
