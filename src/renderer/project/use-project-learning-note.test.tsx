// @vitest-environment jsdom

import { act, useEffect } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ProjectLearningNoteController } from './use-project-learning-note';
import { useProjectLearningNote } from './use-project-learning-note';

function Harness({
  projectId,
  onController,
}: {
  readonly projectId: string;
  readonly onController: (controller: ProjectLearningNoteController) => void;
}) {
  const controller = useProjectLearningNote(projectId);
  useEffect(() => onController(controller), [controller, onController]);
  return <div data-load-state={controller.loadState.kind}>{controller.markdown}</div>;
}

describe('useProjectLearningNote', () => {
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

  it('loads a Project note and serializes successive Markdown saves by revision', async () => {
    const save = vi
      .fn()
      .mockImplementation(async (request: {
        projectId: string;
        markdown: string;
        expectedRevision: number;
      }) => ({
        projectId: request.projectId,
        markdown: request.markdown,
        revision: request.expectedRevision + 1,
        updatedTime: request.expectedRevision + 11,
      }));
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        getProjectLearningNote: vi.fn(async () => ({
          projectId: 'project-1',
          markdown: '# 原笔记',
          revision: 2,
          updatedTime: 10,
        })),
        saveProjectLearningNote: save,
      },
    });
    let controller: ProjectLearningNoteController | undefined;

    await act(async () => {
      root.render(
        <Harness
          projectId="project-1"
          onController={(next) => {
            controller = next;
          }}
        />,
      );
    });
    expect(controller?.markdown).toBe('# 原笔记');

    act(() => controller?.setMarkdown('# 第一次修改'));
    await act(async () => controller?.flush());
    act(() => controller?.setMarkdown('# 第二次修改'));
    await act(async () => controller?.flush());

    expect(save.mock.calls.map(([request]) => request)).toEqual([
      {
        projectId: 'project-1',
        markdown: '# 第一次修改',
        expectedRevision: 2,
      },
      {
        projectId: 'project-1',
        markdown: '# 第二次修改',
        expectedRevision: 3,
      },
    ]);
    expect(controller?.saveState).toBe('saved');
  });
});
