from __future__ import annotations

from datetime import datetime, timezone
import unittest

from scripts.update_automation_health import update_health


class AutomationHealthTests(unittest.TestCase):
    def setUp(self) -> None:
        self.warning_status = {
            "sources": [
                {"source": "trendforce", "ok": True, "warnings": [], "errors": []},
                {"source": "memorymarket", "ok": True, "warnings": ["one timeout"], "errors": []},
            ]
        }
        self.now = datetime(2026, 7, 10, 4, 20, tzinfo=timezone.utc)

    def assess(self, previous=None, status=None, **outcomes):
        return update_health(
            previous or {},
            status if status is not None else self.warning_status,
            collection_outcome=outcomes.get("collection", "success"),
            target_outcome=outcomes.get("target", "success"),
            tests_outcome=outcomes.get("tests", "success"),
            publication_outcome=outcomes.get("publication", "success"),
            target_date="2026-07-10",
            now=self.now,
        )

    def test_three_consecutive_warning_runs_trigger_alert(self) -> None:
        state = self.assess()
        self.assertFalse(state["alertRequired"])
        state = self.assess(state)
        self.assertFalse(state["alertRequired"])
        state = self.assess(state)
        self.assertTrue(state["alertRequired"])
        self.assertEqual(state["consecutiveWarningRuns"], 3)

    def test_clean_run_resets_warning_streak(self) -> None:
        state = self.assess({"consecutiveWarningRuns": 2})
        clean_status = {"sources": [{"source": "trendforce", "ok": True, "warnings": [], "errors": []}]}
        state = self.assess(state, status=clean_status)
        self.assertEqual(state["status"], "ok")
        self.assertEqual(state["consecutiveWarningRuns"], 0)

    def test_blocking_failures_have_an_independent_streak(self) -> None:
        state = {}
        for _ in range(3):
            state = self.assess(state, collection="failure", target="skipped", tests="skipped", publication="skipped")
        self.assertEqual(state["status"], "blocked")
        self.assertEqual(state["consecutiveBlockingFailures"], 3)
        self.assertTrue(state["alertRequired"])

    def test_source_errors_are_blocking(self) -> None:
        status = {"sources": [{"source": "trendforce", "ok": False, "warnings": [], "errors": ["parse failed"]}]}
        state = self.assess(status=status)
        self.assertEqual(state["status"], "blocked")
        self.assertIn("source_errors:1", state["blockingReasons"])


if __name__ == "__main__":
    unittest.main()
