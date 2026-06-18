#!/usr/bin/env python3
"""Check that public-facing docs retain the required publication boundary copy."""

from __future__ import annotations

import argparse
import json
import sys
from dataclasses import dataclass
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent


@dataclass(frozen=True)
class DocRequirement:
    id: str
    paths: tuple[str, ...]
    phrases: tuple[str, ...]


REQUIREMENTS = [
    DocRequirement(
        id="readme_public_positioning",
        paths=("README.public.md", "README.md"),
        phrases=(
            "Local-first infrastructure",
            "explicit safety boundaries",
            "non-viable example strategies",
            "Not a turnkey live-trading system",
            "broker credentials",
            "private repo or ignored local files",
            "python3 scripts/public_publish_check.py",
        ),
    ),
    DocRequirement(
        id="publication_readiness_gate",
        paths=("docs/publication_readiness.md",),
        phrases=(
            "Do not publish",
            "python3 scripts/public_publish_check.py --include-screenshots",
            "Final Manual Review Checklist",
            "no private results",
            "no-edge example behavior",
        ),
    ),
    DocRequirement(
        id="blog_public_boundary",
        paths=("docs/blog_public_ibkr_harness_draft.md",),
        phrases=(
            "local-first",
            "Strategy Logic Stays Private",
            "Public/Private Export",
            "This is infrastructure, not alpha.",
            "Example plugins are intentionally non-viable",
            "python3 scripts/public_publish_check.py",
        ),
    ),
    DocRequirement(
        id="configuration_privacy",
        paths=("docs/configuration_privacy.md",),
        phrases=(
            "Private Files",
            "config/*.env",
            "config/plugin_registry_local.yaml",
            "Example files must be vanilla templates",
            "private strategy config details",
        ),
    ),
    DocRequirement(
        id="quickstart_private_boundary",
        paths=("docs/public_quickstart.md",),
        phrases=(
            "Do not put live credentials in this repo",
            "public no-edge example",
            "private strategy logic",
            "Safe Remote Command Prototype",
            "Paper/Live Safety",
        ),
    ),
    DocRequirement(
        id="cloud_monitoring_boundary",
        paths=("docs/cloud_monitoring_deployment.md",),
        phrases=(
            "Keep broker credentials",
            "stores no broker credentials",
            "raw artifact contents",
            "Remote Commands",
            "Public/Private Boundary",
        ),
    ),
]


def read_first_existing(paths: tuple[str, ...]) -> tuple[Path | None, str]:
    for rel in paths:
        path = ROOT / rel
        if path.exists():
            return path, path.read_text(encoding="utf-8")
    return None, ""


def audit_docs() -> dict[str, object]:
    results = []
    failures = []
    for requirement in REQUIREMENTS:
        path, body = read_first_existing(requirement.paths)
        missing_phrases = [
            phrase
            for phrase in requirement.phrases
            if phrase.lower() not in body.lower()
        ]
        status = "ok" if path and not missing_phrases else "fail"
        result = {
            "id": requirement.id,
            "status": status,
            "path": str(path.relative_to(ROOT)) if path else None,
            "candidate_paths": list(requirement.paths),
            "missing_phrases": missing_phrases,
        }
        results.append(result)
        if status != "ok":
            failures.append(result)
    return {
        "schema_version": 1,
        "root": str(ROOT),
        "result_count": len(results),
        "failure_count": len(failures),
        "results": results,
    }


def print_human(payload: dict[str, object]) -> None:
    print("Public docs audit")
    print("=================")
    for result in payload["results"]:  # type: ignore[index]
        status = result["status"]  # type: ignore[index]
        path = result["path"] or ", ".join(result["candidate_paths"])  # type: ignore[index]
        print(f"{status.upper()}: {result['id']} ({path})")  # type: ignore[index]
        missing = result["missing_phrases"]  # type: ignore[index]
        if missing:
            for phrase in missing:
                print(f"  missing: {phrase}")
    print(f"\nfailures: {payload['failure_count']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit required public documentation boundary copy")
    parser.add_argument("--json", action="store_true", help="Print machine-readable audit results")
    args = parser.parse_args()

    payload = audit_docs()
    if args.json:
        print(json.dumps(payload, indent=2, sort_keys=True))
    else:
        print_human(payload)
    raise SystemExit(1 if payload["failure_count"] else 0)


if __name__ == "__main__":
    main()
