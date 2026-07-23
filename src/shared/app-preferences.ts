export const APP_PREFERENCES_SCHEMA_VERSION = 1 as const;

export type ProjectViewMode = 'grid' | 'list';
export type ProjectSortMode = 'newest' | 'oldest' | 'title';

export interface HomePreferences {
  readonly viewMode: ProjectViewMode;
  readonly sortMode: ProjectSortMode;
}

export interface AppPreferences {
  readonly schemaVersion: typeof APP_PREFERENCES_SCHEMA_VERSION;
  readonly home: HomePreferences;
}

export const DEFAULT_APP_PREFERENCES: AppPreferences = Object.freeze({
  schemaVersion: APP_PREFERENCES_SCHEMA_VERSION,
  home: Object.freeze({
    viewMode: 'grid',
    sortMode: 'newest',
  }),
});

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function isProjectViewMode(value: unknown): value is ProjectViewMode {
  return value === 'grid' || value === 'list';
}

export function isProjectSortMode(value: unknown): value is ProjectSortMode {
  return value === 'newest' || value === 'oldest' || value === 'title';
}

export function isHomePreferences(value: unknown): value is HomePreferences {
  return (
    isRecord(value) &&
    isProjectViewMode(value.viewMode) &&
    isProjectSortMode(value.sortMode)
  );
}

export function isAppPreferences(value: unknown): value is AppPreferences {
  if (!isRecord(value) || value.schemaVersion !== APP_PREFERENCES_SCHEMA_VERSION) {
    return false;
  }

  return isHomePreferences(value.home);
}
