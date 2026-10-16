import io
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from types import SimpleNamespace
from unittest.mock import patch

from collector.decisions import collect, parse_billing


MODEL = {'key': 'anthropic/claude-opus-5.5', 'provider': 'anthropic', 'display': 'Claude Opus 5.5'}
SOURCE = '''The following table shows pricing for all Claude models:
| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| Claude Opus 5.5 | $4 / MTok | $5 / MTok | $8 / MTok | $0.20 / MTok | $20 / MTok |
Fast mode pricing | Model | Input | Output |
| Claude Opus 5.5 | $8 USD / MTok | $40 USD / MTok |
| Claude Opus 5 / Claude Opus 4.8 | $10 USD / MTok | $50 USD / MTok |
Prompt caching multipliers | apply on top of fast mode pricing
Batch processing 50% discount on both input and output tokens.
Prompt caching and batch processing discounts apply
'''


class OpusFastTests(unittest.TestCase):
    def test_reordered_live_columns_and_combined_haiku_tiers_preserve_tariffs(self):
        source = '''The following table shows pricing for all Claude models:
| Model | Base tokens | Prompt caching | Name | Input | Output | 5m writes | 1h writes | Hits and refreshes |
| Claude Opus 5.5 | Coding and agents | $4 | / MTok | $20 | / MTok | $5 | / MTok | $8 | / MTok | $0.20 | / MTok |
| Claude Haiku 5.5 | Routing | $0.10 | / MTok | for prompts up to 100,000 tokens | $0.50 | / MTok | $0.125 | / MTok | $0.20 | / MTok | $0.01 | / MTok | $0.50 | / MTok | for prompts over 100,000 tokens | $2.50 | / MTok | $0.625 | / MTok | $1 | / MTok | $0.05 | / MTok |
Cloud platform pricing | Claude Opus 5.5 | $400 / MTok | $800 / MTok |
''' + SOURCE[SOURCE.index('Fast mode pricing'):]
        haiku = {'key': 'anthropic/claude-haiku-5.5', 'display': 'Claude Haiku 5.5'}
        plans = parse_billing('anthropic', source, [MODEL, haiku])
        self.assertEqual(plans[MODEL['key']][-1]['cached_input_mtok'], .4)
        short, long, batch_short, batch_long = plans[haiku['key']]
        self.assertEqual((short['input_mtok'], short['output_mtok'], short['cache_write_mtok'], short['maximumPromptTokens']), (.1, .5, .125, 100000))
        self.assertEqual((long['input_mtok'], long['output_mtok'], long['cached_input_mtok'], long['minimumPromptTokens']), (.5, 2.5, .05, 100001))
        self.assertEqual(batch_short['output_mtok'], .25)
        self.assertEqual(batch_long['cacheWriteHour_mtok'], .5)

    def test_qualified_haiku_rows_use_their_boundaries_even_if_reordered(self):
        source = '''The following table shows pricing for all Claude models:
| Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens |
| Claude Haiku 5.5 (for prompts over 100,000 tokens) | $0.50 / MTok | $0.625 / MTok | $1 / MTok | $0.05 / MTok | $2.50 / MTok |
| Claude Haiku 5.5 (for prompts up to 100,000 tokens) | $0.10 / MTok | $0.125 / MTok | $0.20 / MTok | $0.01 / MTok | $0.50 / MTok |
Batch processing
'''
        model = {'key': 'anthropic/claude-haiku-5.5', 'display': 'Claude Haiku 5.5'}
        short, long = parse_billing('anthropic', source, [model])[model['key']]
        self.assertEqual((short['id'], short['maximumPromptTokens']), ('standard', 100000))
        self.assertEqual((long['id'], long['minimumPromptTokens']), ('standard-long-context', 100001))

    def test_fast_is_separate_from_standard_and_batch_with_cache_multipliers(self):
        plans = parse_billing('anthropic', SOURCE, [MODEL])[MODEL['key']]
        self.assertEqual([p['id'] for p in plans], ['standard', 'batch', 'fast'])
        self.assertEqual([(p['input_mtok'], p['output_mtok']) for p in plans], [(4, 20), (2, 10), (8, 40)])
        self.assertEqual([plans[-1][f] for f in ['cached_input_mtok', 'cache_write_mtok', 'cacheWriteHour_mtok']], [.4, 10, 16])
        self.assertIn('switching speeds invalidates', plans[-1]['notes'])
        self.assertIn('No Batch or Priority', plans[-1]['notes'])

    def test_ambiguous_or_missing_fast_row_cannot_borrow_another_models_rate(self):
        row = '| Claude Opus 5.5 | $8 USD / MTok | $40 USD / MTok |'
        for source in [SOURCE.replace(row, ''), SOURCE.replace(row, row + row),
                       SOURCE.replace(row, row.replace('5.5', '5.5 Plus')),
                       SOURCE.replace(row, row.replace('$8 USD', '$8 / $16 USD')),
                       SOURCE.replace('| Model | Input | Output |', '| Model | Output | Input |')]:
            with self.subTest(source=source):
                plans = parse_billing('anthropic', source, [MODEL])[MODEL['key']]
                self.assertEqual([p['id'] for p in plans], ['standard', 'batch'])
                self.assertEqual(plans[0]['output_mtok'], 20)

    def test_missing_multiplier_rule_keeps_explicit_fast_prices_without_guessing_cache(self):
        source = SOURCE.replace('Prompt caching multipliers | apply on top of fast mode pricing', '')
        fast = parse_billing('anthropic', source, [MODEL])[MODEL['key']][-1]
        self.assertEqual(fast['output_mtok'], 40)
        for field in ['cached_input_mtok', 'cache_write_mtok', 'cacheWriteHour_mtok']:
            self.assertNotIn(field, fast)

    def test_publisher_markdown_link_preserves_fast_cache_multiplier_rule(self):
        linked = SOURCE.replace('Prompt caching multipliers |',
                                '[Prompt caching multipliers](https://platform.claude.com/docs/en/about-claude/pricing#prompt-caching)')
        fast = parse_billing('anthropic', linked, [MODEL])[MODEL['key']][-1]
        self.assertEqual([fast[f] for f in ['cached_input_mtok', 'cache_write_mtok', 'cacheWriteHour_mtok']], [.4, 10, 16])
        negated = linked.replace(') apply on top', ') do not apply on top')
        self.assertNotIn('cached_input_mtok', parse_billing('anthropic', negated, [MODEL])[MODEL['key']][-1])

    def test_cached_fast_without_cache_rates_refreshes_once_for_parser_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            state = root / 'collector/state'
            state.mkdir(parents=True)
            (root / 'data/prices.json').write_text(json.dumps({'models': [MODEL]}))
            previous = {'plans': {MODEL['key']: [{'id': 'fast', 'label': 'Fast', 'input_mtok': 8, 'output_mtok': 40}]},
                        'sourceUrl': 'https://platform.claude.com/docs/en/about-claude/pricing', 'verifiedAt': '2026-10-16T00:00:00Z', 'status': 'fresh'}
            (state / 'decisions-cache.json').write_text(json.dumps({'weights': {}, 'billing': {'anthropic': previous}}))
            with patch('collector.decisions.fetch_source', return_value=SimpleNamespace(text=SOURCE)) as fetch:
                collect(root, datetime(2026, 10, 16, 1, tzinfo=timezone.utc))
                collect(root, datetime(2026, 10, 16, 2, tzinfo=timezone.utc))
            anthropic_calls = [call for call in fetch.call_args_list if 'claude' in call.args[0]]
            self.assertEqual(len(anthropic_calls), 1)
            plans = json.loads((root / 'data/decisions.json').read_text())['models'][0]['billing']['plans']
            self.assertEqual(plans[-1]['cached_input_mtok'], .4)

    def test_existing_unexpired_cache_gains_fast_then_failed_refresh_retains_dated_rates(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            state = root / 'collector/state'
            state.mkdir(parents=True)
            (root / 'data/prices.json').write_text(json.dumps({'models': [MODEL]}))
            previous = {'plans': {MODEL['key']: [{'id': 'standard', 'label': 'Standard', 'input_mtok': 4, 'output_mtok': 20}]},
                        'sourceUrl': 'https://platform.claude.com/docs/en/about-claude/pricing', 'verifiedAt': '2026-10-16T00:00:00Z', 'status': 'fresh'}
            (state / 'decisions-cache.json').write_text(json.dumps({'weights': {}, 'billing': {'anthropic': previous}}))
            with patch('collector.decisions.fetch_source', return_value=SimpleNamespace(text=SOURCE)):
                collect(root, datetime(2026, 10, 16, 1, tzinfo=timezone.utc))
            billing = json.loads((root / 'data/decisions.json').read_text())['models'][0]['billing']
            self.assertEqual([p['id'] for p in billing['plans']], ['standard', 'batch', 'fast'])
            with patch('collector.decisions.fetch_source', side_effect=OSError('offline')):
                collect(root, datetime(2026, 10, 18, tzinfo=timezone.utc))
            fallback = json.loads((root / 'data/decisions.json').read_text())['models'][0]['billing']
            self.assertEqual(fallback['status'], 'last_good')
            self.assertEqual(fallback['verifiedAt'], billing['verifiedAt'])
            self.assertEqual(fallback['plans'], billing['plans'])

    def test_html_only_review_does_not_turn_public_gated_metadata_into_a_failed_refresh(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            (root / 'collector/state').mkdir(parents=True)
            repo = 'meta-models/Muse-Spark-Open-816B-A42B'
            (root / 'data/prices.json').write_text(json.dumps({'models': [{'key': 'meta/muse-spark-open', 'provider': 'meta', 'huggingFaceId': repo}]}))
            payload = {'id': repo, 'sha': 'a' * 40, 'gated': 'manual', 'tags': ['license:other'],
                       'cardData': {'license_name': 'muse-model-license'},
                       'siblings': [{'rfilename': 'model.safetensors'}, {'rfilename': 'LICENSE.md'}]}
            with patch('collector.decisions.urllib.request.urlopen', return_value=io.BytesIO(json.dumps(payload).encode())) as request, \
                 patch('collector.decisions.fetch_source', side_effect=OSError('offline')):
                collect(root, datetime(2026, 10, 16, tzinfo=timezone.utc))
            self.assertEqual(request.call_count, 1)
            weights = json.loads((root / 'data/decisions.json').read_text())['models'][0]['weights']
            self.assertTrue(weights['gated'])
            self.assertEqual(weights['status'], 'fresh')
            self.assertEqual(weights['licenseName'], 'muse-model-license')
            self.assertEqual(weights['licenseClass'], 'custom')
