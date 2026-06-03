# Public Quickstart

This guide shows how to use the public framework without exposing or relying on
private strategy logic.

## 1. Start IBKR Gateway

Start IBKR Gateway or TWS manually first. For paper Gateway, the API port is
usually `4002`.

Do not put live credentials in this repo. If you use IBC, keep its config
outside git and protect it with local file permissions.

## 2. Fetch Historical Stock Data

```bash
python3 live/fetch_history.py \
  --host 127.0.0.1 \
  --port 4002 \
  --client-id 99 \
  --symbols SPY,QQQ \
  --bar-size 5min \
  --duration "1 D" \
  --rth
```

This is data-only. It does not submit orders.

## 3. Fetch Historical Crypto Data

```bash
python3 live/fetch_crypto_history.py \
  --host 127.0.0.1 \
  --port 4002 \
  --client-id 199 \
  --symbols BTC-USD,ETH-USD \
  --exchange ZEROHASH \
  --bar-size 1min \
  --months 1
```

Crypto data availability depends on IBKR permissions and venue support.

## 4. Write a Strategy Plugin

Use the examples as templates:

- `examples/strategies/no_edge_template.py`
- `examples/strategies/no_edge_crypto_signal.py`
- `examples/strategies/no_edge_stock_signal.py`

Public examples intentionally emit no tradable edge.

## 5. Keep Real Config Private

Copy an example config to a local ignored config:

```bash
cp config/plugin_runner.example.yaml config/plugin_runner.yaml
cp config/crypto_paper.example.yaml config/crypto_paper.yaml
cp config/stock_paper.example.yaml config/stock_paper.yaml
```

Then point the config at your private plugin. Do not commit the copied files.

## 6. Run the Generic Plugin Runner

The public runner accepts a plugin spec and supports replay, shadow,
simulated-paper, and explicitly confirmed IBKR paper modes.

Replay the public no-edge example:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --validate-only

python3 live/plugin_runner.py \
  --config config/plugin_runner.example.yaml \
  --mode replay \
  --max-steps 3

python3 scripts/summarize_plugin_run.py paper_logs/example_plugin_runner
```

Run simulated-paper fills with your own private plugin:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.yaml \
  --mode simulated-paper
```

IBKR paper mode submits orders and therefore requires an explicit confirmation:

```bash
python3 live/plugin_runner.py \
  --config config/plugin_runner.yaml \
  --mode paper \
  --confirm-paper-orders
```

The current private stock and crypto runners are still excluded from the public
repo because they encode strategy-specific assumptions. The generic runner is
the public execution path.

Runner safety checks are configured under `execution`. The generic runner can
reject intents before execution based on allowed symbols, sides, order types,
current price availability, max orders per run, max quantity, max cash quantity,
max notional per order, short-sale permission, and gross-exposure limits.
`--validate-only` checks the static parts of this config before a run starts.
After a run, `scripts/summarize_plugin_run.py <run-dir>` prints decisions,
orders, fills, rejection reasons, final cash/equity, and positions from the
generic JSONL artifacts.

## 7. Generic Local Supervisor

The public supervisor runs configured local plugin-runner jobs on simple
interval schedules and writes a status file that the cloud/status publisher can
read.

Validate and run the example once:

```bash
python3 scripts/plugin_supervisor.py \
  --config config/plugin_supervisor.example.yaml \
  --validate-only

python3 scripts/plugin_supervisor.py \
  --config config/plugin_supervisor.example.yaml \
  --once
```

For a real local setup, copy `config/plugin_supervisor.example.yaml` to an
ignored local config and point each job at private strategy configs. Job
commands are argv lists, not shell strings. Use `process_mode: blocking` for
short replay/fetch jobs and `process_mode: managed` for long-running paper or
shadow processes that should be monitored without blocking other jobs. A
job-level `pause_marker` lets the safe command worker pause scheduled launches.

## 8. Cloud Checking Prototype

Publish read-only local telemetry to a file:

```bash
python3 scripts/publish_status.py \
  --config config/cloud_status.example.yaml \
  --json
```

Run the local mock receiver/dashboard:

```bash
export TRADING_STATUS_TOKEN='replace-me'
python3 scripts/cloud_status_server.py \
  --host 127.0.0.1 \
  --port 8765 \
  --auth-token-env TRADING_STATUS_TOKEN
```

Then publish to it from another terminal:

```bash
python3 scripts/publish_status.py \
  --config config/cloud_status.example.yaml \
  --endpoint http://127.0.0.1:8765/status \
  --token-env TRADING_STATUS_TOKEN
```

Open `http://127.0.0.1:8765/` to view the dashboard. It shows node health,
Gateway reachability, runs, supervisors, remote-control audit health, alerts,
queued commands, and command results.
For real deployments, add `max_age_seconds` to configured runs, supervisors, or
remote-control audit settings in `config/cloud_status.example.yaml` copies so
stale local artifacts raise dashboard alerts.
The receiver appends each posted status to `status_history.jsonl` and exposes a
summarized recent-history endpoint:

```bash
curl 'http://127.0.0.1:8765/status_history?node_id=example-local-trader&limit=20'
```

The dashboard uses the same endpoint for its Recent Status table.

Run configs can also opt into safe recent event summaries:

```yaml
runs:
  - id: example_plugin_runner
    path: paper_logs/example_plugin_runner
    recent_events:
      enabled: true
      max_rows: 5
```

This publishes bounded decision/order/fill summaries for the dashboard's
Recent Run Events table. It intentionally omits raw strategy `signal` and
`diagnostics` payloads, which may contain private strategy details.

## 9. Safe Remote Command Prototype

The command prototype keeps authority on the local machine. The server stores
commands, and the local worker polls and enforces an allowlist. It does not
support arbitrary shell commands or broker order actions.

Queue a local test command:

```bash
curl -X POST http://127.0.0.1:8765/commands \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TRADING_STATUS_TOKEN" \
  -d '{"node_id":"example-local-trader","action":"summarize_run","params":{"run_id":"example_plugin_runner"}}'
```

Queue a local supervisor run from a configured supervisor ID:

```bash
curl -X POST http://127.0.0.1:8765/commands \
  -H 'Content-Type: application/json' \
  -H "Authorization: Bearer $TRADING_STATUS_TOKEN" \
  -d '{"node_id":"example-local-trader","action":"run_supervisor_once","params":{"supervisor_id":"example_plugin_supervisor"}}'
```

Poll once from the local machine:

```bash
python3 scripts/command_worker.py \
  --config config/remote_control.example.yaml \
  --token-env TRADING_STATUS_TOKEN \
  --once
```

By default the worker writes local audit records to
`paper_logs/remote_control/audit.jsonl`. Keep that enabled for real
deployments; it preserves local command history even if posting results to the
cloud endpoint fails. `scripts/publish_status.py` summarizes that audit file so
poll failures, command failures, and result-post failures are visible in the
dashboard.

Supported example actions are `request_status`, `supervisor_status`,
`summarize_run`, `validate_config`, `validate_supervisor_config`,
`run_supervisor_once`, `pause_runner`, and `resume_runner`. `run_supervisor_once`
can launch configured local jobs and is only enabled when present in
`allowed_actions`; remove it for monitoring-only deployments. Pause/resume
writes or removes a local marker file. The generic plugin runner honors
`control.pause_marker` by recording paused decisions without evaluating the
strategy or submitting orders.
The dashboard and server validate action-specific parameters before queueing:
`summarize_run` needs `run_id`, `validate_config` needs `config_id`, and
supervisor actions need `supervisor_id`. Pending commands can be canceled from
the dashboard or by posting to `/commands/cancel`; canceling only applies before
the local worker has polled the command.
Set `server.token_env` in `config/remote_control.example.yaml` and
`publish.token_env` in `config/cloud_status.example.yaml` when using the
authenticated server. Store the token value only in the environment.

## 10. Paper/Live Safety

Start with dry-run or simulated fills. Paper trading still needs risk limits,
position checks, stale-data checks, order rejection handling, and a plan for
Gateway login/2FA interruptions.

Before publishing or sharing your repo, run:

```bash
python3 scripts/public_readiness_audit.py
```
