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
import json
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


def option_present(argv: list[str], *names: str) -> bool:
    return any(arg == name or arg.startswith(f"{name}=") for arg in argv for name in names)


def load_stock_resume_manifest(path: Path) -> dict:
    with path.open(encoding="utf-8") as f:
        payload = json.load(f)
    if not isinstance(payload, dict):
        raise ValueError("resume manifest must be a JSON object")
    parameters = payload.get("parameters") if isinstance(payload.get("parameters"), dict) else {}
    plan = payload.get("plan") if isinstance(payload.get("plan"), dict) else {}
    symbols_requested = payload.get("symbols_requested") if isinstance(payload.get("symbols_requested"), list) else []
    symbols_map = payload.get("symbols") if isinstance(payload.get("symbols"), dict) else {}
    done_symbols = {
        str(row.get("symbol") or symbol).upper()
        for symbol, row in symbols_map.items()
        if isinstance(row, dict) and row.get("status") in {"ok", "empty", "skipped"}
    }
    failed_symbols = {
        str(row.get("symbol") or symbol).upper()
        for symbol, row in symbols_map.items()
        if isinstance(row, dict) and row.get("status") in {"failed", "partial"}
    }
    for row in payload.get("errors") or []:
        if isinstance(row, dict) and row.get("symbol"):
            failed_symbols.add(str(row["symbol"]).upper())
    symbols = [str(symbol).upper() for symbol in symbols_requested]
    if not symbols:
        symbols = sorted(set(done_symbols) | failed_symbols)
    return {
        "symbols": symbols,
        "done_symbols": done_symbols,
        "failed_symbols": failed_symbols,
        "bar_size": parameters.get("bar_size"),
        "duration": plan.get("duration") or parameters.get("duration"),
        "months": plan.get("months") if plan.get("months") is not None else parameters.get("months"),
        "rth": parameters.get("rth"),
        "what_to_show": parameters.get("what_to_show"),
        "crypto_exchange": parameters.get("crypto_exchange"),
    }


def fetch_with_retries(
    *,
    symbol: str,
    operation,
    manifest: FetchManifest,
    max_retries: int,
    retry_delay: float,
    sleep_fn=time.sleep,
):
    attempts = 0
    while True:
        attempts += 1
        try:
            return operation(), attempts
        except Exception as exc:
            if attempts > max_retries:
                raise
            manifest.retry(
                symbol,
                str(exc),
                attempt=attempts,
                max_retries=max_retries,
                delay_seconds=retry_delay,
            )
            if retry_delay > 0:
                sleep_fn(retry_delay)


def main(argv: list[str] | None = None):
    argv = list(sys.argv[1:] if argv is None else argv)
    parser = argparse.ArgumentParser(description="Fetch historical bars from IBKR (read-only)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=7496,
                        help="7496=TWS live, 4001=Gateway live, 7497=TWS paper, 4002=Gateway paper")
    parser.add_argument("--client-id", type=int, default=99,
                        help="Use a different client ID than the trading runner")
    parser.add_argument("--symbols", default=None,
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
    parser.add_argument("--pacing-delay", type=float, default=0.0,
                        help="Optional seconds to wait between symbol requests.")
    parser.add_argument("--retries", type=int, default=0,
                        help="Retry failed symbol fetches this many times before recording an error.")
    parser.add_argument("--retry-delay", type=float, default=5.0,
                        help="Seconds to wait between retry attempts.")
    parser.add_argument("--manifest-dir", type=Path, default=DEFAULT_FETCH_MANIFEST_DIR,
                        help="Directory for dashboard-readable JSON fetch manifests.")
    parser.add_argument("--no-manifest", action="store_true",
                        help="Disable JSON fetch manifest writing.")
    parser.add_argument("--resume-manifest", type=Path, default=None,
                        help="JSON stock fetch manifest to resume: uses its symbols/range/options unless overridden.")
    parser.add_argument("--force", action="store_true",
                        help="With --resume-manifest, refetch symbols already marked ok/empty/skipped.")
    args = parser.parse_args(argv)

    resume: dict | None = None
    if args.resume_manifest:
        resume = load_stock_resume_manifest(args.resume_manifest)
        if resume.get("symbols") and not option_present(argv, "--symbols"):
            args.symbols = ",".join(resume["symbols"])
        if resume.get("bar_size") and not option_present(argv, "--bar-size"):
            args.bar_size = str(resume["bar_size"])
        if resume.get("duration") and not option_present(argv, "--duration"):
            args.duration = str(resume["duration"])
        if resume.get("months") not in {None, ""} and not option_present(argv, "--months"):
            args.months = int(resume["months"] or 0)
        if resume.get("rth") is not None and not option_present(argv, "--rth", "--no-rth"):
            args.rth = bool(resume["rth"])
        if resume.get("what_to_show") and not option_present(argv, "--what-to-show"):
            args.what_to_show = str(resume["what_to_show"])
        if resume.get("crypto_exchange") and not option_present(argv, "--crypto-exchange"):
            args.crypto_exchange = str(resume["crypto_exchange"])

    if not args.symbols:
        parser.error("--symbols is required unless --resume-manifest supplies symbols")

    symbols = [s.strip().upper() for s in args.symbols.split(",")]
    resume_done_symbols = set(resume.get("done_symbols") or set()) if resume else set()
    if resume and not args.force:
        skipped_symbols = [symbol for symbol in symbols if symbol in resume_done_symbols]
        symbols = [symbol for symbol in symbols if symbol not in resume_done_symbols]
        if skipped_symbols:
            log.info(
                "Resume manifest: skipping %d already-complete symbols (%s)",
                len(skipped_symbols),
                ", ".join(skipped_symbols[:8]) + ("..." if len(skipped_symbols) > 8 else ""),
            )
    else:
        skipped_symbols = []

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
            "pacing_delay": args.pacing_delay,
            "retries": args.retries,
            "retry_delay": args.retry_delay,
            "resume_manifest": display_path(args.resume_manifest) if args.resume_manifest else None,
            "force": args.force,
        },
        symbols=symbols,
        enabled=not args.no_manifest,
    )
    manifest.set_plan(
        symbols_total=len(symbols),
        range_start=None,
        range_end=None,
        duration=args.duration,
        months=args.months,
        resume_manifest=display_path(args.resume_manifest) if args.resume_manifest else None,
        resume_skipped_symbols=len(skipped_symbols),
    )
    manifest_status = "failed"
    failed_symbols = 0
    completed_symbols = 0
    symbol_elapsed_samples: list[float] = []

    if not symbols:
        log.info("Resume manifest has no pending symbols to fetch.")
        manifest.event("resume_complete", "No pending symbols after applying resume manifest", skipped_symbols=len(skipped_symbols))
        manifest.finish("completed")
        return

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

        for index, symbol in enumerate(symbols, start=1):
            manifest.symbol(symbol, "running")
            symbol_fetch_started = time.time()
            if args.months > 0:
                log.info(f"Fetching {symbol} {args.bar_size} bars for {args.months} months (chunked)...")
                try:
                    bars, attempts = fetch_with_retries(
                        symbol=symbol,
                        operation=lambda: fetch_ibkr_bars_chunked(
                            ib, symbol,
                            bar_size=args.bar_size,
                            months=args.months,
                            use_rth=args.rth,
                            use_cache=False,
                        ),
                        manifest=manifest,
                        max_retries=max(0, args.retries),
                        retry_delay=max(0.0, args.retry_delay),
                    )
                except Exception as e:
                    message = str(e)
                    elapsed_seconds = time.time() - symbol_fetch_started
                    log.warning(f"  {symbol}: failed — {message}")
                    failed_symbols += 1
                    manifest.error(
                        symbol,
                        message,
                        kind=infer_error_kind(message),
                        elapsed_seconds=elapsed_seconds,
                        attempt_count=max(1, args.retries + 1),
                    )
                    manifest.symbol(symbol, "failed", message=message)
                    completed_symbols += 1
                    symbol_elapsed_samples.append(elapsed_seconds)
                    avg_elapsed = sum(symbol_elapsed_samples[-5:]) / len(symbol_elapsed_samples[-5:])
                    manifest.set_progress(
                        completed_symbols=completed_symbols,
                        remaining_symbols=max(0, len(symbols) - completed_symbols),
                        total_symbols=len(symbols),
                        rolling_avg_symbol_seconds=avg_elapsed,
                        eta_seconds=avg_elapsed * max(0, len(symbols) - completed_symbols),
                    )
                    if args.pacing_delay > 0 and index < len(symbols):
                        manifest.pacing_wait(args.pacing_delay, reason="post historical data request", symbol=symbol)
                        time.sleep(args.pacing_delay)
                    continue
            else:
                log.info(f"Fetching {symbol} {args.bar_size} bars for {args.duration}...")
                try:
                    bars, attempts = fetch_with_retries(
                        symbol=symbol,
                        operation=lambda: fetch_ibkr_bars(
                            ib, symbol,
                            duration=args.duration,
                            bar_size=args.bar_size,
                            use_rth=args.rth,
                            use_cache=False,
                            what_to_show=args.what_to_show,
                            crypto_exchange=args.crypto_exchange,
                        ),
                        manifest=manifest,
                        max_retries=max(0, args.retries),
                        retry_delay=max(0.0, args.retry_delay),
                    )
                except Exception as e:
                    message = str(e)
                    elapsed_seconds = time.time() - symbol_fetch_started
                    log.warning(f"  {symbol}: failed — {message}")
                    failed_symbols += 1
                    manifest.error(
                        symbol,
                        message,
                        kind=infer_error_kind(message),
                        elapsed_seconds=elapsed_seconds,
                        attempt_count=max(1, args.retries + 1),
                    )
                    manifest.symbol(symbol, "failed", message=message)
                    completed_symbols += 1
                    symbol_elapsed_samples.append(elapsed_seconds)
                    avg_elapsed = sum(symbol_elapsed_samples[-5:]) / len(symbol_elapsed_samples[-5:])
                    manifest.set_progress(
                        completed_symbols=completed_symbols,
                        remaining_symbols=max(0, len(symbols) - completed_symbols),
                        total_symbols=len(symbols),
                        rolling_avg_symbol_seconds=avg_elapsed,
                        eta_seconds=avg_elapsed * max(0, len(symbols) - completed_symbols),
                    )
                    if args.pacing_delay > 0 and index < len(symbols):
                        manifest.pacing_wait(args.pacing_delay, reason="post historical data request", symbol=symbol)
                        time.sleep(args.pacing_delay)
                    continue
            elapsed_seconds = time.time() - symbol_fetch_started
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
                        elapsed_seconds=elapsed_seconds,
                        attempt_count=attempts,
                    )
                if not cache_outputs:
                    manifest.output(
                        symbol,
                        path=None,
                        rows=len(bars),
                        first_timestamp=bars[0].timestamp,
                        last_timestamp=bars[-1].timestamp,
                        message="No matching cache file found after fetch",
                        elapsed_seconds=elapsed_seconds,
                        attempt_count=attempts,
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
                manifest.error(
                    symbol,
                    "no bars returned",
                    kind="no_data",
                    elapsed_seconds=elapsed_seconds,
                    attempt_count=attempts,
                )
                manifest.symbol(symbol, "empty", bars=0, message="no bars returned")
            completed_symbols += 1
            symbol_elapsed_samples.append(elapsed_seconds)
            avg_elapsed = sum(symbol_elapsed_samples[-5:]) / len(symbol_elapsed_samples[-5:])
            manifest.set_progress(
                completed_symbols=completed_symbols,
                remaining_symbols=max(0, len(symbols) - completed_symbols),
                total_symbols=len(symbols),
                rolling_avg_symbol_seconds=avg_elapsed,
                eta_seconds=avg_elapsed * max(0, len(symbols) - completed_symbols),
            )
            log.info(
                "Symbol complete [%d/%d] %s: elapsed=%.2fs eta=%.2fs",
                completed_symbols,
                len(symbols),
                symbol,
                elapsed_seconds,
                avg_elapsed * max(0, len(symbols) - completed_symbols),
            )
            if args.pacing_delay > 0 and index < len(symbols):
                manifest.pacing_wait(args.pacing_delay, reason="post historical data request", symbol=symbol)
                time.sleep(args.pacing_delay)
        manifest_status = "partial" if failed_symbols else None
    finally:
        manifest.finish(manifest_status)
        ib.disconnect()
        log.info("Disconnected.")


if __name__ == "__main__":
    main()
