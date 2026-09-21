from __future__ import annotations

from collections import Counter
import json
import unittest
from unittest.mock import patch

from dram_tracker.collect import collect_memorymarket

BASE = "https://www.memorymarket.com/price/"
FIRST = BASE + "ews/100001"
SECOND = BASE + "ews/100002"
CATEGORY = BASE + "ddr"
COLLECTED = "2026-09-21T04:00:00Z"


def page(title: str, *, average: float = 5) -> str:
    points = [{"date": "2026-09-15", "category": kind, "value": value}
              for kind, value in (("Low", 4), ("Avg", average), ("High", 6))]
    return f'<title>{title} | MemoryMarket</title><script>const data = {json.dumps(points)};</script>'


class CollectionRetryTests(unittest.TestCase):
    def collect(self, fetch):
        with patch("dram_tracker.collect.memorymarket.CATEGORIES", ["ddr"]), \
             patch("dram_tracker.collect.fetch_text", side_effect=fetch) as mocked, \
             patch("dram_tracker.collect.time.sleep"):
            observations, status = collect_memorymarket(fixture_dir=None, collected_at=COLLECTED, limit_products=None, delay=0.5)
        return observations, status, mocked.call_args_list

    def provider(self, *, initial_network_failure=False, final_network_failure=False, bad_first_page=False):
        calls = Counter()

        def fetch(url, **kwargs):
            calls[url] += 1
            if url == CATEGORY:
                return '<a href="/price/ews/100001">DDR4 8Gb</a><a href="/price/ews/100002">DDR5 16Gb</a>'
            if url == FIRST:
                if (initial_network_failure and calls[url] == 1) or final_network_failure:
                    raise RuntimeError("failed to fetch: The read operation timed out")
                return page("DDR4 8Gb", average=9 if bad_first_page else 5)
            if url == SECOND:
                return page("DDR5 16Gb")
            raise AssertionError(f"unexpected URL {url}")

        return fetch

    def test_failed_fetch_retries_once_after_other_products_and_passes_strict_parser(self):
        rows, status, calls = self.collect(self.provider(initial_network_failure=True))
        self.assertEqual([call.args[0] for call in calls], [CATEGORY, FIRST, SECOND, FIRST])
        self.assertEqual(calls[-1].kwargs, {"timeout": 60, "retries": 0})
        self.assertTrue(status["ok"])
        self.assertEqual(status["warnings"], [])
        self.assertEqual(status["observation_count"], 2)
        self.assertEqual({row["product_id"] for row in rows}, {"memorymarket-100001", "memorymarket-100002"})
        self.assertTrue(all(row["collected_at"] == COLLECTED and row["values"]["average"] == 5 for row in rows))

    def test_final_network_failure_stays_incomplete_without_duplicate_warnings(self):
        rows, status, calls = self.collect(self.provider(final_network_failure=True))
        self.assertEqual([call.args[0] for call in calls], [CATEGORY, FIRST, SECOND, FIRST])
        self.assertFalse(status["ok"])
        self.assertEqual(len(status["warnings"]), 1)
        self.assertIn("after deferred fetch retry", status["warnings"][0])
        self.assertEqual([row["product_id"] for row in rows], ["memorymarket-100002"])

    def test_parser_failure_is_not_retried(self):
        rows, status, calls = self.collect(self.provider(bad_first_page=True))
        self.assertEqual([call.args[0] for call in calls], [CATEGORY, FIRST, SECOND])
        self.assertFalse(status["ok"])
        self.assertIn("price range", status["warnings"][0])
        self.assertEqual(len(rows), 1)

    def test_invalid_page_after_transport_recovery_still_blocks_candidate(self):
        rows, status, calls = self.collect(self.provider(initial_network_failure=True, bad_first_page=True))
        self.assertEqual([call.args[0] for call in calls], [CATEGORY, FIRST, SECOND, FIRST])
        self.assertFalse(status["ok"])
        self.assertEqual(len(status["warnings"]), 1)
        self.assertIn("price range", status["warnings"][0])
        self.assertEqual(len(rows), 1)

    def test_successful_products_are_not_refetched(self):
        rows, status, calls = self.collect(self.provider())
        self.assertEqual([call.args[0] for call in calls], [CATEGORY, FIRST, SECOND])
        self.assertTrue(status["ok"])
        self.assertEqual(len(rows), 2)


if __name__ == "__main__":
    unittest.main()
