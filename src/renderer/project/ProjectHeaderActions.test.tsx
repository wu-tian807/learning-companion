import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProjectHeaderActions } from './ProjectHeaderActions';

describe('ProjectHeaderActions', () => {
  it('always exposes all six Project actions and the shared right-slot state', () => {
    const markup = renderToStaticMarkup(
      <ProjectHeaderActions
        leftOpen
        rightPanel={null}
        conversationOpen={false}
        onToggleLeft={vi.fn()}
        onToggleGeneration={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onToggleAiQuestion={vi.fn()}
        onToggleLearningNote={vi.fn()}
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
    expect(markup).toContain(
      'aria-controls="project-right-panel"',
    );
    expect(markup).toContain('aria-expanded="true"');
    expect(markup).toContain('role="tooltip"');
    expect(markup).toContain('peer-focus-visible:opacity-100');
    expect(markup).not.toContain('group-focus-within:opacity-100');
    expect(markup).toContain('aria-label="打开 AI 问答"');
    expect(markup).toContain('aria-label="打开学习笔记"');
    expect(markup).not.toContain('data-project-ai-context-actions');
  });

  it('marks the learning note as the selected shared right-slot view', () => {
    const markup = renderToStaticMarkup(
      <ProjectHeaderActions
        leftOpen
        rightPanel="learning-note"
        conversationOpen={false}
        onToggleLeft={vi.fn()}
        onToggleGeneration={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onToggleAiQuestion={vi.fn()}
        onToggleLearningNote={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    const noteButton = markup.match(
      /<button[^>]*aria-label="收起学习笔记"[^>]*>/u,
    )?.[0];

    expect(noteButton).toContain('aria-expanded="true"');
    expect(markup).toContain('aria-label="打开 AI 问答"');
    expect(markup).toContain('aria-label="展开生成中心"');
  });

  it('keeps the global Project chat button enabled without a Workbench conversation', () => {
    const markup = renderToStaticMarkup(
      <ProjectHeaderActions
        leftOpen
        rightPanel={null}
        conversationOpen={false}
        onToggleLeft={vi.fn()}
        onToggleGeneration={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onToggleAiQuestion={vi.fn()}
        onToggleLearningNote={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    const chatButton = markup.match(
      /<button[^>]*aria-label="打开 AI 问答"[^>]*>/u,
    )?.[0];

    expect(chatButton).toBeDefined();
    expect(chatButton).not.toContain('disabled=""');
    expect(chatButton).toContain('aria-expanded="false"');
  });

  it('shows chat and generation as mutually exclusive right-panel views', () => {
    const markup = renderToStaticMarkup(
      <ProjectHeaderActions
        leftOpen
        rightPanel="conversation"
        conversationOpen
        onToggleLeft={vi.fn()}
        onToggleGeneration={vi.fn()}
        onOpenWorkspace={vi.fn()}
        onToggleAiQuestion={vi.fn()}
        onToggleLearningNote={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );
    const chatButton = markup.match(
      /<button[^>]*aria-label="关闭 AI 问答"[^>]*>/u,
    )?.[0];
    const generationButton = markup.match(
      /<button[^>]*aria-label="展开生成中心"[^>]*>/u,
    )?.[0];

    expect(chatButton).toContain('aria-expanded="true"');
    expect(generationButton).toContain('aria-expanded="false"');
  });
});
