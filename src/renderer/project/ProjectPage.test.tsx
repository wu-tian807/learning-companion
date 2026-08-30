// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectPage } from './ProjectPage';

vi.mock('../conversation/ConversationPanelHost', () => ({
  ConversationPanelHost: () => (
    <div data-testid="project-conversation-panel" />
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
    selectedAsset: undefined,
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
  });
});
