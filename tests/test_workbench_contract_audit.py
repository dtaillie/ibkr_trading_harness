from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

import yaml

from scripts.audit_workbench_contracts import ROOT, audit_checks


AUDIT_SCRIPT = ROOT / "scripts" / "audit_workbench_contracts.py"
AUDITED_FILES = (
    "scripts/cloud_status_server.py",
    "config/plugin_runner.example.yaml",
    "config/stock_paper.example.yaml",
    "config/crypto_paper.example.yaml",
    "config/strategy_registry.example.yaml",
    "config/plugin_registry.example.yaml",
)


def copy_audited_files(dest_root: Path) -> None:
    for relative in AUDITED_FILES:
        source = ROOT / relative
        dest = dest_root / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)


def test_workbench_contract_audit_passes_current_repo():
    assert audit_checks(ROOT) == []


def test_workbench_contract_audit_json_output():
    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--json"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["blocker_count"] == 0
    assert payload["review_count"] == 0


def test_workbench_contract_audit_reports_missing_example_status(tmp_path: Path):
    copy_audited_files(tmp_path)
    config_path = tmp_path / "config/plugin_runner.example.yaml"
    payload = yaml.safe_load(config_path.read_text(encoding="utf-8"))
    payload["metadata"]["status"] = "paper_candidate"
    config_path.write_text(yaml.safe_dump(payload, sort_keys=False), encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--root", str(tmp_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode == 1
    assert "config/plugin_runner.example.yaml: metadata.status must be example_only" in result.stdout


def test_workbench_contract_audit_reports_weakened_plugin_registry_boundary(tmp_path: Path):
    copy_audited_files(tmp_path)
    registry_path = tmp_path / "config/plugin_registry.example.yaml"
    registry_path.write_text(
        registry_path.read_text(encoding="utf-8").replace("do not publish", "publish"),
        encoding="utf-8",
    )

    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--root", str(tmp_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode == 1
    assert "placeholder registry must explain example/private/publication boundary" in result.stdout
