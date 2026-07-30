from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from decimal import Decimal
from pathlib import Path
from unittest.mock import patch

from collector.collect import (
    CollectorError,
    collect_once,
    load_firstparty,
    main,
    normalize_openrouter,
)


def raw_model(key: str, prompt: str, completion: str, name: str | None = None) -> dict:
    return {
        "id": key,
        "name": name or key,
        "context_length": 128000,
        "pricing": {"prompt": prompt, "completion": completion},
    }


class FirstPartyCatalogTests(unittest.TestCase):
    def setUp(self) -> None:
        catalog_path = Path(__file__).resolve().parents[1] / "firstparty.json"
        self.models = load_firstparty(catalog_path)

    def test_priority_providers_have_three_checked_rows(self) -> None:
        for provider in ("anthropic", "openai", "google"):
            rows = [model for model in self.models if model["provider"] == provider]
            self.assertGreaterEqual(len(rows), 3, provider)
            self.assertEqual(sum(model["indexEligible"] for model in rows), 1, provider)

    def test_new_first_party_tiers_have_expected_rates(self) -> None:
        by_key = {model["key"]: model for model in self.models}
        expected = {
            "anthropic/claude-fable-5": (10.0, 50.0, 1000000),
            "anthropic/claude-opus-5": (5.0, 25.0, 1000000),
            "anthropic/claude-haiku-4.5": (1.0, 5.0, 200000),
            "openai/gpt-5.6-terra": (2.5, 15.0, 1050000),
            "openai/gpt-5.6-luna": (1.0, 6.0, 1050000),
            "google/gemini-3.5-flash": (1.5, 9.0, 1048576),
            "google/gemini-3.5-flash-lite": (0.3, 2.5, 1048576),
        }
        for key, (input_price, output_price, context) in expected.items():
            with self.subTest(key=key):
                self.assertEqual(by_key[key]["input_mtok"], input_price)
                self.assertEqual(by_key[key]["output_mtok"], output_price)
                self.assertEqual(by_key[key]["context"], context)
        self.assertTrue(by_key["anthropic/claude-fable-5"]["indexEligible"])
        self.assertFalse(by_key["anthropic/claude-opus-5"]["indexEligible"])
        self.assertFalse(by_key["anthropic/claude-sonnet-5"]["indexEligible"])
        self.assertFalse(by_key["anthropic/claude-haiku-4.5"]["indexEligible"])


class CollectorTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.state = self.root / "state"
        self.source = self.root / "source.json"
        self.firstparty = self.root / "firstparty.json"
        self.write_source(
            [
                raw_model("lab/flagship", "0.000002", "0.000010", "Lab: Flagship"),
                raw_model("router/value", "0.000001", "0.000004", "Router: Value"),
            ]
        )
        self.write_firstparty(10.0)

    def tearDown(self) -> None:
        self.temp.cleanup()

    def write_source(self, models: list[dict]) -> None:
        self.source.write_text(json.dumps({"data": models}), encoding="utf-8")

    def write_firstparty(self, output: float) -> None:
        self.firstparty.write_text(
            json.dumps(
                [
                    {
                        "provider": "lab",
                        "model": "flagship",
                        "display": "Lab Flagship",
                        "input_mtok": 2.0,
                        "output_mtok": output,
                        "context": 128000,
                        "index_eligible": True,
                        "source_url": "https://example.com/pricing",
                        "checked": "2026-07-29",
                    }
                ]
            ),
            encoding="utf-8",
        )

    def collect(self, day: int = 29, *, rebase_index: bool = False) -> str:
        return collect_once(
            data_dir=self.data,
            state_dir=self.state,
            firstparty_path=self.firstparty,
            source_file=self.source,
            now=datetime(2026, 7, day, 10, tzinfo=timezone.utc),
            min_models=1,
            retention_ratio=Decimal("0.8"),
            rebase_index=rebase_index,
        )

    def write_firstparty_pair(self, selected: str) -> None:
        self.firstparty.write_text(
            json.dumps(
                [
                    {
                        "provider": "lab",
                        "model": model,
                        "display": f"Lab {model.title()}",
                        "input_mtok": 2.0 if model == "flagship" else 5.0,
                        "output_mtok": 10.0 if model == "flagship" else 25.0,
                        "context": 128000,
                        "index_eligible": model == selected,
                        "source_url": "https://example.com/pricing",
                        "checked": "2026-07-29",
                    }
                    for model in ("flagship", "opus")
                ]
            ),
            encoding="utf-8",
        )

    def test_normalization_skips_nonstandard_rows(self) -> None:
        payload = {
            "data": [
                raw_model("ok/model", "0.000001", "0.000002"),
                raw_model("free/model", "0", "0"),
                raw_model("bad/router", "-1", "-1"),
                raw_model("batch/model:batch", "0.1", "0.2"),
                raw_model("~alias/model", "0.1", "0.2"),
            ]
        }
        models = normalize_openrouter(payload)
        self.assertEqual([model["key"] for model in models], ["ok/model"])
        self.assertEqual(models[0]["input_mtok"], 1.0)

    def test_normalization_keeps_objective_filter_metadata(self) -> None:
        model = raw_model("lab/vision-preview", "0.000001", "0.000002")
        model.update(
            {
                "architecture": {
                    "input_modalities": ["text", "image", "image"],
                    "output_modalities": ["text"],
                },
                "supported_parameters": [
                    "tools",
                    "reasoning",
                    "response_format",
                ],
                "top_provider": {"max_completion_tokens": 65536},
                "knowledge_cutoff": "2025-12",
                "expiration_date": "2026-12-31",
                "hugging_face_id": "lab/vision",
            }
        )
        normalized = normalize_openrouter({"data": [model]})[0]
        self.assertEqual(normalized["inputModalities"], ["image", "text"])
        self.assertEqual(normalized["outputModalities"], ["text"])
        self.assertTrue(normalized["supportsReasoning"])
        self.assertTrue(normalized["supportsTools"])
        self.assertTrue(normalized["supportsStructuredOutput"])
        self.assertEqual(normalized["releaseStage"], "preview")
        self.assertEqual(normalized["maxOutputTokens"], 65536)
        self.assertEqual(normalized["knowledgeCutoff"], "2025-12")
        self.assertEqual(normalized["expirationDate"], "2026-12-31")
        self.assertEqual(normalized["huggingFaceId"], "lab/vision")

    def test_first_run_and_unchanged_run_are_stable(self) -> None:
        self.assertEqual(self.collect(), "changed")
        before = {path.name: path.read_bytes() for path in self.data.iterdir()}
        self.assertEqual(self.collect(day=30), "unchanged")
        after = {path.name: path.read_bytes() for path in self.data.iterdir()}
        self.assertEqual(before, after)
        self.assertTrue((self.state / "publish-pending").exists())
        meta = json.loads((self.data / "meta.json").read_text())
        self.assertEqual(meta["indexValue"], 100.0)
        self.assertEqual(meta["basket"], ["lab/flagship"])

    def test_price_change_appends_event_and_history(self) -> None:
        self.collect()
        self.write_source(
            [
                raw_model("lab/flagship", "0.000002", "0.000010", "Lab: Flagship"),
                raw_model("router/value", "0.000001", "0.000002", "Router: Value"),
            ]
        )
        self.assertEqual(self.collect(day=30), "changed")
        changes = json.loads((self.data / "changes.json").read_text())["changes"]
        event = next(event for event in changes if event["type"] == "price")
        self.assertEqual(event["field"], "output_mtok")
        self.assertEqual(event["pct"], -50.0)
        points = json.loads((self.data / "history.json").read_text())["points"]
        self.assertEqual(sum(point["key"] == "router/value" for point in points), 2)
        editorial = json.loads((self.state / "editorial-input.json").read_text())
        self.assertEqual(editorial["generatedAt"], "2026-07-30T10:00:00Z")
        self.assertEqual(len(editorial["events"]), 1)
        self.assertEqual(editorial["events"][0]["key"], "router/value")

    def test_index_history_tracks_curated_price(self) -> None:
        self.collect()
        self.write_firstparty(5.0)
        self.collect(day=30)
        meta = json.loads((self.data / "meta.json").read_text())
        self.assertEqual(meta["indexValue"], 50.0)
        self.assertEqual(meta["indexHistory"][-1], {"date": "2026-07-30", "value": 50.0})

    def test_explicit_rebase_corrects_inception_basket_without_false_move(self) -> None:
        self.write_firstparty_pair("flagship")
        self.collect()
        self.write_firstparty_pair("opus")
        self.assertEqual(self.collect(day=30, rebase_index=True), "changed")

        meta = json.loads((self.data / "meta.json").read_text())
        self.assertEqual(meta["basket"], ["lab/opus"])
        self.assertEqual(meta["indexValue"], 100.0)
        self.assertEqual(meta["indexBaseMean"], 25.0)
        self.assertEqual(meta["indexBaseDate"], "2026-07-29")
        self.assertEqual(meta["indexHistory"], [{"date": "2026-07-29", "value": 100.0}])

        changes = json.loads((self.data / "changes.json").read_text())["changes"]
        self.assertFalse(any(event["type"] == "basket" for event in changes))

    def test_new_listing_seeds_its_history(self) -> None:
        self.collect()
        self.write_source(
            [
                raw_model("lab/flagship", "0.000002", "0.000010"),
                raw_model("router/value", "0.000001", "0.000004"),
                raw_model("router/new", "0.000003", "0.000006"),
            ]
        )
        self.collect(day=30)
        points = json.loads((self.data / "history.json").read_text())["points"]
        new_points = [point for point in points if point["key"] == "router/new"]
        self.assertEqual(len(new_points), 1)
        self.assertEqual(new_points[0]["output_mtok"], 6.0)

    def test_invalid_source_exits_zero_without_touching_data(self) -> None:
        self.collect()
        before = {path.name: path.read_bytes() for path in self.data.iterdir()}
        self.source.write_text("not json", encoding="utf-8")
        result = main(
            [
                "--source-file",
                str(self.source),
                "--data-dir",
                str(self.data),
                "--state-dir",
                str(self.state),
                "--firstparty",
                str(self.firstparty),
                "--min-models",
                "1",
            ]
        )
        self.assertEqual(result, 0)
        after = {path.name: path.read_bytes() for path in self.data.iterdir()}
        self.assertEqual(before, after)

    def test_network_failure_exits_zero_without_touching_data(self) -> None:
        self.collect()
        before = {path.name: path.read_bytes() for path in self.data.iterdir()}
        with patch("collector.collect.urllib.request.urlopen", side_effect=OSError("offline")):
            result = main(
                [
                    "--data-dir",
                    str(self.data),
                    "--state-dir",
                    str(self.state),
                    "--firstparty",
                    str(self.firstparty),
                    "--min-models",
                    "1",
                ]
            )
        self.assertEqual(result, 0)
        after = {path.name: path.read_bytes() for path in self.data.iterdir()}
        self.assertEqual(before, after)

    def test_large_model_loss_is_rejected(self) -> None:
        self.collect()
        self.write_source([raw_model("lab/flagship", "0.000002", "0.000010")])
        with self.assertRaises(CollectorError):
            self.collect(day=30)


if __name__ == "__main__":
    unittest.main()
