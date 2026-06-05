#!/usr/bin/env python3
"""Build a conservative public repo copy from this private working tree."""

from __future__ import annotations

import argparse
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
    "core.py",
    "requirements.txt",
    "README.public.md",
    ".github/workflows/ci.yml",
    "docs/configuration_privacy.md",
    "docs/web_ui_runbook.md",
    "docs/public_quickstart.md",
    "docs/publication_readiness.md",
    "docs/public_framework_roadmap.md",
    "docs/work_queue.md",
    "docs/public_copy_manifest.md",
    "docs/blog_public_ibkr_harness_draft.md",
    "live/__init__.py",
    "live/fetch_manifest.py",
    "live/fetch_history.py",
    "live/fetch_crypto_history.py",
    "live/ibkr_broker.py",
    "live/ibkr_data.py",
    "live/plugin_runner.py",
    "ops/systemd/ibgateway-paper.service",
    "ops/systemd/ibgateway-paper.timer",
    "scripts/audit_data_storage.py",
    "scripts/build_zerohash_crypto_universe.py",
    "scripts/cloud_status_server.py",
    "scripts/command_worker.py",
    "scripts/export_public_repo.py",
    "scripts/is_us_stock_market_day.py",
    "scripts/plugin_supervisor.py",
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
    "tests/test_cloud_status.py",
    "tests/test_export_public_repo.py",
    "tests/test_fetch_manifest.py",
    "tests/test_generic_plugin_runner.py",
    "tests/test_market_calendar.py",
    "tests/test_plugin_supervisor.py",
    "tests/test_plugin_run_summary.py",
    "tests/test_strategy_plugin_example.py",
    "tests/test_public_readiness_audit.py",
]

CONFIG_FILES = [
    "config/cloud_status.example.yaml",
    "config/remote_control.example.yaml",
    "config/crypto_paper.example.yaml",
    "config/crypto_universe_example.yaml",
    "config/example_universe.yaml",
    "config/ibgateway_paper.env.example",
    "config/plugin_runner.example.yaml",
    "config/plugin_supervisor.example.yaml",
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
    args = parser.parse_args()

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
