import {
  createProjectWorkspaceContentRef,
  PROJECT_WORKSPACE_CONTENT_BASE,
} from '../../shared/assets';
import type {
  AssetAttachment,
  AssetAttachmentContent,
} from '../../shared/workbench/attachment';
import { isAssetAttachmentTarget } from '../../shared/workbench/anchor';
import { isJsonValue } from '../../shared/workbench/protocol';
import { isUnixMilliseconds } from '../../shared/projects';

function requireText(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`AssetAttachment ${field} 不能为空`);
  }

  return normalized;
}

function requireTimestamp(value: number, field: string): number {
  if (!isUnixMilliseconds(value)) {
    throw new Error(`AssetAttachment ${field} 必须是 Unix 毫秒时间戳`);
  }

  return value;
}

function createAttachmentContent(
  content: AssetAttachmentContent | undefined,
): AssetAttachmentContent | undefined {
  if (content === undefined) {
    return undefined;
  }

  if (content.ref.base !== PROJECT_WORKSPACE_CONTENT_BASE) {
    throw new Error(
      'AssetAttachment content 必须引用 Project Workspace 文件',
    );
  }

  return Object.freeze({
    ref: createProjectWorkspaceContentRef(content.ref.path),
    mediaType: requireText(content.mediaType, 'content.mediaType'),
  });
}

export function createAssetAttachment(
  input: AssetAttachment,
): AssetAttachment {
  if (!Number.isSafeInteger(input.typeVersion) || input.typeVersion <= 0) {
    throw new Error('AssetAttachment typeVersion 必须是正整数');
  }

  if (!isJsonValue(input.metadata)) {
    throw new Error('AssetAttachment metadata 必须是 JSON 值');
  }

  if (!isAssetAttachmentTarget(input.target)) {
    throw new Error('AssetAttachment target 无效');
  }

  return Object.freeze({
    id: requireText(input.id, 'id'),
    projectId: requireText(input.projectId, 'projectId'),
    assetId: requireText(input.assetId, 'assetId'),
    typeId: requireText(input.typeId, 'typeId'),
    typeVersion: input.typeVersion,
    target: input.target,
    metadata: input.metadata,
    content: createAttachmentContent(input.content),
    createdTime: requireTimestamp(input.createdTime, 'createdTime'),
    updatedTime: requireTimestamp(input.updatedTime, 'updatedTime'),
  });
}

export function cloneAssetAttachment(
  attachment: AssetAttachment,
): AssetAttachment {
  return createAssetAttachment(attachment);
}
