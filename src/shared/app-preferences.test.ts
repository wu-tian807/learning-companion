import { describe, expect, it } from 'vitest';

import {
  APP_PREFERENCES_SCHEMA_VERSION,
  DEFAULT_APP_PREFERENCES,
  isAppPreferences,
  isHomePreferences,
  type AppPreferences,
} from './app-preferences';

describe('app preferences contract', () => {
  it('provides the default home preferences', () => {
    const preferences: AppPreferences = DEFAULT_APP_PREFERENCES;

    expect(preferences).toEqual({
      schemaVersion: APP_PREFERENCES_SCHEMA_VERSION,
      home: {
        viewMode: 'grid',
        sortMode: 'newest',
      },
    });
    expect(isAppPreferences(preferences)).toBe(true);
  });

  it('accepts every supported home preference', () => {
    expect(
      isHomePreferences({
        viewMode: 'list',
        sortMode: 'title',
      }),
    ).toBe(true);
    expect(
      isAppPreferences({
        schemaVersion: 1,
        home: {
          viewMode: 'list',
          sortMode: 'oldest',
        },
      }),
    ).toBe(true);
    expect(
      isAppPreferences({
        schemaVersion: 1,
        home: {
          viewMode: 'grid',
          sortMode: 'title',
        },
      }),
    ).toBe(true);
  });

  it('rejects unknown versions and malformed home preferences', () => {
    expect(isHomePreferences(null)).toBe(false);
    expect(isHomePreferences({ viewMode: 'grid', sortMode: 'popular' })).toBe(false);
    expect(isAppPreferences(null)).toBe(false);
    expect(isAppPreferences([])).toBe(false);
    expect(isAppPreferences({ schemaVersion: 2, home: DEFAULT_APP_PREFERENCES.home })).toBe(
      false,
    );
    expect(isAppPreferences({ schemaVersion: 1 })).toBe(false);
    expect(
      isAppPreferences({
        schemaVersion: 1,
        home: {
          viewMode: 'compact',
          sortMode: 'newest',
        },
      }),
    ).toBe(false);
    expect(
      isAppPreferences({
        schemaVersion: 1,
        home: {
          viewMode: 'grid',
          sortMode: 'popular',
        },
      }),
    ).toBe(false);
  });
});
