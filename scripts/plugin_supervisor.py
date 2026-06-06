#!/usr/bin/env python3
"""Generic local supervisor for public strategy-plugin runner jobs.

The supervisor is intentionally strategy-neutral. It launches configured local
commands on a simple interval schedule, records job state, and respects pause
marker files. It does not poll remote commands, read broker credentials, or use
shell command strings.
"""

from __future__ import annotations

import argparse
import json
import os
import re
import subprocess
import sys
import time
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from framework.market_calendar import market_closed_reason


SCHEMA_VERSION = 1
VALID_MARKETS = {"always", "us_stocks"}
VALID_PROCESS_MODES = {"blocking", "managed"}
MANAGED_PROCESSES: dict[str, subprocess.Popen] = {}
RESTARTABLE_EXIT_REASONS = {"completed", "nonzero_exit", "pid_not_running_returncode_unknown"}


class SupervisorConfigError(ValueError):
    def __init__(self, errors: list[str]):
        self.errors = errors
        super().__init__("Invalid supervisor config:\n" + "\n".join(f"- {err}" for err in errors))


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_now() -> str:
    return utc_now().isoformat()


def parse_dt(value: Any) -> datetime | None:
    if not value:
        return None
    try:
        parsed = datetime.fromisoformat(str(value).replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return parsed.replace(tzinfo=timezone.utc)
    return parsed.astimezone(timezone.utc)


def load_config(path: Path) -> dict[str, Any]:
    with path.open() as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config must be a YAML mapping: {path}")
    return data


def load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {}
    with path.open() as f:
        data = json.load(f)
    return data if isinstance(data, dict) else {}


def write_state(path: Path, state: dict[str, Any]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    tmp = path.with_suffix(path.suffix + ".tmp")
    with tmp.open("w") as f:
        json.dump(state, f, indent=2, sort_keys=True)
        f.write("\n")
    tmp.replace(path)


def slug(value: str) -> str:
    return re.sub(r"[^A-Za-z0-9_.-]+", "_", value).strip("_") or "job"


def section(config: dict[str, Any], name: str, errors: list[str]) -> dict[str, Any]:
    raw = config.get(name) or {}
    if not isinstance(raw, dict):
        errors.append(f"{name} must be a mapping")
        return {}
    return raw


def positive_number(value: Any, field: str, errors: list[str], *, integer: bool = False) -> None:
    if value is None:
        return
    try:
        number = int(value) if integer else float(value)
    except (TypeError, ValueError):
        errors.append(f"{field} must be numeric")
        return
    if number <= 0:
        errors.append(f"{field} must be > 0")
    if integer and str(value).strip() not in {str(number), f"{number}.0"} and not isinstance(value, int):
        errors.append(f"{field} must be an integer")


def validate_bool(value: Any, field: str, errors: list[str]) -> None:
    if value is not None and not isinstance(value, bool):
        errors.append(f"{field} must be true or false")


def validate_config(config: dict[str, Any], *, check_paths: bool = True) -> list[str]:
    errors: list[str] = []
    supervisor = section(config, "supervisor", errors)
    jobs = config.get("jobs")
    positive_number(supervisor.get("poll_seconds", 30), "supervisor.poll_seconds", errors)
    if supervisor.get("state_file") is not None and not str(supervisor["state_file"]).strip():
        errors.append("supervisor.state_file must not be empty")
    if supervisor.get("log_dir") is not None and not str(supervisor["log_dir"]).strip():
        errors.append("supervisor.log_dir must not be empty")

    if not isinstance(jobs, list) or not jobs:
        errors.append("jobs must be a non-empty list")
        return errors

    seen_ids: set[str] = set()
    for index, raw_job in enumerate(jobs, start=1):
        prefix = f"jobs[{index}]"
        if not isinstance(raw_job, dict):
            errors.append(f"{prefix} must be a mapping")
            continue
        job_id = str(raw_job.get("id") or "").strip()
        if not job_id:
            errors.append(f"{prefix}.id is required")
        elif job_id in seen_ids:
            errors.append(f"{prefix}.id is duplicated: {job_id}")
        seen_ids.add(job_id)

        command = raw_job.get("command")
        if not isinstance(command, list) or not command:
            errors.append(f"{prefix}.command must be a non-empty list")
        elif not all(isinstance(part, str) and part.strip() for part in command):
            errors.append(f"{prefix}.command entries must be non-empty strings")

        cwd = raw_job.get("cwd", ".")
        if not str(cwd).strip():
            errors.append(f"{prefix}.cwd must not be empty")
        elif check_paths and not Path(str(cwd)).exists():
            errors.append(f"{prefix}.cwd does not exist: {cwd}")
        if raw_job.get("pause_marker") is not None and not str(raw_job["pause_marker"]).strip():
            errors.append(f"{prefix}.pause_marker must not be empty")
        if raw_job.get("run_dir") is not None and not str(raw_job["run_dir"]).strip():
            errors.append(f"{prefix}.run_dir must not be empty")
        process_mode = str(raw_job.get("process_mode", "blocking"))
        if process_mode not in VALID_PROCESS_MODES:
            errors.append(f"{prefix}.process_mode must be one of {sorted(VALID_PROCESS_MODES)}")
        restart = raw_job.get("restart") or {}
        if not isinstance(restart, dict):
            errors.append(f"{prefix}.restart must be a mapping")
            restart = {}
        validate_bool(restart.get("on_exit"), f"{prefix}.restart.on_exit", errors)
        validate_bool(restart.get("on_stale_runner_status"), f"{prefix}.restart.on_stale_runner_status", errors)
        if restart.get("runner_status_path") is not None and not str(restart["runner_status_path"]).strip():
            errors.append(f"{prefix}.restart.runner_status_path must not be empty")
        if restart.get("on_stale_runner_status") and not restart.get("runner_status_path"):
            errors.append(f"{prefix}.restart.runner_status_path is required when on_stale_runner_status is true")
        positive_number(restart.get("max_status_age_seconds"), f"{prefix}.restart.max_status_age_seconds", errors)
        positive_number(restart.get("stop_grace_seconds"), f"{prefix}.restart.stop_grace_seconds", errors)
        positive_number(restart.get("max_restarts_per_hour"), f"{prefix}.restart.max_restarts_per_hour", errors, integer=True)

        schedule = raw_job.get("schedule") or {}
        if not isinstance(schedule, dict):
            errors.append(f"{prefix}.schedule must be a mapping")
            schedule = {}
        positive_number(schedule.get("interval_seconds"), f"{prefix}.schedule.interval_seconds", errors)
        positive_number(schedule.get("max_runtime_seconds"), f"{prefix}.schedule.max_runtime_seconds", errors)
        market = str(schedule.get("market", "always"))
        if market not in VALID_MARKETS:
            errors.append(f"{prefix}.schedule.market must be one of {sorted(VALID_MARKETS)}")
        run_on_start = schedule.get("run_on_start")
        if run_on_start is not None and not isinstance(run_on_start, bool):
            errors.append(f"{prefix}.schedule.run_on_start must be true or false")
    return errors


def validate_config_file(path: Path) -> dict[str, Any]:
    config = load_config(path)
    errors = validate_config(config)
    if errors:
        raise SupervisorConfigError(errors)
    return config


def previous_jobs(state: dict[str, Any]) -> dict[str, dict[str, Any]]:
    jobs = state.get("jobs") or []
    if not isinstance(jobs, list):
        return {}
    return {
        str(job.get("id")): job
        for job in jobs
        if isinstance(job, dict) and job.get("id")
    }


def market_allows_run(schedule: dict[str, Any], now: datetime) -> tuple[bool, str | None]:
    market = str(schedule.get("market", "always"))
    if market == "always":
        return True, None
    if market == "us_stocks":
        reason = market_closed_reason(now.date())
        if reason:
            return False, reason
        return True, None
    return False, f"unsupported market: {market}"


def job_due(job: dict[str, Any], previous: dict[str, Any] | None, now: datetime) -> tuple[bool, str]:
    if not bool(job.get("enabled", True)):
        return False, "disabled"
    schedule = job.get("schedule") or {}
    allowed, reason = market_allows_run(schedule, now)
    if not allowed:
        return False, f"market_closed: {reason}"

    last_started = parse_dt((previous or {}).get("last_started_at"))
    run_on_start = bool(schedule.get("run_on_start", True))
    if last_started is None:
        return run_on_start, "run_on_start" if run_on_start else "not_due"

    interval = schedule.get("interval_seconds")
    if interval is None:
        return False, "no_interval"
    next_run = last_started + timedelta(seconds=float(interval))
    if now >= next_run:
        return True, "interval_elapsed"
    return False, "not_due"


def status_from_previous(job: dict[str, Any], previous: dict[str, Any] | None, now: datetime, reason: str) -> dict[str, Any]:
    status = dict(previous or {})
    status.update({
        "id": str(job.get("id")),
        "enabled": bool(job.get("enabled", True)),
        "status": "waiting" if reason == "not_due" else reason,
        "reason": reason,
        "checked_at": now.isoformat(),
        "command": list(job.get("command") or []),
        "run_dir": str(job.get("run_dir") or ""),
        "pause_marker": str(job.get("pause_marker") or ""),
    })
    return status


def paused_status(job: dict[str, Any], previous: dict[str, Any] | None, now: datetime, marker: Path) -> dict[str, Any]:
    status = status_from_previous(job, previous, now, "paused")
    status["status"] = "paused"
    status["reason"] = "pause_marker_exists"
    status["pause_marker"] = str(marker)
    return status


def run_job(job: dict[str, Any], previous: dict[str, Any] | None, now: datetime, log_dir: Path) -> dict[str, Any]:
    job_id = str(job["id"])
    command = [str(part) for part in job["command"]]
    schedule = job.get("schedule") or {}
    timeout = float(schedule["max_runtime_seconds"]) if schedule.get("max_runtime_seconds") is not None else None
    started = time.monotonic()
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    job_log_dir = log_dir / slug(job_id)
    job_log_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = job_log_dir / f"{stamp}.stdout.log"
    stderr_path = job_log_dir / f"{stamp}.stderr.log"

    status = status_from_previous(job, previous, now, "running")
    status.update({
        "status": "running",
        "reason": "started",
        "process_mode": "blocking",
        "last_started_at": now.isoformat(),
        "last_stdout": str(stdout_path),
        "last_stderr": str(stderr_path),
    })

    try:
        with stdout_path.open("w") as stdout, stderr_path.open("w") as stderr:
            completed = subprocess.run(
                command,
                cwd=str(job.get("cwd", ".")),
                stdout=stdout,
                stderr=stderr,
                text=True,
                timeout=timeout,
                check=False,
            )
        status["last_returncode"] = completed.returncode
        status["status"] = "ok" if completed.returncode == 0 else "failed"
        status["reason"] = "completed" if completed.returncode == 0 else "nonzero_exit"
    except subprocess.TimeoutExpired as exc:
        status["last_returncode"] = None
        status["status"] = "failed"
        status["reason"] = "timeout"
        status["error"] = str(exc)
    except OSError as exc:
        status["last_returncode"] = None
        status["status"] = "failed"
        status["reason"] = "launch_error"
        status["error"] = str(exc)

    status["last_finished_at"] = utc_now().isoformat()
    status["last_runtime_seconds"] = round(time.monotonic() - started, 3)
    return status


def pid_running(pid: int) -> bool:
    try:
        os.kill(pid, 0)
    except OSError:
        return False
    return True


def runtime_seconds_from_status(status: dict[str, Any], now: datetime) -> float | None:
    started_at = parse_dt(status.get("last_started_at"))
    if started_at is None:
        return None
    return max(0.0, (now - started_at).total_seconds())


def runner_status_summary(job: dict[str, Any], now: datetime) -> dict[str, Any] | None:
    restart = job.get("restart") or {}
    path_value = restart.get("runner_status_path")
    if not path_value:
        return None
    path = Path(str(path_value))
    max_age = restart.get("max_status_age_seconds")
    summary: dict[str, Any] = {
        "path": str(path),
        "exists": path.exists(),
        "stale": False,
        "max_age_seconds": float(max_age) if max_age is not None else None,
    }
    if not path.exists():
        summary.update({
            "status": "missing",
            "stale": bool(max_age is not None),
        })
        return summary
    try:
        with path.open() as f:
            payload = json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        summary.update({
            "status": "invalid",
            "error": str(exc),
            "stale": bool(max_age is not None),
        })
        return summary
    if not isinstance(payload, dict):
        summary.update({
            "status": "invalid",
            "error": "runner status payload must be a mapping",
            "stale": bool(max_age is not None),
        })
        return summary
    updated_at = parse_dt(payload.get("updated_at"))
    age_seconds = (now - updated_at).total_seconds() if updated_at is not None else None
    stale = bool(max_age is not None and (age_seconds is None or age_seconds > float(max_age)))
    counts = payload.get("counts") if isinstance(payload.get("counts"), dict) else {}
    loop = payload.get("loop") if isinstance(payload.get("loop"), dict) else {}
    session = payload.get("session") if isinstance(payload.get("session"), dict) else {}
    summary.update({
        "status": "ok",
        "state": payload.get("state"),
        "mode": payload.get("mode"),
        "updated_at": updated_at.isoformat() if updated_at is not None else None,
        "age_seconds": round(age_seconds, 3) if age_seconds is not None else None,
        "stale": stale,
        "latest_data_time": payload.get("latest_data_time"),
        "last_decision_time": payload.get("last_decision_time"),
        "counts": counts,
        "loop": loop,
        "session": session,
    })
    return summary


def restart_history(previous: dict[str, Any] | None, now: datetime) -> list[str]:
    raw = (previous or {}).get("restart_history")
    if not isinstance(raw, list):
        return []
    out = []
    cutoff = now - timedelta(hours=1)
    for value in raw:
        parsed = parse_dt(value)
        if parsed is not None and parsed >= cutoff:
            out.append(parsed.isoformat())
    return out


def restart_allowed(job: dict[str, Any], previous: dict[str, Any] | None, now: datetime) -> tuple[bool, list[str], int | None]:
    restart = job.get("restart") or {}
    history = restart_history(previous, now)
    raw_limit = restart.get("max_restarts_per_hour")
    limit = int(raw_limit) if raw_limit is not None else None
    if limit is not None and len(history) >= limit:
        return False, history, limit
    return True, history, limit


def managed_running_status(
    job: dict[str, Any],
    previous: dict[str, Any] | None,
    now: datetime,
    *,
    reason: str,
) -> dict[str, Any]:
    status = status_from_previous(job, previous, now, reason)
    status.pop("restart_requested", None)
    status.pop("managed_process_exited", None)
    status["status"] = "running"
    status["process_mode"] = "managed"
    status["reason"] = reason
    runtime = runtime_seconds_from_status(status, now)
    if runtime is not None:
        status["current_runtime_seconds"] = round(runtime, 3)
    return status


def terminate_process(proc: subprocess.Popen, *, grace_seconds: float = 0) -> bool:
    try:
        os.killpg(proc.pid, 15)
    except OSError:
        try:
            proc.terminate()
        except OSError:
            return proc.poll() is not None
    if grace_seconds > 0:
        try:
            proc.wait(timeout=grace_seconds)
        except subprocess.TimeoutExpired:
            return False
    return proc.poll() is not None


def blocked_restart_status(
    status: dict[str, Any],
    *,
    history: list[str],
    limit: int | None,
    trigger: str,
) -> dict[str, Any]:
    status["status"] = "failed"
    status["reason"] = "restart_limit_reached"
    status["restart_trigger"] = trigger
    status["restart_history"] = history
    status["restart_count_last_hour"] = len(history)
    status["restart_limit_per_hour"] = limit
    return status


def monitor_managed_job(
    job: dict[str, Any],
    previous: dict[str, Any] | None,
    now: datetime,
) -> dict[str, Any] | None:
    job_id = str(job["id"])
    schedule = job.get("schedule") or {}
    proc = MANAGED_PROCESSES.get(job_id)
    if proc is not None:
        returncode = proc.poll()
        if returncode is None:
            status = managed_running_status(job, previous, now, reason="already_running")
            status["pid"] = proc.pid
            runner_status = runner_status_summary(job, now)
            if runner_status is not None:
                status["runner_status"] = runner_status
            max_runtime = schedule.get("max_runtime_seconds")
            runtime = runtime_seconds_from_status(status, now)
            if max_runtime is not None and runtime is not None and runtime > float(max_runtime):
                terminate_process(proc)
                status["status"] = "failed"
                status["reason"] = "max_runtime_exceeded"
                status["error"] = f"runtime {runtime:.3f}s exceeded max_runtime_seconds {float(max_runtime):.3f}"
            elif runner_status is not None and runner_status.get("stale") and bool((job.get("restart") or {}).get("on_stale_runner_status", False)):
                grace = float((job.get("restart") or {}).get("stop_grace_seconds", 5.0))
                stopped = terminate_process(proc, grace_seconds=grace)
                if stopped:
                    MANAGED_PROCESSES.pop(job_id, None)
                    status["status"] = "failed"
                    status["reason"] = "runner_status_stale"
                    status["restart_requested"] = True
                    status["last_returncode"] = proc.poll()
                    status["last_finished_at"] = now.isoformat()
                else:
                    status["status"] = "failed"
                    status["reason"] = "runner_status_stale_stop_pending"
                    status["error"] = f"stale runner_status.json but process did not stop within {grace:.3f}s"
            return status
        MANAGED_PROCESSES.pop(job_id, None)
        status = status_from_previous(job, previous, now, "completed" if returncode == 0 else "nonzero_exit")
        status["process_mode"] = "managed"
        status["status"] = "ok" if returncode == 0 else "failed"
        status["last_returncode"] = returncode
        status["last_finished_at"] = now.isoformat()
        status["managed_process_exited"] = True
        runtime = runtime_seconds_from_status(status, now)
        if runtime is not None:
            status["last_runtime_seconds"] = round(runtime, 3)
        return status

    if previous and previous.get("status") == "running" and previous.get("pid"):
        pid = int(previous["pid"])
        if pid_running(pid):
            status = managed_running_status(job, previous, now, reason="external_pid_running")
            status["pid"] = pid
            runner_status = runner_status_summary(job, now)
            if runner_status is not None:
                status["runner_status"] = runner_status
            return status
        status = status_from_previous(job, previous, now, "pid_not_running_returncode_unknown")
        status["process_mode"] = "managed"
        status["status"] = "unknown"
        status["last_finished_at"] = now.isoformat()
        status["managed_process_exited"] = True
        return status
    return None


def start_managed_job(
    job: dict[str, Any],
    previous: dict[str, Any] | None,
    now: datetime,
    log_dir: Path,
    *,
    start_reason: str = "started",
    restart_trigger: str | None = None,
) -> dict[str, Any]:
    job_id = str(job["id"])
    command = [str(part) for part in job["command"]]
    stamp = now.strftime("%Y%m%dT%H%M%SZ")
    job_log_dir = log_dir / slug(job_id)
    job_log_dir.mkdir(parents=True, exist_ok=True)
    stdout_path = job_log_dir / f"{stamp}.stdout.log"
    stderr_path = job_log_dir / f"{stamp}.stderr.log"
    status = status_from_previous(job, previous, now, start_reason)
    status.pop("restart_requested", None)
    status.pop("managed_process_exited", None)
    restart_history_values: list[str] | None = None
    restart_limit: int | None = None
    if restart_trigger:
        allowed, history, limit = restart_allowed(job, previous, now)
        if not allowed:
            status["process_mode"] = "managed"
            return blocked_restart_status(status, history=history, limit=limit, trigger=restart_trigger)
        restart_history_values = [*history, now.isoformat()]
        restart_limit = limit
    status.update({
        "status": "running",
        "process_mode": "managed",
        "last_started_at": now.isoformat(),
        "last_stdout": str(stdout_path),
        "last_stderr": str(stderr_path),
        "last_returncode": None,
    })
    if restart_trigger:
        status["restart_trigger"] = restart_trigger
        status["restart_history"] = restart_history_values
        status["restart_count_last_hour"] = len(restart_history_values or [])
        status["restart_limit_per_hour"] = restart_limit
    try:
        stdout = stdout_path.open("w")
        stderr = stderr_path.open("w")
        try:
            proc = subprocess.Popen(
                command,
                cwd=str(job.get("cwd", ".")),
                stdout=stdout,
                stderr=stderr,
                text=True,
                start_new_session=True,
            )
        finally:
            stdout.close()
            stderr.close()
        MANAGED_PROCESSES[job_id] = proc
        status["pid"] = proc.pid
    except OSError as exc:
        status["status"] = "failed"
        status["reason"] = "launch_error"
        status["error"] = str(exc)
    return status


def build_state(config: dict[str, Any], jobs: list[dict[str, Any]], now: datetime) -> dict[str, Any]:
    failed = any(job.get("status") in {"failed", "unknown"} for job in jobs)
    return {
        "schema_version": SCHEMA_VERSION,
        "generated_at": now.isoformat(),
        "node_id": str(config.get("node_id") or "local-trader"),
        "status": "warn" if failed else "ok",
        "jobs": jobs,
    }


def evaluate_once(config: dict[str, Any], *, now: datetime | None = None) -> dict[str, Any]:
    errors = validate_config(config)
    if errors:
        raise SupervisorConfigError(errors)
    now = now or utc_now()
    supervisor = config.get("supervisor") or {}
    state_file = Path(str(supervisor.get("state_file") or "paper_logs/plugin_supervisor/status.json"))
    log_dir = Path(str(supervisor.get("log_dir") or "paper_logs/plugin_supervisor/jobs"))
    previous = previous_jobs(load_state(state_file))
    statuses = []

    for job in config.get("jobs") or []:
        job_id = str(job["id"])
        previous_status = previous.get(job_id)
        process_mode = str(job.get("process_mode", "blocking"))
        if process_mode == "managed":
            current = monitor_managed_job(job, previous_status, now)
            if current is not None:
                restart = job.get("restart") or {}
                should_restart = bool(current.get("restart_requested")) or (
                    bool(restart.get("on_exit", False))
                    and bool(current.get("managed_process_exited", False))
                    and str(current.get("reason")) in RESTARTABLE_EXIT_REASONS
                )
                if current.get("status") == "running" and not should_restart:
                    statuses.append(current)
                    continue
                if should_restart:
                    marker_value = job.get("pause_marker")
                    if marker_value and Path(str(marker_value)).exists():
                        statuses.append(paused_status(job, current, now, Path(str(marker_value))))
                        continue
                    trigger = "runner_status_stale" if current.get("restart_requested") else str(current.get("reason") or "process_exit")
                    statuses.append(start_managed_job(
                        job,
                        current,
                        now,
                        log_dir,
                        start_reason=f"restart_{trigger}",
                        restart_trigger=trigger,
                    ))
                    continue
                if previous_status and previous_status.get("status") == "running":
                    statuses.append(current)
                    continue
        marker_value = job.get("pause_marker")
        if marker_value and Path(str(marker_value)).exists():
            statuses.append(paused_status(job, previous_status, now, Path(str(marker_value))))
            continue

        due, reason = job_due(job, previous_status, now)
        if not due:
            statuses.append(status_from_previous(job, previous_status, now, reason))
            continue
        if process_mode == "managed":
            statuses.append(start_managed_job(job, previous_status, now, log_dir))
        else:
            statuses.append(run_job(job, previous_status, now, log_dir))

    state = build_state(config, statuses, now)
    write_state(state_file, state)
    return state


def run_loop(config: dict[str, Any], *, once: bool = False) -> None:
    poll_seconds = float((config.get("supervisor") or {}).get("poll_seconds", 30))
    while True:
        state = evaluate_once(config)
        print(json.dumps(state, sort_keys=True))
        if once:
            return
        time.sleep(poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run generic plugin-runner jobs from local config")
    parser.add_argument("--config", type=Path, default=Path("config/plugin_supervisor.example.yaml"))
    parser.add_argument("--once", action="store_true", help="Evaluate and run due jobs once, then exit")
    parser.add_argument("--validate-only", action="store_true", help="Validate config without running jobs")
    args = parser.parse_args()

    try:
        config = validate_config_file(args.config)
        if args.validate_only:
            print(f"Config valid: {args.config}")
            return
        run_loop(config, once=args.once)
    except Exception as exc:
        print(f"Supervisor failed: {exc}", file=sys.stderr)
        raise SystemExit(2) from exc


if __name__ == "__main__":
    main()
