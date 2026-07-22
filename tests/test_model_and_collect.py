from __future__ import annotations

import json
import os
import subprocess
import sys
import unittest
from datetime import datetime, timezone
from pathlib import Path
from tempfile import TemporaryDirectory

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / "src"))

from dram_tracker.freshness import decide_collection_need
from dram_tracker.model import build_public_summary, build_series, merge_observations, observation_price, summarize_status

ROOT = Path(__file__).resolve().parents[1]


class ModelAndCollectTests(unittest.TestCase):
    @staticmethod
    def _write_status(path: Path, generated_at: str) -> None:
        path.write_text(json.dumps({"generated_at": generated_at}), encoding="utf-8")

    @staticmethod
    def _trendforce_daily_spot(date: str, product_id: str = "trendforce-spot-ddr5") -> dict[str, str]:
        return {
            "source": "trendforce",
            "kind": "spot",
            "cadence": "daily",
            "date": date,
            "product_id": product_id,
        }

    @staticmethod
    def _write_prices(path: Path, observations: list[dict[str, str]]) -> None:
        path.write_text(json.dumps({"observations": observations}), encoding="utf-8")

    def test_freshness_decision_skips_when_status_is_current_kst_day(self) -> None:
        with TemporaryDirectory() as tmp:
            status = Path(tmp) / "status.json"
            self._write_status(status, "2026-06-10T02:20:00Z")
            decision = decide_collection_need(
                status,
                now=datetime(2026, 6, 10, 6, 17, tzinfo=timezone.utc),
            )
            self.assertFalse(decision.should_collect)
            self.assertEqual(decision.reason, "fresh")
            self.assertEqual(decision.today, "2026-06-10")
            self.assertEqual(decision.generated_date, "2026-06-10")

    def test_freshness_decision_collects_when_status_is_previous_kst_day(self) -> None:
        with TemporaryDirectory() as tmp:
            status = Path(tmp) / "status.json"
            self._write_status(status, "2026-06-09T14:59:00Z")
            decision = decide_collection_need(
                status,
                now=datetime(2026, 6, 10, 2, 17, tzinfo=timezone.utc),
            )
            self.assertTrue(decision.should_collect)
            self.assertEqual(decision.reason, "stale")
            self.assertEqual(decision.today, "2026-06-10")
            self.assertEqual(decision.generated_date, "2026-06-09")

    def test_freshness_decision_collects_when_forced_or_missing_status(self) -> None:
        with TemporaryDirectory() as tmp:
            missing = Path(tmp) / "status.json"
            missing_decision = decide_collection_need(
                missing,
                now=datetime(2026, 6, 10, 2, 17, tzinfo=timezone.utc),
            )
            forced_decision = decide_collection_need(
                missing,
                now=datetime(2026, 6, 10, 2, 17, tzinfo=timezone.utc),
                force=True,
            )
            self.assertTrue(missing_decision.should_collect)
            self.assertEqual(missing_decision.reason, "missing-status")
            self.assertTrue(forced_decision.should_collect)
            self.assertEqual(forced_decision.reason, "forced")

    def test_freshness_decision_skips_when_required_daily_date_exists(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            status = root / "status.json"
            prices = root / "prices.json"
            self._write_status(status, "2026-06-11T02:20:00Z")
            self._write_prices(prices, [self._trendforce_daily_spot("2026-06-10")])
            decision = decide_collection_need(
                status,
                prices_path=prices,
                require_daily_date="yesterday",
                now=datetime(2026, 6, 11, 3, 0, tzinfo=timezone.utc),
            )
            self.assertFalse(decision.should_collect)
            self.assertEqual(decision.reason, "fresh-daily-date")
            self.assertEqual(decision.target_date, "2026-06-10")
            self.assertEqual(decision.daily_observation_count, 1)

    def test_freshness_decision_collects_when_required_daily_date_is_missing(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            status = root / "status.json"
            prices = root / "prices.json"
            self._write_status(status, "2026-06-10T09:20:00Z")
            self._write_prices(prices, [self._trendforce_daily_spot("2026-06-09")])
            decision = decide_collection_need(
                status,
                prices_path=prices,
                require_daily_date="yesterday",
                now=datetime(2026, 6, 11, 3, 0, tzinfo=timezone.utc),
            )
            self.assertTrue(decision.should_collect)
            self.assertEqual(decision.reason, "missing-daily-date")
            self.assertEqual(decision.target_date, "2026-06-10")
            self.assertEqual(decision.daily_observation_count, 0)


    def test_freshness_decision_collects_when_daily_count_is_below_minimum(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            status = root / "status.json"
            prices = root / "prices.json"
            self._write_status(status, "2026-06-11T02:20:00Z")
            self._write_prices(prices, [self._trendforce_daily_spot("2026-06-10")])
            decision = decide_collection_need(
                status,
                prices_path=prices,
                require_daily_date="yesterday",
                minimum_daily_spot_rows=2,
                now=datetime(2026, 6, 11, 3, 0, tzinfo=timezone.utc),
            )
            self.assertTrue(decision.should_collect)
            self.assertEqual(decision.reason, "insufficient-daily-date")
            self.assertEqual(decision.target_date, "2026-06-10")
            self.assertEqual(decision.daily_observation_count, 1)

    def test_freshness_cli_can_fail_when_collection_is_still_needed(self) -> None:
        with TemporaryDirectory() as tmp:
            root = Path(tmp)
            status = root / "status.json"
            prices = root / "prices.json"
            self._write_status(status, "2026-06-11T02:20:00Z")
            self._write_prices(prices, [])
            result = subprocess.run(
                [
                    sys.executable,
                    "-m",
                    "dram_tracker.freshness",
                    "--status",
                    str(status),
                    "--prices",
                    str(prices),
                    "--timezone",
                    "Asia/Seoul",
                    "--require-daily-date",
                    "yesterday",
                    "--minimum-daily-spot-rows",
                    "2",
                    "--fail-if-collect-needed",
                ],
                cwd=ROOT,
                env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
                text=True,
                capture_output=True,
                check=False,
            )
            self.assertEqual(result.returncode, 1)
            self.assertIn("should_collect=true", result.stdout)
            self.assertIn("reason=missing-daily-date", result.stdout)

    def test_merge_observations_deduplicates_by_source_kind_product_cadence_date(self) -> None:
        old = [{"source": "s", "kind": "spot", "product_id": "p", "cadence": "daily", "date": "2026-06-10", "values": {"average": 1}}]
        new = [{"source": "s", "kind": "spot", "product_id": "p", "cadence": "daily", "date": "2026-06-10", "values": {"average": 2}}]
        merged = merge_observations(old, new)
        self.assertEqual(len(merged), 1)
        self.assertEqual(merged[0]["values"]["average"], 2)

    def test_merge_observations_prunes_invalid_prices_without_overwriting_valid_history(self) -> None:
        valid_existing = {
            "source": "s",
            "kind": "spot",
            "product_id": "p",
            "cadence": "daily",
            "date": "2026-06-10",
            "values": {"average": 1.0},
        }
        invalid_existing = {
            "source": "s",
            "kind": "spot",
            "product_id": "invalid-old",
            "cadence": "daily",
            "date": "2026-06-09",
            "values": {"average": None},
        }
        invalid_replacement = {**valid_existing, "values": {"session_average": float("nan")}}
        valid_new = {
            "source": "s",
            "kind": "spot",
            "product_id": "new",
            "cadence": "daily",
            "date": "2026-06-11",
            "values": {"session_average": 2.0},
        }

        merged = merge_observations([valid_existing, invalid_existing], [invalid_replacement, valid_new])

        self.assertEqual([row["product_id"] for row in merged], ["p", "new"])
        self.assertEqual(merged[0]["values"]["average"], 1.0)
        self.assertEqual(merged[1]["values"]["session_average"], 2.0)

    def test_public_summary_uses_only_valid_prices_and_currency_units(self) -> None:
        valid_session = {
            "source": "trendforce",
            "kind": "spot",
            "product_id": "session-product",
            "product_name": "Session Product",
            "category": "ddr5",
            "cadence": "daily",
            "date": "2026-06-10",
            "currency": "USD",
            "values": {"session_average": 3.5, "average": 99.0},
        }
        valid_average = {
            "source": "memorymarket",
            "kind": "spot_proxy",
            "product_id": "average-product",
            "product_name": "Average Product",
            "category": "ddr4",
            "cadence": "weekly",
            "date": "2026-06-09",
            "currency": "USD",
            "values": {"average": 2.25},
        }
        invalid_newer = {
            **valid_session,
            "date": "2026-06-11",
            "values": {"session_average": None},
        }
        invalid_only = {
            **valid_session,
            "product_id": "invalid-only",
            "product_name": "Invalid Only",
            "values": {"session_average": None},
        }
        observations = [valid_session, valid_average, invalid_newer, invalid_only]
        series = build_series(observations)
        status = summarize_status(observations, [], "2026-06-11T00:00:00Z")

        summary = build_public_summary(observations, series, status, "2026-06-11T00:00:00Z")

        entities = {entity["name"]: entity for entity in summary["primaryEntities"]}
        self.assertEqual(set(entities), {"Session Product", "Average Product"})
        self.assertEqual(entities["Session Product"]["metrics"]["price"], 3.5)
        self.assertEqual(entities["Session Product"]["metrics"]["unit"], "USD")
        self.assertEqual(entities["Average Product"]["metrics"]["price"], 2.25)
        self.assertEqual(entities["Average Product"]["metrics"]["unit"], "USD")

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
            summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
            self.assertEqual(prices["schema_version"], 1)
            self.assertEqual(status["observation_count"], len(prices["observations"]))
            self.assertGreaterEqual({obs["kind"] for obs in prices["observations"]}, {"spot", "contract", "spot_proxy"})
            self.assertIn("category", prices["observations"][0])
            self.assertTrue(series["series"])
            self.assertTrue(series["series"][0]["categories"])
            self.assertEqual(summary["contract"], "quant-research-summary")
            self.assertEqual(summary["projectId"], "dram")
            self.assertTrue(summary["primaryEntities"])
            self.assertTrue(all(observation_price(obs) is not None for obs in prices["observations"]))
            self.assertTrue(all(isinstance(entity["metrics"]["price"], (int, float)) for entity in summary["primaryEntities"]))
            self.assertTrue(all(entity["metrics"]["unit"] == "USD" for entity in summary["primaryEntities"]))
            self.assertTrue(any("공개" in item or "source" in item.lower() for item in summary["limitations"]))

    def test_fixture_collector_preserves_prior_dates_and_updates_current_date(self) -> None:
        with TemporaryDirectory() as tmp:
            output = Path(tmp) / "data"
            output.mkdir()
            product_id = "trendforce-spot-ddr5-16gb-2gx8-4800-5600"
            existing = {
                "schema_version": 1,
                "generated_at": "2026-06-09T00:00:00Z",
                "observations": [
                    {
                        "source": "trendforce",
                        "kind": "spot",
                        "product_id": product_id,
                        "product_name": "DDR5 16Gb (2Gx8) 4800/5600",
                        "category": "ddr5",
                        "cadence": "daily",
                        "date": "2026-06-09",
                        "values": {"session_average": 40.0},
                    },
                    {
                        "source": "trendforce",
                        "kind": "spot",
                        "product_id": product_id,
                        "product_name": "DDR5 16Gb (2Gx8) 4800/5600",
                        "category": "ddr5",
                        "cadence": "daily",
                        "date": "2026-06-10",
                        "values": {"session_average": 1.0},
                    },
                ],
            }
            (output / "prices.json").write_text(json.dumps(existing), encoding="utf-8")
            cmd = [
                sys.executable,
                "-m",
                "dram_tracker.collect",
                "--fixture-dir",
                str(ROOT / "tests" / "fixtures"),
                "--output",
                str(output),
            ]
            subprocess.run(
                cmd,
                cwd=ROOT,
                env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
                text=True,
                capture_output=True,
                check=True,
            )
            prices = json.loads((output / "prices.json").read_text(encoding="utf-8"))
            observations = prices["observations"]
            prior = [obs for obs in observations if obs["product_id"] == product_id and obs["date"] == "2026-06-09"]
            current = [obs for obs in observations if obs["product_id"] == product_id and obs["date"] == "2026-06-10"]
            self.assertEqual(len(prior), 1)
            self.assertEqual(prior[0]["values"]["session_average"], 40.0)
            self.assertEqual(len(current), 1)
            self.assertEqual(current[0]["values"]["session_average"], 44.5)

    def test_rebuild_only_prunes_invalid_rows_and_preserves_stored_metadata(self) -> None:
        with TemporaryDirectory() as tmp:
            output = Path(tmp) / "data"
            output.mkdir()
            valid = {
                "source": "trendforce",
                "source_url": "https://example.test/source",
                "kind": "spot",
                "product_id": "valid-product",
                "product_name": "Valid Product",
                "category": "ddr5",
                "cadence": "daily",
                "date": "2026-06-10",
                "effective_date": "2026-06-10",
                "collected_at": "2026-06-10T02:00:00Z",
                "currency": "USD",
                "values": {"session_average": 3.5},
            }
            invalid = {
                **valid,
                "product_id": "announcement",
                "product_name": "Price announcement",
                "values": {"session_average": None},
            }
            generated_at = "2026-06-10T03:00:00Z"
            sources = [
                {
                    "source": "trendforce",
                    "ok": True,
                    "observation_count": 2,
                    "urls": ["https://example.test/source"],
                    "warnings": [],
                    "errors": [],
                }
            ]
            (output / "prices.json").write_text(
                json.dumps({"schema_version": 1, "generated_at": generated_at, "observations": [valid, invalid]}),
                encoding="utf-8",
            )
            (output / "status.json").write_text(json.dumps({"generated_at": generated_at, "sources": sources}), encoding="utf-8")

            result = subprocess.run(
                [sys.executable, "-m", "dram_tracker.collect", "--output", str(output), "--rebuild-only"],
                cwd=ROOT,
                env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
                text=True,
                capture_output=True,
                check=True,
            )

            prices = json.loads((output / "prices.json").read_text(encoding="utf-8"))
            status = json.loads((output / "status.json").read_text(encoding="utf-8"))
            summary = json.loads((output / "summary.json").read_text(encoding="utf-8"))
            self.assertIn("rebuilt from stored data", result.stdout)
            self.assertEqual(prices["generated_at"], generated_at)
            self.assertEqual(prices["observations"], [valid])
            self.assertEqual(status["generated_at"], generated_at)
            self.assertEqual(status["sources"], sources)
            self.assertEqual(summary["generatedAt"], generated_at)
            self.assertEqual(summary["primaryEntities"][0]["metrics"]["price"], 3.5)
            self.assertEqual(summary["primaryEntities"][0]["metrics"]["unit"], "USD")

    def test_rebuild_only_fails_closed_when_status_metadata_is_incomplete(self) -> None:
        generated_at = "2026-06-10T03:00:00Z"
        valid_source = {
            "source": "trendforce",
            "ok": True,
            "observation_count": 1,
            "urls": ["https://example.test/source"],
            "warnings": [],
            "errors": [],
        }
        status_cases = {
            "missing-status": None,
            "missing-generated-at": {"sources": [valid_source]},
            "empty-sources": {"generated_at": generated_at, "sources": []},
            "incomplete-source": {"generated_at": generated_at, "sources": [{"source": "trendforce", "ok": True}]},
            "mismatched-generated-at": {"generated_at": "2026-06-11T03:00:00Z", "sources": [valid_source]},
        }
        for label, status_payload in status_cases.items():
            with self.subTest(label=label), TemporaryDirectory() as tmp:
                output = Path(tmp) / "data"
                output.mkdir()
                valid = {
                    "source": "trendforce",
                    "kind": "spot",
                    "product_id": "valid-product",
                    "product_name": "Valid Product",
                    "cadence": "daily",
                    "date": "2026-06-10",
                    "currency": "USD",
                    "values": {"session_average": 3.5},
                }
                artifacts = {
                    "prices.json": {"schema_version": 1, "generated_at": generated_at, "observations": [valid]},
                    "series.json": {"sentinel": "series"},
                    "summary.json": {"sentinel": "summary"},
                }
                for name, payload in artifacts.items():
                    (output / name).write_text(json.dumps(payload), encoding="utf-8")
                if status_payload is not None:
                    (output / "status.json").write_text(json.dumps(status_payload), encoding="utf-8")
                paths = [output / name for name in ("prices.json", "series.json", "status.json", "summary.json")]
                before = {path.name: path.read_bytes() if path.exists() else None for path in paths}

                result = subprocess.run(
                    [sys.executable, "-m", "dram_tracker.collect", "--output", str(output), "--rebuild-only"],
                    cwd=ROOT,
                    env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
                    text=True,
                    capture_output=True,
                    check=False,
                )

                after = {path.name: path.read_bytes() if path.exists() else None for path in paths}
                self.assertNotEqual(result.returncode, 0)
                self.assertIn("rebuild-only", result.stderr)
                self.assertEqual(after, before)

    def test_rebuild_only_fails_closed_before_replacing_all_invalid_history(self) -> None:
        with TemporaryDirectory() as tmp:
            output = Path(tmp) / "data"
            output.mkdir()
            invalid = {
                "source": "trendforce",
                "kind": "spot",
                "product_id": "announcement",
                "product_name": "Price announcement",
                "cadence": "daily",
                "date": "2026-06-10",
                "values": {"session_average": None},
            }
            original_payload = {"schema_version": 1, "generated_at": "2026-06-10T03:00:00Z", "observations": [invalid]}
            prices_path = output / "prices.json"
            prices_path.write_text(json.dumps(original_payload), encoding="utf-8")
            status = {
                "generated_at": "2026-06-10T03:00:00Z",
                "sources": [
                    {
                        "source": "trendforce",
                        "ok": True,
                        "observation_count": 1,
                        "urls": ["https://example.test/source"],
                        "warnings": [],
                        "errors": [],
                    }
                ],
            }
            (output / "status.json").write_text(json.dumps(status), encoding="utf-8")

            result = subprocess.run(
                [sys.executable, "-m", "dram_tracker.collect", "--output", str(output), "--rebuild-only"],
                cwd=ROOT,
                env={**os.environ, "PYTHONPATH": str(ROOT / "src")},
                text=True,
                capture_output=True,
                check=False,
            )

            self.assertNotEqual(result.returncode, 0)
            self.assertIn("no valid stored price observations", result.stderr)
            self.assertEqual(json.loads(prices_path.read_text(encoding="utf-8")), original_payload)
            self.assertFalse((output / "series.json").exists())
            self.assertFalse((output / "summary.json").exists())

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
