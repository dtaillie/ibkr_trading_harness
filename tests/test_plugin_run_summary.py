from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

from scripts.summarize_plugin_run import format_text, summarize_recent_run_events, summarize_run


def write_jsonl(path: Path, rows: list[dict]) -> None:
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))


def test_summarize_plugin_run_metrics(tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "summary.json").write_text(
        json.dumps(
            {
                "mode": "simulated_paper",
                "decisions": 2,
                "orders": 2,
                "fills": 1,
                "rejections": 1,
                "final_cash": 9000.0,
                "final_equity": 10020.0,
                "final_positions": {"SPY": 10.0},
                "latest_data_time": "2026-01-02T14:35:00+00:00",
                "loop_enabled": True,
                "loop_iterations": 2,
            },
            sort_keys=True,
        )
    )
    write_jsonl(
        run_dir / "decisions.jsonl",
        [
            {"timestamp": "2026-01-02T14:30:00+00:00", "intents": []},
            {
                "timestamp": "2026-01-02T14:35:00+00:00",
                "intents": [],
                "diagnostics": {
                    "dashboard": {
                        "reason": "example_only_no_signal",
                        "signal_label": "Example score",
                        "signal_value": 0.0,
                        "threshold": 1.0,
                        "threshold_distance": -1.0,
                        "private_ignored": "secret",
                    }
                },
            },
        ],
    )
    write_jsonl(
        run_dir / "orders.jsonl",
        [
            {"timestamp": "2026-01-02T14:30:00+00:00", "status": "pending", "symbol": "SPY"},
            {"timestamp": "2026-01-02T14:35:00+00:00", "status": "rejected", "symbol": "SPY", "reason": "max_orders_per_run 1 reached"},
        ],
    )
    write_jsonl(
        run_dir / "fills.jsonl",
        [
            {
                "timestamp": "2026-01-02T14:30:00+00:00",
                "symbol": "SPY",
                "side": "buy",
                "quantity": 10,
                "price": 100,
                "commission": 1.25,
            },
        ],
    )
    write_jsonl(
        run_dir / "account.jsonl",
        [
            {
                "timestamp": "2026-01-02T14:30:00+00:00",
                "cash": 9000.0,
                "equity": 10000.0,
                "positions": {"SPY": 10.0},
                "gross_exposure": 1000.0,
                "net_exposure": 1000.0,
            },
            {
                "timestamp": "2026-01-02T14:35:00+00:00",
                "cash": 9000.0,
                "equity": 10020.0,
                "positions": {"SPY": 10.0},
                "gross_exposure": 1020.0,
                "net_exposure": 1020.0,
            },
        ],
    )
    (run_dir / "plugin_contract.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "plugin": {
                    "spec": "tests.fixtures.no_edge_template:create_strategy",
                    "name": "no_edge_template",
                    "validator_count": 0,
                },
                "data": {"symbols": ["SPY"], "file_count": 1},
                "observed": {
                    "dashboard_keys": ["reason", "signal_value"],
                    "intent_metadata_keys": ["cost_model"],
                },
            },
            sort_keys=True,
        )
    )
    (run_dir / "runner_status.json").write_text(
        json.dumps(
            {
                "state": "sleeping",
                "next_check_time": "2026-01-02T14:36:00+00:00",
                "next_expected_decision_time": "2026-01-02T14:36:00+00:00",
                "next_check_reason": "sleeping_until_next_loop",
            },
            sort_keys=True,
        )
    )

    metrics = summarize_run(run_dir)

    assert metrics["decisions"] == 2
    assert metrics["order_status_counts"] == {"pending": 1, "rejected": 1}
    assert metrics["rejection_reasons"] == {"max_orders_per_run 1 reached": 1}
    assert metrics["filled_notional"] == 1000.0
    assert metrics["fill_commission"] == 1.25
    assert metrics["unrealized_pnl_estimate"] == 1020.0
    assert metrics["account_snapshot_count"] == 2
    assert metrics["initial_equity"] == 10000.0
    assert abs(metrics["total_return_pct"] - 0.2) < 1e-9
    assert metrics["max_drawdown_pct"] == 0.0
    assert metrics["elapsed_seconds"] == 300.0
    assert metrics["elapsed_days"] == 300.0 / 86400.0
    assert metrics["return_per_day_pct"] is not None
    assert metrics["return_per_month_pct"] is not None
    assert metrics["return_per_year_pct"] is not None
    assert metrics["short_horizon_projection"] is True
    assert metrics["max_gross_exposure"] == 1020.0
    assert metrics["max_gross_exposure_pct"] == 10.2
    assert metrics["max_abs_net_exposure"] == 1020.0
    assert metrics["max_abs_net_exposure_pct"] == 10.2
    assert metrics["max_position_count"] == 1
    assert metrics["latest_data_time"] == "2026-01-02T14:35:00+00:00"
    assert metrics["latest_bar_time"] == "2026-01-02T14:35:00+00:00"
    assert metrics["next_check_time"] == "2026-01-02T14:36:00+00:00"
    assert metrics["next_expected_decision_time"] == "2026-01-02T14:36:00+00:00"
    assert metrics["next_check_reason"] == "sleeping_until_next_loop"
    assert metrics["latest_signal_context"] == {
        "reason": "example_only_no_signal",
        "signal_label": "Example score",
        "signal_value": 0.0,
        "threshold": 1.0,
        "threshold_distance": -1.0,
    }
    assert metrics["latest_signal_reason"] == "example_only_no_signal"
    assert metrics["latest_signal_label"] == "Example score"
    assert metrics["latest_signal_value"] == 0.0
    assert metrics["next_order_condition"] == "Example score threshold distance -1"
    assert metrics["latest_rejection_time"] == "2026-01-02T14:35:00+00:00"
    assert metrics["latest_rejection_symbol"] == "SPY"
    assert metrics["latest_rejection_status"] == "rejected"
    assert metrics["latest_rejection_reason"] == "max_orders_per_run 1 reached"
    assert metrics["loop_enabled"] is True
    assert metrics["loop_iterations"] == 2
    assert metrics["plugin_contract_available"] is True
    assert metrics["plugin_name"] == "no_edge_template"
    assert metrics["data_symbols"] == ["SPY"]
    assert metrics["observed_dashboard_keys"] == ["reason", "signal_value"]
    assert metrics["observed_intent_metadata_keys"] == ["cost_model"]
    assert metrics["artifact_files"]["account"] is True
    assert metrics["artifact_files"]["plugin_contract"] is True
    assert metrics["artifact_files"]["performance_rollups"] is False
    assert "Fills: 1" in format_text(metrics)
    assert "Loop: enabled iterations=2" in format_text(metrics)
    assert "Next check: 2026-01-02T14:36:00+00:00 reason=sleeping_until_next_loop" in format_text(metrics)
    assert "Next order condition: Example score threshold distance -1" in format_text(metrics)
    assert "Return: 0.2%" in format_text(metrics)
    assert "Plugin contract: available plugin=no_edge_template" in format_text(metrics)
    assert "Return/day:" in format_text(metrics)
    assert "Max gross exposure:" in format_text(metrics)


def test_summarize_recent_run_events_omits_raw_signal_payload(tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    write_jsonl(
        run_dir / "decisions.jsonl",
        [
            {
                "timestamp": "2026-01-02T14:30:00+00:00",
                "step": 1,
                "mode": "replay",
                "signal": {"private_score": 123.0},
                "diagnostics": {"symbols": ["SPY"], "paused": False},
                "intents": [{"symbol": "SPY"}],
            },
            {
                "timestamp": "2026-01-02T14:35:00+00:00",
                "step": 2,
                "mode": "replay",
                "signal": {"private_score": 456.0},
                "diagnostics": {
                    "symbols": ["QQQ"],
                    "paused": True,
                    "private_detail": "hidden",
                    "dashboard": {
                        "signal_label": "Public score",
                        "signal_value": 0.5,
                        "threshold": 1.0,
                        "unsafe_private_blob": "hidden",
                    },
                },
                "intents": [],
            },
        ],
    )
    write_jsonl(
        run_dir / "orders.jsonl",
        [
            {"timestamp": "2026-01-02T14:35:00+00:00", "status": "rejected", "symbol": "QQQ", "side": "buy", "reason": "guard"},
        ],
    )
    write_jsonl(
        run_dir / "fills.jsonl",
        [
            {"timestamp": "2026-01-02T14:35:00+00:00", "symbol": "QQQ", "side": "buy", "quantity": 1, "price": 100.0},
        ],
    )

    recent = summarize_recent_run_events(run_dir, max_rows=1)

    assert recent["max_rows"] == 1
    assert recent["decisions"] == [
        {
            "timestamp": "2026-01-02T14:35:00+00:00",
            "step": 2,
            "mode": "replay",
            "intents": 0,
            "paused": True,
            "symbols": ["QQQ"],
            "drilldown": {
                "signal_label": "Public score",
                "signal_value": 0.5,
                "threshold": 1.0,
            },
        }
    ]
    assert "signal" not in recent["decisions"][0]
    assert "diagnostics" not in recent["decisions"][0]
    assert "unsafe_private_blob" not in recent["decisions"][0]["drilldown"]
    assert recent["orders"][0]["reason"] == "guard"
    assert recent["fills"][0]["price"] == 100.0


def test_summarize_plugin_run_cli_json(tmp_path):
    run_dir = tmp_path / "run"
    run_dir.mkdir()
    (run_dir / "summary.json").write_text(json.dumps({"mode": "replay", "decisions": 0}))

    result = subprocess.run(
        [sys.executable, "scripts/summarize_plugin_run.py", str(run_dir), "--json"],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
    )

    metrics = json.loads(result.stdout)
    assert metrics["mode"] == "replay"
    assert metrics["artifact_files"]["summary"] is True
    assert metrics["artifact_files"]["plugin_contract"] is False
    assert metrics["artifact_files"]["performance_rollups"] is False
    assert metrics["artifact_files"]["fills"] is False
    assert metrics["artifact_files"]["account"] is False
