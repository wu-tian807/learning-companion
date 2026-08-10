import { contextBridge, ipcRenderer, webUtils } from "electron";

import type { AppPreferences } from "../shared/app-preferences";
import type { AppSetupSnapshot } from "../shared/app-setup";
import type {
  AgentProviderLoginChallenge,
  AgentProviderModelCatalogSnapshot,
  AgentProviderSetupSnapshot,
} from "../shared/agent-providers";
import type { AssetSnapshot } from "../shared/assets";
import type {
  ExternalLibraryMigrationResult,
  ExternalLibrarySnapshot,
} from "../shared/external-libraries";
import type {
  GenerationTaskIdRequest,
  GenerationTaskProjectRequest,
  GenerationTaskView,
  StartGenerationTaskRequest,
} from "../shared/generation-tasks";
import { isIpcResult, type IpcErrorPayload } from "../shared/ipc-error";
import type { ProjectSnapshot } from "../shared/projects";
import type {
  WorkbenchBootstrap,
  WorkbenchCloseRequest,
  WorkbenchCommandRequest,
  WorkbenchCommandResult,
  WorkbenchOpenRequest,
} from "../shared/workbench/protocol";
import type { AssetAttachment } from "../shared/workbench/attachment";
import type { AssetTarget } from "../shared/workbench/anchor";
import type { JsonValue } from "../shared/workbench/protocol";
import type {
  CreateProjectRequest,
  ChangeProjectWorkspaceRequest,
  AgentProviderConnectionRequest,
  AgentProviderIdRequest,
  CancelAgentProviderLoginRequest,
  ConfigureAgentProviderApiConnectionRequest,
  DeleteProjectRequest,
  ExternalLibraryIdRequest,
  MigrateExternalLibrariesRequest,
  AddLocalAssetsRequest,
  AddLocalAssetsResult,
  AssetIdRequest,
  DeleteAssetsRequest,
  DeleteAssetsResult,
  DocumentAiRequest,
  DocumentAiResponse,
  HealthCheckResponse,
  LearningCompanionApi,
  OpenExternalRequest,
  ProjectLifecycleRequest,
  SelectProjectWorkspaceRequest,
  RelinkAssetRequest,
  RenameAssetRequest,
  RenameProjectRequest,
  SetProjectPinnedRequest,
  SelectAgentProviderForSelectorRequest,
  UpdateHomePreferencesRequest,
} from "../shared/ipc";
import { IPC_CHANNELS } from "../shared/ipc";
import { subscribeWorkbenchFacilityEvents } from "./workbench-facility-events";
import { subscribeExternalLibraryEvents } from "./external-library-events";
import { subscribeAgentProviderEvents } from "./agent-provider-events";
import { subscribeAssetEvents } from "./asset-events";
import { subscribeGenerationTaskEvents } from "./generation-task-events";

async function invoke<Response>(
  channel: string,
  ...args: unknown[]
): Promise<Response> {
  const result: unknown = await ipcRenderer.invoke(channel, ...args);

  if (!isIpcResult<Response>(result)) {
    const error: IpcErrorPayload = {
      code: "INVALID_IPC_RESPONSE",
      kind: "internal",
      message: "应用返回了无效响应，请重启后重试。",
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
    invoke<AppPreferences>(IPC_CHANNELS.updateHomePreferences, request),
  getAppSetup: () =>
    invoke<AppSetupSnapshot>(IPC_CHANNELS.getAppSetup),
  completeExternalLibraryOnboarding: () =>
    invoke<AppSetupSnapshot>(
      IPC_CHANNELS.completeExternalLibraryOnboarding,
    ),
  completeAgentProviderOnboarding: () =>
    invoke<AppSetupSnapshot>(
      IPC_CHANNELS.completeAgentProviderOnboarding,
    ),
  getAgentProviderSetup: () =>
    invoke<AgentProviderSetupSnapshot>(
      IPC_CHANNELS.getAgentProviderSetup,
    ),
  refreshAgentProvider: (request: AgentProviderIdRequest) =>
    invoke<AgentProviderSetupSnapshot>(
      IPC_CHANNELS.refreshAgentProvider,
      request,
    ),
  onAgentProviderSetupChanged: (listener) =>
    subscribeAgentProviderEvents(ipcRenderer, listener),
  startAgentProviderLogin: (request: AgentProviderConnectionRequest) =>
    invoke<AgentProviderLoginChallenge>(
      IPC_CHANNELS.startAgentProviderLogin,
      request,
    ),
  cancelAgentProviderLogin: (
    request: CancelAgentProviderLoginRequest,
  ) =>
    invoke<void>(
      IPC_CHANNELS.cancelAgentProviderLogin,
      request,
    ),
  configureAgentProviderApiConnection: (
    request: ConfigureAgentProviderApiConnectionRequest,
  ) =>
    invoke<AgentProviderSetupSnapshot>(
      IPC_CHANNELS.configureAgentProviderApiConnection,
      request,
    ),
  deleteAgentProviderConnection: (
    request: AgentProviderConnectionRequest,
  ) =>
    invoke<AgentProviderSetupSnapshot>(
      IPC_CHANNELS.deleteAgentProviderConnection,
      request,
    ),
  getAgentProviderModels: (request: AgentProviderConnectionRequest) =>
    invoke<AgentProviderModelCatalogSnapshot>(
      IPC_CHANNELS.getAgentProviderModels,
      request,
    ),
  selectAgentProviderForSelector: (
    request: SelectAgentProviderForSelectorRequest,
  ) =>
    invoke<AgentProviderSetupSnapshot>(
      IPC_CHANNELS.selectAgentProviderForSelector,
      request,
    ),
  listExternalLibraries: () =>
    invoke<ExternalLibrarySnapshot[]>(IPC_CHANNELS.listExternalLibraries),
  refreshExternalLibrary: (request: ExternalLibraryIdRequest) =>
    invoke<ExternalLibrarySnapshot>(
      IPC_CHANNELS.refreshExternalLibrary,
      request,
    ),
  startExternalLibraryInstallation: (request: ExternalLibraryIdRequest) =>
    invoke<ExternalLibrarySnapshot>(
      IPC_CHANNELS.startExternalLibraryInstallation,
      request,
    ),
  cancelExternalLibrary: (request: ExternalLibraryIdRequest) =>
    invoke<void>(IPC_CHANNELS.cancelExternalLibrary, request),
  removeExternalLibrary: (request: ExternalLibraryIdRequest) =>
    invoke<ExternalLibrarySnapshot>(
      IPC_CHANNELS.removeExternalLibrary,
      request,
    ),
  selectExternalLibrariesDirectory: () =>
    invoke<string | undefined>(
      IPC_CHANNELS.selectExternalLibrariesDirectory,
    ),
  migrateExternalLibraries: (
    request: MigrateExternalLibrariesRequest,
  ) =>
    invoke<ExternalLibraryMigrationResult>(
      IPC_CHANNELS.migrateExternalLibraries,
      request,
    ),
  onExternalLibraryChanged: (listener) =>
    subscribeExternalLibraryEvents(ipcRenderer, listener),
  listProjects: () => invoke<ProjectSnapshot[]>(IPC_CHANNELS.listProjects),
  createProject: (request: CreateProjectRequest) =>
    invoke<ProjectSnapshot>(IPC_CHANNELS.createProject, request),
  selectProjectWorkspace: (request: SelectProjectWorkspaceRequest) =>
    invoke<string | undefined>(IPC_CHANNELS.selectProjectWorkspace, request),
  changeProjectWorkspace: (request: ChangeProjectWorkspaceRequest) =>
    invoke<ProjectSnapshot>(IPC_CHANNELS.changeProjectWorkspace, request),
  openProjectWorkspace: (request: ProjectLifecycleRequest) =>
    invoke<void>(IPC_CHANNELS.openProjectWorkspace, request),
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
  selectLocalAssetFiles: (request: ProjectLifecycleRequest) =>
    invoke<string[]>(IPC_CHANNELS.selectLocalAssetFiles, request),
  addLocalAssets: (request: AddLocalAssetsRequest) =>
    invoke<AddLocalAssetsResult>(IPC_CHANNELS.addLocalAssets, request),
  renameAsset: (request: RenameAssetRequest) =>
    invoke<AssetSnapshot>(IPC_CHANNELS.renameAsset, request),
  relinkAsset: (request: RelinkAssetRequest) =>
    invoke<AssetSnapshot>(IPC_CHANNELS.relinkAsset, request),
  deleteAssets: (request: DeleteAssetsRequest) =>
    invoke<DeleteAssetsResult>(IPC_CHANNELS.deleteAssets, request),
  refreshAsset: (request: AssetIdRequest) =>
    invoke<AssetSnapshot>(IPC_CHANNELS.refreshAsset, request),
  refreshAllAssets: (request: ProjectLifecycleRequest) =>
    invoke<AssetSnapshot[]>(IPC_CHANNELS.refreshAllAssets, request),
  revealAssetInFolder: (request: AssetIdRequest) =>
    invoke<void>(IPC_CHANNELS.revealAssetInFolder, request),
  onAssetChanged: (listener) =>
    subscribeAssetEvents(ipcRenderer, listener),
  listGenerationTasks: (request: GenerationTaskProjectRequest) =>
    invoke<GenerationTaskView[]>(IPC_CHANNELS.listGenerationTasks, request),
  startGenerationTask: (request: StartGenerationTaskRequest) =>
    invoke<GenerationTaskView>(IPC_CHANNELS.startGenerationTask, request),
  retryGenerationTask: (request: GenerationTaskIdRequest) =>
    invoke<GenerationTaskView>(IPC_CHANNELS.retryGenerationTask, request),
  cancelGenerationTask: (request: GenerationTaskIdRequest) =>
    invoke<void>(IPC_CHANNELS.cancelGenerationTask, request),
  discardGenerationTask: (request: GenerationTaskIdRequest) =>
    invoke<void>(IPC_CHANNELS.discardGenerationTask, request),
  onGenerationTaskChanged: (listener) =>
    subscribeGenerationTaskEvents(ipcRenderer, listener),
  openWorkbench: (request: WorkbenchOpenRequest) =>
    invoke<WorkbenchBootstrap>(IPC_CHANNELS.openWorkbench, request),
  commandWorkbench: (request: WorkbenchCommandRequest) =>
    invoke<WorkbenchCommandResult>(IPC_CHANNELS.commandWorkbench, request),
  closeWorkbench: (request: WorkbenchCloseRequest) =>
    invoke<void>(IPC_CHANNELS.closeWorkbench, request),
  onWorkbenchFacilityEvent: (listener) =>
    subscribeWorkbenchFacilityEvents(ipcRenderer, listener),
  listAttachments: (request: {
    projectId: string;
    assetId: string;
  }) => invoke<AssetAttachment[]>(IPC_CHANNELS.listAttachments, request),
  createAttachment: (request: {
    projectId: string;
    assetId: string;
    typeId: string;
    typeVersion: number;
    target: AssetTarget;
    metadata: JsonValue;
  }) => invoke<AssetAttachment>(IPC_CHANNELS.createAttachment, request),
  deleteAttachment: (request: {
    projectId: string;
    attachmentId: string;
  }) => invoke<void>(IPC_CHANNELS.deleteAttachment, request),
  askDocumentAi: (request: DocumentAiRequest) =>
    invoke<DocumentAiResponse>(IPC_CHANNELS.askDocumentAi, request),
  getPathForFile: (file: File) => webUtils.getPathForFile(file),
};

contextBridge.exposeInMainWorld("learningCompanion", api);
