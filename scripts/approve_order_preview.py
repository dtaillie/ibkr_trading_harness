#!/usr/bin/env python3
"""Create a local approval file for a held plugin-runner order preview."""

from __future__ import annotations

import argparse
import json
import os
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


def read_jsonl(path: Path) -> list[dict[str, Any]]:
    rows: list[dict[str, Any]] = []
    with path.open() as f:
        for line in f:
            line = line.strip()
            if not line:
                continue
            payload = json.loads(line)
            if isinstance(payload, dict):
                rows.append(payload)
    return rows


def select_preview(rows: list[dict[str, Any]], approval_id: str | None) -> dict[str, Any]:
    if approval_id:
        matches = [row for row in rows if str(row.get("approval_id") or "") == approval_id]
    else:
        matches = [
            row for row in rows
            if str(row.get("approval_status") or "").lower() in {"required", "approval_required"}
            and row.get("approval_id")
            and row.get("approval_digest")
        ]
    if not matches:
        raise SystemExit("No matching approval-required preview found")
    return matches[-1]


def approval_path(preview: dict[str, Any], approval_dir: Path | None) -> Path:
    approval_id = str(preview.get("approval_id") or "").strip()
    if not approval_id:
        raise SystemExit("Preview is missing approval_id")
    if approval_dir is not None:
        return approval_dir / f"{approval_id}.approved.json"
    raw = str(preview.get("approval_file") or "").strip()
    if not raw:
        raise SystemExit("Preview is missing approval_file; pass --approval-dir")
    return Path(raw)


def write_json_atomic(path: Path, payload: dict[str, Any], *, force: bool) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    if path.exists() and not force:
        raise SystemExit(f"Approval file already exists: {path}")
    tmp = path.with_name(f".{path.name}.{os.getpid()}.tmp")
    with tmp.open("w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def build_approval(preview: dict[str, Any], *, approver: str) -> dict[str, Any]:
    return {
        "schema_version": 1,
        "action": "approve",
        "approval_id": preview.get("approval_id"),
        "approval_digest": preview.get("approval_digest"),
        "approved_at": datetime.now(timezone.utc).isoformat(),
        "approver": approver,
        "symbol": preview.get("symbol"),
        "side": preview.get("side"),
        "quantity": preview.get("quantity"),
        "cash_quantity": preview.get("cash_quantity"),
        "estimated_notional": preview.get("estimated_notional"),
        "tag": preview.get("tag"),
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Approve one held order preview from order_previews.jsonl")
    parser.add_argument("preview_file", type=Path, help="Path to order_previews.jsonl")
    parser.add_argument("--approval-id", help="Specific approval_id to approve. Defaults to the latest required preview.")
    parser.add_argument("--approval-dir", type=Path, help="Override directory for the generated approval file.")
    parser.add_argument("--approver", default="local-operator", help="Public label written into the approval file.")
    parser.add_argument("--force", action="store_true", help="Overwrite an existing approval file.")
    parser.add_argument("--dry-run", action="store_true", help="Print the approval file path without writing.")
    args = parser.parse_args()

    previews = read_jsonl(args.preview_file)
    preview = select_preview(previews, args.approval_id)
    path = approval_path(preview, args.approval_dir)
    approval = build_approval(preview, approver=args.approver)
    if not args.dry_run:
        write_json_atomic(path, approval, force=args.force)
    print(path)
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
