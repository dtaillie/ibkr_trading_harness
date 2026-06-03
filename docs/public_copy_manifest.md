# Public Copy Manifest

This repo currently contains private strategy code and research artifacts. A
public repo should be created by copying an explicit public subset, not by
pushing this working tree.

## Include

- Generic broker/data adapters after account-specific defaults are removed.
- Generic plugin runner:
  - `live/plugin_runner.py`
- Generic local supervisor:
  - `scripts/plugin_supervisor.py`
  - `config/plugin_supervisor.example.yaml`
- Gateway service wrapper.
- Read-only telemetry prototype:
  - `scripts/publish_status.py`
  - `scripts/cloud_status_server.py`
- Safe remote command prototype:
  - `scripts/command_worker.py`
  - `config/remote_control.example.yaml`
- Operational dashboard:
  - `web/dashboard/`
- Public strategy plugin contract and non-viable example plugins:
  - `framework/`
  - `examples/`
- Public-safe example configs:
  - `config/*.example.yaml`
  - `config/*.env.example`
  - `config/strategy_registry.example.yaml`
- Public documentation:
  - `docs/configuration_privacy.md`
  - `docs/public_framework_roadmap.md`
  - operational docs after private paths and strategy names are sanitized.
- Test utilities that do not encode private strategy rules.

Use `scripts/export_public_repo.py` to create the current conservative public
copy candidate. It intentionally excludes strategy-shaped intraday paper runners
while including the generic strategy-plugin runner.
When `--force` is used against an existing public repo, the exporter refreshes
the working tree while preserving the destination `.git` directory so commit
history and remotes survive repeated exports.

## Exclude

- Private runtime configs:
  - `config/*.env`
  - `config/*_paper.yaml`
  - `config/strategy_registry.yaml`
  - tuned universes
- Runtime configs and plugins that contain private strategy logic:
  - `private/`
  - current private stock and crypto config files
- Research scripts and outputs that encode strategy discovery:
  - `scripts/r*.py`
  - `analysis_out/`
- Runtime data:
  - `cache/`
  - `paper_logs/`
  - parquet/zip/log artifacts
- Credentials, account IDs, local machine paths, and broker-specific private
  settings.

## Current Refactor Boundary

- Runtime stock and crypto signal selection is loaded through plugin specs in
  private ignored config.
- The first public export includes data fetchers, broker/data adapters, a
  generic plugin runner, plugin contracts, example plugins, Gateway service
  wrappers, docs, and tests.
- The first public export does not include the current private paper/shadow
  runners because they still encode strategy-specific assumptions.
- Keep public runners responsible only for data acquisition, strategy plugin
  invocation, order planning, broker execution, logging, and service lifecycle.
- Research scripts still encode strategy discovery and should remain private
  unless they are rewritten as generic harnesses that call example/private
  plugins.
