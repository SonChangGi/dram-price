# DRAM Price Tracker

A personal static dashboard for tracking DRAM prices from public pages.

## What it tracks

- **TrendForce / DRAMeXchange current spot prices** from the public DRAM spot table.
- **TrendForce / DRAMeXchange current contract prices** from the public contract table.
- **MemoryMarket / CFM weekly spot proxy history** for publicly listed DRAM products, typically the past six months.

The project stores normalized JSON in `data/` and builds the GitHub Pages dashboard from `frontend/` with React, strict TypeScript, Vite, Tailwind CSS v4, and shadcn-style Radix primitives. It remains a static site and does not require an application server.

The result-first screen shows collection status, the true latest observation date, six balanced representative prices, and the primary price chart before detail. Spot prices, representative products, and automatic metric selection are the defaults. Price kind and product stay visible; source, category, and metric live in the advanced disclosure. The chart facets incompatible price kinds, currencies, and actual metrics, requires at least two dates for a trend, and caps each facet at five readable series. All matching observations remain available in the latest list, which starts at 10 rows and can expand to 50, using table rows on desktop and cards on mobile.

## Local setup

```bash
PYTHONPATH=src python -m unittest discover -s tests -v
PYTHONPATH=src python -m dram_tracker.collect --fixture-dir tests/fixtures --output tmp/test-data
PYTHONPATH=src python -m dram_tracker.collect --output data --limit-products 5

cd frontend
npm ci
npm run verify
npm run dev
```

Open the Vite URL printed by `npm run dev` (normally `http://localhost:5173/dram-price/`). The development server reads the repository's `../data/*.json` files with `no-store`; production builds copy the same five public JSON files into `frontend/dist/data/`.

Frontend commands are `npm run typecheck`, `npm run lint`, `npm run test`, `npm run build`, and the aggregate `npm run verify`. The Vite production base is fixed to `/dram-price/` for project Pages.

## Data files

- `data/prices.json` — normalized observations.
- `data/series.json` — product/series metadata and representative defaults.
- `data/status.json` — collection timestamp, source status, counts, and caveats.
- `data/automation-health.json` — 최근 수집 시도의 source warning, target-date miss, 검증 실패 연속 횟수와 escalation 상태.

Observation fields include `source`, `kind` (`spot`, `contract`, `spot_proxy`), `cadence`, `product_id`, `product_name`, `date`, `effective_date`, `collected_at`, `currency`, and a source-specific `values` object.
When available, observations also include `category` (for example `ddr`, `rdimm`, `sodimm`, `lpddr`, `ddr4`, or `ddr5`) so the dashboard can filter source/category/product independently.

## GitHub Actions automation

Two workflows are included:

- `.github/workflows/update-data.yml` runs scheduled public-source refreshes at 09:15 KST on weekdays, with 11:15/13:15 KST weekday retries that verify today when TrendForce publishes late. Weekends are skipped because the required TrendForce daily spot rows are not expected then. A reviewed `workflow_dispatch` run still forces collection, re-checks the requested target date, runs Python publication checks plus the locked frontend verification, commits `data/` only when safe data changes exist, and deploys `frontend/dist/` with all public JSON contracts in the same workflow. Scheduled provider outages never publish partial market data. Each attempted collection updates `automation-health.json`; source warnings and blocking collection/target/test/publication failures have independent streaks. Once a persisted streak reaches its alert threshold, only the final 13:15 KST weekday retry may fail for notification, limiting scheduled failure mail to at most one per weekday while the earlier retries remain soft warnings.
- `.github/workflows/deploy-pages.yml` installs from `frontend/package-lock.json`, runs the complete frontend verifier, and publishes `frontend/dist/` plus `data/` for manual dispatches and normal UI/data pushes made outside the update-data workflow path. Data commits from `update-data.yml` include the explicit `Skip-Pages-Deploy: update-data-workflow` trailer, and `deploy-pages.yml` uses that marker to avoid re-entering a second Pages deploy because `update-data.yml` already deployed the same artifact.

The dashboard also links to the manual **Update DRAM price data** workflow page. A browser button cannot safely trigger collection by itself without exposing a GitHub token, so manual refreshes intentionally require a signed-in GitHub account with repository write access. GitHub Actions runs on GitHub-hosted infrastructure after dispatch, so the refresh does not depend on your computer staying on or connected to Wi-Fi.

To enable Pages, create the repository on GitHub, push this branch, then enable **Settings → Pages → GitHub Actions**.

The project intentionally stores collected observations in committed JSON files rather than relying on only the latest source pages. The daily collector reads the existing `data/prices.json`, merges newly collected rows by `source + kind + product_id + cadence + date`, and writes the normalized result back to `data/`. That means a new day adds a new observation while a repeated scrape of the same source/date updates that row. `series.json` and `status.json` are regenerated from the merged observation set so the dashboard can safely load one static dataset on GitHub Pages.

## Source caveats

- Public TrendForce/DRAMeXchange pages expose current tables; free historical TrendForce/DRAMeXchange data is not assumed.
- MemoryMarket publicly discloses recent weekly history for product pages and states that price data is copyrighted. Use this project for personal tracking/research and review source terms before broad redistribution.
- HTML pages can change. The collector uses a best-effort policy for this personal tracker: parser/source failures are recorded in `data/status.json`, old observations are preserved, and the command exits non-zero only when every source fails and no stored observations remain. TrendForce rows require a source update timestamp; missing source date metadata is treated as a source failure instead of inventing an effective date. If the requested date is still missing after collection, the workflow leaves a warning and skips commit/deploy instead of publishing a misleading freshness timestamp; strict manual runs still fail so the condition can be debugged.
- A failed collection may commit only `data/automation-health.json`. That health-only commit intentionally triggers the normal validated Pages workflow so the public operations state is current; generated price/series/status files from the failed attempt are not staged, so monitoring history cannot accidentally publish partial market data.

## Representative defaults

The dashboard highlights common series such as DDR5 16Gb, DDR4 16Gb 3200, DDR4 8Gb 3200, and key SO-DIMM contract rows when available. All collected products remain selectable.
