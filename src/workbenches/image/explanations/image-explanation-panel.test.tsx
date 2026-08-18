// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';
import Vditor from 'vditor';

vi.mock('vditor', () => ({ default: { preview: vi.fn(async () => undefined) } }));

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

import { createImageRegionTarget } from '../shared';
import { ImageExplanationPanel } from './image-explanation-panel';

const explanation = {
  kind: 'task' as const,
  id: 'task-1',
  projectId: 'project-1',
  assetId: 'asset-1',
  target: createImageRegionTarget({
    x: 0.25, y: 0.2, width: 0.5, height: 0.4,
    sourceWidth: 800, sourceHeight: 600,
  }),
  status: 'pending' as const,
  createdTime: 1,
  updatedTime: 1,
};

const completedExplanation = {
  ...explanation,
  kind: 'attachment' as const,
  id: 'attachment-1',
  status: 'completed' as const,
  answer: '完整解释',
};

describe('ImageExplanationPanel', () => {
  it('keeps the selected region visible while streaming the answer', () => {
    const markup = renderToStaticMarkup(
      <ImageExplanationPanel
        explanation={explanation}
        runtime={{ text: '这是选中的结构', phase: 'answering', statusMessage: '正在分析' }}
        contentUrl="learning-content://resource/token"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
      />,
    );
    expect(markup).toContain('兴趣区域在整张图片中的位置');
    expect(markup).toContain('learning-content://resource/token');
    expect(markup).toContain('x="200"');
    expect(markup).toContain('y="120"');
    expect(markup).toContain('这是选中的结构');
    expect(markup).toContain('data-image-explanation-stream-caret');
    expect(markup).toContain('取消生成');
  });

  it('keeps attachment actions inside a container-bounded panel', () => {
    const markup = renderToStaticMarkup(
      <ImageExplanationPanel
        explanation={{
          ...completedExplanation,
          answer: '很长的解释\n\n'.repeat(200),
        }}
        contentUrl="learning-content://resource/token"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onContinueQuestion={vi.fn()}
      />,
    );
    const container = document.createElement('div');
    container.innerHTML = markup;
    const panel = container.querySelector('aside');
    const body = container.querySelector('[data-image-explanation-body]');
    const actions = container.querySelector('[data-image-explanation-actions]');
    expect(panel?.className).toContain('max-h-[calc(100%-2rem)]');
    expect(panel?.className).toContain('flex-col');
    expect(body?.className).toContain('min-h-0');
    expect(actions?.parentElement).toBe(panel);
    expect(actions?.textContent).toContain('继续追问');
    expect(actions?.textContent).toContain('删除解释');
  });

  it('renders common AI LaTeX delimiters as formulas in a saved attachment', async () => {
    vi.mocked(Vditor.preview).mockClear();
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    await act(async () => root.render(
      <ImageExplanationPanel
        explanation={{
          ...completedExplanation,
          answer: '行内 \\(x^2\\)，块级：\\[y=1\\]',
        }}
        contentUrl="learning-content://resource/token"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onContinueQuestion={vi.fn()}
      />,
    ));
    expect(Vditor.preview).toHaveBeenCalledWith(
      expect.any(HTMLDivElement),
      '行内 $x^2$，块级：\n$$\ny=1\n$$\n',
      expect.objectContaining({ mode: 'dark' }),
    );
    act(() => root.unmount());
    container.remove();
  });

  it('hands attachment follow-up and deletion clicks back to the image integration', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onContinueQuestion = vi.fn();
    const onDelete = vi.fn();
    act(() => root.render(
      <ImageExplanationPanel
        explanation={completedExplanation}
        contentUrl="learning-content://resource/token"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onDelete={onDelete}
        onContinueQuestion={onContinueQuestion}
      />,
    ));
    const continueButton = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.includes('继续追问'),
    );
    const deleteButton = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.includes('删除解释'),
    );
    act(() => continueButton?.click());
    act(() => deleteButton?.click());
    expect(onContinueQuestion).toHaveBeenCalledOnce();
    expect(onDelete).toHaveBeenCalledOnce();
    act(() => root.unmount());
    container.remove();
  });
});
