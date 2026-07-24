import type { DashboardFilters } from '@/types';
import {
  assertStaticDisplayOnlyManifest,
  type ControlManifest,
} from './contracts';

export const dramControlManifest = {
  schemaVersion: 1,
  projectId: 'dram',
  inputSchemaVersion: 'dram-display/v1',
  configHashAlgorithm: 'not-applicable-static-snapshot',
  controls: [
    {
      id: 'price_kind',
      label: '가격 종류',
      controlKind: 'display',
      valueType: 'string',
      defaultValue: 'spot',
      defaultSource: 'html-constant',
    },
    {
      id: 'product_scope',
      label: '제품',
      controlKind: 'display',
      valueType: 'string',
      defaultValue: 'representative',
      defaultSource: 'html-constant',
    },
    {
      id: 'data_source',
      label: '데이터 소스',
      controlKind: 'display',
      valueType: 'string',
      defaultValue: 'all',
      defaultSource: 'html-constant',
    },
    {
      id: 'category',
      label: '카테고리',
      controlKind: 'display',
      valueType: 'string',
      defaultValue: 'all',
      defaultSource: 'html-constant',
    },
    {
      id: 'chart_metric',
      label: '차트 지표',
      controlKind: 'display',
      valueType: 'string',
      defaultValue: 'auto',
      defaultSource: 'html-constant',
    },
    {
      id: 'chart_series_focus',
      label: '차트 강조 시리즈',
      controlKind: 'display',
      valueType: 'string',
      defaultValue: '',
      defaultSource: 'current-result',
    },
    {
      id: 'chart_observation_date',
      label: '차트 고정 선택일',
      controlKind: 'result_selector',
      valueType: 'string',
      defaultValue: '',
      defaultSource: 'current-result',
      resultIdentityKey: 'observation.date',
    },
    {
      id: 'observation_row_limit',
      label: '표시 관측치 수',
      controlKind: 'display',
      valueType: 'number',
      defaultValue: 10,
      defaultSource: 'html-constant',
      minimum: 10,
      maximum: 50,
      step: 40,
    },
    {
      id: 'theme',
      label: '화면 테마',
      controlKind: 'display',
      valueType: 'string',
      defaultValue: 'light',
      defaultSource: 'saved-setting',
      options: [
        { value: 'light', label: '라이트' },
        { value: 'dark', label: '다크' },
      ],
    },
  ],
} as const satisfies ControlManifest;

export const dashboardFilterControlIds = {
  kind: 'price_kind',
  product: 'product_scope',
  source: 'data_source',
  category: 'category',
  metric: 'chart_metric',
} as const satisfies Record<Exclude<keyof DashboardFilters, 'limit'>, string>;

const controlsById = new Map(
  dramControlManifest.controls.map((control) => [control.id, control]),
);

export function assertDisplayFilterPatch(
  patch: Partial<DashboardFilters>,
): void {
  for (const key of Object.keys(patch) as Array<keyof DashboardFilters>) {
    if (key === 'limit') {
      throw new Error('DRAM chart series limit is not a user control.');
    }
    const controlId = dashboardFilterControlIds[key];
    const control = controlsById.get(controlId);
    if (!control || control.controlKind !== 'display') {
      throw new Error(`DRAM filter ${key} is not registered as display-only.`);
    }
  }
}

assertStaticDisplayOnlyManifest(dramControlManifest);
