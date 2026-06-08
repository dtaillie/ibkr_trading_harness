#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
UNIT_DIR="${HOME}/.config/systemd/user"
UNIT_PATH="${UNIT_DIR}/algo-trade-dashboard-server.service"

CONFIG_PATH="${REPO_DIR}/config/cloud_status_local.yaml"
if [[ ! -f "${CONFIG_PATH}" ]]; then
  CONFIG_PATH="${REPO_DIR}/config/cloud_status.example.yaml"
fi

mkdir -p "${UNIT_DIR}" "${REPO_DIR}/paper_logs/cloud_status_server/service"

cat > "${UNIT_PATH}" <<EOF
[Unit]
Description=Algo Trade local dashboard/status receiver
Wants=network-online.target
After=network-online.target

[Service]
Type=simple
WorkingDirectory=${REPO_DIR}
Environment=PYTHONUNBUFFERED=1
ExecStart=/usr/bin/env python3 ${REPO_DIR}/scripts/cloud_status_server.py --config ${CONFIG_PATH}
Restart=on-failure
RestartSec=5
TimeoutStopSec=20s

[Install]
WantedBy=default.target
EOF

systemctl --user daemon-reload
systemctl --user enable --now algo-trade-dashboard-server.service

echo "Installed dashboard/status receiver:"
systemctl --user status algo-trade-dashboard-server.service --no-pager
echo
echo "Useful commands:"
echo "  systemctl --user restart algo-trade-dashboard-server.service"
echo "  systemctl --user status algo-trade-dashboard-server.service"
echo "  journalctl --user -u algo-trade-dashboard-server.service -f"
echo "  python3 scripts/smoke_dashboard.py --host 127.0.0.1 --port 0"
