from __future__ import annotations

import json
import sys
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pytest

from scripts.plugin_supervisor import MANAGED_PROCESSES, SupervisorConfigError, evaluate_once, validate_config


@pytest.fixture(autouse=True)
def cleanup_managed_processes():
    yield
    for proc in list(MANAGED_PROCESSES.values()):
        if proc.poll() is None:
            proc.terminate()
            proc.wait(timeout=5)
    MANAGED_PROCESSES.clear()


def helper_script(path: Path, marker: Path, *, exit_code: int = 0) -> None:
    path.write_text(
        "\n".join(
            [
                "from pathlib import Path",
                f"Path({str(marker)!r}).write_text('ran\\n')",
                f"raise SystemExit({exit_code})",
            ]
        )
        + "\n"
    )


def slow_helper_script(path: Path, started: Path, finished: Path, *, sleep_seconds: float = 0.3) -> None:
    path.write_text(
        "\n".join(
            [
                "import time",
                "from pathlib import Path",
                f"Path({str(started)!r}).write_text('started\\n')",
                f"time.sleep({sleep_seconds!r})",
                f"Path({str(finished)!r}).write_text('finished\\n')",
            ]
        )
        + "\n"
    )


def base_config(
    tmp_path: Path,
    *,
    command: list[str],
    pause_marker: Path | None = None,
    process_mode: str = "blocking",
) -> dict:
    job = {
        "id": "example",
        "enabled": True,
        "cwd": str(tmp_path),
        "command": command,
        "process_mode": process_mode,
        "run_dir": str(tmp_path / "run"),
        "schedule": {
            "market": "always",
            "run_on_start": True,
            "interval_seconds": 3600,
            "max_runtime_seconds": 10,
        },
    }
    if pause_marker is not None:
        job["pause_marker"] = str(pause_marker)
    return {
        "node_id": "test-node",
        "supervisor": {
            "state_file": str(tmp_path / "supervisor" / "status.json"),
            "log_dir": str(tmp_path / "supervisor" / "jobs"),
            "poll_seconds": 1,
        },
        "jobs": [job],
    }


def test_supervisor_runs_due_job_and_writes_state(tmp_path):
    marker = tmp_path / "ran.txt"
    script = tmp_path / "job.py"
    helper_script(script, marker)
    config = base_config(tmp_path, command=[sys.executable, str(script)])
    now = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)

    state = evaluate_once(config, now=now)

    assert marker.read_text() == "ran\n"
    assert state["status"] == "ok"
    assert state["jobs"][0]["status"] == "ok"
    assert state["jobs"][0]["last_returncode"] == 0
    assert Path(state["jobs"][0]["last_stdout"]).exists()
    saved = json.loads(Path(config["supervisor"]["state_file"]).read_text())
    assert saved["jobs"][0]["id"] == "example"


def test_supervisor_skips_paused_job(tmp_path):
    marker = tmp_path / "ran.txt"
    pause_marker = tmp_path / "control" / "runner.pause"
    pause_marker.parent.mkdir()
    pause_marker.write_text("paused\n")
    script = tmp_path / "job.py"
    helper_script(script, marker)
    config = base_config(tmp_path, command=[sys.executable, str(script)], pause_marker=pause_marker)
    now = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)

    state = evaluate_once(config, now=now)

    assert not marker.exists()
    assert state["status"] == "ok"
    assert state["jobs"][0]["status"] == "paused"
    assert state["jobs"][0]["reason"] == "pause_marker_exists"
    assert state["jobs"][0]["pause_marker"] == str(pause_marker)


def test_supervisor_waits_until_interval_elapsed(tmp_path):
    marker = tmp_path / "ran.txt"
    script = tmp_path / "job.py"
    helper_script(script, marker)
    config = base_config(tmp_path, command=[sys.executable, str(script)])
    state_file = Path(config["supervisor"]["state_file"])
    first = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)
    state_file.parent.mkdir(parents=True)
    state_file.write_text(
        json.dumps(
            {
                "schema_version": 1,
                "node_id": "test-node",
                "jobs": [{"id": "example", "status": "ok", "last_started_at": first.isoformat()}],
            }
        )
    )

    state = evaluate_once(config, now=first + timedelta(minutes=10))

    assert not marker.exists()
    assert state["jobs"][0]["status"] == "waiting"
    assert state["jobs"][0]["reason"] == "not_due"


def test_supervisor_records_failed_job(tmp_path):
    marker = tmp_path / "ran.txt"
    script = tmp_path / "job.py"
    helper_script(script, marker, exit_code=7)
    config = base_config(tmp_path, command=[sys.executable, str(script)])

    state = evaluate_once(config, now=datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc))

    assert marker.exists()
    assert state["status"] == "warn"
    assert state["jobs"][0]["status"] == "failed"
    assert state["jobs"][0]["reason"] == "nonzero_exit"
    assert state["jobs"][0]["last_returncode"] == 7


def test_supervisor_manages_long_running_job_without_blocking(tmp_path):
    started = tmp_path / "started.txt"
    finished = tmp_path / "finished.txt"
    script = tmp_path / "slow_job.py"
    slow_helper_script(script, started, finished)
    config = base_config(tmp_path, command=[sys.executable, str(script)], process_mode="managed")
    first = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)

    state = evaluate_once(config, now=first)

    assert state["jobs"][0]["status"] == "running"
    assert state["jobs"][0]["process_mode"] == "managed"
    assert state["jobs"][0]["pid"] > 0
    assert started.exists() or Path(state["jobs"][0]["last_stdout"]).exists()

    second = evaluate_once(config, now=first + timedelta(seconds=1))
    assert second["jobs"][0]["status"] == "running"
    assert second["jobs"][0]["reason"] == "already_running"
    assert second["jobs"][0]["pid"] == state["jobs"][0]["pid"]

    proc = MANAGED_PROCESSES["example"]
    proc.wait(timeout=5)
    third = evaluate_once(config, now=first + timedelta(seconds=2))

    assert finished.read_text() == "finished\n"
    assert third["jobs"][0]["status"] == "ok"
    assert third["jobs"][0]["last_returncode"] == 0
    assert "example" not in MANAGED_PROCESSES


def test_supervisor_restarts_managed_job_after_exit_when_enabled(tmp_path):
    started = tmp_path / "started.txt"
    finished = tmp_path / "finished.txt"
    script = tmp_path / "short_managed_job.py"
    slow_helper_script(script, started, finished, sleep_seconds=0.1)
    config = base_config(tmp_path, command=[sys.executable, str(script)], process_mode="managed")
    config["jobs"][0]["restart"] = {"on_exit": True, "max_restarts_per_hour": 2}
    first = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)

    state = evaluate_once(config, now=first)
    first_pid = state["jobs"][0]["pid"]
    proc = MANAGED_PROCESSES["example"]
    proc.wait(timeout=5)

    restarted = evaluate_once(config, now=first + timedelta(seconds=1))

    assert restarted["jobs"][0]["status"] == "running"
    assert restarted["jobs"][0]["reason"] == "restart_completed"
    assert restarted["jobs"][0]["restart_trigger"] == "completed"
    assert restarted["jobs"][0]["restart_count_last_hour"] == 1
    assert restarted["jobs"][0]["pid"] != first_pid


def test_supervisor_restarts_managed_job_when_runner_status_is_stale(tmp_path):
    started = tmp_path / "started.txt"
    finished = tmp_path / "finished.txt"
    script = tmp_path / "long_managed_job.py"
    slow_helper_script(script, started, finished, sleep_seconds=10)
    runner_status = tmp_path / "run" / "runner_status.json"
    runner_status.parent.mkdir()
    runner_status.write_text(json.dumps({
        "schema_version": 1,
        "state": "running",
        "mode": "shadow",
        "updated_at": "2026-01-02T14:00:00+00:00",
        "latest_data_time": "2026-01-02T14:00:00+00:00",
        "counts": {"decisions": 4},
    }))
    config = base_config(tmp_path, command=[sys.executable, str(script)], process_mode="managed")
    config["jobs"][0]["schedule"]["max_runtime_seconds"] = 1000
    config["jobs"][0]["restart"] = {
        "on_stale_runner_status": True,
        "runner_status_path": str(runner_status),
        "max_status_age_seconds": 60,
        "stop_grace_seconds": 2,
        "max_restarts_per_hour": 2,
    }
    first = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)

    state = evaluate_once(config, now=first)
    first_pid = state["jobs"][0]["pid"]
    old_proc = MANAGED_PROCESSES["example"]
    restarted = evaluate_once(config, now=first + timedelta(minutes=2))

    assert old_proc.poll() is not None
    assert restarted["jobs"][0]["status"] == "running"
    assert restarted["jobs"][0]["reason"] == "restart_runner_status_stale"
    assert restarted["jobs"][0]["restart_trigger"] == "runner_status_stale"
    assert restarted["jobs"][0]["restart_count_last_hour"] == 1
    assert restarted["jobs"][0]["pid"] != first_pid
    assert restarted["jobs"][0]["runner_status"]["stale"] is True
    assert restarted["jobs"][0]["runner_status"]["age_seconds"] == 1920.0


def test_supervisor_blocks_managed_restart_after_limit(tmp_path):
    started = tmp_path / "started.txt"
    finished = tmp_path / "finished.txt"
    script = tmp_path / "short_managed_job.py"
    slow_helper_script(script, started, finished, sleep_seconds=0.1)
    config = base_config(tmp_path, command=[sys.executable, str(script)], process_mode="managed")
    config["jobs"][0]["restart"] = {"on_exit": True, "max_restarts_per_hour": 1}
    first = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)

    state = evaluate_once(config, now=first)
    proc = MANAGED_PROCESSES["example"]
    proc.wait(timeout=5)
    state_file = Path(config["supervisor"]["state_file"])
    saved = json.loads(state_file.read_text())
    saved["jobs"][0]["restart_history"] = [(first + timedelta(seconds=10)).isoformat()]
    state_file.write_text(json.dumps(saved))
    blocked = evaluate_once(config, now=first + timedelta(seconds=20))

    assert blocked["jobs"][0]["status"] == "failed"
    assert blocked["jobs"][0]["reason"] == "restart_limit_reached"
    assert blocked["jobs"][0]["restart_trigger"] == "completed"
    assert blocked["jobs"][0]["restart_count_last_hour"] == 1
    assert "example" not in MANAGED_PROCESSES


def test_supervisor_rejects_shell_command_string(tmp_path):
    config = base_config(tmp_path, command=[sys.executable, "-c", "print('ok')"])
    config["jobs"][0]["command"] = "python3 live/plugin_runner.py"

    errors = validate_config(config)

    assert any("command must be a non-empty list" in err for err in errors)


def test_supervisor_rejects_invalid_process_mode(tmp_path):
    config = base_config(tmp_path, command=[sys.executable, "-c", "print('ok')"])
    config["jobs"][0]["process_mode"] = "shell"

    errors = validate_config(config)

    assert any("process_mode" in err for err in errors)


def test_supervisor_rejects_invalid_restart_policy(tmp_path):
    config = base_config(tmp_path, command=[sys.executable, "-c", "print('ok')"], process_mode="managed")
    config["jobs"][0]["restart"] = {
        "on_exit": "yes",
        "on_stale_runner_status": True,
        "max_restarts_per_hour": 0,
    }

    errors = validate_config(config)

    assert any("restart.on_exit" in err for err in errors)
    assert any("restart.runner_status_path is required" in err for err in errors)
    assert any("restart.max_restarts_per_hour" in err for err in errors)


def test_supervisor_config_error_contains_all_errors(tmp_path):
    config = base_config(tmp_path, command=[sys.executable, "-c", "print('ok')"])
    config["jobs"][0]["schedule"]["market"] = "never"
    config["jobs"][0]["schedule"]["interval_seconds"] = 0

    with pytest.raises(SupervisorConfigError) as exc:
        if errors := validate_config(config):
            raise SupervisorConfigError(errors)

    assert "schedule.market" in str(exc.value)
    assert "schedule.interval_seconds" in str(exc.value)
