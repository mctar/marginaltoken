from __future__ import annotations

import unittest

from collector.repairs import repair_openai_july_30


class FeedRepairTests(unittest.TestCase):
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
