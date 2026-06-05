"""Load configured plugin factories."""

from __future__ import annotations

import importlib
import inspect
import sys
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


def normalize_validation_errors(raw: Any) -> list[str]:
    if raw is None:
        return []
    if isinstance(raw, str):
        return [raw] if raw.strip() else []
    if isinstance(raw, (list, tuple, set)):
        return [str(item) for item in raw if str(item).strip()]
    return [f"validator returned unsupported result {type(raw).__name__}"]


def call_plugin_validator(
    validator: Any,
    strategy_config: dict[str, Any],
    *,
    full_config: dict[str, Any],
) -> list[str]:
    signature = inspect.signature(validator)
    kwargs = {}
    if "full_config" in signature.parameters:
        kwargs["full_config"] = full_config
    if "config" in signature.parameters and "strategy_config" not in signature.parameters:
        raw = validator(config=strategy_config, **kwargs)
    else:
        raw = validator(strategy_config, **kwargs)
    return normalize_validation_errors(raw)


def plugin_config_validators(spec: str) -> list[Any]:
    factory = load_object(spec)
    module = sys.modules.get(getattr(factory, "__module__", ""))
    validators: list[Any] = []
    seen: set[int] = set()
    for owner in (factory, module):
        if owner is None:
            continue
        for name in ("validate_config", "validate_strategy_config"):
            validator = getattr(owner, name, None)
            if callable(validator) and id(validator) not in seen:
                validators.append(validator)
                seen.add(id(validator))
    return validators


def validate_plugin_config(
    spec: str,
    strategy_config: dict[str, Any],
    *,
    full_config: dict[str, Any],
) -> list[str]:
    errors: list[str] = []
    for validator in plugin_config_validators(spec):
        try:
            errors.extend(call_plugin_validator(
                validator,
                strategy_config,
                full_config=full_config,
            ))
        except Exception as exc:
            errors.append(f"plugin config validator failed: {exc}")
    return errors
