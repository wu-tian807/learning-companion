import { index, integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import type { ProjectWorkspaceLocalFileContentRef } from '../../../shared/assets';
import type { AssetTarget } from '../../../shared/workbench/asset-target';
import type { JsonValue } from '../../../shared/workbench/protocol';
import { assets } from './assets';
import { projects } from './projects';

export const assetAttachments = sqliteTable(
  'asset_attachments',
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
    target: text('target_json', { mode: 'json' })
      .$type<AssetTarget>()
      .notNull(),
    metadata: text('metadata_json', { mode: 'json' })
      .$type<JsonValue>()
      .notNull(),
    contentRef: text('content_ref_json', { mode: 'json' })
      .$type<ProjectWorkspaceLocalFileContentRef>(),
    contentMediaType: text('content_media_type'),
    createdTime: integer('created_time').notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => [
    index('asset_attachments_asset_updated_index').on(
      table.assetId,
      table.updatedTime,
      table.id,
    ),
    index('asset_attachments_project_index').on(table.projectId),
  ],
);

export type AssetAttachmentRow = typeof assetAttachments.$inferSelect;
export type NewAssetAttachmentRow = typeof assetAttachments.$inferInsert;
