import type { IpcRenderer } from 'electron';

import {
  isEpubExplanationEvent,
  type EpubExplanationEvent,
} from '../workbenches/epub/explanations/shared';
import { IPC_CHANNELS } from '../shared/ipc';

export function subscribeEpubExplanationEvents(
  ipcRenderer: IpcRenderer,
  listener: (event: EpubExplanationEvent) => void,
): () => void {
  const handler = (_event: Electron.IpcRendererEvent, value: unknown) => {
    if (isEpubExplanationEvent(value)) {
      listener(value);
    }
  };

  ipcRenderer.on(IPC_CHANNELS.epubExplanationChanged, handler);
  return () =>
    ipcRenderer.removeListener(
      IPC_CHANNELS.epubExplanationChanged,
      handler,
    );
}
