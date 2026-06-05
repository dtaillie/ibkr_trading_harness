#!/usr/bin/env python3
"""Smoke-test the local workbench dashboard and core public endpoints."""

from __future__ import annotations

import argparse
import json
import sys
import tempfile
import threading
from pathlib import Path
from urllib import parse, request

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.cloud_status_server import DEFAULT_DASHBOARD_DIR, create_server


def write_seed_data(data_root: Path, *, symbol_count: int = 24) -> list[Path]:
    data_root.mkdir(parents=True, exist_ok=True)
    paths: list[Path] = []
    for index in range(symbol_count):
        symbol = f"SYM{index:03d}"
        path = data_root / f"{symbol}_5min_sample.csv"
        base_price = 100 + index
        path.write_text(
            "\n".join(
                [
                    "timestamp,open,high,low,close,volume",
                    f"2026-01-02T14:30:00+00:00,{base_price},{base_price + 1},{base_price - 1},{base_price},1000",
                    f"2026-01-02T14:35:00+00:00,{base_price},{base_price + 2},{base_price - 1},{base_price + 0.5},1100",
                    f"2026-01-02T14:40:00+00:00,{base_price + 0.5},{base_price + 2},{base_price},{base_price + 1},1200",
                ]
            )
            + "\n",
            encoding="utf-8",
        )
        paths.append(path)
    return paths


def write_seed_fetch_manifest(manifest_root: Path, output_path: Path) -> None:
    manifest_root.mkdir(parents=True, exist_ok=True)
    (manifest_root / "seed_stock_history.json").write_text(
        json.dumps(
            {
                "schema_version": 1,
                "job_id": "seed_stock_history",
                "kind": "stock_history",
                "status": "completed",
                "started_at": "2026-01-02T14:30:00+00:00",
                "finished_at": "2026-01-02T14:31:00+00:00",
                "parameters": {"bar_size": "5min", "duration": "1 D", "out_dir": str(output_path.parent)},
                "plan": {"range_start": "2026-01-02", "range_end": "2026-01-02"},
                "symbols_requested": ["SYM000", "SYM001"],
                "symbols": {
                    "SYM000": {
                        "symbol": "SYM000",
                        "status": "ok",
                        "bars": 3,
                        "first_timestamp": "2026-01-02T14:30:00+00:00",
                        "last_timestamp": "2026-01-02T14:40:00+00:00",
                    },
                    "SYM001": {
                        "symbol": "SYM001",
                        "status": "ok",
                        "bars": 3,
                        "first_timestamp": "2026-01-02T14:30:00+00:00",
                        "last_timestamp": "2026-01-02T14:40:00+00:00",
                    },
                },
                "outputs": [
                    {
                        "timestamp": "2026-01-02T14:31:00+00:00",
                        "symbol": "SYM000",
                        "status": "ok",
                        "rows": 3,
                        "path": str(output_path),
                    }
                ],
                "errors": [],
                "events": [],
                "counts": {
                    "requested_symbols": 2,
                    "tracked_symbols": 2,
                    "success_symbols": 2,
                    "failed_symbols": 0,
                    "partial_symbols": 0,
                    "empty_symbols": 0,
                    "skipped_symbols": 0,
                    "outputs": 1,
                    "errors": 0,
                    "rows": 3,
                    "success_chunks": 1,
                    "empty_chunks": 0,
                    "failed_chunks": 0,
                    "status_counts": {"ok": 2},
                    "output_status_counts": {"ok": 1},
                    "error_kind_counts": {},
                },
            },
            sort_keys=True,
        ),
        encoding="utf-8",
    )


def post_seed_status(base_url: str) -> None:
    post_json(
        base_url,
        "/status",
        {
            "schema_version": 1,
            "node_id": "seed-node",
            "status": "ok",
            "generated_at": "2026-01-02T14:45:00+00:00",
            "gateway": {"enabled": True, "reachable": True},
            "runs": [
                {
                    "id": "seed-paper-run",
                    "status": "ok",
                    "metrics": {
                        "mode": "paper",
                        "final_equity": 10123.45,
                        "final_cash": 9123.45,
                        "final_positions": {"SYM000": 2, "SYM001": 0},
                        "account_end_time": "2026-01-02T14:44:00+00:00",
                        "latest_data_time": "2026-01-02T14:44:00+00:00",
                        "last_decision_time": "2026-01-02T14:43:00+00:00",
                        "next_decision_time": "2026-01-02T14:50:00+00:00",
                        "decisions": 3,
                        "orders": 3,
                        "fills": 1,
                        "rejections": 1,
                    },
                    "recent_events": {
                        "decisions": [
                            {"timestamp": "2026-01-02T14:43:00+00:00", "symbol": "SYM000", "status": "selected"}
                        ],
                        "orders": [
                            {"timestamp": "2026-01-02T14:43:01+00:00", "symbol": "SYM000", "status": "Submitted"},
                            {"timestamp": "2026-01-02T14:43:03+00:00", "symbol": "SYM002", "status": "Rejected"},
                        ],
                        "fills": [
                            {"timestamp": "2026-01-02T14:43:02+00:00", "symbol": "SYM000", "status": "filled"}
                        ],
                    },
                },
                {
                    "id": "seed-shadow-run",
                    "status": "warn",
                    "metrics": {
                        "mode": "shadow",
                        "final_equity": 10000.0,
                        "final_cash": 10000.0,
                        "final_positions": {},
                        "last_decision_time": "2026-01-02T14:20:00+00:00",
                        "decisions": 2,
                        "orders": 0,
                        "fills": 0,
                        "rejections": 0,
                    },
                    "recent_events": {
                        "decisions": [
                            {"timestamp": "2026-01-02T14:20:00+00:00", "symbol": "SYM003", "status": "below_threshold"}
                        ]
                    },
                },
            ],
            "alerts": [{"level": "warn", "kind": "seed_warning", "message": "Synthetic warning for seeded smoke"}],
        },
    )


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
    fetch_manifest_roots: list[Path] | None,
    scenario: str = "default",
) -> dict:
    if scenario == "empty":
        empty_data_root = state_dir / "empty_data"
        empty_manifest_root = state_dir / "empty_fetch_manifests"
        empty_data_root.mkdir(parents=True, exist_ok=True)
        empty_manifest_root.mkdir(parents=True, exist_ok=True)
        data_roots = [empty_data_root]
        fetch_manifest_roots = [empty_manifest_root]
    if scenario == "seeded":
        seed_data_root = state_dir / "seed_data"
        seed_manifest_root = state_dir / "seed_fetch_manifests"
        seed_paths = write_seed_data(seed_data_root)
        write_seed_fetch_manifest(seed_manifest_root, seed_paths[0])
        data_roots = [seed_data_root] if data_roots is None else [*data_roots, seed_data_root]
        fetch_manifest_roots = (
            [seed_manifest_root]
            if fetch_manifest_roots is None
            else [*fetch_manifest_roots, seed_manifest_root]
        )
    server = create_server(
        host,
        port,
        state_dir,
        dashboard_dir=dashboard_dir,
        data_roots=data_roots,
        fetch_manifest_roots=fetch_manifest_roots,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base_url = f"http://{host}:{server.server_address[1]}"
        if scenario == "seeded":
            post_seed_status(base_url)
        html = fetch_text(base_url, "/")
        required_controls = [
            "nav-overview",
            "nav-performance",
            "nav-data",
            "nav-fetch",
            "performance-equity",
            "config-form-fields",
            "config-builder-actions",
            "performance-intraday-chart",
            "performance-intraday-pnl",
            "performance-intraday-return",
            "performance-intraday-range",
            "performance-intraday-snapshots",
            "performance-drawdown-chart",
            "performance-daily-return-chart",
            "performance-calendar-chart",
            "performance-benchmark",
            "performance-load-benchmark",
            "performance-benchmark-chart",
            "performance-benchmark-note",
            "performance-source-mode",
            "performance-period",
            "performance-source",
            "performance-mode",
            "performance-context-note",
            "performance-metric-context",
            "performance-latest-account",
            "performance-position-count",
            "performance-activity",
            "performance-trades-body",
            "performance-profit-factor",
            "performance-avg-win-loss",
            "performance-turnover",
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
            "overview-cash",
            "overview-realized-pnl",
            "overview-unrealized-pnl",
            "overview-today-return",
            "overview-week-return",
            "overview-exposure",
            "overview-next-check",
            "data-root-cards",
            "data-home-title",
            "data-home-note",
            "data-home-filtered-count",
            "data-home-best-symbol",
            "data-home-next-step",
            "data-home-breakdown",
            "data-home-clear-filters",
            "data-home-inspect-top",
            "data-home-open-workbench",
            "data-home-open-fetch",
            "data-symbol-count",
            "data-file-count",
            "data-date-range",
            "data-quality-summary",
            "data-library-guide-note",
            "data-library-guide",
            "data-catalog-scan-note",
            "data-catalog-scan-body",
            "data-catalog-limit",
            "export-data-catalog-scan-csv",
            "data-storage-audit-note",
            "data-storage-scan-limit",
            "data-storage-audit-body",
            "data-symbol-browser-input",
            "data-symbol-browser-dataset",
            "data-symbol-browser-matches",
            "data-symbol-browser-compare",
            "data-filter-symbol-options",
            "data-coverage-grid",
            "data-gap-summary-note",
            "data-gap-summary-body",
            "data-calendar-gap-body",
            "data-minute-heatmap-note",
            "data-minute-heatmap-grid",
            "data-minute-heatmap-body",
            "data-minute-date-hour-body",
            "data-symbol-diagnostic-form",
            "data-symbol-candidates-body",
            "data-detail-form",
            "data-detail-symbol",
            "data-detail-symbol-load",
            "data-detail-health",
            "data-detail-viewer-note",
            "data-detail-chart-style",
            "data-detail-timezone",
            "data-missing-intervals-note",
            "data-missing-intervals-body",
            "copy-data-path",
            "copy-data-root-flag",
            "copy-data-replay-command",
            "data-compare-form",
            "data-compare-filter",
            "data-compare-filter-note",
            "data-compare-select-symbol",
            "data-compare-select-shown",
            "data-compare-clear",
            "data-compare-datasets",
            "data-compare-readiness",
            "data-compare-timezone",
            "copy-data-compare-json",
            "export-data-compare-csv",
            "data-compare-chart",
            "data-compare-body",
            "fetch-manifests-body",
            "fetch-filter-text",
            "fetch-filter-status",
            "fetch-filter-kind",
            "fetch-filter-sort",
            "export-fetch-manifests-csv",
            "fetch-jobs-guide-note",
            "fetch-jobs-guide",
            "fetch-detail-summary",
            "fetch-recovery-cards",
            "fetch-events-body",
            "copy-fetch-resume-command",
            "fetch-outputs-body",
            "export-fetch-detail-csv",
            "data-filter-quality",
            "data-filter-asset",
            "data-filter-source",
            "data-filter-sort",
            "Storage",
            "Adjust",
            "export-data-catalog-csv",
            "export-workbench-snapshot",
            "workbench-guide-note",
            "workbench-guide",
            "config-plugin-boundary-note",
            "config-plugin-boundary",
            "config-broker-boundary-note",
            "config-broker-boundary",
            "config-data-quality-note",
            "config-data-quality-body",
            "config-preview-alignment",
            "config-commands",
            "validate-drafts",
            "export-drafts-csv",
            "export-runs-csv",
            "export-run-artifacts-json",
            "comparison-filter-summary",
            "comparison-sort",
            "endpoint-map-body",
            "Page Guide",
            "Inspect Saved Historical Data",
            "Updated",
            "Public Publishing Boundary",
            "Web UI Runbook",
            "doc-link-grid",
            "runtime-status-grid",
            "runtime-status-note",
            "Live/Paper Period Rollups",
            "performance-status-period-rollups-body",
            "performance-status-equity-chart",
            "performance-status-return-chart",
            "export-status-rollups-csv",
            "paper-monitor-note",
            "paper-monitor-guide",
            "remote-nodes-note",
            "remote-node-count",
            "remote-alert-count",
            "remote-open-order-count",
            "export-remote-nodes-csv",
            "remote-filter-text",
            "remote-filter-status",
            "remote-filter-mode",
            "remote-filter-sort",
            "remote-nodes-body",
            "remote-node-detail-note",
            "remote-node-history-body",
            "artifact-session-body",
            "artifact-drilldown-body",
            "artifact-near-threshold-note",
            "artifact-near-threshold-body",
            "artifact-account-body",
            "command-audit-note",
            "command-audit-body",
            "export-command-audit-csv",
            "Signature",
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
            "config_drafts_export",
            "config_draft_validations",
            "config_draft_run_artifacts_export",
            "config_draft_runs_export",
            "plugin_registry_paths",
            "workbench_endpoints",
            "command_audit",
            "command_audit_export",
            "signature_status",
            "row_signature",
            "downloadCommandAuditCsv",
            "data_coverage",
            "data-library-guide",
            "renderDataLibraryGuide",
            "renderDataHome",
            "breakdownChips",
            "data_gap_summary",
            "data_minute_heatmap",
            "data-minute-heatmap-note",
            "data-minute-heatmap-grid",
            "data-minute-heatmap-body",
            "date_hour_rows",
            "data_storage_audit",
            "data_symbol_diagnostic",
            "data_catalog_scan_export",
            "data_detail",
            "data_detail_available",
            "dataDetailHealthCards",
            "bestCatalogDatasetForSymbol",
            "missing_intervals",
            "missing_interval_limit",
            "Replay Readiness",
            "storage_session",
            "adjustment_status",
            "data_compare",
            "compareChart",
            "dataCompareSelectedPaths",
            "dataComparePayload",
            "copyDataCompareJson",
            "selectSymbolCompareDatasets",
            "selectShownCompareDatasets",
            "compareSelectedSymbolDatasets",
            "dataCompareReadinessCards",
            "Comparison Readiness",
            "fetch_manifests",
            "fetch_manifests_export",
            "fetch_manifest_detail",
            "fetch_manifest_detail_export",
            "filteredFetchManifests",
            "renderFetchJobsGuide",
            "Load Jobs",
            "Open Saved Data",
            "fetchRecoveryCards",
            "fetchOutputVisibilityLabel",
            "output_visibility_counts",
            "fetchResumeCommand",
            "downloadFetchManifestsCsv",
            "downloadFetchDetailCsv",
            "live/fetch_history.py --resume-manifest",
            "Symbol Coverage",
            "Data Visibility",
            "renderFetchFilterOptions",
            "Fetch output data detail failed",
            "drawdownChart",
            "intradayPnlChart",
            "renderConfigFormSchema",
            "CONFIG_SECTION_LABELS",
            "config-field-section",
            "dailyReturnChart",
            "calendarReturnHeatmap",
            "buildTradeLedger",
            "performancePeriodWindow",
            "renderPerformanceRollups",
            "renderPerformancePeriodRollups",
            "artifactSessionRows",
            "strategyDrilldownRows",
            "nearThresholdMissRows",
            "artifactChartMarkers",
            "chart-marker",
            "marker-legend",
            "entry-marker",
            "exit-marker",
            "artifact-drilldown-note",
            "artifact-account-note",
            "benchmarkOverlayChart",
            "loadPerformanceBenchmark",
            "config_draft_daily_rollups",
            "activityChanges",
            "renderOverviewChanges",
            "runtimeStatusItems",
            "renderRuntimeStatus",
            "renderCurrentOrdersAndPositions",
            "renderDataCatalogScanDiagnostics",
            "jsonDrilldown",
            "root_summaries",
            "currentOpenOrderRows",
            "viewFromHash",
            "navigateToView",
            "copy-command",
            "copy-data-path-row",
            "replayStarterCommand",
            "shellQuote",
            "copyText",
            "risk_presets",
            "renderConfigDataQuality",
            "quality_warning_count",
            "allow_quality_warnings",
            "formatTimestampForMode",
            "timeRangeLabel",
            "projectionCaveat",
            "modeMeaning",
            "sourceMeaning",
            "setMetricValue",
            "sourceMetaLabel",
            "metric-source",
            "turnoverStats",
            "fillNotional",
            "renderWorkbenchGuide",
            "latestWorkbenchRunForDraft",
            "renderConfigPluginBoundary",
            "renderConfigBrokerBoundary",
            "broker_adapters",
            "selectedConfigPlugin",
            "configDateRangePayload",
            "Filter Range",
            "open-run-performance",
            "open-draft-performance",
            "Run results opened",
            "paperMonitorItems",
            "renderPaperMonitor",
            "Order Context",
            "remote_nodes",
            "remote_nodes_export",
            "remote_node_detail",
            "status_equity_rollups",
            "status_equity_rollups_export",
            "statusRollupEquityChart",
            "statusRollupReturnChart",
            "performance-status-period-rollups-body",
            "filteredRemoteNodes",
            "renderRemoteNodeFilterOptions",
            "renderRemoteNodes",
            "renderRemoteNodeDetail",
            "inspect-remote-node",
            "No cloud monitoring snapshots yet",
            "status_label",
            "draft.folder",
            "draft.tags",
            "downloadDraftsCsv",
            "Save a generated draft locally",
            "No saved drafts yet",
            "No draft runs yet",
            "Preview Alignment before generating",
        ]
        missing_js_tokens = [token for token in required_js_tokens if token not in js]
        if missing_js_tokens:
            raise RuntimeError(f"dashboard JS tokens missing: {', '.join(missing_js_tokens)}")

        catalog_limit = 50 if scenario == "seeded" else 5
        coverage_symbol_limit = 50 if scenario == "seeded" else 10
        catalog = fetch_json(base_url, f"/data_catalog?limit={catalog_limit}&preview_points=3")
        data_catalog_csv = fetch_text(base_url, f"/data_catalog_export?limit={catalog_limit}")
        data_catalog_scan_csv = fetch_text(base_url, f"/data_catalog_scan_export?limit={catalog_limit}")
        diagnostics = fetch_json(base_url, "/workbench_diagnostics")
        endpoint_map = fetch_json(base_url, "/workbench_endpoints")
        web_ui_runbook = fetch_text(base_url, "/docs/web_ui_runbook.md")
        cleanup_plan = fetch_json(base_url, "/workbench_cleanup_plan")
        snapshot = json.loads(fetch_text(base_url, "/workbench_snapshot_export"))
        options = fetch_json(base_url, "/config_options")
        draft_validations = fetch_json(base_url, "/config_draft_validations")

        if "quality_counts" not in catalog or "bar_size_counts" not in catalog:
            raise RuntimeError("data catalog aggregate fields are missing")
        coverage = fetch_json(base_url, f"/data_coverage?limit={catalog_limit}&max_symbols={coverage_symbol_limit}&max_dates=20")
        if "date_bins" not in coverage or "symbols" not in coverage:
            raise RuntimeError("data coverage summary is invalid")
        coverage_csv = fetch_text(base_url, f"/data_coverage_export?limit={catalog_limit}&max_symbols={coverage_symbol_limit}&max_dates=20")
        if "symbol,asset_class,sources,bar_sizes" not in coverage_csv:
            raise RuntimeError("data coverage CSV header is missing")
        gap_summary = fetch_json(base_url, f"/data_gap_summary?catalog_limit={catalog_limit}&top_limit=10")
        if "gap_rows" not in gap_summary or "calendar_rows" not in gap_summary:
            raise RuntimeError("data gap summary is invalid")
        gap_summary_csv = fetch_text(base_url, f"/data_gap_summary_export?catalog_limit={catalog_limit}&top_limit=10")
        if "row_type,symbol,asset_class" not in gap_summary_csv:
            raise RuntimeError("data gap summary CSV header is missing")
        minute_heatmap_csv = fetch_text(base_url, f"/data_minute_heatmap_export?catalog_limit={catalog_limit}&top_limit=10")
        if "row_type,symbol,asset_class" not in minute_heatmap_csv:
            raise RuntimeError("data minute heatmap CSV header is missing")
        storage_audit = fetch_json(base_url, f"/data_storage_audit?catalog_limit={catalog_limit}&scan_limit=100")
        if "configured_roots" not in storage_audit or "catalog_visible_count" not in storage_audit:
            raise RuntimeError("data storage audit summary is invalid")
        storage_audit_csv = fetch_text(base_url, f"/data_storage_audit_export?catalog_limit={catalog_limit}&scan_limit=100")
        if "scope,path,display_path" not in storage_audit_csv:
            raise RuntimeError("data storage audit CSV header is missing")
        csv_header = data_catalog_csv.splitlines()[0]
        for field in ("quality_status", "asset_class", "source"):
            if field not in csv_header:
                raise RuntimeError(f"data catalog CSV header is missing {field}")
        if "row_type,path,display_path" not in data_catalog_scan_csv:
            raise RuntimeError("data catalog scan CSV header is missing")
        if not options.get("risk_presets"):
            raise RuntimeError("config options risk presets are missing")
        broker_adapters = {item.get("id"): item for item in options.get("broker_adapters") or []}
        if set(broker_adapters) != {"ibkr", "file"}:
            raise RuntimeError("config options broker adapter capabilities are missing")
        if not broker_adapters["ibkr"].get("requires_gateway") or not broker_adapters["file"].get("requires_static_prices"):
            raise RuntimeError("config options broker adapter requirements are incomplete")
        if options.get("config_schema_version") != 1 or options.get("form_schema_version") != 2:
            raise RuntimeError("config options schema versions are missing")
        form_field_ids = {field.get("id") for field in options.get("form_schema") or []}
        for field_id in ("config-name", "config-plugin", "config-mode", "config-dataset", "config-risk-preset", "config-plugin-field-no-edge-template-example-parameter", "config-allow-quality-warnings"):
            if field_id not in form_field_ids:
                raise RuntimeError(f"config form schema is missing {field_id}")
        if not all(plugin.get("visibility") and plugin.get("boundary") for plugin in options.get("plugins") or []):
            raise RuntimeError("config plugin boundary metadata is missing")
        if "valid_count" not in draft_validations or "invalid_count" not in draft_validations:
            raise RuntimeError("draft validation summary is missing")
        if diagnostics.get("status") not in {"ok", "warn", "bad"}:
            raise RuntimeError("diagnostics status is invalid")
        endpoint_paths = {(item.get("method"), item.get("path")) for item in endpoint_map.get("endpoints") or []}
        if ("GET", "/workbench_snapshot_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing workbench_snapshot_export")
        if ("GET", "/status_equity_rollups_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing status_equity_rollups_export")
        if ("GET", "/remote_nodes_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing remote_nodes_export")
        if ("GET", "/command_audit_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing command_audit_export")
        if ("GET", "/fetch_manifests") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing fetch_manifests")
        if ("GET", "/fetch_manifests_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing fetch_manifests_export")
        if ("GET", "/fetch_manifest_detail_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing fetch_manifest_detail_export")
        if ("GET", "/data_symbol_diagnostic") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_symbol_diagnostic")
        if ("GET", "/data_coverage_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_coverage_export")
        if ("GET", "/data_gap_summary") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_gap_summary")
        if ("GET", "/data_gap_summary_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_gap_summary_export")
        if ("GET", "/data_missing_intervals_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_missing_intervals_export")
        if ("GET", "/data_minute_heatmap_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_minute_heatmap_export")
        if ("GET", "/data_storage_audit") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_storage_audit")
        if ("GET", "/data_storage_audit_export") not in endpoint_paths:
            raise RuntimeError("endpoint map is missing data_storage_audit_export")
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
        if snapshot.get("config_schema_version") != 1 or snapshot.get("form_schema_version") != 2:
            raise RuntimeError("workbench snapshot schema versions are missing")
        fetch_manifests = fetch_json(base_url, "/fetch_manifests?limit=5")
        fetch_manifests_csv = fetch_text(base_url, "/fetch_manifests_export?limit=5")
        if "manifests" not in fetch_manifests or "roots" not in fetch_manifests:
            raise RuntimeError("fetch manifest summary is invalid")
        if "job_id,kind,status" not in fetch_manifests_csv:
            raise RuntimeError("fetch manifests CSV header is missing")
        first_fetch_job = None
        if fetch_manifests.get("manifests"):
            first_fetch_job = str((fetch_manifests["manifests"][0] or {}).get("job_id") or "")
        if first_fetch_job:
            fetch_detail_csv = fetch_text(
                base_url,
                f"/fetch_manifest_detail_export?job_id={parse.quote(first_fetch_job)}&limit=20",
            )
            if "row_type,job_id,kind,status" not in fetch_detail_csv or "output" not in fetch_detail_csv:
                raise RuntimeError("fetch detail CSV export is invalid")
        daily_rollups = fetch_json(base_url, "/config_draft_daily_rollups?limit=5&run_limit=5")
        if "rollups" not in daily_rollups or "total" not in daily_rollups or "period_rollups" not in daily_rollups:
            raise RuntimeError("daily rollup summary is invalid")
        status_rollups_csv = fetch_text(base_url, "/status_equity_rollups_export?limit=5&history_limit=100")
        if "row_type,label,day,node_id" not in status_rollups_csv:
            raise RuntimeError("status equity rollup CSV header is missing")
        command_audit_csv = fetch_text(base_url, "/command_audit_export?limit=5")
        if "audited_at,event,node_id,command_id" not in command_audit_csv:
            raise RuntimeError("command audit CSV header is missing")
        scenario_checks = {}
        if scenario == "empty":
            if catalog.get("count") != 0:
                raise RuntimeError("empty scenario unexpectedly returned catalog rows")
            if coverage.get("count") != 0:
                raise RuntimeError("empty scenario unexpectedly returned coverage rows")
            if fetch_manifests.get("count") != 0:
                raise RuntimeError("empty scenario unexpectedly returned fetch manifests")
            if storage_audit.get("catalog_visible_count") != 0 or storage_audit.get("configured_file_count") != 0:
                raise RuntimeError("empty scenario storage audit unexpectedly found files")
            scenario_checks = {"empty_state": True}
        elif scenario == "seeded":
            remote_nodes = fetch_json(base_url, "/remote_nodes?limit=5")
            status_payload = fetch_json(base_url, "/status")
            if catalog.get("count", 0) < 20:
                raise RuntimeError("seeded scenario did not expose the synthetic catalog")
            if coverage.get("count", 0) < 20:
                raise RuntimeError("seeded scenario did not expose synthetic coverage")
            if fetch_manifests.get("count", 0) < 1:
                raise RuntimeError("seeded scenario did not expose the synthetic fetch manifest")
            if storage_audit.get("catalog_visible_count", 0) < 20:
                raise RuntimeError("seeded scenario storage audit missed synthetic files")
            if status_payload.get("node_id") != "seed-node":
                raise RuntimeError("seeded scenario status snapshot was not served")
            if not remote_nodes.get("nodes") or remote_nodes["nodes"][0].get("node_id") != "seed-node":
                raise RuntimeError("seeded scenario remote node summary was not served")
            remote_nodes_csv = fetch_text(base_url, "/remote_nodes_export?limit=5")
            if "node_id,status,generated_at,received_at" not in remote_nodes_csv or "seed-node" not in remote_nodes_csv:
                raise RuntimeError("seeded scenario remote nodes CSV export is invalid")
            node = remote_nodes["nodes"][0]
            if node.get("alert_count", 0) < 1 or node.get("rejection_count", 0) < 1:
                raise RuntimeError("seeded scenario did not expose warning/rejection telemetry")
            if len(status_payload.get("runs") or []) < 2:
                raise RuntimeError("seeded scenario did not expose multiple runs")
            scenario_checks = {
                "seeded_state": True,
                "remote_node_count": remote_nodes.get("count", 0),
            }

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
            if "missing_intervals" not in detail or "missing_interval_limit" not in detail:
                raise RuntimeError("data detail missing-interval drilldown payload is invalid")
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
            "broker_adapter_count": len(options.get("broker_adapters") or []),
            "draft_validation_count": draft_validations.get("count", 0),
            "alignment_dataset_count": alignment_count,
            "compare_dataset_count": compare_count,
            "scenario": scenario,
            **scenario_checks,
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
    parser.add_argument("--fetch-manifest-root", action="append", type=Path, default=None)
    parser.add_argument(
        "--scenario",
        choices=("default", "empty", "seeded"),
        default="default",
        help="State fixture to exercise: default examples, no data, or seeded many-symbol data.",
    )
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
                fetch_manifest_roots=args.fetch_manifest_root,
                scenario=args.scenario,
            )
    else:
        result = run_smoke(
            host=args.host,
            port=args.port,
            state_dir=args.state_dir,
            dashboard_dir=args.dashboard_dir,
            data_roots=args.data_root,
            fetch_manifest_roots=args.fetch_manifest_root,
            scenario=args.scenario,
        )

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(
            "Dashboard smoke OK: "
            f"{result['base_url']} "
            f"scenario={result['scenario']} "
            f"datasets={result['catalog_count']} "
            f"diagnostics={result['diagnostics_status']} "
            f"risk_presets={result['risk_preset_count']} "
            f"broker_adapters={result['broker_adapter_count']}"
        )


def test_dashboard_smoke_empty_and_seeded_scenarios() -> None:
    for scenario in ("empty", "seeded"):
        with tempfile.TemporaryDirectory(prefix=f"algo_trade_dashboard_{scenario}_smoke_") as tmp:
            result = run_smoke(
                host="127.0.0.1",
                port=0,
                state_dir=Path(tmp),
                dashboard_dir=DEFAULT_DASHBOARD_DIR,
                data_roots=None,
                fetch_manifest_roots=None,
                scenario=scenario,
            )
        assert result["scenario"] == scenario
        assert result[f"{scenario}_state"] is True


if __name__ == "__main__":
    main()
