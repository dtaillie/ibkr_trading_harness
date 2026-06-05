# Cloud Monitoring Deployment

This guide describes a conservative public deployment shape for checking a
local trading machine from another device. Keep broker credentials, trading
authority, private strategy configs, and raw logs on the local machine.

## Recommended Shape

Use two components:

1. Local trading machine
   - runs Gateway/TWS
   - runs strategy/plugin runners
   - publishes sanitized status with `scripts/publish_status.py`
   - optionally polls allowlisted low-risk commands with
     `scripts/command_worker.py`
2. Monitoring endpoint
   - receives sanitized status posts
   - serves the dashboard
   - stores no broker credentials
   - has no direct broker API access

The included `scripts/cloud_status_server.py` can act as a local mock receiver
or a small private monitoring endpoint. Treat it as a prototype, not a hardened
internet service.

## Start Locally

Run the receiver/dashboard:

```bash
export TRADING_STATUS_TOKEN='replace-me'
python3 scripts/cloud_status_server.py \
  --config config/cloud_status.example.yaml \
  --auth-token-env TRADING_STATUS_TOKEN
```

Publish status to it:

```bash
python3 scripts/publish_status.py \
  --config config/cloud_status.example.yaml \
  --endpoint http://127.0.0.1:8765/status \
  --token-env TRADING_STATUS_TOKEN
```

Open `http://127.0.0.1:8765/`.

## Private Remote Access Options

Prefer private networking before exposing the dashboard publicly:

- Tailscale, WireGuard, or another private VPN.
- SSH port forwarding from your laptop to the trading machine.
- A private reverse proxy with authentication in front of the dashboard.

Example SSH tunnel:

```bash
ssh -L 8765:127.0.0.1:8765 user@trading-machine
```

Then open `http://127.0.0.1:8765/` on the laptop.

## Hosted Endpoint Option

If you use a small VPS or cloud app as the receiver:

1. Run only the status receiver/dashboard in the cloud.
2. Set a strong bearer token in the cloud environment.
3. Point the local publisher at `https://your-status-host/status`.
4. Keep command polling disabled until authentication, audit logging, rate
   limits, and local safety gates are reviewed.
5. Do not mount local trading directories or credentials into the cloud host.

Minimum checks before exposing it:

- HTTPS only.
- Bearer-token auth enabled.
- Firewall restricts source IPs if practical.
- No broker credentials or private configs on the host.
- Logs do not include account IDs, raw strategy signals, or order secrets.
- Dashboard docs endpoint only serves allowlisted Markdown files.

## Remote Commands

The public command path is intentionally narrow. Supported examples are
low-risk local actions such as request status, summarize a run, validate a
config, run a configured supervisor once, pause, and resume.

Do not add broker actions such as live flattening, order submission, changing
strategy config, or enabling live mode without stronger local confirmations and
immutable audit logs.

The local worker is the authority boundary. Keep `audit.enabled=true`, set a
small `worker.max_commands_per_poll`, and require a local enable marker for
launcher actions such as `run_supervisor_once`. With the example config, the
worker rejects launcher commands until
`paper_logs/control/remote_commands.enabled` exists on the trading machine.

Run the worker once:

```bash
export TRADING_STATUS_TOKEN='replace-me'
python3 scripts/command_worker.py \
  --config config/remote_control.example.yaml \
  --token-env TRADING_STATUS_TOKEN \
  --once
```

## Service Sketch

A deployment usually needs separate services:

- Gateway/TWS or IBC service on the local machine.
- Strategy runner or supervisor on the local machine.
- Status publisher on the local machine.
- Optional command worker on the local machine.
- Status receiver/dashboard locally, over VPN, or in a small cloud host.

Keep service files local and environment-specific. Commit only examples.

## Failure Modes

- Stale heartbeat: publisher stopped, network is down, or the runner stopped.
- Gateway unreachable: Gateway/TWS closed, login expired, API disabled, or port
  changed.
- Dashboard reachable but no data: publisher token/endpoint mismatch or
  receiver storage was reset.
- Commands stuck pending: worker is not running, token mismatch, node ID
  mismatch, or action is not allowlisted.
- Missing artifacts: dashboard data roots or run-output paths are not
  configured for the receiver.

## Public/Private Boundary

Safe to publish:

- framework code
- example configs
- no-edge strategy examples
- sanitized docs and tests

Keep private:

- strategy plugins with real edge
- tuned params and universes
- broker credentials and account IDs
- paper/live configs
- raw runtime logs
- research outputs
