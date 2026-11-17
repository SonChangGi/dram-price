from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]
DEPLOY_WORKFLOW = ROOT / '.github/workflows/deploy-pages.yml'


def _read(path):
    return path.read_text(encoding='utf-8')


class WorkflowContractTests(unittest.TestCase):
    def test_original_collection_is_retired_without_disabling_page_publication(self):
        self.assertFalse((ROOT / '.github/workflows/update-data.yml').exists())
        for path in (ROOT / '.github/workflows').glob('*.yml'):
            workflow = _read(path)
            self.assertNotRegex(workflow, r'(?m)^  schedule:')
            self.assertNotIn('dram_tracker.collect', workflow)
        deploy = _read(DEPLOY_WORKFLOW)
        self.assertIn('workflow_dispatch:', deploy)
        self.assertIn('  push:', deploy)
        self.assertIn('contents: read', deploy)
        self.assertNotIn('Skip-Pages-Deploy:', deploy)
        self.assertNotIn('git push', deploy)

    def test_pages_workflows_build_the_locked_frontend_and_include_public_contracts(self) -> None:
        deploy = _read(DEPLOY_WORKFLOW)
        for workflow in (deploy,):
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


    def test_pages_workflows_share_a_non_cancelling_deployment_queue(self) -> None:
        for workflow in (_read(DEPLOY_WORKFLOW),):
            self.assertIn("group: dram-price-pages", workflow)
            self.assertIn("cancel-in-progress: false", workflow)
        self.assertNotIn("cancel-in-progress: true", _read(DEPLOY_WORKFLOW))


    def test_pages_workflows_verify_live_public_data_bytes_after_deploy(self) -> None:
        for workflow in (_read(DEPLOY_WORKFLOW),):
            self.assertIn("Verify live public data bytes", workflow)
            self.assertIn("steps.deployment.outputs.page_url", workflow)
            self.assertIn(
                "for relative_path in data/prices.json data/series.json data/status.json data/summary.json data/automation-health.json",
                workflow,
            )
            self.assertIn('cmp --silent "frontend/dist/${relative_path}" "$readback"', workflow)
            self.assertLess(workflow.index("actions/deploy-pages@"), workflow.index("Verify live public data bytes"))


    def test_validation_failure_is_visible_while_public_site_is_checked_separately(self) -> None:
        deploy = _read(DEPLOY_WORKFLOW)
        deploy_job = deploy.split("  deploy:", 1)[1].split("  public-site-health:", 1)[0]
        self.assertNotIn("continue-on-error:", deploy_job)
        for workflow in (deploy,):
            self.assertIn("public-site-health:", workflow)
            self.assertIn("required_paths=(index.html data/summary.json data/prices.json)", workflow)



if __name__ == '__main__':
    unittest.main()
