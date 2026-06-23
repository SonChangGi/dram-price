from __future__ import annotations

from pathlib import Path
import re
import unittest

ROOT = Path(__file__).resolve().parents[1]
UPDATE_WORKFLOW = ROOT / ".github" / "workflows" / "update-data.yml"
DEPLOY_WORKFLOW = ROOT / ".github" / "workflows" / "deploy-pages.yml"
SKIP_MARKER = "Skip-Pages-Deploy: update-data-workflow"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class WorkflowContractTests(unittest.TestCase):
    def test_update_workflow_has_scheduled_refresh_with_backfill_branch_preserved(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("schedule:", workflow)
        self.assertIn('cron: "0 0 * * *"', workflow)
        self.assertIn('cron: "0 21 * * *"', workflow)
        self.assertIn("09:00 KST daily", workflow)
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

    def test_manual_runs_stay_fail_fast_while_schedules_soft_fail_provider_outages(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        scheduled_guard = "continue-on-error: ${{ github.event_name == 'schedule' }}"
        self.assertEqual(4, workflow.count(scheduled_guard))
        self.assertIn("Scheduled-source guards keep provider outages visible", workflow)
        self.assertIn("Report scheduled collection failure", workflow)
        self.assertIn("Report scheduled target-date miss", workflow)
        self.assertIn("Report scheduled test failure", workflow)
        self.assertIn("::warning::Scheduled DRAM collection failed", workflow)
        self.assertIn("::warning::Scheduled collection finished", workflow)
        self.assertIn("::warning::Scheduled validation failed", workflow)

    def test_update_workflow_commits_and_deploys_only_after_publication_gate(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        pre_publication_gate = (
            "steps.freshness.outputs.should_collect == 'true' && "
            "steps.collect.outcome == 'success' && "
            "(steps.freshness.outputs.target_date == '' || steps.verify_target_date.outcome == 'success') && "
            "steps.tests.outcome == 'success'"
        )
        required_gate = pre_publication_gate + " && steps.publication.outcome == 'success'"
        self.assertIn(
            f"- name: Validate public data publication floor\n        id: publication\n        if: {pre_publication_gate}",
            workflow,
        )
        self.assertIn("run: python scripts/validate_publication.py", workflow)
        for step_name in ("Commit data changes", "Prepare static site"):
            self.assertIn(f"- name: {step_name}\n        if: {required_gate}", workflow)
        for action, tag in (("actions/configure-pages", "v5"), ("actions/upload-pages-artifact", "v3")):
            self.assertRegex(
                workflow,
                rf"- uses: {re.escape(action)}@[0-9a-f]{{40}} # {tag}\n        if: {re.escape(required_gate)}",
            )
        self.assertRegex(
            workflow,
            rf"- id: deployment\n        if: {re.escape(required_gate)}\n        uses: actions/deploy-pages@[0-9a-f]{{40}} # v4",
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
