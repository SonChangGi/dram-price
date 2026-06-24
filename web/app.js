const DATA_PATHS = [
  { prices: 'data/prices.json', series: 'data/series.json', status: 'data/status.json' },
  { prices: '../data/prices.json', series: '../data/series.json', status: '../data/status.json' },
];
const COLORS = ['#7dd3fc', '#86efac', '#fb7185', '#fbbf24', '#c4b5fd', '#67e8f9', '#bef264', '#f9a8d4', '#93c5fd', '#fca5a5'];
const SVG_NS = 'http://www.w3.org/2000/svg';
const KIND_LABELS = {
  contract: '고정가',
  spot: '현물가',
  spot_proxy: '현물 프록시',
};
const SOURCE_LABELS = {
  memorymarket: 'MemoryMarket',
  trendforce: 'TrendForce',
};
const METRIC_LABELS = {
  auto: '자동 선택',
  session_average: '세션 평균',
  average: '평균',
  daily_high: '고가',
  daily_low: '저가',
};
const CAVEAT_LABELS = {
  'TrendForce/DRAMeXchange public pages expose current tables but not free historical data.': 'TrendForce/DRAMeXchange 공개 페이지는 현재 표 중심이며 무료 과거 데이터는 제한적입니다.',
  'MemoryMarket publicly discloses six-month weekly history; respect source terms and attribution.': 'MemoryMarket은 최근 약 6개월 주간 이력을 공개합니다. 출처 표기와 이용 조건을 확인하세요.',
  'Contract prices are monthly/update-date observations; collected_at is not the effective price date.': '고정가는 월간/업데이트일 기준 관측치이며 수집 시각이 실제 가격 적용일은 아닙니다.',
};
const KNOWN_METRIC_VALUE_KEYS = new Set(['average', 'daily_high', 'daily_low', 'high', 'low', 'session_average', 'session_high', 'session_low']);

const state = { prices: [], series: [], status: null };

async function loadJsonFallback(kind) {
  const errors = [];
  for (const paths of DATA_PATHS) {
    try {
      const response = await fetch(paths[kind], { cache: 'no-store' });
      if (response.ok) return response.json();
      errors.push(`${paths[kind]}: ${response.status}`);
    } catch (error) {
      errors.push(`${paths[kind]}: ${error.message}`);
    }
  }
  throw new Error(errors.join('; '));
}

function metricFor(obs, requested) {
  const values = obs.values || {};
  if (requested === 'daily_high') return values.daily_high ?? values.high ?? values.session_high;
  if (requested === 'daily_low') return values.daily_low ?? values.low ?? values.session_low;
  if (requested === 'session_average') return values.session_average ?? values.average;
  if (requested === 'average') return values.average ?? values.session_average;
  if (requested !== 'auto' && Object.hasOwn(values, requested)) return values[requested];
  return values.session_average ?? values.average ?? values.daily_high ?? values.high ?? values.session_high;
}

function asFiniteNumber(value) {
  if (value === null || value === undefined || value === '') return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}

function formatNumber(value, options = {}) {
  return Number.isFinite(value) ? value.toLocaleString('ko-KR', { maximumFractionDigits: 3, ...options }) : 'n/a';
}

function formatDateTime(value) {
  if (!value) return 'unknown';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    timeZone: 'Asia/Seoul',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  }).format(date);
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function setText(id, value) {
  const element = document.getElementById(id);
  if (element) element.textContent = value;
}

function observationCategory(obs) {
  return obs.category || 'uncategorized';
}

function seriesCategories(item) {
  return item.categories?.length ? item.categories : [item.category || 'uncategorized'];
}

function categoryLabel(category) {
  return category === 'uncategorized' ? '기타' : category.toUpperCase();
}

function kindLabel(kind) {
  return KIND_LABELS[kind] || String(kind || 'unknown').replace('_', ' ');
}

function sourceLabel(source) {
  return SOURCE_LABELS[source] || source || 'unknown';
}

function metricLabel(metric) {
  return METRIC_LABELS[metric] || metric.replaceAll('_', ' ');
}

function caveatLabel(text) {
  return CAVEAT_LABELS[text] || text;
}

function createElement(name, className) {
  const element = document.createElement(name);
  if (className) element.className = className;
  return element;
}

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function appendStatusLine(parent, label, value) {
  const row = createElement('div', 'status-line');
  const labelElement = createElement('span', 'status-label');
  const valueElement = createElement('span', 'status-value');
  labelElement.textContent = label;
  valueElement.textContent = value;
  row.append(labelElement, valueElement);
  parent.append(row);
}

function appendInfoItem(parent, title, detail, className = 'mini-item') {
  const item = createElement('div', className);
  const strong = document.createElement('strong');
  const small = document.createElement('small');
  strong.textContent = title;
  small.textContent = detail;
  item.append(strong, small);
  parent.append(item);
}

function replaceOptions(select, options, preferredValue) {
  select.replaceChildren();
  options.forEach((option) => appendOption(select, option.value, option.label));
  const values = new Set(options.map((option) => option.value));
  select.value = values.has(preferredValue) ? preferredValue : options[0]?.value || '';
}

function filterRows({ source = 'all', kind = 'all', category = 'all', product = 'all' } = {}) {
  let rows = state.prices.slice();
  if (source !== 'all') rows = rows.filter((obs) => obs.source === source);
  if (kind !== 'all') rows = rows.filter((obs) => obs.kind === kind);
  if (category !== 'all') rows = rows.filter((obs) => observationCategory(obs) === category);
  if (product !== 'all' && product !== 'representative') rows = rows.filter((obs) => obs.product_id === product);
  return rows;
}

function matchingRepresentativeIds({ source = 'all', kind = 'all', category = 'all' } = {}) {
  const productIds = new Set(filterRows({ source, kind, category }).map((obs) => obs.product_id));
  return new Set(
    state.series
      .filter((item) => item.representative)
      .filter((item) => productIds.has(item.product_id))
      .map((item) => item.product_id),
  );
}

function productOptionLabel(item) {
  const categories = seriesCategories(item).map(categoryLabel).join(', ');
  return `${item.representative ? '★ ' : ''}${item.product_name} (${sourceLabel(item.source)} · ${categories})`;
}

function productOptionsFor(rows, context) {
  const productIds = new Set(rows.map((obs) => obs.product_id));
  const representatives = matchingRepresentativeIds(context);
  const options = [];
  if (representatives.size) options.push({ value: 'representative', label: '대표 제품 우선' });
  options.push({ value: 'all', label: '전체 제품' });
  state.series
    .filter((item) => productIds.has(item.product_id))
    .forEach((item) => options.push({ value: item.product_id, label: productOptionLabel(item) }));
  return options;
}

function rowsForProductSelection({ source = 'all', kind = 'all', category = 'all', product = 'all' } = {}) {
  let rows = filterRows({ source, kind, category });
  if (product === 'representative') {
    const reps = matchingRepresentativeIds({ source, kind, category });
    rows = rows.filter((obs) => reps.has(obs.product_id));
  } else if (product !== 'all') {
    rows = rows.filter((obs) => obs.product_id === product);
  }
  return rows;
}

function hasMetric(obs, metric) {
  const values = obs.values || {};
  if (metric === 'auto') return true;
  if (metric === 'daily_high') return asFiniteNumber(values.daily_high ?? values.high ?? values.session_high) !== null;
  if (metric === 'daily_low') return asFiniteNumber(values.daily_low ?? values.low ?? values.session_low) !== null;
  if (metric === 'session_average') return asFiniteNumber(values.session_average) !== null;
  if (metric === 'average') return asFiniteNumber(values.average) !== null;
  return asFiniteNumber(values[metric]) !== null;
}

function metricOptionsFor(rows) {
  const knownOptions = Object.keys(METRIC_LABELS)
    .filter((metric) => metric === 'auto' || rows.some((obs) => hasMetric(obs, metric)))
    .map((metric) => ({ value: metric, label: metricLabel(metric) }));
  const dynamicMetrics = uniqueSorted(
    rows.flatMap((obs) =>
      Object.entries(obs.values || {})
        .filter(([key, value]) => !KNOWN_METRIC_VALUE_KEYS.has(key) && !key.endsWith('_change_percent') && asFiniteNumber(value) !== null)
        .map(([key]) => key),
    ),
  );
  return [...knownOptions, ...dynamicMetrics.map((metric) => ({ value: metric, label: metricLabel(metric) }))];
}

function refreshFilterOptions() {
  const sourceFilter = document.getElementById('source-filter');
  const kindFilter = document.getElementById('kind-filter');
  const categoryFilter = document.getElementById('category-filter');
  const productFilter = document.getElementById('product-filter');
  const metricFilter = document.getElementById('metric-filter');

  replaceOptions(
    sourceFilter,
    [{ value: 'all', label: '전체 소스' }, ...uniqueSorted(state.prices.map((obs) => obs.source)).map((source) => ({ value: source, label: sourceLabel(source) }))],
    sourceFilter.value || 'all',
  );

  const source = sourceFilter.value;
  const rowsBySource = filterRows({ source });
  replaceOptions(
    kindFilter,
    [{ value: 'all', label: '전체' }, ...uniqueSorted(rowsBySource.map((obs) => obs.kind)).map((kind) => ({ value: kind, label: kindLabel(kind) }))],
    kindFilter.value || 'all',
  );

  const kind = kindFilter.value;
  const rowsByKind = filterRows({ source, kind });
  replaceOptions(
    categoryFilter,
    [{ value: 'all', label: '전체 카테고리' }, ...uniqueSorted(rowsByKind.map(observationCategory)).map((category) => ({ value: category, label: categoryLabel(category) }))],
    categoryFilter.value || 'all',
  );

  const category = categoryFilter.value;
  const rowsByCategory = filterRows({ source, kind, category });
  replaceOptions(productFilter, productOptionsFor(rowsByCategory, { source, kind, category }), productFilter.value || 'representative');

  const product = productFilter.value;
  replaceOptions(metricFilter, metricOptionsFor(rowsForProductSelection({ source, kind, category, product })), metricFilter.value || 'auto');
}

function populateFilters() {
  refreshFilterOptions();
  document.querySelectorAll('select').forEach((select) => select.addEventListener('change', render));
}

function selectedObservations() {
  const source = document.getElementById('source-filter').value;
  const kind = document.getElementById('kind-filter').value;
  const category = document.getElementById('category-filter').value;
  const product = document.getElementById('product-filter').value;
  return rowsForProductSelection({ source, kind, category, product });
}

function renderHeroStatus() {
  const card = document.getElementById('run-status');
  card.replaceChildren();
  const okSources = state.status?.sources?.filter((source) => source.ok).length || 0;
  const totalSources = state.status?.sources?.length || 0;
  appendStatusLine(card, '최근 수집', formatDateTime(state.status?.generated_at));
  appendStatusLine(card, '총 관측치', `${formatNumber(state.status?.observation_count ?? state.prices.length)}개`);
  appendStatusLine(card, '소스 상태', `${okSources}/${totalSources} 정상`);
  appendStatusLine(card, '배포 방식', 'GitHub Pages 정적 대시보드');
}

function renderSummaryCards() {
  const countsByKind = state.status?.counts_by_kind || {};
  const spotCount = (countsByKind.spot || 0) + (countsByKind.spot_proxy || 0);
  const contractCount = countsByKind.contract || 0;
  const representativeCount = state.series.filter((item) => item.representative).length;
  const categoryCount = uniqueSorted(state.series.flatMap(seriesCategories)).length;

  setText('summary-observations', `${formatNumber(state.status?.observation_count ?? state.prices.length)}개`);
  setText('summary-observations-detail', `${state.series.length}개 제품/시리즈에서 수집된 정규화 행입니다.`);
  setText('summary-representatives', `${representativeCount}개`);
  setText('summary-representatives-detail', `${categoryCount}개 카테고리의 핵심 제품을 기본 차트에 표시합니다.`);
  setText('summary-spot', `${formatNumber(spotCount)}개`);
  setText('summary-contract', `${formatNumber(contractCount)}개`);
  setText('summary-generated', formatDateTime(state.status?.generated_at));
  setText('summary-generated-detail', '표시 시각은 한국시간 기준입니다.');
}

function renderStatus() {
  renderHeroStatus();
  renderSummaryCards();

  const sourceStatus = document.getElementById('source-status');
  sourceStatus.replaceChildren();
  (state.status?.sources || []).forEach((source) => {
    const warnings = [...(source.warnings || []), ...(source.errors || [])];
    const className = source.ok ? 'gate-item pass' : source.errors?.length ? 'gate-item fail' : 'gate-item block';
    const detail = `${formatNumber(source.observation_count || 0)}개 관측치${warnings.length ? ` · ${warnings.join('; ')}` : ' · 경고 없음'}`;
    appendInfoItem(sourceStatus, `${sourceLabel(source.source)} · ${source.ok ? '정상' : '점검 필요'}`, detail, className);
  });

  const caveats = document.getElementById('source-caveats');
  caveats.replaceChildren();
  (state.status?.caveats || []).forEach((caveat, idx) => appendInfoItem(caveats, `주의 ${idx + 1}`, caveatLabel(caveat)));
}

function groupSeries(rows, requestedMetric) {
  const groups = new Map();
  rows.forEach((obs) => {
    const value = asFiniteNumber(metricFor(obs, requestedMetric));
    if (value === null) return;
    const key = `${obs.product_id}|${obs.kind}`;
    if (!groups.has(key)) groups.set(key, { label: `${obs.product_name} · ${kindLabel(obs.kind)}`, points: [] });
    groups.get(key).points.push({ date: String(obs.date || ''), value });
  });
  return [...groups.values()]
    .map((group) => ({ ...group, points: group.points.sort((a, b) => a.date.localeCompare(b.date)) }))
    .sort((a, b) => a.label.localeCompare(b.label));
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function appendSvgText(parent, text, attributes) {
  const element = createSvgElement('text', attributes);
  element.textContent = text;
  parent.append(element);
}

function dateRangeLabel(rows) {
  const dates = uniqueSorted(rows.map((obs) => obs.date));
  if (!dates.length) return '날짜 없음';
  if (dates.length === 1) return dates[0];
  return `${dates[0]} ~ ${dates[dates.length - 1]}`;
}

function renderFilterSummary(rows, groups, allGroups, metric, limitValue) {
  const source = document.getElementById('source-filter').value;
  const kind = document.getElementById('kind-filter').value;
  const category = document.getElementById('category-filter').value;
  const product = document.getElementById('product-filter').value;
  const filters = [
    source === 'all' ? '전체 소스' : sourceLabel(source),
    kind === 'all' ? '전체 가격 종류' : kindLabel(kind),
    category === 'all' ? '전체 카테고리' : categoryLabel(category),
    product === 'representative' ? '대표 제품' : product === 'all' ? '전체 제품' : '선택 제품',
  ];
  const limitNote = limitValue === 'all' ? '시리즈 제한 없음' : `최대 ${limitValue}개 시리즈`;
  setText('filter-summary', `${filters.join(' · ')} · ${formatNumber(rows.length)}개 관측치 · ${dateRangeLabel(rows)} · ${metricLabel(metric)} · ${limitNote}`);
  setText('chart-subtitle', `${groups.length}개 시리즈 표시 / 조건에 맞는 전체 ${allGroups.length}개 시리즈`);
}

function renderChart(rows) {
  const metric = document.getElementById('metric-filter').value;
  const limitValue = document.getElementById('series-limit').value;
  const allGroups = groupSeries(rows, metric);
  const groups = limitValue === 'all' ? allGroups : allGroups.slice(0, Number(limitValue));
  const chart = document.getElementById('chart');
  chart.replaceChildren();
  renderFilterSummary(rows, groups, allGroups, metric, limitValue);
  if (!groups.length) {
    const empty = createElement('div', 'empty-state');
    empty.textContent = '현재 필터와 지표에 맞는 관측치가 없습니다. 가격 종류 또는 지표를 바꿔보세요.';
    chart.append(empty);
    return;
  }

  const allPoints = groups.flatMap((group) => group.points);
  const dates = uniqueSorted(allPoints.map((point) => point.date));
  const values = allPoints.map((point) => point.value);
  const min = Math.min(...values);
  const max = Math.max(...values);
  const pad = max === min ? Math.max(1, max * 0.1) : (max - min) * 0.12;
  const yMin = min - pad;
  const yMax = max + pad;
  const width = 1040;
  const height = 390;
  const left = 78;
  const right = 28;
  const top = 24;
  const bottom = 62;
  const x = (date) => left + (dates.indexOf(date) / Math.max(1, dates.length - 1)) * (width - left - right);
  const y = (value) => top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * (height - top - bottom);

  const svg = createSvgElement('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMidYMid meet' });
  Array.from({ length: 5 }, (_, idx) => yMin + (idx / 4) * (yMax - yMin)).forEach((value) => {
    svg.append(createSvgElement('line', { class: 'grid', x1: left, x2: width - right, y1: y(value), y2: y(value) }));
    appendSvgText(svg, formatNumber(value), { x: 16, y: y(value) + 4, 'font-size': 13, 'font-weight': 650, fill: '#aab3c2' });
  });
  svg.append(createSvgElement('line', { class: 'axis', x1: left, x2: width - right, y1: height - bottom, y2: height - bottom }));
  svg.append(createSvgElement('line', { class: 'axis', x1: left, x2: left, y1: top, y2: height - bottom }));

  const tickCount = Math.min(5, dates.length);
  const tickIndexes = [...new Set(
    Array.from({ length: tickCount }, (_, idx) => Math.round((idx / Math.max(1, tickCount - 1)) * (dates.length - 1))),
  )];
  tickIndexes.forEach((dateIdx) => {
    const date = dates[dateIdx];
    const xPos = x(date);
    const textAnchor = dateIdx === 0 ? 'start' : dateIdx === dates.length - 1 ? 'end' : 'middle';
    appendSvgText(svg, date, { x: xPos, y: height - 22, 'text-anchor': textAnchor, 'font-size': 13, 'font-weight': 650, fill: '#aab3c2' });
  });

  groups.forEach((group, idx) => {
    const color = COLORS[idx % COLORS.length];
    const d = group.points.map((point, pointIdx) => `${pointIdx ? 'L' : 'M'} ${x(point.date).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
    svg.append(createSvgElement('path', { class: 'series', d, stroke: color }));
    const last = group.points[group.points.length - 1];
    svg.append(createSvgElement('circle', { class: 'endpoint', cx: x(last.date), cy: y(last.value), r: 4, fill: color }));
  });

  const legend = createElement('div', 'legend');
  groups.forEach((group, idx) => {
    const item = document.createElement('span');
    const swatch = createElement('i', 'swatch');
    swatch.style.background = COLORS[idx % COLORS.length];
    item.append(swatch, document.createTextNode(group.label));
    legend.append(item);
  });

  chart.append(svg, legend);
}

function appendCell(row, value, className) {
  const td = document.createElement('td');
  if (className) td.className = className;
  td.textContent = value;
  row.append(td);
}

function appendBadgeCell(row, value, className = 'badge neutral') {
  const td = document.createElement('td');
  const badge = createElement('span', className);
  badge.textContent = value;
  td.append(badge);
  row.append(td);
}

function renderTable(rows) {
  const metric = document.getElementById('metric-filter').value;
  const body = document.getElementById('latest-table');
  body.replaceChildren();
  const sortedRows = rows.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 50);
  setText('latest-caption', `${formatNumber(sortedRows.length)}개 행 표시 · 선택 지표: ${metricLabel(metric)} · 날짜 역순`);
  if (!sortedRows.length) {
    const tr = document.createElement('tr');
    const td = document.createElement('td');
    td.colSpan = 6;
    td.textContent = '표시할 최신 관측치가 없습니다.';
    tr.append(td);
    body.append(tr);
    return;
  }
  sortedRows.forEach((obs) => {
    const tr = document.createElement('tr');
    const value = asFiniteNumber(metricFor(obs, metric));
    appendCell(tr, obs.date || 'unknown');
    appendBadgeCell(tr, kindLabel(obs.kind), obs.kind === 'contract' ? 'badge warn' : obs.kind === 'spot' ? 'badge good' : 'badge neutral');
    appendCell(tr, categoryLabel(observationCategory(obs)));
    appendCell(tr, obs.product_name || obs.product_id || 'unknown');
    appendBadgeCell(tr, sourceLabel(obs.source), 'badge neutral');
    appendCell(tr, value === null ? 'n/a' : `${formatNumber(value)} ${obs.currency || ''}`.trim());
    body.append(tr);
  });
}

function render() {
  refreshFilterOptions();
  const rows = selectedObservations();
  renderStatus();
  renderChart(rows);
  renderTable(rows);
}

async function init() {
  try {
    const [prices, series, status] = await Promise.all(['prices', 'series', 'status'].map(loadJsonFallback));
    state.prices = prices.observations || [];
    state.series = series.series || [];
    state.status = status;
    populateFilters();
    render();
  } catch (error) {
    const chart = document.getElementById('chart');
    chart.replaceChildren();
    const empty = createElement('div', 'empty-state');
    empty.textContent = `데이터를 불러오지 못했습니다: ${error.message}`;
    chart.append(empty);
  }
}

init();
