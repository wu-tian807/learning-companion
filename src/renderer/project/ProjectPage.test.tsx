// @vitest-environment jsdom

import { StrictMode } from 'react';
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createProjectLearningNoteAttachmentHref } from '../../shared/project-learning-notes';
import { ProjectPage } from './ProjectPage';

const projectPageHarness = vi.hoisted(() => ({
  selectAsset: vi.fn(),
  selectAndReveal: vi.fn(async () => undefined),
  workbenchProps: undefined as Record<string, unknown> | undefined,
}));

vi.mock('../conversation/ConversationPanelHost', () => ({
  ConversationPanelHost: ({ selectedAssetId }: { selectedAssetId?: string }) => (
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
  AssetWorkbenchHost: (props: Record<string, unknown>) => {
    projectPageHarness.workbenchProps = props;
    return <div data-testid="workbench" />;
  },
}));

vi.mock('../workbench/host/workbench-target-bridge', () => ({
  selectAndRevealWorkbenchTarget: projectPageHarness.selectAndReveal,
}));

vi.mock('./ProjectAssetPanel', () => ({
  ProjectAssetPanel: () => <div data-testid="assets" />,
}));

vi.mock('./ProjectLearningNotePanel', () => ({
  ProjectLearningNotePanel: ({
    active,
    onRevealReference,
  }: {
    active: boolean;
    onRevealReference: (link: unknown) => Promise<void>;
  }) => (
    <div data-testid="learning-note-panel" data-active={String(active)}>
      <button
        type="button"
        onClick={() => void onRevealReference({
          projectId: 'project-1',
          assetId: 'asset-html',
          attachmentId: 'attachment-1',
        })}
      >
        定位笔记引用
      </button>
    </div>
  ),
}));

vi.mock('./use-project-session', () => ({
  useProjectSession: () => ({
    loadState: { kind: 'ready', assets: [{ id: 'asset-html' }] },
    setLoadState: vi.fn(),
    selectedAssetId: undefined,
    selectAsset: projectPageHarness.selectAsset,
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

describe('ProjectPage Project conversation lifecycle', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
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
        listAttachments: vi.fn(async () => [{
          id: 'attachment-1',
          projectId: 'project-1',
          assetId: 'asset-html',
          typeId: 'ai.annotation',
          typeVersion: 1,
          target: {
            scope: 'content',
            targetType: 'html.range',
            targetVersion: 1,
            targetPayload: { path: 'p:1' },
          },
          metadata: {},
          createdTime: 1,
          updatedTime: 1,
        }]),
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
    projectPageHarness.selectAsset.mockClear();
    projectPageHarness.selectAndReveal.mockClear();
    projectPageHarness.workbenchProps = undefined;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  it('passes persisted learning-note references into the active Workbench', async () => {
    const href = createProjectLearningNoteAttachmentHref({
      projectId: 'project-1',
      assetId: 'asset-html',
      attachmentId: 'attachment-1',
    });
    vi.mocked(
      window.learningCompanion.getProjectLearningNote,
    ).mockResolvedValue({
      projectId: 'project-1',
      markdown: `[资料 · 定位](${href})`,
      revision: 1,
      updatedTime: 1,
    });

    await act(async () => {
      root.render(
        <ProjectPage
          project={project}
          onBack={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });

    expect(projectPageHarness.workbenchProps?.learningNoteReferences).toEqual([
      {
        projectId: 'project-1',
        assetId: 'asset-html',
        attachmentId: 'attachment-1',
      },
    ]);
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
            project={project}
            onBack={vi.fn()}
            onOpenSettings={vi.fn()}
          />
        </StrictMode>,
      );
    });

    const button = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开 AI 问答"]',
    );
    await act(async () => button?.click());

    expect(button?.getAttribute('aria-expanded')).toBe('true');
    expect(
      container.querySelector('[data-testid="project-conversation-panel"]')
        ?.getAttribute('data-selected-asset-id'),
    ).toBe('asset-html');
    expect(
      container.querySelector('[data-testid="generation-center"]')
        ?.parentElement?.getAttribute('aria-hidden'),
    ).toBe('true');

    await act(async () => button?.click());
    expect(button?.getAttribute('aria-expanded')).toBe('false');
  });

  it('opens and collapses the Project learning note from the main action row', async () => {
    await act(async () => {
      root.render(
        <ProjectPage
          project={project}
          onBack={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });

    const openButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="打开学习笔记"]',
    );
    await act(async () => openButton?.click());
    expect(
      container.querySelector('[data-testid="learning-note-panel"]')
        ?.getAttribute('data-active'),
    ).toBe('true');

    const collapseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="收起学习笔记"]',
    );
    await act(async () => collapseButton?.click());
    expect(
      container.querySelector('[data-testid="learning-note-panel"]'),
    ).toBeNull();
  });

  it('routes a learning-note link through Asset selection and Workbench reveal', async () => {
    await act(async () => {
      root.render(
        <ProjectPage
          project={project}
          onBack={vi.fn()}
          onOpenSettings={vi.fn()}
        />,
      );
    });

    const navigate = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '定位笔记引用',
    );
    await act(async () => navigate?.click());

    expect(projectPageHarness.selectAndReveal).toHaveBeenCalledWith(
      expect.objectContaining({
        assetId: 'asset-html',
        target: {
          scope: 'content',
          targetType: 'html.range',
          targetVersion: 1,
          targetPayload: { path: 'p:1' },
        },
        selectAsset: projectPageHarness.selectAsset,
      }),
    );
  });
});
