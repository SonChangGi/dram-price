export const canonicalProjectRegistry = [
  {
    id: 'hub',
    label: 'Hub',
    url: 'https://sonchanggi.github.io/quant-dashboard/',
  },
  {
    id: 'fear-greed',
    label: 'Fear & Greed',
    url: 'https://sonchanggi.github.io/fearNgreed/',
  },
  {
    id: 'momentum',
    label: 'Momentum',
    url: 'https://sonchanggi.github.io/momentum-factor-lab/',
  },
  {
    id: 'dram',
    label: 'DRAM',
    url: 'https://sonchanggi.github.io/dram-price/',
  },
  {
    id: 'best-factor',
    label: 'Best Factor',
    url: 'https://sonchanggi.github.io/best-factor/',
  },
  {
    id: 'etf',
    label: 'ETF',
    url: 'https://sonchanggi.github.io/etf-tracking/',
  },
  {
    id: 'sox',
    label: 'SOX',
    url: 'https://sonchanggi.github.io/sox/',
  },
  {
    id: 'port',
    label: 'Port',
    url: 'https://sonchanggi.github.io/port/',
  },
] as const;

export type ProjectId = (typeof canonicalProjectRegistry)[number]['id'];

export function getCanonicalNavigation(currentId: ProjectId) {
  if (!canonicalProjectRegistry.some((project) => project.id === currentId)) {
    throw new RangeError(`Unknown project id: ${currentId}`);
  }
  return canonicalProjectRegistry.map((project) => ({
    ...project,
    current: project.id === currentId,
  }));
}
