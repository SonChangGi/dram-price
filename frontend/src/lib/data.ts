import type { AutomationHealth, DashboardData, Observation, SeriesMeta, StatusPayload } from '@/types';

type DataFile = 'prices.json' | 'series.json' | 'status.json' | 'automation-health.json';

function candidateUrls(filename: DataFile): string[] {
  const base = import.meta.env.BASE_URL.endsWith('/') ? import.meta.env.BASE_URL : `${import.meta.env.BASE_URL}/`;
  const candidates = [
    `${base}data/${filename}`,
    new URL(`data/${filename}`, document.baseURI).toString(),
    new URL(`../data/${filename}`, document.baseURI).toString(),
  ];
  return [...new Set(candidates)];
}

async function loadJson(filename: DataFile): Promise<unknown> {
  const failures: string[] = [];
  for (const url of candidateUrls(filename)) {
    try {
      const response = await fetch(url, {
        cache: 'no-store',
        headers: { Accept: 'application/json' },
      });
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      return await response.json();
    } catch (error) {
      failures.push(`${url}: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
  throw new Error(`${filename}을 불러오지 못했습니다. ${failures.join(' | ')}`);
}

function record(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('JSON 최상위 구조가 객체가 아닙니다.');
  return value as Record<string, unknown>;
}

function arrayField(payload: unknown, field: string): unknown[] {
  const value = record(payload)[field];
  if (!Array.isArray(value)) throw new Error(`${field} 배열이 없습니다.`);
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${path} 문자열이 없습니다.`);
  return value;
}

function validateObservation(value: unknown, index: number): Observation {
  const row = record(value);
  const values = record(row.values);
  const hasCanonicalPrice = ['session_average', 'average'].some((key) => typeof values[key] === 'number' && Number.isFinite(values[key]));
  if (!hasCanonicalPrice) throw new Error(`observations[${index}].values에 canonical 평균 가격이 없습니다.`);
  const date = requiredString(row.date, `observations[${index}].date`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) throw new Error(`observations[${index}].date 형식이 올바르지 않습니다.`);
  return {
    ...(row as unknown as Observation),
    cadence: requiredString(row.cadence, `observations[${index}].cadence`),
    currency: requiredString(row.currency, `observations[${index}].currency`),
    date,
    kind: requiredString(row.kind, `observations[${index}].kind`),
    product_id: requiredString(row.product_id, `observations[${index}].product_id`),
    product_name: requiredString(row.product_name, `observations[${index}].product_name`),
    source: requiredString(row.source, `observations[${index}].source`),
    values: values as Observation['values'],
  };
}

function validateSeries(value: unknown, index: number): SeriesMeta {
  const row = record(value);
  return {
    ...(row as unknown as SeriesMeta),
    product_id: requiredString(row.product_id, `series[${index}].product_id`),
    product_name: requiredString(row.product_name, `series[${index}].product_name`),
    source: requiredString(row.source, `series[${index}].source`),
  };
}

function validateStatus(value: unknown): StatusPayload {
  const payload = record(value);
  requiredString(payload.generated_at, 'status.generated_at');
  if (typeof payload.observation_count !== 'number' || !Number.isFinite(payload.observation_count) || payload.observation_count < 1) {
    throw new Error('status.observation_count가 유효하지 않습니다.');
  }
  if (!Array.isArray(payload.sources) || !payload.sources.length) throw new Error('status.sources 배열이 없습니다.');
  payload.sources.forEach((source, index) => requiredString(record(source).source, `status.sources[${index}].source`));
  return payload as unknown as StatusPayload;
}

export async function loadDashboardData(): Promise<DashboardData> {
  const [pricesPayload, seriesPayload, statusPayload, automationPayload] = await Promise.all([
    loadJson('prices.json'),
    loadJson('series.json'),
    loadJson('status.json'),
    loadJson('automation-health.json').catch(() => null),
  ]);
  const observations = arrayField(pricesPayload, 'observations').map(validateObservation);
  const series = arrayField(seriesPayload, 'series').map(validateSeries);
  if (!observations.length || !series.length) throw new Error('표시할 DRAM 관측치 또는 시리즈가 없습니다.');
  return {
    observations,
    series,
    status: validateStatus(statusPayload),
    automation: automationPayload ? record(automationPayload) as AutomationHealth : null,
  };
}

export const dataPathCandidates = candidateUrls;
