import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { reconcileLegacyBranchSchemaMigration } from './0020-reconcile-legacy-branch-schema';

const databases: Database.Database[] = [];

function createDatabase(): Database.Database {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE asset_attachments (
      id TEXT PRIMARY KEY NOT NULL,
      project_id TEXT NOT NULL,
      asset_id TEXT NOT NULL,
      type_id TEXT NOT NULL,
      type_version INTEGER NOT NULL,
      target_json TEXT NOT NULL CHECK (json_valid(target_json)),
      metadata_json TEXT NOT NULL CHECK (json_valid(metadata_json)),
      content_ref_json TEXT,
      content_media_type TEXT,
      created_time INTEGER NOT NULL,
      updated_time INTEGER NOT NULL CHECK (updated_time >= created_time)
    );
    CREATE TABLE attachments (
      id TEXT PRIMARY KEY, project_id TEXT, asset_id TEXT, type_id TEXT,
      type_version INTEGER, target TEXT, metadata TEXT, content_ref TEXT,
      content_media_type TEXT, created_time INTEGER, updated_time INTEGER
    );
  `);
  return sqlite;
}

function insertLegacy(sqlite: Database.Database, id: string, metadata = '{}'): void {
  sqlite.prepare(`INSERT INTO attachments VALUES (?, 'project', 'asset',
    'ai.annotation', 1, '{"scope":"asset"}', ?,
    '{"kind":"local-file","base":"project-workspace","path":"annotations/a.json"}',
    'application/json', 1, 2)`).run(id, metadata);
}

afterEach(() => {
  for (const sqlite of databases.splice(0)) sqlite.close();
});

describe('migration 20 legacy branch reconciliation', () => {
  it('copies non-empty content references and is idempotent after success', () => {
    const sqlite = createDatabase();
    insertLegacy(sqlite, 'legacy');

    sqlite.transaction(() => reconcileLegacyBranchSchemaMigration.reconcile(sqlite)).immediate();
    expect(sqlite.prepare('SELECT id, content_ref_json FROM asset_attachments').get()).toEqual({
      id: 'legacy',
      content_ref_json: '{"kind":"local-file","base":"project-workspace","path":"annotations/a.json"}',
    });
    expect(() => reconcileLegacyBranchSchemaMigration.reconcile(sqlite)).not.toThrow();
  });

  it('rolls back and retains the legacy table when an id conflicts', () => {
    const sqlite = createDatabase();
    sqlite.exec(`INSERT INTO asset_attachments VALUES (
      'same', 'project', 'asset', 'ai.annotation', 1,
      '{"scope":"asset"}', '{}', NULL, NULL, 1, 1)`);
    insertLegacy(sqlite, 'same');

    expect(() => sqlite.transaction(
      () => reconcileLegacyBranchSchemaMigration.reconcile(sqlite),
    ).immediate()).toThrow();
    expect(sqlite.prepare('SELECT count(*) AS count FROM attachments').get()).toEqual({ count: 1 });
    expect(sqlite.prepare('SELECT count(*) AS count FROM asset_attachments').get()).toEqual({ count: 1 });
  });

  it('rolls back and retains a malformed legacy row', () => {
    const sqlite = createDatabase();
    insertLegacy(sqlite, 'bad', 'not-json');

    expect(() => sqlite.transaction(
      () => reconcileLegacyBranchSchemaMigration.reconcile(sqlite),
    ).immediate()).toThrow();
    expect(sqlite.prepare('SELECT id FROM attachments').get()).toEqual({ id: 'bad' });
    expect(sqlite.prepare('SELECT count(*) AS count FROM asset_attachments').get()).toEqual({ count: 0 });
  });
});
