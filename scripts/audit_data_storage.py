#!/usr/bin/env python3
"""Audit local saved-data roots from the command line."""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.cloud_status_server import (  # noqa: E402
    build_data_storage_audit,
    dashboard_server_settings,
    parse_data_roots,
)


def count_summary(counts: dict[str, int] | None) -> str:
    if not counts:
        return "none"
    return " ".join(f"{key}:{value}" for key, value in sorted(counts.items()))


def format_bytes(value: Any) -> str:
    try:
        number = float(value)
    except (TypeError, ValueError):
        return "n/a"
    if number < 1024:
        return f"{int(number)} B"
    if number < 1024 * 1024:
        return f"{number / 1024:.1f} KB"
    if number < 1024 * 1024 * 1024:
        return f"{number / 1024 / 1024:.1f} MB"
    return f"{number / 1024 / 1024 / 1024:.1f} GB"


def human_report(audit: dict[str, Any]) -> str:
    lines = [
        f"Storage Audit: {audit.get('status', 'unknown')}",
        f"Generated: {audit.get('generated_at', 'n/a')}",
        (
            "Configured files: "
            f"{audit.get('configured_file_count', 0)} "
            f"({audit.get('configured_visible_count', 0)} catalog-visible, "
            f"{audit.get('hidden_configured_file_count', 0)} hidden at current limit)"
        ),
        f"Suggested-root files: {audit.get('suggested_file_count', 0)}",
        (
            f"Catalog limit: {audit.get('catalog_limit', 'n/a')} | "
            f"Scan limit/root: {audit.get('scan_limit', 'n/a')} | "
            f"Scan time: {audit.get('scan_duration_ms_total', 'n/a')} ms"
        ),
        f"Extensions: {count_summary(audit.get('extension_counts'))}",
        f"Assets: {count_summary(audit.get('asset_class_guess_counts'))}",
        f"Sources: {count_summary(audit.get('source_guess_counts'))}",
        f"Bar sizes: {count_summary(audit.get('bar_size_guess_counts'))}",
        f"Storage sessions: {count_summary(audit.get('storage_session_guess_counts'))}",
    ]
    warnings = audit.get("warnings") or []
    if warnings:
        lines.append("")
        lines.append("Warnings:")
        lines.extend(f"- {warning}" for warning in warnings)

    root_rows = [
        ("configured", row)
        for row in audit.get("configured_roots") or []
    ] + [
        ("suggested", row)
        for row in audit.get("suggested_roots") or []
    ]
    lines.append("")
    lines.append("Roots:")
    if not root_rows:
        lines.append("- none")
    for scope, row in root_rows:
        lines.append(
            f"- {scope}: {row.get('display_path') or row.get('path')} "
            f"files={row.get('file_count', 0)} "
            f"visible={row.get('catalog_visible_count', 0)} "
            f"hidden={row.get('hidden_file_count', 0)} "
            f"size={format_bytes(row.get('size_bytes'))} "
            f"scan_ms={row.get('scan_duration_ms', 'n/a')}"
            f"{' capped' if row.get('scan_capped') else ''}"
        )
        lines.append(f"  extensions: {count_summary(row.get('extension_counts'))}")
        lines.append(f"  assets: {count_summary(row.get('asset_class_guess_counts'))}")
        lines.append(f"  sources: {count_summary(row.get('source_guess_counts'))}")
        lines.append(f"  bars: {count_summary(row.get('bar_size_guess_counts'))}")
        lines.append(f"  sessions: {count_summary(row.get('storage_session_guess_counts'))}")
        hidden = row.get("sample_hidden_paths") or []
        if hidden:
            lines.append("  sample hidden:")
            lines.extend(f"  - {path}" for path in hidden[:5])
        errors = row.get("errors") or []
        if errors:
            lines.append("  scan errors:")
            lines.extend(f"  - {item.get('path')}: {item.get('error')}" for item in errors[:5])

    recommendations = []
    if audit.get("suggested_file_count"):
        recommendations.append("Add suggested roots with --data-root or dashboard.data_roots in a local config.")
    if audit.get("hidden_configured_file_count"):
        recommendations.append("Increase --catalog-limit, narrow roots, or inspect catalog parse errors.")
    if audit.get("catalog_error_count"):
        recommendations.append("Open the dashboard Data Library or export the catalog to inspect malformed files.")
    if recommendations:
        lines.append("")
        lines.append("Recommended next steps:")
        lines.extend(f"- {item}" for item in recommendations)
    return "\n".join(lines)


def run(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Audit local CSV/parquet saved-data roots")
    parser.add_argument("--config", type=Path, default=None, help="Optional dashboard config with dashboard.data_roots")
    parser.add_argument("--data-root", action="append", type=Path, default=None, help="Data root to scan. Can be repeated.")
    parser.add_argument("--catalog-limit", type=int, default=200, help="Catalog rows to parse for visibility comparison")
    parser.add_argument("--scan-limit", type=int, default=5000, help="Maximum CSV/parquet files to count per root")
    parser.add_argument("--json", action="store_true", help="Print JSON instead of a text report")
    parser.add_argument("--fail-on-warn", action="store_true", help="Exit nonzero when audit status is warn or bad")
    parser.add_argument("--fail-on-bad", action="store_true", help="Exit nonzero when audit status is bad")
    args = parser.parse_args(argv)

    settings = dashboard_server_settings(
        args.config,
        data_roots=args.data_root if args.data_root else None,
    )
    data_roots = parse_data_roots(settings["data_roots"])
    audit = build_data_storage_audit(
        data_roots,
        catalog_limit=args.catalog_limit,
        scan_limit=args.scan_limit,
    )
    if args.json:
        print(json.dumps(audit, indent=2, sort_keys=True))
    else:
        print(human_report(audit))

    status = str(audit.get("status") or "")
    if args.fail_on_warn and status in {"warn", "bad"}:
        return 2
    if args.fail_on_bad and status == "bad":
        return 2
    return 0


def main() -> None:
    raise SystemExit(run())


if __name__ == "__main__":
    main()
