"""Load configured plugin factories."""

from __future__ import annotations

import importlib
from typing import Any


def load_object(spec: str) -> Any:
    if ":" not in spec:
        raise ValueError(f"plugin spec must be 'module:object', got {spec!r}")
    module_name, object_name = spec.split(":", 1)
    module = importlib.import_module(module_name)
    try:
        return getattr(module, object_name)
    except AttributeError as exc:
        raise ValueError(f"plugin object not found: {spec}") from exc


def create_plugin(spec: str, config: dict[str, Any]) -> Any:
    factory = load_object(spec)
    return factory(config)

