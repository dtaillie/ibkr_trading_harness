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

from framework.strategy_plugin import OrderIntent, StrategyContext, StrategyDecision, equity_fraction_cash


class SmaCrossoverStrategy:
    name = "sma_crossover"

    def on_start(self, config: dict[str, Any]) -> None:
        self.config = dict(config)
        self.fast = int(config.get("fast", 5))
        self.slow = int(config.get("slow", 20))
        self.position_fraction = float(config.get("position_fraction", 0.1))
        if self.fast < 1 or self.slow < 1:
            raise ValueError("sma_crossover: fast and slow must be >= 1")
        if self.fast >= self.slow:
            raise ValueError("sma_crossover: fast must be strictly less than slow")
        if not 0 < self.position_fraction <= 1:
            raise ValueError("sma_crossover: position_fraction must be in (0, 1]")

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        # Apply the per-symbol crossover rule to EVERY selected symbol independently.
        # The account (cash, positions) is shared, so this is a portfolio of independent
        # single-symbol signals; entries size to a fraction of equity and a running cash
        # budget keeps several same-bar entries from over-allocating the account.
        intents: list[OrderIntent] = []
        entries = exits = 0
        spreads: dict[str, float] = {}
        budget = context.cash
        for symbol, df in sorted(data.items()):
            held = float(context.positions.get(symbol, 0.0) or 0.0)
            if df is None or len(df) <= self.slow:
                continue
            close = df["close"]
            fast = close.rolling(self.fast).mean()
            slow = close.rolling(self.slow).mean()
            fast_now, fast_prev = float(fast.iloc[-1]), float(fast.iloc[-2])
            slow_now, slow_prev = float(slow.iloc[-1]), float(slow.iloc[-2])
            spreads[symbol] = round(fast_now - slow_now, 4)
            cross_up = fast_prev <= slow_prev and fast_now > slow_now
            cross_down = fast_prev >= slow_prev and fast_now < slow_now
            if cross_up and held <= 0:
                cash = equity_fraction_cash(context, self.position_fraction, available=budget)
                if cash is not None:
                    intents.append(OrderIntent(
                        symbol=symbol, side="buy", cash_quantity=cash,
                        order_type="market", tag="sma_cross_up_enter_long",
                    ))
                    if budget is not None:
                        budget -= cash
                    entries += 1
            elif cross_down and held > 0:
                intents.append(OrderIntent(
                    symbol=symbol, side="sell", quantity=held,
                    order_type="market", tag="sma_cross_down_exit_long",
                ))
                exits += 1

        reason = "no_signal" if not intents else f"{entries} entries, {exits} exits"
        return StrategyDecision(
            timestamp=context.now,
            intents=intents,
            signal={"reason": reason, "entries": entries, "exits": exits, "spreads": spreads},
            diagnostics={
                "symbols_seen": sorted(data),
                "note": "Example only; non-viable textbook SMA crossover applied per symbol, no edge.",
                "dashboard": {
                    "reason": reason,
                    "signal_label": f"SMA{self.fast}-SMA{self.slow} crosses",
                    "signal_value": float(len(intents)),
                    "threshold": 0.0,
                    "near_threshold": False,
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
