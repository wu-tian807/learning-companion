import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { SettingsDialog } from './SettingsDialog';

describe('SettingsDialog', () => {
  it('explains the external runtime storage and trust boundary', () => {
    const markup = renderToStaticMarkup(
      <SettingsDialog onClose={vi.fn()} />,
    );

    expect(markup).toContain('外部组件位置');
    expect(markup).toContain('更换位置');
    expect(markup).toContain('固定 SHA-256');
    expect(markup).toContain('正在读取');
  });
});
