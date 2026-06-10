const DATA_PATHS = [
  { prices: 'data/prices.json', series: 'data/series.json', status: 'data/status.json' },
  { prices: '../data/prices.json', series: '../data/series.json', status: '../data/status.json' },
];
const COLORS = ['#2457d6', '#0f766e', '#e11d48', '#f97316', '#7c3aed', '#0891b2', '#4d7c0f', '#be123c', '#2563eb', '#dc2626'];
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
  return values.session_average ?? values.average ?? values.daily_high ?? values.high ?? values.session_high;
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
  return METRIC_LABELS[metric] || metric;
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

function populateFilters() {
  const sourceFilter = document.getElementById('source-filter');
  uniqueSorted(state.prices.map((obs) => obs.source)).forEach((source) => appendOption(sourceFilter, source, sourceLabel(source)));

  const kindFilter = document.getElementById('kind-filter');
  uniqueSorted(state.prices.map((obs) => obs.kind)).forEach((kind) => appendOption(kindFilter, kind, kindLabel(kind)));

  const categoryFilter = document.getElementById('category-filter');
  uniqueSorted(state.prices.map(observationCategory)).forEach((category) => appendOption(categoryFilter, category, categoryLabel(category)));

  const productFilter = document.getElementById('product-filter');
  state.series.forEach((item) => {
    const categories = seriesCategories(item).map(categoryLabel).join(', ');
    appendOption(productFilter, item.product_id, `${item.representative ? '★ ' : ''}${item.product_name} (${sourceLabel(item.source)} · ${categories})`);
  });

  document.querySelectorAll('select').forEach((select) => select.addEventListener('change', render));
}

function selectedObservations() {
  const source = document.getElementById('source-filter').value;
  const kind = document.getElementById('kind-filter').value;
  const category = document.getElementById('category-filter').value;
  const product = document.getElementById('product-filter').value;
  let rows = state.prices.slice();
  if (source !== 'all') rows = rows.filter((obs) => obs.source === source);
  if (kind !== 'all') rows = rows.filter((obs) => obs.kind === kind);
  if (category !== 'all') rows = rows.filter((obs) => observationCategory(obs) === category);
  if (product === 'representative') {
    const reps = new Set(
      state.series
        .filter((item) => item.representative)
        .filter((item) => source === 'all' || item.source === source)
        .filter((item) => category === 'all' || seriesCategories(item).includes(category))
        .map((item) => item.product_id),
    );
    rows = rows.filter((obs) => reps.has(obs.product_id));
  } else if (product !== 'all') {
    rows = rows.filter((obs) => obs.product_id === product);
  }
  return rows;
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
    const value = Number(metricFor(obs, requestedMetric));
    if (!Number.isFinite(value)) return;
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
    appendSvgText(svg, formatNumber(value), { x: 16, y: y(value) + 4, 'font-size': 13, 'font-weight': 650, fill: '#52647c' });
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
    appendSvgText(svg, date, { x: xPos, y: height - 22, 'text-anchor': textAnchor, 'font-size': 13, 'font-weight': 650, fill: '#52647c' });
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
    appendCell(tr, obs.date || 'unknown');
    appendBadgeCell(tr, kindLabel(obs.kind), obs.kind === 'contract' ? 'badge warn' : obs.kind === 'spot' ? 'badge good' : 'badge neutral');
    appendCell(tr, categoryLabel(observationCategory(obs)));
    appendCell(tr, obs.product_name || obs.product_id || 'unknown');
    appendBadgeCell(tr, sourceLabel(obs.source), 'badge neutral');
    appendCell(tr, `${formatNumber(Number(metricFor(obs, metric)))} ${obs.currency || ''}`.trim());
    body.append(tr);
  });
}

function render() {
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
