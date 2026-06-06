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
  - partial; Overview now includes a Today at a Glance panel that synthesizes
    telemetry, current-day return, trade state, saved-data visibility, and the
    next best dashboard action before the denser health/order/timeline tables.
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
  - partial; each top-level view now has a reusable page-intro strip with the
    view's primary question, current public telemetry/data counts, and two
    navigation actions so users can orient themselves before reading dense
    tables.
  - partial; the page-intro strip now includes a compact per-view workflow rail
    with the main four-step path for Overview, Performance, Data Library, Fetch
    Jobs, Workbench, Runs, Operations, and Help, so users get immediate
    "what do I do here?" guidance before dense tables.
- Add route-like navigation state so each top-level view can be deep-linked,
  refreshed, and shared by URL/hash without losing context.
  - done for top-level dashboard views with URL hash navigation
- Add a brokerage-style "Strategy Home" view:
  - active strategy name, mode, and status
  - portfolio/equity headline first, not log tables
  - today's PnL/return, recent PnL/return, open exposure, and current risk
    - partial; Overview now has a Performance Snapshot section that derives
      latest day, month, year, all-available return, max drawdown, current
      equity path, and order/fill/reject/alert activity from sanitized
      status-history rollups without opening logs.
  - clear "no trade today" state with the latest checked signal
    - partial; Overview now has a Today's Signal State panel that separates
      no current run, awaiting a current-day check, no-trade-today,
      order-submitted, filled, and rejected-order states from sanitized
      current-day events, and it shows the latest checked decision detail.
    - partial; Overview now also has a Today at a Glance panel that summarizes
      no-telemetry, data-root, alert, rejected-order, open-order, position-open,
      awaiting-signal, filled, and normal monitoring states with direct next
      actions.
  - open positions and pending orders before archived run tables
  - one-click drilldown into the source run/session/artifacts
  - partial; the Overview hero now shows equity first plus mode, Gateway,
    latest signal/fill, cash, today return, week return, gross exposure, and
    next expected check when those generic telemetry/artifact fields are
    available.
  - partial; Overview now includes a Current Orders section above archived run
    tables, backed by recent non-terminal public-safe order telemetry.
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
    - partial; Data Library now includes a contextual guide that turns current
      root, catalog-cap, parser-skip, symbol, Data Detail, and Workbench
      selection state into concrete next actions.
    - partial; Data Library now includes a Symbol Profile panel near Symbol
      Browser that summarizes a selected symbol's files, coverage, quality,
      best saved file, and direct Inspect, Workbench, Compare, Filter, and
      Diagnose actions before the dense catalog table.
    - partial; Symbol Profile now also renders a compact best-file preview
      chart from catalog preview points, making a symbol visually inspectable
      before opening the full Data Detail viewer.
    - partial; Data Library can now copy a `dashboard.data_roots` YAML block
      built from configured and scanner-suggested roots, giving users a direct
      local-config fix when real history exists outside scanned roots.
    - partial; symbol diagnostics now bound suggested-root file counts so a
      missing-symbol check cannot hang on very large local history roots while
      still reporting whether the count was capped.
    - partial; Fetch Jobs can now copy a `dashboard.fetch_manifest_roots` YAML
      block from visible manifest roots, giving users the matching config fix
      for fetch-history visibility.
    - partial; Fetch Jobs now includes a contextual Fetch Workflow checklist
      that turns root readability, loaded jobs, filters, selected outputs, Data
      Library visibility, and recovery/export state into concrete next actions.
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
    - partial; simulated-paper account artifacts now publish realized PnL,
      unrealized PnL, total PnL, total commission, and average costs, and the
      Overview/Performance pages display realized/unrealized PnL when those
      fields are available.
  - today's return, week/month return, cumulative paper return
    - partial; cumulative/latest artifact return is available in Performance,
      period-specific live paper summaries are not implemented
  - latest bar time, latest signal time, latest order/fill/rejection
    - partial; latest signal and fill are shown from recent events, latest bar
      and rejection need dedicated telemetry fields
    - partial; Overview now adds first-viewport Latest Bar and Latest Reject
      tiles from generic runner market-data timestamps and rejected/canceled
      order events.
  - next expected decision window
    - partial; Overview shows a Next Check tile when generic telemetry includes
      `next_decision_time`, `next_expected_decision_time`, `next_check_time`, or
      `next_signal_time`.
  - stale-data, stale-account, rejected-order, risk-limit, and gateway-login
    alerts
    - partial; published alerts and Gateway state are visible, specialized alert
      categories depend on runner telemetry
    - partial; Overview now has a Current Alerts table so stale-data,
      stale-account, rejected-order, risk-limit, gateway, and other published
      alerts are visible on the starting page before drilling into Operations.
  - open-position cards with symbol, entry time, entry price, current price,
    PnL, age, intended hold window, and active exit rule
    - partial; position cards show symbol, quantity, and value when account
      snapshots include position values. Entry/exit-rule fields need strategy
      telemetry.
    - partial; sanitized account snapshots now preserve public-safe average
      cost, current value/price, unrealized PnL by symbol, and borrow fees, and
      Overview/Runs position cards render those fields when present.
    - partial; sanitized account snapshots now also preserve allowlisted
      per-symbol position details such as entry time/price, hold window, active
      exit rule, stop/target, and MAE/MFE, and position cards render them with
      derived age when runners publish those fields.
  - today's event timeline from market open/current session start through the
    latest decision
    - partial; Overview now shows the latest bounded decision/order/fill
      timeline from telemetry
    - partial; the Overview timeline is now current-telemetry-day aware,
      showing today's decision/order/fill events first with a recent-event
      fallback when no current-day events have been published.
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
    - partial; Performance now shows a Today / Latest Session panel with
      session PnL, return, high/low PnL, snapshot count, and an intraday PnL
      curve derived from account snapshots. Runner telemetry still needs to
      publish richer live minute/account snapshots for this to be useful in all
      paper/live modes.
  - open/closed trade table
    - done for selected archived artifacts with sanitized fills
    - partial; Performance now adds open/closed/win-rate/shown summary cards
      and state, side, and symbol filters above the sanitized fill-derived
      trade table.
  - win/loss, average win/loss, profit factor, max drawdown, exposure, turnover
    - done for selected archived artifacts; win/loss, average win/loss, profit
      factor, max drawdown, exposure, and selected-window turnover are derived
      from sanitized fills/account snapshots when available.
  - benchmark overlay where appropriate
    - partial; Performance can now load any saved Data Library dataset as an
      explicit benchmark and overlay normalized strategy equity return against
      normalized benchmark close return.
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
  - partial; Strategy Performance now starts with triage cards for selected
    source richness, period/account-snapshot coverage, return/drawdown,
    execution health, trade pairing, live/paper rollups, benchmark state,
    account freshness, and the next action.
  - partial; Strategy Performance now also has a Performance Home band with
    selected result, source/window/execution/trade/freshness/benchmark tiles,
    and direct navigation to Runs, Workbench, and Data Library.
  - partial; Overview now surfaces a smaller current Performance Snapshot from
    status-history rollups so the common "how is it doing today/recently?"
    question is visible before entering the full Performance page.
- Add strategy/session comparison only after the current-strategy page is easy
  to read.
  - partial; Runs now has a filtered Comparison Summary plus a Mode filter so
    replay, shadow, simulated-paper, paper, and other summarized run sets can
    be compared by coverage, best return, lowest/worst drawdown, execution
    activity, short-horizon warnings, and next action before reading the dense
    run table.
- Add daily run rollups so the dashboard can answer "how did it do today?" for
  each day the service was running.
  - partial; Performance now shows archived account-artifact daily rollups by
    UTC day with return, equity, orders, fills, rejects, and artifact drilldown
- Add persistent period summaries so daily/monthly/yearly stats do not depend
  on a currently open process.
  - partial; daily, monthly, and yearly rollups are derived from archived
    workbench account artifacts, dedicated live paper rollup storage remains
    open
  - partial; `/status_equity_rollups` now derives daily/month/year summaries
    from sanitized status-history snapshots, and Performance shows Live/Paper
    Status Rollups without opening archived artifacts.
  - partial; the dashboard now persists latest sanitized status rollups under
    `paper_logs/cloud_status_server/status_equity_rollups/` on status ingest
    and rollup reads, and `/status_equity_rollups_snapshot` exposes the latest
    saved JSON artifact.
  - partial; generic plugin-runner runs now write runner-owned
    `performance_rollups.json` artifacts beside `summary.json`, with daily,
    monthly, and yearly account-equity rollups derived from the run's account
    snapshots. Archived Run Artifacts now load and render those runner-owned
    daily/month/year rollups and include them in artifact JSON exports.
    Specialized/private runners still need to publish the same generic artifact
    if they do not use `live/plugin_runner.py`.
  - partial; Performance now also renders Live/Paper Period Rollups for
    month/year summaries from status-history equity snapshots, with node count,
    snapshot count, observed sanitized activity, and alerts.
  - partial; Performance now exposes `/status_equity_rollups_export` and an
    Export Status CSV button for offline review of live/paper status-history
    daily, monthly, and yearly equity rollups.
  - partial; Performance now charts live/paper status-history end-of-day equity
    by node plus recent daily return bars, making current/published strategy
    performance readable without opening archived artifacts.
- Add a Runs and Orders page:
  - searchable run history
    - done for saved run comparison rows
    - partial; the Runs page now has client-side search, status/mode filters,
      and sort controls for current published run telemetry, plus search,
      type/status filters, and sorting for the recent run-event timeline.
  - session timeline of decisions, orders, fills, rejects, account snapshots
    - partial; Run Artifacts now include a combined sanitized session timeline
      that interleaves decisions, orders, rejected orders, fills, and account
      snapshots, plus a dedicated account-snapshot table for equity, cash,
      exposure, and position counts.
    - partial; artifact account snapshots now include an expandable public-safe
      position-detail view so entry/hold/exit context is readable without raw
      JSON when runners publish that metadata.
  - current open orders and current managed positions
    - partial; current managed positions and recent non-terminal order events
      are visible, broker-native open-order state still depends on runner
      telemetry
    - partial; the Overview page now surfaces the same recent non-terminal
      order telemetry before users drill into Runs and Orders.
  - drilldown for a run with artifacts, logs, and performance charts
    - partial; artifacts, logs, and performance charts are inspectable for
      archived public workbench runs
  - clean distinction between live account state, paper account state, and
    simulated account state
    - partial; Runs now starts with triage cards for published runs, current
      open-order telemetry, managed positions, recent events, fills/rejects,
      loaded artifact detail, and the next inspection action before dense
      status/run/event tables.
    - partial; Runs now has Account State Boundary cards that distinguish
      selected source type, live/paper/simulated/replay authority, account
      snapshot freshness, managed positions, current telemetry, open-order
      signals, and the next verification action.
- Add strategy drilldowns:
  - entry and exit chart markers
  - signal values and thresholds
  - expected hold window
  - current stop/exit state
  - MAE/MFE where available
  - recent near-threshold missed signals
  - partial; public-safe strategy drilldowns now use an explicit
    `diagnostics.dashboard` allowlist. Run Artifacts render signal label/value,
    threshold distance, near-threshold state, expected hold, exit/stop state,
    and MAE/MFE when a plugin publishes those fields. Raw signal and diagnostics
    payloads remain hidden.
  - partial; Run Artifact equity charts now render public-safe entry/exit
    markers and a marker legend from sanitized fills and
    `diagnostics.dashboard` marker labels.
  - partial; Run Artifacts now include a dedicated Near-Threshold Misses table
    for public-safe decisions that came close to threshold but emitted no order
    intents.
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
  - common workflows that connect Overview, Performance, Fetch Jobs, Data
    Library, Workbench, and Runs
    - done on the Help page and mirrored in the Web UI runbook
    - partial; Help now starts with a question-driven Start Here panel that
      routes users to current health, performance, saved data, simulation, run
      drilldowns, and operations diagnostics before dense reference cards.
    - partial; Help and the Web UI runbook now document the direct workflow
      shortcuts from Data Detail, Compare Saved Data, and Fetch Detail into
      Workbench, plus the Workbench result shortcuts into Performance and Runs.
  - empty states that explain what to do next instead of showing blank tables
    - partial; Help now has a dynamic Current Setup Gaps panel that reads
      sanitized dashboard state and links users to the right page for missing
      telemetry, Gateway/API checks, unreadable data roots, catalog caps,
      missing fetch manifests, and missing Workbench drafts.
- Add a short web UI README/runbook:
  - how to start the local dashboard
  - how to configure data roots
  - how to find current strategy performance
  - how to inspect a saved data file
  - how to diagnose "only SPY/QQQ are visible"
  - how to distinguish live, paper, simulated paper, shadow, and replay results
  - what should stay private before publishing
  - done in `docs/web_ui_runbook.md` and linked from Help
  - done; the runbook now includes completed-fetch review and replay-from-saved
    data workflows that match the Help page
  - partial; Help and the Web UI runbook now include a Data To Simulation Fast
    Path that names the current first-screen panels: Data Source Map, Data
    Home, Fetch Recovery Plan, and Workbench Home.
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
  - partial; Help now has a standalone first-screen Start Here panel with
    route links, keeping the operating guide closer to a task picker than a
    long documentation dump.
  - partial; Performance now adds a first-screen summary band before detailed
    KPIs and charts, so the selected strategy/source result is visible before
    dense metric context and artifact tables.
  - partial; Performance now adds a first-screen Performance Story panel that
    translates the selected source/window into outcome, risk, evidence quality,
    operational trust, and the next read before detailed KPIs and charts.
  - partial; every top-level page now starts with compact workflow steps in
    the shared intro, improving first-screen orientation without adding another
    static documentation block.
- Add a small design system for the dashboard:
  - color tokens for cash/equity/gain/loss/warning/neutral states
  - consistent badge styles for modes, health, fills, rejects, and stale data
  - consistent chart sizing and empty chart states
  - reusable table toolbar patterns for search, filters, and export/copy actions
    - partial; Saved Data now includes an explicit sort control for newest file,
      symbol, row count, file size, latest bar, and quality-first ordering.
  - mobile navigation behavior that keeps the main action visible
    - partial; mobile dashboard navigation now uses a sticky horizontal tab
      rail instead of a compressed two-column sidebar, active nav items set
      `aria-current`, and screenshot layout checks assert the active mobile tab
      remains visible
- Reduce cognitive load:
  - hide developer-only raw JSON/log details behind drilldowns
    - partial; dense Operations/History JSON cells for status counts, command
      params, and command results now render as compact expandable drilldowns
      instead of raw pretty-printed blobs
    - partial; Workbench status, Fetch Detail, and artifact position maps now
      use the same compact drilldown treatment
  - make dense tables secondary to charts and summary cards
  - default every page to the most common question a user has on that page
  - add "last updated" and source labels beside every derived metric
    - partial; Overview and Performance cards now show compact source/freshness
      metadata for live telemetry, run summaries, account snapshots, selected
      windows, and fills-derived trade metrics
- Add UI quality gates:
  - screenshot-smoke every top-level page at desktop and mobile widths
    - partial; `scripts/smoke_dashboard_screenshots.py` now starts the
      dashboard with seeded synthetic state and captures every top-level view
      at desktop and mobile sizes with Chrome/Chromium when available.
    - partial; the screenshot smoke can now run `--check-layout` to verify
      each top-level view at desktop and mobile widths for horizontal viewport
      overflow and clipped core UI text.
  - empty-state smoke tests for no status, no data roots, no runs, and no saved
    drafts
    - partial; `scripts/smoke_dashboard.py --scenario empty` now exercises a
      no-data/no-fetch-manifest state, and pytest runs the empty scenario as a
      dashboard endpoint/render contract check.
    - partial; `scripts/smoke_dashboard_screenshots.py --scenario empty
      --check-layout` now captures every top-level view at desktop/mobile
      widths against an empty no-status/no-data/no-fetch state, and CI runs it
      beside the seeded screenshot layout gate.
    - partial; smoke checks now assert the Data Home shortlist and Help Start
      panel remain present, and screenshot overflow checks cover their card
      labels so these first-screen guide surfaces do not regress silently.
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
    - partial; CI now runs the screenshot smoke with layout checks against
      seeded desktop and mobile views. The gate covers viewport overflow and
      clipped core dashboard text; richer pixel-level overlap detection remains
      future work.

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
  unconfigured-root, fetch-error, and not-found states. Data Library now starts
  with a Data Home summary that explains how many symbols/files are loaded,
  what the current filters hide, the best inspectable match, asset/source/bar
  breakdowns, and the next action before sending users into dense tables. Data
  Detail now has an offline saved-file viewer with date range controls,
  sampled/full-in-range modes, price series, volume bars, and
  UTC/source-timezone context. The catalog now also publishes server-owned
  symbol summaries and a symbol-directory CSV export so users and API clients
  can verify the saved-data universe by symbol without reconstructing it from
  individual file rows.
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
  - partial; Data Library now exposes a Copy data_roots YAML action that
    includes configured and suggested roots for ignored local dashboard config
    updates.
- Add a real Data Library page:
  - symbol search
  - asset class filter: stock, ETF, crypto, unknown
  - bar-size filter
  - source filter: IBKR, Schwab, Polygon, FirstRate, file, unknown
  - quality filter
  - coverage range table for every symbol
  - row count, gaps, duplicate timestamps, timezone, adjustment metadata
    - partial; Data Library rows now expose inferred storage session and
      adjustment metadata alongside source timezone.
    - partial; Saved Data filters now include storage session, so users can
      narrow detailed rows to RTH, extended-hours, 24/7 crypto, or unknown
      files without relying on text search.
    - partial; `/data_catalog` now includes per-symbol summaries with file
      counts, row counts, size, sources, bar sizes, storage sessions, quality
      counts, ranges, and best inspectable paths.
  - last updated time and file size
    - partial; Saved Data rows now show file size plus last-modified age, Data
      Detail includes file size and modified time, and the summary card labels the
      latest catalog modification with age.
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
  - partial; the dashboard now exposes `/data_storage_audit_export` and an
    Export Audit CSV button so root-by-root file counts, hidden-file counts,
    extension/source breakdowns, and suggested roots can be reviewed offline.
  - partial; Storage Audit rows now carry per-root scan duration and the
    summary/CLI report include total root scan time, making slow roots visible.
  - enumerate stock 1m, stock 5m, crypto 1m, crypto 5m, and sample data
    - partial; Storage Audit already guesses source, asset class, and bar size
      per file, and the dashboard table now surfaces asset/bar/source
      breakdowns per root instead of only extension/source counts.
  - compare files on disk to dashboard-visible catalog rows
    - partial; the storage-audit endpoint now returns an explicit
      `visibility_summary`, and Data Library renders Visibility Gap cards for
      configured-root visibility percentage, hidden configured files,
      suggested-root files, unsupported files, and scan caps before the dense
      root table.
  - summarize missing symbols, malformed files, unsupported extensions, and
    capped scans
  - recommend config changes when real cache roots are absent
    - partial; Storage Audit now renders action cards that recommend adding
      suggested roots, raising scan limits, inspecting hidden configured-root
      files, or reviewing parser/root scan errors before using the catalog.
    - partial; Storage Audit now also counts unsupported-extension files,
      exports unsupported counts/samples, and shows bounded unsupported path
      samples beside hidden-file samples in the dashboard.
- Add historical-data visualization:
  - line/candlestick chart for saved files
    - partial; saved files now have a range-filtered close-price chart,
      candlesticks remain open
    - partial; Data Detail now supports a candlestick chart mode when saved
      files expose OHLC columns, with close-line fallback for close-only files.
  - volume chart
    - done for the sampled Data Detail viewer when volume exists
  - selectable date range
    - done for Data Detail viewer
  - symbol picker that can load every scanned symbol, not just public examples
    - partial; every scanned catalog row can be inspected, richer typeahead
      symbol picking remains open
    - partial; Data Library now has a catalog-fed Symbol Browser with a
      typeahead symbol input, best-file selector, one-click table filter,
      diagnose action, and direct Data Detail inspection for scanned files.
    - partial; Symbol Browser now adds ranked quick-pick cards for partial or
      empty symbol input, summarizing file count, rows, asset/source/bar
      coverage, quality, and range with one-click selection into Inspect,
      Compare, Filter, or Diagnose.
    - partial; Symbol Browser now also renders a compact ranked typeahead
      result list with exact/starts/contains match labels, file/row/range
      context, click selection, and Enter-to-select behavior, reducing
      dependence on browser-native datalist UI.
    - partial; the main Saved Data search input now also uses catalog-fed
      symbol completion, so users can filter or browse from the same scanned
      symbol universe
    - done for Data Detail jump navigation; the detail viewer now has a
      catalog-backed Jump to Symbol input that opens the best matching saved
      file directly, and Find Missing Symbol shares the same suggestions.
  - gap markers
    - partial; gaps are listed in the detail table, chart markers remain open
    - partial; Data Detail charts now render gap bands/markers over the price
      area for returned gap rows, while still listing the exact gap intervals
      in the table below the chart.
  - sampled and full-resolution modes
    - partial; sampled mode is default and full mode is available when the
      selected range fits the bounded point limit
    - partial; Data Detail now publishes explicit viewer status, omitted point
      counts, and a Viewer health card so users can tell whether a chart is
      full, sampled, empty, or unavailable.
    - partial; Data Detail now exposes `/data_detail_export` and an Export
      Range CSV action that downloads the selected date range with normalized
      UTC timestamps and original file columns, bounded by a server row cap.
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
    - partial; Compare Saved Data overlays normalized close-return paths and
      now shows overlap, warning, sampling, and comparison-readiness cards so
      users can tell whether the selected files share enough timestamps.
    - partial; Compare Saved Data can now export the current normalized
      close-return paths as CSV by symbol and timestamp for offline review.
    - partial; Compare Saved Data now has a Find Dataset filter for large
      catalogs, preserving already selected files while narrowing by symbol,
      source, bar size, quality, or path.
    - partial; Compare Saved Data now also has exact asset, source, bar-size,
      storage-session, and quality facets while preserving selected datasets
      across filter changes.
    - partial; Compare Saved Data now has Select Shown and Clear actions,
      capped to the backend's 8-dataset comparison limit, so filtered symbol
      groups can be selected without manual multi-select gestures.
    - partial; Compare Saved Data now also has Select Symbol, which chooses
      exact catalog symbol matches from the typed Find Dataset value for quick
      same-symbol file/bar/source comparisons.
    - partial; Symbol Browser now has a Compare action that preselects exact
      saved-file matches for the typed symbol, loads the normalized comparison
      chart, and jumps to the saved-data comparison workflow.
    - partial; Data Library now has a Symbol Directory that lists the largest
      scanned symbols by file count/rows, can search and sort the symbol
      directory, and provides direct Filter, Inspect, Compare, and Diagnose
      actions without needing to know a ticker upfront.
    - partial; Symbol Directory now has exact asset, source, bar-size, storage
      session, and quality facets so large saved universes can be narrowed
      without relying on free-text search.
    - partial; Symbol Directory now starts with summary cards for shown versus
      matched symbols, file/row totals, latest matched data date, top source/bar
      breakdowns, active filters, and quality-review pressure before showing
      individual symbol cards.
    - partial; Symbol Directory now uses backend symbol summaries when
      available and exposes `/data_symbol_directory_export` plus an Export
      Symbols CSV action for offline universe review.
    - partial; Data Home now shows a ranked shortlist of currently visible
      saved files with direct Inspect, Filter, and Compare actions, so users can
      start from recommended catalog rows before using dense tables.
    - partial; Data Library now has a first-screen Data Source Map that
      translates configured and suggested root diagnostics into visible,
      hidden/capped, parser-error, unavailable, and not-scanned root states
      with direct actions for filtering, audit, scan diagnostics, fetch jobs,
      scan-limit review, and root YAML copying.
    - partial; Compare Saved Data can now copy the exact `/data_compare`
      request JSON for the current selected datasets, date range, point count,
      and sampling mode.
    - partial; Compare Saved Data can now send the selected compared datasets
      and date window directly into the Workbench Config Builder, closing the
      compare-to-simulation workflow without reselecting files manually.
  - export/copy the local file path and generated replay command
    - partial; Data Library rows and Data Detail can copy the local file path,
      a `--data-root` flag, a replay-starter command, and a full-file inferred
      missing-interval CSV. Fully generated strategy-specific replay commands
      still come from saved Workbench drafts.
    - partial; Data Detail can now export the current saved-file date range as
      bounded bar data, separating actual row export from catalog metadata and
      missing-interval exports.
    - partial; Data Detail can now send the opened saved file and selected date
      window into Workbench instead of requiring users to reselect the dataset
      manually before generating a replay or simulated-paper draft.
  - flag suspicious files before they are used in a strategy replay
    - done for Workbench-generated drafts; selected dataset quality is visible
      before draft generation, `/data_alignment`/draft alignment payloads carry
      quality status and warning counts, and `/config_draft` requires explicit
      `allow_quality_warnings` acknowledgement before generating a runnable
      draft from warn/bad files.
    - partial; Data Detail now shows a health strip with quality, gap,
      duplicate/null, and replay-readiness cards for the selected saved file.
    - partial; Data Detail now has Saved Data Viewer triage cards that show
      catalog file/symbol counts, the currently opened file, chart sampling
      state, enabled actions, and the next action before lower-level details.
    - partial; Data Detail now has a Use In Workbench action that selects the
      opened saved file in the Workbench Config Builder, carries over the
      viewer date range when available, and jumps directly to the simulation
      setup flow.
    - partial; Data Detail now has previous/next catalog navigation for the
      current filtered saved-data set, with full-catalog fallback when the
      opened file is outside active filters, so users can browse saved history
      without returning to dense catalog rows.
- Add data coverage diagnostics:
  - coverage heatmap by symbol/date
    - partial; Data Library now renders recent date-bin coverage by symbol
    - partial; Data Library now exposes `/data_coverage_export` and an Export
      Coverage CSV button so symbol/date coverage rows can be reviewed offline.
  - missing-day and missing-minute summaries
    - partial; dataset details show gap rows/missing intervals, coverage view
      shows missing recent date bins; minute-level aggregate heatmaps remain
      open
    - partial; Data Library now has a Gap Summary panel backed by
      `/data_gap_summary`, showing worst timestamp-gap files, estimated missing
      intervals, largest gaps, and missing calendar-day rows across the current
      bounded catalog scan. A richer minute-level heatmap remains future work.
    - partial; Data Library now exposes `/data_gap_summary_export` and an
      Export Gap CSV button for aggregate timestamp-gap and calendar-gap rows.
    - partial; Data Library now has a Minute Coverage Heatmap backed by
      `/data_minute_heatmap`, summarizing expected vs actual intraday intervals
      by UTC hour for bounded catalog rows and listing worst incomplete files.
      Data Library now also lists bounded worst date/hour missing-interval
      drilldowns from the same endpoint. Data Detail now lists bounded exact
      inferred missing timestamps for the selected saved file and can export a
      full-file missing-interval CSV through `/data_missing_intervals_export`.
    - partial; Data Library now exposes `/data_minute_heatmap_export` and an
      Export Minute CSV button for intraday hour and date/hour completeness
      rows.
  - "why is this symbol not visible?" diagnostic
    - done for configured/suggested roots, parser failures, catalog limits, and
      fetch-manifest clues
  - data-root scan errors in the UI
    - partial; catalog parser errors and root diagnostics are visible
    - partial; Data Library now exposes `/data_catalog_scan_export` and an
      Export Scan CSV button for configured-root parser errors, unsupported
      files, catalog caps, scan timings, and skipped-file samples.
  - root-by-root scan duration, file count, skipped count, and parser error
    count
    - partial; Data Library now shows catalog scan diagnostics with per-root
      candidate, parsed, parser-error, unsupported-file, cap/reason, and scan
      duration fields. Storage Audit still handles deeper full-root file counts.
    - partial; Storage Audit now also displays and exports per-root scan
      duration for the deeper full-root file audit.
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
    - partial; JSON manifests now retain retry events, pacing-wait events,
      latest rolling ETA/progress fields, average output elapsed seconds, and
      per-output/per-error attempt timing where fetchers publish them.
  - manifests should be visible from the dashboard
    - done for list/detail views
  - failed/missing symbols should be resumable from a manifest
    - done for stock and crypto JSON-manifest resume input; both fetchers can
      seed options from a prior manifest and skip completed work where the
      fetcher has enough public manifest state.
    - partial; `live/fetch_crypto_history.py --resume-manifest <json>` now
      seeds symbols, range, exchange/bar/data type, output directory, and
      ok/empty done paths from a prior JSON manifest so failed or missing
      crypto chunks can be retried without manually reconstructing the run.
    - partial; `live/fetch_history.py --resume-manifest <json>` now seeds
      stock symbols, bar size, duration/months, RTH, and data-type options from
      a prior JSON manifest and skips previously ok/empty symbols unless
      `--force` is supplied.
    - partial; Fetch Detail now exposes copyable stock and crypto resume
      commands for selected fetch manifests.
    - partial; Fetch Detail now includes recovery cards that summarize symbol
      coverage, permission blockers, retry events, pacing waits, and whether a
      selected job is ready to inspect, retry, or fix before resuming.
    - partial; Fetch Detail now also renders a plain-language Recovery Plan
      checklist that translates backend `recovery_action` values into concrete
      operator steps for permissions, contracts, no-data review, data-root
      fixes, resume commands, and Data Library output review.
    - partial; fetch manifest list/detail/export payloads now expose explicit
      recovery status/action/note fields, resume support, and permission,
      no-data, and retryable error counts so recovery triage does not have to
      infer those states only from raw error-kind maps.
    - partial; fetch manifest list/detail/export payloads now also include a
      public-safe resume plan that estimates completed work to skip and
      failed/no-data/pending work to retry or review, and Fetch Detail renders
      that scope before users copy the resume command.
  - fetch manifests should connect directly to Data Library rows so a user can
    go from a completed fetch job to the symbols and files it produced
    - partial; output paths under configured data roots now link directly to
      Data Detail, manifest-driven resume remains open
    - partial; Fetch Detail now summarizes output visibility as visible,
      missing-under-root, outside configured roots, or no-path, and surfaces
      those counts in recovery cards plus per-output status labels.
    - partial; Fetch Detail can now filter Data Library to the selected job's
      visible output files, making completed fetch output sets reviewable as a
      group.
    - partial; Fetch Detail can now send Data Library-visible output files
      directly into the Workbench Config Builder, carrying the manifest date
      range when available so completed fetches can become replay inputs
      without manual re-selection.
    - partial; Fetch Detail can now copy the selected job's Data
      Library-visible output paths as a newline-separated list for local
      scripts or manual audit.
    - partial; Fetch Detail now exposes `/fetch_manifest_detail_export` and an
      Export Detail CSV button for the selected job's symbol, output, error,
      retry, and pacing rows with Data Library output visibility annotations.
    - partial; Fetch manifest list/export rows now also include output
      visibility counts against configured Data Library roots, so Fetch Jobs
      triage can flag missing/outside/unsupported outputs before opening
      Fetch Detail.
    - partial; the Fetch Jobs manifest table now shows compact output
      visibility counts inline, so visible/missing/outside/no-path/unsupported
      output problems are scan-readable without opening each manifest.

## P1: Fetch jobs and backend data reliability

- Add fetch-job screens:
  - active/completed jobs
    - completed jobs are visible; active jobs appear when the manifest is being
      updated during a running fetch
    - partial; Fetch Jobs now has client-side search, status/kind filters, and
      sort controls so long completed/active manifest histories are easier to
      scan for failed jobs, recent jobs, large pulls, and output paths.
    - partial; Fetch Jobs can copy configured manifest roots as a
      `dashboard.fetch_manifest_roots` YAML block for local dashboard config.
    - partial; Fetch Jobs now exposes `/fetch_manifests_export` and an Export
      Jobs CSV button for recent manifest summaries, including status,
      symbols/chunks, retry/pacing counts, progress/ETA fields, rows, errors,
      and latest output paths.
    - partial; selected Fetch Detail views can be exported as CSV for offline
      review of symbol progress, output visibility, errors, retry attempts, and
      pacing waits.
    - partial; Fetch Jobs now has a checklist-style guide for configuring
      roots, finding jobs, reviewing failures, inspecting outputs, opening
      saved data, and recovering/exporting selected jobs.
    - partial; Fetch Jobs now adds first-screen triage cards for manifest-root
      coverage, active/non-terminal jobs, jobs needing review, output
      visibility, and retry/pacing pressure before the dense manifest table.
    - partial; Fetch detail recovery cards now consume backend recovery
      status/action guidance, distinguishing permission blockers, contract
      fixes, retryable failures, no-data review, and data-root visibility
      fixes.
  - progress by symbol and chunk
    - partial; symbol/chunk summaries are visible from the JSON manifest
  - rolling ETA based on recent chunk time
    - logged by crypto fetcher, not yet persisted into JSON manifests
    - partial; crypto fetch manifests now persist latest rolling ETA,
      completed/remaining chunk counts, and rolling average chunk time for the
      dashboard summary/detail views.
  - success/failure/retry counts
    - partial; success/failure/no-data counts are persisted, retry counts need
      richer per-attempt recording
    - partial; the shared fetch manifest now counts retry events and the
      crypto fetcher records bounded per-attempt retry events with delay,
      attempt, symbol, and day context.
    - partial; the stock fetcher now supports optional per-symbol retries,
      records retry events, records output/error attempt counts, and keeps
      default retry behavior unchanged unless `--retries` is set.
  - pacing waits
    - partial; configured pacing delay is persisted, actual wait events are not
      summarized yet
    - partial; crypto fetch manifests now record actual pacing wait events and
      the dashboard summarizes total wait count/seconds plus retry/pacing
      event rows in Fetch Detail.
    - partial; the stock fetcher now supports optional `--pacing-delay` between
      symbol requests and records those actual wait events in the JSON
      manifest.
  - current output path
    - done for manifest outputs and latest output path
- Standardize historical storage:
  - consistent symbol naming
  - consistent bar-size naming
  - UTC-normalized timestamp storage with source timezone metadata
  - adjustment metadata for stocks
  - clear distinction between RTH, extended hours, and 24/7 crypto
    - partial; Data Catalog and Data Detail now expose inferred canonical
      symbol, storage session (`rth`, extended, `24_7`, unknown), and
      adjustment status metadata, with catalog CSV export fields for the same
      values.
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
    - partial; crypto parquet discovery is covered, and minute heatmap
      completeness now carries storage-session metadata with a 24/7 crypto
      regression test. Coverage and gap summaries now carry storage-session
      metadata with a 24/7 crypto calendar-gap fixture; broader multi-session
      fixture coverage remains open.
  - malformed/skipped files with visible reasons
    - partial; parser failures and unsupported files are covered by catalog
      scan diagnostics. Catalog rows and Data Detail now also warn on malformed
      minute bars with high below low, closes outside high/low, and negative
      volume; broader multi-session fixture coverage remains open.
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
      parser error counts/sample errors and unsupported-file counts. Catalog
      quality warnings now also expose malformed OHLC/volume minute-bar counts
      that do not throw parser exceptions.
  - catalog limits must be visible and user-adjustable through config
    - done; `dashboard.data_catalog.default_limit` and `max_limit` control the
      first Data Library scan and request bounds. Workbench diagnostics and
      catalog payloads expose those settings, the dashboard builds its row-count
      control from them, and catalog/scan/coverage/gap/heatmap/storage exports
      use the selected configured limit.

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
  - partial; `/config_options` now exposes `guide_schema_version` and
    `guide_steps`, and the Workbench guide consumes backend step labels/order
    while keeping dynamic readiness details in the frontend.
  - partial; Workbench guide rows now include compact action buttons that jump
    to the relevant schema-rendered form control, quality section, alignment
    preview, draft/run form, or results table, making the guide an actionable
    stepper instead of only a status checklist.
  - partial; Workbench now renders the same guide state as a compact visual
    stepper above the checklist, with each step clickable into the matching
    data, quality, range, alignment, draft, run, or result control.
  - partial; Workbench now starts with a Workbench Home band that summarizes
    the selected data, alignment window, draft validation, latest run, loaded
    artifacts, and the next action before the schema-rendered form.
  - partial; Workbench now has a Run Result panel directly after Run Draft,
    summarizing the selected draft's latest run, artifact availability,
    decisions/fills/rejections, and direct Performance/Runs/Log actions.
  - partial; Workbench now has Selected Data Actions that summarize selected
    files, quality issues, comparison readiness, and range, with direct actions
    to inspect the first selected file, compare selected files, or return to
    Data Library.
  - partial; Workbench now has a Preview Draft action backed by
    `/config_draft_preview`, which runs the same server validation, alignment,
    plugin-boundary, and command generation path while returning unsaved YAML
    for review before a local draft file is written.
- Add clearer separation between public example configs and local private
  strategy configs.
  - partial; Workbench plugin options now carry visibility/description/boundary
    metadata, the selector labels public examples explicitly, and the UI shows
    that public drafts are for generic example plugins while private strategies
    belong in ignored local configs.
  - partial; the dashboard can now load ignored local plugin registry files
    such as `config/plugin_registry_local.yaml`, merging private-local plugin
    metadata into Workbench options while keeping the public repo on sanitized
    example defaults.
- Add schema-driven form rendering after config schemas are reliable.
  - partial; `config_draft_options` now returns public-safe form field metadata
    for the core Config Builder fields, and the Workbench renders those
    controls from schema while preserving existing draft/alignment behavior.
    Versioned schemas are now explicit; richer plugin-authored validation hooks
    remain future work.
  - partial; the generated Config Builder form now groups schema fields into
    guided Setup, Data, Account, Risk Limits, Simulated Costs, and Output
    sections so the Workbench flow is easier to scan without hard-coding fields
    in the UI.
  - partial; `/config_options` now exposes `form_sections` with section
    labels, help text, and ordering, and the Workbench renderer consumes that
    schema metadata instead of frontend-only section definitions.
  - partial; Config Builder now adds section-level readiness cards for data,
    alignment, plugin, mode/range, risk, simulated costs, and generated draft
    state so users can see what needs attention before scanning every field.
  - partial; Workbench now adds a Compatibility Review that summarizes schema
    versions, plugin registry boundary, exposed strategy fields, selected data
    sources/bar sizes, alignment coverage, saved-draft validation state, and
    the next action before running.
  - partial; plugin registry entries can now expose public-safe
    `strategy_fields`, the Workbench renders fields for the selected plugin,
    and generated drafts write only those allowlisted values under `strategy`.
    The form schema version was bumped to v3 after adding `required`,
    numeric min/max, select-options validation, unknown-key rejection, and
    saved-draft strategy revalidation for those fields.
  - partial; Workbench guide step metadata is now schema-driven through
    `/config_options.guide_steps` and exported workbench snapshots include
    `guide_schema_version` for downstream UI/schema compatibility checks.
- Add saved draft folders/tags/status labels.
  - done for the Workbench saved-drafts table; draft records now expose folder,
    status label, and tags derived from mode/status/plugin/symbol count, and
    the UI displays them beside validation/output state.
  - done for offline inventory; Workbench now has Export Drafts CSV backed by
    `/config_drafts_export`, including folder, status, mode, plugin, symbols,
    tags, validation state, output directory, and local YAML path.
- Add safer empty states and validation messages.
  - partial; Workbench draft generation, alignment, saved drafts, draft
    validation, and run tables now show next-step guidance instead of blank or
    generic `none` states. Broader seeded empty-state smoke across every page
    remains part of UI quality gates.
  - partial; Workbench Run Draft now has triage cards summarizing saved drafts,
    validation coverage, failed/completed runs, selected-draft state, loaded
    artifacts, and the next action before the dense draft/run tables.
  - partial; Config Builder now has a Validation Messages panel that groups
    server/plugin draft-generation errors by config area and annotates matching
    plugin strategy fields inline when messages reference `strategy.<field>`.
    Deeper per-plugin custom formatting remains future polish.
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
  - partial; after a saved draft is run, the Workbench Run Result panel now
    shows whether results are loaded or merely available, exposes execution
    counts, and gives direct buttons to open Performance, Runs, or the run log
    without scanning dense tables.
  - partial; before generating a draft, Workbench Selected Data Actions now
    let users re-open the selected file in Data Detail or compare the selected
    files over the configured Workbench date range, closing the loop between
    data review and simulation setup.
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
  - partial; Operations now has Paper Monitor Health cards that summarize
    blocker/warning counts, next action, mode safety, and order-context
    visibility before the detailed checklist.

## P1: Operations and cloud monitoring

- Add real cloud endpoint support beyond the local mock receiver.
  - partial; the receiver already accepts authenticated status posts and command
    polling over HTTP, and now exposes `/remote_nodes` for sanitized latest
    read-only monitoring summaries by node. Deployment-oriented hosting docs
    and cloud-provider examples remain open.
  - partial; `docs/cloud_monitoring_deployment.md` now documents a conservative
    deployment shape for local-first remote monitoring, private-network access,
    hosted receiver precautions, command-worker boundaries, and failure modes.
    Provider-specific examples and hardened internet deployment remain open.
  - partial; public-safe hosted receiver examples now include
    `config/cloud_status_hosted.example.yaml`,
    `ops/cloud/status-receiver.compose.example.yaml`, an nginx reverse-proxy
    template, a local status-publisher timer, and a command-worker service.
    Fully hardened provider-specific infrastructure remains open.
  - partial; hosted/local receiver configs now support
    `dashboard.network_access` with CIDR/IP allowlists and optional trusted
    `X-Forwarded-For` handling, so deployments can restrict direct receiver
    clients to localhost, VPN, proxy, or management networks. Remaining gap:
    provider-specific firewall/IaC examples.
  - partial; public-safe network-boundary examples now include nginx and Caddy
    reverse proxies, a dry-run-first UFW host-firewall script, and an AWS
    security-group Terraform sketch. Remaining gap: deployment recipes for
    other providers and stronger off-host audit retention.
  - partial; provider-specific examples now also include a reusable hosted
    receiver Dockerfile, Fly app config, Render Blueprint config, DigitalOcean
    Cloud Firewall Terraform sketch, and a dry-run-first off-host command-audit
    sync helper. Remaining gap: manual hardening review against a real chosen
    provider/account before any internet-facing deployment.
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
  - partial; Remote Nodes now has summary cards plus client-side search,
    status/mode filters, and sort controls for heartbeat age, alerts, open
    orders, equity, and node name so cloud monitoring snapshots are easier to
    triage.
  - partial; Remote Nodes now has health cards for heartbeat freshness,
    Gateway reachability, alert pressure, open-order pressure, stale
    data/account timestamps, and active filter coverage before the dense node
    table.
  - partial; Operations now exposes `/remote_nodes_export` and an Export Nodes
    CSV button for offline review of sanitized heartbeat, Gateway, mode,
    equity, positions, open orders, activity counts, freshness, and alerts by
    node.
  - partial; Operations now starts with an Operations Home band that summarizes
    local paper-monitor readiness, Gateway/API reachability, remote-node
    freshness, command-audit integrity/signature status, and alerts before the
    detailed remote/control tables.
  - partial; Operations now has Command Audit Health cards that surface
    hash-chain status, HMAC signature coverage, latest sanitized command
    event, and local/off-host retention next steps before the dense audit rows.
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
  - partial; Remote Node Detail now adds snapshot, latest-activity, and alert
    summary cards plus a combined sanitized recent decisions/orders/fills table
    with type filtering. Raw logs and full artifact browsing remain out of the
    hosted view until retention and privacy boundaries are stronger.
  - partial; Operations now exposes `/remote_node_detail_export` plus an
    Export Detail CSV button for the selected remote node, covering sanitized
    summary, bounded history, latest runs, alerts, supervisors, and recent
    decision/order/fill rows without raw logs or strategy diagnostics.
- Keep broker credentials and trading authority on the local machine.

## P2: Generic runner and framework hardening

- Extend `live/plugin_runner.py` from one-shot/replay execution into continuous
  market-hours loops where needed.
  - partial; the generic plugin runner now supports `runner.loop` / `--loop`
    for shadow and paper modes, reloads latest data each interval, skips
    duplicate latest bars by default, preserves plugin state in-process, and
    writes loop metadata to summaries. Generic loop configs can now define
    `runner.session` with timezone, local start/end, weekdays, and
    `outside_session: idle`; outside-window loop iterations write visible idle
    decision artifacts without evaluating the plugin or broker. Loop configs
    can also set `control.stop_marker` for a clean operator-requested loop exit
    before the next data/plugin/broker pass. Richer process supervision remains
    open.
- Add versioned config schemas and richer per-plugin validation.
  - partial; public Workbench config options, generated draft metadata, and
    exported workbench snapshots now carry explicit config/form schema version
    fields. Generic plugin modules/factories can now expose optional
    `validate_config` or `validate_strategy_config` hooks that run during
    plugin-runner config validation. Plugin registry entries can now expose
    public-safe `strategy_fields` that the Workbench renders and serializes
    into generated drafts. Workbench draft generation and saved-draft
    validation now enforce those field definitions for required fields,
    numeric min/max bounds, select choices, and unknown strategy keys. Deeper
    plugin-authored validation hooks now run during Workbench draft generation
    and saved-draft validation, so invalid plugin-specific configs are rejected
    before local YAML is saved. The Workbench now groups server/plugin
    draft-generation errors in a Validation Messages panel and annotates
    matching plugin strategy fields inline when messages reference
    `strategy.<field>`; richer plugin-defined custom display remains open.
- Add optional order previews and manual approval hooks for paper/live mode.
  - partial; generic plugin-runner configs can set
    `execution.require_order_approval: true`, which writes
    `order_previews.jsonl` and holds simulated-paper/paper orders unless the
    run is launched with `--approve-orders`. Dashboard performance and
    artifact summaries surface approval-hold counts. Richer interactive
    approval flows remain open.
  - partial; archived/draft run artifact loading now preserves bounded
    `order_previews.jsonl` rows, sanitizes approval preview details, and the
    Runs artifact view shows a dedicated Order Previews table for held orders.
- Add richer simulated-paper accounting:
  - realized PnL
  - average cost
  - borrow constraints
  - commission schedules
  - slippage models
  - partial; simulated-paper fills/account snapshots now track average cost,
    realized PnL, unrealized PnL, total PnL, and total commission using the
    configured simulated slippage/commission fields. Simulated execution now
    also supports shortable-symbol whitelists, per-symbol/total short-notional
    caps, side-specific slippage, simple size-based market-impact slippage,
    commission bps, per-share commission, minimum commission, and max
    commission caps. Simulated shorts can now accrue global or per-symbol
    annual borrow fees over elapsed account-snapshot time. Venue-specific cost
    models remain open.
- Add broker-agnostic execution adapters so private configs can choose IBKR,
  file-based simulation, or future broker integrations without changing
  strategy plugins.
  - partial; generic paper execution now uses a broker adapter factory with
    `ibkr` and a local file-backed adapter for public plumbing tests. Strategy
    plugins still see the same order/fill interface.
  - partial; broker adapters now publish public capability metadata for
    account modes, order types, order sizing, Gateway/static-price
    requirements, local-state behavior, and known IBKR paper/live ports. The
    generic runner uses that metadata for adapter-aware safety checks, and the
    Workbench exposes it in a Broker Boundary panel. Schwab/future broker
    adapters remain open.
- Add stronger paper/live gates to prevent accidental live orders.
  - partial; generic paper mode now requires `--confirm-paper-orders`, rejects
    `broker.account_mode: live`, and refuses known live IBKR ports (`4001`,
    `7496`) unless both config and CLI explicitly opt in. More broker-native
    account verification and live-mode enablement gates remain open.

## P2: Publication readiness

- Keep the exported public repo as the clean public candidate.
- Add CI checks around `python3 scripts/public_readiness_audit.py --fail-on-review`.
  - done in `.github/workflows/ci.yml`; CI runs the public readiness audit,
    Python compile checks, dashboard JavaScript syntax check, pytest, and
    default/empty/seeded/accessibility dashboard smokes.
- Do final manual review before pushing to GitHub.
  - partial; `docs/publication_readiness.md` now has a final manual review
    checklist with export, audit, test, dashboard smoke, screenshot, and
    manual-inspection steps for README, blog draft, example configs,
    no-edge examples, dashboard labels, and remaining limitations.
- Finish blog post polish.
  - partial; `docs/blog_public_ibkr_harness_draft.md` has been expanded into a
    public-safe draft covering local-first design, data fetches, manifests,
    Data Library, private plugin boundaries, replay/simulated-paper/paper
    modes, Workbench, remote monitoring, export/audit, limitations, and a
    pre-publish checklist. Final human editing for voice and publication venue
    remains open.
- Add runbooks:
  - done in `docs/ibkr_gateway_runbook.md`: IBKR Gateway setup and recovery
  - done in `docs/paper_trading_runbook.md`: paper trading startup/shutdown
  - done in `docs/market_data_permissions_runbook.md`: market-data permission
    diagnosis
  - done in `docs/service_restart_runbook.md`: service restart
  - done in `docs/failed_order_diagnosis_runbook.md`: failed order diagnosis
- Keep private strategy configs, tuned universes, research outputs, account IDs,
  logs, and credentials out of the public repo.

## P3: Remote control hardening

- Add authentication, authorization, audit logging, rate limits, and explicit
  local safety gates before expanding remote commands.
  - partial; command worker now enforces a local command cap, action risk
    metadata, explicit local enable markers for launcher actions, and local
    audit records for completed/rejected commands
  - partial; receiver now rate-limits command queue requests per node and writes
    sanitized queue/cancel/result audit events to an append-only JSONL file with
    a bounded `/command_audit` endpoint. Explicit duplicate `command_id` values
    are rejected before queueing so result handling stays unambiguous. The
    Operations view now surfaces those sanitized command audit events directly
    in the dashboard
  - partial; server-side command scopes now classify queued actions as
    read-only, control, or launcher and reject commands outside
    `dashboard.command_scopes` before they are persisted. Remaining gaps:
    provider/network-specific hosted deployment controls and off-host immutable
    or signed audit storage
  - partial; hosted receivers can now configure multiple bearer-token roles
    with `dashboard.auth_tokens`, limiting command queue access per token while
    keeping dashboard/status reads authenticated. Remaining gaps:
    provider/network-specific hosted deployment controls and off-host immutable
    or signed audit storage
  - partial; server-side command audit rows are now hash-chained and
    `/command_audit` reports integrity status, checked records, legacy rows,
    latest hash, and bounded errors.
    - partial; the Operations dashboard now renders those integrity fields as
      Command Audit Health cards so audit-chain and signature problems are
      visible without reading raw JSON or table rows.
  - partial; hosted receivers can now set
    `dashboard.command_audit_signature_env` to sign new server-side command
    audit rows with an HMAC secret kept in the environment. `/command_audit`
    reports signature status, signed/unsigned row counts, and signature
    verification errors. Remaining gap: provider/network-specific off-host
    immutable audit retention for internet-facing deployments.
  - progress; Operations now includes an Export Audit CSV action backed by
    `/command_audit_export`, so bounded sanitized queue/cancel/result audit rows
    can be reviewed offline with the current hash-chain and signature status
    columns.
  - partial; public cloud examples now include
    `ops/cloud/sync-command-audit.example.sh` for dry-run-first upload of the
    server-side command audit JSONL to separate object storage. Actual
    immutability still depends on provider retention controls such as object
    lock/versioning and a separate storage identity.
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
