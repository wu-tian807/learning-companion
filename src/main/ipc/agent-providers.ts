import { BrowserWindow, ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isAgentProviderConnectionRequest,
  isAgentProviderIdRequest,
  isAgentProviderSelectorIdRequest,
  isCancelAgentProviderLoginRequest,
  isConfigureAgentProviderApiConnectionRequest,
  isSelectAgentProviderForSelectorRequest,
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
  dependencies: AgentProviderHandlerDependencies = defaultDependencies,
): void {
  removeSubscription?.();
  removeSubscription = service.subscribe((snapshot) => {
    dependencies.broadcast(IPC_CHANNELS.agentProviderChanged, snapshot);
  });

  registerIpcHandler(IPC_CHANNELS.getAgentProviderSetup, () => service.getSetup());
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
      if (!isAgentProviderConnectionRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      return service.startLogin(request.providerId, request.connectionId);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.cancelAgentProviderLogin,
    (_event, request: unknown) => {
      if (!isCancelAgentProviderLoginRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      return service.cancelLogin(
        request.providerId,
        request.connectionId,
        request.loginId,
      );
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.configureAgentProviderApiConnection,
    (_event, request: unknown) => {
      if (!isConfigureAgentProviderApiConnectionRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      return service.configureApiConnection(request);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.deleteAgentProviderConnection,
    (_event, request: unknown) => {
      if (!isAgentProviderConnectionRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      return service.deleteConnection(request.providerId, request.connectionId);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.getAgentProviderModels,
    (_event, request: unknown) => {
      if (!isAgentProviderConnectionRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      return service.getModelCatalog(request.providerId, request.connectionId);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.selectAgentProviderForSelector,
    (_event, request: unknown) => {
      if (!isSelectAgentProviderForSelectorRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      return service.selectForSelector(request);
    },
  );
  registerIpcHandler(
    IPC_CHANNELS.selectDefaultAgentProviderSelector,
    (_event, request: unknown) => {
      if (!isAgentProviderSelectorIdRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }
      return service.selectDefaultSelector(request.selectorId);
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
  ipcMain.removeHandler(IPC_CHANNELS.configureAgentProviderApiConnection);
  ipcMain.removeHandler(IPC_CHANNELS.deleteAgentProviderConnection);
  ipcMain.removeHandler(IPC_CHANNELS.getAgentProviderModels);
  ipcMain.removeHandler(IPC_CHANNELS.selectAgentProviderForSelector);
  ipcMain.removeHandler(IPC_CHANNELS.selectDefaultAgentProviderSelector);
}
