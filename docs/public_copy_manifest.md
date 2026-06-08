# Public Copy Manifest

This repo currently contains private strategy code and research artifacts. A
public repo should be created by copying an explicit public subset, not by
pushing this working tree.

## Include

- Generic broker/data adapters after account-specific defaults are removed.
- Generic plugin runner:
  - `live/plugin_runner.py`
  - `config/plugin_registry.example.yaml`
- Generic local supervisor:
  - `scripts/plugin_supervisor.py`
  - `config/plugin_supervisor.example.yaml`
  - `ops/systemd/algo-trade-plugin-supervisor.service`
- Manual order approval helper:
  - `scripts/approve_order_preview.py`
- Gateway service wrapper.
- Read-only telemetry prototype:
  - `scripts/publish_status.py`
  - `scripts/cloud_status_server.py`
  - `config/cloud_status.example.yaml`
  - `config/cloud_status_hosted.example.yaml`
  - `ops/cloud/status-receiver.Dockerfile.example`
  - `ops/cloud/status-receiver.compose.example.yaml`
  - `ops/cloud/nginx-status-receiver.example.conf`
  - `ops/cloud/caddy-status-receiver.example.Caddyfile`
  - `ops/cloud/ufw-status-receiver.example.sh`
  - `ops/cloud/aws-security-group-status-receiver.example.tf`
  - `ops/cloud/aws-s3-command-audit-retention.example.tf`
  - `ops/cloud/azure-blob-command-audit-retention.example.tf`
  - `ops/cloud/azure-nsg-status-receiver.example.tf`
  - `ops/cloud/digitalocean-firewall-status-receiver.example.tf`
  - `ops/cloud/gcp-gcs-command-audit-retention.example.tf`
  - `ops/cloud/gcp-firewall-status-receiver.example.tf`
  - `ops/cloud/fly-status-receiver.example.toml`
  - `ops/cloud/render-status-receiver.example.yaml`
  - `ops/cloud/sync-command-audit.example.sh`
  - `scripts/audit_cloud_examples.py`
  - `scripts/public_publish_check.py`
- Safe remote command prototype:
  - `scripts/command_worker.py`
  - `config/remote_control.example.yaml`
  - `ops/systemd/algo-trade-command-worker.service`
- Operational dashboard:
  - `web/dashboard/`
  - `scripts/install_dashboard_server.sh`
  - `scripts/install_local_monitoring_stack.sh`
  - `ops/systemd/algo-trade-plugin-supervisor.service`
  - `ops/systemd/algo-trade-status-publisher.service`
  - `ops/systemd/algo-trade-status-publisher.timer`
- Public strategy plugin contract and non-viable example plugins:
  - `framework/`
  - `examples/`
- Public-safe example configs:
  - `config/*.example.yaml`
  - `config/*.env.example`
  - `config/strategy_registry.example.yaml`
- Public documentation:
  - `docs/configuration_privacy.md`
  - `docs/web_ui_runbook.md`
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
