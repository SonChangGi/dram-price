import { describe, expect, it } from 'vitest';
import { formatNumber } from '@/lib/number';

describe('display precision', () => {
  it.each([
    [60.667, '60.67'], [81.679, '81.68'], [130, '130'], [1.2, '1.2'],
    [0.0001234, '0.00012'], [-0.0001234, '-0.00012'], [0, '0'], [-0, '0'],
  ])('formats %s without changing the observation value', (value, expected) => {
    expect(formatNumber(value as number)).toBe(expected);
  });
  it('uses the percentage display value for tiny values and replaces old precision', () => {
    expect(formatNumber(0.000123, { style: 'percent', minimumFractionDigits: 4 })).toBe('0.01%');
    expect(formatNumber(0.00000123, { style: 'percent', maximumFractionDigits: 0 })).toBe('0.00012%');
    expect(formatNumber(1, { minimumFractionDigits: 2, maximumSignificantDigits: 1 })).toBe('1');
  });
});
