import hashlib
import unittest
from unittest.mock import patch
from collector.decisions import weights_record, parse_billing, license_file

class DecisionsTests(unittest.TestCase):
    def test_license_links_stay_in_the_exact_repository_and_require_a_listed_file(self):
        payload={'id':'x/model','tags':['license:other'],'siblings':[{'rfilename':'model.safetensors'},{'rfilename':'terms/LICENSE.txt'}]}
        payload['cardData']={'license_link':'https://huggingface.co/x/model/blob/main/terms/LICENSE.txt'}
        self.assertEqual(license_file('x/model',payload),'terms/LICENSE.txt')
        for link in ['https://huggingface.co/y/other/blob/main/terms/LICENSE.txt',
                     'https://example.com/x/model/blob/main/terms/LICENSE.txt',
                     'https://huggingface.co@evil.test/x/model/blob/main/terms/LICENSE.txt',
                     'https://huggingface.co/x/model/blob/main/MISSING',
                     'https://huggingface.co/x/model/blob/main/../terms/LICENSE.txt']:
            with self.subTest(link=link):
                payload['cardData']['license_link']=link
                self.assertIsNone(license_file('x/model',payload))
                self.assertEqual(weights_record('x/model',payload,'now')['licenseUrl'],'https://huggingface.co/x/model')
        payload['siblings'].append({'rfilename':'LICENSE.txt'})
        self.assertEqual(license_file('x/model',payload),'LICENSE.txt')

    def test_reviewed_name_requires_matching_license_bytes_and_keeps_custom_classification(self):
        terms=b'Example Model License 1.0\nCustom terms.'
        payload={'id':'x/model','tags':['license:other'],'siblings':[{'rfilename':'model.safetensors'},{'rfilename':'LICENSE.txt'}]}
        review={'licenseId':'other','licenseFile':'LICENSE.txt','licenseName':'Example Model License 1.0','licenseSha256':hashlib.sha256(terms).hexdigest()}
        with patch('collector.decisions.WEIGHTS_REVIEWS',{'x/model':review}):
            verified=weights_record('x/model',payload,'now',terms)
            self.assertEqual(verified['licenseName'],'Example Model License 1.0')
            self.assertEqual(verified['licenseClass'],'custom')
            self.assertEqual(weights_record('x/model',payload,'now',b'Changed terms')['licenseName'],'other')
            self.assertEqual(weights_record('x/model',payload,'now')['licenseName'],'other')
            payload['tags']=['license:mit']
            self.assertEqual(weights_record('x/model',payload,'now',terms)['licenseName'],'mit')

    def test_old_unexpired_weights_cache_refreshes_and_reads_license_at_payload_revision(self):
        import io,json,tempfile
        from pathlib import Path
        from datetime import datetime,timezone
        from collector.decisions import collect, WEIGHTS_SCHEMA
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir();(root/'collector/state').mkdir(parents=True)
            (root/'data/prices.json').write_text(json.dumps({'models':[{'key':'x/model','provider':'x','huggingFaceId':'x/model'}]}))
            payload={'id':'x/model','sha':'a'*40,'tags':['license:other'],'siblings':[{'rfilename':'model.safetensors'},{'rfilename':'LICENSE.txt'}]}
            previous=weights_record('x/model',payload,'2026-10-15T00:00:00Z');previous.pop('reviewedLicenseSha256', None)
            (root/'collector/state/decisions-cache.json').write_text(json.dumps({'weights':{'x/model':previous},'billing':{}}))
            terms=b'Example Model License 1.0'
            review={'licenseId':'other','licenseFile':'LICENSE.txt','licenseName':'Example Model License 1.0','licenseSha256':hashlib.sha256(terms).hexdigest()}
            with patch('collector.decisions.WEIGHTS_REVIEWS',{'x/model':review}),patch('collector.decisions.fetch_source',side_effect=OSError('offline')),patch('collector.decisions.urllib.request.urlopen',side_effect=[io.BytesIO(json.dumps(payload).encode()),io.BytesIO(terms)]) as fetch:
                collect(root,datetime(2026,10,15,1,tzinfo=timezone.utc))
            self.assertEqual(fetch.call_count,2)
            self.assertIn('/raw/'+'a'*40+'/LICENSE.txt',fetch.call_args_list[1].args[0].full_url)
            record=json.loads((root/'data/decisions.json').read_text())['models'][0]['weights']
            self.assertEqual(record['licenseName'],'Example Model License 1.0')
            self.assertEqual(record['metadataSchema'],WEIGHTS_SCHEMA)

    def test_exact_repository_and_weight_file_required(self):
        with self.assertRaises(ValueError):weights_record('x/model',{'id':'x/other','siblings':[{'rfilename':'model.safetensors'}]},'now')
        with self.assertRaises(ValueError):weights_record('x/model',{'id':'x/model','siblings':[{'rfilename':'config.json'},{'rfilename':'optimizer.bin'}]},'now')
        record=weights_record('x/model',{'id':'x/model','tags':['license:mit'],'siblings':[{'rfilename':'model.safetensors'},{'rfilename':'LICENSE'}]},'now')
        self.assertEqual(record['licenseClass'],'permissive')
        self.assertTrue(record['licenseUrl'].endswith('/LICENSE'))
    def test_custom_and_ambiguous_terms_are_not_permissive(self):
        for tags,expected in [(['license:llama3'],'custom'),(['license:mit','license:apache-2.0'],'unknown'),([], 'unknown')]:
            r=weights_record('x/m',{'id':'x/m','tags':tags,'gated':'auto','siblings':[{'rfilename':'model.safetensors'}]},'now')
            self.assertEqual(r['licenseClass'],expected);self.assertTrue(r['gated'])
    def test_openai_exact_model_and_four_prices_per_context_tier(self):
        source='''### Standard pricing data
| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| sample | $2 | $0.2 | $2.5 | $10 | $4 | $0.4 | $5 | $15 |
### Batch pricing data
| Model | Short context input | Short context cached input | Short context cache writes | Short context output | Long context input | Long context cached input | Long context cache writes | Long context output |
| sample | $1 | $0.1 | $1.25 | $5 | $2 | $0.2 | $2.5 | $7.5 |
'''
        r=parse_billing('openai',source,[{'key':'openai/sample'},{'key':'openai/sample-plus'}])
        self.assertNotIn('openai/sample-plus',r)
        plans=r['openai/sample'];self.assertEqual(len(plans),4)
        self.assertEqual(plans[0]['cache_write_mtok'],2.5);self.assertEqual(plans[-1]['output_mtok'],7.5)
    def test_claude_cache_and_batch_stack_without_confusing_output_column(self):
        source='The following table shows pricing for all Claude models: | Model | Base input tokens | 5m cache writes | 1h cache writes | Cache hits and refreshes | Output tokens | | Claude Example | $2 / MTok | $2.5 / MTok | $4 / MTok | $0.2 / MTok | $10 / MTok | Batch processing 50% discount on both input and output tokens. Prompt caching and batch processing discounts apply'
        plans=parse_billing('anthropic',source,[{'key':'anthropic/example','display':'Claude Example'}])['anthropic/example']
        self.assertEqual(plans[0]['output_mtok'],10)
        self.assertEqual(plans[1]['cacheWriteHour_mtok'],2)

    def test_openai_current_cache_durations_and_batch_are_distinct(self):
        from pathlib import Path
        source = (Path(__file__).parent/'fixtures/openai-pricing-20261021.md').read_text()
        plans = parse_billing('openai', source, [{'key': 'openai/gpt-6.1-sol'}])['openai/gpt-6.1-sol']
        self.assertEqual([p['output_mtok'] for p in plans], [10, 15, 5, 7.5])
        self.assertEqual([p['cacheWrite30Minute_mtok'] for p in plans], [2.5, 5, 1.25, 2.5])
        self.assertEqual([p['cacheWrite12Hour_mtok'] for p in plans], [5, 10, 2.5, 5])
        self.assertTrue(all('cache_write_mtok' not in p and 'cacheWriteHour_mtok' not in p for p in plans))

    def test_openai_new_schema_refreshes_a_recent_billing_snapshot(self):
        import tempfile, json
        from pathlib import Path
        from datetime import datetime, timezone
        from unittest.mock import patch
        from collector.decisions import collect, OPENAI_BILLING_SCHEMA
        from collector.official import FetchResult
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); (root/'data').mkdir(); (root/'collector/state').mkdir(parents=True)
            (root/'data/prices.json').write_text(json.dumps({'models': [{'key':'openai/gpt-6.1-sol','provider':'openai'}]}))
            previous = {'plans': {}, 'verifiedAt': '2026-10-21T08:00:00Z', 'sourceUrl': 'https://example.com', 'status':'fresh'}
            cachepath = root/'collector/state/decisions-cache.json'
            cachepath.write_text(json.dumps({'weights':{},'billing':{'openai':previous}}))
            source = (Path(__file__).parent/'fixtures/openai-pricing-20261021.md').read_text()
            with patch('collector.decisions.fetch_source', return_value=FetchResult(source)):
                collect(root, datetime(2026,10,21,9,tzinfo=timezone.utc))
            saved = json.loads(cachepath.read_text())['billing']['openai']
            self.assertEqual(saved['parserSchema'], OPENAI_BILLING_SCHEMA)
            self.assertEqual(saved['verifiedAt'], '2026-10-21T09:00:00Z')
            self.assertEqual(saved['plans']['openai/gpt-6.1-sol'][0]['output_mtok'], 10)
    def test_moonshot_exact_models_and_cache_retention_prices(self):
        from pathlib import Path
        source=(Path(__file__).parent/'fixtures/moonshot-billing-20261026.txt').read_text()
        plans=parse_billing('moonshotai',source,[{'key':'moonshotai/kimi-k3'},{'key':'moonshotai/kimi-k3.1-pro'},{'key':'moonshotai/kimi-k3.1-pro-extra'}])
        self.assertEqual(set(plans), {'moonshotai/kimi-k3','moonshotai/kimi-k3.1-pro'})
        pro, fast = plans['moonshotai/kimi-k3.1-pro']
        self.assertEqual([pro[f] for f in ['input_mtok','output_mtok','cached_input_mtok','cache_write_mtok','cacheWriteHour_mtok']], [2,10,.2,2,4])
        self.assertEqual([fast[f] for f in ['input_mtok','output_mtok','cached_input_mtok','cache_write_mtok','cacheWriteHour_mtok']], [4,20,.2,4,8])
        self.assertEqual(plans['moonshotai/kimi-k3'][0]['cacheWriteHour_mtok'],6)

    def test_moonshot_malformed_successor_does_not_erase_valid_predecessor(self):
        from pathlib import Path
        source=(Path(__file__).parent/'fixtures/moonshot-billing-20261026.txt').read_text().replace('`$10.00 / MTok`','`unreported`')
        plans=parse_billing('moonshotai',source,[{'key':'moonshotai/kimi-k3'},{'key':'moonshotai/kimi-k3.1-pro'}])
        self.assertEqual(set(plans), {'moonshotai/kimi-k3'})
        # A column disappearing cannot silently turn a write price into output.
        self.assertEqual(parse_billing('moonshotai',source.replace('children:`1h writes`','children:`Other price`'),[{'key':'moonshotai/kimi-k3'}]),{})

    def test_moonshot_billing_keeps_per_model_fallback_dates(self):
        import tempfile,json
        from pathlib import Path
        from datetime import datetime,timezone
        from collector.decisions import collect,MOONSHOT_BILLING_SCHEMA
        from collector.official import FetchResult
        source=(Path(__file__).parent/'fixtures/moonshot-billing-20261026.txt').read_text()
        models=[{'key':'moonshotai/kimi-k3','provider':'moonshotai'},{'key':'moonshotai/kimi-k3.1-pro','provider':'moonshotai'}]
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir();(root/'collector/state').mkdir(parents=True)
            (root/'data/prices.json').write_text(json.dumps({'models':models}))
            def negotiated(url, *args, **kwargs):
                # The production docs omit DocTable in the Markdown response.
                return FetchResult(source if kwargs.get('accept') == 'text/html' else '# Model pricing: see web table')
            with patch('collector.decisions.fetch_source',side_effect=negotiated):
                collect(root,datetime(2026,10,24,tzinfo=timezone.utc))
            saved=json.loads((root/'data/decisions.json').read_text())['models']
            self.assertEqual(len(saved),2)
            broken=source.replace('`$10.00 / MTok`','`unreported`')
            with patch('collector.decisions.fetch_source',return_value=FetchResult(broken)):
                collect(root,datetime(2026,10,26,tzinfo=timezone.utc))
            cache=json.loads((root/'collector/state/decisions-cache.json').read_text())['billing']['moonshotai']
            self.assertEqual(cache['parserSchema'],MOONSHOT_BILLING_SCHEMA)
            k3=cache['models']['moonshotai/kimi-k3'];pro=cache['models']['moonshotai/kimi-k3.1-pro']
            self.assertEqual((k3['status'],k3['verifiedAt']),('fresh','2026-10-26T00:00:00Z'))
            self.assertEqual((pro['status'],pro['verifiedAt']),('last_good','2026-10-24T00:00:00Z'))
            self.assertEqual(pro['plans'][0]['output_mtok'],10)

    def test_google_long_prompt_and_cache_storage(self):
        source='Gemini Example | example | Standard | Input price | $2.00, prompts <= 200k tokens | $4.00, prompts > 200k tokens | Output price (including thinking tokens) | $10.00, prompts <= 200k tokens | $15.00, prompts > 200k | Context caching price | $0.2 | $0.4 | $4.50 / 1,000,000 tokens per hour (storage price) | Used to improve our products | No | Batch | Input price | $1 | $2 | Output price (including thinking tokens) | $5 | $7.5 | Context caching price | Same as Standard | $0.2 | $0.4 | $4.50 / 1,000,000 tokens per hour (storage price) | Used to improve our products | No | 200k'
        plans=parse_billing('google',source,[{'key':'google/example','display':'Gemini Example'}])['google/example']
        self.assertEqual(plans[0]['maximumPromptTokens'],200000)
        self.assertEqual(plans[1]['minimumPromptTokens'],200001)
        self.assertEqual(plans[-1]['cached_input_mtok'],.4)
        self.assertEqual(plans[0]['cache_storage_mtok_hour'],4.5)
    def test_failed_sources_preserve_dated_last_good_records(self):
        import tempfile,json
        from pathlib import Path
        from datetime import datetime,timezone
        from unittest.mock import patch
        from collector.decisions import collect
        with tempfile.TemporaryDirectory() as directory:
            root=Path(directory);(root/'data').mkdir();(root/'collector/state').mkdir(parents=True)
            (root/'data/prices.json').write_text(json.dumps({'models':[{'key':'openai/example','provider':'openai','display':'Example','huggingFaceId':'x/example'}]}))
            w=weights_record('x/example',{'id':'x/example','tags':['license:mit'],'siblings':[{'rfilename':'model.safetensors'}]},'2026-10-10T00:00:00Z')
            b={'plans':{'openai/example':[{'id':'standard','label':'Standard','input_mtok':1,'output_mtok':2}]},'sourceUrl':'https://example.test/pricing','verifiedAt':'2026-10-10T00:00:00Z','status':'fresh'}
            (root/'collector/state/decisions-cache.json').write_text(json.dumps({'weights':{'x/example':w},'billing':{'openai':b}}))
            with patch('collector.decisions.urllib.request.urlopen',side_effect=OSError('offline')),patch('collector.decisions.fetch_source',side_effect=OSError('offline')):
                collect(root,datetime(2026,10,12,tzinfo=timezone.utc))
            row=json.loads((root/'data/decisions.json').read_text())['models'][0]
            self.assertEqual(row['weights']['status'],'last_good')
            self.assertEqual(row['billing']['status'],'last_good')
            self.assertEqual(row['billing']['plans'][0]['input_mtok'],1)
            self.assertEqual(row['weights']['verifiedAt'],'2026-10-10T00:00:00Z')
            self.assertTrue((root/'collector/state/publish-pending').exists())
