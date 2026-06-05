# IBKR Trading Harness

This is a local-first framework for pulling IBKR market data, defining strategy
plugins, and building paper/live runners around those plugins.

The public version is intentionally strategy-neutral. It includes the data
harness, broker adapter, plugin interfaces, Gateway service wrapper, and
non-viable example strategies. Real strategies, tuned parameters, account
config, logs, and research artifacts should live in a private repo or ignored
local files.

## What This Is

- IBKR historical data fetch tooling for equities and Zero Hash crypto.
- A broker adapter that can be used by paper/live integrations.
- A generic strategy-plugin runner for replay, shadow, simulated-paper, and
  explicitly confirmed IBKR paper mode.
- A generic local supervisor that can schedule one or more plugin-runner jobs
  from public-safe config.
- Strategy plugin contracts for generic, stock, and crypto runners.
- Example strategies that deliberately emit no edge.
- Example configs that show shape and operational wiring only.
- Local service scripts for IBKR Gateway startup.

## What This Is Not

- Not a profitable strategy.
- Not financial advice.
- Not a turnkey live-trading system.
- Not a place to store broker credentials or private strategy configs.
- Not a release of the private strategy runners or tuned signals.

## Quick Start

Install dependencies:

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
```

Fetch stock bars from IBKR:

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

Fetch crypto bars from IBKR Zero Hash:

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

Run the example plugin tests:

```bash
PYTHONPATH=. pytest tests/test_strategy_plugin_example.py
```

Run the generic no-edge plugin against local sample bars:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --validate-only

python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --mode replay \
  --max-steps 3

python3 scripts/summarize_plugin_run.py paper_logs/example_plugin_runner
```

Run the generic supervisor once:

```bash
python3 scripts/plugin_supervisor.py \
  --config config/plugin_supervisor.example.yaml \
  --validate-only

python3 scripts/plugin_supervisor.py \
  --config config/plugin_supervisor.example.yaml \
  --once
```

Run the read-only status publisher locally:

```bash
python3 scripts/publish_status.py \
  --config config/cloud_status.example.yaml \
  --json
```

Run the local mock receiver/dashboard:

```bash
export TRADING_STATUS_TOKEN='replace-me'
python3 scripts/cloud_status_server.py \
  --config config/cloud_status.example.yaml \
  --auth-token-env TRADING_STATUS_TOKEN
python3 scripts/publish_status.py \
  --config config/cloud_status.example.yaml \
  --endpoint http://127.0.0.1:8765/status \
  --token-env TRADING_STATUS_TOKEN
```

Open `http://127.0.0.1:8765/` for the operational dashboard.

Smoke-test dashboard assets and core endpoints:

```bash
python3 scripts/smoke_dashboard.py
```

Poll safe remote commands from the local machine:

```bash
export TRADING_STATUS_TOKEN='replace-me'
python3 scripts/command_worker.py \
  --config config/remote_control.example.yaml \
  --token-env TRADING_STATUS_TOKEN \
  --once
```

## Strategy Plugins

Public examples are in `examples/strategies/`. They demonstrate the interface
without publishing an edge. A private strategy should implement the same
contract and be referenced from a local ignored config file.

Example plugin spec:

```yaml
metadata:
  strategy_plugin: examples.strategies.no_edge_template:create_strategy
```

Private plugin spec:

```yaml
metadata:
  strategy_plugin: your_private_package.your_strategy:create_strategy
```

The generic runner writes `decisions.jsonl`, `orders.jsonl`, `fills.jsonl`,
`account.jsonl`, and `summary.json` under the configured output directory.
`account.jsonl` records per-step cash, equity, positions, and exposure, while
`summary.json` includes account snapshot count, total return, max drawdown,
elapsed account-observation time, and geometric return projections per day,
month, and year when those values are available. Short run windows are marked
as short-horizon projections so they are treated as context, not stable
performance estimates. IBKR paper mode requires
`--confirm-paper-orders`. The runner also applies config-driven execution
guards before simulated or paper execution: allowed symbols/sides/order types,
required current prices, max orders, max quantity/cash/notional, short-sale
permission, and gross exposure. Use `--validate-only` before runs to check
config shape, plugin importability, static data paths, supported modes/order
types, and numeric risk settings without creating run artifacts.
Use `scripts/summarize_plugin_run.py` to inspect a run directory without
opening the raw JSONL artifacts.

## Generic Supervisor

`scripts/plugin_supervisor.py` runs configured local job commands on simple
interval schedules and writes `paper_logs/plugin_supervisor/status.json`. Job
commands are argv lists rather than shell strings. Use `process_mode: blocking`
for short one-shot jobs and `process_mode: managed` for long-running
paper/shadow processes that should be monitored without blocking other jobs.
Each job can reference the same `pause_marker` used by the command worker and
generic runner, so remote pause/resume can stop scheduled launches and prevent
order evaluation.

## Cloud Checking

The public repo includes a read-only telemetry prototype. The local machine can
publish runner summaries, supervisor status, remote-control audit summaries,
and optional Gateway TCP health to a file or HTTP endpoint. The mock receiver
stores the latest status and serves a small workbench dashboard from
`web/dashboard/`. It does not execute commands or store broker credentials. The
dashboard now uses separate Overview, Performance, Data Library, Workbench,
Runs, Operations, and Help views instead of one long status page. It shows
read-only workbench state for saved drafts, recorded runs, archived run
artifacts, and local disk usage. It can also inspect configured local
CSV/parquet data roots, showing coverage summaries, timestamp/gap metadata,
root-scan diagnostics, suggested unconfigured local roots, and small
downsampled price previews. Individual datasets can be
inspected for larger sampled price paths, null counts, gap rows, price/return
stats, volume stats, and a compact ok/warn/bad quality summary before they are
used in a replay config. The saved-data table can be filtered by search text,
quality status, and bar size, and its header summarizes quality counts, bar-size
counts, total rows, and local file size. Saved-data coverage and quality
metadata can be exported as CSV. The dashboard can generate, save, validate, replay, and
simulated-paper-run example plugin-runner config drafts from saved data. This
workbench path is deliberately limited to public generic no-edge plugins,
file-based data under configured data roots, and non-live modes. Drafts can use
one or more selected datasets, with duplicate symbols and duplicate paths
rejected before YAML is written. Generated drafts include a data-alignment
summary for common timestamps, overlap coverage, cadence mismatches, and
per-symbol timestamp counts; the same alignment summary can be previewed before
saving a draft. Saved drafts can be reopened for YAML, validation status, data
alignment, and local command snippets when they still validate as public
workbench examples, and the validated YAML can be downloaded from the draft
table. The draft table includes a bulk validation summary for all saved YAML,
so unsupported plugins, missing data paths, and non-public example configs are
visible before a run is attempted. Risk presets in the builder only fill
example guardrail and simulated-cost
fields; they are editable and are not strategy recommendations.
Saved example YAML can be deleted from the draft table
without touching archived run artifacts. Saved draft runs can be inspected through summarized
artifacts for decisions, orders, fills, account snapshots, return, drawdown,
time-normalized return projections, gross/net exposure, position count, and an
equity curve; raw strategy signal payloads are not returned by the public
artifact view. Successful non-validate draft runs also archive a local per-run
artifact snapshot so a comparison row can inspect the exact run even after the
draft output directory is overwritten. Recent saved draft runs can also be
compared side by side by return, drawdown, exposure, elapsed time, fills,
rejections, and short-horizon projection status; failed or timed-out runs are
not allowed to reuse stale performance summaries from earlier successful runs.
The comparison table can be filtered by status, action, and summary
availability, then sorted by finish time, return, return/day, drawdown,
exposure, or position count. Run comparison records can be exported as a CSV of
public-safe summary fields, and selected archived run artifacts can be exported
as public-safe JSON.
Run log detail exposes command argv, return code, duration, and stdout/stderr
tails for diagnosis.
The Workbench Maintenance panel previews orphaned run archives and workbench
output directories, reports reclaimable disk usage, and can prune only those
orphaned directories after an explicit confirmation request. Cleanup is local
and bounded to the workbench archive/output roots.
The Setup Diagnostics panel checks local state-directory writability, configured
data roots, CSV/parquet file counts, and dashboard asset availability so setup
problems are visible before a user starts generating configs. The Endpoint Map
panel and `/workbench_endpoints` response list the public dashboard API surface
for scripting and troubleshooting. The Workbench State panel can export a
public-safe JSON snapshot of diagnostics, data catalog metadata, config options,
and recent run summaries for reproducibility notes.
Real deployments can add `max_age_seconds` to configured runs, supervisors, and
remote-control audit settings to alert on stale local artifacts. The receiver
also keeps a bounded read view over `status_history.jsonl` through
`/status_history`, and the dashboard shows recent snapshots so missed
heartbeats, warning periods, and recovery events are easier to inspect. Run
configs can opt into `recent_events` telemetry, which publishes bounded
summaries of recent decisions, orders, and fills without including raw strategy
signal payloads.

The repo also includes a remote-control prototype that keeps execution local.
The cloud side queues commands, and the local worker polls and enforces an
allowlist. Supported example actions include `request_status`, `summarize_run`,
`validate_config`, `supervisor_status`, `validate_supervisor_config`,
`run_supervisor_once`, `pause_runner`, and `resume_runner`. There is no
arbitrary shell execution and no broker action command. `run_supervisor_once`
is opt-in through `allowed_actions` and can only run a locally configured
supervisor ID. The mock server and worker support optional bearer-token auth via
environment variables; never put the token value in committed config.
Pause/resume writes a local marker file, and the generic plugin runner honors
`control.pause_marker` by recording paused decisions without calling strategy
logic or submitting orders. The command worker also writes a local JSONL audit
log by default, so the trading machine retains command records even if the cloud
endpoint is unavailable. The dashboard command form validates action-specific
parameters before queueing commands and can cancel pending commands that have
not yet been polled by the local worker.

## Config Privacy

Commit only example files:

- `config/*.example.yaml`
- `config/*.env.example`
- `config/strategy_registry.example.yaml`

Do not commit:

- `config/*.env`
- `config/*_paper.yaml`
- tuned universes
- logs, caches, analysis outputs
- broker credentials
- private strategy plugins

Run this before publishing:

```bash
python3 scripts/public_readiness_audit.py
```

Use strict mode in CI or before pushing a public branch:

```bash
python3 scripts/public_readiness_audit.py --fail-on-review
```

The private source tree can regenerate this public subset with
`scripts/export_public_repo.py --force`. Repeated exports preserve the
destination repo's `.git` directory, so history and remotes survive refreshes.

## Documentation

- `docs/public_quickstart.md`
- `docs/configuration_privacy.md`
- `docs/publication_readiness.md`
- `docs/public_framework_roadmap.md`
- `docs/work_queue.md`
- `docs/blog_public_ibkr_harness_draft.md`
