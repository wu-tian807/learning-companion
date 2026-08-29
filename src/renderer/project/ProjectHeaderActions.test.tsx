// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProjectHeaderActions } from './ProjectHeaderActions';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

describe('ProjectHeaderActions', () => {
  it('always exposes all four icon actions and panel state', () => {
    const markup = renderToStaticMarkup(
      <ProjectHeaderActions
        leftOpen
        rightOpen={false}
        onToggleLeft={vi.fn()}
        onToggleRight={vi.fn()}
        onOpenWorkspace={vi.fn()}
        aiQuestionAvailable
        aiQuestionOpen={false}
        onToggleAiQuestion={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="收起学习资料"');
    expect(markup).toContain('aria-label="展开生成中心"');
    expect(markup).toContain(
      'aria-label="打开 Project 工作区"',
    );
    expect(markup).toContain('aria-label="打开设置"');
    expect(markup).toContain(
      'aria-controls="project-assets-panel"',
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain('aria-label="打开 AI 问答"');
    expect(markup).toContain('data-project-ai-context-actions');
  });

  it('turns the AI question action into a collapse control while the panel is open', () => {
    const markup = renderToStaticMarkup(
      <ProjectHeaderActions
        leftOpen
        rightOpen={false}
        onToggleLeft={vi.fn()}
        onToggleRight={vi.fn()}
        onOpenWorkspace={vi.fn()}
        aiQuestionAvailable
        aiQuestionOpen
        onToggleAiQuestion={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(markup).toContain('aria-label="收起 AI 问答"');
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain(
      'aria-controls="project-ai-question-panel"',
    );
    expect(markup).not.toContain('aria-label="打开 AI 问答"');
  });

  it('uses the same header action to collapse the open AI panel', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onToggleAiQuestion = vi.fn();

    act(() => {
      root.render(
        <ProjectHeaderActions
          leftOpen
          rightOpen={false}
          onToggleLeft={vi.fn()}
          onToggleRight={vi.fn()}
          onOpenWorkspace={vi.fn()}
          aiQuestionAvailable
          aiQuestionOpen
          onToggleAiQuestion={onToggleAiQuestion}
          onOpenSettings={vi.fn()}
        />,
      );
    });
    const collapseButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="收起 AI 问答"]',
    );
    act(() => collapseButton?.click());

    expect(onToggleAiQuestion).toHaveBeenCalledOnce();
    act(() => root.unmount());
    container.remove();
  });
});
