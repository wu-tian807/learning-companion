import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { initializeDatabase } from './initialize-database';

const temporaryDirectories: string[] = [];

async function createDatabaseFile(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'learning-companion-db-'));
  temporaryDirectories.push(directory);
  return join(directory, 'data', 'learning-companion.sqlite3');
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('initializeDatabase', () => {
  it('creates the database and applies the Project migration', async () => {
    const databaseFile = await createDatabaseFile();
    const context = initializeDatabase(databaseFile);

    try {
      expect(context.sqlite.pragma('user_version', { simple: true })).toBe(1);
      expect(context.sqlite.pragma('foreign_keys', { simple: true })).toBe(1);
      expect(
        context.sqlite
          .prepare<{ name: string }, { name: string }>(
            "SELECT name FROM sqlite_master WHERE type = 'table' AND name = @name",
          )
          .get({ name: 'projects' }),
      ).toEqual({ name: 'projects' });
    } finally {
      context.close();
    }
  });

  it('can initialize the same database again without repeating migrations', async () => {
    const databaseFile = await createDatabaseFile();
    const firstContext = initializeDatabase(databaseFile);
    firstContext.close();

    const secondContext = initializeDatabase(databaseFile);

    try {
      expect(secondContext.sqlite.pragma('user_version', { simple: true })).toBe(1);
    } finally {
      secondContext.close();
    }
  });

  it('closes the underlying connection idempotently', async () => {
    const databaseFile = await createDatabaseFile();
    const context = initializeDatabase(databaseFile);

    context.close();
    context.close();

    expect(context.sqlite.open).toBe(false);
  });
});
