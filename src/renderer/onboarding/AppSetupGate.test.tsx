import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import { AppSetupGate } from './AppSetupGate';

describe('AppSetupGate', () => {
  it('blocks interaction briefly while setup is loading', () => {
    const markup = renderToStaticMarkup(
      <AppSetupGate loading error={null} onRetry={vi.fn()} />,
    );

    expect(markup).toContain('role="status"');
    expect(markup).toContain('正在准备伴学伙伴');
  });

  it('keeps setup read failures retryable', () => {
    const markup = renderToStaticMarkup(
      <AppSetupGate
        loading={false}
        error="设置文件暂时不可用"
        onRetry={vi.fn()}
      />,
    );

    expect(markup).toContain('role="alertdialog"');
    expect(markup).toContain('设置文件暂时不可用');
    expect(markup).toContain('重试');
  });
});
