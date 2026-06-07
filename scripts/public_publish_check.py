#!/usr/bin/env python3
"""Run the public repo pre-publish validation gate."""

from __future__ import annotations

import argparse
import json
import subprocess
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class Check:
    id: str
    description: str
    command: list[str]
    optional: bool = False


def build_checks(*, include_screenshots: bool = False) -> list[Check]:
    checks = [
        Check(
            "export_manifest",
            "Validate that the public export manifest can be emitted as JSON.",
            [sys.executable, "scripts/export_public_repo.py", "--list", "--json"],
        ),
        Check(
            "public_readiness_audit",
            "Fail on private-path, sensitive-token, and public-example review findings.",
            [sys.executable, "scripts/public_readiness_audit.py", "--fail-on-review"],
        ),
        Check(
            "cloud_examples_audit",
            "Check hosted/cloud example boundary placeholders.",
            [sys.executable, "scripts/audit_cloud_examples.py"],
        ),
        Check(
            "python_compile",
            "Compile public Python files.",
            [sys.executable, "-m", "compileall", "-q", "."],
        ),
        Check(
            "dashboard_javascript_syntax",
            "Check dashboard JavaScript syntax.",
            ["node", "--check", "web/dashboard/app.js"],
        ),
        Check(
            "pytest",
            "Run the public Python test suite.",
            [sys.executable, "-m", "pytest", "-q"],
        ),
        Check(
            "dashboard_default_smoke",
            "Smoke the dashboard with default example state.",
            [sys.executable, "scripts/smoke_dashboard.py"],
        ),
        Check(
            "dashboard_seeded_smoke",
            "Smoke the dashboard with seeded many-symbol state.",
            [sys.executable, "scripts/smoke_dashboard.py", "--scenario", "seeded"],
        ),
        Check(
            "dashboard_empty_smoke",
            "Smoke the dashboard empty-state path.",
            [sys.executable, "scripts/smoke_dashboard.py", "--scenario", "empty"],
        ),
        Check(
            "dashboard_accessibility_smoke",
            "Check basic dashboard accessibility wiring.",
            [sys.executable, "scripts/smoke_dashboard_accessibility.py"],
        ),
    ]
    if include_screenshots:
        checks.extend([
            Check(
                "dashboard_seeded_layout",
                "Capture dashboard screenshots and run layout checks on seeded state.",
                [sys.executable, "scripts/smoke_dashboard_screenshots.py", "--scenario", "seeded", "--check-layout"],
                optional=True,
            ),
            Check(
                "dashboard_empty_layout",
                "Capture dashboard screenshots and run layout checks on empty state.",
                [sys.executable, "scripts/smoke_dashboard_screenshots.py", "--scenario", "empty", "--check-layout"],
                optional=True,
            ),
        ])
    return checks


def check_payload(checks: list[Check]) -> dict[str, object]:
    return {
        "schema_version": 1,
        "root": str(ROOT),
        "check_count": len(checks),
        "checks": [
            {
                "id": check.id,
                "description": check.description,
                "command": check.command,
                "optional": check.optional,
            }
            for check in checks
        ],
    }


def run_checks(checks: list[Check]) -> int:
    for check in checks:
        print(f"== {check.id} ==")
        print(" ".join(check.command))
        completed = subprocess.run(check.command, cwd=ROOT)
        if completed.returncode != 0:
            print(f"FAILED: {check.id} exited {completed.returncode}", file=sys.stderr)
            return completed.returncode
    print(f"Public publish checks passed: {len(checks)}")
    return 0


def main() -> None:
    parser = argparse.ArgumentParser(description="Run the public pre-publish validation gate")
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print the checks without running them.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="With --list, print check metadata as JSON.",
    )
    parser.add_argument(
        "--include-screenshots",
        action="store_true",
        help="Include slower dashboard screenshot layout checks.",
    )
    args = parser.parse_args()

    checks = build_checks(include_screenshots=args.include_screenshots)
    if args.list:
        if args.json:
            print(json.dumps(check_payload(checks), indent=2, sort_keys=True))
        else:
            for check in checks:
                print(f"{check.id}: {' '.join(check.command)}")
        return
    if args.json:
        raise SystemExit("--json is only supported with --list")
    raise SystemExit(run_checks(checks))


if __name__ == "__main__":
    main()
