import { index, sqliteTable, text, uniqueIndex } from 'drizzle-orm/sqlite-core';

import { assets } from './assets';
import { projects } from './projects';

export const assetFolders = sqliteTable(
  'asset_folders',
  {
    id: text('id').primaryKey(),
    projectId: text('project_id')
      .notNull()
      .references(() => projects.id, { onDelete: 'cascade' }),
    path: text('path').notNull(),
  },
  (table) => [
    uniqueIndex('asset_folders_project_path_unique').on(
      table.projectId,
      table.path,
    ),
  ],
);

export const assetFolderAssignments = sqliteTable(
  'asset_folder_assignments',
  {
    assetId: text('asset_id')
      .primaryKey()
      .references(() => assets.id, { onDelete: 'cascade' }),
    folderId: text('folder_id')
      .notNull()
      .references(() => assetFolders.id),
  },
  (table) => [
    index('asset_folder_assignments_folder_id_index').on(table.folderId),
  ],
);

export type AssetFolderRow = typeof assetFolders.$inferSelect;
export type AssetFolderAssignmentRow =
  typeof assetFolderAssignments.$inferSelect;
