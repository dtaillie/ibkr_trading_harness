# Public Quickstart

This guide shows how to use the public framework without exposing or relying on
private strategy logic.

## 1. Start IBKR Gateway

Start IBKR Gateway or TWS manually first. For paper Gateway, the API port is
usually `4002`.

Do not put live credentials in this repo. If you use IBC, keep its config
outside git and protect it with local file permissions.

## 2. Fetch Historical Stock Data

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

This is data-only. It does not submit orders.
The command writes a JSON fetch manifest under `paper_logs/fetch_manifests`
unless `--no-manifest` is passed.

## 3. Fetch Historical Crypto Data

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

Crypto data availability depends on IBKR permissions and venue support.
The command writes both its existing resumability CSV under the crypto cache
and a dashboard-readable JSON fetch manifest under `paper_logs/fetch_manifests`.

## 4. Write a Strategy Plugin

Use the examples as templates:

- `examples/strategies/no_edge_template.py`
- `examples/strategies/no_edge_crypto_signal.py`
- `examples/strategies/no_edge_stock_signal.py`

Public examples intentionally emit no tradable edge.

## 5. Keep Real Config Private

Copy an example config to a local ignored config:

```bash
cp config/plugin_runner.example.yaml config/plugin_runner.yaml
cp config/crypto_paper.example.yaml config/crypto_paper.yaml
cp config/stock_paper.example.yaml config/stock_paper.yaml
```

Then point the config at your private plugin. Do not commit the copied files.

## 6. Run the Generic Plugin Runner

The public runner accepts a plugin spec and supports replay, shadow,
simulated-paper, and explicitly confirmed IBKR paper modes.

Replay the public no-edge example:

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

Run simulated-paper fills with your own private plugin:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.yaml \
  --mode simulated-paper
```

IBKR paper mode submits orders and therefore requires an explicit confirmation:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.yaml \
  --mode paper \
  --confirm-paper-orders
```

Paper mode also checks broker safety before connecting. Use
`broker.account_mode: paper` with a paper API port such as Gateway `4002` or
TWS `7497`; known live ports are refused unless both the config and CLI use the
explicit live-port override.

Broker execution is selected with `broker.adapter`. The public runner ships
with `ibkr` for IBKR paper execution and `file` for local adapter plumbing tests
that persist cash, positions, and submitted order rows to local files. The
`file` adapter fills at configured static prices and is not a market simulator
or a substitute for strategy validation.

For long-running observation or paper sessions, enable the generic loop in an
ignored local config or pass `--loop`. Loop mode is restricted to `shadow` and
`paper`, reloads the latest data each interval, skips duplicate latest bars by
default, and can be bounded with `--max-loop-iterations` for smoke tests:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.yaml \
  --mode shadow \
  --loop \
  --loop-interval-seconds 60
```

The current private stock and crypto runners are still excluded from the public
repo because they encode strategy-specific assumptions. The generic runner is
the public execution path.

Runner safety checks are configured under `execution`. The generic runner can
reject intents before execution based on allowed symbols, sides, order types,
current price availability, max orders per run, max quantity, max cash quantity,
max notional per order, short-sale permission, shortable-symbol whitelists,
short-notional caps, and gross-exposure limits. Simulated-paper mode can model
fixed/side-specific slippage bps, simple notional-based market impact,
commission bps, per-share commission, minimum commission, and max commission as
a percent of notional.
`--validate-only` checks the static parts of this config before a run starts.
Private strategy modules or factory functions can also expose
`validate_config(config, *, full_config=None)` or
`validate_strategy_config(config, *, full_config=None)` to reject missing or
mistyped strategy-specific settings before the runner loads data or connects to
a broker.
After a run, `scripts/summarize_plugin_run.py <run-dir>` prints decisions,
orders, fills, rejection reasons, final cash/equity, positions, return, and max
drawdown from the generic JSONL artifacts. When account timestamps are
available, the summary also prints elapsed days plus geometric return
projections per day, month, and year. Runs shorter than 30 days are marked as
short-horizon projections because those rates are useful for scale context but
are not stable performance estimates. The runner also writes `account.jsonl`
with per-step cash, equity, positions, and exposure.

## 7. Generic Local Supervisor

The public supervisor runs configured local plugin-runner jobs on simple
interval schedules and writes a status file that the cloud/status publisher can
read.

Validate and run the example once:

```bash
python3 scripts/plugin_supervisor.py \
  --config config/plugin_supervisor.example.yaml \
  --validate-only

python3 scripts/plugin_supervisor.py \
  --config config/plugin_supervisor.example.yaml \
  --once
```

For a real local setup, copy `config/plugin_supervisor.example.yaml` to an
ignored local config and point each job at private strategy configs. Job
commands are argv lists, not shell strings. Use `process_mode: blocking` for
short replay/fetch jobs and `process_mode: managed` for long-running paper or
shadow processes that should be monitored without blocking other jobs. A
job-level `pause_marker` lets the safe command worker pause scheduled launches.

## 8. Cloud Checking Prototype

Publish read-only local telemetry to a file:

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
```

Then publish to it from another terminal:

```bash
python3 scripts/publish_status.py \
  --config config/cloud_status.example.yaml \
  --endpoint http://127.0.0.1:8765/status \
  --token-env TRADING_STATUS_TOKEN
```

Open `http://127.0.0.1:8765/` to view the dashboard. The Help page links to
allowlisted local Markdown docs, including `docs/web_ui_runbook.md`, so the
operating runbook is available without browsing the source tree. The sidebar splits the
workbench into Overview, Performance, Data Library, Fetch Jobs, Workbench, Runs,
Operations, and Help views. Overview shows the current high-level state;
top-level views can also be opened directly with URL hashes such as
`#performance`, `#data`, `#fetch`, `#runs`, and `#help`.
health checks, setup checklist items, open positions, and recent
decision/order/fill events. After a second successful refresh, Overview also
calls out new recent events, alerts, and terminal fetch-job changes since the
prior refresh. Performance summarizes the latest run or selected
artifact with equity, return, drawdown, exposure, an equity curve, drawdown
curve, daily return bars, and a calendar-style daily return heatmap when
account snapshots are available. It also shows the active source, mode, latest
account timestamp, open position count, and decision/order/fill/reject activity
above the charts. Use the Period selector to narrow artifact
charts and KPIs to today, week, month, 3 months, or all available snapshots.
When sanitized fills are present, Performance also shows an open/closed trade
table, win/loss, average win/loss, and profit factor. Daily Run Rollups summarize
archived account artifacts by UTC day with return, equity, orders, fills,
rejects, and artifact drilldown; Period Rollups group the same archived rows by
month and year. Data Library shows
configured data roots, saved-data coverage, root-scan diagnostics, and
historical previews. Use Storage Audit to compare CSV/parquet files on disk
against the catalog-visible rows, including suggested roots that are not
currently configured. Use the coverage grid to see recent date-bin coverage by
symbol, and use Find Missing Symbol to diagnose whether a ticker is visible,
outside the catalog limit, in an unconfigured root, malformed, only present in
fetch errors, or absent. Fetch Jobs shows historical-data pull manifests, status
counts, no-data chunks, errors, produced output files, and per-symbol progress.
When a produced output file is under a configured data root, use Inspect Data in
the output row to open its saved-file detail view without leaving the dashboard.
Runs shows searchable saved-run comparisons, recent run-event telemetry,
current managed positions, and recent non-terminal order events when runners
publish them. Operations shows node health, Gateway reachability,
supervisors, remote-control audit health, alerts, queued commands, and command
results. It also shows read-only workbench state for saved draft count, run
count, archived artifact count, local disk usage, and the latest saved run.
Use Export Snapshot from Workbench State to download a public-safe JSON bundle
of setup diagnostics, saved-data metadata, config options, and recent run
summaries.
Run `python3 scripts/smoke_dashboard.py` to start a temporary dashboard server
and verify dashboard assets plus the core public endpoints without posting
broker data.
For real deployments, add `max_age_seconds` to configured runs, supervisors, or
remote-control audit settings in `config/cloud_status.example.yaml` copies so
stale local artifacts raise dashboard alerts.
The `dashboard.data_roots` list in `config/cloud_status.example.yaml` controls
which CSV/parquet roots are scanned. The public example points only at
`examples/data`. For a real local setup, copy the config to an ignored local
file and add roots such as `cache`, `cache/ibkr`, or your historical-data
directory. You can also repeat `--data-root` on the command line to override the
config for one run. If Data Library only shows the public SPY/QQQ examples,
check the root cards: the dashboard will call out likely local roots that exist
but are not currently configured. Data roots are scanned locally; the dashboard
receives coverage summaries and small downsampled previews, not full bar files.
For the same diagnosis from a terminal, run:

```bash
python3 scripts/audit_data_storage.py \
  --config config/cloud_status.example.yaml \
  --catalog-limit 500
```

The `dashboard.fetch_manifest_roots` list controls where Fetch Jobs looks for
JSON fetch manifests. The default fetch commands write to
`paper_logs/fetch_manifests`; add that root to local dashboard config when you
want fetch jobs visible.
Use Inspect on a saved dataset row to load a local-only detail view with a
range-filtered sampled or full-in-range price path, volume bars, timestamp
coverage, gap rows, null counts, price/return stats, volume stats, and a
compact ok/warn/bad quality summary.
Use Compare Saved Data to select several catalog-visible datasets and overlay
their normalized close-return paths over one requested date range. This is
offline and only reads CSV/parquet files under configured data roots.
The catalog header summarizes quality counts, bar-size counts, total rows, and
total local file size. Use the search, quality, and bar-size filters to narrow
larger local data roots. Use Export CSV to download the saved-data coverage and
quality summary without exporting full bar data.
The Config Builder section can generate and validate example plugin-runner YAML
from one or more selected saved datasets. It only offers public generic no-edge
plugins and replay/shadow/simulated-paper modes; it does not submit broker
orders. Duplicate symbols and duplicate paths are rejected before YAML is saved.
Risk presets fill example guardrail and simulated-cost fields, but the fields
remain editable and the presets are not trading recommendations.
Generated drafts include a Data Alignment section with common timestamp count,
overlap coverage, common range, per-symbol timestamp counts, and cadence or
overlap warnings. You can preview that alignment before saving a draft.
If you enable "Save draft locally", the YAML is written under the dashboard
state directory. Saved drafts can be reopened for YAML, validation status, and
copyable local command snippets when they still validate as public workbench
examples.
Use Validate Drafts to check every saved YAML against the public workbench
guardrails, then use Download on a saved draft row to download the validated
example YAML.
Use Delete on a saved draft row to remove only that saved YAML; run archives and
workbench output directories are handled separately by Workbench Maintenance.
Saved drafts can then be validated, replayed, or simulated-paper-run from the
dashboard with bounded `max_steps` and timeout controls, and recent workbench
run results are shown below the draft list. Use Inspect on a saved draft or run
row to review summarized `summary.json`, decisions, orders, fills, account
snapshots, return, drawdown, elapsed time, time-normalized return projections,
gross/net exposure, max position count, and an equity curve. The artifact view
intentionally omits raw strategy signal payloads. Successful non-validate runs
also archive a local per-run artifact snapshot, so a comparison row can inspect
that exact run even after a later run overwrites the draft's output directory.
Use Log on a run row to inspect command argv, return code, duration, and
stdout/stderr tails for the exact run.
The Run Comparison section ranks recent saved draft runs by return, return/day,
drawdown, and exposure using only successful run summaries; failed or timed-out
runs stay visible for diagnosis but do not carry stale metrics from a previous
artifact. Use the status/action/summary filters to narrow the comparison table,
use the Sort selector to order by finish time, return, return/day, drawdown,
exposure, or position count, use Export CSV to download the recent public-safe run summary table, and use
Export JSON in Run Artifacts to download the selected archived run artifact
summary.
The Workbench Maintenance section previews orphaned run archives and workbench
output directories, reports reclaimable bytes, supports a dry run, and only
prunes after the server receives the explicit `prune-workbench` confirmation.
It is limited to local workbench archive/output roots.
The Setup Diagnostics section checks whether the local state directory can be
written, whether configured data roots contain CSV/parquet files, and whether
dashboard assets are present. The Endpoint Map section mirrors
`/workbench_endpoints`, which lists the public dashboard API surface for scripts
and troubleshooting.
The receiver appends each posted status to `status_history.jsonl` and exposes a
summarized recent-history endpoint:

```bash
curl 'http://127.0.0.1:8765/status_history?node_id=example-local-trader&limit=20'
```

The dashboard uses the same endpoint for its Recent Status table.

Run configs can also opt into safe recent event summaries:

```yaml
runs:
  - id: example_plugin_runner
    path: paper_logs/example_plugin_runner
    recent_events:
      enabled: true
      max_rows: 5
```

This publishes bounded decision/order/fill summaries for the dashboard's
Recent Run Events table. It intentionally omits raw strategy `signal` and
`diagnostics` payloads, which may contain private strategy details.

## 9. Safe Remote Command Prototype

The command prototype keeps authority on the local machine. The server stores
commands, and the local worker polls and enforces an allowlist. It does not
support arbitrary shell commands or broker order actions.

Queue a local test command:

```bash
curl -X POST http://127.0.0.1:8765/commands \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TRADING_STATUS_TOKEN" \
  -d '{"node_id":"example-local-trader","action":"summarize_run","params":{"run_id":"example_plugin_runner"}}'
```

Queue a local supervisor run from a configured supervisor ID:

```bash
curl -X POST http://127.0.0.1:8765/commands \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TRADING_STATUS_TOKEN" \
  -d '{"node_id":"example-local-trader","action":"run_supervisor_once","params":{"supervisor_id":"example_plugin_supervisor"}}'
```

Poll once from the local machine:

```bash
python3 scripts/command_worker.py \
  --config config/remote_control.example.yaml \
  --token-env TRADING_STATUS_TOKEN \
  --once
```

By default the worker writes local audit records to
`paper_logs/remote_control/audit.jsonl`. Keep that enabled for real
deployments; it preserves local command history even if posting results to the
cloud endpoint fails. `scripts/publish_status.py` summarizes that audit file so
poll failures, command failures, and result-post failures are visible in the
dashboard.

The example worker config also limits command bursts with
`worker.max_commands_per_poll`. Commands over that local limit are rejected and
audited instead of being executed in the same sweep.

Supported example actions are `request_status`, `supervisor_status`,
`summarize_run`, `validate_config`, `validate_supervisor_config`,
`run_supervisor_once`, `pause_runner`, and `resume_runner`. `run_supervisor_once`
can launch configured local jobs and is only enabled when present in
`allowed_actions`; remove it for monitoring-only deployments. The example config
also requires `paper_logs/control/remote_commands.enabled` before launcher
actions run, so the local machine must be deliberately armed first. Pause/resume
writes or removes a local marker file. The generic plugin runner honors
`control.pause_marker` by recording paused decisions without evaluating the
strategy or submitting orders.
The dashboard and server validate action-specific parameters before queueing:
`summarize_run` needs `run_id`, `validate_config` needs `config_id`, and
supervisor actions need `supervisor_id`. Pending commands can be canceled from
the dashboard or by posting to `/commands/cancel`; canceling only applies before
the local worker has polled the command.
Set `server.token_env` in `config/remote_control.example.yaml` and
`publish.token_env` in `config/cloud_status.example.yaml` when using the
authenticated server. Store the token value only in the environment.

## 10. Paper/Live Safety

Start with dry-run or simulated fills. Paper trading still needs risk limits,
position checks, stale-data checks, order rejection handling, and a plan for
Gateway login/2FA interruptions.

Operational runbooks:

- `docs/ibkr_gateway_runbook.md`
- `docs/paper_trading_runbook.md`
- `docs/market_data_permissions_runbook.md`
- `docs/service_restart_runbook.md`
- `docs/failed_order_diagnosis_runbook.md`
- `docs/cloud_monitoring_deployment.md`

Before publishing or sharing your repo, run:

```bash
python3 scripts/public_readiness_audit.py
```
