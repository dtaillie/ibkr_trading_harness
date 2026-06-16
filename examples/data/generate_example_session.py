"""Generate the bundled example intraday session (SYNTHETIC, illustrative only).

EXAMPLE ONLY. This writes one small, fully synthetic 5-minute bar file
(SPY-shaped, one regular-trading-hours session) used purely to demonstrate the
example strategy plugins end to end. The price path is hand-shaped so the
educational SMA-crossover, RSI mean-reversion, and opening-range-breakout
examples each produce a visible round trip; it is NOT market data and has no
predictive value. Do not use it for research.

Run:  python3 examples/data/generate_example_session.py
Writes: examples/data/SPY_5min_session.csv
"""

from __future__ import annotations

import csv
import math
from datetime import datetime, timedelta, timezone
from pathlib import Path

HERE = Path(__file__).resolve().parent
N_BARS = 78  # 09:30->16:00 ET, 5-minute bars (last bar opens 15:55 ET)
SESSION_START = datetime(2026, 1, 2, 14, 30, tzinfo=timezone.utc)  # 09:30 ET (EST)

# (bar_index, close) anchor points, linearly interpolated. The shape:
#   - bars 0-5    opening range chop (~470.0-470.4) -> ORB high near 470.8
#   - bars 5-20   steady decline to ~466.2          -> RSI oversold near the low
#   - bars 20-32  recovery breaking the opening-range high -> ORB long, SMA cross up
#   - bars 32-52  uptrend to ~474.2 (hits ORB 2R target, RSI exit)
#   - bars 52-70  rollover back to ~471.3            -> SMA cross down (exit)
#   - bars 70-77  drift into the close
SPY_ANCHORS = [
    (0, 470.0), (5, 470.4), (12, 468.5), (20, 466.2), (26, 468.0),
    (32, 471.2), (45, 473.5), (52, 474.2), (60, 472.8), (70, 472.3), (77, 472.6),
]


def _interp(anchors: list[tuple[int, float]], t: int) -> float:
    for (a_t, a_v), (b_t, b_v) in zip(anchors, anchors[1:]):
        if a_t <= t <= b_t:
            frac = 0.0 if b_t == a_t else (t - a_t) / (b_t - a_t)
            return a_v + (b_v - a_v) * frac
    return anchors[-1][1]


def _closes(scale: float = 1.0) -> list[float]:
    out = []
    for t in range(N_BARS):
        base = _interp(SPY_ANCHORS, t) * scale
        ripple = 0.10 * scale * math.sin(1.3 * t)  # gentle intrabar wobble
        out.append(round(base + ripple, 2))
    return out


def _rows(scale: float = 1.0) -> list[dict]:
    closes = _closes(scale)
    rows = []
    prev_close = closes[0]
    for t in range(N_BARS):
        ts = SESSION_START + timedelta(minutes=5 * t)
        close = closes[t]
        open_ = prev_close if t > 0 else round(closes[0] - 0.05 * scale, 2)
        hi_pad = (0.18 + 0.10 * abs(math.sin(0.7 * t))) * scale
        lo_pad = (0.16 + 0.10 * abs(math.cos(0.6 * t))) * scale
        high = round(max(open_, close) + hi_pad, 2)
        low = round(min(open_, close) - lo_pad, 2)
        volume = int(80_000 + 40_000 * abs(math.sin(0.5 * t)) + (15_000 if t < 6 else 0))
        rows.append({
            "timestamp": ts.strftime("%Y-%m-%dT%H:%M:%SZ"),
            "open": f"{open_:.2f}", "high": f"{high:.2f}",
            "low": f"{low:.2f}", "close": f"{close:.2f}", "volume": volume,
        })
        prev_close = close
    return rows


def _write(path: Path, rows: list[dict]) -> None:
    with path.open("w", newline="", encoding="utf-8") as fh:
        writer = csv.DictWriter(fh, fieldnames=["timestamp", "open", "high", "low", "close", "volume"])
        writer.writeheader()
        writer.writerows(rows)


# --- signal preview (verification only; not used by the runner) ----------------
def _sma(values: list[float], window: int) -> list[float | None]:
    out: list[float | None] = []
    for i in range(len(values)):
        out.append(sum(values[i - window + 1:i + 1]) / window if i >= window - 1 else None)
    return out


def _rsi(values: list[float], period: int = 14) -> list[float | None]:
    out: list[float | None] = [None] * len(values)
    gains, losses = 0.0, 0.0
    for i in range(1, len(values)):
        change = values[i] - values[i - 1]
        gain, loss = max(change, 0.0), max(-change, 0.0)
        if i <= period:
            gains += gain
            losses += loss
            if i == period:
                avg_g, avg_l = gains / period, losses / period
                out[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
        else:
            avg_g = (avg_g * (period - 1) + gain) / period
            avg_l = (avg_l * (period - 1) + loss) / period
            out[i] = 100.0 if avg_l == 0 else 100 - 100 / (1 + avg_g / avg_l)
    return out


def _preview(rows: list[dict]) -> None:
    closes = [float(r["close"]) for r in rows]
    highs = [float(r["high"]) for r in rows]
    lows = [float(r["low"]) for r in rows]
    sma_f, sma_s = _sma(closes, 5), _sma(closes, 20)
    rsi = _rsi(closes, 14)
    print(f"  bars={len(rows)} close range {min(closes):.2f}-{max(closes):.2f}")
    # SMA crossovers
    for i in range(1, len(closes)):
        if sma_f[i] is None or sma_s[i] is None or sma_f[i - 1] is None or sma_s[i - 1] is None:
            continue
        if sma_f[i - 1] <= sma_s[i - 1] and sma_f[i] > sma_s[i]:
            print(f"  SMA5/20 cross UP   @bar {i} close {closes[i]:.2f}")
        if sma_f[i - 1] >= sma_s[i - 1] and sma_f[i] < sma_s[i]:
            print(f"  SMA5/20 cross DOWN @bar {i} close {closes[i]:.2f}")
    # RSI oversold/exit
    below = [i for i, v in enumerate(rsi) if v is not None and v < 30]
    if below:
        print(f"  RSI<30 oversold first @bar {below[0]} (rsi {rsi[below[0]]:.1f}, close {closes[below[0]]:.2f})")
    above = [i for i, v in enumerate(rsi) if v is not None and v > 52 and i > (below[0] if below else 0)]
    if above:
        print(f"  RSI>52 exit first     @bar {above[0]} (rsi {rsi[above[0]]:.1f}, close {closes[above[0]]:.2f})")
    # ORB (first 6 bars define the range)
    rng_hi, rng_lo = max(highs[:6]), min(lows[:6])
    rng = rng_hi - rng_lo
    target = rng_hi + 2.0 * rng
    print(f"  ORB range hi/lo {rng_hi:.2f}/{rng_lo:.2f} (2R target {target:.2f})")
    breakout = next((i for i in range(6, len(closes)) if closes[i] > rng_hi), None)
    if breakout is not None:
        print(f"  ORB breakout > {rng_hi:.2f} @bar {breakout} close {closes[breakout]:.2f}")
        hit = next((i for i in range(breakout, len(closes)) if closes[i] >= target), None)
        print(f"  ORB target {target:.2f} hit @bar {hit} close {closes[hit]:.2f}" if hit else "  ORB target not hit (would exit at session end)")


def main() -> None:
    spy = _rows(1.0)
    _write(HERE / "SPY_5min_session.csv", spy)
    print("Wrote SPY_5min_session.csv (SYNTHETIC, example only)")
    print("SPY signal preview:")
    _preview(spy)


if __name__ == "__main__":
    main()
