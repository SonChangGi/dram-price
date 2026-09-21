from __future__ import annotations

from pathlib import Path
import re
import subprocess
import tempfile
import textwrap
import json
import os
import sys
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
        self.assertIn('cron: "15 4 * * 1-5"', workflow)
        self.assertIn('cron: "15 6 * * 1-5"', workflow)
        self.assertIn("13:15 KST weekdays", workflow)
        self.assertIn('cron: "30 10 * * 1-5"', workflow)
        self.assertNotRegex(workflow, r'cron: "15 [468] \* \* \*"')
        self.assertNotIn("--require-daily-date yesterday", workflow)
        self.assertIn('args+=(--require-daily-date "${MANUAL_TARGET:-today}")', workflow)
        self.assertIn("target_date:", workflow)
        for cron in ("30 13 * * 1-5", "30 16 * * 1-5", "30 19 * * 1-5"):
            self.assertIn(f'cron: "{cron}"', workflow)
        self.assertIn('run_created_at="$(gh api "repos/$GITHUB_REPOSITORY/actions/runs/$GITHUB_RUN_ID" --jq .created_at)"', workflow)
        self.assertIn('--now "$run_created_at"', workflow)
        self.assertIn('args+=(--schedule "$SCHEDULE")', workflow)
        self.assertIn("actions: read", workflow)

    def test_failed_automation_is_retried_even_with_current_prices(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn('[ "$needs_recovery" = "true" ]; then', workflow)
        script = textwrap.dedent(workflow.split("<<'PYHEALTH'\n", 1)[1].split("          PYHEALTH", 1)[0])
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "data" / "automation-health.json"
            path.parent.mkdir()
            for payload, expected in (({"status": "ok"}, "false"), ({"status": "blocked"}, "true"),
                                      ({"status": "warning"}, "true"), ({}, "true"), ([], "true")):
                path.write_text(json.dumps(payload))
                actual = subprocess.check_output(["python3", "-c", script], cwd=directory, text=True).strip()
                self.assertEqual(actual, expected)
            path.write_text("invalid json")
            self.assertEqual(subprocess.check_output(["python3", "-c", script], cwd=directory, text=True).strip(), "true")
            path.unlink()
            self.assertEqual(subprocess.check_output(["python3", "-c", script], cwd=directory, text=True).strip(), "true")

    def test_scheduled_decision_shell_uses_frozen_run_timestamp_and_rejects_invalid_manual_date(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        step = workflow.split("- name: Decide whether collection is needed", 1)[1].split("- name: Report freshness decision", 1)[0]
        script = textwrap.dedent(step.split("        run: |\n", 1)[1])
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            binary = root / "bin"
            binary.mkdir()
            (binary / "gh").write_text('#!/bin/sh\nprintf "%s\\n" "$TEST_RUN_CREATED_AT"\n')
            (binary / "gh").chmod(0o755)
            (binary / "python").symlink_to(sys.executable)
            data = root / "data"
            data.mkdir()
            (data / "automation-health.json").write_text('{"status":"ok"}')
            env = {**os.environ, "PATH": f"{binary}:{os.environ['PATH']}", "PYTHONPATH": str(ROOT / "src"),
                   "GITHUB_REPOSITORY": "owner/repo", "GITHUB_RUN_ID": "123", "GITHUB_OUTPUT": str(root / "outputs"),
                   "EVENT_NAME": "schedule", "SCHEDULE": "30 19 * * 1-5", "MANUAL_TARGET": "",
                   "TEST_RUN_CREATED_AT": "2026-09-22T00:30:00Z"}
            result = subprocess.run(["bash", "-c", script], cwd=root, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("target_date=2026-09-21", result.stdout)
            self.assertIn("minimum_source_time=17:50", result.stdout)
            env.update(EVENT_NAME="workflow_dispatch", SCHEDULE="", MANUAL_TARGET="2026-09-18")
            result = subprocess.run(["bash", "-c", script], cwd=root, env=env, text=True, capture_output=True)
            self.assertEqual(result.returncode, 0, result.stderr)
            self.assertIn("target_date=2026-09-18", result.stdout)
            env["MANUAL_TARGET"] = "not-a-date"
            result = subprocess.run(["bash", "-c", script], cwd=root, env=env, text=True, capture_output=True)
            self.assertNotEqual(result.returncode, 0, "tee must not hide a failed target-date resolution")

    def test_update_workflow_has_explicit_completeness_post_check(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertIn("--minimum-daily-spot-rows 7", workflow)
        self.assertEqual(workflow.count("--require-known-spot-products"), 2)
        self.assertIn("id: collect", workflow)
        self.assertIn("id: verify_target_date", workflow)
        self.assertIn("Verify requested daily data after collection", workflow)
        self.assertIn('--require-daily-date "${{ steps.freshness.outputs.target_date }}"', workflow)
        self.assertIn("--fail-if-collect-needed", workflow)
        self.assertIn('--minimum-source-time "${{ steps.freshness.outputs.minimum_source_time }}"', workflow)
        self.assertIn('--target-date "${{ steps.freshness.outputs.target_date }}" --history-dir history/trendforce-spot', workflow)
        self.assertLess(workflow.index("Verify requested daily data after collection"), workflow.index("Run tests"))
        self.assertLess(workflow.index("Verify requested daily data after collection"), workflow.index("Commit data changes"))

    def test_manual_runs_stay_fail_fast_while_schedules_soft_fail_provider_outages(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        scheduled_guard = "continue-on-error: ${{ github.event_name == 'schedule' }}"
        self.assertEqual(5, workflow.count(scheduled_guard))
        self.assertIn("Scheduled-source guards keep provider outages visible", workflow)
        self.assertIn("A separate public-site health job is the only", workflow)
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
        required_gate = pre_publication_gate + " && steps.publication.outcome == 'success' && steps.health.outcome == 'success' && steps.promote.outcome == 'success'"
        self.assertIn(
            f"- name: Validate public data publication floor\n        id: publication\n        if: {pre_publication_gate}",
            workflow,
        )
        self.assertIn("run: python scripts/validate_publication.py", workflow)
        self.assertIn(f"- name: Commit data changes\n        id: data_commit\n        if: {required_gate}", workflow)
        self.assertIn(f"(({required_gate} && steps.data_commit.outcome == 'success') || steps.health_frontend.outcome == 'success')", workflow)
        self.assertIn("id: site", workflow)
        for action, dependency in (("actions/configure-pages", "steps.site.outcome == 'success'"),
                                   ("actions/upload-pages-artifact", "steps.pages_configure.outcome == 'success'")):
            action_block = workflow.split(f"- uses: {action}@", 1)[1].split("      - ", 1)[0]
            self.assertIn(dependency, action_block)
            self.assertIn("!cancelled()", action_block)
        deployment = workflow.split("- id: deployment", 1)[1].split("      - ", 1)[0]
        self.assertIn("steps.pages_upload.outcome == 'success'", deployment)
        readback = workflow.split("- name: Verify live public data bytes", 1)[1].split("      - ", 1)[0]
        self.assertIn("steps.deployment.outcome == 'success'", readback)

    def test_failed_collection_publishes_health_only_after_verifying_last_good_data(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        health = workflow.split("- name: Verify last-good data for health-only publication", 1)[1].split(
            "- name: Prepare static site", 1)[0]
        self.assertIn("steps.health_commit.outcome == 'success'", health)
        self.assertIn("steps.promote.outcome == 'skipped'", health)
        self.assertIn("steps.tests.outcome == 'skipped' || steps.tests.outcome == 'success'", health)
        self.assertIn("git diff --exit-code -- data/prices.json data/series.json data/status.json data/summary.json", health)
        self.assertIn("python scripts/validate_publication.py", health)
        self.assertIn('if [ "$TESTS_OUTCOME" != "success" ]; then', health)
        self.assertIn("python -m unittest discover -s tests -v", health)
        self.assertIn("npm ci --prefix frontend", health)
        self.assertIn("npm run verify --prefix frontend", health)
        self.assertNotIn("dram-candidate", health)
        self.assertNotIn("continue-on-error", health)
        self.assertLess(workflow.index("Commit automation health without partial market data"),
                        workflow.index("Verify last-good data for health-only publication"))
        self.assertLess(workflow.index("Verify last-good data for health-only publication"),
                        workflow.index("actions/configure-pages@"))

    def test_failed_collection_cannot_replace_published_market_data(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        self.assertNotIn("collect --output data", workflow)
        self.assertIn('collect --output "$RUNNER_TEMP/dram-candidate" --attempt-status "$RUNNER_TEMP/dram-attempt-status.json"', workflow)
        self.assertIn('validate_publication.py --data-dir "$RUNNER_TEMP/dram-candidate"', workflow)
        self.assertIn('--status "$RUNNER_TEMP/dram-candidate/status.json"', workflow)
        self.assertIn('--prices "$RUNNER_TEMP/dram-candidate/prices.json"', workflow)
        self.assertIn('--status "$RUNNER_TEMP/dram-attempt-status.json"', workflow)
        self.assertLess(workflow.index("Validate public data publication floor"), workflow.index("Promote verified candidate"))
        self.assertLess(workflow.index("Promote verified candidate"), workflow.index("Commit data changes"))
        promote = workflow.split("- name: Promote verified candidate", 1)[1].split("- name: Commit data changes", 1)[0]
        self.assertIn("steps.publication.outcome == 'success'", promote)
        self.assertIn("steps.health.outcome == 'success'", promote)
        self.assertIn("for artifact in prices.json series.json status.json summary.json", promote)
        self.assertNotIn("automation-health.json", promote)

    def test_verified_source_snapshots_are_preserved_on_success_or_failure_without_publication(self) -> None:
        workflow = _read(UPDATE_WORKFLOW)
        normal = workflow.split("- name: Commit data changes", 1)[1].split("- name: Commit automation health", 1)[0]
        failure = workflow.split("- name: Commit automation health", 1)[1].split("- name: Verify last-good data", 1)[0]
        for block in (normal, failure):
            self.assertIn("git add history/trendforce-spot", block)
            self.assertIn("git diff --cached --quiet", block)
        self.assertIn("git add data/automation-health.json", failure)
        self.assertNotIn("git add data\n", failure)
        prepare = workflow.split("- name: Prepare static site", 1)[1].split("      - uses:", 1)[0]
        self.assertNotIn("history/trendforce-spot", prepare)
        self.assertIn("cp -R data/. frontend/dist/data/", prepare)

    def test_pages_workflows_build_the_locked_frontend_and_include_public_contracts(self) -> None:
        update = _read(UPDATE_WORKFLOW)
        deploy = _read(DEPLOY_WORKFLOW)
        for workflow in (update, deploy):
            self.assertRegex(workflow, r"actions/setup-node@[0-9a-f]{40} # v6")
            self.assertIn("cache-dependency-path: frontend/package-lock.json", workflow)
            self.assertIn("npm ci --prefix frontend", workflow)
            self.assertIn("npm run verify --prefix frontend", workflow)
            self.assertIn("cp -R data/. frontend/dist/data/", workflow)
            self.assertIn("validate_publication.py --data-dir frontend/dist/data", workflow)
            self.assertLess(workflow.index("cp -R data/. frontend/dist/data/"),
                            workflow.index("validate_publication.py --data-dir frontend/dist/data"))
            self.assertIn("path: frontend/dist", workflow)
            self.assertNotIn("cp -R web/. site/", workflow)
        self.assertIn("- 'frontend/**'", deploy)
        self.assertRegex(deploy, r"actions/setup-python@[0-9a-f]{40} # v6")
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
        self.assertIn("Record repeated automation degradation", workflow)
        self.assertIn("steps.health.outputs.alert_required == 'true'", workflow)
        self.assertIn("github.event_name == 'workflow_dispatch'", workflow)
        self.assertIn("github.event.schedule == '30 19 * * 1-5'", workflow)
        degradation_block = workflow.split("Record repeated automation degradation", 1)[1].split(
            "public-site-health:", 1
        )[0]
        self.assertIn("exit 1", degradation_block)
        self.assertIn("public-site-health:", workflow)
        self.assertIn("Fail only when the existing DRAM page is unusable", workflow)
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

    def test_pages_workflows_verify_live_public_data_bytes_after_deploy(self) -> None:
        for workflow in (_read(UPDATE_WORKFLOW), _read(DEPLOY_WORKFLOW)):
            self.assertIn("Verify live public data bytes", workflow)
            self.assertIn("steps.deployment.outputs.page_url", workflow)
            self.assertIn(
                "for relative_path in data/prices.json data/series.json data/status.json data/summary.json data/automation-health.json",
                workflow,
            )
            self.assertIn('cmp --silent "frontend/dist/${relative_path}" "$readback"', workflow)
            self.assertLess(workflow.index("actions/deploy-pages@"), workflow.index("Verify live public data bytes"))

    def test_automatic_failure_mail_is_gated_by_live_page_usability(self) -> None:
        update = _read(UPDATE_WORKFLOW)
        deploy = _read(DEPLOY_WORKFLOW)
        self.assertIn("continue-on-error: ${{ github.event_name == 'schedule' }}", update)
        self.assertIn("continue-on-error: ${{ github.event_name == 'push' }}", deploy)
        for workflow in (update, deploy):
            self.assertIn("public-site-health:", workflow)
            self.assertIn("required_paths=(index.html data/summary.json data/prices.json)", workflow)


if __name__ == "__main__":
    unittest.main()
