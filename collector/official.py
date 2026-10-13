"""Fetch and parse first-party model prices from official provider pages.

The checked-in catalog remains the cold-start fallback and the source of model
metadata. Successful provider scans are cached independently so one broken page
cannot erase or block otherwise healthy price data.
"""

from __future__ import annotations

import hashlib
import json
import re
import subprocess
import urllib.error
import urllib.request
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal, InvalidOperation, ROUND_HALF_UP
from html.parser import HTMLParser
from pathlib import Path
from typing import Any, Callable


PRICE_QUANTUM = Decimal("0.0001")
MAX_SOURCE_BYTES = 5 * 1024 * 1024
DEFAULT_MAX_STALE_HOURS = 48
LAST_GOOD_FILE = "firstparty-last-good.json"
HEARTBEAT_FILE = "firstparty-heartbeat.json"

PROVIDER_URLS = {
    "anthropic": "https://platform.claude.com/docs/en/about-claude/pricing",
    "openai": "https://developers.openai.com/api/docs/pricing.md",
    "google": "https://ai.google.dev/gemini-api/docs/pricing",
    "mistralai": "https://docs.mistral.ai/inference/pricing",
    "moonshotai": "https://platform.kimi.ai/",
    "deepseek": "https://api-docs.deepseek.com/quick_start/pricing/",
    "x-ai": "https://docs.x.ai/developers/pricing",
}

PROVIDER_PUBLIC_URLS = {
    "openai": "https://developers.openai.com/api/docs/pricing",
}


class OfficialSourceError(RuntimeError):
    """An official price page could not be fetched or parsed safely."""


@dataclass(frozen=True)
class FetchResult:
    text: str | None
    etag: str | None = None
    last_modified: str | None = None
    not_modified: bool = False


class _VisibleTextParser(HTMLParser):
    def __init__(self) -> None:
        super().__init__()
        self.parts: list[str] = []

    def handle_data(self, data: str) -> None:
        normalized = " ".join(data.split())
        if normalized:
            self.parts.append(normalized)


def visible_text(source: str) -> str:
    parser = _VisibleTextParser()
    parser.feed(source)
    return " | ".join(parser.parts)


def price(value: str, label: str) -> float:
    try:
        parsed = Decimal(value.replace(",", ""))
    except (InvalidOperation, ValueError) as error:
        raise OfficialSourceError(f"{label} is not a decimal") from error
    if not parsed.is_finite() or parsed < 0:
        raise OfficialSourceError(f"{label} is invalid")
    return float(parsed.quantize(PRICE_QUANTUM, rounding=ROUND_HALF_UP))


def fetch_source(url: str, cached: dict[str, Any] | None = None) -> FetchResult:
    headers = {
        "Accept": "text/markdown,text/plain,text/html;q=0.9,*/*;q=0.1",
        "User-Agent": "The-Marginal-Token/1.0 (+https://marginaltoken.com)",
    }
    if cached:
        if isinstance(cached.get("etag"), str):
            headers["If-None-Match"] = cached["etag"]
        if isinstance(cached.get("lastModified"), str):
            headers["If-Modified-Since"] = cached["lastModified"]
    request = urllib.request.Request(url, headers=headers)
    try:
        response = urllib.request.urlopen(request, timeout=25)
    except urllib.error.HTTPError as error:
        if error.code == 304:
            return FetchResult(
                text=None,
                etag=str(cached.get("etag")) if cached and cached.get("etag") else None,
                last_modified=(
                    str(cached.get("lastModified"))
                    if cached and cached.get("lastModified")
                    else None
                ),
                not_modified=True,
            )
        raise
    except urllib.error.URLError:
        return fetch_source_with_curl(url, cached)
    with response:
        body = response.read(MAX_SOURCE_BYTES + 1)
        if len(body) > MAX_SOURCE_BYTES:
            raise OfficialSourceError(f"{url} exceeded 5 MiB")
        charset = response.headers.get_content_charset() or "utf-8"
        return FetchResult(
            text=body.decode(charset, errors="replace"),
            etag=response.headers.get("ETag"),
            last_modified=response.headers.get("Last-Modified"),
        )


def fetch_source_with_curl(url: str, cached: dict[str, Any] | None = None) -> FetchResult:
    """Use curl's system trust store when Python cannot verify a corporate proxy."""

    del cached
    try:
        completed = subprocess.run(
            [
                "curl",
                "--fail",
                "--silent",
                "--show-error",
                "--location",
                "--compressed",
                "--max-time",
                "25",
                "--header",
                "Accept: text/markdown,text/plain,text/html;q=0.9,*/*;q=0.1",
                "--user-agent",
                "The-Marginal-Token/1.0 (+https://marginaltoken.com)",
                url,
            ],
            check=True,
            capture_output=True,
        )
    except (OSError, subprocess.CalledProcessError) as error:
        detail = error.stderr.decode("utf-8", errors="replace").strip() if isinstance(error, subprocess.CalledProcessError) else str(error)
        raise OfficialSourceError(f"curl could not fetch {url}: {detail}") from error
    if len(completed.stdout) > MAX_SOURCE_BYTES:
        raise OfficialSourceError(f"{url} exceeded 5 MiB")
    return FetchResult(text=completed.stdout.decode("utf-8", errors="replace"))


def _money_values(segment: str) -> list[str]:
    return re.findall(
        r"\$\s*([0-9]+(?:\.[0-9]+)?)\s*(?:\|\s*)*/\s*(?:\|\s*)*MTok",
        segment,
        re.I,
    )


def parse_openai(source: str, rows: list[dict[str, Any]], now: datetime) -> dict[str, tuple[float, float]]:
    del now
    section_match = re.search(
        r"### Standard pricing data(?P<body>.*?)(?:\n\s*Batch\s*$|\n### Batch pricing data)",
        source,
        re.S | re.M,
    )
    if not section_match:
        raise OfficialSourceError("OpenAI standard pricing table not found")
    table = section_match.group("body")
    result: dict[str, tuple[float, float]] = {}
    for row in rows:
        model = re.escape(str(row["model"]))
        match = re.search(rf"^\|\s*{model}\s*\|(?P<cells>.+)$", table, re.M | re.I)
        if not match:
            raise OfficialSourceError(f"OpenAI row missing: {row['model']}")
        cells = [cell.strip() for cell in match.group("cells").split("|")]
        if len(cells) < 8:
            raise OfficialSourceError(f"OpenAI row is incomplete: {row['model']}")
        input_match = re.search(r"\$([0-9.]+)", cells[0])
        output_match = re.search(r"\$([0-9.]+)", cells[3])
        if not input_match or not output_match:
            raise OfficialSourceError(f"OpenAI prices missing: {row['model']}")
        result[str(row["model"])] = (
            price(input_match.group(1), f"{row['model']} input"),
            price(output_match.group(1), f"{row['model']} output"),
        )
    return result


def parse_anthropic(source: str, rows: list[dict[str, Any]], now: datetime) -> dict[str, tuple[float, float]]:
    del now
    text = visible_text(source)
    marker = "The following table shows pricing for all Claude models:"
    start = text.find(marker)
    boundaries = [
        text.find(label, start + len(marker))
        for label in ("Cloud platform pricing", "Feature-specific pricing", "Fast mode pricing", "Batch processing")
    ]
    end = min((position for position in boundaries if position >= 0), default=-1)
    if start < 0 or end < 0:
        raise OfficialSourceError("Anthropic model pricing table not found")
    table = text[start:end]
    first_model = table.find(" | Claude ")
    header = table[: first_model if first_model >= 0 else len(table)]
    output_index = 1 if re.search(r"Name\s*\|\s*Input\s*\|\s*Output", header, re.I) else 4
    result: dict[str, tuple[float, float]] = {}
    for row in rows:
        display = str(row["display"])
        # The Tape uses Haiku's short-prompt standard rate. Match that named
        # tier explicitly, even if the long-context row appears first.
        qualifier = (
            r"(?:\s*\(for prompts up to 100,000 tokens\))?"
            if row["model"] == "claude-haiku-5.5" else ""
        )
        matches = list(re.finditer(rf"(?:^|\|\s*){re.escape(display)}{qualifier}\s*\|", table))
        if not matches:
            raise OfficialSourceError(f"Anthropic row missing: {display}")
        if len(matches) != 1:
            raise OfficialSourceError(f"Anthropic row ambiguous: {display}")
        row_match = matches[0]
        row_start = row_match.start()
        next_row = table.find(" | Claude ", row_match.end())
        segment = table[row_start : next_row if next_row >= 0 else len(table)]
        values = _money_values(segment)
        if len(values) <= output_index:
            raise OfficialSourceError(f"Anthropic prices missing: {display}")
        result[str(row["model"])] = (
            price(values[0], f"{display} input"),
            price(values[output_index], f"{display} output"),
        )
    return result


def parse_google(source: str, rows: list[dict[str, Any]], now: datetime) -> dict[str, tuple[float, float]]:
    text = visible_text(source)

    def active_price(section: str, label: str) -> float:
        values = re.findall(r"\$\s*([0-9.]+)", section)
        if not values:
            raise OfficialSourceError(f"Google {label} price missing")
        selected = values[0]
        for value, effective in re.findall(
            r"\$\s*([0-9.]+)\s+starting\s+([A-Z][a-z]+\s+\d{1,2},\s+\d{4})",
            section,
        ):
            effective_at = datetime.strptime(effective, "%B %d, %Y").replace(tzinfo=timezone.utc)
            if now.astimezone(timezone.utc) >= effective_at:
                selected = value
        return price(selected, label)

    result: dict[str, tuple[float, float]] = {}
    for row in rows:
        marker = f"{row['display']} | {row['model']}"
        start = text.find(marker)
        if start < 0:
            raise OfficialSourceError(f"Google row missing: {row['model']}")
        segment = text[start : start + 1800]
        input_start = segment.find("Input price")
        output_match = re.search(r"Output price(?: \(including thinking tokens\))?", segment, re.I)
        if input_start < 0 or not output_match:
            raise OfficialSourceError(f"Google prices missing: {row['model']}")
        next_section = re.search(
            r"Context caching price|Grounding with Google Search|Used to improve our products|Batch",
            segment[output_match.end() :],
            re.I,
        )
        output_end = (
            output_match.end() + next_section.start()
            if next_section
            else len(segment)
        )
        result[str(row["model"])] = (
            active_price(segment[input_start : output_match.start()], f"{row['model']} input"),
            active_price(segment[output_match.end() : output_end], f"{row['model']} output"),
        )
    return result


def parse_mistral(source: str, rows: list[dict[str, Any]], now: datetime) -> dict[str, tuple[float, float]]:
    del now
    text = visible_text(source)
    # Keep table cells separate, and omit superseded prices inside <del>.
    # The sale badge and cached-input column must not shift the quote basis.
    table_rows = []
    for table_row in re.findall(r"<tr\b[^>]*>(.*?)</tr>", source, re.I | re.S):
        cells = re.findall(r"<t[dh]\b[^>]*>(.*?)</t[dh]>", table_row, re.I | re.S)
        table_rows.append([
            visible_text(re.sub(r"<del\b[^>]*>.*?</del>", "", cell, flags=re.I | re.S))
            for cell in cells
        ])
    result: dict[str, tuple[float, float]] = {}
    for row in rows:
        selected = next((
            cells for cells in table_rows
            if cells and re.fullmatch(
                rf"{re.escape(str(row['display']))}(?:\s*\|\s*↗)?(?:\s*\|\s*Sale price)?",
                cells[0], re.I,
            )
        ), None)
        if selected is not None:
            rate_cells = selected[1:]
            if rate_cells and rate_cells[0] == "↗":
                rate_cells = rate_cells[1:]
            if len(rate_cells) != 3:
                raise OfficialSourceError(f"Mistral price columns missing: {row['model']}")
            pair = []
            for label, cell in (("input", rate_cells[0]), ("output", rate_cells[2])):
                amounts = re.findall(r"\$\s*([0-9]+(?:\.[0-9]+)?)", cell)
                if len(amounts) != 1:
                    raise OfficialSourceError(f"Mistral {label} price ambiguous: {row['model']}")
                pair.append(price(amounts[0], f"{row['model']} {label}"))
            result[str(row["model"])] = (pair[0], pair[1])
            continue
        starts = [match.start() for match in re.finditer(re.escape(str(row["display"])), text, re.I)]
        found: tuple[float, float] | None = None
        for start in starts:
            segment = text[start : start + 1200]
            table_match = re.search(
                rf"{re.escape(str(row['display']))}\s*\|\s*(?:↗\s*\|\s*)?"
                r"\$\s*([0-9.]+)\s*\|\s*\$\s*([0-9.]+)\s*\|\s*\$\s*([0-9.]+)",
                segment,
                re.I,
            )
            if table_match:
                found = (
                    price(table_match.group(1), f"{row['model']} input"),
                    price(table_match.group(3), f"{row['model']} output"),
                )
                break
            match = re.search(
                r"Price(?:\s*\|\s*i)?\s*\|\s*\$\s*\|\s*([0-9.]+)\s*\|\s*/M Tokens\s*\|\s*\$\s*\|\s*([0-9.]+)\s*\|\s*/M Tokens",
                segment,
                re.I,
            )
            if match:
                found = (
                    price(match.group(1), f"{row['model']} input"),
                    price(match.group(2), f"{row['model']} output"),
                )
                break
        if not found:
            raise OfficialSourceError(f"Mistral prices missing: {row['model']}")
        result[str(row["model"])] = found
    return result


def parse_moonshot(source: str, rows: list[dict[str, Any]], now: datetime) -> dict[str, tuple[float, float]]:
    del now
    text = visible_text(source)
    card = re.search(
        r"(?:^|\|\s*)K3\s*\|\s*Kimi K3\b(?P<body>.*?)(?=\|\s*K2\.7 Code\b|$)",
        text,
        re.I | re.S,
    )
    values: tuple[float, float] | None = None
    if card:
        input_match = re.search(
            r"\bInput\s*\|\s*\$([0-9.]+)\s*/\s*MTok",
            card.group("body"),
            re.I,
        )
        output_match = re.search(
            r"\bOutput\s*\|\s*\$([0-9.]+)\s*/\s*MTok",
            card.group("body"),
            re.I,
        )
        if input_match and output_match:
            values = (
                price(input_match.group(1), "Kimi K3 input"),
                price(output_match.group(1), "Kimi K3 output"),
            )
    if values is None:
        statement = re.search(
            r"Kimi K3 API pricing.*?Input tokens are billed at \$([0-9.]+).*?Output tokens are billed at \$([0-9.]+)",
            source,
            re.I | re.S,
        )
        if not statement:
            raise OfficialSourceError("Kimi K3 API pricing statement not found")
        values = (
            price(statement.group(1), "Kimi K3 input"),
            price(statement.group(2), "Kimi K3 output"),
        )
    return {str(row["model"]): values for row in rows}


def parse_deepseek(source: str, rows: list[dict[str, Any]], now: datetime) -> dict[str, tuple[float, float]]:
    del now
    text = visible_text(source)
    model_order = re.search(
        r"deepseek-(?:v4(?:\.1)?-flash|flash).*?deepseek-v4-pro",
        text,
        re.I,
    )
    if not model_order:
        raise OfficialSourceError("DeepSeek V4 pricing table not found")

    input_section = re.search(
        r"1M INPUT TOKENS(?:\s*\|\s*)?\s*\(CACHE MISS\)(?P<body>.*?)1M OUTPUT TOKENS",
        text,
        re.I,
    )
    output_section = re.search(
        r"1M OUTPUT TOKENS(?P<body>.*?)(?:Concurrency Limit|Deduction Rules)",
        text,
        re.I,
    )
    tiered_input = re.search(
        r"(?<!-)\bPEAK\s*\|\s*\$([0-9.]+)\s*\|\s*\$([0-9.]+)",
        input_section.group("body") if input_section else "",
        re.I,
    )
    tiered_output = re.search(
        r"(?<!-)\bPEAK\s*\|\s*\$([0-9.]+)\s*\|\s*\$([0-9.]+)",
        output_section.group("body") if output_section else "",
        re.I,
    )
    if tiered_input and tiered_output:
        flash = (
            price(tiered_input.group(1), "DeepSeek V4.1 Flash peak input"),
            price(tiered_output.group(1), "DeepSeek V4.1 Flash peak output"),
        )
        pro = (
            price(tiered_input.group(2), "DeepSeek V4 Pro peak input"),
            price(tiered_output.group(2), "DeepSeek V4 Pro peak output"),
        )
    else:
        legacy = re.search(
            r"1M INPUT TOKENS \(CACHE MISS\).*?\$([0-9.]+).*?\$([0-9.]+).*?1M OUTPUT TOKENS.*?\$([0-9.]+).*?\$([0-9.]+)",
            text,
            re.I,
        )
        if not legacy:
            raise OfficialSourceError("DeepSeek V4 prices missing")
        flash = (
            price(legacy.group(1), "DeepSeek V4.1 Flash input"),
            price(legacy.group(3), "DeepSeek V4.1 Flash output"),
        )
        pro = (
            price(legacy.group(2), "DeepSeek V4 Pro input"),
            price(legacy.group(4), "DeepSeek V4 Pro output"),
        )

    result: dict[str, tuple[float, float]] = {}
    for row in rows:
        model = str(row["model"]).lower()
        if model in {"deepseek-v4.1-flash", "deepseek-v4-flash", "deepseek-flash"}:
            result[str(row["model"])] = flash
        elif model == "deepseek-v4-pro":
            result[str(row["model"])] = pro
        else:
            raise OfficialSourceError(f"Unsupported DeepSeek row: {row['model']}")
    return result


def parse_xai(source: str, rows: list[dict[str, Any]], now: datetime) -> dict[str, tuple[float, float]]:
    del now
    result: dict[str, tuple[float, float]] = {}
    for row in rows:
        model = re.escape(str(row["model"]))
        table_match = re.search(
            rf"^\|\s*{model}\s*\(<\s*200k prompt tokens\)\s*\|\s*[^|]+\|\s*\$([0-9.]+)\s*\|\s*\$[0-9.]+\s*\|\s*\$([0-9.]+)\s*\|",
            source,
            re.I | re.M,
        )
        if table_match:
            result[str(row["model"])] = (
                price(table_match.group(1), f"{row['model']} input"),
                price(table_match.group(2), f"{row['model']} output"),
            )
            continue
        pricing_match = re.search(
            rf"(?:^|\|\s*){model}(?:\s*Long context\s*[^|]*)?\s*\|\s*[^|]+"
            r"\|\s*\$([0-9.]+)\s*\|\s*\$[0-9.]+\s*\|\s*\$([0-9.]+)\s*\|",
            source,
            re.I | re.M,
        )
        if pricing_match:
            result[str(row["model"])] = (
                price(pricing_match.group(1), f"{row['model']} input"),
                price(pricing_match.group(2), f"{row['model']} output"),
            )
            continue
        matches = re.findall(
            rf'\\?"name\\?":\\?"{model}\\?".*?\\?"promptTextTokenPrice\\?":\\?"([0-9]+)\\?".*?\\?"completionTextTokenPrice\\?":\\?"([0-9]+)\\?"',
            source,
            re.S,
        )
        unique = {
            (Decimal(prompt) / Decimal(10_000), Decimal(completion) / Decimal(10_000))
            for prompt, completion in matches
        }
        if not unique:
            raise OfficialSourceError(f"xAI prices missing or inconsistent: {row['model']}")
        prompt, completion = min(unique, key=lambda pair: pair[0] + pair[1])
        regional = (prompt * Decimal("1.1"), completion * Decimal("1.1"))
        if any(pair != (prompt, completion) and pair != regional for pair in unique):
            raise OfficialSourceError(f"xAI prices missing or inconsistent: {row['model']}")
        result[str(row["model"])] = (
            price(str(prompt), f"{row['model']} input"),
            price(str(completion), f"{row['model']} output"),
        )
    return result


PARSERS: dict[str, Callable[[str, list[dict[str, Any]], datetime], dict[str, tuple[float, float]]]] = {
    "anthropic": parse_anthropic,
    "openai": parse_openai,
    "google": parse_google,
    "mistralai": parse_mistral,
    "moonshotai": parse_moonshot,
    "deepseek": parse_deepseek,
    "x-ai": parse_xai,
}


def _iso(value: datetime) -> str:
    return value.astimezone(timezone.utc).isoformat(timespec="seconds").replace("+00:00", "Z")


def _load_state(path: Path) -> dict[str, Any]:
    if not path.exists():
        return {"version": 1, "providers": {}}
    try:
        payload = json.loads(path.read_text(encoding="utf-8"))
    except (OSError, json.JSONDecodeError):
        return {"version": 1, "providers": {}}
    if not isinstance(payload, dict) or not isinstance(payload.get("providers"), dict):
        return {"version": 1, "providers": {}}
    return payload


def _write_json(path: Path, payload: Any) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    temporary = path.with_name(f".{path.name}.tmp")
    temporary.write_text(json.dumps(payload, indent=2, ensure_ascii=False) + "\n", encoding="utf-8")
    temporary.replace(path)


def _last_good_prices(cached: dict[str, Any], rows: list[dict[str, Any]]) -> dict[str, tuple[float, float]] | None:
    payload = cached.get("prices")
    if not isinstance(payload, dict):
        return None
    result: dict[str, tuple[float, float]] = {}
    for row in rows:
        item = payload.get(str(row["model"]))
        if not isinstance(item, dict):
            return None
        try:
            result[str(row["model"])] = (
                price(str(item["input_mtok"]), f"{row['model']} cached input"),
                price(str(item["output_mtok"]), f"{row['model']} cached output"),
            )
        except (KeyError, OfficialSourceError):
            return None
    return result


def _parse_rows(
    parser: Callable[[str, list[dict[str, Any]], datetime], dict[str, tuple[float, float]]],
    source: str,
    rows: list[dict[str, Any]],
    now: datetime,
) -> tuple[dict[str, tuple[float, float]], dict[str, str]]:
    """A removed or malformed model must not block its valid siblings."""
    values: dict[str, tuple[float, float]] = {}
    errors: dict[str, str] = {}
    for row in rows:
        model = str(row["model"])
        try:
            parsed = parser(source, [row], now)
            if set(parsed) != {model}:
                raise OfficialSourceError(f"adapter did not return tracked row: {model}")
            pair = parsed[model]
            values[model] = (
                price(str(pair[0]), f"{model} input"),
                price(str(pair[1]), f"{model} output"),
            )
        except Exception as error:
            errors[model] = str(error)
    return values, errors


def _fallback_status(verified_at: str, now: datetime, max_stale_hours: int) -> str:
    try:
        cached_at = datetime.fromisoformat(verified_at.replace("Z", "+00:00"))
        age_hours = (now.astimezone(timezone.utc) - cached_at.astimezone(timezone.utc)).total_seconds() / 3600
        return "last_good" if age_hours <= max_stale_hours else "stale"
    except (ValueError, TypeError):
        return "stale"


def refresh_firstparty(
    catalog: list[dict[str, Any]],
    *,
    state_dir: Path,
    now: datetime,
    max_stale_hours: int = DEFAULT_MAX_STALE_HOURS,
    fetcher: Callable[[str, dict[str, Any] | None], FetchResult] = fetch_source,
) -> tuple[list[dict[str, Any]], dict[str, Any]]:
    """Refresh each model, retaining its own dated fallback and source status."""

    grouped: dict[str, list[dict[str, Any]]] = {}
    for row in catalog:
        provider = str(row.get("provider", "")).strip().lower()
        grouped.setdefault(provider, []).append(row)

    state_path = state_dir / LAST_GOOD_FILE
    last_good = _load_state(state_path)
    providers_state = dict(last_good.get("providers", {}))
    refreshed = [dict(row) for row in catalog]
    refreshed_by_key = {
        (str(row.get("provider", "")).strip().lower(), str(row.get("model", ""))): row
        for row in refreshed
    }
    provider_reports: list[dict[str, Any]] = []

    for provider in sorted(grouped):
        rows = grouped[provider]
        url = PROVIDER_URLS.get(provider)
        public_url = PROVIDER_PUBLIC_URLS.get(provider, url)
        parser = PARSERS.get(provider)
        cached = providers_state.get(provider) if isinstance(providers_state.get(provider), dict) else {}
        values: dict[str, tuple[float, float]] = {}
        errors: dict[str, str] = {}
        fetched = None
        content_hash = cached.get("contentHash")
        used_alternate = False
        if url and parser:
            try:
                fetched = fetcher(url, cached)
                if fetched.not_modified:
                    complete = _last_good_prices(cached, rows)
                    if complete is None or cached.get("failedModels"):
                        # New or previously failed rows need another parse, even
                        # if the provider retains the same cache validators.
                        fetched = fetcher(url, None)
                        if fetched.not_modified:
                            raise OfficialSourceError("unconditional refresh returned 304")
                    else:
                        values = complete
                if not fetched.not_modified:
                    if fetched.text is None:
                        raise OfficialSourceError("official source returned no content")
                    values, errors = _parse_rows(parser, fetched.text, rows, now)
                    content_hash = hashlib.sha256(fetched.text.encode("utf-8")).hexdigest()
                    if errors and fetcher is fetch_source:
                        failed_rows = [row for row in rows if str(row["model"]) in errors]
                        try:
                            alternate = fetch_source_with_curl(url, cached)
                            if alternate.text is None:
                                raise OfficialSourceError("curl source returned no content")
                            recovered, remaining = _parse_rows(parser, alternate.text, failed_rows, now)
                            values.update(recovered)
                            for model in recovered:
                                errors.pop(model)
                            errors.update(remaining)
                            used_alternate = bool(recovered)
                        except Exception:
                            # Keep successes from the primary representation.
                            pass
            except Exception as error:
                values = {}
                errors = {str(row["model"]): str(error) for row in rows}
        else:
            errors = {str(row["model"]): "No automated provider adapter" for row in rows}

        model_reports = []
        saved_prices = {}
        cached_prices = cached.get("prices", {})
        if not isinstance(cached_prices, dict):
            cached_prices = {}
        for row in rows:
            model = str(row["model"])
            target = refreshed_by_key[(provider, model)]
            detail = errors.get(model, "")
            if model in values:
                pair = values[model]
                verified_at = _iso(now)
                status = "fresh"
            else:
                previous = _last_good_prices(cached, [row])
                previous_row = cached_prices.get(model, {})
                verified_at = (
                    str(previous_row.get("verifiedAt", cached.get("verifiedAt")) or "")
                    if isinstance(previous_row, dict) else ""
                )
                if previous is None:
                    pair, verified_at, status = None, "", "manual"
                    detail = f"{detail}; no last-good snapshot"
                else:
                    pair = previous[model]
                    status = _fallback_status(verified_at, now, max_stale_hours)
            target["verification_status"] = status
            if pair is not None:
                target["input_mtok"] = pair[0]
                target["output_mtok"] = pair[1]
                target["source_url"] = public_url or row["source_url"]
                if verified_at:
                    target["checked"] = verified_at[:10]
                saved_prices[model] = {
                    "input_mtok": pair[0], "output_mtok": pair[1],
                    "verifiedAt": verified_at or None,
                }
            model_report = {
                "model": model, "display": row["display"],
                "status": status, "verifiedAt": verified_at or None,
            }
            if detail:
                model_report["detail"] = detail[:240]
            model_reports.append(model_report)

        # Migrate provider-wide v1 snapshots into per-model verification dates.
        # A partial response never advances the date of a retained predecessor.
        known_dates = [r["verifiedAt"] for r in model_reports if r["verifiedAt"]]
        verified_at = min(known_dates) if known_dates else None
        severity = {"fresh": 0, "last_good": 1, "stale": 2, "manual": 3}
        status = max((r["status"] for r in model_reports), key=severity.__getitem__)
        if url and parser:
            providers_state[provider] = {
                "sourceUrl": url,
                "verifiedAt": verified_at,
                "etag": fetched.etag if fetched and not used_alternate else None,
                "lastModified": fetched.last_modified if fetched and not used_alternate else None,
                "contentHash": content_hash,
                "failedModels": sorted(errors),
                "prices": saved_prices,
            }

        report = {
            "provider": provider,
            "status": status,
            "sourceUrl": public_url or str(rows[0].get("source_url", "")),
            "verifiedAt": verified_at or None,
            "modelCount": len(rows),
            "freshModelCount": sum(r["status"] == "fresh" for r in model_reports),
            "models": model_reports,
        }
        details = [r["detail"] for r in model_reports if r.get("detail")]
        if details:
            report["detail"] = "; ".join(details)[:240]
        provider_reports.append(report)

    last_good_payload = {"version": 2, "providers": providers_state}
    _write_json(state_path, last_good_payload)
    degraded = sum(report["status"] != "fresh" for report in provider_reports)
    report_payload = {
        "checkedAt": _iso(now),
        "status": "healthy" if degraded == 0 else "degraded",
        "degradedProviderCount": degraded,
        "providers": provider_reports,
    }
    _write_json(state_dir / HEARTBEAT_FILE, report_payload)
    return refreshed, report_payload
