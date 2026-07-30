import { ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isAddLocalAssetsRequest,
  isAssetIdRequest,
  isDeleteAssetsRequest,
  isProjectLifecycleRequest,
  isRelinkAssetRequest,
  isRenameAssetRequest,
  type AddLocalAssetsResult,
  type DeleteAssetsResult,
} from '../../shared/ipc';
import type { AssetServiceApi } from '../assets/asset-service';
import { AppError, handleAppError } from '../errors/app-error';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function registerAssetHandlers(
  assetService: AssetServiceApi,
): void {
  registerIpcHandler(
    IPC_CHANNELS.selectLocalAssetFiles,
    async (_event, request: unknown) => {
      if (!isProjectLifecycleRequest(request)) {
        throw invalidRequest();
      }

      return assetService.selectLocalFiles(request.projectId);
    },
  );

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
            await assetService.addLocalFile(
              request.projectId,
              path,
              request.mode,
            ),
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

  registerIpcHandler(
    IPC_CHANNELS.deleteAssets,
    async (_event, request: unknown): Promise<DeleteAssetsResult> => {
      if (!isDeleteAssetsRequest(request)) {
        throw invalidRequest();
      }
      if (assetService.getActiveProjectId() !== request.projectId) {
        throw new AppError('PROJECT_CONTEXT_CHANGED');
      }

      const result: DeleteAssetsResult = {
        deletedAssetIds: [],
        failed: [],
        assets: [],
      };

      for (const assetId of request.assetIds) {
        try {
          await assetService.delete(assetId);
          result.deletedAssetIds.push(assetId);
        } catch (error) {
          if (
            error instanceof AppError &&
            (error.code === 'PROJECT_CONTEXT_CHANGED' ||
              error.code === 'OPERATION_SUPERSEDED')
          ) {
            throw error;
          }

          const handled = handleAppError(
            `${IPC_CHANNELS.deleteAssets}:${assetId}`,
            error,
          );
          result.failed.push({
            assetId,
            message:
              handled.message ?? '无法移除该资料，请稍后重试。',
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
    async (_event, request: unknown) => {
      if (!isAssetIdRequest(request)) {
        throw invalidRequest();
      }

      await assetService.revealInFolder(request.assetId);
    },
  );
}

export function removeAssetHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.selectLocalAssetFiles);
  ipcMain.removeHandler(IPC_CHANNELS.addLocalAssets);
  ipcMain.removeHandler(IPC_CHANNELS.renameAsset);
  ipcMain.removeHandler(IPC_CHANNELS.relinkAsset);
  ipcMain.removeHandler(IPC_CHANNELS.deleteAssets);
  ipcMain.removeHandler(IPC_CHANNELS.refreshAsset);
  ipcMain.removeHandler(IPC_CHANNELS.refreshAllAssets);
  ipcMain.removeHandler(IPC_CHANNELS.revealAssetInFolder);
}
