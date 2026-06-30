# Example strategy plugins

**These are non-viable demonstrations, not trading strategies.** They exist to
show the `StrategyPlugin` interface end to end and to give the dashboard,
quickstart, and replay tooling something real to run. They implement well-known
*textbook* patterns with **no claimed edge, no tuning, and no research value**.
Do not trade them. Real strategy logic belongs in a private package referenced
from an ignored local config (see the repository README).

| File | Pattern | Buys when… | Sells when… |
| --- | --- | --- | --- |
| `sma_crossover.py` | trend | fast SMA crosses **above** slow SMA | fast SMA crosses **below** slow SMA |
| `rsi_mean_reversion.py` | mean reversion | RSI drops **below** `oversold` | RSI recovers **above** `exit_level` |
| `opening_range_breakout.py` | intraday breakout | first close **above** the opening-range high | target (`range_high + target_r·range`) or stop (`range_low`) |

Each entry sizes by dollars (`cash_quantity`); each exit sells the held
quantity, because the runner requires an explicit quantity on sell intents.

## Run them

The bundled synthetic session (`examples/data/SPY_5min_session.csv`, regenerate
with `python3 examples/data/generate_example_session.py`) is hand-shaped so each
example produces one clean round trip:

```bash
python3 -m live.plugin_runner --config config/sma_crossover.example.yaml
python3 -m live.plugin_runner --config config/rsi_mean_reversion.example.yaml
python3 -m live.plugin_runner --config config/opening_range_breakout.example.yaml

# inspect the simulated fills, equity, and decisions
python3 scripts/summarize_plugin_run.py paper_logs/example_sma_crossover
```

The configs default to `runner.mode: simulated_paper` so they record simulated
fills and an equity curve; switch to `replay` to observe decisions without
fills. Results show up in the dashboard's **Performance** and **Runs** pages.

## Write your own

Implement the `StrategyPlugin` protocol from `framework/strategy_plugin.py`
(`on_start`, `on_data`, `on_fill`) and expose a `create_strategy(config)`
factory. `on_data` receives `{SYMBOL: DataFrame}` (history-to-date with
`open/high/low/close/volume` columns and a UTC `timestamp` index) plus a
`StrategyContext` (`now`, `mode`, `cash`, `equity`, `positions`, `metadata`),
and returns a `StrategyDecision` carrying a list of `OrderIntent`. Point
`metadata.strategy_plugin` at your `module:create_strategy` and run it through
the same `live/plugin_runner.py`. Keep private strategies out of this public
tree.
