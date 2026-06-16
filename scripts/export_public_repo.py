#!/usr/bin/env python3
"""Build a conservative public repo copy from this private working tree."""

from __future__ import annotations

import argparse
import json
import shutil
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent

COPY_DIRS = [
    "examples",
    "framework",
    "web",
]

COPY_FILES = [
    ".gitignore",
    "LICENSE",
    "core.py",
    "requirements.txt",
    "README.public.md",
    "CHANGELOG.md",
    "pyproject.toml",
    "setup.cfg",
    "docs/ui_use_cases.md",
    "docs/images/dashboard_demo.gif",
    "docs/images/dashboard_overview.png",
    "docs/images/dashboard_performance.png",
    "scripts/demo_dashboard.py",
    ".github/workflows/ci.yml",
    "docs/configuration_privacy.md",
    "docs/web_ui_runbook.md",
    "docs/public_quickstart.md",
    "docs/publication_readiness.md",
    "docs/ibkr_account_setup.md",
    "docs/ibkr_gateway_runbook.md",
    "docs/paper_trading_runbook.md",
    "docs/market_data_permissions_runbook.md",
    "docs/service_restart_runbook.md",
    "docs/failed_order_diagnosis_runbook.md",
    "docs/cloud_monitoring_deployment.md",
    "docs/crypto_history_fetching.md",
    "docs/public_framework_roadmap.md",
    "docs/work_queue.md",
    "docs/public_copy_manifest.md",
    "docs/blog_public_ibkr_harness_draft.md",
    "live/__init__.py",
    "live/broker_adapters.py",
    "live/fetch_manifest.py",
    "live/fetch_history.py",
    "live/fetch_crypto_history.py",
    "live/ibkr_broker.py",
    "live/ibkr_data.py",
    "live/plugin_runner.py",
    "ops/systemd/ibgateway-paper.service",
    "ops/systemd/ibgateway-paper.timer",
    "ops/systemd/algo-trade-plugin-supervisor.service",
    "ops/systemd/algo-trade-status-publisher.service",
    "ops/systemd/algo-trade-status-publisher.timer",
    "ops/systemd/algo-trade-command-worker.service",
    "ops/cloud/status-receiver.Dockerfile.example",
    "ops/cloud/status-receiver.compose.example.yaml",
    "ops/cloud/nginx-status-receiver.example.conf",
    "ops/cloud/caddy-status-receiver.example.Caddyfile",
    "ops/cloud/ufw-status-receiver.example.sh",
    "ops/cloud/aws-security-group-status-receiver.example.tf",
    "ops/cloud/aws-s3-command-audit-retention.example.tf",
    "ops/cloud/azure-blob-command-audit-retention.example.tf",
    "ops/cloud/azure-nsg-status-receiver.example.tf",
    "ops/cloud/digitalocean-firewall-status-receiver.example.tf",
    "ops/cloud/fly-status-receiver.example.toml",
    "ops/cloud/gcp-gcs-command-audit-retention.example.tf",
    "ops/cloud/gcp-firewall-status-receiver.example.tf",
    "ops/cloud/render-status-receiver.example.yaml",
    "ops/cloud/sync-command-audit.example.sh",
    "scripts/audit_data_storage.py",
    "scripts/audit_cloud_examples.py",
    "scripts/audit_dashboard_contracts.py",
    "scripts/audit_public_docs.py",
    "scripts/audit_workbench_contracts.py",
    "scripts/approve_order_preview.py",
    "scripts/build_zerohash_crypto_universe.py",
    "scripts/build_dashboard_gif.py",
    "scripts/build_runtime_status_bridge.py",
    "scripts/cloud_status_server.py",
    "scripts/command_worker.py",
    "scripts/export_public_repo.py",
    "scripts/install_dashboard_server.sh",
    "scripts/install_local_monitoring_stack.sh",
    "scripts/is_us_stock_market_day.py",
    "scripts/plugin_supervisor.py",
    "scripts/public_publish_check.py",
    "scripts/publish_status.py",
    "scripts/public_readiness_audit.py",
    "scripts/smoke_dashboard_accessibility.py",
    "scripts/smoke_dashboard.py",
    "scripts/smoke_dashboard_screenshots.py",
    "scripts/start_ibgateway_paper.sh",
    "scripts/summarize_plugin_run.py",
    "tests/__init__.py",
    "tests/fixtures/__init__.py",
    "tests/fixtures/order_once_plugin.py",
    "tests/fixtures/round_trip_plugin.py",
    "tests/fixtures/validated_plugin.py",
    "tests/test_broker_adapters.py",
    "tests/test_cloud_examples_audit.py",
    "tests/test_dashboard_contract_audit.py",
    "tests/test_cloud_status.py",
    "tests/test_export_public_repo.py",
    "tests/test_fetch_manifest.py",
    "tests/test_example_strategies.py",
    "tests/test_generic_plugin_runner.py",
    "tests/test_market_calendar.py",
    "tests/test_plugin_supervisor.py",
    "tests/test_plugin_run_summary.py",
    "tests/test_public_docs_audit.py",
    "tests/test_workbench_contract_audit.py",
    "tests/test_public_publish_check.py",
    "tests/test_runtime_status_bridge.py",
    "tests/test_strategy_plugin_example.py",
    "tests/test_public_readiness_audit.py",
]

CONFIG_FILES = [
    "config/cloud_status.example.yaml",
    "config/cloud_status_hosted.example.yaml",
    "config/remote_control.example.yaml",
    "config/crypto_paper.example.yaml",
    "config/crypto_universe_example.yaml",
    "config/example_universe.yaml",
    "config/ibgateway_paper.env.example",
    "config/opening_range_breakout.example.yaml",
    "config/plugin_registry.example.yaml",
    "config/plugin_runner.example.yaml",
    "config/plugin_supervisor.example.yaml",
    "config/rsi_mean_reversion.example.yaml",
    "config/sma_crossover.example.yaml",
    "config/stock_paper.example.yaml",
    "config/strategy_registry.example.yaml",
]

CONFIG_GLOBS = [
    "config/example_universe.yaml",
    "config/crypto_universe_example.yaml",
]

EXCLUDE_DIR_NAMES = {
    "__pycache__",
    ".pytest_cache",
}


def excluded_tree_file(path: Path) -> bool:
    if any(part in EXCLUDE_DIR_NAMES for part in path.parts):
        return True
    return path.suffix in {".pyc", ".pyo"}


def iter_tree_files(src: Path) -> list[tuple[Path, Path]]:
    rows: list[tuple[Path, Path]] = []
    for path in sorted(src.rglob("*")):
        if path.is_dir() or excluded_tree_file(path):
            continue
        rows.append((path, path.relative_to(ROOT)))
    return rows


def export_manifest() -> list[tuple[Path, Path]]:
    rows: list[tuple[Path, Path]] = []
    for rel in COPY_DIRS:
        src = ROOT / rel
        assert_exists(src)
        rows.extend(iter_tree_files(src))
    for rel in COPY_FILES:
        if rel == "README.public.md":
            src = public_readme_source()
            dest_rel = Path("README.md")
        else:
            src = ROOT / rel
            dest_rel = Path(rel)
        assert_exists(src)
        rows.append((src, dest_rel))
    for rel in CONFIG_FILES:
        src = ROOT / rel
        assert_exists(src)
        rows.append((src, Path(rel)))
    for pattern in CONFIG_GLOBS:
        for src in sorted(ROOT.glob(pattern)):
            rows.append((src, src.relative_to(ROOT)))
    deduped: dict[str, tuple[Path, Path]] = {}
    for src, dest_rel in rows:
        deduped[dest_rel.as_posix()] = (src, dest_rel)
    return [deduped[key] for key in sorted(deduped)]


def export_manifest_payload() -> dict[str, object]:
    rows = export_manifest()
    top_level_counts: dict[str, int] = {}
    files = []
    for src, dest_rel in rows:
        dest_text = dest_rel.as_posix()
        top_level = dest_rel.parts[0] if dest_rel.parts else dest_text
        top_level_counts[top_level] = top_level_counts.get(top_level, 0) + 1
        files.append({
            "path": dest_text,
            "source": src.relative_to(ROOT).as_posix() if src.is_relative_to(ROOT) else str(src),
            "size_bytes": src.stat().st_size,
        })
    return {
        "schema_version": 1,
        "root": str(ROOT),
        "file_count": len(files),
        "top_level_counts": dict(sorted(top_level_counts.items())),
        "files": files,
    }


def copy_file(src: Path, dest_root: Path, dest_rel: str | None = None) -> None:
    rel = Path(dest_rel) if dest_rel else src.relative_to(ROOT)
    dest = dest_root / rel
    dest.parent.mkdir(parents=True, exist_ok=True)
    shutil.copy2(src, dest)


def copy_tree(src: Path, dest_root: Path) -> None:
    dest = dest_root / src.relative_to(ROOT)
    if dest.exists():
        shutil.rmtree(dest)
    shutil.copytree(
        src,
        dest,
        ignore=shutil.ignore_patterns(*EXCLUDE_DIR_NAMES, "*.pyc", "*.pyo"),
    )


def assert_exists(path: Path) -> None:
    if not path.exists():
        raise FileNotFoundError(path)


def public_readme_source() -> Path:
    private_readme = ROOT / "README.public.md"
    if private_readme.exists():
        return private_readme
    return ROOT / "README.md"


def clear_destination(dest_root: Path) -> None:
    for path in dest_root.iterdir():
        if path.name == ".git":
            continue
        if path.is_dir() and not path.is_symlink():
            shutil.rmtree(path)
        else:
            path.unlink()


def main() -> None:
    parser = argparse.ArgumentParser(description="Export conservative public repo copy")
    parser.add_argument("--dest", default="../algo_trade_public")
    parser.add_argument("--force", action="store_true")
    parser.add_argument(
        "--list",
        action="store_true",
        help="Print destination-relative files included in the public export and exit.",
    )
    parser.add_argument(
        "--json",
        action="store_true",
        help="With --list, print manifest metadata as JSON instead of plain paths.",
    )
    args = parser.parse_args()

    if args.list:
        if args.json:
            print(json.dumps(export_manifest_payload(), indent=2, sort_keys=True))
        else:
            for _src, dest_rel in export_manifest():
                print(dest_rel.as_posix())
        return
    if args.json:
        raise SystemExit("--json is only supported with --list")

    dest_root = (ROOT / args.dest).resolve()
    if dest_root.exists():
        if not args.force:
            raise SystemExit(f"{dest_root} exists; pass --force to replace it")
        clear_destination(dest_root)
    else:
        dest_root.mkdir(parents=True)

    for rel in COPY_DIRS:
        src = ROOT / rel
        assert_exists(src)
        copy_tree(src, dest_root)

    for rel in COPY_FILES:
        if rel == "README.public.md":
            src = public_readme_source()
            assert_exists(src)
            copy_file(src, dest_root, "README.md")
        else:
            src = ROOT / rel
            assert_exists(src)
            copy_file(src, dest_root)

    for rel in CONFIG_FILES:
        src = ROOT / rel
        assert_exists(src)
        copy_file(src, dest_root)

    for pattern in CONFIG_GLOBS:
        for src in sorted(ROOT.glob(pattern)):
            copy_file(src, dest_root)

    print(f"Wrote public repo candidate: {dest_root}")
    print("Next:")
    print(f"  cd {dest_root}")
    print("  python3 scripts/public_readiness_audit.py")
    print("  git init  # only needed for a new destination")
    print("  git status")


if __name__ == "__main__":
    main()
