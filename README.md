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

Scheduled collection and calculation now belong to the Quant2Alpha Windows batch. The old `update-data.yml` collection workflow and its dedicated live-delivery retry helper have been removed. This repository no longer schedules or dispatches a second collector.

The original site, committed observations, private recovery history and historical health timestamps are preserved. Links and cadence recorded in old JSON describe that historical edition; they do not establish current automation. The canonical result is `https://quant2alpha.com/dram-price/`.

`.github/workflows/deploy-pages.yml` remains available for explicit manual dispatches and existing UI/data pushes. It validates the stored backend/public contracts, installs the locked frontend, runs its complete verifier and checks the deployed public JSON bytes. The old collection workflow's self-deployment skip marker is no longer applicable. No collection, data commit or replacement price is performed by this publication workflow.

The project intentionally stores collected observations in committed JSON files rather than relying on only the latest source pages. The daily collector reads the existing `data/prices.json`, verifies source/product completeness, and merges newly collected rows by `source + kind + product_id + cadence + date`, and writes the normalized result back to `data/`. That means a new day adds a new observation while a repeated scrape of the same source/date updates that row. `series.json` and `status.json` are regenerated from the merged observation set so the dashboard can safely load one static dataset on GitHub Pages.

## Source caveats

- Public TrendForce/DRAMeXchange pages expose current tables; free historical TrendForce/DRAMeXchange data is not assumed.
- MemoryMarket publicly discloses recent weekly/monthly history for product pages and states that price data is copyrighted. Use this project for personal tracking/research and review source terms before broad redistribution.
- HTML pages can change. The collector requires every requested source and known product to succeed. After the initial product pass, transport-failed product pages get one deferred fetch with a 60-second timeout. The retired collector workflow retried an isolated collection once, after 60 seconds, for confirmed transient fetch failures. Parser, identity, source-date, HTTP 403, and HTTP 429 failures do not trigger that retry. Missing category/product pages, invalid prices, and source warnings fail the attempt with exit code 2 while preserving every stored output. `--attempt-status PATH` writes failure diagnostics separately; automation records those diagnostics in its health history. TrendForce rows require the timestamp immediately preceding their own price table; page-level dates and dates from another table are never used. Invalid or missing product averages fail the source. Unverified legacy contract dates require the explicit recovery procedure below. Missing target dates must continue to preserve last-good prices and remain explicit in the independent producer.
- The retired workflow previously published a separate automation-health update after verifying unchanged market files. The preserved health JSON remains a historical observation; the publication-only workflow does not synthesize a fresh collection status.

## Representative defaults

The dashboard highlights common series such as DDR5 16Gb, DDR4 16Gb 3200, DDR4 8Gb 3200, and key SO-DIMM contract rows when available. All collected products remain selectable.

## Price units and date recovery

`8Gb (1Gx8)` and `16Gb (2Gx8)` describe DRAM chip capacity and data width, not a count of chips. `Gb` means gigabits; `GB` means gigabytes. Chip prices and DIMM module prices retain their original product names and are displayed separately. Automatic price selection uses only the source average; it never substitutes a high/low midpoint.

The 2026-09-21 repair quarantined 497 legacy contract observations whose dates came from the spot table. It did not invent historical effective dates. Seven contract observations were restored from their own current public table (2026-07-31); 60 MemoryMarket RDIMM observations were corrected from weekly to monthly. Original prices and source HTML remain in the local recovery archive. See [the repair record](docs/price-history-repair-2026-09-21.md).

`PYTHONPATH=src python scripts/repair_price_history.py --help` describes the offline recovery tool. It requires a preserved input bundle, frozen source HTML, a new output directory, and a new archive directory. Existing recovery paths are never overwritten. Validate the candidate with `PYTHONPATH=src python scripts/validate_publication.py --data-dir CANDIDATE` before promoting it.

## 보존된 수집기의 일별 이력과 복구 계약

아래 예약은 퇴역한 원본 자동화의 기록이며 현재 실행 예약이 아니다. 수집기·복구 코드와 원자료는 재현 및 Quant2Alpha 이관 검증을 위해 보존한다.

| KST 예약 시각 | 대상 가격일 | 동작 |
| --- | --- | --- |
| 월–금 13:15, 15:15, 19:30 | 해당 거래일 | 정상 완료 이력이 없을 때만 수집 |
| 월–금 22:30 | 해당 거래일 | 누락·실패가 남았을 때만 재시도 |
| 화–토 01:30, 04:30 | 전날 거래일 | 원문 또는 보존한 스냅샷으로 전날을 복구 |

- `prices.json`과 `series.json`은 제품·원문 날짜별 관측을 계속 누적한다. 정상 수집 완료한 날짜의 후속 중복 수집은 건너뛴다. 새로 확보한 같은 날짜의 관측을 병합할 때에는 더 늦은 `source_last_update`를 우선하며, 늦게 도착한 오전 응답이 저녁 값을 덮을 수 없다. 고정가·주간·월간 자료를 가짜 일별 값으로 늘리지 않는다.
- `history/trendforce-spot/YYYY-MM-DD/`에 검증된 현물 7제품의 세션별 불변 스냅샷과 원문 해시를 보존한다. 고정가나 MemoryMarket 실패로 공개 데이터 승격이 차단돼도 유효한 현물 스냅샷은 저장소에 남는다. 다음 정상 수집에서 누락 일자를 복구하며 이 디렉터리는 Pages 산출물에 복사하지 않는다.
- 같은 원문 세션에 상충하는 가격이 오면 `history/trendforce-spot/conflicts/`에 별도 보존하고 해당 시도를 차단한다. 이후 정상 세션까지 영구 차단하지 않는다. `recovery.json`에는 요청한 날짜의 누락 여부를 계속 남긴다.
- 실행 생성 시각과 예약 슬롯으로 가격일을 한 번 확정한다. 대기 중 자정이 지나도 대상일이 바뀌지 않는다. 해당 날짜의 7제품과 전체 수집·검증 성공 상태를 확인한 뒤 다음 시도를 건너뛴다. 일별 값은 수집에 성공한 원문 세션 평균이며 공식 종가로 표시하지 않는다. [원문 세션 안내](https://www.dramexchange.com/Service/Spot_Price_Notice)
- 무료 원문이 이미 다음 날짜로 바뀌었고 해당 날짜의 보존 자료도 없으면 가격을 역산·날짜 치환하지 않는다. 그 날짜는 누락으로 남긴다. 과거 날짜의 복구가 필요하면 Quant2Alpha 소유 배치에서 같은 원자료·날짜 검증을 거친다. 퇴역한 원본 workflow를 재실행하지 않는다.
