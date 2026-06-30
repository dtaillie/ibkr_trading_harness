import pandas as pd

from tests.fixtures.no_edge_template import create_strategy
from framework.plugin_loader import create_plugin
from framework.strategy_plugin import StrategyContext


def test_no_edge_template_strategy_emits_no_orders():
    strategy = create_strategy({"example": True})
    decision = strategy.on_data(
        {"SPY": pd.DataFrame({"close": [100.0]})},
        StrategyContext(now=pd.Timestamp("2026-01-01T00:00:00Z"), mode="paper"),
    )

    assert decision.intents == []
    assert decision.signal["reason"] == "example_only_no_signal"
    assert decision.diagnostics["symbols_seen"] == ["SPY"]
    assert decision.diagnostics["dashboard"]["signal_label"] == "Example score"
    assert decision.diagnostics["dashboard"]["threshold"] == 1.0


def test_example_crypto_signal_plugin_loads_from_spec():
    plugin = create_plugin("examples.strategies.no_edge_crypto_signal:create_plugin", {})
    signal = plugin.select_signal(pd.DataFrame(), pd.DataFrame(), {})

    assert signal.reason == "example_no_edge"
