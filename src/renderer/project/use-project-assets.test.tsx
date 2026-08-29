// @vitest-environment jsdom
import { act, useEffect, useRef, useState } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetFolderState } from '../../shared/asset-folders';
import {
  createAbsoluteLocalFileContentRef,
  type AssetSnapshot,
} from '../../shared/assets';
import type { LearningCompanionApi } from '../../shared/ipc';
import type { AssetLoadState } from './project-asset-view';
import { useProjectAssets } from './use-project-assets';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

function createAsset(id: string): AssetSnapshot {
  return {
    id,
    projectId: 'project',
    name: id,
    mediaType: 'text/plain',
    creationKind: 'imported',
    contentRef: createAbsoluteLocalFileContentRef(`/tmp/${id}.txt`),
    contentStatus: { availability: 'available', checkedTime: 1 },
    createdTime: 1,
    updatedTime: 1,
  };
}

const rootAsset = createAsset('root');
const courseAsset = createAsset('course');
const initialFolders: AssetFolderState = {
  projectId: 'project',
  folders: [{ projectId: 'project', path: '课程' }],
  folderPathByAssetId: { course: '课程' },
};

interface HarnessSnapshot {
  readonly operations: ReturnType<typeof useProjectAssets>;
  readonly selectedAssetId: string | null;
}

function createDeferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise;
  });
  return { promise, resolve };
}

function Harness({ onChange }: { onChange: (value: HarnessSnapshot) => void }) {
  const [loadState, setLoadState] = useState<AssetLoadState>({
    kind: 'ready',
    assets: [rootAsset, courseAsset],
  });
  const [selectedAssetId, selectAsset] = useState<string | null>('root');
  const workbenchLifecycleTaskRef = useRef(Promise.resolve());
  const [setError] = useState(() => vi.fn());
  const operations = useProjectAssets({
    projectId: 'project',
    loadState,
    setLoadState,
    selectedAssetId,
    selectAsset,
    workbenchLifecycleTaskRef,
    setError,
  });

  useEffect(() => onChange({ operations, selectedAssetId }), [
    onChange,
    operations,
    selectedAssetId,
  ]);
  return null;
}

describe('useProjectAssets folder behavior', () => {
  let container: HTMLDivElement;
  let root: Root;
  let api: LearningCompanionApi;
  let current: HarnessSnapshot | undefined;
  const onChange = (value: HarnessSnapshot) => {
    current = value;
  };

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    api = {
      onAssetChanged: vi.fn(() => () => undefined),
      listAssetFolders: vi.fn(async () => initialFolders),
      addLocalAssets: vi.fn(async () => {
        const added = createAsset('added');
        return {
          added: [added],
          failed: [],
          assets: [rootAsset, courseAsset, added],
        };
      }),
      moveAssetsToFolder: vi.fn(async ({ assetIds, folderPath }) => {
        const folderPathByAssetId = {
          ...initialFolders.folderPathByAssetId,
        } as Record<string, string>;
        for (const assetId of assetIds) {
          if (folderPath) folderPathByAssetId[assetId] = folderPath;
          else delete folderPathByAssetId[assetId];
        }
        return { ...initialFolders, folderPathByAssetId };
      }),
    } as unknown as LearningCompanionApi;
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: api,
    });
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    current = undefined;
  });

  async function renderHarness() {
    await act(async () => {
      root.render(<Harness onChange={onChange} />);
    });
    await vi.waitFor(() =>
      expect(current?.operations.folderState).toEqual(initialFolders),
    );
  }

  it('shows direct contents and keeps the open Workbench Asset while navigating', async () => {
    await renderHarness();
    expect(current?.operations.importedAssetState).toMatchObject({
      kind: 'ready',
      assets: [{ id: 'root' }],
    });

    act(() => current?.operations.selectionCoordinator.imported.enter());
    act(() => current?.operations.selectionCoordinator.imported.toggle('root'));
    expect(
      current?.operations.selectionCoordinator.imported.selectedAssetIds,
    ).toEqual(new Set(['root']));

    act(() => current?.operations.openFolder('课程'));

    expect(current?.selectedAssetId).toBe('root');
    expect(current?.operations.selectionCoordinator.imported.active).toBe(false);
    expect(current?.operations.importedAssetState).toMatchObject({
      kind: 'ready',
      assets: [{ id: 'course' }],
    });
  });

  it('imports into the viewed folder and moves Assets without changing the open Asset', async () => {
    await renderHarness();
    act(() => current?.operations.openFolder('课程'));

    await act(async () => {
      await current?.operations.addPaths(['/tmp/added.txt'], 'copy');
    });
    expect(api.addLocalAssets).toHaveBeenCalledWith({
      projectId: 'project',
      paths: ['/tmp/added.txt'],
      mode: 'copy',
      folderPath: '课程',
    });
    expect(current?.selectedAssetId).toBe('added');

    await act(async () => {
      await current?.operations.moveAssets([courseAsset], null);
    });
    expect(api.moveAssetsToFolder).toHaveBeenCalledWith({
      projectId: 'project',
      assetIds: ['course'],
      folderPath: null,
    });
    expect(current?.selectedAssetId).toBe('added');
  });

  it('keeps the newest folder state when refreshes finish out of order', async () => {
    await renderHarness();
    const older = createDeferred<AssetFolderState>();
    const newer = createDeferred<AssetFolderState>();
    const newestState: AssetFolderState = {
      projectId: 'project',
      folders: [
        { projectId: 'project', path: '课程' },
        { projectId: 'project', path: '课程/第二章' },
      ],
      folderPathByAssetId: { course: '课程/第二章' },
    };
    vi.mocked(api.listAssetFolders)
      .mockImplementationOnce(() => older.promise)
      .mockImplementationOnce(() => newer.promise);

    let olderRequest!: Promise<void>;
    let newerRequest!: Promise<void>;
    act(() => {
      olderRequest = current!.operations.loadAssetFolders();
      newerRequest = current!.operations.loadAssetFolders();
    });

    await act(async () => {
      newer.resolve(newestState);
      await newerRequest;
    });
    expect(current?.operations.folderState).toEqual(newestState);

    await act(async () => {
      older.resolve(initialFolders);
      await olderRequest;
    });
    expect(current?.operations.folderState).toEqual(newestState);
  });
});
