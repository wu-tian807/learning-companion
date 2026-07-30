import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import type { DatabaseContext } from '../database/database-context';
import { initializeDatabase } from '../database/initialize-database';
import { migrateProjectWorkspaces } from './migrate-project-workspaces';
import { ProjectDatabase } from './project-database';
import { ProjectWorkspaceManager } from './project-workspace-manager';

const contexts: DatabaseContext[] = [];
const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(
    join(tmpdir(), 'learning-companion-project-migration-'),
  );
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  for (const context of contexts.splice(0)) {
    context.close();
  }
  await Promise.all(
    temporaryDirectories
      .splice(0)
      .map((directory) =>
        rm(directory, { recursive: true, force: true }),
      ),
  );
});

describe('migrateProjectWorkspaces', () => {
  it('backfills legacy Project rows before ProjectDatabase initialization', async () => {
    const root = await createTemporaryDirectory();
    const context = initializeDatabase(join(root, 'database.sqlite3'));
    contexts.push(context);
    context.sqlite
      .prepare(
        `INSERT INTO projects (
          id, name, icon, created_time, pinned
        ) VALUES (?, ?, ?, ?, ?)`,
      )
      .run(
        'legacy',
        '旧 Project',
        '📘',
        Date.parse('2026-07-20T01:00:00.000Z'),
        0,
      );
    const defaultWorkspaceRoot = join(root, 'Projects');
    const manager = new ProjectWorkspaceManager();

    await migrateProjectWorkspaces(
      context,
      defaultWorkspaceRoot,
      manager,
    );

    const projectDatabase = new ProjectDatabase(context);
    projectDatabase.initialize();
    const project = projectDatabase.get('legacy')!;

    expect(project.workspacePath).toBe(
      join(defaultWorkspaceRoot, '旧 Project'),
    );
    expect(
      JSON.parse(
        await readFile(
          join(
            project.workspacePath,
            '.learning-companion',
            'workspace.json',
          ),
          'utf8',
        ),
      ),
    ).toEqual({ schemaVersion: 1, projectId: 'legacy' });

    await expect(
      migrateProjectWorkspaces(
        context,
        defaultWorkspaceRoot,
        manager,
      ),
    ).resolves.toBeUndefined();
  });
});
