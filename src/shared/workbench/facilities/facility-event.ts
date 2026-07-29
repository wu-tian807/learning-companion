import { isJsonValue, type JsonValue } from '../protocol';
import { isWorkbenchFacilityId } from './facility-declaration';
import type { WorkbenchFacilityDefinitionRegistry } from './facility-definition-registry';

export interface WorkbenchFacilityEvent {
  readonly sessionId: string;
  readonly facilityId: string;
  readonly facilityVersion: number;
  readonly payload: JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

export function isWorkbenchFacilityEvent(
  value: unknown,
): value is WorkbenchFacilityEvent {
  return (
    isRecord(value) &&
    typeof value.sessionId === 'string' &&
    value.sessionId.trim().length > 0 &&
    isWorkbenchFacilityId(value.facilityId) &&
    Number.isSafeInteger(value.facilityVersion) &&
    Number(value.facilityVersion) > 0 &&
    isJsonValue(value.payload)
  );
}

export function isKnownWorkbenchFacilityEvent(
  value: unknown,
  registry: WorkbenchFacilityDefinitionRegistry,
): value is WorkbenchFacilityEvent {
  return (
    isWorkbenchFacilityEvent(value) &&
    registry.validateEvent(
      value.facilityId,
      value.facilityVersion,
      value.payload,
    )
  );
}
