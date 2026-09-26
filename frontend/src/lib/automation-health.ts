import type { AutomationHealth } from '@/types';

export type AutomationAssessment = {
  state: 'ok' | 'warning' | 'blocked' | 'late' | 'unknown';
  label: string;
};

export function assessAutomation(health: AutomationHealth | null, now = Date.now()): AutomationAssessment {
  if (health?.contract !== 'dram-automation-health' || health.projectId !== 'dram') {
    return { state: 'unknown', label: '자동화 상태 확인 불가' };
  }
  if (health.status === 'blocked') {
    const details = health.details ?? [];
    const unpublished = details.length > 0
      && details.every((detail) => detail.startsWith('daily_history error: target date '));
    return { state: 'blocked', label: unpublished ? '신규 가격 미게시' : '자동화 점검 필요' };
  }
  const updatedAt = Date.parse(health.updatedAt ?? '');
  const targetDate = health.targetDate ?? '';
  if (!Number.isFinite(updatedAt) || !/^\d{4}-\d{2}-\d{2}$/.test(targetDate)) {
    return { state: 'unknown', label: '자동화 상태 확인 불가' };
  }

  // One completed check per UTC weekday is enough. Later slots are retries
  // and legitimately skip when the first run already published the price day.
  // Allow six hours because GitHub has queued first runs over five hours late.
  const firstSlotMinutes = 255;
  const dayMs = 24 * 60 * 60 * 1000;
  const todayStart = Math.floor(now / dayMs) * dayMs;
  for (let daysBack = 0; daysBack < 8; daysBack += 1) {
    const day = todayStart - daysBack * dayMs;
    const weekday = new Date(day).getUTCDay();
    if (weekday < 1 || weekday > 5) continue;
    const scheduledAt = day + firstSlotMinutes * 60 * 1000;
    if (scheduledAt + 6 * 60 * 60 * 1000 > now) continue;
    const expectedDate = new Date(day).toISOString().slice(0, 10);
    if (updatedAt < scheduledAt || targetDate < expectedDate) {
      return { state: 'late', label: '자동화 실행 지연' };
    }
    break;
  }
  if (health.status === 'warning') return { state: 'warning', label: '자동화 주의' };
  if (health.status === 'no_publication') return { state: 'warning', label: '휴일 · 신규 가격 미게시' };
  if (health.status !== 'ok') return { state: 'unknown', label: '자동화 상태 확인 불가' };
  return { state: 'ok', label: '정상' };
}
