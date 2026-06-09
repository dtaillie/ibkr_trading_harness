#!/usr/bin/env python3
"""Collect and publish read-only runner telemetry.

This script is public-safe by design: it reads generic plugin-run artifacts,
optionally checks Gateway TCP reachability, and writes/posts a JSON snapshot.
It does not read broker credentials and it does not execute commands.
"""

from __future__ import annotations

import argparse
import hashlib
import hmac
import json
import os
import socket
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import error, request

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.summarize_plugin_run import summarize_recent_run_events, summarize_run


SCHEMA_VERSION = 1
RUN_ARTIFACT_FILES = (
    "summary.json",
    "runner_status.json",
    "performance_rollups.json",
    "plugin_contract.json",
    "decisions.jsonl",
    "orders.jsonl",
    "fills.jsonl",
    "account.jsonl",
    "order_previews.jsonl",
)
RUN_ARTIFACT_JSONL_FILES = {
    "decisions.jsonl",
    "orders.jsonl",
    "fills.jsonl",
    "account.jsonl",
    "order_previews.jsonl",
}
ORDER_STATE_CATEGORY_LABELS = {
    "approval_required": "held for manual approval",
    "broker_api_disconnected": "broker API disconnected",
    "broker_login_required": "broker login/session required",
    "cancelled": "cancelled orders",
    "inactive": "inactive broker orders",
    "rejected": "rejected orders",
    "risk_limit": "risk-limit order rejections",
}

RUN_TOP_LEVEL_METRIC_FIELDS = (
    "mode",
    "decisions",
    "orders",
    "fills",
    "rejections",
    "final_cash",
    "final_equity",
    "final_positions",
    "realized_pnl",
    "unrealized_pnl",
    "total_pnl",
    "total_commission",
    "gross_exposure",
    "gross_exposure_pct",
    "net_exposure",
    "net_exposure_pct",
    "max_gross_exposure",
    "max_gross_exposure_pct",
    "max_abs_net_exposure",
    "max_abs_net_exposure_pct",
    "latest_rejection_time",
    "latest_rejection_symbol",
    "latest_rejection_status",
    "latest_rejection_reason",
    "next_check_time",
    "next_expected_decision_time",
    "next_check_reason",
    "next_order_condition",
    "latest_signal_reason",
    "latest_signal_label",
    "latest_signal_value",
)


def artifact_file_category(name: str) -> str:
    if name == "summary.json":
        return "summary"
    if name == "runner_status.json":
        return "runner_status"
    if name == "performance_rollups.json":
        return "performance"
    if name == "plugin_contract.json":
        return "plugin_contract"
    if name == "account.jsonl":
        return "account_stream"
    if name == "order_previews.jsonl":
        return "order_preview_stream"
    if name in {"decisions.jsonl", "orders.jsonl", "fills.jsonl"}:
        return "event_stream"
    return "other"


def attach_run_summary_fields(record: dict[str, Any], metrics: dict[str, Any]) -> None:
    for field in RUN_TOP_LEVEL_METRIC_FIELDS:
        if field in metrics:
            record[field] = metrics.get(field)
    record["cash"] = metrics.get("final_cash")
    record["latest_decision_time"] = metrics.get("last_decision_time")
    record["latest_account_time"] = (
        metrics.get("account_end_time")
        or metrics.get("latest_account_time")
        or metrics.get("latest_account_timestamp")
    )
    record["latest_data_time"] = (
        metrics.get("latest_data_time")
        or metrics.get("latest_market_data_time")
        or metrics.get("latest_bar_time")
    )
    record["latest_bar_time"] = (
        metrics.get("latest_bar_time")
        or metrics.get("latest_data_time")
        or metrics.get("latest_market_data_time")
    )
    if "position_count" in metrics:
        record["position_count"] = metrics.get("position_count")
    else:
        record["position_count"] = nonzero_position_count(metrics.get("final_positions"))
    for field in ("open_order_count", "approval_required_orders", "approval_hold_count"):
        if field in metrics:
            record[field] = metrics.get(field)
    health = metrics.get("market_data_health")
    if isinstance(health, dict):
        record["market_data_status"] = health.get("status")
        record["market_data_reason"] = health.get("reason")
        for source, target in (
            ("requested_symbol_count", "market_data_requested_symbol_count"),
            ("symbols_with_bars_count", "market_data_symbols_with_bars_count"),
            ("symbols_without_bars_count", "market_data_symbols_without_bars_count"),
            ("symbols_with_live_prices_count", "market_data_symbols_with_live_prices_count"),
            ("timeout_like_count", "market_data_timeout_like_count"),
            ("skipped_after_timeouts_count", "market_data_skipped_after_timeouts_count"),
        ):
            if source in health:
                record[target] = health.get(source)


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def parse_timestamp(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        parsed = parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def freshness_record(timestamp: Any, *, now: datetime, max_age_seconds: Any = None) -> dict[str, Any]:
    parsed = parse_timestamp(timestamp)
    age_seconds = None
    stale = False
    if parsed is not None:
        age_seconds = round(max(0.0, (now - parsed).total_seconds()), 3)
    max_age = None
    if max_age_seconds is not None:
        max_age = float(max_age_seconds)
        if age_seconds is None or age_seconds > max_age:
            stale = True
    return {
        "timestamp": str(timestamp) if timestamp else None,
        "age_seconds": age_seconds,
        "max_age_seconds": max_age,
        "stale": stale,
    }


def local_audit_hash_payload(payload: dict[str, Any]) -> str:
    normalized = {
        key: value
        for key, value in payload.items()
        if key not in {"prev_hash", "record_hash", "row_signature", "signature_algorithm", "signature_key_env"}
    }
    return json.dumps(normalized, sort_keys=True, separators=(",", ":"), default=str)


def local_audit_record_hash(payload: dict[str, Any]) -> str:
    return hashlib.sha256(local_audit_hash_payload(payload).encode("utf-8")).hexdigest()


def local_audit_signature_payload(payload: dict[str, Any]) -> str:
    result = payload.get("result") if isinstance(payload.get("result"), dict) else {}
    return json.dumps(
        {
            "record_hash": str(payload.get("record_hash") or ""),
            "hash_algorithm": str(payload.get("hash_algorithm") or ""),
            "prev_hash": str(payload.get("prev_hash") or ""),
            "audited_at": str(payload.get("audited_at") or ""),
            "event": str(payload.get("event") or ""),
            "action": str(result.get("action") or ""),
            "status": str(result.get("status") or ""),
            "command_id": str(result.get("command_id") or ""),
            "node_id": str(result.get("node_id") or ""),
        },
        sort_keys=True,
        separators=(",", ":"),
        default=str,
    )


def local_audit_signature(payload: dict[str, Any], signature_env: str) -> str:
    signing_material = os.getenv(signature_env)
    if not signing_material:
        return ""
    return hmac.new(
        signing_material.encode("utf-8"),
        local_audit_signature_payload(payload).encode("utf-8"),
        hashlib.sha256,
    ).hexdigest()


def verify_local_audit(path: Path, *, max_records: int = 5000, signature_env: str | None = None) -> dict[str, Any]:
    result: dict[str, Any] = {
        "status": "missing" if not path.exists() else "empty",
        "checked_records": 0,
        "legacy_records": 0,
        "invalid_records": 0,
        "total_records": 0,
        "latest_hash": "",
        "max_records": max_records,
        "truncated": False,
        "signature_status": "disabled" if not signature_env else ("missing_key" if not os.getenv(signature_env) else "empty"),
        "signed_records": 0,
        "unsigned_records": 0,
        "signature_key_env": signature_env or "",
        "errors": [],
    }
    if not path.exists():
        return result
    previous_hash = ""
    try:
        with path.open() as f:
            for line_no, line in enumerate(f, start=1):
                if result["total_records"] >= max_records:
                    result["truncated"] = True
                    break
                line = line.strip()
                if not line:
                    continue
                result["total_records"] += 1
                try:
                    row = json.loads(line)
                except json.JSONDecodeError as exc:
                    result["invalid_records"] += 1
                    if len(result["errors"]) < 10:
                        result["errors"].append({"line": line_no, "error": str(exc)})
                    continue
                if not isinstance(row, dict):
                    result["invalid_records"] += 1
                    if len(result["errors"]) < 10:
                        result["errors"].append({"line": line_no, "error": "audit row is not an object"})
                    continue
                record_hash = row.get("record_hash")
                if not record_hash:
                    result["legacy_records"] += 1
                    continue
                algorithm = str(row.get("hash_algorithm") or "")
                if algorithm and algorithm != "sha256":
                    if len(result["errors"]) < 10:
                        result["errors"].append({"line": line_no, "error": f"unsupported hash algorithm: {algorithm or 'missing'}"})
                if str(row.get("prev_hash") or "") != previous_hash:
                    if len(result["errors"]) < 10:
                        result["errors"].append({"line": line_no, "error": "prev_hash mismatch"})
                computed = local_audit_record_hash(row)
                if str(record_hash) != computed:
                    if len(result["errors"]) < 10:
                        result["errors"].append({"line": line_no, "error": "record_hash mismatch"})
                row_signature = str(row.get("row_signature") or "")
                if row_signature:
                    result["signed_records"] += 1
                    signature_algorithm = str(row.get("signature_algorithm") or "")
                    if signature_algorithm != "hmac-sha256" and len(result["errors"]) < 10:
                        result["errors"].append({"line": line_no, "error": f"unsupported signature algorithm: {signature_algorithm or 'missing'}"})
                    if signature_env and os.getenv(signature_env):
                        expected_signature = local_audit_signature(row, signature_env)
                        if not hmac.compare_digest(expected_signature, row_signature) and len(result["errors"]) < 10:
                            result["errors"].append({"line": line_no, "error": "row_signature mismatch"})
                elif signature_env:
                    result["unsigned_records"] += 1
                result["checked_records"] += 1
                previous_hash = str(record_hash)
                result["latest_hash"] = previous_hash
    except OSError as exc:
        result["status"] = "error"
        result["errors"].append({"line": None, "error": str(exc)})
        return result
    if result["errors"] or result["invalid_records"]:
        result["status"] = "broken"
    elif result["checked_records"]:
        result["status"] = "ok"
    elif result["legacy_records"]:
        result["status"] = "legacy"
    if not signature_env:
        result["signature_status"] = "disabled"
    elif not os.getenv(signature_env):
        result["signature_status"] = "missing_key"
    elif any("signature" in str(error.get("error", "")) for error in result["errors"]):
        result["signature_status"] = "bad"
    elif result["unsigned_records"]:
        result["signature_status"] = "warn"
    elif result["signed_records"]:
        result["signature_status"] = "ok"
    elif result["checked_records"]:
        result["signature_status"] = "empty"
    return result


def load_config(path: Path) -> dict[str, Any]:
    with path.open() as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config must be a YAML mapping: {path}")
    return data


def check_gateway(gateway_cfg: dict[str, Any]) -> dict[str, Any]:
    enabled = bool(gateway_cfg.get("enabled", False))
    host = str(gateway_cfg.get("host", "127.0.0.1"))
    port = int(gateway_cfg.get("port", 4002))
    timeout = float(gateway_cfg.get("timeout_seconds", 1.0))
    result = {
        "enabled": enabled,
        "host": host,
        "port": port,
        "reachable": None,
        "latency_ms": None,
        "error": None,
    }
    if not enabled:
        return result

    started = time.monotonic()
    try:
        with socket.create_connection((host, port), timeout=timeout):
            pass
        result["reachable"] = True
        result["latency_ms"] = round((time.monotonic() - started) * 1000, 3)
    except OSError as exc:
        result["reachable"] = False
        result["latency_ms"] = round((time.monotonic() - started) * 1000, 3)
        result["error"] = str(exc)
    return result


def gateway_alerts(gateway: dict[str, Any]) -> list[dict[str, str]]:
    if not gateway.get("enabled") or gateway.get("reachable") is not False:
        return []
    error = str(gateway.get("error") or "")
    error_lower = error.lower()
    alerts = [{
        "level": "warn",
        "kind": "gateway_unreachable",
        "message": f"Gateway TCP check failed at {gateway['host']}:{gateway['port']}",
    }]
    if any(token in error_lower for token in ("auth", "login", "log in", "not logged", "session")):
        alerts.append({
            "level": "warn",
            "kind": "gateway_login_required",
            "message": f"Gateway may require login or session attention at {gateway['host']}:{gateway['port']}",
        })
    else:
        alerts.append({
            "level": "warn",
            "kind": "gateway_api_disconnected",
            "message": f"Gateway API socket is not reachable at {gateway['host']}:{gateway['port']}",
        })
    return alerts


def summarize_configured_runs(runs_cfg: list[Any], *, now: datetime) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    runs = []
    alerts = []
    for index, entry in enumerate(runs_cfg, start=1):
        if isinstance(entry, str):
            run_id = Path(entry).name or f"run_{index}"
            run_path = Path(entry)
            max_age_seconds = None
            recent_events_cfg = None
        elif isinstance(entry, dict):
            run_path = Path(str(entry.get("path", "")))
            run_id = str(entry.get("id") or run_path.name or f"run_{index}")
            max_age_seconds = entry.get("max_age_seconds")
            recent_events_cfg = entry.get("recent_events")
        else:
            alerts.append({
                "level": "warn",
                "kind": "run_config",
                "message": f"runs[{index}] must be a path string or mapping",
            })
            continue

        record = {
            "id": run_id,
            "path": str(run_path),
            "exists": run_path.exists(),
            "status": "missing",
            "metrics": None,
            "recent_events": None,
            "artifact_evidence": None,
            "error": None,
        }
        if not run_path.exists():
            alerts.append({
                "level": "warn",
                "kind": "run_missing",
                "message": f"run_dir missing: {run_path}",
            })
            runs.append(record)
            continue
        try:
            record["artifact_evidence"] = summarize_artifact_evidence(run_path)
            record["metrics"] = summarize_run(run_path)
            record["status"] = "ok"
            metrics = record["metrics"] or {}
            attach_run_summary_fields(record, metrics)
            record["freshness"] = freshness_record(
                metrics.get("last_decision_time"),
                now=now,
                max_age_seconds=max_age_seconds,
            )
            if record["freshness"]["stale"]:
                alerts.append({
                    "level": "warn",
                    "kind": "run_stale",
                    "message": f"{run_id}: last decision is stale",
                })
            if isinstance(entry, dict):
                operational_extra, operational_alerts = run_operational_alerts(run_id, run_path, metrics, entry, now=now)
                record.update(operational_extra)
                alerts.extend(operational_alerts)
            recent_enabled, recent_max_rows, recent_error = parse_recent_events_config(recent_events_cfg)
            if recent_error is not None:
                alerts.append({
                    "level": "warn",
                    "kind": "run_recent_events_config",
                    "message": f"{run_id}: {recent_error}",
                })
            elif recent_enabled:
                try:
                    record["recent_events"] = summarize_recent_run_events(run_path, max_rows=recent_max_rows)
                except Exception as exc:
                    alerts.append({
                        "level": "warn",
                        "kind": "run_recent_events_error",
                        "message": f"{run_id}: {exc}",
                    })
        except Exception as exc:
            record["status"] = "error"
            record["error"] = str(exc)
            alerts.append({
                "level": "warn",
                "kind": "run_summary_error",
                "message": f"{run_path}: {exc}",
            })
        runs.append(record)
    return runs, alerts


def parse_recent_events_config(value: Any) -> tuple[bool, int, str | None]:
    if value is None or value is False:
        return False, 5, None
    if value is True:
        return True, 5, None
    if not isinstance(value, dict):
        return False, 5, "recent_events must be true/false or a mapping"
    enabled = bool(value.get("enabled", True))
    try:
        max_rows = int(value.get("max_rows", 5))
    except (TypeError, ValueError):
        return enabled, 5, "recent_events.max_rows must be an integer"
    if max_rows < 1 or max_rows > 50:
        return enabled, max_rows, "recent_events.max_rows must be between 1 and 50"
    return enabled, max_rows, None


def nonzero_position_count(positions: Any) -> int:
    if not isinstance(positions, dict):
        return 0
    count = 0
    for value in positions.values():
        try:
            quantity = float(value)
        except (TypeError, ValueError):
            continue
        if quantity != 0:
            count += 1
    return count


def classify_order_state(row: dict[str, Any]) -> str | None:
    status = str(row.get("status") or row.get("order_status") or "").strip().lower()
    reason = str(row.get("reason") or row.get("message") or row.get("error") or "").strip().lower()
    combined = f"{status} {reason}"
    if any(token in combined for token in ("auth", "login", "log in", "not logged", "session")):
        return "broker_login_required"
    if any(token in combined for token in ("api disconnected", "connection refused", "not connected", "socket", "gateway")):
        return "broker_api_disconnected"
    if "risk" in combined or "limit" in combined or "max_orders_per_run" in combined:
        return "risk_limit"
    if status in {"approval_required", "approval-required", "held", "pending_approval"}:
        return "approval_required"
    if status in {"inactive", "api_cancelled"}:
        return "inactive"
    if status in {"cancelled", "canceled"}:
        return "cancelled"
    if status in {"rejected", "reject"}:
        return "rejected"
    return None


def summarize_order_state_alerts(
    run_id: str,
    run_path: Path,
    *,
    max_rows: int = 100,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    rows = load_recent_jsonl(run_path / "orders.jsonl", max_rows=max_rows)
    category_counts: Counter[str] = Counter()
    status_counts: Counter[str] = Counter()
    latest_by_category: dict[str, dict[str, Any]] = {}
    for row in rows:
        status = str(row.get("status") or row.get("order_status") or "").strip().lower()
        if status:
            status_counts[status] += 1
        category = classify_order_state(row)
        if not category:
            continue
        category_counts[category] += 1
        latest_by_category[category] = {
            "timestamp": row.get("timestamp"),
            "symbol": row.get("symbol"),
            "status": row.get("status") or row.get("order_status"),
            "reason": row.get("reason") or row.get("message") or row.get("error"),
        }
    extra = {
        "order_state": {
            "checked_recent_rows": len(rows),
            "status_counts": dict(sorted(status_counts.items())),
            "category_counts": dict(sorted(category_counts.items())),
            "latest_by_category": {
                category: latest_by_category[category]
                for category in sorted(latest_by_category)
            },
        }
    }
    alerts = [
        {
            "level": "warn",
            "kind": f"order_state_{category}",
            "category": category,
            "message": (
                f"{run_id}: {count} {ORDER_STATE_CATEGORY_LABELS.get(category, category)} "
                f"in the last {len(rows)} order event{'' if len(rows) == 1 else 's'}"
            ),
        }
        for category, count in sorted(category_counts.items())
    ]
    return extra, alerts


def alert_on_timestamp_age(
    alerts: list[dict[str, str]],
    *,
    run_id: str,
    metrics: dict[str, Any],
    metric_key: str,
    max_age_seconds: Any,
    alert_kind: str,
    label: str,
    now: datetime,
) -> dict[str, Any] | None:
    if max_age_seconds is None:
        return None
    freshness = freshness_record(metrics.get(metric_key), now=now, max_age_seconds=max_age_seconds)
    if freshness["stale"]:
        alerts.append({
            "level": "warn",
            "kind": alert_kind,
            "message": f"{run_id}: {label} is stale",
        })
    return freshness


def run_operational_alerts(
    run_id: str,
    run_path: Path,
    metrics: dict[str, Any],
    config: dict[str, Any],
    *,
    now: datetime,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    alerts: list[dict[str, str]] = []
    extra: dict[str, Any] = {}
    data_freshness = alert_on_timestamp_age(
        alerts,
        run_id=run_id,
        metrics=metrics,
        metric_key="latest_data_time",
        max_age_seconds=config.get("max_data_age_seconds"),
        alert_kind="stale_bars",
        label="latest market-data timestamp",
        now=now,
    )
    if data_freshness is not None:
        extra["data_freshness"] = data_freshness
    market_data_health = metrics.get("market_data_health")
    if isinstance(market_data_health, dict) and market_data_health:
        extra["market_data_health"] = market_data_health
        health_status = str(market_data_health.get("status") or "").lower()
        if health_status in {"bad", "error"}:
            alerts.append({
                "level": "warn",
                "kind": "market_data_health_bad",
                "message": f"{run_id}: market data health is {health_status} ({market_data_health.get('reason') or 'unknown'})",
            })
        elif health_status == "warn":
            alerts.append({
                "level": "warn",
                "kind": "market_data_health_warn",
                "message": f"{run_id}: market data health warning ({market_data_health.get('reason') or 'unknown'})",
            })
    account_freshness = alert_on_timestamp_age(
        alerts,
        run_id=run_id,
        metrics=metrics,
        metric_key="account_end_time",
        max_age_seconds=config.get("max_account_age_seconds"),
        alert_kind="stale_account_snapshot",
        label="latest account snapshot",
        now=now,
    )
    if account_freshness is not None:
        extra["account_freshness"] = account_freshness

    try:
        max_order_state_rows = int(config.get("max_order_state_rows", 100))
    except (TypeError, ValueError):
        max_order_state_rows = 100
        alerts.append({
            "level": "warn",
            "kind": "run_order_state_config",
            "message": f"{run_id}: max_order_state_rows must be an integer",
        })
    if max_order_state_rows < 1 or max_order_state_rows > 500:
        alerts.append({
            "level": "warn",
            "kind": "run_order_state_config",
            "message": f"{run_id}: max_order_state_rows must be between 1 and 500",
        })
        max_order_state_rows = min(500, max(1, max_order_state_rows))
    try:
        order_state_extra, order_state_alerts = summarize_order_state_alerts(
            run_id,
            run_path,
            max_rows=max_order_state_rows,
        )
        extra.update(order_state_extra)
        alerts.extend(order_state_alerts)
    except Exception as exc:
        alerts.append({
            "level": "warn",
            "kind": "run_order_state_error",
            "message": f"{run_id}: {exc}",
        })

    rejections = int(metrics.get("rejections") or 0)
    if rejections > 0:
        alerts.append({
            "level": "warn",
            "kind": "rejected_orders",
            "message": f"{run_id}: {rejections} rejected order event{'' if rejections == 1 else 's'}",
        })

    rejection_reasons = metrics.get("rejection_reasons") or {}
    risk_reason_count = 0
    if isinstance(rejection_reasons, dict):
        for reason, count in rejection_reasons.items():
            if "risk" in str(reason).lower() or "limit" in str(reason).lower():
                risk_reason_count += int(count or 0)
    risk_limit_trips = int(metrics.get("risk_limit_trips") or metrics.get("risk_limit_rejections") or risk_reason_count or 0)
    if risk_limit_trips > 0:
        alerts.append({
            "level": "warn",
            "kind": "risk_limit_trip",
            "message": f"{run_id}: {risk_limit_trips} risk-limit trip{'' if risk_limit_trips == 1 else 's'}",
        })

    expected_state = str(config.get("expected_position_state") or "any").strip().lower()
    position_count = nonzero_position_count(metrics.get("final_positions"))
    if expected_state in {"flat", "positioned"}:
        extra["expected_position_state"] = expected_state
        extra["position_count"] = position_count
    if expected_state == "flat" and position_count:
        alerts.append({
            "level": "warn",
            "kind": "unexpected_positioned_state",
            "message": f"{run_id}: expected flat but has {position_count} open position{'' if position_count == 1 else 's'}",
        })
    elif expected_state == "positioned" and not position_count:
        alerts.append({
            "level": "warn",
            "kind": "unexpected_flat_state",
            "message": f"{run_id}: expected a position but is flat",
        })
    elif expected_state not in {"any", "flat", "positioned"}:
        alerts.append({
            "level": "warn",
            "kind": "run_position_expectation_config",
            "message": f"{run_id}: expected_position_state must be any, flat, or positioned",
        })
    return extra, alerts


def summarize_configured_supervisors(supervisors_cfg: list[Any], *, now: datetime) -> tuple[list[dict[str, Any]], list[dict[str, str]]]:
    supervisors = []
    alerts = []
    for index, entry in enumerate(supervisors_cfg, start=1):
        if isinstance(entry, str):
            supervisor_id = Path(entry).stem or f"supervisor_{index}"
            state_path = Path(entry)
            max_age_seconds = None
        elif isinstance(entry, dict):
            state_path = Path(str(entry.get("path", "")))
            supervisor_id = str(entry.get("id") or state_path.stem or f"supervisor_{index}")
            max_age_seconds = entry.get("max_age_seconds")
        else:
            alerts.append({
                "level": "warn",
                "kind": "supervisor_config",
                "message": f"supervisors[{index}] must be a path string or mapping",
            })
            continue

        record: dict[str, Any] = {
            "id": supervisor_id,
            "path": str(state_path),
            "exists": state_path.exists(),
            "status": "missing",
            "generated_at": None,
            "jobs": [],
            "job_status_counts": {},
            "error": None,
        }
        if not state_path.exists():
            alerts.append({
                "level": "warn",
                "kind": "supervisor_missing",
                "message": f"supervisor state missing: {state_path}",
            })
            supervisors.append(record)
            continue
        try:
            with state_path.open() as f:
                payload = json.load(f)
            if not isinstance(payload, dict):
                raise ValueError("state file must contain a JSON object")
            jobs = payload.get("jobs") or []
            if not isinstance(jobs, list):
                jobs = []
            statuses = Counter(str(job.get("status", "")) for job in jobs if isinstance(job, dict))
            published_status_counts = payload.get("job_status_counts")
            if isinstance(published_status_counts, dict):
                statuses.update({
                    str(key): int(value or 0)
                    for key, value in published_status_counts.items()
                    if key and str(key) not in statuses
                })
            active_children = payload.get("active_children") or []
            if not isinstance(active_children, list):
                active_children = []
            record.update({
                "status": str(payload.get("status") or "ok"),
                "generated_at": payload.get("generated_at"),
                "jobs": jobs,
                "active_children": active_children,
                "active_child_count": len(active_children),
                "job_status_counts": dict(sorted(statuses.items())),
                "freshness": freshness_record(
                    payload.get("generated_at"),
                    now=now,
                    max_age_seconds=max_age_seconds,
                ),
            })
            if record["freshness"]["stale"]:
                alerts.append({
                    "level": "warn",
                    "kind": "supervisor_stale",
                    "message": f"{supervisor_id}: supervisor state is stale",
                })
            if record["status"] != "ok":
                alerts.append({
                    "level": "warn",
                    "kind": "supervisor_status",
                    "message": f"{supervisor_id}: status={record['status']}",
                })
            for job in jobs:
                if not isinstance(job, dict):
                    continue
                job_id = str(job.get("id") or "job")
                job_status = str(job.get("status") or "")
                if job_status == "missed" or job.get("missed_window") is True:
                    alerts.append({
                        "level": "warn",
                        "kind": "supervisor_job_missed_window",
                        "message": f"{supervisor_id}: {job_id} missed its start window",
                    })
                elif job_status == "not_running" and job.get("enabled") is True:
                    alerts.append({
                        "level": "warn",
                        "kind": "supervisor_job_not_running",
                        "message": f"{supervisor_id}: {job_id} is enabled but not running",
                    })
        except Exception as exc:
            record["status"] = "error"
            record["error"] = str(exc)
            alerts.append({
                "level": "warn",
                "kind": "supervisor_summary_error",
                "message": f"{state_path}: {exc}",
            })
        supervisors.append(record)
    return supervisors, alerts


def summarize_runtime_activity(runs: list[dict[str, Any]], supervisors: list[dict[str, Any]], *, now: datetime) -> dict[str, Any]:
    jobs: list[dict[str, Any]] = []
    active_children: list[dict[str, Any]] = []
    for supervisor in supervisors:
        if not isinstance(supervisor, dict):
            continue
        for job in supervisor.get("jobs") or []:
            if isinstance(job, dict):
                row = dict(job)
                row["supervisor_id"] = supervisor.get("id")
                jobs.append(row)
        for child in supervisor.get("active_children") or []:
            if isinstance(child, dict):
                row = dict(child)
                row["supervisor_id"] = supervisor.get("id")
                active_children.append(row)
    running_jobs = [job for job in jobs if str(job.get("status") or "").lower() == "running"]
    due_jobs = [job for job in jobs if str(job.get("status") or "").lower() == "due"]
    missed_jobs = [
        job for job in jobs
        if str(job.get("status") or "").lower() == "missed" or job.get("missed_window") is True
    ]
    waiting_jobs = [job for job in jobs if str(job.get("status") or "").lower() == "waiting"]
    completed_jobs = [job for job in jobs if str(job.get("status") or "").lower() in {"completed", "completed_or_exited"}]
    stale_runs = [run for run in runs if isinstance(run, dict) and (run.get("freshness") or {}).get("stale")]
    fresh_runs = [run for run in runs if isinstance(run, dict) and run.get("exists") is not False and not (run.get("freshness") or {}).get("stale")]
    next_jobs = sorted(
        [job for job in jobs if job.get("next_start_at")],
        key=lambda item: str(item.get("next_start_at") or ""),
    )
    if active_children or running_jobs:
        status = "running"
        reason = "active_children"
    elif due_jobs:
        status = "due"
        reason = "jobs_due"
    elif missed_jobs:
        status = "warn"
        reason = "missed_windows"
    elif fresh_runs:
        status = "publishing"
        reason = "fresh_run_telemetry"
    elif stale_runs:
        status = "stale"
        reason = "stale_run_telemetry"
    elif waiting_jobs or next_jobs:
        status = "idle"
        reason = "waiting_for_next_window"
    else:
        status = "unknown"
        reason = "no_activity_evidence"
    label = {
        "running": "Running",
        "due": "Due",
        "warn": "Missed Window",
        "publishing": "Publishing",
        "stale": "Telemetry Stale",
        "idle": "Idle",
        "unknown": "Unknown",
    }.get(status, status.title())
    return {
        "schema_version": 1,
        "generated_at": now.isoformat(),
        "status": status,
        "label": label,
        "reason": reason,
        "active_child_count": len(active_children),
        "running_job_count": len(running_jobs),
        "due_job_count": len(due_jobs),
        "missed_job_count": len(missed_jobs),
        "waiting_job_count": len(waiting_jobs),
        "completed_job_count": len(completed_jobs),
        "fresh_run_count": len(fresh_runs),
        "stale_run_count": len(stale_runs),
        "next_start_at": next_jobs[0].get("next_start_at") if next_jobs else None,
        "next_job_id": next_jobs[0].get("id") if next_jobs else None,
        "running_jobs": [
            {
                "id": job.get("id"),
                "label": job.get("label"),
                "supervisor_id": job.get("supervisor_id"),
                "reason": job.get("reason"),
            }
            for job in running_jobs[:10]
        ],
        "active_children": [
            {
                "id": child.get("id"),
                "status": child.get("status"),
                "pid": child.get("pid"),
                "supervisor_id": child.get("supervisor_id"),
                "runtime_seconds": child.get("runtime_seconds"),
            }
            for child in active_children[:10]
        ],
        "missed_jobs": [
            {
                "id": job.get("id"),
                "label": job.get("label"),
                "supervisor_id": job.get("supervisor_id"),
                "reason": job.get("reason"),
                "next_start_at": job.get("next_start_at"),
            }
            for job in missed_jobs[:10]
        ],
    }


def load_recent_jsonl(path: Path, *, max_rows: int) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    rows = []
    with path.open() as f:
        lines = [line for line in f if line.strip()]
    for lineno, line in enumerate(lines[-max_rows:], start=max(1, len(lines) - max_rows + 1)):
        data = json.loads(line)
        if not isinstance(data, dict):
            raise ValueError(f"{path}:{lineno} must contain a JSON object")
        rows.append(data)
    return rows


def count_nonempty_lines(path: Path) -> int | None:
    try:
        with path.open("rb") as f:
            return sum(1 for line in f if line.strip())
    except OSError:
        return None


def summarize_artifact_evidence(run_path: Path) -> dict[str, Any]:
    files: list[dict[str, Any]] = []
    existing_count = 0
    total_bytes = 0
    jsonl_row_count = 0
    metadata_file_count = 0
    event_stream_count = 0
    missing_files = []
    category_counts: dict[str, int] = {}
    latest_modified_at = None
    for name in RUN_ARTIFACT_FILES:
        path = run_path / name
        exists = path.exists() and path.is_file()
        category = artifact_file_category(name)
        row: dict[str, Any] = {
            "name": name,
            "category": category,
            "exists": exists,
            "bytes": 0,
            "modified_at": None,
        }
        if exists:
            stat = path.stat()
            row["bytes"] = stat.st_size
            row["modified_at"] = datetime.fromtimestamp(stat.st_mtime, timezone.utc).isoformat()
            existing_count += 1
            total_bytes += stat.st_size
            category_counts[category] = category_counts.get(category, 0) + 1
            if name in RUN_ARTIFACT_JSONL_FILES:
                event_stream_count += 1
            else:
                metadata_file_count += 1
            if latest_modified_at is None or str(row["modified_at"]) > latest_modified_at:
                latest_modified_at = str(row["modified_at"])
            if name in RUN_ARTIFACT_JSONL_FILES:
                line_count = count_nonempty_lines(path)
                row["row_count"] = line_count
                if line_count is not None:
                    jsonl_row_count += line_count
        elif name in RUN_ARTIFACT_JSONL_FILES:
            row["row_count"] = 0
        if not exists:
            missing_files.append(name)
        files.append(row)
    return {
        "schema_version": 2,
        "available": bool(run_path.exists() and run_path.is_dir()),
        "expected_count": len(RUN_ARTIFACT_FILES),
        "existing_count": existing_count,
        "missing_count": len(RUN_ARTIFACT_FILES) - existing_count,
        "total_bytes": total_bytes,
        "jsonl_row_count": jsonl_row_count,
        "metadata_file_count": metadata_file_count,
        "event_stream_count": event_stream_count,
        "missing_files": missing_files[:25],
        "category_counts": category_counts,
        "latest_modified_at": latest_modified_at,
        "files": files,
    }


def summarize_remote_control(remote_cfg: dict[str, Any], *, now: datetime) -> tuple[dict[str, Any], list[dict[str, str]]]:
    alerts = []
    audit_cfg = remote_cfg.get("audit") or {}
    enabled = bool(remote_cfg.get("enabled", bool(audit_cfg)))
    log_path = Path(str(audit_cfg.get("log_file") or "paper_logs/remote_control/audit.jsonl"))
    max_events = int(audit_cfg.get("max_events", 50))
    if max_events <= 0:
        max_events = 50
    max_integrity_records = int(audit_cfg.get("max_integrity_records", 5000))
    if max_integrity_records <= 0:
        max_integrity_records = 5000
    max_age_seconds = audit_cfg.get("max_age_seconds")
    signature_env = str(audit_cfg.get("signature_env") or "").strip() or None
    integrity = verify_local_audit(log_path, max_records=max_integrity_records, signature_env=signature_env)
    record: dict[str, Any] = {
        "enabled": enabled,
        "audit_log": str(log_path),
        "audit_exists": log_path.exists(),
        "integrity": integrity,
        "event_counts": {},
        "result_status_counts": {},
        "post_status_counts": {},
        "latest_event": None,
        "recent_events": [],
        "freshness": freshness_record(None, now=now, max_age_seconds=max_age_seconds),
        "error": None,
    }
    if not enabled:
        return record, alerts
    if integrity.get("status") == "broken":
        alerts.append({
            "level": "warn",
            "kind": "remote_control_audit_integrity",
            "message": "local remote-control audit hash chain is broken or unreadable",
        })
    if integrity.get("signature_status") in {"bad", "missing_key"}:
        alerts.append({
            "level": "warn",
            "kind": "remote_control_audit_signature",
            "message": f"local remote-control audit signature status is {integrity.get('signature_status')}",
        })
    if not log_path.exists():
        return record, alerts
    try:
        rows = load_recent_jsonl(log_path, max_rows=max_events)
        event_counts = Counter(str(row.get("event", "")) for row in rows if row.get("event"))
        result_status_counts = Counter(
            str((row.get("result") or {}).get("status", ""))
            for row in rows
            if isinstance(row.get("result"), dict) and (row.get("result") or {}).get("status")
        )
        post_status_counts = Counter(
            str(((row.get("result") or {}).get("post_result") or {}).get("status", ""))
            for row in rows
            if isinstance(row.get("result"), dict)
            and isinstance((row.get("result") or {}).get("post_result"), dict)
            and ((row.get("result") or {}).get("post_result") or {}).get("status")
        )
        record.update({
            "event_counts": dict(sorted(event_counts.items())),
            "result_status_counts": dict(sorted(result_status_counts.items())),
            "post_status_counts": dict(sorted(post_status_counts.items())),
            "latest_event": rows[-1] if rows else None,
            "recent_events": rows,
        })
        latest = rows[-1] if rows else {}
        latest_result = latest.get("result") if isinstance(latest, dict) else {}
        latest_post = (latest_result or {}).get("post_result") if isinstance(latest_result, dict) else {}
        record["freshness"] = freshness_record(
            latest.get("audited_at") or (latest_result or {}).get("executed_at"),
            now=now,
            max_age_seconds=max_age_seconds,
        )
        if record["freshness"]["stale"]:
            alerts.append({
                "level": "warn",
                "kind": "remote_control_audit_stale",
                "message": "latest remote-control audit event is stale",
            })
        if latest.get("event") == "poll_failed":
            alerts.append({
                "level": "warn",
                "kind": "remote_control_poll_failed",
                "message": str((latest_result or {}).get("error") or "latest command poll failed"),
            })
        elif isinstance(latest_post, dict) and latest_post.get("status") == "failed":
            alerts.append({
                "level": "warn",
                "kind": "remote_control_post_failed",
                "message": str(latest_post.get("error") or "latest command result post failed"),
            })
        elif isinstance(latest_result, dict) and latest_result.get("status") in {"failed", "rejected"}:
            alerts.append({
                "level": "warn",
                "kind": "remote_control_command_status",
                "message": f"latest command status={latest_result.get('status')}",
            })
    except Exception as exc:
        record["error"] = str(exc)
        alerts.append({
            "level": "warn",
            "kind": "remote_control_audit_error",
            "message": f"{log_path}: {exc}",
        })
    return record, alerts


def collect_status(config: dict[str, Any]) -> dict[str, Any]:
    now = datetime.now(timezone.utc)
    alerts: list[dict[str, str]] = []
    gateway = check_gateway(config.get("gateway") or {})
    alerts.extend(gateway_alerts(gateway))

    runs_cfg = config.get("runs") or []
    if not isinstance(runs_cfg, list):
        runs_cfg = []
        alerts.append({
            "level": "warn",
            "kind": "run_config",
            "message": "runs must be a list",
        })
    runs, run_alerts = summarize_configured_runs(runs_cfg, now=now)
    alerts.extend(run_alerts)

    supervisors_cfg = config.get("supervisors") or []
    if not isinstance(supervisors_cfg, list):
        supervisors_cfg = []
        alerts.append({
            "level": "warn",
            "kind": "supervisor_config",
            "message": "supervisors must be a list",
        })
    supervisors, supervisor_alerts = summarize_configured_supervisors(supervisors_cfg, now=now)
    alerts.extend(supervisor_alerts)
    runtime_activity = summarize_runtime_activity(runs, supervisors, now=now)

    remote_cfg = config.get("remote_control") or {}
    if not isinstance(remote_cfg, dict):
        remote_cfg = {}
        alerts.append({
            "level": "warn",
            "kind": "remote_control_config",
            "message": "remote_control must be a mapping",
        })
    remote_control, remote_alerts = summarize_remote_control(remote_cfg, now=now)
    alerts.extend(remote_alerts)

    status = "ok" if not alerts else "warn"
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now.isoformat(),
        "node_id": str(config.get("node_id") or "local-trader"),
        "status": status,
        "gateway": gateway,
        "runs": runs,
        "supervisors": supervisors,
        "runtime_activity": runtime_activity,
        "remote_control": remote_control,
        "alerts": alerts,
    }


def write_status_file(path: Path, payload: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        json.dump(payload, f, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def post_status(
    endpoint: str,
    payload: dict[str, Any],
    *,
    token_env: str | None = None,
    timeout: float = 5.0,
    retry_attempts: int = 2,
    retry_delay_seconds: float = 0.5,
) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if token_env:
        bearer_value = os.getenv(token_env)
        if bearer_value:
            headers["Authorization"] = f"Bearer {bearer_value}"
    body = json.dumps(payload, sort_keys=True).encode("utf-8")
    attempts = max(0, int(retry_attempts)) + 1
    delay = max(0.0, float(retry_delay_seconds))
    last_error: Exception | None = None
    for attempt in range(attempts):
        req = request.Request(endpoint, data=body, headers=headers, method="POST")
        try:
            with request.urlopen(req, timeout=timeout) as resp:
                raw = resp.read().decode("utf-8")
                return {
                    "status_code": resp.status,
                    "body": raw,
                    "attempts": attempt + 1,
                }
        except error.HTTPError:
            raise
        except (error.URLError, TimeoutError, OSError) as exc:
            last_error = exc
            if attempt + 1 >= attempts:
                break
            if delay:
                time.sleep(delay * (attempt + 1))
    assert last_error is not None
    raise last_error


def publish_status(
    config: dict[str, Any],
    *,
    out_file: Path | None = None,
    endpoint: str | None = None,
    token_env: str | None = None,
) -> dict[str, Any]:
    payload = collect_status(config)
    publish_cfg = config.get("publish") or {}

    file_path = out_file
    if file_path is None and publish_cfg.get("file"):
        file_path = Path(str(publish_cfg["file"]))
    if file_path is not None:
        write_status_file(file_path, payload)

    endpoint_value = endpoint if endpoint is not None else publish_cfg.get("endpoint")
    if endpoint_value:
        payload["publish_result"] = post_status(
            str(endpoint_value),
            payload,
            token_env=token_env if token_env is not None else publish_cfg.get("token_env"),
            timeout=float(publish_cfg.get("timeout_seconds", 5.0)),
            retry_attempts=int(publish_cfg.get("retry_attempts", 2)),
            retry_delay_seconds=float(publish_cfg.get("retry_delay_seconds", 0.5)),
        )
    return payload


def main() -> None:
    parser = argparse.ArgumentParser(description="Publish read-only runner telemetry")
    parser.add_argument("--config", type=Path, default=Path("config/cloud_status.example.yaml"))
    parser.add_argument("--out", type=Path, default=None, help="Override publish.file")
    parser.add_argument("--endpoint", default=None, help="Override publish.endpoint")
    parser.add_argument("--token-env", default=None, help="Override publish.token_env")
    parser.add_argument("--json", action="store_true", help="Print telemetry JSON to stdout")
    args = parser.parse_args()

    config = load_config(args.config)
    payload = publish_status(config, out_file=args.out, endpoint=args.endpoint, token_env=args.token_env)
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))


if __name__ == "__main__":
    main()
