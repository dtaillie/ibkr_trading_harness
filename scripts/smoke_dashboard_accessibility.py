#!/usr/bin/env python3
"""Static accessibility smoke checks for the public dashboard shell."""

from __future__ import annotations

import argparse
import json
import re
from html.parser import HTMLParser
from pathlib import Path


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_HTML = ROOT / "web" / "dashboard" / "index.html"
DEFAULT_CSS = ROOT / "web" / "dashboard" / "styles.css"


FORM_CONTROL_TAGS = {"input", "select", "textarea"}
BUTTON_TAGS = {"button"}
ARIA_REFERENCE_ATTRS = {
    "aria-controls",
    "aria-describedby",
    "aria-details",
    "aria-errormessage",
    "aria-labelledby",
    "aria-owns",
}
ALLOWED_DYNAMIC_ARIA_IDS = {
    # Rendered by web/dashboard/app.js after symbol suggestions are available.
    "data-symbol-typeahead-list",
}


class DashboardA11yParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.stack: list[tuple[str, dict[str, str]]] = []
        self.controls: list[dict[str, object]] = []
        self.buttons: list[dict[str, object]] = []
        self.labels_for: set[str] = set()
        self.view_targets: set[str] = set()
        self.data_views: set[str] = set()
        self.ids: dict[str, int] = {}
        self.aria_references: list[dict[str, str]] = []
        self._button_stack: list[dict[str, object]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attr = {key: value or "" for key, value in attrs}
        element_id = attr.get("id")
        if element_id:
            self.ids[element_id] = self.ids.get(element_id, 0) + 1
        for name in ARIA_REFERENCE_ATTRS:
            if attr.get(name):
                for target_id in attr[name].split():
                    self.aria_references.append({
                        "source": element_id or tag,
                        "attribute": name,
                        "target": target_id,
                    })
        if tag == "label" and attr.get("for"):
            self.labels_for.add(attr["for"])
        if attr.get("data-view-target"):
            self.view_targets.add(attr["data-view-target"])
        if attr.get("data-view"):
            self.data_views.add(attr["data-view"])
        if tag in FORM_CONTROL_TAGS:
            self.controls.append({
                "tag": tag,
                "attrs": attr,
                "inside_label": any(parent_tag == "label" for parent_tag, _parent_attrs in self.stack),
            })
        if tag in BUTTON_TAGS:
            button = {"tag": tag, "attrs": attr, "text": ""}
            self.buttons.append(button)
            self._button_stack.append(button)
        self.stack.append((tag, attr))

    def handle_endtag(self, tag: str) -> None:
        if tag == "button" and self._button_stack:
            self._button_stack.pop()
        for index in range(len(self.stack) - 1, -1, -1):
            if self.stack[index][0] == tag:
                del self.stack[index:]
                break

    def handle_data(self, data: str) -> None:
        if self._button_stack:
            current = str(self._button_stack[-1]["text"])
            self._button_stack[-1]["text"] = current + data


def hex_to_rgb(value: str) -> tuple[int, int, int]:
    raw = value.strip().lstrip("#")
    if len(raw) != 6:
        raise ValueError(f"unsupported color: {value}")
    return int(raw[0:2], 16), int(raw[2:4], 16), int(raw[4:6], 16)


def relative_luminance(rgb: tuple[int, int, int]) -> float:
    channels = []
    for channel in rgb:
        value = channel / 255
        channels.append(value / 12.92 if value <= 0.03928 else ((value + 0.055) / 1.055) ** 2.4)
    return 0.2126 * channels[0] + 0.7152 * channels[1] + 0.0722 * channels[2]


def contrast_ratio(foreground: str, background: str) -> float:
    fg = relative_luminance(hex_to_rgb(foreground))
    bg = relative_luminance(hex_to_rgb(background))
    lighter = max(fg, bg)
    darker = min(fg, bg)
    return (lighter + 0.05) / (darker + 0.05)


def css_variables(css: str) -> dict[str, str]:
    return {
        name: value.strip()
        for name, value in re.findall(r"(--[a-z0-9-]+)\s*:\s*(#[0-9a-fA-F]{6})", css)
    }


def has_focus_style(css: str) -> bool:
    return bool(re.search(r":focus(?:-visible)?\b", css)) and "outline" in css


def accessible_control(control: dict[str, object], labels_for: set[str]) -> bool:
    attrs = control["attrs"]
    assert isinstance(attrs, dict)
    if attrs.get("type") == "hidden":
        return True
    if attrs.get("aria-label") or attrs.get("aria-labelledby"):
        return True
    if control.get("inside_label"):
        return True
    control_id = attrs.get("id")
    return bool(control_id and control_id in labels_for)


def accessible_button(button: dict[str, object]) -> bool:
    attrs = button["attrs"]
    assert isinstance(attrs, dict)
    name = str(button.get("text") or "").strip()
    return bool(name or attrs.get("aria-label") or attrs.get("title"))


def run_accessibility_smoke(html_path: Path = DEFAULT_HTML, css_path: Path = DEFAULT_CSS) -> dict:
    html = html_path.read_text(encoding="utf-8")
    css = css_path.read_text(encoding="utf-8")
    parser = DashboardA11yParser()
    parser.feed(html)

    failures = []
    unlabeled_controls = [
        control for control in parser.controls
        if not accessible_control(control, parser.labels_for)
    ]
    unnamed_buttons = [
        button for button in parser.buttons
        if not accessible_button(button)
    ]
    missing_view_targets = sorted(parser.view_targets - parser.data_views)
    duplicate_ids = sorted(element_id for element_id, count in parser.ids.items() if count > 1)
    missing_aria_references = [
        reference for reference in parser.aria_references
        if reference["target"] not in parser.ids and reference["target"] not in ALLOWED_DYNAMIC_ARIA_IDS
    ]
    if unlabeled_controls:
        failures.append(f"{len(unlabeled_controls)} form control(s) lack accessible labels")
    if unnamed_buttons:
        failures.append(f"{len(unnamed_buttons)} button(s) lack accessible names")
    if duplicate_ids:
        failures.append(f"duplicate element id(s): {', '.join(duplicate_ids)}")
    if missing_aria_references:
        details = ", ".join(
            f"{item['source']} {item['attribute']}->{item['target']}"
            for item in missing_aria_references[:10]
        )
        failures.append(f"ARIA reference(s) point to missing element ids: {details}")
    if missing_view_targets:
        failures.append(f"navigation targets without sections: {', '.join(missing_view_targets)}")
    if not has_focus_style(css):
        failures.append("stylesheet lacks explicit focus outline styling")

    variables = css_variables(css)
    contrast_checks = {
        "--text": "--panel",
        "--muted": "--panel",
        "--accent-dark": "--panel",
        "--warn": "--panel",
        "--bad": "--panel",
        "--good": "--panel",
    }
    contrast_results = {}
    for foreground, background in contrast_checks.items():
        if foreground not in variables or background not in variables:
            failures.append(f"missing color variable for contrast check: {foreground}/{background}")
            continue
        ratio = contrast_ratio(variables[foreground], variables[background])
        contrast_results[f"{foreground}_on_{background}"] = round(ratio, 2)
        if ratio < 4.5:
            failures.append(f"contrast {foreground} on {background} is {ratio:.2f}:1")

    if failures:
        raise RuntimeError("; ".join(failures))

    return {
        "html": str(html_path),
        "css": str(css_path),
        "controls": len(parser.controls),
        "buttons": len(parser.buttons),
        "ids": len(parser.ids),
        "aria_references": len(parser.aria_references),
        "views": len(parser.data_views),
        "view_targets": len(parser.view_targets),
        "contrast": contrast_results,
    }


def main() -> None:
    parser = argparse.ArgumentParser(description="Run static dashboard accessibility smoke checks")
    parser.add_argument("--html", type=Path, default=DEFAULT_HTML)
    parser.add_argument("--css", type=Path, default=DEFAULT_CSS)
    parser.add_argument("--json", action="store_true")
    args = parser.parse_args()
    result = run_accessibility_smoke(args.html, args.css)
    if args.json:
        print(json.dumps(result, indent=2, sort_keys=True))
    else:
        print(
            "Dashboard accessibility smoke OK: "
            f"controls={result['controls']} buttons={result['buttons']} views={result['views']}"
        )


def test_dashboard_accessibility_smoke() -> None:
    result = run_accessibility_smoke()
    assert result["controls"] > 0
    assert result["buttons"] > 0
    assert result["ids"] > result["controls"]
    assert result["aria_references"] >= 1
    assert result["views"] >= 8


if __name__ == "__main__":
    main()
