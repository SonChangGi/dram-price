from __future__ import annotations

from copy import deepcopy
from datetime import datetime, timezone
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from dram_tracker.collect import main as collect_main
from scripts.update_automation_health import update_health
from dram_tracker.freshness import REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS, decide_collection_need
from dram_tracker.model import build_public_summary, build_series, summarize_status, write_json
from scripts.validate_publication import validate_publication


NOW = "2026-09-21T04:00:00Z"


def observation(product_id: str = "trendforce-spot-ddr5", kind: str = "spot") -> dict:
    return {
        "source": "trendforce", "kind": kind,
        "cadence": "daily" if kind == "spot" else "monthly",
        "product_id": product_id, "product_name": product_id,
        "date": "2026-09-21", "effective_date": "2026-09-21", "effective_month": "2026-09",
        "currency": "USD", "values": {"session_average": 50},
        "source_last_update": {"date": "2026-09-21", "date_source": "table_last_update", "table_kind": kind},
    }


class FreshnessValidationTests(unittest.TestCase):
    def decide(self, rows: list[dict], minimum: int = 2, require_known: bool = False):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            write_json(data / "status.json", {"generated_at": NOW})
            write_json(data / "prices.json", {"observations": rows})
            return decide_collection_need(data / "status.json", prices_path=data / "prices.json",
                                          now=datetime(2026, 9, 21, 4, tzinfo=timezone.utc),
                                          require_daily_date="today", minimum_daily_spot_rows=minimum,
                                          require_known_spot_products=require_known)

    def test_forced_manual_collection_preserves_resolved_target_date(self):
        with tempfile.TemporaryDirectory() as directory:
            decision = decide_collection_need(Path(directory) / "status.json", force=True,
                                              require_daily_date="today", now=datetime(2026, 9, 21, 4, tzinfo=timezone.utc))
            self.assertTrue(decision.should_collect)
            self.assertEqual(decision.reason, "forced")
            self.assertEqual(decision.target_date, "2026-09-21")

    def test_duplicate_rows_cannot_satisfy_product_coverage(self):
        row = observation()
        result = self.decide([row, deepcopy(row)])
        self.assertTrue(result.should_collect)
        self.assertEqual(result.daily_observation_count, 1)

    def test_unexpected_product_cannot_replace_a_missing_tracked_product(self):
        known = sorted(REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS)
        rows = [observation(product_id) for product_id in known[:-1]] + [observation("unexpected-new-product")]
        decision = self.decide(rows, minimum=7, require_known=True)
        self.assertTrue(decision.should_collect)
        self.assertEqual(decision.daily_observation_count, 6)
        rows.append(observation(known[-1]))
        self.assertFalse(self.decide(rows, minimum=7, require_known=True).should_collect)

    def test_incomplete_attempt_preserves_prices_reports_errors_and_allows_next_retry(self):
        with tempfile.TemporaryDirectory() as directory:
            data = Path(directory)
            rows = []
            for product_id in REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS:
                row = observation(product_id)
                row["date"] = row["effective_date"] = row["source_last_update"]["date"] = "2026-09-18"
                rows.append(row)
            write_json(data / "prices.json", {"observations": rows})
            write_json(data / "status.json", {"generated_at": "2026-09-18T04:00:00Z"})
            for filename in ("series.json", "summary.json", "automation-health.json"):
                write_json(data / filename, {"sentinel": filename})
            original = {path.name: path.read_bytes() for path in data.glob("*.json")}
            attempt = data / "attempt.json"
            spot = [observation(product_id) for product_id in REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS]
            with patch("dram_tracker.collect.collect_trendforce", return_value=(spot, {
                "source": "trendforce", "ok": True, "observation_count": 7, "errors": [], "warnings": [], "urls": []
            })), patch("dram_tracker.collect.collect_memorymarket", return_value=([], {
                "source": "memorymarket", "ok": False, "observation_count": 0, "errors": ["timeout"], "warnings": [], "urls": []
            })):
                self.assertEqual(collect_main(["--output", str(data), "--attempt-status", str(attempt)]), 2)
            for filename, content in original.items():
                self.assertEqual((data / filename).read_bytes(), content)
            diagnostic = json.loads(attempt.read_text())
            health = update_health({}, diagnostic, collection_outcome="failure", target_outcome="skipped",
                                   tests_outcome="skipped", publication_outcome="skipped", target_date="2026-09-21")
            self.assertEqual(health["status"], "blocked")
            self.assertIn("memorymarket error: timeout", health["details"])
            retry = decide_collection_need(data / "status.json", now=datetime(2026, 9, 21, 6, tzinfo=timezone.utc),
                                           require_daily_date="today", minimum_daily_spot_rows=7, require_known_spot_products=True)
            self.assertTrue(retry.should_collect)
            self.assertEqual(retry.daily_observation_count, 0)

    def test_invalid_values_and_misdated_rows_do_not_count_as_current_prices(self):
        for patch in ({"values": {"session_average": None}}, {"values": {"session_average": float("nan")}},
                      {"values": {"session_average": 0}}, {"currency": "TWD"},
                      {"effective_date": "2026-07-31"}, {"product_id": ""},
                      {"source_last_update": {"date": "2026-07-31", "date_source": "table_last_update", "table_kind": "spot"}},
                      {"source_last_update": {"date": "2026-09-21", "date_source": "table_last_update", "table_kind": "contract"}}):
            with self.subTest(patch=patch):
                result = self.decide([{**observation(), **patch}], minimum=1)
                self.assertTrue(result.should_collect)
                self.assertEqual(result.daily_observation_count, 0)

    def test_distinct_valid_products_satisfy_coverage_including_verified_legacy_spot(self):
        old = observation("trendforce-spot-ddr4")
        old["source_last_update"] = {"date": "2026-09-21", "date_source": "last_update"}
        self.assertFalse(self.decide([observation(), old]).should_collect)


class PublicationValidationTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory()
        self.addCleanup(self.temporary.cleanup)
        self.data = Path(self.temporary.name)
        self.rows = [observation(), observation("trendforce-contract-ddr4", "contract")]
        self.sources = [{"source": "trendforce", "ok": True, "observation_count": 2, "urls": [], "warnings": [], "errors": []}]
        self.write_bundle()

    def write_bundle(self):
        status = summarize_status(self.rows, self.sources, NOW)
        series = build_series(self.rows)
        write_json(self.data / "prices.json", {"generated_at": NOW, "observations": self.rows})
        write_json(self.data / "series.json", {"generated_at": NOW, "series": series})
        write_json(self.data / "status.json", status)
        write_json(self.data / "summary.json", build_public_summary(self.rows, series, status, NOW))
        write_json(self.data / "automation-health.json", {"contract": "dram-automation-health", "projectId": "dram",
                                                          "consecutiveWarningRuns": 0, "consecutiveBlockingFailures": 0})

    def test_valid_candidate_can_publish(self):
        validate_publication(self.data)

    def test_historical_contract_without_its_own_table_timestamp_cannot_publish(self):
        self.rows[1]["source_last_update"]["date_source"] = "last_update"
        self.write_bundle()
        with self.assertRaisesRegex(SystemExit, "own table update provenance"):
            validate_publication(self.data)

    def test_contract_date_must_match_its_table(self):
        self.rows[1]["source_last_update"]["date"] = "2026-07-31"
        self.write_bundle()
        with self.assertRaisesRegex(SystemExit, "source update date differs"):
            validate_publication(self.data)

    def test_memorymarket_route_must_match_cadence_and_product(self):
        monthly = {**observation("memorymarket-100254"), "source": "memorymarket", "kind": "spot_proxy",
                   "source_url": "https://www.memorymarket.com/price/ems/100254", "cadence": "monthly"}
        self.rows.append(monthly)
        self.write_bundle()
        validate_publication(self.data)
        for patch, message in (({"cadence": "weekly"}, "cadence differs"),
                               ({"source_url": "https://www.memorymarket.com/price/ews/100254"}, "cadence differs"),
                               ({"product_id": "memorymarket-100222"}, "product differs"),
                               ({"source_url": "https://www.memorymarket.com/price/100254"}, "unsupported")):
            with self.subTest(patch=patch):
                self.rows[-1] = {**monthly, **patch}
                self.write_bundle()
                with self.assertRaisesRegex(SystemExit, message):
                    validate_publication(self.data)
        self.rows[-1] = {**monthly, "source_url": "https://www.memorymarket.com/price/ews/100254", "cadence": "weekly"}
        self.write_bundle()
        validate_publication(self.data)

    def test_partial_source_cannot_publish_even_with_existing_prices(self):
        for patch in ({"ok": False, "errors": ["fetch failed"]}, {"observation_count": 0}, {"warnings": ["one product timed out"]}):
            with self.subTest(patch=patch):
                self.sources[0] = {"source": "trendforce", "ok": True, "observation_count": 2, "warnings": [], "errors": [], **patch}
                self.write_bundle()
                with self.assertRaisesRegex(SystemExit, "source collection failed"):
                    validate_publication(self.data)

    def test_summary_price_must_match_the_observations_that_back_it(self):
        path = self.data / "summary.json"
        summary = json.loads(path.read_text())
        summary["primaryEntities"][0]["metrics"]["price"] *= 8
        write_json(path, summary)
        with self.assertRaisesRegex(SystemExit, "summary differs"):
            validate_publication(self.data)

    def test_stale_series_or_generation_timestamp_cannot_publish(self):
        for patch, expected in (({"generated_at": "2026-09-18T04:00:00Z"}, "timestamps differ"),
                                ({"series": []}, "series differs")):
            with self.subTest(patch=patch):
                self.write_bundle()
                path = self.data / "series.json"
                write_json(path, {**json.loads(path.read_text()), **patch})
                with self.assertRaisesRegex(SystemExit, expected):
                    validate_publication(self.data)

    def test_duplicate_observations_cannot_publish(self):
        self.rows.append(deepcopy(self.rows[0]))
        self.write_bundle()
        with self.assertRaisesRegex(SystemExit, "duplicate"):
            validate_publication(self.data)


if __name__ == "__main__":
    unittest.main()
