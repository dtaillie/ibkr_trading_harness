import json

from live.fetch_crypto_history import load_json_resume_manifest, option_present
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
        rolling_avg_chunk_seconds=0.4,
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
    assert payload["status"] == "completed"
    assert counts["retry_events"] == 1
    assert counts["pacing_wait_events"] == 1
    assert counts["pacing_wait_seconds"] == 0.35
    assert counts["avg_output_elapsed_seconds"] == 0.4
    assert counts["latest_completed_chunks"] == 1
    assert counts["latest_remaining_chunks"] == 2
    assert counts["latest_eta_seconds"] == 0.8
    assert payload["outputs"][0]["attempt_count"] == 2
    assert payload["events"][0]["type"] == "retry"


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


def test_option_present_detects_equals_and_split_forms():
    assert option_present(["--bar-size", "1min"], "--bar-size")
    assert option_present(["--bar-size=1min"], "--bar-size")
    assert not option_present(["--bar", "1min"], "--bar-size")
