from __future__ import annotations

import json
from pathlib import Path

import pytest
import yaml

from live.plugin_runner import ConfigValidationError, run_from_config, validate_config_file


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
    data: dict | None = None,
    execution: dict | None = None,
    control: dict | None = None,
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
    assert previews == [
        {
            "approval_required": True,
            "approval_status": "required",
            "cash": pytest.approx(10000.0),
            "cash_quantity": pytest.approx(1000.0),
            "equity": pytest.approx(10000.0),
            "estimated_notional": pytest.approx(1000.0),
            "metadata": {},
            "mode": "simulated_paper",
            "order_type": "market",
            "positions": {},
            "price": pytest.approx(100.0),
            "quantity": None,
            "side": "buy",
            "status": "preview",
            "step": 1,
            "symbol": "SPY",
            "tag": "fixture_buy_once",
            "timestamp": "2026-01-02T14:30:00+00:00",
        }
    ]
    summary = json.loads((output_dir / "summary.json").read_text())
    assert summary["approval_required_orders"] == 1


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
