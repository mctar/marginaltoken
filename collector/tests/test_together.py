from __future__ import annotations

import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from collector.collect import CollectorError
from collector.together import (
    match_together_catalog,
    parse_together_catalog,
    refresh_together_catalog,
)


HEADER = """## Chat models

| Organization | Model name | API model string | Context length | Input pricing (per 1M tokens) | Cached input pricing (per 1M tokens) | Output pricing (per 1M tokens) | Quantization | Function calling | Structured outputs |
| :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- | :--- |
"""


def catalog(*rows: str) -> str:
    return HEADER + "\n".join(rows) + "\n\n## Image models\n"


def row(
    model_id: str,
    *,
    display: str = "Model Prime",
    context: str = "131072",
    input_price: str = r"\$0.15",
    cached_price: str = r"\$0.03",
    output_price: str = r"\$0.60",
    quantization: str = "FP8",
    tools: str = "Yes",
    structured: str = "Yes",
) -> str:
    return (
        f"| Lab | {display} | {model_id} | {context} | {input_price} | "
        f"{cached_price} | {output_price} | {quantization} | {tools} | {structured} |"
    )


class TogetherCatalogParserTests(unittest.TestCase):
    def test_parses_only_paid_unambiguous_chat_rows(self) -> None:
        markdown = catalog(
            row("lab/model"),
            row("lab/free", input_price="Free", output_price="Free"),
            row("lab/duplicate", input_price=r"\$1.00"),
            row("lab/duplicate", input_price=r"\$2.00"),
        )

        models = parse_together_catalog(markdown)

        self.assertEqual([model["togetherModelId"] for model in models], ["lab/model"])
        model = models[0]
        self.assertEqual(model["input_mtok"], 0.15)
        self.assertEqual(model["cached_input_mtok"], 0.03)
        self.assertEqual(model["output_mtok"], 0.6)
        self.assertEqual(model["context"], 131072)
        self.assertEqual(model["quantization"], "fp8")
        self.assertTrue(model["supportsTools"])
        self.assertTrue(model["supportsStructuredOutput"])

    def test_preserves_unreported_configuration_fields_as_unknown(self) -> None:
        model = parse_together_catalog(catalog(row(
            "lab/model",
            context="-",
            cached_price="-",
            quantization="-",
            tools="-",
            structured="-",
        )))[0]

        self.assertEqual(model["context"], 0)
        self.assertNotIn("cached_input_mtok", model)
        self.assertNotIn("quantization", model)
        self.assertNotIn("supportsTools", model)
        self.assertNotIn("supportsStructuredOutput", model)

    def test_rejects_a_changed_table_contract(self) -> None:
        changed = catalog(row("lab/model")).replace("Function calling", "Tools")
        with self.assertRaisesRegex(CollectorError, "headers changed"):
            parse_together_catalog(changed)

    def test_matches_provider_aliases_and_explicit_model_aliases(self) -> None:
        models = parse_together_catalog(catalog(
            row("deepseek-ai/DeepSeek-V4-Pro-0813"),
            row("meta-llama/Llama-3.3-70B-Instruct-Turbo"),
            row("meta-models/Muse-Glimmer-30B"),
        ))
        targets = [
            {"key": "deepseek/deepseek-v4-pro-0813", "canonicalKey": "deepseek/deepseek-v4-pro-0813", "sourceUrl": "https://example/a"},
            {"key": "meta-llama/llama-3.3-70b-instruct", "canonicalKey": "meta-llama/llama-3.3-70b-instruct", "sourceUrl": "https://example/b"},
            {"key": "meta/muse-glimmer-30b", "canonicalKey": "meta/muse-glimmer-30b-20260810", "sourceUrl": "https://example/c"},
        ]

        matched, unmatched = match_together_catalog(models, targets)

        self.assertEqual(
            [model["key"] for model in matched],
            [
                "deepseek/deepseek-v4-pro-0813",
                "meta-llama/llama-3.3-70b-instruct",
                "meta/muse-glimmer-30b",
            ],
        )
        self.assertEqual(unmatched, [])


class TogetherCatalogRefreshTests(unittest.TestCase):
    def test_reuses_last_good_catalog_after_a_failure(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            state_dir = Path(temporary)
            models = parse_together_catalog(catalog(*[row(f"lab/model-{index}") for index in range(5)]))

            fresh, fresh_status = refresh_together_catalog(
                state_dir=state_dir,
                now=datetime(2026, 8, 29, 8, tzinfo=timezone.utc),
                fetcher=lambda _url: models,
            )
            self.assertEqual(fresh, models)
            self.assertEqual(fresh_status["status"], "healthy")

            def offline(_url: str) -> list[dict]:
                raise OSError("offline")

            fallback, fallback_status = refresh_together_catalog(
                state_dir=state_dir,
                now=datetime(2026, 8, 29, 9, tzinfo=timezone.utc),
                fetcher=offline,
            )
            self.assertEqual(fallback, models)
            self.assertEqual(fallback_status["status"], "last_good")
            self.assertEqual(fallback_status["lastVerified"], "2026-08-29T08:00:00Z")

    def test_rejects_a_materially_incomplete_catalog(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            rows = parse_together_catalog(catalog(row("lab/only-one")))
            models, status = refresh_together_catalog(
                state_dir=Path(temporary),
                fetcher=lambda _url: rows,
            )
            self.assertEqual(models, [])
            self.assertEqual(status["status"], "unavailable")
            self.assertIn("below the 5 minimum", status["detail"])


if __name__ == "__main__":
    unittest.main()
