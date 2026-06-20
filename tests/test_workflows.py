from __future__ import annotations

from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
UPDATE_WORKFLOW = ROOT / ".github" / "workflows" / "update-data.yml"
DEPLOY_WORKFLOW = ROOT / ".github" / "workflows" / "deploy-pages.yml"
SKIP_MARKER = "Skip-Pages-Deploy: update-data-workflow"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class WorkflowContractTests(unittest.TestCase):
    def test_update_workflow_has_expected_kst_schedules_and_backfill_branch(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("cron: '20 9 * * *'", workflow)
        self.assertIn("18:20 KST", workflow)
        self.assertIn("cron: '0 21 * * *'", workflow)
        self.assertIn("06:00 KST", workflow)
        self.assertIn('elif [ "$SCHEDULE" = "0 21 * * *" ]; then', workflow)
        self.assertIn("args+=(--require-daily-date yesterday)", workflow)
        self.assertIn("args+=(--require-daily-date today)", workflow)

    def test_update_workflow_has_explicit_completeness_post_check(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("--minimum-daily-spot-rows 2", workflow)
        self.assertIn("id: collect", workflow)
        self.assertIn("id: verify_target_date", workflow)
        self.assertIn("Verify requested daily data after collection", workflow)
        self.assertIn('--require-daily-date "${{ steps.freshness.outputs.target_date }}"', workflow)
        self.assertIn("--fail-if-collect-needed", workflow)
        self.assertLess(workflow.index("Verify requested daily data after collection"), workflow.index("Run tests"))
        self.assertLess(workflow.index("Verify requested daily data after collection"), workflow.index("Commit data changes"))

    def test_scheduled_update_failures_are_suppressed_but_manual_runs_stay_fail_fast(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        scheduled_guard = "continue-on-error: ${{ github.event_name == 'schedule' }}"
        self.assertEqual(4, workflow.count(scheduled_guard))
        self.assertIn("# Manual dispatch stays fail-fast", workflow)
        self.assertIn("Report scheduled collection failure", workflow)
        self.assertIn("Report scheduled target-date miss", workflow)
        self.assertIn("Report scheduled test failure", workflow)
        self.assertIn("::warning::Scheduled DRAM collection failed", workflow)
        self.assertIn("::warning::Scheduled collection finished", workflow)
        self.assertIn("::warning::Scheduled validation failed", workflow)
        self.assertIn("Write scheduled automation failure marker", workflow)
        self.assertIn("Commit scheduled automation failure marker", workflow)
        self.assertIn("Prepare degraded static site", workflow)
        self.assertIn("git checkout -- data/prices.json data/series.json data/status.json data/summary.json", workflow)
        self.assertIn("--state degraded", workflow)
        self.assertIn("Directive: do not commit prices/series/status/summary from failed scheduled runs", workflow)

    def test_update_workflow_commits_and_deploys_only_after_clean_collection(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        required_gate = (
            "steps.freshness.outputs.should_collect == 'true' && "
            "steps.collect.outcome == 'success' && "
            "(steps.freshness.outputs.target_date == '' || steps.verify_target_date.outcome == 'success') && "
            "steps.tests.outcome == 'success'"
        )
        for step_name in ("Commit data changes", "Prepare static site"):
            self.assertIn(f"- name: {step_name}\n        if: {required_gate}", workflow)
        for action in (
            "actions/configure-pages@983d7736d9b0ae728b81ab479565c72886d7745b # v5",
            "actions/upload-pages-artifact@56afc609e74202658d3ffba0e8f6dda462b719fa # v3",
        ):
            self.assertIn(f"- uses: {action}\n        if: {required_gate}", workflow)
        self.assertIn(f"- id: deployment\n        if: {required_gate}\n        uses: actions/deploy-pages@d6db90164ac5ed86f2b6aed7e0febac5b3c0c03e # v4", workflow)
        self.assertIn(
            "if: steps.freshness.outputs.should_collect == 'true' && steps.collect.outcome == 'success' && "
            "(steps.freshness.outputs.target_date == '' || steps.verify_target_date.outcome == 'success')",
            workflow,
        )

    def test_update_workflow_marks_self_deployed_commits_explicitly(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn(SKIP_MARKER, workflow)
        self.assertIn("git config user.email", workflow)

    def test_deploy_workflow_uses_explicit_skip_marker_not_bot_identity(self) -> None:
        workflow = _read(DEPLOY_WORKFLOW)
        self.assertIn(SKIP_MARKER, workflow)
        self.assertIn("github.event.head_commit.message", workflow)
        self.assertNotIn("github-actions[bot]", workflow)
        self.assertNotIn("41898282+github-actions[bot]@users.noreply.github.com", workflow)


if __name__ == "__main__":
    unittest.main()

class WebAutomationStatusContractTests(unittest.TestCase):
    def test_web_app_loads_and_renders_automation_status_marker(self) -> None:
        app = _read(ROOT / "web" / "app.js")
        self.assertIn("automation-status.json", app)
        self.assertIn("loadAutomationStatus", app)
        self.assertIn("automationLabel", app)
        self.assertIn("priceDataPolicy", app)
        marker = json.loads((ROOT / "data" / "automation-status.json").read_text(encoding="utf-8"))
        self.assertEqual(marker["schemaVersion"], 1)
        self.assertIn(marker["state"], {"ok", "degraded", "stale"})
        self.assertIn("never publishes newly collected price observations", marker["priceDataPolicy"])
