#!/usr/bin/env python3
"""Poll cloud commands and execute a small local allowlist.

This is a public-safe remote-control prototype. It intentionally does not
support arbitrary shell commands, strategy changes, or broker actions.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
from datetime import datetime, timezone
from pathlib import Path
from typing import Any
from urllib import parse, request

import yaml

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from core import Order, Side
from live.broker_adapters import create_broker_adapter
from live.plugin_runner import ConfigValidationError, validate_config_file as validate_runner_config_file
from scripts.plugin_supervisor import (
    SupervisorConfigError,
    evaluate_once as evaluate_supervisor_once,
    load_config as load_supervisor_config,
    load_state as load_supervisor_state,
    validate_config_file as validate_supervisor_config_file,
)
from scripts.publish_status import collect_status, load_config
from scripts.summarize_plugin_run import summarize_run


DEFAULT_ALLOWED_ACTIONS = {
    "request_status",
    "supervisor_status",
    "summarize_run",
    "validate_config",
    "validate_supervisor_config",
    "pause_runner",
    "resume_runner",
}

ACTION_CLASSES = {
    "request_status": "read_only",
    "supervisor_status": "read_only",
    "summarize_run": "read_only",
    "validate_config": "read_only",
    "validate_supervisor_config": "read_only",
    "flatten_simulated_positions": "control",
    "pause_runner": "control",
    "resume_runner": "control",
    "run_supervisor_once": "launcher",
    "restart_child_process": "launcher",
}

DEFAULT_LOCAL_ENABLE_ACTIONS = {"flatten_simulated_positions", "restart_child_process", "run_supervisor_once"}


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def read_config(path: Path) -> dict[str, Any]:
    with path.open() as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Config must be a YAML mapping: {path}")
    return data


def auth_headers(config: dict[str, Any]) -> dict[str, str]:
    server = config.get("server") or {}
    token_env = server.get("token_env")
    if not token_env:
        return {}
    bearer_value = os.getenv(str(token_env))
    if not bearer_value:
        return {}
    return {"Authorization": f"Bearer {bearer_value}"}


def http_json(
    method: str,
    url: str,
    payload: dict[str, Any] | None = None,
    *,
    timeout: float = 5.0,
    headers: dict[str, str] | None = None,
) -> dict[str, Any]:
    data = None if payload is None else json.dumps(payload, sort_keys=True).encode("utf-8")
    request_headers = {"Content-Type": "application/json"}
    request_headers.update(headers or {})
    req = request.Request(
        url,
        data=data,
        headers=request_headers,
        method=method,
    )
    with request.urlopen(req, timeout=timeout) as resp:
        raw = resp.read().decode("utf-8")
    if not raw:
        return {}
    parsed = json.loads(raw)
    return parsed if isinstance(parsed, dict) else {}


def fetch_commands(config: dict[str, Any]) -> list[dict[str, Any]]:
    node_id = str(config.get("node_id") or "local-trader")
    server = config.get("server") or {}
    base_url = str(server.get("commands_url") or "http://127.0.0.1:8765/commands")
    timeout = float(server.get("timeout_seconds", 5.0))
    query = parse.urlencode({"node_id": node_id})
    separator = "&" if "?" in base_url else "?"
    payload = http_json("GET", f"{base_url}{separator}{query}", timeout=timeout, headers=auth_headers(config))
    commands = payload.get("commands") or []
    return commands if isinstance(commands, list) else []


def post_result(config: dict[str, Any], result: dict[str, Any]) -> dict[str, Any]:
    server = config.get("server") or {}
    url = str(server.get("results_url") or "http://127.0.0.1:8765/command_results")
    timeout = float(server.get("timeout_seconds", 5.0))
    return http_json("POST", url, result, timeout=timeout, headers=auth_headers(config))


def audit_path(config: dict[str, Any]) -> Path | None:
    audit = config.get("audit") or {}
    if audit.get("enabled") is False:
        return None
    return Path(str(audit.get("log_file") or "paper_logs/remote_control/audit.jsonl"))


def append_audit(config: dict[str, Any], record: dict[str, Any]) -> None:
    path = audit_path(config)
    if path is None:
        return
    path.parent.mkdir(parents=True, exist_ok=True)
    payload = {
        "audited_at": utc_now(),
        **record,
    }
    with path.open("a") as f:
        f.write(json.dumps(payload, sort_keys=True) + "\n")


def configured_path(mapping: dict[str, Any], key: str, *, kind: str) -> Path:
    if key not in mapping:
        raise ValueError(f"{kind} id is not configured: {key}")
    return Path(str(mapping[key]))


def supervisor_state_path(supervisor_config_path: Path) -> Path:
    supervisor_config = load_supervisor_config(supervisor_config_path)
    supervisor = supervisor_config.get("supervisor") or {}
    return Path(str(supervisor.get("state_file") or "paper_logs/plugin_supervisor/status.json"))


def configured_supervisor_job(supervisor_config_path: Path, job_id: str) -> tuple[dict[str, Any], dict[str, Any]]:
    supervisor_config = validate_supervisor_config_file(supervisor_config_path)
    for job in supervisor_config.get("jobs") or []:
        if str(job.get("id") or "") == job_id:
            return supervisor_config, job
    raise ValueError(f"supervisor job id is not configured: {job_id}")


def flatten_file_broker_positions(config_path: Path, *, command_id: str) -> dict[str, Any]:
    runner_config = validate_runner_config_file(config_path)
    broker_cfg = runner_config.get("broker") or {}
    adapter = str(broker_cfg.get("adapter", broker_cfg.get("provider", "ibkr"))).lower().replace("-", "_")
    if adapter != "file":
        raise ValueError(f"flatten_simulated_positions requires broker.adapter=file, observed {adapter}")

    broker = create_broker_adapter(broker_cfg)
    broker.connect()
    fills: list[dict[str, Any]] = []
    failures: list[dict[str, Any]] = []
    try:
        cash_before = broker.get_cash()
        positions_before = broker.get_positions()
        for symbol, quantity in sorted(positions_before.items()):
            if abs(quantity) <= 1e-9:
                continue
            order = Order(
                symbol=symbol,
                side=Side.SELL if quantity > 0 else Side.BUY,
                quantity=abs(quantity),
                timestamp=datetime.now(timezone.utc),
                tag=f"remote_flatten_simulated_positions:{command_id}",
            )
            fill = broker.submit_order(order)
            if fill is None:
                failures.append({
                    "symbol": symbol,
                    "quantity": quantity,
                    "status": broker.last_order_status,
                    "message": broker.last_order_message,
                })
                continue
            fills.append({
                "timestamp": fill.timestamp.isoformat(),
                "symbol": fill.symbol,
                "side": fill.side.name.lower(),
                "quantity": fill.quantity,
                "price": fill.price,
                "commission": fill.commission,
                "tag": fill.tag,
            })
        return {
            "config_path": str(config_path),
            "cash_before": cash_before,
            "positions_before": positions_before,
            "cash_after": broker.get_cash(),
            "positions_after": broker.get_positions(),
            "fills": fills,
            "failures": failures,
        }
    finally:
        broker.disconnect()


def action_class(action: str) -> str:
    return ACTION_CLASSES.get(action, "unknown")


def safety_marker_path(config: dict[str, Any]) -> Path:
    safety = config.get("safety") or {}
    return Path(str(safety.get("local_enable_marker") or "paper_logs/control/remote_commands.enabled"))


def local_safety_error(action: str, config: dict[str, Any]) -> str | None:
    safety = config.get("safety") or {}
    disabled_actions = set(safety.get("disabled_actions") or [])
    if action in disabled_actions:
        return f"action is disabled by local safety config: {action}"

    gated_actions = set(safety.get("actions_requiring_local_enable") or DEFAULT_LOCAL_ENABLE_ACTIONS)
    if not safety.get("require_local_enable_marker", False) or action not in gated_actions:
        return None

    marker = safety_marker_path(config)
    if marker.exists():
        return None
    return f"local enable marker is required for {action}: {marker}"


def rejected_result(command: dict[str, Any], config: dict[str, Any], error: str) -> dict[str, Any]:
    action = str(command.get("action") or "")
    return {
        "command_id": str(command.get("command_id") or ""),
        "node_id": str(config.get("node_id") or "local-trader"),
        "action": action,
        "action_class": action_class(action),
        "status": "rejected",
        "executed_at": utc_now(),
        "result": {},
        "error": error,
    }


def execute_command(command: dict[str, Any], config: dict[str, Any]) -> dict[str, Any]:
    node_id = str(config.get("node_id") or "local-trader")
    command_id = str(command.get("command_id") or "")
    action = str(command.get("action") or "")
    params = command.get("params") or {}
    allowed = set(config.get("allowed_actions") or DEFAULT_ALLOWED_ACTIONS)
    result: dict[str, Any] = {
        "command_id": command_id,
        "node_id": node_id,
        "action": action,
        "action_class": action_class(action),
        "status": "completed",
        "executed_at": utc_now(),
        "result": {},
    }

    if not command_id:
        result["status"] = "rejected"
        result["error"] = "command_id is required"
        return result
    if action not in allowed:
        result["status"] = "rejected"
        result["error"] = f"action is not allowed: {action}"
        return result
    if not isinstance(params, dict):
        result["status"] = "rejected"
        result["error"] = "params must be a mapping"
        return result
    if error := local_safety_error(action, config):
        result["status"] = "rejected"
        result["error"] = error
        return result

    try:
        if action == "request_status":
            status_config_path = Path(str(config.get("status_config") or "config/cloud_status.example.yaml"))
            result["result"] = collect_status(load_config(status_config_path))
        elif action == "supervisor_status":
            supervisor_id = str(params.get("supervisor_id") or "")
            supervisor_config_path = configured_path(config.get("supervisors") or {}, supervisor_id, kind="supervisor")
            state_path = supervisor_state_path(supervisor_config_path)
            result["result"] = {
                "supervisor_id": supervisor_id,
                "config_path": str(supervisor_config_path),
                "state_path": str(state_path),
                "state_exists": state_path.exists(),
                "state": load_supervisor_state(state_path),
            }
        elif action == "summarize_run":
            run_id = str(params.get("run_id") or "")
            run_path = configured_path(config.get("runs") or {}, run_id, kind="run")
            result["result"] = summarize_run(run_path)
        elif action == "validate_config":
            config_id = str(params.get("config_id") or "")
            config_path = configured_path(config.get("configs") or {}, config_id, kind="config")
            try:
                validate_runner_config_file(config_path)
                result["result"] = {"valid": True, "config_path": str(config_path)}
            except ConfigValidationError as exc:
                result["status"] = "failed"
                result["result"] = {"valid": False, "config_path": str(config_path), "errors": exc.errors}
        elif action == "validate_supervisor_config":
            supervisor_id = str(params.get("supervisor_id") or "")
            supervisor_config_path = configured_path(config.get("supervisors") or {}, supervisor_id, kind="supervisor")
            try:
                validate_supervisor_config_file(supervisor_config_path)
                result["result"] = {
                    "valid": True,
                    "supervisor_id": supervisor_id,
                    "config_path": str(supervisor_config_path),
                }
            except SupervisorConfigError as exc:
                result["status"] = "failed"
                result["result"] = {
                    "valid": False,
                    "supervisor_id": supervisor_id,
                    "config_path": str(supervisor_config_path),
                    "errors": exc.errors,
                }
        elif action == "flatten_simulated_positions":
            config_id = str(params.get("config_id") or "")
            config_path = configured_path(config.get("configs") or {}, config_id, kind="config")
            flatten_result = flatten_file_broker_positions(config_path, command_id=command_id)
            result["result"] = {
                "config_id": config_id,
                **flatten_result,
            }
            if flatten_result["failures"]:
                result["status"] = "failed"
        elif action == "run_supervisor_once":
            supervisor_id = str(params.get("supervisor_id") or "")
            supervisor_config_path = configured_path(config.get("supervisors") or {}, supervisor_id, kind="supervisor")
            supervisor_config = validate_supervisor_config_file(supervisor_config_path)
            result["result"] = {
                "supervisor_id": supervisor_id,
                "config_path": str(supervisor_config_path),
                "state": evaluate_supervisor_once(supervisor_config),
            }
        elif action == "restart_child_process":
            supervisor_id = str(params.get("supervisor_id") or "")
            job_id = str(params.get("job_id") or "")
            supervisor_config_path = configured_path(config.get("supervisors") or {}, supervisor_id, kind="supervisor")
            _, job = configured_supervisor_job(supervisor_config_path, job_id)
            if str(job.get("process_mode", "blocking")) != "managed":
                raise ValueError(f"supervisor job must use process_mode=managed for restart_child_process: {job_id}")
            restart_marker_value = job.get("restart_marker")
            if not restart_marker_value:
                raise ValueError(f"supervisor job must configure restart_marker for restart_child_process: {job_id}")
            restart_marker = Path(str(restart_marker_value))
            restart_marker.parent.mkdir(parents=True, exist_ok=True)
            restart_marker.write_text(
                "\n".join(
                    [
                        f"requested_at={utc_now()}",
                        f"command_id={command_id}",
                        f"supervisor_id={supervisor_id}",
                        f"job_id={job_id}",
                    ]
                )
                + "\n"
            )
            result["result"] = {
                "supervisor_id": supervisor_id,
                "job_id": job_id,
                "config_path": str(supervisor_config_path),
                "restart_marker": str(restart_marker),
                "restart_requested": True,
            }
        elif action == "pause_runner":
            marker = Path(str((config.get("control") or {}).get("pause_marker") or "paper_logs/control/runner.pause"))
            marker.parent.mkdir(parents=True, exist_ok=True)
            marker.write_text(f"paused_at={utc_now()}\n")
            result["result"] = {"pause_marker": str(marker), "paused": True}
        elif action == "resume_runner":
            marker = Path(str((config.get("control") or {}).get("pause_marker") or "paper_logs/control/runner.pause"))
            existed = marker.exists()
            if existed:
                marker.unlink()
            result["result"] = {"pause_marker": str(marker), "resumed": True, "marker_existed": existed}
        else:
            result["status"] = "rejected"
            result["error"] = f"unsupported action: {action}"
    except Exception as exc:
        result["status"] = "failed"
        result["error"] = str(exc)
    return result


def poll_once(config: dict[str, Any]) -> list[dict[str, Any]]:
    results = []
    node_id = str(config.get("node_id") or "local-trader")
    try:
        commands = fetch_commands(config)
    except Exception as exc:
        result = {
            "command_id": "",
            "node_id": node_id,
            "action": "poll",
            "status": "failed",
            "executed_at": utc_now(),
            "error": str(exc),
        }
        append_audit(config, {"event": "poll_failed", "result": result})
        return [result]
    worker = config.get("worker") or {}
    max_commands = int(worker.get("max_commands_per_poll", 20))
    if max_commands < 1:
        max_commands = 1
    for command in commands:
        if len(results) >= max_commands:
            result = rejected_result(command, config, f"worker command limit exceeded: max_commands_per_poll={max_commands}")
        else:
            result = execute_command(command, config)
        audited = dict(result)
        try:
            post_result(config, result)
            audited["post_result"] = {"status": "ok"}
        except Exception as exc:
            audited["post_result"] = {"status": "failed", "error": str(exc)}
        append_audit(config, {"event": "command_result", "result": audited})
        results.append(audited)
    return results


def run_loop(config: dict[str, Any], *, once: bool = False) -> None:
    poll_seconds = float((config.get("worker") or {}).get("poll_seconds", 10))
    while True:
        results = poll_once(config)
        for result in results:
            print(json.dumps(result, sort_keys=True))
        if once:
            return
        time.sleep(poll_seconds)


def main() -> None:
    parser = argparse.ArgumentParser(description="Poll and execute allowlisted remote commands")
    parser.add_argument("--config", type=Path, default=Path("config/remote_control.example.yaml"))
    parser.add_argument("--token-env", default=None, help="Override server.token_env")
    parser.add_argument("--once", action="store_true")
    args = parser.parse_args()

    config = read_config(args.config)
    if args.token_env is not None:
        server = dict(config.get("server") or {})
        server["token_env"] = args.token_env
        config["server"] = server
    run_loop(config, once=args.once)


if __name__ == "__main__":
    main()
