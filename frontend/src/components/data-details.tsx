import * as Collapsible from '@radix-ui/react-collapsible';
import { ArrowUpRight, ChevronDown, CircleAlert, Database, RefreshCw } from 'lucide-react';
import { formatCount, formatDateTime, sourceLabel } from '@/lib/market';
import type { AutomationHealth, StatusPayload } from '@/types';

const caveatLabels: Record<string, string> = {
  'TrendForce/DRAMeXchange public pages expose current tables but not free historical data.': 'TrendForce 공개 페이지는 현재 표 중심이며 무료 과거 데이터는 제한적입니다.',
  'MemoryMarket publicly discloses six-month weekly history; respect source terms and attribution.': 'MemoryMarket은 최근 약 6개월 주간 이력을 공개합니다.',
  'Contract prices are monthly/update-date observations; collected_at is not the effective price date.': '고정가는 월간 또는 업데이트일 기준이며 수집 시각과 가격 적용일이 다를 수 있습니다.',
};

export function DataDetails({ status, automation }: { status: StatusPayload; automation: AutomationHealth | null }) {
  return (
    <Collapsible.Root className="data-details">
      <Collapsible.Trigger className="data-details__trigger">
        <span><Database aria-hidden="true" /><span><strong>데이터 · 출처 · 운영 상세</strong><small>필요할 때만 펼쳐 확인하세요.</small></span></span>
        <ChevronDown aria-hidden="true" className="data-details__chevron" />
      </Collapsible.Trigger>
      <Collapsible.Content className="data-details__content">
        <div className="detail-grid">
          <section><h3>소스 상태</h3>{status.sources?.map((source) => { const hasWarnings = Boolean(source.warnings?.length || source.errors?.length); return <article className="source-state" key={source.source}><div><strong>{sourceLabel(source.source)}</strong><span className={source.ok && !hasWarnings ? 'is-ok' : 'is-warning'}>{source.ok ? hasWarnings ? '사용 가능 · 주의' : '사용 가능' : '점검 필요'}</span></div><p>{formatCount(source.observation_count ?? 0)}개 관측치 · {[...(source.warnings ?? []), ...(source.errors ?? [])].join(' · ') || '추가 경고 없음'}</p>{source.urls?.[0] ? <a href={source.urls[0]} target="_blank" rel="noreferrer">원문 출처<ArrowUpRight aria-hidden="true" /></a> : null}</article>; })}</section>
          <section><h3>읽기 기준</h3><ul>{status.caveats?.map((caveat) => <li key={caveat}>{caveatLabels[caveat] ?? caveat}</li>)}</ul></section>
          <section><h3>자동화</h3><p className="detail-status"><RefreshCw aria-hidden="true" />{automation === null ? '자동화 상태 확인 불가' : automation.status === 'ok' ? '최근 자동화 정상' : automation.status === 'blocked' ? '자동화 점검 필요' : '최근 자동화에 주의사항 있음'}</p><p>업데이트: {formatDateTime(automation?.updatedAt)}</p>{automation?.details?.length ? <ul>{automation.details.map((detail) => <li key={detail}>{detail}</li>)}</ul> : null}<a href="https://github.com/SonChangGi/dram-price/actions/workflows/update-data.yml" target="_blank" rel="noreferrer">GitHub Actions 열기<ArrowUpRight aria-hidden="true" /></a></section>
        </div>
        <div className="data-links"><CircleAlert aria-hidden="true" /><span>정규화된 공개 JSON</span><a href="data/prices.json">가격 데이터</a><a href="data/series.json">시리즈</a><a href="data/status.json">수집 상태</a><a href="data/summary.json">공통 요약 계약</a></div>
      </Collapsible.Content>
    </Collapsible.Root>
  );
}
