"""Shared JSON manifest writer for historical data fetch jobs."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any


DEFAULT_FETCH_MANIFEST_DIR = Path("paper_logs/fetch_manifests")


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def slug_part(value: str) -> str:
    out = "".join(char if char.isalnum() or char in {"-", "_", "."} else "_" for char in value.strip())
    return out.strip("._-") or "fetch"


def infer_error_kind(message: str) -> str:
    lowered = message.lower()
    if "no market data permissions" in lowered or "permissions" in lowered:
        return "permission"
    if "no data returned" in lowered or "returned no data" in lowered or "no bars" in lowered:
        return "no_data"
    if "qualify" in lowered or "contract" in lowered:
        return "contract"
    return "error"


class FetchManifest:
    """Small atomic JSON manifest for dashboard-readable fetch status."""

    def __init__(
        self,
        *,
        manifest_dir: Path | None,
        kind: str,
        parameters: dict[str, Any],
        symbols: list[str],
        enabled: bool = True,
    ) -> None:
        self.enabled = enabled
        self.started_at = utc_now()
        self.kind = kind
        self.job_id = f"{slug_part(kind)}_{self.started_at.replace(':', '').replace('+', '_')}"
        self.path = (manifest_dir or DEFAULT_FETCH_MANIFEST_DIR) / f"{self.job_id}.json"
        self.data: dict[str, Any] = {
            "schema_version": 1,
            "job_id": self.job_id,
            "kind": kind,
            "status": "running",
            "started_at": self.started_at,
            "finished_at": None,
            "parameters": parameters,
            "symbols_requested": symbols,
            "symbols": {},
            "plan": {},
            "outputs": [],
            "errors": [],
            "events": [],
            "counts": {},
        }
        self.recompute_counts()
        self.write()

    def write(self) -> None:
        if not self.enabled:
            return
        self.path.parent.mkdir(parents=True, exist_ok=True)
        tmp_path = self.path.with_suffix(self.path.suffix + ".tmp")
        tmp_path.write_text(json.dumps(self.data, indent=2, sort_keys=True) + "\n", encoding="utf-8")
        tmp_path.replace(self.path)

    def event(self, event_type: str, message: str, **fields: Any) -> None:
        if not self.enabled:
            return
        self.data["events"].append({
            "timestamp": utc_now(),
            "type": event_type,
            "message": message,
            **fields,
        })
        self.write()

    def set_plan(self, **fields: Any) -> None:
        if not self.enabled:
            return
        self.data["plan"].update(fields)
        self.recompute_counts()
        self.write()

    def symbol(
        self,
        symbol: str,
        status: str,
        *,
        bars: int | None = None,
        first_timestamp: Any = None,
        last_timestamp: Any = None,
        chunks_completed: int | None = None,
        chunks_failed: int | None = None,
        chunks_skipped: int | None = None,
        message: str | None = None,
    ) -> None:
        if not self.enabled:
            return
        current = dict(self.data["symbols"].get(symbol) or {})
        current.update({
            "symbol": symbol,
            "status": status,
            "updated_at": utc_now(),
        })
        if bars is not None:
            current["bars"] = int(bars)
        if first_timestamp is not None:
            current["first_timestamp"] = str(first_timestamp)
        if last_timestamp is not None:
            current["last_timestamp"] = str(last_timestamp)
        if chunks_completed is not None:
            current["chunks_completed"] = int(chunks_completed)
        if chunks_failed is not None:
            current["chunks_failed"] = int(chunks_failed)
        if chunks_skipped is not None:
            current["chunks_skipped"] = int(chunks_skipped)
        if message:
            current["message"] = message
        self.data["symbols"][symbol] = current
        self.recompute_counts()
        self.write()

    def output(
        self,
        symbol: str,
        *,
        path: str | Path | None,
        rows: int,
        status: str = "ok",
        first_timestamp: Any = None,
        last_timestamp: Any = None,
        day: str | None = None,
        message: str | None = None,
    ) -> None:
        if not self.enabled:
            return
        row: dict[str, Any] = {
            "timestamp": utc_now(),
            "symbol": symbol,
            "status": status,
            "rows": int(rows),
            "path": str(path) if path else None,
        }
        if first_timestamp is not None:
            row["first_timestamp"] = str(first_timestamp)
        if last_timestamp is not None:
            row["last_timestamp"] = str(last_timestamp)
        if day:
            row["day"] = day
        if message:
            row["message"] = message
        self.data["outputs"].append(row)
        self.recompute_counts()
        self.write()

    def error(
        self,
        symbol: str,
        message: str,
        *,
        kind: str | None = None,
        day: str | None = None,
    ) -> None:
        if not self.enabled:
            return
        row: dict[str, Any] = {
            "timestamp": utc_now(),
            "symbol": symbol,
            "kind": kind or infer_error_kind(message),
            "message": message,
        }
        if day:
            row["day"] = day
        self.data["errors"].append(row)
        self.recompute_counts()
        self.write()

    def recompute_counts(self) -> None:
        symbols = list((self.data.get("symbols") or {}).values())
        outputs = self.data.get("outputs") or []
        errors = self.data.get("errors") or []
        status_counts: dict[str, int] = {}
        for row in symbols:
            status = str(row.get("status") or "unknown")
            status_counts[status] = status_counts.get(status, 0) + 1
        output_status_counts: dict[str, int] = {}
        for row in outputs:
            status = str(row.get("status") or "unknown")
            output_status_counts[status] = output_status_counts.get(status, 0) + 1
        error_kind_counts: dict[str, int] = {}
        for row in errors:
            kind = str(row.get("kind") or "error")
            error_kind_counts[kind] = error_kind_counts.get(kind, 0) + 1
        self.data["counts"] = {
            "requested_symbols": len(self.data.get("symbols_requested") or []),
            "tracked_symbols": len(symbols),
            "completed_symbols": sum(1 for row in symbols if row.get("status") in {"ok", "empty", "skipped", "failed", "partial"}),
            "success_symbols": sum(1 for row in symbols if row.get("status") == "ok"),
            "failed_symbols": sum(1 for row in symbols if row.get("status") == "failed"),
            "partial_symbols": sum(1 for row in symbols if row.get("status") == "partial"),
            "empty_symbols": sum(1 for row in symbols if row.get("status") == "empty"),
            "skipped_symbols": sum(1 for row in symbols if row.get("status") == "skipped"),
            "outputs": len(outputs),
            "errors": len(errors),
            "rows": sum(int(row.get("rows") or 0) for row in outputs),
            "status_counts": dict(sorted(status_counts.items())),
            "output_status_counts": dict(sorted(output_status_counts.items())),
            "success_chunks": output_status_counts.get("ok", 0),
            "empty_chunks": output_status_counts.get("empty", 0),
            "failed_chunks": len(errors),
            "error_kind_counts": dict(sorted(error_kind_counts.items())),
        }

    def finish(self, status: str | None = None) -> None:
        if not self.enabled:
            return
        self.recompute_counts()
        counts = self.data.get("counts") or {}
        if status is None:
            if counts.get("failed_symbols") or counts.get("partial_symbols") or counts.get("errors"):
                status = "partial" if counts.get("success_symbols") or counts.get("outputs") else "failed"
            else:
                status = "completed"
        self.data["status"] = status
        self.data["finished_at"] = utc_now()
        self.write()
