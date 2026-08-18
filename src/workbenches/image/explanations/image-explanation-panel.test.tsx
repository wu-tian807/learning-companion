// @vitest-environment jsdom
import { act } from 'react';
import { createRoot } from 'react-dom/client';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it, vi } from 'vitest';

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

  it('offers a follow-up only for a completed image explanation', () => {
    const markup = renderToStaticMarkup(
      <ImageExplanationPanel
        explanation={completedExplanation}
        contentUrl="learning-content://resource/token"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onContinueQuestion={vi.fn()}
      />,
    );
    expect(markup).toContain('继续追问');
    expect(markup).toContain('删除解释');
  });

  it('hands a follow-up click back to the image conversation integration', () => {
    const container = document.createElement('div');
    document.body.append(container);
    const root = createRoot(container);
    const onContinueQuestion = vi.fn();
    act(() => root.render(
      <ImageExplanationPanel
        explanation={completedExplanation}
        contentUrl="learning-content://resource/token"
        onClose={vi.fn()}
        onRetry={vi.fn()}
        onDelete={vi.fn()}
        onContinueQuestion={onContinueQuestion}
      />,
    ));
    const button = [...container.querySelectorAll('button')].find(
      (candidate) => candidate.textContent?.includes('继续追问'),
    );
    act(() => button?.click());
    expect(onContinueQuestion).toHaveBeenCalledOnce();
    act(() => root.unmount());
    container.remove();
  });
});
