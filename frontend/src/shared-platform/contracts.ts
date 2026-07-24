export type ControlKind =
  | 'display'
  | 'result_selector'
  | 'analysis'
  | 'operation';

export type JsonValue =
  | string
  | number
  | boolean
  | null
  | JsonValue[]
  | { [key: string]: JsonValue };

interface ControlBase {
  id: string;
  label: string;
  valueType: 'string' | 'number' | 'boolean' | 'string-array';
  defaultValue: JsonValue;
  defaultSource: 'html-constant' | 'current-result' | 'saved-setting';
  unit?: string;
  minimum?: number;
  maximum?: number;
  step?: number;
  options?: ReadonlyArray<{ value: string; label: string }>;
}

export interface DisplayControlDefinition extends ControlBase {
  controlKind: 'display';
}

export interface ResultSelectorControlDefinition extends ControlBase {
  controlKind: 'result_selector';
  resultIdentityKey: string;
}

export interface AnalysisControlDefinition extends ControlBase {
  controlKind: 'analysis';
  transportKey: string;
  pythonParameter: string;
  noOpCondition?: string;
  resultEvidencePath: string;
}

export interface OperationControlDefinition extends ControlBase {
  controlKind: 'operation';
  operationKey: string;
  requiresAuthentication: true;
}

export type ControlDefinition =
  | DisplayControlDefinition
  | ResultSelectorControlDefinition
  | AnalysisControlDefinition
  | OperationControlDefinition;

/**
 * Vendored compatibility surface for @quant-research/contracts 0.1.
 *
 * This repository intentionally keeps no workspace/file dependency on the Hub
 * repository. The pinned snapshot and verification script are documented in
 * docs/shared-frontend-integration.md.
 */
export interface ControlManifest {
  schemaVersion: 1;
  projectId: string;
  inputSchemaVersion: string;
  inputSchemaHash?: string;
  configHashAlgorithm: string;
  controls: readonly ControlDefinition[];
}

export function assertStaticDisplayOnlyManifest(
  manifest: ControlManifest,
): void {
  if (manifest.schemaVersion !== 1 || manifest.projectId !== 'dram') {
    throw new Error('DRAM control manifest identity is invalid.');
  }
  if (!/^[a-z][a-z0-9-]*\/v[1-9][0-9]*$/.test(manifest.inputSchemaVersion)) {
    throw new Error('DRAM control manifest version is invalid.');
  }

  const ids = new Set<string>();
  for (const control of manifest.controls) {
    if (!/^[a-z][a-z0-9_]*$/.test(control.id) || ids.has(control.id)) {
      throw new Error(`DRAM control id is invalid or duplicated: ${control.id}`);
    }
    ids.add(control.id);
    if (
      control.controlKind !== 'display' &&
      control.controlKind !== 'result_selector'
    ) {
      throw new Error(
        `DRAM cannot expose ${control.controlKind} control ${control.id}.`,
      );
    }
  }
}
