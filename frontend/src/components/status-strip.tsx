import { AlertTriangle, CheckCircle2, Clock3, Database } from 'lucide-react';
import { formatCount, formatDate, formatDateTime } from '@/lib/market';
import type { AutomationHealth, StatusPayload } from '@/types';
import { cn } from '@/lib/utils';
import { assessAutomation } from '@/lib/automation-health';

export function StatusStrip({ status, automation, dataAsOf }: { status: StatusPayload; automation: AutomationHealth | null; dataAsOf?: string }) {
  const sourceCount = status.sources?.length ?? 0;
  const healthySources = status.sources?.filter((source) => source.ok).length ?? 0;
  const warningCount = status.sources?.reduce((count, source) => count + (source.warnings?.length ?? 0) + (source.errors?.length ?? 0), 0) ?? 0;
  const automationAssessment = assessAutomation(automation);
  const state = automationAssessment.state === 'blocked' ? 'blocked' : automationAssessment.state !== 'ok' || warningCount ? 'warning' : 'ok';

  return (
    <section className="status-strip" aria-label="데이터 상태">
      <div className={cn('status-strip__item status-strip__state', `is-${state}`)}>
        {state === 'ok' ? <CheckCircle2 aria-hidden="true" /> : <AlertTriangle aria-hidden="true" />}
        <span><small>운영 상태</small><strong>{state === 'ok' ? '정상' : state === 'blocked' ? `데이터 유지 · ${automationAssessment.label}` : automationAssessment.label === '휴일 · 신규 가격 미게시' ? '데이터 유지 · 휴일 신규 가격 미게시' : automationAssessment.state === 'late' ? '데이터 사용 가능 · 자동화 실행 지연' : '데이터 사용 가능 · 주의'}</strong></span>
      </div>
      <div className="status-strip__item"><Clock3 aria-hidden="true" /><span><small>가격 기준일</small><strong>{formatDate(dataAsOf)}</strong></span></div>
      <div className="status-strip__item"><Database aria-hidden="true" /><span><small>관측치</small><strong>{formatCount(status.observation_count ?? 0)}개</strong></span></div>
      <div className="status-strip__item status-strip__last"><span><small>최근 수집</small><strong>{formatDateTime(status.generated_at)}</strong><em>{healthySources}/{sourceCount}개 소스 사용 가능</em></span></div>
    </section>
  );
}
