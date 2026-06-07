# Service Restart Runbook

This runbook covers local service restarts for the public harness. It assumes
user-level systemd services.

## Identify Running Services

```bash
systemctl --user list-units 'ibgateway*' 'algo-trade*' --all
```

Common public service names:

- `ibgateway-paper.service`
- `algo-trade-plugin-supervisor.service`
- `algo-trade-status-publisher.service`
- `algo-trade-command-worker.service`

Private installs may use different names.

## Restart Gateway

Stop paper/shadow runners first so they do not reconnect during Gateway
restart:

```bash
systemctl --user stop algo-trade-plugin-supervisor.service
systemctl --user restart ibgateway-paper.service
systemctl --user status ibgateway-paper.service --no-pager
```

Complete any local login or approval dialog. Then restart the runner or
supervisor:

```bash
systemctl --user start algo-trade-plugin-supervisor.service
systemctl --user status algo-trade-plugin-supervisor.service --no-pager
```

## Restart Dashboard

If the dashboard was started manually, stop it with `Ctrl-C` and relaunch:

```bash
python3 scripts/cloud_status_server.py --config config/cloud_status.example.yaml
```

If you wrap it as a service, restart that service instead.

## Restart Public Harness Services

Use the smallest restart that matches the problem. Restarting everything is
slower and can hide the service that actually failed.

| Symptom | Restart | Notes |
| --- | --- | --- |
| Gateway/API unreachable or login dialog needed | `ibgateway-paper.service` | Stop runners first, complete local login, then start runners again. |
| Runner heartbeat stale but Gateway is healthy | `algo-trade-plugin-supervisor.service` | Supervisor config should validate before the service starts. |
| Cloud view is stale but local runner is healthy | `algo-trade-status-publisher.service` or timer | Check the publisher logs and remote endpoint token/network. |
| Remote controls are not being picked up | `algo-trade-command-worker.service` | Check command scopes and audit logs before queueing more commands. |
| Hosted receiver is down | Hosted receiver service/container | Keep broker credentials and trading authority off the hosted machine. |

Common local commands:

```bash
systemctl --user restart algo-trade-plugin-supervisor.service
systemctl --user restart algo-trade-status-publisher.service
systemctl --user restart algo-trade-command-worker.service
systemctl --user status algo-trade-plugin-supervisor.service --no-pager
systemctl --user status algo-trade-status-publisher.service --no-pager
systemctl --user status algo-trade-command-worker.service --no-pager
```

If the status publisher is timer-driven, inspect both the service and timer:

```bash
systemctl --user status algo-trade-status-publisher.timer --no-pager
systemctl --user list-timers 'algo-trade*' --all
```

## Restart Generic Plugin Supervisor

The public plugin supervisor is the preferred wrapper for long-running generic
plugin configs. It validates the ignored local supervisor config before start
and can restart managed plugin-runner children according to the config's
restart policy.

```bash
python3 scripts/plugin_supervisor.py --config config/plugin_supervisor.example.yaml --validate-only
systemctl --user restart algo-trade-plugin-supervisor.service
journalctl --user -u algo-trade-plugin-supervisor.service -n 100 --no-pager
```

Before forcing another restart, check whether a pause or stop marker is present
in the managed job config. A marker may mean the supervisor is correctly
holding the process down.

## Restart Hosted Receiver

The hosted receiver is read-only/status-oriented by default. It should not hold
broker credentials, strategy-private configs, or trading authority.

For the public Docker Compose example:

```bash
docker compose -f ops/cloud/status-receiver.compose.example.yaml ps
docker compose -f ops/cloud/status-receiver.compose.example.yaml restart status-receiver
docker compose -f ops/cloud/status-receiver.compose.example.yaml logs -n 100 status-receiver
```

For Fly.io deployments based on `ops/cloud/fly-status-receiver.example.toml`:

```bash
fly status
fly machine list
fly deploy -c ops/cloud/fly-status-receiver.example.toml
fly logs
```

For Render deployments based on
`ops/cloud/render-status-receiver.example.yaml`, use the Render dashboard to
restart or redeploy the service, then inspect recent service logs and confirm
the dashboard `/health` endpoint responds.

For a manually hosted Python receiver:

```bash
python3 scripts/cloud_status_server.py --config config/cloud_status_hosted.example.yaml
```

## Reload Reverse Proxies And Firewalls

When the receiver is behind nginx or Caddy, reload the proxy after config
changes rather than restarting the Python receiver first:

```bash
sudo nginx -t
sudo systemctl reload nginx
sudo systemctl status nginx --no-pager
```

```bash
caddy validate --config ops/cloud/caddy-status-receiver.example.Caddyfile
sudo systemctl reload caddy
sudo systemctl status caddy --no-pager
```

For host firewall changes, run the public UFW helper in dry-run mode first:

```bash
DRY_RUN=1 bash ops/cloud/ufw-status-receiver.example.sh
```

## Inspect Logs

```bash
journalctl --user -u ibgateway-paper.service -n 100 --no-pager
journalctl --user -u algo-trade-plugin-supervisor.service -n 100 --no-pager
journalctl --user -u algo-trade-status-publisher.service -n 100 --no-pager
journalctl --user -u algo-trade-command-worker.service -n 100 --no-pager
```

Runner-specific logs usually live under `paper_logs/`. The dashboard Runs and
Operations pages expose public-safe summaries when configured.

## Avoid Duplicate Runners

Before starting a new paper process, check for existing Python runners:

```bash
pgrep -af 'live/plugin_runner.py|scripts/plugin_supervisor.py'
```

Duplicate paper runners can submit duplicate orders or consume the same client
ID. Stop old processes or services before starting replacements.

## After Restart

- Gateway API port is reachable.
- Dashboard Overview shows fresh status.
- Operations shows the expected supervisor state.
- Runs page shows only the intended active run.
- No queued remote command is unexpectedly pending.
- Remote Nodes shows fresh heartbeat if the status publisher is enabled.
- Command Audit Health is intact before using remote controls.
