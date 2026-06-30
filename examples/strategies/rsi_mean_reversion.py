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

from framework.strategy_plugin import OrderIntent, StrategyContext, StrategyDecision, equity_fraction_cash


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
        self.period = int(config.get("period", 14))
        self.oversold = float(config.get("oversold", 30))
        self.exit_level = float(config.get("exit_level", 52))
        self.position_fraction = float(config.get("position_fraction", 0.1))
        if self.period < 2:
            raise ValueError("rsi_mean_reversion: period must be >= 2")
        if not 0 < self.oversold < self.exit_level < 100:
            raise ValueError("rsi_mean_reversion: require 0 < oversold < exit_level < 100")
        if not 0 < self.position_fraction <= 1:
            raise ValueError("rsi_mean_reversion: position_fraction must be in (0, 1]")

    def on_data(self, data: dict[str, pd.DataFrame], context: StrategyContext) -> StrategyDecision:
        # Apply the per-symbol RSI rule to EVERY selected symbol independently; the account
        # is shared, entries size to a fraction of equity, and a running cash budget keeps
        # several same-bar entries from over-allocating the account.
        intents: list[OrderIntent] = []
        entries = exits = 0
        rsis: dict[str, float] = {}
        budget = context.cash
        for symbol, df in sorted(data.items()):
            held = float(context.positions.get(symbol, 0.0) or 0.0)
            if df is None or len(df) <= self.period:
                continue
            last = wilder_rsi(df["close"], self.period).iloc[-1]
            if pd.isna(last):
                continue
            rsi_now = float(last)
            rsis[symbol] = round(rsi_now, 2)
            if rsi_now < self.oversold and held <= 0:
                cash = equity_fraction_cash(context, self.position_fraction, available=budget)
                if cash is not None:
                    intents.append(OrderIntent(
                        symbol=symbol, side="buy", cash_quantity=cash,
                        order_type="market", tag="rsi_oversold_enter_long",
                    ))
                    if budget is not None:
                        budget -= cash
                    entries += 1
            elif rsi_now > self.exit_level and held > 0:
                intents.append(OrderIntent(
                    symbol=symbol, side="sell", quantity=held,
                    order_type="market", tag="rsi_recovered_exit_long",
                ))
                exits += 1

        reason = "no_signal" if not intents else f"{entries} entries, {exits} exits"
        return StrategyDecision(
            timestamp=context.now,
            intents=intents,
            signal={"reason": reason, "entries": entries, "exits": exits, "rsi": rsis},
            diagnostics={
                "symbols_seen": sorted(data),
                "note": "Example only; non-viable textbook RSI mean reversion applied per symbol, no edge.",
                "dashboard": {
                    "reason": reason,
                    "signal_label": f"RSI({self.period}) crosses",
                    "signal_value": float(len(intents)),
                    "threshold": self.oversold,
                    "near_threshold": False,
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
