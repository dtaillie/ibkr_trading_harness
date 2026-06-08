from __future__ import annotations

import json
import shutil
import subprocess
import sys
from pathlib import Path

from scripts.audit_dashboard_contracts import ROOT, audit_checks


AUDIT_SCRIPT = ROOT / "scripts" / "audit_dashboard_contracts.py"
AUDITED_FILES = (
    "web/dashboard/index.html",
    "web/dashboard/app.js",
    "web/dashboard/styles.css",
)


def copy_audited_files(dest_root: Path) -> None:
    for relative in AUDITED_FILES:
        source = ROOT / relative
        dest = dest_root / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)


def test_dashboard_contract_audit_passes_current_repo():
    assert audit_checks(ROOT) == []


def test_dashboard_contract_audit_json_output():
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
    assert payload["finding_count"] == 0


def test_dashboard_contract_audit_reports_duplicate_task_label(tmp_path: Path):
    copy_audited_files(tmp_path)
    html_path = tmp_path / "web/dashboard/index.html"
    body = html_path.read_text(encoding="utf-8")
    body = body.replace(
        '<option value="fetch">Recover a fetch job</option>',
        '<option value="data">Find saved data</option>\n              <option value="fetch">Recover a fetch job</option>',
    )
    html_path.write_text(body, encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--root", str(tmp_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode == 1
    assert "task selector contains duplicate labels: Find saved data" in result.stdout


def test_dashboard_contract_audit_reports_missing_lens_button(tmp_path: Path):
    copy_audited_files(tmp_path)
    html_path = tmp_path / "web/dashboard/index.html"
    html_path.write_text(
        html_path.read_text(encoding="utf-8").replace('data-help-lens-target="docs"', 'data-help-lens-target="reference"'),
        encoding="utf-8",
    )

    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--root", str(tmp_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode == 1
    assert "help lenses must be" in result.stdout
