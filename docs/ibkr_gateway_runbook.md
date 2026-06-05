# IBKR Gateway Runbook

This runbook covers local IBKR Gateway startup and recovery for the public
framework. Keep credentials, IBC config, account IDs, and screenshots out of
git.

## Manual Startup

1. Start IBKR Gateway or TWS.
2. Select paper mode when testing paper trading.
3. Complete any two-factor or approval dialogs locally.
4. Confirm the API port:
   - paper Gateway usually listens on `4002`
   - live Gateway usually listens on `4001`
   - paper TWS commonly listens on `7497`
   - live TWS commonly listens on `7496`
5. Confirm API access is enabled in Gateway/TWS settings.

The generic paper runner treats `4001` and `7496` as live-port hazards and
refuses them unless both config and CLI explicitly opt in. Prefer `4002` for
paper Gateway.

Quick TCP check:

```bash
python3 - <<'PY'
import socket

for port in (4002, 4001):
    sock = socket.socket()
    sock.settimeout(2)
    try:
        sock.connect(("127.0.0.1", port))
    except OSError as exc:
        print(f"{port}: closed ({exc})")
    else:
        print(f"{port}: open")
    finally:
        sock.close()
PY
```

## Service Startup

The public repo includes a user service wrapper for paper Gateway:

```bash
systemctl --user daemon-reload
systemctl --user start ibgateway-paper.service
systemctl --user status ibgateway-paper.service --no-pager
```

If you use IBC, keep its config outside git and protect it:

```bash
chmod 600 /path/to/ibc/config.ini
```

Do not store live-account credentials in repo files.

## Recovery Checklist

Use this order when runners cannot connect:

1. Check whether Gateway is running.
2. Check whether the expected port is open.
3. Check Gateway API settings and trusted IPs.
4. Check whether another session has taken over the login.
5. Complete any local approval dialog.
6. Restart Gateway if the API remains disconnected after login.

Useful commands:

```bash
systemctl --user status ibgateway-paper.service --no-pager
journalctl --user -u ibgateway-paper.service -n 100 --no-pager
python3 live/plugin_runner.py --config config/plugin_runner.example.yaml --validate-only
```

## Common Symptoms

- `ConnectionRefusedError`: Gateway is closed, wrong port, or API disabled.
- Gateway window opens then exits: login failed, another session took over, or
  an approval dialog was not completed.
- API connects then disconnects: Gateway restarted, client ID conflict, or
  session reset.
- Market data requests fail after API connection: this is usually a market-data
  permission or contract/venue issue, not a Gateway startup issue.
