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
        self.recompute_counts()
        self.write()

    def retry(
        self,
        symbol: str,
        message: str,
        *,
        day: str | None = None,
        attempt: int | None = None,
        max_retries: int | None = None,
        delay_seconds: float | None = None,
    ) -> None:
        self.event(
            "retry",
            message,
            symbol=symbol,
            day=day,
            attempt=attempt,
            max_retries=max_retries,
            delay_seconds=delay_seconds,
        )

    def pacing_wait(
        self,
        seconds: float,
        *,
        reason: str,
        symbol: str | None = None,
        day: str | None = None,
    ) -> None:
        self.event(
            "pacing_wait",
            f"{reason}: waited {seconds:.3f}s",
            symbol=symbol,
            day=day,
            seconds=float(seconds),
            reason=reason,
        )

    def set_progress(self, **fields: Any) -> None:
        if not self.enabled:
            return
        self.data["progress"] = {
            "updated_at": utc_now(),
            **fields,
        }
        self.recompute_counts()
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
        elapsed_seconds: float | None = None,
        attempt_count: int | None = None,
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
        if elapsed_seconds is not None:
            row["elapsed_seconds"] = float(elapsed_seconds)
        if attempt_count is not None:
            row["attempt_count"] = int(attempt_count)
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
        elapsed_seconds: float | None = None,
        attempt_count: int | None = None,
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
        if elapsed_seconds is not None:
            row["elapsed_seconds"] = float(elapsed_seconds)
        if attempt_count is not None:
            row["attempt_count"] = int(attempt_count)
        self.data["errors"].append(row)
        self.recompute_counts()
        self.write()

    def build_resume_state(
        self,
        symbols: list[dict[str, Any]],
        outputs: list[dict[str, Any]],
        errors: list[dict[str, Any]],
    ) -> dict[str, Any]:
        requested = [
            str(symbol).upper()
            for symbol in (self.data.get("symbols_requested") or [])
            if str(symbol).strip()
        ]
        tracked = {
            str(row.get("symbol") or "").upper()
            for row in symbols
            if str(row.get("symbol") or "").strip()
        }
        done_statuses = {"ok", "empty", "skipped"}
        done_symbols = sorted({
            str(row.get("symbol") or "").upper()
            for row in symbols
            if str(row.get("symbol") or "").strip() and row.get("status") in done_statuses
        })
        failed_symbols = {
            str(row.get("symbol") or "").upper()
            for row in symbols
            if str(row.get("symbol") or "").strip() and row.get("status") in {"failed", "partial"}
        }
        empty_symbols = sorted({
            str(row.get("symbol") or "").upper()
            for row in symbols
            if str(row.get("symbol") or "").strip() and row.get("status") == "empty"
        })
        skipped_symbols = sorted({
            str(row.get("symbol") or "").upper()
            for row in symbols
            if str(row.get("symbol") or "").strip() and row.get("status") == "skipped"
        })
        error_symbols_by_kind: dict[str, set[str]] = {}
        failed_days_by_symbol: dict[str, set[str]] = {}
        no_data_days_by_symbol: dict[str, set[str]] = {}
        for row in errors:
            if not isinstance(row, dict):
                continue
            symbol = str(row.get("symbol") or "").upper()
            if not symbol:
                continue
            kind = str(row.get("kind") or "error")
            error_symbols_by_kind.setdefault(kind, set()).add(symbol)
            day = str(row.get("day") or "")
            if day:
                failed_days_by_symbol.setdefault(symbol, set()).add(day)
                if kind == "no_data":
                    no_data_days_by_symbol.setdefault(symbol, set()).add(day)

        done_paths = sorted({
            str(row.get("path") or "")
            for row in outputs
            if isinstance(row, dict) and row.get("status") in {"ok", "empty"} and row.get("path")
        })
        completed_chunks: list[dict[str, Any]] = []
        no_data_chunks: list[dict[str, Any]] = []
        for row in outputs:
            if not isinstance(row, dict) or row.get("status") not in {"ok", "empty"}:
                continue
            chunk = {
                "symbol": str(row.get("symbol") or "").upper(),
                "day": row.get("day"),
                "status": row.get("status"),
                "path": row.get("path"),
            }
            completed_chunks.append(chunk)
            if row.get("status") == "empty":
                no_data_chunks.append(chunk)

        error_symbols = set().union(*error_symbols_by_kind.values()) if error_symbols_by_kind else set()
        pending_symbols = sorted((set(requested) - tracked) | (error_symbols - set(done_symbols)))
        retryable_symbols = sorted(error_symbols_by_kind.get("connection", set()) | error_symbols_by_kind.get("error", set()))
        return {
            "schema_version": 1,
            "updated_at": utc_now(),
            "resume_modes": ["symbol"] if self.kind == "stock_history" else ["chunk_path"] if self.kind == "crypto_history" else [],
            "done_symbols": done_symbols,
            "failed_symbols": sorted(failed_symbols | error_symbols),
            "empty_symbols": empty_symbols,
            "skipped_symbols": skipped_symbols,
            "pending_symbols": pending_symbols,
            "completed_output_paths": done_paths,
            "completed_chunks": completed_chunks,
            "no_data_chunks": no_data_chunks,
            "failed_days_by_symbol": {
                symbol: sorted(days)
                for symbol, days in sorted(failed_days_by_symbol.items())
            },
            "no_data_days_by_symbol": {
                symbol: sorted(days)
                for symbol, days in sorted(no_data_days_by_symbol.items())
            },
            "no_data_symbols": sorted(error_symbols_by_kind.get("no_data", set())),
            "permission_symbols": sorted(error_symbols_by_kind.get("permission", set())),
            "contract_symbols": sorted(error_symbols_by_kind.get("contract", set())),
            "retryable_symbols": retryable_symbols,
        }

    def recompute_counts(self) -> None:
        symbols = list((self.data.get("symbols") or {}).values())
        outputs = self.data.get("outputs") or []
        errors = self.data.get("errors") or []
        events = self.data.get("events") or []
        progress = self.data.get("progress") if isinstance(self.data.get("progress"), dict) else {}
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
        retry_events = [row for row in events if isinstance(row, dict) and row.get("type") == "retry"]
        pacing_events = [row for row in events if isinstance(row, dict) and row.get("type") == "pacing_wait"]
        output_elapsed = [
            float(row.get("elapsed_seconds"))
            for row in outputs
            if isinstance(row, dict) and row.get("elapsed_seconds") is not None
        ]
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
            "retry_events": len(retry_events),
            "pacing_wait_events": len(pacing_events),
            "pacing_wait_seconds": sum(float(row.get("seconds") or 0.0) for row in pacing_events),
            "avg_output_elapsed_seconds": (
                sum(output_elapsed) / len(output_elapsed) if output_elapsed else None
            ),
            "latest_completed_chunks": progress.get("completed_chunks"),
            "latest_remaining_chunks": progress.get("remaining_chunks"),
            "latest_completed_symbols": progress.get("completed_symbols"),
            "latest_remaining_symbols": progress.get("remaining_symbols"),
            "latest_total_symbols": progress.get("total_symbols"),
            "latest_eta_seconds": progress.get("eta_seconds"),
            "latest_avg_chunk_seconds": progress.get("rolling_avg_chunk_seconds"),
            "latest_avg_symbol_seconds": progress.get("rolling_avg_symbol_seconds"),
        }
        self.data["resume_state"] = self.build_resume_state(symbols, outputs, errors)

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
