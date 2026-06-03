"""Non-viable stock signal plugin.

This demonstrates the stock signal plugin shape and intentionally emits no
signals.
"""

from __future__ import annotations

from datetime import date
from typing import Any

import yaml


class NoEdgeStockSignalPlugin:
    name = "no_edge_stock_signal"
    fieldnames = [
        "date",
        "symbol",
        "accepted",
        "reject_reason",
        "side",
        "intended_entry",
        "stop",
        "target",
    ]
    open_minute = 570
    exit_minute = 955

    def __init__(self, config: dict[str, Any]):
        self.config = config

    def resolve_symbols(self, cfg: dict[str, Any]) -> tuple[list[str], list[str]]:
        path = cfg.get("universe", {}).get("symbols_from")
        if path:
            try:
                with open(path) as f:
                    symbols = list((yaml.safe_load(f) or {}).get("symbols", []))
            except FileNotFoundError:
                symbols = []
        else:
            symbols = []
        index_symbols = list(cfg.get("universe", {}).get("index_confirm_symbols", []))
        return symbols, index_symbols

    def bars_to_daybars(self, bars: list[Any], source_bar_size: str) -> dict[date, Any]:
        return {}

    def latest_date_for(self, panel: dict[str, dict[date, Any]]) -> date | None:
        dates = [d for by_date in panel.values() for d in by_date]
        return max(dates) if dates else None

    def load_historical_panel(
        self,
        symbols: list[str],
        index_symbols: list[str],
        cfg: dict[str, Any],
    ) -> tuple[dict[str, dict[date, Any]], dict[str, dict[date, Any]]]:
        return {}, {}

    def build_signal_rows(
        self,
        cfg: dict[str, Any],
        panel: dict[str, dict[date, Any]],
        index_panel: dict[str, dict[date, Any]],
        target_date: date,
    ) -> list[dict[str, Any]]:
        return []


def create_plugin(config: dict[str, Any]) -> NoEdgeStockSignalPlugin:
    return NoEdgeStockSignalPlugin(config)

