"""Idempotent corrections for already-published feed defects."""

from __future__ import annotations

from typing import Any
from decimal import Decimal, ROUND_HALF_UP


# Exact erroneous output values introduced by the column change on 20 October.
OPENAI_OCTOBER_OUTPUTS = {
    "openai/gpt-6-astra": (12.5, 50.0),
    "openai/gpt-6.1-sol": (2.5, 10.0),
    "openai/gpt-6-sol": (2.5, 10.0),
    "openai/gpt-6-luna": (0.125, 0.5),
    "openai/gpt-5.6-sol": (5.0, 20.0),
    "openai/gpt-5.6-terra": (2.5, 12.0),
    "openai/gpt-5.6-luna": (0.25, 1.2),
}


def repair_openai_october_20(previous_models, history_points, changes, meta) -> bool:
    """Repair the observed column defect, preserving genuine same-day moves.

    Only exact first-party error points and their matching price events qualify.
    Refuse an evolved basket/index rather than guessing its counterfactual path.
    The original published feed is retained in the operator's repair archive.
    """
    day = "2026-10-20"
    affected = [p for p in history_points if p.get("date") == day
                and p.get("source") == "firstparty" and p.get("key") in OPENAI_OCTOBER_OUTPUTS
                and p.get("output_mtok") == OPENAI_OCTOBER_OUTPUTS[p["key"]][0]]
    if not affected:
        return False
    basket = meta.get("basket", [])
    index_points = meta.get("indexHistory", [])
    earlier = [p for p in index_points if p["date"] < day]
    later = [p for p in index_points if p["date"] >= day]
    by_key = {m["key"]: m for m in previous_models}
    if (not earlier or len(later) != 1 or later[0]["date"] != day
            or later[0]["value"] != meta.get("indexValue")
            or any(e.get("type") == "basket" and e.get("date", "") >= day for e in changes)):
        raise ValueError("OpenAI October repair needs review: index path has changed")
    for p in affected:
        if by_key.get(p["key"], {}).get("output_mtok") != p["output_mtok"]:
            raise ValueError("OpenAI October repair needs review: current price has changed")
    reference = Decimal(0)
    for key in basket:
        moves = [e for e in changes if e.get("type") == "price" and e.get("key") == key
                 and e.get("field") == "output_mtok" and e.get("date", "") >= day]
        if key not in by_key or len(moves) > 1 or (moves and moves[0]["to"] != by_key[key]["output_mtok"]):
            raise ValueError("OpenAI October repair needs review: basket price path has changed")
        reference += Decimal(str(moves[0]["from"] if moves else by_key[key]["output_mtok"]))
    prior_index = Decimal(str(max(earlier, key=lambda p: p["date"])["value"]))
    observed_sum = sum(Decimal(str(by_key[key]["output_mtok"])) for key in basket)
    rounded = lambda value: float(value.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    if reference <= 0 or rounded(prior_index * observed_sum / reference) != meta["indexValue"]:
        raise ValueError("OpenAI October repair needs review: index does not match the observed defect")
    keys = {p["key"] for p in affected}
    for point in affected:
        point["output_mtok"] = OPENAI_OCTOBER_OUTPUTS[point["key"]][1]
        point["correction"] = "2026-10-21: output column corrected; cache-write price was recorded in error."
    for key in keys:
        by_key[key]["output_mtok"] = OPENAI_OCTOBER_OUTPUTS[key][1]
    changes[:] = [e for e in changes if not (
        e.get("type") == "price" and e.get("date") == day and e.get("key") in keys
        and e.get("field") == "output_mtok"
        and (e.get("to"), e.get("from")) == OPENAI_OCTOBER_OUTPUTS[e["key"]])]
    corrected_sum = sum(Decimal(str(by_key[key]["output_mtok"])) for key in basket)
    value = rounded(prior_index * corrected_sum / reference)
    later[0]["value"] = value
    meta["indexValue"] = value
    meta["basketMean"] = float((corrected_sum / len(basket)).quantize(Decimal("0.000001")))
    return True


OPENAI_REPRICING = {
    "openai/gpt-5.6-luna": {
        "launch": (1.0, 6.0),
        "current": (0.2, 1.2),
        "pct": -80.0,
        "display": "GPT-5.6 Luna",
    },
    "openai/gpt-5.6-terra": {
        "launch": (2.5, 15.0),
        "current": (2.0, 12.0),
        "pct": -20.0,
        "display": "GPT-5.6 Terra",
    },
}


def repair_openai_july_30(
    previous_models: list[dict[str, Any]],
    history_points: list[dict[str, Any]],
    changes: list[dict[str, Any]],
) -> bool:
    """Repair the stale-curation artifact around OpenAI's 2026-07-30 cut.

    The initial broad-tape snapshot used premature OpenRouter values, then the
    stale curated rows produced four false +100% moves. This migration restores
    the July 29 launch prices and the official July 30 reductions. It is safe to
    run on every collection.
    """

    changed = False
    by_key = {model.get("key"): model for model in previous_models}
    for key, correction in OPENAI_REPRICING.items():
        model = by_key.get(key)
        if not model:
            continue
        observed = (model.get("input_mtok"), model.get("output_mtok"))
        if observed == correction["launch"]:
            model["input_mtok"], model["output_mtok"] = correction["current"]
            changed = True

    has_launch_history = False
    for point in history_points:
        key = point.get("key")
        correction = OPENAI_REPRICING.get(str(key))
        if not correction:
            continue
        date = point.get("date")
        if date == "2026-07-29":
            has_launch_history = True
            desired = correction["launch"]
        elif date == "2026-07-30":
            desired = correction["current"]
        else:
            continue
        observed = (point.get("input_mtok"), point.get("output_mtok"))
        if observed != desired:
            point["input_mtok"], point["output_mtok"] = desired
            changed = True

    if not has_launch_history:
        return changed

    desired_events: dict[tuple[str, str], dict[str, Any]] = {}
    for key, correction in OPENAI_REPRICING.items():
        for index, field in enumerate(("input_mtok", "output_mtok")):
            desired_events[(key, field)] = {
                "type": "price",
                "date": "2026-07-30",
                "key": key,
                "display": correction["display"],
                "field": field,
                "from": correction["launch"][index],
                "to": correction["current"][index],
                "pct": correction["pct"],
            }

    seen: set[tuple[str, str]] = set()
    for index, event in enumerate(changes):
        identity = (str(event.get("key")), str(event.get("field")))
        desired = desired_events.get(identity)
        if not desired or event.get("date") != "2026-07-30":
            continue
        seen.add(identity)
        if event != desired:
            changes[index] = desired
            changed = True

    missing = [desired_events[identity] for identity in desired_events if identity not in seen]
    if missing:
        changes[:0] = missing
        changed = True
    return changed
