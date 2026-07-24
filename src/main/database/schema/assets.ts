import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { projects } from './projects';

export const assets = sqliteTable(
  'assets',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    name: text('name').notNull(),
    mediaType: text('media_type').notNull(),
    contentKind: text('content_kind').$type<'local-file'>().notNull(),
    contentPath: text('content_path').notNull(),
    createdTime: integer('created_time', { mode: 'timestamp_ms' }).notNull(),
    lastUsedTime: integer('last_used_time', { mode: 'timestamp_ms' }).notNull(),
  },
  (table) => [index('assets_project_id_index').on(table.projectId)],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
