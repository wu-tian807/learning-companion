import {
  isPortableWorkspaceRelativePath,
} from '../../shared/assets';
import { isUnixMilliseconds } from '../../shared/projects';

export interface AssetArtifactKey {
  readonly assetId: string;
  readonly producerId: string;
  readonly artifactKey: string;
}

export interface AssetArtifact extends AssetArtifactKey {
  readonly relativePath: string;
  readonly mediaType: string;
  readonly sourceRevision: string;
  readonly producerVersion: string;
  readonly artifactRevision: string;
  readonly updatedTime: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isRequiredText(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isMediaType(value: unknown): value is string {
  return (
    isRequiredText(value) &&
    /^[^\s/]+\/[^\s/]+$/u.test(value.trim())
  );
}

export function isAssetArtifactKey(
  value: unknown,
): value is AssetArtifactKey {
  return (
    isRecord(value) &&
    isRequiredText(value.assetId) &&
    isRequiredText(value.producerId) &&
    isRequiredText(value.artifactKey)
  );
}

export function isAssetArtifact(value: unknown): value is AssetArtifact {
  return (
    isAssetArtifactKey(value) &&
    isRecord(value) &&
    isPortableWorkspaceRelativePath(value.relativePath) &&
    isMediaType(value.mediaType) &&
    isRequiredText(value.sourceRevision) &&
    isRequiredText(value.producerVersion) &&
    isRequiredText(value.artifactRevision) &&
    isUnixMilliseconds(value.updatedTime)
  );
}

export function cloneAssetArtifactKey(
  key: AssetArtifactKey,
): AssetArtifactKey {
  if (!isAssetArtifactKey(key)) {
    throw new Error('AssetArtifactKey 数据无效');
  }

  return Object.freeze({
    assetId: key.assetId.trim(),
    producerId: key.producerId.trim(),
    artifactKey: key.artifactKey.trim(),
  });
}

export function cloneAssetArtifact(
  artifact: AssetArtifact,
): AssetArtifact {
  if (!isAssetArtifact(artifact)) {
    throw new Error('AssetArtifact 数据无效');
  }

  return Object.freeze({
    ...cloneAssetArtifactKey(artifact),
    relativePath: artifact.relativePath.trim(),
    mediaType: artifact.mediaType.trim(),
    sourceRevision: artifact.sourceRevision.trim(),
    producerVersion: artifact.producerVersion.trim(),
    artifactRevision: artifact.artifactRevision.trim(),
    updatedTime: artifact.updatedTime,
  });
}
