# Changelog

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
