import { ipcMain } from 'electron';

import { IPC_CHANNELS, isUpdateHomePreferencesRequest } from '../../shared/ipc';
import type { SettingsRepository } from '../settings/settings-repository';

export function registerSettingsHandlers(repository: SettingsRepository): void {
  ipcMain.handle(IPC_CHANNELS.getAppPreferences, () => repository.get());

  ipcMain.handle(IPC_CHANNELS.updateHomePreferences, (_event, request: unknown) => {
    if (!isUpdateHomePreferencesRequest(request)) {
      throw new Error('Settings 更新请求无效');
    }

    return repository.updateHomePreferences(request);
  });
}

export function removeSettingsHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.getAppPreferences);
  ipcMain.removeHandler(IPC_CHANNELS.updateHomePreferences);
}
