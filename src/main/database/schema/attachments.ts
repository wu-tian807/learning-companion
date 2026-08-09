import {
  index,
  integer,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import type { AssetTarget } from '../../../shared/workbench/anchor';
import type { ProjectWorkspaceLocalFileContentRef } from '../../../shared/assets';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { assets } from './assets';
import { projects } from './projects';

export const attachments = sqliteTable(
  'attachments',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    typeId: text('type_id').notNull(),
    typeVersion: integer('type_version').notNull(),
    target: text('target', { mode: 'json' })
      .$type<AssetTarget>()
      .notNull(),
    metadata: text('metadata', { mode: 'json' })
      .$type<JsonValue>()
      .notNull(),
    contentRef: text('content_ref', { mode: 'json' })
      .$type<ProjectWorkspaceLocalFileContentRef | null>(),
    contentMediaType: text('content_media_type'),
    createdTime: integer('created_time').notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => [
    index('attachments_project_id_index').on(
      table.projectId,
      table.createdTime,
      table.id,
    ),
    index('attachments_asset_id_index').on(
      table.assetId,
      table.createdTime,
      table.id,
    ),
    index('attachments_type_id_index').on(
      table.typeId,
      table.typeVersion,
      table.assetId,
    ),
  ],
);

export type AttachmentRow = typeof attachments.$inferSelect;
export type NewAttachmentRow = typeof attachments.$inferInsert;
