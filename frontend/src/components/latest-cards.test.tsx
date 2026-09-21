import { render, screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LatestCards } from '@/components/latest-cards';
import { observationFixture } from '@/test/fixtures';

describe('LatestCards price meaning', () => {
  it('preserves source names, prices and price dates independently of collection dates', () => {
    render(<LatestCards rows={[
      { ...observationFixture[0]!, product_name: 'DDR5 16Gb (2Gx8) 4800/5600', date: '2026-09-18', collected_at: '2026-09-21T00:00:00Z', values: { session_average: 55.433 } },
      { ...observationFixture.find((row) => row.kind === 'contract')!, product_name: 'DDR5 8GB SO-DIMM', date: '2026-07-31', collected_at: '2026-09-21T00:00:00Z', values: { session_average: 130 } },
    ]} />);

    const [chip, module] = screen.getAllByRole('article');
    expect(within(chip!).getByRole('heading', { name: 'DDR5 16Gb (2Gx8) 4800/5600' })).toBeInTheDocument();
    expect(within(chip!).getByText('55.433 USD')).toBeInTheDocument();
    expect(within(chip!).getByText('칩당 · 세션 평균 · TrendForce')).toBeInTheDocument();
    expect(within(module!).getByRole('heading', { name: 'DDR5 8GB SO-DIMM' })).toBeInTheDocument();
    expect(within(module!).getByText('130 USD')).toBeInTheDocument();
    expect(within(module!).getByText('2026년 7월 31일')).toBeInTheDocument();
    expect(within(module!).getByText('모듈당 · 세션 평균 · TrendForce')).toBeInTheDocument();
    expect(screen.queryByText('2026년 9월 21일')).not.toBeInTheDocument();
  });
});
