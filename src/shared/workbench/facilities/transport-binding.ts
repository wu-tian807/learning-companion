import { isJsonValue, type JsonValue } from '../protocol';
import {
  isWorkbenchFacilityId,
  workbenchFacilityKey,
} from './facility-declaration';

export interface WorkbenchTransportFacilityRef {
  readonly id: string;
  readonly version: number;
}

export interface WorkbenchTransportBinding {
  readonly transportId: string;
  readonly transportVersion: number;
  readonly facilities: readonly WorkbenchTransportFacilityRef[];
  readonly payload: JsonValue;
}

export const WORKBENCH_TRANSPORT_BINDING_FACILITY_MAX_SIZE = 64;
export const WORKBENCH_TRANSPORT_BINDING_MAX_SIZE = 64;

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function isPositiveSafeInteger(value: unknown): value is number {
  return Number.isSafeInteger(value) && Number(value) > 0;
}

export function isWorkbenchTransportFacilityRef(
  value: unknown,
): value is WorkbenchTransportFacilityRef {
  return (
    isRecord(value) &&
    isWorkbenchFacilityId(value.id) &&
    isPositiveSafeInteger(value.version)
  );
}

export function isWorkbenchTransportBinding(
  value: unknown,
): value is WorkbenchTransportBinding {
  if (
    !isRecord(value) ||
    !isWorkbenchFacilityId(value.transportId) ||
    !isPositiveSafeInteger(value.transportVersion) ||
    !Array.isArray(value.facilities) ||
    value.facilities.length === 0 ||
    value.facilities.length >
      WORKBENCH_TRANSPORT_BINDING_FACILITY_MAX_SIZE ||
    !value.facilities.every(isWorkbenchTransportFacilityRef) ||
    !isJsonValue(value.payload)
  ) {
    return false;
  }

  return (
    new Set(
      value.facilities.map((facility) =>
        workbenchFacilityKey(facility.id, facility.version),
      ),
    ).size === value.facilities.length
  );
}
