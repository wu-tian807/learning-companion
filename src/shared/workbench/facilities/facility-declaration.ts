import type { JsonValue } from '../protocol';

export interface WorkbenchFacilityDeclaration {
  readonly id: string;
  readonly version: number;
  readonly options?: JsonValue;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isWorkbenchFacilityId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^[a-z0-9]+(?:[.-][a-z0-9]+)+$/.test(value)
  );
}

export function isWorkbenchFacilityDeclaration(
  value: unknown,
): value is WorkbenchFacilityDeclaration {
  if (!isRecord(value)) {
    return false;
  }

  return (
    isWorkbenchFacilityId(value.id) &&
    Number.isSafeInteger(value.version) &&
    Number(value.version) > 0 &&
    (value.options === undefined || isJsonValue(value.options))
  );
}

export function workbenchFacilityKey(
  id: string,
  version: number,
): string {
  return `${id}@${version}`;
}

function isJsonValue(value: unknown): value is JsonValue {
  if (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'boolean'
  ) {
    return true;
  }

  if (typeof value === 'number') {
    return Number.isFinite(value);
  }

  if (Array.isArray(value)) {
    return value.every(isJsonValue);
  }

  return (
    isRecord(value) &&
    Object.values(value).every((entry) => isJsonValue(entry))
  );
}
