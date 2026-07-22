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
    def test_update_workflow_has_staggered_scheduled_refresh_loop(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("workflow_dispatch:", workflow)
        self.assertIn("schedule:", workflow)
        self.assertIn('cron: "15 0 * * 1-5"', workflow)
        self.assertIn('cron: "15 2 * * 1-5"', workflow)
        self.assertIn("09:15 KST weekdays", workflow)
        self.assertIn('cron: "15 4 * * 1-5"', workflow)
        self.assertNotRegex(workflow, r'cron: "15 [024] \* \* \*"')
        self.assertNotIn("--require-daily-date yesterday", workflow)
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
        required_gate = pre_publication_gate + " && steps.publication.outcome == 'success' && steps.health.outcome == 'success'"
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

    def test_pages_workflows_build_the_locked_frontend_and_include_public_contracts(self) -> None:
        update = _read(UPDATE_WORKFLOW)
        deploy = _read(DEPLOY_WORKFLOW)
        for workflow in (update, deploy):
            self.assertRegex(workflow, r"actions/setup-node@[0-9a-f]{40} # v4")
            self.assertIn("cache-dependency-path: frontend/package-lock.json", workflow)
            self.assertIn("npm ci --prefix frontend", workflow)
            self.assertIn("npm run verify --prefix frontend", workflow)
            self.assertIn("cp -R data/. frontend/dist/data/", workflow)
            self.assertIn("path: frontend/dist", workflow)
            self.assertNotIn("cp -R web/. site/", workflow)
        self.assertIn("- 'frontend/**'", deploy)
        self.assertRegex(deploy, r"actions/setup-python@[0-9a-f]{40} # v5")
        self.assertIn("python -m unittest discover -s tests -v", deploy)
        self.assertIn("python scripts/validate_publication.py", deploy)
        self.assertLess(deploy.index("Validate backend and public data"), deploy.index("Verify and build frontend"))

    def test_update_workflow_persists_and_escalates_repeated_degradation(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("Update persistent automation health", workflow)
        self.assertIn("scripts/update_automation_health.py", workflow)
        self.assertIn("data/automation-health.json", workflow)
        self.assertIn("Commit automation health without partial market data", workflow)
        self.assertIn("git add data/automation-health.json", workflow)
        self.assertIn("Escalate repeated automation degradation", workflow)
        self.assertIn("steps.health.outputs.alert_required == 'true'", workflow)
        self.assertIn("github.event_name == 'workflow_dispatch'", workflow)
        self.assertIn("github.event.schedule == '15 4 * * 1-5'", workflow)
        self.assertIn("limiting scheduled failure notifications to one per day", workflow)
        self.assertLess(workflow.index("Update persistent automation health"), workflow.index("Commit data changes"))

    def test_update_workflow_marks_self_deployed_commits_explicitly(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        data_commit = workflow.split("- name: Commit data changes", 1)[1].split(
            "- name: Commit automation health without partial market data", 1
        )[0]
        health_commit = workflow.split("- name: Commit automation health without partial market data", 1)[1].split(
            "- name: Prepare static site", 1
        )[0]
        self.assertIn(SKIP_MARKER, data_commit)
        self.assertNotIn(SKIP_MARKER, health_commit)
        self.assertIn("git config user.email", workflow)

    def test_deploy_workflow_uses_explicit_skip_marker_not_bot_identity(self) -> None:
        workflow = _read(DEPLOY_WORKFLOW)
        self.assertIn(SKIP_MARKER, workflow)
        self.assertIn("github.event.head_commit.message", workflow)
        self.assertNotIn("github-actions[bot]", workflow)
        self.assertNotIn("41898282+github-actions[bot]@users.noreply.github.com", workflow)

    def test_pages_workflows_share_a_non_cancelling_deployment_queue(self) -> None:
        for workflow in (_read(UPDATE_WORKFLOW), _read(DEPLOY_WORKFLOW)):
            self.assertIn("group: dram-price-pages", workflow)
            self.assertIn("cancel-in-progress: false", workflow)
        self.assertNotIn("cancel-in-progress: true", _read(DEPLOY_WORKFLOW))


if __name__ == "__main__":
    unittest.main()
