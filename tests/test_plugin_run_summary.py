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
            },
            sort_keys=True,
        )
    )
    write_jsonl(
        run_dir / "decisions.jsonl",
        [
            {"timestamp": "2026-01-02T14:30:00+00:00", "intents": []},
            {"timestamp": "2026-01-02T14:35:00+00:00", "intents": []},
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
    assert metrics["artifact_files"]["account"] is True
    assert "Fills: 1" in format_text(metrics)
    assert "Return: 0.2%" in format_text(metrics)
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
                "diagnostics": {"symbols": ["QQQ"], "paused": True},
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
        }
    ]
    assert "signal" not in recent["decisions"][0]
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
    assert metrics["artifact_files"]["fills"] is False
    assert metrics["artifact_files"]["account"] is False
