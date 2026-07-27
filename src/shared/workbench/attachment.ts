import type { AssetAttachmentTarget } from './anchor';
import type { JsonValue } from './protocol';

export interface AssetAttachment {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly typeId: string;
  readonly typeVersion: number;
  readonly payload: JsonValue;
  readonly target: AssetAttachmentTarget;
  readonly createdTime: number;
  readonly updatedTime: number;
}
