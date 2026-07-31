import { describe, expect, it, vi } from 'vitest';

import { createAbsoluteLocalFileContentRef } from '../shared/assets';
import { IPC_CHANNELS } from '../shared/ipc';
import { subscribeAssetEvents } from './asset-events';

describe('Preload Asset Event subscription', () => {
  it('validates events and removes only its own listener', () => {
    let wrappedListener:
      | ((event: unknown, value: unknown) => void)
      | undefined;
    const ipc = {
      on: vi.fn((_channel, listener) => {
        wrappedListener = listener;
        return ipc;
      }),
      removeListener: vi.fn(() => ipc),
    };
    const listener = vi.fn();
    const dispose = subscribeAssetEvents(ipc, listener);
    const event = {
      projectId: 'project',
      asset: {
        id: 'asset',
        projectId: 'project',
        name: '资料',
        mediaType: 'text/plain',
        creationKind: 'imported',
        contentRef: createAbsoluteLocalFileContentRef('/tmp/asset.txt'),
        createdTime: 100,
        updatedTime: 200,
        contentStatus: {
          availability: 'available',
          checkedTime: 300,
        },
      },
    } as const;

    wrappedListener?.({}, event);
    wrappedListener?.({}, {
      ...event,
      projectId: 'another-project',
    });

    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(event);

    dispose();
    expect(ipc.removeListener).toHaveBeenCalledWith(
      IPC_CHANNELS.assetChanged,
      wrappedListener,
    );
  });
});
