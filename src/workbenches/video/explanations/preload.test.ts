import { describe, expect, it, vi } from 'vitest';

import { createVideoFrameRegionTarget } from '../shared';
import { createVideoExplanationPreloadApi } from './preload';

describe('video explanation preload API', () => {
  it('uses fixed channels and ignores malformed incoming events', async () => {
    let eventHandler: ((_event: unknown, value: unknown) => void) | undefined;
    const removeListener = vi.fn();
    const ipcRenderer = {
      on: vi.fn((_channel, handler) => {
        eventHandler = handler;
      }),
      removeListener,
    } as never;
    const invoke = vi.fn(async () => []);
    const api = createVideoExplanationPreloadApi(ipcRenderer, invoke as never);
    const request = {
      projectId: 'project-1',
      assetId: 'asset-1',
      sourceRevision: 'revision-1',
    };

    await api.listVideoExplanations(request);
    expect(invoke).toHaveBeenCalledWith('video-explanation:list', request);

    const listener = vi.fn();
    const remove = api.onVideoExplanationChanged(listener);
    eventHandler?.({}, { type: 'changed', explanation: { id: 'invalid' } });
    expect(listener).not.toHaveBeenCalled();

    eventHandler?.({}, {
      type: 'changed',
      explanation: {
        kind: 'task',
        id: 'task-1',
        projectId: 'project-1',
        assetId: 'asset-1',
        target: createVideoFrameRegionTarget({
          timeSeconds: 1,
          x: 0,
          y: 0,
          width: 0.5,
          height: 0.5,
          sourceWidth: 100,
          sourceHeight: 100,
        }),
        sourceRevision: 'revision-1',
        question: '解释这里',
        status: 'pending',
        createdTime: 1,
        updatedTime: 1,
      },
    });
    expect(listener).toHaveBeenCalledOnce();
    remove();
    expect(removeListener).toHaveBeenCalledWith(
      'video-explanation:changed',
      eventHandler,
    );
  });
});
