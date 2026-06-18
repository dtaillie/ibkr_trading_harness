from __future__ import annotations

import json
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
    assert (dest / "scripts" / "audit_cloud_examples.py").exists()
    assert (dest / "scripts" / "audit_dashboard_contracts.py").exists()
    assert (dest / "scripts" / "audit_workbench_contracts.py").exists()
    assert (dest / "scripts" / "cloud_status_catalog.py").exists()
    assert (dest / "scripts" / "install_dashboard_server.sh").exists()
    assert (dest / "scripts" / "install_local_monitoring_stack.sh").exists()
    assert (dest / "scripts" / "public_publish_check.py").exists()
    assert (dest / "scripts" / "smoke_dashboard.py").exists()
    assert (dest / "tests" / "test_cloud_examples_audit.py").exists()
    assert (dest / "tests" / "test_dashboard_contract_audit.py").exists()
    assert (dest / "tests" / "test_workbench_contract_audit.py").exists()
    assert (dest / "ops" / "cloud" / "status-receiver.Dockerfile.example").exists()
    assert (dest / "ops" / "cloud" / "fly-status-receiver.example.toml").exists()
    assert (dest / "ops" / "cloud" / "render-status-receiver.example.yaml").exists()
    assert (dest / "ops" / "cloud" / "digitalocean-firewall-status-receiver.example.tf").exists()
    assert (dest / "ops" / "cloud" / "aws-s3-command-audit-retention.example.tf").exists()
    assert (dest / "ops" / "cloud" / "sync-command-audit.example.sh").exists()
    assert (dest / "docs" / "public_launch_plan.md").exists()


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


def test_export_public_repo_lists_public_manifest_without_writing_destination(tmp_path: Path):
    dest = tmp_path / "public"

    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT), "--dest", str(dest), "--list"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    rows = result.stdout.splitlines()
    assert "README.md" in rows
    assert "README.public.md" not in rows
    assert "web/dashboard/app.js" in rows
    assert "web/dashboard/app/00_core.js" in rows
    assert "web/dashboard/app/90_bootstrap.js" in rows
    assert "scripts/export_public_repo.py" in rows
    assert "scripts/cloud_status_catalog.py" in rows
    assert "scripts/public_publish_check.py" in rows
    assert "config/plugin_runner.example.yaml" in rows
    assert not any(row.startswith("paper_logs/") for row in rows)
    assert not any(row.startswith("private/") for row in rows)
    assert not dest.exists()


def test_export_public_repo_lists_json_manifest_metadata_without_writing_destination(tmp_path: Path):
    dest = tmp_path / "public"

    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT), "--dest", str(dest), "--list", "--json"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    payload = json.loads(result.stdout)
    paths = [row["path"] for row in payload["files"]]
    assert payload["schema_version"] == 1
    assert payload["file_count"] == len(paths)
    assert payload["top_level_counts"]["web"] > 0
    assert payload["top_level_counts"]["scripts"] > 0
    assert "README.md" in paths
    assert "README.public.md" not in paths
    assert any(
        row["source"] in {"README.public.md", "README.md"} and row["path"] == "README.md"
        for row in payload["files"]
    )
    assert all(row["size_bytes"] > 0 for row in payload["files"])
    assert not dest.exists()


def test_export_public_repo_rejects_json_without_list(tmp_path: Path):
    dest = tmp_path / "public"

    result = subprocess.run(
        [sys.executable, str(EXPORT_SCRIPT), "--dest", str(dest), "--json"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode != 0
    assert "--json is only supported with --list" in result.stderr or "--json is only supported with --list" in result.stdout
    assert not dest.exists()
