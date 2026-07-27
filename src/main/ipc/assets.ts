import { dialog, ipcMain } from 'electron';

import {
  IPC_CHANNELS,
  isAddLocalAssetsRequest,
  isAssetIdRequest,
  isProjectLifecycleRequest,
  isRelinkAssetRequest,
  isRenameAssetRequest,
  type AddLocalAssetsResult,
  type AssetSummary,
} from '../../shared/ipc';
import type { AssetFileServiceApi } from '../assets/asset-file-service';
import type { AssetSnapshot } from '../../shared/assets';
import type { AssetServiceApi } from '../assets/asset-service';
import { AppError, handleAppError } from '../errors/app-error';
import type { ProjectServiceApi } from '../projects/project-service';
import { registerIpcHandler } from './register-handler';

function invalidRequest(): Error {
  return new AppError('INVALID_IPC_REQUEST');
}

export function toAssetSummary(
  snapshot: AssetSnapshot,
): AssetSummary {
  if (snapshot.contentRef.kind !== 'local-file') {
    throw new AppError('DATA_INTEGRITY_ERROR');
  }

  return {
    id: snapshot.id,
    projectId: snapshot.projectId,
    name: snapshot.name,
    mediaType: snapshot.mediaType,
    contentLocator: {
      kind: snapshot.contentRef.kind,
      path: snapshot.contentRef.path,
      availability: snapshot.contentStatus.availability,
      checkedTime: new Date(snapshot.contentStatus.checkedTime).toISOString(),
    },
    createdTime: new Date(snapshot.createdTime).toISOString(),
    lastUsedTime: new Date(snapshot.lastUsedTime).toISOString(),
  };
}

export function registerAssetHandlers(
  assetService: AssetServiceApi,
  assetFileService: AssetFileServiceApi,
  projectService: ProjectServiceApi,
): void {
  registerIpcHandler(IPC_CHANNELS.openProject, async (_event, request: unknown) => {
    if (!isProjectLifecycleRequest(request)) {
      throw invalidRequest();
    }

    const loaded = await projectService.loadProjectWorkspace(request.projectId);
    return loaded.map(toAssetSummary);
  });

  registerIpcHandler(IPC_CHANNELS.closeProject, async (_event, request: unknown) => {
    if (!isProjectLifecycleRequest(request)) {
      throw invalidRequest();
    }

    await projectService.unloadProjectWorkspace(request.projectId);
  });

  registerIpcHandler(IPC_CHANNELS.selectLocalAssetFiles, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    });

    return result.canceled ? [] : result.filePaths;
  });

  registerIpcHandler(
    IPC_CHANNELS.addLocalAssets,
    async (_event, request: unknown): Promise<AddLocalAssetsResult> => {
      if (!isAddLocalAssetsRequest(request)) {
        throw invalidRequest();
      }

      const result: AddLocalAssetsResult = { added: [], failed: [] };

      for (const path of request.paths) {
        try {
          result.added.push(
            toAssetSummary(await assetService.addLocalFile(path)),
          );
        } catch (error) {
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

      return result;
    },
  );

  registerIpcHandler(IPC_CHANNELS.renameAsset, (_event, request: unknown) => {
    if (!isRenameAssetRequest(request)) {
      throw invalidRequest();
    }

    return toAssetSummary(
      assetService.update(request.assetId, { name: request.name }),
    );
  });

  registerIpcHandler(
    IPC_CHANNELS.relinkAsset,
    async (_event, request: unknown) => {
      if (!isRelinkAssetRequest(request)) {
        throw invalidRequest();
      }

      return toAssetSummary(
        await assetService.relinkLocalFile(request.assetId, request.path),
      );
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

      return toAssetSummary(
        await assetService.refresh(request.assetId),
      );
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

      return (await assetService.refreshAll()).map(
        toAssetSummary,
      );
    },
  );

  registerIpcHandler(
    IPC_CHANNELS.revealAssetInFolder,
    (_event, request: unknown) => {
      if (!isAssetIdRequest(request)) {
        throw invalidRequest();
      }

      assetFileService.revealInFolder(request.assetId);
    },
  );
}

export function removeAssetHandlers(): void {
  ipcMain.removeHandler(IPC_CHANNELS.openProject);
  ipcMain.removeHandler(IPC_CHANNELS.closeProject);
  ipcMain.removeHandler(IPC_CHANNELS.selectLocalAssetFiles);
  ipcMain.removeHandler(IPC_CHANNELS.addLocalAssets);
  ipcMain.removeHandler(IPC_CHANNELS.renameAsset);
  ipcMain.removeHandler(IPC_CHANNELS.relinkAsset);
  ipcMain.removeHandler(IPC_CHANNELS.deleteAsset);
  ipcMain.removeHandler(IPC_CHANNELS.refreshAsset);
  ipcMain.removeHandler(IPC_CHANNELS.refreshAllAssets);
  ipcMain.removeHandler(IPC_CHANNELS.revealAssetInFolder);
}
