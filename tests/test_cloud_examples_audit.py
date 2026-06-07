from __future__ import annotations

import shutil
import subprocess
import sys
from pathlib import Path

from scripts.audit_cloud_examples import ROOT, audit_checks


AUDIT_SCRIPT = ROOT / "scripts" / "audit_cloud_examples.py"


def test_cloud_examples_audit_passes_current_repo():
    findings = audit_checks(ROOT)

    assert findings == []


def test_cloud_examples_audit_reports_missing_boundary_token(tmp_path: Path):
    for relative in (
        "config/cloud_status_hosted.example.yaml",
        "ops/cloud/status-receiver.compose.example.yaml",
        "ops/cloud/status-receiver.Dockerfile.example",
        "ops/cloud/nginx-status-receiver.example.conf",
        "ops/cloud/caddy-status-receiver.example.Caddyfile",
        "ops/cloud/ufw-status-receiver.example.sh",
        "ops/cloud/aws-security-group-status-receiver.example.tf",
        "ops/cloud/aws-s3-command-audit-retention.example.tf",
        "ops/cloud/azure-blob-command-audit-retention.example.tf",
        "ops/cloud/azure-nsg-status-receiver.example.tf",
        "ops/cloud/digitalocean-firewall-status-receiver.example.tf",
        "ops/cloud/fly-status-receiver.example.toml",
        "ops/cloud/gcp-gcs-command-audit-retention.example.tf",
        "ops/cloud/gcp-firewall-status-receiver.example.tf",
        "ops/cloud/render-status-receiver.example.yaml",
        "ops/cloud/sync-command-audit.example.sh",
    ):
        source = ROOT / relative
        dest = tmp_path / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)

    hosted = tmp_path / "config/cloud_status_hosted.example.yaml"
    hosted.write_text(
        hosted.read_text(encoding="utf-8").replace("command_scopes:", "command_scopes_removed:"),
        encoding="utf-8",
    )

    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--root", str(tmp_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode == 1
    assert "missing required boundary token `command_scopes:`" in result.stdout
