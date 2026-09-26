from __future__ import annotations

from pathlib import Path
import unittest
from unittest.mock import patch

from dram_tracker.freshness import REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS
from dram_tracker.source_holidays import previous_publication_day, probe
from scripts.update_automation_health import record_source_holiday


FIXTURE = Path(__file__).parent / "fixtures" / "trendforce_spot.html"


class SourceHolidayTests(unittest.TestCase):
    def spot_html(self, date: str) -> str:
        return FIXTURE.read_text(encoding="utf-8").replace(
            "Last Update 2026-06-10 11:00", f"Last Update {date} 11:00", 1)

    def test_verified_older_table_on_documented_holiday_is_not_relabelled(self) -> None:
        rows = [{"date": "2026-09-24", "product_id": product}
                for product in REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS]
        with patch("dram_tracker.source_holidays.parse_price_page", return_value=rows):
            result = probe("2026-09-25", fetcher=lambda _: self.spot_html("2026-09-24"))
        self.assertEqual(result["unpublished"], "true")
        self.assertEqual(result["source_date"], "2026-09-24")
        self.assertIn("dgpa.gov.tw", result["holiday_url"])

    def test_a_real_holiday_price_or_normal_weekday_uses_full_collector(self) -> None:
        rows = [{"date": "2026-09-25", "product_id": product}
                for product in REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS]
        with patch("dram_tracker.source_holidays.parse_price_page", return_value=rows):
            self.assertEqual(probe("2026-09-25", fetcher=lambda _: self.spot_html("2026-09-25"))["unpublished"], "false")
        self.assertEqual(probe("2026-09-24", fetcher=lambda _: self.fail("unexpected fetch"))["unpublished"], "false")

    def test_old_table_is_not_mistaken_for_a_holiday_closure(self) -> None:
        rows = [{"date": "2026-09-23", "product_id": product}
                for product in REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS]
        with patch("dram_tracker.source_holidays.parse_price_page", return_value=rows):
            self.assertEqual(probe("2026-09-25", fetcher=lambda _: self.spot_html("2026-09-23"))["unpublished"], "false")
        self.assertEqual(previous_publication_day("2026-09-28"), "2026-09-24")

    def test_probe_failure_falls_back_to_strict_collection(self) -> None:
        self.assertEqual(probe("2026-09-25", fetcher=lambda _: "invalid table")["unpublished"], "false")

    def test_holiday_heartbeat_preserves_last_good_and_clears_false_failure_streak(self) -> None:
        result = record_source_holiday(
            {"consecutiveBlockingFailures": 6, "history": []}, target_date="2026-09-25",
            source_date="2026-09-24", holiday_name="Mid-Autumn Festival",
            holiday_url="https://www.dgpa.gov.tw/information?pid=12685&uid=55",
        )
        self.assertEqual(result["status"], "no_publication")
        self.assertEqual(result["consecutiveBlockingFailures"], 0)
        self.assertFalse(result["alertRequired"])
        self.assertEqual(result["history"][-1]["status"], "no_publication")
        self.assertEqual(result["sourceHoliday"]["latestSourceDate"], "2026-09-24")


if __name__ == "__main__":
    unittest.main()
