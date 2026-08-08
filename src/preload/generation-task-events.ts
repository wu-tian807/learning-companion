import type { IpcRendererEvent } from 'electron';

import {
  isGenerationTaskEvent,
  type GenerationTaskEvent,
} from '../shared/generation-tasks';
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

export function subscribeGenerationTaskEvents(
  ipc: IpcRendererListenerSource,
  listener: (event: GenerationTaskEvent) => void,
): () => void {
  const wrappedListener = (
    _event: IpcRendererEvent,
    value: unknown,
  ) => {
    if (isGenerationTaskEvent(value)) {
      listener(value);
    }
  };

  ipc.on(IPC_CHANNELS.generationTaskChanged, wrappedListener);

  return () => {
    ipc.removeListener(
      IPC_CHANNELS.generationTaskChanged,
      wrappedListener,
    );
  };
}
