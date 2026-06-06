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
Resume a failed or partial stock fetch from a manifest:

```bash
python3 live/fetch_history.py \
  --resume-manifest paper_logs/fetch_manifests/example_stock_manifest.json
```

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

The dashboard exposes public broker capability metadata through `/config_options`
and the Workbench Broker Boundary panel. Check that panel before paper mode: it
shows which adapters require Gateway, which order types and sizing styles they
advertise, whether they persist local state, and which IBKR ports are treated as
paper or live.

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

Loop configs can also define `runner.session` with an IANA timezone, local
`start`/`end`, weekdays, and `outside_session: idle`. When the latest data
timestamp is outside that window, the runner writes an idle decision artifact
instead of calling the plugin or broker, so the dashboard can show that the
runner is intentionally waiting rather than broken.

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
a percent of notional. For simulated shorts, `sim_short_borrow_bps_annual` sets
a global annual borrow-fee drag in basis points, and
`sim_short_borrow_bps_annual_by_symbol` can override that rate by symbol.
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
job-level `pause_marker` lets the safe command worker pause scheduled launches;
`stop_marker` lets looped plugin-runner jobs exit cleanly on their next loop
check.

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

Open `http://127.0.0.1:8765/` to view the dashboard. The Help page has a Start
Here panel that maps common questions to pages and links to allowlisted local
Markdown docs, including `docs/web_ui_runbook.md`, so the operating runbook is
available without browsing the source tree. The sidebar splits the workbench
into Overview, Performance, Data Library, Fetch Jobs, Workbench, Runs,
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
configured data roots, saved-data coverage, root-scan diagnostics, historical
previews, and a Data Home shortlist with direct Inspect, Filter, and Compare
actions for the best currently visible files. Use Storage Audit to compare CSV/parquet files on disk
against the catalog-visible rows, including suggested roots that are not
currently configured. Use Export Audit CSV to download that root-by-root
comparison for offline review; the audit includes per-root scan duration so
large or slow roots are visible. Use Export Scan CSV in Catalog Scan
Diagnostics to download configured-root parser errors, unsupported-file counts,
catalog caps, scan durations, and skipped-file samples. Use the coverage grid
to see recent date-bin
coverage by symbol, or Export Coverage CSV to download symbol/date coverage
rows for offline review. Use Export Gap CSV to download aggregate timestamp-gap
and calendar-gap rows. Use Export Minute CSV to download intraday hour and
date/hour completeness rows. Use Export Compare CSV after Compare Saved Data to
download normalized close-return paths by symbol and timestamp. Use Export
Range CSV in Data Detail to download the selected saved-file date range with
normalized UTC timestamps and original file columns. Use Find Missing Symbol to diagnose whether a ticker is visible,
outside the catalog limit, in an unconfigured root, malformed, only present in
fetch errors, or absent. Use Jump to Symbol in Data Detail to open the
catalog's best matching saved file for a ticker without searching the full
table. Use Symbol Directory to search and sort discovered symbols by files,
rows, latest data, symbol, or quality, then jump directly to filter, inspect,
compare, or diagnose actions. Use Export Symbols CSV to download the same
server-owned symbol universe summary with file counts, row counts, sources,
bar sizes, quality counts, ranges, and the best inspectable file for each
symbol. Use Copy data_roots YAML when Data Library finds
suggested roots; paste the copied `dashboard.data_roots` block into an ignored
local config and remove any paths you do not want scanned. Fetch Jobs shows
historical-data pull manifests, status counts, retry/pacing summaries, no-data
chunks, errors, produced output files, per-symbol progress, and output paths.
Use Compare from Symbol Browser to preselect matching saved files for a ticker
and immediately load the normalized saved-data comparison chart.
The Fetch Workflow checklist turns that manifest state into next actions:
configure roots, load jobs, review failures, inspect outputs, open saved data,
and recover or export the selected job.
Use Export Jobs CSV to download recent fetch-job summaries for offline review
of failed jobs, progress/ETA fields, pacing waits, retries, rows, and latest
output paths.
When a produced output file is under a configured data root, use Inspect Data in
the output row to open its saved-file detail view without leaving the dashboard.
Use Show Outputs in Data Library from Fetch Detail to filter saved-data rows to
the files produced by the selected fetch job, or Copy Output Paths to copy the
visible produced file paths for local scripts. Use Export Detail CSV to
download the selected fetch job's symbol, output, error, retry, and pacing rows
with output visibility annotations.
Fetch Detail's Resume Scope summarizes what a copied resume command is expected
to skip versus retry or review, so failed fetch recovery is not just a copied
shell command with hidden intent.
Runs shows searchable saved-run comparisons, recent run-event telemetry,
current managed positions, and recent non-terminal order events when runners
publish them. Operations shows node health, Gateway reachability,
supervisors, remote-control audit health, alerts, queued commands, and command
results. It also shows read-only workbench state for saved draft count, run
count, archived artifact count, local disk usage, and the latest saved run.
Generic plugin-runner runs write `performance_rollups.json` beside
`summary.json`, so each run carries durable daily, monthly, and yearly
account-equity summaries in addition to dashboard-level status rollups. Runs
loads those rows in Runner Rollups / Runner Period Rollups, and Export JSON
includes the sanitized rollup artifact.
Use Export Status CSV from Performance when you want live/paper status-history
daily, monthly, and yearly equity rollups outside the dashboard.
The dashboard also persists the latest sanitized status rollups under
`paper_logs/cloud_status_server/status_equity_rollups/` as JSON snapshots, with
`latest_all.json` for all nodes and `latest_<node>.json` for node-filtered
views. Use `/status_equity_rollups_snapshot` when external tooling needs the
latest saved rollup artifact instead of recomputing from `status_history.jsonl`.
Use Export Audit CSV from Operations when you want sanitized command audit rows
plus hash-chain and signature status outside the dashboard.
Use Export Snapshot from Workbench State to download a public-safe JSON bundle
of setup diagnostics, saved-data metadata, config options, and recent run
summaries.
Run `python3 scripts/smoke_dashboard.py` to start a temporary dashboard server
and verify dashboard assets plus the core public endpoints without posting
broker data.
For real deployments, add `max_age_seconds` to configured runs, supervisors, or
remote-control audit settings in `config/cloud_status.example.yaml` copies so
stale local artifacts raise dashboard alerts.
For a hosted receiver, use `config/cloud_status_hosted.example.yaml` with
`ops/cloud/status-receiver.compose.example.yaml` and publish from the trading
machine with `ops/systemd/algo-trade-status-publisher.timer`. Keep the hosted
receiver behind HTTPS or a private VPN and keep broker credentials on the local
machine. Hosted configs can also set `dashboard.network_access` to restrict
direct receiver clients to localhost, VPN, or known management networks. See
`docs/cloud_monitoring_deployment.md` for the full deployment shape, including
example nginx/Caddy reverse proxies, UFW host-firewall rules, and an AWS
security-group sketch.
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
want fetch jobs visible. Use Copy fetch_manifest_roots YAML in Fetch Jobs to
copy a ready-to-paste local config block for the roots currently visible to the
dashboard.
Use Inspect on a saved dataset row to load a local-only detail view with a
range-filtered sampled or full-in-range price path, volume bars, timestamp
coverage, gap rows, null counts, price/return stats, volume stats, and a
compact ok/warn/bad quality summary.
Use Compare Saved Data to select several catalog-visible datasets and overlay
their normalized close-return paths over one requested date range. Use Find
Dataset to filter a large catalog by symbol, source, bar size, quality, or path;
selected datasets stay visible while filtering. Select Symbol chooses exact
catalog matches for the typed symbol, Select Shown chooses the visible
comparison set up to the dashboard's 8-dataset comparison cap, and Clear
removes the current selection. This is offline and only reads CSV/parquet files
under configured data roots. Use Copy Compare JSON to copy the exact
`/data_compare` request body for scripts, notes, or reproducible offline
reviews.
The catalog header summarizes quality counts, bar-size counts, total rows, and
total local file size. Use the search, quality, and bar-size filters to narrow
larger local data roots. Use Export CSV to download the saved-data coverage and
quality summary without exporting full bar data. From Data Detail, Export
Range CSV downloads the selected date range as bounded bar data, while Export
Missing CSV downloads inferred missing expected timestamps for the selected
saved file so gap audits can be reviewed offline.
The Config Builder section can generate and validate plugin-runner YAML from
one or more selected saved datasets. Public exports offer generic no-edge
examples by default; local ignored plugin registries can add private plugin
metadata for your own machine without publishing strategy logic. The Workbench
can render public-safe `strategy_fields` from that plugin metadata and writes
those allowlisted values into the generated `strategy` section. It rejects
unknown strategy keys and enforces public-safe field metadata such as required,
numeric min/max, and select choices before saving or validating drafts. Keep
real edge, tuned defaults, and private-only parameters in ignored local
registries. The Workbench uses replay/shadow/simulated-paper modes; it does
not submit broker orders.
Duplicate symbols and duplicate paths are rejected before YAML is saved.
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
Use Export Drafts CSV to download a saved-draft inventory with folder, status,
mode, plugin, symbols, tags, validation state, output directory, and local YAML
path.
Use Delete on a saved draft row to remove only that saved YAML; run archives and
workbench output directories are handled separately by Workbench Maintenance.
Saved drafts can then be validated, replayed, or simulated-paper-run from the
dashboard with bounded `max_steps` and timeout controls, and recent workbench
run results are shown below the draft list. Use Inspect on a saved draft or run
row to review summarized `summary.json`, decisions, orders, fills, account
snapshots, return, drawdown, elapsed time, time-normalized return projections,
gross/net exposure, max position count, and an equity curve. The artifact view
intentionally omits raw strategy signal payloads. If a plugin wants public-safe
strategy drilldowns in the dashboard, publish only sanitized fields under
`StrategyDecision.diagnostics["dashboard"]`; the dashboard allowlists fields
such as `signal_label`, `signal_value`, `threshold`, `threshold_distance`,
`near_threshold`, `expected_hold_minutes`, `active_exit_rule`, `exit_state`,
`stop_state`, `mae_pct`, and `mfe_pct`. Successful non-validate runs
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
Recent Run Events table. It intentionally omits raw strategy `signal` and raw
`diagnostics` payloads, which may contain private strategy details. Only
explicit public-safe `diagnostics.dashboard` fields are eligible for dashboard
drilldowns.

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

That launcher example requires both server-side scope opt-in
(`dashboard.command_scopes`) and local worker opt-in (`allowed_actions` plus the
local enable marker). Without those, the receiver or worker rejects it by
design.

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

The receiver also keeps a sanitized server-side audit at
`paper_logs/cloud_status_server/command_audit.jsonl` and exposes it through
`/command_audit` and `/command_audit_export`. The example dashboard config
rate-limits command queue requests per node with `dashboard.command_rate_limit`;
rejected queue attempts are audited and return HTTP 429. Explicit `command_id`
values must be unique, so retried queue requests cannot ambiguously map later
results to older commands. The receiver also checks `dashboard.command_scopes`
before queueing: public examples allow read-only and pause/resume control
commands, while launcher actions such as `run_supervisor_once` require an
explicit server-side opt-in. Hosted configs can also define
`dashboard.auth_tokens` so a monitoring token can read status and queue only
read-only commands while a separate operator token can queue pause/resume
control commands.
Command audit rows are hash-chained as they are appended. `/command_audit`
returns an `integrity` summary so the dashboard can flag missing legacy hashes
or modified rows. For hosted receivers, set
`dashboard.command_audit_signature_env` to an environment variable containing an
HMAC secret, for example `TRADING_COMMAND_AUDIT_HMAC_KEY`. New audit rows will
include `row_signature`, and the Operations page will report whether signatures
are disabled, valid, unsigned, missing their key, or failing verification. Keep
the HMAC value in the service environment, not in config or source control.

Supported example actions are `request_status`, `supervisor_status`,
`summarize_run`, `validate_config`, `validate_supervisor_config`,
`run_supervisor_once`, `pause_runner`, and `resume_runner`. `run_supervisor_once`
can launch configured local jobs and is only enabled when present in
`allowed_actions`; remove it for monitoring-only deployments. The dashboard
receiver must also allow the action class or action through
`dashboard.command_scopes`. The example config also requires
`paper_logs/control/remote_commands.enabled` before launcher actions run, so
the local machine must be deliberately armed first. Pause/resume
writes or removes a local marker file. The generic plugin runner honors
`control.pause_marker` by recording paused decisions without evaluating the
strategy or submitting orders. It also honors `control.stop_marker` in loop
mode by exiting cleanly and writing `stopped_by_control` in `summary.json`.
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
