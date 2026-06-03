#!/usr/bin/env python3
"""Exit 0 when a date is a regular US stock-market day."""

from __future__ import annotations

import argparse
import sys
from datetime import date
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parent.parent))

from framework.market_calendar import market_closed_reason


def main() -> None:
    parser = argparse.ArgumentParser(description="Check regular US stock-market trading day")
    parser.add_argument("--date", required=True, help="Date in YYYY-MM-DD format")
    args = parser.parse_args()

    day = date.fromisoformat(args.date)
    reason = market_closed_reason(day)
    if reason is None:
        print("market_day")
        raise SystemExit(0)
    print(reason)
    raise SystemExit(1)


if __name__ == "__main__":
    main()
