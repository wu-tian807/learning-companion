import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type {
  ConversationMessageRecord,
  ConversationWorkspaceBinding,
} from '../../../shared/project-conversations';
import { projects } from './projects';

export const projectConversations = sqliteTable(
  'project_conversations',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    modeId: text('mode_id').notNull(),
    workspace: text('workspace_binding_json', { mode: 'json' })
      .$type<ConversationWorkspaceBinding>(),
    title: text('title').notNull(),
    messages: text('messages_json', { mode: 'json' })
      .$type<readonly ConversationMessageRecord[]>()
      .notNull(),
    createdTime: integer('created_time').notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => [
    index('project_conversations_project_updated_index').on(
      table.projectId,
      table.updatedTime,
      table.id,
    ),
  ],
);

export type ProjectConversationRow =
  typeof projectConversations.$inferSelect;
export type NewProjectConversationRow =
  typeof projectConversations.$inferInsert;
