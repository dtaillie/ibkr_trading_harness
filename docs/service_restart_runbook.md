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

## Inspect Logs

```bash
journalctl --user -u ibgateway-paper.service -n 100 --no-pager
journalctl --user -u algo-trade-plugin-supervisor.service -n 100 --no-pager
journalctl --user -u algo-trade-status-publisher.service -n 100 --no-pager
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
