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
}

interface StoredSettingsState {
  readonly preferences: AppPreferences;
  readonly lastLocalAssetDirectory?: string;
}

interface StoredFileDialogSettings {
  readonly lastLocalAssetDirectory?: string;
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
  lastLocalAssetDirectory?: string,
): StoredSettingsState {
  return Object.freeze({
    preferences: clonePreferences(preferences),
    lastLocalAssetDirectory,
  });
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value)
  );
}

function normalizeDirectory(directory: string): string {
  const value = directory.trim();

  if (value.length === 0 || !isAbsolute(value)) {
    throw new Error('文件选择器最近目录必须是绝对路径');
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
  private state = createStoredSettingsState(DEFAULT_APP_PREFERENCES);
  private initialized = false;
  private writeQueue: Promise<void> = Promise.resolve();

  constructor(settingsFile: string, options: JsonSettingsRepositoryOptions = {}) {
    this.settingsFile = settingsFile;
    this.logger = options.logger ?? console;
  }

  async initialize(): Promise<void> {
    if (this.initialized) {
      return;
    }

    try {
      const content = await readFile(this.settingsFile, 'utf8');
      this.state = this.deserialize(content);
    } catch (error) {
      this.state = createStoredSettingsState(DEFAULT_APP_PREFERENCES);

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
        this.state.lastLocalAssetDirectory,
      );
      await this.persist(nextState);
      this.state = nextState;
    });

    this.writeQueue = writeTask.catch(() => undefined);
    await writeTask;

    return clonePreferences(this.state.preferences);
  }

  getLastLocalAssetDirectory(): string | undefined {
    this.requireInitialized();
    return this.state.lastLocalAssetDirectory;
  }

  async updateLastLocalAssetDirectory(directory: string): Promise<void> {
    this.requireInitialized();
    const normalizedDirectory = normalizeDirectory(directory);
    const writeTask = this.writeQueue.then(async () => {
      if (
        this.state.lastLocalAssetDirectory === normalizedDirectory
      ) {
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
      readonly fileDialogs?: StoredFileDialogSettings;
    } = {
      ...state.preferences,
      ...(state.lastLocalAssetDirectory
        ? {
            fileDialogs: {
              lastLocalAssetDirectory:
                state.lastLocalAssetDirectory,
            },
          }
        : {}),
    };

    return `${JSON.stringify(stored, null, 2)}\n`;
  }

  private deserialize(content: string): StoredSettingsState {
    const value: unknown = JSON.parse(content);

    if (!isAppPreferences(value)) {
      throw new Error('Settings 数据结构或版本无效');
    }

    let lastLocalAssetDirectory: string | undefined;

    if ('fileDialogs' in value) {
      if (!isRecord(value.fileDialogs)) {
        throw new Error('Settings 文件选择器数据结构无效');
      }

      const directory = value.fileDialogs.lastLocalAssetDirectory;

      if (directory !== undefined) {
        if (typeof directory !== 'string') {
          throw new Error('Settings 文件选择器最近目录无效');
        }
        lastLocalAssetDirectory = normalizeDirectory(directory);
      }
    }

    return createStoredSettingsState(
      value,
      lastLocalAssetDirectory,
    );
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
