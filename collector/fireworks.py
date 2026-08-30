#!/usr/bin/env python3
"""Parse and cache Fireworks AI's public Standard serverless prices.

Fireworks publishes a compact Markdown table for headline serverless models.
Only the Standard column is collected; Priority, Fast, US-only, size-banded,
batch, embedding, and dedicated-deployment rates are outside this feed.
"""

from __future__ import annotations

import re
import urllib.request
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable

try:
    from collector.collect import CollectorError, atomic_write_json, iso_utc, read_feed, utc_now
except ModuleNotFoundError:  # Direct import from collector/endpoints.py
    from collect import (  # type: ignore[no-redef]
        CollectorError,
        atomic_write_json,
        iso_utc,
        read_feed,
        utc_now,
    )


FIREWORKS_PRICING_URL = "https://docs.fireworks.ai/serverless/pricing.md"
FIREWORKS_PUBLIC_URL = "https://docs.fireworks.ai/serverless/pricing"
FIREWORKS_SOURCE_KEY = "fireworks-pricing"
FIREWORKS_SOURCE_LABEL = "Fireworks AI"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DEFAULT_MIN_MODELS = 8

REQUIRED_HEADERS = ("model", "standard", "priority")

# Fireworks' app slug identifies the hosted model but not its originating lab.
# Keep this mapping explicit so a similarly named future listing cannot attach
# itself to the wrong canonical model.
FIREWORKS_TARGET_ALIASES = {
    "kimi-k3": "moonshotai/kimi-k3",
    "kimi-k2p7-code": "moonshotai/kimi-k2.7-code",
    "kimi-k2p6": "moonshotai/kimi-k2.6",
    "deepseek-v4-pro-0813": "deepseek/deepseek-v4-pro-0813",
    "deepseek-v4-flash-0731": "deepseek/deepseek-v4-flash-0731",
    "glm-5p3": "z-ai/glm-5.3",
    "glm-5p2": "z-ai/glm-5.2",
    "qwen3p7-plus": "qwen/qwen3.7-plus",
    "qwen3p8-max": "qwen/qwen3.8-max",
    "minimax-m3": "minimax/minimax-m3",
    "gpt-oss-120b": "openai/gpt-oss-120b",
    "muse-glimmer-30b": "meta/muse-glimmer-30b",
    "nemotron-lightning-3p5-30b-a3b": "nvidia/nemotron-3.5-lightning",
    "nemotron-3-ultra-nvfp4": "nvidia/nemotron-3-ultra-550b-a55b",
}


def table_cells(line: str) -> list[str]:
    if not line.strip().startswith("|"):
        return []
    return [cell.strip().replace(r"\$", "$") for cell in line.strip().strip("|").split("|")]


def is_alignment_row(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def standard_table(markdown: str) -> tuple[list[str], list[list[str]]]:
    lines = markdown.splitlines()
    try:
        start = next(
            index for index, line in enumerate(lines)
            if line.strip() == "## Text and vision models"
        )
    except StopIteration as error:
        raise CollectorError("Fireworks pricing lacks a Text and vision models section") from error

    section: list[str] = []
    for line in lines[start + 1 :]:
        if line.startswith("## "):
            break
        section.append(line)

    header_index = next(
        (index for index, line in enumerate(section) if line.strip().startswith("|")),
        None,
    )
    if header_index is None:
        raise CollectorError("Fireworks Standard pricing table is missing")
    headers = [cell.lower() for cell in table_cells(section[header_index])]
    if tuple(headers) != REQUIRED_HEADERS:
        raise CollectorError("Fireworks Standard pricing headers changed")

    rows: list[list[str]] = []
    for line in section[header_index + 1 :]:
        cells = table_cells(line)
        if not cells:
            if rows:
                break
            continue
        if is_alignment_row(cells):
            continue
        if len(cells) != len(headers):
            raise CollectorError("Fireworks Standard pricing contains a malformed row")
        rows.append(cells)
    if not rows:
        raise CollectorError("Fireworks Standard pricing contains no rows")
    return headers, rows


def price_value(value: str, label: str) -> float:
    normalized = value.strip().replace("$", "").replace(",", "")
    try:
        parsed = Decimal(normalized)
    except (InvalidOperation, ValueError) as error:
        raise CollectorError(f"Fireworks {label} is not a price") from error
    if not parsed.is_finite() or parsed < 0:
        raise CollectorError(f"Fireworks {label} is invalid")
    return float(parsed)


def parse_fireworks_pricing(markdown: str) -> list[dict[str, Any]]:
    headers, raw_rows = standard_table(markdown)
    parsed_by_slug: dict[str, list[dict[str, Any]]] = {}

    for cells in raw_rows:
        raw = dict(zip(headers, cells, strict=True))
        model_match = re.fullmatch(
            r"\[([^\]]+)\]\(https://app\.fireworks\.ai/models/fireworks/([a-z0-9.-]+)\)",
            raw["model"],
            re.I,
        )
        if not model_match:
            raise CollectorError("Fireworks pricing contains an unrecognized model link")
        display, slug = model_match.groups()
        if re.search(r"\bfast\b", display, re.I) or re.search(r"\bUS$", display, re.I):
            continue

        prices = re.findall(r"\$\s*([0-9]+(?:\.[0-9]+)?)", raw["standard"])
        if len(prices) != 3:
            raise CollectorError(f"Fireworks Standard prices changed for {display}")
        row = {
            "fireworksModelId": f"accounts/fireworks/models/{slug.lower()}",
            "fireworksSlug": slug.lower(),
            "display": display.strip(),
            "input_mtok": price_value(prices[0], f"{display} input"),
            "cached_input_mtok": price_value(prices[1], f"{display} cached input"),
            "output_mtok": price_value(prices[2], f"{display} output"),
            "source": FIREWORKS_SOURCE_KEY,
            "sourceUrl": FIREWORKS_PUBLIC_URL,
        }
        normalized_slug = slug.lower()
        if normalized_slug in parsed_by_slug:
            raise CollectorError(f"Fireworks Standard pricing duplicates {normalized_slug}")
        parsed_by_slug[normalized_slug] = [row]

    return sorted(
        [rows[0] for rows in parsed_by_slug.values() if len(rows) == 1],
        key=lambda row: row["fireworksSlug"],
    )


def fetch_fireworks_pricing(url: str = FIREWORKS_PRICING_URL) -> list[dict[str, Any]]:
    request = urllib.request.Request(
        url,
        headers={
            "Accept": "text/markdown, text/plain;q=0.9",
            "User-Agent": "The-Marginal-Token/1.0 (+https://marginaltoken.com)",
        },
    )
    with urllib.request.urlopen(request, timeout=25) as response:
        body = response.read(MAX_RESPONSE_BYTES + 1)
    if len(body) > MAX_RESPONSE_BYTES:
        raise CollectorError("Fireworks pricing exceeded 2 MiB")
    return parse_fireworks_pricing(body.decode("utf-8"))


def match_fireworks_pricing(
    rows: list[dict[str, Any]],
    targets: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    matched: list[dict[str, Any]] = []
    unmatched: list[str] = []
    for row in rows:
        expected = FIREWORKS_TARGET_ALIASES.get(row["fireworksSlug"])
        candidates = {
            target["key"]: target
            for target in targets
            if expected and expected in {target["key"], target["canonicalKey"]}
        }
        if len(candidates) != 1:
            unmatched.append(row["fireworksModelId"])
            continue
        target = next(iter(candidates.values()))
        matched.append({**row, "key": target["key"], "canonicalKey": target["canonicalKey"]})
    return sorted(matched, key=lambda row: row["key"]), sorted(unmatched)


def refresh_fireworks_pricing(
    *,
    state_dir: Path,
    now: datetime | None = None,
    url: str = FIREWORKS_PRICING_URL,
    min_models: int = DEFAULT_MIN_MODELS,
    fetcher: Callable[[str], list[dict[str, Any]]] = fetch_fireworks_pricing,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    now = now or utc_now()
    checked_at = iso_utc(now)
    last_good_path = state_dir / "last-good-fireworks.json"
    try:
        models = fetcher(url)
        if len(models) < min_models:
            raise CollectorError(
                f"Fireworks pricing contains {len(models)} models, below the {min_models} minimum"
            )
        atomic_write_json(
            last_good_path,
            {"generatedAt": checked_at, "sourceUrl": url, "models": models},
        )
        return models, {
            "key": FIREWORKS_SOURCE_KEY,
            "label": FIREWORKS_SOURCE_LABEL,
            "sourceUrl": FIREWORKS_PUBLIC_URL,
            "status": "healthy",
            "checkedAt": checked_at,
            "catalogModelCount": len(models),
        }
    except Exception as error:
        previous = read_feed(last_good_path, {})
        previous_models = previous.get("models", []) if isinstance(previous, dict) else []
        if isinstance(previous_models, list) and previous_models:
            return previous_models, {
                "key": FIREWORKS_SOURCE_KEY,
                "label": FIREWORKS_SOURCE_LABEL,
                "sourceUrl": FIREWORKS_PUBLIC_URL,
                "status": "last_good",
                "checkedAt": checked_at,
                "lastVerified": previous.get("generatedAt"),
                "catalogModelCount": len(previous_models),
                "detail": str(error)[:300],
            }
        return [], {
            "key": FIREWORKS_SOURCE_KEY,
            "label": FIREWORKS_SOURCE_LABEL,
            "sourceUrl": FIREWORKS_PUBLIC_URL,
            "status": "unavailable",
            "checkedAt": checked_at,
            "catalogModelCount": 0,
            "detail": str(error)[:300],
        }
