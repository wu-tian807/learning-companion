import type { IpcRendererEvent } from 'electron';

import {
  isAgentProviderSetupSnapshot,
  type AgentProviderSetupSnapshot,
} from '../shared/agent-providers';
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

export function subscribeAgentProviderEvents(
  ipc: IpcRendererListenerSource,
  listener: (snapshot: AgentProviderSetupSnapshot) => void,
): () => void {
  const wrappedListener = (
    _event: IpcRendererEvent,
    value: unknown,
  ) => {
    if (isAgentProviderSetupSnapshot(value)) {
      listener(value);
    }
  };

  ipc.on(IPC_CHANNELS.agentProviderChanged, wrappedListener);

  return () => {
    ipc.removeListener(
      IPC_CHANNELS.agentProviderChanged,
      wrappedListener,
    );
  };
}
