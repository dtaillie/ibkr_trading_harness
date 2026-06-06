#!/usr/bin/env python3
"""Capture lightweight desktop/mobile dashboard screenshots with Chrome."""

from __future__ import annotations

import argparse
import base64
import hashlib
import json
import os
import socket
import shutil
import subprocess
import sys
import tempfile
import threading
import time
from urllib import parse, request
from pathlib import Path

ROOT = Path(__file__).resolve().parent.parent
sys.path.insert(0, str(ROOT))

from scripts.cloud_status_server import DEFAULT_DASHBOARD_DIR, create_server
from scripts.smoke_dashboard import post_seed_status, write_seed_data, write_seed_fetch_manifest


VIEW_TARGETS = (
    ("overview", "overview"),
    ("overview_activity", "overview/activity"),
    ("overview_diagnostics", "overview/diagnostics"),
    ("performance", "performance"),
    ("performance_trades", "performance/trades"),
    ("performance_rollups", "performance/rollups"),
    ("performance_diagnostics", "performance/diagnostics"),
    ("data", "data"),
    ("data_browse", "data/browse"),
    ("data_inspect", "data/inspect"),
    ("data_compare", "data/compare"),
    ("data_diagnostics", "data/diagnostics"),
    ("fetch", "fetch"),
    ("fetch_jobs", "fetch/jobs"),
    ("fetch_detail", "fetch/detail"),
    ("workbench", "workbench"),
    ("workbench_builder", "workbench/builder"),
    ("workbench_run", "workbench/run"),
    ("workbench_artifacts", "workbench/artifacts"),
    ("runs", "runs"),
    ("runs_state", "runs/state"),
    ("runs_table", "runs/runs"),
    ("runs_events", "runs/events"),
    ("operations", "operations"),
    ("operations_paper", "operations/paper"),
    ("operations_remote", "operations/remote"),
    ("operations_control", "operations/control"),
    ("operations_diagnostics", "operations/diagnostics"),
    ("help", "help"),
    ("help_pages", "help/pages"),
    ("help_workflows", "help/workflows"),
    ("help_data", "help/data"),
    ("help_boundary", "help/boundary"),
    ("help_docs", "help/docs"),
)
VIEWPORTS = {
    "desktop": (1366, 900),
    "mobile": (390, 844),
}

LAYOUT_CHECK_SCRIPT = r"""
(() => {
  const failures = [];
  const visible = (element) => {
    const style = window.getComputedStyle(element);
    const rect = element.getBoundingClientRect();
    return style.visibility !== "hidden" && style.display !== "none" && rect.width > 0 && rect.height > 0;
  };
  const label = (element) => {
    const id = element.id ? `#${element.id}` : "";
    const klass = Array.from(element.classList || []).slice(0, 3).map((item) => `.${item}`).join("");
    const text = (element.textContent || "").replace(/\s+/g, " ").trim().slice(0, 80);
    return `${element.tagName.toLowerCase()}${id}${klass}${text ? ` "${text}"` : ""}`;
  };
  const activePath = location.hash.replace(/^#/, "") || "overview";
  const activeView = activePath.split("/")[0] || "overview";
  const activeNav = document.querySelector(`.nav-link[data-view-target="${activeView}"]`);
  if (activeNav && activeNav.getAttribute("aria-current") !== "page") {
    failures.push({
      type: "active-nav-aria-current",
      element: label(activeNav),
      view: activeView,
    });
  }
  if (window.innerWidth <= 820) {
    const sideNav = document.querySelector(".side-nav");
    if (sideNav) {
      const sideNavStyle = window.getComputedStyle(sideNav);
      if (sideNavStyle.display !== "flex" || sideNavStyle.overflowX === "visible") {
        failures.push({
          type: "mobile-nav-rail",
          element: label(sideNav),
          display: sideNavStyle.display,
          overflowX: sideNavStyle.overflowX,
          view: activeView,
        });
      }
    }
    if (activeNav) {
      const navRect = activeNav.getBoundingClientRect();
      if (navRect.left < -4 || navRect.right > window.innerWidth + 4) {
        failures.push({
          type: "active-nav-offscreen",
          element: label(activeNav),
          left: Math.round(navRect.left),
          right: Math.round(navRect.right),
          viewport: window.innerWidth,
          view: activeView,
        });
      }
    }
  }
  const documentWidth = Math.max(document.documentElement.scrollWidth, document.body.scrollWidth);
  const viewportOverflow = documentWidth - window.innerWidth;
  if (viewportOverflow > 20) {
    failures.push({
      type: "viewport-overflow",
      element: "document",
      amount: Math.round(viewportOverflow),
      viewport: window.innerWidth,
      documentWidth,
      view: activeView,
    });
  }
  const selectors = [
    ".topbar h1",
    ".topbar p",
    ".nav-link",
    ".status-tile span",
    ".status-tile strong",
    ".status-tile .metric-source",
    ".metric span",
    ".metric strong",
    ".metric .metric-source",
    ".runtime-status-card span",
    ".runtime-status-card strong",
    ".data-library-card span",
    ".data-library-card strong",
    ".data-shortlist-card strong",
    ".data-shortlist-card small",
    ".symbol-directory-summary strong",
    ".symbol-directory-summary small",
    ".symbol-quick-pick strong",
    ".symbol-quick-pick small",
    ".root-card span",
    ".root-card strong",
    ".help-start-grid strong",
    ".help-start-grid span",
    ".health-card strong",
    ".health-card span",
    ".compatibility-card strong",
    ".compatibility-card small",
    ".position-card strong",
    ".position-card span",
    ".change-card strong",
    ".change-card span",
    ".performance-card strong",
    ".performance-card span",
    ".performance-card .metric-source",
    ".performance-home-main strong",
    ".performance-home-main span",
    ".performance-home-tiles strong",
    ".performance-home-tiles small",
    ".overview-main-card strong",
    ".overview-main-card span",
    ".overview-main-card .metric-source",
    ".overview-glance-main strong",
    ".overview-glance-main span",
    ".overview-glance-cards strong",
    ".overview-glance-cards small",
    ".overview-workflow-grid strong",
    ".overview-workflow-grid small",
    ".workflow-card-foot b",
    ".performance-workflow-grid strong",
    ".performance-workflow-grid small",
    ".data-workflow-grid strong",
    ".data-workflow-grid small",
    ".fetch-workflow-grid strong",
    ".fetch-workflow-grid small",
    ".workbench-workflow-grid strong",
    ".workbench-workflow-grid small",
    ".runs-workflow-grid strong",
    ".runs-workflow-grid small",
    ".operations-workflow-grid strong",
    ".operations-workflow-grid small",
    ".overview-performance-main strong",
    ".overview-performance-main span",
    ".overview-performance-tiles strong",
    ".overview-performance-tiles small",
    ".page-step span",
    ".page-step strong",
    ".page-step small",
    ".section-head h2",
    ".section-note",
    ".guide-item strong",
    ".guide-item span",
    ".guide-step-actions button",
    ".config-field-section legend",
    ".config-field-section p",
    ".help-card strong",
    ".help-card span",
    "button",
    "label.inline-control span"
  ].join(",");
  const allowedOverflow = (element) => (
    element.closest(".table-wrap") ||
    element.closest(".calendar-scroll") ||
    element.closest(".detail-chart-wrap") ||
    element.closest(".mono") ||
    element.classList.contains("mono")
  );
  for (const element of document.querySelectorAll(selectors)) {
    if (!visible(element) || allowedOverflow(element)) continue;
    const overflowX = element.scrollWidth - element.clientWidth;
    const overflowY = element.scrollHeight - element.clientHeight;
    if (overflowX > 4 || overflowY > 4) {
      failures.push({
        type: "text-overflow",
        element: label(element),
        overflowX: Math.round(overflowX),
        overflowY: Math.round(overflowY),
        clientWidth: Math.round(element.clientWidth),
        scrollWidth: Math.round(element.scrollWidth),
        view: activeView,
      });
    }
  }
  return {
    ok: failures.length === 0,
    failures,
    view: activeView,
    width: window.innerWidth,
    height: window.innerHeight,
    documentWidth,
  };
})()
"""


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


def prepare_empty_state(state_dir: Path) -> tuple[list[Path], list[Path]]:
    data_root = state_dir / "screenshot_empty_data"
    manifest_root = state_dir / "screenshot_empty_fetch_manifests"
    data_root.mkdir(parents=True, exist_ok=True)
    manifest_root.mkdir(parents=True, exist_ok=True)
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


def find_free_port() -> int:
    with socket.socket(socket.AF_INET, socket.SOCK_STREAM) as sock:
        sock.bind(("127.0.0.1", 0))
        return int(sock.getsockname()[1])


def wait_for_json(url: str, *, timeout: float = 8.0) -> dict:
    deadline = time.monotonic() + timeout
    last_error: Exception | None = None
    while time.monotonic() < deadline:
        try:
            with request.urlopen(url, timeout=1) as response:
                return json.loads(response.read().decode("utf-8"))
        except Exception as exc:  # pragma: no cover - depends on Chrome startup timing
            last_error = exc
            time.sleep(0.1)
    raise RuntimeError(f"timed out waiting for Chrome endpoint {url}: {last_error}")


def chrome_target(chrome_port: int, url: str) -> dict:
    encoded = parse.quote(url, safe="")
    new_url = f"http://127.0.0.1:{chrome_port}/json/new?{encoded}"
    req = request.Request(new_url, method="PUT")
    try:
        with request.urlopen(req, timeout=5) as response:
            return json.loads(response.read().decode("utf-8"))
    except Exception:
        with request.urlopen(f"http://127.0.0.1:{chrome_port}/json/list", timeout=5) as response:
            targets = json.loads(response.read().decode("utf-8"))
        for target in targets:
            if target.get("url") == url:
                return target
        raise


class DevToolsClient:
    def __init__(self, websocket_url: str) -> None:
        parsed = parse.urlparse(websocket_url)
        self.host = parsed.hostname or "127.0.0.1"
        self.port = parsed.port or 80
        self.path = parsed.path
        if parsed.query:
            self.path += f"?{parsed.query}"
        self.sock = socket.create_connection((self.host, self.port), timeout=5)
        self.next_id = 0
        self._handshake()

    def close(self) -> None:
        try:
            self.sock.close()
        except OSError:
            pass

    def _handshake(self) -> None:
        key = base64.b64encode(os.urandom(16)).decode("ascii")
        request_text = (
            f"GET {self.path} HTTP/1.1\r\n"
            f"Host: {self.host}:{self.port}\r\n"
            "Upgrade: websocket\r\n"
            "Connection: Upgrade\r\n"
            f"Sec-WebSocket-Key: {key}\r\n"
            "Sec-WebSocket-Version: 13\r\n"
            "\r\n"
        )
        self.sock.sendall(request_text.encode("ascii"))
        response = b""
        while b"\r\n\r\n" not in response:
            chunk = self.sock.recv(4096)
            if not chunk:
                raise RuntimeError("Chrome closed DevTools handshake")
            response += chunk
        header = response.decode("latin1", errors="replace")
        if " 101 " not in header.split("\r\n", 1)[0]:
            raise RuntimeError(f"DevTools websocket handshake failed: {header.splitlines()[0]}")
        accept_src = (key + "258EAFA5-E914-47DA-95CA-C5AB0DC85B11").encode("ascii")
        expected = base64.b64encode(hashlib.sha1(accept_src).digest()).decode("ascii")
        if expected not in header:
            raise RuntimeError("DevTools websocket handshake accept key mismatch")

    def send(self, method: str, params: dict | None = None) -> dict:
        self.next_id += 1
        payload = {"id": self.next_id, "method": method}
        if params is not None:
            payload["params"] = params
        self._send_text(json.dumps(payload, separators=(",", ":")))
        while True:
            message = self._recv_text()
            data = json.loads(message)
            if data.get("id") == self.next_id:
                if "error" in data:
                    raise RuntimeError(f"DevTools {method} failed: {data['error']}")
                return data.get("result", {})

    def _send_text(self, text: str) -> None:
        payload = text.encode("utf-8")
        header = bytearray([0x81])
        length = len(payload)
        if length < 126:
            header.append(0x80 | length)
        elif length < 65536:
            header.extend([0x80 | 126, (length >> 8) & 0xFF, length & 0xFF])
        else:
            header.append(0x80 | 127)
            header.extend(length.to_bytes(8, "big"))
        mask = os.urandom(4)
        masked = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
        self.sock.sendall(bytes(header) + mask + masked)

    def _recv_exact(self, count: int) -> bytes:
        chunks = []
        remaining = count
        while remaining:
            chunk = self.sock.recv(remaining)
            if not chunk:
                raise RuntimeError("Chrome closed DevTools websocket")
            chunks.append(chunk)
            remaining -= len(chunk)
        return b"".join(chunks)

    def _recv_text(self) -> str:
        while True:
            first, second = self._recv_exact(2)
            opcode = first & 0x0F
            masked = bool(second & 0x80)
            length = second & 0x7F
            if length == 126:
                length = int.from_bytes(self._recv_exact(2), "big")
            elif length == 127:
                length = int.from_bytes(self._recv_exact(8), "big")
            mask = self._recv_exact(4) if masked else b""
            payload = self._recv_exact(length) if length else b""
            if masked:
                payload = bytes(byte ^ mask[index % 4] for index, byte in enumerate(payload))
            if opcode == 8:
                raise RuntimeError("Chrome closed DevTools websocket")
            if opcode == 9:
                continue
            if opcode == 1:
                return payload.decode("utf-8")


def start_debug_chrome(chrome: str, width: int, height: int) -> tuple[subprocess.Popen, int, tempfile.TemporaryDirectory]:
    chrome_port = find_free_port()
    profile = tempfile.TemporaryDirectory(prefix="algo_trade_dashboard_chrome_")
    command = [
        chrome,
        "--headless=new",
        "--disable-gpu",
        "--no-sandbox",
        "--hide-scrollbars",
        "--run-all-compositor-stages-before-draw",
        f"--remote-debugging-port={chrome_port}",
        f"--user-data-dir={profile.name}",
        f"--window-size={width},{height}",
        "about:blank",
    ]
    process = subprocess.Popen(command, stdout=subprocess.PIPE, stderr=subprocess.PIPE, text=True)
    wait_for_json(f"http://127.0.0.1:{chrome_port}/json/version", timeout=8)
    return process, chrome_port, profile


def check_layout(
    *,
    chrome: str,
    url: str,
    width: int,
    height: int,
    settle_seconds: float,
) -> dict:
    process, chrome_port, profile = start_debug_chrome(chrome, width, height)
    client: DevToolsClient | None = None
    try:
        target = chrome_target(chrome_port, url)
        websocket_url = target.get("webSocketDebuggerUrl")
        if not websocket_url:
            raise RuntimeError(f"Chrome target missing websocket URL for {url}")
        client = DevToolsClient(websocket_url)
        client.send("Runtime.enable")
        client.send("Page.enable")
        client.send("Emulation.setDeviceMetricsOverride", {
            "width": width,
            "height": height,
            "deviceScaleFactor": 1,
            "mobile": width < 600,
        })
        client.send("Page.navigate", {"url": url})
        time.sleep(settle_seconds)
        result = client.send("Runtime.evaluate", {
            "expression": LAYOUT_CHECK_SCRIPT,
            "returnByValue": True,
            "awaitPromise": True,
        })
        value = ((result.get("result") or {}).get("value")) or {}
        if not value.get("ok"):
            failures = value.get("failures") or []
            sample = json.dumps(failures[:8], indent=2, sort_keys=True)
            raise RuntimeError(f"layout check failed for {url} {width}x{height}: {sample}")
        return value
    finally:
        if client is not None:
            client.close()
        process.terminate()
        try:
            process.wait(timeout=5)
        except subprocess.TimeoutExpired:
            process.kill()
            process.wait(timeout=5)
        try:
            profile.cleanup()
        except OSError:
            shutil.rmtree(profile.name, ignore_errors=True)


def run_screenshot_smoke(
    *,
    chrome: str,
    host: str,
    port: int,
    state_dir: Path,
    dashboard_dir: Path,
    out_dir: Path,
    scenario: str,
    min_bytes: int,
    check_layout_enabled: bool,
    settle_seconds: float,
) -> dict:
    if scenario == "empty":
        data_roots, fetch_manifest_roots = prepare_empty_state(state_dir)
    else:
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
        if scenario == "seeded":
            post_seed_status(base_url)
        captures = []
        layout_checks = []
        for target_id, target_hash in VIEW_TARGETS:
            for label, (width, height) in VIEWPORTS.items():
                url = f"{base_url}/#{target_hash}"
                output = out_dir / f"{target_id}_{label}.png"
                captures.append(
                    {
                        "view": target_id,
                        "hash": target_hash,
                        "viewport": label,
                        **capture_png(
                            chrome=chrome,
                            url=url,
                            output=output,
                            width=width,
                            height=height,
                            min_bytes=min_bytes,
                        ),
                    }
                )
                if check_layout_enabled:
                    layout_checks.append({
                        "view": target_id,
                        "hash": target_hash,
                        "viewport": label,
                        **check_layout(
                            chrome=chrome,
                            url=url,
                            width=width,
                            height=height,
                            settle_seconds=settle_seconds,
                        ),
                    })
        return {
            "base_url": base_url,
            "scenario": scenario,
            "output_dir": str(out_dir),
            "capture_count": len(captures),
            "captures": captures,
            "layout_check_count": len(layout_checks),
            "layout_checks": layout_checks,
        }
    finally:
        server.shutdown()
        server.server_close()


def main() -> None:
    parser = argparse.ArgumentParser(description="Screenshot-smoke dashboard pages and focused subviews")
    parser.add_argument("--host", default="127.0.0.1")
    parser.add_argument("--port", type=int, default=0)
    parser.add_argument("--state-dir", type=Path, default=None)
    parser.add_argument("--dashboard-dir", type=Path, default=DEFAULT_DASHBOARD_DIR)
    parser.add_argument("--out-dir", type=Path, default=None)
    parser.add_argument("--chrome", default=None, help="Chrome/Chromium executable name or path")
    parser.add_argument("--scenario", choices=("seeded", "empty"), default="seeded", help="Dashboard state to screenshot.")
    parser.add_argument("--min-bytes", type=int, default=2_000)
    parser.add_argument("--check-layout", action="store_true", help="Fail if visible core UI text overflows or the page creates horizontal viewport overflow.")
    parser.add_argument("--settle-seconds", type=float, default=1.5, help="Seconds to wait before running layout checks after navigation.")
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
                scenario=args.scenario,
                min_bytes=args.min_bytes,
                check_layout_enabled=args.check_layout,
                settle_seconds=args.settle_seconds,
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
            scenario=args.scenario,
            min_bytes=args.min_bytes,
            check_layout_enabled=args.check_layout,
            settle_seconds=args.settle_seconds,
        )

    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        layout = f", layout checks={result['layout_check_count']}" if result.get("layout_check_count") else ""
        print(f"Dashboard screenshot smoke OK: {result['capture_count']} captures{layout} scenario={result['scenario']} in {result['output_dir']}")


if __name__ == "__main__":
    main()
