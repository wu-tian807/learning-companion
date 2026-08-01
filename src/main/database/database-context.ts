import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type * as assetArtifactSchema from './schema/asset-artifacts';
import type * as assetLinkSchema from './schema/asset-links';
import type * as assetReferenceSchema from './schema/asset-references';
import type * as assetSchema from './schema/assets';
import type * as projectSchema from './schema/projects';
import type * as workbenchStateSchema from './schema/workbench-state';

type LearningCompanionSchema = typeof assetArtifactSchema &
  typeof assetLinkSchema &
  typeof assetReferenceSchema &
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
