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
    expect(() => repository.getAppSetup()).toThrow(
      'Settings Repository 尚未初始化',
    );
    expect(() => repository.getDefaultProjectWorkspace()).toThrow(
      'Settings Repository 尚未初始化',
    );
    expect(() => repository.getExternalLibrariesPath()).toThrow(
      'Settings Repository 尚未初始化',
    );
    await expect(
      repository.updateHomePreferences({ viewMode: 'list', sortMode: 'title' }),
    ).rejects.toThrow('Settings Repository 尚未初始化');
    await expect(repository.completeCurrentOnboarding()).rejects.toThrow(
      'Settings Repository 尚未初始化',
    );
    await expect(
      repository.updateDefaultProjectWorkspace(directory),
    ).rejects.toThrow('Settings Repository 尚未初始化');
    await expect(
      repository.updateExternalLibrariesPath(directory),
    ).rejects.toThrow('Settings Repository 尚未初始化');
  });

  it('uses defaults without creating a file when settings do not exist', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);

    await repository.initialize();

    expect(repository.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(repository.getDefaultProjectWorkspace()).toBe(
      join(directory, 'config'),
    );
    expect(repository.getExternalLibrariesPath()).toBe(
      join(directory, 'config'),
    );
    expect(repository.getAppSetup()).toMatchObject({
      completedOnboardingVersion: 0,
      requiresOnboarding: true,
    });
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
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      schemaVersion: 1,
      home: {
        viewMode: 'list',
        sortMode: 'oldest',
      },
      defaultProjectWorkspace: join(directory, 'config'),
      externalLibrariesPath: join(directory, 'config'),
      completedOnboardingVersion: 0,
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
    [
      'invalid onboarding version',
      JSON.stringify({
        schemaVersion: 1,
        home: {
          viewMode: 'grid',
          sortMode: 'newest',
        },
        completedOnboardingVersion: -1,
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
      `${JSON.stringify(
        {
          ...updated,
          defaultProjectWorkspace: join(directory, 'config'),
          externalLibrariesPath: join(directory, 'config'),
          completedOnboardingVersion: 0,
        },
        null,
        2,
      )}\n`,
    );

    const restoredRepository = new JsonSettingsRepository(settingsFile);
    await restoredRepository.initialize();
    expect(restoredRepository.get()).toEqual(updated);
  });

  it('persists the default Project Workspace without exposing it as renderer preferences', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    const defaultProjectWorkspace = join(
      directory,
      'Documents',
      'Learning Companion',
      'Projects',
    );
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    await repository.updateDefaultProjectWorkspace(
      defaultProjectWorkspace,
    );

    expect(repository.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(repository.getDefaultProjectWorkspace()).toBe(
      defaultProjectWorkspace,
    );
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      ...DEFAULT_APP_PREFERENCES,
      defaultProjectWorkspace,
      externalLibrariesPath: join(directory, 'config'),
      completedOnboardingVersion: 0,
    });

    const restoredRepository = new JsonSettingsRepository(settingsFile);
    await restoredRepository.initialize();
    expect(restoredRepository.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(restoredRepository.getDefaultProjectWorkspace()).toBe(
      defaultProjectWorkspace,
    );
  });

  it('persists a custom external libraries path', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    const externalLibrariesPath = join(
      directory,
      'External Disk',
      'Learning Companion',
      'externalLib',
    );
    const repository = new JsonSettingsRepository(settingsFile, {
      defaultExternalLibrariesPath: join(
        directory,
        'Documents',
        'Learning Companion',
        'externalLib',
      ),
    });
    await repository.initialize();

    await repository.updateExternalLibrariesPath(externalLibrariesPath);

    expect(repository.getExternalLibrariesPath()).toBe(
      externalLibrariesPath,
    );
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      ...DEFAULT_APP_PREFERENCES,
      defaultProjectWorkspace: join(directory, 'config'),
      externalLibrariesPath,
      completedOnboardingVersion: 0,
    });

    const restoredRepository = new JsonSettingsRepository(settingsFile);
    await restoredRepository.initialize();
    expect(restoredRepository.getExternalLibrariesPath()).toBe(
      externalLibrariesPath,
    );
  });

  it('completes the current onboarding version without losing other settings', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();
    await repository.updateHomePreferences({
      viewMode: 'list',
      sortMode: 'title',
    });

    const completed = await repository.completeCurrentOnboarding();

    expect(completed).toEqual({
      currentOnboardingVersion: 1,
      completedOnboardingVersion: 1,
      requiresOnboarding: false,
    });
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      schemaVersion: 1,
      home: {
        viewMode: 'list',
        sortMode: 'title',
      },
      defaultProjectWorkspace: join(directory, 'config'),
      externalLibrariesPath: join(directory, 'config'),
      completedOnboardingVersion: 1,
    });

    const restoredRepository = new JsonSettingsRepository(settingsFile);
    await restoredRepository.initialize();
    expect(restoredRepository.getAppSetup()).toEqual(completed);
  });

  it('does not lower an onboarding version written by a newer app', async () => {
    const directory = await createTemporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    await writeFile(
      settingsFile,
      JSON.stringify({
        ...DEFAULT_APP_PREFERENCES,
        defaultProjectWorkspace: directory,
        externalLibrariesPath: directory,
        completedOnboardingVersion: 2,
      }),
      'utf8',
    );
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    const completed = await repository.completeCurrentOnboarding();

    expect(completed).toMatchObject({
      completedOnboardingVersion: 2,
      requiresOnboarding: false,
    });
    expect(
      JSON.parse(await readFile(settingsFile, 'utf8'))
        .completedOnboardingVersion,
    ).toBe(2);
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
    await expect(repository.completeCurrentOnboarding()).rejects.toBeDefined();
    expect(repository.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(repository.getAppSetup()).toMatchObject({
      completedOnboardingVersion: 0,
      requiresOnboarding: true,
    });
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
    const defaultProjectWorkspace = join(directory, 'projects');
    const directoryUpdate =
      repository.updateDefaultProjectWorkspace(defaultProjectWorkspace);
    const externalLibrariesPath = join(directory, 'external-libraries');
    const externalLibrariesUpdate =
      repository.updateExternalLibrariesPath(externalLibrariesPath);

    await Promise.all([
      firstUpdate,
      secondUpdate,
      directoryUpdate,
      externalLibrariesUpdate,
    ]);

    expect(repository.get()).toEqual({
      schemaVersion: 1,
      home: {
        viewMode: 'grid',
        sortMode: 'title',
      },
    });
    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      ...repository.get(),
      defaultProjectWorkspace,
      externalLibrariesPath,
      completedOnboardingVersion: 0,
    });
  });
});
