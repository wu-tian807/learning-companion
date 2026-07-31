import type { IpcRendererEvent } from 'electron';

import {
  isAssetChangedEvent,
  type AssetChangedEvent,
} from '../shared/assets';
import { IPC_CHANNELS } from '../shared/ipc';

interface IpcRendererListenerSource {
  on(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): unknown;
  removeListener(
    channel: string,
    listener: (event: IpcRendererEvent, ...args: unknown[]) => void,
  ): unknown;
}

export function subscribeAssetEvents(
  ipc: IpcRendererListenerSource,
  listener: (event: AssetChangedEvent) => void,
): () => void {
  const wrappedListener = (
    _event: IpcRendererEvent,
    value: unknown,
  ) => {
    if (isAssetChangedEvent(value)) {
      listener(value);
    }
  };

  ipc.on(IPC_CHANNELS.assetChanged, wrappedListener);

  return () => {
    ipc.removeListener(IPC_CHANNELS.assetChanged, wrappedListener);
  };
}
