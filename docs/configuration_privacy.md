# Configuration Privacy

Use private local config files for actual paper/live operation and commit only
sanitized examples.

## Private Files

These files are ignored by git and may contain local account assumptions,
client IDs, schedule choices, tuned strategy parameters, or private universes:

- `config/*.env`
- `config/*_paper.yaml`
- `config/strategy_registry.yaml`
- `config/plugin_registry_local.yaml`
- `config/*_private.yaml`
- `config/*_local.yaml`
- `config/local/`
- `paper_logs/`

Examples are intentionally not ignored:

- `config/*.env.example`
- `config/*.example.yaml`
- `config/strategy_registry.example.yaml`
- `config/plugin_registry.example.yaml`

Example files must be vanilla templates. They should demonstrate field names,
execution modes, and operational wiring only. They should not contain tuned
parameters, private symbols, viable strategy rules, or recent research results.

## Workflow

1. Copy an example file to a local runtime path, for example:
   `cp config/stock_paper.env.example config/stock_paper.env`
2. Edit the runtime file locally.
3. Keep real account IDs, credentials, tuned private parameters, and logs out of
   commits.
4. For a public repo copy, include examples and framework code only. Keep private
   strategy configs, tuned universes, logs, cache files, and credentials out of
   the copy.

Use `config/strategy_registry.yaml` for a private high-level local inventory of
strategies. It should store labels, modes, status, config paths, and service
commands, not tuned parameters. `scripts/strategy_registry_status.py` can print
that inventory without opening private strategy config details.

Use `config/plugin_registry_local.yaml` for private Workbench plugin metadata.
Copy `config/plugin_registry.example.yaml`, replace the placeholder spec with a
local plugin spec, and keep the copied file ignored. The Workbench can list
those local plugin labels/statuses without committing private strategy logic.

See `docs/public_copy_manifest.md` for the current include/exclude boundary for
a future public repo copy.

Note: `.gitignore` does not hide files that are already tracked. Before creating
a public repo, audit tracked config files separately and copy only the public
subset.

Runtime strategy signal logic is loaded through plugin specs in private ignored
config. Research scripts may still contain strategy-specific names and logic;
treat them as private unless they are first rewritten as generic harnesses that
call plugin interfaces with non-viable example strategies.
