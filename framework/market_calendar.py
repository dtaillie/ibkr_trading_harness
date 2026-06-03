"""Small US stock-market calendar helper for local scheduling.

This covers regular full-day NYSE/Nasdaq closures. It intentionally does not
model rare ad-hoc closures or early closes; those should be handled as explicit
operational overrides if they matter for a trading day.
"""

from __future__ import annotations

from datetime import date, timedelta


def _nth_weekday(year: int, month: int, weekday: int, n: int) -> date:
    first = date(year, month, 1)
    offset = (weekday - first.weekday()) % 7
    return first + timedelta(days=offset + (n - 1) * 7)


def _last_weekday(year: int, month: int, weekday: int) -> date:
    if month == 12:
        last = date(year, month, 31)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    offset = (last.weekday() - weekday) % 7
    return last - timedelta(days=offset)


def _observed_fixed_holiday(year: int, month: int, day: int) -> date:
    actual = date(year, month, day)
    if actual.weekday() == 5:
        return actual - timedelta(days=1)
    if actual.weekday() == 6:
        return actual + timedelta(days=1)
    return actual


def easter_date(year: int) -> date:
    """Return Gregorian Easter Sunday for a year."""
    a = year % 19
    b = year // 100
    c = year % 100
    d = b // 4
    e = b % 4
    f = (b + 8) // 25
    g = (b - f + 1) // 3
    h = (19 * a + b - d - g + 15) % 30
    i = c // 4
    k = c % 4
    l = (32 + 2 * e + 2 * i - h - k) % 7
    m = (a + 11 * h + 22 * l) // 451
    month = (h + l - 7 * m + 114) // 31
    day = ((h + l - 7 * m + 114) % 31) + 1
    return date(year, month, day)


def us_stock_market_holidays(year: int) -> dict[date, str]:
    holidays: dict[date, str] = {
        _observed_fixed_holiday(year, 1, 1): "New Year's Day",
        _nth_weekday(year, 1, 0, 3): "Martin Luther King Jr. Day",
        _nth_weekday(year, 2, 0, 3): "Washington's Birthday",
        easter_date(year) - timedelta(days=2): "Good Friday",
        _last_weekday(year, 5, 0): "Memorial Day",
        _observed_fixed_holiday(year, 7, 4): "Independence Day",
        _nth_weekday(year, 9, 0, 1): "Labor Day",
        _nth_weekday(year, 11, 3, 4): "Thanksgiving Day",
        _observed_fixed_holiday(year, 12, 25): "Christmas Day",
    }
    if year >= 2022:
        holidays[_observed_fixed_holiday(year, 6, 19)] = "Juneteenth"

    # New Year's Day can be observed in the prior calendar year.
    next_new_year = _observed_fixed_holiday(year + 1, 1, 1)
    if next_new_year.year == year:
        holidays[next_new_year] = "New Year's Day"
    return holidays


def market_closed_reason(d: date) -> str | None:
    if d.weekday() >= 5:
        return "weekend"
    holiday = us_stock_market_holidays(d.year).get(d)
    if holiday:
        return f"holiday: {holiday}"
    return None


def is_us_stock_market_day(d: date) -> bool:
    return market_closed_reason(d) is None
