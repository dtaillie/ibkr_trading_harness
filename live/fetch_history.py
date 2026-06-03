#!/usr/bin/env python3
"""
DATA-ONLY: Fetch and cache historical bars from IBKR.

This script ONLY reads historical data — it never submits orders.
Safe to run against a live account to populate the cache.

Usage:
    python3 live/fetch_history.py --port 7496 --symbols SPY,QQQ --bar-size 5min --duration "1 Y"

Default port 7496 = TWS live. Use 4001 for Gateway live.
For paper, use 4002 (Gateway) or 7497 (TWS).
"""

from __future__ import annotations

import argparse
import logging
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from ib_insync import IB
from live.ibkr_data import fetch_ibkr_bars, fetch_ibkr_bars_chunked, BAR_SIZES

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def main():
    parser = argparse.ArgumentParser(description="Fetch historical bars from IBKR (read-only)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7496,
                        help="7496=TWS live, 4001=Gateway live, 7497=TWS paper, 4002=Gateway paper")
    parser.add_argument("--client-id", type=int, default=99,
                        help="Use a different client ID than the trading runner")
    parser.add_argument("--symbols", required=True,
                        help="Comma-separated tickers: SPY,QQQ,AAPL")
    parser.add_argument("--bar-size", default="5min",
                        choices=list(BAR_SIZES.keys()))
    parser.add_argument("--duration", default="1 Y",
                        help="IBKR duration string: '1 D', '5 D', '1 M', '1 Y'")
    parser.add_argument("--months", type=int, default=0,
                        help="If > 0, fetch this many months of history in chunks (overrides --duration)")
    parser.add_argument("--rth", action=argparse.BooleanOptionalAction, default=True,
                        help="Regular trading hours only (default true). Use --no-rth for premarket+after-hours.")
    parser.add_argument("--what-to-show", default=None,
                        help="IBKR historical data type override, e.g. TRADES, MIDPOINT, BID, ASK, BID_ASK, AGGTRADES.")
    parser.add_argument("--crypto-exchange", default=None,
                        help="IBKR crypto venue override for *-USD symbols, e.g. ZEROHASH or PAXOS.")
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",")]

    ib = IB()
    log.info(f"Connecting to {args.host}:{args.port} (client_id={args.client_id})...")
    ib.connect(args.host, args.port, clientId=args.client_id)
    log.info(f"Connected. Account: {ib.managedAccounts()}")

    try:
        for symbol in symbols:
            if args.months > 0:
                log.info(f"Fetching {symbol} {args.bar_size} bars for {args.months} months (chunked)...")
                bars = fetch_ibkr_bars_chunked(
                    ib, symbol,
                    bar_size=args.bar_size,
                    months=args.months,
                    use_rth=args.rth,
                    use_cache=False,
                )
            else:
                log.info(f"Fetching {symbol} {args.bar_size} bars for {args.duration}...")
                try:
                    bars = fetch_ibkr_bars(
                        ib, symbol,
                        duration=args.duration,
                        bar_size=args.bar_size,
                        use_rth=args.rth,
                        use_cache=False,
                        what_to_show=args.what_to_show,
                        crypto_exchange=args.crypto_exchange,
                    )
                except Exception as e:
                    log.warning(f"  {symbol}: failed — {e}")
                    continue
            if bars:
                log.info(f"  {symbol}: {len(bars)} bars cached "
                         f"({bars[0].timestamp} → {bars[-1].timestamp})")
            else:
                log.warning(f"  {symbol}: no bars returned")
    finally:
        ib.disconnect()
        log.info("Disconnected.")


if __name__ == "__main__":
    main()
