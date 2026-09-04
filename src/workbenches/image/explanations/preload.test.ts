import { describe, expect, it, vi } from 'vitest';

import { createImageRegionTarget } from '../shared';
import { createImageExplanationPreloadApi } from './preload';

describe('image explanation preload API', () => {
  it('uses fixed channels and rejects malformed incoming events', async () => {
    let eventHandler: ((_event: unknown, value: unknown) => void) | undefined;
    const removeListener = vi.fn();
    const ipcRenderer = {
      on: vi.fn((_channel, handler) => { eventHandler = handler; }),
      removeListener,
    } as never;
    const invoke = vi.fn(async () => []);
    const api = createImageExplanationPreloadApi(ipcRenderer, invoke as never);
    const request = {
      projectId: 'project-1',
      assetId: 'asset-1',
      sourceRevision: 'revision-1',
    };
    await api.listImageExplanations(request);
    expect(invoke).toHaveBeenCalledWith('image-explanation:list', request);
    await api.deleteImageExplanation({
      projectId: request.projectId,
      assetId: request.assetId,
      kind: 'attachment',
      explanationId: 'attachment-1',
    });
    expect(invoke).toHaveBeenCalledWith('image-explanation:delete', {
      projectId: request.projectId, assetId: request.assetId,
      kind: 'attachment', explanationId: 'attachment-1',
    });
    await api.updateImageExplanationMarkerColor({
      projectId: request.projectId,
      assetId: request.assetId,
      explanationId: 'attachment-1',
      sourceRevision: request.sourceRevision,
      markerColor: 'red',
    });
    expect(invoke).toHaveBeenCalledWith(
      'image-explanation:update-marker-color',
      {
        projectId: request.projectId,
        assetId: request.assetId,
        explanationId: 'attachment-1',
        sourceRevision: request.sourceRevision,
        markerColor: 'red',
      },
    );

    const listener = vi.fn();
    const remove = api.onImageExplanationChanged(listener);
    eventHandler?.({}, { type: 'changed', explanation: { id: 'malformed' } });
    expect(listener).not.toHaveBeenCalled();

    eventHandler?.({}, {
      type: 'changed',
      explanation: {
        kind: 'task', id: 'task-1', projectId: 'project-1', assetId: 'asset-1',
        target: createImageRegionTarget({ x: 0, y: 0, width: 0.5, height: 0.5, sourceWidth: 100, sourceHeight: 100 }),
        status: 'pending', createdTime: 1, updatedTime: 1,
      },
    });
    expect(listener).toHaveBeenCalledOnce();
    remove();
    expect(removeListener).toHaveBeenCalledWith('image-explanation:changed', eventHandler);
  });
});
