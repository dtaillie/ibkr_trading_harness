# Publication Readiness

This repo should not be pushed directly as a public GitHub repo. Create a clean
public copy from an explicit include list.

## Current Assessment

- The reusable harness is close to publishable: IBKR data fetchers, broker
  adapter, generic plugin runner, Gateway service wrapper, plugin interfaces,
  example non-viable strategies, and public-safe example configs are mostly
  present.
- The current tracked tree still contains private research scripts, analysis
  outputs, tuned strategy configs, and strategy implementations that should not
  go public.
- `.gitignore` protects many local files, but ignored files can still exist in
  the working tree and tracked files are not protected by `.gitignore`.

## Public Goal

Publish a framework that helps people:

- Pull historical IBKR stock and crypto bars.
- Store/resume fetched data locally.
- Define strategy plugins that can be loaded by the generic public runner.
- Run plugins in replay, shadow, simulated-paper, and explicitly confirmed IBKR
  paper mode.
- Operate local systemd services for Gateway.
- Build their own private strategies by implementing documented plugin
  interfaces.

Do not publish:

- Tuned private strategy logic.
- Strategy research scripts or analysis outputs.
- Runtime logs, cache data, account IDs, credentials, local paths, or broker
  account assumptions.

## Immediate Gate

Run:

```bash
python3 scripts/public_readiness_audit.py
```

Treat any `BLOCKER` as a file that must not be copied to the public repo
without sanitization or exclusion. Treat `REVIEW` as a manual inspection item.
For CI or a final pre-push gate, use strict mode so both `BLOCKER` and `REVIEW`
findings fail the check:

```bash
python3 scripts/public_readiness_audit.py --fail-on-review
```

Use `scripts/export_public_repo.py --dest ../algo_trade_public --force` for a
repeatable public copy. If the destination is already a Git repo, `--force`
preserves its `.git` directory while replacing the exported working-tree files.

## Recommended Public Repo Shape

- `framework/`
- `examples/`
- `live/` data fetchers, broker/data adapters, and the generic plugin runner
- `scripts/` only for operational/fetch/status/install tools, not research
  scripts
- `ops/systemd/` Gateway service wrappers after paths are generic
- `config/*.example.yaml`
- `config/*.env.example`
- public docs and tests

## Blog Post Outline

1. Why build a local trading harness instead of putting broker credentials in
   the cloud.
2. IBKR Gateway setup and paper account mode.
3. Fetching historical bars and validating timezone/data coverage.
4. Writing a strategy plugin.
5. Running replay, shadow, simulated-paper, and explicitly confirmed paper
   modes safely.
6. Operating services and reading status output.
7. Public/private split: keep strategies and configs private.
8. Limitations: market-data permissions, rate pacing, slippage, rejected orders,
   Gateway login/2FA, and no performance guarantees.
