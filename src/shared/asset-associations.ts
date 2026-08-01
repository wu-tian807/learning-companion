import { isUnixMilliseconds } from './projects';

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

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
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
