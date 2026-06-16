# Changelog

## Unreleased

- Three runnable, non-viable textbook example strategies — SMA crossover, RSI
  mean reversion, opening-range breakout — with example configs and a bundled
  synthetic session; each produces one clean simulated round trip. Illustrative
  only, no edge claimed.
- `docs/ibkr_account_setup.md`: why IBKR, IBKR Lite vs Pro, market-data
  subscriptions, crypto enablement, API/Gateway, and paper-account setup, with
  honest caveats (including the 2026-06-04 PDT-rule change).
- Reproducible README demo GIF builder (`scripts/build_dashboard_gif.py`);
  regenerated the demo GIF and static screenshots against the current UI.

## v0.1.0 — 2026-06-10

First public cut of the local-first IBKR trading harness.

- IBKR historical fetch tooling for stocks and Zero Hash crypto with
  resumable, dashboard-readable JSON job manifests.
- Strategy-plugin contracts (generic, stock signal, crypto signal) with a
  plugin loader, config validators, and deliberately no-edge examples.
- Generic plugin runner: replay, shadow, simulated-paper, and explicitly
  confirmed IBKR paper modes; execution caps, order-approval flow, pause/stop
  markers, sanitized run artifacts; validation instantiates the plugin and
  checks the runner protocol before any run.
- Market-calendar-aware plugin supervisor for scheduling runner jobs.
- Web dashboard: Overview, Performance (charts-first: equity sparkline,
  cumulative and per-trade PnL, period return bars), Data Library with
  full-universe filename indexing and per-root fair-share scan budgets,
  Fetch Jobs, Workbench (draft -> validate -> replay), Runs with an event
  density timeline, Operations, and Help; responsive at phone widths;
  self-explaining alert cards.
- Sanitized status publisher and token-authenticated receiver for hosted
  monitoring; pull-based remote command worker with hash-chained audit and
  hardcoded refusal of high-risk live actions; cloud deployment templates
  (Docker/compose, nginx/Caddy, Fly.io, Render, Terraform firewalls).
- One-command seeded demo: `python3 scripts/demo_dashboard.py`.
