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
            },
            {
                "timestamp": "2026-01-02T15:10:01+00:00",
                "decision_hour": "2026-01-02T15:00:00+00:00",
                "symbol": "DOGE-USD",
                "side": "sell",
                "quantity": "40",
                "cash_quantity": "",
                "tag": "crypto_private_exit_trailing_stop",
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
            },
            {
                "timestamp": "2026-01-02T15:10:01+00:00",
                "symbol": "DOGE-USD",
                "side": "sell",
                "quantity": "40",
                "price": "0.11",
                "commission": "0.02",
                "tag": "crypto_private_exit_trailing_stop",
            }
        ],
    )
    write_json(
        session / "data_health.json",
        {
            "schema_version": 1,
            "status": "bad",
            "reason": "historical_timeouts_no_live_prices",
            "requested_symbol_count": 2,
            "symbols_with_bars_count": 0,
            "symbols_without_bars_count": 2,
            "symbols_with_live_prices_count": 0,
            "historical_fetch": {
                "timeout_like_count": 2,
                "status_counts": {"no_bars": 2},
            },
        },
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
            "sim_last_prices": {"DOGE-USD": 0.12},
            "sim_positions": {"DOGE-USD": 60},
        },
    )

    out = tmp_path / "runtime" / "crypto"
    result = build_crypto_run(tmp_path / "crypto_state.json", sessions, out, max_sessions=10)

    metrics = summarize_run(out)
    rollups = json.loads((out / "performance_rollups.json").read_text())
    orders = read_jsonl(out / "orders.jsonl")
    fills = read_jsonl(out / "fills.jsonl")
    order_previews = read_jsonl(out / "order_previews.jsonl")
    assert result["decisions"] == 2
    assert metrics["status"] if "status" in metrics else True
    account = read_jsonl(out / "account.jsonl")
    assert metrics["orders"] == 2
    assert metrics["fills"] == 2
    assert metrics["final_equity"] == 35100
    assert metrics["market_data_status"] == "bad"
    assert metrics["market_data_reason"] == "historical_timeouts_no_live_prices"
    assert metrics["market_data_health"]["historical_fetch"]["timeout_like_count"] == 2
    assert metrics["artifact_files"]["performance_rollups"] is True
    assert metrics["artifact_files"]["order_previews"] is True
    assert order_previews == []
    assert rollups["source"] == "legacy_runtime_status_bridge"
    assert rollups["bridge_kind"] == "legacy_crypto_csv_sessions"
    assert rollups["rollups"][0]["day"] == "2026-01-02"
    assert rollups["rollups"][0]["order_count"] == 2
    assert rollups["rollups"][0]["fill_count"] == 2
    assert rollups["period_rollups"]["month"][0]["label"] == "2026-01"
    assert orders[0]["tag"] == "entry"
    assert orders[1]["tag"] == "exit"
    assert fills[0]["tag"] == "entry"
    assert fills[1]["tag"] == "exit"
    assert abs(metrics["realized_pnl"] - 0.4) < 1e-9
    assert abs(metrics["unrealized_pnl"] - 1.2) < 1e-9
    assert abs(metrics["total_pnl"] - 1.6) < 1e-9
    assert abs(metrics["total_commission"] - 0.03) < 1e-9
    assert account[-1]["positions"] == {"DOGE-USD": 60}
    assert abs(account[-1]["average_costs"]["DOGE-USD"] - 0.1) < 1e-9
    assert abs(account[-1]["gross_exposure"] - 7.2) < 1e-9
    assert account[-1]["position_details"]["DOGE-USD"]["active_exit_rule"] == "trailing_stop"
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

    write_csv(
        tmp_path / "paper_orders.csv",
        [
            {
                "timestamp": "2026-01-02T08:50:01",
                "date": "2026-01-02",
                "symbol": "LULU",
                "side": "long",
                "entry_action": "BUY",
                "quantity": "10",
                "intended_entry": "100",
                "stop": "95",
                "target": "115",
                "order_ref": "EXAMPLE_2026-01-02_LULU",
                "entry_status": "Filled",
                "entry_order_id": "1",
                "entry_message": "Fill 10@100",
                "filled_qty": "10",
                "avg_fill_price": "100",
                "entry_order_style": "market",
                "entry_order_type": "MKT",
                "entry_limit_price": "",
                "entry_algo_strategy": "",
                "entry_algo_params": "",
                "target_order_id": "2",
                "stop_order_id": "3",
                "oca_group": "EXAMPLE_exit",
            }
        ],
    )
    write_csv(
        tmp_path / "paper_fills.csv",
        [
            {
                "timestamp": "2026-01-02T08:50:01",
                "date": "2026-01-02",
                "symbol": "LULU",
                "side": "long",
                "entry_action": "BUY",
                "quantity": "10",
                "avg_price": "100",
                "commission": "1.25",
                "order_ref": "EXAMPLE_2026-01-02_LULU",
            }
        ],
    )
    write_csv(
        tmp_path / "paper_eod_flatten.csv",
        [
            {
                "timestamp": "2026-01-02T13:55:00",
                "symbol": "LULU",
                "action": "SELL",
                "quantity": "10",
                "status": "Filled",
                "avg_price": "103",
                "message": "Fill 10@103",
                "order_ref": "EXAMPLE_2026-01-02_eod_flat",
            }
        ],
    )

    out = tmp_path / "runtime" / "stock"
    result = build_stock_run(
        sessions,
        out,
        order_log=tmp_path / "paper_orders.csv",
        fill_log=tmp_path / "paper_fills.csv",
        eod_flatten_log=tmp_path / "paper_eod_flatten.csv",
        max_sessions=10,
    )
    metrics = summarize_run(out)
    rollups = json.loads((out / "performance_rollups.json").read_text())
    order_previews = read_jsonl(out / "order_previews.jsonl")
    assert result["decisions"] == 1
    assert result["orders"] == 2
    assert result["fills"] == 2
    assert metrics["mode"] == "paper"
    assert metrics["final_equity"] == 35050
    assert metrics["latest_signal_reason"] == "accepted"
    assert metrics["order_status_counts"] == {"filled": 2}
    assert metrics["fill_sides"] == {"buy": 1, "sell": 1}
    assert metrics["realized_pnl"] == 30.0
    assert metrics["total_commission"] == 1.25
    assert metrics["artifact_files"]["performance_rollups"] is True
    assert metrics["artifact_files"]["order_previews"] is True
    assert order_previews == []
    assert rollups["source"] == "legacy_runtime_status_bridge"
    assert rollups["bridge_kind"] == "legacy_stock_csv_sessions"
    assert rollups["rollups"][0]["day"] == "2026-01-02"
    assert rollups["rollups"][0]["order_count"] == 2
    assert rollups["rollups"][0]["fill_count"] == 2
    assert rollups["rollups"][0]["max_gross_exposure"] == 1000.0
    assert rollups["period_rollups"]["year"][0]["label"] == "2026"

    state = tmp_path / "supervisor_state.json"
    status = tmp_path / "runtime" / "supervisor" / "status.json"
    write_json(state, {"last_stock_started_at": "2026-01-02T07:25:00"})
    result = build_supervisor_status(state, status)
    payload = json.loads(status.read_text())
    assert result["jobs"] == 1
    assert payload["status"] == "ok"
    assert payload["jobs"][0]["id"] == "last_stock_started_at"

    write_json(
        state,
        {
            "schema_version": 2,
            "status": "warn",
            "generated_at": "2026-01-03T16:00:00",
            "active_children": [{"id": "crypto", "status": "running", "pid": 123}],
            "job_status_counts": {"missed": 1, "running": 1},
            "jobs": [
                {
                    "id": "stock_paper",
                    "status": "missed",
                    "reason": "missed_start_window",
                    "missed_window": True,
                    "next_start_at": "2026-01-04T07:25:00",
                }
            ],
        },
    )
    result = build_supervisor_status(state, status)
    payload = json.loads(status.read_text())
    assert result["jobs"] == 1
    assert payload["status"] == "warn"
    assert payload["generated_at"] == "2026-01-03T16:00:00"
    assert payload["active_children"][0]["id"] == "crypto"
    assert payload["job_status_counts"] == {"missed": 1, "running": 1}
    assert payload["jobs"][0]["reason"] == "missed_start_window"


def test_runtime_bridge_prefers_authoritative_state_positions_when_fills_disagree(tmp_path):
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
                "estimated_equity": "35000",
                "latest_data_time": "2026-01-02T15:00:00+00:00",
                "max_data_age_minutes": "90",
                "order_circuit_open": "False",
                "order_circuit_reason": "",
                "target_symbols": "DOGE-USD",
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
            "sim_cash": 34900,
            "sim_equity": 34900,
            "sim_last_prices": {"DOGE-USD": 0.2},
            "sim_positions": {},
        },
    )

    out = tmp_path / "runtime" / "crypto"
    build_crypto_run(tmp_path / "crypto_state.json", sessions, out, max_sessions=10)
    metrics = summarize_run(out)
    account = read_jsonl(out / "account.jsonl")

    assert metrics["final_positions"] == {}
    assert metrics["realized_pnl"] == -100.0
    assert metrics["unrealized_pnl"] == 0.0
    assert metrics["max_gross_exposure"] == 0.0
    assert account[-1]["accounting_source"] == "state_equity"
    assert account[-1]["position_details"] == {}
