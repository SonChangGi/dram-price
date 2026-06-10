const DATA_PATHS = [
  { prices: 'data/prices.json', series: 'data/series.json', status: 'data/status.json' },
  { prices: '../data/prices.json', series: '../data/series.json', status: '../data/status.json' },
];
const COLORS = ['#2563eb', '#e11d48', '#0f766e', '#f97316', '#7c3aed', '#0891b2', '#be123c', '#4d7c0f'];
const SVG_NS = 'http://www.w3.org/2000/svg';

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
  if (requested !== 'auto') return values[requested];
  return values.session_average ?? values.average ?? values.daily_high ?? values.high ?? values.session_high;
}

function formatNumber(value) {
  return Number.isFinite(value) ? value.toLocaleString(undefined, { maximumFractionDigits: 3 }) : 'n/a';
}

function uniqueSorted(values) {
  return [...new Set(values.filter(Boolean))].sort((a, b) => String(a).localeCompare(String(b)));
}

function observationCategory(obs) {
  return obs.category || 'uncategorized';
}

function seriesCategories(item) {
  return item.categories?.length ? item.categories : [item.category || 'uncategorized'];
}

function categoryLabel(category) {
  return category === 'uncategorized' ? 'Uncategorized' : category.toUpperCase();
}

function appendOption(select, value, label) {
  const option = document.createElement('option');
  option.value = value;
  option.textContent = label;
  select.append(option);
}

function populateFilters() {
  const sourceFilter = document.getElementById('source-filter');
  uniqueSorted(state.prices.map((obs) => obs.source)).forEach((source) => appendOption(sourceFilter, source, source));

  const kindFilter = document.getElementById('kind-filter');
  uniqueSorted(state.prices.map((obs) => obs.kind)).forEach((kind) => appendOption(kindFilter, kind, kind.replace('_', ' ')));

  const categoryFilter = document.getElementById('category-filter');
  uniqueSorted(state.prices.map(observationCategory)).forEach((category) => appendOption(categoryFilter, category, categoryLabel(category)));

  const productFilter = document.getElementById('product-filter');
  state.series.forEach((item) => {
    const categories = seriesCategories(item).map(categoryLabel).join(', ');
    appendOption(productFilter, item.product_id, `${item.representative ? '★ ' : ''}${item.product_name} (${item.source}; ${categories})`);
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

function renderStatus() {
  document.getElementById('observation-count').textContent = state.status?.observation_count ?? state.prices.length;
  document.getElementById('generated-at').textContent = `Generated: ${state.status?.generated_at || 'unknown'}`;
  const list = document.getElementById('source-status');
  list.replaceChildren();
  (state.status?.sources || []).forEach((source) => {
    const li = document.createElement('li');
    const warnings = [...(source.warnings || []), ...(source.errors || [])];
    li.textContent = `${source.source}: ${source.ok ? 'ok' : 'needs attention'} (${source.observation_count || 0} observations)${warnings.length ? ` — ${warnings.join('; ')}` : ''}`;
    list.append(li);
  });
}

function groupSeries(rows, requestedMetric) {
  const groups = new Map();
  rows.forEach((obs) => {
    const value = Number(metricFor(obs, requestedMetric));
    if (!Number.isFinite(value)) return;
    const key = `${obs.product_id}|${obs.kind}`;
    if (!groups.has(key)) groups.set(key, { label: `${obs.product_name} · ${obs.kind}`, points: [] });
    groups.get(key).points.push({ date: String(obs.date || ''), value });
  });
  return [...groups.values()].map((group) => ({ ...group, points: group.points.sort((a, b) => a.date.localeCompare(b.date)) }));
}

function createSvgElement(name, attributes = {}) {
  const element = document.createElementNS(SVG_NS, name);
  Object.entries(attributes).forEach(([key, value]) => element.setAttribute(key, String(value)));
  return element;
}

function createElement(name, className) {
  const element = document.createElement(name);
  if (className) element.className = className;
  return element;
}

function appendSvgText(parent, text, attributes) {
  const element = createSvgElement('text', attributes);
  element.textContent = text;
  parent.append(element);
}

function renderChart(rows) {
  const metric = document.getElementById('metric-filter').value;
  const limitValue = document.getElementById('series-limit').value;
  const allGroups = groupSeries(rows, metric);
  const groups = limitValue === 'all' ? allGroups : allGroups.slice(0, Number(limitValue));
  const chart = document.getElementById('chart');
  chart.replaceChildren();
  if (!groups.length) {
    chart.textContent = 'No observations match the current filters.';
    document.getElementById('chart-subtitle').textContent = 'No matching series.';
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
  const width = 960;
  const height = 360;
  const left = 72;
  const right = 24;
  const top = 24;
  const bottom = 52;
  const x = (date) => left + (dates.indexOf(date) / Math.max(1, dates.length - 1)) * (width - left - right);
  const y = (value) => top + (1 - (value - yMin) / Math.max(1, yMax - yMin)) * (height - top - bottom);

  const svg = createSvgElement('svg', { viewBox: `0 0 ${width} ${height}`, preserveAspectRatio: 'xMidYMid meet' });
  Array.from({ length: 5 }, (_, idx) => yMin + (idx / 4) * (yMax - yMin)).forEach((value) => {
    svg.append(createSvgElement('line', { class: 'grid', x1: left, x2: width - right, y1: y(value), y2: y(value) }));
    appendSvgText(svg, formatNumber(value), { x: 12, y: y(value) + 4, 'font-size': 12, fill: '#64748b' });
  });
  svg.append(createSvgElement('line', { class: 'axis', x1: left, x2: width - right, y1: height - bottom, y2: height - bottom }));
  svg.append(createSvgElement('line', { class: 'axis', x1: left, x2: left, y1: top, y2: height - bottom }));

  const labelEvery = Math.ceil(dates.length / 5);
  dates
    .filter((_, idx) => idx === 0 || idx === dates.length - 1 || idx % labelEvery === 0)
    .forEach((date) => appendSvgText(svg, date, { x: x(date), y: height - 18, 'text-anchor': 'middle', 'font-size': 12, fill: '#64748b' }));

  groups.forEach((group, idx) => {
    const d = group.points.map((point, pointIdx) => `${pointIdx ? 'L' : 'M'} ${x(point.date).toFixed(1)} ${y(point.value).toFixed(1)}`).join(' ');
    svg.append(createSvgElement('path', { class: 'series', d, stroke: COLORS[idx % COLORS.length] }));
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
  const limitNote = limitValue === 'all' ? '' : ' · explicit chart limit applied';
  document.getElementById('chart-subtitle').textContent = `${groups.length} of ${allGroups.length} series · metric: ${metric}${limitNote}`;
}

function appendCell(row, value) {
  const td = document.createElement('td');
  td.textContent = value;
  row.append(td);
}

function renderTable(rows) {
  const metric = document.getElementById('metric-filter').value;
  const body = document.getElementById('latest-table');
  body.replaceChildren();
  rows.slice().sort((a, b) => String(b.date || '').localeCompare(String(a.date || ''))).slice(0, 50).forEach((obs) => {
    const tr = document.createElement('tr');
    appendCell(tr, obs.date || 'unknown');
    appendCell(tr, obs.kind || 'unknown');
    appendCell(tr, observationCategory(obs));
    appendCell(tr, obs.product_name || obs.product_id || 'unknown');
    appendCell(tr, obs.source || 'unknown');
    appendCell(tr, formatNumber(Number(metricFor(obs, metric))));
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
    document.getElementById('chart').textContent = `Failed to load data: ${error.message}`;
  }
}

init();
