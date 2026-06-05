from __future__ import annotations

import csv
import io
import json
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import error, request

import pytest

from scripts import cloud_status_server as status_server
from scripts.cloud_status_server import create_server
from scripts.command_worker import execute_command, poll_once
from scripts.publish_status import collect_status, gateway_alerts, post_status, publish_status


def write_run(
    run_dir: Path,
    *,
    timestamp: str = "2026-01-02T14:30:00+00:00",
    summary_extra: dict | None = None,
) -> None:
    run_dir.mkdir()
    summary = {
        "mode": "replay",
        "decisions": 1,
        "orders": 0,
        "fills": 0,
        "rejections": 0,
        "final_cash": 10000.0,
        "final_equity": None,
        "final_positions": {},
    }
    summary.update(summary_extra or {})
    (run_dir / "summary.json").write_text(json.dumps(summary, sort_keys=True))
    (run_dir / "decisions.jsonl").write_text(json.dumps({"timestamp": timestamp}) + "\n")


def write_supervisor_state(path: Path, *, generated_at: str = "2026-01-02T14:35:00+00:00") -> None:
    path.parent.mkdir(parents=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "node_id": "test-node",
                "status": "ok",
                "generated_at": generated_at,
                "jobs": [
                    {
                        "id": "example",
                        "status": "ok",
                        "last_started_at": "2026-01-02T14:30:00+00:00",
                        "last_returncode": 0,
                    }
                ],
            },
            sort_keys=True,
        )
    )


def write_supervisor_config(path: Path, *, marker: Path, state_file: Path, log_dir: Path) -> None:
    script = path.parent / "supervisor_job.py"
    script.write_text(
        "\n".join(
            [
                "from pathlib import Path",
                f"Path({str(marker)!r}).write_text('ran\\n')",
            ]
        )
        + "\n"
    )
    path.write_text(
        json.dumps(
            {
                "node_id": "test-node",
                "supervisor": {
                    "state_file": str(state_file),
                    "log_dir": str(log_dir),
                    "poll_seconds": 1,
                },
                "jobs": [
                    {
                        "id": "example",
                        "enabled": True,
                        "cwd": str(path.parent),
                        "process_mode": "blocking",
                        "command": [sys.executable, str(script)],
                        "schedule": {
                            "market": "always",
                            "run_on_start": True,
                            "interval_seconds": 3600,
                            "max_runtime_seconds": 10,
                        },
                    }
                ],
            },
            sort_keys=True,
        )
    )


def write_audit_log(path: Path, rows: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))


def post_json(base_url: str, path: str, payload: dict) -> dict:
    req = request.Request(
        f"{base_url}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def write_fetch_manifest(path: Path, *, output_path: str = "cache/ibkr/SPY_5min.parquet") -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "job_id": "stock_history_20260102",
                "kind": "stock_history",
                "status": "completed",
                "started_at": "2026-01-02T14:30:00+00:00",
                "finished_at": "2026-01-02T14:31:00+00:00",
                "parameters": {
                    "bar_size": "5min",
                    "duration": "1 D",
                    "out_dir": "cache/ibkr",
                },
                "plan": {
                    "range_start": "2026-01-02",
                    "range_end": "2026-01-02",
                },
                "symbols_requested": ["SPY", "QQQ"],
                "symbols": {
                    "SPY": {
                        "symbol": "SPY",
                        "status": "ok",
                        "bars": 3,
                        "first_timestamp": "2026-01-02T14:30:00+00:00",
                        "last_timestamp": "2026-01-02T14:40:00+00:00",
                    },
                    "QQQ": {
                        "symbol": "QQQ",
                        "status": "failed",
                        "message": "No market data permissions",
                    },
                },
                "outputs": [
                    {
                        "timestamp": "2026-01-02T14:31:00+00:00",
                        "symbol": "SPY",
                        "status": "ok",
                        "rows": 3,
                        "path": output_path,
                        "elapsed_seconds": 0.4,
                        "attempt_count": 1,
                    }
                ],
                "errors": [
                    {
                        "timestamp": "2026-01-02T14:31:00+00:00",
                        "symbol": "QQQ",
                        "kind": "permission",
                        "message": "No market data permissions",
                        "attempt_count": 2,
                    }
                ],
                "events": [
                    {
                        "timestamp": "2026-01-02T14:30:30+00:00",
                        "type": "retry",
                        "symbol": "QQQ",
                        "day": "2026-01-02",
                        "attempt": 1,
                        "max_retries": 2,
                        "delay_seconds": 5.0,
                        "message": "temporary HMDS error",
                    },
                    {
                        "timestamp": "2026-01-02T14:30:35+00:00",
                        "type": "pacing_wait",
                        "symbol": "SPY",
                        "day": "2026-01-02",
                        "seconds": 0.35,
                        "reason": "post historical data request",
                        "message": "post historical data request: waited 0.350s",
                    },
                ],
                "counts": {
                    "requested_symbols": 2,
                    "tracked_symbols": 2,
                    "success_symbols": 1,
                    "failed_symbols": 1,
                    "partial_symbols": 0,
                    "empty_symbols": 0,
                    "skipped_symbols": 0,
                    "outputs": 1,
                    "errors": 1,
                    "rows": 3,
                    "success_chunks": 1,
                    "empty_chunks": 0,
                    "failed_chunks": 1,
                    "status_counts": {"failed": 1, "ok": 1},
                    "output_status_counts": {"ok": 1},
                    "error_kind_counts": {"permission": 1},
                    "retry_events": 1,
                    "pacing_wait_events": 1,
                    "pacing_wait_seconds": 0.35,
                    "avg_output_elapsed_seconds": 0.4,
                    "latest_completed_chunks": 1,
                    "latest_remaining_chunks": 0,
                    "latest_eta_seconds": 0.0,
                    "latest_avg_chunk_seconds": 0.4,
                },
            },
            sort_keys=True,
        )
    )


def test_collect_status_from_run_dir(tmp_path):
    run_dir = tmp_path / "run"
    supervisor_state = tmp_path / "supervisor" / "status.json"
    write_run(run_dir)
    write_supervisor_state(supervisor_state)

    payload = collect_status({
        "node_id": "test-node",
        "gateway": {"enabled": False},
        "runs": [{"id": "example", "path": str(run_dir)}],
        "supervisors": [{"id": "supervisor", "path": str(supervisor_state)}],
    })

    assert payload["schema_version"] == 1
    assert payload["node_id"] == "test-node"
    assert payload["status"] == "ok"
    assert payload["runs"][0]["metrics"]["decisions"] == 1
    assert payload["supervisors"][0]["job_status_counts"] == {"ok": 1}
    assert payload["gateway"]["reachable"] is None


def test_collect_status_includes_opt_in_recent_run_events(tmp_path):
    run_dir = tmp_path / "run"
    write_run(run_dir)
    (run_dir / "orders.jsonl").write_text(
        json.dumps({
            "timestamp": "2026-01-02T14:30:00+00:00",
            "status": "observed",
            "symbol": "SPY",
            "side": "buy",
            "tag": "example",
        })
        + "\n"
    )
    (run_dir / "fills.jsonl").write_text(
        json.dumps({
            "timestamp": "2026-01-02T14:30:00+00:00",
            "symbol": "SPY",
            "side": "buy",
            "quantity": 1,
            "price": 100.0,
        })
        + "\n"
    )

    payload = collect_status({
        "node_id": "test-node",
        "runs": [
            {
                "id": "example",
                "path": str(run_dir),
                "recent_events": {"enabled": True, "max_rows": 1},
            }
        ],
    })

    recent = payload["runs"][0]["recent_events"]
    assert recent["max_rows"] == 1
    assert recent["decisions"][0]["timestamp"] == "2026-01-02T14:30:00+00:00"
    assert recent["orders"][0]["symbol"] == "SPY"
    assert recent["fills"][0]["price"] == 100.0


def test_collect_status_warns_on_invalid_recent_run_events_config(tmp_path):
    run_dir = tmp_path / "run"
    write_run(run_dir)

    payload = collect_status({
        "node_id": "test-node",
        "runs": [{"id": "example", "path": str(run_dir), "recent_events": {"max_rows": 0}}],
    })

    assert payload["status"] == "warn"
    assert payload["runs"][0]["status"] == "ok"
    assert payload["runs"][0]["recent_events"] is None
    assert payload["alerts"][0]["kind"] == "run_recent_events_config"


def test_collect_status_summarizes_remote_control_audit(tmp_path):
    audit_log = tmp_path / "audit.jsonl"
    write_audit_log(
        audit_log,
        [
            {
                "event": "command_result",
                "result": {
                    "action": "summarize_run",
                    "status": "completed",
                    "post_result": {"status": "ok"},
                },
            },
            {
                "event": "command_result",
                "result": {
                    "action": "run_supervisor_once",
                    "status": "completed",
                    "post_result": {"status": "ok"},
                },
            },
        ],
    )

    payload = collect_status({
        "node_id": "test-node",
        "remote_control": {
            "enabled": True,
            "audit": {"log_file": str(audit_log), "max_events": 10},
        },
    })

    assert payload["status"] == "ok"
    assert payload["remote_control"]["audit_exists"] is True
    assert payload["remote_control"]["event_counts"] == {"command_result": 2}
    assert payload["remote_control"]["result_status_counts"] == {"completed": 2}
    assert payload["remote_control"]["post_status_counts"] == {"ok": 2}


def test_collect_status_warns_on_stale_run(tmp_path):
    run_dir = tmp_path / "run"
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    write_run(run_dir, timestamp=old)

    payload = collect_status({
        "node_id": "test-node",
        "runs": [{"id": "example", "path": str(run_dir), "max_age_seconds": 60}],
    })

    assert payload["status"] == "warn"
    assert payload["runs"][0]["freshness"]["stale"] is True
    assert any(alert["kind"] == "run_stale" for alert in payload["alerts"])


def test_gateway_alerts_classify_api_and_login_failures():
    disconnected = gateway_alerts({
        "enabled": True,
        "reachable": False,
        "host": "127.0.0.1",
        "port": 4002,
        "error": "connection refused",
    })
    login = gateway_alerts({
        "enabled": True,
        "reachable": False,
        "host": "127.0.0.1",
        "port": 4002,
        "error": "session not logged in",
    })

    assert {alert["kind"] for alert in disconnected} == {"gateway_unreachable", "gateway_api_disconnected"}
    assert {alert["kind"] for alert in login} == {"gateway_unreachable", "gateway_login_required"}


def test_collect_status_warns_on_run_operational_alerts(tmp_path):
    run_dir = tmp_path / "run"
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    write_run(
        run_dir,
        timestamp=old,
        summary_extra={
            "latest_data_time": old,
            "account_end_time": old,
            "rejections": 2,
            "final_positions": {"SPY": 3},
        },
    )
    (run_dir / "orders.jsonl").write_text(
        json.dumps({"timestamp": old, "status": "rejected", "reason": "risk limit", "symbol": "SPY"})
        + "\n"
    )

    payload = collect_status({
        "node_id": "test-node",
        "runs": [{
            "id": "example",
            "path": str(run_dir),
            "max_data_age_seconds": 60,
            "max_account_age_seconds": 60,
            "expected_position_state": "flat",
        }],
    })

    kinds = {alert["kind"] for alert in payload["alerts"]}
    assert payload["status"] == "warn"
    assert payload["runs"][0]["data_freshness"]["stale"] is True
    assert payload["runs"][0]["account_freshness"]["stale"] is True
    assert payload["runs"][0]["expected_position_state"] == "flat"
    assert payload["runs"][0]["position_count"] == 1
    assert {
        "stale_bars",
        "stale_account_snapshot",
        "rejected_orders",
        "risk_limit_trip",
        "unexpected_positioned_state",
    }.issubset(kinds)


def test_collect_status_warns_on_unexpected_flat_state(tmp_path):
    run_dir = tmp_path / "run"
    write_run(run_dir)

    payload = collect_status({
        "node_id": "test-node",
        "runs": [{"id": "example", "path": str(run_dir), "expected_position_state": "positioned"}],
    })

    assert any(alert["kind"] == "unexpected_flat_state" for alert in payload["alerts"])


def test_collect_status_warns_on_stale_supervisor(tmp_path):
    supervisor_state = tmp_path / "supervisor" / "status.json"
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    write_supervisor_state(supervisor_state, generated_at=old)

    payload = collect_status({
        "node_id": "test-node",
        "supervisors": [{"id": "supervisor", "path": str(supervisor_state), "max_age_seconds": 60}],
    })

    assert payload["status"] == "warn"
    assert payload["supervisors"][0]["freshness"]["stale"] is True
    assert any(alert["kind"] == "supervisor_stale" for alert in payload["alerts"])


def test_collect_status_warns_on_stale_remote_control_audit(tmp_path):
    audit_log = tmp_path / "audit.jsonl"
    old = (datetime.now(timezone.utc) - timedelta(hours=2)).isoformat()
    write_audit_log(
        audit_log,
        [
            {
                "audited_at": old,
                "event": "command_result",
                "result": {
                    "action": "run_supervisor_once",
                    "status": "completed",
                    "post_result": {"status": "ok"},
                },
            },
        ],
    )

    payload = collect_status({
        "node_id": "test-node",
        "remote_control": {
            "enabled": True,
            "audit": {"log_file": str(audit_log), "max_events": 10, "max_age_seconds": 60},
        },
    })

    assert payload["status"] == "warn"
    assert payload["remote_control"]["freshness"]["stale"] is True
    assert any(alert["kind"] == "remote_control_audit_stale" for alert in payload["alerts"])


def test_collect_status_warns_on_remote_control_poll_failure(tmp_path):
    audit_log = tmp_path / "audit.jsonl"
    write_audit_log(
        audit_log,
        [
            {
                "event": "poll_failed",
                "result": {
                    "action": "poll",
                    "status": "failed",
                    "error": "connection refused",
                },
            },
        ],
    )

    payload = collect_status({
        "node_id": "test-node",
        "remote_control": {
            "enabled": True,
            "audit": {"log_file": str(audit_log), "max_events": 10},
        },
    })

    assert payload["status"] == "warn"
    assert payload["remote_control"]["latest_event"]["event"] == "poll_failed"
    assert payload["alerts"][0]["kind"] == "remote_control_poll_failed"


def test_collect_status_warns_on_missing_run(tmp_path):
    payload = collect_status({
        "node_id": "test-node",
        "runs": [{"id": "missing", "path": str(tmp_path / "missing")}],
    })

    assert payload["status"] == "warn"
    assert payload["runs"][0]["status"] == "missing"
    assert payload["alerts"][0]["kind"] == "run_missing"


def test_collect_status_warns_on_missing_supervisor(tmp_path):
    payload = collect_status({
        "node_id": "test-node",
        "supervisors": [{"id": "missing", "path": str(tmp_path / "missing.json")}],
    })

    assert payload["status"] == "warn"
    assert payload["supervisors"][0]["status"] == "missing"
    assert payload["alerts"][0]["kind"] == "supervisor_missing"


def test_publish_status_writes_file(tmp_path):
    run_dir = tmp_path / "run"
    out = tmp_path / "latest_status.json"
    write_run(run_dir)

    payload = publish_status(
        {
            "node_id": "test-node",
            "runs": [str(run_dir)],
            "publish": {"file": str(out)},
        }
    )

    saved = json.loads(out.read_text())
    assert saved["node_id"] == "test-node"
    assert payload["runs"][0]["status"] == "ok"


def test_cloud_status_server_receives_and_serves_status(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        endpoint = f"http://127.0.0.1:{server.server_address[1]}/status"
        post_status(endpoint, {"schema_version": 1, "node_id": "test-node", "status": "ok"})

        with request.urlopen(endpoint, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        assert payload["node_id"] == "test-node"
        assert payload["received_at"]

        with request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/", timeout=5) as resp:
            html = resp.read().decode("utf-8")
        assert "Trading Harness Workbench" in html
        assert "/dashboard/app.js" in html
        assert "supervisors-body" in html
        assert "remote-control-body" in html
        assert "data-catalog-body" in html
        assert "data-root-cards" in html
        assert "data-symbol-count" in html
        assert "data-file-count" in html
        assert "data-date-range" in html
        assert "data-quality-summary" in html
        assert "data-catalog-scan-note" in html
        assert "data-catalog-scan-body" in html
        assert "data-storage-scan-limit" in html
        assert "data-storage-audit-body" in html
        assert "data-symbol-browser-input" in html
        assert "data-symbol-browser-dataset" in html
        assert "data-symbol-browser-matches" in html
        assert "data-coverage-grid" in html
        assert "data-gap-summary-note" in html
        assert "data-gap-summary-body" in html
        assert "data-calendar-gap-body" in html
        assert "data-minute-heatmap-note" in html
        assert "data-minute-heatmap-grid" in html
        assert "data-minute-heatmap-body" in html
        assert "data-symbol-diagnostic-form" in html
        assert "data-symbol-candidates-body" in html
        assert "data-detail-form" in html
        assert "data-detail-viewer-note" in html
        assert "data-detail-chart-style" in html
        assert "data-detail-timezone" in html
        assert "data-compare-timezone" in html
        assert "copy-data-path" in html
        assert "copy-data-root-flag" in html
        assert "copy-data-replay-command" in html
        assert "nav-performance" in html
        assert "performance-context-note" in html
        assert "performance-metric-context" in html
        assert "nav-fetch" in html
        assert "fetch-manifests-body" in html
        assert "fetch-events-body" in html
        assert "copy-fetch-resume-command" in html
        assert "overview-health-grid" in html
        assert "overview-positions-grid" in html
        assert "overview-change-cards" in html
        assert "overview-changes-note" in html
        assert "overview-timeline-body" in html
        assert "overview-cash" in html
        assert "overview-realized-pnl" in html
        assert "overview-unrealized-pnl" in html
        assert "overview-today-return" in html
        assert "overview-week-return" in html
        assert "overview-exposure" in html
        assert "overview-next-check" in html
        assert "performance-drawdown-chart" in html
        assert "performance-intraday-chart" in html
        assert "performance-intraday-pnl" in html
        assert "performance-daily-return-chart" in html
        assert "performance-calendar-chart" in html
        assert "performance-benchmark" in html
        assert "performance-load-benchmark" in html
        assert "performance-benchmark-chart" in html
        assert "performance-benchmark-note" in html
        assert "performance-source-mode" in html
        assert "performance-period" in html
        assert "performance-trades-body" in html
        assert "performance-profit-factor" in html
        assert "performance-avg-win-loss" in html
        assert "performance-turnover" in html
        assert "performance-equity" in html
        assert "comparison-filter-text" in html
        assert "runtime-status-grid" in html
        assert "runtime-status-note" in html
        assert "paper-monitor-note" in html
        assert "paper-monitor-guide" in html
        assert "remote-nodes-note" in html
        assert "remote-nodes-body" in html
        assert "remote-node-detail-note" in html
        assert "remote-node-history-body" in html
        assert "current-orders-body" in html
        assert "current-positions-grid" in html
        assert "Page Guide" in html
        assert "Web UI Runbook" in html
        assert "doc-link-grid" in html
        assert "Inspect Saved Historical Data" in html
        assert "Public Publishing Boundary" in html
        assert "workbench-guide-note" in html
        assert "workbench-guide" in html
        assert "config-plugin-boundary-note" in html
        assert "config-plugin-boundary" in html
        assert "config-form" in html
        assert "config-form-fields" in html
        assert "config-commands" in html
        assert "endpoint-map-body" in html

        with request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/dashboard/styles.css", timeout=5) as resp:
            css = resp.read().decode("utf-8")
        assert ".topbar" in css
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_workbench_endpoint_map(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/workbench_endpoints", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        endpoints = {(item["method"], item["path"]) for item in payload["endpoints"]}
        assert payload["count"] == len(payload["endpoints"])
        assert payload["categories"]["workbench"] >= 1
        assert ("GET", "/remote_nodes") in endpoints
        assert ("GET", "/remote_node_detail") in endpoints
        assert ("GET", "/workbench_snapshot_export") in endpoints
        assert ("GET", "/workbench_endpoints") in endpoints
        assert ("GET", "/data_coverage") in endpoints
        assert ("GET", "/data_gap_summary") in endpoints
        assert ("GET", "/data_symbol_diagnostic") in endpoints
        assert ("GET", "/data_storage_audit") in endpoints
        assert ("POST", "/data_compare") in endpoints
        assert ("GET", "/fetch_manifests") in endpoints
        assert ("GET", "/fetch_manifest_detail") in endpoints
        assert ("GET", "/config_draft_validations") in endpoints
        assert ("GET", "/config_draft_run_artifacts_export") in endpoints
        assert ("GET", "/config_draft_daily_rollups") in endpoints
        assert ("GET", "/docs/{name}") in endpoints
        assert ("POST", "/config_draft/run") in endpoints
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_allowlisted_public_docs(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/docs/web_ui_runbook.md", timeout=5) as resp:
            body = resp.read().decode("utf-8")
            assert resp.headers["Content-Type"].startswith("text/markdown")
        assert "Web UI Runbook" in body
        for name, expected in {
            "ibkr_gateway_runbook.md": "IBKR Gateway Runbook",
            "paper_trading_runbook.md": "Paper Trading Runbook",
            "market_data_permissions_runbook.md": "Market Data Permissions Runbook",
            "service_restart_runbook.md": "Service Restart Runbook",
            "failed_order_diagnosis_runbook.md": "Failed Order Diagnosis Runbook",
            "cloud_monitoring_deployment.md": "Cloud Monitoring Deployment",
        }.items():
            with request.urlopen(f"{base}/docs/{name}", timeout=5) as resp:
                body = resp.read().decode("utf-8")
                assert resp.headers["Content-Type"].startswith("text/markdown")
            assert expected in body

        for path in ["/docs/../README.md", "/docs/not_allowlisted.md"]:
            try:
                request.urlopen(f"{base}{path}", timeout=5)
            except error.HTTPError as exc:
                assert exc.code == 404
            else:
                raise AssertionError(f"{path} should not be served")
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_status_history(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        endpoint = f"{base}/status"
        post_status(
            endpoint,
            {
                "schema_version": 1,
                "node_id": "test-node",
                "status": "warn",
                "generated_at": "2026-01-02T14:30:00+00:00",
                "gateway": {"reachable": False},
                "runs": [{"id": "run-a", "status": "ok"}],
                "supervisors": [{"id": "sup-a", "status": "failed"}],
                "alerts": [{"level": "warn", "kind": "example", "message": "old"}],
            },
        )
        post_status(
            endpoint,
            {
                "schema_version": 1,
                "node_id": "other-node",
                "status": "ok",
                "generated_at": "2026-01-02T14:31:00+00:00",
            },
        )
        post_status(
            endpoint,
            {
                "schema_version": 1,
                "node_id": "test-node",
                "status": "ok",
                "generated_at": "2026-01-02T14:32:00+00:00",
                "gateway": {"reachable": True},
                "runs": [
                    {
                        "id": "run-a",
                        "status": "ok",
                        "metrics": {
                            "mode": "paper",
                            "final_equity": 10123.45,
                            "final_cash": 9123.45,
                            "final_positions": {"SPY": 2, "QQQ": 0},
                            "account_end_time": "2026-01-02T14:31:00+00:00",
                            "latest_data_time": "2026-01-02T14:31:00+00:00",
                            "last_decision_time": "2026-01-02T14:31:00+00:00",
                            "rejections": 1,
                        },
                        "recent_events": {
                            "decisions": [{"timestamp": "2026-01-02T14:31:00+00:00"}],
                            "orders": [{"timestamp": "2026-01-02T14:31:01+00:00", "status": "Submitted"}],
                            "fills": [{"timestamp": "2026-01-02T14:31:02+00:00"}],
                        },
                    },
                    {"id": "run-b", "status": "missing"},
                ],
                "supervisors": [{"id": "sup-a", "status": "ok"}],
                "remote_control": {
                    "latest_event": {
                        "event": "command_result",
                        "result": {"action": "request_status", "status": "completed"},
                    },
                },
            },
        )

        with request.urlopen(f"{base}/status_history?node_id=test-node&limit=1", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["total"] == 2
        assert payload["count"] == 1
        assert payload["limit"] == 1
        assert payload["history"][0]["node_id"] == "test-node"
        assert payload["history"][0]["status"] == "ok"
        assert payload["history"][0]["gateway_reachable"] is True
        assert payload["history"][0]["run_count"] == 2
        assert payload["history"][0]["run_status_counts"] == {"missing": 1, "ok": 1}
        assert payload["history"][0]["supervisor_status_counts"] == {"ok": 1}
        assert payload["history"][0]["remote_latest_event"] == "command_result"
        assert payload["history"][0]["remote_latest_action"] == "request_status"

        with request.urlopen(f"{base}/status_history?limit=5", timeout=5) as resp:
            all_nodes = json.loads(resp.read().decode("utf-8"))
        assert all_nodes["total"] == 3
        assert [row["node_id"] for row in all_nodes["history"]] == ["test-node", "other-node", "test-node"]

        with request.urlopen(f"{base}/remote_nodes?limit=5", timeout=5) as resp:
            remote_nodes = json.loads(resp.read().decode("utf-8"))
        assert remote_nodes["total"] == 3
        assert remote_nodes["count"] == 2
        by_node = {row["node_id"]: row for row in remote_nodes["nodes"]}
        assert by_node["test-node"]["status"] == "ok"
        assert by_node["test-node"]["gateway_reachable"] is True
        assert by_node["test-node"]["latest_run_id"] == "run-a"
        assert by_node["test-node"]["mode"] == "paper"
        assert by_node["test-node"]["final_equity"] == 10123.45
        assert by_node["test-node"]["cash"] == 9123.45
        assert by_node["test-node"]["position_count"] == 1
        assert by_node["test-node"]["open_order_count"] == 1
        assert by_node["test-node"]["decision_count"] == 1
        assert by_node["test-node"]["order_count"] == 1
        assert by_node["test-node"]["fill_count"] == 1
        assert by_node["test-node"]["rejection_count"] == 1
        assert by_node["test-node"]["latest_account_time"] == "2026-01-02T14:31:00+00:00"

        with request.urlopen(f"{base}/remote_node_detail?node_id=test-node&limit=2", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
        assert detail["node_id"] == "test-node"
        assert detail["total"] == 2
        assert detail["count"] == 2
        assert detail["summary"]["latest_run_id"] == "run-a"
        assert detail["alerts"] == []
        assert detail["runs"][0]["id"] == "run-a"
        assert detail["runs"][0]["mode"] == "paper"
        assert detail["runs"][0]["position_count"] == 1
        assert detail["runs"][0]["recent_orders"][0]["status"] == "Submitted"
        assert detail["supervisors"][0]["id"] == "sup-a"
        assert [row["status"] for row in detail["history"]] == ["ok", "warn"]
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_rejects_invalid_status_history_limit(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            request.urlopen(f"{base}/status_history?limit=0", timeout=5)
            raise AssertionError("expected invalid limit response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "limit must be between 1 and 500"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_loads_dashboard_settings_from_config(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    config_path = tmp_path / "cloud_status.yaml"
    config_path.write_text(
        "\n".join(
            [
                "dashboard:",
                "  host: 0.0.0.0",
                "  port: 9999",
                "  state_dir: custom_state",
                "  dashboard_dir: custom_dashboard",
                "  auth_token_env: TOKEN_ENV",
                "  data_roots:",
                f"    - {data_root}",
                "  fetch_manifest_roots:",
                f"    - {tmp_path / 'fetch_manifests'}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    settings = status_server.dashboard_server_settings(config_path)

    assert settings["host"] == "0.0.0.0"
    assert settings["port"] == 9999
    assert settings["state_dir"] == Path("custom_state")
    assert settings["dashboard_dir"] == Path("custom_dashboard")
    assert settings["auth_token_env"] == "TOKEN_ENV"
    assert settings["data_roots"] == [data_root]
    assert settings["fetch_manifest_roots"] == [tmp_path / "fetch_manifests"]

    override = status_server.dashboard_server_settings(
        config_path,
        host="127.0.0.1",
        port=0,
        data_roots=[tmp_path / "override"],
        fetch_manifest_roots=[tmp_path / "manifest_override"],
        auth_token_env="OTHER_TOKEN",
    )
    assert override["host"] == "127.0.0.1"
    assert override["port"] == 0
    assert override["data_roots"] == [tmp_path / "override"]
    assert override["fetch_manifest_roots"] == [tmp_path / "manifest_override"]
    assert override["auth_token_env"] == "OTHER_TOKEN"


def test_cloud_status_server_classifies_data_root_scope(tmp_path):
    assert status_server.classify_data_root(status_server.ROOT / "examples" / "data") == "public_example"
    assert status_server.classify_data_root(tmp_path / "cache" / "ibkr") == "local_cache"
    assert status_server.classify_data_root(tmp_path / "private" / "history") == "private_local"
    assert status_server.classify_data_root(tmp_path / "custom_history") == "local_path"


def test_cloud_status_server_serves_fetch_manifests(tmp_path):
    manifest_root = tmp_path / "fetch_manifests"
    data_root = tmp_path / "cache" / "ibkr"
    data_root.mkdir(parents=True)
    data_file = data_root / "SPY_5min.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00+00:00,100,101,99,100,1000",
                "2026-01-02T14:35:00+00:00,100,101,99,100.5,1000",
                "2026-01-02T14:40:00+00:00,100,101,99,101,1000",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    write_fetch_manifest(manifest_root / "stock_history_20260102.json", output_path=str(data_file))
    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        data_roots=[data_root],
        fetch_manifest_roots=[manifest_root],
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/fetch_manifests?limit=5", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["count"] == 1
        assert payload["total"] == 1
        assert payload["status_counts"] == {"completed": 1}
        assert payload["kind_counts"] == {"stock_history": 1}
        assert payload["roots"][0]["manifest_count"] == 1
        manifest = payload["manifests"][0]
        assert manifest["job_id"] == "stock_history_20260102"
        assert manifest["status"] == "completed"
        assert manifest["symbols_requested"] == 2
        assert manifest["success_symbols"] == 1
        assert manifest["failed_symbols"] == 1
        assert manifest["rows"] == 3
        assert manifest["error_kind_counts"] == {"permission": 1}
        assert manifest["retry_events"] == 1
        assert manifest["pacing_wait_events"] == 1
        assert manifest["pacing_wait_seconds"] == 0.35
        assert manifest["latest_avg_chunk_seconds"] == 0.4

        with request.urlopen(f"{base}/fetch_manifest_detail?job_id=stock_history_20260102&limit=10", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
        assert detail["job_id"] == "stock_history_20260102"
        assert detail["output_total"] == 1
        assert detail["error_total"] == 1
        assert detail["symbols"][0]["symbol"] in {"QQQ", "SPY"}
        assert detail["outputs"][0]["path"] == str(data_file)
        assert detail["outputs"][0]["data_detail_available"] is True
        assert detail["outputs"][0]["data_detail_path"] == str(data_file)
        assert detail["outputs"][0]["elapsed_seconds"] == 0.4
        assert detail["errors"][0]["kind"] == "permission"
        assert detail["errors"][0]["attempt_count"] == 2
        assert detail["counts"]["retry_events"] == 1
        assert detail["events"][0]["type"] == "retry"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_data_catalog(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "SPY_5min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
                "2026-01-02T14:35:00Z,100.5,101,100,100.75,1100",
                "2026-01-02T14:45:00Z,100.75,102,100.5,101.25,900",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (data_root / "notes.txt").write_text("not market data\n", encoding="utf-8")
    (data_root / "BROKEN_5min_sample.parquet").write_bytes(b"not a parquet file")
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_catalog?limit=5&preview_points=3", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["count"] == 1
        assert payload["quality_counts"] == {"ok": 1}
        assert payload["bar_size_counts"] == {"5min": 1}
        assert payload["row_count_total"] == 3
        assert payload["size_bytes_total"] > 0
        assert payload["latest_modified_at"]
        assert payload["error_count"] == 1
        assert payload["errors"][0]["root"] == str(data_root.resolve())
        scan = payload["root_summaries"][0]
        assert scan["candidate_count"] == 2
        assert scan["parsed_count"] == 1
        assert scan["parse_error_count"] == 1
        assert scan["unsupported_file_count"] == 1
        assert scan["sample_errors"][0]["path"].endswith("BROKEN_5min_sample.parquet")
        assert scan["sample_unsupported_files"][0]["path"].endswith("notes.txt")
        assert scan["sample_unsupported_files"][0]["reason"] == "unsupported extension .txt"
        assert scan["sample_skipped_files"][0]["path"].endswith("BROKEN_5min_sample.parquet")
        assert scan["sample_skipped_files"][1]["path"].endswith("notes.txt")
        assert scan["scan_duration_ms"] >= 0
        dataset = payload["datasets"][0]
        assert dataset["symbol"] == "SPY"
        assert dataset["asset_class"] == "etf"
        assert dataset["source"] == "file"
        assert dataset["bar_size"] == "5min"
        assert dataset["rows"] == 3
        assert dataset["timestamp_column"] == "timestamp"
        assert dataset["source_timezone"] == "offset-aware"
        assert dataset["normalized_timezone"] == "UTC"
        assert dataset["median_interval_seconds"] == 450.0
        assert dataset["largest_gap_seconds"] == 600.0
        assert dataset["estimated_missing_intervals"] == 0
        assert dataset["quality_status"] == "ok"
        assert dataset["quality_warnings"] == []
        assert len(dataset["preview"]) == 3
        assert dataset["preview"][-1]["close"] == 101.25

        with request.urlopen(f"{base}/data_catalog_export?limit=5", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="saved_data_catalog.csv"'
            csv_body = resp.read().decode("utf-8")
        exported = list(csv.DictReader(io.StringIO(csv_body)))
        assert len(exported) == 1
        assert exported[0]["symbol"] == "SPY"
        assert exported[0]["asset_class"] == "etf"
        assert exported[0]["source"] == "file"
        assert exported[0]["quality_status"] == "ok"
        assert exported[0]["bar_size"] == "5min"

        with request.urlopen(f"{base}/data_coverage?limit=5&max_symbols=5&max_dates=5", timeout=5) as resp:
            coverage = json.loads(resp.read().decode("utf-8"))
        assert coverage["count"] == 1
        assert coverage["symbols"][0]["symbol"] == "SPY"
        assert coverage["symbols"][0]["coverage"] == [True]
        assert coverage["date_bins"] == ["2026-01-02"]

        with request.urlopen(f"{base}/data_symbol_diagnostic?symbol=SPY&limit=5", timeout=5) as resp:
            diagnostic = json.loads(resp.read().decode("utf-8"))
        assert diagnostic["symbol"] == "SPY"
        assert diagnostic["status"] == "visible"
        assert diagnostic["catalog_matches"][0]["symbol"] == "SPY"
        assert diagnostic["configured_candidates"][0]["in_catalog_scope"] is True
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_data_gap_summary(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "GAP_5min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
                "2026-01-02T14:35:00Z,100.5,101,100,100.75,1100",
                "2026-01-02T14:40:00Z,100.75,102,100.5,101.25,900",
                "2026-01-04T14:40:00Z,101.25,102,101,101.5,900",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_gap_summary?catalog_limit=5&top_limit=5", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["status"] == "warn"
        assert payload["dataset_count"] == 1
        assert payload["files_with_gap_warnings"] == 1
        assert payload["files_with_missing_intervals"] == 1
        assert payload["total_estimated_missing_intervals"] > 0
        assert payload["largest_gap_seconds"] > 0
        assert payload["gap_rows"][0]["symbol"] == "GAP"
        assert payload["gap_rows"][0]["estimated_missing_intervals"] > 0
        assert payload["calendar_rows"][0]["symbol"] == "GAP"
        assert payload["calendar_rows"][0]["missing_calendar_days"] == 1
    finally:
        server.shutdown()
        server.server_close()


def test_data_catalog_discovers_many_nested_stock_and_crypto_files(tmp_path):
    pytest.importorskip("pyarrow")
    data_root = tmp_path / "history"
    stock_root = data_root / "cache" / "ibkr" / "stocks" / "1min"
    crypto_root = data_root / "cache" / "zerohash" / "crypto" / "1min"
    stock_root.mkdir(parents=True)
    crypto_root.mkdir(parents=True)
    for index in range(205):
        symbol = f"T{index:03d}"
        (stock_root / f"{symbol}_1min.csv").write_text(
            "\n".join(
                [
                    "timestamp,open,high,low,close,volume",
                    f"2026-01-02T14:30:00Z,{100 + index},101,99,{100 + index}.5,1000",
                    f"2026-01-02T14:31:00Z,{100 + index}.5,102,100,{101 + index}.0,1200",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
    crypto_frame = status_server.pd.DataFrame(
        {
            "timestamp": [
                "2026-01-02T00:00:00Z",
                "2026-01-02T00:01:00Z",
                "2026-01-02T00:02:00Z",
            ],
            "open": [50000.0, 50050.0, 50100.0],
            "high": [50100.0, 50200.0, 50300.0],
            "low": [49900.0, 50000.0, 50050.0],
            "close": [50050.0, 50100.0, 50250.0],
            "volume": [10.0, 12.0, 11.0],
        }
    )
    crypto_frame.to_parquet(crypto_root / "BTC-USD_1min.parquet", index=False)

    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_catalog?limit=250&preview_points=2", timeout=10) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["count"] == 206
        assert payload["count"] > 2
        assert payload["root_summaries"][0]["candidate_count"] == 206
        assert payload["root_summaries"][0]["parsed_count"] == 206
        assert payload["root_summaries"][0]["parse_error_count"] == 0
        assert payload["source_counts"]["ibkr"] == 205
        assert payload["source_counts"]["zerohash"] == 1
        assert payload["asset_class_counts"]["crypto"] == 1
        assert payload["bar_size_counts"]["1min"] == 206
        btc = next(item for item in payload["datasets"] if item["symbol"] == "BTC-USD")
        assert btc["format"] == "parquet"
        assert btc["asset_class"] == "crypto"
        assert btc["source"] == "zerohash"
        assert btc["bar_size"] == "1min"

        with request.urlopen(f"{base}/data_catalog?limit=50&preview_points=2", timeout=10) as resp:
            capped = json.loads(resp.read().decode("utf-8"))
        assert capped["count"] == 50
        assert capped["root_summaries"][0]["scan_capped"] is True
        assert capped["root_summaries"][0]["not_scanned_reason"] == "global catalog limit reached"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_data_storage_audit(tmp_path, monkeypatch):
    data_root = tmp_path / "configured"
    data_root.mkdir()
    suggested_root = tmp_path / "cache"
    suggested_root.mkdir()
    for root, symbol in [(data_root, "SPY"), (data_root, "QQQ"), (suggested_root, "ABC")]:
        (root / f"{symbol}_5min_sample.csv").write_text(
            "\n".join(
                [
                    "timestamp,open,high,low,close,volume",
                    "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
                    "2026-01-02T14:35:00Z,100.5,101,100,100.75,1100",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
    monkeypatch.setattr(status_server, "SUGGESTED_DATA_ROOTS", (suggested_root,))
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_storage_audit?catalog_limit=1&scan_limit=10", timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))

        assert audit["status"] == "warn"
        assert audit["catalog_visible_count"] == 1
        assert audit["configured_file_count"] == 2
        assert audit["hidden_configured_file_count"] == 1
        assert audit["suggested_file_count"] == 1
        configured = audit["configured_roots"][0]
        assert configured["display_path"] == str(data_root.resolve())
        assert configured["root_scope"] == "local_path"
        assert configured["root_scope_note"]
        assert configured["catalog_visible_count"] == 1
        assert configured["hidden_file_count"] == 1
        assert configured["sample_hidden_paths"][0].endswith("_5min_sample.csv")
        suggested = audit["suggested_roots"][0]
        assert suggested["display_path"] == str(suggested_root.resolve())
        assert suggested["configured"] is False
        assert suggested["root_scope"] == "local_cache"
        assert suggested["hidden_file_count"] == 1
    finally:
        server.shutdown()
        server.server_close()


def test_data_storage_audit_cli_reports_json_and_human(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(status_server, "SUGGESTED_DATA_ROOTS", ())
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "SPY_5min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
                "2026-01-02T14:35:00Z,100.5,101,100,100.75,1100",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (data_root / "BTC-USD_1min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,50000,50100,49900,50050,10",
                "2026-01-02T14:31:00Z,50050,50200,50000,50100,12",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    from scripts.audit_data_storage import run as run_storage_audit

    assert run_storage_audit([
        "--data-root",
        str(data_root),
        "--catalog-limit",
        "1",
        "--scan-limit",
        "10",
        "--json",
    ]) == 0
    payload = json.loads(capsys.readouterr().out)
    assert payload["status"] == "warn"
    assert payload["configured_file_count"] == 2
    assert payload["catalog_visible_count"] == 1
    assert payload["hidden_configured_file_count"] == 1
    assert payload["configured_extension_counts"] == {".csv": 2}
    assert payload["configured_asset_class_guess_counts"] == {"crypto": 1, "etf": 1}
    assert payload["configured_bar_size_guess_counts"] == {"1min": 1, "5min": 1}

    assert run_storage_audit([
        "--data-root",
        str(data_root),
        "--catalog-limit",
        "1",
        "--scan-limit",
        "10",
        "--fail-on-warn",
    ]) == 2
    report = capsys.readouterr().out
    assert "Storage Audit: warn" in report
    assert "Configured files: 2" in report
    assert "Recommended next steps:" in report


def test_cloud_status_server_symbol_diagnostic_finds_unconfigured_root(tmp_path, monkeypatch):
    configured_root = tmp_path / "configured"
    configured_root.mkdir()
    suggested_root = tmp_path / "cache"
    suggested_root.mkdir()
    (suggested_root / "ABC_5min_sample.csv").write_text(
        "timestamp,close\n2026-01-02T14:30:00Z,100\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(status_server, "SUGGESTED_DATA_ROOTS", (suggested_root,))

    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[configured_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_symbol_diagnostic?symbol=ABC&limit=5", timeout=5) as resp:
            diagnostic = json.loads(resp.read().decode("utf-8"))

        assert diagnostic["status"] == "not_configured"
        assert diagnostic["unconfigured_matches"][0]["path"].endswith("ABC_5min_sample.csv")
        assert diagnostic["root_summary"]["suggested"][0]["data_file_count"] == 1
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_suggests_unconfigured_data_roots(tmp_path, monkeypatch):
    configured_root = tmp_path / "configured"
    configured_root.mkdir()
    (configured_root / "SPY_5min_sample.csv").write_text(
        "timestamp,close\n2026-01-02T14:30:00Z,100\n",
        encoding="utf-8",
    )
    suggested_root = tmp_path / "cache"
    suggested_root.mkdir()
    (suggested_root / "QQQ_5min_sample.csv").write_text(
        "timestamp,close\n2026-01-02T14:30:00Z,200\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(status_server, "SUGGESTED_DATA_ROOTS", (suggested_root,))

    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[configured_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/workbench_diagnostics", timeout=5) as resp:
            diagnostics = json.loads(resp.read().decode("utf-8"))

        assert diagnostics["data_roots"][0]["data_file_count"] == 1
        assert diagnostics["data_roots"][0]["scope"] == "local_path"
        assert diagnostics["suggested_data_roots"][0]["data_file_count"] == 1
        assert diagnostics["suggested_data_roots"][0]["path"] == str(suggested_root.resolve())
        assert diagnostics["suggested_data_roots"][0]["scope"] == "local_cache"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_marks_data_catalog_quality(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "WARN_1min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,close,volume",
                "2026-01-02T14:30:00Z,100,1000",
                "not-a-time,,1100",
                "2026-01-02T14:40:00Z,101,",
                "2026-01-02T14:40:00Z,101.5,1200",
                "2026-01-02T15:00:00Z,102,1300",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (data_root / "BAD_1min_sample.csv").write_text(
        "\n".join(
            [
                "date,price",
                "not-a-time,100",
                "still-not-a-time,101",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_catalog?limit=5&preview_points=3", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        datasets = {item["symbol"]: item for item in payload["datasets"]}
        assert payload["quality_counts"] == {"bad": 1, "warn": 1}
        assert payload["bar_size_counts"] == {"1min": 2}
        assert datasets["WARN"]["quality_status"] == "warn"
        assert any("timestamp parse failures" in item for item in datasets["WARN"]["quality_warnings"])
        assert any("missing close values" in item for item in datasets["WARN"]["quality_warnings"])
        assert any("duplicate timestamps" in item for item in datasets["WARN"]["quality_warnings"])
        assert any("estimated missing intervals" in item for item in datasets["WARN"]["quality_warnings"])
        assert datasets["BAD"]["quality_status"] == "bad"
        assert "no parseable timestamps" in datasets["BAD"]["quality_warnings"]
        assert "no close/last column found" in datasets["BAD"]["quality_warnings"]

        alignment = post_json(
            base,
            "/data_alignment",
            {"datasets": [{"symbol": "WARN", "path": str(data_root / "WARN_1min_sample.csv")}]},
        )["alignment"]
        assert alignment["rows"][0]["quality_status"] == "warn"
        assert alignment["rows"][0]["quality_warning_count"] >= 1
        assert alignment["warning_count"] >= 1
        assert any("WARN: data quality warn" in item for item in alignment["warnings"])

        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "plugin_id": "no_edge_template",
                "datasets": [{"symbol": "WARN", "path": str(data_root / "WARN_1min_sample.csv")}],
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(draft_req, timeout=5)
            raise AssertionError("expected data quality acknowledgement response")
        except error.HTTPError as exc:
            assert exc.code == 400
            error_payload = json.loads(exc.read().decode("utf-8"))
        assert "selected datasets have data quality warnings: WARN" in error_payload["error"]

        allowed = post_json(
            base,
            "/config_draft",
            {
                "plugin_id": "no_edge_template",
                "datasets": [{"symbol": "WARN", "path": str(data_root / "WARN_1min_sample.csv")}],
                "allow_quality_warnings": True,
            },
        )["draft"]
        assert allowed["alignment"]["rows"][0]["quality_status"] == "warn"
        assert allowed["alignment"]["warning_count"] >= 1
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_rejects_invalid_data_catalog_preview_points(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[tmp_path / "missing"])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            request.urlopen(f"{base}/data_catalog?preview_points=1", timeout=5)
            raise AssertionError("expected invalid preview points response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "preview_points must be between 2 and 500"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_data_detail(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "SPY_5min_sample.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.0,1000",
                "2026-01-02T14:35:00Z,100,102,99,101.0,0",
                "2026-01-02T14:50:00Z,101,103,100,102.0,1500",
                "2026-01-02T14:55:00Z,102,104,101,103.0,2000",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_detail?path={data_file}&preview_points=4&gap_limit=5", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))

        assert detail["path"] == str(data_file)
        assert detail["symbol"] == "SPY"
        assert detail["asset_class"] == "etf"
        assert detail["source"] == "file"
        assert detail["rows"] == 4
        assert detail["column_map"]["close"] == "close"
        assert detail["preview"][0]["open"] == 100.0
        assert detail["preview"][0]["high"] == 101.0
        assert detail["preview"][0]["low"] == 99.0
        assert detail["coverage"]["median_interval_seconds"] == 300.0
        assert detail["coverage"]["largest_gap_seconds"] == 900.0
        assert detail["coverage"]["estimated_missing_intervals"] == 2
        assert detail["gaps"][0]["estimated_missing_intervals"] == 2
        assert detail["quality"]["quality_status"] == "warn"
        assert "2 estimated missing intervals" in detail["quality"]["quality_warnings"]
        assert detail["price_stats"]["start_close"] == 100.0
        assert detail["price_stats"]["end_close"] == 103.0
        assert abs(detail["price_stats"]["total_return_pct"] - 3.0) < 1e-9
        assert detail["return_stats"]["count"] == 3
        assert detail["volume_stats"]["zero_rows"] == 1
        assert len(detail["preview"]) == 4
        assert detail["viewer"]["available_rows"] == 4
        assert detail["viewer"]["filtered_rows"] == 4
        assert detail["viewer"]["sampled"] is False

        with request.urlopen(
            f"{base}/data_detail?"
            f"path={data_file}&preview_points=2&gap_limit=5&sample_mode=full"
            f"&start=2026-01-02T14:35:00Z&end=2026-01-02T14:50:00Z",
            timeout=5,
        ) as resp:
            filtered = json.loads(resp.read().decode("utf-8"))

        assert filtered["viewer"]["sample_mode"] == "full"
        assert filtered["viewer"]["filtered_rows"] == 2
        assert filtered["viewer"]["sampled_points"] == 2
        assert filtered["viewer"]["sampled"] is False
        assert filtered["price_stats"]["start_close"] == 101.0
        assert filtered["price_stats"]["end_close"] == 102.0
        assert len(filtered["preview"]) == 2
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_data_minute_heatmap(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "SPY_5min_sample.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.0,1000",
                "2026-01-02T14:35:00Z,100,102,99,101.0,1100",
                "2026-01-02T14:50:00Z,101,103,100,102.0,1200",
                "2026-01-02T14:55:00Z,102,104,101,103.0,1300",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_minute_heatmap?catalog_limit=10&top_limit=5", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["status"] == "warn"
        assert payload["dataset_count"] == 1
        assert payload["total_estimated_missing_intervals"] == 2
        assert payload["overall_completeness_pct"] == 66.66666666666666
        row0 = payload["rows"][0]
        assert row0["symbol"] == "SPY"
        assert row0["bar_size"] == "5min"
        assert row0["median_interval_seconds"] == 300.0
        assert row0["estimated_missing_intervals"] == 2
        hour14 = next(hour for hour in row0["hours"] if hour["hour_utc"] == 14)
        assert hour14["actual_intervals"] == 4
        assert hour14["estimated_missing_intervals"] == 2
        assert hour14["expected_intervals"] == 6
        assert row0["worst_hours"][0]["hour_utc"] == 14
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_compares_saved_data(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    spy_file = data_root / "SPY_5min_sample.csv"
    qqq_file = data_root / "QQQ_5min_sample.csv"
    spy_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.0,1000",
                "2026-01-02T14:35:00Z,100,102,99,101.0,1100",
                "2026-01-02T14:40:00Z,101,103,100,102.0,1200",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    qqq_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,200,201,199,200.0,1000",
                "2026-01-02T14:35:00Z,200,202,199,198.0,1100",
                "2026-01-02T14:40:00Z,198,203,197,204.0,1200",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        payload = {
            "datasets": [
                {"symbol": "SPY", "path": str(spy_file)},
                {"symbol": "QQQ", "path": str(qqq_file)},
            ],
            "preview_points": 3,
            "sample_mode": "full",
            "start": "2026-01-02T14:30:00Z",
            "end": "2026-01-02T14:40:00Z",
        }
        response = post_json(base, "/data_compare", payload)
        comparison = response["comparison"]

        assert comparison["dataset_count"] == 2
        assert comparison["common_timestamp_count"] == 3
        assert comparison["common_first_timestamp"] == "2026-01-02T14:30:00+00:00"
        assert comparison["common_last_timestamp"] == "2026-01-02T14:40:00+00:00"
        series = {row["symbol"]: row for row in comparison["series"]}
        assert series["SPY"]["filtered_rows"] == 3
        assert series["SPY"]["sampled"] is False
        assert abs(series["SPY"]["total_return_pct"] - 2.0) < 1e-9
        assert series["SPY"]["points"][0]["normalized_return_pct"] == 0.0
        assert abs(series["QQQ"]["total_return_pct"] - 2.0) < 1e-9
        assert abs(series["QQQ"]["points"][1]["normalized_return_pct"] - -1.0) < 1e-9
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_data_detail_rejects_outside_roots(tmp_path):
    data_root = tmp_path / "data"
    other_root = tmp_path / "other"
    data_root.mkdir()
    other_root.mkdir()
    data_file = other_root / "SPY.csv"
    data_file.write_text("timestamp,close\n2026-01-02T14:30:00Z,100\n", encoding="utf-8")
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            request.urlopen(f"{base}/data_detail?path={data_file}", timeout=5)
            raise AssertionError("expected outside data root response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "data file must be inside a configured data root"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_generates_and_saves_config_draft(tmp_path):
    data_root = tmp_path / "data"
    state_dir = tmp_path / "state"
    data_root.mkdir()
    data_file = data_root / "SPY_5min_sample.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
                "2026-01-02T14:35:00Z,100.5,101,100,100.75,1100",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, state_dir, data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/config_options", timeout=5) as resp:
            options = json.loads(resp.read().decode("utf-8"))
        plugin_ids = {plugin["id"] for plugin in options["plugins"]}
        assert plugin_ids == {"no_edge_template"}
        plugin = options["plugins"][0]
        assert options["config_schema_version"] == 1
        assert options["form_schema_version"] == 1
        assert plugin["visibility"] == "public_example"
        assert "not a viable trading strategy" in plugin["description"]
        assert "private plugins" in plugin["boundary"]
        assert options["run_actions"] == ["validate", "replay", "simulated_paper"]
        field_ids = [field["id"] for field in options["form_schema"]]
        assert field_ids[:4] == ["config-name", "config-plugin", "config-mode", "config-dataset"]
        assert "config-risk-preset" in field_ids
        assert "config-allow-quality-warnings" in field_ids
        risk_field = next(field for field in options["form_schema"] if field["id"] == "config-risk-preset")
        assert risk_field["options_source"] == "risk_presets"
        assert [preset["id"] for preset in options["risk_presets"]] == [
            "demo_minimal",
            "costed_demo",
            "larger_replay_demo",
        ]
        assert options["defaults"]["risk_preset"] == "demo_minimal"

        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "name": "Test Draft",
                "plugin_id": "no_edge_template",
                "mode": "simulated_paper",
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
                "start": "2026-01-02",
                "end": "2026-01-02",
                "starting_cash": 25000,
                "history_bars": 20,
                "risk_preset": "costed_demo",
                "max_steps": 5,
                "max_orders_per_run": 1,
                "max_notional_per_order": 100,
                "max_quantity": 10,
                "max_cash_quantity": 100,
                "max_gross_exposure_pct": 0.05,
                "save": True,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(draft_req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        draft = payload["draft"]
        assert draft["name"] == "Test_Draft"
        assert draft["validation"] == {"valid": True, "errors": []}
        assert draft["config"]["runner"]["mode"] == "simulated_paper"
        assert draft["config"]["metadata"]["risk_preset"] == "costed_demo"
        assert draft["config"]["metadata"]["date_range"] == {"start": "2026-01-02", "end": "2026-01-02"}
        assert draft["config"]["data"]["start"] == "2026-01-02"
        assert draft["config"]["data"]["end"] == "2026-01-02"
        assert draft["config"]["data"]["files"] == {"SPY": str(data_file)}
        assert draft["alignment"]["dataset_count"] == 1
        assert draft["alignment"]["symbols"] == ["SPY"]
        assert draft["alignment"]["filter_start"] == "2026-01-02T00:00:00+00:00"
        assert draft["alignment"]["filter_end"] == "2026-01-02T23:59:59.999999+00:00"
        assert draft["alignment"]["common_timestamp_count"] == 2
        assert draft["alignment"]["warning_count"] == 0
        assert "strategy_plugin: examples.strategies.no_edge_template:create_strategy" in draft["yaml"]
        assert "start: '2026-01-02'" in draft["yaml"]
        assert "end: '2026-01-02'" in draft["yaml"]
        assert draft["saved_path"]
        assert Path(draft["saved_path"]).exists()
        assert Path(draft["saved_path"]).is_relative_to(state_dir)
        assert "--validate-only" in draft["commands"]["validate"]

        with request.urlopen(f"{base}/config_draft_detail?draft_id=Test_Draft", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
        assert detail["draft"]["draft_id"] == "Test_Draft"
        assert detail["validation"] == {"valid": True, "errors": []}
        assert detail["alignment"]["common_timestamp_count"] == 2
        assert "strategy_plugin: examples.strategies.no_edge_template:create_strategy" in detail["yaml"]
        assert "--mode simulated-paper" in detail["commands"]["simulated_paper"]

        with request.urlopen(f"{base}/config_draft_yaml?draft_id=Test_Draft", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("application/x-yaml")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="Test_Draft.yaml"'
            yaml_body = resp.read().decode("utf-8")
        assert "strategy_plugin: examples.strategies.no_edge_template:create_strategy" in yaml_body
        assert "risk_preset: costed_demo" in yaml_body

        with request.urlopen(f"{base}/config_draft_validations", timeout=5) as resp:
            validations = json.loads(resp.read().decode("utf-8"))
        assert validations["count"] == 1
        assert validations["valid_count"] == 1
        assert validations["invalid_count"] == 0
        assert validations["validations"][0]["draft_id"] == "Test_Draft"
        assert validations["validations"][0]["valid"] is True
        assert validations["validations"][0]["errors"] == []
        assert validations["validations"][0]["folder"] == "config_drafts"
        assert validations["validations"][0]["status_label"] == "example_only"
        assert "simulated_paper" in validations["validations"][0]["tags"]

        bad_delete_req = request.Request(
            f"{base}/config_draft/delete",
            data=json.dumps({"draft_id": "Test_Draft"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(bad_delete_req, timeout=5)
            raise AssertionError("expected draft delete confirmation response")
        except error.HTTPError as exc:
            assert exc.code == 400
            delete_error = json.loads(exc.read().decode("utf-8"))
        assert delete_error["error"] == "confirm must be 'delete-draft'"

        delete_req = request.Request(
            f"{base}/config_draft/delete",
            data=json.dumps({"draft_id": "Test_Draft", "confirm": "delete-draft"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(delete_req, timeout=5) as resp:
            delete_payload = json.loads(resp.read().decode("utf-8"))
        assert delete_payload["result"]["deleted"] is True
        assert delete_payload["result"]["draft"]["draft_id"] == "Test_Draft"
        assert not Path(draft["saved_path"]).exists()
        with request.urlopen(f"{base}/config_drafts", timeout=5) as resp:
            drafts = json.loads(resp.read().decode("utf-8"))
        assert drafts["count"] == 0
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_runs_saved_config_draft(tmp_path):
    data_root = tmp_path / "data"
    state_dir = tmp_path / "state"
    data_root.mkdir()
    data_file = data_root / "SPY_5min_sample.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
                "2026-01-02T14:35:00Z,100.5,101,100,100.75,1100",
                "2026-01-02T14:40:00Z,100.75,102,100.5,101.25,900",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    qqq_file = data_root / "QQQ_5min_sample.csv"
    qqq_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,405,406,404,405.5,1000",
                "2026-01-02T14:35:00Z,405.5,406,405,405.75,1100",
                "2026-01-02T14:40:00Z,405.75,407,405.5,406.25,900",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, state_dir, data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "name": "Run Draft",
                "plugin_id": "no_edge_template",
                "mode": "simulated_paper",
                "datasets": [
                    {"symbol": "SPY", "path": str(data_file)},
                    {"symbol": "QQQ", "path": str(qqq_file)},
                ],
                "starting_cash": 25000,
                "history_bars": 20,
                "max_steps": 3,
                "max_orders_per_run": 1,
                "max_notional_per_order": 100,
                "max_quantity": 10,
                "max_cash_quantity": 100,
                "max_gross_exposure_pct": 0.05,
                "save": True,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(draft_req, timeout=5) as resp:
            draft_payload = json.loads(resp.read().decode("utf-8"))
        assert draft_payload["draft"]["name"] == "Run_Draft"
        assert draft_payload["draft"]["config"]["metadata"]["config_schema_version"] == 1
        assert draft_payload["draft"]["alignment"]["symbols"] == ["QQQ", "SPY"]
        assert draft_payload["draft"]["alignment"]["common_timestamp_count"] == 3
        assert draft_payload["draft"]["alignment"]["common_coverage_pct"] == 100.0

        alignment_req = request.Request(
            f"{base}/data_alignment",
            data=json.dumps({
                "datasets": [
                    {"symbol": "SPY", "path": str(data_file)},
                    {"symbol": "QQQ", "path": str(qqq_file)},
                ],
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(alignment_req, timeout=5) as resp:
            alignment_payload = json.loads(resp.read().decode("utf-8"))
        assert alignment_payload["alignment"]["common_timestamp_count"] == 3
        assert alignment_payload["alignment"]["warning_count"] == 0

        with request.urlopen(f"{base}/config_drafts", timeout=5) as resp:
            drafts = json.loads(resp.read().decode("utf-8"))
        assert drafts["count"] == 1
        assert drafts["drafts"][0]["draft_id"] == "Run_Draft"
        assert drafts["drafts"][0]["symbols"] == ["QQQ", "SPY"]
        assert drafts["drafts"][0]["folder"] == "config_drafts"
        assert drafts["drafts"][0]["status_label"] == "example_only"
        assert "2 symbols" in drafts["drafts"][0]["tags"]

        validate_req = request.Request(
            f"{base}/config_draft/run",
            data=json.dumps({
                "draft_id": "Run_Draft",
                "action": "validate",
                "max_steps": 2,
                "timeout_seconds": 10,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(validate_req, timeout=10) as resp:
            validate_payload = json.loads(resp.read().decode("utf-8"))
        assert validate_payload["run"]["status"] == "completed"
        assert validate_payload["run"]["returncode"] == 0
        with request.urlopen(
            f"{base}/config_draft_run_detail?run_id={validate_payload['run']['run_id']}",
            timeout=5,
        ) as resp:
            validate_detail = json.loads(resp.read().decode("utf-8"))
        assert validate_detail["action"] == "validate"
        assert validate_detail["artifact_available"] is False
        assert validate_detail["summary_available"] is False
        assert "--validate-only" in " ".join(validate_detail["command"])

        replay_req = request.Request(
            f"{base}/config_draft/run",
            data=json.dumps({
                "draft_id": "Run_Draft",
                "action": "replay",
                "max_steps": 2,
                "timeout_seconds": 10,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(replay_req, timeout=10) as resp:
            replay_payload = json.loads(resp.read().decode("utf-8"))
        replay = replay_payload["run"]
        assert replay["status"] == "completed"
        assert replay["artifact_path"]
        assert Path(replay["artifact_path"]).exists()
        assert replay["summary"]["mode"] == "replay"
        assert replay["summary"]["decisions"] == 2
        assert replay["summary"]["fills"] == 0
        with request.urlopen(f"{base}/config_draft_run_detail?run_id={replay['run_id']}", timeout=5) as resp:
            replay_detail = json.loads(resp.read().decode("utf-8"))
        assert replay_detail["action"] == "replay"
        assert replay_detail["artifact_available"] is True
        assert replay_detail["summary_available"] is True
        assert replay_detail["summary"]["decisions"] == 2
        assert "--mode replay" in " ".join(replay_detail["command"])

        with request.urlopen(
            f"{base}/config_draft_run_artifacts?run_id={replay['run_id']}&limit=5",
            timeout=5,
        ) as resp:
            run_artifacts = json.loads(resp.read().decode("utf-8"))
        assert run_artifacts["run_id"] == replay["run_id"]
        assert run_artifacts["draft_id"] == "Run_Draft"
        assert run_artifacts["summary"]["mode"] == "replay"
        assert run_artifacts["counts"] == {"account": 2, "decisions": 2, "fills": 0, "orders": 0}
        assert run_artifacts["decisions"][0]["symbols"] == ["QQQ", "SPY"]
        assert "signal" not in run_artifacts["decisions"][0]
        assert run_artifacts["performance"]["max_gross_exposure"] == 0.0
        assert run_artifacts["performance"]["max_gross_exposure_pct"] == 0.0
        assert run_artifacts["performance"]["max_abs_net_exposure"] == 0.0
        assert run_artifacts["performance"]["max_position_count"] == 0

        with request.urlopen(
            f"{base}/config_draft_run_artifacts_export?run_id={replay['run_id']}&limit=5",
            timeout=5,
        ) as resp:
            assert resp.headers["Content-Type"].startswith("application/json")
            assert resp.headers["Content-Disposition"] == (
                f'attachment; filename="{replay["run_id"]}_artifacts.json"'
            )
            exported_artifacts = json.loads(resp.read().decode("utf-8"))
        assert exported_artifacts["run_id"] == replay["run_id"]
        assert exported_artifacts["draft_id"] == "Run_Draft"
        assert exported_artifacts["decisions"][0]["symbols"] == ["QQQ", "SPY"]
        assert "signal" not in exported_artifacts["decisions"][0]

        with request.urlopen(f"{base}/config_draft_artifacts?draft_id=Run_Draft&limit=5", timeout=5) as resp:
            artifacts = json.loads(resp.read().decode("utf-8"))
        assert artifacts["draft_id"] == "Run_Draft"
        assert artifacts["summary"]["mode"] == "replay"
        assert artifacts["counts"] == {"account": 2, "decisions": 2, "fills": 0, "orders": 0}
        assert artifacts["performance"]["account_snapshot_count"] == 2
        assert artifacts["performance"]["initial_equity"] == 25000.0
        assert artifacts["performance"]["total_return_pct"] == 0.0
        assert artifacts["performance"]["elapsed_seconds"] == 300.0
        assert artifacts["performance"]["elapsed_days"] == 300.0 / 86400.0
        assert artifacts["performance"]["return_per_day_pct"] == 0.0
        assert artifacts["performance"]["return_per_month_pct"] == 0.0
        assert artifacts["performance"]["return_per_year_pct"] == 0.0
        assert artifacts["performance"]["short_horizon_projection"] is True
        assert artifacts["performance"]["max_gross_exposure"] == 0.0
        assert artifacts["performance"]["max_gross_exposure_pct"] == 0.0
        assert artifacts["performance"]["max_abs_net_exposure"] == 0.0
        assert artifacts["performance"]["max_position_count"] == 0
        assert artifacts["decisions"][0]["intent_count"] == 0
        assert artifacts["decisions"][0]["symbols"] == ["QQQ", "SPY"]
        assert "signal" not in artifacts["decisions"][0]
        assert artifacts["orders"] == []
        assert artifacts["fills"] == []
        assert artifacts["account"][0]["equity"] == 25000.0

        with request.urlopen(f"{base}/workbench_status", timeout=5) as resp:
            workbench = json.loads(resp.read().decode("utf-8"))
        assert workbench["draft_count"] == 1
        assert workbench["run_count"] == 2
        assert workbench["archived_run_count"] == 1
        assert workbench["orphaned_archive_count"] == 0
        assert workbench["status_counts"] == {"completed": 2}
        assert workbench["action_counts"] == {"replay": 1, "validate": 1}
        assert workbench["archived_artifact_bytes"] > 0
        assert workbench["latest_run"]["action"] == "replay"

        with request.urlopen(f"{base}/config_draft_runs?limit=5", timeout=5) as resp:
            runs = json.loads(resp.read().decode("utf-8"))
        assert runs["total"] == 2
        assert [run["action"] for run in runs["runs"]] == ["replay", "validate"]

        with request.urlopen(f"{base}/config_draft_run_comparison?limit=5", timeout=5) as resp:
            comparison = json.loads(resp.read().decode("utf-8"))
        assert comparison["total"] == 2
        assert comparison["summary_count"] == 1
        assert comparison["short_horizon_count"] == 1
        assert comparison["status_counts"] == {"completed": 2}
        assert comparison["action_counts"] == {"replay": 1, "validate": 1}
        assert [run["action"] for run in comparison["runs"]] == ["replay", "validate"]
        assert comparison["runs"][0]["summary_available"] is True
        assert comparison["runs"][0]["artifact_available"] is True
        assert comparison["runs"][0]["total_return_pct"] == 0.0
        assert comparison["runs"][0]["return_per_day_pct"] == 0.0
        assert comparison["runs"][0]["short_horizon_projection"] is True
        assert comparison["runs"][0]["max_gross_exposure_pct"] == 0.0
        assert comparison["runs"][0]["max_position_count"] == 0
        assert comparison["runs"][1]["summary_available"] is False
        assert comparison["runs"][1]["artifact_available"] is False
        assert comparison["runs"][1]["total_return_pct"] is None
        assert comparison["leaders"]["best_total_return"]["draft_id"] == "Run_Draft"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_workbench_cleanup_plan_and_apply(tmp_path, monkeypatch):
    state_dir = tmp_path / "state"
    artifacts_root = state_dir / "run_artifacts"
    drafts_dir = state_dir / "config_drafts"
    output_root = tmp_path / "workbench"
    kept_archive = artifacts_root / "kept-run"
    orphan_archive = artifacts_root / "orphan-run"
    kept_output = output_root / "Kept_Output"
    orphan_output = output_root / "Orphan_Output"
    for path in (kept_archive, orphan_archive, kept_output, orphan_output, drafts_dir):
        path.mkdir(parents=True)
    (kept_archive / "summary.json").write_text("{}", encoding="utf-8")
    (orphan_archive / "summary.json").write_text('{"orphan": true}', encoding="utf-8")
    (kept_output / "summary.json").write_text("{}", encoding="utf-8")
    (orphan_output / "summary.json").write_text('{"orphan": true}', encoding="utf-8")
    (drafts_dir / "Keep.yaml").write_text(
        "\n".join(
            [
                "runner:",
                f"  output_dir: {kept_output}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (state_dir / "config_draft_runs.jsonl").write_text(
        json.dumps({
            "run_id": "kept-run",
            "draft_id": "Keep",
            "action": "replay",
            "status": "completed",
            "artifact_path": str(kept_archive),
            "summary": {"output_dir": str(kept_output)},
        })
        + "\n",
        encoding="utf-8",
    )
    monkeypatch.setattr(status_server, "WORKBENCH_OUTPUT_ROOT", output_root)
    server = status_server.create_server("127.0.0.1", 0, state_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/workbench_cleanup_plan", timeout=5) as resp:
            plan = json.loads(resp.read().decode("utf-8"))
        assert plan["orphaned_archive_count"] == 1
        assert plan["orphaned_output_count"] == 1
        assert plan["reclaimable_dir_count"] == 2
        assert plan["reclaimable_bytes"] > 0
        assert plan["orphaned_archives"][0]["path"].endswith("orphan-run")
        assert plan["orphaned_outputs"][0]["path"].endswith("Orphan_Output")

        dry_run_req = request.Request(
            f"{base}/workbench_cleanup",
            data=json.dumps({"dry_run": True}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(dry_run_req, timeout=5) as resp:
            dry_run = json.loads(resp.read().decode("utf-8"))
        assert dry_run["dry_run"] is True
        assert dry_run["delete_count"] == 0
        assert orphan_archive.exists()
        assert orphan_output.exists()

        bad_req = request.Request(
            f"{base}/workbench_cleanup",
            data=json.dumps({"dry_run": False}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(bad_req, timeout=5)
            raise AssertionError("expected cleanup confirmation response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "confirm must be 'prune-workbench' when dry_run is false"

        apply_req = request.Request(
            f"{base}/workbench_cleanup",
            data=json.dumps({"dry_run": False, "confirm": "prune-workbench"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(apply_req, timeout=5) as resp:
            applied = json.loads(resp.read().decode("utf-8"))
        assert applied["dry_run"] is False
        assert applied["delete_count"] == 2
        assert kept_archive.exists()
        assert kept_output.exists()
        assert not orphan_archive.exists()
        assert not orphan_output.exists()

        with request.urlopen(f"{base}/workbench_cleanup_plan", timeout=5) as resp:
            after = json.loads(resp.read().decode("utf-8"))
        assert after["orphaned_archive_count"] == 0
        assert after["orphaned_output_count"] == 0
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_workbench_diagnostics(tmp_path):
    data_root = tmp_path / "data"
    dashboard_dir = tmp_path / "dashboard"
    state_dir = tmp_path / "state"
    data_root.mkdir()
    dashboard_dir.mkdir()
    (data_root / "SPY_5min_sample.csv").write_text(
        "timestamp,close\n2026-01-02T14:30:00Z,100\n",
        encoding="utf-8",
    )
    for name in ("index.html", "app.js", "styles.css"):
        (dashboard_dir / name).write_text("ok\n", encoding="utf-8")

    server = create_server(
        "127.0.0.1",
        0,
        state_dir,
        dashboard_dir=dashboard_dir,
        data_roots=[data_root],
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/workbench_diagnostics", timeout=5) as resp:
            diagnostics = json.loads(resp.read().decode("utf-8"))

        assert diagnostics["status"] == "ok"
        assert diagnostics["warning_count"] == 0
        assert diagnostics["state_dir"]["writable"] is True
        assert diagnostics["state_dir"]["exists"] is False
        assert diagnostics["data_roots"][0]["data_file_count"] == 1
        assert diagnostics["data_roots"][0]["scope"] == "local_cache"
        assert all(asset["exists"] for asset in diagnostics["dashboard_assets"])

        with request.urlopen(f"{base}/workbench_snapshot_export", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("application/json")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="workbench_snapshot.json"'
            snapshot = json.loads(resp.read().decode("utf-8"))
        assert snapshot["schema_version"] == 1
        assert snapshot["config_schema_version"] == 1
        assert snapshot["form_schema_version"] == 1
        assert snapshot["diagnostics"]["status"] == "ok"
        assert snapshot["data_catalog"]["count"] == 1
        assert snapshot["data_catalog"]["asset_class_counts"] == {"etf": 1}
        assert snapshot["data_catalog"]["source_counts"] == {"file": 1}
        assert snapshot["data_catalog"]["datasets"][0]["symbol"] == "SPY"
        assert snapshot["config_options"]["risk_presets"]
        assert snapshot["config_options"]["config_schema_version"] == 1
        assert snapshot["config_options"]["form_schema_version"] == 1
        assert snapshot["run_comparison"]["count"] == 0
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_config_draft_rejects_duplicate_datasets(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "SPY.csv"
    other_file = data_root / "SPY_COPY.csv"
    data_file.write_text("timestamp,open,high,low,close,volume\n2026-01-02T14:30:00Z,1,1,1,1,1\n", encoding="utf-8")
    other_file.write_text("timestamp,open,high,low,close,volume\n2026-01-02T14:30:00Z,1,1,1,1,1\n", encoding="utf-8")
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        duplicate_symbol_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "plugin_id": "no_edge_template",
                "datasets": [
                    {"symbol": "SPY", "path": str(data_file)},
                    {"symbol": "SPY", "path": str(other_file)},
                ],
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(duplicate_symbol_req, timeout=5)
            raise AssertionError("expected duplicate symbol response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "duplicate dataset symbol: SPY"

        duplicate_path_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "plugin_id": "no_edge_template",
                "datasets": [
                    {"symbol": "SPY", "path": str(data_file)},
                    {"symbol": "QQQ", "path": str(data_file)},
                ],
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(duplicate_path_req, timeout=5)
            raise AssertionError("expected duplicate path response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"].startswith("duplicate dataset path:")
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_run_comparison_ignores_failed_stale_summary(tmp_path):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    runs_path = state_dir / "config_draft_runs.jsonl"
    rows = [
        {
            "run_id": "failed-run",
            "draft_id": "Bad",
            "action": "replay",
            "status": "failed",
            "returncode": 1,
            "finished_at": "2026-01-02T15:00:00+00:00",
            "summary": {
                "mode": "replay",
                "total_return_pct": 99.0,
                "return_per_day_pct": 99.0,
                "max_drawdown_pct": 0.0,
            },
        },
        {
            "run_id": "good-run",
            "draft_id": "Good",
            "action": "replay",
            "status": "completed",
            "returncode": 0,
            "finished_at": "2026-01-02T15:05:00+00:00",
            "summary": {
                "mode": "replay",
                "decisions": 2,
                "fills": 0,
                "rejections": 0,
                "total_return_pct": 1.5,
                "return_per_day_pct": 2.0,
                "max_drawdown_pct": -0.25,
                "elapsed_days": 1.0,
                "short_horizon_projection": True,
            },
        },
    ]
    runs_path.write_text("\n".join(json.dumps(row) for row in rows) + "\n", encoding="utf-8")
    server = create_server("127.0.0.1", 0, state_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/config_draft_run_comparison?limit=10", timeout=5) as resp:
            comparison = json.loads(resp.read().decode("utf-8"))
        assert comparison["total"] == 2
        assert comparison["summary_count"] == 1
        failed = next(row for row in comparison["runs"] if row["draft_id"] == "Bad")
        assert failed["summary_available"] is False
        assert failed["total_return_pct"] is None
        assert comparison["leaders"]["best_total_return"]["draft_id"] == "Good"
        assert comparison["leaders"]["best_return_per_day"]["draft_id"] == "Good"

        with request.urlopen(f"{base}/config_draft_runs_export?limit=10", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="workbench_runs.csv"'
            csv_body = resp.read().decode("utf-8")
        rows_exported = list(csv.DictReader(io.StringIO(csv_body)))
        assert [row["draft_id"] for row in rows_exported] == ["Good", "Bad"]
        good_row = rows_exported[0]
        failed_row = rows_exported[1]
        assert good_row["total_return_pct"] == "1.5"
        assert good_row["summary_available"] == "True"
        assert failed_row["total_return_pct"] == ""
        assert failed_row["summary_available"] == "False"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_daily_run_rollups(tmp_path):
    state_dir = tmp_path / "state"
    artifact_dir = state_dir / "run_artifacts" / "rollup-run"
    artifact_dir.mkdir(parents=True)
    (artifact_dir / "summary.json").write_text(
        json.dumps({"mode": "replay", "final_equity": 10290.0}),
        encoding="utf-8",
    )
    (artifact_dir / "account.jsonl").write_text(
        "\n".join(
            json.dumps(row)
            for row in [
                {"timestamp": "2026-01-02T14:30:00+00:00", "equity": 10000.0, "gross_exposure": 1000.0},
                {"timestamp": "2026-01-02T21:00:00+00:00", "equity": 10500.0, "gross_exposure": 2000.0},
                {"timestamp": "2026-01-03T14:30:00+00:00", "equity": 10500.0, "gross_exposure": 1500.0},
                {"timestamp": "2026-01-03T21:00:00+00:00", "equity": 10290.0, "gross_exposure": 500.0},
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (artifact_dir / "fills.jsonl").write_text(
        json.dumps({"timestamp": "2026-01-02T15:00:00+00:00", "symbol": "SPY", "side": "buy"}) + "\n",
        encoding="utf-8",
    )
    (artifact_dir / "orders.jsonl").write_text(
        "\n".join(
            [
                json.dumps({"timestamp": "2026-01-02T15:00:00+00:00", "status": "filled", "symbol": "SPY"}),
                json.dumps({"timestamp": "2026-01-03T15:00:00+00:00", "status": "rejected", "symbol": "QQQ"}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (state_dir / "config_draft_runs.jsonl").write_text(
        json.dumps({
            "run_id": "rollup-run",
            "draft_id": "Daily",
            "action": "replay",
            "status": "completed",
            "returncode": 0,
            "finished_at": "2026-01-03T21:00:00+00:00",
            "artifact_path": str(artifact_dir),
            "summary": {"mode": "replay", "final_equity": 10290.0},
        })
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, state_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/config_draft_daily_rollups?limit=10&run_limit=10", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["total"] == 2
        by_day = {row["day"]: row for row in payload["rollups"]}
        assert abs(by_day["2026-01-02"]["daily_return_pct"] - 5.0) < 1e-9
        assert by_day["2026-01-02"]["fill_count"] == 1
        assert by_day["2026-01-02"]["order_count"] == 1
        assert by_day["2026-01-02"]["rejection_count"] == 0
        assert abs(by_day["2026-01-03"]["daily_return_pct"] - -2.0) < 1e-9
        assert by_day["2026-01-03"]["rejection_count"] == 1
        assert by_day["2026-01-03"]["mode"] == "replay"
        month = payload["period_rollups"]["month"][0]
        year = payload["period_rollups"]["year"][0]
        assert month["label"] == "2026-01"
        assert month["day_count"] == 2
        assert month["run_count"] == 1
        assert abs(month["total_return_pct"] - 2.9) < 1e-9
        assert month["order_count"] == 2
        assert month["fill_count"] == 1
        assert month["rejection_count"] == 1
        assert year["label"] == "2026"
        assert abs(year["total_return_pct"] - 2.9) < 1e-9
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_artifacts_reject_output_outside_workbench(tmp_path):
    data_root = tmp_path / "data"
    state_dir = tmp_path / "state"
    drafts_dir = state_dir / "config_drafts"
    data_root.mkdir()
    drafts_dir.mkdir(parents=True)
    data_file = data_root / "SPY.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    bad_draft = drafts_dir / "Bad_Output.yaml"
    bad_draft.write_text(
        "\n".join(
            [
                "metadata:",
                "  strategy_plugin: examples.strategies.no_edge_template:create_strategy",
                "  status: example_only",
                "strategy: {}",
                "runner:",
                "  mode: replay",
                "  starting_cash: 10000",
                "  history_bars: 2",
                "  max_steps: 1",
                "  output_dir: paper_logs/not_workbench",
                "data:",
                "  source: files",
                "  timestamp_column: timestamp",
                "  files:",
                f"    SPY: {data_file}",
                "execution:",
                "  allowed_symbols: [SPY]",
                "  allowed_sides: [buy, sell]",
                "  allowed_order_types: [market]",
                "broker: {}",
                "control: {}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, state_dir, data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        try:
            request.urlopen(f"{base}/config_draft_artifacts?draft_id=Bad_Output", timeout=5)
            raise AssertionError("expected unsafe output response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "runner.output_dir must be inside paper_logs/workbench"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_config_draft_run_rejects_unsupported_plugin(tmp_path):
    state_dir = tmp_path / "state"
    drafts_dir = state_dir / "config_drafts"
    drafts_dir.mkdir(parents=True)
    bad_draft = drafts_dir / "Bad.yaml"
    bad_draft.write_text(
        "\n".join(
            [
                "metadata:",
                "  strategy_plugin: unsupported.module:create_strategy",
                "  status: example_only",
                "strategy: {}",
                "runner:",
                "  mode: replay",
                "  starting_cash: 10000",
                "  history_bars: 2",
                "  max_steps: 1",
                "data:",
                "  source: files",
                "  files:",
                "    SPY: examples/data/SPY_5min_sample.csv",
                "execution:",
                "  allowed_symbols: [SPY]",
                "  allowed_sides: [buy, sell]",
                "  allowed_order_types: [market]",
                "broker: {}",
                "control: {}",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, state_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        run_req = request.Request(
            f"{base}/config_draft/run",
            data=json.dumps({
                "draft_id": "Bad",
                "action": "validate",
                "max_steps": 1,
                "timeout_seconds": 10,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(run_req, timeout=5)
            raise AssertionError("expected unsupported plugin response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert "workbench drafts can only run public generic no-edge plugins" in payload["error"]

        with request.urlopen(f"{base}/config_draft_detail?draft_id=Bad", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
        assert detail["validation"]["valid"] is False
        assert "workbench drafts can only run public generic no-edge plugins" in detail["validation"]["errors"]
        assert detail["yaml"] == ""
        assert detail["commands"] == {}

        with request.urlopen(f"{base}/config_draft_validations", timeout=5) as resp:
            validations = json.loads(resp.read().decode("utf-8"))
        assert validations["count"] == 1
        assert validations["valid_count"] == 0
        assert validations["invalid_count"] == 1
        assert validations["validations"][0]["draft_id"] == "Bad"
        assert validations["validations"][0]["valid"] is False
        assert "workbench drafts can only run public generic no-edge plugins" in validations["validations"][0]["errors"]
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_config_draft_rejects_unsupported_plugin(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "SPY.csv"
    data_file.write_text("timestamp,close\n2026-01-02T14:30:00Z,100\n", encoding="utf-8")
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "plugin_id": "unknown",
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(draft_req, timeout=5)
            raise AssertionError("expected unsupported plugin response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "unsupported plugin_id: unknown"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_config_draft_rejects_data_outside_roots(tmp_path):
    data_root = tmp_path / "data"
    other_root = tmp_path / "other"
    data_root.mkdir()
    other_root.mkdir()
    data_file = other_root / "SPY.csv"
    data_file.write_text("timestamp,close\n2026-01-02T14:30:00Z,100\n", encoding="utf-8")
    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "plugin_id": "no_edge_template",
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(draft_req, timeout=5)
            raise AssertionError("expected outside data root response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "data file must be inside a configured data root"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_command_queue(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        command_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "request_status",
                "params": {},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(command_req, timeout=5) as resp:
            queued = json.loads(resp.read().decode("utf-8"))
        command_id = queued["command"]["command_id"]

        with request.urlopen(f"{base}/commands?node_id=test-node", timeout=5) as resp:
            pending = json.loads(resp.read().decode("utf-8"))
        assert pending["commands"][0]["command_id"] == command_id

        result_req = request.Request(
            f"{base}/command_results",
            data=json.dumps({
                "command_id": command_id,
                "node_id": "test-node",
                "action": "request_status",
                "status": "completed",
                "result": {"ok": True},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(result_req, timeout=5) as resp:
            saved = json.loads(resp.read().decode("utf-8"))
        assert saved["ok"] is True

        with request.urlopen(f"{base}/commands?node_id=test-node", timeout=5) as resp:
            pending_after = json.loads(resp.read().decode("utf-8"))
        assert pending_after["commands"] == []

        with request.urlopen(f"{base}/command_results?node_id=test-node", timeout=5) as resp:
            results = json.loads(resp.read().decode("utf-8"))
        assert results["results"][0]["command_id"] == command_id
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_validates_command_params(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        missing_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "summarize_run",
                "params": {},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(missing_req, timeout=5)
            raise AssertionError("expected missing param response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "run_id is required for summarize_run"

        extra_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "request_status",
                "params": {"run_id": "example"},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(extra_req, timeout=5)
            raise AssertionError("expected extra param response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "unsupported params for request_status: run_id"

        valid_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "summarize_run",
                "params": {"run_id": "example"},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(valid_req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        assert payload["command"]["params"] == {"run_id": "example"}
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_cancels_pending_command(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        command_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "request_status",
                "params": {},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(command_req, timeout=5) as resp:
            queued = json.loads(resp.read().decode("utf-8"))
        command_id = queued["command"]["command_id"]

        cancel_req = request.Request(
            f"{base}/commands/cancel",
            data=json.dumps({
                "node_id": "test-node",
                "command_id": command_id,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(cancel_req, timeout=5) as resp:
            canceled = json.loads(resp.read().decode("utf-8"))

        assert canceled["result"]["status"] == "canceled"
        with request.urlopen(f"{base}/commands?node_id=test-node", timeout=5) as resp:
            pending = json.loads(resp.read().decode("utf-8"))
        assert pending["commands"] == []

        with request.urlopen(f"{base}/command_results?node_id=test-node", timeout=5) as resp:
            results = json.loads(resp.read().decode("utf-8"))
        assert results["results"][0]["command_id"] == command_id
        assert results["results"][0]["status"] == "canceled"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_requires_bearer_auth(tmp_path, monkeypatch):
    monkeypatch.setenv("TEST_STATUS_TOKEN", "secret-value")
    server = create_server("127.0.0.1", 0, tmp_path / "state", auth_token_env="TEST_STATUS_TOKEN")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        unauthorized = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "request_status",
                "params": {},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(unauthorized, timeout=5)
            raise AssertionError("expected unauthorized response")
        except error.HTTPError as exc:
            assert exc.code == 401

        authorized = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "request_status",
                "params": {},
            }).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer secret-value",
            },
            method="POST",
        )
        with request.urlopen(authorized, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        assert payload["ok"] is True
    finally:
        server.shutdown()
        server.server_close()


def test_command_worker_executes_allowlisted_local_actions(tmp_path):
    run_dir = tmp_path / "run"
    marker = tmp_path / "control" / "runner.pause"
    write_run(run_dir)
    config = {
        "node_id": "test-node",
        "allowed_actions": ["summarize_run", "pause_runner", "resume_runner"],
        "runs": {"example": str(run_dir)},
        "control": {"pause_marker": str(marker)},
    }

    summary_result = execute_command(
        {"command_id": "cmd-1", "action": "summarize_run", "params": {"run_id": "example"}},
        config,
    )
    assert summary_result["status"] == "completed"
    assert summary_result["result"]["decisions"] == 1

    pause_result = execute_command({"command_id": "cmd-2", "action": "pause_runner", "params": {}}, config)
    assert pause_result["status"] == "completed"
    assert marker.exists()

    resume_result = execute_command({"command_id": "cmd-3", "action": "resume_runner", "params": {}}, config)
    assert resume_result["status"] == "completed"
    assert not marker.exists()

    rejected = execute_command({"command_id": "cmd-4", "action": "unknown", "params": {}}, config)
    assert rejected["status"] == "rejected"


def test_command_worker_executes_allowlisted_supervisor_actions(tmp_path):
    marker = tmp_path / "ran.txt"
    state_file = tmp_path / "supervisor" / "status.json"
    supervisor_config = tmp_path / "supervisor.yaml"
    write_supervisor_config(
        supervisor_config,
        marker=marker,
        state_file=state_file,
        log_dir=tmp_path / "supervisor" / "jobs",
    )
    config = {
        "node_id": "test-node",
        "allowed_actions": ["validate_supervisor_config", "run_supervisor_once", "supervisor_status"],
        "supervisors": {"example": str(supervisor_config)},
    }

    validate_result = execute_command(
        {"command_id": "cmd-1", "action": "validate_supervisor_config", "params": {"supervisor_id": "example"}},
        config,
    )
    assert validate_result["status"] == "completed"
    assert validate_result["result"]["valid"] is True

    run_result = execute_command(
        {"command_id": "cmd-2", "action": "run_supervisor_once", "params": {"supervisor_id": "example"}},
        config,
    )
    assert run_result["status"] == "completed"
    assert run_result["result"]["state"]["status"] == "ok"
    assert marker.read_text() == "ran\n"

    status_result = execute_command(
        {"command_id": "cmd-3", "action": "supervisor_status", "params": {"supervisor_id": "example"}},
        config,
    )
    assert status_result["status"] == "completed"
    assert status_result["result"]["state_exists"] is True
    assert status_result["result"]["state"]["jobs"][0]["status"] == "ok"


def test_command_worker_poll_once_round_trip(tmp_path):
    run_dir = tmp_path / "run"
    audit_log = tmp_path / "audit.jsonl"
    write_run(run_dir)
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        command_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "summarize_run",
                "params": {"run_id": "example"},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(command_req, timeout=5):
            pass

        results = poll_once({
            "node_id": "test-node",
            "server": {
                "commands_url": f"{base}/commands",
                "results_url": f"{base}/command_results",
                "timeout_seconds": 5,
            },
            "allowed_actions": ["summarize_run"],
            "runs": {"example": str(run_dir)},
            "audit": {"log_file": str(audit_log)},
        })

        assert results[0]["status"] == "completed"
        assert results[0]["post_result"]["status"] == "ok"
        assert results[0]["result"]["decisions"] == 1
        audit_rows = [json.loads(line) for line in audit_log.read_text().splitlines()]
        assert audit_rows[0]["event"] == "command_result"
        assert audit_rows[0]["result"]["command_id"]
        with request.urlopen(f"{base}/commands?node_id=test-node", timeout=5) as resp:
            pending = json.loads(resp.read().decode("utf-8"))
        assert pending["commands"] == []
    finally:
        server.shutdown()
        server.server_close()


def test_command_worker_audits_poll_failure(tmp_path):
    audit_log = tmp_path / "audit.jsonl"

    results = poll_once({
        "node_id": "test-node",
        "server": {
            "commands_url": "http://127.0.0.1:1/commands",
            "results_url": "http://127.0.0.1:1/command_results",
            "timeout_seconds": 0.1,
        },
        "audit": {"log_file": str(audit_log)},
    })

    assert results[0]["status"] == "failed"
    audit_rows = [json.loads(line) for line in audit_log.read_text().splitlines()]
    assert audit_rows[0]["event"] == "poll_failed"
    assert audit_rows[0]["result"]["action"] == "poll"


def test_command_worker_poll_once_with_bearer_auth(tmp_path, monkeypatch):
    monkeypatch.setenv("TEST_STATUS_TOKEN", "secret-value")
    run_dir = tmp_path / "run"
    write_run(run_dir)
    server = create_server("127.0.0.1", 0, tmp_path / "state", auth_token_env="TEST_STATUS_TOKEN")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        command_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "summarize_run",
                "params": {"run_id": "example"},
            }).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": "Bearer secret-value",
            },
            method="POST",
        )
        with request.urlopen(command_req, timeout=5):
            pass

        results = poll_once({
            "node_id": "test-node",
            "server": {
                "commands_url": f"{base}/commands",
                "results_url": f"{base}/command_results",
                "token_env": "TEST_STATUS_TOKEN",
                "timeout_seconds": 5,
            },
            "allowed_actions": ["summarize_run"],
            "runs": {"example": str(run_dir)},
        })

        assert results[0]["status"] == "completed"
        with request.urlopen(
            request.Request(
                f"{base}/command_results?node_id=test-node",
                headers={"Authorization": "Bearer secret-value"},
            ),
            timeout=5,
        ) as resp:
            result_payload = json.loads(resp.read().decode("utf-8"))
        assert result_payload["results"][0]["command_id"]
    finally:
        server.shutdown()
        server.server_close()


def test_command_worker_poll_once_handles_endpoint_down():
    results = poll_once({
        "node_id": "test-node",
        "server": {
            "commands_url": "http://127.0.0.1:9/commands",
            "results_url": "http://127.0.0.1:9/command_results",
            "timeout_seconds": 0.1,
        },
    })

    assert results[0]["status"] == "failed"
    assert results[0]["action"] == "poll"
    assert "urlopen error" in results[0]["error"]
