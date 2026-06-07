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

Open `http://127.0.0.1:8765/`. Top-level pages can be deep-linked with hashes
such as `#overview`, `#performance`, `#data`, `#fetch`, `#workbench`,
`#runs`, `#operations`, and `#help`.

Use the topbar task selector when you know the job but not the page: choose
items such as Monitor today's run, Find saved data, Build a simulation, Check
runtime health, or Publish safely. The dashboard routes that task to the
current best page/lens using the public-safe state it has loaded. Use Quick
Jump when you already know the destination; it lists every public page and
focused lens, including entries such as Data Inspect, Workbench Run,
Performance Trades, and Operations Remote. Each page also shows a route strip
above the intro. Page Home returns the current page to its home lens, and Copy
Link copies the exact page/lens URL for notes, runbooks, or another browser tab.

Open Help when you are not sure where to start. The Start Here panel maps the
main questions to pages: current health, performance, saved data, simulation,
run drilldowns, and operations diagnostics. The Current Setup Gaps panel is
state-aware: after refresh it points at missing telemetry, disabled or
unreachable Gateway checks, unreadable data roots, catalog caps, missing fetch
manifests, and missing Workbench drafts.

Every top-level page also starts with a compact workflow rail. Read it left to
right for the common path on that page before opening the deeper tables below.

## Configure Data Roots

The dashboard only scans paths listed in `dashboard.data_roots`. Public example
configs should point at `examples/data`; local private configs can point at
cache/history folders.

If Data Library only shows SPY/QQQ examples:

1. Open Data Library.
2. Read Catalog Scope. If it says the scan is capped, use Scan Max Rows before
   deciding a symbol is missing. If filters hide everything, use Clear Filters.
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
it groups the bounded catalog by asset, source, bar size, storage session,
quality, and storage-contract state, then lets you click a group to replace
the current Browse filters and jump to the matching table rows.
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
readiness, and whether the current Rows to scan limit may be hiding history.
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
active, and when the latest decision/account/data timestamps were published.
The page intro strip changes with each top-level view and gives the fastest
next step plus the current public telemetry counts for that view.
Use the Overview Start Here cards as the main workflow launcher:
Monitor Today, Review Performance, Browse Saved Data, Build And Simulate,
Inspect Runs And Orders, and Fix Setup. Each card is generated from current
public-safe telemetry and saved-data state, then links directly to the focused
dashboard page for that job.
When the right page is unclear, open Help Home. The Help workflow cards provide
state-aware routes for Monitor Today, Read Performance, Inspect Data, Build
Simulation, Troubleshoot, and Publish Safely.
The Performance Snapshot on Overview is the quickest status-history readout:
today, recent period returns, all-available return, drawdown, and observed
orders/fills/rejects/alerts.
Open Performance Home for the fuller Current Strategy Report. It turns the
selected source into copyable rows for source freshness, equity and return,
risk, trades, execution issues, evidence depth, and the next action before you
open charts, trades, or rollup tables.
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
Latest status rollups are also persisted as public-safe JSON snapshots in
`paper_logs/cloud_status_server/status_equity_rollups/`, and
`/status_equity_rollups_snapshot` returns the latest saved artifact for local
or cloud-side monitoring scripts.
The Live/Paper Status Rollups section also charts end-of-day equity by node and
recent daily status-history returns, which is the quickest view when the
strategy is publishing status but no archived artifact is loaded.

Open Runs when a metric looks suspicious. Runs exposes recent decisions,
orders, fills, rejects, account snapshots, logs, and artifact drilldowns.
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
In Operations Paper, read Observation Packet before the longer checklist. It
separates the runner heartbeat, Gateway/API, market-data feed, account feed,
decision loop, order context, and mode safety, which answers whether the paper
runner is actively observing/evaluating or only has a Gateway window open. Use
Paper Monitor Health and the checklist next for blockers and specific fixes.
In Operations Remote, Remote Node Detail shows bounded artifact evidence for
published runs when the status publisher can see a generic runner output
directory. This evidence is limited to expected public artifact filenames,
presence, byte counts, modified times, and JSONL row counts. It is useful for
answering "did the remote runner produce the files I need to inspect locally?"
without posting raw logs, raw artifacts, credentials, or private diagnostics to
the receiver.

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

Start with the Data Home shortlist when the catalog is large. It ranks the
currently visible saved files by quality, rows, and recency, then gives direct
Inspect, Filter, and Compare actions before you need to use the dense table.
Use Saved Data Explorer when you do not know the symbol yet. It answers which
asset classes, sources, bar sizes, sessions, quality states, and storage
contracts are present, with one-click filters for each group.
If expected symbols are missing, check Catalog Scope before searching. A capped
catalog means the dashboard loaded only the first bounded set of files; a
hidden-filter state means the files may be loaded but excluded by current
facets or text search.
Use Data Source Map before searching if the catalog looks sparse: it summarizes
which roots are scanned, which suggested roots are outside the config, whether
files are hidden by caps, and whether parser/root errors explain missing data.
Use Storage Audit in Diagnostics for the deeper per-root file comparison,
including asset, source, bar-size, and storage-session breakdowns across
configured and suggested roots.

Use Compare Saved Data to overlay normalized close paths for multiple scanned
symbols over one date range. Use Find Dataset to narrow large catalogs without
dropping already selected files. Select Symbol chooses exact matches for the
typed catalog symbol, and Select Shown chooses the visible comparison set up to
the 8-dataset comparison cap. From Symbol Browser, Compare preselects matching
saved files for the typed symbol, loads the normalized comparison chart, and
jumps to the comparison workflow. Copy Compare JSON copies the exact request
body that the dashboard will send to `/data_compare`. Use In Workbench sends
the selected comparison set plus the compare date window directly into Config
Builder.
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
4. Choose a public example plugin or a private local plugin from an ignored
   registry.
5. Preview alignment before generating a draft. The Selected Data Packet
   should move from Not Previewed to an overlap count or a clear no-overlap
   warning.
6. Read Compatibility Review. It combines schema versions, plugin boundary,
   selected data quality, alignment coverage, saved-draft validation, and the
   next action in one place. Plugin Field Help shows the selected plugin's
   public-safe strategy inputs, result fields, and result sections, including
   help text, defaults, bounds/options, formatting hints, and
   required/advanced flags.
7. Use Preview Draft to validate and inspect generated YAML, alignment,
   plugin boundary, and local commands without saving.
8. Use Generate / Save after enabling Save draft locally when the preview is
   acceptable.
9. In Workbench Run, read Run Readiness before pressing Run. It calls out the
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
dashboard keys that are still unlabeled. Plugin Result Display Plan shows how
each declared result field is presented: field path, order, kind, formatting
hints, latest formatted value, emitted coverage, and help text.

Start from Workbench Home before the form. It summarizes selected data,
alignment, optional replay window, draft validation, latest run, loaded
artifacts, and the next action. Use its buttons to jump to data selection,
alignment preview, builder review, the run form, or loaded results.
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
