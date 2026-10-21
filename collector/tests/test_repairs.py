from __future__ import annotations

import unittest

from collector.repairs import repair_openai_july_30, repair_openai_october_20


class FeedRepairTests(unittest.TestCase):
    def october_fixture(self):
        models = [{'key':'openai/gpt-6.1-sol', 'output_mtok':2.5}, {'key':'other/model', 'output_mtok':20}]
        history = [{'key':'openai/gpt-6.1-sol', 'date':'2026-10-20', 'source':'firstparty', 'output_mtok':2.5}]
        changes = [
            {'type':'price', 'key':'openai/gpt-6.1-sol', 'date':'2026-10-20', 'field':'output_mtok', 'from':10, 'to':2.5},
            {'type':'price', 'key':'other/model', 'date':'2026-10-20', 'field':'output_mtok', 'from':10, 'to':20}]
        meta = {'basket':[m['key'] for m in models], 'indexValue':112.5,
                'indexHistory':[{'date':'2026-10-19','value':100}, {'date':'2026-10-20','value':112.5}]}
        return models, history, changes, meta

    def test_october_repair_removes_false_cut_but_preserves_real_price_increase(self):
        models, history, changes, meta = self.october_fixture()
        self.assertTrue(repair_openai_october_20(models, history, changes, meta))
        self.assertEqual(models[0]['output_mtok'], 10)
        self.assertEqual(history[0]['output_mtok'], 10)
        self.assertIn('correction', history[0])
        self.assertEqual([e['key'] for e in changes], ['other/model'])
        self.assertEqual(meta['indexValue'], 150)
        self.assertEqual(meta['indexHistory'][-1]['value'], 150)
        self.assertFalse(repair_openai_october_20(models, history, changes, meta))

    def test_october_repair_refuses_unknown_index_paths_before_mutating_data(self):
        import copy
        for change in ['price', 'index', 'basket']:
            models, history, changes, meta = self.october_fixture()
            if change == 'price': models[0]['output_mtok'] = 12
            if change == 'index': meta['indexValue'] = 105
            if change == 'basket': changes.append({'type':'basket','date':'2026-10-21'})
            before = copy.deepcopy((models, history, changes, meta))
            with self.assertRaises(ValueError):
                repair_openai_october_20(models, history, changes, meta)
            self.assertEqual((models, history, changes, meta), before)

    def test_openai_repricing_repair_is_correct_and_idempotent(self) -> None:
        models = [
            {"key": "openai/gpt-5.6-luna", "input_mtok": 1.0, "output_mtok": 6.0},
            {"key": "openai/gpt-5.6-terra", "input_mtok": 2.5, "output_mtok": 15.0},
        ]
        history = [
            {"key": "openai/gpt-5.6-luna", "date": "2026-07-29", "input_mtok": 0.5, "output_mtok": 3.0},
            {"key": "openai/gpt-5.6-luna", "date": "2026-07-30", "input_mtok": 1.0, "output_mtok": 6.0},
            {"key": "openai/gpt-5.6-terra", "date": "2026-07-29", "input_mtok": 1.25, "output_mtok": 7.5},
            {"key": "openai/gpt-5.6-terra", "date": "2026-07-30", "input_mtok": 2.5, "output_mtok": 15.0},
        ]
        changes = [
            {
                "type": "price",
                "date": "2026-07-30",
                "key": "openai/gpt-5.6-luna",
                "display": "GPT-5.6 Luna",
                "field": "input_mtok",
                "from": 0.5,
                "to": 1.0,
                "pct": 100.0,
            }
        ]

        self.assertTrue(repair_openai_july_30(models, history, changes))
        self.assertEqual((models[0]["input_mtok"], models[0]["output_mtok"]), (0.2, 1.2))
        self.assertEqual((history[0]["input_mtok"], history[0]["output_mtok"]), (1.0, 6.0))
        self.assertEqual((history[1]["input_mtok"], history[1]["output_mtok"]), (0.2, 1.2))
        self.assertEqual(len(changes), 4)
        self.assertTrue(all(event["pct"] < 0 for event in changes))
        self.assertFalse(repair_openai_july_30(models, history, changes))


if __name__ == "__main__":
    unittest.main()
