"""Seed per-source access history from dated checks, preserving editorial review dates."""
import argparse
import json
import os
import tempfile
from datetime import datetime, timezone
from pathlib import Path


def utc_time(value):
    if not isinstance(value, str):
        return None
    try:
        parsed = datetime.fromisoformat(value.replace("Z", "+00:00"))
    except ValueError:
        return None
    if parsed.tzinfo is None:
        return None
    return parsed.astimezone(timezone.utc).isoformat(timespec="microseconds")


def update_sources(watch, saved):
    sources = saved.setdefault("sources", {})
    checks = list(watch.get("sourceChecks", []))
    for provider in watch.get("providerCoverage", []):
        for row in provider.get("sourceResults", []):
            checks.append({"provider": provider.get("provider"), **row})
    for row in checks:
        when = utc_time(row.get("checkedAt"))
        url = row.get("url")
        status = row.get("status")
        if not when or not url or status not in {"failed", "checked", "not-checked"}:
            continue
        source = sources.setdefault(url, {"reviewedThrough": None})
        if row.get("provider"):
            source["provider"] = row["provider"]
        if row.get("id"):
            source["category"] = row["id"].split(":")[0]
        if status == "checked" and when > (utc_time(source.get("lastAccessSuccess")) or ""):
            source["lastAccessSuccess"] = when
        if when >= (utc_time(source.get("lastAttempt")) or ""):
            source.update(lastAttempt=when, accessStatus=status)
    return saved


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--state-dir", type=Path, default=Path("collector/state"))
    directory = parser.parse_args().state_dir
    target = directory / "editorial-source-coverage.json"
    watch = json.loads((directory / "editorial-watch.json").read_text())
    saved = json.loads(target.read_text()) if target.exists() else {"version": 1}
    result = update_sources(watch, saved)
    with tempfile.NamedTemporaryFile(mode="w", dir=directory, delete=False) as output:
        json.dump(result, output, indent=2, sort_keys=True)
        output.write("\n")
    os.replace(output.name, target)
    print(f"{len(result['sources'])} source histories indexed")


if __name__ == "__main__":
    main()
