from __future__ import annotations

import json
import sys
import threading
from datetime import datetime, timedelta, timezone
from pathlib import Path
from urllib import error, request

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
        assert len(dataset["preview"]) == 3
        assert dataset["preview"][-1]["close"] == 101.25
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

        draft_req = request.Request(
            f"{base}/config_draft",
            data=json.dumps({
                "name": "Test Draft",
                "plugin_id": "no_edge_template",
                "mode": "simulated_paper",
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
                "starting_cash": 25000,
                "history_bars": 20,
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
        assert draft["config"]["data"]["files"] == {"SPY": str(data_file)}
        assert "strategy_plugin: examples.strategies.no_edge_template:create_strategy" in draft["yaml"]
        assert draft["saved_path"]
        assert Path(draft["saved_path"]).exists()
        assert Path(draft["saved_path"]).is_relative_to(state_dir)
        assert "--validate-only" in draft["commands"]["validate"]
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
                "datasets": [{"symbol": "SPY", "path": str(data_file)}],
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

        with request.urlopen(f"{base}/config_drafts", timeout=5) as resp:
            drafts = json.loads(resp.read().decode("utf-8"))
        assert drafts["count"] == 1
        assert drafts["drafts"][0]["draft_id"] == "Run_Draft"
        assert drafts["drafts"][0]["symbols"] == ["SPY"]

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
        assert replay["summary"]["mode"] == "replay"
        assert replay["summary"]["decisions"] == 2
        assert replay["summary"]["fills"] == 0

        with request.urlopen(f"{base}/config_draft_artifacts?draft_id=Run_Draft&limit=5", timeout=5) as resp:
            artifacts = json.loads(resp.read().decode("utf-8"))
        assert artifacts["draft_id"] == "Run_Draft"
        assert artifacts["summary"]["mode"] == "replay"
        assert artifacts["counts"] == {"decisions": 2, "fills": 0, "orders": 0}
        assert artifacts["decisions"][0]["intent_count"] == 0
        assert artifacts["decisions"][0]["symbols"] == ["SPY"]
        assert "signal" not in artifacts["decisions"][0]
        assert artifacts["orders"] == []
        assert artifacts["fills"] == []

        with request.urlopen(f"{base}/config_draft_runs?limit=5", timeout=5) as resp:
            runs = json.loads(resp.read().decode("utf-8"))
        assert runs["total"] == 2
        assert [run["action"] for run in runs["runs"]] == ["replay", "validate"]
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
