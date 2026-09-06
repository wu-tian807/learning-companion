import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type * as assetArtifactSchema from './schema/asset-artifacts';
import type * as assetAttachmentSchema from './schema/asset-attachments';
import type * as assetFolderSchema from './schema/asset-folders';
import type * as assetLinkSchema from './schema/asset-links';
import type * as assetReferenceSchema from './schema/asset-references';
import type * as generationTaskSchema from './schema/generation-tasks';
import type * as assetSchema from './schema/assets';
import type * as projectSchema from './schema/projects';
import type * as workbenchStateSchema from './schema/workbench-state';

type LearningCompanionSchema = typeof assetAttachmentSchema &
  typeof assetArtifactSchema &
  typeof assetFolderSchema &
  typeof assetLinkSchema &
  typeof assetReferenceSchema &
  typeof generationTaskSchema &
  typeof assetSchema &
  typeof projectSchema &
  typeof workbenchStateSchema;

export type LearningCompanionDatabase =
  BetterSQLite3Database<LearningCompanionSchema>;

export interface DatabaseContext {
  readonly sqlite: Database.Database;
  readonly db: LearningCompanionDatabase;
  close(): void;
}
