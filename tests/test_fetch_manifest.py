import json

import pytest

from live.fetch_crypto_history import load_json_resume_manifest, option_present
from live.fetch_history import fetch_with_retries, load_stock_resume_manifest, main as stock_fetch_main
from live.fetch_manifest import FetchManifest


def test_fetch_manifest_records_retry_pacing_and_progress(tmp_path):
    manifest = FetchManifest(
        manifest_dir=tmp_path,
        kind="crypto_history",
        parameters={"bar_size": "1min"},
        symbols=["BTC-USD"],
    )

    manifest.retry(
        "BTC-USD",
        "temporary HMDS error",
        day="2026-01-02",
        attempt=1,
        max_retries=2,
        delay_seconds=5.0,
    )
    manifest.pacing_wait(0.35, reason="post historical data request", symbol="BTC-USD", day="2026-01-02")
    manifest.set_progress(
        completed_chunks=1,
        pending_chunks=3,
        remaining_chunks=2,
        completed_symbols=1,
        remaining_symbols=0,
        total_symbols=1,
        rolling_avg_chunk_seconds=0.4,
        rolling_avg_symbol_seconds=0.5,
        eta_seconds=0.8,
        eta="0s",
    )
    manifest.output(
        "BTC-USD",
        path="cache/ibkr_crypto/ZEROHASH/1min/BTC-USD.parquet",
        rows=1440,
        day="2026-01-02",
        elapsed_seconds=0.4,
        attempt_count=2,
    )
    manifest.symbol("BTC-USD", "ok", bars=1440, chunks_completed=1)
    manifest.finish()

    payload = json.loads(manifest.path.read_text(encoding="utf-8"))
    counts = payload["counts"]
    resume_state = payload["resume_state"]
    assert payload["status"] == "completed"
    assert counts["retry_events"] == 1
    assert counts["pacing_wait_events"] == 1
    assert counts["pacing_wait_seconds"] == 0.35
    assert counts["avg_output_elapsed_seconds"] == 0.4
    assert counts["latest_completed_chunks"] == 1
    assert counts["latest_remaining_chunks"] == 2
    assert counts["latest_completed_symbols"] == 1
    assert counts["latest_remaining_symbols"] == 0
    assert counts["latest_total_symbols"] == 1
    assert counts["latest_eta_seconds"] == 0.8
    assert counts["latest_avg_symbol_seconds"] == 0.5
    assert payload["outputs"][0]["attempt_count"] == 2
    assert payload["events"][0]["type"] == "retry"
    assert resume_state["schema_version"] == 1
    assert resume_state["resume_modes"] == ["chunk_path"]
    assert resume_state["done_symbols"] == ["BTC-USD"]
    assert resume_state["completed_output_paths"] == ["cache/ibkr_crypto/ZEROHASH/1min/BTC-USD.parquet"]
    assert resume_state["completed_chunks"][0]["day"] == "2026-01-02"


def test_fetch_manifest_resume_state_tracks_failed_pending_and_no_data(tmp_path):
    manifest = FetchManifest(
        manifest_dir=tmp_path,
        kind="stock_history",
        parameters={"bar_size": "5min"},
        symbols=["SPY", "QQQ", "IWM", "DIA"],
    )
    manifest.symbol("SPY", "ok", bars=10)
    manifest.symbol("QQQ", "empty", bars=0)
    manifest.symbol("IWM", "failed", message="temporary")
    manifest.error("IWM", "temporary HMDS error", kind="connection")
    manifest.error("DIA", "No data returned", kind="no_data")
    manifest.finish("partial")

    payload = json.loads(manifest.path.read_text(encoding="utf-8"))
    resume_state = payload["resume_state"]
    assert resume_state["resume_modes"] == ["symbol"]
    assert resume_state["done_symbols"] == ["QQQ", "SPY"]
    assert resume_state["failed_symbols"] == ["DIA", "IWM"]
    assert resume_state["pending_symbols"] == ["DIA", "IWM"]
    assert resume_state["no_data_symbols"] == ["DIA"]
    assert resume_state["retryable_symbols"] == ["IWM"]


def test_crypto_resume_manifest_extracts_symbols_range_and_done_paths(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(
        json.dumps({
            "parameters": {
                "exchange": "ZEROHASH",
                "bar_size": "1min",
                "what_to_show": "AGGTRADES",
                "out_dir": "cache/ibkr_crypto",
            },
            "plan": {
                "range_start": "2026-01-01",
                "range_end": "2026-01-03",
            },
            "symbols_requested": ["btc-usd", "ETH-USD"],
            "outputs": [
                {"symbol": "BTC-USD", "status": "ok", "day": "2026-01-01", "path": "cache/btc.parquet"},
                {"symbol": "ETH-USD", "status": "empty", "day": "2026-01-01", "path": "cache/eth.parquet"},
                {"symbol": "ETH-USD", "status": "failed", "day": "2026-01-02", "path": "cache/failed.parquet"},
            ],
            "errors": [
                {"symbol": "ETH-USD", "day": "2026-01-02", "message": "temporary"},
            ],
        }),
        encoding="utf-8",
    )

    resume = load_json_resume_manifest(path)

    assert resume["symbols"] == ["BTC-USD", "ETH-USD"]
    assert resume["start"] == "2026-01-01"
    assert resume["end"] == "2026-01-03"
    assert resume["exchange"] == "ZEROHASH"
    assert resume["bar_size"] == "1min"
    assert resume["what_to_show"] == "AGGTRADES"
    assert resume["out_dir"] == "cache/ibkr_crypto"
    assert resume["done_paths"] == {"cache/btc.parquet", "cache/eth.parquet"}
    assert resume["failed_days_by_symbol"] == {"ETH-USD": ["2026-01-02"]}


def test_crypto_resume_manifest_prefers_normalized_resume_state(tmp_path):
    path = tmp_path / "manifest.json"
    path.write_text(
        json.dumps({
            "parameters": {"exchange": "ZEROHASH", "bar_size": "1min"},
            "symbols_requested": ["BTC-USD", "ETH-USD"],
            "outputs": [
                {"symbol": "BTC-USD", "status": "ok", "day": "old", "path": "old.parquet"},
            ],
            "resume_state": {
                "completed_output_paths": ["cache/btc.parquet"],
                "failed_days_by_symbol": {"ETH-USD": ["2026-01-02"]},
            },
        }),
        encoding="utf-8",
    )

    resume = load_json_resume_manifest(path)

    assert resume["done_paths"] == {"cache/btc.parquet"}
    assert resume["failed_days_by_symbol"] == {"ETH-USD": ["2026-01-02"]}


def test_stock_resume_manifest_extracts_symbols_options_and_done_symbols(tmp_path):
    path = tmp_path / "stock_manifest.json"
    path.write_text(
        json.dumps({
            "parameters": {
                "bar_size": "5min",
                "duration": "1 D",
                "months": 0,
                "rth": False,
                "what_to_show": "TRADES",
                "crypto_exchange": "ZEROHASH",
            },
            "plan": {
                "duration": "2 D",
                "months": 0,
            },
            "symbols_requested": ["spy", "QQQ", "IWM"],
            "symbols": {
                "SPY": {"symbol": "SPY", "status": "ok"},
                "QQQ": {"symbol": "QQQ", "status": "empty"},
                "IWM": {"symbol": "IWM", "status": "failed"},
            },
            "errors": [
                {"symbol": "IWM", "message": "temporary HMDS error"},
            ],
        }),
        encoding="utf-8",
    )

    resume = load_stock_resume_manifest(path)

    assert resume["symbols"] == ["SPY", "QQQ", "IWM"]
    assert resume["done_symbols"] == {"SPY", "QQQ"}
    assert resume["failed_symbols"] == {"IWM"}
    assert resume["bar_size"] == "5min"
    assert resume["duration"] == "2 D"
    assert resume["months"] == 0
    assert resume["rth"] is False
    assert resume["what_to_show"] == "TRADES"
    assert resume["crypto_exchange"] == "ZEROHASH"


def test_stock_resume_manifest_prefers_normalized_resume_state(tmp_path):
    path = tmp_path / "stock_manifest.json"
    path.write_text(
        json.dumps({
            "parameters": {"bar_size": "5min", "duration": "1 D"},
            "symbols_requested": ["SPY", "QQQ", "IWM"],
            "symbols": {
                "SPY": {"symbol": "SPY", "status": "failed"},
            },
            "resume_state": {
                "done_symbols": ["QQQ"],
                "failed_symbols": ["SPY", "IWM"],
            },
        }),
        encoding="utf-8",
    )

    resume = load_stock_resume_manifest(path)

    assert resume["done_symbols"] == {"QQQ"}
    assert resume["failed_symbols"] == {"SPY", "IWM"}
    assert resume["symbols"] == ["SPY", "QQQ", "IWM"]


def test_stock_resume_manifest_no_pending_symbols_finishes_without_ibkr(tmp_path):
    resume_path = tmp_path / "stock_manifest.json"
    manifest_dir = tmp_path / "fetch_manifests"
    resume_path.write_text(
        json.dumps({
            "parameters": {"bar_size": "5min", "duration": "1 D", "rth": True},
            "plan": {"duration": "1 D", "months": 0},
            "symbols_requested": ["SPY", "QQQ"],
            "symbols": {
                "SPY": {"symbol": "SPY", "status": "ok"},
                "QQQ": {"symbol": "QQQ", "status": "empty"},
            },
        }),
        encoding="utf-8",
    )

    stock_fetch_main([
        "--resume-manifest", str(resume_path),
        "--manifest-dir", str(manifest_dir),
    ])

    manifests = list(manifest_dir.glob("stock_history_*.json"))
    assert len(manifests) == 1
    payload = json.loads(manifests[0].read_text(encoding="utf-8"))
    assert payload["status"] == "completed"
    assert payload["symbols_requested"] == []
    assert payload["parameters"]["resume_manifest"] == str(resume_path)
    assert payload["plan"]["resume_skipped_symbols"] == 2
    assert payload["events"][0]["type"] == "resume_complete"


def test_option_present_detects_equals_and_split_forms():
    assert option_present(["--bar-size", "1min"], "--bar-size")
    assert option_present(["--bar-size=1min"], "--bar-size")
    assert not option_present(["--bar", "1min"], "--bar-size")


def test_stock_fetch_retry_helper_records_retry_events(tmp_path):
    manifest = FetchManifest(
        manifest_dir=tmp_path,
        kind="stock_history",
        parameters={"bar_size": "5min"},
        symbols=["SPY"],
    )
    attempts = {"count": 0}

    def flaky_fetch():
        attempts["count"] += 1
        if attempts["count"] == 1:
            raise RuntimeError("temporary HMDS error")
        return ["bar"]

    result, attempt_count = fetch_with_retries(
        symbol="SPY",
        operation=flaky_fetch,
        manifest=manifest,
        max_retries=1,
        retry_delay=0,
        sleep_fn=lambda _seconds: None,
    )

    assert result == ["bar"]
    assert attempt_count == 2
    payload = json.loads(manifest.path.read_text(encoding="utf-8"))
    assert payload["counts"]["retry_events"] == 1
    assert payload["events"][0]["symbol"] == "SPY"
    assert payload["events"][0]["attempt"] == 1


def test_stock_fetch_retry_helper_raises_after_retry_budget(tmp_path):
    manifest = FetchManifest(
        manifest_dir=tmp_path,
        kind="stock_history",
        parameters={"bar_size": "5min"},
        symbols=["SPY"],
    )

    with pytest.raises(RuntimeError, match="still broken"):
        fetch_with_retries(
            symbol="SPY",
            operation=lambda: (_ for _ in ()).throw(RuntimeError("still broken")),
            manifest=manifest,
            max_retries=0,
            retry_delay=0,
            sleep_fn=lambda _seconds: None,
        )

    payload = json.loads(manifest.path.read_text(encoding="utf-8"))
    assert payload["counts"]["retry_events"] == 0
