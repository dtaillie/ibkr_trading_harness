#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
REPO_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
cd "${REPO_DIR}"

LOG_DIR="${IBGATEWAY_LOG_DIR:-paper_logs/ibgateway/service}"
mkdir -p "${LOG_DIR}"
LOG_FILE="${LOG_DIR}/$(date +%F)_ibgateway.log"

ENV_FILE="config/ibgateway_paper.env"
if [[ -f "${ENV_FILE}" ]]; then
  set -a
  # shellcheck disable=SC1091
  source "${ENV_FILE}"
  set +a
else
  echo "$(date -Is) ${ENV_FILE} not found; Gateway startup service is in manual mode" | tee -a "${LOG_FILE}"
fi

IBGATEWAY_START_MODE="${IBGATEWAY_START_MODE:-manual}"
IBGATEWAY_PATH="${IBGATEWAY_PATH:-}"
IBGATEWAY_TRADING_MODE="${IBGATEWAY_TRADING_MODE:-paper}"
IBGATEWAY_MARKET_DAYS_ONLY="${IBGATEWAY_MARKET_DAYS_ONLY:-1}"
IBC_PATH="${IBC_PATH:-/opt/IBC}"
IBC_INI="${IBC_INI:-}"
IBC_GATEWAY_VERSION="${IBC_GATEWAY_VERSION:-1045}"

export DISPLAY="${DISPLAY:-:0}"

{
  echo "================================================================"
  echo "$(date -Is) Gateway startup mode=${IBGATEWAY_START_MODE}"

  if [[ "${IBGATEWAY_MARKET_DAYS_ONLY}" == "1" || "${IBGATEWAY_MARKET_DAYS_ONLY,,}" == "true" ]]; then
    today="$(date +%F)"
    market_status="$(python3 scripts/is_us_stock_market_day.py --date "${today}" 2>/dev/null || true)"
    if [[ "${market_status}" != "market_day" ]]; then
      echo "$(date -Is) US stock market closed on ${today} (${market_status:-unknown}); skipping Gateway startup"
      exit 0
    fi
  fi

  case "${IBGATEWAY_START_MODE}" in
    manual)
      echo "$(date -Is) manual mode: not launching Gateway"
      exit 0
      ;;
    direct)
      if [[ -z "${IBGATEWAY_PATH}" ]]; then
        echo "$(date -Is) IBGATEWAY_PATH is not set; update ${ENV_FILE}"
        exit 1
      fi
      if [[ ! -x "${IBGATEWAY_PATH}" ]]; then
        echo "$(date -Is) IBGATEWAY_PATH is not executable: ${IBGATEWAY_PATH}"
        exit 1
      fi
      echo "$(date -Is) launching IB Gateway directly: ${IBGATEWAY_PATH}"
      exec "${IBGATEWAY_PATH}"
      ;;
    ibc)
      start_script="${IBC_PATH}/scripts/ibcstart.sh"
      if [[ -z "${IBC_INI}" ]]; then
        echo "$(date -Is) IBC_INI is not set; update ${ENV_FILE}"
        exit 1
      fi
      if [[ ! -x "${start_script}" ]]; then
        echo "$(date -Is) IBC start script is not executable: ${start_script}"
        echo "$(date -Is) install IBC and update config/ibgateway_paper.env"
        exit 1
      fi
      if [[ ! -f "${IBC_INI}" ]]; then
        echo "$(date -Is) IBC config not found: ${IBC_INI}"
        exit 1
      fi
      if [[ -z "${IBC_USERNAME:-}" || -z "${IBC_PASSWORD:-}" ]]; then
        echo "$(date -Is) IBC_USERNAME/IBC_PASSWORD are not set in ${ENV_FILE}"
        exit 1
      fi
      IBC_USERNAME="${IBC_USERNAME}" IBC_PASSWORD="${IBC_PASSWORD}" IBC_INI="${IBC_INI}" python3 - <<'PY'
import os
from pathlib import Path

path = Path(os.environ["IBC_INI"])
text = path.read_text()
replacements = {
    "IbLoginId": os.environ["IBC_USERNAME"],
    "IbPassword": os.environ["IBC_PASSWORD"],
}
lines = []
seen = set()
for line in text.splitlines():
    key = line.split("=", 1)[0].strip() if "=" in line else ""
    if key in replacements:
        lines.append(f"{key}={replacements[key]}")
        seen.add(key)
    else:
        lines.append(line)
for key, value in replacements.items():
    if key not in seen:
        lines.append(f"{key}={value}")
path.write_text("\n".join(lines) + "\n")
path.chmod(0o600)
PY
      echo "$(date -Is) launching IB Gateway through IBC; approve IBKR Mobile 2FA when prompted"
      exec "${start_script}" "${IBC_GATEWAY_VERSION}" "--gateway" "--mode=${IBGATEWAY_TRADING_MODE}" \
        "--ibc-path=${IBC_PATH}" "--ibc-ini=${IBC_INI}"
      ;;
    *)
      echo "$(date -Is) unknown IBGATEWAY_START_MODE: ${IBGATEWAY_START_MODE}"
      exit 1
      ;;
  esac
} 2>&1 | tee -a "${LOG_FILE}"
