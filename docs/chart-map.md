# DRAM dashboard chart map

## Page question

사용자가 별도 조작 없이 최신 DRAM 가격과 데이터 기준일을 확인하고, 같은 가격 종류 안에서 대표 제품의 시간 흐름을 비교할 수 있어야 한다.

## Shared data contract

- Source: `data/prices.json`, `data/series.json`, `data/status.json`, `data/summary.json`
- Observation grain: `source + kind + product_id + cadence + date`
- Displayable price: finite `values.session_average`, otherwise finite `values.average`
- Unit: observation `currency`
- Date: observation `date`; collection time is shown separately and never substituted for the price date

## Primary price trend

- Question: 선택한 가격 종류와 제품의 가격이 시간에 따라 어떻게 움직였는가?
- Form: multi-series line chart with an in-chart exact-value callout, selected-date crosshair, and active-series emphasis
- Default: spot prices, representative products, automatic price metric
- Compatibility: one chart must not mix incompatible price kinds, currencies, or price metrics
- Data sufficiency: show a line only when it has at least two valid observations; otherwise keep the exact latest value in the cards/table and explain the sparse series in the chart state
- Palette: blue-led restrained palette, no more than five visible series; line dash/marker differences supplement color
- Labels: neutral chart title plus price kind, metric, unit, and visible date range in the subtitle
- Mobile: fewer date ticks, no per-point labels, tap/focus tooltip, no document-level horizontal overflow

## Shared interactive chart pattern v1

Fear & Greed의 `KOSPI · 신호 · 선택 전략 결과`는 읽기 전용 참고 화면이다. 공통 구현은 그 계산·신호·전략 구조를 복사하지 않고 다음 탐색 규칙만 재사용한다.

- Applied state and exploration state stay separate. DRAM의 차트 선택일은 정확값 탐색용이며 최신 가격 카드, 필터, 데이터 기준일을 변경하지 않는다.
- A persistent crosshair identifies the selected date. Pointer movement previews the nearest observed date; click/tap or the date selector pins it.
- The chart viewport contains a visible exact-value callout. It shows selected date, series name, exact value, and unit without requiring a separate tooltip.
- Hover/focus temporarily emphasizes one series. Clicking its external native button persists the emphasis; other series are dimmed but remain visible.
- `ArrowLeft`, `ArrowRight`, `Home`, and `End` move the pinned date. A `차트 최신일` button restores the latest observed date inside the current visible series and reveals the latest chart area.
- SVG remains a descriptive image with no focusable descendants. Series selection uses native HTML buttons, and a live text alternative announces the same selected date and value.
- Only the selected-date markers are drawn. Color is supplemented by dash and marker shape; direct end labels remain when no single series is active.
- On narrow screens only the chart scrolls horizontally. The exact-value callout stays inside the visible viewport, and the initial position reveals the latest date.
- The observation table remains the bounded exact-row alternative. Missing dates are reported as unavailable rather than filled or interpolated.

## Latest price cards

- Question: 지금 확인할 대표 DRAM 가격은 얼마인가?
- One card contains one price only: product, price and currency, kind/source, and observation date
- Provider-supplied change may be shown; derived returns or investment signals must not be invented
- Missing representative products are replaced by the next valid representative observation rather than a placeholder value

## Latest observations

- Question: 필터 조건에 맞는 정확한 최신 행은 무엇인가?
- Desktop/tablet: exact-value table, 10 rows initially and at most 50 after expansion
- Narrow mobile: product/price card rows using the same sorted rows
- Sorting: newest observation first, then product name; no row without a valid numeric price

## Data state

- `ok`: compact available state
- usable warning/degraded: keep results visible and summarize the affected source count; full reason stays in the operations disclosure
- unavailable/error: fail closed, show no fabricated prices, and provide a retry action
- Loading, empty, warning, unavailable, and malformed-contract states require automated or browser coverage
