import unittest
from collector.decisions import weights_record, parse_billing

class DecisionsTests(unittest.TestCase):
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
