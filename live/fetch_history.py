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
import time
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

import pandas as pd
from ib_insync import IB
from live.fetch_manifest import DEFAULT_FETCH_MANIFEST_DIR, FetchManifest, infer_error_kind
from live.ibkr_data import CACHE_DIR, BAR_SIZES, fetch_ibkr_bars, fetch_ibkr_bars_chunked

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def matching_cache_outputs(symbol: str, bar_size: str, use_rth: bool, *, since_epoch: float) -> list[Path]:
    if not CACHE_DIR.exists():
        return []
    pattern = f"{symbol}_{bar_size}_*_rth{use_rth}.parquet"
    candidates = [path for path in CACHE_DIR.glob(pattern) if path.stat().st_mtime >= since_epoch]
    return sorted(candidates, key=lambda path: path.stat().st_mtime, reverse=True)


def cache_output_summary(path: Path) -> tuple[int, str | None, str | None]:
    try:
        df = pd.read_parquet(path, columns=["date"])
    except Exception:
        return 0, None, None
    if df.empty:
        return 0, None, None
    ts = pd.to_datetime(df["date"], utc=True, errors="coerce").dropna().sort_values()
    first = ts.iloc[0].isoformat() if not ts.empty else None
    last = ts.iloc[-1].isoformat() if not ts.empty else None
    return int(len(df)), first, last


def display_path(path: Path) -> str:
    root = Path(__file__).resolve().parent.parent
    resolved = path.resolve()
    return resolved.relative_to(root).as_posix() if resolved.is_relative_to(root) else str(resolved)


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
    parser.add_argument("--manifest-dir", type=Path, default=DEFAULT_FETCH_MANIFEST_DIR,
                        help="Directory for dashboard-readable JSON fetch manifests.")
    parser.add_argument("--no-manifest", action="store_true",
                        help="Disable JSON fetch manifest writing.")
    args = parser.parse_args()

    symbols = [s.strip().upper() for s in args.symbols.split(",")]
    manifest = FetchManifest(
        manifest_dir=args.manifest_dir,
        kind="stock_history",
        parameters={
            "bar_size": args.bar_size,
            "duration": args.duration,
            "months": args.months,
            "rth": args.rth,
            "what_to_show": args.what_to_show,
            "crypto_exchange": args.crypto_exchange,
            "cache_dir": display_path(CACHE_DIR),
        },
        symbols=symbols,
        enabled=not args.no_manifest,
    )
    manifest_status = "failed"

    ib = IB()
    log.info(f"Connecting to {args.host}:{args.port} (client_id={args.client_id})...")
    try:
        try:
            ib.connect(args.host, args.port, clientId=args.client_id)
        except Exception as e:
            manifest.error("__connection__", str(e), kind="connection")
            raise
        log.info(f"Connected. Account: {ib.managedAccounts()}")
        manifest.event("connected", "Connected to IBKR historical data API")

        for symbol in symbols:
            manifest.symbol(symbol, "running")
            symbol_fetch_started = time.time()
            if args.months > 0:
                log.info(f"Fetching {symbol} {args.bar_size} bars for {args.months} months (chunked)...")
                try:
                    bars = fetch_ibkr_bars_chunked(
                        ib, symbol,
                        bar_size=args.bar_size,
                        months=args.months,
                        use_rth=args.rth,
                        use_cache=False,
                    )
                except Exception as e:
                    message = str(e)
                    log.warning(f"  {symbol}: failed — {message}")
                    manifest.error(symbol, message, kind=infer_error_kind(message))
                    manifest.symbol(symbol, "failed", message=message)
                    continue
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
                    message = str(e)
                    log.warning(f"  {symbol}: failed — {message}")
                    manifest.error(symbol, message, kind=infer_error_kind(message))
                    manifest.symbol(symbol, "failed", message=message)
                    continue
            if bars:
                log.info(f"  {symbol}: {len(bars)} bars cached "
                         f"({bars[0].timestamp} → {bars[-1].timestamp})")
                cache_outputs = matching_cache_outputs(
                    symbol,
                    args.bar_size,
                    args.rth,
                    since_epoch=symbol_fetch_started,
                )
                for output_path in cache_outputs[:8]:
                    rows, first_ts, last_ts = cache_output_summary(output_path)
                    manifest.output(
                        symbol,
                        path=display_path(output_path),
                        rows=rows,
                        first_timestamp=first_ts,
                        last_timestamp=last_ts,
                    )
                if not cache_outputs:
                    manifest.output(
                        symbol,
                        path=None,
                        rows=len(bars),
                        first_timestamp=bars[0].timestamp,
                        last_timestamp=bars[-1].timestamp,
                        message="No matching cache file found after fetch",
                    )
                manifest.symbol(
                    symbol,
                    "ok",
                    bars=len(bars),
                    first_timestamp=bars[0].timestamp,
                    last_timestamp=bars[-1].timestamp,
                )
            else:
                log.warning(f"  {symbol}: no bars returned")
                manifest.error(symbol, "no bars returned", kind="no_data")
                manifest.symbol(symbol, "empty", bars=0, message="no bars returned")
        manifest_status = None
    finally:
        manifest.finish(manifest_status)
        ib.disconnect()
        log.info("Disconnected.")


if __name__ == "__main__":
    main()
