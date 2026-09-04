// @vitest-environment jsdom

import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { ProjectLearningNotePanel } from './ProjectLearningNotePanel';
import type { ProjectLearningNoteController } from './use-project-learning-note';

function controller(
  changes: Partial<ProjectLearningNoteController> = {},
): ProjectLearningNoteController {
  return {
    loadState: { kind: 'ready' },
    saveState: 'saved',
    markdown: '',
    updatedTime: null,
    maxLength: 1_000_000,
    error: null,
    setMarkdown: vi.fn(),
    flush: vi.fn(async () => undefined),
    retry: vi.fn(async () => undefined),
    ...changes,
  };
}

describe('ProjectLearningNotePanel', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean })
      .IS_REACT_ACT_ENVIRONMENT = true;
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    vi.restoreAllMocks();
  });

  it('edits raw Markdown, flushes on save shortcut and renders a preview', async () => {
    const note = controller({ markdown: '# 跨资料笔记' });
    await act(async () => {
      root.render(
        <ProjectLearningNotePanel controller={note} onClose={vi.fn()} />,
      );
    });
    const editor = container.querySelector<HTMLTextAreaElement>('textarea');
    expect(editor?.value).toBe('# 跨资料笔记');

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

    const previewButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '预览',
    );
    await act(async () => previewButton?.click());
    expect(container.querySelector('h1')?.textContent).toBe('跨资料笔记');
  });

  it('shows load failure and lets the user retry without closing the panel', async () => {
    const retry = vi.fn(async () => undefined);
    const note = controller({
      loadState: { kind: 'error', message: '读取失败' },
      error: '读取失败',
      retry,
    });
    await act(async () => {
      root.render(
        <ProjectLearningNotePanel controller={note} onClose={vi.fn()} />,
      );
    });
    const retryButton = Array.from(container.querySelectorAll('button')).find(
      (button) => button.textContent === '重新读取',
    );
    expect(retryButton).toBeDefined();

    await act(async () => retryButton?.click());
    expect(retry).toHaveBeenCalledOnce();
  });
});
