import unittest
from datetime import datetime, timezone

from collector.decisions import parse_billing
from collector.official import OfficialSourceError, parse_qwen
from collector.register import apply_register, firstparty_catalog, read_register


MODEL = {"key": "qwen/qwen4-max", "provider": "qwen"}
FALLBACK = {"key": "qwen/qwen3.8-max-0902", "provider": "qwen", "source": "openrouter"}
NOW = datetime(2026, 11, 16, 10, tzinfo=timezone.utc)
SOURCE = """
<h3>Qwen-Max</h3>
<h4 id="singapore-h4">Singapore</h4>
<table>
<tr><th>Model ID</th><th>Deployment scope</th><th>Mode</th><th>Input tokens per request</th>
<th>Input price (per 1 million tokens)</th>
<th>Output price (per 1 million tokens)<p>Chain of thought + answer</p></th><th>Free quota</th></tr>
<tr><td>qwen4-max<p>Cache price (per million tokens)</p></td><td>International</td>
<td>Non-Thinking and Thinking modes</td><td>0&lt;Token≤1M</td><td>$1.5</td><td>$4.5</td><td>1 million tokens</td></tr>
<tr><td>qwen3.8-max-0902</td><td>International</td>
<td>Non-Thinking and Thinking modes</td><td>0&lt;Token≤1M</td><td>$2</td><td>$6</td><td>1 million tokens</td></tr>
</table>
<p><strong>qwen4-max — Cache price (per million tokens)</strong></p>
<table>
<tr><th>Cache write (5m)</th><th>Cache write (1h)</th><th>Explicit/implicit cache read</th></tr>
<tr><td>$1.875</td><td>$3</td><td>$0.075</td></tr>
</table>
<h4>China (Beijing)</h4><p>qwen4-max costs $1.413 / $4.24.</p>
"""


class QwenTests(unittest.TestCase):
    def test_singapore_price_and_named_cache_rates(self):
        row = {"model": "qwen4-max"}
        self.assertEqual(parse_qwen(SOURCE, [row], NOW), {"qwen4-max": (1.5, 4.5)})
        plan = parse_billing("qwen", SOURCE, [MODEL])[MODEL["key"]][0]
        self.assertEqual((plan["input_mtok"], plan["output_mtok"]), (1.5, 4.5))
        self.assertEqual(
            (plan["cached_input_mtok"], plan["cache_write_mtok"], plan["cacheWriteHour_mtok"]),
            (0.075, 1.875, 3),
        )
        self.assertEqual(plan["maximumOutputTokens"], 262144)

    def test_refuses_preview_different_scope_or_ambiguous_rates(self):
        for source in (
            SOURCE.replace("qwen4-max<p>", "qwen4-max-preview<p>"),
            SOURCE.replace("<td>International</td>", "<td>Global</td>"),
            SOURCE.replace("$4.5", "$4.5 / $6"),
        ):
            with self.assertRaises(OfficialSourceError):
                parse_qwen(source, [{"model": "qwen4-max"}], NOW)
        changed_cache = SOURCE.replace("Explicit/implicit cache read", "Other price")
        self.assertEqual(parse_qwen(changed_cache, [{"model": "qwen4-max"}], NOW), {"qwen4-max": (1.5, 4.5)})
        with self.assertRaises(ValueError):
            parse_billing("qwen", changed_cache, [MODEL])

    def test_promotes_verified_production_and_keeps_0902_fallback(self):
        register = read_register()
        catalog = [{"key": f"{r['provider']}/{r['model']}", "provider": r["provider"]}
                   for r in firstparty_catalog(register) if r["provider"] != "qwen"]
        slot = "slot:qwen-frontier"
        production = {**MODEL, "source": "firstparty", "checked": "2026-11-16"}
        unverified = apply_register(catalog + [dict(FALLBACK), {**production, "verificationStatus": "manual"}],
                                    register, NOW)
        self.assertEqual(unverified["selections"][slot], FALLBACK["key"])
        selected = apply_register(catalog + [dict(FALLBACK), {**production, "verificationStatus": "fresh"}],
                                  register, NOW, unverified["selections"])
        self.assertEqual(selected["selections"][slot], MODEL["key"])
        self.assertEqual(selected["basket"], unverified["basket"])
        fallback = apply_register(catalog + [dict(FALLBACK)], register, NOW, selected["selections"])
        self.assertEqual(fallback["selections"][slot], FALLBACK["key"])
