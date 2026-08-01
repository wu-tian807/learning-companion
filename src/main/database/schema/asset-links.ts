import {
  index,
  integer,
  sqliteTable,
  text,
  uniqueIndex,
} from 'drizzle-orm/sqlite-core';

import { assets } from './assets';
import { projects } from './projects';

export const assetLinks = sqliteTable(
  'asset_links',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    targetAssetId: text('target_asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    createdTime: integer('created_time').notNull(),
  },
  (table) => [
    index('asset_links_project_id_index').on(
      table.projectId,
      table.createdTime,
      table.id,
    ),
    index('asset_links_asset_id_index').on(
      table.assetId,
      table.createdTime,
      table.id,
    ),
    index('asset_links_target_asset_id_index').on(
      table.targetAssetId,
      table.createdTime,
      table.id,
    ),
    uniqueIndex('asset_links_asset_target_unique').on(
      table.projectId,
      table.assetId,
      table.targetAssetId,
    ),
  ],
);

export type AssetLinkRow = typeof assetLinks.$inferSelect;
export type NewAssetLinkRow = typeof assetLinks.$inferInsert;
