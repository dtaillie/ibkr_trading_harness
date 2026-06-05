# Public Framework Roadmap

Future usability and productization work for a public version of this project.
The goal is to publish the reusable trading harness while keeping proprietary
strategies private.

For the current prioritized implementation queue, see `docs/work_queue.md`.
This roadmap is broader context; the queue is the current execution order.

## Public/private split

- Define a public repo boundary that includes data adapters, broker adapters,
  paper/live runners, service wrappers, metrics, and example strategies.
- Keep private strategies, tuned universes, account config, credentials, and
  sensitive logs out of the public repo.
- Add a sanitization script that checks for account IDs, client IDs, local paths,
  tokens, strategy names, and broker-specific private config before copying files.
- Provide public example configs with dummy symbols, dummy accounts, and explicit
  placeholders for secrets.
- Keep example strategies intentionally non-viable. They should demonstrate
  interfaces and execution flow, not encode current private strategy logic or
  tuned parameters.
- Add CI checks that fail on private config patterns and accidental large data
  files.

## Strategy plugin interface

- Maintain the small strategy interface for market data inputs, state, target
  generation, order intents, rejection handling, and end-of-session cleanup.
- Keep private strategies in plugin modules referenced by ignored private
  config; public examples should use the no-edge template plugin.
- Support strategy-local config schemas so each strategy can validate its own
  parameters before a live or paper run starts.
- Add an example strategy package that demonstrates the interface without
  exposing private logic.
- Add a strategy registry so runners can load strategies by name from config.
- Document the lifecycle clearly: warmup, signal evaluation, order planning,
  execution feedback, position updates, and shutdown.

## Generic runner

- Extend `live/plugin_runner.py` from basic shadow/paper continuous loops into
  richer market-hours/session-aware loops where needed.
- Extend config validation into versioned schemas with richer per-plugin checks.
- Add optional order previews and manual approval hooks for paper/live mode.
- Add richer simulated-paper accounting: realized PnL, average cost, borrow
  constraints, commission schedules, and slippage models. The public runner now
  covers basic shortable/cap checks, side-specific slippage, simple market
  impact, and commission floors/caps; richer borrow-fee schedules remain future
  work.
- Add broker-agnostic execution adapters so private configs can choose IBKR,
  file-based simulation, or future broker integrations without changing
  strategy plugins.

## Data and broker harness

- Keep broker/data code reusable across IBKR, Schwab, Polygon, file-based data,
  and simulated feeds.
- Standardize historical-bar storage paths, symbol naming, timestamp timezones,
  and adjustment metadata.
- Keep data-catalog quality scoring visible before simulation: timestamp
  parseability, missing close data, duplicate timestamps, gaps, and volume
  availability should be summarized before a dataset is selected.
- Add fetch-job manifests with status, ETA, failure counts, retry counts, and
  resumability.
- Add consistent paper/live mode gates so a strategy cannot accidentally submit
  live orders when configured for paper or shadow mode. The generic paper
  runner now refuses known live IBKR ports without dual opt-in; broker-native
  account verification remains future work.
- Add replay mode that can run a live strategy against stored historical bars for
  deterministic debugging.
- Keep run summaries time-aware: account telemetry should report elapsed
  observation time, total return, drawdown, and clearly labeled per-day,
  per-month, and per-year geometric projections with short-horizon caveats.

## Local operations

- Provide install scripts for user-level systemd services and timers.
- Maintain the current generic local supervisor for public plugin-runner jobs,
  and extend it from interval scheduling into richer market-hours loops where
  needed.
- Add health checks for gateway connectivity, API connectivity, market-data
  permissions, stale bars, stale account snapshots, and stuck child processes.
- Add local status commands that show active strategies, current positions,
  recent signals, recent orders, last bar time, and service logs.
- Document safe startup, shutdown, restart, and recovery procedures.

## Cloud monitoring

- Maintain the current read-only telemetry publisher and local mock receiver as
  the public prototype surface.
- Publish read-only run telemetry to a cloud endpoint: account equity, simulated
  equity, positions, open orders, signals, fills, errors, and heartbeat status.
- Keep broker credentials and trading authority only on the trading machine.
- Add a small web dashboard for remote monitoring from a phone or laptop.
- Support historical run pages with session artifacts, time-normalized return
  projections, daily summaries, drawdown, win/loss stats, and recent logs.
- Maintain a recent status-history endpoint and dashboard view so latest-state
  monitoring can be correlated with short-term heartbeat and recovery history.
- Expose bounded run event summaries for operator context while keeping raw
  strategy signal payloads private unless a local config explicitly publishes
  them.
- Add alerting for missed heartbeats, gateway login required, rejected orders,
  stale data, unexpected flat/positioned state, and risk-limit trips.

## Remote control

- Keep broker credentials and trading authority on the local machine.
- Maintain the current command queue/local worker prototype as the public
  remote-control surface.
- Add remote commands only after authentication, authorization, audit logging,
  rate limits, and explicit local safety gates exist.
- Initial remote commands should be low-risk: pause strategy, resume strategy,
  flatten simulated positions, restart a child process, and request a fresh
  status snapshot.
- Keep queued-command management low-risk: validate action-specific parameters
  before queueing and allow canceling commands only while they are still pending
  on the server.
- Higher-risk commands such as live flattening, changing strategy config, or
  enabling live orders need stronger controls and explicit confirmation.
- Every remote command should write an immutable audit record locally and in the
  cloud.

## UI

- Maintain the current operational dashboard in `web/dashboard/`.
- Treat the web dashboard as the canonical UI for now; defer any standalone
  launchable UI until it provides capabilities beyond duplicating the web
  interface.
- Keep expanding the web dashboard into a public workbench: usage guidance,
  saved-data inspection, replay/simulation setup, and monitoring should live in
  one browser surface.
- Keep saved-data inspection bounded and local-first: summaries, sampled price
  paths, gap rows, and quality stats should be exposed without uploading full
  bar files through the cloud prototype.
- Keep data selection usable for larger roots: filter saved datasets by search
  text, quality status, and bar size before choosing files for a replay draft.
- Keep the public config builder and saved-draft runner limited to public
  generic examples, configured local data roots, bounded subprocess execution,
  one-or-more selected datasets, duplicate input guards, and non-live modes
  until stronger schema, authorization, and execution controls are in place.
- Keep multi-dataset drafts alignment-aware: show common timestamps, overlap
  coverage, common range, cadence warnings, and per-symbol timestamp counts
  before the operator saves or runs a draft.
- Keep saved draft inspection public-safe: show YAML and command snippets only
  for drafts that still validate as public workbench examples, and show errors
  without exposing YAML for invalid or manually altered drafts.
- Keep saved-run artifact inspection summarized by default. Public dashboard
  views should show execution context, orders, fills, account snapshots, equity,
  elapsed time, total return, time-normalized return projections, exposure,
  position counts, drawdown, and high-level decision counts without exposing raw
  private signal payloads.
- Keep recent-run comparison summarized and artifact-safe: compare returns,
  drawdown, exposure, fills, rejections, elapsed windows, and projection caveats
  without uploading raw strategy diagnostics or reusing stale summaries from
  failed executions.
- Keep successful workbench run artifacts inspectable by exact run id through
  local archived snapshots, so later draft reruns do not erase the operator's
  ability to inspect a prior comparison row.
- Keep exact-run log detail available for diagnosis: command argv, return code,
  duration, stdout tail, and stderr tail should be inspectable without exposing
  raw strategy diagnostics.
- Keep workbench maintenance local and explicit: orphaned run archives and
  workbench output directories should be previewed first, then pruned only after
  confirmation and only inside the known workbench roots.
- First views should show current mode, gateway status, API status, strategy
  heartbeats, positions, signal state, recent orders, risk limits, and PnL.
- Add strategy drilldowns with charts for entry/exit points, signal values,
  expected hold windows, MAE/MFE, and current stop/exit state.
- Add fetch-job screens for progress, ETA, failures, retries, and richer data
  coverage.
- Add config editors only after schemas and validation are reliable.

## Documentation

- Write a public quickstart for historical fetches, replay runs, shadow runs,
  paper runs, and live-mode safeguards.
- Include architecture docs for adapters, strategies, execution, services, and
  telemetry.
- Include operational runbooks for IBKR Gateway, paper trading, data permission
  issues, service restarts, and failed order diagnosis.
- Keep private strategy research and parameter notes in private docs only.
