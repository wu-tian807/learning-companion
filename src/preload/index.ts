import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { AppPreferences } from '../shared/app-preferences';
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

const api: LearningCompanionApi = {
  healthCheck: () =>
    ipcRenderer.invoke(IPC_CHANNELS.healthCheck) as Promise<HealthCheckResponse>,
  getAppPreferences: () =>
    ipcRenderer.invoke(IPC_CHANNELS.getAppPreferences) as Promise<AppPreferences>,
  updateHomePreferences: (request: UpdateHomePreferencesRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.updateHomePreferences,
      request,
    ) as Promise<AppPreferences>,
  listProjects: () =>
    ipcRenderer.invoke(IPC_CHANNELS.listProjects) as Promise<ProjectSummary[]>,
  createProject: (request: CreateProjectRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.createProject, request) as Promise<ProjectSummary>,
  renameProject: (request: RenameProjectRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameProject, request) as Promise<ProjectSummary>,
  setProjectPinned: (request: SetProjectPinnedRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.setProjectPinned, request) as Promise<ProjectSummary>,
  deleteProject: (request: DeleteProjectRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteProject, request) as Promise<void>,
  openProject: (request: ProjectLifecycleRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.openProject, request) as Promise<
      AssetSummary[]
    >,
  closeProject: (request: ProjectLifecycleRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.closeProject, request) as Promise<void>,
  selectLocalAssetFiles: () =>
    ipcRenderer.invoke(IPC_CHANNELS.selectLocalAssetFiles) as Promise<string[]>,
  addLocalAssets: (request: AddLocalAssetsRequest) =>
    ipcRenderer.invoke(
      IPC_CHANNELS.addLocalAssets,
      request,
    ) as Promise<AddLocalAssetsResult>,
  renameAsset: (request: RenameAssetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.renameAsset, request) as Promise<AssetSummary>,
  relinkAsset: (request: RelinkAssetRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.relinkAsset, request) as Promise<AssetSummary>,
  deleteAsset: (request: AssetIdRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.deleteAsset, request) as Promise<void>,
  refreshAsset: (request: AssetIdRequest) =>
    ipcRenderer.invoke(IPC_CHANNELS.refreshAsset, request) as Promise<AssetSummary>,
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('learningCompanion', api);
