import {
  adaptDramStaticResultV1,
  type DramStaticRawPayloads,
} from '@/shared-platform';
import type { DashboardData } from '@/types';

type DataFile =
  | 'prices.json'
  | 'series.json'
  | 'status.json'
  | 'automation-health.json';

const requiredFiles = [
  'prices.json',
  'series.json',
  'status.json',
] as const satisfies readonly DataFile[];

function candidateBaseUrls(): string[] {
  const viteBase = import.meta.env.BASE_URL.endsWith('/')
    ? import.meta.env.BASE_URL
    : `${import.meta.env.BASE_URL}/`;
  const candidates = [
    new URL(`${viteBase.replace(/^\//, '')}data/`, window.location.origin + '/'),
    new URL('data/', document.baseURI),
    new URL('../data/', document.baseURI),
  ];
  return [
    ...new Set(
      candidates
        .filter((url) => url.origin === window.location.origin)
        .map((url) => url.toString()),
    ),
  ];
}

async function fetchJson(baseUrl: string, filename: DataFile): Promise<unknown> {
  const url = new URL(filename, baseUrl);
  if (url.origin !== window.location.origin) {
    throw new Error(`${filename} 경로가 same-origin이 아닙니다.`);
  }
  const response = await fetch(url, {
    cache: 'no-store',
    headers: { Accept: 'application/json' },
    method: 'GET',
  });
  if (!response.ok) throw new Error(`HTTP ${response.status}`);
  return response.json();
}

async function loadAtBase(baseUrl: string): Promise<DashboardData> {
  const [prices, series, status, automation] = await Promise.all([
    fetchJson(baseUrl, requiredFiles[0]),
    fetchJson(baseUrl, requiredFiles[1]),
    fetchJson(baseUrl, requiredFiles[2]),
    fetchJson(baseUrl, 'automation-health.json').catch(() => null),
  ]);
  const payloads: DramStaticRawPayloads = {
    prices,
    series,
    status,
    automation,
  };
  return adaptDramStaticResultV1(payloads).data;
}

/**
 * Loads a complete static snapshot from one data root. Required files from
 * different roots are never mixed.
 */
export async function loadDashboardData(): Promise<DashboardData> {
  const failures: string[] = [];
  for (const baseUrl of candidateBaseUrls()) {
    try {
      return await loadAtBase(baseUrl);
    } catch (error) {
      failures.push(
        `${baseUrl}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `DRAM 정적 snapshot을 불러오지 못했습니다. ${failures.join(' | ')}`,
  );
}

export function dataPathCandidates(filename: DataFile): string[] {
  return candidateBaseUrls().map((baseUrl) =>
    new URL(filename, baseUrl).toString(),
  );
}
