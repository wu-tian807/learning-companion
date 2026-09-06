// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectPage } from './ProjectPage';

vi.mock('../conversation/ConversationPanelHost', () => ({
  ConversationPanelHost: ({
    selectedAssetId,
  }: {
    selectedAssetId?: string;
  }) => (
    <div
      data-testid="project-conversation-panel"
      data-selected-asset-id={selectedAssetId}
    />
  ),
}));

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

vi.mock('./use-project-session', () => ({
  useProjectSession: () => ({
    loadState: { kind: 'ready', assets: [] },
    setLoadState: vi.fn(),
    selectedAssetId: undefined,
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

describe('ProjectPage Project conversation lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (
      globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }
    ).IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        listProjectConversations: vi.fn(async () => []),
        saveProjectConversation: vi.fn(async () => []),
        deleteProjectConversation: vi.fn(async () => []),
        getProjectLearningNote: vi.fn(async ({ projectId }) => ({
          projectId,
          markdown: '',
          revision: 0,
          updatedTime: null,
        })),
        saveProjectLearningNote: vi.fn(async (request) => ({
          projectId: request.projectId,
          markdown: request.markdown,
          revision: request.expectedRevision + 1,
          updatedTime: 1,
        })),
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

  it('keeps Project chat available after the StrictMode effect replay', async () => {
    await act(async () => {
      root.render(
        <StrictMode>
          <ProjectPage
            project={{
              id: 'project-1',
              name: '测试 Project',
              icon: '📘',
              createdTime: 1,
              pinned: false,
              workspacePath: 'D:\\Workspace\\project-1',
              assetCount: 0,
            }}
            onBack={vi.fn()}
            onOpenSettings={vi.fn()}
          />
        </StrictMode>,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 AI 问答"]',
    );
    expect(button).not.toBeNull();

    await act(async () => button!.click());

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(
      container.querySelector('[data-testid="project-conversation-panel"]'),
    ).not.toBeNull();
    expect(
      container
        .querySelector('[data-testid="generation-center"]')
        ?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');

    expect(
      container
        .querySelector('[data-testid="project-conversation-panel"]')
        ?.getAttribute('data-selected-asset-id'),
    ).toBe('asset-html');

    await act(async () => button!.click());

    expect(button?.getAttribute('aria-expanded')).toBe('false');
    expect(
      container
        .querySelector('[data-testid="project-conversation-panel"]')
        ?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');
    expect(
      container
        .querySelector('[data-testid="generation-center"]')
        ?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('false');
  });

  it('opens and collapses the Project learning note from the main action row', async () => {
    await act(async () => {
      root.render(
        <ProjectPage
          project={{
            id: 'project-1',
            name: '测试 Project',
            icon: '📘',
            createdTime: 1,
            pinned: false,
            workspacePath: 'D:\\Workspace\\project-1',
            assetCount: 0,
          }}
          onBack={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });

    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开学习笔记"]',
    );
    expect(openButton).not.toBeNull();

    await act(async () => openButton!.click());
    expect(
      container.querySelector('textarea[aria-label="Markdown 学习笔记编辑器"]'),
    ).not.toBeNull();

    const collapseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="收起学习笔记"]',
    );
    expect(collapseButton).not.toBeNull();
    await act(async () => collapseButton!.click());
    expect(
      container.querySelector('textarea[aria-label="Markdown 学习笔记编辑器"]'),
    ).toBeNull();
  });
});
