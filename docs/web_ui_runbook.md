# Web UI Runbook

This runbook explains how to operate the local dashboard without exposing
private strategy logic, account IDs, credentials, or runtime logs.

## Start the Dashboard

Use the public example config for a small demo setup:

```bash
python3 scripts/cloud_status_server.py --config config/cloud_status.example.yaml
```

For real local use, copy the example config to an ignored local file and add
your private data roots:

```bash
python3 scripts/cloud_status_server.py --config config/cloud_status_local.yaml
```

To keep the local dashboard receiver running under systemd and restart it onto
the current checkout after code changes, install the user service:

```bash
scripts/install_dashboard_server.sh
systemctl --user restart algo-trade-dashboard-server.service
```

To install the dashboard receiver plus a once-per-minute status publisher timer
for this checkout, use:

```bash
scripts/install_local_monitoring_stack.sh
```

Add `--with-command-worker` only after reviewing the remote-control allowlist
and local enable-marker rules.

Open `http://127.0.0.1:8765/`. Top-level pages can be deep-linked with hashes
such as `#overview`, `#performance`, `#data`, `#fetch`, `#workbench`,
`#runs`, `#operations`, and `#help`.

## Publish Current Runtime Status

If the dashboard opens but says disconnected or no data while a runner is
active, check whether the runner is writing the generic dashboard artifacts:
`summary.json`, `runner_status.json`, `decisions.jsonl`, `orders.jsonl`,
`fills.jsonl`, and `account.jsonl`. Older/local runners may instead write CSV
session folders. Bridge those folders into the generic contract before
publishing status:

```bash
python3 scripts/build_runtime_status_bridge.py
python3 scripts/publish_status.py --config config/cloud_status_local.yaml
```

The published `/status` payload includes separate fields for broker reachability
and runtime activity. `gateway.reachable=true` only proves that the dashboard can
open a socket to Gateway/API. `runtime_activity` summarizes whether a supervised
child is running, a job is due, a start window was missed, fresh run telemetry
exists, or the system is idle until the next window. Use Overview's Runtime
Activity card or Operations > Paper before assuming the strategy loop is
actively streaming/evaluating.

Treat market-data health as a third separate check. A runner can connect to
Gateway and still publish `market_data_health.status=bad` if IBKR returns no
usable bars or live prices. For crypto runners, inspect
`market_data_health.reason`, `historical_fetch.status_counts`,
`timeout_like_count`, and `skipped_after_timeouts_count`. The crypto runner
tries live snapshots first, then bounds the historical sweep with
`data.historical_request_timeout_seconds` and
`data.historical_max_consecutive_timeouts`, so repeated no-data responses should
show as explicit feed-health evidence instead of a long silent backend stall.
Remote Nodes and Remote Node Detail carry the bounded form of those fields as
`market_data_status`, `market_data_reason`, coverage counts, timeout-like count,
and skipped-after-timeouts count. Use the Feed column/card to distinguish a
broker/API outage from an authenticated session that is simply receiving no
usable market data.

For local monitoring, `config/cloud_status_local.yaml` should publish to the
same `dashboard.state_dir` read by `scripts/cloud_status_server.py`, commonly
`paper_logs/cloud_status_server/latest_status.json`, and can also post to the
local receiver endpoint:

```yaml
publish:
  file: paper_logs/cloud_status_server/latest_status.json
  endpoint: http://127.0.0.1:8765/status
```

Run the bridge/publisher from a user-systemd timer when you want the dashboard
to refresh while paper services run unattended.

Use the topbar task selector when you know the job but not the page: choose
items such as Monitor today's run, Find saved data, Build a simulation, Check
runtime health, or Publish safely. The dashboard routes that task to the
current best page/lens using the public-safe state it has loaded. Use Quick
Jump when you already know the destination; it lists every public page and
focused lens, including entries such as Data Inspect, Workbench Run,
Performance Trades, and Operations Remote. The topbar status strip keeps mode,
equity, status freshness, Gateway/API, visible runs, saved-data count, and
alerts visible while you move through pages. Each page also shows a route strip
above the intro. Page Home returns the current page to its home lens, and Copy
Link copies the exact page/lens URL for notes, runbooks, or another browser tab.

Open Help when you are not sure where to start. The Start Here panel maps the
main questions to pages: current health, performance, saved data, simulation,
run drilldowns, and operations diagnostics. The Current Setup Gaps panel is
state-aware: after refresh it points at missing telemetry, disabled or
unreachable Gateway checks, unreadable data roots, catalog caps, missing fetch
manifests, and missing Workbench drafts.
Use the Guided Tour on Help Home when you are learning the app from scratch. It
walks in order through current health, performance, saved data, simulation,
run evidence, and operations/public-boundary review, marking each step ready,
warning, or blocked from the current public-safe dashboard state.
The Help Task Navigator turns the current dashboard state into a copyable route
map for monitoring, performance, saved data, fetch recovery, simulation, run
events, operations, and public/private publishing boundaries. The Today's
Performance Guide answers "how is it doing today?" by summarizing the current
performance source, today/latest-session return card, evidence chain,
drawdown, trade/order proof, rollups, and the next verification route.

Every top-level page also starts with a compact workflow rail. Read it left to
right for the common path on that page before opening the deeper tables below.

In Data Library Diagnostics, read Catalog Scan Report before the raw scan
table. It summarizes root scope, parser errors, unsupported/skipped files,
catalog caps, Storage Audit visibility, and the next recovery action.

## Configure Data Roots

The dashboard only scans paths listed in `dashboard.data_roots`. Public example
configs should point at `examples/data`; local private configs can point at
cache/history folders.

If Data Library only shows SPY/QQQ examples:

1. Open Data Library.
2. Start with Action Summary, then read Data Inventory, Historical Inventory
   Evidence, Universe Coverage, Data Visibility Report, and Catalog Scope.
   Action Summary chooses the first route across root setup, scan caps, hidden
   filters, replay blockers, fetch-output visibility, and
   inspect/compare/workbench handoff. Compare Root Index counts with parsed
   catalog counts: if Root Index sees many more candidate files/symbols, the
   dashboard has found local files but the quality catalog is still a bounded
   parsed sample. If Catalog Scope says the scan is capped, use Scan Max Rows
   before deciding a symbol is missing. If filters hide everything, use Clear
   Filters.
3. Check Data Source Map for configured, suggested, hidden/capped,
   parser-error, unavailable, and not-scanned roots.
4. Use Find Missing Symbol for a ticker you expected to see.
5. Use Copy data_roots YAML to copy configured plus suggested roots.
6. Paste the `dashboard.data_roots` block into your ignored local dashboard
   config, removing any roots you do not want scanned.
7. Use Export Audit CSV if you want the root-by-root storage comparison,
   hidden-file counts, and scan-duration timings for offline review.
8. Refresh the dashboard.

The Data Library Home page also has workflow cards for Find A Symbol, Inspect
History, Compare Files, Build Simulation, Check Quality, and Fix Visibility.
Use those cards when you know the job you want but do not yet know which table
or diagnostic panel holds the answer.
Use Saved Data Explorer in the Browse lens when you want the broad map first:
it groups the bounded parsed catalog by asset, source, bar size, storage
session, quality, and storage-contract state, then lets you click a group to
replace the current Browse filters and jump to the matching table rows. On Data
Home, use Root Index first when the catalog looks too small; it counts
candidate files and symbols inferred from configured-root filenames/paths
without parsing every dataset. Use Root Index Browser to search those
loaded candidate symbols, inspect a supported sample file, jump into
parsed-catalog search, diagnose missing symbols, or copy sample paths. If the
Root Index says the scan is capped and the loaded candidates still do not
include a symbol you expect, enter a symbol/source/bar/session filter and click
Search Roots. That sends the filters to the server so large roots are searched
for matching filenames/paths instead of filtering only the first bounded batch.
The Root Index payload also includes `symbol_inventory.status` and
`symbol_inventory.reason`; Data Home uses those fields so a broad partial scan
such as "many symbols visible, but capped" is distinct from "no saved data
found." Root cards also mark nested or duplicate configured roots with
`covered_by_root` or `duplicate_of_root`. If a child root looks unscanned after
a parent root hits the cap, check whether the child is already covered by that
earlier parent scan before treating it as missing data.
Use Export Root Index CSV when you want the current broader or filtered
candidate-file and symbol summary outside the dashboard. Root Index rows are
filename/path inferred, so inspect parsed Data Detail quality before replay.
In the Browse lens, type a ticker into Symbol Browser and read Symbol
Visibility for ticker-specific detail. Use Historical Inventory Evidence before
deciding data is missing. It separates visible catalog rows, rows hidden by
active facets, root-index candidates that are on disk but not parsed into the
catalog, saved-history matrix readiness, root/scanner clues, and
diagnostic/fetch evidence, with direct actions for Browse, Matrix, Diagnostics,
Fetch Jobs, filters, root YAML, and Workbench.
The Root Index root cards show which configured roots were indexed, capped,
unavailable, or dominated by unsupported files.
Use Saved History Matrix when you want the concrete bar inventory first: it
groups visible saved files by asset, source, bar size, and session, then shows
symbol/file/row counts, coverage range, replay readiness, and a Browse action
for that slice. Matrix rows can also open the best file, compare the top files
in the group, or send the grouped selection to Workbench. The matrix assistant
summarizes the best starting group, replay readiness, compare/workbench
availability, active scope, and next action before the row table. Use Export
Matrix CSV to review the same grouped inventory outside the dashboard.
In the Saved Data table, use the Replay column as the first per-file screen.
It combines data quality, storage-contract metadata, missing-interval pressure,
source timezone, and adjustment metadata into one ok/warn/bad read before you
open Data Detail or send the file to Workbench. Use the Replay filter or
Replay-first sort when a large catalog needs to be reduced to ready, review,
or blocked files quickly.
Fetch Detail output rows show the same Replay readiness for Data
Library-visible files, so a completed fetch can be reviewed for replay
readiness before using Show Outputs In Data Library or Use Outputs In
Workbench.
Use Catalog Scope before browsing a large local universe. It summarizes loaded
files, scanned symbols, active filters, configured/suggested roots, data
readiness, top-level catalog scope status, capped/not-scanned root counts, and
whether the current Rows to scan limit may be hiding history. Use the Data Home
Root Index card beside it to tell whether there are more candidate files under
configured roots than the parsed catalog loaded.
Its actions can raise the scan to the configured maximum, clear filters, open
Browse or Diagnostics, copy root YAML, or refresh the catalog.
Large local caches can take tens of seconds to scan. The dashboard now renders
core status first, then loads the saved-data catalog in the background; the
heavier Coverage, Gap Summary, Minute Coverage, and Storage Audit scans start
when the Data Diagnostics lens is opened or explicitly refreshed.
When inspecting a single saved file, Data Detail now shows range stats above
the chart for close return, OHLC high/low span, open-to-close move, candle
direction balance, movement, volume, gaps, and sampling state before the lower
metadata and gap tables. The chart shades returned gap intervals and includes a
small legend/count so visible chart gaps can be reconciled with the table rows.
When comparing saved files, Compare Saved Data shows leader, laggard, return
spread, overlap, sampling, and warning stats above the chart before the
symbol/path table.

## Find Current Strategy Performance

Start in Overview. The hero card and Runtime Status strip answer whether a
runner is publishing telemetry, whether Gateway/API is reachable, what mode is
active, and when the latest decision/account/bar timestamps were published.
Generic plugin-runner status also includes latest rejected-order time, symbol,
status, and reason when an order is rejected.
When a run publishes `market_data_health`, Overview's Market Data card uses that
structured feed status before falling back to a timestamp. A bad feed status
should show the reason and symbol coverage, and Operations Alerts should include
`market_data_health_bad` or `market_data_health_warn`.
Read Strategy Health Report on Overview Home for the fastest copyable summary:
telemetry, runtime loop, alerts/orders, execution state, account/positions,
saved data, Workbench readiness, and the next inspection action.
The page intro strip changes with each top-level view and gives the fastest
next step plus the current public telemetry counts for that view.
Use the Overview Start Here cards as the main workflow launcher:
Monitor Today, Review Performance, Browse Saved Data, Build And Simulate,
Inspect Runs And Orders, and Fix Setup. Each card is generated from current
public-safe telemetry and saved-data state, then links directly to the focused
dashboard page for that job.
When the right page is unclear, open Help Home. The Help workflow cards provide
state-aware routes for Monitor Today, Read Performance, Inspect Data, Build
Simulation, Troubleshoot, and Publish Safely. The Task Navigator above those
cards is the compact operational checklist to copy into notes or follow during
triage. The Mode Guide beside the performance guide explains replay, shadow,
simulated paper, broker paper, and live modes from the currently loaded
telemetry/artifact source, then links to Overview, Workbench, Performance,
Runs, Operations, and Boundary for evidence.
The Performance Snapshot on Overview is the quickest status-history readout:
today, recent period returns, all-available return, drawdown, and observed
orders/fills/rejects/alerts.
Open Performance Home for the fuller Current Strategy Report. It turns the
selected source into copyable rows for source freshness, equity and return,
risk, trades, execution issues, evidence depth, and the next action before you
open charts, trades, or rollup tables.
Start with Performance Action Summary when you want the next click. It picks
between creating source evidence, switching an empty selected period to All,
reviewing execution issues, opening rollups for drawdown/risk, inspecting
trades, loading benchmark data, or reading the evidence chain.
The Current Scoreboard below that is the fastest numeric scan: source, today,
recent, month, all-available return, drawdown, and readiness are shown before
the denser review and chart sections.
Read Performance Evidence next when a number looks surprising: it states
whether the selected result is account-backed, event-backed, summary-only,
rollup-only, or benchmarked, and links to the next verification page.
Generic plugin-runner executions also write `performance_rollups.json` and
`plugin_contract.json` beside `summary.json`, giving each run its own durable
period summaries plus public-safe plugin/run contract metadata even when the
dashboard status receiver is not running. Open a run in Runs to inspect the
Runner Rollups, Runner Period Rollups, and Plugin Boundary panels loaded from
those artifacts, or export the run artifacts JSON.

Open Performance for equity, return, drawdown, exposure, daily return bars,
period rollups, and open/closed trade rows when artifacts include fills.
Use the Performance workflow cards when you know the review job: Check Today,
Review Risk, Inspect Trades, Open Rollups, Compare Benchmark, or Verify Source.
They link directly to the focused Performance/Runs/Data views behind each
question.
Use Export Status CSV to download live/paper status-history daily, monthly, and
yearly equity rollups for offline review.
Before trusting a live/paper period result, open Performance Rollups and read
Status Rollup Continuity. It states whether status-history rollups are fresh,
how many calendar days are observed or missing, average snapshots per observed
day, node/mode mix, Gateway-down rows, alerts, rejections, and the next action.
Latest status rollups are also persisted as public-safe JSON snapshots in
`paper_logs/cloud_status_server/status_equity_rollups/`, and
`/status_equity_rollups_snapshot` returns the latest saved artifact for local
or cloud-side monitoring scripts.
The Live/Paper Status Rollups section also charts end-of-day equity by node and
recent daily status-history returns, which is the quickest view when the
strategy is publishing status but no archived artifact is loaded.
When inspecting Run Artifacts account snapshots, check `Equity Src` and
`Pricing` before trusting equity or exposure curves. `provided` means the broker
or simulator supplied equity; `estimated_from_cash_and_prices` means the runner
estimated equity from cash plus currently priced positions. Partial pricing
means one or more open positions lacked a current price in that snapshot.

Open Runs when a metric looks suspicious. Runs exposes recent decisions,
orders, fills, rejects, account snapshots, logs, and artifact drilldowns.
Read Action Summary on Runs Home first when you need a concise answer for what
to inspect next. It prioritizes open orders, execution issues, open positions,
fills/results, quiet runners, and artifact loading, then links directly to the
focused State, Events, Run Search, Performance, or Workbench Artifacts view.
Read Runs Evidence on Runs Home before the dense tables when you need the proof
chain. It separates current run source, recent decision/order/fill rows,
execution issues, account-boundary evidence, loaded artifacts, active filters,
and the next verification route.
In Runs State, start with State Action Summary. It chooses whether to reconcile
open orders, review positions, inspect event issues, open Performance, load
artifacts, read status history, or visit Operations setup before you scan the
account boundary and state tables.
Start with Event Flow Report on Runs Home or Runs Events when you need the
plain-language path through the recent timeline: it explains active filters,
execution issues, decision/order/fill mix, latest event, run/symbol coverage,
and the next inspection action before the dense event table.
On Runs Events, use Execution Quality Review when you need to audit fills rather
than strategy logic. It summarizes visible and loaded-artifact order/fill rows,
missed/rejected/canceled/held order rate, order type mix, decision-time and
submit-time bid/ask coverage, limit/cap price coverage, fill-price evidence, and
spread evidence. Missing rows are instrumentation gaps: the panel does not infer
bid/ask, average fill, or spread capture when runners have not published those
public-safe fields. Generic plugin-runner rows may include
`runner_estimated_from_bar_close` quote context when
`execution.sim_quote_spread_bps` or `execution.quote_spread_bps` is configured;
use that for public-safe review coverage, not as proof of broker-native NBBO.
Use the Runs workflow cards first when you know the review job: Current State,
Open Orders, Positions, Event Timeline, Run Search, or Loaded Artifacts. They
route directly into the focused Runs, Performance, or Workbench views behind
that evidence.
Use Run Comparison filters for status, action, mode, and summary availability
to compare replay, simulated-paper, paper, or other session groups before
opening individual artifacts.
When a run uses `execution.require_order_approval`, open Run Artifacts and
review Order Previews before approving anything. The Approve action writes the
validated local approval file for one held preview after confirmation; the
Copy action still gives the equivalent terminal command. This does not bypass
the runner's digest check and it does not submit an order by itself.

Open Operations when reviewing remote-control activity. Use Export Audit CSV
to download sanitized command queue, cancel, and result events together with
hash-chain and signature status for offline review.
Use Operations workflow cards first when the task is operational: Paper
Monitor, Gateway/API, Remote Nodes, Command Audit, Control Queue, or
Diagnostics. They route into the Paper, Remote, Control, or Diagnostics lenses
without scanning the full operations surface.
In Operations Paper, read Paper Action Summary first when you need the shortest
route. It chooses between Gateway diagnostics, the paper checklist, Runs/Orders,
Performance, or the Gateway runbook from the current readiness checks.
In Operations Paper, read Observation Packet before the longer checklist. It
separates the runner heartbeat, Gateway/API, market-data feed, account feed,
decision loop, order context, and mode safety, which answers whether the paper
runner is actively observing/evaluating or only has a Gateway window open.
Generic plugin-runner loops publish `next_check_time`,
`next_expected_decision_time`, and `next_check_reason` while waiting for the
next interval, then clear them with a terminal reason when stopped or completed.
Generic runner summaries also publish public-safe latest signal context and
`next_order_condition` from allowlisted dashboard diagnostics, so the Order
Context card can explain the latest threshold/signal state without raw strategy
payloads.
Use Paper Monitor Health and the checklist next for blockers and specific
fixes.
In Operations Remote, start with Remote Action Summary. It picks the first
cloud-monitoring route across missing snapshots, stale heartbeats, Gateway/API
blockers, alerts, open orders, stale feed timestamps, active filters, or
healthy report/export review. Remote Node Detail shows bounded artifact
evidence for published runs when the status publisher can see a generic runner
output directory. This evidence is limited to expected public artifact
filenames, presence, byte counts, modified times, and JSONL row counts. It is
useful for answering "did the remote runner produce the files I need to inspect
locally?" without posting raw logs, raw artifacts, credentials, or private
diagnostics to the receiver. Read Remote Node Health Report first when a node
is selected; it turns heartbeat, Gateway/API, account/data feed age, run
health, activity, bounded artifact evidence, cloud boundary, and next action
into copyable rows.

## Review a Completed Fetch

Open Fetch Jobs, choose a manifest, then inspect Fetch Detail. Use Copy Resume
Command when a run has failed or missing work. Use Show Outputs in Data Library
when produced files are visible under configured data roots; this filters Data
Library to the selected fetch job's output set so you can inspect or compare
those files without manually searching paths. Use Compare Outputs when at least
two produced files are Data Library-visible and you want the normalized
comparison chart loaded with the manifest date window. Use Use Outputs In
Workbench when the visible output set is ready to become replay input; it
selects those files in Config Builder and carries the manifest date range when
available. Use Copy Output Paths when you want the same visible output set as
newline-separated local paths for a script, config edit, or manual audit. Use
Export Detail CSV when you want one offline file containing the selected job's
symbol, output, error, retry, and pacing rows, including Data Library
visibility labels for produced files.
Fetch Detail also shows Resume Scope, a public-safe estimate of completed
symbols or output paths that will be skipped and failed, no-data, or pending
work that should be retried or reviewed before running the copied command.
The Resume From Manifest panel turns that scope into skip/retry/review/pending
cards and shows an inline copyable command for resumable stock and crypto
history manifests. That command is generated by the server from the selected
manifest path and is also present in the fetch detail API and CSV export.

Use Fetch Recovery Plan before retrying. It translates the selected manifest's
recovery status into concrete next steps: fix market-data permissions, fix
contract settings, review no-data symbols, update Data Library roots, resume
failed work, or inspect visible outputs.

If the output files are not visible, add the output directory or a parent cache
directory to `dashboard.data_roots`, refresh, and inspect the fetch again.

## Inspect Saved Historical Data

Open Data Library, search/filter to a dataset, then click Inspect. Data Detail
works offline from saved CSV/parquet files and shows:

- close-price path
- volume bars
- row count and date range
- timestamp timezone context
- gap/null/duplicate warnings
- sampled or bounded full-in-range views

Start with Data Detail Action Summary. It appears before the wide viewer form
and chooses the next action: open the best file for the typed symbol, diagnose
catalog/root visibility, reload the selected range, focus the largest gap,
send the opened file to Workbench, compare sibling files, or export the range.

Start with Data Home when the catalog is large. Saved Data Preview Wall shows
sampled close-path sparklines for the top visible files with a summary of
scope, replay readiness, coverage, sampled-return leader, and direct Inspect,
Compare, and Workbench actions. Action Summary above it explains the first
route when roots, scan caps, filters, parser errors, fetch outputs, or replay
readiness are the reason data is hard to find. The shortlist ranks the currently visible
saved files by quality, rows, and recency, then gives direct Inspect, Filter,
and Compare actions before you need to use the dense table.
Use Saved Data Explorer when you do not know the symbol yet. It answers which
asset classes, sources, bar sizes, sessions, quality states, and storage
contracts are present, with one-click filters for each group.
If expected symbols are missing, check Catalog Scope before searching. A capped
catalog means the dashboard loaded only the first bounded set of files; a
hidden-filter state means the files may be loaded but excluded by current
facets or text search.
Use the Catalog Page controls to move through additional bounded catalog
slices. Export CSV follows the current catalog page, so page first when you
want to download a later slice of a large local cache.
Use Data Source Map before searching if the catalog looks sparse: it summarizes
which roots are scanned, which suggested roots are outside the config, whether
files are hidden by caps, and whether parser/root errors explain missing data.
Use Storage Audit in Diagnostics for the deeper per-root file comparison,
including asset, source, bar-size, and storage-session breakdowns across
configured and suggested roots.

Use Compare Saved Data to overlay normalized close paths for multiple scanned
symbols over one date range. Start with Compare Action Summary above the form:
it decides whether the next move is selecting shown/symbol files, fixing
overlap, running Compare, reviewing warnings, sending the compared window to
Workbench, or exporting loaded paths. Use Find Dataset to narrow large catalogs
without dropping already selected files. Select Symbol chooses exact matches
for the typed catalog symbol, and Select Shown chooses the visible comparison
set up to the 8-dataset comparison cap. From Symbol Browser, Compare preselects
matching saved files for the typed symbol, loads the normalized comparison
chart, and jumps to the comparison workflow. Copy Compare JSON copies the exact
request body that the dashboard will send to `/data_compare`. Use In Workbench
sends the selected comparison set plus the compare date window directly into
Config Builder.
Use Compare Range Preset to quickly compare the full selected range, common
overlap, or the last day/week/month/three months inside the common overlap
before manually tuning Start/End.

Use Symbol Directory when you want to browse discovered symbols without already
knowing the ticker. It can search by symbol, asset, source, bar size, quality,
or date range, sort by files/rows/latest data/symbol/quality, and provides
direct Filter, Inspect, Compare, and Diagnose actions for each symbol. Use
Export Symbols CSV when you want the server-owned symbol universe summary for
offline review, including per-symbol file counts, row counts, ranges, sources,
bar sizes, quality counts, and the best inspectable saved file.
Use Symbol Coverage Ledger when you want the same filtered symbol set as a
compact range table with files, rows, sources, bars, sessions, replay
readiness, and direct Inspect, Filter, Compare, and Workbench actions. Export
Ledger CSV downloads that current filtered/sorted ledger view.
Use Symbol Browser quick picks when you only remember part of a ticker; the
cards summarize matching symbols and select one into the existing Inspect,
Compare, Filter, and Diagnose actions.
The Selected Symbol strip under Symbol Browser shows the current action target,
selected saved file, coverage, quality, and direct Filter, Inspect, Workbench,
Compare, and Diagnose buttons, so dataset-selector changes are visible before
you act.
The Symbol Profile under the browser summarizes the selected symbol's saved
files, date coverage, quality, best file, a compact best-file preview chart,
and direct next actions: inspect, send to Workbench, compare saved files, filter
the catalog, or diagnose a missing symbol.

Use Export Compare CSV after running Compare Saved Data when you want the
normalized close-return paths by symbol and timestamp.

Use Export Range CSV from Data Detail when you want the selected saved-file
date range as bounded bar data with normalized UTC timestamps and the original
file columns. Narrow Start/End before exporting very large 1-minute histories.
Use the Data Detail Range Preset control for quick full-file, last-day,
last-week, last-month, or last-three-month chart windows before manually
tuning Start/End.

Use Export Scan CSV when you want configured-root parser errors, unsupported
files, catalog caps, scan timings, and skipped-file samples in an offline table.

Use Export Coverage CSV when you want the Data Library symbol/date coverage
grid as a downloadable table for offline review.

Use Export Gap CSV when you want aggregate timestamp-gap and missing
calendar-day rows across the current catalog scan.

Use the Minute Coverage Heatmap when you want per-file UTC hour strips plus
bounded worst date/hour strips for missing intraday intervals. Use Export
Minute CSV when you want the same intraday hour, date/hour, and date/hour
matrix rows offline.

## Replay From Saved Data

1. Inspect the saved dataset and review quality, gaps, nulls, timezone, and
   date range.
   Use Jump to Symbol in Data Detail when you know the ticker but not the
   exact saved file path.
   Use In Workbench from Data Detail when a single opened file and viewer
   window are ready to simulate.
2. Open Workbench and select one or more saved datasets, or use one of the
   direct handoffs from Data Detail, Compare Saved Data, or Fetch Detail.
3. Read Selected Data Packet in Workbench Builder before changing plugin
   settings. It shows the selected files, symbols, bar sizes, sources, chosen
   date window, alignment overlap state, and quality pressure. Use Inspect,
   Compare, or Remove on a file row when the packet does not look like the
   replay input you intended. The Selected Data Coverage ledger below it
   summarizes replay readiness, source/bar/session mix, ranges, and can export
   the current saved-data handoff as CSV.
4. On Workbench Home, read Example Config Gallery. Public examples are no-edge
   wiring demos; ignored local/private plugins are only summarized there. Use a
   gallery action to populate plugin/mode fields, then choose a public example
   plugin or a private local plugin from an ignored registry in Builder.
5. Read Workbench Evidence. It states whether the setup is only selected-data
   evidence, a valid draft, a completed run waiting for artifacts, or loaded
   artifact evidence that can be inspected in Performance and Runs.
6. Preview alignment before generating a draft. The Selected Data Packet
   should move from Not Previewed to an overlap count or a clear no-overlap
   warning.
7. Read Compatibility Review. It combines schema versions, plugin boundary,
   selected data quality, alignment coverage, saved-draft validation, and the
   next action in one place. Plugin Field Help shows the selected plugin's
   public-safe strategy inputs, declarative validation rules, result fields, and
   result sections, including help text, defaults, bounds/options, formatting
   hints, and required/advanced flags.
8. Use Preview Draft to validate and inspect generated YAML, alignment,
   plugin boundary, and local commands without saving.
9. Use Generate / Save after enabling Save draft locally when the preview is
   acceptable.
10. In Workbench Run, read Draft Inventory Review and Run Readiness before
   pressing Run. Draft Inventory Review summarizes saved draft folders, tags,
   validation coverage, runnable drafts, latest runs, and the selected draft's
   next action before the dense tables. Run Readiness calls out the
   selected draft, validation state, run action, latest run, available results,
   blockers, and warnings, and it can jump directly to Validate, Run, or Open
   Results. Use Run Selected to stay in Workbench after completion, or Run +
   Performance to run replay/simulated paper and land on the Performance page
   after artifacts load. The Selected Draft Commands panel summarizes the
   chosen draft, validation state, selected action, and execution boundary
   before the raw copyable `live/plugin_runner.py` commands.
10. After a completed replay or simulated-paper run, the dashboard loads the
   exact archived run artifacts when available and refreshes run comparison and
   performance rollups. If a run fails or only validates, stay in Workbench Run
   and open the log before trusting outputs.

The Log button opens Workbench Artifacts and loads bounded run evidence from
`/config_draft_run_evidence`: execution status, summary availability, stdout
and stderr tail stats, and the expected artifact-file manifest. Use that panel
first when a run failed, timed out, or completed without visible artifacts.
In Workbench Artifacts, start with Artifacts Action Summary before the Run Log
and Run Artifacts tables. It tells you whether to load the latest completed
run, open Performance, open Runs, load bounded logs, export the artifact JSON,
or return to Run Draft.

Run Artifacts reads public-safe `diagnostics.dashboard` values from plugin
decisions. Add `result_fields` to a public or ignored local plugin registry
entry when those values need clearer labels or formatting in the artifact view.
Those fields can include `kind`, `decimals`, `prefix`, `suffix`, and `unit`
display hints, which the Plugin Result Fields and Result Coverage panels use
when rendering values. Add optional `result_sections` when declared fields
should be grouped into public-safe artifact cards. The Plugin Boundary and
Result Coverage panels show the matched registry plugin, declared public
inputs/results, emitted result counts, latest declared values, the runner-owned
`plugin_contract.json` summary, and sanitized
dashboard keys that are still unlabeled. Add optional `result_widgets` for
card, table, bar-summary, sparkline, line-chart, or allowlisted declarative
custom-chart artifact displays. Run Artifacts summarizes widget coverage before rendering those widgets, so missing
public-safe diagnostic fields are visible before dense result tables. Plugin
Result Display Plan shows how each declared result field is presented: field
path, order, kind, formatting hints, latest formatted value, emitted coverage,
and help text.

Start from Workbench Home before the form. It summarizes selected data,
alignment, optional replay window, draft validation, latest run, loaded
artifacts, and the next action. Use its buttons to jump to data selection,
alignment preview, builder review, the run form, or loaded results.
Read Workbench Action Summary first when you want the shortest next move. It
turns selected data, alignment, plugin/mode, draft, run, and result state into
one route before the deeper plan and evidence panels.
The Stage Summary directly below Workbench Home is the fastest scan: it shows
the current workflow stage, ready/review/blocked counts, data packet,
alignment, draft, run, results, and the next route before the fuller plan and
evidence panels.
In Workbench Builder, start with Builder Assistant and Selected Data Packet
before the lower form fields. Builder Assistant says which step is next, while
Selected Data Packet answers whether the current saved-file input is the one
you meant to simulate. Use Export Selected Data CSV when you want a portable
record of exactly which saved files, date range, replay readiness, and metadata
were used for the next draft.
The Workbench workflow cards are the quickest route when you know the job:
Select Data, Preview Alignment, Build Draft, Run Draft, Open Results, or Review
Boundary. They use the same selected-data, alignment, draft, run, and artifact
state as the detailed guide below them.

The Simulate From Saved Data guide is actionable: use each step's button to
jump to the relevant data picker, quality table, alignment preview, draft
builder, run form, or results table.

Use Export Drafts CSV when you want an offline inventory of saved draft folder,
status, plugin, symbol, tag, validation, output, and YAML path metadata.

## Distinguish Result Modes

- `replay`: plugin decisions over saved bars, no order submission.
- `shadow`: observe decisions without submitting orders.
- `simulated_paper`: local simulated fills and account state.
- `paper`: broker paper account order submission.
- `live`: real broker trading authority. The public workbench should keep live
  operation behind private configs and explicit local gates.

Treat short-horizon projected daily/monthly/yearly returns as convenience
translations, not stable performance estimates.

## Review Remote Monitoring

Open Operations Home first. It summarizes local paper-monitor readiness,
Gateway/API reachability, remote-node freshness, command-audit integrity and
signature state, and current alerts before the detailed tables.
Read Operations Action Summary first when you want the fastest route. It
chooses between Paper Monitor, Gateway/API diagnostics, Remote Nodes, Command
Audit/Control, and local alerts from the current public-safe operations state.
Read Operations Evidence beside it when you need the proof chain rather than
just the route. It states whether current state is backed by local runner/paper
telemetry, Gateway/API checks, remote-node snapshots, command-audit integrity,
control queue rows, and alerts, then points to the next Operations lens.

Then open Remote Nodes to inspect sanitized latest status snapshots from local
or hosted status publishers. Use Export Nodes CSV for an offline table of
heartbeat, Gateway, mode, equity, positions, open orders, activity counts,
account/data freshness, and alert summaries by node.
Read Remote Monitor Report before the dense node table. It gives copyable rows
for node coverage, heartbeat freshness, Gateway/API state, alerts, open orders,
stale data/account timestamps, and the next operational action.
Open Operations Diagnostics before exposing a receiver beyond localhost. Cloud
Deployment Readiness summarizes remote monitoring evidence, command-audit
integrity, local-only trading authority, authentication, network boundary,
retention, current alerts, and the remaining manual provider hardening review.
Open Help > Boundary > Cloud Access Guide when the question is whether a task
belongs in the cloud. It explains cloud checking versus cloud running, routes
to Remote Nodes, Command Control, Cloud Readiness, and the cloud runbook, and
keeps broker sessions, credentials, private strategies, data roots, and order
authority on the local trading machine.
Open Operations Control before queueing any command. Command Safety Review
summarizes the target node, read-only/control/launcher action classes,
confirmation requirements, pending and failed command pressure, audit
integrity, retention state, selected-action boundary copy, and the high-risk
live-control actions that remain fail-closed in the public command surface.
Supervisor Action Summary is the first supervisor view: it summarizes loaded
local supervisor count, job count, stale heartbeats, missed/running/due/waiting
jobs, and pause/restart marker availability, then prepares `supervisor_status`
or `run_supervisor_once` without queueing either command. A missed start window
should appear as a structured supervisor job alert with the next expected start
time; it should not require reading local service logs.

Click Detail on a node when you need bounded per-node history, recent
decisions/orders/fills, latest run summaries, alerts, and supervisors. Remote
Node Detail starts with run-health cards for completed/failed runs, activity,
rejections, latest decision age, equity visibility, and the sanitized cloud
boundary before the dense tables. Use Export Detail CSV to download that
sanitized node detail for offline review without exposing raw logs or strategy
diagnostics.

## Diagnose Fetch Jobs

Fetch Jobs reads JSON manifests from `dashboard.fetch_manifest_roots`. Use it
to inspect completed and active fetches, failed symbols, no-data chunks, output
files, and generated data-detail links for files under configured data roots.
The canonical API route is `/fetch_manifests`; `/fetch_jobs` is also served as
an alias for scripts or users who think in job terminology. Use
`/fetch_manifest_roots` when you only need configured root readability and
manifest counts.
Start with Fetch Progress Review when a pull is active, partial, failed, or
otherwise suspicious. It summarizes the focus manifest, symbol/chunk progress,
ETA and rolling pace, retry/pacing pressure, output visibility, recovery state,
and next action before the dense Jobs table.
Read Fetch Action Summary first when you want the fastest route. It chooses
between active-job inspection, failure/no-data/retry recovery, output-root
visibility fixes, selected output handoff, and filtered job review, then links
to Jobs, Detail, Data Library, or Workbench.
In the Jobs table, the Activity column shows the latest explicit manifest event
or progress timestamp and its source. For running jobs, treat a stale Activity
age as evidence that the fetcher stopped updating its manifest even if the job
still appears non-terminal.
Read Fetch Evidence when the question is whether the dashboard can prove what
happened: it separates configured root evidence, loaded manifest rows, recovery
pressure, Data Library-visible outputs, selected-detail state, and the next
verification action.
The Fetch Workflow checklist summarizes whether manifest roots are readable,
whether jobs were found, whether filters are hiding them, whether selected
outputs are visible in Data Library, and whether the selected job can be
resumed or exported.
Use the Fetch workflow cards first when you know the job: Configure Roots,
Monitor Jobs, Recover Failures, Review Outputs, Open Saved Data, or Simulate
Outputs. The cards route directly to Fetch, Data Library, or Workbench based on
the selected manifest and visible output files.
Use Export Jobs CSV to download recent fetch-job summaries, including status,
symbols, chunks, rows, retries, pacing waits, ETA/progress fields, errors, and
output paths.
Use Copy fetch_manifest_roots YAML to copy the currently visible manifest roots
as a local dashboard config block.

If a fetch output is not visible in Data Library, check whether the output root
is included in `dashboard.data_roots`.

## Public/Private Boundary

Before exporting or publishing:

```bash
python3 scripts/public_readiness_audit.py --fail-on-review
PYTHONPATH=. pytest -q
python3 scripts/smoke_dashboard.py
```

Keep private strategy plugins, tuned configs, account IDs, credentials, local
runtime logs, and private research outputs out of the public repo.

In the dashboard, open Help > Boundary > Publication Review Assistant before
copying the public repo to GitHub. It separates automated gates from human
review, flags visible dashboard setup gaps, summarizes local public-safe
evidence, reminds you which private material must never be exported, and can
copy either the review text or the final publish/export commands.

## Related Runbooks

- `docs/ibkr_gateway_runbook.md`: Gateway startup, API checks, and recovery.
- `docs/paper_trading_runbook.md`: replay, simulated-paper, broker paper,
  supervisor startup, monitoring, and shutdown.
- `docs/market_data_permissions_runbook.md`: IBKR permission, venue, and
  no-data diagnosis.
- `docs/service_restart_runbook.md`: local service restart order,
  provider/service-specific receiver recipes, proxy reloads, logs, and
  duplicate runner checks.
- `docs/failed_order_diagnosis_runbook.md`: rejected, canceled, missing-fill,
  and stale-telemetry troubleshooting.
- `docs/cloud_monitoring_deployment.md`: conservative local-first remote
  monitoring deployment guidance, including hosted receiver, reverse proxy,
  local publisher timer, and command-worker examples.
