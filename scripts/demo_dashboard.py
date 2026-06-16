#!/usr/bin/env python3
"""Run the dashboard with seeded example data for a zero-setup demo.

Boots the local status receiver/dashboard against a temporary state directory,
seeds it with public-safe example data (sample saved bars and a completed fetch
manifest), and seeds a real telemetry run by replaying the SMA-crossover example
strategy on the bundled synthetic session — so the Performance page shows an
actual equity curve and paired trades, not just summary tiles. Prints the URL
and serves until interrupted. Nothing touches real broker data; no token needed.
"""

from __future__ import annotations

import argparse
import json
import shutil
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from live.plugin_runner import run_from_config
from scripts.cloud_status_server import create_server
from scripts.smoke_dashboard import (
    post_json,
    post_seed_status,
    write_seed_data,
    write_seed_fetch_manifest,
)

EXAMPLE_RUN_ID = "example_sma_crossover"
EXAMPLE_CONFIG = ROOT / "config" / "sma_crossover.example.yaml"
RUN_ARTIFACT_FILES = ["account.jsonl", "fills.jsonl", "decisions.jsonl", "orders.jsonl", "summary.json"]


def _read_jsonl(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return [json.loads(line) for line in path.read_text().splitlines() if line.strip()]


def seed_example_run(base_url: str, runtime_status_root: Path, workdir: Path, *, run_id: str = EXAMPLE_RUN_ID) -> bool:
    """Replay the SMA-crossover example, expose its artifacts, and publish status.

    Returns True if the example run was seeded; False if it could not run (e.g.
    the bundled session data is missing), in which case the caller should fall
    back to the lightweight seed status.
    """
    run_dir = workdir / "sma_run"
    try:
        run_from_config(EXAMPLE_CONFIG, mode_override="simulated_paper", output_dir_override=run_dir)
    except Exception as exc:  # noqa: BLE001 - demo seeding is best-effort
        print(f"(example-run seed skipped: {exc})")
        return False

    artifact_dir = runtime_status_root / run_id
    artifact_dir.mkdir(parents=True, exist_ok=True)
    for name in RUN_ARTIFACT_FILES:
        src = run_dir / name
        if src.exists():
            shutil.copy2(src, artifact_dir / name)

    summary = json.loads((run_dir / "summary.json").read_text())
    account = _read_jsonl(run_dir / "account.jsonl")
    fills = _read_jsonl(run_dir / "fills.jsonl")
    orders = _read_jsonl(run_dir / "orders.jsonl")
    decisions = [d for d in _read_jsonl(run_dir / "decisions.jsonl") if d.get("intents")]
    last_ts = (account[-1]["timestamp"] if account else summary.get("account_end_time"))

    recent_fills = [
        {
            "timestamp": f.get("timestamp"), "symbol": f.get("symbol"), "side": f.get("side"),
            "quantity": round(float(f.get("quantity") or 0), 4),
            "price": round(float(f.get("price") or 0), 2),
            "avg_fill_price": round(float(f.get("avg_fill_price") or 0), 2), "status": "filled",
        }
        for f in fills
    ]
    recent_orders = [
        {
            "timestamp": o.get("timestamp"), "symbol": o.get("symbol"), "side": o.get("side"),
            "order_type": o.get("order_type", "market"),
            "quantity": round(float(o.get("quantity") or 0), 4) if o.get("quantity") else None,
            "status": "Filled",
        }
        for o in orders
    ]
    recent_decisions = [
        {"timestamp": d.get("timestamp"), "symbol": "SPY", "status": (d.get("signal") or {}).get("reason", "signal")}
        for d in decisions
    ]

    payload = {
        "schema_version": 1,
        "node_id": "demo-node",
        "status": "ok",
        "generated_at": last_ts,
        "gateway": {"enabled": True, "reachable": True},
        "runs": [
            {
                "id": run_id,
                "status": "ok",
                "metrics": {
                    "mode": "simulated_paper",
                    "strategy": "sma_crossover (example)",
                    "final_equity": round(float(summary.get("final_equity") or 0), 2),
                    "final_cash": round(float(summary.get("final_cash") or 0), 2),
                    "final_positions": summary.get("final_positions") or {},
                    "account_start_time": summary.get("account_start_time"),
                    "account_end_time": summary.get("account_end_time"),
                    "latest_data_time": summary.get("latest_data_time"),
                    "last_decision_time": (decisions[-1]["timestamp"] if decisions else last_ts),
                    "decisions": summary.get("decisions"),
                    "orders": summary.get("orders", len(orders)),
                    "fills": summary.get("fills", len(fills)),
                    "rejections": summary.get("rejections", 0),
                },
                "recent_events": {
                    "decisions": recent_decisions[-3:],
                    "orders": recent_orders,
                    "fills": recent_fills,
                },
            }
        ],
        "alerts": [
            {
                "level": "warn",
                "kind": "market_data_staleness",
                "message": "Example telemetry is a replay of bundled synthetic data; not a live feed.",
            }
        ],
    }
    post_json(base_url, "/status", payload)
    return True


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the dashboard with seeded demo data")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    workdir = Path(tempfile.mkdtemp(prefix="dashboard_demo_"))
    data_root = workdir / "data"
    manifest_root = workdir / "fetch_manifests"
    state_dir = workdir / "state"
    runtime_status_root = workdir / "runtime_status"
    write_seed_data(data_root)
    write_seed_fetch_manifest(manifest_root, data_root / "SYM000_5min_sample.csv")

    server = create_server(
        args.host,
        args.port,
        state_dir,
        data_roots=[data_root],
        fetch_manifest_roots=[manifest_root],
        plugin_registry_paths=[],
        runtime_status_root=runtime_status_root,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://{args.host}:{server.server_address[1]}"

    if not seed_example_run(base, runtime_status_root, workdir):
        post_seed_status(base)

    print(f"Demo dashboard: {base}/")
    print("Seeded with a replayed example strategy (equity curve + trades), saved bars, and a fetch manifest.")
    print("No broker connection, credentials, or token required. Ctrl+C to stop.")
    try:
        thread.join()
    except KeyboardInterrupt:
        server.shutdown()
        server.server_close()
        print("\nDemo stopped.")


if __name__ == "__main__":
    main()
