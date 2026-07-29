from __future__ import annotations

import json
import tempfile
import unittest
from pathlib import Path
from unittest.mock import patch

from collector.editorial import (
    EditorialError,
    fact_packet,
    generate_revision,
    main,
    prompt_for,
    validate_copy,
)


class FakeResponse:
    def __init__(self, payload: dict) -> None:
        self.body = json.dumps(payload).encode()

    def __enter__(self) -> "FakeResponse":
        return self

    def __exit__(self, *args: object) -> None:
        return None

    def read(self, _limit: int) -> bytes:
        return self.body


class EditorialTests(unittest.TestCase):
    def setUp(self) -> None:
        self.temp = tempfile.TemporaryDirectory()
        self.root = Path(self.temp.name)
        self.data = self.root / "data"
        self.state = self.root / "state"
        self.data.mkdir()
        self.state.mkdir()
        self.events = [
            {
                "type": "price",
                "date": "2026-07-29",
                "key": "z-ai/glm-5.2",
                "display": "GLM 5.2",
                "field": "input_mtok",
                "from": 0.7462,
                "to": 0.7392,
                "pct": -0.9,
            },
            {
                "type": "price",
                "date": "2026-07-29",
                "key": "z-ai/glm-5.2",
                "display": "GLM 5.2",
                "field": "output_mtok",
                "from": 2.3452,
                "to": 2.3232,
                "pct": -0.9,
            },
        ]
        self.meta = {
            "generatedAt": "2026-07-29T10:56:56Z",
            "asOf": "2026-07-29",
            "indexValue": 100.0,
        }
        (self.data / "meta.json").write_text(json.dumps(self.meta), encoding="utf-8")
        (self.data / "changes.json").write_text(
            json.dumps({"generatedAt": self.meta["generatedAt"], "changes": self.events}),
            encoding="utf-8",
        )
        (self.state / "editorial-input.json").write_text(
            json.dumps({**self.meta, "events": self.events}),
            encoding="utf-8",
        )

    def tearDown(self) -> None:
        self.temp.cleanup()

    def packet(self) -> dict:
        return fact_packet(self.events, self.meta["asOf"], self.meta["indexValue"])

    def test_prompt_marks_facts_as_untrusted_data(self) -> None:
        prompt = prompt_for(self.packet())
        self.assertIn("untrusted data", prompt)
        self.assertIn("GLM 5.2", prompt)
        self.assertIn("$0.7392", prompt)

    def test_validator_accepts_fact_bounded_copy(self) -> None:
        headline, note = validate_copy(
            {
                "headline": "GLM 5.2 Input and Output Prices Fell",
                "note": "Input costs dropped 0.9 percent. Output prices also decreased by 0.9 percent.",
            },
            self.packet(),
        )
        self.assertEqual(headline, "GLM 5.2 Input and Output Prices Fell")
        self.assertTrue(note.endswith("percent."))

    def test_validator_rejects_invented_figure(self) -> None:
        with self.assertRaisesRegex(EditorialError, "unsupported figures"):
            validate_copy(
                {
                    "headline": "GLM 5.2 Prices Fell",
                    "note": "Input costs dropped 12 percent. Output prices also decreased by 0.9 percent.",
                },
                self.packet(),
            )

    def test_validator_rejects_speculative_cause(self) -> None:
        with self.assertRaisesRegex(EditorialError, "speculative"):
            validate_copy(
                {
                    "headline": "GLM 5.2 Prices Fell",
                    "note": "Input costs dropped 0.9 percent because demand weakened. Output prices decreased by 0.9 percent.",
                },
                self.packet(),
            )

    def test_generation_writes_revision_matched_brief(self) -> None:
        generated = {
            "headline": "GLM 5.2 Input and Output Prices Fell",
            "note": "Input costs dropped 0.9 percent. Output prices also decreased by 0.9 percent.",
        }
        response = FakeResponse({"response": json.dumps(generated)})
        with patch("collector.editorial.urllib.request.urlopen", return_value=response):
            result = generate_revision(
                data_dir=self.data,
                state_dir=self.state,
                url="http://ollama.test/api/generate",
                model="gemma4:26b",
                timeout=1,
            )
        self.assertEqual(result, "generated")
        brief = json.loads((self.data / "brief.json").read_text())
        self.assertEqual(brief["generatedAt"], self.meta["generatedAt"])
        self.assertEqual(brief["sourceEventCount"], 2)
        heartbeat = json.loads((self.state / "editorial-heartbeat.json").read_text())
        self.assertEqual(heartbeat["status"], "generated")

    def test_network_failure_exits_zero_and_preserves_last_brief(self) -> None:
        old = {"generatedAt": "old", "headline": "Old", "note": "Old copy. Old copy."}
        (self.data / "brief.json").write_text(json.dumps(old), encoding="utf-8")
        with patch("collector.editorial.urllib.request.urlopen", side_effect=OSError("offline")):
            result = main(
                [
                    "--data-dir",
                    str(self.data),
                    "--state-dir",
                    str(self.state),
                    "--timeout",
                    "1",
                ]
            )
        self.assertEqual(result, 0)
        self.assertEqual(json.loads((self.data / "brief.json").read_text()), old)
        heartbeat = json.loads((self.state / "editorial-heartbeat.json").read_text())
        self.assertEqual(heartbeat["status"], "error")


if __name__ == "__main__":
    unittest.main()
