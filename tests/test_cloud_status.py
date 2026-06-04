from __future__ import annotations

import csv
import io
import json
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import error, request

from scripts import cloud_status_server as status_server
from scripts.cloud_status_server import create_server
from scripts.command_worker import execute_command, poll_once
from scripts.publish_status import collect_status, post_status, publish_status


def write_run(run_dir: Path, *, timestamp: str = "2026-01-02T14:30:00+00:00") -> None:
    run_dir.mkdir()
    (run_dir / "summary.json").write_text(
        json.dumps(
            {
                "mode": "replay",
                "decisions": 1,
                "orders": 0,
                "fills": 0,
                "rejections": 0,
                "final_cash": 10000.0,
                "final_equity": None,
                "final_positions": {},
            },
            sort_keys=True,
        )
    )
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
        assert "config-form" in html

        with request.urlopen(f"http://127.0.0.1:{server.server_address[1]}/dashboard/styles.css", timeout=5) as resp:
            css = resp.read().decode("utf-8")
        assert ".topbar" in css
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
                "runs": [{"id": "run-a", "status": "ok"}, {"id": "run-b", "status": "missing"}],
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
        dataset = payload["datasets"][0]
        assert dataset["symbol"] == "SPY"
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
        assert exported[0]["quality_status"] == "ok"
        assert exported[0]["bar_size"] == "5min"
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
        assert detail["rows"] == 4
        assert detail["column_map"]["close"] == "close"
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
        assert options["run_actions"] == ["validate", "replay", "simulated_paper"]
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
        assert draft["config"]["data"]["files"] == {"SPY": str(data_file)}
        assert draft["alignment"]["dataset_count"] == 1
        assert draft["alignment"]["symbols"] == ["SPY"]
        assert draft["alignment"]["common_timestamp_count"] == 2
        assert draft["alignment"]["warning_count"] == 0
        assert "strategy_plugin: examples.strategies.no_edge_template:create_strategy" in draft["yaml"]
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
        assert all(asset["exists"] for asset in diagnostics["dashboard_assets"])

        with request.urlopen(f"{base}/workbench_snapshot_export", timeout=5) as resp:
            assert resp.headers["Content-Type"].startswith("application/json")
            assert resp.headers["Content-Disposition"] == 'attachment; filename="workbench_snapshot.json"'
            snapshot = json.loads(resp.read().decode("utf-8"))
        assert snapshot["schema_version"] == 1
        assert snapshot["diagnostics"]["status"] == "ok"
        assert snapshot["data_catalog"]["count"] == 1
        assert snapshot["data_catalog"]["datasets"][0]["symbol"] == "SPY"
        assert snapshot["config_options"]["risk_presets"]
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
