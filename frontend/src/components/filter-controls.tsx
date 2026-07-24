import * as Collapsible from '@radix-ui/react-collapsible';
import { ChevronDown, SlidersHorizontal } from 'lucide-react';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { METRIC_LABELS, categoryLabel, filteredRows, kindLabel, metricOptions, productOptions, sourceLabel, unique } from '@/lib/market';
import type { DashboardFilters, Observation, SeriesMeta } from '@/types';

function FilterSelect({ label, value, onChange, children }: { label: string; value: string; onChange: (value: string) => void; children: React.ReactNode }) {
  return (
    <label className="filter-field"><span>{label}</span><Select value={value} onValueChange={onChange}><SelectTrigger aria-label={label}><SelectValue /></SelectTrigger><SelectContent>{children}</SelectContent></Select></label>
  );
}

export function FilterControls({ filters, onChange, baseRows, allRows, series }: {
  filters: DashboardFilters;
  onChange: (patch: Partial<DashboardFilters>) => void;
  baseRows: Observation[];
  allRows: Observation[];
  series: SeriesMeta[];
}) {
  const products = productOptions(baseRows, series);
  const representativeAvailable = products.some((item) => item.representative);
  const sources = unique(allRows.map((row) => row.source));
  const sourceRows = filters.source === 'all' ? allRows : allRows.filter((row) => row.source === filters.source);
  const categories = unique(sourceRows.filter((row) => filters.kind === 'all' || row.kind === filters.kind).map((row) => row.category || 'uncategorized'));
  const metrics = metricOptions(filteredRows(allRows, series, filters));
  const kinds = unique(sourceRows.map((row) => row.kind));

  return (
    <div className="filter-shell" aria-label="가격 차트 필터">
      <div className="filter-primary">
        <FilterSelect label="가격 종류" value={filters.kind} onChange={(kind) => onChange({ kind, product: 'representative' })}>
          {['spot', 'contract', 'spot_proxy', 'all'].filter((kind) => kind === 'all' || kinds.includes(kind)).map((kind) => <SelectItem key={kind} value={kind}>{kindLabel(kind)}</SelectItem>)}
        </FilterSelect>
        <FilterSelect label="제품" value={filters.product === 'representative' && !representativeAvailable ? 'all' : filters.product} onChange={(product) => onChange({ product })}>
          {representativeAvailable ? <SelectItem value="representative">대표 제품</SelectItem> : null}
          <SelectItem value="all">전체 제품</SelectItem>
          {products.map((item) => <SelectItem key={item.product_id} value={item.product_id}>{item.representative ? '★ ' : ''}{item.product_name}</SelectItem>)}
        </FilterSelect>
      </div>
      <Collapsible.Root className="advanced-filters">
        <Collapsible.Trigger className="advanced-filters__trigger"><SlidersHorizontal aria-hidden="true" />세부 조건<ChevronDown aria-hidden="true" className="advanced-filters__chevron" /></Collapsible.Trigger>
        <Collapsible.Content className="advanced-filters__content">
          <FilterSelect label="데이터 소스" value={filters.source} onChange={(source) => onChange({ source, category: 'all', product: 'representative' })}>
            <SelectItem value="all">전체 소스</SelectItem>{sources.map((source) => <SelectItem key={source} value={source}>{sourceLabel(source)}</SelectItem>)}
          </FilterSelect>
          <FilterSelect label="카테고리" value={filters.category} onChange={(category) => onChange({ category, product: 'representative' })}>
            <SelectItem value="all">전체 카테고리</SelectItem>{categories.map((category) => <SelectItem key={category} value={category}>{categoryLabel(category)}</SelectItem>)}
          </FilterSelect>
          <FilterSelect label="차트 지표" value={filters.metric} onChange={(metric) => onChange({ metric })}>
            {metrics.map((metric) => <SelectItem key={metric} value={metric}>{METRIC_LABELS[metric] ?? metric}</SelectItem>)}
          </FilterSelect>
        </Collapsible.Content>
      </Collapsible.Root>
    </div>
  );
}
