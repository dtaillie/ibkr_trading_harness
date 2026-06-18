// Dashboard module entrypoint. Feature modules keep explicit imports/exports under /dashboard/app/.
export const dashboardAppChunks = [
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

import "./app/00_core.js";
import "./app/10_help.js";
import "./app/20_workbench_foundation.js";
import "./app/30_runtime_core.js";
import "./app/31_performance_math.js";
import "./app/32_overview.js";
import "./app/33_performance_views.js";
import "./app/34_charts.js";
import "./app/40_data_catalog.js";
import "./app/41_data_explorer.js";
import "./app/42_data_symbols.js";
import "./app/43_data_detail_compare.js";
import "./app/50_fetch.js";
import "./app/60_workbench_builder.js";
import "./app/70_runs.js";
import "./app/80_operations.js";
import { initializeDashboard } from "./app/90_bootstrap.js";

initializeDashboard();
