import { contextBridge, ipcRenderer, webUtils } from 'electron';

import type { AppPreferences } from '../shared/app-preferences';
import type { AssetSnapshot } from '../shared/assets';
import { isIpcResult, type IpcErrorPayload } from '../shared/ipc-error';
import type { ProjectSnapshot } from '../shared/projects';
import type {
  WorkbenchBootstrap,
  WorkbenchCloseRequest,
  WorkbenchCommandRequest,
  WorkbenchCommandResult,
  WorkbenchOpenRequest,
} from '../shared/workbench/protocol';
import type {
  CreateProjectRequest,
  DeleteProjectRequest,
  AddLocalAssetsRequest,
  AddLocalAssetsResult,
  AssetIdRequest,
  HealthCheckResponse,
  HtmlContextMenuEvent,
  LearningCompanionApi,
  OpenExternalRequest,
  ProjectLifecycleRequest,
  RelinkAssetRequest,
  RenameAssetRequest,
  RenameProjectRequest,
  SetProjectPinnedRequest,
  UpdateHomePreferencesRequest,
} from '../shared/ipc';
import {
  IPC_CHANNELS,
  isHtmlContextMenuEvent,
} from '../shared/ipc';
import { subscribeWorkbenchFacilityEvents } from './workbench-facility-events';

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
  openExternal: (request: OpenExternalRequest) =>
    invoke<void>(IPC_CHANNELS.openExternal, request),
  getAppPreferences: () =>
    invoke<AppPreferences>(IPC_CHANNELS.getAppPreferences),
  updateHomePreferences: (request: UpdateHomePreferencesRequest) =>
    invoke<AppPreferences>(
      IPC_CHANNELS.updateHomePreferences,
      request,
    ),
  listProjects: () => invoke<ProjectSnapshot[]>(IPC_CHANNELS.listProjects),
  createProject: (request: CreateProjectRequest) =>
    invoke<ProjectSnapshot>(IPC_CHANNELS.createProject, request),
  renameProject: (request: RenameProjectRequest) =>
    invoke<ProjectSnapshot>(IPC_CHANNELS.renameProject, request),
  setProjectPinned: (request: SetProjectPinnedRequest) =>
    invoke<ProjectSnapshot>(IPC_CHANNELS.setProjectPinned, request),
  deleteProject: (request: DeleteProjectRequest) =>
    invoke<void>(IPC_CHANNELS.deleteProject, request),
  openProject: (request: ProjectLifecycleRequest) =>
    invoke<AssetSnapshot[]>(IPC_CHANNELS.openProject, request),
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
    invoke<AssetSnapshot>(IPC_CHANNELS.renameAsset, request),
  relinkAsset: (request: RelinkAssetRequest) =>
    invoke<AssetSnapshot>(IPC_CHANNELS.relinkAsset, request),
  deleteAsset: (request: AssetIdRequest) =>
    invoke<void>(IPC_CHANNELS.deleteAsset, request),
  refreshAsset: (request: AssetIdRequest) =>
    invoke<AssetSnapshot>(IPC_CHANNELS.refreshAsset, request),
  refreshAllAssets: (request: ProjectLifecycleRequest) =>
    invoke<AssetSnapshot[]>(IPC_CHANNELS.refreshAllAssets, request),
  revealAssetInFolder: (request: AssetIdRequest) =>
    invoke<void>(IPC_CHANNELS.revealAssetInFolder, request),
  openWorkbench: (request: WorkbenchOpenRequest) =>
    invoke<WorkbenchBootstrap>(IPC_CHANNELS.openWorkbench, request),
  commandWorkbench: (request: WorkbenchCommandRequest) =>
    invoke<WorkbenchCommandResult>(
      IPC_CHANNELS.commandWorkbench,
      request,
    ),
  closeWorkbench: (request: WorkbenchCloseRequest) =>
    invoke<void>(IPC_CHANNELS.closeWorkbench, request),
  onWorkbenchFacilityEvent: (listener) =>
    subscribeWorkbenchFacilityEvents(ipcRenderer, listener),
  onHtmlContextMenu: (
    listener: (event: HtmlContextMenuEvent) => void,
  ) => {
    const wrappedListener = (_event: Electron.IpcRendererEvent, value: unknown) => {
      if (isHtmlContextMenuEvent(value)) {
        listener(value);
      }
    };

    ipcRenderer.on(IPC_CHANNELS.htmlContextMenu, wrappedListener);
    return () => {
      ipcRenderer.removeListener(
        IPC_CHANNELS.htmlContextMenu,
        wrappedListener,
      );
    };
  },
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld('learningCompanion', api);
