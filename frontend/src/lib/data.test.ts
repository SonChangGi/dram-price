import { afterEach, describe, expect, it, vi } from 'vitest';
import { loadDashboardData } from '@/lib/data';
import { dashboardFixture } from '@/test/fixtures';

afterEach(() => vi.unstubAllGlobals());

function mockPayload(filename: string) {
  if (filename.endsWith('prices.json')) return { observations: dashboardFixture.observations };
  if (filename.endsWith('series.json')) return { series: dashboardFixture.series };
  if (filename.endsWith('status.json')) return dashboardFixture.status;
  return dashboardFixture.automation;
}

describe('dashboard data loader', () => {
  it('loads repository JSON with no-store and validates the contract', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      return { ok: true, status: 200, json: async () => mockPayload(String(input)) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadDashboardData();
    expect(result.observations).toHaveLength(dashboardFixture.observations.length);
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls.every((call) => call[1]?.cache === 'no-store')).toBe(true);
  });

  it('fails closed when an observation has no finite display price', async () => {
    const malformed = { ...dashboardFixture.observations[0], values: { average: null } };
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      return {
        ok: true,
        status: 200,
        json: async () => String(input).endsWith('prices.json') ? { observations: [malformed] } : mockPayload(String(input)),
      };
    });
    vi.stubGlobal('fetch', fetchMock);
    await expect(loadDashboardData()).rejects.toThrow('canonical 평균 가격');
  });

  it('fails closed when observation unit or cadence is missing', async () => {
    for (const field of ['currency', 'cadence'] as const) {
      const malformed = { ...dashboardFixture.observations[0], [field]: '' };
      const fetchMock = vi.fn(async (input: string | URL | Request) => ({
        ok: true,
        status: 200,
        json: async () => String(input).endsWith('prices.json') ? { observations: [malformed] } : mockPayload(String(input)),
      }));
      vi.stubGlobal('fetch', fetchMock);
      await expect(loadDashboardData()).rejects.toThrow(`.${field}`);
    }
  });

  it('keeps verified market data usable when optional automation health is unavailable', async () => {
    const fetchMock = vi.fn(async (input: string | URL | Request, init?: RequestInit) => {
      void init;
      if (String(input).endsWith('automation-health.json')) return { ok: false, status: 404, json: async () => ({}) };
      return { ok: true, status: 200, json: async () => mockPayload(String(input)) };
    });
    vi.stubGlobal('fetch', fetchMock);
    const result = await loadDashboardData();
    expect(result.automation).toBeNull();
    expect(result.observations.length).toBeGreaterThan(0);
  });
});
