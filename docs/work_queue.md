# Work Queue

This is the current prioritized queue. It is intentionally product-heavy:
trading research stays at the bottom until the public workbench is easier to
understand, operate, and trust.

## P0: Web UI product overhaul

Goal: make the dashboard feel like a modern trading app, closer to Robinhood's
clarity and visual rhythm, while keeping this project local-first and
strategy-private.

- Progress: initial app-shell navigation, Overview, Performance, Data Library,
  Operations, Workbench, Runs, and Help views are implemented. The next pass
  should improve chart depth, drilldowns, visual polish, and guided workflows.
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
- Build a clean Overview page for the current running strategy state:
  - mode badge: replay, shadow, simulated paper, paper, or live
  - gateway/API status
  - current equity, cash, open positions, unrealized PnL, realized PnL
  - today's return, week/month return, cumulative paper return
  - latest bar time, latest signal time, latest order/fill/rejection
  - next expected decision window
  - stale-data, stale-account, rejected-order, risk-limit, and gateway-login
    alerts
- Add a Strategy Performance page with charts and summaries:
  - equity curve
  - drawdown curve
  - daily return bars
  - calendar heatmap
  - open/closed trade table
  - win/loss, average win/loss, profit factor, max drawdown, exposure, turnover
  - benchmark overlay where appropriate
  - clear short-horizon projection caveats for per-day/month/year stats
- Add a Runs and Orders page:
  - searchable run history
  - session timeline of decisions, orders, fills, rejects, account snapshots
  - current open orders and current managed positions
  - drilldown for a run with artifacts, logs, and performance charts
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
  - "What am I looking at?" explanations for each major page
  - glossary: runner, draft, replay, shadow, simulated paper, paper, fill,
    reject, artifact, data root, stale bar
  - links to the relevant quickstart sections
  - empty states that explain what to do next instead of showing blank tables
- Improve visual design:
  - modern app-shell layout, restrained cards, clean spacing, readable tables
  - green/red performance language, neutral backgrounds, clear status badges
  - responsive mobile/tablet views
  - chart-first summaries instead of dense text-first tables
  - avoid nested cards and oversized marketing layout

## P0: Data Library and saved-data visibility

Goal: make all fetched historical data visible and inspectable. If only SPY and
QQQ show up, treat that as a bug until proven otherwise.

- Progress: Data Library now shows configured roots, catalog limits, visibility
  warnings, and suggested local roots such as an existing cache directory that
  contains data but is not currently configured.
- Audit all historical fetch outputs and data roots:
  - identify where stock 1m, stock 5m, crypto 1m, crypto 5m, and sample files
    are written
  - verify whether hundreds of fetched symbols exist on disk
  - verify whether dashboard data roots are only pointed at example data
  - verify whether parquet files, cache paths, or naming conventions are being
    skipped by the catalog scanner
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
- Add historical-data visualization:
  - line/candlestick chart for saved files
  - volume chart
  - selectable date range
  - gap markers
  - sampled and full-resolution modes
  - compare two or more symbols on the same time range
- Add data coverage diagnostics:
  - coverage heatmap by symbol/date
  - missing-day and missing-minute summaries
  - "why is this symbol not visible?" diagnostic
  - data-root scan errors in the UI
- Add saved fetch manifests:
  - every fetch run should write a manifest with symbols, bar size, duration,
    start/end, output files, success/failure counts, pacing pauses, and errors
  - manifests should be visible from the dashboard
  - failed/missing symbols should be resumable from a manifest

## P1: Fetch jobs and backend data reliability

- Add fetch-job screens:
  - active/completed jobs
  - progress by symbol and chunk
  - rolling ETA based on recent chunk time
  - success/failure/retry counts
  - pacing waits
  - current output path
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
  - CSV and parquet coverage
  - nested cache paths
  - crypto 24/7 files
  - malformed/skipped files with visible reasons

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
- Add clearer separation between public example configs and local private
  strategy configs.
- Add schema-driven form rendering after config schemas are reliable.
- Add saved draft folders/tags/status labels.
- Add safer empty states and validation messages.
- Add a "copy command" affordance for local CLI commands.

## P1: Operations and cloud monitoring

- Add real cloud endpoint support beyond the local mock receiver.
- Add read-only remote monitoring pages:
  - current strategy state
  - account/paper equity
  - positions
  - open orders
  - recent signals/fills/rejections
  - heartbeat and stale-data status
- Add alerts:
  - missed heartbeat
  - Gateway login required
  - API disconnected
  - stale bars
  - stale account snapshot
  - rejected orders
  - risk-limit trips
  - unexpected flat or positioned state
- Add historical run pages in the cloud view with bounded artifacts and logs.
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
framework work for now.

- Continue crypto candidate robustness checks only after monitoring and data
  visibility are improved.
- Continue stock paper observations and near-threshold diagnostics.
- Fetch and evaluate more 1m data when the data-library/fetch-job path can show
  what was fetched and what is missing.
- Add new strategy sleeves only when they are clearly orthogonal and have clean
  train/test or walk-forward validation.
- Revisit 1m lead-lag only with the pre-committed null and coverage gates.
