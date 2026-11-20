import unittest

from collector.watch_coverage import update_sources


class CoverageTests(unittest.TestCase):
    def test_later_failure_preserves_access_success_and_editorial_cutoff(self):
        url = "https://example.org/models"
        saved = {"sources": {url: {"reviewedThrough": "2026-11-10"}}}
        rows = [
            {"url": url, "status": "failed", "checkedAt": "2026-11-20T07:00:00Z"},
            {"url": url, "status": "checked", "checkedAt": "2026-11-19T07:00:00Z"},
        ]
        result = update_sources({"sourceChecks": rows}, saved)["sources"][url]
        self.assertEqual(result["accessStatus"], "failed")
        self.assertTrue(result["lastAccessSuccess"].startswith("2026-11-19"))
        self.assertEqual(result["reviewedThrough"], "2026-11-10")
