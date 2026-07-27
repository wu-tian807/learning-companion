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
import type { Asset } from '../assets/asset';
import type { AssetDatabaseApi } from '../assets/asset-database';
import type { ProjectServiceApi } from '../projects/project-service';

function invalidRequest(operation: string): Error {
  return new Error(`Asset ${operation}请求无效`);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : '未知错误';
}

export function toAssetSummary(asset: Asset): AssetSummary {
  return {
    id: asset.id,
    projectId: asset.projectId,
    name: asset.name,
    mediaType: asset.mediaType,
    contentLocator: {
      kind: asset.contentLocator.kind,
      path: asset.contentLocator.path,
      availability: asset.contentLocator.availability,
      checkedTime: asset.contentLocator.checkedTime.toISOString(),
    },
    createdTime: asset.createdTime.toISOString(),
    lastUsedTime: asset.lastUsedTime.toISOString(),
  };
}

export function registerAssetHandlers(
  assetDatabase: AssetDatabaseApi,
  projectService: ProjectServiceApi,
): void {
  ipcMain.handle(IPC_CHANNELS.openProject, async (_event, request: unknown) => {
    if (!isProjectLifecycleRequest(request)) {
      throw invalidRequest('打开 Project');
    }

    const loaded = await projectService.loadProjectWorkspace(request.projectId);
    return loaded.map(toAssetSummary);
  });

  ipcMain.handle(IPC_CHANNELS.closeProject, (_event, request: unknown) => {
    if (!isProjectLifecycleRequest(request)) {
      throw invalidRequest('关闭 Project');
    }

    projectService.unloadProjectWorkspace(request.projectId);
  });

  ipcMain.handle(IPC_CHANNELS.selectLocalAssetFiles, async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openFile', 'multiSelections'],
    });

    return result.canceled ? [] : result.filePaths;
  });

  ipcMain.handle(
    IPC_CHANNELS.addLocalAssets,
    async (_event, request: unknown): Promise<AddLocalAssetsResult> => {
      if (!isAddLocalAssetsRequest(request)) {
        throw invalidRequest('批量添加');
      }

      const result: AddLocalAssetsResult = { added: [], failed: [] };

      for (const path of request.paths) {
        try {
          result.added.push(toAssetSummary(await assetDatabase.add({ path })));
        } catch (error) {
          result.failed.push({ path, message: errorMessage(error) });
        }
      }

      return result;
    },
  );

  ipcMain.handle(IPC_CHANNELS.renameAsset, (_event, request: unknown) => {
    if (!isRenameAssetRequest(request)) {
      throw invalidRequest('重命名');
    }

    return toAssetSummary(
      assetDatabase.update(request.assetId, { name: request.name }),
    );
  });

  ipcMain.handle(
    IPC_CHANNELS.relinkAsset,
    async (_event, request: unknown) => {
      if (!isRelinkAssetRequest(request)) {
        throw invalidRequest('重新定位');
      }

      return toAssetSummary(
        await assetDatabase.relink(request.assetId, request.path),
      );
    },
  );

  ipcMain.handle(IPC_CHANNELS.deleteAsset, (_event, request: unknown) => {
    if (!isAssetIdRequest(request)) {
      throw invalidRequest('删除');
    }

    assetDatabase.delete(request.assetId);
  });

  ipcMain.handle(
    IPC_CHANNELS.refreshAsset,
    async (_event, request: unknown) => {
      if (!isAssetIdRequest(request)) {
        throw invalidRequest('刷新');
      }

      return toAssetSummary(
        await assetDatabase.refreshAvailability(request.assetId),
      );
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
}
