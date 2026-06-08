#!/usr/bin/env python3
"""Static dashboard navigation and usability contract audit."""

from __future__ import annotations

import argparse
import json
from dataclasses import asdict, dataclass
from html.parser import HTMLParser
from pathlib import Path
from typing import Any


ROOT = Path(__file__).resolve().parent.parent

EXPECTED_VIEWS = ("overview", "performance", "data", "fetch", "workbench", "runs", "operations", "help")
EXPECTED_JUMP_ROUTES = (
    "overview", "overview/activity", "overview/diagnostics",
    "performance", "performance/trades", "performance/rollups", "performance/diagnostics",
    "data", "data/browse", "data/inspect", "data/compare", "data/diagnostics",
    "fetch", "fetch/jobs", "fetch/detail",
    "workbench", "workbench/builder", "workbench/run", "workbench/artifacts",
    "runs", "runs/state", "runs/runs", "runs/events",
    "operations", "operations/paper", "operations/remote", "operations/control", "operations/diagnostics",
    "help", "help/pages", "help/workflows", "help/data", "help/boundary", "help/docs",
)
EXPECTED_TASK_LABELS = (
    "Monitor today's run",
    "Review performance",
    "Find saved data",
    "Recover a fetch job",
    "Build a simulation",
    "Inspect runs and orders",
    "Check runtime health",
    "Publish safely",
)
EXPECTED_LENSES = {
    "overview": ("home", "activity", "diagnostics"),
    "performance": ("home", "trades", "rollups", "diagnostics"),
    "data": ("home", "browse", "inspect", "compare", "diagnostics"),
    "fetch": ("home", "jobs", "detail"),
    "workbench": ("home", "builder", "run", "artifacts"),
    "runs": ("home", "state", "runs", "events"),
    "operations": ("home", "paper", "remote", "control", "diagnostics"),
    "help": ("home", "pages", "workflows", "data", "boundary", "docs"),
}
REQUIRED_PAGE_INTRO_IDS = (
    "page-intro", "page-route", "page-route-home", "page-route-copy",
    "page-intro-title", "page-intro-note", "page-intro-next",
    "page-intro-next-title", "page-intro-evidence", "page-intro-primary",
    "page-intro-secondary", "page-intro-guide", "page-intro-steps",
)
REQUIRED_JS_TOKENS = (
    "function setActiveView", "function navigateToView", "function applyOverviewLens",
    "function applyPerformanceLens", "function applyDataLens", "function applyFetchLens",
    "function applyWorkbenchLens", "function applyRunsLens", "function applyOperationsLens",
    "function applyHelpLens", "function renderPageIntro", "dashboard-task", "dashboard-jump",
)
REQUIRED_CSS_TOKENS = (
    ".side-nav", ".nav-link", ".topbar", ".page-intro", ".page-intro-next",
    ".page-intro-guide", ".overview-lens-bar", ".overview-lens-button",
    "@media (max-width: 820px)",
)


@dataclass(frozen=True)
class Finding:
    severity: str
    path: str
    detail: str


class DashboardHTMLParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.ids: set[str] = set()
        self.nav_targets: list[str] = []
        self.data_views: set[str] = set()
        self.lens_targets: dict[str, list[str]] = {view: [] for view in EXPECTED_LENSES}
        self.select_stack: list[str] = []
        self.option_stack: list[dict[str, str]] = []
        self.options_by_select: dict[str, list[dict[str, str]]] = {}

    def handle_starttag(self, tag: str, attrs_raw: list[tuple[str, str | None]]) -> None:
        attrs = {key: value or "" for key, value in attrs_raw}
        element_id = attrs.get("id", "")
        if element_id:
            self.ids.add(element_id)
        if tag == "button" and "nav-link" in attrs.get("class", "").split():
            self.nav_targets.append(attrs.get("data-view-target", ""))
        if attrs.get("data-view"):
            self.data_views.add(attrs["data-view"])
        for view in EXPECTED_LENSES:
            key = f"data-{view}-lens-target"
            if key in attrs:
                self.lens_targets[view].append(attrs[key])
        if tag == "select":
            self.select_stack.append(element_id)
            if element_id:
                self.options_by_select.setdefault(element_id, [])
        if tag == "option" and self.select_stack:
            self.option_stack.append({"select_id": self.select_stack[-1], "value": attrs.get("value", ""), "label": ""})

    def handle_data(self, data: str) -> None:
        if self.option_stack:
            self.option_stack[-1]["label"] += data

    def handle_endtag(self, tag: str) -> None:
        if tag == "option" and self.option_stack:
            option = self.option_stack.pop()
            option["label"] = " ".join(option["label"].split())
            self.options_by_select.setdefault(option["select_id"], []).append(option)
        if tag == "select" and self.select_stack:
            self.select_stack.pop()


def duplicate_values(rows: list[str]) -> list[str]:
    seen: set[str] = set()
    duplicates: set[str] = set()
    for row in rows:
        if row in seen:
            duplicates.add(row)
        seen.add(row)
    return sorted(duplicates)


def audit_html(root: Path) -> list[Finding]:
    rel = "web/dashboard/index.html"
    path = root / rel
    if not path.exists():
        return [Finding("BLOCKER", rel, "missing dashboard HTML")]
    parser = DashboardHTMLParser()
    parser.feed(path.read_text(encoding="utf-8"))
    findings: list[Finding] = []
    for element_id in REQUIRED_PAGE_INTRO_IDS:
        if element_id not in parser.ids:
            findings.append(Finding("BLOCKER", rel, f"missing required page-intro element #{element_id}"))
    if tuple(parser.nav_targets) != EXPECTED_VIEWS:
        findings.append(Finding("BLOCKER", rel, f"nav targets must be {list(EXPECTED_VIEWS)}"))
    missing_views = [view for view in EXPECTED_VIEWS if view not in parser.data_views]
    if missing_views:
        findings.append(Finding("BLOCKER", rel, f"missing dashboard sections for views: {', '.join(missing_views)}"))
    jump_routes = [row["value"] for row in parser.options_by_select.get("dashboard-jump", [])]
    if tuple(jump_routes) != EXPECTED_JUMP_ROUTES:
        findings.append(Finding("BLOCKER", rel, "Quick Jump routes do not match the public page/lens contract"))
    if duplicates := duplicate_values(jump_routes):
        findings.append(Finding("BLOCKER", rel, f"Quick Jump contains duplicate routes: {', '.join(duplicates)}"))
    task_labels = [row["label"] for row in parser.options_by_select.get("dashboard-task", [])]
    if tuple(task_labels) != EXPECTED_TASK_LABELS:
        findings.append(Finding("BLOCKER", rel, "task selector labels do not match the public workflow contract"))
    if duplicates := duplicate_values(task_labels):
        findings.append(Finding("BLOCKER", rel, f"task selector contains duplicate labels: {', '.join(duplicates)}"))
    for view, expected_lenses in EXPECTED_LENSES.items():
        observed = tuple(parser.lens_targets.get(view) or [])
        if observed != expected_lenses:
            findings.append(Finding("BLOCKER", rel, f"{view} lenses must be {list(expected_lenses)}"))
    return findings


def audit_text_tokens(root: Path) -> list[Finding]:
    checks = (("web/dashboard/app.js", REQUIRED_JS_TOKENS), ("web/dashboard/styles.css", REQUIRED_CSS_TOKENS))
    findings: list[Finding] = []
    for rel, tokens in checks:
        path = root / rel
        if not path.exists():
            findings.append(Finding("BLOCKER", rel, "missing dashboard asset"))
            continue
        body = path.read_text(encoding="utf-8")
        for token in tokens:
            if token not in body:
                findings.append(Finding("BLOCKER", rel, f"missing dashboard contract token `{token}`"))
    return findings


def audit_checks(root: Path = ROOT) -> list[Finding]:
    root = root.resolve()
    return [*audit_html(root), *audit_text_tokens(root)]


def payload(root: Path = ROOT) -> dict[str, Any]:
    findings = audit_checks(root)
    return {
        "schema_version": 1,
        "root": str(root.resolve()),
        "finding_count": len(findings),
        "blocker_count": sum(1 for finding in findings if finding.severity == "BLOCKER"),
        "findings": [asdict(finding) for finding in findings],
    }


def print_human(result: dict[str, Any]) -> None:
    print("Dashboard contract audit")
    print("========================")
    if not result["findings"]:
        print("none")
    for finding in result["findings"]:
        print(f"{finding['severity']}: {finding['path']}: {finding['detail']}")
    print("\n== Summary ==")
    print(f"blockers: {result['blocker_count']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit dashboard navigation, lens, and first-screen contracts")
    parser.add_argument("--root", type=Path, default=ROOT)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    result = payload(args.root)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print_human(result)
    raise SystemExit(1 if result["blocker_count"] else 0)


if __name__ == "__main__":
    main()
