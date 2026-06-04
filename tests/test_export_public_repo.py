from __future__ import annotations

import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
EXPORT_SCRIPT = ROOT / "scripts" / "export_public_repo.py"


def run_export(dest: Path, *, force: bool = False) -> subprocess.CompletedProcess[str]:
    cmd = [sys.executable, str(EXPORT_SCRIPT), "--dest", str(dest)]
    if force:
        cmd.append("--force")
    return subprocess.run(cmd, cwd=ROOT, check=True, text=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)


def test_export_public_repo_preserves_git_metadata_on_force(tmp_path: Path):
    dest = tmp_path / "public"

    run_export(dest)
    subprocess.run(["git", "init"], cwd=dest, check=True, stdout=subprocess.PIPE, stderr=subprocess.PIPE)
    marker = dest / ".git" / "export-preserve-marker"
    marker.write_text("keep\n", encoding="utf-8")
    stale = dest / "stale_private_note.txt"
    stale.write_text("remove\n", encoding="utf-8")

    run_export(dest, force=True)

    assert marker.read_text(encoding="utf-8") == "keep\n"
    assert not stale.exists()
    assert (dest / "README.md").exists()
    assert (dest / "scripts" / "export_public_repo.py").exists()
    assert (dest / "scripts" / "smoke_dashboard.py").exists()


def test_export_public_repo_requires_force_for_existing_destination(tmp_path: Path):
    dest = tmp_path / "public"
    dest.mkdir()

    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT), "--dest", str(dest)],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode != 0
    assert "pass --force" in result.stderr or "pass --force" in result.stdout
