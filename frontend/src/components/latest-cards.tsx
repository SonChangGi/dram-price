import { ArrowUpRight } from 'lucide-react';
import { formatDate, formatPrice, kindLabel, metricFor, sourceLabel } from '@/lib/market';
import type { Observation } from '@/types';

export function LatestCards({ rows }: { rows: Observation[] }) {
  return (
    <section className="latest-section" aria-labelledby="latest-heading">
      <div className="section-heading section-heading--compact">
        <div><p className="eyebrow">Latest prices</p><h2 id="latest-heading">대표 6개 최신 가격</h2></div>
      </div>
      <div className="latest-grid">
        {rows.map((row) => {
          const metric = metricFor(row, 'auto');
          return (
            <article className="latest-card" key={`${row.product_id}-${row.kind}`}>
              <div className="latest-card__meta"><span className={`kind-badge is-${row.kind}`}>{kindLabel(row.kind)}</span><span>{formatDate(row.date)}</span></div>
              <h3>{row.product_name}</h3>
              <strong>{metric ? formatPrice(metric.value, row.currency) : '값 없음'}</strong>
              <footer><span>{metric?.label ?? '지표 없음'} · {sourceLabel(row.source)}</span>{row.source_url ? <a href={row.source_url} target="_blank" rel="noreferrer" aria-label={`${row.product_name} 원문 열기`}><ArrowUpRight aria-hidden="true" /></a> : null}</footer>
            </article>
          );
        })}
        {!rows.length ? <div className="empty-state">표시할 대표 최신 가격이 없습니다.</div> : null}
      </div>
    </section>
  );
}
