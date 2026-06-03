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
