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

    def select(selection_id: str, fallbacks: list[str], provider: str, family: str, stages: list[str], *, direct_only: bool = False) -> str | None:
        def usable(key: str | None) -> bool:
            if not key or key not in by_key:
                return False
            record = register["models"].get(key, {})
            return (record.get("provider") == provider and record.get("family") == family
                    and record.get("lifecycle", {}).get("status") not in {"deprecated", "retired"}
                    and (not record.get("approved") or record.get("stage") in stages)
                    and (not direct_only or by_key[key].get("source") == "firstparty"))

        baseline = next((key for key in fallbacks if usable(key)), None)
        incumbent = previous.get(selection_id)
        if not usable(incumbent):
            incumbent = baseline
        elif incumbent not in fallbacks and not register["models"][incumbent].get("approved"):
            incumbent = baseline
        if baseline and incumbent and register["models"][baseline]["order"] > register["models"][incumbent]["order"]:
            incumbent = baseline
        # Even when a predecessor disappears, evaluate verified successors.
        minimum = register["models"][incumbent]["order"] if incumbent else -float("inf")
        candidates = [m for m in eligible if m["provider"] == provider and m["family"] == family
                      and m["releaseStage"] in stages and m["selectionOrder"] > minimum]
        if candidates:
            highest = max(m["selectionOrder"] for m in candidates)
            leaders = [m["key"] for m in candidates if m["selectionOrder"] == highest]
            if len(leaders) == 1:
                incumbent = leaders[0]
        if incumbent:
            selections[selection_id] = incumbent
        return incumbent

    for provider, policy in register["basket"].items():
        selected = select("basket:"+provider, [policy["fallback"]], provider, policy["family"], policy["allowStages"], direct_only=True)
        if not selected:
            raise ValueError(f"No usable basket member for {provider}; review {policy['family']}")
        basket[provider] = selected
        for model in models:
            if model["provider"] == provider:
                model["indexEligible"] = model["key"] == selected
    for column in register["apiShortlist"]:
        for slot in column["slots"]:
            selected = select("slot:"+slot["id"], slot["candidates"], slot["provider"], slot["family"], ["stable", "preview"])
            if selected:
                by_key[selected]["selectedSlots"].append(slot["id"])
    return {"version": 1, "reviewedAt": register["reviewedAt"], "policy": register["policy"],
            "basket": basket, "selections": selections, "models": register["models"],
            "apiShortlist": register["apiShortlist"], "openShortlist": register["openShortlist"]}
