"""Educational example strategy: opening-range breakout (ORB).

EXAMPLE ONLY -- this is a non-viable demonstration that exists to show the
StrategyPlugin interface end to end (a real BUY then a real SELL). It implements
a textbook public pattern (define the first N bars' high/low as the opening
range, go long on the first close above the range high, exit at a measured-move
target or a stop at the range low) with NO claimed edge, NO tuning, and NO
research value; it demonstrates wiring only. Do not trade it.

Rule:
  - BUY  (enter long) on the first close ABOVE the opening-range high while flat.
  - SELL (flat) when price reaches the target (range_high + target_r * range)
    OR falls to the stop (range_low).

Entries size by dollars (``cash_quantity``); exits sell the held quantity. The
opening range is taken from the first ``opening_range_bars`` bars in the
snapshot, so the data should start at the session open.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from framework.strategy_plugin import OrderIntent, StrategyContext, StrategyDecision


class OpeningRangeBreakoutStrategy:
    name = "opening_range_breakout"

    def on_start(self, config: dict[str, Any]) -> None:
        self.config = dict(config)
        self.symbol = str(config.get("symbol", "SPY")).upper()
        self.opening_range_bars = int(config.get("opening_range_bars", 6))
        self.target_r = float(config.get("target_r", 2.0))
        self.cash_quantity = float(config.get("cash_quantity", 10_000))
        if self.opening_range_bars < 1:
            raise ValueError("opening_range_breakout: opening_range_bars must be >= 1")
        if self.target_r <= 0:
            raise ValueError("opening_range_breakout: target_r must be > 0")
        if self.cash_quantity <= 0:
            raise ValueError("opening_range_breakout: cash_quantity must be > 0")

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        intents: list[OrderIntent] = []
        reason = "no_signal"
        df = data.get(self.symbol)
        held = float(context.positions.get(self.symbol, 0.0) or 0.0)
        range_high = range_low = last_close = None

        n = self.opening_range_bars
        if df is not None and len(df) > n:
            opening = df.iloc[:n]
            range_high = float(opening["high"].max())
            range_low = float(opening["low"].min())
            span = max(range_high - range_low, 1e-9)
            target = range_high + self.target_r * span
            last_close = float(df["close"].iloc[-1])
            prev_close = float(df["close"].iloc[-2])

            crossed_up = prev_close <= range_high < last_close
            if crossed_up and held <= 0:
                intents.append(OrderIntent(
                    symbol=self.symbol, side="buy", cash_quantity=self.cash_quantity,
                    order_type="market", tag="orb_breakout_enter_long",
                ))
                reason = "broke_opening_range_high"
            elif held > 0 and (last_close >= target or last_close <= range_low):
                intents.append(OrderIntent(
                    symbol=self.symbol, side="sell", quantity=held,
                    order_type="market", tag="orb_target_or_stop_exit",
                ))
                reason = "target_hit" if last_close >= target else "stopped_at_range_low"

        distance = None if (range_high is None or last_close is None) else last_close - range_high
        return StrategyDecision(
            timestamp=context.now,
            intents=intents,
            signal={"reason": reason, "range_high": range_high, "range_low": range_low},
            diagnostics={
                "symbols_seen": sorted(data),
                "note": "Example only; non-viable textbook opening-range breakout, no edge.",
                "dashboard": {
                    "reason": reason,
                    "signal_label": "close - opening-range high",
                    "signal_value": round(distance, 4) if distance is not None else 0.0,
                    "threshold": 0.0,
                    "near_threshold": distance is not None and abs(distance) < 0.10,
                    "active_exit_rule": f"target_{self.target_r:g}R_or_range_low_stop",
                },
            },
        )

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        return None


def create_strategy(config: dict[str, Any]) -> OpeningRangeBreakoutStrategy:
    strategy = OpeningRangeBreakoutStrategy()
    strategy.on_start(config)
    return strategy
