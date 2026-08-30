from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from collector.official import (
    FetchResult,
    parse_anthropic,
    parse_deepseek,
    parse_google,
    parse_mistral,
    parse_moonshot,
    parse_openai,
    parse_xai,
    refresh_firstparty,
)


NOW = datetime(2026, 7, 31, 10, tzinfo=timezone.utc)


def row(provider: str, model: str, display: str) -> dict:
    return {
        "provider": provider,
        "model": model,
        "display": display,
        "input_mtok": 99,
        "output_mtok": 99,
        "source_url": "https://example.com/pricing",
        "checked": "2026-07-01",
    }


class OfficialParserTests(unittest.TestCase):
    def test_openai_standard_table(self) -> None:
        source = """
### Standard pricing data
| Model | Short context input | Cached | Writes | Short context output | Long input | Long cached | Long writes | Long output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-5.6-sol | $5.00 | $0.50 | $6.25 | $30.00 | $10 | $1 | $12.5 | $45 |
| gpt-5.6-terra | $2.00 | $0.20 | $2.50 | $12.00 | $4 | $0.4 | $5 | $18 |
| gpt-5.6-luna | $0.20 | $0.02 | $0.25 | $1.20 | $0.4 | $0.04 | $0.5 | $1.8 |

Batch
"""
        rows = [
            row("openai", "gpt-5.6-sol", "GPT-5.6 Sol"),
            row("openai", "gpt-5.6-terra", "GPT-5.6 Terra"),
            row("openai", "gpt-5.6-luna", "GPT-5.6 Luna"),
        ]
        self.assertEqual(
            parse_openai(source, rows, NOW),
            {
                "gpt-5.6-sol": (5.0, 30.0),
                "gpt-5.6-terra": (2.0, 12.0),
                "gpt-5.6-luna": (0.2, 1.2),
            },
        )

    def test_anthropic_selects_current_standard_prices(self) -> None:
        source = """
<p>The following table shows pricing for all Claude models:</p>
<table><tr><td>Claude Opus 5</td><td>$5 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td><td>$25 / MTok</td></tr>
<tr><td>Claude Sonnet 5</td><td>through August 31, 2026</td><td>$2 / MTok</td><td>$2.50 / MTok</td><td>$4 / MTok</td><td>$0.20 / MTok</td><td>$10 / MTok</td></tr>
<tr><td>Claude Sonnet 5</td><td>starting September 1, 2026</td><td>$3 / MTok</td><td>$3.75 / MTok</td><td>$6 / MTok</td><td>$0.30 / MTok</td><td>$15 / MTok</td></tr></table>
<h2>Batch processing</h2>
"""
        rows = [
            row("anthropic", "claude-opus-5", "Claude Opus 5"),
            row("anthropic", "claude-sonnet-5", "Claude Sonnet 5"),
        ]
        self.assertEqual(
            parse_anthropic(source, rows, NOW),
            {"claude-opus-5": (5.0, 25.0), "claude-sonnet-5": (2.0, 10.0)},
        )

    def test_google_paid_tier(self) -> None:
        source = """
<h2>Gemini 3.6 Flash</h2><code>gemini-3.6-flash</code>
<div>Input price</div><div>Free of charge</div><div>$1.50</div>
<div>Output price (including thinking tokens)</div><div>Free of charge</div><div>$7.50</div>
"""
        rows = [row("google", "gemini-3.6-flash", "Gemini 3.6 Flash")]
        self.assertEqual(parse_google(source, rows, NOW), {"gemini-3.6-flash": (1.5, 7.5)})

    def test_mistral_model_card(self) -> None:
        source = """
<h1>Mistral Medium 3.5</h1><p>Context</p><p>256k</p><p>Price</p><i>i</i>
<span>$</span><span>1.5</span><span>/M Tokens</span>
<span>$</span><span>7.5</span><span>/M Tokens</span>
"""
        rows = [row("mistralai", "mistral-medium-3.5", "Mistral Medium 3.5")]
        self.assertEqual(parse_mistral(source, rows, NOW), {"mistral-medium-3.5": (1.5, 7.5)})

    def test_mistral_consolidated_pricing_table(self) -> None:
        source = """
<table><tr><th>Model</th><th>Input</th><th>Cached input</th><th>Output</th></tr>
<tr><td>Mistral Medium 3.5</td><td>↗</td><td>$1.5</td><td>$0.15</td><td>$7.5</td></tr></table>
"""
        rows = [row("mistralai", "mistral-medium-3.5", "Mistral Medium 3.5")]
        self.assertEqual(parse_mistral(source, rows, NOW), {"mistral-medium-3.5": (1.5, 7.5)})

    def test_moonshot_json_ld_copy(self) -> None:
        source = "Kimi K3 API pricing is calculated based on token usage. Input tokens are billed at $3.00 per 1M tokens on a cache miss. Output tokens are billed at $15.00 per 1M tokens."
        rows = [row("moonshotai", "kimi-k3", "Kimi K3")]
        self.assertEqual(parse_moonshot(source, rows, NOW), {"kimi-k3": (3.0, 15.0)})

    def test_deepseek_table(self) -> None:
        source = """
<table><tr><td>MODEL</td><td>deepseek-v4-flash</td><td>deepseek-v4-pro</td></tr>
<tr><td>1M INPUT TOKENS (CACHE MISS)</td><td>$0.14</td><td>$0.435</td></tr>
<tr><td>1M OUTPUT TOKENS</td><td>$0.28</td><td>$0.87</td></tr></table>
"""
        rows = [row("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro")]
        self.assertEqual(parse_deepseek(source, rows, NOW), {"deepseek-v4-pro": (0.435, 0.87)})

    def test_deepseek_uses_peak_rate_from_time_banded_table(self) -> None:
        source = """
<table><tr><td>MODEL</td><td>deepseek-v4-flash</td><td>deepseek-v4-pro</td><td>deepseek-v4-flash-vision-exp</td></tr>
<tr><td>1M INPUT TOKENS<br>(CACHE MISS)</td><td>OFF-PEAK</td><td>$0.22</td><td>$0.66</td><td>$0.22</td></tr>
<tr><td>PEAK</td><td>$0.44</td><td>$1.32</td><td>$0.44</td></tr>
<tr><td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.66</td><td>$1.98</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$1.32</td><td>$3.96</td><td>$1.32</td></tr>
<tr><td>Concurrency Limit</td><td>2500</td><td>500</td><td>2500</td></tr></table>
"""
        rows = [row("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro")]
        self.assertEqual(parse_deepseek(source, rows, NOW), {"deepseek-v4-pro": (1.32, 3.96)})

    def test_xai_embedded_model_data(self) -> None:
        source = r'{\"name\":\"grok-4.5\",\"promptTextTokenPrice\":\"20000\",\"completionTextTokenPrice\":\"60000\"}'
        rows = [row("x-ai", "grok-4.5", "Grok 4.5")]
        self.assertEqual(parse_xai(source, rows, NOW), {"grok-4.5": (2.0, 6.0)})

    def test_xai_markdown_table(self) -> None:
        source = """
| Model | Context | Input / 1M tokens | Cached input / 1M tokens | Output / 1M tokens |
| --- | --- | --- | --- | --- |
| grok-4.5 (< 200k prompt tokens) | 500k | $2.00 | $0.30 | $6.00 |
| grok-4.5 (≥ 200k prompt tokens) | 500k | $4.00 | $0.60 | $12.00 |
"""
        rows = [row("x-ai", "grok-4.5", "Grok 4.5")]
        self.assertEqual(parse_xai(source, rows, NOW), {"grok-4.5": (2.0, 6.0)})


class OfficialRefreshTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.state = Path(self.temp.name)
        self.catalog = [row("openai", "gpt-5.6-luna", "GPT-5.6 Luna")]

    def tearDown(self) -> None:
        self.temp.cleanup()

    @staticmethod
    def source(input_price: str, output_price: str) -> str:
        return f"""
### Standard pricing data
| Model | Input | Cached | Writes | Output | Long input | Long cached | Long writes | Long output |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| gpt-5.6-luna | ${input_price} | $0.02 | $0.25 | ${output_price} | $0.4 | $0.04 | $0.5 | $1.8 |

Batch
"""

    def test_success_refreshes_catalog_and_writes_last_good(self) -> None:
        def fetcher(url: str, cached: dict | None) -> FetchResult:
            self.assertIn("openai.com", url)
            self.assertFalse(cached)
            return FetchResult(self.source("0.20", "1.20"), etag="v1")

        refreshed, report = refresh_firstparty(
            self.catalog, state_dir=self.state, now=NOW, fetcher=fetcher
        )
        self.assertEqual((refreshed[0]["input_mtok"], refreshed[0]["output_mtok"]), (0.2, 1.2))
        self.assertEqual(refreshed[0]["checked"], "2026-07-31")
        self.assertEqual(report["status"], "healthy")
        cached = json.loads((self.state / "firstparty-last-good.json").read_text())
        self.assertEqual(cached["providers"]["openai"]["prices"]["gpt-5.6-luna"]["output_mtok"], 1.2)

    def test_failure_uses_provider_last_good_and_reports_degraded(self) -> None:
        refresh_firstparty(
            self.catalog,
            state_dir=self.state,
            now=NOW,
            fetcher=lambda url, cached: FetchResult(self.source("0.20", "1.20")),
        )

        def offline(url: str, cached: dict | None) -> FetchResult:
            raise OSError("offline")

        later = datetime(2026, 7, 31, 11, tzinfo=timezone.utc)
        refreshed, report = refresh_firstparty(
            self.catalog, state_dir=self.state, now=later, fetcher=offline
        )
        self.assertEqual((refreshed[0]["input_mtok"], refreshed[0]["output_mtok"]), (0.2, 1.2))
        self.assertEqual(report["status"], "degraded")
        self.assertEqual(report["providers"][0]["status"], "last_good")


if __name__ == "__main__":
    unittest.main()
