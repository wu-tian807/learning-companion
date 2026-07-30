import { useCallback, useEffect, useRef, useState } from 'react';

import {
  DEFAULT_APP_PREFERENCES,
  isAppPreferences,
  type HomePreferences,
  type ProjectSortMode,
  type ProjectViewMode,
} from '../../shared/app-preferences';

function copyHomePreferences(
  preferences: HomePreferences,
): HomePreferences {
  return {
    viewMode: preferences.viewMode,
    sortMode: preferences.sortMode,
  };
}

export function useHomePreferences() {
  const [homePreferences, setHomePreferences] =
    useState<HomePreferences>(() =>
      copyHomePreferences(DEFAULT_APP_PREFERENCES.home),
    );
  const [settingsError, setSettingsError] =
    useState<string | null>(null);
  const displayedHomePreferencesRef = useRef<HomePreferences>(
    copyHomePreferences(DEFAULT_APP_PREFERENCES.home),
  );
  const confirmedHomePreferencesRef = useRef<HomePreferences>(
    copyHomePreferences(DEFAULT_APP_PREFERENCES.home),
  );
  const preferencesMutationVersionRef = useRef(0);
  const applyHomePreferences = useCallback(
    (preferences: HomePreferences) => {
      const nextPreferences = copyHomePreferences(preferences);
      displayedHomePreferencesRef.current = nextPreferences;
      setHomePreferences(nextPreferences);
    },
    [],
  );

  useEffect(() => {
    let active = true;

    const loadPreferences = async () => {
      try {
        const preferences =
          await window.learningCompanion.getAppPreferences();

        if (!isAppPreferences(preferences)) {
          throw new Error('Settings 响应格式无效');
        }

        if (active && preferencesMutationVersionRef.current === 0) {
          const restoredHome = copyHomePreferences(preferences.home);
          confirmedHomePreferencesRef.current = restoredHome;
          applyHomePreferences(restoredHome);
        }
      } catch (error) {
        console.error('加载 Settings 失败', error);

        if (active && preferencesMutationVersionRef.current === 0) {
          setSettingsError('无法加载界面设置，已使用默认值。');
        }
      }
    };

    void loadPreferences();

    return () => {
      active = false;
    };
  }, [applyHomePreferences]);

  const persistHomePreferences = useCallback(
    async (nextPreferences: HomePreferences) => {
      const mutationVersion =
        preferencesMutationVersionRef.current + 1;
      preferencesMutationVersionRef.current = mutationVersion;
      applyHomePreferences(nextPreferences);
      setSettingsError(null);

      try {
        const preferences =
          await window.learningCompanion.updateHomePreferences(
            nextPreferences,
          );

        if (!isAppPreferences(preferences)) {
          throw new Error('Settings 更新响应格式无效');
        }

        const confirmedHome = copyHomePreferences(preferences.home);
        confirmedHomePreferencesRef.current = confirmedHome;

        if (
          preferencesMutationVersionRef.current === mutationVersion
        ) {
          applyHomePreferences(confirmedHome);
        }
      } catch (error) {
        console.error('保存 Settings 失败', error);

        if (
          preferencesMutationVersionRef.current === mutationVersion
        ) {
          applyHomePreferences(confirmedHomePreferencesRef.current);
          setSettingsError(
            '无法保存界面设置，已恢复上一次选择。',
          );
        }
      }
    },
    [applyHomePreferences],
  );
  const changeViewMode = useCallback(
    (viewMode: ProjectViewMode) => {
      void persistHomePreferences({
        ...displayedHomePreferencesRef.current,
        viewMode,
      });
    },
    [persistHomePreferences],
  );
  const changeSortMode = useCallback(
    (sortMode: ProjectSortMode) => {
      void persistHomePreferences({
        ...displayedHomePreferencesRef.current,
        sortMode,
      });
    },
    [persistHomePreferences],
  );

  return {
    ...homePreferences,
    settingsError,
    clearSettingsError: () => setSettingsError(null),
    changeViewMode,
    changeSortMode,
  };
}
