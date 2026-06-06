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
2. Check Data Source Map for configured, suggested, hidden/capped,
   parser-error, unavailable, and not-scanned roots.
3. Use Find Missing Symbol for a ticker you expected to see.
4. Use Copy data_roots YAML to copy configured plus suggested roots.
5. Paste the `dashboard.data_roots` block into your ignored local dashboard
   config, removing any roots you do not want scanned.
6. Use Export Audit CSV if you want the root-by-root storage comparison,
   hidden-file counts, and scan-duration timings for offline review.
7. Refresh the dashboard.

The Data Library Home page also has workflow cards for Find A Symbol, Inspect
History, Compare Files, Build Simulation, Check Quality, and Fix Visibility.
Use those cards when you know the job you want but do not yet know which table
or diagnostic panel holds the answer.
When inspecting a single saved file, Data Detail now shows range stats above
the chart for return, close range, movement, volume, gaps, and sampling state
before the lower metadata and gap tables.

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
Generic plugin-runner executions also write `performance_rollups.json` beside
`summary.json`, giving each run its own durable daily, monthly, and yearly
account-equity summaries even when the dashboard status receiver is not
running. Open a run in Runs to inspect the Runner Rollups and Runner Period
Rollups tables loaded from that artifact, or export the run artifacts JSON.

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

Open Operations when reviewing remote-control activity. Use Export Audit CSV
to download sanitized command queue, cancel, and result events together with
hash-chain and signature status for offline review.
Use Operations workflow cards first when the task is operational: Paper
Monitor, Gateway/API, Remote Nodes, Command Audit, Control Queue, or
Diagnostics. They route into the Paper, Remote, Control, or Diagnostics lenses
without scanning the full operations surface.

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
Use Data Source Map before searching if the catalog looks sparse: it summarizes
which roots are scanned, which suggested roots are outside the config, whether
files are hidden by caps, and whether parser/root errors explain missing data.

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
Use Symbol Browser quick picks when you only remember part of a ticker; the
cards summarize matching symbols and select one into the existing Inspect,
Compare, Filter, and Diagnose actions.
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

Use Export Minute CSV when you want intraday hour and date/hour completeness
rows from the Minute Coverage Heatmap.

## Replay From Saved Data

1. Inspect the saved dataset and review quality, gaps, nulls, timezone, and
   date range.
   Use Jump to Symbol in Data Detail when you know the ticker but not the
   exact saved file path.
   Use In Workbench from Data Detail when a single opened file and viewer
   window are ready to simulate.
2. Open Workbench and select one or more saved datasets, or use one of the
   direct handoffs from Data Detail, Compare Saved Data, or Fetch Detail.
3. Choose a public example plugin or a private local plugin from an ignored
   registry.
4. Preview alignment before generating a draft.
5. Read Compatibility Review. It combines schema versions, plugin boundary,
   selected data quality, alignment coverage, saved-draft validation, and the
   next action in one place.
6. Use Preview Draft to validate and inspect generated YAML, alignment,
   plugin boundary, and local commands without saving.
7. Use Generate / Save after enabling Save draft locally when the preview is
   acceptable.
8. Run replay or simulated paper.
9. Open the result from the Runs or Workbench table and inspect Performance.

Start from Workbench Home before the form. It summarizes selected data,
alignment, optional replay window, draft validation, latest run, loaded
artifacts, and the next action. Use its buttons to jump to data selection,
alignment preview, builder review, the run form, or loaded results.
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

Click Detail on a node when you need bounded per-node history, recent
decisions/orders/fills, latest run summaries, alerts, and supervisors. Use
Export Detail CSV to download that sanitized node detail for offline review
without exposing raw logs or strategy diagnostics.

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
- `docs/service_restart_runbook.md`: service restart order, logs, and duplicate
  runner checks.
- `docs/failed_order_diagnosis_runbook.md`: rejected, canceled, missing-fill,
  and stale-telemetry troubleshooting.
- `docs/cloud_monitoring_deployment.md`: conservative local-first remote
  monitoring deployment guidance, including hosted receiver, reverse proxy,
  local publisher timer, and command-worker examples.
