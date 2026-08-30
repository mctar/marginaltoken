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
from html.parser import HTMLParser
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


class _ProfileSectionParser(HTMLParser):
    def __init__(self, target: str) -> None:
        super().__init__()
        self.target = target.casefold()
        self.section_depth = 0
        self.current_table: list[list[str]] | None = None
        self.current_row: list[str] | None = None
        self.current_cell: list[str] | None = None
        self.tables: list[list[list[str]]] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        attributes = {key.casefold(): value or "" for key, value in attrs}
        if tag == "section":
            if self.section_depth:
                self.section_depth += 1
            elif attributes.get("id", "").casefold() == self.target:
                self.section_depth = 1
        if not self.section_depth:
            return
        if tag == "table":
            self.current_table = []
        elif tag == "tr" and self.current_table is not None:
            self.current_row = []
        elif tag in {"th", "td"} and self.current_row is not None:
            self.current_cell = []
        elif tag == "br" and self.current_cell is not None:
            self.current_cell.append(" ")

    def handle_data(self, data: str) -> None:
        if self.current_cell is not None:
            self.current_cell.append(data)

    def handle_endtag(self, tag: str) -> None:
        if self.section_depth:
            if tag in {"th", "td"} and self.current_cell is not None and self.current_row is not None:
                self.current_row.append(" ".join("".join(self.current_cell).split()))
                self.current_cell = None
            elif tag == "tr" and self.current_row is not None and self.current_table is not None:
                if self.current_row:
                    self.current_table.append(self.current_row)
                self.current_row = None
            elif tag == "table" and self.current_table is not None:
                if self.current_table:
                    self.tables.append(self.current_table)
                self.current_table = None
        if tag == "section" and self.section_depth:
            self.section_depth -= 1


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
        for field in (
            "key",
            "display",
            "nvidiaModelId",
            "sourceUrl",
            "catalogUrl",
            "profileSourceUrl",
            "profileModel",
        ):
            if not isinstance(model.get(field), str) or not model[field].strip():
                raise NvidiaSourceError(f"deployment model {index} has invalid {field}")
        if model["key"] in seen:
            raise NvidiaSourceError(f"duplicate deployment key: {model['key']}")
        seen.add(model["key"])
        if model.get("lifecycle") not in {"nim", "certified-feature", "certified-production"}:
            raise NvidiaSourceError(f"{model['key']} has invalid lifecycle")
        if not model["sourceUrl"].startswith("https://docs.nvidia.com/"):
            raise NvidiaSourceError(f"{model['key']} source must be NVIDIA documentation")
        if not model["profileSourceUrl"].startswith("https://docs.nvidia.com/"):
            raise NvidiaSourceError(f"{model['key']} profile source must be NVIDIA documentation")
    return payload


def parse_support_profiles(source: str, model_name: str) -> list[dict[str, Any]]:
    profiles: list[dict[str, Any]] = []
    seen: set[str] = set()
    for match in re.finditer(r"<tr\b(?P<attributes>[^>]*)>", source, re.I):
        attributes = {
            key.casefold(): value
            for key, value in re.findall(
                r'data-([a-z-]+)\s*=\s*"([^"]*)"',
                match.group("attributes"),
                re.I,
            )
        }
        if attributes.get("model", "").casefold() != model_name.casefold():
            continue
        try:
            tensor_parallelism = int(attributes.get("tp", ""))
        except ValueError as error:
            raise NvidiaSourceError(f"{model_name} has an invalid TP profile") from error
        precision = attributes.get("precision", "").strip().upper()
        gpus = sorted({gpu.strip() for gpu in attributes.get("gpus", "").split(",") if gpu.strip()})
        if tensor_parallelism < 1 or not precision or not gpus:
            raise NvidiaSourceError(f"{model_name} has an incomplete hardware profile")
        lora = attributes.get("lora", "").casefold() == "yes"
        profile_id = f"tp{tensor_parallelism}-{precision.casefold()}-{'lora' if lora else 'base'}"
        if profile_id in seen:
            raise NvidiaSourceError(f"{model_name} has a duplicate profile: {profile_id}")
        seen.add(profile_id)
        profiles.append(
            {
                "id": profile_id,
                "tensorParallelism": tensor_parallelism,
                "precision": precision,
                "lora": lora,
                "verifiedGpus": gpus,
            }
        )
    if not profiles:
        parser = _ProfileSectionParser(model_name)
        parser.feed(source)
        grouped: dict[tuple[int, str, str], set[str]] = {}
        for table in parser.tables:
            header_index = next(
                (
                    index
                    for index, row in enumerate(table)
                    if "GPU" in row and "Precision" in row and "# of GPUs" in row
                ),
                None,
            )
            if header_index is None:
                continue
            header = table[header_index]
            gpu_index = header.index("GPU")
            precision_index = header.index("Precision")
            count_index = header.index("# of GPUs")
            optimization_index = header.index("Profile") if "Profile" in header else None
            required_index = max(gpu_index, precision_index, count_index, optimization_index or 0)
            for row in table[header_index + 1 :]:
                if len(row) <= required_index:
                    continue
                gpu = row[gpu_index].strip()
                precision = row[precision_index].strip().upper()
                optimization = row[optimization_index].strip() if optimization_index is not None else ""
                if not gpu or gpu.casefold() == "any" or not precision or precision == "-":
                    continue
                for count in re.findall(r"\d+", row[count_index]):
                    tensor_parallelism = int(count)
                    if tensor_parallelism < 1:
                        continue
                    grouped.setdefault((tensor_parallelism, precision, optimization), set()).add(gpu)
        for (tensor_parallelism, precision, optimization), gpus in grouped.items():
            optimization_slug = re.sub(r"[^a-z0-9]+", "-", optimization.casefold()).strip("-")
            suffix = f"-{optimization_slug}" if optimization_slug else "-base"
            profiles.append(
                {
                    "id": f"tp{tensor_parallelism}-{precision.casefold()}{suffix}",
                    "tensorParallelism": tensor_parallelism,
                    "precision": precision,
                    "lora": False,
                    "verifiedGpus": sorted(gpus),
                    **({"optimization": optimization} if optimization else {}),
                }
            )
    if not profiles:
        raise NvidiaSourceError(f"{model_name} has no published hardware profiles")
    return sorted(
        profiles,
        key=lambda profile: (
            profile["lora"],
            profile["tensorParallelism"],
            profile["precision"],
        ),
    )


def fallback_status(verified_at: Any, now: datetime) -> str:
    try:
        verified = datetime.strptime(str(verified_at or ""), "%Y-%m-%d").replace(tzinfo=timezone.utc)
        age_hours = (now.astimezone(timezone.utc) - verified).total_seconds() / 3600
    except ValueError:
        age_hours = MAX_STALE_HOURS + 1
    return "stale" if age_hours > MAX_STALE_HOURS else "last_good"


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
            model["status"] = fallback_status(model.get("verifiedAt"), now)
        reports.append({"sourceUrl": url, "status": "fresh" if fresh else source_models[0]["status"], "detail": detail})

    for model in current["models"]:
        profile_url = str(model["profileSourceUrl"])
        page = pages.get(profile_url, NvidiaSourceError("profile source was not fetched"))
        detail = ""
        if isinstance(page, str):
            try:
                model["profiles"] = parse_support_profiles(page, str(model["profileModel"]))
                model["profilesStatus"] = "fresh"
                model["profilesVerifiedAt"] = today
            except NvidiaSourceError as error:
                detail = str(error)
                model["profilesStatus"] = fallback_status(model.get("profilesVerifiedAt"), now)
        else:
            detail = str(page)
            model["profilesStatus"] = fallback_status(model.get("profilesVerifiedAt"), now)
        reports.append(
            {
                "sourceUrl": profile_url,
                "status": model["profilesStatus"],
                "detail": detail,
                "model": model["key"],
                "kind": "profiles",
            }
        )

    statuses = {
        status
        for model in current["models"]
        for status in (model["status"], model["profilesStatus"])
    }
    current["status"] = "stale" if "stale" in statuses else "attention" if "last_good" in statuses else "fresh"
    current["modelCount"] = len(current["models"])
    current["profileCount"] = sum(len(model.get("profiles", [])) for model in current["models"])
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
    urls = sorted(
        {
            str(url)
            for model in payload["models"]
            for url in (model["sourceUrl"], model["profileSourceUrl"])
        }
    )
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
        "profileCount": candidate["profileCount"],
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
