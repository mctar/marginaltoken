#!/usr/bin/env python3
"""Verify the reviewed NVIDIA NIM deployment register.

Deployment facts deliberately remain separate from token prices. Each official
support page is checked as one failure domain; a changed or unavailable page
retains the last verified record and surfaces last-good or stale status.
"""

from __future__ import annotations

import argparse
import json
import re
import sys
from datetime import datetime, timezone
from pathlib import Path
from typing import Any, Callable

try:
    from collector.collect import atomic_write_json, atomic_write_text, iso_utc, load_json
    from collector.official import fetch_source, visible_text
except ModuleNotFoundError:  # Direct execution: python3 collector/nvidia.py
    from collect import atomic_write_json, atomic_write_text, iso_utc, load_json
    from official import fetch_source, visible_text


ROOT = Path(__file__).resolve().parent.parent
DEFAULT_DATA_DIR = ROOT / "data"
DEFAULT_STATE_DIR = Path(__file__).resolve().parent / "state"
MAX_STALE_HOURS = 48


class NvidiaSourceError(RuntimeError):
    """The NIM register or an official source could not be verified."""


def normalized(value: str) -> str:
    return re.sub(r"[^a-z0-9]+", "", value.casefold())


def validate_register(payload: Any) -> dict[str, Any]:
    if not isinstance(payload, dict) or payload.get("source") != "nvidia-nim":
        raise NvidiaSourceError("deployment.json must be an NVIDIA NIM feed")
    models = payload.get("models")
    if not isinstance(models, list) or not models:
        raise NvidiaSourceError("deployment.json has no models")
    seen: set[str] = set()
    for index, model in enumerate(models):
        if not isinstance(model, dict):
            raise NvidiaSourceError(f"deployment model {index} is not an object")
        for field in ("key", "display", "nvidiaModelId", "sourceUrl", "catalogUrl"):
            if not isinstance(model.get(field), str) or not model[field].strip():
                raise NvidiaSourceError(f"deployment model {index} has invalid {field}")
        if model["key"] in seen:
            raise NvidiaSourceError(f"duplicate deployment key: {model['key']}")
        seen.add(model["key"])
        if model.get("lifecycle") not in {"nim", "certified-feature", "certified-production"}:
            raise NvidiaSourceError(f"{model['key']} has invalid lifecycle")
        if not model["sourceUrl"].startswith("https://docs.nvidia.com/"):
            raise NvidiaSourceError(f"{model['key']} source must be NVIDIA documentation")
    return payload


def apply_verification(
    payload: dict[str, Any],
    pages: dict[str, str | Exception],
    now: datetime,
) -> tuple[dict[str, Any], list[dict[str, str]]]:
    current = json.loads(json.dumps(payload))
    today = now.astimezone(timezone.utc).strftime("%Y-%m-%d")
    reports: list[dict[str, str]] = []
    for url in sorted({str(model["sourceUrl"]) for model in current["models"]}):
        source_models = [model for model in current["models"] if model["sourceUrl"] == url]
        page = pages.get(url, NvidiaSourceError("source was not fetched"))
        detail = ""
        fresh = False
        if isinstance(page, str):
            haystack = normalized(visible_text(page))
            missing = [
                model["nvidiaModelId"]
                for model in source_models
                if normalized(str(model.get("sourceNeedle") or model["nvidiaModelId"])) not in haystack
            ]
            if missing:
                detail = "missing model ids: " + ", ".join(missing)
            else:
                fresh = True
        else:
            detail = str(page)

        for model in source_models:
            if fresh:
                model["status"] = "fresh"
                model["verifiedAt"] = today
                continue
            try:
                verified = datetime.strptime(str(model.get("verifiedAt", "")), "%Y-%m-%d").replace(tzinfo=timezone.utc)
                age_hours = (now.astimezone(timezone.utc) - verified).total_seconds() / 3600
            except ValueError:
                age_hours = MAX_STALE_HOURS + 1
            model["status"] = "stale" if age_hours > MAX_STALE_HOURS else "last_good"
        reports.append({"sourceUrl": url, "status": "fresh" if fresh else source_models[0]["status"], "detail": detail})

    statuses = {model["status"] for model in current["models"]}
    current["status"] = "stale" if "stale" in statuses else "attention" if "last_good" in statuses else "fresh"
    current["modelCount"] = len(current["models"])
    return current, reports


def refresh(
    *,
    data_dir: Path,
    state_dir: Path,
    now: datetime | None = None,
    fetcher: Callable[[str], str] | None = None,
) -> str:
    now = now or datetime.now(timezone.utc)
    path = data_dir / "deployment.json"
    payload = validate_register(load_json(path))
    urls = sorted({str(model["sourceUrl"]) for model in payload["models"]})
    pages: dict[str, str | Exception] = {}
    for url in urls:
        try:
            if fetcher:
                pages[url] = fetcher(url)
            else:
                result = fetch_source(url)
                if not isinstance(result.text, str):
                    raise NvidiaSourceError("official source returned no body")
                pages[url] = result.text
        except Exception as error:  # A per-source last-good is safer than erasing deployment facts.
            pages[url] = error

    candidate, reports = apply_verification(payload, pages, now)
    candidate["asOf"] = now.astimezone(timezone.utc).strftime("%Y-%m-%d")
    before = {key: value for key, value in payload.items() if key not in {"generatedAt", "asOf"}}
    after = {key: value for key, value in candidate.items() if key not in {"generatedAt", "asOf"}}
    changed = before != after or payload.get("asOf") != candidate["asOf"]
    heartbeat = {
        "checkedAt": iso_utc(now),
        "status": candidate["status"],
        "modelCount": candidate["modelCount"],
        "sources": reports,
    }
    atomic_write_json(state_dir / "nvidia-heartbeat.json", heartbeat)
    if not changed:
        return "unchanged"
    candidate["generatedAt"] = iso_utc(now)
    atomic_write_json(path, candidate)
    atomic_write_text(state_dir / "publish-pending", iso_utc(now) + "\n")
    return "changed"


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description="Verify NVIDIA NIM deployment metadata")
    parser.add_argument("--data-dir", type=Path, default=DEFAULT_DATA_DIR)
    parser.add_argument("--state-dir", type=Path, default=DEFAULT_STATE_DIR)
    args = parser.parse_args(argv)
    try:
        print(f"nvidia: {refresh(data_dir=args.data_dir, state_dir=args.state_dir)}")
    except Exception as error:
        print(f"nvidia: {error}", file=sys.stderr)
        return 1
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
