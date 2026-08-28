#!/usr/bin/env python3
"""Collect OpenRouter's per-venue model offers into a separate public feed.

The price tape intentionally carries one normalized quote per model. This
collector preserves the market beneath that quote: every routed venue, its
posted token rates, context, quantization, and supported API parameters.

Transient endpoint failures reuse the previous model-level offer set. A new
feed is written only when stable offer data changes, so volatile routing health
does not force a publication on every hourly scan.
"""

from __future__ import annotations

import argparse
import json
import os
import sys
import time
import urllib.error
import urllib.request
from concurrent.futures import ThreadPoolExecutor, as_completed
from datetime import datetime, timezone
from decimal import Decimal
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


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_FILE = ROOT / "data" / "offers.json"
DEFAULT_STATE_DIR = Path(__file__).resolve().parent / "state"
DEFAULT_MODELS_SOURCE = DEFAULT_STATE_DIR / "last-good-openrouter.json"
OPENROUTER_ORIGIN = "https://openrouter.ai"
MAX_RESPONSE_BYTES = 10 * 1024 * 1024
DEFAULT_WORKERS = 8
DEFAULT_MIN_COVERAGE = Decimal("0.80")
RETRYABLE_STATUS_CODES = {429, 500, 502, 503, 504}


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
    return {
        "key": target["key"],
        "canonicalKey": target["canonicalKey"],
        "sourceUrl": target["sourceUrl"],
        "offers": offers,
    }


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
            collected[key] = previous_model
            reused += 1

    coverage = Decimal(len(collected)) / Decimal(len(targets))
    if coverage < min_coverage:
        raise CollectorError(
            f"venue offer coverage is {coverage:.0%} ({len(collected)}/{len(targets)}), "
            f"below the {min_coverage:.0%} minimum"
        )

    models = [collected[key] for key in sorted(collected)]
    offers = [offer for model in models for offer in model["offers"]]
    venue_count = len({offer["venue"] for offer in offers})
    payload = {
        "generatedAt": generated_at,
        "asOf": date,
        "source": "openrouter-endpoints",
        "targetModelCount": len(targets),
        "modelCount": len(models),
        "offerCount": len(offers),
        "venueCount": venue_count,
        "models": models,
    }
    changed = core_payload(payload) != core_payload(previous)

    state_dir.mkdir(parents=True, exist_ok=True)
    heartbeat = {
        "checkedAt": generated_at,
        "status": "degraded" if failures else "healthy",
        "targetModelCount": len(targets),
        "modelCount": len(models),
        "offerCount": len(offers),
        "venueCount": venue_count,
        "failedModelCount": len(failures),
        "reusedModelCount": reused,
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
    parser = argparse.ArgumentParser(description="Collect OpenRouter per-venue model offers")
    parser.add_argument("--models-source", type=Path, default=DEFAULT_MODELS_SOURCE)
    parser.add_argument("--models-url", default=None, help="fetch a current model list instead of reading state")
    parser.add_argument("--data-file", type=Path, default=DEFAULT_DATA_FILE)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
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
        result = collect_offers(
            models_payload=models_payload,
            data_file=args.data_file,
            state_dir=args.state_dir,
            workers=args.workers,
            min_coverage=args.min_coverage,
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
