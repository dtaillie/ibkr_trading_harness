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
simulated-paper, and explicitly confirmed IBKR paper modes. It also recognizes
`live` mode only as a guarded placeholder; public live execution is not
implemented.

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
explicit live-port override. For real broker sessions, set
`broker.expected_account_id` in your ignored local config to make the runner
verify the connected broker account before it submits any order. Set
`broker.require_expected_account_id: true` when a local config must not run
without that expected-account check.

Live mode deliberately fails closed in the public generic runner. A live config
must set `execution.enable_live_orders: true`,
`execution.require_order_approval: true`, `broker.account_mode: live`, and
`broker.expected_account_id`, and the command must pass
`--confirm-live-orders`; after those gates the public runner still exits before
execution because no live broker implementation is published.

Broker execution is selected with `broker.adapter`. The public runner ships
with `ibkr` for IBKR paper execution and `file` for local adapter plumbing tests
that persist cash, positions, and submitted order rows to local files. The
public capability registry also lists metadata-only future adapters such as
`schwab`; those entries document the boundary but fail validation if selected
for paper/live execution until a real adapter is implemented. The `file`
adapter fills at configured static prices and is not a market simulator or a
substitute for strategy validation. The file adapter also exposes a local
`account_id` so tests and demos can exercise the same expected-account gate
without connecting to IBKR.

The dashboard exposes public broker capability metadata through `/config_options`
and the Workbench Broker Boundary panel. Check that panel before paper mode: it
shows which adapters are executable, which are metadata-only future adapters,
which adapters require Gateway, which order types and sizing styles they
advertise, whether they expose account IDs for verification, whether they
persist local state, and which IBKR ports are treated as paper or live.

Before publishing a public copy or walkthrough, open Help > Boundary >
Publication Review Assistant. It turns the export manifest, consolidated
publish gate, dashboard setup story, local example evidence, cloud boundary,
private "never export" list, and manual review requirement into status cards
and copyable operator notes.

For long-running observation or paper sessions, enable the generic loop in an
ignored local config or pass `--loop`. Loop mode is restricted to `shadow` and
`paper`, reloads the latest data each interval, skips duplicate latest bars by
default, and can be bounded with `--max-loop-iterations` for smoke tests or
`--max-runtime-seconds` for wall-clock caps:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.yaml \
  --mode shadow \
  --loop \
  --loop-interval-seconds 60 \
  --max-runtime-seconds 3600
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
a percent of notional. Optional `sim_cost_models` can override those simulated
slippage/commission fields by venue or model when a plugin emits
`OrderIntent.metadata.venue`, `metadata.execution_venue`, `metadata.cost_model`,
or `metadata.sim_cost_model`; unmatched intents use the global settings. For
simulated shorts, `sim_short_borrow_bps_annual` sets a global annual borrow-fee
drag in basis points, and
`sim_short_borrow_bps_annual_by_symbol` can override that rate by symbol.
Configs can also set `execution.require_order_approval: true` for
simulated-paper or paper runs. In that mode, each executable order first writes
an `order_previews.jsonl` row with an `approval_id`, digest, estimated notional,
cash/equity context, and the expected local approval-file path. The runner
holds the order until either the run is launched with `--approve-orders` or a
matching approval file exists. To approve one held preview without globally
approving every order:

```bash
python3 scripts/approve_order_preview.py \
  paper_logs/example_plugin_runner/order_previews.jsonl

python3 live/plugin_runner.py \
  --config config/plugin_runner.yaml \
  --mode simulated-paper
```

For real paper workflows, set `execution.approval_dir` to a durable ignored
directory such as `paper_logs/control/order_approvals`. Avoid keeping approvals
inside a run directory that uses `runner.clean_output_dir: true`, because that
directory is intentionally refreshed before the next run. The dashboard's Run
Artifacts Order Previews table shows the same approval IDs/files and includes a
Copy command for the local helper when the artifact source file is available.
`--validate-only` checks the static parts of this config before a run starts.
Private strategy modules or factory functions can also expose
`validate_config(config, *, full_config=None)` or
`validate_strategy_config(config, *, full_config=None)` to reject missing or
mistyped strategy-specific settings before the runner loads data or connects to
a broker. Workbench plugin registries can also declare public-safe
`validation_rules` metadata for non-executable checks such as required fields,
at-least-one-of fields, and numeric comparisons; these rules are shown in
Plugin Field Help and enforced before saving or running a draft.
After a run, `scripts/summarize_plugin_run.py <run-dir>` prints decisions,
orders, fills, rejection reasons, final cash/equity, positions, return, max
drawdown, and the public-safe plugin contract from the generic JSONL artifacts.
When account timestamps are
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

Managed jobs can opt into a conservative `restart` policy. Set
`restart.on_exit: true` to relaunch a managed child after it exits, or set
`restart.on_stale_runner_status: true` with `restart.runner_status_path`,
`restart.max_status_age_seconds`, `restart.stop_grace_seconds`, and
`restart.max_restarts_per_hour` to terminate and relaunch a managed
plugin-runner job when its `runner_status.json` heartbeat goes stale. Leave
restart disabled for one-shot replay/fetch jobs.

To run the generic supervisor as a user-level systemd service, copy the example
config to an ignored local path and edit it before enabling the unit:

```bash
mkdir -p ~/.config/algo-trade ~/.config/systemd/user
cp config/plugin_supervisor.example.yaml ~/.config/algo-trade/plugin_supervisor.yaml
$EDITOR ~/.config/algo-trade/plugin_supervisor.yaml

cp ops/systemd/algo-trade-plugin-supervisor.service ~/.config/systemd/user/
systemctl --user daemon-reload
systemctl --user enable --now algo-trade-plugin-supervisor.service
systemctl --user status algo-trade-plugin-supervisor.service --no-pager
```

The service validates `~/.config/algo-trade/plugin_supervisor.yaml` before it
starts and uses the public repo as its working directory. Keep private strategy
commands and tuned configs only in the ignored local YAML.

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

Before hosting a receiver beyond localhost, open Operations Diagnostics and
read Cloud Deployment Readiness. It summarizes remote-monitor evidence,
command-audit integrity, local-only trading authority, authentication, network
boundary, retention, current alerts, and the remaining manual provider
hardening review.
Open Help > Boundary > Cloud Access Guide when deciding what belongs in the
cloud. It separates cloud checking from cloud running: hosted receivers can
display sanitized snapshots and queue audited low-risk requests, while the
local supervisor/runner keeps Gateway, data, credentials, private strategies,
and order authority on the trading machine.
On Operations Home, read Operations Evidence when the question is what proof is
available right now. It separates local runner/paper observation, Gateway/API
reachability, remote snapshots, command-audit integrity, control queue state,
alerts, and the next route to inspect.
In Operations Paper, the Observation Packet uses generic runner telemetry such
as latest bar/decision/account timestamps plus `next_check_time`,
`next_expected_decision_time`, and `next_check_reason` to show whether a
paper/shadow loop is actively waiting for its next evaluation or has already
stopped. Generic runner summaries also expose public-safe
`next_order_condition` and latest signal fields derived from allowlisted
`diagnostics.dashboard` keys, not raw strategy diagnostics.
Start with Paper Action Summary above those cards when you want the shortest
route to Gateway diagnostics, checklist review, Runs/Orders, Performance, or
the Gateway runbook.
Before queueing any command, open Operations Control and read Command Safety
Review. It summarizes target-node state, command risk classes, confirmation
requirements, pending/failed commands, audit integrity, retention, selected
action boundary copy, and fail-closed live-control actions.

Open `http://127.0.0.1:8765/` to view the dashboard. The Help page has a Start
Here panel that maps common questions to pages and links to allowlisted local
Markdown docs, including `docs/web_ui_runbook.md`, so the operating runbook is
available without browsing the source tree. The sidebar splits the workbench
into Overview, Performance, Data Library, Fetch Jobs, Workbench, Runs,
Operations, and Help views. Overview shows the current high-level state;
top-level views can also be opened directly with URL hashes such as
`#performance`, `#data`, `#fetch`, `#runs`, and `#help`.
The sticky topbar keeps mode, equity, status freshness, Gateway/API, visible
runs, saved-data count, and alerts in view while you move between pages.
Use Data Library Diagnostics > Catalog Scan Report when a saved symbol is
missing. It summarizes parser errors, unsupported/skipped files, scan caps,
Storage Audit visibility, and the next recovery action before the raw table.
Use Help Home's Guided Tour when you are learning the dashboard order. It walks
through current health, performance, saved data, simulation, run evidence, and
operations/public-boundary review, and marks each step ready, warning, or
blocked from the current public-safe dashboard state.
Use Help Task Navigator when the next action is unclear. It reads the current
public-safe dashboard state and links directly to monitoring, performance,
saved data, fetch recovery, simulation, run-event, operations, and publishing
boundary views. Use Help Home's Today's Performance Guide when Sharpe,
drawdown, or raw return is not enough context: it walks from Overview current
state to Performance Home, evidence chain, trades/orders, rollups, and Runs
verification using the same public-safe performance source the dashboard has
loaded. Use Help Home's Mode Guide when you need to know whether the current
result is replay, shadow, simulated paper, broker paper, or live. It reads the
selected source, latest telemetry mode, Gateway/API state, account snapshots,
and open-order events, then links to the evidence pages that prove the order
authority boundary.
Use the "I want to" task selector in the topbar when you know the job but not
the page, for example monitoring today's run, finding saved data, recovering a
fetch, building a simulation, checking runtime health, or publishing safely.
Use Quick Jump when you already know the page or focused lens but do not want
to type the hash route. The route strip above each page intro shows the current
page and lens; Page Home returns that page to its home lens, and Copy Link
copies the exact dashboard URL.
health checks, setup checklist items, open positions, and recent
decision/order/fill events. After a second successful refresh, Overview also
calls out new recent events, alerts, and terminal fetch-job changes since the
prior refresh. Performance summarizes the latest run or selected
artifact with equity, return, drawdown, exposure, an equity curve, drawdown
curve, daily return bars, and a calendar-style daily return heatmap when
account snapshots are available. It also shows the active source, mode, latest
account timestamp, open position count, and decision/order/fill/reject activity
above the charts. Run Artifacts account rows also show whether equity was
provided by the broker/simulator or estimated from cash plus priced positions,
and how many open positions had current prices. Use the Period selector to narrow artifact
charts and KPIs to today, week, month, 3 months, or all available snapshots.
Overview Home includes a Strategy Health Report that summarizes telemetry,
runtime loop, alerts/orders, execution state, account/positions, saved data,
Workbench readiness, and the next inspection action in copyable rows.
Performance Home also includes a Current Strategy Report that summarizes source
freshness, equity and return, risk, trades, execution issues, evidence depth,
and the next action in copyable plain-language rows.
Performance Action Summary above that report picks the first route across
missing source evidence, empty selected periods, execution issues, drawdown/risk
review, missing trade rows, missing rollups, benchmark context, and trade
inspection. The Current Scoreboard then gives the shortest readout of source,
today, recent, month, all-available return, drawdown, and readiness.
Use Performance Evidence beside it to see whether the selected result is backed
by account snapshots, fills, status-history rollups, an artifact, a summary, or
a benchmark overlay.
When sanitized fills are present, Performance also shows an open/closed trade
table, win/loss, average win/loss, and profit factor. Daily Run Rollups summarize
archived account artifacts by UTC day with return, equity, orders, fills,
rejects, and artifact drilldown; Period Rollups group the same archived rows by
month and year. Data Library shows
configured data roots, saved-data coverage, root-scan diagnostics, historical
previews, a Data Home Action Summary that chooses the next route across root
setup, scan caps, filters, replay blockers, fetch-output visibility, and
inspect/compare/workbench handoff, plus a Saved Data Preview Wall with summary
cards, sparklines, and direct Inspect/Compare/Workbench actions, and a shortlist with direct
Inspect, Filter, and Compare actions for the best currently visible files. Use Saved Data
Explorer in Browse
when you want the broad saved-data map first: it groups the bounded parsed
catalog by asset, source, bar size, storage session, quality, and
storage-contract state, then filters the saved-data table with one click. Data
Home also shows a Root Index count that infers candidate files and symbols from
configured-root filenames/paths without parsing every dataset, which is useful
when the parsed catalog looks too small. Use Root Index Browser to search that
candidate universe in the dashboard, route symbols into parsed-catalog search
or diagnostics, inspect a supported sample file, and copy sample paths. Use
the Root Index root cards to spot capped, unavailable, or unsupported-file
roots. Use Export Root Index CSV to review
that broader candidate universe offline. In the Browse lens, Symbol Visibility
updates as you type a ticker and explains whether the symbol is visible now,
hidden by facets, only present in the root index, or needs diagnostics/fetch
evidence. Start with Catalog Scope when a
symbol is missing or the catalog looks too small: it calls out empty scans,
scan-limit caps, filters hiding loaded rows, suggested roots outside
`dashboard.data_roots`, and quality/metadata review pressure, then offers Scan
Max Rows, Clear Filters, Browse Symbols, Diagnostics, Copy Root YAML, and
Refresh Catalog actions. Core dashboard status renders before expensive
saved-data scans finish; the catalog loads in the background and heavier
coverage/gap/storage diagnostics are lazy until the Data Diagnostics lens is
opened. In the Saved Data table, the Replay column is the quickest per-file
screen: it synthesizes quality, storage-contract metadata, missing intervals,
source timezone, and adjustment metadata before you inspect or simulate that
file. Use the Replay filter or Replay-first sort to screen large catalogs by
ready/review/blocked state. Use Storage Audit to compare CSV/parquet files on disk
against the catalog-visible rows, including suggested roots that are not
currently configured. Use Export Audit CSV to download that root-by-root
comparison for offline review; the audit includes per-root scan duration so
large or slow roots are visible, plus asset, source, bar-size, and
storage-session breakdowns so mixed RTH, extended-hours, and 24/7 roots are
easier to spot. Use Export Scan CSV in Catalog Scan
Diagnostics to download configured-root parser errors, unsupported-file counts,
catalog caps, scan durations, and skipped-file samples. Use the coverage grid
to see recent date-bin
coverage by symbol, or Export Coverage CSV to download symbol/date coverage
rows for offline review. Use Export Gap CSV to download aggregate timestamp-gap
and calendar-gap rows. The Minute Coverage Heatmap shows both per-file UTC hour
strips and bounded worst date/hour strips for missing intraday intervals. Use
Export Minute CSV to download intraday hour, date/hour, and date/hour-matrix
completeness rows. Use Export Compare CSV after Compare Saved Data to
download normalized close-return paths by symbol and timestamp. Use Export
Range CSV in Data Detail to download the selected saved-file date range with
normalized UTC timestamps and original file columns. Use Find Missing Symbol to diagnose whether a ticker is visible,
outside the catalog limit, in an unconfigured root, malformed, only present in
fetch errors, or absent. Use Jump to Symbol in Data Detail to open the
catalog's best matching saved file for a ticker without searching the full
table. Use Symbol Directory to search and sort discovered symbols by files,
rows, latest data, symbol, or quality, then jump directly to filter, inspect,
compare, or diagnose actions. Use Symbol Coverage Ledger for the same filtered
symbol set as a compact range/readiness table with direct Inspect, Filter, and
Compare, and Workbench actions; Export Ledger CSV downloads that current table.
Use Export Symbols CSV to download the same
server-owned symbol universe summary with file counts, row counts, sources,
bar sizes, quality counts, ranges, and the best inspectable file for each
symbol. Use Historical Inventory Evidence on Data Home when you need one
copyable proof chain for what is parsed, what the root index sees on disk, what
the saved-history matrix can replay, what filters hide, and which root/fetch
condition to check next. Use Saved History Matrix to see the historical-bar
inventory by asset, source, bar size, and session before searching a ticker;
each row can filter Browse to that slice, open the best file, compare the
group, or send the group to Workbench. The matrix assistant names the best
starting group, readiness, active scope, and next action before the table.
Export Matrix CSV downloads the grouped inventory.
Symbol Browser's Selected Symbol strip summarizes the active symbol,
selected saved file, coverage, and quality, with one-click Filter, Inspect,
Workbench, Compare, and Diagnose actions. Use Copy data_roots YAML when Data Library finds
suggested roots; paste the copied `dashboard.data_roots` block into an ignored
local config and remove any paths you do not want scanned. For large roots, use
Catalog Page Previous/Next to move through bounded catalog slices; Export CSV
downloads the currently loaded page. Fetch Jobs shows
historical-data pull manifests, status counts, retry/pacing summaries, no-data
chunks, errors, produced output files, per-symbol progress, and output paths.
Start with Fetch Progress Review when a pull is running, partial, or failed:
it summarizes active jobs, partial/failed manifests, symbol/chunk progress,
ETA, rolling pace, retry/pacing pressure, output visibility, recovery state,
and the focus job before the dense table.
Read Fetch Action Summary first when you only need the next action. It
prioritizes active fetches, failed/no-data/retry recovery, output-root
visibility issues, selected output handoff, and filtered job state, then links
to Jobs, Detail, Data Library, or Workbench.
The Jobs table Activity column and Fetch Detail Last Activity row show the
latest manifest event/progress timestamp and source, so active fetch freshness
can be checked from the dashboard or CSV export without opening logs.
Read Fetch Evidence beside it when an output looks missing or unusable: it
separates root evidence, loaded manifests, recovery pressure, output visibility,
selected-detail evidence, and the next verification action.
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
visible produced file paths for local scripts. Use Compare Outputs to load two
or more Data Library-visible fetch outputs into Compare Saved Data with the
manifest date window. Use Export Detail CSV to download the selected fetch
job's symbol, output, error, retry, and pacing rows with output visibility
annotations.
Fetch Detail's Resume Scope summarizes what a copied resume command is expected
to skip versus retry or review, so failed fetch recovery is not just a copied
shell command with hidden intent. The fetch manifest detail API and CSV export
also include the backend-generated `resume_command`, so copied dashboard
commands and offline exports point at the same manifest file.
Runs shows searchable saved-run comparisons, recent run-event telemetry,
current managed positions, and recent non-terminal order events when runners
publish them. Runs Home includes an Action Summary that prioritizes open
orders, execution issues, positions, fills/results, quiet runners, and artifact
loading, then links to the focused State, Events, Run Search, Performance, or
Workbench Artifacts view. Runs Home and Runs Events include a copyable Event
Flow Report that summarizes filters, execution issues, decision/order/fill
mix, latest event, run/symbol coverage, and the next inspection action before
dense event rows. Operations shows node health, Gateway reachability,
supervisors, remote-control audit health, alerts, queued commands, and command
results. Operations Action Summary picks the first operational route across
paper readiness, Gateway/API, remote-node freshness, command audit/control
queue, and local alerts before the deeper readiness and evidence panels. The
Supervisor Action Summary sits above the supervisor table and summarizes local
supervisor/job state, stale heartbeats, failed or paused jobs, and pause/restart
marker availability before preparing `supervisor_status` or `run_supervisor_once`
controls. The
Remote Monitor Report summarizes remote node coverage, heartbeat,
Gateway/API state, alerts, open orders, stale data/account timestamps, and next
actions in copyable rows before the remote-node table. After selecting a node,
Remote Node Health Report summarizes that node's heartbeat, Gateway/API,
account/data feed age, run health, activity, bounded artifact evidence, cloud
boundary, and next action in copyable rows. It also shows read-only
workbench state for saved draft count, run
count, archived artifact count, local disk usage, and the latest saved run.
Generic plugin-runner runs write `runner_status.json`,
`performance_rollups.json`, and `plugin_contract.json` beside `summary.json`.
`runner_status.json` is a small heartbeat/status artifact with the current
lifecycle state, loop/session metadata, counters, dedicated latest bar and
latest rejection fields, and final result pointers. `plugin_contract.json` is public-safe metadata about the
plugin spec/name, data symbols, runner mode, supported order types, observed
dashboard keys, and artifact files; it intentionally omits raw strategy signal
payloads and local data-file paths. Each run also carries durable daily,
monthly, and yearly account-equity summaries in addition to dashboard-level
status rollups. Runs loads those rows in Runner Rollups / Runner Period
Rollups, and Export JSON includes the sanitized status, contract, and rollup
artifacts.
Use Export Status CSV from Performance when you want live/paper status-history
daily, monthly, and yearly equity rollups outside the dashboard.
Use Performance Rollups' Status Rollup Continuity panel before trusting those
period stats. It summarizes latest snapshot age, observed versus missing
calendar days, snapshot density, node/mode mix, Gateway-down rows, alerts, and
rejections.
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
example nginx/Caddy reverse proxies, UFW host-firewall rules, and AWS,
DigitalOcean, GCP, and Azure network-boundary sketches. For internet-facing
receivers, pair `ops/cloud/sync-command-audit.example.sh` with a separate
retention target; AWS S3 Object Lock, Google Cloud Storage Bucket Lock, and
Azure Blob immutability sketches live under `ops/cloud/`.
The `dashboard.data_roots` list in `config/cloud_status.example.yaml` controls
which CSV/parquet roots are scanned. The public example points only at
`examples/data`. For a real local setup, copy the config to an ignored local
file and add roots such as `cache`, `cache/ibkr`, or your historical-data
directory. You can also repeat `--data-root` on the command line to override the
config for one run. If Data Library only shows the public SPY/QQQ examples,
read Data Inventory, Historical Inventory Evidence, Universe Coverage, Data
Visibility Report, and Catalog Scope first. Compare Root Index counts with
parsed catalog counts to see whether configured roots contain more candidate
files than the quality catalog loaded. Then check whether the current Rows to
scan limit, active filters, parser skips, missing fetch outputs, or
unconfigured roots are hiding data, and review the root cards: the dashboard
will call out likely local roots that
exist but are not currently configured.
Data roots are scanned locally; the dashboard receives coverage summaries and
small downsampled previews, not full bar files.
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
Use the row's Replay cell first when scanning many files; it combines the
catalog's quality, storage-contract, missing-interval, timezone, and adjustment
metadata into one readiness callout. The same readiness state is available as a
Browse filter, a Replay-first sort, and a Saved Data Explorer group.
Fetch Detail output rows show the same Replay readiness when a produced file is
Data Library-visible, making completed fetch output review possible before
Workbench handoff.
Use Saved Data Explorer before choosing a row when you do not yet know which
symbol or source matters; it shows whether the parsed local catalog is mostly
stocks, crypto, 1-minute bars, 5-minute bars, RTH files, 24/7 files, or
warning-heavy metadata. If the parsed catalog is capped, start with Data
Home's Action Summary and Root Index count before concluding that other symbols
do not exist on disk.
Use Compare Saved Data to select several catalog-visible datasets and overlay
their normalized close-return paths over one requested date range. Start with
Compare Action Summary above the form; it recommends selecting shown or
symbol-matched files, fixing overlap, running Compare, reviewing warnings,
sending the compared window to Workbench, or exporting loaded paths. Use Find
Dataset to filter a large catalog by symbol, source, bar size, quality, or
path; selected datasets stay visible while filtering. Select Symbol chooses
exact catalog matches for the typed symbol, Select Shown chooses the visible
comparison set up to the dashboard's 8-dataset comparison cap, and Clear
removes the current selection. This is offline and only reads CSV/parquet files
under configured data roots. Use Copy Compare JSON to copy the exact
`/data_compare` request body for scripts, notes, or reproducible offline
reviews.
Use the Compare Range Preset control to set full selected range, common
overlap, or recent overlap windows before manually tuning Start/End.
Use Symbol Profile when you want a ticker-first view: it summarizes the
selected symbol's saved files, coverage, quality, best file, compact best-file
preview chart, and direct Inspect, Workbench, Compare, Filter, and Diagnose
actions before the dense catalog table.
The catalog header summarizes quality counts, bar-size counts, catalog scope
status, capped-root count, total rows, and total local file size. Use the
search, quality, and bar-size filters to narrow
larger local data roots. Use Export CSV to download the saved-data coverage and
quality summary without exporting full bar data. From Data Detail, Export
Range CSV downloads the selected date range as bounded bar data, while Export
Missing CSV downloads inferred missing expected timestamps for the selected
saved file so gap audits can be reviewed offline.
Start with Data Detail Action Summary before tuning the wide viewer controls:
it chooses between opening the typed symbol's best file, fixing catalog/root
visibility, reloading the selected range, focusing the largest gap, sending the
file to Workbench, comparing sibling files, or exporting the range.
Data Detail also has quick range presets for full file, last day, last week,
last month, and last three months before manual Start/End tuning. Its range
stats show close return, OHLC high/low span, open-to-close move, candle
direction balance, volume, gaps, and sampling state before the lower metadata
tables. Returned gaps are shaded on the line/candlestick chart, with a compact
legend showing how many returned gaps are visible in the current chart window.
The Config Builder section can generate and validate plugin-runner YAML from
one or more selected saved datasets. Public exports offer generic no-edge
examples by default; local ignored plugin registries can add private plugin
metadata for your own machine without publishing strategy logic. Workbench Home
includes an Example Config Gallery that lists public examples and ignored local
plugin availability before the full Builder form, an Action Summary and Stage
Summary that show current workflow stage, blockers, data, alignment, draft, run,
results, and next route, plus Workbench Evidence that labels the current
workflow as data-only, draft-only, run-backed, or loaded-artifact-backed. Gallery actions only populate
plugin/mode fields; they do not save drafts or run simulations. The Workbench
Artifacts lens starts with Artifacts Action Summary, which routes available or
loaded runs to latest-artifact loading, Performance, Runs, bounded logs, JSON
export, or Run Draft before the dense artifact tables. The Workbench
can render public-safe `strategy_fields` from that plugin metadata and writes
those allowlisted values into the generated `strategy` section. It rejects
unknown strategy keys and enforces public-safe field metadata such as required,
numeric min/max, and select choices before saving or validating drafts. Field
metadata can include display-only descriptions, placeholders, units, affixes,
advanced labels, ordering, and select-option descriptions. Keep real edge,
tuned defaults, and private-only parameters in ignored local registries. The
Workbench uses replay/shadow/simulated-paper modes; it does not submit broker
orders.
Selected Data Packet includes a coverage ledger for the chosen saved files:
review source, bar size, storage session, ranges, rows, replay readiness, and
Export Selected Data CSV before generating a draft.
Duplicate symbols and duplicate paths are rejected before YAML is saved.
Risk presets fill example guardrail and simulated-cost fields, but the fields
remain editable and the presets are not trading recommendations.
Generated drafts include a Data Alignment section with common timestamp count,
overlap coverage, common range, per-symbol timestamp counts, and cadence or
overlap warnings. You can preview that alignment before saving a draft.
Use Preview Draft to run the same validation and inspect generated YAML,
alignment, plugin boundary, and local commands without writing a file. Enable
Save draft locally and use Generate / Save only after the preview looks
acceptable.
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
Workbench Run's Draft Inventory Review gives the same inventory as a
first-screen decision aid: folders, status labels, tags, validation coverage,
runnable drafts, selected-draft state, latest runs, and the next action before
the draft/run tables.
Use Delete on a saved draft row to remove only that saved YAML; run archives and
workbench output directories are handled separately by Workbench Maintenance.
Saved drafts can then be validated, replayed, or simulated-paper-run from the
dashboard with bounded `max_steps` and timeout controls, and recent workbench
run results are shown below the draft list. Use Inspect on a saved draft or run
row to review summarized `summary.json`, decisions, orders, fills, account
snapshots, return, drawdown, elapsed time, time-normalized return projections,
gross/net exposure, max position count, and an equity curve. The artifact view
intentionally omits raw strategy signal payloads. Runs Events can also review
public-safe execution-quality fields from recent status or loaded artifacts:
decision/submit bid/ask, order type, limit/cap price, fill time, average fill,
effective spread evidence, and missed/rejected/canceled/held order rate. If
those fields are missing, treat that as a runner/broker instrumentation gap, not
as proof of good execution. The generic plugin runner can publish
runner-estimated bid/ask around the latest bar close when
`execution.sim_quote_spread_bps` or `execution.quote_spread_bps` is configured;
that gives public-safe review coverage, but it is not broker-native NBBO. If a
plugin wants public-safe strategy drilldowns in the dashboard, publish only
sanitized fields under
`StrategyDecision.diagnostics["dashboard"]`; the dashboard allowlists fields
such as `signal_label`, `signal_value`, `threshold`, `threshold_distance`,
`near_threshold`, `expected_hold_minutes`, `active_exit_rule`, `exit_state`,
`stop_state`, `mae_pct`, and `mfe_pct`. Plugin registry rows can also declare
`validation_rules` for public-safe required/require-any/comparison checks, and
`result_fields` for public-safe `diagnostics.dashboard` keys so Run Artifacts
can label and format those values without exposing private strategy logic.
Result fields support public-safe `kind`, `decimals`, `prefix`, `suffix`, and
`unit` hints for artifact display. Registry rows can also declare
`result_sections` to group declared result fields into public-safe artifact
cards without exposing private signal logic, and `result_widgets` to request
card, table, bar-summary, sparkline, line-chart, or allowlisted declarative
custom-chart artifact displays. The
artifact view also summarizes declared result-field, section, and widget
coverage and flags sanitized dashboard keys that were emitted without registry
labels, helping you see whether a private plugin is publishing the public
diagnostics you expect. For
open-position cards, plugins can
also publish public-safe per-symbol fields under
`diagnostics.dashboard.position_details` or
`diagnostics.dashboard.position_metadata`; the generic runner keeps only
allowlisted values such as entry time/price, current price, hold window,
active exit rule, stop/target, and MAE/MFE for currently open symbols.
Successful non-validate runs
also archive a local per-run artifact snapshot, so a comparison row can inspect
that exact run even after a later run overwrites the draft's output directory.
Use Log on a run row to inspect command argv, return code, duration, and
stdout/stderr tails for the exact run. The same view calls
`/config_draft_run_evidence` to show execution evidence cards, bounded log
stats, and the expected artifact-file manifest (`summary.json`,
`runner_status.json`, `plugin_contract.json`, JSONL decision/order/fill/account
files, and related rollups).
When validating a run from the dashboard, open Runs Home and read Runs Evidence
before the dense tables. It separates current run source, recent
decision/order/fill rows, execution issues, account-boundary evidence, loaded
artifact rows, active filters, and the next verification route.
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

The status publisher also classifies bounded recent `orders.jsonl` rows into
public-safe order-state alert categories, including approval-required,
broker-login/session, broker-API disconnect, inactive, cancelled, rejected, and
risk-limit cases. It reports counts and the latest sanitized symbol/status/reason
for those categories without publishing raw broker logs or private strategy
diagnostics.

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
dashboard. Local worker audit rows are hash-chained as they are appended, and
the status publisher verifies the chain on each publish using
`remote_control.audit.max_integrity_records` from the status config. Operations
shows the local integrity state beside remote-control freshness and raises a
warning if the local audit chain is broken or unreadable.
For each fetched command, the worker writes a sanitized `command_received` row
before local execution and a `command_result` row after execution/post-result
handling. The received row stores command id, node, action class, status, and
parameter names only, not parameter values.

For stronger local tamper evidence, set `audit.signature_env` in the command
worker config and set the same env var name as
`remote_control.audit.signature_env` in the status publisher config. The worker
then adds an HMAC-SHA256 signature to each local audit row, and the publisher
reports signed, unsigned, missing-key, or bad-signature state in Operations.

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
`flatten_simulated_positions`, `restart_child_process`,
`run_supervisor_once`, `pause_runner`, and `resume_runner`.
Reserved high-risk action names such as `flatten_live_positions`,
`change_strategy_config`, and `enable_live_orders` are rejected by both the
public receiver and local worker even if someone tries to add them to
`dashboard.command_scopes` or `allowed_actions`.
`flatten_simulated_positions` only operates on configured file-backed local
broker state. `restart_child_process` writes a configured supervisor job
restart marker and lets the local supervisor own the process restart.
`run_supervisor_once` can launch configured local jobs and is only enabled when
present in `allowed_actions`; remove it for monitoring-only deployments. The
dashboard receiver must also allow the action class or action through
`dashboard.command_scopes`. The example config also requires
`paper_logs/control/remote_commands.enabled` before launcher actions run, so
the local machine must be deliberately armed first. Pause/resume
writes or removes a local marker file. The generic plugin runner honors
`control.pause_marker` by recording paused decisions without evaluating the
strategy or submitting orders. It also honors `control.stop_marker` in loop
mode by exiting cleanly and writing `stopped_by_control` in `summary.json` and
`runner_status.json`.
The dashboard and server validate action-specific parameters before queueing:
`summarize_run` needs `run_id`, `validate_config` needs `config_id`, and
supervisor actions need `supervisor_id`. Pending commands can be canceled from
the dashboard or by posting to `/commands/cancel`; canceling only applies before
the local worker has polled the command.
Operations Control's Supervisor Action Summary can fill the current supervisor
ID and selected action for `supervisor_status` or `run_supervisor_once`, but it
does not queue the command; review the boundary copy and submit explicitly.
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

Use the service restart runbook for local systemd units, hosted receiver
containers, Fly/Render redeploys, reverse-proxy reloads, and duplicate-runner
checks.

Before publishing or sharing your repo, run:

```bash
python3 scripts/public_readiness_audit.py
```
