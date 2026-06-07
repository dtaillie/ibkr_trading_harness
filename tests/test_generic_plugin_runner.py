from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path

import pytest
import yaml

from live.plugin_runner import (
    SECONDS_PER_YEAR,
    ConfigValidationError,
    paper_broker_safety_errors,
    run_from_config,
    validate_config_file,
)


ROOT = Path(__file__).resolve().parents[1]


def write_sample_bars(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100,1000",
                "2026-01-02T14:35:00Z,100,102,99,101,1000",
                "2026-01-02T14:40:00Z,101,103,100,102,1000",
            ]
        )
        + "\n"
    )


def write_config(
    path: Path,
    *,
    bars_path: Path,
    output_dir: Path,
    plugin: str,
    strategy: dict | None = None,
    runner: dict | None = None,
    data: dict | None = None,
    execution: dict | None = None,
    control: dict | None = None,
    broker: dict | None = None,
) -> None:
    path.write_text(
        yaml.safe_dump(
            {
                "metadata": {"strategy_plugin": plugin},
                "strategy": strategy or {},
                "runner": {
                    "mode": "replay",
                    "starting_cash": 10000,
                    "history_bars": 10,
                    "output_dir": str(output_dir),
                    **(runner or {}),
                },
                "data": {
                    "source": "files",
                    "timestamp_column": "timestamp",
                    "files": {"SPY": str(bars_path)},
                    **(data or {}),
                },
                "execution": {
                    "allow_short": False,
                    "sim_slippage_bps": 0,
                    "sim_commission_bps": 0,
                    **(execution or {}),
                },
                "control": control or {},
                "broker": broker or {},
            },
            sort_keys=False,
        )
    )


def test_replay_runner_records_no_edge_decisions(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
    )

    result = run_from_config(config_path, mode_override="replay")

    assert result.decisions == 3
    assert result.orders == 0
    assert result.account_snapshot_count == 3
    assert result.initial_equity == pytest.approx(10000.0)
    assert result.total_return_pct == pytest.approx(0.0)
    assert result.max_drawdown_pct == pytest.approx(0.0)
    assert result.elapsed_seconds == pytest.approx(600.0)
    assert result.elapsed_days == pytest.approx(600.0 / 86400.0)
    assert result.latest_data_time == "2026-01-02T14:40:00+00:00"
    assert result.return_per_day_pct == pytest.approx(0.0)
    assert result.return_per_month_pct == pytest.approx(0.0)
    assert result.return_per_year_pct == pytest.approx(0.0)
    assert result.short_horizon_projection is True
    assert result.max_gross_exposure == pytest.approx(0.0)
    assert result.max_gross_exposure_pct == pytest.approx(0.0)
    assert result.max_abs_net_exposure == pytest.approx(0.0)
    assert result.max_abs_net_exposure_pct == pytest.approx(0.0)
    assert result.max_position_count == 0
    records = [json.loads(line) for line in (output_dir / "decisions.jsonl").read_text().splitlines()]
    assert records[-1]["diagnostics"]["symbols_seen"] == ["SPY"]
    account = [json.loads(line) for line in (output_dir / "account.jsonl").read_text().splitlines()]
    assert account[-1]["equity"] == pytest.approx(10000.0)
    summary = json.loads((output_dir / "summary.json").read_text())
    assert summary["latest_data_time"] == "2026-01-02T14:40:00+00:00"
    assert summary["performance_rollups_path"] == str(output_dir / "performance_rollups.json")
    assert summary["runner_status_path"] == str(output_dir / "runner_status.json")
    assert summary["plugin_contract_path"] == str(output_dir / "plugin_contract.json")
    status = json.loads((output_dir / "runner_status.json").read_text())
    assert status["schema_version"] == 1
    assert status["state"] == "completed"
    assert status["mode"] == "replay"
    assert status["latest_data_time"] == "2026-01-02T14:40:00+00:00"
    assert status["last_decision_time"] == "2026-01-02T14:40:00+00:00"
    assert status["counts"] == {
        "account": 3,
        "approval_required_orders": 0,
        "decisions": 3,
        "fills": 0,
        "orders": 0,
        "rejections": 0,
    }
    assert status["loop"]["enabled"] is False
    assert status["result"]["summary_path"] == str(output_dir / "summary.json")
    assert status["result"]["plugin_contract_path"] == str(output_dir / "plugin_contract.json")
    contract = json.loads((output_dir / "plugin_contract.json").read_text())
    assert contract["schema_version"] == 1
    assert contract["source"] == "plugin_runner"
    assert contract["plugin"]["spec"] == "examples.strategies.no_edge_template:create_strategy"
    assert contract["plugin"]["name"] == "no_edge_template"
    assert contract["plugin"]["validator_count"] == 0
    assert contract["data"]["symbols"] == ["SPY"]
    assert contract["data"]["file_count"] == 1
    assert contract["observed"]["dashboard_keys"] == [
        "active_exit_rule",
        "expected_hold_minutes",
        "near_threshold",
        "reason",
        "signal_label",
        "signal_value",
        "threshold",
        "threshold_distance",
    ]
    assert contract["observed"]["decision_count"] == 3
    assert {row["name"] for row in contract["artifacts"]} >= {"summary.json", "plugin_contract.json"}
    rollups = json.loads((output_dir / "performance_rollups.json").read_text())
    assert rollups["schema_version"] == 1
    assert rollups["source"] == "plugin_runner"
    assert rollups["summary"]["account_snapshot_count"] == 3
    assert rollups["rollups"][0]["day"] == "2026-01-02"
    assert rollups["rollups"][0]["snapshot_count"] == 3
    assert rollups["rollups"][0]["start_equity"] == pytest.approx(10000.0)
    assert rollups["rollups"][0]["end_equity"] == pytest.approx(10000.0)
    assert rollups["period_rollups"]["month"][0]["label"] == "2026-01"
    assert rollups["period_rollups"]["year"][0]["label"] == "2026"


def test_replay_runner_filters_file_data_range(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        data={"start": "2026-01-02T14:35:00Z", "end": "2026-01-02T14:35:00Z"},
    )

    result = run_from_config(config_path, mode_override="replay")

    assert result.decisions == 1
    assert result.account_snapshot_count == 1
    assert result.latest_data_time == "2026-01-02T14:35:00+00:00"
    records = [json.loads(line) for line in (output_dir / "decisions.jsonl").read_text().splitlines()]
    assert [record["timestamp"] for record in records] == ["2026-01-02T14:35:00+00:00"]


def test_validate_config_rejects_reversed_data_range(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        data={"start": "2026-01-03", "end": "2026-01-02"},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "data.start must be before or equal to data.end" in str(exc.value)


def test_validate_config_file_does_not_create_output_dir(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
    )

    config = validate_config_file(config_path)

    assert config["metadata"]["strategy_plugin"] == "examples.strategies.no_edge_template:create_strategy"
    assert not output_dir.exists()


def test_simulated_paper_fills_order_intent(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "cash_quantity": 1000},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.decisions == 3
    assert result.orders == 1
    assert result.fills == 1
    assert result.rejections == 0
    assert result.final_positions["SPY"] == pytest.approx(10.0)
    assert result.final_cash == pytest.approx(9000.0)
    assert result.final_equity == pytest.approx(10020.0)
    assert result.account_snapshot_count == 3
    assert result.total_return_pct == pytest.approx(0.2)
    assert result.max_drawdown_pct == pytest.approx(0.0)
    assert result.elapsed_seconds == pytest.approx(600.0)
    assert result.return_per_day_pct is not None
    assert result.return_per_month_pct is not None
    assert result.return_per_year_pct is not None
    assert result.short_horizon_projection is True
    assert result.max_gross_exposure == pytest.approx(1020.0)
    assert result.max_gross_exposure_pct == pytest.approx(10.2)
    assert result.max_abs_net_exposure == pytest.approx(1020.0)
    assert result.max_abs_net_exposure_pct == pytest.approx(10.2)
    assert result.max_position_count == 1
    fills = [json.loads(line) for line in (output_dir / "fills.jsonl").read_text().splitlines()]
    assert fills[0]["tag"] == "fixture_buy_once"
    account = [json.loads(line) for line in (output_dir / "account.jsonl").read_text().splitlines()]
    assert account[0]["cash"] == pytest.approx(9000.0)
    assert account[0]["equity"] == pytest.approx(10000.0)
    assert account[0]["average_costs"]["SPY"] == pytest.approx(100.0)
    assert account[0]["unrealized_pnl"] == pytest.approx(0.0)
    assert account[-1]["unrealized_pnl"] == pytest.approx(20.0)
    assert account[-1]["total_pnl"] == pytest.approx(20.0)
    assert account[-1]["position_values"]["SPY"] == pytest.approx(1020.0)


def test_simulated_paper_account_snapshots_include_public_position_details(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={
            "symbol": "SPY",
            "quantity": 10,
            "cash_quantity": None,
            "position_details": {
                "SPY": {
                    "entry_time": "2026-01-02T14:30:00+00:00",
                    "entry_price": 100.0,
                    "expected_hold_minutes": 30,
                    "active_exit_rule": "fixture_exit",
                    "private_signal": "hidden",
                    "raw_state": {"private": True},
                },
                "QQQ": {"entry_price": 1.0},
            },
        },
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.fills == 1
    account = [json.loads(line) for line in (output_dir / "account.jsonl").read_text().splitlines()]
    first_detail = account[0]["position_details"]["SPY"]
    assert first_detail["entry_time"] == "2026-01-02T14:30:00+00:00"
    assert first_detail["entry_price"] == pytest.approx(100.0)
    assert first_detail["expected_hold_minutes"] == 30
    assert first_detail["active_exit_rule"] == "fixture_exit"
    assert first_detail["current_price"] == pytest.approx(100.0)
    assert "private_signal" not in first_detail
    assert "raw_state" not in first_detail
    assert "QQQ" not in account[0]["position_details"]
    assert account[-1]["position_details"]["SPY"]["current_price"] == pytest.approx(102.0)


def test_simulated_paper_tracks_realized_pnl_and_average_cost(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.round_trip_plugin:create_strategy",
        strategy={"symbol": "SPY", "quantity": 10},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.decisions == 3
    assert result.orders == 2
    assert result.fills == 2
    assert result.final_positions == {}
    assert result.final_cash == pytest.approx(10020.0)
    assert result.final_equity == pytest.approx(10020.0)
    assert result.realized_pnl == pytest.approx(20.0)
    assert result.unrealized_pnl == pytest.approx(0.0)
    assert result.total_pnl == pytest.approx(20.0)
    assert result.total_commission == pytest.approx(0.0)

    fills = [json.loads(line) for line in (output_dir / "fills.jsonl").read_text().splitlines()]
    assert fills[0]["realized_pnl"] == pytest.approx(0.0)
    assert fills[0]["average_cost_after"] == pytest.approx(100.0)
    assert fills[1]["realized_pnl"] == pytest.approx(20.0)
    assert fills[1]["cumulative_realized_pnl"] == pytest.approx(20.0)
    assert fills[1]["average_cost_after"] is None

    account = [json.loads(line) for line in (output_dir / "account.jsonl").read_text().splitlines()]
    assert account[0]["average_costs"]["SPY"] == pytest.approx(100.0)
    assert account[1]["unrealized_pnl_by_symbol"]["SPY"] == pytest.approx(10.0)
    assert account[-1]["positions"] == {}
    assert account[-1]["average_costs"] == {}
    assert account[-1]["realized_pnl"] == pytest.approx(20.0)
    assert account[-1]["unrealized_pnl"] == pytest.approx(0.0)
    assert account[-1]["total_pnl"] == pytest.approx(20.0)

    summary = json.loads((output_dir / "summary.json").read_text())
    assert summary["realized_pnl"] == pytest.approx(20.0)
    assert summary["unrealized_pnl"] == pytest.approx(0.0)
    assert summary["total_pnl"] == pytest.approx(20.0)


def test_simulated_paper_average_cost_includes_opening_commission(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "quantity": 10, "cash_quantity": None},
        execution={"sim_commission_bps": 10},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.total_commission == pytest.approx(1.0)
    assert result.unrealized_pnl == pytest.approx(19.0)
    assert result.total_pnl == pytest.approx(19.0)
    account = [json.loads(line) for line in (output_dir / "account.jsonl").read_text().splitlines()]
    assert account[0]["average_costs"]["SPY"] == pytest.approx(100.1)
    assert account[-1]["unrealized_pnl"] == pytest.approx(19.0)
    assert account[-1]["total_commission"] == pytest.approx(1.0)


def test_simulated_paper_applies_richer_commission_and_slippage_schedule(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "quantity": 10, "cash_quantity": None},
        execution={
            "sim_buy_slippage_bps": 20,
            "sim_sell_slippage_bps": 5,
            "sim_market_impact_bps_per_10k": 2,
            "sim_commission_bps": 5,
            "sim_commission_per_share": 0.10,
            "sim_min_commission": 2.0,
        },
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    fills = [json.loads(line) for line in (output_dir / "fills.jsonl").read_text().splitlines()]
    assert fills[0]["slippage_bps"] == pytest.approx(20.2)
    assert fills[0]["price"] == pytest.approx(100.202)
    assert fills[0]["commission"] == pytest.approx(2.0)
    assert result.final_cash == pytest.approx(10000.0 - (10 * 100.202) - 2.0)
    assert result.total_commission == pytest.approx(2.0)
    account = [json.loads(line) for line in (output_dir / "account.jsonl").read_text().splitlines()]
    assert account[0]["average_costs"]["SPY"] == pytest.approx(100.402)


def test_simulated_paper_applies_intent_metadata_cost_model(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={
            "symbol": "SPY",
            "quantity": 10,
            "cash_quantity": None,
            "metadata": {"venue": "ZEROHASH"},
        },
        execution={
            "sim_slippage_bps": 1,
            "sim_commission_bps": 1,
            "sim_cost_models": {
                "zerohash": {
                    "sim_slippage_bps": 30,
                    "sim_market_impact_bps_per_10k": 5,
                    "sim_commission_bps": 10,
                    "sim_commission_per_share": 0.05,
                    "sim_min_commission": 2.0,
                }
            },
        },
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    fills = [json.loads(line) for line in (output_dir / "fills.jsonl").read_text().splitlines()]
    assert fills[0]["requested_cost_model"] == "zerohash"
    assert fills[0]["cost_model"] == "zerohash"
    assert fills[0]["slippage_bps"] == pytest.approx(30.5)
    assert fills[0]["price"] == pytest.approx(100.305)
    assert fills[0]["commission"] == pytest.approx(2.0)
    assert result.final_cash == pytest.approx(10000.0 - (10 * 100.305) - 2.0)


def test_validate_config_rejects_invalid_sim_cost_model(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        execution={
            "sim_cost_models": {
                "": {"sim_commission_bps": 1},
                "arca": {"sim_commission_bps": -1, "unsupported": 2},
            },
        },
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    message = str(exc.value)
    assert "execution.sim_cost_models contains an empty model name" in message
    assert "execution.sim_cost_models[arca].sim_commission_bps must be >= 0" in message
    assert "execution.sim_cost_models[arca] contains unsupported fields: ['unsupported']" in message


def test_simulated_paper_caps_commission_by_notional_pct(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "quantity": 10, "cash_quantity": None},
        execution={
            "sim_commission_per_share": 10.0,
            "sim_max_commission_pct": 1.0,
        },
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    fills = [json.loads(line) for line in (output_dir / "fills.jsonl").read_text().splitlines()]
    assert fills[0]["commission"] == pytest.approx(10.0)
    assert result.total_commission == pytest.approx(10.0)


def test_simulated_paper_accrues_short_borrow_fees(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    borrow_bps = 10000.0
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "side": "sell", "quantity": 10, "cash_quantity": None},
        execution={
            "allow_short": True,
            "shortable_symbols": ["SPY"],
            "sim_short_borrow_bps_annual_by_symbol": {"SPY": borrow_bps},
        },
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    fee_step_2 = 10 * 101 * (borrow_bps / 10000.0) * (300.0 / SECONDS_PER_YEAR)
    fee_step_3 = 10 * 102 * (borrow_bps / 10000.0) * (300.0 / SECONDS_PER_YEAR)
    total_fee = fee_step_2 + fee_step_3
    assert result.fills == 1
    assert result.final_positions["SPY"] == pytest.approx(-10.0)
    assert result.final_cash == pytest.approx(11000.0 - total_fee)
    assert result.final_equity == pytest.approx(10000.0 - 20.0 - total_fee)
    assert result.unrealized_pnl == pytest.approx(-20.0)
    assert result.total_pnl == pytest.approx(-20.0 - total_fee)
    assert result.total_borrow_fees == pytest.approx(total_fee)

    account = [json.loads(line) for line in (output_dir / "account.jsonl").read_text().splitlines()]
    assert account[0]["borrow_fee_accrued"] == pytest.approx(0.0)
    assert account[1]["borrow_fee_accrued"] == pytest.approx(fee_step_2)
    assert account[1]["borrow_fee_accrued_by_symbol"]["SPY"] == pytest.approx(fee_step_2)
    assert account[-1]["total_borrow_fees"] == pytest.approx(total_fee)
    assert account[-1]["total_pnl"] == pytest.approx(-20.0 - total_fee)

    summary = json.loads((output_dir / "summary.json").read_text())
    assert summary["total_borrow_fees"] == pytest.approx(total_fee)


def test_validate_config_rejects_invalid_short_borrow_fee_schedule(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        execution={"sim_short_borrow_bps_annual_by_symbol": {"SPY": -1}},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "execution.sim_short_borrow_bps_annual_by_symbol[SPY] must be >= 0" in str(exc.value)


def test_runner_holds_order_when_manual_approval_required(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "cash_quantity": 1000},
        execution={"require_order_approval": True},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.orders == 1
    assert result.fills == 0
    assert result.rejections == 0
    assert result.approval_required_orders == 1
    assert result.final_cash == pytest.approx(10000.0)
    assert result.final_positions == {}
    assert not (output_dir / "fills.jsonl").exists()

    orders = [json.loads(line) for line in (output_dir / "orders.jsonl").read_text().splitlines()]
    assert orders[-1]["status"] == "approval_required"
    assert orders[-1]["reason"] == "manual approval required"
    previews = [json.loads(line) for line in (output_dir / "order_previews.jsonl").read_text().splitlines()]
    assert len(previews) == 1
    preview = previews[0]
    assert preview["approval_required"] is True
    assert preview["approval_status"] == "required"
    assert preview["approval_id"]
    assert preview["approval_digest"]
    assert preview["approval_file"].endswith(f"{preview['approval_id']}.approved.json")
    assert preview["cash"] == pytest.approx(10000.0)
    assert preview["cash_quantity"] == pytest.approx(1000.0)
    assert preview["equity"] == pytest.approx(10000.0)
    assert preview["estimated_notional"] == pytest.approx(1000.0)
    assert preview["mode"] == "simulated_paper"
    assert preview["price"] == pytest.approx(100.0)
    assert preview["symbol"] == "SPY"
    assert preview["timestamp"] == "2026-01-02T14:30:00+00:00"
    summary = json.loads((output_dir / "summary.json").read_text())
    assert summary["approval_required_orders"] == 1


def test_runner_executes_order_approved_by_local_approval_file(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    approval_dir = tmp_path / "approvals"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "cash_quantity": 1000},
        execution={"require_order_approval": True, "approval_dir": str(approval_dir)},
    )

    first = run_from_config(config_path, mode_override="simulated-paper")
    assert first.fills == 0

    preview_file = output_dir / "order_previews.jsonl"
    subprocess.run(
        [sys.executable, str(ROOT / "scripts" / "approve_order_preview.py"), str(preview_file)],
        check=True,
        cwd=ROOT,
        capture_output=True,
        text=True,
    )
    preview = json.loads(preview_file.read_text().splitlines()[-1])
    approval_file = approval_dir / f"{preview['approval_id']}.approved.json"
    approval = json.loads(approval_file.read_text())
    assert approval["action"] == "approve"
    assert approval["approval_digest"] == preview["approval_digest"]

    second = run_from_config(config_path, mode_override="simulated-paper")

    assert second.orders == 1
    assert second.fills == 1
    assert second.approval_required_orders == 0
    assert second.final_positions["SPY"] == pytest.approx(10.0)
    previews = [json.loads(line) for line in preview_file.read_text().splitlines()]
    assert previews[-1]["approval_status"] == "approved_file"
    fills = [json.loads(line) for line in (output_dir / "fills.jsonl").read_text().splitlines()]
    assert fills[-1]["symbol"] == "SPY"


def test_runner_executes_approved_order_when_manual_approval_required(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "cash_quantity": 1000},
        execution={"require_order_approval": True},
    )

    result = run_from_config(config_path, mode_override="simulated-paper", approve_orders=True)

    assert result.orders == 1
    assert result.fills == 1
    assert result.rejections == 0
    assert result.approval_required_orders == 0
    assert result.final_cash == pytest.approx(9000.0)
    previews = [json.loads(line) for line in (output_dir / "order_previews.jsonl").read_text().splitlines()]
    assert previews[0]["approval_status"] == "approved"
    fills = [json.loads(line) for line in (output_dir / "fills.jsonl").read_text().splitlines()]
    assert fills[0]["symbol"] == "SPY"


def test_validate_config_file_rejects_non_bool_manual_approval(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        execution={"require_order_approval": "yes"},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "execution.require_order_approval must be true or false" in str(exc.value)


def test_validate_config_file_rejects_empty_approval_dir(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        execution={"approval_dir": ""},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "execution.approval_dir must be a non-empty string" in str(exc.value)


def test_validate_config_file_runs_plugin_config_validator(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.validated_plugin:create_strategy",
        strategy={"symbol": ""},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    message = str(exc.value)
    assert "metadata.strategy_plugin config: strategy.symbol must be a non-empty string" in message
    assert "metadata.strategy_plugin config: strategy.threshold is required" in message
    assert not output_dir.exists()


def test_validate_config_file_accepts_valid_plugin_config(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.validated_plugin:create_strategy",
        strategy={"symbol": "SPY", "threshold": 1.5},
    )

    config = validate_config_file(config_path)

    assert config["strategy"]["threshold"] == pytest.approx(1.5)
    assert not output_dir.exists()


def test_validate_config_file_rejects_loop_for_replay(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        runner={"loop": True, "max_loop_iterations": 2, "loop_interval_seconds": 0},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "runner.loop is only supported for shadow or paper mode" in str(exc.value)
    assert not output_dir.exists()


def test_shadow_loop_records_bounded_iterations(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        runner={
            "loop": True,
            "loop_interval_seconds": 0,
            "max_loop_iterations": 2,
            "skip_duplicate_latest": False,
        },
    )

    result = run_from_config(config_path, mode_override="shadow")

    assert result.loop_enabled is True
    assert result.loop_iterations == 2
    assert result.decisions == 2
    assert result.account_snapshot_count == 2
    assert result.latest_data_time == "2026-01-02T14:40:00+00:00"
    decisions = [json.loads(line) for line in (output_dir / "decisions.jsonl").read_text().splitlines()]
    assert [row["step"] for row in decisions] == [1, 2]
    assert [row["timestamp"] for row in decisions] == [
        "2026-01-02T14:40:00+00:00",
        "2026-01-02T14:40:00+00:00",
    ]
    summary = json.loads((output_dir / "summary.json").read_text())
    assert summary["loop_enabled"] is True
    assert summary["loop_iterations"] == 2
    status = json.loads((output_dir / "runner_status.json").read_text())
    assert status["state"] == "completed"
    assert status["loop"]["enabled"] is True
    assert status["loop"]["iterations"] == 2
    assert status["counts"]["decisions"] == 2


def test_shadow_loop_skips_duplicate_latest_by_default(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        runner={"loop": True, "loop_interval_seconds": 0, "max_loop_iterations": 2},
    )

    result = run_from_config(config_path, mode_override="shadow")

    assert result.loop_iterations == 2
    assert result.decisions == 1
    decisions = [json.loads(line) for line in (output_dir / "decisions.jsonl").read_text().splitlines()]
    assert len(decisions) == 1


def test_shadow_loop_stops_cleanly_when_stop_marker_exists(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    stop_marker = tmp_path / "control" / "runner.stop"
    stop_marker.parent.mkdir()
    stop_marker.write_text("stop\n")
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        runner={
            "loop": True,
            "loop_interval_seconds": 0,
            "max_loop_iterations": 2,
        },
        control={"stop_marker": str(stop_marker)},
    )

    result = run_from_config(config_path, mode_override="shadow")

    assert result.loop_enabled is True
    assert result.loop_iterations == 0
    assert result.decisions == 0
    assert result.orders == 0
    assert result.account_snapshot_count == 0
    assert result.stopped_by_control is True
    assert result.stop_marker == str(stop_marker)
    assert not (output_dir / "decisions.jsonl").exists()
    summary = json.loads((output_dir / "summary.json").read_text())
    assert summary["stopped_by_control"] is True
    assert summary["stop_marker"] == str(stop_marker)
    status = json.loads((output_dir / "runner_status.json").read_text())
    assert status["state"] == "stopped"
    assert status["control"]["stopped_by_control"] is True
    assert status["control"]["stop_marker"] == str(stop_marker)
    assert status["counts"]["decisions"] == 0


def test_shadow_loop_records_idle_decision_outside_session(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        runner={
            "loop": True,
            "loop_interval_seconds": 0,
            "max_loop_iterations": 2,
            "skip_duplicate_latest": False,
            "session": {
                "timezone": "UTC",
                "start": "15:00",
                "end": "16:00",
                "weekdays": ["friday"],
                "outside_session": "idle",
            },
        },
    )

    result = run_from_config(config_path, mode_override="shadow")

    assert result.loop_enabled is True
    assert result.loop_iterations == 2
    assert result.session_enabled is True
    assert result.session_status == "outside_session"
    assert result.session_idle_iterations == 2
    assert result.decisions == 2
    assert result.orders == 0
    assert result.latest_data_time == "2026-01-02T14:40:00+00:00"
    decisions = [json.loads(line) for line in (output_dir / "decisions.jsonl").read_text().splitlines()]
    assert [row["signal"] for row in decisions] == [
        {"idle": True, "reason": "outside_session"},
        {"idle": True, "reason": "outside_session"},
    ]
    assert decisions[0]["diagnostics"]["session"]["timezone"] == "UTC"
    assert decisions[0]["diagnostics"]["session"]["weekdays"] == [4]
    assert not (output_dir / "orders.jsonl").exists()
    summary = json.loads((output_dir / "summary.json").read_text())
    assert summary["session_enabled"] is True
    assert summary["session_idle_iterations"] == 2
    assert summary["session_status"] == "outside_session"
    status = json.loads((output_dir / "runner_status.json").read_text())
    assert status["state"] == "completed"
    assert status["session"]["enabled"] is True
    assert status["session"]["status"] == "outside_session"
    assert status["session"]["idle_iterations"] == 2


def test_shadow_loop_runs_inside_session_window(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        runner={
            "loop": True,
            "loop_interval_seconds": 0,
            "max_loop_iterations": 1,
            "session": {
                "timezone": "UTC",
                "start": "14:00",
                "end": "15:00",
                "weekdays": [4],
            },
        },
    )

    result = run_from_config(config_path, mode_override="shadow")

    assert result.decisions == 1
    assert result.session_enabled is True
    assert result.session_status == "inside_session"
    assert result.session_idle_iterations == 0
    decisions = [json.loads(line) for line in (output_dir / "decisions.jsonl").read_text().splitlines()]
    assert decisions[0]["signal"] == {"reason": "example_only_no_signal"}


def test_validate_config_rejects_invalid_session_config(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        runner={
            "session": {
                "timezone": "Not/AZone",
                "start": "9:30",
                "end": "16:00",
                "outside_session": "trade_anyway",
            },
        },
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    text = str(exc.value)
    assert "runner.session.timezone is unknown: Not/AZone" in text


def test_paper_mode_requires_explicit_confirmation(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
    )

    with pytest.raises(ValueError, match="confirm-paper-orders"):
        run_from_config(config_path, mode_override="paper")


def test_paper_mode_rejects_live_account_mode_before_broker_connect(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        broker={"account_mode": "live", "port": 4002},
    )

    with pytest.raises(ValueError, match="account_mode live"):
        run_from_config(config_path, mode_override="paper", confirm_paper_orders=True)

    assert not output_dir.exists()


def test_paper_mode_rejects_known_live_ibkr_port_without_dual_opt_in(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        broker={"account_mode": "paper", "port": 4001},
    )

    with pytest.raises(ValueError, match="known live IBKR ports"):
        run_from_config(config_path, mode_override="paper", confirm_paper_orders=True)

    assert not output_dir.exists()


def test_paper_mode_live_port_requires_config_and_cli_opt_in(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        broker={"account_mode": "paper", "port": 4001, "allow_live_broker_port_for_paper": True},
    )

    with pytest.raises(ValueError, match="known live IBKR ports"):
        run_from_config(config_path, mode_override="paper", confirm_paper_orders=True)

    assert not output_dir.exists()


def test_paper_broker_safety_allows_live_port_only_with_dual_opt_in():
    errors = paper_broker_safety_errors(
        {"account_mode": "paper", "port": 4001, "allow_live_broker_port_for_paper": True},
        allow_live_broker_port=True,
    )

    assert errors == []


def test_paper_broker_safety_uses_adapter_capabilities_for_file_adapter():
    errors = paper_broker_safety_errors({"adapter": "file"})

    assert errors == []


def test_paper_broker_safety_rejects_required_missing_expected_account():
    errors = paper_broker_safety_errors({
        "adapter": "file",
        "account_mode": "paper",
        "require_expected_account_id": True,
    })

    assert errors == ["broker.require_expected_account_id requires broker.expected_account_id"]


def test_paper_mode_can_use_file_broker_adapter(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    broker_state = tmp_path / "file_broker_state.json"
    broker_orders = tmp_path / "file_broker_orders.jsonl"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "quantity": 2, "cash_quantity": None},
        broker={
            "adapter": "file",
            "account_mode": "paper",
            "state_path": str(broker_state),
            "orders_path": str(broker_orders),
            "starting_cash": 1000,
            "prices": {"SPY": 100},
        },
    )

    result = run_from_config(config_path, mode_override="paper", confirm_paper_orders=True)

    assert result.orders == 1
    assert result.fills == 1
    assert result.rejections == 0
    assert result.final_cash == pytest.approx(800.0)
    assert result.final_positions == {"SPY": 2.0}
    fills = [json.loads(line) for line in (output_dir / "fills.jsonl").read_text().splitlines()]
    assert fills[0]["simulated"] is False
    assert fills[0]["price"] == pytest.approx(100.0)
    broker_rows = [json.loads(line) for line in broker_orders.read_text().splitlines()]
    assert broker_rows[0]["status"] == "filled"


def test_paper_mode_verifies_expected_file_broker_account(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    broker_state = tmp_path / "file_broker_state.json"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "quantity": 1, "cash_quantity": None},
        broker={
            "adapter": "file",
            "account_mode": "paper",
            "state_path": str(broker_state),
            "account_id": "paper-a",
            "expected_account_id": "paper-a",
            "starting_cash": 1000,
            "prices": {"SPY": 100},
        },
    )

    result = run_from_config(config_path, mode_override="paper", confirm_paper_orders=True)

    assert result.fills == 1


def test_paper_mode_rejects_unexpected_file_broker_account(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    broker_state = tmp_path / "file_broker_state.json"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "quantity": 1, "cash_quantity": None},
        broker={
            "adapter": "file",
            "account_mode": "paper",
            "state_path": str(broker_state),
            "account_id": "paper-a",
            "expected_account_id": "paper-b",
            "starting_cash": 1000,
            "prices": {"SPY": 100},
        },
    )

    with pytest.raises(ValueError, match="paper broker account verification failed"):
        run_from_config(config_path, mode_override="paper", confirm_paper_orders=True)

    assert not (output_dir / "fills.jsonl").exists()


def test_validate_config_file_rejects_invalid_broker_account_mode(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        broker={"account_mode": "demo"},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "broker.account_mode must be paper or live" in str(exc.value)
    assert not output_dir.exists()


def test_validate_config_file_rejects_unsupported_broker_live_mode_and_requires_expected_account(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        broker={"adapter": "ibkr", "account_mode": "live", "port": 4001},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    text = str(exc.value)
    assert "broker.adapter ibkr does not support account_mode live" in text
    assert "broker.account_mode live requires broker.expected_account_id" in text
    assert not output_dir.exists()


def test_validate_config_file_rejects_live_mode_without_explicit_live_gates(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        runner={"mode": "live"},
        broker={"adapter": "ibkr", "account_mode": "paper", "port": 4002},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    text = str(exc.value)
    assert "runner.mode live requires execution.enable_live_orders: true" in text
    assert "runner.mode live requires broker.account_mode: live" in text
    assert "runner.mode live requires broker.expected_account_id" in text
    assert "runner.mode live requires execution.require_order_approval: true" in text
    assert not output_dir.exists()


def test_validate_config_file_rejects_live_mode_even_after_live_gates_until_adapter_exists(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        runner={"mode": "live"},
        execution={"enable_live_orders": True, "require_order_approval": True},
        broker={
            "adapter": "ibkr",
            "account_mode": "live",
            "expected_account_id": "example-live-account",
            "port": 4001,
        },
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    text = str(exc.value)
    assert "broker.adapter ibkr does not support account_mode live" in text
    assert "live mode execution is not implemented" not in text
    assert not output_dir.exists()


def test_validate_config_file_rejects_required_missing_expected_account(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        broker={"adapter": "file", "account_mode": "paper", "require_expected_account_id": True},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "broker.require_expected_account_id requires broker.expected_account_id" in str(exc.value)
    assert not output_dir.exists()


def test_validate_config_file_rejects_metadata_only_broker_adapter(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        broker={"adapter": "schwab"},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    text = str(exc.value)
    assert "broker.adapter schwab is metadata-only" in text
    assert "broker.adapter schwab does not support order types" in text


def test_validate_config_file_reports_missing_data_file(tmp_path):
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_config(
        config_path,
        bars_path=tmp_path / "missing.csv",
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "does not exist" in str(exc.value)
    assert not output_dir.exists()


def test_validate_config_file_rejects_unsupported_order_type(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        execution={"allowed_order_types": ["market", "limit"]},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "execution.allowed_order_types" in str(exc.value)
    assert "limit" in str(exc.value)


def test_runner_rejects_order_above_notional_limit(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "cash_quantity": 5000},
        execution={"max_notional_per_order": 1000},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.orders == 1
    assert result.fills == 0
    assert result.rejections == 1
    records = [json.loads(line) for line in (output_dir / "orders.jsonl").read_text().splitlines()]
    assert records[-1]["status"] == "rejected"
    assert "max_notional_per_order" in records[-1]["reason"]


def test_runner_rejects_short_sale_when_disabled(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "side": "sell", "quantity": 1, "cash_quantity": None},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.orders == 1
    assert result.fills == 0
    assert result.rejections == 1
    records = [json.loads(line) for line in (output_dir / "orders.jsonl").read_text().splitlines()]
    assert "exceeds held quantity" in records[-1]["reason"]


def test_runner_rejects_symbol_not_in_shortable_universe(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "side": "sell", "quantity": 1, "cash_quantity": None},
        execution={"allow_short": True, "shortable_symbols": ["QQQ"]},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.orders == 1
    assert result.fills == 0
    assert result.rejections == 1
    records = [json.loads(line) for line in (output_dir / "orders.jsonl").read_text().splitlines()]
    assert records[-1]["reason"] == "symbol SPY is not in shortable_symbols"


def test_runner_rejects_short_notional_above_symbol_cap(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "side": "sell", "quantity": 10, "cash_quantity": None},
        execution={
            "allow_short": True,
            "shortable_symbols": ["SPY"],
            "max_short_notional_per_symbol": 500,
        },
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.orders == 1
    assert result.fills == 0
    assert result.rejections == 1
    records = [json.loads(line) for line in (output_dir / "orders.jsonl").read_text().splitlines()]
    assert "max_short_notional_per_symbol" in records[-1]["reason"]


def test_runner_enforces_max_orders_per_run(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "cash_quantity": 100, "repeat": True},
        execution={"max_orders_per_run": 1},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.orders == 3
    assert result.fills == 1
    assert result.rejections == 2
    records = [json.loads(line) for line in (output_dir / "orders.jsonl").read_text().splitlines()]
    assert records[-1]["reason"] == "max_orders_per_run 1 reached"


def test_runner_honors_pause_marker_before_strategy_evaluation(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    pause_marker = tmp_path / "control" / "runner.pause"
    pause_marker.parent.mkdir()
    pause_marker.write_text("paused\n")
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="tests.fixtures.order_once_plugin:create_strategy",
        strategy={"symbol": "SPY", "cash_quantity": 1000},
        control={"pause_marker": str(pause_marker)},
    )

    result = run_from_config(config_path, mode_override="simulated-paper")

    assert result.decisions == 3
    assert result.orders == 0
    assert result.fills == 0
    assert result.final_cash == pytest.approx(10000.0)
    assert result.account_snapshot_count == 3
    records = [json.loads(line) for line in (output_dir / "decisions.jsonl").read_text().splitlines()]
    assert records[-1]["signal"] == {"paused": True}
    assert records[-1]["diagnostics"]["pause_marker"] == str(pause_marker)
    assert not (output_dir / "orders.jsonl").exists()
    account = [json.loads(line) for line in (output_dir / "account.jsonl").read_text().splitlines()]
    assert account[-1]["positions"] == {}


def test_validate_config_rejects_empty_stop_marker(tmp_path):
    bars_path = tmp_path / "bars.csv"
    config_path = tmp_path / "config.yaml"
    output_dir = tmp_path / "out"
    write_sample_bars(bars_path)
    write_config(
        config_path,
        bars_path=bars_path,
        output_dir=output_dir,
        plugin="examples.strategies.no_edge_template:create_strategy",
        control={"stop_marker": "   "},
    )

    with pytest.raises(ConfigValidationError) as exc:
        validate_config_file(config_path)

    assert "control.stop_marker must not be empty" in str(exc.value)
