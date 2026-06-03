#!/usr/bin/env python3
"""Collect and publish read-only runner telemetry.

This script is public-safe by design: it reads generic plugin-run artifacts,
optionally checks Gateway TCP reachability, and writes/posts a JSON snapshot.
It does not read broker credentials and it does not execute commands.
"""

from __future__ import annotations

import argparse
import json
import os
import socket
import sys
import time
from collections import Counter
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import request

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from scripts.summarize_plugin_run import summarize_recent_run_events, summarize_run


SCHEMA_VERSION = 1


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
            record["metrics"] = summarize_run(run_path)
            record["status"] = "ok"
            record["freshness"] = freshness_record(
                (record["metrics"] or {}).get("last_decision_time"),
                now=now,
                max_age_seconds=max_age_seconds,
            )
            if record["freshness"]["stale"]:
                alerts.append({
                    "level": "warn",
                    "kind": "run_stale",
                    "message": f"{run_id}: last decision is stale",
                })
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
            record.update({
                "status": str(payload.get("status") or "ok"),
                "generated_at": payload.get("generated_at"),
                "jobs": jobs,
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


def summarize_remote_control(remote_cfg: dict[str, Any], *, now: datetime) -> tuple[dict[str, Any], list[dict[str, str]]]:
    alerts = []
    audit_cfg = remote_cfg.get("audit") or {}
    enabled = bool(remote_cfg.get("enabled", bool(audit_cfg)))
    log_path = Path(str(audit_cfg.get("log_file") or "paper_logs/remote_control/audit.jsonl"))
    max_events = int(audit_cfg.get("max_events", 50))
    if max_events <= 0:
        max_events = 50
    max_age_seconds = audit_cfg.get("max_age_seconds")
    record: dict[str, Any] = {
        "enabled": enabled,
        "audit_log": str(log_path),
        "audit_exists": log_path.exists(),
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
    if gateway["enabled"] and gateway["reachable"] is False:
        alerts.append({
            "level": "warn",
            "kind": "gateway_unreachable",
            "message": f"Gateway TCP check failed at {gateway['host']}:{gateway['port']}",
        })

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


def post_status(endpoint: str, payload: dict[str, Any], *, token_env: str | None = None, timeout: float = 5.0) -> dict[str, Any]:
    headers = {"Content-Type": "application/json"}
    if token_env:
        bearer_value = os.getenv(token_env)
        if bearer_value:
            headers["Authorization"] = f"Bearer {bearer_value}"
    body = json.dumps(payload, sort_keys=True).encode("utf-8")
    req = request.Request(endpoint, data=body, headers=headers, method="POST")
    with request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
        return {
            "status_code": resp.status,
            "body": raw,
        }


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
