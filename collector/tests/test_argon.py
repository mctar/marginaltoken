import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from collector.decisions import collect, parse_billing
from collector.official import FetchResult, parse_google
from collector.register import apply_register, firstparty_catalog, read_register


def pricing_source(dated=True):
    source = 'Gemini 4 Argon | gemini-4-argon | Note: | Gemini 4 Argon is not available on the Free tier. '
    for mode, rates in [('Standard', [2, 10, .1]), ('Batch', [1, 5, .05]), ('Flex', [1, 5, .05]), ('Priority', [3.6, 18, .18])]:
        source += f'| {mode} | Free Tier | Paid Tier, per 1M tokens in USD '
        for label, value in zip(['Input price', 'Output price (including thinking tokens)', 'Context caching price'], rates):
            source += f'| {label} | Not available | '
            source += (f'${value} through November 30, 2026. | ${value*2} starting December 1, 2026. '
                       if dated else f'${value*2} ')
        source += '| Implicit caching only (explicit caching is not supported). | Used to improve our products | No '
    # A sibling's dates and rates must never be read as Argon pricing.
    return source + '| Gemini 3.8 Flash | gemini-3.8-flash | Standard | Input price | $0.75 | Output price | $3.75 | Used to improve | No'


MODEL = {'key': 'google/gemini-4-argon', 'provider': 'google', 'display': 'Gemini 4 Argon'}


class ArgonTests(unittest.TestCase):
    def test_four_modes_keep_current_and_scheduled_rates_separate(self):
        plans = parse_billing('google', pricing_source(), [MODEL])[MODEL['key']]
        self.assertEqual([p['id'] for p in plans], ['standard', 'batch', 'flex', 'priority'])
        self.assertEqual([p['output_mtok'] for p in plans], [10, 5, 5, 18])
        self.assertEqual([p['scheduledRates'][0]['output_mtok'] for p in plans], [20, 10, 10, 36])
        self.assertEqual(plans[0]['validThrough'], '2026-11-30')
        self.assertEqual(plans[0]['scheduledRates'][0]['effectiveFrom'], '2026-12-01')
        self.assertEqual(plans[0]['scheduledRates'][0]['cached_input_mtok'], .2)
        self.assertEqual(plans[0]['cacheMode'], 'implicit')
        self.assertNotIn('cache_write_mtok', plans[0])
        self.assertNotIn('cache_storage_mtok_hour', plans[0])

    def test_ambiguous_dates_and_changed_cache_policy_fail_closed(self):
        for source in [pricing_source().replace('$20 starting December 1', '$20 starting December 2'),
                       pricing_source().replace('through November 30', 'through November 29'),
                       pricing_source().replace('Implicit caching only', 'Explicit caching available'),
                       pricing_source().replace('$2 through', '$2 / $3 through')]:
            with self.subTest(source=source[:80]), self.assertRaises(ValueError):
                parse_billing('google', source, [MODEL])

    def test_plain_post_promotion_prices_are_supported(self):
        plans = parse_billing('google', pricing_source(False), [MODEL])[MODEL['key']]
        self.assertEqual(plans[0]['input_mtok'], 4)
        self.assertEqual(plans[0]['output_mtok'], 20)
        self.assertNotIn('scheduledRates', plans[0])

    def test_tape_rolls_at_effective_date_without_changing_basket_family(self):
        register = read_register()
        rows = firstparty_catalog(register)
        argon = next(r for r in rows if r['model'] == 'gemini-4-argon')
        self.assertEqual(parse_google(pricing_source(), [argon], datetime(2026,11,30,23,59,tzinfo=timezone.utc))['gemini-4-argon'], (2,10))
        self.assertEqual(parse_google(pricing_source(), [argon], datetime(2026,12,1,tzinfo=timezone.utc))['gemini-4-argon'], (4,20))
        models = [{'key': f"{r['provider']}/{r['model']}", 'provider': r['provider'], 'source': 'firstparty', 'checked': '2026-10-14', 'verificationStatus': 'fresh'} for r in rows]
        models.append({'key':'qwen/qwen3.8-max-0902','provider':'qwen','source':'openrouter'})
        result = apply_register(models, register, datetime(2026,10,14,tzinfo=timezone.utc), {'slot:qwen-frontier':'qwen/qwen3.7-max'})
        self.assertEqual(result['selections']['slot:google-argon'], MODEL['key'])
        self.assertEqual(result['selections']['slot:qwen-frontier'], 'qwen/qwen3.8-max-0902')
        self.assertEqual(result['basket']['google'], 'google/gemini-3.8-flash')
        self.assertEqual(result['basket']['openai'], 'openai/gpt-6.1-sol')
        self.assertEqual(result['basket']['anthropic'], 'anthropic/claude-opus-5.5')
        qwen = models[-1]
        self.assertEqual(qwen['apiId'], 'qwen3.8-max-0902')
        self.assertEqual(qwen['source'], 'openrouter')
        self.assertFalse(qwen['promotionVerified'])

    def test_new_argon_record_refreshes_an_unexpired_google_cache(self):
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir();(root/'collector/state').mkdir(parents=True)
            (root/'data/prices.json').write_text(json.dumps({'models':[MODEL]}))
            previous={'plans':{},'verifiedAt':'2026-10-14T00:00:00Z','status':'fresh','sourceUrl':'https://ai.google.dev/gemini-api/docs/pricing'}
            (root/'collector/state/decisions-cache.json').write_text(json.dumps({'weights':{},'billing':{'google':previous}}))
            with patch('collector.decisions.fetch_source',return_value=FetchResult(text=pricing_source())):
                collect(root,datetime(2026,10,14,1,tzinfo=timezone.utc))
            feed=json.loads((root/'data/decisions.json').read_text())
            self.assertEqual(len(feed['models'][0]['billing']['plans']),4)

