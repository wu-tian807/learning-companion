import { useStore } from 'zustand';
import { createStore, type StoreApi } from 'zustand/vanilla';

import {
  cloneExternalLibrarySnapshot,
  isExternalLibrarySnapshot,
  type ExternalLibraryMigrationConflictResolution,
  type ExternalLibraryMigrationResult,
  type ExternalLibrarySnapshot,
} from '../../shared/external-libraries';
import { userMessageFromError } from '../../shared/ipc-error';

export type ExternalLibraryTransitionSource =
  | 'event'
  | 'operation'
  | 'initial';

export interface ExternalLibraryTransition {
  readonly previous?: ExternalLibrarySnapshot;
  readonly next: ExternalLibrarySnapshot;
  readonly source: ExternalLibraryTransitionSource;
}

export type ExternalLibraryTransitionListener = (
  transition: ExternalLibraryTransition,
) => void;

export interface ExternalLibraryRendererState {
  readonly librariesById: ReadonlyMap<string, ExternalLibrarySnapshot>;
  readonly initialized: boolean;
  readonly loading: boolean;
  readonly loadError?: string;
  readonly requestPendingById: ReadonlySet<string>;
  readonly migrationPending: boolean;
  connect(listener?: ExternalLibraryTransitionListener): () => void;
  reload(): Promise<void>;
  refreshLibrary(libraryId: string): Promise<ExternalLibrarySnapshot>;
  startInstallation(libraryId: string): Promise<ExternalLibrarySnapshot>;
  cancelInstallation(libraryId: string): Promise<void>;
  removeLibrary(libraryId: string): Promise<ExternalLibrarySnapshot>;
  selectDirectory(): Promise<string | undefined>;
  migrateLibraries(
    targetPath: string,
    conflictResolution?: ExternalLibraryMigrationConflictResolution,
  ): Promise<ExternalLibraryMigrationResult>;
}

export type ExternalLibraryStore =
  StoreApi<ExternalLibraryRendererState>;

export interface ExternalLibraryStoreInitialState {
  readonly librariesById?: ReadonlyMap<
    string,
    ExternalLibrarySnapshot
  >;
  readonly initialized?: boolean;
  readonly loading?: boolean;
  readonly loadError?: string;
  readonly requestPendingById?: ReadonlySet<string>;
  readonly migrationPending?: boolean;
}

export interface ExternalLibraryRendererApi {
  listExternalLibraries(): Promise<ExternalLibrarySnapshot[]>;
  refreshExternalLibrary(request: {
    libraryId: string;
  }): Promise<ExternalLibrarySnapshot>;
  startExternalLibraryInstallation(request: {
    libraryId: string;
  }): Promise<ExternalLibrarySnapshot>;
  cancelExternalLibrary(request: { libraryId: string }): Promise<void>;
  removeExternalLibrary(request: {
    libraryId: string;
  }): Promise<ExternalLibrarySnapshot>;
  selectExternalLibrariesDirectory(): Promise<string | undefined>;
  migrateExternalLibraries(request: {
    targetPath: string;
    conflictResolution?: ExternalLibraryMigrationConflictResolution;
  }): Promise<ExternalLibraryMigrationResult>;
  onExternalLibraryChanged(
    listener: (snapshot: ExternalLibrarySnapshot) => void,
  ): () => void;
}

interface ActiveConnection {
  readonly generation: number;
  readonly disposeSubscription: () => void;
  references: number;
}

const defaultApi: ExternalLibraryRendererApi = {
  listExternalLibraries: () =>
    window.learningCompanion.listExternalLibraries(),
  refreshExternalLibrary: (request) =>
    window.learningCompanion.refreshExternalLibrary(request),
  startExternalLibraryInstallation: (request) =>
    window.learningCompanion.startExternalLibraryInstallation(request),
  cancelExternalLibrary: (request) =>
    window.learningCompanion.cancelExternalLibrary(request),
  removeExternalLibrary: (request) =>
    window.learningCompanion.removeExternalLibrary(request),
  selectExternalLibrariesDirectory: () =>
    window.learningCompanion.selectExternalLibrariesDirectory(),
  migrateExternalLibraries: (request) =>
    window.learningCompanion.migrateExternalLibraries(request),
  onExternalLibraryChanged: (listener) =>
    window.learningCompanion.onExternalLibraryChanged(listener),
};

function requireLibraryId(libraryId: string): string {
  const normalized = libraryId.trim();

  if (normalized.length === 0) {
    throw new Error('External Library ID 不能为空');
  }

  return normalized;
}

function requireSnapshot(value: unknown): ExternalLibrarySnapshot {
  if (!isExternalLibrarySnapshot(value)) {
    throw new Error('外部组件状态响应无效');
  }

  return cloneExternalLibrarySnapshot(value);
}

function requireMigrationResult(
  value: ExternalLibraryMigrationResult,
): ExternalLibraryMigrationResult {
  if (
    (value.status !== 'completed' && value.status !== 'conflict') ||
    !Array.isArray(value.libraries) ||
    !value.libraries.every(isExternalLibrarySnapshot)
  ) {
    throw new Error('外部组件迁移响应无效');
  }

  return value;
}

export function createExternalLibraryStore(
  api: ExternalLibraryRendererApi = defaultApi,
  initialState: ExternalLibraryStoreInitialState = {},
): ExternalLibraryStore {
  const revisions = new Map<string, number>();
  const transitionListeners =
    new Set<ExternalLibraryTransitionListener>();
  let nextRevision = 0;
  let nextConnectionGeneration = 0;
  let activeConnection: ActiveConnection | undefined;

  const emitTransition = (transition: ExternalLibraryTransition) => {
    for (const listener of transitionListeners) {
      try {
        listener(transition);
      } catch (error) {
        console.warn('External Library 状态监听器执行失败', error);
      }
    }
  };

  const applySnapshot = (
    value: unknown,
    source: ExternalLibraryTransitionSource,
  ): ExternalLibrarySnapshot => {
    const snapshot = requireSnapshot(value);
    const previous = store
      .getState()
      .librariesById.get(snapshot.id);
    const nextLibraries = new Map(
      store.getState().librariesById,
    );
    nextLibraries.set(snapshot.id, snapshot);

    if (source !== 'initial') {
      revisions.set(snapshot.id, ++nextRevision);
    }

    store.setState({
      librariesById: nextLibraries,
    });
    emitTransition({
      ...(previous ? { previous } : {}),
      next: snapshot,
      source,
    });

    return snapshot;
  };

  const setRequestPending = (
    libraryId: string,
    pending: boolean,
  ) => {
    const next = new Set(store.getState().requestPendingById);

    if (pending) {
      next.add(libraryId);
    } else {
      next.delete(libraryId);
    }

    store.setState({ requestPendingById: next });
  };

  const runLibraryRequest = async (
    libraryId: string,
    operation: () => Promise<ExternalLibrarySnapshot>,
  ): Promise<ExternalLibrarySnapshot> => {
    const normalizedId = requireLibraryId(libraryId);
    setRequestPending(normalizedId, true);

    try {
      return applySnapshot(await operation(), 'operation');
    } finally {
      setRequestPending(normalizedId, false);
    }
  };

  const load = async (
    connectionGeneration?: number,
  ): Promise<void> => {
    const capturedRevisions = new Map(revisions);
    store.setState({
      loading: true,
      loadError: undefined,
    });

    try {
      const snapshots = await api.listExternalLibraries();

      if (
        !Array.isArray(snapshots) ||
        !snapshots.every(isExternalLibrarySnapshot)
      ) {
        throw new Error('外部组件状态响应无效');
      }
      if (
        connectionGeneration !== undefined &&
        activeConnection?.generation !== connectionGeneration
      ) {
        return;
      }

      for (const snapshot of snapshots) {
        const capturedRevision =
          capturedRevisions.get(snapshot.id) ?? 0;
        const currentRevision = revisions.get(snapshot.id) ?? 0;

        if (currentRevision > capturedRevision) {
          continue;
        }

        applySnapshot(snapshot, 'initial');
      }

      store.setState({
        initialized: true,
        loading: false,
        loadError: undefined,
      });
    } catch (error) {
      if (
        connectionGeneration !== undefined &&
        activeConnection?.generation !== connectionGeneration
      ) {
        return;
      }

      store.setState({
        loading: false,
        loadError:
          userMessageFromError(
            error,
            '无法读取外部组件状态，请重试。',
          ) ?? '无法读取外部组件状态，请重试。',
      });
    }
  };

  const store = createStore<ExternalLibraryRendererState>(() => ({
    librariesById: new Map(initialState.librariesById ?? []),
    initialized: initialState.initialized ?? false,
    loading: initialState.loading ?? false,
    ...(initialState.loadError
      ? { loadError: initialState.loadError }
      : {}),
    requestPendingById: new Set(
      initialState.requestPendingById ?? [],
    ),
    migrationPending: initialState.migrationPending ?? false,

    connect(listener) {
      if (listener) {
        transitionListeners.add(listener);
      }

      if (activeConnection) {
        activeConnection.references += 1;
      } else {
        const generation = ++nextConnectionGeneration;
        const disposeSubscription = api.onExternalLibraryChanged(
          (snapshot) => {
            if (activeConnection?.generation === generation) {
              try {
                applySnapshot(snapshot, 'event');
              } catch (error) {
                store.setState({
                  loadError:
                    userMessageFromError(
                      error,
                      '外部组件状态事件无效，请重试。',
                    ) ?? '外部组件状态事件无效，请重试。',
                });
              }
            }
          },
        );
        activeConnection = {
          generation,
          disposeSubscription,
          references: 1,
        };
        void load(generation);
      }

      let disposed = false;

      return () => {
        if (disposed) {
          return;
        }

        disposed = true;

        if (listener) {
          transitionListeners.delete(listener);
        }
        if (!activeConnection) {
          return;
        }

        activeConnection.references -= 1;

        if (activeConnection.references === 0) {
          activeConnection.disposeSubscription();
          activeConnection = undefined;
          nextConnectionGeneration += 1;
          store.setState({ loading: false });
        }
      };
    },

    reload: () => load(activeConnection?.generation),

    refreshLibrary: (libraryId) =>
      runLibraryRequest(libraryId, () =>
        api.refreshExternalLibrary({
          libraryId: requireLibraryId(libraryId),
        }),
      ),

    startInstallation: (libraryId) =>
      runLibraryRequest(libraryId, () =>
        api.startExternalLibraryInstallation({
          libraryId: requireLibraryId(libraryId),
        }),
      ),

    async cancelInstallation(libraryId) {
      const normalizedId = requireLibraryId(libraryId);
      setRequestPending(normalizedId, true);

      try {
        await api.cancelExternalLibrary({
          libraryId: normalizedId,
        });
      } finally {
        setRequestPending(normalizedId, false);
      }
    },

    removeLibrary: (libraryId) =>
      runLibraryRequest(libraryId, () =>
        api.removeExternalLibrary({
          libraryId: requireLibraryId(libraryId),
        }),
      ),

    selectDirectory: () =>
      api.selectExternalLibrariesDirectory(),

    async migrateLibraries(targetPath, conflictResolution) {
      store.setState({ migrationPending: true });

      try {
        const result = requireMigrationResult(
          await api.migrateExternalLibraries({
            targetPath,
            ...(conflictResolution
              ? { conflictResolution }
              : {}),
          }),
        );

        for (const snapshot of result.libraries) {
          applySnapshot(snapshot, 'operation');
        }

        return result;
      } finally {
        store.setState({ migrationPending: false });
      }
    },
  }));

  return store;
}

export const externalLibraryStore = createExternalLibraryStore();

export function useExternalLibraryStore<Selected>(
  selector: (state: ExternalLibraryRendererState) => Selected,
): Selected {
  return useStore(externalLibraryStore, selector);
}

export function listExternalLibrarySnapshots(
  state: ExternalLibraryRendererState,
): readonly ExternalLibrarySnapshot[] {
  return [...state.librariesById.values()];
}
