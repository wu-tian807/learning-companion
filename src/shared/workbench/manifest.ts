import {
  isWorkbenchFacilityDeclaration,
  workbenchFacilityKey,
  type WorkbenchFacilityDeclaration,
} from './facilities/facility-declaration';

export const WORKBENCH_PROTOCOL_VERSION = 2;

export const contentCapabilities = [
  'read-bytes',
  'read-stream',
  'write-bytes',
  'watch',
] as const;

export type ContentCapability = (typeof contentCapabilities)[number];

export interface AssetWorkbenchManifest<
  TId extends string = string,
> {
  readonly id: TId;
  readonly version: number;
  readonly protocolVersion: number;
  readonly selectionPriority?: number;
  readonly supportedMediaTypes: readonly string[];
  readonly requiredContentCapabilities: readonly ContentCapability[];
  readonly supportedTargetTypes: readonly string[];
  readonly facilities: readonly WorkbenchFacilityDeclaration[];
}

function haveSameStringValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value) => right.includes(value))
  );
}

function areJsonValuesEqual(
  left: unknown,
  right: unknown,
): boolean {
  if (Object.is(left, right)) {
    return true;
  }

  if (Array.isArray(left) || Array.isArray(right)) {
    return (
      Array.isArray(left) &&
      Array.isArray(right) &&
      left.length === right.length &&
      left.every((value, index) =>
        areJsonValuesEqual(value, right[index]),
      )
    );
  }

  if (
    typeof left !== 'object' ||
    left === null ||
    typeof right !== 'object' ||
    right === null
  ) {
    return false;
  }

  const leftEntries = Object.entries(left);
  const rightRecord = right as Record<string, unknown>;

  return (
    leftEntries.length === Object.keys(rightRecord).length &&
    leftEntries.every(
      ([key, value]) =>
        Object.hasOwn(rightRecord, key) &&
        areJsonValuesEqual(value, rightRecord[key]),
    )
  );
}

export function areAssetWorkbenchManifestsEqual(
  left: AssetWorkbenchManifest,
  right: AssetWorkbenchManifest,
): boolean {
  if (
    left.id !== right.id ||
    left.version !== right.version ||
    left.protocolVersion !== right.protocolVersion ||
    (left.selectionPriority ?? 0) !==
      (right.selectionPriority ?? 0) ||
    !haveSameStringValues(
      left.supportedMediaTypes,
      right.supportedMediaTypes,
    ) ||
    !haveSameStringValues(
      left.requiredContentCapabilities,
      right.requiredContentCapabilities,
    ) ||
    !haveSameStringValues(
      left.supportedTargetTypes,
      right.supportedTargetTypes,
    ) ||
    left.facilities.length !== right.facilities.length
  ) {
    return false;
  }

  const rightFacilities = new Map(
    right.facilities.map((facility) => [
      workbenchFacilityKey(facility.id, facility.version),
      facility,
    ]),
  );

  return left.facilities.every((facility) => {
    const other = rightFacilities.get(
      workbenchFacilityKey(facility.id, facility.version),
    );

    return (
      other !== undefined &&
      areJsonValuesEqual(facility.options, other.options)
    );
  });
}

function hasUniqueValues(values: readonly string[]): boolean {
  return new Set(values).size === values.length;
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMediaType(value: string): boolean {
  return value === '*/*' || /^[^\s/]+\/(?:[^\s/]+|\*)$/.test(value);
}

export function isAssetWorkbenchManifest(
  value: unknown,
): value is AssetWorkbenchManifest {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  const candidate = value as Partial<AssetWorkbenchManifest>;

  return (
    isRequiredText(candidate.id) &&
    Number.isSafeInteger(candidate.version) &&
    (candidate.version ?? 0) > 0 &&
    candidate.protocolVersion === WORKBENCH_PROTOCOL_VERSION &&
    (candidate.selectionPriority === undefined ||
      Number.isSafeInteger(candidate.selectionPriority)) &&
    Array.isArray(candidate.supportedMediaTypes) &&
    candidate.supportedMediaTypes.length > 0 &&
    candidate.supportedMediaTypes.every(
      (mediaType) =>
        typeof mediaType === 'string' && isMediaType(mediaType),
    ) &&
    hasUniqueValues(candidate.supportedMediaTypes) &&
    Array.isArray(candidate.requiredContentCapabilities) &&
    candidate.requiredContentCapabilities.every(
      (capability) =>
        typeof capability === 'string' &&
        contentCapabilities.includes(capability as ContentCapability),
    ) &&
    hasUniqueValues(candidate.requiredContentCapabilities) &&
    Array.isArray(candidate.supportedTargetTypes) &&
    candidate.supportedTargetTypes.every(isRequiredText) &&
    hasUniqueValues(candidate.supportedTargetTypes) &&
    Array.isArray(candidate.facilities) &&
    candidate.facilities.every(isWorkbenchFacilityDeclaration) &&
    hasUniqueValues(
      candidate.facilities.map((facility) =>
        workbenchFacilityKey(facility.id, facility.version),
      ),
    )
  );
}
