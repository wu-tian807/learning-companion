import type Database from 'better-sqlite3';
import { createAssetAttachmentsMigration } from './0019-create-asset-attachments';

const assignmentColumns = [
  ['assigned_connection_id', 'TEXT'],
  ['assigned_model_id', 'TEXT'],
  ['assigned_reasoning_effort', 'TEXT'],
] as const;

function tableExists(sqlite: Database.Database, table: string): boolean {
  return sqlite.prepare<[string], { found: number }>(
    `SELECT 1 AS found FROM sqlite_master WHERE type = 'table' AND name = ?`,
  ).get(table)?.found === 1;
}

function reconcileLegacyBranchSchema(sqlite: Database.Database): void {
  if (tableExists(sqlite, 'generation_tasks')) {
    const columns = new Set(
      sqlite.prepare<[], { name: string }>('PRAGMA table_info(generation_tasks)')
        .all().map(({ name }) => name),
    );
    for (const [name, type] of assignmentColumns) {
      if (!columns.has(name)) sqlite.exec(`ALTER TABLE generation_tasks ADD COLUMN ${name} ${type}`);
    }
  }

  if (!tableExists(sqlite, 'attachments')) return;
  if (!tableExists(sqlite, 'asset_attachments')) {
    sqlite.exec(createAssetAttachmentsMigration.sql);
  }

  sqlite.exec(`
    INSERT INTO asset_attachments (
      id, project_id, asset_id, type_id, type_version,
      target_json, metadata_json, content_ref_json, content_media_type,
      created_time, updated_time
    )
    SELECT
      id, project_id, asset_id, type_id, type_version,
      target, metadata, content_ref, content_media_type,
      created_time, MAX(updated_time, created_time)
    FROM attachments;
    DROP TABLE attachments;
  `);
}

export const reconcileLegacyBranchSchemaMigration = Object.freeze({
  version: 20,
  sql: '',
  apply: reconcileLegacyBranchSchema,
  reconcile: reconcileLegacyBranchSchema,
});
