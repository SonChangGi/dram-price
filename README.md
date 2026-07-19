# DRAM Price Tracker

A personal static dashboard for tracking DRAM prices from public pages.

## What it tracks

- **TrendForce / DRAMeXchange current spot prices** from the public DRAM spot table.
- **TrendForce / DRAMeXchange current contract prices** from the public contract table.
- **MemoryMarket / CFM weekly spot proxy history** for publicly listed DRAM products, typically the past six months.

The project stores normalized JSON in `data/` and renders a static dashboard from `web/`, so it can run on GitHub Pages without a server.

The dashboard includes source, price-kind, category, product, metric, and explicit chart-series limit controls. Representative products are highlighted by default, and selecting **All products** plus **All matching series** graphs every collected series.

## Local setup

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
PYTHONPATH=src python -m dram_tracker.collect --fixture-dir tests/fixtures --output tmp/test-data
PYTHONPATH=src python -m dram_tracker.collect --output data --limit-products 5
python -m http.server 8000
```

Open `http://localhost:8000/web/` after starting the static server.

## Data files

- `data/prices.json` — normalized observations.
- `data/series.json` — product/series metadata and representative defaults.
- `data/status.json` — collection timestamp, source status, counts, and caveats.
- `data/automation-health.json` — 최근 수집 시도의 source warning, target-date miss, 검증 실패 연속 횟수와 escalation 상태.

Observation fields include `source`, `kind` (`spot`, `contract`, `spot_proxy`), `cadence`, `product_id`, `product_name`, `date`, `effective_date`, `collected_at`, `currency`, and a source-specific `values` object.
When available, observations also include `category` (for example `ddr`, `rdimm`, `sodimm`, `lpddr`, `ddr4`, or `ddr5`) so the dashboard can filter source/category/product independently.

## GitHub Actions automation

Two workflows are included:

- `.github/workflows/update-data.yml` runs scheduled public-source refreshes at 09:15 KST on weekdays, with 11:15/13:15 KST weekday retries that verify today when TrendForce publishes late. Weekends are skipped because the required TrendForce daily spot rows are not expected then. A reviewed `workflow_dispatch` run still forces collection, re-checks the requested target date before tests/commit/deploy, validates the public data publication floor, commits `data/` only when safe data changes exist, and deploys the refreshed static site to GitHub Pages in the same workflow. Scheduled provider outages never publish partial market data. Each attempted collection updates `automation-health.json`; source warnings and blocking collection/target/test/publication failures have independent streaks. Once a persisted streak reaches its alert threshold, only the final 13:15 KST weekday retry may fail for notification, limiting scheduled failure mail to at most one per weekday while the earlier retries remain soft warnings.
- `.github/workflows/deploy-pages.yml` still publishes `web/` plus `data/` to GitHub Pages for manual dispatches and normal dashboard/data pushes made outside the update-data workflow path. Data commits from `update-data.yml` include the explicit `Skip-Pages-Deploy: update-data-workflow` trailer, and `deploy-pages.yml` uses that marker to avoid re-entering a second Pages deploy because `update-data.yml` already deployed the same artifact.

The dashboard also links to the manual **Update DRAM price data** workflow page. A browser button cannot safely trigger collection by itself without exposing a GitHub token, so manual refreshes intentionally require a signed-in GitHub account with repository write access. GitHub Actions runs on GitHub-hosted infrastructure after dispatch, so the refresh does not depend on your computer staying on or connected to Wi-Fi.

To enable Pages, create the repository on GitHub, push this branch, then enable **Settings → Pages → GitHub Actions**.

The project intentionally stores collected observations in committed JSON files rather than relying on only the latest source pages. The daily collector reads the existing `data/prices.json`, merges newly collected rows by `source + kind + product_id + cadence + date`, and writes the normalized result back to `data/`. That means a new day adds a new observation while a repeated scrape of the same source/date updates that row. `series.json` and `status.json` are regenerated from the merged observation set so the dashboard can safely load one static dataset on GitHub Pages.

## Source caveats

- Public TrendForce/DRAMeXchange pages expose current tables; free historical TrendForce/DRAMeXchange data is not assumed.
- MemoryMarket publicly discloses recent weekly history for product pages and states that price data is copyrighted. Use this project for personal tracking/research and review source terms before broad redistribution.
- HTML pages can change. The collector uses a best-effort policy for this personal tracker: parser/source failures are recorded in `data/status.json`, old observations are preserved, and the command exits non-zero only when every source fails and no stored observations remain. TrendForce rows require a source update timestamp; missing source date metadata is treated as a source failure instead of inventing an effective date. If the requested date is still missing after collection, the workflow leaves a warning and skips commit/deploy instead of publishing a misleading freshness timestamp; strict manual runs still fail so the condition can be debugged.
- A failed collection may commit only `data/automation-health.json` with the explicit Pages skip marker. Generated price/series/status files from that failed attempt are not staged, so monitoring history cannot accidentally publish partial market data.

## Representative defaults

The dashboard highlights common series such as DDR5 16Gb, DDR4 16Gb 3200, DDR4 8Gb 3200, and key SO-DIMM contract rows when available. All collected products remain selectable.
