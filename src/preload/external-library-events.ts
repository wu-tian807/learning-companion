import type { IpcRendererEvent } from "electron";

import {
  isExternalLibrarySnapshot,
  type ExternalLibrarySnapshot,
} from "../shared/external-libraries";
import { IPC_CHANNELS } from "../shared/ipc";

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

export function subscribeExternalLibraryEvents(
  ipc: IpcRendererListenerSource,
  listener: (snapshot: ExternalLibrarySnapshot) => void,
): () => void {
  const wrappedListener = (_event: IpcRendererEvent, value: unknown) => {
    if (isExternalLibrarySnapshot(value)) {
      listener(value);
    }
  };

  ipc.on(IPC_CHANNELS.externalLibraryChanged, wrappedListener);

  return () => {
    ipc.removeListener(IPC_CHANNELS.externalLibraryChanged, wrappedListener);
  };
}
