from __future__ import annotations

from copy import deepcopy
from pathlib import Path
from tempfile import TemporaryDirectory
from unittest.mock import patch
import json
import unittest

from dram_tracker.collect import build_parser, collect_memorymarket, run, validate_source_coverage
from scripts.repair_price_history import build_candidate, repair_stored_observations


class PriceRepairTests(unittest.TestCase):
    def test_unverified_contract_is_archived_without_guessing_its_date(self):
        legacy = {"source": "trendforce", "kind": "contract", "product_id": "contract",
                  "date": "2026-09-18", "values": {"session_average": 130},
                  "source_last_update": {"date": "2026-09-18", "date_source": "last_update"}}
        saved = deepcopy(legacy)
        kept, quarantined, changes = repair_stored_observations([legacy])
        self.assertEqual(kept, [])
        self.assertEqual(quarantined, [saved])
        self.assertEqual(legacy, saved)
        self.assertEqual(changes, [])

    def test_monthly_cadence_correction_preserves_price_and_date_and_deduplicates(self):
        monthly = {"source": "memorymarket", "kind": "spot_proxy", "product_id": "memorymarket-100254",
                   "source_url": "https://www.memorymarket.com/price/ems/100254", "cadence": "weekly",
                   "date": "2026-09-08", "values": {"average": 127, "low": 120, "high": 130}}
        kept, quarantined, changes = repair_stored_observations([monthly, {**monthly, "cadence": "monthly"}])
        self.assertEqual(kept, [{**monthly, "cadence": "monthly"}])
        self.assertEqual(quarantined, [])
        self.assertEqual(len(changes), 1)
        repeated, _, repeated_changes = repair_stored_observations(kept)
        self.assertEqual(repeated, kept)
        self.assertEqual(repeated_changes, [])

    def test_repair_never_overwrites_existing_recovery_paths(self):
        with TemporaryDirectory() as tmp:
            output = Path(tmp)
            with self.assertRaisesRegex(ValueError, "new paths"):
                build_candidate(output / "source", output / "fixtures", output, output / "archive", "2026-09-21T03:00:00Z")


class CollectorPreservationTests(unittest.TestCase):
    def test_partial_collection_keeps_every_existing_artifact_byte(self):
        for source in [
            {"ok": False, "observation_count": 0, "errors": ["table timestamp missing"], "warnings": []},
            {"ok": True, "observation_count": 1, "errors": [], "warnings": ["one product unavailable"]},
            {"ok": True, "observation_count": 0, "errors": [], "warnings": []},
        ]:
            with self.subTest(source=source), TemporaryDirectory() as tmp:
                root = Path(tmp)
                data = root / "data"
                data.mkdir()
                before = {}
                for name in ("prices.json", "series.json", "summary.json", "status.json"):
                    value = {"observations": [{"source": "saved", "values": {"average": 10}}]} if name == "prices.json" else {"sentinel": name}
                    before[name] = json.dumps(value).encode()
                    (data / name).write_bytes(before[name])
                attempt = root / "attempt.json"
                args = build_parser().parse_args(["--output", str(data), "--no-include-memorymarket", "--attempt-status", str(attempt)])
                with patch("dram_tracker.collect.collect_trendforce", return_value=([], {"source": "trendforce", "urls": [], **source})):
                    self.assertEqual(run(args), 2)
                self.assertEqual({name: (data / name).read_bytes() for name in before}, before)
                self.assertEqual(json.loads(attempt.read_text())["sources"][0]["errors"], source["errors"])

    def test_broken_contract_dates_cannot_reenter_through_regular_collection(self):
        with TemporaryDirectory() as tmp:
            data = Path(tmp)
            original = json.dumps({"observations": [{"source": "trendforce", "kind": "contract", "product_id": "trendforce-contract-ddr5-8gb-so-dimm", "date": "2026-09-18", "values": {"session_average": 130}}]}).encode()
            (data / "prices.json").write_bytes(original)
            args = build_parser().parse_args(["--output", str(data), "--fixture-dir", str(Path(__file__).parent / "fixtures")])
            with self.assertRaisesRegex(ValueError, "unverified historical contract"):
                run(args)
            self.assertEqual((data / "prices.json").read_bytes(), original)
            self.assertFalse((data / "status.json").exists())

    def test_one_empty_category_is_not_masked_by_other_successful_categories(self):
        with TemporaryDirectory() as tmp:
            fixture = Path(tmp)
            (fixture / "memorymarket_category_rdimm.html").write_text("<html>Try again later</html>")
            rows, status = collect_memorymarket(fixture_dir=fixture, collected_at="2026-09-21T03:00:00Z", limit_products=None, delay=0)
            self.assertFalse(status["ok"])
            self.assertIn("rdimm category returned no products", status["errors"][0])
            self.assertEqual(rows, [])

    def test_missing_known_product_fails_even_when_the_remaining_table_is_valid(self):
        old = [{"source": "trendforce", "kind": "contract", "product_id": "a"},
               {"source": "trendforce", "kind": "contract", "product_id": "b"}]
        statuses = [{"source": "trendforce", "ok": True, "errors": []}]
        validate_source_coverage(old, old[:1], statuses)
        self.assertFalse(statuses[0]["ok"])
        self.assertIn("'b'", statuses[0]["errors"][0])


if __name__ == "__main__":
    unittest.main()
