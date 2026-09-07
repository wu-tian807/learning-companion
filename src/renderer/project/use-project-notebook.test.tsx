// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import type { ProjectNotebookController } from './use-project-notebook';
import { useProjectNotebook } from './use-project-notebook';

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => { resolve = next; });
  return { promise, resolve };
}

function notebookAsset(projectId: string, id: string): AssetSnapshot {
  return {
    id,
    projectId,
    name: '新建笔记',
    mediaType: 'text/markdown',
    creationKind: 'generated',
    contentRef: {
      kind: 'local-file',
      base: 'project-workspace',
      path: `.learning-companion/assets/generated/${id}.md`,
    },
    contentStatus: { availability: 'available', checkedTime: 1 },
    createdTime: 1,
    updatedTime: 1,
  };
}

function Harness({
  projectId,
  enabled,
  onController,
}: {
  readonly projectId: string;
  readonly enabled: boolean;
  readonly onController: (controller: ProjectNotebookController) => void;
}) {
  onController(useProjectNotebook(projectId, enabled));
  return null;
}

describe('useProjectNotebook', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('coalesces same-frame create requests into one IPC intent', async () => {
    const creating = deferred<AssetSnapshot>();
    const createProjectNotebook = vi.fn(() => creating.promise);
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        getProjectNotebook: vi.fn(async ({ projectId }) => ({ projectId })),
        createProjectNotebook,
      },
    });
    let controller!: ProjectNotebookController;
    await act(async () => {
      root.render(<Harness projectId="a" enabled onController={(next) => { controller = next; }} />);
    });

    let first!: Promise<unknown>;
    let second!: Promise<unknown>;
    act(() => {
      first = controller.create('新建笔记');
      second = controller.create('新建笔记');
    });
    expect(first).toBe(second);
    expect(createProjectNotebook).toHaveBeenCalledOnce();
    creating.resolve(notebookAsset('a', 'note-a'));
    await act(async () => { await first; });
    expect(controller.state).toMatchObject({ kind: 'ready', snapshot: { assetId: 'note-a' } });
  });

  it('does not let an old Project create update the next Project state', async () => {
    const creating = deferred<AssetSnapshot>();
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        getProjectNotebook: vi.fn(async ({ projectId }) => ({ projectId })),
        createProjectNotebook: vi.fn(() => creating.promise),
      },
    });
    let controller!: ProjectNotebookController;
    await act(async () => {
      root.render(<Harness projectId="a" enabled onController={(next) => { controller = next; }} />);
    });
    const oldCreate = controller.create();
    await act(async () => {
      root.render(<Harness projectId="b" enabled onController={(next) => { controller = next; }} />);
    });
    creating.resolve(notebookAsset('a', 'note-a'));
    await act(async () => { await oldCreate; });

    expect(controller.state).not.toMatchObject({
      kind: 'ready',
      snapshot: { projectId: 'a', assetId: 'note-a' },
    });
    expect(controller.creating).toBe(false);
  });

  it('clears create busy after a later note selection invalidates its result', async () => {
    const creating = deferred<AssetSnapshot>();
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        getProjectNotebook: vi.fn(async ({ projectId }) => ({ projectId })),
        createProjectNotebook: vi.fn(() => creating.promise),
        selectProjectNotebookAsset: vi.fn(async ({ projectId, assetId }) => ({
          projectId,
          assetId,
        })),
      },
    });
    let controller!: ProjectNotebookController;
    await act(async () => {
      root.render(<Harness projectId="a" enabled onController={(next) => { controller = next; }} />);
    });
    const create = controller.create();
    await act(async () => { await controller.select('existing-note'); });
    creating.resolve(notebookAsset('a', 'late-note'));
    await act(async () => { await create; });

    expect(controller.creating).toBe(false);
    expect(controller.state).toMatchObject({
      kind: 'ready',
      snapshot: { assetId: 'existing-note' },
    });
  });

  it('does not let a late initial get overwrite a completed create', async () => {
    const initial = deferred<{ projectId: string; assetId?: string }>();
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        getProjectNotebook: vi.fn(() => initial.promise),
        createProjectNotebook: vi.fn(async () => notebookAsset('a', 'note-a')),
      },
    });
    let controller!: ProjectNotebookController;
    await act(async () => {
      root.render(<Harness projectId="a" enabled onController={(next) => { controller = next; }} />);
    });

    await act(async () => { await controller.create(); });
    initial.resolve({ projectId: 'a' });
    await act(async () => { await Promise.resolve(); });

    expect(controller.state).toMatchObject({
      kind: 'ready',
      snapshot: { assetId: 'note-a' },
    });
  });
});
