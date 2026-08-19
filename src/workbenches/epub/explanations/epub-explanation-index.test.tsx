// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createEpubCfiRangeTarget } from '../shared';
import { EpubExplanationIndex } from './epub-explanation-index';
import type { EpubExplanationView } from './shared';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const explanations: readonly EpubExplanationView[] = [
  {
    kind: 'attachment',
    id: 'completed-1',
    projectId: 'project-1',
    assetId: 'asset-1',
    target: createEpubCfiRangeTarget({
      cfiRange: 'epubcfi(/6/2!/4/2/1:0,/1:4)',
      quote: {
        exact: '第一段已完成的标注',
        prefix: '',
        suffix: '',
      },
    }),
    status: 'completed',
    answer: '解释',
    createdTime: 1,
    updatedTime: 2,
  },
  {
    kind: 'task',
    id: 'pending-2',
    projectId: 'project-1',
    assetId: 'asset-1',
    target: createEpubCfiRangeTarget({
      cfiRange: 'epubcfi(/6/4!/4/2/1:0,/1:4)',
      quote: {
        exact: '第二段正在生成的标注',
        prefix: '',
        suffix: '',
      },
    }),
    status: 'pending',
    createdTime: 3,
    updatedTime: 3,
  },
];

describe('EpubExplanationIndex', () => {
  let container: HTMLDivElement;
  let root: Root;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.append(container);
    root = createRoot(container);
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
  });

  it('列出所有标注、状态和原文摘要', () => {
    act(() => {
      root.render(
        <EpubExplanationIndex
          explanations={explanations}
          activeExplanationId="completed-1"
          onActivate={vi.fn()}
          onClose={vi.fn()}
        />,
      );
    });

    expect(container.textContent).toContain('2 条·点击定位到原文');
    expect(container.textContent).toContain('第一段已完成的标注');
    expect(container.textContent).toContain('第二段正在生成的标注');
    expect(container.textContent).toContain('已完成');
    expect(container.textContent).toContain('生成中');
    expect(
      container.querySelector('[aria-current="location"]')?.textContent,
    ).toContain('标注 1');
  });

  it('点击索引项时交回完整标注，以便使用 CFI 定位', () => {
    const onActivate = vi.fn();
    act(() => {
      root.render(
        <EpubExplanationIndex
          explanations={explanations}
          onActivate={onActivate}
          onClose={vi.fn()}
        />,
      );
    });

    const buttons = container.querySelectorAll('ol button');
    act(() => buttons[1]?.dispatchEvent(new MouseEvent('click', { bubbles: true })));

    expect(onActivate).toHaveBeenCalledOnce();
    expect(onActivate).toHaveBeenCalledWith(explanations[1]);
  });

  it('没有标注时给出创建入口提示，并且可以关闭索引', () => {
    const onClose = vi.fn();
    act(() => {
      root.render(
        <EpubExplanationIndex
          explanations={[]}
          onActivate={vi.fn()}
          onClose={onClose}
        />,
      );
    });

    expect(container.textContent).toContain('还没有可定位的标注');
    const closeButton = container.querySelector<HTMLButtonElement>(
      'button[aria-label="关闭 EPUB 标注索引"]',
    );
    act(() => closeButton?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
