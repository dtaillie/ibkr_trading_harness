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

## Configure Data Roots

The dashboard only scans paths listed in `dashboard.data_roots`. Public example
configs should point at `examples/data`; local private configs can point at
cache/history folders.

If Data Library only shows SPY/QQQ examples:

1. Open Data Library.
2. Check Configured Roots and Storage Audit.
3. Use Find Missing Symbol for a ticker you expected to see.
4. Use Copy data_roots YAML to copy configured plus suggested roots.
5. Paste the `dashboard.data_roots` block into your ignored local dashboard
   config, removing any roots you do not want scanned.
6. Use Export Audit CSV if you want the root-by-root storage comparison,
   hidden-file counts, and scan-duration timings for offline review.
7. Refresh the dashboard.

## Find Current Strategy Performance

Start in Overview. The hero card and Runtime Status strip answer whether a
runner is publishing telemetry, whether Gateway/API is reachable, what mode is
active, and when the latest decision/account/data timestamps were published.

Open Performance for equity, return, drawdown, exposure, daily return bars,
period rollups, and open/closed trade rows when artifacts include fills.

Open Runs when a metric looks suspicious. Runs exposes recent decisions,
orders, fills, rejects, account snapshots, logs, and artifact drilldowns.

## Review a Completed Fetch

Open Fetch Jobs, choose a manifest, then inspect Fetch Detail. Use Copy Resume
Command when a run has failed or missing work. Use Show Outputs in Data Library
when produced files are visible under configured data roots; this filters Data
Library to the selected fetch job's output set so you can inspect or compare
those files without manually searching paths. Use Copy Output Paths when you
want the same visible output set as newline-separated local paths for a script,
config edit, or manual audit. Use Export Detail CSV when you want one offline
file containing the selected job's symbol, output, error, retry, and pacing
rows, including Data Library visibility labels for produced files.

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

Use Compare Saved Data to overlay normalized close paths for multiple scanned
symbols over one date range. Use Find Dataset to narrow large catalogs without
dropping already selected files. Select Symbol chooses exact matches for the
typed catalog symbol, and Select Shown chooses the visible comparison set up to
the 8-dataset comparison cap. From Symbol Browser, Compare preselects matching
saved files for the typed symbol and jumps to the comparison workflow. Copy
Compare JSON copies the exact request body that the dashboard will send to
`/data_compare`.

Use Export Compare CSV after running Compare Saved Data when you want the
normalized close-return paths by symbol and timestamp.

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
2. Open Workbench and select one or more saved datasets.
3. Choose a public example plugin or a private local plugin from an ignored
   registry.
4. Preview alignment before generating a draft.
5. Generate and validate the draft.
6. Run replay or simulated paper.
7. Open the result from the Runs or Workbench table and inspect Performance.

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

## Diagnose Fetch Jobs

Fetch Jobs reads JSON manifests from `dashboard.fetch_manifest_roots`. Use it
to inspect completed and active fetches, failed symbols, no-data chunks, output
files, and generated data-detail links for files under configured data roots.
The Fetch Workflow checklist summarizes whether manifest roots are readable,
whether jobs were found, whether filters are hiding them, whether selected
outputs are visible in Data Library, and whether the selected job can be
resumed or exported.
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
