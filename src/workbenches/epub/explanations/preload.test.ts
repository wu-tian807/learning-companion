import { describe, expect, it, vi } from 'vitest';

import type { WorkbenchFeatureIpcInvoke } from '../../../preload/workbench-preload-contribution';
import { createEpubCfiRangeTarget } from '../shared';
import { createEpubExplanationPreloadApi } from './preload';
import { EPUB_EXPLANATION_IPC_CHANNELS } from './shared';

describe('EPUB explanation Preload API', () => {
  it('owns invocation channels and validates streamed feature events', async () => {
    let wrappedListener: ((event: unknown, value: unknown) => void) | undefined;
    const ipc = {
      on: vi.fn((_channel, listener) => {
        wrappedListener = listener;
        return ipc;
      }),
      removeListener: vi.fn(() => ipc),
    };
    const invoke = vi.fn(async () => []);
    const api = createEpubExplanationPreloadApi(
      ipc as never,
      invoke as unknown as WorkbenchFeatureIpcInvoke,
    );
    const request = { projectId: 'project-1', assetId: 'asset-1' };

    await api.listEpubExplanations(request);
    await api.updateEpubExplanationMarkerColor({
      ...request,
      explanationId: 'attachment-1',
      markerColor: 'red',
    });

    expect(invoke).toHaveBeenCalledWith(
      EPUB_EXPLANATION_IPC_CHANNELS.list,
      request,
    );
    expect(invoke).toHaveBeenCalledWith(
      EPUB_EXPLANATION_IPC_CHANNELS.updateMarkerColor,
      {
        ...request,
        explanationId: 'attachment-1',
        markerColor: 'red',
      },
    );

    const listener = vi.fn();
    const dispose = api.onEpubExplanationChanged(listener);
    const event = {
      type: 'changed',
      explanation: {
        kind: 'attachment',
        id: 'attachment-1',
        ...request,
        target: createEpubCfiRangeTarget({
          cfiRange: 'epubcfi(/6/2!/4/2,/1:0,/1:4)',
          quote: { exact: '测试', prefix: '', suffix: '' },
        }),
        status: 'completed',
        answer: '解释',
        createdTime: 1,
        updatedTime: 2,
      },
    } as const;

    wrappedListener?.({}, event);
    wrappedListener?.(
      {},
      {
        ...event,
        explanation: { ...event.explanation, assetId: '' },
      },
    );

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);

    dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      EPUB_EXPLANATION_IPC_CHANNELS.changed,
      wrappedListener,
    );
  });
});
