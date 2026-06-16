#!/usr/bin/env python3
"""Regenerate the README dashboard demo GIF (and the two static screenshots).

Boots the same public-safe, seeded dashboard the demo and smoke tests use,
drives headless Chrome through the DevTools protocol to capture a short tour of
the current UI, and assembles an animated GIF with Pillow. No broker connection,
credentials, or token are involved, and nothing here touches real data.

Reuses:
  - scripts.smoke_dashboard            seed helpers (public-safe example data)
  - scripts.cloud_status_server        create_server
  - scripts.smoke_dashboard_screenshots LayoutChecker (1366px desktop capture)

Requires: google-chrome (or chromium) on PATH and Pillow (`pip install Pillow`).

Run:  python3 scripts/build_dashboard_gif.py
Writes: docs/images/dashboard_demo.gif, dashboard_overview.png, dashboard_performance.png
"""

from __future__ import annotations

import argparse
import shutil
import sys
import tempfile
import threading
import time
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.cloud_status_server import create_server
from scripts.demo_dashboard import seed_example_run
from scripts.smoke_dashboard import post_seed_status, write_seed_data, write_seed_fetch_manifest
from scripts.smoke_dashboard_screenshots import LayoutChecker

# Per-route "data has loaded" predicates. Capturing only once these are true
# avoids screenshotting a half-rendered page (telemetry/charts load async over
# several seconds). Each is a JS expression returning a boolean. Routes without
# an entry load with the initial refresh and just use the navigate settle.
READY_BY_ROUTE = {
    "performance": "!!document.querySelector('#performance-equity-chart svg, #performance-equity-chart polyline, #performance-equity-chart path')",
    "performance/trades": "document.querySelectorAll('#performance-trades-body tr').length > 0",
    "overview": "/[0-9]/.test((document.querySelector('#overview-equity') || {}).textContent || '')",
}

# Chart-heavy frames: scroll the primary chart into view so the captured frame
# showcases it (the page leads with summary tiles; charts sit lower). The trades
# lens leads with win-rate/PnL KPIs at the top, so it is captured unscrolled.
SCROLL_BY_ROUTE = {
    "performance": "#performance-equity-chart",
}

# (hash route, hold milliseconds) — a ~21s tour matching the five README use
# cases. Bare routes land on each page's default "home" lens; slashed routes
# open a sublens. Bare-home frames precede their sublens frames so per-session
# lens state never leaks backward.
FRAMES = [
    ("overview", 3500),
    ("overview/activity", 2500),
    ("performance", 3500),
    ("performance/trades", 3000),
    ("data", 3000),
    ("workbench", 3000),
    ("runs", 3000),
]

# Full-resolution static hero shots for the README.
STATIC_SHOTS = [
    ("overview", "dashboard_overview.png"),
    ("performance", "dashboard_performance.png"),
]


def _resolve_chrome(explicit: str | None) -> str:
    for candidate in ([explicit] if explicit else []) + ["google-chrome", "chromium", "chromium-browser"]:
        found = shutil.which(candidate)
        if found:
            return found
    raise SystemExit("No Chrome/Chromium executable found; pass --chrome PATH")


def _assemble_gif(frame_pngs: list[Path], durations_ms: list[int], out_gif: Path, *, max_width: int, colors: int) -> None:
    from PIL import Image

    frames = []
    for png in frame_pngs:
        img = Image.open(png).convert("RGB")
        if img.width > max_width:
            height = round(img.height * max_width / img.width)
            img = img.resize((max_width, height), Image.LANCZOS)
        # Flat dark UI: a small adaptive palette is plenty and keeps size down.
        frames.append(img.quantize(colors=colors, method=Image.FASTOCTREE))
    out_gif.parent.mkdir(parents=True, exist_ok=True)
    frames[0].save(
        out_gif,
        save_all=True,
        append_images=frames[1:],
        duration=durations_ms,
        loop=0,
        optimize=True,
        disposal=2,
    )


def _wait_for(checker: LayoutChecker, expr: str, *, timeout: float = 12.0, interval: float = 0.3) -> bool:
    """Poll a JS predicate until true (data rendered) or timeout. Returns success."""
    end = time.monotonic() + timeout
    while time.monotonic() < end:
        try:
            result = checker.client.send("Runtime.evaluate", {"expression": expr, "returnByValue": True})
            if bool((result.get("result") or {}).get("value")):
                return True
        except Exception:  # noqa: BLE001 - transient eval errors mid-navigation
            pass
        time.sleep(interval)
    return False


def _await_ready(checker: LayoutChecker, route: str) -> bool:
    predicate = READY_BY_ROUTE.get(route)
    ok = _wait_for(checker, predicate) if predicate else True
    selector = SCROLL_BY_ROUTE.get(route)
    if selector:
        checker.client.send("Runtime.evaluate", {
            "expression": f"(() => {{ const el = document.querySelector('{selector}'); if (el) el.scrollIntoView({{block: 'center'}}); }})()",
        })
    time.sleep(0.5)  # brief paint settle after data lands / scroll
    return ok


def main() -> None:
    parser = argparse.ArgumentParser(description="Regenerate the dashboard demo GIF and static screenshots")
    parser.add_argument("--out-gif", type=Path, default=ROOT / "docs/images/dashboard_demo.gif")
    parser.add_argument("--images-dir", type=Path, default=ROOT / "docs/images")
    parser.add_argument("--chrome", default=None, help="Chrome/Chromium executable name or path")
    parser.add_argument("--width", type=int, default=1366)
    parser.add_argument("--height", type=int, default=1000)
    parser.add_argument("--settle-seconds", type=float, default=2.5, help="Render wait per frame")
    parser.add_argument("--no-collapse-intro", action="store_true",
                        help="Keep the page-intro guide expanded (default collapses it so charts sit higher)")
    parser.add_argument("--gif-width", type=int, default=1100, help="Downscaled GIF frame width")
    parser.add_argument("--gif-colors", type=int, default=64, help="Palette size per GIF frame")
    parser.add_argument("--keep-frames", action="store_true", help="Keep the intermediate frame PNGs")
    args = parser.parse_args()

    chrome = _resolve_chrome(args.chrome)

    workdir = Path(tempfile.mkdtemp(prefix="dashboard_gif_"))
    data_root = workdir / "data"
    manifest_root = workdir / "fetch_manifests"
    state_dir = workdir / "state"
    runtime_status_root = workdir / "runtime_status"
    frames_dir = workdir / "frames"
    frames_dir.mkdir(parents=True, exist_ok=True)
    write_seed_data(data_root)
    write_seed_fetch_manifest(manifest_root, data_root / "SYM000_5min_sample.csv")

    # Ephemeral port (0) so this never collides with a running dashboard;
    # runtime_status_root keeps the seeded telemetry run inside the temp dir.
    server = create_server(
        "127.0.0.1", 0, state_dir,
        data_roots=[data_root],
        fetch_manifest_roots=[manifest_root],
        plugin_registry_paths=[],
        runtime_status_root=runtime_status_root,
    )
    thread = threading.Thread(target=server.serve_forever, daemon=True)
    thread.start()
    base = f"http://127.0.0.1:{server.server_address[1]}"
    # Seed a real example-strategy replay so Performance shows an equity curve.
    if not seed_example_run(base, runtime_status_root, workdir):
        post_seed_status(base)
    print(f"Seeded dashboard at {base}")

    checker = LayoutChecker(chrome=chrome, width=args.width, height=args.height, settle_seconds=args.settle_seconds)
    frame_pngs: list[Path] = []
    durations: list[int] = []
    try:
        if not args.no_collapse_intro:
            # Collapse the page-intro guide via its own persisted toggle so the
            # chart-first content sits higher in every frame. Set it once, then
            # reload so the app applies it on init for all hash navigations.
            checker.navigate(f"{base}/#overview")
            checker.client.send("Runtime.evaluate", {
                "expression": "localStorage.setItem('pageIntroCollapsed','1')",
            })
            checker.client.send("Page.reload", {})
            time.sleep(args.settle_seconds)
        for index, (route, hold_ms) in enumerate(FRAMES):
            png = frames_dir / f"frame_{index:02d}.png"
            checker.navigate(f"{base}/#{route}")
            ready = _await_ready(checker, route)
            info = checker.capture_png(output=png, min_bytes=2000)
            print(f"  frame {index} #{route:24s} {info['bytes'] // 1024} KB{'' if ready else '  [readiness timeout]'}")
            frame_pngs.append(png)
            durations.append(hold_ms)
        for route, filename in STATIC_SHOTS:
            dest = args.images_dir / filename
            checker.navigate(f"{base}/#{route}")
            ready = _await_ready(checker, route)
            info = checker.capture_png(output=dest, min_bytes=2000)
            print(f"  static {filename:28s} {info['bytes'] // 1024} KB -> {dest}{'' if ready else '  [readiness timeout]'}")
    finally:
        checker.close()
        server.shutdown()
        server.server_close()

    _assemble_gif(frame_pngs, durations, args.out_gif, max_width=args.gif_width, colors=args.gif_colors)
    size_kb = args.out_gif.stat().st_size // 1024
    print(f"Wrote {args.out_gif} ({size_kb} KB, {len(frame_pngs)} frames, {sum(durations) / 1000:.1f}s loop)")
    if size_kb > 2048:
        print("WARNING: GIF exceeds ~2MB; consider --gif-colors 48 or --gif-width 960")

    if args.keep_frames:
        print(f"Frames kept in {frames_dir}")
    else:
        shutil.rmtree(workdir, ignore_errors=True)


if __name__ == "__main__":
    main()
