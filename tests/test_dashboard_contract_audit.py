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
AUDITED_DIRS = (
    "web/dashboard/app",
)


def copy_audited_files(dest_root: Path) -> None:
    for relative in AUDITED_FILES:
        source = ROOT / relative
        dest = dest_root / relative
        dest.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(source, dest)
    for relative in AUDITED_DIRS:
        source = ROOT / relative
        dest = dest_root / relative
        shutil.copytree(source, dest)


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


def test_dashboard_contract_audit_rejects_reintroduced_task_selector(tmp_path: Path):
    # The "I want to" task selector was deleted as a nav crutch; the contract
    # now requires it stays gone. Re-adding a task <select> must be a blocker.
    copy_audited_files(tmp_path)
    html_path = tmp_path / "web/dashboard/index.html"
    body = html_path.read_text(encoding="utf-8")
    body = body.replace(
        '<div class="toolbar">',
        '<div class="toolbar">\n          <select id="dashboard-task">'
        '<option value="monitor">Monitor today\'s run</option></select>',
    )
    html_path.write_text(body, encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--root", str(tmp_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode == 1
    assert "task selector labels do not match the public workflow contract" in result.stdout


def test_dashboard_contract_audit_reports_nav_target_mismatch(tmp_path: Path):
    # The views are flattened (no lens-tab contract left); the nav-target list is
    # now the central navigation contract, so mutating it must be a blocker.
    copy_audited_files(tmp_path)
    html_path = tmp_path / "web/dashboard/index.html"
    html_path.write_text(
        html_path.read_text(encoding="utf-8").replace(
            'data-view-target="overview" aria-current="page"',
            'data-view-target="bogus" aria-current="page"',
        ),
        encoding="utf-8",
    )

    result = subprocess.run(
        [sys.executable, str(AUDIT_SCRIPT), "--root", str(tmp_path)],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode == 1
    assert "nav targets must be" in result.stdout
