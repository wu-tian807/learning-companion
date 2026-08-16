import { describe, expect, it, vi } from 'vitest';

import type {
  ExternalLibraryMigrationResult,
  ExternalLibrarySnapshot,
} from '../../shared/external-libraries';
import {
  createExternalLibraryStore,
  listExternalLibrarySnapshots,
  type ExternalLibraryRendererApi,
} from './external-library-store';

function createSnapshot(
  status: ExternalLibrarySnapshot['status'] = 'not-installed',
  progress?: ExternalLibrarySnapshot['progress'],
): ExternalLibrarySnapshot {
  return {
    id: 'libreoffice',
    displayName: 'LibreOffice',
    description: 'Office preview',
    category: 'document',
    version: '26.2.5',
    expectedSize: 300_000_000,
    rootPath: '/Users/student/Documents/Learning Companion/externalLib',
    status,
    ...(progress ? { progress } : {}),
  };
}

function createDeferred<Value>() {
  let resolvePromise!: (value: Value) => void;
  let rejectPromise!: (reason: unknown) => void;
  const promise = new Promise<Value>((resolve, reject) => {
    resolvePromise = resolve;
    rejectPromise = reject;
  });

  return {
    promise,
    resolve: resolvePromise,
    reject: rejectPromise,
  };
}

function createApi(input?: {
  readonly list?: ExternalLibraryRendererApi['listExternalLibraries'];
  readonly start?: ExternalLibraryRendererApi['startExternalLibraryInstallation'];
  readonly migrate?: ExternalLibraryRendererApi['migrateExternalLibraries'];
}) {
  let listener:
    | ((snapshot: ExternalLibrarySnapshot) => void)
    | undefined;
  const unsubscribe = vi.fn();
  const api = {
    listExternalLibraries:
      input?.list ?? vi.fn(async () => [createSnapshot()]),
    refreshExternalLibrary: vi.fn(async () => createSnapshot()),
    startExternalLibraryInstallation:
      input?.start ??
      vi.fn(async () => createSnapshot('downloading')),
    cancelExternalLibrary: vi.fn(async () => undefined),
    removeExternalLibrary: vi.fn(async () => createSnapshot()),
    selectExternalLibrariesDirectory: vi.fn(
      async () => '/Users/student/External Libraries',
    ),
    migrateExternalLibraries:
      input?.migrate ??
      vi.fn(async ({ targetPath }) => ({
        status: 'completed' as const,
        rootPath: targetPath,
        conflicts: [],
        libraries: [
          {
            ...createSnapshot(),
            rootPath: targetPath,
          },
        ],
      })),
    onExternalLibraryChanged: vi.fn((nextListener) => {
      listener = nextListener;
      return unsubscribe;
    }),
  } satisfies ExternalLibraryRendererApi;

  return {
    api,
    emit(snapshot: ExternalLibrarySnapshot) {
      listener?.(snapshot);
    },
    unsubscribe,
  };
}

describe('ExternalLibraryStore', () => {
  it('subscribes before listing and preserves newer events over a late list', async () => {
    const order: string[] = [];
    const list = createDeferred<ExternalLibrarySnapshot[]>();
    const harness = createApi({
      list: vi.fn(() => {
        order.push('list');
        return list.promise;
      }),
    });
    let eventListener:
      | ((snapshot: ExternalLibrarySnapshot) => void)
      | undefined;
    harness.api.onExternalLibraryChanged.mockImplementation((listener) => {
      order.push('subscribe');
      eventListener = listener;
      return harness.unsubscribe;
    });
    const store = createExternalLibraryStore(harness.api);
    const transitions: string[] = [];
    const disconnect = store.getState().connect((transition) => {
      transitions.push(
        `${transition.source}:${transition.next.status}`,
      );
    });

    expect(order).toEqual(['subscribe', 'list']);
    eventListener?.(
      createSnapshot('downloading', {
        completedBytes: 100,
        totalBytes: 300_000_000,
      }),
    );
    list.resolve([createSnapshot('not-installed')]);
    await vi.waitFor(() =>
      expect(store.getState().initialized).toBe(true),
    );

    expect(listExternalLibrarySnapshots(store.getState())).toMatchObject([
      {
        status: 'downloading',
        progress: { completedBytes: 100 },
      },
    ]);
    expect(transitions).toEqual(['event:downloading']);
    disconnect();
  });

  it('shares one effective subscription across multiple connections', async () => {
    const harness = createApi();
    const store = createExternalLibraryStore(harness.api);

    const disconnectFirst = store.getState().connect();
    const disconnectSecond = store.getState().connect();

    expect(harness.api.onExternalLibraryChanged).toHaveBeenCalledOnce();
    expect(harness.api.listExternalLibraries).toHaveBeenCalledOnce();
    disconnectFirst();
    expect(harness.unsubscribe).not.toHaveBeenCalled();
    disconnectSecond();
    expect(harness.unsubscribe).toHaveBeenCalledOnce();
  });

  it('ignores a list response from a disconnected generation', async () => {
    const list = createDeferred<ExternalLibrarySnapshot[]>();
    const harness = createApi({
      list: vi.fn(() => list.promise),
    });
    const store = createExternalLibraryStore(harness.api);
    const disconnect = store.getState().connect();

    disconnect();
    list.resolve([createSnapshot('available')]);
    await Promise.resolve();
    await Promise.resolve();

    expect(store.getState().initialized).toBe(false);
    expect(store.getState().librariesById.size).toBe(0);
  });

  it('tracks short request admission separately from runtime status', async () => {
    const start =
      createDeferred<ExternalLibrarySnapshot>();
    const harness = createApi({
      start: vi.fn(() => start.promise),
    });
    const store = createExternalLibraryStore(harness.api);

    const request = store
      .getState()
      .startInstallation('libreoffice', 'nvidia');

    expect(
      harness.api.startExternalLibraryInstallation,
    ).toHaveBeenCalledWith({
      libraryId: 'libreoffice',
      variantId: 'nvidia',
    });

    expect(store.getState().requestPendingById.has('libreoffice')).toBe(
      true,
    );
    start.resolve(createSnapshot('downloading'));
    await expect(request).resolves.toMatchObject({
      status: 'downloading',
    });
    expect(store.getState().requestPendingById.has('libreoffice')).toBe(
      false,
    );
    expect(store.getState().librariesById.get('libreoffice')).toMatchObject({
      status: 'downloading',
    });
  });

  it('keeps migration pending until a valid result is merged', async () => {
    const migration =
      createDeferred<ExternalLibraryMigrationResult>();
    const harness = createApi({
      migrate: vi.fn(() => migration.promise),
    });
    const store = createExternalLibraryStore(harness.api);
    const targetPath = '/Users/student/External Libraries';

    const request = store
      .getState()
      .migrateLibraries(targetPath, 'replace-target');

    expect(store.getState().migrationPending).toBe(true);
    migration.resolve({
      status: 'completed',
      rootPath: targetPath,
      conflicts: [],
      libraries: [
        {
          ...createSnapshot(),
          rootPath: targetPath,
        },
      ],
    });
    await expect(request).resolves.toMatchObject({
      status: 'completed',
      rootPath: targetPath,
    });
    expect(store.getState().migrationPending).toBe(false);
    expect(store.getState().librariesById.get('libreoffice')?.rootPath).toBe(
      targetPath,
    );
  });

  it('exposes a retryable load error without marking initialization complete', async () => {
    const harness = createApi({
      list: vi.fn(async () => {
        throw new Error('unavailable');
      }),
    });
    const store = createExternalLibraryStore(harness.api);
    const disconnect = store.getState().connect();

    await vi.waitFor(() =>
      expect(store.getState().loading).toBe(false),
    );

    expect(store.getState().initialized).toBe(false);
    expect(store.getState().loadError).toBe(
      '无法读取外部组件状态，请重试。',
    );
    disconnect();
  });
});
