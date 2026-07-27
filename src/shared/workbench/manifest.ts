export const WORKBENCH_PROTOCOL_VERSION = 1;

export const contentCapabilities = [
  'read-text',
  'write-text',
  'read-bytes',
  'write-bytes',
  'watch',
] as const;

export type ContentCapability = (typeof contentCapabilities)[number];

export interface AssetWorkbenchManifest {
  readonly id: string;
  readonly version: number;
  readonly protocolVersion: number;
  readonly supportedMediaTypes: readonly string[];
  readonly requiredContentCapabilities: readonly ContentCapability[];
  readonly supportedAnchorTypes: readonly string[];
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
    Array.isArray(candidate.supportedAnchorTypes) &&
    candidate.supportedAnchorTypes.every(isRequiredText) &&
    hasUniqueValues(candidate.supportedAnchorTypes)
  );
}
