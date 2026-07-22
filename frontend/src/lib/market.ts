import type { DashboardFilters, MetricPoint, Observation, SeriesMeta } from '@/types';

export const KIND_LABELS: Record<string, string> = {
  all: '전체 가격 종류',
  spot: '현물가',
  contract: '고정가',
  spot_proxy: '현물 프록시',
};

export const SOURCE_LABELS: Record<string, string> = {
  all: '전체 소스',
  trendforce: 'TrendForce',
  memorymarket: 'MemoryMarket',
};

export const METRIC_LABELS: Record<string, string> = {
  auto: '자동 선택',
  session_average: '세션 평균',
  average: '평균',
  daily_high: '고가',
  daily_low: '저가',
};

const metricAliases: Record<string, string[]> = {
  auto: ['session_average', 'average', 'daily_high', 'high', 'session_high', 'daily_low', 'low', 'session_low'],
  session_average: ['session_average'],
  average: ['average'],
  daily_high: ['daily_high', 'high', 'session_high'],
  daily_low: ['daily_low', 'low', 'session_low'],
};

export function finiteNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null;
}

export function metricFor(observation: Observation, requested: string): MetricPoint | null {
  const aliases = metricAliases[requested] ?? [requested];
  for (const key of aliases) {
    const value = finiteNumber(observation.values?.[key]);
    if (value !== null) return { key, label: METRIC_LABELS[key] ?? key.replaceAll('_', ' '), value };
  }
  return null;
}

export function unique(values: Array<string | undefined>): string[] {
  return [...new Set(values.filter((value): value is string => Boolean(value)))].sort((a, b) => a.localeCompare(b));
}

export function categoryOf(observation: Observation): string {
  return observation.category || 'uncategorized';
}

export function categoryLabel(category: string): string {
  return category === 'uncategorized' ? '기타' : category.toUpperCase();
}

export function kindLabel(kind: string): string {
  return KIND_LABELS[kind] ?? kind.replaceAll('_', ' ');
}

export function sourceLabel(source: string): string {
  return SOURCE_LABELS[source] ?? source;
}

export function baseFilteredRows(observations: Observation[], filters: DashboardFilters): Observation[] {
  return observations.filter((observation) => {
    if (filters.source !== 'all' && observation.source !== filters.source) return false;
    if (filters.kind !== 'all' && observation.kind !== filters.kind) return false;
    if (filters.category !== 'all' && categoryOf(observation) !== filters.category) return false;
    return true;
  });
}

export function representativeIdsForRows(rows: Observation[], series: SeriesMeta[]): Set<string> {
  const available = new Set(rows.map((row) => row.product_id));
  return new Set(series.filter((item) => item.representative && available.has(item.product_id)).map((item) => item.product_id));
}

export function filteredRows(observations: Observation[], series: SeriesMeta[], filters: DashboardFilters): Observation[] {
  const rows = baseFilteredRows(observations, filters);
  if (filters.product === 'all') return rows;
  if (filters.product === 'representative') {
    const representativeIds = representativeIdsForRows(rows, series);
    return representativeIds.size ? rows.filter((row) => representativeIds.has(row.product_id)) : rows;
  }
  return rows.filter((row) => row.product_id === filters.product);
}

export function latestBySeries(rows: Observation[]): Observation[] {
  const latest = new Map<string, Observation>();
  rows.forEach((row) => {
    const key = `${row.product_id}|${row.kind}`;
    const current = latest.get(key);
    if (!current || String(row.date ?? '').localeCompare(String(current.date ?? '')) > 0) latest.set(key, row);
  });
  return [...latest.values()].sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.product_name.localeCompare(b.product_name));
}

export function latestRepresentativeCards(observations: Observation[], series: SeriesMeta[], limit = 6): Observation[] {
  const representativeIds = new Set(series.filter((item) => item.representative).map((item) => item.product_id));
  const latest = latestBySeries(observations.filter((row) => representativeIds.has(row.product_id) && metricFor(row, 'auto')));
  const preferred: Record<string, string[]> = {
    spot: ['ddr5-16gb-2gx8-4800-5600', 'ddr4-16gb-2gx8-3200'],
    contract: ['ddr5-8gb-so-dimm', 'ddr4-16gb-so-dimm'],
    spot_proxy: ['memorymarket-100266', 'memorymarket-100222'],
  };
  const selected: Observation[] = [];
  for (const kind of ['spot', 'contract', 'spot_proxy']) {
    const candidates = latest.filter((row) => row.kind === kind).sort((a, b) => {
      const aRank = preferred[kind]?.findIndex((token) => a.product_id.includes(token)) ?? -1;
      const bRank = preferred[kind]?.findIndex((token) => b.product_id.includes(token)) ?? -1;
      return (aRank < 0 ? 99 : aRank) - (bRank < 0 ? 99 : bRank) || a.product_name.localeCompare(b.product_name);
    });
    selected.push(...candidates.slice(0, 2));
  }
  const used = new Set(selected.map((row) => `${row.product_id}|${row.kind}`));
  selected.push(...latest.filter((row) => !used.has(`${row.product_id}|${row.kind}`)).slice(0, Math.max(0, limit - selected.length)));
  return selected.slice(0, limit);
}

export function productOptions(rows: Observation[], series: SeriesMeta[]) {
  const ids = new Set(rows.map((row) => row.product_id));
  const meta = new Map(series.map((item) => [item.product_id, item]));
  return [...ids]
    .map((id) => meta.get(id) ?? { product_id: id, product_name: rows.find((row) => row.product_id === id)?.product_name ?? id, source: '' })
    .sort((a, b) => Number(Boolean(b.representative)) - Number(Boolean(a.representative)) || a.product_name.localeCompare(b.product_name));
}

export function normalizeFilters(observations: Observation[], series: SeriesMeta[], requested: DashboardFilters): DashboardFilters {
  const next = { ...requested };
  const sources = new Set(observations.map((row) => row.source));
  if (next.source !== 'all' && !sources.has(next.source)) next.source = 'all';

  const sourceRows = observations.filter((row) => next.source === 'all' || row.source === next.source);
  const kinds = unique(sourceRows.map((row) => row.kind));
  if (next.kind !== 'all' && !kinds.includes(next.kind)) next.kind = kinds.length === 1 ? kinds[0]! : 'all';

  const kindRows = sourceRows.filter((row) => next.kind === 'all' || row.kind === next.kind);
  const categories = unique(kindRows.map(categoryOf));
  if (next.category !== 'all' && !categories.includes(next.category)) next.category = 'all';

  const candidateRows = baseFilteredRows(observations, next);
  const productIds = new Set(candidateRows.map((row) => row.product_id));
  if (next.product !== 'all' && next.product !== 'representative' && !productIds.has(next.product)) next.product = 'representative';
  if (next.product === 'representative' && !representativeIdsForRows(candidateRows, series).size) next.product = 'all';

  const selectedRows = filteredRows(observations, series, next);
  const metrics = metricOptions(selectedRows);
  if (!metrics.includes(next.metric)) next.metric = 'auto';
  next.limit = '5';
  return next;
}

export function metricOptions(rows: Observation[]): string[] {
  const known = Object.keys(METRIC_LABELS).filter((metric) => metric === 'auto' || rows.some((row) => metricFor(row, metric)));
  const dynamic = unique(rows.flatMap((row) => Object.entries(row.values ?? {})
    .filter(([key, value]) => !key.endsWith('_change_percent') && !(key in METRIC_LABELS) && finiteNumber(value) !== null)
    .map(([key]) => key)));
  return [...known, ...dynamic];
}

export function formatPrice(value: number, currency = 'USD'): string {
  return `${new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 3 }).format(value)} ${currency}`;
}

export function formatCount(value: number): string {
  return new Intl.NumberFormat('ko-KR').format(value);
}

export function formatDate(value?: string): string {
  if (!value) return '기준일 없음';
  const date = new Date(`${value.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', { year: 'numeric', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(date);
}

export function formatDateTime(value?: string): string {
  if (!value) return '수집 시각 없음';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat('ko-KR', {
    year: 'numeric', month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit', timeZone: 'Asia/Seoul',
  }).format(date);
}
