# Blog Draft: A Local-First IBKR Trading Harness

This is a public-safe blog draft. It describes the framework and operating
model without publishing strategy edge, tuned parameters, account identifiers,
credentials, logs, or private results.

## Working Title

Building a local-first IBKR harness for data, strategy plugins, and paper
trading

## Short Summary

I built a local-first trading harness that separates reusable infrastructure
from private strategy logic. The public repo shows how to fetch IBKR historical
data, inspect saved files, load strategy plugins, run replay or simulated-paper
tests, and monitor local or remote status without putting broker credentials or
signal code in a public codebase.

The public release is not a strategy and does not include performance claims.
It is a framework for people who want a cleaner boundary between research,
execution, monitoring, and publication.

## Draft

Most trading projects start as a pile of scripts. That works until the same
directory contains broker credentials, private strategy ideas, cached market
data, runtime logs, and half-finished experiments. At that point, publishing any
part of the work becomes risky because the useful infrastructure and private
edge are tangled together.

This project is an attempt to separate those concerns. The public repo is a
local-first IBKR trading harness: the machine near IBKR Gateway or TWS handles
data fetching, plugin execution, paper-order plumbing, and status publishing.
Strategy logic is loaded through plugins, so real strategies can stay in an
ignored local file or private package.

The public repo includes reusable plumbing:

- IBKR stock historical-data fetching.
- IBKR Zero Hash crypto historical-data fetching.
- JSON fetch manifests with progress, retry, pacing, output, and recovery
  metadata.
- A Data Library dashboard for inspecting saved CSV/parquet files.
- A generic strategy-plugin runner for replay, shadow, simulated-paper, and
  explicitly confirmed IBKR paper mode.
- A generic local supervisor for scheduled plugin-runner jobs.
- A local status dashboard with Overview, Performance, Data Library, Fetch
  Jobs, Workbench, Runs, Operations, and Help pages.
- Read-only remote-monitoring and conservative command-queue prototypes.
- Public-safe no-edge example strategies and example configs.
- A consolidated public pre-publish check for export-manifest review,
  public-readiness audits, cloud-example audits, tests, and dashboard smokes.

It intentionally does not include a profitable strategy, tuned universe, private
configuration, private runner, broker credentials, account IDs, runtime logs, or
research output.

## Data First

The safest workflow is data-only. Start IBKR Gateway or TWS, then fetch a small
stock sample:

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

For crypto through IBKR Zero Hash:

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

Historical data is operationally messy. IBKR permissions, venue support,
contract qualification, pacing, disconnects, and no-data responses all matter.
The fetchers write dashboard-readable JSON manifests so a completed or failed
run is not just a console scrollback. The manifest records symbols, parameters,
progress, output files, errors, retries, pacing waits, and recovery guidance.

If a fetch fails, the Fetch Jobs page shows whether the job looks blocked by
market-data permissions, needs symbol/contract cleanup, needs a retry, needs a
no-data review, or produced files outside configured data roots.

## Make Saved Data Visible

The Data Library is there to answer a basic question: what data do I actually
have?

It scans configured roots for CSV/parquet files, then summarizes symbol, asset
class, source, bar size, storage session, timestamp coverage, row count, gaps,
duplicates, malformed bars, file size, and modification time. It also shows
when a catalog scan is capped and why a file or symbol may not be visible.

For local use, the dashboard config can point at real cache/history roots:

```yaml
dashboard:
  data_roots:
    - examples/data
    - cache
    - paper_logs/history
```

The public example config stays small and points at bundled sample data. A local
ignored config can add private roots without changing the public repo.

## Strategy Logic Stays Private

Public examples live under `examples/strategies/` and intentionally emit no
tradable edge. A real strategy should implement the same plugin contract from a
private package and be referenced from an ignored local config:

```yaml
metadata:
  strategy_plugin: your_private_package.your_strategy:create_strategy
```

That boundary is the core design decision. The public project can document how
plugins are loaded, how data is aligned, how orders are guarded, and how runs
are summarized without publishing the signal logic or parameters.

## Replay and Simulated Paper

The generic runner is the public execution path:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --mode replay \
  --max-steps 3
```

It supports:

- `replay`: evaluate a plugin over saved bars.
- `shadow`: observe decisions without submitting orders.
- `simulated-paper`: use local simulated fills and account state.
- `paper`: submit to a broker paper account only with explicit confirmation.

Paper mode requires `--confirm-paper-orders`, rejects live account mode, and
refuses known live IBKR ports unless both config and CLI explicitly opt in. That
does not make trading risk-free, but it keeps accidental live submission from
being the default path. Ignored local configs can also set
`broker.expected_account_id`, and optionally
`broker.require_expected_account_id: true`, so the runner verifies the connected
broker account before any paper order can be submitted.

The runner writes public-safe artifacts such as decisions, orders, fills,
account snapshots, order previews, and summaries. The dashboard can show equity,
drawdown, return bars, trade rows, account snapshots, order previews, rejected
orders, and run timelines from those artifacts.

## Workbench: From Saved Data to a Draft

The Config Workbench turns saved Data Library files into a runnable example
config:

1. Select one or more saved datasets.
2. Review quality warnings and timestamp alignment.
3. Choose a public example plugin or private local plugin metadata.
4. Choose replay or simulated-paper mode.
5. Review risk limits and simulated cost settings.
6. Generate and validate the draft.
7. Run replay or simulated paper.
8. Open the result in Performance or Runs.

Generated drafts are local artifacts. Public example plugins demonstrate the
wiring only; they are not recommendations and do not contain a tradable signal.

## Monitoring Without Moving Trading Authority to the Cloud

The dashboard can run locally as a receiver:

```bash
python3 scripts/cloud_status_server.py --config config/cloud_status.example.yaml
```

The publisher can write read-only status snapshots to disk or POST sanitized
status to a receiver. This makes it possible to check heartbeat, Gateway state,
latest data/account timestamps, open positions, recent orders, recent fills,
rejections, fetch jobs, and supervisor state from a dashboard without putting
broker credentials in the hosted layer.

Remote commands are intentionally conservative. The public prototype includes
authentication, role scopes, rate limits, audit rows, hash-chain integrity, and
optional HMAC signatures. Higher-risk commands should stay behind stronger
local confirmations.

## Public/Private Export

The private source tree should not be pushed directly. Instead, create a clean
public copy:

```bash
python3 scripts/export_public_repo.py --dest ../algo_trade_public --force
```

Then audit the public candidate:

```bash
cd ../algo_trade_public
python3 scripts/public_publish_check.py
```

The gate includes a conservative audit for private/research paths,
account-like IDs, credential-style assignments, local home paths, and private
plugin references. It also checks cloud-example boundaries, tests, and
dashboard smokes. It is not a substitute for manual review, but it gives the
public repo a repeatable pre-push gate.

## Limitations

This is infrastructure, not alpha.

- IBKR data availability depends on permissions, venue support, and contract
  qualification.
- Historical-data pulls can hit pacing or no-data responses.
- Paper trading can still fail from stale data, bad sizing, rejected orders,
  Gateway interruptions, or incorrect assumptions.
- Simulated fills are not broker fills.
- Example plugins are intentionally non-viable.
- Public docs should avoid private performance claims unless the methodology,
  data, and caveats are publishable.

The goal is not to give anyone a turnkey trading bot. The goal is to provide a
clean local harness where reusable operations can be public and actual strategy
work can remain private.

## Pre-Publish Checklist

- Run the public export script.
- Run `python3 scripts/public_publish_check.py`.
- Use `python3 scripts/public_publish_check.py --include-screenshots` for the
  slower dashboard screenshot layout checks.
- Confirm all example configs are no-edge and use placeholder values.
- Confirm private strategy plugins, tuned universes, account IDs, credentials,
  logs, fills, and research outputs are excluded.
- Read the public copy as if it were already on GitHub.
