import { describe, expect, it } from 'vitest';
import { assessAutomation } from '@/lib/automation-health';
import type { AutomationHealth } from '@/types';

const health: AutomationHealth = {
  contract: 'dram-automation-health', projectId: 'dram', status: 'ok',
  targetDate: '2026-09-25', updatedAt: '2026-09-25T05:00:00Z',
};

describe('DRAM automation freshness', () => {
  it('recognizes Friday recovery on Saturday without expecting weekend prices', () => {
    expect(assessAutomation(health, Date.parse('2026-09-26T09:00:00Z')).state).toBe('ok');
    expect(assessAutomation(health, Date.parse('2026-09-28T05:00:00Z')).state).toBe('ok');
  });

  it('does not demand later retry runs after the first price-day check', () => {
    expect(assessAutomation(health, Date.parse('2026-09-25T23:00:00Z')).state).toBe('ok');
  });

  it('shows a missed scheduled run even when the last persisted state was ok', () => {
    expect(assessAutomation(
      { ...health, updatedAt: '2026-09-24T20:00:00Z' },
      Date.parse('2026-09-26T09:00:00Z'),
    ).label).toBe('자동화 실행 지연');
    expect(assessAutomation(health, Date.parse('2026-09-28T11:00:00Z')).state).toBe('late');
  });

  it('preserves a verified price bundle while reporting the failed attempt', () => {
    expect(assessAutomation({ ...health, status: 'blocked' }).label).toBe('자동화 점검 필요');
    expect(assessAutomation({ ...health, status: 'blocked', details: [
      'daily_history error: target date 2026-09-25 is missing verified daily prices; latest TrendForce spot source date: 2026-09-24',
    ] }).label).toBe('신규 가격 미게시');
    expect(assessAutomation(null).label).toBe('자동화 상태 확인 불가');
    expect(assessAutomation({ ...health, status: 'no_publication' }).label).toBe('휴일 · 신규 가격 미게시');
  });
});
