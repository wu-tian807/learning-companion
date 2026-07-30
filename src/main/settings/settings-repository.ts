import type { AppPreferences, HomePreferences } from '../../shared/app-preferences';

export interface SettingsRepository {
  initialize(): Promise<void>;
  get(): AppPreferences;
  updateHomePreferences(home: HomePreferences): Promise<AppPreferences>;
  getDefaultProjectWorkspace(): string;
  updateDefaultProjectWorkspace(directory: string): Promise<void>;
  getExternalLibrariesPath(): string;
  updateExternalLibrariesPath(directory: string): Promise<void>;
}
