import type { IpcRendererEvent } from 'electron';

import { IPC_CHANNELS } from '../shared/ipc';
import {
  isWorkbenchEvent,
  type WorkbenchEvent,
} from '../shared/workbench/protocol';

interface IpcRendererListenerSource {
  on(
    channel: string,
    listener: (event: IpcRendererEvent, value: unknown) => void,
  ): unknown;
  removeListener(
    channel: string,
    listener: (event: IpcRendererEvent, value: unknown) => void,
  ): unknown;
}

export function subscribeWorkbenchEvents(
  ipc: IpcRendererListenerSource,
  listener: (event: WorkbenchEvent) => void,
): () => void {
  const wrapped = (_event: IpcRendererEvent, value: unknown) => {
    if (isWorkbenchEvent(value)) {
      listener(value);
    }
  };

  ipc.on(IPC_CHANNELS.workbenchEvent, wrapped);
  return () => ipc.removeListener(IPC_CHANNELS.workbenchEvent, wrapped);
}
