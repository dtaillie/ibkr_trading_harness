# Paper Trading Runbook

This runbook describes the public generic paper workflow. It intentionally
avoids private strategy details.

## Modes

- `replay`: reads saved bars and writes decisions, no orders.
- `shadow`: observes decisions without submitting orders.
- `simulated-paper`: uses local simulated fills and account state.
- `paper`: submits orders to a broker paper account and requires
  `--confirm-paper-orders`.

Use replay or simulated-paper before broker paper. Use broker paper only after
Gateway/API and market-data checks pass.

## Start Safely

Validate the config first:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --validate-only
```

Run a short replay:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --mode replay \
  --max-steps 3
```

Run simulated-paper:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --mode simulated-paper
```

Broker paper mode requires explicit confirmation:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.yaml \
  --mode paper \
  --confirm-paper-orders
```

Use an ignored local config such as `config/plugin_runner.yaml` for any real
strategy plugin or broker settings.

## Start With Supervisor

The public supervisor can run one or more local jobs from a config:

```bash
python3 scripts/plugin_supervisor.py \
  --config config/plugin_supervisor.example.yaml \
  --validate-only

python3 scripts/plugin_supervisor.py \
  --config config/plugin_supervisor.example.yaml \
  --once
```

Use `process_mode: managed` for long-running shadow or paper jobs and
`process_mode: blocking` for short replay or fetch jobs.

## Monitor

Open the dashboard:

```bash
python3 scripts/cloud_status_server.py --config config/cloud_status.example.yaml
```

Use these pages:

- Overview: current mode, health, recent events, open positions.
- Performance: equity, drawdown, return, exposure, trades.
- Runs: decisions, orders, fills, rejects, account snapshots, logs.
- Operations: Gateway health, supervisor status, commands, cleanup.

Summarize a run directory:

```bash
python3 scripts/summarize_plugin_run.py paper_logs/example_plugin_runner
```

## Shutdown

Stop the runner or supervisor first, then Gateway:

```bash
systemctl --user stop algo-trade-paper-supervisor.service
systemctl --user stop ibgateway-paper.service
```

If running manually, stop the Python process with `Ctrl-C` and confirm it wrote
its final summary/artifacts.

## Preflight Before Broker Paper

- Gateway is logged in and API port is reachable.
- Account is paper, not live.
- Config is ignored locally and points at the intended plugin.
- `--validate-only` passes.
- Risk limits are small and explicit.
- Allowed symbols, sides, order types, cash/notional, and exposure caps are set.
- Dashboard shows fresh telemetry.
- You know how to stop the runner quickly.

