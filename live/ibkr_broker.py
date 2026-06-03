"""IBKR broker adapter — same role as SimulatedBroker but executes real orders."""

from __future__ import annotations

import logging
import os
from datetime import datetime

from ib_insync import IB, MarketOrder, Order as IBOrder, Stock, Crypto, Contract

from core import Fill, Order, OrderStatus, Side

log = logging.getLogger(__name__)


DEFAULT_CRYPTO_EXCHANGE = os.getenv("IBKR_CRYPTO_EXCHANGE", "ZEROHASH")


def _make_contract(symbol: str) -> Contract:
    """Create an IBKR contract for a symbol."""
    if symbol.endswith("-USD"):
        # Crypto: BTC-USD -> symbol=BTC, exchange=ZEROHASH by default.
        crypto_sym = symbol.split("-")[0]
        return Crypto(crypto_sym, DEFAULT_CRYPTO_EXCHANGE, "USD")
    return Stock(symbol, "SMART", "USD")


def _build_ib_order(order: Order, action: str, is_crypto: bool):
    if is_crypto:
        # IBKR ZeroHash requires crypto BUY orders to be expressed as USD
        # cash quantity. Crypto SELL orders are expressed in asset units.
        if order.side == Side.BUY:
            if order.cash_quantity is None or order.cash_quantity <= 0:
                raise ValueError("IBKR crypto BUY requires order.cash_quantity")
            ib_order = MarketOrder(action, 0)
            ib_order.cashQty = float(order.cash_quantity)
            ib_order.tif = "IOC"
            return ib_order
        ib_order = MarketOrder(action, order.quantity)
        ib_order.tif = "IOC"
        return ib_order

    # MidPrice: fill at NBBO midpoint or better
    return IBOrder(
        action=action,
        totalQuantity=order.quantity,
        orderType="MIDPRICE",
    )


class IBKRBroker:
    """Connects to TWS/Gateway and submits orders."""

    def __init__(
        self,
        host: str = "127.0.0.1",
        port: int = 7497,  # TWS paper default; Gateway paper = 4002
        client_id: int = 1,
    ):
        self.host = host
        self.port = port
        self.client_id = client_id
        self.ib = IB()
        self.fill_log: list[Fill] = []
        self.last_order_status: str = ""
        self.last_order_message: str = ""

    def connect(self) -> None:
        """Connect to TWS/Gateway."""
        log.info(f"Connecting to IBKR at {self.host}:{self.port}...")
        self.ib.connect(self.host, self.port, clientId=self.client_id)
        log.info(f"Connected. Account: {self.ib.managedAccounts()}")

    def disconnect(self) -> None:
        if self.ib.isConnected():
            self.ib.disconnect()
            log.info("Disconnected from IBKR.")

    def get_cash(self) -> float:
        """Get available cash balance."""
        account_values = self.ib.accountSummary()
        for av in account_values:
            if av.tag == "AvailableFunds" and av.currency == "USD":
                return float(av.value)
        return 0.0

    def get_positions(self) -> dict[str, float]:
        """Get current positions as {symbol: quantity}."""
        positions = {}
        for pos in self.ib.positions():
            sym = pos.contract.symbol
            # Reconstruct our symbol format for crypto
            if isinstance(pos.contract, Crypto):
                sym = f"{sym}-USD"
            if pos.position != 0:
                positions[sym] = float(pos.position)
        return positions

    def submit_order(self, order: Order) -> Fill | None:
        """Submit a market order and wait for fill."""
        self.last_order_status = ""
        self.last_order_message = ""
        if order.fill_price_override is not None:
            order.status = OrderStatus.REJECTED
            self.last_order_status = "REJECTED"
            self.last_order_message = "simulator-only fill_price_override"
            log.error(
                "Refusing live order with simulator-only fill_price_override: "
                "%s qty=%s tag=%r override=%.4f. Use a native IBKR stop/limit "
                "order type before enabling this strategy live.",
                order.symbol,
                order.quantity,
                order.tag,
                order.fill_price_override,
            )
            return None

        contract = _make_contract(order.symbol)
        self.ib.qualifyContracts(contract)

        action = "BUY" if order.side == Side.BUY else "SELL"
        is_crypto = order.symbol.endswith("-USD")
        try:
            ib_order = _build_ib_order(order, action, is_crypto)
        except ValueError as exc:
            order.status = OrderStatus.REJECTED
            self.last_order_status = "REJECTED"
            self.last_order_message = str(exc)
            log.error("Refusing live order: %s", exc)
            return None

        cash_part = f" cashQty=${order.cash_quantity:.2f}" if order.cash_quantity else ""
        log.info(f"Submitting: {action} {order.quantity} {order.symbol}{cash_part} [{order.tag}]")
        trade = self.ib.placeOrder(contract, ib_order)

        # Wait for fill (timeout after 30 seconds)
        timeout = 30
        self.ib.sleep(1)
        for _ in range(timeout):
            if trade.isDone():
                break
            self.ib.sleep(1)

        if trade.orderStatus.status == "Filled":
            avg_price = trade.orderStatus.avgFillPrice
            commission = sum(f.commission for f in trade.fills if f.commission)
            filled_quantity = float(trade.orderStatus.filled or order.quantity)
            fill = Fill(
                symbol=order.symbol,
                side=order.side,
                quantity=filled_quantity,
                price=avg_price,
                commission=commission,
                timestamp=datetime.now(),
                tag=order.tag,
            )
            self.fill_log.append(fill)
            order.status = OrderStatus.FILLED
            self.last_order_status = "Filled"
            self.last_order_message = ""
            log.info(
                f"Filled: {action} {order.quantity} {order.symbol} "
                f"@ ${avg_price:.2f} commission=${commission:.2f}"
            )
            return fill
        else:
            status = trade.orderStatus.status
            order.status = OrderStatus.REJECTED
            messages = [
                entry.message
                for entry in trade.log
                if getattr(entry, "message", "")
            ]
            self.last_order_status = status
            self.last_order_message = " | ".join(messages)
            log.warning(
                "Order not filled: %s status=%s message=%s",
                order.symbol,
                status,
                self.last_order_message,
            )
            # Cancel if still pending
            if not trade.isDone():
                self.ib.cancelOrder(ib_order)
            return None
