---
title: "Trading infrastructure, not alpha: an IBKR harness built around safety and honest backtesting"
published: true
tags: python, machinelearning, showdev, opensource
canonical_url: https://dtaillie.github.io/ibkr_trading_harness/
cover_image: https://raw.githubusercontent.com/dtaillie/ibkr_trading_harness/main/docs/images/dashboard_overview.png
---

Most open-source trading projects lead with a strategy — a backtest curve that
goes up and to the right, and an implicit promise of edge. This one deliberately
doesn't. [ibkr_trading_harness](https://github.com/dtaillie/ibkr_trading_harness)
is infrastructure: the machinery around a strategy, not the strategy itself. The
bundled example strategies (SMA crossover, RSI, opening-range breakout) are
intentionally non-viable textbook patterns. They exist to demonstrate a contract,
not an edge.

That framing isn't modesty — it's the whole design thesis. The place retail
algorithmic traders actually get hurt isn't picking a bad strategy; it's the gap
between a backtest and live execution, where the code you tested quietly differs
from the code that trades real money, where an accidental order slips through, or
where a flattering backtest hides how little it actually proved. So the design
goals were the unglamorous ones: make the tested code path identical to the live
one, make dangerous actions require deliberate effort, and make backtests hard to
lie to yourself with.

Here's how each of those turned into an architectural decision.

## The plugin/runner boundary

A strategy is a plugin implementing a small contract. Everything else — market
data, order plumbing, execution safety, accounting, logging — belongs to the
runner. The strategy decides *what* to do; the runner owns *how* it happens.

The payoff is that the **same** strategy interface runs in replay,
simulated-paper, and live modes. There's no separate vectorized backtester that
drifts out of sync with the live logic over time — a notorious source of
"it worked in backtest" failures. When you replay a strategy, you're exercising
the exact decision code that will later run against a broker. The differences
between modes live entirely in the runner (does it simulate a fill or place a
real order?), not in the strategy.

This boundary also keeps the public repo honest: the example plugins are
non-viable on purpose, and a real strategy is just another plugin implementing
the same interface from a private repo. The infrastructure is shareable without
anyone's edge or credentials going with it.

## Safety as deliberate friction

The expensive mistake in this domain is an accidental live order. So the design
makes doing the dangerous thing intentionally annoying, in layers:

- **Live ports are blocked** unless *both* the config and the CLI explicitly opt
  in. One flag isn't enough.
- **Paper-order submission requires its own explicit flag** — paper is safe, but
  it still touches a broker session, so it's gated too.
- **The browser dashboard can run backtests but has no code path to submit an
  order at all.** You physically cannot fat-finger a trade from the UI.
- **The remote command worker refuses reserved high-risk actions even if you add
  them to its allowlist** — the allowlist can't be used to grant something the
  system considers unsafe.
- Every run writes a **hash-chained audit trail**, so the record of what happened
  is tamper-evident.

None of this prevents a determined user from trading live — that's the point of
the tool. It just ensures live trading is always a series of deliberate, explicit
choices rather than a default you can stumble into.

## Honest backtesting

A backtest that reports a single summary number is easy to fool yourself with.
So runs record **decisions, orders, fills, and account snapshots as separate
artifacts**, and headline stats like win rate and profit factor are computed from
*paired round trips* — not derived from a summary. If a number looks too good,
you can trace it back to the individual events that produced it.

Fills are modeled with configurable slippage and commission, so "profit" isn't
computed at an unrealistic mid-price. And the whole loop is drivable from the
browser: pick saved data, choose a plugin, set a date window, and run a
replay or simulated-paper pass, with results landing in the Performance and Runs
views.

![The Workbench: configure and run a backtest from the browser](https://raw.githubusercontent.com/dtaillie/ibkr_trading_harness/main/docs/images/dashboard_workbench_generate_draft.png)

The dashboard runs are deliberately **bounded** — a step cap and a wall-clock
timeout — so they stay quick smokes rather than full-length backtests. Anything
heavier drops to the command line, which runs the identical engine. The UI is a
convenience layer over the runner, never a separate path.

![Performance view: equity, drawdown, and stats from paired round trips](https://raw.githubusercontent.com/dtaillie/ibkr_trading_harness/main/docs/images/dashboard_performance.png)

## Known limitations (stated up front)

Honest infrastructure names its own weaknesses, so here they are — these are the
first things I'd poke at, too:

- **It's bar-replay, not tick-level.** Fills are modeled around the bar with
  configurable slippage/commission, not produced by a real matching engine, so
  execution realism is approximate. A single backtest pass is the *weakest* form
  of evidence; out-of-sample and walk-forward testing is the right next step
  before trusting anything.
- **Data quality is your responsibility.** The harness surfaces per-file quality
  warnings and won't silently replay a file it flagged as bad, but it doesn't
  clean ticks for you. Garbage bars in, garbage results out.
- **It's local-first and single-process** — not built for HFT or large
  multi-account operations.
- **The example strategies are deliberately non-viable.** No edge is claimed or
  included.

## Try it

The dashboard runs in about 30 seconds on seeded synthetic data — no broker
connection or credentials needed:

```bash
pip install -r requirements.txt
python3 scripts/demo_dashboard.py
```

The code is MIT-licensed, CI-gated, and covered by a few hundred tests. I'd value
feedback on the architecture in particular — the paper/live safety boundary, the
simulated fill model, and the plugin/runner contract. Repo:
[github.com/dtaillie/ibkr_trading_harness](https://github.com/dtaillie/ibkr_trading_harness).
