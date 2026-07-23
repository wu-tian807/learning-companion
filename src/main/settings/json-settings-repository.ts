import { mkdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { dirname } from 'node:path';

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

function clonePreferences(preferences: AppPreferences): AppPreferences {
  return Object.freeze({
    schemaVersion: preferences.schemaVersion,
    home: Object.freeze({
      viewMode: preferences.home.viewMode,
      sortMode: preferences.home.sortMode,
    }),
  });
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
  private preferences = clonePreferences(DEFAULT_APP_PREFERENCES);
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
      this.preferences = this.deserialize(content);
    } catch (error) {
      this.preferences = clonePreferences(DEFAULT_APP_PREFERENCES);

      if (!isFileNotFoundError(error)) {
        this.logger.warn('Settings 读取失败，已恢复默认设置。', error);
      }
    } finally {
      this.initialized = true;
    }
  }

  get(): AppPreferences {
    this.requireInitialized();
    return clonePreferences(this.preferences);
  }

  async updateHomePreferences(home: HomePreferences): Promise<AppPreferences> {
    this.requireInitialized();

    const nextPreferences = clonePreferences({
      schemaVersion: APP_PREFERENCES_SCHEMA_VERSION,
      home,
    });
    const writeTask = this.writeQueue.then(async () => {
      await this.persist(nextPreferences);
      this.preferences = nextPreferences;
    });

    this.writeQueue = writeTask.catch(() => undefined);
    await writeTask;

    return clonePreferences(this.preferences);
  }

  private serialize(preferences: AppPreferences): string {
    return `${JSON.stringify(preferences, null, 2)}\n`;
  }

  private deserialize(content: string): AppPreferences {
    const value: unknown = JSON.parse(content);

    if (!isAppPreferences(value)) {
      throw new Error('Settings 数据结构或版本无效');
    }

    return clonePreferences(value);
  }

  private async persist(preferences: AppPreferences): Promise<void> {
    const configDirectory = dirname(this.settingsFile);
    const temporaryFile = `${this.settingsFile}.tmp`;

    await mkdir(configDirectory, { recursive: true });

    try {
      await writeFile(temporaryFile, this.serialize(preferences), 'utf8');
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
