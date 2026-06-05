#!/usr/bin/env bash
# EXAMPLE ONLY. Host firewall sketch for a small status-receiver VPS.
#
# This script is intentionally conservative and requires APPLY=1 before it
# changes firewall rules. Review every variable for your host before use.

set -euo pipefail

: "${SSH_CIDR:?set SSH_CIDR to your management IP/CIDR, for example 203.0.113.10/32}"
: "${PUBLISHER_CIDR:?set PUBLISHER_CIDR to your trading machine/VPN IP/CIDR}"
: "${DASHBOARD_CIDR:=$SSH_CIDR}"
: "${APPLY:=0}"

commands=(
  "ufw --force reset"
  "ufw default deny incoming"
  "ufw default allow outgoing"
  "ufw allow from ${SSH_CIDR} to any port 22 proto tcp comment 'management ssh'"
  "ufw allow from ${PUBLISHER_CIDR} to any port 443 proto tcp comment 'status publisher https'"
  "ufw allow from ${DASHBOARD_CIDR} to any port 443 proto tcp comment 'dashboard https'"
  "ufw deny 8765/tcp comment 'receiver app must stay behind local proxy'"
  "ufw --force enable"
  "ufw status verbose"
)

printf 'Planned UFW commands:\n'
printf '  %s\n' "${commands[@]}"

if [[ "$APPLY" != "1" ]]; then
  printf '\nDry run only. Re-run with APPLY=1 after review.\n'
  exit 0
fi

for cmd in "${commands[@]}"; do
  printf '+ %s\n' "$cmd"
  eval "$cmd"
done
