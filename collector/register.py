"""Reviewed identities and selection policy; discovery is never approval."""
from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

REGISTER_PATH = Path(__file__).with_name("model-register.json")


def read_register(path: Path = REGISTER_PATH) -> dict[str, Any]:
    register = json.loads(path.read_text(encoding="utf-8"))
    if register.get("version") != 1 or not isinstance(register.get("models"), dict):
        raise ValueError("Invalid model register")
    aliases: set[str] = set(register["models"])
    for key, record in register["models"].items():
        if record.get("provider") != key.split("/", 1)[0]:
            raise ValueError(f"Provider mismatch: {key}")
        for alias in record.get("aliases", []):
            if alias in aliases:
                raise ValueError(f"Duplicate alias: {alias}")
            aliases.add(alias)
    for policy in register["basket"].values():
        fallback = register["models"][policy["fallback"]]
        if fallback["family"] != policy["family"]:
            raise ValueError("Basket fallback changed family")
    return register


def canonical_key(key: str, register: dict[str, Any] | None = None) -> str:
    register = register or read_register()
    return next((canonical for canonical, record in register["models"].items()
                 if key in record.get("aliases", [])), key)


def firstparty_catalog(register: dict[str, Any]) -> list[dict[str, Any]]:
    rows = []
    for key, record in register["models"].items():
        if "firstparty" not in record:
            continue
        row = dict(record["firstparty"])
        row["index_eligible"] = any(p["fallback"] == key for p in register["basket"].values())
        row["release_stage"] = record["stage"]
        rows.append(row)
    return rows


def apply_register(models: list[dict[str, Any]], register: dict[str, Any], now: datetime) -> dict[str, Any]:
    """Fresh price verification gates automatic promotion of reviewed identities.

    The fallback remains during source failures. A new release needs an approved
    family, explicit release stage, identity evidence and a checked official rate.
    Open-weight promotion additionally remains gated by exact-repository checks
    in the open-shelf selector. Unknown routed listings are discovery candidates.
    """
    by_key = {m["key"]: m for m in models}
    eligible = []
    for key, model in by_key.items():
        record = register["models"].get(key)
        if not record:
            continue
        model["family"] = record["family"]
        model["selectionOrder"] = record.get("order", 0)
        if record.get("apiId"):
            model["apiId"] = record["apiId"]
        if record.get("approved"):
            model["releaseStage"] = record["stage"]
        if record.get("lifecycle"):
            model["lifecycle"] = record["lifecycle"]
        try:
            age = (now - datetime.fromisoformat(model["checked"]).replace(tzinfo=timezone.utc)).total_seconds()
        except (KeyError, ValueError, TypeError):
            age = float("inf")
        ready = (record.get("approved") and record.get("identitySource") and
                 model.get("source") == "firstparty" and model.get("verificationStatus") == "fresh" and
                 0 <= age <= 7 * 86400 and record.get("lifecycle", {}).get("status", "active") == "active")
        model["promotionVerified"] = bool(ready)
        if ready:
            eligible.append(model)
    selections = {}
    for provider, policy in register["basket"].items():
        candidates = [m for m in eligible if m["provider"] == provider and
                      m["family"] == policy["family"] and m["releaseStage"] in policy["allowStages"]]
        winner = max(candidates, key=lambda m: (m["selectionOrder"], m["key"]), default=None)
        selected = winner["key"] if winner else policy["fallback"]
        if selected not in by_key:
            raise ValueError(f"Missing basket fallback: {selected}")
        selections[provider] = selected
        for model in models:
            if model["provider"] == provider:
                model["indexEligible"] = model["key"] == selected
    return {"version": 1, "reviewedAt": register["reviewedAt"], "policy": register["policy"],
            "basket": selections, "models": register["models"],
            "apiShortlist": register["apiShortlist"], "openShortlist": register["openShortlist"]}
