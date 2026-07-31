"""Idempotent corrections for already-published feed defects."""

from __future__ import annotations

from typing import Any


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
