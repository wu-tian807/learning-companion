import {
  index,
  integer,
  primaryKey,
  sqliteTable,
  text,
} from 'drizzle-orm/sqlite-core';

import { assets } from './assets';

export const assetArtifacts = sqliteTable(
  'asset_artifacts',
  {
    assetId: text('asset_id')
      .notNull()
      .references(() => assets.id, { onDelete: 'cascade' }),
    producerId: text('producer_id').notNull(),
    artifactKey: text('artifact_key').notNull(),
    relativePath: text('relative_path').notNull(),
    mediaType: text('media_type').notNull(),
    sourceRevision: text('source_revision').notNull(),
    producerVersion: text('producer_version').notNull(),
    artifactRevision: text('artifact_revision').notNull(),
    updatedTime: integer('updated_time').notNull(),
  },
  (table) => [
    primaryKey({
      columns: [table.assetId, table.producerId, table.artifactKey],
    }),
    index('asset_artifacts_asset_id_index').on(table.assetId),
  ],
);

export type AssetArtifactRow = typeof assetArtifacts.$inferSelect;
export type NewAssetArtifactRow = typeof assetArtifacts.$inferInsert;
