#!/usr/bin/env bash
set -euo pipefail

usage() {
  cat <<'EOF'
Usage: scripts/install_local_monitoring_stack.sh [options]

Install local dashboard/status monitoring user services for this checkout.

Options:
  --with-command-worker   Also install the remote command worker service.
  --config-dir PATH       Local config directory. Default: ~/.config/algo-trade
  --endpoint URL          Status receiver endpoint. Default: http://127.0.0.1:8765/status
  --token-env NAME        Bearer token environment variable name. Default: TRADING_STATUS_TOKEN
  -h, --help              Show this help.

The command worker remains opt-in because it polls queued commands. Review
config/remote_control.example.yaml before enabling it on a real machine.
EOF
}

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"
CONFIG_DIR="${HOME}/.config/algo-trade"
ENDPOINT="http://127.0.0.1:8765/status"
TOKEN_ENV="TRADING_STATUS_TOKEN"
WITH_COMMAND_WORKER=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --with-command-worker)
      WITH_COMMAND_WORKER=1
      shift
      ;;
    --config-dir)
      CONFIG_DIR="$2"
      shift 2
      ;;
    --endpoint)
      ENDPOINT="$2"
      shift 2
      ;;
    --token-env)
      TOKEN_ENV="$2"
      shift 2
      ;;
    -h|--help)
      usage
      exit 0
      ;;
    *)
      echo "Unknown option: $1" >&2
      usage >&2
      exit 2
      ;;
  esac
done

mkdir -p "${UNIT_DIR}" "${CONFIG_DIR}"

if [[ ! -f "${CONFIG_DIR}/cloud_status.yaml" ]]; then
  cp "${REPO_DIR}/config/cloud_status.example.yaml" "${CONFIG_DIR}/cloud_status.yaml"
  echo "Created ${CONFIG_DIR}/cloud_status.yaml from public example config."
else
  echo "Keeping existing ${CONFIG_DIR}/cloud_status.yaml."
fi

if [[ ! -f "${CONFIG_DIR}/status-publisher.env" ]]; then
  cat > "${CONFIG_DIR}/status-publisher.env" <<EOF
TRADING_STATUS_ENDPOINT=${ENDPOINT}
# Set ${TOKEN_ENV}=... here or in your user environment if the receiver requires auth.
EOF
  chmod 600 "${CONFIG_DIR}/status-publisher.env"
  echo "Created ${CONFIG_DIR}/status-publisher.env."
else
  echo "Keeping existing ${CONFIG_DIR}/status-publisher.env."
fi

"${REPO_DIR}/scripts/install_dashboard_server.sh"

cat > "${UNIT_DIR}/algo-trade-status-publisher.service" <<EOF
[Unit]
Description=Algo Trade sanitized status publisher
Documentation=file:${REPO_DIR}/docs/cloud_monitoring_deployment.md
Wants=network-online.target
After=network-online.target

[Service]
Type=oneshot
WorkingDirectory=${REPO_DIR}
EnvironmentFile=-${CONFIG_DIR}/status-publisher.env
ExecStart=/usr/bin/env python3 ${REPO_DIR}/scripts/publish_status.py --config ${CONFIG_DIR}/cloud_status.yaml --endpoint \${TRADING_STATUS_ENDPOINT} --token-env ${TOKEN_ENV}
TimeoutStartSec=45s

[Install]
WantedBy=default.target
EOF

cat > "${UNIT_DIR}/algo-trade-status-publisher.timer" <<'EOF'
[Unit]
Description=Publish sanitized Algo Trade status every minute

[Timer]
OnBootSec=30s
OnUnitActiveSec=60s
Persistent=false
Unit=algo-trade-status-publisher.service

[Install]
WantedBy=timers.target
EOF

if [[ "${WITH_COMMAND_WORKER}" -eq 1 ]]; then
  if [[ ! -f "${CONFIG_DIR}/remote_control.yaml" ]]; then
    cp "${REPO_DIR}/config/remote_control.example.yaml" "${CONFIG_DIR}/remote_control.yaml"
    echo "Created ${CONFIG_DIR}/remote_control.yaml from public example config."
  else
    echo "Keeping existing ${CONFIG_DIR}/remote_control.yaml."
  fi
  if [[ ! -f "${CONFIG_DIR}/command-worker.env" ]]; then
    cat > "${CONFIG_DIR}/command-worker.env" <<EOF
# Set ${TOKEN_ENV}=... here or in your user environment if the receiver requires auth.
EOF
    chmod 600 "${CONFIG_DIR}/command-worker.env"
    echo "Created ${CONFIG_DIR}/command-worker.env."
  else
    echo "Keeping existing ${CONFIG_DIR}/command-worker.env."
  fi

  cat > "${UNIT_DIR}/algo-trade-command-worker.service" <<EOF
[Unit]
Description=Algo Trade safe remote command worker
Documentation=file:${REPO_DIR}/docs/cloud_monitoring_deployment.md
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
EnvironmentFile=-${CONFIG_DIR}/command-worker.env
ExecStart=/usr/bin/env python3 ${REPO_DIR}/scripts/command_worker.py --config ${CONFIG_DIR}/remote_control.yaml --token-env ${TOKEN_ENV}
Restart=on-failure
RestartSec=10
TimeoutStopSec=20s

[Install]
WantedBy=default.target
EOF
fi

systemctl --user daemon-reload
systemctl --user enable --now algo-trade-status-publisher.timer
if [[ "${WITH_COMMAND_WORKER}" -eq 1 ]]; then
  systemctl --user enable --now algo-trade-command-worker.service
fi

echo
echo "Installed local monitoring stack."
echo "Dashboard: http://127.0.0.1:8765/"
echo
echo "Useful commands:"
echo "  systemctl --user status algo-trade-dashboard-server.service"
echo "  systemctl --user status algo-trade-status-publisher.timer"
echo "  journalctl --user -u algo-trade-status-publisher.service -f"
if [[ "${WITH_COMMAND_WORKER}" -eq 1 ]]; then
  echo "  systemctl --user status algo-trade-command-worker.service"
  echo "  journalctl --user -u algo-trade-command-worker.service -f"
fi
