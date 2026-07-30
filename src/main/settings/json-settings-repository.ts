import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname, isAbsolute, normalize } from 'node:path';

import {
  APP_PREFERENCES_SCHEMA_VERSION,
  DEFAULT_APP_PREFERENCES,
  isAppPreferences,
  type AppPreferences,
  type HomePreferences,
} from '../../shared/app-preferences';
import type { SettingsRepository } from './settings-repository';

export interface SettingsLogger {
  warn(message: string, error?: unknown): void;
}

interface JsonSettingsRepositoryOptions {
  readonly logger?: SettingsLogger;
  readonly defaultProjectWorkspace?: string;
}

interface StoredSettingsState {
  readonly preferences: AppPreferences;
  readonly defaultProjectWorkspace: string;
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
): StoredSettingsState {
  return Object.freeze({
    preferences: clonePreferences(preferences),
    defaultProjectWorkspace,
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
  private state: StoredSettingsState;
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(settingsFile: string, options: JsonSettingsRepositoryOptions = {}) {
    this.settingsFile = settingsFile;
    this.logger = options.logger ?? console;
    this.fallbackProjectWorkspace = normalizeDirectory(
      options.defaultProjectWorkspace ?? dirname(settingsFile),
    );
    this.state = createStoredSettingsState(
      DEFAULT_APP_PREFERENCES,
      this.fallbackProjectWorkspace,
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
            'Settings 默认 Project 工作区迁移保存失败，将继续使用内存默认值。',
            error,
          );
        }
      }
    } catch (error) {
      this.state = createStoredSettingsState(
        DEFAULT_APP_PREFERENCES,
        this.fallbackProjectWorkspace,
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
      );
      await this.persist(nextState);
      this.state = nextState;
    });

    this.writeQueue = writeTask.catch(() => undefined);
    await writeTask;

    return clonePreferences(this.state.preferences);
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
    } = {
      ...state.preferences,
      defaultProjectWorkspace: state.defaultProjectWorkspace,
    };

    return `${JSON.stringify(stored, null, 2)}\n`;
  }

  private deserialize(content: string): DeserializedSettings {
    const value: unknown = JSON.parse(content);

    if (!isAppPreferences(value)) {
      throw new Error('Settings 数据结构或版本无效');
    }

    let defaultProjectWorkspace = this.fallbackProjectWorkspace;

    if ('defaultProjectWorkspace' in value) {
      if (typeof value.defaultProjectWorkspace !== 'string') {
        throw new Error('Settings 默认 Project 工作区无效');
      }

      defaultProjectWorkspace = normalizeDirectory(
        value.defaultProjectWorkspace,
      );
    }

    return {
      state: createStoredSettingsState(
        value,
        defaultProjectWorkspace,
      ),
      needsMigration: !('defaultProjectWorkspace' in value),
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
