from __future__ import annotations

import sys
import unittest
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "scripts"))
from should_retry_collection import should_retry  # noqa: E402


class CollectionRetryDecisionTests(unittest.TestCase):
    def test_retries_only_transient_fetch_failures_with_derived_missing_coverage(self) -> None:
        self.assertTrue(should_retry({"sources": [
            {"errors": ["spot: failed to fetch https://example.com: HTTP Error 503: Service Unavailable"]},
            {"warnings": ["DDR5: failed to fetch https://example.com: The read operation timed out (after deferred fetch retry)"],
             "errors": ["previously tracked products missing from collection: [('spot_proxy', 'DDR5')]"]},
        ]}))

    def test_does_not_retry_source_date_parser_or_permanent_http_failures(self) -> None:
        for message in (
            "daily_history: target date 2026-09-28 is missing verified daily prices",
            "spot: could not find TrendForce spot price table",
            "spot: failed to fetch https://example.com: HTTP Error 403: Forbidden",
            "DDR5: failed to fetch https://example.com: HTTP Error 429: Too Many Requests",
        ):
            with self.subTest(message=message):
                self.assertFalse(should_retry({"sources": [{"errors": [message]}]}))
        self.assertFalse(should_retry({"sources": [{"errors": [
            "spot: failed to fetch https://example.com: HTTP Error 503: Service Unavailable",
            "contract: could not find TrendForce contract price table",
        ]}]}))
        self.assertFalse(should_retry({"sources": "invalid"}))


if __name__ == "__main__":
    unittest.main()
