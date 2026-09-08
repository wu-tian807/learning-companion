// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectPage } from './ProjectPage';

vi.mock('../generation/GenerationCenter', () => ({
  GenerationCenter: () => <div data-testid="generation-center" />,
}));

vi.mock('../generation/use-generation-tasks', () => ({
  useGenerationTasks: () => ({
    mindMapTasks: [],
    startMindMap: vi.fn(),
    retry: vi.fn(),
    cancel: vi.fn(),
  }),
}));

vi.mock('../workbench/host/AssetWorkbenchHost', () => ({
  AssetWorkbenchHost: () => <div data-testid="workbench" />,
}));

vi.mock('./ProjectAssetPanel', () => ({
  ProjectAssetPanel: () => <div data-testid="assets" />,
}));

vi.mock('./ProjectNotebookPanel', () => ({
  ProjectNotebookPanel: () => <div data-testid="notebook" />,
}));

vi.mock('./use-project-session', () => ({
  useProjectSession: () => ({
    loadState: { kind: 'ready', assets: [{ id: 'asset-html' }] },
    setLoadState: vi.fn(),
    selectedAssetId: 'asset-html',
    selectAsset: vi.fn(),
    retry: vi.fn(),
    handleWorkbenchLifecycleTask: vi.fn(),
    workbenchLifecycleTaskRef: { current: undefined },
  }),
}));

vi.mock('./use-project-assets', () => ({
  useProjectAssets: () => ({
    importedAssetState: { kind: 'ready', assets: [] },
    selectedAsset: { id: 'asset-html' },
    busy: false,
    refreshingAll: false,
    folderState: { kind: 'ready', folders: [] },
    currentFolderPath: undefined,
    selectionCoordinator: {},
    renameTarget: null,
    deleteTargets: null,
    refreshAllAssets: vi.fn(),
  }),
}));

vi.mock('./use-relative-time-now', () => ({
  useRelativeTimeNow: () => 1,
}));

const project = {
  id: 'project-1',
  name: '测试 Project',
  icon: '📘',
  createdTime: 1,
  pinned: false,
  workspacePath: 'D:\\Workspace\\project-1',
  assetCount: 1,
} as const;

describe('ProjectPage conversation composition', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    HTMLElement.prototype.scrollIntoView = vi.fn();
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        listProjectConversations: vi.fn(async () => []),
        saveProjectConversation: vi.fn(async () => []),
        deleteProjectConversation: vi.fn(async () => []),
        startGenerationTask: vi.fn(async () => ({ id: 'task-1' })),
        getGenerationTask: vi.fn(async () => undefined),
        onGenerationTaskChanged: vi.fn(() => () => undefined),
      },
    });
    Object.defineProperty(window, 'matchMedia', {
      configurable: true,
      value: vi.fn((query: string) => ({
        matches: query === '(min-width: 1180px)',
        media: query,
        addEventListener: vi.fn(),
        removeEventListener: vi.fn(),
      })),
    });
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('moves the live chat to the right rail without rebuilding the workbench', async () => {
    await act(async () => {
      root.render(
        <ProjectPage
          project={project}
          onBack={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
      await Promise.resolve();
      await Promise.resolve();
    });

    const workbench = container.querySelector('[data-testid="workbench"]');
    expect(workbench).not.toBeNull();

    const toggle = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 AI 问答"]',
    );
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle!.click();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(toggle?.getAttribute('aria-expanded')).toBe('true');
    expect(
      container.querySelector('[data-project-right-panel]')
        ?.getAttribute('data-project-right-panel'),
    ).toBe('conversation');
    expect(container.querySelector('textarea')).not.toBeNull();
    expect(container.querySelector('[data-testid="workbench"]')).toBe(workbench);

    await act(async () => {
      toggle!.click();
      await Promise.resolve();
    });

    expect(toggle?.getAttribute('aria-expanded')).toBe('false');
    expect(container.querySelector('textarea')).toBeNull();
    expect(container.querySelector('[data-testid="workbench"]')).toBe(workbench);
  });
});
