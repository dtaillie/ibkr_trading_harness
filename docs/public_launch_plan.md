# Public Launch Plan

Use the launch to validate interest in the harness, not to imply strategy edge.

## Preflight

```bash
python3 scripts/export_public_repo.py --dest ../algo_trade_public --force
cd ../algo_trade_public
python3 scripts/public_publish_check.py
```

Before posting, manually review:

- `README.md` first screen: harness, safety model, and demo are obvious.
- Dashboard demo starts without credentials.
- No private strategy names, tuned parameters, account IDs, logs, or credentials.
- Current Hacker News and subreddit rules for self-promotion and disclosure.

## Show HN

Suggested framing:

> Show HN: Local-first IBKR trading harness with explicit paper/live safety boundaries

Post angle:

- Lead with the problem: strategy code is easy; safe operational harnesses are
  where most amateur trading projects get brittle.
- Show the demo dashboard and public-safe workflow.
- State clearly that the repo does not claim profitable strategies.
- Ask for feedback on safety boundaries, runner artifacts, and operational UX.

## r/algotrading

Suggested framing:

> I built a local-first IBKR harness for replay/shadow/simulated-paper workflows, not a strategy

Post angle:

- Keep it technical and transparent.
- Emphasize no edge claim, no paid product, no signal sale.
- Share architecture screenshots or a short GIF rather than performance claims.
- Ask what safety checks, broker controls, or artifact formats practitioners
  would expect before trusting a paper/live harness.

## Credibility Signals

Capture traffic and engagement for later use:

- GitHub stars, forks, issues, and meaningful comments.
- HN points/comments and specific technical critiques.
- Reddit comments that validate pain points or request features.
- Any inbound messages from engineers, traders, or maintainers.

Use those signals in:

- LinkedIn: "Built and launched a public-safe IBKR trading harness; feedback
  focused on safety boundaries, observability, and broker controls."
- Toptal: position it as evidence of backend/product engineering around a
  high-risk domain: safety gates, auditability, local-first privacy, and
  operational tooling.

Avoid using traffic as proof of trading performance. Treat it as proof that
the engineering problem is legible and interesting to the target audience.
