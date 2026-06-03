#!/usr/bin/env python3
"""Audit the working tree before creating a public repo copy.

This script is intentionally conservative. It does not decide what to publish;
it points out files and token classes that need a human review first.
"""

from __future__ import annotations

import fnmatch
import re
import subprocess
from dataclasses import dataclass
from pathlib import Path


PRIVATE_TRACKED_PATTERNS = (
    "analysis_out/*",
    "cache/*",
    "paper_logs/*",
    "private/*",
    "config/*.env",
    "config/*_paper.yaml",
    "config/strategy_registry.yaml",
    "docs/private_*.md",
    "scripts/r*.py",
)

PUBLIC_CANDIDATE_DIRS = (
    "framework/",
    "examples/",
    "live/",
    "ops/",
)

PUBLIC_CANDIDATE_FILES = (
    ".gitignore",
    "README.md",
    "requirements.txt",
    "core.py",
)

SENSITIVE_PATTERNS = {
    "ibkr_account_id": re.compile(r"\b(?:U|DU|DUP)\d{5,}\b"),
    "private_plugin_ref": re.compile(r"\bprivate\.[A-Za-z0-9_.:-]+"),
    "credential_assignment": re.compile(r"\b(?:PASSWORD|PASSWD|SECRET|TOKEN|API_KEY|ACCESS_KEY)\b\s*=\s*\S+", re.I),
    "local_home_path": re.compile(r"/home/[A-Za-z0-9_.-]+/"),
}


@dataclass(frozen=True)
class Finding:
    severity: str
    path: str
    detail: str


def git_lines(*args: str) -> list[str]:
    result = subprocess.run(
        ["git", *args],
        check=True,
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return [line for line in result.stdout.splitlines() if line]


def in_git_repo() -> bool:
    result = subprocess.run(
        ["git", "rev-parse", "--is-inside-work-tree"],
        text=True,
        stdout=subprocess.PIPE,
        stderr=subprocess.PIPE,
    )
    return result.returncode == 0 and result.stdout.strip() == "true"


def all_local_files() -> list[str]:
    files = []
    for path in Path(".").rglob("*"):
        if path.is_dir():
            continue
        parts = set(path.parts)
        if ".git" in parts or "__pycache__" in parts or ".pytest_cache" in parts:
            continue
        files.append(path.as_posix())
    return sorted(files)


def git_publishable_files() -> list[str]:
    """Files Git would publish if the current candidate tree were added."""
    return sorted(set(git_lines("ls-files", "--cached", "--others", "--exclude-standard")))


def matches_any(path: str, patterns: tuple[str, ...]) -> str | None:
    for pattern in patterns:
        if fnmatch.fnmatch(path, pattern):
            return pattern
    return None


def tracked_private_findings(tracked: list[str]) -> list[Finding]:
    findings = []
    for path in tracked:
        pattern = matches_any(path, PRIVATE_TRACKED_PATTERNS)
        if pattern:
            findings.append(Finding("BLOCKER", path, f"tracked path matches private pattern `{pattern}`"))
    return findings


def ignored_private_inventory() -> list[Finding]:
    if not in_git_repo():
        return []
    findings = []
    for path in git_lines("status", "--ignored", "--short"):
        marker, raw_path = path[:2], path[3:]
        if marker == "!!":
            pattern = matches_any(raw_path, PRIVATE_TRACKED_PATTERNS)
            if pattern:
                findings.append(Finding("INFO", raw_path, f"ignored local/private path matches `{pattern}`"))
    return findings


def scan_sensitive_tokens(paths: list[str]) -> list[Finding]:
    findings = []
    for path in paths:
        if path == "scripts/public_readiness_audit.py":
            continue
        p = Path(path)
        if not p.exists() or p.is_dir():
            continue
        try:
            text = p.read_text(errors="replace")
        except OSError:
            continue
        for name, pattern in SENSITIVE_PATTERNS.items():
            if pattern.search(text):
                findings.append(Finding("REVIEW", path, f"contains possible `{name}` token"))
    return findings


def public_candidate_gap_findings(tracked: list[str]) -> list[Finding]:
    tracked_set = set(tracked)
    findings = []
    for path in Path(".").glob("config/*.example.yaml"):
        raw = str(path)
        if raw.startswith("./"):
            raw = raw[2:]
        if raw not in tracked_set:
            findings.append(Finding("REVIEW", raw, "public-safe example config exists but is not tracked"))
    for path in Path(".").glob("config/*.env.example"):
        raw = str(path)
        if raw.startswith("./"):
            raw = raw[2:]
        if raw not in tracked_set:
            findings.append(Finding("REVIEW", raw, "public-safe env example exists but is not tracked"))
    return findings


def print_section(title: str, findings: list[Finding]) -> None:
    print(f"\n== {title} ==")
    if not findings:
        print("none")
        return
    for finding in findings:
        print(f"{finding.severity}: {finding.path}: {finding.detail}")


def main() -> None:
    publishable = git_publishable_files() if in_git_repo() else all_local_files()
    tracked_private = tracked_private_findings(publishable)
    sensitive = scan_sensitive_tokens(publishable)
    candidate_gaps = public_candidate_gap_findings(publishable)
    ignored_inventory = ignored_private_inventory()

    print("Public readiness audit")
    print("======================")
    print("Use this before copying a public subset or pushing to GitHub.")
    print("BLOCKER means do not publish the tracked file as-is.")
    print("REVIEW means manually inspect before including in a public copy.")

    print_section("Tracked Private/Research Paths", tracked_private)
    print_section("Tracked Sensitive Token Classes", sensitive)
    print_section("Public Example Files Not Tracked", candidate_gaps)
    print_section("Ignored Local Private/Runtime Inventory", ignored_inventory[:80])
    if len(ignored_inventory) > 80:
        print(f"... {len(ignored_inventory) - 80} more ignored private/runtime paths omitted")

    blockers = len(tracked_private)
    reviews = len(sensitive) + len(candidate_gaps)
    print("\n== Summary ==")
    print(f"tracked_private_blockers: {blockers}")
    print(f"review_items: {reviews}")
    print(f"ignored_private_runtime_items: {len(ignored_inventory)}")
    if blockers:
        raise SystemExit(2)


if __name__ == "__main__":
    main()
