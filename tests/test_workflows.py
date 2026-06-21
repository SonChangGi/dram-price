from __future__ import annotations

from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
UPDATE_WORKFLOW = ROOT / ".github" / "workflows" / "update-data.yml"
DEPLOY_WORKFLOW = ROOT / ".github" / "workflows" / "deploy-pages.yml"
SKIP_MARKER = "Skip-Pages-Deploy: update-data-workflow"


def _read(path: Path) -> str:
    return path.read_text(encoding="utf-8")


class WorkflowContractTests(unittest.TestCase):
    def test_update_workflow_is_manual_only_after_rollback_with_backfill_branch_preserved(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("Automatic source refresh is suspended", workflow)
        self.assertNotIn("schedule:", workflow)
        self.assertNotIn("cron:", workflow)
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

    def test_manual_runs_stay_fail_fast_while_legacy_schedule_guards_remain_dormant(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        scheduled_guard = "continue-on-error: ${{ github.event_name == 'schedule' }}"
        self.assertEqual(4, workflow.count(scheduled_guard))
        self.assertIn("# suspended. Manual dispatch stays fail-fast", workflow)
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
        for action in ("actions/configure-pages@v5", "actions/upload-pages-artifact@v3"):
            self.assertIn(f"- uses: {action}\n        if: {required_gate}", workflow)
        self.assertIn(f"- id: deployment\n        if: {required_gate}\n        uses: actions/deploy-pages@v4", workflow)

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
