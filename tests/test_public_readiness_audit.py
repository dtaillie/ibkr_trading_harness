from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
AUDIT_SCRIPT = ROOT / "scripts" / "public_readiness_audit.py"


def run_git(repo: Path, *args: str) -> None:
    subprocess.run(["git", *args], cwd=repo, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def test_audit_treats_ignored_runtime_files_as_inventory(tmp_path: Path):
    repo = tmp_path / "candidate"
    repo.mkdir()
    run_git(repo, "init")

    (repo / ".gitignore").write_text("paper_logs/\n", encoding="utf-8")
    (repo / "README.md").write_text("public candidate\n", encoding="utf-8")
    audit_log = repo / "paper_logs" / "remote_control" / "audit.jsonl"
    audit_log.parent.mkdir(parents=True)
    audit_log.write_text('{"event": "command_result"}\n', encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT)],
        cwd=repo,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert "tracked_private_blockers: 0" in result.stdout
    assert "ignored_private_runtime_items: 1" in result.stdout


def test_audit_strict_mode_fails_on_review_findings(tmp_path: Path):
    repo = tmp_path / "candidate"
    repo.mkdir()
    run_git(repo, "init")

    (repo / ".gitignore").write_text("paper_logs/\n", encoding="utf-8")
    local_path = "/" + "home" + "/example/project"
    (repo / "README.md").write_text(f"local path {local_path}\n", encoding="utf-8")

    normal = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT)],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert normal.returncode == 0
    assert "review_items: 1" in normal.stdout

    strict = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--fail-on-review"],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert strict.returncode == 3
    assert "review_items: 1" in strict.stdout


def test_audit_reviews_strategy_examples_without_boundary_disclaimer(tmp_path: Path):
    repo = tmp_path / "candidate"
    repo.mkdir()
    run_git(repo, "init")

    config_dir = repo / "config"
    config_dir.mkdir()
    example = config_dir / "plugin_runner.example.yaml"
    example.write_text(
        "\n".join(
            [
                "metadata:",
                "  strategy_plugin: examples.strategies.demo:create_strategy",
                "runner:",
                "  mode: replay",
            ]
        )
        + "\n",
        encoding="utf-8",
    )

    normal = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT)],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert normal.returncode == 0
    assert "Public Example Strategy Boundaries" in normal.stdout
    assert "strategy-facing public example lacks example-only/non-viable disclaimer" in normal.stdout
    assert "review_items: 1" in normal.stdout

    strict = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--fail-on-review"],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert strict.returncode == 3

    example.write_text(
        "\n".join(
            [
                "metadata:",
                "  strategy_plugin: examples.strategies.demo:create_strategy",
                "  status: example_only",
                "notes:",
                "  - Not a viable strategy.",
            ]
        )
        + "\n",
        encoding="utf-8",
    )
    clean = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--fail-on-review"],
        cwd=repo,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    assert clean.returncode == 0
    assert "review_items: 0" in clean.stdout
