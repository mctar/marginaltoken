#!/usr/bin/env python3
"""Parse and cache Together AI's public serverless model catalog.

Together publishes its current serverless chat catalog as a Markdown table.
The table is treated as an independent venue source for the fields it actually
reports. Missing capability and output-limit fields remain unknown; callers
must not infer them from model names.
"""

from __future__ import annotations

import re
import urllib.request
from datetime import datetime
from decimal import Decimal, InvalidOperation
from pathlib import Path
from typing import Any, Callable

try:
    from collector.collect import (
        CollectorError,
        atomic_write_json,
        iso_utc,
        read_feed,
        utc_now,
    )
except ModuleNotFoundError:  # Direct import from collector/endpoints.py
    from collect import (  # type: ignore[no-redef]
        CollectorError,
        atomic_write_json,
        iso_utc,
        read_feed,
        utc_now,
    )


TOGETHER_CATALOG_URL = "https://docs.together.ai/docs/serverless/models.md"
TOGETHER_SOURCE_KEY = "together-catalog"
TOGETHER_SOURCE_LABEL = "Together AI"
MAX_RESPONSE_BYTES = 2 * 1024 * 1024
DEFAULT_MIN_MODELS = 5

REQUIRED_HEADERS = (
    "organization",
    "model name",
    "api model string",
    "context length",
    "input pricing (per 1m tokens)",
    "cached input pricing (per 1m tokens)",
    "output pricing (per 1m tokens)",
    "quantization",
    "function calling",
    "structured outputs",
)

PROVIDER_ALIASES = {
    "deepseek-ai": "deepseek",
    "meta-models": "meta",
    "minimaxai": "minimax",
    "zai-org": "z-ai",
}

MODEL_ALIASES = {
    "meta-llama/llama-3-3-70b-instruct-turbo": "meta-llama/llama-3-3-70b-instruct",
}


def markdown_cell(value: str) -> str:
    return (
        value.strip()
        .replace(r"\$", "$")
        .replace(r"\[", "[")
        .replace(r"\]", "]")
    )


def table_cells(line: str) -> list[str]:
    if not line.strip().startswith("|"):
        return []
    return [markdown_cell(cell) for cell in line.strip().strip("|").split("|")]


def is_alignment_row(cells: list[str]) -> bool:
    return bool(cells) and all(re.fullmatch(r":?-{3,}:?", cell.replace(" ", "")) for cell in cells)


def chat_table(markdown: str) -> tuple[list[str], list[list[str]]]:
    lines = markdown.splitlines()
    try:
        start = next(index for index, line in enumerate(lines) if line.strip() == "## Chat models")
    except StopIteration as error:
        raise CollectorError("Together catalog lacks a Chat models section") from error

    section: list[str] = []
    for line in lines[start + 1 :]:
        if line.startswith("## "):
            break
        section.append(line)

    header_index = next((index for index, line in enumerate(section) if line.strip().startswith("|")), None)
    if header_index is None:
        raise CollectorError("Together chat catalog lacks a Markdown table")
    headers = [cell.lower() for cell in table_cells(section[header_index])]
    if tuple(headers) != REQUIRED_HEADERS:
        raise CollectorError("Together chat catalog headers changed")

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
            raise CollectorError("Together chat catalog contains a malformed row")
        rows.append(cells)
    if not rows:
        raise CollectorError("Together chat catalog contains no rows")
    return headers, rows


def price_value(value: str, label: str) -> float | None:
    normalized = value.strip().lower()
    if normalized in {"", "-", "free"}:
        return None
    normalized = normalized.replace("$", "").replace(",", "")
    try:
        parsed = Decimal(normalized)
    except (InvalidOperation, ValueError) as error:
        raise CollectorError(f"Together {label} is not a price") from error
    if not parsed.is_finite() or parsed < 0:
        raise CollectorError(f"Together {label} is invalid")
    return float(parsed)


def integer_value(value: str, label: str) -> int:
    normalized = value.strip().replace(",", "")
    if normalized in {"", "-"}:
        return 0
    if not normalized.isdigit():
        raise CollectorError(f"Together {label} is not an integer")
    return int(normalized)


def reported_boolean(value: str) -> bool | None:
    normalized = value.strip().lower()
    if normalized == "yes":
        return True
    if normalized == "no":
        return False
    return None


def parse_together_catalog(markdown: str) -> list[dict[str, Any]]:
    headers, raw_rows = chat_table(markdown)
    parsed_by_id: dict[str, list[dict[str, Any]]] = {}

    for cells in raw_rows:
        raw = dict(zip(headers, cells, strict=True))
        model_id = raw["api model string"].strip()
        if "/" not in model_id:
            continue
        input_mtok = price_value(raw["input pricing (per 1m tokens)"], f"{model_id} input price")
        output_mtok = price_value(raw["output pricing (per 1m tokens)"], f"{model_id} output price")
        if input_mtok is None or output_mtok is None or (input_mtok == 0 and output_mtok == 0):
            continue

        row: dict[str, Any] = {
            "togetherModelId": model_id,
            "organization": raw["organization"].strip(),
            "display": raw["model name"].strip() or model_id.split("/", 1)[-1],
            "input_mtok": input_mtok,
            "output_mtok": output_mtok,
            "context": integer_value(raw["context length"], f"{model_id} context length"),
            "source": TOGETHER_SOURCE_KEY,
            "sourceUrl": TOGETHER_CATALOG_URL,
        }
        cached_input = price_value(
            raw["cached input pricing (per 1m tokens)"],
            f"{model_id} cached input price",
        )
        if cached_input is not None:
            row["cached_input_mtok"] = cached_input
        quantization = raw["quantization"].strip().lower()
        if quantization not in {"", "-", "unknown", "unspecified"}:
            row["quantization"] = quantization
        tools = reported_boolean(raw["function calling"])
        if tools is not None:
            row["supportsTools"] = tools
        structured = reported_boolean(raw["structured outputs"])
        if structured is not None:
            row["supportsStructuredOutput"] = structured
        parsed_by_id.setdefault(model_id.lower(), []).append(row)

    # Duplicate API identifiers with conflicting rows are ambiguous upstream.
    # Skip all copies instead of choosing a price or configuration arbitrarily.
    return sorted(
        [rows[0] for rows in parsed_by_id.values() if len(rows) == 1],
        key=lambda row: row["togetherModelId"].lower(),
    )


def fetch_together_catalog(url: str = TOGETHER_CATALOG_URL) -> list[dict[str, Any]]:
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
        raise CollectorError("Together catalog exceeded 2 MiB")
    return parse_together_catalog(body.decode("utf-8"))


def canonical_identity(value: str) -> str | None:
    if "/" not in value:
        return None
    provider, slug = value.split("/", 1)
    normalized_provider = re.sub(r"[^a-z0-9]+", "-", provider.lower()).strip("-")
    normalized_provider = PROVIDER_ALIASES.get(normalized_provider, normalized_provider)
    normalized_slug = re.sub(r"[^a-z0-9]+", "-", slug.lower()).strip("-")
    if not normalized_provider or not normalized_slug:
        return None
    identity = f"{normalized_provider}/{normalized_slug}"
    return MODEL_ALIASES.get(identity, identity)


def match_together_catalog(
    rows: list[dict[str, Any]],
    targets: list[dict[str, str]],
) -> tuple[list[dict[str, Any]], list[str]]:
    targets_by_identity: dict[str, list[dict[str, str]]] = {}
    for target in targets:
        identities = {
            identity
            for identity in (
                canonical_identity(target["key"]),
                canonical_identity(target["canonicalKey"]),
            )
            if identity is not None
        }
        for identity in identities:
            targets_by_identity.setdefault(identity, []).append(target)

    matched: list[dict[str, Any]] = []
    unmatched: list[str] = []
    for row in rows:
        identity = canonical_identity(row["togetherModelId"])
        candidates = targets_by_identity.get(identity or "", [])
        unique = {candidate["key"]: candidate for candidate in candidates}
        if len(unique) != 1:
            unmatched.append(row["togetherModelId"])
            continue
        target = next(iter(unique.values()))
        matched.append({**row, "key": target["key"], "canonicalKey": target["canonicalKey"]})
    return sorted(matched, key=lambda row: row["key"]), sorted(unmatched)


def refresh_together_catalog(
    *,
    state_dir: Path,
    now: datetime | None = None,
    url: str = TOGETHER_CATALOG_URL,
    min_models: int = DEFAULT_MIN_MODELS,
    fetcher: Callable[[str], list[dict[str, Any]]] = fetch_together_catalog,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    now = now or utc_now()
    checked_at = iso_utc(now)
    last_good_path = state_dir / "last-good-together.json"
    try:
        models = fetcher(url)
        if len(models) < min_models:
            raise CollectorError(
                f"Together catalog contains {len(models)} models, below the {min_models} minimum"
            )
        payload = {
            "generatedAt": checked_at,
            "sourceUrl": url,
            "models": models,
        }
        atomic_write_json(last_good_path, payload)
        return models, {
            "key": TOGETHER_SOURCE_KEY,
            "label": TOGETHER_SOURCE_LABEL,
            "sourceUrl": url,
            "status": "healthy",
            "checkedAt": checked_at,
            "catalogModelCount": len(models),
        }
    except Exception as error:
        previous = read_feed(last_good_path, {})
        previous_models = previous.get("models", []) if isinstance(previous, dict) else []
        if isinstance(previous_models, list) and previous_models:
            return previous_models, {
                "key": TOGETHER_SOURCE_KEY,
                "label": TOGETHER_SOURCE_LABEL,
                "sourceUrl": url,
                "status": "last_good",
                "checkedAt": checked_at,
                "lastVerified": previous.get("generatedAt"),
                "catalogModelCount": len(previous_models),
                "detail": str(error)[:300],
            }
        return [], {
            "key": TOGETHER_SOURCE_KEY,
            "label": TOGETHER_SOURCE_LABEL,
            "sourceUrl": url,
            "status": "unavailable",
            "checkedAt": checked_at,
            "catalogModelCount": 0,
            "detail": str(error)[:300],
        }
