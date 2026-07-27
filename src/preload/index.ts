import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { AppPreferences } from '../shared/app-preferences';
import { isIpcResult, type IpcErrorPayload } from '../shared/ipc-error';
import type {
  CreateProjectRequest,
  DeleteProjectRequest,
  AddLocalAssetsRequest,
  AddLocalAssetsResult,
  AssetIdRequest,
  AssetSummary,
  HealthCheckResponse,
  LearningCompanionApi,
  ProjectSummary,
  ProjectLifecycleRequest,
  RelinkAssetRequest,
  RenameAssetRequest,
  RenameProjectRequest,
  SetProjectPinnedRequest,
  UpdateHomePreferencesRequest,
} from '../shared/ipc';
import { IPC_CHANNELS } from '../shared/ipc';

async function invoke<Response>(
  channel: string,
  ...args: unknown[]
): Promise<Response> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args);

  if (!isIpcResult<Response>(result)) {
    const error: IpcErrorPayload = {
      code: 'INVALID_IPC_RESPONSE',
      kind: 'internal',
      message: '应用返回了无效响应，请重启后重试。',
      retryable: true,
    };
    throw error;
  }

  if (!result.ok) {
    throw result.error;
  }

  return result.data;
}

const api: LearningCompanionApi = {
  healthCheck: () => invoke<HealthCheckResponse>(IPC_CHANNELS.healthCheck),
  getAppPreferences: () =>
    invoke<AppPreferences>(IPC_CHANNELS.getAppPreferences),
  updateHomePreferences: (request: UpdateHomePreferencesRequest) =>
    invoke<AppPreferences>(
      IPC_CHANNELS.updateHomePreferences,
      request,
    ),
  listProjects: () => invoke<ProjectSummary[]>(IPC_CHANNELS.listProjects),
  createProject: (request: CreateProjectRequest) =>
    invoke<ProjectSummary>(IPC_CHANNELS.createProject, request),
  renameProject: (request: RenameProjectRequest) =>
    invoke<ProjectSummary>(IPC_CHANNELS.renameProject, request),
  setProjectPinned: (request: SetProjectPinnedRequest) =>
    invoke<ProjectSummary>(IPC_CHANNELS.setProjectPinned, request),
  deleteProject: (request: DeleteProjectRequest) =>
    invoke<void>(IPC_CHANNELS.deleteProject, request),
  openProject: (request: ProjectLifecycleRequest) =>
    invoke<AssetSummary[]>(IPC_CHANNELS.openProject, request),
  closeProject: (request: ProjectLifecycleRequest) =>
    invoke<void>(IPC_CHANNELS.closeProject, request),
  selectLocalAssetFiles: () =>
    invoke<string[]>(IPC_CHANNELS.selectLocalAssetFiles),
  addLocalAssets: (request: AddLocalAssetsRequest) =>
    invoke<AddLocalAssetsResult>(
      IPC_CHANNELS.addLocalAssets,
      request,
    ),
  renameAsset: (request: RenameAssetRequest) =>
    invoke<AssetSummary>(IPC_CHANNELS.renameAsset, request),
  relinkAsset: (request: RelinkAssetRequest) =>
    invoke<AssetSummary>(IPC_CHANNELS.relinkAsset, request),
  deleteAsset: (request: AssetIdRequest) =>
    invoke<void>(IPC_CHANNELS.deleteAsset, request),
  refreshAsset: (request: AssetIdRequest) =>
    invoke<AssetSummary>(IPC_CHANNELS.refreshAsset, request),
  refreshAllAssets: (request: ProjectLifecycleRequest) =>
    invoke<AssetSummary[]>(IPC_CHANNELS.refreshAllAssets, request),
  revealAssetInFolder: (request: AssetIdRequest) =>
    invoke<void>(IPC_CHANNELS.revealAssetInFolder, request),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('learningCompanion', api);
