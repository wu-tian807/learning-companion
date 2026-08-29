import { primaryKey, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { projects } from './projects';

export const assetFolders = sqliteTable(
  'asset_folders',
  {
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
  },
  (table) => [
    primaryKey({
      name: 'asset_folders_project_path_primary_key',
      columns: [table.projectId, table.path],
    }),
  ],
);

export type AssetFolderRow = typeof assetFolders.$inferSelect;
