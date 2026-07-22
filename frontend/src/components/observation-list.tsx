import { ArrowUpRight, ChevronDown } from 'lucide-react';
import { useMemo, useState } from 'react';
import { Button } from '@/components/ui/button';
import { categoryLabel, formatDate, formatPrice, kindLabel, metricFor, sourceLabel } from '@/lib/market';
import type { Observation } from '@/types';

export function ObservationList({ rows, metric }: { rows: Observation[]; metric: string }) {
  const [visible, setVisible] = useState(10);
  const sorted = useMemo(() => rows.slice().sort((a, b) => String(b.date ?? '').localeCompare(String(a.date ?? '')) || a.product_name.localeCompare(b.product_name)), [rows]);
  const shown = sorted.slice(0, visible);

  return (
    <section className="panel observation-panel" aria-labelledby="observations-heading">
      <div className="section-heading">
        <div><p className="eyebrow">Latest observations</p><h2 id="observations-heading">최신 가격 목록</h2></div>
        <p>{sorted.length.toLocaleString('ko-KR')}개 관측치 중 {shown.length}개 표시 · 날짜 역순</p>
      </div>
      <div className="desktop-table" tabIndex={0} aria-label="최신 가격 표 스크롤 영역">
        <table>
          <thead><tr><th>기준일</th><th>가격 종류</th><th>제품</th><th>카테고리</th><th>소스</th><th className="is-number">가격</th></tr></thead>
          <tbody>
            {shown.map((row, index) => {
              const point = metricFor(row, metric);
              return <tr key={`${row.product_id}-${row.kind}-${row.date}-${index}`}><td>{formatDate(row.date)}</td><td><span className={`kind-badge is-${row.kind}`}>{kindLabel(row.kind)}</span></td><td>{row.product_name}</td><td>{categoryLabel(row.category || 'uncategorized')}</td><td>{row.source_url ? <a className="source-link" href={row.source_url} target="_blank" rel="noreferrer">{sourceLabel(row.source)}<ArrowUpRight aria-hidden="true" /></a> : sourceLabel(row.source)}</td><td className="is-number">{point ? formatPrice(point.value, row.currency) : '—'}</td></tr>;
            })}
          </tbody>
        </table>
      </div>
      <div className="mobile-observation-list">
        {shown.map((row, index) => {
          const point = metricFor(row, metric);
          return <article key={`${row.product_id}-${row.kind}-${row.date}-mobile-${index}`}><div><span className={`kind-badge is-${row.kind}`}>{kindLabel(row.kind)}</span><time>{formatDate(row.date)}</time></div><h3>{row.product_name}</h3><strong>{point ? formatPrice(point.value, row.currency) : '값 없음'}</strong><footer>{categoryLabel(row.category || 'uncategorized')} · {sourceLabel(row.source)}</footer></article>;
        })}
      </div>
      {!shown.length ? <div className="empty-state">선택 조건에서 표시할 최신 관측치가 없습니다.</div> : null}
      {visible < Math.min(50, sorted.length) ? <div className="show-more"><Button onClick={() => setVisible(50)}><ChevronDown aria-hidden="true" />최대 50개 보기</Button></div> : null}
    </section>
  );
}
