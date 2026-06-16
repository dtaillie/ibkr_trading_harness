"""Educational example strategy: RSI mean reversion.

EXAMPLE ONLY -- this is a non-viable demonstration that exists to show the
StrategyPlugin interface end to end (a real BUY then a real SELL). It implements
a textbook public pattern (buy oversold, exit on recovery via Wilder's RSI) with
NO claimed edge, NO tuning, and NO research value; it demonstrates wiring only.
Do not trade it.

Rule:
  - BUY  (enter long) when RSI drops below ``oversold`` while flat.
  - SELL (flat) when RSI recovers above ``exit_level`` while long.

Entries size by dollars (``cash_quantity``); exits sell the held quantity.
"""

from __future__ import annotations

from typing import Any

import pandas as pd

from framework.strategy_plugin import OrderIntent, StrategyContext, StrategyDecision


def wilder_rsi(close: pd.Series, period: int) -> pd.Series:
    """Standard Wilder's RSI (exponential smoothing with alpha = 1/period)."""
    delta = close.diff()
    gain = delta.clip(lower=0.0)
    loss = (-delta).clip(lower=0.0)
    avg_gain = gain.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    avg_loss = loss.ewm(alpha=1 / period, min_periods=period, adjust=False).mean()
    rs = avg_gain / avg_loss
    rsi = 100 - 100 / (1 + rs)
    return rsi.where(avg_loss != 0, 100.0)


class RsiMeanReversionStrategy:
    name = "rsi_mean_reversion"

    def on_start(self, config: dict[str, Any]) -> None:
        self.config = dict(config)
        self.symbol = str(config.get("symbol", "SPY")).upper()
        self.period = int(config.get("period", 14))
        self.oversold = float(config.get("oversold", 30))
        self.exit_level = float(config.get("exit_level", 52))
        self.cash_quantity = float(config.get("cash_quantity", 10_000))
        if self.period < 2:
            raise ValueError("rsi_mean_reversion: period must be >= 2")
        if not 0 < self.oversold < self.exit_level < 100:
            raise ValueError("rsi_mean_reversion: require 0 < oversold < exit_level < 100")
        if self.cash_quantity <= 0:
            raise ValueError("rsi_mean_reversion: cash_quantity must be > 0")

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        intents: list[OrderIntent] = []
        reason = "no_signal"
        df = data.get(self.symbol)
        held = float(context.positions.get(self.symbol, 0.0) or 0.0)
        rsi_now = None

        if df is not None and len(df) > self.period:
            rsi = wilder_rsi(df["close"], self.period)
            last = rsi.iloc[-1]
            if pd.notna(last):
                rsi_now = float(last)
                if rsi_now < self.oversold and held <= 0:
                    intents.append(OrderIntent(
                        symbol=self.symbol, side="buy", cash_quantity=self.cash_quantity,
                        order_type="market", tag="rsi_oversold_enter_long",
                    ))
                    reason = "rsi_below_oversold"
                elif rsi_now > self.exit_level and held > 0:
                    intents.append(OrderIntent(
                        symbol=self.symbol, side="sell", quantity=held,
                        order_type="market", tag="rsi_recovered_exit_long",
                    ))
                    reason = "rsi_above_exit_level"

        return StrategyDecision(
            timestamp=context.now,
            intents=intents,
            signal={"reason": reason, "rsi": rsi_now},
            diagnostics={
                "symbols_seen": sorted(data),
                "note": "Example only; non-viable textbook RSI mean reversion, no edge.",
                "dashboard": {
                    "reason": reason,
                    "signal_label": f"RSI({self.period})",
                    "signal_value": round(rsi_now, 2) if rsi_now is not None else 0.0,
                    "threshold": self.oversold,
                    "near_threshold": rsi_now is not None and abs(rsi_now - self.oversold) < 5,
                    "active_exit_rule": f"rsi_above_{self.exit_level:g}",
                },
            },
        )

    def on_fill(self, fill: dict[str, Any], context: StrategyContext) -> None:
        return None


def create_strategy(config: dict[str, Any]) -> RsiMeanReversionStrategy:
    strategy = RsiMeanReversionStrategy()
    strategy.on_start(config)
    return strategy
