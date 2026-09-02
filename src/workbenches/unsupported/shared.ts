import {
  WORKBENCH_PROTOCOL_VERSION,
  type AssetWorkbenchManifest,
} from '../../shared/workbench/manifest';
import type { JsonValue } from '../../shared/workbench/protocol';

export const UNSUPPORTED_WORKBENCH_ID = 'builtin.unsupported';

export const unsupportedWorkbenchManifest: AssetWorkbenchManifest<
  typeof UNSUPPORTED_WORKBENCH_ID
> = {
  id: UNSUPPORTED_WORKBENCH_ID,
  version: 1,
  protocolVersion: WORKBENCH_PROTOCOL_VERSION,
  supportedMediaTypes: ['*/*'],
  requiredContentCapabilities: [],
  supportedTargetTypes: [],
  facilities: [],
};

export type UnsupportedWorkbenchReason =
  | 'unsupported-media'
  | 'missing-capability'
  | 'content-unavailable';

export interface UnsupportedWorkbenchPayload {
  readonly reason: UnsupportedWorkbenchReason;
}

export function createUnsupportedWorkbenchPayload(
  reason: UnsupportedWorkbenchReason,
): JsonValue {
  return { reason };
}

export function isUnsupportedWorkbenchPayload(
  value: JsonValue,
): value is JsonValue & UnsupportedWorkbenchPayload {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { readonly [key: string]: JsonValue };

  return (
    candidate.reason === 'unsupported-media' ||
    candidate.reason === 'missing-capability' ||
    candidate.reason === 'content-unavailable'
  );
}
