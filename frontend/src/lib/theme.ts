export const THEME_KEY = 'quant-research-theme';
export const LEGACY_THEME_KEYS = ['quant-calm-theme', 'quant-dashboard-theme', 'dram-price-theme'] as const;
export type Theme = 'light' | 'dark';

export function themeFromSearch(search: string): Theme | null {
  const requested = new URLSearchParams(search).get('theme');
  return requested === 'light' || requested === 'dark' ? requested : null;
}

export function migrateStoredTheme(storage: Storage): Theme | null {
  const current = storage.getItem(THEME_KEY);
  const legacy = LEGACY_THEME_KEYS.map((key) => storage.getItem(key)).find((value) => value === 'light' || value === 'dark');
  const theme = current === 'light' || current === 'dark' ? current : legacy ?? null;
  if (theme && current !== theme) storage.setItem(THEME_KEY, theme);
  LEGACY_THEME_KEYS.forEach((key) => storage.removeItem(key));
  return theme;
}
