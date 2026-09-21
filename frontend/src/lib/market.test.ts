import { describe, expect, it } from 'vitest';
import { filteredRows, latestRepresentativeCards, metricFor, metricOptions, normalizeFilters, priceUnitFor } from '@/lib/market';
import { observationFixture, seriesFixture } from '@/test/fixtures';

describe('market contracts', () => {
  it('requires a real average for automatic prices instead of falling back to an extreme', () => {
    const row = { ...observationFixture[0]!, values: { daily_high: 99, daily_low: 10 } };
    expect(metricFor(row, 'auto')).toBeNull();
    expect(metricFor(row, 'daily_high')?.value).toBe(99);
    expect(latestRepresentativeCards([row], seriesFixture)).toHaveLength(0);
  });

  it.each([
    ['DDR4 8Gb (1Gx8) 3200', 'chip'],
    ['DDR5 16Gb (2Gx8) 4800/5600', 'chip'],
    ['DDR5 8GB SO-DIMM', 'module'],
    ['DDR4 32GB RDIMM', 'module'],
    ['DDR5 16gb', 'unknown'],
    ['DDR5 16GB', 'unknown'],
    ['DDR5 16Gb SO-DIMM', 'unknown'],
  ] as const)('identifies source price units without changing case or guessing: %s', (product_name, expected) => {
    expect(priceUnitFor({ product_name })).toBe(expected);
  });

  it('balances six latest cards across the three price kinds', () => {
    const cards = latestRepresentativeCards(observationFixture, seriesFixture);
    expect(cards).toHaveLength(6);
    expect(cards.reduce<Record<string, number>>((counts, row) => ({ ...counts, [row.kind]: (counts[row.kind] ?? 0) + 1 }), {})).toEqual({
      spot: 2,
      contract: 2,
      spot_proxy: 2,
    });
  });

  it('uses metric aliases and keeps custom numeric metrics', () => {
    const proxy = observationFixture.find((row) => row.kind === 'spot_proxy')!;
    expect(metricFor(proxy, 'daily_high')?.value).toBeUndefined();
    expect(metricFor(proxy, 'auto')?.key).toBe('average');
    expect(metricOptions(observationFixture)).toContain('custom_index');
  });

  it('falls back to usable rows when a filtered slice has no representative id', () => {
    const extra = { ...observationFixture[0]!, product_id: 'non-representative', product_name: 'Other', category: 'other' };
    const rows = filteredRows([extra], seriesFixture, { kind: 'spot', product: 'representative', source: 'all', category: 'other', metric: 'auto', limit: '5' });
    expect(rows).toEqual([extra]);
  });

  it('normalizes dependent filters when a source does not provide the selected kind', () => {
    const normalized = normalizeFilters(observationFixture, seriesFixture, {
      source: 'memorymarket', kind: 'spot', category: 'ddr5', product: 'representative', metric: 'session_average', limit: '5',
    });
    expect(normalized).toMatchObject({ source: 'memorymarket', kind: 'spot_proxy', category: 'all', metric: 'auto' });
    expect(filteredRows(observationFixture, seriesFixture, normalized).length).toBeGreaterThan(0);
  });
});
