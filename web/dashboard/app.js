// Dashboard runtime is split into ordered classic-script chunks under /dashboard/app/.
// Keep this small compatibility file for legacy probes that request /dashboard/app.js.
window.dashboardAppChunks = [
  "/dashboard/app/00_core.js",
  "/dashboard/app/10_help.js",
  "/dashboard/app/20_workbench_foundation.js",
  "/dashboard/app/30_runtime_core.js",
  "/dashboard/app/31_performance_math.js",
  "/dashboard/app/32_overview.js",
  "/dashboard/app/33_performance_views.js",
  "/dashboard/app/34_charts.js",
  "/dashboard/app/40_data_catalog.js",
  "/dashboard/app/41_data_explorer.js",
  "/dashboard/app/42_data_symbols.js",
  "/dashboard/app/43_data_detail_compare.js",
  "/dashboard/app/50_fetch.js",
  "/dashboard/app/60_workbench_builder.js",
  "/dashboard/app/70_runs.js",
  "/dashboard/app/80_operations.js",
  "/dashboard/app/90_bootstrap.js",
];
