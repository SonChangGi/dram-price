import type { DashboardData, Observation, SeriesMeta } from '@/types';

const products = [
  ['spot-ddr5', 'DDR5 16Gb 4800/5600', 'spot', 'trendforce', 'ddr5'],
  ['spot-ddr4', 'DDR4 16Gb 3200', 'spot', 'trendforce', 'ddr4'],
  ['contract-ddr5-8gb-so-dimm', 'DDR5 8GB SO-DIMM', 'contract', 'trendforce', 'ddr5'],
  ['contract-ddr4-16gb-so-dimm', 'DDR4 16GB SO-DIMM', 'contract', 'trendforce', 'ddr4'],
  ['memorymarket-100266', 'DDR5 16Gb Major', 'spot_proxy', 'memorymarket', 'ddr'],
  ['memorymarket-100222', 'DDR4 16Gb 3200', 'spot_proxy', 'memorymarket', 'ddr'],
] as const;

export const seriesFixture: SeriesMeta[] = products.map(([product_id, product_name, kind, source, category]) => ({
  product_id, product_name, source, category, kinds: [kind], categories: [category], representative: true,
}));

export const observationFixture: Observation[] = products.flatMap(([product_id, product_name, kind, source, category], productIndex) =>
  Array.from({ length: kind === 'spot' ? 7 : 2 }, (_, index) => ({
    date: `2026-07-${String(10 + index).padStart(2, '0')}`,
    effective_date: `2026-07-${String(10 + index).padStart(2, '0')}`,
    product_id,
    product_name,
    kind,
    source,
    category,
    cadence: kind === 'spot' ? 'daily' : kind === 'contract' ? 'monthly' : 'weekly',
    currency: 'USD',
    source_url: `https://example.com/${product_id}`,
    values: kind === 'spot_proxy' ? { average: 20 + productIndex + index } : { session_average: 30 + productIndex + index, custom_index: 4 + index },
  })),
);

export const dashboardFixture: DashboardData = {
  observations: observationFixture,
  series: seriesFixture,
  status: {
    generated_at: '2026-07-22T03:45:01Z',
    observation_count: observationFixture.length,
    counts_by_kind: { spot: 14, contract: 4, spot_proxy: 4 },
    sources: [
      { source: 'trendforce', ok: true, observation_count: 18, urls: ['https://example.com/trendforce'], warnings: [] },
      { source: 'memorymarket', ok: true, observation_count: 4, urls: ['https://example.com/memorymarket'], warnings: ['stored data retained'] },
    ],
    caveats: ['Contract prices are monthly/update-date observations; collected_at is not the effective price date.'],
  },
  automation: { status: 'warning', targetDate: '2026-07-22', updatedAt: '2026-07-22T03:48:00Z', details: ['stored data retained'] },
};
