#!/usr/bin/env python3
"""Static public Workbench/plugin contract audit."""

from __future__ import annotations

import argparse
import json
import re
from dataclasses import asdict, dataclass
from pathlib import Path
from typing import Any

import yaml


ROOT = Path(__file__).resolve().parent.parent

EXAMPLE_CONFIGS = (
    "config/plugin_runner.example.yaml",
    "config/stock_paper.example.yaml",
    "config/crypto_paper.example.yaml",
)

SERVER_REQUIRED_TOKENS = (
    "CONFIG_BUILDER_PLUGINS",
    '"id": "no_edge_template"',
    '"status": "example_only"',
    '"visibility": "public_example"',
    "not a viable trading strategy",
    "validation_rules",
    "result_fields",
    "result_sections",
    "result_widgets",
    "CONFIG_SCHEMA_VERSION = 1",
    "CONFIG_FORM_SCHEMA_VERSION = 5",
    "CONFIG_GUIDE_SCHEMA_VERSION = 2",
    "DEFAULT_PLUGIN_REGISTRY_PATHS = (ROOT / \"config\" / \"plugin_registry_local.yaml\",)",
)


@dataclass(frozen=True)
class Finding:
    severity: str
    path: str
    detail: str


def read_yaml_mapping(path: Path) -> dict[str, Any]:
    if not path.exists():
        raise FileNotFoundError(path)
    with path.open(encoding="utf-8") as f:
        payload = yaml.safe_load(f) or {}
    if not isinstance(payload, dict):
        raise ValueError(f"YAML file must be a mapping: {path}")
    return payload


def public_boundary_text(payload: dict[str, Any]) -> str:
    chunks: list[str] = []
    for key in ("description", "boundary", "help"):
        value = payload.get(key)
        if value is not None:
            chunks.append(str(value))
    notes = payload.get("notes")
    if isinstance(notes, list):
        chunks.extend(str(item) for item in notes)
    return "\n".join(chunks).lower()


def has_example_boundary(text: str) -> bool:
    return "example" in text and (
        "not a viable" in text
        or "non-viable" in text
        or "does not describe viable" in text
        or "do not trade" in text
        or "demonstrates wiring" in text
        or "demonstrates config shape" in text
    )


def status_value(payload: dict[str, Any]) -> str:
    metadata = payload.get("metadata") if isinstance(payload.get("metadata"), dict) else {}
    return str(metadata.get("status") or payload.get("status") or "").strip()


def audit_example_configs(root: Path) -> list[Finding]:
    findings: list[Finding] = []
    for rel in EXAMPLE_CONFIGS:
        path = root / rel
        try:
            payload = read_yaml_mapping(path)
        except (FileNotFoundError, ValueError) as exc:
            findings.append(Finding("BLOCKER", rel, str(exc)))
            continue
        if status_value(payload) != "example_only":
            findings.append(Finding("BLOCKER", rel, "metadata.status must be example_only"))
        if not has_example_boundary(public_boundary_text(payload)):
            findings.append(Finding("BLOCKER", rel, "missing example-only/non-viable boundary language"))
        text = path.read_text(encoding="utf-8").lower()
        if "private strategy" not in text and "private plugin" not in text:
            findings.append(Finding("REVIEW", rel, "missing private-strategy replacement guidance"))
        if "enable_live_orders: true" in text:
            findings.append(Finding("BLOCKER", rel, "public example must not enable live orders"))
    return findings


def audit_strategy_registry(root: Path) -> list[Finding]:
    rel = "config/strategy_registry.example.yaml"
    path = root / rel
    try:
        payload = read_yaml_mapping(path)
    except (FileNotFoundError, ValueError) as exc:
        return [Finding("BLOCKER", rel, str(exc))]
    findings: list[Finding] = []
    if not has_example_boundary(public_boundary_text(payload)):
        findings.append(Finding("BLOCKER", rel, "registry description must state examples are not viable strategies"))
    strategies = payload.get("strategies")
    if not isinstance(strategies, list) or not strategies:
        return findings + [Finding("BLOCKER", rel, "strategies must be a non-empty list")]
    for idx, row in enumerate(strategies, start=1):
        item_path = f"{rel}#strategies[{idx}]"
        if not isinstance(row, dict):
            findings.append(Finding("BLOCKER", item_path, "strategy row must be a mapping"))
            continue
        if str(row.get("status") or "").strip() != "example_only":
            findings.append(Finding("BLOCKER", item_path, "status must be example_only"))
        if row.get("public") is not True:
            findings.append(Finding("BLOCKER", item_path, "public example row must set public: true"))
        notes_text = " ".join(str(note) for note in row.get("notes") or []).lower()
        if "not a viable" not in notes_text and "demonstrates" not in notes_text:
            findings.append(Finding("BLOCKER", item_path, "notes must say the row is example-only/non-viable"))
    return findings


def audit_plugin_registry_placeholder(root: Path) -> list[Finding]:
    rel = "config/plugin_registry.example.yaml"
    path = root / rel
    try:
        payload = read_yaml_mapping(path)
    except (FileNotFoundError, ValueError) as exc:
        return [Finding("BLOCKER", rel, str(exc))]
    findings: list[Finding] = []
    text = path.read_text(encoding="utf-8").lower()
    if "example only" not in text or "private" not in text or "do not publish" not in text:
        findings.append(Finding("BLOCKER", rel, "placeholder registry must explain example/private/publication boundary"))
    plugins = payload.get("plugins")
    if not isinstance(plugins, list) or not plugins:
        return findings + [Finding("BLOCKER", rel, "plugins must be a non-empty list")]
    for idx, plugin in enumerate(plugins, start=1):
        item_path = f"{rel}#plugins[{idx}]"
        if not isinstance(plugin, dict):
            findings.append(Finding("BLOCKER", item_path, "plugin row must be a mapping"))
            continue
        if str(plugin.get("status") or "").strip() != "private_local":
            findings.append(Finding("BLOCKER", item_path, "placeholder plugin status must be private_local"))
        if str(plugin.get("visibility") or "").strip() != "private_local":
            findings.append(Finding("BLOCKER", item_path, "placeholder plugin visibility must be private_local"))
        spec = str(plugin.get("spec") or "")
        if not spec.startswith("your_package.") or ":" not in spec:
            findings.append(Finding("BLOCKER", item_path, "placeholder plugin spec must use your_package.*:factory"))
    return findings


def audit_workbench_server_contract(root: Path) -> list[Finding]:
    rel = "scripts/cloud_status_server.py"
    path = root / rel
    if not path.exists():
        return [Finding("BLOCKER", rel, "missing Workbench server source")]
    text = path.read_text(encoding="utf-8")
    findings = [
        Finding("BLOCKER", rel, f"missing Workbench contract token `{token}`")
        for token in SERVER_REQUIRED_TOKENS
        if token not in text
    ]
    public_plugin_block = re.search(r"CONFIG_BUILDER_PLUGINS\s*=\s*\((.*?)\n\)", text, flags=re.DOTALL)
    if not public_plugin_block:
        findings.append(Finding("BLOCKER", rel, "CONFIG_BUILDER_PLUGINS block is not inspectable"))
    elif "examples.strategies.no_edge_template:create_strategy" not in public_plugin_block.group(1):
        findings.append(Finding("BLOCKER", rel, "builtin public plugin must point at the no-edge example strategy"))
    return findings


def audit_checks(root: Path = ROOT) -> list[Finding]:
    root = root.resolve()
    findings: list[Finding] = []
    findings.extend(audit_workbench_server_contract(root))
    findings.extend(audit_example_configs(root))
    findings.extend(audit_strategy_registry(root))
    findings.extend(audit_plugin_registry_placeholder(root))
    return findings


def payload(root: Path = ROOT) -> dict[str, Any]:
    findings = audit_checks(root)
    return {
        "schema_version": 1,
        "root": str(root.resolve()),
        "finding_count": len(findings),
        "blocker_count": sum(1 for finding in findings if finding.severity == "BLOCKER"),
        "review_count": sum(1 for finding in findings if finding.severity == "REVIEW"),
        "findings": [asdict(finding) for finding in findings],
    }


def print_human(result: dict[str, Any]) -> None:
    print("Workbench contract audit")
    print("========================")
    if not result["findings"]:
        print("none")
    for finding in result["findings"]:
        print(f"{finding['severity']}: {finding['path']}: {finding['detail']}")
    print("\n== Summary ==")
    print(f"blockers: {result['blocker_count']}")
    print(f"review: {result['review_count']}")


def main() -> None:
    parser = argparse.ArgumentParser(description="Audit public Workbench/plugin example contracts")
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
