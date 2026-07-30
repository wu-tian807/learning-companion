import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

import {
  AssetImportMenu,
  AssetImportSplitButton,
} from './AssetImportSplitButton';

describe('AssetImportSplitButton', () => {
  it('keeps copy import as the only prominent action', () => {
    const markup = renderToStaticMarkup(
      <AssetImportSplitButton
        disabled={false}
        onCopy={vi.fn()}
        onLink={vi.fn()}
      />,
    );

    expect(markup).toContain('添加资料');
    expect(markup).toContain('aria-label="更多添加方式"');
    expect(markup).not.toContain('链接外部文件');
  });

  it('explains the risk next to the external link action', () => {
    const markup = renderToStaticMarkup(
      <AssetImportMenu onLink={vi.fn()} />,
    );

    expect(markup).toContain('链接外部文件');
    expect(markup).toContain('不复制文件，移动原文件后可能失效');
  });
});
