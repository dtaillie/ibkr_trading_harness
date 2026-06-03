"""Generic intraday bar aggregation helpers."""

from __future__ import annotations

from collections import defaultdict
from datetime import date
from typing import Any


MinuteBarMap = dict[date, dict[int, tuple[float, float, float, float, float]]]


def bars_to_minute_buckets(
    bars: list[Any],
    source_bar_size: str,
    *,
    open_minute: int,
    exit_minute: int,
    bucket_minutes: int = 5,
) -> MinuteBarMap:
    by_date: dict[date, dict[int, tuple[float, float, float, float, float]]] = defaultdict(dict)
    if source_bar_size == f"{bucket_minutes}min":
        for bar in bars:
            minute = bar.timestamp.hour * 60 + bar.timestamp.minute
            if open_minute <= minute <= exit_minute:
                by_date[bar.timestamp.date()][minute] = (
                    float(bar.open),
                    float(bar.high),
                    float(bar.low),
                    float(bar.close),
                    float(bar.volume),
                )
    elif source_bar_size == "1min":
        grouped: dict[tuple[date, int], list[Any]] = defaultdict(list)
        for bar in bars:
            minute = bar.timestamp.hour * 60 + bar.timestamp.minute
            if open_minute <= minute <= exit_minute + bucket_minutes - 1:
                bucket = open_minute + ((minute - open_minute) // bucket_minutes) * bucket_minutes
                if bucket <= exit_minute:
                    grouped[(bar.timestamp.date(), bucket)].append(bar)
        for (bar_date, minute), bucket_bars in grouped.items():
            bucket_bars.sort(key=lambda b: b.timestamp)
            by_date[bar_date][minute] = (
                float(bucket_bars[0].open),
                max(float(b.high) for b in bucket_bars),
                min(float(b.low) for b in bucket_bars),
                float(bucket_bars[-1].close),
                sum(float(b.volume) for b in bucket_bars),
            )
    else:
        raise ValueError(f"Unsupported source_bar_size: {source_bar_size}")
    return dict(by_date)

