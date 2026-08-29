import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type {
  AssetContentRef,
  AssetCreationKind,
} from '../../../shared/assets';
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
    creationKind: text('creation_kind')
      .$type<AssetCreationKind>()
      .notNull(),
    contentRef: text('content_ref', { mode: 'json' })
      .$type<AssetContentRef>()
      .notNull(),
    createdTime: integer('created_time').notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => [index('assets_project_id_index').on(table.projectId)],
);

export type AssetRow = typeof assets.$inferSelect;
export type NewAssetRow = typeof assets.$inferInsert;
