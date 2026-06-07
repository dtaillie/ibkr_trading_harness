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
  - partial; Overview now includes a Today's Command Center panel that puts
    current operating state, next action, today's return, decision loop,
    orders/fills, evidence source, and latest market-data age into one
    first-screen summary before the broader workflow launcher.
  - partial; Overview now includes a Start Here workflow launcher with
    public-safe action cards for monitoring today, reviewing performance,
    browsing saved data, building simulations, inspecting runs/orders, and
    fixing setup. Each card reflects current telemetry/data/workbench state and
    deep-links to the focused page for that job.
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
  - partial; Overview now has a Home / Activity / Diagnostics lens with
    deep-linkable hashes such as `#overview/activity`, so the default first
    screen stays portfolio-first while orders, timelines, runtime checks, and
    setup diagnostics remain one click away.
  - partial; Performance now has Home / Trades / Rollups / Diagnostics lenses
    with deep-linkable hashes such as `#performance/trades`, keeping the
    default result/risk/chart view separate from trade tables, rollup archives,
    and metric caveats.
  - partial; Performance Trades now includes a Trade Ledger Assistant that
    summarizes open lots, realized PnL, win/loss state, largest loss, active
    filters, and direct table/Runs actions before the dense trade table.
  - partial; Performance Rollups now includes a Rollup Review Assistant that
    compares live/paper status-history rollups with archived run rollups,
    highlights best/worst days and periods, and offers direct review/export
    actions before the dense rollup tables.
  - partial; Data Library now has Home / Browse / Inspect / Compare /
    Diagnostics lenses with deep-linkable hashes such as `#data/inspect`, so
    root visibility, catalog browsing, saved-file inspection, comparisons, and
    storage diagnostics are no longer one continuous page.
  - partial; Fetch Jobs now has Home / Jobs / Detail lenses with deep-linkable
    hashes such as `#fetch/detail`, separating manifest-root/recovery overview,
    manifest table scanning, and selected-job recovery/output detail.
  - partial; Workbench now has Home / Builder / Run / Artifacts lenses with
    deep-linkable hashes such as `#workbench/builder`, keeping the guided
    simulation path separate from config editing, run tables, and loaded
    artifact/log inspection.
  - partial; Workbench Builder now includes a Builder Assistant that synthesizes
    selected data, plugin visibility, alignment, draft validation, save state,
    and run readiness with direct Data, Preview, Generate, and Run actions
    before the dense config form.
  - partial; Workbench Home now includes an Example Config Gallery that lists
    public no-edge examples, ignored local/private plugin availability, and the
    public/private boundary before users enter Builder.
  - partial; Runs now has Home / State / Runs / Events lenses with
    deep-linkable hashes such as `#runs/events`, separating triage, account
    boundary/current order state, run search, and event timelines.
  - partial; Operations now has Home / Paper / Remote / Control / Diagnostics
    lenses with deep-linkable hashes such as `#operations/control`, separating
    local readiness, remote monitoring, command controls, and maintenance
    diagnostics.
  - partial; Operations Control now includes a Control Assistant that summarizes
    target-node, pending-command, failed-result, and command-audit state before
    the dense supervisors, queue, result, and audit tables.
  - partial; Help now has Home / Pages / Workflows / Data / Boundary / Docs
    lenses with deep-linkable hashes such as `#help/workflows`, separating
    first-step routing, page guide, workflow recipes, data troubleshooting,
    public/private boundaries, and runbook links.
  - partial; page-intro action buttons now preserve focused destinations, so
    cross-page shortcuts can land on Data Browse, Fetch Jobs, Workbench Builder,
    Runs, Operations Paper, or other task-specific lenses instead of generic
    page defaults.
  - partial; the reusable page-intro strip now includes a Recommended Next
    surface with per-page task guidance, making each view state the next
    concrete dashboard action before the user scans lower cards or tables.
- Add route-like navigation state so each top-level view can be deep-linked,
  refreshed, and shared by URL/hash without losing context.
  - done for top-level dashboard views with URL hash navigation
  - partial; the page intro now renders a breadcrumb/deep-link strip for the
    active view and focused lens, with Page Home and Copy Link actions so users
    can share or return to the exact dashboard context without reading hash
    syntax.
- Add a brokerage-style "Strategy Home" view:
  - active strategy name, mode, and status
    - partial; Overview and Performance Home now render a public-safe strategy
      identity strip with inferred strategy/plugin label, mode, source type,
      draft id, run id, and latest update age from telemetry, summaries, or
      loaded artifacts.
  - portfolio/equity headline first, not log tables
  - today's PnL/return, recent PnL/return, open exposure, and current risk
    - partial; Overview now has a Performance Snapshot section that derives
      latest day, month, year, all-available return, max drawdown, current
      equity path, and order/fill/reject/alert activity from sanitized
      status-history rollups without opening logs.
    - partial; Performance Home now has its own Performance Snapshot strip that
      puts Today, Recent, Month, Year, All Available, Max Drawdown, and readiness
      in one brokerage-style panel, using status-history rollups when available
      and selected account/artifact snapshots as a fallback while labeling the
      source behind each horizon.
  - clear "no trade today" state with the latest checked signal
    - partial; Overview now has a Today's Signal State panel that separates
      no current run, awaiting a current-day check, no-trade-today,
      order-submitted, filled, and rejected-order states from sanitized
      current-day events, and it shows the latest checked decision detail.
    - partial; Overview now also has a Today at a Glance panel that summarizes
      no-telemetry, data-root, alert, rejected-order, open-order, position-open,
      awaiting-signal, filled, and normal monitoring states with direct next
      actions.
    - partial; Overview Home now includes a copyable Strategy Health Report
      that consolidates telemetry, runtime loop, alerts/orders, execution
      state, account/positions, saved data, Workbench readiness, and the next
      inspection action before lower tables.
  - open positions and pending orders before archived run tables
  - one-click drilldown into the source run/session/artifacts
    - partial; Overview now has a Source Detail action that routes the current
      evidence source to Workbench Artifacts for loaded artifacts, Runs State for
      current telemetry, Runs Search for saved summaries, or Operations
      Diagnostics when no performance evidence is loaded.
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
    - partial; Symbol Profile and the selected-symbol action panel now surface
      storage-contract counts/status beside quality, so symbol selection shows
      metadata readiness before sending files to Workbench.
    - partial; Symbol Directory now includes storage-contract filtering, sort,
      summary/assistant cards, and per-symbol contract counts so large symbol
      universes can be screened for metadata readiness before inspection.
    - partial; Data Library Home universe cards and top-symbol chips now include
      storage-contract readiness, so metadata review pressure is visible before
      entering Browse or Workbench.
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
    - partial; Fetch Jobs Home now includes a Fetch Health panel that
      consolidates manifest-root readiness, loaded/filtered jobs, active
      non-terminal pulls, retry/pacing pressure, output visibility, selected
      detail state, and direct Jobs/Detail/Data/Workbench actions.
  - add "what changed since last refresh" cues for new signals, fills, rejects,
    and fetch completions
    - done for recent run events, new alerts, and terminal fetch-job changes
    - partial; Overview Home now includes a compact Since Last Refresh panel
      that reuses the existing activity-change detector for new decisions,
      orders, fills, alerts, and completed fetch jobs, while the Activity lens
      keeps the full detailed change list.
- Build a clean Overview page for the current running strategy state:
  - mode badge: replay, shadow, simulated paper, paper, or live
    - partial; mode is shown from latest artifact or telemetry summary
  - gateway/API status
    - done for configured Gateway reachability
  - current equity, cash, open positions, unrealized PnL, realized PnL
    - partial; current equity, cash, exposure, and open positions are shown
      when account artifacts or telemetry publish them. Realized/unrealized PnL
      still needs richer account/position telemetry.
    - partial; generic runner account snapshots now include estimated equity
      when paper broker adapters supply cash/positions but no equity, plus
      `equity_source`, gross/net exposure percentages, position count, price
      count, priced/unpriced position counts, and `pricing_status`. Run
      Artifacts surfaces the equity source and pricing coverage beside account
      snapshots. Real broker account reconciliation still needs paper/live
      validation.
    - partial; simulated-paper account artifacts now publish realized PnL,
      unrealized PnL, total PnL, total commission, and average costs, and the
      Overview/Performance pages display realized/unrealized PnL when those
      fields are available.
  - today's return, week/month return, cumulative paper return
    - partial; cumulative/latest artifact return is available in Performance.
      Performance Home now also shows live/paper latest-day, trailing 7-day,
      month, trailing 3-month, year, all-available, and drawdown summaries from
      persisted status-history rollups.
    - partial; Overview's first-viewport strategy tiles now include Month return
      beside Today and Week, preferring persisted status-history month rollups and
      falling back to selected account/artifact snapshots when rollups are absent.
  - latest bar time, latest signal time, latest order/fill/rejection
    - partial; generic plugin-runner now publishes dedicated
      `latest_bar_time`, `latest_rejection_time`, `latest_rejection_symbol`,
      `latest_rejection_status`, and `latest_rejection_reason` fields in
      `summary.json`/`runner_status.json`, and the status summarizer/dashboard
      prefer those fields when available. Specialized/private runners still need
      to publish the same generic fields.
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
    - partial; generic plugin-runner account snapshots now attach allowlisted
      `diagnostics.dashboard.position_details` / `position_metadata` for open
      symbols, so public-safe plugin context can populate those position cards
      without exposing raw diagnostics.
  - today's event timeline from market open/current session start through the
    latest decision
    - partial; Overview now shows the latest bounded decision/order/fill
      timeline from telemetry
    - partial; the Overview timeline is now current-telemetry-day aware,
      showing today's decision/order/fill events first with a recent-event
      fallback when no current-day events have been published.
- Add a Strategy Performance page with charts and summaries:
  - current active strategy selector
    - partial; Performance Home now mirrors the Overview strategy identity
      strip for the selected Current / Loaded Artifact / Latest Saved Run
      source, making the active source visible before charts and tables.
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
    - partial; generic runner account snapshots now publish estimated equity,
      equity source, exposure percentages, and pricing coverage in replay,
      simulated-paper, and paper/file-broker modes, and sanitized artifact
      endpoints preserve those fields. Remaining usefulness depends on each real
      broker adapter publishing reliable cash, positions, and price context at
      the desired cadence.
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
  - partial; Performance Home now includes workflow cards for checking today's
    session, reviewing risk, inspecting trades, opening rollups, comparing a
    benchmark, and verifying the selected source evidence, giving the page a
    task-oriented first screen before detailed charts/tables.
  - partial; Performance Home now includes a Live / Paper Periods summary strip
    that surfaces latest-day, recent, month/year, all-available return, and
    drawdown from sanitized status-history equity rollups before users open the
    rollup tables.
  - partial; Performance Home now includes a Performance Review panel that
    interprets the selected source/window in plain operational terms: verdict,
    evidence depth, return/drawdown/exposure, execution issues, live/paper
    continuity, benchmark context, and direct next routes.
  - partial; Performance Home now includes a Current Strategy Report that
    compresses source, latest equity, today/recent/month/all return, drawdown,
    exposure, trades, open positions, execution issues, evidence depth, and the
    next action into copyable plain-language rows.
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
    - partial; the Runs lens now has a Run Search Assistant that summarizes
      visible/hidden runs, status/mode mix, freshness, execution activity, and
      recommended runs with direct Events, Status, and Mode actions before the
      dense run table.
    - partial; Runs now puts the searchable run table behind an explicit Runs
      focus lens so it is reachable without forcing current-state and event
      tables into the same scroll path.
  - session timeline of decisions, orders, fills, rejects, account snapshots
    - partial; Run Artifacts now include a combined sanitized session timeline
      that interleaves decisions, orders, rejected orders, fills, and account
      snapshots, plus a dedicated account-snapshot table for equity, cash,
      exposure, and position counts.
    - partial; artifact account snapshots now include an expandable public-safe
      position-detail view so entry/hold/exit context is readable without raw
      JSON when runners publish that metadata.
    - partial; Runs Events now has an Events Assistant that summarizes visible
      timeline count, issue/rejection pressure, decision/order/fill mix, latest
      event, run/symbol coverage, and direct issue/fill/order/decision/latest
      run filter actions before the dense event table.
    - partial; Runs Events and Home now include a copyable Event Flow Report
      that explains filters, execution issues, decision/order/fill mix, latest
      event, run/symbol coverage, and the next inspection action before the
      dense timeline table.
  - current open orders and current managed positions
    - partial; current managed positions and recent non-terminal order events
      are visible, broker-native open-order state still depends on runner
      telemetry
    - partial; the Overview page now surfaces the same recent non-terminal
      order telemetry before users drill into Runs and Orders.
    - partial; Runs now groups account-boundary cards, current open orders,
      managed positions, and recent status snapshots under a State lens.
  - drilldown for a run with artifacts, logs, and performance charts
    - partial; artifacts, logs, and performance charts are inspectable for
      archived public workbench runs
    - partial; Workbench/Runs Log actions now load
      `/config_draft_run_evidence`, a bounded run evidence view with execution
      status cards, stdout/stderr tail stats, artifact-file manifest, JSONL row
      counts, and direct routing to the Workbench Artifacts lens.
  - clean distinction between live account state, paper account state, and
    simulated account state
    - partial; Runs now starts with triage cards for published runs, current
      open-order telemetry, managed positions, recent events, fills/rejects,
      loaded artifact detail, and the next inspection action before dense
      status/run/event tables.
    - partial; Runs Home now also includes workflow cards for Current State,
      Open Orders, Positions, Event Timeline, Run Search, and Loaded Artifacts,
      with deep links into Runs, Performance, and Workbench so users can start
      from a review job instead of scanning every table.
    - partial; Runs Home now includes a Runs Review panel that consolidates
      current run source, account/position state, open orders, timeline mix,
      artifact availability, and the next inspection route before dense state,
      search, and event tables.
    - partial; Runs now has Account State Boundary cards that distinguish
      selected source type, live/paper/simulated/replay authority, account
      snapshot freshness, managed positions, current telemetry, open-order
      signals, and the next verification action.
    - partial; Runs now defaults to a Home lens for triage while State, Runs,
      and Events lenses carry account state, run search, and timeline tables.
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
    - partial; Help now puts the page guide behind an explicit Pages lens so
      first-time routing is separate from reference material.
  - "How do I know today's strategy performance?" walkthrough
    - done on the Help page
  - "Why do I only see SPY and QQQ?" diagnostic walkthrough
    - done on the Help page
  - "How do I inspect historical data I already fetched?" walkthrough
    - done on the Help page
  - "What should be private before publishing this repo?" checklist
    - done on the Help page
    - done; Help Boundary now includes a public-repo preflight with export,
      strict audit, cloud-example audit, test/smoke commands, and the manual
      files to inspect before pushing or publishing a walkthrough.
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
    - partial; Help now splits workflows into dedicated Workflows, Data, and
      Boundary lenses so operational recipes, saved-data troubleshooting, and
      publication/privacy guidance do not compete in one long scroll.
    - partial; Help and the Web UI runbook now document the direct workflow
      shortcuts from Data Detail, Compare Saved Data, and Fetch Detail into
      Workbench, plus the Workbench result shortcuts into Performance and Runs.
  - empty states that explain what to do next instead of showing blank tables
    - partial; Help now has a dynamic Current Setup Gaps panel that reads
      sanitized dashboard state and links users to the right page for missing
      telemetry, Gateway/API checks, unreadable data roots, catalog caps,
      missing fetch manifests, and missing Workbench drafts.
    - partial; Help Home now also includes state-aware workflow cards for
      Monitor Today, Read Performance, Inspect Data, Build Simulation,
      Troubleshoot, and Publish Safely, giving first-time users a compact route
      into the right dashboard page before reading the longer guide sections.
    - partial; Help Home now adds a state-aware Next Step assistant that
      recommends one primary route from setup blockers, telemetry, saved data,
      draft availability, and performance evidence before showing workflow
      cards or reference material.
    - partial; Help Home now adds a Task Navigator report that converts the
      current dashboard state into copyable guidance and direct routes for
      monitoring, performance review, saved-data inspection, fetch recovery,
      simulation, run events, operations, and publication boundaries.
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
  - partial; Help, the Web UI runbook, and the public quickstart now document
    Saved Data Explorer as the broad first-pass map for asset/source/bar/
    session/quality/storage-contract groups before Symbol Browser, Data Detail,
    Compare, or Workbench.
  - partial; Help and the Web UI runbook now include a Data To Simulation Fast
    Path that names the current first-screen panels: Data Source Map, Data
    Home, Fetch Recovery Plan, and Workbench Home.
  - partial; the Web UI runbook and public quickstart now document Catalog
    Scope as the first stop for capped scans, hidden filters, missing symbols,
    suggested roots, and root-YAML fixes before users browse dense data tables.
  - partial; the README, public quickstart, and Web UI runbook now document
    Quick Jump, Page Home, Copy Link, and exact page/lens URLs so new users can
    navigate or share focused dashboard views without learning hash syntax.
- Improve visual design:
  - brokerage-app visual rhythm: portfolio value first, concise stats, light
    surfaces, clear green/red performance language, and calm typography
    - partial; the app shell now has a lighter raised-surface treatment,
      clearer active navigation, sticky desktop topbar, softened cards/tables,
      and mobile-safe nav/topbar behavior to make the dashboard feel less like
      a raw status dump while preserving the existing public-safe layout.
  - partial; desktop navigation now gives every top-level view a short
    plain-language purpose line while mobile keeps compact one-line tabs, so
    the app shell is easier to scan without crowding small screens.
  - partial; the topbar now includes a Quick Jump selector for every public
    page and focused lens, letting users open specific views such as Data
    Inspect, Workbench Run, Performance Trades, or Operations Remote without
    memorizing sidebar structure or hash routes.
  - partial; the topbar now also includes an "I want to" task selector that
    routes goal-oriented work such as monitoring today's run, reviewing
    performance, finding saved data, recovering fetches, building simulations,
    checking operations, and publishing safely to the right page/lens using
    current public-safe state.
  - partial; the "I want to" task selector now also tracks the active route,
    so sidebar, hash, Quick Jump, and page-intro navigation keep the broad task
    context visible instead of leaving the selector stale after a page change.
  - partial; the sticky topbar now includes a compact global status strip for
    mode, equity, status freshness, Gateway/API, visible runs, saved-data file
    count, and alerts, keeping brokerage-style operating context visible while
    users move between pages.
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
    - partial; dashboard CSS now defines semantic cash/equity/gain/loss/
      neutral/warning tokens plus reusable status background tokens for
      consistent financial/status styling.
    - partial; Overview, Performance, rollup, trade-ledger, and saved-data
      comparison return/PnL/equity values now use explicit `value-*`
      financial classes instead of reusing health/status coloring, so green/red
      performance language is visually separate from ok/warn/bad system state.
  - consistent badge styles for modes, health, fills, rejects, and stale data
    - partial; `statusText()` and quality/storage-contract badges now render
      through a shared `status-badge` style, giving ok/warn/bad/waiting states
      a consistent pill treatment across dense tables and cards.
  - consistent chart sizing and empty chart states
    - partial; core Performance/Data chart helpers now share a `chart-empty`
      empty-state treatment for missing equity, drawdown, benchmark,
      intraday, daily-return, calendar, status-rollup, price-preview, and
      comparison charts instead of returning unframed muted text.
  - reusable table toolbar patterns for search, filters, and export/copy actions
    - partial; the main saved-data, fetch, run-comparison, run-search,
      run-events, remote-node, and remote-activity filter rows now share a
      `table-toolbar` class and raised control-surface styling, while the CSS
      remains backward-compatible with existing `filter-row` and
      `symbol-directory-toolbar` selectors.
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
    - partial; Overview now defaults to a Home lens that keeps dense activity
      and diagnostic tables out of the first scroll while preserving Activity
      and Diagnostics lenses for users who need the detail.
    - partial; Performance now defaults to a Home lens with the result, story,
      latest equity, intraday session, and core charts, while Trades, Rollups,
      and Diagnostics carry the denser tables and context.
    - partial; Data Library now defaults to a Home lens and moves symbol
      browsing, file inspection, comparisons, and storage diagnostics into
      explicit focus lenses instead of showing every saved-data workflow at
      once.
    - partial; Fetch Jobs now defaults to a Home lens for root and recovery
      guidance, with Jobs and Detail lenses for dense manifest tables and
      selected fetch recovery/output inspection.
    - partial; Workbench now defaults to a Home lens, with Builder, Run, and
      Artifacts lenses carrying config forms, run controls/tables, and loaded
      artifact/log detail respectively.
    - partial; Runs now defaults to a Home lens, with State, Runs, and Events
      lenses carrying current account/order state, run search, and decision /
      order / fill timelines respectively.
    - partial; Operations now defaults to a Home lens, with Paper, Remote,
      Control, and Diagnostics lenses carrying paper-readiness checks, cloud
      node monitoring, command/supervisor surfaces, and setup/cleanup/Gateway
      diagnostics respectively.
    - partial; Help now defaults to a Home lens, with Pages, Workflows, Data,
      Boundary, and Docs lenses carrying guide/reference material away from the
      first-question routing and setup gaps.
    - partial; the reusable page-intro actions now support a target lens, so
      primary/secondary shortcuts take users to the relevant focused subview
      for the job being suggested.
  - partial; each page-intro now names a Recommended Next action and
    rationale, keeping the top of every page oriented around a concrete next
    task instead of only status text and dense workflow steps.
  - partial; each page-intro now also renders a compact Use This Page guide
    with Answers, Evidence, and Next Move cards, giving first-time users a
    plain-language orientation before dense dashboard surfaces or focused
    workflow steppers.
  - default every page to the most common question a user has on that page
  - add "last updated" and source labels beside every derived metric
    - partial; Overview and Performance cards now show compact source/freshness
      metadata for live telemetry, run summaries, account snapshots, selected
      windows, and fills-derived trade metrics
    - partial; the shared page intro now renders a per-page evidence strip with
      source/freshness/count chips for status telemetry, account snapshots,
      performance sources, data catalogs, fetch manifests, Workbench drafts,
      run comparisons, remote nodes, and public docs, so every top-level page
      starts with visible evidence before dense tables.
- Add UI quality gates:
  - screenshot-smoke every top-level page at desktop and mobile widths
    - partial; `scripts/smoke_dashboard_screenshots.py` now starts the
      dashboard with seeded synthetic state and captures every top-level view
      at desktop and mobile sizes with Chrome/Chromium when available.
    - partial; the screenshot smoke can now run `--check-layout` to verify
      each top-level view at desktop and mobile widths for horizontal viewport
      overflow and clipped core UI text.
    - partial; screenshot smoke now captures every deep-linked focus lens for
      Overview, Performance, Data Library, Fetch Jobs, Workbench, Runs,
      Operations, and Help at desktop and mobile widths, so focused subviews
      are protected by the same layout gate as top-level pages.
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
    - partial; empty-state screenshot runs now also execute semantic guidance
      checks for every focused view, failing if the expected empty-state
      assistants, workflow launchers, or setup notes disappear even when the
      page still passes geometric layout checks.
    - partial; screenshot layout checks now include the page-intro Use This
      Page guide cards in overflow, hit-test, and overlap coverage so the
      first-screen orientation layer is protected at desktop and mobile widths.
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
    - partial; the accessibility smoke now also fails on duplicate static
      element IDs and broken static ARIA id references, with an explicit
      allowlist only for dashboard elements rendered dynamically by JavaScript.
  - no overlapping text in tables, cards, charts, or mobile navigation
    - partial; CI now runs the screenshot smoke with layout checks against
      seeded desktop and mobile top-level/focus-lens views. The gate covers
      viewport overflow, clipped core dashboard text, and bounded direct-child
      surface overlap across the dashboard's main grid/card containers.
    - partial; screenshot layout checks now also run browser hit-testing over
      sampled core text/control points, flagging paint-level occlusion when an
      unrelated visible element covers the sampled point even if the container
      geometry check did not catch it.

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
  individual file rows. Data Home now includes workflow cards for finding a
  symbol, inspecting history, comparing files, building simulations, checking
  quality, and fixing root visibility, with each card reflecting current
  catalog/root/workbench state and deep-linking to the focused page for that
  job. The web client now separates fast core dashboard refresh from expensive
  saved-data scans: the catalog loads asynchronously with an explicit loading
  state, heavy Data Diagnostics scans are lazy until the Diagnostics lens is
  opened, and generated Workbench controls no longer crash dashboard startup
  before the first refresh.
  - partial; Symbol Directory now includes a Directory Assistant that recommends
    symbols from the current filtered catalog by recency, row coverage, quality,
    and file count, with direct Inspect, Workbench, Compare, and Filter actions
    before the denser symbol card grid.
  - partial; Data Home first-screen summaries, shortlist cards, workflow cards,
    and source-map root cards now include storage-contract readiness alongside
    quality so metadata blockers are visible before opening dense tables.
  - partial; Data Home now includes a Catalog Scope Assistant that explains
    whether the visible catalog is empty, capped by the scan limit, hidden by
    active filters, blocked by unconfigured suggested roots, or ready to
    browse, with direct actions for max-row scanning, diagnostics, root YAML,
    filter clearing, symbol browsing, and refresh.
  - partial; `/data_catalog` now exposes top-level catalog scope totals for
    supported candidates, parsed files, parser errors, unsupported files,
    skipped candidates, capped roots, not-scanned roots, completeness, and
    `catalog_visibility_status`; Data Library surfaces those fields in Catalog
    Scope and the catalog header so missing symbols are easier to diagnose.
  - partial; Data Home now includes a Data Inventory panel that consolidates
    the saved universe, configured/suggested root scope, coverage range,
    quality/storage-contract readiness, visible filtered rows, and direct
    Browse/Diagnostics/Workbench routes before the detailed root and symbol
    surfaces.
  - partial; Data Home now includes a Historical Data Review panel that
    explains visible universe size, filter pressure, coverage window,
    source/bar/session mix, quality/storage-contract readiness, root scope,
    best next file, and direct Browse/Inspect/Compare/Workbench/Fetch routes.
  - partial; Data Home now includes a Data Visibility Report that ties together
    current filters, catalog caps, configured/suggested roots, parser/skipped
    files, quality/storage-contract blockers, replay readiness, and fetch
    manifest output visibility so users can see why saved data is hidden,
    missing, outside roots, or ready to use.
  - partial; `/data_catalog` now publishes a normalized `root_inventory`
    summary plus per-root `inventory_status`/`inventory_reason` fields, and the
    Data Library scope/visibility/scan reports use those fields so parser
    errors, unsupported files, scan caps, not-scanned roots, and readable-root
    counts agree across the UI and scan CSV.
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
    - partial; symbol diagnostics now include a `diagnostic_summary`,
      `root_inventory`, and per-candidate quality/timestamp/storage-contract
      fields, so a visible but malformed dataset is distinguished from
      root/configuration, parser, catalog-limit, and fetch-failure misses.
    - partial; the Data Library diagnostics panel now has a Copy Report action
      for the latest symbol diagnostic, producing a bounded public-safe summary
      of the finding, next step, root inventory, candidate files, and fetch
      manifest clues.
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
    - partial; the Data Library focus lens lets users start with Home, jump to
      Browse for symbol search/table work, Inspect for saved-file charts,
      Compare for multi-file overlays, or Diagnostics for storage/root issues.
  - asset class filter: stock, ETF, crypto, unknown
    - partial; Data Library Browse now has an explicit facet summary that shows
      active filters plus visible asset, source, bar, session, quality, and
      storage-contract breakdowns before the dense saved-file table.
    - partial; Data Library Browse now includes a Saved Data Explorer that
      groups the bounded catalog by asset, source, bar size, storage session,
      quality, and storage-contract state, with one-click filters and summary
      counts before users reach the dense saved-file table.
    - partial; Data Library Home/Browse now includes a Saved History Matrix
      grouped by asset, source, bar size, and storage session, with symbol/file/
      row counts, range, replay readiness, and one-click Browse filters so
      users can see the historical-bar inventory before searching a ticker.
    - partial; Saved History Matrix can now export its current grouped
      inventory to CSV for offline universe review.
    - partial; Saved History Matrix rows now provide direct Browse, Inspect,
      Compare, and Workbench actions for the grouped asset/source/bar/session
      slice, so users can move from inventory review to charting or simulation
      without reselecting files manually.
    - partial; Saved History Matrix now starts with assistant cards for the
      best starting group, readiness mix, compare/workbench availability,
      active scope, and next action before the detailed matrix rows.
  - bar-size filter
  - source filter: IBKR, Schwab, Polygon, FirstRate, file, unknown
    - partial; source facets are populated from catalog metadata, with backend
      inference and coverage/export tests for IBKR, Schwab, Polygon,
      FirstRate, ZeroHash, file/example/cache-style sources where fixtures are
      available.
  - quality filter
    - partial; the Browse facet summary now surfaces quality and
      storage-contract readiness counts and provides a one-click Clear Browse
      Filters action, making active filter state visible before row scanning.
  - coverage range table for every symbol
  - row count, gaps, duplicate timestamps, timezone, adjustment metadata
    - partial; Data Library rows now expose inferred storage session and
      adjustment metadata alongside source timezone.
    - partial; Saved Data rows now include a synthesized Replay readiness cell
      that combines quality, storage-contract status, missing-interval pressure,
      source timezone, and adjustment metadata, so per-file replay screening no
      longer requires mentally joining several dense columns.
    - partial; Saved Data Browse can now filter and sort by synthesized Replay
      readiness, and Saved Data Explorer exposes Replay as a one-click group
      alongside asset, source, bar size, session, quality, and contract facets.
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
    extension/source/storage-session breakdowns, and suggested roots can be
    reviewed offline.
  - partial; Storage Audit rows now carry per-root scan duration and the
    summary/CLI report include total root scan time, making slow roots visible.
  - enumerate stock 1m, stock 5m, crypto 1m, crypto 5m, and sample data
    - partial; Storage Audit already guesses source, asset class, bar size, and
      storage session per file, and the dashboard table now surfaces
      asset/bar/session/source breakdowns per root instead of only
      extension/source counts.
  - compare files on disk to dashboard-visible catalog rows
    - partial; the storage-audit endpoint now returns an explicit
      `visibility_summary`, and Data Library renders Visibility Gap cards for
      configured-root visibility percentage, hidden configured files,
      suggested-root files, unsupported files, and scan caps before the dense
      root table.
  - summarize missing symbols, malformed files, unsupported extensions, and
    capped scans
    - partial; Data Library Diagnostics now starts with Catalog Health cards
      that summarize visible catalog files/symbols, parser errors, unsupported
      files, scan caps, hidden configured files, suggested-root files, and the
      next concrete data-visibility action before the scan/audit tables.
  - recommend config changes when real cache roots are absent
    - partial; Storage Audit now renders action cards that recommend adding
      suggested roots, raising scan limits, inspecting hidden configured-root
      files, or reviewing parser/root scan errors before using the catalog.
    - partial; Storage Audit now also has a Storage Audit Assistant that
      summarizes configured-root visibility, suggested roots, hidden files,
      unsupported files, scan caps, parser/root errors, and provides direct
      actions for copying `dashboard.data_roots`, raising disk/catalog limits,
      opening scan diagnostics, browsing visible symbols, or reviewing fetch
      jobs.
    - partial; Storage Audit now also counts unsupported-extension files,
      exports unsupported counts/samples, and shows bounded unsupported path
      samples beside hidden-file samples in the dashboard.
- Add historical-data visualization:
  - line/candlestick chart for saved files
    - done for Data Detail; saved files now have a range-filtered close-price
      chart and candlestick mode when OHLC columns are available, with
      close-line fallback for close-only files.
  - volume chart
    - done for the sampled Data Detail viewer when volume exists
  - selectable date range
    - done for Data Detail viewer
    - partial; Data Detail now has quick range presets for full file, last day,
      last week, last month, and last three months, derived from the opened
      file's timestamp coverage before manual Start/End tuning.
  - symbol picker that can load every scanned symbol, not just public examples
    - partial; every scanned catalog row can be inspected.
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
    - partial; Symbol Browser typeahead now supports Arrow Up/Down keyboard
      navigation, active-suggestion highlighting, Enter-to-select for the
      highlighted match, and ARIA active-option state for the suggestion list.
    - partial; Symbol Browser now has a Selected Symbol command strip that
      summarizes the active symbol, action file, coverage, quality, and direct
      Filter/Inspect/Workbench/Compare/Diagnose actions, reducing ambiguity
      after typeahead or dataset-selector changes.
    - done; Symbol Browser typeahead and quick-pick suggestions now support
      source, bar-size, storage-session, quality, and storage-contract facets,
      with clear hidden by facets states and a Clear Facets action while
      leaving global catalog symbol completion unfiltered.
    - partial; the main Saved Data search input now also uses catalog-fed
      symbol completion, so users can filter or browse from the same scanned
      symbol universe
    - done for Data Detail jump navigation; the detail viewer now has a
      catalog-backed Jump to Symbol input that opens the best matching saved
      file directly, and Find Missing Symbol shares the same suggestions.
  - gap markers
    - done for Data Detail line/candlestick charts and gap tables
    - partial; Data Detail charts now render gap bands/markers over the price
      area for returned gap rows, while still listing the exact gap intervals
      in the table below the chart.
    - partial; Data Detail chart gap markers now include a compact legend that
      shows how many returned gaps are visible in the current chart window and
      names the largest visible gap.
    - partial; Data Detail now has a Focus Largest Gap action that applies the
      selected file's largest returned gap as the chart/table date range, so
      suspicious missing-data regions can be inspected without manual date
      entry.
  - sampled and full-resolution modes
    - partial; sampled mode is default and full mode is available when the
      selected range fits the bounded point limit
    - partial; Data Detail now publishes explicit viewer status, omitted point
      counts, and a Viewer health card so users can tell whether a chart is
      full, sampled, empty, or unavailable.
    - partial; Data Detail now has a Detail Assistant that summarizes
      simulation readiness, coverage, gaps, nulls/duplicates, viewer state, and
      direct next actions before the user reaches the raw charts and tables.
    - partial; Data Detail Assistant and health cards now include
      storage-contract status/warnings in replay readiness, so single-file
      inspection surfaces metadata blockers before Workbench handoff.
    - partial; Data Detail overview cards now include catalog/opened-file
      storage-contract status and route the next action to metadata review when
      the selected file has contract warnings.
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
    - partial; Symbol Directory now includes a compact Symbol Coverage Ledger
      table for the current filtered/sorted symbol set, showing range, files,
      rows, source/bar/session mix, readiness, and direct Inspect/Filter/
      Compare actions before the larger symbol-card grid.
    - partial; Symbol Directory cards and Symbol Coverage Ledger rows now have
      direct Workbench actions that select the best saved file for a symbol and
      open Config Builder.
    - partial; Symbol Coverage Ledger can now export the current filtered,
      sorted, and limited symbol coverage table to CSV for offline review.
    - partial; Data Home now shows a ranked shortlist of currently visible
      saved files with direct Inspect, Filter, and Compare actions, so users can
      start from recommended catalog rows before using dense tables.
    - partial; Data Home now includes a Saved Data Preview Wall with sampled
      close-path sparklines, range/source/bar/readiness context, and direct
      Inspect/Compare/Workbench actions for the top visible saved files.
    - partial; Data Home now includes a Universe Coverage panel summarizing the
      scanned symbol universe by file/row count, latest saved timestamp,
      sources, assets, bar sizes, storage sessions, replay-readiness, and
      top symbols with direct filter actions.
    - partial; the main Saved Data table search now has a Search Assistant
      that summarizes visible/hidden rows, matched symbols, quality, source/bar
      breakdowns, and catalog-backed Filter, Inspect, Compare, and Diagnose
      actions for likely symbol matches.
    - partial; the Search Assistant now also summarizes storage-contract
      counts and includes contract status in active facets and symbol
      suggestions, so filtered file sets show metadata review pressure.
    - partial; Data Library now has a first-screen Data Source Map that
      translates configured and suggested root diagnostics into visible,
      hidden/capped, parser-error, unavailable, and not-scanned root states
      with direct actions for filtering, audit, scan diagnostics, fetch jobs,
      scan-limit review, and root YAML copying.
    - partial; Compare Saved Data can now copy the exact `/data_compare`
      request JSON for the current selected datasets, date range, point count,
      and sampling mode.
    - partial; Compare Saved Data now has range presets for full selected
      range, common overlap, and last day/week/month/three months inside the
      selected datasets' common overlap, reducing manual date-window setup.
    - partial; Compare Saved Data can now send the selected compared datasets
      and date window directly into the Workbench Config Builder, closing the
      compare-to-simulation workflow without reselecting files manually.
    - partial; Compare Saved Data now has a comparison stats strip for leader,
      laggard, return spread, timestamp overlap, sampling mode, and warnings,
      so multi-file historical comparisons are readable before the dense
      symbol/path table.
    - partial; Compare Saved Data now includes storage-contract filtering and
      selected-file contract readiness in its assistant/readiness cards, so
      comparison-to-Workbench handoff surfaces metadata warnings.
    - partial; Compare Saved Data now has a Compare Assistant that summarizes
      selected files, overlap, common timestamps, warnings, return spread, and
      direct Compare/Overlap/Workbench/Export/JSON actions before the raw chart
      and table.
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
    - partial; Data Detail now has a Range Stats strip above the chart for
      selected-range return, close range, OHLC high/low span, open-to-close
      move, candle direction balance, bar movement, median/max volume, gap
      pressure, and viewer sampling/full-state, so saved history is readable
      before opening raw metadata tables.
- Add data coverage diagnostics:
  - coverage heatmap by symbol/date
    - partial; Data Library now renders recent date-bin coverage by symbol
    - partial; Data Library now exposes `/data_coverage_export` and an Export
      Coverage CSV button so symbol/date coverage rows can be reviewed offline.
  - missing-day and missing-minute summaries
    - partial; dataset details show gap rows/missing intervals, coverage view
      shows missing recent date bins, and Minute Coverage Heatmap now covers
      aggregate UTC-hour and bounded worst date/hour missing-interval patterns.
    - partial; Data Library Diagnostics now starts with a Data Coverage
      Assistant that summarizes shown/total symbols, recent date-bin coverage,
      timestamp/calendar gap pressure, minute completeness, and direct
      review/export actions before the dense heatmaps and tables.
    - partial; Data Library now has a Gap Summary panel backed by
      `/data_gap_summary`, showing worst timestamp-gap files, estimated missing
      intervals, largest gaps, and missing calendar-day rows across the current
      bounded catalog scan; minute-level heatmap drilldowns now live in the
      Minute Coverage Heatmap panel.
    - partial; Data Library now exposes `/data_gap_summary_export` and an
      Export Gap CSV button for aggregate timestamp-gap and calendar-gap rows.
    - partial; Data Library now has a Minute Coverage Heatmap backed by
      `/data_minute_heatmap`, summarizing expected vs actual intraday intervals
      by UTC hour for bounded catalog rows and listing worst incomplete files.
      Data Library now also renders bounded worst date/hour missing-interval
      strips and table drilldowns from the same endpoint. Data Detail now
      lists bounded exact inferred missing timestamps for the selected saved
      file and can export a full-file missing-interval CSV through
      `/data_missing_intervals_export`.
    - partial; Data Library now exposes `/data_minute_heatmap_export` and an
      Export Minute CSV button for intraday hour, date/hour, and date/hour
      matrix completeness rows.
  - "why is this symbol not visible?" diagnostic
    - done for configured/suggested roots, parser failures, catalog limits, and
      fetch-manifest clues
  - data-root scan errors in the UI
    - partial; catalog parser errors and root diagnostics are visible
    - partial; Data Library now exposes `/data_catalog_scan_export` and an
      Export Scan CSV button for configured-root parser errors, unsupported
      files, catalog caps, scan timings, and skipped-file samples.
    - partial; Data Diagnostics now includes a copyable Catalog Scan Report
      before the raw scan table, summarizing root scope, candidates/parsed
      files, parser errors, unsupported/skipped samples, scan caps, Storage
      Audit hidden/suggested files, top issue root, and next actions.
  - root-by-root scan duration, file count, skipped count, and parser error
    count
    - partial; Data Library now shows catalog scan diagnostics with per-root
      candidate, parsed, parser-error, unsupported-file, cap/reason, and scan
      duration fields. Storage Audit still handles deeper full-root file counts.
    - partial; Storage Audit now also displays and exports per-root scan
      duration for the deeper full-root file audit.
  - warning when the catalog result is capped and not all symbols are shown
    - done in the Data Library visibility card
    - partial; the Data Home Catalog Scope Assistant now surfaces scan-cap and
      hidden-filter states as first-screen actions before users conclude a
      symbol is missing.
    - partial; the top-level catalog payload and Browse header now explicitly
      report capped-root count and catalog visibility status instead of relying
      only on per-root diagnostics.
- Add saved fetch manifests:
  - Progress: stock and crypto fetchers write dashboard-readable JSON manifests
    under `paper_logs/fetch_manifests` by default; the dashboard has Fetch Jobs
    list/detail endpoints and UI. The crypto fetcher still keeps its chunk CSV
    for resumability.
  - every fetch run should write a manifest with symbols, bar size, duration,
    start/end, output files, success/failure counts, pacing pauses, and errors
    - done for stock and crypto JSON manifests, including retry summaries,
      actual pacing-wait events, progress/ETA snapshots, output rows, and
      error rows
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
    - partial; Fetch Detail now has a dedicated Resume From Manifest panel with
      skip/retry/review/pending scope cards and an inline copyable resume
      command, so manifest recovery no longer depends on finding the command in
      dense summary rows.
    - partial; fetch manifest list/detail payloads and detail CSV exports now
      include the backend-generated `resume_command`, and the dashboard copies
      that manifest-owned command rather than reconstructing it only in the
      browser.
  - fetch manifests should connect directly to Data Library rows so a user can
    go from a completed fetch job to the symbols and files it produced
    - partial; output paths under configured data roots now link directly to
      Data Detail, and Fetch Detail now distinguishes inferred resume plans
      from normalized manifest-owned `resume_state` when newer fetch manifests
      publish explicit completed/pending/no-data/retry state.
    - partial; Fetch Detail now summarizes output visibility as visible,
      missing-under-root, outside configured roots, or no-path, and surfaces
      those counts in recovery cards plus per-output status labels.
    - partial; Fetch Detail output rows now include Replay readiness cells for
      Data Library-visible outputs, reusing saved-data quality/storage-contract
      screening and flagging missing/outside/unsupported outputs before
      Workbench handoff.
    - partial; Fetch Detail can now filter Data Library to the selected job's
      visible output files, making completed fetch output sets reviewable as a
      group.
    - partial; Fetch Detail can now send Data Library-visible outputs directly
      into Compare Saved Data and load a normalized comparison chart for the
      manifest date window when at least two visible outputs exist.
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
    - partial; the Jobs lens now includes a Fetch Search Assistant that
      summarizes visible/hidden jobs, status/kind mix, recovery pressure,
      output visibility, retry/pacing pressure, and recommended manifests with
      direct Inspect, Status, and Kind filter actions before the dense table.
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
    - partial; Fetch Jobs now also has workflow cards for configuring roots,
      monitoring jobs, recovering failures, reviewing outputs, opening saved
      data, and sending visible outputs to Workbench, giving completed-fetch
      workflows a task-oriented first screen before the dense manifest table.
    - partial; Fetch Jobs now uses Home / Jobs / Detail focus lenses so active
      and completed jobs can be scanned in a dedicated Jobs view while root
      setup and selected-manifest detail stay out of the way.
    - partial; Fetch detail recovery cards now consume backend recovery
      status/action guidance, distinguishing permission blockers, contract
      fixes, retryable failures, no-data review, and data-root visibility
      fixes.
    - partial; Fetch Home now includes a Fetch Progress Review that summarizes
      active, partial, and failed manifests, symbol/chunk progress, ETA and
      rolling pace, retries, pacing waits, output visibility, recovery state,
      and a focus job before users open the dense Jobs table.
  - progress by symbol and chunk
    - partial; symbol/chunk summaries are visible from the JSON manifest
  - rolling ETA based on recent chunk time
    - done; crypto fetch manifests persist latest rolling ETA,
      completed/remaining chunk counts, and rolling average chunk time, while
      stock fetch manifests persist rolling symbol ETA/progress fields for the
      dashboard summary/detail views.
  - success/failure/retry counts
    - done; success/failure/no-data counts are persisted and retry events are
      counted by the shared manifest writer
    - partial; the shared fetch manifest now counts retry events and the
      crypto fetcher records bounded per-attempt retry events with delay,
      attempt, symbol, and day context.
    - partial; the stock fetcher now supports optional per-symbol retries,
      records retry events, records output/error attempt counts, and keeps
      default retry behavior unchanged unless `--retries` is set.
  - pacing waits
    - done; configured pacing delay and actual pacing-wait events are persisted
      and summarized
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
    - partial; symbol-directory summaries now group files by `canonical_symbol`
      while preserving `raw_symbols`, raw-symbol counts, and mixed-raw-symbol
      flags in API/CSV output, so crypto aliases such as `BTC` and `BTC-USD`
      appear as one canonical symbol without hiding the original filenames.
  - consistent bar-size naming
    - partial; Data Catalog now normalizes common column/path bar-size aliases
      such as `5m`, `5 min`, `5-minute`, `1 hour`, and `daily` into canonical
      labels like `5min`, `1h`, and `1d` for grouping, filtering, CSV export,
      and Workbench handoff. Storage Audit applies the same normalization to
      path-derived guesses while keeping its bounded no-file-read scan fast.
  - UTC-normalized timestamp storage with source timezone metadata
    - partial; Data Catalog, Data Detail, range exports, coverage, compare,
      alignment, heatmap, and missing-interval tooling now honor explicit
      `source_timezone`/`timezone` metadata before normalizing naive timestamps
      to UTC. Common UTC/Eastern aliases are normalized, and regression coverage
      proves an `America/New_York` 09:30 source bar is exposed as 14:30 UTC
      without a naive-timezone storage-contract warning.
  - adjustment metadata for stocks
  - clear distinction between RTH, extended hours, and 24/7 crypto
    - partial; Data Catalog and Data Detail now expose inferred canonical
      symbol, storage session (`rth`, extended, `24_7`, unknown), and
      adjustment status metadata, with catalog CSV export fields for the same
      values.
    - partial; Data Catalog, Data Detail, Storage Audit, catalog/directory CSV
      exports, and the storage-audit CLI now expose a storage-contract status
      that flags missing/ambiguous symbol, bar-size, session, stock adjustment,
      timestamp timezone, and UTC-normalization metadata before replay.
    - partial; Data Library Browse now includes a storage-contract filter,
      contract-first sort, and contract-aware text search so review-status
      files can be isolated without reading the full catalog table.
    - partial; Workbench selected-data quality and Selected Data Packet panels
      now carry storage-contract status/warnings so metadata ambiguity is
      visible before draft generation.
- Add resumability:
  - skip chunks already present
  - retry failed chunks
  - mark no-data responses separately from permission errors
  - persist enough state to resume after Gateway or PC restart
    - partial; JSON fetch manifests now publish an explicit `resume_state`
      block with completed symbols/output paths, pending/failed symbols,
      failed/no-data days by symbol, no-data symbols, retryable symbols, and
      supported resume modes. Stock and crypto resume loaders prefer that
      normalized restart state while remaining compatible with older manifests,
      and dashboard resume plans consume it when present.
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
      metadata with a 24/7 crypto calendar-gap fixture. Extended-hours stock
      fixtures now also cover catalog, coverage, gap summary, and gap CSV
      export storage-session metadata alongside the existing RTH catalog tests.
  - malformed/skipped files with visible reasons
    - partial; parser failures and unsupported files are covered by catalog
      scan diagnostics. Catalog rows and Data Detail now also warn on malformed
      minute bars with high below low, closes outside high/low, and negative
      volume.
    - partial; ingestion regression coverage now includes a mixed RTH,
      extended-hours, and 24/7 crypto fixture in one data root, asserting that
      catalog, coverage, gap summary, minute heatmap, and their CSV exports
      preserve storage-session metadata across the same bounded scan.
    - done; symbol-level catalog and coverage summaries now explicitly mark
      mixed-session symbols when the same ticker has both RTH and extended
      files, and the Data Library universe/directory panels surface that
      review state before replay.
    - partial; storage-audit regression coverage now also asserts mixed
      RTH/extended/24_7 storage-session guesses across configured and suggested
      roots, including API payloads, CSV export headers, and CLI human/JSON
      output.
    - partial; regression coverage now asserts storage-contract status/counts
      in catalog rows, symbol summaries, Data Detail, Storage Audit API output,
      CSV headers, and CLI JSON/human output.
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
    - done; the dashboard now distinguishes an untouched static selector value
      from an intentional user override, so an ignored local config default is
      honored on the first catalog scan while manual row-limit choices persist.

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
    validation/run state, and artifact inspection. The form and step metadata
    are now schema-driven; richer plugin-authored display and help formatting
    remain future work.
  - partial; Workbench Builder now includes a Plugin Field Help panel that
    renders selected-plugin `strategy_fields`, `result_fields`, and
    `result_sections` help, defaults, bounds/options, formatting hints,
    required/advanced flags, grouped field labels, and public-safe field paths
    before users edit or run drafts.
  - partial; `/config_options` now exposes `guide_schema_version` and
    `guide_steps`, and the Workbench guide consumes backend step labels/order
    while keeping dynamic readiness details in the frontend.
  - partial; the guide schema is now v2 and labels the old `quality` step as
    Review Data, with help text that covers both catalog quality warnings and
    storage-contract metadata before replay.
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
  - partial; Workbench Home now also includes workflow cards for selecting
    data, previewing alignment, building a draft, running a draft, opening
    results, and reviewing plugin/public-private boundaries, giving users a
    job-oriented route before the detailed guide/stepper.
  - partial; Workbench Home now includes a Simulation Plan panel that compresses
    data selection, date range, alignment, plugin boundary, draft validation,
    run state, and artifact inspection into a numbered public-safe checklist
    with direct Builder, Run, Artifacts, and Performance routes.
  - partial; Workbench Home now includes a Readiness Review panel that turns
    selected data, alignment, plugin boundary, draft validity, latest run,
    loaded artifacts, and the next route into a plain-language run-or-fix
    decision before users enter the denser builder/run screens.
  - partial; Workbench now has a Run Result panel directly after Run Draft,
    summarizing the selected draft's latest run, artifact availability,
    decisions/fills/rejections, and direct Performance/Runs/Log actions.
  - partial; Workbench now has Selected Data Actions that summarize selected
    files, quality issues, comparison readiness, and range, with direct actions
    to inspect the first selected file, compare selected files, or return to
    Data Library.
  - partial; Workbench selected-data actions and Compatibility Review now count
    storage-contract warnings beside quality warnings before draft generation,
    and list selected contract issues in the compatibility detail.
  - partial; Workbench guide steps, Home tiles, workflow cards, builder
    readiness cards, builder assistant, dataset selectors, and benchmark
    selectors now use combined quality/storage-contract readiness so users do
    not see quality-only signals while building drafts.
  - partial; Workbench Builder now includes a Selected Data Packet panel that
    shows the current saved-file selection, quality pressure, bar/source mix,
    date-window choice, alignment overlap state, per-file ranges, and direct
    Inspect/Compare/Remove actions before draft generation.
  - partial; Workbench Selected Data Packet now includes a Selected Data
    Coverage ledger with replay-readiness cards, per-file source/bar/session/
    range rows, direct Inspect/Compare/Remove actions, and Export Selected Data
    CSV so the saved-data handoff can be audited before draft generation.
  - partial; generated Workbench dataset multi-selects no longer auto-select
    the first catalog file before the user chooses data, while the separate
    Compare Saved Data view keeps its deliberate two-file starter selection.
  - partial; Workbench now has a Preview Draft action backed by
    `/config_draft_preview`, which runs the same server validation, alignment,
    plugin-boundary, and command generation path while returning unsaved YAML
    for review before a local draft file is written.
  - partial; Workbench now uses Home / Builder / Run / Artifacts focus lenses
    so choosing data, editing config, running drafts, and inspecting artifacts
    are reachable as explicit workflow stages instead of one long page.
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
  - partial; Workbench Builder now starts with a Public / Private Boundary
    summary that counts public-example versus local/private plugins, shows
    selected plugin visibility/spec/schema/registry paths, explains exposed
    public-safe fields, and provides direct actions to choose a plugin, inspect
    boundary detail, review field help, or open the boundary guide.
- Add schema-driven form rendering after config schemas are reliable.
  - partial; `config_draft_options` now returns public-safe form field metadata
    for the core Config Builder fields, and the Workbench renders those
    controls from schema while preserving existing draft/alignment behavior.
    Versioned schemas are now explicit; richer plugin-authored validation hooks
    remain future work.
    - partial; Workbench plugin registries can now declare non-executable
      public-safe `validation_rules` for required fields, require-any field
      groups, and numeric comparisons. The server normalizes and enforces those
      rules during draft preview/save/run validation, `/config_options` exposes
      them, and Plugin Field Help renders the constraints before users generate
      YAML. Arbitrary executable validation logic remains private-runner-only
      through plugin Python hooks and is not exposed in public metadata.
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
    The form schema version was bumped to v4 after adding `required`,
    numeric min/max, select-options validation, unknown-key rejection,
    saved-draft strategy revalidation, and display-only metadata for those
    fields, including descriptions, placeholders, units, affixes, advanced
    badges, ordering, and select-option descriptions.
  - partial; Workbench guide step metadata is now schema-driven through
    `/config_options.guide_steps` and exported workbench snapshots include
    `guide_schema_version` for downstream UI/schema compatibility checks.
  - partial; plugin registry entries can now expose public-safe
    `result_fields`, artifact payloads preserve those labels/format hints, and
    Run Artifacts renders a bounded Plugin Result Fields table from matching
    `diagnostics.dashboard` keys without exposing raw private signal payloads.
    Artifact payloads now also include public-safe plugin result coverage, and
    Run Artifacts shows a Plugin Boundary / Result Coverage view with matched
    plugin metadata, declared input/result counts, emitted values, latest
    declared values, and sanitized but unlabeled dashboard keys.
  - partial; plugin result fields now support public-safe display formatting
    through `decimals`, `prefix`, `suffix`, and `unit` metadata, and Run
    Artifacts applies those hints in Plugin Result Fields and Result Coverage
    instead of showing only raw scalar values.
  - partial; Run Artifacts now adds a Plugin Result Snapshot card grid that
    turns declared `result_fields` into compact latest-value cards with
    coverage, formatted values, timestamps, symbols, and help text before the
    dense plugin coverage/result tables.
  - partial; Run Artifacts now also shows a Plugin Result Display Plan for
    declared `result_fields`, surfacing display order, field path, kind,
    formatting hints, latest formatted value, emitted coverage, and help text
    before the dense result tables.
  - partial; plugin registry entries can now declare public-safe
    `result_sections` that group declared `result_fields`. Registry validation
    rejects sections that reference undeclared fields, artifact payloads include
    section-level coverage, and Run Artifacts renders grouped result cards
    before the snapshot and dense coverage tables.
  - partial; Run Artifacts now summarizes declared `result_widgets` before
    rendering them, showing widget kinds, emitted-field coverage, sparkline/
    line-chart/custom-chart point availability, incomplete widgets, and the next
    action for missing public-safe diagnostics.
- Add saved draft folders/tags/status labels.
  - done for the Workbench saved-drafts table; draft records now expose folder,
    status label, and tags derived from mode/status/plugin/symbol count, and
    the UI displays them beside validation/output state.
  - done for offline inventory; Workbench now has Export Drafts CSV backed by
    `/config_drafts_export`, including folder, status, mode, plugin, symbols,
    tags, validation state, output directory, and local YAML path.
  - done for first-screen triage; Workbench Run now includes a Draft Inventory
    Review that summarizes folders, status labels, tags, validation coverage,
    runnable drafts, selected-draft state, latest runs, and the next action
    before the dense saved-draft and run tables.
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
    Plugin-authored field display now also supports public-safe descriptions,
    placeholders, units, affixes, advanced badges, ordering, and select-option
    descriptions plus result-field formatting hints.
- Add a "copy command" affordance for local CLI commands.
  - done for generated Workbench local commands
  - partial; the Workbench Run lens now also shows copyable validate, replay,
    and simulated-paper `live/plugin_runner.py` commands for the selected saved
    draft, including the current max-steps setting, so users do not have to
    return to the generated YAML panel to run a saved draft locally.
  - partial; the Workbench Run command panel now has summary cards for selected
    draft, validation state, selected action, and execution boundary before the
    raw copyable commands, making the generic public runner path easier to
    understand without reading source.
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
  - partial; Workbench Run Draft now includes a Run Readiness panel beside the
    actual run form, showing selected-draft, validation, action, latest-run,
    and result-artifact state with explicit blockers, warnings, and direct
    Validate / Run / Open Results actions.
  - partial; completed replay/simulated-paper runs now load the exact archived
    run artifacts when available, refresh run-comparison and daily/period
    performance rollups, and move the Workbench into artifact inspection instead
    of leaving users to hunt through run tables after pressing Run.
  - partial; Run Readiness now exposes a Run + Performance action for
    replay/simulated-paper drafts, using the same run path but opening the
    Performance page after completed artifacts load so the guided workflow has
    a one-click finish.
  - partial; Workbench Artifacts now has an Artifacts Assistant that summarizes
    loaded run identity, return/drawdown evidence, execution counts, plugin
    result-field coverage, rollups, held order previews, and direct
    Performance/Runs/Log/Export actions before dense artifact tables.
  - partial; Help > Workflows now includes a state-aware Workbench Quickstart
    that turns saved-data discovery, selected data, alignment, draft generation,
    run execution, and artifact loading into six status cards with direct jumps
    to Data Library, Builder, Run, Artifacts, and Performance.
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
  - partial; Paper Monitor now also has an Observation Packet that separates
    runner heartbeat, Gateway/API, market-data feed, account feed, decision
    loop, order context, and mode safety so users can tell whether a paper
    runner is actively observing/evaluating before reading the full checklist.
  - partial; Operations Home now also includes workflow cards for Paper
    Monitor, Gateway/API, Remote Nodes, Command Audit, Control Queue, and
    Diagnostics, giving users a job-oriented route into paper readiness,
    cloud monitoring, command review, and local setup checks.
  - partial; Operations Home now includes an Operations Readiness panel that
    consolidates local paper checks, Gateway/API reachability, remote-node
    freshness, command-audit integrity, control queue state, local alerts, and
    the next operational drilldown before dense paper/remote/control tables.

## P1: Operations and cloud monitoring

- Add real cloud endpoint support beyond the local mock receiver.
  - partial; the receiver already accepts authenticated status posts and command
    polling over HTTP, and now exposes `/remote_nodes` for sanitized latest
    read-only monitoring summaries by node. Deployment-oriented hosting docs
    and cloud-provider boundary examples are in place; real-provider hardening
    review remains open.
  - partial; `docs/cloud_monitoring_deployment.md` now documents a conservative
    deployment shape for local-first remote monitoring, private-network access,
    hosted receiver precautions, command-worker boundaries, and failure modes.
    Provider-specific examples now cover AWS, DigitalOcean, GCP, Azure, Fly,
    Render, nginx/Caddy, and UFW; hardened internet deployment remains open.
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
    security-group Terraform sketch. Provider boundary examples now also cover
    DigitalOcean Cloud Firewalls, Google Cloud firewall rules, and Azure NSG
    rules. Remaining gap: real-account hardening review before internet
    exposure.
  - partial; provider-specific examples now also include a reusable hosted
    receiver Dockerfile, Fly app config, Render Blueprint config, DigitalOcean
    Cloud Firewall Terraform sketch, GCP firewall Terraform sketch, Azure NSG
    Terraform sketch, provider-specific off-host audit-retention sketches, and
    a dry-run-first off-host command-audit sync helper. Remaining gap: manual
    hardening review against a real chosen provider/account before any
    internet-facing deployment.
  - partial; `scripts/audit_cloud_examples.py` now statically checks the public
    cloud examples for expected auth, network-access, dry-run, proxy,
    firewall, and off-host retention boundary markers, and CI runs it with the
    public readiness audit. This catches accidental weakening of the examples;
    real provider/account hardening review remains open.
  - partial; Operations Diagnostics now includes a Cloud Deployment Readiness
    report that summarizes remote monitoring evidence, command-audit integrity,
    local-only trading authority, authentication, network boundary, retention,
    and current alerts in copyable rows while clearly marking provider/network
    hardening as manual review.
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
  - partial; Remote Nodes now has a Remote Nodes Assistant that summarizes
    heartbeat, alerting nodes, open-order nodes, Gateway/API issues, and active
    filters, with direct actions to sort risky nodes first, open newest detail,
    prepare a read-only status check, clear filters, or export CSV.
  - partial; the seeded dashboard smoke now asserts the Remote Nodes Assistant
    markup and action handlers, so the remote-monitoring triage surface cannot
    disappear from the public UI without failing the render contract gate.
  - partial; Operations now exposes `/remote_nodes_export` and an Export Nodes
    CSV button for offline review of sanitized heartbeat, Gateway, mode,
    equity, positions, open orders, activity counts, freshness, and alerts by
    node.
  - partial; Operations now starts with an Operations Home band that summarizes
    local paper-monitor readiness, Gateway/API reachability, remote-node
    freshness, command-audit integrity/signature status, and alerts before the
    detailed remote/control tables.
  - partial; Operations now uses Home / Paper / Remote / Control / Diagnostics
    focus lenses so paper readiness, cloud monitoring, command controls, and
    setup/cleanup/Gateway diagnostics are no longer one continuous operations
    page.
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
    state mismatches. It now also classifies bounded recent generic runner
    `orders.jsonl` rows into public-safe order-state categories such as held
    for approval, broker login/session required, broker API disconnected,
    inactive, cancelled, rejected, and risk-limit. Dashboard alert display
    already surfaces the emitted alert rows; deeper broker-native open-order
    state still depends on adapter-specific telemetry.
- Add historical run pages in the cloud view with bounded artifacts and logs.
  - partial; `/remote_node_detail` and the Operations Remote Node Detail panel
    now provide bounded sanitized latest runs, alerts, and status history for
    a posted node. It intentionally avoids raw local logs or strategy
    diagnostics; richer cloud-side archived artifact/log browsing remains open.
  - partial; local/public Workbench runs now expose bounded run evidence through
    `/config_draft_run_evidence` and the Run Log panel. Hosted/cloud run pages
    still need retention and privacy policy before mirroring full archived
    artifact/log browsing off the trading machine.
  - partial; Remote Node Detail now adds snapshot, latest-activity, and alert
    summary cards plus a combined sanitized recent decisions/orders/fills table
    with type filtering. Raw logs and full artifact browsing remain out of the
    hosted view until retention and privacy boundaries are stronger.
  - partial; remote run artifact evidence now includes sanitized artifact
    categories, metadata-file counts, event-stream counts, safe missing-file
    names, and CSV/UI summaries so hosted views can inspect artifact health
    without mirroring raw log lines or local paths.
  - partial; Remote Node Detail now also adds run-health cards for completed
    versus failed latest runs, visible activity, rejection counts, latest
    decision age, equity snapshot visibility, and the sanitized cloud boundary
    before the dense remote run/activity tables.
  - partial; Operations now exposes `/remote_node_detail_export` plus an
    Export Detail CSV button for the selected remote node, covering sanitized
    summary, bounded history, latest runs, alerts, supervisors, and recent
    decision/order/fill rows without raw logs or strategy diagnostics.
  - partial; the status publisher now includes bounded artifact evidence for
    generic runner output directories, and Remote Node Detail plus its CSV
    export show expected public artifact file presence, byte counts, modified
    times, and JSONL row counts without posting raw artifact contents or logs.
  - partial; Remote Node Detail now has a Remote Detail Assistant that
    summarizes heartbeat freshness, alerts, latest-run health, activity mix,
    artifact evidence, and the sanitized cloud boundary, with direct actions
    for activity filters, CSV export, and command-target selection.
  - partial; Remote Node Detail now publishes an explicit retention/privacy
    boundary policy in the API, CSV export, and UI, documenting snapshot/run/
    event/artifact bounds plus excluded raw logs, credentials, local paths, and
    private strategy diagnostics before any richer cloud archive browsing.
  - partial; Operations Remote now includes a Remote Monitor Report that
    summarizes node coverage, heartbeat freshness, Gateway/API state, alerts,
    open orders, stale data/account timestamps, and next actions in copyable
    plain-language rows before the dense remote-node table.
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
    before the next data/plugin/broker pass. Generic runner executions now
    maintain a public-safe `runner_status.json` heartbeat/status artifact with
    lifecycle state, loop/session counters, latest data time, stop/pause marker
    presence, and final result pointers. Generic runner executions now also
    write `plugin_contract.json`, a public-safe contract artifact with plugin
    identity, data-symbol counts, runner/execution settings, observed
    dashboard keys, order-intent metadata key names, and artifact file records;
    Workbench archives and displays it in the Plugin Boundary view. The generic
    local supervisor now has an opt-in managed-job `restart` policy that can
    relaunch exited managed children or terminate/relaunch a managed
    plugin-runner child when its `runner_status.json` heartbeat is stale, with
    a per-hour restart cap and pause-marker guard. Richer UI controls and
    provider/service-specific restart recipes remain open.
  - partial; the public repo now includes
    `ops/systemd/algo-trade-plugin-supervisor.service`, a user-level systemd
    service for the generic local supervisor that validates an ignored local
    supervisor config before start. The quickstart and restart runbook document
    the install/start/restart flow.
  - partial; the service restart runbook now includes provider/service-specific
    recipes for local user-level systemd units, the generic plugin supervisor,
    status publisher, command worker, hosted Docker Compose receiver, Fly,
    Render, reverse-proxy reloads, and firewall dry-run checks. Help and the
    public docs point users to those recipes before restarting broad process
    groups.
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
    `strategy.<field>`. The Workbench form schema is now v4, with
    public-safe plugin display metadata for descriptions, placeholders, units,
    affixes, advanced badges, ordering, select-option descriptions, and grouped
    plugin result sections. Plugin registries can now also declare public-safe
    result widgets for card, table, bar-summary, sparkline, multi-series
    line-chart, and allowlisted declarative custom-chart artifact displays.
    Arbitrary executable chart plugins remain intentionally outside the public
    metadata boundary.
- Add optional order previews and manual approval hooks for paper/live mode.
  - partial; generic plugin-runner configs can set
    `execution.require_order_approval: true`, which writes
    `order_previews.jsonl` and holds simulated-paper/paper orders unless the
    run is launched with `--approve-orders` or a matching local approval file
    is present. Each preview now has a deterministic `approval_id`, full digest,
    and expected approval-file path, and `scripts/approve_order_preview.py`
    writes the matching approval JSON for one held preview. The dashboard can
    now also write one validated local approval file from the Order Previews
    artifact table after explicit operator confirmation. Dashboard performance
    and artifact summaries surface approval-hold counts.
  - partial; archived/draft run artifact loading now preserves bounded
    `order_previews.jsonl` rows, sanitizes approval preview details, and the
    Runs artifact view shows a dedicated Order Previews table with approval IDs
    and local approval-file paths for held orders. Artifact payloads now expose
    the preview JSONL path when available, and the dashboard can copy a
    one-preview approval helper command for local terminal execution.
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
    annual borrow fees over elapsed account-snapshot time. Simulated execution
    now also supports optional `execution.sim_cost_models`, selected by
    public-safe order-intent metadata such as `venue` or `cost_model`, so
    venue/model-specific slippage and commission schedules can be tested
    without changing plugin code.
- Add broker-agnostic execution adapters so private configs can choose IBKR,
  file-based simulation, or future broker integrations without changing
  strategy plugins.
  - partial; generic paper execution now uses a broker adapter factory with
    `ibkr` and a local file-backed adapter for public plumbing tests. Strategy
    plugins still see the same order/fill interface.
  - partial; broker adapters now publish public capability metadata for
    account modes, order types, order sizing, Gateway/static-price
    requirements, account-ID verification support, local-state behavior, and
    known IBKR paper/live ports. The generic runner uses that metadata for
    adapter-aware safety checks, and the Workbench exposes it in a Broker
    Boundary panel. Future adapters can now be listed as metadata-only
    capability records, with Schwab documented that way so validation rejects
    paper/live execution clearly until a real implementation exists. Full
    Schwab/future broker execution remains open.
- Add stronger paper/live gates to prevent accidental live orders.
  - partial; generic paper mode now requires `--confirm-paper-orders`, rejects
    `broker.account_mode: live`, and refuses known live IBKR ports (`4001`,
    `7496`) unless both config and CLI explicitly opt in. Broker-native
    account verification now exists where adapters expose account ids; real
    live execution remains future work.
  - partial; generic paper mode now supports optional
    `broker.expected_account_id`, verified after broker connection and before
    order submission for adapters that expose account ids. IBKR uses managed
    accounts; the file-backed adapter exposes its local account id for tests
    and demos. Configs can also set `broker.require_expected_account_id: true`
    to fail validation when the expected account is absent. Unsupported broker
    live account modes now fail config validation.
  - partial; generic live mode is now a recognized fail-closed placeholder:
    configs must opt in with `execution.enable_live_orders: true`,
    `execution.require_order_approval: true`, `broker.account_mode: live`, and
    `broker.expected_account_id`, and commands must pass
    `--confirm-live-orders`. The public generic runner still refuses live
    execution until a real live broker path is designed and implemented.

## P2: Publication readiness

- Keep the exported public repo as the clean public candidate.
  - done; `scripts/export_public_repo.py --list` now prints the
    destination-relative public file manifest without writing a destination,
    making public subset review possible before an export refresh.
  - done; `scripts/export_public_repo.py --list --json` now emits a
    machine-readable public manifest with source paths, destination paths,
    file sizes, file count, and top-level counts for CI or publication-review
    tooling.
- Add CI checks around `python3 scripts/public_readiness_audit.py --fail-on-review`.
  - done in `.github/workflows/ci.yml`; CI runs the public readiness audit,
    Python compile checks, dashboard JavaScript syntax check, pytest, and
    default/empty/seeded/accessibility dashboard smokes.
  - done; CI now invokes `python scripts/public_publish_check.py
    --include-screenshots` directly, so export-manifest review, strict
    readiness, cloud-example audit, compile, dashboard JS syntax, pytest,
    default/seeded/empty/accessibility smokes, and seeded/empty screenshot
    layout gates share the same source of truth as the manual pre-publish gate.
- Do final manual review before pushing to GitHub.
  - partial; `docs/publication_readiness.md` now has a final manual review
    checklist with export, audit, test, dashboard smoke, screenshot, and
    manual-inspection steps for README, blog draft, example configs,
    no-edge examples, dashboard labels, and remaining limitations.
  - partial; `scripts/public_publish_check.py` now provides a consolidated
    public pre-publish gate for export-manifest JSON, strict public readiness,
    cloud examples, Python compile, dashboard JavaScript syntax, pytest,
    default/seeded/empty dashboard smokes, accessibility, and optional
    screenshot layout checks. Help, README, and publication-readiness docs
    point to it before the manual inspection step.
  - partial; Help Boundary now includes a Publish Readiness panel that explains
    the exported public candidate, consolidated publish gate, required manual
    review, private boundary, and direct links to publication, quickstart,
    privacy, and blog-draft docs before the command checklist.
  - partial; Help Boundary now also includes a Publication Review Assistant
    that turns the export boundary, automated gate, dashboard setup story,
    local example evidence, cloud boundary, and human review requirement into
    status cards, copyable review text, and direct boundary actions.
- Finish blog post polish.
  - partial; `docs/blog_public_ibkr_harness_draft.md` has been expanded into a
    public-safe draft covering local-first design, data fetches, manifests,
    Data Library, private plugin boundaries, replay/simulated-paper/paper
    modes, Workbench, remote monitoring, export/audit, limitations, and a
    pre-publish checklist. Final human editing for voice and publication venue
    remains open.
  - partial; the blog draft now matches the consolidated
    `scripts/public_publish_check.py` pre-publish gate instead of telling
    readers to run only the older audit/test commands manually. Final human
    editing for voice and publication venue remains open.
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
    hash-chained audit records for completed/rejected commands and poll
    failures. The status publisher now verifies that local audit hash chain,
    emits a warning on tampering/broken rows, and Operations shows local audit
    integrity beside remote-control freshness. Operations Home and its
    Command Audit workflow card now also factor local worker-audit integrity
    into first-screen audit health.
  - progress; local command-worker audit rows can now be HMAC-signed with
    `audit.signature_env`, and the status publisher verifies that signature via
    `remote_control.audit.signature_env`. Operations reports local signed,
    unsigned, missing-key, and bad-signature state separately from server-side
    command-audit signatures.
  - partial; receiver now rate-limits command queue requests per node and writes
    sanitized queue/cancel/result audit events to an append-only JSONL file with
    a bounded `/command_audit` endpoint. Explicit duplicate `command_id` values
    are rejected before queueing so result handling stays unambiguous. The
    Operations view now surfaces those sanitized command audit events directly
    in the dashboard
  - partial; server-side command scopes now classify queued actions as
    read-only, control, or launcher and reject commands outside
    `dashboard.command_scopes` before they are persisted. Remaining gaps:
    production validation of hosted deployment controls and provider retention
    sketches.
  - partial; hosted receivers can now configure multiple bearer-token roles
    with `dashboard.auth_tokens`, limiting command queue access per token while
    keeping dashboard/status reads authenticated. Remaining gaps:
    production validation of hosted deployment controls and provider retention
    sketches.
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
    verification errors. Remaining gap: validating off-host audit retention
    sketches in real provider accounts before treating them as hardened
    deployment recipes.
  - progress; Operations now includes an Export Audit CSV action backed by
    `/command_audit_export`, so bounded sanitized queue/cancel/result audit rows
    can be reviewed offline with the current hash-chain and signature status
    columns.
  - progress; `/command_audit` now returns an explicit retention policy that
    distinguishes local hash-chain evidence, HMAC-signed local rows, and
    unverified off-host immutable retention. Operations renders that retention
    status separately from hash/signature health, and audit CSV exports include
    retention status, summary, off-host verification state, and the dry-run
    sync helper path.
  - partial; Operations Control now includes a Command Safety Review that
    summarizes target-node state, read-only/control/launcher action classes,
    confirmation requirements, pending/failed command pressure, command-audit
    integrity, retention status, selected action boundary, and fail-closed
    high-risk live-control actions before the raw command form.
  - partial; public cloud examples now include
    `ops/cloud/sync-command-audit.example.sh` for dry-run-first upload of the
    server-side command audit JSONL to separate object storage. Actual
    immutability still depends on provider retention controls such as object
    lock/versioning and a separate storage identity.
  - partial; AWS-focused off-host audit retention now includes
    `ops/cloud/aws-s3-command-audit-retention.example.tf`, sketching a separate
    Object Lock bucket, versioning, TLS-only access, public-access blocking,
    narrow writer/reader principals, and governance-mode default retention for
    synced command-audit copies.
  - progress; GCP and Azure off-host audit retention now include
    `ops/cloud/gcp-gcs-command-audit-retention.example.tf` and
    `ops/cloud/azure-blob-command-audit-retention.example.tf`, sketching
    dedicated storage targets with public access prevention/private containers,
    versioning, and provider-native retention/immutability controls for
    command-audit copies.
- Keep initial commands low-risk:
  - pause
  - resume
  - flatten simulated positions
    - partial; `flatten_simulated_positions` is now queueable as a
      control-class command for configured plugin-runner configs that use the
      file-backed local broker. It submits offsetting simulated orders, records
      fills through the file broker orders log, reports before/after
      cash/positions, and refuses non-file broker adapters. Live flattening
      remains explicitly separate higher-risk work. The Operations command form
      now exposes this action through the `config_id` field, with action-boundary
      copy and a required local confirmation before queueing.
  - restart child process
    - partial; `restart_child_process` is now queueable as a launcher-class
      command, gated by the local enable marker, and only writes a configured
      supervisor-job `restart_marker`. Managed supervisor jobs consume that
      marker, terminate the owned child process, apply the existing restart
      cap/pause guard, and publish `operator_restart_marker` restart evidence.
      The Operations command form now exposes this action and its `job_id`
      parameter, with action-boundary copy and a required local confirmation
      before queueing launcher/control commands.
  - request fresh status
    - partial; `request_status` is queueable as a read-only command, the worker
      collects/posts a fresh sanitized status snapshot from configured local
      publisher settings, and Remote Nodes now has a Status action that prepares
      that command for a selected node without auto-queueing it.
- Keep higher-risk commands behind stronger local confirmations:
  - live flattening
  - changing strategy config
  - enabling live orders
  - progress; the public receiver and local worker now reserve
    `flatten_live_positions`, `change_strategy_config`, and
    `enable_live_orders` as explicit high-risk action names. They are rejected
    fail-closed even if added to server scopes or worker allowlists, and
    rejected queue attempts are classified as `high_risk` in command audit
    rows. Any future live-control support must be designed as a separate,
    stronger local-confirmation path instead of reusing the public example
    command surface.
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
  - partial; Runs Events now includes an Execution Quality Review that combines
    recent published orders/fills with loaded artifact orders/fills, reports
    missed/rejected/canceled/held order rate, order types, quote coverage,
    limit/cap coverage, fill price/timing coverage, and spread evidence. The
    public status/artifact sanitizers now preserve only explicit public-safe
    execution fields such as decision/submit bid/ask, limit/cap price,
    avg-fill/fill price, fill/submission timestamps, and spread bps while still
    excluding raw metadata and private strategy diagnostics. Runner/broker code
    still needs to publish complete quote/spread rows before the review can be
    considered fully covered.
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
