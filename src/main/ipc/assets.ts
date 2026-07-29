import { dialog, ipcMain } from 'electron';
import { dirname } from 'node:path';

import {
  IPC_CHANNELS,
  isAddLocalAssetsRequest,
  isAssetIdRequest,
  isProjectLifecycleRequest,
  isRelinkAssetRequest,
  isRenameAssetRequest,
  type AddLocalAssetsResult,
} from '../../shared/ipc';
import type { AssetShellServiceApi } from '../assets/asset-shell-service';
import type { AssetServiceApi } from '../assets/asset-service';
import { AppError, handleAppError } from '../errors/app-error';
import type { SettingsRepository } from '../settings/settings-repository';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerAssetHandlers(
  assetService: AssetServiceApi,
  assetShellService: AssetShellServiceApi,
  settingsRepository: SettingsRepository,
): void {
  registerIpcHandler(IPC_CHANNELS.selectLocalAssetFiles, async () => {
    const defaultPath =
      settingsRepository.getLastLocalAssetDirectory();
    const result = await dialog.showOpenDialog({
      ...(defaultPath ? { defaultPath } : {}),
      properties: ['openFile', 'multiSelections'],
    });

    if (result.canceled || result.filePaths.length === 0) {
      return [];
    }

    try {
      await settingsRepository.updateLastLocalAssetDirectory(
        dirname(result.filePaths[0]!),
      );
    } catch (error) {
      console.warn('文件选择器最近目录保存失败。', error);
    }

    return result.filePaths;
  });

  registerIpcHandler(
    IPC_CHANNELS.addLocalAssets,
    async (_event, request: unknown): Promise<AddLocalAssetsResult> => {
      if (!isAddLocalAssetsRequest(request)) {
        throw invalidRequest();
      }
      if (assetService.getActiveProjectId() !== request.projectId) {
        throw new AppError('PROJECT_CONTEXT_CHANGED');
      }

      const result: AddLocalAssetsResult = {
        added: [],
        failed: [],
        assets: [],
      };

      for (const path of request.paths) {
        try {
          result.added.push(
            await assetService.addLocalFile(request.projectId, path),
          );
        } catch (error) {
          if (
            error instanceof AppError &&
            (error.code === 'PROJECT_CONTEXT_CHANGED' ||
              error.code === 'OPERATION_SUPERSEDED')
          ) {
            throw error;
          }

          const handled = handleAppError(
            `${IPC_CHANNELS.addLocalAssets}:${path}`,
            error,
          );
          result.failed.push({
            path,
            message: handled.message ?? '无法添加该文件，请稍后重试。',
          });
        }
      }

      if (assetService.getActiveProjectId() !== request.projectId) {
        throw new AppError('PROJECT_CONTEXT_CHANGED');
      }
      result.assets.push(...assetService.list());
      return result;
    },
  );

  registerIpcHandler(IPC_CHANNELS.renameAsset, (_event, request: unknown) => {
    if (!isRenameAssetRequest(request)) {
      throw invalidRequest();
    }

    return assetService.update(request.assetId, { name: request.name });
  });

  registerIpcHandler(
    IPC_CHANNELS.relinkAsset,
    async (_event, request: unknown) => {
      if (!isRelinkAssetRequest(request)) {
        throw invalidRequest();
      }

      return assetService.relinkLocalFile(request.assetId, request.path);
    },
  );

  registerIpcHandler(IPC_CHANNELS.deleteAsset, (_event, request: unknown) => {
    if (!isAssetIdRequest(request)) {
      throw invalidRequest();
    }

    assetService.delete(request.assetId);
  });

  registerIpcHandler(
    IPC_CHANNELS.refreshAsset,
    async (_event, request: unknown) => {
      if (!isAssetIdRequest(request)) {
        throw invalidRequest();
      }

      return assetService.refresh(request.assetId);
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.refreshAllAssets,
    async (_event, request: unknown) => {
      if (!isProjectLifecycleRequest(request)) {
        throw invalidRequest();
      }

      if (assetService.getActiveProjectId() !== request.projectId) {
        throw new AppError('PROJECT_CONTEXT_CHANGED');
      }

      return assetService.refreshAll();
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.revealAssetInFolder,
    (_event, request: unknown) => {
      if (!isAssetIdRequest(request)) {
        throw invalidRequest();
      }

      assetShellService.revealInFolder(request.assetId);
    },
  );
}

export function removeAssetHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.selectLocalAssetFiles);
  ipcMain.removeHandler(IPC_CHANNELS.addLocalAssets);
  ipcMain.removeHandler(IPC_CHANNELS.renameAsset);
  ipcMain.removeHandler(IPC_CHANNELS.relinkAsset);
  ipcMain.removeHandler(IPC_CHANNELS.deleteAsset);
  ipcMain.removeHandler(IPC_CHANNELS.refreshAsset);
  ipcMain.removeHandler(IPC_CHANNELS.refreshAllAssets);
  ipcMain.removeHandler(IPC_CHANNELS.revealAssetInFolder);
}
