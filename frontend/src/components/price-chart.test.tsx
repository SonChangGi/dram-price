import { fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PriceChart } from '@/components/price-chart';
import type { Observation } from '@/types';

function spotObservation(productIndex: number, day: number): Observation {
  return {
    date: `2026-07-${String(day).padStart(2, '0')}`,
    effective_date: `2026-07-${String(day).padStart(2, '0')}`,
    product_id: `spot-${productIndex}`,
    product_name: `테스트 제품 ${productIndex}`,
    kind: 'spot',
    source: 'trendforce',
    category: 'ddr5',
    cadence: 'daily',
    currency: 'USD',
    source_url: `https://example.com/spot-${productIndex}`,
    values: { session_average: 20 + productIndex + day / 100 },
  };
}

describe('PriceChart', () => {
  it('caps each comparable facet at five series and exposes exact values inside the chart', async () => {
    const user = userEvent.setup();
    const rows = Array.from({ length: 6 }, (_, productIndex) => [
      spotObservation(productIndex + 1, 20),
      spotObservation(productIndex + 1, 21),
    ]).flat();

    const { container } = render(<PriceChart rows={rows} metric="auto" />);

    expect(screen.getByText(/5\/6개 시리즈/)).toBeInTheDocument();
    const controls = screen.getByRole('group', { name: '현물가 정확값을 확인할 시리즈 선택' });
    const buttons = within(controls).getAllByRole('button');
    expect(buttons).toHaveLength(5);
    const callout = container.querySelector('.chart-viewport > .chart-value-callout');
    expect(callout).not.toBeNull();
    expect(callout).toHaveAttribute('data-date', '2026-07-21');
    expect(within(callout as HTMLElement).getByText('21.21 USD')).toBeInTheDocument();
    expect(container.querySelectorAll('.chart-series.is-context')).toHaveLength(1);
    expect(container.querySelectorAll('.chart-series.is-muted')).toHaveLength(0);
    expect(screen.getByRole('button', { name: '차트 최신일' })).toBeInTheDocument();

    await user.click(buttons[0]!);
    expect(buttons[0]).toHaveAttribute('aria-pressed', 'true');
    expect(container.querySelectorAll('.chart-series.is-active')).toHaveLength(1);
    expect(container.querySelectorAll('.chart-series.is-muted')).toHaveLength(4);

    const dateSelect = screen.getByRole('combobox', { name: '현물가 차트 고정 선택일' });
    expect(dateSelect).toHaveValue('2026-07-21');
    await user.selectOptions(dateSelect, '2026-07-20');
    expect(dateSelect).toHaveValue('2026-07-20');
    expect(callout).toHaveAttribute('data-date', '2026-07-20');
    expect(within(callout as HTMLElement).getByText('21.2 USD')).toBeInTheDocument();

    const chart = container.querySelector('.chart-scroll') as HTMLElement;
    expect(chart).toHaveAttribute('role', 'group');
    expect(chart).toHaveAttribute('aria-roledescription', '대화형 가격 차트');
    expect(chart).toHaveAttribute('aria-keyshortcuts', 'ArrowLeft ArrowRight Home End');
    const interactionHelp = document.getElementById(chart.getAttribute('aria-describedby')!);
    expect(interactionHelp).toHaveClass('sr-only');
    chart.focus();
    await user.keyboard('{End}');
    expect(callout).toHaveAttribute('data-date', '2026-07-21');
    await user.keyboard('{ArrowLeft}');
    expect(callout).toHaveAttribute('data-date', '2026-07-20');

    const svg = container.querySelector('.chart-scroll svg');
    expect(svg?.querySelector('[role="button"], [tabindex]')).toBeNull();
  });

  it('uses pointer position for temporary exploration and keeps a clicked date', async () => {
    const user = userEvent.setup();
    const rows = [spotObservation(1, 20), spotObservation(1, 21), spotObservation(2, 20), spotObservation(2, 21)];
    const { container } = render(<PriceChart rows={rows} metric="auto" />);
    const controls = screen.getByRole('group', { name: '현물가 정확값을 확인할 시리즈 선택' });
    const firstControl = within(controls).getByRole('button', { name: '테스트 제품 1' });
    await user.click(firstControl);

    const svg = container.querySelector('.chart-scroll svg') as SVGSVGElement;
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 980, bottom: 400, width: 980, height: 400, toJSON: () => ({}) }),
    });
    const callout = container.querySelector('.chart-value-callout') as HTMLElement;

    fireEvent.pointerMove(svg, { clientX: 64, pointerType: 'mouse' });
    expect(callout).toHaveAttribute('data-date', '2026-07-20');
    fireEvent.pointerLeave(svg);
    expect(callout).toHaveAttribute('data-date', '2026-07-21');

    fireEvent.click(svg, { clientX: 64 });
    fireEvent.pointerLeave(svg);
    expect(callout).toHaveAttribute('data-date', '2026-07-20');
    expect(container.querySelector('.chart-selection-guide')).toHaveAttribute('data-date', '2026-07-20');
  });

  it('uses hover as temporary series emphasis and restores a clicked series', async () => {
    const user = userEvent.setup();
    const rows = [spotObservation(1, 20), spotObservation(1, 21), spotObservation(2, 20), spotObservation(2, 21)];
    const { container } = render(<PriceChart rows={rows} metric="auto" />);
    const controls = screen.getByRole('group', { name: '현물가 정확값을 확인할 시리즈 선택' });
    await user.click(within(controls).getByRole('button', { name: '테스트 제품 1' }));

    const series = container.querySelectorAll('.chart-series');
    fireEvent.pointerEnter(series[1]!);
    expect(within(container.querySelector('.chart-value-callout') as HTMLElement).getByText('테스트 제품 2')).toBeInTheDocument();
    expect(series[1]).toHaveClass('is-active');
    expect(series[0]).toHaveClass('is-muted');

    fireEvent.pointerLeave(series[1]!);
    expect(within(container.querySelector('.chart-value-callout') as HTMLElement).getByText('테스트 제품 1')).toBeInTheDocument();
    expect(series[0]).toHaveClass('is-active');
    expect(series[1]).toHaveClass('is-muted');
  });

  it('keeps pointer, keyboard, marker and readout on actual dates of the active sparse series', async () => {
    const user = userEvent.setup();
    const sparse = [20, 22, 24].map((day) => spotObservation(1, day));
    const offset = [21, 23, 25].map((day) => spotObservation(2, day));
    const { container } = render(<PriceChart rows={[...sparse, ...offset]} metric="auto" />);
    const controls = screen.getByRole('group', { name: '현물가 정확값을 확인할 시리즈 선택' });
    await user.click(within(controls).getByRole('button', { name: '테스트 제품 1' }));

    const chart = container.querySelector('.chart-scroll') as HTMLElement;
    const svg = chart.querySelector('svg') as SVGSVGElement;
    const callout = container.querySelector('.chart-value-callout') as HTMLElement;
    const dateSelect = screen.getByRole('combobox', { name: '현물가 차트 고정 선택일' });
    Object.defineProperties(chart, {
      scrollWidth: { configurable: true, value: 980 },
      clientWidth: { configurable: true, value: 320 }
    });
    Object.defineProperty(chart, 'scrollLeft', { configurable: true, writable: true, value: 0 });
    Object.defineProperty(svg, 'getBoundingClientRect', {
      configurable: true,
      value: () => ({ x: 0, y: 0, top: 0, left: 0, right: 980, bottom: 460, width: 980, height: 460, toJSON: () => ({}) }),
    });

    expect(dateSelect.querySelectorAll('option')).toHaveLength(3);
    expect(dateSelect).toHaveValue('2026-07-24');
    expect(callout).toHaveAttribute('data-date', '2026-07-24');

    fireEvent.pointerMove(svg, { clientX: 64, pointerType: 'mouse' });
    expect(callout).toHaveAttribute('data-date', '2026-07-20');
    expect(container.querySelector('.chart-selection-guide')).toHaveAttribute('data-date', '2026-07-20');
    expect(container.querySelector('.chart-selected-point.is-active')).toHaveAttribute('data-date', '2026-07-20');
    expect(callout).not.toHaveTextContent('관측 없음');

    fireEvent.pointerMove(svg, { clientX: 64 + (2 / 5) * 726, pointerType: 'mouse' });
    expect(callout).toHaveAttribute('data-date', '2026-07-22');
    expect(container.querySelector('.chart-selected-point.is-active')).toHaveAttribute('data-date', '2026-07-22');

    fireEvent.click(svg, { clientX: 790 });
    fireEvent.pointerLeave(svg);
    expect(callout).toHaveAttribute('data-date', '2026-07-24');
    expect(dateSelect).toHaveValue('2026-07-24');
    expect(container.querySelector('.chart-selected-point.is-active')).toHaveAttribute('data-date', '2026-07-24');

    chart.focus();
    await user.keyboard('{Home}');
    expect(callout).toHaveAttribute('data-date', '2026-07-20');
    await user.keyboard('{ArrowRight}');
    expect(callout).toHaveAttribute('data-date', '2026-07-22');
    await user.keyboard('{End}');
    expect(callout).toHaveAttribute('data-date', '2026-07-24');
    expect(chart.scrollLeft).toBeGreaterThan(0);
  });

  it('does not draw a misleading line for a one-point series', () => {
    render(<PriceChart rows={[spotObservation(1, 21)]} metric="auto" />);

    expect(screen.getByText(/날짜가 다른 관측치가 2개 이상 필요/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('treats duplicate rows on the same date as one point', () => {
    const row = spotObservation(1, 21);
    render(<PriceChart rows={[row, { ...row, values: { session_average: 99 } }]} metric="auto" />);

    expect(screen.getByText(/날짜가 다른 관측치가 2개 이상 필요/)).toBeInTheDocument();
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
  });

  it('keeps rows from different source and cadence grains in separate series', () => {
    const trendforce = [spotObservation(1, 20), spotObservation(1, 21)];
    const alternate = trendforce.map((row) => ({
      ...row,
      source: 'alternate',
      cadence: 'weekly',
      values: { session_average: (row.values?.session_average ?? 0) + 5 },
    }));

    render(<PriceChart rows={[...trendforce, ...alternate]} metric="auto" />);

    expect(screen.getByText(/2\/2개 시리즈/)).toBeInTheDocument();
    const controls = screen.getByRole('group', { name: '현물가 정확값을 확인할 시리즈 선택' });
    expect(within(controls).getAllByRole('button')).toHaveLength(2);
    expect(within(controls).getByRole('button', { name: '테스트 제품 1 · TrendForce · 일간' })).toBeInTheDocument();
    expect(within(controls).getByRole('button', { name: '테스트 제품 1 · alternate · 주간' })).toBeInTheDocument();
  });

  it('drops an unavailable selection instead of reviving it after a product round trip', async () => {
    const user = userEvent.setup();
    const firstProduct = [spotObservation(1, 20), spotObservation(1, 21)];
    const secondProduct = [spotObservation(2, 20), spotObservation(2, 21)];
    const { container, rerender } = render(<PriceChart rows={firstProduct} metric="auto" />);

    await user.click(screen.getByRole('button', { name: '테스트 제품 1' }));
    expect(screen.getByRole('button', { name: '테스트 제품 1' })).toHaveAttribute('aria-pressed', 'true');

    rerender(<PriceChart rows={secondProduct} metric="auto" />);

    const nextButton = screen.getByRole('button', { name: '테스트 제품 2' });
    expect(nextButton).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('.chart-series.is-muted')).not.toBeInTheDocument();
    expect(within(container.querySelector('.chart-value-callout') as HTMLElement).getByText('테스트 제품 2')).toBeInTheDocument();

    rerender(<PriceChart rows={firstProduct} metric="auto" />);

    const restoredButton = screen.getByRole('button', { name: '테스트 제품 1' });
    expect(restoredButton).toHaveAttribute('aria-pressed', 'false');
    expect(container.querySelector('.chart-series.is-muted')).not.toBeInTheDocument();
    expect(container.querySelectorAll('.chart-series.is-context')).toHaveLength(1);
    expect(within(container.querySelector('.chart-value-callout') as HTMLElement).getByText('테스트 제품 1')).toBeInTheDocument();
  });
});
