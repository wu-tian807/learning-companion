// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AssetSnapshot } from '../../shared/assets';
import { parseProjectLearningNoteTargetHref } from '../../shared/project-learning-notes';
import type { MarkdownEditorAdapter } from '../../workbenches/markdown/markdown-editor-adapter';
import { ProjectLearningNotePanel } from './ProjectLearningNotePanel';
import type { ProjectLearningNoteController } from './use-project-learning-note';

const harness = vi.hoisted(() => ({
  editor: {
    insertMarkdown: vi.fn(),
    focus: vi.fn(),
  },
  editorOptions: undefined as
    | {
        onAdapterChange?: (adapter: MarkdownEditorAdapter | undefined) => void;
        onOpenInternalLink?: (href: string) => void;
      }
    | undefined,
  context: {
    projectId: 'project-1',
    assetId: 'asset-epub',
    workbenchId: 'builtin.epub',
    sessionId: 'session-1',
    focus: {
      scope: 'content' as const,
      targetType: 'epub.cfi-range',
      targetVersion: 1,
      targetPayload: { cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:4)' },
    },
    inputs: [],
  },
}));

vi.mock('../../workbenches/markdown/use-markdown-visual-editor', () => ({
  useMarkdownVisualEditor: (options: typeof harness.editorOptions) => {
    harness.editorOptions = options;
    options?.onAdapterChange?.(
      harness.editor as unknown as MarkdownEditorAdapter,
    );
    return { hostRef: { current: null }, state: 'ready' };
  },
}));

vi.mock('../workbench/runtime/workbench-runtime-context', () => ({
  useWorkbenchRuntime: () => ({
    interactionContext: () => harness.context,
  }),
}));

vi.mock('../workbench/host/workbench-target-bridge', () => ({
  getWorkbenchTargetSourceRevision: () => 'revision-1',
}));

function controller(
  changes: Partial<ProjectLearningNoteController> = {},
): ProjectLearningNoteController {
  return {
    loadState: { kind: 'ready' },
    saveState: 'saved',
    markdown: '# 跨资料笔记',
    updatedTime: null,
    maxLength: 1_000_000,
    error: null,
    setMarkdown: vi.fn(),
    flush: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    ...changes,
  };
}

const asset: AssetSnapshot = {
  id: 'asset-epub',
  projectId: 'project-1',
  name: '机器学习 [教材]',
  mediaType: 'application/epub+zip',
  creationKind: 'imported',
  contentRef: { kind: 'local-file', base: 'absolute', path: 'D:\\book.epub' },
  contentStatus: { availability: 'available', checkedTime: 1 },
  createdTime: 1,
  updatedTime: 1,
};

describe('ProjectLearningNotePanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: { openExternal: vi.fn(async () => undefined) },
    });
    harness.editor.insertMarkdown.mockClear();
    harness.editor.focus.mockClear();
    harness.editorOptions = undefined;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('mounts the shared Markdown visual editor and flushes on save shortcut', async () => {
    const note = controller();
    await act(async () => {
      root.render(
        <ProjectLearningNotePanel
          active
          projectId="project-1"
          selectedAsset={asset}
          controller={note}
          onRevealTarget={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });

    expect(harness.editorOptions).toMatchObject({
      enabled: true,
      initialValue: '# 跨资料笔记',
    });
    expect(container.querySelector('textarea')).toBeNull();
    const editor = container.querySelector('[aria-label="Markdown 学习笔记编辑器"]');
    act(() => {
      editor?.dispatchEvent(
        new KeyboardEvent('keydown', {
          key: 's',
          ctrlKey: true,
          bubbles: true,
        }),
      );
    });
    expect(note.flush).toHaveBeenCalledOnce();
  });

  it('inserts a versioned current-position AssetTarget link into Markdown', async () => {
    await act(async () => {
      root.render(
        <ProjectLearningNotePanel
          active
          projectId="project-1"
          selectedAsset={asset}
          controller={controller()}
          onRevealTarget={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });

    const button = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('引用当前位置'),
    );
    await act(async () => button?.click());

    expect(harness.editor.insertMarkdown).toHaveBeenCalledOnce();
    const markdown = harness.editor.insertMarkdown.mock.calls[0]?.[0] as string;
    expect(markdown).toContain('机器学习 \\[教材\\] · 定位原文');
    const href = markdown.match(/\((#[^)]+)\)$/u)?.[1];
    expect(href).toBeDefined();
    expect(parseProjectLearningNoteTargetHref(href!)).toEqual({
      projectId: 'project-1',
      assetId: 'asset-epub',
      sourceRevision: 'revision-1',
      target: harness.context.focus,
    });
  });

  it('routes a persisted internal link to the Project target navigator', async () => {
    const onRevealTarget = vi.fn(async () => undefined);
    await act(async () => {
      root.render(
        <ProjectLearningNotePanel
          active
          projectId="project-1"
          selectedAsset={asset}
          controller={controller()}
          onRevealTarget={onRevealTarget}
          onClose={vi.fn()}
        />,
      );
    });
    const markdown = harness.editor.insertMarkdown;
    const createButton = Array.from(container.querySelectorAll('button')).find(
      (candidate) => candidate.textContent?.includes('引用当前位置'),
    );
    await act(async () => createButton?.click());
    const href = (markdown.mock.calls[0]?.[0] as string).match(
      /\((#[^)]+)\)$/u,
    )?.[1];

    await act(async () => harness.editorOptions?.onOpenInternalLink?.(href!));

    expect(onRevealTarget).toHaveBeenCalledWith({
      projectId: 'project-1',
      assetId: 'asset-epub',
      sourceRevision: 'revision-1',
      target: harness.context.focus,
    });
  });

  it('shows load failure and lets the user retry without mounting an editor', async () => {
    const retry = vi.fn(async () => undefined);
    const note = controller({
      loadState: { kind: 'error', message: '读取失败' },
      error: '读取失败',
      retry,
    });
    await act(async () => {
      root.render(
        <ProjectLearningNotePanel
          active
          projectId="project-1"
          selectedAsset={asset}
          controller={note}
          onRevealTarget={vi.fn(async () => undefined)}
          onClose={vi.fn()}
        />,
      );
    });
    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '重新读取',
    );
    expect(retryButton).toBeDefined();
    expect(harness.editorOptions).toMatchObject({ enabled: false });

    await act(async () => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
  });
});
