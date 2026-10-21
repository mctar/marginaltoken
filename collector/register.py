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
        if not isinstance(record.get("family"), str) or not isinstance(record.get("order"), int):
            raise ValueError(f"Missing family or ordering: {key}")
        if record.get("approved") and (record.get("stage") not in ("stable", "preview", "experimental") or not str(record.get("identitySource", "")).startswith("https://")):
            raise ValueError(f"Approved identity needs explicit stage and source: {key}")
        row = record.get("firstparty")
        if row and f"{row.get('provider')}/{row.get('model')}" != key:
            raise ValueError(f"Fallback identity mismatch: {key}")
        if record.get("firstpartyHistorical") and (
            not row or record.get("lifecycle", {}).get("status") not in {"deprecated", "retired"}
            or not record.get("lifecycle", {}).get("sourceUrl")
            or any(p["fallback"] == key for p in register["basket"].values())
        ):
            raise ValueError(f"Historical pricing requires a sourced lifecycle and no basket selection: {key}")
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
        if "firstparty" not in record or record.get("firstpartyHistorical"):
            continue
        row = dict(record["firstparty"])
        row["index_eligible"] = any(p["fallback"] == key for p in register["basket"].values())
        row["release_stage"] = record["stage"]
        rows.append(row)
    return rows


def apply_register(models: list[dict[str, Any]], register: dict[str, Any], now: datetime, previous: dict[str, str] | None = None) -> dict[str, Any]:
    """Fresh price verification gates automatic promotion of reviewed identities.

    The fallback remains during source failures. A new release needs an approved
    family, explicit release stage, identity evidence and a checked official rate.
    Open-weight promotion additionally remains gated by exact-repository checks
    in the open-shelf selector. Unknown routed listings are discovery candidates.
    """
    by_key = {m["key"]: m for m in models}
    previous = previous or {}
    eligible = []
    for key, model in by_key.items():
        record = register["models"].get(key)
        if not record:
            continue
        model["family"] = record["family"]
        model["selectionOrder"] = record.get("order", 0)
        model["identityReviewed"] = bool(record.get("approved") and record.get("identitySource"))
        model["selectedSlots"] = []
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
        ready = (record.get("approved") and record.get("identitySource") and record.get("apiId") and
                 model.get("source") == "firstparty" and model.get("verificationStatus") == "fresh" and
                 0 <= age <= 7 * 86400 and record.get("lifecycle", {}).get("status", "active") == "active")
        model["promotionVerified"] = bool(ready)
        if ready:
            eligible.append(model)
    selections: dict[str, str] = {}
    basket: dict[str, str] = {}
    def retain_or_promote(selection_id: str, fallback: str, provider: str, family: str, stages: list[str]) -> str:
        old_key = previous.get(selection_id, fallback)
        old_record = register["models"].get(old_key, {})
        baseline_order = register["models"][fallback].get("order", 0)
        if (old_key not in by_key or old_record.get("provider") != provider or
            old_record.get("family") != family or old_record.get("order", 0) < baseline_order or
            (old_key != fallback and not old_record.get("approved")) or
            (old_record.get("approved") and old_record.get("stage") not in stages) or
            old_record.get("lifecycle", {}).get("status") in {"deprecated", "retired"}):
            old_key = fallback
        old_order = register["models"][old_key].get("order", 0)
        candidates = [m for m in eligible if m["provider"] == provider and m["family"] == family and
                      m["releaseStage"] in stages and m["selectionOrder"] > old_order]
        # Equal ranks never select a different model by name or price.
        winner = max(candidates, key=lambda m: m["selectionOrder"], default=None)
        selected = winner["key"] if winner else old_key
        selections[selection_id] = selected
        return selected
    for provider, policy in register["basket"].items():
        selected = retain_or_promote("basket:"+provider, policy["fallback"], provider, policy["family"], policy["allowStages"])
        if selected not in by_key:
            raise ValueError(f"Missing basket fallback: {selected}")
        basket[provider] = selected
        for model in models:
            if model["provider"] == provider:
                model["indexEligible"] = model["key"] == selected
    for column in register["apiShortlist"]:
        for slot in column["slots"]:
            fallback = next((key for key in slot["candidates"] if key in by_key and
                             register["models"][key].get("lifecycle", {}).get("status") not in {"deprecated", "retired"}), None)
            if fallback is None:
                continue
            selected = retain_or_promote("slot:"+slot["id"], fallback, slot["provider"], slot["family"], ["stable", "preview"])
            by_key[selected]["selectedSlots"].append(slot["id"])
    return {"version": 1, "reviewedAt": register["reviewedAt"], "policy": register["policy"],
            "basket": basket, "selections": selections, "models": register["models"],
            "apiShortlist": register["apiShortlist"], "openShortlist": register["openShortlist"]}
