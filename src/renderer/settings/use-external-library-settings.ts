import { useEffect, useMemo, useRef, useState } from 'react';
import { useStore } from 'zustand';

import {
  type ExternalLibraryMigrationConflict,
  type ExternalLibraryMigrationConflictResolution,
  type ExternalLibrarySnapshot,
} from '../../shared/external-libraries';
import { userMessageFromError } from '../../shared/ipc-error';
import type { ExternalLibraryStore } from '../external-libraries/external-library-store';
import { isExternalLibraryActive } from '../external-libraries/external-library-view';
import type { SettingsTarget } from './settings-target';

export interface PendingExternalLibraryInstall {
  readonly library: ExternalLibrarySnapshot;
  readonly expectedSize: number;
}

export function useExternalLibrarySettings(
  store: ExternalLibraryStore,
  target: SettingsTarget | undefined,
) {
  const librariesById = useStore(
    store,
    (state) => state.librariesById,
  );
  const loading = useStore(store, (state) => state.loading);
  const loadError = useStore(store, (state) => state.loadError);
  const requestPendingById = useStore(
    store,
    (state) => state.requestPendingById,
  );
  const migrationPending = useStore(
    store,
    (state) => state.migrationPending,
  );
  const libraries = useMemo(
    () => [...librariesById.values()],
    [librariesById],
  );
  const [error, setError] = useState<string | null>(null);
  const [pendingInstall, setPendingInstall] =
    useState<PendingExternalLibraryInstall | null>(null);
  const [pendingRemove, setPendingRemove] =
    useState<ExternalLibrarySnapshot | null>(null);
  const [migrationTarget, setMigrationTarget] =
    useState<string | null>(null);
  const [migrationConflicts, setMigrationConflicts] = useState<
    readonly ExternalLibraryMigrationConflict[]
  >([]);
  const targetedLibraryRef = useRef<HTMLElement>(null);
  const rootPath = libraries[0]?.rootPath;
  const hasActiveTask = useMemo(
    () =>
      libraries.some(({ status }) =>
        isExternalLibraryActive(status),
      ),
    [libraries],
  );
  const pendingConfirmationRequest =
    (pendingInstall !== null &&
      requestPendingById.has(pendingInstall.library.id)) ||
    (pendingRemove !== null &&
      requestPendingById.has(pendingRemove.id));
  const blockingBusy = migrationPending || pendingConfirmationRequest;

  useEffect(() => {
    if (
      target?.section === 'external-libraries' &&
      target.libraryId &&
      librariesById.has(target.libraryId)
    ) {
      targetedLibraryRef.current?.scrollIntoView({
        block: 'center',
      });
    }
  }, [librariesById, target]);

  const installLibrary = async (
    request: PendingExternalLibraryInstall,
  ) => {
    setError(null);

    try {
      await store.getState().startInstallation(request.library.id);
      setPendingInstall(null);
    } catch (operationError) {
      setError(
        userMessageFromError(
          operationError,
          '外部组件安装请求失败，请重试。',
        ) ?? null,
      );
    }
  };
  const removeLibrary = async (
    library: ExternalLibrarySnapshot,
  ) => {
    setError(null);

    try {
      await store.getState().removeLibrary(library.id);
      setPendingRemove(null);
    } catch (operationError) {
      setError(
        userMessageFromError(
          operationError,
          '无法移除外部组件，请重试。',
        ) ?? null,
      );
    }
  };
  const cancelInstallation = async (
    library: ExternalLibrarySnapshot,
  ) => {
    setError(null);

    try {
      await store.getState().cancelInstallation(library.id);
    } catch (cancelError) {
      setError(
        userMessageFromError(
          cancelError,
          '无法取消外部组件安装，请稍后重试。',
        ) ?? null,
      );
    }
  };
  const migrate = async (
    targetPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ) => {
    setError(null);

    try {
      const result = await store
        .getState()
        .migrateLibraries(targetPath, conflictResolution);

      if (result.status === 'conflict') {
        setMigrationTarget(result.rootPath);
        setMigrationConflicts(result.conflicts);
        return;
      }

      setMigrationTarget(null);
      setMigrationConflicts([]);
    } catch (migrationError) {
      setError(
        userMessageFromError(
          migrationError,
          '外部组件迁移失败，应用仍将使用原位置。',
        ) ?? null,
      );
    }
  };
  const selectMigrationTarget = async () => {
    setError(null);

    try {
      const selected = await store.getState().selectDirectory();

      if (selected) {
        await migrate(selected);
      }
    } catch (selectionError) {
      setError(
        userMessageFromError(
          selectionError,
          '无法选择外部组件存储位置。',
        ) ?? null,
      );
    }
  };

  return {
    libraries,
    librariesById,
    loading,
    loadError,
    requestPendingById,
    migrationPending,
    rootPath,
    hasActiveTask,
    blockingBusy,
    error,
    clearError: () => setError(null),
    pendingInstall,
    setPendingInstall,
    pendingRemove,
    setPendingRemove,
    migrationTarget,
    migrationConflicts,
    targetedLibraryRef,
    cancelMigration: () => {
      setMigrationTarget(null);
      setMigrationConflicts([]);
    },
    installLibrary,
    removeLibrary,
    cancelInstallation,
    migrate,
    selectMigrationTarget,
    reload: () => store.getState().reload(),
  };
}
