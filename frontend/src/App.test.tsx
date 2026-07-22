import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { App } from '@/App';
import { dashboardFixture } from '@/test/fixtures';

const loadDashboardData = vi.fn();
vi.mock('@/lib/data', () => ({ loadDashboardData: () => loadDashboardData() }));

describe('DRAM dashboard', () => {
  beforeEach(() => loadDashboardData.mockResolvedValue(dashboardFixture));

  it('renders a result-first view from real-contract data', async () => {
    render(<App />);
    expect(await screen.findByRole('heading', { name: '대표 6개 최신 가격' })).toBeInTheDocument();
    const latest = screen.getByRole('heading', { name: '대표 6개 최신 가격' }).closest('section')!;
    expect(within(latest).getAllByRole('article')).toHaveLength(6);
    expect(screen.getByText('데이터 사용 가능 · 주의')).toBeInTheDocument();
    expect(screen.getAllByText('2026년 7월 16일').length).toBeGreaterThan(0);
    expect(screen.getByRole('img', { name: /현물가 세션 평균 가격 추이/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '세부 조건' })).toHaveAttribute('data-state', 'closed');
    expect(screen.getByRole('button', { name: /데이터 · 출처 · 운영 상세/ })).toHaveAttribute('data-state', 'closed');
  });

  it('shows 10 rows first and expands to at most 50', async () => {
    const user = userEvent.setup();
    render(<App />);
    const table = await screen.findByRole('table');
    expect(within(table).getAllByRole('row')).toHaveLength(11);
    await user.click(screen.getByRole('button', { name: '최대 50개 보기' }));
    await waitFor(() => expect(within(table).getAllByRole('row')).toHaveLength(15));
  });

  it('migrates theme state to the shared storage key', async () => {
    const user = userEvent.setup();
    render(<App />);
    await screen.findByRole('heading', { name: 'DRAM 가격' });
    const toggle = screen.getByRole('button', { name: '다크 모드로 전환' });
    expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await user.click(toggle);
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('quant-research-theme')).toBe('dark');
  });

  it('migrates a legacy theme immediately on initial render', async () => {
    window.localStorage.setItem('dram-price-theme', 'dark');
    render(<App />);
    const toggle = await screen.findByRole('button', { name: '라이트 모드로 전환' });
    expect(toggle).toHaveAttribute('aria-pressed', 'true');
    expect(window.localStorage.getItem('quant-research-theme')).toBe('dark');
    expect(window.localStorage.getItem('dram-price-theme')).toBeNull();
  });

  it('keeps data visible but marks optional automation health as a warning when unavailable', async () => {
    loadDashboardData.mockResolvedValueOnce({
      ...dashboardFixture,
      automation: null,
      status: {
        ...dashboardFixture.status,
        sources: dashboardFixture.status.sources?.map((source) => ({ ...source, warnings: [], errors: [] })),
      },
    });
    render(<App />);

    expect(await screen.findByText('데이터 사용 가능 · 주의')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: '대표 6개 최신 가격' })).toBeInTheDocument();
  });
});
