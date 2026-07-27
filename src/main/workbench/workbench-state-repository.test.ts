import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { SqliteWorkbenchStateDataRepository } from './workbench-state-data-repository';
import { SqliteWorkbenchStateRepository } from './workbench-state-repository';

const temporaryDirectories: string[] = [];

async function createContext(): Promise<DatabaseContext> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-workbench-state-'),
  );
  temporaryDirectories.push(directory);
  const context = initializeDatabase(join(directory, 'data.sqlite3'));

  context.sqlite
    .prepare(
      'INSERT INTO projects (id, name, icon, created_time, pinned) VALUES (?, ?, ?, ?, ?)',
    )
    .run('project', 'Project', '📘', 1_753_171_200_000, 0);
  context.sqlite
    .prepare(
      `INSERT INTO assets (
        id, project_id, name, media_type, content_ref, created_time,
        last_used_time
      ) VALUES (?, ?, ?, ?, ?, ?, ?)`,
    )
    .run(
      'asset',
      'project',
      '资料',
      'text/plain',
      JSON.stringify({ kind: 'local-file', path: '/tmp/notes.txt' }),
      1_753_171_200_000,
      1_753_171_200_000,
    );
  return context;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('Workbench state repositories', () => {
  it('upserts Workbench JSON state by Asset and Workbench', async () => {
    const context = await createContext();
    const repository = new SqliteWorkbenchStateRepository(context);

    try {
      await expect(
        repository.get('asset', 'builtin.plain-text'),
      ).resolves.toBeUndefined();
      await repository.save({
        assetId: 'asset',
        workbenchId: 'builtin.plain-text',
        schemaVersion: 1,
        payload: { scrollTop: 12 },
        updatedTime: 100,
      });
      await repository.save({
        assetId: 'asset',
        workbenchId: 'builtin.plain-text',
        schemaVersion: 2,
        payload: { scrollTop: 24 },
        updatedTime: 200,
      });

      await expect(
        repository.get('asset', 'builtin.plain-text'),
      ).resolves.toEqual({
        assetId: 'asset',
        workbenchId: 'builtin.plain-text',
        schemaVersion: 2,
        payload: { scrollTop: 24 },
        updatedTime: 200,
      });

      await repository.delete('asset', 'builtin.plain-text');
      await expect(
        repository.get('asset', 'builtin.plain-text'),
      ).resolves.toBeUndefined();
    } finally {
      context.close();
    }
  });

  it('stores opaque Workbench data without interpreting it', async () => {
    const context = await createContext();
    const repository = new SqliteWorkbenchStateDataRepository(context);

    try {
      await repository.save({
        assetId: 'asset',
        workbenchId: 'builtin.plain-text',
        dataKey: 'recovery-content',
        data: new TextEncoder().encode('未保存正文'),
        updatedTime: 100,
      });

      const record = await repository.get(
        'asset',
        'builtin.plain-text',
        'recovery-content',
      );
      expect(record).toMatchObject({
        assetId: 'asset',
        workbenchId: 'builtin.plain-text',
        dataKey: 'recovery-content',
        updatedTime: 100,
      });
      expect(new TextDecoder().decode(record?.data)).toBe('未保存正文');
    } finally {
      context.close();
    }
  });

  it('cascades both state layers when the Asset is deleted', async () => {
    const context = await createContext();
    const stateRepository = new SqliteWorkbenchStateRepository(context);
    const dataRepository = new SqliteWorkbenchStateDataRepository(context);

    try {
      await stateRepository.save({
        assetId: 'asset',
        workbenchId: 'builtin.plain-text',
        schemaVersion: 1,
        payload: {},
        updatedTime: 100,
      });
      await dataRepository.save({
        assetId: 'asset',
        workbenchId: 'builtin.plain-text',
        dataKey: 'recovery-content',
        data: new Uint8Array([1, 2, 3]),
        updatedTime: 100,
      });

      context.sqlite.prepare('DELETE FROM assets WHERE id = ?').run('asset');

      await expect(
        stateRepository.get('asset', 'builtin.plain-text'),
      ).resolves.toBeUndefined();
      await expect(
        dataRepository.get(
          'asset',
          'builtin.plain-text',
          'recovery-content',
        ),
      ).resolves.toBeUndefined();
    } finally {
      context.close();
    }
  });
});
