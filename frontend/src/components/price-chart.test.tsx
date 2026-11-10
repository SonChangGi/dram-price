import { render, screen, within } from '@testing-library/react';
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
  it('separates chip and module prices into comparable unit facets', () => {
    const rows=['DDR4 8Gb (1Gx8)','DDR4 8GB SO-DIMM'].flatMap((product_name,index)=>[20,21].map(day=>({...spotObservation(index+1,day),product_name,kind:'contract'})));
    const {container}=render(<PriceChart rows={rows} metric="auto"/>);
    expect(container.querySelectorAll('.chart-facet')).toHaveLength(2);
    expect(screen.getAllByRole('img')).toHaveLength(2);
    expect(container.textContent).toContain('칩당');expect(container.textContent).toContain('모듈당');
  });
  it('does not silently use high-only observations as average prices',()=>{
    render(<PriceChart rows={[20,21].map(day=>({...spotObservation(1,day),values:{daily_high:99}}))} metric="auto"/>);
    expect(screen.queryByRole('img')).not.toBeInTheDocument();
    expect(screen.getByText('선택 조건에서 표시할 유효 평균 가격이 없습니다.')).toBeInTheDocument();
  });
  it('caps comparison at five series and reports the full available count', async()=>{
    const user=userEvent.setup(); const rows=Array.from({length:6},(_,i)=>[20,21].map(day=>spotObservation(i+1,day))).flat();
    const {container}=render(<PriceChart rows={rows} metric="auto"/>);
    expect(screen.getByText(/5\/6개 시리즈/)).toBeInTheDocument();
    const controls=screen.getByRole('group',{name:'현물가 정확값을 확인할 시리즈 선택'});expect(within(controls).getAllByRole('button')).toHaveLength(5);
    expect(container.querySelector('.qe-price-readout')).toHaveAttribute('data-date','2026-07-21');
    await user.click(within(controls).getByRole('button',{name:'테스트 제품 1'}));
    expect(within(controls).getByRole('button',{name:'테스트 제품 1'})).toHaveAttribute('aria-pressed','true');
    expect(within(container.querySelector('.qe-price-readout') as HTMLElement).getByText('21.21 USD')).toBeInTheDocument();
  });
  it('preserves exact keyboard and explicit-date selection',async()=>{
    const user=userEvent.setup();const {container}=render(<PriceChart rows={[20,21].map(day=>spotObservation(1,day))} metric="auto"/>);
    const chart=screen.getByRole('img');chart.focus();await user.keyboard('{Home}');
    expect(container.querySelector('.qe-price-readout')).toHaveAttribute('data-date','2026-07-20');
    await user.keyboard('{End}');expect(container.querySelector('.qe-price-readout')).toHaveAttribute('data-date','2026-07-21');
    await user.click(screen.getByText('차트 옵션'));await user.selectOptions(screen.getByRole('combobox'),'2026-07-20');
    expect(container.querySelector('.qe-price-readout')).toHaveAttribute('data-date','2026-07-20');
  });
  it('uses actual observations of the selected sparse series',async()=>{
    const user=userEvent.setup();const rows=[spotObservation(1,20),spotObservation(1,22),spotObservation(2,20),spotObservation(2,21),spotObservation(2,22)];
    const {container}=render(<PriceChart rows={rows} metric="auto"/>);
    await user.click(within(screen.getByRole('group',{name:'현물가 정확값을 확인할 시리즈 선택'})).getByRole('button',{name:'테스트 제품 1'}));
    screen.getByRole('img').focus();await user.keyboard('{ArrowLeft}');
    expect(container.querySelector('.qe-price-readout')).toHaveAttribute('data-date','2026-07-20');
    expect(container.querySelector('.qe-price-readout')).toHaveTextContent('21.2 USD');
  });
  it('does not merge different source or cadence grains',()=>{
    const rows=[20,21].flatMap(day=>[spotObservation(1,day),{...spotObservation(1,day),source:'memorymarket',cadence:'weekly'}]);
    render(<PriceChart rows={rows} metric="auto"/>);
    expect(within(screen.getByRole('group',{name:'현물가 정확값을 확인할 시리즈 선택'})).getAllByRole('button')).toHaveLength(2);
    expect(screen.getByRole('group',{name:'현물가 정확값을 확인할 시리즈 선택'})).toHaveTextContent('MemoryMarket');expect(screen.getByRole('group',{name:'현물가 정확값을 확인할 시리즈 선택'})).toHaveTextContent('주간');
  });
  it('does not revive a removed series selection after filters round-trip',async()=>{
    const user=userEvent.setup();const a=[20,21].map(day=>spotObservation(1,day)),b=[20,21].map(day=>spotObservation(2,day));
    const {rerender}=render(<PriceChart rows={[...a,...b]} metric="auto"/>);
    await user.click(within(screen.getByRole('group',{name:'현물가 정확값을 확인할 시리즈 선택'})).getByRole('button',{name:'테스트 제품 1'}));
    rerender(<PriceChart rows={b} metric="auto"/>);rerender(<PriceChart rows={[...a,...b]} metric="auto"/>);
    expect(within(screen.getByRole('group',{name:'현물가 정확값을 확인할 시리즈 선택'})).getByRole('button',{name:'테스트 제품 1'})).toHaveAttribute('aria-pressed','false');
  });
  it('calculates a requested range from actual prices without mutating observations',async()=>{
    const user=userEvent.setup();const rows=[spotObservation(1,20),spotObservation(1,21)],before=JSON.stringify(rows);
    const {container}=render(<PriceChart rows={rows} metric="auto"/>);await user.click(screen.getByText('차트 옵션'));await user.click(screen.getByRole('button',{name:'적용'}));
    expect(container.querySelector('.qe-price-range')).toHaveTextContent('0.05%');expect(JSON.stringify(rows)).toBe(before);
    await user.click(screen.getByRole('button',{name:'해제'}));expect(container.querySelector('.qe-price-range')).toBeNull();
  });
});
