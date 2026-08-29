import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { ProjectAuxiliaryPanels } from './ProjectAuxiliaryPanels';
import { resolveProjectContentLayout } from './use-project-layout';

function render(input: {
  readonly mode: 'wide' | 'medium' | 'small';
  readonly conversationOpen: boolean;
}) {
  const contentLayout = resolveProjectContentLayout(
    {
      mode: input.mode,
      leftOpen: true,
      rightOpen: true,
    },
    input.conversationOpen,
  );

  return renderToStaticMarkup(
    <ProjectAuxiliaryPanels
      contentLayout={contentLayout}
      conversationActive
      conversationOpen={input.conversationOpen}
      conversationPanel={<div>AI 问答面板</div>}
      generationPanel={<div>生成内容面板</div>}
    />,
  );
}

describe('Project auxiliary panels', () => {
  it('reuses the right rail for AI instead of rendering AI and generation side by side', () => {
    const html = render({ mode: 'wide', conversationOpen: true });

    expect(html).toContain('AI 问答面板');
    expect(html).not.toContain('生成内容面板');
    expect(html).toContain('id="project-ai-question-panel"');
    expect(html).toContain('w-[clamp(320px,28vw,390px)]');
  });

  it('keeps the conversation controller mounted while restoring generation after close', () => {
    const html = render({ mode: 'wide', conversationOpen: false });

    expect(html).toContain('data-project-panel="conversation"');
    expect(html).toContain('class="hidden"');
    expect(html).toContain('生成内容面板');
  });

  it('uses a bottom sheet on small windows so part of the book remains visible', () => {
    const html = render({ mode: 'small', conversationOpen: true });

    expect(html).toContain('absolute inset-x-2 bottom-2');
    expect(html).toContain('h-[min(52%,440px)]');
  });
});
