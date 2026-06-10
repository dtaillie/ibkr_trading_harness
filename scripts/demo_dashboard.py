#!/usr/bin/env python3
"""Run the dashboard with seeded example data for a zero-setup demo.

Boots the local status receiver/dashboard against a temporary state
directory, seeds it with the same public-safe example payloads the smoke
tests use (one telemetry node with runs/orders/fills/alerts, sample saved
bars, and a completed fetch manifest), prints the URL, and serves until
interrupted. Nothing touches real broker data and no token is required.
"""

from __future__ import annotations

import argparse
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.cloud_status_server import create_server
from scripts.smoke_dashboard import post_seed_status, write_seed_data, write_seed_fetch_manifest


def main() -> None:
    parser = argparse.ArgumentParser(description="Serve the dashboard with seeded demo data")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=8765)
    args = parser.parse_args()

    workdir = Path(tempfile.mkdtemp(prefix="dashboard_demo_"))
    data_root = workdir / "data"
    manifest_root = workdir / "fetch_manifests"
    state_dir = workdir / "state"
    write_seed_data(data_root)
    write_seed_fetch_manifest(manifest_root, data_root / "SYM000_5min_sample.csv")

    server = create_server(
        args.host,
        args.port,
        state_dir,
        data_roots=[data_root],
        fetch_manifest_roots=[manifest_root],
        plugin_registry_paths=[],
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://{args.host}:{server.server_address[1]}"
    post_seed_status(base)

    print(f"Demo dashboard: {base}/")
    print("Seeded with example telemetry, saved bars, and a fetch manifest.")
    print("No broker connection, credentials, or token required. Ctrl+C to stop.")
    try:
        thread.join()
    except KeyboardInterrupt:
        server.shutdown()
        server.server_close()
        print("\nDemo stopped.")


if __name__ == "__main__":
    main()
