#!/usr/bin/env python3
"""Build an IBKR probe universe from Zero Hash PROD instruments.

The Zero Hash docs list tradable instruments like BONK.SOL/USD. IBKR historical
data qualification appears to use the base symbol, so this script converts those
instruments to probe symbols like BONK-USD while preserving the original
instrument metadata.
"""

from __future__ import annotations

import argparse
from datetime import datetime, timezone
from html import unescape
from html.parser import HTMLParser
from pathlib import Path
from urllib.request import Request, urlopen

import yaml


PROD_INSTRUMENTS_URL = "https://docs.zerohash.com/page/production-environment"
DEFAULT_OUT = Path("config/crypto_universe_zerohash_prod_instruments.yaml")
STABLECOIN_BASES = {
    "BUSD",
    "DAI",
    "EURC",
    "GYEN",
    "PYUSD",
    "RLUSD",
    "TUSD",
    "USDC",
    "USDCX",
    "USDP",
    "USDS",
    "USDT",
    "ZUSD",
}


class TableParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.in_td = False
        self.cur_cell: list[str] = []
        self.cur_row: list[str] = []
        self.rows: list[list[str]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        if tag == "td":
            self.in_td = True
            self.cur_cell = []

    def handle_endtag(self, tag: str) -> None:
        if tag == "td" and self.in_td:
            text = " ".join("".join(self.cur_cell).split())
            self.cur_row.append(unescape(text))
            self.in_td = False
        elif tag == "tr" and self.cur_row:
            self.rows.append(self.cur_row)
            self.cur_row = []

    def handle_data(self, data: str) -> None:
        if self.in_td:
            self.cur_cell.append(data)


def base_from_instrument(symbol: str, underlying: str) -> str:
    raw = (underlying or symbol.split("/", 1)[0]).split(".", 1)[0]
    return raw.upper()


def load_rows(url: str) -> list[list[str]]:
    req = Request(url, headers={"User-Agent": "Mozilla/5.0"})
    with urlopen(req, timeout=30) as response:
        html = response.read().decode("utf-8", "replace")
    parser = TableParser()
    parser.feed(html)
    return parser.rows


def build_universe(rows: list[list[str]], *, include_stablecoins: bool) -> dict:
    instruments = []
    probe_symbols = []
    seen = set()
    for row in rows:
        if len(row) < 9 or "/" not in row[0]:
            continue
        symbol, underlying, quote, rfq, price_precision, qty_precision, min_notional, max_notional, clob = row[:9]
        if quote != "USD":
            continue
        base = base_from_instrument(symbol, underlying)
        if not include_stablecoins and base in STABLECOIN_BASES:
            continue
        probe_symbol = f"{base}-USD"
        instruments.append({
            "instrument": symbol,
            "underlying": underlying,
            "quote": quote,
            "ibkr_probe_symbol": probe_symbol,
            "rfq_support": rfq,
            "clob_support": clob,
            "rfq_min_trade_notional": min_notional,
            "rfq_max_trade_notional": max_notional,
            "rfq_price_precision": price_precision,
            "rfq_quantity_precision": qty_precision,
        })
        if probe_symbol not in seen:
            probe_symbols.append(probe_symbol)
            seen.add(probe_symbol)
    return {
        "description": (
            "IBKR probe universe derived from Zero Hash PROD USD instruments. "
            "Symbols are not guaranteed to qualify through IBKR; run "
            "live/fetch_crypto_history.py --qualify-only to confirm account support."
        ),
        "source": PROD_INSTRUMENTS_URL,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "include_stablecoins": include_stablecoins,
        "symbols": probe_symbols,
        "instruments": instruments,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Build Zero Hash PROD crypto probe universe")
    parser.add_argument("--url", default=PROD_INSTRUMENTS_URL)
    parser.add_argument("--out", default=str(DEFAULT_OUT))
    parser.add_argument("--include-stablecoins", action="store_true")
    args = parser.parse_args()

    rows = load_rows(args.url)
    universe = build_universe(rows, include_stablecoins=args.include_stablecoins)
    out = Path(args.out)
    out.parent.mkdir(parents=True, exist_ok=True)
    with out.open("w") as f:
        yaml.safe_dump(universe, f, sort_keys=False)
    print(
        f"Wrote {len(universe['symbols'])} probe symbols from "
        f"{len(universe['instruments'])} USD instruments to {out}"
    )


if __name__ == "__main__":
    main()
