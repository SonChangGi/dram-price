import { AlertTriangle, ArrowUpRight, LoaderCircle } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { DataDetails } from '@/components/data-details';
import { Button } from '@/components/ui/button';
import { FilterControls } from '@/components/filter-controls';
import { LatestCards } from '@/components/latest-cards';
import { ObservationList } from '@/components/observation-list';
import { PriceChart } from '@/components/price-chart';
import { SharedNav } from '@/components/shared-nav';
import { StatusStrip } from '@/components/status-strip';
import { loadDashboardData } from '@/lib/data';
import { baseFilteredRows, filteredRows, formatCount, latestRepresentativeCards, normalizeFilters } from '@/lib/market';
import type { DashboardData, DashboardFilters } from '@/types';

const initialFilters: DashboardFilters = {
  kind: 'spot',
  product: 'representative',
  source: 'all',
  category: 'all',
  metric: 'auto',
  limit: '5',
};

export function App() {
  const [data, setData] = useState<DashboardData | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [filters, setFilters] = useState(initialFilters);

  useEffect(() => {
    let active = true;
    loadDashboardData().then((payload) => { if (active) setData(payload); }).catch((reason: unknown) => { if (active) setError(reason instanceof Error ? reason.message : String(reason)); });
    return () => { active = false; };
  }, []);

  const baseRows = useMemo(() => data ? baseFilteredRows(data.observations, filters) : [], [data, filters]);
  const rows = useMemo(() => data ? filteredRows(data.observations, data.series, filters) : [], [data, filters]);
  const cards = useMemo(() => data ? latestRepresentativeCards(data.observations, data.series, 6) : [], [data]);

  function updateFilters(patch: Partial<DashboardFilters>) {
    setFilters((current) => {
      const next = { ...current, ...patch };
      return data ? normalizeFilters(data.observations, data.series, next) : next;
    });
  }

  if (error) {
    return <><SharedNav /><main className="load-state" id="top"><AlertTriangle aria-hidden="true" /><h1>데이터를 표시하지 못했습니다</h1><p>{error}</p><div className="load-state__actions"><Button variant="primary" onClick={() => window.location.reload()}>다시 불러오기</Button><a href="data/status.json">수집 상태 JSON 확인<ArrowUpRight aria-hidden="true" /></a></div></main></>;
  }
  if (!data) {
    return <><SharedNav /><main className="load-state" id="top" aria-live="polite"><LoaderCircle className="is-spinning" aria-hidden="true" /><h1>DRAM 가격을 불러오는 중</h1><p>저장된 공개 관측치와 수집 상태를 확인하고 있습니다.</p></main></>;
  }

  const dateValues = rows.map((row) => row.date).filter((date): date is string => Boolean(date)).sort();
  const startDate = dateValues[0];
  const endDate = dateValues.at(-1);
  const dataAsOf = data.observations.map((row) => row.date).filter((date): date is string => /^\d{4}-\d{2}-\d{2}$/.test(date ?? '')).sort().at(-1);

  return (
    <div id="top">
      <SharedNav />
      <header className="page-header">
        <div><p className="eyebrow">DRAM Price Lab</p><h1>DRAM 가격</h1><p>현물가를 먼저 보고, 제품별 흐름과 상세 관측치를 차례로 확인합니다.</p></div>
        <a className="hub-link" href="https://sonchanggi.github.io/quant-dashboard/">통합 허브<ArrowUpRight aria-hidden="true" /></a>
      </header>
      <main className="dashboard-shell">
        <StatusStrip status={data.status} automation={data.automation} dataAsOf={dataAsOf} />
        <LatestCards rows={cards} />
        <section className="panel chart-panel" aria-labelledby="chart-heading">
          <div className="section-heading"><div><p className="eyebrow">Price trend</p><h2 id="chart-heading">제품별 가격 추이</h2></div><p>{startDate && endDate ? `${startDate}–${endDate}` : '기간 없음'} · {formatCount(rows.length)}개 관측치</p></div>
          <FilterControls filters={filters} onChange={updateFilters} baseRows={baseRows} allRows={data.observations} series={data.series} />
          <PriceChart rows={rows} metric={filters.metric} />
        </section>
        <ObservationList key={`${filters.kind}|${filters.product}|${filters.source}|${filters.category}|${filters.metric}`} rows={rows} metric={filters.metric} />
        <DataDetails status={data.status} automation={data.automation} />
      </main>
      <footer className="page-footer"><span>DRAM Price Lab · 개인 리서치용 공개 데이터 모니터</span><a href="#top">맨 위로</a></footer>
    </div>
  );
}
