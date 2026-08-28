from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path

from collector.collect import CollectorError
from collector.endpoints import collect_offers, normalize_offers, offer_targets


def raw_model(key: str, *, details: str | None = None) -> dict:
    return {
        "id": key,
        "canonical_slug": key,
        "name": key,
        "context_length": 131072,
        "pricing": {"prompt": "0.0000001", "completion": "0.0000005"},
        "links": {
            "details": details or f"/api/v1/models/{key}/endpoints",
        },
    }


def endpoint_payload(*offers: dict) -> dict:
    return {"data": {"endpoints": list(offers)}}


def raw_offer(
    venue: str,
    tag: str,
    prompt: str = "0.0000001",
    completion: str = "0.0000005",
) -> dict:
    return {
        "provider_name": venue,
        "tag": tag,
        "context_length": 131072,
        "pricing": {"prompt": prompt, "completion": completion},
        "quantization": "BF16",
        "max_completion_tokens": 65536,
        "supported_parameters": ["reasoning", "tools", "response_format"],
    }


class OfferNormalizationTests(unittest.TestCase):
    def test_targets_keep_only_safe_standard_rate_model_links(self) -> None:
        unsafe = raw_model("lab/unsafe", details="https://evil.example/endpoints")
        free = raw_model("lab/free")
        free["pricing"] = {"prompt": "0", "completion": "0"}
        payload = {"data": [raw_model("lab/model"), unsafe, free]}

        self.assertEqual(
            offer_targets(payload),
            [
                {
                    "key": "lab/model",
                    "canonicalKey": "lab/model",
                    "sourceUrl": "https://openrouter.ai/api/v1/models/lab/model/endpoints",
                }
            ],
        )

    def test_normalization_preserves_distinct_venue_offers(self) -> None:
        target = offer_targets({"data": [raw_model("lab/model")]})[0]
        first = raw_offer("Venue A", "venue-a/bf16", "0.00000003", "0.00000017")
        first["pricing"].update(
            {
                "input_cache_read": "0.00000001",
                "input_cache_write": "0.00000002",
                "internal_reasoning": "0.00000004",
            }
        )
        second = raw_offer("Venue B", "venue-b/fp4", "0.00000015", "0.00000060")
        second["quantization"] = "FP4"

        normalized = normalize_offers(target, endpoint_payload(second, first, first))

        self.assertEqual(normalized["key"], "lab/model")
        self.assertEqual(
            normalized["sourceUrl"],
            "https://openrouter.ai/api/v1/models/lab/model/endpoints",
        )
        self.assertEqual(len(normalized["offers"]), 2)
        cheapest = normalized["offers"][0]
        self.assertEqual(cheapest["venue"], "Venue A")
        self.assertEqual(cheapest["input_mtok"], 0.03)
        self.assertEqual(cheapest["output_mtok"], 0.17)
        self.assertEqual(cheapest["cached_input_mtok"], 0.01)
        self.assertEqual(cheapest["cache_write_mtok"], 0.02)
        self.assertEqual(cheapest["reasoning_mtok"], 0.04)
        self.assertEqual(cheapest["quantization"], "bf16")
        self.assertTrue(cheapest["supportsReasoning"])
        self.assertTrue(cheapest["supportsTools"])
        self.assertTrue(cheapest["supportsStructuredOutput"])


class OfferCollectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data_file = self.root / "data" / "offers.json"
        self.state_dir = self.root / "state"
        self.payload = {"data": [raw_model("lab/a"), raw_model("lab/b")]}

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def fetcher(target: dict[str, str]) -> dict:
        venue = "Venue A" if target["key"] == "lab/a" else "Venue B"
        return normalize_offers(
            target,
            endpoint_payload(raw_offer(venue, venue.lower().replace(" ", "-"))),
        )

    def collect(self, fetcher=None) -> str:
        return collect_offers(
            models_payload=self.payload,
            data_file=self.data_file,
            state_dir=self.state_dir,
            now=datetime(2026, 8, 28, 10, tzinfo=timezone.utc),
            workers=2,
            min_coverage=Decimal("0.80"),
            fetcher=fetcher or self.fetcher,
        )

    def test_first_run_writes_a_stable_public_offer_feed(self) -> None:
        self.assertEqual(self.collect(), "changed")
        feed = json.loads(self.data_file.read_text())
        self.assertEqual(feed["modelCount"], 2)
        self.assertEqual(feed["offerCount"], 2)
        self.assertEqual(feed["venueCount"], 2)
        self.assertEqual([model["key"] for model in feed["models"]], ["lab/a", "lab/b"])
        self.assertTrue((self.state_dir / "publish-pending").exists())

        before = self.data_file.read_bytes()
        self.assertEqual(self.collect(), "unchanged")
        self.assertEqual(self.data_file.read_bytes(), before)

    def test_failed_model_reuses_its_last_good_offer_set(self) -> None:
        self.collect()
        (self.state_dir / "publish-pending").unlink()

        def partial_fetcher(target: dict[str, str]) -> dict:
            if target["key"] == "lab/b":
                raise OSError("offline")
            return self.fetcher(target)

        self.assertEqual(self.collect(partial_fetcher), "unchanged")
        heartbeat = json.loads((self.state_dir / "offers-heartbeat.json").read_text())
        self.assertEqual(heartbeat["status"], "degraded")
        self.assertEqual(heartbeat["failedModelCount"], 1)
        self.assertEqual(heartbeat["reusedModelCount"], 1)
        self.assertFalse((self.state_dir / "publish-pending").exists())

    def test_low_initial_coverage_does_not_write_a_partial_feed(self) -> None:
        def failed_fetcher(target: dict[str, str]) -> dict:
            raise OSError(target["key"])

        with self.assertRaisesRegex(CollectorError, "below the 80% minimum"):
            self.collect(failed_fetcher)
        self.assertFalse(self.data_file.exists())


if __name__ == "__main__":
    unittest.main()
