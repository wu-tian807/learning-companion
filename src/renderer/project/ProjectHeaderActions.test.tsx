import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { ProjectHeaderActions } from './ProjectHeaderActions';

describe('ProjectHeaderActions', () => {
  it('always exposes all four icon actions and panel state', () => {
    const markup = renderToStaticMarkup(
      <ProjectHeaderActions
        leftOpen
        rightOpen={false}
        onToggleLeft={vi.fn()}
        onToggleRight={vi.fn()}
        onOpenWorkspace={vi.fn()}
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
  });
});
