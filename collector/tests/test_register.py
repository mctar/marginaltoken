import copy
import unittest
from datetime import datetime, timezone

from collector.collect import normalize_openrouter
from collector.register import apply_register, firstparty_catalog, read_register


class RegisterTests(unittest.TestCase):
    def setUp(self):
        self.register = read_register()
        self.now = datetime(2026, 10, 13, tzinfo=timezone.utc)
        self.models = [{"key": f"{r['provider']}/{r['model']}", "provider": r["provider"],
                        "source": "firstparty", "checked": "2026-10-13", "verificationStatus": "fresh"}
                       for r in firstparty_catalog(self.register)]

    def test_terra_is_reviewed_without_changing_curated_families_or_aliasing_pro(self):
        from collector.register import canonical_key
        result = apply_register(self.models, self.register, self.now)
        self.assertEqual(result['basket']['openai'], 'openai/gpt-6.1-sol')
        self.assertEqual(result['basket']['anthropic'], 'anthropic/claude-opus-5.5')
        base = next(m for m in self.models if m['key']=='openai/gpt-6.1-terra')
        self.assertEqual(base['selectedSlots'], [])
        self.assertEqual(base['apiId'], 'gpt-6.1-terra')
        self.assertEqual(canonical_key('openai/gpt-6.1-terra-pro',self.register),'openai/gpt-6.1-terra-pro')
        self.assertNotIn('apiId',self.register['models']['openai/gpt-6.1-terra-pro'])
        self.assertNotIn('firstparty',self.register['models']['openai/gpt-6.1-terra-pro'])
        from pathlib import Path
        from collector.collect import load_reviewed_firstparty
        self.assertIn('openai/gpt-6.1-terra-pro', load_reviewed_firstparty(Path(__file__).parents[1]/'firstparty-reviewed.json'))

    def test_only_verified_same_family_successor_promotes(self):
        old = "openai/gpt-6.1-sol"
        new = "openai/future-sol"
        self.register["models"][new] = {**copy.deepcopy(self.register["models"][old]), "order": 200}
        row = {**next(m for m in self.models if m["key"] == old), "key": new}
        self.models.append(row)
        row["verificationStatus"] = "manual"
        self.assertEqual(apply_register(self.models, self.register, self.now)["basket"]["openai"], old)
        row["verificationStatus"] = "fresh"
        self.assertEqual(apply_register(self.models, self.register, self.now)["basket"]["openai"], new)
        self.register["models"][new]["family"] = "openai-frontier"
        self.assertEqual(apply_register(self.models, self.register, self.now)["basket"]["openai"], old)

    def test_no_discovery_or_stale_source_changes_policy(self):
        new = "anthropic/future-opus"
        self.register["models"][new] = {**copy.deepcopy(self.register["models"]["anthropic/claude-opus-5.5"]), "order": 200}
        row = {"key": new, "provider": "anthropic", "source": "firstparty", "checked": "2026-10-01", "verificationStatus": "fresh"}
        self.models.append(row)
        result = apply_register(self.models, self.register, self.now)
        self.assertEqual(result["basket"]["anthropic"], "anthropic/claude-opus-5.5")
        self.assertFalse(row["promotionVerified"])

    def test_verified_successor_is_retained_when_its_price_source_fails(self):
        old = "openai/gpt-6.1-sol"
        new = "openai/future-sol"
        self.register["models"][new] = {**copy.deepcopy(self.register["models"][old]), "order": 200, "apiId": "future-sol"}
        row = {**next(m for m in self.models if m["key"] == old), "key": new}
        self.models.append(row)
        promoted = apply_register(self.models, self.register, self.now)
        row["verificationStatus"] = "last_good"
        held = apply_register(self.models, self.register, self.now, promoted["selections"])
        self.assertEqual(held["basket"]["openai"], new)
        self.assertIn("openai-sol", row["selectedSlots"])
        self.assertFalse(row["promotionVerified"])
        self.assertEqual(held["selections"]["slot:openai-sol"], new)
        self.register["models"][new]["stage"] = "experimental"
        self.assertEqual(apply_register(self.models, self.register, self.now, held["selections"])["basket"]["openai"], old)

    def test_clean_older_source_cannot_downgrade_the_reviewed_fallback(self):
        row = next(m for m in self.models if m["key"] == "openai/gpt-6.1-sol")
        row["verificationStatus"] = "manual"
        held = apply_register(self.models, self.register, self.now)
        self.assertEqual(held["basket"]["openai"], "openai/gpt-6.1-sol")

    def test_kimi_pro_promotes_only_after_its_own_fresh_verification(self):
        old='moonshotai/kimi-k3';new='moonshotai/kimi-k3.1-pro'
        pro=next(m for m in self.models if m['key']==new)
        pro['verificationStatus']='manual'
        self.assertEqual(apply_register(self.models,self.register,self.now)['basket']['moonshotai'],old)
        pro['verificationStatus']='fresh'
        selected=apply_register(self.models,self.register,self.now)
        self.assertEqual(selected['basket']['moonshotai'],new)
        self.assertIn('kimi-frontier',pro['selectedSlots'])
        self.assertEqual(self.register['openShortlist'][0][0],old)
        self.assertNotIn('moonshotai/kimi-k3.1-pro-highspeed',self.register['models'])

    def test_alias_deduplicates_but_preserves_route(self):
        raw = lambda key: {"id": key, "pricing": {"prompt": ".000001", "completion": ".000002"}}
        rows = normalize_openrouter({"data": [raw("mistralai/mistral-large-4"), raw("mistralai/mistral-large-4-0")]})
        self.assertEqual(len(rows), 1)
        self.assertEqual(rows[0]["key"], "mistralai/mistral-large-4")
        self.assertEqual(rows[0]["routedId"], "mistralai/mistral-large-4-0")
        self.assertTrue(rows[0]["sourceUrl"].endswith("mistral-large-4-0"))

    def test_deprecated_is_not_alias(self):
        from collector.register import canonical_key
        self.assertEqual(canonical_key("google/gemini-3.7-flash"), "google/gemini-3.7-flash")
        self.assertEqual(self.register["models"]["google/gemini-3.7-flash"]["lifecycle"]["successor"], "google/gemini-3.8-flash")

    def test_archived_official_quotes_leave_active_verification_but_retain_identity(self):
        active = {f"{r['provider']}/{r['model']}" for r in firstparty_catalog(self.register)}
        for key in ['google/gemini-3.7-flash', 'google/gemini-3.5-flash']:
            self.assertNotIn(key, active)
            self.assertIn('firstparty', self.register['models'][key])
            self.assertEqual(self.register['models'][key]['lifecycle']['status'], 'deprecated')
        self.assertIn('google/gemini-3.8-flash', active)
        self.assertIn('google/gemini-3.6-flash', active)

    def test_active_model_cannot_be_hidden_as_historical(self):
        import json, tempfile
        from pathlib import Path
        self.register['models']['openai/gpt-6.1-sol']['firstpartyHistorical'] = True
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory)/'register.json'
            path.write_text(json.dumps(self.register))
            with self.assertRaisesRegex(ValueError, 'Historical pricing'):
                read_register(path)
