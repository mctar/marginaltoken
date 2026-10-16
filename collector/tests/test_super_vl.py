import io
import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path
from unittest.mock import patch

from collector.collect import normalize_openrouter
from collector.decisions import collect

KEY = 'nvidia/nemotron-3.5-super-vl'
OLD = 'nvidia/NVIDIA-Nemotron-3.5-Super-VL'
REPO = 'nvidia/NVIDIA-Nemotron-3.5-Super-VL-120B-A12B-BF16'


def routed(key=KEY, repository=OLD):
    return {'id': key, 'name': 'NVIDIA: Nemotron 3.5 Super VL',
            'pricing': {'prompt': '0.00000015', 'completion': '0.0000005'},
            'hugging_face_id': repository, 'context_length': 1048576,
            'top_provider': {'max_completion_tokens': 235929},
            'architecture': {'input_modalities': ['text', 'image', 'video'], 'output_modalities': ['text']},
            'supported_parameters': ['tools', 'reasoning']}


class SuperVlIdentityTests(unittest.TestCase):
    def test_reviewed_identity_repairs_only_the_exact_broken_model_repository_pair(self):
        model = normalize_openrouter({'data': [routed()]})[0]
        self.assertEqual(model['huggingFaceId'], REPO)
        self.assertEqual(model['reportedHuggingFaceId'], OLD)
        self.assertTrue(model['huggingFaceIdSource'].startswith('https://github.com/NVIDIA-NeMo/'))
        self.assertEqual((model['routedId'], model['input_mtok'], model['output_mtok']), (KEY, .15, .5))
        self.assertEqual((model['context'], model['maxOutputTokens']), (1048576, 235929))
        self.assertEqual(model['inputModalities'], ['image', 'text', 'video'])
        self.assertFalse(model['indexEligible'])
        for key, repository in [(KEY, REPO), (KEY, REPO.replace('BF16', 'NVFP4')),
                                (KEY, 'nvidia/Unknown-Future-Checkpoint'), (KEY, None),
                                ('nvidia/nemotron-3.5-bolt', OLD)]:
            with self.subTest(key=key, repository=repository):
                untouched = normalize_openrouter({'data': [routed(key, repository)]})[0]
                self.assertEqual(untouched.get('huggingFaceId'), repository)
                self.assertNotIn('reportedHuggingFaceId', untouched)

    def test_repaired_identity_gets_independent_verification_without_a_raw_license_download(self):
        payload = {'id': REPO, 'sha': 'a' * 40, 'gated': False, 'tags': ['license:other'],
                   'cardData': {'license_name': 'openmdw-1.1', 'license_link': 'https://openmdw.ai/license/1-1/'},
                   'siblings': [{'rfilename': 'model-00001-of-00063.safetensors'}]}
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            (root / 'collector/state').mkdir(parents=True)
            models = normalize_openrouter({'data': [routed()]})
            (root / 'data/prices.json').write_text(json.dumps({'models': models}))
            with patch('collector.decisions.urllib.request.urlopen', return_value=io.BytesIO(json.dumps(payload).encode())) as request, \
                 patch('collector.decisions.fetch_source', side_effect=OSError('offline')):
                collect(root, datetime(2026, 10, 16, 10, tzinfo=timezone.utc))
            self.assertEqual(request.call_count, 1)
            self.assertEqual(request.call_args.args[0].full_url, 'https://huggingface.co/api/models/' + REPO)
            weights = json.loads((root / 'data/decisions.json').read_text())['models'][0]['weights']
            self.assertEqual((weights['repository'], weights['status'], weights['licenseName']), (REPO, 'fresh', 'openmdw-1.1'))
            self.assertTrue(weights['weightsAvailable'])
            self.assertFalse(weights['gated'])
            self.assertEqual(weights['licenseClass'], 'custom')

    def test_reviewed_mapping_alone_does_not_establish_weight_availability(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'data').mkdir()
            (root / 'collector/state').mkdir(parents=True)
            (root / 'data/prices.json').write_text(json.dumps({'models': normalize_openrouter({'data': [routed()]})}))
            with patch('collector.decisions.urllib.request.urlopen', side_effect=OSError('offline')), \
                 patch('collector.decisions.fetch_source', side_effect=OSError('offline')):
                collect(root, datetime(2026, 10, 16, 10, tzinfo=timezone.utc))
            self.assertEqual(json.loads((root / 'data/decisions.json').read_text())['models'], [])
