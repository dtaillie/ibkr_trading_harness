#!/usr/bin/env python3
"""Tiny local receiver/dashboard for public telemetry prototypes."""

from __future__ import annotations

import argparse
import html
import json
import os
import mimetypes
from collections import deque
from datetime import datetime, timezone
from http.server import BaseHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from typing import Any, Iterable
from urllib.parse import parse_qs, unquote, urlparse


ALLOWED_COMMAND_ACTIONS = {
    "pause_runner",
    "resume_runner",
    "request_status",
    "run_supervisor_once",
    "summarize_run",
    "supervisor_status",
    "validate_config",
    "validate_supervisor_config",
}

COMMAND_PARAM_FIELDS = {
    "pause_runner": (),
    "request_status": (),
    "resume_runner": (),
    "run_supervisor_once": ("supervisor_id",),
    "summarize_run": ("run_id",),
    "supervisor_status": ("supervisor_id",),
    "validate_config": ("config_id",),
    "validate_supervisor_config": ("supervisor_id",),
}

ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DASHBOARD_DIR = ROOT / "web" / "dashboard"


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def json_response(handler: BaseHTTPRequestHandler, status: int, payload: dict[str, Any]) -> None:
    body = json.dumps(payload, indent=2, sort_keys=True).encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", "application/json")
    handler.send_header("Content-Length", str(len(body)))
    handler.end_headers()
    handler.wfile.write(body)


def text_response(handler: BaseHTTPRequestHandler, status: int, body: str, content_type: str = "text/html") -> None:
    raw = body.encode("utf-8")
    handler.send_response(status)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def file_response(handler: BaseHTTPRequestHandler, path: Path) -> None:
    if not path.exists() or not path.is_file():
        json_response(handler, 404, {"error": "not found"})
        return
    raw = path.read_bytes()
    content_type = mimetypes.guess_type(path.name)[0] or "application/octet-stream"
    handler.send_response(200)
    handler.send_header("Content-Type", content_type)
    handler.send_header("Content-Length", str(len(raw)))
    handler.end_headers()
    handler.wfile.write(raw)


def load_latest(state_dir: Path) -> dict[str, Any] | None:
    path = state_dir / "latest_status.json"
    if not path.exists():
        return None
    with path.open() as f:
        data = json.load(f)
    return data if isinstance(data, dict) else None


def status_history_path(state_dir: Path) -> Path:
    return state_dir / "status_history.jsonl"


def count_by_status(items: Iterable[dict[str, Any]]) -> dict[str, int]:
    counts: dict[str, int] = {}
    for item in items:
        if not isinstance(item, dict):
            continue
        status = str(item.get("status") or "unknown")
        counts[status] = counts.get(status, 0) + 1
    return counts


def summarize_status_snapshot(row: dict[str, Any]) -> dict[str, Any]:
    gateway = row.get("gateway") or {}
    remote = row.get("remote_control") or {}
    latest_remote = remote.get("latest_event") or {}
    latest_remote_result = latest_remote.get("result") or {}
    runs = row.get("runs") or []
    supervisors = row.get("supervisors") or []
    alerts = row.get("alerts") or []
    return {
        "node_id": row.get("node_id"),
        "status": row.get("status"),
        "generated_at": row.get("generated_at"),
        "received_at": row.get("received_at"),
        "alert_count": len(alerts) if isinstance(alerts, list) else 0,
        "run_count": len(runs) if isinstance(runs, list) else 0,
        "run_status_counts": count_by_status(runs) if isinstance(runs, list) else {},
        "supervisor_count": len(supervisors) if isinstance(supervisors, list) else 0,
        "supervisor_status_counts": count_by_status(supervisors) if isinstance(supervisors, list) else {},
        "gateway_reachable": gateway.get("reachable"),
        "remote_latest_event": latest_remote.get("event"),
        "remote_latest_action": latest_remote_result.get("action"),
        "remote_latest_status": latest_remote_result.get("status"),
    }


def load_status_history(state_dir: Path, *, node_id: str | None = None, limit: int = 50) -> dict[str, Any]:
    path = status_history_path(state_dir)
    if not path.exists():
        return {"history": [], "count": 0, "total": 0, "limit": limit}
    rows: deque[dict[str, Any]] = deque(maxlen=limit)
    total = 0
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            try:
                row = json.loads(line)
            except json.JSONDecodeError:
                continue
            if not isinstance(row, dict):
                continue
            if node_id and row.get("node_id") != node_id:
                continue
            total += 1
            rows.append(summarize_status_snapshot(row))
    history = list(reversed(rows))
    return {"history": history, "count": len(history), "total": total, "limit": limit}


def parse_limit(params: dict[str, list[str]], *, default: int = 50, maximum: int = 500) -> int:
    raw = params.get("limit", [str(default)])[0]
    try:
        value = int(raw)
    except ValueError as exc:
        raise ValueError("limit must be an integer") from exc
    if value < 1 or value > maximum:
        raise ValueError(f"limit must be between 1 and {maximum}")
    return value


def read_json_body(handler: BaseHTTPRequestHandler, *, max_bytes: int = 1_000_000) -> dict[str, Any] | None:
    length = int(handler.headers.get("Content-Length", "0"))
    if length <= 0 or length > max_bytes:
        json_response(handler, 400, {"error": "invalid content length"})
        return None
    try:
        payload = json.loads(handler.rfile.read(length).decode("utf-8"))
    except json.JSONDecodeError as exc:
        json_response(handler, 400, {"error": str(exc)})
        return None
    if not isinstance(payload, dict):
        json_response(handler, 400, {"error": "payload must be a JSON object"})
        return None
    return payload


def save_status(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    state_dir.mkdir(parents=True, exist_ok=True)
    stored = dict(payload)
    stored["received_at"] = utc_now()
    with (state_dir / "latest_status.json").open("w") as f:
        json.dump(stored, f, indent=2, sort_keys=True)
        f.write("\n")
    with status_history_path(state_dir).open("a") as f:
        f.write(json.dumps(stored, sort_keys=True) + "\n")
    return stored


def commands_path(state_dir: Path) -> Path:
    return state_dir / "commands.json"


def results_path(state_dir: Path) -> Path:
    return state_dir / "command_results.jsonl"


def load_commands(state_dir: Path) -> list[dict[str, Any]]:
    path = commands_path(state_dir)
    if not path.exists():
        return []
    with path.open() as f:
        data = json.load(f)
    return data if isinstance(data, list) else []


def save_commands(state_dir: Path, commands: list[dict[str, Any]]) -> None:
    state_dir.mkdir(parents=True, exist_ok=True)
    with commands_path(state_dir).open("w") as f:
        json.dump(commands, f, indent=2, sort_keys=True)
        f.write("\n")


def enqueue_command(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    node_id = str(payload.get("node_id") or "").strip()
    action = str(payload.get("action") or "").strip()
    if not node_id:
        raise ValueError("node_id is required")
    if action not in ALLOWED_COMMAND_ACTIONS:
        raise ValueError(f"unsupported action: {action}")
    params = payload.get("params") or {}
    if not isinstance(params, dict):
        raise ValueError("params must be a mapping")
    params = normalized_command_params(action, params)
    commands = load_commands(state_dir)
    command = {
        "command_id": str(payload.get("command_id") or f"cmd-{int(datetime.now(timezone.utc).timestamp() * 1000000)}"),
        "node_id": node_id,
        "action": action,
        "params": params,
        "status": "pending",
        "created_at": utc_now(),
    }
    commands.append(command)
    save_commands(state_dir, commands)
    return command


def normalized_command_params(action: str, params: dict[str, Any]) -> dict[str, str]:
    fields = COMMAND_PARAM_FIELDS.get(action)
    if fields is None:
        raise ValueError(f"unsupported action: {action}")
    allowed = set(fields)
    extra = sorted(key for key, value in params.items() if key not in allowed and value not in (None, ""))
    if extra:
        raise ValueError(f"unsupported params for {action}: {', '.join(extra)}")
    normalized: dict[str, str] = {}
    for field in fields:
        value = str(params.get(field) or "").strip()
        if not value:
            raise ValueError(f"{field} is required for {action}")
        normalized[field] = value
    return normalized


def pending_commands(state_dir: Path, node_id: str | None = None) -> list[dict[str, Any]]:
    commands = load_commands(state_dir)
    return [
        command
        for command in commands
        if command.get("status") == "pending"
        and (node_id is None or command.get("node_id") == node_id)
    ]


def save_command_result(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    command_id = str(payload.get("command_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    status = str(payload.get("status") or "").strip()
    if not command_id:
        raise ValueError("command_id is required")
    if not node_id:
        raise ValueError("node_id is required")
    if status not in {"canceled", "completed", "failed", "rejected"}:
        raise ValueError("status must be canceled, completed, failed, or rejected")
    stored = dict(payload)
    stored["received_at"] = utc_now()
    commands = load_commands(state_dir)
    for command in commands:
        if command.get("command_id") == command_id:
            command["status"] = status
            command["completed_at"] = stored["received_at"]
            break
    save_commands(state_dir, commands)
    state_dir.mkdir(parents=True, exist_ok=True)
    with results_path(state_dir).open("a") as f:
        f.write(json.dumps(stored, sort_keys=True) + "\n")
    return stored


def cancel_command(state_dir: Path, payload: dict[str, Any]) -> dict[str, Any]:
    command_id = str(payload.get("command_id") or "").strip()
    node_id = str(payload.get("node_id") or "").strip()
    if not command_id:
        raise ValueError("command_id is required")
    if not node_id:
        raise ValueError("node_id is required")

    commands = load_commands(state_dir)
    matched: dict[str, Any] | None = None
    for command in commands:
        if command.get("command_id") == command_id and command.get("node_id") == node_id:
            matched = command
            break
    if matched is None:
        raise ValueError("command not found")
    if matched.get("status") != "pending":
        raise ValueError(f"command is not pending: {matched.get('status')}")

    now = utc_now()
    matched["status"] = "canceled"
    matched["completed_at"] = now
    save_commands(state_dir, commands)
    stored = {
        "command_id": command_id,
        "node_id": node_id,
        "action": matched.get("action"),
        "status": "canceled",
        "received_at": now,
        "result": {"canceled": True},
    }
    state_dir.mkdir(parents=True, exist_ok=True)
    with results_path(state_dir).open("a") as f:
        f.write(json.dumps(stored, sort_keys=True) + "\n")
    return stored


def load_command_results(state_dir: Path, node_id: str | None = None) -> list[dict[str, Any]]:
    path = results_path(state_dir)
    if not path.exists():
        return []
    rows = []
    with path.open() as f:
        for line in f:
            if not line.strip():
                continue
            row = json.loads(line)
            if isinstance(row, dict) and (node_id is None or row.get("node_id") == node_id):
                rows.append(row)
    return rows


def render_dashboard(payload: dict[str, Any] | None) -> str:
    if payload is None:
        body = "<p>No status has been received yet.</p>"
    else:
        alerts = payload.get("alerts") or []
        runs = payload.get("runs") or []
        gateway = payload.get("gateway") or {}
        alert_rows = "".join(
            f"<tr><td>{html.escape(str(a.get('level', '')))}</td><td>{html.escape(str(a.get('kind', '')))}</td><td>{html.escape(str(a.get('message', '')))}</td></tr>"
            for a in alerts
        ) or "<tr><td colspan='3'>none</td></tr>"
        run_rows = ""
        for run in runs:
            metrics = run.get("metrics") or {}
            run_rows += (
                "<tr>"
                f"<td>{html.escape(str(run.get('id', '')))}</td>"
                f"<td>{html.escape(str(run.get('status', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('mode', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('decisions', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('fills', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('rejections', '')))}</td>"
                f"<td>{html.escape(str(metrics.get('final_equity', '')))}</td>"
                "</tr>"
            )
        if not run_rows:
            run_rows = "<tr><td colspan='7'>none</td></tr>"
        body = f"""
        <section>
          <h2>Node</h2>
          <dl>
            <dt>ID</dt><dd>{html.escape(str(payload.get('node_id', '')))}</dd>
            <dt>Status</dt><dd>{html.escape(str(payload.get('status', '')))}</dd>
            <dt>Generated</dt><dd>{html.escape(str(payload.get('generated_at', '')))}</dd>
            <dt>Received</dt><dd>{html.escape(str(payload.get('received_at', '')))}</dd>
          </dl>
        </section>
        <section>
          <h2>Gateway</h2>
          <dl>
            <dt>Enabled</dt><dd>{html.escape(str(gateway.get('enabled')))}</dd>
            <dt>Endpoint</dt><dd>{html.escape(str(gateway.get('host')))}:{html.escape(str(gateway.get('port')))}</dd>
            <dt>Reachable</dt><dd>{html.escape(str(gateway.get('reachable')))}</dd>
            <dt>Latency</dt><dd>{html.escape(str(gateway.get('latency_ms')))} ms</dd>
          </dl>
        </section>
        <section>
          <h2>Runs</h2>
          <table>
            <thead><tr><th>ID</th><th>Status</th><th>Mode</th><th>Decisions</th><th>Fills</th><th>Rejections</th><th>Final Equity</th></tr></thead>
            <tbody>{run_rows}</tbody>
          </table>
        </section>
        <section>
          <h2>Alerts</h2>
          <table>
            <thead><tr><th>Level</th><th>Kind</th><th>Message</th></tr></thead>
            <tbody>{alert_rows}</tbody>
          </table>
        </section>
        """
    return f"""<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Trading Harness Status</title>
  <style>
    body {{ font-family: system-ui, sans-serif; margin: 24px; color: #17202a; background: #f7f9fb; }}
    main {{ max-width: 1120px; margin: 0 auto; }}
    section {{ margin: 18px 0; }}
    table {{ width: 100%; border-collapse: collapse; background: white; }}
    th, td {{ text-align: left; border-bottom: 1px solid #d9e2ec; padding: 8px; }}
    dl {{ display: grid; grid-template-columns: 140px 1fr; gap: 8px; background: white; padding: 12px; }}
    dt {{ font-weight: 600; }}
  </style>
</head>
<body>
  <main>
    <h1>Trading Harness Status</h1>
    {body}
  </main>
</body>
</html>
"""


class StatusHandler(BaseHTTPRequestHandler):
    state_dir = Path("paper_logs/cloud_status_server")
    auth_token_env: str | None = None
    dashboard_dir = DEFAULT_DASHBOARD_DIR

    def auth_token(self) -> str | None:
        if not self.auth_token_env:
            return None
        return os.getenv(self.auth_token_env)

    def require_auth(self) -> bool:
        if not self.auth_token_env:
            return True
        bearer_value = self.auth_token()
        if not bearer_value:
            json_response(self, 503, {"error": f"auth token env var is not set: {self.auth_token_env}"})
            return False
        expected = f"Bearer {bearer_value}"
        if self.headers.get("Authorization") == expected:
            return True
        json_response(self, 401, {"error": "unauthorized"})
        return False

    def do_POST(self) -> None:
        if not self.require_auth():
            return
        if self.path == "/status":
            payload = read_json_body(self)
            if payload is None:
                return
            stored = save_status(self.state_dir, payload)
            json_response(self, 200, {"ok": True, "received_at": stored["received_at"]})
            return
        if self.path == "/commands":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                command = enqueue_command(self.state_dir, payload)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "command": command})
            return
        if self.path == "/commands/cancel":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = cancel_command(self.state_dir, payload)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "result": result})
            return
        if self.path == "/command_results":
            payload = read_json_body(self)
            if payload is None:
                return
            try:
                result = save_command_result(self.state_dir, payload)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            json_response(self, 200, {"ok": True, "result": result})
            return
        else:
            json_response(self, 404, {"error": "not found"})
            return

    def do_GET(self) -> None:
        parsed = urlparse(self.path)
        params = parse_qs(parsed.query)
        node_id = params.get("node_id", [None])[0]
        if parsed.path == "/status":
            if not self.require_auth():
                return
            payload = load_latest(self.state_dir)
            json_response(self, 200, payload or {})
            return
        if parsed.path == "/status_history":
            if not self.require_auth():
                return
            try:
                limit = parse_limit(params)
            except ValueError as exc:
                json_response(self, 400, {"error": str(exc)})
                return
            payload = load_status_history(self.state_dir, node_id=node_id, limit=limit)
            json_response(self, 200, payload)
            return
        if parsed.path == "/commands":
            if not self.require_auth():
                return
            json_response(self, 200, {"commands": pending_commands(self.state_dir, node_id=node_id)})
            return
        if parsed.path == "/command_results":
            if not self.require_auth():
                return
            json_response(self, 200, {"results": load_command_results(self.state_dir, node_id=node_id)})
            return
        if parsed.path in {"/", "/index.html"}:
            index = self.dashboard_dir / "index.html"
            if index.exists():
                file_response(self, index)
            else:
                text_response(self, 200, render_dashboard(load_latest(self.state_dir)))
            return
        if parsed.path.startswith("/dashboard/"):
            rel = Path(unquote(parsed.path.removeprefix("/dashboard/")))
            if rel.is_absolute() or ".." in rel.parts:
                json_response(self, 404, {"error": "not found"})
                return
            file_response(self, self.dashboard_dir / rel)
            return
        json_response(self, 404, {"error": "not found"})

    def log_message(self, format: str, *args: Any) -> None:
        return


def create_server(
    host: str,
    port: int,
    state_dir: Path,
    *,
    auth_token_env: str | None = None,
    dashboard_dir: Path = DEFAULT_DASHBOARD_DIR,
) -> ThreadingHTTPServer:
    class Handler(StatusHandler):
        pass

    Handler.state_dir = state_dir
    Handler.auth_token_env = auth_token_env
    Handler.dashboard_dir = dashboard_dir
    return ThreadingHTTPServer((host, port), Handler)


def main() -> None:
    parser = argparse.ArgumentParser(description="Run a local telemetry receiver/dashboard")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    parser.add_argument("--state-dir", type=Path, default=Path("paper_logs/cloud_status_server"))
    parser.add_argument("--dashboard-dir", type=Path, default=DEFAULT_DASHBOARD_DIR)
    parser.add_argument("--auth-token-env", default=None, help="Optional env var containing bearer token")
    args = parser.parse_args()

    server = create_server(
        args.host,
        args.port,
        args.state_dir,
        auth_token_env=args.auth_token_env,
        dashboard_dir=args.dashboard_dir,
    )
    print(f"Serving status dashboard at http://{args.host}:{server.server_address[1]}/")
    server.serve_forever()


if __name__ == "__main__":
    main()
