// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createImageRegionTarget } from '../shared';
import {
  ImageExplanationIndex,
  orderImageExplanations,
  summarizeImageExplanation,
} from './image-explanation-index';
import type { ImageExplanationView } from './shared';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

const explanations: readonly ImageExplanationView[] = [
  {
    kind: 'attachment', id: 'completed-1', projectId: 'project-1', assetId: 'asset-1',
    target: createImageRegionTarget({ x: 0.1, y: 0.2, width: 0.3, height: 0.4, sourceWidth: 1000, sourceHeight: 800 }),
    status: 'completed',
    answer: '# 关键节点\n它连接了上下游内容。这是一段很长的补充说明，用于确认索引不会把整篇解释全部展示出来。索引之外的结尾内容不应出现。',
    createdTime: 1,
    updatedTime: 2,
  },
  {
    kind: 'task', id: 'pending-2', projectId: 'project-1', assetId: 'asset-1',
    target: createImageRegionTarget({ x: 0.5, y: 0.1, width: 0.2, height: 0.25, sourceWidth: 1000, sourceHeight: 800 }),
    status: 'pending', createdTime: 3, updatedTime: 3,
  },
];

describe('ImageExplanationIndex', () => {
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

  it('keeps marker numbers stable by creation time', () => {
    expect(orderImageExplanations([...explanations].reverse()).map((item) => item.id)).toEqual([
      'completed-1',
      'pending-2',
    ]);
  });

  it('keeps only a compact plain-text preview in the index', () => {
    const preview = summarizeImageExplanation(
      '# 重点\n这是一个[很长的解释](https://example.com)，后面还有不应全部进入索引的补充内容。',
      17,
    );
    expect(preview).toBe('重点 这是一个很长的解释，后面还有…');
    expect(preview).not.toContain('https://example.com');
    expect(preview).not.toContain('补充内容');
  });

  it('列出图片标注、状态、位置和解释摘要', () => {
    act(() => root.render(
      <ImageExplanationIndex
        explanations={explanations}
        activeExplanationId="completed-1"
        onActivate={vi.fn()}
        onDelete={vi.fn()}
        onClose={vi.fn()}
      />,
    ));
    expect(container.textContent).toContain('2 条·点击定位到图片区域');
    expect(container.textContent).toContain('左侧 10% · 顶部 20% · 30% × 40%');
    expect(container.textContent).toContain('关键节点');
    expect(container.textContent).not.toContain('索引之外的结尾内容不应出现');
    expect(container.textContent).toContain('生成中');
    expect(container.querySelector('[aria-current="location"]')?.textContent).toContain('标注 1');
  });

  it('定位与删除是两个独立操作', () => {
    const onActivate = vi.fn();
    const onDelete = vi.fn();
    act(() => root.render(
      <ImageExplanationIndex
        explanations={explanations}
        onActivate={onActivate}
        onDelete={onDelete}
        onClose={vi.fn()}
      />,
    ));
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="定位图片标注 2"]')?.click());
    expect(onActivate).toHaveBeenCalledWith(explanations[1]);
    expect(onDelete).not.toHaveBeenCalled();

    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="删除图片标注 1"]')?.click());
    expect(onDelete).toHaveBeenCalledWith(explanations[0]);
    expect(onActivate).toHaveBeenCalledOnce();
  });

  it('空索引提供创建提示并可以关闭', () => {
    const onClose = vi.fn();
    act(() => root.render(
      <ImageExplanationIndex explanations={[]} onActivate={vi.fn()} onDelete={vi.fn()} onClose={onClose} />,
    ));
    expect(container.textContent).toContain('还没有可定位的图片标注');
    act(() => container.querySelector<HTMLButtonElement>('button[aria-label="关闭图片标注索引"]')?.click());
    expect(onClose).toHaveBeenCalledOnce();
  });
});
