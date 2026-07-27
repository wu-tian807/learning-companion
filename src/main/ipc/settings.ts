import { ipcMain } from 'electron';

import { IPC_CHANNELS, isUpdateHomePreferencesRequest } from '../../shared/ipc';
import { AppError } from '../errors/app-error';
import type { SettingsRepository } from '../settings/settings-repository';
import { registerIpcHandler } from './register-handler';

export function registerSettingsHandlers(repository: SettingsRepository): void {
  registerIpcHandler(IPC_CHANNELS.getAppPreferences, () => repository.get());

  registerIpcHandler(
    IPC_CHANNELS.updateHomePreferences,
    (_event, request: unknown) => {
      if (!isUpdateHomePreferencesRequest(request)) {
        throw new AppError('INVALID_IPC_REQUEST');
      }

      return repository.updateHomePreferences(request);
    },
  );
}

export function removeSettingsHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.getAppPreferences);
  ipcMain.removeHandler(IPC_CHANNELS.updateHomePreferences);
}
