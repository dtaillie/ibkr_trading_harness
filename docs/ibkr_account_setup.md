# IBKR Account Setup

This guide explains why this project targets Interactive Brokers (IBKR), which
account tier to pick, and how to sign up, subscribe to market data, enable
crypto, turn on API access, and get a paper account. It is background for the
[main README](../README.md); the operational side of running the connection
lives in the [IBKR Gateway runbook](ibkr_gateway_runbook.md).

> **Figures change.** Every dollar amount, coin list, fee, and rule below is
> point-in-time and approximate. IBKR updates pricing, data bundles, supported
> coins, and margin rules regularly. **Confirm anything you rely on at
> [ibkr.com](https://www.interactivebrokers.com/).** Nothing here is financial,
> tax, or legal advice.

## Why IBKR

This harness is built around IBKR because, for a retail developer, it hits a
combination that is hard to find elsewhere:

- **A mature, documented API.** The TWS API — and the lightweight headless
  **IB Gateway** — is battle-tested and wrapped by stable community libraries
  (`ib_insync` / `ib_async`). The same strategy-plugin code path can run against
  replay, simulated paper, broker paper, and (eventually) live with minimal
  change.
- **Breadth from one account.** US and global equities, ETFs, options, futures,
  FX, bonds, and spot crypto — plus deep historical bars and streaming quotes
  through the same API.
- **Low cost.** Among the cheapest in the industry (see tiers below).
- **A real paper account** that can mirror your live market-data permissions, so
  you can dry-run automation against realistic data before risking capital.

You do **not** need IBKR to use most of this repo — replay and the dashboard run
on saved CSV/parquet with no broker at all. IBKR is what you connect to when you
want real historical data and paper/live execution.

## IBKR Lite vs IBKR Pro

Both tiers expose the **same API**, the **same crypto access**, the **same
market-data subscriptions**, and the **same paper account**. The only
algo-relevant differences are **commissions** and **order routing**.

| | IBKR Lite | IBKR Pro |
| --- | --- | --- |
| US stock/ETF commission | **$0** | Per-share: **Tiered** (≈ $0.0035/share, scaling toward ≈ $0.0005 at high volume) or **Fixed** (flat ≈ $0.005/share), with per-order minimums |
| Order routing | Payment-for-order-flow (PFOF) to market makers | **IBKR SmartRouting** across exchanges/ECNs/dark pools, seeking price improvement |
| Availability | US residents only | Global |
| API / crypto / paper | Identical | Identical |

**Recommendation:** for an automated harness that cares about fill quality —
trades actively or in size — **IBKR Pro is the more defensible default**. Its
SmartRouting often earns price improvement that exceeds the small per-share
commission, and you get routing transparency. If instead you trade infrequently
in small size and want zero explicit commission, **IBKR Lite is reasonable** —
note it leans on PFOF, so fills can be marginally worse.

This project's backtest/cost model historically assumes IBKR Lite's $0 stock
commissions as a baseline; that is a modeling convenience, not a routing
endorsement. You can **switch tiers free** in Client Portal (effective in about
one business day), so the choice is reversible — start where you are comfortable
and re-evaluate once you see your own fill quality and volume.

## Opening an account

A standard US individual account, roughly:

1. Start an application at [interactivebrokers.com](https://www.interactivebrokers.com/);
   choose **Individual** and your country of legal residence.
2. Create a username/password and verify your email.
3. Complete the application: identity, tax info (W-9 for US), employment,
   financial profile, and the trading-experience questions IBKR uses to set
   your permissions.
4. Choose your tier (Lite or Pro) and request the trading permissions you want
   (US stocks/ETFs, options, etc.). **Crypto is added separately** after the
   account exists (see below).
5. Verify identity and address (government photo ID + proof of address; scans
   are preferred over phone photos to avoid delays).
6. Submit and wait for approval — typically ~1–3 business days. There is **no
   minimum deposit for a cash account** (the old $10k minimum was removed in
   2021); a **margin account** — which a day-trading or shorting harness needs —
   requires a ~$2,000 minimum. Confirm current minimums on ibkr.com.
7. Fund via ACH or wire. You can't trade until the account is approved and the
   deposit clears.

## Market-data subscriptions

The API gives you **free 15-minute-delayed** Level 1 quotes and **free
historical bars** with no subscription. For real-time data you subscribe in
Client Portal (Settings → Market Data Subscriptions). For a US-equities + crypto
developer, the common picks:

| Subscription | What it gives you | Approx. cost | Needed for real-time API? |
| --- | --- | --- | --- |
| **US Securities Snapshot & Futures Value Bundle** | Real-time *snapshot* NBBO for US stocks/ETFs (NYSE/AMEX/NASDAQ consolidated) | ≈ $10/mo, waivable with ≈ $30+ monthly commissions | Yes, for real-time snapshots |
| **US Equity & Options Add-On Streaming Bundle** | Real-time *streaming* Level 1 quotes (the one you want for tick/bar streaming) | ≈ $4.50/mo, requires the snapshot bundle | Yes, for streaming |
| On-demand / regulatory snapshots | Pay-per-request real-time snapshots without a subscription | ≈ $0.01 per US equity request, small monthly auto-waiver | No (low-frequency only) |
| Crypto market data | Crypto historical bars + streaming through the API (TWS/API v10.10+) | Generally available with the crypto permission | No separate equities bundle required |

Confirm current prices and whether the streaming add-on is commission-waivable
on the [IBKR market-data pricing page](https://www.interactivebrokers.com/en/pricing/market-data-pricing.php).

## Enabling crypto

IBKR routes crypto execution/custody through **Zero Hash** or **Paxos**, and
**IBKR assigns the venue** based on account type and country of residence — you
don't freely choose. The assigned venue determines which coins you can trade, so
**check yours in Client Portal**.

- **Enable it:** Client Portal → Settings → Trading Permissions → request
  **Cryptocurrency**, accept the crypto disclosures. Approval is typically
  overnight. (You must open and fund the brokerage account first.)
- **Coins:** as of mid-2026 IBKR offers roughly 11 spot coins (e.g. BTC, ETH,
  LTC, BCH, SOL, ADA, XRP, DOGE, AVAX, LINK, SUI). Per-coin availability depends
  on whether your account routes to Zero Hash or Paxos — **confirm the exact
  list for your venue.**
- **Fees:** commission ≈ 0.12%–0.18% of trade value, ~$1.75 minimum per order
  (the minimum is capped at 1% of trade value, so tiny orders are protected).
  IBKR advertises no added spreads or custody fees.
- **From the API:** request crypto contracts on the `ZEROHASH` / `PAXOS`
  exchange for historical bars, streaming, and orders. This repo's crypto
  fetcher (`live/fetch_crypto_history.py`) and
  [crypto fetching guide](crypto_history_fetching.md) cover the data side; use
  `--exchange` to match your assigned venue. Note that older TWS API docs use
  `PAXOS` as the crypto exchange string for all coins; confirm which value your
  API version and account accept (`PAXOS` and/or `ZEROHASH`).
- **Custody is NOT SIPC-protected** (unlike your securities), and crypto isn't
  available in every state/country.

## Enabling API access

Run **IB Gateway** (lightweight, headless — preferred for an always-on harness)
or **TWS** (full GUI). Either must stay logged in for the API to accept
connections.

1. **TWS:** File → Global Configuration → API → Settings. **IB Gateway:**
   Configure → Settings → API.
2. Check **Enable ActiveX and Socket Clients**.
3. Leave **Read-Only API** checked for data-only/dry-run safety; uncheck it only
   when your harness needs to place/modify/cancel orders.
4. Set the **socket port** to match your client's `connect()`:

   | | Live | Paper |
   | --- | --- | --- |
   | IB Gateway | 4001 | **4002** |
   | TWS | 7496 | 7497 |

   This harness treats `4001`/`7496` as **live-port hazards** and refuses them
   for paper unless you explicitly opt in. Prefer **4002**.
5. Under **Trusted IP Addresses**, add `127.0.0.1` (same machine) or the remote
   machine's IP.
6. Use a **unique `clientId`** per concurrent connection.
7. For 24/7 operation, use auto-restart tooling (e.g. IBC) to handle IBKR's
   periodic forced logout. See the [Gateway runbook](ibkr_gateway_runbook.md).

## Paper trading

1. After your live account is approved, request a **paper account** in Client
   Portal (Settings → Paper Trading Account). IBKR creates a separate paper
   username.
2. Log into TWS/IB Gateway with the **paper** credentials and point the API at
   the paper port (Gateway **4002** / TWS 7497).
3. By default the paper account sees **15-minute-delayed** Level 1 data and
   historical bars only. To get real-time data in paper, **share your live
   subscriptions** to the paper user in Client Portal (Settings → Paper Trading);
   it can take ~24h. Note you can't be logged into the live username elsewhere
   while the paper user rides the shared live data.

Validate the connection without placing orders:

```bash
python3 live/plugin_runner.py --config config/plugin_runner.example.yaml --validate-only
```

## Caveats worth knowing

- **Data pacing & limits.** IBKR caps simultaneous streaming lines (commonly
  ~100, raised by commissions/equity) and rate-limits historical requests. A
  wide-universe harness must throttle and queue — this repo's fetchers write
  resumable manifests partly for this reason.
- **PDT rule changed (mid-2026).** FINRA Regulatory Notice 26-10 eliminated the
  $25,000 pattern-day-trader minimum effective **June 4, 2026**, replacing it
  with an intraday-margin-deficit framework. Brokers may phase implementation in
  through Oct 20, 2027, so **confirm IBKR's current day-trading margin treatment**
  for sub-$25k accounts rather than assuming either the old or new rule applies.
- **Crypto custody** at Zero Hash/Paxos is not SIPC-protected; coin availability
  and venue can change.
- **Regional restrictions.** IBKR Lite is US-only; crypto and specific coins
  aren't available everywhere. Verify eligibility for your jurisdiction.
- **Forced logout.** Gateway/TWS logs out periodically; a 24/7 harness needs
  auto-restart and reconnection logic.

## Sources

Verify current details directly — IBKR pages are authoritative:

- [Cryptocurrencies product page](https://www.interactivebrokers.com/en/trading/products-cryptocurrencies.php)
- [Cryptocurrency commissions](https://www.interactivebrokers.com/en/pricing/commissions-cryptocurrencies.php)
- [Market-data pricing](https://www.interactivebrokers.com/en/pricing/market-data-pricing.php)
- [IBKR Campus — market-data subscriptions](https://www.interactivebrokers.com/campus/ibkr-api-page/market-data-subscriptions/)
- [IBKR Campus — configuring TWS for the API](https://www.interactivebrokers.com/campus/trading-lessons/installing-configuring-tws-for-the-api/)
- [IBKR Campus — adding crypto permissions](https://www.interactivebrokers.com/campus/trading-lessons/adding-cryptocurrency-trading-permissions/)
- [IBKR Campus — requesting a paper account](https://www.interactivebrokers.com/campus/trading-lessons/request-paper-trading-account/)
- [TWS API — cryptocurrency support](https://interactivebrokers.github.io/tws-api/cryptocurrency.html)
- [FINRA Regulatory Notice 26-10 (PDT rule change)](https://www.finra.org/rules-guidance/notices/26-10)
