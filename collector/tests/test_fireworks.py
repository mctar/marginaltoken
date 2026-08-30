from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from collector.collect import CollectorError
from collector.fireworks import (
    match_fireworks_pricing,
    parse_fireworks_pricing,
    refresh_fireworks_pricing,
)


HEADER = """## Text and vision models

Per-model pricing for headline models.

| Model | Standard | Priority |
| --- | --- | --- |
"""


def pricing(*rows: str) -> str:
    return HEADER + "\n".join(rows) + "\n\n## Other base models — by size and architecture\n"


def row(
    display: str,
    slug: str,
    *,
    standard: str = r"\$0.15 / \$0.015 / \$0.60",
    priority: str = r"\$0.18 / \$0.018 / \$0.72",
) -> str:
    return (
        f"| [{display}](https://app.fireworks.ai/models/fireworks/{slug}) "
        f"| {standard} | {priority} |"
    )


class FireworksPricingParserTests(unittest.TestCase):
    def test_parses_standard_prices_and_skips_fast_and_us_variants(self) -> None:
        models = parse_fireworks_pricing(pricing(
            row("Kimi K3", "kimi-k3", standard=r"\$3.00 / \$0.30 / \$15.00"),
            row("Kimi K3 Fast", "kimi-k3", standard=r"\$4.50 / \$0.45 / \$22.50"),
            row("Kimi K3 US", "kimi-k3", standard=r"\$3.30 / \$0.33 / \$16.50"),
        ))

        self.assertEqual(len(models), 1)
        model = models[0]
        self.assertEqual(model["fireworksModelId"], "accounts/fireworks/models/kimi-k3")
        self.assertEqual(model["input_mtok"], 3.0)
        self.assertEqual(model["cached_input_mtok"], 0.3)
        self.assertEqual(model["output_mtok"], 15.0)

    def test_rejects_changed_standard_price_shape(self) -> None:
        source = pricing(row("Kimi K3", "kimi-k3", standard=r"\$3.00 / \$15.00"))
        with self.assertRaisesRegex(CollectorError, "Standard prices changed"):
            parse_fireworks_pricing(source)

    def test_rejects_changed_headers(self) -> None:
        source = pricing(row("Kimi K3", "kimi-k3")).replace("Priority", "Premium")
        with self.assertRaisesRegex(CollectorError, "headers changed"):
            parse_fireworks_pricing(source)

    def test_matches_only_reviewed_underlying_models(self) -> None:
        models = parse_fireworks_pricing(pricing(
            row("Kimi K3", "kimi-k3"),
            row("Unknown", "unknown-model"),
        ))
        targets = [{
            "key": "moonshotai/kimi-k3",
            "canonicalKey": "moonshotai/kimi-k3-20260801",
            "sourceUrl": "https://example.test/kimi",
        }]

        matched, unmatched = match_fireworks_pricing(models, targets)

        self.assertEqual([model["key"] for model in matched], ["moonshotai/kimi-k3"])
        self.assertEqual(unmatched, ["accounts/fireworks/models/unknown-model"])


class FireworksPricingRefreshTests(unittest.TestCase):
    def test_reuses_last_good_prices_after_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary)
            models = parse_fireworks_pricing(pricing(*[
                row(f"Model {index}", slug)
                for index, slug in enumerate((
                    "kimi-k3",
                    "kimi-k2p7-code",
                    "kimi-k2p6",
                    "deepseek-v4-pro-0813",
                    "deepseek-v4-flash-0731",
                    "glm-5p3",
                    "glm-5p2",
                    "qwen3p7-plus",
                ))
            ]))
            fresh, fresh_status = refresh_fireworks_pricing(
                state_dir=state_dir,
                now=datetime(2026, 8, 30, 8, tzinfo=timezone.utc),
                fetcher=lambda _url: models,
            )
            self.assertEqual(fresh, models)
            self.assertEqual(fresh_status["status"], "healthy")

            def offline(_url: str) -> list[dict]:
                raise OSError("offline")

            fallback, fallback_status = refresh_fireworks_pricing(
                state_dir=state_dir,
                now=datetime(2026, 8, 30, 9, tzinfo=timezone.utc),
                fetcher=offline,
            )
            self.assertEqual(fallback, models)
            self.assertEqual(fallback_status["status"], "last_good")
            self.assertEqual(fallback_status["lastVerified"], "2026-08-30T08:00:00Z")

    def test_rejects_a_materially_incomplete_price_table(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            models = parse_fireworks_pricing(pricing(row("Kimi K3", "kimi-k3")))
            refreshed, status = refresh_fireworks_pricing(
                state_dir=Path(temporary),
                fetcher=lambda _url: models,
            )
            self.assertEqual(refreshed, [])
            self.assertEqual(status["status"], "unavailable")
            self.assertIn("below the 8 minimum", status["detail"])


if __name__ == "__main__":
    unittest.main()
