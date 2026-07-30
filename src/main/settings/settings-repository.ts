import type { AppPreferences, HomePreferences } from '../../shared/app-preferences';
import type { AppSetupSnapshot } from '../../shared/app-setup';

export interface SettingsRepository {
  initialize(): Promise<void>;
  get(): AppPreferences;
  updateHomePreferences(home: HomePreferences): Promise<AppPreferences>;
  getAppSetup(): AppSetupSnapshot;
  completeCurrentOnboarding(): Promise<AppSetupSnapshot>;
  getDefaultProjectWorkspace(): string;
  updateDefaultProjectWorkspace(directory: string): Promise<void>;
  getExternalLibrariesPath(): string;
  updateExternalLibrariesPath(directory: string): Promise<void>;
}
