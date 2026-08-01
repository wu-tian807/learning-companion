import type { ProjectWorkspaceLocalFileContentRef } from '../assets';
import type { AssetTarget } from './anchor';
import type { JsonValue } from './protocol';

export interface AssetAttachmentContent {
  readonly ref: ProjectWorkspaceLocalFileContentRef;
  readonly mediaType: string;
}

export interface AssetAttachment {
  readonly id: string;
  readonly projectId: string;
  readonly assetId: string;
  readonly typeId: string;
  readonly typeVersion: number;
  readonly target: AssetTarget;
  readonly metadata: JsonValue;
  readonly content?: AssetAttachmentContent;
  readonly createdTime: number;
  readonly updatedTime: number;
}
