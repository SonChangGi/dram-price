import { describe, expect, it } from 'vitest';
import { dashboardFixture } from '@/test/fixtures';
import {
  adaptDramStaticResultV1,
  assertDisplayFilterPatch,
  canonicalProjectRegistry,
  dashboardFilterControlIds,
  dramControlManifest,
  DRAM_STATIC_RESULT_CONTRACT,
  getCanonicalNavigation,
  type ControlManifest,
} from '@/shared-platform';

function rawFixture() {
  return {
    prices: {
      generated_at: dashboardFixture.status.generated_at,
      observations: dashboardFixture.observations,
    },
    series: {
      generated_at: dashboardFixture.status.generated_at,
      series: dashboardFixture.series,
    },
    status: dashboardFixture.status,
    automation: dashboardFixture.automation,
  };
}

describe('shared platform DRAM seam', () => {
  it('registers every result-affecting control without an analysis or operation control', () => {
    expect(
      new Set(dramControlManifest.controls.map((control) => control.controlKind)),
    ).toEqual(new Set(['display', 'result_selector']));
    const compatibilityManifest: ControlManifest = dramControlManifest;
    expect(
      compatibilityManifest.controls.filter(
        (control) =>
          control.controlKind === 'analysis' ||
          control.controlKind === 'operation',
      ),
    ).toEqual([]);
    expect(Object.keys(dashboardFilterControlIds).sort()).toEqual(
      ['category', 'kind', 'metric', 'product', 'source'].sort(),
    );
    expect(() =>
      assertDisplayFilterPatch({
        kind: 'contract',
        product: 'representative',
        source: 'all',
        category: 'all',
        metric: 'auto',
      }),
    ).not.toThrow();
  });

  it('keeps the canonical 11-project order and current DRAM identity', () => {
    expect(canonicalProjectRegistry).toHaveLength(11);
    expect(canonicalProjectRegistry.map((project) => project.id)).toEqual([
      'hub',
      'fear-greed',
      'momentum',
      'dram',
      'best-factor',
      'etf',
      'sox',
      'risk-score',
      'port',
      'valuation',
      'kelly',
    ]);
    expect(
      getCanonicalNavigation('dram').filter((project) => project.current),
    ).toEqual([
      expect.objectContaining({
        id: 'dram',
        url: 'https://sonchanggi.github.io/dram-price/',
      }),
    ]);
  });

  it('adapts the existing static result without copying or replacing result payloads', () => {
    const raw = rawFixture();
    const adapted = adaptDramStaticResultV1(raw);

    expect(adapted.identity).toMatchObject({
      projectId: 'dram',
      contractVersion: DRAM_STATIC_RESULT_CONTRACT,
      generatedAt: dashboardFixture.status.generated_at,
      observationCount: dashboardFixture.observations.length,
    });
    expect(adapted.data.observations).toBe(raw.prices.observations);
    expect(adapted.data.series).toBe(raw.series.series);
    expect(adapted.data.status).toBe(raw.status);
    expect(adapted.data.automation).toBe(raw.automation);
    expect(adapted.data).toEqual(dashboardFixture);
  });

  it('fails closed when required snapshot files do not share one identity', () => {
    const timestampMismatch = rawFixture();
    timestampMismatch.series.generated_at = '2026-07-21T03:45:01Z';
    expect(() => adaptDramStaticResultV1(timestampMismatch)).toThrow(
      '생성 시각이 일치하지 않습니다',
    );

    const countMismatch = rawFixture();
    countMismatch.status = {
      ...countMismatch.status,
      observation_count: dashboardFixture.observations.length + 1,
    };
    expect(() => adaptDramStaticResultV1(countMismatch)).toThrow(
      '관측치 수가 일치하지 않습니다',
    );
  });
});
