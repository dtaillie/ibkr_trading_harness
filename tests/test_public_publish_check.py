from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "public_publish_check.py"


def test_public_publish_check_lists_default_checks():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--list"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert "export_manifest:" in result.stdout
    assert "public_readiness_audit:" in result.stdout
    assert "dashboard_seeded_smoke:" in result.stdout
    assert "dashboard_seeded_layout:" not in result.stdout


def test_public_publish_check_lists_json_with_optional_screenshots():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--list", "--json", "--include-screenshots"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    payload = json.loads(result.stdout)
    ids = [row["id"] for row in payload["checks"]]
    assert payload["schema_version"] == 1
    assert payload["check_count"] == len(ids)
    assert "pytest" in ids
    assert "dashboard_seeded_layout" in ids
    assert "dashboard_empty_layout" in ids
    assert next(row for row in payload["checks"] if row["id"] == "dashboard_seeded_layout")["optional"] is True


def test_public_publish_check_rejects_json_without_list():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--json"],
        cwd=ROOT,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode != 0
    assert "--json is only supported with --list" in result.stderr or "--json is only supported with --list" in result.stdout
