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
- `dashboard.network_access` restricts direct receiver clients to private VPN,
  proxy, or known management networks.
- No broker credentials or private configs on the host.
- Logs do not include account IDs, raw strategy signals, or order secrets.
- Dashboard docs endpoint only serves allowlisted Markdown files.

### Hosted Receiver Example

The public repo includes a provider-neutral Docker Compose example for a small
receiver host:

```bash
export TRADING_STATUS_TOKEN='replace-with-a-long-random-value'
docker compose -f ops/cloud/status-receiver.compose.example.yaml up -d
```

The compose file starts `scripts/cloud_status_server.py` with
`config/cloud_status_hosted.example.yaml`, binds the receiver to
`127.0.0.1:8765` on the host, and stores only receiver state in a named Docker
volume. Put a private VPN or HTTPS reverse proxy in front of it before using it
away from localhost.

`ops/cloud/nginx-status-receiver.example.conf` is a minimal reverse-proxy
template. Replace the example domain and certificate paths, then add your
normal firewall or source-IP controls. The nginx file is intentionally only a
template; certificate issuance and host hardening are provider-specific.

`ops/cloud/caddy-status-receiver.example.Caddyfile` is the same reverse-proxy
shape for Caddy. It is useful on a small VPS when you want Caddy to manage
certificates automatically.

`ops/cloud/ufw-status-receiver.example.sh` is a host-firewall sketch for
Ubuntu/Debian-style VPS hosts. It defaults to a dry run and requires explicit
`SSH_CIDR`, `PUBLISHER_CIDR`, and `APPLY=1` before changing firewall rules.
It keeps the Python receiver port closed to the network and allows only HTTPS
from configured publisher/dashboard CIDRs.

`ops/cloud/aws-security-group-status-receiver.example.tf` is an AWS-style
network boundary example. It allows SSH from management CIDRs, HTTPS from the
publisher/dashboard CIDRs, and no public access to the receiver's app port.

Good low-cost provider shapes:

- VPS: install Docker, run the compose file, put nginx or Caddy in front.
- AWS EC2: attach a security group equivalent to the Terraform example, bind
  the receiver to localhost, and expose only the HTTPS reverse proxy.
- Fly.io/Render/Railway-style app: run the same Python command, set
  `TRADING_STATUS_TOKEN`, and attach persistent storage for
  `paper_logs/cloud_status_server`.
- Home machine over VPN: skip the hosted receiver and expose the local
  dashboard only over Tailscale/WireGuard.

Avoid cloud deployment shapes that mount the trading machine's broker config,
raw `paper_logs`, private strategy plugins, or data cache into the hosted app.

The Operations page can export the Remote Nodes table as CSV. Use that export
for offline review of sanitized heartbeat, Gateway, mode, equity, position,
open-order, activity, account/data freshness, and alert summaries across
published nodes.

### Local Publisher Service Example

On the trading machine, keep publishing local sanitized status to the hosted
endpoint. The example user-systemd timer runs once per minute:

```bash
mkdir -p ~/.config/algo-trade
cp config/cloud_status.example.yaml ~/.config/algo-trade/cloud_status.yaml
# Edit the copied config to add private run paths, data roots, and Gateway checks.

cat > ~/.config/algo-trade/status-publisher.env <<'EOF'
TRADING_STATUS_ENDPOINT=https://status.example.invalid/status
TRADING_STATUS_TOKEN=replace-with-the-same-long-random-value
EOF
chmod 600 ~/.config/algo-trade/status-publisher.env

systemctl --user link "$PWD/ops/systemd/algo-trade-status-publisher.service"
systemctl --user link "$PWD/ops/systemd/algo-trade-status-publisher.timer"
systemctl --user enable --now algo-trade-status-publisher.timer
```

The user-systemd unit reads `~/.config/algo-trade/cloud_status.yaml`, not the
committed example config, so private run paths and local data roots stay outside
git.

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
The receiver also records sanitized queue/cancel/result events in
`paper_logs/cloud_status_server/command_audit.jsonl`, exposes them through
`/command_audit`, offers a CSV download through `/command_audit_export`, and
rate-limits command queue requests per node with `dashboard.command_rate_limit`.
It also applies `dashboard.command_scopes` before a command is queued. Public
examples allow `read_only` and `control` classes by default; `launcher`
commands such as `run_supervisor_once` require an explicit server-side opt-in
through `allowed_action_classes` or `allowed_actions`.

For hosted receivers, prefer separate tokens:

```yaml
dashboard:
  auth_tokens:
    - token_env: TRADING_STATUS_READ_TOKEN
      role: monitor
      allowed_action_classes: [read_only]
    - token_env: TRADING_STATUS_CONTROL_TOKEN
      role: operator
      allowed_action_classes: [read_only, control]
```

Both tokens can read dashboard/status endpoints. Only the operator token can
queue pause/resume control commands, and launcher commands still need explicit
server and local opt-in.

Use `dashboard.network_access` as an extra local guard:

```yaml
dashboard:
  network_access:
    enabled: true
    allowed_client_networks:
      - 127.0.0.1/32
      - ::1/128
      - 100.64.0.0/10   # example Tailscale CGNAT range
    trust_x_forwarded_for: false
```

Only set `trust_x_forwarded_for: true` when a trusted reverse proxy overwrites
that header and direct access to the Python receiver is blocked by firewall or
private networking.

The server-side command audit is hash-chained. Each appended audit row includes
`prev_hash` and `record_hash`, and `/command_audit` returns an `integrity`
summary with `ok`, `warn`, `bad`, or `empty` status. Hosted receivers can also
set `dashboard.command_audit_signature_env` to the name of an environment
variable containing an HMAC secret. New command audit rows then include
`row_signature`, and `/command_audit` reports whether signatures are disabled,
valid, unsigned, missing a key, or failing verification. Keep the signing secret
outside the repo and rotate it like any other service secret.
Use the Operations Export Audit CSV action when you need the bounded sanitized
audit rows and the current integrity/signature summary in one offline file.

This is tamper-evident for local file edits after the fact. It is still not a
substitute for off-host immutable storage or provider-level retention controls;
ship or back up the audit file to storage whose write permissions are separate
from the receiver host if the service is internet-facing.

Run the worker once:

```bash
export TRADING_STATUS_TOKEN='replace-me'
python3 scripts/command_worker.py \
  --config config/remote_control.example.yaml \
  --token-env TRADING_STATUS_TOKEN \
  --once
```

For a long-running local worker, use the example service only after reviewing
`config/remote_control.example.yaml` and leaving `audit.enabled=true`:

```bash
mkdir -p ~/.config/algo-trade
cp config/remote_control.example.yaml ~/.config/algo-trade/remote_control.yaml
# Edit server.commands_url and server.results_url to point at your receiver.
# Remove run_supervisor_once from allowed_actions for monitoring-only setups.

cat > ~/.config/algo-trade/command-worker.env <<'EOF'
TRADING_STATUS_TOKEN=replace-with-the-same-long-random-value
EOF
chmod 600 ~/.config/algo-trade/command-worker.env

systemctl --user link "$PWD/ops/systemd/algo-trade-command-worker.service"
systemctl --user enable --now algo-trade-command-worker.service
```

For monitoring-only deployments, remove `run_supervisor_once` from
`allowed_actions`, leave `launcher` out of `dashboard.command_scopes`, and keep
the local enable marker absent.

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
- Receiver reachable directly on port 8765: firewall/proxy boundary is wrong;
  close the app port and expose only HTTPS through the reverse proxy or VPN.

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
