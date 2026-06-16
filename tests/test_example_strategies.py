"""Guard that the educational example strategies stay runnable end to end.

These examples are non-viable demonstrations, but they must keep working through
the generic plugin runner so the public quickstart and dashboard demo stay
honest: each should produce a real BUY and a real SELL on the bundled synthetic
session and end the run flat with no rejected orders.
"""

from __future__ import annotations

import json
from pathlib import Path

import pandas as pd
import pytest

from live.plugin_runner import run_from_config

REPO_ROOT = Path(__file__).resolve().parent.parent

EXAMPLE_CONFIGS = [
    "config/sma_crossover.example.yaml",
    "config/rsi_mean_reversion.example.yaml",
    "config/opening_range_breakout.example.yaml",
]

EXAMPLE_FACTORIES = [
    "examples.strategies.sma_crossover:create_strategy",
    "examples.strategies.rsi_mean_reversion:create_strategy",
    "examples.strategies.opening_range_breakout:create_strategy",
]


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


@pytest.mark.parametrize("config_rel", EXAMPLE_CONFIGS)
def test_example_strategy_runs_a_round_trip(config_rel: str, tmp_path: Path) -> None:
    config_path = REPO_ROOT / config_rel
    assert config_path.exists(), config_path

    run_from_config(
        config_path,
        mode_override="simulated_paper",
        output_dir_override=tmp_path,
    )

    fills = _read_jsonl(tmp_path / "fills.jsonl")
    sides = [str(f.get("side", "")).lower() for f in fills]
    assert "buy" in sides, f"{config_rel}: expected at least one buy fill, got {sides}"
    assert "sell" in sides, f"{config_rel}: expected at least one sell fill, got {sides}"

    orders = _read_jsonl(tmp_path / "orders.jsonl")
    rejected = [o for o in orders if str(o.get("status", "")).lower() == "rejected"]
    assert not rejected, f"{config_rel}: example produced rejected orders: {rejected}"

    # Ends flat: equal buy and sell quantity on the (single-symbol) example.
    bought = sum(float(f.get("quantity", 0)) for f in fills if str(f.get("side")).lower() == "buy")
    sold = sum(float(f.get("quantity", 0)) for f in fills if str(f.get("side")).lower() == "sell")
    assert bought == pytest.approx(sold, rel=1e-6), f"{config_rel}: did not end flat ({bought} vs {sold})"


@pytest.mark.parametrize("spec", EXAMPLE_FACTORIES)
def test_example_strategy_handles_missing_symbol(spec: str) -> None:
    """Protocol smoke: empty/absent data must not crash; returns no intents."""
    from framework.plugin_loader import create_plugin
    from framework.strategy_plugin import StrategyContext, StrategyDecision

    plugin = create_plugin(spec, {"symbol": "SPY"})
    context = StrategyContext(now=pd.Timestamp("2026-01-02T15:00:00Z"), mode="replay")
    decision = plugin.on_data({}, context)
    assert isinstance(decision, StrategyDecision)
    assert list(decision.intents) == []
