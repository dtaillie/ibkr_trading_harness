#!/usr/bin/env python3
"""Static safety-boundary audit for public cloud deployment examples."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Iterable


ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Finding:
    severity: str
    path: str
    detail: str


@dataclass(frozen=True)
class TextCheck:
    path: str
    required: tuple[str, ...] = ()
    forbidden: tuple[str, ...] = ()


CHECKS: tuple[TextCheck, ...] = (
    TextCheck(
        "config/cloud_status_hosted.example.yaml",
        required=(
            "auth_token_env:",
            "network_access:",
            "allowed_client_networks:",
            "127.0.0.1/32",
            "command_rate_limit:",
            "command_scopes:",
            "command_audit_signature_env:",
            "Keep remote command workers on the local trading machine",
        ),
    ),
    TextCheck(
        "ops/cloud/status-receiver.compose.example.yaml",
        required=(
            "TRADING_STATUS_TOKEN",
            "127.0.0.1:8765:8765",
            "config/cloud_status_hosted.example.yaml",
            "status_receiver_state:",
        ),
    ),
    TextCheck(
        "ops/cloud/status-receiver.Dockerfile.example",
        required=(
            "cloud_status_hosted.example.yaml",
            "COPY examples",
            "COPY framework",
            "COPY web",
            'CMD ["python", "scripts/cloud_status_server.py"',
        ),
        forbidden=(
            "paper_logs",
            "config/*_paper.yaml",
        ),
    ),
    TextCheck(
        "ops/cloud/nginx-status-receiver.example.conf",
        required=(
            "listen 443 ssl",
            "client_max_body_size 2m",
            "proxy_pass http://127.0.0.1:8765",
            "X-Forwarded-Proto https",
        ),
    ),
    TextCheck(
        "ops/cloud/caddy-status-receiver.example.Caddyfile",
        required=(
            "reverse_proxy 127.0.0.1:8765",
            "X-Forwarded-Proto https",
            "request body too large",
        ),
    ),
    TextCheck(
        "ops/cloud/ufw-status-receiver.example.sh",
        required=(
            "APPLY:=0",
            "ufw default deny incoming",
            "ufw allow from ${SSH_CIDR} to any port 22",
            "ufw allow from ${PUBLISHER_CIDR} to any port 443",
            "ufw deny 8765/tcp",
            "Dry run only",
        ),
    ),
    TextCheck(
        "ops/cloud/aws-security-group-status-receiver.example.tf",
        required=(
            "var.ssh_cidrs",
            "local.https_cidrs",
            "from_port   = 22",
            "from_port   = 443",
        ),
        forbidden=(
            "from_port   = 8765",
            "to_port     = 8765",
        ),
    ),
    TextCheck(
        "ops/cloud/digitalocean-firewall-status-receiver.example.tf",
        required=(
            "var.ssh_cidrs",
            "local.https_cidrs",
            'port_range       = "22"',
            'port_range       = "443"',
        ),
        forbidden=(
            'port_range       = "8765"',
        ),
    ),
    TextCheck(
        "ops/cloud/gcp-firewall-status-receiver.example.tf",
        required=(
            "source_ranges = var.management_cidrs",
            "source_ranges = var.publisher_dashboard_cidrs",
            'ports    = ["22"]',
            'ports    = ["443"]',
        ),
        forbidden=(
            'ports    = ["8765"]',
        ),
    ),
    TextCheck(
        "ops/cloud/azure-nsg-status-receiver.example.tf",
        required=(
            "source_address_prefixes     = var.management_cidrs",
            "source_address_prefixes     = var.publisher_dashboard_cidrs",
            'destination_port_range      = "22"',
            'destination_port_range      = "443"',
        ),
        forbidden=(
            'destination_port_range      = "8765"',
        ),
    ),
    TextCheck(
        "ops/cloud/aws-s3-command-audit-retention.example.tf",
        required=(
            "object_lock_enabled = true",
            "aws_s3_bucket_public_access_block",
            "aws_s3_bucket_versioning",
            "aws_s3_bucket_object_lock_configuration",
            "DenyInsecureTransport",
            "var.writer_principal_arns",
        ),
    ),
    TextCheck(
        "ops/cloud/gcp-gcs-command-audit-retention.example.tf",
        required=(
            "uniform_bucket_level_access = true",
            'public_access_prevention    = "enforced"',
            "versioning",
            "retention_policy",
            "prevent_destroy = true",
            "roles/storage.objectCreator",
        ),
    ),
    TextCheck(
        "ops/cloud/azure-blob-command-audit-retention.example.tf",
        required=(
            "allow_nested_items_to_be_public = false",
            "versioning_enabled = true",
            "delete_retention_policy",
            "azurerm_storage_container_immutability_policy",
            "var.writer_principal_ids",
        ),
    ),
    TextCheck(
        "ops/cloud/sync-command-audit.example.sh",
        required=(
            "APPLY:=0",
            "AUDIT_DEST",
            "aws s3 cp",
            "rclone copyto",
            "Dry run only",
            "destination retention controls",
        ),
    ),
    TextCheck(
        "ops/cloud/fly-status-receiver.example.toml",
        required=(
            "TRADING_STATUS_TOKEN",
            "TRADING_COMMAND_AUDIT_HMAC_KEY",
            "force_https = true",
            "status_receiver_state",
        ),
    ),
    TextCheck(
        "ops/cloud/render-status-receiver.example.yaml",
        required=(
            "TRADING_STATUS_TOKEN",
            "TRADING_COMMAND_AUDIT_HMAC_KEY",
            "sync: false",
            "status-receiver-state",
        ),
    ),
)


def read_text(root: Path, relative: str) -> str | None:
    path = root / relative
    if not path.exists() or not path.is_file():
        return None
    return path.read_text(encoding="utf-8", errors="replace")


def audit_checks(root: Path, checks: Iterable[TextCheck] = CHECKS) -> list[Finding]:
    findings: list[Finding] = []
    for check in checks:
        text = read_text(root, check.path)
        if text is None:
            findings.append(Finding("BLOCKER", check.path, "required public cloud example is missing"))
            continue
        for token in check.required:
            if token not in text:
                findings.append(Finding("BLOCKER", check.path, f"missing required boundary token `{token}`"))
        for token in check.forbidden:
            if token in text:
                findings.append(Finding("BLOCKER", check.path, f"contains forbidden boundary token `{token}`"))
    return findings


def print_section(title: str, findings: list[Finding]) -> None:
    print(f"\n== {title} ==")
    if not findings:
        print("none")
        return
    for finding in findings:
        print(f"{finding.severity}: {finding.path}: {finding.detail}")


def main() -> int:
    parser = argparse.ArgumentParser(description="Audit public cloud deployment examples for expected safety-boundary markers")
    parser.add_argument("--root", type=Path, default=ROOT, help="Repository root to audit")
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    root = args.root.resolve()
    findings = audit_checks(root)
    blocker_count = sum(1 for finding in findings if finding.severity == "BLOCKER")
    payload = {
        "root": str(root),
        "checked_count": len(CHECKS),
        "blocker_count": blocker_count,
        "findings": [asdict(finding) for finding in findings],
    }
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print("Cloud example audit")
        print("===================")
        print("Static check only; real deployments still need provider/account review.")
        print_section("Boundary Findings", findings)
        print("\n== Summary ==")
        print(f"checked_examples: {len(CHECKS)}")
        print(f"blockers: {blocker_count}")
    return 1 if blocker_count else 0


if __name__ == "__main__":
    raise SystemExit(main())
