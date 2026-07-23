import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_PREFERENCES } from '../../shared/app-preferences';
import { JsonSettingsRepository } from './json-settings-repository';

const temporaryDirectories: string[] = [];

async function createTemporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'learning-companion-settings-'));
  temporaryDirectories.push(directory);
  return directory;
}

function createLogger() {
  const warn = vi.fn<(message: string, error?: unknown) => void>();

  return {
    logger: { warn },
    warn,
  };
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('json settings repository', () => {
  it('requires initialization before reading or updating settings', async () => {
    const directory = await createTemporaryDirectory();
    const repository = new JsonSettingsRepository(join(directory, 'settings.json'));

    expect(() => repository.get()).toThrow('Settings Repository 尚未初始化');
    await expect(
      repository.updateHomePreferences({ viewMode: 'list', sortMode: 'title' }),
    ).rejects.toThrow('Settings Repository 尚未初始化');
  });

  it('uses defaults without creating a file when settings do not exist', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);

    await repository.initialize();

    expect(repository.get()).toEqual(DEFAULT_APP_PREFERENCES);
    await expect(readFile(settingsFile, 'utf8')).rejects.toMatchObject({ code: 'ENOENT' });
  });

  it('deserializes valid settings during initialization', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    await mkdir(join(directory, 'config'), { recursive: true });
    await writeFile(
      settingsFile,
      JSON.stringify({
        schemaVersion: 1,
        home: {
          viewMode: 'list',
          sortMode: 'oldest',
        },
      }),
      'utf8',
    );
    const repository = new JsonSettingsRepository(settingsFile);

    await repository.initialize();

    expect(repository.get()).toEqual({
      schemaVersion: 1,
      home: {
        viewMode: 'list',
        sortMode: 'oldest',
      },
    });
  });

  it.each([
    ['invalid JSON', '{not-json'],
    [
      'invalid structure',
      JSON.stringify({
        schemaVersion: 1,
        home: {
          viewMode: 'compact',
          sortMode: 'newest',
        },
      }),
    ],
    [
      'unknown version',
      JSON.stringify({
        schemaVersion: 2,
        home: {
          viewMode: 'grid',
          sortMode: 'newest',
        },
      }),
    ],
  ])('warns and restores defaults for %s', async (_caseName, content) => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    await writeFile(settingsFile, content, 'utf8');
    const { logger, warn } = createLogger();
    const repository = new JsonSettingsRepository(settingsFile, { logger });

    await repository.initialize();

    expect(repository.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(warn).toHaveBeenCalledOnce();
    expect(warn).toHaveBeenCalledWith(
      'Settings 读取失败，已恢复默认设置。',
      expect.anything(),
    );
  });

  it('serializes updates and restores them in a new repository', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    const updated = await repository.updateHomePreferences({
      viewMode: 'list',
      sortMode: 'title',
    });

    expect(updated).toEqual({
      schemaVersion: 1,
      home: {
        viewMode: 'list',
        sortMode: 'title',
      },
    });
    expect(await readFile(settingsFile, 'utf8')).toBe(
      `${JSON.stringify(updated, null, 2)}\n`,
    );

    const restoredRepository = new JsonSettingsRepository(settingsFile);
    await restoredRepository.initialize();
    expect(restoredRepository.get()).toEqual(updated);
  });

  it('keeps the last successful in-memory state when writing fails', async () => {
    const directory = await createTemporaryDirectory();
    const blockedDirectory = join(directory, 'blocked');
    await writeFile(blockedDirectory, 'not a directory', 'utf8');
    const repository = new JsonSettingsRepository(join(blockedDirectory, 'settings.json'));
    await repository.initialize();

    await expect(
      repository.updateHomePreferences({
        viewMode: 'list',
        sortMode: 'oldest',
      }),
    ).rejects.toBeDefined();
    expect(repository.get()).toEqual(DEFAULT_APP_PREFERENCES);
  });

  it('serializes concurrent updates in invocation order', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    const firstUpdate = repository.updateHomePreferences({
      viewMode: 'list',
      sortMode: 'oldest',
    });
    const secondUpdate = repository.updateHomePreferences({
      viewMode: 'grid',
      sortMode: 'title',
    });

    await Promise.all([firstUpdate, secondUpdate]);

    expect(repository.get()).toEqual({
      schemaVersion: 1,
      home: {
        viewMode: 'grid',
        sortMode: 'title',
      },
    });
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual(repository.get());
  });
});
