# DRAM Price Tracker

A personal static dashboard for tracking DRAM prices from public pages.

## What it tracks

- **TrendForce / DRAMeXchange current spot prices** from the public DRAM spot table.
- **TrendForce / DRAMeXchange current contract prices** from the public contract table.
- **MemoryMarket / CFM weekly and monthly reference-price history** for publicly listed DRAM products, typically the past six months.

The project stores normalized JSON in `data/` and builds the GitHub Pages dashboard from `frontend/` with React, strict TypeScript, Vite, Tailwind CSS v4, and shadcn-style Radix primitives. It remains a static site and does not require an application server.

The frontend also includes a pinned, independently buildable compatibility seam
for the shared Quant Research control contract, canonical 8-destination navigation,
and semantic design tokens. DRAM has no analysis-input controls: all
result-affecting controls are registered as saved-result selectors or
display-only filters, so they can never submit a Python analysis run. See
[`docs/shared-frontend-integration.md`](docs/shared-frontend-integration.md).

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

- `.github/workflows/update-data.yml` runs scheduled public-source refreshes at 13:15 KST on weekdays, with 15:15/19:30/22:30 KST weekday retries and next-morning 01:30/04:30 KST recovery slots. Once the target price date and its stored source statuses are verified complete, all later slots skip actual collection. A later failed attempt does not invalidate those verified observations. Saturday dawn slots target Friday; no new weekend price date is invented. A `workflow_dispatch` run uses the same completion check; an explicit `force_collect=true` can force collection into an isolated candidate. Each actual attempt re-checks its fixed target date and all seven tracked spot products, runs Python publication checks plus the locked frontend verification, commits `data/` only when safe data changes exist, and deploys `frontend/dist/` with all public JSON contracts in the same workflow. Scheduled provider outages never publish partial market data. Each attempted collection updates `automation-health.json`; source warnings and blocking collection/target/test/publication failures have independent streaks. Repeated degradation remains visible in that status and the run summary; the final next-morning 04:30 KST retry records the escalation warning. Scheduled refresh or automatic deploy failures do not produce failure mail while a separate health job can still read the existing public index.html, summary.json, and prices.json. Only that public usability check failing after retries is an automatic failure signal; reviewed manual dispatch remains strict.
- `.github/workflows/deploy-pages.yml` installs from `frontend/package-lock.json`, runs the complete frontend verifier, and publishes `frontend/dist/` plus `data/` for manual dispatches and normal UI/data pushes made outside the update-data workflow path. Data commits from `update-data.yml` include the explicit `Skip-Pages-Deploy: update-data-workflow` trailer, and `deploy-pages.yml` uses that marker to avoid re-entering a second Pages deploy because `update-data.yml` already deployed the same artifact.

The dashboard also links to the manual **Update DRAM price data** workflow page. A browser button cannot safely trigger collection by itself without exposing a GitHub token, so manual refreshes intentionally require a signed-in GitHub account with repository write access. GitHub Actions runs on GitHub-hosted infrastructure after dispatch, so the refresh does not depend on your computer staying on or connected to Wi-Fi.

To enable Pages, create the repository on GitHub, push this branch, then enable **Settings → Pages → GitHub Actions**.

The project intentionally stores collected observations in committed JSON files rather than relying on only the latest source pages. The daily collector reads the existing `data/prices.json`, verifies source/product completeness, and merges newly collected rows by `source + kind + product_id + cadence + date`, and writes the normalized result back to `data/`. That means a new day adds a new observation while a repeated scrape of the same source/date updates that row. `series.json` and `status.json` are regenerated from the merged observation set so the dashboard can safely load one static dataset on GitHub Pages.

## Source caveats

- Public TrendForce/DRAMeXchange pages expose current tables; free historical TrendForce/DRAMeXchange data is not assumed.
- MemoryMarket publicly discloses recent weekly/monthly history for product pages and states that price data is copyrighted. Use this project for personal tracking/research and review source terms before broad redistribution.
- HTML pages can change. The collector requires every requested source and known product to succeed. After the initial product pass, transport-failed product pages get one deferred fetch with a 60-second timeout; parser and identity failures are never retried. Missing category/product pages, invalid prices, and source warnings fail the attempt with exit code 2 while preserving every stored output. `--attempt-status PATH` writes failure diagnostics separately; automation records those diagnostics in its health history. TrendForce rows require the timestamp immediately preceding their own price table; page-level dates and dates from another table are never used. Invalid or missing product averages fail the source. Unverified legacy contract dates require the explicit recovery procedure below. If the requested date is still missing after collection, the workflow preserves the last-good prices and records the failed target check instead of publishing a misleading freshness timestamp; strict manual runs still fail so the condition can be debugged.
- A failed collection may commit only `data/automation-health.json`. The same workflow verifies the unchanged last-good market files, runs any skipped tests and frontend build, and publishes the updated health with those preserved files. It does not rely on a bot commit triggering another workflow. Failed tests or build prevent this health-only publication too, and live JSON bytes are checked after deployment.

## Representative defaults

The dashboard highlights common series such as DDR5 16Gb, DDR4 16Gb 3200, DDR4 8Gb 3200, and key SO-DIMM contract rows when available. All collected products remain selectable.

## Price units and date recovery

`8Gb (1Gx8)` and `16Gb (2Gx8)` describe DRAM chip capacity and data width, not a count of chips. `Gb` means gigabits; `GB` means gigabytes. Chip prices and DIMM module prices retain their original product names and are displayed separately. Automatic price selection uses only the source average; it never substitutes a high/low midpoint.

The 2026-09-21 repair quarantined 497 legacy contract observations whose dates came from the spot table. It did not invent historical effective dates. Seven contract observations were restored from their own current public table (2026-07-31); 60 MemoryMarket RDIMM observations were corrected from weekly to monthly. Original prices and source HTML remain in the local recovery archive. See [the repair record](docs/price-history-repair-2026-09-21.md).

`PYTHONPATH=src python scripts/repair_price_history.py --help` describes the offline recovery tool. It requires a preserved input bundle, frozen source HTML, a new output directory, and a new archive directory. Existing recovery paths are never overwritten. Validate the candidate with `PYTHONPATH=src python scripts/validate_publication.py --data-dir CANDIDATE` before promoting it.

## 일별 이력과 전날 복구

| KST 예약 시각 | 대상 가격일 | 동작 |
| --- | --- | --- |
| 월–금 13:15, 15:15, 19:30 | 해당 거래일 | 정상 완료 이력이 없을 때만 수집 |
| 월–금 22:30 | 해당 거래일 | 누락·실패가 남았을 때만 재시도 |
| 화–토 01:30, 04:30 | 전날 거래일 | 원문 또는 보존한 스냅샷으로 전날을 복구 |

- `prices.json`과 `series.json`은 제품·원문 날짜별 관측을 계속 누적한다. 정상 수집 완료한 날짜의 후속 중복 수집은 건너뛴다. 새로 확보한 같은 날짜의 관측을 병합할 때에는 더 늦은 `source_last_update`를 우선하며, 늦게 도착한 오전 응답이 저녁 값을 덮을 수 없다. 고정가·주간·월간 자료를 가짜 일별 값으로 늘리지 않는다.
- `history/trendforce-spot/YYYY-MM-DD/`에 검증된 현물 7제품의 세션별 불변 스냅샷과 원문 해시를 보존한다. 고정가나 MemoryMarket 실패로 공개 데이터 승격이 차단돼도 유효한 현물 스냅샷은 저장소에 남는다. 다음 정상 수집에서 누락 일자를 복구하며 이 디렉터리는 Pages 산출물에 복사하지 않는다.
- 같은 원문 세션에 상충하는 가격이 오면 `history/trendforce-spot/conflicts/`에 별도 보존하고 해당 시도를 차단한다. 이후 정상 세션까지 영구 차단하지 않는다. `recovery.json`에는 요청한 날짜의 누락 여부를 계속 남긴다.
- 실행 생성 시각과 예약 슬롯으로 가격일을 한 번 확정한다. 대기 중 자정이 지나도 대상일이 바뀌지 않는다. 해당 날짜의 7제품과 전체 수집·검증 성공 상태를 확인한 뒤 다음 시도를 건너뛴다. 일별 값은 수집에 성공한 원문 세션 평균이며 공식 종가로 표시하지 않는다. [원문 세션 안내](https://www.dramexchange.com/Service/Spot_Price_Notice)
- 무료 원문이 이미 다음 날짜로 바뀌었고 해당 날짜의 보존 자료도 없으면 가격을 역산·날짜 치환하지 않는다. 그 날짜는 누락으로 남긴다. 과거 날짜를 명시해 같은 검증으로 다시 실행할 수 있다: `gh workflow run update-data.yml --ref main -f target_date=YYYY-MM-DD`.
