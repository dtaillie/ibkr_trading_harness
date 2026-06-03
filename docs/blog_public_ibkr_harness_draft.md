# Blog Draft: A Local-First IBKR Trading Harness

This is a draft for a public post. It should describe the framework without
publishing strategy edge, tuned parameters, account details, or private results.

## Working Title

Building a local-first IBKR harness for market data, strategy plugins, and paper
trading

## Draft

I wanted a trading research setup that could move from historical data pulls to
paper trading without mixing broker credentials, strategy ideas, and runtime
logs into one public codebase. The result is a local-first IBKR harness: the
machine near the broker session handles Gateway, data fetches, and execution
adapters, while strategy logic is loaded through plugins that can remain
private.

The public repository is intentionally not a strategy release. It includes the
reusable parts: IBKR historical data fetchers for stocks and Zero Hash crypto,
basic broker/order adapters, a generic plugin runner, plugin contracts, example
no-edge strategies, service wrappers, and an audit script for checking that
private configs or account-like tokens have not slipped into the public copy.

The most useful early workflow is data-only. Start IBKR Gateway or TWS, then
fetch a small stock sample:

```bash
python3 live/fetch_history.py \
  --host 127.0.0.1 \
  --port 4002 \
  --client-id 99 \
  --symbols SPY,QQQ \
  --bar-size 5min \
  --duration "1 D" \
  --rth
```

For crypto through IBKR Zero Hash, use the resumable crypto fetcher:

```bash
python3 live/fetch_crypto_history.py \
  --host 127.0.0.1 \
  --port 4002 \
  --client-id 199 \
  --symbols BTC-USD,ETH-USD \
  --exchange ZEROHASH \
  --bar-size 1min \
  --months 1
```

IBKR historical data depends on account permissions, venue support, and pacing.
The fetcher writes chunks locally so longer jobs can resume instead of starting
over after a disconnect.

Strategy code is deliberately separated. Public examples live under
`examples/strategies/` and intentionally emit no tradable edge. A real strategy
should implement the same contract from a private package and be referenced from
an ignored local config:

```yaml
metadata:
  strategy_plugin: your_private_package.your_strategy:create_strategy
```

That split matters. A repo can safely document how data is fetched, how plugins
are loaded, how services are installed, and how order adapters are shaped
without publishing the actual signal logic or parameters.

The generic runner is the public execution path:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --mode replay \
  --max-steps 3
```

It can run replay, shadow, simulated-paper, and explicitly confirmed IBKR paper
mode. The example config uses local sample bars and a no-edge plugin. A real
private config can point to a private plugin while keeping the public harness
unchanged.

Before publishing a copy, run:

```bash
python3 scripts/public_readiness_audit.py
```

The audit is conservative. It checks for private runtime paths, account-like
tokens, local home paths, credential assignments, and private plugin references.
It is not a substitute for review, but it gives the public repo a repeatable
gate.

The next public milestone is richer operations around the generic runner:
continuous market-hours loops, stronger config schemas, broker-agnostic
adapters, and read-only monitoring. The public release should still not be
treated as a turnkey trading bot.

## Safety Notes

- Paper trading can still fail from stale data, rejected orders, bad sizing, or
  Gateway interruptions.
- Keep broker credentials outside the repo.
- Keep live order submission behind explicit config gates.
- Do not publish tuned universes, logs, fills, account IDs, or private strategy
  notes.
- The example strategies are intentionally non-viable and are only there to
  demonstrate interfaces.
