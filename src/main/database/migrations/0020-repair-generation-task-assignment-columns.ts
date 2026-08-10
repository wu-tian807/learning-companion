import type Database from 'better-sqlite3';

const requiredColumns = [
  ['assigned_connection_id', 'TEXT'],
  ['assigned_model_id', 'TEXT'],
  ['assigned_reasoning_effort', 'TEXT'],
] as const;

/**
 * Repairs databases created while migration numbers 17-19 briefly had
 * different meanings across branches. A normal SQL migration cannot use
 * ADD COLUMN IF NOT EXISTS on SQLite, so this migration checks the actual
 * schema instead of trusting user_version alone.
 */
export const repairGenerationTaskAssignmentColumnsMigration = Object.freeze({
  version: 20,
  sql: '',
  apply(sqlite: Database.Database): void {
    const existing = new Set(
      sqlite.prepare<[], { name: string }>('PRAGMA table_info(generation_tasks)')
        .all()
        .map(({ name }) => name),
    );

    for (const [name, type] of requiredColumns) {
      if (!existing.has(name)) {
        sqlite.exec(`ALTER TABLE generation_tasks ADD COLUMN ${name} ${type}`);
      }
    }
  },
});
