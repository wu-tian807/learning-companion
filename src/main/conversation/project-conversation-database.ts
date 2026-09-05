import { and, asc, eq } from 'drizzle-orm';

import {
  cloneConversationRecord,
  cloneConversationRecords,
  PROJECT_CONVERSATION_MAX_CONVERSATIONS,
  type ConversationRecord,
} from '../../shared/project-conversations';
import type { DatabaseContext } from '../database/database-context';
import { projectConversations } from '../database/schema/project-conversations';
import { AppError } from '../errors/app-error';

export interface ProjectConversationDatabaseApi {
  get(conversationId: string):
    | Readonly<{ projectId: string; conversation: ConversationRecord }>
    | undefined;
  list(projectId: string): readonly ConversationRecord[];
  getBound(
    projectId: string,
    boundAssetId: string,
    modeId: string,
  ): ConversationRecord | undefined;
  replaceBound(
    projectId: string,
    boundAssetId: string,
    modeId: string,
    conversation: ConversationRecord,
  ): ConversationRecord;
  save(projectId: string, conversation: ConversationRecord): ConversationRecord;
  remove(projectId: string, conversationId: string): void;
}

function requireId(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length === 0 || normalized !== value) {
    throw new AppError('DATA_INTEGRITY_ERROR', {
      cause: new Error(`Project Conversation ${field} 无效`),
    });
  }
  return normalized;
}

function fromRow(
  row: typeof projectConversations.$inferSelect,
): ConversationRecord {
  return cloneConversationRecord({
    id: row.id,
    modeId: row.modeId,
    ...(row.boundAssetId ? { boundAssetId: row.boundAssetId } : {}),
    ...(row.workspace ? { workspace: row.workspace } : {}),
    title: row.title,
    messages: row.messages,
    createdTime: row.createdTime,
    updatedTime: row.updatedTime,
  });
}

function toRow(projectId: string, conversation: ConversationRecord) {
  const cloned = cloneConversationRecord(conversation);
  return {
    id: cloned.id,
    projectId: requireId(projectId, 'projectId'),
    modeId: cloned.modeId,
    boundAssetId: cloned.boundAssetId ?? null,
    workspace: cloned.workspace ?? null,
    title: cloned.title,
    messages: cloned.messages,
    createdTime: cloned.createdTime,
    updatedTime: cloned.updatedTime,
  };
}

function sameExecutionContext(
  existing: typeof projectConversations.$inferSelect,
  next: ReturnType<typeof toRow>,
): boolean {
  return (
    existing.modeId === next.modeId &&
    existing.boundAssetId === next.boundAssetId &&
    (existing.workspace?.instanceKey ?? undefined) ===
      (next.workspace?.instanceKey ?? undefined)
  );
}

export class ProjectConversationDatabase
  implements ProjectConversationDatabaseApi
{
  constructor(private readonly context: DatabaseContext) {}

  get(conversationId: string) {
    const row = this.context.db
      .select()
      .from(projectConversations)
      .where(
        eq(
          projectConversations.id,
          requireId(conversationId, 'conversationId'),
        ),
      )
      .get();
    return row
      ? Object.freeze({
          projectId: row.projectId,
          conversation: fromRow(row),
        })
      : undefined;
  }

  list(projectId: string): readonly ConversationRecord[] {
    const normalizedProjectId = requireId(projectId, 'projectId');
    // Asset deletion uses ON DELETE SET NULL for bound conversations. Enforce
    // the same ordinary-history limit at the read boundary so a conversation
    // becoming unbound cannot make the entire history invalid until the next
    // write.
    this.trim(normalizedProjectId);
    const rows = this.context.db
      .select()
      .from(projectConversations)
      .where(
        eq(
          projectConversations.projectId,
          normalizedProjectId,
        ),
      )
      .orderBy(
        asc(projectConversations.createdTime),
        asc(projectConversations.id),
      )
      .all()
      .map(fromRow);
    return cloneConversationRecords(rows);
  }

  getBound(
    projectId: string,
    boundAssetId: string,
    modeId: string,
  ): ConversationRecord | undefined {
    const row = this.context.db
      .select()
      .from(projectConversations)
      .where(
        and(
          eq(projectConversations.projectId, requireId(projectId, 'projectId')),
          eq(projectConversations.boundAssetId, requireId(boundAssetId, 'boundAssetId')),
          eq(projectConversations.modeId, requireId(modeId, 'modeId')),
        ),
      )
      .get();
    return row ? fromRow(row) : undefined;
  }

  replaceBound(
    projectId: string,
    boundAssetId: string,
    modeId: string,
    conversation: ConversationRecord,
  ): ConversationRecord {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const normalizedBoundAssetId = requireId(boundAssetId, 'boundAssetId');
    const normalizedModeId = requireId(modeId, 'modeId');
    const row = toRow(normalizedProjectId, conversation);
    if (
      row.boundAssetId !== normalizedBoundAssetId ||
      row.modeId !== normalizedModeId
    ) {
      throw new AppError('DATA_INTEGRITY_ERROR', {
        cause: new Error('替换的 Project Conversation 绑定不一致'),
      });
    }

    return this.context.db.transaction((transaction) => {
      const existing = transaction
        .select()
        .from(projectConversations)
        .where(
          and(
            eq(projectConversations.projectId, normalizedProjectId),
            eq(projectConversations.boundAssetId, normalizedBoundAssetId),
            eq(projectConversations.modeId, normalizedModeId),
          ),
        )
        .get();

      if (existing?.id === row.id) {
        throw new AppError('DATABASE_WRITE_CONFLICT', {
          cause: new Error('绑定 Conversation 替换必须使用新的 id'),
        });
      }
      if (existing) {
        const removed = transaction
          .delete(projectConversations)
          .where(
            and(
              eq(projectConversations.projectId, normalizedProjectId),
              eq(projectConversations.id, existing.id),
            ),
          )
          .run();
        if (removed.changes !== 1) {
          throw new AppError('DATABASE_WRITE_CONFLICT');
        }
      }

      const inserted = transaction
        .insert(projectConversations)
        .values(row)
        .run();
      if (inserted.changes !== 1) {
        throw new AppError('DATABASE_WRITE_CONFLICT');
      }

      return fromRow({
        ...row,
        createdTime: existing?.createdTime ?? row.createdTime,
      });
    });
  }

  save(
    projectId: string,
    conversation: ConversationRecord,
  ): ConversationRecord {
    const row = toRow(projectId, conversation);
    const existing = this.context.db
      .select()
      .from(projectConversations)
      .where(eq(projectConversations.id, row.id))
      .get();

    if (existing && existing.projectId !== row.projectId) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
    if (existing && !sameExecutionContext(existing, row)) {
      throw new AppError('DATABASE_WRITE_CONFLICT', {
        cause: new Error('Conversation Mode 或 Workspace Binding 不可修改'),
      });
    }
    if (existing && row.updatedTime < existing.updatedTime) {
      return fromRow(existing);
    }

    const result = existing
      ? this.context.db
          .update(projectConversations)
          .set({
            title: row.title,
            messages: row.messages,
            updatedTime: row.updatedTime,
          })
          .where(
            and(
              eq(projectConversations.id, row.id),
              eq(projectConversations.projectId, row.projectId),
            ),
          )
          .run()
      : this.context.db.insert(projectConversations).values(row).run();

    if (result.changes !== 1) {
      throw new AppError('DATABASE_WRITE_CONFLICT');
    }
    this.trim(row.projectId);
    return fromRow({
      ...row,
      createdTime: existing?.createdTime ?? row.createdTime,
    });
  }

  remove(projectId: string, conversationId: string): void {
    this.context.db
      .delete(projectConversations)
      .where(
        and(
          eq(
            projectConversations.projectId,
            requireId(projectId, 'projectId'),
          ),
          eq(
            projectConversations.id,
            requireId(conversationId, 'conversationId'),
          ),
        ),
      )
      .run();
  }

  private trim(projectId: string): void {
    this.context.sqlite
      .prepare(
        `DELETE FROM project_conversations
         WHERE project_id = ?
           AND id IN (
             SELECT id
             FROM project_conversations
             WHERE project_id = ?
               AND bound_asset_id IS NULL
             ORDER BY updated_time DESC, id ASC
             LIMIT -1 OFFSET ?
           )`,
      )
      .run(
        projectId,
        projectId,
        PROJECT_CONVERSATION_MAX_CONVERSATIONS,
      );
  }
}
