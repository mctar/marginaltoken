from __future__ import annotations

import json
import tempfile
import unittest
from datetime import datetime, timedelta, timezone
from pathlib import Path

from collector.official import (
    FetchResult,
    PARSER_SCHEMAS,
    OfficialSourceError,
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
| gpt-6-astra | $10.00 | $1.00 | $12.50 | $50.00 | $20 | $2 | $25 | $75 |
| gpt-6.1-sol | $2.00 | $0.20 | $2.50 | $10.00 | $4 | $0.4 | $5 | $15 |
| gpt-6-sol | $2.00 | $0.20 | $2.50 | $10.00 | $4 | $0.4 | $5 | $15 |
| gpt-6-luna | $0.10 | $0.01 | $0.125 | $0.50 | $0.2 | $0.02 | $0.25 | $0.75 |
| gpt-5.6-sol | $4.00 | $0.40 | $5.00 | $20.00 | $8 | $0.8 | $10 | $30 |
| gpt-5.6-terra | $2.00 | $0.20 | $2.50 | $12.00 | $4 | $0.4 | $5 | $18 |
| gpt-5.6-luna | $0.20 | $0.02 | $0.25 | $1.20 | $0.4 | $0.04 | $0.5 | $1.8 |

Batch
"""
        rows = [
            row("openai", "gpt-6-astra", "GPT-6 Astra"),
            row("openai", "gpt-6.1-sol", "GPT-6.1 Sol"),
            row("openai", "gpt-6-sol", "GPT-6 Sol"),
            row("openai", "gpt-6-luna", "GPT-6 Luna"),
            row("openai", "gpt-5.6-sol", "GPT-5.6 Sol"),
            row("openai", "gpt-5.6-terra", "GPT-5.6 Terra"),
            row("openai", "gpt-5.6-luna", "GPT-5.6 Luna"),
        ]
        self.assertEqual(
            parse_openai(source, rows, NOW),
            {
                "gpt-6-astra": (10.0, 50.0),
                "gpt-6.1-sol": (2.0, 10.0),
                "gpt-6-sol": (2.0, 10.0),
                "gpt-6-luna": (0.1, 0.5),
                "gpt-5.6-sol": (4.0, 20.0),
                "gpt-5.6-terra": (2.0, 12.0),
                "gpt-5.6-luna": (0.2, 1.2),
            },
        )

    def test_openai_named_columns_survive_reordering_and_extra_cache_tiers(self):
        source = (Path(__file__).parent / 'fixtures/openai-pricing-20261021.md').read_text()
        expected = {'gpt-6-astra': (10, 50), 'gpt-6.1-sol': (2, 10), 'gpt-6-sol': (2, 10),
                    'gpt-6-luna': (.1, .5), 'gpt-5.6-sol': (4, 20), 'gpt-5.6-terra': (2, 12),
                    'gpt-5.6-luna': (.2, 1.2)}
        rows = [row('openai', name, name) for name in expected]
        self.assertEqual(parse_openai(source, rows, NOW), expected)
        for invalid in [source.replace('Short context output', 'Unknown price'),
                        source.replace('Short context 30m write', 'Short context output'),
                        source.replace('| $10.00 | $50.00 |', '| $10.00 | $50 / $60 |')]:
            with self.assertRaises(OfficialSourceError):
                parse_openai(invalid, rows, NOW)
        duplicate = source.replace('### Batch pricing data',
            '| Model | Input | Output |\n| gpt-6-astra | $1 | $2 |\n### Batch pricing data')
        with self.assertRaises(OfficialSourceError):
            parse_openai(duplicate, rows, NOW)
        unrelated = source.replace('| gpt-6-astra | $10.00 |', '| gpt-6-astra |')
        self.assertEqual(parse_openai(unrelated, [row('openai', 'gpt-6.1-sol', 'Sol')], NOW),
                         {'gpt-6.1-sol': (2, 10)})

    def test_anthropic_selects_current_standard_prices(self) -> None:
        source = """
<p>The following table shows pricing for all Claude models:</p>
<table><tr><th>Model</th><th>Base tokens</th><th>Prompt caching</th></tr>
<tr><th>Name</th><th>Input</th><th>Output</th><th>5m writes</th><th>1h writes</th><th>Hits and refreshes</th></tr>
<tr><td>Claude Opus 5.5</td><td>$4 / MTok</td><td>$20 / MTok</td><td>$5 / MTok</td><td>$8 / MTok</td><td>$0.20 / MTok</td></tr>
<tr><td>Claude Sonnet 5.5</td><td>$2 / MTok</td><td>$10 / MTok</td><td>$2.50 / MTok</td><td>$4 / MTok</td><td>$0.20 / MTok</td></tr>
<tr><td>Claude Opus 5</td><td>$5 / MTok</td><td>$25 / MTok</td><td>$6.25 / MTok</td><td>$10 / MTok</td><td>$0.50 / MTok</td></tr>
<tr><td>Claude Sonnet 5</td><td>$2 / MTok</td><td>$10 / MTok</td><td>$2.50 / MTok</td><td>$4 / MTok</td><td>$0.20 / MTok</td></tr></table>
<h2>Batch processing</h2>
"""
        rows = [
            row("anthropic", "claude-opus-5.5", "Claude Opus 5.5"),
            row("anthropic", "claude-sonnet-5.5", "Claude Sonnet 5.5"),
            row("anthropic", "claude-opus-5", "Claude Opus 5"),
            row("anthropic", "claude-sonnet-5", "Claude Sonnet 5"),
        ]
        self.assertEqual(
            parse_anthropic(source, rows, NOW),
            {
                "claude-opus-5.5": (4.0, 20.0),
                "claude-sonnet-5.5": (2.0, 10.0),
                "claude-opus-5": (5.0, 25.0),
                "claude-sonnet-5": (2.0, 10.0),
            },
        )

    def test_anthropic_current_table_does_not_expect_cancelled_scheduled_row(self) -> None:
        source = """
<p>The following table shows pricing for all Claude models:</p>
<table><tr><td>Claude Fable 5.1</td><td>$10 / MTok</td><td>$12.50 / MTok</td><td>$20 / MTok</td><td>$1 / MTok</td><td>$50 / MTok</td></tr>
<tr><td>Claude Fable 5</td><td>$8 / MTok</td><td>$10 / MTok</td><td>$16 / MTok</td><td>$0.80 / MTok</td><td>$40 / MTok</td></tr>
<tr><td>Claude Sonnet 5</td><td>$2 / MTok</td><td>$2.50 / MTok</td><td>$4 / MTok</td><td>$0.20 / MTok</td><td>$10 / MTok</td></tr></table>
<h2>Batch processing</h2>
"""
        rows = [
            row("anthropic", "claude-fable-5.1", "Claude Fable 5.1"),
            row("anthropic", "claude-fable-5", "Claude Fable 5"),
            row("anthropic", "claude-sonnet-5", "Claude Sonnet 5"),
        ]
        september = datetime(2026, 9, 8, 10, tzinfo=timezone.utc)
        self.assertEqual(
            parse_anthropic(source, rows, september),
            {
                "claude-fable-5.1": (10.0, 50.0),
                "claude-fable-5": (8.0, 40.0),
                "claude-sonnet-5": (2.0, 10.0),
            },
        )

    def test_anthropic_qualified_haiku_uses_short_prompt_tier_in_any_order(self) -> None:
        short = "| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |"
        long = "| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |"
        for tiers in [(short, long), (long, short)]:
            with self.subTest(tiers=tiers):
                source = "The following table shows pricing for all Claude models:\n" + "\n".join(tiers) + "\nBatch processing"
                self.assertEqual(parse_anthropic(source, [row("anthropic", "claude-haiku-5.5", "Claude Haiku 5.5")], NOW), {"claude-haiku-5.5": (0.1, 0.5)})

    def test_anthropic_does_not_substitute_haiku_long_context_for_missing_base(self) -> None:
        source = "The following table shows pricing for all Claude models:\n| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |\nBatch processing"
        with self.assertRaisesRegex(OfficialSourceError, "row missing"):
            parse_anthropic(source, [row("anthropic", "claude-haiku-5.5", "Claude Haiku 5.5")], NOW)

    def test_anthropic_rejects_ambiguous_standard_rows(self) -> None:
        source = "The following table shows pricing for all Claude models:\n" + ("| Claude Haiku 5.5 | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |\n" * 2) + "Batch processing"
        with self.assertRaisesRegex(OfficialSourceError, "row ambiguous"):
            parse_anthropic(source, [row("anthropic", "claude-haiku-5.5", "Claude Haiku 5.5")], NOW)

    def test_anthropic_fast_mode_table_is_outside_standard_prices(self) -> None:
        source = """
The following table shows pricing for all Claude models:
| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok |
### Fast mode pricing
| Model | Input | Output |
| Claude Opus 5.5 | $8 / MTok | $40 / MTok |
### Batch processing
"""
        self.assertEqual(parse_anthropic(source, [row("anthropic", "claude-opus-5.5", "Claude Opus 5.5")], NOW), {"claude-opus-5.5": (4, 20)})

    def test_google_paid_tier(self) -> None:
        source = """
<h2>Gemini 3.6 Flash</h2><code>gemini-3.6-flash</code>
<div>Input price</div><div>Free of charge</div><div>$1.50</div>
<div>Output price (including thinking tokens)</div><div>Free of charge</div><div>$7.50</div>
"""
        rows = [row("google", "gemini-3.6-flash", "Gemini 3.6 Flash")]
        self.assertEqual(parse_google(source, rows, NOW), {"gemini-3.6-flash": (1.5, 7.5)})

    def test_google_selects_rate_for_scheduled_effective_date(self) -> None:
        source = """
<h2>Gemini 3.8 Flash</h2><code>gemini-3.8-flash</code>
<div>Input price</div><div>Free of charge</div><div>$0.75 through December 31, 2026.</div><div>$1.50 starting January 1, 2027.</div>
<div>Output price (including thinking tokens)</div><div>Free of charge</div><div>$3.75 through December 31, 2026.</div><div>$7.50 starting January 1, 2027.</div>
<div>Context caching price</div><div>$0.075</div>
"""
        rows = [row("google", "gemini-3.8-flash", "Gemini 3.8 Flash")]
        self.assertEqual(
            parse_google(source, rows, datetime(2026, 9, 8, tzinfo=timezone.utc)),
            {"gemini-3.8-flash": (0.75, 3.75)},
        )
        self.assertEqual(
            parse_google(source, rows, datetime(2027, 1, 1, tzinfo=timezone.utc)),
            {"gemini-3.8-flash": (1.5, 7.5)},
        )

    def test_google_tracks_recent_flash_predecessor(self) -> None:
        source = """
<h2>Gemini 3.7 Flash</h2><code>gemini-3.7-flash</code>
<div>Input price</div><div>Free of charge</div><div>$0.75 through December 31, 2026.</div><div>$1.50 starting January 1, 2027.</div>
<div>Output price (including thinking tokens)</div><div>Free of charge</div><div>$3.75 through December 31, 2026.</div><div>$7.50 starting January 1, 2027.</div>
<div>Context caching price</div><div>$0.075</div>
"""
        rows = [row("google", "gemini-3.7-flash", "Gemini 3.7 Flash")]
        self.assertEqual(
            parse_google(source, rows, datetime(2026, 10, 6, tzinfo=timezone.utc)),
            {"gemini-3.7-flash": (0.75, 3.75)},
        )

    def test_google_pro_uses_short_context_standard_rate(self) -> None:
        source = """
<h2>Gemini 3.1 Pro Preview</h2><code>gemini-3.1-pro-preview</code>
<div>Input price</div><div>Free of charge</div><div>$2.00, prompts &lt;= 200k tokens</div><div>$4.00, prompts &gt; 200k tokens</div>
<div>Output price (including thinking tokens)</div><div>Free of charge</div><div>$12.00, prompts &lt;= 200k tokens</div><div>$18.00, prompts &gt; 200k tokens</div>
<div>Context caching price</div><div>$0.20</div>
"""
        rows = [row("google", "gemini-3.1-pro-preview", "Gemini 3.1 Pro Preview")]
        self.assertEqual(
            parse_google(source, rows, NOW),
            {"gemini-3.1-pro-preview": (2.0, 12.0)},
        )

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
<tr><td>Mistral Medium 3.5</td><td>↗</td><td>$1.5</td><td>$0.15</td><td>$7.5</td></tr>
<tr><td>Mistral Large 3</td><td>↗</td><td>$0.5</td><td>$0.05</td><td>$1.5</td></tr>
<tr><td>Mistral Small 4</td><td>↗</td><td>$0.15</td><td>$0.015</td><td>$0.6</td></tr></table>
"""
        rows = [
            row("mistralai", "mistral-medium-3.5", "Mistral Medium 3.5"),
            row("mistralai", "mistral-large-2512", "Mistral Large 3"),
            row("mistralai", "mistral-small-4", "Mistral Small 4"),
        ]
        self.assertEqual(
            parse_mistral(source, rows, NOW),
            {
                "mistral-medium-3.5": (1.5, 7.5),
                "mistral-large-2512": (0.5, 1.5),
                "mistral-small-4": (0.15, 0.6),
            },
        )

    def test_mistral_sale_uses_active_uncached_standard_prices(self) -> None:
        source = """
<table><tr><td><a>Mistral Large 4 <span>↗</span></a><span>Sale price</span></td>
<td><del><span>Original price: </span>$1.36</del><ins><span>Sale price: </span>$0.68</ins></td>
<td><del><span>Original price: </span>$0.14</del><ins><span>Sale price: </span>$0.07</ins></td>
<td><del><span>Original price: </span>$4.18</del><ins><span>Sale price: </span>$2.09</ins></td></tr>
<tr><td>Mistral Medium 3.5</td><td>$1.5</td><td>$0.15</td><td>$7.5</td></tr></table>
"""
        rows = [row("mistralai", "mistral-large-4", "Mistral Large 4")]
        self.assertEqual(parse_mistral(source, rows, NOW), {"mistral-large-4": (0.68, 2.09)})

    def test_mistral_tracks_standard_prices_after_sale_ends(self) -> None:
        source = "<table><tr><td>Mistral Large 4 <span>↗</span></td><td>$1.36</td><td>$0.14</td><td>$4.18</td></tr></table>"
        rows = [row("mistralai", "mistral-large-4", "Mistral Large 4")]
        self.assertEqual(parse_mistral(source, rows, NOW), {"mistral-large-4": (1.36, 4.18)})

    def test_mistral_rejects_ambiguous_active_prices(self) -> None:
        source = "<table><tr><td>Mistral Large 4</td><td>$1.36 $0.68</td><td>$0.07</td><td>$2.09</td></tr></table>"
        rows = [row("mistralai", "mistral-large-4", "Mistral Large 4")]
        with self.assertRaisesRegex(OfficialSourceError, "input price ambiguous"):
            parse_mistral(source, rows, NOW)

    def test_moonshot_json_ld_copy(self) -> None:
        source = "Kimi K3 API pricing is calculated based on token usage. Input tokens are billed at $3.00 per 1M tokens on a cache miss. Output tokens are billed at $15.00 per 1M tokens."
        rows = [row("moonshotai", "kimi-k3", "Kimi K3")]
        self.assertEqual(parse_moonshot(source, rows, NOW), {"kimi-k3": (3.0, 15.0)})

    def test_moonshot_international_homepage(self) -> None:
        source = """
<h2>Latest Models</h2><h3>K3</h3>
<p>Kimi K3 is Kimi's most capable flagship model to date.</p>
        <span>Input</span><span>$3.00 / MTok</span>
        <span>Output</span><span>$15.00 / MTok</span>
        <span>Cache Write</span><span>$3.00 / MTok</span>
        <span>Cache Hit</span><span>$0.30 / MTok</span>
<h3>K2.7 Code</h3>
"""
        rows = [row("moonshotai", "kimi-k3", "Kimi K3")]
        self.assertEqual(parse_moonshot(source, rows, NOW), {"kimi-k3": (3.0, 15.0)})

    def test_moonshot_current_cards_keep_three_exact_tariffs_distinct(self) -> None:
        from pathlib import Path
        source = (Path(__file__).parent/'fixtures/moonshot-home-20261026.html').read_text()
        names = ['kimi-k3', 'kimi-k3.1-pro', 'kimi-k3.1-pro-highspeed']
        rows = [row('moonshotai', name, name) for name in names]
        self.assertEqual(parse_moonshot(source, rows, NOW), dict(zip(names, [(3,15),(2,10),(4,20)])))

    def test_moonshot_missing_output_cannot_borrow_the_next_cards_rate(self) -> None:
        source = '<h3>K3.1 Pro</h3><span>Input</span><span>$2 / MTok</span><h3>K3.1 Pro Highspeed</h3><span>Input</span><span>$4 / MTok</span><span>Output</span><span>$20 / MTok</span>'
        with self.assertRaisesRegex(OfficialSourceError, 'Output price missing'):
            parse_moonshot(source, [row('moonshotai','kimi-k3.1-pro','Kimi K3.1 Pro')], NOW)
        self.assertEqual(parse_moonshot(source, [row('moonshotai','kimi-k3.1-pro-highspeed','Highspeed')], NOW), {'kimi-k3.1-pro-highspeed':(4,20)})

    def test_moonshot_legacy_copy_cannot_verify_a_successor(self) -> None:
        source = 'Kimi K3 API pricing. Input tokens are billed at $3.00. Output tokens are billed at $15.00.'
        with self.assertRaisesRegex(OfficialSourceError, 'exact price card missing'):
            parse_moonshot(source, [row('moonshotai','kimi-k3.1-pro','Kimi K3.1 Pro')], NOW)

    def test_moonshot_conflicting_card_duplicates_are_not_verified(self) -> None:
        source = '<h3>K3</h3><span>Input</span><span>$3 / MTok</span><span>Output</span><span>$15 / MTok</span>'
        with self.assertRaisesRegex(OfficialSourceError, 'ambiguous'):
            parse_moonshot(source+source.replace('$15','$30'), [row('moonshotai','kimi-k3','Kimi K3')], NOW)

    def test_deepseek_table(self) -> None:
        source = """
<table><tr><td>MODEL</td><td>deepseek-v4-flash</td><td>deepseek-v4-pro</td></tr>
<tr><td>1M INPUT TOKENS (CACHE MISS)</td><td>$0.14</td><td>$0.435</td></tr>
<tr><td>1M OUTPUT TOKENS</td><td>$0.28</td><td>$0.87</td></tr></table>
"""
        rows = [
            row("deepseek", "deepseek-v4.1-flash", "DeepSeek V4.1 Flash"),
            row("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro"),
        ]
        self.assertEqual(
            parse_deepseek(source, rows, NOW),
            {
                "deepseek-v4.1-flash": (0.14, 0.28),
                "deepseek-v4-pro": (0.435, 0.87),
            },
        )

    def test_deepseek_uses_peak_rate_from_time_banded_table(self) -> None:
        source = """
<table><tr><td>MODEL VERSION</td><td>DeepSeek-V4.1-Flash</td><td>DeepSeek-V4-Pro</td><td>DeepSeek-V4-Flash-Vision-Exp</td></tr>
<tr><td>1M INPUT TOKENS<br>(CACHE MISS)</td><td>OFF-PEAK</td><td>$0.15</td><td>$0.66</td><td>$0.15</td></tr>
<tr><td>PEAK</td><td>$0.30</td><td>$1.32</td><td>$0.30</td></tr>
<tr><td>1M OUTPUT TOKENS</td><td>OFF-PEAK</td><td>$0.66</td><td>$1.98</td><td>$0.66</td></tr>
<tr><td>PEAK</td><td>$1.20</td><td>$3.96</td><td>$1.20</td></tr>
<tr><td>Concurrency Limit</td><td>2500</td><td>500</td><td>2500</td></tr></table>
"""
        rows = [
            row("deepseek", "deepseek-v4.1-flash", "DeepSeek V4.1 Flash"),
            row("deepseek", "deepseek-v4-pro", "DeepSeek V4 Pro"),
        ]
        self.assertEqual(
            parse_deepseek(source, rows, NOW),
            {
                "deepseek-v4.1-flash": (0.3, 1.2),
                "deepseek-v4-pro": (1.32, 3.96),
            },
        )

    def test_xai_embedded_model_data(self) -> None:
        source = (
            r'{\"name\":\"grok-4.5\",\"promptTextTokenPrice\":\"20000\",\"completionTextTokenPrice\":\"60000\"}'
            r'{\"name\":\"grok-4.5\",\"promptTextTokenPrice\":\"22000\",\"completionTextTokenPrice\":\"66000\"}'
        )
        rows = [row("x-ai", "grok-4.5", "Grok 4.5")]
        self.assertEqual(parse_xai(source, rows, NOW), {"grok-4.5": (2.0, 6.0)})

    def test_xai_markdown_table(self) -> None:
        source = """
| Model | Context | Input / 1M tokens | Cached input / 1M tokens | Output / 1M tokens |
| --- | --- | --- | --- | --- |
| grok-4.7 (< 200k prompt tokens) | 500k | $2.00 | $0.30 | $6.00 |
| grok-4.7 (≥ 200k prompt tokens) | 500k | $4.00 | $0.60 | $12.00 |
"""
        rows = [row("x-ai", "grok-4.7", "Grok 4.7")]
        self.assertEqual(parse_xai(source, rows, NOW), {"grok-4.7": (2.0, 6.0)})

    def test_xai_current_pricing_table(self) -> None:
        source = """
Model | Context | Short context | Long context
Input | Cached | Output | Input | Cached | Output
grok-4.7 Long context >= 200k tokens | 500k | $2.00 | $0.50 | $6.00 | $4.00 | $1.00 | $12.00 |
grok-4.6 Long context >= 200k tokens | 500k | $2.00 | $0.50 | $6.00 | $4.00 | $1.00 | $12.00 |
grok-4.20-0309-reasoning Long context >= 200k tokens | 1M | $1.25 | $0.20 | $2.50 | $2.50 | $0.40 | $5.00 |
"""
        rows = [
            row("x-ai", "grok-4.7", "Grok 4.7"),
            row("x-ai", "grok-4.6", "Grok 4.6"),
            row("x-ai", "grok-4.20-0309-reasoning", "Grok 4.20 Reasoning"),
        ]
        self.assertEqual(
            parse_xai(source, rows, NOW),
            {
                "grok-4.7": (2.0, 6.0),
                "grok-4.6": (2.0, 6.0),
                "grok-4.20-0309-reasoning": (1.25, 2.5),
            },
        )


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

    def test_old_openai_parser_cache_is_not_reused_or_trusted_as_fallback(self):
        self.seed_old_provider_snapshot()
        path = self.state / 'firstparty-last-good.json'
        old = json.loads(path.read_text())
        old['providers']['openai'].pop('parserSchema')
        old['providers']['openai']['prices']['gpt-5.6-luna']['output_mtok'] = .25
        path.write_text(json.dumps(old))
        calls = []
        def fetcher(url, cached):
            calls.append(cached)
            return FetchResult(self.source('0.2', '1.2'))
        rows, _ = refresh_firstparty(self.catalog, state_dir=self.state, now=NOW, fetcher=fetcher)
        self.assertEqual(calls, [{}])
        self.assertEqual(rows[0]['output_mtok'], 1.2)
        path.write_text(json.dumps(old))
        def offline(url, cached): raise OSError('offline')
        rows, report = refresh_firstparty(self.catalog, state_dir=self.state, now=NOW, fetcher=offline)
        self.assertEqual(rows[0]['output_mtok'], 99)  # reviewed cold-start rate, never the corrupt snapshot
        self.assertEqual(report['providers'][0]['status'], 'manual')

    def test_incomplete_304_cache_is_refetched_without_validators(self) -> None:
        refresh_firstparty(
            self.catalog,
            state_dir=self.state,
            now=NOW,
            fetcher=lambda url, cached: FetchResult(self.source("0.20", "1.20"), etag="v1"),
        )
        expanded = [
            row("openai", "gpt-5.6-luna", "GPT-5.6 Luna"),
            row("openai", "gpt-6-astra", "GPT-6 Astra"),
        ]
        full_source = self.source("0.20", "1.20").replace(
            "| gpt-5.6-luna",
            "| gpt-6-astra | $10.00 | $1.00 | $12.50 | $50.00 | $20 | $2 | $25 | $75 |\n| gpt-5.6-luna",
        )
        calls: list[bool] = []

        def fetcher(url: str, cached: dict | None) -> FetchResult:
            calls.append(cached is None)
            return FetchResult(full_source, etag="v2") if cached is None else FetchResult(None, not_modified=True)

        refreshed, report = refresh_firstparty(
            expanded,
            state_dir=self.state,
            now=datetime(2026, 9, 8, 10, tzinfo=timezone.utc),
            fetcher=fetcher,
        )
        self.assertEqual(calls, [False, True])
        self.assertEqual(report["status"], "healthy")
        by_model = {entry["model"]: entry for entry in refreshed}
        self.assertEqual(
            (by_model["gpt-6-astra"]["input_mtok"], by_model["gpt-6-astra"]["output_mtok"]),
            (10.0, 50.0),
        )

    def seed_old_provider_snapshot(self) -> list[dict]:
        catalog = self.catalog + [row("openai", "gpt-6-astra", "GPT-6 Astra")]
        (self.state / "firstparty-last-good.json").write_text(json.dumps({
            "version": 1, "providers": {"openai": {
                "verifiedAt": NOW.isoformat(), "etag": "v1", "parserSchema": PARSER_SCHEMAS["openai"],
                "prices": {"gpt-5.6-luna": {"input_mtok": 0.2, "output_mtok": 1.2}, "gpt-6-astra": {"input_mtok": 10, "output_mtok": 50}},
            }},
        }))
        return catalog

    def test_missing_predecessor_keeps_its_date_while_valid_row_refreshes(self) -> None:
        catalog = self.seed_old_provider_snapshot()
        later = NOW + timedelta(hours=49)
        refreshed, report = refresh_firstparty(catalog, state_dir=self.state, now=later, fetcher=lambda url, cached: FetchResult(self.source("0.10", "0.50"), etag="v2"))
        by_model = {r["model"]: r for r in refreshed}
        self.assertEqual((by_model["gpt-5.6-luna"]["input_mtok"], by_model["gpt-5.6-luna"]["output_mtok"]), (0.1, 0.5))
        self.assertEqual(by_model["gpt-5.6-luna"]["checked"], "2026-08-02")
        self.assertEqual(by_model["gpt-5.6-luna"]["verification_status"], "fresh")
        self.assertEqual(by_model["gpt-6-astra"]["output_mtok"], 50)
        self.assertEqual(by_model["gpt-6-astra"]["checked"], "2026-07-31")
        self.assertEqual(by_model["gpt-6-astra"]["verification_status"], "stale")
        self.assertEqual(report["providers"][0]["freshModelCount"], 1)
        self.assertEqual(report["providers"][0]["status"], "stale")
        saved = json.loads((self.state / "firstparty-last-good.json").read_text())
        self.assertEqual(saved["version"], 2)
        self.assertEqual(saved["providers"]["openai"]["prices"]["gpt-6-astra"]["verifiedAt"], NOW.isoformat())

    def test_new_unverified_row_does_not_erase_valid_sibling(self) -> None:
        catalog = self.catalog + [row("openai", "gpt-6-astra", "GPT-6 Astra")]
        refreshed, report = refresh_firstparty(catalog, state_dir=self.state, now=NOW, fetcher=lambda url, cached: FetchResult(self.source("0.10", "0.50")))
        self.assertEqual(refreshed[0]["output_mtok"], 0.5)
        self.assertEqual(refreshed[0]["verification_status"], "fresh")
        self.assertEqual(refreshed[1]["output_mtok"], 99)
        self.assertEqual(refreshed[1]["checked"], "2026-07-01")
        self.assertEqual(refreshed[1]["verification_status"], "manual")
        self.assertEqual(report["providers"][0]["freshModelCount"], 1)

    def test_304_after_partial_parse_retries_even_with_all_cached_prices(self) -> None:
        catalog = self.seed_old_provider_snapshot()
        refresh_firstparty(catalog, state_dir=self.state, now=NOW + timedelta(hours=1), fetcher=lambda url, cached: FetchResult(self.source("0.10", "0.50"), etag="v2"))
        calls = []
        full = self.source("0.10", "0.50").replace("| gpt-5.6-luna", "| gpt-6-astra | $9 | $1 | $12 | $45 | $18 | $2 | $24 | $70 |\n| gpt-5.6-luna")
        def fetcher(url, cached):
            calls.append(cached is None)
            return FetchResult(None, not_modified=True) if cached is not None else FetchResult(full, etag="v2")
        refreshed, report = refresh_firstparty(catalog, state_dir=self.state, now=NOW + timedelta(hours=2), fetcher=fetcher)
        self.assertEqual(calls, [False, True])
        self.assertEqual(refreshed[1]["output_mtok"], 45)
        self.assertEqual(report["providers"][0]["status"], "fresh")

    def test_offline_fallback_ages_each_model_independently(self) -> None:
        catalog = self.seed_old_provider_snapshot()
        refresh_firstparty(catalog, state_dir=self.state, now=NOW + timedelta(hours=49), fetcher=lambda url, cached: FetchResult(self.source("0.10", "0.50")))
        def offline(url, cached):
            raise OSError("offline")
        refreshed, report = refresh_firstparty(catalog, state_dir=self.state, now=NOW + timedelta(hours=50), fetcher=offline)
        self.assertEqual(refreshed[0]["verification_status"], "last_good")
        self.assertEqual(refreshed[1]["verification_status"], "stale")
        self.assertEqual(refreshed[0]["checked"], "2026-08-02")
        self.assertEqual(refreshed[1]["checked"], "2026-07-31")
        self.assertEqual(report["providers"][0]["freshModelCount"], 0)

    def test_unknown_model_date_never_inherits_fresh_sibling_date(self) -> None:
        catalog = self.seed_old_provider_snapshot()
        path = self.state / "firstparty-last-good.json"
        saved = json.loads(path.read_text())
        saved["version"] = 2
        saved["providers"]["openai"]["prices"]["gpt-6-astra"]["verifiedAt"] = None
        path.write_text(json.dumps(saved))
        refreshed, report = refresh_firstparty(catalog, state_dir=self.state, now=NOW, fetcher=lambda url, cached: FetchResult(self.source("0.10", "0.50")))
        self.assertEqual(refreshed[1]["verification_status"], "stale")
        self.assertEqual(refreshed[1]["checked"], "2026-07-01")
        self.assertIsNone(report["providers"][0]["models"][1]["verifiedAt"])

    def test_complete_304_snapshot_advances_verification_without_refetch(self) -> None:
        refresh_firstparty(self.catalog, state_dir=self.state, now=NOW, fetcher=lambda url, cached: FetchResult(self.source("0.20", "1.20"), etag="v1"))
        calls = []
        def fetcher(url, cached):
            calls.append(cached)
            return FetchResult(None, etag="v1", not_modified=True)
        refreshed, report = refresh_firstparty(self.catalog, state_dir=self.state, now=NOW + timedelta(days=1), fetcher=fetcher)
        self.assertEqual(len(calls), 1)
        self.assertEqual(refreshed[0]["checked"], "2026-08-01")
        self.assertEqual(report["status"], "healthy")


if __name__ == "__main__":
    unittest.main()


class FetchRepresentationTests(unittest.TestCase):
    def test_explicit_html_accept_survives_system_trust_fallback(self):
        from unittest.mock import patch
        from urllib.error import URLError
        from collector.official import fetch_source,FetchResult
        with patch('collector.official.urllib.request.urlopen',side_effect=URLError('TLS failure')) as request, patch('collector.official.fetch_source_with_curl',return_value=FetchResult('<html>table</html>')) as fallback:
            result=fetch_source('https://example.test/pricing',accept='text/html')
        self.assertEqual(request.call_args.args[0].get_header('Accept'),'text/html')
        fallback.assert_called_once_with('https://example.test/pricing',None,accept='text/html')
        self.assertEqual(result.text,'<html>table</html>')
