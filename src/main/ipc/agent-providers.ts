import { ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isAgentProviderIdRequest,
  isAgentProviderSetupRequest,
  isCancelAgentProviderLoginRequest,
} from '../../shared/ipc';
import type { AgentProviderServiceApi } from '../agents/agent-provider-service';
import { AppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

export function registerAgentProviderHandlers(
  service: AgentProviderServiceApi,
): void {
  registerIpcHandler(
    IPC_CHANNELS.getAgentProviderSetup,
    (_event, request: unknown) => {
      if (!isAgentProviderSetupRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }

      return service.getSetup(request?.refreshCredentials);
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
  ipcMain.removeHandler(IPC_CHANNELS.getAgentProviderSetup);
  ipcMain.removeHandler(IPC_CHANNELS.startAgentProviderLogin);
  ipcMain.removeHandler(IPC_CHANNELS.cancelAgentProviderLogin);
  ipcMain.removeHandler(IPC_CHANNELS.selectAgentProvider);
}
