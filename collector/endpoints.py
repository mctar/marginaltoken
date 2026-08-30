#!/usr/bin/env python3
"""Collect per-venue model offers into a separate public feed.

The price tape intentionally carries one normalized quote per model. This
collector preserves the market beneath that quote: every routed venue, its
posted token rates, context, quantization, and supported API parameters.
OpenRouter supplies the broad route set; direct marketplace catalogs can
verify or supplement the fields they explicitly publish.

Transient endpoint failures reuse the previous model-level offer set. A new
feed is written only when stable offer data changes, so volatile routing health
does not force a publication on every hourly scan.
"""

from __future__ import annotations

import argparse
import hashlib
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal, ROUND_HALF_UP
from pathlib import Path
from typing import Any, Callable

try:
    from collector.collect import (
        CollectorError,
        OPENROUTER_MODELS_URL,
        atomic_write_json,
        atomic_write_text,
        fetch_openrouter,
        iso_utc,
        load_json,
        mtok_value,
        normalize_openrouter,
        read_feed,
        string_list,
        utc_now,
    )
    from collector.together import (
        TOGETHER_CATALOG_URL,
        TOGETHER_SOURCE_KEY,
        TOGETHER_SOURCE_LABEL,
        match_together_catalog,
        refresh_together_catalog,
    )
    from collector.fireworks import (
        FIREWORKS_PRICING_URL,
        FIREWORKS_PUBLIC_URL,
        FIREWORKS_SOURCE_KEY,
        FIREWORKS_SOURCE_LABEL,
        match_fireworks_pricing,
        refresh_fireworks_pricing,
    )
except ModuleNotFoundError:  # Direct execution: python3 collector/endpoints.py
    from collect import (  # type: ignore[no-redef]
        CollectorError,
        OPENROUTER_MODELS_URL,
        atomic_write_json,
        atomic_write_text,
        fetch_openrouter,
        iso_utc,
        load_json,
        mtok_value,
        normalize_openrouter,
        read_feed,
        string_list,
        utc_now,
    )
    from together import (  # type: ignore[no-redef]
        TOGETHER_CATALOG_URL,
        TOGETHER_SOURCE_KEY,
        TOGETHER_SOURCE_LABEL,
        match_together_catalog,
        refresh_together_catalog,
    )
    from fireworks import (  # type: ignore[no-redef]
        FIREWORKS_PRICING_URL,
        FIREWORKS_PUBLIC_URL,
        FIREWORKS_SOURCE_KEY,
        FIREWORKS_SOURCE_LABEL,
        match_fireworks_pricing,
        refresh_fireworks_pricing,
    )


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_FILE = ROOT / "data" / "offers.json"
DEFAULT_STATE_DIR = Path(__file__).resolve().parent / "state"
DEFAULT_MODELS_SOURCE = DEFAULT_STATE_DIR / "last-good-openrouter.json"
OPENROUTER_ORIGIN = "https://openrouter.ai"
OPENROUTER_SOURCE_KEY = "openrouter-endpoints"
OPENROUTER_SOURCE_LABEL = "OpenRouter endpoints"
SOURCE_LABELS = {
    OPENROUTER_SOURCE_KEY: OPENROUTER_SOURCE_LABEL,
    TOGETHER_SOURCE_KEY: TOGETHER_SOURCE_LABEL,
    FIREWORKS_SOURCE_KEY: FIREWORKS_SOURCE_LABEL,
}
MAX_RESPONSE_BYTES = 10 * 1024 * 1024
DEFAULT_WORKERS = 8
DEFAULT_MIN_COVERAGE = Decimal("0.80")
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}
UNDISCLOSED_QUANTIZATIONS = {"", "unknown", "unspecified", "none", "n/a"}
COMPARISON_POLICY = {
    "version": 1,
    "scope": "same-canonical-model",
    "matchingFields": [
        "canonicalKey",
        "quantization",
        "context",
        "maxOutputTokens",
        "supportsReasoning",
        "supportsTools",
        "supportsStructuredOutput",
    ],
    "confidenceLevels": {
        "declared": "Matching precision, limits, and core capabilities are reported.",
        "nominal": "The named model and reported configuration match, but precision is undisclosed.",
        "incomplete": "A context or output limit is missing; the group is not treated as comparable.",
    },
}


def details_url(value: Any) -> str | None:
    if not isinstance(value, str):
        return None
    path = value.strip()
    if not path.startswith("/api/v1/models/") or not path.endswith("/endpoints"):
        return None
    if ".." in path or "?" in path or "#" in path:
        return None
    return f"{OPENROUTER_ORIGIN}{path}"


def offer_targets(payload: dict[str, Any]) -> list[dict[str, str]]:
    """Return safe endpoint targets for the standard-rate models on the Tape."""

    normalized_keys = {model["key"] for model in normalize_openrouter(payload)}
    targets: list[dict[str, str]] = []
    seen: set[str] = set()
    for raw in payload["data"]:
        if not isinstance(raw, dict):
            continue
        key = raw.get("id")
        if not isinstance(key, str) or key not in normalized_keys or key in seen:
            continue
        links = raw.get("links")
        if not isinstance(links, dict):
            continue
        source_url = details_url(links.get("details"))
        if source_url is None:
            continue
        canonical = raw.get("canonical_slug")
        canonical_key = canonical.strip() if isinstance(canonical, str) and "/" in canonical else key
        targets.append({"key": key, "canonicalKey": canonical_key, "sourceUrl": source_url})
        seen.add(key)
    return sorted(targets, key=lambda target: target["key"])


def optional_mtok(pricing: dict[str, Any], field: str, label: str) -> float | None:
    value = pricing.get(field)
    if value is None:
        return None
    try:
        return mtok_value(value, f"{label} {field} price")
    except CollectorError:
        return None


def declared_quantization(offer: dict[str, Any]) -> str | None:
    value = offer.get("quantization")
    if not isinstance(value, str):
        return None
    normalized = value.strip().lower()
    return normalized if normalized not in UNDISCLOSED_QUANTIZATIONS else None


def comparison_signature(target: dict[str, str], offer: dict[str, Any]) -> dict[str, Any]:
    return {
        "canonicalKey": target["canonicalKey"],
        "quantization": declared_quantization(offer) or "undisclosed",
        "context": offer.get("context", 0),
        "maxOutputTokens": offer.get("maxOutputTokens", 0),
        "supportsReasoning": offer.get("supportsReasoning", False),
        "supportsTools": offer.get("supportsTools", False),
        "supportsStructuredOutput": offer.get("supportsStructuredOutput", False),
    }


def configuration_key(signature: dict[str, Any]) -> str:
    serialized = json.dumps(signature, sort_keys=True, separators=(",", ":"))
    return "cfg-" + hashlib.sha256(serialized.encode("utf-8")).hexdigest()[:16]


def comparison_confidence(signature: dict[str, Any]) -> str:
    if not signature["context"] or not signature["maxOutputTokens"]:
        return "incomplete"
    if signature["quantization"] == "undisclosed":
        return "nominal"
    return "declared"


def price_range(values: list[float]) -> dict[str, float]:
    minimum = min(values)
    maximum = max(values)
    result = {"min": minimum, "max": maximum}
    if minimum > 0:
        spread = ((Decimal(str(maximum)) / Decimal(str(minimum))) - 1) * 100
        result["spreadPct"] = float(spread.quantize(Decimal("0.01"), rounding=ROUND_HALF_UP))
    return result


def model_with_comparisons(
    target: dict[str, str],
    offers: list[dict[str, Any]],
) -> dict[str, Any]:
    grouped: dict[str, dict[str, Any]] = {}
    for offer in offers:
        offer.setdefault("source", OPENROUTER_SOURCE_KEY)
        offer.setdefault("sourceUrl", target["sourceUrl"])
        signature = comparison_signature(target, offer)
        key = configuration_key(signature)
        offer["configurationKey"] = key
        group = grouped.setdefault(key, {"signature": signature, "offers": []})
        group["offers"].append(offer)

    comparison_groups: list[dict[str, Any]] = []
    for key in sorted(grouped):
        raw_group = grouped[key]
        signature = raw_group["signature"]
        group_offers = raw_group["offers"]
        confidence = comparison_confidence(signature)
        group: dict[str, Any] = {
            "key": key,
            "confidence": confidence,
            "comparable": len(group_offers) >= 2 and confidence != "incomplete",
            "offerCount": len(group_offers),
            "venueCount": len({offer["venue"] for offer in group_offers}),
            "quantization": signature["quantization"],
            "context": signature["context"],
            "supportsReasoning": signature["supportsReasoning"],
            "supportsTools": signature["supportsTools"],
            "supportsStructuredOutput": signature["supportsStructuredOutput"],
            "input_mtok": price_range([offer["input_mtok"] for offer in group_offers]),
            "output_mtok": price_range([offer["output_mtok"] for offer in group_offers]),
        }
        if signature["maxOutputTokens"]:
            group["maxOutputTokens"] = signature["maxOutputTokens"]
        comparison_groups.append(group)

    sources_by_key: dict[str, dict[str, str]] = {
        OPENROUTER_SOURCE_KEY: {
            "key": OPENROUTER_SOURCE_KEY,
            "label": OPENROUTER_SOURCE_LABEL,
            "sourceUrl": target["sourceUrl"],
        }
    }
    for offer in offers:
        source = offer.get("source")
        source_url = offer.get("sourceUrl")
        if not isinstance(source, str) or not isinstance(source_url, str):
            continue
        label = SOURCE_LABELS.get(source, source)
        sources_by_key[source] = {"key": source, "label": label, "sourceUrl": source_url}
    ordered_sources = [
        OPENROUTER_SOURCE_KEY,
        *(key for key in sorted(sources_by_key) if key != OPENROUTER_SOURCE_KEY),
    ]

    return {
        "key": target["key"],
        "canonicalKey": target["canonicalKey"],
        "sourceUrl": target["sourceUrl"],
        "sources": [sources_by_key[key] for key in ordered_sources],
        "configurationCount": len(comparison_groups),
        "comparableGroupCount": sum(group["comparable"] for group in comparison_groups),
        "comparisonGroups": comparison_groups,
        "offers": offers,
    }


def normalize_offers(target: dict[str, str], payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict):
        raise CollectorError(f"{target['key']} endpoint response must be an object")
    data = payload.get("data")
    if not isinstance(data, dict) or not isinstance(data.get("endpoints"), list):
        raise CollectorError(f"{target['key']} endpoint response lacks data.endpoints")

    offers: list[dict[str, Any]] = []
    seen: set[tuple[str, str]] = set()
    for raw in data["endpoints"]:
        if not isinstance(raw, dict):
            continue
        venue = raw.get("provider_name")
        if not isinstance(venue, str) or not venue.strip():
            continue
        tag = raw.get("tag")
        offer_tag = tag.strip() if isinstance(tag, str) and tag.strip() else venue.strip().lower()
        identity = (venue.strip().lower(), offer_tag.lower())
        if identity in seen:
            continue

        pricing = raw.get("pricing")
        if not isinstance(pricing, dict):
            continue
        input_mtok = optional_mtok(pricing, "prompt", target["key"])
        output_mtok = optional_mtok(pricing, "completion", target["key"])
        if input_mtok is None or output_mtok is None:
            continue
        if input_mtok == 0 and output_mtok == 0:
            continue

        context = raw.get("context_length")
        if not isinstance(context, int) or context < 0:
            context = 0
        supported_parameters = string_list(raw.get("supported_parameters"))
        offer: dict[str, Any] = {
            "venue": venue.strip(),
            "tag": offer_tag,
            "source": OPENROUTER_SOURCE_KEY,
            "sourceUrl": target["sourceUrl"],
            "input_mtok": input_mtok,
            "output_mtok": output_mtok,
            "context": context,
            "supportedParameters": supported_parameters,
            "supportsReasoning": "reasoning" in supported_parameters
            or "include_reasoning" in supported_parameters,
            "supportsTools": "tools" in supported_parameters,
            "supportsStructuredOutput": "response_format" in supported_parameters
            or "structured_outputs" in supported_parameters,
        }
        for raw_field, output_field in (
            ("input_cache_read", "cached_input_mtok"),
            ("input_cache_write", "cache_write_mtok"),
            ("internal_reasoning", "reasoning_mtok"),
        ):
            value = optional_mtok(pricing, raw_field, target["key"])
            if value is not None:
                offer[output_field] = value
        quantization = raw.get("quantization")
        if isinstance(quantization, str) and quantization.strip():
            offer["quantization"] = quantization.strip().lower()
        max_output = raw.get("max_completion_tokens")
        if isinstance(max_output, int) and max_output > 0:
            offer["maxOutputTokens"] = max_output
        offers.append(offer)
        seen.add(identity)

    if not offers:
        raise CollectorError(f"{target['key']} has no normalized venue offers")
    offers.sort(
        key=lambda offer: (
            offer["input_mtok"],
            offer["output_mtok"],
            offer["venue"].lower(),
            offer["tag"].lower(),
        )
    )
    return model_with_comparisons(target, offers)


def merge_direct_catalog(
    *,
    collected: dict[str, dict[str, Any]],
    targets: list[dict[str, str]],
    matched: list[dict[str, Any]],
    unmatched: list[str],
    catalog_count: int,
    source_key: str,
    source_label: str,
    model_id_field: str,
    offer_selector: Callable[[dict[str, Any]], bool],
) -> dict[str, Any]:
    targets_by_key = {target["key"]: target for target in targets}
    verified = 0
    added = 0
    skipped = 0

    for row in matched:
        key = row["key"]
        model = collected.get(key)
        target = targets_by_key.get(key)
        if model is None or target is None:
            skipped += 1
            continue
        offers = [dict(offer) for offer in model.get("offers", []) if isinstance(offer, dict)]
        direct_offers = [offer for offer in offers if offer_selector(offer)]

        if len(direct_offers) == 1:
            offer = direct_offers[0]
            offer["venue"] = source_label
            offer["tag"] = row[model_id_field]
            offer["input_mtok"] = row["input_mtok"]
            offer["output_mtok"] = row["output_mtok"]
            offer["source"] = source_key
            offer["sourceUrl"] = row["sourceUrl"]
            offer["configurationSource"] = OPENROUTER_SOURCE_KEY
            verified_fields = ["input_mtok", "output_mtok"]
            if row.get("context"):
                offer["context"] = row["context"]
                verified_fields.append("context")
            if isinstance(row.get("quantization"), str):
                offer["quantization"] = row["quantization"]
                verified_fields.append("quantization")
            if "cached_input_mtok" in row:
                offer["cached_input_mtok"] = row["cached_input_mtok"]
                verified_fields.append("cached_input_mtok")
            supported_parameters = set(offer.get("supportedParameters", []))
            if isinstance(row.get("supportsTools"), bool):
                offer["supportsTools"] = row["supportsTools"]
                verified_fields.append("supportsTools")
                if row["supportsTools"]:
                    supported_parameters.add("tools")
                else:
                    supported_parameters.discard("tools")
                    supported_parameters.discard("tool_choice")
            if isinstance(row.get("supportsStructuredOutput"), bool):
                offer["supportsStructuredOutput"] = row["supportsStructuredOutput"]
                verified_fields.append("supportsStructuredOutput")
                if row["supportsStructuredOutput"]:
                    supported_parameters.add("response_format")
                else:
                    supported_parameters.discard("response_format")
                    supported_parameters.discard("structured_outputs")
            offer["supportedParameters"] = sorted(supported_parameters)
            offer["verifiedFields"] = sorted(verified_fields)
            verified += 1
        elif len(direct_offers) == 0:
            supported_parameters: list[str] = []
            if row.get("supportsTools") is True:
                supported_parameters.append("tools")
            if row.get("supportsStructuredOutput") is True:
                supported_parameters.append("response_format")
            reported_unknowns = ["maxOutputTokens", "supportsReasoning"]
            if not row.get("context"):
                reported_unknowns.append("context")
            if "supportsTools" not in row:
                reported_unknowns.append("supportsTools")
            if "supportsStructuredOutput" not in row:
                reported_unknowns.append("supportsStructuredOutput")
            direct_offer: dict[str, Any] = {
                "venue": source_label,
                "tag": row[model_id_field],
                "source": source_key,
                "sourceUrl": row["sourceUrl"],
                "input_mtok": row["input_mtok"],
                "output_mtok": row["output_mtok"],
                "context": row.get("context", 0),
                "supportedParameters": sorted(supported_parameters),
                "supportsReasoning": False,
                "supportsTools": row.get("supportsTools", False),
                "supportsStructuredOutput": row.get("supportsStructuredOutput", False),
                "reportedUnknowns": sorted(reported_unknowns),
            }
            for field in ("cached_input_mtok", "quantization"):
                if field in row:
                    direct_offer[field] = row[field]
            offers.append(direct_offer)
            added += 1
        else:
            skipped += 1
            continue

        offers.sort(
            key=lambda offer: (
                offer["input_mtok"],
                offer["output_mtok"],
                offer["venue"].lower(),
                offer["tag"].lower(),
            )
        )
        collected[key] = model_with_comparisons(target, offers)

    return {
        "catalogModelCount": catalog_count,
        "matchedModelCount": len(matched),
        "verifiedOfferCount": verified,
        "addedOfferCount": added,
        "skippedModelCount": skipped,
        "unmatchedModelCount": len(unmatched),
        "unmatchedModels": unmatched[:50],
    }


def merge_together_catalog(
    *,
    collected: dict[str, dict[str, Any]],
    targets: list[dict[str, str]],
    catalog: list[dict[str, Any]],
) -> dict[str, Any]:
    matched, unmatched = match_together_catalog(catalog, targets)
    return merge_direct_catalog(
        collected=collected,
        targets=targets,
        matched=matched,
        unmatched=unmatched,
        catalog_count=len(catalog),
        source_key=TOGETHER_SOURCE_KEY,
        source_label=TOGETHER_SOURCE_LABEL,
        model_id_field="togetherModelId",
        offer_selector=lambda offer: str(offer.get("venue", "")).strip().lower()
        in {"together", "together ai"},
    )


def merge_fireworks_catalog(
    *,
    collected: dict[str, dict[str, Any]],
    targets: list[dict[str, str]],
    catalog: list[dict[str, Any]],
) -> dict[str, Any]:
    matched, unmatched = match_fireworks_pricing(catalog, targets)
    return merge_direct_catalog(
        collected=collected,
        targets=targets,
        matched=matched,
        unmatched=unmatched,
        catalog_count=len(catalog),
        source_key=FIREWORKS_SOURCE_KEY,
        source_label=FIREWORKS_SOURCE_LABEL,
        model_id_field="fireworksModelId",
        offer_selector=lambda offer: (
            str(offer.get("venue", "")).strip().lower() == "fireworks"
            and str(offer.get("tag", "")).strip().lower() == "fireworks"
        ),
    )


def fetch_endpoint(target: dict[str, str]) -> dict[str, Any]:
    request = urllib.request.Request(
        target["sourceUrl"],
        headers={
            "Accept": "application/json",
            "User-Agent": "The-Marginal-Token/1.0 (+https://marginaltoken.com)",
        },
    )
    for attempt in range(2):
        try:
            with urllib.request.urlopen(request, timeout=25) as response:
                body = response.read(MAX_RESPONSE_BYTES + 1)
            if len(body) > MAX_RESPONSE_BYTES:
                raise CollectorError(f"{target['key']} endpoint response exceeded 10 MiB")
            return normalize_offers(target, json.loads(body))
        except urllib.error.HTTPError as error:
            if attempt == 0 and error.code in RETRYABLE_STATUS_CODES:
                retry_after = error.headers.get("Retry-After")
                try:
                    delay = min(max(float(retry_after or 1), 0), 5)
                except ValueError:
                    delay = 1
                time.sleep(delay)
                continue
            raise
    raise CollectorError(f"{target['key']} endpoint request failed")


def core_payload(payload: Any) -> Any:
    if not isinstance(payload, dict):
        return payload
    return {key: value for key, value in payload.items() if key not in {"generatedAt", "asOf"}}


def collect_offers(
    *,
    models_payload: dict[str, Any],
    data_file: Path,
    state_dir: Path,
    now: datetime | None = None,
    workers: int = DEFAULT_WORKERS,
    min_coverage: Decimal = DEFAULT_MIN_COVERAGE,
    fetcher: Callable[[dict[str, str]], dict[str, Any]] = fetch_endpoint,
    together_catalog: list[dict[str, Any]] | None = None,
    together_status: dict[str, Any] | None = None,
    fireworks_catalog: list[dict[str, Any]] | None = None,
    fireworks_status: dict[str, Any] | None = None,
) -> str:
    now = now or utc_now()
    generated_at = iso_utc(now)
    date = now.astimezone(timezone.utc).strftime("%Y-%m-%d")
    targets = offer_targets(models_payload)
    if not targets:
        raise CollectorError("OpenRouter catalog contains no safe venue endpoint targets")
    if workers < 1 or workers > 32:
        raise CollectorError("endpoint worker count must be between 1 and 32")
    if min_coverage <= 0 or min_coverage > 1:
        raise CollectorError("minimum endpoint coverage must be greater than 0 and at most 1")

    previous = read_feed(data_file, {})
    previous_models = previous.get("models", []) if isinstance(previous, dict) else []
    if not isinstance(previous_models, list):
        raise CollectorError("previous offers.json has an invalid models field")
    previous_by_key = {
        model["key"]: model
        for model in previous_models
        if isinstance(model, dict) and isinstance(model.get("key"), str)
    }

    collected: dict[str, dict[str, Any]] = {}
    failures: dict[str, str] = {}
    with ThreadPoolExecutor(max_workers=workers, thread_name_prefix="openrouter-offer") as executor:
        futures = {executor.submit(fetcher, target): target for target in targets}
        for future in as_completed(futures):
            target = futures[future]
            try:
                collected[target["key"]] = future.result()
            except Exception as error:  # Each model has an independent last-good fallback.
                failures[target["key"]] = str(error)

    reused = 0
    for target in targets:
        key = target["key"]
        if key in collected:
            continue
        previous_model = previous_by_key.get(key)
        if previous_model is not None:
            previous_offers = previous_model.get("offers")
            if isinstance(previous_offers, list) and previous_offers:
                copied_offers = [dict(offer) for offer in previous_offers if isinstance(offer, dict)]
                if copied_offers:
                    collected[key] = model_with_comparisons(target, copied_offers)
                    reused += 1

    coverage = Decimal(len(collected)) / Decimal(len(targets))
    if coverage < min_coverage:
        raise CollectorError(
            f"venue offer coverage is {coverage:.0%} ({len(collected)}/{len(targets)}), "
            f"below the {min_coverage:.0%} minimum"
        )

    together_merge = {
        "catalogModelCount": 0,
        "matchedModelCount": 0,
        "verifiedOfferCount": 0,
        "addedOfferCount": 0,
        "skippedModelCount": 0,
        "unmatchedModelCount": 0,
        "unmatchedModels": [],
    }
    if together_catalog:
        together_merge = merge_together_catalog(
            collected=collected,
            targets=targets,
            catalog=together_catalog,
        )
    fireworks_merge = {
        "catalogModelCount": 0,
        "matchedModelCount": 0,
        "verifiedOfferCount": 0,
        "addedOfferCount": 0,
        "skippedModelCount": 0,
        "unmatchedModelCount": 0,
        "unmatchedModels": [],
    }
    if fireworks_catalog:
        fireworks_merge = merge_fireworks_catalog(
            collected=collected,
            targets=targets,
            catalog=fireworks_catalog,
        )

    models = [collected[key] for key in sorted(collected)]
    offers = [offer for model in models for offer in model["offers"]]
    comparison_groups = [group for model in models for group in model["comparisonGroups"]]
    comparable_groups = [group for group in comparison_groups if group["comparable"]]
    venue_count = len({offer["venue"] for offer in offers})
    openrouter_offer_count = sum(
        offer.get("source") == OPENROUTER_SOURCE_KEY
        or offer.get("configurationSource") == OPENROUTER_SOURCE_KEY
        for offer in offers
    )
    together_offer_count = sum(offer.get("source") == TOGETHER_SOURCE_KEY for offer in offers)
    fireworks_offer_count = sum(offer.get("source") == FIREWORKS_SOURCE_KEY for offer in offers)
    source_records: list[dict[str, Any]] = [
        {
            "key": OPENROUTER_SOURCE_KEY,
            "label": OPENROUTER_SOURCE_LABEL,
            "sourceUrl": OPENROUTER_MODELS_URL,
            "modelCount": len(models),
            "offerCount": openrouter_offer_count,
        }
    ]
    if together_status is not None:
        together_record = {
            "key": TOGETHER_SOURCE_KEY,
            "label": TOGETHER_SOURCE_LABEL,
            "sourceUrl": together_status.get("sourceUrl", TOGETHER_CATALOG_URL),
            "catalogModelCount": together_merge["catalogModelCount"],
            "modelCount": together_merge["matchedModelCount"],
            "offerCount": together_offer_count,
            "verifiedOfferCount": together_merge["verifiedOfferCount"],
            "addedOfferCount": together_merge["addedOfferCount"],
        }
        source_records.append(together_record)
    if fireworks_status is not None:
        source_records.append({
            "key": FIREWORKS_SOURCE_KEY,
            "label": FIREWORKS_SOURCE_LABEL,
            "sourceUrl": fireworks_status.get("sourceUrl", FIREWORKS_PUBLIC_URL),
            "catalogModelCount": fireworks_merge["catalogModelCount"],
            "modelCount": fireworks_merge["matchedModelCount"],
            "offerCount": fireworks_offer_count,
            "verifiedOfferCount": fireworks_merge["verifiedOfferCount"],
            "addedOfferCount": fireworks_merge["addedOfferCount"],
        })
    payload = {
        "generatedAt": generated_at,
        "asOf": date,
        "source": "multi-source",
        "sources": source_records,
        "targetModelCount": len(targets),
        "modelCount": len(models),
        "offerCount": len(offers),
        "venueCount": venue_count,
        "comparableModelCount": sum(model["comparableGroupCount"] > 0 for model in models),
        "comparableGroupCount": len(comparable_groups),
        "declaredComparableGroupCount": sum(
            group["confidence"] == "declared" for group in comparable_groups
        ),
        "nominalComparableGroupCount": sum(
            group["confidence"] == "nominal" for group in comparable_groups
        ),
        "comparisonPolicy": COMPARISON_POLICY,
        "models": models,
    }
    changed = core_payload(payload) != core_payload(previous)

    state_dir.mkdir(parents=True, exist_ok=True)
    together_degraded = together_status is not None and together_status.get("status") in {
        "last_good",
        "unavailable",
    }
    fireworks_degraded = fireworks_status is not None and fireworks_status.get("status") in {
        "last_good",
        "unavailable",
    }
    heartbeat = {
        "checkedAt": generated_at,
        "status": "degraded" if failures or together_degraded or fireworks_degraded else "healthy",
        "targetModelCount": len(targets),
        "modelCount": len(models),
        "offerCount": len(offers),
        "venueCount": venue_count,
        "comparableModelCount": payload["comparableModelCount"],
        "comparableGroupCount": payload["comparableGroupCount"],
        "failedModelCount": len(failures),
        "reusedModelCount": reused,
        "sources": [
            {
                "key": OPENROUTER_SOURCE_KEY,
                "status": "degraded" if failures else "healthy",
                "modelCount": len(models),
                "offerCount": openrouter_offer_count,
            },
            *(
                [{**together_status, **together_merge, "offerCount": together_offer_count}]
                if together_status is not None
                else []
            ),
            *(
                [{**fireworks_status, **fireworks_merge, "offerCount": fireworks_offer_count}]
                if fireworks_status is not None
                else []
            ),
        ],
    }
    if failures:
        heartbeat["failedModels"] = sorted(failures)[:50]
        heartbeat["failureDetails"] = {
            key: failures[key][:300]
            for key in sorted(failures)[:20]
        }
    atomic_write_json(state_dir / "offers-heartbeat.json", heartbeat)

    if not changed:
        return "unchanged"
    atomic_write_json(data_file, payload)
    atomic_write_text(state_dir / "publish-pending", generated_at + "\n")
    return "changed"


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    parser = argparse.ArgumentParser(description="Collect per-venue model offers")
    parser.add_argument("--models-source", type=Path, default=DEFAULT_MODELS_SOURCE)
    parser.add_argument("--models-url", default=None, help="fetch a current model list instead of reading state")
    parser.add_argument("--data-file", type=Path, default=DEFAULT_DATA_FILE)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    parser.add_argument(
        "--together-url",
        default=os.environ.get("MARGINALTOKEN_TOGETHER_URL", TOGETHER_CATALOG_URL),
    )
    parser.add_argument("--no-together", action="store_true")
    parser.add_argument(
        "--fireworks-url",
        default=os.environ.get("MARGINALTOKEN_FIREWORKS_URL", FIREWORKS_PRICING_URL),
    )
    parser.add_argument("--no-fireworks", action="store_true")
    parser.add_argument(
        "--workers",
        type=int,
        default=int(os.environ.get("MARGINALTOKEN_ENDPOINT_WORKERS", DEFAULT_WORKERS)),
    )
    parser.add_argument(
        "--min-coverage",
        type=Decimal,
        default=Decimal(os.environ.get("MARGINALTOKEN_ENDPOINT_MIN_COVERAGE", str(DEFAULT_MIN_COVERAGE))),
    )
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    args = parse_args(argv)
    try:
        models_payload = (
            fetch_openrouter(args.models_url or OPENROUTER_MODELS_URL)
            if args.models_url
            else load_json(args.models_source)
        )
        if not isinstance(models_payload, dict) or not isinstance(models_payload.get("data"), list):
            raise CollectorError("OpenRouter model source must contain a data array")
        if args.no_together:
            together_catalog: list[dict[str, Any]] = []
            together_status: dict[str, Any] = {
                "key": TOGETHER_SOURCE_KEY,
                "label": TOGETHER_SOURCE_LABEL,
                "sourceUrl": args.together_url,
                "status": "skipped",
                "checkedAt": iso_utc(utc_now()),
                "catalogModelCount": 0,
            }
        else:
            together_catalog, together_status = refresh_together_catalog(
                state_dir=args.state_dir,
                url=args.together_url,
            )
        if args.no_fireworks:
            fireworks_catalog: list[dict[str, Any]] = []
            fireworks_status: dict[str, Any] = {
                "key": FIREWORKS_SOURCE_KEY,
                "label": FIREWORKS_SOURCE_LABEL,
                "sourceUrl": FIREWORKS_PUBLIC_URL,
                "status": "skipped",
                "checkedAt": iso_utc(utc_now()),
                "catalogModelCount": 0,
            }
        else:
            fireworks_catalog, fireworks_status = refresh_fireworks_pricing(
                state_dir=args.state_dir,
                url=args.fireworks_url,
            )
        result = collect_offers(
            models_payload=models_payload,
            data_file=args.data_file,
            state_dir=args.state_dir,
            workers=args.workers,
            min_coverage=args.min_coverage,
            together_catalog=together_catalog,
            together_status=together_status,
            fireworks_catalog=fireworks_catalog,
            fireworks_status=fireworks_status,
        )
        print(result)
        return 0
    except (CollectorError, OSError, json.JSONDecodeError, ValueError) as error:
        try:
            state_dir = args.state_dir
            state_dir.mkdir(parents=True, exist_ok=True)
            atomic_write_json(
                state_dir / "offers-heartbeat.json",
                {"checkedAt": iso_utc(utc_now()), "status": "failed", "detail": str(error)},
            )
        except OSError:
            pass
        print(f"endpoints: {error}", file=sys.stderr)
        return 1


if __name__ == "__main__":
    raise SystemExit(main())
