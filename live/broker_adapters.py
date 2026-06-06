"""Broker adapter boundary for generic plugin-runner paper execution."""

from __future__ import annotations

import json
from dataclasses import asdict, is_dataclass
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Protocol

from core import Fill, Order, OrderStatus, Side
from live.ibkr_broker import IBKRBroker


BROKER_ADAPTER_CAPABILITIES: dict[str, dict[str, Any]] = {
    "ibkr": {
        "id": "ibkr",
        "label": "IBKR",
        "status": "paper_supported",
        "visibility": "public_adapter",
        "description": "IBKR paper execution through TWS or Gateway using the local API session.",
        "account_modes": ["paper"],
        "order_types": ["market"],
        "order_sizing": ["quantity", "cash_quantity"],
        "supports_cash_balance": True,
        "supports_positions": True,
        "supports_fractional_quantity": True,
        "supports_short_orders": True,
        "requires_gateway": True,
        "requires_static_prices": False,
        "persists_local_state": False,
        "known_paper_ports": [4002, 7497],
        "known_live_ports": [4001, 7496],
        "boundary": "Requires a local authenticated IBKR paper session. Known live ports are blocked by the runner unless both config and CLI explicitly opt in.",
    },
    "file": {
        "id": "file",
        "label": "File-backed local broker",
        "status": "plumbing_test",
        "visibility": "public_adapter",
        "description": "Local file-backed adapter for testing broker plumbing with configured static prices.",
        "account_modes": ["paper"],
        "order_types": ["market"],
        "order_sizing": ["quantity", "cash_quantity"],
        "supports_cash_balance": True,
        "supports_positions": True,
        "supports_fractional_quantity": True,
        "supports_short_orders": False,
        "requires_gateway": False,
        "requires_static_prices": True,
        "persists_local_state": True,
        "known_paper_ports": [],
        "known_live_ports": [],
        "boundary": "Fills at configured static prices and persists local state. It is not a market simulator and is not evidence that a strategy works.",
    },
}


class BrokerAdapter(Protocol):
    last_order_status: str
    last_order_message: str

    def connect(self) -> None:
        """Connect or initialize the broker adapter."""

    def disconnect(self) -> None:
        """Disconnect or flush adapter state."""

    def get_cash(self) -> float:
        """Return currently available cash."""

    def get_positions(self) -> dict[str, float]:
        """Return current positions as symbol -> quantity."""

    def get_account_ids(self) -> list[str]:
        """Return public broker account identifiers visible to this adapter."""

    def submit_order(self, order: Order) -> Fill | None:
        """Submit an order and return a fill if one occurred."""


def broker_adapter_ids() -> set[str]:
    return set(BROKER_ADAPTER_CAPABILITIES)


def broker_adapter_capability(adapter: str) -> dict[str, Any]:
    normalized = adapter.lower().replace("-", "_")
    if normalized not in BROKER_ADAPTER_CAPABILITIES:
        raise ValueError(f"Unsupported broker.adapter {adapter!r}; use {', '.join(sorted(BROKER_ADAPTER_CAPABILITIES))}")
    return dict(BROKER_ADAPTER_CAPABILITIES[normalized])


def broker_adapter_capabilities() -> list[dict[str, Any]]:
    return [broker_adapter_capability(adapter) for adapter in sorted(BROKER_ADAPTER_CAPABILITIES)]


def jsonable(value: Any) -> Any:
    if isinstance(value, datetime):
        return value.isoformat()
    if isinstance(value, Path):
        return str(value)
    if is_dataclass(value):
        return jsonable(asdict(value))
    if isinstance(value, dict):
        return {str(k): jsonable(v) for k, v in value.items()}
    if isinstance(value, (list, tuple)):
        return [jsonable(v) for v in value]
    return value


def read_json(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open() as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def write_json(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        json.dump(jsonable(record), f, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def append_jsonl(path: Path, record: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a") as f:
        f.write(json.dumps(jsonable(record), sort_keys=True) + "\n")


class IBKRBrokerAdapter:
    """Broker adapter backed by the existing IBKR broker wrapper."""

    def __init__(self, config: dict[str, Any]):
        self.broker = IBKRBroker(
            host=str(config.get("host", "127.0.0.1")),
            port=int(config.get("port", 4002)),
            client_id=int(config.get("client_id", 301)),
        )

    @property
    def last_order_status(self) -> str:
        return self.broker.last_order_status

    @property
    def last_order_message(self) -> str:
        return self.broker.last_order_message

    def connect(self) -> None:
        self.broker.connect()

    def disconnect(self) -> None:
        self.broker.disconnect()

    def get_cash(self) -> float:
        return self.broker.get_cash()

    def get_positions(self) -> dict[str, float]:
        return self.broker.get_positions()

    def get_account_ids(self) -> list[str]:
        return self.broker.managed_accounts()

    def submit_order(self, order: Order) -> Fill | None:
        return self.broker.submit_order(order)


class FileBrokerAdapter:
    """File-backed paper broker adapter for local public harness tests.

    This adapter fills market orders at configured static prices and persists a
    small cash/position state file. It is deliberately simple and should not be
    treated as a market simulator.
    """

    def __init__(self, config: dict[str, Any]):
        self.state_path = Path(str(config.get("state_path", "paper_logs/file_broker_state.json")))
        self.orders_path = Path(str(config.get("orders_path", self.state_path.with_suffix(".orders.jsonl"))))
        self.prices = {str(k).upper(): float(v) for k, v in (config.get("prices") or {}).items()}
        self.starting_cash = float(config.get("starting_cash", 10000.0))
        self.commission_bps = float(config.get("commission_bps", 0.0))
        self.allow_short = bool(config.get("allow_short", False))
        self.account_id = str(config.get("account_id", "file-paper"))
        self.last_order_status = ""
        self.last_order_message = ""
        self.state: dict[str, Any] = {}

    def connect(self) -> None:
        state = read_json(self.state_path)
        if not state:
            state = {
                "cash": self.starting_cash,
                "positions": {},
                "prices": self.prices,
                "account_id": self.account_id,
                "updated_at": datetime.now(timezone.utc),
            }
            write_json(self.state_path, state)
        state_prices = state.get("prices") if isinstance(state.get("prices"), dict) else {}
        state["prices"] = {**{str(k).upper(): float(v) for k, v in state_prices.items()}, **self.prices}
        state.setdefault("account_id", self.account_id)
        self.state = state

    def disconnect(self) -> None:
        if self.state:
            self.state["updated_at"] = datetime.now(timezone.utc)
            write_json(self.state_path, self.state)

    def get_cash(self) -> float:
        if not self.state:
            self.connect()
        return float(self.state.get("cash", 0.0))

    def get_positions(self) -> dict[str, float]:
        if not self.state:
            self.connect()
        raw = self.state.get("positions") if isinstance(self.state.get("positions"), dict) else {}
        return {str(symbol).upper(): float(qty) for symbol, qty in raw.items() if abs(float(qty)) > 1e-9}

    def get_account_ids(self) -> list[str]:
        if not self.state:
            self.connect()
        account_id = str(self.state.get("account_id") or self.account_id).strip()
        return [account_id] if account_id else []

    def price_for(self, symbol: str) -> float | None:
        prices = self.state.get("prices") if isinstance(self.state.get("prices"), dict) else {}
        raw = prices.get(symbol.upper())
        return float(raw) if raw is not None else None

    def submit_order(self, order: Order) -> Fill | None:
        self.last_order_status = ""
        self.last_order_message = ""
        if not self.state:
            self.connect()

        symbol = order.symbol.upper()
        price = self.price_for(symbol)
        if price is None or price <= 0:
            self.last_order_status = "REJECTED"
            self.last_order_message = f"file broker has no price for {symbol}"
            order.status = OrderStatus.REJECTED
            return None

        quantity = float(order.quantity or 0.0)
        if order.side == Side.BUY and order.cash_quantity is not None:
            quantity = float(order.cash_quantity) / price
        if quantity <= 0:
            self.last_order_status = "REJECTED"
            self.last_order_message = "quantity must be positive"
            order.status = OrderStatus.REJECTED
            return None

        positions = self.get_positions()
        cash = self.get_cash()
        notional = quantity * price
        commission = notional * self.commission_bps / 10000.0
        current_qty = positions.get(symbol, 0.0)

        if order.side == Side.BUY:
            if notional + commission > cash + 1e-9:
                self.last_order_status = "REJECTED"
                self.last_order_message = "file broker insufficient cash"
                order.status = OrderStatus.REJECTED
                return None
            cash -= notional + commission
            positions[symbol] = current_qty + quantity
        else:
            if not self.allow_short and quantity > current_qty + 1e-9:
                self.last_order_status = "REJECTED"
                self.last_order_message = "file broker short sale disabled"
                order.status = OrderStatus.REJECTED
                return None
            cash += notional - commission
            positions[symbol] = current_qty - quantity
            if abs(positions[symbol]) <= 1e-9:
                positions.pop(symbol, None)

        self.state["cash"] = cash
        self.state["positions"] = positions
        self.state["updated_at"] = datetime.now(timezone.utc)
        write_json(self.state_path, self.state)

        fill = Fill(
            symbol=symbol,
            side=order.side,
            quantity=quantity,
            price=price,
            commission=commission,
            timestamp=datetime.now(timezone.utc),
            tag=order.tag,
        )
        order.status = OrderStatus.FILLED
        self.last_order_status = "Filled"
        append_jsonl(self.orders_path, {
            "timestamp": fill.timestamp,
            "symbol": fill.symbol,
            "side": fill.side.name.lower(),
            "quantity": fill.quantity,
            "price": fill.price,
            "commission": fill.commission,
            "tag": fill.tag,
            "status": "filled",
        })
        return fill


def create_broker_adapter(config: dict[str, Any]) -> BrokerAdapter:
    adapter = str(config.get("adapter", config.get("provider", "ibkr"))).lower().replace("-", "_")
    if adapter not in BROKER_ADAPTER_CAPABILITIES:
        raise ValueError(f"Unsupported broker.adapter {adapter!r}; use {', '.join(sorted(BROKER_ADAPTER_CAPABILITIES))}")
    if adapter == "ibkr":
        return IBKRBrokerAdapter(config)
    if adapter == "file":
        return FileBrokerAdapter(config)
    raise ValueError(f"Unsupported broker.adapter {adapter!r}; use {', '.join(sorted(BROKER_ADAPTER_CAPABILITIES))}")
