#!/usr/bin/env python3
"""Smoke-test the local workbench dashboard and core public endpoints."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import threading
from pathlib import Path
from urllib import request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.cloud_status_server import DEFAULT_DASHBOARD_DIR, create_server


def fetch_text(base_url: str, path: str) -> str:
    with request.urlopen(f"{base_url}{path}", timeout=5) as resp:
        return resp.read().decode("utf-8")


def fetch_json(base_url: str, path: str) -> dict:
    return json.loads(fetch_text(base_url, path))


def post_json(base_url: str, path: str, payload: dict) -> dict:
    req = request.Request(
        f"{base_url}{path}",
        data=json.dumps(payload).encode("utf-8"),
        headers={"Content-Type": "application/json"},
        method="POST",
    )
    with request.urlopen(req, timeout=5) as resp:
        return json.loads(resp.read().decode("utf-8"))


def run_smoke(
    *,
    host: str,
    port: int,
    state_dir: Path,
    dashboard_dir: Path,
    data_roots: list[Path] | None,
) -> dict:
    server = create_server(
        host,
        port,
        state_dir,
        dashboard_dir=dashboard_dir,
        data_roots=data_roots,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base_url = f"http://{host}:{server.server_address[1]}"
        html = fetch_text(base_url, "/")
        required_controls = [
            "nav-overview",
            "nav-performance",
            "nav-data",
            "nav-fetch",
            "performance-equity",
            "performance-drawdown-chart",
            "performance-daily-return-chart",
            "performance-calendar-chart",
            "performance-period",
            "performance-source",
            "performance-mode",
            "performance-latest-account",
            "performance-position-count",
            "performance-activity",
            "performance-trades-body",
            "performance-profit-factor",
            "performance-avg-win-loss",
            "performance-rollups-note",
            "performance-rollups-body",
            "performance-period-rollups-note",
            "performance-period-rollups-body",
            "comparison-filter-text",
            "current-orders-body",
            "current-positions-grid",
            "overview-health-grid",
            "overview-positions-grid",
            "overview-change-cards",
            "overview-changes-note",
            "overview-timeline-body",
            "data-root-cards",
            "data-catalog-limit",
            "data-storage-audit-note",
            "data-storage-audit-body",
            "data-coverage-grid",
            "data-symbol-diagnostic-form",
            "data-symbol-candidates-body",
            "data-detail-form",
            "data-detail-viewer-note",
            "copy-data-path",
            "copy-data-root-flag",
            "copy-data-replay-command",
            "data-compare-form",
            "data-compare-datasets",
            "data-compare-chart",
            "data-compare-body",
            "fetch-manifests-body",
            "fetch-detail-summary",
            "fetch-outputs-body",
            "data-filter-quality",
            "data-filter-asset",
            "data-filter-source",
            "export-data-catalog-csv",
            "export-workbench-snapshot",
            "config-preview-alignment",
            "config-commands",
            "validate-drafts",
            "export-runs-csv",
            "export-run-artifacts-json",
            "comparison-filter-summary",
            "comparison-sort",
            "endpoint-map-body",
            "Page Guide",
            "Inspect Saved Historical Data",
            "Public Publishing Boundary",
            "Web UI Runbook",
            "doc-link-grid",
            "runtime-status-grid",
            "runtime-status-note",
            "diagnostics-note",
            "cleanup-apply",
        ]
        missing_controls = [control for control in required_controls if control not in html]
        if missing_controls:
            raise RuntimeError(f"dashboard controls missing: {', '.join(missing_controls)}")
        js = fetch_text(base_url, "/dashboard/app.js")
        required_js_tokens = [
            "config_draft_yaml",
            "download-draft-yaml",
            "config_draft_validations",
            "config_draft_run_artifacts_export",
            "config_draft_runs_export",
            "workbench_endpoints",
            "data_coverage",
            "data_storage_audit",
            "data_symbol_diagnostic",
            "data_detail",
            "data_detail_available",
            "data_compare",
            "compareChart",
            "fetch_manifests",
            "fetch_manifest_detail",
            "Fetch output data detail failed",
            "drawdownChart",
            "dailyReturnChart",
            "calendarReturnHeatmap",
            "buildTradeLedger",
            "performancePeriodWindow",
            "renderPerformanceRollups",
            "renderPerformancePeriodRollups",
            "config_draft_daily_rollups",
            "activityChanges",
            "renderOverviewChanges",
            "runtimeStatusItems",
            "renderRuntimeStatus",
            "renderCurrentOrdersAndPositions",
            "currentOpenOrderRows",
            "viewFromHash",
            "navigateToView",
            "copy-command",
            "copy-data-path-row",
            "replayStarterCommand",
            "shellQuote",
            "copyText",
            "risk_presets",
        ]
        missing_js_tokens = [token for token in required_js_tokens if token not in js]
        if missing_js_tokens:
            raise RuntimeError(f"dashboard JS tokens missing: {', '.join(missing_js_tokens)}")

        catalog = fetch_json(base_url, "/data_catalog?limit=5&preview_points=3")
        data_catalog_csv = fetch_text(base_url, "/data_catalog_export?limit=5")
        diagnostics = fetch_json(base_url, "/workbench_diagnostics")
        endpoint_map = fetch_json(base_url, "/workbench_endpoints")
        web_ui_runbook = fetch_text(base_url, "/docs/web_ui_runbook.md")
        cleanup_plan = fetch_json(base_url, "/workbench_cleanup_plan")
        snapshot = json.loads(fetch_text(base_url, "/workbench_snapshot_export"))
        options = fetch_json(base_url, "/config_options")
        draft_validations = fetch_json(base_url, "/config_draft_validations")

        if "quality_counts" not in catalog or "bar_size_counts" not in catalog:
            raise RuntimeError("data catalog aggregate fields are missing")
        coverage = fetch_json(base_url, "/data_coverage?limit=5&max_symbols=10&max_dates=20")
        if "date_bins" not in coverage or "symbols" not in coverage:
            raise RuntimeError("data coverage summary is invalid")
        storage_audit = fetch_json(base_url, "/data_storage_audit?catalog_limit=5&scan_limit=100")
        if "configured_roots" not in storage_audit or "catalog_visible_count" not in storage_audit:
            raise RuntimeError("data storage audit summary is invalid")
        csv_header = data_catalog_csv.splitlines()[0]
        for field in ("quality_status", "asset_class", "source"):
            if field not in csv_header:
                raise RuntimeError(f"data catalog CSV header is missing {field}")
        if not options.get("risk_presets"):
            raise RuntimeError("config options risk presets are missing")
        if "valid_count" not in draft_validations or "invalid_count" not in draft_validations:
            raise RuntimeError("draft validation summary is missing")
        if diagnostics.get("status") not in {"ok", "warn", "bad"}:
            raise RuntimeError("diagnostics status is invalid")
        endpoint_paths = {(item.get("method"), item.get("path")) for item in endpoint_map.get("endpoints") or []}
        if ("GET", "/workbench_snapshot_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing workbench_snapshot_export")
        if ("GET", "/fetch_manifests") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing fetch_manifests")
        if ("GET", "/data_symbol_diagnostic") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_symbol_diagnostic")
        if ("GET", "/data_storage_audit") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_storage_audit")
        if ("POST", "/data_compare") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_compare")
        if ("GET", "/config_draft_daily_rollups") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing config_draft_daily_rollups")
        if ("GET", "/docs/{name}") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing docs endpoint")
        if "Web UI Runbook" not in web_ui_runbook:
            raise RuntimeError("web UI runbook doc is not served")
        if "reclaimable_bytes" not in cleanup_plan:
            raise RuntimeError("cleanup plan reclaimable_bytes is missing")
        if snapshot.get("schema_version") != 1 or "data_catalog" not in snapshot or "fetch_manifests" not in snapshot:
            raise RuntimeError("workbench snapshot export is invalid")
        fetch_manifests = fetch_json(base_url, "/fetch_manifests?limit=5")
        if "manifests" not in fetch_manifests or "roots" not in fetch_manifests:
            raise RuntimeError("fetch manifest summary is invalid")
        daily_rollups = fetch_json(base_url, "/config_draft_daily_rollups?limit=5&run_limit=5")
        if "rollups" not in daily_rollups or "total" not in daily_rollups or "period_rollups" not in daily_rollups:
            raise RuntimeError("daily rollup summary is invalid")

        alignment_count = 0
        compare_count = 0
        datasets = catalog.get("datasets") or []
        if datasets:
            detail = fetch_json(
                base_url,
                f"/data_detail?path={datasets[0]['path']}&preview_points=3&sample_mode=sampled",
            )
            if "viewer" not in detail or "preview" not in detail:
                raise RuntimeError("data detail viewer payload is invalid")
            diagnostic = fetch_json(base_url, f"/data_symbol_diagnostic?symbol={datasets[0]['symbol']}&limit=5")
            if diagnostic.get("status") != "visible":
                raise RuntimeError("symbol diagnostic did not find the sample dataset")
            alignment = post_json(
                base_url,
                "/data_alignment",
                {"datasets": [{"symbol": datasets[0]["symbol"], "path": datasets[0]["path"]}]},
            )
            alignment_count = int((alignment.get("alignment") or {}).get("dataset_count") or 0)
            if len(datasets) >= 2:
                comparison = post_json(
                    base_url,
                    "/data_compare",
                    {
                        "datasets": [
                            {"symbol": datasets[0]["symbol"], "path": datasets[0]["path"]},
                            {"symbol": datasets[1]["symbol"], "path": datasets[1]["path"]},
                        ],
                        "preview_points": 3,
                    },
                )
                compare_count = int((comparison.get("comparison") or {}).get("dataset_count") or 0)

        return {
            "base_url": base_url,
            "catalog_count": catalog.get("count", 0),
            "coverage_symbol_count": coverage.get("count", 0),
            "storage_audit_status": storage_audit.get("status"),
            "diagnostics_status": diagnostics.get("status"),
            "endpoint_count": endpoint_map.get("count", 0),
            "fetch_manifest_count": fetch_manifests.get("count", 0),
            "daily_rollup_count": daily_rollups.get("count", 0),
            "cleanup_reclaimable_bytes": cleanup_plan.get("reclaimable_bytes", 0),
            "risk_preset_count": len(options.get("risk_presets") or []),
            "draft_validation_count": draft_validations.get("count", 0),
            "alignment_dataset_count": alignment_count,
            "compare_dataset_count": compare_count,
        }
    finally:
        server.shutdown()
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Smoke-test the local dashboard endpoints")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--state-dir", type=Path, default=None)
    parser.add_argument("--dashboard-dir", type=Path, default=DEFAULT_DASHBOARD_DIR)
    parser.add_argument("--data-root", action="append", type=Path, default=None)
    parser.add_argument("--json", action="store_true", help="Print machine-readable JSON")
    args = parser.parse_args()

    if args.state_dir is None:
        with tempfile.TemporaryDirectory(prefix="algo_trade_dashboard_smoke_") as tmp:
            result = run_smoke(
                host=args.host,
                port=args.port,
                state_dir=Path(tmp),
                dashboard_dir=args.dashboard_dir,
                data_roots=args.data_root,
            )
    else:
        result = run_smoke(
            host=args.host,
            port=args.port,
            state_dir=args.state_dir,
            dashboard_dir=args.dashboard_dir,
            data_roots=args.data_root,
        )

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(
            "Dashboard smoke OK: "
            f"{result['base_url']} "
            f"datasets={result['catalog_count']} "
            f"diagnostics={result['diagnostics_status']} "
            f"risk_presets={result['risk_preset_count']}"
        )


if __name__ == "__main__":
    main()
