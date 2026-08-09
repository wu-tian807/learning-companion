import { randomUUID } from 'node:crypto';

import { and, asc, eq } from 'drizzle-orm';

import type {
  ProjectWorkspaceLocalFileContentRef,
} from '../../shared/assets';
import type { AssetAttachment } from '../../shared/workbench/attachment';
import { cloneAssetAttachment } from './attachment';
import type { DatabaseContext } from '../database/database-context';
import { attachments } from '../database/schema/attachments';
import { AppError } from '../errors/app-error';

export interface AttachmentDatabaseApi {
  listByProject(projectId: string): readonly AssetAttachment[];
  listByAsset(projectId: string, assetId: string): readonly AssetAttachment[];
  create(attachment: AssetAttachment): AssetAttachment;
  update(attachment: AssetAttachment): AssetAttachment;
  delete(projectId: string, attachmentId: string): void;
}

export interface AttachmentDatabaseDependencies {
  readonly createId: () => string;
  readonly now: () => number;
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();

  if (normalized.length === 0) {
    throw new Error(`Attachment ${field} 不能为空`);
  }

  return normalized;
}

function mapRow(row: typeof attachments.$inferSelect): AssetAttachment {
  const contentRef = row.contentRef as ProjectWorkspaceLocalFileContentRef | null;

  return {
    id: row.id,
    projectId: row.projectId,
    assetId: row.assetId,
    typeId: row.typeId,
    typeVersion: row.typeVersion,
    target: row.target as AssetAttachment['target'],
    metadata: row.metadata as AssetAttachment['metadata'],
    content: contentRef
      ? {
          ref: contentRef,
          mediaType: row.contentMediaType ?? 'application/octet-stream',
        }
      : undefined,
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  };
}

function rowToAttachment(row: typeof attachments.$inferSelect): AssetAttachment {
  try {
    return cloneAssetAttachment(mapRow(row));
  } catch (error) {
    throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
  }
}

export class AttachmentDatabase implements AttachmentDatabaseApi {
  private readonly dependencies: AttachmentDatabaseDependencies;

  constructor(
    private readonly context: DatabaseContext,
    dependencies: Partial<AttachmentDatabaseDependencies> = {},
  ) {
    this.dependencies = {
      createId: dependencies.createId ?? randomUUID,
      now: dependencies.now ?? Date.now,
    };
  }

  listByProject(projectId: string): readonly AssetAttachment[] {
    return this.context.db
      .select()
      .from(attachments)
      .where(
        eq(attachments.projectId, requireId(projectId, 'projectId')),
      )
      .orderBy(asc(attachments.createdTime), asc(attachments.id))
      .all()
      .map(rowToAttachment);
  }

  listByAsset(
    projectId: string,
    assetId: string,
  ): readonly AssetAttachment[] {
    return this.context.db
      .select()
      .from(attachments)
      .where(
        and(
          eq(attachments.projectId, requireId(projectId, 'projectId')),
          eq(attachments.assetId, requireId(assetId, 'assetId')),
        ),
      )
      .orderBy(asc(attachments.createdTime), asc(attachments.id))
      .all()
      .map(rowToAttachment);
  }

  create(attachment: AssetAttachment): AssetAttachment {
    let normalized: AssetAttachment;

    try {
      normalized = cloneAssetAttachment(attachment);
    } catch (error) {
      throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
    }

    const row = {
      id: normalized.id,
      projectId: normalized.projectId,
      assetId: normalized.assetId,
      typeId: normalized.typeId,
      typeVersion: normalized.typeVersion,
      target: normalized.target,
      metadata: normalized.metadata,
      contentRef: normalized.content?.ref ?? null,
      contentMediaType: normalized.content?.mediaType ?? null,
      createdTime: normalized.createdTime,
      updatedTime: normalized.updatedTime,
    };

    const result = this.context.db.insert(attachments).values(row).run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return cloneAssetAttachment(normalized);
  }

  update(attachment: AssetAttachment): AssetAttachment {
    let normalized: AssetAttachment;

    try {
      normalized = cloneAssetAttachment(attachment);
    } catch (error) {
      throw new AppError('DATA_INTEGRITY_ERROR', { cause: error });
    }

    const result = this.context.db
      .update(attachments)
      .set({
        typeId: normalized.typeId,
        typeVersion: normalized.typeVersion,
        target: normalized.target,
        metadata: normalized.metadata,
        contentRef: normalized.content?.ref ?? null,
        contentMediaType: normalized.content?.mediaType ?? null,
        updatedTime: normalized.updatedTime,
      })
      .where(
        and(
          eq(attachments.id, normalized.id),
          eq(attachments.projectId, normalized.projectId),
        ),
      )
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }

    return cloneAssetAttachment(normalized);
  }

  delete(projectId: string, attachmentId: string): void {
    const result = this.context.db
      .delete(attachments)
      .where(
        and(
          eq(attachments.projectId, requireId(projectId, 'projectId')),
          eq(attachments.id, requireId(attachmentId, 'attachmentId')),
        ),
      )
      .run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
  }
}
