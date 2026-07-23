import type Database from 'better-sqlite3';
import type { BetterSQLite3Database } from 'drizzle-orm/better-sqlite3';

import type * as schema from './schema/projects';

export type LearningCompanionDatabase = BetterSQLite3Database<typeof schema>;

export interface DatabaseContext {
  readonly sqlite: Database.Database;
  readonly db: LearningCompanionDatabase;
  close(): void;
}
