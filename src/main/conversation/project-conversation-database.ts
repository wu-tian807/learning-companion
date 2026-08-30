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
  save(projectId: string, conversation: ConversationRecord): ConversationRecord;
  import(
    projectId: string,
    conversations: readonly ConversationRecord[],
  ): readonly ConversationRecord[];
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
    title: cloned.title,
    messages: cloned.messages,
    createdTime: cloned.createdTime,
    updatedTime: cloned.updatedTime,
  };
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
    const rows = this.context.db
      .select()
      .from(projectConversations)
      .where(
        eq(
          projectConversations.projectId,
          requireId(projectId, 'projectId'),
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

  import(
    projectId: string,
    conversations: readonly ConversationRecord[],
  ): readonly ConversationRecord[] {
    const normalizedProjectId = requireId(projectId, 'projectId');
    const records = cloneConversationRecords(conversations);
    this.context.db.transaction(() => {
      for (const record of records) {
        this.save(normalizedProjectId, record);
      }
    });
    return this.list(normalizedProjectId);
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
