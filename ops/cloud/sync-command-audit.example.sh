#!/usr/bin/env bash
# EXAMPLE ONLY. Copy hosted receiver command-audit rows to off-host storage.
#
# This is a retention sketch, not a guarantee of immutability. For
# internet-facing receivers, use provider controls such as object lock,
# versioning, lifecycle retention, or a storage account whose write permissions
# are separate from the receiver host.

set -euo pipefail

: "${AUDIT_SOURCE:=paper_logs/cloud_status_server/command_audit.jsonl}"
: "${AUDIT_DEST:?set AUDIT_DEST, for example s3://example-bucket/algo-trade/audit/receiver-a/command_audit.jsonl}"
: "${BACKEND:=aws}"
: "${APPLY:=0}"

if [[ ! -f "$AUDIT_SOURCE" ]]; then
  printf 'Audit source does not exist: %s\n' "$AUDIT_SOURCE" >&2
  exit 1
fi

case "$BACKEND" in
  aws)
    cmd=(aws s3 cp "$AUDIT_SOURCE" "$AUDIT_DEST" --only-show-errors)
    ;;
  rclone)
    cmd=(rclone copyto "$AUDIT_SOURCE" "$AUDIT_DEST")
    ;;
  *)
    printf 'Unsupported BACKEND=%s. Use aws or rclone.\n' "$BACKEND" >&2
    exit 1
    ;;
esac

printf 'Planned audit sync command:\n  '
printf '%q ' "${cmd[@]}"
printf '\n'

if [[ "$APPLY" != "1" ]]; then
  printf '\nDry run only. Re-run with APPLY=1 after verifying destination retention controls.\n'
  exit 0
fi

"${cmd[@]}"
