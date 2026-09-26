from __future__ import annotations

from copy import deepcopy
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

from dram_tracker.collect import build_parser, run, collect_trendforce
from dram_tracker.freshness import REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS
from dram_tracker.history import archive_spot, load_spot_archive
from dram_tracker.model import merge_observations


def spot(day="2026-09-21", session="18:10", value=5):
    return [{"source": "trendforce", "kind": "spot", "cadence": "daily", "date": day,
             "effective_date": day, "effective_month": day[:7], "currency": "USD", "category": "ddr4",
             "product_id": product, "product_name": product, "source_url": "https://www.trendforce.com/price/dram/dram_spot",
             "collected_at": "2026-09-21T10:30:00Z", "source_content_sha256": "a" * 64,
             "source_last_update": {"date": day, "time": session, "timezone": "GMT+8",
                                    "date_source": "table_last_update", "table_kind": "spot"},
             "values": {"session_average": value}}
            for product in sorted(REQUIRED_TRENDFORCE_SPOT_PRODUCT_IDS)]


def status(source, rows, ok=True):
    return {"source": source, "ok": ok, "urls": [], "warnings": [] if ok else ["timeout"],
            "errors": [], "observation_count": len(rows)}


class DailyHistoryTests(unittest.TestCase):
    def test_snapshot_is_immutable_and_idempotent_across_fetch_times(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            first = spot()
            archive_spot(root, first, first[0]["collected_at"])
            later = deepcopy(first)
            for row in later:
                row["collected_at"] = "2026-09-21T13:30:00Z"
                row["source_content_sha256"] = "b" * 64
            archive_spot(root, later, later[0]["collected_at"])
            self.assertEqual(len(list(root.glob("*/*.json"))), 1)
            self.assertEqual(load_spot_archive(root), first)

    def test_partial_or_mixed_session_snapshot_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            with self.assertRaisesRegex(ValueError, "seven products"):
                archive_spot(Path(directory), spot()[:-1], "now")
            rows = spot(); rows[0]["source_last_update"]["time"] = "11:00"
            with self.assertRaisesRegex(ValueError, "mixes source sessions"):
                archive_spot(Path(directory), rows, "now")

    def test_tampered_snapshot_is_rejected(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            path = archive_spot(root, spot(), "2026-09-21T10:30:00Z")[0]
            payload = json.loads(path.read_text()); payload["observations"][0]["values"]["session_average"] = 99
            path.write_text(json.dumps(payload))
            with self.assertRaisesRegex(ValueError, "hash mismatch"):
                load_spot_archive(root)

    def test_late_old_session_cannot_overwrite_latest_daily_observation(self):
        last_session = spot(session="18:10", value=6)
        stale = spot(session="11:00", value=5)
        for row in stale:
            row["collected_at"] = "2026-09-22T01:00:00Z"
        self.assertEqual(merge_observations(last_session, stale), sorted(last_session, key=lambda r: r["product_name"]))
        self.assertEqual({r["date"] for r in merge_observations(last_session, spot(day="2026-09-22"))}, {"2026-09-21", "2026-09-22"})

    def test_conflicting_capture_is_quarantined_and_later_session_recovers(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            archive_spot(root, spot(session="11:00", value=5), "2026-09-21T04:00:00Z")
            with self.assertRaisesRegex(ValueError, "outside accepted history"):
                archive_spot(root, spot(session="11:00", value=6), "2026-09-21T04:30:00Z")
            self.assertEqual(len(list((root / "conflicts").glob("*/*.json"))), 1)
            self.assertEqual(len(load_spot_archive(root)), 7)
            later = spot(session="18:10", value=7)
            archive_spot(root, later, "2026-09-21T11:00:00Z")
            merged = merge_observations([], load_spot_archive(root))
            self.assertEqual(len(merged), 7)
            self.assertTrue(all(row["values"]["session_average"] == 7 for row in merged))

    def test_current_public_session_is_also_a_conflict_reference(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            with self.assertRaisesRegex(ValueError, "outside accepted history"):
                archive_spot(root, spot(value=6), "now", reference=spot(value=5))
            self.assertEqual(load_spot_archive(root), [])

    def test_contract_failure_does_not_discard_valid_spot_capture(self):
        with patch("dram_tracker.collect.fetch_text", side_effect=["spot html", RuntimeError("contract timeout")]), \
             patch("dram_tracker.collect.trendforce.parse_price_page", return_value=spot()):
            rows, source = collect_trendforce(fixture_dir=None, collected_at="2026-09-21T10:30:00Z")
        self.assertEqual(rows, spot())
        self.assertFalse(source["ok"])
        self.assertIn("contract timeout", source["errors"][0])

    def test_same_source_session_conflicting_values_fail_closed(self):
        with self.assertRaisesRegex(ValueError, "conflicting TrendForce prices"):
            merge_observations(spot(value=5), spot(value=6))

    def test_other_source_failure_saves_spot_then_recovers_previous_day(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); output = root / "data"; output.mkdir()
            original = '{"observations": []}\n'
            (output / "prices.json").write_text(original)
            history = root / "history"
            args = build_parser().parse_args(["--output", str(output), "--history-dir", str(history), "--target-date", "2026-09-21"])
            first = spot()
            with patch("dram_tracker.collect.collect_trendforce", return_value=(first, status("trendforce", first))), \
                 patch("dram_tracker.collect.collect_memorymarket", return_value=([], status("memorymarket", [], False))):
                self.assertEqual(run(args), 2)
            self.assertEqual((output / "prices.json").read_text(), original)
            self.assertEqual(load_spot_archive(history), first)
            next_day = spot(day="2026-09-22", value=7)
            other = [{**deepcopy(first[0]), "source": "memorymarket", "kind": "spot_proxy", "cadence": "weekly",
                      "product_id": "memorymarket-100222", "product_name": "DDR4 16Gb 3200", "values": {"average": 50}}]
            with patch("dram_tracker.collect.collect_trendforce", return_value=(next_day, status("trendforce", next_day))), \
                 patch("dram_tracker.collect.collect_memorymarket", return_value=(other, status("memorymarket", other))):
                self.assertEqual(run(args), 0)
            rows = json.loads((output / "prices.json").read_text())["observations"]
            previous = [row for row in rows if row["source"] == "trendforce" and row["date"] == "2026-09-21"]
            self.assertEqual(len(previous), 7)
            self.assertTrue(all(row["values"]["session_average"] == 5 for row in previous))
            self.assertEqual(json.loads((history / "recovery.json").read_text())["dates"]["2026-09-21"]["state"], "observed")

    def test_new_day_cannot_be_relabeled_to_fill_missing_previous_day(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory); output = root / "data"; history = root / "history"
            attempt = root / "attempt-status.json"
            args = build_parser().parse_args(["--output", str(output), "--history-dir", str(history), "--target-date", "2026-09-21", "--attempt-status", str(attempt), "--no-include-memorymarket"])
            rows = spot(day="2026-09-22")
            with patch("dram_tracker.collect.collect_trendforce", return_value=(rows, status("trendforce", rows))):
                self.assertEqual(run(args), 2)
            self.assertFalse((output / "prices.json").exists())
            self.assertIn("latest TrendForce spot source date: 2026-09-22",
                          json.loads(attempt.read_text())["sources"][-1]["errors"][0])
            self.assertEqual({row["date"] for row in load_spot_archive(history)}, {"2026-09-22"})
            self.assertEqual(json.loads((history / "recovery.json").read_text())["dates"]["2026-09-21"]["state"], "missing")


if __name__ == "__main__":
    unittest.main()
