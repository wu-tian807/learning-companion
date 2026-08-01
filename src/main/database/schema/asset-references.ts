import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { assets } from './assets';
import { projects } from './projects';

export const assetReferences = sqliteTable(
  'asset_references',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    sourceAssetId: text('source_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    createdTime: integer('created_time').notNull(),
  },
  (table) => [
    index('asset_references_project_id_index').on(
      table.projectId,
      table.createdTime,
      table.id,
    ),
    index('asset_references_asset_id_index').on(
      table.assetId,
      table.createdTime,
      table.id,
    ),
    index('asset_references_source_asset_id_index').on(
      table.sourceAssetId,
      table.createdTime,
      table.id,
    ),
    uniqueIndex('asset_references_asset_source_unique').on(
      table.projectId,
      table.assetId,
      table.sourceAssetId,
    ),
  ],
);

export type AssetReferenceRow = typeof assetReferences.$inferSelect;
export type NewAssetReferenceRow = typeof assetReferences.$inferInsert;
