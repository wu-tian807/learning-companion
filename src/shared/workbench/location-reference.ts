import {
  cloneAssetTarget,
  isAssetTarget,
  type AssetTarget,
} from './asset-target';

export const WORKBENCH_LOCATION_REFERENCE_V2_PREFIX =
  '#learning-companion-location-v2=';
const MAX_HREF_LENGTH = 100_000;

/**
 * A portable document link.  This is deliberately independent from an
 * Attachment and conversation context: it means "show this source location".
 */
export interface WorkbenchLocationReference {
  readonly version: 2;
  readonly projectId: string;
  readonly assetId: string;
  readonly target: AssetTarget;
  /** Required exactly for a content position, absent for an Asset-level link. */
  readonly sourceRevision?: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isText(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0 && value === value.trim();
}

export function isWorkbenchLocationReference(
  value: unknown,
): value is WorkbenchLocationReference {
  if (!isRecord(value) || value.version !== 2 || !isText(value.projectId) ||
    !isText(value.assetId) || !isAssetTarget(value.target)) {
    return false;
  }
  if (value.target.scope === 'content') return isText(value.sourceRevision);
  return value.sourceRevision === undefined;
}

export function cloneWorkbenchLocationReference(
  reference: WorkbenchLocationReference,
): WorkbenchLocationReference {
  if (!isWorkbenchLocationReference(reference)) {
    throw new Error('Workbench 位置引用无效');
  }
  return Object.freeze({
    version: 2,
    projectId: reference.projectId,
    assetId: reference.assetId,
    target: cloneAssetTarget(reference.target),
    ...(reference.sourceRevision
      ? { sourceRevision: reference.sourceRevision }
      : {}),
  });
}

function encode(value: string): string {
  return encodeURIComponent(value).replace(/[!'()*]/gu, (character) =>
    `%${character.charCodeAt(0).toString(16).toUpperCase()}`,
  );
}

export function createWorkbenchLocationHref(
  reference: WorkbenchLocationReference,
): string {
  return WORKBENCH_LOCATION_REFERENCE_V2_PREFIX + encode(
    JSON.stringify(cloneWorkbenchLocationReference(reference)),
  );
}

export function parseWorkbenchLocationHref(
  href: string,
): WorkbenchLocationReference | undefined {
  if (
    !href.startsWith(WORKBENCH_LOCATION_REFERENCE_V2_PREFIX) ||
    href.length > MAX_HREF_LENGTH
  ) return undefined;
  try {
    const value: unknown = JSON.parse(
      decodeURIComponent(href.slice(WORKBENCH_LOCATION_REFERENCE_V2_PREFIX.length)),
    );
    return isWorkbenchLocationReference(value)
      ? cloneWorkbenchLocationReference(value)
      : undefined;
  } catch {
    return undefined;
  }
}
