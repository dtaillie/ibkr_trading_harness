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
python3 scripts/audit_cloud_examples.py
```

Treat any `BLOCKER` as a file that must not be copied to the public repo
without sanitization or exclusion. Treat `REVIEW` as a manual inspection item.
For CI or a final pre-push gate, use strict mode so both `BLOCKER` and `REVIEW`
findings fail the check:

```bash
python3 scripts/public_readiness_audit.py --fail-on-review
```

For a consolidated local pre-publish gate in the exported public repo, run:

```bash
python3 scripts/public_publish_check.py
```

Use `--list --json` to inspect the exact checks without running them, and
`--include-screenshots` when you want the slower screenshot layout checks
included in the gate. The default gate now covers export-manifest review,
strict public readiness, public-doc boundary copy, cloud examples, Python
compile, dashboard JavaScript syntax, pytest, default/empty/seeded dashboard
smokes, and accessibility smoke.

Use `scripts/export_public_repo.py --dest ../algo_trade_public --force` for a
repeatable public copy. If the destination is already a Git repo, `--force`
preserves its `.git` directory while replacing the exported working-tree files.
Use `scripts/export_public_repo.py --list` to inspect the destination-relative
file manifest without writing or replacing a destination tree. Use
`scripts/export_public_repo.py --list --json` when CI or review tooling needs
manifest counts, source paths, and file sizes.

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

The polished draft lives in `docs/blog_public_ibkr_harness_draft.md`. Before
publishing, read it against the exported public repo and verify it still matches
the public commands, included files, and current dashboard surfaces.

The draft should cover:

1. Why build a local trading harness instead of putting broker credentials in
   the cloud.
2. Data-only stock and crypto fetches.
3. JSON fetch manifests, recovery guidance, and Data Library inspection.
4. Writing public-safe no-edge examples and private strategy plugins.
5. Running replay, shadow, simulated-paper, and explicitly confirmed paper
   modes safely.
6. Using Workbench to generate, validate, and run local drafts.
7. Local/remote monitoring without moving trading authority to the cloud.
8. Public/private export and audit gates.
9. Limitations: market-data permissions, rate pacing, slippage, rejected
   orders, Gateway login/2FA, simulated fills, and no performance guarantees.

The public docs include operational runbooks for Gateway startup/recovery,
paper trading, market-data permissions, service restarts, and failed-order
diagnosis.

## Final Manual Review Checklist

Use this after exporting the public candidate and before pushing to GitHub:

```bash
python3 scripts/export_public_repo.py --dest ../algo_trade_public --force
cd ../algo_trade_public
python3 scripts/public_readiness_audit.py --fail-on-review
python3 scripts/audit_public_docs.py
python3 scripts/audit_cloud_examples.py
python3 scripts/audit_workbench_contracts.py
python3 scripts/audit_dashboard_contracts.py
PYTHONPATH=. pytest -q
python3 scripts/smoke_dashboard.py --scenario seeded
python3 scripts/smoke_dashboard.py --scenario empty
python3 scripts/smoke_dashboard_accessibility.py
python3 scripts/smoke_dashboard_screenshots.py --check-layout
python3 scripts/smoke_dashboard_screenshots.py --scenario empty --check-layout
```

Or run the consolidated gate and then do the manual review:

```bash
python3 scripts/public_publish_check.py --include-screenshots
```

The dashboard mirrors this checklist in Help > Boundary > Publication Review
Assistant. Use it as a quick operator triage view before the final manual
read-through; it is guidance, not a replacement for the gate or human review.

Then manually inspect:

- `README.md` or `README.public.md` for public-safe positioning and commands.
- `docs/blog_public_ibkr_harness_draft.md` for no private results, tuned
  strategy details, or account assumptions.
- `config/*.example.yaml` and `config/*.env.example` for placeholders only.
- `examples/strategies/` for no-edge example behavior.
- `web/dashboard/` for public-safe labels and no strategy-specific hard-coding.
- `docs/work_queue.md` for clear remaining limitations and research deferral.
