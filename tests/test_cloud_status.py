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
import yaml

from scripts import cloud_status_server as status_server
from scripts.cloud_status_server import create_server
from scripts.command_worker import append_audit, audit_record_hash, execute_command, poll_once
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


def write_supervisor_config(
    path: Path,
    *,
    marker: Path,
    state_file: Path,
    log_dir: Path,
    process_mode: str = "blocking",
    restart_marker: Path | None = None,
) -> None:
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
    job = {
        "id": "example",
        "enabled": True,
        "cwd": str(path.parent),
        "process_mode": process_mode,
        "command": [sys.executable, str(script)],
        "schedule": {
            "market": "always",
            "run_on_start": True,
            "interval_seconds": 3600,
            "max_runtime_seconds": 10,
        },
    }
    if restart_marker is not None:
        job["restart_marker"] = str(restart_marker)
    path.write_text(
        json.dumps(
            {
                "node_id": "test-node",
                "supervisor": {
                    "state_file": str(state_file),
                    "log_dir": str(log_dir),
                    "poll_seconds": 1,
                },
                "jobs": [job],
            },
            sort_keys=True,
        )
    )


def write_runner_config(path: Path, *, bars_path: Path, state_path: Path, orders_path: Path) -> None:
    path.write_text(
        yaml.safe_dump(
            {
                "metadata": {"strategy_plugin": "examples.strategies.no_edge_template:create_strategy"},
                "strategy": {"example_parameter": True},
                "runner": {
                    "mode": "paper",
                    "starting_cash": 10000,
                    "history_bars": 3,
                    "output_dir": str(path.parent / "run"),
                },
                "data": {
                    "source": "files",
                    "timestamp_column": "timestamp",
                    "files": {"SPY": str(bars_path)},
                },
                "execution": {
                    "allowed_sides": ["buy", "sell"],
                    "allowed_order_types": ["market"],
                    "allow_short": False,
                    "max_orders_per_run": 1,
                    "max_notional_per_order": 1000,
                    "max_quantity": 100,
                    "max_cash_quantity": 1000,
                    "max_gross_exposure_pct": 1,
                },
                "broker": {
                    "adapter": "file",
                    "account_mode": "paper",
                    "state_path": str(state_path),
                    "orders_path": str(orders_path),
                    "starting_cash": 10000,
                    "commission_bps": 0,
                },
            },
            sort_keys=True,
        )
    )


def write_sample_bars(path: Path) -> None:
    path.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100,1000",
                "2026-01-02T14:35:00Z,100,102,99,101,1000",
                "2026-01-02T14:40:00Z,101,103,100,102,1000",
            ]
        )
        + "\n"
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


def write_fetch_manifest(
    path: Path,
    *,
    output_path: str = "cache/ibkr/SPY_5min.parquet",
    extra_outputs: list[dict] | None = None,
) -> None:
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
                ]
                + (extra_outputs or []),
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
                "resume_state": {
                    "schema_version": 1,
                    "updated_at": "2026-01-02T14:31:00+00:00",
                    "resume_modes": ["symbol"],
                    "done_symbols": ["SPY"],
                    "failed_symbols": ["QQQ"],
                    "pending_symbols": ["QQQ"],
                    "completed_output_paths": [output_path],
                    "completed_chunks": [
                        {
                            "symbol": "SPY",
                            "day": "2026-01-02",
                            "status": "ok",
                            "path": output_path,
                        }
                    ],
                    "failed_days_by_symbol": {"QQQ": ["2026-01-02"]},
                    "permission_symbols": ["QQQ"],
                    "retryable_symbols": [],
                },
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


def test_fetch_manifest_recovery_guidance_classifies_common_failures():
    permission = status_server.fetch_manifest_recovery_guidance(
        kind="stock_history",
        counts={"errors": 1, "failed_symbols": 1, "error_kind_counts": {"permission": 1}},
        output_visibility_counts={},
    )
    assert permission["recovery_status"] == "blocked"
    assert permission["recovery_action"] == "fix_permissions"
    assert permission["resume_supported"] is True
    assert permission["permission_error_count"] == 1

    no_data = status_server.fetch_manifest_recovery_guidance(
        kind="crypto_history",
        counts={"errors": 2, "failed_chunks": 2, "error_kind_counts": {"no_data": 2}},
        output_visibility_counts={},
    )
    assert no_data["recovery_status"] == "review"
    assert no_data["recovery_action"] == "review_no_data"
    assert no_data["no_data_error_count"] == 2

    retry = status_server.fetch_manifest_recovery_guidance(
        kind="stock_history",
        counts={"errors": 1, "failed_symbols": 1, "error_kind_counts": {"connection": 1}},
        output_visibility_counts={},
    )
    assert retry["recovery_status"] == "retry"
    assert retry["recovery_action"] == "resume_manifest"
    assert retry["retryable_error_count"] == 1

    hidden_outputs = status_server.fetch_manifest_recovery_guidance(
        kind="stock_history",
        counts={"outputs": 2, "errors": 0, "error_kind_counts": {}},
        output_visibility_counts={"outside_data_roots": 2},
    )
    assert hidden_outputs["recovery_status"] == "review"
    assert hidden_outputs["recovery_action"] == "fix_data_roots"

    resume_plan = status_server.fetch_manifest_resume_plan({
        "kind": "stock_history",
        "symbols_requested": ["SPY", "QQQ", "IWM"],
        "symbols": {
            "SPY": {"symbol": "SPY", "status": "ok"},
            "QQQ": {"symbol": "QQQ", "status": "empty"},
            "IWM": {"symbol": "IWM", "status": "failed"},
        },
        "errors": [{"symbol": "IWM", "kind": "error", "message": "temporary HMDS error"}],
    })
    assert resume_plan["resume_mode"] == "symbol"
    assert resume_plan["skip_completed_count"] == 2
    assert resume_plan["retry_failed_count"] == 1
    assert resume_plan["retry_symbols_sample"] == ["IWM"]

    crypto_resume_plan = status_server.fetch_manifest_resume_plan({
        "kind": "crypto_history",
        "outputs": [{"symbol": "BTC-USD", "status": "ok", "path": "cache/btc.parquet"}],
        "errors": [{"symbol": "ETH-USD", "kind": "no_data", "day": "2026-01-02"}],
        "counts": {"failed_chunks": 1},
    })
    assert crypto_resume_plan["resume_mode"] == "chunk_path"
    assert crypto_resume_plan["skip_completed_count"] == 1
    assert crypto_resume_plan["retry_failed_count"] == 1
    assert crypto_resume_plan["review_no_data_count"] == 1

    state_resume_plan = status_server.fetch_manifest_resume_plan({
        "kind": "stock_history",
        "symbols_requested": ["SPY", "QQQ", "IWM"],
        "resume_state": {
            "done_symbols": ["SPY"],
            "pending_symbols": ["QQQ"],
            "failed_symbols": ["IWM"],
            "no_data_symbols": ["QQQ"],
        },
    })
    assert state_resume_plan["resume_mode"] == "symbol"
    assert state_resume_plan["skip_completed_count"] == 1
    assert state_resume_plan["retry_failed_count"] == 2
    assert state_resume_plan["review_no_data_count"] == 1
    assert state_resume_plan["retry_symbols_sample"] == ["IWM", "QQQ"]


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
    assert payload["runs"][0]["artifact_evidence"]["available"] is True
    assert payload["runs"][0]["artifact_evidence"]["schema_version"] == 2
    assert payload["runs"][0]["artifact_evidence"]["existing_count"] == 2
    assert payload["runs"][0]["artifact_evidence"]["jsonl_row_count"] == 1
    assert payload["runs"][0]["artifact_evidence"]["metadata_file_count"] == 1
    assert payload["runs"][0]["artifact_evidence"]["event_stream_count"] == 1
    assert payload["runs"][0]["artifact_evidence"]["category_counts"] == {"event_stream": 1, "summary": 1}
    assert "runner_status.json" in payload["runs"][0]["artifact_evidence"]["missing_files"]
    assert {item["name"] for item in payload["runs"][0]["artifact_evidence"]["files"]} >= {
        "summary.json",
        "decisions.jsonl",
        "account.jsonl",
    }
    summary_file = next(item for item in payload["runs"][0]["artifact_evidence"]["files"] if item["name"] == "summary.json")
    assert summary_file["category"] == "summary"
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
            "order_type": "limit",
            "decision_bid": 99.95,
            "decision_ask": 100.05,
            "submit_bid": 99.98,
            "submit_ask": 100.08,
            "limit_price": 100.1,
            "tag": "example",
            "metadata": {"private_signal": "hidden"},
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
            "avg_fill_price": 100.0,
            "effective_spread_bps": 1.5,
            "metadata": {"private_signal": "hidden"},
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
    assert recent["orders"][0]["decision_bid"] == 99.95
    assert recent["orders"][0]["submit_ask"] == 100.08
    assert recent["orders"][0]["limit_price"] == 100.1
    assert recent["fills"][0]["price"] == 100.0
    assert recent["fills"][0]["avg_fill_price"] == 100.0
    assert recent["fills"][0]["effective_spread_bps"] == 1.5
    assert "metadata" not in recent["orders"][0]
    assert "metadata" not in recent["fills"][0]


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


def test_cloud_status_artifact_summaries_keep_public_execution_fields():
    raw_order = {
        "timestamp": "2026-01-02T14:30:00+00:00",
        "status": "submitted",
        "symbol": "SPY",
        "side": "buy",
        "order_type": "limit",
        "decision_bid": "99.95",
        "decision_ask": 100.05,
        "submit_bid": 99.98,
        "submit_ask": 100.08,
        "limit_price": 100.1,
        "metadata": {"private_signal": "hidden"},
    }
    raw_fill = {
        "timestamp": "2026-01-02T14:30:01+00:00",
        "symbol": "SPY",
        "side": "buy",
        "quantity": 1,
        "price": 100.0,
        "avg_fill_price": 100.0,
        "effective_spread_bps": 1.5,
        "metadata": {"private_signal": "hidden"},
    }

    order = status_server.summarize_order_artifact(raw_order)
    fill = status_server.summarize_fill_artifact(raw_fill)

    assert order["decision_bid"] == 99.95
    assert order["submit_ask"] == 100.08
    assert order["limit_price"] == 100.1
    assert fill["avg_fill_price"] == 100.0
    assert fill["effective_spread_bps"] == 1.5
    assert "metadata" not in order
    assert "metadata" not in fill


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
    assert payload["remote_control"]["integrity"]["status"] == "legacy"
    assert payload["remote_control"]["integrity"]["legacy_records"] == 2
    assert payload["remote_control"]["event_counts"] == {"command_result": 2}
    assert payload["remote_control"]["result_status_counts"] == {"completed": 2}
    assert payload["remote_control"]["post_status_counts"] == {"ok": 2}


def test_collect_status_verifies_remote_control_audit_hash_chain(tmp_path):
    audit_log = tmp_path / "audit.jsonl"
    config = {"audit": {"log_file": str(audit_log)}}
    append_audit(config, {"event": "command_result", "result": {"action": "request_status", "status": "completed"}})
    append_audit(config, {"event": "poll_failed", "result": {"action": "poll", "status": "failed", "error": "down"}})

    payload = collect_status({
        "node_id": "test-node",
        "remote_control": {
            "enabled": True,
            "audit": {"log_file": str(audit_log), "max_events": 10},
        },
    })

    assert payload["remote_control"]["integrity"]["status"] == "ok"
    assert payload["remote_control"]["integrity"]["checked_records"] == 2
    assert payload["remote_control"]["integrity"]["legacy_records"] == 0
    assert payload["remote_control"]["latest_event"]["event"] == "poll_failed"
    assert any(alert["kind"] == "remote_control_poll_failed" for alert in payload["alerts"])

    rows = [json.loads(line) for line in audit_log.read_text().splitlines()]
    rows[0]["event"] = "tampered"
    audit_log.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))

    tampered = collect_status({
        "node_id": "test-node",
        "remote_control": {
            "enabled": True,
            "audit": {"log_file": str(audit_log), "max_events": 10},
        },
    })

    assert tampered["remote_control"]["integrity"]["status"] == "broken"
    assert any(alert["kind"] == "remote_control_audit_integrity" for alert in tampered["alerts"])


def test_collect_status_verifies_signed_local_remote_control_audit(tmp_path, monkeypatch):
    audit_log = tmp_path / "audit.jsonl"
    monkeypatch.setenv("LOCAL_AUDIT_HMAC_KEY", "test-secret")
    worker_config = {"audit": {"log_file": str(audit_log), "signature_env": "LOCAL_AUDIT_HMAC_KEY"}}
    append_audit(
        worker_config,
        {"event": "command_result", "result": {"action": "request_status", "status": "completed"}},
    )

    payload = collect_status({
        "node_id": "test-node",
        "remote_control": {
            "enabled": True,
            "audit": {
                "log_file": str(audit_log),
                "max_events": 10,
                "signature_env": "LOCAL_AUDIT_HMAC_KEY",
            },
        },
    })

    integrity = payload["remote_control"]["integrity"]
    assert integrity["status"] == "ok"
    assert integrity["signature_status"] == "ok"
    assert integrity["signed_records"] == 1
    assert integrity["unsigned_records"] == 0
    assert integrity["signature_key_env"] == "LOCAL_AUDIT_HMAC_KEY"
    rows = [json.loads(line) for line in audit_log.read_text().splitlines()]
    assert rows[0]["signature_algorithm"] == "hmac-sha256"
    assert rows[0]["signature_key_env"] == "LOCAL_AUDIT_HMAC_KEY"
    assert rows[0]["row_signature"]

    rows[0]["row_signature"] = "0" * 64
    audit_log.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows))
    tampered = collect_status({
        "node_id": "test-node",
        "remote_control": {
            "enabled": True,
            "audit": {
                "log_file": str(audit_log),
                "max_events": 10,
                "signature_env": "LOCAL_AUDIT_HMAC_KEY",
            },
        },
    })

    tampered_integrity = tampered["remote_control"]["integrity"]
    assert tampered_integrity["status"] == "broken"
    assert tampered_integrity["signature_status"] == "bad"
    assert any(error["error"] == "row_signature mismatch" for error in tampered_integrity["errors"])
    assert any(alert["kind"] == "remote_control_audit_signature" for alert in tampered["alerts"])

    monkeypatch.delenv("LOCAL_AUDIT_HMAC_KEY")
    missing_key = collect_status({
        "node_id": "test-node",
        "remote_control": {
            "enabled": True,
            "audit": {
                "log_file": str(audit_log),
                "max_events": 10,
                "signature_env": "LOCAL_AUDIT_HMAC_KEY",
            },
        },
    })
    assert missing_key["remote_control"]["integrity"]["signature_status"] == "missing_key"
    assert any(alert["kind"] == "remote_control_audit_signature" for alert in missing_key["alerts"])


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
        "order_state_risk_limit",
        "risk_limit_trip",
        "unexpected_positioned_state",
    }.issubset(kinds)
    assert payload["runs"][0]["order_state"]["category_counts"]["risk_limit"] == 1


def test_collect_status_classifies_recent_broker_order_states(tmp_path):
    run_dir = tmp_path / "run"
    now = datetime.now(timezone.utc).isoformat()
    write_run(run_dir, timestamp=now)
    (run_dir / "orders.jsonl").write_text(
        "\n".join(
            [
                json.dumps({"timestamp": now, "status": "rejected", "reason": "session not logged in", "symbol": "SPY"}),
                json.dumps({"timestamp": now, "status": "rejected", "reason": "API disconnected", "symbol": "QQQ"}),
                json.dumps({"timestamp": now, "status": "approval_required", "reason": "approval file missing", "symbol": "IWM"}),
                json.dumps({"timestamp": now, "status": "cancelled", "reason": "operator cancelled", "symbol": "DIA"}),
                json.dumps({"timestamp": now, "status": "inactive", "reason": "broker marked inactive", "symbol": "TLT"}),
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    payload = collect_status({
        "node_id": "test-node",
        "runs": [{"id": "example", "path": str(run_dir), "max_order_state_rows": 10}],
    })

    run = payload["runs"][0]
    kinds = {alert["kind"] for alert in payload["alerts"]}
    assert run["order_state"]["checked_recent_rows"] == 5
    assert run["order_state"]["status_counts"] == {
        "approval_required": 1,
        "cancelled": 1,
        "inactive": 1,
        "rejected": 2,
    }
    assert run["order_state"]["category_counts"] == {
        "approval_required": 1,
        "broker_api_disconnected": 1,
        "broker_login_required": 1,
        "cancelled": 1,
        "inactive": 1,
    }
    assert {
        "order_state_approval_required",
        "order_state_broker_api_disconnected",
        "order_state_broker_login_required",
        "order_state_cancelled",
        "order_state_inactive",
    }.issubset(kinds)
    assert run["order_state"]["latest_by_category"]["broker_login_required"]["symbol"] == "SPY"


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
        assert "performance-home-result" in html
        assert "performance-home-tiles" in html
        assert "performance-workflows" in html
        assert "performance-review-note" in html
        assert "performance-review-cards" in html
        assert "performance-review-actions" in html
        assert "performance-evidence-note" in html
        assert "performance-evidence-cards" in html
        assert "performance-evidence-body" in html
        assert "performance-evidence-actions" in html
        assert "performance-live-period-note" in html
        assert "performance-live-period-cards" in html
        assert "data-catalog-body" in html
        assert "<th>Contract</th>" in html
        assert "data-filter-contract" in html
        assert "data-root-cards" in html
        assert "copy-data-roots-yaml" in html
        assert "data-lens-title" in html
        assert "data-lens-note" in html
        assert "data-lens-home" in html
        assert "data-lens-browse" in html
        assert "data-lens-inspect" in html
        assert "data-lens-compare" in html
        assert "data-lens-diagnostics" in html
        assert "data-home-title" in html
        assert "data-home-filtered-count" in html
        assert "data-home-breakdown" in html
        assert "data-home-workflows" in html
        assert "data-home-shortlist" in html
        assert "data-home-inspect-top" in html
        assert "data-inventory-title" in html
        assert "data-inventory-note" in html
        assert "data-inventory-cards" in html
        assert "data-inventory-actions" in html
        assert "data-inventory-evidence-note" in html
        assert "data-inventory-evidence-cards" in html
        assert "data-inventory-evidence-body" in html
        assert "data-inventory-evidence-actions" in html
        assert "data-history-note" in html
        assert "data-history-cards" in html
        assert "data-history-actions" in html
        assert "data-source-map-note" in html
        assert "data-source-map" in html
        assert "help-start-panel" in html
        assert "help-workflows" in html
        assert "help-public-checklist" in html
        assert "help-publish-readiness" in html
        assert "help-publish-note" in html
        assert "help-publish-cards" in html
        assert "help-publish-actions" in html
        assert "help-public-check-command" in html
        assert "help-public-list-command" in html
        assert "help-public-list-json-command" in html
        assert "help-public-audit-command" in html
        assert "Pick the page by the question" in html
        assert "data-symbol-count" in html
        assert "data-file-count" in html
        assert "data-date-range" in html
        assert "data-quality-summary" in html
        assert "data-library-guide-note" in html
        assert "data-library-guide" in html
        assert "data-catalog-health-note" in html
        assert "data-catalog-health-cards" in html
        assert "data-catalog-scan-note" in html
        assert "data-catalog-scan-body" in html
        assert "data-storage-scan-limit" in html
        assert "export-data-catalog-scan-csv" in html
        assert "export-data-storage-audit-csv" in html
        assert "data-storage-visibility-summary" in html
        assert "data-storage-audit-actions" in html
        assert "data-storage-audit-body" in html
        assert "<th>Assets</th>" in html
        assert "<th>Bars</th>" in html
        assert "<th>Unsupported</th>" in html
        assert "<th>Sample Unsupported Paths</th>" in html
        assert "data-symbol-browser-input" in html
        assert "data-symbol-browser-dataset" in html
        assert "data-symbol-browser-matches" in html
        assert "data-symbol-typeahead" in html
        assert "data-symbol-quick-picks" in html
        assert "data-symbol-browser-source" in html
        assert "data-symbol-browser-bar" in html
        assert "data-symbol-browser-session" in html
        assert "data-symbol-browser-quality" in html
        assert "data-symbol-browser-clear-facets" in html
        assert "data-symbol-browser-compare" in html
        assert "data-symbol-visibility-note" in html
        assert "data-symbol-visibility-cards" in html
        assert "data-symbol-visibility-body" in html
        assert "data-symbol-visibility-actions" in html
        assert "data-symbol-profile-title" in html
        assert "data-symbol-profile-workbench" in html
        assert "data-symbol-profile-chart" in html
        assert "data-symbol-profile-files" in html
        assert "data-symbol-directory" in html
        assert "data-symbol-directory-note" in html
        assert "export-data-symbol-directory-csv" in html
        assert "export-data-symbol-index-csv" in html
        assert "data-root-index-filter" in html
        assert "data-root-index-summary" in html
        assert "data-root-index-roots" in html
        assert "data-root-index-body" in html
        assert "data-symbol-directory-filter" in html
        assert "data-symbol-directory-asset" in html
        assert "data-symbol-directory-source" in html
        assert "data-symbol-directory-bar" in html
        assert "data-symbol-directory-session" in html
        assert "data-symbol-directory-quality" in html
        assert "data-symbol-directory-contract" in html
        assert "data-symbol-directory-sort" in html
        assert "data-symbol-directory-limit" in html
        assert "data-filter-symbol-options" in html
        assert "data-filter-session" in html
        assert "data-filter-sort" in html
        assert "data-coverage-grid" in html
        assert "export-data-coverage-csv" in html
        assert "data-gap-summary-note" in html
        assert "export-data-gap-summary-csv" in html
        assert "data-gap-summary-body" in html
        assert "data-calendar-gap-body" in html
        assert "data-minute-heatmap-note" in html
        assert "data-minute-heatmap-grid" in html
        assert "data-minute-date-hour-grid" in html
        assert "export-data-minute-heatmap-csv" in html
        assert "data-minute-heatmap-body" in html
        assert "data-symbol-diagnostic-form" in html
        assert "data-symbol-candidates-body" in html
        assert "data-detail-form" in html
        assert "data-detail-symbol" in html
        assert "data-detail-symbol-load" in html
        assert "data-detail-prev" in html
        assert "data-detail-next" in html
        assert "data-detail-focus-gap" in html
        assert "data-detail-nav-note" in html
        assert "data-detail-viewer-note" in html
        assert "data-detail-range-preset" in html
        assert "data-detail-chart-style" in html
        assert "data-detail-timezone" in html
        assert "data-detail-range-stats" in html
        assert "data-missing-intervals-note" in html
        assert "data-missing-intervals-body" in html
        assert "data-compare-timezone" in html
        assert "data-compare-range-preset" in html
        assert "data-compare-filter" in html
        assert "data-compare-filter-note" in html
        assert "data-compare-asset" in html
        assert "data-compare-source" in html
        assert "data-compare-bar" in html
        assert "data-compare-session" in html
        assert "data-compare-quality" in html
        assert "data-compare-contract" in html
        assert "data-compare-select-symbol" in html
        assert "data-compare-select-shown" in html
        assert "data-compare-clear" in html
        assert "copy-data-compare-json" in html
        assert "use-data-compare-workbench" in html
        assert "export-data-compare-csv" in html
        assert "data-compare-stats" in html
        assert "copy-data-path" in html
        assert "copy-data-root-flag" in html
        assert "copy-data-replay-command" in html
        assert "use-data-detail-workbench" in html
        assert "export-data-detail-range" in html
        assert "export-data-missing-intervals" in html
        assert "nav-performance" in html
        assert "performance-context-note" in html
        assert "performance-metric-context" in html
        assert "nav-fetch" in html
        assert "fetch-manifests-body" in html
        assert "fetch-lens-title" in html
        assert "fetch-lens-note" in html
        assert "fetch-lens-home" in html
        assert "fetch-lens-jobs" in html
        assert "fetch-lens-detail" in html
        assert "fetch-filter-text" in html
        assert "fetch-filter-status" in html
        assert "fetch-filter-kind" in html
        assert "fetch-filter-sort" in html
        assert "export-fetch-manifests-csv" in html
        assert "fetch-health-title" in html
        assert "fetch-health-note" in html
        assert "fetch-health-cards" in html
        assert "fetch-health-actions" in html
        assert "fetch-evidence-note" in html
        assert "fetch-evidence-cards" in html
        assert "fetch-evidence-body" in html
        assert "fetch-evidence-actions" in html
        assert "fetch-jobs-guide-note" in html
        assert "fetch-jobs-guide" in html
        assert "fetch-triage-note" in html
        assert "fetch-triage-cards" in html
        assert "<th>Output Visibility</th>" in html
        assert "fetch-events-body" in html
        assert "fetch-workflows" in html
        assert "copy-fetch-roots-yaml" in html
        assert "copy-fetch-resume-command" in html
        assert "fetch-resume-state-note" in html
        assert "show-fetch-outputs-data" in html
        assert "compare-fetch-outputs" in html
        assert "use-fetch-outputs-workbench" in html
        assert "copy-fetch-output-paths" in html
        assert "export-fetch-detail-csv" in html
        assert "fetch-recovery-plan" in html
        assert "overview-health-grid" in html
        assert "overview-alerts-note" in html
        assert "overview-alerts-body" in html
        assert "overview-orders-note" in html
        assert "overview-orders-body" in html
        assert "overview-positions-grid" in html
        assert "overview-change-cards" in html
        assert "overview-changes-note" in html
        assert "Today's Timeline" in html
        assert "overview-timeline-body" in html
        assert "overview-cash" in html
        assert "overview-latest-bar" in html
        assert "overview-latest-rejection" in html
        assert "overview-realized-pnl" in html
        assert "overview-unrealized-pnl" in html
        assert "overview-today-return" in html
        assert "overview-week-return" in html
        assert "overview-exposure" in html
        assert "overview-next-check" in html
        assert "overview-command-note" in html
        assert "overview-command-title" in html
        assert "overview-command-summary" in html
        assert "overview-command-primary" in html
        assert "overview-command-secondary" in html
        assert "overview-command-cards" in html
        assert "overview-glance-note" in html
        assert "overview-glance-title" in html
        assert "overview-glance-summary" in html
        assert "overview-glance-primary" in html
        assert "overview-glance-secondary" in html
        assert "overview-glance-cards" in html
        assert "overview-workflow-note" in html
        assert "overview-workflow-grid" in html
        assert "Start Here" in html
        assert "overview-performance-note" in html
        assert "overview-performance-result" in html
        assert "overview-performance-summary" in html
        assert "overview-performance-tiles" in html
        assert "overview-performance-chart" in html
        assert "overview-session-state-note" in html
        assert "overview-session-state-cards" in html
        assert "overview-lens-title" in html
        assert "overview-lens-note" in html
        assert "overview-lens-home" in html
        assert "overview-lens-activity" in html
        assert "overview-lens-diagnostics" in html
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
        assert "performance-lens-title" in html
        assert "performance-lens-note" in html
        assert "performance-lens-home" in html
        assert "performance-lens-trades" in html
        assert "performance-lens-rollups" in html
        assert "performance-lens-diagnostics" in html
        assert "performance-triage-note" in html
        assert "performance-triage-cards" in html
        assert "performance-story-note" in html
        assert "performance-story-cards" in html
        assert "performance-trade-summary" in html
        assert "performance-trade-filter-state" in html
        assert "performance-trade-filter-side" in html
        assert "performance-trade-filter-symbol" in html
        assert "performance-trades-body" in html
        assert "performance-profit-factor" in html
        assert "performance-avg-win-loss" in html
        assert "performance-turnover" in html
        assert "performance-equity" in html
        assert "page-intro" in html
        assert "page-intro-title" in html
        assert "page-intro-primary" in html
        assert "page-intro-steps" in html
        assert "performance-status-rollups-body" in html
        assert "performance-status-equity-chart" in html
        assert "performance-status-return-chart" in html
        assert "performance-status-period-rollups-body" in html
        assert "export-status-rollups-csv" in html
        assert "comparison-filter-text" in html
        assert "comparison-filter-mode" in html
        assert "comparison-summary-note" in html
        assert "comparison-summary-cards" in html
        assert "runtime-status-grid" in html
        assert "runtime-status-note" in html
        assert "operations-home-result" in html
        assert "operations-home-tiles" in html
        assert "operations-readiness-title" in html
        assert "operations-readiness-note" in html
        assert "operations-readiness-cards" in html
        assert "operations-readiness-actions" in html
        assert "operations-evidence-note" in html
        assert "operations-evidence-cards" in html
        assert "operations-evidence-body" in html
        assert "operations-evidence-actions" in html
        assert "operations-workflows" in html
        assert "operations-home-paper" in html
        assert "operations-home-remote" in html
        assert "operations-home-audit" in html
        assert "operations-home-gateway" in html
        assert "paper-monitor-note" in html
        assert "paper-monitor-health" in html
        assert "paper-observation-note" in html
        assert "paper-observation-cards" in html
        assert "paper-observation-detail" in html
        assert "paper-monitor-guide" in html
        assert "remote-nodes-note" in html
        assert "remote-node-count" in html
        assert "remote-alert-count" in html
        assert "remote-open-order-count" in html
        assert "remote-nodes-health" in html
        assert "export-remote-nodes-csv" in html
        assert "export-remote-node-detail-csv" in html
        assert "remote-filter-text" in html
        assert "remote-filter-status" in html
        assert "remote-filter-mode" in html
        assert "remote-filter-sort" in html
        assert "remote-nodes-body" in html
        assert "remote-node-detail-note" in html
        assert "remote-node-run-health" in html
        assert "remote-node-boundary-note" in html
        assert "remote-node-boundary-cards" in html
        assert "Restart services safely" in html
        assert "remote-detail-artifact-count" in html
        assert "remote-node-artifacts-note" in html
        assert "remote-node-artifacts-body" in html
        assert "<th>Categories</th>" in html
        assert "remote-node-history-body" in html
        assert "Local Integrity" in html
        assert "command-audit-note" in html
        assert "command-audit-health" in html
        assert "command-audit-body" in html
        assert "export-command-audit-csv" in html
        assert "flatten_simulated_positions" in html
        assert "restart_child_process" in html
        assert "command-boundary" in html
        assert "command-confirm" in html
        assert "command-job" in html
        assert "Signature" in html
        assert "current-orders-body" in html
        assert "current-positions-grid" in html
        assert "Position Detail" in html
        assert "runs-triage-note" in html
        assert "runs-triage-cards" in html
        assert "runs-workflows" in html
        assert "runs-account-boundary-note" in html
        assert "runs-account-boundary-cards" in html
        assert "runs-table-note" in html
        assert "runs-filter-text" in html
        assert "runs-filter-status" in html
        assert "runs-filter-mode" in html
        assert "runs-filter-sort" in html
        assert "run-events-note" in html
        assert "run-events-filter-text" in html
        assert "run-events-filter-type" in html
        assert "run-events-filter-status" in html
        assert "run-events-filter-sort" in html
        assert "Page Guide" in html
        assert "Web UI Runbook" in html
        assert "doc-link-grid" in html
        assert "Data To Simulation Fast Path" in html
        assert "Inspect Saved Historical Data" in html
        assert "Workflow Shortcuts" in html
        assert "Fetch to Workbench" in html
        assert "data-detail-overview-note" in html
        assert "data-detail-overview" in html
        assert "Public Publishing Boundary" in html
        assert "workbench-home-result" in html
        assert "workbench-simulation-title" in html
        assert "workbench-simulation-note" in html
        assert "workbench-simulation-cards" in html
        assert "workbench-simulation-actions" in html
        assert "workbench-readiness-note" in html
        assert "workbench-readiness-cards" in html
        assert "workbench-readiness-actions" in html
        assert "workbench-evidence-note" in html
        assert "workbench-evidence-cards" in html
        assert "workbench-evidence-body" in html
        assert "workbench-evidence-actions" in html
        assert "workbench-lens-title" in html
        assert "workbench-lens-note" in html
        assert "workbench-lens-home" in html
        assert "workbench-lens-builder" in html
        assert "workbench-lens-run" in html
        assert "workbench-lens-artifacts" in html
        assert "runs-lens-title" in html
        assert "runs-lens-note" in html
        assert "runs-lens-home" in html
        assert "runs-lens-state" in html
        assert "runs-lens-runs" in html
        assert "runs-lens-events" in html
        assert "runs-review-title" in html
        assert "runs-review-note" in html
        assert "runs-review-cards" in html
        assert "runs-review-actions" in html
        assert "runs-evidence-note" in html
        assert "runs-evidence-cards" in html
        assert "runs-evidence-body" in html
        assert "runs-evidence-actions" in html
        assert "operations-lens-title" in html
        assert "operations-lens-note" in html
        assert "operations-lens-home" in html
        assert "operations-lens-paper" in html
        assert "operations-lens-remote" in html
        assert "operations-lens-control" in html
        assert "operations-lens-diagnostics" in html
        assert "help-lens-title" in html
        assert "help-lens-note" in html
        assert "help-lens-home" in html
        assert "help-lens-pages" in html
        assert "help-lens-workflows" in html
        assert "help-lens-data" in html
        assert "help-lens-boundary" in html
        assert "help-lens-docs" in html
        assert "page-intro-next" in html
        assert "page-intro-next-title" in html
        assert "page-intro-next-note" in html
        assert "workbench-home-tiles" in html
        assert "workbench-home-select-data" in html
        assert "workbench-home-preview-alignment" in html
        assert "workbench-home-generate" in html
        assert "workbench-home-run" in html
        assert "workbench-workflows" in html
        assert "workbench-guide-note" in html
        assert "workbench-stepper" in html
        assert "workbench-guide" in html
        assert "workbench-result-title" in html
        assert "workbench-result-note" in html
        assert "workbench-result-open-performance" in html
        assert "workbench-result-open-runs" in html
        assert "workbench-result-open-log" in html
        assert "workbench-result-tiles" in html
        assert "artifact-plugin-boundary-note" in html
        assert "artifact-plugin-boundary-cards" in html
        assert "artifact-plugin-boundary" in html
        assert "artifact-plugin-coverage-note" in html
        assert "artifact-plugin-coverage-body" in html
        assert "artifact-plugin-fields-note" in html
        assert "artifact-plugin-fields-body" in html
        assert "workbench-run-readiness-note" in html
        assert "workbench-run-readiness-cards" in html
        assert "workbench-run-readiness-actions" in html
        assert "config-plugin-boundary-note" in html
        assert "config-plugin-boundary" in html
        assert "config-broker-boundary-note" in html
        assert "config-broker-boundary" in html
        assert "config-form" in html
        assert "config-form-fields" in html
        assert "config-preview-draft" in html
        assert "config-builder-readiness" in html
        assert "config-builder-actions" in html
        assert "config-data-actions-note" in html
        assert "config-data-open-detail" in html
        assert "config-data-compare-selected" in html
        assert "config-data-open-library" in html
        assert "config-data-actions-cards" in html
        assert "workbench-selected-data-note" in html
        assert "workbench-selected-data-cards" in html
        assert "workbench-selected-data-list" in html
        assert "config-validation-message-note" in html
        assert "config-validation-messages" in html
        assert "workbench-triage-note" in html
        assert "workbench-triage-cards" in html
        assert "config-commands" in html
        assert "export-drafts-csv" in html
        assert "endpoint-map-body" in html

        with request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/dashboard/styles.css", timeout=5) as resp:
            css = resp.read().decode("utf-8")
        assert ".topbar" in css
        assert ".json-drilldown" in css
        assert ".metric-source" in css
        assert ".gap-marker-legend" in css
        assert ".workbench-selected-data-item" in css

        with request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/dashboard/app.js", timeout=5) as resp:
            js = resp.read().decode("utf-8")
        assert "function gapMarkerLegend" in js
        assert "gap-legend-swatch" in js
        assert "function renderWorkbenchSelectedDataPacket" in js
        assert "function renderPaperObservationPacket" in js
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
        assert ("GET", "/status_equity_rollups") in endpoints
        assert ("GET", "/status_equity_rollups_snapshot") in endpoints
        assert ("GET", "/status_equity_rollups_export") in endpoints
        assert ("GET", "/remote_nodes") in endpoints
        assert ("GET", "/remote_nodes_export") in endpoints
        assert ("GET", "/remote_node_detail") in endpoints
        assert ("GET", "/remote_node_detail_export") in endpoints
        assert ("GET", "/command_audit") in endpoints
        assert ("GET", "/command_audit_export") in endpoints
        assert ("GET", "/workbench_snapshot_export") in endpoints
        assert ("GET", "/workbench_endpoints") in endpoints
        assert ("POST", "/config_draft_preview") in endpoints
        assert ("GET", "/data_coverage") in endpoints
        assert ("GET", "/data_coverage_export") in endpoints
        assert ("GET", "/data_symbol_index") in endpoints
        assert ("GET", "/data_symbol_index_export") in endpoints
        assert ("GET", "/data_catalog_scan_export") in endpoints
        assert ("GET", "/data_symbol_directory_export") in endpoints
        assert ("GET", "/data_gap_summary") in endpoints
        assert ("GET", "/data_gap_summary_export") in endpoints
        assert ("GET", "/data_detail_export") in endpoints
        assert ("GET", "/data_missing_intervals_export") in endpoints
        assert ("GET", "/data_minute_heatmap_export") in endpoints
        assert ("GET", "/data_symbol_diagnostic") in endpoints
        assert ("GET", "/data_storage_audit") in endpoints
        assert ("GET", "/data_storage_audit_export") in endpoints
        assert ("POST", "/data_compare") in endpoints
        assert ("GET", "/fetch_manifests") in endpoints
        assert ("GET", "/fetch_manifests_export") in endpoints
        assert ("GET", "/fetch_manifest_detail") in endpoints
        assert ("GET", "/fetch_manifest_detail_export") in endpoints
        assert ("GET", "/config_drafts_export") in endpoints
        assert ("GET", "/config_draft_validations") in endpoints
        assert ("GET", "/config_draft_run_evidence") in endpoints
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
        assert "Data Source Map" in body
        assert "Fetch Recovery Plan" in body
        assert "Workbench Home" in body
        assert "Selected Data Packet" in body
        assert "Observation Packet" in body
        for name, expected in {
            "ibkr_gateway_runbook.md": "IBKR Gateway Runbook",
            "paper_trading_runbook.md": "Paper Trading Runbook",
            "market_data_permissions_runbook.md": "Market Data Permissions Runbook",
            "service_restart_runbook.md": "Service Restart Runbook",
            "failed_order_diagnosis_runbook.md": "Failed Order Diagnosis Runbook",
            "cloud_monitoring_deployment.md": "Cloud Monitoring Deployment",
            "blog_public_ibkr_harness_draft.md": "Blog Draft: A Local-First IBKR Trading Harness",
        }.items():
            with request.urlopen(f"{base}/docs/{name}", timeout=5) as resp:
                body = resp.read().decode("utf-8")
            assert resp.headers["Content-Type"].startswith("text/markdown")
            assert expected in body
            if name == "service_restart_runbook.md":
                assert "Restart Public Harness Services" in body
                assert "Restart Hosted Receiver" in body
                assert "Fly.io" in body
                assert "Render deployments" in body
                assert "Reload Reverse Proxies And Firewalls" in body
            if name == "cloud_monitoring_deployment.md":
                assert "retention_policy" in body
                assert "Off-host cards" in body
                assert "not_verified" in body

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


def test_dashboard_screenshot_smoke_prepares_seeded_and_empty_state(tmp_path):
    from scripts.smoke_dashboard_screenshots import prepare_empty_state, prepare_seed_state

    seed_data_roots, seed_manifest_roots = prepare_seed_state(tmp_path / "seeded")
    assert len(seed_data_roots) == 1
    assert len(seed_manifest_roots) == 1
    assert list(seed_data_roots[0].glob("*.csv"))
    assert list(seed_manifest_roots[0].glob("*.json"))

    empty_data_roots, empty_manifest_roots = prepare_empty_state(tmp_path / "empty")
    assert len(empty_data_roots) == 1
    assert len(empty_manifest_roots) == 1
    assert empty_data_roots[0].exists()
    assert empty_manifest_roots[0].exists()
    assert not list(empty_data_roots[0].iterdir())
    assert not list(empty_manifest_roots[0].iterdir())


def test_cloud_status_server_serves_status_history(tmp_path):
    state_dir = tmp_path / "state"
    server = create_server("127.0.0.1", 0, state_dir)
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
                        "artifact_evidence": {
                            "schema_version": 1,
                            "available": True,
                            "expected_count": 9,
                            "existing_count": 4,
                            "missing_count": 5,
                            "total_bytes": 1234,
                            "jsonl_row_count": 9,
                            "metadata_file_count": 1,
                            "event_stream_count": 1,
                            "category_counts": {"summary": 1, "event_stream": 1},
                            "missing_files": ["runner_status.json", "../unsafe.json"],
                            "latest_modified_at": "2026-01-02T14:31:03+00:00",
                            "files": [
                                {"name": "summary.json", "category": "summary", "exists": True, "bytes": 200, "modified_at": "2026-01-02T14:31:00+00:00"},
                                {"name": "decisions.jsonl", "category": "event_stream", "exists": True, "bytes": 300, "row_count": 2, "modified_at": "2026-01-02T14:31:01+00:00"},
                                {"name": "../hidden.json", "exists": True, "bytes": 999, "row_count": 1},
                            ],
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
        snapshot_path = state_dir / "status_equity_rollups" / "latest_test-node.json"
        assert snapshot_path.exists()
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        assert snapshot["artifact_path"] == str(snapshot_path)
        assert snapshot["persisted_at"]
        assert snapshot["node_id"] == "test-node"
        assert snapshot["total"] == 1

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

        with request.urlopen(f"{base}/remote_nodes_export?limit=5", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="remote_nodes.csv"'
            csv_body = resp.read().decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(csv_body)))
        assert len(rows) == 2
        csv_by_node = {row["node_id"]: row for row in rows}
        assert csv_by_node["test-node"]["status"] == "ok"
        assert csv_by_node["test-node"]["gateway_reachable"] == "True"
        assert csv_by_node["test-node"]["mode"] == "paper"
        assert csv_by_node["test-node"]["final_equity"] == "10123.45"
        assert csv_by_node["test-node"]["open_order_count"] == "1"
        assert csv_by_node["test-node"]["latest_decision_time"] == "2026-01-02T14:31:00+00:00"

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
        assert detail["runs"][0]["artifact_evidence"]["existing_count"] == 4
        assert detail["runs"][0]["artifact_evidence"]["jsonl_row_count"] == 9
        assert detail["runs"][0]["artifact_evidence"]["metadata_file_count"] == 1
        assert detail["runs"][0]["artifact_evidence"]["event_stream_count"] == 1
        assert detail["runs"][0]["artifact_evidence"]["category_counts"] == {"summary": 1, "event_stream": 1}
        assert detail["runs"][0]["artifact_evidence"]["missing_files"] == ["runner_status.json"]
        assert [item["name"] for item in detail["runs"][0]["artifact_evidence"]["files"]] == ["summary.json", "decisions.jsonl"]
        assert detail["runs"][0]["artifact_evidence"]["files"][0]["category"] == "summary"
        assert detail["boundary_policy"]["name"] == "remote_status_sanitized_boundary"
        assert detail["boundary_policy"]["snapshot_limit"] == 2
        assert detail["boundary_policy"]["latest_run_limit"] == 20
        assert detail["boundary_policy"]["recent_event_limit_per_stream"] == 10
        assert "raw stdout/stderr logs" in detail["boundary_policy"]["excluded"]
        assert "broker credentials" in detail["boundary_policy"]["excluded"]
        assert detail["supervisors"][0]["id"] == "sup-a"
        assert [row["status"] for row in detail["history"]] == ["ok", "warn"]

        with request.urlopen(f"{base}/remote_node_detail_export?node_id=test-node&limit=2", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="remote_node_detail_test-node.csv"'
            detail_csv_body = resp.read().decode("utf-8")
        detail_rows = list(csv.DictReader(io.StringIO(detail_csv_body)))
        row_types = {row["row_type"] for row in detail_rows}
        assert {"summary", "boundary_policy", "history", "run", "activity", "artifact_evidence", "artifact_file", "supervisor"}.issubset(row_types)
        assert any(row["row_type"] == "boundary_policy" and "remote_status_sanitized_boundary" in row["detail"] for row in detail_rows)
        assert any(row["row_type"] == "activity" and row["run_id"] == "run-a" and row["status"] == "Submitted" for row in detail_rows)
        assert any(row["row_type"] == "artifact_evidence" and row["run_id"] == "run-a" and row["status"] == "available" and "event_stream_count" in row["detail"] for row in detail_rows)
        assert any(row["row_type"] == "artifact_file" and row["run_id"] == "run-a" and "category" in row["detail"] for row in detail_rows)
        assert any(row["row_type"] == "summary" and row["node_id"] == "test-node" and row["mode"] == "paper" for row in detail_rows)
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_status_equity_rollups(tmp_path):
    state_dir = tmp_path / "state"
    state_dir.mkdir()
    rows = [
        {
            "schema_version": 1,
            "node_id": "paper-node",
            "status": "ok",
            "received_at": "2026-01-02T14:30:00+00:00",
            "gateway": {"reachable": True},
            "runs": [
                {
                    "id": "paper-run",
                    "status": "ok",
                    "metrics": {
                        "mode": "paper",
                        "final_equity": 10000.0,
                        "final_cash": 9000.0,
                        "final_positions": {"SPY": 1},
                        "rejections": 0,
                    },
                    "recent_events": {"orders": [], "fills": []},
                }
            ],
        },
        {
            "schema_version": 1,
            "node_id": "paper-node",
            "status": "warn",
            "received_at": "2026-01-02T21:00:00+00:00",
            "gateway": {"reachable": False},
            "alerts": [{"level": "warn", "kind": "gateway", "message": "stale"}],
            "runs": [
                {
                    "id": "paper-run",
                    "status": "ok",
                    "metrics": {
                        "mode": "paper",
                        "final_equity": 10250.0,
                        "final_cash": 9250.0,
                        "final_positions": {"SPY": 1},
                        "rejections": 1,
                    },
                    "recent_events": {
                        "orders": [{"timestamp": "2026-01-02T15:00:00+00:00", "status": "Submitted"}],
                        "fills": [{"timestamp": "2026-01-02T15:01:00+00:00"}],
                    },
                }
            ],
        },
        {
            "schema_version": 1,
            "node_id": "paper-node",
            "status": "ok",
            "received_at": "2026-01-03T21:00:00+00:00",
            "gateway": {"reachable": True},
            "runs": [
                {
                    "id": "paper-run",
                    "status": "ok",
                    "metrics": {
                        "mode": "paper",
                        "final_equity": 10147.5,
                        "final_cash": 10147.5,
                        "final_positions": {},
                        "rejections": 1,
                    },
                    "recent_events": {"orders": [], "fills": []},
                }
            ],
        },
        {
            "schema_version": 1,
            "node_id": "other-node",
            "status": "ok",
            "received_at": "2026-01-02T21:00:00+00:00",
            "runs": [{"id": "other-run", "status": "ok", "metrics": {"final_equity": 20000.0}}],
        },
    ]
    (state_dir / "status_history.jsonl").write_text(
        "\n".join(json.dumps(row) for row in rows) + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, state_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/status_equity_rollups?node_id=paper-node&limit=10&history_limit=10", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["history_scanned"] == 3
        assert payload["total"] == 2
        by_day = {row["day"]: row for row in payload["rollups"]}
        assert abs(by_day["2026-01-02"]["daily_return_pct"] - 2.5) < 1e-9
        assert by_day["2026-01-02"]["start_equity"] == 10000.0
        assert by_day["2026-01-02"]["end_equity"] == 10250.0
        assert by_day["2026-01-02"]["alert_count"] == 1
        assert by_day["2026-01-02"]["order_count"] == 1
        assert by_day["2026-01-02"]["fill_count"] == 1
        assert by_day["2026-01-02"]["rejection_count"] == 1
        assert by_day["2026-01-02"]["gateway_reachable"] is False
        assert abs(by_day["2026-01-03"]["daily_return_pct"] - 0.0) < 1e-9
        month = payload["period_rollups"]["month"][0]
        assert month["label"] == "2026-01"
        assert month["day_count"] == 2
        assert month["node_count"] == 1
        assert abs(month["total_return_pct"] - 1.475) < 1e-9
        snapshot_path = state_dir / "status_equity_rollups" / "latest_paper-node.json"
        assert snapshot_path.exists()
        snapshot = json.loads(snapshot_path.read_text(encoding="utf-8"))
        assert snapshot["artifact_path"] == str(snapshot_path)
        assert snapshot["persisted_at"]
        assert snapshot["node_id"] == "paper-node"
        assert snapshot["total"] == 2

        with request.urlopen(f"{base}/status_equity_rollups_snapshot?node_id=paper-node", timeout=5) as resp:
            persisted = json.loads(resp.read().decode("utf-8"))
        assert persisted["artifact_path"] == str(snapshot_path)
        assert persisted["rollups"][0]["node_id"] == "paper-node"

        with request.urlopen(f"{base}/status_equity_rollups_export?node_id=paper-node&limit=10&history_limit=10", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="status_equity_rollups.csv"'
            csv_body = resp.read().decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(csv_body)))
        assert {row["row_type"] for row in rows} == {"daily", "month", "year"}
        daily_by_day = {row["day"]: row for row in rows if row["row_type"] == "daily"}
        assert daily_by_day["2026-01-02"]["node_id"] == "paper-node"
        assert abs(float(daily_by_day["2026-01-02"]["daily_return_pct"]) - 2.5) < 1e-9
        assert daily_by_day["2026-01-02"]["gateway_reachable"] == "False"
        period_by_type = {row["row_type"]: row for row in rows if row["row_type"] in {"month", "year"}}
        assert period_by_type["month"]["label"] == "2026-01"
        assert period_by_type["month"]["node_count"] == "1"
        assert period_by_type["year"]["label"] == "2026"
        assert abs(float(period_by_type["year"]["total_return_pct"]) - 1.475) < 1e-9
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
                "  auth_tokens:",
                "    - token_env: READ_TOKEN_ENV",
                "      role: monitor",
                "      allowed_action_classes:",
                "        - read_only",
                "    - token_env: CONTROL_TOKEN_ENV",
                "      role: operator",
                "      allowed_action_classes:",
                "        - read_only",
                "        - control",
                "  network_access:",
                "    enabled: true",
                "    allowed_client_networks:",
                "      - 127.0.0.1/32",
                "    trust_x_forwarded_for: true",
                "  command_rate_limit:",
                "    enabled: true",
                "    window_seconds: 12",
                "    max_per_node: 7",
                "  command_scopes:",
                "    enabled: true",
                "    allowed_action_classes:",
                "      - read_only",
                "    allowed_actions:",
                "      - pause_runner",
                "  command_audit_signature_env: AUDIT_HMAC_KEY",
                "  data_roots:",
                f"    - {data_root}",
                "  fetch_manifest_roots:",
                f"    - {tmp_path / 'fetch_manifests'}",
                "  plugin_registry_paths:",
                f"    - {tmp_path / 'plugin_registry.yaml'}",
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
    assert [token["role"] for token in settings["auth_tokens"]] == ["monitor", "operator"]
    assert settings["auth_tokens"][0]["token_env"] == "READ_TOKEN_ENV"
    assert settings["auth_tokens"][0]["command_scopes"]["allowed_action_classes"] == {"read_only"}
    assert settings["auth_tokens"][1]["command_scopes"]["allowed_action_classes"] == {"read_only", "control"}
    assert status_server.display_network_access_config(settings["network_access"]) == {
        "enabled": True,
        "allowed_client_networks": ["127.0.0.1/32"],
        "trust_x_forwarded_for": True,
    }
    assert settings["command_rate_limit"] == {"enabled": True, "window_seconds": 12, "max_per_node": 7}
    assert settings["command_scopes"] == {
        "enabled": True,
        "allowed_action_classes": {"read_only"},
        "allowed_actions": {"pause_runner"},
    }
    assert settings["command_audit_signature_env"] == "AUDIT_HMAC_KEY"
    assert settings["data_roots"] == [data_root]
    assert settings["fetch_manifest_roots"] == [tmp_path / "fetch_manifests"]
    assert settings["plugin_registry_paths"] == [tmp_path / "plugin_registry.yaml"]

    override = status_server.dashboard_server_settings(
        config_path,
        host="127.0.0.1",
        port=0,
        data_roots=[tmp_path / "override"],
        fetch_manifest_roots=[tmp_path / "manifest_override"],
        plugin_registry_paths=[tmp_path / "registry_override.yaml"],
        auth_token_env="OTHER_TOKEN",
        command_audit_signature_env="OTHER_AUDIT_HMAC_KEY",
    )
    assert override["host"] == "127.0.0.1"
    assert override["port"] == 0
    assert override["data_roots"] == [tmp_path / "override"]
    assert override["command_audit_signature_env"] == "OTHER_AUDIT_HMAC_KEY"
    assert override["fetch_manifest_roots"] == [tmp_path / "manifest_override"]
    assert override["plugin_registry_paths"] == [tmp_path / "registry_override.yaml"]
    assert override["auth_token_env"] == "OTHER_TOKEN"


def test_cloud_status_server_rejects_reserved_high_risk_command_scopes(tmp_path):
    config_path = tmp_path / "cloud_status.yaml"
    config_path.write_text(
        "\n".join([
            "dashboard:",
            "  command_scopes:",
            "    allowed_action_classes:",
            "      - read_only",
            "      - high_risk",
        ]) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="cannot include reserved high_risk"):
        status_server.dashboard_server_settings(config_path)

    config_path.write_text(
        "\n".join([
            "dashboard:",
            "  command_scopes:",
            "    allowed_actions:",
            "      - enable_live_orders",
        ]) + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="reserved high-risk actions: enable_live_orders"):
        status_server.dashboard_server_settings(config_path)


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
    missing_data_file = data_root / "QQQ_5min.csv"
    outside_data_file = tmp_path / "outside" / "IWM_5min.csv"
    write_fetch_manifest(
        manifest_root / "stock_history_20260102.json",
        output_path=str(data_file),
        extra_outputs=[
            {
                "timestamp": "2026-01-02T14:31:10+00:00",
                "symbol": "QQQ",
                "status": "ok",
                "rows": 0,
                "path": str(missing_data_file),
                "elapsed_seconds": 0.2,
                "attempt_count": 1,
            },
            {
                "timestamp": "2026-01-02T14:31:20+00:00",
                "symbol": "IWM",
                "status": "ok",
                "rows": 0,
                "path": str(outside_data_file),
                "elapsed_seconds": 0.1,
                "attempt_count": 1,
            },
        ],
    )
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
        assert manifest["recovery_status"] == "blocked"
        assert manifest["recovery_action"] == "fix_permissions"
        assert manifest["resume_supported"] is True
        assert manifest["resume_mode"] == "symbol"
        assert manifest["resume_skip_count"] == 1
        assert manifest["resume_retry_count"] == 1
        assert manifest["resume_review_count"] == 0
        assert manifest["resume_pending_estimate"] == 1
        assert manifest["resume_state_summary"].startswith("1 completed symbols; 1 pending; 1 failed")
        assert manifest["resume_state_done_symbol_count"] == 1
        assert manifest["resume_state_pending_symbol_count"] == 1
        assert manifest["resume_state_completed_output_path_count"] == 1
        assert manifest["resume_state_failed_day_count"] == 1
        assert manifest["resume_command"].startswith("python3 live/fetch_history.py --resume-manifest ")
        assert manifest["resume_command"].endswith("stock_history_20260102.json'")
        assert manifest["permission_error_count"] == 1
        assert manifest["no_data_error_count"] == 0
        assert manifest["retryable_error_count"] == 0
        assert manifest["retry_events"] == 1
        assert manifest["pacing_wait_events"] == 1
        assert manifest["pacing_wait_seconds"] == 0.35
        assert manifest["latest_avg_chunk_seconds"] == 0.4
        assert manifest["output_visibility_counts"] == {
            "missing_file": 1,
            "outside_data_roots": 1,
            "visible": 1,
        }
        assert manifest["output_visible_count"] == 1
        assert manifest["output_missing_file_count"] == 1
        assert manifest["output_outside_data_roots_count"] == 1

        with request.urlopen(f"{base}/fetch_manifests_export?limit=5", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="fetch_manifests.csv"'
            csv_body = resp.read().decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(csv_body)))
        assert len(rows) == 1
        assert rows[0]["job_id"] == "stock_history_20260102"
        assert rows[0]["kind"] == "stock_history"
        assert rows[0]["status"] == "completed"
        assert rows[0]["success_symbols"] == "1"
        assert rows[0]["failed_symbols"] == "1"
        assert rows[0]["retry_events"] == "1"
        assert rows[0]["pacing_wait_events"] == "1"
        assert rows[0]["latest_avg_chunk_seconds"] == "0.4"
        assert rows[0]["output_visible_count"] == "1"
        assert rows[0]["output_missing_file_count"] == "1"
        assert rows[0]["output_outside_data_roots_count"] == "1"
        assert rows[0]["recovery_status"] == "blocked"
        assert rows[0]["recovery_action"] == "fix_permissions"
        assert rows[0]["resume_mode"] == "symbol"
        assert rows[0]["resume_skip_count"] == "1"
        assert rows[0]["resume_retry_count"] == "1"
        assert rows[0]["resume_pending_estimate"] == "1"
        assert rows[0]["resume_state_done_symbol_count"] == "1"
        assert rows[0]["resume_state_failed_day_count"] == "1"
        assert rows[0]["resume_command"].startswith("python3 live/fetch_history.py --resume-manifest ")
        assert rows[0]["permission_error_count"] == "1"
        assert rows[0]["latest_output_path"].endswith("IWM_5min.csv")
        assert "visible" in rows[0]["output_visibility_counts"]
        assert "permission" in rows[0]["error_kind_counts"]

        with request.urlopen(f"{base}/fetch_manifest_detail?job_id=stock_history_20260102&limit=10", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
        assert detail["job_id"] == "stock_history_20260102"
        assert detail["output_total"] == 3
        assert detail["error_total"] == 1
        assert detail["symbols"][0]["symbol"] in {"QQQ", "SPY"}
        assert detail["outputs"][0]["path"] == str(data_file)
        assert detail["outputs"][0]["data_detail_available"] is True
        assert detail["outputs"][0]["data_detail_path"] == str(data_file)
        assert detail["outputs"][0]["data_detail_status"] == "visible"
        assert detail["outputs"][0]["elapsed_seconds"] == 0.4
        assert detail["outputs"][1]["data_detail_available"] is False
        assert detail["outputs"][1]["data_detail_status"] == "missing_file"
        assert detail["outputs"][2]["data_detail_available"] is False
        assert detail["outputs"][2]["data_detail_status"] == "outside_data_roots"
        assert detail["output_visibility_counts"] == {
            "missing_file": 1,
            "outside_data_roots": 1,
            "visible": 1,
        }
        assert detail["output_visible_count"] == 1
        assert detail["output_missing_file_count"] == 1
        assert detail["output_outside_data_roots_count"] == 1
        assert detail["recovery_status"] == "blocked"
        assert detail["recovery_action"] == "fix_permissions"
        assert detail["recovery_note"].startswith("Market-data permission errors")
        assert detail["resume_supported"] is True
        assert detail["resume_plan"]["resume_mode"] == "symbol"
        assert detail["resume_plan"]["skip_completed_count"] == 1
        assert detail["resume_plan"]["retry_failed_count"] == 1
        assert detail["resume_plan"]["retry_symbols_sample"] == ["QQQ"]
        assert detail["resume_state"]["resume_modes"] == ["symbol"]
        assert detail["resume_state"]["done_symbol_count"] == 1
        assert detail["resume_state"]["pending_symbol_count"] == 1
        assert detail["resume_state"]["permission_symbol_count"] == 1
        assert detail["resume_state"]["failed_day_count"] == 1
        assert detail["resume_state"]["completed_output_paths_sample"] == [str(data_file)]
        assert detail["resume_state"]["failed_days_by_symbol_sample"] == {"QQQ": ["2026-01-02"]}
        assert detail["resume_command"] == manifest["resume_command"]
        assert detail["errors"][0]["kind"] == "permission"
        assert detail["errors"][0]["attempt_count"] == 2
        assert detail["counts"]["retry_events"] == 1
        assert detail["events"][0]["type"] == "retry"

        with request.urlopen(f"{base}/fetch_manifest_detail_export?job_id=stock_history_20260102&limit=10", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="stock_history_20260102_fetch_detail.csv"'
            csv_body = resp.read().decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(csv_body)))
        assert {row["row_type"] for row in rows} == {"symbol", "output", "error", "event", "resume_plan", "resume_state"}
        output_rows = [row for row in rows if row["row_type"] == "output"]
        assert len(output_rows) == 3
        assert output_rows[0]["symbol"] == "SPY"
        assert output_rows[0]["data_detail_available"] == "True"
        assert output_rows[0]["data_detail_status"] == "visible"
        assert output_rows[1]["data_detail_status"] == "missing_file"
        assert output_rows[2]["data_detail_status"] == "outside_data_roots"
        error_rows = [row for row in rows if row["row_type"] == "error"]
        assert error_rows[0]["symbol"] == "QQQ"
        assert error_rows[0]["error_kind"] == "permission"
        assert error_rows[0]["attempt_count"] == "2"
        event_rows = [row for row in rows if row["row_type"] == "event"]
        assert {row["event_type"] for row in event_rows} == {"retry", "pacing_wait"}
        resume_rows = [row for row in rows if row["row_type"] == "resume_plan"]
        assert resume_rows[0]["resume_mode"] == "symbol"
        assert resume_rows[0]["resume_skip_count"] == "1"
        assert resume_rows[0]["resume_retry_count"] == "1"
        assert resume_rows[0]["resume_command"] == detail["resume_command"]
        resume_state_rows = [row for row in rows if row["row_type"] == "resume_state"]
        assert resume_state_rows[0]["resume_state_resume_modes"] == "symbol"
        assert resume_state_rows[0]["resume_state_done_symbol_count"] == "1"
        assert resume_state_rows[0]["resume_state_failed_day_count"] == "1"
        assert "QQQ" in resume_state_rows[0]["resume_state_samples"]
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_data_catalog(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "SPY_5min_1D_now_TRADES_SMART_rthTrue.csv").write_text(
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
        assert payload["symbol_count"] == 1
        assert payload["quality_counts"] == {"ok": 1}
        assert payload["bar_size_counts"] == {"5min": 1}
        assert payload["row_count_total"] == 3
        assert payload["size_bytes_total"] > 0
        assert payload["latest_modified_at"]
        assert payload["datasets"][0]["size_bytes"] > 0
        assert payload["datasets"][0]["modified_at"]
        assert payload["error_count"] == 1
        assert payload["candidate_count_total"] == 2
        assert payload["parsed_count_total"] == 1
        assert payload["parse_error_count_total"] == 1
        assert payload["unsupported_file_count_total"] == 1
        assert payload["skipped_candidate_count_total"] == 0
        assert payload["scan_capped_root_count"] == 0
        assert payload["not_scanned_root_count"] == 0
        assert payload["catalog_complete"] is False
        assert payload["catalog_visibility_status"] == "incomplete"
        assert payload["root_inventory"]["status"] == "bad"
        assert payload["root_inventory"]["primary_issue"] == "root or parser blocker"
        assert payload["root_inventory"]["root_count"] == 1
        assert payload["root_inventory"]["candidate_count"] == 2
        assert payload["root_inventory"]["parsed_count"] == 1
        assert payload["root_inventory"]["dataset_count"] == 1
        assert payload["root_inventory"]["symbol_count"] == 1
        assert payload["root_inventory"]["parse_error_count"] == 1
        assert payload["root_inventory"]["unsupported_file_count"] == 1
        assert payload["root_inventory"]["status_counts"] == {"bad": 1}
        assert payload["root_inventory"]["reason_counts"]
        assert payload["root_inventory"]["sample_issues"][0]["status"] == "bad"
        assert payload["errors"][0]["root"] == str(data_root.resolve())
        scan = payload["root_summaries"][0]
        assert scan["inventory_status"] == "bad"
        assert "parquet" in scan["inventory_reason"].lower()
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
        assert dataset["canonical_symbol"] == "SPY"
        assert dataset["asset_class"] == "etf"
        assert dataset["source"] == "file"
        assert dataset["bar_size"] == "5min"
        assert dataset["storage_session"] == "rth"
        assert dataset["adjustment_status"] == "unknown"
        assert dataset["storage_contract_status"] == "warn"
        assert "missing stock adjustment metadata" in dataset["storage_contract_warnings"]
        assert dataset["storage_contract_warning_count"] == 1
        assert dataset["storage_contract_label"] == "review"
        assert payload["storage_session_counts"] == {"rth": 1}
        assert payload["adjustment_status_counts"] == {"unknown": 1}
        assert payload["storage_contract_counts"] == {"warn": 1}
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
        symbol_summary = payload["symbol_summaries"][0]
        assert symbol_summary["symbol"] == "SPY"
        assert symbol_summary["canonical_symbol"] == "SPY"
        assert symbol_summary["raw_symbols"] == ["SPY"]
        assert symbol_summary["raw_symbol_count"] == 1
        assert symbol_summary["mixed_raw_symbols"] is False
        assert symbol_summary["file_count"] == 1
        assert symbol_summary["row_count"] == 3
        assert symbol_summary["asset_classes"] == ["etf"]
        assert symbol_summary["sources"] == ["file"]
        assert symbol_summary["bar_sizes"] == ["5min"]
        assert symbol_summary["storage_sessions"] == ["rth"]
        assert symbol_summary["storage_session_count"] == 1
        assert symbol_summary["mixed_storage_sessions"] is False
        assert symbol_summary["storage_session_profile"] == "rth"
        assert symbol_summary["quality_counts"] == {"ok": 1}
        assert symbol_summary["storage_contract_counts"] == {"warn": 1}
        assert symbol_summary["storage_contract_issue_file_count"] == 1
        assert symbol_summary["best_path"] == dataset["path"]
        assert symbol_summary["best_storage_contract_status"] == "warn"
        assert symbol_summary["best_quality_status"] == "ok"
        assert symbol_summary["best_rows"] == 3

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
        assert exported[0]["storage_session"] == "rth"
        assert exported[0]["adjustment_status"] == "unknown"
        assert exported[0]["storage_contract_status"] == "warn"
        assert exported[0]["storage_contract_warning_count"] == "1"
        assert exported[0]["storage_contract_label"] == "review"

        with request.urlopen(f"{base}/data_symbol_directory_export?limit=5", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="data_symbol_directory.csv"'
            symbol_csv_body = resp.read().decode("utf-8")
        symbol_exported = list(csv.DictReader(io.StringIO(symbol_csv_body)))
        assert len(symbol_exported) == 1
        assert symbol_exported[0]["symbol"] == "SPY"
        assert symbol_exported[0]["raw_symbols"] == "SPY"
        assert symbol_exported[0]["raw_symbol_count"] == "1"
        assert symbol_exported[0]["mixed_raw_symbols"] == "False"
        assert symbol_exported[0]["file_count"] == "1"
        assert symbol_exported[0]["row_count"] == "3"
        assert symbol_exported[0]["asset_classes"] == "etf"
        assert symbol_exported[0]["sources"] == "file"
        assert symbol_exported[0]["storage_session_count"] == "1"
        assert symbol_exported[0]["mixed_storage_sessions"] == "False"
        assert symbol_exported[0]["storage_session_profile"] == "rth"
        assert symbol_exported[0]["storage_contract_counts"] == '{"warn": 1}'
        assert symbol_exported[0]["storage_contract_issue_file_count"] == "1"
        assert symbol_exported[0]["best_storage_contract_status"] == "warn"
        assert symbol_exported[0]["best_quality_status"] == "ok"
        assert symbol_exported[0]["best_path"] == dataset["path"]

        with request.urlopen(f"{base}/data_catalog_scan_export?limit=5", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="data_catalog_scan.csv"'
            scan_csv_body = resp.read().decode("utf-8")
        scan_exported = list(csv.DictReader(io.StringIO(scan_csv_body)))
        assert [row["row_type"] for row in scan_exported] == ["root", "skipped_sample", "skipped_sample"]
        root_row = scan_exported[0]
        assert root_row["path"] == str(data_root.resolve())
        assert root_row["inventory_status"] == "bad"
        assert "parquet" in root_row["inventory_reason"].lower()
        assert root_row["candidate_count"] == "2"
        assert root_row["parsed_count"] == "1"
        assert root_row["parse_error_count"] == "1"
        assert root_row["unsupported_file_count"] == "1"
        assert root_row["scan_duration_ms"] != ""
        assert scan_exported[1]["sample_path"].endswith("BROKEN_5min_sample.parquet")
        assert scan_exported[2]["sample_path"].endswith("notes.txt")
        assert scan_exported[2]["sample_reason"] == "unsupported extension .txt"

        with request.urlopen(f"{base}/data_coverage?limit=5&max_symbols=5&max_dates=5", timeout=5) as resp:
            coverage = json.loads(resp.read().decode("utf-8"))
        assert coverage["count"] == 1
        assert coverage["symbols"][0]["symbol"] == "SPY"
        assert coverage["symbols"][0]["coverage"] == [True]
        assert coverage["symbols"][0]["storage_sessions"] == ["rth"]
        assert coverage["datasets"][0]["storage_session"] == "rth"
        assert coverage["date_bins"] == ["2026-01-02"]
        with request.urlopen(f"{base}/data_coverage_export?limit=5&max_symbols=5&max_dates=5", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            coverage_csv = resp.read().decode("utf-8")
        coverage_rows = list(csv.DictReader(io.StringIO(coverage_csv)))
        assert coverage_rows[0]["symbol"] == "SPY"
        assert coverage_rows[0]["storage_sessions"] == "rth"
        assert coverage_rows[0]["date"] == "2026-01-02"
        assert coverage_rows[0]["covered"] == "True"

        with request.urlopen(f"{base}/data_symbol_diagnostic?symbol=SPY&limit=5", timeout=5) as resp:
            diagnostic = json.loads(resp.read().decode("utf-8"))
        assert diagnostic["symbol"] == "SPY"
        assert diagnostic["status"] == "visible"
        assert diagnostic["diagnostic_summary"]["status"] == "warn"
        assert diagnostic["diagnostic_summary"]["visible_match_count"] == 1
        assert diagnostic["diagnostic_summary"]["visible_storage_contract_review_count"] == 1
        assert diagnostic["diagnostic_summary"]["root_inventory_status"] == "bad"
        assert diagnostic["catalog_matches"][0]["symbol"] == "SPY"
        assert diagnostic["catalog_matches"][0]["storage_contract_status"] == "warn"
        assert diagnostic["configured_candidates"][0]["in_catalog_scope"] is True
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_symbol_diagnostic_flags_visible_bad_timestamp_file(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "BAD_5min_sample.csv").write_text(
        "\n".join(
            [
                "not_time,price,volume",
                "abc,100,10",
                "def,101,11",
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
        with request.urlopen(f"{base}/data_symbol_diagnostic?symbol=BAD&limit=5", timeout=5) as resp:
            diagnostic = json.loads(resp.read().decode("utf-8"))

        assert diagnostic["status"] == "visible"
        assert diagnostic["diagnostic_summary"]["status"] == "bad"
        assert diagnostic["diagnostic_summary"]["visible_quality_review_count"] == 1
        assert diagnostic["diagnostic_summary"]["visible_timestamp_review_count"] == 1
        assert diagnostic["diagnostic_summary"]["visible_storage_contract_review_count"] == 1
        assert diagnostic["root_inventory"]["status"] == "ok"
        match = diagnostic["catalog_matches"][0]
        assert match["quality_status"] == "bad"
        assert "no timestamp column or DatetimeIndex found" in match["quality_warnings"]
        assert match["storage_contract_status"] == "bad"
        assert diagnostic["configured_candidates"][0]["normalized_timezone"] is None
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_normalizes_bar_size_aliases(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "BARCOL_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,close,volume,bar_size",
                "2026-01-02T14:30:00Z,100,10,5 minute",
                "2026-01-02T14:35:00Z,101,11,5 minute",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (data_root / "PATH_5_m_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,close,volume",
                "2026-01-02T14:30:00Z,100,10",
                "2026-01-02T14:35:00Z,101,11",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (data_root / "HOUR_1-hour_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,close,volume",
                "2026-01-02T14:00:00Z,100,10",
                "2026-01-02T15:00:00Z,101,11",
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
        with request.urlopen(f"{base}/data_catalog?limit=10&preview_points=2", timeout=5) as resp:
            catalog = json.loads(resp.read().decode("utf-8"))

        assert catalog["bar_size_counts"] == {"1h": 1, "5min": 2}
        by_symbol = {row["symbol"]: row for row in catalog["datasets"]}
        assert by_symbol["BARCOL"]["bar_size"] == "5min"
        assert by_symbol["PATH"]["bar_size"] == "5min"
        assert by_symbol["HOUR"]["bar_size"] == "1h"

        with request.urlopen(f"{base}/data_storage_audit?catalog_limit=10&scan_limit=10", timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))
        assert audit["configured_bar_size_guess_counts"] == {"1h": 1, "5min": 1, "unknown": 1}
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_serves_broad_data_symbol_index(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    for idx in range(12):
        symbol = f"SYM{idx:02d}"
        (data_root / f"{symbol}_1min_sample.csv").write_text(
            "\n".join([
                "timestamp,close",
                "2026-01-02T14:30:00Z,100",
                "2026-01-02T14:31:00Z,101",
            ]) + "\n",
            encoding="utf-8",
        )

    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_catalog?limit=3&preview_points=2", timeout=5) as resp:
            catalog = json.loads(resp.read().decode("utf-8"))
        assert catalog["count"] == 3
        assert catalog["scan_capped_root_count"] == 1

        with request.urlopen(f"{base}/data_symbol_index?limit=20", timeout=5) as resp:
            index = json.loads(resp.read().decode("utf-8"))
        assert index["file_count"] == 12
        assert index["symbol_count"] == 12
        assert index["index_complete"] is True
        assert index["scan_capped_root_count"] == 0
        assert index["bar_size_counts"] == {"1min": 12}
        assert index["asset_class_counts"] == {"stock": 12}
        assert index["source_counts"] == {"file": 12}
        assert index["symbols"][0]["file_count"] == 1
        assert index["symbols"][0]["sample_paths"][0].endswith("_1min_sample.csv")
        assert len(index["files"]) == 12

        with request.urlopen(f"{base}/data_symbol_index_export?limit=20", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="data_symbol_index.csv"'
            csv_body = resp.read().decode("utf-8")
        exported = list(csv.DictReader(io.StringIO(csv_body)))
        assert exported[0]["row_type"] == "symbol"
        assert exported[0]["symbol"].startswith("SYM")
        assert exported[0]["file_count"] == "1"
        assert any(row["row_type"] == "file" and row["path"].endswith("_1min_sample.csv") for row in exported)

        with request.urlopen(f"{base}/data_symbol_index?limit=5", timeout=5) as resp:
            capped = json.loads(resp.read().decode("utf-8"))
        assert capped["file_count"] == 5
        assert capped["scan_capped_root_count"] == 1
        assert capped["index_complete"] is False
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_symbol_summaries_group_canonical_crypto_symbols(tmp_path):
    data_root = tmp_path / "data"
    crypto_root = data_root / "crypto"
    crypto_root.mkdir(parents=True)
    (crypto_root / "BTC_1min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,close,volume",
                "2026-01-02T14:30:00Z,100,10",
                "2026-01-02T14:31:00Z,101,11",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    (crypto_root / "BTC-USD_1min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,close,volume",
                "2026-01-02T14:32:00Z,102,12",
                "2026-01-02T14:33:00Z,103,13",
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
        with request.urlopen(f"{base}/data_catalog?limit=10&preview_points=2", timeout=5) as resp:
            catalog = json.loads(resp.read().decode("utf-8"))

        assert catalog["count"] == 2
        assert catalog["symbol_count"] == 1
        summary = catalog["symbol_summaries"][0]
        assert summary["symbol"] == "BTC-USD"
        assert summary["canonical_symbol"] == "BTC-USD"
        assert summary["raw_symbols"] == ["BTC", "BTC-USD"]
        assert summary["raw_symbol_count"] == 2
        assert summary["mixed_raw_symbols"] is True
        assert summary["file_count"] == 2
        assert summary["row_count"] == 4

        with request.urlopen(f"{base}/data_symbol_directory_export?limit=10", timeout=5) as resp:
            exported = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        assert exported[0]["symbol"] == "BTC-USD"
        assert exported[0]["raw_symbols"] == "BTC;BTC-USD"
        assert exported[0]["mixed_raw_symbols"] == "True"
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
        assert payload["gap_rows"][0]["storage_session"] == "unknown"
        assert payload["gap_rows"][0]["estimated_missing_intervals"] > 0
        assert payload["calendar_rows"][0]["symbol"] == "GAP"
        assert payload["calendar_rows"][0]["storage_session"] == "unknown"
        assert payload["calendar_rows"][0]["missing_calendar_days"] == 1
        with request.urlopen(f"{base}/data_gap_summary_export?catalog_limit=5&top_limit=5", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            csv_body = resp.read().decode("utf-8")
        exported = list(csv.DictReader(io.StringIO(csv_body)))
        assert {row["row_type"] for row in exported} == {"timestamp_gap", "calendar_gap"}
        assert exported[0]["symbol"] == "GAP"
        assert exported[0]["storage_session"] == "unknown"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_marks_extended_session_in_catalog_coverage_and_gaps(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "EXT_5min_1D_now_TRADES_SMART_rthFalse.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
                "2026-01-02T14:35:00Z,100.5,101,100,100.75,1100",
                "2026-01-02T14:40:00Z,100.75,102,100.5,101.25,900",
                "2026-01-02T15:10:00Z,101.25,102,101,101.5,900",
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
            catalog = json.loads(resp.read().decode("utf-8"))

        dataset = catalog["datasets"][0]
        assert dataset["symbol"] == "EXT"
        assert dataset["storage_session"] == "extended"
        assert catalog["storage_session_counts"] == {"extended": 1}
        assert catalog["symbol_summaries"][0]["storage_sessions"] == ["extended"]

        with request.urlopen(f"{base}/data_coverage?limit=5&max_symbols=5&max_dates=5", timeout=5) as resp:
            coverage = json.loads(resp.read().decode("utf-8"))
        assert coverage["symbols"][0]["storage_sessions"] == ["extended"]
        assert coverage["datasets"][0]["storage_session"] == "extended"

        with request.urlopen(f"{base}/data_gap_summary?catalog_limit=5&top_limit=5", timeout=5) as resp:
            summary = json.loads(resp.read().decode("utf-8"))
        assert summary["gap_rows"][0]["symbol"] == "EXT"
        assert summary["gap_rows"][0]["storage_session"] == "extended"
        assert summary["gap_rows"][0]["estimated_missing_intervals"] > 0

        with request.urlopen(f"{base}/data_gap_summary_export?catalog_limit=5&top_limit=5", timeout=5) as resp:
            exported = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        gap_export = next(row for row in exported if row["row_type"] == "timestamp_gap")
        assert gap_export["symbol"] == "EXT"
        assert gap_export["storage_session"] == "extended"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_catalog_infers_external_data_sources(tmp_path):
    data_root = tmp_path / "data"
    rows = "\n".join(
        [
            "timestamp,open,high,low,close,volume",
            "2026-01-02T14:30:00Z,100,101,99,100.5,1000",
            "2026-01-02T14:35:00Z,100.5,101,100,100.75,1100",
        ]
    ) + "\n"
    for source, symbol in [("schwab", "SCHW"), ("polygon", "POLY"), ("firstrate", "FIRST")]:
        source_dir = data_root / source
        source_dir.mkdir(parents=True, exist_ok=True)
        (source_dir / f"{symbol}_1min_sample.csv").write_text(rows, encoding="utf-8")

    server = create_server("127.0.0.1", 0, tmp_path / "state", data_roots=[data_root])
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/data_catalog?limit=10&preview_points=2", timeout=5) as resp:
            catalog = json.loads(resp.read().decode("utf-8"))

        assert catalog["source_counts"] == {"firstrate": 1, "polygon": 1, "schwab": 1}
        datasets = {item["symbol"]: item for item in catalog["datasets"]}
        assert datasets["SCHW"]["source"] == "schwab"
        assert datasets["POLY"]["source"] == "polygon"
        assert datasets["FIRST"]["source"] == "firstrate"

        with request.urlopen(f"{base}/data_coverage?limit=10&max_symbols=10&max_dates=5", timeout=5) as resp:
            coverage = json.loads(resp.read().decode("utf-8"))
        sources_by_symbol = {item["symbol"]: item["sources"] for item in coverage["symbols"]}
        assert sources_by_symbol["SCHW"] == ["schwab"]
        assert sources_by_symbol["POLY"] == ["polygon"]
        assert sources_by_symbol["FIRST"] == ["firstrate"]

        with request.urlopen(f"{base}/data_symbol_directory_export?limit=10", timeout=5) as resp:
            exported = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        export_sources = {row["symbol"]: row["sources"] for row in exported}
        assert export_sources["SCHW"] == "schwab"
        assert export_sources["POLY"] == "polygon"
        assert export_sources["FIRST"] == "firstrate"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_marks_crypto_calendar_gaps_as_24_7(tmp_path):
    data_root = tmp_path / "data"
    crypto_root = data_root / "cache" / "zerohash"
    crypto_root.mkdir(parents=True)
    (crypto_root / "BTC-USD_1min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-01T00:00:00Z,100,101,99,100.5,1000",
                "2026-01-01T00:01:00Z,100.5,101,100,100.75,1100",
                "2026-01-03T00:00:00Z,100.75,102,100.5,101.25,900",
                "2026-01-03T00:01:00Z,101.25,102,101,101.5,900",
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
        with request.urlopen(f"{base}/data_coverage?limit=5&max_symbols=5&max_dates=5", timeout=5) as resp:
            coverage = json.loads(resp.read().decode("utf-8"))

        btc = coverage["symbols"][0]
        assert btc["symbol"] == "BTC-USD"
        assert btc["asset_class"] == "crypto"
        assert btc["storage_sessions"] == ["24_7"]
        assert btc["date_count"] == 2
        assert coverage["date_bins"] == ["2026-01-01", "2026-01-03"]
        dataset = coverage["datasets"][0]
        assert dataset["storage_session"] == "24_7"
        assert dataset["missing_calendar_days"] == 1

        with request.urlopen(f"{base}/data_coverage_export?limit=5&max_symbols=5&max_dates=5", timeout=5) as resp:
            exported = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        assert exported[0]["storage_sessions"] == "24_7"

        with request.urlopen(f"{base}/data_gap_summary?catalog_limit=5&top_limit=5", timeout=5) as resp:
            summary = json.loads(resp.read().decode("utf-8"))

        calendar = summary["calendar_rows"][0]
        assert calendar["symbol"] == "BTC-USD"
        assert calendar["asset_class"] == "crypto"
        assert calendar["source"] == "zerohash"
        assert calendar["bar_size"] == "1min"
        assert calendar["storage_session"] == "24_7"
        assert calendar["missing_calendar_days"] == 1

        with request.urlopen(f"{base}/data_gap_summary_export?catalog_limit=5&top_limit=5", timeout=5) as resp:
            gap_exported = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        calendar_export = next(row for row in gap_exported if row["row_type"] == "calendar_gap")
        assert calendar_export["symbol"] == "BTC-USD"
        assert calendar_export["storage_session"] == "24_7"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_uses_configured_data_catalog_limits(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    for index in range(6):
        (data_root / f"T{index}_1min_sample.csv").write_text(
            "\n".join(
                [
                    "timestamp,open,high,low,close,volume",
                    f"2026-01-02T14:3{index}:00Z,100,101,99,100.5,1000",
                ]
            )
            + "\n",
            encoding="utf-8",
        )

    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        data_roots=[data_root],
        data_catalog_default_limit=3,
        data_catalog_max_limit=6,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/workbench_diagnostics", timeout=5) as resp:
            diagnostics = json.loads(resp.read().decode("utf-8"))
        assert diagnostics["data_catalog"] == {"default_limit": 3, "max_limit": 6}

        with request.urlopen(f"{base}/data_catalog?preview_points=2", timeout=5) as resp:
            default_payload = json.loads(resp.read().decode("utf-8"))
        assert default_payload["limit"] == 3
        assert default_payload["default_limit"] == 3
        assert default_payload["max_limit"] == 6
        assert default_payload["count"] == 3
        assert default_payload["root_summaries"][0]["scan_capped"] is True
        assert default_payload["scan_capped_root_count"] == 1
        assert default_payload["catalog_complete"] is False
        assert default_payload["catalog_visibility_status"] == "capped"

        with request.urlopen(f"{base}/data_catalog_export?limit=6", timeout=5) as resp:
            exported = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        assert len(exported) == 6

        try:
            request.urlopen(f"{base}/data_catalog?limit=7&preview_points=2", timeout=5)
            raise AssertionError("expected limit rejection")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "limit must be between 1 and 6"
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
        assert payload["symbol_count"] == 206
        assert payload["count"] > 2
        assert len(payload["symbol_summaries"]) == 206
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
        assert btc["canonical_symbol"] == "BTC-USD"
        assert btc["storage_session"] == "24_7"
        assert btc["adjustment_status"] == "not_applicable"
        btc_summary = next(item for item in payload["symbol_summaries"] if item["symbol"] == "BTC-USD")
        assert btc_summary["asset_classes"] == ["crypto"]
        assert btc_summary["sources"] == ["zerohash"]
        assert btc_summary["bar_sizes"] == ["1min"]
        assert btc_summary["best_path"] == btc["path"]

        with request.urlopen(f"{base}/data_catalog?limit=50&preview_points=2", timeout=10) as resp:
            capped = json.loads(resp.read().decode("utf-8"))
        assert capped["count"] == 50
        assert capped["symbol_count"] == 50
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
    for root, filename_symbol, session in [
        (data_root, "SPY_adjusted_regular_hours", "rth"),
        (data_root, "QQQ_raw_extended_hours", "extended"),
        (suggested_root, "BTC-USD", "24_7"),
    ]:
        (root / f"{filename_symbol}_5min_sample.csv").write_text(
            "\n".join(
                [
                    "timestamp,open,high,low,close,volume,session",
                    f"2026-01-02T14:30:00Z,100,101,99,100.5,1000,{session}",
                    f"2026-01-02T14:35:00Z,100.5,101,100,100.75,1100,{session}",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
    (data_root / "notes.txt").write_text("not market data\n", encoding="utf-8")
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
        assert audit["unsupported_file_count"] == 1
        assert audit["visibility_summary"]["audited_supported_file_count"] == 3
        assert audit["visibility_summary"]["catalog_visible_configured_file_count"] == 1
        assert audit["visibility_summary"]["hidden_configured_file_count"] == 1
        assert audit["visibility_summary"]["suggested_unconfigured_file_count"] == 1
        assert audit["visibility_summary"]["hidden_total_file_count"] == 2
        assert audit["visibility_summary"]["unsupported_file_count"] == 1
        assert audit["visibility_summary"]["capped_root_count"] == 0
        assert audit["visibility_summary"]["configured_visibility_pct"] == pytest.approx(50.0)
        assert audit["unsupported_extension_counts"] == {".txt": 1}
        assert audit["storage_session_guess_counts"] == {"24_7": 1, "extended": 1, "rth": 1}
        assert audit["adjustment_status_guess_counts"] == {"adjusted": 1, "not_applicable": 1, "raw": 1}
        assert audit["storage_contract_guess_counts"] == {"ok": 3}
        assert audit["scan_duration_ms_total"] >= 0
        configured = audit["configured_roots"][0]
        assert configured["display_path"] == str(data_root.resolve())
        assert configured["root_scope"] == "local_path"
        assert configured["root_scope_note"]
        assert configured["catalog_visible_count"] == 1
        assert configured["hidden_file_count"] == 1
        assert configured["scan_duration_ms"] >= 0
        assert configured["asset_class_guess_counts"] == {"etf": 2}
        assert configured["bar_size_guess_counts"] == {"5min": 2}
        assert configured["storage_session_guess_counts"] == {"extended": 1, "rth": 1}
        assert configured["adjustment_status_guess_counts"] == {"adjusted": 1, "raw": 1}
        assert configured["storage_contract_guess_counts"] == {"ok": 2}
        assert configured["unsupported_file_count"] == 1
        assert configured["unsupported_extension_counts"] == {".txt": 1}
        assert configured["sample_unsupported_paths"][0].endswith("notes.txt")
        assert configured["sample_hidden_paths"][0].endswith("_5min_sample.csv")
        suggested = audit["suggested_roots"][0]
        assert suggested["display_path"] == str(suggested_root.resolve())
        assert suggested["configured"] is False
        assert suggested["root_scope"] == "local_cache"
        assert suggested["hidden_file_count"] == 1
        assert suggested["storage_session_guess_counts"] == {"24_7": 1}
        assert suggested["adjustment_status_guess_counts"] == {"not_applicable": 1}
        assert suggested["storage_contract_guess_counts"] == {"ok": 1}
        with request.urlopen(f"{base}/data_storage_audit_export?catalog_limit=1&scan_limit=10", timeout=5) as resp:
            csv_body = resp.read().decode("utf-8")
            assert resp.headers["Content-Type"].startswith("text/csv")
        assert "scope,path,display_path" in csv_body
        assert "scan_duration_ms" in csv_body.splitlines()[0]
        assert "unsupported_file_count" in csv_body.splitlines()[0]
        assert "sample_unsupported_paths" in csv_body.splitlines()[0]
        assert "asset_class_guess_counts" in csv_body.splitlines()[0]
        assert "bar_size_guess_counts" in csv_body.splitlines()[0]
        assert "storage_session_guess_counts" in csv_body.splitlines()[0]
        assert "adjustment_status_guess_counts" in csv_body.splitlines()[0]
        assert "storage_contract_guess_counts" in csv_body.splitlines()[0]
        assert "configured" in csv_body
        assert "suggested" in csv_body
        assert "notes.txt" in csv_body
        assert str(suggested_root.resolve()) in csv_body
    finally:
        server.shutdown()
        server.server_close()


def test_data_storage_audit_cli_reports_json_and_human(tmp_path, monkeypatch, capsys):
    monkeypatch.setattr(status_server, "SUGGESTED_DATA_ROOTS", ())
    data_root = tmp_path / "data"
    data_root.mkdir()
    (data_root / "SPY_raw_regular_hours_5min_sample.csv").write_text(
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
    assert payload["configured_storage_session_guess_counts"] == {"24_7": 1, "rth": 1}
    assert payload["configured_adjustment_status_guess_counts"] == {"not_applicable": 1, "raw": 1}
    assert payload["configured_storage_contract_guess_counts"] == {"ok": 2}
    assert payload["scan_duration_ms_total"] >= 0

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
    assert "Scan time:" in report
    assert "Storage sessions: 24_7:1 rth:1" in report
    assert "Adjustments: not_applicable:1 raw:1" in report
    assert "Storage contract: ok:2" in report
    assert "scan_ms=" in report
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
                "timestamp,open,high,low,close,volume",
                "2026-01-02T14:30:00Z,100,101,99,100,1000",
                "not-a-time,100,101,99,,1100",
                "2026-01-02T14:40:00Z,101,100,102,101,",
                "2026-01-02T14:40:00Z,101,102,100,101.5,-5",
                "2026-01-02T15:00:00Z,102,103,101,102,1300",
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
        assert any("bars with high below low" in item for item in datasets["WARN"]["quality_warnings"])
        assert any("closes outside high/low range" in item for item in datasets["WARN"]["quality_warnings"])
        assert any("negative volume values" in item for item in datasets["WARN"]["quality_warnings"])
        assert any("estimated missing intervals" in item for item in datasets["WARN"]["quality_warnings"])
        assert datasets["WARN"]["high_low_inversion_count"] == 1
        assert datasets["WARN"]["close_outside_high_low_count"] == 1
        assert datasets["WARN"]["negative_volume_count"] == 1
        assert datasets["BAD"]["quality_status"] == "bad"
        assert "no parseable timestamps" in datasets["BAD"]["quality_warnings"]
        assert "no close/last column found" in datasets["BAD"]["quality_warnings"]

        with request.urlopen(f"{base}/data_detail?path={data_root / 'WARN_1min_sample.csv'}&preview_points=3", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
        assert detail["quality"]["high_low_inversion_count"] == 1
        assert detail["quality"]["close_outside_high_low_count"] == 1
        assert detail["quality"]["negative_volume_count"] == 1
        assert any("negative volume values" in item for item in detail["quality"]["quality_warnings"])

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
    close_only_file = data_root / "CLOSE_1min_sample.csv"
    close_only_file.write_text(
        "\n".join(
            [
                "timestamp,close",
                "2026-01-02T14:30:00Z,10.0",
                "2026-01-02T14:31:00Z,10.5",
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
        assert detail["canonical_symbol"] == "SPY"
        assert detail["asset_class"] == "etf"
        assert detail["source"] == "file"
        assert detail["storage_session"] == "unknown"
        assert detail["adjustment_status"] == "unknown"
        assert detail["storage_contract_status"] == "warn"
        assert set(detail["storage_contract_warnings"]) == {
            "missing storage-session metadata",
            "missing stock adjustment metadata",
        }
        assert detail["storage_contract_warning_count"] == 2
        assert detail["size_bytes"] > 0
        assert detail["modified_at"]
        assert detail["rows"] == 4
        assert detail["column_map"]["close"] == "close"
        assert detail["preview"][0]["open"] == 100.0
        assert detail["preview"][0]["high"] == 101.0
        assert detail["preview"][0]["low"] == 99.0
        assert detail["coverage"]["median_interval_seconds"] == 300.0
        assert detail["coverage"]["largest_gap_seconds"] == 900.0
        assert detail["coverage"]["estimated_missing_intervals"] == 2
        assert detail["gaps"][0]["estimated_missing_intervals"] == 2
        assert detail["quality"]["missing_interval_count_returned"] == 2
        assert detail["quality"]["missing_interval_omitted_count"] == 0
        assert detail["missing_interval_limit"] == 100
        assert detail["missing_interval_omitted_count"] == 0
        assert [item["expected_timestamp"] for item in detail["missing_intervals"]] == [
            "2026-01-02T14:40:00+00:00",
            "2026-01-02T14:45:00+00:00",
        ]
        assert detail["missing_intervals"][0]["from_timestamp"] == "2026-01-02T14:35:00+00:00"
        assert detail["missing_intervals"][0]["to_timestamp"] == "2026-01-02T14:50:00+00:00"
        assert detail["quality"]["quality_status"] == "warn"
        assert "2 estimated missing intervals" in detail["quality"]["quality_warnings"]
        assert detail["price_stats"]["start_close"] == 100.0
        assert detail["price_stats"]["end_close"] == 103.0
        assert abs(detail["price_stats"]["total_return_pct"] - 3.0) < 1e-9
        assert detail["ohlc_stats"]["available"] is True
        assert detail["ohlc_stats"]["candle_count"] == 4
        assert detail["ohlc_stats"]["first_open"] == 100.0
        assert detail["ohlc_stats"]["last_close"] == 103.0
        assert detail["ohlc_stats"]["range_high"] == 104.0
        assert detail["ohlc_stats"]["range_low"] == 99.0
        assert abs(detail["ohlc_stats"]["open_to_close_pct"] - 3.0) < 1e-9
        assert abs(detail["ohlc_stats"]["high_low_range_pct"] - ((104.0 / 99.0 - 1.0) * 100.0)) < 1e-9
        assert detail["ohlc_stats"]["up_candles"] == 3
        assert detail["ohlc_stats"]["down_candles"] == 0
        assert detail["ohlc_stats"]["flat_candles"] == 1
        assert detail["ohlc_stats"]["up_candle_pct"] == 75.0
        assert detail["return_stats"]["count"] == 3
        assert detail["volume_stats"]["zero_rows"] == 1
        assert len(detail["preview"]) == 4
        assert detail["viewer"]["available_rows"] == 4
        assert detail["viewer"]["filtered_rows"] == 4
        assert detail["viewer"]["sampled"] is False
        assert detail["viewer"]["sampled_points"] == 4
        assert detail["viewer"]["points_omitted"] == 0
        assert detail["viewer"]["status"] == "full"
        assert detail["viewer"]["status_reason"] == "all filtered rows are plotted"

        with request.urlopen(f"{base}/data_detail?path={data_file}&preview_points=2&gap_limit=5", timeout=5) as resp:
            sampled = json.loads(resp.read().decode("utf-8"))

        assert sampled["viewer"]["sample_mode"] == "sampled"
        assert sampled["viewer"]["filtered_rows"] == 4
        assert sampled["viewer"]["sampled_points"] == 2
        assert sampled["viewer"]["sampled"] is True
        assert sampled["viewer"]["points_omitted"] == 2
        assert sampled["viewer"]["status"] == "sampled"
        assert "evenly sampled" in sampled["viewer"]["status_reason"]

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
        assert filtered["ohlc_stats"]["candle_count"] == 2
        assert filtered["ohlc_stats"]["range_high"] == 103.0
        assert filtered["ohlc_stats"]["range_low"] == 99.0
        assert filtered["ohlc_stats"]["up_candles"] == 2
        assert len(filtered["preview"]) == 2

        with request.urlopen(f"{base}/data_detail?path={close_only_file}&preview_points=2", timeout=5) as resp:
            close_only = json.loads(resp.read().decode("utf-8"))

        assert close_only["ohlc_stats"]["available"] is False
        assert close_only["ohlc_stats"]["missing_columns"] == ["open", "high", "low"]
        assert close_only["price_stats"]["start_close"] == 10.0

        with request.urlopen(
            f"{base}/data_detail_export?"
            f"path={data_file}&start=2026-01-02T14:35:00Z&end=2026-01-02T14:50:00Z&max_rows=10",
            timeout=5,
        ) as resp:
            range_csv_body = resp.read().decode("utf-8")
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert "SPY_5min_sample_range.csv" in resp.headers["Content-Disposition"]
        range_exported = list(csv.DictReader(io.StringIO(range_csv_body)))
        assert [row["normalized_timestamp"] for row in range_exported] == [
            "2026-01-02T14:35:00+00:00",
            "2026-01-02T14:50:00+00:00",
        ]
        assert range_exported[0]["path"] == str(data_file)
        assert range_exported[0]["symbol"] == "SPY"
        assert range_exported[0]["close"] == "101.0"
        assert range_exported[1]["volume"] == "1500"

        try:
            request.urlopen(f"{base}/data_detail_export?path={data_file}&max_rows=1", timeout=5)
            raise AssertionError("expected data detail export cap response")
        except error.HTTPError as exc:
            assert exc.code == 400
            capped_export = json.loads(exc.read().decode("utf-8"))
        assert "above export max_rows 1" in capped_export["error"]

        with request.urlopen(
            f"{base}/data_detail?"
            f"path={data_file}&preview_points=4&gap_limit=5&missing_interval_limit=1",
            timeout=5,
        ) as resp:
            capped = json.loads(resp.read().decode("utf-8"))

        assert len(capped["missing_intervals"]) == 1
        assert capped["missing_interval_omitted_count"] == 1
        assert capped["quality"]["missing_interval_omitted_count"] == 1

        with request.urlopen(
            f"{base}/data_missing_intervals_export?path={data_file}&max_rows=10",
            timeout=5,
        ) as resp:
            csv_body = resp.read().decode("utf-8")
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert "missing_intervals.csv" in resp.headers["Content-Disposition"]
        exported = list(csv.DictReader(io.StringIO(csv_body)))
        assert [row["expected_timestamp"] for row in exported] == [
            "2026-01-02T14:40:00+00:00",
            "2026-01-02T14:45:00+00:00",
        ]
        assert exported[0]["path"] == str(data_file)
        assert exported[0]["estimated_missing_intervals"] == "2"
        assert exported[0]["omitted_by_export_cap"] == "0"

        with request.urlopen(
            f"{base}/data_missing_intervals_export?path={data_file}&max_rows=1",
            timeout=5,
        ) as resp:
            capped_csv = resp.read().decode("utf-8")
        capped_exported = list(csv.DictReader(io.StringIO(capped_csv)))
        assert len(capped_exported) == 1
        assert capped_exported[0]["omitted_by_export_cap"] == "1"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_honors_explicit_source_timezone_metadata(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "SPY_5min_sample.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume,source_timezone,session,adjustment",
                "2026-01-02 09:30:00,100,101,99,100.0,1000,America/New_York,rth,raw",
                "2026-01-02 09:35:00,100,102,99,101.0,1200,America/New_York,rth,raw",
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
        with request.urlopen(f"{base}/data_catalog?limit=5&preview_points=2", timeout=5) as resp:
            catalog = json.loads(resp.read().decode("utf-8"))

        dataset = catalog["datasets"][0]
        assert dataset["source_timezone"] == "America/New_York"
        assert dataset["normalized_timezone"] == "UTC"
        assert dataset["storage_contract_status"] == "ok"
        assert dataset["storage_contract_warnings"] == []
        assert dataset["first_timestamp"] == "2026-01-02T14:30:00+00:00"
        assert dataset["last_timestamp"] == "2026-01-02T14:35:00+00:00"
        assert dataset["preview"][0]["timestamp"] == "2026-01-02T14:30:00+00:00"

        with request.urlopen(f"{base}/data_detail?path={data_file}&preview_points=2", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))

        assert detail["source_timezone"] == "America/New_York"
        assert detail["coverage"]["first_timestamp"] == "2026-01-02T14:30:00+00:00"
        assert detail["viewer"]["first_timestamp"] == "2026-01-02T14:30:00+00:00"
        assert detail["preview"][0]["timestamp"] == "2026-01-02T14:30:00+00:00"

        with request.urlopen(f"{base}/data_detail_export?path={data_file}&max_rows=10", timeout=5) as resp:
            exported = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        assert exported[0]["normalized_timestamp"] == "2026-01-02T14:30:00+00:00"
        assert exported[0]["source_timezone"] == "America/New_York"
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
        assert row0["worst_date_hours"][0]["date_utc"] == "2026-01-02"
        assert row0["worst_date_hours"][0]["hour_utc"] == 14
        assert row0["worst_date_hours"][0]["estimated_missing_intervals"] == 2
        assert row0["worst_date_hour_matrix"][0]["date_utc"] == "2026-01-02"
        assert row0["worst_date_hour_matrix"][0]["hours"][14]["estimated_missing_intervals"] == 2
        assert payload["date_hour_rows"][0]["symbol"] == "SPY"
        assert payload["date_hour_rows"][0]["date_utc"] == "2026-01-02"
        assert payload["date_hour_rows"][0]["hour_utc"] == 14
        assert payload["date_hour_matrix"][0]["symbol"] == "SPY"
        assert payload["date_hour_matrix"][0]["date_utc"] == "2026-01-02"
        assert payload["date_hour_matrix"][0]["hours"][14]["estimated_missing_intervals"] == 2
        with request.urlopen(f"{base}/data_minute_heatmap_export?catalog_limit=10&top_limit=5", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            csv_body = resp.read().decode("utf-8")
        exported = list(csv.DictReader(io.StringIO(csv_body)))
        assert {row["row_type"] for row in exported} == {"hour_summary", "date_hour", "date_hour_matrix"}
        assert exported[0]["symbol"] == "SPY"
        assert exported[0]["hour_utc"] == "14"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_data_minute_heatmap_marks_crypto_24_7_completeness(tmp_path):
    data_root = tmp_path / "data"
    crypto_root = data_root / "cache" / "zerohash"
    crypto_root.mkdir(parents=True)
    data_file = crypto_root / "BTC-USD_1min_sample.csv"
    data_file.write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T00:00:00Z,100,101,99,100.0,1000",
                "2026-01-02T00:01:00Z,100,102,99,101.0,1100",
                "2026-01-02T23:58:00Z,101,103,100,102.0,1200",
                "2026-01-02T23:59:00Z,102,104,101,103.0,1300",
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
        with request.urlopen(f"{base}/data_minute_heatmap?catalog_limit=10&top_limit=30", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["status"] == "warn"
        assert payload["dataset_count"] == 1
        assert payload["total_expected_intervals"] == 1440
        assert payload["total_estimated_missing_intervals"] == 1436
        row0 = payload["rows"][0]
        assert row0["symbol"] == "BTC-USD"
        assert row0["asset_class"] == "crypto"
        assert row0["source"] == "zerohash"
        assert row0["bar_size"] == "1min"
        assert row0["storage_session"] == "24_7"
        assert row0["median_interval_seconds"] == 60.0
        assert row0["actual_intervals"] == 4
        assert row0["expected_intervals"] == 1440
        hour0 = next(hour for hour in row0["hours"] if hour["hour_utc"] == 0)
        hour1 = next(hour for hour in row0["hours"] if hour["hour_utc"] == 1)
        hour23 = next(hour for hour in row0["hours"] if hour["hour_utc"] == 23)
        assert hour0["actual_intervals"] == 2
        assert hour0["estimated_missing_intervals"] == 58
        assert hour0["expected_intervals"] == 60
        assert hour1["actual_intervals"] == 0
        assert hour1["estimated_missing_intervals"] == 60
        assert hour1["expected_intervals"] == 60
        assert hour23["actual_intervals"] == 2
        assert hour23["estimated_missing_intervals"] == 58
        assert hour23["expected_intervals"] == 60
        assert payload["date_hour_rows"][0]["symbol"] == "BTC-USD"
        assert payload["date_hour_rows"][0]["storage_session"] == "24_7"
        assert payload["date_hour_rows"][0]["date_utc"] == "2026-01-02"

        with request.urlopen(f"{base}/data_minute_heatmap_export?catalog_limit=10&top_limit=30", timeout=5) as resp:
            csv_body = resp.read().decode("utf-8")
        exported = list(csv.DictReader(io.StringIO(csv_body)))
        assert exported[0]["storage_session"] == "24_7"
        assert exported[0]["symbol"] == "BTC-USD"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_preserves_mixed_storage_sessions_across_data_diagnostics(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    stock_rows = "\n".join(
        [
            "timestamp,open,high,low,close,volume",
            "2026-01-02T14:30:00Z,100,101,99,100.0,1000",
            "2026-01-02T14:35:00Z,100,102,99,101.0,1100",
            "2026-01-02T14:40:00Z,101,103,100,102.0,1200",
            "2026-01-02T14:55:00Z,102,104,101,103.0,1300",
        ]
    ) + "\n"
    (data_root / "SPY_5min_1D_now_TRADES_SMART_rthTrue.csv").write_text(stock_rows, encoding="utf-8")
    (data_root / "SPY_5min_1D_now_TRADES_SMART_rthFalse.csv").write_text(stock_rows, encoding="utf-8")
    crypto_root = data_root / "cache" / "zerohash"
    crypto_root.mkdir(parents=True)
    (crypto_root / "BTC-USD_1min_sample.csv").write_text(
        "\n".join(
            [
                "timestamp,open,high,low,close,volume",
                "2026-01-02T00:00:00Z,100,101,99,100.0,1000",
                "2026-01-02T00:01:00Z,100,102,99,101.0,1100",
                "2026-01-02T00:02:00Z,101,103,100,102.0,1200",
                "2026-01-02T00:06:00Z,102,104,101,103.0,1300",
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
        with request.urlopen(f"{base}/data_catalog?limit=10&preview_points=2", timeout=5) as resp:
            catalog = json.loads(resp.read().decode("utf-8"))
        assert catalog["storage_session_counts"] == {"24_7": 1, "extended": 1, "rth": 1}
        catalog_sessions = {(item["symbol"], item["storage_session"]) for item in catalog["datasets"]}
        assert catalog_sessions == {("BTC-USD", "24_7"), ("SPY", "extended"), ("SPY", "rth")}
        summary_sessions = {item["symbol"]: item["storage_sessions"] for item in catalog["symbol_summaries"]}
        assert summary_sessions == {"BTC-USD": ["24_7"], "SPY": ["extended", "rth"]}
        spy_summary = next(item for item in catalog["symbol_summaries"] if item["symbol"] == "SPY")
        assert spy_summary["file_count"] == 2
        assert spy_summary["storage_session_count"] == 2
        assert spy_summary["mixed_storage_sessions"] is True
        assert spy_summary["storage_session_profile"] == "mixed: extended, rth"

        with request.urlopen(f"{base}/data_coverage?limit=10&max_symbols=10&max_dates=5", timeout=5) as resp:
            coverage = json.loads(resp.read().decode("utf-8"))
        coverage_sessions = {item["symbol"]: item["storage_sessions"] for item in coverage["symbols"]}
        assert coverage_sessions == {"BTC-USD": ["24_7"], "SPY": ["extended", "rth"]}
        spy_coverage = next(item for item in coverage["symbols"] if item["symbol"] == "SPY")
        assert spy_coverage["dataset_count"] == 2
        assert spy_coverage["storage_session_count"] == 2
        assert spy_coverage["mixed_storage_sessions"] is True
        assert spy_coverage["storage_session_profile"] == "mixed: extended, rth"
        dataset_sessions = {(item["symbol"], item["storage_session"]) for item in coverage["datasets"]}
        assert dataset_sessions == {("BTC-USD", "24_7"), ("SPY", "extended"), ("SPY", "rth")}

        with request.urlopen(f"{base}/data_coverage_export?limit=10&max_symbols=10&max_dates=5", timeout=5) as resp:
            coverage_export = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        exported_sessions = {row["symbol"]: row["storage_sessions"] for row in coverage_export}
        assert exported_sessions == {"BTC-USD": "24_7", "SPY": "extended;rth"}
        spy_coverage_export = next(row for row in coverage_export if row["symbol"] == "SPY")
        assert spy_coverage_export["storage_session_count"] == "2"
        assert spy_coverage_export["mixed_storage_sessions"] == "True"
        assert spy_coverage_export["storage_session_profile"] == "mixed: extended, rth"

        with request.urlopen(f"{base}/data_gap_summary?catalog_limit=10&top_limit=10", timeout=5) as resp:
            gap_summary = json.loads(resp.read().decode("utf-8"))
        gap_sessions = {(item["symbol"], item["storage_session"]) for item in gap_summary["gap_rows"]}
        assert gap_sessions == {("BTC-USD", "24_7"), ("SPY", "extended"), ("SPY", "rth")}

        with request.urlopen(f"{base}/data_gap_summary_export?catalog_limit=10&top_limit=10", timeout=5) as resp:
            gap_export = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        exported_gap_sessions = {
            (row["symbol"], row["storage_session"])
            for row in gap_export
            if row["row_type"] == "timestamp_gap"
        }
        assert exported_gap_sessions == {("BTC-USD", "24_7"), ("SPY", "extended"), ("SPY", "rth")}

        with request.urlopen(f"{base}/data_minute_heatmap?catalog_limit=10&top_limit=10", timeout=5) as resp:
            heatmap = json.loads(resp.read().decode("utf-8"))
        heatmap_sessions = {(item["symbol"], item["storage_session"]) for item in heatmap["rows"]}
        assert heatmap_sessions == {("BTC-USD", "24_7"), ("SPY", "extended"), ("SPY", "rth")}

        with request.urlopen(f"{base}/data_minute_heatmap_export?catalog_limit=10&top_limit=10", timeout=5) as resp:
            heatmap_export = list(csv.DictReader(io.StringIO(resp.read().decode("utf-8"))))
        exported_heatmap_sessions = {
            (row["symbol"], row["storage_session"])
            for row in heatmap_export
            if row["row_type"] == "hour_summary"
        }
        assert exported_heatmap_sessions == {("BTC-USD", "24_7"), ("SPY", "extended"), ("SPY", "rth")}
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
        assert options["form_schema_version"] == 5
        assert plugin["visibility"] == "public_example"
        assert "not a viable trading strategy" in plugin["description"]
        assert "private plugins" in plugin["boundary"]
        assert [field["name"] for field in plugin["result_fields"]] == [
            "reason",
            "signal_value",
            "threshold_distance",
        ]
        assert plugin["result_sections"][0]["id"] == "example_status"
        assert plugin["result_sections"][0]["fields"] == ["reason", "signal_value", "threshold_distance"]
        assert [widget["id"] for widget in plugin["result_widgets"]] == [
            "example_cards",
            "example_summary",
            "example_trend",
            "example_line_chart",
            "example_custom_chart",
        ]
        assert plugin["result_widgets"][1]["kind"] == "bar_summary"
        assert plugin["result_widgets"][1]["fields"] == ["signal_value", "threshold_distance"]
        assert plugin["result_widgets"][2]["kind"] == "sparkline"
        assert plugin["result_widgets"][3]["kind"] == "line_chart"
        assert plugin["result_widgets"][4]["kind"] == "custom_chart"
        assert plugin["result_widgets"][4]["chart_kind"] == "line_chart"
        assert plugin["result_widgets"][4]["point_limit"] == 40
        assert plugin["result_fields"][1]["label"] == "Example Score"
        assert plugin["result_fields"][1]["decimals"] == 2
        assert plugin["result_fields"][2]["suffix"] == "score units"
        assert options["run_actions"] == ["validate", "replay", "simulated_paper"]
        assert options["guide_schema_version"] == 2
        assert [step["id"] for step in options["guide_steps"]] == [
            "data",
            "quality",
            "range",
            "alignment",
            "draft",
            "run",
            "results",
        ]
        assert options["guide_steps"][0]["label"] == "Choose Data"
        assert options["guide_steps"][0]["order"] == 10
        assert options["guide_steps"][1]["label"] == "Review Data"
        assert "storage-contract metadata" in options["guide_steps"][1]["help"]
        assert [section["id"] for section in options["form_sections"]][:4] == [
            "identity",
            "data",
            "plugin_strategy",
            "account",
        ]
        assert options["form_sections"][0]["label"] == "Setup"
        assert options["form_sections"][0]["order"] == 10
        field_ids = [field["id"] for field in options["form_schema"]]
        assert field_ids[:4] == ["config-name", "config-plugin", "config-mode", "config-dataset"]
        assert "config-plugin-field-no-edge-template-example-parameter" in field_ids
        assert "config-session-enabled" in field_ids
        assert "config-session-outside" in field_ids
        assert "config-risk-preset" in field_ids
        assert "config-allow-quality-warnings" in field_ids
        timezone_field = next(field for field in options["form_schema"] if field["id"] == "config-session-timezone")
        assert timezone_field["kind"] == "select"
        assert timezone_field["options"][0]["value"] == "America/New_York"
        start_field = next(field for field in options["form_schema"] if field["id"] == "config-session-start")
        assert start_field["kind"] == "time"
        assert start_field["step"] == 60
        weekdays_field = next(field for field in options["form_schema"] if field["id"] == "config-session-weekdays")
        assert weekdays_field["kind"] == "select"
        assert weekdays_field["multiple"] is True
        assert [option["value"] for option in weekdays_field["options"]][:2] == ["monday", "tuesday"]
        risk_field = next(field for field in options["form_schema"] if field["id"] == "config-risk-preset")
        assert risk_field["options_source"] == "risk_presets"
        assert [preset["id"] for preset in options["risk_presets"]] == [
            "demo_minimal",
            "costed_demo",
            "larger_replay_demo",
        ]
        assert options["defaults"]["risk_preset"] == "demo_minimal"
        broker_adapters = {adapter["id"]: adapter for adapter in options["broker_adapters"]}
        assert set(broker_adapters) == {"ibkr", "file", "schwab"}
        assert broker_adapters["ibkr"]["requires_gateway"] is True
        assert broker_adapters["ibkr"]["known_paper_ports"] == [4002, 7497]
        assert broker_adapters["file"]["requires_static_prices"] is True
        assert "not a market simulator" in broker_adapters["file"]["boundary"]
        assert broker_adapters["schwab"]["execution_supported"] is False
        assert broker_adapters["schwab"]["account_modes"] == []

        preview_req = request.Request(
            f"{base}/config_draft_preview",
            data=json.dumps({
                "name": "Preview Draft",
                "plugin_id": "no_edge_template",
                "mode": "replay",
                "strategy": {"example_parameter": True},
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
                "starting_cash": 10000,
                "history_bars": 20,
                "risk_preset": "demo_minimal",
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
        with request.urlopen(preview_req, timeout=5) as resp:
            preview_payload = json.loads(resp.read().decode("utf-8"))

        preview = preview_payload["draft"]
        assert preview["name"] == "Preview_Draft"
        assert preview["validation"] == {"valid": True, "errors": []}
        assert preview["saved_path"] is None
        assert "strategy_plugin: examples.strategies.no_edge_template:create_strategy" in preview["yaml"]
        assert not (state_dir / "config_drafts" / "Preview_Draft.yaml").exists()

        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "name": "Test Draft",
                "plugin_id": "no_edge_template",
                "mode": "simulated_paper",
                "strategy": {"example_parameter": False},
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
                "start": "2026-01-02",
                "end": "2026-01-02",
                "starting_cash": 25000,
                "history_bars": 20,
                "session_enabled": True,
                "session_timezone": "America/New_York",
                "session_start": "09:30",
                "session_end": "16:00",
                "session_weekdays": ["monday", "tuesday", "wednesday", "thursday", "friday"],
                "session_outside": "idle",
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
        assert draft["config"]["strategy"] == {"example_parameter": False}
        assert draft["config"]["runner"]["session"] == {
            "timezone": "America/New_York",
            "start": "09:30",
            "end": "16:00",
            "weekdays": ["monday", "tuesday", "wednesday", "thursday", "friday"],
            "outside_session": "idle",
        }
        assert draft["config"]["metadata"]["risk_preset"] == "costed_demo"
        assert draft["config"]["metadata"]["date_range"] == {"start": "2026-01-02", "end": "2026-01-02"}
        assert draft["config"]["data"]["start"] == "2026-01-02"
        assert draft["config"]["data"]["end"] == "2026-01-02"
        assert draft["config"]["data"]["files"] == {"SPY": str(data_file)}
        assert draft["config"]["control"]["pause_marker"] == "paper_logs/control/Test_Draft.pause"
        assert draft["config"]["control"]["stop_marker"] == "paper_logs/control/Test_Draft.stop"
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

        with request.urlopen(f"{base}/config_drafts_export", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="workbench_drafts.csv"'
            csv_body = resp.read().decode("utf-8")
        draft_rows = list(csv.DictReader(io.StringIO(csv_body)))
        assert len(draft_rows) == 1
        assert draft_rows[0]["draft_id"] == "Test_Draft"
        assert draft_rows[0]["folder"] == "config_drafts"
        assert draft_rows[0]["status_label"] == "example_only"
        assert draft_rows[0]["valid"] == "True"
        assert draft_rows[0]["error_count"] == "0"
        assert "SPY" in draft_rows[0]["symbols"]
        assert "simulated_paper" in draft_rows[0]["tags"]

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

        with request.urlopen(f"{base}/config_draft_run_evidence?run_id={replay['run_id']}", timeout=5) as resp:
            evidence = json.loads(resp.read().decode("utf-8"))
        assert evidence["schema_version"] == 1
        assert evidence["run_id"] == replay["run_id"]
        assert evidence["artifacts"]["available"] is True
        assert evidence["artifacts"]["existing_count"] >= 5
        assert evidence["artifacts"]["jsonl_row_count"] >= 4
        assert {item["name"] for item in evidence["artifacts"]["files"]} >= {
            "summary.json",
            "runner_status.json",
            "performance_rollups.json",
            "plugin_contract.json",
            "decisions.jsonl",
        }
        assert evidence["logs"]["stdout"]["line_count"] >= 0
        assert evidence["logs"]["stderr"]["line_count"] >= 0
        assert evidence["evidence_cards"][0]["id"] == "execution"
        assert "diagnostics" not in json.dumps(evidence["artifacts"])

        with request.urlopen(
            f"{base}/config_draft_run_artifacts?run_id={replay['run_id']}&limit=5",
            timeout=5,
        ) as resp:
            run_artifacts = json.loads(resp.read().decode("utf-8"))
        assert run_artifacts["run_id"] == replay["run_id"]
        assert run_artifacts["draft_id"] == "Run_Draft"
        assert run_artifacts["plugin"]["id"] == "no_edge_template"
        assert run_artifacts["plugin"]["matched"] is True
        assert run_artifacts["plugin"]["strategy_fields"][0]["name"] == "example_parameter"
        assert run_artifacts["plugin"]["result_fields"][0]["name"] == "reason"
        assert run_artifacts["plugin"]["result_sections"][0]["id"] == "example_status"
        assert run_artifacts["plugin"]["result_widgets"][0]["id"] == "example_cards"
        assert run_artifacts["plugin_result_summary"]["status"] == "ok"
        assert run_artifacts["plugin_result_summary"]["declared_field_count"] == 3
        assert run_artifacts["plugin_result_summary"]["declared_section_count"] == 1
        assert run_artifacts["plugin_result_summary"]["declared_widget_count"] == 5
        assert run_artifacts["plugin_result_summary"]["emitted_field_count"] == 3
        assert run_artifacts["plugin_result_summary"]["emitted_value_count"] == 6
        assert run_artifacts["plugin_result_summary"]["section_coverage"][0]["id"] == "example_status"
        assert run_artifacts["plugin_result_summary"]["section_coverage"][0]["emitted_field_count"] == 3
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][0]["id"] == "example_cards"
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][0]["emitted_field_count"] == 3
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][1]["kind"] == "bar_summary"
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][1]["field_summaries"][0]["name"] == "signal_value"
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][2]["kind"] == "sparkline"
        assert len(run_artifacts["plugin_result_summary"]["widget_coverage"][2]["field_summaries"][0]["points"]) == 2
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][3]["kind"] == "line_chart"
        assert len(run_artifacts["plugin_result_summary"]["widget_coverage"][3]["field_summaries"][1]["points"]) == 2
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][4]["kind"] == "custom_chart"
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][4]["chart_kind"] == "line_chart"
        assert run_artifacts["plugin_result_summary"]["widget_coverage"][4]["point_limit"] == 40
        assert len(run_artifacts["plugin_result_summary"]["widget_coverage"][4]["field_summaries"][0]["points"]) == 2
        assert run_artifacts["plugin_result_summary"]["field_coverage"][0]["name"] == "reason"
        assert run_artifacts["plugin_result_summary"]["field_coverage"][0]["emitted_count"] == 2
        assert "signal_label" in run_artifacts["plugin_result_summary"]["unlabeled_public_keys"]
        assert run_artifacts["summary"]["mode"] == "replay"
        assert run_artifacts["counts"] == {
            "account": 2,
            "decisions": 2,
            "fills": 0,
            "order_previews": 0,
            "orders": 0,
            "plugin_contract": 1,
            "performance_rollups": 1,
            "runner_status": 1,
        }
        assert run_artifacts["runner_status"]["available"] is True
        assert run_artifacts["runner_status"]["state"] == "completed"
        assert run_artifacts["runner_status"]["counts"]["decisions"] == 2
        assert run_artifacts["runner_status"]["latest_bar_time"] == "2026-01-02T14:35:00+00:00"
        assert run_artifacts["runner_status"]["latest_rejection_time"] is None
        assert run_artifacts["plugin_contract"]["available"] is True
        assert run_artifacts["plugin_contract"]["plugin"]["name"] == "no_edge_template"
        assert run_artifacts["plugin_contract"]["data"]["symbols"] == ["QQQ", "SPY"]
        assert "signal_value" in run_artifacts["plugin_contract"]["observed"]["dashboard_keys"]
        assert run_artifacts["performance_rollups"]["available"] is True
        assert run_artifacts["performance_rollups"]["rollups"][0]["day"] == "2026-01-02"
        assert run_artifacts["performance_rollups"]["period_rollups"]["month"][0]["label"] == "2026-01"
        assert run_artifacts["decisions"][0]["symbols"] == ["QQQ", "SPY"]
        assert "signal" not in run_artifacts["decisions"][0]
        assert "diagnostics" not in run_artifacts["decisions"][0]
        assert run_artifacts["decisions"][0]["drilldown"]["signal_label"] == "Example score"
        assert run_artifacts["decisions"][0]["drilldown"]["reason"] == "example_only_no_signal"
        assert run_artifacts["decisions"][0]["drilldown"]["threshold"] == 1.0
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
        assert exported_artifacts["decisions"][0]["drilldown"]["signal_value"] == 0.0

        with request.urlopen(f"{base}/config_draft_artifacts?draft_id=Run_Draft&limit=5", timeout=5) as resp:
            artifacts = json.loads(resp.read().decode("utf-8"))
        assert artifacts["draft_id"] == "Run_Draft"
        assert artifacts["plugin"]["id"] == "no_edge_template"
        assert artifacts["plugin"]["matched"] is True
        assert artifacts["plugin"]["result_fields"][1]["kind"] == "number"
        assert artifacts["plugin"]["result_sections"][0]["label"] == "Example Status"
        assert artifacts["plugin"]["result_widgets"][1]["label"] == "Example Bar Summary"
        assert artifacts["plugin"]["result_fields"][1]["decimals"] == 2
        assert artifacts["plugin"]["result_fields"][2]["suffix"] == "score units"
        assert artifacts["plugin_result_summary"]["status"] == "ok"
        assert artifacts["plugin_result_summary"]["field_coverage"][1]["decimals"] == 2
        assert artifacts["plugin_result_summary"]["field_coverage"][1]["latest_value"] == 0.0
        assert artifacts["plugin_result_summary"]["field_coverage"][2]["suffix"] == "score units"
        assert artifacts["plugin_result_summary"]["section_coverage"][0]["field_coverage_pct"] == 100.0
        assert artifacts["plugin_result_summary"]["widget_coverage"][1]["field_coverage_pct"] == 100.0
        assert artifacts["plugin_result_summary"]["widget_coverage"][2]["field_summaries"][0]["points"][0]["value"] == 0.0
        assert artifacts["plugin_result_summary"]["widget_coverage"][3]["field_coverage_pct"] == 100.0
        assert artifacts["plugin_result_summary"]["field_coverage"][2]["coverage_pct"] == 100.0
        assert artifacts["summary"]["mode"] == "replay"
        assert artifacts["counts"] == {
            "account": 2,
            "decisions": 2,
            "fills": 0,
            "order_previews": 0,
            "orders": 0,
            "plugin_contract": 1,
            "performance_rollups": 1,
            "runner_status": 1,
        }
        assert artifacts["runner_status"]["available"] is True
        assert artifacts["runner_status"]["state"] == "completed"
        assert artifacts["plugin_contract"]["available"] is True
        assert artifacts["plugin_contract"]["observed"]["decision_count"] == 2
        assert artifacts["performance_rollups"]["available"] is True
        assert artifacts["performance_rollups"]["rollups"][0]["snapshot_count"] == 2
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
        assert artifacts["decisions"][0]["drilldown"]["active_exit_rule"] == "none"
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
        assert comparison["runs"][0]["mode"] == "replay"
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
        assert snapshot["form_schema_version"] == 5
        assert snapshot["guide_schema_version"] == 2
        assert snapshot["diagnostics"]["status"] == "ok"
        assert snapshot["data_catalog"]["count"] == 1
        assert snapshot["data_catalog"]["asset_class_counts"] == {"etf": 1}
        assert snapshot["data_catalog"]["source_counts"] == {"file": 1}
        assert snapshot["data_catalog"]["datasets"][0]["symbol"] == "SPY"
        assert snapshot["config_options"]["risk_presets"]
        assert {adapter["id"] for adapter in snapshot["config_options"]["broker_adapters"]} == {"ibkr", "file", "schwab"}
        assert snapshot["config_options"]["config_schema_version"] == 1
        assert snapshot["config_options"]["form_schema_version"] == 5
        assert snapshot["config_options"]["guide_schema_version"] == 2
        assert snapshot["config_options"]["guide_steps"][0]["id"] == "data"
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


def test_cloud_status_server_serves_order_preview_artifacts(tmp_path):
    state_dir = tmp_path / "state"
    artifact_dir = state_dir / "run_artifacts" / "approval-run"
    artifact_dir.mkdir(parents=True)
    approval_file = artifact_dir / "order_approvals" / "abc123.approved.json"
    (artifact_dir / "summary.json").write_text(
        json.dumps({"mode": "simulated_paper", "approval_required_orders": 1, "final_equity": 10000.0}),
        encoding="utf-8",
    )
    (artifact_dir / "order_previews.jsonl").write_text(
        json.dumps({
            "timestamp": "2026-01-02T15:00:00+00:00",
            "step": 4,
            "mode": "simulated_paper",
            "approval_required": True,
            "approval_status": "required",
            "approval_id": "abc123",
            "approval_digest": "digest-abc123",
            "approval_file": str(approval_file),
            "status": "preview",
            "symbol": "SPY",
            "side": "buy",
            "order_type": "market",
            "quantity": 3,
            "cash_quantity": None,
            "price": 500.25,
            "estimated_notional": 1500.75,
            "cash": 9000.0,
            "equity": 10000.0,
            "positions": {"SPY": 0},
            "metadata": {"private_signal": "hidden"},
            "tag": "approval_test",
        })
        + "\n",
        encoding="utf-8",
    )
    (state_dir / "config_draft_runs.jsonl").write_text(
        json.dumps({
            "run_id": "approval-run",
            "draft_id": "Approval",
            "action": "simulated_paper",
            "status": "completed",
            "returncode": 0,
            "artifact_path": str(artifact_dir),
            "summary": {"mode": "simulated_paper", "approval_required_orders": 1},
        })
        + "\n",
        encoding="utf-8",
    )
    server = create_server("127.0.0.1", 0, state_dir)
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/config_draft_run_artifacts?run_id=approval-run&limit=5", timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))

        assert payload["counts"]["order_previews"] == 1
        assert payload["order_preview_file"].endswith("approval-run/order_previews.jsonl")
        preview = payload["order_previews"][0]
        assert preview["approval_status"] == "required"
        assert preview["approval_id"] == "abc123"
        assert preview["approval_digest"] == "digest-abc123"
        assert preview["approval_file"].endswith("abc123.approved.json")
        assert preview["symbol"] == "SPY"
        assert preview["estimated_notional"] == 1500.75
        assert preview["equity"] == 10000.0
        assert "metadata" not in preview
        assert "positions" not in preview

        approval = post_json(
            base,
            "/order_preview_approval",
            {
                "preview_file": str(artifact_dir / "order_previews.jsonl"),
                "approval_id": "abc123",
                "approver": "test-operator",
            },
        )
        assert approval["ok"] is True
        assert approval["approval"]["approval_id"] == "abc123"
        assert approval["approval"]["symbol"] == "SPY"
        assert approval_file.exists()
        approval_payload = json.loads(approval_file.read_text(encoding="utf-8"))
        assert approval_payload["action"] == "approve"
        assert approval_payload["approval_id"] == "abc123"
        assert approval_payload["approval_digest"] == "digest-abc123"
        assert approval_payload["approver"] == "test-operator"

        with pytest.raises(error.HTTPError) as exc_info:
            post_json(
                base,
                "/order_preview_approval",
                {
                    "preview_file": str(artifact_dir / "order_previews.jsonl"),
                    "approval_id": "abc123",
                },
            )
        assert exc_info.value.code == 400
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_preserves_public_safe_position_accounting():
    row = status_server.summarize_account_artifact({
        "timestamp": "2026-01-02T14:30:00+00:00",
        "cash": 800.0,
        "equity": 1004.0,
        "equity_source": "estimated_from_cash_and_prices",
        "gross_exposure": 204.0,
        "net_exposure": 204.0,
        "gross_exposure_pct": 20.3187,
        "net_exposure_pct": 20.3187,
        "position_count": 1,
        "price_count": 1,
        "priced_position_count": 1,
        "unpriced_position_count": 0,
        "pricing_status": "ok",
        "positions": {"SPY": 2},
        "position_values": {"SPY": 204.0},
        "average_costs": {"SPY": 100.0},
        "unrealized_pnl_by_symbol": {"SPY": 4.0},
        "borrow_fee_accrued_by_symbol": {"SPY": 0.12},
        "position_details": {
            "SPY": {
                "entry_time": "2026-01-02T14:35:00+00:00",
                "entry_price": 100.5,
                "current_price": 102.0,
                "expected_hold_minutes": 390,
                "hold_until": "2026-01-02T21:00:00+00:00",
                "active_exit_rule": "session_close",
                "exit_state": "holding",
                "stop_price": 98.0,
                "target_price": 106.0,
                "mae_pct": -0.01,
                "mfe_pct": 0.03,
                "private_signal": "hidden",
            },
            "BAD": "not-a-map",
        },
        "diagnostics": {"private": "hidden"},
    })

    assert row["positions"] == {"SPY": 2}
    assert row["equity_source"] == "estimated_from_cash_and_prices"
    assert row["gross_exposure_pct"] == 20.3187
    assert row["position_count"] == 1
    assert row["price_count"] == 1
    assert row["priced_position_count"] == 1
    assert row["unpriced_position_count"] == 0
    assert row["pricing_status"] == "ok"
    assert row["position_values"] == {"SPY": 204.0}
    assert row["average_costs"] == {"SPY": 100.0}
    assert row["unrealized_pnl_by_symbol"] == {"SPY": 4.0}
    assert row["borrow_fee_accrued_by_symbol"] == {"SPY": 0.12}
    assert row["position_details"]["SPY"]["entry_time"] == "2026-01-02T14:35:00+00:00"
    assert row["position_details"]["SPY"]["entry_price"] == 100.5
    assert row["position_details"]["SPY"]["current_price"] == 102.0
    assert row["position_details"]["SPY"]["expected_hold_minutes"] == 390
    assert row["position_details"]["SPY"]["hold_until"] == "2026-01-02T21:00:00+00:00"
    assert row["position_details"]["SPY"]["active_exit_rule"] == "session_close"
    assert row["position_details"]["SPY"]["exit_state"] == "holding"
    assert row["position_details"]["SPY"]["stop_price"] == 98.0
    assert row["position_details"]["SPY"]["target_price"] == 106.0
    assert row["position_details"]["SPY"]["mae_pct"] == -0.01
    assert row["position_details"]["SPY"]["mfe_pct"] == 0.03
    assert "private_signal" not in row["position_details"]["SPY"]
    assert "BAD" not in row["position_details"]
    assert "diagnostics" not in row


def test_cloud_status_server_accepts_position_metadata_alias():
    row = status_server.summarize_account_artifact({
        "timestamp": "2026-01-02T14:30:00+00:00",
        "positions": {"QQQ": 1},
        "position_metadata": {
            "QQQ": {
                "entry_time": "2026-01-02T14:31:00+00:00",
                "active_exit_rule": "trailing_stop",
                "raw_state": {"private": True},
            },
        },
    })

    assert row["position_details"] == {
        "QQQ": {
            "entry_time": "2026-01-02T14:31:00+00:00",
            "active_exit_rule": "trailing_stop",
        },
    }


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
        assert "workbench drafts can only run configured Workbench plugins" in payload["error"]

        with request.urlopen(f"{base}/config_draft_detail?draft_id=Bad", timeout=5) as resp:
            detail = json.loads(resp.read().decode("utf-8"))
        assert detail["validation"]["valid"] is False
        assert "workbench drafts can only run configured Workbench plugins" in detail["validation"]["errors"]
        assert detail["yaml"] == ""
        assert detail["commands"] == {}

        with request.urlopen(f"{base}/config_draft_validations", timeout=5) as resp:
            validations = json.loads(resp.read().decode("utf-8"))
        assert validations["count"] == 1
        assert validations["valid_count"] == 0
        assert validations["invalid_count"] == 1
        assert validations["validations"][0]["draft_id"] == "Bad"
        assert validations["validations"][0]["valid"] is False
        assert "workbench drafts can only run configured Workbench plugins" in validations["validations"][0]["errors"]
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


def test_cloud_status_server_loads_local_plugin_registry_for_workbench(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "SPY.csv"
    data_file.write_text("timestamp,close\n2026-01-02T14:30:00Z,100\n", encoding="utf-8")
    registry = tmp_path / "plugin_registry.yaml"
    registry.write_text(
        "\n".join(
            [
                "plugins:",
                "  - id: local_demo",
                "    label: Local demo",
                "    spec: examples.strategies.no_edge_template:create_strategy",
                "    status: private_local",
                "    visibility: private_local",
                "    description: Local metadata only; strategy logic stays outside public configs.",
                "    boundary: Loaded from an ignored local registry.",
                "    strategy_fields:",
                "      - name: local_flag",
                "        label: Local Flag",
                "        kind: checkbox",
                "        default: false",
                "        description: Public-safe display metadata for the local flag.",
                "        help: Toggle only demonstrates Workbench rendering.",
                "        advanced: true",
                "    result_fields:",
                "      - name: local_score",
                "        label: Local Score",
                "        kind: number",
                "        decimals: 2",
                "      - name: local_reason",
                "        label: Local Reason",
                "        kind: text",
                "    result_sections:",
                "      - id: local_status",
                "        label: Local Status",
                "        description: Groups public-safe local diagnostics.",
                "        fields:",
                "          - local_score",
                "          - local_reason",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        data_roots=[data_root],
        plugin_registry_paths=[registry],
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/config_options", timeout=5) as resp:
            options = json.loads(resp.read().decode("utf-8"))

        plugins = {plugin["id"]: plugin for plugin in options["plugins"]}
        assert set(plugins) == {"no_edge_template", "local_demo"}
        assert plugins["local_demo"]["visibility"] == "private_local"
        assert plugins["local_demo"]["status"] == "private_local"
        assert plugins["local_demo"]["source"] == "local_registry"
        assert plugins["local_demo"]["source_path"] == str(registry.resolve())
        assert plugins["local_demo"]["strategy_fields"][0]["name"] == "local_flag"
        assert plugins["local_demo"]["strategy_fields"][0]["description"] == "Public-safe display metadata for the local flag."
        assert plugins["local_demo"]["strategy_fields"][0]["advanced"] is True
        assert plugins["local_demo"]["result_sections"][0]["id"] == "local_status"
        assert plugins["local_demo"]["result_sections"][0]["fields"] == ["local_score", "local_reason"]
        assert str(registry.resolve()) in options["plugin_registry_paths"]

        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "name": "Local Plugin Draft",
                "plugin_id": "local_demo",
                "mode": "replay",
                "strategy": {"local_flag": True},
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
                "history_bars": 1,
                "max_steps": 1,
                "max_orders_per_run": 1,
                "max_notional_per_order": 100,
                "max_quantity": 10,
                "max_cash_quantity": 100,
                "max_gross_exposure_pct": 0.05,
                "allow_quality_warnings": True,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(draft_req, timeout=5) as resp:
            draft_payload = json.loads(resp.read().decode("utf-8"))

        draft = draft_payload["draft"]
        assert draft["plugin"]["id"] == "local_demo"
        assert draft["validation"]["valid"] is True
        assert draft["config"]["strategy"] == {"local_flag": True}
        assert draft["config"]["metadata"]["status"] == "private_local"
        assert draft["config"]["metadata"]["strategy_plugin"] == "examples.strategies.no_edge_template:create_strategy"
        assert "Loaded from an ignored local registry." in draft["config"]["notes"]
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_validates_plugin_strategy_fields(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "SPY.csv"
    data_file.write_text("timestamp,close\n2026-01-02T14:30:00Z,100\n", encoding="utf-8")
    state_dir = tmp_path / "state"
    registry = tmp_path / "plugin_registry.yaml"
    registry.write_text(
        "\n".join(
            [
                "plugins:",
                "  - id: bounded_demo",
                "    label: Bounded demo",
                "    spec: examples.strategies.no_edge_template:create_strategy",
                "    status: private_local",
                "    visibility: private_local",
                "    strategy_fields:",
                "      - name: threshold",
                "        label: Threshold",
                "        kind: number",
                "        required: true",
                "        min: 0.1",
                "        max: 1.0",
                "        step: 0.05",
                "        description: Public-safe threshold display text.",
                "        placeholder: '0.50'",
                "        unit: score",
                "        prefix: '>='",
                "        suffix: normalized",
                "        advanced: true",
                "        order: 10",
                "      - name: mode",
                "        label: Mode",
                "        kind: select",
                "        required: true",
                "        order: 20",
                "        options:",
                "          - value: conservative",
                "            label: Conservative",
                "            description: Lower example activity.",
                "          - value: active",
                "            label: Active",
                "            description: Higher example activity.",
                "    validation_rules:",
                "      - id: threshold_floor",
                "        type: comparison",
                "        label: Threshold Floor",
                "        field: threshold",
                "        operator: '>='",
                "        value: 0.25",
                "        help: Public-safe declarative threshold guard.",
                "        error: strategy.threshold must be >= declarative floor 0.25",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    server = create_server(
        "127.0.0.1",
        0,
        state_dir,
        data_roots=[data_root],
        plugin_registry_paths=[registry],
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/config_options", timeout=5) as resp:
            options = json.loads(resp.read().decode("utf-8"))
        fields = {
            field["name"]: field
            for field in options["form_schema"]
            if field.get("plugin_id") == "bounded_demo"
        }
        assert options["form_schema_version"] == 5
        assert fields["threshold"]["description"] == "Public-safe threshold display text."
        assert fields["threshold"]["placeholder"] == "0.50"
        assert fields["threshold"]["unit"] == "score"
        assert fields["threshold"]["prefix"] == ">="
        assert fields["threshold"]["suffix"] == "normalized"
        assert fields["threshold"]["advanced"] is True
        assert fields["mode"]["options"][0]["description"] == "Lower example activity."
        plugins = {plugin["id"]: plugin for plugin in options["plugins"]}
        assert plugins["bounded_demo"]["validation_rules"][0]["id"] == "threshold_floor"
        assert plugins["bounded_demo"]["validation_rules"][0]["operator"] == ">="

        def post_draft(strategy: dict, *, name: str = "Bounded Draft", save: bool = False):
            return request.Request(
                f"{base}/config_draft",
                data=json.dumps({
                    "name": name,
                    "plugin_id": "bounded_demo",
                    "mode": "replay",
                    "strategy": strategy,
                    "datasets": [{"symbol": "SPY", "path": str(data_file)}],
                    "history_bars": 1,
                    "max_steps": 1,
                    "max_orders_per_run": 1,
                    "max_notional_per_order": 100,
                    "max_quantity": 10,
                    "max_cash_quantity": 100,
                    "max_gross_exposure_pct": 0.05,
                    "allow_quality_warnings": True,
                    "save": save,
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )

        try:
            request.urlopen(post_draft({"threshold": 2.0, "mode": "active"}), timeout=5)
            raise AssertionError("expected threshold validation response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "strategy.threshold must be <= 1.0"

        try:
            request.urlopen(post_draft({"threshold": 0.2, "mode": "active"}), timeout=5)
            raise AssertionError("expected declarative validation rule response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "strategy.threshold must be >= declarative floor 0.25"

        try:
            request.urlopen(post_draft({"threshold": 0.5, "mode": "active", "secret": "x"}), timeout=5)
            raise AssertionError("expected unsupported strategy field response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "strategy contains unsupported field(s): secret"

        with request.urlopen(
            post_draft({"threshold": 0.75, "mode": "active"}, name="Saved Bounded Draft", save=True),
            timeout=5,
        ) as resp:
            draft_payload = json.loads(resp.read().decode("utf-8"))

        draft_path = Path(draft_payload["draft"]["saved_path"])
        assert draft_payload["draft"]["config"]["strategy"] == {"mode": "active", "threshold": 0.75}
        draft_path.write_text(
            draft_path.read_text(encoding="utf-8").replace("threshold: 0.75", "threshold: 2.0"),
            encoding="utf-8",
        )
        with request.urlopen(f"{base}/config_draft_validations", timeout=5) as resp:
            validations = json.loads(resp.read().decode("utf-8"))
        saved = next(item for item in validations["validations"] if item["draft_id"] == "Saved_Bounded_Draft")
        assert saved["valid"] is False
        assert "strategy.threshold must be <= 1.0" in saved["errors"]
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_validates_declarative_plugin_rules(tmp_path):
    registry = tmp_path / "plugin_registry.yaml"
    registry.write_text(
        "\n".join(
            [
                "plugins:",
                "  - id: rule_demo",
                "    label: Rule demo",
                "    spec: examples.strategies.no_edge_template:create_strategy",
                "    strategy_fields:",
                "      - name: symbol",
                "        kind: text",
                "      - name: fallback_symbol",
                "        kind: text",
                "      - name: stop",
                "        kind: number",
                "        default: 99",
                "      - name: target",
                "        kind: number",
                "        default: 101",
                "    validation_rules:",
                "      - id: symbol_required",
                "        type: required",
                "        field: symbol",
                "        error: strategy.symbol must be set",
                "      - id: any_symbol",
                "        type: require_any",
                "        fields: [symbol, fallback_symbol]",
                "        error: at least one symbol field must be set",
                "      - id: target_above_stop",
                "        type: comparison",
                "        field: target",
                "        operator: '>'",
                "        other_field: stop",
                "        error: strategy.target must be greater than strategy.stop",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    plugin = next(item for item in status_server.load_config_builder_plugins([registry]) if item["id"] == "rule_demo")

    assert [rule["id"] for rule in plugin["validation_rules"]] == [
        "symbol_required",
        "any_symbol",
        "target_above_stop",
    ]
    assert status_server.validate_plugin_strategy_config(
        {"symbol": "", "fallback_symbol": "", "stop": 99, "target": 101},
        plugin,
    ) == [
        "strategy.symbol must be set",
        "at least one symbol field must be set",
    ]
    assert status_server.validate_plugin_strategy_config(
        {"symbol": "SPY", "fallback_symbol": "", "stop": 101, "target": 100},
        plugin,
    ) == ["strategy.target must be greater than strategy.stop"]
    assert status_server.validate_plugin_strategy_config(
        {"symbol": "SPY", "fallback_symbol": "", "stop": 99, "target": 101},
        plugin,
    ) == []


def test_cloud_status_server_validates_plugin_result_sections(tmp_path):
    registry = tmp_path / "plugin_registry.yaml"
    registry.write_text(
        "\n".join(
            [
                "plugins:",
                "  - id: section_demo",
                "    label: Section demo",
                "    spec: examples.strategies.no_edge_template:create_strategy",
                "    result_fields:",
                "      - name: public_score",
                "        label: Public Score",
                "        kind: number",
                "    result_sections:",
                "      - id: invalid_section",
                "        label: Invalid Section",
                "        fields:",
                "          - public_score",
                "          - private_missing",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="references undeclared result field private_missing"):
        status_server.load_config_builder_plugins([registry])


def test_cloud_status_server_validates_plugin_result_widgets(tmp_path):
    registry = tmp_path / "plugin_registry.yaml"
    registry.write_text(
        "\n".join(
            [
                "plugins:",
                "  - id: widget_demo",
                "    label: Widget demo",
                "    spec: examples.strategies.no_edge_template:create_strategy",
                "    result_fields:",
                "      - name: public_score",
                "        label: Public Score",
                "        kind: number",
                "    result_widgets:",
                "      - id: invalid_widget",
                "        label: Invalid Widget",
                "        kind: table",
                "        fields:",
                "          - public_score",
                "          - private_missing",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    with pytest.raises(ValueError, match="references undeclared result field private_missing"):
        status_server.load_config_builder_plugins([registry])


def test_cloud_status_server_validates_declarative_custom_chart_widgets(tmp_path):
    registry = tmp_path / "plugin_registry.yaml"
    registry.write_text(
        "\n".join(
            [
                "plugins:",
                "  - id: custom_chart_demo",
                "    label: Custom chart demo",
                "    spec: examples.strategies.no_edge_template:create_strategy",
                "    result_fields:",
                "      - name: public_score",
                "        label: Public Score",
                "        kind: number",
                "      - name: public_threshold",
                "        label: Public Threshold",
                "        kind: number",
                "    result_widgets:",
                "      - id: score_chart",
                "        label: Score Chart",
                "        kind: custom_chart",
                "        chart_kind: line_chart",
                "        point_limit: 24",
                "        fields:",
                "          - public_score",
                "          - public_threshold",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    plugin = next(
        plugin
        for plugin in status_server.load_config_builder_plugins([registry])
        if plugin["id"] == "custom_chart_demo"
    )
    widget = plugin["result_widgets"][0]
    assert widget["kind"] == "custom_chart"
    assert widget["chart_kind"] == "line_chart"
    assert widget["point_limit"] == 24

    registry.write_text(
        "\n".join(
            [
                "plugins:",
                "  - id: bad_custom_chart_demo",
                "    label: Bad custom chart demo",
                "    spec: examples.strategies.no_edge_template:create_strategy",
                "    result_fields:",
                "      - name: public_score",
                "        label: Public Score",
                "        kind: number",
                "    result_widgets:",
                "      - id: score_chart",
                "        label: Score Chart",
                "        kind: custom_chart",
                "        chart_kind: javascript",
                "        fields:",
                "          - public_score",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    with pytest.raises(ValueError, match="chart_kind must be one of"):
        status_server.load_config_builder_plugins([registry])


def test_cloud_status_server_config_draft_rejects_plugin_authored_validation(tmp_path):
    data_root = tmp_path / "data"
    data_root.mkdir()
    data_file = data_root / "SPY.csv"
    data_file.write_text("timestamp,close\n2026-01-02T14:30:00Z,100\n", encoding="utf-8")
    registry = tmp_path / "plugin_registry.yaml"
    registry.write_text(
        "\n".join(
            [
                "plugins:",
                "  - id: validated_demo",
                "    label: Validated demo",
                "    spec: tests.fixtures.validated_plugin:create_strategy",
                "    status: private_local",
                "    visibility: private_local",
                "    strategy_fields:",
                "      - name: symbol",
                "        label: Symbol",
                "        kind: text",
                "        default: ''",
                "      - name: threshold",
                "        label: Threshold",
                "        kind: number",
                "        default: 1.0",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    state_dir = tmp_path / "state"
    server = create_server(
        "127.0.0.1",
        0,
        state_dir,
        data_roots=[data_root],
        plugin_registry_paths=[registry],
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "name": "Invalid Plugin Hook Draft",
                "plugin_id": "validated_demo",
                "mode": "replay",
                "strategy": {"symbol": "", "threshold": 1.5},
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
                "history_bars": 1,
                "max_steps": 1,
                "max_orders_per_run": 1,
                "max_notional_per_order": 100,
                "max_quantity": 10,
                "max_cash_quantity": 100,
                "max_gross_exposure_pct": 0.05,
                "allow_quality_warnings": True,
                "save": True,
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(draft_req, timeout=5)
            raise AssertionError("expected plugin validator response")
        except error.HTTPError as exc:
            assert exc.code == 400
            payload = json.loads(exc.read().decode("utf-8"))
        assert "metadata.strategy_plugin config: strategy.symbol must be a non-empty string" in payload["error"]
        assert not (state_dir / "config_drafts" / "Invalid_Plugin_Hook_Draft.yaml").exists()
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

        with request.urlopen(f"{base}/command_audit?node_id=test-node", timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))
        assert [event["event"] for event in audit["events"]] == [
            "command_queued",
            "command_pending_returned",
            "result_received",
        ]
        assert audit["events"][0]["param_keys"] == []
        assert audit["events"][1]["param_keys"] == []
        assert audit["integrity"]["status"] == "ok"
        assert audit["integrity"]["checked_records"] == 3
        assert audit["integrity"]["signature_status"] == "disabled"
        assert audit["retention_policy"]["status"] == "local_hash_chain"
        assert audit["retention_policy"]["off_host_retention_verified"] is False
        assert audit["retention_policy"]["off_host_sync_helper"] == "ops/cloud/sync-command-audit.example.sh"
        assert audit["events"][0]["record_hash"]
        assert audit["events"][1]["prev_hash"] == audit["events"][0]["record_hash"]
        assert audit["events"][2]["prev_hash"] == audit["events"][1]["record_hash"]
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_detects_command_audit_tampering(tmp_path):
    state_dir = tmp_path / "state"
    status_server.append_command_audit(
        state_dir,
        {"event": "command_queued", "node_id": "test-node", "command_id": "cmd-1", "action": "request_status"},
    )
    status_server.append_command_audit(
        state_dir,
        {"event": "result_received", "node_id": "test-node", "command_id": "cmd-1", "action": "request_status"},
    )

    clean = status_server.verify_command_audit(state_dir)
    assert clean["status"] == "ok"
    assert clean["checked_records"] == 2

    path = status_server.command_audit_path(state_dir)
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    rows[0]["action"] = "pause_runner"
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")

    tampered = status_server.verify_command_audit(state_dir)
    assert tampered["status"] == "bad"
    assert any(error["error"] == "record_hash mismatch" for error in tampered["errors"])


def test_cloud_status_server_signs_and_verifies_command_audit(tmp_path, monkeypatch):
    state_dir = tmp_path / "state"
    monkeypatch.setenv("AUDIT_HMAC_KEY", "test-secret")

    status_server.append_command_audit(
        state_dir,
        {"event": "command_queued", "node_id": "test-node", "command_id": "cmd-1", "action": "request_status"},
        signature_env="AUDIT_HMAC_KEY",
    )
    clean = status_server.verify_command_audit(state_dir, signature_env="AUDIT_HMAC_KEY")
    assert clean["status"] == "ok"
    assert clean["signature_status"] == "ok"
    assert clean["signed_records"] == 1
    assert clean["unsigned_records"] == 0

    path = status_server.command_audit_path(state_dir)
    rows = [json.loads(line) for line in path.read_text(encoding="utf-8").splitlines()]
    assert rows[0]["signature_algorithm"] == "hmac-sha256"
    assert rows[0]["signature_key_env"] == "AUDIT_HMAC_KEY"
    assert rows[0]["row_signature"]

    rows[0]["row_signature"] = "0" * 64
    path.write_text("".join(json.dumps(row, sort_keys=True) + "\n" for row in rows), encoding="utf-8")
    tampered = status_server.verify_command_audit(state_dir, signature_env="AUDIT_HMAC_KEY")
    assert tampered["status"] == "bad"
    assert tampered["signature_status"] == "bad"
    assert any(error["error"] == "row_signature mismatch" for error in tampered["errors"])

    monkeypatch.delenv("AUDIT_HMAC_KEY")
    missing_key = status_server.verify_command_audit(state_dir, signature_env="AUDIT_HMAC_KEY")
    assert missing_key["signature_status"] == "missing_key"


def test_cloud_status_server_command_audit_endpoint_reports_signed_rows(tmp_path, monkeypatch):
    monkeypatch.setenv("AUDIT_HMAC_KEY", "test-secret")
    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        command_audit_signature_env="AUDIT_HMAC_KEY",
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        command_req = request.Request(
            f"{base}/commands",
            data=json.dumps({"node_id": "test-node", "action": "request_status"}).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(command_req, timeout=5) as resp:
            assert json.loads(resp.read().decode("utf-8"))["ok"] is True

        with request.urlopen(f"{base}/command_audit?node_id=test-node", timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))
        assert audit["integrity"]["status"] == "ok"
        assert audit["integrity"]["signature_status"] == "ok"
        assert audit["integrity"]["signed_records"] == 1
        assert audit["retention_policy"]["status"] == "signed_local"
        assert audit["retention_policy"]["signature_configured"] is True
        assert audit["retention_policy"]["off_host_status"] == "not_verified"
        assert "aws-s3-command-audit-retention.example.tf" in " ".join(audit["retention_policy"]["provider_retention_examples"])
        assert audit["events"][0]["row_signature"]

        with request.urlopen(f"{base}/command_audit_export?node_id=test-node&limit=10", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("text/csv")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="command_audit.csv"'
            csv_body = resp.read().decode("utf-8")
        rows = list(csv.DictReader(io.StringIO(csv_body)))
        assert rows[0]["event"] == "command_queued"
        assert rows[0]["node_id"] == "test-node"
        assert rows[0]["integrity_status"] == "ok"
        assert rows[0]["signature_status"] == "ok"
        assert rows[0]["signed_records"] == "1"
        assert rows[0]["retention_status"] == "signed_local"
        assert rows[0]["off_host_retention_verified"] == "False"
        assert rows[0]["off_host_sync_helper"] == "ops/cloud/sync-command-audit.example.sh"
        assert rows[0]["row_signature"]
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_rate_limits_command_queue(tmp_path):
    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        command_rate_limit={"enabled": True, "window_seconds": 60, "max_per_node": 1},
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        for expected_code in (200, 429):
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
            if expected_code == 200:
                with request.urlopen(command_req, timeout=5) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                assert payload["ok"] is True
            else:
                try:
                    request.urlopen(command_req, timeout=5)
                    raise AssertionError("expected rate-limit response")
                except error.HTTPError as exc:
                    assert exc.code == 429
                    payload = json.loads(exc.read().decode("utf-8"))
                assert "rate limit exceeded" in payload["error"]

        with request.urlopen(f"{base}/commands?node_id=test-node", timeout=5) as resp:
            pending = json.loads(resp.read().decode("utf-8"))
        assert len(pending["commands"]) == 1

        with request.urlopen(f"{base}/command_audit?node_id=test-node", timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))
        assert [event["event"] for event in audit["events"]] == [
            "command_queued",
            "queue_rejected",
            "command_pending_returned",
        ]
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_rejects_commands_outside_server_scope(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        command_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "run_supervisor_once",
                "params": {"supervisor_id": "example"},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(command_req, timeout=5)
            raise AssertionError("expected scope rejection")
        except error.HTTPError as exc:
            assert exc.code == 403
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "command action is outside server scope: run_supervisor_once (launcher)"

        with request.urlopen(f"{base}/commands?node_id=test-node", timeout=5) as resp:
            pending = json.loads(resp.read().decode("utf-8"))
        assert pending["commands"] == []

        with request.urlopen(f"{base}/command_audit?node_id=test-node", timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))
        assert audit["events"][0]["event"] == "queue_rejected"
        assert audit["events"][0]["action_class"] == "launcher"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_rejects_reserved_high_risk_commands(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        command_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "enable_live_orders",
                "params": {},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        try:
            request.urlopen(command_req, timeout=5)
            raise AssertionError("expected reserved high-risk rejection")
        except error.HTTPError as exc:
            assert exc.code == 403
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"].startswith("reserved high-risk command is not supported: enable_live_orders")

        with request.urlopen(f"{base}/commands?node_id=test-node", timeout=5) as resp:
            pending = json.loads(resp.read().decode("utf-8"))
        assert pending["commands"] == []

        with request.urlopen(f"{base}/command_audit?node_id=test-node", timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))
        assert audit["events"][0]["event"] == "queue_rejected"
        assert audit["events"][0]["action_class"] == "high_risk"
        assert audit["events"][0]["action"] == "enable_live_orders"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_allows_explicit_launcher_scope(tmp_path):
    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        command_scopes={"enabled": True, "allowed_action_classes": ["read_only", "control", "launcher"]},
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        command_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "run_supervisor_once",
                "params": {"supervisor_id": "example"},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json"},
            method="POST",
        )
        with request.urlopen(command_req, timeout=5) as resp:
            payload = json.loads(resp.read().decode("utf-8"))
        assert payload["command"]["action_class"] == "launcher"
        assert payload["command"]["status"] == "pending"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_rejects_duplicate_command_id(tmp_path):
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        for expected_code in (200, 400):
            command_req = request.Request(
                f"{base}/commands",
                data=json.dumps({
                    "command_id": "duplicate-id",
                    "node_id": "test-node",
                    "action": "request_status",
                    "params": {},
                }).encode("utf-8"),
                headers={"Content-Type": "application/json"},
                method="POST",
            )
            if expected_code == 200:
                with request.urlopen(command_req, timeout=5) as resp:
                    payload = json.loads(resp.read().decode("utf-8"))
                assert payload["command"]["command_id"] == "duplicate-id"
            else:
                try:
                    request.urlopen(command_req, timeout=5)
                    raise AssertionError("expected duplicate command response")
                except error.HTTPError as exc:
                    assert exc.code == 400
                    payload = json.loads(exc.read().decode("utf-8"))
                assert payload["error"] == "command_id already exists: duplicate-id"

        with request.urlopen(f"{base}/command_audit?node_id=test-node", timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))
        assert [event["event"] for event in audit["events"]] == ["command_queued", "queue_rejected"]
        assert audit["events"][1]["command_id"] == "duplicate-id"
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


def test_cloud_status_server_enforces_network_allowlist(tmp_path):
    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        network_access={"enabled": True, "allowed_client_networks": ["127.0.0.1/32"]},
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        with request.urlopen(f"{base}/status", timeout=5) as resp:
            assert resp.status == 200
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_enforces_trusted_forwarded_network_allowlist(tmp_path):
    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        network_access={
            "enabled": True,
            "allowed_client_networks": ["203.0.113.0/24"],
            "trust_x_forwarded_for": True,
        },
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        allowed_req = request.Request(f"{base}/status", headers={"X-Forwarded-For": "203.0.113.10"})
        with request.urlopen(allowed_req, timeout=5) as resp:
            assert resp.status == 200

        blocked_req = request.Request(f"{base}/status", headers={"X-Forwarded-For": "198.51.100.10"})
        try:
            request.urlopen(blocked_req, timeout=5)
            raise AssertionError("expected network allowlist rejection")
        except error.HTTPError as exc:
            assert exc.code == 403
            payload = json.loads(exc.read().decode("utf-8"))
        assert payload["error"] == "client IP is not allowed: 198.51.100.10"
    finally:
        server.shutdown()
        server.server_close()


def test_cloud_status_server_applies_per_token_command_scopes(tmp_path, monkeypatch):
    monkeypatch.setenv("READ_TOKEN", "read-secret")
    monkeypatch.setenv("CONTROL_TOKEN", "control-secret")
    server = create_server(
        "127.0.0.1",
        0,
        tmp_path / "state",
        auth_tokens=[
            {"token_env": "READ_TOKEN", "role": "monitor", "allowed_action_classes": ["read_only"]},
            {"token_env": "CONTROL_TOKEN", "role": "operator", "allowed_action_classes": ["read_only", "control"]},
        ],
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"

        read_status_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "request_status",
                "params": {},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer read-secret"},
            method="POST",
        )
        with request.urlopen(read_status_req, timeout=5) as resp:
            read_payload = json.loads(resp.read().decode("utf-8"))
        assert read_payload["command"]["action_class"] == "read_only"

        read_control_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "pause_runner",
                "params": {},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer read-secret"},
            method="POST",
        )
        try:
            request.urlopen(read_control_req, timeout=5)
            raise AssertionError("expected token-scope rejection")
        except error.HTTPError as exc:
            assert exc.code == 403
            rejected = json.loads(exc.read().decode("utf-8"))
        assert rejected["error"] == "command action is outside server scope: pause_runner (control)"

        control_req = request.Request(
            f"{base}/commands",
            data=json.dumps({
                "node_id": "test-node",
                "action": "pause_runner",
                "params": {},
            }).encode("utf-8"),
            headers={"Content-Type": "application/json", "Authorization": "Bearer control-secret"},
            method="POST",
        )
        with request.urlopen(control_req, timeout=5) as resp:
            control_payload = json.loads(resp.read().decode("utf-8"))
        assert control_payload["command"]["action_class"] == "control"

        audit_req = request.Request(
            f"{base}/command_audit?node_id=test-node",
            headers={"Authorization": "Bearer control-secret"},
        )
        with request.urlopen(audit_req, timeout=5) as resp:
            audit = json.loads(resp.read().decode("utf-8"))
        assert [event.get("auth_role") for event in audit["events"]] == ["monitor", "monitor", "operator"]
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


def test_command_worker_rejects_reserved_high_risk_actions_even_if_allowlisted(tmp_path):
    config = {
        "node_id": "test-node",
        "allowed_actions": ["enable_live_orders"],
    }
    rejected = execute_command({"command_id": "cmd-live", "action": "enable_live_orders", "params": {}}, config)
    assert rejected["status"] == "rejected"
    assert rejected["action_class"] == "high_risk"
    assert rejected["error"].startswith("reserved high-risk action is not supported: enable_live_orders")


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


def test_command_worker_requests_configured_child_restart_marker(tmp_path):
    marker = tmp_path / "ran.txt"
    restart_marker = tmp_path / "control" / "runner.restart"
    state_file = tmp_path / "supervisor" / "status.json"
    supervisor_config = tmp_path / "supervisor.yaml"
    write_supervisor_config(
        supervisor_config,
        marker=marker,
        state_file=state_file,
        log_dir=tmp_path / "supervisor" / "jobs",
        process_mode="managed",
        restart_marker=restart_marker,
    )
    config = {
        "node_id": "test-node",
        "allowed_actions": ["restart_child_process"],
        "supervisors": {"example": str(supervisor_config)},
    }

    result = execute_command(
        {
            "command_id": "cmd-1",
            "action": "restart_child_process",
            "params": {"supervisor_id": "example", "job_id": "example"},
        },
        config,
    )

    assert result["status"] == "completed"
    assert result["action_class"] == "launcher"
    assert result["result"]["restart_marker"] == str(restart_marker)
    assert result["result"]["restart_requested"] is True
    assert "command_id=cmd-1" in restart_marker.read_text()


def test_command_worker_flattens_file_broker_positions(tmp_path):
    bars_path = tmp_path / "SPY.csv"
    state_path = tmp_path / "broker" / "state.json"
    orders_path = tmp_path / "broker" / "orders.jsonl"
    runner_config = tmp_path / "plugin_runner.yaml"
    write_sample_bars(bars_path)
    state_path.parent.mkdir()
    state_path.write_text(json.dumps({
        "account_id": "file-paper",
        "cash": 9000.0,
        "positions": {"SPY": 2.0},
        "prices": {"SPY": 101.0},
    }))
    write_runner_config(runner_config, bars_path=bars_path, state_path=state_path, orders_path=orders_path)
    config = {
        "node_id": "test-node",
        "allowed_actions": ["flatten_simulated_positions"],
        "configs": {"example": str(runner_config)},
    }

    result = execute_command(
        {
            "command_id": "cmd-1",
            "action": "flatten_simulated_positions",
            "params": {"config_id": "example"},
        },
        config,
    )

    updated_state = json.loads(state_path.read_text())
    order_rows = [json.loads(line) for line in orders_path.read_text().splitlines()]
    assert result["status"] == "completed"
    assert result["action_class"] == "control"
    assert result["result"]["positions_before"] == {"SPY": 2.0}
    assert result["result"]["positions_after"] == {}
    assert result["result"]["cash_after"] == pytest.approx(9202.0)
    assert updated_state["positions"] == {}
    assert order_rows[-1]["side"] == "sell"
    assert order_rows[-1]["tag"] == "remote_flatten_simulated_positions:cmd-1"


def test_command_worker_requires_local_enable_marker_for_gated_actions(tmp_path):
    marker = tmp_path / "ran.txt"
    enable_marker = tmp_path / "control" / "remote_commands.enabled"
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
        "allowed_actions": ["run_supervisor_once"],
        "supervisors": {"example": str(supervisor_config)},
        "safety": {
            "require_local_enable_marker": True,
            "local_enable_marker": str(enable_marker),
            "actions_requiring_local_enable": ["run_supervisor_once"],
        },
    }
    command = {"command_id": "cmd-1", "action": "run_supervisor_once", "params": {"supervisor_id": "example"}}

    rejected = execute_command(command, config)
    assert rejected["status"] == "rejected"
    assert "local enable marker is required" in rejected["error"]
    assert rejected["action_class"] == "launcher"
    assert not marker.exists()

    enable_marker.parent.mkdir()
    enable_marker.write_text("enabled for local test\n")
    completed = execute_command(command, config)
    assert completed["status"] == "completed"
    assert marker.read_text() == "ran\n"


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
        assert audit_rows[0]["prev_hash"] == ""
        assert audit_rows[0]["record_hash"] == audit_record_hash(audit_rows[0])
        with request.urlopen(f"{base}/commands?node_id=test-node", timeout=5) as resp:
            pending = json.loads(resp.read().decode("utf-8"))
        assert pending["commands"] == []
    finally:
        server.shutdown()
        server.server_close()


def test_command_worker_poll_once_rejects_commands_over_local_limit(tmp_path):
    run_dir = tmp_path / "run"
    audit_log = tmp_path / "audit.jsonl"
    write_run(run_dir)
    server = create_server("127.0.0.1", 0, tmp_path / "state")
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base = f"http://127.0.0.1:{server.server_address[1]}"
        for command_id in ("cmd-1", "cmd-2"):
            command_req = request.Request(
                f"{base}/commands",
                data=json.dumps({
                    "command_id": command_id,
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
            "worker": {"max_commands_per_poll": 1},
            "allowed_actions": ["summarize_run"],
            "runs": {"example": str(run_dir)},
            "audit": {"log_file": str(audit_log)},
        })

        assert [result["status"] for result in results] == ["completed", "rejected"]
        assert "worker command limit exceeded" in results[1]["error"]
        audit_rows = [json.loads(line) for line in audit_log.read_text().splitlines()]
        assert [row["result"]["status"] for row in audit_rows] == ["completed", "rejected"]
        assert audit_rows[0]["record_hash"] == audit_record_hash(audit_rows[0])
        assert audit_rows[1]["prev_hash"] == audit_rows[0]["record_hash"]
        assert audit_rows[1]["record_hash"] == audit_record_hash(audit_rows[1])
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
