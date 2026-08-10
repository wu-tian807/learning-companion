import { and, asc, eq } from 'drizzle-orm';

import type { AssetAttachment } from '../../shared/attachments/contracts';
import type { DatabaseContext } from '../database/database-context';
import { assetAttachments } from '../database/schema/asset-attachments';
import { AppError } from '../errors/app-error';
import { createAssetAttachment } from './attachment';

export interface AttachmentDatabaseApi {
  get(attachmentId: string): AssetAttachment | undefined;
  listByProject(projectId: string): readonly AssetAttachment[];
  listByAsset(
    projectId: string,
    assetId: string,
  ): readonly AssetAttachment[];
  create(attachment: AssetAttachment): AssetAttachment;
  update(attachment: AssetAttachment): AssetAttachment;
  delete(attachmentId: string): void;
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Attachment ${field} 不能为空`);
  }

  return normalized;
}

function fromRow(
  row: typeof assetAttachments.$inferSelect,
): AssetAttachment {
  return createAssetAttachment({
    id: row.id,
    projectId: row.projectId,
    assetId: row.assetId,
    typeId: row.typeId,
    typeVersion: row.typeVersion,
    target: row.target,
    metadata: row.metadata,
    ...(row.contentRef && row.contentMediaType
      ? {
          content: {
            ref: row.contentRef,
            mediaType: row.contentMediaType,
          },
        }
      : {}),
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  });
}

function toRow(attachment: AssetAttachment) {
  const value = createAssetAttachment(attachment);

  return {
    id: value.id,
    projectId: value.projectId,
    assetId: value.assetId,
    typeId: value.typeId,
    typeVersion: value.typeVersion,
    target: value.target,
    metadata: value.metadata,
    contentRef: value.content?.ref ?? null,
    contentMediaType: value.content?.mediaType ?? null,
    createdTime: value.createdTime,
    updatedTime: value.updatedTime,
  };
}

export class AttachmentDatabase implements AttachmentDatabaseApi {
  constructor(private readonly context: DatabaseContext) {}

  get(attachmentId: string): AssetAttachment | undefined {
    const row = this.context.db
      .select()
      .from(assetAttachments)
      .where(eq(assetAttachments.id, requireId(attachmentId, 'id')))
      .get();

    return row ? fromRow(row) : undefined;
  }

  listByProject(projectId: string): readonly AssetAttachment[] {
    return this.context.db
      .select()
      .from(assetAttachments)
      .where(
        eq(assetAttachments.projectId, requireId(projectId, 'projectId')),
      )
      .orderBy(
        asc(assetAttachments.createdTime),
        asc(assetAttachments.id),
      )
      .all()
      .map(fromRow);
  }

  listByAsset(
    projectId: string,
    assetId: string,
  ): readonly AssetAttachment[] {
    return this.context.db
      .select()
      .from(assetAttachments)
      .where(
        and(
          eq(
            assetAttachments.projectId,
            requireId(projectId, 'projectId'),
          ),
          eq(assetAttachments.assetId, requireId(assetId, 'assetId')),
        ),
      )
      .orderBy(
        asc(assetAttachments.createdTime),
        asc(assetAttachments.id),
      )
      .all()
      .map(fromRow);
  }

  create(attachment: AssetAttachment): AssetAttachment {
    const row = toRow(attachment);
    const result = this.context.db
      .insert(assetAttachments)
      .values(row)
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return fromRow(row);
  }

  update(attachment: AssetAttachment): AssetAttachment {
    const row = toRow(attachment);
    const result = this.context.db
      .update(assetAttachments)
      .set({
        target: row.target,
        metadata: row.metadata,
        contentRef: row.contentRef,
        contentMediaType: row.contentMediaType,
        updatedTime: row.updatedTime,
      })
      .where(
        and(
          eq(assetAttachments.id, row.id),
          eq(assetAttachments.projectId, row.projectId),
          eq(assetAttachments.assetId, row.assetId),
          eq(assetAttachments.typeId, row.typeId),
          eq(assetAttachments.typeVersion, row.typeVersion),
        ),
      )
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return fromRow(row);
  }

  delete(attachmentId: string): void {
    const result = this.context.db
      .delete(assetAttachments)
      .where(eq(assetAttachments.id, requireId(attachmentId, 'id')))
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }
}
