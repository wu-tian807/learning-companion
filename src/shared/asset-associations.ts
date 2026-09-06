import { isUnixMilliseconds } from './projects';
import {
  cloneAssetTarget,
  isAssetTarget,
  type AssetTarget,
} from './workbench/asset-target';

export interface AssetReference {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly sourceAssetId: string;
  readonly createdTime: number;
}

export interface CreateAssetReferenceInput {
  readonly sourceAssetId: string;
}

/** A source AssetReference used at a concrete content location. */
export interface AssetReferenceTarget {
  readonly referenceId: string;
  readonly contentRevision: string;
  readonly target: AssetTarget;
}

export interface AssetLink {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly targetAssetId: string;
  readonly createdTime: number;
}

export interface CreateAssetLinkInput {
  readonly targetAssetId: string;
}

/** A related AssetLink used at a concrete content location. */
export interface AssetLinkTarget {
  readonly linkId: string;
  readonly contentRevision: string;
  readonly target: AssetTarget;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function hasExactlyKeys(
  value: Readonly<Record<string, unknown>>,
  keys: readonly string[],
): boolean {
  const actual = Object.keys(value);
  return actual.length === keys.length &&
    keys.every((key) => Object.hasOwn(value, key));
}

function isAssetTargetBinding(
  value: unknown,
  idKey: 'referenceId' | 'linkId',
): value is Record<string, unknown> {
  return (
    isRecord(value) &&
    hasExactlyKeys(value, [idKey, 'contentRevision', 'target']) &&
    isRequiredText(value[idKey]) &&
    isRequiredText(value.contentRevision) &&
    isAssetTarget(value.target)
  );
}

export function isAssetReferenceTarget(
  value: unknown,
): value is AssetReferenceTarget {
  return isAssetTargetBinding(value, 'referenceId');
}

export function cloneAssetReferenceTarget(
  value: AssetReferenceTarget,
): AssetReferenceTarget {
  if (!isAssetReferenceTarget(value)) {
    throw new Error('AssetReferenceTarget 数据无效');
  }
  return Object.freeze({
    referenceId: value.referenceId.trim(),
    contentRevision: value.contentRevision.trim(),
    target: cloneAssetTarget(value.target),
  });
}

export function isAssetLinkTarget(value: unknown): value is AssetLinkTarget {
  return isAssetTargetBinding(value, 'linkId');
}

export function cloneAssetLinkTarget(
  value: AssetLinkTarget,
): AssetLinkTarget {
  if (!isAssetLinkTarget(value)) {
    throw new Error('AssetLinkTarget 数据无效');
  }
  return Object.freeze({
    linkId: value.linkId.trim(),
    contentRevision: value.contentRevision.trim(),
    target: cloneAssetTarget(value.target),
  });
}

export function isCreateAssetReferenceInput(
  value: unknown,
): value is CreateAssetReferenceInput {
  return isRecord(value) && isRequiredText(value.sourceAssetId);
}

export function isAssetReference(value: unknown): value is AssetReference {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.projectId) &&
    isRequiredText(value.assetId) &&
    isCreateAssetReferenceInput(value) &&
    value.assetId.trim() !== value.sourceAssetId.trim() &&
    isUnixMilliseconds(value.createdTime)
  );
}

export function isCreateAssetLinkInput(
  value: unknown,
): value is CreateAssetLinkInput {
  return isRecord(value) && isRequiredText(value.targetAssetId);
}

export function isAssetLink(value: unknown): value is AssetLink {
  return (
    isRecord(value) &&
    isRequiredText(value.id) &&
    isRequiredText(value.projectId) &&
    isRequiredText(value.assetId) &&
    isCreateAssetLinkInput(value) &&
    value.assetId.trim() !== value.targetAssetId.trim() &&
    isUnixMilliseconds(value.createdTime)
  );
}

export function cloneCreateAssetReferenceInput(
  input: CreateAssetReferenceInput,
): CreateAssetReferenceInput {
  if (!isCreateAssetReferenceInput(input)) {
    throw new Error('CreateAssetReferenceInput 数据无效');
  }

  return Object.freeze({
    sourceAssetId: input.sourceAssetId.trim(),
  });
}

export function cloneAssetReference(
  reference: AssetReference,
): AssetReference {
  if (!isAssetReference(reference)) {
    throw new Error('AssetReference 数据无效');
  }

  return Object.freeze({
    id: reference.id.trim(),
    projectId: reference.projectId.trim(),
    assetId: reference.assetId.trim(),
    ...cloneCreateAssetReferenceInput(reference),
    createdTime: reference.createdTime,
  });
}

export function cloneCreateAssetLinkInput(
  input: CreateAssetLinkInput,
): CreateAssetLinkInput {
  if (!isCreateAssetLinkInput(input)) {
    throw new Error('CreateAssetLinkInput 数据无效');
  }

  return Object.freeze({
    targetAssetId: input.targetAssetId.trim(),
  });
}

export function cloneAssetLink(link: AssetLink): AssetLink {
  if (!isAssetLink(link)) {
    throw new Error('AssetLink 数据无效');
  }

  return Object.freeze({
    id: link.id.trim(),
    projectId: link.projectId.trim(),
    assetId: link.assetId.trim(),
    ...cloneCreateAssetLinkInput(link),
    createdTime: link.createdTime,
  });
}
