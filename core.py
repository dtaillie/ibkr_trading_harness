"""Core data types used throughout the framework."""

from dataclasses import dataclass, field
from datetime import datetime
from enum import Enum, auto


class Side(Enum):
    BUY = auto()
    SELL = auto()


class OrderStatus(Enum):
    PENDING = auto()
    FILLED = auto()
    REJECTED = auto()


@dataclass(frozen=True, slots=True)
class Bar:
    """Single OHLCV bar.

    `slots=True` cuts per-instance memory from ~250B (dict-based) to ~80B,
    which is the difference between fitting 40M bars in RAM or OOM-crashing.
    """
    symbol: str
    timestamp: datetime
    open: float
    high: float
    low: float
    close: float
    volume: float


@dataclass
class Order:
    """Market order submitted by a strategy."""
    symbol: str
    side: Side
    quantity: int | float
    timestamp: datetime | None = None
    status: OrderStatus = OrderStatus.PENDING
    tag: str = ""  # optional label for debugging
    # Optional simulator-only trigger price (e.g. stop/target touched intrabar).
    # Live brokers should ignore this and express the native order type instead.
    fill_price_override: float | None = None
    # Optional native cash notional for venues/order types that require cash
    # sizing instead of asset units. IBKR ZeroHash crypto BUY orders require it.
    cash_quantity: float | None = None


@dataclass(frozen=True, slots=True)
class Fill:
    """Executed order."""
    symbol: str
    side: Side
    quantity: int
    price: float
    commission: float
    timestamp: datetime
    tag: str = ""


@dataclass
class Position:
    """Current holding in a single symbol."""
    symbol: str
    quantity: int = 0
    avg_cost: float = 0.0

    @property
    def market_value(self) -> float:
        return 0.0  # needs a price; computed externally

    def update(self, fill: Fill) -> None:
        delta = fill.quantity if fill.side == Side.BUY else -fill.quantity
        new_quantity = self.quantity + delta
        if self.quantity == 0:
            # Opening fresh (long if BUY, short if SELL)
            self.avg_cost = fill.price
        elif (self.quantity > 0 and delta > 0) or (self.quantity < 0 and delta < 0):
            # Adding to existing position on the same side — weighted average
            total = abs(self.avg_cost * self.quantity) + abs(fill.price * delta)
            self.avg_cost = total / abs(new_quantity) if new_quantity != 0 else 0.0
        elif (self.quantity > 0 and new_quantity < 0) or (self.quantity < 0 and new_quantity > 0):
            # Position flipped through zero — fresh basis on the new side
            self.avg_cost = fill.price
        # else: reducing position (BUY-to-cover short, or SELL-to-close long)
        # — keep avg_cost unchanged
        self.quantity = new_quantity
        if self.quantity == 0:
            self.avg_cost = 0.0
