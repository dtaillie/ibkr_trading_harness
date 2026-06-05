# Work Queue

This is the current prioritized queue. It is intentionally product-heavy:
trading research stays at the bottom until the public workbench is easier to
understand, operate, and trust.

Current product direction: make the web UI feel like a modern brokerage app in
clarity and pacing, closer to Robinhood's simple portfolio-first mental model
than a developer status dump. This does not mean copying Robinhood's interface;
it means clear navigation, clean performance views, obvious empty states, and
fast answers to "what is running?", "how is it doing?", and "what data do I
have?".

Near-term priority order:

1. Make the app navigable instead of feeling like one dense status page.
2. Make the current strategy's live/paper performance visible at a glance.
3. Make every saved historical dataset discoverable, searchable, and chartable.
4. Make fetch/data-root failures explain themselves in the UI.
5. Add in-app help and README guidance so a new user can operate the workbench
   without reading source code.
6. Only after the product/data surfaces are trustworthy, resume trading
   research.

## P0: Web UI product overhaul

Goal: make the dashboard feel like a modern trading app, closer to Robinhood's
clarity and visual rhythm, while keeping this project local-first and
strategy-private.

- Progress: initial app-shell navigation, Overview, Performance, Data Library,
  Fetch Jobs, Operations, Workbench, Runs, and Help views are implemented. The
  Overview now includes health checks, a concrete checklist, open-position
  cards, and a latest event timeline. Performance now includes equity,
  drawdown, and daily-return visuals when account artifacts are available. The
  next pass should improve deeper drilldowns, visual polish, and guided
  workflows.
- Define page-level user outcomes before adding more controls:
  - Overview should answer whether the current strategy is healthy in under
    ten seconds.
  - Performance should show today's result, recent result, all-time paper
    result, and drawdown without opening logs.
  - Data Library should explain why a symbol is visible or missing.
  - Workbench should guide a user from saved data to a validated replay config.
  - Runs should make every decision, order, fill, rejection, and artifact
    inspectable.
  - Help should make a first-time user productive without reading source code.
- Redesign the app shell so the dashboard is not one long page. Add persistent
  navigation with clear sections:
  - Overview
  - Strategy Performance
  - Data Library
  - Runs and Orders
  - Config Workbench
  - Fetch Jobs
  - Operations
  - Help
- Add route-like navigation state so each top-level view can be deep-linked,
  refreshed, and shared by URL/hash without losing context.
  - done for top-level dashboard views with URL hash navigation
- Add a brokerage-style "Strategy Home" view:
  - active strategy name, mode, and status
  - portfolio/equity headline first, not log tables
  - today's PnL/return, recent PnL/return, open exposure, and current risk
  - clear "no trade today" state with the latest checked signal
  - open positions and pending orders before archived run tables
  - one-click drilldown into the source run/session/artifacts
  - partial; the Overview hero now shows equity first plus mode, Gateway,
    latest signal/fill, cash, today return, week return, gross exposure, and
    next expected check when those generic telemetry/artifact fields are
    available.
- Add an explicit "What is running right now?" strip that shows:
  - process heartbeat
  - Gateway/API connection
  - latest market-data timestamp
  - latest account timestamp
  - latest decision timestamp
  - whether the runner is observing, simulating, paper trading, or live trading
  - partial; Overview now has a Runtime Status strip with heartbeat,
    Gateway/API, mode, latest decision, open-order, and latest rejection state.
    Generic plugin runs now publish latest market-data and account timestamps;
    private/specialized runners still need the same generic fields where
    missing.
- Add a more intuitive first-run experience:
  - show a setup checklist when no current run is publishing telemetry
    - partial; Overview now shows a current checklist with telemetry, Gateway,
      runs, events, saved data, fetch jobs, and alert state
  - distinguish "nothing is running" from "running but no signal today"
    - partial; Overview separates no published runs from runs with no recent
      signal/order/fill events
  - distinguish "no saved data configured" from "data exists but root is not
    scanned"
    - done in Data Library visibility cards and suggested-root diagnostics
  - surface the exact local config/data-root/action that would resolve each
    empty state
    - partial; Data Library and Fetch Jobs show configured/suggested roots,
      broader action-level guidance still belongs in contextual help
  - add "what changed since last refresh" cues for new signals, fills, rejects,
    and fetch completions
    - done for recent run events, new alerts, and terminal fetch-job changes
- Build a clean Overview page for the current running strategy state:
  - mode badge: replay, shadow, simulated paper, paper, or live
    - partial; mode is shown from latest artifact or telemetry summary
  - gateway/API status
    - done for configured Gateway reachability
  - current equity, cash, open positions, unrealized PnL, realized PnL
    - partial; current equity, cash, exposure, and open positions are shown
      when account artifacts or telemetry publish them. Realized/unrealized PnL
      still needs richer account/position telemetry.
  - today's return, week/month return, cumulative paper return
    - partial; cumulative/latest artifact return is available in Performance,
      period-specific live paper summaries are not implemented
  - latest bar time, latest signal time, latest order/fill/rejection
    - partial; latest signal and fill are shown from recent events, latest bar
      and rejection need dedicated telemetry fields
  - next expected decision window
    - partial; Overview shows a Next Check tile when generic telemetry includes
      `next_decision_time`, `next_expected_decision_time`, `next_check_time`, or
      `next_signal_time`.
  - stale-data, stale-account, rejected-order, risk-limit, and gateway-login
    alerts
    - partial; published alerts and Gateway state are visible, specialized alert
      categories depend on runner telemetry
  - open-position cards with symbol, entry time, entry price, current price,
    PnL, age, intended hold window, and active exit rule
    - partial; position cards show symbol, quantity, and value when account
      snapshots include position values. Entry/exit-rule fields need strategy
      telemetry.
  - today's event timeline from market open/current session start through the
    latest decision
    - partial; Overview now shows the latest bounded decision/order/fill
      timeline from telemetry
- Add a Strategy Performance page with charts and summaries:
  - current active strategy selector
  - current strategy snapshot independent of historical run comparison tables
    - partial; Performance now includes source, mode, latest account timestamp,
      open positions, and activity counts above artifact comparison tables
  - equity curve
    - done for archived run account artifacts
  - drawdown curve
    - done for archived run account artifacts
  - daily return bars
    - done for archived run account artifacts
  - calendar heatmap
    - done for archived run account artifacts
  - intraday equity/PnL chart for today's run when minute bars or account
    snapshots are available
  - open/closed trade table
    - done for selected archived artifacts with sanitized fills
  - win/loss, average win/loss, profit factor, max drawdown, exposure, turnover
    - done for selected archived artifacts; win/loss, average win/loss, profit
      factor, max drawdown, exposure, and selected-window turnover are derived
      from sanitized fills/account snapshots when available.
  - benchmark overlay where appropriate
  - clear short-horizon projection caveats for per-day/month/year stats
    - done for the Performance page; Metric Context now flags short-horizon
      annualized stats and explains that per-day/month/year figures are scale
      references, not forecasts.
  - selectable period presets: today, week, month, 3 months, all available
    - done for account-artifact charts and KPIs
  - obvious difference between realized historical backtest, simulated paper,
    IBKR paper, and live account metrics
    - partial; Metric Context now explains replay, simulated-paper, shadow,
      paper, live, artifact, summary-only, and live-telemetry sources. Broker
      paper/live state still depends on runner telemetry fields being present.
- Add a clean "current strategy performance" mode that does not require picking
  through historical run comparison rows.
  - partial; Strategy Performance now has an explicit Source selector with a
    Current default, Loaded artifact mode, and Latest saved run mode. Opening
    artifacts switches to artifact mode, and users can return to Current
    without clearing the loaded artifact.
- Add strategy/session comparison only after the current-strategy page is easy
  to read.
- Add daily run rollups so the dashboard can answer "how did it do today?" for
  each day the service was running.
  - partial; Performance now shows archived account-artifact daily rollups by
    UTC day with return, equity, orders, fills, rejects, and artifact drilldown
- Add persistent period summaries so daily/monthly/yearly stats do not depend
  on a currently open process.
  - partial; daily, monthly, and yearly rollups are derived from archived
    workbench account artifacts, dedicated live paper rollup storage remains
    open
- Add a Runs and Orders page:
  - searchable run history
    - done for saved run comparison rows
  - session timeline of decisions, orders, fills, rejects, account snapshots
  - current open orders and current managed positions
    - partial; current managed positions and recent non-terminal order events
      are visible, broker-native open-order state still depends on runner
      telemetry
  - drilldown for a run with artifacts, logs, and performance charts
    - partial; artifacts, logs, and performance charts are inspectable for
      archived public workbench runs
  - clean distinction between live account state, paper account state, and
    simulated account state
- Add strategy drilldowns:
  - entry and exit chart markers
  - signal values and thresholds
  - expected hold window
  - current stop/exit state
  - MAE/MFE where available
  - recent near-threshold missed signals
- Add a Help page and contextual help:
  - first-run checklist
    - done on the Help page
  - "What am I looking at?" explanations for each major page
    - done in the Help page guide grid
  - "How do I know today's strategy performance?" walkthrough
    - done on the Help page
  - "Why do I only see SPY and QQQ?" diagnostic walkthrough
    - done on the Help page
  - "How do I inspect historical data I already fetched?" walkthrough
    - done on the Help page
  - "What should be private before publishing this repo?" checklist
    - done on the Help page
  - glossary: runner, draft, replay, shadow, simulated paper, paper, fill,
    reject, artifact, data root, stale bar
    - done on the Help page
  - links to the relevant quickstart sections
    - done; Help links to allowlisted local Markdown docs served by the
      dashboard, including the Web UI runbook, quickstart, privacy, publication,
      and work queue docs
  - empty states that explain what to do next instead of showing blank tables
- Add a short web UI README/runbook:
  - how to start the local dashboard
  - how to configure data roots
  - how to find current strategy performance
  - how to inspect a saved data file
  - how to diagnose "only SPY/QQQ are visible"
  - how to distinguish live, paper, simulated paper, shadow, and replay results
  - what should stay private before publishing
  - done in `docs/web_ui_runbook.md` and linked from Help
- Improve visual design:
  - brokerage-app visual rhythm: portfolio value first, concise stats, light
    surfaces, clear green/red performance language, and calm typography
  - modern app-shell layout, restrained cards, clean spacing, readable tables
  - a cleaner top-level hierarchy so users are not forced through dense
    developer tables before seeing performance
  - green/red performance language, neutral backgrounds, clear status badges
  - responsive mobile/tablet views
  - chart-first summaries instead of dense text-first tables
  - avoid nested cards and oversized marketing layout
- Add a small design system for the dashboard:
  - color tokens for cash/equity/gain/loss/warning/neutral states
  - consistent badge styles for modes, health, fills, rejects, and stale data
  - consistent chart sizing and empty chart states
  - reusable table toolbar patterns for search, filters, and export/copy actions
  - mobile navigation behavior that keeps the main action visible
- Reduce cognitive load:
  - hide developer-only raw JSON/log details behind drilldowns
  - make dense tables secondary to charts and summary cards
  - default every page to the most common question a user has on that page
  - add "last updated" and source labels beside every derived metric
- Add UI quality gates:
  - screenshot-smoke every top-level page at desktop and mobile widths
    - partial; `scripts/smoke_dashboard_screenshots.py` now starts the
      dashboard with seeded synthetic state and captures every top-level view
      at desktop and mobile sizes with Chrome/Chromium when available.
  - empty-state smoke tests for no status, no data roots, no runs, and no saved
    drafts
    - partial; `scripts/smoke_dashboard.py --scenario empty` now exercises a
      no-data/no-fetch-manifest state, and pytest runs the empty scenario as a
      dashboard endpoint/render contract check.
  - seeded demo-state smoke tests with many symbols, multiple runs, fills,
    rejects, and warnings
    - partial; `scripts/smoke_dashboard.py --scenario seeded` now creates a
      synthetic many-symbol saved-data root, fetch manifest, and generic paper
      telemetry snapshot, and pytest runs that seeded scenario.
  - accessibility pass for labels, focus states, keyboard navigation, and color
    contrast
    - partial; `scripts/smoke_dashboard_accessibility.py` now checks static
      dashboard controls/buttons for accessible names, validates top-level nav
      targets, verifies explicit focus-outline styling, and runs basic color
      contrast checks against dashboard tokens.
  - no overlapping text in tables, cards, charts, or mobile navigation

## P0: Data Library and saved-data visibility

Goal: make all fetched historical data visible and inspectable. If only SPY and
QQQ show up, treat that as a bug until proven otherwise.

- Progress: Data Library now shows configured roots, catalog limits, visibility
  warnings, and suggested local roots such as an existing cache directory that
  contains data but is not currently configured. The dashboard server can now
  load `dashboard.data_roots` from config while CLI `--data-root` values remain
  available for one-off overrides. Catalog rows now include inferred asset class
  and source filters. Data Library now includes a coverage heatmap-style view
  and a symbol diagnostic that explains visible, scan-limited, parse-error,
  unconfigured-root, fetch-error, and not-found states. Data Detail now has an
  offline saved-file viewer with date range controls, sampled/full-in-range
  modes, price series, volume bars, and UTC/source-timezone context.
- Audit all historical fetch outputs and data roots:
  - identify where stock 1m, stock 5m, crypto 1m, crypto 5m, and sample files
    are written
  - verify whether hundreds of fetched symbols exist on disk
  - verify whether dashboard data roots are only pointed at example data
  - verify whether parquet files, cache paths, or naming conventions are being
    skipped by the catalog scanner
  - report exact counts by root, asset class, bar size, file extension, source,
    and skipped-file reason
  - show whether a symbol is missing because the file does not exist, the root
    is not configured, the parser skipped it, the timestamps failed validation,
    or the source returned no data
    - partial; the symbol diagnostic now checks configured roots, suggested
      roots, parse errors, catalog scan limit, and fetch manifest clues
- Expand data-root configuration for the dashboard:
  - support multiple roots in config and CLI
  - include real cache roots in private/local config
  - keep public examples pointed at small example data only
  - show active roots and skipped roots in the UI
- Add a real Data Library page:
  - symbol search
  - asset class filter: stock, ETF, crypto, unknown
  - bar-size filter
  - source filter: IBKR, Schwab, Polygon, FirstRate, file, unknown
  - quality filter
  - coverage range table for every symbol
  - row count, gaps, duplicate timestamps, timezone, adjustment metadata
  - last updated time and file size
- Add a saved-data browser that can start from all scanned symbols, not just
  SPY/QQQ demo files:
  - show total symbols/files found by root
    - partial; Data Library now has first-screen summary cards for unique
      scanned symbols, catalog-visible files, aggregate row/size counts,
      coverage range, and quality/parser-error state.
  - show which roots are public examples versus private/local caches
    - partial; diagnostics and storage-audit root rows now expose
      public-example/local-cache/private/local-path scope metadata, and Data
      Library root cards plus the Storage Audit table display that scope.
  - show why a root was not scanned
    - partial; Catalog Scan Diagnostics now includes not-scanned reasons for
      missing roots, non-directories, catalog-limit caps, and root scan errors.
  - show why a file was skipped
    - partial; root scan summaries now include bounded skipped-file samples for
      parser errors and unsupported extensions, and the Data Library table shows
      a skipped sample path plus reason.
  - include a "show me everything on disk" diagnostic mode with bounded limits
    - partial; Storage Audit now has a user-selectable bounded per-root disk
      scan limit up to 50,000 files, and shows multiple hidden file samples so
      users can inspect what exists on disk beyond the catalog-visible rows.
- Add a backend storage audit command and matching dashboard panel:
  - done; `scripts/audit_data_storage.py`, the storage-audit endpoint, and the
    Data Library panel compare configured/suggested root files with
    catalog-visible rows
  - enumerate stock 1m, stock 5m, crypto 1m, crypto 5m, and sample data
  - compare files on disk to dashboard-visible catalog rows
  - summarize missing symbols, malformed files, unsupported extensions, and
    capped scans
  - recommend config changes when real cache roots are absent
- Add historical-data visualization:
  - line/candlestick chart for saved files
    - partial; saved files now have a range-filtered close-price chart,
      candlesticks remain open
  - volume chart
    - done for the sampled Data Detail viewer when volume exists
  - selectable date range
    - done for Data Detail viewer
  - symbol picker that can load every scanned symbol, not just public examples
    - partial; every scanned catalog row can be inspected, richer typeahead
      symbol picking remains open
  - gap markers
    - partial; gaps are listed in the detail table, chart markers remain open
  - sampled and full-resolution modes
    - partial; sampled mode is default and full mode is available when the
      selected range fits the bounded point limit
  - compare two or more symbols on the same time range
    - partial; Data Library now has a saved-data comparison panel and
      `/data_compare` endpoint for normalized close paths over one date range
  - offline mode for browsing saved files without connecting to IBKR or any
    live runner
    - done for configured saved data roots
  - clear timestamp timezone display and conversion to local/UTC/Eastern where
    relevant
    - done for Data Detail and Compare Saved Data; source timezone and
      normalized UTC are shown, and saved-data ranges, gaps, and chart captions
      can be displayed as UTC, local time, or US Eastern.
- Add historical-data workflows:
  - pick any scanned symbol and bar size
    - partial; Data Detail and Compare Saved Data are populated from scanned
      catalog rows
  - inspect a date range without starting a live runner
    - done for single-file Data Detail and partial for multi-file comparison
  - compare several symbols over the same window
    - partial; Compare Saved Data overlays normalized close-return paths
  - export/copy the local file path and generated replay command
    - partial; Data Library rows and Data Detail can copy the local file path,
      a `--data-root` flag, and a replay-starter command. Fully generated
      strategy-specific replay commands still come from saved Workbench drafts.
  - flag suspicious files before they are used in a strategy replay
    - done for Workbench-generated drafts; selected dataset quality is visible
      before draft generation, `/data_alignment`/draft alignment payloads carry
      quality status and warning counts, and `/config_draft` requires explicit
      `allow_quality_warnings` acknowledgement before generating a runnable
      draft from warn/bad files.
- Add data coverage diagnostics:
  - coverage heatmap by symbol/date
    - partial; Data Library now renders recent date-bin coverage by symbol
  - missing-day and missing-minute summaries
    - partial; dataset details show gap rows/missing intervals, coverage view
      shows missing recent date bins; minute-level aggregate heatmaps remain
      open
  - "why is this symbol not visible?" diagnostic
    - done for configured/suggested roots, parser failures, catalog limits, and
      fetch-manifest clues
  - data-root scan errors in the UI
    - partial; catalog parser errors and root diagnostics are visible
  - root-by-root scan duration, file count, skipped count, and parser error
    count
    - partial; Data Library now shows catalog scan diagnostics with per-root
      candidate, parsed, parser-error, unsupported-file, cap/reason, and scan
      duration fields. Storage Audit still handles deeper full-root file counts.
  - warning when the catalog result is capped and not all symbols are shown
    - done in the Data Library visibility card
- Add saved fetch manifests:
  - Progress: stock and crypto fetchers write dashboard-readable JSON manifests
    under `paper_logs/fetch_manifests` by default; the dashboard has Fetch Jobs
    list/detail endpoints and UI. The crypto fetcher still keeps its chunk CSV
    for resumability.
  - every fetch run should write a manifest with symbols, bar size, duration,
    start/end, output files, success/failure counts, pacing pauses, and errors
    - mostly done; remaining gap is richer pacing-pause and retry summaries in
      the JSON manifest
  - manifests should be visible from the dashboard
    - done for list/detail views
  - failed/missing symbols should be resumable from a manifest
    - partial; crypto still resumes from chunk CSV/empty markers, but JSON
      manifest resume input is not implemented yet
  - fetch manifests should connect directly to Data Library rows so a user can
    go from a completed fetch job to the symbols and files it produced
    - partial; output paths under configured data roots now link directly to
      Data Detail, manifest-driven resume remains open

## P1: Fetch jobs and backend data reliability

- Add fetch-job screens:
  - active/completed jobs
    - completed jobs are visible; active jobs appear when the manifest is being
      updated during a running fetch
  - progress by symbol and chunk
    - partial; symbol/chunk summaries are visible from the JSON manifest
  - rolling ETA based on recent chunk time
    - logged by crypto fetcher, not yet persisted into JSON manifests
  - success/failure/retry counts
    - partial; success/failure/no-data counts are persisted, retry counts need
      richer per-attempt recording
  - pacing waits
    - partial; configured pacing delay is persisted, actual wait events are not
      summarized yet
  - current output path
    - done for manifest outputs and latest output path
- Standardize historical storage:
  - consistent symbol naming
  - consistent bar-size naming
  - UTC-normalized timestamp storage with source timezone metadata
  - adjustment metadata for stocks
  - clear distinction between RTH, extended hours, and 24/7 crypto
- Add resumability:
  - skip chunks already present
  - retry failed chunks
  - mark no-data responses separately from permission errors
  - persist enough state to resume after Gateway or PC restart
- Add backend tests for catalog discovery:
  - many-symbol fixture roots
    - done; tests now create 200+ nested synthetic saved files and assert the
      catalog shows far more than public examples
  - CSV and parquet coverage
    - done for CSV stock files and a parquet Zero Hash-style crypto file
  - nested cache paths
    - done for nested `cache/ibkr/...` and `cache/zerohash/...` paths
  - crypto 24/7 files
    - partial; crypto parquet discovery is covered, minute/day completeness
      semantics remain open
  - malformed/skipped files with visible reasons
    - partial; parser failures and unsupported files are covered by catalog
      scan diagnostics, deeper malformed-minute cases remain open
- Add data ingestion acceptance tests:
  - a fixture with hundreds of synthetic symbols must show more than the public
    SPY/QQQ examples
    - done for the Data Catalog endpoint
  - nested stock cache paths must be discovered
    - done
  - nested crypto cache paths must be discovered
    - done
  - parser skip reasons must be returned to the UI, not only logged
    - partial; catalog root summaries and Data Library scan diagnostics expose
      parser error counts/sample errors and unsupported-file counts
  - catalog limits must be visible and user-adjustable through config
    - partial; Data Library exposes catalog limit controls and scan diagnostics
      show limit-capped roots. The UI now exposes the backend's 1000-row bound,
      and catalog CSV export uses the selected scan limit instead of a
      hard-coded smaller export size.

## P1: Public workbench usability

- Turn config building into a guided flow:
  - choose data
  - inspect alignment
  - choose example/private plugin
  - choose mode
  - review risk limits
  - validate
  - run
  - inspect results
  - partial; Workbench now has a visible Simulate From Saved Data guide that
    tracks data selection, data quality, alignment, draft generation,
    validation/run state, and artifact inspection. The form remains static;
    schema-driven step rendering is still separate work.
- Add clearer separation between public example configs and local private
  strategy configs.
  - partial; Workbench plugin options now carry visibility/description/boundary
    metadata, the selector labels public examples explicitly, and the UI shows
    that public drafts are for generic example plugins while private strategies
    belong in ignored local configs. Loading private plugin registries into the
    public Workbench remains future work.
- Add schema-driven form rendering after config schemas are reliable.
- Add saved draft folders/tags/status labels.
  - done for the Workbench saved-drafts table; draft records now expose folder,
    status label, and tags derived from mode/status/plugin/symbol count, and
    the UI displays them beside validation/output state.
- Add safer empty states and validation messages.
  - partial; Workbench draft generation, alignment, saved drafts, draft
    validation, and run tables now show next-step guidance instead of blank or
    generic `none` states. Broader seeded empty-state smoke across every page
    remains part of UI quality gates.
- Add a "copy command" affordance for local CLI commands.
  - done for generated Workbench local commands
- Add a guided "simulate from saved data" path:
  - choose one or more scanned symbols
  - choose a date range
  - select an example or private plugin
  - validate data alignment
  - run replay or simulated paper
  - open the resulting performance page
  - partial; the Workbench guide now gives this path an explicit step status
    and points users from saved data through alignment, draft, run, and artifact
    inspection. Date-range controls are now in the Config Builder, alignment
    previews show the selected filter window, generated configs persist
    `data.start`/`data.end`, and the public plugin runner filters file replay
    data to that window. Run and draft tables now expose Results buttons that
    load artifacts and navigate directly to Performance. Richer schema-driven
    controls remain future work.
- Add a guided "paper monitor" path:
  - verify Gateway/API status
  - verify account state freshness
  - verify current config and mode
  - show whether the runner is actively streaming/evaluating
  - show what condition would trigger the next order
  - partial; Operations now has a Paper Monitor checklist that checks
    Gateway/API reachability, account freshness, current run config/mode,
    market-data/decision observation, and next-order or latest-order context
    from generic telemetry. Private/specialized runners still need to publish
    richer next-decision fields for this to become fully green in all modes.

## P1: Operations and cloud monitoring

- Add real cloud endpoint support beyond the local mock receiver.
  - partial; the receiver already accepts authenticated status posts and command
    polling over HTTP, and now exposes `/remote_nodes` for sanitized latest
    read-only monitoring summaries by node. Deployment-oriented hosting docs
    and cloud-provider examples remain open.
- Add read-only remote monitoring pages:
  - current strategy state
  - account/paper equity
  - positions
  - open orders
  - recent signals/fills/rejections
  - heartbeat and stale-data status
  - partial; Operations now has a Remote Nodes table backed by `/remote_nodes`
    with node heartbeat, Gateway, mode, equity, position count, open-order
    count, recent decision/order/fill/rejection counts, latest account/data
    age, and alerts from sanitized status posts.
- Add alerts:
  - missed heartbeat
  - Gateway login required
  - API disconnected
  - stale bars
  - stale account snapshot
  - rejected orders
  - risk-limit trips
  - unexpected flat or positioned state
  - partial; the status publisher now emits generic alerts for stale run
    heartbeat, Gateway unreachable/API disconnected/login-required clues,
    stale market-data bars, stale account snapshots, rejected orders,
    risk-limit-like rejection reasons, and opt-in expected flat/positioned
    state mismatches. Dashboard alert display already surfaces the emitted
    alert rows; richer broker-native login/order-state categories still depend
    on runner/broker telemetry.
- Add historical run pages in the cloud view with bounded artifacts and logs.
  - partial; `/remote_node_detail` and the Operations Remote Node Detail panel
    now provide bounded sanitized latest runs, alerts, and status history for
    a posted node. It intentionally avoids raw local logs or strategy
    diagnostics; richer cloud-side archived artifact/log browsing remains open.
- Keep broker credentials and trading authority on the local machine.

## P2: Generic runner and framework hardening

- Extend `live/plugin_runner.py` from one-shot/replay execution into continuous
  market-hours loops where needed.
- Add versioned config schemas and richer per-plugin validation.
- Add optional order previews and manual approval hooks for paper/live mode.
- Add richer simulated-paper accounting:
  - realized PnL
  - average cost
  - borrow constraints
  - commission schedules
  - slippage models
- Add broker-agnostic execution adapters so private configs can choose IBKR,
  file-based simulation, or future broker integrations without changing
  strategy plugins.
- Add stronger paper/live gates to prevent accidental live orders.

## P2: Publication readiness

- Keep the exported public repo as the clean public candidate.
- Add CI checks around `python3 scripts/public_readiness_audit.py --fail-on-review`.
- Do final manual review before pushing to GitHub.
- Finish blog post polish.
- Add runbooks:
  - IBKR Gateway setup and recovery
  - paper trading startup/shutdown
  - market-data permission diagnosis
  - service restart
  - failed order diagnosis
- Keep private strategy configs, tuned universes, research outputs, account IDs,
  logs, and credentials out of the public repo.

## P3: Remote control hardening

- Add authentication, authorization, audit logging, rate limits, and explicit
  local safety gates before expanding remote commands.
- Keep initial commands low-risk:
  - pause
  - resume
  - flatten simulated positions
  - restart child process
  - request fresh status
- Keep higher-risk commands behind stronger local confirmations:
  - live flattening
  - changing strategy config
  - enabling live orders
- Write immutable audit records locally and remotely for every command.

## P4: Execution quality

- Paper-test IBKR stock execution styles:
  - market
  - MIDPRICE
  - adaptive market
  - adaptive limit
  - adaptive priority variants
- Log decision-time bid/ask, submit bid/ask, order type, limit/cap price, fill
  time, average fill, effective spread capture, and missed-fill rate.
- Run A/B paper tests before changing defaults away from market orders.
- Keep crypto order handling separate from stock execution algos.

## P5: Trading research

Trading research is intentionally below UI, data reliability, operations, and
framework work for now. Do not promote new strategy experiments above the
dashboard/data work unless there is a direct operational need for paper trading
or data validation.

- Continue crypto candidate robustness checks only after monitoring and data
  visibility are improved.
- Continue stock paper observations and near-threshold diagnostics.
- Fetch and evaluate more 1m data when the data-library/fetch-job path can show
  what was fetched and what is missing.
- Add new strategy sleeves only when they are clearly orthogonal and have clean
  train/test or walk-forward validation.
- Revisit 1m lead-lag only with the pre-committed null and coverage gates.
