from datetime import date

from framework.market_calendar import is_us_stock_market_day, market_closed_reason


def test_us_stock_market_calendar_known_2026_holidays():
    assert not is_us_stock_market_day(date(2026, 4, 3))
    assert market_closed_reason(date(2026, 4, 3)) == "holiday: Good Friday"
    assert not is_us_stock_market_day(date(2026, 6, 19))
    assert not is_us_stock_market_day(date(2026, 7, 3))
    assert is_us_stock_market_day(date(2026, 11, 27))


def test_us_stock_market_calendar_future_year_not_hard_coded_to_2026():
    assert not is_us_stock_market_day(date(2027, 1, 1))
    assert not is_us_stock_market_day(date(2027, 3, 26))
    assert is_us_stock_market_day(date(2027, 1, 4))


def test_us_stock_market_calendar_weekend_reason():
    assert market_closed_reason(date(2026, 6, 20)) == "weekend"
