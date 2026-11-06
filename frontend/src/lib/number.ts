type NumberFormatter = { number(value: number, options?: Intl.NumberFormatOptions): string };

/** Shared presentation policy; observation values are never rounded in storage. */
export function formatNumber(value: number, options: Intl.NumberFormatOptions = {}): string {
  const shared = typeof window === 'undefined' ? undefined : (window as Window & { QuantFormat?: NumberFormatter }).QuantFormat;
  if (shared) return shared.number(value, options);
  if (!Number.isFinite(value)) return '—';
  const normalized = Object.is(value, -0) ? 0 : value;
  const display = Math.abs(normalized) * (options.style === 'percent' ? 100 : 1);
  const precision: Intl.NumberFormatOptions = display > 0 && display < 0.01
    ? { minimumSignificantDigits: 1, maximumSignificantDigits: 2 }
    : { minimumFractionDigits: 0, maximumFractionDigits: 2 };
  const clean = { ...options };
  delete clean.minimumFractionDigits;
  delete clean.maximumFractionDigits;
  delete clean.minimumSignificantDigits;
  delete clean.maximumSignificantDigits;
  return new Intl.NumberFormat('ko-KR', { ...clean, ...precision }).format(normalized);
}
