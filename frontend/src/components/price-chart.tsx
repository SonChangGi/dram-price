import { useEffect, useId, useMemo, useRef, useState, type KeyboardEvent, type MouseEvent, type PointerEvent } from 'react';
import { formatDate, formatPrice, kindLabel, metricFor, sourceLabel } from '@/lib/market';
import type { Observation } from '@/types';
import { cn } from '@/lib/utils';

const WIDTH = 980;
const HEIGHT = 460;
const MAX_SERIES = 5;
const MARGIN = { top: 96, right: 190, bottom: 52, left: 64 };
const PALETTE = ['#3182f6', '#008f7a', '#c56b12', '#7c5ce7', '#0891b2'];
const DASHES = ['', '8 4', '3 4', '10 3 2 3', '2 3'];
const FALLBACK_COLOR = '#3182f6';

interface ChartGroup {
  id: string;
  label: string;
  displayLabel: string;
  source: string;
  cadence: string;
  currency: string;
  points: Array<{ date: string; value: number }>;
}

interface FacetDefinition {
  id: string;
  kind: string;
  currency: string;
  metricKey: string;
  metricLabel: string;
  rows: Observation[];
}

function allGroups(rows: Observation[], metricKey: string): ChartGroup[] {
  const groups = new Map<string, Omit<ChartGroup, 'displayLabel' | 'points'> & { pointsByDate: Map<string, number> }>();
  rows.forEach((row) => {
    const point = metricFor(row, metricKey);
    if (!point || !row.date) return;
    const id = `${row.source}|${row.kind}|${row.product_id}|${row.cadence}`;
    const group = groups.get(id) ?? {
      id,
      label: row.product_name,
      source: row.source,
      cadence: row.cadence ?? '',
      currency: row.currency ?? '',
      pointsByDate: new Map<string, number>(),
    };
    group.pointsByDate.set(row.date, point.value);
    groups.set(id, group);
  });
  const normalized = [...groups.values()].map(({ pointsByDate, ...group }) => ({
    ...group,
    displayLabel: group.label,
    points: [...pointsByDate.entries()].map(([date, value]) => ({ date, value })).sort((a, b) => a.date.localeCompare(b.date)),
  }));
  const duplicateLabels = new Map<string, number>();
  normalized.forEach((group) => duplicateLabels.set(group.label, (duplicateLabels.get(group.label) ?? 0) + 1));
  const cadenceLabel = (cadence: string) => ({ daily: '일간', weekly: '주간', monthly: '월간' })[cadence] ?? cadence;
  return normalized
    .map((group) => ({
      ...group,
      displayLabel: (duplicateLabels.get(group.label) ?? 0) > 1
        ? `${group.label} · ${sourceLabel(group.source)} · ${cadenceLabel(group.cadence)}`
        : group.label,
    }))
    .sort((a, b) => (b.points.at(-1)?.date ?? '').localeCompare(a.points.at(-1)?.date ?? '') || a.label.localeCompare(b.label));
}

function facetDefinitions(rows: Observation[], requestedMetric: string): FacetDefinition[] {
  const facets = new Map<string, FacetDefinition>();
  rows.forEach((row) => {
    const point = metricFor(row, requestedMetric);
    if (!point) return;
    const currency = row.currency || 'USD';
    const id = `${row.kind}|${currency}|${point.key}`;
    const facet = facets.get(id) ?? { id, kind: row.kind, currency, metricKey: point.key, metricLabel: point.label, rows: [] };
    facet.rows.push(row);
    facets.set(id, facet);
  });
  const kindOrder = ['spot', 'contract', 'spot_proxy'];
  return [...facets.values()].sort((a, b) => kindOrder.indexOf(a.kind) - kindOrder.indexOf(b.kind) || a.metricLabel.localeCompare(b.metricLabel));
}

function dateTicks(dates: string[], count = 5): string[] {
  if (dates.length <= count) return dates;
  const indexes = Array.from({ length: count }, (_, index) => Math.round((index * (dates.length - 1)) / (count - 1)));
  return [...new Set(indexes.map((index) => dates[index]).filter((date): date is string => Boolean(date)))];
}

function Marker({ shape, x, y, color }: { shape: number; x: number; y: number; color: string }) {
  if (shape % 3 === 1) return <rect x={x - 3} y={y - 3} width="6" height="6" fill="var(--chart-panel)" stroke={color} strokeWidth="2" />;
  if (shape % 3 === 2) return <path d={`M ${x} ${y - 4} L ${x + 4} ${y + 3} L ${x - 4} ${y + 3} Z`} fill="var(--chart-panel)" stroke={color} strokeWidth="2" />;
  return <circle cx={x} cy={y} r="3.5" fill="var(--chart-panel)" stroke={color} strokeWidth="2" />;
}

function pointAtDate(group: ChartGroup, date: string) {
  return group.points.find((point) => point.date === date) ?? null;
}

function nearestAvailableDate(candidates: string[], target: string, timeline: string[]) {
  if (!candidates.length) return target;
  if (candidates.includes(target)) return target;
  const targetIndex = Math.max(0, timeline.indexOf(target));
  return candidates.reduce((nearest, candidate) => {
    const candidateDistance = Math.abs(timeline.indexOf(candidate) - targetIndex);
    const nearestDistance = Math.abs(timeline.indexOf(nearest) - targetIndex);
    return candidateDistance < nearestDistance ? candidate : nearest;
  }, candidates[0]!);
}

function ChartFacet({ facet }: { facet: FacetDefinition }) {
  const titleId = useId();
  const descId = useId();
  const helpId = useId();
  const scrollRef = useRef<HTMLDivElement>(null);
  const [hovered, setHovered] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [hoveredDate, setHoveredDate] = useState<string | null>(null);
  const [selectedDate, setSelectedDate] = useState<string | null>(null);
  const completeGroups = useMemo(() => allGroups(facet.rows, facet.metricKey), [facet]);
  const trendGroups = completeGroups.filter((group) => group.points.length >= 2);
  const groups = trendGroups.slice(0, MAX_SERIES);
  const groupIdsKey = groups.map((group) => group.id).join('\u001f');
  const [selectionGroupIdsKey, setSelectionGroupIdsKey] = useState(groupIdsKey);
  if (selectionGroupIdsKey !== groupIdsKey) {
    setSelectionGroupIdsKey(groupIdsKey);
    setSelected(null);
    setHovered(null);
  }
  const selectedId = groups.some((group) => group.id === selected) ? selected : null;
  const hoveredId = groups.some((group) => group.id === hovered) ? hovered : null;
  const activeId = hoveredId ?? selectedId;
  const selectedGroup = groups.find((group) => group.id === selectedId) ?? null;
  const activeGroup = groups.find((group) => group.id === activeId) ?? null;
  const dates = [...new Set(groups.flatMap((group) => group.points.map((point) => point.date)))].sort();
  const values = groups.flatMap((group) => group.points.map((point) => point.value));
  const latestAvailableDate = dates.at(-1) ?? null;
  const persistentCandidate = selectedDate && dates.includes(selectedDate) ? selectedDate : latestAvailableDate;
  const selectedDates = selectedGroup?.points.map((point) => point.date) ?? dates;
  const persistentDateForScroll = persistentCandidate
    ? nearestAvailableDate(selectedDates, persistentCandidate, dates)
    : null;
  const persistentDateIndex = persistentDateForScroll ? dates.indexOf(persistentDateForScroll) : -1;

  useEffect(() => {
    const scroller = scrollRef.current;
    if (!scroller || persistentDateIndex < 0 || !dates.length) return;
    const ratio = dates.length === 1 ? 1 : persistentDateIndex / (dates.length - 1);
    const viewX = MARGIN.left + ratio * (WIDTH - MARGIN.left - MARGIN.right);
    const contentX = (viewX / WIDTH) * scroller.scrollWidth;
    const padding = Math.min(56, scroller.clientWidth * 0.16);
    if (contentX < scroller.scrollLeft + padding) scroller.scrollLeft = Math.max(0, contentX - padding);
    if (contentX > scroller.scrollLeft + scroller.clientWidth - padding) {
      scroller.scrollLeft = Math.min(scroller.scrollWidth - scroller.clientWidth, contentX - scroller.clientWidth + padding);
    }
  }, [dates.length, persistentDateForScroll, persistentDateIndex]);

  if (!groups.length || !dates.length || !values.length) {
    return (
      <figure className="chart-facet chart-facet--sparse">
        <figcaption><strong>{kindLabel(facet.kind)} · {facet.metricLabel}</strong><span>{facet.currency}</span></figcaption>
        <div className="empty-state">가격 추이를 그리려면 같은 제품에 날짜가 다른 관측치가 2개 이상 필요합니다.</div>
      </figure>
    );
  }

  const max = Math.max(...values, 1);
  const plotWidth = WIDTH - MARGIN.left - MARGIN.right;
  const plotHeight = HEIGHT - MARGIN.top - MARGIN.bottom;
  const x = (date: string) => MARGIN.left + (dates.length === 1 ? plotWidth / 2 : (dates.indexOf(date) / (dates.length - 1)) * plotWidth);
  const y = (value: number) => MARGIN.top + plotHeight - (value / (max * 1.08)) * plotHeight;
  const yTicks = Array.from({ length: 5 }, (_, index) => (max * 1.08 * index) / 4);
  const range = `${formatDate(dates[0])}–${formatDate(dates.at(-1))}`;
  const latestDate = latestAvailableDate!;
  const persistentDate = persistentDateForScroll ?? latestDate;
  const activeCandidateDate = hoveredDate && dates.includes(hoveredDate) ? hoveredDate : persistentDate;
  const activeDates = activeGroup?.points.map((point) => point.date) ?? dates;
  const activeDate = nearestAvailableDate(activeDates, activeCandidateDate, dates);
  const displayGroup = activeGroup ?? groups.find((group) => pointAtDate(group, activeDate)) ?? groups[0]!;
  const displayPoint = pointAtDate(displayGroup, activeDate);
  const displayGroupIndex = Math.max(0, groups.findIndex((group) => group.id === displayGroup.id));
  const displayColor = PALETTE[displayGroupIndex % PALETTE.length] ?? FALLBACK_COLOR;
  const activeDateX = x(activeDate);
  const chipX = Math.max(MARGIN.left + 45, Math.min(WIDTH - MARGIN.right - 45, activeDateX));
  const interactionText = `${formatDate(activeDate)} · ${displayGroup.displayLabel} · ${displayPoint ? formatPrice(displayPoint.value, facet.currency) : '관측 없음'}`;

  function toggleSelected(id: string) {
    const next = selected === id ? null : id;
    setSelected(next);
    const group = groups.find((candidate) => candidate.id === id);
    const latest = group?.points.at(-1);
    if (next && latest) setSelectedDate(latest.date);
  }

  function moveSelectedDate(event: KeyboardEvent<HTMLDivElement>) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const keyboardDates = activeGroup?.points.map((point) => point.date) ?? dates;
    const currentIndex = Math.max(0, keyboardDates.indexOf(activeDate));
    const nextIndex = event.key === 'Home'
      ? 0
      : event.key === 'End'
        ? keyboardDates.length - 1
        : Math.max(0, Math.min(keyboardDates.length - 1, currentIndex + (event.key === 'ArrowLeft' ? -1 : 1)));
    setHoveredDate(null);
    const nextDate = keyboardDates[nextIndex];
    if (nextDate) setSelectedDate(nextDate);
  }

  function dateFromClientX(clientX: number, bounds: DOMRect) {
    if (!bounds.width) return null;
    const viewX = ((clientX - bounds.left) / bounds.width) * WIDTH;
    const ratio = Math.max(0, Math.min(1, (viewX - MARGIN.left) / plotWidth));
    const selectableDates = activeGroup?.points.map((point) => point.date) ?? dates;
    if (!selectableDates.length) return null;
    const targetX = MARGIN.left + ratio * plotWidth;
    return selectableDates.reduce((nearest, candidate) => (
      Math.abs(x(candidate) - targetX) < Math.abs(x(nearest) - targetX) ? candidate : nearest
    ), selectableDates[0]!);
  }

  function exploreDate(event: PointerEvent<SVGSVGElement>) {
    if (event.pointerType && event.pointerType !== 'mouse' && event.pointerType !== 'pen') return;
    const date = dateFromClientX(event.clientX, event.currentTarget.getBoundingClientRect());
    if (date) setHoveredDate(date);
  }

  function pinDate(event: MouseEvent<SVGSVGElement>) {
    const date = dateFromClientX(event.clientX, event.currentTarget.getBoundingClientRect());
    if (!date) return;
    setSelectedDate(date);
    setHoveredDate(null);
  }

  function selectLatest() {
    setHoveredDate(null);
    setSelectedDate(latestDate);
    const scroller = scrollRef.current;
    if (scroller) scroller.scrollLeft = Math.max(0, scroller.scrollWidth - scroller.clientWidth);
  }

  return (
    <figure className="chart-facet">
      <figcaption>
        <div><strong>{kindLabel(facet.kind)} · {facet.metricLabel}</strong><span>{range} · {groups.length}/{trendGroups.length}개 시리즈 · {facet.currency}</span></div>
        <button type="button" className="chart-latest-button" onClick={selectLatest}>차트 최신일</button>
      </figcaption>
      <div className="chart-viewport">
        <div
          className="chart-scroll"
          ref={scrollRef}
          tabIndex={0}
          role="group"
          aria-roledescription="대화형 가격 차트"
          aria-label={`${kindLabel(facet.kind)} ${facet.metricLabel} 가격 차트 가로 스크롤 영역`}
          aria-describedby={helpId}
          aria-keyshortcuts="ArrowLeft ArrowRight Home End"
          data-selected-date={activeDate}
          onKeyDown={moveSelectedDate}
        >
          <svg
            viewBox={`0 0 ${WIDTH} ${HEIGHT}`}
            role="img"
            aria-labelledby={`${titleId} ${descId}`}
            onPointerMove={exploreDate}
            onPointerLeave={() => { setHoveredDate(null); setHovered(null); }}
            onClick={pinDate}
          >
            <title id={titleId}>{kindLabel(facet.kind)} {facet.metricLabel} 가격 추이</title>
            <desc id={descId}>{range} 동안의 {groups.length}개 제품 가격을 선으로 비교합니다. 통화는 {facet.currency}이며 세로축은 0에서 시작합니다. 선택일은 {formatDate(activeDate)}입니다.</desc>
            <g className="chart-grid" aria-hidden="true">
              {yTicks.map((tick) => {
                const position = y(tick);
                return <g key={tick}><line x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={position} y2={position} /><text x={MARGIN.left - 10} y={position + 4} textAnchor="end">{new Intl.NumberFormat('ko-KR', { maximumFractionDigits: 1 }).format(tick)}</text></g>;
              })}
              {dateTicks(dates).map((date) => <text key={date} x={x(date)} y={HEIGHT - 18} textAnchor="middle">{date.slice(5).replace('-', '.')}</text>)}
              <line className="chart-axis" x1={MARGIN.left} x2={MARGIN.left} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
              <line className="chart-axis" x1={MARGIN.left} x2={WIDTH - MARGIN.right} y1={HEIGHT - MARGIN.bottom} y2={HEIGHT - MARGIN.bottom} />
            </g>
            <g className="chart-selection-guide" aria-hidden="true" data-date={activeDate}>
              <line x1={activeDateX} x2={activeDateX} y1={MARGIN.top} y2={HEIGHT - MARGIN.bottom} />
              <g className="chart-date-chip" transform={`translate(${chipX} ${HEIGHT - MARGIN.bottom + 18})`}>
                <rect x="-44" y="-10" width="88" height="20" rx="5" />
                <text textAnchor="middle" y="4">{activeDate.slice(5).replace('-', '.')}</text>
              </g>
            </g>
            <g aria-label={`${kindLabel(facet.kind)} 제품 시리즈`}>
              {groups.map((group, index) => {
                const color = PALETTE[index % PALETTE.length] ?? FALLBACK_COLOR;
                const dash = DASHES[index % DASHES.length];
                const points = group.points.map((point) => `${x(point.date)},${y(point.value)}`).join(' ');
                const last = group.points.at(-1)!;
                const selectedPoint = pointAtDate(group, activeDate);
                const muted = activeId !== null && activeId !== group.id;
                const isActive = activeId === group.id;
                const isContext = activeId === null && displayGroup.id === group.id;
                return (
                  <g
                    key={group.id}
                    data-series-id={group.id}
                    aria-hidden="true"
                    className={cn('chart-series', isActive && 'is-active', isContext && 'is-context', muted && 'is-muted')}
                    onPointerEnter={() => setHovered(group.id)}
                    onPointerLeave={() => setHovered(null)}
                    onClick={() => toggleSelected(group.id)}
                  >
                    <polyline className="chart-hit-target" points={points} fill="none" stroke="transparent" strokeWidth="44" vectorEffect="non-scaling-stroke" />
                    <polyline className="chart-series-line" points={points} fill="none" stroke={color} strokeWidth={isActive ? 3.8 : isContext ? 2.8 : 2.2} strokeDasharray={dash} vectorEffect="non-scaling-stroke" />
                    {selectedPoint ? <g className={cn('chart-selected-point', isActive && 'is-active', isContext && 'is-context')} data-date={selectedPoint.date}><circle className="chart-selected-halo" cx={x(selectedPoint.date)} cy={y(selectedPoint.value)} r={isActive ? 9 : isContext ? 8 : 6} fill={color} /><Marker shape={index} x={x(selectedPoint.date)} y={y(selectedPoint.value)} color={color} /></g> : null}
                    {activeId === null || isActive ? <>
                      <line className="chart-end-connector" x1={x(last.date) + 7} x2={WIDTH - MARGIN.right + 13} y1={y(last.value)} y2={y(last.value)} stroke={color} strokeDasharray="2 3" />
                      <text className="chart-end-label" x={WIDTH - MARGIN.right + 18} y={y(last.value) + 4} fill={color}>{group.displayLabel.length > 22 ? `${group.displayLabel.slice(0, 21)}…` : group.displayLabel}</text>
                    </> : null}
                  </g>
                );
              })}
            </g>
            <text className="chart-unit" x={MARGIN.left} y={15}>{facet.currency} · 0 기준</text>
          </svg>
        </div>
        <div className={cn('chart-value-callout', activeId && 'is-active')} data-date={activeDate}>
          <div className="chart-value-callout__date"><span>차트 선택일</span><strong>{formatDate(activeDate)}</strong></div>
          <div className="chart-value-callout__series">
            <i style={{ backgroundColor: displayColor }} aria-hidden="true" />
            <span>{displayGroup.displayLabel}</span>
            <strong>{displayPoint ? formatPrice(displayPoint.value, facet.currency) : '관측 없음'}</strong>
          </div>
        </div>
      </div>
      <div className="chart-series-controls" role="group" aria-label={`${kindLabel(facet.kind)} 정확값을 확인할 시리즈 선택`}>
        {groups.map((group, index) => {
          const color = PALETTE[index % PALETTE.length] ?? FALLBACK_COLOR;
          return <button key={group.id} type="button" aria-pressed={selectedId === group.id} onClick={() => toggleSelected(group.id)} onFocus={() => setHovered(group.id)} onBlur={() => setHovered(null)}><svg viewBox="0 0 24 8" aria-hidden="true"><line x1="1" x2="23" y1="4" y2="4" stroke={color} strokeWidth="2" strokeDasharray={DASHES[index % DASHES.length]} /></svg><span>{group.displayLabel}</span></button>;
        })}
      </div>
      <div className="chart-date-controls">
        <label><span>고정 선택일</span><select aria-label={`${kindLabel(facet.kind)} 차트 고정 선택일`} value={persistentDate} onChange={(event) => { setHoveredDate(null); setSelectedDate(event.target.value); }}>{selectedDates.slice().reverse().map((date) => <option key={date} value={date}>{formatDate(date)}</option>)}</select></label>
        <span className="sr-only" id={helpId}>차트 위 이동 · 클릭으로 고정 · 키보드 ← → Home End</span>
        <span className="sr-only" aria-live="polite">{interactionText}</span>
      </div>
      <ul className="sr-only">{groups.map((group) => { const last = group.points.at(-1)!; return <li key={group.id}>{group.displayLabel}: {formatDate(last.date)} {formatPrice(last.value, group.currency)}</li>; })}</ul>
    </figure>
  );
}

export function PriceChart({ rows, metric }: { rows: Observation[]; metric: string }) {
  const facets = useMemo(() => facetDefinitions(rows, metric), [rows, metric]);
  return (
    <div className="chart-stack">
      {facets.map((facet) => <ChartFacet key={facet.id} facet={facet} />)}
      {!facets.length ? <div className="empty-state">선택 조건에서 표시할 유효 평균 가격이 없습니다.</div> : null}
    </div>
  );
}
