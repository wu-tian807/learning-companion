import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';

import {
  APP_PREFERENCES_SCHEMA_VERSION,
  DEFAULT_APP_PREFERENCES,
  isAppPreferences,
  type AppPreferences,
  type HomePreferences,
} from '../../shared/app-preferences';
import {
  createAppSetupSnapshot,
  CURRENT_ONBOARDING_VERSION,
  isCompletedOnboardingVersion,
  type AppSetupSnapshot,
} from '../../shared/app-setup';
import type { SettingsRepository } from './settings-repository';

export interface SettingsLogger {
  warn(message: string, error?: unknown): void;
}

interface JsonSettingsRepositoryOptions {
  readonly logger?: SettingsLogger;
  readonly defaultProjectWorkspace?: string;
  readonly defaultExternalLibrariesPath?: string;
}

interface StoredSettingsState {
  readonly preferences: AppPreferences;
  readonly defaultProjectWorkspace: string;
  readonly externalLibrariesPath: string;
  readonly completedOnboardingVersion: number;
}

interface DeserializedSettings {
  readonly state: StoredSettingsState;
  readonly needsMigration: boolean;
}

function clonePreferences(preferences: AppPreferences): AppPreferences {
  return Object.freeze({
    schemaVersion: preferences.schemaVersion,
    home: Object.freeze({
      viewMode: preferences.home.viewMode,
      sortMode: preferences.home.sortMode,
    }),
  });
}

function createStoredSettingsState(
  preferences: AppPreferences,
  defaultProjectWorkspace: string,
  externalLibrariesPath: string,
  completedOnboardingVersion: number,
): StoredSettingsState {
  if (!isCompletedOnboardingVersion(completedOnboardingVersion)) {
    throw new Error('Settings 首次运行引导版本无效');
  }

  return Object.freeze({
    preferences: clonePreferences(preferences),
    defaultProjectWorkspace,
    externalLibrariesPath,
    completedOnboardingVersion,
  });
}

function normalizeDirectory(directory: string): string {
  const value = directory.trim();

  if (value.length === 0 || !isAbsolute(value)) {
    throw new Error('默认 Project 工作区必须是绝对路径');
  }

  return normalize(value);
}

function isFileNotFoundError(error: unknown): boolean {
  return (
    error instanceof Error &&
    'code' in error &&
    (error as NodeJS.ErrnoException).code === 'ENOENT'
  );
}

export class JsonSettingsRepository implements SettingsRepository {
  private readonly settingsFile: string;
  private readonly logger: SettingsLogger;
  private readonly fallbackProjectWorkspace: string;
  private readonly fallbackExternalLibrariesPath: string;
  private state: StoredSettingsState;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(settingsFile: string, options: JsonSettingsRepositoryOptions = {}) {
    this.settingsFile = settingsFile;
    this.logger = options.logger ?? console;
    this.fallbackProjectWorkspace = normalizeDirectory(
      options.defaultProjectWorkspace ?? dirname(settingsFile),
    );
    this.fallbackExternalLibrariesPath = normalizeDirectory(
      options.defaultExternalLibrariesPath ?? dirname(settingsFile),
    );
    this.state = createStoredSettingsState(
      DEFAULT_APP_PREFERENCES,
      this.fallbackProjectWorkspace,
      this.fallbackExternalLibrariesPath,
      0,
    );
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const content = await readFile(this.settingsFile, 'utf8');
      const restored = this.deserialize(content);
      this.state = restored.state;

      if (restored.needsMigration) {
        try {
          await this.persist(this.state);
        } catch (error) {
          this.logger.warn(
            'Settings 路径默认值迁移保存失败，将继续使用内存默认值。',
            error,
          );
        }
      }
    } catch (error) {
      this.state = createStoredSettingsState(
        DEFAULT_APP_PREFERENCES,
        this.fallbackProjectWorkspace,
        this.fallbackExternalLibrariesPath,
        0,
      );

      if (!isFileNotFoundError(error)) {
        this.logger.warn('Settings 读取失败，已恢复默认设置。', error);
      }
    } finally {
      this.initialized = true;
    }
  }

  get(): AppPreferences {
    this.requireInitialized();
    return clonePreferences(this.state.preferences);
  }

  async updateHomePreferences(home: HomePreferences): Promise<AppPreferences> {
    this.requireInitialized();

    const nextPreferences = clonePreferences({
      schemaVersion: APP_PREFERENCES_SCHEMA_VERSION,
      home,
    });
    const writeTask = this.writeQueue.then(async () => {
      const nextState = createStoredSettingsState(
        nextPreferences,
        this.state.defaultProjectWorkspace,
        this.state.externalLibrariesPath,
        this.state.completedOnboardingVersion,
      );
      await this.persist(nextState);
      this.state = nextState;
    });

    this.writeQueue = writeTask.catch(() => undefined);
    await writeTask;

    return clonePreferences(this.state.preferences);
  }

  getAppSetup(): AppSetupSnapshot {
    this.requireInitialized();
    return createAppSetupSnapshot(
      this.state.completedOnboardingVersion,
    );
  }

  async completeCurrentOnboarding(): Promise<AppSetupSnapshot> {
    this.requireInitialized();
    const writeTask = this.writeQueue.then(async () => {
      if (
        this.state.completedOnboardingVersion >=
        CURRENT_ONBOARDING_VERSION
      ) {
        return;
      }

      const nextState = createStoredSettingsState(
        this.state.preferences,
        this.state.defaultProjectWorkspace,
        this.state.externalLibrariesPath,
        CURRENT_ONBOARDING_VERSION,
      );
      await this.persist(nextState);
      this.state = nextState;
    });

    this.writeQueue = writeTask.catch(() => undefined);
    await writeTask;

    return this.getAppSetup();
  }

  getDefaultProjectWorkspace(): string {
    this.requireInitialized();
    return this.state.defaultProjectWorkspace;
  }

  async updateDefaultProjectWorkspace(directory: string): Promise<void> {
    this.requireInitialized();
    const normalizedDirectory = normalizeDirectory(directory);
    const writeTask = this.writeQueue.then(async () => {
      if (this.state.defaultProjectWorkspace === normalizedDirectory) {
        return;
      }

      const nextState = createStoredSettingsState(
        this.state.preferences,
        normalizedDirectory,
        this.state.externalLibrariesPath,
        this.state.completedOnboardingVersion,
      );
      await this.persist(nextState);
      this.state = nextState;
    });

    this.writeQueue = writeTask.catch(() => undefined);
    await writeTask;
  }

  getExternalLibrariesPath(): string {
    this.requireInitialized();
    return this.state.externalLibrariesPath;
  }

  async updateExternalLibrariesPath(directory: string): Promise<void> {
    this.requireInitialized();
    const normalizedDirectory = normalizeDirectory(directory);
    const writeTask = this.writeQueue.then(async () => {
      if (this.state.externalLibrariesPath === normalizedDirectory) {
        return;
      }

      const nextState = createStoredSettingsState(
        this.state.preferences,
        this.state.defaultProjectWorkspace,
        normalizedDirectory,
        this.state.completedOnboardingVersion,
      );
      await this.persist(nextState);
      this.state = nextState;
    });

    this.writeQueue = writeTask.catch(() => undefined);
    await writeTask;
  }

  private serialize(state: StoredSettingsState): string {
    const stored: AppPreferences & {
      readonly defaultProjectWorkspace: string;
      readonly externalLibrariesPath: string;
      readonly completedOnboardingVersion: number;
    } = {
      ...state.preferences,
      defaultProjectWorkspace: state.defaultProjectWorkspace,
      externalLibrariesPath: state.externalLibrariesPath,
      completedOnboardingVersion: state.completedOnboardingVersion,
    };

    return `${JSON.stringify(stored, null, 2)}\n`;
  }

  private deserialize(content: string): DeserializedSettings {
    const value: unknown = JSON.parse(content);

    if (!isAppPreferences(value)) {
      throw new Error('Settings 数据结构或版本无效');
    }

    let defaultProjectWorkspace = this.fallbackProjectWorkspace;
    let externalLibrariesPath = this.fallbackExternalLibrariesPath;
    let completedOnboardingVersion = 0;

    if ('defaultProjectWorkspace' in value) {
      if (typeof value.defaultProjectWorkspace !== 'string') {
        throw new Error('Settings 默认 Project 工作区无效');
      }

      defaultProjectWorkspace = normalizeDirectory(
        value.defaultProjectWorkspace,
      );
    }

    if ('externalLibrariesPath' in value) {
      if (typeof value.externalLibrariesPath !== 'string') {
        throw new Error('Settings 外部运行时目录无效');
      }

      externalLibrariesPath = normalizeDirectory(
        value.externalLibrariesPath,
      );
    }

    if ('completedOnboardingVersion' in value) {
      if (
        !isCompletedOnboardingVersion(
          value.completedOnboardingVersion,
        )
      ) {
        throw new Error('Settings 首次运行引导版本无效');
      }

      completedOnboardingVersion = value.completedOnboardingVersion;
    }

    return {
      state: createStoredSettingsState(
        value,
        defaultProjectWorkspace,
        externalLibrariesPath,
        completedOnboardingVersion,
      ),
      needsMigration:
        !('defaultProjectWorkspace' in value) ||
        !('externalLibrariesPath' in value) ||
        !('completedOnboardingVersion' in value),
    };
  }

  private async persist(state: StoredSettingsState): Promise<void> {
    const configDirectory = dirname(this.settingsFile);
    const temporaryFile = `${this.settingsFile}.tmp`;

    await mkdir(configDirectory, { recursive: true });

    try {
      await writeFile(temporaryFile, this.serialize(state), 'utf8');
      await rename(temporaryFile, this.settingsFile);
    } catch (error) {
      await rm(temporaryFile, { force: true }).catch(() => undefined);
      throw error;
    }
  }

  private requireInitialized(): void {
    if (!this.initialized) {
      throw new Error('Settings Repository 尚未初始化');
    }
  }
}
