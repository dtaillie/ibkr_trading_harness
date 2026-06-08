from __future__ import annotations

import csv
import json
from pathlib import Path

from scripts.build_runtime_status_bridge import build_crypto_run, build_stock_run, build_supervisor_status
from scripts.summarize_plugin_run import summarize_run


def write_json(path: Path, payload: dict) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(payload, sort_keys=True))


def write_csv(path: Path, rows: list[dict[str, object]]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("w", newline="") as f:
        writer = csv.DictWriter(f, fieldnames=list(rows[0].keys()))
        writer.writeheader()
        writer.writerows(rows)


def read_jsonl(path: Path) -> list[dict]:
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def test_runtime_bridge_builds_crypto_generic_artifacts(tmp_path):
    sessions = tmp_path / "crypto_sessions"
    session = sessions / "2026-01-02_150500_UTC"
    write_csv(
        session / "signal.csv",
        [
            {
                "run_started_at": "2026-01-02T15:05:00+00:00",
                "decision_hour": "2026-01-02T15:00:00+00:00",
                "target_symbol": "DOGE-USD",
                "signal": "-0.02",
                "raw_return": "-0.03",
                "market_return": "-0.01",
                "reason": "selected",
                "action_reason": "selected",
                "submit_orders": "False",
                "simulate_fills": "True",
                "cash": "35000",
                "estimated_equity": "35100",
                "latest_data_time": "2026-01-02T15:00:00+00:00",
                "max_data_age_minutes": "90",
                "order_circuit_open": "False",
                "order_circuit_reason": "",
                "target_symbols": "DOGE-USD,SOL-USD",
                "position_exit_reason": "",
                "config_version": "private_config_version",
                "strategy_hold_h": "10",
                "strategy_trailing_stop_pct": "0.025",
                "strategy_min_abs_signal": "0.005",
            }
        ],
    )
    write_csv(
        session / "orders.csv",
        [
            {
                "timestamp": "2026-01-02T15:05:01+00:00",
                "decision_hour": "2026-01-02T15:00:00+00:00",
                "symbol": "DOGE-USD",
                "side": "buy",
                "quantity": "100",
                "cash_quantity": "10",
                "tag": "crypto_private_entry_simulated",
                "submitted": "True",
                "simulated": "True",
                "sim_status": "filled",
            }
        ],
    )
    write_csv(
        session / "fills.csv",
        [
            {
                "timestamp": "2026-01-02T15:05:01+00:00",
                "symbol": "DOGE-USD",
                "side": "buy",
                "quantity": "100",
                "price": "0.1",
                "commission": "0.01",
                "tag": "crypto_private_entry_simulated",
            }
        ],
    )
    write_json(
        tmp_path / "crypto_state.json",
        {
            "last_run_at": "2026-01-02T15:06:00+00:00",
            "last_decision_hour": "2026-01-02T15:00:00+00:00",
            "last_mode": "simulate_fills",
            "last_signal": {"reason": "selected", "signal": -0.02, "symbol": "DOGE-USD"},
            "sim_cash": 34990,
            "sim_equity": 35100,
            "sim_positions": {"DOGE-USD": 100},
        },
    )

    out = tmp_path / "runtime" / "crypto"
    result = build_crypto_run(tmp_path / "crypto_state.json", sessions, out, max_sessions=10)

    metrics = summarize_run(out)
    orders = read_jsonl(out / "orders.jsonl")
    fills = read_jsonl(out / "fills.jsonl")
    assert result["decisions"] == 2
    assert metrics["status"] if "status" in metrics else True
    assert metrics["orders"] == 1
    assert metrics["fills"] == 1
    assert metrics["final_equity"] == 35100
    assert orders[0]["tag"] == "entry"
    assert fills[0]["tag"] == "entry"
    assert "private" not in json.dumps(orders)
    assert "private" not in json.dumps(fills)


def test_runtime_bridge_builds_stock_and_supervisor_status(tmp_path):
    sessions = tmp_path / "stock_sessions"
    session = sessions / "2026-01-02_session"
    write_json(
        session / "manifest.json",
        {
            "run_started_at": "2026-01-02T07:25:00",
            "run_finished_at": "2026-01-02T08:50:00",
        },
    )
    write_json(
        session / "account_snapshot.json",
        {
            "raw": [
                {"currency": "USD", "tag": "TotalCashValue", "value": "34900"},
                {"currency": "USD", "tag": "NetLiquidation", "value": "35050"},
                {"currency": "USD", "tag": "GrossPositionValue", "value": "0"},
            ]
        },
    )
    write_csv(
        session / "shadow_signals.csv",
        [
            {
                "date": "2026-01-02",
                "symbol": "LULU",
                "accepted": "1",
                "reject_reason": "",
                "side": "long",
            }
        ],
    )
    write_csv(
        session / "today_bars.csv",
        [
            {
                "symbol": "SPY",
                "timestamp": "2026-01-02T09:30:00-05:00",
                "bar_size": "1min",
                "open": "100",
                "high": "101",
                "low": "99",
                "close": "100",
                "volume": "1",
            }
        ],
    )
    write_csv(session / "subscriptions.csv", [{"symbol": "LULU", "role": "stock"}])

    out = tmp_path / "runtime" / "stock"
    result = build_stock_run(sessions, out, max_sessions=10)
    metrics = summarize_run(out)
    assert result["decisions"] == 1
    assert metrics["final_equity"] == 35050
    assert metrics["latest_signal_reason"] == "accepted"

    state = tmp_path / "supervisor_state.json"
    status = tmp_path / "runtime" / "supervisor" / "status.json"
    write_json(state, {"last_stock_started_at": "2026-01-02T07:25:00"})
    result = build_supervisor_status(state, status)
    payload = json.loads(status.read_text())
    assert result["jobs"] == 1
    assert payload["status"] == "ok"
    assert payload["jobs"][0]["id"] == "last_stock_started_at"
