import { BrowserWindow, ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isAgentProviderIdRequest,
  isCancelAgentProviderLoginRequest,
} from '../../shared/ipc';
import type { AgentProviderServiceApi } from '../agents/agent-provider-service';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

let removeSubscription: (() => void) | undefined;

export interface AgentProviderHandlerDependencies {
  readonly broadcast: (channel: string, value: unknown) => void;
}

const defaultDependencies: AgentProviderHandlerDependencies = {
  broadcast(channel, value) {
    for (const window of BrowserWindow.getAllWindows()) {
      if (!window.isDestroyed()) {
        window.webContents.send(channel, value);
      }
    }
  },
};

export function registerAgentProviderHandlers(
  service: AgentProviderServiceApi,
  dependencies: AgentProviderHandlerDependencies =
    defaultDependencies,
): void {
  removeSubscription?.();
  removeSubscription = service.subscribe((snapshot) => {
    dependencies.broadcast(
      IPC_CHANNELS.agentProviderChanged,
      snapshot,
    );
  });

  registerIpcHandler(
    IPC_CHANNELS.getAgentProviderSetup,
    () => service.getSetup(),
  );
  registerIpcHandler(
    IPC_CHANNELS.refreshAgentProvider,
    (_event, request: unknown) => {
      if (!isAgentProviderIdRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }

      return service.refreshProvider(request.providerId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.startAgentProviderLogin,
    (_event, request: unknown) => {
      if (!isAgentProviderIdRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }

      return service.startLogin(request.providerId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.cancelAgentProviderLogin,
    (_event, request: unknown) => {
      if (!isCancelAgentProviderLoginRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }

      return service.cancelLogin(request.providerId, request.loginId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.selectAgentProvider,
    (_event, request: unknown) => {
      if (!isAgentProviderIdRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }

      return service.selectProvider(request.providerId);
    },
  );
}

export function removeAgentProviderHandlers(): void {
  removeSubscription?.();
  removeSubscription = undefined;
  ipcMain.removeHandler(IPC_CHANNELS.getAgentProviderSetup);
  ipcMain.removeHandler(IPC_CHANNELS.refreshAgentProvider);
  ipcMain.removeHandler(IPC_CHANNELS.startAgentProviderLogin);
  ipcMain.removeHandler(IPC_CHANNELS.cancelAgentProviderLogin);
  ipcMain.removeHandler(IPC_CHANNELS.selectAgentProvider);
}
