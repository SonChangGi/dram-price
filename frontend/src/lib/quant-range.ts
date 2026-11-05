/** Local preview adapter; observations stay in their native currency and price unit. */
export interface RangeConfig {
  id: string;
  element: HTMLElement;
  host: HTMLElement;
  kind: 'timeseries';
  domain: Array<{ key: string; label: string }>;
  series: Array<{ id: string; label: string; color?: string; unit: string; measure: 'relative'; points: Array<{ key: string; value: number }> }>;
  hitSeries?(event: Event): string | null;
  currentIndex?(): number | null;
  onSeriesFocus?(id: string | null, context: { origin: string }): void;
  onSeriesRequest?(id: string, context: { mode: 'point' | 'range'; index?: number; origin: string }): void;
  locate(event: { clientX: number }): { index: number };
  project(selection: { start: { index: number }; end: { index: number } }): { left: number; top: number; width: number; height: number };
}
export interface RangeHandle {
  destroy(): void; clear(): void;
  selectSeries?(id: string, options?: { pointIndex?: number; origin?: string }): void;
  getSelection?(): { mode: 'point' | 'range' } | null;
}
declare global {
  interface Window {
    QuantRange?: { register(config: RangeConfig): RangeHandle };
  }
}

export function registerPriceRange(element: HTMLElement, id: string, unit: string,
  groups: Array<{ id: string; displayLabel: string; color?: string; points: Array<{ date: string; value: number }> }>,
  callbacks: Pick<RangeConfig, 'onSeriesFocus' | 'onSeriesRequest'> = {}) {
  const svg = element.querySelector('svg');
  const host = element.closest<HTMLElement>('.chart-facet');
  if (!window.QuantRange || !svg || !host || !groups.length) return;
  const dates = [...new Set(groups.flatMap(group => group.points.map(point => point.date)))].sort();
  const geometry = () => {
    const box = svg.getBoundingClientRect(), viewport = element.getBoundingClientRect();
    return { sx: box.width / 980, sy: box.height / 460, box, viewport };
  };
  const x = (index: number) => 64 + (dates.length === 1 ? 363 : index / (dates.length - 1) * 726);
  return window.QuantRange.register({
    id: `dram-${id}`, element, host, kind: 'timeseries',
    domain: dates.map(key => ({ key, label: key })),
    series: groups.map(group => ({ id: group.id, label: group.displayLabel, color: group.color, unit, measure: 'relative',
      points: group.points.map(point => ({ key: point.date, value: point.value })) })),
    ...callbacks,
    hitSeries(event) {
      return (event.target as Element | null)?.closest('[data-qr-series-id]')?.getAttribute('data-qr-series-id') ?? null;
    },
    currentIndex() {
      const index = dates.indexOf(element.dataset.selectedDate || '');
      return index < 0 ? null : index;
    },
    locate(event) {
      const { sx, box } = geometry();
      const ratio = Math.max(0, Math.min(1, ((event.clientX - box.left) / (sx || 1) - 64) / 726));
      return { index: Math.round(ratio * (dates.length - 1)) };
    },
    project(selection) {
      const { sx, sy, box, viewport } = geometry();
      const a = x(selection.start.index), b = x(selection.end.index);
      const left = Math.max(0, box.left - viewport.left + Math.min(a, b) * sx);
      const right = Math.min(viewport.width, box.left - viewport.left + Math.max(a, b) * sx);
      return { left, top: box.top - viewport.top + 96 * sy, width: Math.max(0, right - left), height: 312 * sy };
    },
  });
}
