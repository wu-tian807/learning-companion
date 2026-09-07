import { integer, sqliteTable, text } from 'drizzle-orm/sqlite-core';

import { assets } from './assets';
import { projects } from './projects';

/**
 * The notebook is an ordinary Markdown Asset. This table only stores which
 * Asset the notebook-only viewport should select for a Project.
 */
export const projectNotebookAssets = sqliteTable('project_notebook_assets', {
  projectId: text('project_id')
    .primaryKey()
    .references(() => projects.id, { onDelete: 'cascade' }),
  assetId: text('asset_id').references(() => assets.id, {
    onDelete: 'set null',
  }),
  /** Last legacy row copied into this Asset; kept for recovery/audit only. */
  legacyRevision: integer('legacy_revision'),
  /** Durable identity for a legacy-copy operation that has not linked yet. */
  migrationOperationId: text('migration_operation_id'),
  updatedTime: integer('updated_time').notNull(),
});

export type ProjectNotebookAssetRow =
  typeof projectNotebookAssets.$inferSelect;
