from __future__ import annotations

import json
import subprocess
import sys
from pathlib import Path


ROOT = Path(__file__).resolve().parents[1]
SCRIPT = ROOT / "scripts" / "audit_public_docs.py"


def test_public_docs_audit_passes_current_docs():
    result = subprocess.run(
        [sys.executable, str(SCRIPT), "--json"],
        cwd=ROOT,
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    payload = json.loads(result.stdout)
    assert payload["schema_version"] == 1
    assert payload["failure_count"] == 0
    assert {row["id"] for row in payload["results"]} == {
        "readme_public_positioning",
        "publication_readiness_gate",
        "blog_public_boundary",
        "configuration_privacy",
        "quickstart_private_boundary",
        "cloud_monitoring_boundary",
    }


def test_public_docs_audit_human_output_names_failures(tmp_path: Path):
    script = tmp_path / "scripts" / "audit_public_docs.py"
    script.parent.mkdir()
    script.write_text(SCRIPT.read_text(encoding="utf-8"), encoding="utf-8")
    (tmp_path / "docs").mkdir()
    (tmp_path / "README.md").write_text("local-first framework\n", encoding="utf-8")

    result = subprocess.run(
        [sys.executable, str(script)],
        cwd=tmp_path,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )

    assert result.returncode != 0
    assert "FAIL: readme_public_positioning" in result.stdout
    assert "FAIL: publication_readiness_gate" in result.stdout
