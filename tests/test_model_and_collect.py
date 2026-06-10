from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dram_tracker.model import merge_observations

ROOT = Path(__file__).resolve().parents[1]


class ModelAndCollectTests(unittest.TestCase):
    def test_merge_observations_deduplicates_by_source_kind_product_cadence_date(self) -> None:
        old = [{"source": "s", "kind": "spot", "product_id": "p", "cadence": "daily", "date": "2026-06-10", "values": {"average": 1}}]
        new = [{"source": "s", "kind": "spot", "product_id": "p", "cadence": "daily", "date": "2026-06-10", "values": {"average": 2}}]
        merged = merge_observations(old, new)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["values"]["average"], 2)

    def test_fixture_collector_writes_valid_json_outputs(self) -> None:
        with TemporaryDirectory() as tmp:
            output = Path(tmp) / "data"
            cmd = [
                sys.executable,
                "-m",
                "dram_tracker.collect",
                "--fixture-dir",
                str(ROOT / "tests" / "fixtures"),
                "--output",
                str(output),
            ]
            result = subprocess.run(
                cmd,
                cwd=ROOT,
                env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertIn("collected", result.stdout)
            prices = json.loads((output / "prices.json").read_text(encoding="utf-8"))
            status = json.loads((output / "status.json").read_text(encoding="utf-8"))
            series = json.loads((output / "series.json").read_text(encoding="utf-8"))
            self.assertEqual(prices["schema_version"], 1)
            self.assertEqual(status["observation_count"], len(prices["observations"]))
            self.assertGreaterEqual({obs["kind"] for obs in prices["observations"]}, {"spot", "contract", "spot_proxy"})
            self.assertIn("category", prices["observations"][0])
            self.assertTrue(series["series"])
            self.assertTrue(series["series"][0]["categories"])

    def test_failed_source_preserves_existing_data_and_records_status(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            output = root / "data"
            fixture_dir = root / "fixtures"
            fixture_dir.mkdir()
            output.mkdir()
            existing = {
                "schema_version": 1,
                "generated_at": "2026-06-09T00:00:00Z",
                "observations": [
                    {
                        "source": "seed",
                        "kind": "spot",
                        "product_id": "seed-product",
                        "product_name": "Seed Product",
                        "category": "seed",
                        "cadence": "daily",
                        "date": "2026-06-09",
                        "values": {"average": 1},
                    }
                ],
            }
            (output / "prices.json").write_text(json.dumps(existing), encoding="utf-8")
            cmd = [
                sys.executable,
                "-m",
                "dram_tracker.collect",
                "--fixture-dir",
                str(fixture_dir),
                "--output",
                str(output),
            ]
            result = subprocess.run(
                cmd,
                cwd=ROOT,
                env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
                text=True,
                capture_output=True,
                check=True,
            )
            self.assertIn("stored 1 total", result.stdout)
            prices = json.loads((output / "prices.json").read_text(encoding="utf-8"))
            status = json.loads((output / "status.json").read_text(encoding="utf-8"))
            self.assertEqual(prices["observations"][0]["product_id"], "seed-product")
            trendforce_status = next(source for source in status["sources"] if source["source"] == "trendforce")
            self.assertFalse(trendforce_status["ok"])
            self.assertTrue(trendforce_status["errors"])
            self.assertEqual(status["observation_count"], 1)


if __name__ == "__main__":
    unittest.main()
