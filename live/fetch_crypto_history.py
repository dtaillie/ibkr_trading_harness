#!/usr/bin/env python3
"""Resumable IBKR crypto history fetcher.

Designed for Zero Hash crypto data. It writes one parquet per symbol/day so
1-minute pulls can resume safely without loading months of data into memory.

DATA-ONLY: this script never submits orders.
"""

from __future__ import annotations

import argparse
import csv
import logging
import sys
import time
from collections import deque
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
import yaml
from ib_insync import IB, Crypto, util

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from live.fetch_manifest import DEFAULT_FETCH_MANIFEST_DIR, FetchManifest, infer_error_kind
from live.ibkr_data import BAR_SIZES


OUT_DIR = Path("cache/ibkr_crypto")
ROOT = Path(__file__).resolve().parent.parent
DEFAULT_SYMBOLS_FILE = "config/crypto_universe_zerohash.yaml"

logging.basicConfig(
    level=logging.INFO,
    format="%(asctime)s [%(levelname)s] %(message)s",
)
log = logging.getLogger(__name__)


def parse_date(raw: str) -> date:
    return datetime.strptime(raw, "%Y-%m-%d").date()


def date_range(start: date, end: date) -> list[date]:
    days = []
    cur = start
    while cur <= end:
        days.append(cur)
        cur += timedelta(days=1)
    return days


def month_start(months: int, end: date) -> date:
    return end - timedelta(days=max(1, months) * 31)


def load_symbols(raw: str | None, symbols_file: str | None) -> list[str]:
    symbols: list[str] = []
    if raw:
        symbols.extend(s.strip().upper() for s in raw.split(",") if s.strip())
    elif symbols_file:
        with open(symbols_file) as f:
            data = yaml.safe_load(f)
        symbols.extend(data["symbols"] if isinstance(data, dict) else data)
    out = []
    seen = set()
    for symbol in symbols:
        symbol = symbol.upper()
        if not symbol.endswith("-USD"):
            symbol = f"{symbol}-USD"
        if symbol not in seen:
            out.append(symbol)
            seen.add(symbol)
    return out


def symbol_base(symbol: str) -> str:
    return symbol.split("-", 1)[0].upper()


def chunk_path(out_dir: Path, exchange: str, bar_size: str, symbol: str, day: date, what_to_show: str) -> Path:
    safe_exchange = exchange.replace(" ", "_").upper()
    return out_dir / safe_exchange / bar_size / symbol / f"{symbol}_{bar_size}_{what_to_show}_{day.isoformat()}.parquet"


def empty_marker_path(path: Path) -> Path:
    return path.with_suffix(path.suffix + ".empty")


def display_path(path: Path) -> str:
    resolved = path.resolve()
    return resolved.relative_to(ROOT).as_posix() if resolved.is_relative_to(ROOT) else str(resolved)


def load_done_paths(manifest: Path) -> set[str]:
    if not manifest.exists():
        return set()
    done = set()
    with manifest.open(newline="") as f:
        reader = csv.DictReader(f)
        for row in reader:
            if row.get("status") in {"ok", "empty"} and row.get("path"):
                done.add(row["path"])
    return done


def qualify_crypto(ib: IB, symbol: str, exchange: str) -> Crypto | None:
    contract = Crypto(symbol_base(symbol), exchange, "USD")
    try:
        qualified = ib.qualifyContracts(contract)
    except Exception as exc:
        log.warning("%s: qualify failed on %s: %s", symbol, exchange, exc)
        return None
    if not qualified:
        log.warning("%s: no qualified contract on %s", symbol, exchange)
        return None
    return qualified[0]


def request_day(
    ib: IB,
    symbol: str,
    contract: Crypto,
    day: date,
    *,
    exchange: str,
    bar_size: str,
    what_to_show: str,
) -> pd.DataFrame:
    end_dt = datetime.combine(day + timedelta(days=1), datetime.min.time(), tzinfo=timezone.utc)
    # IBKR Zero Hash appears to anchor a "1 D" historical crypto request to a
    # 20:00 UTC session boundary. Request two days and filter locally so a
    # requested UTC day is complete.
    duration = "2 D" if bar_size != "1d" else "1 D"
    bars = ib.reqHistoricalData(
        contract,
        endDateTime=end_dt.strftime("%Y%m%d %H:%M:%S UTC"),
        durationStr=duration,
        barSizeSetting=BAR_SIZES[bar_size],
        whatToShow=what_to_show,
        useRTH=False,
        formatDate=1,
    )
    if not bars:
        return pd.DataFrame()
    df = util.df(bars)
    df.insert(0, "symbol", symbol)
    df.insert(1, "exchange", exchange)
    df.insert(2, "bar_size", bar_size)
    df.insert(3, "requested_day", day.isoformat())
    ts = pd.to_datetime(df["date"])
    if ts.dt.tz is None:
        ts = ts.dt.tz_localize("UTC")
    else:
        ts = ts.dt.tz_convert("UTC")
    day_start = pd.Timestamp(day.isoformat(), tz="UTC")
    day_end = day_start + pd.Timedelta(days=1)
    df = df[(ts >= day_start) & (ts < day_end)].copy()
    return df


def write_manifest_row(path: Path, row: dict) -> None:
    exists = path.exists()
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open("a", newline="") as f:
        writer = csv.DictWriter(
            f,
            fieldnames=[
                "timestamp", "symbol", "day", "status", "bars", "path", "message",
            ],
        )
        if not exists:
            writer.writeheader()
        writer.writerow(row)


def format_duration(seconds: float | None) -> str:
    if seconds is None or not pd.notna(seconds) or seconds < 0:
        return "unknown"
    seconds = int(seconds)
    hours, rem = divmod(seconds, 3600)
    minutes, secs = divmod(rem, 60)
    if hours:
        return f"{hours}h{minutes:02d}m"
    if minutes:
        return f"{minutes}m{secs:02d}s"
    return f"{secs}s"


def pending_chunk_count(
    out_dir: Path,
    exchange: str,
    bar_size: str,
    symbols: list[str],
    days: list[date],
    what_to_show: str,
    done_paths: set[str],
    force: bool,
) -> tuple[int, dict[str, int]]:
    by_symbol = {}
    total = 0
    for symbol in symbols:
        count = 0
        for day in days:
            path = chunk_path(out_dir, exchange, bar_size, symbol, day, what_to_show)
            if not force and (path.exists() or empty_marker_path(path).exists() or str(path) in done_paths):
                continue
            count += 1
        by_symbol[symbol] = count
        total += count
    return total, by_symbol


def main() -> None:
    parser = argparse.ArgumentParser(description="Fetch IBKR Zero Hash crypto history (data-only)")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=4002)
    parser.add_argument("--client-id", type=int, default=199)
    parser.add_argument("--symbols", default=None, help="Comma-separated symbols, e.g. BTC-USD,ETH-USD")
    parser.add_argument("--symbols-file", default=DEFAULT_SYMBOLS_FILE)
    parser.add_argument("--exchange", default="ZEROHASH")
    parser.add_argument("--bar-size", default="1min", choices=list(BAR_SIZES))
    parser.add_argument("--what-to-show", default="AGGTRADES")
    parser.add_argument("--start", default=None, help="YYYY-MM-DD")
    parser.add_argument("--end", default=None, help="YYYY-MM-DD, default yesterday UTC unless --include-current-day is set")
    parser.add_argument("--months", type=int, default=3)
    parser.add_argument("--out-dir", default=str(OUT_DIR))
    parser.add_argument("--pacing-delay", type=float, default=0.35)
    parser.add_argument("--retry-delay", type=float, default=5.0)
    parser.add_argument("--retries", type=int, default=1)
    parser.add_argument("--max-symbols", type=int, default=0)
    parser.add_argument("--max-requests", type=int, default=0)
    parser.add_argument("--oldest-first", action="store_true", help="Fetch chronological order instead of newest-to-oldest.")
    parser.add_argument("--include-current-day", action="store_true", help="Include today's incomplete UTC day when --end is omitted.")
    parser.add_argument(
        "--stop-after-leading-empty-days",
        type=int,
        default=7,
        help="In newest-to-oldest mode, stop a symbol after this many consecutive empty older chunks once at least one chunk was fetched.",
    )
    parser.add_argument("--qualify-only", action="store_true", help="Qualify contracts, optionally write them, and exit.")
    parser.add_argument("--qualified-symbols-out", default=None, help="YAML path for symbols that qualify on IBKR.")
    parser.add_argument("--eta-window", type=int, default=12, help="Number of recent fetched chunks to use for rolling ETA.")
    parser.add_argument("--force", action="store_true", help="Refetch chunks even if parquet exists.")
    parser.add_argument("--manifest-dir", type=Path, default=DEFAULT_FETCH_MANIFEST_DIR,
                        help="Directory for dashboard-readable JSON fetch manifests.")
    parser.add_argument("--no-manifest", action="store_true",
                        help="Disable JSON fetch manifest writing.")
    args = parser.parse_args()

    today_utc = datetime.now(timezone.utc).date()
    if args.end:
        end = parse_date(args.end)
    elif args.include_current_day:
        end = today_utc
    else:
        end = today_utc - timedelta(days=1)
    start = parse_date(args.start) if args.start else month_start(args.months, end)
    symbols = load_symbols(args.symbols, args.symbols_file)
    if args.max_symbols:
        symbols = symbols[: args.max_symbols]
    days = date_range(start, end)
    if not args.oldest_first:
        days = list(reversed(days))
    out_dir = Path(args.out_dir)
    chunk_manifest = out_dir / "fetch_manifest.csv"
    done_paths = set() if args.force else load_done_paths(chunk_manifest)
    job_manifest = FetchManifest(
        manifest_dir=args.manifest_dir,
        kind="crypto_history",
        parameters={
            "exchange": args.exchange,
            "bar_size": args.bar_size,
            "what_to_show": args.what_to_show,
            "start": start.isoformat(),
            "end": end.isoformat(),
            "months": args.months,
            "out_dir": display_path(out_dir),
            "chunk_manifest": display_path(chunk_manifest),
            "pacing_delay": args.pacing_delay,
            "retry_delay": args.retry_delay,
            "retries": args.retries,
            "oldest_first": args.oldest_first,
            "include_current_day": args.include_current_day,
            "qualify_only": args.qualify_only,
            "force": args.force,
        },
        symbols=symbols,
        enabled=not args.no_manifest,
    )
    job_manifest.set_plan(
        requested_days=len(days),
        requested_symbol_days=len(symbols) * len(days),
        range_start=start.isoformat(),
        range_end=end.isoformat(),
    )
    manifest_status = "failed"

    log.info(
        "Crypto fetch: symbols=%d days=%d range=%s..%s exchange=%s bar_size=%s",
        len(symbols), len(days), start, end, args.exchange, args.bar_size,
    )

    ib = IB()
    try:
        ib.connect(args.host, args.port, clientId=args.client_id)
    except Exception as exc:
        job_manifest.error("__connection__", str(exc), kind="connection")
        job_manifest.finish("failed")
        raise
    log.info("Connected. Accounts=%s", ib.managedAccounts())
    job_manifest.event("connected", "Connected to IBKR crypto historical data API")
    ib.reqMarketDataType(3)

    requests = 0
    try:
        qualified_contracts: list[tuple[str, Crypto]] = []
        for symbol in symbols:
            contract = qualify_crypto(ib, symbol, args.exchange)
            if contract is not None:
                qualified_contracts.append((symbol, contract))
                job_manifest.symbol(symbol, "qualified")
            else:
                message = f"no qualified contract on {args.exchange}"
                job_manifest.error(symbol, message, kind="contract")
                job_manifest.symbol(symbol, "failed", message=message)
            ib.sleep(args.pacing_delay)
        log.info(
            "Qualified symbols: %d/%d: %s",
            len(qualified_contracts),
            len(symbols),
            ",".join(symbol for symbol, _ in qualified_contracts),
        )
        if args.qualified_symbols_out:
            out = Path(args.qualified_symbols_out)
            out.parent.mkdir(parents=True, exist_ok=True)
            with out.open("w") as f:
                yaml.safe_dump({
                    "description": (
                        "IBKR Zero Hash crypto symbols confirmed by contract "
                        "qualification for this Gateway/account."
                    ),
                    "generated_at": datetime.now(timezone.utc).isoformat(),
                    "exchange": args.exchange,
                    "symbols": [symbol for symbol, _ in qualified_contracts],
                }, f, sort_keys=False)
            log.info("Wrote qualified symbols to %s", out)
        if args.qualify_only:
            manifest_status = None
            return

        qualified_symbols = [symbol for symbol, _ in qualified_contracts]
        raw_pending_total, pending_by_symbol = pending_chunk_count(
            out_dir,
            args.exchange,
            args.bar_size,
            qualified_symbols,
            days,
            args.what_to_show,
            done_paths,
            args.force,
        )
        pending_total = min(raw_pending_total, args.max_requests) if args.max_requests else raw_pending_total
        skipped_total = len(qualified_symbols) * len(days) - raw_pending_total
        log.info(
            "Fetch plan: pending_chunks=%d%s skipped_existing=%d symbols_with_work=%d/%d",
            pending_total,
            f" capped_from={raw_pending_total}" if pending_total != raw_pending_total else "",
            skipped_total,
            sum(1 for count in pending_by_symbol.values() if count),
            len(qualified_symbols),
        )
        job_manifest.set_plan(
            qualified_symbols=qualified_symbols,
            qualified_symbol_count=len(qualified_symbols),
            pending_chunks=pending_total,
            raw_pending_chunks=raw_pending_total,
            skipped_existing_chunks=skipped_total,
            symbols_with_work=sum(1 for count in pending_by_symbol.values() if count),
        )
        if pending_total == 0:
            log.info("Nothing to fetch.")
            for symbol in qualified_symbols:
                job_manifest.symbol(symbol, "skipped", chunks_skipped=len(days), message="all chunks already cached or marked empty")
            manifest_status = None
            return

        chunk_times: deque[float] = deque(maxlen=max(1, args.eta_window))
        completed_chunks = 0
        failed_chunks = 0
        skipped_chunks = skipped_total
        symbols_done = 0

        for symbol_index, (symbol, contract) in enumerate(qualified_contracts, start=1):
            symbol_pending = pending_by_symbol.get(symbol, 0)
            if symbol_pending == 0:
                symbols_done += 1
                job_manifest.symbol(symbol, "skipped", chunks_skipped=len(days), message="no pending chunks")
                log.info(
                    "Symbol complete [%d/%d] %s: no pending chunks (already cached/skipped)",
                    symbols_done,
                    len(qualified_contracts),
                    symbol,
                )
                continue
            log.info(
                "Symbol start [%d/%d] %s pending_chunks=%d",
                symbol_index,
                len(qualified_contracts),
                symbol,
                symbol_pending,
            )
            symbol_completed = 0
            symbol_failed = 0
            symbol_empty = 0
            consecutive_empty = 0
            saw_ok = False
            for day in days:
                path = chunk_path(out_dir, args.exchange, args.bar_size, symbol, day, args.what_to_show)
                path_key = str(path)
                if not args.force and (path.exists() or empty_marker_path(path).exists() or path_key in done_paths):
                    continue
                if args.max_requests and requests >= args.max_requests:
                    log.info("Reached max_requests=%d", args.max_requests)
                    manifest_status = "partial"
                    return
                last_err = None
                chunk_started = time.monotonic()
                for attempt in range(args.retries + 1):
                    try:
                        df = request_day(
                            ib,
                            symbol,
                            contract,
                            day,
                            exchange=args.exchange,
                            bar_size=args.bar_size,
                            what_to_show=args.what_to_show,
                        )
                        last_err = None
                        break
                    except Exception as exc:
                        last_err = exc
                        if attempt < args.retries:
                            time.sleep(args.retry_delay)
                requests += 1
                elapsed = time.monotonic() - chunk_started
                chunk_times.append(elapsed)
                completed_chunks += 1
                symbol_completed += 1
                remaining_chunks = max(0, pending_total - completed_chunks)
                avg_chunk_seconds = sum(chunk_times) / len(chunk_times) if chunk_times else None
                eta = format_duration(avg_chunk_seconds * remaining_chunks if avg_chunk_seconds is not None else None)
                prefix = (
                    f"Progress chunks={completed_chunks}/{pending_total} "
                    f"symbol={symbol} {symbol_completed}/{symbol_pending} "
                    f"remaining={remaining_chunks} eta={eta}"
                )
                if last_err is not None:
                    log.warning("%s %s failed: %s", symbol, day, last_err)
                    failed_chunks += 1
                    symbol_failed += 1
                    log.info("%s status=failed elapsed=%.2fs", prefix, elapsed)
                    write_manifest_row(chunk_manifest, {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "symbol": symbol,
                        "day": day.isoformat(),
                        "status": "failed",
                        "bars": 0,
                        "path": "",
                        "message": str(last_err),
                    })
                    job_manifest.error(symbol, str(last_err), kind=infer_error_kind(str(last_err)), day=day.isoformat())
                    continue
                if df.empty:
                    log.warning("%s %s no bars", symbol, day)
                    marker = empty_marker_path(path)
                    marker.parent.mkdir(parents=True, exist_ok=True)
                    marker.touch()
                    write_manifest_row(chunk_manifest, {
                        "timestamp": datetime.now(timezone.utc).isoformat(),
                        "symbol": symbol,
                        "day": day.isoformat(),
                        "status": "empty",
                        "bars": 0,
                        "path": str(path),
                        "message": "",
                    })
                    job_manifest.output(
                        symbol,
                        path=display_path(path),
                        rows=0,
                        status="empty",
                        day=day.isoformat(),
                        message="HMDS returned no bars for this day",
                    )
                    log.info("%s status=empty elapsed=%.2fs", prefix, elapsed)
                    consecutive_empty += 1
                    symbol_empty += 1
                    if (
                        not args.oldest_first
                        and saw_ok
                        and args.stop_after_leading_empty_days
                        and consecutive_empty >= args.stop_after_leading_empty_days
                    ):
                        log.info(
                            "%s: stopping older history after %d consecutive empty days",
                            symbol,
                            consecutive_empty,
                        )
                        break
                    continue
                path.parent.mkdir(parents=True, exist_ok=True)
                df.to_parquet(path)
                marker = empty_marker_path(path)
                if marker.exists():
                    marker.unlink()
                saw_ok = True
                consecutive_empty = 0
                log.info("%s %s bars=%d -> %s", symbol, day, len(df), path)
                log.info("%s status=ok bars=%d elapsed=%.2fs", prefix, len(df), elapsed)
                write_manifest_row(chunk_manifest, {
                    "timestamp": datetime.now(timezone.utc).isoformat(),
                    "symbol": symbol,
                    "day": day.isoformat(),
                    "status": "ok",
                    "bars": len(df),
                    "path": str(path),
                    "message": "",
                })
                first_ts = df["date"].iloc[0] if "date" in df.columns and not df.empty else None
                last_ts = df["date"].iloc[-1] if "date" in df.columns and not df.empty else None
                job_manifest.output(
                    symbol,
                    path=display_path(path),
                    rows=len(df),
                    status="ok",
                    first_timestamp=first_ts,
                    last_timestamp=last_ts,
                    day=day.isoformat(),
                )
                ib.sleep(args.pacing_delay)
            symbols_done += 1
            if symbol_failed:
                symbol_status = "partial" if (saw_ok or symbol_empty) else "failed"
            elif saw_ok:
                symbol_status = "ok"
            elif symbol_empty:
                symbol_status = "empty"
            else:
                symbol_status = "skipped"
            job_manifest.symbol(
                symbol,
                symbol_status,
                chunks_completed=symbol_completed,
                chunks_failed=symbol_failed,
                chunks_skipped=len(days) - symbol_pending,
            )
            log.info(
                "Symbol complete [%d/%d] %s: fetched=%d failed=%d skipped_existing=%d total_progress=%d/%d eta=%s",
                symbols_done,
                len(qualified_contracts),
                symbol,
                symbol_completed,
                symbol_failed,
                len(days) - symbol_pending,
                completed_chunks,
                pending_total,
                format_duration((sum(chunk_times) / len(chunk_times)) * max(0, pending_total - completed_chunks) if chunk_times else None),
            )
        log.info(
            "Fetch complete: chunks=%d/%d failed=%d skipped_existing=%d",
            completed_chunks,
            pending_total,
            failed_chunks,
            skipped_chunks,
        )
        manifest_status = "partial" if failed_chunks else None
    finally:
        job_manifest.finish(manifest_status)
        ib.disconnect()
        log.info("Disconnected.")


if __name__ == "__main__":
    main()
