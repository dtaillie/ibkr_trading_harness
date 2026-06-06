from __future__ import annotations

import json

from core import Order, Side
from live.broker_adapters import FileBrokerAdapter, broker_adapter_capabilities, broker_adapter_capability, broker_adapter_ids, create_broker_adapter


def test_broker_adapter_capabilities_are_public_safe_and_actionable():
    ids = broker_adapter_ids()
    capabilities = {item["id"]: item for item in broker_adapter_capabilities()}

    assert ids == {"ibkr", "file"}
    assert set(capabilities) == ids
    assert broker_adapter_capability("ibkr")["known_live_ports"] == [4001, 7496]
    assert capabilities["ibkr"]["requires_gateway"] is True
    assert capabilities["ibkr"]["order_types"] == ["market"]
    assert capabilities["file"]["requires_static_prices"] is True
    assert capabilities["file"]["persists_local_state"] is True
    assert "not a market simulator" in capabilities["file"]["boundary"]


def test_create_file_broker_adapter_executes_and_persists_fill(tmp_path):
    state_path = tmp_path / "broker_state.json"
    orders_path = tmp_path / "orders.jsonl"
    broker = create_broker_adapter({
        "adapter": "file",
        "state_path": str(state_path),
        "orders_path": str(orders_path),
        "starting_cash": 1000,
        "prices": {"SPY": 100},
        "commission_bps": 10,
        "account_id": "paper-test",
    })

    broker.connect()
    fill = broker.submit_order(Order("SPY", Side.BUY, 2, tag="adapter_test"))
    broker.disconnect()

    assert isinstance(broker, FileBrokerAdapter)
    assert fill is not None
    assert fill.symbol == "SPY"
    assert fill.price == 100
    assert fill.commission == 0.2
    assert broker.get_cash() == 799.8
    assert broker.get_positions() == {"SPY": 2.0}
    assert broker.get_account_ids() == ["paper-test"]

    state = json.loads(state_path.read_text())
    assert state["account_id"] == "paper-test"
    assert state["cash"] == 799.8
    assert state["positions"] == {"SPY": 2.0}
    order_rows = [json.loads(line) for line in orders_path.read_text().splitlines()]
    assert order_rows[0]["status"] == "filled"
    assert order_rows[0]["tag"] == "adapter_test"


def test_file_broker_adapter_rejects_missing_price(tmp_path):
    broker = create_broker_adapter({
        "adapter": "file",
        "state_path": str(tmp_path / "broker_state.json"),
        "prices": {"QQQ": 100},
    })

    broker.connect()
    fill = broker.submit_order(Order("SPY", Side.BUY, 1))

    assert fill is None
    assert broker.last_order_status == "REJECTED"
    assert "no price" in broker.last_order_message
