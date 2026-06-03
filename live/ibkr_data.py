"""IBKR historical data fetcher — for intraday bars not available from yfinance."""

from __future__ import annotations

import logging
import os
from datetime import datetime, timedelta, timezone
from pathlib import Path

import pandas as pd
from ib_insync import IB, Stock, Crypto, util

from core import Bar

log = logging.getLogger(__name__)

CACHE_DIR = Path(__file__).resolve().parent.parent / "cache" / "ibkr"

# IBKR bar size strings — must match exactly
BAR_SIZES = {
    "1min": "1 min",
    "5min": "5 mins",
    "15min": "15 mins",
    "30min": "30 mins",
    "1h": "1 hour",
    "1d": "1 day",
}

# Max duration per request, by bar size — IBKR limits
MAX_CHUNK = {
    "1min": "1 D",
    "5min": "1 M",
    "15min": "1 M",
    "30min": "2 M",
    "1h": "1 Y",
    "1d": "10 Y",
}


DEFAULT_CRYPTO_EXCHANGE = os.getenv("IBKR_CRYPTO_EXCHANGE", "ZEROHASH")


def _make_contract(symbol: str, crypto_exchange: str | None = None):
    if symbol.endswith("-USD"):
        return Crypto(symbol.split("-")[0], crypto_exchange or DEFAULT_CRYPTO_EXCHANGE, "USD")
    return Stock(symbol, "SMART", "USD")


def fetch_ibkr_bars(
    ib: IB,
    symbol: str,
    duration: str,
    bar_size: str,
    end_datetime: str = "",
    use_rth: bool = True,
    use_cache: bool = True,
    what_to_show: str | None = None,
    crypto_exchange: str | None = None,
) -> list[Bar]:
    """
    Fetch historical bars from IBKR.

    Args:
        ib: connected IB instance
        symbol: ticker
        duration: e.g. "1 D", "5 D", "1 M", "1 Y"
        bar_size: key from BAR_SIZES (e.g. "5min")
        end_datetime: "" for now, or "YYYYMMDD HH:MM:SS"
        use_rth: regular trading hours only (vs extended)
        use_cache: read/write parquet cache
        what_to_show: IBKR historical data type override. Defaults to TRADES.
        crypto_exchange: IBKR crypto venue override. Defaults to IBKR_CRYPTO_EXCHANGE or ZEROHASH.
    """
    if bar_size not in BAR_SIZES:
        raise ValueError(f"Unknown bar_size: {bar_size}. Use one of {list(BAR_SIZES)}")

    # Build cache key
    # Cache filename uses an end_datetime canonicalised to "YYYYMMDD_HHMMSS"
    # regardless of the on-wire format (which may carry "-" / " UTC" suffixes).
    # Keeps cache filenames stable across format changes.
    end_label = (
        end_datetime
        .replace(" UTC", "")
        .replace("-", "_")
        .replace(" ", "_")
        .replace(":", "")
    ) or "now"
    show_label = what_to_show or ("AGGTRADES" if symbol.endswith("-USD") else "TRADES")
    crypto_exchange_label = crypto_exchange or DEFAULT_CRYPTO_EXCHANGE
    venue_label = crypto_exchange_label if symbol.endswith("-USD") else "SMART"
    cache_path = (
        CACHE_DIR
        / f"{symbol}_{bar_size}_{duration.replace(' ','')}_{end_label}_{show_label}_{venue_label}_rth{use_rth}.parquet"
    )

    if use_cache and cache_path.exists():
        df = pd.read_parquet(cache_path)
    else:
        # Use delayed data (3) — works for paper accounts without live data subscription
        ib.reqMarketDataType(3)
        contract = _make_contract(symbol, crypto_exchange=crypto_exchange_label)
        ib.qualifyContracts(contract)
        # IBKR's historical data table marks AGGTRADES as crypto-only. Keep
        # the default crypto request aligned with that while allowing callers
        # to override the feed for entitlement/provider probes.
        ib_bars = ib.reqHistoricalData(
            contract,
            endDateTime=end_datetime,
            durationStr=duration,
            barSizeSetting=BAR_SIZES[bar_size],
            whatToShow=show_label,
            useRTH=use_rth,
            formatDate=1,
        )
        if not ib_bars:
            raise ValueError(f"No data returned for {symbol} ({bar_size}, {duration})")
        df = util.df(ib_bars)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        df.to_parquet(cache_path)

    bars: list[Bar] = []
    for _, row in df.iterrows():
        ts = row["date"]
        if isinstance(ts, str):
            ts = pd.to_datetime(ts)
        if hasattr(ts, "to_pydatetime"):
            ts = ts.to_pydatetime()
        bars.append(
            Bar(
                symbol=symbol,
                timestamp=ts,
                open=float(row["open"]),
                high=float(row["high"]),
                low=float(row["low"]),
                close=float(row["close"]),
                volume=float(row["volume"]),
            )
        )
    return bars


def _months_between(end: datetime, n: int) -> datetime:
    """Subtract n months from a datetime."""
    year = end.year
    month = end.month - n
    while month <= 0:
        month += 12
        year -= 1
    day = min(end.day, 28)  # safe day for any month
    return end.replace(year=year, month=month, day=day)


def _cached_files_for_symbol(symbol: str, bar_size: str, use_rth: bool) -> list[Path]:
    if not CACHE_DIR.exists():
        return []
    pattern = f"{symbol}_{bar_size}_*_rth{use_rth}.parquet"
    return list(CACHE_DIR.glob(pattern))


def _earliest_cached_timestamp(
    symbol: str,
    bar_size: str,
    use_rth: bool,
) -> datetime | None:
    """Cheap pre-scan: find earliest cached bar timestamp by reading only
    the 'date' column from each cached parquet. Used to short-circuit
    fetch_ibkr_bars_chunked on resume without paying the full row-decode cost.
    Returns None if no cache exists for this symbol.
    """
    files = _cached_files_for_symbol(symbol, bar_size, use_rth)
    if not files:
        return None
    earliest = None
    for fpath in files:
        try:
            df = pd.read_parquet(fpath, columns=["date"])
        except Exception:
            continue
        if df.empty:
            continue
        ts = df["date"].min()
        if isinstance(ts, str):
            ts = pd.to_datetime(ts)
        if hasattr(ts, "to_pydatetime"):
            ts = ts.to_pydatetime()
        if ts.tzinfo is None:
            ts = ts.replace(tzinfo=timezone.utc)
        else:
            ts = ts.astimezone(timezone.utc)
        if earliest is None or ts < earliest:
            earliest = ts
    return earliest


def _load_cached_bars_for_symbol(
    symbol: str,
    bar_size: str,
    use_rth: bool,
) -> list[Bar]:
    """Load every cached parquet for this (symbol, bar_size, use_rth) and
    return the union of bars, sorted ascending, deduped by timestamp.
    Uses itertuples (10-100x faster than iterrows on wide dataframes).
    """
    files = _cached_files_for_symbol(symbol, bar_size, use_rth)
    if not files:
        return []
    all_bars: dict[datetime, Bar] = {}
    for fpath in files:
        try:
            df = pd.read_parquet(fpath)
        except Exception:
            continue
        for row in df.itertuples(index=False):
            ts = row.date
            if isinstance(ts, str):
                ts = pd.to_datetime(ts)
            if hasattr(ts, "to_pydatetime"):
                ts = ts.to_pydatetime()
            all_bars[ts] = Bar(
                symbol=symbol,
                timestamp=ts,
                open=float(row.open),
                high=float(row.high),
                low=float(row.low),
                close=float(row.close),
                volume=float(row.volume),
            )
    return sorted(all_bars.values(), key=lambda b: b.timestamp)


def fetch_ibkr_bars_chunked(
    ib: IB,
    symbol: str,
    bar_size: str,
    months: int = 12,
    use_rth: bool = True,
    use_cache: bool = True,
    pacing_delay: float = 0.5,
    retries_per_chunk: int = 1,
    retry_delay: float = 5.0,
) -> list[Bar]:
    """
    Fetch a long history by making multiple chunked requests.

    Walks backwards from now in chunks of MAX_CHUNK[bar_size], stitches together.
    Adds pacing_delay seconds between chunks to stay under IBKR rate limits.

    Resume optimization: cache files are wall-clock-keyed (end_label =
    second-precision now()), so chunk 1 cache-misses on every restart and
    forces a fresh IBKR roundtrip. To avoid burning ~2hr of redundant calls
    on resume across 800+ symbols, pre-scan the cache for this symbol and
    set end_dt to the earliest cached timestamp — IBKR is only called for
    chunks strictly older than what we already have.
    """
    import time
    chunk_str = MAX_CHUNK[bar_size]
    # parse "1 M" -> 1 month, "2 M" -> 2 months, "1 D" -> 1 day, "1 Y" -> 12 months
    n, unit = chunk_str.split()
    n = int(n)
    chunk_months = {"D": n / 22.0, "W": n / 4.5, "M": float(n), "Y": float(n) * 12}[unit]

    # Tz-aware UTC throughout. IBKR Warning 2174 deprecates implicit-tz
    # datetime strings; using the explicit "yyyymmdd-hh:mm:ss UTC" form
    # avoids parser-fallback bugs (one observed: 1-min "1 D" chunks with
    # naive end_datetime got reinterpreted as "now" every iteration, so
    # end_dt never advanced and the script looped on today's data).
    end_dt = datetime.now(timezone.utc)
    target_dt = _months_between(end_dt, months)

    all_bars: dict[datetime, Bar] = {}

    # Cheap pre-scan: find earliest cached bar timestamp without decoding
    # all rows. If it already reaches target_dt, return cached bars directly.
    # Otherwise advance end_dt to the earliest cached timestamp so the loop
    # only fetches chunks strictly older than what we already have. This
    # avoids the chunk-1 cache-miss on resume (cache key is wall-clock-keyed
    # via end_label = second-precision now()).
    have_partial_cache = False
    if use_cache:
        earliest_cached = _earliest_cached_timestamp(symbol, bar_size, use_rth)
        if earliest_cached is not None:
            if earliest_cached <= target_dt:
                log.info(
                    f"  cache covers {symbol} back to {earliest_cached.date()} "
                    f"(target {target_dt.date()}) — skipping IBKR"
                )
                return _load_cached_bars_for_symbol(symbol, bar_size, use_rth)
            log.info(
                f"  cache covers {symbol} back to {earliest_cached.date()}; "
                f"fetching only earlier chunks"
            )
            end_dt = earliest_cached
            have_partial_cache = True

    first_chunk = True
    while end_dt > target_dt:
        if not first_chunk and pacing_delay > 0:
            time.sleep(pacing_delay)
        first_chunk = False
        # Skip weekends — IBKR's HMDS returns Error 162 for Sat/Sun and the
        # retry-with-backoff would burn ~210s per weekend day (4 attempts at
        # 30/60/120s backoff). Snap end_dt back to the most recent weekday
        # before requesting. ~104 weekend days/year × 210s = ~6hr of wasted
        # fetcher time per symbol otherwise.
        while end_dt.weekday() >= 5:  # Saturday=5, Sunday=6
            end_dt = end_dt - timedelta(days=1)
        # IBKR's "yyyymmdd-hh:mm:ss" form is implicitly UTC — DO NOT append " UTC"
        # (that's the parser-rejected hybrid). The OTHER valid form is "yyyymmdd
        # hh:mm:ss US/Eastern" (space + tz name).
        end_str = end_dt.strftime("%Y%m%d-%H:%M:%S")
        log.info(f"  chunk ending {end_dt.date()}, duration={chunk_str}")
        chunk = None
        last_err: Exception | None = None
        # Retry loop: many "no data" responses for popular liquid names are
        # transient (IBKR pacing throttle, server-side hiccup) — same chunk
        # often succeeds on a retry after a brief delay. Without retries,
        # ~65% of chunks for popular S&P 500 mid-caps fail spuriously,
        # leaving heavily-pockmarked coverage.
        for attempt in range(retries_per_chunk + 1):
            try:
                chunk = fetch_ibkr_bars(
                    ib, symbol,
                    duration=chunk_str,
                    bar_size=bar_size,
                    end_datetime=end_str,
                    use_rth=use_rth,
                    use_cache=use_cache,
                )
                last_err = None
                break
            except Exception as e:
                last_err = e
                if attempt < retries_per_chunk:
                    # 1 retry × 5s: handles brief network blips. Empirically,
                    # longer/more retries (3 × 30/60/120s) didn't recover
                    # chunks — adjacent-date chunks succeeded instantly while
                    # specific-date chunks failed all retries, indicating
                    # genuine IBKR data gaps not pacing throttle. Burning
                    # ~210s per failed chunk made total fetch infeasible.
                    time.sleep(retry_delay)

        if last_err is not None:
            log.warning(f"  chunk failed after {retries_per_chunk + 1} attempts: {last_err}")
            # Step back by ONE chunk-width on persistent failure (not always
            # 1 month). Old code stepped 1 month for any sub-month chunk
            # which gave ~13 sampled days/symbol instead of 252 for 1-min.
            if unit == "D":
                end_dt = end_dt - timedelta(days=n)
            elif unit == "W":
                end_dt = end_dt - timedelta(weeks=n)
            else:
                end_dt = _months_between(end_dt, max(1, int(chunk_months)))
            continue

        for b in chunk:
            all_bars[b.timestamp] = b
        if not chunk:
            break
        # Step back to first bar's timestamp, normalised to UTC for
        # consistent < / > comparison with end_dt and target_dt.
        first_ts = chunk[0].timestamp
        if first_ts.tzinfo is not None:
            first_ts = first_ts.astimezone(timezone.utc)
        else:
            first_ts = first_ts.replace(tzinfo=timezone.utc)
        end_dt = first_ts

    if have_partial_cache:
        for b in _load_cached_bars_for_symbol(symbol, bar_size, use_rth):
            ts = b.timestamp
            if ts.tzinfo is None:
                ts = ts.replace(tzinfo=timezone.utc)
            else:
                ts = ts.astimezone(timezone.utc)
            if ts not in all_bars:
                all_bars[ts] = b

    return sorted(all_bars.values(), key=lambda b: b.timestamp)
