import type { AppPreferences, HomePreferences } from '../../shared/app-preferences';

export interface SettingsRepository {
  initialize(): Promise<void>;
  get(): AppPreferences;
  updateHomePreferences(home: HomePreferences): Promise<AppPreferences>;
}
