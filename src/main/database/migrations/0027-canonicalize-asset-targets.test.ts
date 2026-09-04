import Database from 'better-sqlite3';
import { afterEach, describe, expect, it } from 'vitest';

import { canonicalizeAssetTargetsMigration } from './0027-canonicalize-asset-targets';

const databases: Database.Database[] = [];

function createDatabase(): Database.Database {
  const sqlite = new Database(':memory:');
  databases.push(sqlite);
  sqlite.exec(`
    CREATE TABLE asset_attachments (id TEXT PRIMARY KEY, target_json TEXT NOT NULL);
    CREATE TABLE project_conversations (id TEXT PRIMARY KEY, messages_json TEXT NOT NULL);
    CREATE TABLE generation_tasks (id TEXT PRIMARY KEY, instruction_json TEXT NOT NULL);
  `);
  return sqlite;
}

afterEach(() => {
  for (const sqlite of databases.splice(0)) sqlite.close();
});

describe('migration 27 canonical AssetTarget data', () => {
  it('rewrites legacy targets in all persisted JSON boundaries', () => {
    const sqlite = createDatabase();
    const legacy = {
      scope: 'content',
      anchorType: 'pdf.page',
      anchorVersion: 1,
      anchorPayload: { pageNumber: 2 },
    };
    sqlite.prepare('INSERT INTO asset_attachments VALUES (?, ?)').run(
      'attachment-1',
      JSON.stringify(legacy),
    );
    sqlite.prepare('INSERT INTO project_conversations VALUES (?, ?)').run(
      'conversation-1',
      JSON.stringify([{ context: { target: legacy } }]),
    );
    sqlite.prepare('INSERT INTO generation_tasks VALUES (?, ?)').run(
      'task-1',
      JSON.stringify({ context: { target: legacy } }),
    );

    canonicalizeAssetTargetsMigration.apply(sqlite);

    expect(JSON.parse(
      (sqlite.prepare('SELECT target_json FROM asset_attachments').get() as { target_json: string }).target_json,
    )).toEqual({
      scope: 'content',
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 2 },
    });
    expect(JSON.parse(
      (sqlite.prepare('SELECT messages_json FROM project_conversations').get() as { messages_json: string }).messages_json,
    )[0].context.target).toEqual({
      scope: 'content',
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 2 },
    });
    expect(JSON.parse(
      (sqlite.prepare('SELECT instruction_json FROM generation_tasks').get() as { instruction_json: string }).instruction_json,
    ).context.target).toEqual({
      scope: 'content',
      targetType: 'pdf.page',
      targetVersion: 1,
      targetPayload: { pageNumber: 2 },
    });
  });

  it('does not rewrite unrelated objects that merely contain anchor-like keys', () => {
    const sqlite = createDatabase();
    const value = {
      anchorType: 'user-data',
      anchorVersion: 1,
      anchorPayload: { note: 'not a target' },
    };
    sqlite.prepare('INSERT INTO asset_attachments VALUES (?, ?)').run(
      'attachment-1',
      JSON.stringify(value),
    );

    canonicalizeAssetTargetsMigration.apply(sqlite);

    expect(JSON.parse(
      (sqlite.prepare('SELECT target_json FROM asset_attachments').get() as { target_json: string }).target_json,
    )).toEqual(value);
  });

  it('fails closed on malformed persisted JSON', () => {
    const sqlite = createDatabase();
    sqlite.prepare('INSERT INTO asset_attachments VALUES (?, ?)').run(
      'attachment-1',
      '{not-json',
    );

    expect(() => canonicalizeAssetTargetsMigration.apply(sqlite))
      .toThrow('无法迁移 asset_attachments.target_json：attachment-1');
  });

  it('is idempotent after the first canonicalization', () => {
    const sqlite = createDatabase();
    sqlite.prepare('INSERT INTO asset_attachments VALUES (?, ?)').run(
      'attachment-1',
      JSON.stringify({
        scope: 'content',
        anchorType: 'pdf.page',
        anchorVersion: 1,
        anchorPayload: { pageNumber: 2 },
      }),
    );

    canonicalizeAssetTargetsMigration.apply(sqlite);
    const first = (sqlite.prepare('SELECT target_json FROM asset_attachments').get() as { target_json: string }).target_json;
    canonicalizeAssetTargetsMigration.apply(sqlite);
    const second = (sqlite.prepare('SELECT target_json FROM asset_attachments').get() as { target_json: string }).target_json;

    expect(second).toBe(first);
  });
});
