import type {
  AutomationHealth,
  DashboardData,
  Observation,
  SeriesMeta,
  StatusPayload,
} from '@/types';

export const DRAM_STATIC_RESULT_CONTRACT = 'dram-static-result/v1' as const;

export interface DramStaticRawPayloads {
  prices: unknown;
  series: unknown;
  status: unknown;
  automation: unknown | null;
}

export interface DramStaticResultIdentity {
  projectId: 'dram';
  contractVersion: typeof DRAM_STATIC_RESULT_CONTRACT;
  generatedAt: string;
  dataAsOf: string;
  observationCount: number;
  resultKey: string;
  sourceFiles: readonly [
    'data/prices.json',
    'data/series.json',
    'data/status.json',
  ];
}

export interface AdaptedDramStaticResult {
  data: DashboardData;
  identity: DramStaticResultIdentity;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw new Error(`${path} 구조가 객체가 아닙니다.`);
  }
  return value as Record<string, unknown>;
}

function arrayField(payload: unknown, field: string, path: string): unknown[] {
  const value = record(payload, path)[field];
  if (!Array.isArray(value)) throw new Error(`${path}.${field} 배열이 없습니다.`);
  return value;
}

function requiredString(value: unknown, path: string): string {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${path} 문자열이 없습니다.`);
  }
  return value;
}

function validateObservation(
  value: unknown,
  index: number,
): asserts value is Observation {
  const row = record(value, `prices.observations[${index}]`);
  const values = record(row.values, `prices.observations[${index}].values`);
  const hasCanonicalPrice = ['session_average', 'average'].some(
    (key) => typeof values[key] === 'number' && Number.isFinite(values[key]),
  );
  if (!hasCanonicalPrice) {
    throw new Error(
      `observations[${index}].values에 canonical 평균 가격이 없습니다.`,
    );
  }
  const date = requiredString(row.date, `observations[${index}].date`);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) {
    throw new Error(`observations[${index}].date 형식이 올바르지 않습니다.`);
  }
  requiredString(row.cadence, `observations[${index}].cadence`);
  requiredString(row.currency, `observations[${index}].currency`);
  requiredString(row.kind, `observations[${index}].kind`);
  requiredString(row.product_id, `observations[${index}].product_id`);
  requiredString(row.product_name, `observations[${index}].product_name`);
  requiredString(row.source, `observations[${index}].source`);
}

function validateSeries(
  value: unknown,
  index: number,
): asserts value is SeriesMeta {
  const row = record(value, `series.series[${index}]`);
  requiredString(row.product_id, `series[${index}].product_id`);
  requiredString(row.product_name, `series[${index}].product_name`);
  requiredString(row.source, `series[${index}].source`);
}

function validateStatus(value: unknown): asserts value is StatusPayload {
  const payload = record(value, 'status');
  requiredString(payload.generated_at, 'status.generated_at');
  if (
    typeof payload.observation_count !== 'number' ||
    !Number.isFinite(payload.observation_count) ||
    payload.observation_count < 1
  ) {
    throw new Error('status.observation_count가 유효하지 않습니다.');
  }
  if (!Array.isArray(payload.sources) || !payload.sources.length) {
    throw new Error('status.sources 배열이 없습니다.');
  }
  payload.sources.forEach((source, index) =>
    requiredString(
      record(source, `status.sources[${index}]`).source,
      `status.sources[${index}].source`,
    ),
  );
}

function generatedAt(payload: unknown, path: string): string {
  return requiredString(record(payload, path).generated_at, `${path}.generated_at`);
}

function latestDataDate(observations: readonly Observation[]): string {
  const latest = observations
    .map((row) => row.date)
    .filter((date): date is string => /^\d{4}-\d{2}-\d{2}$/.test(date ?? ''))
    .sort()
    .at(-1);
  if (!latest) throw new Error('DRAM snapshot에 유효한 기준일이 없습니다.');
  return latest;
}

/**
 * Validates and adapts the existing JSON contracts without normalizing,
 * recalculating, sorting, or copying result rows.
 */
export function adaptDramStaticResultV1(
  payloads: DramStaticRawPayloads,
): AdaptedDramStaticResult {
  const rawObservations = arrayField(
    payloads.prices,
    'observations',
    'prices',
  );
  rawObservations.forEach(validateObservation);
  const observations = rawObservations as Observation[];
  const rawSeries = arrayField(payloads.series, 'series', 'series');
  rawSeries.forEach(validateSeries);
  const series = rawSeries as SeriesMeta[];
  validateStatus(payloads.status);

  if (!observations.length || !series.length) {
    throw new Error('표시할 DRAM 관측치 또는 시리즈가 없습니다.');
  }

  const statusCount = payloads.status.observation_count;
  if (statusCount !== observations.length) {
    throw new Error(
      `DRAM snapshot 관측치 수가 일치하지 않습니다: status=${statusCount}, prices=${observations.length}`,
    );
  }

  const snapshotGeneratedAt = generatedAt(payloads.status, 'status');
  for (const [path, payload] of [
    ['prices', payloads.prices],
    ['series', payloads.series],
  ] as const) {
    if (generatedAt(payload, path) !== snapshotGeneratedAt) {
      throw new Error(`DRAM snapshot 생성 시각이 일치하지 않습니다: ${path}`);
    }
  }

  const seriesIds = new Set(series.map((item) => item.product_id));
  const missingProduct = observations.find(
    (row) => !seriesIds.has(row.product_id),
  );
  if (missingProduct) {
    throw new Error(
      `series.json에 없는 제품입니다: ${missingProduct.product_id}`,
    );
  }

  const dataAsOf = latestDataDate(observations);
  const automation =
    payloads.automation === null
      ? null
      : (record(payloads.automation, 'automation') as AutomationHealth);

  return {
    data: {
      observations,
      series,
      status: payloads.status,
      automation,
    },
    identity: {
      projectId: 'dram',
      contractVersion: DRAM_STATIC_RESULT_CONTRACT,
      generatedAt: snapshotGeneratedAt,
      dataAsOf,
      observationCount: observations.length,
      resultKey: `${snapshotGeneratedAt}|${dataAsOf}|${observations.length}`,
      sourceFiles: [
        'data/prices.json',
        'data/series.json',
        'data/status.json',
      ],
    },
  };
}
