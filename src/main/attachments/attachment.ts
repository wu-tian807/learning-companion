import type { AssetAttachment } from '../../shared/workbench/attachment';
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

export function createAssetAttachment(
  input: AssetAttachment,
): AssetAttachment {
  if (!Number.isSafeInteger(input.typeVersion) || input.typeVersion <= 0) {
    throw new Error('AssetAttachment typeVersion 必须是正整数');
  }

  if (!isJsonValue(input.payload)) {
    throw new Error('AssetAttachment payload 必须是 JSON 值');
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
    payload: input.payload,
    target: input.target,
    createdTime: requireTimestamp(input.createdTime, 'createdTime'),
    updatedTime: requireTimestamp(input.updatedTime, 'updatedTime'),
  });
}

export function cloneAssetAttachment(
  attachment: AssetAttachment,
): AssetAttachment {
  return createAssetAttachment(attachment);
}
