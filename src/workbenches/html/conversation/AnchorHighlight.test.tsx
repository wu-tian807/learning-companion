import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';

import { AnchorHighlight } from './AnchorHighlight';

describe('AnchorHighlight', () => {
  it('renders nothing when no target is provided', () => {
    const markup = renderToStaticMarkup(
      <AnchorHighlight target={undefined} />,
    );
    expect(markup).toBe('');
  });

  it('renders nothing for a quote anchor (no element id)', () => {
    const markup = renderToStaticMarkup(
      <AnchorHighlight
        target={{ anchorType: 'html.quote', anchorPayload: { exact: 'x' } }}
      />,
    );
    // SSR 无 document，元素探测返回 undefined → 空渲染（客户端才显示）
    expect(markup).toBe('');
  });

  it('renders nothing in SSR even for element anchors', () => {
    const markup = renderToStaticMarkup(
      <AnchorHighlight
        target={{ anchorType: 'html.element', anchorPayload: { id: 'btn' } }}
      />,
    );
    // SSR 下没有 document，组件保持空渲染；红框只在客户端挂载后绘制
    expect(markup).toBe('');
  });
});
