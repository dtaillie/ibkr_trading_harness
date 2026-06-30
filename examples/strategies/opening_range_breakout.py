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

from framework.strategy_plugin import OrderIntent, StrategyContext, StrategyDecision, equity_fraction_cash


class OpeningRangeBreakoutStrategy:
    name = "opening_range_breakout"

    def on_start(self, config: dict[str, Any]) -> None:
        self.config = dict(config)
        self.opening_range_bars = int(config.get("opening_range_bars", 6))
        self.target_r = float(config.get("target_r", 2.0))
        self.position_fraction = float(config.get("position_fraction", 0.1))
        if self.opening_range_bars < 1:
            raise ValueError("opening_range_breakout: opening_range_bars must be >= 1")
        if self.target_r <= 0:
            raise ValueError("opening_range_breakout: target_r must be > 0")
        if not 0 < self.position_fraction <= 1:
            raise ValueError("opening_range_breakout: position_fraction must be in (0, 1]")

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        # Apply the per-symbol opening-range-breakout rule to EVERY selected symbol
        # independently; the account is shared, entries size to a fraction of equity, and a
        # running cash budget keeps several same-bar entries from over-allocating.
        intents: list[OrderIntent] = []
        entries = exits = 0
        distances: dict[str, float] = {}
        budget = context.cash
        n = self.opening_range_bars
        for symbol, df in sorted(data.items()):
            held = float(context.positions.get(symbol, 0.0) or 0.0)
            if df is None or len(df) <= n:
                continue
            opening = df.iloc[:n]
            range_high = float(opening["high"].max())
            range_low = float(opening["low"].min())
            span = max(range_high - range_low, 1e-9)
            target = range_high + self.target_r * span
            last_close = float(df["close"].iloc[-1])
            prev_close = float(df["close"].iloc[-2])
            distances[symbol] = round(last_close - range_high, 4)
            crossed_up = prev_close <= range_high < last_close
            if crossed_up and held <= 0:
                cash = equity_fraction_cash(context, self.position_fraction, available=budget)
                if cash is not None:
                    intents.append(OrderIntent(
                        symbol=symbol, side="buy", cash_quantity=cash,
                        order_type="market", tag="orb_breakout_enter_long",
                    ))
                    if budget is not None:
                        budget -= cash
                    entries += 1
            elif held > 0 and (last_close >= target or last_close <= range_low):
                intents.append(OrderIntent(
                    symbol=symbol, side="sell", quantity=held,
                    order_type="market", tag="orb_target_or_stop_exit",
                ))
                exits += 1

        reason = "no_signal" if not intents else f"{entries} entries, {exits} exits"
        return StrategyDecision(
            timestamp=context.now,
            intents=intents,
            signal={"reason": reason, "entries": entries, "exits": exits, "distance": distances},
            diagnostics={
                "symbols_seen": sorted(data),
                "note": "Example only; non-viable textbook opening-range breakout applied per symbol, no edge.",
                "dashboard": {
                    "reason": reason,
                    "signal_label": "opening-range breakouts",
                    "signal_value": float(len(intents)),
                    "threshold": 0.0,
                    "near_threshold": False,
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
