#!/usr/bin/env python3
"""Capture lightweight desktop/mobile dashboard screenshots with Chrome."""

from __future__ import annotations

import argparse
import json
import shutil
import subprocess
import sys
import tempfile
import threading
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.cloud_status_server import DEFAULT_DASHBOARD_DIR, create_server
from scripts.smoke_dashboard import post_seed_status, write_seed_data, write_seed_fetch_manifest


VIEWS = ("overview", "performance", "data", "fetch", "workbench", "runs", "operations", "help")
VIEWPORTS = {
    "desktop": (1366, 900),
    "mobile": (390, 844),
}


def find_chrome(explicit: str | None = None) -> str:
    candidates = [explicit] if explicit else []
    candidates.extend(["google-chrome", "chromium", "chromium-browser"])
    for candidate in candidates:
        if not candidate:
            continue
        path = shutil.which(candidate)
        if path:
            return path
    raise RuntimeError("Chrome/Chromium executable not found")


def prepare_seed_state(state_dir: Path) -> tuple[list[Path], list[Path]]:
    data_root = state_dir / "screenshot_seed_data"
    manifest_root = state_dir / "screenshot_seed_fetch_manifests"
    paths = write_seed_data(data_root)
    write_seed_fetch_manifest(manifest_root, paths[0])
    return [data_root], [manifest_root]


def capture_png(
    *,
    chrome: str,
    url: str,
    output: Path,
    width: int,
    height: int,
    min_bytes: int,
) -> dict:
    output.parent.mkdir(parents=True, exist_ok=True)
    command = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--run-all-compositor-stages-before-draw",
        "--virtual-time-budget=3000",
        f"--window-size={width},{height}",
        f"--screenshot={output}",
        url,
    ]
    completed = subprocess.run(command, capture_output=True, text=True, timeout=30, check=False)
    if completed.returncode != 0:
        raise RuntimeError(f"Chrome failed for {url}: {completed.stderr.strip() or completed.stdout.strip()}")
    if not output.exists():
        raise RuntimeError(f"Chrome did not write screenshot: {output}")
    size = output.stat().st_size
    if size < min_bytes:
        raise RuntimeError(f"Screenshot is too small ({size} bytes): {output}")
    with output.open("rb") as handle:
        signature = handle.read(8)
    if signature != b"\x89PNG\r\n\x1a\n":
        raise RuntimeError(f"Screenshot is not a PNG: {output}")
    return {"path": str(output), "bytes": size, "width": width, "height": height}


def run_screenshot_smoke(
    *,
    chrome: str,
    host: str,
    port: int,
    state_dir: Path,
    dashboard_dir: Path,
    out_dir: Path,
    min_bytes: int,
) -> dict:
    data_roots, fetch_manifest_roots = prepare_seed_state(state_dir)
    server = create_server(
        host,
        port,
        state_dir,
        dashboard_dir=dashboard_dir,
        data_roots=data_roots,
        fetch_manifest_roots=fetch_manifest_roots,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    try:
        base_url = f"http://{host}:{server.server_address[1]}"
        post_seed_status(base_url)
        captures = []
        for view in VIEWS:
            for label, (width, height) in VIEWPORTS.items():
                output = out_dir / f"{view}_{label}.png"
                captures.append(
                    {
                        "view": view,
                        "viewport": label,
                        **capture_png(
                            chrome=chrome,
                            url=f"{base_url}/#{view}",
                            output=output,
                            width=width,
                            height=height,
                            min_bytes=min_bytes,
                        ),
                    }
                )
        return {
            "base_url": base_url,
            "output_dir": str(out_dir),
            "capture_count": len(captures),
            "captures": captures,
        }
    finally:
        server.shutdown()
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Screenshot-smoke dashboard top-level pages")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--state-dir", type=Path, default=None)
    parser.add_argument("--dashboard-dir", type=Path, default=DEFAULT_DASHBOARD_DIR)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--chrome", default=None, help="Chrome/Chromium executable name or path")
    parser.add_argument("--min-bytes", type=int, default=2_000)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()

    chrome = find_chrome(args.chrome)
    if args.state_dir is None:
        with tempfile.TemporaryDirectory(prefix="algo_trade_dashboard_screenshot_state_") as state_tmp:
            out_dir = args.out_dir or Path(tempfile.mkdtemp(prefix="algo_trade_dashboard_screenshots_"))
            result = run_screenshot_smoke(
                chrome=chrome,
                host=args.host,
                port=args.port,
                state_dir=Path(state_tmp),
                dashboard_dir=args.dashboard_dir,
                out_dir=out_dir,
                min_bytes=args.min_bytes,
            )
    else:
        out_dir = args.out_dir or (args.state_dir / "dashboard_screenshots")
        result = run_screenshot_smoke(
            chrome=chrome,
            host=args.host,
            port=args.port,
            state_dir=args.state_dir,
            dashboard_dir=args.dashboard_dir,
            out_dir=out_dir,
            min_bytes=args.min_bytes,
        )

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(f"Dashboard screenshot smoke OK: {result['capture_count']} captures in {result['output_dir']}")


if __name__ == "__main__":
    main()
