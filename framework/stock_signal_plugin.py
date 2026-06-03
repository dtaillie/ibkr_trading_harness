"""Protocol for stock intraday signal plugins used by paper/shadow runners."""

from __future__ import annotations

from datetime import date
from typing import Any, Protocol


class StockSignalPlugin(Protocol):
    name: str
    fieldnames: list[str]
    open_minute: int
    exit_minute: int

    def resolve_symbols(self, cfg: dict[str, Any]) -> tuple[list[str], list[str]]:
        """Return tradable universe symbols and index/control symbols."""

    def bars_to_daybars(self, bars: list[Any], source_bar_size: str) -> dict[date, Any]:
        """Convert raw bars into plugin-specific day-bar structures."""

    def latest_date_for(self, panel: dict[str, dict[date, Any]]) -> date | None:
        """Return latest available date in a panel."""

    def load_historical_panel(
        self,
        symbols: list[str],
        index_symbols: list[str],
        cfg: dict[str, Any],
    ) -> tuple[dict[str, dict[date, Any]], dict[str, dict[date, Any]]]:
        """Load historical context needed by the signal plugin."""

    def build_signal_rows(
        self,
        cfg: dict[str, Any],
        panel: dict[str, dict[date, Any]],
        index_panel: dict[str, dict[date, Any]],
        target_date: date,
    ) -> list[dict[str, Any]]:
        """Build signal/reject rows for the target date."""

