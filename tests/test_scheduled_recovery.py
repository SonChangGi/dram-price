from __future__ import annotations

from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory
import unittest

from dram_tracker.freshness import (
    INTRADAY_SCHEDULES,
    REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS,
    decide_collection_need,
    scheduled_target_date,
)
from dram_tracker.model import write_json


def timestamp(value: str) -> datetime:
    return datetime.fromisoformat(value.replace("Z", "+00:00"))


class ScheduledRecoveryTests(unittest.TestCase):
    def setUp(self):
        self.temporary = TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        write_json(self.root / "status.json", {"generated_at": "2026-09-21T04:00:00Z"})
        self.rows = [{"source": "trendforce", "kind": "spot", "cadence": "daily",
                      "product_id": product_id, "date": "2026-09-21", "effective_date": "2026-09-21",
                      "currency": "USD", "values": {"session_average": 50},
                      "source_last_update": {"date": "2026-09-21", "date_source": "table_last_update",
                                             "table_kind": "spot", "time": "18:10", "timezone": "GMT+8"}}
                     for product_id in sorted(REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS)]

    def decide(self, now="2026-09-21T13:30:00Z", schedule="30 13 * * 1-5", **kwargs):
        write_json(self.root / "prices.json", {"observations": self.rows})
        return decide_collection_need(self.root / "status.json", now=timestamp(now), schedule=schedule,
                                      require_daily_date="today", minimum_daily_spot_rows=7,
                                      require_known_spot_products=True, **kwargs)

    def test_each_daytime_slot_collects_even_after_prior_complete_success(self):
        for schedule, now in (("15 4 * * 1-5", "2026-09-21T04:15:00Z"),
                              ("15 6 * * 1-5", "2026-09-21T06:15:00Z"),
                              ("30 10 * * 1-5", "2026-09-21T10:30:00Z")):
            with self.subTest(schedule=schedule):
                decision = self.decide(now, schedule)
                self.assertTrue(decision.should_collect)
                self.assertEqual(decision.target_date, "2026-09-21")
                self.assertEqual(decision.minimum_source_time, "")

    def test_night_slots_recover_the_same_price_day_with_final_session_requirement(self):
        for schedule, now in (("30 13 * * 1-5", "2026-09-21T13:30:00Z"),
                              ("30 16 * * 1-5", "2026-09-21T16:30:00Z"),
                              ("30 19 * * 1-5", "2026-09-21T19:30:00Z")):
            with self.subTest(schedule=schedule):
                decision = self.decide(now, schedule)
                self.assertFalse(decision.should_collect)
                self.assertEqual(decision.target_date, "2026-09-21")
                self.assertEqual(decision.minimum_source_time, "17:50")

    def test_delayed_slots_across_kst_and_utc_midnight_keep_original_price_date(self):
        for schedule in ("30 13 * * 1-5", "30 16 * * 1-5", "30 19 * * 1-5"):
            with self.subTest(schedule=schedule):
                target = scheduled_target_date(timestamp("2026-09-22T00:30:00Z"), schedule)
                self.assertEqual(target, "2026-09-21")
        self.assertEqual(scheduled_target_date(timestamp("2026-09-21T15:30:00Z"), "30 13 * * 1-5"), "2026-09-21")

    def test_saturday_morning_targets_friday_and_does_not_invent_weekend_price_day(self):
        for schedule, now in (("30 16 * * 1-5", "2026-09-25T16:30:00Z"),
                              ("30 19 * * 1-5", "2026-09-25T19:30:00Z")):
            self.assertEqual(scheduled_target_date(timestamp(now), schedule), "2026-09-25")

    def test_morning_or_mixed_sessions_cannot_satisfy_recovery(self):
        for row in self.rows:
            row["source_last_update"]["time"] = "11:00"
        decision = self.decide()
        self.assertTrue(decision.should_collect)
        self.assertEqual(decision.reason, "missing-required-source-session")
        for row in self.rows[:-1]:
            row["source_last_update"]["time"] = "18:10"
        decision = self.decide()
        self.assertTrue(decision.should_collect)
        self.assertEqual(decision.daily_observation_count, 6)
        self.rows[-1]["source_last_update"]["time"] = "17:50"
        self.assertFalse(self.decide().should_collect)

    def test_next_day_prices_never_fill_missing_previous_day(self):
        for row in self.rows:
            row["date"] = row["effective_date"] = row["source_last_update"]["date"] = "2026-09-22"
        decision = self.decide("2026-09-21T19:30:00Z", "30 19 * * 1-5")
        self.assertTrue(decision.should_collect)
        self.assertEqual(decision.target_date, "2026-09-21")
        self.assertEqual(decision.reason, "missing-daily-date")

    def test_recovery_force_keeps_both_date_and_required_source_session(self):
        decision = self.decide("2026-09-21T19:30:00Z", "30 19 * * 1-5", force=True)
        self.assertTrue(decision.should_collect)
        self.assertEqual(decision.target_date, "2026-09-21")
        self.assertEqual(decision.minimum_source_time, "17:50")

    def test_wrong_or_missing_source_timezone_does_not_count_as_final_session(self):
        for row in self.rows:
            row["source_last_update"]["timezone"] = "UTC"
        self.assertEqual(self.decide().daily_observation_count, 0)

    def test_manual_explicit_date_survives_later_postcheck_clock(self):
        decision = decide_collection_need(self.root / "status.json", now=timestamp("2026-09-22T00:30:00Z"),
                                          force=True, require_daily_date="2026-09-18")
        self.assertEqual(decision.target_date, "2026-09-18")
        # Post-check uses the resolved literal, regardless of its execution date.
        postcheck = decide_collection_need(self.root / "status.json", now=timestamp("2026-09-23T00:30:00Z"),
                                           require_daily_date=decision.target_date)
        self.assertEqual(postcheck.target_date, "2026-09-18")
        self.assertTrue(postcheck.should_collect)

    def test_unknown_or_unanchored_schedule_fails_explicitly(self):
        with self.assertRaisesRegex(ValueError, "unknown DRAM"):
            self.decide(schedule="0 0 * * *")
        with self.assertRaisesRegex(ValueError, "immutable run"):
            decide_collection_need(self.root / "status.json", schedule="30 19 * * 1-5")
        with self.assertRaisesRegex(ValueError, "timezone"):
            scheduled_target_date(datetime(2026, 9, 21, 13, 30), "30 13 * * 1-5")


if __name__ == "__main__":
    unittest.main()
