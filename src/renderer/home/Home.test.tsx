import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { Home } from './Home';

describe('Home', () => {
  it('keeps the Home shell and default grid loading state', () => {
    const markup = renderToStaticMarkup(
      <Home
        onOpenProject={vi.fn()}
        onOpenSettings={vi.fn()}
      />,
    );

    expect(markup).toContain('伴学伙伴');
    expect(markup).toContain('新建 Project');
    expect(markup).toContain('aria-label="Project 工具栏"');
  });
});
