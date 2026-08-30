import json
import tempfile
import unittest
from datetime import datetime, timezone
from pathlib import Path

from collector.nvidia import apply_verification, parse_support_profiles, refresh, validate_register


def register() -> dict:
    return {
        "generatedAt": "2026-08-29T00:00:00Z",
        "asOf": "2026-08-29",
        "source": "nvidia-nim",
        "status": "fresh",
        "modelCount": 1,
        "sources": [{"label": "Matrix", "sourceUrl": "https://docs.nvidia.com/nim/matrix.html"}],
        "models": [{
            "key": "openai/gpt-oss-20b",
            "display": "gpt-oss-20b",
            "nvidiaModelId": "openai/gpt-oss-20b",
            "lifecycle": "certified-feature",
            "sourceUrl": "https://docs.nvidia.com/nim/matrix.html",
            "catalogUrl": "https://build.nvidia.com/openai/gpt-oss-20b",
            "profileSourceUrl": "https://docs.nvidia.com/nim/matrix.html",
            "profileModel": "gpt-oss-20b",
            "verifiedAt": "2026-08-29",
            "status": "fresh",
            "profilesVerifiedAt": "2026-08-29",
            "profilesStatus": "fresh",
            "profiles": [{
                "id": "tp1-mxfp4-base",
                "tensorParallelism": 1,
                "precision": "MXFP4",
                "lora": False,
                "verifiedGpus": ["NVIDIA-H100-80GB-HBM3"],
            }],
        }],
    }


class NvidiaCollectorTests(unittest.TestCase):
    def test_parses_current_filterable_support_matrix_profiles(self) -> None:
        source = '<tr data-model="gpt-oss-20b" data-gpus="NVIDIA-H100,NVIDIA-H200" data-tp="2" data-precision="MXFP4" data-lora="no">'
        self.assertEqual(parse_support_profiles(source, "gpt-oss-20b"), [{
            "id": "tp2-mxfp4-base",
            "tensorParallelism": 2,
            "precision": "MXFP4",
            "lora": False,
            "verifiedGpus": ["NVIDIA-H100", "NVIDIA-H200"],
        }])

    def test_parses_legacy_optimized_configuration_tables(self) -> None:
        source = '''<section id="qwen3-test"><table>
          <tr><th>GPU</th><th>Precision</th><th>Profile</th><th># of GPUs</th></tr>
          <tr><td>H200 SXM</td><td>BF16</td><td>Throughput</td><td>2, 4</td></tr>
          <tr><td>B200</td><td>BF16</td><td>Throughput</td><td>2</td></tr>
        </table></section>'''
        profiles = parse_support_profiles(source, "qwen3-test")
        self.assertEqual(profiles[0]["tensorParallelism"], 2)
        self.assertEqual(profiles[0]["verifiedGpus"], ["B200", "H200 SXM"])
        self.assertEqual(profiles[0]["optimization"], "Throughput")
        self.assertEqual(profiles[1]["tensorParallelism"], 4)

    def test_verifies_model_ids_despite_markup_and_punctuation(self) -> None:
        payload = validate_register(register())
        updated, reports = apply_verification(
            payload,
            {"https://docs.nvidia.com/nim/matrix.html": '<code>openai/gpt-oss-20b</code><tr data-model="gpt-oss-20b" data-gpus="NVIDIA-H100-80GB-HBM3" data-tp="1" data-precision="MXFP4" data-lora="no">'},
            datetime(2026, 8, 30, tzinfo=timezone.utc),
        )
        self.assertEqual(updated["status"], "fresh")
        self.assertEqual(updated["models"][0]["verifiedAt"], "2026-08-30")
        self.assertEqual(reports[0]["status"], "fresh")

    def test_accepts_an_explicit_source_needle(self) -> None:
        payload = register()
        payload["models"][0]["sourceNeedle"] = "gpt-oss-20b"
        updated, _ = apply_verification(
            payload,
            {"https://docs.nvidia.com/nim/matrix.html": 'Supported: gpt-oss-20b <tr data-model="gpt-oss-20b" data-gpus="NVIDIA-H100-80GB-HBM3" data-tp="1" data-precision="MXFP4" data-lora="no">'},
            datetime(2026, 8, 30, tzinfo=timezone.utc),
        )
        self.assertEqual(updated["status"], "fresh")

    def test_missing_model_uses_stale_record(self) -> None:
        payload = register()
        updated, _ = apply_verification(
            payload,
            {"https://docs.nvidia.com/nim/matrix.html": "different model"},
            datetime(2026, 9, 2, tzinfo=timezone.utc),
        )
        self.assertEqual(updated["status"], "stale")
        self.assertEqual(updated["models"][0]["status"], "stale")

    def test_refresh_writes_feed_and_publish_marker(self) -> None:
        with tempfile.TemporaryDirectory() as temporary:
            root = Path(temporary)
            data_dir = root / "data"
            state_dir = root / "state"
            data_dir.mkdir()
            (data_dir / "deployment.json").write_text(json.dumps(register()), encoding="utf-8")
            result = refresh(
                data_dir=data_dir,
                state_dir=state_dir,
                now=datetime(2026, 8, 30, tzinfo=timezone.utc),
            fetcher=lambda _: 'openai/gpt-oss-20b <tr data-model="gpt-oss-20b" data-gpus="NVIDIA-H100-80GB-HBM3" data-tp="1" data-precision="MXFP4" data-lora="no">',
            )
            self.assertEqual(result, "changed")
            self.assertTrue((state_dir / "publish-pending").exists())
            self.assertEqual(json.loads((data_dir / "deployment.json").read_text())["asOf"], "2026-08-30")


if __name__ == "__main__":
    unittest.main()
