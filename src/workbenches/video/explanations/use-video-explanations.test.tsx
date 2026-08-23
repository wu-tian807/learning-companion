// @vitest-environment jsdom
import { act } from 'react';
import { createRoot, type Root } from 'react-dom/client';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { createVideoFrameRegionTarget } from '../shared';
import type {
  VideoExplanationEvent,
  VideoExplanationView,
} from './shared';
import { useVideoExplanations } from './use-video-explanations';

(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT =
  true;

const target = createVideoFrameRegionTarget({
  timeSeconds: 4,
  x: 0,
  y: 0,
  width: 1,
  height: 1,
  sourceWidth: 1280,
  sourceHeight: 720,
});

function completed(answer: string): VideoExplanationView {
  return {
    kind: 'attachment',
    id: 'explanation-1',
    projectId: 'project-1',
    assetId: 'asset-1',
    target,
    sourceRevision: '100',
    question: '解释画面',
    status: 'completed',
    answer,
    createdTime: 1,
    updatedTime: 1,
  };
}

type HookValue = ReturnType<typeof useVideoExplanations>;
const reportError = vi.fn();
const revealTarget = () => true;

function Harness({ onRender }: { readonly onRender: (value: HookValue) => void }) {
  onRender(
    useVideoExplanations({
      enabled: true,
      projectId: 'project-1',
      assetId: 'asset-1',
      sourceRevision: '100',
      currentTime: 4,
      reportError,
      revealTarget,
    }),
  );
  return null;
}

describe('useVideoExplanations', () => {
  let root: Root;
  let container: HTMLDivElement;
  let originalApi: typeof window.learningCompanion;

  beforeEach(() => {
    container = document.createElement('div');
    document.body.appendChild(container);
    root = createRoot(container);
    originalApi = window.learningCompanion;
  });

  afterEach(() => {
    act(() => root.unmount());
    container.remove();
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: originalApi,
    });
  });

  it('does not let a stale list response overwrite a newer explanation event', async () => {
    let resolveList: ((items: VideoExplanationView[]) => void) | undefined;
    let explanationListener: ((event: VideoExplanationEvent) => void) | undefined;
    const removeExplanations = vi.fn();
    const removeGeneration = vi.fn();
    Object.defineProperty(window, 'learningCompanion', {
      configurable: true,
      value: {
        listVideoExplanations: vi.fn(
          () =>
            new Promise<VideoExplanationView[]>((resolve) => {
              resolveList = resolve;
            }),
        ),
        onVideoExplanationChanged: vi.fn((listener) => {
          explanationListener = listener;
          return removeExplanations;
        }),
        onGenerationTaskChanged: vi.fn(() => removeGeneration),
      } as unknown as typeof window.learningCompanion,
    });
    let latest: HookValue | undefined;

    await act(async () => {
      root.render(<Harness onRender={(value) => (latest = value)} />);
    });
    act(() => {
      explanationListener?.({
        type: 'changed',
        explanation: completed('事件中的新回答'),
      });
    });
    await act(async () => {
      resolveList?.([completed('较早的列表回答')]);
      await Promise.resolve();
    });

    expect(latest?.items).toEqual([
      expect.objectContaining({ answer: '事件中的新回答' }),
    ]);

    act(() => root.unmount());
    root = createRoot(container);
    expect(removeExplanations).toHaveBeenCalledOnce();
    expect(removeGeneration).toHaveBeenCalledOnce();
  });
});
