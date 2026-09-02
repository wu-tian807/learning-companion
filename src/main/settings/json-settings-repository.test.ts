import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it, vi } from 'vitest';

import { DEFAULT_APP_PREFERENCES } from '../../shared/app-preferences';
import {
  CURRENT_ONBOARDING_VERSION,
  EXTERNAL_LIBRARY_ONBOARDING_VERSION,
} from '../../shared/app-setup';
import { JsonSettingsRepository } from './json-settings-repository';

const temporaryDirectories: string[] = [];

async function temporaryDirectory(): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'learning-companion-settings-'));
  temporaryDirectories.push(directory);
  return directory;
}

afterEach(async () => {
  await Promise.all(
    temporaryDirectories.splice(0).map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe('JsonSettingsRepository', () => {
  it('requires initialization', async () => {
    const directory = await temporaryDirectory();
    const repository = new JsonSettingsRepository(join(directory, 'settings.json'));

    expect(() => repository.get()).toThrow('尚未初始化');
    expect(() => repository.listAgentProviderConnections()).toThrow('尚未初始化');
    await expect(
      repository.updateAgentProviderSelectorSelection({
        selectorId: 'intelligence-high',
        providerId: 'codex',
        connectionId: 'codex-account',
        modelId: 'gpt-test',
        reasoningEffort: 'medium',
      }),
    ).rejects.toThrow('尚未初始化');
  });

  it('uses defaults without writing a missing settings file', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    expect(repository.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(repository.listAgentProviderConnections()).toEqual([]);
    expect(
      repository.getAgentProviderSelectorSelection('intelligence-high'),
    ).toBeUndefined();
    expect(repository.getDefaultAgentProviderSelectorId()).toBe(
      'intelligence-medium',
    );
    await expect(readFile(settingsFile, 'utf8')).rejects.toMatchObject({
      code: 'ENOENT',
    });
  });

  it('adds missing fields through one normalized migration', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'config', 'settings.json');
    await mkdir(join(directory, 'config'), { recursive: true });
    await writeFile(settingsFile, JSON.stringify(DEFAULT_APP_PREFERENCES), 'utf8');
    const repository = new JsonSettingsRepository(settingsFile);

    await repository.initialize();

    expect(JSON.parse(await readFile(settingsFile, 'utf8'))).toEqual({
      ...DEFAULT_APP_PREFERENCES,
      defaultProjectWorkspace: join(directory, 'config'),
      externalLibrariesPath: join(directory, 'config'),
      completedOnboardingVersion: 0,
      defaultAgentProviderSelectorId: 'intelligence-medium',
      agentProviderSelectorMigrationVersion: 2,
      agentProviderConnections: {},
      agentProviderSelectorSelections: {},
    });
  });

  it('persists global Connection metadata and Selector choices without API keys', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    await repository.updateAgentProviderConnection({
      id: 'codex-api-deepseek',
      providerId: 'codex',
      kind: 'api-key',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    await repository.updateAgentProviderSelectorSelection({
      selectorId: 'intelligence-high',
      providerId: 'codex',
      connectionId: 'codex-api-deepseek',
      modelId: 'deepseek-chat',
      reasoningEffort: 'high',
    });
    await repository.updateDefaultAgentProviderSelectorId('intelligence-high');

    expect(repository.getAgentProviderConnection('codex-api-deepseek')).toEqual({
      id: 'codex-api-deepseek',
      providerId: 'codex',
      kind: 'api-key',
      displayName: 'DeepSeek',
      baseUrl: 'https://api.deepseek.com/v1',
    });
    const content = await readFile(settingsFile, 'utf8');
    expect(content).not.toContain('apiKey');
    expect(content).not.toContain('secret-key');

    const restored = new JsonSettingsRepository(settingsFile);
    await restored.initialize();
    expect(restored.getDefaultAgentProviderSelectorId()).toBe(
      'intelligence-high',
    );
    expect(
      restored.getAgentProviderSelectorSelection(
        'intelligence-high',
      ),
    ).toEqual({
      selectorId: 'intelligence-high',
      providerId: 'codex',
      connectionId: 'codex-api-deepseek',
      modelId: 'deepseek-chat',
      reasoningEffort: 'high',
    });
  });

  it('migrates the per-Connection cache to its active Selector choice', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    await writeFile(
      settingsFile,
      JSON.stringify({
        ...DEFAULT_APP_PREFERENCES,
        defaultProjectWorkspace: directory,
        externalLibrariesPath: directory,
        completedOnboardingVersion: CURRENT_ONBOARDING_VERSION,
        agentProviderConnections: {},
        agentProviderSelectorSelections: {
          'generation-center': {
            'codex-account': {
              selectorId: 'generation-center',
              providerId: 'codex',
              connectionId: 'codex-account',
              modelId: 'old-model',
              reasoningEffort: 'low',
            },
            'codex-api-1': {
              selectorId: 'generation-center',
              providerId: 'codex',
              connectionId: 'codex-api-1',
              modelId: 'active-model',
              reasoningEffort: 'high',
            },
          },
        },
        agentProviderSelectorConnections: {
          'generation-center': {
            providerId: 'codex',
            connectionId: 'codex-api-1',
          },
        },
      }),
      'utf8',
    );

    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    expect(
      repository.getAgentProviderSelectorSelection('intelligence-high'),
    ).toMatchObject({
      connectionId: 'codex-api-1',
      modelId: 'active-model',
      reasoningEffort: 'high',
    });
    const stored = JSON.parse(await readFile(settingsFile, 'utf8'));
    expect(
      stored.agentProviderSelectorSelections['intelligence-high'],
    ).toMatchObject({
      connectionId: 'codex-api-1',
      modelId: 'active-model',
    });
    expect(
      stored.agentProviderSelectorSelections['generation-center'],
    ).toBeUndefined();
    expect(stored.agentProviderSelectorConnections).toBeUndefined();
  });

  it('migrates the former Workbench choice only to medium intelligence', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    await writeFile(
      settingsFile,
      JSON.stringify({
        ...DEFAULT_APP_PREFERENCES,
        defaultProjectWorkspace: directory,
        externalLibrariesPath: directory,
        completedOnboardingVersion: CURRENT_ONBOARDING_VERSION,
        agentProviderConnections: {},
        agentProviderSelectorSelections: {
          workbench: {
            selectorId: 'workbench',
            providerId: 'codex',
            connectionId: 'codex-account',
            modelId: 'configured-model',
            reasoningEffort: 'medium',
          },
        },
      }),
      'utf8',
    );

    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    expect(
      repository.getAgentProviderSelectorSelection('intelligence-medium'),
    ).toEqual({
      selectorId: 'intelligence-medium',
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'configured-model',
      reasoningEffort: 'medium',
    });
    expect(
      repository.getAgentProviderSelectorSelection('intelligence-low'),
    ).toBeUndefined();
    const stored = JSON.parse(await readFile(settingsFile, 'utf8'));
    expect(stored.agentProviderSelectorSelections.workbench).toBeUndefined();
    expect(stored.agentProviderSelectorMigrationVersion).toBe(2);

    const restored = new JsonSettingsRepository(settingsFile);
    await restored.initialize();
    expect(
      restored.getAgentProviderSelectorSelection('intelligence-low'),
    ).toBeUndefined();
  });

  it('repairs the duplicated low-tier choice written by the first intelligence migration', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    const duplicated = {
      providerId: 'codex',
      connectionId: 'codex-account',
      modelId: 'gpt-5.6-sol',
      reasoningEffort: 'high',
    };
    await writeFile(
      settingsFile,
      JSON.stringify({
        ...DEFAULT_APP_PREFERENCES,
        defaultProjectWorkspace: directory,
        externalLibrariesPath: directory,
        completedOnboardingVersion: CURRENT_ONBOARDING_VERSION,
        agentProviderConnections: {},
        agentProviderSelectorSelections: {
          'intelligence-medium': {
            selectorId: 'intelligence-medium',
            ...duplicated,
          },
          'intelligence-low': {
            selectorId: 'intelligence-low',
            ...duplicated,
          },
        },
      }),
      'utf8',
    );

    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    expect(
      repository.getAgentProviderSelectorSelection('intelligence-medium'),
    ).toMatchObject(duplicated);
    expect(
      repository.getAgentProviderSelectorSelection('intelligence-low'),
    ).toBeUndefined();
    expect(
      JSON.parse(await readFile(settingsFile, 'utf8'))
        .agentProviderSelectorMigrationVersion,
    ).toBe(2);
  });

  it('deleting a Connection also clears selectors that reference it', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();
    await repository.updateAgentProviderConnection({
      id: 'codex-api-1',
      providerId: 'codex',
      kind: 'api-key',
      displayName: 'API',
      baseUrl: 'https://example.com/v1',
    });
    await repository.updateAgentProviderSelectorSelection({
      selectorId: 'intelligence-high',
      providerId: 'codex',
      connectionId: 'codex-api-1',
      modelId: 'model',
      reasoningEffort: null,
    });

    await repository.deleteAgentProviderConnection('codex-api-1');

    expect(repository.listAgentProviderConnections()).toEqual([]);
    expect(
      repository.getAgentProviderSelectorSelection('intelligence-high'),
    ).toBeUndefined();

    const warn = vi.fn();
    const restored = new JsonSettingsRepository(settingsFile, {
      logger: { warn },
    });
    await restored.initialize();

    expect(warn).not.toHaveBeenCalled();
    expect(
      restored.getAgentProviderSelectorSelection('intelligence-high'),
    ).toBeUndefined();
  });

  it('serializes concurrent updates in invocation order', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    const repository = new JsonSettingsRepository(settingsFile);
    await repository.initialize();

    await Promise.all([
      repository.updateHomePreferences({ viewMode: 'list', sortMode: 'oldest' }),
      repository.updateHomePreferences({ viewMode: 'grid', sortMode: 'title' }),
      repository.updateDefaultProjectWorkspace(join(directory, 'projects')),
      repository.updateExternalLibrariesPath(join(directory, 'external')),
      repository.updateAgentProviderConnection({
        id: 'codex-api-1',
        providerId: 'codex',
        kind: 'api-key',
        displayName: 'API',
        baseUrl: 'https://example.com/v1',
      }),
    ]);

    const stored = JSON.parse(await readFile(settingsFile, 'utf8'));
    expect(stored.home).toEqual({ viewMode: 'grid', sortMode: 'title' });
    expect(stored.defaultProjectWorkspace).toBe(join(directory, 'projects'));
    expect(stored.agentProviderConnections['codex-api-1']).toBeDefined();
  });

  it('migrates the old single-authentication/consumer format', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    await writeFile(
      settingsFile,
      JSON.stringify({
        ...DEFAULT_APP_PREFERENCES,
        defaultProjectWorkspace: directory,
        externalLibrariesPath: directory,
        completedOnboardingVersion: CURRENT_ONBOARDING_VERSION,
        agentProviderAuthentications: {
          codex: { method: 'api-key', baseUrl: 'https://example.com/v1' },
        },
        agentProviderConsumerSelections: {
          'generation-center': {
            consumerId: 'generation-center',
            providerId: 'codex',
            modelId: 'custom-model',
            reasoningEffort: 'medium',
          },
        },
      }),
      'utf8',
    );
    const repository = new JsonSettingsRepository(settingsFile);

    await repository.initialize();

    expect(repository.getAgentProviderConnection('codex-api-legacy')).toEqual({
      id: 'codex-api-legacy',
      providerId: 'codex',
      kind: 'api-key',
      displayName: '已迁移的 API 连接',
      baseUrl: 'https://example.com/v1',
    });
    expect(
      repository.getAgentProviderSelectorSelection(
        'intelligence-high',
      ),
    ).toMatchObject({
      selectorId: 'intelligence-high',
      connectionId: 'codex-api-legacy',
      modelId: 'custom-model',
    });
    const stored = JSON.parse(await readFile(settingsFile, 'utf8'));
    expect(stored.agentProviderAuthentications).toBeUndefined();
    expect(stored.agentProviderConsumerSelections).toBeUndefined();
  });

  it('keeps both onboarding steps in the unified version field', async () => {
    const directory = await temporaryDirectory();
    const repository = new JsonSettingsRepository(join(directory, 'settings.json'));
    await repository.initialize();

    expect(
      (await repository.completeExternalLibraryOnboarding())
        .completedOnboardingVersion,
    ).toBe(EXTERNAL_LIBRARY_ONBOARDING_VERSION);
    expect(
      (await repository.completeAgentProviderOnboarding())
        .completedOnboardingVersion,
    ).toBe(CURRENT_ONBOARDING_VERSION);
  });

  it('warns and restores defaults for invalid settings', async () => {
    const directory = await temporaryDirectory();
    const settingsFile = join(directory, 'settings.json');
    await writeFile(settingsFile, '{not-json', 'utf8');
    const warn = vi.fn();
    const repository = new JsonSettingsRepository(settingsFile, {
      logger: { warn },
    });

    await repository.initialize();

    expect(repository.get()).toEqual(DEFAULT_APP_PREFERENCES);
    expect(warn).toHaveBeenCalledOnce();
  });
});
