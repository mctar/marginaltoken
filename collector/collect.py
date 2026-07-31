#!/usr/bin/env python3
"""Collect, validate, diff, and publish The Marginal Token feed.

The runtime is intentionally Python 3.11+ standard library only. A successful
change writes one coherent feed revision and leaves a publish-pending marker.
Network, parsing, and validation failures leave the public data directory
untouched so the last-good revision remains available.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import tempfile
import urllib.request
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from pathlib import Path
from typing import Any

try:
    from collector.official import DEFAULT_MAX_STALE_HOURS, refresh_firstparty
    from collector.repairs import repair_openai_july_30
except ModuleNotFoundError:  # Direct execution: python3 collector/collect.py
    from official import DEFAULT_MAX_STALE_HOURS, refresh_firstparty
    from repairs import repair_openai_july_30


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_STATE_DIR = Path(__file__).resolve().parent / "state"
DEFAULT_FIRSTPARTY = Path(__file__).resolve().parent / "firstparty.json"
OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models"

PRICE_QUANTUM = Decimal("0.0001")
CHANGE_THRESHOLD = Decimal("0.0001")
DEFAULT_MIN_MODELS = 100
DEFAULT_RETENTION_RATIO = Decimal("0.80")
MAX_RESPONSE_BYTES = 20 * 1024 * 1024
CHANGE_LIMIT = 500


class CollectorError(RuntimeError):
    """A recoverable collection or validation failure."""


def utc_now() -> datetime:
    return datetime.now(timezone.utc)


def iso_utc(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def load_json(path: Path) -> Any:
    with path.open(encoding="utf-8") as handle:
        return json.load(handle)


def atomic_write_text(path: Path, value: str) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    fd, temporary = tempfile.mkstemp(prefix=f".{path.name}.", dir=path.parent)
    try:
        with os.fdopen(fd, "w", encoding="utf-8") as handle:
            handle.write(value)
            handle.flush()
            os.fsync(handle.fileno())
        os.replace(temporary, path)
    except Exception:
        try:
            os.unlink(temporary)
        except OSError:
            pass
        raise


def atomic_write_json(path: Path, payload: Any) -> None:
    atomic_write_text(path, json.dumps(payload, indent=2, ensure_ascii=False) + "\n")


def decimal_value(value: Any, label: str) -> Decimal:
    try:
        parsed = Decimal(str(value))
    except (InvalidOperation, ValueError) as error:
        raise CollectorError(f"{label} is not a decimal") from error
    if not parsed.is_finite():
        raise CollectorError(f"{label} is not finite")
    return parsed


def mtok_value(value: Any, label: str) -> float:
    parsed = decimal_value(value, label)
    if parsed < 0:
        raise CollectorError(f"{label} is negative")
    return float((parsed * Decimal(1_000_000)).quantize(PRICE_QUANTUM, rounding=ROUND_HALF_UP))


def normalized_price(value: Any, label: str) -> float:
    parsed = decimal_value(value, label)
    if parsed < 0:
        raise CollectorError(f"{label} is negative")
    return float(parsed.quantize(PRICE_QUANTUM, rounding=ROUND_HALF_UP))


def fetch_openrouter(url: str, source_file: Path | None = None) -> dict[str, Any]:
    if source_file is not None:
        payload = load_json(source_file)
    else:
        request = urllib.request.Request(
            url,
            headers={
                "Accept": "application/json",
                "User-Agent": "The-Marginal-Token/1.0 (+https://marginaltoken.com)",
            },
        )
        with urllib.request.urlopen(request, timeout=25) as response:
            body = response.read(MAX_RESPONSE_BYTES + 1)
        if len(body) > MAX_RESPONSE_BYTES:
            raise CollectorError("OpenRouter response exceeded 20 MiB")
        payload = json.loads(body)
    if not isinstance(payload, dict) or not isinstance(payload.get("data"), list):
        raise CollectorError("OpenRouter response must contain a data array")
    return payload


def display_name(raw_name: Any, key: str) -> str:
    if not isinstance(raw_name, str) or not raw_name.strip():
        return key.split("/", 1)[-1]
    name = raw_name.strip()
    if ": " in name:
        return name.split(": ", 1)[1]
    return name


def string_list(value: Any) -> list[str]:
    if not isinstance(value, list):
        return []
    return sorted(
        {
            item.strip().lower()
            for item in value
            if isinstance(item, str) and item.strip()
        }
    )


def release_stage(key: str) -> str:
    lowered = key.lower()
    if "experimental" in lowered or "-exp-" in lowered or lowered.endswith(":exp"):
        return "experimental"
    if "preview" in lowered:
        return "preview"
    return "stable"


def normalize_openrouter(payload: dict[str, Any]) -> list[dict[str, Any]]:
    models: list[dict[str, Any]] = []
    seen: set[str] = set()
    for raw in payload["data"]:
        if not isinstance(raw, dict):
            continue
        key = raw.get("id")
        if not isinstance(key, str) or "/" not in key:
            continue

        # Free and batch variants distort the standard-rate tape. Tilde-prefixed
        # rows are OpenRouter aliases. Negative prices denote variable-price
        # routers, not a token price, so those rows are also excluded.
        if ":batch" in key or key.startswith("~"):
            continue
        pricing = raw.get("pricing")
        if not isinstance(pricing, dict):
            continue
        try:
            prompt_raw = decimal_value(pricing.get("prompt"), f"{key} prompt price")
            completion_raw = decimal_value(pricing.get("completion"), f"{key} completion price")
        except CollectorError:
            continue
        if prompt_raw < 0 or completion_raw < 0:
            continue
        if prompt_raw == 0 and completion_raw == 0:
            continue
        if key in seen:
            raise CollectorError(f"duplicate OpenRouter model id: {key}")
        seen.add(key)

        provider = key.split("/", 1)[0]
        context = raw.get("context_length")
        if not isinstance(context, int) or context < 0:
            context = 0
        architecture = raw.get("architecture")
        if not isinstance(architecture, dict):
            architecture = {}
        supported_parameters = string_list(raw.get("supported_parameters"))
        reasoning = raw.get("reasoning")
        top_provider = raw.get("top_provider")
        if not isinstance(top_provider, dict):
            top_provider = {}

        model = {
            "key": key,
            "display": display_name(raw.get("name"), key),
            "provider": provider,
            "input_mtok": mtok_value(prompt_raw, f"{key} prompt price"),
            "output_mtok": mtok_value(completion_raw, f"{key} completion price"),
            "context": context,
            "source": "openrouter",
            "indexEligible": False,
            "inputModalities": string_list(architecture.get("input_modalities")),
            "outputModalities": string_list(architecture.get("output_modalities")),
            "supportsReasoning": bool(reasoning)
            or "reasoning" in supported_parameters
            or "include_reasoning" in supported_parameters,
            "supportsTools": "tools" in supported_parameters,
            "supportsStructuredOutput": "response_format" in supported_parameters,
            "releaseStage": release_stage(key),
        }
        max_output_tokens = top_provider.get("max_completion_tokens")
        if isinstance(max_output_tokens, int) and max_output_tokens > 0:
            model["maxOutputTokens"] = max_output_tokens
        for raw_field, output_field in (
            ("knowledge_cutoff", "knowledgeCutoff"),
            ("expiration_date", "expirationDate"),
            ("hugging_face_id", "huggingFaceId"),
        ):
            value = raw.get(raw_field)
            if isinstance(value, str) and value.strip():
                model[output_field] = value.strip()
        models.append(model)
    return sorted(models, key=lambda model: model["key"])


def normalize_firstparty(payload: Any) -> list[dict[str, Any]]:
    if not isinstance(payload, list) or not payload:
        raise CollectorError("firstparty.json must be a non-empty array")
    entries: list[dict[str, Any]] = []
    seen: set[str] = set()
    required_strings = ("provider", "model", "display", "source_url", "checked")
    for index, raw in enumerate(payload):
        if not isinstance(raw, dict):
            raise CollectorError(f"firstparty entry {index} must be an object")
        for field in required_strings:
            if not isinstance(raw.get(field), str) or not raw[field].strip():
                raise CollectorError(f"firstparty entry {index} has invalid {field}")
        provider = raw["provider"].strip().lower()
        model = raw["model"].strip()
        key = f"{provider}/{model}"
        if key in seen:
            raise CollectorError(f"duplicate first-party model: {key}")
        seen.add(key)
        if not raw["source_url"].startswith("https://"):
            raise CollectorError(f"{key} source_url must use https")
        try:
            datetime.strptime(raw["checked"], "%Y-%m-%d")
        except ValueError as error:
            raise CollectorError(f"{key} checked must be YYYY-MM-DD") from error
        input_price = normalized_price(raw.get("input_mtok"), f"{key} input_mtok")
        output_price = normalized_price(raw.get("output_mtok"), f"{key} output_mtok")
        if input_price == 0 and output_price == 0:
            raise CollectorError(f"{key} cannot have two zero prices")
        context = raw.get("context", 0)
        if not isinstance(context, int) or context < 0:
            raise CollectorError(f"{key} context must be a non-negative integer")
        entries.append(
            {
                "key": key,
                "display": raw["display"].strip(),
                "provider": provider,
                "input_mtok": input_price,
                "output_mtok": output_price,
                "context": context,
                "source": "firstparty",
                "sourceUrl": raw["source_url"],
                "checked": raw["checked"],
                "rateNote": str(raw.get("rate_note", "Standard API rate")),
                "indexEligible": bool(raw.get("index_eligible", False)),
            }
        )
    eligible_counts: dict[str, int] = {}
    for entry in entries:
        eligible_counts.setdefault(entry["provider"], 0)
        if entry["indexEligible"]:
            eligible_counts[entry["provider"]] += 1
    invalid_providers = [
        provider for provider, count in eligible_counts.items() if count != 1
    ]
    if invalid_providers:
        details = ", ".join(
            f"{provider} ({eligible_counts[provider]})" for provider in invalid_providers
        )
        raise CollectorError(
            f"each first-party provider must have exactly one index representative: {details}"
        )
    return entries


def load_firstparty(path: Path) -> list[dict[str, Any]]:
    return normalize_firstparty(load_json(path))


def merge_models(
    openrouter: list[dict[str, Any]], firstparty: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    merged = {model["key"]: dict(model) for model in openrouter}
    for curated in firstparty:
        base = merged.get(curated["key"], {})
        combined = dict(base)
        combined.update(curated)
        if not curated["context"] and base.get("context"):
            combined["context"] = base["context"]
        merged[curated["key"]] = combined
    return sorted(merged.values(), key=lambda model: model["key"])


def firstparty_conflicts(
    openrouter: list[dict[str, Any]], firstparty: list[dict[str, Any]]
) -> list[dict[str, Any]]:
    """Describe matching-key price disagreements without changing precedence."""

    broad = {model["key"]: model for model in openrouter}
    conflicts: list[dict[str, Any]] = []
    for official in firstparty:
        routed = broad.get(official["key"])
        if not routed:
            continue
        for field in ("input_mtok", "output_mtok"):
            official_value = price_decimal(official, field)
            routed_value = price_decimal(routed, field)
            if abs(official_value - routed_value) <= CHANGE_THRESHOLD:
                continue
            conflicts.append(
                {
                    "key": official["key"],
                    "field": field,
                    "firstparty": float(official_value),
                    "openrouter": float(routed_value),
                }
            )
    return conflicts


def read_feed(path: Path, default: Any) -> Any:
    if not path.exists():
        return default
    try:
        return load_json(path)
    except (OSError, json.JSONDecodeError) as error:
        raise CollectorError(f"cannot read previous feed file {path.name}") from error


def price_decimal(model: dict[str, Any], field: str) -> Decimal:
    return Decimal(str(model[field]))


def apply_price_tolerance(
    current: list[dict[str, Any]], previous_by_key: dict[str, dict[str, Any]]
) -> None:
    for model in current:
        old = previous_by_key.get(model["key"])
        if not old:
            continue
        for field in ("input_mtok", "output_mtok"):
            difference = abs(price_decimal(model, field) - price_decimal(old, field))
            if difference <= CHANGE_THRESHOLD:
                model[field] = old[field]


def percentage_change(before: Any, after: Any) -> float | None:
    start = Decimal(str(before))
    if start == 0:
        return None
    end = Decimal(str(after))
    return float((((end - start) / start) * 100).quantize(Decimal("0.1"), rounding=ROUND_HALF_UP))


def diff_models(
    current: list[dict[str, Any]], previous: list[dict[str, Any]], date: str
) -> tuple[list[dict[str, Any]], set[str]]:
    current_by_key = {model["key"]: model for model in current}
    previous_by_key = {model["key"]: model for model in previous}
    events: list[dict[str, Any]] = []
    changed_price_keys: set[str] = set()

    for key in sorted(current_by_key.keys() - previous_by_key.keys()):
        model = current_by_key[key]
        events.append(
            {
                "type": "listed",
                "date": date,
                "key": key,
                "display": model["display"],
                "field": "listed",
            }
        )
    for key in sorted(previous_by_key.keys() - current_by_key.keys()):
        model = previous_by_key[key]
        events.append(
            {
                "type": "delisted",
                "date": date,
                "key": key,
                "display": model["display"],
                "field": "delisted",
            }
        )
    for key in sorted(current_by_key.keys() & previous_by_key.keys()):
        current_model = current_by_key[key]
        previous_model = previous_by_key[key]
        for field in ("input_mtok", "output_mtok"):
            before = previous_model[field]
            after = current_model[field]
            if abs(Decimal(str(after)) - Decimal(str(before))) <= CHANGE_THRESHOLD:
                continue
            changed_price_keys.add(key)
            events.append(
                {
                    "type": "price",
                    "date": date,
                    "key": key,
                    "display": current_model["display"],
                    "field": field,
                    "from": before,
                    "to": after,
                    "pct": percentage_change(before, after),
                }
            )
    return events, changed_price_keys


def basket_for(models: list[dict[str, Any]]) -> list[str]:
    by_provider: dict[str, list[dict[str, Any]]] = {}
    for model in models:
        if model.get("source") == "firstparty" and model.get("indexEligible"):
            by_provider.setdefault(model["provider"], []).append(model)
    if not by_provider:
        raise CollectorError("the index basket has no eligible first-party models")
    duplicate_providers = [
        provider for provider, candidates in by_provider.items() if len(candidates) != 1
    ]
    if duplicate_providers:
        raise CollectorError(
            "the index basket requires exactly one representative per provider: "
            + ", ".join(sorted(duplicate_providers))
        )
    return sorted(candidates[0]["key"] for candidates in by_provider.values())


def basket_mean(models: list[dict[str, Any]], basket: list[str]) -> Decimal:
    by_key = {model["key"]: model for model in models}
    try:
        values = [Decimal(str(by_key[key]["output_mtok"])) for key in basket]
    except KeyError as error:
        raise CollectorError(f"basket model missing from current tape: {error.args[0]}") from error
    if not values:
        raise CollectorError("cannot calculate an empty basket")
    return sum(values) / Decimal(len(values))


def index_value(current_mean: Decimal, base_mean: Decimal) -> float:
    if base_mean <= 0:
        raise CollectorError("index base mean must be positive")
    return float(((current_mean / base_mean) * 100).quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))


def replace_daily_index_point(
    points: list[dict[str, Any]], date: str, value: float
) -> list[dict[str, Any]]:
    kept = [point for point in points if point.get("date") != date]
    kept.append({"date": date, "value": value})
    return sorted(kept, key=lambda point: point["date"])


def write_heartbeat(state_dir: Path, now: datetime, status: str, detail: str = "") -> None:
    payload = {"checkedAt": iso_utc(now), "status": status}
    if detail:
        payload["detail"] = detail
    atomic_write_json(state_dir / "heartbeat.json", payload)


def collect_once(
    *,
    data_dir: Path,
    state_dir: Path,
    firstparty_path: Path,
    source_file: Path | None = None,
    url: str = OPENROUTER_MODELS_URL,
    now: datetime | None = None,
    min_models: int = DEFAULT_MIN_MODELS,
    retention_ratio: Decimal = DEFAULT_RETENTION_RATIO,
    rebase_index: bool = False,
    refresh_official: bool | None = None,
    max_firstparty_stale_hours: int = DEFAULT_MAX_STALE_HOURS,
) -> str:
    now = now or utc_now()
    generated_at = iso_utc(now)
    date = now.astimezone(timezone.utc).strftime("%Y-%m-%d")

    baseline_catalog = load_json(firstparty_path)
    normalize_firstparty(baseline_catalog)
    if refresh_official is None:
        refresh_official = source_file is None
    if refresh_official:
        refreshed_catalog, firstparty_report = refresh_firstparty(
            baseline_catalog,
            state_dir=state_dir,
            now=now,
            max_stale_hours=max_firstparty_stale_hours,
        )
        curated = normalize_firstparty(refreshed_catalog)
    else:
        curated = normalize_firstparty(baseline_catalog)
        providers = sorted({model["provider"] for model in curated})
        firstparty_report = {
            "checkedAt": generated_at,
            "status": "skipped",
            "degradedProviderCount": 0,
            "providers": [
                {
                    "provider": provider,
                    "status": "skipped",
                    "sourceUrl": "",
                    "verifiedAt": None,
                    "modelCount": sum(model["provider"] == provider for model in curated),
                }
                for provider in providers
            ],
        }

    raw_payload = fetch_openrouter(url, source_file)
    openrouter = normalize_openrouter(raw_payload)
    conflicts = firstparty_conflicts(openrouter, curated)
    public_providers = [
        {
            "provider": report["provider"],
            "status": report["status"],
            "sourceUrl": report["sourceUrl"],
            "lastVerified": (
                str(report.get("verifiedAt"))[:10] if report.get("verifiedAt") else None
            ),
            "modelCount": report["modelCount"],
        }
        for report in firstparty_report["providers"]
    ]
    source_status = (
        "degraded"
        if firstparty_report["status"] == "degraded"
        else "attention" if conflicts else "healthy"
    )
    provenance_core = {
        "asOf": date,
        "status": source_status,
        "degradedProviderCount": firstparty_report["degradedProviderCount"],
        "conflictCount": len(conflicts),
        "providers": public_providers,
        "conflicts": conflicts,
    }
    atomic_write_json(
        state_dir / "firstparty-heartbeat.json",
        {**firstparty_report, "conflictCount": len(conflicts), "conflicts": conflicts},
    )
    models = merge_models(openrouter, curated)
    if len(models) < min_models:
        raise CollectorError(f"only {len(models)} normalized models, minimum is {min_models}")

    previous_prices = read_feed(data_dir / "prices.json", {})
    previous_models = previous_prices.get("models", []) if isinstance(previous_prices, dict) else []
    if not isinstance(previous_models, list):
        raise CollectorError("previous prices.json has an invalid models field")
    if previous_models and Decimal(len(models)) / Decimal(len(previous_models)) < retention_ratio:
        raise CollectorError(
            f"normalized model count fell from {len(previous_models)} to {len(models)}, "
            f"below the {retention_ratio:.0%} retention threshold"
        )

    previous_history = read_feed(data_dir / "history.json", {"points": []})
    history_points = list(previous_history.get("points", []))
    previous_changes = read_feed(data_dir / "changes.json", {"changes": []})
    old_events = list(previous_changes.get("changes", []))
    repair_applied = repair_openai_july_30(previous_models, history_points, old_events)

    previous_provenance = read_feed(data_dir / "provenance.json", {})
    previous_provenance_core = {
        key: value
        for key, value in previous_provenance.items()
        if key not in {"generatedAt", "asOf"}
    } if isinstance(previous_provenance, dict) else {}
    provenance_changed = {
        key: value for key, value in provenance_core.items() if key != "asOf"
    } != previous_provenance_core

    previous_by_key = {model["key"]: model for model in previous_models}
    apply_price_tolerance(models, previous_by_key)
    is_initial = not previous_models
    events, changed_price_keys = diff_models(models, previous_models, date) if not is_initial else ([], set())
    models_changed = models != previous_models

    if (
        not is_initial
        and not models_changed
        and not rebase_index
        and not repair_applied
        and not provenance_changed
    ):
        state_dir.mkdir(parents=True, exist_ok=True)
        atomic_write_json(state_dir / "last-good-openrouter.json", raw_payload)
        write_heartbeat(state_dir, now, "unchanged")
        return "unchanged"

    current_by_key = {model["key"]: model for model in models}
    if is_initial:
        history_points = [
            {
                "key": model["key"],
                "date": date,
                "input_mtok": model["input_mtok"],
                "output_mtok": model["output_mtok"],
            }
            for model in models
        ]
    else:
        listed_keys = {event["key"] for event in events if event["type"] == "listed"}
        for key in sorted(changed_price_keys | listed_keys):
            model = current_by_key[key]
            history_points.append(
                {
                    "key": key,
                    "date": date,
                    "input_mtok": model["input_mtok"],
                    "output_mtok": model["output_mtok"],
                }
            )

    previous_meta = read_feed(data_dir / "meta.json", {})
    basket = basket_for(models)
    current_mean = basket_mean(models, basket)
    if rebase_index:
        base_mean = current_mean
        base_date = str(previous_meta.get("indexBaseDate") or date)
        index_history = [{"date": base_date, "value": 100.0}]
    elif is_initial or not previous_meta:
        base_mean = current_mean
        base_date = date
        index_history: list[dict[str, Any]] = []
    else:
        try:
            base_mean = Decimal(str(previous_meta["indexBaseMean"]))
            base_date = str(previous_meta["indexBaseDate"])
        except (KeyError, InvalidOperation) as error:
            raise CollectorError("previous meta.json lacks a valid index base") from error
        index_history = list(previous_meta.get("indexHistory", []))
    current_index = index_value(current_mean, base_mean)
    previous_index = previous_meta.get("indexValue")
    previous_basket = previous_meta.get("basket", [])
    if previous_meta and previous_basket != basket and not rebase_index:
        events.append(
            {
                "type": "basket",
                "date": date,
                "key": "index",
                "display": "Index basket",
                "field": "basket",
                "from": previous_basket,
                "to": basket,
            }
        )
    if not rebase_index and (is_initial or previous_index != current_index or previous_basket != basket):
        index_history = replace_daily_index_point(index_history, date, current_index)

    all_events = (events + old_events)[:CHANGE_LIMIT]

    prices_payload = {"generatedAt": generated_at, "asOf": date, "models": models}
    history_payload = {"generatedAt": generated_at, "points": history_points}
    changes_payload = {"generatedAt": generated_at, "changes": all_events}
    provenance_payload = {"generatedAt": generated_at, **provenance_core}
    meta_payload = {
        "generatedAt": generated_at,
        "asOf": date,
        "modelCount": len(models),
        "indexValue": current_index,
        "indexBase": 100,
        "indexBaseDate": base_date,
        "indexBaseMean": float(base_mean.quantize(Decimal("0.000001"), rounding=ROUND_HALF_UP)),
        "basket": basket,
        "indexHistory": index_history,
    }

    data_dir.mkdir(parents=True, exist_ok=True)
    for filename, payload in (
        ("prices.json", prices_payload),
        ("history.json", history_payload),
        ("changes.json", changes_payload),
        ("meta.json", meta_payload),
        ("provenance.json", provenance_payload),
    ):
        atomic_write_json(data_dir / filename, payload)

    state_dir.mkdir(parents=True, exist_ok=True)
    atomic_write_json(
        state_dir / "editorial-input.json",
        {
            "generatedAt": generated_at,
            "asOf": date,
            "indexValue": current_index,
            "events": events,
        },
    )
    atomic_write_json(state_dir / "last-good-openrouter.json", raw_payload)
    atomic_write_text(state_dir / "publish-pending", generated_at + "\n")
    write_heartbeat(state_dir, now, "changed", f"{len(events)} events")
    return "changed"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect The Marginal Token price feed")
    parser.add_argument("--source-file", type=Path, help="read an OpenRouter fixture instead of the network")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    parser.add_argument("--firstparty", type=Path, default=DEFAULT_FIRSTPARTY)
    parser.add_argument("--url", default=os.environ.get("MARGINALTOKEN_MODELS_URL", OPENROUTER_MODELS_URL))
    parser.add_argument(
        "--min-models",
        type=int,
        default=int(os.environ.get("MARGINALTOKEN_MIN_MODELS", DEFAULT_MIN_MODELS)),
    )
    parser.add_argument(
        "--retention-ratio",
        type=Decimal,
        default=Decimal(os.environ.get("MARGINALTOKEN_RETENTION_RATIO", str(DEFAULT_RETENTION_RATIO))),
    )
    parser.add_argument(
        "--rebase-index",
        action="store_true",
        help="reset the Deflator basis after an explicit methodology correction",
    )
    parser.add_argument(
        "--skip-firstparty-refresh",
        action="store_true",
        help="use the checked-in first-party fallback without network verification",
    )
    parser.add_argument(
        "--max-firstparty-stale-hours",
        type=int,
        default=int(
            os.environ.get(
                "MARGINALTOKEN_FIRSTPARTY_MAX_STALE_HOURS",
                str(DEFAULT_MAX_STALE_HOURS),
            )
        ),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    now = utc_now()
    try:
        result = collect_once(
            data_dir=args.data_dir,
            state_dir=args.state_dir,
            firstparty_path=args.firstparty,
            source_file=args.source_file,
            url=args.url,
            now=now,
            min_models=args.min_models,
            retention_ratio=args.retention_ratio,
            rebase_index=args.rebase_index,
            refresh_official=(not args.skip_firstparty_refresh and args.source_file is None),
            max_firstparty_stale_hours=args.max_firstparty_stale_hours,
        )
        print(f"collector: {result}")
    except Exception as error:  # Last-good is safer than an hourly destructive failure.
        print(f"collector: {error}", file=sys.stderr)
        try:
            write_heartbeat(args.state_dir, now, "error", str(error))
        except Exception as heartbeat_error:
            print(f"collector: could not write heartbeat: {heartbeat_error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
